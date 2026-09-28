"""The terrain's maps, in the log-polar layout of UV1 (see mesh.py):

    color.png    macro albedo (sRGB): what the ground looks like from afar -
                 the materials' mean colours with all their large-scale
                 variety (mown fields, autumn turf, strata, lichen streaks,
                 wet hollows, snow). The shader multiplies it by the tiles'
                 detail up close.
    normal.png   world-space normal in glTF axes, (n * 0.5 + 0.5): the
                 ground's relief below the mesh's resolution.
    splat0.png   RGBA weights: grass, rock, scree, snow
    splat1.png   RGBA weights: dirt, forest floor, gravel, alpine turf
(the light map - AO, sun horizon, canopy shadow - is the bake stage's, on
the same layout.)

Each texel's world point is found by walking the texel centre's bearing
and range onto the heightfield.
"""

import math
import os
import time

import numpy as np

from . import layout as L
from . import mesh as M
from . import noise as N
from . import landcover as LC
from .noise import smoothstep

SIZE = (2048, 4096)          # (width: bearing, height: log range)
QUICK_SIZE = (1024, 2048)


def log(*a):
    print("[maps]", *a, flush=True)


def texel_points(W, H):
    """World (x, y) of every texel centre, rows bottom-up (v = 0 near the eye),
    matching Blender's UV convention."""
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    th = M.THETA0 + u * (M.THETA1 - M.THETA0)
    r = M.MAP_R0 * np.exp(v * math.log(M.MAP_R1 / M.MAP_R0))
    TH, R = np.meshgrid(th, r)
    return R * np.sin(TH), R * np.cos(TH), R


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def compose_color(W, info, x, y):
    """Macro albedo (linear) from the material weights and the fields."""
    n = W.shape[1]
    n1, n2, n3 = info['n1'], info['n2'], info['n3']
    alt, slope, flow, curv = info['alt'], info['slope'], info['flow'], info['curv']
    z = info['z']
    r = np.hypot(x, y)
    fine = N.fbm(x, y, 8801, octaves=3, scale=1 / 14.0)
    col = {}
    # grass: yellow-green to blue-green; lusher in hollows, paler on knolls;
    # the valley floor in mown strips (hay meadows), darker round the river
    g = np.array(LC.MEAN['grass'])[:, None] * np.ones(n)
    tint = 0.5 + 0.5 * n1
    g = g * (1 + 0.20 * n2) * (1 + np.array([0.18, 0.05, -0.25])[:, None] * (tint - 0.5) * 2)
    g = g * (1 + 0.25 * np.clip(info['fcurv'], -1, 1)) * (1 - 0.10 * smoothstep(0.0, 1.0, -curv))
    floor = smoothstep(14.0, 4.0, alt) * smoothstep(10.0, 4.0, slope)
    ang = math.radians(28.0)
    stripe = np.sin((x * math.cos(ang) + y * math.sin(ang)) * 2 * math.pi / 9.0 + 3 * n2)
    fields = smoothstep(-0.2, 0.3, N.fbm(x, y, 8802, octaves=2, scale=1 / 160.0))
    g = g * (1 + floor * fields * 0.045 * np.sign(stripe) * smoothstep(0.2, 0.6, np.abs(stripe)))
    hay = floor * (1 - fields) * smoothstep(0.1, 0.5, n2)          # some fields already cut: paler, straw-tinted
    g = g * (1 - 0.3 * hay) + np.array([0.20, 0.18, 0.09])[:, None] * 0.3 * hay
    # the mottle a pasture shows from a few hundred metres: lusher and drier
    # patches, rushes in the wet hollows, trodden ground round the gates
    mot = N.fbm(x, y, 8806, octaves=4, scale=1 / 9.0)
    g = g * (1 + 0.16 * mot[None]) * (1 + np.array([0.06, 0.0, -0.10])[:, None] * N.fbm(x, y, 8807, octaves=3, scale=1 / 23.0))
    wet = smoothstep(0.2, 0.9, info['fcurv']) * smoothstep(0.1, 0.5, N.fbm(x, y, 8808, octaves=3, scale=1 / 6.0))
    g = g * (1 - 0.35 * wet) + np.array([0.035, 0.05, 0.025])[:, None] * 0.35 * wet
    # shrubs on the pastures' slopes: alpenrose and juniper in dark clumps,
    # bilberry going red - the texture a hillside of grass shows at a distance
    clump = smoothstep(-0.2, 0.35, N.fbm(x, y, 8810, octaves=2, scale=1 / 70.0))
    shrub = (smoothstep(0.02, 0.32, N.fbm(x, y, 8811, octaves=4, scale=1 / 6.0)) * clump *
             smoothstep(3.0, 9.0, slope) * smoothstep(10.0, 22.0, alt) * smoothstep(40.0, 70.0, r))
    berry = smoothstep(0.1, 0.5, N.fbm(x, y, 8812, octaves=2, scale=1 / 20.0))
    sh = np.array([0.020, 0.030, 0.013])[:, None] * (1 - berry) + np.array([0.060, 0.024, 0.012])[:, None] * berry
    g = g * (1 - 0.85 * shrub) + sh * 0.85 * shrub
    col['grass'] = g
    # rock: grey limestone with warm and cool bands (strata dip gently),
    # dark water and lichen streaks down the faces, pale fresh scars
    band = np.sin((z + 0.08 * x - 0.05 * y) * 2 * math.pi / 23.0 + 2.5 * n1)
    rk = np.array(LC.MEAN['rock'])[:, None] * (1 + 0.22 * band + 0.22 * n2 + 0.12 * fine)
    rk = rk * (1 + np.array([0.06, 0.0, -0.08])[:, None] * n3)
    streak = smoothstep(0.3, 0.8, N.fbm(x * 0.35, y * 0.35 + z * 1.5, 8803, octaves=4, scale=1 / 18.0))
    rk = rk * (1 - 0.6 * streak * smoothstep(28.0, 48.0, slope))
    scar = smoothstep(0.6, 0.8, N.fbm(x, y, 8804, octaves=3, scale=1 / 40.0)) * smoothstep(40.0, 55.0, slope)
    rk = rk * (1 - 0.3 * scar) + np.array([0.36, 0.34, 0.31])[:, None] * 0.3 * scar
    # turf and moss on the treads of the bedding (where the rock flattens)
    ledge = smoothstep(0.35, 0.8, N.fbm(x, y, 8809, octaves=3, scale=1 / 12.0)) * smoothstep(48.0, 30.0, slope)
    rk = rk * (1 - 0.5 * ledge) + np.array([0.10, 0.09, 0.045])[:, None] * 0.5 * ledge
    col['rock'] = rk
    col['scree'] = np.array(LC.MEAN['scree'])[:, None] * (1 + 0.12 * n2 + 0.08 * fine)
    sn = np.array(LC.MEAN['snow'])[:, None] * (1 - 0.06 * smoothstep(0.0, 1.0, n2)) * (1 - 0.04 * fine)
    col['snow'] = sn
    col['dirt'] = np.array(LC.MEAN['dirt'])[:, None] * (1 + 0.2 * n2 + 0.1 * fine)
    # the forest floor: needles and moss, golden under the larches higher up
    ff = np.array(LC.MEAN['forest'])[:, None] * (1 + 0.2 * n2)
    larch = smoothstep(120.0, 260.0, alt + 60 * n1)
    ff = ff * (1 - 0.35 * larch) + np.array([0.12, 0.09, 0.035])[:, None] * 0.35 * larch
    col['forest'] = ff
    col['gravel'] = np.array(LC.MEAN['gravel'])[:, None] * (1 + 0.1 * n2 + 0.1 * fine)
    # alpine turf in autumn: tawny gold, rusty patches of bilberry, green in the hollows
    al = np.array(LC.MEAN['alpine'])[:, None] * (1 + 0.18 * n2)
    rust = smoothstep(0.2, 0.55, N.fbm(x, y, 8805, octaves=3, scale=1 / 55.0))
    al = al * (1 - 0.4 * rust) + np.array([0.19, 0.075, 0.035])[:, None] * 0.4 * rust
    green = smoothstep(0.0, 0.8, curv) * 0.5
    al = al * (1 - green) + col['grass'] * green
    col['alpine'] = al
    out = np.zeros((3, n))
    for i, m in enumerate(LC.MATERIALS):
        out += W[i] * col[m]
    # distant haze is the shader's, but a gentle damp darkening near water
    out *= (1 - 0.15 * smoothstep(20.0, 8.0, info['dr']))
    return out


