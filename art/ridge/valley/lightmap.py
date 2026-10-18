"""The terrain's light map (terrain/light.webp, the log-polar layout):

    R  sky visibility (ambient occlusion) of the ground, trees and buildings
       included - the forest floor is dark, a street between houses dimmer
    G  the sun's horizon: the elevation (degrees) above which the sun is
       seen from that point along the sun's bearing, terrain only;
       deg = G * 40 - 10. The game compares its current sun elevation with
       it, so the shadow line creeps down the far slope as the sun rises
    B  the shadows of trees and buildings at the design sun (1 = lit),
       where the terrain itself does not already shade
    A  the valley mist's density over this point relative to the river
       (1 on the river, ~0.3 far from it): scale the height mist by it

How: shadowing from a light at a fixed azimuth is a sweep. On a grid whose
rows run toward the light, the 'shadow height' S at a cell is
max(H, S) of the next cell toward the light minus the step times
tan(elevation): a point is lit when its own height reaches S. One pass per
elevation, O(cells). The texel then compares its exact height with the
interpolated S, so edges are sharper than the grid.
"""

import math
import time

import numpy as np

from . import layout as L
from .noise import Grid, smoothstep

CELL = 4.0


def log(*a):
    print("[lightmap]", *a, flush=True)


class Rotated:
    """A grid over the domain with rows running toward azimuth `bearing`
    (degrees): a = along the direction toward the light, b = across."""

    def __init__(self, bearing, x0, x1, y0, y1, cell=CELL):
        th = math.radians(bearing)
        self.d = np.array([math.sin(th), math.cos(th)])       # toward the light
        self.e = np.array([self.d[1], -self.d[0]])
        corners = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
        a = corners @ self.d
        b = corners @ self.e
        self.a0, self.b0 = a.min(), b.min()
        self.na = int((a.max() - a.min()) / cell) + 2
        self.nb = int((b.max() - b.min()) / cell) + 2
        self.cell = cell

    def world(self):
        A = self.a0 + np.arange(self.na) * self.cell
        B = self.b0 + np.arange(self.nb) * self.cell
        AA, BB = np.meshgrid(A, B, indexing='ij')           # (na, nb): axis 0 toward the light
        X = AA * self.d[0] + BB * self.e[0]
        Y = AA * self.d[1] + BB * self.e[1]
        return X, Y

    def ab(self, x, y):
        return (x * self.d[0] + y * self.d[1] - self.a0) / self.cell, (x * self.e[0] + y * self.e[1] - self.b0) / self.cell

    def sample(self, F, x, y):
        fa, fb = self.ab(x, y)
        fa = np.clip(fa, 0, self.na - 1.001)
        fb = np.clip(fb, 0, self.nb - 1.001)
        ia, ib = fa.astype(int), fb.astype(int)
        ta, tb = fa - ia, fb - ib
        return ((F[ia, ib] * (1 - ta) + F[ia + 1, ib] * ta) * (1 - tb) + (F[ia, ib + 1] * (1 - ta) + F[ia + 1, ib + 1] * ta) * tb)


def shadow_height(H, tan_el, cell):
    """S[i] = max over cells toward the light (higher index) of H - dist * tan."""
    na = H.shape[0]
    S = np.full(H.shape, -1e9, np.float32)
    run = np.full(H.shape[1], -1e9, np.float32)
    drop = np.float32(cell * tan_el)
    for i in range(na - 1, -1, -1):
        run = run - drop
        S[i] = run
        run = np.maximum(run, H[i])
    return S


def rasterize_canopy(inst, cell=CELL, bounds=None):
    """A grid of the forest's canopy tops (and 0 elsewhere), m above the
    ground: each tree a cone over its crown."""
    x0, x1, y0, y1 = bounds
    nx = int((x1 - x0) / cell) + 1
    ny = int((y1 - y0) / cell) + 1
    G = np.zeros((ny, nx), np.float32)
    h = np.where(inst['species'] == 'fir', np.where(inst['variant'] == 'c', 11.0, 25.0),
                 np.where(inst['species'] == 'larch', 22.0, np.where(inst['species'] == 'bush', 3.0, 13.0))) * inst['scale']
    rc = np.where(inst['species'] == 'fir', 0.2, np.where(inst['species'] == 'larch', 0.24, 0.3)) * h
    ci = ((inst['x'] - x0) / cell).astype(int)
    cj = ((inst['y'] - y0) / cell).astype(int)
    for dj in range(-2, 3):
        for di in range(-2, 3):
            rho = math.hypot(di, dj) * cell
            val = h * np.clip(1 - rho / np.maximum(rc, 0.5), 0, 1) * 0.9
            ii, jj = ci + di, cj + dj
            ok = (ii >= 0) & (ii < nx) & (jj >= 0) & (jj < ny) & (val > 0)
            np.maximum.at(G, (jj[ok], ii[ok]), val[ok].astype(np.float32))
    return Grid(x0, y0, cell, nx, ny, G)


