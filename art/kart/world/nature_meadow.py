"""The meadow: scenery (trees, conifers, bushes, flowers, rocks) and landmarks (windmill, barn,
hot-air balloon). Blender coordinates: z up, a landmark's front is -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, grad_z, hexc, lit_by_normal, mix, mul, smoothstep, tint, varied, TAU

BARK = hexc("#9a6638")
BARK_D = hexc("#4d2f1a")


def leaf_colour(shade, lit, z0, z1, seed=0, jitter=0.2, up=0.8):
    """Foliage as a painter lights it: every puff is bright on top and deep underneath, the sunlit side warm
    and yellow, the shaded side cool; the clumps wander in value and hue so no two leaves are alike."""
    def f(p, n):
        h = smoothstep(z0, z1, p.z)
        q = V((p.x * 1.7 + seed * 11.3, p.y * 1.7 - seed * 4.1, p.z * 1.7))
        wander = 0.2 * noise.noise(q) + 0.1 * noise.noise(q * 2.7)
        s = smoothstep(-0.35, 0.95, n.z * up + n.x * 0.15 - n.y * 0.1) * 0.78 + h * 0.22 + wander
        warm = tint(lit, (1.1, 1.04, 0.72))
        return mix(shade, mix(lit, warm, smoothstep(0.55, 1.1, s)), smoothstep(-0.1, 1.0, s))
    return f


def trunk(m, base, top, r0, r1, bend=(0.0, 0.0), col=None, sides=8, flare=0.35):
    """A trunk with a flared foot, leaning a little."""
    pts = []
    n = 8
    for k in range(n):
        t = k / (n - 1)
        pts.append(V((base[0] + bend[0] * t * t, base[1] + bend[1] * t * t, base[2] + (top - base[2]) * t)))

    def radius(t):
        return r0 * (1 - t) ** 0.7 + r1 * t + flare * r0 * math.exp(-t * 11)
    col = col or (lambda p, n: mix(BARK_D, BARK, smoothstep(0.1, 2.4, p.z)))
    m.tube(pts, radius, sides=sides, col=varied(col, 0.08, 2.2), cap_end=True, cap_start=False)
    return pts


# ─── scenery ─────────────────────────────────────────────────────────────────

FOLIAGE = [
    (hexc("#14703a"), hexc("#7fe04a")),   # the classic
    (hexc("#0f6a48"), hexc("#5fd07a")),   # cooler, bluer
    (hexc("#1f8030"), hexc("#bfe84a")),   # sunny, yellow-green
    (hexc("#17703c"), hexc("#8be26a")),
]


def puffs(m, col, spec, sub=1):
    """A crown of overlapping leaf puffs: (x, y, z, rx, ry, rz) each."""
    for k, (x, y, z, rx, ry, rz) in enumerate(spec):
        m.blob((x, y, z), (rx, ry, rz), 2 if k == 0 else sub, col, amp=0.09, freq=1.3, seed=k + 1)


def round_tree(i):
    m = Model(f"scenery.tree.{i}", seed=10 + i)
    shade, lit = FOLIAGE[i % 4]
    c = leaf_colour(shade, lit, 1.6, 5.4, seed=i)
    if i == 0:
        # A broad, lumpy oak: a trunk that forks into the crown, a crown of seven puffs.
        trunk(m, (0, 0, 0), 2.7, 0.44, 0.27, bend=(0.15, 0.05))
        m.tube([V((0.1, 0, 2.0)), V((0.7, 0.1, 2.9)), V((1.25, 0.1, 3.4))], [0.19, 0.14, 0.1], 5, col=BARK_D, cap_end=True)
        m.tube([V((0.1, 0, 2.2)), V((-0.7, -0.2, 3.0)), V((-1.15, -0.2, 3.5))], [0.19, 0.13, 0.09], 5, col=BARK_D, cap_end=True)
        puffs(m, c, [(0.1, 0, 3.55, 1.85, 1.75, 1.5), (1.35, 0.15, 3.0, 1.1, 1.05, 0.95), (-1.3, -0.25, 3.15, 1.15, 1.05, 0.95), (0.2, 0.7, 4.55, 1.2, 1.15, 0.9), (-0.45, -0.7, 4.3, 1.0, 0.95, 0.85), (0.95, -0.8, 3.9, 0.95, 0.9, 0.8), (-0.85, 0.85, 3.85, 0.95, 0.9, 0.8)])
    elif i == 1:
        # A tall tree with a rounder, fuller crown.
        trunk(m, (0, 0, 0), 3.0, 0.37, 0.22, bend=(-0.2, 0.1))
        puffs(m, c, [(-0.1, 0, 3.9, 1.8, 1.8, 1.65), (1.15, 0.1, 3.4, 1.05, 1.0, 0.95), (-1.15, -0.2, 3.35, 1.05, 1.0, 0.95), (0.1, 0.1, 5.0, 1.1, 1.05, 0.75), (0.2, -1.05, 3.9, 0.9, 0.85, 0.8), (-0.3, 1.0, 3.8, 0.9, 0.85, 0.8)])
    elif i == 2:
        # An apple tree: a sunnier, squatter crown with red apples dotted over it.
        trunk(m, (0, 0, 0), 2.1, 0.46, 0.3, bend=(0.1, -0.1))
        m.tube([V((0, 0, 1.4)), V((0.8, 0.1, 2.3)), V((1.5, 0.1, 2.7))], [0.2, 0.14, 0.1], 5, col=BARK_D, cap_end=True)
        puffs(m, c, [(0, 0, 3.1, 2.1, 1.95, 1.45), (1.5, 0.3, 2.8, 1.05, 1.0, 0.85), (-1.45, -0.2, 2.85, 1.1, 1.0, 0.85), (0.2, 0.8, 3.95, 1.25, 1.2, 0.85), (-0.5, -0.8, 3.8, 1.1, 1.0, 0.8), (0.4, -1.1, 3.0, 0.9, 0.85, 0.7)])
        for k in range(12):
            a = k * 2.399 + 0.4
            rr = 1.55 + 0.5 * math.sin(k * 1.3)
            z = 2.7 + 0.9 * math.sin(k * 1.9)
            m.blob((math.cos(a) * rr, math.sin(a) * rr * 0.92, z), 0.15, 0, hexc("#ff3b30") if k % 3 else hexc("#ff7a30"))
    elif i == 3:
        # A tall slender poplar: three stacked puffs up a long trunk, narrow against the sky.
        trunk(m, (0, 0, 0), 2.0, 0.3, 0.2, bend=(0.1, 0.0))
        c2 = leaf_colour(shade, lit, 1.5, 6.4, seed=i)
        puffs(m, c2, [(0, 0, 3.6, 1.15, 1.15, 1.7), (0.1, 0.1, 5.2, 0.95, 0.95, 1.5), (-0.05, 0, 6.5, 0.6, 0.6, 1.1), (0.55, -0.4, 2.7, 0.8, 0.8, 0.8), (-0.5, 0.4, 3.0, 0.8, 0.8, 0.9)])
    else:
        # A blossom tree: pale pink clouds over a dark, twisting trunk.
        trunk(m, (0, 0, 0), 2.3, 0.4, 0.25, bend=(0.3, 0.2), col=lambda p, n: mix(hexc("#3d2a22"), hexc("#7b5744"), smoothstep(0.1, 2.4, p.z)))
        m.tube([V((0.2, 0.1, 1.9)), V((1.0, 0.2, 2.8)), V((1.5, 0.1, 3.5))], [0.17, 0.12, 0.08], 5, col=hexc("#3d2a22"), cap_end=True)
        m.tube([V((0.2, 0.1, 2.1)), V((-0.7, -0.2, 3.1)), V((-1.2, -0.3, 3.6))], [0.17, 0.12, 0.08], 5, col=hexc("#3d2a22"), cap_end=True)
        blossom = leaf_colour(hexc("#e07aa6"), hexc("#ffe3ee"), 1.6, 5.4, seed=i, up=0.7)
        puffs(m, blossom, [(0.2, 0.1, 3.7, 1.9, 1.8, 1.4), (1.5, 0.1, 3.2, 1.05, 1.0, 0.9), (-1.3, -0.3, 3.4, 1.1, 1.0, 0.9), (0.3, 0.7, 4.6, 1.2, 1.1, 0.85), (-0.5, -0.8, 4.3, 1.0, 0.95, 0.8), (0.9, -0.9, 4.0, 0.9, 0.85, 0.75)])
    return m.build(ao_args=dict(reach=2.8, strength=0.8, rays=18), sharp=85)


def pine(i):
    m = Model(f"scenery.pine.{i}", seed=30 + i)
    shade, lit = [(hexc("#0f5a38"), hexc("#58c260")), (hexc("#136a46"), hexc("#7bd46e"))][i % 2]
    tall = i % 2 == 1
    h = 6.3
    trunk(m, (0, 0, 0), 1.7, 0.3, 0.2, sides=7, flare=0.3)
    tiers = 6 if not tall else 7
    for k in range(tiers):
        t = k / (tiers - 1)
        z0 = 1.0 + t * (h - 2.4)
        rad = (1.95 - 1.55 * t) * (0.8 if tall else 1.0) + 0.1
        height = 1.4 - 0.35 * t
        sides = 14 if k < 3 else 10
        scallop = lambda j, kk: 1.0 if j % 2 == 0 else 0.7
        col = leaf_colour(shade, lit, z0 - 0.2, z0 + height, seed=k + i * 3, jitter=0.1, up=1.0)
        m.lathe([(0.0, z0 - 0.4), (rad, z0 - 0.12), (rad * 0.8, z0 + height * 0.3), (rad * 0.42, z0 + height * 0.7), (0, z0 + height)], sides, (0, 0, 0), col, phase=k * 0.35, mod=scallop)
    return m.build(ao_args=dict(reach=2.2, strength=0.8, rays=16), sharp=60)


def bush(i):
    m = Model(f"scenery.bush.{i}", seed=50 + i)
    shade, lit = [(hexc("#157a38"), hexc("#86e04e")), (hexc("#1f8a3a"), hexc("#b8e856")), (hexc("#0f6e46"), hexc("#62cf80"))][i % 3]
    c = leaf_colour(shade, lit, 0.0, 1.3, seed=i, jitter=0.2)
    for k, (x, y, z, rx, ry, rz) in enumerate([(0, 0, 0.55, 0.95, 0.9, 0.72), (0.8, 0.15, 0.4, 0.62, 0.6, 0.5), (-0.6, -0.3, 0.4, 0.62, 0.58, 0.5), (0.1, 0.62, 0.38, 0.55, 0.5, 0.42), (-0.15, -0.7, 0.34, 0.5, 0.45, 0.4)]):
        m.blob((x, y, z), (rx, ry, rz), 2 if k == 0 else 1, c, amp=0.09, seed=k + 2, flat_base=-0.5)
    if i == 1:
        for k in range(8):
            a = k * 2.4
            p = V((math.cos(a) * 0.66, math.sin(a) * 0.6, 0.66 + 0.34 * math.sin(k * 1.9)))
            m.blob(p, 0.11, 0, hexc("#ff3d5e"))
    if i == 2:
        for k in range(7):
            a = k * 2.1 + 0.5
            p = V((math.cos(a) * 0.6, math.sin(a) * 0.55, 0.74 + 0.26 * math.sin(k * 2.3)))
            m.blob(p, 0.13, 0, hexc("#fff0a0"))
    return m.build(ao_args=dict(reach=1.3, strength=0.75, rays=16), sharp=85)


def rock(i):
    m = Model(f"scenery.rock.{i}", seed=70 + i)
    stone = [hexc("#a2a6ac"), hexc("#b0aca2"), hexc("#939aa3")][i % 3]
    moss = hexc("#5a9c36")

    def col(p, n):
        base = mix(mul(stone, 0.6), mix(stone, (1, 1, 1), 0.16), smoothstep(0.1, 1.1, p.z))
        top = smoothstep(0.5, 0.9, n.z)
        return mix(base, mix(moss, hexc("#98d04a"), smoothstep(0.2, 0.9, n.z)), top * (0.3 + 0.55 * (i % 2)))
    c = varied(col, 0.1, 1.2, i)
    m.blob((0, 0, 0.5), (1.2, 0.95, 0.75), 2, c, amp=0.3, freq=1.1, seed=i, flat_base=-0.45)
    m.blob((0.85, 0.35, 0.28), (0.62, 0.55, 0.42), 2, c, amp=0.3, freq=1.5, seed=i + 5, flat_base=-0.4)
    if i != 1:
        m.blob((-0.7, -0.5, 0.2), (0.45, 0.4, 0.3), 1, c, amp=0.3, freq=1.5, seed=i + 9, flat_base=-0.3)
    return m.build(ao_args=dict(reach=1.0, strength=0.85, rays=16), sharp=40)


def flower(i):
    """A clump in one colour: five blooms on stems over a tuft of leaves."""
    m = Model(f"scenery.flower.{i}", seed=90 + i)
    petals = [hexc("#ff4f81"), hexc("#ffd23d"), hexc("#fbfbff"), hexc("#b86bff"), hexc("#ff8a2a"), hexc("#ff5252")][i % 6]
    centre = hexc("#ffcf2e") if i % 6 != 1 else hexc("#c1651f")
    green = grad_z(0, 0.45, hexc("#2b7a2e"), hexc("#7ad24b"))
    for k in range(5):
        a = k * 1.3 + 0.2
        r = 0.2 + 0.05 * (k % 3)
        m.cone((math.cos(a) * r, math.sin(a) * r, 0), 0.08, 0.3 + 0.04 * (k % 3), 4, green, cap=False)
    spots = [(0.0, 0.0, 0.42), (0.27, 0.16, 0.34), (-0.25, 0.12, 0.30), (0.08, -0.26, 0.26), (-0.12, 0.28, 0.36)]
    for (x, y, h) in spots:
        m.tube([V((x * 0.7, y * 0.7, 0)), V((x, y, h * 0.55)), V((x, y, h))], [0.022, 0.018, 0.016], 4, col=hexc("#3f9a3a"), cap_end=False)
        petal = varied(grad_z(h - 0.02, h + 0.09, mul(petals, 0.78), petals), 0.04)
        m.lathe([(0.0, h + 0.0), (0.17, h + 0.035), (0.0, h + 0.09)], 10, (x, y, 0), petal, mod=lambda j, kk: 1.0 if j % 2 == 0 else 0.62, phase=x * 9)
        m.blob((x, y, h + 0.075), (0.055, 0.055, 0.04), 0, centre)
    return m.build(ao_args=dict(reach=0.6, strength=0.6, rays=12, ground_reach=1.0))


def scenery():
    out = []
    for i in range(5):
        out += round_tree(i)
    for i in range(2):
        out += pine(i)
    for i in range(3):
        out += bush(i)
    for i in range(3):
        out += rock(i)
    for i in range(6):
        out += flower(i)
    return out


def landmarks():
    import nature_meadow_lm

    return nature_meadow_lm.landmarks()
