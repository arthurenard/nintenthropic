"""The truck: a fictional mid-century 2.5-ton 6x6 cargo truck with a closed
steel cab, a long bonnet, a wooden cargo bed and a canvas cover over five
bows, the back rolled up and the tailgate lowered so troops can jump out.

Proportions follow the wartime 2.5-ton trucks (4.2 m wheelbase to the rear
bogie, 1.12 m between the rear axles, 7.50-20 tyres, dual rear wheels, a bed
floor 1.15 m up) without copying any one of them.

Authoring frame (see geo.py): X right, Y forward, Z up, ground at Z = 0.
The driver sits on the left (-X here, the vehicle's left).
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .geo import Builder, T, R, fillet, polyline_normals, arclen, solidify, boolean, rng
from .vehicle import Vehicle
from . import wheels as W

# -- layout (metres) ---------------------------------------------------------
RT = W.TRUCK_WHEEL["R"]
YF, YR1, YR2 = 2.35, -1.29, -2.41          # front axle, rear bogie axles
XF, XRD, DUAL = 0.80, 0.86, 0.125          # front wheel plane, rear dual centre, half dual spacing
CAB_W = 0.95                               # half width of the cab
CAB_BACK, CAB_FRONT = 0.30, 1.60
CAB_BOT, ROOF = 0.88, 2.40                 # the cab's lower edge and roof
WS_TOP_Y = 1.445                           # the windshield leans back 7 degrees
RAKE = math.atan2(1.53 - WS_TOP_Y, ROOF - 1.72)
WS_Z0, WS_Z1 = 0.05, 0.60                  # windshield opening, along the glass from its base (1.72)
DW_Z0, DW_Z1 = 1.74, 2.25                  # door windows
RW_Z0, RW_Z1 = 1.88, 2.17                  # rear window
FLOOR = 0.95                               # cab floor (seat.driver's height), on the frame rails
BED_FLOOR = 1.15                           # the contract's bed floor height
BED_Y0, BED_Y1 = -0.02, -3.40              # bed front, bed rear edge
BED_W = 1.11                               # half width of the bed (outer)
HEM = 1.52                                 # canvas hem height
BOWS = [-0.07, -0.90, -1.73, -2.56, -3.37]
DRIVER = (-0.45, 0.64)                     # seat.driver (x, y), on the cab floor
SW_UP, SW_AHEAD, SW_R, SW_TILT = 0.80, 0.38, 0.19, 30.0   # steering wheel (contract)


def model():
    v = Vehicle("truck", W.TRUCK_WHEEL, atlas=2048)
    chassis(v)
    cab(v)
    interior(v)
    bonnet(v)
    fenders(v)
    lights_and_bumpers(v)
    side_gear(v)
    bed(v)
    canvas(v)
    glass(v)
    wheels_and_sockets(v)
    v.mud_top, v.floor, v.bed_floor = 1.05, FLOOR, BED_FLOOR
    v.hem, v.shoulder, v.bows = HEM, 2.44, BOWS
    v.recentre()
    v.info = dict(kind="truck", wheelbase=round(YF - (YR1 + YR2) / 2, 3), wheel_radius=RT,
                  bed_floor=BED_FLOOR, length=round(v.length, 3))
    return v


# ---------------------------------------------------------------------------

def chassis(v):
    b = v.b("body")
    m = "chassis"
    # ladder frame
    for sx in (-1, 1):
        b.box((sx * 0.38 if sx > 0 else -0.46, -3.36, 0.72), (0.46 if sx > 0 else -0.38, 3.10, 0.95), m)
    for y in (3.02, 1.62, 0.20, -0.95, -2.05, -3.28):
        b.box((-0.38, y - 0.04, 0.76), (0.38, y + 0.04, 0.92), m)
    # engine block and gearbox, seen under the fenders
    b.box((-0.30, 1.72, 0.58), (0.30, 2.86, 1.02), m)
    b.box((-0.20, 1.10, 0.62), (0.20, 1.72, 0.92), m)
    b.box((-0.22, -0.05, 0.50), (0.22, 0.45, 0.80), m)          # transfer case
    # front axle: beam, differential, knuckles
    b.box((-0.72, YF - 0.05, RT - 0.05), (0.72, YF + 0.05, RT + 0.05), m)
    pumpkin(b, (0.12, YF, RT), 0.17, m)
    for sx in (-1, 1):
        b.cyl((sx * 0.68, YF, RT - 0.13), (sx * 0.68, YF, RT + 0.13), 0.075, 10, m)
    # rear bogie: axles, differentials, trunnion and inverted springs
    for y in (YR1, YR2):
        b.cyl((-0.72, y, RT), (0.72, y, RT), 0.07, 10, m, caps=False)
        pumpkin(b, (0.0, y, RT), 0.19, m)
    for sx in (-1, 1):
        x = sx * 0.42
        b.box((x - 0.07, -1.85 - 0.16, 0.60), (x + 0.07, -1.85 + 0.16, 0.95), m)
        leaf_spring(b, x, YR2 - 0.05, YR1 + 0.05, 0.60, -0.07, m)
        # front springs (the axle hangs under their middle)
        leaf_spring(b, x, YF - 0.62, YF + 0.62, 0.66, 0.05, m)
        for y in (YF - 0.62, YF + 0.62):
            b.box((x - 0.04, y - 0.04, 0.64), (x + 0.04, y + 0.04, 0.76), m)
    # drive shafts
    b.cyl((0.05, 0.45, 0.66), (0.12, YF - 0.2, RT + 0.02), 0.04, 8, m, caps=False)
    b.cyl((0.0, -0.05, 0.62), (0.0, YR1 + 0.18, RT + 0.03), 0.04, 8, m, caps=False)
    b.cyl((0.0, YR1 - 0.18, RT + 0.03), (0.0, YR2 + 0.18, RT + 0.03), 0.04, 8, m, caps=False)
    # exhaust: pipe from the manifold, muffler under the right door, tail pipe
    b.cyl((0.30, 1.70, 0.80), (0.58, 0.58, 0.66), 0.035, 8, "steel", caps=False)
    b.cyl((0.60, 0.58, 0.66), (0.60, -0.02, 0.66), 0.10, 12, "steel")
    b.cyl((0.60, -0.02, 0.66), (0.86, -0.50, 0.58), 0.033, 8, "steel", caps=False)
    v.socket("fx.exhaust", (0.86, -0.50, 0.58), facing=(0.35, -0.94))


def pumpkin(b, c, r, m):
    """An axle's differential housing: a squashed sphere about the axle."""
    prof = [(-0.55 * r, 0.0), (-0.52 * r, 0.45 * r), (-0.3 * r, 0.85 * r), (0.0, r), (0.3 * r, 0.85 * r),
            (0.5 * r, 0.45 * r), (0.55 * r, 0.0)]
    # revolve about local X, then turn X to point along Y (the housing faces forward)
    b.revolve(prof, 10, m, M=T(*c) @ R('Z', 90) @ Matrix.Diagonal((1.0, 1.0, 0.9, 1.0)))


