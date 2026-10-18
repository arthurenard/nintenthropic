"""The jeep: a fictional small open 4x4 of the period (the officer's car):
a flat-sided steel tub with the entry cut into its sides, a flat bonnet over a
barred grille with the headlights set into it, flat-topped mudguards, a
folding windshield in two panes (up), the top folded down on the rear, a
spare wheel and a jerrycan on the back.

Authoring frame (see geo.py): X right, Y forward, Z up. Driver on the left.
"""

import math

import bmesh
import bpy
from mathutils import Vector

from .geo import Builder, T, R, fillet, polyline_normals, solidify, boolean
from .vehicle import Vehicle
from . import wheels as W
from .truck import jerrycan, pumpkin, leaf_spring, pane

RT = W.JEEP_WHEEL["R"]
YF, YR = 1.015, -1.015            # 2.03 m wheelbase
XW = 0.625                        # half track (tyre centre planes)
TUB_W = 0.66                      # half width of the tub
TUB_BACK, COWL = -1.38, 0.55
TUB_BOT, BELT = 0.40, 0.88
FLOOR = 0.44                      # floor (seat.driver's height)
DRIVER = (-0.30, -0.25)
SW_UP, SW_AHEAD, SW_R, SW_TILT = 0.80, 0.38, 0.19, 30.0
WS_Y, WS_Z, WS_H, WS_RAKE = 0.50, 1.00, 0.50, 8.0     # windshield frame base, height, rake (deg)


def model():
    v = Vehicle("jeep", W.JEEP_WHEEL, atlas=1024)
    chassis(v)
    tub(v)
    interior(v)
    bonnet(v)
    fenders(v)
    front_and_rear(v)
    windshield(v)
    top_and_cushions(v)
    wheels_and_sockets(v)
    v.mud_top, v.floor = 0.55, FLOOR
    v.hem, v.shoulder, v.bows = BELT, 9.0, []
    v.recentre()
    v.info = dict(kind="jeep", wheelbase=round(YF - YR, 3), wheel_radius=RT, length=round(v.length, 3))
    return v


def chassis(v):
    b = v.b("body")
    m = "chassis"
    for sx in (-1, 1):
        x0, x1 = (0.30, 0.37) if sx > 0 else (-0.37, -0.30)
        b.box((x0, -1.45, 0.36), (x1, 1.60, 0.47), m)
    for y in (1.50, 0.30, -0.60, -1.40):
        b.box((-0.30, y - 0.03, 0.38), (0.30, y + 0.03, 0.46), m)
    for y in (YF, YR):
        b.cyl((-0.58, y, RT), (0.58, y, RT), 0.045, 8, m, caps=False)
        pumpkin(b, (0.12 if y > 0 else -0.10, y, RT), 0.12, m)
    for sx in (-1, 1):
        for y in (YF, YR):
            leaf_spring(b, sx * 0.34, y - 0.42, y + 0.42, RT + 0.07, 0.035, m, width=0.045, n=7)
    b.box((-0.18, 0.55, 0.36), (0.18, 1.25, 0.66), m)                 # engine sump and block
    b.box((-0.14, -0.10, 0.30), (0.14, 0.55, 0.50), m)                # gearbox and transfer case
    b.cyl((0.0, -0.10, 0.40), (-0.10, YR + 0.10, RT + 0.02), 0.03, 6, m, caps=False)
    b.cyl((0.05, 0.55, 0.40), (0.12, YF - 0.10, RT + 0.02), 0.03, 6, m, caps=False)
    # exhaust along the right rail to a muffler under the rear seat
    b.cyl((0.20, 0.70, 0.50), (0.42, 0.10, 0.36), 0.025, 6, "steel", caps=False)
    b.cyl((0.42, 0.10, 0.36), (0.42, -0.60, 0.36), 0.075, 10, "steel")
    b.cyl((0.42, -0.60, 0.36), (0.50, -1.40, 0.34), 0.022, 6, "steel", caps=False)
    v.socket("fx.exhaust", (0.50, -1.40, 0.34), facing=(0.0, -1.0))


