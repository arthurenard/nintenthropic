"""Up the road: the burned-out school bus across both lanes (they climb out
of it), abandoned cars, the water tower, and on the hill the drive-in's
screen and projector booth (secrets, seen only when the fog thins).

Bake group 'far' (and 'west'/'east' for the cars by the road).
"""

import math

from mathutils import Vector

from .common import rng, tag
from . import layout as L, meshkit as K
from .meshkit import MeshBuilder, Frame
from .ground import ground_z

BUS_L, BUS_W, BUS_H = 10.6, 2.44, 2.95
BUS_SINK = 0.22          # its tyres burned away: it sits on its rims
DOOR = (2.95, 3.75)      # along its length, on the right (south) side
SILL_Z = 1.22


def bus_frame():
    a = math.radians(90.0 - L.BUS_ANGLE_DEG)      # long axis from +X
    cx, cy = L.BUS
    return Frame((cx, cy, ground_z(cx, cy) - BUS_SINK), a)


def bus_door():
    f = bus_frame()
    p = f.p((DOOR[0] + DOOR[1]) / 2, -BUS_W / 2 - 0.45, BUS_SINK)
    out = f.d(0, -1, 0)
    return Vector((p.x, p.y, ground_z(p.x, p.y))), Vector((out.x, out.y, 0.0)).normalized()


def bus_sill_spot():
    """Calib jar 5: on the ledge under the window straight up the road (x = 0)."""
    f = bus_frame()
    # solve for the length coordinate s where the side's outer face is at world x = 0
    o = f.p(0, -BUS_W / 2 - 0.05, 0)
    ux = f.d(1, 0, 0)
    s = -o.x / ux.x
    return f.p(s, -BUS_W / 2 - 0.05, SILL_Z + 0.01)


