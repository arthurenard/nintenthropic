"""The landmarks that give Dust Creek its silhouette: the livery barn, the
church with its bell tower at the end of the street, the water tower behind
the right-hand roofs, the windmill on the ridge, and the odds and ends that
close the far end (corral, blacksmith's shed, cemetery, a house or two).

The church bell, weather vane, church doors and water tank are emitted as
separate `secret.*` objects whose origins sit where they pivot.
"""

import math

import bpy
import bmesh
from mathutils import Vector, Matrix

from .core import Frame, MeshBuilder, rng, tag, smooth
from . import carpentry as C
from .carpentry import Opening
from . import buildings as B
from . import props as P

CHURCH_Y = 62.0
TOWER_W = 3.4
TOWER_PROJ = 1.4          # tower projects this far in front of the facade
BELFRY_Z = 13.0
YOKE_Z = 15.25
SPIRE_TOP = 20.6


def lathe(mb, f, prof, mat, seg=24, rand=0.5, close_top=True):
    """Surface of revolution about frame Z from a list of (radius, z)."""
    rings = [[(math.cos(2 * math.pi * i / seg) * rr, math.sin(2 * math.pi * i / seg) * rr, z) for i in range(seg)]
             for (rr, z) in prof]
    L = 0.0
    for k in range(len(prof) - 1):
        dl = math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1])
        for i in range(seg):
            j = (i + 1) % seg
            pts = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            g = [(L, i / seg * 2), (L, (i + 1) / seg * 2), (L + dl, (i + 1) / seg * 2), (L + dl, i / seg * 2)]
            # drop degenerate quads at the axis
            if prof[k][0] < 1e-5 and prof[k + 1][0] < 1e-5:
                continue
            mb.add_face([f.p(*p) for p in pts], mat, rand, grain=g, local=g)
        L += dl


# ---------------------------------------------------------------------------
# Livery barn

