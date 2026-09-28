"""The Valle Serra's ground as a heightfield, in numpy (no Blender needed).

Two grids make the height:
- COARSE, 8 m cells over 12.8 x 12.8 km: the valley's big shape, the
  mountains' relief (ridged noise shaped by a designed skyline), then
  particle hydraulic erosion, which carves the gullies, ribs and debris fans
  that make a slope read as a real mountainside at 2-3 km.
- FINE, 1 m cells over the valley floor and lower slopes (where the
  targets are): the coarse height upsampled, plus everything designed at
  human scale - the river's channel and banks, the road's bench and
  embankments, the bridge's abutments, the farm's bench, the village's fan,
  the dam's gorge, the player's spur - and fine noise.

`height(x, y)` answers from the fine grid where it exists and blends into
the coarse one outside it, so every consumer (meshes, maps, placement,
contract nodes) asks the same function.
"""

import math
import os
import time

import numpy as np

from . import layout as L
from . import noise as N
from .noise import Grid, smoothstep

SEED = 4127

COARSE = dict(x0=-6400.0, y0=-4000.0, dx=8.0, nx=1601, ny=1601)
FINE = dict(x0=-1000.0, y0=-150.0, dx=1.0, nx=1801, ny=1301)


def log(*a):
    print("[terrain]", *a, flush=True)


# ---------------------------------------------------------------------------
# Profiles across the valley

def far_profile(u):
    """Height above the floor edge on the far side, u metres beyond it: the
    glacial trough's steep lower wall (forest), a shoulder (the alp),
    then the long rise to the crest."""
    k = np.array([0, 60, 200, 400, 600, 800, 1000, 1300, 1600, 2000, 2400, 3000, 4000, 6000])
    z = np.array([0, 25, 115, 240, 350, 430, 520, 680, 840, 1030, 1180, 1320, 1450, 1600])
    return np.interp(u, k, z)


def near_profile(u, s):
    """Height above the floor edge on the player's side. Concave (steep just
    below the spur, flattening onto the floor), so from the spur the whole
    slope down to the road is in view; beyond the spur it keeps climbing to
    the mountains behind the player that shade the valley at dawn. Toward
    the dam (small s) the near side rises steeply: the gorge's wall."""
    U = 262.0
    H = 59.6
    base = np.where(u < U, H * (np.clip(u, 0, None) / U) ** 2.2, H + 0.30 * (u - U) - 0.00004 * (u - U) ** 2)
    base = np.where(u > U + 3000, H + 0.30 * 3000 - 0.00004 * 9e6 + 0.1 * (u - U - 3000), base)
    # toward the dam the near side is the gorge's wall: up to ~90 m more,
    # gained within the first 300 m (not a multiplier: far from the river
    # that would raise whole mountains)
    gorge = 35.0 * smoothstep(0.0, 300.0, u) * smoothstep(700.0, 150.0, s)
    return base + gorge


def crest_at(bearing):
    """(range, z) of the far skyline at a bearing (degrees)."""
    c = np.array(L.CREST, float)
    return np.interp(bearing, c[:, 0], c[:, 1]), np.interp(bearing, c[:, 0], c[:, 2])


# ---------------------------------------------------------------------------
# Macro shape

