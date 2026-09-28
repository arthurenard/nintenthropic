"""The contract's named nodes (docs/OVERWATCH_RIDGE.md, "Asset contract"):
paths, posts, the counter-sniper's nests, the bridge's line, the aim
check's plates, the secrets, where the animals graze.

Positions come from the layout, the terrain and what the building stage
recorded (scene["buildings_info"]). Nodes that stand somewhere facing
somewhere are oriented so their glTF +Z is the way the person faces.
Waypoints lie on the ground (or the water) where the game puts the feet.
"""

import json
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import layout as L
from . import scene as S
from .scene import facing_matrix


def log(*a):
    print("[contract]", *a, flush=True)


def _z(ter, p):
    return float(ter.height(np.array([p[0]]), np.array([p[1]]))[0])


def _pt(ter, p, up=0.0):
    return (float(p[0]), float(p[1]), _z(ter, p) + up)


def path(col, name, pts, **extras):
    objs = []
    for i, p in enumerate(pts):
        objs.append(S.empty(f"{name}.{i + 1}", p, col, size=0.6, display='SPHERE'))
    if objs:
        S.tag(objs[0], **extras)
    return objs


def facing(col, name, p, forward, parent=None, **extras):
    m = facing_matrix(Vector((forward[0], forward[1], forward[2] if len(forward) > 2 else 0.0)))
    return S.empty(name, p, col, rot=m, size=1.0, display='ARROWS', parent=parent, **extras)


def toward_eye(p):
    v = -np.asarray(p[:2], float)
    return v / np.linalg.norm(v)


def curve_points(ter, curve, s0, s1, step, up=0.0, z_from=None):
    out = []
    for s in np.arange(s0, s1 + 1e-6, step):
        p = curve.at(s)
        z = z_from(s) if z_from is not None else _z(ter, p)
        out.append((float(p[0]), float(p[1]), z + up))
    return out


# ---------------------------------------------------------------------------