def bus(lib, col):
    r = rng("bus")
    f = bus_frame()
    body = MeshBuilder("bus.body")
    char = MeshBuilder("bus.char")
    hl, hw = BUS_L / 2, BUS_W / 2
    z0 = 0.62                   # underside of the body (rims on the road)
    front_box = hl - 1.7        # where the hood starts
    # windows: posts every ~0.8 m along both sides of the box body
    xs = [-hl + 0.35]
    while xs[-1] < front_box - 0.9:
        xs.append(xs[-1] + 0.82)
    for side in (-1, 1):
        y = side * hw
        # lower panel (under the windows) and the band above them
        for (a, b) in [(xs[0] - 0.35, front_box)]:
            lo_cut = [(DOOR[0], DOOR[1])] if side < 0 else []
            segs = [(a, b)]
            for (c0, c1) in lo_cut:
                segs = [(p, q) for (p, q) in ((segs[0][0], c0), (c1, segs[0][1]))]
            for (p, q) in segs:
                body.box(f, (p, y - 0.03, z0), (q, y + 0.03, SILL_Z), 'bus_yellow' if r.random() < 0.5 else 'bus_char')
                body.box(f, (p, y - 0.03, 2.12), (q, y + 0.03, 2.45), 'bus_char')
        # the rub rails and the ledge under the windows
        for zz in (0.8, 1.0):
            body.box(f, (xs[0] - 0.35, y - 0.05, zz), (front_box, y + 0.05, zz + 0.04), 'rusty')
        body.box(f, (xs[0] - 0.35, y - (0.09 if side < 0 else 0.03), SILL_Z - 0.03), (front_box, y + (0.03 if side < 0 else 0.09), SILL_Z + 0.01), 'rusty')
        for x in xs:
            if side < 0 and DOOR[0] - 0.1 < x < DOOR[1] + 0.1:
                continue
            body.box(f, (x - 0.045, y - 0.03, SILL_Z), (x + 0.045, y + 0.03, 2.12), 'bus_char')
    # roof: a shallow barrel over the box, some of it buckled by the heat
    n = 10
    for k in range(n):
        a0 = math.pi * k / n
        a1 = math.pi * (k + 1) / n
        y0, z0r = math.cos(a0) * hw, 2.45 + math.sin(a0) * 0.42
        y1, z1r = math.cos(a1) * hw, 2.45 + math.sin(a1) * 0.42
        body.add_face([tuple(f.p(-hl + 0.1, y0, z0r)), tuple(f.p(front_box, y0, z0r)), tuple(f.p(front_box, y1, z1r)), tuple(f.p(-hl + 0.1, y1, z1r))],
                      'bus_char' if k in (3, 4, 5) else 'bus_yellow', r.random(), [(0, a0), (BUS_L, a0), (BUS_L, a1), (0, a1)])
    # the rear: emergency door, lights
    body.box(f, (-hl, -hw, z0), (-hl + 0.08, hw, 2.6), 'bus_yellow')
    char.box(f, (-hl - 0.01, -0.45, 1.3), (-hl + 0.02, 0.45, 2.1), 'black_void')
    # the front: the cab bulkhead and windscreen frame, the hood, the grille
    body.box(f, (front_box - 0.05, -hw, 2.1), (front_box + 0.05, hw, 2.6), 'bus_char')
    for yy in (-hw, -0.05, hw - 0.1):
        body.box(f, (front_box - 0.05, yy, 1.5), (front_box + 0.05, yy + 0.1, 2.1), 'bus_char')
    body.box(f, (front_box, -1.05, z0 + 0.2), (hl - 0.15, 1.05, 1.62), 'bus_yellow')
    for side in (-1, 1):
        K.lathe(body, f.sub((hl - 0.95, side * 0.95, 0.65), rot_x=math.pi / 2 * side),
                [(0.0, -0.2), (0.55, -0.2), (0.6, -0.1), (0.6, 0.12), (0.55, 0.2), (0.0, 0.2)], 'bus_yellow', seg=14, cap_top=False)
    body.box(f, (hl - 0.18, -0.9, 0.7), (hl - 0.1, 0.9, 1.55), 'rusty')
    body.box(f, (hl - 0.15, -1.25, 0.45), (hl + 0.05, 1.25, 0.62), 'rusty')
    # inside: a charred floor, the steel seat frames in two rows
    char.box(f, (-hl + 0.1, -hw + 0.05, z0), (front_box, hw - 0.05, z0 + 0.06), 'ash')
    for x in [(-hl + 0.8) + k * 0.8 for k in range(int((front_box - (-hl + 0.8)) / 0.8))]:
        for side in (-1, 1):
            if side < 0 and DOOR[0] - 0.4 < x < DOOR[1] + 0.2:
                continue
            yc = side * (hw - 0.55)
            char.box(f, (x - 0.02, yc - 0.45, z0 + 0.06), (x + 0.02, yc + 0.45, z0 + 1.05), 'iron_dark')
            char.box(f, (x - 0.35, yc - 0.45, z0 + 0.42), (x, yc + 0.45, z0 + 0.46), 'iron_dark')
    # rims on the road, what is left of the tyres
    for (x, side) in ((hl - 0.95, 1), (hl - 0.95, -1), (-2.6, 1), (-2.6, -1)):
        wf = f.sub((x, side * (hw - 0.15), 0.42), rot_x=math.pi / 2)
        K.lathe(char, wf, [(0.0, -0.12), (0.34, -0.12), (0.38, -0.05), (0.38, 0.05), (0.34, 0.12), (0.0, 0.12)], 'rusty', seg=14)
    # the folding door hanging open
    dh = f.sub((DOOR[0], -hw - 0.02, z0), rot_z=math.radians(-70))
    body.box(dh, (0.0, -0.02, 0.0), (0.4, 0.02, 1.5), 'bus_char')
    K.emit(body, col, lib, 'far', 'metal')
    K.emit(char, col, lib, 'far', 'metal')


