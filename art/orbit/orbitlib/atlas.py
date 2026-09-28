"""Texture atlases: UV islands packed by how much they matter, Cycles bake
passes into float images, and OIDN denoising.

Adapted from High Noon's bake (art/western/dustcreek/bake.py): because the
player's eye never moves, the static scenery gets its texels where the eye
sees it - each island scaled by the screen pixels a metre of it covers
from the eye (1/distance, tested for visibility by ray casts), faces nobody
can see get almost nothing. Loose objects (debris, the drone...) are seen
from anywhere and get a uniform density instead, weighted per object.
"""

import math
import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import world

MARGIN_PX = 6


# ---------------------------------------------------------------------------
# Densities

class EyeDensity:
    """Texels per metre an island needs, seen from the eye at the origin
    with the player's camera: QUALITY texels per screen pixel at a screen
    FOCAL_PX tall, where visible; next to nothing where not."""

    def __init__(self, occluders, screen_h=1440, quality=1.0, floor=12.0):
        self.focal = screen_h / 2 / math.tan(math.radians(world.VFOV_DEG) / 2)
        self.quality = quality
        self.floor = floor
        self.bvh = occluder_bvh(occluders)
        R = world.camera_rotation()
        self.fwd = Vector(-R[:, 2])
        self.right = Vector(R[:, 0])
        self.up = Vector(R[:, 1])
        self.tx = math.tan(math.radians(world.VFOV_DEG) / 2) * 2.4 * 1.05    # up to 21:9
        self.ty = math.tan(math.radians(world.VFOV_DEG) / 2) * 1.05

    def in_frustum(self, p):
        z = p.dot(self.fwd)
        if z < 0.02:
            return False
        return abs(p.dot(self.right) / z) < self.tx and abs(p.dot(self.up) / z) < self.ty

    def visible(self, p):
        d = p.length
        if d < 1e-3:
            return True
        hit = self.bvh.ray_cast(Vector((0, 0, 0)), p / d, d - 0.004)
        return hit[0] is None

    def __call__(self, faces, mw, ob=None):
        best = 0.0
        vis_any = False
        n3 = mw.to_3x3()
        for f in sorted(faces, key=lambda f: -f.calc_area())[:8]:
            c = mw @ f.calc_center_median()
            n = (n3 @ f.normal).normalized()
            vis = False
            if n.dot(-c) > 0.0:
                for p in [c] + [mw @ v.co for v in f.verts]:
                    q = p + n * 0.003 + (c - p) * 0.05
                    if self.in_frustum(q) and self.visible(q):
                        vis = True
                        break
            vis_any |= vis
            if vis:
                d = max(c.length, 0.15)
                best = max(best, self.quality * self.focal / d)
            else:
                best = max(best, self.floor)
        return best, vis_any


class UniformDensity:
    def __init__(self, texels_per_m, weights=None):
        self.t = texels_per_m
        self.w = weights or {}

    def __call__(self, faces, mw, ob=None):
        return self.t * self.w.get(ob.name if ob else None, 1.0), True


def occluder_bvh(objs):
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in objs:
        if ob.type != 'MESH':
            continue
        me = ob.evaluated_get(dg).to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


# ---------------------------------------------------------------------------
# Packing

def shelf_pack(items, margin, aspect=1.0):
    """items: [w, h] in arbitrary units. Returns (scale, [(x, y)]) filling
    a 1 x 1 square (x to `aspect`). Height-sorted shelves, binary search on
    the global scale."""
    order = sorted(range(len(items)), key=lambda i: -items[i][1])

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
    for _ in range(30):
        mid = (lo + hi) / 2
        if try_pack(mid):
            lo = mid
        else:
            hi = mid
    return lo, try_pack(lo, place=True)


