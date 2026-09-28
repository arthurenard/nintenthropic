"""Building and road materials, made like the ground tiles (tiles.py): small
periodic 3D scenes rendered straight down. The tile plane is the wall or
roof face, its +Y up the wall / up the roof's slope / along the road.

    rubble     the houses' and barns' rubble masonry: stones in rough courses
    ashlar     dressed granite: the bridge's arch rings, quoins, the tower
    plaster    weathered lime plaster
    boards     vertical larch boards, sun-darkened (barns, balconies, tower)
    slabs      a stone-slab roof (piode) of overlapping gneiss slabs
    shingles   wooden shingles, silver-grey
    concrete   the dam's board-formed concrete
    paint      painted steel (railings, barrier, the siren)
    sandbag    jute sandbags in a bond
    road       the gravel road with two wheel tracks (u spans its width)
    setts      granite setts (the bridge's deck, the village street)
    timber     adzed beams
"""

import numpy as np

from .tiles import Parts, heightfield_mesh, pnoise, rock_blob, srgb


_CUBE = None


def block(rng, size, power=4.0, rough=0.1, res=6):
    """A dressed or rough stone: a superellipsoid (power 2 = an egg, 8 = a
    sharp block) roughened by noise, centred at the origin; `size` is its
    half-extent (x, y, z). Returns (V, F)."""
    global _CUBE
    if _CUBE is None:
        # a cube's surface as a grid of res x res quads per face
        V, F = [], []
        t = np.linspace(-1, 1, res + 1)
        for axis in range(3):
            for sgn in (-1, 1):
                A, B = np.meshgrid(t, t)
                P = np.zeros((res + 1, res + 1, 3))
                P[..., axis] = sgn
                P[..., (axis + 1) % 3] = A
                P[..., (axis + 2) % 3] = B
                base = sum(len(v) for v in V)
                V.append(P.reshape(-1, 3))
                idx = np.arange((res + 1) ** 2).reshape(res + 1, res + 1) + base
                a_, b_, c_, d_ = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
                q = np.stack([a_, b_, c_, d_], 1)
                if sgn < 0:
                    q = q[:, ::-1]
                F.append(np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]]))
        _CUBE = (np.vstack(V), np.vstack(F))
    V, F = _CUBE
    d = V / np.linalg.norm(V, axis=1, keepdims=True)
    # superellipsoid radius along each direction
    r = (np.abs(d[:, 0]) ** power + np.abs(d[:, 1]) ** power + np.abs(d[:, 2]) ** power) ** (-1.0 / power)
    P = d * r[:, None]
    ph = rng.uniform(0, 50, 3)
    n = np.sin(P[:, 0] * 4.1 + ph[0]) * np.sin(P[:, 1] * 3.7 + ph[1]) * np.sin(P[:, 2] * 4.3 + ph[2])
    n += 0.5 * np.sin(P[:, 0] * 9.3 + ph[1]) * np.sin(P[:, 1] * 8.1 + ph[2])
    P = P * (1 + rough * n)[:, None]
    return P * np.asarray(size), F


def _row(rng, S_, lo, hi, gap):
    """Lengths along a row that close exactly on the tile (it wraps): (start,
    length) pairs from a random offset."""
    L = []
    while sum(L) + gap * len(L) < S_:
        L.append(rng.uniform(lo, hi))
    k = (S_ - gap * len(L)) / sum(L)
    x = rng.uniform(0, S_)
    out = []
    for l_ in L:
        out.append((x, l_ * k))
        x += l_ * k + gap
    return out


def _stone_course_wall(p, S_, rng, course=(0.18, 0.34), length=(0.22, 0.62), gap=0.035, relief=0.05,
                       tints=None, mortar=(170, 162, 148), sub=2, power=3.0, rough=0.18):
    """Stones laid in rough courses on a bed of mortar (the wall face)."""
    heightfield_mesh(p, S_, 128, lambda x, y: 0.004 * pnoise(x / S_ * 12, y / S_ * 12, 12, 101) - 0.02,
                     lambda x, y, z: srgb(*mortar)[None] * (0.85 + 0.25 * pnoise(x / S_ * 9, y / S_ * 9, 9, 102))[:, None],
                     lambda x, y, z: np.full(len(x), 0.95))
    tints = tints or [[128, 124, 116], [110, 106, 100], [146, 138, 124], [96, 94, 90], [134, 120, 100], [150, 148, 142]]
    heights = []
    y = 0.0
    while y < S_ - 0.1:
        h = rng.uniform(*course)
        heights.append(h)
        y += h
    k = S_ / sum(heights)
    y = 0.0
    for h in heights:
        h *= k
        for x, L_ in _row(rng, S_, length[0], length[1], gap):
            cx = (x + L_ / 2) % S_
            cy = y + h / 2 + rng.uniform(-0.015, 0.015)
            V, F = block(rng, (L_ / 2, (h - gap) / 2, relief * rng.uniform(0.6, 1.3)), power=power, rough=rough)
            V[:, 2] = np.clip(V[:, 2], -0.01, None)
            # a slight tilt: no stone sits quite square in a rubble wall
            a = rng.uniform(-0.06, 0.06) * (power < 6)
            V[:, :2] = V[:, :2] @ np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]]).T
            V += np.array([cx, cy, 0.0])
            c = srgb(*tints[rng.integers(len(tints))]) * rng.uniform(0.85, 1.12)
            p.add(V, F, c, 0.85)
        y += h


def scene_rubble(S_, rng):
    p = Parts()
    _stone_course_wall(p, S_, rng, course=(0.16, 0.36), length=(0.2, 0.65), gap=0.022, relief=0.06, power=3.2, rough=0.2)
    return p, 0.5


def scene_ashlar(S_, rng):
    p = Parts()
    _stone_course_wall(p, S_, rng, course=(0.34, 0.40), length=(0.5, 0.9), gap=0.010, relief=0.03,
                       tints=[[156, 152, 144], [142, 138, 132], [166, 160, 150], [136, 134, 130]], mortar=(150, 146, 138),
                       power=9.0, rough=0.02)
    return p, 0.5


def scene_plaster(S_, rng):
    p = Parts()

    def h(x, y):
        u, v = x / S_, y / S_
        fall = np.clip(pnoise(u * 3, v * 3, 3, 111) * 3 - 1.5, 0, 1)
        return 0.004 * pnoise(u * 30, v * 30, 30, 112) + 0.002 * pnoise(u * 90, v * 90, 90, 113) - 0.02 * fall

    def col(x, y, z):
        u, v = x / S_, y / S_
        base = srgb(214, 206, 188)[None] * (0.9 + 0.12 * pnoise(u * 6, v * 6, 6, 114))[:, None]
        grime = np.clip(pnoise(u * 12, v * 1.0, 12, 115, period_y=1) * 2.0, 0, 1)
        c = base * (1 - 0.3 * grime[:, None])
        fall = np.clip(pnoise(u * 3, v * 3, 3, 111) * 3 - 1.5, 0, 1)[:, None]
        return c * (1 - fall) + srgb(118, 112, 102)[None] * fall
    heightfield_mesh(p, S_, 384, h, col, lambda x, y, z: np.full(len(x), 0.92))
    return p, 0.1


def scene_boards(S_, rng):
    p = Parts()
    heightfield_mesh(p, S_, 64, lambda x, y: np.full_like(x, -0.03), lambda x, y, z: np.tile(srgb(18, 14, 12), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.9))
    widths = []
    x = 0.0
    while x < S_ - 0.1:
        w = rng.uniform(0.16, 0.30)
        widths.append(w)
        x += w
    k = S_ / sum(widths)
    x = 0.0
    for w in widths:
        w *= k
        res = 48
        XX, YY = np.meshgrid(np.linspace(x + 0.006, x + w - 0.006, 5), np.linspace(0, S_, res + 1))
        tone = rng.uniform(0.8, 1.15)
        seed = int(rng.integers(1000))
        grain = np.sin(XX * 260 + 12 * pnoise(XX / S_ * 20, YY / S_ * 2, 20, seed, period_y=2)) * 0.5 + 0.5
        ZZ = 0.003 * grain + rng.uniform(-0.004, 0.004) + 0.004 * np.sin((XX - x) / w * np.pi)
        V = np.stack([XX.ravel(), YY.ravel(), ZZ.ravel()], 1)
        idx = np.arange(V.shape[0]).reshape(res + 1, 5)
        a_, b_, c_, d_ = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
        F = np.concatenate([np.stack([a_, b_, c_], 1), np.stack([a_, c_, d_], 1)])
        C = (srgb(96, 78, 62) * tone)[None] * (0.8 + 0.35 * grain.ravel()[:, None])
        weather = (0.5 + 0.5 * pnoise(V[:, 0] / S_ * 4, V[:, 1] / S_ * 4, 4, 121))[:, None]
        C = C * (1 - 0.45 * weather) + srgb(118, 114, 108)[None] * 0.45 * weather
        p.add(V, F, C, 0.85)
        nrow = int(S_ / 0.9)
        for ny_ in range(nrow):
            yy = (ny_ + 0.5) * S_ / nrow
            for xx in (x + w * 0.3, x + w * 0.7):
                ctr = np.array([xx, yy, 0.008])
                ang = np.linspace(0, 2 * np.pi, 7)[:-1]
                Vn = np.vstack([ctr + [0, 0, 0.002], ctr + np.stack([np.cos(ang) * 0.006, np.sin(ang) * 0.006, np.zeros(6)], 1)])
                p.add(Vn, np.array([(0, 1 + j, 1 + (j + 1) % 6) for j in range(6)]), srgb(60, 50, 44), 0.5)
        x += w
    return p, 0.05


def _slab_faces():
    F = [(24, j, (j + 1) % 12) for j in range(12)]
    F += [(j, j + 12, (j + 1) % 12 + 12) for j in range(12)]
    F += [(j, (j + 1) % 12 + 12, (j + 1) % 12) for j in range(12)]
    return np.array(F)


def scene_slabs(S_, rng):
    p = Parts()
    heightfield_mesh(p, S_, 32, lambda x, y: np.full_like(x, -0.08), lambda x, y, z: np.tile(srgb(40, 38, 34), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.9))
    rows = int(S_ / 0.36)
    dy = S_ / rows
    F = _slab_faces()
    for r_ in range(rows + 1):
        y0 = r_ * dy
        x = rng.uniform(0, 0.4)
        while x < S_ + 0.4:
            w = rng.uniform(0.45, 0.85)
            cx = (x + w / 2) % S_
            ang = np.linspace(0, 2 * np.pi, 13)[:-1]
            rad = np.stack([np.cos(ang) * w / 2, np.sin(ang) * dy * 0.95], 1) * (1 + 0.12 * rng.uniform(-1, 1, (12, 1)))
            top = np.hstack([rad + [cx, y0 + dy * 0.5], np.zeros((12, 1))])
            top[:, 2] = 0.06 * (1 - (top[:, 1] - y0) / (dy * 1.5)) + rng.uniform(-0.01, 0.01)
            bot = top.copy()
            bot[:, 2] -= 0.04
            V = np.vstack([top, bot, [[cx, y0 + dy * 0.5, top[:, 2].mean()]]])
            c = srgb(118, 116, 112) * rng.uniform(0.75, 1.1)
            if rng.uniform() < 0.25:
                c = c * 0.7 + srgb(150, 146, 100) * 0.3
            p.add(V, F, c, 0.8)
            x += w + rng.uniform(-0.05, 0.02)
    return p, 0.5


def scene_shingles(S_, rng):
    p = Parts()
    heightfield_mesh(p, S_, 32, lambda x, y: np.full_like(x, -0.03), lambda x, y, z: np.tile(srgb(30, 28, 26), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.9))
    rows = int(S_ / 0.14)
    dy = S_ / rows
    for r_ in range(rows + 2):
        x = rng.uniform(0, 0.1)
        while x < S_ + 0.2:
            w = rng.uniform(0.08, 0.16)
            cx = (x + w / 2) % S_
            y0 = r_ * dy
            V = np.array([[cx - w / 2, y0, 0.012], [cx + w / 2, y0, 0.012], [cx + w / 2, y0 + dy * 2.2, 0.0],
                          [cx - w / 2, y0 + dy * 2.2, 0.0]])
            p.add(V, np.array([(0, 1, 2), (0, 2, 3)]), srgb(122, 116, 108) * rng.uniform(0.7, 1.15), 0.85)
            x += w + 0.004
    return p, 0.3


def scene_concrete(S_, rng):
    p = Parts()

    def h(x, y):
        u, v = x / S_, y / S_
        boards = np.abs(np.sin(v * np.pi * 20)) ** 20 * -0.004
        holes = -0.01 * (np.hypot(((u * 4) % 1) - 0.5, ((v * 4) % 1) - 0.5) < 0.012)
        return boards + holes + 0.002 * pnoise(u * 40, v * 40, 40, 131)

    def col(x, y, z):
        u, v = x / S_, y / S_
        base = srgb(158, 154, 146)[None] * (0.9 + 0.1 * pnoise(u * 8, v * 8, 8, 132))[:, None]
        streak = np.clip(pnoise(u * 16, v * 1.0, 16, 133, period_y=1) * 2.0 - 0.2, 0, 1)[:, None]
        rust = np.clip(pnoise(u * 20, v * 2.0, 20, 134, period_y=2) * 3.0 - 1.8, 0, 1)[:, None]
        c = base * (1 - 0.35 * streak)
        return c * (1 - rust * 0.5) + srgb(130, 80, 44)[None] * rust * 0.5
    heightfield_mesh(p, S_, 384, h, col, lambda x, y, z: np.full(len(x), 0.9))
    return p, 0.1


def scene_paint(S_, rng, color=(88, 92, 76)):
    p = Parts()

    def col(x, y, z):
        u, v = x / S_, y / S_
        chip = np.clip(pnoise(u * 14, v * 14, 14, 141) * 3.5 - 2.0, 0, 1)[:, None]
        base = srgb(*color)[None] * (0.92 + 0.1 * pnoise(u * 5, v * 5, 5, 142))[:, None]
        return base * (1 - chip) + srgb(108, 62, 36)[None] * chip
    heightfield_mesh(p, S_, 192, lambda x, y: 0.0005 * pnoise(x / S_ * 30, y / S_ * 30, 30, 143),
                     col, lambda x, y, z: np.full(len(x), 0.55))
    return p, 0.05


def scene_sandbag(S_, rng):
    p = Parts()
    heightfield_mesh(p, S_, 32, lambda x, y: np.full_like(x, -0.12), lambda x, y, z: np.tile(srgb(60, 52, 40), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.95))
    rows = int(S_ / 0.15)
    dy = S_ / rows
    for r_ in range(rows):
        x = 0.3 if r_ % 2 else 0.0
        while x < S_ + 0.3:
            w = 0.58
            cx = (x + w / 2) % S_
            cy = r_ * dy + dy / 2
            V, F = rock_blob(rng, np.array([0.0, 0.0, 0.0]), 1.0, flat=1.0, sub=2, sharp=0.05)
            V = V / (np.abs(V).max(0) + 1e-6) * [w / 2 - 0.01, dy / 2 - 0.005, 0.07] + [cx, cy, 0]
            p.add(V, F, srgb(150, 128, 92) * rng.uniform(0.8, 1.1), 0.95)
            x += w + 0.01
    return p, 0.4


def scene_road(S_, rng):
    p = Parts()

    def tracks(u, wdt):
        return np.exp(-((u - 0.28) / wdt) ** 2) + np.exp(-((u - 0.72) / wdt) ** 2)

    def h(x, y):
        u, v = x / S_, y / S_
        pot = -0.03 * np.clip(pnoise(u * 5, v * 5, 5, 151) * 3 - 1.9, 0, 1)
        return -0.012 * tracks(u, 0.07) + 0.004 * pnoise(u * 30, v * 30, 30, 152) + 0.01 * (1 - np.abs(u - 0.5) * 2) + pot

    def col(x, y, z):
        u, v = x / S_, y / S_
        t = tracks(u, 0.08)[:, None]
        base = srgb(128, 116, 98)[None] * (0.88 + 0.2 * pnoise(u * 10, v * 10, 10, 153))[:, None]
        c = base * (1 - 0.18 * t) + srgb(92, 84, 72)[None] * 0.18 * t
        verge = np.clip((np.abs(u - 0.5) - 0.42) / 0.08, 0, 1)[:, None]
        return c * (1 - verge * 0.6) + srgb(72, 78, 40)[None] * verge * 0.6
    heightfield_mesh(p, S_, 256, h, col, lambda x, y, z: np.full(len(x), 0.9))
    for i in range(int(900 * S_)):
        u = rng.uniform()
        if min(abs(u - 0.28), abs(u - 0.72)) < 0.06 and rng.uniform() < 0.8:
            continue
        c = np.array([u * S_, rng.uniform(0, S_), 0.0])
        V, F = rock_blob(rng, c, rng.uniform(0.006, 0.03), flat=0.5, sub=1)
        tint = [[150, 144, 132], [116, 110, 100], [170, 160, 140]][rng.integers(3)]
        p.add(V, F, srgb(*tint) * rng.uniform(0.85, 1.1), 0.8)
    return p, 0.05


