"""The fun fair's landmarks: dusk, every ride lit. Candy colours, brass, and bulbs everywhere (the glowing material, one
sphere each)."""
import math
import random

from mathutils import Vector

from wlib import (C, Landmark, RevSurf, TAU, aim, arc_pts, bezier, by_height, catmull, chrome, cyl_profile, faceted, mix, mul, ngon, petal, rot2, shiny,
                  smooth_profile, smoothstep, with_breaks)
from wtext import Plane, text, text_width

RED = C("#ff3355")
ORANGE = C("#ff8a2a")
YELLOW = C("#ffd23a")
GREEN = C("#37d67a")
TEAL = C("#1fc8c8")
BLUE = C("#3b82ff")
PURPLE = C("#9a5cff")
PINK = C("#ff6fb7")
CREAM = C("#fff1d6")
WHITE = C("#ffffff")
NAVY = C("#2a2150")
DARK = C("#241a45")
GOLD = C("#ffc233")
BRASS = C("#e8b84a")
STEEL = C("#c9cde0")
CANDY = [RED, ORANGE, YELLOW, GREEN, TEAL, BLUE, PURPLE, PINK]
LIGHTS = [(1.0, 0.32, 0.42), (1.0, 0.68, 0.2), (1.0, 1.0, 0.5), (0.3, 1.0, 0.5), (0.25, 0.9, 1.0), (0.4, 0.5, 1.0), (0.8, 0.4, 1.0), (1.0, 0.45, 0.78)]
WARM = (1.0, 0.82, 0.5)
HOT = (1.0, 0.95, 0.8)


def light(i):
    return LIGHTS[i % len(LIGHTS)]


def bulb(m, p, r=0.34, col=WARM):
    m.sphere(r, at=tuple(p), segs=6, rings=4, col=col, mat="glow")


def striped_rod(m, a, b, r, n, ca, cb, sides=10, mat="glossy"):
    a, b = Vector(a), Vector(b)
    d = b - a
    ln = d.length
    dn = d / ln
    eps = 0.02 / n
    path = []
    for i in range(n):
        path += [a + d * (i / n + eps), a + d * ((i + 1) / n - eps)]
    path = [a] + path + [b]

    def col(p, nrm):
        t = max(0.0, min(0.999, (p - a).dot(dn) / ln))
        return mix(ca, cb, 1.0) if int(t * n) % 2 else ca

    m.tube([tuple(p) for p in path], r=r, sides=sides, col=col, mat=mat)


def candy(c, k=0.3):
    return shiny(c, k)


# ─── Ferris wheel ────────────────────────────────────────────────────────────