def rasterize_buildings(G):
    """Buildings as blocks on the canopy grid (their shadows and occlusion)."""
    blocks = []
    for h in L.village_plan():
        if h['kind'] == 'house':
            blocks.append((h['c'], h['w'] + 1.0, h['d'] + 1.0, h['rot'], h['floors'] * 2.75 + 2.5))
        elif h['kind'] == 'chapel':
            blocks.append((h['c'], h['w'], h['d'], h['rot'], 10.0))
    blocks.append((L.FARM_C, 30.0, 14.0, math.radians(-29 + 90), 8.0))
    X, Y = G.coords()
    for c, w, d, rot, hh in blocks:
        ca, sa = math.cos(rot), math.sin(rot)
        lx = (X - c[0]) * ca + (Y - c[1]) * sa
        ly = -(X - c[0]) * sa + (Y - c[1]) * ca
        m = (np.abs(lx) < w / 2) & (np.abs(ly) < d / 2)
        G.v[m] = np.maximum(G.v[m], hh)
    return G


def bake(ter, inst, maps_dir, W, H_, quick=False):
    t0 = time.time()
    from .maps import texel_points
    X, Y, R = texel_points(W, H_)
    x, y = X.ravel(), Y.ravel()
    zt = ter.height(x, y)
    b = (-6000.0, 6000.0, -3800.0, 8600.0)
    canopy = rasterize_canopy(inst, bounds=b)
    canopy = rasterize_buildings(canopy)
    log(f"canopy rasterized ({time.time() - t0:.0f}s)")
    can_t = canopy.sample(x, y)
    # ---- G: the sun's horizon, terrain only
    grid = Rotated(L.SUN_BEARING, *b)
    GX, GY = grid.world()
    Hterr = ter.height(GX.ravel(), GY.ravel()).reshape(GX.shape).astype(np.float32)
    Hcan = Hterr + canopy.sample(GX.ravel(), GY.ravel()).reshape(GX.shape).astype(np.float32)
    log(f"sun grid {grid.na}x{grid.nb} ({time.time() - t0:.0f}s)")
    horizon = np.full(len(x), 30.0)
    for el in range(-10, 31):
        S_ = shadow_height(Hterr, math.tan(math.radians(el)), grid.cell)
        lit = zt + 0.6 >= grid.sample(S_, x, y)
        horizon = np.where(lit & (horizon > el), el, horizon)
    # smooth the 1-degree steps: the elevation where lit, minus half a step
    horizon = horizon - 0.5
    log(f"sun horizon ({time.time() - t0:.0f}s)")
    # ---- B: trees' and buildings' shadow at the design sun
    tan_d = math.tan(math.radians(L.SUN_ELEV))
    S_c = shadow_height(Hcan, tan_d, grid.cell)
    S_t = shadow_height(Hterr, tan_d, grid.cell)
    lit_terr = zt + 0.6 >= grid.sample(S_t, x, y)
    lit_can = zt + 0.6 + 0.15 * can_t >= grid.sample(S_c, x, y)
    B = np.where(lit_terr, lit_can.astype(float), 1.0)
    # ---- R: sky visibility over 8 azimuths x 4 elevations, trees and buildings in
    vis = np.zeros(len(x))
    wsum = 0.0
    for az in range(0, 360, 45):
        g = Rotated(az + 22.5, *b, cell=CELL * 1.5)
        gx, gy = g.world()
        hc = (ter.height(gx.ravel(), gy.ravel()) + canopy.sample(gx.ravel(), gy.ravel())).reshape(gx.shape).astype(np.float32)
        for el, w in ((4.0, 0.35), (12.0, 0.3), (25.0, 0.22), (45.0, 0.13)):
            S_ = shadow_height(hc, math.tan(math.radians(el)), g.cell)
            ok = zt + 0.8 + can_t * 0.5 >= g.sample(S_, x, y)
            vis += w * ok
            wsum += w
    vis /= wsum
    # under a canopy the ground sees little sky whatever the terrain says
    vis *= 1 - 0.6 * smoothstep(2.0, 12.0, can_t)
    log(f"sky visibility ({time.time() - t0:.0f}s)")
    from .post import river_mist
    mist = river_mist(x, y)
    img = np.stack([vis, np.clip((horizon + 10) / 40.0, 0, 1), B, mist], -1).reshape(H_, W, 4)[::-1]
    from .imgio import write
    import os
    write(os.path.join(maps_dir, "light.png"), img)
    log(f"light map {W}x{H_} ({time.time() - t0:.0f}s)")
    return img
