"""poster.webp - the game's face on the landing page (1600 x 900).

The scope fills the right of the frame: through it, at 20x, the checkpoint
at dawn - an officer at the barrier glassing the ridge with his binoculars,
the reticle's cross on his chest, a sentry smoking by the hut, the
watchtower, the river's mist behind. Round it the tube's dark rim, and
to the left the valley the scope was lifted from: the Punta Serra lit gold
and pink over the forest's blue shadow, softly out of focus as it is to
an eye at the glass.

Two Cycles renders: the valley (wide), the scope's view (square); composed
in numpy, graded like the review renders.
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


def _import(path, tag):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o)
    new = [o for o in bpy.data.objects if o not in before]
    col = S.collection(f"poster_{tag}")
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    return new


def _people(ctx):
    """The officer at the barrier, the sentry by the hut; returns the point
    the reticle sits on (the officer's chest)."""
    from .review import place_group, node_pos
    sp = os.path.join(ctx.assets, "soldier.glb")
    target = None
    p = node_pos("post.cp_barrier")
    if not (os.path.exists(sp) and p):
        return None
    officer = _import(sp, "officer")
    face = math.atan2(-p[0], p[1]) + math.pi          # toward the eye (review.place_group's convention)
    place_group(officer, p, face + 0.25, show=["var.cap.officer", "var.coat.officer", "prop.binoculars"],
                action="look_binoculars", frame=70)
    target = (p[0], p[1], p[2] + 1.25)
    # the sentry beside him, over the barrier's pole, a cigarette at his lips
    e = np.array([-p[1], p[0]]) / math.hypot(p[0], p[1])       # to the right as the eye sees it
    q = (p[0] - e[0] * 3.2 + p[0] / math.hypot(p[0], p[1]) * 1.5, p[1] - e[1] * 3.2 + p[1] / math.hypot(p[0], p[1]) * 1.5, p[2])
    sentry = _import(sp, "sentry")
    place_group(sentry, q, face - 0.9, show=["var.helmet", "var.pack", "gun.rifle.slung", "prop.cigarette"],
                action="idle_smoke", frame=45)
    return target


def render(ctx):
    sc = bpy.context.scene
    S.apply_lighting(sc)
    W, H = 1600, 900
    ss = 1 if ctx.quick else 2
    spp = 48 if ctx.quick else 320
    # behind: the valley, the Punta Serra in the left quarter
    _camera("poster.wide", 13.0, 5.5, 36.0)
    S.render_settings(sc, W * ss, H * ss, spp)
    sc.cycles.adaptive_threshold = 0.01
    bg, _ = post.render_with_fog(sc, os.path.join(ctx.build, "poster_wide.png"))
    log("valley rendered")
    # the scope: 20x on the officer at the checkpoint (the game's is 6x; the
    # poster leans in so the figure reads at a thumbnail's size)
    tgt = _people(ctx)
    if tgt is None:
        tgt = (L.CHECKPOINT_C[0], L.CHECKPOINT_C[1], -57.5)
    R = int(round(0.47 * H * ss))
    b, rng_ = L.bearing_range(np.array(tgt))
    el = math.degrees(math.atan2(tgt[2], rng_))
    _camera("poster.scope", b, el, L.VFOV_DEG / 20.0)
    S.render_settings(sc, 2 * R, 2 * R, spp)
    sc.cycles.adaptive_threshold = 0.01
    sco, _ = post.render_with_fog(sc, os.path.join(ctx.build, "poster_scope.png"))
    # the eye at the glass adapts to the shaded valley floor
    base = sc.view_settings.exposure
    sco = sco * 2.0 ** min(post.adapted_exposure(sco, base) - base, 1.8)
    log("scope rendered")
    img = compose(bg, sco, (0.62 * W * ss, 0.5 * H * ss), R, ss)
    if ss > 1:
        img = img.reshape(H, ss, W, ss, 3).mean((1, 3))
    out = os.path.join(ctx.assets, "poster.webp")
    post.save_display(img, out, sc, fmt='WEBP', quality=92)
    log("wrote", out, os.path.getsize(out) // 1024, "KB")


def compose(bg, sco, ctr, R, ss):
    """The scope's glass over the valley: the valley softened and darkened
    toward the tube, the glass's own falloff and a faint cool edge, a fine
    reticle with mil marks and heavier posts."""
    h, w = bg.shape[:2]
    cx, cy = ctr
    soft = np.stack([N.box_blur(N.box_blur(bg[..., k], 3 * ss), 3 * ss) for k in range(3)], -1)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot(xx - cx, yy - cy)
    ix = np.clip((xx - cx + R).astype(int), 0, 2 * R - 1)
    iy = np.clip((yy - cy + R).astype(int), 0, 2 * R - 1)
    glass = sco[iy, ix] * (1 - 0.32 * np.clip(r / R, 0, 1) ** 4)[..., None]
    rim = np.clip((r - R * 0.965) / (R * 0.035), 0, 1)[..., None]
    glass = glass * (1 - 0.5 * rim) + np.array([0.02, 0.025, 0.03]) * 0.5 * rim
    inside = np.clip((R - r) / (1.5 * ss), 0, 1)[..., None]
    ring = np.clip((r - R) / (R * 0.9), 0, 1)[..., None]
    outside = soft * (0.03 + 0.97 * ring ** 1.8)
    out = glass * inside + outside * (1 - inside)
    lw = 1.0 * ss
    col = np.array([0.008, 0.008, 0.008])
    dx, dy = np.abs(xx - cx), np.abs(yy - cy)
    thin = ((dx < lw * 0.55) | (dy < lw * 0.55)) & (r < R)
    posts = (((dx < lw * 3.0) & (dy > R * 0.45)) | ((dy < lw * 3.0) & (dx > R * 0.45))) & (r < R)
    mil = R / 11.0
    ticks = np.zeros_like(thin)
    for i in range(1, 5):
        ticks |= (np.abs(dy - i * mil) < lw * 0.55) & (dx < R * 0.022)
        ticks |= (np.abs(dx - i * mil) < lw * 0.55) & (dy < R * 0.022)
    m = (thin | posts | ticks)[..., None]
    return np.where(m, col, out)
