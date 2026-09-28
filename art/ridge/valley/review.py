"""The review set: what the player sees, rendered in Cycles with the same
sun, sky, haze and mist the game is asked to reproduce.

    wide            the player's view (16:9 and 21:9)
    scope_*         6x views (vertical field of view 50/6 degrees) of the
                    checkpoint, bridge, chapel, dam, farm, village street,
                    the goat's crag, the great cliff, the yeti's snowfield
    people_*        soldiers and civilians from soldier.glb / civilian.glb
                    placed at their posts and paths, through the scope - the
                    test the game depends on (who is a soldier at 400 m?)
Written to art/ridge/build/review/ (gitignored).
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import layout as L
from . import scene as S
from . import post


def log(*a):
    print("[review]", *a, flush=True)


def scope_cam(name, target, zoom=6.0, aspect=16 / 9):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(L.VFOV_DEG / zoom)
    cd.clip_start = 0.3
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0, 0, 0)
    cam.rotation_euler = Vector(target).to_track_quat('-Z', 'Y').to_euler()
    return cam


def node_pos(name):
    ob = bpy.data.objects.get(name)
    return tuple(ob.matrix_world.translation) if ob else None


def views():
    v = []
    add = lambda nm, tgt, zoom=6.0: v.append((nm, tgt, zoom)) if tgt is not None else None
    add("scope_checkpoint", node_pos("post.tower") and (L.CHECKPOINT_C[0], L.CHECKPOINT_C[1], -55.0))
    add("scope_bridge", (L.BRIDGE_C[0], L.BRIDGE_C[1], -56.5))
    tw = node_pos("sniper.1")
    add("scope_chapel", tw and (tw[0], tw[1], tw[2] - 7.0))
    add("scope_chapel_tower_12x", tw and (tw[0], tw[1], tw[2] + 1.0), 12.0)
    add("scope_dam", (L.DAM_CREST_C[0], L.DAM_CREST_C[1], -20.0))
    add("scope_tunnel", tuple(L.TUNNEL))
    add("scope_farm", (L.FARM_C[0], L.FARM_C[1], -50.0))
    add("scope_village", (L.VILLAGE_C[0], L.VILLAGE_C[1], -50.0))
    riv = L.river()
    for nm, s_ in (("scope_river", 880.0), ("scope_river_far", 1380.0)):
        p = riv.at(s_)
        add(nm, (float(p[0]), float(p[1]), float(riv.at(s_, 'z'))))
    g = node_pos("secret.goat.2")
    add("scope_goat_crag", g)
    c = node_pos("secret.cliff")
    add("scope_cliff", c)
    y = node_pos("secret.yeti")
    add("scope_yeti", y and (y[0], y[1], y[2] + 1.0))
    add("scope_peaks", tuple(L.polar(-6.0, 3300.0, 900.0)), 3.0)
    return v


def import_people(assets):
    """soldier.glb / civilian.glb from the other stages, if they are there."""
    out = {}
    for f in ("soldier", "civilian", "vehicles", "animals"):
        p = os.path.join(assets, f"{f}.glb")
        if not os.path.exists(p):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=p)
        new = [o for o in bpy.data.objects if o not in before]
        # the importer's bone-display spheres are not part of the asset
        for o in [o for o in new if o.name.startswith("Icosphere")]:
            bpy.data.objects.remove(o)
        new = [o for o in bpy.data.objects if o not in before]
        col = S.collection(f"review_{f}")
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            col.objects.link(o)
        out[f] = new
    return out


def place_group(objs, pos, heading, show=None, action=None, frame=10):
    """Put an imported glb's root at `pos` facing `heading` (radians, Blender
    Z rotation; the glTF +Z forward is Blender -Y), dressing it with `show`."""
    roots = [o for o in objs if o.parent is None]
    for r in roots:
        r.location = pos
        r.rotation_euler = (math.radians(90) if False else 0.0, 0.0, heading)
    if show is not None:
        for o in objs:
            if o.type == 'MESH':
                nm = o.name.split(".0")[0]
                if nm.startswith(("var.", "gun.", "prop.", "bicycle")):
                    o.hide_render = not any(nm.startswith(s) for s in show)
    if action:
        arm = next((o for o in objs if o.type == 'ARMATURE'), None)
        act = bpy.data.actions.get(action)
        if arm and act:
            arm.animation_data_create()
            arm.animation_data.action = act
            bpy.context.scene.frame_set(frame)


def render_all(ctx):
    sc = bpy.context.scene
    S.apply_lighting(sc)
    q = ctx.quick
    only = ctx.preview.split(",") if ctx.preview else None
    os.makedirs(ctx.review_dir, exist_ok=True)
    cam = bpy.data.objects["camera.player"]
    for nm, w, h in (("wide", 1920, 1080), ("wide_21x9", 2520, 1080)):
        if only and not any(o in nm for o in only):
            continue
        S.render_settings(sc, w // (2 if q else 1), h // (2 if q else 1), 32 if q else 256)
        sc.camera = cam
        post.render_with_fog(sc, os.path.join(ctx.review_dir, f"valley_{nm}.png"))
        log("wrote", nm)
    for nm, tgt, zoom in views():
        if only and not any(o in nm for o in only):
            continue
        c = scope_cam(nm, tgt, zoom)
        S.render_settings(sc, 1280 if q else 2560, 720 if q else 1440, 24 if q else 160)
        sc.camera = c
        post.render_with_fog(sc, os.path.join(ctx.review_dir, f"valley_{nm}.png"), adapt=True)
        log("wrote", nm)
    if only and "people" not in only:
        return
    people(ctx)


def people(ctx):
    """Soldiers and civilians at their posts, through the scope."""
    sc = bpy.context.scene
    got = import_people(ctx.assets)
    if "soldier" not in got:
        log("no soldier.glb yet")
        return
    log("imported", {k: len(v) for k, v in got.items()})
    q = ctx.quick
    # soldier at the barrier, the farmer in his pasture, side by side at the checkpoint
    # (one instance each: the glb is imported once; move it per shot)
    shots = []
    for post_name, dress, act, label in (("post.cp_barrier", ["var.helmet", "gun.rifle"], "idle", "soldier_checkpoint"),
                                         ("post.tower", ["var.helmet", "gun.rifle"], "idle", "soldier_tower")):
        p = node_pos(post_name)
        if p:
            shots.append((label, p, dress, act))
    for label, p, dress, act in shots:
        place_group(got["soldier"], p, math.atan2(-p[0], p[1]) + math.pi, show=dress, action=act)
        if "civilian" in got:
            q2 = (p[0] + 2.5, p[1] + 0.5, p[2])
            place_group(got["civilian"], q2, math.atan2(-q2[0], q2[1]) + math.pi, show=["var.person.farmer"], action="idle")
        c = scope_cam(f"people_{label}", (p[0] + 1.2, p[1], p[2] + 1.2), 6.0)
        S.render_settings(sc, 1280 if q else 2560, 720 if q else 1440, 24 if q else 128)
        sc.camera = c
        post.render_with_fog(sc, os.path.join(ctx.review_dir, f"valley_people_{label}.png"), adapt=True)
        log("wrote", label)