def macro(x, y, ax=None, far=None, blur_cells=None):
    """The designed big shape (no noise), vectorised over arrays. Distances
    are to the valley's axis (the head valley, the reservoir, the river), so
    both sides' profiles follow the valley round its bends.

    The distance is continuous everywhere, but the nearest point's
    attributes (the floor's half-width, the water level) jump across the
    medial axis of a bend - on the far side between the river's two arms,
    on the near side right along the player's spur. On a grid (`blur_cells`)
    those attributes are blurred so the land has no seam."""
    if ax is None:
        ax = L.valley_axis()
    d, s, side = ax.nearest(x, y)
    if far is None:
        _, _, side0 = ax.nearest(np.array([0.0]), np.array([0.0]))
        near = side == side0[0]
    else:
        near = ~far
    zw = ax.at(s, 'z')
    W = np.where(near, ax.at(s, 'wn'), ax.at(s, 'wf'))
    if blur_cells:
        # blur each side's attributes separately (the two sides differ by design)
        for arr in (zw, W):
            for side_mask in (near, ~near):
                m = side_mask.astype(float)
                num = N.blur(np.where(side_mask, arr, 0.0), blur_cells)
                den = N.blur(m, blur_cells)
                arr[side_mask] = (num / np.maximum(den, 1e-6))[side_mask]
    u = d - W
    s_dam = s - _dam_s(ax)
    # the floor: a little above the water, rising gently away from it
    zfloor = zw + 1.6 + 0.010 * np.clip(d, 0, None) + 1.2 * smoothstep(0, 1, d / np.maximum(W, 1))
    z_edge = zw + 1.6 + 0.010 * W + 1.2
    zn = z_edge + near_profile(u, np.abs(s_dam))
    b = np.degrees(np.arctan2(x, y))
    r = np.hypot(x, y)
    rc, zc = crest_at(b)
    zf = z_edge + far_profile(u)
    # the far skyline caps the profile; beyond the crest the range falls away
    over = np.clip(r - rc, 0, None)
    cap = zc - over * 0.30
    zf = np.minimum(zf, cap + 50.0 * np.exp(-over / 300.0))
    z = np.where(u <= 0, zfloor, np.where(near, zn, zf))
    return z, dict(d=d, s=s, s_dam=s_dam, near=near, u=u, W=W, zw=zw, bearing=b, r=r)


def far_side_mask(g, ax):
    """True on the far side of the valley (beyond the axis as the player sees
    it), by filling a polygon: the valley axis from the head down to the
    down-valley end, closed round the back of the far mountains. A signed
    distance to the nearest segment flips in wedges near the axis' bends
    and ends; a filled polygon cannot."""
    P = ax.xy[::5]
    x0, y0 = g.x0, g.y0
    x1, y1 = g.x1 + g.dx, g.y1 + g.dx
    end = P[-1]
    head = P[0]
    poly = np.vstack([P, [x0 - 100, end[1]], [x0 - 100, y1 + 100], [x1 + 100, y1 + 100],
                      [x1 + 100, head[1] + (x1 - head[0]) * 0.65], head])
    ys = y0 + np.arange(g.ny) * g.dx
    xs = x0 + np.arange(g.nx) * g.dx
    ax_, ay_ = poly[:-1, 0], poly[:-1, 1]
    bx_, by_ = poly[1:, 0], poly[1:, 1]
    mask = np.zeros((g.ny, g.nx), bool)
    for j, yy in enumerate(ys):
        c = ((ay_ <= yy) & (by_ > yy)) | ((by_ <= yy) & (ay_ > yy))
        if not c.any():
            continue
        t = (yy - ay_[c]) / (by_[c] - ay_[c])
        xc = np.sort(ax_[c] + t * (bx_[c] - ax_[c]))
        for k in range(0, len(xc) - 1, 2):
            i0 = np.searchsorted(xs, xc[k])
            i1 = np.searchsorted(xs, xc[k + 1])
            mask[j, i0:i1] = True
    return mask


def _dam_s(ax):
    """Arc position of the dam's toe on the valley axis."""
    toe = np.asarray(L.RIVER_PTS[0])
    return ax.s[np.argmin(np.linalg.norm(ax.xy - toe, axis=1))]


def head_valley(x, y, z):
    """The reservoir's valley above the dam: a trough cut into whatever the
    side profiles made there, its bed rising toward the head; the lake fills
    it to RESERVOIR_Z."""
    res = L.reservoir()
    d, s, _ = res.nearest(x, y, max_dist=900)
    w = np.interp(s, res.s, res['w'])
    bed = -40.0 + 0.022 * s                       # the old valley floor under the lake
    trough = bed + 0.55 * np.clip(d - w * 0.5, 0, None) + 0.0006 * np.clip(d - w * 0.5, 0, None) ** 2
    m = np.isfinite(d)
    out = z.copy()
    out[m] = np.minimum(z[m], trough[m])
    return out


