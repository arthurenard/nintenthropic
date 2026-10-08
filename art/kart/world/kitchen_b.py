"""The kitchen, continued: toaster, grater, salt, pepper, cookbooks, cereal, mug, utensil arches, wall clock."""
import math
import random

from mathutils import Vector

from kitchen import (APPLE_RED, BLACK, BLUE, BLUE_DEEP, BLUE_PALE, CHINA, GOLD, STEEL, STEEL_DK, WHITE, china_gloss, glossy, gloss_fruit, noise)
from wlib import C, Landmark, RevSurf, TAU, aim, arc_pts, bezier, catmull, chrome, mix, mul, ngon, petal, rot2, shift2, shiny, smooth_profile, smoothstep, with_breaks
from wtext import Plane, text, text_width

BAKELITE = C("#2a2422")
RED = C("#e0412e")


def poly_scale(poly, k, c=None):
    c = c or (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
    return [(c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k) for x, y in poly]


# ─── Toaster ─────────────────────────────────────────────────────────────────


def bread(w, h, r=1.4):
    """A slice of bread, in x (centred) and y (from 0): a square with two rounded shoulders."""
    lobe = w * 0.27
    cx = w * 0.225
    pts = []
    for a in range(-90, 1, 15):
        pts.append((w / 2 - r + r * math.cos(math.radians(a)), r + r * math.sin(math.radians(a))))
    theta_end = math.degrees(math.acos(-cx / lobe))
    for i in range(0, 13):
        a = theta_end * i / 12
        pts.append((cx + lobe * math.cos(math.radians(a)), h - lobe + lobe * math.sin(math.radians(a))))
    right = pts
    left = [(-x, y) for x, y in reversed(right)]
    return right + left


TOAST_CRUST = C("#a45a22")
TOAST_EDGE = C("#d8943c")
TOAST_MID = C("#f3d08c")


def toaster() -> Landmark:
    lm = Landmark("toaster", ao=0.8)
    W, D = 26.0, 16.0

    def shell_col(p, n):
        c = STEEL(p, n)
        band = smoothstep(-10.5, -9.0, p.x) * (1 - smoothstep(-6.0, -4.5, p.x))
        return mix(c, (1.0, 1.0, 1.0), 0.28 * band * smoothstep(-0.3, 0.2, n.z))

    for sx in (-1, 1):
        for sz in (-1, 1):
            lm.cylinder(r=1.5, h=2.6, at=(sx * 10.6, -0.2, sz * 5.8), segs=14, rb=0.5, rt=0.4, col=BAKELITE, mat="glossy")
    lm.rbox((W - 1.2, 1.5, D - 1.2), at=(0, 1.9, 0), bevel=0.5, col=BAKELITE, mat="glossy")
    lm.rbox((W, 11.4, D), at=(0, 8.4, 0), bevel=3.4, bseg=5, col=shell_col, mat="metal")
    lm.rbox((W - 4.2, 0.9, D - 3.6), at=(0, 14.1, 0), bevel=0.35, bseg=2, col=BAKELITE, mat="glossy")
    front = Plane((0, 0, D / 2 + 0.02), (0, 0, 1))
    # trim: a red stripe and a cream pinstripe
    lm.decal(front, [(-W / 2 + 0.4, 6.2), (W / 2 - 0.4, 6.2), (W / 2 - 0.4, 6.95), (-W / 2 + 0.4, 6.95)], RED, 0.35, "glossy")
    lm.decal(front, [(-W / 2 + 0.4, 7.2), (W / 2 - 0.4, 7.2), (W / 2 - 0.4, 7.5), (-W / 2 + 0.4, 7.5)], C("#fff3da"), 0.35, "glossy")
    for zc in (3.7, -3.7):
        lm.rbox((16.4, 0.3, 3.0), at=(0, 14.6, zc), bevel=0.12, bseg=2, col=C("#0d0b0a"), mat="matte")
        for s in (-1, 1):
            lm.rbox((15.4, 0.1, 0.4), at=(0, 14.82, zc + s * 1.0), col=(1.0, 0.45, 0.12), mat="glow")
    # toast
    shape = bread(14.2, 12.4)
    for zc, y0, hh in ((3.7, 13.6, 11.4), (-3.7, 13.8, 13.4)):
        poly = bread(14.2, hh)
        lm.prism_xy(poly, 1.5, at=(0, y0, zc), bevel=0.25, col=TOAST_CRUST, mat="matte")
        inner = poly_scale([(x, y - 0.0) for x, y in poly], 0.9, (0, hh * 0.5))
        for sg in (-1, 1):
            plane = Plane((0, y0, zc + sg * 0.76), (0, 0, sg))
            cen = (0.0, hh * 0.46)
            far = max(math.hypot(x - cen[0], y - cen[1]) for x, y in inner)
            col = lambda p, n, y0=y0, hh=hh, cen=cen, far=far: mix(TOAST_MID, TOAST_EDGE, smoothstep(0.35, 0.98, math.hypot(p.x - cen[0], p.y - y0 - cen[1]) / far))
            lm.decal(plane, inner if sg > 0 else [(-x, y) for x, y in inner], col, 0.04, "matte", rings=4)
    # lever, dial
    lm.rbox((1.2, 6.8, 0.3), at=(-9.6, 8.6, D / 2 + 0.1), bevel=0.1, col=C("#0d0b0a"), mat="matte")
    lm.rbox((3.2, 1.6, 2.0), at=(-9.6, 10.0, D / 2 + 0.9), bevel=0.5, bseg=3, col=BAKELITE, mat="glossy")
    lm.cylinder(r=2.9, h=1.7, at=(8.6, 8.6, D / 2 - 0.1), rot=(90, 0, 0), segs=24, rb=0.4, rt=0.5, col=BAKELITE, mat="glossy")
    lm.cylinder(r=2.0, h=0.4, at=(8.6, 8.6, D / 2 + 1.5), rot=(90, 0, 0), segs=20, col=C("#6d5d52"), mat="glossy")
    lm.rbox((0.5, 1.8, 0.3), at=(9.2, 9.5, D / 2 + 2.0), rot=(0, 0, -25), col=C("#fff3da"), mat="matte")
    for i in range(9):
        a = math.radians(-144 + 288 * i / 8 + 90)
        px, py = 8.6 + math.cos(a) * 4.2, 8.6 + math.sin(a) * 4.2
        lm.decal(Plane((px, py, D / 2 + 0.02), (0, 0, 1)), ngon(8, 0.3 if i < 5 else 0.4), C("#2a2420") if i < 5 else RED, 0.35, "matte")
    # the cord
    cord = catmull([(12.0, 3.4, -3.0), (14.5, 1.2, -4.0), (18.0, 0.8, -8.0), (21.0, 0.8, -12.0), (24.5, 0.8, -16.5)], 6)
    lm.tube([tuple(c) for c in cord], r=0.6, sides=8, col=C("#242020"), mat="glossy")
    lm.rbox((2.4, 1.6, 3.2), at=(25.6, 0.8, -18.0), bevel=0.4, col=C("#242020"), mat="glossy")
    return lm


# ─── Grater (a tunnel) ───────────────────────────────────────────────────────


def grater() -> Landmark:
    lm = Landmark("grater", span=True, ao=0.7, ao_dist=5.0, rays=14)
    L = 44.0
    outer = [(-13.4, 0.0), (-13.4, 10.2), (-7.6, 21.6), (7.6, 21.6), (13.4, 10.2), (13.4, 0.0)]
    inner = [(-11.7, 0.0), (-11.7, 10.0), (-6.8, 19.8), (6.8, 19.8), (11.7, 10.0), (11.7, 0.0)]
    poly = outer + list(reversed(inner))
    lm.prism_xy(poly, L, at=(0, 0, 0), bevel=0.35, col=lambda p, n: (STEEL_DK(p, n) if n.y < -0.3 or (abs(p.x) < 11.9 and p.y < 19.9) else STEEL(p, n)), mat="metal")
    # the grating: punched teeth over the four outer faces, dark openings on the inner roof with the light coming through
    rnd = random.Random(7)
    faces = [
        # (start, end) of each outer face in the xy plane, normal
        ((-13.4, 1.4), (-13.4, 9.4)),
        ((-12.9, 11.6), (-8.0, 20.9)),
        ((8.0, 20.9), (12.9, 11.6)),
        ((13.4, 9.4), (13.4, 1.4)),
    ]
    zs = [-L / 2 + 2.0 + i * 3.2 for i in range(int((L - 4.0) / 3.2) + 1)]
    for fi, (a, b) in enumerate(faces):
        A, B = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        length = (B - A).length
        n_across = max(2, int(length / 2.4))
        d = (B - A).normalized()
        nrm = Vector((d.y, -d.x, 0)) if fi < 2 else Vector((d.y, -d.x, 0))
        nrm = nrm if nrm.x * (a[0] + b[0]) > 0 else -nrm
        for j in range(n_across):
            t = (j + 0.5) / n_across
            pos = A + (B - A) * t
            for zi, z in enumerate(zs):
                zz = z + (1.6 if j % 2 else 0.0)
                if abs(zz) > L / 2 - 1.5:
                    continue
                c = Vector((pos.x, pos.y, zz))
                rot_z = math.degrees(math.atan2(nrm.y, nrm.x)) - 90
                lm.sphere(0.95, at=tuple(c + nrm * 0.15), scale=(1.5, 0.5, 1.05), rot=(0, 0, rot_z), segs=8, rings=5, col=STEEL, mat="metal")
    # light through the holes: warm patches on the inner roof and sloped sides
    for fi, (a, b) in enumerate([((-11.7, 10.0), (-6.8, 19.8)), ((6.8, 19.8), (11.7, 10.0))]):
        A, B = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        d = (B - A).normalized()
        nin = Vector((-d.y, d.x, 0)) if fi == 0 else Vector((-d.y, d.x, 0))
        if nin.y > 0:
            nin = -nin
        for j in range(4):
            t = (j + 0.5) / 4
            pos = A + (B - A) * t
            for zi, z in enumerate(zs):
                zz = z + (1.6 if j % 2 else 0.0)
                if abs(zz) > L / 2 - 1.5:
                    continue
                plane = Plane(tuple(pos + Vector((0, 0, zz))), tuple(nin), up=(0, 0, 1))
                lm.decal(plane, ngon(6, 0.55, sx=0.8, sy=1.1), (1.0, 0.8, 0.45), 0.08, "glow")
    # handle: a strap over the top, on two posts
    arch = [(0.0, 21.2, -9.5), (0.0, 22.0, -9.0)] + [(0.0, 22.0 + 4.6 * math.sin(math.pi * i / 10), -9.0 + 18.0 * i / 10) for i in range(11)] + [(0.0, 22.0, 9.0), (0.0, 21.2, 9.5)]
    lm.tube(arch, r=1.1, sides=12, col=STEEL, mat="metal")
    # rubber feet strips
    for sx in (-1, 1):
        lm.rbox((1.9, 0.9, L - 0.6), at=(sx * 12.6, 0.4, 0.0), bevel=0.3, col=C("#1d1a1a"), mat="matte")
    return lm


# ─── Salt shaker, pepper mill ────────────────────────────────────────────────

SALT_BLUE = C("#2a6fd0")


def salt_shaker() -> Landmark:
    lm = Landmark("salt-shaker", ao=0.7)
    body = smooth_profile([(0.0, 0.0), (5.6, 0.0), (6.9, 0.8), (7.2, 3.0), (7.0, 12.0), (6.7, 17.0), (6.0, 19.0)], 4) + [(5.2, 19.0), (5.2, 18.6), (0.0, 18.6)]
    lm.lathe(body, segs=48, col=C("#dce9f2"), mat="glass")
    salt = smooth_profile([(0.0, 0.3), (5.9, 0.4), (6.5, 2.0), (6.4, 11.0), (4.5, 13.6), (2.0, 14.3), (0.0, 14.4)], 3)
    lm.lathe(salt, segs=40, col=lambda p, n: mix(C("#d6dde6"), WHITE, smoothstep(0, 14, p.y)), mat="lit")
    surf = RevSurf(smooth_profile([(0.0, 0.0), (5.6, 0.0), (6.9, 0.8), (7.2, 3.0), (7.0, 12.0), (6.7, 17.0)], 4))
    text(lm, surf.painter(0.0, 4.2), "SALT", 5.0, SALT_BLUE, at=(0.0, 0.0), lift=0.12, mat="lit", pad=0.08)
    # the cap: chrome dome with a collar and a ring of holes
    cap = [(0.0, 0.0), (6.3, 0.0), (6.6, 0.4), (6.6, 1.4), (6.2, 1.8)] + smooth_profile([(5.9, 2.4), (5.2, 4.2), (3.9, 5.7), (2.0, 6.5), (0.0, 6.7)], 5)
    lm.lathe(cap, at=(0, 19.0, 0), segs=40, col=STEEL, mat="metal")
    capsurf = RevSurf([(r, y + 19.0) for r, y in cap[5:]])
    for i in range(14):
        az = TAU * i / 14
        lm.decal(capsurf.painter(az, 19.0 + 4.6), ngon(8, 0.38), C("#1a2030"), 0.06, "matte")
    for i in range(6):
        lm.decal(capsurf.painter(TAU * i / 6, 19.0 + 5.7), ngon(8, 0.34), C("#1a2030"), 0.06, "matte")
    lm.torus(R=6.4, r=0.35, at=(0, 20.5, 0), segs=36, sides=6, col=STEEL, mat="metal")
    # a spill of salt on the counter
    rnd = random.Random(3)
    for i in range(46):
        a = rnd.uniform(0, TAU)
        r = abs(rnd.gauss(0, 3.2)) + 1.0
        lm.rbox((0.6, 0.45, 0.6), at=(2.0 + math.cos(a) * r * 1.3, 0.2, 10.5 + math.sin(a) * r), rot=(0, rnd.uniform(0, 90), 0), bevel=0.12, bseg=1, col=mix(WHITE, C("#cdd6e0"), rnd.random()), mat="lit")
    lm.sphere(1.0, at=(2.0, 0.0, 10.5), scale=(4.2, 1.0, 3.4), segs=16, rings=8, col=WHITE, mat="lit")
    lm.sphere(1.0, at=(3.6, 0.0, 11.5), scale=(2.0, 0.7, 1.7), segs=12, rings=6, col=WHITE, mat="lit")
    return lm


WALNUT = C("#4a2a18")
WALNUT_L = C("#7d4a2a")


def pepper_mill() -> Landmark:
    lm = Landmark("pepper-mill", ao=0.75)
    prof = smooth_profile([(0.0, 0.0), (5.9, 0.0), (7.2, 0.6), (7.5, 3.0), (7.2, 7.5), (6.2, 13.0), (4.9, 18.5), (4.5, 22.0)], 5)
    prof += [(4.6, 22.0), (5.9, 22.3), (6.2, 23.0), (6.2, 24.0), (5.6, 24.6), (5.6, 25.0)]
    prof += smooth_profile([(5.6, 25.6), (5.9, 28.0), (6.0, 31.0), (5.4, 33.6), (4.4, 35.0), (0.0, 35.4)], 5)
    breaks = [3.2, 3.6, 21.2, 21.8, 22.4, 24.0, 24.6, 25.6, 33.0]

    def col(p, n):
        y = p.y
        wood = mix(WALNUT, WALNUT_L, 0.5 + 0.5 * math.sin(y * 2.6 + noise(p) * 1.4) * 0.6 + 0.2 * (n.y * 0.5 + 0.5))
        if 21.8 < y < 24.6:
            return mix(C("#c58a24"), C("#ffe08a"), smoothstep(-0.5, 0.8, n.y) * 0.8 + 0.2)
        if 3.2 < y < 3.6 or 33.0 < y < 33.4:
            return mix(C("#c58a24"), C("#ffe08a"), 0.6)
        return china_gloss(wood, n, 0.1)

    lm.lathe(with_breaks(prof, breaks), segs=64, col=col, mat="glossy")
    # grooves in the wood, painted as thin dark rings
    for y in (9.0, 11.5, 14.0, 28.0, 29.2):
        r = RevSurf(prof).r(y)
        lm.torus(R=r + 0.02, r=0.12, at=(0, y, 0), segs=48, sides=5, col=C("#2a160c"), mat="glossy")
    # the crank on top
    lm.cylinder(r=0.8, h=3.8, at=(0, 35.0, 0), segs=14, col=STEEL, mat="metal")
    lm.sphere(1.5, at=(0, 39.0, 0), segs=20, rings=12, col=STEEL, mat="metal")
    crank = [(0.0, 38.0, 0.0), (3.0, 38.2, 0.0), (5.0, 38.0, 0.0), (6.6, 39.8, 0.0), (6.6, 41.4, 0.0)]
    lm.tube(catmull(crank, 5), r=0.5, sides=10, col=STEEL, mat="metal")
    lm.sphere(1.3, at=(6.6, 41.0, 0.0), segs=16, rings=10, col=china_gloss(WALNUT_L, Vector((0, 1, 0))), mat="glossy")
    # peppercorns
    rnd = random.Random(11)
    for i in range(26):
        a = rnd.uniform(0, TAU)
        r = rnd.uniform(8.6, 12.6)
        s = rnd.uniform(0.7, 1.1)
        lm.sphere(s, at=(math.cos(a) * r, s * 0.8, math.sin(a) * r * 0.9), segs=10, rings=7, col=lambda p, n: mix(C("#161210"), C("#4b4038"), max(0.0, n.y) ** 2), mat="glossy", disp=lambda p, s=s: 0.1 * s * noise(p, 5.0))
    return lm


# ─── Cookbooks ───────────────────────────────────────────────────────────────


def book(lm, at, size, yaw, cloth, trim, title=None, spine_to=-1):
    """A closed book lying flat: pages, two boards, a rounded spine (on the x side `spine_to`)."""
    w, t, d = size
    x, y, z = at
    cs = math.cos(math.radians(yaw))
    sn = math.sin(math.radians(yaw))
    place = lambda lx, ly, lz: (x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs)
    board = 0.55
    lm.rbox((w - 1.4, t - 2 * board, d - 1.2), at=place(0.5 * -spine_to * 0.3 + 0.0, t / 2, 0.0), rot=(0, yaw, 0), bevel=0.15, bseg=1, col=C("#f2e8cf"), mat="matte")
    for sy in (0.5 * board, t - 0.5 * board):
        lm.rbox((w, board, d), at=place(0, sy, 0), rot=(0, yaw, 0), bevel=0.2, bseg=2, col=cloth, mat="glossy")
    lm.rbox((1.2, t, d), at=place(spine_to * (w / 2 - 0.4), t / 2, 0), rot=(0, yaw, 0), bevel=0.5, bseg=3, col=cloth, mat="glossy")
    # page lines on the three open sides (a pale rim, darker lines)
    for k in range(1, 7):
        yy = t * k / 7
        lm.rbox((0.12, 0.08, d - 1.0), at=place(-spine_to * (w / 2 - 0.6), yy, 0), rot=(0, yaw, 0), col=C("#cdbd98"), mat="matte")
        lm.rbox((w - 3.0, 0.08, 0.12), at=place(0.0, yy, d / 2 - 0.55), rot=(0, yaw, 0), col=C("#cdbd98"), mat="matte")
    # gold bands on the spine
    for k in (0.2, 0.8):
        lm.rbox((1.5, t + 0.1, 0.5), at=place(spine_to * (w / 2 - 0.4), t / 2, (k - 0.5) * d), rot=(0, yaw, 0), bevel=0.1, bseg=1, col=trim, mat="glossy")
    return place


def cookbook() -> Landmark:
    lm = Landmark("cookbook", ao=0.8)
    place1 = book(lm, (0.0, 0.0, 0.0), (30.0, 6.2, 21.5), 0, C("#b3262b"), GOLD)
    place2 = book(lm, (-1.5, 6.2, 0.5), (26.5, 5.0, 19.5), 7, C("#2f7d4a"), C("#f4dc8a"), spine_to=1)
    place3 = book(lm, (1.0, 11.2, -0.5), (24.5, 4.2, 17.5), -9, C("#e08a1a"), C("#fff1c8"))
    # the top book's cover: a gold frame, a fork and spoon, the title
    top = 11.2 + 4.2 + 0.02
    yaw = math.radians(-9)
    cs, sn = math.cos(yaw), math.sin(yaw)
    ox, oz = 1.0, -0.5
    pl = Plane((ox, top, oz), (0, 1, 0), up=(math.sin(yaw), 0, -math.cos(yaw)))
    inset = [(-10.5, -7.2), (10.5, -7.2), (10.5, 7.2), (-10.5, 7.2)]
    lm.decal(pl, inset, C("#fff1c8"), 0.05, "glossy")
    lm.decal(pl, poly_scale(inset, 0.96), C("#b6540f"), 0.09, "glossy")
    lm.decal(pl, poly_scale(inset, 0.9), C("#fff1c8"), 0.12, "glossy")
    text(lm, pl, "COOK", 3.6, C("#b6540f"), at=(0.0, 1.2), lift=0.2, mat="glossy")
    text(lm, pl, "BOOK", 3.6, C("#b6540f"), at=(0.0, -3.6), lift=0.2, mat="glossy")
    lm.decal(pl, [(u, v + 5.6) for u, v in ngon(16, 1.1)], GOLD, 0.2, "glossy")
    return lm


# ─── Cereal box ──────────────────────────────────────────────────────────────

SUN_YELLOW = C("#ffcf2e")
SUN_ORANGE = C("#ff8a1c")


def cereal_loops(lm, rnd, n, centre, spread, y0=0.0, lift=0.0, rmax=99.0):
    for i in range(n):
        a = rnd.uniform(0, TAU)
        r = min(abs(rnd.gauss(0, spread)), rmax)
        x, z = centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r * 0.8
        h = y0 + 0.45 + lift * math.exp(-r * r / (2 * spread * spread)) * rnd.uniform(0.2, 1.0)
        c = mix(C("#e8a53a"), C("#c27a22"), rnd.random())
        lm.torus(R=0.78, r=0.42, at=(x, h, z), rot=(rnd.uniform(-25, 25), rnd.uniform(0, 360), rnd.uniform(-25, 25)), segs=10, sides=6, col=c, mat="glossy")


def cereal_box() -> Landmark:
    lm = Landmark("cereal-box", ao=0.78)
    W, H, D = 24.0, 47.0, 9.0
    bx = -1.0
    front_z = D / 2 + 0.02
    lm.rbox((W, H, D), at=(bx, H / 2, 0), bevel=0.45, bseg=2, col=SUN_YELLOW, mat="glossy")
    # sides
    side = Plane((bx + W / 2 + 0.02, 0, 0), (1, 0, 0))
    # front art: a sun with rays, a banner, the name
    fp = Plane((bx, 0, front_z), (0, 0, 1))
    lm.decal(fp, [(-W / 2 + 0.6, 0.8), (W / 2 - 0.6, 0.8), (W / 2 - 0.6, 7.0), (-W / 2 + 0.6, 7.0)], C("#2a8fd6"), 0.04, "glossy")
    for i in range(11):
        u = -W / 2 + 1.6 + i * 2.2
        lm.decal(fp, [(u + a, 3.9 + b) for a, b in ngon(12, 0.55)], C("#fdfaf0"), 0.08, "glossy")
    lm.decal(fp, [(-W / 2 + 0.6, 7.0), (W / 2 - 0.6, 7.0), (W / 2 - 0.6, 7.7), (-W / 2 + 0.6, 7.7)], C("#fdfaf0"), 0.06, "glossy")
    cx, cy = 0.0, 29.0
    for i in range(18):
        a = TAU * i / 18
        lm.decal(fp, [(cx + (u * math.cos(a) - v * math.sin(a)) * 1.0, cy + (u * math.sin(a) + v * math.cos(a)) * 1.0) for u, v in [(5.5, -1.1), (11.0, 0.0), (5.5, 1.1)]], SUN_ORANGE if i % 2 else C("#ff6a1a"), 0.05, "glossy")
    lm.decal(fp, [(cx + u, cy + v) for u, v in ngon(28, 6.0)], C("#ff9a12"), 0.1, "glossy", rings=2)
    lm.decal(fp, [(cx + u, cy + v) for u, v in ngon(28, 5.1)], C("#ffd84a"), 0.14, "glossy", rings=2)
    for sx in (-1, 1):
        lm.decal(fp, [(cx + sx * 1.9 + u, cy + 1.2 + v) for u, v in ngon(8, 0.55)], C("#3a2410"), 0.2, "matte")
    smile = [(cx + 2.8 * math.cos(math.radians(a)), cy - 0.6 + 2.8 * math.sin(math.radians(a)) - 1.0) for a in range(200, 341, 10)]
    for i in range(len(smile) - 1):
        a, b = Vector(smile[i]), Vector(smile[i + 1])
        d = (b - a).normalized()
        n = Vector((-d.y, d.x)) * 0.28
        lm.decal(fp, [tuple(a - n), tuple(b - n), tuple(b + n), tuple(a + n)], C("#3a2410"), 0.2, "matte")
    banner = [(-W / 2 + 0.8, 8.6), (W / 2 - 0.8, 8.6), (W / 2 - 0.8, 15.4), (-W / 2 + 0.8, 15.4)]
    lm.decal(fp, [(u, v) for u, v in banner], C("#d9322a"), 0.1, "glossy")
    text(lm, fp, "SUNNY", 4.3, C("#fff6dc"), at=(0.0, 10.9), lift=0.2, mat="glossy")
    # sides: stripes and a nutrition panel
    sp = Plane((bx + W / 2 + 0.02, 0, 0), (1, 0, 0))
    for k in range(6):
        v0 = 3 + k * 7
        lm.decal(sp, [(-D / 2 + 0.5, v0), (D / 2 - 0.5, v0), (D / 2 - 0.5, v0 + 2.6), (-D / 2 + 0.5, v0 + 2.6)], SUN_ORANGE, 0.05, "glossy")
    sp2 = Plane((bx - W / 2 - 0.02, 0, 0), (-1, 0, 0))
    lm.decal(sp2, [(-3.6, 10), (3.6, 10), (3.6, 30), (-3.6, 30)], C("#fdfaf0"), 0.05, "matte")
    for k in range(9):
        lm.decal(sp2, [(-3.0, 12 + k * 2.0), (3.0, 12 + k * 2.0), (3.0, 12.5 + k * 2.0), (-3.0, 12.5 + k * 2.0)], C("#3a3a40"), 0.09, "matte")
    # the top: flaps, one pulled open
    lm.rbox((W - 0.6, 0.5, D - 0.6), at=(bx, H + 0.1, 0), bevel=0.15, bseg=1, col=C("#f1b91e"), mat="glossy")
    lm.rbox((W - 0.8, 0.45, 4.4), at=(bx, H + 2.4, D / 2 + 1.0), rot=(48, 0, 0), bevel=0.12, bseg=1, col=SUN_YELLOW, mat="glossy")
    lm.rbox((W - 0.8, 0.45, 4.4), at=(bx, H + 2.4, -D / 2 - 1.0), rot=(-48, 0, 0), bevel=0.12, bseg=1, col=C("#f1b91e"), mat="glossy")
    # spilled cereal and a bowl
    rnd = random.Random(5)
    cereal_loops(lm, rnd, 30, (-12.5, 7.5), 3.2, 0.0, 0.0, 4.6)
    bowl = [(0.0, 0.0), (3.4, 0.0), (3.8, 0.6), (6.6, 2.4), (7.4, 4.4), (7.6, 4.8), (7.2, 4.9), (6.8, 4.6), (5.8, 2.9), (2.8, 1.7), (0.0, 1.5)]
    lm.lathe(smooth_profile([(r * 0.84, y) for r, y in bowl], 4), at=(-11.0, 0.0, 9.0), segs=36, col=glossy(C("#ff6b6b"), 0.2), mat="glossy")
    lm.cylinder(r=5.0, h=0.3, at=(-11.0, 3.5, 9.0), segs=28, col=C("#fff7e8"), mat="glossy")
    cereal_loops(lm, rnd, 24, (-11.0, 9.0), 2.0, 3.6, 2.0, 3.6)
    return lm


# ─── Mug ─────────────────────────────────────────────────────────────────────

MUG_RED = C("#e8453c")


def heart(s=1.0, n=28):
    pts = []
    for i in range(n):
        t = TAU * i / n
        pts.append((s * 0.0625 * 16 * math.sin(t) ** 3, s * 0.0625 * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))))
    return pts