def ferris_wheel() -> Landmark:
    lm = Landmark("ferris-wheel", ao=0.7, ao_dist=7.0, rays=16)
    R, HUB, N, ZS, W = 22.0, 27.0, 14, 2.4, 0.14
    # the boarding platform, the A-frame and the sign
    lm.rbox((42.0, 1.6, 26.0), at=(0, -0.5, 0), bevel=0.4, col=by_height(-1.3, 0.3, C("#1d1440"), C("#4b3a8c")), mat="lit")
    lm.rbox((12.0, 0.5, 4.0), at=(0, 0.3, 14.5), bevel=0.15, col=C("#6a56b8"), mat="lit")
    lm.rbox((12.0, 0.5, 4.0), at=(0, -0.2, 14.5), bevel=0.15, col=C("#3b2c72"), mat="lit")

    def leg(sx, s, y):
        t = (HUB - y) / (HUB + 1.5)
        return (sx * 16.0 * t, y, s * (5.0 + 3.6 * t))

    for s in (-1, 1):
        for sx in (-1, 1):
            striped_rod(lm, leg(sx, s, HUB), leg(sx, s, -1.5), 0.62, 9, RED, CREAM)
            lm.rbox((3.0, 1.2, 3.0), at=(sx * 16.0, -0.1, s * 8.6), bevel=0.3, col=C("#2b2058"), mat="lit")
        for y in (7.0, 15.0):
            lm.rod(leg(-1, s, y), leg(1, s, y), 0.38, sides=8, col=STEEL, mat="metal")
    for sx in (-1, 1):
        for y in (7.0, 15.0):
            lm.rod(leg(sx, -1, y), leg(sx, 1, y), 0.38, sides=8, col=STEEL, mat="metal")
        lm.rod(leg(sx, -1, 7.0), leg(sx, 1, 15.0), 0.26, sides=6, col=STEEL, mat="metal")
        lm.rod(leg(sx, 1, 7.0), leg(sx, -1, 15.0), 0.26, sides=6, col=STEEL, mat="metal")
    # the marquee at the foot
    for sx in (-1, 1):
        lm.rod((sx * 6.5, 0.0, 9.6), (sx * 6.5, 6.0, 9.6), 0.45, sides=8, col=STEEL, mat="metal")
    lm.rbox((16.0, 5.0, 0.8), at=(0, 6.2, 9.8), bevel=0.2, col=NAVY, mat="glossy")
    sign = Plane((0, 6.2, 10.22), (0, 0, 1))
    text(lm, sign, "BIG WHEEL", 2.0, (1.0, 0.8, 0.3), at=(0.0, -1.0), lift=0.06, mat="glow", pad=0.12)
    for i in range(16):
        u = -7.6 + i * 1.0
        bulb(lm, (u, 8.55, 10.3), 0.26, light(i))
        bulb(lm, (u, 3.85, 10.3), 0.26, light(i + 3))
    for i in range(4):
        bulb(lm, (-7.6, 4.5 + i * 1.1, 10.3), 0.26, light(i + 1))
        bulb(lm, (7.6, 4.5 + i * 1.1, 10.3), 0.26, light(i + 5))

    # the wheel
    w = lm.spin("wheel", "z", (0, HUB, 0), W)

    def sector(i, a, b):
        def f(p, n):
            ang = math.atan2(p.y - HUB, p.x)
            return a if int(((ang % TAU) / TAU) * 28) % 2 == 0 else b
        return faceted(f)

    for s in (-1, 1):
        z = s * ZS
        w.torus(R=R, r=0.55, at=(0, HUB, z), rot=(90, 0, 0), segs=84, sides=10, col=sector(0, WHITE, PINK), mat="glossy")
        w.torus(R=11.0, r=0.4, at=(0, HUB, z), rot=(90, 0, 0), segs=56, sides=8, col=sector(0, WHITE, TEAL), mat="glossy")
        for k in range(N):
            a = TAU * k / N
            ca, sa = math.cos(a), math.sin(a)
            half = TAU * (k + 0.5) / N
            w.rod((0, HUB, z), (ca * R, HUB + sa * R, z), 0.36, sides=6, col=STEEL, mat="metal")
            w.rod((ca * 11.0, HUB + sa * 11.0, z), (math.cos(half) * R, HUB + math.sin(half) * R, z), 0.26, sides=5, col=WHITE, mat="glossy")
            w.rod((math.cos(half) * R, HUB + math.sin(half) * R, z), (math.cos(a + TAU / N) * 11.0, HUB + math.sin(a + TAU / N) * 11.0, z), 0.26, sides=5, col=WHITE, mat="glossy")
        for k in range(28):
            a = TAU * k / 28 + 0.05
            bulb(w, (math.cos(a) * (R + 0.9), HUB + math.sin(a) * (R + 0.9), z), 0.34, light(k))
        for k in range(14):
            a = TAU * k / 14
            bulb(w, (math.cos(a) * 11.7, HUB + math.sin(a) * 11.7, z), 0.26, light(k + 2))
        for k in range(4):
            a = TAU * k / 8
            w.rod((math.cos(a) * -4.0, HUB + math.sin(a) * -4.0, s * 6.75), (math.cos(a) * 4.0, HUB + math.sin(a) * 4.0, s * 6.75), 0.3, sides=6, col=light(k * 2 + 1), mat="glow")
        w.cylinder(r=1.6, h=0.4, at=(0, HUB, s * 6.95), rot=(90, 0, 0), segs=14, col=HOT, mat="glow", centered=True)
    for k in range(N):
        a = TAU * k / N
        w.rod((math.cos(a) * R, HUB + math.sin(a) * R, -ZS), (math.cos(a) * R, HUB + math.sin(a) * R, ZS), 0.4, sides=6, col=STEEL, mat="metal")
    w.cylinder(r=2.5, h=12.4, at=(0, HUB, 0), rot=(90, 0, 0), segs=20, rb=0.3, rt=0.3, col=chrome(C("#6b6f9a"), C("#e6e9fa")), mat="metal", centered=True)
    w.cylinder(r=3.5, h=5.0, at=(0, HUB, 0), rot=(90, 0, 0), segs=24, rb=0.5, rt=0.5, col=candy(RED), mat="glossy", centered=True)

    # the cars: each hangs from its own pin and stays upright, travelling the circle without turning
    for k in range(N):
        a = TAU * k / N + 0.2
        px, py = R * math.cos(a), HUB + R * math.sin(a)
        c = CANDY[k % len(CANDY)]
        car = lm.orbit(f"car{k}", "z", (px, py, 0.0), W, (0.0, HUB, 0.0))
        car.rbox((0.45, 0.45, 2 * ZS + 0.3), at=(px, py, 0), col=STEEL, mat="metal")
        for s in (-1, 1):
            car.rod((px, py, s * ZS), (px, py - 1.7, s * 0.7), 0.26, sides=6, col=STEEL, mat="metal")
        car.cone(r=2.5, h=1.6, at=(px, py - 3.1, 0), segs=16, rb=0.2, col=candy(mix(c, WHITE, 0.25)), mat="glossy")
        car.cylinder(r=1.85, h=2.7, at=(px, py - 5.9, 0), segs=16, rb=0.3, rt=0.1, col=candy(c), mat="glossy")
        car.cylinder(r=2.0, h=0.4, at=(px, py - 6.05, 0), segs=16, col=CREAM, mat="glossy")
        car.cylinder(r=2.0, h=0.3, at=(px, py - 3.4, 0), segs=16, col=CREAM, mat="glossy")
        for q in range(4):
            th = math.pi / 4 + q * math.pi / 2
            car.rbox((0.95, 1.0, 0.16), at=(px + math.sin(th) * 1.8, py - 4.5, math.cos(th) * 1.8), rot=(0, math.degrees(th), 0), mat="glow", col=WARM)
        bulb(car, (px, py - 1.35, 0), 0.34, light(k))
    return lm


