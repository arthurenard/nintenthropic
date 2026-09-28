"""Along Route 9: the split-rail fence, the power line, the sodium
streetlight at the crossroads, the phone booth under it (its light is a
secret), road signs, what people dropped when they ran, and the grass of
the verges.

Bake groups: 'west' (the fence, the west poles, left-side debris), 'station'
(the crossroads: streetlight, booth, signs), 'east' (the branch line).
"""

import math

import bpy
from mathutils import Vector, Matrix

from .common import rng, tag, DC
from . import layout as L, meshkit as K, world
from .meshkit import MeshBuilder, Frame
from .ground import ground_z

W = Frame()
INFO = {}


def group_for(x, y):
    if y > 60:
        return 'far'
    if x < -2.0:
        return 'west'
    if x > 14.0 or y > 29:
        return 'east'
    return 'station'


# ---------------------------------------------------------------------------
# Split-rail fence

def rail(mb, a, b, r, mat='fence_wood'):
    """A split log rail: an irregular wedge section, a little bowed."""
    a, b = Vector(a), Vector(b)
    d = b - a
    n = 5
    pts = [a + d * (i / n) + Vector((r.uniform(-0.01, 0.01), 0, -0.02 * math.sin(math.pi * i / n) + r.uniform(-0.008, 0.008)))
           for i in range(n + 1)]
    w, h = r.uniform(0.07, 0.1), r.uniform(0.08, 0.11)
    t = d.normalized()
    side = Vector((-t.y, t.x, 0.0)).normalized()
    up = Vector((0, 0, 1))
    # triangle-ish section: flat back, split face
    sec = [(-w / 2, -h / 2), (w / 2, -h / 2 + 0.01), (w * 0.3, h / 2), (-w * 0.35, h / 2 - 0.01)]
    rings = [[p + side * sx + up * sz for sx, sz in sec] for p in pts]
    rnd = r.random()
    L_ = d.length
    for i in range(n):
        for k in range(4):
            k2 = (k + 1) % 4
            u0, u1 = L_ * i / n, L_ * (i + 1) / n
            g = [(u0, k * 0.05), (u0, (k + 1) * 0.05), (u1, (k + 1) * 0.05), (u1, k * 0.05)]
            l = [(u0, k / 4), (u0, (k + 1) / 4), (u1, (k + 1) / 4), (u1, k / 4)]
            mb.add_face([tuple(rings[i][k]), tuple(rings[i][k2]), tuple(rings[i + 1][k2]), tuple(rings[i + 1][k])], mat, rnd, g, l)
    mb.add_face([tuple(v) for v in reversed(rings[0])], mat, rnd)
    mb.add_face([tuple(v) for v in rings[-1]], mat, rnd)


def fence(lib, col):
    from .contract import fence_jar_post
    r = rng("fence")
    jar = fence_jar_post()
    mbs = {}

    def mb_for(y):
        g = group_for(L.FENCE_X, y)
        if g not in mbs:
            mbs[g] = MeshBuilder(f"fence.{g}")
        return mbs[g]
    for y0, y1 in L.FENCE_SPANS:
        n = max(1, int(round((y1 - y0) / 2.6)))
        ys = [y0 + (y1 - y0) * i / n for i in range(n + 1)]
        # make sure a post stands where calib jar 4 needs one
        if y0 <= jar.y <= y1:
            k = min(range(len(ys)), key=lambda i: abs(ys[i] - jar.y))
            ys[k] = jar.y
        prev = None
        for i, y in enumerate(ys):
            x = L.FENCE_X + r.uniform(-0.06, 0.06)
            if abs(y - jar.y) < 1e-6:
                x = jar.x
            z = ground_z(x, y)
            top = (jar.z if abs(y - jar.y) < 1e-6 else z + r.uniform(1.25, 1.4))
            lean = (r.uniform(-0.05, 0.05), r.uniform(-0.04, 0.04))
            mb = mb_for(y)
            f = Frame((x, y, z - 0.3), r.uniform(0, 1.5)).sub((0, 0, 0), rot_x=lean[0], rot_y=lean[1])
            mb.box(f, (-0.07, -0.08, 0.0), (0.07, 0.08, top - z + 0.3), 'fence_wood', taper=(0.1, 0.15))
            if prev is not None:
                px, py, pz = prev
                broken = any(g0 < (py + y) / 2 < g1 for g0, g1 in L.FENCE_GAPS)
                for k, hh in enumerate((0.42, 0.78, 1.1)):
                    if broken and k != 0:
                        # the rail knocked down, one end on the ground
                        a = (px, py + 0.2, pz + hh)
                        b = (x + r.uniform(0.2, 0.9), y - 0.3, z + 0.05)
                        rail(mb, a, b, r)
                        continue
                    rail(mb, (px, py + 0.05, pz + hh), (x, y - 0.05, z + hh + r.uniform(-0.03, 0.03)), r)
            prev = (x, y, z)
    for g, mb in mbs.items():
        K.emit(mb, col, lib, g, 'wood')