def mug() -> Landmark:
    lm = Landmark("mug", ao=0.78)
    outer = smooth_profile([(0.0, 0.0), (7.6, 0.0), (8.8, 0.5), (9.6, 1.8), (9.8, 4.0), (9.8, 18.0), (9.8, 20.0)], 5)
    top = [(9.7, 20.7), (9.2, 21.1), (8.7, 20.7), (8.4, 20.0)]
    inner = [(8.4, 19.0), (8.4, 17.9), (0.0, 17.8)]
    prof = outer + top + inner

    def col(p, n):
        r = math.hypot(p.x, p.z)
        if n.y > 0.5 and p.y < 18.0:
            return mix(C("#3a2112"), C("#5a361d"), smoothstep(0, 8, r))
        if p.y > 17.9 and (r < 8.55) and n.y < 0.5:
            return china_gloss(C("#fff5e6"), n, 0.12)
        if p.y > 20.0 or (n.y > 0.5 and p.y > 17.9):
            return china_gloss(C("#fff5e6"), n, 0.2)
        return china_gloss(MUG_RED, n, 0.2)

    lm.lathe(with_breaks(prof, [17.9, 20.0]), segs=72, col=col, mat="glossy")
    surf = RevSurf(outer)
    for row, (y, n_, dr) in enumerate(((5.0, 14, 0.9), (8.7, 16, 0.9), (12.4, 16, 0.9), (16.1, 14, 0.9))):
        for i in range(n_):
            az = TAU * (i + 0.5 * (row % 2)) / n_
            lm.decal(surf.painter(az, y), ngon(12, dr), C("#fff5e6"), 0.08, "glossy")
    # the latte heart
    hp = Plane((0, 17.9, 0), (0, 1, 0), up=(0, 0, -1))
    lm.decal(hp, [(u * 0.9, v * 0.9 - 0.2) for u, v in heart(7.0)], C("#fbe9cf"), 0.04, "glossy", rings=2)
    lm.decal(hp, [(u * 0.55, v * 0.55 - 0.1) for u, v in heart(7.0)], C("#6a3f22"), 0.07, "glossy", rings=2)
    # the handle
    hpath = bezier((9.2, 16.8, 0.0), (18.0, 17.5, 0.0), (18.4, 4.0, 0.0), (9.2, 4.2, 0.0), 24)
    prof2 = [(1.0 * math.cos(TAU * i / 16) * 1.15, 1.9 * math.sin(TAU * i / 16)) for i in range(16)]
    lm.sweep([tuple(p) for p in hpath], prof2, up=(0, 0, 1), scale_fn=lambda t: (1.0 + 0.25 * abs(2 * t - 1) ** 2), col=lambda p, n: china_gloss(MUG_RED, n, 0.2), mat="glossy")
    # steam: three wisps turning slowly round the mug's axis
    st = lm.spin("steam", "y", (0, 0, 0), 0.35)
    for k in range(3):
        a0 = TAU * k / 3
        path = []
        for i in range(17):
            t = i / 16
            r = 2.6 + 1.2 * math.sin(t * 5 + k)
            ang = a0 + t * 2.4
            path.append((math.cos(ang) * r, 19.5 + t * 8.0, math.sin(ang) * r))
        st.tube(path, r=0.55, sides=8, scale_fn=lambda t: 0.4 + 1.0 * math.sin(math.pi * min(1.0, t * 1.1 + 0.05)), col=(1, 1, 1), mat="glass")
    return lm


