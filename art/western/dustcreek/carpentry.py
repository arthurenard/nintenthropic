"""Carpentry: the frontier building vocabulary, built board by board.

All functions draw into MeshBuilders in a *wall frame*: s runs along the wall
(frame +X), the wall's outer face is the plane y=0 and faces -Y, z is up.
Siding boards stand proud of the wall plane (y < 0); the dark "backing"
(sheathing / the dim interior) sits just behind it so the gaps between
rough-sawn boards read as real gaps instead of holes into the sky.
"""

import math

from mathutils import Vector

from .core import Frame, rng


class Opening:
    """A rough opening in a wall. kind: 'window' | 'door' | 'hole'."""

    def __init__(self, kind, s, z, w, h, **kw):
        self.kind, self.s, self.z, self.w, self.h = kind, s, z, w, h
        self.kw = kw
        self.casing = kw.get('casing', 0.1 if kind != 'hole' else 0.0)

    @property
    def s0(self):
        return self.s - self.w / 2

    @property
    def s1(self):
        return self.s + self.w / 2

    @property
    def z1(self):
        return self.z + self.h

    def clear_rect(self):
        """Region siding must stay out of (rough opening + casing)."""
        c = self.casing
        top = self.z1 + c + (0.05 if self.kind != 'hole' else 0)
        bot = self.z - (c * 0.9 if self.kind == 'window' else 0.0)
        return (self.s0 - c, bot, self.s1 + c, top)


def _intervals(a, b, cuts):
    """[a,b] minus the list of (c0,c1) intervals."""
    res = [(a, b)]
    for c0, c1 in cuts:
        nxt = []
        for x0, x1 in res:
            if c1 <= x0 or c0 >= x1:
                nxt.append((x0, x1))
                continue
            if c0 > x0:
                nxt.append((x0, c0))
            if c1 < x1:
                nxt.append((c1, x1))
        res = nxt
    return [(x0, x1) for x0, x1 in res if x1 - x0 > 0.02]


def _split_lengths(x0, x1, r, max_len=4.8, min_len=0.9):
    """Real boards come in 12-16 ft lengths: split long runs at butt joints."""
    out = []
    x = x0
    while x1 - x > max_len:
        L = r.uniform(max(min_len, max_len * 0.55), max_len)
        if x1 - (x + L) < min_len:
            L = (x1 - x) / 2
        out.append((x, x + L))
        x += L
    out.append((x, x1))
    return out


def top_fn_flat(h):
    return lambda s: h