def car(lib, col, name, x, y, rot, paint, group, doors_open=(), r=None, sunk=0.0):
    """A '50s sedan, rounded where it counts."""
    r = r or rng(name)
    z = ground_z(x, y) - sunk
    f = Frame((x, y, z), rot)
    b = MeshBuilder(f"{name}.body")
    g = MeshBuilder(f"{name}.glass")
    d = MeshBuilder(f"{name}.dark")
    L_, Wd = 5.2, 1.95
    hl, hw = L_ / 2, Wd / 2
    b.box(f, (-hw, -hl, 0.34), (hw, hl, 0.95), paint)
    # fenders bulge, the greenhouse sits back
    for sx in (-1, 1):
        for yy in (-1.45, 1.55):
            K.lathe(b, f.sub((sx * (hw - 0.05), yy, 0.36), rot_y=math.pi / 2), [(0.0, -0.08), (0.42, -0.08), (0.46, 0.0), (0.42, 0.08), (0.0, 0.08)],
                    paint, seg=14, cap_top=False)
    b.box(f, (-hw + 0.12, -0.85, 0.95), (hw - 0.12, 0.85, 1.42), paint, taper=(0.12, 0.25))
    for sx in (-1, 1):
        g.box(f, (sx * (hw - 0.14) - 0.01, -0.7, 1.0), (sx * (hw - 0.14) + 0.01, 0.7, 1.36), 'glass_dark')
    g.box(f, (-hw + 0.2, 0.84, 0.98), (hw - 0.2, 0.9, 1.36), 'glass_dark')
    g.box(f, (-hw + 0.2, -0.9, 0.98), (hw - 0.2, -0.84, 1.36), 'glass_dark')
    b.box(f, (-hw - 0.05, hl - 0.05, 0.32), (hw + 0.05, hl + 0.1, 0.48), 'chrome')
    b.box(f, (-hw - 0.05, -hl - 0.1, 0.32), (hw + 0.05, -hl + 0.05, 0.48), 'chrome')
    for sx in (-1, 1):
        K.lathe(b, f.sub((sx * 0.7, hl + 0.02, 0.72), rot_x=-math.pi / 2), [(0.0, 0.0), (0.09, 0.0), (0.09, 0.03), (0.0, 0.05)], 'chrome', seg=10)
        for yy in (-1.45, 1.55):
            K.lathe(d, f.sub((sx * (hw - 0.12), yy, 0.34), rot_y=math.pi / 2),
                    [(0.2, -0.1), (0.3, -0.11), (0.34, -0.05), (0.34, 0.05), (0.3, 0.11), (0.2, 0.1)], 'rubber', seg=14, cap_top=False)
    for sx in doors_open:
        hf = f.sub((sx * hw, 0.4, 0.36), rot_z=sx * math.radians(55))
        b.box(hf, (-0.03 if sx > 0 else -0.03, -1.05, 0.0), (0.03, 0.0, 0.62), paint)
        d.box(f, (sx * hw - 0.02 * sx, -0.65, 0.4), (sx * (hw - 0.3), 0.4, 0.95), 'black_void')
    K.emit(b, col, lib, group, 'metal', smooth_angle=35)
    K.emit(g, col, lib, group, 'glass')
    K.emit(d, col, lib, group, 'metal', smooth_angle=40)


def water_tower(lib, col):
    wx, wy = L.WATER_TOWER
    z = ground_z(wx, wy)
    mb = MeshBuilder("watertower")
    H = 24.0
    legs = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        base = Vector((wx + 5.0 * math.cos(a), wy + 5.0 * math.sin(a), z - 0.5))
        top = Vector((wx + 3.6 * math.cos(a), wy + 3.6 * math.sin(a), z + H))
        K.tube(mb, [base, top], 0.22, 'tower_metal', sides=8)
        legs.append((base, top))
    for t in (0.3, 0.6, 0.85):
        ring = [a.lerp(b, t) for a, b in legs]
        for i in range(4):
            K.tube(mb, [ring[i], ring[(i + 1) % 4]], 0.07, 'tower_metal', sides=5)
    K.lathe(mb, Frame((wx, wy, z + H)), [(0.0, -1.8), (2.8, -1.2), (4.6, 0.0), (4.6, 5.6), (4.4, 6.2), (3.0, 7.2), (0.8, 7.8), (0.0, 7.85)],
            'tower_metal', seg=24)
    K.lathe(mb, Frame((wx, wy, z + H + 7.85)), [(0.12, 0.0), (0.12, 0.8), (0.0, 0.9)], 'tower_metal', seg=8)
    # the ladder up one leg to the catwalk
    a, b = legs[0]
    K.tube(mb, [a + Vector((0.4, 0, 0)), b + Vector((0.4, 0, 0))], 0.03, 'tower_metal', sides=4)
    K.tube(mb, [Vector((wx + 4.9 * math.cos(2 * math.pi * k / 24), wy + 4.9 * math.sin(2 * math.pi * k / 24), z + H + 0.9)) for k in range(24)],
           0.04, 'tower_metal', sides=4, closed=True)
    K.emit(mb, col, lib, 'far', 'metal', smooth_angle=40)