def livery(lib, col):
    W, D = 13.0, 20.0
    y0 = 40.0
    F = Frame((-B.STREET_HALF - 0.6, y0 + W / 2, 0), math.radians(90))
    r = rng("livery")
    wood = MeshBuilder("bld.livery.wood")
    metal = MeshBuilder("bld.livery.metal")
    inner = MeshBuilder("bld.livery.interior")
    e = 5.2
    pitch = 40.0
    rise = (W / 2) * math.tan(math.radians(pitch))
    gtop = lambda s: e + max(0.0, rise * (1 - abs(s) / (W / 2)))
    near = -1
    s_door = 0.6
    big = Opening('hole', s_door, 0.0, 3.8, 3.9, casing=0.12)
    loft = Opening('hole', s_door, 6.0, 1.5, 1.7, casing=0.1)
    stall = Opening('hole', -4.4, 0.0, 1.15, 2.25, casing=0.1)
    ops = [big, loft, stall]
    C.siding(wood, F, -W / 2, W / 2, 0.0, gtop, ops, 'batten', 'barn_red', r, backing=wood)
    # heavy door frame timbers
    for o in ops:
        wood.box(F, (o.s0 - 0.16, -0.08, o.z), (o.s0, 0.1, o.z1), 'wood_post', grain_axis=2)
        wood.box(F, (o.s1, -0.08, o.z), (o.s1 + 0.16, 0.1, o.z1), 'wood_post', grain_axis=2)
        wood.box(F, (o.s0 - 0.16, -0.1, o.z1), (o.s1 + 0.16, 0.1, o.z1 + 0.2), 'wood_post', grain_axis=0)
    # corner boards
    for s in (-W / 2, W / 2):
        wood.box(F, (s - 0.1, -0.08, 0), (s + 0.1, 0.1, e), 'wood_grey', grain_axis=2)
    # gable trim (barge boards) following the roof
    for sg in (-1, 1):
        wood.board(F, (sg * (W / 2 + 0.55), -0.65, e - 0.46), (0.0, -0.65, e + rise + 0.05), 0.24, 0.05,
                   'wood_grey', up=(0, 0, 1))
    # sliding doors on an iron track
    metal.box(F, (big.s0 - 3.9, -0.16, big.z1 + 0.2), (big.s1 + 0.3, -0.12, big.z1 + 0.28), 'iron')
    for (sa, sb) in ((big.s0 - 1.95, big.s0 - 0.05), (big.s0 + 1.1, big.s1 + 0.05)):
        dfr = F.sub((0, -0.2, 0.05))
        n = 7
        for k in range(n):
            a = sa + (sb - sa) * k / n
            wood.box(dfr, (a + 0.005, -0.03, 0.0), (a + (sb - sa) / n - 0.005, 0.0, 3.95), 'barn_red', rand=r.random(),
                     grain_axis=2)
        for z in (0.2, 1.9, 3.65):
            wood.box(dfr, (sa, -0.06, z), (sb, -0.03, z + 0.18), 'wood_grey', rand=r.random(), grain_axis=0)
        wood.board(dfr, (sa + 0.1, -0.045, 0.35), (sb - 0.1, -0.045, 1.9), 0.16, 0.03, 'wood_grey', up=(0, -1, 0))
        wood.board(dfr, (sa + 0.1, -0.045, 2.05), (sb - 0.1, -0.045, 3.65), 0.16, 0.03, 'wood_grey', up=(0, -1, 0))
        for s in (sa + 0.2, sb - 0.2):
            metal.cylinder(dfr.sub((s, -0.07, 3.98)), (0, 0, 0), 0.07, 0.03, 'iron', segments=10)
    # stall dutch door: lower half closed, upper open with the horse
    wood.box(F, (stall.s0, -0.02, 0.05), (stall.s1, 0.02, 1.25), 'wood_grey', grain_axis=2)
    wood.box(F, (stall.s0 - 0.05, -0.08, 1.2), (stall.s1 + 0.05, 0.04, 1.27), 'wood_grey', grain_axis=0)
    uf = F.sub((stall.s0, 0.0, 1.27)).sub(rot_z=math.radians(-105))
    for k in range(4):
        wood.box(uf, (k * 0.285, -0.02, 0), ((k + 1) * 0.285 - 0.01, 0.02, 0.95), 'wood_grey', grain_axis=2)
    # loft door swung out, hay showing, hoist beam with pulley and rope
    lf = F.sub((loft.s1, -0.02, loft.z)).sub(rot_z=math.radians(115))
    for k in range(5):
        wood.box(lf, (-(k + 1) * 0.3 + 0.01, -0.02, 0), (-k * 0.3, 0.02, 1.65), 'barn_red', rand=r.random(),
                 grain_axis=2)
    wood.box(F, (s_door - 0.1, -1.3, e + rise - 0.6), (s_door + 0.1, 1.0, e + rise - 0.4), 'wood_post', grain_axis=1)
    metal.cylinder(F.sub((s_door, -1.15, e + rise - 0.75)).sub(rot_y=math.pi / 2), (0, 0, -0.03), 0.1, 0.06, 'iron',
                   segments=12)
    wood.cylinder(F, (s_door - 0.05, -1.15, 3.2), 0.012, e + rise - 0.85 - 3.2, 'rope', segments=5)
    hay_mb = MeshBuilder("bld.livery.hay")
    P.hay_pile(hay_mb, F.sub((loft.s, 0.9, loft.z)), r, rad=0.9, h=0.8)
    # side walls
    for s_side in (-W / 2, W / 2):
        if s_side > 0:
            sf = F.sub((W / 2, 0, 0), rot_z=math.pi / 2)
        else:
            sf = F.sub((-W / 2, D, 0), rot_z=-math.pi / 2)
        C.siding(wood, sf, 0.0, D, 0.0, C.top_fn_flat(e), [], 'batten', 'wood_grey', r, backing=wood)
    bf = F.sub((0, D, 0), rot_z=math.pi)
    C.siding(wood, bf, -W / 2, W / 2, 0.0, gtop, [], 'rough', 'wood_grey', r)
    C.gable_roof(wood, F, -W / 2 - 0.02, W / 2 + 0.02, -0.65, D, e, pitch, 'shingle', r, overhang=0.5,
                 style='shingle', fascia_mat='wood_grey')
    # sign over the big door
    from .town import make_sign, sign_panel, combo, border
    sm = make_sign(lib, 'livery', 4.2, 0.75, combo(
        lambda ms, w, h: ms.text("LIVERY & FEED", w / 2, h / 2 - 0.17, 0.5, face='clarendon', shadow=(0.02, -0.02)),
        border(0.05, 0.025)), bg=lin(40, 34, 28), fill=lin(214, 190, 140), shadow=lin(120, 40, 30),
        accent=lin(190, 160, 110), wear=0.5)
    sign_panel(wood, F, s_door - 2.1, big.z1 + 0.45, s_door + 2.1, big.z1 + 1.2, sm, y=-0.1)
    # interior: dim barn with stalls
    for (a, b, zz) in ((-W / 2 + 0.1, W / 2 - 0.1, 0.02),):
        inner.quad(F, [(a, 0.1, zz), (a, 8.0, zz), (b, 8.0, zz), (b, 0.1, zz)], 'dirt_pile')
        inner.quad(F, [(a, 8.0, 0), (a, 8.0, e + 2), (b, 8.0, e + 2), (b, 8.0, 0)], 'wood_interior')
        inner.quad(F, [(a, 0.1, 0), (a, 0.1, e), (a, 8.0, e), (a, 8.0, 0)], 'wood_interior')
        inner.quad(F, [(b, 0.1, 0), (b, 8.0, 0), (b, 8.0, e), (b, 0.1, e)], 'wood_interior')
        inner.quad(F, [(a, 0.1, 3.6), (b, 0.1, 3.6), (b, 8.0, 3.6), (a, 8.0, 3.6)], 'wood_dark')
        inner.quad(F, [(a, 0.1, 3.62), (a, 6.0, 3.62), (b, 6.0, 3.62), (b, 0.1, 3.62)], 'hay')
        # hay loft floor behind the loft door
        inner.quad(F, [(-2.5, 0.12, 5.95), (-2.5, 4.0, 5.95), (3.5, 4.0, 5.95), (3.5, 0.12, 5.95)], 'wood_interior')
    for k in range(3):
        s = -W / 2 + 2.2 + k * 2.2
        inner.box(F, (s - 0.05, 1.0, 0.0), (s + 0.05, 5.0, 1.5), 'wood_dark', grain_axis=1)
    # hay bales, a loose pile, a cart wheel leaning on the wall, barrels
    for (x, y, z, rz) in ((-2.3, -1.1, 0.0, 1.62), (-2.3, -2.1, 0.0, 1.5), (-2.32, -1.15, 0.38, 1.52),
                          (-2.28, -2.05, 0.38, 1.66), (-2.3, -1.6, 0.76, 1.57)):
        P.hay_bale(hay_mb, F.sub((x, y, z), rot_z=rz), r)
    P.hay_bale(hay_mb, F.sub((4.6, -1.2, 0.0), rot_z=-0.1), r)
    P.hay_bale(hay_mb, F.sub((4.1, -1.9, 0.0), rot_z=0.5), r)
    P.hay_pile(hay_mb, F.sub((3.4, -0.9, 0.0)), r, rad=0.8, h=0.5)
    P.wheel(wood, metal, F.sub((5.6, -0.25, 0.62)).sub(rot_x=-0.15), r, radius=0.62)
    P.trough(wood, F.sub((-5.0, -1.6, 0.0), rot_z=0.0), r, L=1.8)
    horse = P.horse_head(col, lib, F.sub((stall.s + 0.05, 0.25, 1.62), rot_z=math.radians(-18)), group='left_far')
    objs = [horse]
    for mb, surf in ((wood, 'wood'), (metal, 'metal'), (inner, 'wood'), (hay_mb, 'cloth')):
        ob = mb.build(col, lib, surface=surf, group='left_far', building='livery')
        objs.append(ob)
    anchors = {
        'door': dict(kind='door', center=F.p(s_door, 0, 0.0), normal=F.d(0, -1, 0), w=3.8, h=3.9, frame=F, s=s_door),
        'loft': dict(kind='window', center=F.p(loft.s, 0, loft.z + 0.8), normal=F.d(0, -1, 0), frame=F,
                     s=loft.s, z=loft.z, w=1.5, h=1.7),
        'hay': dict(kind='crate', center=F.p(-2.3, -1.6, 0.0), frame=F),
    }
    return objs, anchors, F


