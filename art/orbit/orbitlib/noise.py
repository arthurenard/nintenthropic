"""Numpy noise on the sphere: gradient noise, fBm, ridged and billow
variants, domain warping, cellular (Worley) noise and equirect helpers.

Why numpy and not Blender's shader noise: the planet is a *map*, not a
shader. It needs global reasoning a node tree cannot do (distance to the
coast, what lies upwind, where rivers flow, which cities are neighbours),
and every field must be sampled on the unit sphere in 3D so nothing seams
at the date line or pinches at the poles.

Everything is float32 and seeded: the same seed gives the same planet, bit
for bit, on any machine.
"""

import math

import numpy as np

F32 = np.float32


def rotation(rng):
    """A random 3x3 rotation (per octave, so lattice axes never line up)."""
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ], dtype=F32)


class Noise3:
    """Improved-Perlin gradient noise in 3D, range about [-1, 1].

    A 4096-entry permutation keeps the lattice from repeating inside the
    frequencies a 4096-pixel planet uses (a 256 table would tile the high
    octaves visibly)."""

    SIZE = 4096

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(self.SIZE).astype(np.int32)
        self.perm = np.concatenate([p, p]).astype(np.int32)
        g = rng.normal(size=(self.SIZE, 3))
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        self.gx, self.gy, self.gz = (g[:, i].astype(F32) for i in range(3))
        self.rng = rng

    def __call__(self, x, y, z):
        M = self.SIZE - 1
        fx0 = np.floor(x)
        fy0 = np.floor(y)
        fz0 = np.floor(z)
        tx = (x - fx0).astype(F32)
        ty = (y - fy0).astype(F32)
        tz = (z - fz0).astype(F32)
        ix = fx0.astype(np.int64) & M
        iy = fy0.astype(np.int64) & M
        iz = fz0.astype(np.int64) & M
        P = self.perm
        a = P[ix]
        b = P[ix + 1]
        aa = P[a + iy]
        ab = P[a + iy + 1]
        ba = P[b + iy]
        bb = P[b + iy + 1]
        u = tx * tx * tx * (tx * (tx * 6 - 15) + 10)
        v = ty * ty * ty * (ty * (ty * 6 - 15) + 10)
        w = tz * tz * tz * (tz * (tz * 6 - 15) + 10)
        gx, gy, gz = self.gx, self.gy, self.gz

        def gd(h, dx, dy, dz):
            return gx[h] * dx + gy[h] * dy + gz[h] * dz

        tx1 = tx - 1
        ty1 = ty - 1
        tz1 = tz - 1
        n000 = gd(P[aa + iz], tx, ty, tz)
        n100 = gd(P[ba + iz], tx1, ty, tz)
        n010 = gd(P[ab + iz], tx, ty1, tz)
        n110 = gd(P[bb + iz], tx1, ty1, tz)
        n001 = gd(P[aa + iz + 1], tx, ty, tz1)
        n101 = gd(P[ba + iz + 1], tx1, ty, tz1)
        n011 = gd(P[ab + iz + 1], tx, ty1, tz1)
        n111 = gd(P[bb + iz + 1], tx1, ty1, tz1)
        x00 = n000 + u * (n100 - n000)
        x10 = n010 + u * (n110 - n010)
        x01 = n001 + u * (n101 - n001)
        x11 = n011 + u * (n111 - n011)
        y0 = x00 + v * (x10 - x00)
        y1 = x01 + v * (x11 - x01)
        return (y0 + w * (y1 - y0)) * F32(1.8)


