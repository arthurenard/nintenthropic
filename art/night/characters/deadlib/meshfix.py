"""Decimation that cannot crash what comes after it.

Blender 5.1's collapse decimation now and then leaves corrupt corner-edge
indices behind; Mesh.validate() does not always repair them, and the next
BMesh built from that mesh (UV unwrapping, edit mode) dies with SIGSEGV.
High Noon met it rarely; the dead's more cavernous heads meet it often. So
after decimating, the mesh is rebuilt from nothing but its vertex positions
and polygon corners - fresh edges, fresh corner edges - before anything else
touches it.
"""

import bpy
import numpy as np

from .common import C, bl


def rebuild(ob):
    me = ob.data
    n = len(me.vertices)
    V = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    ls = np.empty(len(me.polygons), np.int32)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    faces = []
    for s, t in zip(ls, lt):
        f = lv[s:s + t].tolist()
        if len(set(f)) == len(f) and len(f) >= 3:
            faces.append(f)
    new = bpy.data.meshes.new(me.name + "_r")
    new.vertices.add(n)
    new.vertices.foreach_set("co", V.ravel())
    sizes = np.array([len(f) for f in faces], np.int32)
    loops = np.array([i for f in faces for i in f], np.int32)
    new.loops.add(len(loops))
    new.loops.foreach_set("vertex_index", loops)
    new.polygons.add(len(sizes))
    new.polygons.foreach_set("loop_start", np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32))
    new.update(calc_edges=True)
    new.validate(clean_customdata=False)
    new.shade_smooth()
    old = ob.data
    ob.data = new
    name = old.name
    bpy.data.meshes.remove(old)
    new.name = name
    return ob


def decimated(name, field, lo, hi, res, tris, coll=None, M=None, o=None, blur=1.0, symmetry=False):
    ob = C.decimated(name, field, lo, hi, res, tris, coll, M=M, o=o, blur=blur, symmetry=symmetry)
    return rebuild(ob)


def decimate(ob, tris, symmetry=True):
    bl.decimate(ob, tris, symmetry=symmetry)
    return rebuild(ob)


def decimate_weighted(ob, tris, weights, symmetry=True, factor=1.0):
    """Collapse-decimate with per-vertex importance: a vertex weighted low
    is expensive to collapse, so the face keeps its triangles and the scalp
    and neck give theirs up (weight 1 = ordinary, 0 = never collapsed)."""
    vg = ob.vertex_groups.new(name="importance")
    w = np.clip(np.asarray(weights, np.float32), 0.02, 1.0)
    q = np.round(w * 20) / 20
    for val in np.unique(q):
        idx = np.nonzero(q == val)[0].tolist()
        vg.add(idx, float(val), 'REPLACE')
    for _ in range(3):
        n = bl.tri_count(ob)
        if n <= tris * 1.05:
            break
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = tris / n
        m.use_symmetry = symmetry
        m.symmetry_axis = "X"
        m.use_collapse_triangulate = True
        m.vertex_group = "importance"
        m.vertex_group_factor = factor
        bl.apply_modifiers(ob)
    ob.vertex_groups.clear()
    return rebuild(ob)


def relax_project(ob, field, origin, iters=3, lam=0.35):
    """Even out a decimated mesh's triangles (tangential Laplacian smoothing)
    and put every vertex back on the sculpt, so slivers become well-shaped
    triangles without the surface moving. Open boundaries stay put."""
    import bmesh
    from .common import S
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    fixed = np.array([v.is_boundary for v in bm.verts], bool)
    edges = np.array([[e.verts[0].index, e.verts[1].index] for e in bm.edges], np.int64)
    bm.free()
    n = len(me.vertices)
    V = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3) - np.asarray(origin, np.float32)
    deg = np.bincount(edges.ravel(), minlength=n).astype(np.float32)
    free = (~fixed) & (deg > 0)
    for _ in range(iters):
        acc = np.zeros_like(V)
        np.add.at(acc, edges[:, 0], V[edges[:, 1]])
        np.add.at(acc, edges[:, 1], V[edges[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        g = S.gradient(field, V[free])
        nn = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
        d = avg[free] - V[free]
        d -= (d * nn).sum(1)[:, None] * nn
        V[free] = V[free] + lam * d
        V[free] = S.project_to_surface(field, V[free], iters=3, clamp=0.002)
    me.vertices.foreach_set("co", (V + np.asarray(origin, np.float32)).ravel())
    me.update()
    return ob
