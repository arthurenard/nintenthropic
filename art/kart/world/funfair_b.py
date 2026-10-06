"""The fun fair, continued: entrance arch, roller coaster, helter-skelter, food stall, hook-a-duck."""
import math
import random

from mathutils import Vector

from funfair import (BLUE, BRASS, CANDY, CREAM, DARK, GOLD, GREEN, HOT, LIGHTS, NAVY, ORANGE, PINK, PURPLE, RED, STEEL, TEAL, WARM, WHITE, YELLOW, BUILDERS,
                     bulb, candy, light, striped_rod)
from wlib import (C, Landmark, RevSurf, TAU, aim, arc_pts, basis_matrix, bezier, by_height, catmull, chrome, faceted, mix, mul, ngon, path_frames, shiny,
                  smooth_profile, smoothstep)
from wtext import Plane, text, text_width

SKY = C("#7fd4ff")


def onion(r, h, bulge=1.25):
    """An onion dome profile of base radius r and height h."""
    pts = [(r * 0.86, 0.0), (r * bulge * 0.97, h * 0.2), (r * bulge, h * 0.34), (r * bulge * 0.85, h * 0.52), (r * 0.5, h * 0.74), (r * 0.18, h * 0.92), (0.0, h)]
    return [(0.0, 0.0)] + smooth_profile(pts, 4)


# ─── Entrance arch ───────────────────────────────────────────────────────────


def entrance_arch() -> Landmark:
    lm = Landmark("entrance-arch", span=True, ao=0.6, ao_dist=6.0, rays=12)
    sec = lambda n, a, b, cx=0.0, cz=0.0: faceted(lambda p, nn: a if int(((math.atan2(p.z - cz, p.x - cx) % TAU) / TAU) * n) % 2 == 0 else b)
    for sx in (-1, 1):
        x = sx * 17.6
        lm.rbox((6.2, 2.6, 6.2), at=(x, 1.3, 0), bevel=0.5, col=by_height(0, 2.6, DARK, C("#6b58b8")), mat="lit")
        lm.cylinder(r=2.5, h=18.5, at=(x, 2.4, 0), segs=24, rb=0.3, rt=0.3, col=sec(24, RED, CREAM, cx=x), mat="glossy")
        lm.cylinder(r=3.2, h=1.0, at=(x, 20.7, 0), segs=24, rb=0.3, rt=0.3, col=candy(GOLD), mat="glossy")
        lm.cylinder(r=3.0, h=0.7, at=(x, 2.2, 0), segs=24, rb=0.2, rt=0.2, col=candy(GOLD), mat="glossy")
        lm.lathe([(r, y + 21.5) for r, y in onion(3.0, 5.6)], at=(x, 0, 0), segs=28, col=by_height(21.5, 27.1, RED, (1.0, 0.8, 0.35)), mat="glossy")
        lm.rod((x, 27.0, 0), (x, 30.2, 0), 0.14, sides=6, col=BRASS, mat="metal")
        lm.sphere(0.45, at=(x, 30.3, 0), segs=8, rings=6, col=GOLD, mat="metal")
        for k in range(4):
            a = TAU * (k + 0.5) / 4
            lm.rbox((0.9, 2.6, 0.2), at=(x + math.sin(a) * 2.45, 12.0, math.cos(a) * 2.45), rot=(0, math.degrees(a), 0), mat="glow", col=WARM)
        for k in range(10):
            a = TAU * k / 10
            bulb(lm, (x + math.cos(a) * 3.3, 20.2, math.sin(a) * 3.3), 0.34, light(k))
    # the arch between them
    arc = [(15.4 * math.cos(math.radians(a)), 13.0 + 7.6 * math.sin(math.radians(a)), 0.0) for a in range(0, 181, 6)]
    prof = [(1.25 * math.cos(TAU * i / 14), 0.85 * math.sin(TAU * i / 14)) for i in range(14)]
    lm.sweep(arc, prof, up=(0, 0, 1), col=candy(GOLD), mat="glossy")
    for i, p in enumerate(arc[1:-1:2]):
        bulb(lm, (p[0], p[1] - 1.45, p[2]), 0.34, light(i))
    # the sign, lit from within, on both faces
    lm.rbox((26.0, 7.4, 1.2), at=(0, 25.0, 0), bevel=0.35, col=NAVY, mat="glossy")
    lm.rbox((27.0, 0.7, 1.5), at=(0, 28.9, 0), bevel=0.2, col=candy(GOLD), mat="glossy")
    lm.rbox((27.0, 0.7, 1.5), at=(0, 21.1, 0), bevel=0.2, col=candy(GOLD), mat="glossy")
    for sg in (-1, 1):
        p = Plane((0, 25.0, sg * 0.62), (0, 0, sg), flip=True)
        text(lm, p, "FUN FAIR", 3.4, (1.0, 0.78, 0.25), at=(0.0, -1.7), lift=0.05, mat="glow", pad=0.1)
        for k in range(12):
            u = -12.0 + k * 2.2
            bulb(lm, (u * sg, 28.2, sg * 0.8), 0.3, light(k))
            bulb(lm, (u * sg, 21.8, sg * 0.8), 0.3, light(k + 4))
    for sx in (-1, 1):
        for k in range(4):
            bulb(lm, (sx * 12.9, 22.6 + k * 1.7, 0.0), 0.3, light(k + 2))
    return lm


