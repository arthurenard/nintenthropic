"""The canyon's landmarks: mesa, rock-arch (a span: the road's own frame), water-tower. Blender coordinates:
z up, the front (the side that faces the road) is -y. A span model has x right of the road's centre line and
the road running along -y."""

import math

from mathutils import Vector as V, noise

from naturekit import Model, empty, grad_z, hexc, mix, post, rod, smoothstep, varied, TAU
from nature_canyon import strata


def n3(x, y, z, seed=0.0):
    return noise.noise(V((x + seed * 17.3, y - seed * 9.1, z + seed * 4.7)))


def mesa():
    root = empty("landmark.mesa")
    m = Model("mesa.body", seed=11)
    # The profile, base radius 30: a talus slope, three sheer cliffs split by ledges, a flat crown.
    prof = [(38, -2.0), (35, 2.0), (31, 6.5), (28.5, 10.5), (26.5, 12.5), (26.1, 24.0), (27.4, 24.8), (27.6, 25.6), (25.7, 26.4), (25.3, 38.0), (26.4, 38.8), (26.6, 39.6), (24.6, 40.4), (24.2, 52.0), (25.2, 52.7), (25.1, 53.6), (22.0, 54.0), (14.0, 54.4), (6.0, 54.6), (0.0, 54.7)]
    dense = []
    for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
        steps = max(1, int(math.ceil(abs(z1 - z0) / 2.0)))
        for q in range(steps):
            dense.append((r0 + (r1 - r0) * q / steps, z0 + (z1 - z0) * q / steps))
    dense.append(prof[-1])
    prof = dense
    sides = 64
    squash = 0.8

    def mod(j, k):
        th = j * TAU / sides
        z = prof[k][1]
        cliff = 1.0 + 0.07 * n3(math.cos(th) * 2.0, math.sin(th) * 2.0, z * 0.05, 1) + 0.045 * n3(math.cos(th) * 5.0, math.sin(th) * 5.0, z * 0.12, 2)
        # Gullies: vertical grooves cut into the cliffs, deeper higher up, and a lopsided outline.
        groove = 1.0 - 0.03 * max(0.0, math.sin(th * 9.0 + n3(th, 0, 0, 3) * 4.0)) * smoothstep(8, 20, z) * (1 - smoothstep(52, 54, z))
        lobes = 1.0 + 0.1 * math.cos(th * 2.0 + 0.7) + 0.05 * math.cos(th * 3.0 + 2.1)
        return cliff * groove * lobes
    col = strata(0.0, 12.0, 55.0, seed=3, wobble=0.012, top_dust=0.5)

    def mesa_col(p, n):
        base = col(p, n)
        top = smoothstep(52.5, 54.2, p.z) * smoothstep(0.7, 0.95, n.z)
        talus = (1 - smoothstep(4.0, 14.0, p.z)) * smoothstep(0.35, 0.8, n.z)
        c = mix(base, hexc("#9c4a32"), top * 0.8)
        return mix(c, hexc("#e6b98a"), talus * 0.7)
    m.lathe(prof, sides, (0, 0, 0), varied(mesa_col, 0.04, 0.4, 3), mod=mod, squash=squash, cap_end=True)
    # A split-off tower beside it and rubble at the foot of the cliffs.
    spire = [(7.0, -1.0), (6.2, 6), (5.0, 12), (5.4, 13), (4.6, 24), (4.9, 25.5), (4.0, 38), (4.3, 39), (0.0, 42.0)]
    m.lathe(spire, 14, (-36, -8, 0), varied(strata(0.0, 6.0, 42.0, seed=4, wobble=0.06, top_dust=0.4), 0.04, 0.4, 4), mod=lambda j, k: 1 + 0.12 * n3(j * 0.9, k * 0.6, 0, 5), cap_start=True)
    for k in range(16):
        a = k * 2.399 + 0.4
        r = 30 + 12 * ((k * 7) % 5) / 4
        s = 2.5 + 3.5 * ((k * 11) % 7) / 6
        m.blob((math.cos(a) * r, math.sin(a) * r * 0.8, 0), (s, s * 0.85, s * 0.7), 2, varied(strata(0.0, 3.0, s * 1.6, seed=k, top_dust=0.5), 0.08, 1.0, k), amp=0.22, seed=k, flat_base=-0.4)
    # The crown: boulders and a stubby pinnacle, a few sage-green scrub.
    top = 54.6
    for k in range(5):
        a = k * 1.9 + 0.3
        r = 8 + 9 * ((k * 5) % 4) / 3
        s = 1.4 + 1.1 * (k % 3)
        m.blob((math.cos(a) * r, math.sin(a) * r * 0.8, top), (s, s, s * 0.7), 2, varied(strata(top, 3.0, s * 2.0, seed=k + 5, top_dust=0.4), 0.08, 1.0), amp=0.22, seed=k + 20, flat_base=-0.4)
    m.cone((6, -3, top - 0.3), 2.6, 9.5, 6, varied(grad_z(top, top + 9, hexc("#a8452c"), hexc("#d98a56")), 0.06, 1.0), cap=True)
    m.build(parent=root, ao_args=dict(reach=8.0, strength=0.8, rays=18, ground_reach=6.0), sharp=38)
    return root


