"""Miller's Gas & Eats: the canopy the player stands under, the barricade
(sandbags, the pump, the pickup on its side), the diner wing with the radio
behind its counter, and the GAS & EATS pole sign whose neon letters are
separate objects the game can shoot out one by one.

Bake groups: 'near' (the barricade, the canopy, the pickup), 'station' (the
diner wing and the pole sign).
"""

import math

import bpy
from mathutils import Vector, Matrix

from .common import rng, tag, empty, DC
from . import layout as L, meshkit as K, world
from .meshkit import MeshBuilder, Frame

W = Frame()


# ---------------------------------------------------------------------------
# The canopy

def canopy(lib, col):
    r = rng("canopy")
    mb = MeshBuilder("canopy.metal")
    x0, x1, y0, y1, zs = L.CANOPY
    # the deck and its fascia band (white, a faded red stripe)
    mb.box(W, (x0, y0, zs + 0.05), (x1, y1, zs + 0.28), 'canopy_white', skip=('+z',))
    mb.box(W, (x0 - 0.06, y1, zs - 0.06), (x1, y1 + 0.06, zs + 0.62), 'canopy_white')
    mb.box(W, (x0 - 0.07, y1 + 0.06, zs + 0.24), (x1, y1 + 0.075, zs + 0.40), 'canopy_red')
    mb.box(W, (x0 - 0.06, y0, zs - 0.06), (x0, y1, zs + 0.62), 'canopy_white')
    mb.box(W, (x0 - 0.075, y0, zs + 0.24), (x0 - 0.06, y1 + 0.06, zs + 0.40), 'canopy_red')
    # soffit: panels between steel purlins, recessed light boxes (dead)
    for y in [y0 + 1.0 + 2.0 * i for i in range(6)]:
        mb.box(W, (x0, y - 0.05, zs - 0.12), (x1, y + 0.05, zs + 0.05), 'canopy_white')
    for x in (x0 + 0.1, (x0 + x1) / 2, x1 - 0.1):
        mb.box(W, (x - 0.05, y0, zs - 0.10), (x + 0.05, y1, zs + 0.05), 'canopy_white')
    glass = MeshBuilder("canopy.lights")
    for gx in (-3.2, -0.2, 2.8):
        for gy in (-4.0, -0.6, 2.8):
            glass.box(W, (gx - 0.35, gy - 0.35, zs - 0.03), (gx + 0.35, gy + 0.35, zs + 0.02), 'glass_dirty')
    # columns: square steel on concrete bollard footings, rust at the foot
    conc = MeshBuilder("canopy.footings")
    for (px, py) in L.CANOPY_POSTS:
        mb.box(W, (px - 0.11, py - 0.11, 0.45), (px + 0.11, py + 0.11, zs), 'canopy_white')
        conc.box(W, (px - 0.24, py - 0.24, 0.0), (px + 0.24, py + 0.24, 0.45), 'curb', taper=(0.12, 0.12))
    # hooks for the aim check's hanging jars: an eye bolt in the fascia and a
    # wire bail down to where the jar's lid will be (the game hangs the jar)
    wire = MeshBuilder("canopy.hooks")
    from . import contract
    for p in contract.hanging_jar_spots():
        top = Vector((p.x, y1 - 0.05, zs - 0.06))
        bail = Vector((p.x, p.y, p.z + 0.17))
        K.tube(wire, [top, top.lerp(bail, 0.5) + Vector((0.004, 0, 0)), bail], 0.0022, 'galvanized', sides=5)
        K.tube(wire, K.catmull([bail + Vector((-0.045, 0, -0.03)), bail + Vector((0, 0, 0.02)),
                                bail + Vector((0.045, 0, -0.03))], 4), 0.0018, 'galvanized', sides=4)
    K.emit(mb, col, lib, 'near', 'metal')
    K.emit(glass, col, lib, 'near', 'glass')
    K.emit(conc, col, lib, 'near', 'asphalt')
    K.emit(wire, col, lib, 'near', 'metal')


# ---------------------------------------------------------------------------
# The pump and its island

def pump(mb, glass_mb, rubber_mb, f, r):
    """A 1950s pump: a tall cabinet with a rounded crown, a clock-face meter
    each side, a globe on top, the hose looped to its nozzle."""
    w, d, h = 0.54, 0.38, 1.46
    mb.box(f, (-w / 2 - 0.03, -d / 2 - 0.03, 0.0), (w / 2 + 0.03, d / 2 + 0.03, 0.12), 'pump_cream')
    mb.box(f, (-w / 2, -d / 2, 0.12), (w / 2, d / 2, h - 0.12), 'pump_red')
    # rounded crown across the top
    crown = f.sub((0, 0, h - 0.12))
    seg = 10
    for i in range(seg):
        a0, a1 = math.pi * i / seg, math.pi * (i + 1) / seg
        xa0, za0 = math.cos(a0) * w / 2, math.sin(a0) * 0.12
        xa1, za1 = math.cos(a1) * w / 2, math.sin(a1) * 0.12
        mb.add_face([tuple(crown.p(xa0, -d / 2, za0)), tuple(crown.p(xa1, -d / 2, za1)),
                     tuple(crown.p(xa1, d / 2, za1)), tuple(crown.p(xa0, d / 2, za0))], 'pump_red', 0.3,
                    [(a0, 0), (a1, 0), (a1, d), (a0, d)])
        for s in (-1, 1):
            mb.add_face([tuple(crown.p(0, s * d / 2, 0)), tuple(crown.p(xa1, s * d / 2, za1)), tuple(crown.p(xa0, s * d / 2, za0))],
                        'pump_red', 0.3)
    # the face panels (cream) with the meter window and a price plate
    for s in (-1, 1):
        fy = s * (d / 2 + 0.006)
        mb.box(f, (-w / 2 + 0.05, fy - 0.004, 0.62), (w / 2 - 0.05, fy + 0.004, 1.30), 'pump_cream')
        K.lathe(glass_mb, f.sub((0, fy + s * 0.004, 1.02), rot_x=-s * math.pi / 2),
                [(0.0, 0.0), (0.16, 0.0), (0.165, 0.012)], 'glass_dirty', seg=20, cap_top=False)
        mb.box(f, (-0.15, fy - 0.01, 0.70), (0.15, fy + 0.01, 0.80), 'sign_back')
        mb.box(f, (-0.2, fy - 0.006, 0.25), (0.2, fy + 0.006, 0.52), 'pump_cream')
    # the globe on its collar
    K.lathe(mb, f.sub((0, 0, h)), [(0.06, 0.0), (0.07, 0.04), (0.05, 0.06)], 'chrome', seg=16)
    K.lathe(glass_mb, f.sub((0, 0, h + 0.06)),
            [(0.05, 0.0), (0.12, 0.02), (0.165, 0.09), (0.17, 0.16), (0.14, 0.25), (0.07, 0.30), (0.0, 0.31)],
            'plastic_white', seg=20)
    # nozzle holster on the road side and the hose
    hx = w / 2 + 0.02
    mb.box(f, (hx - 0.02, -0.07, 0.95), (hx + 0.07, 0.07, 1.12), 'chrome')
    noz = [f.p(hx + 0.04, 0.0, 1.05), f.p(hx + 0.10, 0.0, 1.00), f.p(hx + 0.13, 0.0, 0.88)]
    K.tube(mb, noz, 0.016, 'chrome', sides=6)
    hose = K.catmull([f.p(hx - 0.03, 0.1, 1.30), f.p(hx + 0.12, 0.12, 1.1), f.p(hx + 0.2, 0.08, 0.55),
                      f.p(hx + 0.16, 0.02, 0.3), f.p(hx + 0.11, -0.04, 0.55), f.p(hx + 0.12, 0.0, 0.84)], 5)
    K.tube(rubber_mb, hose, 0.014, 'rubber', sides=6)


