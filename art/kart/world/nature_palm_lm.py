"""The island's landmarks: beach-hut, sandcastle, giant-ring (a span), wristwatch (a span: the start gantry).
Blender coordinates: z up, the front (the side that faces the road) is -y; a span model has x right of the road's
centre line and the road running along -y (so the face of a thing facing the oncoming karts looks toward +y)."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, grad_z, hexc, mix, mul, post, rod, smooth_path, smoothstep, tint, varied, TAU

SAND = hexc("#f0d79c")
SAND_D = hexc("#d6b278")
SAND_W = hexc("#b88f55")
BAMBOO = hexc("#c9a85a")
BAMBOO_D = hexc("#8a6a2e")
THATCH = hexc("#d6b45c")
THATCH_D = hexc("#8e6a2a")
GLOW_WARM = (0.9, 0.65, 0.25)


def n3(x, y, z, seed=0.0):
    return noise.noise(V((x + seed * 17.3, y - seed * 9.1, z + seed * 4.7)))


def surfboard(m, base, lean, length, col, stripe):
    """A board leaning against something: a flat leaf shape with a stripe and a fin."""
    b = V(base)
    d = V(lean).normalized()
    side = V((-d.y, d.x, 0)).normalized()
    pts = [b + d * (length * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
    widths = [0.2, 0.52, 0.6, 0.5, 0.0]
    m.blade(pts, side, lambda t: widths[min(4, int(t * 4.999))] * 0.9, 0.07, lambda p, n: stripe if abs((p - b).dot(side)) < 0.1 else col, fold=0.0, tip_point=True)


def beach_hut():
    root = empty("landmark.beach-hut")
    m = Model("hut.body", seed=51)
    g = Model("hut.glow", seed=52)
    # A round platform on stilts of palm trunk, a ring of bamboo wall with openings, a deep thatched cone.
    R = 4.6
    floor_z = 1.0
    wood = varied(grad_z(0.0, 2.0, BAMBOO_D, BAMBOO), 0.06, 1.5, 1)
    for k in range(8):
        a = k * TAU / 8
        m.tube([V((math.cos(a) * (R - 0.4), math.sin(a) * (R - 0.4), -1.6)), V((math.cos(a) * (R - 0.4), math.sin(a) * (R - 0.4), floor_z))], [0.3, 0.26], 7, varied(grad_z(-1.6, 1.0, hexc("#5a3a1e"), hexc("#9c6a3a")), 0.06, 1.5), cap_start=True, cap_end=True)
    m.lathe([(0.0, floor_z - 0.2), (R + 0.9, floor_z - 0.2), (R + 0.9, floor_z + 0.1), (0.0, floor_z + 0.1)], 20, (0, 0, 0), varied(grad_z(floor_z - 0.2, floor_z + 0.1, BAMBOO_D, mix(BAMBOO, SAND, 0.3)), 0.05, 2.0), cap_start=True, cap_end=True)
    # Wall poles: a ring of upright bamboo, a gap at the door (front, -y) and two windows.
    for k in range(28):
        a = k * TAU / 28 + 0.1
        # The door sits at -y (angle -90 degrees), windows at +-45 and back.
        da = abs(((a + math.pi / 2 + math.pi) % TAU) - math.pi)
        if da < 0.42:
            continue
        top = 3.8
        win = min(abs(((a - math.pi * 0.25 + math.pi) % TAU) - math.pi), abs(((a - math.pi * 0.75 + math.pi) % TAU) - math.pi), abs(((a + math.pi * 0.25 + math.pi) % TAU) - math.pi))
        z0 = floor_z + 0.1
        if win < 0.3:
            z0, top = floor_z + 0.1, floor_z + 1.4   # the sill
        post(m, math.cos(a) * R, math.sin(a) * R, z0, top + floor_z, 0.16, varied(grad_z(z0, top, BAMBOO_D, BAMBOO), 0.08, 3.0, k), 6)
    for z in (floor_z + 0.8, floor_z + 2.6, floor_z + 4.5):
        m.torus((0, 0, z), R, 0.1, 5, 40, hexc("#5a3a1e"))
    # The thatch roof: fringed courses from the eave to a point, each shaggier than the next.
    tiers = 6
    for q in range(tiers):
        t = q / tiers
        r0 = 6.9 - 4.8 * t
        z0 = floor_z + 3.4 + 4.3 * t
        r1 = r0 - 1.5 + 0.3 * t
        h = 1.9 - 0.2 * t
        sides = 22
        col = varied(lambda p, n, q=q: mix(THATCH_D, THATCH, smoothstep(0.0, 1.0, (p.z - (floor_z + 3.0)) / 8.0) * 0.6 + 0.4 * smoothstep(0.1, 1.0, n.z)), 0.1, 1.8, q)
        m.lathe([(r0 * 0.96, z0 - 0.6), (r0, z0 - 0.55), (r1 + 0.2, z0 + h * 0.5), (r1 * 0.5, z0 + h)], sides, (0, 0, 0), col, phase=q * 0.3, mod=lambda j, k, q=q: 1.0 if (j + q) % 2 else 0.86)
    m.lathe([(0.0, floor_z + 7.6), (0.8, floor_z + 7.2), (0.5, floor_z + 8.6), (0.0, floor_z + 9.8)], 8, (0, 0, 0), varied(grad_z(floor_z + 7, floor_z + 9.8, THATCH_D, THATCH), 0.06, 2.0))
    post(m, 0, 0, floor_z + 9.4, floor_z + 11.4, 0.1, hexc("#5a3a1e"), 6)
    m.blob((0, 0, floor_z + 11.7), 0.35, 1, hexc("#ff5a3c"))
    # The porch: a ladder-stair up to the door, two posts holding a little thatched eave and a rail.
    for q in range(4):
        m.box((0, -R - 1.5 + q * 0.3, 0.1 + q * 0.28), (2.2, 0.55, 0.2), (0, 0, 0), BAMBOO, bevel=0.04)
    for sx in (-1.4, 1.4):
        post(m, sx, -R - 1.4, floor_z, floor_z + 3.4, 0.14, wood, 6)
    m.box((0, -R - 1.2, floor_z + 3.5), (3.6, 1.6, 0.2), (0, 0, 0), THATCH, bevel=0.06)
    # A doorway curtain of shells, two lanterns, a tiki torch, a hammock between two stilts.
    for k in range(9):
        x = -0.8 + k * 0.2
        m.blob((x, -R + 0.1, floor_z + 2.6 - 0.15 * (k % 3)), (0.07, 0.07, 0.22 + 0.06 * (k % 3)), 0, hexc("#f7e9d3") if k % 2 else hexc("#f4a3b1"))
    for sx in (-1.6, 1.6):
        g.blob((sx, -R - 1.4, floor_z + 2.5), 0.28, 1, GLOW_WARM, mat="glow")
        m.tube([V((sx, -R - 1.4, floor_z + 3.4)), V((sx, -R - 1.4, floor_z + 2.8))], [0.03, 0.03], 4, hexc("#5a3a1e"))
    post(m, -6.0, -3.2, 0.0, 3.6, 0.1, hexc("#5a3a1e"), 6)
    g.lathe([(0.0, 0.0), (0.3, 0.2), (0.12, 0.9), (0.0, 1.1)], 6, (-6.0, -3.2, 3.5), (0.85, 0.45, 0.1), mat="glow", cap_start=True)
    # Surfboards leaning on the wall: three, bright.
    surfboard(m, (R * 0.7 + 0.1, 1.8, floor_z + 0.1), (0.2, 0.2, 1.0), 4.2, hexc("#2fb8d6"), hexc("#fbf3df"))
    surfboard(m, (R * 0.7 + 0.5, 2.2, floor_z + 0.1), (0.25, 0.25, 1.0), 3.9, hexc("#ff6a3d"), hexc("#fbf3df"))
    surfboard(m, (R * 0.7 + 0.9, 2.6, floor_z + 0.1), (0.3, 0.3, 1.0), 3.6, hexc("#f2cf3a"), hexc("#d84a3a"))
    # A rope of bunting with tiny flags round the eave, a conch, a crate and a dropped towel.
    for k in range(18):
        a = k * TAU / 18
        c = [hexc("#ff4f81"), hexc("#ffd23d"), hexc("#2fb8d6"), hexc("#5fd07a")][k % 4]
        m.cone((math.cos(a) * 6.5, math.sin(a) * 6.5, floor_z + 2.9), 0.28, 0.55, 3, c, rot=(math.pi, 0, 0))
    m.blob((3.4, -6.0, 0.3), (0.5, 0.35, 0.3), 1, hexc("#f4c8a8"))
    m.box((-3.0, -6.6, 0.45), (1.2, 1.0, 0.9), (0, 0, 0.3), BAMBOO_D, bevel=0.05)
    m.box((1.0, -8.2, 0.03), (2.4, 1.2, 0.05), (0, 0, 0.2), hexc("#ff6a3d"))
    # Sand piled round the stilts.
    m.blob((0, 0, -0.2), (R + 3.2, R + 3.2, 0.7), 2, SAND, amp=0.08, flat_base=0.1)
    m.build(parent=root, ao_args=dict(reach=3.0, strength=0.65, rays=16), sharp=50)
    g.build(parent=root, ao=False, sharp=70)
    return root


def sandcastle():
    root = empty("landmark.sandcastle")
    m = Model("castle.body", seed=53)
    water = Model("castle.water", seed=54)
    sand = lambda lo, hi: varied(lambda p, n: mix(SAND_W, mix(SAND_D, SAND, smoothstep(lo, hi, p.z) * 0.9 + 0.1 * n.z), smoothstep(-0.5, 1.5, p.z)), 0.05, 0.5)
    # The mound the whole thing stands on and a ring moat of shallow water, a plank bridge across it.
    m.lathe([(17.0, -0.8), (15.0, 0.35), (12.5, 0.7), (0.0, 0.7)], 36, (0, 0, 0), sand(0, 1.0), cap_end=True)
    water.lathe([(14.6, 0.52), (17.2, 0.5), (17.2, 0.44)], 36, (0, 0, 0), (0.45, 0.78, 0.95), mat="glass") if False else None
    # The curtain wall: a square of crenellated sand walls with four round corner towers.
    S = 10.0
    wall_h = 4.4
    def crenels(x0, y0, x1, y1, z, count):
        for k in range(count):
            t = (k + 0.5) / count
            cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            m.box((cx, cy, z + 0.5), (0.9, 0.9, 1.0), (0, 0, math.atan2(y1 - y0, x1 - x0)), sand(z, z + 1.0), bevel=0.1)
    for (x0, y0, x1, y1) in (((-S, S, S, S)), ((-S, -S, -S, S)), ((S, -S, S, S))):
        L = math.hypot(x1 - x0, y1 - y0)
        ang = math.atan2(y1 - y0, x1 - x0)
        m.box(((x0 + x1) / 2, (y0 + y1) / 2, wall_h / 2), (L, 1.7, wall_h), (0, 0, ang), sand(0, wall_h), bevel=0.2)
        crenels(x0 + 1.2 * math.cos(ang), y0 + 1.2 * math.sin(ang), x1 - 1.2 * math.cos(ang), y1 - 1.2 * math.sin(ang), wall_h, int(L / 1.9))
    # The front wall has a gate: two halves with an arched opening and a drawbridge down over the moat.
    for sx in (-1, 1):
        m.box((sx * 6.2, -S, wall_h / 2), (7.6, 1.7, wall_h), (0, 0, 0), sand(0, wall_h), bevel=0.2)
        crenels(sx * 2.8, -S, sx * 9.4, -S, wall_h, 4)
    m.box((0, -S, wall_h - 0.7), (4.6, 1.7, 1.5), (0, 0, 0), sand(0, wall_h), bevel=0.2)
    m.blob((0, -S - 0.05, 2.2), (2.1, 1.1, 2.3), 2, hexc("#4a3a2a"), flat_base=-0.1)
    m.box((0, -S - 2.2, 0.5), (3.4, 4.0, 0.25), (-0.12, 0, 0), BAMBOO_D, bevel=0.04)
    for k in range(5):
        m.box((0, -S - 0.5 - k * 0.8, 0.62 - 0.04 * k), (3.4, 0.08, 0.06), (0, 0, 0), mul(BAMBOO_D, 0.7))
    # Towers: round, tapering, with a roof of cone and a flag.
    flags = [hexc("#e0343a"), hexc("#ffd23d"), hexc("#2fb8d6"), hexc("#7bd957"), hexc("#ff7ac8")]
    for k, (tx, ty) in enumerate(((-S, -S), (S, -S), (-S, S), (S, S))):
        h = 9.4 + 1.2 * (k % 2)
        m.lathe([(2.9, -0.5), (2.7, 1.0), (2.4, h - 0.8), (2.9, h - 0.6), (2.9, h + 0.3), (2.3, h + 0.35)], 18, (tx, ty, 0), sand(0, h), cap_end=True, mod=lambda j, kk: 1.0 + 0.02 * math.sin(j * 5))
        for q in range(10):
            a = q * TAU / 10
            m.box((tx + math.cos(a) * 2.55, ty + math.sin(a) * 2.55, h + 0.9), (0.85, 0.85, 1.0), (0, 0, a), sand(h, h + 1.0), bevel=0.1)
        m.lathe([(2.0, h + 0.2), (1.3, h + 1.6), (0.0, h + 4.4)], 14, (tx, ty, 0), mul(mix(flags[k % 5], SAND, 0.25), 1.0), cap_start=False)
        post(m, tx, ty, h + 4.3, h + 6.8, 0.07, hexc("#5a3a1e"), 5)
        m.box((tx + 0.65, ty, h + 6.3), (1.2, 0.04, 0.8), (0, 0, 0), flags[(k + 2) % 5], bevel=0.01)
        m.box((tx, ty - 2.6, 5.0), (0.6, 0.15, 1.2), (0, 0, 0), hexc("#4a3a2a"))
    # The keep in the middle: a tall tower with a cone roof and a red flag, a stair winding round the foot.
    m.lathe([(4.2, -0.5), (3.9, 2.0), (3.3, 10.0), (3.9, 10.4), (3.9, 11.4), (3.2, 11.5)], 20, (0, 2.5, 0), sand(0, 11), cap_end=True)
    for q in range(12):
        a = q * TAU / 12
        m.box((math.cos(a) * 3.6, 2.5 + math.sin(a) * 3.6, 11.9), (1.0, 1.0, 1.1), (0, 0, a), sand(11, 12), bevel=0.1)
    m.lathe([(3.0, 11.2), (2.0, 13.6), (0.0, 17.2)], 16, (0, 2.5, 0), mix(hexc("#e0553c"), SAND, 0.2), cap_start=False)
    post(m, 0, 2.5, 17.0, 20.0, 0.08, hexc("#5a3a1e"), 5)
    m.box((0.8, 2.5, 19.2), (1.5, 0.05, 1.0), (0, 0, 0), hexc("#e0343a"), bevel=0.01)
    for k, (wz, a) in enumerate(((7.0, -1.2), (7.0, 0.3), (4.5, -1.6), (9.0, -1.9))):
        m.blob((math.cos(a - 1.5) * 3.35, 2.5 + math.sin(a - 1.5) * 3.35, wz), (0.5, 0.2, 0.8), 1, hexc("#4a3a2a"))
    # A spiral stair outside the keep, shells set in the walls, a starfish.
    for q in range(14):
        a = -1.6 + q * 0.28
        m.box((math.cos(a) * (4.4 + 0.02 * q), 2.5 + math.sin(a) * (4.4 + 0.02 * q), 0.3 + q * 0.5), (1.4, 0.9, 0.3), (0, 0, a + math.pi / 2), sand(0, 8), bevel=0.05)
    for k in range(12):
        a = k * 2.1
        rr = 13.0 + 2.0 * ((k * 5) % 3)
        c = [hexc("#fbf0e0"), hexc("#f4a3b1"), hexc("#ff9f5a"), hexc("#fbf0e0")][k % 4]
        m.blob((math.cos(a) * rr, math.sin(a) * rr, 0.6), (0.55, 0.45, 0.28), 1, c, rot=(0, 0, a))
    # Toys: a red bucket and a yellow spade stuck upright in the sand by the gate.
    m.lathe([(0.6, 0.0), (0.9, 1.0)], 12, (7.0, -13.0, 0.5), hexc("#e0343a"), cap_start=True)
    m.torus((7.0, -13.0, 1.5), 0.9, 0.06, 4, 16, hexc("#c22a2a"))
    rod(m, (9.0, -13.4, 0.2), (9.4, -13.6, 2.6), 0.09, hexc("#ffd23d"))
    m.box((9.5, -13.6, 2.9), (0.8, 0.12, 0.7), (0, 0, 0), hexc("#ffd23d"), bevel=0.04)
    # The moat itself: translucent water in the ditch.
    water.lathe([(11.8, 0.45), (16.2, 0.45)], 36, (0, 0, 0), (0.4, 0.78, 0.95), mat="glass")
    m.build(parent=root, ao_args=dict(reach=4.0, strength=0.65, rays=14), sharp=50)
    water.build(parent=root, ao=False, sharp=70)
    return root


def giant_ring():
    root = empty("landmark.giant-ring")
    m = Model("ring.body", seed=55)
    g = Model("ring.glow", seed=56)
    zc, A, B, r = 16.0, 15.9, 18.0, 2.4
    # The ring: an upright inflatable swim ring, an arch with upright legs (nothing leans out over the verge) and a rounded crown,
    # striped in sectors, its feet buried.
    pts = [V((A, 0.0, -3.2 + (zc + 3.2) * i / 6)) for i in range(6)]
    n_arc = 48
    pts += [V((A * math.cos(math.pi * i / n_arc), 0.0, zc + B * math.sin(math.pi * i / n_arc))) for i in range(n_arc + 1)]
    pts += [V((-A, 0.0, zc - (zc + 3.2) * (i + 1) / 6)) for i in range(6)]
    n = len(pts) - 1
    sectors = 14

    def stripe(p, nn):
        ang = math.atan2((p.z - zc) * (A / B), p.x) % TAU
        k = int(ang / TAU * sectors)
        c = hexc("#ee3b3b") if k % 2 == 0 else hexc("#fbf8ef")
        return mul(c, 0.8 + 0.3 * smoothstep(-0.4, 0.9, nn.z))
    m.tube(pts, [r] * (n + 1), 14, varied(stripe, 0.02, 0.2), cap_start=True, cap_end=True)
    # The ropes: lashings tying the sectors, each a ring of dark twine.
    for i in range(4, n - 3, 6):
        c = pts[i]
        if c.z < -1.0:
            continue
        tang = (pts[i + 1] - pts[i - 1]).normalized()
        side = V((0, 1, 0))
        nrm = tang.cross(side).normalized()
        pts2 = [c + nrm * (r * 1.02 * math.cos(q)) + side * (r * 1.02 * math.sin(q)) for q in [j * TAU / 16 for j in range(16)]]
        m.tube(pts2, [0.14] * 16, 5, hexc("#2c2118"), loop=True)
    # A valve on the crown, a bright cap.
    m.lathe([(0.55, 0.0), (0.45, 0.8), (0.0, 0.9)], 10, (0, 0, zc + B + r - 0.1), hexc("#ffd23d"), cap_start=True)
    # Sandbags and stones at the feet, holding it down; a ring of bulbs along the inner edge (lit by night).
    for sx in (-1, 1):
        # A skirt of sand where it goes into the ground, and a sandbag tucked against the outer side.
        m.blob((sx * A, 0.0, -0.2), (r + 0.5, r + 0.5, 0.6), 1, SAND, amp=0.06, flat_base=0.0)
        m.blob((sx * (A + 0.3), 3.4, 0.3), (0.8, 0.6, 0.4), 1, hexc("#c9a46a"), amp=0.1, seed=3, flat_base=-0.3)
    for i in range(7, n - 6, 2):
        c = pts[i]
        mid = V((0.0, 0.0, zc))
        d = (mid - c).normalized()
        q = c + d * (r + 0.15)
        if q.z < 0.5:
            continue
        g.blob(q, 0.3, 0, GLOW_WARM, mat="glow")
    m.build(parent=root, ao_args=dict(reach=4.0, strength=0.5, rays=12), sharp=60)
    g.build(parent=root, ao=False, sharp=70)
    return root


def wristwatch():
    root = empty("landmark.wristwatch")
    m = Model("watch.body", seed=57)
    glass = Model("watch.glass", seed=58)
    g = Model("watch.glow", seed=59)
    zc, Rc = 23.5, 10.2
    steel = hexc("#cfd8e2")
    steel_d = hexc("#7d8896")
    gold = hexc("#f0b93a")
    strap = hexc("#e8553c")
    strap_d = hexc("#9c3320")
    cream = hexc("#fbf5e4")
    navy = hexc("#1f3556")
    # The case: a steel drum, its axis along the road; a gold bezel on the face (the +y side is toward the oncoming karts).
    t = 2.4
    m.lathe([(Rc, -t), (Rc + 0.35, -t + 0.4), (Rc + 0.35, t - 0.5), (Rc, t)], 40, (0, 0, 0), varied(lambda p, n: mix(steel_d, steel, 0.4 + 0.5 * smoothstep(-0.5, 0.9, n.z)), 0.03, 0.4), rot=(-math.pi / 2, 0, 0)) if False else None
    cc = V((0, 0, zc))
    # lathe about z, tilted to lie along y: build with rot about x by -90 deg so +z axis points to +y.
    m.lathe([(0.0, -t), (Rc, -t), (Rc + 0.4, -t + 0.5), (Rc + 0.4, t - 0.6), (Rc, t), (Rc - 0.9, t + 0.1)], 40, cc, varied(lambda p, n: mix(steel_d, steel, 0.4 + 0.5 * smoothstep(-0.5, 0.9, n.z)), 0.03, 0.4), rot=(-math.pi / 2, 0, 0), cap_start=True)
    m.lathe([(Rc - 0.9, t + 0.1), (Rc - 0.2, t + 0.12), (Rc - 0.2, t + 0.55), (Rc - 0.9, t + 0.5)], 40, cc + V((0, 0, 0)), gold, rot=(-math.pi / 2, 0, 0))
    # The dial: a cream disc, twelve hour batons, a sub-dial, the hands at ten past ten and a red seconds hand.
    dial_y = t + 0.2
    m.lathe([(0.0, 0.0), (Rc - 1.0, 0.0), (Rc - 1.0, 0.1)], 40, cc + V((0, dial_y, 0)), cream, rot=(-math.pi / 2, 0, 0), cap_start=True)
    for k in range(12):
        a = k * TAU / 12
        big = k % 3 == 0
        r0, r1 = (Rc - 3.1, Rc - 1.3) if big else (Rc - 2.4, Rc - 1.3)
        dx, dz = math.sin(a), math.cos(a)
        rod(m, cc + V((dx * r0, dial_y + 0.15, dz * r0)), cc + V((dx * r1, dial_y + 0.15, dz * r1)), 0.28 if big else 0.16, gold if big else navy)
    for (ang, L, w, c) in ((math.radians(-60), 5.2, 0.4, navy), (math.radians(60), 7.4, 0.3, navy), (math.radians(150), 8.2, 0.12, hexc("#e0343a"))):
        dx, dz = math.sin(ang), math.cos(ang)
        rod(m, cc + V((0, dial_y + 0.28, 0)), cc + V((dx * L, dial_y + 0.28, dz * L)), w, c)
    m.blob(cc + V((0, dial_y + 0.3, 0)), 0.5, 1, gold)
    m.lathe([(0.0, 0.0), (2.0, 0.0), (2.0, 0.08)], 20, cc + V((0, dial_y + 0.02, -4.2)), mix(cream, steel, 0.25), rot=(-math.pi / 2, 0, 0), cap_start=True)
    # The crystal: a domed glass over the whole face.
    glass.lathe([(0.0, 0.0), (Rc - 0.9, -0.05), (Rc - 1.6, 0.5), (Rc - 4.0, 0.85), (0.0, 1.05)], 40, cc + V((0, dial_y + 0.7, 0)), (1.0, 1.0, 1.0), mat="glass", rot=(-math.pi / 2, 0, 0))
    # The crown on top and a pusher beside it, a gold lug each side where the strap hangs.
    m.lathe([(0.9, -0.2), (1.1, 0.0), (1.1, 1.2), (0.9, 1.4), (0.0, 1.45)], 14, cc + V((0, 0, Rc + 0.2)), gold, cap_start=True)
    m.box(cc + V((0, 0, Rc + 1.5)), (1.8, 0.8, 0.5), (0, 0, 0), gold, bevel=0.1)
    for sx in (-1, 1):
        m.box(cc + V((sx * (Rc + 0.9), 0.0, 0.0)), (2.4, 3.8, 3.6), (0, 0, 0), steel, bevel=0.3)
        m.box(cc + V((sx * (Rc + 1.4), 0.0, 0.0)), (1.2, 4.6, 0.6), (0, 0, 0), gold, bevel=0.1)
    # The strap: two bands of leather arching down from the lugs to the ground either side of the road, stitched, holed.
    for sx in (-1, 1):
        pts = smooth_path([cc + V((sx * (Rc + 1.8), 0, 0)), cc + V((sx * (Rc + 4.8), 0, -3.2)), V((sx * 15.2, 0, 12.0)), V((sx * 15.2, 0, 4.0)), V((sx * 15.0, 0, -3.0))], 7)
        n = len(pts)
        m.blade(pts, V((0, 1, 0)), lambda t: 2.1, 0.7, lambda p, nn: mix(strap_d, strap, smoothstep(-0.4, 0.9, nn.x * sx * -0.3 + 0.55)), fold=0.0, tip_point=False)
        # Holes and stitching down the outer face.
        for q in range(10):
            u = (q + 1.2) / 11.5
            p = pts[int(u * (n - 1))]
            m.blob(p + V((sx * 0.35, -1.9, 0)), (0.3, 0.1, 0.3), 0, hexc("#5a1a10"))
        for edge in (-1.5, 1.5):
            sp = [q + V((0, edge, 0.0)) for q in pts]
            m.tube(sp, [0.06] * n, 4, cream)
    # The buckle on the right band: a steel frame with a tongue.
    bp = V((15.2, 0, 8.6))
    m.box(bp + V((0.0, 0, 0)), (1.0, 4.8, 3.0), (0, 0, 0), steel, bevel=0.2)
    m.box(bp + V((0.0, 0, 0)), (1.2, 3.6, 1.6), (0, 0, 0), strap, bevel=0.1)
    # Feet: the straps are buried in sand, a mound each side.
    for sx in (-1, 1):
        m.blob((sx * 16.2, 0.0, 0.0), (3.4, 4.0, 0.7), 2, SAND, amp=0.08, flat_base=0.0)
    # The glow: the hour batons and the hands lit by night, and a ring of light round the bezel.
    for k in range(12):
        a = k * TAU / 12
        g.blob(cc + V((math.sin(a) * (Rc - 0.55), dial_y + 0.25, math.cos(a) * (Rc - 0.55))), 0.18, 0, GLOW_WARM, mat="glow")
    m.build(parent=root, ao_args=dict(reach=4.0, strength=0.5, rays=12), sharp=55)
    glass.build(parent=root, ao=False, sharp=70)
    g.build(parent=root, ao=False, sharp=70)
    return root


def landmarks():
    return [beach_hut(), sandcastle(), giant_ring(), wristwatch()]
