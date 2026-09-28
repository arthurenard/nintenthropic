"""The cornfield west of the road: late-season field corn, 2.2-2.5 m tall,
drying from the bottom up, in rows 76 cm apart running north.

The game sways it and bends it ahead of the walkers pushing through, so the
corn is its own geometry (node `corn`, meshes `corn.<n>` under it) carrying:
  - COLOR_0   the baked light (display-referred sRGB, linearised as glTF
              vertex colours are), the same `lit` the atlases carry
  - _ALBEDO   the plant's own colour (linear), for the flashlight
  - _SWAY     0 at the ground to 1 at the tassel (how far a vertex may move)
Vertex colours instead of an atlas: thousands of thin leaves would starve
any texture, and at 9-40 m a leaf's light is one gradient anyway.

Only what the eye can see is built. The eye is at 1.7 m and the corn is
taller, so the first rows hide the field behind them: plants stand in a
band along the field's road edge and along the north block's south edge
(seen across the farm road), with sparser filler behind so gaps between
the front stalks never show an empty field.
"""

import math

import bpy
import numpy as np
from mathutils import Vector

from .common import rng, tag, empty, lin
from . import layout as L
from .ground import ground_z

ROW = 0.76


def srgb(*c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# late season palette: green-bronze leaves above, straw-dry below
GREEN = srgb(0.40, 0.42, 0.22)
BRONZE = srgb(0.52, 0.46, 0.26)
DRY = srgb(0.62, 0.54, 0.36)
STALK = srgb(0.46, 0.44, 0.26)
TASSEL = srgb(0.62, 0.52, 0.32)
HUSK = srgb(0.66, 0.60, 0.42)


class Buf:
    def __init__(self):
        self.V, self.F, self.C, self.S = [], [], [], []

    def add(self, verts, faces, col, sway):
        base = len(self.V)
        self.V.extend(verts)
        self.F.extend([tuple(base + i for i in f) for f in faces])
        self.C.extend(col if isinstance(col, list) else [col] * len(verts))
        self.S.extend(sway)


def plant(buf, x, y, r, detail=2):
    """One plant. detail 2: full; 1: fewer leaves; 0: filler (stalk and three leaves)."""
    z0 = ground_z(x, y)
    H = r.uniform(2.05, 2.5)
    lean = Vector((r.gauss(0, 0.05), r.gauss(0, 0.05), 0.0))
    age = r.uniform(0.0, 1.0)         # how far the drying has climbed
    # stalk: a slightly curved tapered tube
    ns = 5 if detail else 4
    sides = 5 if detail == 2 else 4
    ring_pts = []
    for i in range(ns + 1):
        t = i / ns
        c = Vector((x, y, z0)) + Vector((0, 0, H * 0.93 * t)) + lean * (t * t) * H * 0.4
        rad = 0.019 * (1 - 0.6 * t)
        ring_pts.append([c + Vector((math.cos(2 * math.pi * k / sides) * rad, math.sin(2 * math.pi * k / sides) * rad, 0)) for k in range(sides)])
    verts = [tuple(p) for ring in ring_pts for p in ring]
    faces = []
    for i in range(ns):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k))
    sway = [((i / ns) ** 1.5) for i in range(ns + 1) for _ in range(sides)]
    col = [tuple(STALK * (0.85 + 0.2 * (i / ns))) for i in range(ns + 1) for _ in range(sides)]
    buf.add(verts, faces, col, sway)
    top = ring_pts[-1][0]

    def stalk_at(t):
        return Vector((x, y, z0)) + Vector((0, 0, H * 0.93 * t)) + lean * (t * t) * H * 0.4

    # leaves: alternating, arching out and drooping; the low ones dry
    nl = {2: 7, 1: 5, 0: 3}[detail]
    segs = {2: 5, 1: 4, 0: 3}[detail]
    az0 = r.uniform(0, 2 * math.pi)
    for j in range(nl):
        t = 0.22 + 0.62 * j / max(nl - 1, 1) + r.uniform(-0.03, 0.03)
        base = stalk_at(t)
        az = az0 + math.pi * j + r.uniform(-0.5, 0.5)
        d = Vector((math.cos(az), math.sin(az), 0.0))
        side = Vector((-d.y, d.x, 0.0))
        Lf = r.uniform(0.6, 0.85) * (1.0 - 0.3 * abs(t - 0.5))
        up0 = r.uniform(0.7, 1.1)
        dry = t < age * 0.7
        broken = dry and r.random() < 0.4
        cols = []
        vs = []
        sw = []
        for s in range(segs + 1):
            u = s / segs
            # the leaf rises from the node, arcs over and droops at the tip
            reach = Lf * u
            p = base + d * reach * 0.9 + Vector((0, 0, Lf * (0.55 * up0 * math.sin(u * math.pi * 0.75) - (0.6 if broken else 0.35) * u * u)))
            w = 0.045 * math.sin(math.pi * min(u * 1.1 + 0.05, 1.0)) * (0.6 if dry else 1.0) + 0.004
            curl = Vector((0, 0, 0.012 * (1 - u)))
            vs += [tuple(p - side * w), tuple(p + curl), tuple(p + side * w)]
            if dry:
                c = DRY * (0.9 + 0.2 * r.random())
            else:
                c = GREEN * (1 - u) * 0.6 + BRONZE * (0.4 + 0.6 * u)
                c = c * (0.85 + 0.25 * r.random())
            cols += [tuple(c), tuple(c * 1.05), tuple(c)]
            hz = (p.z - z0) / H
            sw += [max(0.0, hz) ** 1.5] * 3
        fs = []
        for s in range(segs):
            a = s * 3
            fs += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
        buf.add(vs, fs, cols, sw)
    # tassel: a few drooping spikes at the top
    if detail:
        for k in range(4 if detail == 2 else 2):
            az = r.uniform(0, 2 * math.pi)
            d = Vector((math.cos(az), math.sin(az), 0.0))
            p0 = Vector(top)
            p1 = p0 + d * 0.12 + Vector((0, 0, 0.18))
            p2 = p0 + d * 0.22 + Vector((0, 0, 0.14))
            side = Vector((-d.y, d.x, 0)) * 0.006
            vs = [tuple(p0 - side), tuple(p0 + side), tuple(p1 + side), tuple(p1 - side), tuple(p2)]
            buf.add(vs, [(0, 1, 2, 3), (3, 2, 4)], tuple(TASSEL), [1.0] * 5)
        # an ear in its husk, leaning out from the stalk
        if r.random() < 0.7:
            t = r.uniform(0.42, 0.55)
            b = stalk_at(t)
            az = r.uniform(0, 2 * math.pi)
            d = Vector((math.cos(az) * 0.5, math.sin(az) * 0.5, 0.85)).normalized()
            n = 5
            rings = []
            for i in range(5):
                u = i / 4
                c = b + d * (0.24 * u) + Vector((math.cos(az), math.sin(az), 0)) * 0.03
                rad = 0.028 * math.sin(math.pi * min(u * 0.9 + 0.1, 1.0)) + 0.004
                e1 = Vector((0, 0, 1)).cross(d).normalized()
                e2 = d.cross(e1)
                rings.append([c + (e1 * math.cos(2 * math.pi * k / n) + e2 * math.sin(2 * math.pi * k / n)) * rad for k in range(n)])
            vs = [tuple(p) for ring in rings for p in ring]
            fs = [(i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k) for i in range(4) for k in range(n)]
            buf.add(vs, fs, tuple(HUSK * (0.8 + 0.3 * r.random())), [t ** 1.5] * len(vs))