def oil_drum(mb, f, mat, r, h=0.88, rad=0.29, dent=0.0):
    prof = [(rad, 0.0), (rad, 0.02)]
    for zz in (0.29, 0.59):
        prof += [(rad, zz - 0.02), (rad + 0.012, zz), (rad, zz + 0.02)]
    prof += [(rad, h - 0.02), (rad - 0.01, h), (rad - 0.02, h - 0.01)]
    K.lathe(mb, f, prof, mat, seg=18, cap_bottom=False)
    # the lid, with its bung
    K.lathe(mb, f.sub((0, 0, h - 0.01)), [(rad - 0.02, 0.0), (0.0, 0.0)], mat, seg=18, cap_top=False)
    K.lathe(mb, f.sub((0.12, 0.05, h - 0.01)), [(0.03, 0.0), (0.03, 0.012), (0.0, 0.012)], mat, seg=8)


def pump_island(lib, col):
    r = rng("island")
    x0, x1, y0, y1 = L.PUMP_ISLAND
    conc = MeshBuilder("island.concrete")
    conc.box(W, (x0, y0, 0.0), (x1, y1, 0.16), 'curb')
    mb = MeshBuilder("island.pump")
    glass = MeshBuilder("island.glass")
    rub = MeshBuilder("island.rubber")
    pump(mb, glass, rub, Frame((L.PUMP[0], L.PUMP[1], 0.16), 0.0), r)
    drum = MeshBuilder("island.drum")
    oil_drum(drum, Frame((L.BIN[0], L.BIN[1], 0.16), 0.4), 'drum_blue', r)
    # a bent steel guard post at the island's end
    K.tube(mb, [Vector((x1 - 0.12, y0 + 0.12, 0.0)), Vector((x1 - 0.12, y0 + 0.12, 0.9)), Vector((x1 - 0.12, y1 - 0.12, 0.95)),
                Vector((x1 - 0.12, y1 - 0.12, 0.0))], 0.045, 'canopy_red', sides=10)
    K.emit(conc, col, lib, 'near', 'asphalt')
    K.emit(mb, col, lib, 'near', 'metal', smooth_angle=35)
    K.emit(glass, col, lib, 'near', 'glass', smooth_angle=50)
    K.emit(rub, col, lib, 'near', 'metal', welded=True, smooth_angle=60)
    K.emit(drum, col, lib, 'near', 'metal', smooth_angle=50)


# ---------------------------------------------------------------------------
# Sandbags

BAG_L, BAG_W, BAG_H = 0.58, 0.34, 0.125


def bag_wall(mb, x0, x1, y0, y1, z0, layers, r, lean=0.015, ragged_top=True, keep_xs=()):
    """Stretcher bond, two bags deep, each course offset half a bag, the top
    course ragged; bags squashed by the weight above, tilted, never aligned."""
    count = 0
    depth = y1 - y0
    rows = max(1, int(round(depth / BAG_W)))
    for k in range(layers):
        z = z0 + k * (BAG_H * 0.9) + BAG_H * 0.45
        off = (BAG_L * 0.5) * (k % 2)
        n = int(math.ceil((x1 - x0 + off) / (BAG_L * 0.97))) + 1
        for row in range(rows):
            yc = y0 + (row + 0.5) * depth / rows + (k * lean if row == 0 else k * lean * 0.5)
            for i in range(n):
                xc = x0 - off + (i + 0.5) * BAG_L * 0.97 + r.uniform(-0.03, 0.03)
                if xc - BAG_L * 0.4 > x1 or xc + BAG_L * 0.4 < x0:
                    continue
                top = k == layers - 1
                if top and ragged_top and r.random() < 0.12 and all(abs(xc - kx) > 0.5 for kx in keep_xs):
                    continue
                L_ = BAG_L * r.uniform(0.92, 1.05)
                if xc - L_ / 2 < x0:
                    xc = x0 + L_ / 2 - 0.02
                if xc + L_ / 2 > x1:
                    xc = x1 - L_ / 2 + 0.02
                sq = 0.16 * (layers - 1 - k) / max(layers - 1, 1) + r.uniform(0.0, 0.06)
                f = Frame((xc, yc + r.uniform(-0.03, 0.03), z + r.uniform(-0.012, 0.012)),
                          r.uniform(-0.09, 0.09) + (math.pi if r.random() < 0.5 else 0.0)).sub(
                    (0, 0, 0), rot_x=r.uniform(-0.07, 0.07), rot_y=r.uniform(-0.08, 0.08))
                mat = 'sandbag_pale' if r.random() < 0.22 else 'sandbag'
                K.pillow(mb, f, L_, BAG_W * r.uniform(0.92, 1.06), BAG_H * (1.12 - sq), mat, r.random(), r,
                         seg_u=12, seg_v=6, squash=0.0, lump=0.014, sag=r.uniform(0.05, 0.25) if top else r.uniform(0.0, 0.1))
                count += 1
    return count