def arch_point(t, th, hw, top, thick, z, seed):
    """A point of the arch's cross-section: th runs 0 (right foot) to pi (left foot) along the inner curve,
    t is 0 on the inner face and 1 on the outer; the rock is rough and thicker towards the feet."""
    ix = math.cos(th) * hw
    iz = math.sin(th) * top
    # The outward normal of the inner ellipse.
    nx = math.cos(th) / hw
    nz = math.sin(th) / top
    nl = math.hypot(nx, nz) or 1.0
    nx, nz = nx / nl, nz / nl
    d = thick * t
    return V((ix + nx * d, 0.0, iz + nz * d))


def rock_arch():
    root = empty("landmark.rock-arch")
    m = Model("arch.body", seed=12)
    hw, top = 14.4, 15.5       # the opening: wide enough for the widest road, a good 15 m clear
    half = 8.6                  # half the road length it covers (the track says 16 m)
    slices = 14
    arc = 22
    rings = []
    for si in range(slices + 1):
        u = si / slices
        zz = -half + 2 * half * u
        # Fatter on one leg than the other and tucked in at the ends so it is plainly not made by a machine.
        taper = 0.55 + 0.45 * math.sqrt(math.sin(math.pi * min(1.0, max(0.0, u * 0.94 + 0.03))))
        ring = []
        # The inner curve, right foot to left foot, then back along the outer curve.
        for i in range(arc + 1):
            th = math.pi * i / arc
            thick = (3.0 + 3.0 * math.sin(th) ** 1.4) * (0.7 + 0.5 * (math.cos(th) * 0.5 + 0.5)) * taper
            wob = 1.0 + 0.13 * n3(math.cos(th) * 3, zz * 0.2, math.sin(th) * 3, 7)
            p = arch_point(0.0, th, hw * wob, top * wob, thick, zz, 0)
            ring.append(V((p.x, zz, p.z)))
        for i in range(arc, -1, -1):
            th = math.pi * i / arc
            thick = (3.0 + 3.0 * math.sin(th) ** 1.4) * (0.7 + 0.5 * (math.cos(th) * 0.5 + 0.5)) * taper
            wob = 1.0 + 0.13 * n3(math.cos(th) * 3, zz * 0.2, math.sin(th) * 3, 7)
            p = arch_point(1.0, th, hw * wob, top * wob, thick * (1 + 0.18 * n3(th * 2, zz * 0.3, 0, 9)), zz, 0)
            ring.append(V((p.x, zz, max(-3.0, p.z))))
        # The feet are buried: pull the bottom of the ring below the ground.
        ring = [V((q.x, q.y, q.z - 2.5 if q.z < 0.6 else q.z)) for q in ring]
        rings.append(ring)
    col = varied(strata(-2.0, 9.0, 26.0, seed=7, wobble=0.06, top_dust=0.55), 0.05, 0.5, 5)
    # Face the ring so its normals point out of the rock: the loop runs inner (right to left) then outer (left to right).
    m.loft(rings[::-1], col)
    # The two ends: the band between the inner and the outer curve, a strip of quads (the ring is inner then outer, reversed).
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        inner, outer = ring[: arc + 1], ring[arc + 1:][::-1]
        m.loft([outer, inner] if flip else [inner, outer], col, close=False)
    # A keystone-like block wedged on the crown, tilted, and a smaller one beside it.
    crown = top + 6.4
    m.blob((1.5, 0.0, crown - 0.5), (4.6, 5.0, 3.1), 3, varied(strata(crown - 2, 3.0, 5.0, seed=8, top_dust=0.5), 0.06, 0.8), amp=0.2, seed=2, flat_base=-0.45, rot=(0, 0.05, 0.25))
    m.blob((-6.2, 2.0, crown - 1.2), (2.6, 2.6, 1.8), 2, varied(strata(crown - 2, 3.0, 5.0, seed=9, top_dust=0.5), 0.06, 0.8), amp=0.22, seed=3, flat_base=-0.4)
    # A split-off pinnacle and rubble at the feet.
    for sx in (-1, 1):
        m.cone((sx * (hw + 7.5), -3.0 * sx, -1.5), 3.0, 11.0 - 3 * sx, 7, varied(strata(-1.5, 5.0, 12.0, seed=10 + sx, top_dust=0.3), 0.06, 0.6), cap=True)
        for k in range(5):
            a = k * 1.7 + sx
            s = 1.6 + 1.6 * ((k * 5) % 4) / 3
            m.blob((sx * (hw + 3.8 + 4 * ((k * 3) % 4) / 3), math.sin(a) * 6.0, 0), (s, s * 0.9, s * 0.75), 2, varied(strata(0.0, 3.0, s * 1.6, seed=k, top_dust=0.5), 0.08, 1.0, k), amp=0.22, seed=k + sx * 7, flat_base=-0.4)
    m.build(parent=root, ao_args=dict(reach=6.0, strength=0.8, rays=18, ground_reach=5.0), sharp=40)
    return root


