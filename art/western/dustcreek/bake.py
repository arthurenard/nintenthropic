"""Bake Cycles light into per-group texture atlases.

What the game gets is one colour per texel = what Cycles would show there
from the player's eye: albedo x (direct + indirect diffuse light), plus the
glossy reflection *as seen from the player's camera*, a touch of contact AO,
then the same aerial perspective as the review renders, then the AgX view
transform. The glb shows it unlit, so the browser pays nothing for it.

UV layout is driven by the fact that the player never moves:
- Street ground + terrain use a *camera-projection* layout (UV = where the
  point lands on screen): texel density exactly follows screen density,
  and the dense rut/hoofprint height field bakes onto a much lighter export
  mesh without losing anything, because both project to the same UVs.
- Everything else: Smart UV islands, each scaled by how many screen pixels
  per metre it covers from the eye (1/distance, with visibility tested by
  ray casts), then packed. Faces nobody can see get almost no texels.
"""

import math
import os
import time

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

from . import core, post, pipeline, lighting

ATLAS = {
    'ground': (4096, 2048),
    'left_near': (2048, 2048),
    'left_mid': (2048, 2048),
    'left_far': (2048, 2048),
    'right_near': (2048, 2048),
    'right_far': (2048, 2048),
    'far': (2048, 2048),
}
KEEP_PREFIX = ('secret.', 'glass.', 'prop.saloon_batwing', 'ground.', 'camera.', 'cover.', 'calib.', 'path.', 'sun')
EYE = Vector((0.0, 0.0, pipeline.EYE))
FOCAL_PX = 500.0 / math.tan(math.radians(pipeline.VFOV_DEG / 2))   # px per unit tan at 1000 px tall
QUALITY = 2.2        # texels per screen pixel we aim for (1440p headroom + supersampling)
MARGIN_PX = 6

# projective ground mapping (camera space tangents)
TX = 1.16            # half-width in tan units: a hair beyond 21:9 at 50 deg vertical
TY0, TY1 = -0.53, 0.13


def cam_basis():
    p = math.radians(pipeline.PITCH_DEG)
    fwd = Vector((0.0, math.cos(p), math.sin(p)))
    right = Vector((1.0, 0.0, 0.0))
    up = right.cross(fwd).normalized()
    up = -up if up.z < 0 else up
    return fwd, right, up


def project(P):
    """World point -> (tan_x, tan_y, depth) in the player camera."""
    fwd, right, up = cam_basis()
    d = Vector(P) - EYE
    z = d.dot(fwd)
    return d.dot(right) / max(z, 1e-4), d.dot(up) / max(z, 1e-4), z


def is_static(ob):
    """A mesh that ends up in town.glb with baked light."""
    if ob.type != 'MESH' or ob.get('export', 1) == 0:
        return False
    return not ob.name.startswith(('glass.', 'ground.shadow'))


# ---------------------------------------------------------------------------
# Join: few objects per group and surface (fewer draw calls in the browser)