# ---------------------------------------------------------------------------
# Church

def gothic_opening_top(o, pts=6):
    """Points of a pointed arch over an opening (s, z) in wall coords."""
    out = []
    for i in range(pts + 1):
        t = i / pts
        a = math.pi * t
        s = o.s - math.cos(a) * o.w / 2
        z = o.z1 + math.sin(a) ** 0.8 * o.w * 0.6
        out.append((s, z))
    return out


def church(lib, col):
    r = rng("church")
    W, D = 10.0, 18.0
    F = Frame((0.0, CHURCH_Y, 0.0), 0.0)
    wood = MeshBuilder("bld.church.wood")
    metal = MeshBuilder("bld.church.metal")
    stone = MeshBuilder("bld.church.stone")
    inner = MeshBuilder("bld.church.interior")
    e = 6.2
    pitch = 45.0
    rise = (W / 2) * math.tan(math.radians(pitch))
    gtop = lambda s: e + max(0.0, rise * (1 - abs(s) / (W / 2)))
    floor = 0.6
    # stone plinth
    stone.box(F, (-W / 2 - 0.1, -0.1, 0.0), (W / 2 + 0.1, D + 0.1, floor), 'stone_rubble', rand=0.3, grain_axis=0,
              uv_offset=(0, 0))
    # nave front (behind the tower) with two pointed windows
    wins = [Opening('window', sx * 3.1, floor + 1.5, 0.95, 2.1, casing=0.1) for sx in (-1, 1)]
    C.siding(wood, F, -W / 2, W / 2, floor, gtop, wins, 'clap', 'church_white', r, backing=wood)
    glass = []
    for i, o in enumerate(wins):
        C.casing(wood, F, o, 'trim_white', r, head_cap=False)
        rects = C.sash(wood, F, o, 'trim_white', 2, 4, double_hung=False, r=r)
        glass.append((f"church_front_{i + 1}", F, rects))
        # pointed head: a triangle-ish arch of trim above the window
        arch = gothic_opening_top(o)
        for (a, b) in zip(arch[:-1], arch[1:]):
            wood.board(F, (a[0], -0.07, a[1]), (b[0], -0.07, b[1]), 0.12, 0.04, 'trim_white', up=(0, -1, 0))
    for s in (-W / 2, W / 2):
        wood.box(F, (s - 0.1, -0.08, floor), (s + 0.1, 0.1, e), 'trim_white', grain_axis=2)
    for sg in (-1, 1):
        wood.board(F, (sg * (W / 2 + 0.4), -0.35, e - 0.4), (0.0, -0.35, e + rise + 0.05), 0.26, 0.05, 'trim_white',
                   up=(0, 0, 1))
    # side walls with three pointed windows each
    for s_side in (-W / 2, W / 2):
        if s_side > 0:
            sf = F.sub((W / 2, 0, 0), rot_z=math.pi / 2)
            conv = lambda d: d
        else:
            sf = F.sub((-W / 2, D, 0), rot_z=-math.pi / 2)
            conv = lambda d: D - d
        ops = [Opening('window', conv(d), floor + 1.4, 0.95, 2.3, casing=0.1) for d in (4.0, 9.0, 14.0)]
        C.siding(wood, sf, 0.0, D, floor, C.top_fn_flat(e), ops, 'clap', 'church_white', r, backing=wood)
        for k, o in enumerate(ops):
            C.casing(wood, sf, o, 'trim_white', r, head_cap=False)
            rects = C.sash(wood, sf, o, 'trim_white', 2, 4, double_hung=False, r=r)
            glass.append((f"church_side_{'l' if s_side < 0 else 'r'}{k + 1}", sf, rects))
    bf = F.sub((0, D, 0), rot_z=math.pi)
    C.siding(wood, bf, -W / 2, W / 2, floor, gtop, [], 'clap', 'church_white', r)
    C.gable_roof(wood, F, -W / 2 - 0.02, W / 2 + 0.02, -0.4, D, e, pitch, 'shingle', r, overhang=0.4,
                 style='shingle', fascia_mat='trim_white')

    # --- tower -------------------------------------------------------------
    TW = TOWER_W
    ty0 = -TOWER_PROJ
    TF = F.sub((0, ty0, 0))            # tower front face frame (facing -Y)
    door = Opening('hole', 0.0, floor, 1.7, 2.7, casing=0.12)
    ocul = Opening('hole', 0.0, 8.3, 1.0, 1.0, casing=0.0)
    lou = Opening('hole', 0.0, 10.6, 1.0, 1.5, casing=0.0)
    ttop = C.top_fn_flat(BELFRY_Z)
    C.siding(wood, TF, -TW / 2, TW / 2, floor, ttop, [door, ocul, lou], 'clap', 'church_white', r, backing=wood)
    # tower sides (front half projecting from the nave, back half above the roof)
    for sg in (-1, 1):
        if sg > 0:
            sf = F.sub((TW / 2, ty0, 0), rot_z=math.pi / 2)
            ops = [Opening('hole', 1.7, 10.6, 0.9, 1.5, casing=0.0)]
        else:
            sf = F.sub((-TW / 2, ty0 + TW, 0), rot_z=-math.pi / 2)
            ops = [Opening('hole', TW - 1.7, 10.6, 0.9, 1.5, casing=0.0)]
        C.siding(wood, sf, 0.0, TW, floor, ttop, ops, 'clap', 'church_white', r, backing=wood)
    tbf = F.sub((0, ty0 + TW, 0), rot_z=math.pi)
    C.siding(wood, tbf, -TW / 2, TW / 2, e + rise - 1.0, ttop, [], 'clap', 'church_white', r)
    # corner boards on the tower
    for (x, y) in ((-TW / 2, ty0), (TW / 2, ty0), (-TW / 2, ty0 + TW), (TW / 2, ty0 + TW)):
        wood.box(F, (x - 0.09, y - 0.09, floor), (x + 0.09, y + 0.09, BELFRY_Z), 'trim_white', grain_axis=2)
    # door casing with a pointed head
    C.casing(wood, TF, door, 'trim_white', r, head_cap=False)
    arch = gothic_opening_top(door)
    for (a, b) in zip(arch[:-1], arch[1:]):
        wood.board(TF, (a[0], -0.08, a[1] + 0.12), (b[0], -0.08, b[1] + 0.12), 0.16, 0.05, 'trim_white', up=(0, -1, 0))
    # pointed transom panel over the door (painted, not glass)
    tri = [(door.s0, door.z1), (door.s1, door.z1), (0.0, door.z1 + door.w * 0.55)]
    wood.add_face([TF.p(tri[0][0], 0.02, tri[0][1]), TF.p(tri[1][0], 0.02, tri[1][1]), TF.p(tri[2][0], 0.02, tri[2][1])],
                  'church_white', 0.4)
    # oculus (round window) and louvred belfry-stage openings
    ocf = TF.sub((0.0, -0.02, 8.8)).sub(rot_x=math.pi / 2)
    wood.cylinder(ocf, (0, 0, -0.05), 0.62, 0.1, 'trim_white', segments=20, caps=(True, False))
    glass.append(("church_oculus", TF, [(-0.45, 8.35, 0.45, 9.25, 0.0)]))
    for o, frm in ((lou, TF),):
        for k in range(7):
            z = o.z + 0.1 + k * 0.2
            wood.board(frm, (o.s0, 0.05, z + 0.12), (o.s1, 0.05, z + 0.12), 0.18, 0.02, 'trim_white', up=(0, -1, -1.5))
    # steps
    for k in range(3):
        stone.box(F, (-1.6 + k * 0.1, ty0 - 1.1 + k * 0.35, 0.0), (1.6 - k * 0.1, ty0, (k + 1) * floor / 3),
                  'stone_rubble', rand=0.2 + 0.1 * k, grain_axis=0)
    # belfry: corner posts, rails, a floor, then the spire
    bz = BELFRY_Z
    wood.box(F, (-TW / 2 - 0.12, ty0 - 0.12, bz - 0.15), (TW / 2 + 0.12, ty0 + TW + 0.12, bz + 0.05), 'trim_white',
             grain_axis=0)
    for (x, y) in ((-TW / 2 + 0.15, ty0 + 0.15), (TW / 2 - 0.15, ty0 + 0.15), (-TW / 2 + 0.15, ty0 + TW - 0.15),
                   (TW / 2 - 0.15, ty0 + TW - 0.15)):
        wood.box(F, (x - 0.15, y - 0.15, bz), (x + 0.15, y + 0.15, bz + 2.8), 'trim_white', grain_axis=2)
    for side in range(4):
        # balustrade between posts on each face
        if side == 0:
            fr = F.sub((0, ty0 + 0.15, 0))
        elif side == 1:
            fr = F.sub((0, ty0 + TW - 0.15, 0), rot_z=math.pi)
        elif side == 2:
            fr = F.sub((TW / 2 - 0.15, ty0 + TW / 2, 0), rot_z=math.pi / 2)
        else:
            fr = F.sub((-TW / 2 + 0.15, ty0 + TW / 2, 0), rot_z=-math.pi / 2)
        C.railing(wood, fr, -TW / 2 + 0.3, TW / 2 - 0.3, 0.0, bz, 0.95, 'trim_white', r, baluster=0.08, posts_every=9,
                  solid=True)
        # pointed arch spandrels at the top of each opening
        wood.box(fr, (-TW / 2 + 0.15, -0.1, bz + 2.3), (TW / 2 - 0.15, 0.05, bz + 2.8), 'trim_white', grain_axis=0)
        for sg in (-1, 1):
            wood.board(fr, (sg * (TW / 2 - 0.3), -0.04, bz + 1.9), (0.0, -0.04, bz + 2.35), 0.14, 0.06, 'trim_white',
                       up=(0, 0, 1))
    # belfry floor (dark) and ceiling
    wood.quad(F, [(-TW / 2, ty0, bz + 0.051), (TW / 2, ty0, bz + 0.051), (TW / 2, ty0 + TW, bz + 0.051),
                  (-TW / 2, ty0 + TW, bz + 0.051)], 'wood_dark')
    wood.quad(F, [(-TW / 2, ty0, bz + 2.79), (-TW / 2, ty0 + TW, bz + 2.79), (TW / 2, ty0 + TW, bz + 2.79),
                  (TW / 2, ty0, bz + 2.79)], 'wood_dark')
    # cornice + spire (octagonal pyramid of shingles)
    ct = bz + 2.8
    wood.box(F, (-TW / 2 - 0.2, ty0 - 0.2, ct), (TW / 2 + 0.2, ty0 + TW + 0.2, ct + 0.25), 'trim_white', grain_axis=0)
    sp = MeshBuilder("tmp_spire")
    cy = ty0 + TW / 2
    lathe(wood, F.sub((0, cy, ct + 0.25)), [(TW * 0.62, 0.0), (TW * 0.5, 0.35), (0.05, SPIRE_TOP - ct - 0.25)],
          'shingle', seg=8)
    # finial and the fixed part of the vane: rod + compass letters
    vz = SPIRE_TOP
    metal.cylinder(F, (0, cy, vz - 0.3), 0.025, 1.3, 'iron_black', segments=8)
    for k, (dx, dy) in enumerate(((0, 1), (1, 0), (0, -1), (-1, 0))):
        metal.board(F, (0, cy, vz + 0.35), (dx * 0.45, cy + dy * 0.45, vz + 0.35), 0.015, 0.015, 'iron_black',
                    up=(0, 0, 1))
    metal.cylinder(F, (0, cy, vz + 0.3), 0.06, 0.1, 'iron_black', segments=10)
    # the bell's frame: two posts and bearing blocks the yoke turns in
    for sx in (-1, 1):
        wood.box(F, (sx * 0.75 - 0.1, cy - 0.12, bz), (sx * 0.75 + 0.1, cy + 0.12, YOKE_Z + 0.15), 'wood_dark',
                 grain_axis=2)
        metal.box(F, (sx * 0.75 - 0.12, cy - 0.1, YOKE_Z - 0.08), (sx * 0.75 + 0.12, cy + 0.1, YOKE_Z + 0.08), 'iron')
    # interior (seen through the doors if they open)
    inner.quad(F, [(-W / 2 + 0.1, 0.1, floor + 0.01), (-W / 2 + 0.1, D - 0.1, floor + 0.01),
                   (W / 2 - 0.1, D - 0.1, floor + 0.01), (W / 2 - 0.1, 0.1, floor + 0.01)], 'wood_interior')
    inner.quad(F, [(-W / 2 + 0.1, D - 0.2, floor), (-W / 2 + 0.1, D - 0.2, e), (W / 2 - 0.1, D - 0.2, e),
                   (W / 2 - 0.1, D - 0.2, floor)], 'paint_cream')
    inner.quad(F, [(-TW / 2 + 0.05, ty0 + 0.1, floor + 0.01), (-TW / 2 + 0.05, 0.2, floor + 0.01),
                   (TW / 2 - 0.05, 0.2, floor + 0.01), (TW / 2 - 0.05, ty0 + 0.1, floor + 0.01)], 'wood_interior')
    for sx in (-1, 1):
        inner.quad(F, [(sx * (TW / 2 - 0.05), ty0 + 0.1, floor), (sx * (TW / 2 - 0.05), 0.2, floor),
                       (sx * (TW / 2 - 0.05), 0.2, 4.0), (sx * (TW / 2 - 0.05), ty0 + 0.1, 4.0)][::sx], 'paint_cream')
    for k in range(5):
        y = 2.0 + k * 2.2
        for sx in (-1, 1):
            inner.box(F, (sx * 0.9 if sx > 0 else -4.0, y, floor), (4.0 if sx > 0 else -0.9, y + 0.45, floor + 0.5),
                      'wood_dark', grain_axis=0)
    objs = []
    for mb, surf in ((wood, 'wood'), (metal, 'metal'), (stone, 'stone'), (inner, 'wood')):
        ob = mb.build(col, lib, surface=surf, group='far', building='church')
        if ob:
            objs.append(ob)

    # --- secrets -------------------------------------------------------------
    secrets = {}
    # the bell, hung from its yoke; origin on the yoke axis (it swings about X)
    bell = MeshBuilder("secret.bell")
    lf = Frame()
    prof_out = [(0.44, -0.8), (0.445, -0.77), (0.41, -0.71), (0.34, -0.58), (0.3, -0.42), (0.28, -0.27),
                (0.27, -0.17), (0.25, -0.1), (0.18, -0.06), (0.06, -0.05), (0.0, -0.05)]
    lathe(bell, lf, prof_out, 'bronze', seg=28, rand=0.3)
    prof_in = [(0.0, -0.09), (0.2, -0.1), (0.24, -0.17), (0.25, -0.27), (0.27, -0.42), (0.31, -0.58), (0.38, -0.71),
               (0.415, -0.79), (0.44, -0.8)]
    lathe(bell, lf, prof_in, 'iron_black', seg=28, rand=0.3)
    # crown/canons and the wooden yoke (the axle runs along X)
    bell.box(lf, (-0.12, -0.08, -0.06), (0.12, 0.08, 0.02), 'bronze', rand=0.2)
    bell.box(lf, (-0.7, -0.11, -0.02), (0.7, 0.11, 0.2), 'wood_dark', rand=0.5, grain_axis=0)
    for sx in (-1, 1):
        bell.cylinder(lf.sub((sx * 0.7, 0, 0)).sub(rot_y=math.pi / 2), (0, 0, -0.08 if sx < 0 else 0.0), 0.04, 0.08,
                      'iron', segments=8)
    # clapper
    bell.cylinder(lf, (0, 0, -0.62), 0.018, 0.55, 'iron_black', segments=6)
    bmx = bmesh.new()
    bmesh.ops.create_uvsphere(bmx, u_segments=8, v_segments=6, radius=0.06)
    bell.add_bmesh(lf.sub((0, 0, -0.64)), bmx, 'iron_black')
    bmx.free()
    ob = bell.build(col, lib, surface='metal', group='far')
    ob.location = F.p(0, cy, YOKE_Z)
    tag(ob, pivot='yoke', swing_axis='x')
    secrets['bell'] = ob

    # weather vane: arrow + rooster silhouette turning on the rod's axis
    vane = MeshBuilder("secret.vane")
    lf = Frame()
    vane.cylinder(lf, (0, 0, -0.08), 0.035, 0.16, 'iron_black', segments=8)
    vane.board(lf, (-0.55, 0, 0.0), (0.6, 0, 0.0), 0.025, 0.02, 'iron_black', up=(0, 0, 1))
    # arrow head (points +X) and tail feathers
    vane.add_face([lf.p(0.6, 0.01, -0.1), lf.p(0.82, 0.01, 0.0), lf.p(0.6, 0.01, 0.1)], 'iron_black', 0.3)
    vane.add_face([lf.p(0.6, -0.01, 0.1), lf.p(0.82, -0.01, 0.0), lf.p(0.6, -0.01, -0.1)], 'iron_black', 0.3)
    tail = [(-0.55, -0.02), (-0.3, 0.2), (-0.72, 0.24), (-0.72, -0.2), (-0.3, -0.18)]
    for yy, rev in ((0.01, False), (-0.01, True)):
        pts = [lf.p(x, yy, z) for (x, z) in tail]
        vane.add_face(pts[::-1] if rev else pts, 'iron_black', 0.3)
    # rooster riding the arrow
    rooster = [(-0.12, 0.02), (0.1, 0.02), (0.18, 0.1), (0.2, 0.25), (0.26, 0.3), (0.22, 0.36), (0.16, 0.33),
               (0.1, 0.22), (-0.05, 0.2), (-0.2, 0.32), (-0.26, 0.22), (-0.18, 0.1)]
    for yy, rev in ((0.008, False), (-0.008, True)):
        pts = [lf.p(x, yy, z) for (x, z) in rooster]
        vane.add_face(pts[::-1] if rev else pts, 'iron_black', 0.5)
    ob = vane.build(col, lib, surface='metal', group='far')
    ob.location = F.p(0, cy, vz + 0.62)
    ob.rotation_euler = (0, 0, math.radians(-35))
    tag(ob, pivot='axis', pointer_axis='+X', spin_axis='up')
    secrets['vane'] = ob

    # church doors, pivots at the hinges, opening inward
    for side, sx in (('left', -1), ('right', 1)):
        d = MeshBuilder(f"secret.church_doors.{side}")
        lf = Frame()
        w = door.w / 2 - 0.01
        a, b = (0.0, w) if side == 'left' else (-w, 0.0)
        C.panel_door(d, lf, a, b, 0.0, door.h - 0.02, 'paint_red', r, hinge='left' if side == 'left' else 'right',
                     open_deg=0.0, y=0.0)
        for zz in (0.35, door.h - 0.45):
            d.box(lf, (a + 0.02, -0.035, zz), (b - 0.02, -0.025, zz + 0.05), 'iron_black', rand=0.1, grain_axis=0)
        ob = d.build(col, lib, surface='wood', group='far')
        ob.location = TF.p(sx * door.w / 2, 0.06, floor)
        tag(ob, pivot='hinge', open_sign=1 if side == 'left' else -1, open_deg=95)
        secrets[f'church_doors.{side}'] = ob

    anchors = {
        'tower': dict(kind='tower', floor=F.p(0, ty0 + 0.6, bz + 0.05), normal=F.d(0, -1, 0),
                      rail=F.p(0, ty0 + 0.15, bz + 0.9)),
        'door': dict(kind='door', center=TF.p(0, 0, floor), normal=F.d(0, -1, 0)),
        'corner_l': dict(kind='corner', corner=F.p(-W / 2, 0.0, floor)),
        'corner_r': dict(kind='corner', corner=F.p(W / 2, 0.0, floor)),
    }
    return objs, secrets, glass, anchors, F


