"""West of the road: the Miller farm. A red gambrel barn with its doors to
the road, a concrete stave silo, a windmill against the sky, and in the
corn the scarecrow (a secret: its head turns to follow the beam).

Bake groups: 'far' (barn, silo, windmill), 'west' (the scarecrow).
"""

import math

import bpy
from mathutils import Vector, Matrix

from .common import rng, tag, DC
from . import layout as L, meshkit as K
from .meshkit import MeshBuilder, Frame
from .ground import ground_z


def gambrel(width, eave, knee, ridge, knee_in):
    """Profile (y, z) of a gambrel gable, left to right."""
    h = width / 2
    return [(-h, 0.0), (-h, eave), (-h + knee_in, knee), (0.0, ridge), (h - knee_in, knee), (h, eave), (h, 0.0)]


def top_at(prof, u):
    for (u0, z0), (u1, z1) in zip(prof[1:-2], prof[2:-1]):
        if u0 <= u <= u1:
            t = (u - u0) / max(u1 - u0, 1e-9)
            return z0 + (z1 - z0) * t
    return prof[1][1]


def siding(mb, f, u0, u1, top, mat, r, batten='barn_trim', holes=()):
    """Vertical boards (0.3 m) with battens over the joints, from the ground
    up to top(u); `holes` (u0, u1, z0, z1) left open (doors, windows)."""
    u = u0
    while u < u1 - 1e-4:
        w = min(0.3, u1 - u)
        uc = u + w / 2
        zt = top(uc)
        segs = [(0.0, zt)]
        for (a, b, z0, z1) in holes:
            if a < uc < b:
                new = []
                for (s0, s1) in segs:
                    if z1 <= s0 or z0 >= s1:
                        new.append((s0, s1))
                        continue
                    if z0 > s0:
                        new.append((s0, z0))
                    if z1 < s1:
                        new.append((z1, s1))
                segs = new
        for (s0, s1) in segs:
            if s1 - s0 > 0.02:
                mb.box(f, (u, -0.025, s0), (u + w - 0.004, 0.0, s1), mat, grain_axis=2, skip=('+y',))
        if w > 0.1 and r.random() < 0.9:
            for (s0, s1) in segs:
                if s1 - s0 > 0.02:
                    mb.box(f, (u + w - 0.03, -0.045, s0), (u + w + 0.03, -0.025, s1), mat, grain_axis=2, skip=('+y',))
        u += w


