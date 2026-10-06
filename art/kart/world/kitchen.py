"""The kitchen's landmarks: toy karts on a giant counter, so a teapot is thirty metres tall.
China, steel, wood and fruit in late golden light."""
import math

from mathutils import Vector

from wlib import (C, Landmark, RevSurf, TAU, aim, bezier, catmull, chrome, cyl_profile, mix, mul, ngon, petal, rot2, shift2, shiny,
                  smooth_profile, smoothstep, with_breaks, arc_pts)
from wtext import Plane, text

CHINA = C("#f6f1e6")
BLUE = C("#1d55cc")
BLUE_DEEP = C("#173f9e")
BLUE_PALE = C("#79a8f2")
GOLD = C("#f0b030")
WHITE = C("#fbf7ee")
BLACK = C("#1b1816")
STEEL = chrome(C("#3a4a62"), C("#e3eeff"), horizon=-0.02, band=0.22)
STEEL_DK = chrome(C("#2b3548"), C("#9fb2cf"), horizon=0.0, band=0.25)


def noise(p, f=1.0):
    return math.sin(p.x * 3.1 * f + p.y * 1.7 * f) * math.sin(p.z * 2.9 * f + p.x * 2.3 * f) * 0.5 + math.sin(p.y * 4.7 * f + p.z * 3.7 * f) * 0.5


def china_gloss(c, n, k=0.14):
    up = max(0.0, n.y)
    down = max(0.0, -n.y)
    c = mix(c, (1.0, 1.0, 1.0), k * up * up)
    return mix(c, mul(c, 0.62), 0.55 * down)


def glossy(c, k=0.14):
    return lambda p, n: china_gloss(c, n, k)


def gloss_fruit(base, dark=0.62, k=0.42, centre=None):
    """Fruit colour: shaded underneath, a soft sky glint on top."""
    def f(p, n):
        up = max(0.0, n.y)
        c = mix(mul(base, dark), base, smoothstep(-0.6, 0.5, n.y))
        return mix(c, (1.0, 1.0, 0.95), k * up ** 3)
    return f


# ─── Teapot ──────────────────────────────────────────────────────────────────

BODY = [(8.4, 0.0), (9.5, 0.3), (10.2, 1.4), (11.6, 3.0), (13.7, 5.2), (15.0, 8.2), (15.35, 12.0), (14.5, 15.8), (12.4, 19.2), (10.2, 21.6), (8.6, 22.7), (8.1, 23.1)]
TEAPOT_BREAKS = [0.9, 2.2, 2.5, 0.6, 8.0, 8.5, 14.9, 15.2, 17.55, 17.9, 19.6, 19.95]
OUTER = [(0.0, 0.0)] + smooth_profile(BODY, 6)
PROFILE = OUTER + [(7.4, 22.8), (7.4, 21.0), (0.0, 21.0)]
SKIN = RevSurf(OUTER)


def teapot_colour(p, n):
    y = p.y
    c = CHINA
    if 0.9 < y < 2.2 or 17.9 < y < 19.6:
        c = BLUE
    elif 0.6 < y <= 0.9 or 2.2 <= y < 2.5 or 17.55 < y <= 17.9 or 19.6 <= y < 19.95:
        c = GOLD
    elif 8.0 < y < 8.5 or 14.9 < y < 15.2:
        c = BLUE_PALE
    return china_gloss(c, n)


def medallion(lm, surf, az, y, k=1.0, lift=0.1):
    """A painted flower, leaves and dots, `k` times the big one."""
    paint = lambda u, v: surf.at(az, y, u * k, v * k)
    sc = lambda poly: [(u * k, v * k) for u, v in poly]
    for i in range(8):
        lm.decal(paint, sc(rot2(petal(4.3, 2.3, 7, 0.5), TAU * i / 8)), BLUE_DEEP, lift)
    for i in range(8):
        lm.decal(paint, sc(rot2(petal(2.5, 1.5, 7, 0.4), TAU * (i + 0.5) / 8)), BLUE_PALE, lift * 1.6)
    for i in range(8):
        lm.decal(paint, sc(rot2(petal(2.6, 1.0, 6, 5.0), TAU * (i + 0.5) / 8)), BLUE, lift)
    lm.decal(paint, sc(ngon(14, 1.0)), GOLD, lift * 2.4)
    lm.decal(paint, sc(ngon(10, 0.45)), BLUE_DEEP, lift * 3.0)
    for i in range(16):
        a = TAU * i / 16
        lm.decal(paint, sc([(7.6 * math.cos(a) + u, 7.6 * math.sin(a) + v) for u, v in ngon(8, 0.38)]), BLUE, lift)


