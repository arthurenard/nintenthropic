"""The terrain as meshes, built for an eye that never moves.

Vertices are placed by range from the eye: ~1.2 m apart where the targets
stand (under the scope a soldier at 300 m is 1 m in 33 px, so the ground's
shape must be right at that scale), growing in proportion to range beyond
(the ground keeps the same size on screen). Rings of points round the eye,
plus constraint edges along the road and the river's edges so they stay
crisp, triangulated by Blender's constrained Delaunay. Triangles the eye
can never see (behind ridges, beyond 1.2 km) are dropped. The result is cut
into sectors x range bands (`terrain.<band>.<sector>`) so the game's
frustum culling can skip most of it when the scope looks at one place.

UV1 (the light, colour, normal and splat maps) is LOG-POLAR round the eye:
    u = (bearing - THETA0) / (THETA1 - THETA0)      bearing = atan2(x, y) (Blender), radians
    v = ln(r / MAP_R0) / ln(MAP_R1 / MAP_R0)          r = horizontal range, clamped
so a texel covers the same angle on screen at every range: 0.3 m at 300 m,
3 m at 3 km - the maps' resolution goes exactly where the pixels are.
"""

import math
import time

import numpy as np

from . import layout as L
from . import noise as N

THETA0 = math.radians(-62.0)
THETA1 = math.radians(62.0)
MAP_R0 = 30.0
MAP_R1 = 6000.0
R_MIN = 1.1
R_MAX = 6000.0
BANDS = [0.0, 80.0, 300.0, 900.0, 2200.0, 1e9]
SECTORS = 6
CULL_FROM = 1200.0          # beyond this, drop what the eye cannot see


def log(*a):
    print("[mesh]", *a, flush=True)


def spacing(r):
    return np.clip(r / 170.0, 1.2, 40.0) if np.ndim(r) else min(max(r / 170.0, 1.2), 40.0)


def logpolar_uv(x, y):
    th = np.arctan2(x, y)
    r = np.clip(np.hypot(x, y), MAP_R0, MAP_R1)
    u = (th - THETA0) / (THETA1 - THETA0)
    v = np.log(r / MAP_R0) / math.log(MAP_R1 / MAP_R0)
    return np.stack([u, v], -1)


def ring_points():
    """Rings round the eye, each ring's points `spacing(r)` apart, alternate
    rings offset by half a step (better-shaped triangles)."""
    pts = []
    r = R_MIN
    k = 0
    span = THETA1 - THETA0
    while r < R_MAX:
        s = spacing(r)
        n = max(int(math.ceil(span * r / s)), 3)
        th = THETA0 + (np.arange(n + 1) + (0.5 if k % 2 else 0.0)) / n * span
        th = np.clip(th, THETA0, THETA1)
        pts.append(np.stack([r * np.sin(th), r * np.cos(th)], 1))
        r += s
        k += 1
    return np.vstack(pts)


def _polyline_edges(xy, base, closed=False):
    n = len(xy)
    e = [(base + i, base + i + 1) for i in range(n - 1)]
    if closed:
        e.append((base + n - 1, base))
    return e


def constraint_lines():
    """Polylines the triangulation must follow: the road's edges, the lanes',
    the river's water edges. Sampled at the local mesh spacing."""
    lines = []

    def edges_of(curve, s1=None):
        s1 = curve.length if s1 is None else s1
        step = max(curve.s[1] - curve.s[0], 1e-6)
        left, right = [], []
        s = 0.0
        while s <= s1:
            p = curve.at(s)
            t = curve.tan[min(int(s / step), len(curve.tan) - 1)]
            n = np.array([-t[1], t[0]])
            half = 0.5 * curve.at(s, 'w')
            left.append(p + n * half)
            right.append(p - n * half)
            s += spacing(np.linalg.norm(p)) * 0.9
        return [np.array(left), np.array(right)]
    for curve in (L.road(), L.farm_lane(), L.switchbacks(), L.dam_road()):
        lines += edges_of(curve)
    riv = L.river()
    lines += edges_of(riv, min(riv.length, 7000.0))
    return lines