def drive_in(lib, col, lights):
    """The screen on the hill (secret.drivein.screen: a plane the game can put
    a picture on) and the projector booth with its lamp (secret.drivein.lamp)."""
    sx, sy = L.DRIVEIN_SCREEN
    z = ground_z(sx, sy)
    f = Frame((sx, sy, z), math.radians(8))       # facing the lot to the south, a touch toward the road
    mb = MeshBuilder("drivein.frame")
    W_, H_, z0 = 24.0, 10.5, 6.0
    for k in range(7):
        x = -W_ / 2 + k * W_ / 6
        mb.box(f, (x - 0.25, 0.3, -1.0), (x + 0.25, 0.8, z0 + H_ + 0.5), 'pole_wood')
        mb.board(f, (x, 0.55, 0.0), (x + (W_ / 6 if k < 6 else -W_ / 6) * 0.5, 3.6, 0.0), 0.3, 0.2, 'pole_wood', up=(0, 0, 1))
    mb.box(f, (-W_ / 2 - 0.3, 0.02, z0 - 0.4), (W_ / 2 + 0.3, 0.3, z0 + H_ + 0.4), 'screen_white')
    for zz in (z0 + 2, z0 + 6, z0 + 10):
        mb.box(f, (-W_ / 2, 0.3, zz), (W_ / 2, 0.55, zz + 0.3), 'pole_wood')
    scr = MeshBuilder("secret.drivein.screen")
    scr.quad(f, [(-W_ / 2, 0.0, z0), (W_ / 2, 0.0, z0), (W_ / 2, 0.0, z0 + H_), (-W_ / 2, 0.0, z0 + H_)], 'screen_white',
             uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    K.emit(mb, col, lib, 'far', 'wood')
    so = K.emit(scr, col, lib, 'far', 'cloth')
    from .contract import set_origin
    c = f.p(0.0, 0.0, z0 + H_ / 2)
    set_origin(so, c)
    tag(so, role='drivein_screen', width_m=W_, height_m=H_, note="UV 0..1 across the picture; faces the player")
    # the booth: a cinder-block hut, the projector port toward the screen,
    # a caged lamp on the roof glowing faintly (the pilot light)
    bx, by = L.DRIVEIN_BOOTH
    bz = ground_z(bx, by)
    bf = Frame((bx, by, bz), math.radians(8))
    hut = MeshBuilder("drivein.booth")
    hut.box(bf, (-2.5, -2.0, 0.0), (2.5, 2.0, 3.0), 'cinder_bare')
    hut.box(bf, (-2.7, -2.2, 3.0), (2.7, 2.2, 3.25), 'tar_roof')
    hut.box(bf, (-0.5, -2.02, 0.0), (0.5, -1.98, 2.1), 'motel_door2')
    lamp = MeshBuilder("secret.drivein.lamp")
    lp = bf.p(1.6, -1.6, 3.25)
    K.lathe(lamp, Frame(lp), [(0.0, 0.0), (0.12, 0.0), (0.12, 0.2), (0.16, 0.26), (0.0, 0.3)], 'pilot_lamp', seg=10)
    # speaker posts in rows on the slope below the screen
    posts = MeshBuilder("drivein.posts")
    for row in range(4):
        for k in range(9):
            px, py = sx - 16 + k * 4.0, sy - 20 - row * 9.0
            pz = ground_z(px, py)
            posts.box(Frame((px, py, pz)), (-0.04, -0.04, 0.0), (0.04, 0.04, 1.1), 'galvanized')
            posts.box(Frame((px, py, pz)), (-0.15, -0.06, 1.1), (0.15, 0.06, 1.3), 'iron_dark')
    K.emit(hut, col, lib, 'far', 'asphalt')
    K.emit(posts, col, lib, 'far', 'metal')
    lo = K.emit(lamp, col, lib, 'far', 'glass', smooth_angle=50)
    set_origin(lo, lp)
    tag(lo, role='drivein_lamp')


def build(lib, col, lights):
    bus(lib, col)
    car(lib, col, "car.wreck", L.WRECK_CAR[0], L.WRECK_CAR[1], math.radians(-24), 'car_paint', 'west', doors_open=(1,), sunk=0.12)
    car(lib, col, "car.motel", L.MOTEL_CAR[0], L.MOTEL_CAR[1], math.radians(6), 'car_paint2', 'east')
    water_tower(lib, col)
    drive_in(lib, col, lights)
