"""The Starlite Motel: an office and six rooms in a mint cinder-block row
facing the road across its lot, under a deep walkway overhang; a candle
burning in three windows, two doors standing open onto the dark; its tall
sign by the road with a star on top (dead, like the rest of the power).

Bake group 'east'.
"""

import math

import bpy
from mathutils import Vector

from .common import rng
from . import layout as L, meshkit as K, world
from .meshkit import MeshBuilder, Frame
from .ground import ground_z

W = Frame()
INFO = {}
CANDLES = []


def room_openings(i):
    """(door x0, x1), (window x0, x1) of room i (1-based) along the facade."""
    x0 = L.MOTEL_ROOMS_X0 + (i - 1) * L.MOTEL_ROOM_W
    return (x0 + 0.35, x0 + 1.25), (x0 + 1.65, x0 + 2.85)


def build_block(lib, col, lights):
    r = rng("motel")
    y = L.MOTEL_Y
    D = L.MOTEL_DEPTH
    H = 3.0
    xa, xb = L.MOTEL_OFFICE[0], L.MOTEL_ROOMS_X0 + 6 * L.MOTEL_ROOM_W
    walls = MeshBuilder("motel.walls")
    trim = MeshBuilder("motel.trim")
    wood = MeshBuilder("motel.doors")
    dark = MeshBuilder("motel.interior")
    glass = MeshBuilder("motel.glass")
    cloth = MeshBuilder("motel.curtains")
    t = 0.2
    # facade spans between openings
    cuts = []
    for i in range(1, 7):
        (d0, d1), (w0, w1) = room_openings(i)
        cuts += [(d0, d1, 0.0, 2.1, 'door', i), (w0, w1, 0.9, 2.1, 'window', i)]
    ox0, ox1 = L.MOTEL_OFFICE
    cuts += [(ox0 + 0.4, ox0 + 1.3, 0.0, 2.1, 'door', 0), (ox0 + 1.7, ox1 - 0.3, 0.8, 2.2, 'window', 0)]
    cuts.sort()
    x = xa
    for (c0, c1, z0, z1, kind, i) in cuts:
        walls.box(W, (x, y, 0.0), (c0, y + t, H), 'cinder_mint' if x >= L.MOTEL_ROOMS_X0 - 0.01 else 'cinder_cream')
        if z0 > 0:
            walls.box(W, (c0, y, 0.0), (c1, y + t, z0), 'cinder_mint')
        walls.box(W, (c0, y, z1), (c1, y + t, H), 'cinder_mint')
        x = c1
    walls.box(W, (x, y, 0.0), (xb, y + t, H), 'cinder_mint')
    # party walls, the back, the ends
    for i in range(0, 7):
        xx = L.MOTEL_ROOMS_X0 + i * L.MOTEL_ROOM_W
        walls.box(W, (xx - 0.08, y, 0.0), (xx + 0.08, y + D, H), 'cinder_bare')
    walls.box(W, (xa, y + D - t, 0.0), (xb, y + D, H), 'cinder_bare')
    walls.box(W, (xa, y, 0.0), (xa + t, y + D, H), 'cinder_cream')
    # roof: a flat deck with a deep overhang over the walk, thin steel posts
    walls.box(W, (xa - 0.3, y - 2.0, H), (xb + 0.3, y + D + 0.3, H + 0.22), 'tar_roof')
    trim.box(W, (xa - 0.32, y - 2.02, H - 0.05), (xb + 0.32, y - 1.9, H + 0.3), 'canopy_white')
    for k in range(9):
        px = xa + 0.4 + k * (xb - xa - 0.8) / 8
        trim.box(W, (px - 0.04, y - 1.85, 0.0), (px + 0.04, y - 1.77, H), 'canopy_white')
    walls.box(W, (xa, y - 1.9, -0.05), (xb, y, 0.14), 'curb')
    # per room: door (open or shut), window with curtains, a number, and a
    # candle in some; the dark room beyond
    for i in range(1, 7):
        (d0, d1), (w0, w1) = room_openings(i)
        rx0 = L.MOTEL_ROOMS_X0 + (i - 1) * L.MOTEL_ROOM_W
        dark.box(W, (rx0 + 0.1, y + t, 0.0), (rx0 + L.MOTEL_ROOM_W - 0.1, y + D - t, 0.02), 'linoleum')
        dark.box(W, (rx0 + 0.1, y + t, 2.6), (rx0 + L.MOTEL_ROOM_W - 0.1, y + D - t, 2.62), 'interior_dark')
        mat = 'motel_door' if i % 2 else 'motel_door2'
        trim.box(W, (d0 - 0.05, y - 0.03, 0.0), (d0, y + t, 2.15), 'canopy_white')
        trim.box(W, (d1, y - 0.03, 0.0), (d1 + 0.05, y + t, 2.15), 'canopy_white')
        trim.box(W, (d0 - 0.05, y - 0.03, 2.1), (d1 + 0.05, y + t, 2.15), 'canopy_white')
        if i in L.MOTEL_AJAR:
            ang = math.radians(r.uniform(45, 75))
            hf = Frame((d0, y + 0.06, 0.0), ang)
            wood.box(hf, (0.0, 0.0, 0.01), (d1 - d0, 0.045, 2.09), mat)
            # the bed, a chair: dark shapes inside the open door
            dark.box(W, (rx0 + 0.3, y + 3.5, 0.0), (rx0 + 2.3, y + 5.6, 0.55), 'interior_dark')
            dark.box(W, (rx0 + 0.25, y + 5.5, 0.0), (rx0 + 2.35, y + 5.7, 1.05), 'plank_dark')
        else:
            wood.box(W, (d0, y + 0.05, 0.01), (d1, y + 0.1, 2.09), mat)
            trim.box(W, ((d0 + d1) / 2 + 0.3, y + 0.03, 1.0), ((d0 + d1) / 2 + 0.36, y + 0.05, 1.06), 'chrome')
        # room number plate
        trim.box(W, ((d0 + d1) / 2 - 0.07, y + 0.02, 1.62), ((d0 + d1) / 2 + 0.07, y + 0.04, 1.78), 'sign_face')
        # the window: frame, curtains; glass only where no candle burns
        trim.box(W, (w0 - 0.04, y - 0.04, 0.86), (w1 + 0.04, y + 0.05, 0.92), 'curb')
        trim.box(W, (w0, y + 0.02, 1.48), (w1, y + 0.06, 1.52), 'canopy_white')
        cl = r.uniform(0.25, 0.45)
        for s0, s1 in ((w0 + 0.02, w0 + (w1 - w0) * cl), (w1 - (w1 - w0) * r.uniform(0.2, 0.4), w1 - 0.02)):
            n = 7
            for k in range(n):
                a0 = s0 + (s1 - s0) * k / n
                a1 = s0 + (s1 - s0) * (k + 1) / n
                yy0 = y + t + 0.08 + 0.025 * math.sin(k * 2.1)
                yy1 = y + t + 0.08 + 0.025 * math.sin((k + 1) * 2.1)
                cloth.add_face([(a0, yy0, 0.95), (a1, yy1, 0.95), (a1, yy1, 2.08), (a0, yy0, 2.08)],
                               'cloth_plaid' if i % 3 == 0 else 'paper', 0.3 + 0.1 * i)
        dark.box(W, (w0, y + t + 0.4, 0.9), (w1, y + t + 0.45, 2.1), 'interior_dark')
        if i in L.MOTEL_CANDLES:
            # the sash is up: a candle on the sill, lighting the curtains
            cp = Vector(((w0 + w1) / 2 + r.uniform(-0.2, 0.2), y + t + 0.05, 0.92))
            K.lathe(dark, Frame(cp), [(0.0, 0.0), (0.035, 0.0), (0.035, 0.12), (0.0, 0.12)], 'wax', seg=10)
            fl = MeshBuilder(f"motel.flame.{i}")
            K.lathe(fl, Frame(cp + Vector((0, 0, 0.13))), [(0.0, 0.0), (0.01, 0.012), (0.008, 0.032), (0.0, 0.05)], 'flame', seg=8)
            K.emit(fl, col, lib, 'east', 'cloth')
            ld = bpy.data.lights.new(f"candle.motel.{i}", 'POINT')
            ld.energy = 5.0
            ld.color = world.CANDLE
            ld.shadow_soft_size = 0.02
            lo = bpy.data.objects.new(f"candle.motel.{i}", ld)
            lo.location = cp + Vector((0, 0, 0.16))
            lights.objects.link(lo)
            CANDLES.append(tuple(cp + Vector((0, 0, 0.15))))
            trim.box(W, (w0, y + 0.02, 1.5), (w1, y + 0.08, 2.1), 'canopy_white')
        else:
            glass.box(W, (w0, y + 0.07, 0.92), (w1, y + 0.09, 2.1), 'glass_dark')
            trim.box(W, ((w0 + w1) / 2 - 0.02, y + 0.05, 0.92), ((w0 + w1) / 2 + 0.02, y + 0.1, 2.1), 'canopy_white')
        # an air conditioner box under some windows, an ice bucket, a chair
        if i in (1, 4):
            trim.box(W, (w0 + 0.2, y - 0.45, 0.35), (w0 + 0.8, y, 0.8), 'mailbox')
        if i in (2, 5):
            f = Frame((d1 + 0.3, y - 0.9, 0.14), r.uniform(-0.3, 0.3))
            trim.box(f, (-0.22, -0.22, 0.4), (0.22, 0.22, 0.45), 'canopy_red')
            for sx in (-1, 1):
                for sy in (-1, 1):
                    trim.box(f, (sx * 0.19 - 0.012, sy * 0.19 - 0.012, 0.0), (sx * 0.19 + 0.012, sy * 0.19 + 0.012, 0.4), 'chrome')
            trim.box(f, (-0.22, 0.2, 0.45), (0.22, 0.23, 0.85), 'canopy_red')
    # the office: a door, its window with the OFFICE plate, the desk and the phone
    ox0, ox1 = L.MOTEL_OFFICE
    wood.box(W, (ox0 + 0.4, y + 0.05, 0.01), (ox0 + 1.3, y + 0.1, 2.09), 'motel_door2')
    glass.box(W, (ox0 + 1.7, y + 0.07, 0.82), (ox1 - 0.3, y + 0.09, 2.2), 'glass_dark')
    dark.box(W, (ox0 + 1.7, y + 1.2, 0.0), (ox1 - 0.3, y + 1.8, 1.0), 'plank_dark')
    INFO["phone"] = (ox0 + 2.4, y + 1.5, 1.05)
    K.emit(walls, col, lib, 'east', 'asphalt')
    K.emit(trim, col, lib, 'east', 'metal')
    K.emit(wood, col, lib, 'east', 'wood')
    K.emit(dark, col, lib, 'east', 'wood')
    K.emit(glass, col, lib, 'east', 'glass')
    K.emit(cloth, col, lib, 'east', 'cloth')