def build(ter, col, binfo):
    t_nodes = []
    rd = L.road()
    rz = getattr(ter.fine, 'road_z', None)
    zroad = (lambda s: float(np.interp(s, rd.s, rz))) if rz is not None else None
    # --- the road, both ways: down-valley end -> checkpoint -> bridge -> village -> dam
    pts = curve_points(ter, rd, 0.0, rd.length, 20.0, z_from=zroad)
    path(col, "path.road", pts, note="the road's centreline, from down-valley over the bridge to the dam's crest; "
                                     "vehicles and people use it both ways", width_m=5.0)
    # --- the dam road: along the arch's crest to the tunnel
    dm = L.dam_road()
    pts = [(float(p[0]), float(p[1]), L.DAM_CREST_Z) for p in (dm.at(s) for s in np.arange(0, dm.length - 20, 12.0))]
    pts.append(tuple(map(float, L.TUNNEL)))
    path(col, "path.dam", pts, note="the crest road from its far-bank end to the tunnel's mouth (the officer's drive)")
    tun = S.empty("tunnel", tuple(map(float, L.TUNNEL)), col, size=3.0, display='CUBE',
                  note="the tunnel's mouth, where the dam road enters the mountain")
    # --- the patrol: the near-bank road from the checkpoint down-valley and back
    s_cp = rd.nearest(np.array([L.CHECKPOINT_C[0]]), np.array([L.CHECKPOINT_C[1]]))[1][0]
    pts = curve_points(ter, rd, s_cp - 230.0, s_cp - 12.0, 12.0, z_from=zroad)
    path(col, "path.patrol", pts[::-1], note="walked out from the checkpoint down the near-bank road and back")
    # --- the cyclist: down-valley along the road to the bridge and into the village
    s_vil = rd.nearest(np.array([L.VILLAGE_C[0]]), np.array([L.VILLAGE_C[1]]))[1][0]
    pts = curve_points(ter, rd, 60.0, s_vil, 15.0, z_from=zroad)
    path(col, "path.cyclist", pts, note="she cycles up the valley road, through the checkpoint, over the bridge")
    # --- the cheese: from the cart down the lane, over the road, to the river
    lane = L.farm_lane()
    cart = binfo.get('farm', {}).get('cart', {})
    pts = curve_points(ter, lane, 3.0, lane.length, 6.0, up=0.32)
    riv = L.river()
    end = lane.at(lane.length)
    d, s, _ = riv.nearest(np.array([end[0]]), np.array([end[1]]))
    rp = riv.at(s[0])
    pts.append((float(rp[0]), float(rp[1]), float(riv.at(s[0], 'z')) + 0.1))
    path(col, "path.cheese", pts, note="the wheel of cheese rolls this way when the wedge is shot out (0.32 m radius)")
    # --- the farmer: round his pasture and yard
    past = [np.asarray(p) for p in binfo.get('farm', {}).get('pasture', [])]
    if past:
        c = np.mean(past, axis=0)
        loop = [c + (p - c) * 0.7 for p in past] + [L.FARM_C + (c - L.FARM_C) * 0.3]
        path(col, "path.farmer", [_pt(ter, p) for p in loop] + [_pt(ter, loop[0])],
             note="the farmer walks his pasture and yard (a loop)")
    # --- the shepherd: across the meadow above the village, toward the alp
    sh = [L.polar(b, r)[:2] for b, r in ((-9.0, 760), (-6.0, 820), (-11.0, 880), (-7.5, 940), (-3.0, 1000), (-6.0, 1060))]
    path(col, "path.shepherd", [_pt(ter, p) for p in sh], note="the shepherd crosses the far slope's meadow with his flock")
    # --- posts: where the checkpoint's men stand
    cp = binfo.get('checkpoint', {})
    fr = cp.get('frame', {})
    if fr:
        c0 = np.array(fr['c'][:2])
        ang = fr['heading']
        t = np.array([math.cos(ang), math.sin(ang)])
        n = np.array([-t[1], t[0]])
        if np.dot(n, c0) < 0:
            n = -n
        P = lambda x, y: c0 + t * x + n * y
        facing(col, "post.cp_barrier", _pt(ter, P(-1.5, -1.6)), -t, kind="guard", note="at the barrier, facing traffic from down-valley")
        facing(col, "post.cp_road", _pt(ter, P(-3.0, 1.8)), -t, kind="guard")
        facing(col, "post.cp_hut", _pt(ter, P(-5.5, -5.2)), toward_eye(P(-5.5, -5.2)), kind="sentry", note="smokes by the hut")
        tw = cp.get('tower', {})
        if tw:
            b = np.array(tw['base'][:2])
            facing(col, "post.tower", (float(b[0]), float(b[1]), float(tw['platform'])), toward_eye(b), kind="tower",
                   note="on the watchtower's platform, 1.1 m parapet")
        for k, nest in enumerate(cp.get('nests', [])):
            p = np.array(nest['pos'][:2])
            h = nest['heading']
            facing(col, f"post.mg_{'east' if k == 0 else 'west'}", _pt(ter, p), (math.cos(h), math.sin(h), 0), kind="gunner",
                   note="behind the sandbags, the gun over them (the sandbag wall is 1.05 m)")
    br = binfo.get('bridge', {})
    if br:
        ax = np.array(br['axis'])
        ne = np.array(br['near_end'])
        fe = np.array(br['far_end'])
        facing(col, "post.bridge_near", (float(ne[0] - ax[0] * 4), float(ne[1] - ax[1] * 4), float(br['deck_z_near'])), -ax,
               kind="guard")
        facing(col, "post.bridge_far", (float(fe[0] + ax[0] * 3), float(fe[1] + ax[1] * 3), _z(ter, fe + ax * 3)),
               toward_eye(fe), kind="sentry")
        # bridge.cross: the line across the road at the bridge's near end
        n = np.array([-ax[1], ax[0]])
        a = ne - n * br['width'] / 2
        b = ne + n * br['width'] / 2
        za = float(br['deck_z_near'])
        g = lambda p: [float(p[0]), za, float(-p[1])]
        facing(col, "bridge.cross", (float(ne[0]), float(ne[1]), za), ax, a=g(a), b=g(b),
               note="the line a convoy must not cross: the bridge's near end, between a and b (glTF coordinates); "
                    "the node's +Z points across the bridge")
    vil = binfo.get('village', {})
    if 'square' in vil:
        c, z0 = vil['square']
        facing(col, "post.village_square", (float(c[0]), float(c[1]), float(z0)), toward_eye(c), kind="sentry")
    dam = binfo.get('dam', {})
    if dam:
        cl = dam['crest_left']
        facing(col, "post.dam_crest", (cl[0], cl[1], L.DAM_CREST_Z), toward_eye(cl), kind="sentry")
        vh = dam['valve_house']
        facing(col, "post.dam_valve", _pt(ter, np.array(vh) - L.DAM_UP * 5.0), toward_eye(vh), kind="guard")
        facing(col, "post.tunnel", (float(L.TUNNEL[0]), float(L.TUNNEL[1]), float(L.TUNNEL[2])), toward_eye(L.TUNNEL[:2]),
               kind="guard")
    facing(col, "post.farm_track", _pt(ter, L.polar(-24.0, 318)[:2]), toward_eye(L.polar(-24.0, 318)[:2]), kind="sentry")
    # --- the counter-sniper's nests
    ch = vil.get('chapel')
    nests = []
    if ch:
        tw = np.array(ch['tower'][:2])
        zf = ch['belfry'][0]
        e = toward_eye(tw)
        exposed = (float(tw[0] + e[0] * 1.1), float(tw[1] + e[1] * 1.1), float(zf))
        hidden = (float(tw[0] - e[0] * 0.4), float(tw[1] - e[1] * 0.4), float(zf))
        nests.append((exposed, hidden, e, "chapel belfry: prone behind the parapet of the opening facing the ridge"))
    gc = L.GOAT_CRAG_C
    top = _crag_top(ter)
    e = toward_eye(top[:2])
    nests.append(((float(top[0] + e[0] * 3.0), float(top[1] + e[1] * 3.0), float(_z(ter, top[:2] + e * 3.0))),
                  (float(top[0] - e[0] * 4.0), float(top[1] - e[1] * 4.0), float(_z(ter, top[:2] - e * 4.0))), e,
                  "the crag's summit ledge across the valley"))
    alp = L.ALP_C + np.array([12.0, 30.0])
    e = toward_eye(alp)
    nests.append((_pt(ter, alp), _pt(ter, alp - e * 5.0), e, "above the alp's barns, in the rocks"))
    for i, (ex, hd, e, note) in enumerate(nests):
        root = S.empty(f"sniper.{i + 1}", ex, col, size=1.5, display='CUBE', note=note)
        a = facing(col, f"sniper.{i + 1}.exposed", ex, (e[0], e[1], 0), parent=None)
        b = facing(col, f"sniper.{i + 1}.hidden", hd, (e[0], e[1], 0), parent=None)
        for ch_ in (a, b):
            mw = ch_.matrix_world.copy()
            ch_.parent = root
            ch_.matrix_world = mw
    # --- the aim check's plates
    plates(ter, col)
    # --- secrets
    secrets(ter, col, binfo)
    # --- animals
    sheep = []
    rng = np.random.default_rng(71)
    if past:
        rng = np.random.default_rng(71)
        c = np.mean(past, axis=0)
        cows = []
        while len(cows) < 9:
            q = c + rng.uniform(-28, 28, 2)
            if _inside(q, past, 4.0):
                cows.append(q)
        for i, q in enumerate(cows):
            a = rng.uniform(0, 2 * np.pi)
            facing(col, f"animals.cows.{i + 1}", _pt(ter, q), (math.cos(a), math.sin(a), 0))
        sheep = [L.FARM_C + np.array(v) for v in ((-18, 20), (-21, 23), (-16, 25))]
    for p in sh[1:4]:
        for k in range(3):
            sheep.append(np.array(p) + rng.normal(0, 9, 2))
    for i, q in enumerate(sheep):
        a = rng.uniform(0, 2 * np.pi)
        facing(col, f"animals.sheep.{i + 1}", _pt(ter, q), (math.cos(a), math.sin(a), 0))
    log(f"contract nodes: {len([o for o in col.objects])}")


