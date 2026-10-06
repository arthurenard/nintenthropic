"""Grip Prix's landmark kit: what the world scripts (kitchen.py, funfair.py,
harbour.py, space.py) are written in.

Everything is authored in the GAME's frame: metres, y up, front +z, right -x,
base on y = 0. A `Landmark` is one `landmark.<kind>` node; its `Mesh`es are
the still part and one per turning part (`.spin.<axis>`, about its pivot).
Primitives (lathe, rbox, tube, sweep, loft, prism, torus ...) are built in a
scratch bmesh, placed, welded to the landmark's mesh and painted in vertex
colours by a colour or a function of (point, normal).

What the game wants from the file (src/kart/render/world/landmarks/fromArt.ts):
no textures, so every colour is a vertex colour (materials are white, apart
from the glowing one, whose colour is the vertex colour times a fixed
emission, and the glass one) and light is baked into them: ambient occlusion
by rays against the whole landmark and the ground, plus whatever shine a
colour function paints in. Normals are smooth, creased where the surface
turns by more than CREASE degrees, weighted by area so that a bevelled edge
rounds without puffing the flat faces up.

Material kinds, by name (fromArt reads emissive / transparency / names):
  lit, matte, glossy, metal   solid
  glow                        emissive white, the vertex colour is its colour
  glass                       translucent
"""
from __future__ import annotations

import math
import os
import sys
import time
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

TAU = math.tau
CREASE = 50.0
Vec = Vector

# ─── colour ──────────────────────────────────────────────────────────────────


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def C(hexcode: str, k: float = 1.0) -> tuple:
    """'#rrggbb' (sRGB) to a linear triple, times k."""
    h = hexcode.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (_lin(r) * k, _lin(g) * k, _lin(b) * k)


def mix(a, b, t: float) -> tuple:
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def mul(a, k: float) -> tuple:
    return tuple(x * k for x in a)


def smoothstep(a: float, b: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - a) / ((b - a) or 1e-9)))
    return t * t * (3 - 2 * t)


def faceted(fn):
    """Mark a colour function as per face: it is called once for each face, with the face's centre and normal,
    so stripes and checks end exactly on mesh edges."""
    fn.per_face = True
    return fn


def by_height(y0, y1, bottom, top):
    """Colour function: `bottom` at y0 to `top` at y1."""
    return lambda p, n: mix(bottom, top, (p.y - y0) / ((y1 - y0) or 1))


def shiny(base, k: float = 0.35, sky=(1.0, 1.0, 1.0), ground=None, power: float = 2.0):
    """Colour function: `base` with a baked sky glint on what faces up and a darker underside."""
    ground = ground if ground is not None else mul(base, 0.55)

    def f(p, n):
        up = max(0.0, n.y)
        down = max(0.0, -n.y)
        c = mix(base, sky, k * (up**power))
        return mix(c, ground, 0.5 * down)

    return f


def chrome(dark, light, horizon=0.0, band=0.12, glint=1.0, tint=None):
    """Colour function: a faked environment on a metal surface (sky above, a dark horizon band, a warm floor)."""
    tint = tint or (1.0, 1.0, 1.0)

    def f(p, n):
        y = n.y
        c = mix(dark, light, smoothstep(horizon - band, horizon + band * 3.0, y))
        # a bright sky pole on top, and a thin hot line where the sun would sit
        c = mix(c, (glint, glint, glint), 0.55 * smoothstep(0.55, 0.95, y))
        c = mix(c, mul(dark, 1.25), 0.5 * smoothstep(-0.1, -0.7, y))
        return (c[0] * tint[0], c[1] * tint[1], c[2] * tint[2])

    return f


# ─── materials ───────────────────────────────────────────────────────────────

MATERIALS = {
    "lit": dict(rough=0.6),
    "matte": dict(rough=0.9),
    "glossy": dict(rough=0.12),
    "metal": dict(rough=0.22, metal=1.0),
    "glow": dict(emit=True),
    "glass": dict(alpha=0.4, rough=0.05),
}
NO_OCCLUDER = ("glow", "glass")


def get_material(name: str):
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1, 1, 1, 1) if not spec.get("emit") else (0, 0, 0, 1)
    b.inputs["Roughness"].default_value = spec.get("rough", 0.5)
    b.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    if spec.get("emit"):
        b.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    if "alpha" in spec:
        b.inputs["Alpha"].default_value = spec["alpha"]
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            pass
        m.use_backface_culling = False
    return m


# ─── geometry helpers ────────────────────────────────────────────────────────


def to_blender(v: Vector) -> Vector:
    """Game (x right-handed y up, z front) to Blender (z up)."""
    return Vector((v.x, -v.z, v.y))


def xform(at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)) -> Matrix:
    """Place, from a position, XYZ rotation in degrees (about the game's axes) and a scale."""
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    r = Euler((math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2])), "XYZ").to_matrix().to_4x4()
    s = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return Matrix.Translation(Vector(at)) @ r @ s


