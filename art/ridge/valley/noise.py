"""Seeded noise in numpy for the terrain (no Blender needed).

Gradient (Perlin) noise, fBm, ridged multifractal, domain warp, and the
small image tools the terrain needs without scipy: separable blur,
bilinear/bicubic sampling of grids.

Every function is vectorised over arrays of points, so a 4-million-cell grid
costs a fraction of a second per octave.
"""

import numpy as np


class Perlin:
    """2D gradient noise with a seeded permutation (range about [-0.7, 0.7])."""

    def __init__(self, seed):
        r = np.random.default_rng(seed)
        p = r.permutation(256)
        self.p = np.concatenate([p, p]).astype(np.int32)
        a = r.uniform(0, 2 * np.pi, 256)
        self.g = np.stack([np.cos(a), np.sin(a)], 1)

    def __call__(self, x, y):
        x = np.asarray(x, np.float64)
        y = np.asarray(y, np.float64)
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        xf = x - xi
        yf = y - yi
        xi &= 255
        yi &= 255
        p = self.p
        g = self.g

        def grad(ix, iy, dx, dy):
            h = p[p[ix] + iy]
            return g[h, 0] * dx + g[h, 1] * dy
        n00 = grad(xi, yi, xf, yf)
        n10 = grad(xi + 1, yi, xf - 1, yf)
        n01 = grad(xi, yi + 1, xf, yf - 1)
        n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return a + v * (b - a)


_cache = {}


def perlin(seed):
    if seed not in _cache:
        _cache[seed] = Perlin(seed)
    return _cache[seed]


def fbm(x, y, seed, octaves=6, lac=2.0, gain=0.5, scale=1.0):
    """Fractal sum, normalised to about [-1, 1]."""
    tot = np.zeros(np.broadcast(x, y).shape)
    amp, norm, f = 1.0, 0.0, scale
    for o in range(octaves):
        tot += amp * perlin(seed + o * 101)(x * f + o * 17.31, y * f - o * 9.73)
        norm += amp
        amp *= gain
        f *= lac
    return tot / norm * 1.6


def ridged(x, y, seed, octaves=6, lac=2.0, gain=0.5, scale=1.0, sharp=2.0):
    """Ridged multifractal: sharp crests where the noise crosses zero, each
    octave weighted by the one before (detail gathers on the ridges, the
    valleys stay smooth - the look of eroded rock)."""
    tot = np.zeros(np.broadcast(x, y).shape)
    amp, f, w, norm = 1.0, scale, np.ones_like(tot), 0.0
    for o in range(octaves):
        n = 1.0 - np.abs(perlin(seed + o * 131)(x * f + o * 5.1, y * f + o * 3.7) * 1.4)
        n = np.clip(n, 0, 1) ** sharp
        tot += n * amp * w
        w = np.clip(n * 1.6, 0, 1)
        norm += amp
        amp *= gain
        f *= lac
    return tot / norm


def warp(x, y, seed, amount, scale):
    """Domain warp: bend the coordinates by low-frequency noise."""
    dx = fbm(x, y, seed, 4, scale=scale) * amount
    dy = fbm(x, y, seed + 7, 4, scale=scale) * amount
    return x + dx, y + dy


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(a, sigma):
    """Separable gaussian blur (sigma in cells), edges clamped."""
    if sigma <= 0:
        return a
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode='edge')
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None), slice(None)]
            sl[axis] = slice(i, i + out.shape[axis])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def box_blur(a, r):
    """Fast box blur of radius r cells (two passes of cumulative sums)."""
    out = a.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        p = np.pad(out, pad, mode='edge')
        c = np.cumsum(p, axis=axis)
        sl_hi = [slice(None), slice(None)]
        sl_lo = [slice(None), slice(None)]
        n = out.shape[axis]
        sl_hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
        sl_lo[axis] = slice(0, n)
        out = (c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)
    return out


class Grid:
    """A regular world grid: values[j, i] at x = x0 + i*dx, y = y0 + j*dx."""

    def __init__(self, x0, y0, dx, nx, ny, values=None):
        self.x0, self.y0, self.dx, self.nx, self.ny = x0, y0, dx, nx, ny
        self.v = np.zeros((ny, nx)) if values is None else values

    @property
    def x1(self):
        return self.x0 + (self.nx - 1) * self.dx

    @property
    def y1(self):
        return self.y0 + (self.ny - 1) * self.dx

    def coords(self):
        xs = self.x0 + np.arange(self.nx) * self.dx
        ys = self.y0 + np.arange(self.ny) * self.dx
        return np.meshgrid(xs, ys)

    def inside(self, x, y, margin=0.0):
        return ((x >= self.x0 + margin) & (x <= self.x1 - margin) &
                (y >= self.y0 + margin) & (y <= self.y1 - margin))

    def sample(self, x, y, v=None, cubic=False):
        """Bilinear (or Catmull-Rom bicubic) sample at world points, clamped."""
        v = self.v if v is None else v
        fx = np.clip((np.asarray(x) - self.x0) / self.dx, 0, self.nx - 1.000001)
        fy = np.clip((np.asarray(y) - self.y0) / self.dx, 0, self.ny - 1.000001)
        ix = np.floor(fx).astype(np.int64)
        iy = np.floor(fy).astype(np.int64)
        tx = fx - ix
        ty = fy - iy
        if not cubic:
            v00 = v[iy, ix]
            v10 = v[iy, np.minimum(ix + 1, self.nx - 1)]
            v01 = v[np.minimum(iy + 1, self.ny - 1), ix]
            v11 = v[np.minimum(iy + 1, self.ny - 1), np.minimum(ix + 1, self.nx - 1)]
            a = v00 + (v10 - v00) * tx
            b = v01 + (v11 - v01) * tx
            return a + (b - a) * ty

        def w(t):
            t2, t3 = t * t, t * t * t
            return (-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2)
        wx = w(tx)
        wy = w(ty)
        out = np.zeros(np.shape(tx))
        for j in range(4):
            yy = np.clip(iy + j - 1, 0, self.ny - 1)
            row = np.zeros(np.shape(tx))
            for i in range(4):
                xx = np.clip(ix + i - 1, 0, self.nx - 1)
                row += wx[i] * v[yy, xx]
            out += wy[j] * row
        return out

    def gradient(self):
        gy, gx = np.gradient(self.v, self.dx)
        return gx, gy
