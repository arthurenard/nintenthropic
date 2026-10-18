"""The harbour's landmarks: night on the quay. Painted steel, corrugated walls, sodium lamps and red-and-green lights."""
import math
import random

from mathutils import Vector

from wlib import (C, Landmark, RevSurf, TAU, chrome, faceted, mix, mul, shiny, smooth_profile,
                  with_breaks)
from wtext import Plane, text

RED = C("#d63a2a")
WHITE = C("#f2f0ea")
NAVY = C("#17304f")
STEEL = chrome(C("#2a3342"), C("#aab6c8"), horizon=-0.05, band=0.25)
DARK = C("#20252e")
LAMP = (1.0, 0.72, 0.32)
WINDOW = (1.0, 0.84, 0.5)
RED_L = (1.0, 0.12, 0.1)
GREEN_L = (0.1, 1.0, 0.3)
CONTAINER_COLOURS = [C("#c8372d"), C("#2f6db5"), C("#e58a1f"), C("#2f9c63"), C("#e5c223"), C("#1f8c98"), C("#7a4aa8"), C("#8a8f99"), C("#c8372d"), C("#2f6db5")]


def paint(c, k=0.18):
    return shiny(c, k)


def bulb(m, p, r=0.3, col=LAMP, segs=6):
    m.sphere(r, at=tuple(p), segs=segs, rings=max(3, segs - 2), col=col, mat="glow")


def corrugated(m, x0, x1, y0, y1, z, face, col, pitch=0.9, depth=0.18, thick=0.4):
    """A ribbed steel wall panel running along x at z, facing `face` (+1 / -1), from y0 to y1."""
    n = max(2, int(round((x1 - x0) / pitch)))
    pts = []
    for i in range(n + 1):
        pts.append((x0 + (x1 - x0) * i / n, z + face * (depth if i % 2 == 0 else 0.0)))
    pts += [(x1, z - face * thick), (x0, z - face * thick)]
    m.prism(pts, y1 - y0, y0=y0, col=col, mat="lit")


def lamp_post(m, x, z, h=9.0, face=(0, -1)):
    m.cylinder(r=0.22, h=h, at=(x, 0, z), segs=8, col=DARK, mat="lit")
    m.rbox((1.8, 0.35, 0.8), at=(x + face[0] * 0.8, h + 0.1, z + face[1] * 0.8), col=DARK, mat="lit")
    bulb(m, (x + face[0] * 1.0, h - 0.15, z + face[1] * 1.0), 0.42, LAMP)


# ─── Containers ──────────────────────────────────────────────────────────────

CL, CW, CH = 11.8, 4.8, 5.0


def container(m, at, yaw, col, label=None, rnd=None):
    """A shipping container sitting on `at` (its floor), turned by yaw (degrees about y)."""
    with m.group(at=at, rot=(0, yaw, 0)):
        pts = []
        n = int(CL / 0.95)
        for i in range(n + 1):
            pts.append((-CL / 2 + CL * i / n, -CW / 2 - (0.16 if i % 2 == 0 else 0.0)))
        pts += [(CL / 2, CW / 2 + 0.0)]
        for i in range(n, -1, -1):
            pts.append((-CL / 2 + CL * i / n, CW / 2 + (0.16 if i % 2 == 0 else 0.0)))
        m.prism(pts, CH - 0.5, y0=0.25, col=paint(col, 0.12), mat="lit")
        m.rbox((CL, 0.35, CW), at=(0, CH - 0.1, 0), col=mul(col, 0.85), mat="lit")
        m.rbox((CL, 0.4, CW), at=(0, 0.1, 0), col=mul(col, 0.55), mat="lit")
        for sx in (-1, 1):
            for sz in (-1, 1):
                for sy in (0.2, CH - 0.2):
                    m.rbox((0.55, 0.45, 0.55), at=(sx * (CL / 2 - 0.2), sy, sz * (CW / 2 - 0.2)), col=C("#2b2f38"), mat="lit")
        # the doors, at the +x end: four locking bars and a seam
        for k in range(4):
            u = -CW / 2 + 0.55 + k * (CW - 1.1) / 3
            m.rod((CL / 2 + 0.12, 0.6, u), (CL / 2 + 0.12, CH - 0.6, u), 0.07, sides=4, col=C("#9aa3ae"), mat="metal")
        m.rbox((0.1, CH - 0.6, 0.12), at=(CL / 2 + 0.05, CH / 2, 0.0), col=mul(col, 0.5), mat="lit")
        if label:
            for sg in (-1, 1):
                p = Plane((0.0, CH * 0.62, sg * (CW / 2 + 0.2)), (0, 0, sg))
                text(m, p, label, 1.5, C("#f4f1e8"), at=(0.0, 0.0), lift=0.05, mat="matte", pad=0.1)


