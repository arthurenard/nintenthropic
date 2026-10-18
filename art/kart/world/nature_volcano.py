"""The volcano: scenery (black basalt, glowing-crack boulders, columns, dead trees) and landmarks (volcano,
stone-bridge, lava-fall). Blender coordinates: z up, a landmark's front is -y."""

import math

from mathutils import Vector as V

from naturekit import Model, hexc, mix, smooth_path, smoothstep, tint, varied, TAU

BASALT_D = hexc("#1b171f")
BASALT_M = hexc("#2d2733")
BASALT_L = hexc("#5a5066")
LAVA_HOT = (0.85, 0.5, 0.12)   # glow colours: the game multiplies a glowing material by at least 1.6, so these stay under 1
LAVA = (0.78, 0.26, 0.04)
LAVA_DEEP = (0.62, 0.13, 0.025)


def basalt(seed=0, warm=0.35, top=BASALT_L):
    """Black rock, cold and glossy where it faces the sky, warmed at the foot by the lava it stands in."""
    def f(p, n):
        lit = mix(BASALT_D, top, smoothstep(0.0, 0.95, n.z * 0.7 + p.z * 0.12 + 0.2))
        under = mix(lit, tint(mix(BASALT_D, hexc("#7a2a12"), 0.6), (1, 1, 1)), warm * (1 - smoothstep(0.0, 0.9, p.z)))
        return under
    return varied(f, 0.12, 1.6, seed)


def volcano_rock(i):
    m = Model(f"scenery.rock.{i}", seed=300 + i)
    col = basalt(i)
    if i == 0:
        m.blob((0, 0, 0.8), (1.55, 1.3, 1.0), 2, col, amp=0.28, freq=1.2, seed=1, flat_base=-0.5)
        m.blob((1.3, 0.4, 0.4), (0.8, 0.7, 0.55), 2, col, amp=0.3, freq=1.5, seed=2, flat_base=-0.4)
    elif i == 1:
        m.blob((0, 0, 0.9), (1.1, 1.0, 1.15), 2, col, amp=0.3, freq=1.3, seed=3, flat_base=-0.45, rot=(0, 0.15, 0.6))
        m.blob((-1.1, -0.3, 0.5), (0.9, 0.75, 0.6), 2, col, amp=0.3, freq=1.5, seed=4, flat_base=-0.4)
        m.blob((0.7, 0.9, 0.3), (0.55, 0.5, 0.4), 1, col, amp=0.3, freq=1.6, seed=5, flat_base=-0.35)
    else:
        # A slab-sided chunk, the kind a lava flow breaks off as it cools.
        m.box((0, 0, 0.7), (2.2, 1.6, 1.3), (0.08, 0.1, 0.5), col, bevel=0.3, bevel_segs=2)
        m.box((1.2, 0.6, 0.35), (1.1, 0.9, 0.7), (0.0, -0.1, -0.3), col, bevel=0.2, bevel_segs=2)
    return m.build(ao_args=dict(reach=1.3, strength=0.8, rays=16), sharp=35)


def basalt_spire(i):
    m = Model(f"scenery.spire.{i}", seed=320 + i)
    cols = [(1.4, 0.0, 0.0, 6.2, 0.4), (-0.6, 1.1, 0.0, 4.4, 0.3), (1.1, -1.2, 0.0, 3.2, 0.25), (-1.2, -0.6, 0.0, 2.2, 0.22)] if i == 0 else [(0.0, 0.0, 0.0, 7.6, 0.45), (1.3, 0.7, 0.0, 5.0, 0.35), (-1.2, 0.5, 0.0, 3.8, 0.3), (0.4, -1.3, 0.0, 2.6, 0.26), (-0.4, 1.4, 0.0, 1.8, 0.2)]
    for k, (x, y, z, h, r) in enumerate(cols):
        col = basalt(k + i * 7, warm=0.25)
        r *= 1.45
        # A hexagonal column, a little crooked, with a broken, tilted top.
        tilt = 0.06 * math.sin(k * 2.1 + i)
        m.lathe([(r * 1.12, -0.5), (r, 0.0), (r * 0.98, h * 0.5), (r * 0.9, h - 0.25), (r * 0.8, h)], 6, (x, y, 0), col, phase=k * 0.5, cap_end=True, cap_start=True, rot=(tilt, -tilt, 0))
    return m.build(ao_args=dict(reach=1.8, strength=0.8, rays=16), sharp=35)


