"""Export road.glb: the baked layers on standard glTF materials, the corn
with its vertex layers, the contract nodes with their extras, Draco
geometry and WebP textures.

How the layers travel (see art/night/README.md, "Reading road.glb"):

  every baked material (`night.<group>`) is a plain metallic-roughness
  material, NOT unlit:
    emissiveTexture   = lit     (emissiveFactor [1,1,1]; display-referred sRGB)
    baseColorTexture  = albedo  (sRGB)
    occlusionTexture  = ORM R   = the streetlight's flicker mask (not AO!)
    metallicRoughnessTexture = the same ORM (G roughness, B metalness = 0)

So three.js's GLTFLoader builds a MeshStandardMaterial that already shows
the night (emissive = lit, no lights needed) and lights `albedo` physically
with whatever the game adds - the flashlight as a SpotLight, with the wet
road's roughness. Give these materials no environment map and no ambient
light (the ambient is baked), and read the mask from `aoMap`'s red channel.

The corn meshes carry their layers per vertex: COLOR_0 = lit (an unlit
material multiplies it), _ALBEDO, _SWAY, _FLICKER.
"""

import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Vector

from . import pipeline, bake, post, world, layout as L
from . import ground as _ground  # noqa: F401  (puts High Noon's charlib on the path)
from .common import tag, DN, DC
from dustcreek import bake as DB


LAYERS = {
    "lit": "emissiveTexture (sRGB, display-referred: show as is, no tone mapping)",
    "albedo": "baseColorTexture (sRGB)",
    "flicker": "occlusionTexture, red channel (the streetlight's share of lit; not ambient occlusion)",
    "roughness": "metallicRoughnessTexture, green channel",
    "formula": "colour = lit * (1 - flicker * (1 - streetlight)) + albedo * beam(position, normal)",
}


def load_image(path, name, colorspace):
    img = bpy.data.images.load(path, check_existing=False)
    img.name = name
    img.colorspace_settings.name = colorspace
    return img


def baked_material(group, lit, albedo, orm):
    m, g = DN.new_material(f"night.{group}")
    uv = g.uv('UVMap')
    ext = 'EXTEND' if group == 'ground' else 'REPEAT'
    a = g.image(albedo, uv, out='Color', extension=ext)
    e = g.image(lit, uv, out='Color', extension=ext)
    o = g.image(orm, uv, out='Color', extension=ext)
    R, G_, B = g.sep_rgb(o)
    b = g.new('ShaderNodeBsdfPrincipled')
    g.links.new(a, b.inputs['Base Color'])
    g.links.new(G_, b.inputs['Roughness'])
    g.links.new(B, b.inputs['Metallic'])
    g.links.new(e, b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0
    b.inputs['Specular IOR Level'].default_value = 0.5
    g.output(b.outputs[0])
    # occlusion: the exporter looks for the "glTF Material Output" group
    from charlib import materials as CM
    grp = CM.gltf_output_group()
    n = g.new('ShaderNodeGroup')
    n.node_tree = grp
    g.links.new(R, n.inputs['Occlusion'])
    m['layers'] = dict(LAYERS)
    m['group'] = group
    return m


def corn_material():
    """Unlit, showing COLOR_0 (the baked lit) as is."""
    m, g = DN.new_material("night.corn")
    c = g.node('ShaderNodeVertexColor', out='Color', layer_name="lit")
    em = g.node('ShaderNodeEmission', inputs={'Color': c, 'Strength': 1.0}, out=0)
    lp = g.node('ShaderNodeLightPath', out='Is Camera Ray')
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    mix = g.node('ShaderNodeMixShader', inputs={0: lp, 1: tr, 2: em}, out=0)
    g.output(mix)
    m['layers'] = {"lit": "COLOR_0 (linearised display values)", "albedo": "_ALBEDO (linear)",
                   "sway": "_SWAY (0 ground .. 1 tassel)", "flicker": "_FLICKER"}
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


def export_ground(col, mat, shadow_mat):
    """The baked ground was a dense grid; the game gets a lighter one with the
    same camera-projection UVs (so it shows the same picture), split by
    surface for impacts, and ground.shadow over where the dead walk."""
    from . import ground as GR
    xs = GR.x_axis(0.4)
    ys = GR.y_axis(0.4)
    X, Y, H, attrs = GR.fields(xs, ys)
    ob = GR.grid_object("ground.export", X, Y, H, col, attrs=attrs)
    gb = bpy.data.objects.get('ground')
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
        m2.materials.append(mat)
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


def prepare_corn(mat):
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
            f = me.attributes.new('_FLICKER', 'FLOAT', 'POINT')
            f.data.foreach_set('value', fl)
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
    mats = {}
    for g, size in bake.ATLAS.items():
        paths = {k: os.path.join(ctx.build, f"atlas_{g}_{k}.png") for k in ('lit', 'albedo', 'orm')}
        for p in paths.values():
            if not os.path.exists(p):
                raise RuntimeError(f"missing {p}: run the bake stage")
        lit = load_image(paths['lit'], f"road_{g}_lit", 'sRGB')
        alb = load_image(paths['albedo'], f"road_{g}_albedo", 'sRGB')
        orm = load_image(paths['orm'], f"road_{g}_orm", 'Non-Color')
        mats[g] = baked_material(g, lit, alb, orm)
    for sc in list(bpy.data.scenes):
        if sc != scene:
            bpy.data.scenes.remove(sc)
    for ob in list(scene.objects):
        if ob.get('export', 1) == 0 or ob.type == 'LIGHT' or ob.name.startswith('review_'):
            bpy.data.objects.remove(ob)
    col = bpy.data.collections.get("ground") or scene.collection
    old = bpy.data.objects.get('ground')
    shadow_m = shadow_material()
    export_ground(col, mats['ground'], shadow_m)
    if old is not None:
        bpy.data.objects.remove(old)
    prepare_corn(corn_material())
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
        if g not in mats:
            print("WARNING: no atlas group for", ob.name, g)
            continue
        strip(ob)
        ob.data.materials.clear()
        ob.data.materials.append(mats[g])
        ob.data['surface'] = ob.get('surface', 'wood')
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
        export_copyright="Handy - Route 9, generated by art/night/build_road.py")
    print("exported", out, f"{os.path.getsize(out) / 1e6:.2f} MB")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ctx.build, "road_export.blend"), compress=True)