def triangulate(extra_lines=True):
    """(vertices xy (n,2), triangles (m,3))"""
    from mathutils import Vector
    from mathutils import geometry as G
    t = time.time()
    P = ring_points()
    lines = constraint_lines() if extra_lines else []
    # keep ring points off the constraint lines (no slivers)
    if lines:
        allp = np.vstack(lines)
        cell = 2.0
        keys = {}
        for i, q in enumerate(allp):
            keys.setdefault((int(q[0] // cell), int(q[1] // cell)), []).append(i)
        keep = np.ones(len(P), bool)
        sp = spacing(np.hypot(P[:, 0], P[:, 1]))
        for i, p in enumerate(P):
            if sp[i] > 8:
                continue
            kx, ky = int(p[0] // cell), int(p[1] // cell)
            rr = int(math.ceil(sp[i] * 0.55 / cell))
            for dx in range(-rr, rr + 1):
                for dy in range(-rr, rr + 1):
                    for j in keys.get((kx + dx, ky + dy), ()):
                        if (allp[j, 0] - p[0]) ** 2 + (allp[j, 1] - p[1]) ** 2 < (sp[i] * 0.55) ** 2:
                            keep[i] = False
                            break
                    if not keep[i]:
                        break
                if not keep[i]:
                    break
        P = P[keep]
    # clip constraint points to the terrain's sector
    verts = [Vector((float(x), float(y))) for x, y in P]
    edges = []
    for ln in lines:
        th = np.arctan2(ln[:, 0], ln[:, 1])
        r = np.hypot(ln[:, 0], ln[:, 1])
        ok = (th > THETA0 + 0.002) & (th < THETA1 - 0.002) & (r > 3) & (r < R_MAX - 50)
        run = []
        for i in range(len(ln)):
            if ok[i]:
                run.append(len(verts))
                verts.append(Vector((float(ln[i, 0]), float(ln[i, 1]))))
            else:
                if len(run) > 1:
                    edges += [(run[k], run[k + 1]) for k in range(len(run) - 1)]
                run = []
        if len(run) > 1:
            edges += [(run[k], run[k + 1]) for k in range(len(run) - 1)]
    log(f"{len(verts):,} points, {len(edges):,} constraint edges ({time.time() - t:.1f}s)")
    vo, eo, fo, _, _, _ = G.delaunay_2d_cdt(verts, edges, [], 0, 1e-5)
    V = np.array([(v.x, v.y) for v in vo])
    F = np.array([f for f in fo if len(f) == 3])
    # drop triangles outside the sector (the hull closes across the eye)
    c = V[F].mean(1)
    th = np.arctan2(c[:, 0], c[:, 1])
    r = np.hypot(c[:, 0], c[:, 1])
    ok = (th > THETA0) & (th < THETA1) & (r > R_MIN * 0.8)
    # and long hull edges across the eye
    e = np.max(np.stack([np.linalg.norm(V[F[:, i]] - V[F[:, (i + 1) % 3]], axis=1) for i in range(3)], 1), 1)
    ok &= e < spacing(r) * 6 + 2
    F = F[ok]
    log(f"triangulated: {len(V):,} verts, {len(F):,} tris ({time.time() - t:.1f}s)")
    return V, F


def foreground_detail(x, y):
    """Centimetre-scale relief close under the scope (tussocks, a trodden
    patch), fading out by 25 m."""
    r = np.hypot(x, y)
    k = np.clip(1 - r / 25.0, 0, 1)
    return k * (N.fbm(x, y, 6101, octaves=4, scale=1 / 1.6) * 0.06 + N.fbm(x, y, 6102, octaves=3, scale=1 / 0.45) * 0.02)


def visible_mask(ter, P, margin=4.0, step_frac=0.012):
    """For each point, is it visible from the eye (not hidden behind terrain
    by more than `margin` metres)? Marches the heightfield along each ray."""
    n = len(P)
    vis = np.ones(n, bool)
    d = np.linalg.norm(P, axis=1)
    dirn = P / np.maximum(d[:, None], 1e-6)
    t = np.full(n, 20.0)
    active = np.nonzero(d > 60)[0]
    while len(active):
        ta = t[active]
        Q = dirn[active] * ta[:, None]
        zt = ter.height(Q[:, 0], Q[:, 1], cubic=False)
        blocked = zt > Q[:, 2] + margin
        vis[active[blocked]] = False
        t[active] = ta * (1 + step_frac) + 2.0
        active = active[(~blocked) & (t[active] < d[active] * 0.985)]
    return vis


def build_arrays(ter, cull=True):
    V2, F = triangulate()
    x, y = V2[:, 0], V2[:, 1]
    z = ter.height(x, y) + foreground_detail(x, y)
    P = np.stack([x, y, z], 1)
    if cull:
        t = time.time()
        r = np.hypot(x, y)
        far = r > CULL_FROM
        vis = np.ones(len(P), bool)
        vis[far] = visible_mask(ter, P[far])
        fv = vis[F]
        keep = fv.any(1) | (r[F].min(1) < CULL_FROM)
        log(f"culled {np.count_nonzero(~keep):,} hidden triangles of {len(F):,} ({time.time() - t:.1f}s)")
        F = F[keep]
    # normals from the heightfield (smooth across chunk seams)
    e = np.clip(spacing(np.hypot(x, y)) * 0.5, 0.3, 6.0)
    zx = (ter.height(x + e, y) - ter.height(x - e, y)) / (2 * e)
    zy = (ter.height(x, y + e) - ter.height(x, y - e)) / (2 * e)
    Nn = np.stack([-zx, -zy, np.ones_like(zx)], 1)
    Nn /= np.linalg.norm(Nn, axis=1, keepdims=True)
    UV = logpolar_uv(x, y)
    return P, F, Nn, UV


def chunk_ids(P, F):
    c = P[F].mean(1)
    th = np.arctan2(c[:, 0], c[:, 1])
    r = np.hypot(c[:, 0], c[:, 1])
    band = np.searchsorted(BANDS, r, side='right') - 1
    sec = np.clip(((th - THETA0) / (THETA1 - THETA0) * SECTORS).astype(int), 0, SECTORS - 1)
    return band, sec