# ─── Carousel ────────────────────────────────────────────────────────────────

HORSE_COATS = [(C("#fbf5ee"), RED, BLUE), (C("#c88a4f"), CREAM, RED), (C("#ffd1e0"), PURPLE, TEAL), (C("#7fd4c0"), YELLOW, PINK)]


def horse(m, coat, mane, saddle):
    dark = mul(coat, 0.62)
    body = lambda p, n: mix(dark, coat, smoothstep(-0.6, 0.6, n.y))
    S = dict(segs=12, rings=8, mat="glossy")
    m.sphere(1.0, at=(0, 0, -0.1), scale=(0.8, 0.85, 1.45), col=body, **S)
    m.sphere(1.0, at=(0, 0.2, 0.95), scale=(0.74, 0.88, 0.8), col=body, **S)
    m.sphere(1.0, at=(0, 0.1, -1.0), scale=(0.8, 0.85, 0.75), col=body, **S)
    neck = [(0, 0.55, 1.05), (0, 1.1, 1.35), (0, 1.75, 1.65)]
    m.tube(neck, r=0.52, sides=8, scale_fn=lambda t: 1.0 - 0.22 * t, col=body, mat="glossy")
    m.sphere(1.0, at=(0, 2.05, 2.1), scale=(0.52, 0.55, 0.95), rot=(35, 0, 0), col=body, **S)
    m.sphere(0.4, at=(0, 1.82, 2.62), scale=(1.0, 0.9, 1.0), col=mix(coat, WHITE, 0.35), **S)
    for sx in (-1, 1):
        m.cone(r=0.16, h=0.45, at=(sx * 0.24, 2.4, 1.7), rot=(-10, 0, sx * 8), segs=6, col=dark, mat="matte")
        m.sphere(0.1, at=(sx * 0.4, 2.15, 2.35), segs=6, rings=4, col=C("#1a1224"), mat="matte")
    for i in range(3):
        m.sphere(1.0, at=(0, 1.15 + i * 0.42, 0.62 + i * 0.3), scale=(0.2, 0.3, 0.3), col=mane, segs=6, rings=5, mat="glossy")
    m.sphere(1.0, at=(0, 2.2, 1.95), scale=(0.15, 0.3, 0.3), col=mane, segs=6, rings=5, mat="glossy")
    m.tube([(0, 0.4, -1.5), (0, 0.3, -1.95), (0, -0.4, -2.2), (0, -1.0, -2.0)], r=0.3, sides=6, scale_fn=lambda t: 0.6 + 0.9 * t, col=mane, mat="glossy")
    m.rbox((1.2, 0.18, 1.3), at=(0, 0.88, -0.15), bevel=0.06, col=saddle, mat="glossy")
    m.rbox((1.28, 0.06, 0.2), at=(0, 0.97, -0.15), col=GOLD, mat="glossy")
    for sx, sz, reach in ((-1, 1, 0.8), (1, 1, 0.8), (-1, -1, -0.7), (1, -1, -0.7)):
        top = (sx * 0.42, -0.35, sz * 0.9)
        knee = (sx * 0.42, -1.1, sz * 0.9 + reach * 0.45)
        foot = (sx * 0.42, -1.15, sz * 0.9 + reach * 0.9 - 0.2)
        m.tube([top, knee], r=0.3, sides=6, col=coat, mat="glossy")
        m.tube([knee, foot], r=0.24, sides=6, col=mix(coat, GOLD, 0.35), mat="glossy")
        m.sphere(0.25, at=(foot[0], foot[1] - 0.05, foot[2]), segs=6, rings=4, col=GOLD, mat="metal")


