"""PBR atlases for everything lit at runtime: the station, the debris, the
drone, the derelict, the extras.

The procedural materials (materials.py) are baked channel by channel into
one atlas per asset: each material's output is switched to an Emission of
the channel it wants (colour, roughness, metalness) and baked exactly;
the shading normal (bump from crinkles, quilting, weave, machining) is
baked in tangent space against the export UVs; ambient occlusion comes
from the geometry. The result is the glTF trio three.js expects: base
colour (sRGB), ORM (R occlusion, G roughness, B metalness) and a normal
map. Faces with glowing materials (running lights, lamps) are kept out of
the atlas and get a constant emissive material the game can blink.
"""

import time

import bpy
import numpy as np

from dustcreek.nodes import new_material

from . import atlas, materials, imgio, bl

F32 = np.float32


def is_emissive(m):
    return m is not None and bool(m.get('emissive'))


def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def final_material(name, albedo, orm, normal, double_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    ia = nt.nodes.new("ShaderNodeTexImage")
    ia.image = albedo
    nt.links.new(uvn.outputs[0], ia.inputs[0])
    nt.links.new(ia.outputs["Color"], bs.inputs["Base Color"])
    io = nt.nodes.new("ShaderNodeTexImage")
    io.image = orm
    nt.links.new(uvn.outputs[0], io.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(io.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    inn = nt.nodes.new("ShaderNodeTexImage")
    inn.image = normal
    nt.links.new(uvn.outputs[0], inn.inputs[0])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nt.links.new(inn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    bs.inputs["Specular IOR Level"].default_value = 0.5
    m.use_backface_culling = not double_sided
    return m


def const_emissive(src):
    """A constant material for a glowing part: its colour and emission."""
    name = f"glow.{src.name}"
    m = bpy.data.materials.get(name)
    if m:
        return m
    nt0 = src.node_tree
    em = nt0.nodes['EM_emit'].inputs['Color'].default_value
    strength = nt0.nodes['EM_emit'].inputs['Strength'].default_value
    col = tuple(em[:3])
    lk = nt0.nodes['EM_emit'].inputs['Color'].links
    if lk:
        n = lk[0].from_node
        if n.bl_idname == 'ShaderNodeRGB':
            col = tuple(n.outputs[0].default_value[:3])
    m, g = new_material(name)
    b = g.principled(col, rough=0.25, metal=0.0, emission=col, estrength=min(strength, 40.0))
    g.output(b)
    m['glow'] = True
    return m


def triangulate_ngons(ob):
    """Split faces of five or more sides: tangent space (MikkTSpace) is only
    defined on triangles and quads, and the baked normal map must agree
    with the tangents the game computes."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    ng = [f for f in bm.faces if len(f.verts) > 4]
    if ng:
        bmesh.ops.triangulate(bm, faces=ng, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(ob.data)
        ob.data.update()
    bm.free()


def bake(ctx, name, objs, size, density, ao_distance=0.5, samples=None, quick=False, eye=None):
    """Bake the objects' procedural materials into one PBR atlas and give
    them the final material. Returns the final material."""
    t0 = time.time()
    for ob in objs:
        triangulate_ngons(ob)
        bl.orient_normals(ob, eye=eye)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'GPU'
    sc.cycles.use_denoising = False
    try:
        sc.world.light_settings.distance = ao_distance
    except AttributeError:
        pass

    def keep_face(ob, f):
        slot = ob.material_slots[f.material_index] if f.material_index < len(ob.material_slots) else None
        return not is_emissive(slot.material if slot else None)
    frac = atlas.unwrap(objs, size, density, uv_name='bake', angle=58.0, faces_filter=keep_face)
    # bake on one joined copy: Cycles bakes selected objects one at a time,
    # each with its own scene sync, which costs far more than the samples
    bpy.ops.object.select_all(action='DESELECT')
    dups = []
    for ob in objs:
        d = ob.copy()
        d.data = ob.data.copy()
        for c in ob.users_collection:
            c.objects.link(d)
        dups.append(d)
    for ob in objs:
        ob.hide_render = True
    bpy.context.view_layer.update()
    for d in dups:
        d.select_set(True)
    bpy.context.view_layer.objects.active = dups[0]
    if len(dups) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.hide_render = False
    real_objs = objs
    objs = [joined]
    s = samples or {}
    materials.route_all('color')
    alb = atlas.bake_pass(objs, size, 'EMIT', 1 if quick else s.get('color', 4))
    materials.route_all('rough')
    rough = atlas.bake_pass(objs, size, 'EMIT', 1 if quick else s.get('rough', 4))[..., 0]
    materials.route_all('metal')
    metal = atlas.bake_pass(objs, size, 'EMIT', 1 if quick else s.get('metal', 4))[..., 0]
    materials.route_all('bsdf')
    nrm = atlas.bake_pass(objs, size, 'NORMAL', 1 if quick else s.get('normal', 8))
    ao = atlas.bake_pass(objs, size, 'AO', 8 if quick else s.get('ao', 64))[..., 0]
    pos = atlas.bake_pass(objs, size, 'POSITION', 1)
    valid = np.linalg.norm(pos, axis=-1) > 1e-6
    # the position pass reads zero on faces at the world origin; the drone
    # and friends are built there, so also trust any texel with colour
    valid |= alb.max(-1) > 1e-5
    bpy.data.objects.remove(joined)
    objs = real_objs
    for ob in objs:
        ob.hide_render = False
    alb = atlas.fill_empty(alb, valid)
    orm = np.stack([np.clip(ao, 0, 1), np.clip(rough, 0.02, 1), np.clip(metal, 0, 1)], -1)
    orm = atlas.fill_empty(orm, valid)
    nrm = atlas.fill_empty(nrm, valid)
    # Blender stores images bottom row first; files are written top first
    paths = {}
    for key, arr, enc in (('albedo', alb, 'srgb'), ('orm', orm, 'lin'), ('normal', nrm, 'lin')):
        a = arr[::-1]
        if enc == 'srgb':
            a = imgio.srgb_encode(a)
        p = ctx.path(f"{name}_{key}.png")
        imgio.write(p, np.clip(a, 0, 1))
        paths[key] = p
    imgs = {}
    for key, p in paths.items():
        im = bpy.data.images.load(p, check_existing=False)
        im.name = f"{name}_{key}"
        im.colorspace_settings.name = 'sRGB' if key == 'albedo' else 'Non-Color'
        imgs[key] = im
    # double-sided: thin plates (a label, a blanket's edge) must not vanish
    # from behind under three.js's back-face culling
    fm = final_material(f"{name}.pbr", imgs['albedo'], imgs['orm'], imgs['normal'], double_sided=True)
    for ob in objs:
        me = ob.data
        new_slots = []
        for i, slot in enumerate(ob.material_slots):
            m = slot.material
            new_slots.append(const_emissive(m) if is_emissive(m) else fm)
        # collapse: faces keep their slot index, slots get the new materials
        for i, m in enumerate(new_slots):
            me.materials[i] = m
    print(f"  {name}: {size[0]}x{size[1]} atlas at {frac:.2f} x target, {len(objs)} objects in {time.time() - t0:.1f}s", flush=True)
    return fm


def merge_duplicate_slots(ob):
    """After baking, many slots point at the same material: merge them so
    the glTF gets one primitive per material."""
    me = ob.data
    mats = list(me.materials)
    uniq = []
    remap = []
    for m in mats:
        if m not in uniq:
            uniq.append(m)
        remap.append(uniq.index(m))
    if len(uniq) == len(mats):
        return
    idx = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get('material_index', idx)
    idx = np.array(remap, np.int32)[idx]
    me.materials.clear()
    for m in uniq:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', idx)
    me.update()