class Field:
    """Octave noise with its own rotations and offsets per octave."""

    def __init__(self, seed, octaves=8):
        self.n = Noise3(seed)
        rng = np.random.default_rng(seed + 7919)
        self.rot = [rotation(rng) for _ in range(max(128, octaves + 16))]
        self.off = [rng.uniform(-500, 500, 3).astype(F32) for _ in range(max(128, octaves + 16))]

    def _oct(self, P, i, freq):
        R, o = self.rot[i], self.off[i]
        x = (P[..., 0] * R[0, 0] + P[..., 1] * R[0, 1] + P[..., 2] * R[0, 2]) * freq + o[0]
        y = (P[..., 0] * R[1, 0] + P[..., 1] * R[1, 1] + P[..., 2] * R[1, 2]) * freq + o[1]
        z = (P[..., 0] * R[2, 0] + P[..., 1] * R[2, 1] + P[..., 2] * R[2, 2]) * freq + o[2]
        return self.n(x, y, z)

    def fbm(self, P, freq, octaves=6, lac=2.0, gain=0.5, first=0):
        """Sum of octaves, normalised so the result stays in about [-1, 1]."""
        out = np.zeros(P.shape[:-1], F32)
        amp, tot, f = 1.0, 0.0, freq
        for i in range(first, first + octaves):
            out += F32(amp) * self._oct(P, i, f)
            tot += amp
            amp *= gain
            f *= lac
        return out / F32(tot)

    def ridged(self, P, freq, octaves=6, lac=2.0, gain=0.5, sharp=2.0, first=0):
        """Ridged multifractal: sharp crests (mountain chains, cloud rolls)."""
        out = np.zeros(P.shape[:-1], F32)
        amp, tot, f = 1.0, 0.0, freq
        weight = np.ones(P.shape[:-1], F32)
        for i in range(first, first + octaves):
            s = np.clip(F32(1.0) - np.abs(self._oct(P, i, f)), 0, 1)
            s = s ** F32(sharp)
            s *= weight
            weight = np.clip(s * 1.6, 0, 1)
            out += F32(amp) * s
            tot += amp
            amp *= gain
            f *= lac
        return out / F32(tot)

    def billow(self, P, freq, octaves=6, lac=2.0, gain=0.5, first=0):
        """|noise| octaves: puffy, cauliflower shapes (cumulus tops)."""
        out = np.zeros(P.shape[:-1], F32)
        amp, tot, f = 1.0, 0.0, freq
        for i in range(first, first + octaves):
            out += F32(amp) * np.abs(self._oct(P, i, f))
            tot += amp
            amp *= gain
            f *= lac
        return out / F32(tot)

    def vec(self, P, freq, octaves=4, lac=2.0, gain=0.5):
        """A 3D vector field (three decorrelated fBms) for domain warping."""
        a = self.fbm(P, freq, octaves, lac, gain, first=0)
        b = self.fbm(P + F32(31.7), freq, octaves, lac, gain, first=1)
        c = self.fbm(P - F32(47.3), freq, octaves, lac, gain, first=2)
        return np.stack([a, b, c], -1)


def tangent_warp(P, V, amount):
    """Displace sphere points by a vector field projected onto the tangent
    plane, then renormalise: warping that slides along the surface instead
    of pushing points in or out."""
    d = V - P * np.sum(V * P, -1, keepdims=True)
    Q = P + d * F32(amount)
    return Q / np.linalg.norm(Q, axis=-1, keepdims=True)


# ---------------------------------------------------------------------------
# Cellular noise

def _hash3(ix, iy, iz, seed):
    h = (ix * np.int64(73856093)) ^ (iy * np.int64(19349663)) ^ (iz * np.int64(83492791)) ^ np.int64(seed * 2654435761 & 0xffffffff)
    h = h & np.int64(0xffffffff)
    h = ((h >> 16) ^ h) * np.int64(0x45d9f3b) & np.int64(0xffffffff)
    h = ((h >> 16) ^ h) * np.int64(0x45d9f3b) & np.int64(0xffffffff)
    h = (h >> 16) ^ h
    return h