def sandbags(lib, col):
    r = rng("sandbags")
    mb = MeshBuilder("bags.wall")
    y0, y1 = L.BARRICADE_Y
    n = 0
    from .contract import bag_jar_xs
    jars = bag_jar_xs()
    n += bag_wall(mb, -4.95, L.PUMP_ISLAND[0] - 0.02, y0, y1, 0.0, 8, r, keep_xs=jars)
    # a low course on the island between the pump and the drum
    n += bag_wall(mb, L.PUMP[0] + 0.32, L.BIN[0] - 0.31, 2.62, 3.30, 0.16, 2, r, ragged_top=False)
    n += bag_wall(mb, L.PUMP_ISLAND[1] + 0.02, 6.35, y0 + 0.05, y1 + 0.05, 0.0, 8, r)
    # a few loose bags slumped against the foot of the wall, player side
    for i in range(6):
        x = r.uniform(-3.9, 5.8)
        if L.PUMP_ISLAND[0] - 0.3 < x < L.PUMP_ISLAND[1] + 0.3:
            continue
        f = Frame((x, y0 - 0.2, 0.07), r.uniform(-0.4, 0.4)).sub((0, 0, 0), rot_x=r.uniform(-0.3, 0.1))
        K.pillow(mb, f, BAG_L, BAG_W, BAG_H * 0.9, 'sandbag_pale', r.random(), r, seg_u=10, seg_v=5)
        n += 1
    ob = K.emit(mb, col, lib, 'near', 'sandbag', welded=True, smooth_angle=70)
    # pallets and planks propped against the wall (player side)
    wd = MeshBuilder("bags.wood")
    for (px, ang) in ((-2.9, 0.05), (4.6, -0.08)):
        f = Frame((px, y0 - 0.12, 0.0), ang).sub((0, 0, 0), rot_x=-0.18)
        for k in range(5):
            wd.box(f, (-0.6 + k * 0.29, -0.02, 0.0), (-0.6 + k * 0.29 + 0.1, 0.0, 1.0), 'pallet_wood')
        for zz in (0.08, 0.5, 0.9):
            wd.box(f, (-0.62, 0.0, zz - 0.045), (0.62, 0.08, zz + 0.045), 'pallet_wood')
    K.emit(wd, col, lib, 'near', 'wood')
    print(f"  sandbags: {n}")
    return ob


# ---------------------------------------------------------------------------
# The pickup truck on its side

