"""poster.webp: the game's face in the arcade and on shared cards.

The day side under the cupola - the first look's coast, desert, river and
range - in low morning light, with the sun just clearing the limb in the
round window, and a solar-wing shard a few metres out turned to throw the
sun's glint straight into the eye. A sun at the limb would leave the ground
below in night, so the picture is composed from two suns, as a poster may
be: the ground, the station and the fragments are lit by the morning sun
(LIGHT_ELEV above the horizon, ahead and to the left); the sky and the limb
come from a render with the sun at the disc (SUN_NDC), which gives the
sunrise band of orange and blue along the edge of the world.

Rendered from the full source scene (not the bake): Cycles for the cupola,
the station and the fragments, the numpy renderer for the planet, composed
in linear light with a soft bloom, then AgX.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import pipeline, render, world, bl

W, H = 1600, 900
SUN_NDC = (-0.06, 0.36)        # the sun just clearing the limb, inside the round window
LIGHT_ELEV, LIGHT_AZ = 24.0, -32.0   # the morning sun that lights the ground and the station


def bloom(rgb, threshold=1.0, strength=0.12, clamp=30.0):
    """A photographic bloom: the energy above a threshold (clamped, so the
    sun itself does not flood the frame), blurred at three radii by
    repeated box filters (close to Gaussian) and added back."""
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    k = np.clip(lum - threshold, 0, clamp) / np.maximum(lum, 1e-6)
    hi = rgb * k[..., None]
    out = rgb.copy()
    for r, w in ((2, 0.55), (8, 0.3), (28, 0.15)):
        b = hi.copy()
        for _ in range(4):
            b = _box(b, r)
        out += b * (strength * w)
    return out


def glare(shape, centre_px, colour, power):
    """The sun's glare as a lens would draw it: a hot core, a soft halo
    falling off with 1/r^2, and faint rays."""
    h, w = shape
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = x - centre_px[0], y - centre_px[1]
    r2 = dx * dx + dy * dy
    ang = np.arctan2(dy, dx)
    rays = 1 + 0.35 * np.cos(ang * 6) ** 16 + 0.2 * np.cos(ang * 6 + 0.5) ** 32
    halo = power * (1.0 / (1 + r2 / 25.0) + 0.08 / (1 + r2 / 900.0) * rays + 0.02 / (1 + r2 / 40000.0))
    return halo[..., None] * np.asarray(colour, np.float32)


def _box(a, r):
    H_, W_ = a.shape[:2]
    p = np.pad(a, ((r + 1, r), (0, 0), (0, 0)), mode='edge')
    c = np.cumsum(p, 0)
    a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    p = np.pad(a, ((0, 0), (r + 1, r), (0, 0)), mode='edge')
    c = np.cumsum(p, 1)
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def fragment(sc, sun, cam_pos):
    """A solar-wing shard close outside the round window, turned to mirror
    the sun into the eye (a blue-white flash), a torn slab in the upper
    left window, gold foil in the right one, and a few scraps."""
    from . import materials, debris
    from .bl import rng
    materials.LIB.clear()
    materials.LIB.update({m.name: m for m in bpy.data.materials})
    materials.debris_materials()
    col = bl.collection("poster")
    eye = Vector(cam_pos)

    def glint(ob, pos, off_deg=1.2):
        n = (Vector(sun) + (eye - pos).normalized()).normalized()
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = n.to_track_quat('Z', 'Y') @ Matrix.Rotation(math.radians(off_deg), 4, 'X').to_quaternion()
        ob.location = pos
    bm, mats = debris.shard(rng("shard1"))
    ob = debris.to_object(bm, "poster.shard", mats, col)
    bm.free()
    ob.scale = (0.75, 0.75, 0.75)
    glint(ob, Vector(world.view_point(0.16, 0.12, 5.2)))
    bm, mats = debris.slab_isogrid(rng("slab0"))
    sl = debris.to_object(bm, "poster.slab", mats, col)
    bm.free()
    sl.location = Vector(world.view_point(-0.62, 0.42, 16.0))
    sl.rotation_euler = (0.9, 0.4, 2.2)
    for part, fn in (('core', debris.foil_core), ('wrap', debris.foil_wrap)):
        bm, mats = fn(rng("foil0"), 0)
        f = debris.to_object(bm, f"poster.foil.{part}", mats, col)
        bm.free()
        f.location = Vector(world.view_point(0.62, 0.08, 6.0))
        f.rotation_euler = (0.4, 2.2, 0.9)
        f.scale = (1.3, 1.3, 1.3)
    rr = rng("poster-scraps")
    for i, fn in enumerate((debris.shrapnel_skin, debris.shrapnel_splinter, debris.shrapnel_bracket, debris.shrapnel_tube)):
        bm, mats = fn(rng(f"poster-scrap{i}"))
        s = debris.to_object(bm, f"poster.scrap.{i}", mats, col)
        bm.free()
        s.location = Vector(world.view_point(-0.35 + 0.28 * i, 0.2 - 0.15 * (i % 2), 10.0 + 4 * i))
        s.rotation_euler = (rr.uniform(0, 6), rr.uniform(0, 6), rr.uniform(0, 6))
        s.scale = (1.8, 1.8, 1.8)
    for name in ('station.arm', 'secret.arm.hand', 'station.light.5'):
        o = bpy.data.objects.get(name)
        if o:
            o.hide_render = True
    return ob


def a_free(a, sx, sy):
    """How clear the view to the sun is (1 when the sun sits behind glass,
    0 behind the frame): the foreground's alpha around the sun."""
    h, w = a.shape
    x, y = int(np.clip(sx, 0, w - 1)), int(np.clip(sy, 0, h - 1))
    win = a[max(0, y - 3):y + 4, max(0, x - 3):x + 4]
    return float(1.0 - win.mean())


