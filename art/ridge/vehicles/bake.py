"""One texture set per vehicle: every part (and the prototype wheel) unwrapped
into one atlas, then the procedural source materials baked into it with Cycles
on the GPU: albedo, roughness and metalness (emission passes), the tangent-
space normal (the materials' bump and bevel normals, which round the edges of
the low-poly boxes), and ambient occlusion (the whole vehicle on a ground
plane, so wheel wells, the cab's inside and the bed under the canvas darken).

Texel density is set per part (the cab outside gets more than its inside or
the chassis) by scaling each part's UVs to its weight before one packing pass.
Coverage is tracked with a sentinel so the gaps between islands can be filled
by dilation (mipmaps then never bleed the background into an island).
"""

import math
import os
import time

import bpy
import numpy as np
from mathutils import Matrix

from .geo import a2b
from . import paint

SENTINEL = -1.0


# ---------------------------------------------------------------------------
# UVs

def _select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def _edit(objs, fn):
    _select_only(objs)
    for o in objs:
        o.data.validate()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        fn()
    finally:
        bpy.ops.object.mode_set(mode='OBJECT')


def atlas_layer(ob):
    me = ob.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    me.uv_layers.active = uvl
    uvl.active_render = True
    return uvl


def uv_np(ob, name):
    me = ob.data
    a = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers[name].data.foreach_get("uv", a)
    return a.reshape(-1, 2)


def uv_set(ob, name, uv):
    ob.data.uv_layers[name].data.foreach_set("uv", np.asarray(uv, np.float32).ravel())


def texel_ratio(ob, name="UVMap"):
    """sqrt(UV area / surface area): the part's current texel scale."""
    me = ob.data
    uv = uv_np(ob, name)
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    tl = tl.reshape(-1, 3)
    tv = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tv)
    tv = tv.reshape(-1, 3)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    a, b, c = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
    a3 = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()
    u, v, w = uv[tl[:, 0]], uv[tl[:, 1]], uv[tl[:, 2]]
    a2 = 0.5 * np.abs((v[:, 0] - u[:, 0]) * (w[:, 1] - u[:, 1]) - (w[:, 0] - u[:, 0]) * (v[:, 1] - u[:, 1])).sum()
    return math.sqrt(a2 / max(a3, 1e-9))


def unwrap_atlas(items, margin, log=print):
    """items: [(object, density, mode)] mode 'smart' or 'grain' (use the
    builder's metre UVs, clean for revolves). Leaves every object's "UVMap"
    packed into one 0..1 atlas at texel densities proportional to `density`."""
    t = time.time()
    smart = []
    for ob, d, mode in items:
        atlas_layer(ob)
        if mode == 'grain':
            uv_set(ob, "UVMap", uv_np(ob, "grain"))
        else:
            smart.append(ob)
    for ob in smart:
        _edit([ob], lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.002,
                                                     area_weight=0.0, correct_aspect=True, scale_to_bounds=False))
    # one texel scale for all, times each part's weight
    for ob, d, mode in items:
        r = texel_ratio(ob)
        uv = uv_np(ob, "UVMap")
        c = uv.mean(0)
        uv_set(ob, "UVMap", (uv - c) * (d / max(r, 1e-9)) * 0.05 + c)
    objs = [ob for ob, _, _ in items]
    _edit(objs, lambda: bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='CARDINAL',
                                                scale=True, merge_overlap=False, margin_method='FRACTION',
                                                margin=margin, shape_method='CONCAVE'))
    log(f"  atlas: {len(objs)} parts unwrapped and packed in {time.time() - t:.1f}s")
    # report the density reached (texels per metre at weight 1)
    return texel_ratio(items[0][0]) / items[0][1]


# ---------------------------------------------------------------------------
# baking

def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != 'CPU'
        sc.cycles.device = 'GPU'
    except Exception as e:  # CPU works, only slower
        print("cycles: no GPU", e)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 2
    sc.render.bake.margin_type = 'EXTEND'


def float_image(name, size, fill):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    px = np.empty((size * size, 4), np.float32)
    px[:] = fill
    img.pixels.foreach_set(px.ravel())
    return img


def image_np(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def bake_pass(objs, kind, samples, img):
    """Bake one channel of every selected object into img."""
    sc = bpy.context.scene
    sc.cycles.samples = samples
    paint.target(img)
    paint.route_all(kind)
    _select_only(objs)
    btype = {"albedo": 'EMIT', "rough": 'EMIT', "metal": 'EMIT', "normal": 'NORMAL', "ao": 'AO'}[kind]
    bpy.ops.object.bake(type=btype, margin=2, margin_type='EXTEND', use_clear=False, target='IMAGE_TEXTURES',
                        normal_space='TANGENT', use_selected_to_active=False)


def dilate(arrs, known, iters=24):
    """Grow known texels outward (average of known 4-neighbours) so filtering
    and mipmaps never reach the empty atlas; what is still unknown after
    `iters` passes takes the channel's mean."""
    known = known.copy()
    for _ in range(iters):
        if known.all():
            break
        cnt = np.zeros(known.shape, np.float32)
        accs = [np.zeros_like(a) for a in arrs]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            cnt += k
            for acc, a in zip(accs, arrs):
                acc += np.roll(a, (dy, dx), (0, 1)) * k[..., None]
        grow = (~known) & (cnt > 0)
        for acc, a in zip(accs, arrs):
            a[grow] = acc[grow] / cnt[grow][:, None]
        known |= grow
    for a in arrs:
        a[~known] = a[known].mean(0)
    return arrs


def srgb_encode(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def byte_image(name, arr, srgb):
    size = arr.shape[0]
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    rgb = srgb_encode(arr) if srgb else np.clip(arr, 0, 1)
    rgba = np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float32)], 2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    return img