def tub_profile():
    """Side outline of the tub (Y, Z), counter-clockwise from +X: the cowl at
    the front, the beltline dipping into the entry cut-out, the rear."""
    P = [(TUB_BACK, TUB_BOT), (COWL, TUB_BOT), (COWL, 0.99), (0.36, 1.01), (0.30, BELT),
         (0.16, BELT), (0.04, 0.66), (-0.42, 0.66), (-0.56, BELT), (TUB_BACK + 0.03, BELT)]
    return fillet(P, [0, 0, 0.03, 0.04, 0.03, 0.06, 0.08, 0.08, 0.06, 0.03], segs=2)


def tub(v):
    """The tub: the side outline extruded across, edges rounded, the top
    opened (the cowl stays closed), hollowed to 2.5 cm of steel and the
    arches cut for the rear wheels."""
    prof = tub_profile()
    bm = bmesh.new()
    n = len(prof)
    lo = [bm.verts.new((-TUB_W, y, z)) for y, z in prof]
    hi = [bm.verts.new((TUB_W, y, z)) for y, z in prof]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    bm.normal_update()
    edges = [e for e in bm.edges
             if len(e.link_faces) == 2 and any(abs(f.normal.x) > 0.9 for f in e.link_faces)
             and not all(abs(vv.co.z - TUB_BOT) < 1e-4 for vv in e.verts)]
    bmesh.ops.bevel(bm, geom=edges, offset=0.035, offset_type='OFFSET', segments=2, profile=0.5,
                    affect='EDGES', clamp_overlap=True)
    bm.normal_update()
    # open the top: every upward-facing strip behind the cowl
    top = [f for f in bm.faces if f.normal.z > 0.25 and abs(f.normal.x) < 0.9
           and f.calc_center_median().y < 0.31 and f.calc_center_median().z > 0.6]
    bmesh.ops.delete(bm, geom=top, context='FACES_ONLY')
    tmp = Builder("tmp.tub", "jeep", pre=None)
    tmp.add_bmesh(bm, "paint", rand=0.37)
    bm.free()
    col = bpy.context.scene.collection
    shell = tmp.build(col, smooth_angle=40)
    shell.data.materials.append(bpy.data.materials.get("jeep.paint_in") or bpy.data.materials.new("jeep.paint_in"))
    solidify(shell, 0.025, offset=-1.0, inner_mat=1)
    # rear wheel arches, cut through the sides only (the housings close them inside)
    cuts = []
    for sx in (-1, 1):
        c = Builder("tmp.cut", "jeep", pre=None)
        c.cyl((sx * 0.40, YR, RT), (sx * 0.95, YR, RT), RT + 0.075, 20, "paint")
        cuts.append(c.build(col))
    boolean(shell, cuts)
    b = v.b("body")
    b.add_object(shell)
    me = shell.data
    bpy.data.objects.remove(shell)
    bpy.data.meshes.remove(me)
    # wheel-well housings inside the tub over the rear wheels
    s = b.mark()
    ra = RT + 0.075
    b.revolve([(0.40, ra), (TUB_W - 0.02, ra)], 8, "paint_in", M=T(0, YR, RT), a0=0.0, a1=math.pi, rand=0.37)
    pts = [(0.40, YR + ra * math.cos(math.pi * k / 8), RT + ra * math.sin(math.pi * k / 8)) for k in range(9)]
    b.add(pts, [list(range(9))[::-1]], "paint_in")
    b.mirror_x(s)
    # pioneer tools on the left flank, under the entry: a shovel and an axe
    x = -(TUB_W + 0.012)
    b.box((x - 0.012, -0.40, 0.50), (x, 0.30, 0.525), "wood", rand=0.3)          # shovel handle
    b.box((x - 0.016, 0.30, 0.46), (x, 0.52, 0.57), "steel", rand=0.3)           # shovel blade
    b.box((x - 0.012, -0.95, 0.46), (x, -0.45, 0.48), "wood", rand=0.6)          # axe handle
    b.box((x - 0.02, -1.00, 0.44), (x, -0.93, 0.56), "steel", rand=0.6)          # axe head
    for y in (-0.25, 0.20, -0.70):
        b.box((x - 0.02, y - 0.02, 0.44), (x + 0.005, y + 0.02, 0.59), "black")  # straps
    # the officer's radio: a whip antenna on the right rear, its mount and base
    ax_, ay_ = TUB_W - 0.06, TUB_BACK + 0.10
    b.box((ax_ - 0.05, ay_ - 0.05, BELT - 0.08), (ax_ + 0.05, ay_ + 0.05, BELT + 0.02), "steel")
    b.cyl((ax_, ay_, BELT + 0.02), (ax_, ay_, BELT + 0.14), 0.022, 8, "black")
    whip = [(ax_ + 0.02 * (k / 8) ** 2, ay_ - 0.10 * (k / 8) ** 2, BELT + 0.14 + 2.1 * k / 8) for k in range(9)]
    b.sweep(whip, [(0.004 * math.cos(2 * math.pi * k / 4), 0.004 * math.sin(2 * math.pi * k / 4)) for k in range(4)],
            "steel", up=(0, 1, 0), scales=[1.4 - 0.8 * k / 8 for k in range(9)])
    # grab handles on the rear sides and a step under the entry
    for sx in (-1, 1):
        x = sx * (TUB_W + 0.02)
        b.sweep([(x, -1.25, 0.80), (x + sx * 0.03, -1.20, 0.80), (x + sx * 0.03, -1.00, 0.80), (x, -0.95, 0.80)],
                [(0.009 * math.cos(2 * math.pi * k / 5), 0.009 * math.sin(2 * math.pi * k / 5)) for k in range(5)],
                "steel", up=(0, 0, 1))