# ---------------------------------------------------------------------------
# Water tower

def water_tower(lib, col, x=21.0, y=45.0):
    r = rng("watertower")
    F = Frame((x, y, 0.0), math.radians(12))
    wood = MeshBuilder("bld.watertower.wood")
    metal = MeshBuilder("bld.watertower.metal")
    base_z = 10.2
    R = 2.7
    Ht = 4.3
    # legs (splayed) and bracing
    legs = []
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        top = Vector((sx * 1.9, sy * 1.9, base_z - 0.3))
        bot = Vector((sx * 2.6, sy * 2.6, 0.0))
        legs.append((bot, top))
        wood.board(F, bot, top, 0.3, 0.3, 'wood_post', up=(sx, sy, 0))
        wood.box(F, (bot.x - 0.35, bot.y - 0.35, -0.1), (bot.x + 0.35, bot.y + 0.35, 0.35), 'stone_rubble' if False else
                 'wood_dark', grain_axis=0)
    for k in range(4):
        a0, a1 = legs[k], legs[(k + 1) % 4]
        for t0, t1 in ((0.05, 0.5), (0.5, 0.95)):
            p0 = a0[0].lerp(a0[1], t0)
            p1 = a1[0].lerp(a1[1], t1)
            metal.board(F, p0, p1, 0.03, 0.03, 'iron_rusty', up=(0, 0, 1))
            p0 = a0[0].lerp(a0[1], t1)
            p1 = a1[0].lerp(a1[1], t0)
            metal.board(F, p0, p1, 0.03, 0.03, 'iron_rusty', up=(0, 0, 1))
        for t in (0.5, 0.97):
            wood.board(F, a0[0].lerp(a0[1], t), a1[0].lerp(a1[1], t), 0.2, 0.08, 'wood_post', up=(0, 0, 1))
    # platform + catwalk railing
    wood.box(F, (-3.2, -3.2, base_z - 0.3), (3.2, 3.2, base_z - 0.1), 'wood_raw', grain_axis=0)
    for k in range(4):
        fr = F.sub((0, 0, 0), rot_z=k * math.pi / 2)
        C.railing(wood, fr.sub((0, -3.1, 0)), -3.1, 3.1, 0.0, base_z - 0.1, 1.0, 'wood_raw', r, baluster=0.09,
                  posts_every=3.0, spindle=None)
    # ladder up one leg
    lf = F.sub((0, -3.0, 0))
    for sx in (-0.25, 0.25):
        wood.box(lf, (sx - 0.03, -0.03, 0.0), (sx + 0.03, 0.03, base_z + 0.9), 'wood_raw', grain_axis=2)
    for k in range(int((base_z - 0.2) / 0.35)):
        wood.box(lf, (-0.25, -0.02, 0.3 + k * 0.35), (0.25, 0.02, 0.33 + k * 0.35), 'wood_raw', grain_axis=0)
    # the tank (secret): staves + hoops + conical roof, origin at the base centre
    tank = MeshBuilder("secret.water_tower")
    tf = Frame()
    seg = 36
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        rr = r.random()
        p = [(math.cos(a0) * R, math.sin(a0) * R, 0.0), (math.cos(a1) * R, math.sin(a1) * R, 0.0),
             (math.cos(a1) * R, math.sin(a1) * R, Ht), (math.cos(a0) * R, math.sin(a0) * R, Ht)]
        u0, u1 = a0 * R, a1 * R
        tank.add_face([tf.p(*q) for q in p], 'wood_tank', rr, grain=[(0, u0), (0, u1), (Ht, u1), (Ht, u0)],
                      local=[(0, 0), (0, 1), (Ht, 1), (Ht, 0)])
    tank.quad(tf, [(math.cos(2 * math.pi * i / seg) * R, math.sin(2 * math.pi * i / seg) * R, 0.0) for i in range(seg)][::-1]
              if False else [(-R, -R, 0.0), (-R, R, 0.0), (R, R, 0.0), (R, -R, 0.0)], 'wood_dark')
    for k in range(6):
        z = 0.3 + k * (Ht - 0.5) / 5
        tank.cylinder(tf, (0, 0, z), R + 0.02, 0.06, 'iron_rusty', segments=seg, caps=(False, False))
    lathe(tank, tf.sub((0, 0, Ht)), [(R + 0.25, 0.0), (R + 0.2, 0.12), (0.12, 1.4), (0.0, 1.45)], 'tin_roof', seg=seg)
    tank.cylinder(tf, (0, 0, Ht + 1.4), 0.08, 0.35, 'iron_black', segments=8)
    # the spout: a pivoting chute folded up against the tank
    tank.board(tf, (R * 0.7, -R * 0.7, 1.0), (R * 0.7 + 0.9, -R * 0.7 - 0.9, -0.2), 0.3, 0.2, 'wood_dark', up=(0, 0, 1))
    ob = tank.build(col, lib, surface='wood', group='far')
    ob.location = F.p(0, 0, base_z - 0.1)
    ob.rotation_euler = (0, 0, math.radians(12))
    tag(ob, leak='hit_point')
    objs = [ob]
    for mb, surf in ((wood, 'wood'), (metal, 'metal')):
        o = mb.build(col, lib, surface=surf, group='far', building='watertower')
        objs.append(o)
    anchors = {'platform': dict(kind='roof', center=F.p(0, -3.0, base_z - 0.1), rail=F.p(0, -3.1, base_z + 0.9))}
    return objs, ob, anchors


