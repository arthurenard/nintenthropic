"""The small things that make a valley floor a place, under the scope:

    fields.fences     post-and-rail fences along field boundaries
    fields.walls      dry-stone walls (the rubble tile times COLOR_0: moss on
                      the coping, lichen, the damp foot)
    fields.hay        haycocks on their poles in the fields being made into
                      hay, and hay racks (the hay hung on a fence of poles to
                      dry) near the village and the farm
    rocks.field       boulders the plough could not move, and cairns of the
                      stones it could, at the corners of the pastures
    road.posts        white verge posts along the road, a black band at the top

Where: the field boundaries of fields.py, kept where there are fields on at
least one side (the land cover's `fieldness`), off the roads, the river and
the sites; fences within 1.4 km of the eye (beyond, a rail is less than a
pixel even at 6x), walls within 1.8 km. Hedges are bushes: the forest
places them on the "hedge" boundaries.
"""

import math
import time

import numpy as np

from . import layout as L
from . import noise as N
from . import scene as S
from . import kit as K
from . import fields as FD
from .noise import smoothstep

SEED = 8181


def log(*a):
    print("[detail]", *a, flush=True)


def _runs(keep, min_len):
    """Index ranges [a, b) of consecutive True values at least min_len long."""
    out = []
    i = 0
    n = len(keep)
    while i < n:
        if keep[i]:
            j = i
            while j < n and keep[j]:
                j += 1
            if j - i >= min_len:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _resample(P, step):
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    n = max(int(s[-1] / step), 1)
    t = np.linspace(0, s[-1], n + 1)
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], 1)


def boundary_runs(ter, F):
    """[(kind, polyline)] - the field boundaries worth building."""
    from . import landcover as LC
    P = FD.parcels()
    out = []
    t0 = time.time()
    B = P.boundaries(step=3.0)
    allp = np.vstack([b[2] for b in B])
    # fieldness on both sides of each boundary point, and the clearances
    d = np.zeros_like(allp)
    k = 0
    for _, _, pl in B:
        t = np.gradient(pl, axis=0)
        t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
        d[k:k + len(pl)] = np.stack([-t[:, 1], t[:, 0]], 1)
        k += len(pl)
    fa = LC.evaluate(F, allp[:, 0] + d[:, 0] * 3, allp[:, 1] + d[:, 1] * 3, need_forest_only=True)
    fb = LC.evaluate(F, allp[:, 0] - d[:, 0] * 3, allp[:, 1] - d[:, 1] * 3, need_forest_only=True)
    fc = LC.evaluate(F, allp[:, 0], allp[:, 1], need_forest_only=True)
    good = ((np.maximum(fa['fieldness'], fb['fieldness']) > 0.5) & (fc['droad'] > 5.0) & (fc['de'] > 4.0) &
            (fc['slope'] < 16.0))
    for h in L.village_plan():
        good &= np.hypot(allp[:, 0] - h['c'][0], allp[:, 1] - h['c'][1]) > 0.6 * max(h['w'], h['d']) + 4.0
    for c, rad in ((L.FARM_C, 24.0), (L.CHECKPOINT_C, 22.0), (L.BRIDGE_C, 30.0)):
        good &= np.hypot(allp[:, 0] - c[0], allp[:, 1] - c[1]) > rad
    k = 0
    for kind, sd, pl in B:
        g = good[k:k + len(pl)]
        k += len(pl)
        for a, b in _runs(g, 4):
            out.append((kind, pl[a:b]))
    log(f"{len(out)} boundary runs ({time.time() - t0:.0f}s)")
    return out


# ---------------------------------------------------------------------------

def fences(ter, runs, col, rmax=1400.0):
    rng = np.random.default_rng(SEED)
    kit = K.Kit("fields.fences")
    n_posts = 0
    for kind, pl in runs:
        if kind != "fence":
            continue
        pl = pl[np.hypot(pl[:, 0], pl[:, 1]) < rmax]
        if len(pl) < 3:
            continue
        pts = _resample(pl, 2.5)
        z = ter.height(pts[:, 0], pts[:, 1])
        prev = None
        for i, p in enumerate(pts):
            nxt = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            ang = math.atan2(nxt[1], nxt[0])
            lean = rng.normal(0, 0.012, 2)
            M = K.frame(p, ang, float(z[i]))
            M[:3, 2] += [lean[0], lean[1], 0]
            h = 1.2 + rng.uniform(-0.08, 0.08)
            kit.box(M, (-0.055, -0.055, -0.3), (0.055, 0.055, h), "timber", skip=('-z',))
            if prev is not None:
                q, zq = prev
                ln = float(np.linalg.norm(p - q))
                mid = (p + q) / 2
                for zz in (0.5, 1.0):
                    Mr = K.frame(mid, ang, (float(z[i]) + zq) / 2 + zz)
                    kit.box(Mr, (-ln / 2, -0.02, -0.045), (ln / 2, 0.02, 0.045), "timber", skip=('-x', '+x'))
            prev = (p, float(z[i]))
            n_posts += 1
    objs = kit.build(col, {"timber": "wood"}, extra=dict(note="post-and-rail fences on the field boundaries"))
    log(f"fences: {n_posts} posts")
    return objs