def ostrich(m, body, feather):
    S = dict(segs=12, rings=8, mat="glossy")
    skin = mix(body, WHITE, 0.3)
    m.sphere(1.0, at=(0, 0, 0), scale=(1.0, 0.95, 1.4), col=lambda p, n: mix(mul(body, 0.6), body, smoothstep(-0.5, 0.6, n.y)), **S)
    m.sphere(1.0, at=(0, 0.2, -1.35), scale=(0.6, 0.7, 0.8), col=feather, **S)
    m.sphere(1.0, at=(0, 0.15, -1.9), scale=(0.5, 0.55, 0.6), col=feather, **S)
    for sx in (-1, 1):
        m.sphere(1.0, at=(sx * 0.95, 0.1, -0.1), scale=(0.2, 0.55, 0.9), col=mul(feather, 0.85), **S)
    m.tube([(0, 0.4, 0.9), (0, 1.4, 1.1), (0, 2.1, 1.3), (0, 2.55, 1.5)], r=0.42, sides=8, scale_fn=lambda t: 1.0 - 0.3 * t, col=skin, mat="glossy")
    m.sphere(1.0, at=(0, 2.72, 1.68), scale=(0.3, 0.28, 0.4), col=skin, **S)
    m.cone(r=0.12, h=0.55, at=(0, 2.62, 2.15), rot=(90, 0, 0), segs=6, col=ORANGE, mat="glossy")
    for sx in (-1, 1):
        m.sphere(0.07, at=(sx * 0.2, 2.8, 1.9), segs=5, rings=4, col=DARK, mat="matte")
        m.tube([(sx * 0.4, -0.3, 0.1), (sx * 0.45, -1.5, 0.5), (sx * 0.45, -2.3, 0.15)], r=0.2, sides=6, col=ORANGE, mat="glossy")
        m.rbox((0.4, 0.14, 0.7), at=(sx * 0.45, -2.35, 0.4), col=ORANGE, bevel=0.05, mat="glossy")
    m.rbox((1.0, 0.16, 1.1), at=(0, 0.95, 0), col=RED, bevel=0.05, mat="glossy")


