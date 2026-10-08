"""The kit the natural worlds' scenery and landmarks are modelled with.

Run through Blender headless by nature.py (never import this in an open
Blender). Coordinates are Blender's: x right, y away from the viewer, z up.
A landmark's front, the game's +z, is Blender's -y (the glTF exporter turns
z up into y up and -y into +z); a model's right is the game's -x.

A `Model` collects geometry in up to three bmeshes, one per material:
    lit    vertex colours times a plain material (the world's solid things)
    glow   emissive: lava, windows, embers (fromArt.ts reads it as light)
    glass  transparent: ice, canvas, water
Every primitive paints its vertices as it is made: a colour, or a function
f(position, normal) -> (r, g, b) in LINEAR light. When the model is built,
ambient occlusion is ray-cast against the whole model (and a virtual ground
at z = 0) into the lit colours, so trunks darken where they meet the earth,
crowns under their own leaves, rocks in their cracks; the game lights the
rest. Nothing is textured.
"""

import math
import os
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

V = Vector
TAU = math.pi * 2


# ─── colour ──────────────────────────────────────────────────────────────────

def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    """'#2f9a46' (sRGB, as a designer reads it) -> linear (r, g, b)."""
    h = h.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def tint(c, t):
    """Multiplies a colour by another (per channel)."""
    return (c[0] * t[0], c[1] * t[1], c[2] * t[2])


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a) if b != a else 0.0))
    return t * t * (3 - 2 * t)


def grad_z(z0, z1, c0, c1, jitter=0.0, seed=0, scale=1.0):
    """A colour ramp up the model, with a little noise in it so no two leaves are alike."""
    def f(p, n):
        t = (p.z - z0) / (z1 - z0) if z1 != z0 else 0.0
        if jitter:
            t += jitter * noise.noise(V(((p.x + seed * 17.1) * scale, (p.y - seed * 5.3) * scale, p.z * scale)))
        return mix(c0, c1, t)
    return f


def lit_by_normal(c_dark, c_light, lo=-0.6, hi=0.9):
    """Colour by how far up the surface faces: sunlit tops, shaded undersides (a baked key light)."""
    def f(p, n):
        return mix(c_dark, c_light, smoothstep(lo, hi, n.z))
    return f


def varied(fn, amount=0.12, scale=0.5, seed=0):
    """Wraps a colour (or colour function) with soft noise in value and hue."""
    def f(p, n):
        base = fn(p, n) if callable(fn) else fn
        q = V(((p.x + seed * 13.7) * scale, (p.y + seed * 7.1) * scale, (p.z - seed * 3.3) * scale))
        k = 1.0 + amount * noise.noise(q)
        h = 1.0 + amount * 0.5 * noise.noise(q * 2.3 + V((9.1, 3.3, 1.7)))
        return (base[0] * k * h, base[1] * k, base[2] * k / h)
    return f


def smooth_path(points, per=4, closed=False):
    """A Catmull-Rom curve through the points (Vectors), `per` samples a span: bends that bend."""
    pts = [V(p) for p in points]
    if len(pts) < 3:
        return pts
    out = []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


# ─── the model ───────────────────────────────────────────────────────────────

