"""Review renders: the player's view at two aspect ratios, close-ups of
every building and secret, and the unlit (baked-texture-only) check."""

import os

import bpy
from mathutils import Vector

from . import pipeline

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
    'bell': ((3.0, 54.0, 12.0), (0.0, 62.3, 14.9), 85),
    'poster_from_eye': ((0.0, 0.0, 1.7), (8.0, 17.0, 2.0), 230),
    'poster': ((6.4, 13.6, 1.8), (8.0, 17.0, 2.0), 45),
    'piano_from_eye': ((0.0, 0.0, 1.7), (-10.0, 20.2, 1.5), 260),
    'water_tower': ((2.0, 30.0, 1.7), (21.0, 45.0, 13.0), 45),
    'wagon': ((1.5, 16.0, 1.7), (-2.0, 21.8, 0.7), 35),
    'livery_horse': ((-6.2, 44.8, 1.7), (-10.3, 42.1, 1.65), 50),
    'far_end': ((0.0, 0.0, 1.7), (0.0, 60.0, 5.0), 110),
}


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(scene, path, w, h, samples, fog=True):
    from . import post
    pipeline.render_settings(scene, w, h, samples)
    cam = scene.camera.data
    old = cam.clip_end
    cam.clip_end = 1.0e6     # let the far world (mesas, clouds) into review renders
    post.render_with_fog(scene, path, fog=fog)
    cam.clip_end = old
    print("wrote", path, flush=True)


def figures(scene):
    """Stand a plain 1.8 m figure (dark coat, pale hat band) on every
    exposed cover point, to check that a man standing there reads clearly."""
    import bmesh
    from .nodes import new_material
    m, g = new_material("figure")
    g.output(g.principled((0.05, 0.035, 0.03), rough=0.7))
    hat, gh = new_material("figure_hat")
    gh.output(gh.principled((0.35, 0.25, 0.16), rough=0.8))
    col = bpy.data.collections.new("figures")
    scene.collection.children.link(col)
    for ob in list(scene.objects):
        if not ob.name.startswith('cover.') or ob.name.endswith('.hidden'):
            continue
        p = ob.location
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.2, radius2=0.24, depth=1.45)
        for v in bm.verts:
            v.co.z += 0.725
        me = bpy.data.meshes.new("fig")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(m)
        body = bpy.data.objects.new("fig", me)
        body.location = p
        col.objects.link(body)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.12)
        me = bpy.data.meshes.new("head")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(m)
        head = bpy.data.objects.new("head", me)
        head.location = p + Vector((0, 0, 1.6))
        col.objects.link(head)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.26, radius2=0.26, depth=0.03)
        me = bpy.data.meshes.new("brim")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(hat)
        brim = bpy.data.objects.new("brim", me)
        brim.location = p + Vector((0, 0, 1.7))
        col.objects.link(brim)


def render_all(ctx):
    scene = bpy.context.scene
    cam = bpy.data.objects["camera.player"]
    scene.camera = cam
    if ctx.preview == 'figures':
        figures(scene)
        render(scene, os.path.join(ctx.review_dir, "figures_1600x1000.png"), 1600, 1000, 48 if not ctx.quick else 16)
        return
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
