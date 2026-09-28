"""The asset contract with the game: named nodes and their extras.

See docs/DEAD_OF_NIGHT.md, "Asset contract". Everything here is an empty or
a small mesh whose name and custom properties are the interface:

    camera.player  moon  moon.disc  light.street  light.neon  light.motel.<n>
    lane.road.<n>  lane.corn.<n>  lane.trees.<n>
    spawn.bus  spawn.booth  spawn.fence  spawn.<id>.path.<n>
    barricade.<n>  calib.1-9  secret.*  ground.shadow  corn

Orientation: the exporter maps Blender (x, y, z) to glTF (x, z, -y). Nodes a
character stands on are built with their Blender -Y toward where he faces,
which is his glTF +Z - so a walker copying a barricade node faces the player.

Placement is verified, not assumed: every calibration jar's support is found
by casting down onto the real geometry, every node the player must see is
ray-cast from the eye, and a report is printed and written next to the blend.
"""

import json
import math
import os

import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

from .common import EYE, DC, empty, tag, toward_player, facing, viewport, point_for_viewport, to_gltf, rng
from . import layout as L, world, meshkit as K

# aim-check targets: (n, viewport x, viewport y at 4:3), corners, edges, centre
CALIB_TARGETS = [(1, 0.17, 0.20), (2, 0.50, 0.20), (3, 0.83, 0.20),
                 (4, 0.17, 0.50), (5, 0.50, 0.48), (6, 0.83, 0.44),
                 (7, 0.17, 0.72), (8, 0.50, 0.72), (9, 0.83, 0.72)]
JAR_H = 0.16          # a pint mason jar: the node is its base, its lid 16 cm up
FASCIA_Y = L.CANOPY[3] - 0.05
DUCK = (1.3, 9.0)


def ray_plane_y(vx, vy, y, aspect=4 / 3):
    """Point on the ray through viewport (vx, vy) at world y."""
    from .common import cam_basis, VFOV_DEG
    fwd, right, up = cam_basis()
    ty = math.tan(math.radians(VFOV_DEG / 2))
    tx = ty * aspect
    d = fwd + right * ((vx - 0.5) * 2 * tx) + up * ((0.5 - vy) * 2 * ty)
    t = (y - EYE.y) / d.y
    return EYE + d * t


def ray_plane_x(vx, vy, x, aspect=4 / 3):
    from .common import cam_basis, VFOV_DEG
    fwd, right, up = cam_basis()
    ty = math.tan(math.radians(VFOV_DEG / 2))
    tx = ty * aspect
    d = fwd + right * ((vx - 0.5) * 2 * tx) + up * ((0.5 - vy) * 2 * ty)
    t = (x - EYE.x) / d.x
    return EYE + d * t


def hanging_jar_spots():
    """The top row: jars hanging on wire bails from the canopy's front edge.
    Returns the jar bases (the jar's centre lands on the target)."""
    out = []
    for n, vx, vy in CALIB_TARGETS[:3]:
        p = ray_plane_y(vx, vy, FASCIA_Y - 0.12)
        out.append(p - Vector((0, 0, JAR_H / 2)))
    return out


def fence_jar_post():
    """Where the fence post carrying jar 4 must stand (x on the fence line)."""
    n, vx, vy = CALIB_TARGETS[3]
    p = ray_plane_x(vx, vy, L.FENCE_X)
    return Vector((L.FENCE_X, p.y, p.z - JAR_H / 2))


def bag_jar_xs():
    """Sandbag-top jars 7-9: the x where each lands on the wall's centre line."""
    yc = sum(L.BARRICADE_Y) / 2
    return [ray_plane_y(vx, vy, yc).x for _, vx, vy in CALIB_TARGETS[6:]]


# ---------------------------------------------------------------------------
# Visibility

POLY_OWNER = []


def scene_bvh(respect_no_occlude=True):
    verts, polys = [], []
    POLY_OWNER.clear()
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH' or ob.get('export', 1) == 0 or ob.name.startswith(('ground.shadow', 'moon.disc')):
            continue
        if respect_no_occlude and ob.get('no_occlude'):
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


def seen(bvh, p, slack=0.08):
    d = p - EYE
    dist = d.length
    hit = bvh.ray_cast(EYE, d / dist, dist - slack)
    if hit[0] is None:
        return True, None
    return False, POLY_OWNER[hit[2]]


