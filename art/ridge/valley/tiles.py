"""Tileable PBR ground materials, made in Blender.

Each material is a small periodic 3D scene - real grass blades on soil,
real pebbles, real scree, a displaced rock face, wind-rippled snow - built
from numpy into meshes, wrapped across the tile's edges (anything within
reach of an edge is copied to the opposite side), and rendered straight
down with an orthographic camera in Cycles. The render passes are the
textures:

    <name>_albedo.png   diffuse colour pass (sRGB)
    <name>_normal.png   world normal pass: looking straight down, world X/Y/Z
                        are the tile's tangent/bitangent/normal (OpenGL
                        convention, +Y up the image)
    <name>_hra.png      R height (position pass z, normalised), G roughness
                        (a shader AOV), B ambient occlusion

The mean linear albedo of each tile is recorded (tiles.json) so the game's
shader can use the tile as detail on top of the terrain's colour map:
albedo = colour_map * tile / mean.
"""

import json
import math
import os
import time

import bpy
import bmesh
import numpy as np

from . import scene as S
from . import noise as N
from .imgio import write as write_img

SPEC = {
    # name: (tile size in metres, texture size)
    "grass": (3.0, 1024),
    "alpine": (2.0, 1024),
    "dirt": (2.0, 1024),
    "forest": (2.5, 512),
    "gravel": (1.5, 512),
    "scree": (3.0, 512),
    "rock": (4.0, 512),
    "snow": (4.0, 512),
}


def log(*a):
    print("[tiles]", *a, flush=True)


def srgb(*c):
    """sRGB 0-255 -> linear."""
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------------------
# periodic noise (numpy) for tile heightfields

def pnoise(x, y, period, seed, octaves=5, gain=0.5, period_y=None):
    """fBm that tiles with `period` (in lattice units of the first octave;
    `period_y` for y when the noise is stretched): each octave samples a
    periodic Perlin lattice."""
    out = np.zeros_like(x)
    amp, norm, f = 1.0, 0.0, 1
    py = period if period_y is None else period_y
    for o in range(octaves):
        p = (period * f, py * f)
        out += amp * _periodic_perlin(x * f, y * f, p, seed + o * 31)
        norm += amp
        amp *= gain
        f *= 2
    return out / norm


def _periodic_perlin(x, y, period, seed):
    r = np.random.default_rng(seed)
    P, Q = (int(period[0]), int(period[1])) if isinstance(period, tuple) else (int(period), int(period))
    ang = r.uniform(0, 2 * np.pi, (max(P, Q), max(P, Q)))
    gx, gy = np.cos(ang), np.sin(ang)
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf, yf = x - xi, y - yi

    def g(ix, iy, dx, dy):
        ix %= P
        iy %= Q
        return gx[iy, ix] * dx + gy[iy, ix] * dy
    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
    v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
    n00 = g(xi, yi, xf, yf)
    n10 = g(xi + 1, yi, xf - 1, yf)
    n01 = g(xi, yi + 1, xf, yf - 1)
    n11 = g(xi + 1, yi + 1, xf - 1, yf - 1)
    a = n00 + u * (n10 - n00)
    b = n01 + u * (n11 - n01)
    return (a + v * (b - a)) * 1.4


