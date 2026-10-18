"""The secrets' props: a spacewalker, the lost tool bag, the duck, and a
sticker of the spacewalker.

    astronaut                 root; stands on the origin, faces glTF +Z
      astronaut.body          suit, backpack, helmet, left arm, legs
      astronaut.arm.R         upper right arm, pivot at the shoulder
        astronaut.forearm.R   pivot at the elbow
          astronaut.hand.R    glove, pivot at the wrist; the thumb points
                              along the hand's local +Y (glTF): turn the
                              hand 180 degrees about its local -Z for a
                              thumbs-down
    toolbag                   root
      toolbag.bag             the white bag (hide it to burst)
      toolbag.tool.1..4       wrench, pistol-grip tool, socket bar, clamp
    duck                      a rubber duck, 12 cm, faces glTF +Z
    sticker                   a 20 cm die-cut vinyl sticker of the
                              spacewalker (alpha-masked), for the truss
"""

import math

import bmesh
from mathutils import Matrix, Vector

from . import bl
from .bl import Geo


def capsule(g, a, b, r, mat, seg=20, r_b=None):
    """A rounded limb from a to b (hemispherical ends)."""
    a, b = Vector(a), Vector(b)
    ax = b - a
    L = ax.length
    z = ax.normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    M = bl.frame(a, x, y, z)
    rb = r if r_b is None else r_b
    prof = [(0.0, -r)] + [(r * math.sin(i / 5 * math.pi / 2), -r * math.cos(i / 5 * math.pi / 2)) for i in range(1, 6)]
    prof += [(rb, L)] + [(rb * math.cos(i / 5 * math.pi / 2), L + rb * math.sin(i / 5 * math.pi / 2)) for i in range(1, 6)]
    g.lathe(M, prof, mat, seg=seg)


def ring(g, center, axis, r, mat, w=0.02, t=0.012, seg=24):
    c = Vector(center)
    z = Vector(axis).normalized()
    x = z.orthogonal().normalized()
    M = bl.frame(c, x, z.cross(x), z)
    g.lathe(M, [(r, -w / 2), (r + t, -w / 2), (r + t, w / 2), (r, w / 2)], mat, seg=seg)


