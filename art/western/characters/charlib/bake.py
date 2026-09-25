"""One texture atlas per character: pack every game mesh's UVs together, then
bake the sculpts (colour, roughness, metalness, normals, ambient occlusion)
into it with Cycles.

Baking "selected to active" from a dense sculpt onto the game mesh is what lets
an 8-15k triangle character carry the folds, pores and stitching of a
quarter-million-polygon one.
"""
import os
import numpy as np
import bpy
from . import bl, materials as M


def setup_cycles(samples=8):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:  # CPU is fine, just slower
        print("cycles: no GPU", e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 4
    sc.render.bake.margin_type = "EXTEND"


# ------------------------------------------------------------------ UVs

def _edit(objs, fn):
    """Run fn() in edit mode over several meshes at once (multi-object editing)."""
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        fn()
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def smart_uv(ob, angle=62.0, margin=0.004):
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    _edit([ob], lambda: bpy.ops.uv.smart_project(angle_limit=np.radians(angle), island_margin=margin,
                                                 area_weight=0.0, correct_aspect=True, scale_to_bounds=False))


def unwrap(ob, method="ANGLE_BASED"):
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    _edit([ob], lambda: bpy.ops.uv.unwrap(method=method, margin=0.004))


def uv_area_3d_ratio(ob):
    """Texel scale of an object's current UVs: sqrt(uv area / surface area)."""
    me = ob.data
    uv = bl.get_uv(ob)
    li = 0
    a3 = 0.0
    a2 = 0.0
    V = bl.verts_np(ob)
    for p in me.polygons:
        n = p.loop_total
        idx = np.arange(p.loop_start, p.loop_start + n)
        pts = uv[idx]
        a2 += 0.5 * abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))
        a3 += p.area
    return np.sqrt(a2 / max(a3, 1e-9))


def normalise_density(objs, weights):
    """Scale each object's UVs so texel density is proportional to its weight
    (the face gets more pixels than the back of the trousers)."""
    for ob, w in zip(objs, weights):
        r = uv_area_3d_ratio(ob)
        uv = bl.get_uv(ob)
        c = uv.mean(0)
        uv = (uv - c) * (w / max(r, 1e-9)) * 0.1 + c
        bl.set_uv(ob, uv, ob.data.uv_layers.active.name)


def pack(objs, margin=0.006):
    def f():
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="CARDINAL",
                                scale=True, merge_overlap=False, margin_method="FRACTION",
                                margin=margin, shape_method="CONCAVE")
    _edit(objs, f)


# ------------------------------------------------------------------ baking

def new_image(name, size, color=(0.5, 0.5, 0.5, 1.0), non_color=False):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    px = np.tile(np.asarray(color, np.float32), size * size)
    img.pixels.foreach_set(px)
    return img


def _target_material(low, img):
    """Give the low mesh a throwaway material whose active node is the target image."""
    m = bpy.data.materials.get("_bake_target") or bpy.data.materials.new("_bake_target")
    m.use_nodes = True
    nt = m.node_tree
    node = nt.nodes.get("TGT") or nt.nodes.new("ShaderNodeTexImage")
    node.name = "TGT"
    node.image = img
    nt.nodes.active = node
    low.data.materials.clear()
    low.data.materials.append(m)


def bake(pairs, img, kind, extrusion=0.006, max_dist=0.02, samples=4, extra_visible=()):
    """pairs: [(low, [highs...])]. kind: albedo|rough|metal|normal|ao."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    for low, highs in pairs:
        for h in highs:
            for ms in h.data.materials:
                if ms and "EM" in ms.node_tree.nodes:
                    M.route(ms, "normal" if kind in ("normal", "ao") else kind)
        _target_material(low, img)
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        for h in highs:
            h.hide_render = False
            h.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        btype = {"albedo": "EMIT", "rough": "EMIT", "metal": "EMIT", "normal": "NORMAL", "ao": "AO"}[kind]
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=extrusion,
                            max_ray_distance=max_dist, margin=4, use_clear=False,
                            normal_space="TANGENT", target="IMAGE_TEXTURES")
    return img


def image_np(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def save(img, path):
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def compose_orm(ao, rough, metal, name, size):
    """Pack occlusion, roughness and metalness into one Non-Color RGB image."""
    A, R, Mt = image_np(ao), image_np(rough), image_np(metal)
    out = np.ones_like(A)
    out[..., 0] = A[..., 0]
    out[..., 1] = R[..., 0]
    out[..., 2] = Mt[..., 0]
    img = new_image(name, size, non_color=True)
    img.pixels.foreach_set(out.ravel())
    return img
