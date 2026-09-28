"""poster.webp: Dead of Night's card in the arcade and on shared results.

The road from behind the barricade, the way the player sees it, a little
closer in: Route 9 running into the fog, the dead coming up it - the
nearest caught in the flashlight's beam, the ones behind only their eyes -
the GAS & EATS neon burning red on the right, the sodium lamp's cone at the
crossroads, the moon low on the left behind its veil.

Unlike the reviews (which add the game's fog in post), the poster renders
real volumetric fog in Cycles - a ground-hugging layer - so the beam and
the lamps draw their cones through it. Characters come from walker.glb as
built (so the poster shows exactly the game's dead).
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import pipeline, post, world, layout as L
from .common import EYE, setup_gpu, DN

# (dressing, clip, frame, x, y, yaw deg)
CAST = [
    (["char.walker", "var.outfit.suit", "var.hair.balding", "eyes"], "walk.shamble", 9, -1.15, 7.4, 8),
    (["char.walker", "var.outfit.farmer", "var.hair.short", "eyes"], "walk.limp", 21, 1.35, 12.8, -12),
    (["char.walker", "var.outfit.waitress", "var.hair.long", "eyes"], "walk.lurch", 5, -2.6, 17.5, 14),
    (["var.runner", "eyes"], "run", 7, 0.9, 23.5, -4),
    (["char.walker", "var.outfit.hunter", "var.hair.greasy", "eyes"], "walk.drag", 14, 3.1, 27.0, -20),
    (["char.walker", "var.outfit.trucker", "var.hair.short", "eyes"], "walk.shamble", 30, -0.6, 33.0, 4),
    (["var.bloater", "eyes"], "walk.shamble", 2, -3.4, 38.0, 10),
]


def import_figure(path, dressing, clip, frame, x, y, yaw, eyes=9.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    rig = next(o for o in new if o.type == 'ARMATURE')
    for o in new:
        if o.type == 'MESH' and o.name.split(".0")[0] not in dressing and not any(o.name.startswith(d + ".") and o.name[len(d) + 1:].isdigit() for d in dressing):
            bpy.data.objects.remove(o)
    top = rig
    while top.parent is not None:
        top = top.parent
    top.location = (x, y, 0.0)
    top.rotation_euler = (top.rotation_euler[0], top.rotation_euler[1], math.radians(yaw))
    act = bpy.data.actions.get(clip)
    rig.animation_data_create()
    for tr in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(tr)
    rig["poster_action"] = clip
    return rig, frame


def fog_volume(col):
    """A ground-hugging fog: thick on the road and the fields, thinning up."""
    me = bpy.data.meshes.new("poster_fog")
    x0, x1, y0, y1, z0, z1 = -70, 70, 1.0, 260, -1.0, 40.0
    vs = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    fs = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(vs, [], fs)
    ob = bpy.data.objects.new("poster_fog", me)
    col.objects.link(ob)
    m, g = DN.new_material("poster_fog")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    base = post.FOG_DENSITY * 1.35
    dens = g.madd(g.math('EXPONENT', g.mul(z, -1.0 / post.GROUND_FOG_H)), post.GROUND_FOG * 2.6, base)
    n = g.noise(g.vmul(pos, (0.08, 0.05, 0.25)), scale=1.0, detail=3.0)
    dens = g.mul(dens, g.madd(n, 0.9, 0.55))
    vol = g.node('ShaderNodeVolumePrincipled', inputs={'Color': (0.78, 0.84, 0.92), 'Density': dens, 'Anisotropy': 0.45}, out=0)
    out = g.new('ShaderNodeOutputMaterial')
    g.links.new(vol, out.inputs['Volume'])
    me.materials.append(m)
    return ob


def render(ctx):
    pipeline.open_blend(ctx.blend)
    scene = bpy.context.scene
    setup_gpu(scene)
    col = scene.collection
    walker = os.path.join(ctx.assets, "walker.glb")
    figures = []
    if os.path.exists(walker):
        for dressing, clip, frame, x, y, yaw in CAST:
            figures.append(import_figure(walker, dressing, clip, frame, x, y, yaw))
        m = bpy.data.materials.get("eyes")
        for mm in [mm for mm in bpy.data.materials if mm.name.startswith("eyes")]:
            for nd in mm.node_tree.nodes:
                if nd.type == 'BSDF_PRINCIPLED':
                    nd.inputs["Emission Strength"].default_value = 14.0
    # each figure frozen at its own moment of its clip: evaluate, then let the
    # pose stand without the action
    for rig, frame in figures:
        rig.animation_data.action = bpy.data.actions.get(rig["poster_action"])
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        rig.animation_data.action = None
        for tr in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(tr)
    # the camera: the player's eye, a longer lens, pitched up a touch
    cd = bpy.data.cameras.new("poster_cam")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(33.0)
    cd.clip_start = 0.1
    cd.clip_end = 1.0e5
    cam = bpy.data.objects.new("poster_cam", cd)
    cam.location = (0.35, 0.0, EYE.z)
    cam.rotation_euler = (math.radians(90.0 + 1.5), 0.0, math.radians(-4.0))
    col.objects.link(cam)
    scene.camera = cam
    # the flashlight, held under the rifle's barrel, on the nearest of them
    ld = bpy.data.lights.new("poster_beam", 'SPOT')
    ld.energy = 2600.0
    ld.color = (1.0, 0.94, 0.82)
    ld.spot_size = math.radians(17.0)
    ld.spot_blend = 0.35
    ld.shadow_soft_size = 0.015
    beam = bpy.data.objects.new("poster_beam", ld)
    beam.location = (0.55, 0.4, 1.45)
    tgt = Vector((CAST[0][3] + 0.2, CAST[0][4] + 3.0, 1.15))
    beam.rotation_euler = (tgt - beam.location).to_track_quat('-Z', 'Y').to_euler()
    col.objects.link(beam)
    fog_volume(col)
    pipeline.render_settings(scene, 1600, 900, 48 if ctx.quick else 640)
    scene.cycles.volume_bounces = 1
    scene.cycles.volume_step_rate = 4.0 if ctx.quick else 1.5
    scene.cycles.adaptive_threshold = 0.01
    if ctx.quick:
        scene.render.resolution_percentage = 50
    out = os.path.join(ctx.assets, "poster.webp")
    post.render(scene, out, fog=False, fmt='WEBP', quality=90)
    print("poster", out, os.path.getsize(out) // 1024, "KB")
    if ctx.quick:
        import shutil
        shutil.copy(out, os.path.join(ctx.review_dir, "poster_quick.webp"))
