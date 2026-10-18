"""
The race's effects, modelled for the key art: the boost flame (the game's three nested cones, orange sheath, yellow body,
white-blue core, on both exhausts), sparks, soft cartoon drift smoke, and tyre marks on the road.
"""
import math

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

import kit
from kit import hexl, gm, T, S
import world as W


def _emit(name, colour, strength, alpha_falloff=False):
    m, nt, b = W._mat(name)
    kit._set(b, base=hexl(colour), emit=hexl(colour), emit_k=strength)
    return m


_cone_cache = {}


def _cone_mesh(r, length, segments=28, rings=8, bend=0.0):
    """A teardrop along +y from the origin: round at the base, tapering to a soft point."""
    key = (round(r, 3), round(length, 3), segments, rings, round(bend, 3))
    if key in _cone_cache:
        return _cone_cache[key]
    bm = bmesh.new()
    verts = []
    for i in range(rings + 1):
        t = i / rings
        # a flame profile: full near the base, tapering with a slight belly
        rad = r * (1 - t) ** 0.75 * (1 + 0.25 * math.sin(t * math.pi))
        y = t * length
        off = bend * (t ** 2) * length
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            ring.append(bm.verts.new((math.cos(a) * rad + off, y, math.sin(a) * rad)))
        verts.append(ring)
    for i in range(rings):
        for j in range(segments):
            a, b = verts[i][j], verts[i][(j + 1) % segments]
            c, d = verts[i + 1][(j + 1) % segments], verts[i + 1][j]
            if i == rings - 1:
                bm.faces.new((a, b, d))
            else:
                bm.faces.new((a, b, c, d))
    bm.normal_update()
    mesh = bpy.data.meshes.new("flame")
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    _cone_cache[key] = mesh
    return mesh


def exhaust_flames(kart_parts, name, scale=1.0, bend=0.06, strength=1.0):
    """Both exhausts breathe fire. The game's flame: its cones' radii 0.17/0.125/0.07 and lengths 1.9/1.35/0.85 (kartModel.ts)."""
    body = kart_parts["body"]
    mats = [
        _emit(f"{name}.sheath", "#ff5a00", 4.5 * strength),
        _emit(f"{name}.body", "#ffb020", 8.0 * strength),
        _emit(f"{name}.core", "#b8dcff", 14.0 * strength),
    ]
    out = []
    for side in (1, -1):
        base_g = T(side * kit.KART_EXHAUST[0], kit.KART_EXHAUST[1], kit.KART_EXHAUST[2] + 0.02)
        holder = kit.empty(f"{name}.flame", body, gm(base_g))
        for (r, ln, mat) in ((0.17, 1.9, mats[0]), (0.125, 1.35, mats[1]), (0.07, 0.85, mats[2])):
            mesh = _cone_mesh(r * scale, ln * scale, bend=bend)
            o = bpy.data.objects.new(f"{name}.cone", mesh)
            bpy.context.scene.collection.objects.link(o)
            o.data = mesh
            o.parent = holder
            o.matrix_basis = Matrix.Identity(4)
            o.data.materials.clear()
            o.data.materials.append(mat)
            o.visible_shadow = False
            out.append(o)
        # the glow it throws on the road and the kart
        li = bpy.data.lights.new(f"{name}.glow", "POINT")
        li.color = hexl("#ff8a2a")[:3]
        li.energy = 900.0 * strength
        li.shadow_soft_size = 0.35
        lo = bpy.data.objects.new(f"{name}.glow", li)
        bpy.context.scene.collection.objects.link(lo)
        lo.parent = holder
        lo.location = (0.0, 0.7 * scale, 0.0)
    return out


def sparks(origin_fn, count, rng, name="spark", length=(0.18, 0.6), thickness=0.014, speed_dir=None, spread=0.7, reach=3.2):
    """Sparks streaking out behind a wheel, as thin stretched emissive beads. `origin_fn(i)` gives each one's start (Blender
    world); `speed_dir` the general direction they fly (a Vector)."""
    base = bpy.data.meshes.new("spark")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    bm.to_mesh(base)
    bm.free()
    mats = [_emit(f"{name}.a", "#ffd870", 16.0), _emit(f"{name}.b", "#ffa020", 12.0), _emit(f"{name}.c", "#ff6a10", 9.0)]
    out = []
    d0 = Vector(speed_dir).normalized()
    for i in range(count):
        p = Vector(origin_fn(i))
        # a direction near the general one, with some fan and a lift
        v = d0 + Vector((rng.normal(0, spread * 0.5), rng.normal(0, spread * 0.5), rng.uniform(-0.1, 0.25) * spread))
        v.normalize()
        dist = rng.uniform(0.25, 1.0) ** 1.4 * reach
        pos = p + v * dist + Vector((0, 0, -0.35 * (dist / reach) ** 2))
        ln = rng.uniform(*length) * (0.6 + 0.4 * (1 - dist / reach))
        o = bpy.data.objects.new(f"{name}.{i}", base)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.clear()
        o.data.materials.append(mats[min(2, int(rng.random() * 3))] if rng.random() > 0.4 else mats[0])
        q = v.to_track_quat("Y", "Z")
        o.matrix_basis = Matrix.Translation(pos) @ q.to_matrix().to_4x4() @ S(thickness * rng.uniform(0.7, 1.4), ln, thickness * rng.uniform(0.7, 1.4))
        o.visible_shadow = False
        out.append(o)
    return out