def spots():
    """(x, y, detail) for every plant worth building."""
    r = rng("cornspots")
    out = []
    for (x0, x1, y0, y1), north in zip(L.CORN, (False, True)):
        nrows = int((x1 - x0) / ROW)
        for i in range(nrows):
            x = x1 - 0.35 - i * ROW
            depth_e = x1 - x                   # metres in from the road edge
            y = y0 + 0.15
            while y < y1 - 0.1:
                y += r.uniform(0.24, 0.38)
                depth_s = y - y0 if north else 99.0
                if depth_e < 5.0 or (north and depth_s < 4.0 and x > -46.0):
                    det = 2 if (depth_e < 3.2 or depth_s < 2.4) else 1
                    if math.hypot(x, y) > 38:
                        det = min(det, 1)
                elif depth_e < 9.0 or (north and depth_s < 7.0 and x > -46.0):
                    if r.random() < 0.55:
                        continue
                    det = 0
                else:
                    continue
                # a clearing round the scarecrow's pole
                if math.hypot(x - L.SCARECROW[0], y - L.SCARECROW[1]) < 0.9:
                    continue
                # the corn lane: a trampled line where they have come through
                cx = L.FENCE_X
                if north and abs(y - 37.5) < 0.5 and x > -30 and r.random() < 0.5:
                    continue
                out.append((x + r.uniform(-0.06, 0.06), y, det))
    return out


