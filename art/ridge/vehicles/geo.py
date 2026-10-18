"""Mesh construction for the vehicles: a Builder that accumulates primitives
(bevelled boxes, lofts, revolves, sweeps, prisms) into one Blender object.

Why a builder of raw vertex lists instead of bpy.ops primitives: a vehicle is
a few hundred small parts. Building them as arrays and emitting one object per
(export node, texel density) is fast, deterministic and headless-safe, and it
lets every primitive write its own clean metre-scale UVs ("grain": U along the
part's long axis) that the materials read for wood grain and that lofted
parts (canvas, tyres) use directly as their atlas unwrap.

Authoring frame ("A"): X to the vehicle's right, Y forward, Z up, metres,
origin on the ground. Builders convert to Blender at build() with A2B, a
180-degree turn about Z: the vehicle then faces Blender -Y, which the glTF
exporter turns into +Z (the contract's forward), and its left side is +X in
both Blender and glTF.
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

SEED = 1944
A2B = Matrix.Rotation(math.pi, 4, 'Z')


def rng(tag):
    """A tagged random stream: stable when unrelated parts gain or lose calls."""
    return random.Random(f"{SEED}:{tag}")


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def a2b(p):
    """A point from the authoring frame to Blender."""
    return A2B @ Vector(p)


def fillet(poly, radii, segs=3, closed=True):
    """Round the corners of a 2D polyline. radii: one per vertex (0 = sharp).
    Returns the new point list (tuples)."""
    n = len(poly)
    P = [Vector((p[0], p[1])) for p in poly]
    out = []
    for i in range(n):
        r = radii[i] if i < len(radii) else 0.0
        if r <= 0 or (not closed and (i == 0 or i == n - 1)):
            out.append((P[i].x, P[i].y))
            continue
        a, b, c = P[i - 1], P[i], P[(i + 1) % n]
        d1 = (a - b).normalized()
        d2 = (c - b).normalized()
        ang = math.acos(max(-1.0, min(1.0, d1.dot(d2))))
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append((b.x, b.y))
            continue
        t = r / math.tan(ang / 2)
        t = min(t, (a - b).length * 0.49, (c - b).length * 0.49)
        rr = t * math.tan(ang / 2)
        p1 = b + d1 * t
        p2 = b + d2 * t
        bis = (d1 + d2).normalized()
        ctr = b + bis * (rr / math.sin(ang / 2))
        v1 = p1 - ctr
        v2 = p2 - ctr
        a1 = math.atan2(v1.y, v1.x)
        a2 = math.atan2(v2.y, v2.x)
        da = a2 - a1
        while da > math.pi:
            da -= 2 * math.pi
        while da < -math.pi:
            da += 2 * math.pi
        for k in range(segs + 1):
            aa = a1 + da * k / segs
            out.append((ctr.x + rr * math.cos(aa), ctr.y + rr * math.sin(aa)))
    return out


def polyline_normals(pts, closed=False, outward_sign=1.0):
    """Unit 2D normals (left-hand of the direction of travel times sign) at each
    point, averaged over the two adjacent segments."""
    n = len(pts)
    P = [Vector(p) for p in pts]
    N = []
    for i in range(n):
        if closed:
            a, c = P[i - 1], P[(i + 1) % n]
        else:
            a = P[max(i - 1, 0)]
            c = P[min(i + 1, n - 1)]
        d = (c - a)
        if d.length < 1e-9:
            d = Vector((1.0, 0.0))
        d.normalize()
        N.append(Vector((-d.y, d.x)) * outward_sign)
    return N


def arclen(pts):
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + (Vector(pts[i]) - Vector(pts[i - 1])).length)
    return s


class Builder:
    """Accumulates faces with a material name, a per-part random value and
    metre-scale 'grain' UVs; build() emits one object."""

    def __init__(self, name, prefix, pre=A2B):
        self.name = name
        self.prefix = prefix      # material namespace: "truck" -> truck.paint
        self.pre = pre
        self.V = []
        self.F = []
        self.FM = []
        self.FUV = []
        self.FR = []
        self._rng = rng(name)

    # -- raw ------------------------------------------------------------------
    def add(self, verts, faces, mat, uvs=None, rand=None, M=None):
        """verts: points; faces: index tuples; mat: name or list per face;
        uvs: per-face list of (u, v) per corner (None: box-projected later)."""
        base = len(self.V)
        if M is not None:
            verts = [M @ Vector(v) for v in verts]
        self.V.extend(Vector(v) for v in verts)
        r = self._rng.random() if rand is None else rand
        for i, f in enumerate(faces):
            self.F.append(tuple(base + j for j in f))
            self.FM.append(mat if isinstance(mat, str) else mat[i])
            self.FUV.append(None if uvs is None else uvs[i])
            self.FR.append(r)

    def add_bmesh(self, bm, mat, M=None, rand=None, grain_axis=None, uv_scale=1.0):
        """Faces of a bmesh (local coords), UV box-projected in local metres with
        U along grain_axis (the long axis of the part)."""
        bm.verts.ensure_lookup_table()
        verts = [v.co.copy() for v in bm.verts]
        if grain_axis is None:
            lo = [min(v[i] for v in verts) for i in range(3)]
            hi = [max(v[i] for v in verts) for i in range(3)]
            grain_axis = max(range(3), key=lambda i: hi[i] - lo[i])
        faces, uvs, mats = [], [], []
        for f in bm.faces:
            idx = [v.index for v in f.verts]
            n = f.normal
            na = max(range(3), key=lambda i: abs(n[i]))
            ua = grain_axis if grain_axis != na else (grain_axis + 1) % 3
            va = 3 - na - ua
            faces.append(idx)
            uvs.append([(verts[i][ua] * uv_scale, verts[i][va] * uv_scale) for i in idx])
            if isinstance(mat, dict):
                mats.append(mat.get(f.material_index, mat.get('default', 'paint')))
        self.add(verts, faces, mats if isinstance(mat, dict) else mat, uvs, rand, M)

    # -- primitives -------------------------------------------------------------
    def box(self, lo, hi, mat, M=None, bevel=0.0, segs=1, rand=None, skip=(), taper=None):
        """Axis-aligned box lo..hi (in the local frame M), optionally bevelled.
        taper: (sx, sy) scale of the +Z face (for tapered brackets)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        c = [(lo[i] + hi[i]) / 2 for i in range(3)]
        s = [max(hi[i] - lo[i], 1e-5) for i in range(3)]
        for v in bm.verts:
            x, y, z = v.co
            if taper and z > 0:
                x *= taper[0]
                y *= taper[1]
            v.co = Vector((c[0] + x * s[0], c[1] + y * s[1], c[2] + z * s[2]))
        if skip:
            dirs = {'-x': (0, -1), '+x': (0, 1), '-y': (1, -1), '+y': (1, 1), '-z': (2, -1), '+z': (2, 1)}
            bm.normal_update()
            kill = []
            for f in bm.faces:
                for k in skip:
                    ax, sg = dirs[k]
                    if f.normal[ax] * sg > 0.9:
                        kill.append(f)
            bmesh.ops.delete(bm, geom=kill, context='FACES_ONLY')
        if bevel > 0 and not skip:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(s) * 0.45), offset_type='OFFSET',
                            segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
        bm.normal_update()
        self.add_bmesh(bm, mat, M, rand)
        bm.free()

    def loft(self, rings, mat, closed=True, cap0=False, cap1=False, M=None, rand=None, flip=False):
        """Quads between consecutive rings (lists of 3D points of equal length).
        UV: U = distance along the rings' sequence, V = distance around a ring."""
        nr = len(rings)
        nv = len(rings[0])
        verts = [Vector(p) for ring in rings for p in ring]
        # U: mean distance between consecutive rings; V: arc length around ring 0..
        U = [0.0]
        for i in range(1, nr):
            d = sum((Vector(rings[i][j]) - Vector(rings[i - 1][j])).length for j in range(nv)) / nv
            U.append(U[-1] + d)
        Vs = []
        for ring in rings:
            pts = list(ring) + ([ring[0]] if closed else [])
            Vs.append(arclen(pts))
        faces, uvs = [], []
        segs = nv if closed else nv - 1
        for i in range(nr - 1):
            for j in range(segs):
                j2 = (j + 1) % nv
                f = [i * nv + j, i * nv + j2, (i + 1) * nv + j2, (i + 1) * nv + j]
                vj2 = Vs[i][j + 1]
                vj2b = Vs[i + 1][j + 1]
                uv = [(U[i], Vs[i][j]), (U[i], vj2), (U[i + 1], vj2b), (U[i + 1], Vs[i + 1][j])]
                if flip:
                    f.reverse()
                    uv.reverse()
                faces.append(f)
                uvs.append(uv)
        for cap, ri, rev in ((cap0, 0, True), (cap1, nr - 1, False)):
            if cap:
                f = [ri * nv + j for j in range(nv)]
                if rev != flip:
                    f.reverse()
                faces.append(f)
                uvs.append(None)
        self.add(verts, faces, mat, uvs, rand, M)

    def revolve(self, profile, segs, mat, M=None, a0=0.0, a1=2 * math.pi, rand=None, flip=False,
                matlist=None):
        """Revolve a profile [(x, r)] about the local X axis. Full turns share
        the seam vertices. matlist: optional material per profile segment."""
        full = abs(a1 - a0 - 2 * math.pi) < 1e-6
        na = segs if full else segs + 1
        rings = []
        for k in range(na):
            th = a0 + (a1 - a0) * k / segs
            rings.append([(x, r * math.cos(th), r * math.sin(th)) for x, r in profile])
        # rings run around the axis; profile points along each ring. A point
        # on the axis (r = 0) is one shared pole vertex so it shades smooth.
        npf = len(profile)
        verts = [Vector(p) for ring in rings for p in ring]
        pole = {j: j for j in range(npf) if profile[j][1] < 1e-7}
        sprof = arclen([(x, r) for x, r in profile])
        rmax = max(r for _, r in profile)
        # Orientation: the face normal is the left-hand normal of the profile's
        # direction in the (x, r) plane (moving +x at radius r faces away from
        # the axis; moving +r faces -X). Traverse closed sections clockwise.
        faces, uvs, mats = [], [], []
        for k in range(segs):
            k2 = (k + 1) % na if full else k + 1
            for j in range(npf - 1):
                f = [k * npf + j, k2 * npf + j, k2 * npf + j + 1, k * npf + j + 1]
                f = [pole[i % npf] if (i % npf) in pole else i for i in f]
                u0 = (a1 - a0) * k / segs * rmax
                u1 = (a1 - a0) * (k + 1) / segs * rmax
                uv = [(u0, sprof[j]), (u1, sprof[j]), (u1, sprof[j + 1]), (u0, sprof[j + 1])]
                # a point on the axis (r = 0) makes a pole: emit a triangle
                if profile[j][1] < 1e-7:
                    f = [f[0], f[2], f[3]]
                    uv = [uv[0], uv[2], uv[3]]
                elif profile[j + 1][1] < 1e-7:
                    f = [f[0], f[1], f[2]]
                    uv = [uv[0], uv[1], uv[2]]
                if flip:
                    f.reverse()
                    uv.reverse()
                faces.append(f)
                uvs.append(uv)
                mats.append(matlist[j] if matlist else mat)
        self.add(verts, faces, mats, uvs, rand, M)

    def disc(self, x, r, segs, mat, M=None, facing=1, rand=None, r_in=0.0):
        """A flat disc (or ring) in the local YZ plane at X=x, facing +X (facing=1) or -X."""
        if r_in > 0:
            prof = [(x, r), (x, r_in)] if facing > 0 else [(x, r_in), (x, r)]
            self.revolve(prof, segs, mat, M, rand=rand)
            return
        verts = [(x, r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs)) for k in range(segs)]
        f = list(range(segs))
        if facing < 0:
            f.reverse()
        uv = [[(verts[i][1], verts[i][2]) for i in f]]
        self.add(verts, [f], mat, uv, rand, M)

    def cyl(self, p0, p1, r, segs, mat, caps=True, rand=None, r1=None, up=(0, 0, 1)):
        """A cylinder (or cone) from p0 to p1 (local points, any direction)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        x = d.normalized()
        upv = Vector(up)
        if abs(x.dot(upv)) > 0.95:
            upv = Vector((1, 0, 0)) if abs(x.x) < 0.9 else Vector((0, 1, 0))
        y = upv.cross(x).normalized()
        z = x.cross(y)
        M = Matrix.Identity(4)
        M.col[0][:3] = x
        M.col[1][:3] = y
        M.col[2][:3] = z
        M.col[3][:3] = p0
        rr1 = r if r1 is None else r1
        prof = [(0.0, r), (L, rr1)]
        if caps:
            prof = [(0.0, 0.0)] + prof + [(L, 0.0)]
        self.revolve(prof, segs, mat, M, rand=rand)

    def sweep(self, path, section, mat, closed_path=False, closed_section=True, up=(0, 0, 1),
              M=None, rand=None, caps=False, scales=None, flip=False):
        """Sweep a 2D section [(sx, sy)] along a 3D path. The section's X axis
        is side = tangent x up, its Y axis is up' = side x tangent."""
        P = [Vector(p) for p in path]
        n = len(P)
        rings = []
        upv = Vector(up)
        for i in range(n):
            if closed_path:
                t = P[(i + 1) % n] - P[i - 1]
            else:
                t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            t.normalize()
            side = t.cross(upv)
            if side.length < 1e-6:
                side = t.cross(Vector((1, 0, 0)))
            side.normalize()
            u2 = side.cross(t).normalized()
            s = scales[i] if scales else 1.0
            rings.append([P[i] + side * (sx * s) + u2 * (sy * s) for sx, sy in section])
        if closed_path:
            rings.append(rings[0])
        # a counter-clockwise section faces outward (the plain loft order would face in)
        self.loft(rings, mat, closed=closed_section, cap0=caps, cap1=caps, M=M, rand=rand, flip=not flip)

    def prism(self, poly, z0, z1, mat, M=None, rand=None, caps=True):
        """Extrude a 2D polygon (local XY, counter-clockwise) from z0 to z1."""
        n = len(poly)
        verts = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
        faces, uvs = [], []
        s = arclen(list(poly) + [poly[0]])
        for i in range(n):
            j = (i + 1) % n
            faces.append([i, j, n + j, n + i])
            uvs.append([(s[i], z0), (s[i + 1], z0), (s[i + 1], z1), (s[i], z1)])
        if caps:
            faces.append(list(range(n))[::-1])
            uvs.append([(verts[i][0], verts[i][1]) for i in list(range(n))[::-1]])
            faces.append([n + i for i in range(n)])
            uvs.append([(verts[n + i][0], verts[n + i][1]) for i in range(n)])
        self.add(verts, faces, mat, uvs, rand, M)

    def mirror_x(self, start):
        """Mirror every face added since index `start` (faces) across X=0."""
        fend = len(self.F)
        vmap = {}
        for fi in range(start, fend):
            f = self.F[fi]
            nf = []
            for vi in f:
                if vi not in vmap:
                    v = self.V[vi]
                    vmap[vi] = len(self.V)
                    self.V.append(Vector((-v.x, v.y, v.z)))
                nf.append(vmap[vi])
            self.F.append(tuple(reversed(nf)))
            self.FM.append(self.FM[fi])
            uv = self.FUV[fi]
            self.FUV.append(None if uv is None else list(reversed(uv)))
            self.FR.append(self.FR[fi])

    def mark(self):
        return len(self.F)

    def extract(self, mats, name):
        """Move the faces whose material is in `mats` into a new Builder (so
        they can be unwrapped at another texel density), keeping shared
        vertices shared on both sides."""
        nb = Builder(name, self.prefix, self.pre)
        keepV, keepF, keepM, keepUV, keepR = [], [], [], [], []
        kmap, nmap = {}, {}
        for fi, f in enumerate(self.F):
            moving = self.FM[fi] in mats
            tgtV = nb.V if moving else keepV
            vmap = nmap if moving else kmap
            nf = []
            for vi in f:
                if vi not in vmap:
                    vmap[vi] = len(tgtV)
                    tgtV.append(self.V[vi])
                nf.append(vmap[vi])
            if moving:
                nb.F.append(tuple(nf))
                nb.FM.append(self.FM[fi])
                nb.FUV.append(self.FUV[fi])
                nb.FR.append(self.FR[fi])
            else:
                keepF.append(tuple(nf))
                keepM.append(self.FM[fi])
                keepUV.append(self.FUV[fi])
                keepR.append(self.FR[fi])
        self.V, self.F, self.FM, self.FUV, self.FR = keepV, keepF, keepM, keepUV, keepR
        return nb

    def add_object(self, ob, M=None, strip_prefix=True):
        """Append a Blender mesh object (e.g. after a boolean) into this builder."""
        me = ob.data
        Mw = ob.matrix_world if M is None else M
        base = len(self.V)
        self.V.extend(Mw @ v.co for v in me.vertices)
        uvl = me.uv_layers.get("grain")
        ra = me.attributes.get("rand")
        for p in me.polygons:
            self.F.append(tuple(base + i for i in p.vertices))
            mname = me.materials[p.material_index].name if me.materials else "paint"
            if strip_prefix and "." in mname:
                mname = mname.split(".", 1)[1]
            self.FM.append(mname)
            if uvl:
                self.FUV.append([tuple(uvl.data[li].uv) for li in p.loop_indices])
            else:
                self.FUV.append(None)
            self.FR.append(ra.data[p.index].value if ra and ra.domain == 'FACE' else self._rng.random())

    # -- output -----------------------------------------------------------------
    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def build(self, col, smooth_angle=35.0, **props):
        if not self.F:
            return None
        pre = self.pre
        verts = [tuple(pre @ v) if pre is not None else tuple(v) for v in self.V]
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(verts, [], self.F)
        slots = []
        for m in self.FM:
            if m not in slots:
                slots.append(m)
        for s in slots:
            me.materials.append(src_material(f"{self.prefix}.{s}"))
        idx = {s: i for i, s in enumerate(slots)}
        me.polygons.foreach_set("material_index", [idx[s] for s in self.FM])
        attr = me.attributes.new("rand", 'FLOAT', 'FACE')
        attr.data.foreach_set("value", self.FR)
        uvl = me.uv_layers.new(name="grain")
        flat = []
        for fi, f in enumerate(self.F):
            uv = self.FUV[fi]
            if uv is None or len(uv) != len(f):
                # box projection in authoring metres by the face normal
                pts = [self.V[i] for i in f]
                nrm = Vector((0, 0, 0))
                for k in range(len(pts)):
                    nrm += pts[k].cross(pts[(k + 1) % len(pts)])
                na = max(range(3), key=lambda i: abs(nrm[i]))
                ua, va = [(1, 2), (0, 2), (0, 1)][na]
                uv = [(p[ua], p[va]) for p in pts]
            for u in uv:
                flat.extend(u)
        uvl.data.foreach_set("uv", flat)
        me.validate(clean_customdata=False)
        me.update()
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        ob = bpy.data.objects.new(self.name, me)
        col.objects.link(ob)
        for k, v in props.items():
            ob[k] = v
        return ob


