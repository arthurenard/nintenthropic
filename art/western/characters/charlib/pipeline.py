"""From a character spec to a finished .glb.

  parts (jobs) -> one atlas -> armature + weights -> joined body, dressed
  variants, props on socket.gun -> clips -> glTF (Draco, WebP)

Naming follows the contract and what the game dresses with: the body is
`char.<name>`, variants `var.hat.*`, `var.coat.*`, `var.bandana.*`,
`var.vest`, `var.armour`, props `gun.revolver`, `gun.rifle`,
`prop.dynamite` under the empty `socket.gun`. No mesh or node shares a
bone's name (the glTF loader would confuse them).
"""
import os
import time
import numpy as np
import bpy
from mathutils import Matrix
from . import bl, abake as AB, materials as MT, skeleton as SK, skin as SKN, anim as A, character as C
from . import outfits as OF, garments as G, rings as R, body as BD, head as HD, hands as HN, sdf as S
from .skeleton import BONE_NAMES


def log(*a):
    print("[chars]", *a, flush=True)


# ------------------------------------------------------------------ variant builders (jobs)

def hat_job(kind, name, coll=None, tris=520):
    f, band_h, col, band_col, mat = OF.hat_field(kind)
    M, o = OF.hat_frame(6.0 if kind != "top" else 3.0)
    ob = C.decimated(name, f, (-0.26, -0.28, -0.10), (0.26, 0.28, 0.21 if kind == "top" else 0.15), 0.0022, tris, coll, M=M, o=o, symmetry=False)
    return dict(ob=ob, field=f, paint=OF.hat_paint(kind), origin=o, M=M, weight=0.55, ao_field=f, ao_group=name, smart_uv=True,
                skin=("rigid", "head"))


def bandana_job(p, color, name, coll=None, tris=420, pattern=True):
    f = OF.bandana_field(p)
    ob = C.decimated(name, f, (-0.11, -0.16, -0.22), (0.11, 0.14, 0.03), 0.0018, tris, coll, M=np.eye(3), o=HD.HEAD_ORIGIN, symmetry=True)
    return dict(ob=ob, field=f, paint=OF.bandana_paint(color, pattern), origin=HD.HEAD_ORIGIN, weight=0.7, ao_field=f, ao_group=name,
                smart_uv=True, skin=("transfer",))


def armour_job(name="var.armour", coll=None):
    f = OF.armour_field()
    ob = C.decimated(name, f, (-0.2, -0.16, 1.1), (0.2, 0.05, 1.5), 0.0018, 360, coll, symmetry=True)
    return dict(ob=ob, field=f, paint=OF.armour_paint, origin=np.zeros(3), weight=0.6, ao_field=f, ao_group=name, smart_uv=True,
                skin=("rigid", "chest"))


def vest_job(bp, color, name="var.vest", coll=None, seed=0):
    from .body import shirt
    f = S.Offset(shirt(bp), 0.010)
    rm = G.build_vest(bp, f)
    ob = R.to_blender(rm, name, coll)

    def paint(P):
        c, r, m = C.PT.fabric(P, color, "wool", dust_amt=0.15, fade=0.12, seed=seed + 40)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        front = y < -0.06
        bz = (z - 1.05) % 0.06
        btn = front & (np.abs(x) < 0.006) & (np.abs(bz - 0.03) < 0.006) & (z < 1.30)
        c[btn] = C.srgb(0.55, 0.45, 0.25)
        m[btn] = 1.0
        r[btn] = 0.35
        # a watch chain across the front
        ch = front & (np.abs(z - (1.12 - 2.5 * (x - 0.05) ** 2)) < 0.0025) & (np.abs(x) < 0.10)
        c[ch] = C.srgb(0.62, 0.50, 0.25)
        m[ch] = 1.0
        return c, r, m
    return dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=f, ao_group=name, skin=("transfer",))


def coat_job(bp, color, name, hem_z=0.36, flare=1.0, coll=None, seed=0, kind="canvas"):
    f = G.coat_field(bp, hem_z, flare)
    rm = G.build_coat(bp, f, hem_z=hem_z, flare=flare, vent=hem_z < 0.7)
    ob = R.to_blender(rm, name, coll)

    def folds(P):
        z = P[:, 2]
        th = np.arctan2(P[:, 0], -P[:, 1])
        sk = C.smoothstep(0.95, 0.85, z)
        d = 0.004 * sk * np.sin(th * 7 + 3 * C.value_noise(P, 8, seed=seed + 1)) ** 2
        return (-d).astype(np.float32)
    ff = S.Displace(f, folds, 0.005)

    def paint(P):
        c, r, m = C.PT.fabric(P, color, kind, dust_amt=0.5, fade=0.25, seed=seed + 50, grime=0.2)
        # darker, greasy where the hands go: pockets and front edges
        edge = np.exp(-((P[:, 0] / 0.05) ** 2)) * (P[:, 1] < -0.05)
        c *= (1 - 0.15 * edge)[:, None]
        return c, r, m
    return dict(ob=ob, field=ff, paint=paint, origin=np.zeros(3), weight=0.55, ao_field=f, ao_group=name, skin=("coat", hem_z))


