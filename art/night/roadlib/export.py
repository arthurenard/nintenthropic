"""Export road.glb: the baked layers the way the game reads them
(src/games/night/world/stage.ts), the corn with its vertex layers, the
contract nodes with their extras, Draco geometry and WebP textures.

How the layers travel (see art/night/README.md):

  every baked material (`night.<group>.<surface>`) is UNLIT
  (KHR_materials_unlit): its baseColorTexture is `lit` (display-referred
  sRGB: the night as it should look, no tone mapping), and its extras name
  the files beside road.glb that carry the rest:
    albedo   road_albedo_<group>.webp   the surface's own colour (sRGB), for the flashlight
    flicker  road_flicker_<group>.webp  the streetlight's share of lit (greyscale, linear), for its flicker
    surface  asphalt | dirt | wood | metal | glass | cloth | plant | sandbag | water
    glow     1 (lit already carries every lamp at its baked brightness)
  In the game's shader:  colour = lit - albedo * SODIUM * flicker_scale * street * (1 - on)
                                  + albedo * beam(position, normal) / pi
  with street = the flicker map's red and flicker_scale in the scene extras.

The corn meshes carry their layers per vertex: COLOR_0 = lit (linear),
_ALBEDO, _FLICKER (street, the same units), _SWAY; material extras
`bake: "vertex"`.
"""

import os

import bpy
import bmesh
import numpy as np

from . import pipeline, bake, post, world, layout as L
from . import ground as _ground  # noqa: F401  (puts High Noon's charlib on the path)
from .common import tag, DN
from dustcreek import bake as DB


LAYERS = {
    "lit": "baseColorTexture of the unlit material (sRGB, display-referred: show as is, no tone mapping)",
    "albedo": "extras.albedo: a WebP beside road.glb (sRGB)",
    "flicker": "extras.flicker: a greyscale WebP beside road.glb (linear): the streetlight's light there, in units of "
               "albedo x SODIUM (1, 0.56, 0.23), divided by the scene's flicker_scale",
    "formula": "colour = lit - albedo * SODIUM * flicker_scale * street * (1 - on) + albedo * beam(position, normal) / pi",
}
SODIUM_GAME = np.array([1.0, 0.56, 0.23], np.float32)   # the game's SODIUM (stage.ts)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load_image(path, name, colorspace):
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


def srgb_to_lin(v):
    v = np.asarray(v, np.float32)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)


def read_rgb(path):
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    sp = inp.spec()
    a = np.asarray(inp.read_image(0, 0, 0, min(3, sp.nchannels), oiio.FLOAT)).reshape(sp.height, sp.width, -1)
    inp.close()
    return a


def write_webp(path, arr, quality=86):
    """RGB or greyscale, never alpha (a WebP drops the colour under zero
    alpha), top row first like the atlases the glTF carries."""
    import OpenImageIO as oiio
    a = np.clip(np.asarray(arr, np.float32), 0, 1)
    if a.ndim == 2:
        a = a[..., None]
    if a.shape[2] == 1:
        a = np.repeat(a, 3, axis=2)      # WebP is RGB(A): a mask goes in all three
    h, w, c = a.shape
    spec = oiio.ImageSpec(w, h, c, oiio.UINT8)
    spec.attribute("compression", f"webp:{quality}")
    out = oiio.ImageOutput.create(path)
    if out is None or not out.open(path, spec):
        raise RuntimeError(f"cannot write {path}: {oiio.geterror()}")
    if not out.write_image((a * 255 + 0.5).astype(np.uint8)):
        raise RuntimeError(f"cannot write {path}: {out.geterror()}")
    out.close()
    return os.path.getsize(path)


