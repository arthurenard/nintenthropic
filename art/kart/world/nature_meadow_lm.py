"""The meadow's landmarks: windmill, barn, hot-air-balloon. Blender coordinates: z up, the front (the side that
faces the road) is -y; the game's right is Blender's -x."""

import math

from mathutils import Vector as V

from naturekit import Model, empty, gore_balloon, grad_z, hexc, mix, mul, post, rod, smoothstep, spinner, varied, TAU

PLASTER = hexc("#f7f0df")
PLASTER_D = hexc("#d8c9a6")
TIMBER = hexc("#8a5632")
TIMBER_D = hexc("#4d2f1a")
STONE = hexc("#9aa1a8")
STONE_D = hexc("#5d6670")
RED = hexc("#d2453a")
RED_D = hexc("#8e2a22")


def windmill():
    root = empty("landmark.windmill")
    m = Model("windmill.body", seed=1)
    # A stone footing sunk into the field, then a round tower of plaster, tapering, banded in timber.
    m.lathe([(4.7, -1.5), (4.7, 1.0), (4.4, 1.3), (4.1, 1.5)], 16, (0, 0, 0), varied(grad_z(-1.5, 1.5, STONE_D, STONE), 0.14, 1.1, 2), cap_start=True)
    tower = [(4.0, 1.4), (3.85, 3.5), (3.4, 6.0), (3.0, 8.0), (2.85, 8.8)]
    m.lathe(tower, 16, (0, 0, 0), varied(lambda p, n: mix(PLASTER_D, PLASTER, smoothstep(1.4, 8.8, p.z) * 0.8 + 0.2), 0.05, 1.2, 3))
    for k in range(8):
        a = k * TAU / 8 + TAU / 16
        rod(m, (math.cos(a) * 4.02, math.sin(a) * 4.02, 1.4), (math.cos(a) * 2.88, math.sin(a) * 2.88, 8.7), 0.17, grad_z(1.4, 8.7, TIMBER_D, TIMBER))
    for z, r in ((3.4, 3.8), (6.0, 3.4)):
        m.torus((0, 0, z), r, 0.13, 6, 24, TIMBER_D)
    # A gallery half way up: a plank ring and a rail on posts.
    m.lathe([(3.5, 6.2), (4.7, 6.2), (4.7, 6.45), (3.5, 6.45)], 16, (0, 0, 0), TIMBER, cap_start=True, cap_end=True)
    for k in range(20):
        a = k * TAU / 20
        post(m, math.cos(a) * 4.55, math.sin(a) * 4.55, 6.45, 7.4, 0.08, TIMBER_D, 5)
    m.torus((0, 0, 7.4), 4.55, 0.09, 5, 28, TIMBER)
    # The door: arched, boarded, with a stone step; windows with shutters.
    m.box((0, -3.9, 2.6), (2.1, 0.55, 2.8), (0, 0, 0), grad_z(1.2, 4.0, TIMBER_D, TIMBER), bevel=0.1)
    m.blob((0, -3.9, 4.0), (1.05, 0.28, 0.75), 2, grad_z(3.2, 4.8, TIMBER_D, TIMBER), flat_base=-0.1)
    m.box((0, -4.5, 1.15), (3.2, 1.3, 0.35), (0, 0, 0), STONE, bevel=0.06)
    m.box((0.62, -4.2, 2.45), (0.22, 0.2, 0.22), (0, 0, 0), hexc("#e8c04a"), bevel=0.04)
    for ang, z in ((55, 5.0), (-55, 5.0), (180, 4.6)):
        a = math.radians(ang - 90)
        cx, cy = math.cos(a) * 3.55, math.sin(a) * 3.55
        rot = (0, 0, a - math.pi / 2)
        m.box((cx, cy, z), (1.5, 0.35, 1.9), rot, PLASTER, bevel=0.07)
        m.box((cx + math.cos(a) * 0.16, cy + math.sin(a) * 0.16, z), (0.95, 0.2, 1.3), rot, hexc("#3f6aa5"), bevel=0.03)
        for s in (-1, 1):
            sx = cx + math.cos(a + math.pi / 2) * s * 0.95
            sy = cy + math.sin(a + math.pi / 2) * s * 0.95
            m.box((sx, sy, z), (0.5, 0.15, 1.8), rot, RED, bevel=0.03)
    # The cap: a shingled red dome with a wide eave, a ridge ring and a finial.
    cap = [(3.15, 8.5), (3.45, 8.85), (3.15, 9.9), (2.5, 11.2), (1.6, 12.3), (0.7, 13.0), (0.0, 13.3)]
    m.lathe(cap, 16, (0, 0, 0), varied(lambda p, n: mix(RED_D, RED, smoothstep(8.5, 13.3, p.z)), 0.06, 1.5, 4), mod=lambda j, k: 1.0 if (j + k) % 2 else 0.97)
    m.torus((0, 0, 9.9), 3.15, 0.12, 5, 24, RED_D)
    post(m, 0, 0, 13.2, 14.4, 0.07, TIMBER_D, 5)
    m.blob((0, 0, 14.5), 0.2, 1, hexc("#e8c04a"))
    # The axle housing and hub, and a tail pole to the ground with a stone to steady it.
    m.lathe([(0.78, -2.2), (0.8, -0.5), (0.8, 1.6)], 10, (0, 0, 10.0), grad_z(8, 12, TIMBER_D, TIMBER), rot=(math.pi / 2, 0, 0), cap_end=True, cap_start=True)
    rod(m, (0, 2.8, 10.2), (0, 9.8, 0.5), 0.2, grad_z(0, 10, TIMBER_D, TIMBER))
    m.blob((0, 10.1, 0.5), (1.0, 0.9, 0.6), 2, varied(grad_z(0, 1.0, STONE_D, STONE), 0.1), amp=0.2, flat_base=-0.4)
    m.build(parent=root, ao_args=dict(reach=3.0, strength=0.75, rays=18), sharp=50)

    sails = spinner(root, "windmill.sails", "z", (0, -3.5, 10.0), 0.45)
    s = Model("windmill.sails", seed=2)
    hub = V((0, -3.5, 10.0))
    s.blob(hub + V((0, -0.3, 0)), (0.85, 0.85, 0.85), 2, hexc("#c43a30"))
    s.lathe([(0.0, 0.0), (0.55, 0.0), (0.4, 0.5), (0.0, 0.62)], 10, hub + V((0, -0.8, 0)), hexc("#e8c04a"), rot=(-math.pi / 2, 0, 0), cap_start=True)
    cloth = hexc("#fbf7ea")
    for k in range(4):
        a = k * math.pi / 2 + 0.52
        d = V((math.cos(a), 0, math.sin(a)))
        nrm = V((-math.sin(a), 0, math.cos(a)))
        rod(s, hub + d * 0.7, hub + d * 7.1, 0.16, TIMBER)
        # The sail frame and its cloth lie to one side of the spar; the cloth is canvas over a lattice.
        r0, r1, w = 1.6, 6.9, 1.7
        fa = hub + d * r0
        fb = hub + d * r1
        for e in (0.0, w):
            rod(s, fa + nrm * e, fb + nrm * e, 0.07, TIMBER)
        for q in range(7):
            t = r0 + (r1 - r0) * q / 6
            rod(s, hub + d * t, hub + d * t + nrm * w, 0.06, TIMBER)
        s.quad(fa, fb, fb + nrm * w, fa + nrm * w, mix(cloth, hexc("#e8dfc8"), 0.2))
        s.quad(fa, fa + nrm * w, fb + nrm * w, fb, mix(cloth, hexc("#e8dfc8"), 0.35))
    s.build(parent=sails, ao=False, sharp=60)
    return root