def leaf_spring(b, x, y0, y1, z, camber, m, width=0.065, n=9):
    """A leaf spring pack: a curved box from y0 to y1, thicker in the middle."""
    path = []
    scales = []
    for i in range(n):
        t = i / (n - 1)
        y = y0 + (y1 - y0) * t
        path.append((x, y, z + camber * (1 - (2 * t - 1) ** 2)))
        scales.append(0.6 + 0.4 * (1 - abs(2 * t - 1)))
    sec = [(-width / 2, -0.04), (width / 2, -0.04), (width / 2, 0.04), (-width / 2, 0.04)]
    b.sweep(path, sec, m, up=(0, 0, 1), scales=scales, caps=True)


# ---------------------------------------------------------------------------

def cab_profile():
    """The cab's side outline (Y, Z), counter-clockwise seen from +X."""
    P = [(CAB_BACK, CAB_BOT), (CAB_FRONT, CAB_BOT), (CAB_FRONT, 1.66), (1.53, 1.72), (WS_TOP_Y, ROOF), (CAB_BACK, ROOF)]
    return fillet(P, [0, 0, 0.03, 0.02, 0.09, 0.13], segs=3)


def cab(v):
    """The cab shell: the side outline extruded across the cab, its side edges
    rounded, hollowed to 3 cm steel, and the windows cut through."""
    prof = cab_profile()
    bm = bmesh.new()
    n = len(prof)
    lo = [bm.verts.new((-CAB_W, y, z)) for y, z in prof]
    hi = [bm.verts.new((CAB_W, y, z)) for y, z in prof]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    bm.normal_update()
    # round the edges where the sides meet the roof, the back and the front
    edges = [e for e in bm.edges
             if len(e.link_faces) == 2 and any(abs(f.normal.x) > 0.9 for f in e.link_faces)
             and not all(abs(vv.co.z - CAB_BOT) < 1e-4 for vv in e.verts)]
    bmesh.ops.bevel(bm, geom=edges, offset=0.075, offset_type='OFFSET', segments=3, profile=0.5,
                    affect='EDGES', clamp_overlap=True)
    bm.normal_update()
    # open the bottom (the floor is a separate plate at FLOOR)
    bottom = [f for f in bm.faces if f.normal.z < -0.9 and all(abs(vv.co.z - CAB_BOT) < 1e-3 for vv in f.verts)]
    bmesh.ops.delete(bm, geom=bottom, context='FACES_ONLY')
    tmp = Builder("tmp.cab", "truck", pre=None)
    tmp.add_bmesh(bm, "paint", rand=0.31)
    bm.free()
    col = bpy.context.scene.collection
    shell = tmp.build(col, smooth_angle=40)
    shell.data.materials.append(bpy.data.materials.get("truck.paint_in") or bpy.data.materials.new("truck.paint_in"))
    solidify(shell, 0.03, offset=-1.0, inner_mat=1)
    cutters = []
    rake = math.degrees(RAKE)
    for sx in (-1, 1):
        c = Builder("tmp.cut", "truck", pre=None)
        x0, x1 = (0.035, 0.86) if sx > 0 else (-0.86, -0.035)
        c.box((x0, -0.25, WS_Z0), (x1, 0.25, WS_Z1), "paint", M=T(0, 1.53, 1.72) @ R('X', rake), bevel=0.035, segs=3)
        cutters.append(c.build(col))
        c = Builder("tmp.cut", "truck", pre=None)
        x0, x1 = (0.80, 1.20) if sx > 0 else (-1.20, -0.80)
        c.box((x0, 0.66, DW_Z0), (x1, 1.30, DW_Z1), "paint", bevel=0.04, segs=3)
        cutters.append(c.build(col))
    c = Builder("tmp.cut", "truck", pre=None)
    c.box((-0.36, 0.10, RW_Z0), (0.36, 0.50, RW_Z1), "paint", bevel=0.035, segs=3)
    cutters.append(c.build(col))
    boolean(shell, cutters)
    b = v.b("body")
    b.add_object(shell)
    me = shell.data
    bpy.data.objects.remove(shell)
    bpy.data.meshes.remove(me)

    # door handles, hinges, a step plate, mirrors and the wipers
    for sx in (-1, 1):
        xo = sx * CAB_W
        b.box((xo, 0.46, 1.60), (xo + sx * 0.025, 0.60, 1.625), "steel")
        for z in (1.25, 1.95):
            b.box((xo, 1.36, z), (xo + sx * 0.018, 1.44, z + 0.09), "paint")
        # mirror: an arm from the windshield pillar and a rectangular head
        arm = [(sx * 0.93, 1.47, 2.02), (sx * 1.06, 1.50, 2.06), (sx * 1.15, 1.51, 2.08)]
        b.sweep(arm, [(-0.008, -0.008), (0.008, -0.008), (0.008, 0.008), (-0.008, 0.008)], "paint", up=(0, 1, 0))
        Mh = T(sx * 1.17, 1.51, 2.02) @ R('Z', sx * -12)
        b.box((-0.07, -0.012, -0.10), (0.07, 0.012, 0.10), "paint", M=Mh)
        b.box((-0.062, -0.016, -0.092), (0.062, -0.012, 0.092), "mirror", M=Mh)
    for x in (-0.46, 0.44):
        # wipers hang from the header (vacuum wipers of the period), in front of the glass
        Mw = T(x, 1.53 - 0.62 * math.tan(RAKE), 1.72 + 0.62) @ R('X', rake) @ R('Y', 14 if x < 0 else -14)
        b.box((-0.006, 0.004, -0.36), (0.006, 0.016, 0.0), "black", M=Mw)
        b.box((-0.03, 0.0, -0.02), (0.03, 0.03, 0.03), "black", M=Mw)


