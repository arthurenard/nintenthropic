"""Bake-source materials (on the sculpts) and the final glTF materials (on the game meshes).

A source material exposes four things the baker can route to the output one at
a time: albedo, roughness, metalness (each through an Emission shader, so the
bake records exactly the value, not a lit result) and the shading normal
(through a Principled BSDF, for the tangent-space normal bake). Large-scale
colour comes from vertex attributes painted in numpy; the node tree adds the
fine grain a texel can still carry - pores, weave slub, leather grain, brushed
steel - to both colour and normal.
"""
import bpy


def _n(nt, kind, name=None, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    if name:
        n.name = name
        n.label = name
    n.location = loc
    for k, v in props.items():
        setattr(n, k, v)
    return n


GRAIN = {
    # kind: (noise scale, detail, bump strength, bump distance, colour variation, voronoi pits)
    "skin": (900.0, 3.0, 0.22, 0.00025, 0.06, 1500.0),
    "cotton": (420.0, 4.0, 0.25, 0.0004, 0.10, 0.0),
    "wool": (260.0, 6.0, 0.35, 0.0006, 0.14, 0.0),
    "canvas": (300.0, 5.0, 0.35, 0.0006, 0.14, 0.0),
    "denim": (500.0, 4.0, 0.30, 0.0005, 0.12, 0.0),
    "leather": (180.0, 6.0, 0.45, 0.0006, 0.16, 700.0),
    "felt": (160.0, 5.0, 0.25, 0.0006, 0.10, 0.0),
    "metal": (700.0, 2.0, 0.10, 0.0002, 0.06, 0.0),
    "wood": (120.0, 6.0, 0.30, 0.0005, 0.18, 0.0),
    "hair": (600.0, 3.0, 0.35, 0.0004, 0.10, 0.0),
    "straw": (240.0, 5.0, 0.35, 0.0006, 0.2, 0.0),
    "iron": (220.0, 6.0, 0.4, 0.0006, 0.2, 400.0),
    "feather": (500.0, 4.0, 0.3, 0.0004, 0.1, 0.0),
}


def source_material(name, grain="cotton", streak=(1.0, 1.0, 1.0), metal=0.0):
    """Reads per-vertex attributes `col` (colour), `rough`, `metal` if present.

    `streak` stretches the grain noise along object axes (fabric has a
    direction; wood and brushed steel even more so).
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _n(nt, "ShaderNodeOutputMaterial", "OUT", (900, 0))
    tc = _n(nt, "ShaderNodeTexCoord", None, (-900, 0))
    mp = _n(nt, "ShaderNodeMapping", None, (-700, 0))
    mp.inputs["Scale"].default_value = streak
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    scale, detail, bstr, bdist, cvar, pits = GRAIN[grain]
    noise = _n(nt, "ShaderNodeTexNoise", None, (-500, 100))
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = 0.6
    nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    height = noise.outputs["Fac"]
    if pits > 0:
        vor = _n(nt, "ShaderNodeTexVoronoi", None, (-500, -150))
        vor.inputs["Scale"].default_value = pits
        nt.links.new(mp.outputs["Vector"], vor.inputs["Vector"])
        mix = _n(nt, "ShaderNodeMath", None, (-300, -50), operation="MULTIPLY_ADD")
        nt.links.new(vor.outputs["Distance"], mix.inputs[0])
        mix.inputs[1].default_value = 0.6
        nt.links.new(noise.outputs["Fac"], mix.inputs[2])
        height = mix.outputs[0]
    ca = _n(nt, "ShaderNodeAttribute", "ATTR_COL", (-500, 400), attribute_name="col", attribute_type="GEOMETRY")
    ra = _n(nt, "ShaderNodeAttribute", "ATTR_ROUGH", (-500, 250), attribute_name="rough", attribute_type="GEOMETRY")
    ma = _n(nt, "ShaderNodeAttribute", "ATTR_METAL", (-500, 550), attribute_name="metal", attribute_type="GEOMETRY")
    # colour: vertex colour modulated by the grain
    gmul = _n(nt, "ShaderNodeMapRange", None, (-250, 300))
    nt.links.new(noise.outputs["Fac"], gmul.inputs["Value"])
    gmul.inputs["From Min"].default_value = 0.3
    gmul.inputs["From Max"].default_value = 0.7
    gmul.inputs["To Min"].default_value = 1.0 - cvar
    gmul.inputs["To Max"].default_value = 1.0 + cvar
    col = _n(nt, "ShaderNodeMix", "COL", (0, 400), data_type="RGBA", blend_type="MULTIPLY")
    col.inputs["Factor"].default_value = 1.0
    nt.links.new(ca.outputs["Color"], col.inputs["A"])
    nt.links.new(gmul.outputs["Result"], col.inputs["B"])
    bump = _n(nt, "ShaderNodeBump", "BUMP", (0, -100))
    bump.inputs["Strength"].default_value = bstr
    bump.inputs["Distance"].default_value = bdist
    nt.links.new(height, bump.inputs["Height"])
    # roughness: attribute (0 means "not painted" -> default) plus grain
    rdef = _n(nt, "ShaderNodeMath", None, (-250, 150), operation="MAXIMUM")
    nt.links.new(ra.outputs["Fac"], rdef.inputs[0])
    rdef.inputs[1].default_value = 0.02
    rg = _n(nt, "ShaderNodeMath", "ROUGH", (0, 150), operation="MULTIPLY_ADD")
    nt.links.new(noise.outputs["Fac"], rg.inputs[0])
    rg.inputs[1].default_value = 0.12
    nt.links.new(rdef.outputs[0], rg.inputs[2])
    mt = _n(nt, "ShaderNodeMath", "METAL", (0, 600), operation="MAXIMUM")
    nt.links.new(ma.outputs["Fac"], mt.inputs[0])
    mt.inputs[1].default_value = metal
    em = _n(nt, "ShaderNodeEmission", "EM", (500, 200))
    bs = _n(nt, "ShaderNodeBsdfPrincipled", "BSDF", (500, -150))
    nt.links.new(col.outputs["Result"], bs.inputs["Base Color"])
    nt.links.new(rg.outputs[0], bs.inputs["Roughness"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    nt.links.new(col.outputs["Result"], em.inputs["Color"])
    return m


def route(m, what):
    """Point a source material's output at one channel for the next bake."""
    nt = m.node_tree
    out, em, bs = nt.nodes["OUT"], nt.nodes["EM"], nt.nodes["BSDF"]
    for l in list(em.inputs["Color"].links):
        nt.links.remove(l)
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    if what == "normal":
        nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
        return
    src = {"albedo": nt.nodes["COL"].outputs["Result"], "rough": nt.nodes["ROUGH"].outputs[0],
           "metal": nt.nodes["METAL"].outputs[0]}[what]
    nt.links.new(src, em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def preview_material(m):
    """Route a source material to its full BSDF (for looking at sculpts directly)."""
    route(m, "normal")


def final_material(name, albedo, normal, orm, double_sided=True):
    """The glTF material: base colour, normal map and an ORM texture
    (R occlusion, G roughness, B metalness) - the layout glTF and three.js expect."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _n(nt, "ShaderNodeOutputMaterial", None, (800, 0))
    bs = _n(nt, "ShaderNodeBsdfPrincipled", None, (400, 0))
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    ia = _n(nt, "ShaderNodeTexImage", None, (-400, 300), image=albedo)
    nt.links.new(ia.outputs["Color"], bs.inputs["Base Color"])
    io = _n(nt, "ShaderNodeTexImage", None, (-400, 0), image=orm)
    sep = _n(nt, "ShaderNodeSeparateColor", None, (-100, 0))
    nt.links.new(io.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    inn = _n(nt, "ShaderNodeTexImage", None, (-400, -300), image=normal)
    nm = _n(nt, "ShaderNodeNormalMap", None, (-100, -300))
    nt.links.new(inn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    # occlusion: the exporter looks for a group named "glTF Material Output"
    grp = gltf_output_group()
    g = _n(nt, "ShaderNodeGroup", None, (400, -400))
    g.node_tree = grp
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    bs.inputs["Specular IOR Level"].default_value = 0.5
    m.use_backface_culling = not double_sided
    return m


def gltf_output_group():
    g = bpy.data.node_groups.get("glTF Material Output")
    if g:
        return g
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return g
