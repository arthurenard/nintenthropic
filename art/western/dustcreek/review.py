"""Review renders: the player's view at two aspect ratios, close-ups of
every building and secret, and the unlit (baked-texture-only) check."""

import math
import os

import bpy
from mathutils import Vector

from . import pipeline, core

# name: (location, look_at, lens_mm or None for player fov, resolution)
CLOSEUPS = {
    'store': ((-3.0, 2.0, 1.8), (-10.0, 11.0, 3.2), 28),
    'saloon': ((-2.5, 14.5, 1.8), (-10.0, 24.5, 4.2), 26),
    'barber_livery': ((-2.0, 30.0, 1.8), (-10.0, 42.0, 3.5), 26),
    'bank': ((3.0, 2.0, 1.8), (10.0, 10.5, 3.2), 28),
    'sheriff': ((3.5, 14.5, 1.7), (10.0, 20.5, 2.4), 28),
    'hotel': ((2.5, 22.0, 1.8), (10.0, 32.0, 4.5), 26),
    'undertaker': ((3.0, 36.0, 1.7), (10.0, 43.0, 2.4), 28),
    'church': ((0.0, 40.0, 1.8), (0.0, 64.0, 8.0), 35),
    'bell': ((0.0, 55.0, 9.0), (0.0, 63.5, 13.2), 70),
    'poster': ((6.5, 17.5, 1.7), (10.0, 20.0, 1.7), 50),
    'piano': ((-6.5, 17.0, 1.7), (-11.5, 20.5, 1.3), 45),
    'water_tower': ((6.0, 28.0, 3.0), (20.0, 46.0, 12.0), 40),
    'wagon': ((-1.0, 20.0, 1.6), (-4.5, 26.0, 0.6), 35),
}


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(scene, path, w, h, samples, fog=True):
    from . import post
    pipeline.render_settings(scene, w, h, samples)
    post.render_with_fog(scene, path, fog=fog)
    print("wrote", path, flush=True)


def render_all(ctx):
    scene = bpy.context.scene
    cam = bpy.data.objects["camera.player"]
    scene.camera = cam
    s = 24 if ctx.quick else 160
    out = ctx.review_dir
    views = [('player_1600x1000', 1600, 1000), ('player_1920x800', 1920, 800)]
    if ctx.quick:
        views = [('player_1600x1000', 800, 500)]
    for name, w, h in views:
        if ctx.preview and ctx.preview != name and ctx.preview != 'player':
            continue
        render(scene, os.path.join(out, f"{name}.png"), w, h, s)
    if ctx.preview == 'player':
        return
    # close-ups with a free camera
    cd = bpy.data.cameras.new("review_cam")
    rc = bpy.data.objects.new("review_cam", cd)
    scene.collection.objects.link(rc)
    scene.camera = rc
    for name, (loc, tgt, lens) in CLOSEUPS.items():
        if ctx.preview and ctx.preview != name:
            continue
        rc.location = loc
        look_at(rc, tgt)
        cd.lens = lens
        cd.sensor_fit = 'HORIZONTAL'
        cd.sensor_width = 36
        render(scene, os.path.join(out, f"close_{name}.png"), 1200 if not ctx.quick else 600,
               800 if not ctx.quick else 400, s)
    scene.camera = cam
    bpy.data.objects.remove(rc)
