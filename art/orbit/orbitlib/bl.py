"""Blender plumbing for the orbit build: scenes, collections, custom props,
Cycles on the GPU, and `Geo`, a builder that assembles many primitives
(boxes, tubes, lathed rings, bolts, sheets) into one mesh.

Why a builder: the cupola frame is hundreds of bolts, brackets and cable
clips; making each its own object would crawl and bloat the glTF. Geo
writes raw vertices and faces, one object per part, with:
  - a material slot per face,
  - UV layer "tex": metres, U along the primitive's main axis (brushing,
    weave and machining marks follow each part however it is turned),
  - face attribute "rand": one random value per primitive, so no two bolts
    or blankets weather alike.

Coordinates are Blender's (Z up). Seeded: `rng(tag)` streams are stable.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

SEED = 1998            # the year the first station module flew


def rng(tag):
    return random.Random(f"{SEED}:{tag}")


# ---------------------------------------------------------------------------
# Scene

def reset_scene(name="Orbit"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = name
    sc.unit_settings.system = 'METRIC'
    return sc


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def tag(ob, **props):
    for k, v in props.items():
        ob[k] = v
    return ob


def empty(name, col, matrix=None, loc=None, size=0.1, display='PLAIN_AXES', parent=None, **props):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    col.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    if matrix is not None:
        ob.matrix_world = matrix
    elif loc is not None:
        ob.location = loc
    tag(ob, **props)
    return ob


def setup_gpu(scene=None):
    """Cycles on the Metal GPU. Headless builds share this machine with
    other bakes, so only the GPU is asked for (CPU threads stay free)."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                break
        except TypeError:
            continue
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    for sc in ([scene] if scene else bpy.data.scenes):
        sc.cycles.device = 'GPU'


def look_matrix(pos, forward, up=(0, 0, 1)):
    """4x4 world matrix at pos whose local +Y points along forward and +Z as
    close to up as possible. (+Y because the glTF exporter turns a node's
    Blender +Y into its glTF -Z: its 'forward' in three.js.)"""
    f = Vector(forward).normalized()
    u = Vector(up)
    z = u - f * u.dot(f)
    if z.length < 1e-6:
        z = Vector((1, 0, 0)) if abs(f.x) < 0.9 else Vector((0, 1, 0))
        z = z - f * z.dot(f)
    z.normalize()
    x = f.cross(z)
    m = Matrix((x, f, z)).transposed().to_4x4()
    m.translation = Vector(pos)
    return m


def frame(origin, x, y, z):
    """4x4 from an origin and three axes (need not be orthonormal)."""
    m = Matrix((Vector(x), Vector(y), Vector(z))).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


# ---------------------------------------------------------------------------
# Geo: many primitives, one mesh