def support(bvh, x, y, z_from=12.0, ignore=()):
    """Height of the first surface below (x, y) (casting straight down)."""
    o = Vector((x, y, z_from))
    while True:
        hit = bvh.ray_cast(o, Vector((0, 0, -1)), 40.0)
        if hit[0] is None:
            return None
        if POLY_OWNER[hit[2]].startswith(ignore) if ignore else False:
            o = hit[0] - Vector((0, 0, 0.002))
            continue
        return hit[0].z


# ---------------------------------------------------------------------------

def vps(p):
    return {a: [round(c, 3) for c in viewport(p, r)] for a, r in (('4_3', 4 / 3), ('16_10', 1.6), ('16_9', 16 / 9), ('21_9', 21 / 9))}


def path_nodes(col, prefix, pts, r, width=2.5, spread=None, **extra):
    """Ordered waypoints (from the fog to the barricade), on the ground.
    `spread` (the game's name): how far either side of the line they walk."""
    from .ground import ground_z
    obs = []
    for i, (x, y) in enumerate(pts, 1):
        z = ground_z(x, y)
        nxt = pts[i] if i < len(pts) else (x, y - 1)
        heading = Vector((nxt[0] - x, nxt[1] - y, 0.0))
        rot = facing(heading if heading.length > 1e-3 else Vector((0, -1, 0)))
        ob = empty(f"{prefix}.{i}", (x, y, z), col, rot=rot, size=0.4, display='SINGLE_ARROW',
                   order=i, width_m=width, spread=round(spread if spread is not None else width / 2, 2), **extra)
        obs.append(ob)
    return obs


def build_lanes(col):
    r = rng("lanes")
    # the road: up the middle out of the fog, round the bus's east end
    road = [(-0.8, 110.0), (-0.2, 90.0), (1.4, 70.0), (4.2, 56.0), (6.6, 47.5), (4.6, 40.0), (1.8, 31.0),
            (0.6, 21.0), (0.1, 12.0), (-0.4, 6.8), (-0.5, 4.3)]
    path_nodes(col, "lane.road", road, r, width=3.0, spread=1.5, lane='road', speed_hint='walk')
    # the corn: out of the dark field west of the scarecrow, through the
    # broken fence, onto the road
    cornp = [(-46.0, 43.0), (-36.0, 40.5), (-26.0, 38.8), (-17.0, 37.6), (-11.0, 37.2), (-7.3, 37.2),
             (-3.6, 33.0), (-2.2, 22.0), (-1.6, 12.0), (-1.7, 4.3)]
    path_nodes(col, "lane.corn", cornp, r, width=1.6, spread=0.8, lane='corn', corn_until=5)
    # the tree line: out of the pines east of the motel, along its front
    # (off the right of the screen), then across the lot and down the east
    # side of the road. Every waypoint the game frames (the second on, when
    # nearer than 60 m) is inside the play view at any window from 1.2:1
    trees = [(60.0, 44.0), (48.5, 37.0), (14.0, 37.0), (9.0, 26.0), (2.6, 19.5), (1.6, 11.0), (1.0, 6.5), (0.7, 4.3)]
    path_nodes(col, "lane.trees", trees, r, width=2.2, spread=1.1, lane='trees')