def pvoronoi(x, y, period, seed):
    """Periodic Voronoi F1 and F2 distances (lattice units)."""
    r = np.random.default_rng(seed)
    P = int(period)
    jit = r.uniform(0, 1, (P, P, 2))
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    f1 = np.full(x.shape, 9.0)
    f2 = np.full(x.shape, 9.0)
    idx = np.zeros(x.shape, np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = xi + dx, yi + dy
            j = jit[cy % P, cx % P]
            px = cx + j[..., 0]
            py = cy + j[..., 1]
            d = np.hypot(px - x, py - y)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idx = np.where(closer, (cy % P) * P + (cx % P), idx)
            f1 = np.minimum(f1, d)
    return f1, f2, idx


# ---------------------------------------------------------------------------
# micro-scene assembly

class Parts:
    """Accumulates triangles with per-vertex colour and roughness."""

    def __init__(self):
        self.V, self.F, self.C, self.R = [], [], [], []
        self.n = 0

    def add(self, V, F, col, rough):
        V = np.asarray(V, np.float32)
        F = np.asarray(F, np.int64)
        self.V.append(V)
        self.F.append(F + self.n)
        col = np.asarray(col, np.float32)
        self.C.append(np.broadcast_to(col, (len(V), 3)).copy() if col.ndim == 1 else col)
        rough = np.asarray(rough, np.float32)
        self.R.append(np.broadcast_to(rough, (len(V),)).copy() if rough.ndim == 0 else rough)
        self.n += len(V)

    def wrapped(self, S_, margin):
        """Copies of every part within `margin` of an edge on the far side."""
        V = np.vstack(self.V)
        F = np.vstack(self.F)
        C = np.vstack(self.C)
        R = np.concatenate(self.R)
        outV, outF, outC, outR = [V], [F], [C], [R]
        n = len(V)
        cen = V[F].mean(1)
        for ox in (-S_, 0, S_):
            for oy in (-S_, 0, S_):
                if ox == 0 and oy == 0:
                    continue
                c = cen + np.array([ox, oy, 0])
                sel = (c[:, 0] > -margin) & (c[:, 0] < S_ + margin) & (c[:, 1] > -margin) & (c[:, 1] < S_ + margin)
                if not sel.any():
                    continue
                fs = F[sel]
                used = np.unique(fs)
                rm = np.full(n, -1, np.int64)
                rm[used] = np.arange(len(used))
                base = sum(len(v) for v in outV)
                outV.append(V[used] + np.array([ox, oy, 0], np.float32))
                outF.append(rm[fs] + base)
                outC.append(C[used])
                outR.append(R[used])
        return np.vstack(outV), np.vstack(outF), np.vstack(outC), np.concatenate(outR)


def heightfield_mesh(parts, S_, res, hfun, colfun, roughfun):
    """A periodic displaced plane: hfun(x, y) -> z, colfun -> (n,3), roughfun -> (n,)."""
    xs = np.linspace(0, S_, res + 1)
    X, Y = np.meshgrid(xs, xs)
    Z = hfun(X, Y)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    idx = np.arange((res + 1) ** 2).reshape(res + 1, res + 1)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])
    parts.add(V, F, colfun(X.ravel(), Y.ravel(), Z.ravel()), roughfun(X.ravel(), Y.ravel(), Z.ravel()))
    return Z


def blade(rng, base, h, w, lean, bend, twist, segs=4):
    """A grass blade: a tapering strip curving over; returns (V, F)."""
    ang = twist
    d = np.array([math.cos(lean[0]), math.sin(lean[0])])
    pts = []
    for i in range(segs + 1):
        t = i / segs
        off = d * (lean[1] * t + bend * t * t) * h
        z = h * t * (1 - 0.35 * bend * t)
        ww = w * (1 - t) ** 0.8 + 0.0003
        sx, sy = -math.sin(ang) * ww / 2, math.cos(ang) * ww / 2
        c = np.array([base[0] + off[0], base[1] + off[1], base[2] + z])
        pts.append(c + [sx, sy, 0])
        pts.append(c - [sx, sy, 0])
    V = np.array(pts)
    F = []
    for i in range(segs):
        a = 2 * i
        F += [(a, a + 1, a + 3), (a, a + 3, a + 2)]
    return V, np.array(F)