class Model:
    """Geometry being collected for one named node (or one moving part of a landmark)."""

    def __init__(self, name, seed=1):
        self.name = name
        self.seed = seed
        self.rng = random.Random(seed)
        self._parts = {}

    # -- bookkeeping
    def part(self, mat):
        if mat not in self._parts:
            bm = bmesh.new()
            layer = bm.verts.layers.float_color.new("Col")
            self._parts[mat] = (bm, layer)
        return self._parts[mat]

    def _paint(self, mat, verts, col):
        bm, layer = self.part(mat)
        if callable(col):
            bm.normal_update()
            for v in verts:
                c = col(v.co.copy(), v.normal.copy())
                v[layer] = (c[0], c[1], c[2], 1.0)
        else:
            c = (col[0], col[1], col[2], 1.0)
            for v in verts:
                v[layer] = c

    def stats(self):
        return {m: len(bm.faces) for m, (bm, _) in self._parts.items()}

    # -- the one primitive everything else is built from
    def loft(self, rings, col, mat="lit", close=True, cap_start=None, cap_end=None, loop=False, ngon=False):
        """Quads between consecutive rings of points (equal counts). A ring whose points
        coincide is a pole. `cap_start`/`cap_end`: True for a flat fan cap."""
        bm, _ = self.part(mat)
        made = []
        vr = []
        for ring in rings:
            pts = [V(p) for p in ring]
            if all((pts[0] - q).length < 1e-5 for q in pts):
                v = bm.verts.new(pts[0])
                made.append(v)
                vr.append([v] * len(pts))
            else:
                row = [bm.verts.new(p) for p in pts]
                made.extend(row)
                vr.append(row)
        n = len(rings[0])
        top = n if close else n - 1
        for k in range(len(vr) - (0 if loop else 1)):
            k1 = (k + 1) % len(vr)
            for j in range(top):
                quad = [vr[k][j], vr[k][(j + 1) % n], vr[k1][(j + 1) % n], vr[k1][j]]
                dedup = []
                for v in quad:
                    if not dedup or dedup[-1] is not v:
                        dedup.append(v)
                if len(dedup) > 1 and dedup[0] is dedup[-1]:
                    dedup.pop()
                if len(dedup) >= 3:
                    try:
                        bm.faces.new(dedup)
                    except ValueError:
                        pass
        for ring, flip, want in ((vr[0], False, cap_start), (vr[-1], True, cap_end)):
            if want and ngon:
                # A cap for a ring that is not convex (an arch's section): one polygon, cut into triangles properly.
                try:
                    f = bm.faces.new(ring if flip else ring[::-1])
                    f.normal_update()
                    bmesh.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")
                except ValueError:
                    pass
            elif want and len({id(v) for v in ring}) > 2:
                c = bm.verts.new(sum((v.co for v in ring), V()) / len(ring))
                made.append(c)
                for j in range(n):
                    a, b = ring[j], ring[(j + 1) % n]
                    try:
                        bm.faces.new((c, b, a) if not flip else (c, a, b))
                    except ValueError:
                        pass
        self._paint(mat, made, col)
        return made

    # -- primitives
    def blob(self, c, r, sub=2, col=(0.5, 0.5, 0.5), rot=(0, 0, 0), amp=0.0, freq=1.2, seed=0, flat_base=None, mat="lit", stretch=None):
        """A rounded lump: an icosphere of radii r (a number or x, y, z), pushed about by noise.
        `sub` 0, 1, 2, 3 is 20, 80, 320, 1280 triangles.
        `flat_base` clips it flat at that fraction of its height (-1..1): a rock's seat on the ground."""
        bm, _ = self.part(mat)
        rx, ry, rz = (r, r, r) if isinstance(r, (int, float)) else r
        res = bmesh.ops.create_icosphere(bm, subdivisions=max(1, sub + 1), radius=1.0)
        verts = res["verts"]
        off = V((seed * 7.77 + self.seed * 3.1, seed * 3.31, seed * 5.13))
        for v in verts:
            p = v.co.copy()
            if amp:
                d = noise.fractal(p * freq + off, 0.6, 2.0, 3)
                p = p * (1.0 + amp * d)
            if flat_base is not None and p.z < flat_base:
                p.z = flat_base
            v.co = p
        if stretch:
            for v in verts:
                v.co = stretch(v.co)
        m = Matrix.Translation(V(c)) @ Euler(rot, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((rx, ry, rz, 1.0))
        bmesh.ops.transform(bm, matrix=m, verts=verts)
        self._paint(mat, verts, col)
        return verts

    def tube(self, pts, radii, sides=6, col=(0.5, 0.5, 0.5), mat="lit", cap_start=False, cap_end=True, round_end=0.0, squash=1.0, twist=0.0, phase=0.0, mod=None, rib=1.0, loop=False):
        """A pipe along a polyline: trunks, branches, arms, stems. `radii`: a list or f(t) in 0..1.
        `round_end` > 0 closes the end with a cone of that length (fraction of the end radius)."""
        pts = [V(p) for p in pts]
        n = len(pts)
        rad = [radii(k / (n - 1)) if callable(radii) else radii[k] for k in range(n)]
        tans = []
        for k in range(n):
            a = pts[max(0, k - 1)]
            b = pts[min(n - 1, k + 1)]
            tans.append((b - a).normalized())
        ref = V((0, 1, 0)) if abs(tans[0].dot(V((0, 1, 0)))) < 0.9 else V((1, 0, 0))
        nrm = tans[0].cross(ref).normalized()
        rings = []
        if loop:
            tans = []
            for k in range(n):
                tans.append((pts[(k + 1) % n] - pts[k - 1]).normalized())
            nrm = V((0, 0, 1)) if abs(tans[0].z) < 0.9 else V((1, 0, 0))
            nrm = (nrm - tans[0] * nrm.dot(tans[0])).normalized()
        for k in range(n):
            t = tans[k]
            nrm = (nrm - t * nrm.dot(t)).normalized()
            bin_ = t.cross(nrm)
            ring = []
            for j in range(sides):
                th = phase + twist * k + j * TAU / sides
                rr = rad[k] * (mod(j, k) if mod else 1.0)
                ring.append(pts[k] + (nrm * math.cos(th) + bin_ * math.sin(th) * squash) * rr)
            rings.append(ring)
        if round_end:
            tip = pts[-1] + tans[-1] * rad[-1] * round_end
            rings.append([tip] * sides)
        made = self.loft(rings, col, mat, cap_start=cap_start and not loop, cap_end=cap_end and not round_end and not loop, loop=loop)
        if rib != 1.0:
            # Darker valleys between ribs: every other vertex of each ring (a fluted cactus, a grooved trunk).
            _, layer = self.part(mat)
            for k in range(n):
                for j in range(1, sides, 2):
                    v = made[k * sides + j]
                    c = v[layer]
                    v[layer] = (c[0] * rib, c[1] * rib, c[2] * rib, 1.0)
        return made

    def lathe(self, profile, sides=10, c=(0, 0, 0), col=(0.5, 0.5, 0.5), mat="lit", phase=0.0, mod=None, cap_start=False, cap_end=False, squash=1.0, rot=None):
        """A surface of revolution about the vertical through c: profile = [(radius, z), ...] bottom to top.
        `mod(j, k)` scales the radius of point j in ring k (scalloped edges, a stone's wobble); `rot` tilts it about c."""
        c = V(c)
        R = Euler(rot, "XYZ").to_matrix() if rot else None
        rings = []
        for k, (r, z) in enumerate(profile):
            ring = []
            for j in range(sides):
                th = phase + j * TAU / sides
                rr = r * (mod(j, k) if mod else 1.0)
                q = V((math.cos(th) * rr, math.sin(th) * rr * squash, z))
                ring.append(c + (R @ q if R else q))
            rings.append(ring)
        return self.loft(rings, col, mat, cap_start=cap_start, cap_end=cap_end)

    def box(self, c, size, rot=(0, 0, 0), col=(0.5, 0.5, 0.5), mat="lit", bevel=0.0, bevel_segs=2, taper_top=None):
        """A (bevelled) box: centre c, size (x, y, z), Euler rot. `taper_top` = (sx, sy) scales the top face."""
        bm, _ = self.part(mat)
        old = set(bm.verts)
        res = bmesh.ops.create_cube(bm, size=1.0)
        sx, sy, sz = size
        for v in res["verts"]:
            v.co = V((v.co.x * sx, v.co.y * sy, v.co.z * sz))
            if taper_top and v.co.z > 0:
                v.co.x *= taper_top[0]
                v.co.y *= taper_top[1]
        if bevel > 0:
            edges = list({e for v in res["verts"] for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=bevel_segs, profile=0.5, affect="EDGES")
        made = [v for v in bm.verts if v not in old]
        m = Matrix.Translation(V(c)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=m, verts=made)
        self._paint(mat, made, col)
        return made

    def prism(self, poly, z0, z1, col=(0.5, 0.5, 0.5), mat="lit", caps=True):
        """A polygon in the xy plane (counter-clockwise, convex or not), extruded from z0 to z1."""
        n = len(poly)
        rings = [[V((x, y, z0)) for x, y in poly], [V((x, y, z1)) for x, y in poly]]
        made = self.loft(rings, col, mat)
        if caps:
            bm, _ = self.part(mat)
            for z, up in ((z0, False), (z1, True)):
                vs = [bm.verts.new(V((x, y, z))) for x, y in poly]
                made.extend(vs)
                try:
                    f = bm.faces.new(vs if up else vs[::-1])
                    f.normal_update()
                    bmesh.ops.triangulate(bm, faces=[f])
                except ValueError:
                    pass
            self._paint(mat, made, col)
        return made

    def cone(self, c, r, h, sides=8, col=(0.5, 0.5, 0.5), mat="lit", cap=True, rot=None, mod=None, phase=0.0):
        """A cone standing on c (base at c), apex h above; `rot` Euler tilts it about its base."""
        return self.lathe([(r, 0), (0, h)], sides, c, col, mat, phase=phase, mod=mod, cap_start=cap, rot=rot)

    def quad(self, a, b, c, d, col, mat="lit"):
        """One flat quad a-b-c-d, counter-clockwise seen from its front."""
        return self.loft([[V(a), V(b)], [V(d), V(c)]], col, mat, close=False)

    def tri(self, a, b, c, col, mat="lit"):
        return self.loft([[V(a), V(b)], [V(c), V(c)]], col, mat, close=False)

    def prism_y(self, poly, y0, y1, col=(0.5, 0.5, 0.5), mat="lit", caps=True):
        """A polygon in the xz plane (counter-clockwise seen from -y: x right, z up) extruded along y from y0 to y1."""
        rp = poly[::-1]
        rings = [[V((x, y0, z)) for x, z in rp], [V((x, y1, z)) for x, z in rp]]
        made = self.loft(rings, col, mat)
        if caps:
            bm, _ = self.part(mat)
            for y, front in ((y0, True), (y1, False)):
                vs = [bm.verts.new(V((x, y, z))) for x, z in poly]
                made.extend(vs)
                try:
                    f = bm.faces.new(vs if front else vs[::-1])
                    f.normal_update()
                    bmesh.ops.triangulate(bm, faces=[f])
                except ValueError:
                    pass
            self._paint(mat, made, col)
        return made

    def prism_x(self, poly, x0, x1, col=(0.5, 0.5, 0.5), mat="lit", caps=True):
        """A polygon in the yz plane (counter-clockwise seen from +x: y to the left... i.e. y right-to-left, z up)
        extruded along x from x0 to x1 (x0 < x1)."""
        rings = [[V((x0, y, z)) for y, z in poly], [V((x1, y, z)) for y, z in poly]]
        made = self.loft(rings, col, mat)
        if caps:
            bm, _ = self.part(mat)
            for x, plus in ((x0, False), (x1, True)):
                vs = [bm.verts.new(V((x, y, z))) for y, z in poly]
                made.extend(vs)
                try:
                    f = bm.faces.new(vs if plus else vs[::-1])
                    f.normal_update()
                    bmesh.ops.triangulate(bm, faces=[f])
                except ValueError:
                    pass
            self._paint(mat, made, col)
        return made

    def torus(self, c, R, r, sides=8, segs=24, col=(0.5, 0.5, 0.5), mat="lit", axis="z", phase=0.0, squash=1.0):
        """A ring of tube radius r and ring radius R about c; axis is the ring's own axis (x, y or z)."""
        pts = []
        for k in range(segs):
            th = phase + k * TAU / segs
            q = V((math.cos(th) * R, math.sin(th) * R, 0))
            if axis == "y":
                q = V((q.x, 0, q.y))
            elif axis == "x":
                q = V((0, q.x, q.y))
            pts.append(V(c) + q)
        return self.tube(pts, [r] * segs, sides, col, mat, loop=True, squash=squash)

    def blade(self, spine, side, halfwidth, thick=0.03, col=(0.5, 0.5, 0.5), mat="lit", fold=0.3, serrate=0.0, tip_point=True):
        """A leaf, a frond, a blade of agave: a strip along `spine` (points), `side` the axis it is wide across,
        its top facing side x tangent. Two skins a little apart so it is solid from either side. `fold` lifts
        the midrib (the blade droops at the edges), `serrate` makes the edge feathery."""
        pts = [V(p) for p in spine]
        n = len(pts)
        side = V(side).normalized()
        top, bottom = [], []
        for k in range(n):
            t = k / (n - 1)
            a = pts[max(0, k - 1)]
            b = pts[min(n - 1, k + 1)]
            T = (b - a).normalized()
            sd = (side - T * side.dot(T)).normalized()
            up = sd.cross(T).normalized()
            w = halfwidth(t) if callable(halfwidth) else halfwidth[k]
            if serrate and 0 < k < n - 1:
                w *= 1.0 + serrate * (1 if k % 2 else -1)
            if tip_point and k == n - 1:
                w = 0.0
            lift = up * (w * fold)
            top.append([pts[k] - sd * w, pts[k] + lift, pts[k] + sd * w])
            bottom.append([pts[k] - sd * w - up * thick, pts[k] + lift - up * thick, pts[k] + sd * w - up * thick])
        made = self.loft(top, col, mat, close=False)
        made += self.loft([r[::-1] for r in bottom], col, mat, close=False)
        return made

    def drape(self, points, toward, mat="lit", lift=0.03):
        """Each point is moved onto the model's surface along the line towards `toward` (a cracks' path
        lying on a rock). Returns the points on the surface, nudged out by `lift`."""
        verts, polys = self.merged_polys((mat,))
        tree = BVHTree.FromPolygons(verts, polys, epsilon=1e-5)
        out = []
        for p in points:
            p = V(p)
            d = ((toward(p) if callable(toward) else V(toward)) - p).normalized()
            hit = tree.ray_cast(p, d, 1000.0)
            if hit[0] is None:
                out.append(p)
            else:
                out.append(hit[0] + hit[1].normalized() * lift)
        return out

    def transform(self, verts, matrix, mat="lit"):
        bm, _ = self.part(mat)
        bmesh.ops.transform(bm, matrix=matrix, verts=[v for v in verts if v.is_valid])

    # -- finishing
    def merged_polys(self, mats):
        verts, polys = [], []
        for m in mats:
            if m not in self._parts:
                continue
            bm, _ = self._parts[m]
            tmp = bm.copy()
            bmesh.ops.triangulate(tmp, faces=tmp.faces[:])
            base = len(verts)
            verts.extend(v.co.copy() for v in tmp.verts)
            tmp.verts.ensure_lookup_table()
            for f in tmp.faces:
                polys.append(tuple(base + v.index for v in f.verts))
            tmp.free()
        return verts, polys

    def bake_ao(self, strength=0.75, rays=20, reach=3.0, ground=True, ground_reach=2.5, bias=0.9, blockers=("lit", "glow")):
        """Ambient occlusion into the lit colours: cosine-weighted rays over each vertex's hemisphere
        against the model itself (and the ground), the nearer the hit the darker."""
        if "lit" not in self._parts:
            return
        verts, polys = self.merged_polys(blockers)
        if ground:
            ext = 400.0
            g = len(verts)
            verts.extend([V((-ext, -ext, 0)), V((ext, -ext, 0)), V((ext, ext, 0)), V((-ext, ext, 0))])
            polys.append((g, g + 1, g + 2))
            polys.append((g, g + 2, g + 3))
        tree = BVHTree.FromPolygons(verts, polys, epsilon=1e-5)
        bm, layer = self._parts["lit"]
        bm.normal_update()
        golden = math.pi * (3 - math.sqrt(5))
        dirs = []
        for i in range(rays):
            z = (i + 0.5) / rays  # cos-weighted: sqrt spacing
            rr = math.sqrt(1 - z)
            th = i * golden
            dirs.append(V((math.cos(th) * rr, math.sin(th) * rr, math.sqrt(z))))
        weights = [d.z for d in dirs]
        wsum = sum(weights)
        for v in bm.verts:
            n = v.normal.normalized() if v.normal.length > 1e-6 else V((0, 0, 1))
            up = V((0, 0, 1)) if abs(n.z) < 0.99 else V((1, 0, 0))
            t = n.cross(up).normalized()
            b = n.cross(t)
            origin = v.co + n * 0.02
            occ = 0.0
            for d, w in zip(dirs, weights):
                dd = t * d.x + b * d.y + n * d.z
                hit = tree.ray_cast(origin, dd, reach)
                if hit[0] is not None:
                    # Hits near the ground use the shorter ground reach: contact shadow, not a grey cloud.
                    occ += w * (1.0 - hit[3] / reach)
            ao = 1.0 - bias * (occ / wsum)
            k = 1.0 - strength * (1.0 - ao)
            c = v[layer]
            v[layer] = (c[0] * k, c[1] * k, c[2] * k, 1.0)

    def build(self, parent=None, ao=True, ao_args=None, sharp=48.0, location=(0, 0, 0), smooth=True):
        """Makes the Blender objects (one per material) and returns them. A model of one material is one
        mesh named after the model; of several, an empty of that name with a mesh a material under it
        (the game finds the node by name, and takes every mesh below it)."""
        if ao:
            self.bake_ao(**(ao_args or {}))
        used = [m for m, (bm, _) in self._parts.items() if bm.faces]
        objs = []
        root = None
        if len(used) > 1 and parent is None:
            root = empty(self.name, location)
            objs.append(root)
        for mat in used:
            bm, layer = self._parts[mat]
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
            if root is not None or parent is not None:
                short = self.name.split(".", 1)[1] if self.name.startswith(("scenery.", "landmark.")) else self.name
                name = f"{short}.{mat}"
            else:
                name = self.name
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            if smooth:
                me.shade_smooth()
                me.set_sharp_from_angle(angle=math.radians(sharp))
            for a in list(me.uv_layers):
                me.uv_layers.remove(a)
            me.materials.append(material(mat))
            ca = me.color_attributes.get("Col")
            if ca is not None:
                me.color_attributes.active_color = ca
                me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
            obj = bpy.data.objects.new(name, me)
            if root is None:
                obj.location = location
            bpy.context.scene.collection.objects.link(obj)
            owner = root or parent
            if owner is not None:
                obj.parent = owner
                obj.matrix_parent_inverse = owner.matrix_world.inverted()
            objs.append(obj)
        for bm, _ in self._parts.values():
            bm.free()
        self._parts = {}
        return objs


# ─── materials ───────────────────────────────────────────────────────────────

_materials = {}


def material(kind):
    """lit / glow / glass: white-based materials whose colour is the vertex colour."""
    if kind in _materials and _materials[kind].name in bpy.data.materials:
        return _materials[kind]
    m = bpy.data.materials.new(kind)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    if kind == "glow":
        bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.6
        m.name = "glow"
    elif kind == "glass":
        bsdf.inputs["Alpha"].default_value = 0.5
        bsdf.inputs["Roughness"].default_value = 0.1
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
        m.name = "glass"
    _materials[kind] = m
    return m


# ─── scene and export ────────────────────────────────────────────────────────

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()
    noise.seed_set(7)


def empty(name, location=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = "PLAIN_AXES"
    o.location = location
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    bpy.context.view_layer.update()
    return o


def spinner(parent, name, axis, pivot, speed):
    """An empty a landmark's turning part hangs under: `<name>.spin.<axis>` (the GAME's axis: x, y up, z front),
    at the pivot (Blender coordinates), `speed` radians a second (negative to turn the other way)."""
    o = empty(f"{name}.spin.{axis}", pivot, parent)
    o["speed"] = float(speed)
    return o


def export(path, draco=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
        export_draco_mesh_compression_enable=draco,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=10,
    )
    return os.path.getsize(path)


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == "MESH":
            n += len(o.data.polygons)
    return n


# ─── shared bits for the landmarks ───────────────────────────────────────────

def rod(m, a, b, r, col, mat="lit", sides=4, cap=True):
    """A straight bar from a to b (a square one by default: a beam, a spar, a rail)."""
    return m.tube([V(a), V(b)], [r, r], sides, col, mat, phase=math.pi / 4 if sides == 4 else 0.0, cap_start=cap, cap_end=cap)


def post(m, x, y, z0, z1, r, col, sides=8, mat="lit"):
    return m.tube([V((x, y, z0)), V((x, y, z1))], [r, r], sides, col, mat, cap_start=True, cap_end=True)


def planks(base, dark, width=0.55, scale=0.0):
    """A board-and-batten wall as colour: the planks alternate a touch in value along x."""
    return lambda p, n: mix(dark, base, 0.5 + 0.5 * math.sin((p.x + p.y) * (math.pi / width)) * 0.6 + 0.2)


def gore_balloon(m, profile, gores, colours, bulge=0.12, mat="lit"):
    """A hot-air balloon's envelope: `gores` panels, each its own colour, each a little proud of the circle."""
    for g in range(gores):
        a0 = g * TAU / gores
        a1 = (g + 1) * TAU / gores
        am = (a0 + a1) / 2
        col = colours[g % len(colours)]
        rings = []
        for (r, z) in profile:
            row = []
            for th, k in ((a0, 1.0), (am, 1.0 + bulge), (a1, 1.0)):
                row.append(V((math.cos(th) * r * k, math.sin(th) * r * k, z)))
            rings.append(row)
        m.loft(rings, col, mat, close=False)