def smoke_material():
    m, nt, b = W._mat("smoke")
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    ng = nt.nodes.new("ShaderNodeNewGeometry")
    nz = W._sep(nt, ng.outputs["Normal"])[2]
    t = W._math(nt, "MULTIPLY", W._math(nt, "ADD", nz, 1.0), 0.5, clamp=True)
    col = W._mix(nt, hexl("#c9d6ea")[:3], hexl("#ffffff")[:3], t)
    kit._set(b, rough=1.0, spec=0.0)
    nt.links.new(col, b.inputs["Base Color"])
    nt.links.new(col, b.inputs["Emission Color"])
    kit._set(b, emit_k=0.35)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    # opaque in the middle of a puff, thin at its rim: soft, cartoon puffs
    fres = W._math(nt, "SUBTRACT", 1.0, lw.outputs["Facing"], clamp=True)
    nt.links.new(W._math(nt, "SUBTRACT", 1.0, W._math(nt, "POWER", fres, 3.0), clamp=True), mx.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mx.inputs[1])
    nt.links.new(b.outputs["BSDF"], mx.inputs[2])
    out = nt.nodes["Material Output"]
    nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])
    return m


def puff(name, centre, radius, mat, rng=None):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=4, location=centre)
    o = bpy.context.object
    o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    # slightly lumpy
    if rng is not None:
        sub = o.modifiers.new("disp", "DISPLACE")
        tex = bpy.data.textures.new(f"{name}.tex", "CLOUDS")
        tex.noise_scale = radius * 0.9
        sub.texture = tex
        sub.strength = radius * 0.35
    o.data.materials.append(mat)
    o.visible_shadow = False
    return o


def ground_ribbon(points, width, material, lift=0.02, widths=None):
    """A flat ribbon along a polyline of world (x, y, z) points: tyre marks. UV v runs 0 -> 1 along it."""
    P = np.asarray(points, float)
    t = np.gradient(P[:, :2], axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    n = np.stack([-t[:, 1], t[:, 0]], axis=1)
    verts, faces, uvs = [], [], []
    L = len(P)
    for i in range(L):
        w = (widths[i] if widths is not None else width) / 2
        for sgn in (-1, 1):
            verts.append((P[i, 0] + n[i, 0] * w * sgn, P[i, 1] + n[i, 1] * w * sgn, P[i, 2] + lift))
            uvs.append((0.0 if sgn < 0 else 1.0, i / (L - 1)))
    for i in range(L - 1):
        a = i * 2
        faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new("ribbon")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uvl = mesh.uv_layers.new(name="UV")
    vi = np.empty(len(mesh.loops), int)
    mesh.loops.foreach_get("vertex_index", vi)
    uvl.data.foreach_set("uv", np.asarray(uvs, float)[vi].ravel())
    o = bpy.data.objects.new("ribbon", mesh)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    o.visible_shadow = False
    return o


def skid_material(strength=1.0):
    m, nt, b = W._mat("skid")
    uv = W._uv(nt).outputs["UV"]
    sep = W._sep(nt, uv)
    # fades out along the ribbon (v 0 = the oldest end), soft at the edges, broken up by noise
    edge = W._math(nt, "MULTIPLY", W._math(nt, "SUBTRACT", 0.5, W._math(nt, "ABSOLUTE", W._math(nt, "SUBTRACT", sep[0], 0.5)), clamp=True), 4.0, clamp=True)
    fade = W._math(nt, "POWER", sep[1], 0.8)
    noise = W._noise(nt, W._comb(nt, W._math(nt, "MULTIPLY", sep[0], 6.0), W._math(nt, "MULTIPLY", sep[1], 60.0)), 1.0, 3.0, 0.6)
    a = W._math(nt, "MULTIPLY", W._math(nt, "MULTIPLY", edge, fade), W._math(nt, "ADD", W._math(nt, "MULTIPLY", noise, 0.7), 0.45), clamp=True)
    a = W._math(nt, "MULTIPLY", a, strength, clamp=True)
    kit._set(b, base=hexl("#14161a"), rough=0.7)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(a, mx.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mx.inputs[1])
    nt.links.new(b.outputs["BSDF"], mx.inputs[2])
    out = nt.nodes["Material Output"]
    nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])
    return m
