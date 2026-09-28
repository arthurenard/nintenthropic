"""The stages of the Route 9 build, called from build_road.py."""

import math
import os
import time

import bpy

from .common import (EYE_Z, PITCH_DEG, VFOV_DEG, collection, tag, setup_gpu)
from . import world


class Context:
    def __init__(self, build, assets, blend, baked_blend, quick=False, review_dir=None, preview=None, only=None):
        self.build, self.assets, self.blend, self.baked_blend = build, assets, blend, baked_blend
        self.quick = quick
        self.review_dir = review_dir
        self.preview = preview
        self.only = only
        os.makedirs(review_dir, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "Route9"
    scene.unit_settings.system = 'METRIC'
    return scene


def player_camera(col):
    cd = bpy.data.cameras.new("camera.player")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(VFOV_DEG)
    cd.clip_start = 0.1
    cd.clip_end = 3000.0
    cam = bpy.data.objects.new("camera.player", cd)
    cam.location = (0.0, 0.0, EYE_Z)
    cam.rotation_euler = (math.radians(90.0 + PITCH_DEG), 0.0, 0.0)
    col.objects.link(cam)
    tag(cam, fov_deg=VFOV_DEG, eye_height=EYE_Z, pitch_deg=PITCH_DEG)
    return cam


def stage_scene(ctx):
    from . import mats, ground, build_all
    t = time.time()
    scene = reset_scene()
    setup_gpu(scene)
    root = collection("Route9")
    cols = {k: collection(k, root) for k in ("ground", "station", "roadside", "motel", "farm", "corn", "far",
                                             "trees", "contract", "lighting")}
    lib = mats.build_library()
    world.build_world(scene)
    world.build_moon(cols["lighting"])
    cam = player_camera(cols["contract"])
    scene.camera = cam
    build_all.build(lib, cols, ctx)
    nf = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f"scene built in {time.time() - t:.1f}s: {len(bpy.data.objects)} objects, {nf} faces")
    bpy.ops.wm.save_as_mainfile(filepath=ctx.blend, compress=True)


def open_blend(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    setup_gpu()


def render_settings(scene, w, h, samples, denoise=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 4
    scene.cycles.volume_bounces = 1
    scene.cycles.sample_clamp_indirect = 8.0
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = world.VIEW_TRANSFORM
    scene.view_settings.look = world.LOOK


def stage_sky(ctx):
    from . import sky
    open_blend(ctx.blend)
    sky.render_sky(ctx, bpy.context.scene)


def stage_bake(ctx):
    from . import bake
    bake.stage(ctx)


def stage_export(ctx):
    from . import export
    export.stage(ctx)


def stage_review(ctx):
    from . import review
    review.render_all(ctx)


def stage_poster(ctx):
    from . import poster
    poster.render(ctx)


def stage_glbreview(ctx):
    from . import glbcheck
    glbcheck.run(ctx)
