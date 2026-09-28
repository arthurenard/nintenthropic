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


def closeups(ctx, maps):
    """Details from (near) the eye with longer lenses, over the planet."""
    q = ctx.quick
    shots = [
        ('close_laptop', (0.0, 0.05, 0.0), world.view_point(0.78, -0.72, 1.0), 42.0),
        ('close_frame', (0.0, 0.0, 0.0), world.view_point(-0.55, 0.42, 1.0), 55.0),
        ('close_float', (0.0, 0.0, 0.0), world.view_point(-0.62, -0.1, 1.0), 45.0),
        ('close_hand', (0.0, 0.0, 0.0), world.view_point(0.12, -0.02, 1.0), 130.0),
        ('close_capsule', (0.0, 0.0, 0.0), world.view_point(-0.35, -0.55, 1.0), 85.0),
        ('close_turret', (0.0, 0.0, 0.0), world.view_point(0.3, -0.82, 1.0), 60.0),
        ('close_truss', (0.0, 0.0, 0.0), world.view_point(-0.2, 0.86, 1.0), 90.0),
    ]
    for name, loc, tgt, lens in shots:
        if ctx.preview not in (None, 'close', name):
            continue
        cam = free_camera("review_cam", loc, Vector(tuple(float(c) for c in tgt)), lens)
        render_view(ctx, name, cam, 1200 if not q else 800, 800 if not q else 534, 24 if q else 192, maps=maps)


def overviews(ctx, maps):
    q = ctx.quick
    for name, (loc, tgt, lens) in OVERVIEWS.items():
        if ctx.preview not in (None, 'overview', name):
            continue
        cam = free_camera("review_cam", loc, tgt, lens)
        render_view(ctx, name, cam, 1280 if not q else 960, 720 if not q else 540, 16 if q else 96, maps=maps, planet=False)


def asset_scene(ctx, glb, sun=None):
    """A clean scene with one exported file imported, lit by the planet's
    glow and a hard sun, black space behind."""
    bl.reset_scene("Review")
    bl.setup_gpu()
    sc = bpy.context.scene
    render.world_env(sc, ctx.path("env_day.exr"))
    render.sun_lamp(sc.collection, direction=sun)
    bpy.ops.import_scene.gltf(filepath=glb)
    return sc


def explode(group, amount):
    """Push each piece of a `.pieces` group away from the group's origin."""
    for c in group.children:
        d = c.location.copy()
        if d.length < 1e-4:
            d = Vector((0, 0, 1))
        c.location = c.location + d.normalized() * amount


def fit_camera(name, objs, direction, lens=50.0, aspect=16 / 9, margin=1.12):
    """A camera looking along `direction` that frames every vertex of the
    objects (world bounding boxes)."""
    bpy.context.view_layer.update()
    pts = []
    for o in objs:
        if o.type != 'MESH' or o.hide_render:
            continue
        pts.extend(o.matrix_world @ Vector(c) for c in o.bound_box)
    if not pts:
        return free_camera(name, (0, -5, 2), (0, 0, 0), lens)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    tgt = (lo + hi) / 2
    d = Vector(direction).normalized()
    tx = 18.0 / lens / margin
    ty = tx / aspect
    right = d.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(d)
    dist = 0.1
    for p in pts:
        v = p - tgt
        x, y, z = v.dot(right), v.dot(up), v.dot(d)
        dist = max(dist, abs(x) / tx - z, abs(y) / ty - z)
    return free_camera(name, tgt - d * dist, tgt, lens)


def debris(ctx):
    sc = asset_scene(ctx, ctx.asset("debris.glb"), sun=Vector((-0.6, -0.5, 0.62)).normalized())
    q = ctx.quick
    kinds = ('shrapnel', 'chunk', 'slab', 'shard', 'foil')
    roots = [o for o in sc.objects if o.parent is None and o.type in ('MESH', 'EMPTY')]

    def meshes(o):
        return [x for x in [o] + list(o.children_recursive) if x.type == 'MESH']
    for kind in kinds:
        if ctx.preview not in (None, 'debris', f'debris_{kind}'):
            continue
        mine = [o for o in roots if o.name.split('.')[0] == kind]
        wholes = sorted([o for o in mine if not o.name.endswith('.pieces')], key=lambda o: o.name)
        size = max(max(m.dimensions) for o in wholes for m in meshes(o))
        step = size * 1.35
        for o in roots:
            vis = o in mine
            for x in [o] + list(o.children_recursive):
                x.hide_render = not vis
        # wholes in a row; each one's pieces pulled apart behind it
        for i, o in enumerate(wholes):
            o.location = Vector((i * step, 0.0, 0.0))
            g = bpy.data.objects.get(o.name + '.pieces')
            if g is not None:
                g.location = Vector((i * step, size * 1.5, 0.0))
                explode(g, 0.12 * size + 0.03)
        cam = fit_camera("review_cam", [m for o in mine for m in meshes(o)], (0.15, 1.0, -0.62), 50.0)
        render_view(ctx, f"debris_{kind}", cam, 1600 if not q else 960, 900 if not q else 540, 16 if q else 160, planet=False)
        for o in mine:
            o.location = Vector((0, 0, 0))
            for x in [o] + list(o.children_recursive):
                x.hide_render = True
    for o in roots:
        for x in [o] + list(o.children_recursive):
            x.hide_render = False


