"""poster.webp - the game's face on the landing page (1600 x 900): the Valle
Serra at dawn seen through the edge of the scope. A Cycles render at a
moderate zoom that holds the chapel, the bridge, the mist lying on the
river and the peaks lit gold; then the scope: its round field of view to
the right of centre, the dark of the tube round it (with a little of the
unmagnified valley bleeding past the rim, softly out of focus), and a fine
reticle - the view the game is about.
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
    print("[poster]", *a, flush=True)


def render(ctx):
    sc = bpy.context.scene
    S.apply_lighting(sc)
    W, H = 1600, 900
    ss = 1 if ctx.quick else 2
    # the frame: the river and the bridge low, the village and its chapel
    # above them, the far wall and the lit peaks filling the top; yaw toward
    # the chapel, pitched up so the summits (+17-20 deg) sit under the top edge
    vfov = 30.0
    b, _ = L.bearing_range(np.array([*L.CHAPEL_C, 0.0]))
    pitch = 5.5
    cd = bpy.data.cameras.new("poster")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(vfov)
    cd.clip_start = 0.5
    cd.clip_end = 20000.0
    cam = bpy.data.objects.new("poster", cd)
    sc.collection.objects.link(cam)
    fwd = Vector((math.sin(math.radians(b + 1.5)) * math.cos(math.radians(pitch)),
                  math.cos(math.radians(b + 1.5)) * math.cos(math.radians(pitch)), math.sin(math.radians(pitch))))
    cam.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    S.render_settings(sc, W * ss, H * ss, 48 if ctx.quick else 384)
    sc.cycles.adaptive_threshold = 0.008
    rgb, P = post.render_with_fog(sc, os.path.join(ctx.build, "poster_render.png"))
    # the scope sits on the chapel's tower: where does it project?
    tw = bpy.data.objects.get("sniper.1")
    ctr = None
    if tw is not None:
        from bpy_extras.object_utils import world_to_camera_view
        co = world_to_camera_view(sc, cam, tw.matrix_world.translation + Vector((0, 0, -6.0)))
        ctr = (co.x * W * ss, (1 - co.y) * H * ss)
    img = scope_overlay(rgb, ss, ctr)
    if ss > 1:
        img = img.reshape(H, ss, W, ss, 3).mean((1, 3))
    out = os.path.join(ctx.assets, "poster.webp")
    post.save_display(img, out, sc, fmt='WEBP', quality=90)
    log("wrote", out, os.path.getsize(out) // 1024, "KB")


def scope_overlay(rgb, ss, ctr=None):
    """The scope's field: a disc magnifying what is under it (x2.4 more, a
    crisp circle) set on the chapel, the tube's dark round it fading to the
    unmagnified picture at the frame's edges, and a fine reticle."""
    h, w = rgb.shape[:2]
    cx, cy = ctr if ctr is not None else (w * 0.60, h * 0.60)
    cx = min(max(cx, h * 0.34), w - h * 0.34)
    cy = min(max(cy, h * 0.34), h - h * 0.30)
    R = h * 0.30
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.hypot(xx - cx, yy - cy)
    # magnified field inside the disc
    k = 2.4
    sx = cx + (xx - cx) / k
    sy = cy + (yy - cy) / k
    ix = np.clip(sx.astype(int), 0, w - 1)
    iy = np.clip(sy.astype(int), 0, h - 1)
    mag = rgb[iy, ix]
    inside = np.clip((R - r) / (2.0 * ss), 0, 1)[..., None]
    # lens falloff inside the glass, the tube's dark ring outside
    fall = 1 - 0.28 * np.clip(r / R, 0, 1)[..., None] ** 3
    ring = np.clip((r - R) / (R * 0.55), 0, 1)[..., None]
    outside = rgb * (0.10 + 0.55 * ring ** 1.5)
    out = mag * fall * inside + outside * (1 - inside)
    # the reticle: a fine cross with mil marks, thicker posts at the edges
    lw = 1.0 * ss
    col = np.array([0.02, 0.02, 0.02])
    dx, dy = np.abs(xx - cx), np.abs(yy - cy)
    thin = ((dx < lw * 0.6) | (dy < lw * 0.6)) & (r < R)
    post_ = (((dx < lw * 2.5) & (dy > R * 0.55)) | ((dy < lw * 2.5) & (dx > R * 0.55))) & (r < R)
    mil = R / 12.0
    ticks = np.zeros_like(thin)
    for i in range(1, 6):
        ticks |= (np.abs(dy - i * mil) < lw * 0.6) & (dx < R * 0.03) & (yy > cy)
        ticks |= (np.abs(dx - i * mil) < lw * 0.6) & (dy < R * 0.03)
    m = (thin | post_ | ticks)[..., None]
    out = np.where(m, col, out)
    return out