def cat(m, body, stripe):
    S = dict(segs=12, rings=8, mat="glossy")
    m.sphere(1.0, at=(0, 0, -0.1), scale=(0.9, 0.85, 1.3), col=lambda p, n: mix(mul(body, 0.6), body, smoothstep(-0.5, 0.6, n.y)), **S)
    m.sphere(1.0, at=(0, 0.5, 0.95), scale=(0.75, 0.75, 0.7), col=body, **S)
    for sx in (-1, 1):
        m.cone(r=0.26, h=0.55, at=(sx * 0.42, 1.1, 0.95), segs=6, col=body, mat="glossy")
        m.sphere(0.1, at=(sx * 0.28, 0.75, 1.55), segs=5, rings=4, col=DARK, mat="matte")
        for q in (-1, 1):
            m.rod((sx * 0.3, 0.45 + q * 0.06, 1.6), (sx * 0.95, 0.5 + q * 0.18, 1.72), 0.03, sides=4, col=WHITE, mat="matte")
        m.tube([(sx * 0.5, -0.2, 0.9), (sx * 0.5, -1.3, 1.05)], r=0.38, sides=6, col=body, mat="glossy")
        m.tube([(sx * 0.5, -0.1, -0.9), (sx * 0.5, -1.2, -1.1)], r=0.42, sides=6, col=body, mat="glossy")
    m.sphere(0.14, at=(0, 0.3, 1.62), segs=5, rings=4, col=PINK, mat="glossy")
    for k in range(3):
        m.rbox((1.5, 0.14, 0.18), at=(0, 0.88 - k * 0.0, -0.6 + k * 0.5), col=stripe, mat="glossy")
    tail = [(0, 0.2 + math.sin(t * 3.4) * 1.5, -1.3 - math.sin(t * 2.2) * 0.9 + t * 0.4) for t in [i / 7 for i in range(8)]]
    m.tube(tail, r=0.2, sides=6, col=stripe, mat="glossy")
    m.rbox((0.9, 0.14, 0.9), at=(0, 0.9, 0), col=TEAL, mat="glossy")


