"""Review renders: the player's view through the cupola (Cycles foreground
over the planet), close-ups of the frame and the station, the planet alone
at several sun angles, and every exported asset.

Run: build_orbit.py -- review [--preview NAME] [--quick]
"""

import math
import os
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import pipeline, render, world, bl

log = pipeline.log


def _out(ctx, name):
    return os.path.join(ctx.review_dir, name + ".png")


def render_view(ctx, name, cam, w, h, samples, sky=None, maps=None, exposure=0.0, planet=True):
    """Foreground (Cycles, transparent) over the planet, through AgX."""
    sc = bpy.context.scene
    render.cycles(sc, w, h, samples)
    sc.view_settings.exposure = render.EXPOSURE + exposure
    sc.camera = cam
    t = time.time()
    exr = os.path.join(ctx.build, f"__fg_{name}.exr")
    fg, a = render.render_fg(sc, exr)
    t1 = time.time()
    if planet:
        bg = render.planet_background(ctx, cam, w, h, sky or pipeline.Sky(), maps=maps, samples=32 if ctx.quick else 64)
        rgb = render.composite(fg, a, bg)
    else:
        rgb = fg
    path = _out(ctx, name)
    render.save_display(rgb, path, sc)
    os.remove(exr)
    log(f"  {name}: {w}x{h} cycles {t1 - t:.1f}s, planet {time.time() - t1:.1f}s -> {path}")
    return rgb


def player(ctx, maps):
    cam = bpy.data.objects['camera.player']
    q = ctx.quick
    views = [('player_1600x900', 1600, 900)] if not q else [('player_quick', 1440, 810)]
    if not q:
        views.append(('player_1920x800', 1920, 800))
    for name, w, h in views:
        render_view(ctx, name, cam, w, h, 24 if q else 256, maps=maps)


def free_camera(name, loc, target, lens=35.0, up=(0, 0, 1)):
    cd = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36.0
    cd.clip_start = 0.02
    cd.clip_end = 5000.0
    cam = bpy.data.objects.get(name) or bpy.data.objects.new(name, cd)
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam


# name: (location, target, lens) - views of the station from outside
OVERVIEWS = {
    'overview': ((-30.0, -34.0, 26.0), (0.0, 16.0, -2.0), 22.0),
    'overview_front': ((6.0, 70.0, -8.0), (0.0, 8.0, 0.0), 24.0),
    'cupola_outside': ((1.8, 4.0, 0.6), (0.0, 1.0, -0.4), 24.0),
}


def overviews(ctx, maps):
    q = ctx.quick
    for name, (loc, tgt, lens) in OVERVIEWS.items():
        if ctx.preview not in (None, 'overview', name):
            continue
        cam = free_camera("review_cam", loc, tgt, lens)
        render_view(ctx, name, cam, 1280 if not q else 960, 720 if not q else 540, 16 if q else 96, maps=maps, planet=False)


def render_all(ctx):
    pipeline.open_blend(pipeline.scene_blend(ctx))
    maps = pipeline.load_maps(ctx)
    pv = ctx.preview
    if pv in (None, 'player'):
        player(ctx, maps)
    if pv is None or pv.startswith('overview') or pv in OVERVIEWS:
        overviews(ctx, maps)