def bezier(p0, p1, p2, p3, n: int = 12):
    p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append(u**3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t**3 * p3)
    return out


def catmull(points, per: int = 8, closed: bool = False):
    """A smooth curve through the points (Catmull-Rom); 2D or 3D."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    out = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[0] * 2 - pts[1]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else pts[-1] * 2 - pts[-2]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(pts[-1])
    return out


def arc_pts(cx, cy, r, a0, a1, n):
    """2D arc points, angles in degrees."""
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def cyl_profile(R, H, y0=0.0, rb=0.0, rt=0.0, seg=4, R_top=None):
    """Closed lathe profile of a cylinder (axis to axis) with rounded rims; R_top for a frustum."""
    Rt = R if R_top is None else R_top
    pts = [(0.0, y0)]
    if rb > 0:
        pts += arc_pts(R - rb, y0 + rb, rb, -90, 0, seg)
    else:
        pts += [(R, y0)]
    if rt > 0:
        pts += arc_pts(Rt - rt, y0 + H - rt, rt, 0, 90, seg)
    else:
        pts += [(Rt, y0 + H)]
    pts += [(0.0, y0 + H)]
    return pts


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > eps:
            out.append(p)
    return out


# ─── scratch-bmesh work ──────────────────────────────────────────────────────


def _new_bm():
    return bmesh.new()


def _orient_outward(bm):
    """Flip a closed mesh inside out if its signed volume is negative."""
    vol = 0.0
    for f in bm.faces:
        vs = [v.co for v in f.verts]
        for i in range(1, len(vs) - 1):
            vol += vs[0].dot(vs[i].cross(vs[i + 1]))
    if vol < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))


def _orient_ref(bm, ref: Vector, facing: str = "out"):
    """Turn an open shell so its faces look away from (or toward, facing="in") a point inside it."""
    score = 0.0
    for f in bm.faces:
        score += f.normal.dot(f.calc_center_median() - ref) * f.calc_area()
    if (score < 0 and facing == "out") or (score > 0 and facing == "in"):
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))


def _refine(bm, maxlen: float, rounds: int = 4):
    for _ in range(rounds):
        edges = [e for e in bm.edges if e.calc_length() > maxlen]
        if not edges:
            return
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1, use_grid_fill=True)


def _cut_z(bm, step: float):
    zs = [v.co.z for v in bm.verts]
    if not zs:
        return
    lo, hi = min(zs), max(zs)
    for k in range(int(math.floor(lo / step)) + 1, int(math.floor(hi / step)) + 1):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0, 0, k * step), plane_no=(0, 0, 1))


def loop_normals(bm, crease_deg: float = CREASE, power: float = 0.6):
    """A normal for each loop (face order, loop order): the area-and-angle weighted mean of the faces round the vertex that lie within `crease_deg` of this face."""
    cosc = math.cos(math.radians(crease_deg))
    bm.normal_update()
    per_vert = {}
    for v in bm.verts:
        lst = []
        for l in v.link_loops:
            f = l.face
            a = f.calc_area()
            if a < 1e-12:
                continue
            lst.append((f.normal, l.calc_angle() * (a**power)))
        per_vert[v.index] = lst
    out = []
    for f in bm.faces:
        fn = f.normal
        for l in f.loops:
            acc = Vector()
            for n, w in per_vert[l.vert.index]:
                if n.dot(fn) >= cosc:
                    acc += n * w
            if acc.length < 1e-9:
                acc = fn.copy() if fn.length > 0 else Vector((0, 1, 0))
            out.append(acc.normalized())
    return out


# ─── Mesh: one object's worth of geometry ────────────────────────────────────


class Mesh:
    def __init__(self, lm: "Landmark", name: str, pivot=None, axis: str | None = None, speed: float = 0.0, kind: str = "spin", props: dict | None = None):
        self.lm = lm
        self.kind = kind
        self.props = props or {}
        self.name = name
        self.pivot = Vector(pivot) if pivot is not None else None
        self.axis = axis
        self.speed = speed
        self.bm = bmesh.new()
        self.layer = self.bm.loops.layers.float_color.new("Col")
        self.decal_layer = self.bm.faces.layers.int.new("decal")
        self.mats: list[str] = []
        self.normals: list[Vector] = []
        self.tris = 0
        self._gstack: list[Matrix] = []

    def _gtop(self):
        return self._gstack[-1] if self._gstack else None

    @contextmanager
    def group(self, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), M=None):
        """Everything drawn inside is placed (moved, turned, scaled) by this transform, on top of any enclosing group's:
        a horse, a car, a stall built facing +z about its own origin and put where it goes."""
        top = self._gtop()
        M = M if M is not None else xform(at, rot, scale)
        self._gstack.append(top @ M if top is not None else M)
        try:
            yield self
        finally:
            self._gstack.pop()

    # -- the common tail of every primitive
    def _commit(self, t, M, col, mat, closed=True, flip=False, dense=None, disp=None, ref=None, facing="out"):
        top = self._gtop()
        if top is not None:
            M = top if M is None else top @ M
        if M is not None:
            bmesh.ops.transform(t, matrix=M, verts=list(t.verts))
            if M.determinant() < 0:
                bmesh.ops.reverse_faces(t, faces=list(t.faces))
        if dense:
            _refine(t, dense)
        if closed:
            _orient_outward(t)
        if ref is not None:
            t.normal_update()
            _orient_ref(t, Vector(ref), facing)
        if disp:
            t.normal_update()
            moves = [(v, v.normal * disp(v.co.copy())) for v in t.verts]
            for v, d in moves:
                v.co += d
        if flip:
            bmesh.ops.reverse_faces(t, faces=list(t.faces))
        if self.lm.span:
            _cut_z(t, self.lm.cut)
        t.verts.index_update()
        t.faces.index_update()
        normals = loop_normals(t)
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        vm = {}
        for v in t.verts:
            vm[v.index] = self.bm.verts.new(v.co)
        k = 0
        for f in t.faces:
            try:
                nf = self.bm.faces.new([vm[v.index] for v in f.verts])
            except ValueError:
                k += len(f.loops)
                # keep loop bookkeeping aligned by adding a degenerate-free placeholder is impossible; skip face and its normals
                self._skipped = True
                continue
            nf.smooth = True
            nf.material_index = mi
            per_face = bool(callable(col) and getattr(col, "per_face", False))
            if per_face:
                fn_ = sum((normals[k + i] for i in range(len(f.loops))), Vector())
                fcol = col(f.calc_center_median(), fn_.normalized() if fn_.length > 0 else f.normal)
            for l, nl in zip(f.loops, nf.loops):
                n = normals[k]
                k += 1
                self.normals.append(n)
                if per_face:
                    c = fcol
                elif callable(col):
                    c = col(l.vert.co.copy(), n)
                else:
                    c = col
                nl[self.layer] = (c[0], c[1], c[2], 1.0)
            self.tris += max(1, len(f.verts) - 2)
        t.free()

    # -- primitives ---------------------------------------------------------
    def lathe(self, profile, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=32, col=(1, 1, 1), mat="lit", arc=None, closed=True, flip=False, dense=None, phase=0.0, disp=None, ref=None, facing="out"):
        """Surface of revolution about the local y axis from a (radius, y) profile, bottom to top (counter-clockwise outline).
        `arc=(a0, a1)` degrees makes a partial revolve (open)."""
        t = _new_bm()
        prof = dedupe([(float(r), float(y)) for r, y in profile])
        full = arc is None
        a0, a1 = (0.0, 360.0) if full else arc
        n = segs if full else segs + 1
        rings = []
        for r, y in prof:
            if abs(r) < 1e-7:
                rings.append([t.verts.new((0, y, 0))])
            else:
                ring = []
                for j in range(n):
                    a = math.radians(a0 + (a1 - a0) * (j / (segs if not full else segs)) + phase)
                    ring.append(t.verts.new((r * math.cos(a), y, r * math.sin(a))))
                rings.append(ring)
        for i in range(len(rings) - 1):
            A, B = rings[i], rings[i + 1]
            cols = n if full else n - 1
            for j in range(cols):
                j2 = (j + 1) % n
                a0v, a1v = A[j % len(A)], A[j2 % len(A)]
                b0v, b1v = B[j % len(B)], B[j2 % len(B)]
                vs = [a0v, b0v, b1v, a1v]
                uniq = []
                for v in vs:
                    if v not in uniq:
                        uniq.append(v)
                if len(uniq) >= 3:
                    try:
                        t.faces.new(uniq)
                    except ValueError:
                        pass
        self._commit(t, xform(at, rot, scale), col, mat, closed=closed and full, flip=flip, dense=dense, disp=disp, ref=ref, facing=facing)
        return self

    def sphere(self, r=1.0, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=24, rings=14, col=(1, 1, 1), mat="lit", **kw):
        prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
        prof[0] = (0.0, -r)
        prof[-1] = (0.0, r)
        return self.lathe(prof, at=at, rot=rot, scale=scale, segs=segs, col=col, mat=mat, **kw)

    def cylinder(self, r=1.0, h=1.0, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=24, rb=0.0, rt=0.0, rseg=3, r_top=None, col=(1, 1, 1), mat="lit", centered=False, **kw):
        y0 = -h / 2 if centered else 0.0
        return self.lathe(cyl_profile(r, h, y0, rb, rt, rseg, r_top), at=at, rot=rot, scale=scale, segs=segs, col=col, mat=mat, **kw)

    def cone(self, r=1.0, h=1.0, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=24, rb=0.0, col=(1, 1, 1), mat="lit", **kw):
        prof = [(0.0, 0.0)] + (arc_pts(r - rb, rb, rb, -90, 0, 3) if rb > 0 else [(r, 0.0)]) + [(0.0, h)]
        return self.lathe(prof, at=at, rot=rot, scale=scale, segs=segs, col=col, mat=mat, **kw)

    def rbox(self, size=(1, 1, 1), at=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, bseg=3, col=(1, 1, 1), mat="lit", dense=None, base=False, taper=None, **kw):
        """A (rounded) box, centred on `at` (or sitting on it when base=True). `taper=(kx, kz)` narrows the top."""
        w, h, d = size
        t = _new_bm()
        bmesh.ops.create_cube(t, size=1.0)
        for v in t.verts:
            v.co.x *= w
            v.co.y *= h
            v.co.z *= d
            if taper:
                f = (v.co.y / h + 0.5)
                v.co.x *= 1 - (1 - taper[0]) * f
                v.co.z *= 1 - (1 - taper[1]) * f
        if bevel > 0:
            b = min(bevel, min(w, h, d) * 0.49)
            bmesh.ops.bevel(t, geom=list(t.edges), offset=b, segments=bseg, profile=0.5, affect="EDGES", clamp_overlap=True)
        M = xform((at[0], at[1] + (h / 2 if base else 0), at[2]), rot)
        self._commit(t, M, col, mat, closed=True, dense=dense, **kw)
        return self

    def prism(self, poly, h, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0, col=(1, 1, 1), mat="lit", y0=0.0, **kw):
        """Extrude a polygon given as (x, z) points (counter-clockwise from above) from y0 up by h."""
        t = _new_bm()
        lo = [t.verts.new((x, y0, z)) for x, z in poly]
        hi = [t.verts.new((x, y0 + h, z)) for x, z in poly]
        n = len(poly)
        t.faces.new(lo[::-1])
        t.faces.new(hi)
        for i in range(n):
            j = (i + 1) % n
            t.faces.new([lo[i], lo[j], hi[j], hi[i]])
        if bevel > 0:
            bmesh.ops.bevel(t, geom=list(t.edges), offset=min(bevel, h * 0.45), segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
        self._commit(t, xform(at, rot, scale), col, mat, closed=True, **kw)
        return self

    def prism_xy(self, poly, thick, at=(0, 0, 0), bevel=0.0, **kw):
        """Extrude a polygon given as (x, y) points (counter-clockwise from the front) along z, `thick` deep, centred on at.z."""
        return self.prism([(x, -y) for x, y in poly], thick, at=at, rot=(90, 0, 0), y0=-thick / 2, bevel=bevel, **kw)

    def sweep(self, path, profile, up=(0, 1, 0), scale_fn=None, closed_path=False, caps=True, col=(1, 1, 1), mat="lit", twist=0.0, at=(0, 0, 0), rot=(0, 0, 0), **kw):
        """A 2D `profile` ((u, v) points, counter-clockwise as seen looking down the path) swept along `path` (3D points).
        `scale_fn(i/(n-1))` scales the profile along the way."""
        pts = [Vector(p) for p in path]
        n = len(pts)
        t = _new_bm()
        tang = []
        for i in range(n):
            if closed_path:
                d = pts[(i + 1) % n] - pts[(i - 1) % n]
            else:
                d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tang.append(d.normalized())
        # parallel transport
        up = Vector(up)
        side = tang[0].cross(up)
        if side.length < 1e-6:
            side = tang[0].cross(Vector((1, 0, 0)))
        side.normalize()
        frames = []
        for i in range(n):
            s = side - tang[i] * side.dot(tang[i])
            if s.length < 1e-6:
                s = frames[-1][0] if frames else Vector((1, 0, 0))
            s.normalize()
            u = tang[i].cross(s).normalized()
            frames.append((s, u))
            side = s
        rings = []
        m = len(profile)
        for i in range(n):
            s, u = frames[i]
            k = scale_fn(i / max(1, n - 1)) if scale_fn else 1.0
            ka, kb = k if isinstance(k, tuple) else (k, k)
            ang = twist * i / max(1, n - 1)
            ca, sa = math.cos(ang), math.sin(ang)
            ring = []
            for (pu, pv) in profile:
                a = pu * ca - pv * sa
                b = pu * sa + pv * ca
                ring.append(t.verts.new(pts[i] + s * (a * ka) + u * (b * kb)))
            rings.append(ring)
        last = n if closed_path else n - 1
        for i in range(last):
            A, B = rings[i], rings[(i + 1) % n]
            for j in range(m):
                j2 = (j + 1) % m
                try:
                    t.faces.new([A[j], A[j2], B[j2], B[j]])
                except ValueError:
                    pass
        if caps and not closed_path:
            for ring, rev in ((rings[0], True), (rings[-1], False)):
                c = sum((v.co for v in ring), Vector()) / m
                cv = t.verts.new(c)
                for j in range(m):
                    j2 = (j + 1) % m
                    try:
                        t.faces.new([cv, ring[j2], ring[j]] if rev else [cv, ring[j], ring[j2]])
                    except ValueError:
                        pass
        self._commit(t, xform(at, rot), col, mat, closed=(caps or closed_path), **kw)
        return self

    def tube(self, path, r=0.2, sides=10, scale_fn=None, closed_path=False, caps=True, col=(1, 1, 1), mat="lit", **kw):
        prof = [(math.cos(TAU * i / sides), math.sin(TAU * i / sides)) for i in range(sides)]
        prof = [(x * r, y * r) for x, y in prof]
        return self.sweep(path, prof, scale_fn=scale_fn, closed_path=closed_path, caps=caps, col=col, mat=mat, **kw)

    def rod(self, a, b, r=0.2, sides=8, col=(1, 1, 1), mat="lit", caps=True, **kw):
        a, b = Vector(a), Vector(b)
        d = (b - a)
        up = (0, 1, 0) if abs(d.normalized().y) < 0.95 else (1, 0, 0)
        return self.tube([a, (a + b) / 2, b], r=r, sides=sides, col=col, mat=mat, caps=caps, up=up, **kw)

    def torus(self, R=1.0, r=0.2, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=36, sides=12, col=(1, 1, 1), mat="lit", arc=None, **kw):
        """A ring about the local y axis (rot it to stand it up); `arc=(a0, a1)` degrees for part of one."""
        if isinstance(scale, (int, float)):
            scale = (scale, scale, scale)
        a0, a1 = (0, 360) if arc is None else arc
        n = segs if arc is None else segs + 1
        path = []
        for i in range(n):
            a = math.radians(a0 + (a1 - a0) * i / segs)
            path.append((R * math.cos(a) * scale[0], 0.0, R * math.sin(a) * scale[2]))
        prof = [(r * math.cos(TAU * i / sides), r * math.sin(TAU * i / sides) * scale[1]) for i in range(sides)]
        return self.sweep(path, prof, up=(0, 1, 0), closed_path=(arc is None), caps=True, col=col, mat=mat, at=at, rot=rot, **kw)

    def loft(self, rings, closed=True, caps=True, col=(1, 1, 1), mat="lit", at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), **kw):
        """Skin a list of rings (each a list of 3D points, same count, counter-clockwise from the front) into a closed solid."""
        t = _new_bm()
        vr = [[t.verts.new(p) for p in ring] for ring in rings]
        m = len(rings[0])
        for i in range(len(vr) - 1):
            A, B = vr[i], vr[i + 1]
            for j in range(m if closed else m - 1):
                j2 = (j + 1) % m
                try:
                    t.faces.new([A[j], A[j2], B[j2], B[j]])
                except ValueError:
                    pass
        if caps and closed:
            for ring in (vr[0], vr[-1]):
                c = sum((v.co for v in ring), Vector()) / m
                cv = t.verts.new(c)
                for j in range(m):
                    j2 = (j + 1) % m
                    try:
                        t.faces.new([cv, ring[j], ring[j2]])
                    except ValueError:
                        pass
        self._commit(t, xform(at, rot, scale), col, mat, closed=(caps and closed), **kw)
        return self

    def quad(self, a, b, c, d, col=(1, 1, 1), mat="lit", **kw):
        """A single flat four-sided face (a, b, c, d counter-clockwise from the front)."""
        t = _new_bm()
        vs = [t.verts.new(p) for p in (a, b, c, d)]
        t.faces.new(vs)
        self._commit(t, None, col, mat, closed=False, **kw)
        return self

    def raw(self, points, normals, faces, col=(1, 1, 1), mat="lit"):
        """Triangles/quads from explicit points, a normal at each, and faces (index lists, counter-clockwise from the front)."""
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        top = self._gtop()
        if top is not None:
            r3 = top.to_3x3()
            points = [top @ Vector(p) for p in points]
            normals = [(r3 @ Vector(n)).normalized() for n in normals]
        vs = [self.bm.verts.new(p) for p in points]
        for fi in faces:
            fv = [vs[i] for i in fi]
            try:
                f = self.bm.faces.new(fv)
            except ValueError:
                continue
            f.smooth = True
            f.material_index = mi
            f[self.decal_layer] = 1
            for l, i in zip(f.loops, fi):
                n = Vector(normals[i]).normalized()
                self.normals.append(n)
                c = col(Vector(points[i]), n) if callable(col) else col
                l[self.layer] = (c[0], c[1], c[2], 1.0)
            self.tris += max(1, len(fi) - 2)
        return self

    def decal(self, surf, poly, col, lift=0.08, mat="glossy", rings=1):
        """Paint a flat-coloured shape onto a surface: `poly` is (u, v) points of a convex-ish outline, `surf(u, v)` gives the
        surface point and its normal; the patch floats `lift` metres above it (a crisp painted edge, whatever the mesh density)."""
        pts = [Vector(p) for p in poly]
        n = len(pts)
        if n == 4 and rings == 1:
            P, N = [], []
            for q in pts:
                pos, nor = surf(q.x, q.y)
                P.append(pos + nor * lift)
                N.append(nor)
            fn = (P[1] - P[0]).cross(P[2] - P[0])
            f = [(0, 1, 2), (0, 2, 3)] if fn.dot(N[0]) >= 0 else [(0, 2, 1), (0, 3, 2)]
            return self.raw(P, N, f, col, mat)
        cen = sum(pts, Vector((0, 0))) / n
        grid = [cen] + [cen + (p - cen) * ((k + 1) / rings) for k in range(rings) for p in pts]
        P, N = [], []
        for q in grid:
            pos, nor = surf(q.x, q.y)
            P.append(pos + nor * lift)
            N.append(nor)
        faces = []
        for j in range(n):
            j2 = (j + 1) % n
            if rings == 1:
                faces.append((0, 1 + j, 1 + j2))
            else:
                faces.append((0, 1 + j, 1 + j2))
                for k in range(1, rings):
                    a, b = 1 + (k - 1) * n, 1 + k * n
                    faces.append((a + j, b + j, b + j2))
                    faces.append((a + j, b + j2, a + j2))
        # orient to the surface normal
        out = []
        for f in faces:
            a, b, c = (P[i] for i in f[:3])
            fn = (b - a).cross(c - a)
            out.append(f if fn.dot(N[f[0]]) >= 0 else (f[0], f[2], f[1]))
        return self.raw(P, N, out, col, mat)

    # -- AO + objects ---------------------------------------------------------
    def _occluders(self):
        verts, polys = [], []
        self.bm.verts.index_update()
        self.bm.faces.index_update()
        self.bm.verts.ensure_lookup_table()
        self.bm.faces.ensure_lookup_table()
        for v in self.bm.verts:
            verts.append(v.co.copy())
        for f in self.bm.faces:
            if self.mats[f.material_index] in NO_OCCLUDER or f[self.decal_layer]:
                continue
            ids = [v.index for v in f.verts]
            for i in range(1, len(ids) - 1):
                polys.append((ids[0], ids[i], ids[i + 1]))
        return verts, polys


# ─── Landmark ────────────────────────────────────────────────────────────────

GROUND_SIZE = 4000.0
_HEMI = None


def _hemisphere(k: int):
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(k):
        u = (i + 0.5) / k
        r = math.sqrt(u)
        phi = i * golden
        z = 0.16 + 0.84 * math.sqrt(1 - u)  # never grazing: a faceted curve must not shade itself
        xy = math.sqrt(max(0.0, 1 - z * z))
        out.append((xy * math.cos(phi), xy * math.sin(phi), z))
    return out


class Landmark:
    def __init__(self, kind: str, span: bool = False, cut: float = 2.5, ao: float = 0.7, ao_dist: float | None = None, rays: int = 24, gain: float = 1.0, ground: bool = True):
        self.kind = kind
        self.span = span
        self.cut = cut
        self.ao = ao
        self.ao_dist = ao_dist
        self.rays = rays
        self.gain = gain
        self.ground = ground
        self.meshes: list[Mesh] = []
        self.main = self.mesh("body")

    def mesh(self, name: str = "part") -> Mesh:
        m = Mesh(self, f"{self.kind}.{name}")
        self.meshes.append(m)
        return m

    def spin(self, name: str, axis: str, pivot, speed: float, bob: float = 0.0, bobspeed: float = 1.5, phase: float = 0.0) -> Mesh:
        """A part that turns about `pivot` (and optionally bobs up and down as it does)."""
        props = {}
        if bob:
            props = {"bob": bob, "bobspeed": bobspeed, "phase": phase}
        m = Mesh(self, f"{self.kind}.{name}", pivot=pivot, axis=axis, speed=speed, props=props)
        self.meshes.append(m)
        return m

    def orbit(self, name: str, axis: str, pivot, speed: float, centre) -> Mesh:
        """A part at `pivot` that keeps its attitude and travels a circle about `centre` (a ferris wheel's car)."""
        props = {"cx": float(centre[0]), "cy": float(centre[1]), "cz": float(centre[2])}
        m = Mesh(self, f"{self.kind}.{name}", pivot=pivot, axis=axis, speed=speed, kind="orbit", props=props)
        self.meshes.append(m)
        return m

    # forwarding: lm.lathe(...) draws into the main mesh
    def __getattr__(self, name):
        if name in ("lathe", "sphere", "cylinder", "cone", "rbox", "prism", "sweep", "tube", "rod", "torus", "loft", "quad", "raw", "decal", "prism_xy", "group"):
            return getattr(self.main, name)
        raise AttributeError(name)

    def bounds(self):
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for m in self.meshes:
            for v in m.bm.verts:
                for k in range(3):
                    lo[k] = min(lo[k], v.co[k])
                    hi[k] = max(hi[k], v.co[k])
        return lo, hi

    def bake_ao(self):
        if self.ao <= 0:
            for m in self.meshes:
                for f in m.bm.faces:
                    for l in f.loops:
                        c = l[m.layer]
                        l[m.layer] = (c[0] * self.gain, c[1] * self.gain, c[2] * self.gain, 1.0)
            return
        lo, hi = self.bounds()
        size = (hi - lo).length
        dist = self.ao_dist if self.ao_dist else max(1.5, 0.16 * size)
        verts, polys = [], []
        for m in self.meshes:
            vs, ps = m._occluders()
            off = len(verts)
            verts += vs
            polys += [(a + off, b + off, c + off) for a, b, c in ps]
        if self.ground:
            g = GROUND_SIZE
            off = len(verts)
            verts += [Vector((-g, 0.0, -g)), Vector((g, 0.0, -g)), Vector((g, 0.0, g)), Vector((-g, 0.0, g))]
            polys += [(off, off + 2, off + 1), (off, off + 3, off + 2)]
        tree = BVHTree.FromPolygons(verts, polys, epsilon=1e-5)
        global _HEMI
        if _HEMI is None or len(_HEMI) != self.rays:
            _HEMI = _hemisphere(self.rays)
        K = len(_HEMI)
        for m in self.meshes:
            m.bm.verts.index_update()
            m.bm.faces.index_update()
            cache = {}
            k = 0
            for f in m.bm.faces:
                glowish = m.mats[f.material_index] in NO_OCCLUDER
                for l in f.loops:
                    n = m.normals[k]
                    k += 1
                    if glowish:
                        continue
                    key = (l.vert.index, round(n.x, 1), round(n.y, 1), round(n.z, 1))
                    occ = cache.get(key)
                    if occ is None:
                        # tangent frame
                        t = n.cross(Vector((0, 1, 0)))
                        if t.length < 0.3:
                            t = n.cross(Vector((1, 0, 0)))
                        t.normalize()
                        b = n.cross(t)
                        cr, sr = 1.0, 0.0
                        origin = l.vert.co + n * 0.03
                        acc = 0.0
                        for (hx, hy, hz) in _HEMI:
                            x = hx * cr - hy * sr
                            y = hx * sr + hy * cr
                            d = t * x + b * y + n * hz
                            hit = tree.ray_cast(origin, d, dist)
                            if hit[0] is not None:
                                acc += 1.0 - (hit[3] / dist) ** 1.0
                        occ = acc / K
                        cache[key] = occ
                    k_ao = 1.0 - self.ao * min(1.0, occ * 1.15)
                    c = l[m.layer]
                    l[m.layer] = (c[0] * k_ao * self.gain, c[1] * k_ao * self.gain, c[2] * k_ao * self.gain, 1.0)

    def build_objects(self, collection):
        self.bake_ao()
        root = bpy.data.objects.new(f"landmark.{self.kind}", None)
        root.empty_display_type = "PLAIN_AXES"
        collection.objects.link(root)
        for m in self.meshes:
            if not len(m.bm.faces):
                continue
            parent = root
            shift = Vector((0, 0, 0))
            if m.axis:
                e = bpy.data.objects.new(f"{m.name}.{m.kind}.{m.axis}", None)
                e.empty_display_type = "PLAIN_AXES"
                e.location = to_blender(m.pivot)
                e["speed"] = float(m.speed)
                for k, v in m.props.items():
                    e[k] = float(v)
                collection.objects.link(e)
                e.parent = root
                parent = e
                shift = m.pivot
            bm = m.bm
            bm.faces.layers.int.remove(m.decal_layer)
            for v in bm.verts:
                v.co = to_blender(v.co - shift)
            nrm = [to_blender(n).normalized() for n in m.normals]
            me = bpy.data.meshes.new(m.name)
            bm.to_mesh(me)
            bm.free()
            for name in m.mats:
                me.materials.append(get_material(name))
            if me.color_attributes:
                me.color_attributes.active_color = me.color_attributes[0]
                me.color_attributes.render_color_index = 0
            if len(nrm) == len(me.loops):
                me.normals_split_custom_set(nrm)
            else:
                print(f"  ! {self.kind}/{m.name}: {len(nrm)} normals for {len(me.loops)} loops (skipped faces)")
            obj = bpy.data.objects.new(m.name, me)
            collection.objects.link(obj)
            obj.parent = parent
        return root

    def tri_count(self) -> int:
        return sum(m.tris for m in self.meshes)


# ─── scene + export ──────────────────────────────────────────────────────────


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene.collection


def export_glb(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_texcoords=False,
        export_normals=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=10,
    )
    bpy.ops.export_scene.gltf(**kw)
    print(f"exported {path}  {os.path.getsize(path) / 1024:.0f} KB", flush=True)


def build_theme(theme: str, builders: dict, out_path: str, only=None):
    """Build the named landmark builders (kind -> function returning a Landmark) and write the theme's .glb."""
    coll = fresh_scene()
    total = 0
    for kind, fn in builders.items():
        if only and kind not in only:
            continue
        t0 = time.time()
        lm = fn()
        lm.build_objects(coll)
        total += lm.tri_count()
        print(f"  {theme}/{kind}: {lm.tri_count()} tris  ({time.time() - t0:.1f}s)", flush=True)
    print(f"{theme}: {total} tris")
    export_glb(out_path)


def aim(direction) -> tuple:
    """Rotation (degrees, XYZ) that turns a primitive local +y axis toward `direction`."""
    d = Vector(direction).normalized()
    q = Vector((0, 1, 0)).rotation_difference(d)
    e = q.to_euler("XYZ")
    return (math.degrees(e.x), math.degrees(e.y), math.degrees(e.z))


# ─── painting on a surface of revolution ─────────────────────────────────────


class RevSurf:
    """A lathe profile as a surface you can paint on: `at(az, y, du, dv)` is the point `du` metres round the skin from azimuth `az`
    (radians from +z toward +x) and `dv` metres up from height `y`, with its outward normal."""

    def __init__(self, profile, centre=(0.0, 0.0)):
        pts = sorted(((float(y), float(r)) for r, y in profile if r > 1e-6), key=lambda t: t[0])
        self.ys = [p[0] for p in pts]
        self.rs = [p[1] for p in pts]
        self.cx, self.cz = centre

    def r(self, y):
        ys, rs = self.ys, self.rs
        if y <= ys[0]:
            return rs[0]
        if y >= ys[-1]:
            return rs[-1]
        lo, hi = 0, len(ys) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if ys[mid] <= y:
                lo = mid
            else:
                hi = mid
        t = (y - ys[lo]) / ((ys[hi] - ys[lo]) or 1e-9)
        return rs[lo] + (rs[hi] - rs[lo]) * t

    def drdy(self, y, h=0.05):
        return (self.r(y + h) - self.r(y - h)) / (2 * h)

    def at(self, az, y, du=0.0, dv=0.0):
        yy = y + dv
        r = self.r(yy)
        a = az + du / max(r, 1e-6)
        pos = Vector((self.cx + r * math.sin(a), yy, self.cz + r * math.cos(a)))
        nor = Vector((math.sin(a), -self.drdy(yy), math.cos(a))).normalized()
        return pos, nor

    def painter(self, az, y):
        return lambda u, v: self.at(az, y, u, v)


def smooth_profile(points, per=6):
    """Catmull-Rom through (r, y) control points, as a list of (r, y)."""
    return [(p.x, p.y) for p in catmull(points, per)]


def with_breaks(points, breaks, eps=0.012):
    """A lathe profile (r, y) with a pair of near-coincident rings at each break height (so a colour can change crisply there)."""
    pts = [(float(r), float(y)) for r, y in points]
    out = []
    for i, (r, y) in enumerate(pts):
        out.append((r, y))
        if i + 1 < len(pts):
            y2 = pts[i + 1][1]
            for b in sorted(breaks):
                if min(y, y2) + 1e-6 < b < max(y, y2) - 1e-6:
                    t = (b - y) / (y2 - y)
                    rb = r + (pts[i + 1][0] - r) * t
                    out.append((r + (pts[i + 1][0] - r) * ((b - eps - y) / (y2 - y)), b - eps))
                    out.append((r + (pts[i + 1][0] - r) * ((b + eps - y) / (y2 - y)), b + eps))
    return out


def ngon(n, r=1.0, phase=0.0, sx=1.0, sy=1.0):
    return [(math.cos(phase + TAU * i / n) * r * sx, math.sin(phase + TAU * i / n) * r * sy) for i in range(n)]


def petal(length, width, n=7, base=0.0):
    """A pointed oval along +u from `base` to `base + length`."""
    top = [(base + length * i / n, width * 0.5 * math.sin(math.pi * i / n) ** 0.85) for i in range(1, n)]
    return [(base, 0.0)] + top + [(base + length, 0.0)] + [(u, -v) for u, v in reversed(top)]


def rot2(poly, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(u * c - v * s, u * s + v * c) for u, v in poly]


def shift2(poly, du, dv):
    return [(u + du, v + dv) for u, v in poly]


def path_frames(points, up=(0, 1, 0)):
    """Tangent, side and up at each point of a path, carried along without flipping (a loop's top is as good as its bottom)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    T = []
    for i in range(n):
        d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        T.append(d.normalized())
    side = T[0].cross(Vector(up))
    if side.length < 1e-6:
        side = T[0].cross(Vector((1, 0, 0)))
    side.normalize()
    out = []
    for i in range(n):
        sd = side - T[i] * side.dot(T[i])
        if sd.length < 1e-6:
            sd = out[-1][1] if out else Vector((1, 0, 0))
        sd.normalize()
        u = T[i].cross(sd).normalized()
        out.append((T[i], sd, u))
        side = sd
    return out


def basis_matrix(origin, t, s, u):
    """A placement for a model built facing +z, up +y, its right at -x: forward `t`, up `u`."""
    # the model's +z -> t, +y -> u, +x -> u x t
    x = u.cross(t).normalized()
    M = Matrix(((x.x, u.x, t.x, origin[0]), (x.y, u.y, t.y, origin[1]), (x.z, u.z, t.z, origin[2]), (0, 0, 0, 1)))
    return M