def player_debris(ctx, maps):
    """The real test: the debris field in the player's view, fragments at
    12-90 m tumbling in the baked sun, over the planet."""
    import random
    pipeline.open_blend(pipeline.scene_blend(ctx))
    sc = bpy.context.scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ctx.asset("debris.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    lib = [o for o in new if o.parent is None and not o.name.endswith('.pieces') and o.name.split('.')[0] in
           ('shrapnel', 'chunk', 'slab', 'shard', 'foil')]
    for o in new:
        o.hide_render = True
    # the station's shadows fall across the field in Cycles; the game lights
    # debris without them, so leave them out of this check
    for o in bpy.data.collections['station'].all_objects:
        o.visible_shadow = False
    rnd = random.Random(7)
    col = bpy.data.collections.new("field")
    sc.collection.children.link(col)
    picks = [('shrapnel', 12, 14, 26), ('chunk', 8, 18, 45), ('slab', 3, 30, 70), ('shard', 3, 25, 60), ('foil', 2, 20, 45)]
    for kind, n, d0, d1 in picks:
        pool = [o for o in lib if o.name.startswith(kind + '.')]
        for k in range(n):
            src = rnd.choice(pool)
            d = rnd.uniform(d0, d1)
            sx, sy = rnd.uniform(-0.85, 0.85), rnd.uniform(-0.7, 0.75)
            pos = Vector(tuple(float(c) for c in world.view_point(sx, sy, d)))
            dup = src.copy()
            col.objects.link(dup)
            dup.hide_render = False
            dup.location = pos
            dup.rotation_mode = 'XYZ'
            dup.rotation_euler = (rnd.uniform(0, 6.3), rnd.uniform(0, 6.3), rnd.uniform(0, 6.3))
            for ch in src.children:
                c2 = ch.copy()
                col.objects.link(c2)
                c2.parent = dup
                c2.hide_render = False
    cam = bpy.data.objects['camera.player']
    q = ctx.quick
    render_view(ctx, 'player_debris', cam, 1600 if not q else 960, 900 if not q else 540, 24 if q else 256, maps=maps)


SHOTS = {
    # file: [(name, camera location, target, lens, setup)]
    'drone.glb': [('drone_front', (0.9, -1.6, 0.55), (0, 0, -0.05), 50, None),
                  ('drone_back', (-1.3, 1.2, 0.9), (0, 0, 0), 50, None)],
    'derelict.glb': [('derelict_tank', (-5.5, -5.0, 2.2), (-0.6, 0, 0), 40, None),
                     ('derelict_wings', (4.0, -6.5, 3.5), (0, 0, 0.2), 32, None),
                     ('derelict_breakup', (-4.5, -7.0, 3.0), (0, 0, 0), 32, 'breakup')],
    'extras.glb': [('extras_astronaut', (1.3, -3.4, 1.5), (0, 0, 1.0), 50, 'astronaut'),
                   ('extras_thumbsdown', (-1.2, -2.6, 1.4), (-0.3, 0, 1.2), 50, 'thumbsdown'),
                   ('extras_toolbag', (0.55, -0.9, 0.45), (0, 0, 0), 50, 'toolbag'),
                   ('extras_duck', (0.16, -0.26, 0.12), (0, 0, 0.01), 60, 'duck'),
                   ('extras_sticker', (0.0, -0.45, 0.0), (0, 0, 0), 50, 'sticker')],
}


def _only(sc, prefix):
    for o in sc.objects:
        if o.type in ('MESH', 'EMPTY'):
            top = o
            while top.parent is not None:
                top = top.parent
            o.hide_render = not top.name.startswith(prefix)