def astronaut(lib, col):
    I = Matrix.Identity(4)
    root = bl.empty("astronaut", col, loc=(0, 0, 0), size=0.5, surface='cloth',
                    note="EVA spacewalker; stands on the origin, faces glTF +Z; right arm pivots for the thumbs-down")
    g = Geo("astronaut.body")
    # hard upper torso and the backpack
    g.box(I, (0.56, 0.38, 0.56), 'suit', center=(0, 0.0, 1.34), bevel=0.12)
    g.box(I, (0.6, 0.24, 0.76), 'suit', center=(0, 0.31, 1.3), bevel=0.06)
    g.box(I, (0.5, 0.02, 0.5), 'white_paint', center=(0, 0.43, 1.32), bevel=0.02)
    g.box(I, (0.12, 0.03, 0.2), 'black_paint', center=(0.18, 0.44, 1.52), bevel=0.01)
    # chest display and control module, with knobs and a mirror arm
    g.box(I, (0.3, 0.13, 0.15), 'white_paint', center=(0, -0.25, 1.32), bevel=0.02)
    g.box(I, (0.22, 0.01, 0.08), 'alu_darkext', center=(0, -0.317, 1.34))
    for x in (-0.09, -0.03, 0.03, 0.09):
        g.cyl(I, (x, -0.315, 1.265), (x, -0.335, 1.265), 0.013, 'black_paint', seg=10)
    g.box(I, (0.08, 0.05, 0.05), 'label_yellow', center=(0.13, -0.26, 1.42))
    # waist, brief, legs with the commander's red bands, boots
    capsule(g, (0, 0, 1.02), (0, 0, 1.12), 0.2, 'suit')
    ring(g, (0, 0, 1.08), (0, 0, 1), 0.2, 'alu_bare', w=0.03)
    for s in (-1, 1):
        hip = Vector((s * 0.12, 0.0, 0.96))
        knee = Vector((s * 0.15, -0.03, 0.52))
        ankle = Vector((s * 0.15, 0.0, 0.14))
        capsule(g, hip, knee, 0.1, 'suit')
        capsule(g, knee, ankle, 0.085, 'suit')
        ring(g, hip.lerp(knee, 0.08), knee - hip, 0.1, 'alu_bare')
        ring(g, knee.lerp(hip, 0.4), knee - hip, 0.101, 'suit_red', w=0.05, t=0.004)
        ring(g, ankle.lerp(knee, 0.1), knee - ankle, 0.086, 'alu_bare')
        g.box(I, (0.15, 0.32, 0.13), 'suit', center=(s * 0.15, -0.06, 0.065), bevel=0.04)
        g.box(I, (0.16, 0.33, 0.03), 'black_paint', center=(s * 0.15, -0.06, 0.012), bevel=0.01)
    # left arm (static), glove
    sh, el, wr = Vector((0.34, 0.0, 1.5)), Vector((0.43, -0.12, 1.22)), Vector((0.41, -0.25, 1.02))
    capsule(g, sh, el, 0.085, 'suit')
    capsule(g, el, wr, 0.075, 'suit')
    ring(g, sh.lerp(el, 0.1), el - sh, 0.086, 'alu_bare')
    ring(g, wr.lerp(el, 0.12), el - wr, 0.076, 'alu_bare')
    g.box(bl.look_matrix(wr + (wr - el).normalized() * 0.07, (wr - el), (0, -1, 0)), (0.09, 0.11, 0.07), 'suit', bevel=0.03)
    # helmet: white shell, gold visor, lamps
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=0.19)
    g.add_bmesh(bm, Matrix.Translation((0, 0.01, 1.8)), 'white_paint', smooth=True)
    bm.free()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=0.195)
    kill = [f for f in bm.faces
            if f.calc_center_median().y > -0.085 or not (-0.11 < f.calc_center_median().z < 0.1)
            or abs(f.calc_center_median().x) > 0.15]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    g.add_bmesh(bm, Matrix.Translation((0, 0.01, 1.8)), 'visor_gold', smooth=True)
    bm.free()
    # the visor assembly's white brow and side guards
    g.lathe(Matrix.Translation((0, 0.01, 1.8)) @ Matrix.Rotation(math.radians(90), 4, 'X'),
            [(0.197, -0.02), (0.205, -0.02), (0.205, 0.02), (0.197, 0.02)], 'white_paint', seg=32,
            a0=math.radians(200), a1=math.radians(340), closed=False)
    for s in (-1, 1):
        g.box(I, (0.06, 0.08, 0.06), 'white_paint', center=(s * 0.19, -0.02, 1.9), bevel=0.01)
        g.cyl(I, (s * 0.19, -0.06, 1.9), (s * 0.19, -0.075, 1.9), 0.022, 'window_dark', seg=12)
    g.cyl(I, (0, 0.2, 1.5), (0, 0.1, 1.72), 0.03, 'white_paint', seg=10)
    # safety tether reel and its line
    g.box(I, (0.08, 0.06, 0.1), 'white_paint', center=(-0.22, -0.12, 1.02), bevel=0.01)
    g.tube(I, [(-0.22, -0.16, 1.0), (-0.3, -0.3, 0.95), (-0.45, -0.4, 0.9), (-0.7, -0.45, 0.88)], 0.004, 'cable_white', seg=6)
    body = g.build(col, lib, smooth_angle=45)
    body.parent = root
    bl.tag(body, surface='cloth')
    # right arm: shoulder -> elbow -> wrist. Each part's node is aligned
    # with its limb: local -Z (glTF) runs down the limb toward the hand,
    # local X is the hinge, local +Y (glTF) faces forward in the rest pose.
    # Raise the arm forward (rotate arm.R about its local X by +90 degrees
    # in glTF) and the thumb points up; turn the hand 180 degrees about its
    # local Z for the thumbs-down.
    shR, elR, wrR = Vector((-0.34, 0.0, 1.5)), Vector((-0.43, -0.12, 1.22)), Vector((-0.41, -0.25, 1.02))
    fwd_hint = Vector((0, -1, 0))

    def limb_matrix(p, d):
        return bl.look_matrix(p, d, fwd_hint)

    Ma = limb_matrix(shR, elR - shR)
    La = (elR - shR).length
    ga = Geo("astronaut.arm.R")
    capsule(ga, Vector((0, 0, 0)), Vector((0, La, 0)), 0.085, 'suit')
    ring(ga, Vector((0, La * 0.1, 0)), Vector((0, 1, 0)), 0.086, 'alu_bare')
    aob = ga.build(col, lib, smooth_angle=45)
    aob.parent = root
    aob.matrix_world = Ma
    bl.tag(aob, surface='cloth', note="pivot at the shoulder; -Z (glTF) down the arm, hinge on local X")
    Mf = limb_matrix(elR, wrR - elR)
    Lf = (wrR - elR).length
    gf = Geo("astronaut.forearm.R")
    capsule(gf, Vector((0, 0, 0)), Vector((0, Lf, 0)), 0.075, 'suit')
    ring(gf, Vector((0, Lf * 0.88, 0)), Vector((0, 1, 0)), 0.076, 'alu_bare')
    fob = gf.build(col, lib, smooth_angle=45)
    fob.parent = aob
    fob.matrix_world = Mf
    bl.tag(fob, surface='cloth', note="pivot at the elbow; -Z (glTF) down the forearm, hinge on local X")
    # the glove: a fist (palm, curled fingers, knuckles) with the thumb
    # along local +Z (Blender) = +Y (glTF), forward in the rest pose
    gh = Geo("astronaut.hand.R")
    I = Matrix.Identity(4)
    gh.box(I, (0.095, 0.035, 0.09), 'alu_bare', center=(0, 0.01, 0), bevel=0.008)          # wrist disconnect
    gh.box(I, (0.09, 0.075, 0.085), 'suit', center=(0, 0.065, 0.0), bevel=0.028)           # palm
    for k in range(4):
        x = -0.033 + k * 0.022
        capsule(gh, Vector((x, 0.1, 0.02)), Vector((x, 0.115, -0.02)), 0.0125, 'suit', seg=10)
    capsule(gh, Vector((0.047, 0.07, 0.02)), Vector((0.047, 0.08, 0.075)), 0.015, 'suit', seg=10)   # thumb, up
    gh.box(I, (0.092, 0.02, 0.06), 'black_paint', center=(0, 0.06, -0.035), bevel=0.006)   # palm grip pad
    hob = gh.build(col, lib, smooth_angle=45)
    hob.parent = fob
    hob.matrix_world = limb_matrix(wrR, wrR - elR)
    bl.tag(hob, surface='cloth', note="pivot at the wrist; thumb along local +Y (glTF)")
    return root