# ---------------------------------------------------------------------------
# The power line

def power_pole(mb, mt, x, y, r, arms=3, h=9.5, rot=0.0):
    z = ground_z(x, y)
    f = Frame((x, y, z - 1.0), rot).sub((0, 0, 0), rot_x=r.uniform(-0.02, 0.02), rot_y=r.uniform(-0.03, 0.03))
    mb.cylinder(f, (0, 0, 0), 0.15, h + 1.0, 'pole_wood', segments=10, radius_top=0.11)
    top = f.sub((0, 0, h + 0.55))
    mb.box(top, (-1.1, -0.05, -0.06), (1.1, 0.05, 0.06), 'pole_wood')
    for s in (-1, 1):
        mb.board(top, (s * 0.1, 0, -0.5), (s * 0.7, 0, -0.02), 0.05, 0.04, 'pole_wood')
    ins = []
    for k in range(arms):
        ix = (-0.9 + 1.8 * k / max(arms - 1, 1)) if arms > 1 else 0.0
        p = top.p(ix, 0, 0.06)
        K.lathe(mt, Frame(p, 0.0), [(0.02, 0.0), (0.045, 0.02), (0.03, 0.05), (0.045, 0.08), (0.03, 0.11), (0.0, 0.12)],
                'glass_dirty', seg=8)
        ins.append(p + Vector((0, 0, 0.12)))
    # a transformer can on some poles
    return ins