def truck(lib, col):
    """A '50s pickup tipped onto its right side as the barricade's west end.
    Modelled upright in its own frame (x right, y forward, z up) and turned
    onto its side: the tyres and chassis face the road, the passenger door
    faces the sky (the cat's seat)."""
    r = rng("truck")
    tail = Vector((*L.TRUCK['tail'], 0.0))
    front = Vector((*L.TRUCK['front'], 0.0))
    fwd = (front - tail).normalized()
    centre = (front + tail) / 2
    length = (front - tail).length
    # upright frame
    right = Vector((fwd.y, -fwd.x, 0.0))
    up = Vector((0, 0, 1))
    Mu = Matrix((right, fwd, up)).transposed()
    # onto its driver's side: rotate about its own forward axis by -90 deg,
    # so its tyres face the road and its roof the field; the origin line
    # (the tyres' treads) is the east edge of its footprint
    Rside = Matrix.Rotation(math.radians(-90.0), 3, fwd)
    half_w = 0.96
    M = Matrix.Translation(centre + Vector((0, 0, half_w))) @ (Rside @ Mu).to_4x4()
    f = Frame(matrix=M)
    s = length / 4.9
    body = MeshBuilder("truck.body")
    glass = MeshBuilder("truck.glass")
    dark = MeshBuilder("truck.under")
    rub = MeshBuilder("truck.tyres")
    ch = MeshBuilder("truck.chrome")
    Y = lambda y: y * s
    # cab
    body.box(f, (-0.82, Y(-0.15), 0.72), (0.82, Y(1.30), 1.28), 'truck_paint')
    body.box(f, (-0.76, Y(-0.10), 1.28), (0.76, Y(1.05), 1.82), 'truck_paint', skip=('+y', '-y'))
    body.box(f, (-0.72, Y(-0.08), 1.82), (0.72, Y(0.95), 1.86), 'truck_paint')
    # windscreen and back window frames with the glass gone (dark hole + shards)
    body.box(f, (-0.76, Y(1.05), 1.28), (0.76, Y(1.10), 1.34), 'truck_paint')
    body.box(f, (-0.76, Y(1.02), 1.76), (0.76, Y(1.07), 1.82), 'truck_paint')
    body.box(f, (-0.76, Y(1.02), 1.34), (-0.66, Y(1.07), 1.76), 'truck_paint')
    body.box(f, (0.66, Y(1.02), 1.34), (0.76, Y(1.07), 1.76), 'truck_paint')
    dark.box(f, (-0.66, Y(0.98), 1.34), (0.66, Y(1.0), 1.76), 'interior_dark')
    body.box(f, (-0.76, Y(-0.15), 1.28), (0.76, Y(-0.10), 1.80), 'truck_paint')
    glass.box(f, (-0.55, Y(-0.16), 1.42), (0.55, Y(-0.14), 1.70), 'glass_dirty')
    # side windows: dark glass in the doors
    for sx in (-1, 1):
        glass.box(f, (sx * 0.765 - 0.005, Y(0.15), 1.34), (sx * 0.765 + 0.005, Y(0.95), 1.74), 'glass_dark')
        # door seams and handle
        dark.box(f, (sx * 0.822 - 0.003, Y(0.05), 0.78), (sx * 0.822 + 0.003, Y(0.07), 1.30), 'interior_dark')
        ch.box(f, (sx * 0.83 - 0.01, Y(0.12), 1.16), (sx * 0.83 + 0.01, Y(0.25), 1.19), 'chrome')
    # hood and front fenders
    body.box(f, (-0.55, Y(1.30), 0.78), (0.55, Y(2.30), 1.20), 'truck_paint')
    for sx in (-1, 1):
        fx = sx * 0.66
        K.lathe(body, f.sub((fx, Y(1.72), 0.62), rot_y=math.pi / 2),
                [(0.0, -0.17), (0.42, -0.17), (0.47, -0.10), (0.48, 0.10), (0.42, 0.17), (0.0, 0.17)],
                'truck_paint', seg=16, cap_top=False)
    ch.box(f, (-0.46, Y(2.30), 0.72), (0.46, Y(2.36), 1.14), 'chrome')          # grille
    for sx in (-1, 1):
        K.lathe(ch, f.sub((sx * 0.64, Y(2.13), 0.98), rot_x=-math.pi / 2),
                [(0.0, 0.0), (0.09, 0.0), (0.095, 0.05), (0.07, 0.07), (0.0, 0.075)], 'chrome', seg=12)
    ch.box(f, (-0.92, Y(2.40), 0.48), (0.92, Y(2.52), 0.62), 'chrome')          # bumper
    # bed (step side) with its open top, tailgate
    for sx in (-1, 1):
        body.box(f, (sx * 0.62 - 0.03, Y(-2.40), 0.72), (sx * 0.62 + 0.03, Y(-0.20), 1.22), 'truck_paint')
        K.lathe(body, f.sub((sx * 0.78, Y(-1.30), 0.60), rot_y=math.pi / 2),
                [(0.0, -0.14), (0.40, -0.14), (0.45, -0.07), (0.46, 0.08), (0.40, 0.14), (0.0, 0.14)],
                'truck_paint', seg=16, cap_top=False)
        body.box(f, (sx * 0.72, Y(-0.85), 0.52), (sx * 0.95, Y(1.25), 0.56), 'truck_paint')   # running board
    body.box(f, (-0.62, Y(-0.25), 0.72), (0.62, Y(-0.19), 1.22), 'truck_paint')
    body.box(f, (-0.62, Y(-2.46), 0.72), (0.62, Y(-2.40), 1.18), 'truck_paint')
    wood = MeshBuilder("truck.bed")
    for i in range(6):
        x = -0.55 + i * 0.22
        wood.box(f, (x, Y(-2.40), 0.70), (x + 0.2, Y(-0.25), 0.74), 'plank_dark')
    ch.box(f, (-0.9, Y(-2.56), 0.50), (0.9, Y(-2.46), 0.62), 'iron_dark')
    # underside: frame rails, axles, springs, driveshaft, exhaust, tank
    for sx in (-1, 1):
        dark.box(f, (sx * 0.42 - 0.05, Y(-2.3), 0.40), (sx * 0.42 + 0.05, Y(2.2), 0.56), 'iron_dark')
        dark.box(f, (sx * 0.62 - 0.04, Y(-1.8), 0.44), (sx * 0.62 + 0.04, Y(-0.8), 0.48), 'rusty')
        dark.box(f, (sx * 0.62 - 0.04, Y(1.3), 0.44), (sx * 0.62 + 0.04, Y(2.1), 0.48), 'rusty')
    dark.cylinder(f, (-0.72, Y(-1.30), 0.40), 0.045, 1.44, 'rusty', segments=8, axis='X')
    dark.cylinder(f, (-0.72, Y(1.72), 0.40), 0.04, 1.44, 'rusty', segments=8, axis='X')
    K.lathe(dark, f.sub((0, Y(-1.30), 0.40), rot_y=math.pi / 2), [(0.0, -0.1), (0.14, -0.1), (0.15, 0.08), (0.0, 0.1)], 'rusty', seg=10)
    dark.cylinder(f, (0, Y(-1.2), 0.42), 0.035, Y(2.4), 'iron_dark', segments=8, axis='Y')
    K.tube(dark, [f.p(0.35, Y(1.4), 0.46), f.p(0.38, Y(0.2), 0.36), f.p(0.40, Y(-2.2), 0.36), f.p(0.40, Y(-2.6), 0.40)],
           0.03, 'rusty', sides=6)
    dark.box(f, (-0.5, Y(-0.55), 0.36), (-0.12, Y(-0.18), 0.55), 'rusty')
    # wheels: tyres and hubcaps
    for (wx, wy) in ((0.78, 1.72), (-0.78, 1.72), (0.78, -1.30), (-0.78, -1.30)):
        tf = f.sub((wx, Y(wy), 0.38), rot_y=math.pi / 2)
        K.lathe(rub, tf, [(0.22, -0.11), (0.33, -0.12), (0.38, -0.08), (0.385, 0.0), (0.38, 0.08), (0.33, 0.12), (0.22, 0.11)],
                'rubber', seg=18, cap_top=False)
        sgn = 1 if wx > 0 else -1
        K.lathe(ch, tf.sub((0, 0, 0.09 * sgn), rot_x=0 if sgn > 0 else math.pi), [(0.22, 0.0), (0.16, 0.02), (0.06, 0.035), (0.0, 0.04)],
                'chrome', seg=14)
    # a spilled gas can and the tailgate chain
    can = MeshBuilder("truck.can")
    cf = Frame((L.TRUCK['tail'][0] + 1.4, L.TRUCK['tail'][1] + 0.9, 0.12), 0.6).sub((0, 0, 0), rot_x=math.pi / 2)
    can.box(cf, (-0.15, -0.1, -0.12), (0.15, 0.1, 0.22), 'drum_red')
    K.emit(body, col, lib, 'near', 'metal', smooth_angle=40)
    K.emit(ch, col, lib, 'near', 'metal', smooth_angle=45)
    K.emit(dark, col, lib, 'near', 'metal', smooth_angle=40)
    K.emit(glass, col, lib, 'near', 'glass')
    K.emit(rub, col, lib, 'near', 'metal', smooth_angle=50)
    K.emit(wood, col, lib, 'near', 'wood')
    K.emit(can, col, lib, 'near', 'metal')
    # where the cat sits: on the cab's upturned driver's door, near its front edge
    seat = f.p(0.84, Y(0.95), 1.45)
    return dict(cat_seat=Vector((seat.x, seat.y, seat.z)), cat_face=-fwd)


# ---------------------------------------------------------------------------
# The diner wing

