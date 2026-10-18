"""The stages of the Dust Creek build, called from build_town.py."""

import math
import os
import time

import bpy

from . import core, materials, lighting, signs

EYE = 1.7
PITCH_DEG = -1.0
VFOV_DEG = 45.0


class Context:
    def __init__(self, build, assets, blend, baked_blend, quick=False, review_dir=None, preview=None):
        self.build, self.assets, self.blend, self.baked_blend = build, assets, blend, baked_blend
        self.quick = quick
        self.review_dir = review_dir
        self.preview = preview
        os.makedirs(review_dir, exist_ok=True)


def player_camera(col):
    cd = bpy.data.cameras.new("camera.player")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(VFOV_DEG)
    cd.clip_start = 0.1
    cd.clip_end = 3000.0
    cam = bpy.data.objects.new("camera.player", cd)
    cam.location = (0.0, 0.0, EYE)
    cam.rotation_euler = (math.radians(90.0 + PITCH_DEG), 0.0, 0.0)
    col.objects.link(cam)
    core.tag(cam, fov_deg=VFOV_DEG, eye_height=EYE, pitch_deg=PITCH_DEG)
    return cam


def stage_scene(ctx):
    from . import town, props, landscape, contract, landmarks
    t = time.time()
    scene = core.reset_scene()
    core.setup_gpu(scene)
    signs.OUT_DIR = os.path.join(ctx.build, "signs")
    os.makedirs(signs.OUT_DIR, exist_ok=True)
    lib = materials.build_library()
    props.extra_materials(lib)
    root = core.collection("DustCreek")
    c_bld = core.collection("buildings", root)
    c_props = core.collection("props", root)
    c_land = core.collection("landscape", root)
    c_contract = core.collection("contract", root)
    c_light = core.collection("lighting", root)
    lighting.build_world(scene)
    lighting.build_sun(c_light)
    cam = player_camera(c_contract)
    scene.camera = cam
    blds = town.build_buildings(lib, c_bld)
    town.decorate(blds, lib, c_bld)
    for b in blds.values():
        b.emit(c_bld, lib)
    props.build_street(lib, c_props, blds)
    props.near_cover(lib, c_props)
    from . import clutter
    clutter.materials(lib)
    clutter.build(lib, c_props)
    lm = landmarks.build(lib, c_bld)
    landscape.build(lib, c_land)
    from . import sky
    sky.build_far(core.collection("farworld", root))
    contract.build(lib, c_contract, blds, lm)
    # where dynamic shadows may fall besides the street: boardwalk and
    # balcony tops (export.py turns these into part of ground.shadow)
    import json
    from . import buildings as Bm
    quads = []
    for b in blds.values():
        if b.walk:
            P = Bm.WALK_DEPTH
            quads.append([list(b.F.p(s, y, Bm.DECK_Z + 0.012)) for (s, y) in
                          ((-b.W / 2, -P), (b.W / 2, -P), (b.W / 2, 0.0), (-b.W / 2, 0.0))])
    sal, ho = blds['saloon'], blds['hotel']
    quads.append([list(sal.F.p(s, y, 4.01 + 0.012)) for (s, y) in
                  ((-sal.W / 2, -Bm.WALK_DEPTH), (sal.W / 2, -Bm.WALK_DEPTH), (sal.W / 2, 0.0), (-sal.W / 2, 0.0))])
    quads.append([list(ho.F.p(s, y, 4.05 + 0.012)) for (s, y) in
                  ((-ho.W / 2 + 0.3, -1.1), (ho.W / 2 - 0.3, -1.1), (ho.W / 2 - 0.3, 0.0), (-ho.W / 2 + 0.3, 0.0))])
    scene["shadow_quads"] = json.dumps(quads)
    print(f"scene built in {time.time() - t:.1f}s: {len(bpy.data.objects)} objects, "
          f"{sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')} faces")
    bpy.ops.wm.save_as_mainfile(filepath=ctx.blend, compress=True)


def open_blend(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    core.setup_gpu()


def render_settings(scene, w, h, samples, denoise=True):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 4
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = lighting.VIEW_TRANSFORM
    scene.view_settings.look = lighting.LOOK


def stage_sky(ctx):
    from . import sky
    open_blend(ctx.blend)
    scene = bpy.context.scene
    if ctx.quick:
        sky.render_sky(ctx, scene, 1024, 512, 24)
    else:
        sky.render_sky(ctx, scene)
    # High noon, for the 12:00 secret: the same far world under a sun
    # nearly overhead (the game swaps it in as background and environment)
    open_blend(ctx.blend)
    scene = bpy.context.scene
    if ctx.quick:
        sky.render_sky(ctx, scene, 1024, 512, 24, name="sky_noon", noon=True)
    else:
        sky.render_sky(ctx, scene, 2048, 1024, 64, name="sky_noon", noon=True)


def stage_review(ctx):
    from . import review
    open_blend(ctx.blend)
    review.render_all(ctx)


def stage_poster(ctx):
    """poster.webp: the town from the player's eye at 1600x900 for the
    landing page — same camera, light, haze and grade as the game."""
    from . import post
    open_blend(ctx.blend)
    scene = bpy.context.scene
    scene.camera = bpy.data.objects["camera.player"]
    render_settings(scene, 1600, 900, 32 if ctx.quick else 384)
    scene.cycles.adaptive_threshold = 0.008
    cam = scene.camera.data
    cam.clip_end = 1.0e6
    out = os.path.join(ctx.assets, "poster.webp")
    post.render_with_fog(scene, out, fmt='WEBP', quality=90)
    print("poster", out, os.path.getsize(out) // 1024, "KB")


def stage_export(ctx):
    from . import export
    export.stage(ctx)


def stage_bake(ctx):
    from . import bake
    bake.stage(ctx)