def join_groups(scene):
    by_key = {}
    for ob in list(scene.objects):
        if not is_static(ob):
            continue
        if ob.name.startswith(KEEP_PREFIX):
            continue
        g = ob.get('group', 'far')
        s = ob.get('surface', 'wood')
        by_key.setdefault((g, s), []).append(ob)
    joined = []
    for (g, s), obs in sorted(by_key.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = f"static.{g}.{s}"
        ob.data.name = ob.name
        for k in list(ob.keys()):
            if k not in ('group', 'surface'):
                del ob[k]
        ob['group'] = g
        ob['surface'] = s
        joined.append(ob)
    return joined


def group_objects(scene, group):
    return [o for o in scene.objects if is_static(o) and o.get('group') == group]


# ---------------------------------------------------------------------------
# UVs

def occluder_bvh(scene):
    """One BVH over every opaque static surface, for visibility tests."""
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in scene.objects:
        if not is_static(ob):
            continue
        me = ob.evaluated_get(dg).to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


def visible_point(bvh, p, n=None):
    d = p - EYE
    dist = d.length
    if dist < 1e-3:
        return True
    hit = bvh.ray_cast(EYE, d / dist, dist - 0.03)
    return hit[0] is None


def in_frustum(p, margin=1.12):
    tx, ty, z = project(p)
    return z > 0.2 and abs(tx) < TX * margin and TY0 * margin < ty < TY1 + 0.4


def ppm_for(p, visible):
    """Target texels per metre at a point."""
    if not visible:
        return FOCAL_PX / 900.0
    d = max((p - EYE).length, 2.5)
    return QUALITY * FOCAL_PX / d


def island_density(isl, mw, bvh):
    """Target texels/metre for an island: the most demanding of its
    (largest) faces, visible ones at QUALITY x screen density."""
    best = 0.0
    vis_any = False
    faces = sorted(isl, key=lambda f: -f.calc_area())[:6]
    for f in faces:
        c = mw @ f.calc_center_median()
        n = (mw.to_3x3() @ f.normal).normalized()
        vis = False
        if n.dot(EYE - c) > 0.0 and in_frustum(c):
            for p in [c] + [mw @ v.co for v in f.verts]:
                q = p + n * 0.01 + (c - p) * 0.05
                if in_frustum(q) and visible_point(bvh, q):
                    vis = True
                    break
        vis_any |= vis
        best = max(best, ppm_for(c, vis))
    return best, vis_any


def shelf_pack(items, margin, aspect=1.0):
    """items: list of [w, h] (already density-scaled, arbitrary units).
    Returns (scale, placements[(x, y, rotated)]) filling a 1 x 1 square
    (x runs to `aspect` if the atlas is wider than tall; UVs are normalised
    later). Height-sorted shelves, binary search on the global scale."""
    order = sorted(range(len(items)), key=lambda i: -max(items[i][0], items[i][1]) if False else -items[i][1])

    def try_pack(sc, place=False):
        x = y = shelf_h = 0.0
        out = [None] * len(items) if place else None
        for i in order:
            w, h = items[i][0] * sc, items[i][1] * sc
            if w + margin > aspect:
                return False if not place else out
            if x + w + margin > aspect:
                y += shelf_h + margin
                x = 0.0
                shelf_h = 0.0
            if place:
                out[i] = (x + margin / 2, y + margin / 2)
            x += w + margin
            shelf_h = max(shelf_h, h)
            if y + shelf_h + margin > 1.0:
                return False if not place else out
        return True if not place else out

    lo, hi = 0.0, 1.0
    while try_pack(hi):
        hi *= 2.0
    for _ in range(28):
        mid = (lo + hi) / 2
        if try_pack(mid):
            lo = mid
        else:
            hi = mid
    return lo, try_pack(lo, place=True)


def unwrap_group(scene, objs, bvh, size):
    """Smart UV islands -> each scaled to its on-screen density -> shelf
    packed by us (deterministic, tight, fast) into the 'bake' layer."""
    from bpy_extras import bmesh_utils
    for ob in objs:
        me = ob.data
        uv = me.uv_layers.get('bake') or me.uv_layers.new(name='bake')
        me.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    t = time.time()
    islands = []   # (bm, uvl, faces, bbox, density)
    bms = []
    nvis = 0
    for ob in objs:
        me = ob.data
        bm = bmesh.from_edit_mesh(me)
        uvl = bm.loops.layers.uv['bake']
        bms.append((me, bm))
        mw = ob.matrix_world
        for isl in bmesh_utils.bmesh_linked_uv_islands(bm, uvl):
            dens, vis = island_density(isl, mw, bvh)
            nvis += vis
            a3 = sum(f.calc_area() for f in isl)
            us = [l[uvl].uv.copy() for f in isl for l in f.loops]
            auv = 0.0
            for f in isl:
                uvs = [l[uvl].uv for l in f.loops]
                for i in range(1, len(uvs) - 1):
                    e1 = uvs[i] - uvs[0]
                    e2 = uvs[i + 1] - uvs[0]
                    auv += abs(e1.x * e2.y - e1.y * e2.x) / 2
            if a3 < 1e-10 or auv < 1e-14:
                k = 1e-6
            else:
                k = dens / math.sqrt(auv / a3)   # scale to reach `dens` units per metre
            umin = min(u.x for u in us)
            vmin = min(u.y for u in us)
            umax = max(u.x for u in us)
            vmax = max(u.y for u in us)
            islands.append((uvl, isl, (umin, vmin), k, (umax - umin) * k, (vmax - vmin) * k))
    print(f"  {len(islands)} islands, {nvis} visible, measured in {time.time() - t:.1f}s")
    t = time.time()
    w_px, h_px = size
    aspect = w_px / h_px
    margin = MARGIN_PX / h_px
    items = []
    rots = []
    for (_, _, _, _, w, h) in islands:
        rot = h > w * 1.05
        rots.append(rot)
        items.append((h, w) if rot else (w, h))
    sc, places = shelf_pack(items, margin, aspect)
    for (uvl, isl, (umin, vmin), k, w, h), rot, (px, py) in zip(islands, rots, places):
        for f in isl:
            for l in f.loops:
                du = (l[uvl].uv.x - umin) * k * sc
                dv = (l[uvl].uv.y - vmin) * k * sc
                if rot:
                    du, dv = dv, w * sc - du
                l[uvl].uv.x = (px + du) / aspect
                l[uvl].uv.y = py + dv
    for me, bm in bms:
        bmesh.update_edit_mesh(me)
    # dens is the target in texels/metre; the packer's global scale says
    # what fraction of that target the atlas can actually give.
    print(f"  packed in {time.time() - t:.1f}s: {sc * h_px:.2f} x target density "
          f"({sc * h_px * QUALITY:.2f} texels per screen pixel at 1000 px tall)")
    bpy.ops.object.mode_set(mode='OBJECT')
    return sc * h_px


def projective_uv(ob, bvh_terrain=None):
    """Ground/terrain: UV = the point's position on the player's screen.
    Back-facing, off-screen or self-occluded faces are collapsed into a
    corner so they can never overwrite visible texels."""
    me = ob.data
    uv = me.uv_layers.get('bake') or me.uv_layers.new(name='bake')
    mw = ob.matrix_world
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    co = (np.asarray(mw) @ np.c_[co, np.ones(n)].T).T[:, :3]
    fwd, right, up = cam_basis()
    d = co - np.array(EYE)
    z = d @ np.array(fwd)
    tx = (d @ np.array(right)) / np.maximum(z, 1e-3)
    ty = (d @ np.array(up)) / np.maximum(z, 1e-3)
    u = 0.5 + tx / (2 * TX)
    v = (ty - TY0) / (TY1 - TY0)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    luv = np.stack([u[lv], v[lv]], -1)
    # per-face validity
    npoly = len(me.polygons)
    ls = np.empty(npoly, np.int32)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    me.polygons.foreach_get('loop_total', lt)
    nrm = np.empty(npoly * 3, np.float32)
    me.polygons.foreach_get('normal', nrm)
    nrm = (np.asarray(mw.to_3x3()) @ nrm.reshape(-1, 3).T).T
    cen = np.empty(npoly * 3, np.float32)
    me.polygons.foreach_get('center', cen)
    cen = (np.asarray(mw) @ np.c_[cen.reshape(-1, 3), np.ones(npoly)].T).T[:, :3]
    front = np.einsum('ij,ij->i', nrm, np.array(EYE) - cen) > 0
    minz = np.minimum.reduceat(z[lv], ls)
    ok = front & (minz > 0.25)
    uvf = np.stack([u, v], -1)
    inside = (np.abs(tx) < TX * 1.3) & (ty > TY0 * 1.3) & (ty < TY1 + 0.3)
    anyin = np.maximum.reduceat(inside[lv].astype(np.int8), ls) > 0
    ok &= anyin
    if bvh_terrain is not None:
        idx = np.nonzero(ok)[0]
        for i in idx:
            c = Vector(cen[i]) + Vector(nrm[i]) * 0.05
            dd = c - EYE
            dist = dd.length
            hit = bvh_terrain.ray_cast(EYE, dd / dist, dist - 0.5)
            if hit[0] is not None:
                ok[i] = False
    bad_loops = np.repeat(~ok, lt)
    luv[bad_loops] = (0.0005, 0.0005)
    uv.data.foreach_set('uv', luv.astype(np.float32).ravel())
    print(f"  projective UV on {ob.name}: {ok.sum()} / {npoly} faces mapped")


# ---------------------------------------------------------------------------
# Baking

def _target_nodes(objs, img):
    """Point every material of these objects at `img` (active image node)."""
    mats = {s.material for o in objs for s in o.material_slots if s.material}
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get('__bake_target')
        if n is None:
            n = nt.nodes.new('ShaderNodeTexImage')
            n.name = '__bake_target'
        n.image = img
        n.interpolation = 'Closest'
        for x in nt.nodes:
            x.select = False
        n.select = True
        nt.nodes.active = n
    return mats


def bake_pass(scene, objs, size, kind, samples, name):
    """Bake one pass for the objects into a float image; returns (H,W,3)."""
    w, h = size
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    _target_nodes(objs, img)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scene.cycles.samples = samples
    b = scene.render.bake
    b.margin = MARGIN_PX
    b.margin_type = 'EXTEND'
    b.use_clear = True
    b.target = 'IMAGE_TEXTURES'
    b.use_selected_to_active = False
    kw = dict(type=kind, margin=MARGIN_PX, margin_type='EXTEND', use_clear=True, uv_layer='bake')
    if kind == 'DIFFUSE_COLOR':
        kw.update(type='DIFFUSE', pass_filter={'COLOR'})
    elif kind == 'IRRADIANCE':
        kw.update(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    elif kind == 'GLOSSY':
        kw.update(type='GLOSSY', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'})
        b.view_from = 'ACTIVE_CAMERA'
    elif kind == 'EMIT':
        kw.update(type='EMIT')
    t = time.time()
    bpy.ops.object.bake(**kw)
    b.view_from = 'ABOVE_SURFACE'
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)[..., :3].copy()
    bpy.data.images.remove(img)
    print(f"  baked {kind:14s} {w}x{h} @ {samples} spp in {time.time() - t:.1f}s", flush=True)
    return arr


def denoise(arr, albedo=None):
    """OIDN through the compositor on an empty scene."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new("__dn_in", w, h, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = arr
    img.pixels.foreach_set(px.ravel())
    alb = None
    sc = bpy.data.scenes.get("__denoise") or bpy.data.scenes.new("__denoise")
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    tree = bpy.data.node_groups.new("__dn", 'CompositorNodeTree')
    sc.compositing_node_group = tree
    ni = tree.nodes.new('CompositorNodeImage')
    ni.image = img
    nd = tree.nodes.new('CompositorNodeDenoise')
    try:
        nd.inputs['HDR'].default_value = True
    except Exception:
        pass
    out = tree.nodes.new('NodeGroupOutput')
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    tree.links.new(ni.outputs[0], nd.inputs['Image'])
    if albedo is not None:
        alb = bpy.data.images.new("__dn_alb", w, h, float_buffer=True)
        pa = np.ones((h, w, 4), np.float32)
        pa[..., :3] = albedo
        alb.pixels.foreach_set(pa.ravel())
        na = tree.nodes.new('CompositorNodeImage')
        na.image = alb
        tree.links.new(na.outputs[0], nd.inputs['Albedo'])
    tree.links.new(nd.outputs[0], out.inputs[0])
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    path = os.path.join(bpy.app.tempdir, "__dn.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    res = np.asarray(inp.read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(h, w, 3)[::-1].copy()
    inp.close()
    bpy.data.node_groups.remove(tree)
    bpy.data.images.remove(img)
    if alb is not None:
        bpy.data.images.remove(alb)
    return res


def bake_group(ctx, scene, group, objs, size):
    q = ctx.quick
    s_irr = 48 if q else 512
    s_gl = 16 if q else 192
    alb = bake_pass(scene, objs, size, 'DIFFUSE_COLOR', 4 if q else 16, f"{group}_albedo")
    irr = bake_pass(scene, objs, size, 'IRRADIANCE', s_irr, f"{group}_irr")
    irr = denoise(irr)
    gl = bake_pass(scene, objs, size, 'GLOSSY', s_gl, f"{group}_gloss")
    gl = denoise(gl, albedo=None)
    ao = bake_pass(scene, objs, size, 'AO', 8 if q else 64, f"{group}_ao")
    pos = bake_pass(scene, objs, size, 'POSITION', 1, f"{group}_pos")
    rgb = alb * irr * (0.65 + 0.35 * np.clip(ao, 0, 1)) + np.clip(gl, 0, None)
    valid = np.linalg.norm(pos, axis=-1) > 1e-3
    rgb = post.apply_fog(rgb, pos, valid)
    np.save(os.path.join(ctx.build, f"atlas_{group}_linear.npy"), rgb.astype(np.float16))
    png = os.path.join(ctx.build, f"atlas_{group}.png")
    post.save_display(rgb, png, scene, fmt='PNG', flip=False)
    return png


def stage(ctx):
    pipeline.open_blend(ctx.blend)
    scene = bpy.context.scene
    core.setup_gpu(scene)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    try:
        scene.world.light_settings.distance = 0.6     # AO: contact shadows only
    except AttributeError:
        pass
    scene.camera = bpy.data.objects['camera.player']
    scene.view_settings.view_transform = lighting.VIEW_TRANSFORM
    scene.view_settings.look = lighting.LOOK
    # the far world does not light the town; glass must let light in
    for ob in scene.objects:
        if any(c.name == 'farworld' for c in ob.users_collection) or ob.name.startswith(('glass.', 'ground.shadow')):
            ob.hide_render = True
    t = time.time()
    join_groups(scene)
    print(f"joined in {time.time() - t:.1f}s")
    # replace the dense street with... no: bake ON the dense street, export
    # a light one later (export.py) with the same projective UVs.
    bvh_all = occluder_bvh(scene)
    terrain = bpy.data.objects['ground.terrain']
    street = bpy.data.objects['ground.street']
    tb = BVHTree.FromObject(terrain, bpy.context.evaluated_depsgraph_get())
    projective_uv(street)
    projective_uv(terrain, tb)
    groups = {}
    for ob in scene.objects:
        if is_static(ob):
            g = ob.get('group')
            if g in ATLAS:
                groups.setdefault(g, []).append(ob)
    for g, objs in groups.items():
        if g == 'ground':
            continue
        t = time.time()
        print(f"UV {g}: {len(objs)} objects")
        unwrap_group(scene, objs, bvh_all, ATLAS[g])
        print(f"  unwrap {g} in {time.time() - t:.1f}s")
    for g, objs in groups.items():
        if ctx.preview and g != ctx.preview:
            continue
        t = time.time()
        print(f"BAKE {g}: {len(objs)} objects", flush=True)
        bake_group(ctx, scene, g, objs, ATLAS[g])
        print(f"  {g} done in {time.time() - t:.1f}s", flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.baked_blend, compress=True)