def walls(ter, runs, col, rmax=1800.0):
    """Dry-stone walls: a battered section 0.9-1.1 m high, the coping lumpy,
    following the ground; one mesh, the rubble tile times COLOR_0."""
    rng = np.random.default_rng(SEED + 1)
    V, F, UV, C = [], [], [], []
    base = 0
    ts = K.tile_size("rubble")
    for kind, pl in runs:
        if kind != "wall":
            continue
        pl = pl[np.hypot(pl[:, 0], pl[:, 1]) < rmax]
        if len(pl) < 3:
            continue
        pts = _resample(pl, 1.4)
        n = len(pts)
        z = ter.height(pts[:, 0], pts[:, 1])
        t = np.gradient(pts, axis=0)
        t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
        nr = np.stack([-t[:, 1], t[:, 0]], 1)
        along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
        ph = rng.uniform(0, 100)
        h = 0.95 + 0.12 * N.fbm(along / 6.0, np.full(n, ph), SEED + 2, 3) + 0.05 * rng.normal(size=n)
        hb, ht = 0.36 + 0.03 * rng.normal(size=n), 0.22 + 0.03 * rng.normal(size=n)
        # the wall slumps where it is old: lower, wider
        slump = smoothstep(0.35, 0.7, N.fbm(along / 25.0, np.full(n, ph + 5), SEED + 3, 2))
        h = h * (1 - 0.35 * slump)
        for i in range(n):
            ring = [(-hb[i], -0.25), (-ht[i], 1.0), (ht[i], 1.0), (hb[i], -0.25)]      # (offset across, height fraction)
            for (o, f) in ring:
                q = pts[i] + nr[i] * o * (1 + 0.4 * slump[i])
                V.append((q[0], q[1], z[i] + (h[i] * f if f > 0 else f)))
                UV.append((along[i] / ts, (h[i] * max(f, 0) + (o if f > 0 else 0)) / ts))
            top = 1 if rng.uniform() < 0.8 else 0
            tone = 0.62 + 0.14 * rng.uniform()
            moss = 0.45 * smoothstep(-0.2, 0.4, N.fbm(pts[i:i + 1, 0], pts[i:i + 1, 1], SEED + 4, 2, scale=1 / 5.0))[0]
            for (o, f) in ring:
                c = np.array([tone, tone * 0.98, tone * 0.93])
                if f > 0:
                    c = c * (1 - moss * top) + np.array([0.28, 0.33, 0.14]) * moss * top
                else:
                    c = c * 0.55
                C.append(c)
        for i in range(n - 1):
            a, b = base + 4 * i, base + 4 * (i + 1)
            for k in range(3):
                F += [(a + k, b + k, b + k + 1), (a + k, b + k + 1, a + k + 1)]
        base += 4 * n
    if not V:
        return []
    V, F, UV, C = np.array(V), np.array(F), np.array(UV), np.array(C)
    UV = UV - np.floor(UV.min(0))
    ob = S.mesh_object("fields.walls", V, F, col, uvs={"UVMap": UV}, smooth=False, surface="stone", material_key="rubble_vc",
                       note="dry-stone walls on the field boundaries; COLOR_0 multiplies the rubble tile")
    ca = ob.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.hstack([C, np.ones((len(C), 1))]).astype(np.float32).ravel())
    log(f"walls: {len(F):,} triangles")
    return [ob]


def haycock(kit, p, z, rng):
    s = rng.uniform(0.85, 1.15)
    rings = [(0.0, 0.72), (0.35, 0.8), (0.8, 0.66), (1.2, 0.38), (1.5, 0.08)]
    n = 10
    a0 = rng.uniform(0, 2 * np.pi)
    ang = np.linspace(0, 2 * np.pi, n + 1) + a0
    for (h0, r0), (h1, r1) in zip(rings[:-1], rings[1:]):
        for i in range(n):
            q = [(p[0] + r0 * s * math.cos(ang[i]), p[1] + r0 * s * math.sin(ang[i]), z + h0 * s),
                 (p[0] + r0 * s * math.cos(ang[i + 1]), p[1] + r0 * s * math.sin(ang[i + 1]), z + h0 * s),
                 (p[0] + r1 * s * math.cos(ang[i + 1]), p[1] + r1 * s * math.sin(ang[i + 1]), z + h1 * s),
                 (p[0] + r1 * s * math.cos(ang[i]), p[1] + r1 * s * math.sin(ang[i]), z + h1 * s)]
            kit.face(q, "hay")
    kit.box(K.frame(p, 0.0, z), (-0.025, -0.025, 1.4 * s), (0.025, 0.025, 1.85 * s), "timber", skip=('-z',))


def hay(ter, F, col, rmax=1300.0, cap=420):
    """Haycocks in rows across the fields being made into hay; hay racks."""
    from . import landcover as LC
    rng = np.random.default_rng(SEED + 5)
    P = FD.parcels()
    xs = np.arange(-1400, 900, 3.0)
    ys = np.arange(150, 1500, 3.0)
    X, Y = np.meshgrid(xs, ys)
    x, y = X.ravel(), Y.ravel()
    r = np.hypot(x, y)
    sel = r < rmax
    x, y = x[sel], y[sel]
    q = P.query(x, y)
    hayf = (q["state"] == 1) & (q["in"] > 0)
    # on a lattice in the field's own coordinates: rows 9 m apart, 7 m along
    lat = (np.abs(((q["s_loc"] - 3.5) % 7.0) - 3.5) < 1.5) & (np.abs(((q["d_loc"] - 4.5) % 9.0) - 4.5) < 1.5)
    cand = np.where(hayf & lat & (q["edge"] > 3.0))[0]
    if len(cand) == 0:
        return []
    fc = LC.evaluate(F, x[cand], y[cand], need_forest_only=True)
    ok = cand[fc["fieldness"] > 0.7]
    # one per lattice cell: snap to the cell and dedupe
    key = np.round(q["fid"][ok] * 1e6) * 1e6 + np.floor(q["s_loc"][ok] / 7.0) * 1000 + np.floor(q["d_loc"][ok] / 9.0)
    _, first = np.unique(key, return_index=True)
    ok = ok[first]
    rng.shuffle(ok)
    ok = ok[:cap]
    kit = K.Kit("fields.hay")
    z = ter.height(x[ok], y[ok])
    for i, zi in zip(ok, z):
        jitter = rng.normal(0, 0.6, 2)
        haycock(kit, (x[i] + jitter[0], y[i] + jitter[1]), float(zi) - 0.05, rng)
    # hay racks: a fence of poles with the hay hung on it, near the village and the farm
    racks = 0
    for c, n in ((L.VILLAGE_C, 4), (L.FARM_C, 2)):
        for k in range(n):
            for _ in range(40):
                a = rng.uniform(0, 2 * np.pi)
                rr = rng.uniform(70, 160)
                p = np.array([c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)])
                qq = P.query(np.array([p[0]]), np.array([p[1]]))
                ff = LC.evaluate(F, np.array([p[0]]), np.array([p[1]]), need_forest_only=True)
                if qq["in"][0] > 0 and ff["fieldness"][0] > 0.8 and qq["state"][0] in (0, 1) and qq["edge"][0] > 8:
                    ln = rng.uniform(9, 16)
                    rot = math.atan2(-p[0], p[1]) + math.pi / 2 + rng.uniform(-0.6, 0.6)
                    zz = float(ter.height(np.array([p[0]]), np.array([p[1]]))[0])
                    M = K.frame(p, rot, zz)
                    # hay hung over the rails between the poles: a lumpy
                    # brown-gold bank, sagging between each pair of poles
                    for t in np.arange(-ln / 2, ln / 2 - 0.1, 2.0):
                        top = rng.uniform(1.55, 1.8)
                        kit.box(M, (t + 0.05, -0.2, 0.3), (t + 1.95, 0.2, top - 0.15), "hay")
                        kit.box(M, (t + 0.25, -0.13, top - 0.15), (t + 1.75, 0.13, top), "hay")
                        kit.box(M, (t - 0.04, -0.04, -0.2), (t + 0.04, 0.04, 2.05), "timber", skip=('-z',))
                    racks += 1
                    break
    objs = kit.build(col, {"hay": "wood", "timber": "wood"}, extra=dict(note="haycocks on poles, hay racks"))
    log(f"hay: {len(ok)} haycocks, {racks} racks")
    return objs