def occluders(v, proto, col):
    """Stand-ins for the wheels (and the spare) at their places, so the body's
    AO and cavity grime see them; removed after the bake."""
    out = []
    for w in v.wheels:
        ob = bpy.data.objects.new(f"occ.{v.name}.{w['n']}", proto.data)
        col.objects.link(ob)
        ob.location = a2b(w["pos"])
        out.append(ob)
        if w["dual"]:
            for s in (-1, 1):
                o2 = bpy.data.objects.new(f"occ.{v.name}.{w['n']}.{s}", proto.data)
                col.objects.link(o2)
                o2.location = a2b(w["pos"])
                o2.location.x += s * w["dual"]
                out.append(o2)
            bpy.data.objects.remove(ob)
            out.remove(ob)
    for pos, axle in v.spares:
        ob = bpy.data.objects.new(f"occ.{v.name}.spare", proto.data)
        col.objects.link(ob)
        yaw = math.atan2(axle[1], axle[0])
        ob.matrix_world = Matrix.Translation(a2b(pos)) @ Matrix.Rotation(math.pi + yaw, 4, 'Z')
        out.append(ob)
    g = bpy.data.meshes.new("occ.ground")
    s = 30.0
    g.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    gob = bpy.data.objects.new("occ.ground", g)
    col.objects.link(gob)
    gob.data.materials.append(paint.ground_material())
    out.append(gob)
    return out


def bake_vehicle(v, parts, proto, work, quick=False, log=print):
    size = v.atlas // (4 if quick else 1)
    col = bpy.context.scene.collection
    # every part keeps the builder's own metre UVs (clean strips for sweeps,
    # lofts and revolves; one island per box face), scaled and packed here
    items = [(ob, d, 'grain') for ob, _, d in parts] + [(proto, 1.25, 'grain')]
    margin = 0.0025 if size >= 2048 else 0.004
    unwrap_atlas(items, margin, log)
    setup_cycles(16)
    wset = bpy.context.scene.world or bpy.data.worlds.new("bake")
    bpy.context.scene.world = wset
    wset.light_settings.distance = 0.6 if v.name == "truck" else 0.4
    # only this vehicle takes part: hide every other object from rendering
    mine = set(ob for ob, _, _ in parts) | {proto}
    hidden = []
    for ob in bpy.context.scene.objects:
        if ob not in mine and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    occ = occluders(v, proto, col)
    fills = {"albedo": (SENTINEL, 0, 0, 1), "rough": (SENTINEL, 0, 0, 1), "metal": (SENTINEL, 0, 0, 1),
             "normal": (SENTINEL, 0, 0, 1), "ao": (SENTINEL, 0, 0, 1)}
    imgs = {k: float_image(f"{v.name}_bake_{k}", size, f) for k, f in fills.items()}
    samples = {"albedo": 8 if quick else 24, "rough": 8 if quick else 16, "metal": 4 if quick else 8,
               "normal": 8 if quick else 24, "ao": 32 if quick else 128}
    body = [ob for ob, _, _ in parts]
    for kind in ("albedo", "rough", "metal", "normal", "ao"):
        t = time.time()
        # the body with its wheels in place and the ground under it...
        proto.hide_render = True
        for o in occ:
            o.hide_render = False
        bake_pass(body, kind, samples[kind], imgs[kind])
        # ...then the prototype wheel alone at the origin (it spins: no ground)
        proto.hide_render = False
        for o in body + occ:
            o.hide_render = True
        bake_pass([proto], kind, samples[kind], imgs[kind])
        for o in body:
            o.hide_render = False
        log(f"  {v.name} {kind}: {time.time() - t:.1f}s")
    for o in occ:
        bpy.data.objects.remove(o)
    for ob in hidden:
        ob.hide_render = False
    # post: coverage, dilation, ORM packing, images
    t = time.time()
    A = {k: image_np(img)[..., :3].copy() for k, img in imgs.items()}
    known = A["albedo"][..., 0] > SENTINEL * 0.5
    alb, nrm, rgh, met, ao = dilate([A["albedo"], A["normal"], A["rough"], A["metal"], A["ao"]], known)
    n = nrm * 2 - 1                                   # dilation averaged vectors: renormalise
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    nrm = n * 0.5 + 0.5
    orm = np.stack([ao[..., 0], rgh[..., 0], met[..., 0]], 2)
    out = {
        "albedo": byte_image(f"{v.name}_albedo", alb, True),
        "normal": byte_image(f"{v.name}_normal", np.clip(nrm, 0, 1), False),
        "orm": byte_image(f"{v.name}_orm", orm, False),
    }
    os.makedirs(work, exist_ok=True)
    for k, img in out.items():
        img.filepath_raw = os.path.join(work, f"{v.name}_{k}.png")
        img.file_format = 'PNG'
        img.save()
        img.pack()
    for img in imgs.values():
        bpy.data.images.remove(img)
    log(f"  {v.name}: atlas {size}px, coverage {known.mean() * 100:.0f}%, post {time.time() - t:.1f}s")
    v.images = out
    return out