def diner(lib, col, lights):
    r = rng("diner")
    x0, x1, y0, y1 = L.STATION
    H = L.STATION_H
    walls = MeshBuilder("station.walls")
    trim = MeshBuilder("station.trim")
    glass = MeshBuilder("station.glass")
    inner = MeshBuilder("station.interior")
    wy0, wy1 = L.DINER_WINDOW
    sill, head = 0.95, 2.62
    t = 0.22
    # west facade (the road side): cinder block, openings cut as spans
    spans = [(y0, -8.4), (-5.4, -3.4), (-1.0, 0.4), (1.7, 2.6), (6.2, wy0), (wy1, y1)]
    for a, b in spans:
        walls.box(W, (x0, a, 0.0), (x0 + t, b, H), 'cinder_cream', skip=())
    # over and under the openings
    for a, b, lo, hi in ((-8.4, -5.4, 3.1, H), (-3.4, -1.0, 2.2, H), (-3.4, -1.0, 0.0, 0.95), (0.4, 1.7, 2.3, H),
                         (2.6, 6.2, 2.2, H), (2.6, 6.2, 0.0, 0.95), (wy0, wy1, head, H), (wy0, wy1, 0.0, sill)):
        walls.box(W, (x0, a, lo), (x0 + t, b, hi), 'cinder_cream')
    # the other walls (seen only through the openings and past the corner)
    walls.box(W, (x0, y1 - t, 0.0), (x1, y1, H), 'cinder_cream')
    walls.box(W, (x1 - t, y0, 0.0), (x1, y1, H), 'cinder_bare')
    walls.box(W, (x0, y0, 0.0), (x1, y0 + t, H), 'cinder_bare')
    # a mint band along the base and a parapet with a steel cap
    trim.box(W, (x0 - 0.02, y0, 0.0), (x0, y1 + 0.02, 0.45), 'cinder_mint')
    trim.box(W, (x0, y1, 0.0), (x1, y1 + 0.02, 0.45), 'cinder_mint')
    walls.box(W, (x0, y0, H), (x0 + 0.2, y1, H + 0.55), 'cinder_cream')
    walls.box(W, (x0, y1 - 0.2, H), (x1, y1, H + 0.55), 'cinder_cream')
    trim.box(W, (x0 - 0.04, y0, H + 0.55), (x0 + 0.24, y1 + 0.04, H + 0.6), 'galvanized')
    trim.box(W, (x0 - 0.04, y1 - 0.24, H + 0.55), (x1, y1 + 0.04, H + 0.6), 'galvanized')
    walls.box(W, (x0, y0, H - 0.2), (x1, y1, H), 'tar_roof')
    # the big window: steel frame, mullions, the glass shot out (shards left)
    for yy in (wy0, (wy0 + wy1) / 2 - 0.9, (wy0 + wy1) / 2 + 0.9, wy1):
        trim.box(W, (x0 - 0.03, yy - 0.04, sill), (x0 + 0.06, yy + 0.04, head), 'galvanized')
    trim.box(W, (x0 - 0.04, wy0, sill - 0.05), (x0 + 0.25, wy1, sill), 'curb')
    trim.box(W, (x0 - 0.03, wy0, head - 0.04), (x0 + 0.06, wy1, head + 0.04), 'galvanized')
    for (ya, yb) in ((wy0, (wy0 + wy1) / 2 - 0.9), ((wy0 + wy1) / 2 - 0.9, (wy0 + wy1) / 2 + 0.9), ((wy0 + wy1) / 2 + 0.9, wy1)):
        # shards: jagged triangles clinging to each pane's frame
        for edge in ('top', 'bottom', 'a', 'b'):
            n = r.randint(1, 3)
            for k in range(n):
                if edge in ('top', 'bottom'):
                    yc = r.uniform(ya + 0.1, yb - 0.1)
                    zb = head - 0.04 if edge == 'top' else sill + 0.0
                    ln = r.uniform(0.12, 0.45) * (-1 if edge == 'top' else 1)
                    pts = [(x0 + 0.02, yc - r.uniform(0.05, 0.2), zb), (x0 + 0.02, yc + r.uniform(0.05, 0.2), zb),
                           (x0 + 0.02, yc + r.uniform(-0.08, 0.08), zb + ln)]
                else:
                    zc = r.uniform(sill + 0.2, head - 0.2)
                    yb_ = (ya + 0.04) if edge == 'a' else (yb - 0.04)
                    ln = r.uniform(0.1, 0.35) * (1 if edge == 'a' else -1)
                    pts = [(x0 + 0.02, yb_, zc - r.uniform(0.1, 0.3)), (x0 + 0.02, yb_, zc + r.uniform(0.1, 0.3)),
                           (x0 + 0.02, yb_ + ln, zc + r.uniform(-0.1, 0.1))]
                glass.add_face(pts, 'glass_dirty', r.random())
                glass.add_face(pts[::-1], 'glass_dirty', r.random())
    # the other openings: glass that survived (dark mirror), a door, the bay door
    glass.box(W, (x0 + 0.08, -3.4, 0.95), (x0 + 0.1, -1.0, 2.2), 'glass_dark')
    glass.box(W, (x0 + 0.08, 2.6, 0.95), (x0 + 0.1, 6.2, 2.2), 'glass_dark')
    trim.box(W, (x0 + 0.06, 0.4, 0.0), (x0 + 0.1, 1.7, 2.3), 'motel_door2')
    trim.box(W, (x0 + 0.05, -8.4, 0.0), (x0 + 0.1, -5.4, 3.1), 'galvanized')
    for k in range(20):
        trim.box(W, (x0 + 0.03, -8.4, 0.12 + k * 0.15), (x0 + 0.05, -5.4, 0.14 + k * 0.15), 'galvanized')
    # --- inside: floor, ceiling, counter and stools, the back counter
    ix0, iy0, iy1 = x0 + t, 6.25, y1 - t
    inner.box(W, (ix0, iy0, -0.01), (x1 - t, iy1, 0.01), 'linoleum')
    inner.box(W, (ix0, iy0, 3.0), (x1 - t, iy1, 3.05), 'interior_dark')
    inner.box(W, (ix0, iy0 - 0.2, 0.0), (x1 - t, iy0, 3.0), 'stucco_white')
    cx = 7.65
    inner.box(W, (cx, iy0 + 0.3, 0.0), (cx + 0.45, iy1 - 1.0, 0.98), 'vinyl_red')
    inner.box(W, (cx - 0.08, iy0 + 0.25, 0.98), (cx + 0.5, iy1 - 0.95, 1.04), 'formica')
    for k in range(6):
        sy = iy0 + 0.8 + k * 0.95
        sf = Frame((cx - 0.55, sy, 0.0), 0.0)
        inner.cylinder(sf, (0, 0, 0), 0.03, 0.7, 'chrome', segments=8)
        if k == 3:
            # knocked over
            K.lathe(inner, Frame((cx - 1.2, sy + 0.3, 0.2), 0.3).sub((0, 0, 0), rot_x=math.pi / 2),
                    [(0.0, 0.0), (0.2, 0.0), (0.2, 0.08), (0.0, 0.1)], 'vinyl_red', seg=12)
            continue
        K.lathe(inner, sf.sub((0, 0, 0.7)), [(0.0, 0.0), (0.2, 0.0), (0.2, 0.08), (0.0, 0.1)], 'vinyl_red', seg=12)
    bx = 8.75
    inner.box(W, (bx, iy0 + 0.2, 0.0), (bx + 0.6, iy1, 0.95), 'formica')
    inner.box(W, (bx + 0.6, iy0, 0.0), (bx + 0.8, iy1, 3.0), 'stucco_white')
    # the shelf on the north wall at the end of the counter, where the radio sits
    inner.box(W, (L.RADIO[0] - 0.35, iy1 - 0.32, L.RADIO[2] - 0.15), (L.RADIO[0] + 0.35, iy1, L.RADIO[2] - 0.12), 'plank_dark')
    for sxx in (-0.3, 0.3):
        inner.box(W, (L.RADIO[0] + sxx - 0.02, iy1 - 0.3, L.RADIO[2] - 0.4), (L.RADIO[0] + sxx + 0.02, iy1, L.RADIO[2] - 0.15), 'iron_dark')
    for zz in (1.55, 1.95):
        inner.box(W, (bx + 0.4, iy0 + 0.4, zz), (bx + 0.6, iy1 - 0.3, zz + 0.03), 'plank_dark')
        for k in range(14):
            yy = iy0 + 0.5 + k * 0.42 + r.uniform(-0.05, 0.05)
            if yy > iy1 - 0.4:
                break
            hh = r.uniform(0.12, 0.2)
            inner.cylinder(Frame((bx + 0.5, yy, zz + 0.03)), (0, 0, 0), r.uniform(0.04, 0.06), hh,
                           r.choice(['drum_red', 'pump_cream', 'drum_blue', 'car_paint']), segments=8)
    # coffee urn, a pie stand, cups
    K.lathe(inner, Frame((bx + 0.3, iy0 + 1.4, 0.95)),
            [(0.13, 0.0), (0.14, 0.05), (0.14, 0.45), (0.1, 0.52), (0.03, 0.56), (0.0, 0.57)], 'chrome', seg=14)
    K.lathe(inner, Frame((cx + 0.25, iy0 + 2.6, 1.04)),
            [(0.14, 0.0), (0.16, 0.02), (0.16, 0.2), (0.1, 0.3), (0.0, 0.32)], 'glass_dirty', seg=14)
    # --- the radio (secret.radio): a bakelite table set with a dial
    rad = MeshBuilder("secret.radio")
    rf = Frame((L.RADIO[0], L.RADIO[1], L.RADIO[2] - 0.12), math.radians(-35))
    rad.box(rf, (-0.19, -0.10, 0.0), (0.19, 0.10, 0.2), 'radio_case')
    K.lathe(rad, rf.sub((0, 0, 0.2), rot_y=math.pi / 2), [(0.0, -0.19), (0.1, -0.19), (0.1, 0.19), (0.0, 0.19)], 'radio_case', seg=12)
    rad.box(rf, (-0.16, -0.105, 0.04), (0.02, -0.098, 0.2), 'cardboard')           # speaker cloth
    K.lathe(rad, rf.sub((0.1, -0.1, 0.13), rot_x=math.pi / 2), [(0.0, 0.0), (0.05, 0.0), (0.05, 0.01), (0.0, 0.012)], 'plastic_white', seg=12)
    for kx in (0.06, 0.14):
        K.lathe(rad, rf.sub((kx, -0.1, 0.05), rot_x=math.pi / 2), [(0.0, 0.0), (0.02, 0.0), (0.02, 0.02), (0.0, 0.022)], 'bakelite', seg=8)
    rob = K.emit(rad, col, lib, 'station', 'wood', smooth_angle=40)
    rob.name = "secret.radio"
    rob.data.name = "secret.radio"
    # a candle on the counter: the one light inside
    cndl = MeshBuilder("station.candle")
    cp = Vector((cx + 0.25, 11.6, 1.04))
    cndl.cylinder(Frame(cp), (0, 0, 0), 0.03, 0.09, 'wax', segments=10)
    fl = MeshBuilder("station.flame")
    K.lathe(fl, Frame(cp + Vector((0, 0, 0.1))), [(0.0, 0.0), (0.009, 0.01), (0.007, 0.03), (0.0, 0.045)], 'flame', seg=8)
    ld = bpy.data.lights.new("candle.diner", 'POINT')
    ld.energy = 6.0
    ld.color = world.CANDLE
    ld.shadow_soft_size = 0.02
    lo = bpy.data.objects.new("candle.diner", ld)
    lo.location = cp + Vector((0, 0, 0.13))
    lights.objects.link(lo)
    K.emit(walls, col, lib, 'station', 'asphalt')
    K.emit(trim, col, lib, 'station', 'metal')
    K.emit(glass, col, lib, 'station', 'glass')
    K.emit(inner, col, lib, 'station', 'wood', smooth_angle=40)
    K.emit(cndl, col, lib, 'station', 'wood')
    K.emit(fl, col, lib, 'station', 'cloth')
    # props along the front: a soda cooler, trash can, stacked tyres, a bench
    pr = MeshBuilder("station.props")
    pr.box(W, (x0 - 0.75, 3.2, 0.0), (x0 - 0.05, 4.1, 1.0), 'pump_red')
    pr.box(W, (x0 - 0.78, 3.15, 1.0), (x0 - 0.02, 4.15, 1.05), 'chrome')
    oil_drum(pr, Frame((x0 - 0.45, 13.3, 0.0), 0.3), 'drum_red', r)
    tyres = MeshBuilder("station.tyres")
    for k in range(5):
        tf = Frame((x0 - 0.55 + r.uniform(-0.03, 0.03), 5.2 + r.uniform(-0.03, 0.03), 0.02 + k * 0.2), r.uniform(0, 3))
        K.lathe(tyres, tf, [(0.2, 0.0), (0.3, 0.0), (0.34, 0.05), (0.34, 0.15), (0.3, 0.2), (0.2, 0.2)], 'rubber', seg=16, cap_top=False)
    K.emit(pr, col, lib, 'station', 'metal', smooth_angle=40)
    K.emit(tyres, col, lib, 'station', 'metal', smooth_angle=50)


