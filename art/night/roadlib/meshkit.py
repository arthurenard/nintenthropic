"""Geometry helpers on top of High Noon's MeshBuilder: soft shapes (sandbags,
tyres), tubes along paths (neon, wires, hoses, pipes), lathed profiles
(globes, drums, bulbs), extruded outlines (sign letters, the motel's star)
and rounded boxes.

Everything writes into a MeshBuilder (dustcreek.core), so it lands in one
object per (part, material set) with per-face random values and 'grain' /
'local' UVs, exactly like the town's carpentry.
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector, Matrix

from .common import DC

MeshBuilder = DC.MeshBuilder
Frame = DC.Frame


def frame(origin=(0, 0, 0), rot_z=0.0, rot_x=0.0, rot_y=0.0):
    return Frame((0, 0, 0)).sub(origin, rot_z=rot_z, rot_x=rot_x, rot_y=rot_y)


def _grid_faces(mb, P, mat, rand, closed_u=True, closed_v=False, uv=None, local=None):
    """Quads over a (nv, nu, 3) grid of world points."""
    nv, nu = P.shape[:2]
    mu = nu if closed_u else nu - 1
    mv = nv if closed_v else nv - 1
    for i in range(mv):
        i2 = (i + 1) % nv
        for j in range(mu):
            j2 = (j + 1) % nu
            pts = [P[i, j], P[i, j2], P[i2, j2], P[i2, j]]
            if uv is not None:
                g = [uv[i][j], uv[i][j2 if j2 else nu], uv[i2 if i2 else nv][j2 if j2 else nu], uv[i2 if i2 else nv][j]]
            else:
                g = [(j / nu, i / nv), ((j + 1) / nu, i / nv), ((j + 1) / nu, (i + 1) / nv), (j / nu, (i + 1) / nv)]
            mb.add_face([tuple(p) for p in pts], mat, rand, g, g)


def pillow(mb, f, L, W, H, mat, rand, r, seg_u=10, seg_v=6, squash=0.0, ears=0.05, lump=0.012):
    """A filled sack: a superellipsoid, flat under its own weight, the tied
    end pinched into ears, lumpy. Frame f: centre of the bag, X along it."""
    nu, nv = seg_u, seg_v
    ph1, ph2 = r.uniform(0, 10), r.uniform(0, 10)
    P = np.zeros((nv + 1, nu, 3))
    lim = math.radians(78)
    for i in range(nv + 1):
        th = -lim + 2 * lim * i / nv                     # bottom .. top (the poles are capped)
        ct, st = math.cos(th), math.sin(th)
        for j in range(nu):
            ph = 2 * math.pi * j / nu
            cp, sp = math.cos(ph), math.sin(ph)
            e1, e2 = 0.35, 0.55                          # squareness along the bag, across
            x = math.copysign(abs(ct) ** e2 * abs(cp) ** e1, cp)
            y = math.copysign(abs(ct) ** e2 * abs(sp) ** e1, sp)
            z = math.copysign(abs(st) ** 0.7, st)
            # flatter bottom, a domed top, squashed by the bags above
            zz = z * (0.85 if z < 0 else 1.0) * (1.0 - squash)
            # pinch the ends toward the tie
            pinch = 1.0 - 0.35 * max(0.0, abs(x) - 0.7) / 0.3
            yy, zz = y * pinch, zz * pinch
            if x > 0.92:
                x += ears * (1 - abs(z))
            n = (math.sin(3.1 * x + ph1) * math.sin(2.3 * y + ph2) + 0.5 * math.sin(7.0 * x + 5.0 * y + ph1))
            s = 1.0 + lump * n / max(min(L, W, H), 1e-3) * 2
            P[i, j] = (x * L / 2 * s, yy * W / 2 * s, zz * H / 2 * s)
    W_ = np.array([tuple(f.p(*p)) for p in P.reshape(-1, 3)]).reshape(P.shape)
    _grid_faces(mb, W_, mat, rand, closed_u=True, closed_v=False)
    # flat-ish caps top and bottom (the sack's broad faces)
    mb.add_face([tuple(p) for p in W_[0][::-1]], mat, rand)
    mb.add_face([tuple(p) for p in W_[-1]], mat, rand)


def tube(mb, pts, radius, mat, rand=0.5, sides=8, cap=True, taper=None, closed=False):
    """A tube along a polyline of world points (parallel-transport frames)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if n < 2:
        return
    T = []
    for i in range(n):
        if closed:
            a, b = pts[i - 1], pts[(i + 1) % n]
        else:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        t = b - a
        T.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    Nv = (up - T[0] * up.dot(T[0])).normalized()
    frames = []
    for i in range(n):
        if i > 0:
            Nv = Nv - T[i] * Nv.dot(T[i])
            if Nv.length < 1e-6:
                Nv = (up - T[i] * up.dot(T[i]))
            Nv.normalize()
        B = T[i].cross(Nv)
        frames.append((Nv.copy(), B))
    rings = []
    arc = [0.0]
    for i in range(1, n):
        arc.append(arc[-1] + (pts[i] - pts[i - 1]).length)
    for i, p in enumerate(pts):
        Nv, B = frames[i]
        rr = radius * (taper(i / max(n - 1, 1)) if taper else 1.0)
        rings.append([p + (Nv * math.cos(2 * math.pi * k / sides) + B * math.sin(2 * math.pi * k / sides)) * rr
                      for k in range(sides)])
    circ = 2 * math.pi * radius
    m = n if closed else n - 1
    for i in range(m):
        i2 = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            u0, u1 = k / sides * circ, (k + 1) / sides * circ
            a0 = arc[i]
            a1 = arc[i2] if i2 else arc[-1] + (pts[0] - pts[-1]).length
            g = [(a0, u0), (a0, u1), (a1, u1), (a1, u0)]
            l = [(a0, k / sides), (a0, (k + 1) / sides), (a1, (k + 1) / sides), (a1, k / sides)]
            mb.add_face([tuple(rings[i][k]), tuple(rings[i][k2]), tuple(rings[i2][k2]), tuple(rings[i2][k])], mat, rand, g, l)
    if cap and not closed:
        mb.add_face([tuple(v) for v in reversed(rings[0])], mat, rand)
        mb.add_face([tuple(v) for v in rings[-1]], mat, rand)