def light_dir():
    up = world.station_up()
    f = world.forward()
    fh = f - up * (f @ up)
    fh /= np.linalg.norm(fh)
    right = np.cross(fh, up)
    e, a = math.radians(LIGHT_ELEV), math.radians(LIGHT_AZ)
    d = (fh * math.cos(a) + right * math.sin(a)) * math.cos(e) + up * math.sin(e)
    return d / np.linalg.norm(d)


def stage(ctx):
    pipeline.open_blend(pipeline.scene_blend(ctx))
    sc = bpy.context.scene
    cam = bpy.data.objects['camera.player']
    light = Vector(light_dir())
    disc = Vector(world.view_dir(*SUN_NDC))
    lamp = bpy.data.objects['SunLamp']
    lamp.rotation_euler = light.to_track_quat('Z', 'Y').to_euler()
    lamp.data.color = (1.0, 0.88, 0.74)
    lamp.data.energy = 20.0
    maps = pipeline.load_maps(ctx)
    sky_a = pipeline.Sky(sun_world=np.array(light), star_gain=0.0, night_gain=0.6)
    sky_b = pipeline.Sky(sun_world=np.array(disc), star_gain=0.3, night_gain=0.6)
    env = pipeline.render_env(ctx, "env_poster.exr", sky_a, W=1024, maps=maps, samples=32)
    render.world_env(sc, env, name="PosterEnv")
    fragment(sc, light, cam.matrix_world.translation)
    q = ctx.quick
    render.cycles(sc, W if not q else 960, H if not q else 540, 64 if q else 640)
    stops = render.EXPOSURE + 0.8
    sc.view_settings.exposure = stops
    exr = ctx.path("__poster_fg.exr")
    fg, a = render.render_fg(sc, exr)
    w, h = fg.shape[1], fg.shape[0]
    # the planet twice: the ground in the morning light, the sky and the
    # limb with the sun at the disc; rays that meet the ground take the first
    ga = render.planet_background(ctx, cam, w, h, sky_a, maps=maps, samples=24 if q else 64)
    gb = render.planet_background(ctx, cam, w, h, sky_b, maps=maps, samples=24 if q else 64)
    D, _ = render.camera_rays(cam, w, h)
    rot = world.planet_rotation()
    Dp = D.astype(np.float64) @ rot
    O = world.eye_in_planet_km(rot)
    b = Dp @ O
    disc_ = b * b - (O @ O - 6371.0 ** 2)
    hit = ((disc_ > 0) & (b < 0)).reshape(h, w)
    # a few pixels of blend across the limb
    from .noise import blur
    wgt = np.clip(blur(hit.astype(np.float32)[..., None], 1, 1)[..., 0] * 1.0, 0, 1)
    bg = ga * wgt[..., None] + gb * (1 - wgt[..., None])
    rgb = render.composite(fg, a, bg)
    ex = 2 ** stops
    sx = (SUN_NDC[0] * 0.5 + 0.5) * w
    sy = (0.5 - SUN_NDC[1] * 0.5) * h
    rgb = rgb + glare((h, w), (sx, sy), (1.0, 0.82, 0.62), 4.0 / ex) * a_free(a, sx, sy)
    rgb = bloom(rgb * ex, threshold=0.85, strength=0.16) / ex
    out_png = os.path.join(ctx.review_dir, "poster.png")
    render.save_display(rgb, out_png, sc)
    out = ctx.asset("poster.webp")
    render.save_display(rgb, out, sc, quality=90)
    os.remove(exr)
    pipeline.log(f"  poster {out} {os.path.getsize(out) // 1024} KB")