def toolbag(lib, col):
    I = Matrix.Identity(4)
    root = bl.empty("toolbag", col, loc=(0, 0, 0), size=0.3, surface='cloth',
                    note="hide toolbag.bag and set the tools tumbling to burst it")
    g = Geo("toolbag.bag")
    g.box(I, (0.4, 0.22, 0.26), 'bag', bevel=0.05)
    g.box(I, (0.41, 0.23, 0.05), 'bag', center=(0, 0, 0.12), bevel=0.02)
    for x in (-0.12, 0.12):
        g.box(I, (0.035, 0.235, 0.265), 'velcro_grey', center=(x, 0, 0.0), bevel=0.005)
    ring(g, (0, 0, 0.17), (1, 0, 0), 0.03, 'steel', w=0.006, t=0.006)
    g.box(I, (0.08, 0.004, 0.04), 'label', center=(0.0, -0.113, 0.02))
    g.tube(I, [(0, 0, 0.2), (0.05, 0, 0.3), (0.2, 0.05, 0.36), (0.4, 0.1, 0.3)], 0.004, 'cable_white', seg=6)
    bob = g.build(col, lib, smooth_angle=45)
    bob.parent = root
    bl.tag(bob, surface='cloth')
    tools = []
    # 1 wrench
    t = Geo("toolbag.tool.1")
    t.box(I, (0.18, 0.022, 0.008), 'steel', bevel=0.003)
    t.lathe(Matrix.Translation((0.1, 0, 0)), [(0.012, -0.005), (0.022, -0.005), (0.022, 0.005), (0.012, 0.005)], 'steel', seg=16)
    tools.append((t, Vector((-0.08, 0.02, -0.03))))
    # 2 pistol-grip tool
    t = Geo("toolbag.tool.2")
    t.box(I, (0.18, 0.06, 0.07), 'black_paint', bevel=0.01)
    t.box(I, (0.05, 0.055, 0.13), 'black_paint', center=(-0.04, 0, -0.09), bevel=0.01)
    t.box(I, (0.05, 0.05, 0.04), 'label_yellow', center=(0.02, 0, 0.045), bevel=0.005)
    t.cyl(I, (0.09, 0, 0), (0.15, 0, 0), 0.012, 'steel', seg=12)
    tools.append((t, Vector((0.06, -0.02, 0.02))))
    # 3 socket extension
    t = Geo("toolbag.tool.3")
    t.cyl(I, (-0.08, 0, 0), (0.08, 0, 0), 0.008, 'steel', seg=10)
    t.cyl(I, (0.08, 0, 0), (0.11, 0, 0), 0.016, 'steel', seg=6)
    tools.append((t, Vector((0.0, 0.04, -0.06))))
    # 4 a spring clamp with orange grips
    t = Geo("toolbag.tool.4")
    t.box(I, (0.12, 0.02, 0.012), 'cable_orange', bevel=0.004)
    t.box(bl.frame((0, 0, 0.02), Vector((math.cos(0.25), 0, math.sin(0.25))), Vector((0, 1, 0)), Vector((-math.sin(0.25), 0, math.cos(0.25)))), (0.12, 0.02, 0.012), 'cable_orange', bevel=0.004)
    t.cyl(I, (0.06, -0.012, 0.01), (0.06, 0.012, 0.01), 0.008, 'steel', seg=10)
    tools.append((t, Vector((0.1, 0.03, -0.02))))
    for tg, pos in tools:
        o = tg.build(col, lib)
        o.parent = root
        o.location = pos
        bl.tag(o, surface='metal', note="inside the bag until it bursts")
    return root


