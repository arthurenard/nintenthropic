"""The canyon: scenery (saguaros and other cacti, desert shrubs, layered red rocks) and landmarks (mesa,
rock-arch, water-tower). Blender coordinates: z up, a landmark's front is -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, hexc, mix, mul, smooth_path, smoothstep, tint, varied, TAU

# The strata of the canyon walls, bottom to top: oxide red, burnt orange, cream, rust.
STRATA = [hexc("#8f2e1f"), hexc("#c9532e"), hexc("#f0a05a"), hexc("#f6d7a0"), hexc("#a63a24"), hexc("#dd6f36"), hexc("#f4cf94")]


def strata(z0, bands, height, seed=0, wobble=0.04, top_dust=0.0, dust=hexc("#e9cf9f")):
    """Layered rock colour: bands of sediment by height, a little wavy, sand blown on the top faces."""
    def f(p, n):
        w = wobble * noise.noise(V((p.x * 0.7 + seed * 5.0, p.y * 0.7 - seed * 3.0, 0.0))) * height
        t = ((p.z + w - z0) / height) * bands
        i = int(math.floor(t)) % len(STRATA)
        j = (i + 1) % len(STRATA)
        edge = smoothstep(0.8, 1.0, t - math.floor(t))
        c = mix(STRATA[i], STRATA[j], edge)
        # Shadowed low down, sunlit up the face.
        c = mul(c, 0.8 + 0.25 * smoothstep(0.0, height, p.z - z0))
        if top_dust:
            c = mix(c, dust, top_dust * smoothstep(0.55, 0.9, n.z))
        return c
    return f


CACTUS = [hexc("#2f7a52"), hexc("#4da36a")]


def cactus_col(h, seed=0):
    def f(p, n):
        t = smoothstep(0.0, h, p.z)
        base = mix(CACTUS[0], CACTUS[1], 0.25 + 0.6 * t)
        return mix(base, tint(base, (1.12, 1.05, 0.7)), smoothstep(0.2, 0.95, n.z) * 0.5)
    return varied(f, 0.06, 1.3, seed)


def arm_path(x0, z0, side, rise, reach, z1, y=0.0):
    """A cactus arm: out sideways from the trunk, an elbow, then up."""
    return [V((x0, y, z0)), V((x0 + side * reach * 0.55, y, z0 + 0.02)), V((x0 + side * reach, y, z0 + 0.3)), V((x0 + side * reach, y, z0 + rise * 0.5)), V((x0 + side * reach, y, z1))]


def saguaro(i):
    m = Model(f"scenery.cactus.{i}", seed=100 + i)
    h = [4.8, 4.2, 3.6][i % 3]
    col = cactus_col(h, i)
    r = 0.42
    ribs = lambda j, k: 1.0 if j % 2 == 0 else 0.82
    # The trunk: fluted, a rounded top.
    m.tube([V((0, 0, -0.05)), V((0, 0, h * 0.5)), V((0.03, 0, h * 0.95))], [r * 1.1, r, r * 0.86], 12, col=col, round_end=0.9, mod=ribs, rib=0.82)
    arms = [(1, 0.4, 1.7, 1.4, 0.8), (-1, 0.5, 1.5, 1.1, 0.7)] if i == 0 else [(1, 0.45, 1.6, 1.7, 0.7)] if i == 1 else [(-1, 0.38, 1.5, 1.0, 0.7), (1, 0.55, 1.3, 0.8, 0.7)]
    for side, z0f, reach, rise, ar in arms:
        z0 = h * z0f
        path = arm_path(0, z0, side, 1.0, reach, z0 + 0.35 + rise + 0.8)
        # A smooth bend through the elbow rather than three straight bars.
        smooth = smooth_path([path[0] + V((0, 0, 0)), path[1], path[2], path[3], path[4]], 5)
        m.tube(smooth, [0.26 * ar + 0.1] * len(smooth), 10, col=col, round_end=0.9, mod=lambda j, k: 1.0 if j % 2 == 0 else 0.8, rib=0.84)
    # Flowers on the crown: a ring of pink with a yellow heart.
    for k in range(5):
        a = k * TAU / 5
        m.blob((math.cos(a) * 0.22, math.sin(a) * 0.22, h + 0.2), (0.13, 0.13, 0.08), 0, hexc("#ff5e8a"))
    m.blob((0, 0, h + 0.24), 0.1, 0, hexc("#ffd34d"))
    return m.build(ao_args=dict(reach=1.5, strength=0.7, rays=16), sharp=60)


def barrel_cactus(i):
    m = Model(f"scenery.cactus.{i}", seed=110 + i)
    col = cactus_col(1.6, i)
    prof = [(0.0, 0.0), (0.55, 0.02), (0.95, 0.4), (1.02, 0.85), (0.8, 1.3), (0.4, 1.55), (0.12, 1.62), (0.0, 1.55)]
    m.lathe(prof, 16, (0, 0, 0), col, mod=lambda j, k: 1.0 if j % 2 == 0 else 0.84, cap_start=True)
    # A crown of golden flowers and spines in the ribs.
    for k in range(6):
        a = k * TAU / 6
        m.blob((math.cos(a) * 0.3, math.sin(a) * 0.3, 1.6), (0.17, 0.17, 0.1), 0, hexc("#ffcf33"))
    m.blob((0, 0, 1.65), (0.2, 0.2, 0.14), 0, hexc("#ff9d2e"))
    # A small pup beside it.
    m.lathe([(0.0, 0.0), (0.3, 0.02), (0.38, 0.28), (0.25, 0.5), (0.0, 0.54)], 10, (1.15, 0.2, 0.0), col, mod=lambda j, k: 1.0 if j % 2 == 0 else 0.84, cap_start=True)
    return m.build(ao_args=dict(reach=1.1, strength=0.7, rays=14), sharp=60)


def prickly_pear(i):
    m = Model(f"scenery.cactus.{i}", seed=120 + i)
    col = varied(lambda p, n: mix(hexc("#2e8a62"), hexc("#7ac98e"), smoothstep(0.0, 2.2, p.z) * 0.5 + 0.2 * n.z), 0.08, 1.4, i)
    pads = [(0, 0, 0.7, 0.95, 0.24, 0.8, 0.1), (0.5, 0.0, 1.55, 0.8, 0.22, 0.7, -0.5), (-0.55, 0.05, 1.5, 0.75, 0.22, 0.68, 0.55), (0.95, 0.0, 2.35, 0.62, 0.2, 0.55, -0.4), (-0.1, 0, 2.45, 0.6, 0.2, 0.55, 0.15), (-1.0, 0.0, 2.25, 0.55, 0.2, 0.5, 0.7)]
    for (x, y, z, rx, ry, rz, tilt) in pads:
        m.blob((x, y, z), (rx * 0.82, ry, rz), 1, col, rot=(0, tilt, 0), amp=0.04, seed=int(abs(x) * 7))
    # Red and yellow fruit on the rims.
    for k, (x, z, c) in enumerate([(0.9, 2.85, "#ff3d6a"), (-0.2, 2.9, "#ff6a3d"), (-1.05, 2.65, "#ff3d6a"), (0.5, 2.05, "#ffcf33"), (-0.6, 2.0, "#ff3d6a")]):
        m.blob((x, 0.1, z), (0.14, 0.14, 0.2), 0, hexc(c))
    return m.build(ao_args=dict(reach=1.2, strength=0.7, rays=14), sharp=70)


def shrub(i):
    m = Model(f"scenery.shrub.{i}", seed=130 + i)
    if i == 0:
        # Sagebrush: grey-green, tufted.
        c = varied(lambda p, n: mix(hexc("#5f7a55"), hexc("#b9c79a"), smoothstep(0.0, 1.0, p.z) * 0.8 + 0.2 * n.z), 0.1, 1.5, i)
        for k, (x, y, z, r) in enumerate([(0, 0, 0.4, 0.8), (0.7, 0.2, 0.3, 0.55), (-0.6, -0.2, 0.3, 0.55), (0.1, 0.65, 0.25, 0.45), (-0.2, -0.65, 0.25, 0.45)]):
            m.blob((x, y, z), (r * 1.05, r, r * 0.8), 2 if k == 0 else 1, c, amp=0.14, seed=k, flat_base=-0.35)
    elif i == 1:
        # Agave: a rosette of grey-blue spears.
        for k in range(12):
            a = k * TAU / 12 + 0.2
            lean = 0.5 + 0.5 * (k % 3) / 2
            cx, cy = math.cos(a), math.sin(a)
            spine = [V((cx * 0.05, cy * 0.05, 0.08)), V((cx * 0.35 * lean, cy * 0.35 * lean, 0.45 + 0.1 * (k % 2))), V((cx * 0.8 * lean, cy * 0.8 * lean, 0.75 + 0.1 * (k % 2))), V((cx * 1.15 * lean, cy * 1.15 * lean, 0.8 + 0.1 * (k % 2)))]
            col = lambda p, n, kk=k: mix(hexc("#3c6f73"), hexc("#97c4b0"), smoothstep(0.0, 0.9, p.z)) if kk % 2 else mix(hexc("#356a66"), hexc("#8dbfa6"), smoothstep(0.0, 0.9, p.z))
            m.blade(spine, V((-cy, cx, 0)), [0.05, 0.17, 0.2, 0.06], 0.05, col, fold=0.5)
        m.blob((0, 0, 0.15), (0.25, 0.25, 0.2), 1, hexc("#6fa68a"))
    elif i == 2:
        # A yellow-flowering desert bush.
        c = varied(lambda p, n: mix(hexc("#4f7a3a"), hexc("#a9c24e"), smoothstep(0.0, 1.0, p.z)), 0.1, 1.5, i)
        for k, (x, y, z, r) in enumerate([(0, 0, 0.38, 0.75), (0.6, 0.25, 0.3, 0.5), (-0.55, -0.2, 0.3, 0.5)]):
            m.blob((x, y, z), (r, r, r * 0.8), 2 if k == 0 else 1, c, amp=0.12, seed=k, flat_base=-0.35)
        for k in range(16):
            a = k * 2.399
            rr = 0.25 + 0.5 * ((k * 37) % 10) / 10
            m.blob((math.cos(a) * rr, math.sin(a) * rr, 0.62 + 0.28 * math.sin(k * 1.7)), 0.1, 0, hexc("#ffd23d") if k % 4 else hexc("#ffef8a"))
    else:
        # Dry grass: a fountain of golden blades.
        for k in range(18):
            a = k * 2.399
            lean = 0.35 + 0.55 * ((k * 53) % 10) / 10
            h = 0.55 + 0.4 * ((k * 31) % 10) / 10
            cx, cy = math.cos(a), math.sin(a)
            spine = [V((cx * 0.05, cy * 0.05, 0)), V((cx * 0.25 * lean, cy * 0.25 * lean, h * 0.55)), V((cx * 0.7 * lean, cy * 0.7 * lean, h * 0.85)), V((cx * 1.0 * lean, cy * 1.0 * lean, h * 0.7))]
            col = lambda p, n: mix(hexc("#a8832d"), hexc("#f0d27a"), smoothstep(0.0, 0.9, p.z))
            m.blade(spine, V((-cy, cx, 0)), [0.05, 0.06, 0.04, 0.02], 0.02, col, fold=0.2)
    return m.build(ao_args=dict(reach=0.9, strength=0.7, rays=12), sharp=70)


def layered_rock(i):
    m = Model(f"scenery.rock.{i}", seed=150 + i)
    if i == 0:
        # A stepped butte: four ledges, each a little narrower and a little crooked.
        col = strata(0.0, 5.0, 1.5, seed=1, top_dust=0.5)
        z = -0.1
        for k, (r, h, ox, oy) in enumerate([(1.45, 0.5, 0.0, 0.0), (1.2, 0.4, 0.1, 0.05), (0.95, 0.35, -0.05, 0.1), (0.7, 0.3, 0.05, 0.0)]):
            m.lathe([(r * 0.95, z), (r, z + h * 0.15), (r * 0.97, z + h * 0.85), (r * 0.82, z + h)], 11, (ox, oy, 0), col, mod=lambda j, kk, k=k: 1 + 0.12 * math.sin(j * 2.3 + k * 1.7) + 0.07 * math.sin(j * 5.1), cap_end=True, cap_start=(k == 0))
            z += h * 0.9
    elif i == 1:
        # A chunky boulder with banding and a smaller one leaning on it.
        col = strata(0.0, 5.0, 1.5, seed=2, top_dust=0.55)
        m.blob((0, 0, 0.55), (1.35, 1.0, 0.8), 2, col, amp=0.2, freq=1.1, seed=3, flat_base=-0.5, rot=(0.0, 0.08, 0.3))
        m.blob((1.15, 0.3, 0.3), (0.65, 0.6, 0.45), 2, col, amp=0.22, freq=1.5, seed=7, flat_base=-0.4)
    elif i == 2:
        # A tilted slab of rock with a splintered top: a classic canyon shard.
        col = strata(0.0, 6.0, 1.9, seed=3, top_dust=0.35)
        m.lathe([(1.0, -0.1), (1.05, 0.5), (0.8, 1.1), (0.5, 1.55), (0.2, 1.8), (0.0, 1.85)], 7, (0, 0, 0), col, mod=lambda j, k: 1 + 0.2 * math.sin(j * 2.7 + 1) + 0.1 * math.sin(j * 6.1), cap_start=True)
        m.blob((1.0, -0.4, 0.3), (0.7, 0.6, 0.45), 2, col, amp=0.25, freq=1.4, seed=11, flat_base=-0.4)
        m.blob((-0.9, 0.5, 0.22), (0.5, 0.45, 0.3), 1, col, amp=0.25, freq=1.4, seed=13, flat_base=-0.4)
    else:
        # A low rubble pile of three boulders with sand drifted in.
        col = strata(0.0, 4.0, 1.2, seed=4, top_dust=0.6)
        m.blob((0, 0, 0.45), (1.1, 0.9, 0.62), 2, col, amp=0.22, seed=5, flat_base=-0.5)
        m.blob((1.2, 0.2, 0.3), (0.7, 0.6, 0.42), 2, col, amp=0.22, seed=6, flat_base=-0.45)
        m.blob((-0.5, -0.9, 0.3), (0.65, 0.55, 0.4), 2, col, amp=0.22, seed=8, flat_base=-0.45)
        m.blob((0.3, 0.2, 0.0), (1.7, 1.4, 0.3), 1, hexc("#ecd2a2"), amp=0.1, seed=9, flat_base=-0.1)
    return m.build(ao_args=dict(reach=1.2, strength=0.8, rays=16), sharp=38)


def scenery():
    out = []
    out += saguaro(0) + saguaro(1) + saguaro(2)
    out += barrel_cactus(3) + prickly_pear(4)
    for i in range(4):
        out += shrub(i)
    for i in range(4):
        out += layered_rock(i)
    return out


def landmarks():
    import nature_canyon_lm

    return nature_canyon_lm.landmarks()