def interior(v):
    b = v.b("body")
    m = "paint_in"
    b.box((-0.92, CAB_BACK + 0.03, FLOOR - 0.03), (0.92, 1.36, FLOOR), m)
    # toe board up to the firewall
    b.add([(-0.92, 1.36, FLOOR), (0.92, 1.36, FLOOR), (0.92, 1.57, 1.32), (-0.92, 1.57, 1.32)], [(0, 1, 2, 3)], m)
    # bench seat: base, cushion (top 0.33 m above the floor), backrest leaning back
    b.box((-0.88, 0.34, FLOOR), (0.88, 0.86, FLOOR + 0.19), m)
    b.box((-0.86, 0.35, FLOOR + 0.19), (0.86, 0.92, FLOOR + 0.33), "seat", bevel=0.04)
    b.box((-0.86, 0.0, 0.0), (0.86, 0.12, 0.60), "seat", M=T(0, 0.37, FLOOR + 0.30) @ R('X', 12), bevel=0.04)
    # dash and instrument panel
    b.box((-0.92, 1.44, 1.50), (0.92, 1.58, 1.71), m)
    b.box((-0.70, 1.432, 1.55), (-0.20, 1.445, 1.68), "black")
    # steering wheel and column to the contract's numbers
    dx, dy = DRIVER
    c = Vector((dx, dy + SW_AHEAD, FLOOR + SW_UP))
    t = math.radians(SW_TILT)
    nrm = Vector((0.0, -math.cos(t), math.sin(t)))          # towards the driver's chest
    e1 = Vector((1.0, 0.0, 0.0))
    e2 = nrm.cross(e1).normalized()                           # in-plane "up" (leans forward)
    ring = [c + SW_R * (math.cos(2 * math.pi * k / 12) * e1 + math.sin(2 * math.pi * k / 12) * e2)
            for k in range(12)]
    sec = [(0.014 * math.cos(2 * math.pi * k / 5), 0.014 * math.sin(2 * math.pi * k / 5)) for k in range(5)]
    b.sweep(ring, sec, "black", closed_path=True, up=tuple(nrm))
    for ang in (90, 210, 330):
        a = math.radians(ang)
        p1 = c + (SW_R - 0.01) * (math.cos(a) * e1 + math.sin(a) * e2)
        b.sweep([tuple(c), tuple(p1)], [(-0.012, -0.004), (0.012, -0.004), (0.012, 0.004), (-0.012, 0.004)],
                "black", up=tuple(nrm))
    b.cyl(tuple(c + nrm * 0.02), tuple(c - nrm * 0.05), 0.035, 10, "black")
    b.cyl(tuple(c - nrm * 0.05), tuple(c - nrm * 0.78), 0.022, 8, "paint_in", caps=False)
    # pedals (clutch, brake, throttle) under the feet 0.45 m ahead of the seat
    for x, h in ((dx - 0.17, 0.20), (dx + 0.02, 0.20), (dx + 0.18, 0.12)):
        M = T(x, dy + 0.58, FLOOR + h * 0.55) @ R('X', -35)
        b.box((-0.045, -0.01, -0.05), (0.045, 0.01, 0.05), "black", M=M)
        b.cyl((x, dy + 0.62, FLOOR + h * 0.55), (x, dy + 0.80, FLOOR + 0.30), 0.01, 5, m, caps=False)
    # gear lever, transfer levers, hand brake
    for x, top, lean in ((-0.08, 1.62, 0.18), (0.02, 1.42, 0.10), (0.08, 1.40, 0.12), (-0.20, 1.35, 0.08)):
        p0 = (x, 1.18, FLOOR)
        p1 = (x + 0.02, 1.18 - lean, top)
        b.cyl(p0, p1, 0.011, 6, "steel", caps=False)
        b.cyl((p1[0], p1[1] - 0.02, p1[2] - 0.02), (p1[0], p1[1] + 0.02, p1[2] + 0.02), 0.022, 8, "black")