def water_tower():
    root = empty("landmark.water-tower")
    m = Model("tower.body", seed=13)
    steel = hexc("#b0412e")
    steel_d = hexc("#6c261c")
    wood = hexc("#b0773a")
    wood_d = hexc("#6a4322")
    # Four tapering legs on stone footings, ringed by three girts and X braced between.
    base_r, top_r = 4.4, 3.1
    zs = [0.0, 6.0, 12.0, 17.5]
    rs = [base_r + (top_r - base_r) * z / 17.5 for z in zs]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        c, s = math.cos(a), math.sin(a)
        m.box((c * base_r * 1.42, s * base_r * 1.42, 0.1), (1.3, 1.3, 0.8), (0, 0, a), hexc("#8d8a84"), bevel=0.1)
        rod(m, (c * base_r * 1.41, s * base_r * 1.41, 0.4), (c * top_r * 1.41, s * top_r * 1.41, 17.5), 0.2, grad_z(0, 17.5, steel_d, steel))
    for z, r in zip(zs[1:], rs[1:]):
        for k in range(4):
            a0 = k * math.pi / 2 + math.pi / 4
            a1 = (k + 1) * math.pi / 2 + math.pi / 4
            rod(m, (math.cos(a0) * r * 1.41, math.sin(a0) * r * 1.41, z), (math.cos(a1) * r * 1.41, math.sin(a1) * r * 1.41, z), 0.14, steel_d)
    for zi in range(3):
        z0, z1 = zs[zi], zs[zi + 1]
        r0, r1 = rs[zi], rs[zi + 1]
        for k in range(4):
            a0 = k * math.pi / 2 + math.pi / 4
            a1 = (k + 1) * math.pi / 2 + math.pi / 4
            p = lambda a, r, z: (math.cos(a) * r * 1.41, math.sin(a) * r * 1.41, z)
            rod(m, p(a0, r0, z0), p(a1, r1, z1), 0.07, wood)
            rod(m, p(a1, r0, z0), p(a0, r1, z1), 0.07, wood)
    # The deck, rail, and a ladder up the front-right leg.
    m.lathe([(0.0, 17.5), (5.6, 17.5), (5.6, 18.0), (0.0, 18.0)], 16, (0, 0, 0), varied(grad_z(17.5, 18.0, wood_d, wood), 0.06, 1.4), cap_start=True, cap_end=True)
    for k in range(16):
        a = k * TAU / 16
        post(m, math.cos(a) * 5.4, math.sin(a) * 5.4, 18.0, 19.0, 0.07, steel_d, 5)
    m.torus((0, 0, 19.0), 5.4, 0.08, 5, 32, steel)
    rod(m, (2.6, -3.6, 0.3), (2.2, -3.2, 18.3), 0.07, hexc("#6b7480"))
    rod(m, (3.0, -3.6, 0.3), (2.6, -3.2, 18.3), 0.07, hexc("#6b7480"))
    for q in range(22):
        z = 0.7 + q * 0.8
        f = z / 18.0
        rod(m, (2.6 - 0.4 * f, -3.6 + 0.4 * f, z), (3.0 - 0.4 * f, -3.6 + 0.4 * f, z), 0.04, hexc("#6b7480"))
    # The tank: a wooden barrel, staves running up it, iron hoops, a conical roof with a finial.
    prof = [(0.0, 18.0), (3.9, 18.0), (4.5, 19.5), (4.9, 22.5), (4.6, 25.5), (4.2, 27.0)]
    m.lathe(prof, 28, (0, 0, 0), varied(lambda p, n: mix(wood_d, wood, 0.35 + 0.5 * smoothstep(18, 27, p.z)), 0.06, 1.3, 6), mod=lambda j, k: 1.0 if j % 2 else 0.985, cap_start=True)
    for z, r in ((19.2, 4.35), (22.5, 4.95), (25.4, 4.62)):
        m.torus((0, 0, z), r + 0.03, 0.14, 6, 36, hexc("#2a2623"))
    m.lathe([(4.9, 26.5), (5.2, 26.8), (2.8, 29.5), (0.0, 31.5)], 28, (0, 0, 0), varied(grad_z(26.5, 31.5, hexc("#8e2b22"), hexc("#d2503c")), 0.05, 1.2), mod=lambda j, k: 1.0 if j % 2 else 0.97)
    post(m, 0, 0, 31.3, 33.0, 0.1, steel_d, 5)
    m.blob((0, 0, 33.1), 0.22, 1, hexc("#e8c04a"))
    # The spout down to a trough, a few barrels and a wagon wheel leaning on the footing.
    m.tube([V((4.3, 0.2, 19.0)), V((4.8, 0.5, 15.0)), V((5.0, 0.6, 9.0)), V((5.1, 0.8, 3.0)), V((5.1, 1.2, 1.6))], [0.2] * 5, 6, col=hexc("#5a5f66"), cap_end=True)
    m.box((5.3, 2.0, 0.6), (1.2, 3.6, 0.8), (0, 0, 0.1), grad_z(0, 1.2, wood_d, wood), bevel=0.06)
    m.box((5.3, 2.0, 0.85), (0.9, 3.2, 0.5), (0, 0, 0.1), hexc("#4c7f9a"))
    for k, (x, y) in enumerate([(-6.2, -2.0), (-7.4, -1.2), (-6.6, -0.2)]):
        m.lathe([(0.78, 0.0), (0.92, 0.45), (0.92, 0.95), (0.78, 1.4)], 12, (x, y, 0.0), varied(grad_z(0, 1.4, wood_d, wood), 0.08, 2.0, k), cap_start=True, cap_end=True)
        m.torus((x, y, 0.35), 0.88, 0.05, 4, 16, hexc("#2a2623"))
        m.torus((x, y, 1.05), 0.88, 0.05, 4, 16, hexc("#2a2623"))
    m.torus((-4.6, -4.4, 1.1), 1.05, 0.1, 5, 24, wood, axis="y")
    m.torus((-4.6, -4.4, 1.1), 0.25, 0.1, 5, 12, wood, axis="y")
    for k in range(6):
        a = k * math.pi / 3
        rod(m, (-4.6 + math.cos(a) * 0.2, -4.4, 1.1 + math.sin(a) * 0.2), (-4.6 + math.cos(a) * 1.0, -4.4, 1.1 + math.sin(a) * 1.0), 0.05, wood)
    # Drifted sand at the foot and a small thorny bush.
    m.blob((3.0, 4.0, 0.0), (5.0, 3.6, 0.9), 2, hexc("#ecd2a2"), amp=0.1, flat_base=-0.1, seed=3)
    m.build(parent=root, ao_args=dict(reach=4.0, strength=0.75, rays=16), sharp=45)
    return root


def landmarks():
    return [mesa(), rock_arch(), water_tower()]
