"""The planet: an Earth-like world generated from nothing, as equirect maps.

    albedo   surface reflectance (sRGB): oceans with shelves and banks,
             deserts, forests, steppe, tundra, ice, rivers, salt pans
    clouds   cloud opacity: weather advected by a wind field (jets, highs,
             cyclones), fronts and comma clouds, hurricanes, thunderstorm
             clusters, stratocumulus decks, cirrus
    night    city lights: metros on coasts and rivers, towns strung along
             roads, fishing fleets, gas flares (and one faint "HI")
    water    ocean and lake mask (the specular glint)
    height   land relief, 0 at sea level (optional in the contract)
    detail   a tileable texture of sub-pixel cloud and terrain detail
             (the maps are ~10 km a pixel; the view needs ~1)

It is not Earth, but it is built the way Earth is: plates make continents
and push up ranges where they collide; the latitude bands of the general
circulation decide where it rains; mountains cast rain shadows; rivers
drain the land to the sea over the filled terrain; clouds are carried and
wound up by the winds; people live on coasts and rivers in temperate and
tropical lowlands and join their cities with roads.

All of it is numpy on the unit sphere (see noise.py), seeded: the same
seed gives the same world. Pure numpy, no bpy: it runs inside Blender for
the build and from plain python for quick previews.

Axes: +Z north, longitude 0 on +X. Equirect maps have north at the top
row and longitude -180 at the left edge.
"""

import heapq
import math
import time
import zlib

import numpy as np

from . import noise as N

F32 = np.float32
SEED = 1961
R_KM = 6371.0


def srgb(c):
    """sRGB 0-255 -> linear reflectance (palette entries read like swatches)."""
    c = np.asarray(c, F32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F32)


def to_srgb8(lin):
    lin = np.clip(lin, 0, 1)
    s = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return np.clip(np.round(s * 255), 0, 255).astype(np.uint8)


def lerp(a, b, t):
    return a + (b - a) * t


def gauss(x, mu, sd):
    return np.exp(-((x - mu) / sd) ** 2).astype(F32)


def unit(lon_deg, lat_deg):
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)], F32)


