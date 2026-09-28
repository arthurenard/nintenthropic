"""PBR materials for the buildings, props and roads, from the tiles:
base colour (albedo), normal map, roughness (the tiles' hra.G). Written as
plain Principled BSDF node trees the glTF exporter turns into standard
glTF materials; the occlusion texture (the baked AO atlas on UV1) is added
by the bake stage.

A material key is a tile name ("rubble"), a paint variant ("paint:green" is
the tile "paint_green"), or a plain one ("glass", "dark", "cheese").
"""

import os

import bpy

_CACHE = {}

PLAIN = {
    # key: (base colour linear, roughness, metallic, alpha)
    "glass": ((0.020, 0.024, 0.028), 0.08, 0.0, 0.55),
    "dark": ((0.010, 0.009, 0.008), 1.0, 0.0, 1.0),
    "cheese": ((0.62, 0.45, 0.14), 0.55, 0.0, 1.0),
    "metal": ((0.09, 0.09, 0.09), 0.4, 1.0, 1.0),
    "bell": ((0.55, 0.36, 0.16), 0.35, 1.0, 1.0),
    "light": ((0.9, 0.85, 0.7), 0.3, 0.0, 1.0),
    "yeti": ((0.78, 0.78, 0.76), 0.95, 0.0, 1.0),
}


def tile_name(key):
    return key.replace(":", "_")


def material(key, tiles_dir):
    if key in _CACHE:
        try:
            if _CACHE[key].name in bpy.data.materials:
                return _CACHE[key]
        except ReferenceError:        # a blend was reopened since: the material is gone
            pass
        del _CACHE[key]
    if key in PLAIN:
        col, rough, metal, alpha = PLAIN[key]
        m = bpy.data.materials.new(f"m.{key}")
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs['Base Color'].default_value = (*col, 1.0)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Metallic'].default_value = metal
        if alpha < 1.0:
            b.inputs['Alpha'].default_value = alpha
            try:
                m.surface_render_method = 'BLENDED'
            except AttributeError:
                pass
        _CACHE[key] = m
        return m
    if key == "grass_blades":
        m = bpy.data.materials.new("m.grass_blades")
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        a = nt.nodes.new('ShaderNodeVertexColor')
        a.layer_name = "Col"
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = 0.7
        m.use_backface_culling = False
        _CACHE[key] = m
        return m
    name = tile_name(key)
    m = bpy.data.materials.new(f"m.{name}")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = "UVMap"

    def tex(kind, cs):
        n = nt.nodes.new('ShaderNodeTexImage')
        img = bpy.data.images.load(os.path.join(tiles_dir, f"{name}_{kind}.png"), check_existing=True)
        img.colorspace_settings.name = cs
        n.image = img
        nt.links.new(uv.outputs[0], n.inputs['Vector'])
        return n
    a = tex("albedo", 'sRGB')
    nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
    h = tex("hra", 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(h.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    n = tex("normal", 'Non-Color')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = "UVMap"
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Specular IOR Level'].default_value = 0.4
    if name.startswith("paint"):
        b.inputs['Metallic'].default_value = 0.0
    _CACHE[key] = m
    return m


def assign(objs, tiles_dir):
    for ob in objs:
        key = ob.get("material_key")
        if key is None:
            continue
        ob.data.materials.clear()
        ob.data.materials.append(material(key, tiles_dir))
