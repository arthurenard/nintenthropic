"""poster.webp - the game's face on the landing page (1600 x 900): the Valle
Serra at dawn and the scope on it.

Two Cycles renders. Behind: the player's valley at a moderate zoom - the
lit peaks and the far wall filling the top, the forest's blue shadow, the
village and the river's mist below - softly out of focus, as it is to an
eye at the scope. In front: the scope's round field (6x) on the bridge,
with the chapel above it, mist on the water and a soldier at the bridge's
near end, a cyclist crossing; the tube's dark ring round the glass, and a
fine reticle.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import layout as L
from . import scene as S
from . import noise as N
from . import post


def log(*a):
    print("[poster]", *a, flush=True)


def _camera(name, bearing, pitch, vfov):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(vfov)
    cd.clip_start = 0.3
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(cam)
    b, p = math.radians(bearing), math.radians(pitch)
    fwd = Vector((math.sin(b) * math.cos(p), math.cos(b) * math.cos(p), math.sin(p)))
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    return cam


def _people(ctx):
    """A soldier at the bridge's near end, a cyclist on the deck."""
    from .review import import_people, place_group, node_pos
    got = import_people(ctx.assets)
    p = node_pos("post.bridge_near")
    if "soldier" in got and p:
        place_group(got["soldier"], p, math.atan2(-p[0], p[1]) + math.pi + 0.5,
                    show=["var.helmet", "var.pack", "gun.rifle"], action="idle")
    if "civilian" in got:
        c = np.asarray(L.BRIDGE_C) + np.asarray(L.bridge_axis()) * 6.0
        place_group(got["civilian"], (float(c[0]), float(c[1]), L.BRIDGE_DECK_Z + 0.05),
                    math.atan2(-L.bridge_axis()[0], L.bridge_axis()[1]),
                    show=["var.person.cyclist", "bicycle"], action="cycle", frame=8)
    return got


def render(ctx):
    sc = bpy.context.scene
    S.apply_lighting(sc)
    W, H = 1600, 900
    ss = 1 if ctx.quick else 2
    spp = 48 if ctx.quick else 320
    # behind: the valley, pitched up so the summits sit under the top edge
    _camera("poster.wide", -1.0, 5.5, 36.0)
    S.render_settings(sc, W * ss, H * ss, spp)
    sc.cycles.adaptive_threshold = 0.01
    bg, _ = post.render_with_fog(sc, os.path.join(ctx.build, "poster_wide.png"))
    log("valley rendered")
    # the scope: 6x on the bridge and the chapel above it
    _people(ctx)
    R = int(round(0.41 * H * ss))
    bb, _ = L.bearing_range(np.array([*L.BRIDGE_C, 0.0]))
    _camera("poster.scope", bb - 0.6, -7.0, L.VFOV_DEG / 6.0)
    S.render_settings(sc, 2 * R, 2 * R, spp)
    sc.cycles.adaptive_threshold = 0.01
    sco, _ = post.render_with_fog(sc, os.path.join(ctx.build, "poster_scope.png"), adapt=True)
    # the eye at the scope adapts to the shaded valley
    base = sc.view_settings.exposure
    sco = sco * 2.0 ** min(post.adapted_exposure(sco, base) - base, 1.5)
    log("scope rendered")
    img = compose(bg, sco, (0.64 * W * ss, 0.53 * H * ss), R, ss)
    if ss > 1:
        img = img.reshape(H, ss, W, ss, 3).mean((1, 3))
    out = os.path.join(ctx.assets, "poster.webp")
    post.save_display(img, out, sc, fmt='WEBP', quality=90)
    log("wrote", out, os.path.getsize(out) // 1024, "KB")


def compose(bg, sco, ctr, R, ss):
    """The scope's glass over the valley: the valley softened and darkened
    toward the tube, the glass's own falloff, a fine reticle with mil
    marks and heavier posts."""
    h, w = bg.shape[:2]
    cx, cy = ctr
    soft = np.stack([N.box_blur(N.box_blur(bg[..., k], 2 * ss), 2 * ss) for k in range(3)], -1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot(xx - cx, yy - cy)
    # the glass: the scope render placed at the centre
    ix = np.clip((xx - cx + R).astype(int), 0, 2 * R - 1)
    iy = np.clip((yy - cy + R).astype(int), 0, 2 * R - 1)
    glass = sco[iy, ix] * (1 - 0.30 * np.clip(r / R, 0, 1) ** 4)[..., None]
    inside = np.clip((R - r) / (1.5 * ss), 0, 1)[..., None]
    # outside: the eyepiece's rubber and the tube's shadow fade out to the valley
    ring = np.clip((r - R) / (R * 0.75), 0, 1)[..., None]
    outside = soft * (0.06 + 0.94 * ring ** 1.6)
    out = glass * inside + outside * (1 - inside)
    # the reticle
    lw = 1.0 * ss
    col = np.array([0.01, 0.01, 0.01])
    dx, dy = np.abs(xx - cx), np.abs(yy - cy)
    thin = ((dx < lw * 0.6) | (dy < lw * 0.6)) & (r < R)
    posts = (((dx < lw * 2.8) & (dy > R * 0.5)) | ((dy < lw * 2.8) & (dx > R * 0.5))) & (r < R)
    mil = R / 12.0
    ticks = np.zeros_like(thin)
    for i in range(1, 6):
        ticks |= (np.abs(dy - i * mil) < lw * 0.6) & (dx < R * 0.025) & (yy > cy)
        ticks |= (np.abs(dx - i * mil) < lw * 0.6) & (dy < R * 0.025)
    m = (thin | posts | ticks)[..., None]
    return np.where(m, col, out)
