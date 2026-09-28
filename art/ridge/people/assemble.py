"""From jobs to a dressed, rigged person: High Noon's pipeline.person, extended.

What is added over charlib.pipeline (which is imported, never edited):
- more than one atlas per file (the soldier's kit - weapons, the ghillie -
  bakes into its own 1024 atlas so the man himself keeps his texel density),
  with occlusion from the body still reaching a variant baked elsewhere;
- props on any socket (socket.gun on hand.R, socket.hand.L, socket.back...);
- skin kinds of our own: an arbitrary weight override (a skirt that follows
  the thighs, a ghillie hood), rigid on a named bone, or rigid on a bone that
  is not part of the humanoid (the bicycle).
"""
import time
import numpy as np
import bpy
from mathutils import Matrix
from . import env
from charlib import bl, abake as AB, materials as MT, skin as SKN, pipeline as PL
from charlib import bake as BK
from charlib.skeleton import BONE_NAMES

log = env.log


def bake_atlas(jobs, size, name, ao_body=()):
    """charlib.abake.bake_character, but a variant baked in this atlas is
    also shadowed by `ao_body` (the body's fields baked in another atlas)."""
    t = time.time()
    for j in jobs:
        if j.get("smart_uv"):
            BK.smart_uv(j["ob"], j.get("uv_angle", 62))
    obs = [j["ob"] for j in jobs]
    BK.normalise_density(obs, [j.get("weight", 1.0) for j in jobs])
    BK.pack(obs, 0.004)
    log(f"  {name}: uv packed {len(obs)} meshes in {time.time() - t:.1f}s")
    groups = {"body": list(ao_body)}
    for j in jobs:
        if j.get("ao_field") is not None:
            groups.setdefault(j.get("ao_group", "body"), []).append((j["ao_field"], j["origin"], j.get("M")))
    at = AB.Atlas(size)
    for j in jobs:
        t = time.time()
        g = j.get("ao_group", "body")
        parts = groups.get("body", []) + (groups.get(g, []) if g != "body" else [])
        if j.get("ao_self_only"):
            parts = groups.get(g, [])
        aof = AB.WorldUnion(parts)
        o = np.asarray(j["origin"], np.float32)
        M = j.get("M")
        if M is None:
            tl, tw, twd = (lambda X, o=o: X - o), (lambda Q, o=o: Q + o), None
        else:
            M = np.asarray(M, np.float32)
            tl = lambda X, o=o, M=M: (X - o) @ M
            tw = lambda Q, o=o, M=M: Q @ M.T + o
            twd = lambda n, M=M: n @ M.T
        n = at.bake(j["ob"], j["field"], j["paint"], ao_field=aof, to_local=tl, to_world=tw, to_world_dir=twd,
                    ao_strength=j.get("ao_strength", 1.0), snap=j.get("snap", True))
        if j.get("flat"):
            # thin cards (the ghillie's strips): their own flat normal, not a field's
            pix = AB.raster(j["ob"], size)[0]
            at.normal[pix[:, 1], pix[:, 0]] = (0.5, 0.5, 1.0)
        log(f"  baked {j['ob'].name}: {n} texels in {time.time() - t:.1f}s")
    at.dilate()
    imgs = at.images(name)
    mat = MT.final_material(name, imgs["albedo"], imgs["normal"], imgs["orm"])
    return mat


def body_fields(jobs):
    return [(j["ao_field"], j["origin"], j.get("M")) for j in jobs if j.get("ao_group", "body") == "body" and j.get("ao_field") is not None]


def skin_all(jobs, rig, proxy):
    """charlib.pipeline.skin_all plus ("override", fn), ("rigid", bone) on any
    bone of the armature, and ("prop",) / ("bone", name) left to finish()."""
    body = [j for j in jobs if j.get("ao_group", "body") == "body"]
    plain = [j["ob"] for j in body if j.get("skin", ("transfer",))[0] == "transfer"]
    SKN.transfer(proxy, plain, rig)
    for j in jobs:
        sk = j.get("skin", ("transfer",))
        if j.get("ao_group", "body") == "body" and sk[0] == "transfer":
            continue
        if sk[0] == "rigid":
            SKN.rigid(j["ob"], rig, sk[1])
        elif sk[0] == "transfer":
            SKN.transfer(proxy, [j["ob"]], rig)
        elif sk[0] == "coat":
            SKN.transfer(proxy, [j["ob"]], rig, override=PL.coat_override(sk[1]))
        elif sk[0] == "override":
            SKN.transfer(proxy, [j["ob"]], rig, override=sk[1])
        elif sk[0] == "points":
            transfer_at(proxy, j["ob"], rig, sk[1])


