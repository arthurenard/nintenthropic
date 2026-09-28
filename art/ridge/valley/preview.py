"""Quick looks at the heightfield without Blender (development aid).

    python3 -m valley.preview [--quick] [--cache]      (from art/ridge/)

Writes into art/ridge/build/scratch/: a shaded-relief map with the layout
drawn on it, and a ray-marched view from the player's eye (Lambert sun +
sky, colour by slope and altitude, aerial haze). Cycles renders are the
real review; this is for shaping the land in seconds.
"""

import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from valley import layout as L  # noqa: E402
from valley import terrain as T  # noqa: E402

OUT = os.path.join(os.path.dirname(HERE), "build", "scratch")


def save_png(arr, path):
    from PIL import Image
    a = np.clip(arr, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path)
    print("wrote", path)


def relief_map(ter, path, x0=-3000, x1=3000, y0=-1500, y1=4500, px=1400):
    h = int(px * (y1 - y0) / (x1 - x0))
    xs = np.linspace(x0, x1, px)
    ys = np.linspace(y1, y0, h)
    X, Y = np.meshgrid(xs, ys)
    Z = ter.height(X, Y, cubic=False)
    d = (x1 - x0) / px
    gy, gx = np.gradient(Z, -d, d)
    n = np.stack([-gx, -gy, np.ones_like(Z)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    sun = np.array([-0.5, 0.6, 0.62])
    sun /= np.linalg.norm(sun)
    shade = np.clip(n @ sun, 0, 1) * 0.8 + 0.2
    t = np.clip((Z + 70) / 1200, 0, 1)[..., None]
    col = (1 - t) * np.array([0.45, 0.55, 0.35]) + t * np.array([0.85, 0.82, 0.78])
    img = col * shade[..., None]
    # contours every 50 m
    c = (np.abs(((Z + 1000) % 50) - 25) > 24.0)
    img[c] *= 0.7

    def draw(xy, color, r=1):
        i = ((xy[:, 0] - x0) / (x1 - x0) * px).astype(int)
        j = ((y1 - xy[:, 1]) / (y1 - y0) * h).astype(int)
        ok = (i >= r) & (i < px - r) & (j >= r) & (j < h - r)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                img[j[ok] + dj, i[ok] + di] = color
    draw(L.river().xy, (0.2, 0.4, 0.9))
    draw(L.road().xy, (0.9, 0.2, 0.1))
    draw(L.switchbacks().xy, (0.9, 0.5, 0.1), 0)
    draw(L.farm_lane().xy, (0.9, 0.6, 0.1), 0)
    draw(L.reservoir().xy, (0.2, 0.6, 0.9))
    # the view's wedge
    for b in (-40, 40):
        pts = np.array([L.polar(b, r)[:2] for r in np.linspace(0, 4000, 400)])
        draw(pts, (1, 1, 1), 0)
    draw(np.array([[0.0, 0.0]]), (1, 0, 0), 3)
    save_png(img, path)


def view(ter, path, W=960, H=540, vfov=L.VFOV_DEG, pitch=L.PITCH_DEG, yaw=0.0, eye=(0.0, 0.0, 0.0),
         tmax=9000.0):
    t0 = time.time()
    aspect = W / H
    ty = math.tan(math.radians(vfov / 2))
    tx = ty * aspect
    jj, ii = np.meshgrid(np.arange(H), np.arange(W), indexing='ij')
    sx = ((ii + 0.5) / W * 2 - 1) * tx
    sy = (1 - (jj + 0.5) / H * 2) * ty
    p = math.radians(pitch)
    yw = math.radians(yaw)
    fwd = np.array([math.sin(yw) * math.cos(p), math.cos(yw) * math.cos(p), math.sin(p)])
    right = np.array([math.cos(yw), -math.sin(yw), 0.0])
    up = np.cross(right, fwd)
    D = fwd[None, None] + sx[..., None] * right + sy[..., None] * up
    D /= np.linalg.norm(D, axis=-1, keepdims=True)
    D = D.reshape(-1, 3)
    E = np.array(eye)
    n = len(D)
    t = np.full(n, 0.6)
    hit = np.full(n, np.nan)
    active = np.arange(n)
    prev = t.copy()
    while len(active):
        ta = t[active]
        P = E + D[active] * ta[:, None]
        zt = ter.height(P[:, 0], P[:, 1], cubic=False)
        below = P[:, 2] < zt
        if below.any():
            idx = active[below]
            lo, hi = prev[idx], t[idx]
            for _ in range(8):
                mid = (lo + hi) / 2
                Q = E + D[idx] * mid[:, None]
                b = Q[:, 2] < ter.height(Q[:, 0], Q[:, 1], cubic=False)
                hi = np.where(b, mid, hi)
                lo = np.where(b, lo, mid)
            hit[idx] = hi
        prev[active] = t[active]
        t[active] = ta * 1.004 + 0.25
        keep = (~below) & (t[active] < tmax)
        active = active[keep]
    print(f"  marched in {time.time() - t0:.1f}s")
    ok = np.isfinite(hit)
    P = E + D * np.where(ok, hit, 0)[:, None]
    e = 0.5 + np.where(ok, hit, 0) * 0.002
    zx = (ter.height(P[:, 0] + e, P[:, 1]) - ter.height(P[:, 0] - e, P[:, 1])) / (2 * e)
    zy = (ter.height(P[:, 0], P[:, 1] + e) - ter.height(P[:, 0], P[:, 1] - e)) / (2 * e)
    nrm = np.stack([-zx, -zy, np.ones(n)], 1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    sun = L.sun_vector(12.0)
    lam = np.clip(nrm @ sun, 0, 1)
    slope = np.degrees(np.arccos(np.clip(nrm[:, 2], -1, 1)))
    alt = P[:, 2]
    grass = np.array([0.30, 0.38, 0.16])
    forest = np.array([0.10, 0.16, 0.08])
    rock = np.array([0.42, 0.40, 0.37])
    snow = np.array([0.85, 0.87, 0.9])
    c = np.where((alt < 380)[:, None] & (slope > 12)[:, None] & (alt > -50)[:, None], forest, grass)
    c = np.where((slope > 38)[:, None], rock, c)
    c = np.where(((alt > 620) & (slope < 42) | (alt > 850))[:, None], snow, c)
    col = c * (lam[:, None] * np.array([1.6, 1.25, 0.95]) + (0.35 + 0.25 * nrm[:, 2:3]) * np.array([0.30, 0.42, 0.62]))
    sky = np.array([0.55, 0.68, 0.85])
    haze = 1 - np.exp(-np.where(ok, hit, 1e9) / 7000.0)
    col = col * (1 - haze[:, None]) + sky * haze[:, None]
    zen = np.clip(D[:, 2], 0, 1)[:, None]
    skyc = sky * (1 - zen) + np.array([0.25, 0.42, 0.75]) * zen
    col = np.where(ok[:, None], col, skyc)
    img = col.reshape(H, W, 3) ** (1 / 2.2)
    save_png(img, path)


def main():
    quick = "--quick" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    cache = os.path.join(OUT, "terrain_quick.npz" if quick else "terrain.npz")
    if "--cache" in sys.argv and os.path.exists(cache):
        ter = T.Terrain.load(cache)
    else:
        ter = T.build(quick=quick)
        ter.save(cache)
    relief_map(ter, os.path.join(OUT, "relief.png"))
    view(ter, os.path.join(OUT, "view.png"))


if __name__ == "__main__":
    main()