def detail_normal(x, y, z, nrm, W, texel):
    """Relief below the heightfield's resolution: rock gets knobbly ridges,
    scree a fine rubble, turf soft tussocks - as a perturbation of the
    normal, scaled so it survives at the texel's size."""
    e = texel * 0.5
    rockw = W[1] + W[2] * 0.6 + W[3] * 0.3
    # turf gets only gentle swells: anything finer than a few texels turns
    # into the texel grid under the scope (the tiles carry the fine relief)
    amp = 0.9 * rockw + 0.12 * (1 - rockw)

    def h(px, py):
        return (N.ridged(px / 9.0, py / 9.0, 9101, octaves=4, gain=0.5) * 3.0 * rockw +
                N.fbm(px, py, 9102, octaves=2, scale=1 / 9.0) * 0.8)
    hx = (h(x + e, y) - h(x - e, y)) / (2 * e)
    hy = (h(x, y + e) - h(x, y - e)) / (2 * e)
    k = amp * np.clip(2.0 / np.maximum(texel, 0.5), 0.15, 1.0)
    # perturb in the surface's own tangent plane, bounded to ~30 degrees, so
    # a steep face's normal can lean but never turn away from the eye
    n0 = nrm.T
    px, py = -hx * k, -hy * k
    tilt = np.hypot(px, py)
    lim = np.tan(np.radians(30.0))
    sc = np.where(tilt > lim, lim / np.maximum(tilt, 1e-9), 1.0)
    px, py = px * sc, py * sc
    # tangents of the heightfield surface: along x (1, 0, dz/dx) and y
    nz = np.maximum(n0[2], 0.05)
    tx = np.stack([np.ones_like(nz), np.zeros_like(nz), -n0[0] / nz])
    ty = np.stack([np.zeros_like(nz), np.ones_like(nz), -n0[1] / nz])
    tx /= np.linalg.norm(tx, axis=0, keepdims=True)
    ty /= np.linalg.norm(ty, axis=0, keepdims=True)
    nn = n0 + tx * px + ty * py
    nn /= np.linalg.norm(nn, axis=0, keepdims=True)
    return nn


