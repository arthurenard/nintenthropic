"""Assemble a vehicle's node tree from its baked parts: one root empty at
ground level under the vehicle's centre (facing Blender -Y = glTF +Z), the
mesh nodes (body, engine, bed, canvas, cab.glass), one node per wheel with its
origin on the axle, and the contract's empties.

Blender object names carry the vehicle as a prefix (`truck.wheel.1`) because
Blender cannot hold two objects of the same name; export.py strips it in the
GLB so both vehicles expose `wheel.1`, `engine`, `seat.driver`...
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .geo import a2b, empty
from .vehicle import facing_rot

SURFACE = {"body": "metal", "engine": "metal", "bed": "wood", "canvas": "cloth", "cab.glass": "glass"}
MIRROR = Matrix.Scale(-1.0, 4, (1.0, 0.0, 0.0))


def join(objs, name):
    objs = [o for o in objs if o is not None]
    base = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def mesh_copy(me, M, name):
    m2 = me.copy()
    m2.name = name
    m2.transform(M)
    if M.determinant() < 0:
        m2.flip_normals()
    m2.update()
    return m2


def drop_material(me, mat_suffix):
    """Delete the faces of one material (the inner dual wheel's hidden rim face)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    idx = [i for i, m in enumerate(me.materials) if m and m.name.endswith("." + mat_suffix)]
    kill = [f for f in bm.faces if f.material_index in idx]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return me


def merge_meshes(meshes, name):
    """One mesh from several with identical material slots (wheel copies)."""
    bm = bmesh.new()
    for me in meshes:
        bm.from_mesh(me)
    out = meshes[0].copy()
    out.name = name
    bm.to_mesh(out)
    bm.free()
    for me in meshes:
        bpy.data.meshes.remove(me)
    return out


def wheel_meshes(v, proto):
    """Mesh data for each kind of wheel node, shared between nodes of a kind
    (the exporter writes a shared mesh once)."""
    P = proto.data
    kinds = {}
    for w in v.wheels:
        key = (w["side"], w["dual"])
        if key in kinds:
            continue
        side = 1.0 if w["side"] == "L" else -1.0          # the rim faces outward
        base = Matrix.Identity(4) if side > 0 else MIRROR
        nm = f"{v.name}.wheel.{w['side']}{'d' if w['dual'] else 's'}"
        if w["dual"]:
            d = w["dual"]
            outer = mesh_copy(P, Matrix.Translation((side * d, 0, 0)) @ base, nm + ".o")
            inner = drop_material(mesh_copy(P, Matrix.Translation((-side * d, 0, 0)) @ base @ MIRROR, nm + ".i"), "rim")
            kinds[key] = merge_meshes([outer, inner], nm)
        else:
            kinds[key] = mesh_copy(P, base, nm)
    return kinds


def assemble(v, parts, proto, col, keep_proto=False):
    """parts: [(object, export name, density)]. Returns the root empty."""
    root = empty(v.name, col, (0.0, 0.0, 0.0), size=1.0, **{k: val for k, val in v.info.items()})
    by = {}
    for ob, export, _ in parts:
        by.setdefault(export, []).append(ob)
    # the spare wheels ride in the body mesh (they share the wheels' texels)
    for pos, axle in v.spares:
        me = mesh_copy(proto.data, Matrix.Identity(4), f"{v.name}.spare")
        ob = bpy.data.objects.new(f"{v.name}.spare", me)
        col.objects.link(ob)
        yaw = math.atan2(axle[1], axle[0])                  # authoring yaw of the axle
        ob.matrix_world = Matrix.Translation(a2b(pos)) @ Matrix.Rotation(math.pi + yaw, 4, 'Z')
        with bpy.context.temp_override(active_object=ob, selected_editable_objects=[ob], selected_objects=[ob]):
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        by["body"].append(ob)
    for export, obs in by.items():
        ob = join(obs, f"{v.name}.{export}")
        ob.parent = root
        ob["surface"] = SURFACE[export]
    g = v.glass.build(col, smooth_angle=10)
    g.name = f"{v.name}.cab.glass"
    g.data.name = g.name
    g.parent = root
    g["surface"] = "glass"
    kinds = wheel_meshes(v, proto)
    for w in v.wheels:
        me = kinds[(w["side"], w["dual"])]
        ob = bpy.data.objects.new(f"{v.name}.wheel.{w['n']}", me)
        col.objects.link(ob)
        ob.location = a2b(w["pos"])
        ob.parent = root
        ob["surface"] = "metal"
        ob["radius"] = round(v.wheel_spec["R"], 3)
        ob["steer"] = bool(w["steer"])
        ob["side"] = "left" if w["side"] == "L" else "right"
        ob["dual"] = bool(w["dual"])
    for name, pos, facing, props in v.empties:
        e = empty(f"{v.name}.{name}", col, a2b(pos), rot_z=facing_rot(facing), size=0.25, **props)
        e.parent = root
    if not keep_proto:
        me = proto.data
        bpy.data.objects.remove(proto)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return root


def triangles(root):
    t = 0
    for ob in root.children_recursive:
        if ob.type == 'MESH':
            t += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return t