def build(lib, col, quick=False):
    r = rng("corn")
    pts = spots()
    if quick:
        pts = pts[::3]
    # chunks: south block, north block east edge, north block south edge (west part)
    chunks = {}
    for (x, y, det) in pts:
        k = 1 if y < L.CROSS_Y else (2 if x > -16 else 3)
        chunks.setdefault(k, Buf())
        plant(chunks[k], x, y, r, det)
    root = empty("corn", (0, 0, 0), col, size=1.0, display='PLAIN_AXES', role='corn',
                 note="children corn.<n>: COLOR_0 = baked lit, _ALBEDO = linear albedo, _SWAY = 0..1 sway weight")
    obs = []
    ntri = 0
    for k, b in sorted(chunks.items()):
        me = bpy.data.meshes.new(f"corn.{k}")
        V = np.array(b.V, np.float32)
        me.vertices.add(len(V))
        me.vertices.foreach_set("co", V.ravel())
        sizes = np.array([len(f) for f in b.F], np.int32)
        loops = np.array([i for f in b.F for i in f], np.int32)
        me.loops.add(len(loops))
        me.loops.foreach_set("vertex_index", loops)
        me.polygons.add(len(sizes))
        me.polygons.foreach_set("loop_start", np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32))
        me.update(calc_edges=True)
        me.validate()
        me.shade_smooth()
        C = np.ones((len(V), 4), np.float32)
        C[:, :3] = np.array(b.C, np.float32)
        a = me.color_attributes.new("albedo", 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set("color", C.ravel())
        s = me.attributes.new("sway", 'FLOAT', 'POINT')
        s.data.foreach_set("value", np.array(b.S, np.float32))
        me.materials.append(lib['corn_bake'])
        ob = bpy.data.objects.new(f"corn.{k}", me)
        col.objects.link(ob)
        ob.parent = root
        tag(ob, surface='plant', group='corn', role='corn')
        ntri += sum(len(f) - 2 for f in b.F)
        obs.append(ob)
    print(f"  corn: {len(pts)} plants, {ntri} triangles in {len(obs)} chunks")
    return obs


def material(lib):
    """What Cycles lights the corn with: the per-vertex albedo, a little
    sheen, and leaf translucency (the low moon shines through the leaves)."""
    from .common import DN
    m, g = DN.new_material("corn_bake")
    c = g.node('ShaderNodeVertexColor', out='Color', layer_name="albedo")
    pos = g.geo('Position')
    n = g.noise(pos, scale=18.0, detail=3.0)
    col = g.mix(g.mul(n, 0.3), c, g.hsv(c, v=0.75))
    b = g.principled(col, rough=0.55, spec=0.35, sheen=0.2)
    tr = g.node('ShaderNodeBsdfTranslucent', inputs={'Color': g.hsv(col, s=1.2, v=0.8)}, out=0)
    mix = g.node('ShaderNodeMixShader', inputs={0: 0.28, 1: b, 2: tr}, out=0)
    g.output(mix)
    m["surface"] = 'plant'
    lib['corn_bake'] = m
    return m