# ---------------------------------------------------------------------------
# The pole sign: MILLER'S (painted), GAS & EATS (neon), an arrow of bulbs

# neon strokes per glyph in a (width 1, height 1) box: lists of polylines
GLYPHS = {
    'G': [[(0.86, 0.80), (0.74, 0.94), (0.50, 1.0), (0.24, 0.93), (0.07, 0.72), (0.03, 0.5), (0.07, 0.27), (0.24, 0.06),
           (0.50, 0.0), (0.74, 0.05), (0.90, 0.2), (0.90, 0.46), (0.55, 0.46)]],
    'A': [[(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)], [(0.22, 0.40), (0.78, 0.40)]],
    'S': [[(0.88, 0.83), (0.70, 0.97), (0.45, 1.0), (0.18, 0.92), (0.08, 0.74), (0.20, 0.57), (0.50, 0.49), (0.80, 0.41),
           (0.93, 0.23), (0.82, 0.06), (0.55, 0.0), (0.28, 0.03), (0.08, 0.17)]],
    'amp': [[(0.95, 0.0), (0.62, 0.34), (0.35, 0.62), (0.26, 0.82), (0.36, 0.98), (0.56, 0.98), (0.64, 0.84), (0.55, 0.68),
             (0.25, 0.48), (0.08, 0.28), (0.12, 0.08), (0.32, 0.0), (0.55, 0.05), (0.78, 0.25), (0.92, 0.46)]],
    'E': [[(0.9, 1.0), (0.0, 1.0), (0.0, 0.0), (0.9, 0.0)], [(0.0, 0.52), (0.72, 0.52)]],
    'T': [[(0.0, 1.0), (1.0, 1.0)], [(0.5, 1.0), (0.5, 0.0)]],
}
SIGN_LETTERS = [('G', 'G'), ('A1', 'A'), ('S1', 'S'), ('amp', 'amp'), ('E', 'E'), ('A2', 'A'), ('T', 'T'), ('S2', 'S')]
LETTER_H = 0.66
LETTER_W = 0.46
TUBE_R = 0.016