def siding(mb, f, s0, s1, z0, top, openings, style, mat, r, backing=None, back_mat='backing',
           exposure=None, zmax=None):
    """Clad the wall rectangle [s0,s1] x [z0, top(s)] around openings.

    style:
      'clap'   lapped clapboards, each tilted so its bottom edge casts a line
      'rough'  flat rough-sawn boards with irregular widths and real gaps
      'batten' vertical board-and-batten
    top: callable s -> top height (false fronts, gables).
    """
    rects = [o.clear_rect() for o in openings]
    if zmax is None:
        zmax = max(top(s0), top(s1), top((s0 + s1) / 2))
    if style in ('clap', 'rough'):
        z = z0
        while z < zmax - 0.02:
            if style == 'clap':
                bh = exposure or 0.165
                step = bh
                board_h = bh + 0.03
            else:
                board_h = r.uniform(0.19, 0.3)
                step = board_h + r.uniform(0.004, 0.016)
            zc0, zc1 = z, min(z + board_h, zmax)
            # s-range where the wall is tall enough for this row
            samples = 48
            ok = []
            for i in range(samples + 1):
                s = s0 + (s1 - s0) * i / samples
                ok.append(top(s) >= zc1 - 0.01)
            # contiguous runs where ok
            runs = []
            start = None
            for i, v in enumerate(ok):
                s = s0 + (s1 - s0) * i / samples
                if v and start is None:
                    start = s
                if (not v or i == samples) and start is not None:
                    end = s if not v else s1
                    if not v:
                        end = s0 + (s1 - s0) * (i - 1) / samples
                    runs.append((start, end))
                    start = None
            cuts = [(x0, x1) for (x0, zb, x1, zt) in rects if zb < zc1 and zt > zc0]
            for a, b in runs:
                # refine run ends against a sloped top (gables): shrink until fits
                for x0, x1 in _intervals(a, b, cuts):
                    for bx0, bx1 in _split_lengths(x0, x1, r):
                        rand = r.random()
                        if style == 'clap':
                            tilt = math.atan2(0.018, board_h)
                            sub = f.sub((0, -0.012, zc0)).sub(rot_x=-tilt)
                            mb.box(sub, (bx0, -0.022, 0), (bx1, 0.0, zc1 - zc0), mat, rand=rand,
                                   grain_axis=0, skip=('+y', '+z'), uv_offset=(0, zc0))
                        else:
                            jy = r.uniform(-0.006, 0.006)
                            warp = r.uniform(-0.004, 0.004)
                            sub = f.sub((0, jy, 0)).sub(rot_z=warp * 0.2)
                            mb.box(sub, (bx0, -0.026, zc0), (bx1, 0.0, zc1), mat, rand=rand,
                                   grain_axis=0, skip=('+y',), uv_offset=(0, rand * 3))
            z += step
    elif style == 'batten':
        s = s0
        while s < s1 - 0.02:
            bw = r.uniform(0.24, 0.33)
            sa, sb = s, min(s + bw, s1)
            smid = (sa + sb) / 2
            ztop = min(top(sa), top(sb))
            cuts = [(zb, zt) for (x0, zb, x1, zt) in rects if x0 < sb and x1 > sa]
            rand = r.random()
            for za, zb_ in _intervals(z0, ztop, cuts):
                mb.box(f, (sa + 0.004, -0.024, za), (sb - 0.004, 0.0, zb_), mat, rand=rand,
                       grain_axis=2, skip=('+y',), uv_offset=(smid * 3.1, 0))
            # batten over the joint
            if sb < s1 - 0.05:
                bt = r.random()
                zt2 = min(top(sb - 0.04), top(sb + 0.04))
                cuts_b = [(zb, zt) for (x0, zb, x1, zt) in rects if x0 < sb + 0.04 and x1 > sb - 0.04]
                for za, zb_ in _intervals(z0, zt2, cuts_b):
                    mb.box(f, (sb - 0.032, -0.046, za), (sb + 0.032, -0.022, zb_), mat, rand=bt,
                           grain_axis=2, skip=('+y',), uv_offset=(sb * 5.3, 0))
            s = sb
    if backing is not None:
        backing_panel(backing, f, s0, s1, z0, top, openings, back_mat)


def backing_panel(mb, f, s0, s1, z0, top, openings, mat, y=0.004):
    """The dark wall behind the boards, with holes where the openings are.
    Grid decomposition: split by every opening edge, keep cells not inside
    an opening, then clip their tops to the wall outline."""
    xs = {s0, s1}
    zs = {z0}
    for o in openings:
        xs.update((max(s0, o.s0), min(s1, o.s1)))
        zs.update((o.z, o.z1))
    xs = sorted(x for x in xs if s0 <= x <= s1)
    ztop_max = max(top(s0), top(s1), top((s0 + s1) / 2))
    zs.add(ztop_max)
    zs = sorted(z for z in zs if z0 <= z <= ztop_max)
    for i in range(len(xs) - 1):
        a, b = xs[i], xs[i + 1]
        if b - a < 1e-4:
            continue
        smid = (a + b) / 2
        for j in range(len(zs) - 1):
            c, d = zs[j], zs[j + 1]
            zmid = (c + d) / 2
            inside = any(o.s0 - 1e-4 <= smid <= o.s1 + 1e-4 and o.z - 1e-4 <= zmid <= o.z1 + 1e-4
                         for o in openings)
            if inside:
                continue
            ta, tb = top(a), top(b)
            if c >= max(ta, tb):
                continue
            da, db = min(d, ta), min(d, tb)
            mb.quad(f, [(a, y, c), (b, y, c), (b, y, db), (a, y, da)], mat, rand=0.5)


def trim_board(mb, f, a, b, width, thick, mat, y=-0.03, r=None):
    """A flat trim board in the wall plane from (s,z) a to b."""
    a3 = Vector((a[0], y - thick / 2, a[1]))
    b3 = Vector((b[0], y - thick / 2, b[1]))
    mb.board(f, a3, b3, width, thick, mat, up=(0, -1, 0), rand=(r.random() if r else None),
             skip=())