def prop_job(kind, name, socket_M, coll=None):
    field, paint, box, tris = {
        "revolver": (OF.revolver_field(), OF.revolver_paint, ((-0.03, -0.06, -0.08), (0.03, 0.19, 0.07)), 420),
        "rifle": (OF.rifle_field(), OF.rifle_paint, ((-0.04, -0.36, -0.12), (0.04, 0.62, 0.08)), 520),
        "dynamite": (OF.dynamite_field(), OF.dynamite_paint, ((-0.05, -0.05, -0.10), (0.05, 0.05, 0.20)), 220),
    }[kind]
    Msock = np.array(socket_M, float)
    M, o = Msock[:3, :3], Msock[:3, 3]
    ob = C.decimated(name, field, box[0], box[1], 0.0011 if kind != "rifle" else 0.0016, tris, coll, M=M, o=o)
    return dict(ob=ob, field=field, paint=paint, origin=o, M=M, weight=0.7 if kind == "revolver" else 0.5, ao_field=field,
                ao_group=name, ao_self_only=True, smart_uv=True, skin=("prop",))


# ------------------------------------------------------------------ skinning

def coat_override(hem_z):
    """A coat's skirt swings with the thighs but must not be torn apart by
    them: below the hips blend toward the pelvis, front panels follow their
    own thigh a little, the back hangs from the hips."""
    ih = BONE_NAMES.index("hips")
    iL, iR = BONE_NAMES.index("thigh.L"), BONE_NAMES.index("thigh.R")
    isL, isR = BONE_NAMES.index("shin.L"), BONE_NAMES.index("shin.R")

    def f(ob, V, W):
        z = V[:, 2]
        below = np.clip((0.97 - z) / 0.25, 0, 1)
        side = np.clip(V[:, 0] / 0.16, -1, 1)
        front = np.clip(-V[:, 1] / 0.14, 0, 1)
        leg = np.clip((0.95 - z) / 0.45, 0, 1) * (0.25 + 0.3 * front)
        Wn = np.zeros_like(W)
        Wn[:, iL] = leg * np.clip(0.5 + 0.5 * side, 0, 1)
        Wn[:, iR] = leg * np.clip(0.5 - 0.5 * side, 0, 1)
        Wn[:, ih] = 1.0 - Wn[:, iL] - Wn[:, iR]
        W = W.copy()
        W[:, isL] = 0
        W[:, isR] = 0
        return W * (1 - below[:, None]) + Wn * below[:, None]
    return f


# ------------------------------------------------------------------ assemble and export

def proxy_weights(jobs, rig, coll=None, proxy_res=0.008):
    """Bone heat on a closed proxy of one person (the union of their body parts)."""
    aof = AB.WorldUnion([(j["ao_field"], j["origin"], j.get("M")) for j in jobs if j.get("ao_group", "body") == "body"])
    proxy = SKN.make_proxy(aof, (-0.8, -0.4, -0.02), (0.8, 0.4, 1.85), proxy_res, coll)
    missing = SKN.heat_weights(proxy, rig)
    if missing:
        log("  bone heat left out", missing)
    return proxy


def skin_all(jobs, rig, proxy):
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
            SKN.transfer(proxy, [j["ob"]], rig, override=coat_override(sk[1]))


def finish(mesh_name, jobs, socket, material):
    """Join a person's body parts into one skinned mesh named by the contract;
    give variants and props their names, material and parents."""
    body = [j["ob"] for j in jobs if j.get("ao_group", "body") == "body"]
    for o in body:
        o.data.materials.clear()
        o.data.materials.append(material)
    base = bl.join(body, mesh_name)
    base.data.name = mesh_name
    for j in jobs:
        if j.get("ao_group", "body") == "body":
            continue
        o = j["ob"]
        o.data.materials.clear()
        o.data.materials.append(material)
        o.data.name = o.name
        if j.get("skin", ("",))[0] == "prop":
            mw = o.matrix_world.copy()
            o.parent = socket
            o.matrix_world = mw
    return base


def person(mesh_name, jobs, rig, socket, atlas_name, size=1024, keep_proxy=False):
    """Bake one person's atlas, weight them, and join their body."""
    t = time.time()
    imgs = AB.bake_character(jobs, size, atlas_name, log=log)
    imgs.pop("_atlas", None)
    mat = MT.final_material(atlas_name, imgs["albedo"], imgs["normal"], imgs["orm"])
    log(f"  {atlas_name}: atlas baked in {time.time() - t:.0f}s")
    proxy = proxy_weights(jobs, rig)
    skin_all(jobs, rig, proxy)
    if not keep_proxy:
        bpy.data.objects.remove(proxy)
    return finish(mesh_name, jobs, socket, mat)


def bake_clips(rig, clips, log=log):
    # clips are keyed at 30 fps; the exporter samples at the scene rate
    bpy.context.scene.render.fps = A.FPS
    bpy.context.scene.render.fps_base = 1.0
    R_ = A.Rig()
    acts = []
    for name, maker in clips.items():
        t = time.time()
        clip = maker()
        act = A.bake_clip(R_, clip, rig)
        acts.append(act)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    log(f"  baked {len(acts)} clips")
    return acts


def export(path, extras=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if extras:
        for k, v in extras.items():
            bpy.context.scene[k] = v
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False, export_yup=True,
        export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="WEBP", export_image_quality=82,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_draco_generic_quantization=12,
        export_animations=True, export_animation_mode="ACTIONS", export_frame_step=1,
        export_force_sampling=True, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False,
        export_rest_position_armature=True, export_extras=True, export_cameras=False, export_lights=False,
        export_morph=False)
    return os.path.getsize(path)