def rock_blob(rng, c, size, flat=0.6, sub=2, sharp=0.35):
    """An angular stone: an icosphere pushed about by noise, flattened."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    V = np.array([v.co[:] for v in bm.verts])
    F = np.array([[v.index for v in f.verts] for f in bm.faces])
    bm.free()
    ph = rng.uniform(0, 100, 3)
    n = (np.sin(V[:, 0] * 3.1 + ph[0]) * np.sin(V[:, 1] * 2.7 + ph[1]) * np.sin(V[:, 2] * 3.3 + ph[2]))
    V = V * (1 + sharp * n)[:, None]
    # facets: quantise directions a little so it reads as broken stone
    V *= np.array([1.0, rng.uniform(0.6, 1.0), flat * rng.uniform(0.7, 1.2)])
    R = _rand_rot(rng)
    V = V @ R.T * size + c
    return V, F


def _rand_rot(rng):
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    a, b, c, d = q
    return np.array([[a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
                     [2 * (b * c + a * d), a * a - b * b + c * c - d * d, 2 * (c * d - a * b)],
                     [2 * (b * d - a * c), 2 * (c * d + a * b), a * a - b * b - c * c + d * d]])


# ---------------------------------------------------------------------------
# the materials

def scene_grass(S_, rng):
    """Pasture turf in late September, with the structure that shows from
    afar: tussocks of taller, darker grass, patches of clover, sun-dried
    straw-coloured patches, a few docks and buttercups, bare soil where the
    cows stood - over dense blades of mixed greens on dark soil."""
    p = Parts()
    u_ = lambda x: x / S_
    heightfield_mesh(p, S_, 128, lambda x, y: 0.008 * pnoise(u_(x) * 6, u_(y) * 6, 6, 11),
                     lambda x, y, z: srgb(58, 44, 30)[None] * (0.8 + 0.3 * pnoise(u_(x) * 20, u_(y) * 20, 20, 13))[:, None],
                     lambda x, y, z: np.full(len(x), 0.95))
    n = int(15000 * S_ * S_)
    base = rng.uniform(0, S_, (n, 2))
    bu, bv = base[:, 0] / S_, base[:, 1] / S_
    tuss = np.clip(pnoise(bu * 9, bv * 9, 9, 12) * 2.2 - 0.3, 0, 1)          # tussocks
    dry = np.clip(pnoise(bu * 5, bv * 5, 5, 14) * 2.5 - 0.9, 0, 1)          # sun-dried patches
    bare = np.clip(pnoise(bu * 7, bv * 7, 7, 15) * 3.0 - 1.9, 0, 1)         # trodden bare spots
    greens = [srgb(62, 88, 32), srgb(78, 102, 38), srgb(52, 78, 30), srgb(92, 108, 44), srgb(70, 96, 36)]
    for i in range(n):
        if rng.uniform() < bare[i] * 0.85:
            continue
        h = rng.uniform(0.03, 0.08) * (1.0 + 1.3 * tuss[i]) * (1 - 0.4 * bare[i])
        V, F = blade(rng, (base[i, 0], base[i, 1], 0.0), max(h, 0.015), rng.uniform(0.0035, 0.0065) * (1 + 0.4 * tuss[i]),
                     (rng.uniform(0, 2 * np.pi), rng.uniform(0.05, 0.35 + 0.3 * tuss[i])), rng.uniform(0.1, 0.6),
                     rng.uniform(0, 2 * np.pi), segs=3)
        isdry = rng.uniform() < 0.06 + 0.7 * dry[i]
        if isdry:
            c = [srgb(168, 150, 88), srgb(150, 132, 76), srgb(186, 168, 110)][rng.integers(3)] * rng.uniform(0.85, 1.1)
        else:
            c = greens[rng.integers(len(greens))] * rng.uniform(0.8, 1.2) * (1 - 0.25 * tuss[i])
        t = (V[:, 2] / max(h, 1e-3))[:, None]
        p.add(V, F, c * (0.45 + 0.55 * t), 0.55 + 0.25 * rng.uniform())
    # clover patches: trefoils lying on the sward
    patches = rng.uniform(0, S_, (int(10 * S_ * S_), 2))
    for pc in patches:
        for i in range(int(rng.uniform(20, 80))):
            c0 = np.array([*(pc + rng.normal(0, 0.09, 2)), rng.uniform(0.02, 0.05)])
            a = rng.uniform(0, 2 * np.pi)
            for k in range(3):
                ctr = c0 + np.array([math.cos(a + 2.1 * k), math.sin(a + 2.1 * k), 0]) * 0.008
                ang = np.linspace(0, 2 * np.pi, 9)[:-1]
                V = np.vstack([ctr, ctr + np.stack([np.cos(ang) * 0.008, np.sin(ang) * 0.007, np.zeros(8)], 1)])
                F = np.array([(0, 1 + j, 1 + (j + 1) % 8) for j in range(8)])
                p.add(V, F, srgb(58, 94, 42) * rng.uniform(0.8, 1.1), 0.5)
    # docks: rosettes of big dark leaves
    for i in range(int(1.2 * S_ * S_)):
        c0 = np.array([rng.uniform(0, S_), rng.uniform(0, S_), 0.0])
        for k in range(7):
            a = rng.uniform(0, 2 * np.pi)
            L_ = rng.uniform(0.12, 0.22)
            d = np.array([math.cos(a), math.sin(a), 0.0])
            sd = np.array([-d[1], d[0], 0.0])
            pts = [c0 + np.array([0, 0, 0.03])]
            for t in np.linspace(0.15, 1.0, 5):
                w = 0.05 * math.sin(math.pi * min(t, 0.95))
                z = 0.03 + 0.08 * t * (1 - t)
                pts += [c0 + d * L_ * t + sd * w + [0, 0, z], c0 + d * L_ * t - sd * w + [0, 0, z]]
            V = np.array(pts)
            F = [(0, 1, 2)] + [(1 + 2 * j, 3 + 2 * j, 4 + 2 * j) for j in range(4)] + [(1 + 2 * j, 4 + 2 * j, 2 + 2 * j) for j in range(4)]
            p.add(V, np.array(F), srgb(44, 66, 30) * rng.uniform(0.8, 1.1), 0.45)
    # a few flowers: buttercups and the last clover heads
    for i in range(int(6 * S_ * S_)):
        ctr = np.array([rng.uniform(0, S_), rng.uniform(0, S_), rng.uniform(0.08, 0.2)])
        ang = np.linspace(0, 2 * np.pi, 7)[:-1]
        r_ = rng.uniform(0.007, 0.011)
        V = np.vstack([ctr, ctr + np.stack([np.cos(ang) * r_, np.sin(ang) * r_, np.zeros(6)], 1)])
        F = np.array([(0, 1 + j, 1 + (j + 1) % 6) for j in range(6)])
        c = srgb(232, 196, 40) if rng.uniform() < 0.7 else srgb(214, 190, 220)
        p.add(V, F, c, 0.5)
    return p, 0.25


def scene_alpine(S_, rng):
    """Alpine turf in autumn: tussocks of tawny dry grass, bilberry turning
    red, green moss cushions, grey stones and lichen."""
    p = Parts()
    heightfield_mesh(p, S_, 96, lambda x, y: 0.02 * pnoise(x / S_ * 5, y / S_ * 5, 5, 21),
                     lambda x, y, z: np.tile(srgb(66, 54, 38), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.95))
    # tussocks
    for i in range(int(90 * S_ * S_)):
        c = rng.uniform(0, S_, 2)
        rad = rng.uniform(0.04, 0.12)
        for k in range(int(rad * 900)):
            a = rng.uniform(0, 2 * np.pi)
            rr = rad * math.sqrt(rng.uniform())
            b = (c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, 0.0)
            V, F = blade(rng, b, rng.uniform(0.06, 0.16), rng.uniform(0.0015, 0.003), (a, rng.uniform(0.2, 0.7)),
                         rng.uniform(0.3, 1.0), rng.uniform(0, 2 * np.pi), segs=3)
            col = [srgb(176, 150, 88), srgb(150, 124, 70), srgb(196, 172, 110), srgb(120, 118, 64)][rng.integers(4)]
            t = (V[:, 2] / 0.16)[:, None]
            p.add(V, F, col * rng.uniform(0.8, 1.15) * (0.55 + 0.6 * np.clip(t, 0, 1)), 0.7)
    # bilberry: small oval leaves on low mounds, red and green
    for i in range(int(60 * S_ * S_)):
        c = rng.uniform(0, S_, 2)
        red = rng.uniform() < 0.65
        for k in range(40):
            a = rng.uniform(0, 2 * np.pi)
            rr = 0.08 * math.sqrt(rng.uniform())
            ctr = np.array([c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, rng.uniform(0.02, 0.09)])
            ang = np.linspace(0, 2 * np.pi, 7)[:-1]
            rot = rng.uniform(0, np.pi)
            ex, ey = np.cos(ang) * 0.009, np.sin(ang) * 0.005
            V = np.vstack([ctr, ctr + np.stack([ex * math.cos(rot) - ey * math.sin(rot), ex * math.sin(rot) + ey * math.cos(rot),
                                                 rng.uniform(-0.003, 0.003, 6)], 1)])
            F = np.array([(0, 1 + j, 1 + (j + 1) % 6) for j in range(6)])
            col = (srgb(140, 40, 26) if red else srgb(70, 96, 40)) * rng.uniform(0.7, 1.2)
            p.add(V, F, col, 0.45)
    # stones
    for i in range(int(8 * S_ * S_)):
        c = np.array([rng.uniform(0, S_), rng.uniform(0, S_), 0.0])
        V, F = rock_blob(rng, c, rng.uniform(0.03, 0.12), flat=0.5)
        p.add(V, F, srgb(120, 118, 112) * rng.uniform(0.8, 1.1), 0.8)
    return p, 0.25


def scene_dirt(S_, rng):
    """Bare earth: a trodden, lumpy surface of brown soil with small stones,
    a few dry stalks and a hoofprint or two."""
    p = Parts()

    def h(x, y):
        u, v = x / S_, y / S_
        base = 0.012 * pnoise(u * 5, v * 5, 5, 31) + 0.004 * pnoise(u * 24, v * 24, 24, 32)
        f1, f2, _ = pvoronoi(u * 7, v * 7, 7, 33)
        prints = -0.015 * np.clip(1 - f1 / 0.18, 0, 1) * (np.random.default_rng(34).random() > 2)
        return base + prints

    def col(x, y, z):
        u, v = x / S_, y / S_
        k = 0.5 + 0.5 * pnoise(u * 8, v * 8, 8, 35)
        c = srgb(92, 70, 50)[None] * (1 - k[:, None]) + srgb(122, 98, 72)[None] * k[:, None]
        return c * (0.85 + 0.3 * (z[:, None] / 0.02 + 0.5).clip(0, 1))
    heightfield_mesh(p, S_, 256, h, col, lambda x, y, z: np.full(len(x), 0.9))
    for i in range(int(420 * S_ * S_)):
        c = np.array([rng.uniform(0, S_), rng.uniform(0, S_), 0.0])
        s = rng.uniform(0.004, 0.03) ** 1.0
        V, F = rock_blob(rng, c, s, flat=0.55, sub=1)
        p.add(V, F, srgb(*rng.choice([[128, 120, 108], [96, 90, 84], [150, 140, 122], [110, 98, 80]])) * rng.uniform(0.8, 1.1), 0.7)
    for i in range(int(60 * S_ * S_)):
        base = (rng.uniform(0, S_), rng.uniform(0, S_), 0.004)
        V, F = blade(rng, base, rng.uniform(0.04, 0.12), 0.0025, (rng.uniform(0, 6.3), 3.0), 0.0, rng.uniform(0, 6.3), segs=2)
        p.add(V, F, srgb(150, 128, 84) * rng.uniform(0.7, 1.1), 0.8)
    return p, 0.06


def scene_forest(S_, rng):
    """The spruce forest's floor: a mat of brown needles, cushions of moss,
    a few cones and twigs."""
    p = Parts()

    def h(x, y):
        u, v = x / S_, y / S_
        moss = np.clip(pnoise(u * 5, v * 5, 5, 41) * 2 + 0.2, 0, 1)
        return 0.01 * pnoise(u * 6, v * 6, 6, 42) + 0.025 * moss ** 2 + 0.003 * pnoise(u * 40, v * 40, 40, 43)

    def col(x, y, z):
        u, v = x / S_, y / S_
        moss = np.clip(pnoise(u * 5, v * 5, 5, 41) * 2 + 0.2, 0, 1)[:, None]
        fine = 0.5 + 0.5 * pnoise(u * 60, v * 60, 60, 44)[:, None]
        needles = srgb(96, 62, 36)[None] * (0.7 + 0.5 * fine)
        mossc = srgb(64, 84, 34)[None] * (0.8 + 0.4 * fine)
        return needles * (1 - moss) + mossc * moss
    heightfield_mesh(p, S_, 256, h, col, lambda x, y, z: np.full(len(x), 0.85))
    for i in range(int(600 * S_ * S_)):
        base = (rng.uniform(0, S_), rng.uniform(0, S_), 0.012)
        V, F = blade(rng, base, rng.uniform(0.012, 0.022), 0.0012, (rng.uniform(0, 6.3), 4.0), 0.0, rng.uniform(0, 6.3), segs=1)
        p.add(V, F, srgb(120, 78, 44) * rng.uniform(0.7, 1.2), 0.8)
    for i in range(int(3 * S_ * S_)):
        c = np.array([rng.uniform(0, S_), rng.uniform(0, S_), 0.02])
        V, F = rock_blob(rng, c, 0.03, flat=2.2, sub=2, sharp=0.2)
        p.add(V, F, srgb(110, 70, 40), 0.7)
    return p, 0.08


def scene_gravel(S_, rng):
    """River gravel: rounded pebbles of limestone, gneiss and quartz, packed."""
    p = Parts()
    heightfield_mesh(p, S_, 64, lambda x, y: np.zeros_like(x), lambda x, y, z: np.tile(srgb(120, 110, 96), (len(x), 1)),
                     lambda x, y, z: np.full(len(x), 0.9))
    cols = [[178, 172, 160], [140, 134, 124], [104, 100, 96], [196, 186, 170], [150, 128, 104], [220, 216, 206], [90, 88, 86]]
    for i in range(int(1800 * S_ * S_)):
        s = rng.uniform(0.008, 0.045) ** 1.0
        c = np.array([rng.uniform(0, S_), rng.uniform(0, S_), rng.uniform(-0.3, 0.2) * s])
        V, F = rock_blob(rng, c, s, flat=0.55, sub=2, sharp=0.08)
        p.add(V, F, srgb(*cols[rng.integers(len(cols))]) * rng.uniform(0.85, 1.1), 0.55)
    return p, 0.06


def scene_scree(S_, rng):
    """Talus: angular grey blocks from fist to sack size, jumbled, with finer
    grit between."""
    p = Parts()
    heightfield_mesh(p, S_, 96, lambda x, y: 0.03 * pnoise(x / S_ * 4, y / S_ * 4, 4, 51),
                     lambda x, y, z: np.tile(srgb(128, 124, 116), (len(x), 1)), lambda x, y, z: np.full(len(x), 0.9))
    for i in range(int(420 * S_ * S_)):
        s = 0.02 + 0.22 * rng.uniform() ** 3
        c = np.array([rng.uniform(0, S_), rng.uniform(0, S_), rng.uniform(-0.2, 0.3) * s])
        V, F = rock_blob(rng, c, s, flat=0.6, sub=1, sharp=0.45)
        g = rng.uniform(0.75, 1.15)
        tint = [srgb(150, 146, 138), srgb(132, 130, 126), srgb(160, 152, 140), srgb(112, 110, 106)][rng.integers(4)]
        p.add(V, F, tint * g, 0.85)
    return p, 0.25


def pvoronoi_seed(x, y, period, seed):
    """Periodic Voronoi: F1, F2 (lattice units), the nearest cell's index and
    the offset from its seed (for facets that tilt about their own seed)."""
    r = np.random.default_rng(seed)
    P = int(period)
    jit = r.uniform(0, 1, (P, P, 2))
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    f1 = np.full(x.shape, 9.0)
    f2 = np.full(x.shape, 9.0)
    idx = np.zeros(x.shape, np.int64)
    ox = np.zeros(x.shape)
    oy = np.zeros(x.shape)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx, cy = xi + dx, yi + dy
            j = jit[cy % P, cx % P]
            px = cx + j[..., 0]
            py = cy + j[..., 1]
            d = np.hypot(px - x, py - y)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idx = np.where(closer, (cy % P) * P + (cx % P), idx)
            ox = np.where(closer, x - px, ox)
            oy = np.where(closer, y - py, oy)
            f1 = np.minimum(f1, d)
    return f1, f2, idx, ox, oy


def scene_rock(S_, rng):
    """Weathered rock seen square on: the face broken along joints at two
    scales into facets - planes at different tilts meeting in sharp creases,
    the look of cleaved limestone and gneiss - open cracks between the big
    blocks, knobs and pits, a grey weathering skin with lichen (grey-green,
    black, a little orange). No bedding: a straight line repeated every
    4 m reads as a grid through the scope; the cliffs' meshes and the
    terrain carry their beds at their own scale."""
    p = Parts()
    P1, P2 = 5, 13

    def hsh(i, k):
        return (np.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1.0

    def fields(x, y):
        u, v = x / S_, y / S_
        wu = u + 0.025 * pnoise(u * 4, v * 4, 4, 81)
        wv = v + 0.025 * pnoise(u * 4, v * 4, 4, 82)
        A = pvoronoi_seed(wu * P1, wv * P1, P1, 83)
        B = pvoronoi_seed(wu * P2, wv * P2, P2, 84)
        return u, v, A, B

    def h(x, y):
        u, v, A, B = fields(x, y)
        f1, f2, i1, ox, oy = A
        g1, g2, j1, qx, qy = B
        L1, L2 = S_ / P1, S_ / P2                     # lattice units in metres
        # facets: planes tilted up to ~20 degrees about their seeds
        big = 0.05 * (hsh(i1, 1) - 0.5) + 0.7 * ((hsh(i1, 2) - 0.5) * ox + (hsh(i1, 3) - 0.5) * oy) * L1
        small = 0.5 * ((hsh(j1, 5) - 0.5) * qx + (hsh(j1, 6) - 0.5) * qy) * L2
        # only some of the joints are open cracks, and they pinch out
        live = np.clip(pnoise(u * 5, v * 5, 5, 91) * 2.5 + 0.3, 0, 1)
        wid = 0.035 + 0.03 * np.clip(pnoise(u * 9, v * 9, 9, 92) + 0.5, 0, 1)
        crack = -0.06 * live * np.exp(-((f2 - f1) / wid) ** 2)
        knob = 0.014 * pnoise(u * 20, v * 20, 20, 85) + 0.03 * pnoise(u * 3, v * 3, 3, 93)
        pits = -0.008 * np.clip(pnoise(u * 48, v * 48, 48, 86, octaves=2) * 3 - 1.2, 0, 1)
        return big + small + crack + knob + pits

    def col(x, y, z):
        u, v, A, B = fields(x, y)
        f1, f2, i1, ox, oy = A
        g1, g2, j1, qx, qy = B
        tone = 0.88 + 0.22 * hsh(i1, 7) + 0.06 * (hsh(j1, 8) - 0.5) + 0.16 * pnoise(u * 4, v * 4, 4, 87)
        warm = hsh(i1, 9) - 0.5
        base = srgb(150, 148, 142)[None] * tone[:, None] * (1 + 0.06 * warm[:, None] * np.array([1.0, 0.2, -1.0]))
        lg = np.clip(pnoise(u * 4, v * 4, 4, 88) * 2.2 - 0.3, 0, 1)[:, None] * 0.7
        lb = np.clip(pnoise(u * 14, v * 14, 14, 89) * 2.6 - 1.0, 0, 1)[:, None] * 0.85
        lo = np.clip(pnoise(u * 18, v * 18, 18, 90) * 3.0 - 1.8, 0, 1)[:, None]
        c = base * (1 - lg) + srgb(122, 128, 108)[None] * lg
        c = c * (1 - lb) + srgb(56, 54, 50)[None] * lb
        c = c * (1 - lo) + srgb(170, 112, 50)[None] * lo
        live = np.clip(pnoise(u * 5, v * 5, 5, 91) * 2.5 + 0.3, 0, 1)
        crack = (live * np.exp(-((f2 - f1) / 0.07) ** 2))[:, None]
        return c * (1 - 0.6 * crack)
    heightfield_mesh(p, S_, 512, h, col, lambda x, y, z: np.full(len(x), 0.82))
    return p, 0.3


def scene_snow(S_, rng):
    """Old wind-packed snow: broad soft drifts, fine sastrugi ripples, a
    crust that glints (low roughness in patches)."""
    p = Parts()

    def h(x, y):
        u, v = x / S_, y / S_
        rip = np.sin((u + v) * 2 * np.pi * 11 + 3 * pnoise(u * 3, v * 3, 3, 71)) * 0.004
        return 0.05 * pnoise(u * 3, v * 3, 3, 72) + 0.012 * pnoise(u * 10, v * 10, 10, 73) + rip
    heightfield_mesh(p, S_, 384, h, lambda x, y, z: np.tile(srgb(236, 240, 246), (len(x), 1)),
                     lambda x, y, z: 0.35 + 0.35 * np.clip(pnoise(x / S_ * 8, y / S_ * 8, 8, 74) + 0.5, 0, 1))
    return p, 0.15


SCENES = {"grass": scene_grass, "alpine": scene_alpine, "dirt": scene_dirt, "forest": scene_forest,
          "gravel": scene_gravel, "scree": scene_scree, "rock": scene_rock, "snow": scene_snow}


# ---------------------------------------------------------------------------
# render

def _material():
    m = bpy.data.materials.new("tile_mat")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    ca = nt.nodes.new('ShaderNodeAttribute')
    ca.attribute_name = "col"
    ra = nt.nodes.new('ShaderNodeAttribute')
    ra.attribute_name = "rough"
    nt.links.new(ca.outputs['Color'], bs.inputs['Base Color'])
    nt.links.new(ra.outputs['Fac'], bs.inputs['Roughness'])
    nt.links.new(bs.outputs[0], out.inputs['Surface'])
    aov = nt.nodes.new('ShaderNodeOutputAOV')
    aov.aov_name = "rough"
    nt.links.new(ra.outputs['Fac'], aov.inputs['Value'])
    return m


def render_tile(name, out_dir, quick=False, seed=0):
    from . import btiles
    t0 = time.time()
    size_m, px = SPEC[name] if name in SPEC else btiles.BUILD_SPEC[name]
    if quick:
        px = min(px, 512)
    # a stable seed per material (Python's hash() of a str changes between runs)
    rng = np.random.default_rng(1000 + seed + sum(ord(c) * (i + 1) for i, c in enumerate(name)))
    sc = S.reset_scene("tile")
    S.setup_gpu(sc)
    scenes = dict(SCENES)
    scenes.update(btiles.BUILD_SCENES)
    parts, margin = scenes[name](size_m, rng)
    V, F, C, R = parts.wrapped(size_m, margin)
    ob = S.mesh_object("tile", V, F, sc.collection, smooth=False)
    me = ob.data
    a = me.color_attributes.new("col", 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set("color", np.hstack([C, np.ones((len(C), 1), np.float32)]).ravel())
    r = me.attributes.new("rough", 'FLOAT', 'POINT')
    r.data.foreach_set("value", R)
    me.materials.append(_material())
    zmin, zmax = float(V[:, 2].min()), float(V[:, 2].max())
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size_m
    cam.location = (size_m / 2, size_m / 2, zmax + 1.0)
    cam.data.clip_start = 0.01
    cam.data.clip_end = 10.0
    sc.collection.objects.link(cam)
    sc.camera = cam
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    S.render_settings(sc, px, px, 16 if quick else 48, denoise=False)
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.cycles.max_bounces = 2
    vl = sc.view_layers[0]
    vl.use_pass_diffuse_color = True
    vl.use_pass_normal = True
    vl.use_pass_position = True
    vl.use_pass_ambient_occlusion = True
    aov = vl.aovs.add()
    aov.name = "rough"
    aov.type = 'VALUE'
    sc.world.light_settings.distance = size_m * 0.03
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    exr = os.path.join(out_dir, f"_{name}.exr")
    sc.render.filepath = exr
    bpy.ops.render.render(write_still=True)
    L = _read_layers(exr)
    if 'DiffCol' not in L:
        raise RuntimeError(f"passes missing in {exr}: {sorted(L)}; channels {_channels(exr)[:40]}")
    os.remove(exr)
    alb = L['DiffCol']
    nrm = L['Normal']
    pos = L['Position']
    ao = L['AO'][..., 0] if L['AO'].ndim == 3 else L['AO']
    rough = L['rough'][..., 0] if L['rough'].ndim == 3 else L['rough']
    hgt = (pos[..., 2] - zmin) / max(zmax - zmin, 1e-6)
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-6)
    lin = alb.copy()
    enc = np.where(alb <= 0.0031308, alb * 12.92, 1.055 * np.power(np.clip(alb, 0, 1), 1 / 2.4) - 0.055)
    write_img(os.path.join(out_dir, f"{name}_albedo.png"), enc)
    write_img(os.path.join(out_dir, f"{name}_normal.png"), nrm * 0.5 + 0.5)
    write_img(os.path.join(out_dir, f"{name}_hra.png"), np.stack([hgt, rough, np.clip(ao, 0, 1)], -1))
    mean = [float(v) for v in lin.reshape(-1, 3).mean(0)]
    log(f"{name}: {len(F):,} tris, {px}px over {size_m} m, mean {np.round(mean, 3)} ({time.time() - t0:.0f}s)")
    return dict(size_m=size_m, px=px, mean_linear=mean, height_range_m=zmax - zmin)


def _read_layers(path):
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    chans = {}
    sub = 0
    while inp.seek_subimage(sub, 0):
        spec = inp.spec()
        data = np.asarray(inp.read_image(sub, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
        for k, nme in enumerate(spec.channelnames):
            chans[nme] = data[..., k]
        sub += 1
    inp.close()
    out = {}
    names = {'DiffCol': 'Diffuse Color', 'AO': 'Ambient Occlusion'}
    for key in ('DiffCol', 'Normal', 'Position', 'AO', 'rough'):
        k2 = names.get(key, key)
        found = sorted(n for n in chans if f".{key}." in n or f".{k2}." in n)
        if not found:
            continue
        comps = [n for n in found]
        arrs = [chans[n] for n in comps]
        # order X Y Z / R G B
        order = sorted(range(len(comps)), key=lambda i: "XYZRGBAV".find(comps[i].split(".")[-1]))
        out[key] = np.stack([arrs[i] for i in order], -1)[..., :3] if len(arrs) > 1 else arrs[0]
    return out


def _channels(path):
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    names = []
    sub = 0
    while inp.seek_subimage(sub, 0):
        names += list(inp.spec().channelnames)
        sub += 1
    inp.close()
    return names


def build_all(out_dir, quick=False, only=None):
    os.makedirs(out_dir, exist_ok=True)
    info = {}
    path = os.path.join(out_dir, "tiles.json")
    if os.path.exists(path):
        info = json.load(open(path))
    from . import btiles
    for name in list(SPEC) + list(btiles.BUILD_SPEC):
        if only and name not in only:
            continue
        info[name] = render_tile(name, out_dir, quick)
        json.dump(info, open(path, "w"), indent=1)
    return info