def containers() -> Landmark:
    lm = Landmark("containers", ao=0.8, ao_dist=5.0, rays=14)
    rnd = random.Random(21)
    # the stacks: four bays of two rows, one to three high
    heights = [[3, 2, 1], [2, 3, 2], [1, 3, 3]]
    k = 0
    for row, z in enumerate((-5.1, 0.0, 5.1)):
        for bay in range(3):
            x = -12.2 + bay * 12.2
            for lev in range(heights[row][bay]):
                container(lm, (x, lev * CH, z), rnd.uniform(-0.8, 0.8), CONTAINER_COLOURS[(k + lev * 3) % len(CONTAINER_COLOURS)], label=("GRIP", "HNDY", "FLEET", "KART")[(k + lev) % 4] if (k + lev) % 3 == 0 else None)
                k += 1
    # a pallet of crates and a lamp
    lamp_post(lm, 19.5, 2.0, 11.0, face=(-1, 0))
    return lm


# ─── Warehouse ───────────────────────────────────────────────────────────────


def warehouse() -> Landmark:
    lm = Landmark("warehouse", ao=0.75, ao_dist=6.0, rays=14)
    WALL = C("#8d98a6")
    WALL_D = C("#6b7686")
    ROOF = C("#5a2e2a")
    x0, x1, z0, z1 = -21.3, 17.0, -9.8, 9.8
    # apron, dock
    lm.rbox((x1 - x0 + 2, 0.5, z1 - z0 + 9.0), at=((x0 + x1) / 2, 0.0, 2.0), bevel=0.1, col=C("#4a5160"), mat="lit")
    lm.rbox((x1 - x0 - 2, 1.4, 3.2), at=((x0 + x1) / 2, 0.7, z1 + 1.6), bevel=0.15, col=C("#8a8f99"), mat="lit")
    # walls: ribbed panels on all four sides, in bands of two tones
    for face, z in ((1, z1), (-1, z0)):
        corrugated(lm, x0, x1, 1.4 if face > 0 else 0.0, 8.5, z, face, WALL)
    for sg, x in ((1, x1), (-1, x0)):
        pts = []
        n = int((z1 - z0) / 0.9)
        for i in range(n + 1):
            pts.append((x + sg * (0.18 if i % 2 == 0 else 0.0), z0 + (z1 - z0) * i / n))
        pts += [(x - sg * 0.4, z1), (x - sg * 0.4, z0)]
        lm.prism(pts, 8.5, col=WALL, mat="lit")
    lm.rbox((x1 - x0 + 0.6, 0.7, 0.9), at=((x0 + x1) / 2, 1.0, z1 + 0.1), bevel=0.1, col=WALL_D, mat="lit")
    # the gable roof: a triangle section, ribbed, with a lit skylight strip along the ridge
    ridge = 12.8
    # a roof running along z: build it as two sloped slabs
    half = (x1 - x0 + 1.6) / 2
    ang = math.degrees(math.atan2(ridge - 8.4, half))
    slab = math.hypot(half, ridge - 8.4)
    cx = (x0 + x1) / 2
    for sg in (-1, 1):
        lm.rbox((slab, 0.35, z1 - z0 + 1.8), at=(cx + sg * half / 2, (8.4 + ridge) / 2 + 0.0, 0.0), rot=(0, 0, -sg * ang), bevel=0.08, bseg=1, col=ROOF, mat="lit")
    lm.rbox((3.2, 0.5, z1 - z0 - 3.0), at=(cx, ridge + 0.1, 0.0), bevel=0.15, col=C("#3a2220"), mat="lit")
    lm.rbox((1.4, 0.2, z1 - z0 - 4.0), at=(cx, ridge + 0.42, 0.0), col=WINDOW, mat="glow")
    # gable end sections (triangular infill)
    for zz in (z0, z1):
        with lm.group(at=(0, 0, zz)):
            lm.prism_xy([(x0, 8.4), (x1, 8.4), (cx, ridge - 0.2)], 0.4, at=(0, 0, 0.0), col=WALL_D, mat="lit")
    # roller doors with glowing slits, a lamp over each
    for k in range(3):
        dx = x0 + 7.5 + k * 11.5
        lm.rbox((7.4, 6.6, 0.3), at=(dx, 1.4 + 3.3, z1 + 0.35), bevel=0.08, bseg=1, col=C("#3a4252"), mat="lit")
        for s in range(9):
            lm.rbox((7.0, 0.08, 0.1), at=(dx, 1.8 + s * 0.68, z1 + 0.55), col=C("#2b323f"), mat="lit")
        lm.rbox((7.0, 0.28, 0.1), at=(dx, 1.62, z1 + 0.57), col=WINDOW, mat="glow")
        lm.rbox((1.4, 0.4, 0.9), at=(dx, 8.1, z1 + 0.9), bevel=0.1, col=DARK, mat="lit")
        bulb(lm, (dx, 7.95, z1 + 1.1), 0.4, LAMP)
        lm.rbox((7.8, 0.35, 0.45), at=(dx, 8.3, z1 + 0.5), col=C("#e5c223"), mat="lit")
    # a dock canopy
    lm.rbox((x1 - x0 - 4.0, 0.3, 4.2), at=((x0 + x1) / 2, 6.7, z1 + 2.2), bevel=0.1, col=C("#4b5565"), mat="lit")
    for sx in range(5):
        lm.rod((x0 + 3 + sx * 8.5, 0.8, z1 + 4.1), (x0 + 3 + sx * 8.5, 6.6, z1 + 4.1), 0.18, sides=6, col=DARK, mat="lit")
    # the annex: an office with lit windows
    ax0, ax1 = x1, 30.3
    lm.rbox((ax1 - ax0, 6.2, 16.0), at=((ax0 + ax1) / 2, 3.1, 0.0), bevel=0.2, col=C("#a9b2c0"), mat="lit")
    lm.rbox((ax1 - ax0 + 0.8, 0.4, 16.8), at=((ax0 + ax1) / 2, 6.4, 0.0), bevel=0.15, col=C("#3a4252"), mat="lit")
    for k in range(4):
        lm.rbox((1.8, 1.7, 0.12), at=(ax0 + 2.3 + k * 3.0, 3.6, 8.07), col=WINDOW, mat="glow")
    lm.rbox((1.4, 2.8, 0.14), at=(ax0 + 11.6, 1.8, 8.07), col=C("#2b323f"), mat="lit")
    # sign, tall on the front wall
    lm.rbox((13.0, 2.6, 0.5), at=(x0 + 9.0, 10.8, z1 + 0.6), bevel=0.12, col=NAVY, mat="glossy")
    text(lm, Plane((x0 + 9.0, 10.8, z1 + 0.88), (0, 0, 1)), "WAREHOUSE 7", 1.35, (1.0, 0.82, 0.4), at=(0.0, -0.68), lift=0.04, mat="glow", pad=0.1)
    # four crates in a row, and a line of bollards
    rnd = random.Random(8)
    for i in range(4):
        s = rnd.uniform(1.3, 2.1)
        lm.rbox((s, s, s), at=(x0 + 1.6 + i * 2.4, 1.4 + s / 2, z1 + 1.4), rot=(0, rnd.uniform(-6, 6), 0), bevel=0.08, bseg=1, col=mix(C("#a0733d"), C("#c28f52"), rnd.random()), mat="matte")
    for sx in range(6):
        lm.cylinder(r=0.28, h=1.0, at=(x0 + 3 + sx * 7.0, 0.3, z1 + 5.4), segs=8, rb=0.08, rt=0.08, col=C("#e5c223"), mat="glossy")
    lamp_post(lm, x1 + 3.0, z1 + 5.0, 9.5, face=(0, -1))
    return lm


