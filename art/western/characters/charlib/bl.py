"""Small Blender helpers: numpy <-> mesh, modifiers applied without operators.

Everything here avoids bpy.ops where a data-API route exists, because operators
depend on UI context that a headless build does not have.
"""
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector


def clear_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights,
                 bpy.data.node_groups, bpy.data.textures, bpy.data.curves):
        for item in list(coll):
            coll.remove(item)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    bpy.context.view_layer.update()


def collection(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def mesh_from_arrays(name, verts, faces, coll=None, smooth=True):
    """Build a mesh from (V,3) floats and a list/array of faces (all quads, all
    tris, or a python list of mixed polygons)."""
    verts = np.asarray(verts, np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    if isinstance(faces, np.ndarray):
        sizes = np.full(len(faces), faces.shape[1], np.int32)
        loops = faces.ravel().astype(np.int32)
    else:
        sizes = np.array([len(f) for f in faces], np.int32)
        loops = np.array([i for f in faces for i in f], np.int32)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    me.loops.add(len(loops))
    me.loops.foreach_set("vertex_index", loops)
    me.polygons.add(len(sizes))
    me.polygons.foreach_set("loop_start", starts)  # loop_total is derived from the starts
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def verts_np(ob, world=False):
    me = ob.data
    v = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", v)
    v = v.reshape(-1, 3)
    if world:
        M = np.array(ob.matrix_world, np.float32)
        v = v @ M[:3, :3].T + M[:3, 3]
    return v


def set_verts(ob, v):
    ob.data.vertices.foreach_set("co", np.asarray(v, np.float32).ravel())
    ob.data.update()


def faces_np(ob):
    """Polygons as a python list of vertex index tuples."""
    return [tuple(p.vertices) for p in ob.data.polygons]


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def apply_modifiers(ob):
    """Bake the modifier stack into the mesh data (no operator, no context)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def decimate(ob, target_tris, symmetry=True):
    """Collapse-decimate to about target_tris (a pass can stall on thin
    features such as a rolled brim, so go again until it gets there)."""
    for _ in range(4):
        tris = tri_count(ob)
        if tris <= target_tris * 1.05:
            break
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target_tris / tris
        m.use_symmetry = symmetry
        m.symmetry_axis = "X"
        m.use_collapse_triangulate = True
        apply_modifiers(ob)
    return ob


def subdivide(ob, levels):
    m = ob.modifiers.new("sub", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.uv_smooth = "PRESERVE_BOUNDARIES"
    m.boundary_smooth = "PRESERVE_CORNERS"
    return apply_modifiers(ob)


def triangulate(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def recalc_normals(ob, inside=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def join(objs, name):
    """Join meshes into the first one (via bmesh, keeping materials and UVs by name)."""
    objs = [o for o in objs if o is not None]
    base = objs[0]
    with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def set_active(ob):
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


def set_attr(ob, name, values, domain="POINT", dtype="FLOAT"):
    me = ob.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    a = me.attributes.new(name, dtype, domain)
    key = "value" if dtype in ("FLOAT", "INT", "BOOLEAN") else ("vector" if dtype == "FLOAT_VECTOR" else "color")
    a.data.foreach_set(key, np.asarray(values, np.float32 if dtype != "INT" else np.int32).ravel())
    return a


def set_color_attr(ob, name, rgba, domain="POINT"):
    me = ob.data
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    a = me.color_attributes.new(name, "FLOAT_COLOR", domain)
    a.data.foreach_set("color", np.asarray(rgba, np.float32).ravel())
    return a


def loop_vertex_indices(me):
    li = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", li)
    return li


def set_uv(ob, uv_per_loop, name="UVMap"):
    me = ob.data
    layer = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    layer.data.foreach_set("uv", np.asarray(uv_per_loop, np.float32).ravel())
    return layer


def get_uv(ob, name=None):
    me = ob.data
    layer = me.uv_layers.get(name) if name else me.uv_layers.active
    uv = np.empty(len(me.loops) * 2, np.float32)
    layer.data.foreach_get("uv", uv)
    return uv.reshape(-1, 2)


def world_matrix_np(ob):
    return np.array(ob.matrix_world, np.float64)
