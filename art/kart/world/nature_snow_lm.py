"""The glacier's landmarks: cabin, igloo, ice-arch (a span), snowman, gondola. Blender coordinates: z up, the
front (the side that faces the road) is -y; a span model has x right of the road's centre line and the road
running along -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, grad_z, hexc, mix, mul, post, rod, smooth_path, smoothstep, spinner, varied, TAU
from nature_snow import SNOW, SNOW_SHADE

LOG = hexc("#8a5a35")
LOG_D = hexc("#4d2f1c")
LOG_L = hexc("#b07a45")
WARM = (0.9, 0.62, 0.24)      # lit window: a glow colour (the glow material's strength carries it over 1)


def n3(x, y, z, seed=0.0):
    return noise.noise(V((x + seed * 17.3, y - seed * 9.1, z + seed * 4.7)))


def icicles(m, pts, length, col, count_scale=1.0, mat="lit"):
    """Hanging cones along a line of points (an eave, an arch)."""
    for k, p in enumerate(pts):
        l = length * (0.5 + 0.9 * ((k * 37) % 10) / 10)
        r = 0.09 + 0.07 * ((k * 17) % 5) / 4
        m.lathe([(r, 0.0), (r * 0.55, -l * 0.5), (0.0, -l)], 5, V(p), col, mat=mat, cap_start=False)


def cabin():
    root = empty("landmark.cabin")
    m = Model("cabin.body", seed=21)
    W, D = 7.2, 5.2          # half width and half depth
    r = 0.5
    courses = 9
    cols = [LOG, LOG_L, mul(LOG, 0.85), LOG_D]
    colf = lambda q: varied(mix(cols[q % 4], LOG_D, 0.05 * (q % 3)), 0.06, 1.5, q)
    # A stone footing, then the log walls, corners notched and crossing.
    m.box((0, 0, 0.35), (2 * W + 0.8, 2 * D + 0.8, 0.9), (0, 0, 0), varied(grad_z(-0.1, 0.8, hexc("#4d555e"), hexc("#8e979f")), 0.1, 1.2), bevel=0.1)
    z0 = 0.8
    for q in range(courses):
        z = z0 + r + q * (2 * r * 0.93)
        c = colf(q)
        m.tube([V((-W - 0.5, -D, z)), V((W + 0.5, -D, z))], [r, r], 8, c, cap_start=True, cap_end=True)
        m.tube([V((-W - 0.5, D, z)), V((W + 0.5, D, z))], [r, r], 8, c, cap_start=True, cap_end=True)
        c2 = colf(q + 2)
        m.tube([V((-W, -D - 0.5, z + r * 0.9)), V((-W, D + 0.5, z + r * 0.9))], [r, r], 8, c2, cap_start=True, cap_end=True)
        m.tube([V((W, -D - 0.5, z + r * 0.9)), V((W, D + 0.5, z + r * 0.9))], [r, r], 8, c2, cap_start=True, cap_end=True)
    top = z0 + 2 * r + courses * 2 * r * 0.93 + 0.2
    # The roof: thick timber under a deep blanket of snow, pitched, with a big overhang to the front.
    ridge = top + 3.3
    ov = 1.2
    prof = [(-W - ov, top - 0.2), (0, ridge), (W + ov, top - 0.2), (W + ov, top - 0.6), (0, ridge - 0.4), (-W - ov, top - 0.6)]
    m.prism_y(prof, -D - 1.3, D + 0.8, varied(grad_z(top - 0.6, ridge, hexc("#3d2616"), hexc("#6b4527")), 0.06, 1.3))
    # The snow on it: a fat white pillow with a soft edge, thicker at the ridge.
    snow_prof = [(-W - ov - 0.3, top - 0.1), (-W * 0.5, top + 1.6), (0, ridge + 0.75), (W * 0.5, top + 1.6), (W + ov + 0.3, top - 0.1), (W + ov + 0.1, top - 0.55), (0, ridge + 0.1), (-W - ov - 0.1, top - 0.55)]
    m.prism_y(snow_prof, -D - 1.55, D + 1.0, varied(lambda p, n: mix(SNOW_SHADE, SNOW, smoothstep(-0.2, 0.9, n.z)), 0.03, 0.8), caps=True)
    for sx in (-1, 1):
        icicles(m, [(sx * (W + ov + 0.1), -D - 1.2 + k * 0.7, top - 0.5) for k in range(0, 8)], 1.3, hexc("#d6efff"))
    icicles(m, [(-W - ov + k * 1.1, -D - 1.45, top - 0.35) for k in range(0, 12)], 1.5, hexc("#d6efff"))
    # The stone chimney, snow on its cap.
    m.box((-W * 0.55, 1.0, ridge + 0.7), (1.6, 1.6, 4.8), (0, 0, 0), varied(grad_z(top, ridge + 3.1, hexc("#59626b"), hexc("#98a1a9")), 0.12, 1.5), bevel=0.1)
    m.box((-W * 0.55, 1.0, ridge + 3.2), (2.0, 2.0, 0.4), (0, 0, 0), hexc("#6d7680"), bevel=0.06)
    m.blob((-W * 0.55, 1.0, ridge + 3.5), (1.1, 1.1, 0.4), 1, SNOW)
    # The door and its porch: planks, a lantern, steps; a deck under a little roof on two posts.
    m.box((0, -D - 0.15, 0.8 + 1.4), (1.9, 0.3, 2.7), (0, 0, 0), grad_z(0.8, 3.6, LOG_D, LOG), bevel=0.05)
    m.box((0.6, -D - 0.45, 2.1), (0.2, 0.2, 0.2), (0, 0, 0), hexc("#e8c04a"), bevel=0.03)
    m.box((0, -D - 1.6, 0.55), (4.0, 2.6, 0.35), (0, 0, 0), grad_z(0.3, 0.8, LOG_D, LOG_L), bevel=0.05)
    for sx in (-1.7, 1.7):
        post(m, sx, -D - 2.7, 0.7, top - 0.3, 0.17, LOG_D)
    for q in range(3):
        m.box((0, -D - 3.1 - q * 0.5, 0.15 + (2 - q) * 0.22), (3.0, 0.6, 0.3), (0, 0, 0), LOG_L, bevel=0.05)
    rod(m, (-1.9, -D - 2.7, 1.55), (1.9, -D - 2.7, 1.55), 0.07, LOG_D)
    # Windows with shutters, a light inside: warm glow panes, frames and flower boxes.
    g = Model("cabin.glow", seed=22)
    for wx, wy, face in ((-3.4, -D - 0.07, "f"), (3.4, -D - 0.07, "f"), (W + 0.07, -1.0, "s"), (-W - 0.07, 0.8, "s")):
        if face == "f":
            m.box((wx, wy, 2.8), (1.8, 0.2, 1.5), (0, 0, 0), hexc("#6b4527"), bevel=0.04)
            g.box((wx, wy - 0.12, 2.8), (1.4, 0.1, 1.1), (0, 0, 0), WARM, mat="glow")
            m.box((wx, wy - 0.15, 2.8), (0.12, 0.14, 1.1), (0, 0, 0), hexc("#6b4527"))
            m.box((wx, wy - 0.15, 2.8), (1.4, 0.14, 0.12), (0, 0, 0), hexc("#6b4527"))
            m.box((wx - 1.15, wy - 0.12, 2.8), (0.55, 0.12, 1.5), (0, 0, 0), hexc("#b83a30"), bevel=0.03)
            m.box((wx + 1.15, wy - 0.12, 2.8), (0.55, 0.12, 1.5), (0, 0, 0), hexc("#b83a30"), bevel=0.03)
            m.box((wx, wy - 0.3, 2.0), (1.8, 0.4, 0.3), (0, 0, 0), LOG_D, bevel=0.03)
            m.blob((wx, wy - 0.3, 2.25), (0.8, 0.2, 0.18), 1, SNOW)
        else:
            m.box((wx, wy, 2.8), (0.2, 1.8, 1.5), (0, 0, 0), hexc("#6b4527"), bevel=0.04)
            g.box((wx + (0.1 if wx > 0 else -0.1), wy, 2.8), (0.1, 1.4, 1.1), (0, 0, 0), WARM, mat="glow")
    # The woodpile against the side wall and a sled leaning by the door.
    for row in range(3):
        for col in range(5 - row):
            m.tube([V((W + 1.0, -2.2 + col * 0.52 + row * 0.26, 0.4 + row * 0.42)), V((W + 2.8, -2.2 + col * 0.52 + row * 0.26, 0.4 + row * 0.42))], [0.22, 0.22], 7, varied(LOG_L if (row + col) % 2 else LOG, 0.1, 3.0, row * 7 + col), cap_start=True, cap_end=True)
    # Drifts banked against the walls, and a bright lantern by the door.
    m.blob((0, -D - 2.6, 0.0), (3.4, 1.4, 0.6), 1, SNOW, amp=0.1, flat_base=-0.1)
    m.blob((W + 0.6, 2.0, 0.0), (1.6, 3.4, 0.9), 1, SNOW, amp=0.12, flat_base=-0.1)
    m.blob((-W - 0.6, -1.0, 0.0), (1.8, 3.8, 1.0), 1, SNOW, amp=0.12, flat_base=-0.1)
    post(m, 3.2, -D - 3.3, 0.0, 2.2, 0.08, LOG_D)
    g.blob((3.2, -D - 3.3, 2.4), 0.25, 1, WARM, mat="glow")
    m.build(parent=root, ao_args=dict(reach=3.0, strength=0.7, rays=16), sharp=45)
    g.build(parent=root, ao=False, sharp=60)
    # Smoke from the chimney: three puffs wound slowly about it.
    sp = spinner(root, "cabin.smoke", "y", (-W * 0.55, 1.0, ridge + 3.8), 0.35)
    s = Model("cabin.smoke", seed=23)
    for k in range(4):
        a = k * 1.6
        s.blob(V((-W * 0.55 + math.cos(a) * (0.6 + k * 0.3), 1.0 + math.sin(a) * (0.6 + k * 0.3), ridge + 4.0 + k * 1.3)), 0.7 + 0.35 * k, 2, mix(hexc("#d7dbe3"), hexc("#f2f4f8"), k / 3), amp=0.1, seed=k)
    s.build(parent=sp, ao=False, sharp=70)
    return root


def igloo():
    root = empty("landmark.igloo")
    m = Model("igloo.body", seed=24)
    R = 7.4
    block = [hexc("#eef6ff"), hexc("#dfeeff"), hexc("#e8f2ff"), hexc("#d3e6fb")]
    # The dome: courses of snow blocks, each course a little narrower and each block a little proud.
    rows = 8
    for q in range(rows):
        t0, t1 = q / rows, (q + 1) / rows
        a0, a1 = t0 * math.pi * 0.5, t1 * math.pi * 0.5
        n = max(6, int(24 * math.cos(a0)))
        for j in range(n):
            th0 = (j / n) * TAU + q * 0.4
            th1 = ((j + 1) / n) * TAU + q * 0.4
            thm = (th0 + th1) / 2
            col = mix(block[(j + q) % 4], hexc("#b9d2f2"), 0.35 * (1 - t0) * 0.6)
            def P(a, th, k=1.0):
                return V((math.cos(a) * math.cos(th) * R * k, math.sin(th) * math.cos(a) * R * k, math.sin(a) * R * 0.98 * k - 0.4))
            ring = [[P(a0, th0), P(a0, thm, 1.03), P(a0, th1)], [P(a1, th0), P(a1, thm, 1.03), P(a1, th1)]]
            m.loft(ring, varied(col, 0.03, 2.0, j + q), close=False)
    # The entrance: a vaulted tunnel of blocks reaching toward the road, dark inside with a warm glow.
    tl = 4.8
    for q in range(4):
        y0 = -R + 0.6 - q * tl / 4
        y1 = y0 - tl / 4
        for j in range(8):
            a0 = math.pi * j / 8
            a1 = math.pi * (j + 1) / 8
            col = block[(j + q) % 4]
            def T(a, y, k=1.0):
                return V((math.cos(a) * 2.2 * k, y, math.sin(a) * 2.7 * k))
            m.loft([[T(a0, y0), T(a1, y0)], [T(a0, y1, 1.0), T(a1, y1, 1.0)], ], varied(col, 0.03, 2.0, j * 3 + q), close=False)
            m.loft([[T(a0, y0, 1.18), T(a1, y0, 1.18)], [T(a0, y1, 1.18), T(a1, y1, 1.18)]], varied(col, 0.03, 2.0, j * 5 + q), close=False)
    m.box((0, -R - tl + 0.6, 0.05), (5.6, 0.5, 0.3), (0, 0, 0), block[0], bevel=0.05)
    # Snow drifted all round and a doorstep ramp.
    m.blob((0, 0, -0.5), (R + 1.8, R + 1.6, 1.0), 2, SNOW, amp=0.08, flat_base=0.1)
    m.blob((0, -R - tl * 0.6, -0.1), (2.6, 3.4, 0.45), 1, SNOW, amp=0.1, flat_base=0.0)
    # A little flag on a pole at the crown, a sled and skis stuck in the snow.
    post(m, 0, 0, R - 0.6, R + 2.2, 0.06, LOG_D, 5)
    m.box((0.55, 0, R + 1.7), (1.0, 0.04, 0.7), (0, 0, 0), hexc("#d93a3a"), bevel=0.01)
    for sx in (-1, 1):
        rod(m, (sx * 0.28 + 4.8, -5.8, 0.0), (sx * 0.28 + 4.4, -7.4, 1.1), 0.08, hexc("#c4553a"))
        rod(m, (sx * 0.28 - 4.8, -5.2, 0.0), (sx * 0.28 - 4.4, -6.8, 1.0), 0.08, hexc("#3d6fa8"))
    m.box((6.5, -3.0, 0.35), (1.0, 2.6, 0.2), (0, 0, 0.2), LOG_L, bevel=0.04)
    for sx in (-1, 1):
        rod(m, (6.5 + sx * 0.45, -4.2, 0.45), (6.5 + sx * 0.45, -1.8, 0.45), 0.05, hexc("#6b7480"))
    # An ice-block lantern at the door, glowing.
    g = Model("igloo.glow", seed=25)
    g.box((0, -R + 0.5, 1.3), (3.0, 0.2, 2.4), (0, 0, 0), WARM, mat="glow")
    g.blob((4.4, -4.6, 1.2), 0.38, 1, (0.55, 0.9, 1.0), mat="glow")
    post(m, 4.4, -4.6, 0.0, 1.0, 0.07, LOG_D)
    m.build(parent=root, ao_args=dict(reach=3.5, strength=0.65, rays=16), sharp=55)
    g.build(parent=root, ao=False, sharp=60)
    return root


def ice_arch():
    root = empty("landmark.ice-arch")
    hw, top = 14.2, 16.5
    half = 7.8
    slices, arc = 12, 22
    # The shell: translucent ice, thin and a little pointed at the crown (a gothic arch).
    shell = Model("icearch.shell", seed=26)
    core = Model("icearch.core", seed=27)
    rings = []
    for si in range(slices + 1):
        u = si / slices
        zz = -half + 2 * half * u
        taper = 0.6 + 0.4 * math.sqrt(math.sin(math.pi * min(1.0, max(0.0, u * 0.94 + 0.03))))
        ring = []
        for i in range(arc + 1):
            th = math.pi * i / arc
            wob = 1.0 + 0.06 * n3(math.cos(th) * 2, zz * 0.3, math.sin(th) * 2, 3)
            x = math.cos(th) * hw * wob
            z = (math.sin(th) ** 0.85) * top * wob
            thick = (2.2 + 1.6 * math.sin(th)) * taper
            nx, nz = math.cos(th) / hw, math.sin(th) / top
            nl = math.hypot(nx, nz) or 1.0
            ring.append((V((x, zz, z)), V((x + nx / nl * thick, zz, z + nz / nl * thick))))
        inner = [p[0] for p in ring]
        outer = [p[1] for p in ring][::-1]
        full = [V((q.x, q.y, q.z - 2.5 if q.z < 0.6 else q.z)) for q in inner + outer]
        rings.append(full)
    ice_col = varied(lambda p, n: mix(hexc("#2f9ee8"), hexc("#a8e6ff"), smoothstep(0.0, 19.0, p.z) * 0.6 + 0.4 * smoothstep(-0.3, 0.9, n.z)), 0.05, 0.6, 2)
    shell.loft(rings[::-1], ice_col, mat="glass")
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        inner, outer = ring[: arc + 1], ring[arc + 1:][::-1]
        shell.loft([outer, inner] if flip else [inner, outer], ice_col, mat="glass", close=False)
    # A glowing seam of blue inside the ice, along the crown, and the snow capped on top.
    pts = [V((math.cos(th) * hw * 0.99, 0.0, (math.sin(th) ** 0.85) * top * 0.99 + 1.0)) for th in [math.pi * i / arc for i in range(2, arc - 1)]]
    core.tube(pts, [0.18] * len(pts), 5, (0.45, 0.85, 1.0), mat="glow", cap_start=True, cap_end=True)
    solid = Model("icearch.solid", seed=28)
    cap = []
    for i in range(3, arc - 2):
        th = math.pi * i / arc
        x = math.cos(th) * hw
        z = (math.sin(th) ** 0.85) * top
        cap.append(V((x * 1.06, 0.0, z * 1.0 + 3.2)))
    sm = smooth_path(cap, 2)
    solid.tube(sm, lambda t: 1.1 + 1.5 * math.sin(math.pi * t) ** 0.7, 8, varied(lambda p, n: mix(SNOW_SHADE, SNOW, smoothstep(-0.2, 0.9, n.z)), 0.03, 0.8), cap_start=True, cap_end=True, squash=2.2)
    # Icicles from the underside and frozen crystals at the feet.
    under = [V((math.cos(th) * hw * 0.98, (k % 5 - 2) * 2.4, (math.sin(th) ** 0.85) * top * 0.98 - 0.1)) for k, th in enumerate([math.pi * i / arc for i in range(3, arc - 2)])]
    icicles(solid, under, 2.6, hexc("#d6efff"))
    for sx in (-1, 1):
        for k in range(5):
            a = k * 1.3 + sx
            h = 2.5 + 3.5 * ((k * 7) % 5) / 4
            solid.lathe([(0.55, 0.0), (0.6, h * 0.8), (0.0, h)], 6, (sx * (hw + 3.2 + ((k * 3) % 4)), math.sin(a) * 5.5, -0.4), hexc("#9ad8ff"), cap_start=True, rot=(0.1 * math.sin(a), 0.1 * sx, 0))
        solid.blob((sx * (hw + 4.0), -2.5 * sx, 0.0), (4.4, 3.4, 1.4), 2, SNOW, amp=0.1, flat_base=-0.1)
    shell.build(parent=root, ao=False, sharp=70)
    core.build(parent=root, ao=False, sharp=60)
    solid.build(parent=root, ao_args=dict(reach=3.0, strength=0.55, rays=14), sharp=55)
    return root


def snowman():
    root = empty("landmark.snowman")
    m = Model("snowman.body", seed=29)
    sn = varied(lambda p, n: mix(SNOW_SHADE, SNOW, smoothstep(-0.7, 0.9, n.z * 0.8 + n.y * -0.15 + 0.1)), 0.02, 0.5)
    # Three stacked balls, a little lumpy, sunk a little into one another and into the snow.
    m.blob((0, 0, 4.3), (5.4, 5.2, 4.8), 3, sn, amp=0.04, seed=1)
    m.blob((0.1, -0.2, 10.4), (4.0, 3.9, 3.7), 3, sn, amp=0.04, seed=2)
    m.blob((0.1, -0.3, 15.2), (3.0, 2.95, 2.8), 3, sn, amp=0.04, seed=3)
    # Coal buttons, eyes and mouth, a carrot nose.
    coal = hexc("#1f2328")
    for z, y in ((8.9, -3.62), (10.4, -3.88), (11.9, -3.62)):
        m.blob((0, y, z), (0.42, 0.22, 0.42), 1, coal)
    for sx in (-0.95, 0.95):
        m.blob((sx, -3.0, 16.0), (0.4, 0.22, 0.45), 1, coal)
    for k in range(7):
        a = -0.9 + k * 0.3
        m.blob((math.sin(a) * 1.5, -3.05 + (1 - math.cos(a)) * 0.9, 14.5 - (1 - math.cos(a * 2.0)) * 0.9), (0.22, 0.14, 0.22), 0, coal)
    m.lathe([(0.5, 0.0), (0.35, 1.5), (0.0, 3.4)], 8, (0, -3.0, 15.2), hexc("#ff7a1c"), rot=(math.pi / 2 + 0.1, 0, 0), cap_start=True)
    # The scarf: wound twice round the neck, two tails over the shoulder; stripes of red and cream.
    red, cream = hexc("#d1342f"), hexc("#f4ecd8")
    for k, z in enumerate((12.6, 13.5)):
        pts = [V((math.cos(a) * 2.9, math.sin(a) * 2.9, z + 0.5 * math.sin(a * 0.5))) for a in [k * 0.4 + i * TAU / 20 for i in range(20)]]
        m.tube(pts, [0.5] * 20, 6, varied(lambda p, n: mix(red, cream, 0.5 + 0.5 * math.sin(p.x * 2.4 + p.y * 2.4)), 0.02), loop=True, squash=0.9)
    for sx, l in ((0.9, 5.0), (-0.1, 3.8)):
        pts = smooth_path([V((sx + 1.5, -2.5, 12.8)), V((sx + 2.3, -2.9, 10.6)), V((sx + 2.5, -3.0, 8.4 - l * 0.2))], 3)
        m.tube(pts, [0.45, 0.45, 0.4, 0.4, 0.4, 0.38, 0.38], 6, red, cap_end=True)
    # The hat: a black top hat with a red band.
    m.lathe([(2.6, 17.4), (2.6, 17.6), (1.5, 17.7), (1.5, 20.9), (0.0, 21.0)], 16, (0, 0, 0), hexc("#25232b"), cap_start=True)
    m.torus((0, 0, 17.95), 1.55, 0.2, 6, 24, hexc("#c22f2f"))
    # Stick arms, out to the sides with forked fingers, and a broom behind.
    wood = hexc("#5a3b22")
    for sx in (-1, 1):
        arm = smooth_path([V((sx * 3.2, -0.2, 10.9)), V((sx * 6.0, -0.3, 12.4)), V((sx * 8.8, -0.2, 13.6)), V((sx * 10.8, -0.3, 15.2))], 3)
        m.tube(arm, lambda t: 0.28 - 0.1 * t, 5, wood, round_end=1.0)
        for f in (-1, 1):
            m.tube([V((sx * 9.0, -0.2, 13.7)), V((sx * 10.0, -0.25 + f * 0.1, 13.9 + f * 0.9)), V((sx * 10.6, -0.3 + f * 0.1, 14.1 + f * 1.5))], [0.12, 0.1, 0.07], 4, wood, round_end=1.0)
    # Tracks of snow thrown up round the base and a little pile of snowballs.
    m.blob((0, 0, 0.0), (7.4, 7.0, 1.4), 2, SNOW, amp=0.06, flat_base=-0.1)
    for k, (x, y) in enumerate(((6.0, -4.0), (7.4, -3.2), (6.6, -2.4))):
        m.blob((x, y, 0.9), 0.8, 2, sn, amp=0.04, seed=k)
    m.build(parent=root, ao_args=dict(reach=3.0, strength=0.55, rays=14), sharp=60)
    return root


def gondola():
    root = empty("landmark.gondola")
    m = Model("gondola.body", seed=30)
    steel = hexc("#c7d0da")
    steel_d = hexc("#566271")
    red = hexc("#d6392f")
    # Two lattice pylons with a cross-arm and sheave wheels, on concrete feet.
    for sx in (-1, 1):
        x = sx * 36.0
        m.box((x, 0, 0.6), (6.0, 6.0, 1.6), (0, 0, 0), hexc("#9aa3ad"), bevel=0.1)
        top = 25.0
        for lx, ly in ((-1.3, -1.3), (1.3, -1.3), (-1.3, 1.3), (1.3, 1.3)):
            rod(m, (x + lx * 1.5, ly * 1.5, 1.2), (x + lx * 0.55, ly * 0.55, top), 0.22, grad_z(1, top, steel_d, steel))
        for z in range(3, 25, 4):
            f = 1.0 - z / top * 0.62
            for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
                rod(m, (x + a[0] * 1.95 * f, a[1] * 1.95 * f, z), (x + b[0] * 1.95 * f, b[1] * 1.95 * f, z), 0.1, steel_d)
            rod(m, (x - 1.95 * f, -1.95 * f, z), (x + 1.95 * f * 0.6, -1.95 * f * 0.6, z + 4), 0.07, steel_d)
        m.box((x, 0, top + 0.3), (3.4, 9.0, 0.6), (0, 0, 0), steel_d, bevel=0.06)
        m.box((x, 0, top + 1.0), (1.2, 2.0, 1.4), (0, 0, 0), red, bevel=0.1)
    # The haul rope, two lines, sagging between the pylons; the cabin hangs from them.
    for y in (-1.6, 1.6):
        pts = []
        for i in range(25):
            t = i / 24
            x = -36.0 + 72.0 * t
            pts.append(V((x, y, 26.0 - 3.0 * (1 - (2 * t - 1) ** 2))))
        m.tube(pts, [0.12] * 25, 5, hexc("#2a2e34"), cap_start=True, cap_end=True)
    m.build(parent=root, ao_args=dict(reach=3.0, strength=0.6, rays=12), sharp=50)
    # A big bullwheel at the left pylon, turning.
    wheel = spinner(root, "gondola.wheel", "z", (-36.0, -3.4, 25.8), 0.5)
    w = Model("gondola.wheel", seed=31)
    w.torus(V((-36.0, -3.4, 25.8)), 1.5, 0.16, 6, 28, hexc("#2a2e34"), axis="y")
    for k in range(6):
        a = k * math.pi / 3
        rod(w, (-36.0, -3.4, 25.8), (-36.0 + math.cos(a) * 1.5, -3.4, 25.8 + math.sin(a) * 1.5), 0.08, steel_d)
    w.blob((-36.0, -3.4, 25.8), 0.28, 1, red)
    w.build(parent=wheel, ao=False, sharp=60)
    # The cabin: a red egg-shaped gondola with big windows, a grip arm up to the rope, a roof of snow.
    c = Model("gondola.cabin", seed=32)
    gl = Model("gondola.glass", seed=33)
    cz = 17.5
    c.lathe([(0.0, cz - 2.5), (2.0, cz - 2.4), (2.4, cz - 1.0), (2.4, cz + 0.4), (2.0, cz + 1.4), (0.0, cz + 1.7)], 14, (0, 0, 0), varied(grad_z(cz - 2.5, cz + 1.7, mul(red, 0.7), red), 0.03, 1.0), squash=0.8, cap_start=True)
    c.box((0, 0, cz - 0.1), (4.6, 3.6, 0.4), (0, 0, 0), hexc("#f6f2e8"), bevel=0.06)
    gl.lathe([(2.38, cz - 0.6), (2.42, cz - 0.1), (2.3, cz + 1.0), (2.0, cz + 1.35)], 14, (0, 0, 0), (0.7, 0.9, 1.0), mat="glass", squash=0.8)
    c.lathe([(2.2, cz + 1.6), (1.4, cz + 2.2), (0.0, cz + 2.4)], 14, (0, 0, 0), SNOW, squash=0.8, cap_start=True)
    for sy in (-1, 1):
        rod(c, (0.0, sy * 1.6, cz + 2.0), (0.0, sy * 1.6, 25.1), 0.14, steel_d)
    rod(c, (0.0, -1.6, cz + 2.0), (0.0, 1.6, cz + 2.0), 0.14, steel_d)
    c.build(parent=root, ao_args=dict(reach=2.5, strength=0.5, rays=12), sharp=60)
    gl.build(parent=root, ao=False, sharp=70)
    return root


def landmarks():
    return [cabin(), igloo(), ice_arch(), snowman(), gondola()]
