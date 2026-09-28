"""Human-scale shaping of the valley on the fine (1 m) grid.

Everything the game's targets stand on or next to is designed here rather
than left to noise: the river's channel and banks, the road's bench with
its camber, shoulders and cut-and-fill slopes, the farm lane and the
switchbacks, level pads under every building, the dam's gorge and its
abutments, the goat's crag, the village's alluvial fan, and the spur's crest
under the player. Order matters: noise first, then the channel, then roads
and pads, so what must be flat ends flat.
"""

import math
import time

import numpy as np

from . import layout as L
from . import noise as N
from .noise import smoothstep

SEED = 5521


def log(*a):
    print("[features]", *a, flush=True)


def fine_noise(g, X, Y, calm):
    """Metre-scale ground: hummocks on the meadows, a rougher skin on slopes
    (but not along the river and the roads, where `calm` is 1)."""
    z = g.v
    gy, gx = np.gradient(z, g.dx)
    slope = np.hypot(gx, gy) * (1 - calm)
    a = N.fbm(X, Y, SEED + 1, octaves=4, scale=1 / 22.0) * 0.30
    b = N.fbm(X, Y, SEED + 2, octaves=3, scale=1 / 6.0) * 0.10
    wx, wy = N.warp(X, Y, SEED + 4, 25.0, 1 / 60.0)
    c = (N.ridged(wx / 55.0, wy / 55.0, SEED + 3, octaves=3, gain=0.45) - 0.35) * 1.0 * smoothstep(0.35, 0.9, slope)
    g.v = z + (a + b) * (1 + 1.5 * smoothstep(0.2, 0.6, slope)) + c


def fan(g, X, Y):
    """The alluvial fan the village stands on: a low cone spreading from the
    mouth of a side gully at the far slope's foot toward the river."""
    apex = L.polar(3.0, 650)[:2]
    toward = np.array([0.0, 0.0]) - apex
    toward /= np.linalg.norm(toward)
    dx, dy = X - apex[0], Y - apex[1]
    r = np.hypot(dx, dy)
    along = (dx * toward[0] + dy * toward[1]) / np.maximum(r, 1e-6)
    spread = smoothstep(-0.2, 0.5, along)                       # a 120-degree cone downhill
    h = 9.0 * np.clip(1 - r / 230.0, 0, None) ** 1.3 * spread
    g.v = g.v + h


def goat_crag(g, X, Y):
    """A limestone buttress standing out of the far slope's foot: a steep face
    toward the player (60-70 m, broken by ragged ledges - the goat's
    impossible perches), its top running back into the mountainside."""
    c = L.GOAT_CRAG_C
    r0 = float(np.linalg.norm(c))
    u = c / r0                                   # away from the player
    v = np.array([u[1], -u[0]])                  # across
    dx, dy = X - c[0], Y - c[1]
    near = np.hypot(dx, dy) < 180
    if not near.any():
        return
    xs, ys = X[near], Y[near]
    al = dx[near] * u[0] + dy[near] * u[1]       # + into the mountain
    ac = dx[near] * v[0] + dy[near] * v[1]
    wob = N.fbm(ac / 30.0, 0.0, SEED + 12, octaves=3)
    front = -18.0 + 10.0 * wob                    # where the face stands
    half = 32.0 * (1 + 0.25 * N.fbm(al / 40.0, 3.0, SEED + 15, octaves=2))
    lat = smoothstep(half, half * 0.55, np.abs(ac))
    face = smoothstep(front - 3.0, front + 9.0, al)         # the steep face
    back = smoothstep(150.0, 40.0, al)                        # merging into the slope
    H = 62.0 + 10.0 * N.fbm(xs, ys, SEED + 13, octaves=3, scale=1 / 30.0)
    h = H * lat * face * back
    # ragged ledges across the face: soft terraces with wandering spacing
    q = 8.5 + 3.0 * N.fbm(xs, ys, SEED + 14, octaves=2, scale=1 / 40.0)
    frac = (h / q) % 1.0
    onface = smoothstep(front + 12.0, front + 2.0, al) * (h > 4)
    h = h - q * 0.45 * smoothstep(0.5, 0.95, frac) * onface
    h += N.ridged(xs / 6.0, ys / 6.0, SEED + 11, octaves=4) * 2.2 * (h > 2)
    g.v[near] = np.maximum(g.v[near], g.v[near] + h)