def src_material(name):
    """Placeholder material by name; paint.py fills its node tree before baking."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    return m


# ---------------------------------------------------------------------------
# modifier helpers (data API, no operators)

def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def solidify(ob, thickness, offset=-1.0, rim=True, inner_mat=0):
    """Give a sheet thickness. inner_mat: material index added to the new
    (inner) faces, so the inside of a cab or a cover can be told apart and
    unwrapped/painted on its own (its rims keep the outer material)."""
    m = ob.modifiers.new("solid", 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = True
    m.use_quality_normals = True
    m.material_offset = inner_mat
    m.material_offset_rim = 0
    return apply_modifiers(ob)


def boolean(ob, cutters, op='DIFFERENCE'):
    for c in cutters:
        m = ob.modifiers.new("bool", 'BOOLEAN')
        m.operation = op
        m.solver = 'EXACT'
        m.object = c
        c.hide_render = True
        c.hide_viewport = True
    apply_modifiers(ob)
    for c in cutters:
        me = c.data
        bpy.data.objects.remove(c)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def empty(name, col, loc, rot_z=0.0, size=0.2, **props):
    """An empty in Blender coordinates; rot_z in radians about the vertical."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = 'ARROWS'
    ob.empty_display_size = size
    ob.location = loc
    ob.rotation_euler = (0.0, 0.0, rot_z)
    col.objects.link(ob)
    for k, v in props.items():
        ob[k] = v
    return ob


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc
