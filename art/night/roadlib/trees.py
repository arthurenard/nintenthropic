"""The pines past the motel and the tree lines on the far hills: dark,
ragged silhouettes the fog eats from the bottom up, where the tree lane's
walkers come from. Plus a few dead trees standing alone in the fields.

A pine is a tapered trunk with whorls of branch mass: each whorl a drooping
skirt whose rim is ragged (per-angle noise), the tiers shrinking and
thinning toward a spire, a few tiers missing or lopsided so no two trees
share a silhouette. Bake group 'trees'.
"""

import math

from mathutils import Vector, noise as mnoise

from .common import rng
from . import layout as L, meshkit as K
from .meshkit import MeshBuilder, Frame
from .ground import ground_z


def pine(mb, x, y, h, r, seg=10):
    z = ground_z(x, y) - 0.2
    lean = (r.uniform(-0.02, 0.02), r.uniform(-0.02, 0.02))
    f = Frame((x, y, z), r.uniform(0, 6.28)).sub((0, 0, 0), rot_x=lean[0], rot_y=lean[1])
    mb.cylinder(f, (0, 0, 0), 0.02 * h + 0.08, h * 0.97, 'bark', segments=7, radius_top=0.03)
    d = math.hypot(x, y)
    tiers = int(5 + h / (3.5 if d < 90 else 5.5))
    seg = seg if d < 90 else 7
    base_z = h * r.uniform(0.18, 0.32)
    ph = r.uniform(0, 100)
    for t in range(tiers):
        u = t / max(tiers - 1, 1)
        zt = base_z + (h - base_z) * u ** 0.92
        rad = (0.23 * h) * (1 - u) ** 0.85 + 0.25
        if t < tiers - 1 and r.random() < 0.12:
            continue                                   # a gap in the whorls
        thick = (h - base_z) / tiers * r.uniform(1.1, 1.6)
        droop = thick * r.uniform(0.35, 0.6)
        side_bias = (r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25))
        top = []
        rim = []
        under = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            n = mnoise.noise(Vector((math.cos(a) * 1.7 + ph + t * 3.1, math.sin(a) * 1.7, u * 4)))
            rr = rad * (0.78 + 0.4 * n + side_bias[0] * math.cos(a) + side_bias[1] * math.sin(a))
            rr = max(rr, 0.15)
            top.append(f.p(0.12 * math.cos(a), 0.12 * math.sin(a), zt + thick * 0.55))
            rim.append(f.p(rr * math.cos(a), rr * math.sin(a), zt - droop + 0.12 * n))
            under.append(f.p(rr * 0.45 * math.cos(a), rr * 0.45 * math.sin(a), zt - droop * 0.2))
        rnd = r.random()
        for k in range(seg):
            k2 = (k + 1) % seg
            mb.add_face([tuple(top[k]), tuple(rim[k]), tuple(rim[k2]), tuple(top[k2])], 'pine_needles', rnd)
            mb.add_face([tuple(rim[k]), tuple(under[k]), tuple(under[k2]), tuple(rim[k2])], 'pine_needles', rnd)


def dead_tree(mb, x, y, r):
    """A bare tree: a trunk forking into a few crooked limbs."""
    z = ground_z(x, y) - 0.2
    base = Vector((x, y, z))
    h = r.uniform(6.0, 9.0)
    trunk = [base, base + Vector((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), h * 0.45))]
    K.tube(mb, K.catmull(trunk, 3), 0.28, 'bark', sides=7)

    def limb(p, d, length, rad, depth):
        pts = [p]
        for k in range(4):
            d = (d + Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), r.uniform(-0.1, 0.25)))).normalized()
            pts.append(pts[-1] + d * length / 4)
        K.tube(mb, pts, rad, 'bark', sides=5, taper=lambda t: 1 - 0.7 * t)
        if depth > 0:
            for _ in range(2):
                limb(pts[r.randint(2, 4)], (d + Vector((r.uniform(-0.8, 0.8), r.uniform(-0.8, 0.8), 0.3))).normalized(),
                     length * 0.6, rad * 0.55, depth - 1)
    top = trunk[-1]
    for _ in range(3):
        limb(top, Vector((r.uniform(-0.7, 0.7), r.uniform(-0.7, 0.7), 0.8)).normalized(), h * 0.55, 0.14, 2)


def free(x, y):
    """Keep trees off the roads, the motel, the farm and the corn."""
    if abs(x - L.ROAD_X) < 9.0:
        return False
    if abs(y - L.CROSS_Y) < 7.0 and x > L.FARM_ROAD_X - 70:
        return False
    if 5 < x < 36 and 26 < y < 50:
        return False
    for x0, x1, y0, y1 in L.CORN:
        if x0 - 2 < x < x1 + 2 and y0 - 2 < y < y1 + 2:
            return False
    if math.hypot(x - L.BARN[0], y - L.BARN[1]) < 16 or math.hypot(x - L.SILO[0], y - L.SILO[1]) < 7:
        return False
    if math.hypot(x - L.WINDMILL[0], y - L.WINDMILL[1]) < 5:
        return False
    if math.hypot(x - L.DRIVEIN_SCREEN[0], y - L.DRIVEIN_SCREEN[1]) < 26 or math.hypot(x - L.DRIVEIN_BOOTH[0], y - L.DRIVEIN_BOOTH[1]) < 40:
        return False
    return True


def build(lib, col, quick=False):
    r = rng("trees")
    mbs = {}

    def mb(g):
        if g not in mbs:
            mbs[g] = MeshBuilder(f"trees.{g}")
        return mbs[g]
    placed = []

    def ok(x, y, d):
        return free(x, y) and all((x - px) ** 2 + (y - py) ** 2 > d * d for px, py in placed)
    # the pine wood east of the road: dense at its edge behind the motel,
    # thinning into the hills
    areas = [
        # (x0, x1, y0, y1, count, min spacing, height range)
        (21.0, 70.0, 48.5, 70.0, 70, 3.2, (13, 21)),
        (9.5, 21.0, 52.0, 110.0, 40, 3.4, (12, 20)),
        (36.0, 120.0, 20.0, 48.0, 45, 4.5, (14, 22)),
        (20.0, 140.0, 70.0, 220.0, 60, 7.0, (14, 24)),
        (-140.0, -48.0, 88.0, 230.0, 50, 7.5, (14, 22)),
        (-60.0, 60.0, 230.0, 380.0, 50, 9.0, (15, 24)),
    ]
    if quick:
        areas = [(a[0], a[1], a[2], a[3], a[4] // 3, a[5] * 1.5, a[6]) for a in areas]
    n = 0
    for x0, x1, y0, y1, count, sp, (h0, h1) in areas:
        tries = 0
        k = 0
        while k < count and tries < count * 30:
            tries += 1
            x, y = r.uniform(x0, x1), r.uniform(y0, y1)
            if not ok(x, y, sp):
                continue
            placed.append((x, y))
            g = 'trees'
            pine(mb(g), x, y, r.uniform(h0, h1), r)
            k += 1
            n += 1
    # a few dead trees alone in the fields and by the ditch
    for (x, y) in ((-18.0, 70.0), (-66.0, 38.0), (16.0, 21.0), (-9.8, 58.0), (38.0, 12.0)):
        if free(x, y) or (x, y) in ((16.0, 21.0), (-9.8, 58.0)):
            dead_tree(mb('trees'), x, y, r)
    for g, m in mbs.items():
        K.emit(m, col, lib, g, 'wood')
    print(f"  pines: {n}")