def river_channel(g, X, Y, riv):
    """The channel, its two banks drawn separately (layout._river_shape):
    a bed ~1.5-2 m under the water, deepest toward the outside of a bend;
    on the inside a gravel bar rising gently out of the water; on the
    outside an undercut earth scarp; elsewhere a grassy bank a metre or two
    high. The floodplain is never lower than the bank top near the river,
    so no water can leak onto it."""
    d, s, side = riv.nearest(X, Y, max_dist=70.0)
    m = np.isfinite(d) & (d < 70)
    if not m.any():
        return
    sm, dd = s[m], d[m]
    zw = riv.at(sm, 'z')
    hw, bar, und = L.river_edges(riv, sm, side[m])
    w = riv.at(sm, 'w')
    nz = N.fbm(X[m], Y[m], SEED + 21, octaves=3, scale=1 / 35.0)
    depth = (1.1 + 0.03 * w) * (1 + 0.35 * und)
    u = dd / np.maximum(hw, 1.0)
    bed = zw - 0.3 - (depth - 0.3) * np.clip(1 - u * u, 0, 1) ** 0.6
    # the bar: from the water's edge out over `bar` metres, from 15 cm under
    # the water to 45 cm over it, lumpy
    tb = np.clip((dd - hw) / np.maximum(bar, 0.5), 0, 1)
    bar_z = zw - 0.15 + 0.6 * tb + 0.12 * nz
    # the bank beyond (the bar's end or the water's edge): steep where the
    # river undercuts it, gentle and low where it lays down a bar
    has_bar = np.clip(bar / 3.0, 0, 1)
    bank_h = (1.05 + 0.45 * nz) * (1 - 0.6 * has_bar) + 0.5 * und
    bank_w = 3.5 * (1 - 0.8 * und) + 2.0 * has_bar
    edge = hw + bar
    tk = np.clip((dd - edge) / np.maximum(bank_w, 0.4), 0, 1)
    start = np.where(bar > 0.5, zw + 0.45, zw - 0.3)
    bank = start + (zw + bank_h - start) * (tk * tk * (3 - 2 * tk))
    target = np.where(dd < hw, bed, np.where(dd < edge, np.maximum(bar_z, bed), bank))
    z = g.v[m]
    # inside the channel: carve; on the banks: carve down to the bank or
    # fill up to it, fading back to the land over 30 m
    fade = smoothstep(edge + bank_w + 25.0, edge + bank_w, dd)
    new = np.where(dd < edge + bank_w, target, z + (np.maximum(z, zw + bank_h) - z) * fade)
    g.v[m] = new


def bench(g, X, Y, curve, zkey='z', margin=30.0, cut_tan=0.9, fill_tan=0.6, camber=0.07, shoulder=1.0,
          skip=None, z_of=None):
    """A road bench: level across (a slight camber), `shoulder` metres of
    verge, then cut and fill slopes blending back into the land. Heights
    along the road come from the curve (`zkey`) or `z_of(s, zland)`."""
    d, s, _ = curve.nearest(X, Y, max_dist=margin + 8.0)
    m = np.isfinite(d)
    if skip is not None:
        m &= ~skip(s)
    if not m.any():
        return
    w = curve.at(s[m], 'w')
    zl = g.v[m]
    zr = curve.at(s[m], zkey) if z_of is None else z_of(s[m], zl)
    dd = d[m]
    half = w / 2
    crown = zr + camber * np.clip(1 - (dd / half) ** 2, 0, 1)
    t = dd - half - shoulder
    dz = zl - zr
    tan = np.where(dz > 0, cut_tan, fill_tan)
    reach = np.abs(dz) / tan + 0.5
    k = np.clip(t / np.maximum(reach, 0.1), 0, 1)
    k = k * k * (3 - 2 * k)
    slope_z = zr - 0.04 + dz * k
    new = np.where(dd <= half, crown, np.where(t <= 0, zr - 0.04, slope_z))
    # outside the reach the land is untouched
    g.v[m] = np.where(t > reach, zl, new)