def transfer_at(proxy, ob, rig, points, names=None):
    """charlib.skin.transfer, but each vertex takes the proxy's weights at
    its own given point (a ghillie strip: the point where it is sewn on)."""
    from mathutils.bvhtree import BVHTree
    names = names or BONE_NAMES
    Wp = SKN.weight_matrix(proxy, names)
    Vp = bl.verts_np(proxy)
    polys = [tuple(p.vertices) for p in proxy.data.polygons]
    bvh = BVHTree.FromPolygons([tuple(v) for v in Vp], polys)
    pts = np.asarray(points, np.float64)
    W = np.zeros((len(pts), len(names)), np.float32)
    cache = {}
    for i, v in enumerate(pts):
        key = tuple(np.round(v, 6))
        if key in cache:
            W[i] = cache[key]
            continue
        loc, nrm, fi, dist = bvh.find_nearest(v)
        if fi is None:
            continue
        pv = list(polys[fi])
        d = np.linalg.norm(Vp[pv] - np.array(loc), axis=1) + 1e-6
        w = 1.0 / d
        W[i] = (w[:, None] * Wp[pv]).sum(0) / w.sum()
        cache[key] = W[i]
    W = SKN.nearest_bone_fill(rig, pts, W, names)
    SKN.apply_weights(ob, W, rig, 4, names)


def attach(o, parent, bone=None):
    """Parent o keeping its world placement, then bake that offset into the
    vertices so the node sits at its parent with an identity transform (its
    geometry is in the socket's frame: the game can re-parent it or drop it
    without undoing a hidden offset)."""
    mw = o.matrix_world.copy()
    o.parent = parent
    if bone:
        o.parent_type = "BONE"
        o.parent_bone = bone
    o.matrix_world = mw
    o.data.transform(o.matrix_basis)
    o.matrix_basis = Matrix.Identity(4)


def finish(mesh_name, jobs, sockets, rig):
    """Join the body's parts into one skinned mesh named by the contract; give
    variants and props their names, materials and parents."""
    body = [j for j in jobs if j.get("ao_group", "body") == "body"]
    for j in body:
        j["ob"].data.materials.clear()
        j["ob"].data.materials.append(j["material"])
    base = bl.join([j["ob"] for j in body], mesh_name)
    base.data.name = mesh_name
    for j in jobs:
        if j.get("ao_group", "body") == "body":
            continue
        o = j["ob"]
        o.data.materials.clear()
        o.data.materials.append(j["material"])
        o.data.name = o.name
        sk = j.get("skin", ("",))
        if sk[0] == "prop":
            attach(o, sockets[j.get("socket", "socket.gun")])
        elif sk[0] == "bone":
            attach(o, rig, sk[1])
        if j.get("extras"):
            for k, v in j["extras"].items():
                o[k] = v
    # parts baked on their own that belong to one variant (the ghillie's strips)
    for j in jobs:
        tgt = j.get("join_into")
        if tgt:
            t = bpy.data.objects[tgt]
            bl.join([t, j["ob"]], tgt)
            t.data.name = tgt
    return base


def person(mesh_name, jobs, rig, sockets, atlases, size=1024, proxy_res=0.0055, on_weighted=None):
    """Bake, weight and join one person. `atlases`: [(atlas name, predicate
    on a job)] - each job goes to the first atlas whose predicate accepts it."""
    t = time.time()
    body_ao = body_fields(jobs)
    assigned = set()
    for name, pred in atlases:
        group = [j for j in jobs if id(j) not in assigned and pred(j)]
        if not group:
            continue
        for j in group:
            assigned.add(id(j))
        mat = bake_atlas(group, size, name, ao_body=body_ao if not any(j.get("ao_group", "body") == "body" for j in group) else ())
        for j in group:
            j["material"] = mat
    left = [j["ob"].name for j in jobs if id(j) not in assigned]
    assert not left, f"jobs with no atlas: {left}"
    log(f"  {mesh_name}: atlases baked in {time.time() - t:.0f}s")
    t = time.time()
    skinned = [j for j in jobs if j.get("skin", ("transfer",))[0] not in ("prop", "bone")]
    proxy = _proxy(skinned, rig, proxy_res)
    skin_all(skinned, rig, proxy)
    bpy.data.objects.remove(proxy)
    log(f"  {mesh_name}: weighted in {time.time() - t:.0f}s")
    if on_weighted:
        on_weighted(rig)
    return finish(mesh_name, jobs, sockets, rig)


def _proxy(jobs, rig, res):
    """Bone heat on a closed proxy of the person (the union of the body's
    fields, in the rest pose). Only the humanoid's bones may deform here: any
    other bone (the bicycle's) is added after weighting."""
    aof = AB.WorldUnion([(j["ao_field"], j["origin"], j.get("M")) for j in jobs if j.get("ao_group", "body") == "body"])
    proxy = SKN.make_proxy(aof, (-0.8, -0.4, -0.02), (0.8, 0.4, 1.95), res)
    missing = SKN.heat_weights(proxy, rig)
    if missing:
        log("  bone heat left out", missing)
    return proxy