def barn(lib, col):
    r = rng("barn")
    cx, cy = L.BARN
    z = ground_z(cx, cy)
    width, depth = 12.0, 16.0
    eave, knee, ridge, knee_in = 4.2, 7.4, 9.8, 2.1
    prof = gambrel(width, eave, knee, ridge, knee_in)
    mb = MeshBuilder("barn.walls")
    trim = MeshBuilder("barn.trim")
    roof = MeshBuilder("barn.roof")
    dark = MeshBuilder("barn.dark")
    # the east gable (doors to the road): frame whose local -Y faces east
    fe = Frame((cx + depth / 2, cy, z), math.pi / 2)
    fw = Frame((cx - depth / 2, cy, z), -math.pi / 2)
    top = lambda u: top_at(prof, u)
    door = (-2.2, 2.2, 0.0, 4.0)
    loft = (-1.0, 1.0, 5.4, 7.0)
    siding(mb, fe, -width / 2, width / 2, top, 'barn_red', r, holes=[door, loft])
    siding(mb, fw, -width / 2, width / 2, top, 'barn_red', r, holes=[(-1.0, 1.0, 0.0, 2.6)])
    # long walls: south (faces the player's side) and north
    fs = Frame((cx, cy - width / 2, z), 0.0)
    fn = Frame((cx, cy + width / 2, z), math.pi)
    wins = [(-5.0, -4.0, 1.6, 2.6), (-0.5, 0.5, 1.6, 2.6), (4.0, 5.0, 1.6, 2.6)]
    siding(mb, fs, -depth / 2, depth / 2, lambda u: eave, 'barn_red', r, holes=wins)
    siding(mb, fn, -depth / 2, depth / 2, lambda u: eave, 'barn_red', r)
    # the doors: two leaves slid half open, white Z-braces; the dark inside
    for s, off in ((-1, -0.6), (1, 1.4)):
        a, b = (door[0], 0.0) if s < 0 else (0.0, door[1])
        a += off
        b += off
        trim.box(fe, (a, -0.12, 0.05), (b, -0.07, 4.0), 'barn_red', grain_axis=2)
        for (p, q) in (((a, 0.1), (b, 0.1)), ((a, 3.9), (b, 3.9)), ((a, 0.1), (b, 3.9)), ((a, 2.0), (b, 2.0))):
            trim.board(fe, (p[0], -0.13, p[1]), (q[0], -0.13, q[1]), 0.14, 0.03, 'barn_trim', up=(0, -1, 0))
    trim.box(fe, (-3.0, -0.15, 4.05), (3.4, -0.08, 4.25), 'iron_dark')
    dark.box(fe, (-2.2, 0.5, 0.0), (2.2, 0.55, 4.0), 'black_void')
    dark.box(fe, (-1.0, 0.3, 5.4), (1.0, 0.35, 7.0), 'black_void')
    # hayloft door hanging open on one hinge, the hay hood above
    hf = fe.sub((1.0, -0.1, 5.4), rot_z=math.radians(-100))
    trim.box(hf, (0.0, 0.0, 0.0), (1.0, 0.05, 1.6), 'barn_red', grain_axis=2)
    trim.box(fe, (-0.4, -1.4, ridge - 0.9), (0.4, 0.0, ridge - 0.7), 'barn_red')
    for (a, b, z0, z1) in wins:
        trim.box(fs, (a - 0.08, -0.06, z0 - 0.08), (b + 0.08, -0.03, z1 + 0.08), 'barn_trim')
        dark.box(fs, (a, 0.02, z0), (b, 0.05, z1), 'black_void')
    # trim round the gables
    for f in (fe, fw):
        pts = prof[1:-1]
        for (u0, z0), (u1, z1) in zip(pts[:-1], pts[1:]):
            trim.board(f, (u0, -0.06, z0), (u1, -0.06, z1), 0.22, 0.04, 'barn_trim', up=(0, -1, 0))
        for u in (-width / 2, width / 2):
            trim.box(f, (u - 0.12, -0.07, 0.0), (u + 0.12, -0.03, eave), 'barn_trim')
    # the roof: tin on the four gambrel planes, a little overhang
    ov = 0.45
    segs = list(zip(prof[1:-2], prof[2:-1]))
    for (u0, z0), (u1, z1) in segs:
        du, dz = u1 - u0, z1 - z0
        L_ = math.hypot(du, dz)
        nu, nz = -dz / L_, du / L_
        ext0 = (u0 - (du / L_) * (ov if abs(u0) >= width / 2 - 1e-3 else 0.0), z0 - (dz / L_) * (ov if abs(u0) >= width / 2 - 1e-3 else 0.0))
        ext1 = (u1 + (du / L_) * (ov if abs(u1) >= width / 2 - 1e-3 else 0.0), z1 + (dz / L_) * (ov if abs(u1) >= width / 2 - 1e-3 else 0.0))
        a0 = Vector((cx - depth / 2 - 0.3, cy + ext0[0] + nu * 0.08, z + ext0[1] + nz * 0.08))
        a1 = Vector((cx + depth / 2 + 0.3, cy + ext0[0] + nu * 0.08, z + ext0[1] + nz * 0.08))
        b1 = Vector((cx + depth / 2 + 0.3, cy + ext1[0] + nu * 0.08, z + ext1[1] + nz * 0.08))
        b0 = Vector((cx - depth / 2 - 0.3, cy + ext1[0] + nu * 0.08, z + ext1[1] + nz * 0.08))
        quad = [a0, a1, b1, b0]
        nrm = (a1 - a0).cross(b0 - a0)
        if nrm.z < 0:
            quad = quad[::-1]
        roof.add_face([tuple(p) for p in quad], 'tin_roof', r.random(), [(0, 0), (depth, 0), (depth, L_), (0, L_)])
        roof.add_face([tuple(p - Vector((0, 0, 0.03))) for p in quad[::-1]], 'barn_grey', r.random())
    # ridge cupola
    cf = Frame((cx, cy, z + ridge), 0.0)
    trim.box(cf, (-0.8, -0.8, -0.2), (0.8, 0.8, 1.2), 'barn_trim')
    dark.box(cf, (-0.82, -0.5, 0.2), (0.82, 0.5, 0.9), 'black_void')
    K.lathe(roof, cf.sub((0, 0, 1.2)), [(1.15, 0.0), (0.6, 0.45), (0.0, 0.85)], 'tin_roof', seg=4)
    trim.cylinder(cf, (0, 0, 2.0), 0.02, 1.0, 'iron_dark', segments=6)
    K.emit(mb, col, lib, 'far', 'wood')
    K.emit(trim, col, lib, 'far', 'wood')
    K.emit(roof, col, lib, 'far', 'metal')
    K.emit(dark, col, lib, 'far', 'wood')