def power_line(lib, col):
    r = rng("power")
    mbs, mts, wires = {}, {}, {}

    def get(g):
        if g not in mbs:
            mbs[g] = MeshBuilder(f"poles.{g}")
            mts[g] = MeshBuilder(f"insulators.{g}")
            wires[g] = MeshBuilder(f"wires.{g}")
        return mbs[g], mts[g], wires[g]
    west = []
    for y in L.POLES_WEST_Y:
        g = group_for(L.POLES_WEST_X, y)
        mb, mt, _ = get(g)
        west.append(power_pole(mb, mt, L.POLES_WEST_X + r.uniform(-0.2, 0.2), y, r, 3))
    for a, b in zip(west[:-1], west[1:]):
        for pa, pb in zip(a, b):
            g = group_for(pa.x, (pa.y + pb.y) / 2)
            _, _, wm = get(g)
            K.tube(wm, K.catenary(pa, pb, 0.9 + r.uniform(-0.1, 0.1), 20), 0.007, 'iron_dark', sides=4, cap=False)
    # the branch across the crossroads to the motel
    br = [(L.POLES_WEST_X, 28.4)] + L.POLES_BRANCH
    tops = []
    for (x, y) in br:
        g = group_for(x, y)
        mb, mt, _ = get(g)
        tops.append(power_pole(mb, mt, x, y, r, 2, h=8.5, rot=math.atan2(y - 25, x) * 0 + math.pi / 2))
    # tee off the main line at the first west pole south of the crossroads
    for a, b in zip(tops[:-1], tops[1:]):
        for pa, pb in zip(a, b):
            g = group_for((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
            _, _, wm = get(g)
            K.tube(wm, K.catenary(pa, pb, 0.8, 24), 0.007, 'iron_dark', sides=4, cap=False)
    # the service drop to the phone booth and the streetlight
    _, _, wm = get('station')
    K.tube(wm, K.catenary(tops[1][0], Vector((L.STREETLIGHT_POLE[0], L.STREETLIGHT_POLE[1], 7.2)), 0.35, 12), 0.006, 'iron_dark', sides=4)
    for g in mbs:
        K.emit(mbs[g], col, lib, g, 'wood')
        K.emit(mts[g], col, lib, g, 'glass', smooth_angle=60)
        ob = K.emit(wires[g], col, lib, g, 'metal', smooth_angle=80)
        if ob is not None:
            ob["no_occlude"] = 1


# ---------------------------------------------------------------------------
# The streetlight

def streetlight(lib, col, lights):
    r = rng("streetlight")
    px, py = L.STREETLIGHT_POLE
    hx, hy, hz = L.STREETLIGHT_HEAD
    z = ground_z(px, py)
    mb = MeshBuilder("streetlight.pole")
    mb.cylinder(Frame((px, py, z)), (0, 0, 0), 0.13, hz + 0.6, 'galvanized', segments=12, radius_top=0.08)
    mb.cylinder(Frame((px, py, z)), (0, 0, 0), 0.2, 0.5, 'curb', segments=12)
    # the arm: out and down to the head
    top = Vector((px, py, hz + 0.45))
    head = Vector((hx, hy, hz + 0.12))
    d = head - top
    arm = K.catmull([top, top + Vector((d.x * 0.3, d.y * 0.3, 0.35)), top + Vector((d.x * 0.75, d.y * 0.75, 0.25)), head], 5)
    K.tube(mb, arm, 0.045, 'galvanized', sides=8)
    # cobra head: a long shell, the refractor bowl underneath (lit)
    hd = Vector((d.x, d.y, 0.0)).normalized()
    ang = math.atan2(hd.y, hd.x) - math.pi / 2
    hf = Frame((hx, hy, hz), ang)
    # the housing: a flat-bottomed shell tapering to the arm; the refractor
    # bowl hangs underneath it and glows
    mb.box(hf, (-0.2, -0.36, 0.02), (0.2, 0.30, 0.11), 'galvanized', taper=(0.35, 0.1))
    mb.box(hf, (-0.08, 0.30, 0.03), (0.08, 0.48, 0.1), 'galvanized')
    lens = MeshBuilder("streetlight.lens")
    K.lathe(lens, hf.sub((0, -0.04, 0.02), rot_x=math.pi), [(0.0, 0.1), (0.1, 0.085), (0.16, 0.05), (0.18, 0.0)], 'sodium_lens',
            seg=16, cap_top=False)
    K.emit(mb, col, lib, 'station', 'metal', smooth_angle=40)
    lo_ = K.emit(lens, col, lib, 'station', 'glass', smooth_angle=60)
    lo_.visible_shadow = False
    ld = bpy.data.lights.new("streetlight", 'SPOT')
    ld.energy = world.STREET_W
    ld.color = world.SODIUM
    ld.spot_size = math.radians(150)
    ld.spot_blend = 0.55
    ld.shadow_soft_size = 0.12
    lo = bpy.data.objects.new("streetlight", ld)
    lo.location = hf.p(0.0, -0.04, -0.1)          # just under the refractor bowl (the housing would shadow it)
    lo.rotation_euler = (0.0, 0.0, 0.0)          # spot shines down -Z
    lo.visible_camera = False
    lights.objects.link(lo)
    lo["flicker"] = 1
    return lo


# ---------------------------------------------------------------------------
# The phone booth

def phone_booth(lib, col, lights):
    from . import signpaint as SP
    r = rng("booth")
    bx, by = L.BOOTH
    z = ground_z(bx, by)
    f = Frame((bx, by, z), math.pi / 2)      # its door (local -Y) faces west, toward the road
    w, h = 0.46, 2.2
    mb = MeshBuilder("booth.frame")
    sh = MeshBuilder("booth.glass")
    mb.box(f, (-w - 0.04, -w - 0.04, 0.0), (w + 0.04, w + 0.04, 0.1), 'curb')
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box(f, (sx * w - 0.035, sy * w - 0.035, 0.1), (sx * w + 0.035, sy * w + 0.035, h), 'booth_alu')
    for zz in (0.1, 0.95, 1.9):
        for sgn in (-1, 1):
            mb.box(f, (-w, sgn * w - 0.02, zz), (w, sgn * w + 0.02, zz + 0.06), 'booth_alu')
            mb.box(f, (sgn * w - 0.02, -w, zz), (sgn * w + 0.02, w, zz + 0.06), 'booth_alu')
    # the lower panels are solid, the upper ones were glass: mostly broken out
    for sgn in (-1, 1):
        mb.box(f, (-w, sgn * w - 0.012, 0.16), (w, sgn * w + 0.012, 0.95), 'booth_red')
        mb.box(f, (sgn * w - 0.012, -w, 0.16), (sgn * w + 0.012, w, 0.95), 'booth_red')
    for k in range(10):
        side = r.choice([0, 1, 2, 3])
        u = r.uniform(-w + 0.08, w - 0.08)
        zc = r.choice([1.0, 1.85, 1.3])
        if side < 2:
            yy = (-1 if side == 0 else 1) * w
            pts = [(u - 0.08, yy, zc), (u + 0.07, yy, zc), (u + r.uniform(-0.04, 0.04), yy, zc + (0.2 if zc < 1.5 else -0.25))]
        else:
            xx = (-1 if side == 2 else 1) * w
            pts = [(xx, u - 0.08, zc), (xx, u + 0.07, zc), (xx, u + r.uniform(-0.04, 0.04), zc + (0.2 if zc < 1.5 else -0.25))]
        P = [f.p(*p) for p in pts]
        sh.add_face([tuple(p) for p in P], 'glass_dirty', r.random())
        sh.add_face([tuple(p) for p in P[::-1]], 'glass_dirty', r.random())
    # roof and the TELEPHONE sign band all round
    mb.box(f, (-w - 0.05, -w - 0.05, h), (w + 0.05, w + 0.05, h + 0.06), 'booth_alu')
    mb.box(f, (-w - 0.02, -w - 0.02, h + 0.06), (w + 0.02, w + 0.02, h + 0.24), 'booth_alu', skip=('-x', '+x', '-y', '+y'))
    mb.box(f, (-w * 0.6, -w * 0.6, h + 0.24), (w * 0.6, w * 0.6, h + 0.28), 'booth_alu')
    img = SP.mask("telephone", 0.9, 0.16, lambda ms: ms.text("TELEPHONE", 0.45, 0.035, 0.1, face='/System/Library/Fonts/Supplemental/Futura.ttc',
                                                             ch='R', jitter=0.0), px_per_m=500)
    lib["sign_telephone"] = SP.metal_sign("telephone", img, bg=(0.78, 0.8, 0.8), fill=(0.08, 0.16, 0.42), wear=0.25, rust=0.2)
    band = MeshBuilder("booth.band")
    for k in range(4):
        sf = f.sub((0, 0, 0), rot_z=k * math.pi / 2)
        band.quad(sf, [(-w - 0.02, -w - 0.021, h + 0.07), (w + 0.02, -w - 0.021, h + 0.07), (w + 0.02, -w - 0.021, h + 0.23),
                       (-w - 0.02, -w - 0.021, h + 0.23)], 'sign_telephone', uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # inside: the payphone, a shelf, the directory hanging on its chain
    mb.box(f, (-0.14, w - 0.12, 1.2), (0.14, w - 0.02, 1.62), 'iron_dark')
    mb.box(f, (-0.2, w - 0.3, 0.95), (0.2, w - 0.02, 0.99), 'booth_alu')
    K.tube(mb, K.catmull([f.p(-0.12, w - 0.1, 1.45), f.p(-0.2, w - 0.18, 1.2), f.p(-0.1, w - 0.25, 1.02), f.p(0.05, w - 0.2, 1.03)], 4),
           0.008, 'rubber', sides=5)
    mb.box(f, (-0.16, w - 0.26, 0.9), (0.06, w - 0.2, 0.99), 'paper')
    # the light: a fluorescent panel in the ceiling (secret.booth.light)
    lp = MeshBuilder("secret.booth.light")
    lp.box(f, (-0.2, -0.2, h - 0.05), (0.2, 0.2, h - 0.01), 'fluoro')
    K.emit(mb, col, lib, 'station', 'metal')
    K.emit(sh, col, lib, 'station', 'glass')
    b = K.emit(band, col, lib, 'station', 'metal')
    import numpy as np
    ob = K.emit(lp, col, lib, 'station', 'glass')
    from .contract import set_origin
    c = f.p(0, 0, h - 0.03)
    set_origin(ob, c)
    tag(ob, role='booth_light')
    ld = bpy.data.lights.new("booth.light", 'AREA')
    ld.shape = 'SQUARE'
    ld.size = 0.38
    ld.energy = 22.0
    ld.color = world.BOOTH_TINT
    lo = bpy.data.objects.new("booth.light", ld)
    lo.location = c - Vector((0, 0, 0.04))
    lo.visible_camera = False
    lights.objects.link(lo)
    INFO["booth_light"] = tuple(c)
    INFO["booth_roof"] = tuple(f.p(0, 0, h + 0.28))


# ---------------------------------------------------------------------------
# Signs

def octagon(r_):
    return [(r_ * math.cos(math.radians(22.5 + 45 * k)), r_ * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]


def signs(lib, col):
    from . import signpaint as SP
    r = rng("signs")
    mb = MeshBuilder("signs.posts")
    faces = MeshBuilder("signs.faces")
    img = SP.mask("stop", 0.76, 0.76, lambda ms: (ms.text("STOP", 0.38, 0.30, 0.2, face='/System/Library/Fonts/Supplemental/Futura.ttc',
                                                         ch='R', jitter=0.0, stretch=0.95),
                                                  ms.fill([(0.38 + 0.36 * math.cos(math.radians(22.5 + 45 * k)),
                                                            0.38 + 0.36 * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)],
                                                          ch='B', z=-0.02, smooth=False)), px_per_m=500)
    lib["sign_stop"] = SP.metal_sign("stop", img, bg=(0.85, 0.83, 0.78), fill=(0.85, 0.83, 0.78), accent=(0.55, 0.05, 0.04),
                                     wear=0.35, rust=0.4)
    for (x, y), face_dir in zip(L.STOP_SIGNS, (math.radians(-60), math.radians(120))):
        z = ground_z(x, y)
        mb.box(Frame((x, y, z), 0.0), (-0.035, -0.035, -0.3), (0.035, 0.035, 2.35), 'galvanized')
        f = Frame((x, y, z + 2.1), face_dir)
        poly = octagon(0.38)
        uv = [((px + 0.38) / 0.76, (pz + 0.38) / 0.76) for px, pz in poly]
        faces.add_face([tuple(f.p(px, -0.045, pz)) for px, pz in poly], 'sign_stop', 0.5, uv, uv)
        faces.add_face([tuple(f.p(px, -0.035, pz)) for px, pz in reversed(poly)], 'galvanized', 0.5)
    # a route marker and a speed sign facing the player
    img = SP.mask("route9", 0.6, 0.75, lambda ms: (ms.text("9", 0.3, 0.12, 0.42, face='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', ch='R', jitter=0.0),
                                                   ms.text("ROUTE", 0.3, 0.6, 0.09, face='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', ch='R', jitter=0.0),
                                                   ms.rect(0.03, 0.03, 0.57, 0.72, ch='G', line=0.025)), px_per_m=500)
    lib["sign_route"] = SP.metal_sign("route9", img, bg=(0.8, 0.8, 0.76), fill=(0.04, 0.04, 0.04), shadow=(0.04, 0.04, 0.04), wear=0.4)
    img = SP.mask("speed", 0.6, 0.75, lambda ms: (ms.text("SPEED", 0.3, 0.58, 0.09, face='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', ch='R', jitter=0.0),
                                                  ms.text("LIMIT", 0.3, 0.46, 0.09, face='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', ch='R', jitter=0.0),
                                                  ms.text("45", 0.3, 0.1, 0.3, face='/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf', ch='R', jitter=0.0),
                                                  ms.rect(0.03, 0.03, 0.57, 0.72, ch='G', line=0.02)), px_per_m=500)
    lib["sign_speed"] = SP.metal_sign("speed", img, bg=(0.8, 0.8, 0.76), fill=(0.04, 0.04, 0.04), shadow=(0.04, 0.04, 0.04), wear=0.4)
    for (x, y, key, tilt) in ((-4.9, 17.5, 'sign_route', 0.1), (3.9, 33.5, 'sign_speed', -0.25)):
        z = ground_z(x, y)
        mb.box(Frame((x, y, z), 0.0).sub((0, 0, 0), rot_y=tilt * 0.3), (-0.035, -0.035, -0.3), (0.035, 0.035, 2.2), 'galvanized')
        f = Frame((x, y - 0.05, z + 1.55), tilt).sub((0, 0, 0), rot_y=tilt * 0.3)
        faces.quad(f, [(-0.3, 0, 0), (0.3, 0, 0), (0.3, 0, 0.75), (-0.3, 0, 0.75)], key, uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
        faces.box(f, (-0.31, 0.0, -0.01), (0.31, 0.02, 0.76), 'galvanized')
    K.emit(mb, col, lib, 'station', 'metal')
    ob = K.emit(faces, col, lib, 'station', 'metal')
    _normalise_local_uv(ob)


def _normalise_local_uv(ob):
    """Quads given explicit 0..1 UVs keep them; extruded faces' planar metres
    are left as they are (the octagon's mask spans its 0.76 m box)."""
    return ob


# ---------------------------------------------------------------------------
# What people left on the road

def debris(lib, col):
    r = rng("debris")
    mbs = {}

    def mb(g, surf):
        k = (g, surf)
        if k not in mbs:
            mbs[k] = MeshBuilder(f"debris.{g}.{surf}")
        return mbs[k]
    # a suitcase burst open, clothes spilled
    x, y = -1.9, 15.8
    z = ground_z(x, y)
    f = Frame((x, y, z), 0.5)
    m = mb(group_for(x, y), 'cloth')
    m.box(f, (-0.36, -0.22, 0.0), (0.36, 0.22, 0.1), 'seat_leather')
    lid = f.sub((0, 0.22, 0.1), rot_x=math.radians(110))
    m.box(lid, (-0.36, 0.0, 0.0), (0.36, 0.44, 0.06), 'seat_leather')
    for k in range(6):
        cf = Frame((x + r.uniform(-0.9, 0.9), y + r.uniform(-0.6, 0.9), z + 0.01), r.uniform(0, 3))
        w_, d_ = r.uniform(0.25, 0.5), r.uniform(0.2, 0.4)
        m.box(cf, (-w_ / 2, -d_ / 2, 0.0), (w_ / 2, d_ / 2, 0.02), r.choice(['cloth_denim', 'cloth_plaid', 'paper']))
    # a bicycle on its side
    x, y = -3.3, 24.2
    z = ground_z(x, y)
    b = mb(group_for(x, y), 'metal')
    bf = Frame((x, y, z + 0.035), 0.9).sub((0, 0, 0), rot_x=math.pi / 2)
    for wx in (-0.52, 0.52):
        K.tube(b, [bf.p(wx + 0.33 * math.cos(2 * math.pi * k / 16), 0.33 * math.sin(2 * math.pi * k / 16), 0) for k in range(16)],
               0.018, 'rubber', sides=5, closed=True)
    frame_pts = [(-0.52, 0.0), (-0.1, 0.0), (0.2, 0.3), (-0.25, 0.32), (-0.1, 0.0), (0.52, 0.0), (0.26, 0.45)]
    K.tube(b, [bf.p(px, py, 0) for px, py in frame_pts], 0.013, 'car_paint2', sides=5)
    # newspapers and a hat along the road
    p = mb('station', 'cloth')
    for k in range(9):
        x, y = r.uniform(-3.4, 3.2), r.uniform(9.0, 34.0)
        g = group_for(x, y)
        m = mb(g, 'cloth')
        f = Frame((x, y, ground_z(x, y) + 0.005), r.uniform(0, 3.1))
        m.quad(f, [(-0.2, -0.15, 0), (0.2, -0.15, 0), (0.2, 0.15, 0.01), (-0.2, 0.15, 0)], 'paper')
    x, y = 2.2, 18.5
    K.lathe(mb('station', 'cloth'), Frame((x, y, ground_z(x, y)), 0.0), [(0.0, 0.0), (0.2, 0.0), (0.2, 0.012), (0.1, 0.02), (0.1, 0.1), (0.0, 0.11)],
            'cloth_hat', seg=14)
    for (g, surf), m in mbs.items():
        K.emit(m, col, lib, g, surf)


# ---------------------------------------------------------------------------
# Grass tufts along the verges and in the cracks

def tufts(lib, col, quick=False):
    from .ground import zones
    import numpy as np
    r = rng("tufts")
    mbs = {}
    n_try = 2000 if quick else 6000
    placed = 0
    for i in range(n_try):
        side = r.choice((-1, 1))
        y = 7.0 + (r.random() ** 1.6) * 80.0
        x = L.ROAD_X + side * (L.ROAD_HALF + r.uniform(0.3, 6.0))
        if r.random() < 0.15:
            x = r.uniform(-9.0, 6.0)
            y = r.uniform(-2.0, 6.4)
        X = np.array([[x]])
        Y = np.array([[y]])
        a, c, gv, s = zones(X, Y)
        hard = float(a[0, 0] + c[0, 0])
        if hard > 0.5 and r.random() > 0.08:
            continue
        # not on the corn field (the corn is there), nor under buildings
        if float(s[0, 0]) > 0.5:
            continue
        if L.STATION[0] - 0.2 < x < L.STATION[1] and L.STATION[2] < y < L.STATION[3]:
            continue
        if 5.9 < x < 34 and L.MOTEL_Y - 1.5 < y < L.MOTEL_Y + L.MOTEL_DEPTH:
            continue
        g = group_for(x, y)
        if g not in mbs:
            mbs[g] = MeshBuilder(f"grass.{g}")
        m = mbs[g]
        z = ground_z(x, y)
        h = r.uniform(0.25, 0.7) * (0.5 if hard > 0.5 else 1.0)
        dry = r.random() < 0.55
        mat = 'dry_grass' if dry else 'green_grass'
        nb = r.randint(4, 7)
        rnd = r.random()
        for k in range(nb):
            a_ = r.uniform(0, 2 * math.pi)
            lean = r.uniform(0.1, 0.6)
            hh = h * r.uniform(0.6, 1.1)
            wb = r.uniform(0.012, 0.02)
            base = Vector((x + r.uniform(-0.06, 0.06), y + r.uniform(-0.06, 0.06), z - 0.02))
            dirv = Vector((math.cos(a_), math.sin(a_), 0.0))
            side_v = Vector((-dirv.y, dirv.x, 0))
            mid = base + dirv * lean * hh * 0.35 + Vector((0, 0, hh * 0.55))
            tip = base + dirv * lean * hh + Vector((0, 0, hh * (1 - lean * 0.3)))
            m.add_face([tuple(base - side_v * wb), tuple(base + side_v * wb), tuple(mid + side_v * wb * 0.7), tuple(mid - side_v * wb * 0.7)],
                       mat, rnd, [(0, 0), (wb, 0), (wb, hh / 2), (0, hh / 2)], [(0, 0), (1, 0), (1, 0.5), (0, 0.5)])
            m.add_face([tuple(mid - side_v * wb * 0.7), tuple(mid + side_v * wb * 0.7), tuple(tip)], mat, rnd,
                       [(0, hh / 2), (wb, hh / 2), (wb / 2, hh)], [(0, 0.5), (1, 0.5), (0.5, 1.0)])
        placed += 1
    for g, m in mbs.items():
        ob = K.emit(m, col, lib, g, 'dirt')
        if ob is not None:
            ob["no_occlude"] = 1
    print(f"  grass tufts: {placed}")


def build(lib, col, lights):
    fence(lib, col)
    power_line(lib, col)
    streetlight(lib, col, lights)
    phone_booth(lib, col, lights)
    signs(lib, col)
    debris(lib, col)
    tufts(lib, col)
