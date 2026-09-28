"""Rock walls the heightfield cannot make.

A heightfield holds one height per point, so a wall 170 m high becomes a
few triangles stretched between its foot and its lip: under the scope it
reads as a smooth, fluted curtain. The two walls the player is sent to
look at get meshes of their own:

    rock.cliff   the great limestone wall across the valley (secret.cliff,
                 the echo)
    rock.crag    the buttress at the far slope's foot that the goat stands
                 on (secret.goat.<n> sit on its ledges)

How, for each: the terrain round the wall is closed into a solid and
voxel-remeshed, so the steep faces get triangles as even as flat ground's;
everything but the steep ground is cut away; then every vertex is pushed
along its smoothed normal by a model of bedded limestone:

    beds       horizontal layers 2-13 m thick, dipping a little; hard beds
               stand out with a rounded underside (an overhang the sky
               cannot see into), soft ones recede, and the bedding planes
               between them are dark notches
    joints     vertical fractures: the boundaries of Voronoi cells in plan,
               so they cut any face vertically, re-drawn every other bed;
               the blocks between them stand out by different amounts - a
               castellated face that throws the low sun's shadows sideways
    gullies    and pillars tens of metres wide: a function of plan position
               only, so they run straight down the face
    roughness  a metre-scale fbm

The wall stands a few metres proud of the terrain it hides (the terrain's
own face never shows through) and sinks a metre under it where the ground
stops being steep, so the seam is a line where rock comes out of the slope.

Colour is in the vertices (COLOR_0, multiplying the rock tile's albedo, as
glTF defines): the beds' tones, black water streaks hanging under ledges,
rust stains, turf on the ledges, and the ambient occlusion Cycles bakes.
"""

import json
import math
import time

import bpy
import numpy as np

from . import layout as L
from . import noise as N
from . import scene as S
from .noise import smoothstep

TILE_M = 4.0          # the rock tile's size (tiles.json)

WALLS = {
    # the box sampled round each wall, in a frame whose u runs away from the
    # eye and v across; voxel = the mesh's edge length
    "rock.cliff": dict(c=L.CLIFF_C, u=(-150.0, 340.0), v=280.0, voxel=1.6, bed=(3.5, 11.0), cell=13.0,
                       block=0.8, soft=0.6, notch=0.9, joint=1.3, jw=1.1, gully=1.6, rough=0.35, proud=3.5,
                       steep=(50.0, 60.0), tris=110000, seed=11),
    "rock.crag": dict(c=L.GOAT_CRAG_C, u=(-75.0, 115.0), v=75.0, voxel=1.25, bed=(2.2, 6.5), cell=7.0,
                      block=0.6, soft=0.45, notch=0.6, joint=0.8, jw=0.7, gully=0.9, rough=0.25, proud=2.3,
                      steep=(48.0, 60.0), tris=30000, seed=12),
}


def log(*a):
    print("[crags]", *a, flush=True)


def _hash(a, b, c, d=0.0):
    h = np.sin(a * 127.1 + b * 311.7 + c * 74.7 + d * 191.3) * 43758.5453
    return h - np.floor(h)


def voronoi(x, y, cell, grp, seed):
    """Distances to the nearest and second-nearest seed of a jittered grid
    (a different grid per group), the nearest cell's id in [0, 1) and the
    offset from its seed."""
    gx, gy = np.floor(x / cell), np.floor(y / cell)
    d1 = np.full(x.shape, np.inf)
    d2 = np.full(x.shape, np.inf)
    ident = np.zeros(x.shape)
    ox = np.zeros(x.shape)
    oy = np.zeros(x.shape)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            cx, cy = gx + di, gy + dj
            sx = (cx + 0.1 + 0.8 * _hash(cx, cy, grp, seed)) * cell
            sy = (cy + 0.1 + 0.8 * _hash(cx, cy, grp, seed + 1)) * cell
            d = np.hypot(x - sx, y - sy)
            idv = _hash(cx, cy, grp, seed + 2)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            ident = np.where(closer, idv, ident)
            ox = np.where(closer, x - sx, ox)
            oy = np.where(closer, y - sy, oy)
            d1 = np.where(closer, d, d1)
    return d1, d2, ident, ox, oy