# ─── Fork and spoon arches ───────────────────────────────────────────────────


def arch_path(foot=17.5, top=30.0, n=60):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = math.pi * t
        pts.append((-foot * math.cos(a), top * math.sin(a) ** 0.82, 0.0))
    return pts


def utensil_col(base_dark, base_light, tint=(1.0, 1.0, 1.0)):
    f = chrome(base_dark, base_light, horizon=0.0, band=0.25, tint=tint)

    def g(p, n):
        c = f(p, n)
        # a lit ridge down the handle's top edge
        return c

    return g


def fork_arch() -> Landmark:
    lm = Landmark("fork-arch", span=True, ao=0.55, ao_dist=6.0, rays=12)
    path = arch_path()
    n = len(path)
    col = utensil_col(C("#3a465c"), C("#ecf3ff"))
    xs = [p[0] for p in path]
    # handle: narrow, then widening over the apex into the head
    def width(i):
        x = xs[i]
        if x < -6.0:
            return 1.55 + 0.25 * smoothstep(-17.5, -14.0, x) * 0 + 0.25 * (1 - smoothstep(-17.5, -13.0, x))
        if x < 3.5:
            return 1.55 + (6.2 - 1.55) * smoothstep(-6.0, 3.5, x)
        return 6.2

    prof = [(0.85 * math.cos(TAU * i / 20), 1.0 * math.sin(TAU * i / 20)) for i in range(20)]
    lm.sweep(path[: int(n * 0.72)], prof, up=(0, 0, 1), scale_fn=lambda t: (1.0, width(min(n - 1, int(t * (n * 0.72 - 1)))))
             , col=col, mat="metal")
    # the four tines down to the counter, from the palm
    tail = path[int(n * 0.66):]
    m = len(tail)
    for k, zc in enumerate((-4.65, -1.55, 1.55, 4.65)):
        pts = [(p[0], p[1], zc) for p in tail]
        lm.sweep(pts, [(0.85 * math.cos(TAU * i / 16), 1.45 * math.sin(TAU * i / 16)) for i in range(16)], up=(0, 0, 1),
                 scale_fn=lambda t: (1.0, 1.0 if t < 0.88 else max(0.35, 1.0 - (t - 0.88) / 0.12 * 0.65)), col=col, mat="metal")
    # a rounded bead at the handle's foot, and a decorative ridge
    lm.sphere(1.5, at=(-17.5, 0.9, 0.0), scale=(1.1, 1.1, 1.6), segs=16, rings=10, col=col, mat="metal")
    return lm


