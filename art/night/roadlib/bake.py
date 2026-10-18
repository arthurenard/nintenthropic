"""Bake the night into per-group atlases, in three layers.

High Noon baked one picture per texel (what Cycles showed from the eye, haze
included) onto unlit materials. Dead of Night's flashlight must add light at
runtime, and its streetlight flickers, so each group gets:

  lit     albedo x (moon + sky + the steady practical lights, direct and
          bounced), contact occlusion, the glossy reflections as the player's
          eye sees them (the sodium lamp and the moon in the wet road), and the
          lamps' own glow. No fog: the game draws it. Graded, through AgX,
          display-referred sRGB - shown as is, it looks like the Cycles render.
  albedo  the surfaces' own colour (sRGB), for the game's albedo x beam.
  orm     R: the streetlight's flicker mask - the fraction of the displayed
             `lit` that is the streetlight's (1 - lum(lit without it) /
             lum(lit)), which export.py turns into the game's flicker maps.
          G: roughness (baked, but not shipped: the export reads R only)
          B: 0 (nothing on Route 9 is bare polished metal)
          at half resolution, in art/night/build/ only.

UV layout follows High Noon's (dustcreek.bake, reused): the ground uses a
camera-projection layout (texel density = screen density from the eye,
which never moves); everything else is Smart UV islands scaled by their
on-screen density (1/distance, visibility ray-cast) and shelf-packed.

The corn is baked to vertex colours instead (see corn.py).
"""

import os
import time

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

from .common import setup_gpu
from . import pipeline, world

from dustcreek import bake as DB      # read-only reuse: projective UVs, island packing, OIDN

ATLAS = {
    'ground': (4096, 2048),
    'near': (4096, 4096),       # the barricade, the pump, the truck: 1-8 m from the eye
    'station': (2048, 2048),
    'west': (2048, 2048),
    'east': (2048, 2048),
    'far': (2048, 2048),
    'trees': (1024, 1024),
}
KEEP_PREFIX = ('secret.', 'corn', 'moon.', 'camera.', 'calib.', 'lane.', 'spawn.', 'barricade.', 'light.', 'ground')
STREET_REACH = {'ground', 'near', 'station', 'west', 'east', 'far'}   # groups the sodium light reaches


def is_static(ob):
    if ob.type != 'MESH' or ob.get('export', 1) == 0:
        return False
    return ob.get('group') in ATLAS


def join_groups(scene):
    by_key = {}
    for ob in list(scene.objects):
        if not is_static(ob) or ob.name.startswith(KEEP_PREFIX):
            continue
        by_key.setdefault((ob['group'], ob.get('surface', 'wood')), []).append(ob)
    for (g, s), obs in sorted(by_key.items()):
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = f"static.{g}.{s}"
        ob.data.name = ob.name
        for k in list(ob.keys()):
            if k not in ('group', 'surface', 'no_occlude'):
                del ob[k]
        ob['group'] = g
        ob['surface'] = s
    # MeshBuilder writes every face with its own vertices; welded, a box or a
    # pine's skirt unwraps as a few islands instead of one per face
    import bmesh
    for ob in scene.objects:
        if is_static(ob) and ob.name != 'ground':
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
            bm.to_mesh(ob.data)
            bm.free()


def occluder_bvh(scene):
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in scene.objects:
        if not is_static(ob) or ob.get('no_occlude'):
            continue
        me = ob.evaluated_get(dg).to_mesh()
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in me.vertices)
        polys.extend([base + i for i in p.vertices] for p in me.polygons)
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


# ---------------------------------------------------------------------------
# Passes

def lights_on(scene, street=True, others=True):
    """Switch the practical lights. The streetlight's refractor glows with
    it (its emission goes dark too), so the flicker mask covers the lamp."""
    for ob in scene.objects:
        if ob.type == 'LIGHT':
            is_street = bool(ob.get('flicker'))
            ob.hide_render = not (street if is_street else others)
    m = bpy.data.materials.get('sodium_lens')
    if m is not None:
        for n in m.node_tree.nodes:
            if n.type == 'EMISSION':
                if 'lit_strength' not in m:
                    m['lit_strength'] = n.inputs['Strength'].default_value
                n.inputs['Strength'].default_value = m['lit_strength'] if street else 0.0