def sign_frame():
    """Frame of the neon board's front face: X along the text, Z up, facing -Y (the player)."""
    return Frame((L.POLE_SIGN[0] + 1.25, L.POLE_SIGN[1], 0.0), 0.0)


def neon_letters(lib, col):
    f = sign_frame()
    z0 = L.SIGN_Z[0] + 0.33
    widths = {'G': 1.0, 'A': 1.0, 'S': 0.95, 'amp': 0.95, 'E': 0.82, 'T': 0.95}
    gaps = {3: 0.26, 4: 0.26}         # around the ampersand
    total = sum(widths[g] * LETTER_W for _, g in SIGN_LETTERS) + 0.12 * 7 + sum(gaps.values())
    x = -total / 2
    obs = []
    for i, (name, gl) in enumerate(SIGN_LETTERS):
        if i in gaps:
            x += gaps[i] / 2
        w = widths[gl] * LETTER_W
        mb = MeshBuilder(f"secret.sign.{name}")
        standoff = MeshBuilder(f"sign.standoffs.{name}")
        sh = LETTER_H * (0.8 if gl == 'amp' else 1.0)
        for stroke in GLYPHS[gl]:
            pts = [f.p(x + u * w, -0.09, z0 + v * sh + (0.04 if gl == 'amp' else 0.0)) for u, v in stroke]
            smooth = gl in ('G', 'S', 'amp')
            if smooth:
                pts = K.catmull(pts, 5)
            else:
                # neon benders round every corner a little
                pts = K.catmull(pts, 2)
            K.tube(mb, pts, TUBE_R, 'neon_red', sides=8)
            # electrodes: the dark glass ends where the tube goes into the board
            for end in (pts[0], pts[-1]):
                K.tube(standoff, [end, end + f.d(0, 0.09, 0)], TUBE_R * 1.3, 'neon_dead', sides=6)
        ob = K.emit(mb, col, lib, 'station', 'glass', smooth_angle=60)
        ob.name = f"secret.sign.{name}"
        ob.data.name = ob.name
        c = f.p(x + w / 2, -0.09, z0 + sh / 2)
        tag(ob, letter=name, glyph=gl, neon=1)
        K.emit(standoff, col, lib, 'station', 'metal')
        obs.append(ob)
        x += w + 0.12
        if i in gaps:
            x += gaps[i] / 2
    return obs