# ─── Buoy ────────────────────────────────────────────────────────────────────


def one_buoy(m, at):
    x, _, z = at
    prof = [(0.0, 0.0), (1.9, 0.0), (2.4, 0.6), (2.5, 1.4), (2.0, 2.4), (1.2, 3.4), (0.9, 3.9), (0.9, 4.1), (0.0, 4.1)]
    m.lathe([(r, y) for r, y in prof], at=(x, 0, z), segs=24, col=faceted(lambda p, n: RED if int(max(0.0, p.y - 0.6) / 1.0) % 2 == 0 else WHITE), mat="glossy")
    m.torus(R=2.35, r=0.28, at=(x, 0.7, z), segs=28, sides=8, col=C("#222a36"), mat="glossy")
    m.cylinder(r=1.05, h=0.3, at=(x, 4.1, z), segs=16, col=DARK, mat="lit")
    for k in range(6):
        a = TAU * k / 6
        m.rod((x + math.cos(a) * 0.95, 4.3, z + math.sin(a) * 0.95), (x + math.cos(a) * 0.55, 6.6, z + math.sin(a) * 0.55), 0.09, sides=5, col=DARK, mat="lit")
    m.sphere(0.8, at=(x, 5.6, z), segs=12, rings=8, col=(1.0, 0.82, 0.4), mat="glow")
    m.cone(r=0.8, h=0.7, at=(x, 6.55, z), segs=12, col=DARK, mat="lit")