def vertex_normals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    vn = np.zeros_like(V)
    for k in range(3):
        np.add.at(vn, F[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)


def smooth_on_mesh(A, F, iters):
    """Average a per-vertex field over its one-ring, `iters` times."""
    A = np.asarray(A, float)
    squeeze = A.ndim == 1
    if squeeze:
        A = A[:, None]
    cnt = np.zeros(len(A))
    for k in range(3):
        np.add.at(cnt, F[:, k], 3)
    for _ in range(iters):
        acc = np.zeros_like(A)
        fs = A[F].sum(1)
        for k in range(3):
            np.add.at(acc, F[:, k], fs)
        A = acc / np.maximum(cnt, 1)[:, None]
    return A[:, 0] if squeeze else A


# ---------------------------------------------------------------------------
# The base surface: the terrain round the wall, remeshed evenly

class Frame:
    def __init__(self, c):
        c = np.asarray(c, float)
        self.c = c
        self.eu = c / np.linalg.norm(c)
        self.ev = np.array([self.eu[1], -self.eu[0]])

    def world(self, u, v):
        return self.c[0] + u * self.eu[0] + v * self.ev[0], self.c[1] + u * self.eu[1] + v * self.ev[1]

    def local(self, x, y):
        dx, dy = x - self.c[0], y - self.c[1]
        return dx * self.eu[0] + dy * self.eu[1], dx * self.ev[0] + dy * self.ev[1]


def steep_weight(ter, fr, prm, gs):
    """Where the wall is: the ground steeper than ~50 degrees (its slope
    measured on the heightfield smoothed over ~6 m, then dilated so ledges
    do not punch holes in it), as a grid in the frame."""
    u = np.arange(prm['u'][0], prm['u'][1] + 1e-6, gs)
    v = np.arange(-prm['v'], prm['v'] + 1e-6, gs)
    UU, VV = np.meshgrid(u, v, indexing='ij')
    X, Y = fr.world(UU, VV)
    Z = ter.height(X.ravel(), Y.ravel()).reshape(X.shape)
    Zs = N.blur(Z, 3.0 / gs * 1.0)
    gu, gv = np.gradient(Zs, gs)
    slope = np.degrees(np.arctan(np.hypot(gu, gv)))
    w = smoothstep(prm['steep'][0], prm['steep'][1], slope)
    if prm.get('band'):
        # only the wall itself, not the steep mountainside above it: the
        # terrain's own mask of the cliff's face (terrain.great_cliff), a
        # little dilated
        from .terrain import great_cliff
        _, face = great_cliff(X, Y, None, np.degrees(np.arctan2(X, Y)))
        face = N.blur(face, 2.0 / gs * 1.5)
        w *= smoothstep(0.02, 0.15, face)
    k = max(1, int(round(2.5 / gs)))
    for _ in range(k):
        w = np.maximum.reduce([w, np.roll(w, 1, 0), np.roll(w, -1, 0), np.roll(w, 1, 1), np.roll(w, -1, 1)])
    w = N.blur(w, 1.5)
    # fade out at the box's edges (they are cut away anyway)
    edge = np.minimum.reduce([UU - u[0], u[-1] - UU, VV - v[0], v[-1] - VV])
    w *= smoothstep(4 * gs, 10 * gs, edge)
    return u, v, X, Y, Z, w


def solid(X, Y, Z, zbot):
    """The heightfield patch closed into a solid (quads)."""
    nu, nv = X.shape
    top = np.stack([X, Y, Z], -1).reshape(-1, 3)
    bot = top.copy()
    bot[:, 2] = zbot
    V = np.vstack([top, bot])
    n = nu * nv
    idx = np.arange(n).reshape(nu, nv)
    a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
    Ft = np.stack([a, d, c, b], -1).reshape(-1, 4)
    Fb = Ft[:, ::-1] + n
    ring = np.concatenate([idx[0, :], idx[1:, -1], idx[-1, -2::-1], idx[-2:0:-1, 0]])
    rn = np.roll(ring, -1)
    Fs = np.stack([ring, rn, rn + n, ring + n], -1)
    return V, np.vstack([Ft, Fb, Fs])


def remesh(V, F, voxel, col):
    import bmesh
    ob = S.mesh_object("__crag_solid", V, F, col, smooth=False)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    md = ob.modifiers.new("remesh", 'REMESH')
    md.mode = 'VOXEL'
    md.voxel_size = voxel
    md.adaptivity = 0.0
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    me.calc_loop_triangles()
    Vr = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", Vr)
    Fr = np.empty(len(me.loop_triangles) * 3, np.int64)
    me.loop_triangles.foreach_get("vertices", Fr)
    bpy.data.meshes.remove(me)
    return Vr.reshape(-1, 3), Fr.reshape(-1, 3)


# ---------------------------------------------------------------------------
# Bedded limestone

class Rock:
    def __init__(self, prm, zlo):
        self.p = prm
        rng = np.random.default_rng(prm['seed'])
        t = rng.uniform(prm['bed'][0], prm['bed'][1], 600)
        t[rng.uniform(size=600) < 0.12] *= 1.9          # now and then a thick bank
        self.t = t
        self.bounds = zlo - 40.0 + np.concatenate([[0.0], np.cumsum(t)])
        self.dip = rng.uniform(-0.05, 0.05, 2)

    def beds(self, x, y, z):
        s = self.p['seed']
        zb = z + self.dip[0] * x + self.dip[1] * y + 2.5 * N.fbm(x, y, s + 1, 3, scale=1 / 160.0)
        k = np.clip(np.searchsorted(self.bounds, zb, 'right') - 1, 0, len(self.t) - 1)
        f = (zb - self.bounds[k]) / self.t[k]
        return k, np.clip(f, 0, 1)

    def displacement(self, x, y, z):
        """How far (m) the rock stands out of the smoothed wall, and the
        fields its colour needs."""
        p, s = self.p, self.p['seed']
        k, f = self.beds(x, y, z)
        t = self.t[k]
        dist = np.minimum(f, 1 - f) * t
        hk = _hash(k, 1.0, s, 3.0)
        hard = hk > 0.42
        # a hard bed is a slab: flat face, a sharp underside (an overhang
        # from below), a slight bevel on top; a soft one is recessed
        rise = smoothstep(0.0, 0.12, f) * (1 - 0.2 * smoothstep(0.88, 1.0, f))
        bed = np.where(hard, p['block'] * (hk - 0.42) / 0.58 * rise, -p['soft'] * (0.42 - hk) / 0.42)
        notch = -p['notch'] * np.exp(-(dist / (0.35 * p['voxel'])) ** 2)
        grp = np.floor(k / 2.0)
        cell = p['cell'] * (0.7 + 0.6 * _hash(grp, 5.0, s))
        d1, d2, bid, ox, oy = voronoi(x, y, cell, grp, s + 10)
        # blocks: planes standing out by different amounts, each tilted a
        # little about its own seed (sideways and up the face) - facets
        zc = (self.bounds[k] + 0.5 * t)
        tilt = (0.2 * (_hash(bid, 1.0, s, 6.0) - 0.5) * ox + 0.2 * (_hash(bid, 2.0, s, 6.0) - 0.5) * oy +
                0.12 * (_hash(bid, 3.0, s, 6.0) - 0.5) * (z - zc))
        blk = (bid - 0.5) * 2.0 * p['block'] * 0.7 + tilt
        jw = p['jw'] * (0.6 + 0.8 * _hash(grp, 9.0, s))
        joint = -p['joint'] * np.exp(-((d2 - d1) * 0.5 / jw) ** 2)
        # broad buttresses and shallow gullies, not organ pipes
        gul = p['gully'] * (0.9 * N.fbm(x, y, s + 20, 4, scale=1 / 60.0) +
                            0.5 * (N.ridged(x, y, s + 21, 3, scale=1 / 80.0, sharp=1.5) - 0.3))
        rough = p['rough'] * N.fbm(x + 0.7 * z, y - 0.5 * z, s + 22, 4, scale=1 / 3.5)
        det = bed + notch + blk + joint + gul + rough
        return det, dict(k=k, f=f, hk=hk, bid=bid, joint=joint, notch=notch)

    def colour(self, x, y, z, nz, aux, R0):
        """Multipliers of the rock tile's albedo (mean ~0.3, linear)."""
        s = self.p['seed']
        pal = np.array([[0.62, 0.62, 0.61], [0.67, 0.63, 0.56], [0.54, 0.54, 0.54], [0.46, 0.45, 0.44],
                        [0.64, 0.60, 0.50], [0.72, 0.71, 0.68], [0.58, 0.55, 0.52]])
        tone = pal[(_hash(aux['k'], 2.0, s, 7.0) * len(pal)).astype(int)]
        tone = tone * (0.9 + 0.2 * aux['bid'])[:, None]
        # a second and third scale of weathering over the tile: patches a few
        # metres across and the vertices' own jitter, so the 4 m tile never
        # shows its repeat
        tone = tone * (1 + 0.14 * N.fbm(x + 0.5 * z, y - 0.3 * z, s + 36, 3, scale=1 / 7.0))[:, None]
        tone = tone * (1 + 0.07 * (_hash(x, y, z, 9.0) - 0.5))[:, None]
        lat = np.arctan2(x, y) * R0
        # black streaks where water runs down from the ledges; faint ones everywhere
        sx = N.fbm(lat / 2.5, z / 40.0, s + 30, 3)
        env = smoothstep(-0.4, 0.4, N.fbm(lat / 30.0, z / 110.0, s + 31, 2))
        streak = smoothstep(0.0, 0.55, sx) * env + 0.35 * smoothstep(0.0, 0.7, N.fbm(lat / 1.2, z / 12.0, s + 32, 2))
        streak = np.clip(streak, 0, 1)
        col = tone * (1 - 0.7 * streak)[:, None] * np.array([1.0, 1.0, 1.04])
        # rust from iron in a few beds
        rust = smoothstep(0.55, 0.85, N.fbm(lat / 8.0, z / 26.0, s + 33, 3)) * (_hash(aux['k'], 4.0, s) > 0.6)
        col = col * (1 - rust[:, None] * np.array([0.0, 0.22, 0.45]))
        # the bedding planes and joints hold dirt
        col = col * (1 - 0.35 * np.clip(-(aux['notch'] + aux['joint']) / 1.5, 0, 1))[:, None]
        # turf, moss and a little soil on anything that faces up
        up = smoothstep(0.5, 0.85, nz) * smoothstep(-0.3, 0.3, N.fbm(x, y, s + 34, 3, scale=1 / 5.0))
        turf = np.array([0.30, 0.34, 0.13]) * (0.8 + 0.4 * N.fbm(x, y, s + 35, 2, scale=1 / 3.0))[:, None]
        col = col * (1 - up[:, None]) + turf * up[:, None]
        return np.clip(col, 0.02, 1.0)


# ---------------------------------------------------------------------------

def build_wall(ter, name, prm, col):
    t0 = time.time()
    fr = Frame(prm['c'])
    gs = prm['voxel']
    u, v, X, Y, Z, W = steep_weight(ter, fr, prm, gs)
    zbot = float(Z.min()) - 30.0
    V, F = solid(X, Y, Z, zbot)
    V, F = remesh(V, F, prm['voxel'], col)
    log(f"{name}: remeshed {len(V):,} vertices ({time.time() - t0:.0f}s)")
    # keep the steep ground (and its fringe); drop the solid's sides and bottom
    uu, vv = fr.local(V[:, 0], V[:, 1])
    w = _grid_sample(W, u[0], v[0], gs, uu, vv)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
    # outward: the solid's bottom must face down
    if fn[(V[F, 2] < zbot + 1.0).all(1), 2].mean() > 0:
        F = F[:, ::-1]
        fn = -fn
    inner = (uu > u[0] + 3 * gs) & (uu < u[-1] - 3 * gs) & (np.abs(vv) < v[-1] - 3 * gs) & (V[:, 2] > zbot + 5)
    keep = inner[F].all(1) & (w[F].max(1) > 0.02) & (fn[:, 2] > -0.6)
    F = F[keep]
    used = np.unique(F)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    V, F, w = V[used], remap[F], w[used]
    # the direction to push: the vertex normal, smoothed so the beds stay level
    n0 = vertex_normals(V, F)
    n = smooth_on_mesh(n0, F, 6)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    rock = Rock(prm, float(V[:, 2].min()))
    det, aux = rock.displacement(V[:, 0], V[:, 1], V[:, 2])
    det = np.maximum(det, -(prm['proud'] - 0.8))
    w = smooth_on_mesh(w, F, 2)
    D = w * (prm['proud'] + det) - (1 - w) * 2.5
    P = V + n * D[:, None]
    nd = vertex_normals(P, F)
    R0 = float(np.linalg.norm(prm['c']))
    C = rock.colour(V[:, 0], V[:, 1], V[:, 2], smooth_on_mesh(nd[:, 2], F, 1), aux, R0)
    block_of = aux['bid'] * 977.0 + aux['k']
    ob = S.mesh_object(name, P, F, col, smooth=True, surface="rock", material_key="rock_vc",
                       note="a rock wall of its own over the terrain's (the heightfield cannot hold it); "
                            "COLOR_0 multiplies the rock tile (bed tones, streaks, turf, baked AO)")
    ca = ob.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.hstack([C, np.ones((len(C), 1))]).astype(np.float32).ravel())
    _box_uv(ob.data, P, F, fr, block_of)
    if len(F) > prm['tris']:
        # collapse the flat stretches (the colours and UVs are interpolated)
        md = ob.modifiers.new("decimate", 'DECIMATE')
        md.decimate_type = 'COLLAPSE'
        md.ratio = prm['tris'] / len(F)
        md.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        ob.modifiers.clear()
        old = ob.data
        ob.data = me
        me.name = name
        bpy.data.meshes.remove(old)
    log(f"{name}: {len(ob.data.vertices):,} vertices, {len(ob.data.polygons):,} triangles ({time.time() - t0:.0f}s)")
    return ob


