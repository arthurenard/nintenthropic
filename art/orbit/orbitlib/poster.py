"""poster.webp: the game's face in the arcade and on shared cards.

The cupola's windows, the planet at sunrise - the sun just clearing the
limb in a band of orange and blue, the ground below still in night with
its cities lit - and a torn panel from the debris field a few metres out,
turned so it throws the sun's glint straight into the eye.

Rendered from the full source scene (not the bake): Cycles for the cupola,
the station and the fragment, the numpy renderer for the planet, composed
in linear light with a soft bloom, then AgX.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import pipeline, render, world, bl, imgio

W, H = 1600, 900
SUN_NDC = (-0.64, 0.43)        # where the sun rises on screen


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
    """Bring a torn slab from the debris build into the scene, a few metres
    out, oriented so its face mirrors the sun into the eye."""
    from . import materials, debris, shapes
    from .bl import rng
    # the opened scene has the station's materials; add the debris ones
    materials.LIB.clear()
    materials.LIB.update({m.name: m for m in bpy.data.materials})
    materials.debris_materials()
    r = rng("poster-fragment")
    bm, mats = debris.shard(rng("shard0"))
    col = bl.collection("poster")
    ob = debris.to_object(bm, "poster.fragment", mats, col)
    bm.free()
    ob.scale = (0.8, 0.8, 0.8)
    pos = Vector(world.view_point(-0.26, 0.5, 9.0))
    to_eye = (Vector(cam_pos) - pos).normalized()
    n = (Vector(sun) + to_eye).normalized()
    # the plate's +Z is its face; tilt it a hair off the perfect mirror so
    # the glint lands on its edge region rather than filling it
    q = n.to_track_quat('Z', 'Y')
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = q @ Matrix.Rotation(math.radians(4), 4, 'X').to_quaternion()
    ob.location = pos
    # a few scraps trailing it
    for i, fn in enumerate((debris.shrapnel_skin, debris.shrapnel_splinter, debris.shrapnel_bracket)):
        bm, mats = fn(rng(f"poster-scrap{i}"))
        s = debris.to_object(bm, f"poster.scrap.{i}", mats, col)
        bm.free()
        s.location = Vector(world.view_point(-0.1 + 0.18 * i, 0.55 - 0.09 * i, 9.0 + 3 * i))
        s.rotation_euler = (r.uniform(0, 6), r.uniform(0, 6), r.uniform(0, 6))
        s.scale = (1.4, 1.4, 1.4)
    return ob


def a_free(a, sx, sy):
    """How clear the view to the sun is (1 when the sun sits behind glass,
    0 behind the frame): the foreground's alpha around the sun."""
    h, w = a.shape
    x, y = int(np.clip(sx, 0, w - 1)), int(np.clip(sy, 0, h - 1))
    win = a[max(0, y - 3):y + 4, max(0, x - 3):x + 4]
    return float(1.0 - win.mean())


def stage(ctx):
    pipeline.open_blend(pipeline.scene_blend(ctx))
    sc = bpy.context.scene
    cam = bpy.data.objects['camera.player']
    sun = Vector(world.view_dir(*SUN_NDC))
    # the sun lamp at the rising sun, a little warmer; the world stays the
    # day environment for the interior bounce, but dimmer (we are near the
    # terminator: most of the planet in view is dark)
    lamp = bpy.data.objects['SunLamp']
    lamp.rotation_euler = sun.to_track_quat('Z', 'Y').to_euler()
    lamp.data.color = (1.0, 0.78, 0.55)
    lamp.data.energy = 14.0
    maps = pipeline.load_maps(ctx)
    sky = pipeline.Sky(sun_world=np.array(sun), star_gain=0.25, night_gain=0.9)
    env = pipeline.render_env(ctx, "env_poster.exr", sky, W=1024, maps=maps, samples=32)
    render.world_env(sc, env, name="PosterEnv")
    fragment(sc, sun, cam.matrix_world.translation)
    q = ctx.quick
    render.cycles(sc, W if not q else 960, H if not q else 540, 64 if q else 640)
    sc.view_settings.exposure = render.EXPOSURE + 1.2
    exr = ctx.path("__poster_fg.exr")
    fg, a = render.render_fg(sc, exr)
    w, h = fg.shape[1], fg.shape[0]
    bg = render.planet_background(ctx, cam, w, h, sky, maps=maps, samples=24 if q else 64)
    rgb = render.composite(fg, a, bg)
    ex = 2 ** (render.EXPOSURE + 1.2)
    # the sun's glare where it stands on screen (only if it shows)
    sx = (SUN_NDC[0] * 0.5 + 0.5) * w
    sy = (0.5 - SUN_NDC[1] * 0.5) * h
    rgb = rgb + glare((h, w), (sx, sy), (1.0, 0.8, 0.6), 2.2 / ex) * a_free(a, sx, sy)
    rgb = bloom(rgb * ex, threshold=0.9) / ex
    out_png = os.path.join(ctx.review_dir, "poster.png")
    render.save_display(rgb, out_png, sc)
    out = ctx.asset("poster.webp")
    render.save_display(rgb, out, sc, quality=90)
    os.remove(exr)
    pipeline.log(f"  poster {out} {os.path.getsize(out) // 1024} KB")