class Geo:
    def __init__(self, name):
        self.name = name
        self.V = []            # vertex positions (Vector)
        self.F = []            # faces: tuple of vertex indices
        self.FM = []           # material name per face
        self.FR = []           # rand per face
        self.UV = []           # per face list of (u, v)
        self.FS = []           # smooth flag per face
        self.slots = []
        self._r = rng(name)

    # -- low level -----------------------------------------------------------
    def _slot(self, m):
        if m not in self.slots:
            self.slots.append(m)
        return m

    def verts(self, pts, M=None):
        base = len(self.V)
        # a mirrored frame (determinant < 0) reverses every face's winding:
        # remember it so face() can put the winding (and the normal) back
        self._flip = M is not None and M.to_3x3().determinant() < 0
        if M is None:
            self.V.extend(Vector(p) for p in pts)
        else:
            self.V.extend(M @ Vector(p) for p in pts)
        return base

    def face(self, idx, mat, uv=None, rand=None, smooth=False):
        idx = list(idx)
        if getattr(self, '_flip', False):
            idx = idx[::-1]
            if uv is not None:
                uv = list(uv)[::-1]
        self.F.append(tuple(idx))
        self.FM.append(self._slot(mat))
        self.FR.append(self._r.random() if rand is None else rand)
        self.UV.append(uv if uv is not None else [(0.0, 0.0)] * len(idx))
        self.FS.append(smooth)

    def poly(self, pts, mat, M=None, uv=None, rand=None, smooth=False):
        """A polygon from points (local), planar metres UV by default."""
        b = self.verts(pts, M)
        if uv is None:
            uv = planar_uv([Vector(p) for p in pts])
        self.face(range(b, b + len(pts)), mat, uv, rand, smooth)

    # -- primitives ----------------------------------------------------------
    def box(self, M, size, mat, center=(0, 0, 0), rand=None, skip=(), bevel=0.0, mats=None):
        """Box of `size` (x, y, z) centred at `center` in the frame M.
        bevel > 0 chamfers the edges (a real part never has razor edges,
        and the chamfers are what catch the light)."""
        r = self._r.random() if rand is None else rand
        sx, sy, sz = (s / 2 for s in size)
        cx, cy, cz = center
        if bevel <= 0:
            P = [(cx + x * sx, cy + y * sy, cz + z * sz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
            b = self.verts(P, M)
            faces = {'-x': (0, 1, 3, 2), '+x': (4, 6, 7, 5), '-y': (0, 4, 5, 1), '+y': (2, 3, 7, 6),
                     '-z': (0, 2, 6, 4), '+z': (1, 5, 7, 3)}
            for k, f in faces.items():
                if k in skip:
                    continue
                pts = [P[i] for i in f]
                self.face([b + i for i in f], (mats or {}).get(k, mat), box_uv(pts, k, size), r)
            return
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * size[0] + cx, v.co.y * size[1] + cy, v.co.z * size[2] + cz))
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=1,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
        self.add_bmesh(bm, M, mat, r, uv='box')
        bm.free()

    def cyl(self, M, p0, p1, r, mat, seg=16, caps=(True, True), r1=None, rand=None, smooth=True, cap_mat=None):
        """Cylinder (or cone, r1) from p0 to p1 in frame M."""
        rr = self._r.random() if rand is None else rand
        p0, p1 = Vector(p0), Vector(p1)
        ax = p1 - p0
        L = ax.length
        z = ax.normalized()
        x = z.orthogonal().normalized()
        y = z.cross(x)
        r1 = r if r1 is None else r1
        ring0, ring1 = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            d = x * math.cos(a) + y * math.sin(a)
            ring0.append(p0 + d * r)
            ring1.append(p1 + d * r1)
        b0 = self.verts(ring0, M)
        b1 = self.verts(ring1, M)
        circ = 2 * math.pi * max(r, r1)
        for i in range(seg):
            j = (i + 1) % seg
            u0, u1 = i / seg * circ, (i + 1) / seg * circ
            self.face([b0 + i, b0 + j, b1 + j, b1 + i], mat, [(0, u0), (0, u1), (L, u1), (L, u0)], rr, smooth)
        if caps[0]:
            self.face([b0 + i for i in reversed(range(seg))], cap_mat or mat,
                      [(math.cos(2 * math.pi * i / seg) * r, math.sin(2 * math.pi * i / seg) * r) for i in reversed(range(seg))], rr)
        if caps[1]:
            self.face([b1 + i for i in range(seg)], cap_mat or mat,
                      [(math.cos(2 * math.pi * i / seg) * r1, math.sin(2 * math.pi * i / seg) * r1) for i in range(seg)], rr)

    def lathe(self, M, profile, mat, seg=48, a0=0.0, a1=2 * math.pi, rand=None, smooth=True, closed=None, mats=None):
        """Revolve a profile [(radius, height), ...] about local Z. UV: U
        along the profile (metres), V around (metres at the profile's
        radius): machining marks run round a turned part."""
        rr = self._r.random() if rand is None else rand
        full = closed if closed is not None else abs(a1 - a0 - 2 * math.pi) < 1e-6
        n = seg if full else seg + 1
        rings = []
        for i in range(n):
            a = a0 + (a1 - a0) * i / seg
            c, s = math.cos(a), math.sin(a)
            rings.append(self.verts([(r * c, r * s, h) for r, h in profile], M))
        # arc length along the profile
        acc = [0.0]
        for k in range(1, len(profile)):
            acc.append(acc[-1] + math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
        for i in range(seg):
            i2 = (i + 1) % n if full else i + 1
            for k in range(len(profile) - 1):
                ra = max(profile[k][0], profile[k + 1][0], 1e-3)
                v0 = (a0 + (a1 - a0) * i / seg) * ra
                v1 = (a0 + (a1 - a0) * (i + 1) / seg) * ra
                m = mats[k] if mats else mat
                self.face([rings[i] + k, rings[i2] + k, rings[i2] + k + 1, rings[i] + k + 1], m,
                          [(acc[k], v0), (acc[k], v1), (acc[k + 1], v1), (acc[k + 1], v0)], rr, smooth)

    def tube(self, M, pts, r, mat, seg=10, caps=True, rand=None, smooth=True, twist=0.0):
        """A tube swept along a polyline (cables, handrails, hoses), with
        rotation-minimising frames so it never kinks or twists."""
        rr = self._r.random() if rand is None else rand
        P = [Vector(p) for p in pts]
        T = []
        for i in range(len(P)):
            a = P[max(i - 1, 0)]
            b = P[min(i + 1, len(P) - 1)]
            T.append((b - a).normalized())
        n = T[0].orthogonal().normalized()
        rings = []
        acc = 0.0
        L = [0.0]
        for i in range(len(P)):
            if i > 0:
                # parallel transport the normal
                axis = T[i - 1].cross(T[i])
                if axis.length > 1e-8:
                    ang = T[i - 1].angle(T[i])
                    n = Matrix.Rotation(ang, 3, axis.normalized()) @ n
                acc += (P[i] - P[i - 1]).length
                L.append(acc)
            b = n.cross(T[i]).normalized()
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg + twist * L[-1]
                ring.append(P[i] + (n * math.cos(a) + b * math.sin(a)) * r)
            rings.append(self.verts(ring, M))
        circ = 2 * math.pi * r
        for i in range(len(P) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                self.face([rings[i] + k, rings[i] + k2, rings[i + 1] + k2, rings[i + 1] + k], mat,
                          [(L[i], k / seg * circ), (L[i], (k + 1) / seg * circ), (L[i + 1], (k + 1) / seg * circ),
                           (L[i + 1], k / seg * circ)], rr, smooth)
        if caps:
            self.face([rings[0] + k for k in reversed(range(seg))], mat, None, rr)
            self.face([rings[-1] + k for k in range(seg)], mat, None, rr)

    def bolt(self, M, pos, normal, mat, head=0.008, height=0.005, seg=6, washer=True, rand=None, washer_mat=None):
        """A hex (or socket) head bolt with a washer, seated on a surface."""
        n = Vector(normal).normalized()
        p = Vector(pos)
        rr = self._r.random() if rand is None else rand
        if washer:
            self.cyl(M, p, p + n * 0.0012, head * 1.35, washer_mat or mat, seg=12, caps=(False, True), rand=rr)
            p = p + n * 0.0012
        self.cyl(M, p, p + n * height, head, mat, seg=seg, caps=(False, True), rand=rr, smooth=False)

    def sheet(self, M, outline, thick, mat, rand=None, side_mat=None, holes=()):
        """An extruded flat plate from a 2D outline (in local XY), thickness
        along +Z. Holes are extra outlines cut through (via bmesh)."""
        rr = self._r.random() if rand is None else rand
        if holes:
            self._sheet_with_holes(M, outline, holes, thick, mat, rr, side_mat)
            return
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, 0.0)) for x, y in outline]
        f = bm.faces.new(vs)
        # keep the original face: without use_keep_orig the extrusion
        # moves it, and the plate is an open shell missing one side
        ext = bmesh.ops.extrude_face_region(bm, geom=[f] + list(f.edges) + list(f.verts), use_keep_orig=True)
        for v in [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z += thick
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self.add_bmesh(bm, M, mat, rr, uv='box', side_mat=side_mat)
        bm.free()

    def _sheet_with_holes(self, M, outline, holes, thick, mat, rr, side_mat):
        from mathutils.geometry import tessellate_polygon
        loops = [[Vector((x, y, 0)) for x, y in outline]] + [[Vector((x, y, 0)) for x, y in h] for h in holes]
        tris = tessellate_polygon(loops)
        flat = [p for lp in loops for p in lp]
        for z, flip in ((0.0, True), (thick, False)):
            b = self.verts([(p.x, p.y, z) for p in flat], M)
            for t in tris:
                idx = [b + i for i in (reversed(t) if flip else t)]
                uv = [(flat[i].x, flat[i].y) for i in (reversed(t) if flip else t)]
                self.face(idx, mat, uv, rr)
        for lp in loops:
            n = len(lp)
            for i in range(n):
                a, c = lp[i], lp[(i + 1) % n]
                pts = [(a.x, a.y, 0), (c.x, c.y, 0), (c.x, c.y, thick), (a.x, a.y, thick)]
                L = (c - a).length
                self.poly(pts, side_mat or mat, M, [(0, 0), (L, 0), (L, thick), (0, thick)], rr)

    def add_bmesh(self, bm, M, mat, rand=None, uv='box', side_mat=None, smooth=False, mats=None):
        rr = self._r.random() if rand is None else rand
        bm.verts.ensure_lookup_table()
        base = self.verts([v.co for v in bm.verts], M)
        uvl = bm.loops.layers.uv.active
        for f in bm.faces:
            pts = [v.co for v in f.verts]
            if uvl is not None and uv == 'keep':
                uvs = [tuple(l[uvl].uv) for l in f.loops]
            else:
                ax = max(range(3), key=lambda i: abs(f.normal[i]))
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                uvs = [(p[a], p[b]) for p in pts]
            m = mat
            if mats is not None:
                m = mats[f.material_index] if f.material_index < len(mats) else mat
            elif side_mat is not None and abs(f.normal.z) < 0.5:
                m = side_mat
            self.face([base + v.index for v in f.verts], m, uvs, rr, smooth or f.smooth)

    def merge(self, other):
        base = len(self.V)
        self.V.extend(other.V)
        for f, m, r, uv, s in zip(other.F, other.FM, other.FR, other.UV, other.FS):
            self.F.append(tuple(i + base for i in f))
            self.FM.append(self._slot(m))
            self.FR.append(r)
            self.UV.append(uv)
            self.FS.append(s)

    # -- output ---------------------------------------------------------------
    def build(self, col, materials, smooth_angle=35.0, origin=None, **props):
        """Create the object. materials: dict name -> bpy material (or a
        callable). origin: put the object's origin here (world), keeping the
        geometry where it is."""
        if not self.F:
            return None
        me = bpy.data.meshes.new(self.name)
        V = self.V
        if origin is not None:
            o = Vector(origin)
            V = [v - o for v in V]
        me.from_pydata([tuple(v) for v in V], [], self.F)
        me.validate(clean_customdata=False)
        for s in self.slots:
            me.materials.append(materials[s] if isinstance(materials, dict) else materials(s))
        idx = {s: i for i, s in enumerate(self.slots)}
        me.polygons.foreach_set("material_index", [idx[s] for s in self.FM])
        me.polygons.foreach_set("use_smooth", self.FS)
        a = me.attributes.new("rand", 'FLOAT', 'FACE')
        a.data.foreach_set("value", self.FR)
        uvl = me.uv_layers.new(name="tex")
        flat = []
        for poly_uv in self.UV:
            for u in poly_uv:
                flat.extend(u)
        if len(flat) == len(me.loops) * 2:
            uvl.data.foreach_set("uv", flat)
        me.update()
        try:
            me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        except AttributeError:
            pass
        ob = bpy.data.objects.new(self.name, me)
        col.objects.link(ob)
        if origin is not None:
            ob.location = Vector(origin)
        tag(ob, **props)
        return ob


def planar_uv(pts):
    a, b = pts[0], pts[1]
    ex = (b - a)
    if ex.length < 1e-9:
        return [(0.0, 0.0)] * len(pts)
    ex.normalize()
    n = (pts[1] - pts[0]).cross(pts[-1] - pts[0])
    if n.length < 1e-12 and len(pts) > 2:
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
    n = n.normalized() if n.length > 0 else Vector((0, 0, 1))
    ey = n.cross(ex)
    return [((p - a).dot(ex), (p - a).dot(ey)) for p in pts]


def box_uv(pts, k, size):
    ax = 'xyz'.index(k[1])
    a, b = [(1, 2), (0, 2), (0, 1)][ax]
    # U along the longer of the two in-plane axes
    if size[a] < size[b]:
        a, b = b, a
    return [(p[a], p[b]) for p in pts]


def orient_normals(ob, eye=None):
    """Closed parts: normals outward. Open parts (a label, a panel, a pane)
    have no outside: with an eye given they are turned to face it, which is
    what a bake from that eye and back-face culling both need."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    mw = ob.matrix_world
    eye_l = mw.inverted() @ Vector(eye) if eye is not None else None
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        comp = []
        stack = [f0]
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        closed = all(len(e.link_faces) == 2 for f in comp for e in f.edges)
        if closed:
            bmesh.ops.recalc_face_normals(bm, faces=comp)
        elif eye_l is not None:
            for f in comp:
                if f.normal.dot(eye_l - f.calc_center_median()) < 0:
                    f.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def tri_count(obs):
    n = 0
    for o in obs:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n
