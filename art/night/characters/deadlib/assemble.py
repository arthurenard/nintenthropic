"""From parts to a finished character file: one atlas for everything in the
file, bone heat per person, joined meshes named by the contract, clips,
glTF with tangents.

The one difference from High Noon's export: tangents go into the file.
three.js shades a normal map with screen-space derivatives unless the mesh
brings its own tangents; the baked normals are in Blender's MikkTSpace, so
shipping those tangents is what makes the sculpted faces light correctly in
the game (without them the seams and flats High Noon's faces showed come
back).
"""

import os
import time

import bpy
import numpy as np
from mathutils import Matrix

from .common import AB, MT, SKN, bl, log


def bake_atlas(jobs, size, name):
    t = time.time()
    imgs = AB.bake_character(jobs, size, name, log=log)
    imgs.pop("_atlas", None)
    mat = MT.final_material(name, imgs["albedo"], imgs["normal"], imgs["orm"])
    log(f"  {name}: {size}x{size} atlas baked in {time.time() - t:.0f}s")
    return mat


def proxy_for(fields, lo=(-0.8, -0.5, -0.02), hi=(0.8, 0.5, 1.9), res=0.0055):
    aof = AB.WorldUnion(fields)
    proxy = SKN.make_proxy(aof, lo, hi, res)
    return proxy


def skin(jobs, rig, proxy_fields, keep_proxy=False, lo=(-0.8, -0.5, -0.02), hi=(0.8, 0.5, 1.9)):
    """Bone heat on a closed proxy of this person, transferred to every part;
    rigid parts (hats, hair, masks) take one bone."""
    from charlib.pipeline import coat_override
    proxy = proxy_for(proxy_fields, lo, hi)
    missing = SKN.heat_weights(proxy, rig)
    if missing:
        log("  bone heat left out", missing)
    plain = [j["ob"] for j in jobs if j.get("skin", ("transfer",))[0] == "transfer"]
    if plain:
        SKN.transfer(proxy, plain, rig)
    for j in jobs:
        sk = j.get("skin", ("transfer",))
        if sk[0] == "rigid":
            SKN.rigid(j["ob"], rig, sk[1])
        elif sk[0] == "coat":
            SKN.transfer(proxy, [j["ob"]], rig, override=coat_override(sk[1]))
        elif sk[0] == "custom":
            SKN.transfer(proxy, [j["ob"]], rig, override=sk[1])
    if not keep_proxy:
        bpy.data.objects.remove(proxy)


def join(objs, name, material):
    objs = [o for o in objs if o is not None]
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(material)
    ob = bl.join(objs, name) if len(objs) > 1 else objs[0]
    ob.name = name
    ob.data.name = name
    return ob


def rigid_object(ob, rig, bone):
    SKN.rigid(ob, rig, bone)


def socket(rig, name, bone, matrix):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.08
    bpy.context.scene.collection.objects.link(e)
    e.parent = rig
    e.parent_type = "BONE"
    e.parent_bone = bone
    e.matrix_world = Matrix(np.asarray(matrix).tolist())
    return e


def attach_prop(ob, sock):
    """Parent a prop to a socket with an identity transform (its geometry
    baked into the socket's frame), as High Noon's guns are."""
    mw = ob.matrix_world.copy()
    ob.parent = sock
    ob.matrix_world = mw
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)


def bake_clips(rig, clips, rigdef=None):
    from .common import A
    bpy.context.scene.render.fps = A.FPS
    bpy.context.scene.render.fps_base = 1.0
    R_ = rigdef or A.Rig()
    n = 0
    for name, maker in clips.items():
        A.bake_clip(R_, maker(), rig)
        n += 1
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    log(f"  baked {n} clips")


def export(path, extras=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.data.validate():
            log(f"  repaired topology of {o.name}")
    if extras:
        for k, v in extras.items():
            bpy.context.scene[k] = v
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False, export_yup=True,
        export_apply=False, export_texcoords=True, export_normals=True, export_tangents=True,
        export_materials="EXPORT", export_image_format="WEBP", export_image_quality=84,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_draco_generic_quantization=12,
        export_animations=True, export_animation_mode="ACTIONS", export_frame_step=1,
        export_force_sampling=True, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
        export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False,
        export_rest_position_armature=True, export_extras=True, export_cameras=False, export_lights=False,
        export_morph=True, export_morph_normal=True, export_morph_tangent=False)
    return os.path.getsize(path)