def carousel() -> Landmark:
    lm = Landmark("carousel", ao=0.7, ao_dist=8.0, rays=14)
    RP, DECK, TOP = 12.5, 1.4, 11.8
    # the stage the ride turns on
    stage = [(0.0, -1.5), (14.0, -1.5), (14.4, 0.0), (13.2, 1.0), (0.0, 1.0)]
    lm.lathe(stage, segs=48, col=by_height(-1.5, 1.0, DARK, C("#6b58b8")), mat="lit")
    for k in range(24):
        a = TAU * k / 24
        bulb(lm, (math.cos(a) * 14.1, 0.5, math.sin(a) * 14.1), 0.4, light(k))
    lm.rbox((6.0, 1.2, 3.0), at=(0, -0.1, 15.5), bevel=0.25, col=by_height(-0.7, 0.5, DARK, C("#6b58b8")), mat="lit")
    # the turning deck, canopy and column
    d = lm.spin("deck", "y", (0, 0, 0), -0.2)
    sec = lambda n, a, b: faceted(lambda p, nn: a if int(((math.atan2(p.z, p.x) % TAU) / TAU) * n) % 2 == 0 else b)
    d.cylinder(r=RP, h=0.4, at=(0, DECK - 0.4, 0), segs=40, col=sec(20, C("#f4e7c8"), C("#6b8fe0")), mat="lit")
    d.lathe([(0.0, DECK - 0.6), (RP + 0.4, DECK - 0.6), (RP + 0.4, DECK + 0.9), (RP + 0.05, DECK + 0.9), (RP + 0.05, DECK), (0, DECK)], segs=80, col=sec(40, RED, CREAM), mat="glossy")
    for k in range(20):
        a = TAU * (k + 0.5) / 20
        d.rbox((0.5, 0.35, 0.5), at=(math.cos(a) * (RP + 0.55), DECK + 1.05, math.sin(a) * (RP + 0.55)), rot=(0, math.degrees(-a), 0), col=GOLD, mat="metal")
        bulb(d, (math.cos(a) * (RP + 0.7), DECK - 0.25, math.sin(a) * (RP + 0.7)), 0.4, light(k))
    d.cylinder(r=2.8, h=TOP - DECK - 0.4, at=(0, DECK, 0), segs=16, rb=0.3, col=by_height(DECK, TOP, mul(BRASS, 0.7), BRASS), mat="metal")
    for k in range(8):
        a = TAU * (k + 0.5) / 8
        d.rbox((1.5, TOP - DECK - 3.2, 0.14), at=(math.sin(a) * 2.9, (DECK + TOP) / 2 - 0.2, math.cos(a) * 2.9), rot=(0, math.degrees(a), 0), mat="glow", col=(0.75 + 0.1 * (k % 2), 0.9, 1.0))
    for y in (3.6, 6.0, 8.4):
        d.torus(R=2.85, r=0.2, at=(0, y, 0), segs=24, sides=6, col=BRASS, mat="metal")
    canopy = [(13.8, TOP), (12.0, TOP + 0.9), (8.5, TOP + 2.0), (5.0, TOP + 3.2), (2.4, TOP + 4.2), (1.0, TOP + 4.8), (0.0, TOP + 6.0)]
    d.lathe(smooth_profile(canopy, 4), segs=40, col=faceted(lambda p, n: mix(RED, WHITE, min(0.4, (p.y - TOP) * 0.06)) if int(((math.atan2(p.z, p.x) % TAU) / TAU) * 20) % 2 == 0 else CREAM), mat="glossy", closed=False)
    semi = [(1.7 * math.cos(math.radians(a)), -1.4 * math.sin(math.radians(a))) for a in range(0, 181, 15)]
    for i in range(20):
        a = TAU * (i + 0.5) / 20
        with d.group(at=(math.cos(a) * 13.7, TOP, math.sin(a) * 13.7), rot=(0, -math.degrees(a) - 90, 0)):
            d.prism_xy(semi, 0.3, col=RED if i % 2 == 0 else CREAM, mat="glossy")
            d.sphere(0.24, at=(0, -1.55, 0), segs=6, rings=4, col=GOLD, mat="metal")
    for k in range(20):
        a = TAU * k / 20
        bulb(d, (math.cos(a) * 13.3, TOP - 0.3, math.sin(a) * 13.3), 0.5, light(k))
    for k in range(10):
        a = TAU * k / 10
        bulb(d, (math.cos(a) * 7.0, TOP + 0.4, math.sin(a) * 7.0), 0.4, light(k + 2))
    d.rod((0, TOP + 5.8, 0), (0, TOP + 8.6, 0), 0.18, sides=6, col=BRASS, mat="metal")
    d.sphere(0.5, at=(0, TOP + 8.7, 0), segs=10, rings=6, col=GOLD, mat="metal")
    d.prism_xy([(0.0, 0.0), (2.8, -0.55), (0.0, -1.2)], 0.1, at=(0.0, TOP + 8.2, 0), col=RED, mat="glossy")
    # mounts and their poles
    mA = lm.spin("mountsA", "y", (0, 0, 0), -0.2, bob=0.8, bobspeed=1.7, phase=0.0)
    mB = lm.spin("mountsB", "y", (0, 0, 0), -0.2, bob=0.8, bobspeed=1.7, phase=math.pi)

    def mount(k, r, a, kind):
        x, z = math.cos(a) * r, math.sin(a) * r
        d.rod((x, DECK, z), (x, TOP - 0.3, z), 0.2, sides=6, col=BRASS, mat="metal")
        d.sphere(0.42, at=(x, TOP - 0.45, z), segs=8, rings=5, col=GOLD, mat="metal")
        m = mA if k % 2 == 0 else mB
        coat, mane, saddle = HORSE_COATS[k % 4]
        lift = (4.6, 4.9, 4.4)[kind]
        with m.group(at=(x, DECK + lift + 0.4, z), rot=(0, -math.degrees(a), 0), scale=1.3):
            (horse, ostrich, cat)[kind](m, *((coat, mane, saddle) if kind == 0 else (coat, mane if kind == 1 else saddle)))

    for k in range(8):
        mount(k, 10.0, TAU * k / 8, 0)
    for k in range(4):
        mount(k + 8, 6.4, TAU * (k + 0.5) / 4 + 0.4, 1 if k % 2 == 0 else 2)
    return lm