def build_spawns(col):
    """The surprises. `spawn.bus` is the foot of the bus's door and
    `spawn.fence` the rail: the game plays `climb_out` / `vault` while it
    carries the dead along the first stretch of the path (0.5 m, 0.9 m),
    and the clips carry the rest (climb_out starts 0.55 m back and 0.42 m
    up in the doorway; vault 1.1 m back in the field), so the body steps
    down from the door, or goes over the rail, and lands on the path."""
    from .ground import ground_z
    from . import far
    r = rng("spawns")
    bus_door, bus_out = far.bus_door()
    empty("spawn.bus", bus_door, col, rot=facing(bus_out), size=0.5, display='SINGLE_ARROW', spread=0.3,
          clip='climb_out', note="the foot of the bus's door, facing out; climb_out starts 0.55 m back and 0.42 m up")
    first = bus_door + bus_out * 0.5
    pts = [(first.x, first.y), (2.6, 36.0), (1.2, 26.0), (0.4, 14.0), (0.2, 4.3)]
    path_nodes(col, "spawn.bus.path", pts, r, width=1.5, spread=0.3)
    # behind the phone booth (out of sight), then down past the pole sign
    bp = Vector((L.BOOTH[0] + 0.95, L.BOOTH[1] + 0.9, ground_z(L.BOOTH[0] + 0.95, L.BOOTH[1] + 0.9)))
    empty("spawn.booth", bp, col, rot=facing(Vector((-1, -0.4, 0))), size=0.5, display='SINGLE_ARROW', clip='walk', spread=0.4)
    pts = [(L.BOOTH[0] - 0.6, L.BOOTH[1] - 1.6), (5.6, 16.6), (3.9, 12.0), (2.8, 7.2), (1.3, 4.4)]
    path_nodes(col, "spawn.booth.path", pts, r, width=1.0, spread=0.4)
    # over the fence, 16 m out on the left (the pickup hides anything nearer)
    fy = L.FENCE_SPAWN_Y
    fp = Vector((L.FENCE_X, fy, ground_z(L.FENCE_X, fy)))
    empty("spawn.fence", fp, col, rot=facing(Vector((1, -0.15, 0))), size=0.5, display='SINGLE_ARROW', clip='vault', spread=0.3,
          note="at the rail, facing the road; vault starts 1.1 m back in the field and the path's first stretch is 0.9 m")
    pts = [(L.FENCE_X + 0.9, fy - 0.15), (-4.4, 11.5), (-2.9, 7.5), (-1.2, 4.4)]
    path_nodes(col, "spawn.fence.path", pts, r, width=1.0, spread=0.3)


# The survivors' runs (`path.survivor.<n>.<k>`): out of the corn, across the
# road to the motel office's door (where the phone is), in view all the way
SURVIVOR_PATHS = [
    [(-9.0, 24.8), (-3.5, 25.2), (2.5, 27.5), (7.0, 32.0), (10.4, 38.3), (10.0, 39.7)],
    [(-10.5, 37.2), (-7.3, 37.2), (-2.5, 36.5), (3.5, 37.3), (7.5, 37.3), (10.0, 39.7)],
]


def build_survivor_paths(col):
    from .ground import ground_z
    for n, pts in enumerate(SURVIVOR_PATHS, 1):
        for k, (x, y) in enumerate(pts, 1):
            nxt = pts[k] if k < len(pts) else (x, y + 1)
            empty(f"path.survivor.{n}.{k}", (x, y, ground_z(x, y)), col, rot=facing(Vector((nxt[0] - x, nxt[1] - y, 0))),
                  size=0.3, display='SINGLE_ARROW', order=k)


# Where the dead stand at the barricade: five places across its middle, all
# in view at the narrowest window the game allows (1.2:1)
SLOTS = [(-1.5, 4.0), (-0.75, 3.97), (0.0, 3.95), (0.75, 3.97), (1.5, 4.0)]


def build_barricade(col):
    from .ground import ground_z
    for i, (x, y) in enumerate(SLOTS, 1):
        p = Vector((x, y, ground_z(x, y)))
        empty(f"barricade.{i}", p, col, rot=toward_player(p), size=0.35, display='SINGLE_ARROW', order=i,
              clip='claw', vp=vps(p + Vector((0, 0, 1.55)))['16_9'])