def _grid_sample(A, u0, v0, gs, uu, vv):
    fu = np.clip((uu - u0) / gs, 0, A.shape[0] - 1.001)
    fv = np.clip((vv - v0) / gs, 0, A.shape[1] - 1.001)
    iu, iv = fu.astype(int), fv.astype(int)
    tu, tv = fu - iu, fv - iv
    return ((A[iu, iv] * (1 - tu) + A[iu + 1, iv] * tu) * (1 - tv) + (A[iu, iv + 1] * (1 - tu) + A[iu + 1, iv + 1] * tu) * tv)


def _box_uv(me, P, F, fr, block=None):
    """Tile UVs (4 m) projected three ways by each face's normal: across the
    wall (arc along the bearing, height), along it (range, height), or from
    above for ledges - each face picks the one it faces most."""
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
    c = P[F].mean(1)
    rad = c[:, :2] / np.linalg.norm(c[:, :2], axis=1, keepdims=True)
    lat = np.stack([rad[:, 1], -rad[:, 0]], -1)
    a_up = np.abs(fn[:, 2])
    a_rad = np.abs((fn[:, :2] * rad).sum(1))
    a_lat = np.abs((fn[:, :2] * lat).sum(1))
    mode = np.argmax(np.stack([a_rad, a_lat, a_up * 1.15], -1), -1)      # 0: wall faces the eye
    Q = P[F]                                                              # (m, 3, 3)
    R0 = float(np.linalg.norm(fr.c))
    arc = np.arctan2(Q[..., 0], Q[..., 1]) * R0
    rng_ = np.hypot(Q[..., 0], Q[..., 1])
    Uv = np.where(mode[:, None] == 0, arc, np.where(mode[:, None] == 1, rng_, Q[..., 0]))
    Vv = np.where(mode[:, None] == 2, Q[..., 1], Q[..., 2])
    uv = np.stack([Uv, Vv], -1) / TILE_M
    if block is not None:
        # every block of rock starts the tile somewhere else (the joints hide
        # the seams): the tile's repeat is gone
        b = block[F[:, 0]]
        uv = uv + np.stack([_hash(b, 1.0, 3.0), _hash(b, 2.0, 3.0)], -1)[:, None, :] * 4.0
    uv = uv.reshape(-1, 2)
    layer = me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uv.astype(np.float32).ravel())