def side_layers(ctx, g):
    """The albedo WebP (full size) and, where the streetlight reaches, the
    flicker WebP (half size) for one group, written beside road.glb.
    Returns (albedo file, flicker file or None, street values at their
    99th percentile)."""
    lit = read_rgb(os.path.join(ctx.build, f"atlas_{g}_lit.png"))[..., :3]
    alb = read_rgb(os.path.join(ctx.build, f"atlas_{g}_albedo.png"))[..., :3]
    orm = read_rgb(os.path.join(ctx.build, f"atlas_{g}_orm.png"))
    albedo_name = f"road_albedo_{g}.webp"
    write_webp(os.path.join(ctx.assets, albedo_name), alb, quality=84)
    if g not in bake.STREET_REACH:
        return albedo_name, None, None
    f = orm[..., 0]
    h, w = f.shape
    # lit and albedo down to the mask's size (2 x 2 means)
    def half(a):
        H, W = a.shape[:2]
        return a.reshape(h, H // h, w, W // w, -1).mean((1, 3))
    lit_h, alb_h = half(lit), half(alb)
    # the lamp's share of lit, in the game's linear space: lit decoded, minus
    # lit without the lamp (the mask is the luminance fraction it adds)
    d = srgb_to_lin(lit_h) - srgb_to_lin(lit_h * (1 - f[..., None]))
    street = (d @ LUM) / np.maximum((srgb_to_lin(alb_h) * SODIUM_GAME) @ LUM, 2e-3)
    street[f < 0.004] = 0.0
    p99 = float(np.percentile(street[f > 0.02], 99.9)) if (f > 0.02).any() else 0.0
    return albedo_name, street, p99


def baked_material(group, surface, lit, extras):
    """Unlit, `lit` as its base colour (what three.js shows as a
    MeshBasicMaterial map); the other layers named in its extras."""
    m, g = DN.new_material(f"night.{group}.{surface}")
    uv = g.uv('UVMap')
    ext = 'EXTEND' if group == 'ground' else 'REPEAT'
    e = g.image(lit, uv, out='Color', extension=ext)
    em = g.node('ShaderNodeEmission', inputs={'Color': e, 'Strength': 1.0}, out=0)
    lp = g.node('ShaderNodeLightPath', out='Is Camera Ray')
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    g.output(g.node('ShaderNodeMixShader', inputs={0: lp, 1: tr, 2: em}, out=0))
    for k, v in extras.items():
        m[k] = v
    m['surface'] = surface
    m['group'] = group
    m['glow'] = 1.0
    m['layers'] = dict(LAYERS)
    return m


def corn_material():
    """Unlit, showing COLOR_0 (the baked lit) as is."""
    m, g = DN.new_material("night.corn")
    m['bake'] = 'vertex'
    m['surface'] = 'plant'
    m['glow'] = 1.0
    c = g.node('ShaderNodeVertexColor', out='Color', layer_name="lit")
    em = g.node('ShaderNodeEmission', inputs={'Color': c, 'Strength': 1.0}, out=0)
    lp = g.node('ShaderNodeLightPath', out='Is Camera Ray')
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    mix = g.node('ShaderNodeMixShader', inputs={0: lp, 1: tr, 2: em}, out=0)
    g.output(mix)
    m['layers'] = {"lit": "COLOR_0 (linearised display values)", "albedo": "_ALBEDO (linear): the game's `albedo`",
                   "sway": "_SWAY (0 ground .. 1 tassel)",
                   "flicker": "_FLICKER: the game's `street` (same units as the flicker maps: x flicker_scale)"}
    return m


def moon_material():
    m, g = DN.new_material("night.moon")
    em = g.node('ShaderNodeEmission', inputs={'Color': (0.92, 0.94, 1.0), 'Strength': 1.0}, out=0)
    lp = g.node('ShaderNodeLightPath', out='Is Camera Ray')
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    g.output(g.node('ShaderNodeMixShader', inputs={0: lp, 1: tr, 2: em}, out=0))
    return m


def shadow_material():
    m, g = DN.new_material("ground_shadow")
    b = g.principled((0.0, 0.0, 0.0), rough=1.0, alpha=0.0)
    g.output(b)
    try:
        m.surface_render_method = 'BLENDED'
    except AttributeError:
        pass
    return m


def strip(ob, keep_uv='bake'):
    me = ob.data
    for uv in list(me.uv_layers):
        if uv.name != keep_uv:
            me.uv_layers.remove(uv)
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
    for a in list(me.attributes):
        if a.name in ('rand', 'asph', 'conc', 'grav', 'soil', 'puddle', 'grass', 'sway'):
            me.attributes.remove(me.attributes[a.name])
    for c in list(me.color_attributes):
        me.color_attributes.remove(c)


def export_ground(col, mat_for, shadow_mat):
    """The baked ground was a dense grid; the game gets a lighter one with the
    same camera-projection UVs (so it shows the same picture), split by
    surface for impacts, and ground.shadow over where the dead walk."""
    from . import ground as GR
    xs = GR.x_axis(0.4)
    ys = GR.y_axis(0.4)
    X, Y, H, attrs = GR.fields(xs, ys)
    ob = GR.grid_object("ground.export", X, Y, H, col, attrs=attrs)
    DB.projective_uv(ob, None)
    surf = GR.surface_of_faces(ob)
    # drop faces that can never be seen (collapsed by the projection)
    me = ob.data
    uvl = me.uv_layers['bake']
    uv = np.empty(len(me.loops) * 2, np.float32)
    uvl.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    ls = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('loop_start', ls)
    dead = np.all(np.abs(uv[ls] - 0.0005) < 1e-6, axis=1)
    for k in range(1, 4):
        dead &= np.all(np.abs(uv[ls + k] - 0.0005) < 1e-6, axis=1)
    out = []
    for s in ('asphalt', 'dirt', 'water'):
        sel = (surf == s) & ~dead
        if not sel.any():
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        kill = [bm.faces[i] for i in np.nonzero(~sel)[0]]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        m2 = bpy.data.meshes.new(f"ground.{s}")
        bm.to_mesh(m2)
        bm.free()
        o2 = bpy.data.objects.new(f"ground.{s}", m2)
        col.objects.link(o2)
        strip(o2)
        m2.materials.clear()
        m2.materials.append(mat_for('ground', s))
        tag(o2, surface=s)
        m2['surface'] = s
        out.append(o2)
    # ground.shadow: the walkable ground (road, apron, shoulders, the motel
    # lot) lifted 1.5 cm, where the game draws the dead's shadows
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    keep = set()
    for f in bm.faces:
        c = f.calc_center_median()
        walk = (abs(c.x - L.ROAD_X) < L.ROAD_HALF + L.SHOULDER + 2.5 and -2.0 < c.y < 95) or \
               (L.APRON[0] < c.x < L.APRON[1] and 1.0 < c.y < L.APRON[3] + 0.1) or \
               (abs(c.y - L.CROSS_Y) < L.CROSS_HALF + 1.0 and -14 < c.x < 34) or \
               (6.0 < c.x < 34.0 and L.CROSS_Y < c.y < L.MOTEL_Y)
        if walk and not dead[f.index]:
            keep.add(f.index)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    for v in bm.verts:
        v.co.z += 0.015
    ms = bpy.data.meshes.new("ground.shadow")
    bm.to_mesh(ms)
    bm.free()
    for uvx in list(ms.uv_layers):
        ms.uv_layers.remove(uvx)
    for a in list(ms.attributes):
        if a.name in ('asph', 'conc', 'grav', 'soil', 'puddle', 'grass'):
            ms.attributes.remove(ms.attributes[a.name])
    so = bpy.data.objects.new("ground.shadow", ms)
    col.objects.link(so)
    ms.materials.append(shadow_mat)
    tag(so, surface='asphalt', role='shadow_catcher')
    bpy.data.objects.remove(ob)
    print("ground export:", {o.name: len(o.data.polygons) for o in out}, "shadow", len(ms.polygons))
    return out


def prepare_corn(mat, flicker_scale=1.0):
    for ob in [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('corn.')]:
        me = ob.data
        if 'lit' not in me.color_attributes:
            print("WARNING: corn not baked:", ob.name)
            continue
        n = len(me.vertices)
        alb = np.empty(n * 4, np.float32)
        me.color_attributes['albedo'].data.foreach_get('color', alb)
        a = me.attributes.new('_ALBEDO', 'FLOAT_VECTOR', 'POINT')
        a.data.foreach_set('vector', alb.reshape(-1, 4)[:, :3].ravel())
        sw = np.empty(n, np.float32)
        me.attributes['sway'].data.foreach_get('value', sw)
        s = me.attributes.new('_SWAY', 'FLOAT', 'POINT')
        s.data.foreach_set('value', sw)
        if 'flicker' in me.attributes:
            fl = np.empty(n, np.float32)
            me.attributes['flicker'].data.foreach_get('value', fl)
            # the fraction of lit the lamp adds -> the game's `street` units
            lit = np.empty(n * 4, np.float32)
            me.color_attributes['lit'].data.foreach_get('color', lit)
            lit = lit.reshape(-1, 4)[:, :3]
            alb3 = alb.reshape(-1, 4)[:, :3]
            street = ((lit * fl[:, None]) @ LUM) / np.maximum((alb3 * SODIUM_GAME) @ LUM, 2e-3)
            f = me.attributes.new('_FLICKER', 'FLOAT', 'POINT')
            f.data.foreach_set('value', np.clip(street / flicker_scale, 0, 1).astype(np.float32))
            me.attributes.remove(me.attributes['flicker'])
        me.attributes.remove(me.attributes['sway'])
        me.color_attributes.remove(me.color_attributes['albedo'])
        me.color_attributes.active_color = me.color_attributes['lit']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for uv in list(me.uv_layers):
            me.uv_layers.remove(uv)
        me.materials.clear()
        me.materials.append(mat)
        ob['surface'] = 'plant'
        me['surface'] = 'plant'


def stage(ctx):
    pipeline.open_blend(ctx.baked_blend)
    scene = bpy.context.scene
    # the contract's empties are placed again (they carry no bake)
    from . import contract
    contract.refresh()
    # the side layers, and one flicker_scale for the whole road
    side = {}
    for g in bake.ATLAS:
        for k in ('lit', 'albedo', 'orm'):
            pth = os.path.join(ctx.build, f"atlas_{g}_{k}.png")
            if not os.path.exists(pth):
                raise RuntimeError(f"missing {pth}: run the bake stage")
        side[g] = side_layers(ctx, g)
    p99 = [v[2] for v in side.values() if v[2]]
    flicker_scale = float(np.ceil(max(p99) * 4) / 4) if p99 else 1.0
    for fn in os.listdir(ctx.assets):
        if fn.startswith("road_flicker_"):
            os.remove(os.path.join(ctx.assets, fn))
    for g, (albedo_name, street, _) in side.items():
        if street is not None:
            write_webp(os.path.join(ctx.assets, f"road_flicker_{g}.webp"), street / flicker_scale, quality=90)
    print("flicker_scale", flicker_scale, {g: round(v[2], 2) for g, v in side.items() if v[2]})
    lits = {g: load_image(os.path.join(ctx.build, f"atlas_{g}_lit.png"), f"road_{g}_lit", 'sRGB') for g in bake.ATLAS}
    mats = {}

    def mat_for(g, surface):
        if (g, surface) not in mats:
            albedo_name, street, _ = side[g]
            ex = {"albedo": albedo_name}
            if street is not None:
                ex["flicker"] = f"road_flicker_{g}.webp"
            mats[(g, surface)] = baked_material(g, surface, lits[g], ex)
        return mats[(g, surface)]
    # the streetlight's lens: its own mesh, `street.lamp`, which the game dims as the lamp stutters
    for ob in list(scene.objects):
        if ob.type == 'MESH' and any(sl.material and sl.material.name.startswith('sodium_lens') for sl in ob.material_slots):
            idx = [i for i, sl in enumerate(ob.material_slots) if sl.material and sl.material.name.startswith('sodium_lens')]
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            lens = [f for f in bm.faces if f.material_index in idx]
            if not lens:
                bm.free()
                continue
            me2 = ob.data.copy()
            bm2 = bmesh.new()
            bm2.from_mesh(me2)
            bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.material_index not in idx], context='FACES')
            bm2.to_mesh(me2)
            bm2.free()
            bmesh.ops.delete(bm, geom=lens, context='FACES')
            bm.to_mesh(ob.data)
            bm.free()
            lamp = bpy.data.objects.new("street.lamp", me2)
            lamp.matrix_world = ob.matrix_world.copy()
            for k in ('group', 'surface'):
                if k in ob.keys():
                    lamp[k] = ob[k]
            lamp['surface'] = 'glass'
            ob.users_collection[0].objects.link(lamp)
            print("street.lamp:", len(me2.polygons), "faces from", ob.name)
    for sc in list(bpy.data.scenes):
        if sc != scene:
            bpy.data.scenes.remove(sc)
    for ob in list(scene.objects):
        if ob.get('export', 1) == 0 or ob.type == 'LIGHT' or ob.name.startswith('review_'):
            bpy.data.objects.remove(ob)
    col = bpy.data.collections.get("ground") or scene.collection
    old = bpy.data.objects.get('ground')
    shadow_m = shadow_material()
    export_ground(col, mat_for, shadow_m)
    if old is not None:
        bpy.data.objects.remove(old)
    prepare_corn(corn_material(), flicker_scale)
    moon_m = moon_material()
    for ob in list(scene.objects):
        if ob.type != 'MESH':
            continue
        if ob.name.startswith(('ground.', 'corn.')):
            continue
        if ob.name == 'moon.disc':
            strip(ob, keep_uv='local')
            ob.data.materials.clear()
            ob.data.materials.append(moon_m)
            ob.data['surface'] = ob.get('surface', 'glass')
            continue
        g = ob.get('group')
        if g not in bake.ATLAS:
            print("WARNING: no atlas group for", ob.name, g)
            continue
        strip(ob)
        surface = ob.get('surface', 'wood')
        ob.data.materials.clear()
        ob.data.materials.append(mat_for(g, surface))
        ob.data['surface'] = surface
    for ob in scene.objects:
        for k in ('group', 'no_occlude', 'emissive'):
            if k in ob.keys():
                del ob[k]
    # scene extras: the fog to draw, how to read the layers
    fog = post.fog_color()
    hexcol = post.display_hex(world.grade(fog[None, :])[0], scene)
    scene["fog_color"] = hexcol
    scene["fog_density"] = post.FOG_DENSITY
    scene["fog_ground"] = {"extinction_per_m": post.GROUND_FOG, "scale_height_m": post.GROUND_FOG_H,
                           "note": "extra ground-hugging fog: optical depth added along the view ray, see art/night/roadlib/post.py"}
    scene["fog_baked"] = False
    scene["layers"] = dict(LAYERS)
    scene["flicker_scale"] = flicker_scale
    scene["flicker"] = "per material: extras.flicker names its map"
    scene["colors"] = ("lit is display-referred (AgX, Medium High Contrast, the night grade): render it with no tone "
                       "mapping; albedo is plain sRGB base colour")
    scene["beam_hint"] = {"note": "a SpotLight at the eye along the aim; ~0.4-0.8 display units on albedo 0.3 at 10 m looks "
                                  "right against the baked moonlight", "color": [1.0, 0.93, 0.8]}
    print("fog extras:", hexcol, post.FOG_DENSITY)
    out = os.path.join(ctx.assets, "road.glb")
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=False, use_visible=False, use_renderable=False,
        export_extras=True, export_cameras=True, export_lights=False, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='MATERIAL', export_attributes=True,
        export_image_format='WEBP', export_image_quality=84, export_image_add_webp=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=16, export_draco_normal_quantization=8,
        export_draco_texcoord_quantization=14, export_draco_color_quantization=10,
        export_draco_generic_quantization=12,
        export_animations=False, export_skins=False, export_morph=False, export_unused_images=False,
        export_copyright="Nintenthropic - Route 9, generated by art/night/build_road.py")
    print("exported", out, f"{os.path.getsize(out) / 1e6:.2f} MB")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ctx.build, "road_export.blend"), compress=True)