def bake_group(ctx, scene, group, objs, size):
    q = ctx.quick
    s_irr = 40 if q else 512
    s_gl = 16 if q else 160
    t0 = time.time()
    alb = DB.bake_pass(scene, objs, size, 'DIFFUSE_COLOR', 4 if q else 16, f"{group}_albedo")
    rough = DB.bake_pass(scene, objs, size, 'ROUGHNESS', 1 if q else 4, f"{group}_rough")
    lights_on(scene, True, True)
    irr = DB.denoise(DB.bake_pass(scene, objs, size, 'IRRADIANCE', s_irr, f"{group}_irr"))
    gl = DB.denoise(DB.bake_pass(scene, objs, size, 'GLOSSY', s_gl, f"{group}_gloss"))
    ao = DB.bake_pass(scene, objs, size, 'AO', 8 if q else 32, f"{group}_ao")
    em = DB.bake_pass(scene, objs, size, 'EMIT', 1, f"{group}_emit")
    occ = 0.6 + 0.4 * np.clip(ao, 0, 1)
    lit = alb * irr * occ + np.clip(gl, 0, None) + np.clip(em, 0, None)
    lit_d = world.grade(lit)
    if group in STREET_REACH:
        lights_on(scene, False, True)
        irr_w = DB.denoise(DB.bake_pass(scene, objs, size, 'IRRADIANCE', max(8, s_irr // 2), f"{group}_irr_wo"))
        gl_w = DB.denoise(DB.bake_pass(scene, objs, size, 'GLOSSY', max(8, s_gl // 2), f"{group}_gloss_wo"))
        em_w = DB.bake_pass(scene, objs, size, 'EMIT', 1, f"{group}_emit_wo") if group == 'station' else em
        lights_on(scene, True, True)
        wo = alb * irr_w * occ + np.clip(gl_w, 0, None) + np.clip(em_w, 0, None)
        wo_d = world.grade(wo)
    else:
        wo_d = lit_d
    save_layers(ctx, scene, group, lit_d, wo_d, alb, rough)
    print(f"  {group}: baked in {time.time() - t0:.0f}s", flush=True)


def to_display(rgb, scene):
    """Scene-linear -> the view transform's display values (0..1), via a
    round trip through an 8-bit PNG written exactly as a render would be."""
    from .post import save_display
    path = os.path.join(bpy.app.tempdir or "/tmp", "__disp.png")
    save_display(rgb, path, scene, fmt='PNG', flip=False)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    h, w = rgb.shape[:2]
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[..., :3]


def save_png(arr, path, srgb_encode=False, size=None):
    """Write an (H, W, 3) 0..1 array (rows bottom-up, as Blender pixels) to PNG."""
    a = np.clip(arr, 0, 1)
    if srgb_encode:
        a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    h, w = a.shape[:2]
    img = bpy.data.images.new("__save", w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = a
    img.pixels.foreach_set(px.ravel())
    if size is not None and (size[0] != w or size[1] != h):
        img.scale(size[0], size[1])
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def lum(a):
    return a @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def save_layers(ctx, scene, group, lit_d, wo_d, alb, rough):
    disp = to_display(lit_d, scene)
    save_png(disp, os.path.join(ctx.build, f"atlas_{group}_lit.png"))
    if wo_d is lit_d:
        mask = np.zeros(disp.shape[:2], np.float32)
    else:
        dw = to_display(wo_d, scene)
        mask = np.clip(1.0 - lum(dw) / np.maximum(lum(disp), 1e-3), 0.0, 1.0)
        mask[lum(disp) < 0.004] = 0.0
    save_png(alb, os.path.join(ctx.build, f"atlas_{group}_albedo.png"), srgb_encode=True)
    orm = np.stack([mask, np.clip(rough[..., 0], 0, 1), np.zeros_like(mask)], -1)
    h, w = orm.shape[:2]
    save_png(orm, os.path.join(ctx.build, f"atlas_{group}_orm.png"), size=(w // 2, h // 2))
    np.save(os.path.join(ctx.build, f"atlas_{group}_litlin.npy"), lit_d.astype(np.float16))


# ---------------------------------------------------------------------------
# The corn: vertex colours

def bake_corn(ctx, scene):
    corn = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('corn.')]
    if not corn:
        return
    q = ctx.quick
    t0 = time.time()
    b = scene.render.bake
    b.target = 'VERTEX_COLORS'

    def vpass(kind, samples, name):
        for ob in corn:
            me = ob.data
            a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
            me.color_attributes.active_color = a
        bpy.ops.object.select_all(action='DESELECT')
        for ob in corn:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = corn[0]
        scene.cycles.samples = samples
        kw = dict(target='VERTEX_COLORS')
        if kind == 'IRRADIANCE':
            kw.update(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
        elif kind == 'GLOSSY':
            kw.update(type='GLOSSY', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'})
            b.view_from = 'ACTIVE_CAMERA'
        elif kind == 'TRANSMISSION':
            kw.update(type='TRANSMISSION', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'})
        bpy.ops.object.bake(**kw)
        b.view_from = 'ABOVE_SURFACE'
        out = []
        for ob in corn:
            a = ob.data.color_attributes[name]
            c = np.empty(len(a.data) * 4, np.float32)
            a.data.foreach_get('color', c)
            out.append(c.reshape(-1, 4)[:, :3])
        return out
    lights_on(scene, True, True)
    irr = vpass('IRRADIANCE', 48 if q else 384, 'bk_irr')
    gl = vpass('GLOSSY', 16 if q else 96, 'bk_gl')
    tr = vpass('TRANSMISSION', 16 if q else 128, 'bk_tr')
    lights_on(scene, False, True)
    irr_w = vpass('IRRADIANCE', 24 if q else 192, 'bk_irr_wo')
    gl_w = vpass('GLOSSY', 8 if q else 48, 'bk_gl_wo')
    lights_on(scene, True, True)
    b.target = 'IMAGE_TEXTURES'
    for i, ob in enumerate(corn):
        me = ob.data
        a = me.color_attributes['albedo']
        alb = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', alb)
        alb = alb.reshape(-1, 4)[:, :3]
        lit = alb * irr[i] * 0.72 + np.clip(gl[i], 0, None) + np.clip(tr[i], 0, None)
        wo = alb * irr_w[i] * 0.72 + np.clip(gl_w[i], 0, None) + np.clip(tr[i], 0, None) * 0.9
        d = to_display(world.grade(lit)[None, :, :], scene)[0]
        dw = to_display(world.grade(wo)[None, :, :], scene)[0]
        mask = np.clip(1.0 - lum(dw) / np.maximum(lum(d), 1e-3), 0, 1)
        # display values -> linear (glTF vertex colours are linear; the game's
        # sRGB output turns them back into exactly these display values)
        lin = np.where(d <= 0.04045, d / 12.92, ((d + 0.055) / 1.055) ** 2.4)
        C = np.ones((len(lin), 4), np.float32)
        C[:, :3] = lin
        C[:, 3] = 1.0
        la = me.color_attributes.get('lit') or me.color_attributes.new('lit', 'FLOAT_COLOR', 'POINT')
        la.data.foreach_set('color', C.ravel())
        fm = me.attributes.get('flicker') or me.attributes.new('flicker', 'FLOAT', 'POINT')
        fm.data.foreach_set('value', mask.astype(np.float32))
        for n in ('bk_irr', 'bk_gl', 'bk_tr', 'bk_irr_wo', 'bk_gl_wo'):
            me.color_attributes.remove(me.color_attributes[n])
    print(f"  corn: vertex colours baked in {time.time() - t0:.0f}s", flush=True)


# ---------------------------------------------------------------------------

def stage(ctx):
    pipeline.open_blend(ctx.blend)
    scene = bpy.context.scene
    setup_gpu(scene)
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.sample_clamp_indirect = 6.0
    try:
        scene.world.light_settings.distance = 0.5
    except AttributeError:
        pass
    scene.camera = bpy.data.objects['camera.player']
    scene.view_settings.view_transform = world.VIEW_TRANSFORM
    scene.view_settings.look = world.LOOK
    t = time.time()
    join_groups(scene)
    print(f"joined in {time.time() - t:.1f}s")
    bvh = occluder_bvh(scene)
    ground = bpy.data.objects['ground']
    gb = BVHTree.FromObject(ground, bpy.context.evaluated_depsgraph_get())
    DB.projective_uv(ground, gb)
    groups = {}
    for ob in scene.objects:
        if is_static(ob):
            groups.setdefault(ob['group'], []).append(ob)
    for g, objs in groups.items():
        if g == 'ground':
            continue
        t = time.time()
        print(f"UV {g}: {len(objs)} objects")
        DB.unwrap_group(scene, objs, bvh, ATLAS[g])
        print(f"  unwrap {g} in {time.time() - t:.1f}s")
    for g, objs in groups.items():
        if ctx.preview and g not in ctx.preview.split(','):
            continue
        print(f"BAKE {g}: {len(objs)} objects", flush=True)
        bake_group(ctx, scene, g, objs, ATLAS[g])
    if not ctx.preview or 'corn' in ctx.preview.split(','):
        bake_corn(ctx, scene)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.baked_blend, compress=True)