def buoy() -> Landmark:
    lm = Landmark("buoy", ao=0.7, ao_dist=4.0, rays=12)
    # an anchor slab and three buoys riding at it, each bobbing at its own pace
    lm.cylinder(r=3.0, h=0.4, at=(0, -0.6, 0), segs=24, col=C("#2c3f55"), mat="lit")
    for k, (x, z, speed, bob, phase) in enumerate(((-4.2, -1.0, 0.25, 0.35, 0.0), (0.6, -3.6, -0.3, 0.3, 1.9), (4.8, -0.4, 0.2, 0.4, 3.6))):
        part = lm.spin(f"float{k}", "y", (x, 0.0, z), speed, bob=bob, bobspeed=1.1 + 0.2 * k, phase=phase)
        one_buoy(part, (x, 0.0, z))
    # a marker post with a green lamp
    lm.cylinder(r=0.3, h=7.0, at=(7.0, 0, 8.0), segs=10, col=C("#3b4a5c"), mat="lit")
    bulb(lm, (7.0, 7.3, 8.0), 0.55, GREEN_L)
    return lm


# ─── Lighthouse ──────────────────────────────────────────────────────────────


def lighthouse() -> Landmark:
    lm = Landmark("lighthouse", ao=0.75, ao_dist=6.0, rays=14)
    prof = smooth_profile([(0.0, -0.6), (7.6, -0.6), (7.4, 1.0), (6.6, 12.0), (5.3, 26.0), (4.4, 34.0)], 5) + [(4.4, 34.2), (5.6, 34.4), (6.3, 34.6), (6.3, 35.2), (0.0, 35.2)]

    def col(p, n):
        y = p.y
        c = RED if (y < 9.0 or 18.0 <= y < 27.0) else WHITE
        if y > 34.2:
            c = mix(WHITE, DARK, 0.5)
        return paint(c, 0.12)(p, n)

    lm.lathe(with_breaks(prof, [9.0, 18.0, 27.0, 34.2]), segs=56, col=col, mat="glossy")
    # windows and a door
    surf = RevSurf(smooth_profile([(7.4, 1.0), (6.6, 12.0), (5.3, 26.0), (4.4, 34.0)], 5))
    for y, az in ((12.0, 0.0), (20.0, math.pi), (28.0, 0.0), (28.0, math.pi * 0.5)):
        lm.decal(surf.painter(az, y), [(-0.6, -0.9), (0.6, -0.9), (0.6, 0.9), (-0.6, 0.9)], WINDOW, 0.08, "glow")
    lm.decal(surf.painter(0.0, 1.0), [(-1.3, 0.0), (1.3, 0.0)] + [(1.3 * math.cos(math.radians(a)), 2.2 + 1.3 * math.sin(math.radians(a))) for a in range(0, 181, 20)], C("#2b1a14"), 0.12, "lit", rings=2)
    # gallery rail and the lantern room
    lm.torus(R=6.2, r=0.14, at=(0, 36.3, 0), segs=40, sides=5, col=DARK, mat="lit")
    for k in range(24):
        a = TAU * k / 24
        lm.rod((math.cos(a) * 6.2, 35.2, math.sin(a) * 6.2), (math.cos(a) * 6.2, 36.3, math.sin(a) * 6.2), 0.07, sides=4, col=DARK, mat="lit")
    lm.cylinder(r=3.3, h=4.6, at=(0, 35.2, 0), segs=20, col=(0.65, 0.8, 0.9), mat="glass")
    for k in range(10):
        a = TAU * k / 10
        lm.rod((math.cos(a) * 3.35, 35.2, math.sin(a) * 3.35), (math.cos(a) * 3.35, 39.8, math.sin(a) * 3.35), 0.12, sides=5, col=DARK, mat="lit")
    lm.sphere(2.0, at=(0, 37.6, 0), segs=16, rings=10, col=(1.0, 0.86, 0.5), mat="glow")
    lm.lathe(smooth_profile([(4.0, 39.8), (3.6, 40.5), (2.4, 42.2), (1.0, 43.6), (0.0, 44.4)], 4), segs=24, col=C("#a63a2c"), mat="glossy", closed=False)
    lm.rod((0, 44.2, 0), (0, 46.2, 0), 0.1, sides=5, col=DARK, mat="lit")
    lm.sphere(0.35, at=(0, 44.4, 0), segs=8, rings=5, col=RED_L, mat="glow")
    # the keeper's house, with a lit window or three
    lm.rbox((13.0, 6.0, 8.6), at=(-11.6, 3.0, 0.0), bevel=0.25, col=C("#eadfc9"), mat="matte")
    with lm.group(at=(-11.6, 6.0, 0.0)):
        lm.prism_xy([(-7.4, 0.0), (7.4, 0.0), (0.0, 3.8)], 9.6, col=C("#a63a2c"), mat="matte")
    lm.rbox((1.8, 3.6, 1.8), at=(-8.0, 9.0, -1.8), bevel=0.15, col=C("#b4b0a4"), mat="matte")
    for k in range(3):
        lm.rbox((1.6, 1.9, 0.12), at=(-16.0 + k * 3.6 + 0.0, 3.4, 4.35), col=WINDOW, mat="glow")
    lm.rbox((1.6, 3.0, 0.14), at=(-6.4, 1.5, 4.36), col=C("#5a3a22"), mat="matte")
    # the beam: two long cones turning with the lamp
    beam = lm.spin("beam", "y", (0, 37.6, 0), 0.9)
    for rot in ((90, 0, 0), (-90, 0, 0)):
        beam.lathe([(0.0, 0.0), (8.0, 76.0), (0.0, 76.0)], at=(0, 37.6, 0), rot=rot, segs=14, col=(1.0, 0.93, 0.7), mat="glass")
    return lm