def road_profile(g, rd):
    """The road's height along its length: the land under it smoothed over
    ~60 m (a road follows the ground, not its bumps), held to the design
    around the bridge (the deck's hump and its approaches) and ramped onto
    the dam's crest at its end, with the grade kept under 10%."""
    xy = rd.xy
    zl = g.sample(xy[:, 0], xy[:, 1])
    k = 30
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    z = np.convolve(np.pad(zl, k, mode='edge'), ker, mode='valid')
    zdesign = rd['z']
    bs = rd.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    half = L.BRIDGE_LEN / 2
    wb = smoothstep(half + 90.0, half, np.abs(rd.s - bs))
    z = z + (zdesign - z) * wb
    ramp = smoothstep(140.0, 10.0, rd.length - rd.s)
    z = z + (L.DAM_CREST_Z - z) * ramp
    ds = rd.s[1] - rd.s[0]
    span = np.abs(rd.s - bs) <= half
    for _ in range(2):
        for i in range(1, len(z)):
            z[i] = np.clip(z[i], z[i - 1] - 0.10 * ds, z[i - 1] + 0.10 * ds)
        for i in range(len(z) - 2, -1, -1):
            z[i] = np.clip(z[i], z[i + 1] - 0.10 * ds, z[i + 1] + 0.10 * ds)
        z[span] = zdesign[span]
    return z


def pad(g, X, Y, c, w, d, rot, z=None, margin=6.0, mode='level'):
    """Level a rectangle (w across, d deep, rotated) to z (default: the land's
    mean there) and blend back over `margin` metres."""
    ca, sa = math.cos(rot), math.sin(rot)
    lo = np.array(c) - (w + d) - margin
    hi = np.array(c) + (w + d) + margin
    i0 = max(int((lo[0] - g.x0) / g.dx), 0)
    i1 = min(int((hi[0] - g.x0) / g.dx) + 1, g.nx)
    j0 = max(int((lo[1] - g.y0) / g.dx), 0)
    j1 = min(int((hi[1] - g.y0) / g.dx) + 1, g.ny)
    if i1 <= i0 or j1 <= j0:
        return None
    xs, ys = X[j0:j1, i0:i1], Y[j0:j1, i0:i1]
    lx = (xs - c[0]) * ca + (ys - c[1]) * sa
    ly = -(xs - c[0]) * sa + (ys - c[1]) * ca
    ex = np.clip(np.abs(lx) - w / 2, 0, None)
    ey = np.clip(np.abs(ly) - d / 2, 0, None)
    e = np.hypot(ex, ey)
    sub = g.v[j0:j1, i0:i1]
    inside = e <= 0
    if z is None:
        z = float(np.mean(sub[inside])) if inside.any() else float(np.mean(sub))
    k = smoothstep(margin, 0.0, e)
    g.v[j0:j1, i0:i1] = sub + (z - sub) * k
    return z


def dam_gorge(g, X, Y):
    """The gorge the dam closes: a floor at the river, walls rising at ~50
    degrees, and rock abutments above the crest either side (so the arch
    bears on rock and the tunnel has a face to enter), all local: the land
    is only cut down in the gorge and only built up right at the dam's ends.
    In the dam's frame: a along the crest (far bank negative), b upstream."""
    c = L.DAM_CREST_C
    dx, dy = X - c[0], Y - c[1]
    a = dx * L.DAM_AXIS[0] + dy * L.DAM_AXIS[1]
    b = dx * L.DAM_UP[0] + dy * L.DAM_UP[1]
    region = (np.abs(a) < 200) & (b > -220) & (b < 120)
    if not region.any():
        return
    A = a[region]
    B = b[region]
    xs, ys = X[region], Y[region]
    rough = N.fbm(xs, ys, SEED + 31, octaves=5, scale=1 / 14.0) * 2.5
    wall = L.DAM_BASE_Z + np.clip(np.abs(A) - 14.0, 0, None) * (1.15 + 0.2 * N.fbm(xs, ys, SEED + 32, 2, scale=1 / 60.0)) + rough
    z = g.v[region]
    # cut the gorge along its length (downstream of the crest it widens into the valley)
    along = smoothstep(-220.0, -120.0, B) * smoothstep(60.0, 10.0, B)
    cut = np.minimum(z, wall)
    z1 = z + (cut - z) * along
    # the abutments: rock at least 8 m above the crest for 30 m beyond each end
    abut = (L.DAM_CREST_Z + 8.0 + rough) * 1.0
    k = smoothstep(58.0, 72.0, np.abs(A)) * smoothstep(125.0, 95.0, np.abs(A)) * smoothstep(45.0, 20.0, np.abs(B + 5.0))
    k = np.maximum(k, smoothstep(60.0, 75.0, np.abs(A)) * smoothstep(-50.0, -20.0, B) * smoothstep(40.0, 15.0, B)
                   * smoothstep(160.0, 110.0, np.abs(A)))
    z2 = np.maximum(z1, z1 + (abut - z1) * k)
    g.v[region] = z2