def star(cx, cz, r_out, r_in, n=5, rot=90.0):
    pts = []
    for k in range(2 * n):
        rr = r_out if k % 2 == 0 else r_in
        a = math.radians(rot + 180.0 * k / n)
        pts.append((cx + rr * math.cos(a), cz + rr * math.sin(a)))
    return pts


def sign(lib, col):
    from . import signpaint as SP
    sx, sy = L.MOTEL_SIGN
    z = ground_z(sx, sy)
    f = Frame((sx, sy, z), math.radians(-12))
    mb = MeshBuilder("motelsign.frame")
    faces = MeshBuilder("motelsign.faces")
    tubes = MeshBuilder("motelsign.tubes")
    mb.cylinder(f, (0, 0.2, 0.0), 0.14, 7.2, 'galvanized', segments=12)
    mb.cylinder(f, (0, 0.2, 0.0), 0.25, 0.5, 'curb', segments=12)
    # STARLITE board (script), MOTEL box under it
    bw, bh, bz = 3.4, 1.3, 4.3
    img = SP.mask("starlite", bw, bh, lambda ms: (ms.text("Starlite", bw / 2, 0.32, 0.8, face='/System/Library/Fonts/Supplemental/Brush Script.ttf',
                                                            ch='R', jitter=0.15, shadow=(0.035, -0.035)),
                                                    ms.rect(0.06, 0.06, bw - 0.06, bh - 0.06, ch='B', line=0.05)), px_per_m=300)
    lib["sign_starlite"] = SP.metal_sign("starlite", img, bg=(0.10, 0.20, 0.30), fill=(0.86, 0.84, 0.76), shadow=(0.03, 0.03, 0.04),
                                         accent=(0.86, 0.84, 0.76), wear=0.5, rust=0.6)
    img = SP.mask("motel", 2.4, 0.7, lambda ms: ms.text("MOTEL", 1.2, 0.16, 0.42, face='/System/Library/Fonts/Supplemental/Futura.ttc',
                                                        ch='R', jitter=0.0), px_per_m=300)
    lib["sign_motel"] = SP.metal_sign("motel", img, bg=(0.72, 0.18, 0.14), fill=(0.9, 0.88, 0.8), wear=0.45, rust=0.5)
    img = SP.mask("vacancy", 1.6, 0.36, lambda ms: ms.text("NO VACANCY", 0.8, 0.1, 0.18, face='/System/Library/Fonts/Supplemental/Futura.ttc',
                                                           ch='R', jitter=0.0), px_per_m=300)
    lib["sign_vacancy"] = SP.metal_sign("vacancy", img, bg=(0.85, 0.84, 0.78), fill=(0.5, 0.06, 0.05), wear=0.4, rust=0.4)
    for key, w_, h_, zz in (('sign_starlite', bw, bh, bz), ('sign_motel', 2.4, 0.7, bz - 0.85), ('sign_vacancy', 1.6, 0.36, bz - 1.35)):
        faces.quad(f, [(-w_ / 2, -0.08, zz), (w_ / 2, -0.08, zz), (w_ / 2, -0.08, zz + h_), (-w_ / 2, -0.08, zz + h_)], key,
                   uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
        mb.box(f, (-w_ / 2 - 0.05, -0.07, zz - 0.05), (w_ / 2 + 0.05, 0.25, zz + h_ + 0.05), 'sign_back')
    # the star: an extruded five-point star with neon (dead) on its edge
    st = star(0.0, bz + bh + 0.9, 0.75, 0.32)
    K.extrude(mb, f.sub((0, -0.1, 0)), st, 0.18, 'pump_cream')
    K.tube(tubes, [f.p(px, -0.13, pz) for px, pz in st] + [f.p(st[0][0], -0.13, st[0][1])], 0.014, 'neon_dead', sides=6)
    # rays from the star
    for k in range(7):
        a = math.radians(-40 + k * 40)
        p0 = f.p(0.9 * math.cos(a), -0.12, bz + bh + 0.9 + 0.9 * math.sin(a))
        p1 = f.p(1.4 * math.cos(a), -0.12, bz + bh + 0.9 + 1.4 * math.sin(a))
        K.tube(tubes, [p0, p1], 0.014, 'neon_dead', sides=6)
    K.emit(mb, col, lib, 'east', 'metal')
    K.emit(faces, col, lib, 'east', 'metal')
    ob = K.emit(tubes, col, lib, 'east', 'glass')
    if ob is not None:
        ob["no_occlude"] = 1
    INFO["sign_top"] = tuple(f.p(0.0, 0.0, bz + bh + 0.08))


def build(lib, col, lights):
    CANDLES.clear()
    build_block(lib, col, lights)
    sign(lib, col)