# ─── Big top (a tunnel of stripes) ───────────────────────────────────────────


def big_top() -> Landmark:
    lm = Landmark("big-top", span=True, ao=0.5, ao_dist=6.0, rays=10)
    L = 56.0
    w = 19.0
    wall, ridge = 6.5, 17.2
    half = [(-w * math.cos(math.pi / 2 * k / 9), wall + (ridge - wall) * math.sin(math.pi / 2 * k / 9)) for k in range(0, 9)]
    section = [(-w, -0.4)] + half + [(0.0, ridge)] + [(-x, y) for x, y in reversed(half)] + [(w, -0.4)]
    zs = [-28.0] + [-27.5 + 2.5 * k for k in range(0, 23)] + [28.0]
    zs = sorted(set(round(z, 3) for z in zs if -28.0 <= z <= 28.0))
    stripe = lambda a, b: faceted(lambda p, n: a if int((p.z + 30.0) / 5.0) % 2 == 0 else b)
    rings = [[(x, y, z) for x, y in section] for z in zs]
    lm.loft(rings, closed=False, caps=False, col=stripe(C("#e8102c"), C("#fff4d8")), mat="glass", ref=(0, 6, 0), facing="out")
    glow_rings = [[(x * 0.985, y * 0.985, z) for x, y in section] for z in zs]
    lm.loft(glow_rings, closed=False, caps=False, col=stripe((0.95, 0.2, 0.27), (0.9, 0.74, 0.5)), mat="glow", ref=(0, 6, 0), facing="in")
    # ribs inside, hung with bulbs, and the ridge beam
    for z in (-27.0, -15.0, -3.0, 9.0, 21.0, 27.6):
        path = [(x * 0.975, y * 0.975, z) for x, y in section]
        lm.tube(path, r=0.34, sides=6, col=STEEL, mat="metal", caps=True)
        for k in range(1, len(section) - 1, 2):
            x, y = section[k]
            bulb(lm, (x * 0.95, y * 0.95, z), 0.4, light(k + int(z)))
    lm.rod((0, ridge * 0.985, -L / 2 + 0.5), (0, ridge * 0.985, L / 2 - 0.5), 0.45, sides=8, col=STEEL, mat="metal")
    for i in range(19):
        bulb(lm, (0, ridge - 0.9, -26.5 + i * 3.0), 0.4, light(i))
    # the portals: a candy-striped frame round each mouth, with a flag on the ridge above
    for sgn in (-1, 1):
        zz = sgn * (L / 2 + 0.1)
        outline = [(x * 1.005, y * 1.005, zz) for x, y in section]
        lm.tube(outline, r=0.62, sides=8, col=candy(GOLD), mat="glossy")
        for k in range(1, len(section) - 1):
            x, y = section[k]
            bulb(lm, (x * 1.0, y * 1.0 + 0.0, zz + sgn * 0.7), 0.42, light(k * 3))
        lm.rod((0, ridge, sgn * 27.0), (0, ridge + 5.0, sgn * 27.0), 0.14, sides=5, col=STEEL, mat="metal")
        with lm.group(at=(0.0, ridge + 5.0, sgn * 27.0), rot=(0, 90, 0)):
            lm.prism_xy([(0.0, 0.0), (3.2, -0.65), (0.0, -1.3)], 0.12, col=RED if sgn > 0 else YELLOW, mat="glossy")
    return lm


BUILDERS = {"ferris-wheel": ferris_wheel, "carousel": carousel, "big-top": big_top}

import funfair_b  # noqa: E402,F401