# ─── Crane ───────────────────────────────────────────────────────────────────

CRANE = C("#f0a020")
CRANE_D = C("#d9822a")


def box_girder(m, a, b, w, h, col, panel=2.4):
    """A lattice girder from a to b (a long box frame: two chords and zig-zag bracing)."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    ln = d.length
    n = max(2, int(ln / panel))
    for sy in (-1, 1):
        m.rod(a + Vector((0, sy * h / 2, 0)), b + Vector((0, sy * h / 2, 0)), 0.28, sides=6, col=col, mat="lit")
    for i in range(n):
        p0 = a + d * (i / n)
        p1 = a + d * ((i + 1) / n)
        lo, hi = (-1, 1) if i % 2 == 0 else (1, -1)
        m.rod(p0 + Vector((0, lo * h / 2, 0)), p1 + Vector((0, hi * h / 2, 0)), 0.16, sides=5, col=col, mat="lit")
        m.rod(p0 + Vector((0, -h / 2, 0)), p0 + Vector((0, h / 2, 0)), 0.14, sides=5, col=col, mat="lit")


def crane() -> Landmark:
    lm = Landmark("crane", ao=0.7, ao_dist=7.0, rays=12)
    LEGX, LEGZ = 10.5, 6.0
    # rails and bogies
    for sx in (-1, 1):
        lm.rbox((1.4, 0.4, 36.0), at=(sx * LEGX, 0.1, 0.0), bevel=0.1, col=C("#4a5160"), mat="lit")
        for sz in (-1, 1):
            lm.rbox((2.6, 1.6, 3.4), at=(sx * LEGX, 1.1, sz * LEGZ), bevel=0.2, col=C("#2b323f"), mat="lit")
            # a tapered leg
            lm.rbox((1.8, 25.0, 1.8), at=(sx * LEGX, 14.5, sz * LEGZ), bevel=0.15, bseg=2, col=paint(CRANE, 0.1), mat="glossy", taper=(0.78, 0.78))
        # side beams, braces
        lm.rbox((1.1, 1.3, 2 * LEGZ), at=(sx * LEGX, 12.0, 0.0), bevel=0.1, col=CRANE_D, mat="lit")
        lm.rod((sx * LEGX, 3.0, -LEGZ), (sx * LEGX, 12.0, LEGZ), 0.2, sides=6, col=CRANE_D, mat="lit")
        lm.rod((sx * LEGX, 3.0, LEGZ), (sx * LEGX, 12.0, -LEGZ), 0.2, sides=6, col=CRANE_D, mat="lit")
    lm.rbox((2 * LEGX + 1.8, 1.4, 1.4), at=(0, 26.0, -LEGZ), bevel=0.12, col=CRANE, mat="lit")
    lm.rbox((2 * LEGX + 1.8, 1.4, 1.4), at=(0, 26.0, LEGZ), bevel=0.12, col=CRANE, mat="lit")
    lm.rbox((2 * LEGX + 1.8, 1.2, 1.2), at=(0, 12.0, -LEGZ), bevel=0.12, col=CRANE_D, mat="lit")
    lm.rbox((2 * LEGX + 1.8, 1.2, 1.2), at=(0, 12.0, LEGZ), bevel=0.12, col=CRANE_D, mat="lit")
    # the boom and back reach, two girders carrying the trolley way
    for sx in (-1, 1):
        box_girder(lm, (sx * 3.6, 27.1, -17.0), (sx * 3.6, 27.1, 30.0), 1.0, 2.4, CRANE)
    lm.rbox((8.6, 0.5, 47.0), at=(0, 26.1, 6.5), bevel=0.1, col=CRANE_D, mat="lit")
    # the machinery house and the driver's cab
    lm.rbox((8.8, 4.6, 8.4), at=(0, 29.6, -10.0), bevel=0.4, col=paint(CRANE, 0.12), mat="glossy")
    lm.rbox((3.2, 3.0, 3.4), at=(5.8, 24.0, 11.0), bevel=0.35, col=paint(C("#f4f1e8"), 0.1), mat="glossy")
    lm.rbox((2.4, 1.2, 0.12), at=(5.8, 24.4, 12.75), col=WINDOW, mat="glow")
    # the A-frame tower and the stays
    for sx in (-1, 1):
        lm.rod((sx * 3.6, 27.1, -LEGZ), (0.0, 42.2, -LEGZ + 0.0), 0.34, sides=7, col=CRANE, mat="lit")
    lm.sphere(0.6, at=(0, 42.4, -LEGZ), segs=8, rings=6, col=RED_L, mat="glow")
    for z, y in ((30.0, 27.1), (-17.0, 27.1)):
        lm.rod((0.0, 42.0, -LEGZ), (0.0, y, z), 0.09, sides=4, col=C("#3a4252"), mat="lit")
    # red and white warning bands on the boom tip, and its lamps
    for sx in (-1, 1):
        for k in range(5):
            lm.rbox((0.5, 2.5, 1.0), at=(sx * 3.6, 27.1, 25.6 + k * 0.9), col=RED if k % 2 else WHITE, mat="lit")
        bulb(lm, (sx * 3.6, 28.7, 30.2), 0.45, RED_L)
    bulb(lm, (0.0, 31.9, -10.0), 0.4, LAMP)
    for i in range(6):
        bulb(lm, (-LEGX - 1.0 if i % 2 else LEGX + 1.0, 4.5 + i * 3.4, -LEGZ - 1.4), 0.26, LAMP)
    # the trolley and the load, hoisted up and down
    lm.rbox((3.4, 1.0, 5.0), at=(0, 25.4, 25.0), bevel=0.2, col=C("#3a4252"), mat="lit")
    load = lm.spin("load", "y", (0.0, 19.0, 25.0), 0.0, bob=1.8, bobspeed=0.55, phase=0.0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            load.rod((sx * 1.6, 26.0, 25.0 + sz * 2.0), (sx * 1.8, 17.6, 25.0 + sz * 2.4), 0.07, sides=4, col=C("#1d222b"), mat="lit")
    load.rbox((4.2, 0.6, 6.0), at=(0, 17.4, 25.0), bevel=0.1, col=C("#2b323f"), mat="lit")
    with load.group(at=(0, 11.0, 25.0), rot=(0, 90, 0), scale=0.54):
        container(load, (0, 0, 0), 0, C("#2f6db5"), label="GRIP")
    return lm


BUILDERS = {"containers": containers, "warehouse": warehouse, "buoy": buoy, "lighthouse": lighthouse, "crane": crane}
import harbour_b  # noqa: E402,F401