# ---------------------------------------------------------------------------
# Ambient occlusion into the vertex colours, the goat's ledges

def bake_ao(obs, samples=64, distance=18.0):
    """Cycles' AO of each wall (the terrain and the other rock occluding,
    the forest's flat review cards hidden) multiplied into COLOR_0."""
    sc = bpy.context.scene
    S.setup_gpu(sc)
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.world.light_settings.distance = distance
    hidden = []
    for o in sc.objects:
        if o.name.startswith("review_forest") and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    try:
        for ob in obs:
            me = ob.data
            ao = me.color_attributes.new("AO", 'FLOAT_COLOR', 'POINT')
            me.color_attributes.active_color = ao
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            sc.render.bake.target = 'VERTEX_COLORS'
            bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
            a = np.empty(len(me.vertices) * 4, np.float32)
            me.color_attributes["AO"].data.foreach_get("color", a)
            c = np.empty(len(me.vertices) * 4, np.float32)
            me.color_attributes["Col"].data.foreach_get("color", c)
            a, c = a.reshape(-1, 4), c.reshape(-1, 4)
            occ = 0.25 + 0.75 * a[:, :1]
            c[:, :3] *= occ
            me.color_attributes["Col"].data.foreach_set("color", c.ravel())
            me.color_attributes.remove(me.color_attributes["AO"])
            # faces the sky never sees are under the terrain: where the
            # terrain's coarser mesh lets them poke out they would be black
            # slivers - drop them
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(me)
            bm.verts.ensure_lookup_table()
            dark = [f for f in bm.faces if all(a[v.index, 0] < 0.08 for v in f.verts)]
            bmesh.ops.delete(bm, geom=dark, context='FACES')
            bm.to_mesh(me)
            bm.free()
            log(f"{ob.name}: {len(dark):,} buried faces dropped")
            col = me.color_attributes["Col"]
            me.color_attributes.active_color = col
            me.color_attributes.render_color_index = list(me.color_attributes).index(col)
            log(f"{ob.name}: AO baked (mean {a[:, 0].mean():.2f})")
    finally:
        for o in hidden:
            o.hide_render = False