def interior(v):
    b = v.b("body")
    m = "paint_in"
    # floor: full width ahead of the rear wheel housings, between them further back
    ya = YR + RT + 0.075
    b.box((-TUB_W + 0.03, ya, FLOOR - 0.02), (TUB_W - 0.03, 0.32, FLOOR), m)
    b.box((-0.40, TUB_BACK + 0.03, FLOOR - 0.02), (0.40, ya, FLOOR), m)
    b.add([(-0.60, 0.32, FLOOR), (0.60, 0.32, FLOOR), (0.60, 0.52, 0.70), (-0.60, 0.52, 0.70)], [(0, 1, 2, 3)], m)
    # dash: the cowl's back wall carries the instruments
    b.box((-0.55, 0.32, 0.80), (-0.05, 0.335, 0.94), "black")
    # front bucket seats and the rear bench (cushion tops 0.33 m above the floor)
    dx, dy = DRIVER
    for x in (dx, -dx):
        b.box((x - 0.21, dy - 0.24, FLOOR), (x + 0.21, dy + 0.18, FLOOR + 0.18), m)
        b.box((x - 0.21, -0.10, 0.0), (x + 0.21, -0.07, 0.42), m, M=T(0, dy - 0.16, FLOOR + 0.36) @ R('X', 10))
    b.box((-0.38, -1.33, FLOOR), (0.38, -0.92, FLOOR + 0.18), m)
    b.box((-0.38, -1.36, FLOOR + 0.18), (0.38, -1.34, 0.86), m)
    # steering wheel and column to the contract's numbers
    c = Vector((dx, dy + SW_AHEAD, FLOOR + SW_UP))
    t = math.radians(SW_TILT)
    nrm = Vector((0.0, -math.cos(t), math.sin(t)))
    e1 = Vector((1.0, 0.0, 0.0))
    e2 = nrm.cross(e1).normalized()
    ring = [c + SW_R * (math.cos(2 * math.pi * k / 12) * e1 + math.sin(2 * math.pi * k / 12) * e2) for k in range(12)]
    sec = [(0.013 * math.cos(2 * math.pi * k / 5), 0.013 * math.sin(2 * math.pi * k / 5)) for k in range(5)]
    b.sweep(ring, sec, "black", closed_path=True, up=tuple(nrm))
    for ang in (90, 210, 330):
        a = math.radians(ang)
        p1 = c + (SW_R - 0.01) * (math.cos(a) * e1 + math.sin(a) * e2)
        b.sweep([tuple(c), tuple(p1)], [(-0.011, -0.004), (0.011, -0.004), (0.011, 0.004), (-0.011, 0.004)],
                "black", up=tuple(nrm))
    b.cyl(tuple(c + nrm * 0.02), tuple(c - nrm * 0.05), 0.032, 10, "black")
    b.cyl(tuple(c - nrm * 0.05), tuple(c - nrm * 0.62), 0.02, 8, m, caps=False)
    # pedals ahead of the feet, gear and transfer levers, hand brake
    for x, h in ((dx - 0.14, 0.18), (dx + 0.03, 0.18), (dx + 0.17, 0.10)):
        M = T(x, dy + 0.62, FLOOR + h * 0.6) @ R('X', -35)
        b.box((-0.04, -0.01, -0.045), (0.04, 0.01, 0.045), "black", M=M)
    for x, top, lean in ((-0.06, 0.98, 0.16), (0.04, 0.84, 0.10), (0.09, 0.82, 0.10)):
        p0 = (x, 0.20, FLOOR)
        p1 = (x, 0.20 - lean, top)
        b.cyl(p0, p1, 0.01, 6, "steel", caps=False)
        b.cyl((x, p1[1] - 0.02, top - 0.02), (x, p1[1] + 0.02, top + 0.02), 0.02, 8, "black")