def peaks(x, y):
    """Summit pyramids on the crest: sharp, faceted (a few planes)."""
    add = np.zeros(np.shape(x))
    for b, r, h, rad in L.PEAKS:
        c = L.polar(b, r)
        dx, dy = x - c[0], y - c[1]
        ang = np.arctan2(dy, dx)
        # a four-faced pyramid with a little twist: distance in a rotated
        # L1-ish norm gives flat faces and sharp edges
        rr = np.hypot(dx, dy) * (1.0 + 0.18 * np.cos(4 * (ang + 0.3 * b)))
        add += h * np.clip(1 - rr / rad, 0, None) ** 1.3
    return add


def great_cliff(x, y, u, bearing):
    """The limestone wall across the valley (the echo secret): a step of
    ~170 m in the far slope, its face toward the player, bedded into
    horizontal bands and ledges every 14-22 m so it reads as rock strata,
    not a curtain. Returns (height change, face mask) - the face mask tells
    relief() to stay off it."""
    c = L.CLIFF_C
    cb, cr = L.bearing_range(np.array([c[0], c[1], 0]))
    r = np.hypot(x, y)
    lat = smoothstep(7.5, 3.0, np.abs(bearing - cb + 1.5 * N.fbm(r * 0.01, bearing * 0.1, SEED + 92, 2)))
    edge = cr + 40.0 * N.fbm(bearing * 0.8, 0.0, SEED + 91, 3)
    t = (r - edge) / 9.0
    env = np.exp(-((r - edge) / 240.0) ** 2)
    step = np.tanh(t) * 85.0 * lat * env
    # bedding: terrace the raised part into ledges
    q = 18.0
    lvl = step + 85.0
    frac = (lvl / q) % 1.0
    face = lat * np.exp(-(t / 1.6) ** 2)
    step = step - q * 0.3 * smoothstep(0.55, 0.95, frac) * face
    return step, face


def goat_crag(x, y):
    """A rock tower at the far slope's foot, stepped with ledges."""
    c = L.GOAT_CRAG_C
    dx, dy = x - c[0], y - c[1]
    ang = np.arctan2(dy, dx)
    rr = np.hypot(dx * 1.0, dy * 1.35) * (1 + 0.12 * np.sin(5 * ang + 1.0) + 0.06 * np.sin(11 * ang))
    h = 78.0 * smoothstep(58.0, 20.0, rr)
    # ledges: quantise the flank into steps
    q = 9.0
    hs = np.floor(h / q) * q + q * smoothstep(0.55, 1.0, (h / q) % 1.0)
    return np.where(rr < 58, hs, 0.0)


# ---------------------------------------------------------------------------
# Relief on the coarse grid

def relief(x, y, info, z):
    """Mountain relief. Spurs and gullies run down the fall line: on both
    sides that is roughly toward the player (the river wraps round his
    spur), so the ridged noise is stretched along the range from the eye -
    spurs 1-2 km long, 300-500 m apart, sharpening into aretes near the
    crest. Isotropic noise breaks the pattern up; nothing on the floor."""
    u = info['u']
    near = info['near']
    b = np.radians(info['bearing'])
    r = info['r']
    up = smoothstep(10.0, 700.0, u)
    alt = np.clip((z + 60.0) / 1100.0, 0, 1.3)
    # far side: polar coordinates stretched along the fall line (toward the
    # player), bent by a strong warp so spurs wander and branch; the near
    # side (whose polar lines converge on the eye) gets the isotropic parts
    a = b * 2600.0
    wa, wb = N.warp(a, r, SEED + 1, 420.0, 1 / 1300.0)
    spurs = N.ridged(wa / 520.0, wb / 1000.0, SEED + 2, octaves=6, gain=0.5, sharp=1.6)
    wx, wy = N.warp(x, y, SEED + 6, 300.0, 1 / 1100.0)
    crags = N.ridged(wx / 700.0, wy / 700.0, SEED + 7, octaves=7, gain=0.55, sharp=2.0)
    iso = N.fbm(wx, wy, SEED + 3, octaves=6, scale=1 / 1100.0)
    big = N.fbm(x, y, SEED + 4, octaves=3, scale=1 / 5000.0)
    sp = np.where(near, 0.0, (spurs - 0.40) * (40.0 + 150.0 * alt))
    h = (sp + (crags - 0.40) * (20.0 + 170.0 * alt) + iso * (25.0 + 60.0 * alt) + big * 50.0)
    return h * up * np.where(near, 0.7, 1.0) * smoothstep(220.0, 600.0, r)