def teapot() -> Landmark:
    lm = Landmark("teapot", ao=0.75)
    lm.lathe(with_breaks(PROFILE, TEAPOT_BREAKS), segs=96, col=teapot_colour, mat="glossy")
    for s in (-1, 1):
        medallion(lm, SKIN, s * 1.5, 11.2, 1.3)
        for da, y0 in ((0.95, 5.6), (-0.95, 5.6), (0.8, 16.6), (-0.8, 16.6)):
            medallion(lm, SKIN, s * (1.5 + da), y0, 0.36, 0.1)
    for i in range(36):
        lm.decal(SKIN.painter(TAU * i / 36, 21.0), ngon(8, 0.4), BLUE, 0.08)
    lid = [(0.0, 0.0), (7.7, 0.0), (8.3, 0.3), (8.35, 0.9), (7.9, 1.3)] + smooth_profile([(7.5, 1.9), (6.1, 3.7), (3.9, 5.4), (1.9, 6.4), (0.9, 6.7)], 6) + [(0.9, 6.9), (0.0, 6.95)]
    lm.lathe(with_breaks(lid, [0.3, 0.5, 0.9]), at=(0, 22.9, 0), segs=64,
             col=lambda p, n: china_gloss(GOLD if 0.3 < p.y - 22.9 < 0.5 else (BLUE if 0.5 <= p.y - 22.9 < 0.9 else CHINA), n), mat="glossy")
    lid_surf = RevSurf([(r, y + 22.9) for r, y in lid[:-2]])
    for i in range(18):
        lm.decal(lid_surf.painter(TAU * i / 18, 22.9 + 2.6), ngon(8, 0.45), BLUE, 0.08)
    lm.cylinder(r=1.05, h=1.6, at=(0, 29.6, 0), segs=24, col=glossy(CHINA), mat="glossy")
    lm.sphere(r=1.9, at=(0, 31.8, 0), segs=28, rings=16, col=shiny(BLUE, 0.55), mat="glossy")
    sp = bezier([0, 4.5, 8], [0, 3.0, 24], [0, 16, 17], [0, 25, 26.5], 56)
    sr = lambda t: 4.0 - 2.2 * t ** 0.8 + (0.55 * ((t - 0.9) / 0.1) ** 2 if t > 0.9 else 0.0)

    def spout_col(p, n):
        best = min(range(len(sp)), key=lambda i: (sp[i] - p).length_squared)
        t = best / (len(sp) - 1)
        return china_gloss(BLUE if (0.5 < t < 0.56 or 0.7 < t < 0.76) else CHINA, n)

    lm.tube(sp, r=1.0, sides=24, scale_fn=sr, col=spout_col, mat="glossy", caps=False)
    d = (sp[-1] - sp[-2]).normalized()
    lm.cylinder(r=2.1, h=0.2, at=tuple(sp[-1] - d * 0.25), rot=aim(d), segs=24, col=C("#243452"), mat="matte")
    hp = bezier([0, 20.5, -11.5], [0, 31, -26], [0, 1, -27], [0, 6.8, -12.8], 56)
    hs = lambda t: 1.0 + 0.5 * abs(2 * t - 1) ** 3
    prof = [(1.9 * math.cos(TAU * i / 20), 1.35 * math.sin(TAU * i / 20)) for i in range(20)]

    def handle_col(p, n):
        best = min(range(len(hp)), key=lambda i: (hp[i] - p).length_squared)
        t = best / (len(hp) - 1)
        return china_gloss(BLUE if (0.18 < t < 0.23 or 0.77 < t < 0.82) else CHINA, n)

    lm.sweep(hp, prof, up=(1, 0, 0), scale_fn=hs, col=handle_col, mat="glossy")
    return lm


# ─── Fruit bowl ──────────────────────────────────────────────────────────────

ORANGE = C("#ff8a14")
APPLE_RED = C("#d3202a")
APPLE_GREEN = C("#8fc02c")
PEAR = C("#b9cf3a")
LEMON = C("#ffdc2c")
LEAF = C("#3f9a3a")
STALK = C("#5a3b1e")
GRAPE = C("#6b2d8c")
BANANA = C("#ffd93a")


def fruit_orange(lm, at, r):
    lm.sphere(r, at=at, segs=28, rings=18, col=gloss_fruit(ORANGE, 0.6, 0.38), mat="glossy", disp=lambda p: 0.02 * r * noise(p, 1.6 / r * 3))
    lm.cylinder(r=r * 0.14, h=r * 0.1, at=(at[0], at[1] + r * 0.97, at[2]), segs=8, col=C("#4c7a2b"), mat="matte")