def goat_ledges(crag, n=4):
    """Places on the crag's face a goat could stand, the eye can see and a
    goat could hop between: up-facing, flat for a metre, on the side toward
    the player, climbing the face one hop at a time."""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    me = crag.data
    P = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", P)
    P = P.reshape(-1, 3) + np.array(crag.matrix_world.translation)
    F = np.empty(len(me.polygons) * 3, np.int64)
    me.polygons.foreach_get("vertices", F)
    F = F.reshape(-1, 3)
    nd = vertex_normals(P, F)
    flat = smooth_on_mesh(nd[:, 2], F, 2)
    toward = -P[:, :2] / np.linalg.norm(P[:, :2], axis=1, keepdims=True)
    ns = smooth_on_mesh(nd, F, 12)
    front = (ns[:, :2] * toward).sum(1)
    z0, z1 = np.percentile(P[:, 2], 3), np.percentile(P[:, 2], 97)
    h = (P[:, 2] - z0) / max(z1 - z0, 1.0)
    cand = np.where((nd[:, 2] > 0.8) & (flat > 0.72) & (front > 0.15) & (h > 0.12) & (h < 0.97))[0]
    rng = np.random.default_rng(71)
    rng.shuffle(cand)
    # the ones the eye can see (the forest's cards count as solid: a goat
    # should never stand behind a tree)
    seen = []
    for i in cand[:1500]:
        tgt = P[i] + np.array([0, 0, 0.6])
        d = tgt / np.linalg.norm(tgt)
        hit, *_ = sc.ray_cast(dg, (0.0, 0.0, 0.3), tuple(d), distance=float(np.linalg.norm(tgt)) - 1.5)
        if not hit:
            seen.append(i)
    seen = np.array(sorted(seen, key=lambda i: h[i]), np.int64)
    # a chain up the face, each ledge one goat's hop from the last (the
    # clip's arc is 1.6 m across and 1.5 m up, and stretches ~25%; allow a
    # little more and let the game scale the arc to the real offset)
    Ps = P[seen]

    def chain(start, across, up):
        out = [start]
        while len(out) < n:
            d = Ps - Ps[out[-1]]
            dh = np.hypot(d[:, 0], d[:, 1])
            ok = (d[:, 2] >= up[0]) & (d[:, 2] <= up[1]) & (dh >= across[0]) & (dh <= across[1])
            ok[out] = False
            if not ok.any():
                return out
            cost = np.abs(dh - 1.62) + np.abs(d[:, 2] - 1.5)
            out.append(int(np.argmin(np.where(ok, cost, np.inf))))
        return out
    best = []
    for across, up in (((0.9, 2.6), (0.8, 2.2)), ((0.8, 3.5), (0.6, 3.0)), ((0.6, 5.0), (0.4, 4.0))):
        for k in range(int(len(seen) * 0.15), len(seen)):
            c = chain(k, across, up)
            if len(c) > len(best):
                best = c
            if len(best) == n:
                break
        if len(best) == n:
            break
    picks = [Ps[i] + np.array([0, 0, 0.03]) for i in best]
    log(f"goat ledges: {len(picks)} of {n} ({len(seen)} visible of {len(cand)} candidates)")
    return [tuple(float(a) for a in p) for p in picks]