def roof_courses(m, sx, a, b, y0, y1, n, cols):
    """One roof slope (from a=(x, z) at the eave to b at the ridge, mirrored by sx) laid in `n` courses of shingle."""
    for q in range(n):
        t0, t1 = q / n, (q + 1) / n
        x0, z0 = a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0
        x1, z1 = a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1
        col = cols[q % len(cols)]
        p0, p1 = V((sx * x0, y0, z0)), V((sx * x1, y0, z1))
        p2, p3 = V((sx * x1, y1, z1)), V((sx * x0, y1, z0))
        if sx > 0:
            m.quad(p0, p3, p2, p1, col)
        else:
            m.quad(p0, p1, p2, p3, col)
        # The course's lower lip, a darker step where it overlaps the one below.
        lip = V((0, 0, -0.14))
        edge = mul(col, 0.55)
        if sx > 0:
            m.quad(p0, p0 + lip, p3 + lip, p3, edge) if q else None
        else:
            m.quad(p0, p3, p3 + lip, p0 + lip, edge) if q else None


def barn():
    root = empty("landmark.barn")
    m = Model("barn.body", seed=3)
    W, D = 7.2, 5.4          # half width and half depth
    eave, knee, ridge = 5.4, 8.6, 11.4
    wall = varied(grad_z(0, 6, mul(RED, 0.72), RED), 0.05, 1.4, 5)
    # The walls, and the gambrel gable (the profile, front to back).
    prof = [(-W, 0), (W, 0), (W, eave), (W * 0.72, knee), (0, ridge), (-W * 0.72, knee), (-W, eave)]
    m.prism_y(prof, -D, D, wall)
    m.box((0, 0, 0.1), (2 * W + 0.5, 2 * D + 0.5, 0.7), (0, 0, 0), grad_z(-0.2, 0.5, STONE_D, STONE), bevel=0.05)
    # Battens up the back and sides of the front, and the white trim round the openings.
    for k in range(-5, 6):
        m.box((k * 1.25, D + 0.02, 2.6), (0.12, 0.08, 5.0), (0, 0, 0), RED_D)
        if abs(k * 1.25) >= 2.6:
            m.box((k * 1.25, -D - 0.02, 2.6), (0.12, 0.08, 5.0), (0, 0, 0), RED_D)
    # The big doors on the front: a dark opening, two sliding leaves, white X braces.
    fy = -D - 0.05
    m.box((0, fy + 0.02, 2.55), (4.6, 0.12, 4.9), (0, 0, 0), hexc("#2b1a14"))
    for sx in (-1, 1):
        m.box((sx * 1.12, fy - 0.12, 2.5), (2.15, 0.2, 4.7), (0, 0, 0), varied(grad_z(0.2, 5, mul(RED, 0.7), RED), 0.04), bevel=0.04)
        rod(m, (sx * 1.12 - 1.0, fy - 0.27, 0.35), (sx * 1.12 + 1.0, fy - 0.27, 4.65), 0.07, PLASTER)
        rod(m, (sx * 1.12 - 1.0, fy - 0.27, 4.65), (sx * 1.12 + 1.0, fy - 0.27, 0.35), 0.07, PLASTER)
        for e in (-1.0, 1.0):
            rod(m, (sx * 1.12 + e, fy - 0.27, 0.3), (sx * 1.12 + e, fy - 0.27, 4.7), 0.07, PLASTER)
        for z in (0.3, 4.7):
            rod(m, (sx * 1.12 - 1.0, fy - 0.27, z), (sx * 1.12 + 1.0, fy - 0.27, z), 0.07, PLASTER)
    rod(m, (-2.45, fy - 0.1, 0.1), (-2.45, fy - 0.1, 5.1), 0.1, PLASTER)
    rod(m, (2.45, fy - 0.1, 0.1), (2.45, fy - 0.1, 5.1), 0.1, PLASTER)
    rod(m, (-2.5, fy - 0.1, 5.1), (2.5, fy - 0.1, 5.1), 0.1, PLASTER)
    # The hay loft door up in the gambrel, a hoist beam and pulley.
    m.box((0, fy - 0.05, 8.1), (2.0, 0.15, 2.2), (0, 0, 0), hexc("#2b1a14"), bevel=0.04)
    m.box((0, fy - 0.1, 8.1), (1.7, 0.1, 1.9), (0, 0, 0), RED, bevel=0.03)
    rod(m, (-1.1, fy - 0.12, 7.0), (1.1, fy - 0.12, 9.2), 0.06, PLASTER)
    rod(m, (-1.1, fy - 0.12, 9.2), (1.1, fy - 0.12, 7.0), 0.06, PLASTER)
    rod(m, (-1.2, fy - 0.1, 9.25), (1.2, fy - 0.1, 9.25), 0.08, PLASTER)
    rod(m, (-1.2, fy - 0.1, 6.95), (1.2, fy - 0.1, 6.95), 0.08, PLASTER)
    rod(m, (0, fy, 9.9), (0, fy - 1.3, 9.9), 0.1, TIMBER_D)
    m.blob((0, fy - 1.3, 9.75), 0.2, 1, hexc("#3b3b40"))
    for sx in (-1, 1):
        rod(m, (sx * (W + 0.02), fy - 0.02, 0.0), (sx * (W + 0.02), fy - 0.02, eave), 0.14, PLASTER)
    # The roof: shingles in courses, an overhang all round, a ridge cap, white fascia.
    shingle = [hexc("#4c4442"), hexc("#5b514e"), hexc("#463e3d")]
    ov = 0.65
    slopes = [((W + ov, eave - 0.1), (W * 0.72, knee), 9), ((W * 0.72, knee), (0.0, ridge + 0.08), 11)]
    for sx in (-1, 1):
        for a, b, n in slopes:
            roof_courses(m, sx, a, b, -D - ov, D + ov, n, shingle)
            for yy in (-D - ov, D + ov):
                rod(m, (sx * a[0], yy, a[1]), (sx * b[0], yy, b[1]), 0.1, PLASTER)
    rod(m, (0, -D - ov, ridge + 0.1), (0, D + ov, ridge + 0.1), 0.2, hexc("#3b3534"))
    # The cupola: louvred, with a little pointed roof and a cockerel.
    m.box((0, 0.5, ridge + 0.8), (1.5, 1.5, 1.4), (0, 0, 0), PLASTER, bevel=0.06)
    for q in range(4):
        m.box((0, -0.28, ridge + 0.45 + q * 0.28), (1.0, 0.08, 0.12), (0, 0, 0), RED_D)
    m.cone((0, 0.5, ridge + 1.5), 1.15, 1.2, 4, hexc("#4c4442"), phase=math.pi / 4)
    rod(m, (0, 0.5, ridge + 2.6), (0, 0.5, ridge + 3.2), 0.05, TIMBER_D)
    m.blob((0, 0.5, ridge + 3.4), (0.35, 0.12, 0.3), 1, hexc("#c4a24a"))
    m.build(parent=root, ao_args=dict(reach=3.5, strength=0.75, rays=18), sharp=45)

    # The silo beside it: a tall corrugated cylinder with a dome and a ladder.
    s = Model("barn.silo", seed=4)
    sx0, sy0 = -W - 3.1, 1.5
    steel = hexc("#cdd6df")
    s.lathe([(2.55, -0.4), (2.5, 0.0), (2.4, 11.0), (2.4, 11.2)], 20, (sx0, sy0, 0), varied(lambda p, n: mix(hexc("#8f9aa6"), steel, smoothstep(0, 11, p.z)), 0.04, 1.3), mod=lambda j, k: 1.0 if j % 2 else 0.985, cap_start=True)
    for z in (1.5, 3.4, 5.3, 7.2, 9.1):
        s.torus((sx0, sy0, z), 2.43, 0.07, 5, 28, hexc("#7a8693"))
    s.lathe([(2.4, 11.2), (2.3, 11.7), (1.8, 12.5), (1.0, 13.1), (0.0, 13.3)], 20, (sx0, sy0, 0), hexc("#b9473a"))
    rod(s, (sx0 + 2.45, sy0 - 0.4, 0.2), (sx0 + 2.45, sy0 - 0.4, 12.0), 0.07, hexc("#6b7480"))
    rod(s, (sx0 + 2.45, sy0 + 0.4, 0.2), (sx0 + 2.45, sy0 + 0.4, 12.0), 0.07, hexc("#6b7480"))
    for z in [0.8 + 0.7 * q for q in range(16)]:
        rod(s, (sx0 + 2.45, sy0 - 0.4, z), (sx0 + 2.45, sy0 + 0.4, z), 0.04, hexc("#6b7480"))
    # A lean-to shed on the other side with a mono-pitch roof, open at the front.
    shed_x = W + 3.5
    s.box((shed_x, 0.4, 1.2), (6.0, 7.5, 2.4), (0, 0, 0), grad_z(0, 2.6, mul(RED, 0.6), mul(RED, 0.95)), bevel=0.06)
    s.box((shed_x, -3.2, 1.2), (5.2, 0.4, 1.8), (0, 0, 0), hexc("#2b1a14"))
    s.box((shed_x - 0.15, 0.4, 2.85), (6.6, 8.2, 0.25), (0, 0.09, 0), hexc("#4c4442"), bevel=0.05)
    # Hay bales by the doors and a post-and-rail fence in front.
    hay = hexc("#e8c45a")
    for (x, y, z, rz) in ((-5.5, -D - 1.6, 0.0, 0.3), (-3.6, -D - 1.8, 0.0, -0.1), (-4.6, -D - 1.7, 0.95, 0.2)):
        s.lathe([(0.0, -0.55), (0.86, -0.55), (0.86, 0.55), (0.0, 0.55)], 12, (x, y, 0.85 + z), varied(grad_z(0.0, 2.0, mul(hay, 0.75), hay), 0.1, 3.0), rot=(math.pi / 2, 0, rz), cap_start=True, cap_end=True)
    for k in range(9):
        post(s, -8 + k * 2.0, -D - 7.0, -0.2, 1.4, 0.1, TIMBER, 6)
    for z in (0.5, 1.05):
        rod(s, (-8.0, -D - 7.0, z), (8.0, -D - 7.0, z), 0.07, TIMBER_D)
    s.build(parent=root, ao_args=dict(reach=3.0, strength=0.7, rays=16), sharp=45)
    return root