# ---------------------------------------------------------------------------

def bonnet_h(y):
    return 1.655 - 0.035 * (y - 1.585) / (2.99 - 1.585)


def bonnet(v):
    e = v.b("engine")
    rings = []
    ys = [1.585, 2.05, 2.52, 2.99]
    for y in ys:
        h = bonnet_h(y)
        sec = fillet([(-0.475, 1.06), (-0.475, h), (0.0, h + 0.012), (0.475, h), (0.475, 1.06)],
                     [0, 0.11, 0, 0.11, 0], segs=4, closed=False)
        rings.append([(x, y, z) for x, z in sec])
    e.loft(rings, "paint", closed=False, rand=0.62)
    # the piano hinge down the middle and the latches on the sides
    path = [(0.0, y, bonnet_h(y) + 0.012) for y in (1.60, 2.98)]
    e.sweep(path, [(-0.014, 0.0), (0.014, 0.0), (0.014, 0.016), (-0.014, 0.016)], "steel", up=(0, 0, 1), caps=True)
    for sx in (-1, 1):
        for y in (1.95, 2.65):
            e.box((sx * 0.475, y - 0.04, 1.22), (sx * 0.49, y + 0.04, 1.26), "steel")
    # radiator shell, core and grille bars
    zb, zt = 0.86, 1.64
    e.box((-0.50, 2.97, zt - 0.09), (0.50, 3.06, zt), "paint", bevel=0.02, rand=0.6)
    e.box((-0.50, 2.97, zb), (0.50, 3.06, zb + 0.08), "paint", rand=0.6)
    for sx in (-1, 1):
        x0, x1 = (0.41, 0.50) if sx > 0 else (-0.50, -0.41)
        e.box((x0, 2.97, zb), (x1, 3.06, zt), "paint", bevel=0.012, rand=0.6)
    e.box((-0.42, 2.92, zb + 0.02), (0.42, 2.975, zt - 0.05), "radiator")
    for i in range(11):
        x = -0.36 + i * 0.072
        e.box((x - 0.012, 2.985, zb + 0.07), (x + 0.012, 3.045, zt - 0.08), "paint", rand=0.6)
    e.box((-0.41, 2.99, 1.235), (0.41, 3.04, 1.265), "paint", rand=0.6)
    # the fenders' inner aprons close the bonnet's sides down to the frame
    for sx in (-1, 1):
        x = sx * 0.47
        e.add([(x, 1.60, 0.90), (x, 2.97, 0.86), (x, 2.97, 1.07), (x, 1.60, 1.07)], [(0, 1, 2, 3) if sx > 0 else (3, 2, 1, 0)],
              "under")
    e.cyl((0.0, 2.93, 1.605), (0.0, 2.93, 1.655), 0.055, 12, "steel")
    v.socket("fx.steam", (0.0, 2.95, 1.70))


