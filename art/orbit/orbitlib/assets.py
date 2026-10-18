"""Stages for the loose assets: debris, drone, derelict, extras. Each is
built in a fresh scene, baked into one PBR atlas with a uniform texel
density (weighted per object), and exported with its contract nodes."""

import math
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bl, materials, pbrbake, atlas, fracture, export, pipeline
from .bl import rng

log = pipeline.log

# effective densities (kg/m^3 of enclosed volume) by kind: sheets are solid
# metal, boxes and panels are mostly air
KIND_DENSITY = {'shrapnel': 2700.0, 'chunk': 420.0, 'slab': 1100.0, 'shard': 1300.0, 'foil_core': 2400.0,
                'foil_wrap': 400.0, 'piece': 900.0}


def fresh_scene(name):
    sc = bl.reset_scene(name)
    bl.setup_gpu(sc)
    materials.LIB.clear()
    materials.interior_materials()
    materials.exterior_materials()
    materials.debris_materials()
    materials.extras_materials()
    return sc


def swatch(col, mat, size=0.35, name="__swatch"):
    """A small square of a material baked into the atlas, for faces made
    after the bake (fresh fracture faces)."""
    g = bl.Geo(name)
    h = size / 2
    g.poly([(-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], mat)
    ob = g.build(col, materials.LIB)
    ob.location = (0, -6, 0)
    return ob


def uv_rect(ob, uv='bake'):
    uvs = np.empty(len(ob.data.loops) * 2, np.float32)
    ob.data.uv_layers[uv].data.foreach_get('uv', uvs)
    uvs = uvs.reshape(-1, 2)
    return uvs[:, 0].min(), uvs[:, 1].min(), uvs[:, 0].max(), uvs[:, 1].max()


def map_faces_to_rect(ob, slot, rect, scale=2.5, uv='bake'):
    """Box-project the faces using material `slot` into a UV rectangle
    (repeating the swatch as a texture tile would)."""
    me = ob.data
    u0, v0, u1, v1 = rect
    pad = 0.08 * (u1 - u0)
    u0, v0, u1, v1 = u0 + pad, v0 + pad, u1 - pad, v1 - pad
    uvl = me.uv_layers[uv]
    for p in me.polygons:
        if p.material_index != slot:
            continue
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            fu = (co[a] * scale) % 1.0
            fv = (co[b] * scale) % 1.0
            uvl.data[li].uv = (u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv)


def set_mass(ob, kind):
    fracture.recentre(ob)
    _, vol = fracture.centre_of_mass(ob)
    dims = ob.dimensions
    ob['kind'] = kind
    ob['mass_kg'] = round(max(vol * KIND_DENSITY.get(kind, 800.0), 0.05), 2)
    ob['size_m'] = round(max(dims), 3)
    ob['surface'] = 'foil' if kind == 'foil_wrap' else 'metal'


def split_into(ob, n, cut_mat, final_mat, rect, r, group_name):
    """Fracture `ob` into n pieces under a group empty sharing its transform."""
    seeds = fracture.seeds_for(ob, n, r)
    pieces = fracture.split(ob, seeds, cut_mat, r)
    grp = bl.empty(group_name, ob.users_collection[0], matrix=ob.matrix_world.copy(), size=0.3,
                   note="clone onto the whole's transform: the pieces reassemble it")
    for i, pc in enumerate(pieces, 1):
        pbrbake.triangulate_ngons(pc)
        me = pc.data
        slot = next((k for k, m in enumerate(me.materials) if m == cut_mat), None)
        if slot is not None:
            map_faces_to_rect(pc, slot, rect)
            me.materials[slot] = final_mat
            pbrbake.merge_duplicate_slots(pc)
        mw = pc.matrix_world.copy()
        pc.parent = grp
        pc.matrix_world = mw
        fracture.recentre(pc)
        _, vol = fracture.centre_of_mass(pc)
        pc.name = f"{ob.name}.piece.{i}"
        pc.data.name = pc.name
        pc['kind'] = 'piece'
        pc['mass_kg'] = round(max(vol * KIND_DENSITY['piece'], 0.05), 2)
        pc['surface'] = 'metal'
    return grp, pieces


def _meshes_under(root):
    return [o for o in [root] + list(root.children_recursive) if o.type == 'MESH']


def _finish(objs):
    for o in objs:
        pbrbake.merge_duplicate_slots(o)
        export.strip(o, 'bake')


def stage_drone(ctx):
    from . import drone
    t = time.time()
    fresh_scene("Drone")
    col = bl.collection("drone")
    root = drone.build(materials.LIB, col)
    objs = _meshes_under(root)
    dens = atlas.UniformDensity(1000.0, {o.name: (0.6 if o.name.startswith('thruster') else 1.0) for o in objs})
    size = (1024, 1024) if not ctx.quick else (512, 512)
    pbrbake.bake(ctx, "drone", objs, size, dens, ao_distance=0.08, quick=ctx.quick,
                 samples=dict(color=8, rough=8, metal=8, normal=16, ao=128))
    _finish(objs)
    bpy.context.scene["note"] = "the repair drone; faces glTF +Z; see art/orbit/README.md (Drone)"
    export.gltf_export(ctx.asset("drone.glb"), tangents=True, quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.path("drone.blend"), compress=True)
    log(f"  drone done in {time.time() - t:.1f}s")


def stage_derelict(ctx):
    from . import derelict
    t = time.time()
    fresh_scene("Derelict")
    col = bl.collection("derelict")
    root, body = derelict.build(materials.LIB, col)
    sw = swatch(col, 'torn_alu', size=0.5)
    objs = _meshes_under(root) + [sw]
    dens = atlas.UniformDensity(1000.0, {sw.name: 2.0, 'tank': 1.5})
    size = (2048, 2048) if not ctx.quick else (1024, 1024)
    fm = pbrbake.bake(ctx, "derelict", objs, size, dens, ao_distance=0.4, quick=ctx.quick,
                      samples=dict(color=8, rough=8, metal=8, normal=16, ao=128))
    rect = uv_rect(sw)
    bpy.data.objects.remove(sw)
    objs = _meshes_under(root)
    for o in objs:
        pbrbake.merge_duplicate_slots(o)
    cut = fm.copy()
    cut.name = "__cut"
    # the break-up: the bus in chunks, in a sibling group with the root's transform
    r = rng("derelict:fracture")
    seeds = [Vector((r.uniform(-0.55, 0.55), r.uniform(-0.45, 0.45), -0.8 + 1.6 * (i + 0.5) / 7)) for i in range(7)]
    pieces = fracture.split(body, seeds, cut, r, jag=0.04)
    grp = bl.empty("derelict.pieces", col, matrix=root.matrix_world.copy(), size=0.5,
                   note="the bus broken up: clone onto the derelict's transform, hide derelict.body")
    for i, pc in enumerate(pieces, 1):
        pbrbake.triangulate_ngons(pc)
        me = pc.data
        slot = next((k for k, m in enumerate(me.materials) if m == cut), None)
        if slot is not None:
            map_faces_to_rect(pc, slot, rect, scale=1.2)
            me.materials[slot] = fm
        pbrbake.merge_duplicate_slots(pc)
        mw = pc.matrix_world.copy()
        pc.parent = grp
        pc.matrix_world = mw
        fracture.recentre(pc)
        _, vol = fracture.centre_of_mass(pc)
        pc.name = pc.data.name = f"derelict.piece.{i}"
        pc['kind'] = 'piece'
        pc['mass_kg'] = round(max(vol * 300.0, 1.0), 1)
        pc['surface'] = 'metal'
    for o in bpy.data.objects:
        if o.type == 'MESH':
            export.strip(o, 'bake')
    bpy.data.materials.remove(cut)
    root['mass_kg'] = 1200.0
    root['size_m'] = 4.2
    export.gltf_export(ctx.asset("derelict.glb"), tangents=True, quality=86)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.path("derelict.blend"), compress=True)
    log(f"  derelict done in {time.time() - t:.1f}s")


def render_sticker_art(ctx, root, size=512):
    """Photograph the spacewalker from the front on a transparent film:
    the art for the sticker."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("sticker_cam")
    cd.type = 'ORTHO'
    cd.ortho_scale = 2.25
    cam = bpy.data.objects.new("sticker_cam", cd)
    sc.collection.objects.link(cam)
    cam.location = (0.35, -5.0, 1.05)
    cam.rotation_euler = (math.radians(90), 0, math.radians(4))
    sc.camera = cam
    key = bpy.data.lights.new("sticker_key", 'SUN')
    key.energy = 4.0
    kob = bpy.data.objects.new("sticker_key", key)
    sc.collection.objects.link(kob)
    kob.rotation_euler = (math.radians(55), math.radians(-30), math.radians(-25))
    w = bpy.data.worlds.new("sticker_world")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.55, 0.62, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = 64
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.0
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'IMAGE'
    s.file_format = 'PNG'
    s.color_mode = 'RGBA'
    s.color_depth = '8'
    path = ctx.path("sticker_art.png")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (cam, kob):
        bpy.data.objects.remove(o)
    sc.world = None
    return path


def compose_sticker(ctx, art_path, size=512):
    """Die-cut vinyl: the art on a white border that follows its outline,
    with a thin grey cut line."""
    from . import imgio
    a = imgio.read(art_path)
    rgb, al = a[..., :3], a[..., 3]
    border = al > 0.5
    k = 14
    grown = border.copy()
    for _ in range(k):
        g2 = grown.copy()
        g2[1:] |= grown[:-1]
        g2[:-1] |= grown[1:]
        g2[:, 1:] |= grown[:, :-1]
        g2[:, :-1] |= grown[:, 1:]
        grown = g2
    edge = grown.copy()
    for _ in range(2):
        e2 = edge.copy()
        e2[1:] &= edge[:-1]
        e2[:-1] &= edge[1:]
        e2[:, 1:] &= edge[:, :-1]
        e2[:, :-1] &= edge[:, 1:]
        edge = e2
    out = np.zeros((size, size, 4), np.float32)
    white = np.array([0.95, 0.95, 0.93], np.float32)
    # the colour under the transparent area is the border's white, so the
    # cut edge never picks up a dark fringe when filtered (and WebP may
    # drop the colour of fully transparent pixels anyway)
    out[..., :3] = white
    out[..., :3] = np.where((grown & ~edge)[..., None], np.array([0.7, 0.7, 0.7], np.float32), out[..., :3])
    out[..., :3] = out[..., :3] * (1 - al[..., None]) + rgb * al[..., None]
    out[..., 3] = grown.astype(np.float32)
    p = ctx.path("sticker.png")
    imgio.write(p, out)
    return p


def sticker_object(ctx, col, img_path):
    from dustcreek.nodes import new_material
    img = bpy.data.images.load(img_path, check_existing=False)
    img.name = "sticker"
    m, g = new_material("sticker")
    tex = g.image(img, g.uv('UVMap'), out='Color')
    alpha = g.image(img, g.uv('UVMap'), out='Alpha')
    cut = g.math('GREATER_THAN', alpha, 0.5)
    b = g.principled(tex, rough=0.42, metal=0.0, alpha=cut, spec=0.5, coat=0.3)
    g.output(b)
    try:
        m.surface_render_method = 'DITHERED'
    except AttributeError:
        pass
    me = bpy.data.meshes.new("sticker")
    h = 0.1
    me.from_pydata([(-h, 0, -h), (h, 0, -h), (h, 0, h), (-h, 0, h)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', [0, 0, 1, 0, 1, 1, 0, 1])
    me.materials.append(m)
    ob = bpy.data.objects.new("sticker", me)
    col.objects.link(ob)
    bl.tag(ob, surface='plastic', note="20 cm vinyl sticker; faces glTF +Z (Blender -Y); stick it on the truss where the astronaut was")
    # the printed side faces the viewer (Blender -Y = glTF +Z)
    me.flip_normals()
    return ob


def stage_extras(ctx):
    from . import extras
    t = time.time()
    fresh_scene("Extras")
    col = bl.collection("extras")
    lib = materials.LIB
    astro = extras.astronaut(lib, col)
    bag = extras.toolbag(lib, col)
    duck = extras.duck(lib, col)
    art = render_sticker_art(ctx, astro)
    # spread out while baking so nothing shades anything else
    bag.location = (2.5, 0, 0)
    duck.location = (4.0, 0, 0)
    bpy.context.view_layer.update()
    objs = _meshes_under(astro) + _meshes_under(bag) + [duck]
    w = {duck.name: 3.0}
    for o in _meshes_under(bag):
        w[o.name] = 2.0
    for o in _meshes_under(astro):
        if 'hand' in o.name:
            w[o.name] = 2.0
    size = (2048, 2048) if not ctx.quick else (1024, 1024)
    pbrbake.bake(ctx, "extras", objs, size, atlas.UniformDensity(1000.0, w), ao_distance=0.12, quick=ctx.quick,
                 samples=dict(color=8, rough=8, metal=8, normal=16, ao=128))
    _finish(objs)
    bag.location = (0, 0, 0)
    duck.location = (0, 0, 0)
    sticker_object(ctx, col, compose_sticker(ctx, art))
    export.gltf_export(ctx.asset("extras.glb"), tangents=True, quality=88)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.path("extras.blend"), compress=True)
    log(f"  extras done in {time.time() - t:.1f}s")


def stage_debris(ctx):
    from . import debris
    t = time.time()
    sc = fresh_scene("Debris")
    col = bl.collection("debris")
    items = debris.build(col)
    sw = swatch(col, 'torn_alu')
    for ob, kind, n in items:
        set_mass(ob, kind)
    objs = [ob for ob, _, _ in items] + [sw]
    weights = {}
    for ob, kind, n in items:
        weights[ob.name] = {'shrapnel': 3.2, 'chunk': 1.5, 'foil_core': 2.0, 'foil_wrap': 1.4, 'slab': 0.8, 'shard': 1.0}[kind]
    weights[sw.name] = 3.0
    dens = atlas.UniformDensity(1000.0, weights)
    size = (2048, 2048) if not ctx.quick else (1024, 1024)
    fm = pbrbake.bake(ctx, "debris", objs, size, dens, ao_distance=0.12, quick=ctx.quick,
                      samples=dict(color=8, rough=8, metal=8, normal=16, ao=128))
    rect = uv_rect(sw)
    bpy.data.objects.remove(sw)
    cut = fm.copy()
    cut.name = "__cut"
    for ob, kind, n in items:
        pbrbake.merge_duplicate_slots(ob)
    # fracture and group
    for ob, kind, n in items:
        if n <= 0:
            continue
        r = rng(f"fracture:{ob.name}")
        base = ob.name[:-len('.core')] if kind == 'foil_core' else ob.name
        split_into(ob, n, cut, fm, rect, r, f"{base}.pieces")
    # the foil-wrapped pieces: a group per piece holding the wrap and the core
    for i in range(1, 4):
        core = bpy.data.objects[f"foil.{i}.core"]
        wrap = bpy.data.objects[f"foil.{i}.wrap"]
        grp = bl.empty(f"foil.{i}", col, matrix=core.matrix_world.copy(), size=0.3, kind='foil',
                       mass_kg=round(core['mass_kg'] + wrap['mass_kg'], 2), size_m=wrap['size_m'], surface='foil',
                       note="hide .wrap to strip the foil; .core splits into .pieces")
        for o in (core, wrap):
            mw = o.matrix_world.copy()
            o.parent = grp
            o.matrix_world = mw
    # every whole (and its pieces group) back to the origin
    for o in list(bpy.data.objects):
        if o.parent is None:
            s = debris.slot_of(o.name)
            if s is not None:
                o.matrix_world = Matrix.Translation(-s) @ o.matrix_world
    for o in bpy.data.objects:
        if o.type == 'MESH':
            export.strip(o, 'bake')
    bpy.data.materials.remove(cut)
    out = ctx.asset("debris.glb")
    sc["note"] = "debris library: wholes laid out on a grid; see art/orbit/README.md (Debris)"
    export.gltf_export(out, tangents=False, quality=86, pos_bits=14, uv_bits=12)
    bpy.ops.wm.save_as_mainfile(filepath=ctx.path("debris.blend"), compress=True)
    log(f"  debris done in {time.time() - t:.1f}s")