def duck(lib, col):
    g = Geo("duck")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=18, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        # a plump body, flat underneath, the tail lifted at the back (+Y)
        v.co = Vector((x * 0.048, y * 0.062, z * 0.036))
        if v.co.z < -0.02:
            v.co.z = -0.02 + (v.co.z + 0.02) * 0.4
        if v.co.y > 0.03:
            v.co.z += (v.co.y - 0.03) * 0.9
            v.co.x *= 1 - (v.co.y - 0.03) * 8
    g.add_bmesh(bm, Matrix.Translation((0, 0.008, 0.0)), 'duck_yellow', smooth=True)
    bm.free()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.031)
    g.add_bmesh(bm, Matrix.Translation((0, -0.03, 0.045)), 'duck_yellow', smooth=True)
    bm.free()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.02, v.co.y * 0.022, v.co.z * 0.007))
    g.add_bmesh(bm, Matrix.Translation((0, -0.063, 0.039)), 'duck_orange', smooth=True)
    bm.free()
    for s in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.0055)
        g.add_bmesh(bm, Matrix.Translation((s * 0.016, -0.052, 0.058)), 'black_paint', smooth=True)
        bm.free()
    ob = g.build(col, lib, smooth_angle=60)
    bl.tag(ob, surface='rubber', note="faces glTF +Z; 'In space, no one can hear you squeak.'")
    return ob