def spoon_arch() -> Landmark:
    lm = Landmark("spoon-arch", span=True, ao=0.55, ao_dist=6.0, rays=12)
    path = arch_path()
    n = len(path)
    gold = utensil_col(C("#6b4510"), C("#fff0b4"), tint=(1.0, 0.92, 0.78))
    xs = [p[0] for p in path]

    def width(i):
        x = xs[i]
        if x < -5.0:
            return 1.5 + 0.3 * (1 - smoothstep(-17.5, -13.0, x))
        return 1.5 + (6.0 - 1.5) * smoothstep(-5.0, 6.0, x)

    prof = [(0.85 * math.cos(TAU * i / 20), 1.0 * math.sin(TAU * i / 20)) for i in range(20)]
    cut = int(n * 0.66)
    lm.sweep(path[:cut], prof, up=(0, 0, 1), scale_fn=lambda t: (1.0, width(min(n - 1, int(t * (cut - 1))))), col=gold, mat="metal")
    # the bowl: a dished oval carrying on down to the counter
    tail = path[cut - 1:]
    # the dish: cross-section a shallow arc across z, concave toward the outside of the arch
    k = 14
    dish = []
    for i in range(k + 1):
        s = -1 + 2 * i / k
        dish.append((0.7 + 1.5 * (1 - s * s) * 0 - 1.9 * (1 - s * s) + 1.9, s * 6.2))
    top = [(-0.5 * (1 - s * s) + 0.0, 6.2 * s) for s in [(-1 + 2 * i / k) for i in range(k + 1)]]
    outer_c = [(0.6 + 1.6 * (1 - s * s), 6.2 * s) for s in [(-1 + 2 * i / k) for i in range(k + 1)]]
    inner_c = [(-0.4 + 1.6 * (1 - s * s), 6.2 * s) for s in [(-1 + 2 * i / k) for i in range(k + 1)]]
    outer_c, inner_c = outer_c, inner_c
    section = outer_c + list(reversed(inner_c))
    def head_w(t):
        rise = smoothstep(0.0, 0.34, t) ** 0.8
        fall = math.sqrt(max(0.0, 1.0 - smoothstep(0.5, 1.0, t) ** 2))
        return (1.0 + 0.5 * rise, max(0.05, rise * fall))

    lm.sweep(tail, section, up=(0, 0, 1), scale_fn=head_w, col=gold, mat="metal", caps=True)
    lm.sphere(1.5, at=(-17.5, 0.9, 0.0), scale=(1.1, 1.1, 1.6), segs=16, rings=10, col=gold, mat="metal")
    return lm