def asset_shots(ctx, fname):
    path = ctx.asset(fname)
    if not os.path.exists(path):
        return
    sc = asset_scene(ctx, path, sun=Vector((-0.55, -0.6, 0.58)).normalized())
    q = ctx.quick
    for name, loc, tgt, lens, setup in SHOTS[fname]:
        if ctx.preview not in (None, fname.split('.')[0], name):
            continue
        for o in sc.objects:
            o.hide_render = False
        if setup == 'breakup':
            body = bpy.data.objects.get('derelict.body')
            if body:
                body.hide_render = True
            grp = bpy.data.objects.get('derelict.pieces')
            if grp:
                explode(grp, 0.45)
        elif setup in ('astronaut', 'toolbag', 'duck', 'sticker'):
            _only(sc, setup)
            if setup == 'toolbag':
                bag = bpy.data.objects.get('toolbag.bag')
                for o in sc.objects:
                    if o.name.startswith('toolbag.tool'):
                        o.location = o.location * 3.0 + Vector((0, 0, 0.12))
        elif setup == 'thumbsdown':
            _only(sc, 'astronaut')
            arm = bpy.data.objects.get('astronaut.arm.R')
            fore = bpy.data.objects.get('astronaut.forearm.R')
            hand = bpy.data.objects.get('astronaut.hand.R')
            if arm and fore and hand:
                # the documented recipe: raise the arm forward about its
                # hinge (local X), a little bend at the elbow, then turn the
                # hand half a turn about the limb (Blender local Y = glTF Z)
                arm.matrix_basis = arm.matrix_basis @ Matrix.Rotation(math.radians(75), 4, 'X')
                fore.matrix_basis = fore.matrix_basis @ Matrix.Rotation(math.radians(20), 4, 'X')
                hand.matrix_basis = hand.matrix_basis @ Matrix.Rotation(math.radians(180), 4, 'Y')
        cam = free_camera("review_cam", loc, tgt, lens)
        render_view(ctx, name, cam, 1280 if not q else 960, 960 if not q else 720, 24 if q else 192, planet=False)
        if setup == 'breakup':
            body = bpy.data.objects.get('derelict.body')
            if body:
                body.hide_render = False


# ---------------------------------------------------------------------------
# The planet alone

PLANET_VIEWS = {
    # name: (sun elevation above the station's horizontal, azimuth from the
    #        view (+ right), camera: 'player' or (depression, roll, vfov),
    #        exposure stops, star gain, night gain)
    'planet_day': (55.0, -30.0, 'player', 0.0, 0.0, 0.0),
    'planet_glint': (24.0, -4.0, 'player', 0.0, 0.0, 0.0),
    'planet_terminator': (-2.0, 20.0, 'player', 1.8, 0.1, 0.6),
    'planet_night': (-40.0, 180.0, 'player', 4.2, 0.6, 2.0, (80.0, 30.0), 30.0),
    'planet_night_hi': (-40.0, 180.0, 'player', 4.2, 0.6, 2.0, (-112.0, 43.5), 0.0),
    'planet_limb_tele': (6.0, 35.0, (21.0, -4.0, 18.0), 0.6, 0.0, 0.3),
}


def planet_views(ctx, maps):
    from . import planetrender as PR
    q = ctx.quick
    w, h = (1600, 900) if not q else (960, 540)
    sc = bpy.context.scene
    sc.view_settings.view_transform = render.VIEW_TRANSFORM
    sc.view_settings.look = render.LOOK
    for name, spec in PLANET_VIEWS.items():
        el, az, camdef, ex, stars, night = spec[:6]
        rot = world.planet_rotation(spec[6], spec[7]) if len(spec) > 6 else None
        if ctx.preview not in (None, 'planet', name):
            continue
        t = time.time()
        up = world.station_up()
        f = world.forward()
        fh = f - up * (f @ up)
        fh /= np.linalg.norm(fh)
        right = np.cross(fh, up)
        e, a = math.radians(el), math.radians(az)
        sun = (fh * math.cos(a) + right * math.sin(a)) * math.cos(e) + up * math.sin(e)
        sky = pipeline.Sky(sun_world=sun, star_gain=stars, night_gain=night)
        if camdef == 'player':
            cam = bpy.data.objects['camera.player']
            D, _ = render.camera_rays(cam, w, h)
        else:
            dep, roll, vfov = camdef
            # a telephoto on the limb from the eye
            d = fh * math.cos(math.radians(dep)) - up * math.sin(math.radians(dep))
            rgt = np.cross(d, up)
            rgt /= np.linalg.norm(rgt)
            cup = np.cross(rgt, d)
            rl = math.radians(roll)
            r2 = rgt * math.cos(rl) + cup * math.sin(rl)
            u2 = -rgt * math.sin(rl) + cup * math.cos(rl)
            D = PR.perspective_rays(w, h, vfov, np.stack([r2, u2, -d], 1))
        L, _ = pipeline.render_planet_view(maps, D.astype(np.float64), sky, samples=32 if q else 64, rot=rot)
        rgb = L.reshape(h, w, 3) * (2 ** ex)
        from .poster import bloom
        rgb = bloom(rgb * 2 ** render.EXPOSURE, threshold=0.9) / 2 ** render.EXPOSURE
        sc.view_settings.exposure = render.EXPOSURE
        path = _out(ctx, name)
        render.save_display(rgb, path, sc)
        log(f"  {name}: {w}x{h} in {time.time() - t:.1f}s -> {path}")