def balloon():
    root = empty("landmark.hot-air-balloon")
    base = 35.0
    # The static things: a pole by the field with a flag, three tether lines to the hook, and pegs.
    m = Model("balloon.ground", seed=5)
    m.tube([V((7, 0, -0.6)), V((7, 0, 7.4))], [0.3, 0.2], 6, grad_z(0, 7, TIMBER_D, TIMBER), cap_end=True)
    m.box((7.9, 0, 6.2), (1.7, 0.15, 1.0), (0, 0, 0), RED)
    m.blob((7, 0, 7.6), 0.4, 1, hexc("#e8b830"))
    hook = V((0, 0, base - 3.8))
    rod(m, (7, 0, 7.0), hook, 0.1, hexc("#5a4a3a"))
    for (px, py) in ((-7, 4), (-3, -7.5)):
        rod(m, (px, py, 0.3), hook, 0.1, hexc("#5a4a3a"))
        post(m, px, py, -0.5, 0.7, 0.2, TIMBER_D, 5)
    rod(m, hook, V((0, 0, base - 2.6)), 0.14, hexc("#5a4a3a"))
    m.build(parent=root, ao=False, sharp=60)

    # The envelope, basket and burner hang under a spinner (a slow turn about the vertical), pivot at the basket.
    sp = spinner(root, "balloon.envelope", "y", (0, 0, base), 0.1)
    e = Model("balloon.envelope", seed=6)
    pal = [hexc("#e23b32"), hexc("#fbf6ea"), hexc("#f2c230"), hexc("#2f78d6")]
    profile = [(2.5, base + 4.4), (3.5, base + 6), (5.8, base + 9), (7.6, base + 13), (8.0, base + 17), (7.2, base + 21), (5.2, base + 25), (2.8, base + 28), (0.0, base + 29.6)]
    gore_balloon(e, profile, 16, pal)
    e.torus((0, 0, base + 16.1), 8.12, 0.28, 6, 28, hexc("#e8b830"))
    e.lathe([(2.5, base + 3.6), (2.7, base + 3.6), (2.7, base + 4.6), (2.5, base + 4.6)], 12, (0, 0, 0), hexc("#3a3a42"))
    wick = hexc("#b8864a")
    e.box((0, 0, base - 0.2), (3.4, 3.4, 2.2), (0, 0, 0), grad_z(base - 1.3, base + 0.9, mul(wick, 0.7), wick), bevel=0.15)
    e.box((0, 0, base + 0.95), (3.8, 3.8, 0.32), (0, 0, 0), mul(wick, 1.15), bevel=0.08)
    for k in range(5):
        e.box((0, -1.72, base - 0.9 + k * 0.45), (3.4, 0.14, 0.12), (0, 0, 0), mul(wick, 0.75))
    for sx in (-1, 1):
        for sy in (-1, 1):
            rod(e, (sx * 1.65, sy * 1.65, base + 0.95), (sx * 2.3, sy * 2.3, base + 4.4), 0.2, hexc("#5a4a3a"))
    e.blob((-0.7, -0.4, base + 1.6), 0.5, 2, hexc("#f1c9a0"))
    e.blob((-0.7, -0.4, base + 2.0), (0.62, 0.62, 0.32), 1, hexc("#d23a30"))
    e.blob((0.8, 0.2, base + 1.5), 0.46, 2, hexc("#e0b088"))
    e.blob((0.8, 0.2, base + 1.92), (0.58, 0.58, 0.3), 1, hexc("#2f78d6"))
    e.box((0, 0, base + 3.7), (0.8, 0.8, 0.5), (0, 0, 0), hexc("#b8862a"), bevel=0.05)
    e.build(parent=sp, ao_args=dict(reach=4.0, strength=0.55, rays=14), sharp=55)
    f = Model("balloon.flame", seed=7)
    f.lathe([(0.7, 0.0), (0.45, 1.3), (0.0, 2.6)], 8, (0, 0, base + 4.0), (1.0, 0.62, 0.12), mat="glow", cap_start=True)
    f.lathe([(0.35, 0.0), (0.2, 0.8), (0.0, 1.5)], 8, (0, 0, base + 4.0), (1.0, 0.95, 0.5), mat="glow", cap_start=True)
    f.build(parent=sp, ao=False, sharp=60)
    return root


def landmarks():
    return [windmill(), barn(), balloon()]
