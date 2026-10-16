"""The repair drone: a small white free-flyer that works outside the
windows. Everything about it says "made, and alive": clean symmetry, a
black sensor band with two camera eyes, the station's running lights
(red to port, green to starboard, a white strobe on top), cold-gas nozzles
at its eight corners, a patch of cells on its back, and a two-jointed arm
with a welding head.

Faces glTF +Z (Blender -Y), like every character in Handheld. Node layout:

    drone                 root (origin at the body's centre)
      drone.body          the shell, band, eyes, cells, side lights
      thruster.1..8       the nozzles; each node's -Z points along its
                          exhaust, its origin at the nozzle's exit
      light.nav           the white strobe (emissive)
      arm.shoulder        pivots at the shoulder (local X is the hinge)
        arm.elbow         pivots at the elbow (local X is the hinge)
          weld.tip        empty at the welding tip, -Z pointing out of it
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import bl
from .bl import Geo

W, D, H = 0.52, 0.46, 0.40      # body width (x), depth (y), height (z)


def build(lib, col):
    I = Matrix.Identity(4)
    root = bl.empty("drone", col, loc=(0, 0, 0), size=0.3, surface='metal',
                    note="faces glTF +Z; welder arm under the chin")
    g = Geo("drone.body")
    # rounded shell in white, a black band round the middle
    g.box(I, (W, D, H), 'white_paint', bevel=0.06)
    g.box(I, (W + 0.012, D + 0.012, 0.075), 'black_paint', center=(0, 0, 0.02), bevel=0.01)
    # panel seams: thin dark grooves on the top and sides
    for x in (-0.13, 0.13):
        g.box(I, (0.004, D - 0.09, 0.004), 'alu_darkext', center=(x, 0, H / 2 + 0.001))
    for z in (-0.1, 0.12):
        g.box(I, (W - 0.1, 0.004, 0.004), 'alu_darkext', center=(0, -D / 2 - 0.001, z))
    # the two camera eyes in the band, and a lidar puck between them
    for x in (-0.11, 0.11):
        g.cyl(I, (x, -D / 2 - 0.005, 0.02), (x, -D / 2 - 0.035, 0.02), 0.032, 'alu_bare', seg=24, caps=(False, True), cap_mat='window_dark')
        g.cyl(I, (x, -D / 2 - 0.035, 0.02), (x, -D / 2 - 0.04, 0.02), 0.022, 'window_dark', seg=24)
    g.cyl(I, (0, -D / 2 - 0.004, 0.02), (0, -D / 2 - 0.02, 0.02), 0.018, 'alu_darkext', seg=16)
    # gold blanket on the back, cells on top, an antenna whip
    g.box(I, (W - 0.08, 0.01, H - 0.1), 'mli_gold', center=(0, D / 2 + 0.004, 0.0))
    g.box(I, (W - 0.12, D - 0.14, 0.008), 'solar_cell', center=(0, 0.02, H / 2 + 0.004), mats={'-z': 'alu_bare'})
    g.cyl(I, (0.18, 0.15, H / 2), (0.18, 0.15, H / 2 + 0.22), 0.004, 'steel', seg=6)
    g.cyl(I, (0.18, 0.15, H / 2 + 0.22), (0.18, 0.15, H / 2 + 0.23), 0.009, 'black_paint', seg=8)
    # a grapple pin on the back for the dock, and handholds
    g.cyl(I, (0, D / 2 + 0.01, -0.08), (0, D / 2 + 0.09, -0.08), 0.02, 'alu_bare', seg=12)
    g.box(I, (0.06, 0.02, 0.06), 'alu_bare', center=(0, D / 2 + 0.1, -0.08), bevel=0.006)
    for x in (-W / 2 - 0.01, W / 2 + 0.01):
        g.tube(I, [(x, -0.1, -0.12), (x + (0.04 if x > 0 else -0.04), -0.1, -0.12), (x + (0.04 if x > 0 else -0.04), 0.1, -0.12),
                   (x, 0.1, -0.12)], 0.009, 'handrail_yellow', seg=8)
    # running lights: red to port (the drone's left = +X, it faces -Y), green to starboard
    for x, mat in ((W / 2 + 0.004, 'nav_red'), (-W / 2 - 0.004, 'nav_green')):
        g.cyl(I, (x, -0.12, 0.13), (x + (0.02 if x > 0 else -0.02), -0.12, 0.13), 0.018, 'white_paint', seg=12, caps=(False, True))
        g.cyl(I, (x + (0.02 if x > 0 else -0.02), -0.12, 0.13), (x + (0.03 if x > 0 else -0.03), -0.12, 0.13), 0.014, mat, seg=12)
    body = g.build(col, lib, smooth_angle=40)
    body.parent = root
    bl.tag(body, surface='metal')
    # ---- thrusters at the eight corners ----
    k = 1
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corner = Vector((sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), sz * (H / 2 - 0.03)))
                out = Vector((sx, sy * 0.35, sz * 0.8)).normalized()
                exitp = corner + out * 0.075
                tg = Geo(f"thruster.{k}")
                # nozzle built in its own frame: +Y along the exhaust (the
                # node's glTF -Z), origin at the exit
                Mn = Matrix.Identity(4)
                tg.cyl(Mn, (0, -0.06, 0), (0, -0.035, 0), 0.016, 'alu_darkext', seg=12)
                tg.lathe(Matrix.Rotation(math.radians(-90), 4, 'X'), [(0.009, -0.035), (0.012, -0.02), (0.02, 0.0), (0.021, 0.002)],
                         'steel', seg=16)
                tob = tg.build(col, lib)
                tob.matrix_world = bl.look_matrix(exitp, out, (0, 0, 1) if abs(out.z) < 0.95 else (1, 0, 0))
                tob.parent = root
                bl.tag(tob, surface='metal', thruster=k, note="-Z points along the exhaust; puff from the origin")
                k += 1
    # ---- the strobe on top ----
    lg = Geo("light.nav")
    lg.cyl(I, (0, 0, 0), (0, 0, 0.02), 0.02, 'white_paint', seg=12)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.017)
    lg.add_bmesh(bm, Matrix.Translation((0, 0, 0.026)), 'nav_white', smooth=True)
    bm.free()
    lob = lg.build(col, lib)
    lob.location = (-0.16, -0.12, H / 2)
    lob.parent = root
    bl.tag(lob, surface='metal', light='white', note="white strobe; blink it")
    # ---- the welder arm, under the chin ----
    sh = Vector((0.0, -D / 2 + 0.06, -H / 2 - 0.01))
    el = sh + Vector((0.0, -0.2, -0.08))
    tip = el + Vector((0.0, -0.17, 0.09))
    ag = Geo("arm.shoulder")
    ag.cyl(I, Vector((-0.04, 0, 0)), Vector((0.04, 0, 0)), 0.035, 'alu_darkext', seg=16)
    ag.tube(I, [Vector((0, 0, 0)), el - sh], 0.018, 'white_paint', seg=12)
    aob = ag.build(col, lib)
    aob.location = sh
    aob.parent = root
    bl.tag(aob, surface='metal', note="shoulder: rotate about local X")
    eg = Geo("arm.elbow")
    eg.cyl(I, Vector((-0.03, 0, 0)), Vector((0.03, 0, 0)), 0.026, 'alu_darkext', seg=16)
    eg.tube(I, [Vector((0, 0, 0)), (tip - el) * 0.8], 0.014, 'white_paint', seg=12)
    eg.cyl(I, (tip - el) * 0.75, (tip - el) * 1.0, 0.02, 'steel', seg=14, r1=0.008)
    eg.cyl(I, (tip - el) * 1.0, (tip - el) * 1.04, 0.009, 'weld_blue', seg=10)
    eob = eg.build(col, lib)
    eob.parent = aob
    eob.location = el - sh
    bl.tag(eob, surface='metal', note="elbow: rotate about local X")
    wt = bl.empty("weld.tip", col, matrix=bl.look_matrix(Vector((0, 0, 0)), (tip - el).normalized(), (0, 0, 1)), size=0.03)
    wt.parent = eob
    wt.location = (tip - el) * 1.04
    bl.tag(wt, note="the welding tip; -Z points out of it (the blue glow and sparks)")
    return root