def fenders(v):
    """Front fenders swept over the wheels (an arch with a crowned section and a
    rolled outer skirt), thickened so their undersides take their own mud."""
    col = bpy.context.scene.collection
    fb = Builder("tmp.fender", "truck", pre=None)
    path = []
    for i in range(13):
        ph = math.radians(18 + (142 - 18) * i / 12)
        path.append((YF + 0.66 * math.cos(ph), RT + 0.62 * math.sin(ph)))
    path.append((1.72, 0.80))
    path.append((1.56, 0.80))
    N = polyline_normals(path, outward_sign=-1.0)
    # section: inner edge by the bonnet, crown, rolled outer skirt
    sec = [(0.50, -0.05), (0.51, 0.0), (0.70, 0.03), (0.90, 0.02), (0.99, -0.01), (1.02, -0.05), (1.025, -0.10)]
    rings = []
    for (y, z), nn in zip(path, N):
        rings.append([(x, y + nn.x * dn, z + nn.y * dn) for x, dn in sec])
    fb.loft(rings, "paint", closed=False, flip=True, rand=0.45)
    ob = fb.build(col, smooth_angle=45)
    ob.data.materials.append(bpy.data.materials.get("truck.under") or bpy.data.materials.new("truck.under"))
    solidify(ob, 0.012, offset=-1.0, inner_mat=1)
    b = v.b("body")
    s = b.mark()
    b.add_object(ob)
    b.mirror_x(s)
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    # running boards and their brackets
    s = b.mark()
    b.box((0.70, 0.30, 0.78), (1.06, 1.60, 0.82), "paint", rand=0.4)
    for y in (0.45, 1.35):
        b.box((0.46, y - 0.03, 0.72), (0.72, y + 0.03, 0.80), "chassis")
    b.mirror_x(s)


def lights_and_bumpers(v):
    b = v.b("body")
    # front bumper: a heavy channel with two tow shackles
    b.box((-1.05, 3.10, 0.60), (1.05, 3.30, 0.84), "paint", bevel=0.012, rand=0.2)
    for x in (-0.46, 0.46):
        pts = []
        for k in range(9):
            a = math.pi * k / 8
            pts.append((x + 0.055 * math.cos(a), 3.30 + 0.07 * math.sin(a), 0.68))
        b.sweep(pts, [(0.016 * math.cos(2 * math.pi * k / 6), 0.016 * math.sin(2 * math.pi * k / 6)) for k in range(6)],
                "steel", up=(0, 0, 1))
    # headlights on stalks beside the grille, blackout lamps on the fenders
    for sx in (-1, 1):
        x = sx * 0.72
        b.cyl((x, 2.88, 0.80), (x, 2.90, 1.10), 0.022, 8, "paint", caps=False)
        prof = [(-0.10, 0.0), (-0.10, 0.05), (-0.06, 0.095), (0.02, 0.112), (0.045, 0.118), (0.055, 0.108)]
        M = T(x, 2.92, 1.18) @ R('Z', 90)
        b.revolve(prof, 16, "paint", M=M, rand=0.3)
        b.revolve([(0.055, 0.108), (0.062, 0.07), (0.066, 0.0)], 16, "lens", M=M)
        b.box((sx * 0.80, 2.50, 1.07), (sx * 0.90, 2.60, 1.13), "paint")
        b.box((sx * 0.815, 2.598, 1.08), (sx * 0.885, 2.605, 1.12), "lens")
    # rear: crossmember, bumperettes, pintle hook and tail lamps below the
    # hanging tailgate; mud flaps behind the bogie
    b.box((-0.95, -3.38, 0.82), (0.95, -3.32, 1.02), "chassis")
    for sx in (-1, 1):
        x0, x1 = (0.50, 0.84) if sx > 0 else (-0.84, -0.50)
        b.box((x0, -3.47, 0.58), (x1, -3.37, 0.77), "paint")
        b.box((x0, -3.40, 0.70), (x1, -3.34, 0.84), "chassis")
        b.box((sx * 0.95 - 0.05, -3.44, 0.62), (sx * 0.95 + 0.05, -3.38, 0.73), "paint")
        b.box((sx * 0.95 - 0.035, -3.446, 0.635), (sx * 0.95 + 0.035, -3.44, 0.715), "lamp_red")
        x0, x1 = (0.62, 1.08) if sx > 0 else (-1.08, -0.62)
        b.box((x0, -3.00, 0.30), (x1, -2.985, 1.02), "black", rand=0.8)
    b.box((-0.07, -3.53, 0.60), (0.07, -3.44, 0.72), "steel")


