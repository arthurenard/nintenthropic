"""Rendering helpers shared by the bakes, the review and the poster.

A picture of the station is two renders put together: Cycles draws the
cupola, the station and whatever flies (film transparent, glass let
through), and the numpy planet renderer draws the planet, its air and the
stars for exactly the same camera behind it. Cycles is lit by the same
planet (an equirect environment rendered from the eye: earthshine) and by
a sun lamp, so the two agree. The sum goes through Blender's AgX.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import world, imgio

F32 = np.float32
VIEW_TRANSFORM = 'AgX'
LOOK = 'AgX - Medium High Contrast'
EXPOSURE = -3.2          # stops: sun irradiance 20 puts sunlit cloud near 1.0


def cycles(scene, w, h, samples, denoise=True, bounces=6):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = bounces
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 6
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.cycles.blur_glossy = 0.5
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = VIEW_TRANSFORM
    scene.view_settings.look = LOOK
    scene.view_settings.exposure = EXPOSURE


def world_env(scene, exr_path, strength=1.0, name="OrbitEnv"):
    """World lit by the planet: an equirect in this build's convention
    (u = atan2(y, x) / 2pi + 0.5, v = asin(z) / pi + 0.5 in Blender's
    image space)."""
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    at = nt.nodes.new('ShaderNodeMath')
    at.operation = 'ARCTAN2'
    nt.links.new(sep.outputs['Y'], at.inputs[0])
    nt.links.new(sep.outputs['X'], at.inputs[1])
    u = nt.nodes.new('ShaderNodeMath')
    u.operation = 'MULTIPLY_ADD'
    nt.links.new(at.outputs[0], u.inputs[0])
    u.inputs[1].default_value = 1.0 / (2 * math.pi)
    u.inputs[2].default_value = 0.5
    cl = nt.nodes.new('ShaderNodeMath')
    cl.operation = 'MINIMUM'
    cl.inputs[1].default_value = 1.0
    nt.links.new(sep.outputs['Z'], cl.inputs[0])
    asn = nt.nodes.new('ShaderNodeMath')
    asn.operation = 'ARCSINE'
    nt.links.new(cl.outputs[0], asn.inputs[0])
    v = nt.nodes.new('ShaderNodeMath')
    v.operation = 'MULTIPLY_ADD'
    nt.links.new(asn.outputs[0], v.inputs[0])
    v.inputs[1].default_value = 1.0 / math.pi
    v.inputs[2].default_value = 0.5
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(u.outputs[0], comb.inputs[0])
    nt.links.new(v.outputs[0], comb.inputs[1])
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(exr_path, check_existing=True)
    img.image.colorspace_settings.name = 'Linear Rec.709'
    img.interpolation = 'Linear'
    img.extension = 'EXTEND'
    nt.links.new(comb.outputs[0], img.inputs['Vector'])
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new(img.outputs['Color'], bg.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def sun_lamp(col, direction=None, strength=20.0, angle_deg=world.SUN_ANGLE_DEG, name="SunLamp"):
    """A sun lamp shining from `direction` (unit vector toward the sun)."""
    d = Vector(direction if direction is not None else world.sun_dir())
    data = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
    data.energy = strength
    data.color = world.SUN_COLOR
    data.angle = math.radians(angle_deg)
    ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, data)
    if ob.name not in col.objects:
        col.objects.link(ob)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def player_camera(col, name="camera.player"):
    cd = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(world.VFOV_DEG)
    cd.clip_start = 0.02
    cd.clip_end = 5000.0
    cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, cd)
    if cam.name not in col.objects:
        col.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = world.camera_euler()
    return cam


def camera_rays(cam, w, h):
    """World-space unit rays through each pixel of a Blender camera (top
    row first), matching Cycles' perspective projection and sensor fit."""
    cd = cam.data
    mw = cam.matrix_world
    R = np.array(mw.to_3x3().normalized())
    if cd.sensor_fit == 'VERTICAL' or (cd.sensor_fit == 'AUTO' and h > w):
        ty = math.tan(cd.angle_y / 2) if cd.sensor_fit == 'VERTICAL' else math.tan(cd.angle / 2)
        tx = ty * w / h
    else:
        tx = math.tan(cd.angle_x / 2) if cd.sensor_fit == 'HORIZONTAL' else math.tan(cd.angle / 2)
        ty = tx * h / w
    sx = cd.shift_x * 2 * (tx if w >= h else ty * w / h)
    sy = cd.shift_y * 2 * (tx if w >= h else ty * w / h)
    xs = ((np.arange(w) + 0.5) / w * 2 - 1) * tx + sx
    ys = (1 - (np.arange(h) + 0.5) / h * 2) * ty + sy
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X, Y, -np.ones_like(X)], -1).reshape(-1, 3) @ R.T
    return (d / np.linalg.norm(d, axis=1, keepdims=True)).astype(F32), np.array(mw.translation)


def read_exr_rgba(path):
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    chans = {}
    sub = 0
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        data = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
        for k, n in enumerate(spec.channelnames):
            chans[n] = data[..., k]
        sub += 1
    inp.close()

    def pick(names):
        for n in names:
            if n in chans:
                return chans[n]
        for k in chans:
            for n in names:
                if k.endswith('.' + n):
                    return chans[k]
        return None
    r, g, b, a = pick(['R', 'Combined.R']), pick(['G', 'Combined.G']), pick(['B', 'Combined.B']), pick(['A', 'Combined.A'])
    return np.stack([r, g, b], -1), (a if a is not None else np.ones_like(r))


def save_display(rgb, path, scene, quality=92):
    """Linear RGB (top row first) through the scene's view transform, as a
    render would be saved. PNG, JPEG or WEBP by extension."""
    h, w = rgb.shape[:2]
    img = bpy.data.images.new("__post", w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb[::-1]
    img.pixels.foreach_set(px.ravel())
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    ext = os.path.splitext(path)[1].lower()
    s.file_format = {'.png': 'PNG', '.jpg': 'JPEG', '.webp': 'WEBP'}[ext]
    s.color_mode = 'RGB'
    if ext in ('.jpg', '.webp'):
        s.quality = quality
    if ext == '.png':
        s.color_depth = '8'
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)


def render_fg(scene, path_exr):
    """Cycles render with a transparent film (glass lets the background
    through) into a float EXR; returns (rgb premultiplied, alpha)."""
    scene.render.film_transparent = True
    scene.cycles.film_transparent_glass = True
    s = scene.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'OPEN_EXR'
    s.color_mode = 'RGBA'
    s.color_depth = '32'
    scene.render.filepath = path_exr
    bpy.ops.render.render(write_still=True)
    return read_exr_rgba(path_exr)


def planet_background(ctx, cam, w, h, sky, maps=None, samples=48, exposure=1.0, rot=None):
    from . import pipeline
    maps = maps or pipeline.load_maps(ctx)
    D, _ = camera_rays(cam, w, h)
    L, _ = pipeline.render_planet_view(maps, D.astype(np.float64), sky, samples=samples, exposure=exposure, rot=rot)
    return L.reshape(h, w, 3)


def composite(fg, alpha, bg):
    return fg + (1.0 - alpha[..., None]) * bg