class Planet:
    def __init__(self, W=4096, H=2048, seed=SEED, log=print):
        self.W, self.H, self.seed = W, H, seed
        self.log = log
        self.t0 = time.time()
        self.lon, self.lat = N.lonlat_grid(W, H)
        self.P = N.sphere_points(self.lon, self.lat)
        self.LAT = np.ascontiguousarray(np.broadcast_to(self.lat[:, None], (H, W)))
        self.LON = np.ascontiguousarray(np.broadcast_to(self.lon[None, :], (H, W)))
        # half and quarter grids for the smooth fields
        self.W2, self.H2 = W // 2, H // 2
        self.W4, self.H4 = W // 4, H // 4
        lo2, la2 = N.lonlat_grid(self.W2, self.H2)
        lo4, la4 = N.lonlat_grid(self.W4, self.H4)
        self.P2 = N.sphere_points(lo2, la2)
        self.P4 = N.sphere_points(lo4, la4)
        self.LAT2 = np.ascontiguousarray(np.broadcast_to(la2[:, None], (self.H2, self.W2)))
        self.LAT4 = np.ascontiguousarray(np.broadcast_to(la4[:, None], (self.H4, self.W4)))
        self.LON4 = np.ascontiguousarray(np.broadcast_to(lo4[None, :], (self.H4, self.W4)))
        self.km_px = 2 * math.pi * R_KM / W       # at the equator
        self.meta = {}

    # -- plumbing -----------------------------------------------------------
    def rng(self, tag):
        return np.random.default_rng(zlib.crc32(f"{self.seed}:{tag}".encode()))

    def field(self, tag, octaves=8):
        return N.Field(zlib.crc32(f"{self.seed}:{tag}".encode()) & 0x7fffffff, octaves)

    def up(self, a, W=None, H=None):
        """Upsample a coarse equirect field to full (or given) resolution."""
        return N.resize(a, W or self.W, H or self.H)

    def down4(self, a):
        return N.resize(a, self.W4, self.H4)

    def say(self, msg):
        self.log(f"  [{time.time() - self.t0:6.1f}s] {msg}")

    # ======================================================================
    # 1. Continents, plates, mountains, sea floor

    def tectonics(self):
        """Plates on a warped sphere: which plate a point is on, how close it
        is to a boundary, and whether that boundary is a collision."""
        P4 = self.P4
        rng = self.rng("plates")
        K = 13
        seeds = rng.normal(size=(K, 3))
        seeds /= np.linalg.norm(seeds, axis=1, keepdims=True)
        wf = self.field("plate-warp")
        Q = N.tangent_warp(P4, wf.vec(P4, 1.6, 4), 0.55)
        Q = N.tangent_warp(Q, wf.vec(Q, 5.0, 3), 0.08)
        d = Q.reshape(-1, 3) @ seeds.T.astype(F32)
        order = np.argsort(-d, axis=1)
        i1, i2 = order[:, 0], order[:, 1]
        a1 = np.arccos(np.clip(d[np.arange(d.shape[0]), i1], -1, 1))
        a2 = np.arccos(np.clip(d[np.arange(d.shape[0]), i2], -1, 1))
        bdist = (a2 - a1).reshape(self.H4, self.W4).astype(F32)
        # each plate turns about its own Euler pole; convergence across a
        # boundary is the relative motion along the boundary normal
        omega = rng.normal(size=(K, 3)).astype(F32)
        p = P4.reshape(-1, 3)
        v1 = np.cross(omega[i1], p)
        v2 = np.cross(omega[i2], p)
        nrm = seeds[i2] - seeds[i1]
        nrm = nrm - p * np.sum(nrm * p, 1, keepdims=True)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-6)
        conv = np.sum((v1 - v2) * nrm, 1).reshape(self.H4, self.W4).astype(F32)
        self.bdist4 = bdist
        # convergence jumps where the neighbouring plate changes: smooth it so
        # ranges and plateaus fade along a boundary instead of ending on a line
        self.conv4 = N.blur(conv, 3, 3)
        self.say(f"tectonics: {K} plates")

    def continents(self):
        P2 = self.P2
        # A few large continental masses in chosen places (Earth's land is
        # lumped, not spread evenly), a polar continent in the south, a
        # polar ocean in the north and an empty ocean hemisphere like the
        # Pacific around longitude 180.
        masses = [
            # lon, lat, radius (deg), weight
            (-102, 44, 24, 1.00), (-80, 58, 14, 0.7), (-88, 20, 9, 0.55),
            (-66, -8, 17, 0.95), (-64, -32, 12, 0.8),
            (8, 50, 16, 0.85), (30, 56, 18, 0.9), (0, 38, 8, 0.45),
            (18, 8, 18, 0.95), (28, -18, 14, 0.85),
            (58, 30, 14, 0.8), (78, 44, 22, 1.0), (104, 50, 18, 0.9), (82, 18, 9, 0.7),
            (110, 22, 11, 0.7), (122, 2, 7, 0.45), (140, -4, 7, 0.4),
            (132, -26, 14, 0.95),
            (0, -90, 20, 1.15), (60, -82, 12, 0.6), (-120, -80, 10, 0.5),
            (-42, 72, 9, 0.7), (150, 62, 10, 0.55),
        ]
        wf = self.field("cont-warp")
        Q = N.tangent_warp(P2, wf.vec(P2, 1.1, 4), 0.40)
        Q = N.tangent_warp(Q, wf.vec(Q, 2.9, 4), 0.14)
        Q = N.tangent_warp(Q, wf.vec(Q, 7.5, 3), 0.035)
        L = np.zeros(P2.shape[:2], F32)
        for lo, la, rad, w in masses:
            c = unit(lo, la)
            ang = np.arccos(np.clip(Q @ c, -1, 1))
            L += F32(w) * np.exp(-(ang / math.radians(rad)) ** 2).astype(F32)
        L = np.minimum(L, 1.25)
        f = self.field("cont")
        M = f.fbm(Q, 1.7, 5)
        Dm = f.fbm(Q, 5.0, 5, first=6)
        c2 = 0.95 * L + 0.42 * M + 0.20 * Dm
        c = self.up(c2)
        # coastline detail at full resolution: rugged, fractal coasts with
        # skerries and fjords where the relief is young
        fd = self.field("coast")
        Pw = N.tangent_warp(self.P, fd.vec(self.P, 9.0, 3), 0.02)
        rug = 0.6 + 0.8 * N.smoothstep(-0.3, 0.4, fd.fbm(self.P, 2.0, 3, first=12))
        c += (0.085 * fd.fbm(Pw, 16.0, 6) + 0.04 * fd.fbm(Pw, 70.0, 4, first=6)) * rug
        self.sea = float(np.quantile(c[::4, ::4], 0.70))
        self.c = (c - F32(self.sea)).astype(F32)
        self.land = (self.c > 0).astype(F32)
        self.say(f"continents: land {self.land.mean() * 100:.1f}%")

    def relief(self):
        """Land elevation (km) and ocean depth (km, negative)."""
        c = self.c
        bd = self.up(self.bdist4)
        cv = self.up(self.conv4)
        fm = self.field("mountains")
        Pw = N.tangent_warp(self.P, fm.vec(self.P, 3.0, 3), 0.05)
        ridges = fm.ridged(Pw, 7.0, 7, sharp=2.2)
        # collision ranges along converging boundaries, strongest where the
        # crust is continental; broad plateaus behind them
        near = np.exp(-(bd / 0.10) ** 2)
        wide = np.exp(-(bd / 0.28) ** 2)
        collide = np.clip(cv * 1.3, 0, 1.5)
        cont = N.smoothstep(-0.05, 0.25, c)
        rng_mask = near * collide * cont
        plateau = wide * collide * cont * 0.9
        old = N.smoothstep(0.35, 0.75, fm.fbm(self.P, 2.2, 3, first=8)) * cont
        base = 0.12 + 0.8 * N.smoothstep(0.0, 0.6, c) * (0.5 + 0.5 * fm.fbm(Pw, 3.0, 4, first=3))
        hills = fm.fbm(Pw, 24.0, 5, first=5) * 0.16
        elev = base + hills + rng_mask * (ridges * 5.0) + plateau * 0.9 + old * ridges * 1.4
        elev = np.maximum(elev, 0.02)
        # ocean: continental shelf out to where the crust ends (wider on
        # passive margins, narrow where plates collide), a slope, abyssal
        # plains, ridges at spreading boundaries, trenches at subduction
        oce = -c
        fo = self.field("ocean")
        shelf_w = 0.02 + 0.09 * N.smoothstep(-0.4, 0.5, fo.fbm(self.P, 3.5, 4, first=3)) * (1 - 0.7 * np.clip(collide, 0, 1))
        shelf = N.smoothstep(0.0, 1.0, oce / shelf_w)
        slope = N.smoothstep(0.6, 2.4, oce / shelf_w)
        abyss = 4.6 - 0.6 * fo.fbm(self.P, 3.0, 5)
        ridge = np.exp(-(bd / 0.06) ** 2) * np.clip(-cv * 1.5, 0, 1) * (0.7 + 0.6 * ridges)
        trench = np.exp(-(bd / 0.03) ** 2) * np.clip(cv, 0, 1) * (1 - cont)
        depth = -0.03 - 0.12 * shelf - (abyss - 0.15) * slope + ridge * 2.2 - trench * 3.5
        self.elev = np.where(c > 0, elev, np.minimum(depth, -0.01)).astype(F32)
        self.ridges = ridges.astype(F32)
        self.collide = (np.clip(collide, 0, 1) * cont).astype(F32)
        self.say(f"relief: land max {self.elev.max():.1f} km, ocean min {self.elev.min():.1f} km")

    def islands(self):
        """Hotspot island chains and volcanic arcs: small islands strung in
        lines across the open ocean, the way Hawaii or the Aleutians are."""
        rng = self.rng("islands")
        add = np.zeros((self.H, self.W), F32)
        for k in range(11):
            lo = rng.uniform(-math.pi, math.pi)
            la = rng.uniform(-0.9, 0.9)
            heading = rng.uniform(0, 2 * math.pi)
            n = int(rng.integers(5, 16))
            step = rng.uniform(0.010, 0.025)
            size = rng.uniform(0.0025, 0.009)
            for i in range(n):
                la_i = la + math.sin(heading) * step * i + rng.normal(0, 0.003)
                lo_i = lo + math.cos(heading) * step * i / max(math.cos(la_i), 0.2) + rng.normal(0, 0.003)
                s = size * (1.0 - 0.7 * i / n) * rng.uniform(0.6, 1.3)
                self._bump(add, lo_i, la_i, s, 1.0)
        fi = self.field("islands")
        add *= 0.7 + 0.6 * fi.fbm(self.P, 90.0, 3)
        self.c = self.c + add * 0.35
        isl = (self.c > 0) & (self.elev < 0)
        self.elev = np.where(isl, 0.1 + add * 1.5, self.elev).astype(F32)
        self.land = (self.c > 0).astype(F32)
        self.say(f"islands: land {self.land.mean() * 100:.1f}%")

    def _bump(self, arr, lo, la, rad, amp, P=None):
        """Add a Gaussian bump (radius in radians) to an equirect map."""
        H, W = arr.shape[:2]
        P = self.P if P is None else P
        r_px = rad / (2 * math.pi) * W * 3 + 1
        cx = (lo + math.pi) / (2 * math.pi) * W
        cy = (math.pi / 2 - la) / math.pi * H
        y0, y1 = int(max(0, cy - r_px)), int(min(H, cy + r_px + 1))
        rx = min(W / 2, r_px / max(math.cos(la), 0.05))
        xs = np.arange(int(cx - rx), int(cx + rx) + 1)
        if y1 <= y0 or xs.size == 0:
            return
        Pc = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)], F32)
        sub = P[y0:y1][:, xs % W]
        ang = np.arccos(np.clip(sub @ Pc, -1, 1))
        g = np.exp(-(ang / rad) ** 2)
        if arr.ndim == 3:
            arr[y0:y1, xs % W] += np.asarray(amp, F32) * g[..., None]
        else:
            arr[y0:y1, xs % W] += F32(amp) * g

    # ======================================================================
    # 2. Climate (quarter resolution)

    def _upwind(self, fld, lat, dists_km, weights, direction):
        """Average a coarse field over points upwind along latitude circles.
        direction: +1 where the wind blows toward the east (westerlies: the
        air comes from the west), -1 for easterlies."""
        H, W = fld.shape
        acc = np.zeros_like(fld)
        tot = 0.0
        coslat = np.maximum(np.cos(lat), 0.15)
        ys = np.arange(H)[:, None].repeat(W, 1)
        for d, w in zip(dists_km, weights):
            shift_px = d / (R_KM * coslat) / (2 * math.pi) * W
            xs = (np.arange(W)[None, :] - direction * shift_px).astype(F32)
            x0 = np.floor(xs).astype(np.int64)
            fx = xs - x0
            a = fld[ys, x0 % W]
            b = fld[ys, (x0 + 1) % W]
            acc += w * (a * (1 - fx) + b * fx)
            tot += w
        return acc / tot

    def climate(self):
        lat = self.LAT4
        alat = np.abs(lat)
        dlat = np.degrees(alat)
        elev = np.maximum(self.down4(self.elev), 0)
        land = self.down4(self.land)
        ocean = 1 - land
        f = self.field("climate")
        n = f.fbm(self.P4, 3.0, 4)
        # prevailing winds: trade easterlies, mid-latitude westerlies,
        # polar easterlies (+1 blows toward the east)
        wind = np.where(dlat < 30, -1.0, np.where(dlat < 62, 1.0, -1.0)).astype(F32)
        s2 = np.sin(alat) ** 2
        T = 27.0 - 30.0 * s2 - 20.0 * s2 ** 3 - 6.0 * elev + 2.5 * n
        T += np.where(lat < 0, -6.0 * s2 ** 4, 0)       # the southern polar continent is colder still
        # continental interiors swing colder; coasts are mild
        near_sea = N.blur(ocean, 6, 2)
        T -= 4.0 * (1 - near_sea) * N.smoothstep(35, 60, dlat)
        itcz = 5.0 + 4.0 * np.sin(self.LON4 * 2 + 0.7)
        P = (2300 * gauss(np.degrees(lat), itcz, 12.0)
             + 1250 * gauss(dlat, 50.0, 14.0)
             + 520) * (1 - 0.72 * gauss(dlat, 27.0, 8.0)) * (1 - 0.6 * N.smoothstep(66, 85, dlat))
        # moisture carried in from the sea by the prevailing wind, lost to
        # mountains on the way: rain shadows
        dists = [100, 300, 600, 1000, 1600, 2400]
        wts = [1.0, 0.9, 0.75, 0.55, 0.4, 0.3]
        wet_up = self._upwind(ocean, lat, dists, wts, wind)
        hi_up = np.maximum.reduce([self._upwind(elev, lat, [d], [1.0], wind) for d in (150, 350, 700, 1100)])
        shadow = np.exp(-np.maximum(hi_up - elev, 0) / 1.4)
        rise = np.maximum(elev - self._upwind(elev, lat, [120], [1.0], wind), 0)
        moist = np.clip(0.35 + 0.8 * np.maximum(wet_up, near_sea * 0.9), 0, 1.1)
        P = P * moist * (0.4 + 0.6 * shadow) * (1 + 1.6 * np.minimum(rise, 1.5)) * (0.75 + 0.5 * (n * 0.5 + 0.5))
        # cold currents dry the subtropical west coasts (Atacama, Namib)
        west_coast_dry = gauss(dlat, 22, 9) * (wind < 0) * N.smoothstep(0.3, 0.7, self._upwind(land, lat, [250, 600], [1, 1], -wind))
        P *= 1 - 0.6 * west_coast_dry * land
        self.T4 = T.astype(F32)
        self.P4mm = np.maximum(P, 20).astype(F32)
        self.near_sea4 = near_sea.astype(F32)
        L = land > 0.5
        self.say(f"climate: land T {T[L].min():.0f}..{T[L].max():.0f} C, P {np.percentile(P[L], 10):.0f}/"
                 f"{np.median(P[L]):.0f}/{np.percentile(P[L], 90):.0f} mm")

    # ======================================================================
    # 3. Hydrology (quarter resolution): priority flood, rivers, lakes

    def hydrology(self):
        H4, W4 = self.H4, self.W4
        E = N.blur(self.down4(self.elev), 1, 2).astype(np.float64)
        land = self.down4(self.land) > 0.5
        E = np.where(land, np.maximum(E, 0.001), -1.0)
        E = E + self.rng("hydro").uniform(0, 2e-4, E.shape) * land
        recv = np.full(E.size, -1, np.int64)
        done = ~land.ravel().copy()
        Ef = E.ravel().copy()
        ff = Ef.copy()
        heap = []
        coast = np.zeros_like(land)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            coast |= land & ~np.roll(np.roll(land, dy, 0), dx, 1)
        idx = np.arange(E.size).reshape(H4, W4)
        for i in idx[coast]:
            heapq.heappush(heap, (Ef[i], int(i)))
            done[i] = True
            recv[i] = -2
        order = []
        nb = ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1))
        while heap:
            e, i = heapq.heappop(heap)
            order.append(i)
            y, x = divmod(i, W4)
            for dy, dx in nb:
                yy = y + dy
                if yy < 0 or yy >= H4:
                    continue
                j = yy * W4 + (x + dx) % W4
                if done[j]:
                    continue
                done[j] = True
                ne = Ef[j]
                if ne <= e:
                    ne = e + 1e-6
                ff[j] = ne
                recv[j] = i
                heapq.heappush(heap, (ne, j))
        order = np.array(order, np.int64)
        runoff = np.maximum(self.P4mm.ravel().astype(np.float64) - 300.0, 0.0) * np.cos(self.LAT4.ravel()) * land.ravel()
        acc = runoff.copy()
        for i in order[::-1]:
            r = recv[i]
            if r >= 0:
                acc[r] += acc[i]
        self.recv4 = recv
        self.acc4 = acc.reshape(H4, W4).astype(F32)
        self.lake4 = ((ff - Ef).reshape(H4, W4) * land).astype(F32)
        self.say(f"hydrology: {len(order)} land cells")

    def rivers(self):
        """Draw the drainage network at full resolution: every coarse cell
        above a flow threshold joins its receiver with a meandering line,
        wider for bigger rivers."""
        W4 = self.W4
        W, H = self.W, self.H
        acc = self.acc4.ravel()
        recv = self.recv4
        pos = acc[acc > 0]
        thr = np.quantile(pos, 0.90) if pos.size else 1.0
        riv = np.zeros((H, W), F32)
        big = np.zeros((H, W), F32)
        cells = np.nonzero((acc > thr) & (recv >= 0))[0]
        sx = W / W4
        jit = self.rng("river-jit").uniform(-0.35, 0.35, (acc.size, 2))
        amax = acc.max()
        rng = self.rng("meander")
        for i in cells:
            j = recv[i]
            y0, x0 = divmod(i, W4)
            y1, x1 = divmod(j, W4)
            if abs(x1 - x0) > 2:
                x1 = x1 + W4 if x1 < x0 else x1 - W4
            X0, Y0 = (x0 + 0.5 + jit[i, 0]) * sx, (y0 + 0.5 + jit[i, 1]) * sx
            X1, Y1 = (x1 + 0.5 + jit[j, 0]) * sx, (y1 + 0.5 + jit[j, 1]) * sx
            L = max(abs(X1 - X0), abs(Y1 - Y0))
            n = int(L * 2.5) + 2
            t = np.linspace(0, 1, n, dtype=F32)
            px, py = X0 + (X1 - X0) * t, Y0 + (Y1 - Y0) * t
            nx, ny = -(Y1 - Y0), (X1 - X0)
            nl = max(math.hypot(nx, ny), 1e-6)
            amp = 0.22 * sx * rng.uniform(-1, 1)
            off = amp * np.sin(t * math.pi) * (1 + 0.5 * np.sin(t * math.pi * 3 + rng.uniform(0, 6)))
            px += nx / nl * off
            py += ny / nl * off
            a = acc[i]
            w = min(1.0, 0.3 + 0.7 * math.log1p(a / thr) / math.log1p(amax / thr))
            xi = np.round(px).astype(np.int64) % W
            yi = np.clip(np.round(py).astype(np.int64), 0, H - 1)
            np.maximum.at(riv, (yi, xi), w)
            if a > thr * 30:
                np.maximum.at(big, (yi, xi), 1.0)
        self.river = np.clip(riv, 0, 1).astype(F32) * self.land
        self.bigriver = big * self.land
        self.say(f"rivers: {len(cells)} reaches")

    # ======================================================================
    # 4. Surface colour

    def surface(self):
        H, W = self.H, self.W
        T = self.up(self.T4)
        P = self.up(self.P4mm)
        land = self.land
        elev = self.elev
        lat = self.LAT
        dlat = np.degrees(np.abs(lat))
        f = self.field("surface")
        Pw = N.tangent_warp(self.P, f.vec(self.P, 6.0, 3), 0.04)
        n1 = f.fbm(Pw, 12.0, 6)
        n2 = f.fbm(Pw, 40.0, 5, first=6)
        n3 = f.fbm(self.P, 3.0, 4, first=3)
        logP = np.log10(np.maximum(P, 10)) + 0.10 * n1 + 0.06 * n3
        # palette: sRGB swatches of the ground as seen from orbit
        rainforest = srgb((20, 42, 16))
        forest = srgb((30, 50, 22))
        boreal = srgb((24, 36, 26))
        woodland = srgb((58, 70, 34))
        savanna = srgb((124, 110, 66))
        grass = srgb((96, 100, 58))
        steppe = srgb((140, 126, 92))
        tundra = srgb((98, 94, 78))
        sand = srgb((214, 176, 122))
        red_sand = srgb((196, 120, 66))
        pale = srgb((230, 212, 172))
        rock = srgb((132, 112, 90))
        dark_rock = srgb((62, 54, 48))
        mountain = srgb((96, 88, 80))
        snow = srgb((238, 242, 248))
        warm = N.smoothstep(4, 22, T)[..., None]
        cold = N.smoothstep(4, -5, T)[..., None]
        # vegetation by rainfall: forest > woodland > grass/savanna > steppe
        wet_col = lerp(forest, rainforest, warm)
        wet_col = lerp(wet_col, boreal, cold)
        mid_col = lerp(grass, woodland, warm * 0.7)
        mid_col = lerp(mid_col, boreal * 1.25, cold)
        low_col = lerp(steppe, savanna, warm)
        v1 = N.smoothstep(2.45, 2.95, logP)[..., None]      # ~300 .. 900 mm
        v2 = N.smoothstep(2.85, 3.2, logP)[..., None]       # ~700 .. 1600 mm
        col = lerp(lerp(low_col, mid_col, v1), wet_col, v2)
        # deserts: sand seas, red dune fields, dark rocky plateaus, pale pans
        fd = self.field("desert")
        dn = fd.fbm(self.P, 4.0, 5)
        dn2 = fd.fbm(Pw, 14.0, 5, first=5)
        ridge_d = fd.ridged(Pw, 18.0, 4)
        erg = N.smoothstep(0.0, 0.12, fd.fbm(Pw, 6.0, 5, first=9))            # sand seas, sharp-edged
        dcol = lerp(rock, sand, erg[..., None])
        dcol = lerp(dcol, red_sand, (N.smoothstep(0.0, 0.3, dn) * erg)[..., None])
        dcol = lerp(dcol, pale, (N.smoothstep(0.15, 0.45, -dn2) * (1 - erg))[..., None] * 0.7)
        dcol = lerp(dcol, dark_rock, (N.smoothstep(0.45, 0.95, ridge_d) * (1 - erg))[..., None] * 0.55)
        dcol = lerp(dcol, dark_rock, N.smoothstep(0.8, 2.2, elev)[..., None] * 0.6)
        basalt = N.smoothstep(0.6, 0.68, fd.fbm(self.P, 9.0, 4, first=14))
        dcol = lerp(dcol, srgb((38, 34, 32)), basalt[..., None] * 0.85)
        desert = (1 - N.smoothstep(2.1, 2.55, logP))[..., None] * N.smoothstep(2, 10, T)[..., None]
        col = lerp(col, dcol, desert)
        # cold and dry: tundra, polar desert
        col = lerp(col, tundra, (N.smoothstep(1, -8, T) * (1 - v2[..., 0] * 0.5))[..., None] * 0.9)
        # soil and canopy variation at every scale
        n4 = f.fbm(Pw, 160.0, 3, first=16)
        col *= (1 + 0.14 * n1 + 0.10 * n2 + 0.08 * n4)[..., None]
        # red tropical soils through the savanna
        col = lerp(col, srgb((150, 86, 50)), (N.smoothstep(0.1, 0.6, n3) * warm[..., 0] * (1 - v2[..., 0]) * (1 - desert[..., 0]) * 0.4)[..., None])
        # farmland: lighter patchwork in the temperate plains
        farm = N.smoothstep(0.1, 0.5, f.fbm(self.P, 7.0, 4, first=10)) * gauss(dlat, 42, 12) * N.smoothstep(2.4, 2.8, logP) \
            * N.smoothstep(1.2, 0.3, elev)
        col = lerp(col, srgb((118, 116, 74)) * (1 + 0.25 * n2[..., None]), farm[..., None] * 0.55)
        # rivers: green ribbons through dry country, dark channels elsewhere
        riv = self.river
        rip = np.clip(N.blur(riv, 1, 2) * 3.0, 0, 1)
        col = lerp(col, srgb((44, 66, 28)), (rip * desert[..., 0] * 0.85)[..., None])
        col = lerp(col, srgb((18, 28, 30)), (riv * (0.12 + 0.35 * desert[..., 0]) * N.smoothstep(0.4, 1.0, riv))[..., None])
        # mountains: bare rock, then snow above the snow line
        slope = self._slope(elev)
        rocky = N.smoothstep(0.9, 3.2, elev) * (0.5 + 0.5 * N.smoothstep(0.02, 0.12, slope))
        col = lerp(col, mountain * (0.85 + 0.35 * self.ridges[..., None]), rocky[..., None])
        snowline = -T + 2.0 * (self.ridges - 0.5) + 1.2 * n2
        snowy = N.smoothstep(3.0, 8.0, snowline) * N.smoothstep(1.2, 2.6, elev) * N.smoothstep(0.45, 0.8, self.ridges + 0.15 * n2)
        col = lerp(col, snow, snowy[..., None])
        # ice sheets on the coldest land, bluer at the edges
        hb = N.blur(elev, 2, 2)
        relief = np.clip((elev - hb) * 0.35, -0.3, 0.3) * (land > 0)
        col *= (1 + relief)[..., None]
        # ice sheets need snow to build them: cold *and* not a polar desert
        icef = N.smoothstep(-15, -21, T + 3 * n1 - 3 * N.smoothstep(2.1, 2.6, logP))
        ice_col = lerp(srgb((206, 216, 230)), srgb((240, 243, 248)), N.smoothstep(0.0, 1.0, icef)[..., None])
        col = lerp(col, ice_col * (1 + 0.03 * n2[..., None]), icef[..., None])
        # lakes and salt pans in the filled basins
        ld = self.up(self.lake4)
        ld = ld + 0.03 * n2
        arid = (P < 350) & (T > 2)
        fresh = (ld > 0.07) & (land > 0) & ~arid
        salt = (ld > 0.30) & (land > 0) & arid
        col = np.where(salt[..., None], lerp(srgb((214, 204, 184)), srgb((178, 164, 140)), N.smoothstep(-0.3, 0.3, n2)[..., None]), col)
        self.lake = fresh.astype(F32)
        # oceans: deep navy, lighter over shelves, turquoise banks in warm
        # clear water, green plankton swirls and river sediment plumes
        depth = -np.minimum(elev, 0)
        fo = self.field("sea")
        Pw2 = N.tangent_warp(self.P, fo.vec(self.P, 8.0, 4), 0.06)
        swirl = fo.fbm(Pw2, 18.0, 5)
        deep = srgb((6, 17, 40)) * (1 + 0.10 * swirl[..., None])
        mid = srgb((10, 30, 58))
        shelf = srgb((16, 46, 66))
        banks = srgb((48, 132, 142))
        oc = lerp(mid, deep, N.smoothstep(0.25, 3.0, depth)[..., None])
        oc = lerp(oc, shelf, (N.smoothstep(0.3, 0.06, depth) * (0.55 + 0.45 * N.smoothstep(-0.3, 0.3, swirl)))[..., None])
        clear = N.smoothstep(19, 26, T) * N.smoothstep(0.13, 0.04, depth) * N.smoothstep(-0.2, 0.3, fo.fbm(self.P, 25.0, 4, first=7))
        oc = lerp(oc, banks * (1 + 0.2 * swirl[..., None]), clear[..., None])
        bloom = N.smoothstep(0.45, 0.75, fo.ridged(Pw2, 10.0, 4)) * gauss(dlat, 50, 10) * N.smoothstep(0.1, 0.5, fo.fbm(self.P, 2.5, 3, first=11))
        oc = lerp(oc, srgb((22, 58, 60)), bloom[..., None] * 0.35)
        mouths = np.clip(N.blur(self.bigriver, 3, 2) * 25, 0, 1)
        plume = mouths * N.smoothstep(0.5, 0.0, depth)
        oc = lerp(oc, srgb((72, 80, 56)), plume[..., None] * 0.6)
        # sea ice on the northern polar ocean, broken into floes at its edge
        seaice = N.smoothstep(75, 81, dlat + 4 * n1 + 2.5 * fo.fbm(self.P, 60.0, 3, first=4)) * (lat > 0)
        seaice = np.maximum(seaice, N.smoothstep(72, 76, dlat + 3 * n1) * (lat < 0))
        leads = N.smoothstep(0.7, 0.9, fo.ridged(self.P, 50.0, 3))
        oc = lerp(oc, srgb((212, 220, 232)) * (1 - 0.18 * leads[..., None]), seaice[..., None])
        self.seaice = (seaice * (1 - land)).astype(F32)
        col = lerp(col, oc, (1 - land)[..., None])
        col = np.where(fresh[..., None], srgb((12, 26, 40)), col)
        self.ice = np.maximum(icef * land, self.seaice).astype(F32)
        self.albedo = np.clip(col, 0, 1).astype(F32)
        self.T = T.astype(F32)
        self.Pmm = P.astype(F32)
        self.desert = desert[..., 0].astype(F32)
        self.say("surface colour")

    def _slope(self, elev):
        dy = np.zeros_like(elev)
        dy[1:-1] = (elev[2:] - elev[:-2]) / (2 * self.km_px)
        dx = (np.roll(elev, -1, 1) - np.roll(elev, 1, 1)) / (2 * self.km_px * np.maximum(np.cos(self.LAT), 0.05))
        return np.sqrt(dx * dx + dy * dy)

    # ======================================================================
    # 5. Water mask and height

    def water_and_height(self):
        c = self.c
        g = np.sqrt(np.gradient(c, axis=0) ** 2 + np.gradient(c, axis=1) ** 2) + 1e-6
        edge = np.clip(0.5 - c / g, 0, 1)
        w = np.maximum(edge, self.lake)
        w = np.maximum(w, np.clip(self.bigriver * 0.7, 0, 1))
        self.water = np.clip(w - self.seaice * 0.95, 0, 1).astype(F32)
        h = np.clip(self.elev / 6.0, 0, 1) ** 0.6
        self.height = (h * (1 - self.water)).astype(F32)
        self.say("water, height")

    # ======================================================================
    # 6. Clouds: coverage from the weather, texture by cloud type, all of it
    #    carried by one wind field

    def weather_systems(self):
        """The storms and highs that drive the wind and place the cloud."""
        rng = self.rng("weather")
        sys_ = []
        for hemi in (1, -1):
            n = 6
            lons = (np.arange(n) + rng.uniform(0.2, 0.8, n)) / n * 2 * math.pi - math.pi
            for lo in lons:
                la = hemi * math.radians(rng.uniform(42, 60))
                sys_.append(dict(lon=float(lo), lat=la, r=math.radians(rng.uniform(6.5, 10)), spin=hemi,
                                 kind='low', A=rng.uniform(0.3, 0.45), age=rng.uniform(0, 1)))
            # subtropical highs over the oceans, turning the other way
            for lo in rng.uniform(-math.pi, math.pi, 4):
                la = hemi * math.radians(rng.uniform(26, 34))
                sys_.append(dict(lon=float(lo), lat=la, r=math.radians(rng.uniform(14, 20)), spin=-hemi,
                                 kind='high', A=rng.uniform(0.08, 0.14)))
        # tropical cyclones
        for lo, la in ((-126.0, 17.0), (152.0, 19.0), (62.0, -15.0)):
            sys_.append(dict(lon=math.radians(lo), lat=math.radians(la), r=math.radians(3.0),
                             spin=1 if la > 0 else -1, kind='tropical', A=0.5))
        self.systems = sys_
        self.meta['hurricanes'] = [(-126.0, 17.0), (152.0, 19.0), (62.0, -15.0)]
        return sys_

    def _velocity_grid(self, Wv, Hv):
        """Tangent wind vectors on an equirect grid: zonal jets with Rossby
        meanders, cyclones and highs, and a few curl-noise eddies."""
        lon, lat = N.lonlat_grid(Wv, Hv)
        P = N.sphere_points(lon, lat)
        LAT = lat[:, None] + 0 * lon[None, :]
        LON = lon[None, :] + 0 * lat[:, None]
        dl = np.degrees(np.abs(LAT))
        east = np.stack([-np.sin(LON), np.cos(LON), np.zeros_like(LON)], -1).astype(F32)
        north = np.cross(P, east)
        hemi = np.sign(LAT + 1e-6)
        jet = 45 + 8 * np.sin(5 * LON + 1.3 * hemi + 0.4)
        U = -0.22 * np.exp(-(dl / 20) ** 2) + 0.45 * np.exp(-((dl - jet) / 10) ** 2) - 0.12 * np.exp(-((dl - 72) / 8) ** 2)
        Vn = 0.15 * hemi * np.cos(5 * LON + 1.3 * hemi + 0.4) * np.exp(-((dl - jet) / 12) ** 2)
        V = U[..., None] * east + Vn[..., None] * north
        for s in self.systems:
            c = unit(math.degrees(s['lon']), math.degrees(s['lat']))
            d = np.arccos(np.clip(P @ c, -1, 1))
            x = d / s['r']
            mag = s['A'] * x * np.exp(1 - x)
            tang = np.cross(c[None, None, :], P)
            tn = np.maximum(np.linalg.norm(tang, axis=-1, keepdims=True), 1e-6)
            V += (s['spin'] * mag)[..., None] * tang / tn
            if s['kind'] != 'high':
                # lows draw the air in a little: the arms trail into spirals
                radial = c[None, None, :] - P * (P @ c)[..., None]
                rn = np.maximum(np.linalg.norm(radial, axis=-1, keepdims=True), 1e-6)
                V += (0.3 * mag)[..., None] * radial / rn
        f = self.field("eddies")
        eps = 1e-3
        psi = lambda Q: f.fbm(Q, 7.0, 3)
        p0 = psi(P)
        grad = np.stack([(psi(P + np.array(e, F32)) - p0) / eps for e in ((eps, 0, 0), (0, eps, 0), (0, 0, eps))], -1)
        grad -= P * np.sum(grad * P, -1, keepdims=True)
        V += np.cross(P, grad) * F32(0.002)
        return V.astype(F32)

    def _advect(self, P, V, steps=20, T=1.0):
        """Trace every point back along the wind (RK2) for time T: where
        its air came from. Noise sampled there is carried and sheared by
        the flow into streaks and spirals."""
        Q = P.copy()
        dt = F32(T / steps)
        for _ in range(steps):
            u, v = N.dir_to_uv(Q)
            k1 = N.sample(V, u, v)
            Qm = Q - k1 * (dt * 0.5)
            Qm /= np.linalg.norm(Qm, axis=-1, keepdims=True)
            u, v = N.dir_to_uv(Qm)
            k2 = N.sample(V, u, v)
            Q = Q - k2 * dt
            Q /= np.linalg.norm(Q, axis=-1, keepdims=True)
        return Q.astype(F32)

    def _spiral(self, Q):
        """Wind the air round each low and hurricane: rotate points about the
        storm's axis by an angle that grows toward its centre."""
        for s in self.systems:
            if s['kind'] == 'high':
                continue
            ax = unit(math.degrees(s['lon']), math.degrees(s['lat']))
            d = np.arccos(np.clip(Q @ ax, -1, 1))
            reach = s['r'] * (2.4 if s['kind'] == 'low' else 3.0)
            t = np.clip(d / reach, 0, 1)
            k = 2.4 if s['kind'] == 'low' else 5.0
            hemi = 1 if s['lat'] > 0 else -1
            ang = (hemi * k * (1 - t) ** 2 / (t * 2.5 + 0.3)).astype(F32)
            ca, sa = np.cos(ang)[..., None], np.sin(ang)[..., None]
            cr = np.cross(ax[None, None, :], Q)
            dt = (Q @ ax)[..., None]
            Q = Q * ca + cr * sa + ax * dt * (1 - ca)
        return Q.astype(F32)

    def flow(self):
        self.weather_systems()
        V = self._velocity_grid(1024, 512)
        Q2 = self._advect(self.P2, V, 14, 0.45)
        Q2 = self._spiral(Q2)
        Q = self.up(Q2)
        self.Q = (Q / np.linalg.norm(Q, axis=-1, keepdims=True)).astype(F32)
        self.say("flow traced")

    @staticmethod
    def _uniform(x, n=512):
        """Rank-transform a noise field to a uniform 0..1 distribution, so a
        threshold at 1 - c covers a fraction c of it (coverage is honest)."""
        sub = np.sort(x.ravel()[::13])
        q = sub[np.linspace(0, sub.size - 1, n).astype(int)]
        return np.interp(x, q, np.linspace(0, 1, n)).astype(F32)

    def _low_frame(self, s, span_r):
        """Rows of the map near a low, and local coordinates in units of its
        radius: x east, y poleward."""
        H = self.H
        c = unit(math.degrees(s['lon']), math.degrees(s['lat']))
        e = np.cross(np.array([0, 0, 1], F32), c)
        e /= np.linalg.norm(e)
        n = np.cross(c, e)
        r = s['r']
        span = r * span_r
        y0 = max(0, int((math.pi / 2 - (s['lat'] + span)) / math.pi * H))
        y1 = min(H, int((math.pi / 2 - (s['lat'] - span)) / math.pi * H) + 1)
        P = self.P[y0:y1]
        hemi = 1 if s['lat'] > 0 else -1
        x = (P @ e) / r
        y = (P @ n) / r * hemi
        ok = (P @ c) > math.cos(span)
        return y0, y1, x, y, ok

    def _cyclone_cover(self, cover, wtype, f):
        """Mid-latitude lows: a bright frontal shield poleward and east of
        the centre, a comma head wrapping round it, a dry slot biting in
        from the south-west, and the cold front trailing away equatorward
        and west as a long curved band. Behind the front, cold air over the
        sea breaks into cellular cumulus."""
        for s in self.systems:
            if s['kind'] != 'low':
                continue
            y0, y1, x, y, ok = self._low_frame(s, 5.0)
            wob = f.fbm(self.P[y0:y1], 14.0, 4, first=20)
            rr = np.sqrt(x * x + y * y)
            th = np.arctan2(y, x)                          # 0 east, +pi/2 poleward
            shield = np.exp(-(((x - 0.9) / 1.5) ** 2 + ((y - 0.45) / 1.0) ** 2)) * 1.0
            # comma head: wraps from the east over the pole side to the west
            head_ang = N.smoothstep(-0.3, 0.2, th) * N.smoothstep(3.6, 2.6, np.where(th < -1.5, th + 2 * math.pi, th))
            head = head_ang * np.exp(-((rr - 0.75) / 0.45) ** 2)
            # dry slot: a spiral lane from the south-west into the centre
            slot_th = th + np.log(np.maximum(rr, 0.05)) * 1.3
            slot = np.exp(-((np.angle(np.exp(1j * (slot_th + 2.2)))) / 0.45) ** 2) * N.smoothstep(2.2, 0.8, rr) * N.smoothstep(0.1, 0.3, rr)
            # cold front: sample the curve and take the distance to it
            sgrid = np.linspace(0, 3.4, 40)
            bend = 0.28 * math.sin(s['age'] * 6.0)
            fx = 0.35 - 0.55 * sgrid + 0.10 * sgrid ** 2 + bend * np.sin(sgrid * 1.4)
            fy = -0.35 - 1.0 * sgrid
            d2 = np.full(x.shape, 99.0, F32)
            along = np.zeros(x.shape, F32)
            for k in range(sgrid.size):
                dd = (x - fx[k]) ** 2 + (y - fy[k]) ** 2
                m = dd < d2
                d2 = np.where(m, dd, d2)
                along = np.where(m, sgrid[k], along)
            width = 0.22 + 0.12 * wob + 0.06 * (along / 3.4)
            front = np.exp(-d2 / np.maximum(width, 0.06) ** 2) * N.smoothstep(3.4, 2.2 - 0.6 * s['age'], along)
            front *= N.smoothstep(-0.45, 0.1, f.fbm(self.P[y0:y1], 6.0, 3, first=33))
            # which side of the front: behind (west) is the cold sector
            fxa = 0.35 - 0.55 * along + 0.10 * along ** 2 + bend * np.sin(along * 1.4)
            behind = N.smoothstep(0.0, -0.4, x - fxa) * N.smoothstep(-4.0, -0.5, y) * N.smoothstep(3.5, 1.0, rr)
            warm_sector = N.smoothstep(0.0, 0.5, x - fxa) * N.smoothstep(0.2, -0.6, y) * N.smoothstep(3.5, 1.5, rr)
            strat = np.clip(np.maximum.reduce([shield, head, front]) * 1.1, 0, 1)
            c_new = np.maximum(cover[y0:y1], 0.2 + 0.78 * strat)
            c_new = c_new * (1 - 0.85 * slot)
            c_new = np.where(behind > 0.05, np.maximum(c_new * (1 - behind * 0.2), 0.45 * behind), c_new)
            c_new = c_new * (1 - 0.35 * warm_sector * (1 - front))
            c_new = np.where(ok, c_new, cover[y0:y1])
            cover[y0:y1] = c_new
            wtype['strat'][y0:y1] = np.where(ok, np.maximum(wtype['strat'][y0:y1], strat), wtype['strat'][y0:y1])
            wtype['cell'][y0:y1] = np.where(ok, np.maximum(wtype['cell'][y0:y1], behind * (1 - self.land[y0:y1])), wtype['cell'][y0:y1])

    def clouds_map(self):
        H, W = self.H, self.W
        lat = self.LAT
        dlat = np.degrees(np.abs(lat))
        slat = np.degrees(lat)
        land = self.land
        f = self.field("clouds", 10)
        Q = self.Q
        # --- how cloudy (0..1) --------------------------------------------
        itcz = 5.0 + 4.0 * np.sin(self.LON * 2 + 0.7)
        cover = (0.28 * gauss(slat, itcz, 9.0)
                 + 0.38 * gauss(dlat, 57, 12)
                 + 0.28 * N.smoothstep(62, 80, dlat)
                 + 0.30)
        cover *= 1 - 0.55 * gauss(dlat, 24, 8)
        logP = np.log10(np.maximum(self.Pmm, 10))
        cover = np.where(land > 0, cover * (0.3 + 0.8 * N.smoothstep(2.2, 3.2, logP)), cover)
        cover += 0.12 * f.fbm(self.P, 2.0, 4, first=25)
        # stratocumulus decks over the cool eastern oceans of the subtropics
        land4 = self.down4(self.land)
        east_land = self._upwind(land4, self.LAT4, [300, 900, 1600], [1, 1, 0.7], np.full_like(land4, -1.0))
        deck = self.up(east_land) * gauss(dlat, 22, 10) * (1 - land)
        deck = N.smoothstep(0.15, 0.6, deck)
        cover = np.maximum(cover, 0.2 + 0.72 * deck)
        cover += 0.2 * N.smoothstep(1.5, 3.5, self.elev) * land
        for s in self.systems:
            if s['kind'] == 'high':
                c = unit(math.degrees(s['lon']), math.degrees(s['lat']))
                d = np.arccos(np.clip(self.P @ c, -1, 1))
                cover -= 0.22 * np.exp(-(d / (s['r'] * 0.9)) ** 2)
        wtype = {k: np.zeros((H, W), F32) for k in ('strat', 'cell', 'cu', 'cb')}
        wtype['strat'] = np.maximum(wtype['strat'], deck * 0.5)
        wtype['cell'] = np.maximum(wtype['cell'], deck * 0.7)
        self._cyclone_cover(cover, wtype, f)
        # thunderstorm clusters: the ITCZ and wet tropical land
        cb = self._convection_cover(f)
        cover = np.maximum(cover, cb * 0.85)
        wtype['cb'] = cb
        # trade cumulus: scattered small cumulus over warm seas
        wtype['cu'] = gauss(slat, itcz * 0.5, 22) * (1 - land) * (1 - deck) + 0.5 * land * N.smoothstep(2.6, 3.1, logP) * N.smoothstep(12, 22, self.T)
        cover = np.clip(cover, 0, 1).astype(F32)
        self.cover = cover
        self.say("clouds: coverage")
        # --- textures, all carried by the flow ----------------------------
        Pw = N.tangent_warp(Q, f.vec(Q, 10.0, 3), 0.01)
        # low octaves ride the full trace; fine ones only part of it, so the
        # small structure is carried along without being drawn into threads
        Qh = Pw
        base = self._uniform(f.fbm(Pw, 3.5, 9, gain=0.56))
        strat_t = self._uniform(f.fbm(Pw, 4.0, 8, gain=0.5, first=3))
        cu_t = self._uniform(f.billow(Pw, 26.0, 5, first=5) * 0.6 + 0.4 * f.fbm(Pw, 12.0, 5, first=9))
        fine = f.fbm(Qh, 140.0, 3, first=14)
        # cells at ~40 km, open (rings) and closed (blobs)
        Pc = N.tangent_warp(self.P2, f.vec(self.P2, 25.0, 3), 0.006)
        F1, F2 = N.worley(Pc, 110.0, 17)
        closed = self.up(N.smoothstep(0.02, 0.35, (F2 - F1)).astype(F32))
        openc = self.up(np.exp(-((F2 - F1) / 0.12) ** 2).astype(F32))
        self.say("clouds: textures")

        def thr(t, c, soft):
            return N.smoothstep(1 - c - soft, 1 - c + soft, t)

        d_gen = thr(base + 0.05 * fine, cover, 0.06)
        d_str = thr(strat_t, np.minimum(cover * 1.08, 1), 0.10) * (0.88 + 0.12 * base)
        # cells: closed where it is cloudy, open (rings) where it is less so
        d_cell = thr(base * 0.75 + 0.25 * closed, cover, 0.07)
        d_cell = np.clip(d_cell * (0.75 + 0.35 * base), 0, 1)
        d_cu = thr(cu_t, cover * 0.8, 0.07) * 0.85
        d_cb = thr(base * 0.5 + 0.5 * cu_t, cover, 0.12)
        w = wtype
        wg = np.ones((H, W), F32) * 0.6
        tot = wg + w['strat'] + w['cell'] + w['cu'] + w['cb'] * 1.5
        dens = (wg * d_gen + w['strat'] * d_str + w['cell'] * d_cell + w['cu'] * d_cu + w['cb'] * 1.5 * d_cb) / tot
        # hurricanes on top
        for s in self.systems:
            if s['kind'] == 'tropical':
                dens = np.maximum(dens, self._hurricane(s, f))
        # a deck is never uniformly thick: opacity inside the cloud wanders
        # between ~0.7 and 1 (the renderer turns that into lumpy relief), a
        # little more in the convective and cellular regions
        thick = self._uniform(f.fbm(Pw, 22.0, 6, gain=0.6, first=44))
        lumpy = np.clip(0.3 + 0.4 * (w['cb'] + w['cell'] + w['cu']), 0.3, 0.7)
        dens = dens * (1 - lumpy * 0.45 * (1 - thick) * N.smoothstep(0.5, 0.95, dens))
        # popcorn cumulus: small scattered clouds in the clear gaps over warm
        # sea and wet land, the texture of a fair-weather day from orbit
        pop_t = f.billow(Pw, 70.0, 3, first=50) + 0.35 * f.fbm(Pw, 25.0, 3, first=53)
        fair = N.smoothstep(12, 24, self.T) * (1 - N.smoothstep(0.55, 0.9, cover)) * (0.35 + 0.65 * (1 - self.desert))
        pops = N.smoothstep(0.62, 0.78, pop_t) * fair * 0.7
        dens = 1 - (1 - dens) * (1 - pops)
        # cirrus: thin fibrous veils in the jets and blown off the storms
        cir = f.ridged(Pw * np.array([1, 1, 2.2], F32), 9.0, 5, sharp=3.0, first=30)
        cirrus = N.smoothstep(0.6, 0.92, cir) * (0.4 * gauss(dlat, 42, 10) + 0.35 * gauss(slat, itcz, 8) + 0.3 * w['cb']) \
            * N.smoothstep(-0.1, 0.35, f.fbm(self.P, 3.0, 3, first=7))
        clouds = 1 - (1 - dens) * (1 - cirrus * 0.3)
        clouds *= 1 - 0.4 * N.smoothstep(2.5, 4.0, self.elev)
        self.clouds = np.clip(clouds, 0, 1).astype(F32)
        self.say(f"clouds: mean opacity {self.clouds.mean():.2f}, cover {cover.mean():.2f}")

    def _hurricane(self, s, f):
        """An eye, an eyewall, a central dense overcast and spiral bands."""
        H, W = self.H, self.W
        out = np.zeros((H, W), F32)
        y0, y1, x, y, ok = self._low_frame(s, 3.5)
        hemi = 1 if s['lat'] > 0 else -1
        rr = np.sqrt(x * x + y * y)
        th = np.arctan2(y, x) * hemi * s['spin']
        ns = f.fbm(self.P[y0:y1], 60.0, 5, first=9)
        arms = 0.5 + 0.5 * np.cos(th * 3 - np.log(np.maximum(rr, 1e-3)) * 6.0 + ns * 1.8)
        bands = arms ** 2.5 * N.smoothstep(3.2, 0.9, rr) * N.smoothstep(0.2, 0.6, rr)
        cdo = N.smoothstep(1.1, 0.35, rr + 0.15 * ns)
        wall = np.exp(-((rr - 0.16) / 0.06) ** 2)
        eye = N.smoothstep(0.07, 0.12, rr)
        v = np.maximum.reduce([bands * 0.9, cdo, wall]) * eye * (0.85 + 0.2 * ns)
        out[y0:y1] = np.where(ok, np.clip(v, 0, 1), 0)
        return out

    def _convection_cover(self, f):
        """Thunderstorm clusters along the ITCZ and over wet tropical land,
        as coverage: bumps of 100-500 km that merge into a broken band."""
        rng = self.rng("convection")
        H, W = self.H, self.W
        n = 260
        lon = rng.uniform(-math.pi, math.pi, n)
        la = np.radians(rng.normal(6, 9, n))
        blob = np.zeros((H, W), F32)
        Pcv = N.tangent_warp(self.P, f.vec(self.P, 18.0, 3), 0.014)
        keep = []
        for lo, lt in zip(lon, la):
            u = (lo + math.pi) / (2 * math.pi)
            v = (math.pi / 2 - lt) / math.pi
            yi = min(self.H4 - 1, int(v * self.H4))
            xi = min(self.W4 - 1, int(u * self.W4))
            if self.P4mm[yi, xi] > 1300 or rng.random() < 0.3:
                keep.append((lo, lt))
                s = math.radians(rng.uniform(0.8, 2.6))
                self._bump(blob, lo, lt, s, rng.uniform(0.6, 1.1), P=Pcv)
        # the storm for the night-side secret: a strong cluster over land
        best = None
        for lo, lt in keep:
            u = (lo + math.pi) / (2 * math.pi)
            v = (math.pi / 2 - lt) / math.pi
            yi, xi = min(self.H - 1, int(v * self.H)), min(self.W - 1, int(u * self.W))
            if self.land[yi, xi] > 0 and (best is None or abs(lt) < abs(best[1])):
                best = (lo, lt)
        if best is None and keep:
            best = keep[0]
        if best:
            self._bump(blob, best[0], best[1], math.radians(2.0), 1.2)
            self.meta['storm'] = (round(math.degrees(best[0]), 2), round(math.degrees(best[1]), 2))
        return N.smoothstep(0.25, 0.9, blob + 0.25 * f.fbm(self.Q, 12.0, 4, first=2)).astype(F32)

    # ======================================================================
    # 7. Night lights

    def night_lights(self):
        H, W = self.H, self.W
        rng = self.rng("cities")
        T4, P4 = self.T4, self.P4mm
        land4 = self.down4(self.land)
        elev4 = np.maximum(self.down4(self.elev), 0)
        ice4 = self.down4(self.ice)
        river4 = np.clip(N.blur(self.down4(self.river) * 4, 1, 1), 0, 1)
        ns = self.near_sea4
        coast4 = N.smoothstep(0.03, 0.3, ns) * (0.4 + 0.6 * N.smoothstep(0.95, 0.55, ns))
        f = self.field("people")
        clim = N.smoothstep(-3, 7, T4) * N.smoothstep(33, 25, T4)
        wet = N.smoothstep(2.3, 2.8, np.log10(P4))
        water = np.clip(wet * 0.8 + river4 * 1.2 + coast4 * 0.8, 0, 1)
        flat = N.smoothstep(2.4, 0.5, elev4)
        jungle = 1 - 0.6 * N.smoothstep(3.25, 3.5, np.log10(P4)) * N.smoothstep(20, 25, T4)
        hab = clim * water * flat * jungle * (0.2 + 1.6 * coast4 + 1.4 * river4)
        hab *= (land4 > 0.5) * (1 - ice4)
        dev = 0.08 + 0.92 * N.smoothstep(-0.3, 0.4, f.fbm(self.P4, 1.5, 4)) ** 1.3
        dens = (hab * dev).astype(np.float64)
        dens /= dens.sum()
        n = int(140000)
        flat_idx = rng.choice(dens.size, size=n, p=dens.ravel())
        ys, xs = np.divmod(flat_idx, self.W4)
        lon = (xs + rng.uniform(0, 1, n)) / self.W4 * 2 * math.pi - math.pi
        lat = math.pi / 2 - (ys + rng.uniform(0, 1, n)) / self.H4 * math.pi
        # population (thousands): Zipf; big cities pulled to coasts and rivers
        pop = 5.0 * (1 - rng.random(n)) ** (-1 / 1.1)
        pull = 0.4 + 0.6 * np.clip(coast4[ys, xs] + river4[ys, xs], 0, 1)
        pop = np.minimum(pop * pull, 28000.0)
        # modern (white LED) or old (sodium) lighting, by region
        modern = np.clip(0.5 + 0.8 * f.fbm(self.P4, 2.5, 3, first=5)[ys, xs] + rng.normal(0, 0.2, n), 0, 1)
        towns = [lon, lat, pop, modern]
        # suburbs: big cities spill out in spokes along their roads
        bigi = np.nonzero(pop > 400)[0]
        sub = []
        for i in bigi:
            k = int(min(24, 4 + pop[i] / 400))
            ang = rng.uniform(0, 2 * math.pi, k)
            dist = np.abs(rng.normal(0, 1, k)) * (6 + 4 * (pop[i] / 100) ** 0.4) / R_KM
            sub.append(np.stack([lon[i] + dist * np.cos(ang) / max(math.cos(lat[i]), 0.1),
                                 lat[i] + dist * np.sin(ang),
                                 pop[i] * rng.uniform(0.02, 0.08, k),
                                 np.full(k, modern[i])], 1))
        sub = np.concatenate(sub, 0) if sub else np.zeros((0, 4))
        # roads between the larger towns: lights strung along them
        roads = self._roads(lon, lat, pop, modern, rng)
        allp = np.concatenate([np.stack(towns, 1), sub, roads], 0)
        self.meta['settlements'] = int(allp.shape[0])
        img = self._splat_lights(allp)
        # fishing fleets: specks at sea over cool shelves
        depth = -np.minimum(self.elev, 0)
        dl = np.degrees(np.abs(self.LAT))
        shelfsea = (depth > 0.05) & (depth < 0.35) & (dl > 25) & (dl < 50)
        yy, xx = np.nonzero(shelfsea[::5, ::5])
        pick = rng.random(yy.size) < 0.05
        fleet = np.zeros((H, W, 3), F32)
        fleet[yy[pick] * 5, xx[pick] * 5] = np.array([0.8, 0.85, 0.9], F32) * 0.25
        # gas flares in one dry basin: isolated orange points
        dry = (self.Pmm < 200) & (self.land > 0) & (self.T > 12)
        yy, xx = np.nonzero(dry[::11, ::11])
        flares = np.zeros((H, W, 3), F32)
        if yy.size:
            k = rng.integers(yy.size)
            cy, cx = yy[k] * 11, xx[k] * 11
            for _ in range(30):
                y = int(np.clip(cy + rng.normal(0, 12), 0, H - 1))
                x = int(cx + rng.normal(0, 16)) % W
                flares[y, x] = np.array([1.0, 0.45, 0.12], F32) * rng.uniform(0.3, 0.7)
        img = img * (1 - self.ice[..., None]) + fleet + flares
        self._hi(img)
        img = 1 - np.exp(-img * 1.6)
        self.night = np.clip(img, 0, 1).astype(F32)
        self.say(f"night lights: {self.meta['settlements']} lights")

    def _roads(self, lon, lat, pop, modern, rng):
        """Highways: each of the bigger towns joins its nearest neighbours
        (if they are within reach over land); little towns and a dim line
        of lights follow each road."""
        sel = np.nonzero(pop > 60)[0]
        C = np.stack([np.cos(lat[sel]) * np.cos(lon[sel]), np.cos(lat[sel]) * np.sin(lon[sel]), np.sin(lat[sel])], -1)
        pts = []
        maxang = 480.0 / R_KM
        # neighbours via a coarse spatial hash on the sphere
        cell = 3.0 / 180 * math.pi
        keys = {}
        la_i = np.floor((lat[sel] + math.pi / 2) / cell).astype(int)
        lo_i = np.floor((lon[sel] + math.pi) / cell).astype(int)
        for k, (a, b) in enumerate(zip(la_i, lo_i)):
            keys.setdefault((a, b), []).append(k)
        nlo = int(round(2 * math.pi / cell))
        edges = set()
        for k in range(len(sel)):
            a, b = la_i[k], lo_i[k]
            cand = []
            for da in (-2, -1, 0, 1, 2):
                for db in (-2, -1, 0, 1, 2):
                    cand.extend(keys.get((a + da, (b + db) % nlo), []))
            cand = np.array([j for j in cand if j != k])
            if cand.size == 0:
                continue
            dots = C[cand] @ C[k]
            best = cand[np.argsort(-dots)[:3]]
            for j in best:
                e = (min(k, j), max(k, j))
                edges.add(e)
        land = self.land
        for (a, b) in edges:
            A, B = C[a], C[b]
            ang = math.acos(min(1.0, max(-1.0, float(A @ B))))
            if ang > maxang or ang < 1e-4:
                continue
            mid = (A + B)
            mid /= np.linalg.norm(mid)
            u, v = N.dir_to_uv(mid[None].astype(F32))
            if land[min(self.H - 1, int(v[0] * self.H)), int(u[0] * self.W) % self.W] < 0.5:
                continue
            nstep = max(2, int(ang * R_KM / 3.0))
            t = np.linspace(0, 1, nstep)[1:-1]
            s = math.sin(ang)
            P = (np.sin((1 - t) * ang)[:, None] * A + np.sin(t * ang)[:, None] * B) / s
            P += rng.normal(0, 0.0006, P.shape)
            P /= np.linalg.norm(P, axis=1, keepdims=True)
            plon = np.arctan2(P[:, 1], P[:, 0])
            plat = np.arcsin(np.clip(P[:, 2], -1, 1))
            # the road itself: a faint glow; towns along it every ~30 km
            pp = np.full(t.size, 0.25)
            town = rng.random(t.size) < 0.1
            pp[town] = rng.uniform(4, 30, town.sum())
            md = np.full(t.size, (modern[sel[a]] + modern[sel[b]]) / 2)
            pts.append(np.stack([plon, plat, pp, md], 1))
        self.meta['roads'] = len(pts)
        return np.concatenate(pts, 0) if pts else np.zeros((0, 4))

    def _splat_lights(self, pts):
        """Draw settlements: light flux in proportion to population, spread
        over a radius that grows with it, in sodium orange or LED white.
        Points are binned by their radius in pixels and each bin is splatted
        then blurred once (fast, and equirect-aware)."""
        H, W = self.H, self.W
        lon, lat, pop, modern = pts[:, 0], pts[:, 1], pts[:, 2], pts[:, 3]
        r_km = 2.6 * (pop / 100.0) ** 0.42
        r_px = r_km / self.km_px
        sodium = np.array([1.0, 0.56, 0.20], F32)
        led = np.array([0.86, 0.88, 0.84], F32)
        col = sodium[None] * (1 - modern[:, None] * 0.75) + led[None] * modern[:, None] * 0.75
        # flux in units of one full-resolution pixel's brightness: a pixel
        # of a coarser map averages the same light over more ground
        flux = (pop / 1000.0) * 6.0 * (W / 4096.0) ** 2
        img = np.zeros((H, W, 3), F32)
        bins = [(0, 0.9, 1, 1), (0.9, 1.8, 1, 3), (1.8, 3.5, 2, 3), (3.5, 7, 4, 3), (7, 1e9, 7, 3)]
        x = (lon + math.pi) / (2 * math.pi) * W - 0.5
        y = (math.pi / 2 - lat) / math.pi * H - 0.5
        for lo_, hi_, rad, passes in bins:
            m = (r_px >= lo_) & (r_px < hi_)
            if not m.any():
                continue
            layer = np.zeros((H, W, 3), F32)
            xm, ym = x[m], y[m]
            x0 = np.floor(xm).astype(np.int64)
            y0 = np.floor(ym).astype(np.int64)
            fx, fy = xm - x0, ym - y0
            val = (flux[m][:, None] * col[m]).astype(F32)
            # the blur spreads a unit of flux over ~ (2 sigma)^2 pixels;
            # scale so a pixel-sized town keeps its brightness
            for (dx, dy, w) in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
                yy = np.clip(y0 + dy, 0, H - 1)
                xx = (x0 + dx) % W
                for ch in range(3):
                    np.add.at(layer[..., ch], (yy, xx), (val[:, ch] * w).astype(F32))
            if rad > 1 or passes > 1:
                layer = N.blur(layer, rad, passes)
            img += layer
        return img

    def _hi(self, img):
        """'HI' spelt by little towns on a plain of the largest northern
        continent (a secret); its centre is recorded for the game."""
        lon0, lat0 = -112.0, 47.0
        # find the nearest lowland spot on land to the planned centre
        h = 130.0 / R_KM
        pts = []

        def line(a, b, n):
            for i in range(n + 1):
                t = i / n
                pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        w = h * 0.55
        g = h * 0.40
        line((0, 0), (0, h), 11)
        line((w, 0), (w, h), 11)
        line((0, h / 2), (w, h / 2), 5)
        xi = w + g
        line((xi, 0), (xi, h), 11)
        cx = xi / 2
        la0 = math.radians(lat0)
        lo0 = math.radians(lon0)
        light = np.zeros_like(img)
        for (dx, dy) in pts:
            lo = lo0 + (dx - cx) / math.cos(la0)
            la = la0 + (dy - h / 2)
            self._bump(light, lo, la, 3.2 / R_KM + 0.4 * self.km_px / R_KM, np.array([1.0, 0.62, 0.3], F32) * 0.16)
        img += light
        self.meta['hi'] = (lon0, lat0)

    # ======================================================================
    # 8. Detail texture (tileable, sub-pixel structure for the renderer)

    def detail(self, size=1024):
        """R: cumulus and cellular cloud detail, G: terrain detail (eroded
        ridges and valleys), B: fibrous cloud detail (streets, cirrus).
        Tiles on the unit square. R and B have uniform histograms (see
        planetrender.sharpen_clouds)."""
        x = (np.arange(size, dtype=F32) + 0.5) / size
        X, Y = np.meshgrid(x, x)
        wx = sum(0.5 ** i * periodic_noise2(X, Y, 4 * 2 ** i, 11 + i) for i in range(4)) * 0.04
        wy = sum(0.5 ** i * periodic_noise2(X, Y, 4 * 2 ** i, 23 + i) for i in range(4)) * 0.04
        Xw, Yw = (X + wx) % 1.0, (Y + wy) % 1.0

        def fbm(freq, octs, seed, gain=0.5, fy=None, absval=False):
            out = np.zeros_like(X)
            a, t = 1.0, 0.0
            for i in range(octs):
                nz = periodic_noise2(Xw, Yw, freq * 2 ** i, seed + i, None if fy is None else fy * 2 ** i)
                out += a * (np.abs(nz) if absval else nz)
                t += a
                a *= gain
            return out / t

        # clouds: cauliflower lumps (billows) over a softer fBm, then
        # rank-transformed to a uniform histogram, so a renderer that keeps
        # detail > 1 - coverage gets exactly that coverage in crisp cloudlets
        billow = fbm(8, 6, 101, 0.55, absval=True)
        cloud = self._uniform(0.55 * fbm(6, 7, 41) + 0.8 * billow)
        terrain = np.clip(0.5 + 0.65 * fbm(5, 8, 61, 0.55), 0, 1)
        fib = self._uniform(fbm(3, 6, 131, 0.55, fy=12))
        self.detail_rgb = np.stack([cloud, terrain, fib], -1).astype(F32)
        self.say("detail texture")

    # ======================================================================
    def generate(self):
        self.tectonics()
        self.continents()
        self.relief()
        self.islands()
        self.climate()
        self.hydrology()
        self.rivers()
        self.surface()
        self.water_and_height()
        self.flow()
        self.clouds_map()
        self.night_lights()
        self.detail(1024 if self.W >= 2048 else 512)
        return self


def periodic_noise2(X, Y, fx, seed, fy=None):
    """2D gradient noise that tiles on the unit square: `fx` lattice cells
    across, `fy` down (default fx). fy > fx stretches features along x."""
    fx = int(fx)
    fy = int(fy if fy is not None else fx)
    rng = np.random.default_rng(seed)
    ang = rng.uniform(0, 2 * math.pi, (fy, fx)).astype(F32)
    gx, gy = np.cos(ang), np.sin(ang)
    x = X * fx
    y = Y * fy
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    tx = (x - x0).astype(F32)
    ty = (y - y0).astype(F32)
    x0 %= fx
    y0 %= fy
    x1 = (x0 + 1) % fx
    y1 = (y0 + 1) % fy

    def d(ix, iy, dx, dy):
        return gx[iy, ix] * dx + gy[iy, ix] * dy
    u = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
    v = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
    a = d(x0, y0, tx, ty)
    b = d(x1, y0, tx - 1, ty)
    c = d(x0, y1, tx, ty - 1)
    e = d(x1, y1, tx - 1, ty - 1)
    top = a + u * (b - a)
    bot = c + u * (e - c)
    return (top + v * (bot - top)) * F32(1.4)
