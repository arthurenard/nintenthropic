"""Skin weights: bone heat on one closed proxy body, transferred to every layer.

Shirt, trousers, belts, boots and later a coat are separate shells lying on
top of each other. If each were weighted on its own they would deform
differently and poke through one another in a crouch. So the weights are
computed once, by Blender's bone-heat solver, on a closed proxy polygonised
from the union of all the body's fields, and every game mesh takes the
weights of the nearest point of that proxy. Layers that lie together move
together.
"""
import numpy as np
import bpy
from mathutils.bvhtree import BVHTree
from . import bl, polygonize as PG
from .skeleton import BONE_NAMES


def make_proxy(field, lo, hi, res=0.007, coll=None):
    V, Q = PG.mesh_sdf(field, lo, hi, res, blur=1.0)
    ob = bl.mesh_from_arrays("_skin_proxy", V, Q, coll)
    # voxel remesh: bone heat wants a clean closed manifold
    m = ob.modifiers.new("rm", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = res
    bl.apply_modifiers(ob)
    return ob


def heat_weights(proxy, rig):
    bl.set_active(proxy)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    with bpy.context.temp_override(active_object=rig, selected_editable_objects=[proxy, rig], selected_objects=[proxy, rig]):
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    missing = [b.name for b in rig.data.bones if b.name not in proxy.vertex_groups]
    return missing


def weight_matrix(ob, names=None):
    """(n_verts, n_bones) weights in `names` order (the humanoid's by default)."""
    names = names or BONE_NAMES
    n = len(ob.data.vertices)
    W = np.zeros((n, len(names)), np.float32)
    gi = {g.index: names.index(g.name) for g in ob.vertex_groups if g.name in names}
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group in gi:
                W[v.index, gi[g.group]] = g.weight
    return W


def transfer(proxy, targets, rig, max_inf=4, smooth=0, override=None, names=None):
    """Give each target the proxy's weights at its nearest proxy surface point."""
    names = names or BONE_NAMES
    Wp = weight_matrix(proxy, names)
    Vp = bl.verts_np(proxy)
    polys = [tuple(p.vertices) for p in proxy.data.polygons]
    bvh = BVHTree.FromPolygons([tuple(v) for v in Vp], polys)
    for ob in targets:
        V = bl.verts_np(ob, world=True)
        W = np.zeros((len(V), len(names)), np.float32)
        for i, v in enumerate(V):
            loc, nrm, fi, dist = bvh.find_nearest(v)
            if fi is None:
                continue
            pv = polys[fi]
            P = Vp[list(pv)]
            # inverse-distance blend of the face's corners (faces are small quads)
            d = np.linalg.norm(P - np.array(loc), axis=1) + 1e-6
            w = 1.0 / d
            W[i] = (w[:, None] * Wp[list(pv)]).sum(0) / w.sum()
        # anything bone heat could not reach (a spread fingertip that was an
        # island in the proxy) falls back to the nearest bone
        W = nearest_bone_fill(rig, V, W, names)
        if override is not None:
            W = override(ob, V, W)
        apply_weights(ob, W, rig, max_inf, names)


def nearest_bone_fill(rig, V, W, names, thresh=0.6):
    s = W.sum(1)
    weak = s < thresh
    if not weak.any():
        return W
    M = np.array(rig.matrix_world, np.float64)
    segs = []
    for b in names:
        bb = rig.data.bones[b]
        h = (M @ np.append(np.array(bb.head_local), 1))[:3]
        t = (M @ np.append(np.array(bb.tail_local), 1))[:3]
        segs.append((h, t))
    P = V[weak].astype(np.float64)
    D = np.zeros((len(P), len(names)))
    for j, (h, t) in enumerate(segs):
        d = t - h
        u = np.clip(((P - h) @ d) / max(d @ d, 1e-12), 0, 1)
        D[:, j] = np.linalg.norm(P - (h + u[:, None] * d), axis=1)
    near = np.argmin(D, axis=1)
    W = W.copy()
    fill = np.zeros((len(P), len(names)), np.float32)
    fill[np.arange(len(P)), near] = 1.0
    W[weak] = W[weak] + (thresh - s[weak])[:, None] * fill / thresh
    return W


def apply_weights(ob, W, rig, max_inf=4, names=None):
    """Keep the strongest `max_inf` influences, normalise, write vertex groups,
    parent to the rig with an Armature modifier."""
    names = names or BONE_NAMES
    W = W.copy()
    if max_inf < W.shape[1]:
        idx = np.argsort(-W, axis=1)[:, max_inf:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    s = W.sum(1)
    empty = s < 1e-6
    W[empty, 0] = 1.0          # the root bone
    W /= W.sum(1, keepdims=True)
    ob.vertex_groups.clear()
    groups = [ob.vertex_groups.new(name=b) for b in names]
    for j, g in enumerate(groups):
        nz = np.nonzero(W[:, j] > 1e-4)[0]
        for i in nz:
            g.add([int(i)], float(W[i, j]), "REPLACE")
    for m in list(ob.modifiers):
        if m.type == "ARMATURE":
            ob.modifiers.remove(m)
    mw = ob.matrix_world.copy()
    ob.parent = rig
    ob.matrix_world = mw
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig


def rigid(ob, rig, bone):
    W = np.zeros((len(ob.data.vertices), len(BONE_NAMES)), np.float32)
    W[:, BONE_NAMES.index(bone)] = 1.0
    apply_weights(ob, W, rig, 1)
