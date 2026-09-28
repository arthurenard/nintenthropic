"""bmesh shape tools for wreckage: torn outlines, sheets with thickness,
crumpling, folding, denting, and tearing holes. Everything takes a seeded
random.Random so a fragment is the same fragment on every build."""

import math

import bmesh
from mathutils import Matrix, Vector, noise as mnoise


def torn_outline(rx, ry, rng, n=28, jag=0.22, spikes=0.35):
    """A jagged closed outline (2D, CCW): an ellipse whose radius wanders
    with low-frequency noise, notched and spiked where metal tore."""
    pts = []
    ph = rng.uniform(0, 100)
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3) * math.pi / n
        r = 1.0 + jag * mnoise.noise(Vector((math.cos(a) * 1.3 + ph, math.sin(a) * 1.3, ph)))
        if rng.random() < spikes:
            r *= rng.uniform(0.72, 1.18)
        pts.append((math.cos(a) * rx * r, math.sin(a) * ry * r))
    return pts


def sheet(outline, thick, subdiv_len=0.02, mats=(0, 1, 2)):
    """A flat plate from an outline (XY), grid-subdivided so it can bend and
    crumple, extruded to `thick` along +Z. Face material indices: top,
    bottom, edge (mats)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.0)) for x, y in outline]
    f = bm.faces.new(vs)
    # triangulate the cap then subdivide so it bends smoothly
    bmesh.ops.triangulate(bm, faces=[f])
    L = max(max(abs(x) for x, y in outline), max(abs(y) for x, y in outline)) * 2
    cuts = max(1, min(8, int(L / subdiv_len / 4)))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for fc in bm.faces:
        fc.material_index = mats[1]
    # keep the originals as the bottom (see bl.Geo.sheet)
    ext = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:] + bm.edges[:] + bm.verts[:], use_keep_orig=True)
    top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMFace)]
    for v in [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += thick
    for fc in bm.faces:
        fc.material_index = mats[2]
    for fc in top:
        fc.material_index = mats[0]
    # the original (bottom) faces
    for fc in bm.faces:
        if fc.normal.z < -0.5 and fc not in top:
            fc.material_index = mats[1]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for fc in bm.faces:
        if fc in top:
            fc.material_index = mats[0]
        elif abs(fc.normal.z) > 0.7:
            fc.material_index = mats[1]
        else:
            fc.material_index = mats[2]
    return bm


def crumple(bm, amp, freq, seed=0.0, along=None):
    """Displace every vertex by 3D noise: dents and creases. `along` limits
    the push to one direction (e.g. a plate's normal)."""
    off = Vector((seed * 3.1, seed * 7.7, seed * 1.3))
    for v in bm.verts:
        p = v.co * freq + off
        if along is not None:
            v.co += Vector(along) * (amp * mnoise.noise(p))
        else:
            d = Vector((mnoise.noise(p), mnoise.noise(p + Vector((17.1, 0, 0))), mnoise.noise(p + Vector((0, 31.7, 0)))))
            v.co += d * amp


def fold(bm, point, axis, normal, angle):
    """Fold everything on the +normal side of the line (point, axis) by
    `angle` radians about that line: a bent-over flap."""
    p = Vector(point)
    ax = Vector(axis).normalized()
    n = Vector(normal).normalized()
    R = Matrix.Rotation(angle, 3, ax)
    for v in bm.verts:
        d = v.co - p
        s = d.dot(n)
        if s > 0:
            # blend in over a short radius so the fold is a bend, not a hinge
            t = min(1.0, s / 0.03)
            Rt = Matrix.Rotation(angle * t, 3, ax)
            v.co = p + Rt @ d


def twist(bm, axis_pt, axis, rate):
    """Twist about an axis, `rate` radians per metre along it."""
    p = Vector(axis_pt)
    ax = Vector(axis).normalized()
    for v in bm.verts:
        d = v.co - p
        s = d.dot(ax)
        v.co = p + Matrix.Rotation(rate * s, 3, ax) @ d


def dent(bm, center, radius, depth, direction):
    c = Vector(center)
    dr = Vector(direction).normalized()
    for v in bm.verts:
        d = (v.co - c).length
        if d < radius:
            k = 0.5 + 0.5 * math.cos(math.pi * d / radius)
            v.co += dr * (depth * k)


def tear_hole(bm, center, radius, rng, jag=0.35):
    """Delete the faces inside a jagged radius (a hole punched through a
    panel), measured in the plate's plane."""
    c = Vector(center)
    ph = rng.uniform(0, 50)
    kill = []
    for f in bm.faces:
        p = f.calc_center_median()
        d = p - c
        a = math.atan2(d.y, d.x)
        r = radius * (1 + jag * mnoise.noise(Vector((math.cos(a) * 2 + ph, math.sin(a) * 2, ph))))
        if math.hypot(d.x, d.y) < r:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')


def box_bm(size, segs=(4, 4, 4)):
    """A subdivided box (so it can dent), centred at the origin."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    n = max(segs)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=n, use_grid_fill=True)
    return bm


def cylinder_bm(r, h, seg=24, rings=6, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=h)
    edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=rings)
    return bm


def transform(bm, M):
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts[:])
