"""Export town.glb: baked atlases on unlit materials, contract nodes with
extras, Draco geometry and WebP textures.

The dense street height field that was baked is swapped here for a light
mesh carrying the same camera-projection UVs (so it shows exactly the baked
picture from the player's eye at a fraction of the triangles).
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import pipeline, bake
from .nodes import new_material


def unlit_material(name, img, extension='REPEAT'):
    """Emission behind the 'Is Camera Ray' light-path trick: what Blender's
    glTF exporter recognises as KHR_materials_unlit, and what renders as
    the pure baked colour in Cycles (for the unlit check)."""
    m, g = new_material(name)
    tex = g.image(img, g.uv('UVMap'), out='Color', extension=extension)
    em = g.node('ShaderNodeEmission', inputs={'Color': tex, 'Strength': 1.0}, out=0)
    lp = g.node('ShaderNodeLightPath', out='Is Camera Ray')
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    mix = g.node('ShaderNodeMixShader', inputs={0: lp, 1: tr, 2: em}, out=0)
    g.output(mix)
    return m


def glass_export_material():
    """A plain standard material for glass.<id>: dusty tint, low roughness,
    mostly transparent. The game adds reflections (env map) and breaks it."""
    m, g = new_material("glass_export")
    b = g.principled((0.42, 0.40, 0.36), rough=0.12, metal=0.0, spec=0.5, alpha=0.32)
    g.output(b)
    try:
        m.surface_render_method = 'BLENDED'
    except AttributeError:
        pass
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    return m


def shadow_catcher_material():
    m, g = new_material("ground_shadow")
    b = g.principled((0.0, 0.0, 0.0), rough=1.0, alpha=0.0)
    g.output(b)
    try:
        m.surface_render_method = 'BLENDED'
    except AttributeError:
        pass
    return m


def strip_for_export(ob, keep_uv='bake'):
    me = ob.data
    for uv in list(me.uv_layers):
        if uv.name != keep_uv:
            me.uv_layers.remove(uv)
    if me.uv_layers:
        me.uv_layers[0].name = 'UVMap'
    for a in list(me.attributes):
        if a.name in ('rand', 'rut', 'lane', 'prints'):
            me.attributes.remove(me.attributes[a.name])
    for c in list(me.color_attributes):
        me.color_attributes.remove(c)


def light_street(src):
    """Replace the dense street by a light grid with identical projective UVs."""
    from .landscape import _grid_axis, height_field, grid_object, STREET_X, STREET_Y
    from .core import rng
    # spacing: 0.3 m near the player growing with distance; the street band
    # finer across than along (we look along it)
    grow = lambda y: max(1.0, (abs(y) + 2.0) / 6.0) ** 0.9
    xs = _grid_axis(STREET_X[0], STREET_X[1], 0.35, 2.0, (-10.0, 10.0))
    ys = _grid_axis(STREET_Y[0], STREET_Y[1], 0.3, 0.3, (STREET_Y[0], STREET_Y[1]), grow=grow)
    X, Y = np.meshgrid(xs, ys)
    H, _, _ = height_field(X, Y, rng("ground"))
    ex = np.clip((STREET_X[1] - np.abs(X)) / 3.0, 0, 1)
    ey = np.clip(np.minimum(Y - STREET_Y[0], STREET_Y[1] - Y) / 3.0, 0, 1)
    H *= ex * ey
    col = src.users_collection[0]
    ob = grid_object("ground.street.light", X, Y, H, col)
    me = ob.data
    bake.projective_uv(ob)
    for k, v in src.items():
        ob[k] = v
    mats = list(src.data.materials)
    bpy.data.objects.remove(src)
    ob.name = "ground.street"
    ob.data.name = "ground.street"
    for m in mats:
        ob.data.materials.append(m)
    # drop quads that can never be seen (behind the player / off screen)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv['bake']
    kill = [f for f in bm.faces if all(abs(l[uvl].uv.x - 0.0005) < 1e-6 and abs(l[uvl].uv.y - 0.0005) < 1e-6
                                       for l in f.loops)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    print(f"light street: {len(me.polygons)} quads")
    return ob


def shadow_plane(street):
    """`ground.shadow`: the street's own surface lifted 1 cm, where the game
    draws the shadows of dynamic things (a flat plane would float above the
    ruts and offset every shadow along the low sun)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(street.data)
    kill = [f for f in bm.faces if not all(abs(v.co.x) <= 7.8 and -2.0 <= v.co.y <= 64.0 for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    for v in bm.verts:
        v.co.z += 0.012
    # boardwalk and balcony tops, recorded by the scene stage
    import json
    inv = street.matrix_world.inverted()
    for q in json.loads(bpy.context.scene.get("shadow_quads", "[]")):
        vs = [bm.verts.new(inv @ Vector(p)) for p in q]
        f = bm.faces.new(vs)
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new("ground.shadow")
    bm.to_mesh(me)
    bm.free()
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    ob = bpy.data.objects.new("ground.shadow", me)
    street.users_collection[0].objects.link(ob)
    ob.matrix_world = street.matrix_world
    me.materials.append(shadow_catcher_material())
    ob['surface'] = 'dirt'
    ob['role'] = 'shadow_catcher'
    me['surface'] = 'dirt'
    return ob


def stage(ctx):
    pipeline.open_blend(ctx.baked_blend)
    scene = bpy.context.scene
    # atlases -> images the exporter will re-encode as WebP
    mats = {}
    for g, size in bake.ATLAS.items():
        png = os.path.join(ctx.build, f"atlas_{g}.png")
        if not os.path.exists(png):
            raise RuntimeError(f"missing atlas {png}: run the bake stage")
        img = bpy.data.images.load(png, check_existing=False)
        img.name = f"town_{g}"
        img.colorspace_settings.name = 'sRGB'
        mats[g] = unlit_material(f"baked.{g}", img, extension='EXTEND' if g == 'ground' else 'REPEAT')
    # remove what the game does not get (helper scenes, far world, lamps)
    for sc in list(bpy.data.scenes):
        if sc != scene:
            bpy.data.scenes.remove(sc)
    for ob in list(scene.objects):
        if ob.get('export', 1) == 0 or ob.type == 'LIGHT' or ob.name in ('review_cam',):
            bpy.data.objects.remove(ob)
    street = bpy.data.objects.get('ground.street')
    if street is not None:
        street = light_street(street)
        shadow_plane(street)
    glass_m = glass_export_material()
    for ob in list(scene.objects):
        if ob.type != 'MESH':
            continue
        if ob.name.startswith('glass.'):
            strip_for_export(ob, keep_uv='local')
            ob.data.materials.clear()
            ob.data.materials.append(glass_m)
            continue
        if ob.name == 'ground.shadow':
            continue
        g = ob.get('group')
        if g not in mats:
            print("WARNING: no atlas group for", ob.name, g)
            continue
        strip_for_export(ob)
        ob.data.materials.clear()
        ob.data.materials.append(mats[g])
        ob.data['surface'] = ob.get('surface', 'wood')
    # custom props that are not contract extras
    for ob in scene.objects:
        for k in ('building', 'group', 'animatable'):
            if k in ob.keys() and not ob.name.startswith(('cover.', 'calib.')):
                del ob[k]
    from . import post
    fog_lin = post.grade(post.fog_color()[None, :])[0]
    hexcol = post.display_hex(fog_lin, scene)
    probe = np.array([[0.0, 45.0, 1.0]])
    tau = float(post.optical_depth(probe)[0])
    k_exp2 = math.sqrt(tau) / 45.0
    scene["fog_color"] = hexcol
    scene["fog_density"] = round(k_exp2, 5)
    scene["fog_baked"] = True
    scene["fog_note"] = ("town textures already carry the haze (distance + height dust, see art/western/"
                         "dustcreek/post.py); fog_density is a THREE.FogExp2 density matching it at ~45 m for "
                         "dynamic objects. Set material.fog = false on the town's unlit materials to avoid "
                         "hazing the town twice.")
    scene["colors"] = "baked textures are display-referred (AgX, Medium High Contrast): render them with no tone mapping"
    print("fog extras:", hexcol, scene["fog_density"])
    out = os.path.join(ctx.assets, "town.glb")
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=False, use_visible=False, use_renderable=False,
        export_extras=True, export_cameras=True, export_lights=False, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_vertex_color='NONE', export_attributes=False,
        export_image_format='WEBP', export_image_quality=86, export_image_add_webp=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=16, export_draco_normal_quantization=8,
        export_draco_texcoord_quantization=14, export_draco_generic_quantization=12,
        export_animations=False, export_skins=False, export_morph=False, export_unused_images=False,
        export_copyright="Super Claude Bros. — Dust Creek, generated by art/western/build_town.py")
    print("exported", out, f"{os.path.getsize(out) / 1e6:.2f} MB")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ctx.build, "town_export.blend"), compress=True)