def side_gear(v):
    b = v.b("body")
    # fuel tank under the driver's door, battery box under the co-driver's
    b.box((-0.94, 0.42, 0.50), (-0.62, 1.22, 0.77), "paint", bevel=0.06, segs=2, rand=0.7)
    b.cyl((-0.80, 0.80, 0.77), (-0.80, 0.80, 0.80), 0.04, 10, "steel")
    b.box((0.62, 0.95, 0.52), (0.94, 1.45, 0.76), "paint", rand=0.55)
    # tool box under the bed, left
    b.box((-1.04, -0.78, 0.64), (-0.62, -0.18, 1.00), "paint", rand=0.25)
    for y in (-0.62, -0.34):
        b.box((-1.052, y - 0.03, 0.90), (-1.04, y + 0.03, 0.96), "steel")
    # jerrycans in a rack behind the cab (right), the spare wheel (left)
    for i, x in enumerate((0.28, 0.63)):
        jerrycan(b, (x, 0.06, 0.98), rand=0.1 + i * 0.3)
    b.box((0.20, 0.03, 0.95), (1.00, 0.26, 0.98), "chassis")
    b.box((0.20, 0.03, 1.28), (1.00, 0.05, 1.31), "steel")
    b.box((-0.90, 0.03, 0.95), (-0.18, 0.26, 0.98), "chassis")
    v.spares.append(((-0.55, 0.145, 0.97 + RT), (0.0, 1.0, 0.0)))


def jerrycan(b, lo, rand=0.2, w=0.34, d=0.165, h=0.47):
    """A pressed-steel fuel can standing upright, handles on top."""
    x, y, z = lo
    b.box((x, y, z), (x + w, y + d, z + h - 0.04), "paint", bevel=0.015, rand=rand)
    b.box((x + 0.015, y + 0.012, z + h - 0.04), (x + w - 0.015, y + d - 0.012, z + h - 0.02), "paint", rand=rand)
    for i in range(3):
        cx = x + 0.07 + i * 0.1
        b.box((cx - 0.012, y + d / 2 - 0.012, z + h - 0.02), (cx + 0.012, y + d / 2 + 0.012, z + h), "paint", rand=rand)
    b.cyl((x + w - 0.05, y + d / 2, z + h - 0.02), (x + w - 0.05, y + d / 2, z + h + 0.02), 0.02, 8, "paint", rand=rand)


# ---------------------------------------------------------------------------

def bed(v):
    b = v.b("bed", density=0.9)
    y0, y1 = BED_Y1, BED_Y0
    b.box((-1.07, y0, BED_FLOOR - 0.05), (1.07, y1, BED_FLOOR), "wood", rand=0.11)
    s = b.mark()
    b.box((0.34, y0, 0.95), (0.50, y1, BED_FLOOR - 0.05), "chassis")
    b.box((1.07, y0, 1.02), (BED_W, y1, 1.63), "wood", rand=0.23)
    b.box((1.05, y0, 1.63), (BED_W + 0.012, y1, 1.66), "paint")
    for y in (-0.10, -0.80, -1.50, -2.20, -2.90, -3.36):
        b.box((BED_W, y - 0.03, 1.02), (BED_W + 0.02, y + 0.03, HEM + 0.02), "paint", rand=0.4)
    # troop bench (top 0.33 m above the bed floor) and its legs, the rack behind
    b.box((0.72, -3.25, BED_FLOOR + 0.30), (1.04, -0.25, BED_FLOOR + 0.33), "wood", rand=0.5)
    for y in (-0.35, -1.10, -1.85, -2.60, -3.15):
        b.box((0.74, y - 0.02, BED_FLOOR), (0.78, y + 0.02, BED_FLOOR + 0.30), "wood")
    for z in (1.72, 1.97):
        b.box((1.035, -3.32, z), (1.065, -0.12, z + 0.09), "wood", rand=0.66)
    for y in BOWS:
        b.box((1.035, y - 0.03, 1.63), (1.065, y + 0.03, 2.30), "wood")
    b.mirror_x(s)
    for y in (-0.25, -0.85, -1.45, -2.05, -2.65, -3.25):
        b.box((-1.07, y - 0.035, 1.02), (1.07, y + 0.035, BED_FLOOR - 0.05), "chassis")
    # front bulkhead and the lowered tailgate hanging from its hinges
    b.box((-BED_W, -0.06, 1.02), (BED_W, y1, 1.63), "wood", rand=0.77)
    b.box((-1.05, y0 - 0.045, 0.80), (1.05, y0 - 0.005, BED_FLOOR - 0.02), "wood", rand=0.88)
    for x in (-0.80, 0.80):
        b.box((x - 0.05, y0 - 0.05, 0.80), (x + 0.05, y0 - 0.045, BED_FLOOR - 0.02), "steel")
        b.cyl((x - 0.08, y0 - 0.02, BED_FLOOR - 0.02), (x + 0.08, y0 - 0.02, BED_FLOOR - 0.02), 0.018, 8, "steel")
    # bows: flat wooden bows just inside the canvas
    prof = canvas_profile(inset=0.03, step=0.6, segs=2)
    for y in BOWS:
        path = [(x, y, z) for x, z in prof]
        b.sweep(path, [(-0.025, -0.012), (0.025, -0.012), (0.025, 0.012), (-0.025, 0.012)], "wood",
                up=(0, 1, 0), caps=True)


