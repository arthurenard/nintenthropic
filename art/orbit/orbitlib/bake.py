"""Bake the cupola's light into one unlit atlas.

The player's eye never moves, so every texel of the frame can carry what
Cycles sees there from the eye: albedo x (direct + indirect light: the
interior LEDs, the sun through the left-hand windows, the planet's glow
through all seven) + the glossy reflection as seen from the player's
camera (the frame's bolts and edges catching the sun and the planet) +
emission (LEDs, the laptop's display), exposed and put through AgX like
every render of the build. The glb shows it unlit: the browser pays
nothing for it.

The station outside stays in the scene while baking (it shades and is
reflected); the glass is hidden so light passes.
"""

import time

import bpy
import numpy as np

from . import atlas, pipeline, render, bl

ATLAS = (4096, 4096)
QUALITY = 1.15          # texels per screen pixel on a 1440 px tall screen


def cupola_objects():
    col = bpy.data.collections['cupola']
    return [o for o in col.all_objects if o.type == 'MESH']


def stage(ctx):
    pipeline.open_blend(pipeline.scene_blend(ctx))
    sc = bpy.context.scene
    render.cycles(sc, 64, 64, 64, denoise=False)
    sc.cycles.max_bounces = 6
    sc.camera = bpy.data.objects['camera.player']
    obs = cupola_objects()
    panes = [o for o in obs if o.name.startswith('pane.')]
    for p in panes:
        p.hide_render = True
    statics = [o for o in obs if not o.name.startswith(('pane.', 'float.'))]
    floats = [o for o in obs if o.name.startswith('float.')]
    # one static object (one draw call); floats stay separate
    t = time.time()
    bpy.ops.object.select_all(action='DESELECT')
    for o in statics:
        o.select_set(True)
    bpy.context.view_layer.objects.active = statics[0]
    bpy.ops.object.join()
    static = bpy.context.view_layer.objects.active
    static.name = static.data.name = "cupola.frame"
    for k in list(static.keys()):
        del static[k]
    static['surface'] = 'metal'
    targets = [static] + floats
    # normals the right way before baking: rays leave from the lit side
    for o in targets:
        bl.orient_normals(o, eye=(0.0, 0.0, 0.0))
    print(f"  joined in {time.time() - t:.1f}s", flush=True)
    size = ATLAS if not ctx.quick else (1024, 1024)
    occl = [o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.name.startswith('pane.')]
    dens = atlas.EyeDensity(occl, screen_h=1440, quality=QUALITY)
    frac = atlas.unwrap(targets, size, dens, uv_name='bake', angle=55.0)
    q = ctx.quick
    s_irr, s_gl = (32, 16) if q else (320, 128)
    alb = atlas.bake_pass(targets, size, 'DIFFUSE_COLOR', 4 if q else 16)
    irr = atlas.bake_pass(targets, size, 'IRRADIANCE', s_irr)
    irr = atlas.denoise(irr, albedo=None)
    gl = atlas.bake_pass(targets, size, 'GLOSSY', s_gl, view_from_camera=True)
    gl = atlas.denoise(gl)
    em = atlas.bake_pass(targets, size, 'EMIT', 1)
    pos = atlas.bake_pass(targets, size, 'POSITION', 1)
    valid = np.linalg.norm(pos, axis=-1) > 1e-4
    rgb = alb * np.clip(irr, 0, None) + np.clip(gl, 0, None) + np.clip(em, 0, None)
    rgb = atlas.fill_empty(rgb, valid)
    np.save(ctx.path("cupola_atlas_linear.npy"), rgb.astype(np.float16))
    png = ctx.path("cupola_atlas.png")
    # through the same exposure and AgX look as the renders; rows are in
    # Blender's order (bottom first), which save_display expects flipped
    render.save_display(rgb[::-1], png, sc)
    for p in panes:
        p.hide_render = False
    sc['atlas_density'] = frac
    bpy.ops.wm.save_as_mainfile(filepath=ctx.path("cupola_baked.blend"), compress=True)
    print(f"  atlas {size[0]}x{size[1]} -> {png}", flush=True)