def spur(g, X, Y):
    """The crest the player lies on: the grass under him level, the ground in
    front of the scope falling away at ~30 degrees for the first few metres
    so it frames the view without blocking it."""
    r = np.hypot(X, Y)
    m = r < 60
    xs, ys = X[m], Y[m]
    z = g.v[m]
    front = smoothstep(-1.0, 2.0, ys) * smoothstep(9.0, 3.0, np.abs(xs))
    drop = -0.35 - 0.58 * np.clip(ys - 0.4, 0, None)
    under = smoothstep(4.0, 1.0, np.hypot(xs, np.clip(ys, None, 0) * 0.5)) * smoothstep(1.2, 0.3, ys)
    z2 = np.where(front > 0, np.minimum(z, z + (drop - z) * front * smoothstep(12.0, 6.0, ys)), z)
    z2 = z2 + (-0.35 - z2) * under
    g.v[m] = z2


def apply(g, quick=False):
    t = time.time()
    X, Y = g.coords()
    riv = L.river()
    rd = L.road()
    dr, _, _ = riv.nearest(X, Y, max_dist=45.0)
    dd, _, _ = rd.nearest(X, Y, max_dist=30.0)
    calm = np.maximum(smoothstep(45.0, 25.0, np.where(np.isfinite(dr), dr, 1e9)),
                      smoothstep(30.0, 12.0, np.where(np.isfinite(dd), dd, 1e9)))
    fine_noise(g, X, Y, calm)
    fan(g, X, Y)
    goat_crag(g, X, Y)
    log(f"noise, fan, crag {time.time() - t:.1f}s")
    river_channel(g, X, Y, riv)
    log(f"river {time.time() - t:.1f}s")
    # the road's heights come from the land (pinned at the bridge and dam)
    rd.values['z'] = road_profile(g, rd)
    g.road_z = rd.values['z'].copy()
    bs = rd.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    span = lambda s: np.abs(s - bs) < L.BRIDGE_LEN / 2 - 3.0
    bench(g, X, Y, rd, skip=span)
    log(f"road {time.time() - t:.1f}s")
    lane = L.farm_lane()
    bench(g, X, Y, lane, z_of=lambda s, zl: _smooth_profile(lane, g, s), margin=16.0, camber=0.03)
    sw = L.switchbacks()
    bench(g, X, Y, sw, z_of=lambda s, zl: _smooth_profile(sw, g, s), margin=18.0, camber=0.03)
    dam_gorge(g, X, Y)
    dm = L.dam_road()
    bench(g, X, Y, dm, margin=20.0, camber=0.0, cut_tan=3.0)
    log(f"lanes, gorge {time.time() - t:.1f}s")
    # pads: checkpoint, farmyard, alp, village
    pad(g, X, Y, L.CHECKPOINT_C, 16.0, 34.0, math.atan2(*_road_dir(rd, L.CHECKPOINT_C)), z=None, margin=5.0)
    pad(g, X, Y, L.FARM_C, 46.0, 30.0, math.radians(-29.0 + 90), margin=10.0)
    pad(g, X, Y, L.ALP_C, 30.0, 18.0, math.radians(8.0), margin=10.0)
    for h in L.village_plan():
        if h['kind'] == 'square':
            pad(g, X, Y, h['c'], h['w'], h['d'], h['rot'], margin=6.0)
        else:
            pad(g, X, Y, h['c'], h['w'] + 1.0, h['d'] + 1.0, h['rot'], margin=4.0)
    # the road again over the pads, so the street stays the street
    bench(g, X, Y, rd, skip=span)
    spur(g, X, Y)
    log(f"pads, spur {time.time() - t:.1f}s")


def _road_dir(rd, c):
    s = rd.nearest(np.array([c[0]]), np.array([c[1]]))[1][0]
    t = rd.tan[min(int(s), len(rd.tan) - 1)]
    return t[0], t[1]


def _smooth_profile(curve, g, s):
    """A lane's height: the land along its centreline, smoothed over 40 m
    (lanes follow the ground but not its every bump)."""
    key = f"_prof_{id(g)}"
    if key not in curve.values:
        zl = g.sample(curve.xy[:, 0], curve.xy[:, 1])
        k = 40
        pad_ = np.pad(zl, k, mode='edge')
        ker = np.ones(2 * k + 1) / (2 * k + 1)
        curve.values[key] = np.convolve(pad_, ker, mode='valid')
    return curve.at(s, key)