def calib_overlay(ctx):
    """The player's view with the nine running lights ringed: are they
    spread over the screen, and all seen through glass?"""
    import OpenImageIO as oiio
    src = _out(ctx, 'player_quick' if ctx.quick else 'player_1600x900')
    if not os.path.exists(src):
        return
    img = np.asarray(oiio.ImageInput.open(src).read_image(0, 0, 0, 3, oiio.UINT8)).copy()
    h, w = img.shape[:2]
    for i in range(1, 10):
        ob = bpy.data.objects.get(f"calib.{i}")
        if ob is None:
            continue
        x, y, z = world.to_ndc(np.array(ob.matrix_world.translation), aspect=w / h)
        px, py = (x * 0.5 + 0.5) * w, (0.5 - y * 0.5) * h
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
        ring = (np.abs(d - 18) < 2.0)
        img[ring] = (48, 209, 88)
        log(f"  calib.{i}: ndc ({x:+.2f}, {y:+.2f}) at {z:.1f} m")
    out = _out(ctx, 'player_calib')
    o = oiio.ImageOutput.create(out)
    o.open(out, oiio.ImageSpec(w, h, 3, oiio.UINT8))
    o.write_image(img)
    o.close()


def exported_player(ctx, maps):
    """The player's view rebuilt from what ships: cupola.glb (unlit, not tone
    mapped) over station.glb (PBR, lit, AgX) over the planet - composed in
    display colour, the way the game will."""
    import OpenImageIO as oiio
    if not (os.path.exists(ctx.asset("cupola.glb")) and os.path.exists(ctx.asset("station.glb"))):
        return
    q = ctx.quick
    w, h = (1600, 900) if not q else (960, 540)
    sc = asset_scene(ctx, ctx.asset("station.glb"))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ctx.asset("cupola.glb"))
    cup = [o for o in bpy.data.objects if o not in before]
    cam = next(o for o in cup if o.type == 'CAMERA')
    st = [o for o in bpy.data.objects if o in before and o.type == 'MESH']
    # 1: the station and the planet, lit and tone-mapped
    for o in cup:
        o.hide_render = True
    render.cycles(sc, w, h, 24 if q else 192)
    sc.camera = cam
    fg, a = render.render_fg(sc, ctx.path("__exp_st.exr"))
    bg = render.planet_background(ctx, cam, w, h, pipeline.Sky(), maps=maps, samples=32 if q else 64)
    p1 = ctx.path("__exp_st.png")
    render.save_display(render.composite(fg, a, bg), p1, sc)
    d1 = np.asarray(oiio.ImageInput.open(p1).read_image(0, 0, 0, 3, oiio.FLOAT)).reshape(h, w, 3)
    # 2: the cupola as the game draws it: its texture as is
    for o in cup:
        o.hide_render = False
    for o in st:
        o.hide_render = True
    sc.world = None
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.cycles.samples = 16
    fg2, a2 = render.render_fg(sc, ctx.path("__exp_cup.exr"))
    from . import imgio
    d2 = imgio.srgb_encode(np.clip(fg2 / np.maximum(a2[..., None], 1e-4), 0, 1))
    out = d2 * a2[..., None] + d1 * (1 - a2[..., None])
    imgio.write(_out(ctx, 'player_exported'), out)
    log(f"  player_exported -> {_out(ctx, 'player_exported')}")


def render_all(ctx):
    pipeline.open_blend(pipeline.scene_blend(ctx))
    maps = pipeline.load_maps(ctx)
    pv = ctx.preview
    if pv in (None, 'player'):
        player(ctx, maps)
    if pv in (None, 'player', 'calib'):
        calib_overlay(ctx)
    if pv is None or pv.startswith('planet'):
        planet_views(ctx, maps)
    if pv is None or pv.startswith('close'):
        closeups(ctx, maps)
    if pv is None or pv.startswith('overview') or pv in OVERVIEWS:
        overviews(ctx, maps)
    if pv in (None, 'exported'):
        exported_player(ctx, maps)
    if pv in (None, 'player_debris') and os.path.exists(ctx.asset("debris.glb")):
        player_debris(ctx, maps)
    if (pv is None or pv.startswith('debris')) and os.path.exists(ctx.asset("debris.glb")):
        debris(ctx)
    for fname in ('drone.glb', 'derelict.glb', 'extras.glb'):
        stem = fname.split('.')[0]
        if pv is None or pv.startswith(stem):
            asset_shots(ctx, fname)