def _inside(q, poly, margin):
    poly = np.asarray(poly)
    n = len(poly)
    ins = False
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        if (a[1] > q[1]) != (b[1] > q[1]):
            x = a[0] + (q[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if q[0] < x:
                ins = not ins
    if not ins:
        return False
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        t = np.clip(np.dot(q - a, b - a) / np.dot(b - a, b - a), 0, 1)
        if np.linalg.norm(a + (b - a) * t - q) < margin:
            return False
    return True


def _crag_top(ter):
    c = L.GOAT_CRAG_C
    u = c / np.linalg.norm(c)
    best = None
    for al in np.linspace(-15, 40, 23):
        for ac in np.linspace(-20, 20, 9):
            p = c + u * al + np.array([u[1], -u[0]]) * ac
            z = _z(ter, p)
            if best is None or z > best[2]:
                best = (p[0], p[1], z)
    return np.array(best)


# ---------------------------------------------------------------------------

def view_dir(vx, vy, aspect):
    ty = math.tan(math.radians(L.VFOV_DEG / 2))
    sx = (vx * 2 - 1) * ty * aspect
    sy = (1 - vy * 2) * ty
    p = math.radians(L.PITCH_DEG)
    fwd = np.array([0.0, math.cos(p), math.sin(p)])
    right = np.array([1.0, 0.0, 0.0])
    up = np.cross(right, fwd)
    d = fwd + sx * right + sy * up
    return d / np.linalg.norm(d)


def viewport(p, aspect):
    p = np.asarray(p, float)
    pt = math.radians(L.PITCH_DEG)
    fwd = np.array([0.0, math.cos(pt), math.sin(pt)])
    right = np.array([1.0, 0.0, 0.0])
    up = np.cross(right, fwd)
    z = p @ fwd
    ty = math.tan(math.radians(L.VFOV_DEG / 2))
    return (0.5 + (p @ right) / z / (ty * aspect) / 2, 0.5 - (p @ up) / z / ty / 2)


def _hit(ter, d, tmax=2000.0):
    t = 5.0
    while t < tmax:
        q = d * t
        if q[2] < _z(ter, q[:2]):
            lo, hi = t / 1.01 - 0.5, t
            for _ in range(20):
                m = (lo + hi) / 2
                qq = d * m
                if qq[2] < _z(ter, qq[:2]):
                    hi = m
                else:
                    lo = m
            return hi
        t = t * 1.01 + 0.5
    return None


def plates(ter, col):
    """Nine plates spread over the view in a 3 x 3 of screen positions (4:3
    terms, as High Noon's bottles), each on the ground 120-250 m out: where
    the ray for a screen position meets the ground further than 250 m (the
    top of the frame is the far side and the sky), the plate takes the
    highest screen position that still lands in range - so the top row sits
    as high as the near side allows."""
    # Seen from the ridge, the ground within 250 m fills only the lower part
    # of the frame (the valley floor is 60 m under the eye), so the plates
    # stand on a 3 x 3 of bearings x ranges instead: they span the full width
    # and the lower ~40% of the view - where every target the game offers is.
    from . import mesh as M
    rows_def = [(255.0, 2.4), (195.0, 1.25), (135.0, 1.25)]      # (range, plate centre above ground)
    cols = [-24.0, 0.0, 24.0]
    rows = {}
    n = 0
    for (rng_, post) in rows_def:
        for b in cols:
            n += 1
            r = rng_
            while r > 100:
                g = L.polar(b, r)[:2]
                c = np.array([g[0], g[1], _z(ter, g) + post])
                if M.visible_mask(ter, c[None], margin=0.3)[0]:
                    break
                r -= 8.0
            e = toward_eye(g)
            vp = {nm: [round(float(v), 3) for v in viewport(c, a)] for nm, a in (('4:3', 4 / 3), ('16:9', 16 / 9), ('21:9', 21 / 9))}
            facing(col, f"calib.{n}", tuple(float(v) for v in c), (e[0], e[1], 0), plate_radius_m=0.3,
                   stand_height_m=post, distance_m=round(float(np.linalg.norm(c)), 1),
                   vp_4_3=vp['4:3'], vp_16_9=vp['16:9'], vp_21_9=vp['21:9'],
                   note="the plate's centre: a steel disc 0.6 m across hanging from a post and crossbar")
            rows[n] = (c, vp)
            log(f"  calib.{n}: {np.linalg.norm(c):5.0f} m  4:3 {vp['4:3']}  16:9 {vp['16:9']}")
    return rows


def secrets(ter, col, binfo):
    # the goat's ledges on the crag's face (the game hops it from one to the next)
    top = _crag_top(ter)
    c = L.GOAT_CRAG_C
    u = c / np.linalg.norm(c)
    v = np.array([u[1], -u[0]])
    import json
    ledges = [tuple(p) for p in json.loads(bpy.context.scene.get("goat_ledges", "[]"))]
    if len(ledges) < 4:            # no crag mesh (or too few ledges found): the heightfield's
        ledges = []
        for (al, ac) in ((-14.0, 9.0), (-8.0, -11.0), (-2.0, 4.0), (6.0, -4.0)):
            p = c + u * al + v * ac
            ledges.append(_pt(ter, p))
    for i, p in enumerate(sorted(ledges, key=lambda q: q[2])):
        facing(col, f"secret.goat.{i + 1}", p, toward_eye(np.array(p[:2])), note="a ledge on the crag for the goat")
    # the bell in the chapel's belfry: its own object, pivot at the yoke
    from .buildings import bell_mesh
    ch = binfo.get('village', {}).get('chapel')
    if ch:
        tw = ch['tower']
        V, F, UV = bell_mesh(0.8)
        bell = S.mesh_object("secret.bell", V, F, col, uvs={"UVMap": UV}, smooth=True, surface="metal", material_key="bell",
                             note="the chapel's bell; origin on the yoke's axis (swing it about its local X)")
        bell.location = (tw[0], tw[1], ch['belfry'][0] + 2.3)
        bell.rotation_euler = (0, 0, ch['rot'])
    # the yeti on the far snowfield, and the rock he peeks from behind
    yc = np.asarray(L.YETI_C)
    e = toward_eye(yc)
    rock_p = yc + e * 3.5
    yeti_mesh(col, _pt(ter, yc), e)
    rock_mesh(col, "secret.yeti.rock", _pt(ter, rock_p, -0.6), 2.2, seed=5, surface="rock",
              note="the rock beside the yeti: shoot it and he ducks")
    # the great cliff (the echo): its face's centre, facing the player
    cb, cr = L.bearing_range(np.array([*L.CLIFF_C, 0.0]))
    best = None
    for r in np.linspace(cr - 150, cr + 150, 61):
        p = L.polar(cb, r)[:2]
        z1 = _z(ter, p)
        z0 = _z(ter, L.polar(cb, r - 5)[:2])
        slope = (z1 - z0) / 5.0
        if best is None or slope > best[0]:
            best = (slope, p, z1)
    p = best[1]
    facing(col, "secret.cliff", (float(p[0]), float(p[1]), best[2]), toward_eye(p), half_width_m=170.0, half_height_m=90.0,
           note="the great limestone wall: a hit within half_width/half_height of this node (in its plane) echoes")
    # the duck's float down the river
    riv = L.river()
    pts = [(float(riv.at(s)[0]), float(riv.at(s)[1]), float(riv.at(s, 'z'))) for s in np.arange(160.0, 1250.0, 25.0)]
    path(col, "secret.duck.path", pts, note="a yellow rubber duck floats down the river along these points (0.4 m/s)")
    # the eagle's circle over the valley
    ctr = L.polar(-4.0, 820)[:2]
    pts = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        pts.append((float(ctr[0] + 240 * math.cos(a)), float(ctr[1] + 170 * math.sin(a)), 230.0 + 20 * math.sin(2 * a)))
    path(col, "eagle.path", pts, note="the eagle's glide, a loop ~290 m above the valley floor, counter-clockwise")
    lp = (0.0, 2.6, -0.45)
    facing(col, "eagle.land", lp, (0.0, -1.0, 0.0), note="the rock in front of the scope where the eagle lands and stares")
    return dict(yeti=_pt(ter, yc), rock=_pt(ter, rock_p))


def yeti_mesh(col, p, e):
    """A white shaggy figure, 2.3 m, peeking: a hunched body, a head, long
    arms. Simple (it is 1.8 km away) but it must read as someone."""
    import bmesh
    bm = bmesh.new()
    for (c, r, sc) in (((0, 0, 1.15), 0.62, (1.0, 0.8, 1.25)), ((0, -0.08, 2.05), 0.3, (1.0, 1.0, 1.1)),
                       ((0.58, -0.05, 1.2), 0.18, (1.0, 1.0, 3.4)), ((-0.58, -0.05, 1.2), 0.18, (1.0, 1.0, 3.4)),
                       ((0.25, 0.0, 0.3), 0.22, (1.0, 1.0, 2.0)), ((-0.25, 0.0, 0.3), 0.22, (1.0, 1.0, 2.0))):
        m = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in m['verts']:
            v.co = Vector((v.co.x * sc[0] + c[0], v.co.y * sc[1] + c[1], v.co.z * sc[2] + c[2]))
    me = bpy.data.meshes.new("secret.yeti")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("secret.yeti", me)
    col.objects.link(ob)
    ob.location = p
    ob.rotation_euler = facing_matrix(Vector((e[0], e[1], 0))).to_euler()
    S.tag(ob, surface="snow", material_key="yeti", note="the yeti: duck him behind secret.yeti.rock; footprints lead away")
    me.shade_smooth()
    return ob


def rock_mesh(col, name, p, size, seed=0, surface="rock", detail=2, **extras):
    """A boulder (crags.boulder_mesh): angular, lichened, vertex-coloured
    over the rock tile."""
    from .crags import boulder_mesh
    ob = boulder_mesh(col, name, p, size, seed=seed, detail=detail)
    S.tag(ob, surface=surface, material_key="rock_vc", **extras)
    return ob
