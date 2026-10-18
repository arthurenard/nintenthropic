"""One texture atlas per character: unwrap every game mesh, scale its islands
so texel density follows its weight, and pack them all into one square.

The texels themselves are baked analytically, straight from the sculpt's
field, by abake.py.
"""
import numpy as np
import bpy
from . import bl


# ------------------------------------------------------------------ UVs

def _edit(objs, fn):
    """Run fn() in edit mode over several meshes at once (multi-object editing)."""
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
        # entering edit mode builds a BMesh from the corner/edge arrays and
        # crashes (SIGBUS) on a bad index; see bl.decimate
        o.data.validate()
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


def uv_area_3d_ratio(ob):
    """Texel scale of an object's current UVs: sqrt(uv area / surface area)."""
    me = ob.data
    uv = bl.get_uv(ob)
    a3 = 0.0
    a2 = 0.0
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