def pole_sign(lib, col, lights):
    r = rng("polesign")
    f = sign_frame()
    bw = 5.0
    z0, z1 = L.SIGN_Z
    mb = MeshBuilder("sign.frame")
    # two steel posts, a box sign on them, a painted panel on top
    for px in (L.POLE_SIGN[0], L.POLE_SIGN[0] + 2.6):
        mb.cylinder(Frame((px, L.POLE_SIGN[1] + 0.25, 0.0)), (0, 0, 0), 0.12, z1 + 1.3, 'canopy_white', segments=12)
        mb.cylinder(Frame((px, L.POLE_SIGN[1] + 0.25, 0.0)), (0, 0, 0), 0.22, 0.4, 'curb', segments=12)
    mb.box(f, (-bw / 2, 0.0, z0), (bw / 2, 0.36, z1), 'sign_back')
    mb.box(f, (-bw / 2 - 0.06, -0.02, z0 - 0.06), (bw / 2 + 0.06, 0.38, z0), 'canopy_red')
    mb.box(f, (-bw / 2 - 0.06, -0.02, z1), (bw / 2 + 0.06, 0.38, z1 + 0.06), 'canopy_red')
    for sx in (-1, 1):
        mb.box(f, (sx * (bw / 2 + 0.03) - 0.03, -0.02, z0), (sx * (bw / 2 + 0.03) + 0.03, 0.38, z1), 'canopy_red')
    # MILLER'S: a painted panel above the neon
    from . import signpaint as SP
    pw, ph = 3.2, 0.9
    img = SP.mask("millers", pw, ph, lambda ms: (ms.rect(0.05, 0.05, pw - 0.05, ph - 0.05, ch='B', line=0.04),
                                                 ms.text("Miller's", pw / 2, 0.2, 0.62, face='/System/Library/Fonts/Supplemental/Brush Script.ttf',
                                                         ch='R', jitter=0.2, shadow=(0.03, -0.03))))
    SP_m = SP.metal_sign("millers", img, bg=(0.66, 0.62, 0.52), fill=(0.42, 0.04, 0.03), shadow=(0.05, 0.05, 0.05),
                         accent=(0.42, 0.04, 0.03))
    lib["sign_millers"] = SP_m
    pan = MeshBuilder("sign.millers")
    pz = z1 + 0.2
    pan.quad(f, [(-pw / 2, -0.03, pz), (pw / 2, -0.03, pz), (pw / 2, -0.03, pz + ph), (-pw / 2, -0.03, pz + ph)], 'sign_millers',
             uv=[(0, 0), (pw, 0), (pw, ph), (0, ph)])
    mb.box(f, (-pw / 2 - 0.05, -0.02, pz - 0.05), (pw / 2 + 0.05, 0.1, pz + ph + 0.05), 'sign_back')
    ob = K.emit(pan, col, lib, 'station', 'metal')
    # local UVs for the mask: normalise to 0..1
    import numpy as np
    uvl = ob.data.uv_layers['local']
    a = np.empty(len(ob.data.loops) * 2, np.float32)
    uvl.data.foreach_get('uv', a)
    a = a.reshape(-1, 2)
    a[:, 0] /= pw
    a[:, 1] /= ph
    uvl.data.foreach_set('uv', a.ravel())
    # a row of dead bulbs along the bottom rail (the arrow's chase lights)
    bulbs = MeshBuilder("sign.bulbs")
    for k in range(16):
        bx = -bw / 2 + 0.15 + k * (bw - 0.3) / 15
        K.lathe(bulbs, f.sub((bx, -0.02, z0 - 0.03), rot_x=math.pi), [(0.0, 0.0), (0.03, 0.01), (0.035, 0.04), (0.0, 0.07)],
                'neon_dead', seg=8)
    K.emit(mb, col, lib, 'station', 'metal', smooth_angle=40)
    K.emit(bulbs, col, lib, 'station', 'glass')
    neon_letters(lib, col)
    # the neon's own light on its surroundings: the tubes are emitters, and a
    # soft red area light in front of the board carries the glow to the
    # road and the diner wall (the tubes alone are too small to sample well)
    ld = bpy.data.lights.new("neon.glow", 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size = 4.4
    ld.size_y = 0.7
    ld.energy = 14.0
    ld.spread = 1.4
    ld.color = (1.0, 0.12, 0.08)
    lo = bpy.data.objects.new("neon.glow", ld)
    c = f.p(0.0, -0.25, (z0 + z1) / 2)
    lo.location = c
    lo.rotation_euler = Vector((0, -1, -0.35)).to_track_quat('-Z', 'Y').to_euler()
    lo.visible_camera = False
    lo.visible_glossy = False
    lights.objects.link(lo)
    return c


def dress_bag_top(lib, col):
    """What the defender left on the wall's top, on the left, out of the
    sightlines: an ammo can with its lid up, a box of rifle cartridges, a
    thermos on its side. Seated by casting down onto the bags themselves."""
    from mathutils.bvhtree import BVHTree
    bags = bpy.data.objects.get("bags.wall")
    if bags is None:
        return
    bvh = BVHTree.FromObject(bags, bpy.context.evaluated_depsgraph_get())
    yc = sum(L.BARRICADE_Y) / 2 - 0.08

    def seat(x, y):
        hit = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)), 5.0)
        return hit[0].z if hit[0] is not None else L.BAG_TOP
    mb = MeshBuilder("bags.props")
    x = -3.35
    f = Frame((x, yc, seat(x, yc) - 0.01), 0.25)
    mb.box(f, (-0.14, -0.08, 0.0), (0.14, 0.08, 0.18), 'drum_blue')
    lid = f.sub((0, 0.08, 0.18), rot_x=math.radians(-110))
    mb.box(lid, (-0.145, 0.0, 0.0), (0.145, 0.165, 0.02), 'drum_blue')
    mb.box(f, (-0.02, -0.085, 0.14), (0.02, -0.08, 0.17), 'chrome')
    x = -2.75
    f = Frame((x, yc - 0.02, seat(x, yc) - 0.01), -0.4)
    mb.box(f, (-0.07, -0.045, 0.0), (0.07, 0.045, 0.055), 'cardboard')
    for k in range(5):
        cf = f.sub((-0.05 + k * 0.025, 0.07 + 0.01 * (k % 2), 0.012), rot_y=math.pi / 2)
        mb.cylinder(cf, (0, 0, 0), 0.0055, 0.065, 'chrome', segments=6)
    x = -2.3
    f = Frame((x, yc, seat(x, yc) + 0.03), 1.1)
    mb.cylinder(f.sub((0, 0, 0), rot_y=math.pi / 2), (0, 0, -0.14), 0.04, 0.28, 'stop_red', segments=12)
    K.emit(mb, col, lib, 'near', 'metal', smooth_angle=40)


INFO = {}


def build(lib, col, lights):
    canopy(lib, col)
    pump_island(lib, col)
    sandbags(lib, col)
    bpy.context.view_layer.update()
    dress_bag_top(lib, col)
    INFO.update(truck(lib, col))
    diner(lib, col, lights)
    INFO["neon_centre"] = pole_sign(lib, col, lights)
    return INFO