def canvas_profile(inset=0.0, step=0.30, segs=3):
    """The cover's cross-section (X, Z) from the left hem over the roof to the
    right hem: vertical sides, a chamfered rounded shoulder, a crowned roof."""
    w = 1.13 - inset
    P = [(-w, HEM), (-w, 2.50 - inset * 0.3), (-0.86 + inset * 0.3, 2.79 - inset), (0.0, 2.815 - inset),
         (0.86 - inset * 0.3, 2.79 - inset), (w, 2.50 - inset * 0.3), (w, HEM)]
    pts = fillet(P, [0, 0.16, 0.3, 0, 0.3, 0.16, 0], segs=segs, closed=False)
    # resample: sides coarse, shoulders fine (they carry the silhouette)
    out = [pts[0]]
    for p in pts[1:]:
        last = Vector(out[-1])
        d = (Vector(p) - last).length
        steps = max(1, int(round(d / step)))
        for k in range(1, steps + 1):
            q = last + (Vector(p) - last) * (k / steps)
            out.append((q.x, q.y))
    # drop points closer than 4 cm (fillet ends that sit on top of each other)
    clean = [out[0]]
    for p in out[1:]:
        if (Vector(p) - Vector(clean[-1])).length > 0.05:
            clean.append(p)
    return clean