APPLE_PROFILE = [(0.0, -0.8), (0.28, -0.92), (0.65, -0.85), (0.93, -0.5), (1.0, 0.0), (0.92, 0.5), (0.62, 0.86), (0.32, 0.92), (0.14, 0.78), (0.0, 0.7)]


def fruit_apple(lm, at, r, col=APPLE_RED, yaw=0.0, blush=None):
    prof = [(a * r, b * r) for a, b in smooth_profile(APPLE_PROFILE, 3)]
    prof = [(max(0.0, a), b) for a, b in prof]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])

    def f(p, n):
        base = gloss_fruit(col, 0.55, 0.45)(p, n)
        if blush is not None:
            base = mix(base, blush, 0.5 * smoothstep(0.1, -0.7, n.y) * (0.5 + 0.5 * math.sin((p.x + p.z) * 0.8)))
        return base

    lm.lathe(prof, at=at, rot=(0, math.degrees(yaw), 0), segs=28, col=f, mat="glossy")
    lm.rod((at[0], at[1] + r * 0.7, at[2]), (at[0] + r * 0.08, at[1] + r * 1.35, at[2]), r * 0.07, sides=6, col=STALK, mat="matte")
    lm.sphere(r * 0.5, at=(at[0] + r * 0.45, at[1] + r * 1.18, at[2] + r * 0.05), scale=(1.0, 0.14, 0.5), segs=10, rings=6, rot=(0, math.degrees(yaw) + 20, 12), col=LEAF, mat="glossy")


def fruit_pear(lm, at, r):
    prof = smooth_profile([(0.0, -1.0), (0.55, -0.96), (0.98, -0.55), (0.9, -0.05), (0.62, 0.45), (0.45, 0.95), (0.3, 1.4), (0.0, 1.5)], 4)
    prof = [(max(0.0, a * r), b * r) for a, b in prof]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    lm.lathe(prof, at=at, segs=26, col=gloss_fruit(PEAR, 0.6, 0.4), mat="glossy")
    lm.rod((at[0], at[1] + r * 1.4, at[2]), (at[0] + r * 0.2, at[1] + r * 1.95, at[2]), r * 0.07, sides=6, col=STALK, mat="matte")


def fruit_lemon(lm, at, r, yaw=0.0):
    prof = smooth_profile([(0.0, -1.0), (0.18, -0.93), (0.7, -0.7), (1.0, 0.0), (0.7, 0.7), (0.18, 0.93), (0.0, 1.0)], 4)
    prof = [(max(0.0, a * r), b * r * 1.0) for a, b in prof]
    prof[0] = (0.0, prof[0][1])
    prof[-1] = (0.0, prof[-1][1])
    lm.lathe(prof, at=at, rot=(0, 0, 90), scale=(1, 1, 1), segs=24, col=gloss_fruit(LEMON, 0.7, 0.4), mat="glossy", disp=lambda p: 0.015 * r * noise(p, 4.0 / r))


def fruit_banana(lm, base, ang, curve=1.0, length=16.0, r=1.3):
    """A banana lying along ang (degrees about y) from `base`, curving up and away."""
    a = math.radians(ang)
    dirx, dirz = math.sin(a), math.cos(a)
    pts = []
    for i in range(21):
        t = i / 20
        d = t * length
        h = curve * 4.0 * math.sin(t * math.pi * 0.9)
        pts.append((base[0] + dirx * d, base[1] + h, base[2] + dirz * d))
    prof = [(math.cos(TAU * i / 5 + 0.3) * 1.0, math.sin(TAU * i / 5 + 0.3) * 1.0) for i in range(10)]
    prof = [(1.0 * math.cos(TAU * i / 10) * (1 + 0.1 * math.cos(5 * TAU * i / 10)), 1.0 * math.sin(TAU * i / 10) * (1 + 0.1 * math.cos(5 * TAU * i / 10))) for i in range(10)]
    sc = lambda t: r * (0.35 + 0.65 * math.sin(math.pi * min(1.0, 0.12 + t * 0.9)) ** 0.6) * (0.55 if t > 0.96 or t < 0.03 else 1.0)

    def col(p, n):
        best = min(range(len(pts)), key=lambda i: (Vector(pts[i]) - p).length_squared)
        t = best / 20
        c = mix(BANANA, C("#3a2a12"), smoothstep(0.93, 1.0, t)) if t > 0.9 else (mix(C("#7a9a2a"), BANANA, smoothstep(0.0, 0.14, t)))
        return gloss_fruit(c, 0.7, 0.3)(p, n)

    lm.sweep(pts, prof, up=(0, 1, 0), scale_fn=sc, col=col, mat="glossy")