def build_calib(col, bvh):
    spots = {}
    for i, p in enumerate(hanging_jar_spots(), 1):
        spots[i] = (p, 'hanging', dict(hook=to_gltf(Vector((p.x, FASCIA_Y, L.CANOPY[4] - 0.06)))))
    fp = fence_jar_post()
    z = support(bvh, fp.x, fp.y, 3.0)
    spots[4] = (Vector((fp.x, fp.y, z if z is not None else fp.z)), 'fence_post', {})
    from . import far
    spots[5] = (far.bus_sill_spot(), 'bus_window_sill', {})
    n, vx, vy = CALIB_TARGETS[5]
    bx = ray_plane_y(vx, vy, L.BOOTH[1] - 0.25)
    z = support(bvh, bx.x, bx.y, 6.0)
    spots[6] = (Vector((bx.x, bx.y, z if z is not None else 2.4)), 'booth_roof', {})
    yc = sum(L.BARRICADE_Y) / 2
    for n, x in zip((7, 8, 9), bag_jar_xs()):
        z = support(bvh, x, yc, 3.0)
        spots[n] = (Vector((x, yc, z if z is not None else L.BAG_TOP)), 'sandbags', {})
    report = []
    for n, vx, vy in CALIB_TARGETS:
        p, on, ex = spots[n]
        centre = p + Vector((0, 0, JAR_H / 2))
        vis, blocker = seen(bvh, centre)
        ob = empty(f"calib.{n}", p, col, size=0.1, display='SPHERE', jar_base=1, jar_height_m=JAR_H, on=on,
                   distance_m=round((p - EYE).length, 1), **{f"vp_{k}": v for k, v in vps(centre).items()}, **ex)
        report.append(dict(n=n, on=on, pos=[round(c, 2) for c in p], dist=round((p - EYE).length, 1),
                           seen=vis, blocker=blocker, **vps(centre)))
    return report


def build_moon(col):
    d = world.light_direction()
    ob = empty("moon", EYE + world.moon_vector() * 40.0, col, rot=DC.axis_matrix(d), size=2.0, display='SINGLE_ARROW')
    g = Vector((d.x, d.z, -d.y))
    tag(ob, direction=[round(g.x, 5), round(g.y, 5), round(g.z, 5)], elevation_deg=L.MOON_EL_DEG,
        azimuth_deg=L.MOON_AZ_DEG, color=list(world.MOON_COLOR), strength=world.MOON_STRENGTH,
        angle_deg=world.MOON_ANGLE_DEG, axis='-Z along the light')
    # the disc: far away in the moon's direction, facing the eye, shootable
    c = EYE + world.moon_vector() * L.MOON_DISC_DIST
    rad = L.MOON_DISC_DIST * math.tan(math.radians(0.27)) * 1.15
    mb = K.MeshBuilder("moon.disc")
    f = DC.Frame(matrix=Matrix.Translation(c) @ DC.facing_matrix(-world.moon_vector()).to_4x4())
    seg = 24
    pts = [f.p(math.cos(2 * math.pi * k / seg) * rad, 0.0, math.sin(2 * math.pi * k / seg) * rad) for k in range(seg)]
    mb.add_face([tuple(p) for p in pts], 'moon_face', 0.5,
                [(0.5 + 0.5 * math.cos(2 * math.pi * k / seg), 0.5 + 0.5 * math.sin(2 * math.pi * k / seg)) for k in range(seg)],
                [(0.5 + 0.5 * math.cos(2 * math.pi * k / seg), 0.5 + 0.5 * math.sin(2 * math.pi * k / seg)) for k in range(seg)])
    from .common import DN
    m, g_ = DN.new_material("moon_face")
    em = g_.node('ShaderNodeEmission', inputs={'Color': (0.9, 0.93, 1.0), 'Strength': 1.0}, out=0)
    g_.output(em)
    mo = mb.build(col, {'moon_face': m}, surface='glass', group='none', role='moon', radius_m=round(rad, 2),
                  distance_m=L.MOON_DISC_DIST)
    K.fix_normals(mo)
    mo.hide_render = True        # the sky draws the moon; this is the target
    return ob


def build_lights(col):
    from . import station, roadside, motel
    h = Vector(L.STREETLIGHT_HEAD)
    empty("light.street", h, col, size=0.3, display='SPHERE', kind='sodium', color=list(world.SODIUM),
          watts=world.STREET_W, cone_deg=140.0, flicker=True, radius_m=22.0,
          note="its baked light is separable: the ORM texture's R channel is its flicker mask")
    nc = Vector(station.INFO.get("neon_centre", (5.6, 15.5, 5.6)))
    empty("light.neon", nc, col, size=0.3, display='SPHERE', kind='neon', color=[1.0, 0.12, 0.08], radius_m=10.0)
    for i, p in enumerate(motel.CANDLES, 1):
        empty(f"light.motel.{i}", p, col, size=0.1, display='SPHERE', kind='candle', color=list(world.CANDLE),
              watts=5.0, radius_m=4.0)
    bl = roadside.INFO.get("booth_light")
    if bl is not None:
        empty("light.booth", bl, col, size=0.1, display='SPHERE', kind='fluorescent', color=list(world.BOOTH_TINT),
              radius_m=5.0)