def silo(lib, col):
    sx, sy = L.SILO
    z = ground_z(sx, sy)
    mb = MeshBuilder("silo")
    rad, h = 2.6, 15.5
    prof = [(rad + 0.1, -0.3), (rad + 0.1, 0.4), (rad, 0.45)]
    for k in range(1, 16):
        zz = k * h / 16
        prof += [(rad, zz - 0.04), (rad + 0.035, zz), (rad, zz + 0.04)]
    prof += [(rad, h)]
    K.lathe(mb, Frame((sx, sy, z)), prof, 'silo_concrete', seg=28, cap_top=False)
    dome = MeshBuilder("silo.dome")
    dp = [(rad + 0.15, 0.0)] + [(rad * math.cos(math.radians(a)) + 0.1, rad * 0.55 * math.sin(math.radians(a))) for a in range(10, 91, 10)]
    K.lathe(dome, Frame((sx, sy, z + h)), dp, 'tin_roof', seg=28)
    # the chute and the ladder cage on the road side
    ch = MeshBuilder("silo.chute")
    ang = math.radians(-60)
    cxv = Vector((math.cos(ang), math.sin(ang), 0))
    base = Vector((sx, sy, z)) + cxv * (rad + 0.35)
    ch.box(Frame(base, ang + math.pi / 2), (-0.35, -0.3, 0.0), (0.35, 0.3, h + 0.3), 'barn_red')
    for k in range(40):
        p = base + cxv * 0.45 + Vector((0, 0, 0.3 + k * 0.38))
        ch.cylinder(Frame(p, ang), (-0.25, 0, 0), 0.012, 0.5, 'iron_dark', segments=5, axis='X')
    K.emit(mb, col, lib, 'far', 'asphalt', smooth_angle=40)
    K.emit(dome, col, lib, 'far', 'metal', smooth_angle=40)
    K.emit(ch, col, lib, 'far', 'wood')