def casing(mb, f, o, mat, r, sill=True, head_cap=True, depth=0.035, reveal=0.1):
    """Window/door casing: side boards, a head casing with drip cap, and for
    windows a projecting sill with an apron under it."""
    c = o.casing
    y0 = -0.03 - depth
    s0, s1, z0, z1 = o.s0, o.s1, o.z, o.z1
    # jambs (inside the opening): thin boards lining the rough opening
    jd = reveal
    mb.box(f, (s0 - 0.004, -0.03, z0), (s0 + 0.02, jd, z1), mat, rand=r.random(), grain_axis=2,
           skip=())
    mb.box(f, (s1 - 0.02, -0.03, z0), (s1 + 0.004, jd, z1), mat, rand=r.random(), grain_axis=2)
    mb.box(f, (s0, -0.03, z1 - 0.02), (s1, jd, z1 + 0.004), mat, rand=r.random(), grain_axis=0)
    # side casings
    zb = z0 - (0.0 if o.kind == 'door' else 0.03)
    mb.box(f, (s0 - c, y0, zb), (s0, -0.01, z1), mat, rand=r.random(), grain_axis=2, skip=('+y',))
    mb.box(f, (s1, y0, zb), (s1 + c, -0.01, z1), mat, rand=r.random(), grain_axis=2, skip=('+y',))
    # head casing, slightly wider, with drip cap
    hc = c * 1.35
    mb.box(f, (s0 - c - 0.03, y0 - 0.005, z1), (s1 + c + 0.03, -0.01, z1 + hc), mat,
           rand=r.random(), grain_axis=0, skip=('+y',))
    if head_cap:
        mb.box(f, (s0 - c - 0.06, y0 - 0.045, z1 + hc), (s1 + c + 0.06, -0.01, z1 + hc + 0.035), mat,
               rand=r.random(), grain_axis=0, skip=('+y',))
    if o.kind == 'window' and sill:
        mb.box(f, (s0 - c - 0.05, y0 - 0.055, z0 - 0.05), (s1 + c + 0.05, 0.02, z0), mat,
               rand=r.random(), grain_axis=0)
        mb.box(f, (s0 - c + 0.02, y0 + 0.005, z0 - 0.05 - c * 0.9), (s1 + c - 0.02, -0.01, z0 - 0.05),
               mat, rand=r.random(), grain_axis=0, skip=('+y',))
    else:
        # threshold
        mb.box(f, (s0, -0.06, z0 - 0.01), (s1, jd, z0 + 0.025), mat, rand=r.random(), grain_axis=0)


