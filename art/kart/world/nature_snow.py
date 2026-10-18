"""The glacier: scenery (snowy pines, snow-capped rocks, ice chunks) and landmarks (cabin, igloo, ice-arch,
snowman, gondola). Blender coordinates: z up, a landmark's front is -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, hexc, mix, smoothstep, varied

SNOW = hexc("#f6faff")
SNOW_SHADE = hexc("#b4c9ea")
PINE_DARK = hexc("#0e4636")
PINE_MID = hexc("#1d6a4c")


def snow_on(base_shade, base_lit, snow=SNOW, shade=SNOW_SHADE, cover=0.4, seed=0):
    """Snow settles on what faces up: the colour of the thing underneath, the snow's white on every upward face
    (blue in its own shade), more of it the flatter the face."""
    def f(p, n):
        q = V((p.x * 1.3 + seed * 3.1, p.y * 1.3, p.z * 1.3))
        k = smoothstep(cover - 0.15, cover + 0.2, n.z + 0.12 * noise.noise(q))
        under = mix(base_shade, base_lit, smoothstep(0.0, 1.0, p.z * 0.3 + n.z * 0.4 + 0.5))
        top = mix(shade, snow, smoothstep(-0.2, 0.9, n.z))
        return mix(under, top, k)
    return f


def snow_pine(i):
    m = Model(f"scenery.pine.{i}", seed=200 + i)
    h = [8.0, 7.2, 5.8][i]
    spread = [1.0, 1.25, 1.0][i]
    tiers = [7, 6, 5][i]
    trunk = hexc("#5a3b28")
    m.tube([V((0, 0, 0)), V((0, 0, 1.4)), V((0, 0, 2.0))], [0.36, 0.26, 0.2], 7, col=varied(lambda p, n: mix(hexc("#2f1d12"), trunk, smoothstep(0, 2, p.z)), 0.1, 1.6), cap_end=True)
    for k in range(tiers):
        t = k / (tiers - 1)
        z0 = 1.0 + t * (h - 2.8)
        rad = ((2.5 - 2.0 * t) * spread) + 0.12
        height = 1.6 - 0.45 * t
        sides = 12 if k < 3 else 9
        col = snow_on(PINE_DARK, PINE_MID, cover=0.35, seed=k + i * 9)
        m.lathe([(0.0, z0 - 0.45), (rad, z0 - 0.15), (rad * 0.8, z0 + height * 0.3), (rad * 0.38, z0 + height * 0.72), (0, z0 + height)], sides, (0, 0, 0), col, phase=k * 0.4, mod=lambda j, kk: 1.0 if j % 2 == 0 else 0.72)
        # Clumps of snow slumped on the lower boughs.
        if k < tiers - 1:
            for q in range(2):
                a = (q * 3.1 + k * 0.9)
                r = rad * 0.82
                m.blob((math.cos(a) * r, math.sin(a) * r, z0 - 0.05), (0.42, 0.4, 0.24), 0, SNOW, amp=0.1, seed=k * 3 + q)
    # The crowning tuft of snow.
    m.blob((0, 0, h - 0.5), (0.4, 0.4, 0.5), 0, SNOW)
    return m.build(ao_args=dict(reach=2.4, strength=0.7, rays=16), sharp=60)


def snow_rock(i):
    m = Model(f"scenery.rock.{i}", seed=220 + i)
    rock_lit = hexc("#7b869a")
    rock_dark = hexc("#3c4658")
    col = snow_on(rock_dark, rock_lit, cover=0.5, seed=i)
    if i == 0:
        m.blob((0, 0, 0.85), (1.6, 1.3, 1.1), 2, col, amp=0.22, freq=1.0, seed=1, flat_base=-0.5)
        m.blob((1.2, 0.5, 0.5), (0.8, 0.7, 0.6), 2, col, amp=0.22, freq=1.4, seed=2, flat_base=-0.4)
    elif i == 1:
        m.blob((0, 0, 0.9), (1.2, 1.1, 1.3), 2, col, amp=0.25, freq=1.2, seed=3, flat_base=-0.45, rot=(0, 0.1, 0.4))
        m.blob((-1.0, -0.4, 0.45), (0.8, 0.7, 0.55), 2, col, amp=0.25, freq=1.4, seed=4, flat_base=-0.4)
        m.blob((0.9, 0.8, 0.35), (0.6, 0.5, 0.4), 1, col, amp=0.25, freq=1.4, seed=5, flat_base=-0.4)
    else:
        m.blob((0, 0, 0.7), (1.7, 1.2, 0.95), 2, col, amp=0.2, freq=1.0, seed=6, flat_base=-0.5, rot=(0, 0, 0.5))
        m.blob((0.3, 0.2, 1.2), (1.1, 0.8, 0.5), 1, col, amp=0.2, freq=1.3, seed=7)
    # A drift banked against the foot, the snow's own soft shoulder.
    m.blob((0, 0, 0.0), (2.2, 1.7, 0.4), 1, SNOW, amp=0.1, seed=8, flat_base=-0.1)
    return m.build(ao_args=dict(reach=1.4, strength=0.7, rays=16), sharp=45)


def ice(i):
    m = Model(f"scenery.ice.{i}", seed=240 + i)
    deep = hexc("#3b9fe0")
    pale = hexc("#cdf3ff")

    def col(p, n):
        return mix(mix(deep, hexc("#6cc8f4"), smoothstep(0.0, 1.5, p.z)), pale, smoothstep(0.3, 1.0, n.z) * 0.5 + smoothstep(1.0, 3.2, p.z) * 0.5)
    c = varied(col, 0.05, 1.2, i)
    tipc = (0.55, 0.95, 1.0)
    if i == 0:
        # A fan of crystals leaning out of a common root.
        for k in range(7):
            a = k * 2.1 + 0.3
            tilt = 0.12 + 0.28 * ((k * 5) % 3) / 2
            h = 1.5 + 1.9 * ((k * 7) % 5) / 4
            r = 0.26 + 0.1 * (k % 3)
            body = 6
            m.lathe([(r, 0), (r * 1.04, h * 0.78), (r * 0.5, h * 0.93), (0.0, h)], body, (math.cos(a) * 0.5, math.sin(a) * 0.5, -0.05), c, phase=a, cap_start=True, rot=(tilt * math.sin(a), -tilt * math.cos(a), 0))
        m.blob((0, 0, 0.1), (0.9, 0.9, 0.25), 1, SNOW, amp=0.1, flat_base=-0.1)
    elif i == 1:
        # A broken block of ice, tilted, with a chamfered edge and a cracked crown.
        m.box((0, 0, 0.75), (1.9, 1.5, 1.6), (0.1, 0.18, 0.5), c, bevel=0.22, bevel_segs=2)
        m.box((0.9, 0.4, 0.4), (0.9, 0.8, 0.8), (-0.1, 0.1, -0.4), c, bevel=0.14, bevel_segs=2)
        m.box((-0.3, -0.2, 1.7), (0.7, 0.6, 0.7), (0.3, 0.1, 0.8), c, bevel=0.12, bevel_segs=2)
        m.blob((0, 0, 0.0), (1.9, 1.5, 0.3), 1, SNOW, amp=0.1, flat_base=-0.1)
    else:
        # A shard: a tall tapering slab with a glowing core.
        prof = [(0.7, -0.05), (0.75, 0.6), (0.45, 2.0), (0.28, 3.0), (0.0, 3.6)]
        m.lathe(prof, 5, (0, 0, 0), c, cap_start=True, mod=lambda j, k: 1.0 if j % 2 else 0.8, rot=(0.05, 0.09, 0))
        m.lathe([(0.3, 0.0), (0.35, 0.7), (0.0, 1.3)], 5, (1.0, 0.3, -0.05), c, cap_start=True, rot=(-0.25, 0.3, 0))
        m.lathe([(0.25, 0.0), (0.28, 0.5), (0.0, 1.0)], 5, (-0.9, -0.2, -0.05), c, cap_start=True, rot=(0.3, -0.3, 0))
        m.lathe([(0.2, 1.4), (0.2, 2.6), (0.0, 3.2)], 5, (0.0, 0.0, 0.0), tipc, mat="glow", rot=(0.05, 0.09, 0))
        m.blob((0, 0, 0.0), (1.6, 1.3, 0.3), 1, SNOW, amp=0.1, flat_base=-0.1)
    return m.build(ao_args=dict(reach=1.2, strength=0.55, rays=14), sharp=40)


def scenery():
    out = []
    for i in range(3):
        out += snow_pine(i)
    for i in range(3):
        out += snow_rock(i)
    for i in range(3):
        out += ice(i)
    return out


def landmarks():
    import nature_snow_lm

    return nature_snow_lm.landmarks()