def scene_setts(S_, rng):
    p = Parts()
    heightfield_mesh(p, S_, 64, lambda x, y: np.full_like(x, -0.02), lambda x, y, z: np.tile(srgb(70, 64, 52), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.95))
    rows = int(S_ / 0.14)
    dy = S_ / rows
    for r_ in range(rows):
        for x, w in _row(rng, S_, 0.12, 0.22, 0.012):
            cx = (x + w / 2) % S_
            cy = r_ * dy + dy / 2
            V, F = block(rng, (w / 2, dy / 2 - 0.008, 0.03), power=5.0, rough=0.06)
            V += [cx, cy, 0]
            tint = [[136, 132, 126], [118, 116, 112], [150, 144, 134]][rng.integers(3)]
            p.add(V, F, srgb(*tint) * rng.uniform(0.85, 1.1), 0.7)
    return p, 0.3


def scene_timber(S_, rng):
    p = Parts()

    def g_(u, v):
        return np.sin(u * 2 * np.pi * 14 + 4 * pnoise(u * 3, v * 1, 3, 161, period_y=1))

    def h(x, y):
        u, v = x / S_, y / S_
        return 0.002 * g_(u, v) - 0.004 * (np.abs(pnoise(u * 20, v * 2, 20, 162, period_y=2)) < 0.03)

    def col(x, y, z):
        u, v = x / S_, y / S_
        return srgb(84, 64, 46)[None] * (0.8 + 0.3 * (0.5 + 0.5 * g_(u, v)))[:, None]
    heightfield_mesh(p, S_, 192, h, col, lambda x, y, z: np.full(len(x), 0.85))
    return p, 0.05


def scene_hay(S_, rng):
    """The outside of a round hay bale: dry stalks wound round it (tile +X
    along the winding)."""
    from .tiles import blade
    p = Parts()
    heightfield_mesh(p, S_, 32, lambda x, y: np.full_like(x, -0.01), lambda x, y, z: np.tile(srgb(120, 100, 60), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.95))
    for i in range(int(2500 * S_ * S_)):
        b = (rng.uniform(0, S_), rng.uniform(0, S_), 0.0)
        V, F = blade(rng, b, rng.uniform(0.06, 0.2), rng.uniform(0.002, 0.004), (rng.normal(0, 0.15), 4.0), 0.0,
                     rng.uniform(0, 6.3), segs=2)
        V[:, 2] = rng.uniform(0, 0.01)
        c = [srgb(196, 172, 108), srgb(170, 146, 86), srgb(150, 140, 90), srgb(210, 190, 130)][rng.integers(4)]
        p.add(V, F, c * rng.uniform(0.8, 1.1), 0.9)
    return p, 0.2


BUILD_SPEC = {
    "rubble": (2.5, 1024), "ashlar": (2.4, 512), "plaster": (3.0, 512), "boards": (2.0, 1024),
    "slabs": (3.0, 1024), "shingles": (2.0, 512), "concrete": (4.0, 512), "paint": (1.0, 256),
    "sandbag": (1.2, 512), "road": (5.0, 1024), "setts": (2.0, 512), "timber": (1.0, 256),
    "paint_green": (1.0, 256), "paint_brown": (1.0, 256), "paint_red": (1.0, 256), "paint_white": (1.0, 256),
    "hay": (1.0, 512),
}
BUILD_SCENES = {"rubble": scene_rubble, "ashlar": scene_ashlar, "plaster": scene_plaster, "boards": scene_boards,
                "slabs": scene_slabs, "shingles": scene_shingles, "concrete": scene_concrete, "paint": scene_paint,
                "sandbag": scene_sandbag, "road": scene_road, "setts": scene_setts, "timber": scene_timber,
                "paint_green": lambda S_, r: scene_paint(S_, r, (52, 84, 58)),
                "paint_brown": lambda S_, r: scene_paint(S_, r, (92, 58, 40)),
                "paint_red": lambda S_, r: scene_paint(S_, r, (156, 36, 30)),
                "paint_white": lambda S_, r: scene_paint(S_, r, (214, 210, 200)),
                "hay": scene_hay}
