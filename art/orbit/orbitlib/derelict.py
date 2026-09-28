"""The Derelict: a dead satellite the size of a car, tumbling end over end.

A box bus wrapped in gold and black blankets with white radiator panels,
one face caved in and its blanket torn open over the honeycomb, a white
spherical fuel tank strapped to its flank (the thing to shoot), two solar
wings - one whole, one broken at its hinge and missing a panel - a dish on
a bent boom, attitude thrusters and a main engine bell.

    derelict              root, at the bus's centre of mass
      derelict.body       the bus (and everything bolted to it)
      tank                the fuel tank, origin at its centre
      panel.1, panel.2    the wings, origin at their hinge on the bus
      derelict.antenna    the dish and its boom
    derelict.pieces       a sibling group with the root's transform:
      derelict.piece.<n>  the bus broken into chunks for the break-up
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import bl, shapes, fracture
from .bl import Geo, rng

BX, BY, BZ = 1.5, 1.3, 1.9      # bus size


def build(lib, col):
    r = rng("derelict")
    I = Matrix.Identity(4)
    root = bl.empty("derelict", col, loc=(0, 0, 0), size=1.0, kind='derelict', surface='metal',
                    note="shoot the tank; the body shrugs off the laser")
    # ---- the bus: a dented box in blankets -----------------------------
    bm = shapes.box_bm((BX, BY, BZ), (10, 10, 10))
    shapes.dent(bm, (BX / 2, 0.1, 0.3), 0.55, 0.22, (-1, 0, 0))
    shapes.dent(bm, (-0.2, -BY / 2, -0.6), 0.35, 0.08, (0, 1, 0))
    shapes.crumple(bm, 0.012, 3.0, 2.0)
    # blanket patterning: gold MLI, black kapton panels, white radiators
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        m = 0                                       # mli_gold
        if abs(n.y) > 0.6 and c.z > -0.2:
            m = 2                                   # radiator faces (+/-Y)
        if abs(n.z) > 0.6:
            m = 1                                   # black on top and bottom
        if n.x > 0.6 and (c - Vector((BX / 2, 0.1, 0.3))).length < 0.4:
            m = 3                                   # torn open over the honeycomb
        f.material_index = m
    # tear the blanket: the crater in the dent loses its skin
    g = Geo("derelict.body")
    mats = ['mli_gold', 'kapton', 'radiator', 'honeycomb']
    me = bpy.data.meshes.new("__bus")
    bm.to_mesh(me)
    bm.free()
    bb = bmesh.new()
    bb.from_mesh(me)
    g.add_bmesh(bb, I, 'mli_gold', mats=mats)
    bb.free()
    bpy.data.meshes.remove(me)
    # structure edges and a frame around the radiators
    for sx in (-1, 1):
        for sy in (-1, 1):
            g.box(I, (0.05, 0.05, BZ + 0.02), 'alu_bare', center=(sx * BX / 2, sy * BY / 2, 0), bevel=0.01)
    # payload aperture and star trackers on the top
    g.cyl(I, (0.25, 0.1, BZ / 2), (0.25, 0.1, BZ / 2 + 0.35), 0.24, 'black_paint', seg=24, caps=(True, False))
    g.cyl(I, (0.25, 0.1, BZ / 2 + 0.35), (0.25, 0.1, BZ / 2 + 0.36), 0.25, 'alu_bare', seg=24, caps=(False, False))
    for (x, y) in ((-0.45, 0.35), (-0.45, -0.35)):
        g.box(I, (0.14, 0.14, 0.18), 'alu_darkext', center=(x, y, BZ / 2 + 0.09), bevel=0.015)
        g.cyl(I, (x, y, BZ / 2 + 0.18), (x, y, BZ / 2 + 0.3), 0.05, 'black_paint', seg=16, caps=(True, False))
    # attitude thrusters at the bottom corners and the main engine bell
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = Vector((sx * (BX / 2 - 0.1), sy * (BY / 2 - 0.1), -BZ / 2))
            g.cyl(I, p, p - Vector((0, 0, 0.08)), 0.03, 'alu_darkext', seg=12)
            g.lathe(Matrix.Translation(p - Vector((0, 0, 0.08))) @ Matrix.Rotation(math.pi, 4, 'X'),
                    [(0.02, 0.0), (0.035, 0.05), (0.04, 0.06)], 'steel', seg=12)
    g.lathe(Matrix.Translation((0, 0, -BZ / 2)) @ Matrix.Rotation(math.pi, 4, 'X'),
            [(0.12, 0.0), (0.14, 0.08), (0.2, 0.2), (0.32, 0.45), (0.34, 0.47)], 'burnt', seg=32)
    # the tank's cradle and pipes on the -X face
    tank_c = Vector((-BX / 2 - 0.5, -0.1, -0.25))
    for dz in (-0.3, 0.3):
        g.cyl(I, Vector((-BX / 2, -0.1, -0.25 + dz)), tank_c + Vector((0.25, 0, dz * 0.7)), 0.035, 'alu_bare', seg=10)
    g.tube(I, [Vector((-BX / 2, 0.3, -0.7)), Vector((-BX / 2 - 0.2, 0.3, -0.7)), tank_c + Vector((0.2, 0.25, -0.35))], 0.015, 'steel', seg=8)
    body = g.build(col, lib, smooth_angle=35)
    body.parent = root
    bl.tag(body, surface='metal', note="shrugs off the laser")
    # ---- the fuel tank ----------------------------------------------------
    tg = Geo("tank")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=24, radius=0.45)
    tg.add_bmesh(bm, I, 'white_paint', smooth=True)
    bm.free()
    tg.lathe(I, [(0.455, -0.02), (0.462, 0.0), (0.455, 0.02)], 'alu_bare', seg=48)
    tg.cyl(I, (0, 0, 0.44), (0, 0, 0.52), 0.05, 'alu_bare', seg=16)
    tg.cyl(I, (0, 0, 0.52), (0, 0, 0.56), 0.03, 'steel', seg=12)
    tg.box(I, (0.12, 0.004, 0.06), 'label_yellow', center=(0.0, -0.445, 0.12))
    tob = tg.build(col, lib, smooth_angle=60)
    tob.location = tank_c
    tob.parent = root
    bl.tag(tob, surface='metal', shootable=True, hits_to_rupture=3,
           note="the fuel tank: vents a plume from the valve (local +Z) when hit")
    # ---- solar wings -----------------------------------------------------
    for k, (side, broken) in enumerate(((1, False), (-1, True)), 1):
        pg = Geo(f"panel.{k}")
        hinge = Vector((0, side * (BY / 2 + 0.02), 0.2))
        yoke_end = Vector((0, side * 0.55, 0))
        pg.cyl(I, (0, 0, 0), yoke_end, 0.03, 'alu_bare', seg=10)
        npan = 3
        for i in range(npan):
            if broken and i == 2:
                continue                        # torn off in the collision
            c = yoke_end + Vector((0, side * (0.52 + i * 1.02), 0))
            M = Matrix.Translation(c)
            if broken and i == 1:
                # bent back at its hinge
                pivot = yoke_end + Vector((0, side * 1.02, 0))
                M = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(38) * side, 4, 'X') @ Matrix.Rotation(math.radians(12), 4, 'Y') @ Matrix.Translation(c - pivot)
            pg.box(M, (1.25, 0.98, 0.025), 'solar_cell', mats={'-z': 'solar_back'}, bevel=0.004)
            pg.box(M, (1.29, 1.0, 0.012), 'alu_bare', center=(0, 0, -0.018))
        pob = pg.build(col, lib)
        pob.location = hinge
        pob.parent = root
        bl.tag(pob, surface='metal', wing=k, note="origin on the wing's hinge")
    # ---- antenna on a bent boom -----------------------------------------
    ag = Geo("derelict.antenna")
    base = Vector((0.3, 0.2, BZ / 2))
    knee = base + Vector((0.2, -0.1, 0.55))
    tip = knee + Vector((0.45, -0.1, 0.12))
    ag.tube(I, [Vector((0, 0, 0)), knee - base, tip - base], 0.03, 'white_paint', seg=10)
    dish_n = Vector((0.7, -0.3, 0.6)).normalized()
    Md = bl.frame(tip - base, dish_n.orthogonal().normalized(), dish_n.cross(dish_n.orthogonal()).normalized(), dish_n)
    ag.lathe(Md, [(0.0, 0.0), (0.3, 0.04), (0.52, 0.15), (0.55, 0.16)], 'white_paint', seg=36)
    ag.cyl(Md, (0, 0, 0.0), (0, 0, 0.35), 0.015, 'alu_bare', seg=8)
    ag.box(Md, (0.08, 0.08, 0.1), 'mli_gold', center=(0, 0, 0.38), bevel=0.01)
    anob = ag.build(col, lib)
    anob.location = base
    anob.parent = root
    bl.tag(anob, surface='metal')
    return root, body


def fracture_body(body, cut_mat, final_mat, rect, col, map_fn):
    """Break the bus into chunks: seeds spread through its volume."""
    r = rng("derelict:fracture")
    seeds = []
    for i in range(7):
        seeds.append(Vector((r.uniform(-0.6, 0.6), r.uniform(-0.5, 0.5), -0.8 + 1.6 * (i + 0.5) / 7)))
    pieces = fracture.split(body, seeds, cut_mat, r, jag=0.04)
    return pieces