# ─── Wall clock ──────────────────────────────────────────────────────────────

CLOCK_RED = C("#d8322a")


def hand_poly(length, width, tail=0.0, tip=True):
    w = width / 2
    return [(-w, -tail), (w, -tail), (w * 0.6, length * 0.55), (0.0, length), (-w * 0.6, length * 0.55)] if tip else [(-w, -tail), (w, -tail), (w, length), (-w, length)]


def wall_clock() -> Landmark:
    lm = Landmark("wall-clock", ao=0.78)
    cy = 22.5
    prof = [(0.0, -2.2), (15.6, -2.2), (16.9, -1.6), (17.7, 0.0), (17.7, 2.4), (17.0, 3.8), (15.8, 4.2), (15.0, 3.6), (14.4, 3.0), (0.0, 3.0)]
    prof = smooth_profile(prof, 3)

    def col(p, n):
        r = math.hypot(p.x, p.y - cy)
        if n.z > 0.85 and r < 14.5:
            return mix(C("#fff6e4"), C("#f1e4c8"), smoothstep(8, 14.5, r))
        if n.z < -0.5:
            return china_gloss(C("#8a1d18"), n, 0.1)
        return china_gloss(CLOCK_RED, n, 0.22)

    lm.lathe(with_breaks(prof, [3.0]), at=(0, cy, 0), rot=(90, 0, 0), segs=96, col=col, mat="glossy")
    fp = Plane((0, cy, 3.0), (0, 0, 1))
    # ticks and numerals
    for i in range(60):
        a = TAU * i / 60
        big = i % 5 == 0
        r0, r1 = (12.4, 14.0) if big else (13.2, 14.0)
        w = 0.28 if big else 0.14
        d = Vector((math.sin(a), math.cos(a)))
        nrm = Vector((d.y, -d.x))
        pts = [tuple(d * r0 - nrm * w), tuple(d * r1 - nrm * w), tuple(d * r1 + nrm * w), tuple(d * r0 + nrm * w)]
        lm.decal(fp, pts, BLACK, 0.03, "matte")
    for h in range(1, 13):
        a = TAU * h / 12
        s = str(h)
        text(lm, fp, s, 2.6, C("#2a2420"), at=(math.sin(a) * 10.0, math.cos(a) * 10.0 - 1.3), lift=0.03, mat="matte", gap=0.8)
    # bells and hammer, legs
    for sx in (-1, 1):
        lm.sphere(4.4, at=(sx * 9.0, cy + 14.8, 1.0), scale=(1.0, 0.7, 1.0), rot=(0, 0, sx * -22), segs=28, rings=14, col=chrome(C("#8a5a10"), C("#fff0a0"), tint=(1.0, 0.9, 0.7)), mat="metal")
        lm.sphere(0.9, at=(sx * 9.0, cy + 18.2, 1.0), segs=12, rings=8, col=GOLD, mat="metal")
        lm.rod((sx * 11.8, 0.8, 1.0), (sx * 15.0, 8.0, 1.0), 0.9, sides=10, col=STEEL, mat="metal")
        lm.sphere(1.6, at=(sx * 11.8, 0.7, 1.0), segs=12, rings=8, col=STEEL, mat="metal")
    lm.rod((0.0, cy + 17.4, 1.0), (0.0, cy + 19.0, 1.0), 0.6, sides=8, col=STEEL, mat="metal")
    lm.sphere(1.0, at=(0.0, cy + 19.3, 1.0), segs=12, rings=8, col=STEEL, mat="metal")
    # hands, turning about the face's centre
    zh = 3.0
    sec = lm.spin("second", "z", (0, cy, zh + 0.9), -0.1047)
    sec.prism_xy(hand_poly(13.2, 0.3, 3.0, tip=False), 0.12, at=(0, cy, zh + 0.9), col=RED, mat="glossy")
    sec.cylinder(r=0.55, h=0.3, at=(0, cy, zh + 0.8), rot=(90, 0, 0), segs=14, col=RED, mat="glossy")
    mn = lm.spin("minute", "z", (0, cy, zh + 0.5), -0.0017453)
    ang_m = math.radians(-50)
    cs, sn = math.cos(ang_m), math.sin(ang_m)
    rotate = lambda poly, a: [(x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)) for x, y in poly]
    mn.prism_xy([(x, y + cy) for x, y in rotate(hand_poly(12.6, 1.1, 1.8), math.radians(-8 * 6.0 * 0 + 48))], 0.35, at=(0, 0, zh + 0.5), col=BLACK, mat="glossy")
    hr = lm.spin("hour", "z", (0, cy, zh + 0.2), -0.000145)
    hr.prism_xy([(x, y + cy) for x, y in rotate(hand_poly(8.6, 1.5, 1.6), math.radians(-60))], 0.35, at=(0, 0, zh + 0.2), col=BLACK, mat="glossy")
    lm.cylinder(r=0.9, h=0.5, at=(0, cy, zh + 1.1), rot=(90, 0, 0), segs=16, col=BLACK, mat="glossy")
    return lm


from kitchen import BUILDERS as _B  # noqa: E402

_B.update({
    "toaster": toaster,
    "grater": grater,
    "salt-shaker": salt_shaker,
    "pepper-mill": pepper_mill,
    "cookbook": cookbook,
    "cereal-box": cereal_box,
    "mug": mug,
    "fork-arch": fork_arch,
    "spoon-arch": spoon_arch,
    "wall-clock": wall_clock,
})