def dead_tree(i):
    m = Model(f"scenery.deadtree.{i}", seed=340 + i)
    char = hexc("#17121a")
    char2 = hexc("#3b3040")

    def col(p, n):
        # Charred black, grey ash on the sunward side, a dull red where the fire is still inside.
        base = mix(char, char2, smoothstep(0.0, 0.9, n.z * 0.6 + n.x * 0.2 + 0.3))
        return mix(base, hexc("#5a2210"), 0.35 * (1 - smoothstep(0.0, 1.6, p.z)))
    c = varied(col, 0.14, 1.6, i)
    h = [7.4, 6.0, 7.8][i]
    lean = [0.5, -0.7, 0.2][i]
    trunk = smooth_path([V((0, 0, 0)), V((lean * 0.2, 0.1, h * 0.3)), V((lean * 0.6, -0.1, h * 0.65)), V((lean, 0.1, h))], 4)
    m.tube(trunk, lambda t: 0.62 * (1 - t) ** 0.9 + 0.1 + 0.4 * math.exp(-t * 9), 7, col=c, cap_end=False, round_end=1.2, mod=lambda j, k: 1.0 if j % 2 else 0.8)
    branches = [(0.35, 1.0, 0.2, 1.6, 1.7, 0.16), (0.5, -1.1, -0.3, 1.8, 2.0, 0.15), (0.62, 0.7, 0.8, 1.2, 2.2, 0.12), (0.76, -0.8, 0.5, 1.0, 1.7, 0.1), (0.88, 0.4, -0.5, 0.7, 1.3, 0.08)]
    if i == 1:
        branches = [(0.4, 1.2, 0.0, 2.0, 1.2, 0.2), (0.55, -1.0, 0.4, 1.8, 1.9, 0.16), (0.8, 0.5, -0.4, 1.0, 1.4, 0.1)]
    for (t, dx, dy, dz_out, dz_up, r) in branches:
        k = min(len(trunk) - 1, int(t * (len(trunk) - 1)))
        b0 = trunk[k]
        mid = b0 + V((dx * 0.5, dy * 0.5, dz_out * 0.35))
        end = b0 + V((dx, dy, dz_out + dz_up * 0.4))
        pts = smooth_path([b0 - V((0, 0, 0.05)), mid, end], 4)
        m.tube(pts, lambda u, r=r: r * (1 - u) + 0.03, 5, col=c, round_end=1.5)
        # A forked twig at the end.
        for s in (-1, 1):
            twig = [end, end + V((dx * 0.25 + s * 0.3, dy * 0.25, 0.4)), end + V((dx * 0.4 + s * 0.6, dy * 0.4 - s * 0.2, 0.9))]
            m.tube(smooth_path(twig, 3), lambda u, r=r: r * 0.4 * (1 - u) + 0.02, 4, col=c, round_end=1.5)
    # Embers still alive in the char: a few glowing seams and sparks.
    for k, (z, a) in enumerate([(0.9, 0.4), (1.9, 2.3), (3.1, 4.4), (4.2, 1.2)]):
        pt = trunk[min(len(trunk) - 1, int(z / h * (len(trunk) - 1)))]
        r = 0.36
        m.blob(pt + V((math.cos(a) * r, math.sin(a) * r, 0)), (0.08, 0.08, 0.28), 0, LAVA, mat="glow", rot=(0, 0, a))
    return m.build(ao_args=dict(reach=1.6, strength=0.7, rays=14), sharp=60)


def ember_rock(i):
    m = Model(f"scenery.ember.{i}", seed=360 + i)
    col = basalt(i + 3, warm=0.55)
    if i == 0:
        m.blob((0, 0, 0.75), (1.35, 1.15, 1.0), 2, col, amp=0.26, freq=1.1, seed=1, flat_base=-0.5)
        m.blob((1.1, 0.6, 0.35), (0.7, 0.6, 0.5), 2, col, amp=0.26, freq=1.5, seed=2, flat_base=-0.4)
    elif i == 1:
        m.blob((0, 0, 0.9), (1.2, 1.1, 1.2), 2, col, amp=0.26, freq=1.2, seed=5, flat_base=-0.5, rot=(0, 0.1, 0.5))
        m.blob((-1.0, 0.3, 0.45), (0.85, 0.75, 0.55), 2, col, amp=0.3, freq=1.4, seed=6, flat_base=-0.4)
    else:
        m.blob((0, 0, 0.7), (1.6, 1.2, 0.95), 2, col, amp=0.24, freq=1.1, seed=8, flat_base=-0.5, rot=(0, 0, 0.7))
    # Cracks: jagged seams of glowing rock lying on the surface, from the crown down the flanks.
    rng = m.rng
    for c in range(4 + i % 2):
        a = rng.uniform(0, TAU)
        el = rng.uniform(0.9, 1.35)
        pts = []
        for s in range(8):
            a += rng.uniform(-0.35, 0.35)
            el -= rng.uniform(0.1, 0.22)
            if el < 0.15:
                break
            pts.append(V((math.cos(a) * math.cos(el) * 4, math.sin(a) * math.cos(el) * 4, 0.6 + math.sin(el) * 4)))
        if len(pts) < 3:
            continue
        on = m.drape(pts, V((0, 0, 0.65)), lift=0.025)
        seam = smooth_path(on, 2)
        width = rng.uniform(0.045, 0.075)
        m.tube(seam, lambda t, w=width: w * (0.45 + 0.9 * math.sin(math.pi * min(1.0, t * 0.95 + 0.04))), 4, col=LAVA, mat="glow", cap_end=True)
    return m.build(ao_args=dict(reach=1.3, strength=0.8, rays=16), sharp=35)


def scenery():
    out = []
    for i in range(3):
        out += volcano_rock(i)
    for i in range(2):
        out += basalt_spire(i)
    for i in range(3):
        out += dead_tree(i)
    for i in range(3):
        out += ember_rock(i)
    return out


def landmarks():
    import nature_volcano_lm

    return nature_volcano_lm.landmarks()
