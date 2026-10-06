"""The volcano's landmarks: volcano, stone-bridge (a span), lava-fall. Blender coordinates: z up, the front (the
side that faces the road) is -y; a span model has x right of the road's centre line and the road running along -y.
Lava is the glow material (emissive strength 2): its vertex colours are 0..1 and the strength carries them
over 1, as the game's lights read them."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, grad_z, hexc, mix, mul, post, rod, smooth_path, smoothstep, spinner, tint, varied, TAU
from nature_volcano import BASALT_D, BASALT_M, BASALT_L, LAVA, LAVA_HOT, LAVA_DEEP, basalt

LAVA_CRUST = (0.55, 0.12, 0.03)


def n3(x, y, z, seed=0.0):
    return noise.noise(V((x + seed * 17.3, y - seed * 9.1, z + seed * 4.7)))


def lava_ribbon(g, pts, widths, col_at, side, thick=0.25):
    """A flowing strip of lava lying along a draped path."""
    n = len(pts)
    g.blade(pts, side, lambda t: widths(t), thick, lambda p, nn: col_at(p), mat="glow", fold=0.12, tip_point=False)


def lava_col(top_z, bottom_z):
    """A flow cools as it runs: white-hot where it spills, orange in the middle, a dull crust at the foot."""
    def f(p):
        t = max(0.0, min(1.0, (p.z - bottom_z) / (top_z - bottom_z)))
        return mix(mix(LAVA_CRUST, LAVA, smoothstep(0.0, 0.45, t)), LAVA_HOT, smoothstep(0.55, 1.0, t))
    return f


def volcano():
    root = empty("landmark.volcano")
    H = 141.0
    m = Model("volcano.body", seed=41)
    g = Model("volcano.lava", seed=42)
    rim_notch = lambda th: 13 * max(0.0, math.cos(th + 1.25)) ** 3 + 5 * max(0.0, math.cos(th - 2.0)) ** 4
    radius_at = lambda z: 134.0 if z <= 0 else 22.0 + 112.0 * max(0.0, 1.0 - z / H) ** 2.4
    zs = [-8.0, 0.0] + [float(z) for z in range(6, 130, 6)] + [130.0, 136.0, 141.0]
    sides = 56
    rings = []
    for k, z in enumerate(zs):
        ring = []
        for j in range(sides):
            th = j * TAU / sides
            ridge = (1 if j % 2 == 0 else -1) * (0.035 + 0.075 * (1 - max(0.0, z) / H)) + 0.05 * n3(math.cos(th) * 2.0, math.sin(th) * 2.0, z * 0.03, 2) + 0.03 * math.sin(th * 3 + z * 0.02)
            top_rows = k >= len(zs) - 3
            zz = z - (rim_notch(th) * (1.0 if k == len(zs) - 1 else 0.35) if top_rows else 0.0)
            r = radius_at(min(zz + (rim_notch(th) if top_rows else 0.0), H)) * (1.0 + ridge)
            ring.append(V((math.cos(th) * r, math.sin(th) * r, zz)))
        rings.append(ring)

    def col(p, n):
        z = p.z
        base = mix(hexc("#3a211c"), hexc("#2c2631"), smoothstep(-5, 25, z))
        base = mix(base, hexc("#4a4352"), smoothstep(30, 140, z) * 0.9)
        sun = smoothstep(-0.2, 0.9, n.z * 0.8)
        c = mix(mul(base, 0.75), mix(base, hexc("#6a6074"), 0.5), sun)
        # The lava lights the underside of the crater's lip and the whole upper cone a dull red.
        glow = smoothstep(95, 141, z)
        return mix(c, hexc("#80301a"), glow * 0.35 * (1 - sun * 0.6))
    m.loft(rings, varied(col, 0.12, 0.05, 3), cap_end=True, cap_start=True)
    # The crater: a lake of lava a little below the lip, a glowing rim, a fire fountain.
    lake_z = H - 15.0
    g.lathe([(0.0, lake_z), (19.0, lake_z + 0.2), (21.0, lake_z + 1.5), (0.0, lake_z + 1.5)], 24, (0, 0, 0), lambda p, n: mix(LAVA_HOT, LAVA, smoothstep(0, 19, math.hypot(p.x, p.y)) * 0.8 + 0.2 * (0.5 + 0.5 * n3(p.x * 0.2, p.y * 0.2, 0, 4))), mat="glow", cap_start=True)
    rim_pts = [V((math.cos(th) * (22.4 + 0.5 * math.sin(th * 5)), math.sin(th) * (22.4 + 0.5 * math.sin(th * 5)), H - rim_notch(th) + 0.8)) for th in [i * TAU / 36 for i in range(36)]]
    g.tube(rim_pts, [1.5] * 36, 5, lambda p, n: LAVA_HOT if n3(p.x * 0.3, p.y * 0.3, 0, 7) > 0 else LAVA, mat="glow", loop=True)
    g.lathe([(7.0, H + 0.0), (4.0, H + 14.0), (0.0, H + 38.0)], 8, (0, 0, 0), lambda p, n: mix(LAVA, LAVA_HOT, smoothstep(H, H + 36, p.z)), mat="glow", cap_start=True)
    g.lathe([(11.0, H - 3.0), (6.0, H + 6.0), (0.0, H + 18.0)], 8, (2, -1, 0), lambda p, n: mix(LAVA_DEEP, LAVA, smoothstep(H - 3, H + 16, p.z)), mat="glow", cap_start=True)
    rng = m.rng
    for k in range(16):
        a = k * 2.4
        u = ((k * 7) % 10) / 10
        g.blob(V((math.cos(a) * (6 + u * 22), math.sin(a) * (6 + u * 22), H + 8 + u * 42 + (k % 3) * 6)), 1.4 + (k % 4) * 0.7, 1, LAVA if k % 3 else LAVA_HOT, mat="glow")
    # The broken crown: teeth along the back of the rim.
    for k in range(8):
        th = 2.4 + k * 0.5
        rr = 21.5 + 4 * ((k * 5) % 3) / 2
        base = H - rim_notch(th) - 2
        hgt = 8 + 11 * ((k * 7) % 5) / 4
        m.cone((math.cos(th) * rr, math.sin(th) * rr, base), 3.8 + 3 * ((k * 3) % 3) / 2, hgt, 5, varied(grad_z(base, base + hgt, BASALT_M, hexc("#5e5568")), 0.1, 0.3, k), rot=(0.08 * (k - 4), 0.06, 0))
    # Rivers of lava down the flanks: draped on the cone, forking and cooling as they go.
    streaks = [(-2.2, 1.6, 3.0), (-1.45, 2.3, 3.0), (-1.0, 1.5, 2.4), (-0.45, 1.1, 3.2), (0.05, 2.9, 4.2), (0.5, 1.7, 2.6), (1.0, 2.4, 3.4), (1.55, 1.2, 2.2), (2.3, 1.8, 3.0)]
    for si, (th0, end, w) in enumerate(streaks):
        z_end = max(2.0, (end - 1.0) * 14.0)
        pts_far = []
        steps = 26
        for q in range(steps + 1):
            u = q / steps
            z = (H - 8) - u * ((H - 8) - z_end)
            th = th0 + math.sin(u * 9 + si * 1.7) * 0.05 * (1 + u) + (n3(u * 4, si, 0, 5)) * 0.02
            pts_far.append(V((math.cos(th) * 420, math.sin(th) * 420, z)))
        on = m.drape(pts_far, lambda p: V((0, 0, p.z)), lift=1.0)
        widths = lambda t, w=w: w * 0.7 * (0.5 + 0.9 * math.sin(math.pi * min(1.0, t * 1.1 + 0.1)) + 0.25 * t)
        g.blade(on, V((-math.sin(th0), math.cos(th0), 0)), widths, 0.4, lambda p, n, top=H - 8, bot=z_end: lava_col(top, bot)(p), mat="glow", fold=0.0, tip_point=False)
    # Rubble round the foot, black boulders of every size, and a few smoking vents.
    for k in range(22):
        th = k * 0.31 + 0.2 * ((k * 3) % 5)
        rr = 128 + 28 * ((k * 5) % 7) / 6
        s = 5 + 9 * ((k * 11) % 9) / 8
        m.blob((math.cos(th) * rr, math.sin(th) * rr, 0), (s, s * 0.9, s * 0.7), 2, basalt(k), amp=0.25, seed=k, flat_base=-0.4)
    m.build(parent=root, ao_args=dict(reach=14.0, strength=0.7, rays=14, ground_reach=10.0), sharp=40)
    g.build(parent=root, ao=False, sharp=70)

    # The smoke: a column of dark puffs, lit orange from below, turning slowly about the crater's axis.
    sp = spinner(root, "volcano.smoke", "y", (0, 0, H), 0.05)
    s = Model("volcano.smoke", seed=43)
    for k in range(16):
        t = k / 15
        a = k * 2.0
        rr = 6 + 26 * t
        z = H + 22 + 100 * t ** 0.85
        size = 8 + 18 * t ** 0.8 + 3 * ((k * 5) % 3)
        base = mix(hexc("#4a3b3e"), hexc("#8d8590"), t)
        c = varied(lambda p, n, base=base, z0=z: mix(mix(base, hexc("#d2672d"), 0.5 * (1 - smoothstep(-0.2, 0.8, n.z)) * (1 - smoothstep(0, 1, (p.z - H) / 70))), tint(base, (1.08, 1.04, 1.1)), smoothstep(-0.1, 0.9, n.z) * 0.6), 0.06, 0.05, k)
        s.blob(V((math.cos(a) * rr, math.sin(a) * rr, z)), (size, size, size * 0.8), 3, c, amp=0.14, seed=k)
    s.build(parent=sp, ao=False, sharp=70)
    return root


def stone_bridge():
    root = empty("landmark.stone-bridge")
    half = 49.0                 # the track says 98 m
    deck_w = 8.6
    m = Model("bridge.body", seed=44)
    g = Model("bridge.lava", seed=45)
    stone = hexc("#4b4350")
    stone_l = hexc("#7c7184")
    stone_d = hexc("#2a232d")
    col = lambda p, n: mix(stone_d, stone_l, 0.25 + 0.5 * smoothstep(-14.0, 0.0, p.z) * 0.6 + 0.3 * smoothstep(0.3, 0.9, n.z))
    # The elevation, as one polygon: the deck underside along the top, the arches cut from below, extruded across the road.
    abut = 3.0
    pier = 4.2
    W = (2 * half - 2 * abut - 2 * pier) / 3.0
    deck_under = -1.7
    bottom = -14.5
    rise = 7.5
    # Walk along the bottom from the left end to the right end: abutment foot, then each arch's curve, each pier's foot.
    spans = []
    cur = -half + abut
    for a in range(3):
        spans.append((cur, cur + W))
        cur += W + pier
    pts_bottom = [(-half, bottom), (-half + abut, bottom)]
    for a, (l, r) in enumerate(spans):
        spring = -7.0
        poly_arch = []
        n = 14
        for q in range(n + 1):
            u = q / n
            th = math.pi * u
            x = l + (r - l) * (0.5 - 0.5 * math.cos(th))
            z = spring + (deck_under - 0.9 - spring) * math.sin(th) ** 0.9
            poly_arch.append((x, z))
        pts_bottom.append((l, bottom))
        pts_bottom.append((l, spring))
        pts_bottom.extend(poly_arch[1:-1])
        pts_bottom.append((r, spring))
        pts_bottom.append((r, bottom))
    pts_bottom.append((half - abut, bottom))
    pts_bottom.append((half, bottom))
    clean = [pts_bottom[0]]
    for q in pts_bottom[1:]:
        if abs(q[0] - clean[-1][0]) > 1e-6 or abs(q[1] - clean[-1][1]) > 1e-6:
            clean.append(q)
    outline = clean + [(half, deck_under), (-half, deck_under)]
    # Polygon in (y, z) with y along the road: the game's travel is +z = Blender -y, so negate to keep the model's front.
    outline = [(-x, z) for (x, z) in outline][::-1]   # CCW seen from +x
    body_col = varied(col, 0.1, 0.12, 4)
    m.prism_x(outline, -deck_w + 0.3, deck_w - 0.3, body_col)
    # The deck: a stone slab a little wider than the road, its top just under the road's surface, with a cornice.
    m.box((0, 0, deck_under / 2 - 0.04), (2 * deck_w, 2 * half, -deck_under - 0.08), (0, 0, 0), varied(grad_z(deck_under, 0, stone_d, stone), 0.08, 0.2), bevel=0.15)
    m.box((deck_w + 0.15, 0, deck_under + 0.5), (0.5, 2 * half + 0.6, 0.7), (0, 0, 0), stone_l, bevel=0.1)
    m.box((-deck_w - 0.15, 0, deck_under + 0.5), (0.5, 2 * half + 0.6, 0.7), (0, 0, 0), stone_l, bevel=0.1)
    # Parapet walls with capstones, and a lamp post at every pier.
    for sx in (-1, 1):
        x = sx * (deck_w + 0.1)
        m.box((x, 0, 0.45), (0.55, 2 * half, 1.0), (0, 0, 0), varied(grad_z(-0.1, 1.1, stone_d, stone), 0.1, 0.2), bevel=0.08)
        m.box((x, 0, 1.05), (0.85, 2 * half + 0.4, 0.22), (0, 0, 0), stone_l, bevel=0.06)
        for k in range(-7, 8):
            m.box((x, k * 6.5, 0.9), (0.85, 0.7, 1.55), (0, 0, 0), stone, bevel=0.08)
    for a in range(2):
        yc = -half + abut + W * (a + 1) + pier * a + pier / 2
        for sx in (-1, 1):
            post(m, sx * (deck_w + 0.1), -yc, 0.6, 4.2, 0.18, hexc("#2a232d"), 6)
            g.blob((sx * (deck_w + 0.1), -yc, 4.5), 0.5, 1, (1.0, 0.55, 0.15), mat="glow")
    # The lava far below the arches: a glowing sheet between the piers, brighter where it laps their feet.
    g.box((0, 0, -9.0), (66, 130, 0.2), (0, 0, 0), lambda p, n: mix(LAVA_DEEP, LAVA, 0.5 + 0.5 * n3(p.x * 0.12, p.y * 0.12, 0, 3)), mat="glow")
    m.build(parent=root, ao_args=dict(reach=8.0, strength=0.7, rays=14), sharp=40)
    g.build(parent=root, ao=False, sharp=60)
    return root


def lava_fall():
    root = empty("landmark.lava-fall")
    m = Model("lavafall.body", seed=46)
    g = Model("lavafall.lava", seed=47)
    H = 35.0
    prof = [(24, -2.0), (21, 3), (17, 9), (15.5, 16), (14, 24), (12.5, 31), (10.5, H - 1.5), (6.0, H), (0.0, H + 0.4)]
    sides = 36
    dense = []
    for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
        steps = max(1, int(math.ceil(abs(z1 - z0) / 2.5)))
        for q in range(steps):
            dense.append((r0 + (r1 - r0) * q / steps, z0 + (z1 - z0) * q / steps))
    dense.append(prof[-1])
    prof = dense

    def mod(j, k):
        th = j * TAU / sides
        z = prof[k][1]
        return (1 + 0.14 * n3(math.cos(th) * 2.0, math.sin(th) * 2.0, z * 0.07, 1) + 0.07 * n3(math.cos(th) * 5.0, math.sin(th) * 5.0, z * 0.15, 2)) * (1 - 0.05 * max(0.0, math.sin(th * 7 + z * 0.1)))
    cliff_col = varied(lambda p, n: mix(mix(hexc("#2a1d1f"), BASALT_M, smoothstep(0, 30, p.z)), hexc("#5a5062"), smoothstep(0.55, 0.95, n.z) * 0.8), 0.14, 0.18, 2)
    # An elongated cliff (wider than it is deep) like a lava tube's mouth, the face to the road.
    m.lathe(prof, sides, (0, 0, 0), cliff_col, mod=mod, squash=0.62, cap_end=True)
    # The falls: four ribbons of lava from the lip, draped down the face, thickening and cooling at the foot.
    falls = [(-9.0, 3.4), (-2.0, 2.4), (5.0, 3.8), (12.0, 2.2)]
    for i, (x0, w) in enumerate(falls):
        far = []
        steps = 24
        for q in range(steps + 1):
            u = q / steps
            z = (H - 1.0) - u * (H - 3.0)
            x = x0 + 0.9 * math.sin(u * 7 + i * 1.9) * (1 + u * 0.4)
            far.append(V((x, -200.0, z)))
        on = m.drape(far, lambda p: V((p.x * 0.35, 0.0, p.z)), lift=0.6)
        widths = lambda t, w=w: w * (0.55 + 0.45 * t + 0.25 * math.sin(math.pi * t))
        g.blade(on, V((1, 0, 0)), widths, 0.4, lambda p, n: lava_col(H, 0.0)(p), mat="glow", fold=0.0, tip_point=False)
    # The pool at the foot: a glowing basin ringed with black stone, spray rising off it.
    pool_c = V((2.0, -17.0, 0.0))
    g.lathe([(0.0, 0.15), (11.5, 0.2), (13.0, 0.5)], 28, pool_c, lambda p, n: mix(LAVA_HOT, LAVA_DEEP, smoothstep(0, 12, math.hypot(p.x - pool_c.x, p.y - pool_c.y)) * 0.9 + 0.1 * n3(p.x * 0.3, p.y * 0.3, 0, 5)), mat="glow", squash=0.72, cap_start=True)
    for k in range(14):
        a = k * 2.399
        rr = 4 + 9 * ((k * 7) % 5) / 4
        g.blob(pool_c + V((math.cos(a) * rr, math.sin(a) * rr * 0.7, 0.8 + 1.4 * ((k * 3) % 4) / 3)), 0.7 + 0.5 * (k % 3), 1, LAVA_HOT if k % 3 == 0 else LAVA, mat="glow")
    for k in range(16):
        a = k * 0.4
        rr = 14.2 + 2.0 * ((k * 5) % 3)
        s = 2.0 + 2.8 * ((k * 7) % 5) / 4
        m.blob(pool_c + V((math.cos(a) * rr, math.sin(a) * rr * 0.74, 0)), (s, s * 0.9, s * 0.8), 2, basalt(k + 3), amp=0.25, seed=k + 9, flat_base=-0.35)
    # Boulders at the cliff foot and a few tall black spires beside the falls.
    for sx, h in ((-17, 18.0), (-20, 12.0), (19, 15.0)):
        m.lathe([(2.6, -1.0), (2.2, 1.0), (1.6, h * 0.6), (0.0, h)], 6, (sx, -4.0, 0), basalt(sx), mod=lambda j, k: 1 + 0.12 * math.sin(j * 2.1), cap_start=True)
    m.build(parent=root, ao_args=dict(reach=6.0, strength=0.75, rays=14, ground_reach=5.0), sharp=40)
    g.build(parent=root, ao=False, sharp=70)
    return root


def landmarks():
    return [volcano(), stone_bridge(), lava_fall()]