SECRET_CLEARANCE = 1.2     # the game tells the cat from the other secrets by distance


def _perch(bvh, region, max_az=24.5, z_range=(0.8, 2.6), step=0.05, flat=0.06, probe=0.08):
    """The highest flat, visible spot in a box (x0, x1, y0, y1) within max_az
    of the view's centre: where a cat would sit."""
    best = None
    x0, x1, y0, y1 = region
    nx = int(round((x1 - x0) / step)) + 1
    ny = int(round((y1 - y0) / step)) + 1
    for i in range(nx):
        for j in range(ny):
            x, y = x0 + i * step, y0 + j * step
            if math.degrees(math.atan2(abs(x - EYE.x), y - EYE.y)) > max_az:
                continue
            z = support(bvh, x, y, z_range[1] + 3.0)
            if z is None or not (z_range[0] <= z <= z_range[1]):
                continue
            around = [support(bvh, x + dx, y + dy, z + 0.5) for dx, dy in ((probe, 0), (-probe, 0), (0, probe), (0, -probe))]
            if any(a is None or abs(a - z) > flat for a in around):
                continue
            p = Vector((x, y, z))
            if not seen(bvh, p + Vector((0, 0, 0.15)), slack=0.2)[0]:
                continue
            if best is None or z > best.z + 0.02 or (abs(z - best.z) <= 0.02 and y > best.y):
                best = p
    return best


def build_cat_spots(col, bvh):
    """The cat's perches, in the order it uses them: a fence post by the
    corn (where it is first seen), the top of the Gas & Eats sign, the
    wrecked car's roof, the motel's sign. (The overturned pickup lies 42
    degrees left of the view's centre: outside the play view at 1.2:1.)
    Each is found on the real geometry (a flat top, seen from the eye),
    inside the play view and clear of every other secret."""
    spots = []
    for where, region, zr, probe in (("fence_post", (-7.5, -7.1, 15.8, 19.2), (0.7, 1.6), 0.03),
                                     ("gas_sign", (3.3, 7.8, 15.3, 16.3), (6.9, 8.2), 0.035),
                                     ("wrecked_car", (-6.2, -3.6, 29.0, 34.0), (0.9, 1.6), 0.08)):
        p = _perch(bvh, region, z_range=zr, probe=probe)
        if p is None:
            print(f"WARNING: no perch found on the {where}")
            continue
        spots.append((p, where))
    from . import motel
    spots.append((Vector(motel.INFO.get("sign_top", (7.2, 34.6, 5.71))), 'motel_sign'))
    secrets = [o for o in bpy.context.scene.objects if o.name.startswith('secret.') and not o.name.startswith('secret.cat.')]
    for i, (p, where) in enumerate(spots, 1):
        near = min(((_centre(o) - p).length, o.name) for o in secrets) if secrets else (99.0, "")
        if near[0] < SECRET_CLEARANCE:
            print(f"WARNING: cat spot {where} is {near[0]:.2f} m from {near[1]}")
        empty(f"secret.cat.spot.{i}", p, col, rot=toward_player(p), size=0.12, display='SINGLE_ARROW', on=where,
              **{f"vp_{k}": v for k, v in vps(p + Vector((0, 0, 0.15))).items()})
    return spots


def _centre(ob):
    if ob.type == 'MESH' and len(ob.data.vertices):
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        return sum(bb, Vector()) / 8
    return ob.matrix_world.translation.copy()


REFRESH_PREFIX = ('lane.', 'spawn.', 'barricade.', 'path.survivor.', 'secret.cat.spot.')


def refresh(col=None):
    """Re-place the contract's empties that carry no bake (lanes, spawns,
    barricade places, survivors' runs, the cat's perches) in an already
    baked scene: the export calls this, so moving a node never needs a new
    bake. The perches are found again by casting onto the baked meshes."""
    sc = bpy.context.scene
    cam = bpy.data.objects.get('camera.player')
    if col is None:
        col = cam.users_collection[0] if cam else sc.collection
    for ob in list(sc.objects):
        if ob.type == 'EMPTY' and ob.name.startswith(REFRESH_PREFIX):
            bpy.data.objects.remove(ob)
    bpy.context.view_layer.update()
    build_lanes(col)
    build_spawns(col)
    build_barricade(col)
    build_survivor_paths(col)
    # (the baked scene's joined meshes inherit `no_occlude` from the wires
    # joined into them: here everything occludes)
    bvh = scene_bvh(respect_no_occlude=False)
    cats = build_cat_spots(col, bvh)
    print("contract refreshed: cat perches", [(w, tuple(round(c, 2) for c in p)) for p, w in cats])
    return cats