def windmill(lib, col):
    r = rng("windmill")
    wx, wy = L.WINDMILL
    z = ground_z(wx, wy)
    mb = MeshBuilder("windmill")
    H = 12.5
    b0, b1 = 1.6, 0.35
    legs = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        a = Vector((wx + sx * b0, wy + sy * b0, z - 0.2))
        b = Vector((wx + sx * b1, wy + sy * b1, z + H))
        K.tube(mb, [a, b], 0.05, 'windmill_metal', sides=5)
        legs.append((a, b))
    for k in range(6):
        t0, t1 = k / 6, (k + 1) / 6
        for i in range(4):
            a0 = legs[i][0].lerp(legs[i][1], t0)
            b1_ = legs[(i + 1) % 4][0].lerp(legs[(i + 1) % 4][1], t1)
            a1 = legs[i][0].lerp(legs[i][1], t1)
            b0_ = legs[(i + 1) % 4][0].lerp(legs[(i + 1) % 4][1], t0)
            K.tube(mb, [a0, b1_], 0.018, 'windmill_metal', sides=4)
            K.tube(mb, [b0_, a1], 0.018, 'windmill_metal', sides=4)
            K.tube(mb, [a1, legs[(i + 1) % 4][0].lerp(legs[(i + 1) % 4][1], t1)], 0.022, 'windmill_metal', sides=4)
    # platform, head, wheel and tail, the wheel facing south-east (to the wind)
    head = Vector((wx, wy, z + H + 0.3))
    mb.box(Frame(head - Vector((0, 0, 0.35)), 0.0), (-0.9, -0.9, 0.0), (0.9, 0.9, 0.06), 'plank_dark')
    yaw = math.radians(40)
    hf = Frame(head, yaw)
    mb.box(hf, (-0.18, -0.4, -0.15), (0.18, 0.5, 0.2), 'windmill_metal')
    wf = hf.sub((0, -0.5, 0.05), rot_x=math.pi / 2)
    for k in range(18):
        a = 2 * math.pi * k / 18
        p0 = wf.p(0.35 * math.cos(a), 0.35 * math.sin(a), 0.0)
        p1 = wf.p(1.55 * math.cos(a), 1.55 * math.sin(a), 0.0)
        side = wf.d(-math.sin(a), math.cos(a), 0.0) * 0.12
        tilt = wf.d(0, 0, 1) * 0.05
        mb.add_face([tuple(p0 - side * 0.5 - tilt), tuple(p1 - side - tilt), tuple(p1 + side + tilt), tuple(p0 + side * 0.5 + tilt)],
                    'windmill_metal', r.random())
    K.tube(mb, [wf.p(1.1 * math.cos(2 * math.pi * k / 24), 1.1 * math.sin(2 * math.pi * k / 24), 0.02) for k in range(24)], 0.015,
           'windmill_metal', sides=4, closed=True)
    K.tube(mb, [wf.p(1.55 * math.cos(2 * math.pi * k / 24), 1.55 * math.sin(2 * math.pi * k / 24), 0.02) for k in range(24)], 0.015,
           'windmill_metal', sides=4, closed=True)
    tail = hf.sub((0, 0.5, 0.0))
    K.tube(mb, [tail.p(0, 0, 0), tail.p(0, 1.6, 0.1)], 0.03, 'windmill_metal', sides=5)
    mb.box(tail, (-0.01, 1.4, -0.35), (0.01, 2.6, 0.55), 'windmill_metal')
    K.emit(mb, col, lib, 'far', 'metal')