def worley(P, freq, seed, jitter=0.9):
    """F1 and F2 cellular distances in 3D (27-cell search). Returns (F1, F2)
    in cell units. Heavy: use it on coarse grids."""
    X = P * F32(freq)
    c = np.floor(X).astype(np.int64)
    f = (X - c).astype(F32)
    F1 = np.full(P.shape[:-1], 9.0, F32)
    F2 = np.full(P.shape[:-1], 9.0, F32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                h = _hash3(c[..., 0] + dx, c[..., 1] + dy, c[..., 2] + dz, seed)
                ox = ((h & 1023) / 1023.0 - 0.5) * jitter + 0.5
                oy = (((h >> 10) & 1023) / 1023.0 - 0.5) * jitter + 0.5
                oz = (((h >> 20) & 1023) / 1023.0 - 0.5) * jitter + 0.5
                ddx = dx + ox.astype(F32) - f[..., 0]
                ddy = dy + oy.astype(F32) - f[..., 1]
                ddz = dz + oz.astype(F32) - f[..., 2]
                d = np.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
                F2 = np.where(d < F1, F1, np.minimum(F2, d))
                F1 = np.minimum(F1, d)
    return F1, F2


# ---------------------------------------------------------------------------
# Equirect grids and sampling

def lonlat_grid(W, H):
    """Pixel-centre longitudes (-pi..pi, left to right) and latitudes
    (+pi/2 at the top row .. -pi/2 at the bottom)."""
    lon = (np.arange(W, dtype=F32) + 0.5) / W * F32(2 * math.pi) - F32(math.pi)
    lat = F32(math.pi / 2) - (np.arange(H, dtype=F32) + 0.5) / H * F32(math.pi)
    return lon, lat


def sphere_points(lon, lat):
    """Unit vectors for lon (W,) x lat (H,) -> (H, W, 3). Axes: +Z north,
    lon 0 on +X, lon +90 on +Y."""
    cl = np.cos(lat)[:, None]
    P = np.empty((lat.size, lon.size, 3), F32)
    P[..., 0] = cl * np.cos(lon)[None, :]
    P[..., 1] = cl * np.sin(lon)[None, :]
    P[..., 2] = np.sin(lat)[:, None]
    return P


def dir_to_uv(D):
    """Unit vectors -> equirect (u, v) in [0,1], v=0 at the north pole."""
    lon = np.arctan2(D[..., 1], D[..., 0])
    lat = np.arcsin(np.clip(D[..., 2], -1, 1))
    return (lon / (2 * math.pi) + 0.5).astype(F32), (0.5 - lat / math.pi).astype(F32)


def sample(img, u, v):
    """Bilinear lookup of an equirect image (H, W[, C]) at (u, v), wrapping
    in longitude and clamping at the poles."""
    H, W = img.shape[:2]
    x = u * W - 0.5
    y = v * H - 0.5
    x0 = np.floor(x)
    y0 = np.floor(y)
    fx = (x - x0).astype(F32)
    fy = (y - y0).astype(F32)
    x0 = x0.astype(np.int64) % W
    x1 = (x0 + 1) % W
    y0i = np.clip(y0.astype(np.int64), 0, H - 1)
    y1i = np.clip(y0.astype(np.int64) + 1, 0, H - 1)
    if img.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = img[y0i, x0]
    b = img[y0i, x1]
    c = img[y1i, x0]
    d = img[y1i, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def resize(img, W, H):
    """Resample an equirect image to W x H (bilinear, pixel-centre exact)."""
    lon, lat = lonlat_grid(W, H)
    u = (lon / (2 * math.pi) + 0.5).astype(F32)
    v = (0.5 - lat / math.pi).astype(F32)
    uu, vv = np.meshgrid(u, v)
    return sample(img, uu, vv).astype(F32)


def blur(img, radius_px, passes=3):
    """Box-blur passes (≈ Gaussian) on an equirect image: wraps in
    longitude; the horizontal radius widens toward the poles so the blur
    is roughly isotropic on the sphere."""
    H, W = img.shape[:2]
    out = img.astype(F32).copy()
    r = max(1, int(round(radius_px)))
    lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
    for _ in range(passes):
        # vertical (clamped)
        cs = np.cumsum(np.pad(out, [(r + 1, r)] + [(0, 0)] * (out.ndim - 1), mode='edge'), axis=0)
        out = (cs[2 * r + 1:] - cs[:-2 * r - 1]) / (2 * r + 1)
        # horizontal: per-row radius r / cos(lat), capped at a quarter turn
        res = np.empty_like(out)
        rows_by_r = {}
        for y in range(H):
            rr = int(min(W // 4, round(r / max(math.cos(lat[y]), 1e-3))))
            rows_by_r.setdefault(rr, []).append(y)
        for rr, ys in rows_by_r.items():
            blk = out[ys]
            padded = np.concatenate([blk[:, -rr - 1:], blk, blk[:, :rr]], axis=1)
            cs = np.cumsum(padded, axis=1)
            res[ys] = (cs[:, 2 * rr + 1:] - cs[:, :-2 * rr - 1]) / (2 * rr + 1)
        out = res
    return out.astype(F32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