def catmull(points, samples_per_seg=6, closed=False):
    """Smooth a control polyline (Catmull-Rom)."""
    P = [Vector(p) for p in points]
    n = len(P)
    out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = P[(i - 1) % n] if closed else P[max(i - 1, 0)]
        p1 = P[i % n]
        p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if closed else P[min(i + 2, n - 1)]
        for k in range(samples_per_seg):
            t = k / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return out


def catenary(a, b, sag, n=16):
    """A hanging wire between two points."""
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


def lathe(mb, f, prof, mat, seg=20, rand=0.5, cap_bottom=False, cap_top=True):
    """Revolve (radius, z) profile points about frame Z."""
    rings = []
    for (r, z) in prof:
        rings.append([f.p(r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), z) for k in range(seg)])
    arcz = [0.0]
    for i in range(1, len(prof)):
        arcz.append(arcz[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    for i in range(len(rings) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            g = [(k / seg, arcz[i]), ((k + 1) / seg, arcz[i]), ((k + 1) / seg, arcz[i + 1]), (k / seg, arcz[i + 1])]
            mb.add_face([tuple(rings[i][k]), tuple(rings[i][k2]), tuple(rings[i + 1][k2]), tuple(rings[i + 1][k])], mat, rand, g, g)
    if cap_bottom and prof[0][0] > 1e-4:
        mb.add_face([tuple(v) for v in reversed(rings[0])], mat, rand)
    if cap_top and prof[-1][0] > 1e-4:
        mb.add_face([tuple(v) for v in rings[-1]], mat, rand)


def extrude(mb, f, poly, depth, mat, rand=0.5, bevel=0.0, back=True):
    """Extrude a 2D outline (in the frame's XZ plane, facing -Y) by depth
    along +Y. poly: list of (x, z). Triangulated caps via bmesh."""
    bm = bmesh.new()
    vf = [bm.verts.new((x, 0.0, z)) for x, z in poly]
    face = bm.faces.new(vf)
    bmesh.ops.triangulate(bm, faces=[face])
    tris = [[v.co.copy() for v in fc.verts] for fc in bm.faces]
    bm.free()
    for t in tris:
        # front cap faces -Y
        pts = [f.p(v.x, 0.0, v.z) for v in t]
        nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if nrm.dot(f.d(0, -1, 0)) < 0:
            pts = pts[::-1]
        mb.add_face([tuple(p) for p in pts], mat, rand, [(v.x, v.z) for v in t], [(v.x, v.z) for v in t])
        if back:
            bp = [f.p(v.x, depth, v.z) for v in t]
            nb = (bp[1] - bp[0]).cross(bp[2] - bp[0])
            if nb.dot(f.d(0, 1, 0)) < 0:
                bp = bp[::-1]
            mb.add_face([tuple(p) for p in bp], mat, rand)
    n = len(poly)
    L = 0.0
    for i in range(n):
        x0, z0 = poly[i]
        x1, z1 = poly[(i + 1) % n]
        seg = math.hypot(x1 - x0, z1 - z0)
        q = [f.p(x0, 0, z0), f.p(x1, 0, z1), f.p(x1, depth, z1), f.p(x0, depth, z0)]
        mb.add_face([tuple(p) for p in q], mat, rand, [(L, 0), (L + seg, 0), (L + seg, depth), (L, depth)],
                    [(L, 0), (L + seg, 0), (L + seg, 1), (L, 1)])
        L += seg
    return


def fix_normals(ob):
    """Consistent outward normals (MeshBuilder faces come in either winding)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()


def weld(ob, dist=1e-4, smooth_angle=None):
    """Merge coincident vertices (MeshBuilder writes each face's own) so
    curved shapes can shade smooth."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    if smooth_angle is not None:
        DC.smooth(ob, smooth_angle)
    return ob


def emit(mb, col, lib, group, surface, name=None, smooth_angle=None, welded=False, **props):
    """Build a MeshBuilder into an object tagged with its bake group and surface."""
    if name:
        mb.name = name
    ob = mb.build(col, lib, surface=surface, group=group, **props)
    if ob is None:
        return None
    # MeshBuilder writes every face with its own vertices: curved parts must
    # be welded before smooth shading can do anything
    if welded or smooth_angle is not None:
        weld(ob, smooth_angle=smooth_angle)
    return ob
