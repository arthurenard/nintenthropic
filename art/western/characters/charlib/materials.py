"""The glTF material every baked character wears: its atlas's base colour,
normal map and ORM texture, wired the way the glTF exporter reads them."""
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