def bonnet_h(y):
    return 0.985 - 0.02 * (y - COWL) / (1.47 - COWL)


def bonnet(v):
    e = v.b("engine")
    rings = []
    for y in (COWL, 1.00, 1.47):
        h = bonnet_h(y)
        sec = fillet([(-0.44, 0.76), (-0.405, h), (0.405, h), (0.44, 0.76)], [0, 0.05, 0.05, 0], segs=3, closed=False)
        rings.append([(x, y, z) for x, z in sec])
    e.loft(rings, "paint", closed=False, rand=0.62)
    for sx in (-1, 1):
        e.box((sx * 0.44 - 0.01, 0.95, 0.84), (sx * 0.44 + 0.01, 1.03, 0.87), "steel")
        e.box((sx * 0.36 - 0.02, 1.40, bonnet_h(1.4)), (sx * 0.36 + 0.02, 1.47, bonnet_h(1.4) + 0.012), "steel")
    # grille panel with its bars and the headlights set into it
    zb, zt = 0.46, 0.97
    e.box((-0.41, 1.47, zb), (0.41, 1.50, zt), "paint", bevel=0.012, rand=0.6)
    e.box((-0.20, 1.50, zb + 0.06), (0.20, 1.503, zt - 0.05), "radiator")
    for i in range(8):
        x = -0.175 + i * 0.05
        e.box((x - 0.011, 1.503, zb + 0.06), (x + 0.011, 1.52, zt - 0.05), "paint", rand=0.6)
    for sx in (-1, 1):
        M = T(sx * 0.30, 1.50, 0.80) @ R('Z', 90)
        e.revolve([(0.0, 0.098), (0.018, 0.098), (0.026, 0.088)], 16, "paint", M=M, rand=0.6)
        e.revolve([(0.026, 0.088), (0.030, 0.06), (0.032, 0.0)], 16, "lens", M=M)
        e.box((sx * 0.30 - 0.04, 1.50, 0.58), (sx * 0.30 + 0.04, 1.515, 0.63), "paint")
        e.box((sx * 0.30 - 0.03, 1.515, 0.588), (sx * 0.30 + 0.03, 1.518, 0.622), "lens")
    # the fenders' aprons close the engine bay's sides
    for sx in (-1, 1):
        x = sx * 0.43
        e.add([(x, COWL, 0.45), (x, 1.47, 0.45), (x, 1.47, 0.77), (x, COWL, 0.77)],
              [(0, 1, 2, 3) if sx > 0 else (3, 2, 1, 0)], "under")
    v.socket("fx.steam", (0.0, 1.44, 1.00))