# ---------------------------------------------------------------------------
# Windmill on the ridge

def windmill(lib, col, x, y, z0):
    F = Frame((x, y, z0), math.radians(-20))
    r = rng("windmill")
    metal = MeshBuilder("far.windmill.metal")
    wood = MeshBuilder("far.windmill.wood")
    H = 11.0
    legs = [(sx, sy) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for (sx, sy) in legs:
        metal.board(F, (sx * 1.6, sy * 1.6, -0.5), (sx * 0.28, sy * 0.28, H), 0.08, 0.08, 'iron', up=(sx, sy, 0))
    for k in range(6):
        t0 = k / 6
        t1 = (k + 1) / 6
        for i in range(4):
            a = legs[i]
            b = legs[(i + 1) % 4]
            pa0 = Vector((a[0] * (1.6 - 1.32 * t0), a[1] * (1.6 - 1.32 * t0), -0.5 + (H + 0.5) * t0))
            pb1 = Vector((b[0] * (1.6 - 1.32 * t1), b[1] * (1.6 - 1.32 * t1), -0.5 + (H + 0.5) * t1))
            pb0 = Vector((b[0] * (1.6 - 1.32 * t0), b[1] * (1.6 - 1.32 * t0), -0.5 + (H + 0.5) * t0))
            pa1 = Vector((a[0] * (1.6 - 1.32 * t1), a[1] * (1.6 - 1.32 * t1), -0.5 + (H + 0.5) * t1))
            metal.board(F, pa0, pb1, 0.03, 0.02, 'iron', up=(0, 0, 1))
            metal.board(F, pb0, pa1, 0.03, 0.02, 'iron', up=(0, 0, 1))
            metal.board(F, pa0, pb0, 0.04, 0.03, 'iron', up=(0, 0, 1))
    # head, wheel of 18 blades, tail vane
    hf = F.sub((0, 0, H + 0.3))
    metal.box(hf, (-0.2, -0.3, -0.2), (0.2, 0.5, 0.25), 'iron')
    wf = hf.sub((0, -0.45, 0.05)).sub(rot_x=math.pi / 2)
    metal.cylinder(wf, (0, 0, -0.1), 0.18, 0.2, 'iron', segments=10)
    for k in range(18):
        a = 2 * math.pi * k / 18
        d = Vector((math.cos(a), math.sin(a), 0))
        p0 = d * 0.5
        p1 = d * 1.95
        n = Vector((-d.y, d.x, 0))
        pts = [p0 - n * 0.09, p1 - n * 0.2, p1 + n * 0.2 + Vector((0, 0, 0.1)), p0 + n * 0.09 + Vector((0, 0, 0.05))]
        metal.add_face([wf.p(*q) for q in pts], 'tin_roof', r.random())
        metal.add_face([wf.p(*q) for q in reversed(pts)], 'tin_roof', r.random())
    for rad in (0.5, 1.2, 1.95):
        metal.cylinder(wf, (0, 0, 0.02), rad, 0.03, 'iron', segments=24, caps=(False, False))
    metal.board(hf, (0, 0.3, 0), (0, 2.6, 0.1), 0.06, 0.06, 'iron', up=(0, 0, 1))
    metal.add_face([hf.p(0, 1.6, -0.4), hf.p(0, 3.2, -0.3), hf.p(0, 3.2, 0.7), hf.p(0, 1.6, 0.5)], 'tin_roof', 0.5)
    metal.add_face([hf.p(0, 1.6, 0.5), hf.p(0, 3.2, 0.7), hf.p(0, 3.2, -0.3), hf.p(0, 1.6, -0.4)], 'tin_roof', 0.5)
    # a stock tank at its foot
    wood.cylinder(F, (2.5, 1.0, -0.3), 1.4, 0.8, 'wood_tank', segments=20, caps=(False, True))
    objs = [metal.build(col, lib, surface='metal', group='far'), wood.build(col, lib, surface='wood', group='far')]
    return objs


# ---------------------------------------------------------------------------
# The far end: corral, blacksmith, cemetery, houses flanking the church

def fence(mb, f, a, b, r, h=1.3, rails=3, mat='wood_grey', post_every=2.4, broken=()):
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    n = max(1, int(round(L / post_every)))
    d = (b - a) / n
    for i in range(n + 1):
        p = a + d * i
        tilt = r.uniform(-0.05, 0.05)
        mb.box(f.sub((p.x, p.y, 0), rot_z=r.uniform(0, 1)).sub(rot_x=tilt), (-0.07, -0.07, -0.1), (0.07, 0.07, h),
               mat, grain_axis=2)
    for k in range(rails):
        z = 0.35 + k * (h - 0.45) / max(1, rails - 1)
        for i in range(n):
            if (i, k) in broken:
                continue
            p0 = a + d * i + Vector((0, 0, z + r.uniform(-0.03, 0.03)))
            p1 = a + d * (i + 1) + Vector((0, 0, z + r.uniform(-0.03, 0.03)))
            mb.board(f, p0, p1, 0.12, 0.04, mat, up=(0, 0, 1))


def far_end(lib, col):
    r = rng("farend")
    W = Frame()
    wood = MeshBuilder("far.misc.wood")
    metal = MeshBuilder("far.misc.metal")
    # corral beside the livery
    fence(wood, W, (-10.4, 54.6, 0), (-10.4, 60.5, 0), r, broken={(1, 2)})
    fence(wood, W, (-10.4, 60.5, 0), (-22.0, 60.5, 0), r)
    fence(wood, W, (-22.0, 60.5, 0), (-22.0, 53.5, 0), r)
    # cemetery on the rise right of the church: picket fence and crosses
    fence(wood, W, (12.5, 52.0, 0), (12.5, 66.0, 0), r, h=1.0, rails=2, mat='wood_grey', post_every=2.0)
    fence(wood, W, (12.5, 52.0, 0), (24.0, 52.0, 0), r, h=1.0, rails=2, post_every=2.0)
    for i in range(14):
        x = r.uniform(14.0, 23.0)
        y = r.uniform(53.5, 65.0)
        h = r.uniform(0.8, 1.25)
        lean = r.uniform(-0.12, 0.12)
        cf = W.sub((x, y, 0), rot_z=r.uniform(-0.3, 0.3)).sub(rot_y=lean)
        wood.box(cf, (-0.04, -0.03, -0.2), (0.04, 0.03, h), 'wood_grey', grain_axis=2)
        wood.box(cf, (-0.25, -0.03, h - 0.3), (0.25, 0.03, h - 0.22), 'wood_grey', grain_axis=0)
        # mound
        wood.box(cf, (-0.35, 0.1, -0.1), (0.35, 1.9, 0.12), 'dirt_pile', grain_axis=1)
    # blacksmith: open-fronted shed on the right past the undertaker
    bs = Frame((B.STREET_HALF + 1.0, 50.5, 0), math.radians(-90))
    for (s, y) in ((-3.0, 0.0), (3.0, 0.0), (-3.0, 5.0), (3.0, 5.0)):
        wood.box(bs, (s - 0.1, y - 0.1, 0), (s + 0.1, y + 0.1, 3.4), 'wood_post', grain_axis=2)
    C.shed_roof(metal, bs, -3.4, 3.4, 5.4, -0.6, 3.9, 3.3, 'tin_roof', r)
    bsw = bs.sub((0, 5.0, 0), rot_z=math.pi)
    C.siding(wood, bsw, -3.0, 3.0, 0.0, C.top_fn_flat(3.8), [], 'rough', 'wood_grey', r, backing=wood)
    for sg in (-1, 1):
        sf = bs.sub((sg * 3.0, 0, 0), rot_z=sg * math.pi / 2) if sg > 0 else bs.sub((-3.0, 5.0, 0), rot_z=-math.pi / 2)
        C.siding(wood, sf, 0.0, 5.0, 0.0 if sg > 0 else 1.8, C.top_fn_flat(3.5), [], 'rough', 'wood_grey', r,
                 backing=wood if sg > 0 else None)
    # forge + anvil
    P.crate(wood, bs.sub((-1.5, 3.8, 0)), r, sx=1.2, sy=1.0, sz=0.9, mat='stone_rubble')
    metal.box(bs, (0.3, 2.5, 0.0), (0.6, 2.8, 0.55), 'wood_dark')
    metal.box(bs, (0.1, 2.52, 0.55), (0.8, 2.78, 0.75), 'iron_black')
    P.barrel(wood, metal, bs.sub((2.3, 0.6, 0)), r)
    P.wheel(wood, metal, bs.sub((-2.6, -0.3, 0.6)).sub(rot_z=0.3, rot_x=-0.2), r, radius=0.6)
    # a small house either side of the church
    objs = []
    for key, x, y, rot, mat in (('house_l', -15.5, 64.0, 0.0, 'wood_grey'), ('house_r', 30.0, 70.0, -0.2, 'paint_cream')):
        hF = Frame((x, y, 0), rot)
        hw = MeshBuilder(f"far.{key}.wood")
        W_, D_ = 7.0, 6.0
        e = 3.2
        rise = 3.5 * math.tan(math.radians(32))
        ops = [Opening('window', -1.8, 1.0, 0.9, 1.3, casing=0.09), Opening('door', 1.2, 0.2, 1.0, 2.1, casing=0.09)]
        gt = lambda s: e + max(0.0, rise * (1 - abs(s) / 3.5))
        C.siding(hw, hF, -W_ / 2, W_ / 2, 0.0, gt, ops, 'rough', mat, r, backing=hw)
        for o in ops:
            C.casing(hw, hF, o, 'trim_dark', r)
        C.sash(hw, hF, ops[0], 'trim_dark', 2, 2, r=r)
        C.panel_door(hw, hF, ops[1].s0, ops[1].s1, ops[1].z, ops[1].z1, 'paint_brown', r)
        for s_side in (-1, 1):
            sf = hF.sub((W_ / 2, 0, 0), rot_z=math.pi / 2) if s_side > 0 else hF.sub((-W_ / 2, D_, 0), rot_z=-math.pi / 2)
            C.siding(hw, sf, 0.0, D_, 0.0, C.top_fn_flat(e), [], 'rough', mat, r)
        C.gable_roof(hw, hF, -W_ / 2, W_ / 2, -0.3, D_, e, 32, 'shingle', r, overhang=0.35, style='shingle')
        hw.box(hF, (1.8, 3.0, e), (2.4, 3.6, e + 3.0), 'stone_rubble', grain_axis=2)
        objs.append(hw.build(col, lib, surface='wood', group='far', building=key))
    for mb, surf in ((wood, 'wood'), (metal, 'metal')):
        objs.append(mb.build(col, lib, surface=surf, group='far'))
    return objs


def build(lib, col):
    from .materials import wood as wood_mat, lin as _lin
    wood_mat("barn_red", paint=_lin(118, 44, 32), paint_amount=1.0, wear=0.72, bleach=0.7)
    wood_mat("wood_tank", bleach=0.55, light=_lin(128, 108, 88), dark=_lin(70, 58, 48), dirt=0.3, nails=0.0)
    out = {}
    out['livery'] = livery(lib, col)
    out['church'] = church(lib, col)
    out['water_tower'] = water_tower(lib, col)
    out['far'] = far_end(lib, col)
    import numpy as np
    from .landscape import terrain_height
    wx, wy = -52.0, 214.0
    wz = float(terrain_height(np.array([[wx]]), np.array([[wy]]))[0, 0])
    out['windmill'] = windmill(lib, col, wx, wy, wz)
    return out


from .materials import lin  # noqa: E402  (used by the livery sign)
