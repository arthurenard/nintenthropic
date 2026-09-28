"""sky.webp: the night sky as the game's background and the characters'
environment light - the dome, the moon behind its veil of cloud with its
corona, stars through the breaks, the dark land below the horizon.

Rendered from the eye with the world shader alone (the road and everything
on it hidden), equirectangular in the Three.js convention (u = 0.25 looks up
the road, u = 0.5 is +X, the top row is straight up), graded and put
through AgX like the baked `lit`, so the fogged road and the sky meet.

The horizon's colour straight up the road is measured on the way and saved
(build/sky_horizon.json): it is the fog colour the reviews use and road.glb
recommends.
"""

import json
import math
import os

import bpy
import numpy as np

from . import world, post, pipeline


def render_sky(ctx, scene, w=4096, h=2048, samples=64):
    if ctx.quick:
        w, h, samples = 1024, 512, 16
    world.sky_tree(scene.world.node_tree, for_sky_image=True)
    for ob in scene.objects:
        if ob.type in ('MESH', 'CURVE', 'LIGHT'):
            ob.hide_render = True
    cd = bpy.data.cameras.new("sky_cam")
    cd.type = 'PANO'
    try:
        cd.panorama_type = 'EQUIRECTANGULAR'
    except AttributeError:
        cd.cycles.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new("sky_cam", cd)
    cam.location = (0.0, 0.0, 1.7)
    cam.rotation_euler = (math.radians(90), 0.0, math.radians(-90))
    scene.collection.objects.link(cam)
    scene.camera = cam
    import OpenImageIO as oiio

    def shot(path, ww, hh, spp):
        pipeline.render_settings(scene, ww, hh, spp, denoise=False)
        s = scene.render.image_settings
        if hasattr(s, 'media_type'):
            s.media_type = 'IMAGE'
        s.file_format = 'OPEN_EXR'
        s.color_depth = '32'
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        inp = oiio.ImageInput.open(path)
        sp = inp.spec()
        a = np.asarray(inp.read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(sp.height, sp.width, 3)
        inp.close()
        return a
    probe = shot(os.path.join(ctx.build, "sky_probe.exr"), 720, 360, 16)
    H_, W_ = probe.shape[:2]
    r0 = int((0.5 - 2.5 / 180) * H_)
    r1 = int((0.5 - 0.5 / 180) * H_)
    c0 = int((0.25 - 20 / 360) * W_)
    c1 = int((0.25 + 25 / 360) * W_)
    horizon = probe[r0:r1 + 1, c0:c1].reshape(-1, 3).mean(0)
    json.dump({"horizon": [float(v) for v in horizon]}, open(os.path.join(ctx.build, "sky_horizon.json"), "w"))
    print("horizon colour", horizon)
    arr = shot(os.path.join(ctx.build, "sky.exr"), w, h, samples)
    out = os.path.join(ctx.assets, "sky.webp")
    post.save_display(world.grade(arr), out, scene, fmt='WEBP', quality=86)
    print("sky written", out, os.path.getsize(out) // 1024, "KB")
    return arr