def build_duck(lib, col):
    from .ground import ground_z
    z = ground_z(*DUCK)
    mb = K.MeshBuilder("secret.duck")
    f = DC.Frame((DUCK[0], DUCK[1], z), math.radians(200))
    K.lathe(mb, f, [(0.0, -0.01), (0.045, -0.005), (0.055, 0.02), (0.05, 0.04), (0.02, 0.055), (0.0, 0.056)], 'rubber_duck', seg=12)
    hf = f.sub((0.0, -0.03, 0.05))
    K.lathe(mb, hf, [(0.0, 0.0), (0.02, 0.005), (0.028, 0.025), (0.02, 0.045), (0.0, 0.05)], 'rubber_duck', seg=10)
    mb.box(hf, (-0.008, -0.045, 0.018), (0.008, -0.02, 0.026), 'drum_red')
    ob = K.emit(mb, col, lib, 'near', 'water', smooth_angle=60)
    set_origin(ob, Vector((DUCK[0], DUCK[1], z)))
    tag(ob, role='duck')
    return ob


def set_origin(ob, pivot):
    ob.data.transform(Matrix.Translation(-Vector(pivot)))
    ob.location = pivot
    return ob


def build(lib, col):
    bpy.context.view_layer.update()
    build_moon(col)
    build_lights(col)
    build_lanes(col)
    build_spawns(col)
    build_barricade(col)
    build_duck(lib, col)
    from . import motel
    if "phone" in motel.INFO:
        empty("secret.phone.motel", motel.INFO["phone"], col, size=0.1, display='CUBE', role='phone',
              note="the motel office's phone (a sound source; it rings back)")
    build_survivor_paths(col)
    bpy.context.view_layer.update()
    bvh = scene_bvh()
    cats = build_cat_spots(col, bvh)
    calib = build_calib(col, bvh)
    # sightlines to the things the player must see
    checks = {}
    for ob in list(bpy.context.scene.objects):
        n = ob.name
        if n.startswith(('secret.', 'spawn.', 'barricade.', 'light.street', 'light.neon', 'lane.')) and \
                not n.startswith(('secret.cat', 'lane.corn', 'lane.trees', 'lane.road', 'spawn.bus.path', 'spawn.booth.path')):
            p = ob.matrix_world.translation.copy()
            if ob.type == 'MESH':
                me = ob.data
                p = ob.matrix_world @ (sum((v.co for v in me.vertices), Vector()) / max(len(me.vertices), 1))
            if n.startswith(('barricade.', 'spawn.', 'lane.')):
                p = p + Vector((0, 0, 1.5))
            vis, blocker = seen(bvh, p, slack=0.25)
            checks[n] = dict(seen=vis, blocker=blocker, **vps(p))
    for p, where in cats:
        vis, blocker = seen(bvh, p + Vector((0, 0, 0.12)), slack=0.2)
        checks[f"cat:{where}"] = dict(seen=vis, blocker=blocker, **vps(p))
    report = dict(calib=calib, sightlines=checks)
    from .signpaint import _OUT
    path = os.path.join(os.path.dirname(_OUT) if _OUT else ".", "contract_report.json")
    with open(path, "w") as fh:
        json.dump(report, fh, indent=1, default=str)
    print("\nCALIB (on / seen / 4:3 / 16:9 / distance)")
    for c in calib:
        flag = "" if c['seen'] else f"   <-- BLOCKED by {c['blocker']}"
        print(f"  calib.{c['n']} {c['on']:16s} seen={int(c['seen'])} 4:3={c['4_3']} 16:9={c['16_9']} d={c['dist']}{flag}")
    print("SIGHTLINES")
    for k, v in sorted(checks.items()):
        flag = "" if v['seen'] else f"   <-- blocked by {v['blocker']}"
        print(f"  {k:28s} 16:9={v['16_9']}{flag}")
    return report