def scarecrow(lib, col):
    """On a tall pole in the corn, facing the road: a stuffed plaid shirt on
    a crossbar, trousers hanging, straw at the cuffs, a sack head with a
    stitched face under a hat. The head is its own node on a pivot at the
    neck (secret.scarecrow.head), parented to the body (secret.scarecrow)."""
    r = rng("scarecrow")
    sx, sy = L.SCARECROW
    z = ground_z(sx, sy)
    face_dir = Vector((1.0, -0.35, 0.0)).normalized()     # toward the road, a little toward the player
    ang = math.atan2(face_dir.y, face_dir.x) - (-math.pi / 2)
    f = Frame((sx, sy, z), ang)          # local -Y faces face_dir
    body = MeshBuilder("secret.scarecrow")
    arms_z = 2.9
    body.box(f, (-0.06, -0.06, -0.4), (0.06, 0.06, arms_z + 0.3), 'scarecrow_pole', grain_axis=2, taper=(0.1, 0.1))
    body.box(f, (-1.05, -0.04, arms_z - 0.05), (1.05, 0.05, arms_z + 0.05), 'scarecrow_pole', grain_axis=0)
    # the shirt: a stuffed torso and sleeves (plaid), lumpy
    K.pillow(body, f.sub((0, -0.02, arms_z - 0.28), rot_y=math.pi / 2), 0.62, 0.3, 0.46, 'cloth_plaid', 0.4, r,
             seg_u=12, seg_v=6, lump=0.03)
    for s in (-1, 1):
        sf = f.sub((s * 0.52, -0.02, arms_z - 0.02), rot_z=0.0)
        K.pillow(body, sf, 0.72, 0.2, 0.2, 'cloth_plaid', 0.5, r, seg_u=10, seg_v=5, lump=0.02)
        # straw sticking out of the cuff
        for k in range(10):
            a = r.uniform(0, 2 * math.pi)
            p0 = f.p(s * 0.88, -0.02 + 0.05 * math.cos(a), arms_z - 0.02 + 0.05 * math.sin(a))
            p1 = p0 + f.d(s * r.uniform(0.12, 0.25), r.uniform(-0.05, 0.05), r.uniform(-0.12, 0.02))
            K.tube(body, [p0, p1], 0.004, 'straw', sides=3, cap=False)
    # trousers: two limp legs hanging from the waist
    for s in (-1, 1):
        lf = f.sub((s * 0.11, -0.02, arms_z - 0.95), rot_y=math.pi / 2, rot_x=r.uniform(-0.1, 0.1))
        K.pillow(body, lf, 0.85, 0.17, 0.2, 'cloth_denim', 0.6, r, seg_u=10, seg_v=5, lump=0.03)
        for k in range(8):
            p0 = f.p(s * 0.11 + r.uniform(-0.05, 0.05), -0.02 + r.uniform(-0.05, 0.05), arms_z - 1.36)
            p1 = p0 + Vector((r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), -r.uniform(0.1, 0.2)))
            K.tube(body, [p0, p1], 0.004, 'straw', sides=3, cap=False)
    bo = K.emit(body, col, lib, 'west', 'cloth', smooth_angle=60)
    from .contract import set_origin
    set_origin(bo, Vector((sx, sy, z)))
    tag(bo, role='scarecrow', facing=[round(face_dir.x, 3), round(face_dir.z, 3), round(-face_dir.y, 3)])
    # the head, on its pivot at the neck
    head = MeshBuilder("secret.scarecrow.head")
    neck = f.p(0.0, -0.02, arms_z + 0.06)
    hf = f.sub((0.0, -0.02, arms_z + 0.3))
    K.pillow(head, hf.sub((0, 0, 0), rot_y=math.pi / 2), 0.4, 0.3, 0.32, 'sandbag_pale', 0.7, r, seg_u=12, seg_v=6, lump=0.02)
    # the cinch of rope at the neck, a stitched face: button eyes, a mouth of stitches
    K.tube(head, [hf.p(0.1 * math.cos(2 * math.pi * k / 12), 0.1 * math.sin(2 * math.pi * k / 12) - 0.0, -0.2) for k in range(12)],
           0.015, 'straw', sides=4, closed=True)
    for s in (-1, 1):
        K.lathe(head, hf.sub((s * 0.07, -0.155, 0.04), rot_x=math.pi / 2), [(0.0, 0.0), (0.028, 0.0), (0.028, 0.01), (0.0, 0.012)], 'bakelite', seg=8)
    for k in range(7):
        x0 = -0.08 + k * 0.026
        head.box(hf, (x0 - 0.004, -0.165, -0.07), (x0 + 0.004, -0.15, -0.04), 'iron_dark')
    head.box(hf, (-0.09, -0.162, -0.058), (0.1, -0.15, -0.052), 'iron_dark')
    # a battered straw hat
    K.lathe(head, hf.sub((0.0, 0.0, 0.13), rot_x=r.uniform(-0.12, 0.05), rot_y=r.uniform(-0.1, 0.1)),
            [(0.0, 0.14), (0.1, 0.14), (0.14, 0.1), (0.15, 0.02), (0.3, 0.0), (0.33, -0.02), (0.31, -0.03), (0.15, -0.01), (0.0, -0.01)],
            'straw', seg=18)
    ho = K.emit(head, col, lib, 'west', 'cloth', smooth_angle=60)
    set_origin(ho, neck)
    tag(ho, role='scarecrow_head', pivot='neck')
    mw = ho.matrix_world.copy()
    ho.parent = bo
    ho.matrix_world = mw
    return bo, ho


def build(lib, col):
    barn(lib, col)
    silo(lib, col)
    windmill(lib, col)
    scarecrow(lib, col)