def erode(g, mask, dep_mask=None, droplets=1_200_000, steps=64, batch=40_000, seed=SEED, radius=2,
          inertia=0.05, capacity=4.0, deposition=0.3, erosion=0.3, evaporation=0.012, gravity=4.0,
          min_slope=0.01, max_change=0.008, max_vel=6.0):
    """Particle hydraulic erosion (after Hans Theobald Beyer, 2015), with a
    batch of droplets stepping at once.

    Heights are handled in units where a 30-degree slope drops ~0.05 per
    cell, so the classic parameters hold at any cell size. Droplets of one
    batch cannot see each other's work within a step, so where many
    converge (a gully) the change per cell per step is clamped - without
    that, a thousand droplets each take the full height difference and the
    field runs away."""
    t0 = time.time()
    hs = 1.0 / (g.dx * 12.0)
    ny, nx = g.v.shape
    flat = (g.v * hs).ravel().copy()
    rng = np.random.default_rng(seed)
    offs = [(i, j) for j in range(-radius, radius + 1) for i in range(-radius, radius + 1)]
    wts = np.array([max(0.0, radius + 0.5 - math.hypot(i, j)) for i, j in offs])
    wts /= wts.sum()
    oi_ = np.array([o[0] for o in offs])
    oj_ = np.array([o[1] for o in offs])
    mflat = mask.ravel()
    dflat = (mask if dep_mask is None else dep_mask).ravel()
    ncell = flat.size
    done = 0
    report = max(droplets // 6, 1)
    next_report = report
    while done < droplets:
        n = min(batch, droplets - done)
        done += n
        px = rng.uniform(2, nx - 3, n)
        py = rng.uniform(2, ny - 3, n)
        keep = rng.uniform(0, 1, n) < mask[py.astype(int), px.astype(int)] * 0.92 + 0.08
        px, py = px[keep], py[keep]
        n = len(px)
        dxv = np.zeros(n)
        dyv = np.zeros(n)
        vel = np.ones(n)
        water = np.ones(n)
        sed = np.zeros(n)
        alive = np.ones(n, bool)
        for _ in range(steps):
            ix = px.astype(np.int64)
            iy = py.astype(np.int64)
            fx = px - ix
            fy = py - iy
            i00 = iy * nx + ix
            h00, h10, h01, h11 = flat[i00], flat[i00 + 1], flat[i00 + nx], flat[i00 + nx + 1]
            gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy
            gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx
            hh = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy
            dxv = dxv * inertia - gx * (1 - inertia)
            dyv = dyv * inertia - gy * (1 - inertia)
            ln = np.hypot(dxv, dyv)
            zero = ln < 1e-12
            a = rng.uniform(0, 2 * np.pi, n)
            dxv = np.where(zero, np.cos(a), dxv / np.maximum(ln, 1e-12))
            dyv = np.where(zero, np.sin(a), dyv / np.maximum(ln, 1e-12))
            nxp = px + dxv
            nyp = py + dyv
            out = (nxp < 1) | (nxp >= nx - 2) | (nyp < 1) | (nyp >= ny - 2)
            alive &= ~out
            nxp = np.clip(nxp, 1, nx - 2.001)
            nyp = np.clip(nyp, 1, ny - 2.001)
            jx = nxp.astype(np.int64)
            jy = nyp.astype(np.int64)
            gxx = nxp - jx
            gyy = nyp - jy
            j00 = jy * nx + jx
            nh = (flat[j00] * (1 - gxx) * (1 - gyy) + flat[j00 + 1] * gxx * (1 - gyy) +
                  flat[j00 + nx] * (1 - gxx) * gyy + flat[j00 + nx + 1] * gxx * gyy)
            dh = nh - hh
            cap = np.maximum(-dh, min_slope) * vel * water * capacity
            dep_mode = (sed > cap) | (dh > 0)
            amt_dep = np.where(dh > 0, np.minimum(dh, sed), (sed - cap) * deposition)
            amt_dep = np.where(dep_mode & alive, np.maximum(amt_dep, 0.0), 0.0)
            # sediment that reaches the valley floor is carried away by the
            # river: only the slopes' feet may build fans
            sed = sed - amt_dep * (1 - dflat[i00])
            amt_dep = amt_dep * dflat[i00]
            amt_ero = np.where(~dep_mode & alive, np.clip(np.minimum((cap - sed) * erosion, -dh), 0, None), 0.0)
            amt_ero *= mflat[i00]
            sed = sed - amt_dep + amt_ero
            # one scatter for the whole step: deposits (bilinear, at the old
            # position) and the erosion brush around the old cell
            k_dep = np.concatenate([i00, i00 + 1, i00 + nx, i00 + nx + 1])
            w_dep = np.concatenate([amt_dep * (1 - fx) * (1 - fy), amt_dep * fx * (1 - fy),
                                    amt_dep * (1 - fx) * fy, amt_dep * fx * fy])
            kx = np.clip(ix[None, :] + oi_[:, None], 0, nx - 1)
            ky = np.clip(iy[None, :] + oj_[:, None], 0, ny - 1)
            k_ero = (ky * nx + kx).ravel()
            w_ero = (-wts[:, None] * amt_ero[None, :]).ravel()
            change = np.bincount(np.concatenate([k_dep, k_ero]), weights=np.concatenate([w_dep, w_ero]),
                                 minlength=ncell)
            flat += np.clip(change, -max_change, max_change)
            vel = np.minimum(np.sqrt(np.maximum(vel * vel - dh * gravity, 0.0)), max_vel)
            water *= (1 - evaporation)
            px, py = nxp, nyp
            if not alive.any():
                break
        if done >= next_report:
            log(f"  erosion: {done:,} droplets ({time.time() - t0:.0f}s)")
            next_report += report
    g.v = flat.reshape(ny, nx) / hs
    return g


# ---------------------------------------------------------------------------
# Build

class Terrain:
    def __init__(self, coarse, fine, info=None):
        self.coarse = coarse
        self.fine = fine
        self.info = info or {}
        self._rock = None

    def rock_mask(self):
        """Where the mountains are rock (steep and high), on the coarse grid,
        softened: the analytic detail below only lives there."""
        if self._rock is None:
            c = self.coarse
            gy, gx = np.gradient(N.blur(c.v, 1.0), c.dx)
            slope = np.degrees(np.arctan(np.hypot(gx, gy)))
            alt = c.v - L.FLOOR_Z
            X, Y = c.coords()
            # below the treeline only the crags (the forest holds anything
            # gentler than ~45 degrees); above it every slope that sheds its turf
            steep = np.maximum(smoothstep(38.0, 48.0, slope), smoothstep(26.0, 40.0, slope) * smoothstep(280.0, 420.0, alt))
            m = steep * smoothstep(80.0, 160.0, alt) * smoothstep(300.0, 900.0, np.hypot(X, Y))
            self._rock = Grid(c.x0, c.y0, c.dx, c.nx, c.ny, N.blur(m, 1.5))
        return self._rock

    def height(self, x, y, cubic=True, detail=True):
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        zc = self.coarse.sample(x, y, cubic=cubic)
        if self.fine is not None:
            f = self.fine
            zf = f.sample(x, y, cubic=False)
            # blend over the last 60 m inside the fine grid's edges
            m = np.minimum.reduce([x - f.x0, f.x1 - x, y - f.y0, f.y1 - y])
            w = smoothstep(0.0, 60.0, m)
            zc = zc + (zf - zc) * w
        if not detail:
            return zc
        return zc + self.rock_detail(x, y, zc)

    def rock_detail(self, x, y, z):
        """Rock at the scale the scope reads it from 1-3 km, below the 8 m
        grid: bedding (treads and risers every 9-16 m whose spacing and dip
        wander, so cliffs break into ledges that hold turf and snow),
        knobbly ribs, and fine roughness. Analytic, so every mesh, map and
        normal that asks the height gets it at its own resolution."""
        m = self.rock_mask().sample(x, y)
        out = np.zeros(np.shape(x))
        sel = m > 0.02
        if not sel.any():
            return out
        xs, ys, zs, ms = x[sel], y[sel], z[sel], m[sel]
        q = 12.0 + 4.0 * N.fbm(xs, ys, SEED + 51, octaves=2, scale=1 / 700.0)
        t = (zs + 0.012 * xs - 0.008 * ys + 4.0 * N.fbm(xs, ys, SEED + 52, octaves=3, scale=1 / 260.0)) / q
        fr = t - np.floor(t)
        tread = (smoothstep(0.5, 0.95, fr) - fr) * q * 0.7
        ribs = (N.ridged(xs / 34.0, ys / 34.0, SEED + 53, octaves=4, gain=0.5, sharp=2.2) - 0.42) * 7.0
        rough = N.fbm(xs, ys, SEED + 54, octaves=3, scale=1 / 7.0) * 1.2
        out[sel] = ms * (tread + ribs + rough)
        return out

    def save(self, path):
        extra = {k: v for k, v in self.info.items() if isinstance(v, np.ndarray)}
        if getattr(self.fine, 'road_z', None) is not None:
            extra['road_z'] = self.fine.road_z
        np.savez_compressed(path, coarse=self.coarse.v.astype(np.float32), fine=self.fine.v.astype(np.float32), **extra)

    @classmethod
    def load(cls, path):
        d = np.load(path)
        c = Grid(**COARSE, values=d['coarse'].astype(np.float64))
        f = Grid(**FINE, values=d['fine'].astype(np.float64))
        info = {k: d[k] for k in d.files if k not in ('coarse', 'fine')}
        f.road_z = info.get('road_z')
        return cls(c, f, info)


def build_coarse(quick=False):
    t = time.time()
    g = Grid(**COARSE)
    X, Y = g.coords()
    ax = L.valley_axis(step=4.0)
    far = far_side_mask(g, ax)
    z, info = macro(X, Y, ax, far, blur_cells=8.0)
    log(f"macro shape {time.time() - t:.1f}s")
    far = ~info['near']
    z += peaks(X, Y) * far
    cl, cface = great_cliff(X, Y, info['u'], info['bearing'])
    z += cl * far
    z = z + relief(X, Y, info, z) * (1 - 0.8 * cface * far)
    log(f"relief {time.time() - t:.1f}s")
    g.v = z
    # erode the mountains, not the valley floor or the player's spur
    mask = smoothstep(0.0, 150.0, info['u']) * smoothstep(350.0, 800.0, np.hypot(X, Y))
    dep = smoothstep(-30.0, 60.0, info['u']) * smoothstep(350.0, 800.0, np.hypot(X, Y))
    erode(g, mask, dep, droplets=400_000 if quick else 2_400_000, steps=48 if quick else 80)
    spur_fix(g)
    from . import features
    # the river's channel on the coarse grid only where the fine grid will not
    # carve it (the two would leave a coarse trench beside the fine one)
    Xc, Yc = g.coords()
    f = Grid(**FINE)
    outside = ~f.inside(Xc, Yc, margin=-40.0)
    sub = Grid(g.x0, g.y0, g.dx, g.nx, g.ny, g.v.copy())
    features.river_channel(sub, Xc, Yc, L.river(step=2.0))
    g.v = np.where(outside, sub.v, g.v)
    log(f"coarse done {time.time() - t:.1f}s")
    return g, info


EYE_GROUND = -0.35      # the spur's grass under the prone player's eye


def spur_fix(g):
    """Settle the ground under the player at EYE_GROUND: the macro profile
    gets it within metres; this makes it exact, fading out over ~250 m."""
    X, Y = g.coords()
    z0 = g.sample(np.array([0.0]), np.array([0.0]), cubic=True)[0]
    r2 = X * X + Y * Y
    g.v = g.v + (EYE_GROUND - z0) * np.exp(-r2 / 220.0 ** 2)


def build_fine(coarse, quick=False):
    """The fine grid: the coarse height upsampled (bicubic), then the
    designed features (see features.py)."""
    t = time.time()
    f = Grid(**FINE)
    X, Y = f.coords()
    f.v = coarse.sample(X, Y, cubic=True)
    log(f"fine grid upsampled {time.time() - t:.1f}s")
    from . import features
    features.apply(f, quick)
    log(f"fine grid shaped {time.time() - t:.1f}s")
    return f


def build(quick=False):
    coarse, info = build_coarse(quick)
    fine = build_fine(coarse, quick)
    return Terrain(coarse, fine)
