"""Look at road.glb the way the game will: imported fresh, no lights but
what the game adds, the Standard view transform (the baked `lit` is already
display-referred), the recommended fog applied in linear like three.js's
FogExp2, and a flashlight spot from the eye.

    Blender -b --factory-startup -P art/night/build_road.py -- glbreview [--quick]
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import post, world
from .common import EYE, setup_gpu


def srgb_to_lin(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_to_lin(h):
    h = h.lstrip('#')
    return srgb_to_lin(np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]))


def without_custom_attributes(path):
    """A copy of the GLB whose primitives no longer list their custom
    (_ALBEDO, _SWAY...) attributes: Blender 5.1's importer trips over several
    generic Draco attributes on one primitive (three.js decodes them fine -
    art/night/tools/draco_check.cjs proves it). Only the JSON changes."""
    import json
    import struct
    import tempfile
    raw = open(path, "rb").read()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    js = json.loads(raw[20:20 + jlen])
    for m in js["meshes"]:
        for p in m["primitives"]:
            for k in [k for k in p["attributes"] if k.startswith("_")]:
                del p["attributes"][k]
                ext = p.get("extensions", {}).get("KHR_draco_mesh_compression")
                if ext:
                    ext["attributes"].pop(k, None)
    jb = json.dumps(js).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    rest = raw[20 + jlen:]
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(jb) + len(rest)) + struct.pack("<I4s", len(jb), b"JSON") + jb + rest
    tmp = os.path.join(tempfile.gettempdir(), "road_check.glb")
    open(tmp, "wb").write(out)
    return tmp


def import_road(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=without_custom_attributes(path))
    sc = bpy.context.scene
    setup_gpu(sc)
    w = bpy.data.worlds.new("black")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    sc.world = w
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    # the imported corn material multiplies COLOR_0 into an unlit base: keep
    # it (emission) and hide the shadow catcher and the moon target
    for ob in sc.objects:
        if ob.name in ('ground.shadow', 'moon.disc'):
            ob.hide_render = True
    return sc


SODIUM_GAME = (1.0, 0.56, 0.23)


def game_materials(sc, folder):
    """Rebuild every baked material the way the game's shader reads it
    (src/games/night/world/shading.ts): the unlit base map is `lit`; the
    albedo and flicker files its extras name, beside road.glb, are loaded;
    colour = lit - albedo * SODIUM * flicker_scale * street * (1 - on)
    + albedo lit by the scene's lights (the flashlight). `on` is the value
    node "street_on" in each (set_street)."""
    scale = float(sc.get("flicker_scale", 1.0))
    n_done = 0
    for m in list(bpy.data.materials):
        alb_name = m.get("albedo")
        if not alb_name or not m.use_nodes:
            continue
        nt = m.node_tree
        lit_img = next((n.image for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image), None)
        if lit_img is None:
            continue
        nt.nodes.clear()
        N, Lk = nt.nodes.new, nt.links.new
        out = N('ShaderNodeOutputMaterial')
        uv = N('ShaderNodeUVMap')
        tl = N('ShaderNodeTexImage')
        tl.image = lit_img
        ta = N('ShaderNodeTexImage')
        ta.image = bpy.data.images.load(os.path.join(folder, alb_name), check_existing=True)
        ta.image.colorspace_settings.name = 'sRGB'
        for t in (tl, ta):
            Lk(uv.outputs['UV'], t.inputs['Vector'])
        emit_col = tl.outputs['Color']
        fl_name = m.get("flicker")
        if fl_name:
            tf = N('ShaderNodeTexImage')
            tf.image = bpy.data.images.load(os.path.join(folder, fl_name), check_existing=True)
            tf.image.colorspace_settings.name = 'Non-Color'
            Lk(uv.outputs['UV'], tf.inputs['Vector'])
            sep = N('ShaderNodeSeparateColor')
            Lk(tf.outputs['Color'], sep.inputs['Color'])
            on = N('ShaderNodeValue')
            on.name = on.label = "street_on"
            on.outputs[0].default_value = 1.0
            off = N('ShaderNodeMath')
            off.operation = 'SUBTRACT'
            off.inputs[0].default_value = 1.0
            Lk(on.outputs[0], off.inputs[1])
            k = N('ShaderNodeMath')
            k.operation = 'MULTIPLY'
            Lk(sep.outputs['Red'], k.inputs[0])
            Lk(off.outputs[0], k.inputs[1])
            k2 = N('ShaderNodeMath')
            k2.operation = 'MULTIPLY'
            Lk(k.outputs[0], k2.inputs[0])
            k2.inputs[1].default_value = scale
            tint = N('ShaderNodeVectorMath')
            tint.operation = 'MULTIPLY'
            Lk(ta.outputs['Color'], tint.inputs[0])
            tint.inputs[1].default_value = SODIUM_GAME
            sub = N('ShaderNodeVectorMath')
            sub.operation = 'SCALE'
            Lk(tint.outputs[0], sub.inputs[0])
            Lk(k2.outputs[0], sub.inputs['Scale'])
            dif = N('ShaderNodeVectorMath')
            dif.operation = 'SUBTRACT'
            Lk(tl.outputs['Color'], dif.inputs[0])
            Lk(sub.outputs[0], dif.inputs[1])
            mx = N('ShaderNodeVectorMath')
            mx.operation = 'MAXIMUM'
            Lk(dif.outputs[0], mx.inputs[0])
            mx.inputs[1].default_value = (0.0, 0.0, 0.0)
            emit_col = mx.outputs[0]
        em = N('ShaderNodeEmission')
        Lk(emit_col, em.inputs['Color'])
        em.inputs['Strength'].default_value = 1.0
        df = N('ShaderNodeBsdfDiffuse')
        Lk(ta.outputs['Color'], df.inputs['Color'])
        add = N('ShaderNodeAddShader')
        Lk(em.outputs[0], add.inputs[0])
        Lk(df.outputs[0], add.inputs[1])
        Lk(add.outputs[0], out.inputs['Surface'])
        n_done += 1
    print("game materials:", n_done, "flicker_scale", scale)


def set_street(on):
    for m in bpy.data.materials:
        if m.use_nodes:
            n = m.node_tree.nodes.get("street_on")
            if n is not None:
                n.outputs[0].default_value = on


def flashlight(sc, target, power=260.0, cone=24.0):
    ld = bpy.data.lights.new("beam", 'SPOT')
    ld.energy = power
    ld.color = (1.0, 0.93, 0.8)
    ld.spot_size = math.radians(cone)
    ld.spot_blend = 0.45
    ld.shadow_soft_size = 0.02
    lo = bpy.data.objects.new("beam", ld)
    lo.location = EYE + Vector((0.12, 0.3, -0.25))
    lo.rotation_euler = (Vector(target) - lo.location).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(lo)
    return lo


def render(sc, path, w, h, samples, fog_hex, density, beam=None):
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    vl = sc.view_layers[0]
    vl.use_pass_position = True
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    exr = os.path.splitext(path)[0] + ".exr"
    sc.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    L = post.read_exr_layers(exr)
    rgb = L['rgb']
    pos = L['pos']
    valid = np.linalg.norm(pos, axis=-1) > 1e-3
    cam = sc.camera
    e = np.array(cam.matrix_world.translation, np.float32)
    f = -np.array(cam.matrix_world.to_3x3().col[2], np.float32)
    # glTF import is Y-up converted back to Blender Z-up, so positions are Blender's
    if fog_hex:
        T = post.transmittance(pos, e, f, density)[..., None]
        fog = hex_to_lin(fog_hex)
        rgb = np.where(valid[..., None], rgb * T + fog * (1 - T), rgb)
    # background (the sky, drawn by the game): a flat fog tone here
    if fog_hex:
        rgb = np.where(valid[..., None], rgb, hex_to_lin(fog_hex) * 0.9)
    post.save_display(rgb, path, sc)
    os.remove(exr)
    print("wrote", path, flush=True)


def run(ctx):
    path = os.path.join(ctx.assets, "road.glb")
    sc = import_road(path)
    game_materials(sc, os.path.dirname(path))
    cam = next(o for o in sc.objects if o.type == 'CAMERA')
    sc.camera = cam
    fog_hex = sc.get("fog_color", "#28323e")
    density = float(sc.get("fog_density", post.FOG_DENSITY))
    w, h, s = (960, 600, 16) if ctx.quick else (1600, 1000, 64)
    out = ctx.review_dir
    render(sc, os.path.join(out, "glb_lit_nofog.png"), w, h, s, None, 0)
    render(sc, os.path.join(out, "glb_lit_fog.png"), w, h, s, fog_hex, density)
    # the streetlight dead (the flicker's low): its share of the bake gone
    set_street(0.0)
    render(sc, os.path.join(out, "glb_street_off.png"), w, h, s, fog_hex, density)
    set_street(1.0)
    flashlight(sc, (0.4, 14.0, 0.6))
    render(sc, os.path.join(out, "glb_beam_road.png"), w, h, s, fog_hex, density)
    b = bpy.data.objects["beam"]
    b.rotation_euler = (Vector((-6.0, 16.0, 1.2)) - b.location).to_track_quat('-Z', 'Y').to_euler()
    render(sc, os.path.join(out, "glb_beam_corn.png"), w, h, s, fog_hex, density)