def sash(mb, f, o, mat, cols, rows, set_back=0.07, bar=0.045, muntin=0.022, double_hung=True, r=None):
    """Window sash(es) with muntins; returns the glass rectangles
    [(s0,z0,s1,z1,y)] so the caller can make `glass.<id>` panes."""
    glass = []
    s0, s1, z0, z1 = o.s0 + 0.02, o.s1 - 0.02, o.z + 0.01, o.z1 - 0.02
    parts = [(z0, (z0 + z1) / 2 + 0.02, set_back), ((z0 + z1) / 2 - 0.02, z1, set_back - 0.04)] \
        if double_hung else [(z0, z1, set_back)]
    for (za, zb, yb) in parts:
        d = 0.04
        mb.box(f, (s0, yb - d / 2, za), (s0 + bar, yb + d / 2, zb), mat, rand=r.random(), grain_axis=2)
        mb.box(f, (s1 - bar, yb - d / 2, za), (s1, yb + d / 2, zb), mat, rand=r.random(), grain_axis=2)
        mb.box(f, (s0 + bar, yb - d / 2, za), (s1 - bar, yb + d / 2, za + bar * 1.3), mat,
               rand=r.random(), grain_axis=0)
        mb.box(f, (s0 + bar, yb - d / 2, zb - bar), (s1 - bar, yb + d / 2, zb), mat,
               rand=r.random(), grain_axis=0)
        ia, ib = s0 + bar, s1 - bar
        ja, jb = za + bar * 1.3, zb - bar
        prow = rows if not double_hung else max(1, rows // 2)
        for ci in range(1, cols):
            s = ia + (ib - ia) * ci / cols
            mb.box(f, (s - muntin / 2, yb - d / 2 + 0.006, ja), (s + muntin / 2, yb + d / 2 - 0.006, jb), mat,
                   rand=r.random(), grain_axis=2)
        for ri in range(1, prow):
            z = ja + (jb - ja) * ri / prow
            mb.box(f, (ia, yb - d / 2 + 0.006, z - muntin / 2), (ib, yb + d / 2 - 0.006, z + muntin / 2), mat,
                   rand=r.random(), grain_axis=0)
        glass.append((ia, ja, ib, jb, yb + 0.004))
    return glass


def panel_door(mb, f, s0, s1, z0, z1, mat, r, hinge='left', open_deg=0.0, y=0.05, thick=0.045,
               panels=(2, 2), glass=False):
    """A four-panel door. Built closed in its own frame around the hinge,
    then swung `open_deg` inward. Returns the hinge frame and glass rect."""
    w = s1 - s0
    hs = s0 if hinge == 'left' else s1
    sign = 1 if hinge == 'left' else -1
    hf = f.sub((hs, y, z0)).sub(rot_z=math.radians(open_deg) * sign)
    # leaf in hinge frame: x from 0..w*sign
    def bx(a, b, c, d, t0=-thick / 2, t1=thick / 2, ga=2):
        xa, xb = sorted((a * sign, b * sign))
        mb.box(hf, (xa, t0, c), (xb, t1, d), mat, rand=r.random(), grain_axis=ga)
    st = 0.11
    h = z1 - z0
    bx(0, st, 0, h)
    bx(w - st, w, 0, h)
    bx(st, w - st, 0, 0.2, ga=0)
    bx(st, w - st, h - 0.14, h, ga=0)
    bx(st, w - st, h * 0.5 - 0.07, h * 0.5 + 0.07, ga=0)
    bx(w / 2 - 0.05, w / 2 + 0.05, 0.2, h - 0.14)
    # recessed panels
    for (za, zb) in ((0.2, h * 0.5 - 0.07), (h * 0.5 + 0.07, h - 0.14)):
        if glass and za > h * 0.4:
            continue
        for (xa, xb) in ((st, w / 2 - 0.05), (w / 2 + 0.05, w - st)):
            bx(xa, xb, za, zb, t0=-thick / 4, t1=thick / 4)
            # raised field
            bx(xa + 0.05, xb - 0.05, za + 0.05, zb - 0.05, t0=-thick / 3, t1=thick / 3)
    return hf


def batwing(mb, f, s, z0, z1, w, mat, r, hinge='left', open_deg=0.0, y=-0.02):
    """One saloon batwing leaf: frame with louvres, hinge at its outer edge."""
    sign = 1 if hinge == 'left' else -1
    hf = f.sub((s, y, z0)).sub(rot_z=math.radians(open_deg) * sign)
    h = z1 - z0
    t = 0.035

    def bx(a, b, c, d, t0=-t / 2, t1=t / 2, ga=2):
        xa, xb = sorted((a * sign, b * sign))
        mb.box(hf, (xa, t0, c), (xb, t1, d), mat, rand=r.random(), grain_axis=ga)
    bx(0, 0.07, 0, h)
    bx(w - 0.07, w, 0, h * 0.86)
    bx(0.07, w - 0.07, 0, 0.1, ga=0)
    bx(0.07, w - 0.07, h * 0.45, h * 0.45 + 0.07, ga=0)
    # scalloped top approximated by a stepped rail
    bx(0.07, w - 0.07, h * 0.8, h * 0.86, ga=0)
    bx(0.07, w * 0.5, h * 0.86, h * 0.92, ga=0)
    n = 6
    for i in range(n):
        z = 0.14 + (h * 0.45 - 0.2) * i / (n - 1)
        bx(0.07, w - 0.07, z, z + 0.05, t0=-t / 3, t1=t / 3, ga=0)
    # spindles in the upper half
    for i in range(4):
        x = 0.07 + (w - 0.14) * (i + 0.5) / 4
        bx(x - 0.012, x + 0.012, h * 0.45 + 0.07, h * 0.8, t0=-0.01, t1=0.01)
    return hf


def post(mb, f, x, y, z0, z1, mat, r, size=0.12, chamfer=True):
    mb.box(f, (x - size / 2, y - size / 2, z0), (x + size / 2, y + size / 2, z1), mat, rand=r.random(),
           grain_axis=2)


def railing(mb, f, s0, s1, y, z0, height, mat, r, baluster=0.11, rail=0.07, spindle=0.035,
            posts_every=2.4):
    """A balcony / porch railing along s at wall-frame y."""
    # posts
    n = max(1, int(round((s1 - s0) / posts_every)))
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        post(mb, f, s, y, z0, z0 + height + 0.06, mat, r, size=baluster)
    mb.box(f, (s0, y - rail / 2 - 0.01, z0 + height - 0.05), (s1, y + rail / 2 + 0.01, z0 + height),
           mat, rand=r.random(), grain_axis=0)
    mb.box(f, (s0, y - rail / 2, z0 + 0.08), (s1, y + rail / 2, z0 + 0.14), mat, rand=r.random(),
           grain_axis=0)
    k = int((s1 - s0) / 0.14)
    for i in range(1, k):
        s = s0 + (s1 - s0) * i / k
        mb.box(f, (s - spindle / 2, y - spindle / 2, z0 + 0.14), (s + spindle / 2, y + spindle / 2,
               z0 + height - 0.05), mat, rand=r.random(), grain_axis=2, skip=('+z', '-z'))


def gable_roof(mb, f, s0, s1, y0, y1, eave, pitch_deg, mat, r, overhang=0.35, style='tin',
               fascia_mat=None, ridge_cap=True):
    """Gable roof with the ridge along frame Y (front to back), as false-front
    buildings have it. Returns ridge height."""
    w = s1 - s0
    sm = (s0 + s1) / 2
    rise = (w / 2) * math.tan(math.radians(pitch_deg))
    ridge = eave + rise
    slope_len = math.hypot(w / 2 + overhang, rise + overhang * math.tan(math.radians(pitch_deg)))
    for side in (-1, 1):
        # slope frame: origin at ridge, x down-slope toward the eave on this side
        ang = math.radians(pitch_deg)
        ex = side
        edge = Vector((sm + side * (w / 2 + overhang), 0, eave - overhang * math.tan(ang)))
        top = Vector((sm, 0, ridge))
        d = (edge - top)
        L = d.length
        sf = f.sub((sm, 0, ridge)).sub(rot_z=0 if side > 0 else math.pi)
        tilt = math.atan2(-d.z, abs(d.x))
        sf = sf.sub(rot_y=tilt)
        ya, yb = (y0, y1 + overhang) if side > 0 else (-(y1 + overhang), -y0)
        if style == 'tin':
            # sheets: 0.8 m wide strips running down-slope, each lapped
            y = ya
            while y < yb - 0.01:
                wsheet = min(0.8, yb - y)
                mb.box(sf, (0, y, 0.0), (L, y + wsheet + 0.03, 0.018), mat, rand=r.random(), grain_axis=0,
                       skip=('-z',))
                y += wsheet
            mb.box(sf, (0, ya, -0.03), (L, yb, 0.0), 'wood_dark',
                   rand=0.5, grain_axis=1, skip=('+z',))
        else:
            # shingle courses: one proud strip per course, the texture
            # draws the individual shingles
            expo = 0.16
            n = int(L / expo) + 1
            for i in range(n):
                xa = L - (i + 1) * expo
                xb = L - i * expo + 0.04
                xa = max(xa, 0)
                lift = 0.012 * ((i % 2) + 1)
                sub = sf.sub((0, 0, 0)).sub(rot_y=-0.06)
                mb.box(sf.sub((xa, 0, 0)).sub(rot_y=-math.atan2(0.02, expo)), (0, ya, 0.0),
                       (xb - xa, yb, 0.022 + lift * 0.3), mat, rand=r.random(), grain_axis=1,
                       uv_offset=(0, i * 0.37))
            mb.box(sf, (0, ya, -0.03), (L, yb, 0.0), 'wood_dark', rand=0.5, grain_axis=1, skip=('+z',))
        # fascia along the eave
        fm = fascia_mat or 'trim_dark'
        ef = f.sub((sm + side * (w / 2 + overhang), 0, eave - overhang * math.tan(ang)))
        mb.box(ef, (-0.03 if side > 0 else -0.0, y0, -0.2), (0.0 if side > 0 else 0.03, y1 + overhang, 0.0),
               fm, rand=r.random(), grain_axis=1)
    if ridge_cap:
        mb.box(f, (sm - 0.12, y0, ridge - 0.02), (sm + 0.12, y1 + overhang, ridge + 0.05),
               mat if style == 'tin' else mat, rand=r.random(), grain_axis=1)
    return ridge


def shed_roof(mb, f, s0, s1, y_high, y_low, z_high, z_low, mat, r, style='tin', thick=0.02):
    """Porch/awning roof: slopes from the wall (y_high, z_high) down to the
    street edge (y_low, z_low). Frame Y is 'outward' negative."""
    a = Vector((0, y_high, z_high))
    b = Vector((0, y_low, z_low))
    d = b - a
    L = d.length
    ang = math.atan2(d.z, -d.y)  # descending outward
    sf = f.sub((0, y_high, z_high)).sub(rot_x=-ang)
    # in sf: -Y is outward/down-slope, length L
    if style == 'tin':
        s = s0
        while s < s1 - 0.01:
            ws = min(0.8, s1 - s)
            mb.box(sf, (s, -L, 0), (s + ws + 0.03, 0, thick), mat, rand=r.random(), grain_axis=1,
                   skip=('-z',))
            s += ws
        mb.box(sf, (s0, -L, -0.025), (s1, 0, 0), 'wood_dark', rand=0.3, grain_axis=0, skip=('+z',))
    else:
        mb.box(sf, (s0, -L, 0), (s1, 0, 0.03), mat, rand=r.random(), grain_axis=0)
    return sf, L