def unwrap(objs, size, density, uv_name='bake', angle=60.0, faces_filter=None):
    """Smart-UV every object into `uv_name`, scale each island to the
    density it needs, shelf-pack all of them into one atlas of `size`.
    faces_filter(ob, face) -> False excludes a face (its UVs go to a
    corner). Returns the achieved fraction of the target density."""
    from bpy_extras import bmesh_utils
    for ob in objs:
        me = ob.data
        uv = me.uv_layers.get(uv_name) or me.uv_layers.new(name=uv_name)
        me.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    t = time.time()
    islands = []
    bms = []
    nvis = 0
    for ob in objs:
        me = ob.data
        bm = bmesh.from_edit_mesh(me)
        uvl = bm.loops.layers.uv[uv_name]
        bms.append((me, bm))
        mw = ob.matrix_world
        for isl in bmesh_utils.bmesh_linked_uv_islands(bm, uvl):
            if faces_filter is not None:
                keep = [f for f in isl if faces_filter(ob, f)]
                for f in isl:
                    if f not in keep:
                        for l in f.loops:
                            l[uvl].uv = (0.0005, 0.0005)
                if not keep:
                    continue
                isl = keep
            dens, vis = density(isl, mw, ob)
            nvis += vis
            a3 = sum(f.calc_area() for f in isl) * mw.to_3x3().determinant() ** (2 / 3)
            auv = 0.0
            for f in isl:
                uvs = [l[uvl].uv for l in f.loops]
                for i in range(1, len(uvs) - 1):
                    e1 = uvs[i] - uvs[0]
                    e2 = uvs[i + 1] - uvs[0]
                    auv += abs(e1.x * e2.y - e1.y * e2.x) / 2
            k = 1e-6 if (a3 < 1e-12 or auv < 1e-14) else dens / math.sqrt(auv / a3)
            us = [l[uvl].uv.copy() for f in isl for l in f.loops]
            umin = min(u.x for u in us)
            vmin = min(u.y for u in us)
            umax = max(u.x for u in us)
            vmax = max(u.y for u in us)
            islands.append((uvl, isl, (umin, vmin), k, (umax - umin) * k, (vmax - vmin) * k))
    w_px, h_px = size
    aspect = w_px / h_px
    margin = MARGIN_PX / h_px
    items, rots = [], []
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
    bpy.ops.object.mode_set(mode='OBJECT')
    frac = sc * h_px
    print(f"  {len(islands)} islands ({nvis} seen) packed in {time.time() - t:.1f}s: {frac:.2f} x target density", flush=True)
    return frac


# ---------------------------------------------------------------------------
# Baking

def _target(objs, img):
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


def bake_pass(objs, size, kind, samples, uv='bake', view_from_camera=False, normal_space='TANGENT'):
    """Bake one pass for the objects into a float image; returns (H, W, 3),
    row 0 at the bottom (Blender's image order)."""
    sc = bpy.context.scene
    w, h = size
    img = bpy.data.images.new("__bake", w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color' if kind == 'NORMAL' else 'Linear Rec.709'
    _target(objs, img)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc.cycles.samples = samples
    b = sc.render.bake
    b.margin = MARGIN_PX
    b.margin_type = 'EXTEND'
    b.use_clear = True
    b.target = 'IMAGE_TEXTURES'
    b.use_selected_to_active = False
    kw = dict(margin=MARGIN_PX, margin_type='EXTEND', use_clear=True, uv_layer=uv)
    if kind == 'DIFFUSE_COLOR':
        kw.update(type='DIFFUSE', pass_filter={'COLOR'})
    elif kind == 'IRRADIANCE':
        kw.update(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
    elif kind == 'GLOSSY':
        kw.update(type='GLOSSY', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'})
    elif kind == 'NORMAL':
        kw.update(type='NORMAL', normal_space=normal_space)
    else:
        kw.update(type=kind)
    b.view_from = 'ACTIVE_CAMERA' if view_from_camera else 'ABOVE_SURFACE'
    t = time.time()
    bpy.ops.object.bake(**kw)
    b.view_from = 'ABOVE_SURFACE'
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)[..., :3].copy()
    bpy.data.images.remove(img)
    print(f"    baked {kind:14s} {w}x{h} @ {samples} spp in {time.time() - t:.1f}s", flush=True)
    return arr


def denoise(arr, albedo=None, normal=None):
    """OIDN through the compositor on a throwaway scene (Blender 5 API)."""
    h, w = arr.shape[:2]
    imgs = []

    def mk(a, name):
        im = bpy.data.images.new(name, w, h, float_buffer=True)
        im.colorspace_settings.name = 'Linear Rec.709'
        p = np.ones((h, w, 4), np.float32)
        p[..., :3] = a
        im.pixels.foreach_set(p.ravel())
        imgs.append(im)
        return im
    src = mk(arr, "__dn_in")
    main = bpy.context.scene
    sc = bpy.data.scenes.new("__denoise")
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    tree = bpy.data.node_groups.new("__dn", 'CompositorNodeTree')
    sc.compositing_node_group = tree
    ni = tree.nodes.new('CompositorNodeImage')
    ni.image = src
    nd = tree.nodes.new('CompositorNodeDenoise')
    try:
        nd.inputs['HDR'].default_value = True
    except Exception:
        pass
    out = tree.nodes.new('NodeGroupOutput')
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    tree.links.new(ni.outputs[0], nd.inputs['Image'])
    if albedo is not None:
        na = tree.nodes.new('CompositorNodeImage')
        na.image = mk(albedo, "__dn_alb")
        tree.links.new(na.outputs[0], nd.inputs['Albedo'])
    tree.links.new(nd.outputs[0], out.inputs[0])
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    path = os.path.join(bpy.app.tempdir or "/tmp", "__dn.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    res = np.asarray(inp.read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(h, w, 3)[::-1].copy()
    inp.close()
    bpy.data.node_groups.remove(tree)
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.scenes.remove(sc)
    return res


def fill_empty(arr, valid, iters=48):
    """Grow texels into the parts of the atlas no island covers, so
    mipmaps never bleed black into the edges of islands."""
    a = arr.copy()
    known = valid.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(a, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow][:, None]
        known |= grow
    return a
