"""The asset contract with the game: named nodes and their extras.

See docs/WEB_ARCHITECTURE.md, "Asset contract: High Noon". Everything here is
an empty or a small mesh whose *name and custom properties* are the
interface: camera.player, sun, cover.<id>(.hidden), calib.<n>, secret.*,
glass.<id>, path.chicken.<n>, path.tumbleweed.<n>, ground.shadow.

Orientation convention (documented in extras too): the exporter maps Blender
(x, y, z) to glTF (x, z, -y). Cover empties are built with their Blender -Y
axis toward the player, which is their glTF +Z: a character (facing +Z in
glTF) parented to or copying a cover node faces the player.

Covers are *verified*, not assumed: from the player's eye we ray-cast to the
exposed position (chest and head must be in sight) and to the hidden one
(crouch heights must be blocked), and print a table. Calibration spots are
placed by projecting through camera.player and the viewport positions are
reported for 4:3, 16:9 and 21:9.
"""

import json
import math
import os

import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

from .core import empty, tag, facing_matrix, axis_matrix, MeshBuilder, Frame, rng
from . import glass as GL
from . import lighting, pipeline
from . import buildings as B
from . import props as P

EYE = Vector((0.0, 0.0, pipeline.EYE))
DECK = B.DECK_Z


def to_gltf(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def face_player(p):
    d = Vector((EYE.x - p.x, EYE.y - p.y, 0.0))
    return facing_matrix(d)


# ---------------------------------------------------------------------------
# Visibility

POLY_OWNER = []


def scene_bvh():
    verts, polys = [], []
    POLY_OWNER.clear()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.name.startswith(('glass.', 'ground.shadow')) or ob.get('export', 1) == 0:
            continue
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        POLY_OWNER.extend([ob.name] * len(me.polygons))
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def blocker(bvh, p):
    d = p - EYE
    dist = d.length
    hit = bvh.ray_cast(EYE, d / dist, dist - 0.05)
    if hit[0] is None:
        return None
    return f"{POLY_OWNER[hit[2]]}@{tuple(round(c, 2) for c in hit[0])}"



def seen(bvh, p):
    d = p - EYE
    dist = d.length
    hit = bvh.ray_cast(EYE, d / dist, dist - 0.05)
    return hit[0] is None


def viewport(p, aspect):
    """World point -> (x, y) viewport fractions (0,0 top-left) for the
    player camera at a given aspect (vertical fov fixed)."""
    pitch = math.radians(pipeline.PITCH_DEG)
    fwd = Vector((0, math.cos(pitch), math.sin(pitch)))
    right = Vector((1, 0, 0))
    up = right.cross(fwd)
    if up.z < 0:
        up = -up
    d = p - EYE
    z = d.dot(fwd)
    ty = math.tan(math.radians(pipeline.VFOV_DEG / 2))
    tx = ty * aspect
    return 0.5 + 0.5 * d.dot(right) / z / tx, 0.5 - 0.5 * d.dot(up) / z / ty


def point_for_viewport(vx, vy, z, aspect=4 / 3):
    """Where the ray through viewport (vx, vy) meets the plane of height z."""
    pitch = math.radians(pipeline.PITCH_DEG)
    fwd = Vector((0, math.cos(pitch), math.sin(pitch)))
    right = Vector((1, 0, 0))
    up = right.cross(fwd)
    if up.z < 0:
        up = -up
    ty = math.tan(math.radians(pipeline.VFOV_DEG / 2))
    tx = ty * aspect
    d = fwd + right * ((vx - 0.5) * 2 * tx) + up * ((0.5 - vy) * 2 * ty)
    t = (z - EYE.z) / d.z
    return EYE + d * t


# ---------------------------------------------------------------------------
# Covers

def build_covers(col, blds, lm, bvh):
    specs = []   # (id, kind, emerge, level, exposed, hidden)
    liv_anchors = lm['livery'][1]
    church_anchors = lm['church'][3]
    wt_anchors = lm['water_tower'][2]

    def door_cover(cid, b, key, level=0, depth_in=0.32, out=0.75, floor=None):
        a = b.anchors[key]
        F, s, w = a['frame'], a['s'], a['w']
        z = a['center'].z if floor is None else floor
        near = b.near
        exposed = F.p(s, -out, 0) + Vector((0, 0, z))
        # pressed to the inside of the front wall beside the door, on the
        # near side: the wall shadows it from rays through door and windows
        hidden = F.p(s + near * (w / 2 + 0.45), depth_in, 0) + Vector((0, 0, z))
        specs.append((cid, 'door', 'step_out', level, exposed, hidden))

    def window_cover(cid, b, key, level, floor_z):
        a = b.anchors[key]
        F, s, w = a['frame'], a['s'], a['w']
        near = b.near
        # stands in the window, leans in from beside it (the near side of
        # the frame, which the player cannot see into)
        exposed = F.p(s - near * 0.12, -0.18, 0) + Vector((0, 0, floor_z))   # sash up, leaning out
        hidden = F.p(s + near * (w / 2 + 0.55), 0.55, 0) + Vector((0, 0, floor_z))
        emerge = 'lean_left' if b.side == 'L' else 'lean_right'
        specs.append((cid, 'window', emerge, level, exposed, hidden))

    def behind(cid, kind, prop_pt, level=0, dist=0.75, emerge='rise', z=None):
        """Crouch behind something low (away from the player), rise to fire."""
        p = Vector(prop_pt)
        d = Vector((p.x - EYE.x, p.y - EYE.y, 0)).normalized()
        hp = p + d * dist
        hp.z = p.z if z is None else z
        specs.append((cid, kind, emerge, level, hp.copy(), hp.copy()))

    def corner(cid, hidden, exposed, emerge, level=0, kind='corner'):
        specs.append((cid, kind, emerge, level, Vector(exposed), Vector(hidden)))

    # ---- left side ------------------------------------------------------
    sal = blds['saloon']
    door_cover('saloon.door', sal, 'door')
    # onto the gallery, right up to its boarded rail (seen from the street
    # only there: the rail hides the rest of the gallery floor)
    door_cover('saloon.balcony_door', sal, 'up_door', level=1, out=2.1, floor=4.05 - 0.04)
    F = sal.F
    # gallery rail: crouched behind the boarded rail, rises to shoot
    for cid, fr in (('saloon.balcony_near', 0.12), ('saloon.balcony_far', 0.88)):
        s = sal.s_near(fr)
        p = F.p(s, -2.12, 4.01)
        specs.append((cid, 'roof', 'rise', 1, p.copy(), p.copy()))
    # gallery roof: flat against the false front, then up at the roof edge
    s = sal.s_near(0.35)
    specs.append(('saloon.roof', 'roof', 'rise', 2, F.p(s, -2.3, 7.15), F.p(s, -0.5, 7.36)))
    # alley between saloon and barber: hidden behind the saloon's far corner
    corner('saloon.alley', (-11.3, 31.75, 0.0), (-9.5, 31.6, 0.0), 'lean_left')
    bar = blds['barber']
    door_cover('barber.door', bar, 'door')
    # livery
    la = liv_anchors
    lf = la['door']['frame']
    specs.append(('livery.door', 'door', 'step_out', 0, lf.p(la['door']['s'], -0.9, 0.0),
                  lf.p(la['door']['s'] - 2.4, 1.5, 0.0)))
    specs.append(('livery.loft', 'window', 'step_out', 1, lf.p(la['loft']['s'], -0.08, 6.0),
                  lf.p(la['loft']['s'] - 1.3, 1.2, 6.0)))
    # the broken wagon and the saloon's trough
    (wx, wy, _), wa = P.WAGON
    c, sn_ = math.cos(math.radians(wa)), math.sin(math.radians(wa))
    lx, ly = Vector((c, sn_, 0)), Vector((-sn_, c, 0))
    wc = Vector((wx, wy, 0.0))
    p = wc + lx * 0.45 + ly * 1.05
    specs.append(('street.wagon', 'wagon', 'rise', 0, p.copy(), p.copy()))
    corner('street.wagon_end', wc + lx * 1.3 + ly * 1.2, wc + lx * 2.2 + ly * 0.9, 'lean_left', kind='wagon')

    # ---- right side -----------------------------------------------------
    sh = blds['sheriff']
    door_cover('sheriff.door', sh, 'door')
    behind('sheriff.crates', 'crate', Vector((9.25, 23.35, DECK)), dist=0.75)
    ho = blds['hotel']
    door_cover('hotel.door', ho, 'door')
    for i in (1, 2, 3):
        window_cover(f'hotel.window_up_{i}', ho, f'up_{i}', 1, 4.0)
    corner('hotel.alley', (11.3, 39.2, 0.0), (9.45, 39.3, 0.0), 'lean_right')
    ut = blds['undertaker']
    door_cover('undertaker.door', ut, 'door')
    behind('street.crates_right', 'crate', Vector((5.9, 33.0, 0.0)), dist=0.8)
    # ---- near street cover (10-25 m, where bandits read best) ------------
    from .landscape import ground_z

    def local(key, lx_, ly_):
        (cx, cy, _), ang = P.NEAR_COVER[key]
        a = math.radians(ang)
        x = cx + lx_ * math.cos(a) - ly_ * math.sin(a)
        y = cy + lx_ * math.sin(a) + ly_ * math.cos(a)
        return Vector((x, y, ground_z(x, y)))
    behind('street.pump', 'barrel', local('pump', 0.5, 0.88), dist=0.6)
    behind('street.cart', 'wagon', local('cart', 0.1, 0.0), dist=1.15)
    behind('street.barrels_right', 'barrel', local('barrels_r', 0.45, 0.35), dist=0.62)
    stack = local('freight', 0.0, 0.0)
    d = Vector((stack.x, stack.y, 0)).normalized()
    toward_centre = Vector((-d.y, d.x, 0)) if d.x > 0 else Vector((d.y, -d.x, 0))
    fh = stack + d * 0.95
    fe = fh + toward_centre * 0.85
    fh.z = ground_z(fh.x, fh.y)
    fe.z = ground_z(fe.x, fe.y)
    corner('street.freight', fh, fe, 'lean_right', kind='crate')
    # the high-noon duel: a bandit walks out from the freight to mid-street
    duel = Vector((0.4, 12.5, 0.0))
    duel.z = ground_z(duel.x, duel.y)
    specs.append(('street.duel', 'corner', 'step_out', 0, duel, fh.copy()))
    # ---- far end --------------------------------------------------------
    ca = church_anchors['tower']
    fl = ca['floor']
    specs.append(('church.tower', 'tower', 'rise', 2, fl + Vector((0.55, -0.35, 0.0)), fl + Vector((0.55, -0.1, 0.0))))
    behind('street.far_barrels', 'barrel', Vector((4.4, 50.5, 0.0)), dist=0.8)
    corner('blacksmith', (13.2, 48.4, 0.0), (9.2, 48.4, 0.0), 'lean_right')

    # gameplay flags the game reads: Black Jack's three covers, spots where an
    # innocent looks natural, and the duel spot
    FLAGS = {
        'street.wagon': {'boss': True}, 'saloon.balcony_near': {'boss': True}, 'sheriff.door': {'boss': True},
        'saloon.door': {'townsfolk': True}, 'barber.door': {'townsfolk': True},
        'hotel.window_up_2': {'townsfolk': True}, 'undertaker.door': {'townsfolk': True},
        'street.duel': {'duel': True},
    }
    objs = []
    report = []
    for cid, kind, emerge, level, ex, hd in specs:
        rot = face_player(ex)
        e = empty(f"cover.{cid}", ex, col, rot=rot, size=0.4, display='SINGLE_ARROW',
                  kind=kind, emerge=emerge, level=level, facing='+Z', **FLAGS.get(cid, {}))
        h = empty(f"cover.{cid}.hidden", hd, col, rot=rot, size=0.3, display='PLAIN_AXES',
                  kind=kind, emerge=emerge, level=level, cover=cid)
        objs += [e, h]
        up = Vector((0, 0, 1))
        # a body, not a point: samples across the shoulders and up to the
        # head must mostly be in sight; a crouching man mostly out of it
        side = Vector((ex.y - EYE.y, -(ex.x - EYE.x), 0)).normalized()
        # rising from cover shows head and shoulders; everything else the torso
        # rising from cover, or leaning out of a window, shows head and
        # shoulders; everything else the torso
        hts = (1.45, 1.7) if (emerge == 'rise' or kind == 'window') else (1.25, 1.6)
        body = [ex + up * zz + side * dx for zz in hts for dx in (-0.16, 0.0, 0.16)]
        nvis = sum(seen(bvh, q) for q in body)
        vis_chest = vis_head = nvis >= 4
        # a man hunkered behind a barrel is lower than one behind a wall
        chts = (0.3, 0.55, 0.78) if kind == 'barrel' else (0.3, 0.6, 0.85)
        crouch = [hd + up * zz + side * dx for zz in chts for dx in (-0.15, 0.0, 0.15)]
        hid = sum(seen(bvh, c) for c in crouch) <= 1
        vp = [viewport(ex + up * 1.2, a) for a in (4 / 3, 16 / 9, 21 / 9)]
        if cid == 'street.duel':
            hid = True     # the duel spot is out in the open by design; its 'hidden' is the freight
        report.append(dict(id=cid, kind=kind, emerge=emerge, level=level, exposed_visible=vis_chest and vis_head,
                           flags=list(FLAGS.get(cid, {}).keys()),
                           hidden_hidden=hid, vp_4_3=[round(vp[0][0], 3), round(vp[0][1], 3)],
                           in_4_3=0 <= vp[0][0] <= 1 and 0 <= vp[0][1] <= 1,
                           dist=round((ex - EYE).length, 1),
                           why=[blocker(bvh, ex + up * 1.25), blocker(bvh, ex + up * 1.6)] +
                               ([blocker(bvh, c) for c in crouch] if not hid else [])))
    return objs, report


# ---------------------------------------------------------------------------
# Calibration bottles

CALIB_TARGETS = [  # (n, vx, vy) in 4:3 viewport terms: corners, edges, centre
    (1, 0.17, 0.2), (2, 0.5, 0.26), (3, 0.83, 0.2),
    (4, 0.17, 0.5), (5, 0.5, 0.52), (6, 0.83, 0.5),
    (7, 0.17, 0.8), (8, 0.5, 0.8), (9, 0.83, 0.8),
]


def build_calib(col, lib, blds, lm, grp_builders):
    """Choose a bottle spot for each target on real geometry (sills, rails,
    barrels, a trough...), adding a support prop where the street needs one
    (the little target-practice set near the player)."""
    r = rng("calib")
    spots = {}
    sal = blds['saloon']
    ho = blds['hotel']
    def along(fn, lo, hi, vx, aspect=4 / 3):
        # the point on a ledge (parameterised 0..1) whose viewport x is vx
        best = None
        for i in range(401):
            t = lo + (hi - lo) * i / 400
            p = fn(t)
            err = abs(viewport(p + Vector((0, 0, 0.15)), aspect)[0] - vx)
            if best is None or err < best[0]:
                best = (err, p)
        return best[1]
    # 1 top-left: on the saloon gallery roof's fascia
    spots[1] = along(lambda t: sal.F.p(sal.s_near(t), -2.62, 7.13), 0.0, 0.5, 0.17)
    # 3 top-right: on the top of the HOTEL sign's frame
    spots[3] = along(lambda t: ho.F.p(3.5 * (1 - 2 * t) * ho.near * -1 * -1, -0.13, 9.36), 0.0, 1.0, 0.83)
    # 2 top-centre: on the church belfry's balustrade rail
    ca = lm['church'][3]['tower']['rail']
    spots[2] = ca + Vector((0.35, -0.05, 0.05))
    # 4 mid-left / 6 mid-right: on hitching-rail posts we set where the
    # target lands at post height (0.95 m + post cap)
    wd_l, mt_l = grp_builders('left_near')
    wd_r, mt_r = grp_builders('right_near')
    p4 = point_for_viewport(0.17, 0.53, 1.02)
    P.hitching_rail(wd_l, Frame((p4.x, p4.y, 0.0), math.pi / 2), r, length=2.6, h=0.95)
    spots[4] = Vector((p4.x, p4.y, 1.0))
    p6 = point_for_viewport(0.83, 0.53, 1.02)
    P.hitching_rail(wd_r, Frame((p6.x, p6.y - 2.6, 0.0), math.pi / 2), r, length=2.6, h=0.95)
    spots[6] = Vector((p6.x, p6.y, 1.0))
    # 5 centre: a crate left in the street with a board across it
    p5 = point_for_viewport(0.5, 0.52, 0.9)
    P.crate(wd_l, Frame((p5.x, p5.y, 0.0), 0.2), r, sx=0.8, sy=0.6, sz=0.6)
    P.crate(wd_l, Frame((p5.x + 0.05, p5.y + 0.02, 0.6), -0.15), r, sx=0.55, sy=0.45, sz=0.3)
    spots[5] = Vector((p5.x, p5.y, 0.9))
    from .landscape import ground_z
    from . import clutter as CL
    # 7 bottom-left: an upturned water bucket someone left in the street
    h7 = 0.32
    p7 = point_for_viewport(0.17, 0.76, h7)
    z7 = ground_z(p7.x, p7.y)
    p7 = point_for_viewport(0.17, 0.76, h7 + z7)
    bf = Frame((p7.x, p7.y, z7 - 0.01), 0.3)
    P.barrel(wd_l, mt_l, bf, r, h=h7, rad=0.15)
    spots[7] = Vector((p7.x, p7.y, z7 - 0.01 + h7 - 0.025))   # on the inset lid
    # 8 bottom-centre: a flat slab of sandstone
    p8 = point_for_viewport(0.5, 0.78, 0.2)
    z8 = ground_z(p8.x, p8.y)
    p8 = point_for_viewport(0.5, 0.78, 0.2 + z8)
    n0 = len(wd_l.verts)
    CL.rock(wd_l, Vector((p8.x, p8.y, 0.0)), 0.3, r, mat='stone_boulder', flat=0.72, subdiv=2)
    top8 = max(v.z for v in wd_l.verts[n0:])
    spots[8] = Vector((p8.x, p8.y, top8 - 0.01))
    # 9 bottom-right: a small crate that fell off the freight wagon
    h9 = 0.42
    p9 = point_for_viewport(0.83, 0.76, h9)
    z9 = ground_z(p9.x, p9.y)
    p9 = point_for_viewport(0.83, 0.76, h9 + z9)
    P.crate(wd_r, Frame((p9.x, p9.y, z9 - 0.01), -0.35), r, sx=0.55, sy=0.42, sz=h9 + 0.01, mat='wood_raw')
    spots[9] = Vector((p9.x, p9.y, z9 + h9))
    objs = []
    report = []
    for n, vx, vy in CALIB_TARGETS:
        p = spots[n]
        ob = empty(f"calib.{n}", p, col, size=0.15, display='SPHERE')
        vps = {a_name: [round(c, 3) for c in viewport(p + Vector((0, 0, 0.15)), a)]
               for a_name, a in (('4:3', 4 / 3), ('16:10', 1.6), ('16:9', 16 / 9), ('21:9', 21 / 9))}
        tag(ob, bottle_base=1, distance_m=round((p - EYE).length, 1), vp_4_3=vps['4:3'], vp_16_9=vps['16:9'],
            vp_21_9=vps['21:9'])
        objs.append(ob)
        report.append(dict(n=n, pos=[round(c, 2) for c in p], dist=round((p - EYE).length, 1), **vps))
    return objs, report


# ---------------------------------------------------------------------------
# Paths, sun, shadow plane

def build_paths(col):
    objs = []
    # the chicken pecks along the saloon's boardwalk
    chick = [(-8.25, 17.6), (-8.7, 19.3), (-8.3, 21.1), (-8.8, 22.9), (-8.2, 24.6), (-8.6, 26.4), (-8.15, 28.2),
             (-8.6, 30.0)]
    for i, (x, y) in enumerate(chick, 1):
        objs.append(empty(f"path.chicken.{i}", (x, y, DECK), col, size=0.12, order=i, surface_z=DECK))
    # tumbleweeds blow out of the alley by the hotel, across and down the street
    tw = [(12.8, 25.3, 0.0), (9.6, 25.6, DECK), (7.2, 26.2, 0.0), (4.0, 27.8, 0.0), (0.6, 29.6, 0.0),
          (-2.8, 31.2, 0.0), (-6.2, 32.4, 0.0), (-8.9, 31.9, DECK), (-12.5, 31.8, 0.0)]
    for i, (x, y, z) in enumerate(tw, 1):
        objs.append(empty(f"path.tumbleweed.{i}", (x, y, z), col, size=0.2, order=i, radius_m=0.35))
    return objs


def build_sun(col):
    d = lighting.light_direction()
    ob = empty("sun", (0.0, -20.0, 30.0), col, rot=axis_matrix(d), size=2.0, display='SINGLE_ARROW')
    g = Vector((d.x, d.z, -d.y))
    tag(ob, direction=[round(g.x, 5), round(g.y, 5), round(g.z, 5)], elevation_deg=lighting.SUN_EL_DEG,
        azimuth_deg_from_back=lighting.SUN_AZ_DEG, color=list(lighting.SUN_COLOR),
        strength=lighting.SUN_STRENGTH, angle_deg=lighting.SUN_ANGLE_DEG, axis='-Z along the light')
    return ob


# ---------------------------------------------------------------------------

def build(lib, col, blds, lm):
    # glass panes from every building and the church
    entries = []
    groups = {}
    for b in blds.values():
        for gid, f, rects in b.glass:
            entries.append((gid, f, rects))
            groups[gid] = b.group
    for gid, f, rects in lm['church'][2]:
        entries.append((gid, f, rects))
        groups[gid] = 'far'
    GL.build_panes(lib, col, entries, lambda gid: groups.get(gid, 'far'))

    builders = {}

    def grp_builders(name):
        if name not in builders:
            builders[name] = (MeshBuilder(f"props.calib_{name}.wood"), MeshBuilder(f"props.calib_{name}.metal"))
        return builders[name]
    calib_objs, calib_report = build_calib(col, lib, blds, lm, grp_builders)
    pcol = bpy.data.collections.get("props") or col
    for name, (wd, mt) in builders.items():
        wd.build(pcol, lib, surface='wood', group=name)
        mt.build(pcol, lib, surface='metal', group=name)
    bpy.context.view_layer.update()
    bvh = scene_bvh()
    cover_objs, cover_report = build_covers(col, blds, lm, bvh)
    build_paths(col)
    build_sun(col)
    piano = bpy.data.objects.get('secret.piano')
    piano_report = {}
    if piano is not None:
        mw = piano.matrix_world
        pts = [mw @ Vector(p) for p in ((0, 0.4, 1.0), (0, 0.4, 0.8), (-0.5, 0.4, 1.1), (0.5, 0.4, 1.1), (0, 0.1, 0.75))]
        hits = []
        for p in pts:
            d = p - EYE
            dist = d.length
            h = bvh.ray_cast(EYE, d / dist, dist + 0.5)
            hits.append(POLY_OWNER[h[2]] if h[0] is not None else None)
        piano_report = dict(rays=len(pts), hit_piano=sum(1 for h in hits if h == 'secret.piano'), hits=hits)
        print("PIANO sightline:", piano_report)
    out = dict(covers=cover_report, calib=calib_report, piano=piano_report)
    path = os.path.join(bpy.path.abspath("//") or ".", "contract_report.json")
    try:
        from . import signs
        path = os.path.join(os.path.dirname(signs.OUT_DIR), "contract_report.json")
    except Exception:
        pass
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nCOVERS (exposed visible / hidden hidden / 4:3 viewport / distance)")
    for c in cover_report:
        flag = "" if (c['exposed_visible'] and c['hidden_hidden'] and c['in_4_3']) else "   <-- CHECK"
        print(f"  {c['id']:26s} {c['kind']:7s} {c['emerge']:10s} L{c['level']}  vis={int(c['exposed_visible'])} "
              f"hid={int(c['hidden_hidden'])} vp={c['vp_4_3']} d={c['dist']}{flag}")
        if flag:
            print("       ", c['why'])
    print("CALIB")
    for c in calib_report:
        print(f"  calib.{c['n']}  d={c['dist']:5.1f}  4:3={c['4:3']}  16:9={c['16:9']}  21:9={c['21:9']}")
    return out