def field_rocks(ter, F, runs, col):
    """Boulders in the pastures, and cairns of cleared stones at the ends of
    the field boundaries."""
    import bpy
    from . import landcover as LC
    from .crags import boulder_mesh
    rng = np.random.default_rng(SEED + 7)
    obs = []
    P = FD.parcels()
    # scattered boulders in the pastures
    xs = rng.uniform(-1300, 800, 6000)
    ys = rng.uniform(150, 1500, 6000)
    q = P.query(xs, ys)
    cand = np.where((q["state"] == 3) & (q["in"] > 0) & (np.hypot(xs, ys) < 1300))[0]
    if len(cand):
        fc = LC.evaluate(F, xs[cand], ys[cand], need_forest_only=True)
        cand = cand[fc["fieldness"] > 0.6][:45]
    for k, i in enumerate(cand):
        size = rng.uniform(0.5, 1.4)
        z = float(ter.height(np.array([xs[i]]), np.array([ys[i]]))[0])
        obs.append(boulder_mesh(col, f"_fr{k}", (xs[i], ys[i], z - 0.25 * size), size, seed=900 + k, detail=1))
    # cairns at the start of some boundary runs
    ends = [pl[0] for kind, pl in runs if kind in ("wall", "none") and np.hypot(*pl[0]) < 1300]
    rng.shuffle(ends)
    for j, e in enumerate(ends[:18]):
        z = float(ter.height(np.array([e[0]]), np.array([e[1]]))[0])
        for m in range(int(rng.integers(6, 11))):
            o = rng.normal(0, 0.7, 2)
            size = rng.uniform(0.22, 0.5)
            obs.append(boulder_mesh(col, f"_cn{j}_{m}", (e[0] + o[0], e[1] + o[1], z + rng.uniform(-0.1, 0.35)), size,
                                    seed=1200 + j * 20 + m, detail=0))
    if not obs:
        return []
    with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, selected_objects=obs):
        bpy.ops.object.join()
    ob = obs[0]
    ob.name = ob.data.name = "rocks.field"
    S.tag(ob, surface="rock", material_key="rock_vc", note="boulders in the pastures, cairns of cleared stones")
    log(f"field rocks: {len(ob.data.polygons):,} triangles")
    return [ob]


def road_posts(ter, col, every=36.0):
    """White verge posts with a black band, on the road's valley side."""
    rd = L.road()
    kit = K.Kit("road.posts")
    s = 20.0
    n = 0
    sb = rd.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    while s < rd.length - 20:
        if abs(s - sb) > 35:
            p = rd.at(s)
            if np.hypot(*p) < 1600:
                i = min(int(s / (rd.s[1] - rd.s[0])), len(rd.nrm) - 1)
                nr = rd.nrm[i]
                half = rd.at(s, 'w') / 2 + 0.6
                for sd in (1, -1):
                    q = p + nr * half * sd
                    z = float(ter.height(np.array([q[0]]), np.array([q[1]]))[0])
                    M = K.frame(q, math.atan2(rd.tan[i][1], rd.tan[i][0]), z)
                    kit.box(M, (-0.06, -0.06, -0.2), (0.06, 0.06, 0.8), "paint:white", skip=('-z',))
                    kit.box(M, (-0.062, -0.062, 0.8), (0.062, 0.062, 1.0), "dark", skip=('-z',))
                    n += 1
        s += every
    log(f"road posts: {n}")
    return kit.build(col, {"paint": "wood", "dark": "wood"})


def build(ter, col):
    from . import landcover as LC
    t0 = time.time()
    F = LC.Fields(ter)
    runs = boundary_runs(ter, F)
    objs = []
    objs += fences(ter, runs, col)
    objs += walls(ter, runs, col)
    objs += hay(ter, F, col)
    objs += field_rocks(ter, F, runs, col)
    objs += road_posts(ter, col)
    tris = sum(len(o.data.polygons) for o in objs)
    log(f"detail: {len(objs)} objects, {tris:,} faces ({time.time() - t0:.0f}s)")
    return objs
