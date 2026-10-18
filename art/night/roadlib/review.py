"""Review renders of Route 9: the player's view as the aim check frames it
(the scene's own wide lens) and as play frames it (closer, from the same
eye), with and without the game's fog; close-ups of every landmark and
secret; and the flashlight's view of the road.

Cycles renders of the full scene (not the bake): they are the reference the
baked glb must match. `bake_check` renders the baked atlases alone.
"""

import math
import os

import bpy
from mathutils import Vector

from . import pipeline, post
from .common import EYE

# name: (location, look_at, lens mm)
CLOSEUPS = {
    'barricade': ((0.6, -0.4, 1.9), (0.0, 4.0, 0.6), 24),
    'pump': ((0.2, 1.0, 1.6), (1.8, 3.0, 1.2), 30),
    'pickup': ((-1.5, 0.8, 1.7), (-5.8, 5.0, 1.0), 28),
    'station': ((1.0, 2.0, 1.7), (7.0, 10.0, 2.0), 26),
    'radio': ((3.5, 7.5, 1.6), (8.5, 13.3, 1.3), 40),
    'sign': ((1.0, 6.0, 2.5), (4.4, 15.6, 5.6), 40),
    'crossroads': ((0.0, 8.0, 2.0), (4.0, 21.0, 3.0), 30),
    'booth': ((3.0, 14.0, 1.7), (6.7, 19.3, 1.4), 35),
    'motel': ((4.0, 24.0, 1.8), (18.0, 40.0, 2.0), 30),
    'bus': ((0.0, 30.0, 1.7), (0.0, 45.0, 1.6), 35),
    'farm': ((-4.0, 20.0, 1.8), (-28.0, 58.0, 5.0), 35),
    'corn': ((-5.5, 10.0, 1.7), (-12.0, 20.0, 1.5), 28),
    'scarecrow': ((-5.0, 26.0, 2.0), (-11.9, 33.4, 2.8), 45),
    'far': ((0.0, 0.0, 1.7), (0.0, 120.0, 4.0), 90),
}


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(scene, path, w, h, samples, fog=True):
    pipeline.render_settings(scene, w, h, samples)
    cam = scene.camera.data
    old = cam.clip_end
    cam.clip_end = 1.0e5
    post.render(scene, path, fog=fog)
    cam.clip_end = old
    print("wrote", path, flush=True)


def play_camera(scene, fov=30.0, pitch_up=4.0):
    """The play framing: the same eye, a tighter lens pitched up a little
    (as the game fits it to where the fight happens)."""
    cd = bpy.data.cameras.new("review_play")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov)
    cd.clip_start = 0.1
    cam = bpy.data.objects.new("review_play", cd)
    cam.location = (0.0, 0.0, EYE.z)
    cam.rotation_euler = (math.radians(90.0 - 1.0 + pitch_up), 0.0, 0.0)
    scene.collection.objects.link(cam)
    return cam


def render_all(ctx):
    pipeline.open_blend(ctx.blend)
    scene = bpy.context.scene
    out = ctx.review_dir
    s = 32 if ctx.quick else 256
    cam = bpy.data.objects["camera.player"]
    scene.camera = cam
    want = (lambda n: ctx.preview is None or ctx.preview == n or (ctx.preview == 'player' and n.startswith('player')))
    views = [('player_check_1600x1000', 1600, 1000, True), ('player_check_1920x800', 1920, 800, True),
             ('player_check_nofog', 1600, 1000, False)]
    if ctx.quick:
        views = [('player_check_1600x1000', 960, 600, True), ('player_check_nofog', 960, 600, False)]
    for name, w, h, fog in views:
        if want(name):
            render(scene, os.path.join(out, f"{name}.png"), w, h, s, fog=fog)
    if want('player_play'):
        pc = play_camera(scene)
        scene.camera = pc
        render(scene, os.path.join(out, "player_play_1600x1000.png"), 1600 if not ctx.quick else 960,
               1000 if not ctx.quick else 600, s)
        scene.camera = cam
    if ctx.preview and ctx.preview.startswith('player'):
        return
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
               800 if not ctx.quick else 400, s, fog=False)