def fruit_bowl() -> Landmark:
    lm = Landmark("fruit-bowl", ao=0.8)
    TEAL = C("#25a3b8")
    CREAM = C("#fbf2dc")
    outer = smooth_profile([(0.0, 0.0), (6.4, 0.0), (6.6, 0.8), (7.6, 2.0), (10.8, 4.2), (13.0, 6.6), (13.7, 8.8)], 5)
    rim = [(13.9, 9.2), (13.6, 9.55), (13.1, 9.4)]
    inner = smooth_profile([(12.8, 8.9), (12.3, 7.0), (10.2, 4.4), (6.0, 2.4), (0.0, 2.2)], 5)
    prof = outer + rim + inner

    def bowl_col(p, n):
        if n.y > 0.2 and p.y > 2.0 and math.hypot(p.x, p.z) < 12.9 and p.y < 8.9:
            return china_gloss(CREAM, n, 0.1)
        if p.y > 8.6:
            return china_gloss(CREAM, n, 0.2)
        if p.y < 1.0:
            return china_gloss(C("#12707f"), n)
        return china_gloss(TEAL, n, 0.18)

    lm.lathe(with_breaks(prof, [1.0, 8.6]), segs=72, col=bowl_col, mat="glossy")
    surf = RevSurf(outer)
    for row, (y, n_, dr) in enumerate(((3.6, 22, 0.55), (5.5, 26, 0.5), (7.3, 30, 0.45))):
        for i in range(n_):
            az = TAU * (i + 0.5 * (row % 2)) / n_
            lm.decal(surf.painter(az, y), ngon(10, dr), CREAM, 0.08)
    # the heap: bottom ring, middle, top
    spots = [
        # (kind, x, y, z, r)
        ("o", 6.6, 6.2, 2.0, 3.6), ("a", -3.2, 6.4, 6.4, 3.4), ("g", -7.2, 6.3, -1.4, 3.3), ("o", -2.2, 6.5, -6.6, 3.5), ("a", 4.2, 6.4, -5.0, 3.4), ("p", 0.0, 5.3, 0.4, 3.0),
        ("o", 2.2, 10.0, 3.4, 3.3), ("a", -3.6, 10.2, 0.6, 3.3), ("l", 3.2, 9.6, -3.6, 2.5), ("g", 0.6, 11.2, -0.4, 3.0),
        ("a", 1.0, 13.6, 0.6, 3.2), ("o", -2.4, 13.3, 2.4, 3.0),
    ]
    for k, x, y, z, r in spots:
        if k == "o":
            fruit_orange(lm, (x, y, z), r)
        elif k == "a":
            fruit_apple(lm, (x, y, z), r, APPLE_RED, yaw=x, blush=C("#f5d36a"))
        elif k == "g":
            fruit_apple(lm, (x, y, z), r, APPLE_GREEN, yaw=z)
        elif k == "p":
            fruit_pear(lm, (x, y, z), r)
        elif k == "l":
            fruit_lemon(lm, (x, y, z), r)
    # bananas draped over the front-right rim
    for i, (ang, curve) in enumerate(((100, 1.0), (125, 0.9), (150, 0.8))):
        fruit_banana(lm, (3.0 - i * 0.2, 11.0 - i * 0.3, 5.5 + i * 0.3), ang, curve, 15.0, 1.3)
    # grapes hanging over the left rim
    gx = (-12.0, 8.0, 3.0)
    for i in range(34):
        t = i / 34
        ring = 1.0 - t
        ang = i * 2.39996
        x = gx[0] + math.cos(ang) * 2.2 * ring - 2.2 * t
        z = gx[2] + math.sin(ang) * 2.2 * ring
        y = gx[1] - t * 9.0
        lm.sphere(1.15, at=(x, y, z), segs=10, rings=7, col=gloss_fruit(GRAPE, 0.5, 0.5), mat="glossy")
    lm.rod((gx[0] + 1.0, gx[1] + 4.0, gx[2]), (gx[0], gx[1] + 0.8, gx[2]), 0.35, sides=6, col=STALK, mat="matte")
    return lm


BUILDERS = {"teapot": teapot, "fruit-bowl": fruit_bowl}

import kitchen_b  # noqa: E402,F401  (adds the rest to BUILDERS)