def fenders(v):
    """Flat-topped mudguards over the front wheels: a rolled front lip, a flat
    top, the rear sweeping down to the tub by the entry."""
    col = bpy.context.scene.collection
    fb = Builder("tmp.fender", "jeep", pre=None)
    P = [(1.56, 0.58), (1.555, 0.78), (1.44, 0.82), (0.74, 0.82), (0.60, 0.70), (0.565, 0.47)]
    path = fillet(P, [0, 0.10, 0.10, 0.10, 0.10, 0], segs=3, closed=False)
    N = polyline_normals(path, outward_sign=-1.0)
    sec = [(0.43, -0.03), (0.44, 0.0), (0.76, 0.0), (0.79, -0.015), (0.795, -0.05)]
    rings = [[(x, y + nn.x * dn, z + nn.y * dn) for x, dn in sec] for (y, z), nn in zip(path, N)]
    fb.loft(rings, "paint", closed=False, flip=True, rand=0.45)
    ob = fb.build(col, smooth_angle=45)
    ob.data.materials.append(bpy.data.materials.get("jeep.under") or bpy.data.materials.new("jeep.under"))
    solidify(ob, 0.01, offset=-1.0, inner_mat=1)
    b = v.b("body")
    s = b.mark()
    b.add_object(ob)
    b.mirror_x(s)
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)


def front_and_rear(v):
    b = v.b("body")
    b.box((-0.78, 1.58, 0.40), (0.78, 1.70, 0.55), "paint", bevel=0.01, rand=0.2)
    for sx in (-1, 1):
        b.box((sx * 0.335 - 0.035, 1.50, 0.40), (sx * 0.335 + 0.035, 1.58, 0.50), "chassis")
        x = sx * 0.50
        pts = [(x + 0.045 * math.cos(math.pi * k / 6), 1.70 + 0.06 * math.sin(math.pi * k / 6), 0.47) for k in range(7)]
        b.sweep(pts, [(0.013 * math.cos(2 * math.pi * k / 5), 0.013 * math.sin(2 * math.pi * k / 5)) for k in range(5)],
                "steel", up=(0, 0, 1))
        # blackout lamps on the fenders' tops, tail lamps on the rear panel
        b.box((sx * 0.70, 1.30, 0.82), (sx * 0.70 + sx * 0.06, 1.37, 0.87), "paint")
        b.box((sx * 0.70 + sx * 0.005, 1.37, 0.83), (sx * 0.70 + sx * 0.055, 1.373, 0.86), "lens")
        b.box((sx * 0.62 - 0.04, TUB_BACK - 0.04, 0.62), (sx * 0.62 + 0.04, TUB_BACK, 0.71), "paint")
        b.box((sx * 0.62 - 0.028, TUB_BACK - 0.043, 0.635), (sx * 0.62 + 0.028, TUB_BACK - 0.04, 0.695), "lamp_red")
        # rear bumperettes
        b.box((sx * 0.62 - 0.08, TUB_BACK - 0.12, 0.40), (sx * 0.62 + 0.08, TUB_BACK, 0.52), "paint")
    b.box((-0.06, TUB_BACK - 0.14, 0.40), (0.06, TUB_BACK, 0.50), "steel")
    # spare wheel on the back (right of centre), jerrycan in its bracket (left)
    v.spares.append(((0.20, TUB_BACK - W.JEEP_WHEEL["half"] - 0.02, 0.70), (0.0, -1.0, 0.0)))
    b.box((0.14, TUB_BACK - 0.02, 0.65), (0.26, TUB_BACK, 0.75), "chassis")
    jerrycan(b, (-0.57, TUB_BACK - 0.185, 0.45), rand=0.15)
    b.box((-0.59, TUB_BACK - 0.20, 0.43), (-0.21, TUB_BACK, 0.45), "chassis")
    b.box((-0.59, TUB_BACK - 0.205, 0.76), (-0.21, TUB_BACK - 0.185, 0.79), "steel")