def build(ter, F, out_dir, quick=False):
    t0 = time.time()
    W_, H_ = QUICK_SIZE if quick else SIZE
    X, Y, R = texel_points(W_, H_)
    x, y, rr = X.ravel(), Y.ravel(), R.ravel()
    n = len(x)
    color = np.zeros((3, n), np.float32)
    normal = np.zeros((3, n), np.float32)
    s0 = np.zeros((4, n), np.float32)
    s1 = np.zeros((4, n), np.float32)
    forest = np.zeros(n, np.float32)
    CH = 600_000
    for a in range(0, n, CH):
        b = min(a + CH, n)
        xs, ys = x[a:b], y[a:b]
        texel = rr[a:b] * (M.THETA1 - M.THETA0) / W_
        e = np.clip(texel, 0.5, 12.0)
        z = ter.height(xs, ys)
        zx = (ter.height(xs + e, ys) - ter.height(xs - e, ys)) / (2 * e)
        zy = (ter.height(xs, ys + e) - ter.height(xs, ys - e)) / (2 * e)
        nrm = np.stack([-zx, -zy, np.ones_like(zx)], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        W, info = LC.evaluate(F, xs, ys, z, nrm)
        color[:, a:b] = compose_color(W, info, xs, ys)
        normal[:, a:b] = detail_normal(xs, ys, z, nrm, W, texel)
        s0[:, a:b] = W[0:4]
        s1[:, a:b] = W[4:8]
        forest[a:b] = info['forest']
        log(f"  {b:,}/{n:,} texels ({time.time() - t0:.0f}s)")
    os.makedirs(out_dir, exist_ok=True)
    shape = (H_, W_)

    def img(arr, ch):
        return arr.reshape(ch, *shape).transpose(1, 2, 0)[::-1]     # top row = far (v = 1)
    save_png(os.path.join(out_dir, "color.png"), lin_to_srgb(img(color, 3)))
    # world normal in glTF axes: (x, z, -y)
    ng = np.stack([normal[0], normal[2], -normal[1]])
    save_png(os.path.join(out_dir, "normal.png"), img(ng, 3) * 0.5 + 0.5)
    save_png(os.path.join(out_dir, "splat0.png"), img(s0, 4))
    save_png(os.path.join(out_dir, "splat1.png"), img(s1, 4))
    np.save(os.path.join(out_dir, "forest_density.npy"), forest.reshape(shape).astype(np.float16))
    log(f"maps {W_}x{H_} written in {time.time() - t0:.0f}s")


def save_png(path, arr):
    from .imgio import write
    write(path, arr)