def build(ter, col, bake=True, samples=64):
    obs = [build_wall(ter, name, prm, col) for name, prm in WALLS.items()]
    return obs


def finish(obs, samples=64):
    """After the materials are on (the bake needs them): AO, the ledges."""
    bake_ao(obs, samples)
    crag = next(o for o in obs if o.name == "rock.crag")
    ledges = goat_ledges(crag)
    bpy.context.scene["goat_ledges"] = json.dumps(ledges)
    return ledges


# ---------------------------------------------------------------------------
# Boulders

def _noise3(P, seed, scale):
    x, y, z = P[:, 0] * scale, P[:, 1] * scale, P[:, 2] * scale
    return (N.fbm(x, y, seed, 3) + N.fbm(y + 3.1, z, seed + 1, 3) + N.fbm(z - 1.7, x, seed + 2, 3)) / 3.0


def boulder_mesh(col, name, p, size, seed=0, detail=2):
    """A boulder: the convex hull of points scattered over a squat ellipsoid
    (flat faces meeting in sharp edges, the way rock breaks), subdivided and
    weathered a little, sharp edges kept sharp. COLOR_0: its own grey,
    lichen (grey-green, black, orange) on top, earth on the buried foot.
    Box UVs for the 4 m rock tile. Origin at its centre, `size` its long
    half-axis; callers sink it a third into the ground."""
    import bmesh
    rng = np.random.default_rng(seed)
    n = int(rng.integers(22, 38))
    d = rng.normal(size=(n, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    axes = size * np.array([1.0, rng.uniform(0.7, 0.95), rng.uniform(0.5, 0.75)])
    pts = d * axes * rng.uniform(0.82, 1.0, (n, 1))
    bm = bmesh.new()
    for q in pts:
        bm.verts.new(tuple(q))
    res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    junk = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    if detail > 0:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=detail, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    V = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", V)
    V = V.reshape(-1, 3)
    # weathering: a few percent in and out, so the planes are not glass
    V *= (1 + 0.035 * _noise3(V / size, seed + 7, 2.5) + 0.012 * _noise3(V / size, seed + 8, 9.0))[:, None]
    me.vertices.foreach_set("co", V.ravel())
    me.update()
    me.set_sharp_from_angle(angle=math.radians(40))
    F = np.empty(len(me.polygons) * 3, np.int64)
    me.polygons.foreach_get("vertices", F)
    F = F.reshape(-1, 3)
    vn = vertex_normals(V, F)
    t = (V[:, 2] - V[:, 2].min()) / max(np.ptp(V[:, 2]), 1e-6)
    tone = rng.uniform(0.5, 0.78) * np.array([1.0, 0.99, 0.95]) * (1 + 0.05 * rng.uniform(-1, 1, 3))
    C = np.tile(tone, (len(V), 1)) * (0.9 + 0.2 * _noise3(V / size, seed + 9, 3.0))[:, None]
    lg = smoothstep(0.05, 0.4, _noise3(V / size, seed + 10, 2.2)) * smoothstep(0.3, 0.8, vn[:, 2] + 0.3)
    C = C * (1 - lg[:, None] * 0.8) + np.array([0.60, 0.68, 0.52]) * (lg[:, None] * 0.8)
    lb = smoothstep(0.2, 0.5, _noise3(V / size, seed + 11, 5.0))
    C = C * (1 - 0.55 * lb[:, None])
    lo = smoothstep(0.35, 0.6, _noise3(V / size, seed + 12, 6.0)) * (vn[:, 2] > 0.2)
    C = C * (1 - lo[:, None]) + np.array([0.95, 0.58, 0.22]) * lo[:, None]
    moss = smoothstep(0.55, 0.9, vn[:, 2]) * smoothstep(0.0, 0.3, _noise3(V / size, seed + 13, 1.5))
    C = C * (1 - moss[:, None] * 0.7) + np.array([0.22, 0.28, 0.10]) * (moss[:, None] * 0.7)
    foot = smoothstep(0.42, 0.22, t)
    C = C * (1 - foot[:, None] * 0.75) + np.array([0.30, 0.24, 0.16]) * (foot[:, None] * 0.75)
    ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.hstack([np.clip(C, 0.02, 1), np.ones((len(C), 1))]).astype(np.float32).ravel())
    # box UVs, per face by its normal
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    ax = np.argmax(np.abs(fn), 1)
    Q = V[F]
    pick = np.array([[1, 2], [0, 2], [0, 1]])[ax]
    uv = np.stack([np.take_along_axis(Q, pick[:, None, :1].repeat(3, 1), 2)[..., 0],
                   np.take_along_axis(Q, pick[:, None, 1:].repeat(3, 1), 2)[..., 0]], -1) / TILE_M
    uv = uv + rng.uniform(0, 1, 2)
    layer = me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uv.reshape(-1, 2).astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = p
    ob.rotation_euler = (0.0, 0.0, float(rng.uniform(0, 2 * np.pi)))
    return ob
