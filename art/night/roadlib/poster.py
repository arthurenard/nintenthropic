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
from mathutils import Vector

from . import pipeline, post
from .common import EYE, setup_gpu, DN

# (dressing, clip, frame, x, y, yaw deg)
CAST = [
    (["char.walker", "var.outfit.farmer", "var.hair.short", "eyes"], "walk.shamble", 9, -0.95, 6.2, 8),
    (["char.walker", "var.outfit.suit", "var.hair.balding", "eyes"], "walk.limp", 21, 1.35, 12.8, -12),
    (["char.walker", "var.outfit.waitress", "var.hair.long", "eyes"], "walk.lurch", 5, -2.6, 17.5, 14),
    (["char.runner", "eyes"], "run", 7, 0.9, 23.5, -4),
    (["char.walker", "var.outfit.hunter", "var.hair.greasy", "eyes"], "walk.drag", 14, 3.1, 27.0, -20),
    (["char.walker", "var.outfit.trucker", "var.hair.short", "eyes"], "walk.shamble", 30, -0.6, 33.0, 4),
    (["char.bloater", "eyes"], "walk.shamble", 2, -3.4, 38.0, 10),
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
    # thinner than the game's fog: a volume scatters the lamps' light back at
    # the eye as well as dimming, and at the game's density the road washes out
    base = post.FOG_DENSITY * 0.9
    dens = g.madd(g.math('EXPONENT', g.mul(z, -1.0 / post.GROUND_FOG_H)), post.GROUND_FOG * 2.0, base)
    n = g.noise(g.vmul(pos, (0.08, 0.05, 0.25)), scale=1.0, detail=3.0)
    dens = g.mul(dens, g.madd(n, 0.9, 0.55))
    vol = g.node('ShaderNodeVolumePrincipled', inputs={'Color': (0.78, 0.84, 0.92), 'Density': dens, 'Anisotropy': 0.45}, out=0)
    out = g.new('ShaderNodeOutputMaterial')
    g.links.new(vol, out.inputs['Volume'])
    me.materials.append(m)
    return ob


def render_cast(ctx):
    """Review: the dead on Route 9 at the game's distances. The player's eye
    and play lens, the flashlight on one figure at 10, 25 and 40 m (and one
    shot with all three and the beam on the far one), the game's fog added
    in post (reviews' fog, not the poster's volume), the eyes at the game's
    shine for a beam on them (emissiveIntensity 3)."""
    from . import review
    shots = [
        ("road_dead_10m", [(["char.walker", "var.outfit.farmer", "var.hair.short", "eyes"], "walk.shamble", 9, -0.5, 10.0, 6)], 0),
        ("road_dead_25m", [(["char.walker", "var.outfit.waitress", "var.hair.long", "eyes"], "walk.lurch", 5, 0.8, 25.0, -8)], 0),
        ("road_dead_40m", [(["char.walker", "var.outfit.hunter", "var.hair.balding", "eyes"], "walk.drag", 14, -1.2, 40.0, 10)], 0),
        ("road_dead_all", [(["char.walker", "var.outfit.farmer", "var.hair.short", "eyes"], "walk.shamble", 9, -0.5, 10.0, 6),
                           (["char.walker", "var.outfit.waitress", "var.hair.long", "eyes"], "walk.lurch", 5, 0.8, 25.0, -8),
                           (["char.walker", "var.outfit.hunter", "var.hair.balding", "eyes"], "walk.drag", 14, -1.2, 40.0, 10)], 2),
    ]
    walker = os.path.join(ctx.assets, "walker.glb")
    for name, cast, lit in shots:
        pipeline.open_blend(ctx.blend)
        scene = bpy.context.scene
        setup_gpu(scene)
        figs = [import_figure(walker, *c) for c in cast]
        for mm in [mm for mm in bpy.data.materials if mm.name.startswith("eyes")]:
            for nd in mm.node_tree.nodes:
                if nd.type == 'BSDF_PRINCIPLED':
                    nd.inputs["Emission Strength"].default_value = 3.0
        for rig, frame in figs:
            rig.animation_data.action = bpy.data.actions.get(rig["poster_action"])
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            rig.animation_data.action = None
        cam = review.play_camera(scene)
        scene.camera = cam
        ld = bpy.data.lights.new("review_beam", 'SPOT')
        ld.energy = 3600.0
        ld.color = (1.0, 0.94, 0.82)
        ld.spot_size = math.radians(17.0)
        ld.spot_blend = 0.35
        ld.shadow_soft_size = 0.015
        beam = bpy.data.objects.new("review_beam", ld)
        beam.location = (0.25, 0.3, 1.45)
        _, _, _, x, y, _ = cast[lit]
        beam.rotation_euler = (Vector((x, y, 1.2)) - beam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(beam)
        pipeline.render_settings(scene, 1600, 900, 48 if ctx.quick else 160)
        if ctx.quick:
            scene.render.resolution_percentage = 60
        post.render(scene, os.path.join(ctx.review_dir, name + ".png"), fog=True)
        print("cast review", name, flush=True)


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
        for mm in [mm for mm in bpy.data.materials if mm.name.startswith("eyes")]:
            for nd in mm.node_tree.nodes:
                if nd.type == 'BSDF_PRINCIPLED':
                    nd.inputs["Emission Strength"].default_value = 14.0
    # each figure frozen at its own moment of its clip: evaluate, then let the
    # pose stand without the action
    from mathutils import Quaternion
    for i, (rig, frame) in enumerate(figures):
        rig.animation_data.action = bpy.data.actions.get(rig["poster_action"])
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        rig.animation_data.action = None
        for tr in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(tr)
        if i == 0:
            # the nearest lifts its face into the beam: the eyes catch it
            pb = rig.pose.bones.get("head")
            if pb is not None:
                pb.rotation_mode = 'QUATERNION'
                pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion((1, 0, 0), math.radians(-22))
            nk = rig.pose.bones.get("neck")
            if nk is not None:
                nk.rotation_mode = 'QUATERNION'
                nk.rotation_quaternion = nk.rotation_quaternion @ Quaternion((1, 0, 0), math.radians(-8))
    # the camera: the player's eye, a longer lens, pitched up a touch
    cd = bpy.data.cameras.new("poster_cam")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(29.0)
    cd.clip_start = 0.1
    cd.clip_end = 1.0e5
    cam = bpy.data.objects.new("poster_cam", cd)
    cam.location = (0.0, 0.0, EYE.z)
    cam.rotation_euler = (math.radians(90.0 + 1.5), 0.0, math.radians(-3.0))
    col.objects.link(cam)
    scene.camera = cam
    # the flashlight, held under the rifle's barrel, on the nearest of them
    ld = bpy.data.lights.new("poster_beam", 'SPOT')
    ld.energy = 3600.0
    ld.color = (1.0, 0.94, 0.82)
    ld.spot_size = math.radians(17.0)
    ld.spot_blend = 0.35
    ld.shadow_soft_size = 0.015
    beam = bpy.data.objects.new("poster_beam", ld)
    beam.location = (0.55, 0.4, 1.45)
    tgt = Vector((CAST[0][3] + 0.1, CAST[0][4], 1.3))          # on the nearest one's chest
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