def windshield(v):
    """The folding windshield (up): a frame of pressed steel in two panes on the
    cowl, raked back a little, hinged at the bottom."""
    b = v.b("body")
    M = T(0, WS_Y, WS_Z) @ R('X', WS_RAKE)
    t = 0.035
    b.box((-0.63, -0.02, 0.0), (0.63, 0.02, t), "paint", M=M, rand=0.8)
    b.box((-0.63, -0.02, WS_H - t), (0.63, 0.02, WS_H), "paint", M=M, rand=0.8)
    for x0, x1 in ((-0.63, -0.63 + t), (0.63 - t, 0.63), (-0.018, 0.018)):
        b.box((x0, -0.02, t), (x1, 0.02, WS_H - t), "paint", M=M, rand=0.8)
    for x in (-0.45, 0.45):
        b.box((x - 0.03, -0.03, WS_H - 0.02), (x + 0.03, 0.0, WS_H + 0.03), "black", M=M)
        Mw = M @ T(x, 0.024, WS_H - 0.02) @ R('Y', 12 if x < 0 else -12)
        b.box((-0.005, 0.0, -0.30), (0.005, 0.01, 0.0), "black", M=Mw)
    for sx in (-1, 1):
        b.box((sx * 0.60 - 0.03, -0.03, -0.02), (sx * 0.60 + 0.03, 0.03, 0.03), "steel", M=M)
        # the folding arms that hold the frame up
        b.box((sx * 0.645 - 0.008, -0.02, 0.05), (sx * 0.645 + 0.008, 0.0, 0.30), "steel", M=M)
    g = v.glass
    for x0, x1 in ((-0.63 + t, -0.018), (0.018, 0.63 - t)):
        pane(g, [(x0, t), (x1, t), (x1, WS_H - t), (x0, WS_H - t)], 0.012,
             lambda u, w: M @ Vector((u, 0.0, w)), flip=True)


def top_and_cushions(v):
    """The canvas top folded on the back and the seat cushions (canvas-covered)."""
    c = v.b("canvas", density=0.8)
    dx, dy = DRIVER
    for x in (dx, -dx):
        c.box((x - 0.20, dy - 0.23, FLOOR + 0.18), (x + 0.20, dy + 0.17, FLOOR + 0.33), "seat", bevel=0.03)
        c.box((x - 0.20, -0.07, 0.0), (x + 0.20, 0.0, 0.40), "seat", M=T(0, dy - 0.16, FLOOR + 0.36) @ R('X', 10),
              bevel=0.025)
    c.box((-0.37, -1.31, FLOOR + 0.18), (0.37, -0.94, FLOOR + 0.33), "seat", bevel=0.03)
    c.box((-0.37, -1.33, FLOOR + 0.36), (0.37, -1.27, 0.84), "seat", bevel=0.02)
    # the top, folded down: canvas bundled over the folded bows on the rear deck,
    # strapped at two points
    c.box((-0.60, TUB_BACK + 0.04, BELT - 0.01), (0.60, TUB_BACK + 0.30, BELT + 0.12), "canvas", bevel=0.05,
          segs=2, rand=0.9)
    for x in (-0.62, 0.62):
        c.box((x - 0.012, TUB_BACK + 0.08, BELT - 0.02), (x + 0.012, TUB_BACK + 0.26, BELT + 0.16), "steel")
    for x in (-0.36, 0.36):
        c.box((x - 0.022, TUB_BACK + 0.035, BELT - 0.012), (x + 0.022, TUB_BACK + 0.305, BELT + 0.125), "rope")


def wheels_and_sockets(v):
    v.wheel(1, (-XW, YF, RT), "L", steer=True)
    v.wheel(2, (XW, YF, RT), "R", steer=True)
    v.wheel(3, (-XW, YR, RT), "L")
    v.wheel(4, (XW, YR, RT), "R")
    v.mud = [(YF, RT, RT), (YR, RT, RT)]
    dx, dy = DRIVER
    v.socket("seat.driver", (dx, dy, FLOOR))
    v.socket("seat.passenger", (-dx, dy, FLOOR))
    for i, x in enumerate((-0.30, 0.30)):
        v.socket(f"seat.rear.{i + 1}", (x * 0.6, -1.10, FLOOR))