def canvas(v):
    """The cover: lofted along the bed with a sag between the bows (most on the
    roof, least down the sides), the hem pulled down at every tie point and
    scalloped between, the front closed, the back rolled up on the last bow."""
    r = rng("canvas")
    prof = canvas_profile()
    N = polyline_normals(prof, outward_sign=1.0)
    ys = []
    front = BED_Y0 + 0.01
    spans = [front] + BOWS[1:]
    ys.append(front)
    for i in range(len(spans) - 1):
        a, bb = spans[i], spans[i + 1]
        for k in range(1, 4):
            ys.append(a + (bb - a) * k / 3)
    ys.append(BED_Y1 - 0.015)
    bows = [front] + BOWS[1:]

    def sag_t(y):
        for i in range(len(bows) - 1):
            a, bb = bows[i], bows[i + 1]
            if bb <= y <= a:
                return math.sin(math.pi * (a - y) / (a - bb))
        return 0.0

    rings = []
    for ri, y in enumerate(ys):
        st = sag_t(y)
        ring = []
        for (x, z), nn in zip(prof, N):
            roof = max(0.0, min(1.0, (z - 2.35) / 0.4))
            k = 0.018 + 0.035 * roof            # sag depth where the cover spans the widest
            if z < HEM + 0.25:
                k *= (z - HEM) / 0.25
            d = -k * st + r.uniform(-0.004, 0.004) * st
            px, pz = x + nn.x * d, z + nn.y * d
            if z <= HEM + 1e-4:
                # the hem: pulled down at the ties (every other ring), lifting
                # and bellying out between them
                ph = 0.0 if ri % 2 == 0 or ri == len(ys) - 1 else 1.0
                pz += 0.035 * ph
                px += math.copysign(0.012 * ph, x)
            ring.append((px, y, pz))
        rings.append(ring)
    col = bpy.context.scene.collection
    cb = Builder("tmp.canvas", "truck", pre=None)
    cb.loft(rings, "canvas", closed=False, flip=True, rand=0.5)
    # front curtain: the profile closed across the front
    f = rings[0]
    cb.add(f, [list(range(len(f)))], "canvas", rand=0.5)
    ob = cb.build(col, smooth_angle=60)
    ob.data.materials.append(bpy.data.materials.get("truck.canvas_in") or bpy.data.materials.new("truck.canvas_in"))
    solidify(ob, 0.012, offset=-1.0, inner_mat=1)
    c = v.b("canvas", density=0.85)
    c.add_object(ob)
    me = ob.data
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    # the rear curtain rolled up under the roof
    yb = BED_Y1 - 0.06
    roll = [(x, yb, z - 0.10) for x, z in canvas_profile(inset=0.0) if z > 2.45]
    sec = [(0.075 * math.cos(2 * math.pi * k / 8), 0.075 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
    c.sweep(roll, sec, "canvas", up=(0, 1, 0), caps=True, rand=0.9)
    # lashing ropes: from each tie point on the hem down to a hook on the bed side
    for ri in range(2, len(ys) - 1, 2):
        y = ys[ri]
        for sx in (-1, 1):
            p0 = (sx * (1.13 + 0.004), y, HEM + 0.01)
            p1 = (sx * (BED_W + 0.03), y, 1.30)
            c.sweep([p0, p1], [(-0.007, -0.007), (0.007, -0.007), (0.007, 0.007), (-0.007, 0.007)], "rope", up=(0, 1, 0))
            v.b("bed").box((sx * BED_W - 0.0 if sx > 0 else sx * BED_W - 0.025, y - 0.02, 1.27),
                           (sx * BED_W + 0.025 if sx > 0 else sx * BED_W, y + 0.02, 1.30), "steel")


# ---------------------------------------------------------------------------

def glass(v):
    """cab.glass: the two windshield panes, the door windows and the rear
    window, a centimetre inside the openings. Each pane has its own 0..1 UVs
    (the game can place a crack texture by hit point)."""
    g = v.glass
    M = T(0, 1.53, 1.72) @ Matrix.Rotation(RAKE, 4, 'X') @ T(0, -0.015, 0)
    for sx in (-1, 1):
        x0, x1 = (0.035, 0.86) if sx > 0 else (-0.86, -0.035)
        pane(g, [(x0, WS_Z0), (x1, WS_Z0), (x1, WS_Z1), (x0, WS_Z1)], 0.035,
             lambda u, w: M @ Vector((u, 0.0, w)), flip=True)
        xo = sx * (CAB_W - 0.015)
        pane(g, [(0.66, DW_Z0), (1.30, DW_Z0), (1.30, DW_Z1), (0.66, DW_Z1)], 0.04,
             lambda u, w, xo=xo: Vector((xo, u, w)), flip=sx < 0)
    pane(g, [(-0.36, RW_Z0), (0.36, RW_Z0), (0.36, RW_Z1), (-0.36, RW_Z1)], 0.035,
         lambda u, w: Vector((u, CAB_BACK + 0.015, w)), flip=False)


def pane(g, rect, r, to3d, flip=False):
    """A rounded-corner pane from a rectangle in its own (u, w) plane; the
    natural normal is u x w, flip turns it to face outward."""
    pts = fillet(rect, [r] * 4, segs=3)
    xs = [p[0] for p in pts]
    ws = [p[1] for p in pts]
    u0, u1, w0, w1 = min(xs), max(xs), min(ws), max(ws)
    verts = [to3d(u, w) for u, w in pts]
    uv = [((u - u0) / (u1 - u0), (w - w0) / (w1 - w0)) for u, w in pts]
    f = list(range(len(pts)))
    if flip:
        f.reverse()
        uv = list(reversed(uv))
    g.add(verts, [f], "glass", [uv], rand=0.5)


def wheels_and_sockets(v):
    v.wheel(1, (-XF, YF, RT), "L", steer=True)
    v.wheel(2, (XF, YF, RT), "R", steer=True)
    v.wheel(3, (-XRD, YR1, RT), "L", dual=DUAL)
    v.wheel(4, (XRD, YR1, RT), "R", dual=DUAL)
    v.wheel(5, (-XRD, YR2, RT), "L", dual=DUAL)
    v.wheel(6, (XRD, YR2, RT), "R", dual=DUAL)
    v.mud = [(YF, RT, RT), (YR1, RT, RT), (YR2, RT, RT)]
    dx, dy = DRIVER
    v.socket("seat.driver", (dx, dy, FLOOR))
    v.socket("seat.passenger", (-dx, dy, FLOOR))
    # dismount: on the ground behind the tailgate, facing away from the truck;
    # the clip's feet start 1.15 m up and 0.55 m back: the bed floor's edge
    for i, x in enumerate((-0.75, -0.25, 0.25, 0.75)):
        v.socket(f"dismount.{i + 1}", (x, BED_Y1 - 0.55, 0.0), facing=(0.0, -1.0))
    # troop seats on the benches (same convention as seat.driver: the root on
    # the bed floor under the hips, facing across the bed)
    n = 1
    for sx in (-1, 1):
        for y in (-0.55, -1.25, -1.95, -2.65):
            v.socket(f"bed.seat.{n}", (sx * 0.87, y, BED_FLOOR), facing=(-sx, 0.0))
            n += 1