# ─── Roller coaster ──────────────────────────────────────────────────────────


def coaster_path():
    wp = [
        (-14.5, 2.5, -16.0), (-14.5, 5.0, -13.5), (-14.5, 12.0, -11.0), (-14.5, 20.0, -9.0), (-14.0, 27.0, -7.0), (-12.5, 31.0, -4.8),
        (-8.0, 26.0, -3.0), (-2.0, 19.5, -1.2), (4.0, 18.0, 0.0), (10.0, 21.5, 1.4), (15.0, 22.0, 2.4), (17.2, 14.0, 3.6), (17.0, 7.5, 5.0),
    ]
    cx, loop_r, zc = 17.0, 8.0, 5.0
    for q in range(1, 24):
        th = TAU * q / 24
        wp.append((cx + 2.5 * th / TAU, 15.5 - loop_r * math.cos(th), zc + loop_r * math.sin(th)))
    wp += [(19.5, 7.5, 5.0), (19.0, 8.5, 11.0), (14.0, 11.5, 14.0), (6.0, 14.0, 15.2), (-2.0, 14.8, 15.6), (-9.0, 11.5, 16.0), (-14.5, 6.0, 16.0)]
    return wp


def coaster() -> Landmark:
    lm = Landmark("rollercoaster", span=True, ao=0.55, ao_dist=5.0, rays=10)
    wp = coaster_path()
    path = catmull(wp, 6)
    # resample to roughly even steps
    pts = [path[0]]
    for p in path[1:]:
        if (p - pts[-1]).length >= 0.9:
            pts.append(p)
    pts.append(path[-1])
    fr = path_frames(pts)
    n = len(pts)
    track_col = candy(RED)
    # the spine and two rails
    prof_spine = [(0.35 * math.cos(TAU * i / 10), 0.4 * math.sin(TAU * i / 10)) for i in range(10)]
    lm.sweep([tuple(p + fr[i][2] * -0.9) for i, p in enumerate(pts)], prof_spine, up=(0, 1, 0), col=candy(WHITE), mat="glossy")
    for sgn in (-1, 1):
        rail = [tuple(p + fr[i][1] * (sgn * 0.95) + fr[i][2] * 0.0) for i, p in enumerate(pts)]
        lm.tube(rail, r=0.24, sides=6, col=track_col, mat="glossy")
    # sleepers
    for i in range(0, n, 1):
        p = pts[i]
        t, s, u = fr[i]
        M = basis_matrix(p + u * -0.05, t, s, u)
        with lm.group(M=M):
            lm.rbox((2.3, 0.14, 0.34), at=(0, -0.3, 0), bevel=0.04, bseg=1, col=candy(WHITE), mat="glossy")
            lm.rod((0, -0.3, 0), (0, -0.85, 0), 0.1, sides=4, col=STEEL, mat="metal")
    # the lights along it
    for i in range(0, n, 3):
        p = pts[i]
        t, s, u = fr[i]
        bulb(lm, tuple(p + s * 1.35 + u * 0.12), 0.26, light(i // 3))
    # supports
    rnd = random.Random(2)
    for i in range(0, n, 7):
        p = pts[i]
        if abs(p.x) < 8.6 or p.y < 3.0:
            continue
        top = p + fr[i][2] * -0.95
        lm.cylinder(r=0.52, h=top.y - 0.3, at=(p.x, 0.0, p.z), segs=10, col=candy(WHITE), mat="glossy")
        lm.cylinder(r=0.95, h=0.5, at=(p.x, 0.0, p.z), segs=10, col=DARK, mat="lit")
        lm.sphere(0.6, at=(p.x, top.y - 0.4, p.z), segs=8, rings=6, col=candy(WHITE), mat="glossy")
    for i in range(0, n - 14, 14):
        a, b = pts[i], pts[i + 14]
        if abs(a.x) < 8.6 or abs(b.x) < 8.6 or a.y < 4 or b.y < 4:
            continue
        lm.rod((a.x, a.y * 0.55, a.z), (b.x, b.y * 0.25, b.z), 0.16, sides=5, col=STEEL, mat="metal")
        lm.rod((a.x, a.y * 0.25, a.z), (b.x, b.y * 0.55, b.z), 0.16, sides=5, col=STEEL, mat="metal")
    # a train on the lift hill
    colours = [YELLOW, ORANGE, PINK]
    for k in range(3):
        i = 14 + k * 4
        t, s, u = fr[i]
        M = basis_matrix(pts[i] + u * 0.45, t, s, u)
        with lm.group(M=M):
            lm.rbox((1.9, 0.9, 2.5), at=(0, 0.15, 0), bevel=0.3, col=candy(colours[k]), mat="glossy")
            lm.rbox((2.0, 0.3, 1.0), at=(0, 0.75, 0.9), bevel=0.1, col=candy(WHITE), mat="glossy")
            for sx in (-0.45, 0.45):
                lm.sphere(0.34, at=(sx, 1.1, -0.1), segs=8, rings=6, col=C("#ffcfa8"), mat="glossy")
                lm.rod((sx * 1.6, 0.8, -0.1), (sx * 1.6, 1.8, 0.1), 0.1, sides=4, col=C("#ffcfa8"), mat="glossy")
                lm.sphere(0.2, at=(sx * 1.6, 1.85, 0.1), segs=5, rings=4, col=C("#ffcfa8"), mat="glossy")
    return lm


# ─── Helter-skelter ──────────────────────────────────────────────────────────


def helter_skelter() -> Landmark:
    lm = Landmark("helter-skelter", ao=0.65, ao_dist=7.0, rays=14)
    sec = lambda n, a, b: faceted(lambda p, nn: a if int(((math.atan2(p.z, p.x) % TAU) / TAU) * n) % 2 == 0 else b)
    tr = lambda y: 5.2 - 1.6 * (y / 24.0) ** 1.1
    lm.cylinder(r=6.6, h=1.2, at=(0, -0.2, 0), segs=32, rb=0.3, rt=0.3, col=by_height(-0.2, 1.0, DARK, C("#6b58b8")), mat="lit")
    prof = [(0.0, 0.8)] + [(tr(y), y) for y in [0.8 + 23.2 * i / 12 for i in range(13)]] + [(4.2, 24.0), (4.7, 24.2), (4.7, 24.7), (4.1, 24.9), (0.0, 24.9)]
    lm.lathe(prof, segs=32, col=sec(16, RED, CREAM), mat="glossy")
    # the lantern room under the roof
    lm.cylinder(r=3.7, h=3.2, at=(0, 24.9, 0), segs=16, col=candy(CREAM), mat="glossy")
    for k in range(8):
        a = TAU * (k + 0.5) / 8
        lm.rbox((1.6, 2.0, 0.2), at=(math.sin(a) * 3.62, 26.5, math.cos(a) * 3.62), rot=(0, math.degrees(a), 0), mat="glow", col=WARM)
    lm.lathe(smooth_profile([(4.9, 28.1), (4.6, 28.6), (3.8, 30.4), (2.4, 32.6), (1.0, 34.3), (0.0, 35.4)], 4), segs=32, col=faceted(lambda p, n: C("#ffb42b") if int(((math.atan2(p.z, p.x) % TAU) / TAU) * 16) % 2 == 0 else C("#ff6a3a")), mat="glossy", closed=False)
    lm.rod((0, 35.0, 0), (0, 37.6, 0), 0.14, sides=5, col=BRASS, mat="metal")
    lm.prism_xy([(0.0, 0.0), (2.4, -0.5), (0.0, -1.0)], 0.1, at=(0.0, 37.4, 0.0), col=RED, mat="glossy")
    for k in range(16):
        a = TAU * k / 16
        bulb(lm, (math.cos(a) * 4.95, 28.1, math.sin(a) * 4.95), 0.28, light(k))
    # the slide, three turns down
    turns = 3
    steps = 36 * turns
    path = []
    for i in range(steps + 1):
        f = i / steps
        phi = -TAU * turns * (1 - f)
        y = 23.0 - 21.7 * f
        r = tr(y) + 1.9
        path.append((r * math.cos(phi), y, r * math.sin(phi)))
    end = Vector(path[-1])
    path += [(end.x, end.y - 0.12 * k, end.z + 1.4 * k) for k in range(1, 6)]
    slide_prof = [(-1.55, 0.85), (-1.25, 0.85), (-1.25, 0.28), (1.25, 0.28), (1.25, 0.85), (1.55, 0.85), (1.55, 0.0), (-1.55, 0.0)]
    n_helix = steps + 1
    lm.sweep(path, slide_prof, up=(0, 1, 0), col=faceted(lambda p, n: RED if int((((math.atan2(p.z, p.x) % TAU) / TAU) * 18) + p.y * 0.0) % 2 == 0 else CREAM), mat="glossy", caps=True)
    for k in range(0, steps, 5):
        x, y, z = path[k]
        a = math.atan2(z, x)
        r0 = tr(y)
        lm.rod((math.cos(a) * r0, y, math.sin(a) * r0), (math.cos(a) * (r0 + 2.4), y - 0.4, math.sin(a) * (r0 + 2.4)), 0.14, sides=5, col=STEEL, mat="metal")
    # the door, a lamp over it, a mat at the foot
    door = Plane((0, 0.0, tr(1.0) + 0.04), (0, 0, 1))
    lm.decal(door, [(u, v) for u, v in ([(-1.3, 0.0), (1.3, 0.0)] + [(1.3 * math.cos(math.radians(a)), 3.2 + 1.3 * math.sin(math.radians(a))) for a in range(0, 181, 20)])], C("#1b1236"), 0.1, "matte", rings=2)
    lm.rbox((3.4, 0.2, 3.2), at=(end.x, end.y - 0.7, end.z + 7.4), bevel=0.06, col=candy(ORANGE), mat="glossy")
    for k in range(3):
        bulb(lm, (-1.8 + k * 1.8, 5.2, tr(1.0) + 0.3), 0.3, light(k))
    return lm


# ─── Food stall ──────────────────────────────────────────────────────────────


def awning(m, x0, x1, y_back, z_back, y_front, z_front, n, ca, cb, drop=1.0):
    """A striped, scalloped awning sloping from the back down to the front, stripe by stripe."""
    w = (x1 - x0) / n
    length = math.hypot(z_front - z_back, y_front - y_back)
    pitch = math.degrees(math.atan2(y_back - y_front, z_front - z_back))
    for i in range(n):
        xc = x0 + (i + 0.5) * w
        c = ca if i % 2 == 0 else cb
        m.rbox((w - 0.02, 0.25, length + 0.1), at=(xc, (y_back + y_front) / 2, (z_back + z_front) / 2), rot=(pitch, 0, 0), bevel=0.06, bseg=1, col=candy(c), mat="glossy")
        # the scallop: a half-round hanging from the front edge
        semi = [((w / 2 - 0.02) * math.cos(math.radians(a)), -drop * math.sin(math.radians(a))) for a in range(0, 181, 20)]
        with m.group(at=(xc, y_front - 0.05, z_front)):
            m.prism_xy(semi, 0.25, col=candy(c), mat="glossy")


def food_stall() -> Landmark:
    lm = Landmark("food-stall", ao=0.7, ao_dist=5.0, rays=14)
    lm.rbox((14.4, 0.5, 9.4), at=(0.8, 0.0, 0.8), bevel=0.15, col=C("#3a2c6b"), mat="lit")
    lm.rbox((13.6, 15.5, 0.8), at=(0.8, 7.9, -3.8), bevel=0.2, col=candy(C("#ffe6f0")), mat="glossy")
    for sx in (-1, 1):
        lm.rbox((0.7, 15.0, 7.0), at=(0.8 + sx * 6.6, 7.7, -0.3), bevel=0.2, col=candy(C("#ffd0e4")), mat="glossy")
        striped_rod(lm, (0.8 + sx * 6.9, 0.2, 4.2), (0.8 + sx * 6.9, 14.0, 4.2), 0.4, 7, RED, CREAM, sides=8)
    lm.rbox((13.6, 4.4, 2.6), at=(0.8, 2.3, 2.6), bevel=0.3, col=candy(C("#ff4f78")), mat="glossy")
    lm.rbox((14.0, 0.45, 3.0), at=(0.8, 4.7, 2.6), bevel=0.15, col=candy(C("#fff1d6")), mat="glossy")
    awning(lm, -6.0, 7.6, 16.4, -3.9, 13.4, 4.6, 7, RED, CREAM, 1.2)
    lm.rbox((13.8, 0.3, 0.5), at=(0.8, 16.6, -3.9), bevel=0.1, col=candy(GOLD), mat="glossy")
    lm.rbox((10.4, 2.8, 0.6), at=(0.8, 17.3, -3.4), bevel=0.2, col=NAVY, mat="glossy")
    text(lm, Plane((0.8, 17.3, -3.08), (0, 0, 1)), "SWEETS", 1.7, (1.0, 0.65, 0.8), at=(0.0, -0.85), lift=0.04, mat="glow", pad=0.1)
    for i in range(7):
        bulb(lm, (-5.4 + i * 1.9, 13.2, 4.7), 0.3, light(i))
    # the shelf of jars at the back, and the candy-floss machine on the counter
    for row, y in enumerate((8.0, 11.0)):
        lm.rbox((12.0, 0.3, 1.6), at=(0.8, y, -3.1), bevel=0.06, col=C("#7a4a2a"), mat="glossy")
        for k in range(8):
            c = CANDY[(k + row * 3) % len(CANDY)]
            lm.cylinder(r=0.65, h=1.35, at=(-4.6 + k * 1.5 + 0.8, y + 0.15, -3.1), segs=10, rb=0.12, rt=0.12, col=candy(c), mat="glossy")
            lm.cylinder(r=0.45, h=0.3, at=(-4.6 + k * 1.5 + 0.8, y + 1.5, -3.1), segs=8, col=candy(GOLD), mat="metal")
    lm.cylinder(r=2.4, h=1.0, at=(-3.6, 4.95, 2.6), segs=20, rb=0.2, col=candy(C("#fff1d6")), mat="glossy")
    lm.cylinder(r=2.1, h=0.35, at=(-3.6, 5.95, 2.6), segs=20, col=candy(PINK), mat="glossy")
    lm.sphere(2.7, at=(-3.6, 8.4, 2.6), segs=16, rings=10, col=lambda p, n: mix(C("#ffb6d6"), C("#ffe6f2"), smoothstep(-0.4, 0.8, n.y)), mat="matte", disp=lambda p: 0.22 * math.sin(p.x * 3.1) * math.sin(p.y * 2.7 + p.z))
    for k, (c, sx) in enumerate(((C("#ffb6d6"), 2.0), (C("#9fd8ff"), 4.2), (C("#d7c0ff"), 6.4))):
        lm.rod((sx + 0.6, 5.2, 2.8), (sx + 0.6, 7.2, 2.8), 0.1, sides=5, col=C("#f4e6c8"), mat="matte")
        lm.sphere(1.1, at=(sx + 0.6, 8.0, 2.8), segs=12, rings=8, col=c, mat="matte", disp=lambda p: 0.12 * math.sin(p.x * 4.0) * math.sin(p.z * 3.0 + p.y))
    return lm


# ─── Hook-a-duck ─────────────────────────────────────────────────────────────

DUCK_Y = C("#ffd62e")


def duck(m, at=(0, 0, 0), yaw=0.0, k=1.0, col=DUCK_Y):
    with m.group(at=at, rot=(0, yaw, 0), scale=k):
        body = lambda p, n: mix(mul(col, 0.7), col, smoothstep(-0.5, 0.7, n.y)) if n.y < 0.8 else mix(col, (1.0, 1.0, 0.85), 0.35 * (n.y - 0.8) / 0.2)
        m.sphere(1.0, at=(0, 0.6, -0.1), scale=(0.95, 0.75, 1.25), segs=14, rings=9, col=body, mat="glossy")
        m.cone(r=0.45, h=0.8, at=(0, 0.8, -1.15), rot=(-70, 0, 0), segs=8, col=col, mat="glossy")
        m.sphere(0.62, at=(0, 1.5, 0.85), segs=14, rings=9, col=body, mat="glossy")
        m.sphere(1.0, at=(0, 1.38, 1.55), scale=(0.42, 0.18, 0.55), segs=10, rings=6, col=ORANGE, mat="glossy")
        for sx in (-1, 1):
            m.sphere(0.09, at=(sx * 0.38, 1.7, 1.32), segs=5, rings=4, col=C("#1a1224"), mat="matte")
            m.sphere(1.0, at=(sx * 0.82, 0.7, -0.15), scale=(0.2, 0.42, 0.75), rot=(0, 0, sx * 12), segs=8, rings=6, col=mul(col, 0.9), mat="glossy")


def hook_a_duck() -> Landmark:
    lm = Landmark("hook-a-duck", ao=0.7, ao_dist=5.0, rays=14)
    sec = lambda n, a, b, cx=0.0, cz=0.0: faceted(lambda p, nn: a if int(((math.atan2(p.z - cz, p.x - cx) % TAU) / TAU) * n) % 2 == 0 else b)
    lm.rbox((16.0, 0.4, 11.0), at=(0, 0.0, 0.6), bevel=0.12, col=C("#3a2c6b"), mat="lit")
    # the pool
    lm.cylinder(r=5.6, h=2.0, at=(0, 0.2, 2.6), segs=36, rb=0.3, rt=0.3, col=sec(24, RED, CREAM, cz=2.6), mat="glossy")
    lm.cylinder(r=5.0, h=0.2, at=(0, 2.05, 2.6), segs=36, col=(0.35, 0.85, 1.0), mat="glass")
    lm.cylinder(r=4.9, h=1.5, at=(0, 0.6, 2.6), segs=30, col=C("#2b9ed0"), mat="glossy")
    # the booth behind it
    lm.rbox((15.2, 11.0, 0.8), at=(0, 5.7, -3.9), bevel=0.2, col=candy(C("#fff1d6")), mat="glossy")
    for sx in (-1, 1):
        lm.rbox((0.8, 11.0, 4.0), at=(sx * 7.4, 5.7, -1.8), bevel=0.2, col=candy(C("#ffe0a0")), mat="glossy")
        striped_rod(lm, (sx * 7.4, 0.2, 2.2), (sx * 7.4, 11.0, 2.2), 0.4, 6, BLUE, CREAM, sides=8)
    awning(lm, -7.6, 7.6, 11.6, -3.5, 10.2, 2.6, 8, BLUE, CREAM, 0.9)
    # a plush shelf, and the big duck on the roof
    lm.rbox((13.0, 0.3, 1.4), at=(0, 5.2, -3.2), bevel=0.06, col=C("#7a4a2a"), mat="glossy")
    for k in range(5):
        c = (C("#a86a3a"), C("#ff9fb4"), C("#9fd8ff"), C("#ffe27a"), C("#cfa8ff"))[k]
        lm.sphere(1.0, at=(-5.0 + k * 2.5, 6.2, -3.0), scale=(0.95, 1.0, 0.8), segs=10, rings=7, col=c, mat="matte")
        lm.sphere(0.6, at=(-5.0 + k * 2.5, 7.45, -3.0), segs=10, rings=7, col=c, mat="matte")
        for sx in (-1, 1):
            lm.sphere(0.25, at=(-5.0 + k * 2.5 + sx * 0.5, 7.9, -3.0), segs=6, rings=4, col=c, mat="matte")
    duck(lm, at=(0, 11.6, -2.6), yaw=0.0, k=2.1)
    lm.rbox((9.0, 2.0, 0.5), at=(0, 9.0, 2.9), bevel=0.15, col=NAVY, mat="glossy")
    text(lm, Plane((0, 9.0, 3.17), (0, 0, 1)), "DUCKS", 1.4, (1.0, 0.82, 0.3), at=(0.0, -0.7), lift=0.04, mat="glow", pad=0.1)
    for i in range(8):
        bulb(lm, (-7.0 + i * 2.0, 10.1, 2.9), 0.28, light(i))
    # ducks on the water, bobbing and drifting round
    for k in range(4):
        a = TAU * k / 4 + 0.4
        d = lm.spin(f"duck{k}", "y", (0, 2.2, 2.6), 0.28 * (1 if k % 2 == 0 else -1), bob=0.22, bobspeed=1.6 + 0.2 * k, phase=k * 1.3)
        duck(d, at=(math.cos(a) * 3.1, 2.15, 2.6 + math.sin(a) * 3.1), yaw=math.degrees(-a) + 90, k=0.95, col=DUCK_Y if k != 2 else C("#ffb52e"))
    # the hook-a-duck poles
    for sx in (-1, 1):
        lm.rod((sx * 6.2, 0.2, 5.8), (sx * 6.2, 5.0, 5.8), 0.12, sides=5, col=STEEL, mat="metal")
        lm.torus(R=0.5, r=0.07, at=(sx * 6.2, 5.2, 5.8), rot=(90, 0, 0), segs=14, sides=5, col=STEEL, mat="metal")
    return lm


BUILDERS.update({
    "big-top": BUILDERS["big-top"],
    "rollercoaster": coaster,
    "entrance-arch": entrance_arch,
    "food-stall": food_stall,
    "hook-a-duck": hook_a_duck,
    "helter-skelter": helter_skelter,
})
