"""The island: scenery (palm trees, tropical plants, beach rocks, coral) and landmarks (beach-hut, sandcastle,
giant-ring, wristwatch). Blender coordinates: z up, a landmark's front is -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, hexc, mix, mul, smooth_path, smoothstep, tint, varied, TAU

TRUNK_D = hexc("#6e4a2e")
TRUNK_L = hexc("#c59a68")
FROND_D = hexc("#0f6b3c")
FROND_L = hexc("#7fd957")


def trunk_colour(h):
    def f(p, n):
        t = smoothstep(0.0, h, p.z)
        base = mix(TRUNK_D, TRUNK_L, 0.35 + 0.5 * t)
        # Rings: the scars of old fronds, a dark band every third of a metre.
        band = 0.5 + 0.5 * math.sin(p.z * 19.0)
        return mul(base, 0.8 + 0.2 * smoothstep(0.2, 0.8, band))
    return varied(f, 0.07, 1.8)


def frond(m, base, az, length, droop, curl, size=1.0, shade=None):
    """One palm frond: a long arching blade with a feathery edge, out from `base` at azimuth `az`."""
    cx, cy = math.cos(az), math.sin(az)
    n = 9
    spine = []
    for k in range(n):
        t = k / (n - 1)
        out = length * t
        up = length * (0.62 * math.sin(t * math.pi * 0.55) - droop * t * t * t)
        spine.append(V((base[0] + cx * out, base[1] + cy * out, base[2] + up + 0.1 * math.sin(curl + t * 6) * t)))
    col = shade or (lambda p, nn: mix(FROND_D, FROND_L, smoothstep(base[2] - 0.3, base[2] + length * 0.45, p.z) * 0.35 + smoothstep(0.1, 1.0, math.hypot(p.x - base[0], p.y - base[1]) / length) * 0.55))
    w = lambda t: size * 0.9 * math.sin(math.pi * min(1.0, 0.12 + t * 0.95)) ** 0.8 * (1.0 - 0.25 * t)
    m.blade(spine, V((-cy, cx, 0)), w, 0.04, col, fold=0.5, serrate=0.34)


def palm(i):
    m = Model(f"scenery.palm.{i}", seed=400 + i)
    h = [9.4, 10.2, 7.0][i]
    lean = [(2.1, 0.5), (-1.2, -0.9), (1.4, -0.6)][i]
    pts = smooth_path([V((0, 0, 0)), V((lean[0] * 0.15, lean[1] * 0.15, h * 0.3)), V((lean[0] * 0.5, lean[1] * 0.5, h * 0.65)), V((lean[0], lean[1], h))], 5)
    m.tube(pts, lambda t: 0.5 * (1 - t) ** 0.9 + 0.2 + 0.4 * math.exp(-t * 14), 9, col=trunk_colour(h), cap_end=True, mod=lambda j, k: 1.0 + (0.05 if k % 2 else 0.0))
    top = pts[-1]
    fronds = 11 if i != 2 else 9
    for k in range(fronds):
        az = k * TAU / fronds + (0.3 if i == 1 else 0.0) + 0.15 * math.sin(k * 3.1)
        ln = 3.9 + 0.7 * math.sin(k * 2.3 + i) + (0 if i != 2 else -0.7)
        frond(m, top + V((0, 0, 0.1)), az, ln, 0.55 + 0.6 * (k % 3) / 2 + (0.3 if i == 2 else 0.0), k, 1.0)
    # The heart: young fronds standing up, and a cluster of coconuts under the crown.
    for k in range(3):
        az = k * 2.1
        frond(m, top, az, 1.8, -0.7, k, 0.55)
    for k in range(5):
        a = k * 1.25 + 0.4
        m.blob(top + V((math.cos(a) * 0.36, math.sin(a) * 0.36, -0.35 - 0.08 * (k % 2))), (0.3, 0.3, 0.34), 1, varied(lambda p, n: mix(hexc("#4a3217"), hexc("#8a6a2e"), smoothstep(-0.4, 0.8, n.z)), 0.1, 3.0, k))
    return m.build(ao_args=dict(reach=2.0, strength=0.7, rays=14), sharp=60)


def tropical_bush(i):
    m = Model(f"scenery.bush.{i}", seed=420 + i)
    if i == 0:
        # A fern: a fountain of arching, feathery fronds.
        for k in range(12):
            az = k * TAU / 12 + 0.2 * (k % 2)
            cx, cy = math.cos(az), math.sin(az)
            ln = 1.3 + 0.3 * (k % 3)
            spine = [V((cx * 0.1, cy * 0.1, 0.1)), V((cx * ln * 0.35, cy * ln * 0.35, 0.65)), V((cx * ln * 0.75, cy * ln * 0.75, 0.85)), V((cx * ln, cy * ln, 0.55))]
            col = lambda p, n: mix(hexc("#0f6b3c"), hexc("#8fe060"), smoothstep(0.0, 0.9, p.z) * 0.5 + smoothstep(0.0, 1.4, math.hypot(p.x, p.y)) * 0.4)
            m.blade(spine, V((-cy, cx, 0)), lambda t: 0.3 * math.sin(math.pi * min(1.0, 0.1 + t * 0.95)), 0.03, col, fold=0.5, serrate=0.2)
    elif i == 1:
        # A hibiscus: a round green bush spotted with big red blooms.
        c = varied(lambda p, n: mix(hexc("#0f6b3c"), hexc("#7fd957"), smoothstep(0.0, 1.2, p.z) * 0.7 + n.z * 0.2), 0.1, 1.4)
        for k, (x, y, z, r) in enumerate([(0, 0, 0.55, 0.9), (0.7, 0.25, 0.4, 0.6), (-0.65, -0.15, 0.4, 0.6), (0.1, -0.7, 0.35, 0.5)]):
            m.blob((x, y, z), (r, r, r * 0.8), 2 if k == 0 else 1, c, amp=0.1, seed=k, flat_base=-0.4)
        for k in range(6):
            a = k * 2.399
            rr = 0.35 + 0.35 * ((k * 7) % 5) / 4
            z = 0.8 + 0.25 * math.sin(k * 1.7)
            m.lathe([(0.0, 0.0), (0.2, 0.02), (0.3, 0.1), (0.2, 0.17), (0, 0.2)], 5, (math.cos(a) * rr, math.sin(a) * rr, z), hexc("#ff3b5c") if k % 3 else hexc("#ff9bb0"), phase=k)
            m.blob((math.cos(a) * rr, math.sin(a) * rr, z + 0.19), 0.06, 0, hexc("#ffd23d"))
    else:
        # A banana-leaf plant: big paddles standing from one clump.
        for k in range(7):
            az = k * TAU / 7
            cx, cy = math.cos(az), math.sin(az)
            ln = 1.5 + 0.3 * (k % 2)
            spine = [V((cx * 0.12, cy * 0.12, 0.05)), V((cx * ln * 0.3, cy * ln * 0.3, 0.7)), V((cx * ln * 0.65, cy * ln * 0.65, 1.15)), V((cx * ln, cy * ln, 1.1))]
            col = lambda p, n: mix(hexc("#0e7a3e"), hexc("#a6e060"), smoothstep(0.0, 1.2, p.z) * 0.6)
            m.blade(spine, V((-cy, cx, 0)), lambda t: 0.5 * math.sin(math.pi * min(1.0, 0.18 + t * 0.85)) ** 0.7, 0.035, col, fold=0.25)
    return m.build(ao_args=dict(reach=1.0, strength=0.6, rays=12), sharp=70)


def beach_rock(i):
    m = Model(f"scenery.rock.{i}", seed=440 + i)
    sand = hexc("#d8c9a8")
    grey = hexc("#9ea3a8")
    wet = hexc("#5e6872")
    base = [sand, grey, hexc("#c9b79a")][i]

    def col(p, n):
        # Dry and pale on top, dark and wet at the waterline, a little green weed low down.
        c = mix(wet, base, smoothstep(0.0, 0.8, p.z))
        return mix(c, hexc("#4f8a4a"), 0.25 * (1 - smoothstep(0.0, 0.3, p.z)))
    c = varied(col, 0.1, 1.3, i)
    if i == 0:
        m.blob((0, 0, 0.75), (1.35, 1.05, 0.95), 2, c, amp=0.14, seed=1, flat_base=-0.45)
        m.blob((1.1, 0.5, 0.35), (0.65, 0.55, 0.45), 2, c, amp=0.14, seed=2, flat_base=-0.4)
    elif i == 1:
        m.blob((0, 0, 0.6), (1.7, 1.0, 0.8), 2, c, amp=0.16, seed=3, flat_base=-0.45, rot=(0, 0, 0.4))
        m.blob((-1.2, -0.5, 0.35), (0.7, 0.6, 0.45), 2, c, amp=0.16, seed=4, flat_base=-0.4)
    else:
        m.blob((0, 0, 0.8), (1.0, 1.0, 1.1), 2, c, amp=0.14, seed=5, flat_base=-0.45)
        m.blob((0.9, -0.5, 0.4), (0.7, 0.6, 0.5), 2, c, amp=0.14, seed=6, flat_base=-0.4)
        m.blob((-0.8, 0.6, 0.3), (0.55, 0.5, 0.4), 1, c, amp=0.14, seed=7, flat_base=-0.4)
    return m.build(ao_args=dict(reach=1.3, strength=0.75, rays=14), sharp=50)


def coral(i):
    m = Model(f"scenery.coral.{i}", seed=460 + i)
    hues = [(hexc("#ff5d8f"), hexc("#ffb3c8")), (hexc("#ff8a2a"), hexc("#ffd29a")), (hexc("#9a5cff"), hexc("#d8bcff"))][i]
    deep, pale = hues
    c = varied(lambda p, n: mix(deep, pale, smoothstep(0.0, 1.8, p.z) * 0.7 + 0.2 * n.z), 0.07, 1.6, i)
    if i == 0:
        # Branching coral: fingers that fork, with rounded tips.
        rng = m.rng
        def branch(p, d, r, depth):
            end = p + d
            pts = smooth_path([p, p + d * 0.5 + V((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0)), end], 3)
            m.tube(pts, lambda t, r=r: r * (1 - 0.35 * t), 6, col=c, round_end=1.0)
            if depth > 0:
                for s in (-1, 1):
                    nd = V((d.x + s * 0.5 + rng.uniform(-0.15, 0.15), d.y + rng.uniform(-0.25, 0.25), d.z * 0.75)).normalized() * d.length * 0.8
                    branch(end - d * 0.1, nd, r * 0.72, depth - 1)
        for k in range(5):
            a = k * 1.3
            branch(V((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.0)), V((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.9)), 0.17, 1)
    elif i == 1:
        # Brain coral: a ribbed dome.
        m.lathe([(0.0, 0.0), (1.2, 0.0), (1.35, 0.25), (1.2, 0.8), (0.8, 1.15), (0.35, 1.3), (0.0, 1.33)], 20, (0, 0, 0), c, mod=lambda j, k: 1.0 + (0.05 if (j + k) % 2 else -0.03))
        m.blob((1.2, 0.5, 0.3), (0.5, 0.45, 0.4), 1, c, amp=0.1)
    else:
        # Table coral: a flat ruffled plate on a stalk, and a few small cones beside it.
        m.tube([V((0, 0, 0)), V((0.05, 0, 0.5)), V((0, 0, 0.95))], [0.3, 0.22, 0.18], 7, col=c)
        m.lathe([(0.0, 0.9), (0.9, 0.93), (1.5, 1.0), (1.35, 1.12), (0.0, 1.08)], 16, (0, 0, 0), c, mod=lambda j, k: 1.0 + 0.1 * math.sin(j * 3.0), cap_start=False)
        for k, (x, y, hh) in enumerate([(1.6, 0.4, 0.9), (-1.3, 0.6, 0.7), (0.8, -1.4, 0.6)]):
            m.lathe([(0.3, 0.0), (0.22, hh * 0.6), (0.0, hh)], 7, (x, y, 0), c, cap_start=True)
    return m.build(ao_args=dict(reach=1.0, strength=0.55, rays=12), sharp=60)


def scenery():
    out = []
    for i in range(3):
        out += palm(i)
    for i in range(3):
        out += tropical_bush(i)
    for i in range(3):
        out += beach_rock(i)
    for i in range(3):
        out += coral(i)
    return out


def landmarks():
    import nature_palm_lm

    return nature_palm_lm.landmarks()
