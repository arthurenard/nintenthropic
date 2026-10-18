"""The trees of the Valle Serra, as full 3D models (for rendering only) and
the impostors the game draws.

The player's eye never moves, so a card that faces the eye and carries a
render of the whole tree from that side is exact at any range: no parallax
can ever give it away. So each tree is modelled once in detail - trunk,
whorls of branches, needle sprays as alpha ribbons (conifers), leaf clusters
(birch) - and rendered by Cycles from the side into an impostor atlas:

    <species>_albedo.png  RGBA: diffuse colour, alpha = coverage
    <species>_normal.png  RGB: normal in the card's tangent space (x right,
                          y up, z toward the viewer), A: ambient occlusion
Mipmaps are the level of detail: near trees read the full-size texture,
far ones its small mips.

Species (the forest's `forest.<species>`):
    fir     Norway spruce, the dark conical tree that covers the slopes
    larch   European larch, airy, turning gold in late September
    pine    Swiss stone pine at the treeline, dense and dark
    birch   birch along the river and in the village, yellowing
"""

import math
import os
import time

import bpy
import numpy as np

from . import scene as S
from .imgio import write as write_img

IMP_W, IMP_H = 512, 1024           # impostor size per variant (1 : 2)

VARIANTS = {
    # species: [(variant, height m, seed, extra)]
    "fir": [("a", 28.0, 11, {}), ("b", 23.0, 12, {"crown_base": 0.18}), ("c", 11.0, 13, {"young": True})],
    "larch": [("a", 24.0, 21, {"gold": 0.22}), ("b", 19.0, 22, {"gold": 0.6})],
    "pine": [("a", 12.0, 31, {})],
    "birch": [("a", 15.0, 41, {}), ("b", 11.0, 42, {"lean": 0.08})],
    # riverside and hedgerow shrubs: grey alder and willow, hazel, a low
    # juniper-and-alpenrose clump
    "bush": [("a", 4.2, 51, {"spread": 1.1, "tone": "alder"}), ("b", 3.4, 52, {"spread": 0.8, "tone": "willow"}),
             ("c", 2.6, 53, {"spread": 1.3, "tone": "hazel"}), ("d", 1.3, 54, {"spread": 1.6, "tone": "juniper"})],
}
ASPECT = {"bush": 1.0}                 # card height / width (2 for the trees)


def log(*a):
    print("[trees]", *a, flush=True)


def srgb(*c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------------------
# foliage textures (numpy): needle sprays and leaf clusters, RGBA

def needle_spray(w=128, h=512, seed=0, color=(40, 62, 34), tip=(70, 96, 50), density=1.0, droop=0.0,
                 length=0.28, gold=0.0):
    """A flat spray of needles along a twig running up the image: needles
    leave the twig at ~50 degrees on both sides. Returns (H, W, 4) linear rgb +
    alpha."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx = w / 2
    # the twig
    twig = np.exp(-((xx - cx) / 1.6) ** 2)
    img[..., :3] += (srgb(74, 52, 36) * twig[..., None])
    img[..., 3] = np.maximum(img[..., 3], twig)
    n = int(h * 0.9 * density)
    for i in range(n):
        y0 = rng.uniform(0, h)
        side = 1 if rng.uniform() < 0.5 else -1
        ang = math.radians(rng.uniform(35, 65)) * side
        L = rng.uniform(0.7, 1.0) * length * w * 1.6
        dx = math.sin(ang)
        dy = math.cos(ang) - droop
        nrm = math.hypot(dx, dy)
        dx, dy = dx / nrm, dy / nrm
        steps = int(L)
        for k in range(steps):
            t = k / max(steps - 1, 1)
            x = cx + dx * k
            y = y0 + dy * k
            if 0 <= x < w - 1 and 0 <= y < h - 1:
                xi, yi = int(x), int(y)
                a = 0.9 * (1 - 0.3 * t)
                c = np.asarray(color, float) * (1 - t) + np.asarray(tip, float) * t
                c = srgb(*c) * rng.uniform(0.85, 1.15)
                if gold > 0 and rng.uniform() < gold:
                    c = srgb(196, 150, 50) * rng.uniform(0.8, 1.15)
                for ox, oy, ww in ((0, 0, 1.0), (1, 0, 0.5)):
                    px, py = xi + ox, yi + oy
                    if px < w and py < h:
                        img[py, px, :3] = img[py, px, :3] * (1 - a * ww) + c * a * ww
                        img[py, px, 3] = max(img[py, px, 3], a * ww)
    return img


def leaf_cluster(w=256, h=256, seed=0, gold=0.4, green=(98, 124, 46), size=1.0, narrow=1.0, n=70):
    """A spray of small leaves on thin twigs (RGBA): birch by default; alder,
    willow (narrow, silvery), hazel (broad) by the arguments."""
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    for i in range(n):
        cx, cy = rng.uniform(20, w - 20), rng.uniform(20, h - 20)
        a = rng.uniform(0, 2 * np.pi)
        L, W_ = rng.uniform(9, 15) * size, rng.uniform(6, 9) * size / narrow
        u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
        v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
        m = ((u / L) ** 2 + (v / W_) ** 2) < 1.0
        m &= ~(((u / L) ** 2 + (v / W_) ** 2 < 1.0) & (u > L * 0.85))
        g = rng.uniform()
        c = srgb(*green) if g > gold else srgb(214, 178, 52)
        c = c * rng.uniform(0.75, 1.15)
        shade = (0.8 + 0.2 * (v / W_))[m]
        img[m, :3] = c * shade[:, None]
        img[m, 3] = 1.0
    return img


# ---------------------------------------------------------------------------
# geometry helpers

class Geo:
    def __init__(self):
        self.V, self.F, self.UV, self.M = [], [], [], []
        self.n = 0

    def add(self, V, F, UV, mat):
        self.V.append(np.asarray(V, np.float32))
        self.F.append(np.asarray(F, np.int64) + self.n)
        self.UV.append(np.asarray(UV, np.float32))
        self.M += [mat] * len(F)
        self.n += len(V)

    def arrays(self):
        return np.vstack(self.V), np.vstack(self.F), np.vstack(self.UV), np.array(self.M)


def tube(g, pts, radii, mat, sides=7, uv_scale=1.0):
    pts = np.asarray(pts, float)
    n = len(pts)
    t = np.gradient(pts, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    ref = np.array([0.0, 0.0, 1.0]) if abs(t[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    V, UV = [], []
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    for i in range(n):
        a = np.cross(t[i], ref)
        a /= np.linalg.norm(a) + 1e-9
        b = np.cross(t[i], a)
        for k in range(sides + 1):
            th = 2 * np.pi * k / sides
            V.append(pts[i] + (a * math.cos(th) + b * math.sin(th)) * radii[i])
            UV.append((k / sides * uv_scale, s[i] * uv_scale))
    F = []
    for i in range(n - 1):
        for k in range(sides):
            a0 = i * (sides + 1) + k
            b0 = a0 + sides + 1
            F += [(a0, a0 + 1, b0 + 1), (a0, b0 + 1, b0)]
    g.add(V, F, UV, mat)


def ribbon(g, pts, width, mat, up=(0, 0, 1), twist=0.0, uv_len=None):
    """A flat strip along a polyline, its face turned toward `up`."""
    pts = np.asarray(pts, float)
    n = len(pts)
    t = np.gradient(pts, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    upv = np.asarray(up, float)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    L = s[-1] if uv_len is None else uv_len
    V, UV = [], []
    for i in range(n):
        side = np.cross(t[i], upv)
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(t[i], np.array([1.0, 0, 0]))
        side /= np.linalg.norm(side)
        if twist:
            nrm = np.cross(side, t[i])
            ang = twist * s[i] / max(s[-1], 1e-6)
            side = side * math.cos(ang) + nrm * math.sin(ang)
        wv = width[i] if np.ndim(width) else width
        V += [pts[i] - side * wv / 2, pts[i] + side * wv / 2]
        UV += [(0.0, s[i] / L), (1.0, s[i] / L)]
    F = []
    for i in range(n - 1):
        a = 2 * i
        F += [(a, a + 1, a + 3), (a, a + 3, a + 2)]
    g.add(V, F, UV, mat)


def curve(p0, d0, L, n, droop, up_tip=0.0, wiggle=0.0, rng=None):
    """Points along a branch: leaving p0 along d0, drooping, the tip curling up."""
    pts = [np.asarray(p0, float)]
    d = np.asarray(d0, float) / np.linalg.norm(d0)
    step = L / n
    for i in range(n):
        t = (i + 1) / n
        d = d + np.array([0, 0, -droop * step]) + np.array([0, 0, up_tip * step * t * t * 2.5])
        if wiggle and rng is not None:
            d = d + rng.normal(0, wiggle, 3) * step
        d /= np.linalg.norm(d)
        pts.append(pts[-1] + d * step)
    return np.array(pts)


# ---------------------------------------------------------------------------
# species

def spruce(H, rng, crown_base=0.08, young=False):
    """Norway spruce: a narrow cone of whorled branches that leave the trunk
    level or drooping and curl up at their tips, with curtains of branchlets
    hanging from them (the 'comb' form of the Alps); a spire at the top."""
    g = Geo()
    r0 = H * 0.016 + 0.05
    zs = np.linspace(0, H, 24)
    tube(g, np.stack([np.zeros_like(zs), np.zeros_like(zs), zs], 1), r0 * (1 - zs / H * 0.95) ** 0.9 + 0.01, "bark", 9)
    Rb = H * (0.19 if not young else 0.26)
    z = H * crown_base + rng.uniform(0, 0.4)
    k = 0
    while z < H - 0.35:
        t = (z - H * crown_base) / (H * (1 - crown_base))
        prof = (1 - t) ** 0.85
        R = Rb * prof * (1 + 0.12 * rng.normal()) + 0.25
        nb = int(rng.integers(6, 10))
        a0 = rng.uniform(0, 2 * np.pi)
        for b in range(nb):
            a = a0 + 2 * np.pi * b / nb + rng.normal(0, 0.18)
            d = np.array([math.cos(a), math.sin(a), 0.25 - 0.55 * (1 - t) + 0.35 * t * t])
            L = R * rng.uniform(0.85, 1.1)
            pts = curve((0, 0, z), d, L, 7, droop=0.35 * (1 - t) + 0.05, up_tip=0.5 * (1 - t) + 0.1)
            rad = np.linspace(0.035 + 0.05 * (1 - t), 0.008, len(pts)) * (H / 28) ** 0.5
            tube(g, pts, rad, "bark", 5)
            # the branch's own spray along its top, and hanging branchlets
            ribbon(g, pts[1:], np.linspace(1.0, 0.35, len(pts) - 1) * (0.55 + 0.6 * (1 - t)), "needles",
                   up=(0, 0, 1), twist=0.4)
            ribbon(g, pts[1:] + np.array([0, 0, -0.12]), np.linspace(0.8, 0.3, len(pts) - 1) * (0.55 + 0.6 * (1 - t)),
                   "needles", up=(0, 0, 1), twist=-0.6)
            nsec = max(int(L / 0.16), 2)
            for s_ in range(nsec):
                u = (s_ + 0.5) / nsec
                i = min(int(u * (len(pts) - 1)), len(pts) - 2)
                p = pts[i] + (pts[i + 1] - pts[i]) * (u * (len(pts) - 1) - i)
                for sd in (-1, 1):
                    along = pts[i + 1] - pts[i]
                    along /= np.linalg.norm(along)
                    side = np.cross(along, (0, 0, 1))
                    side /= np.linalg.norm(side) + 1e-9
                    hang = side * sd * 0.55 + along * 0.35 + np.array([0, 0, -0.9 * (1 - t) - 0.1])
                    Ls = rng.uniform(0.5, 1.1) * (0.5 + 0.7 * (1 - t)) * (0.4 + 0.6 * (1 - u * 0.7))
                    sp = curve(p, hang, Ls, 3, droop=0.3, rng=rng, wiggle=0.15)
                    ribbon(g, sp, np.linspace(0.30, 0.14, len(sp)), "needles", up=(0, 0, 1), twist=rng.uniform(-1, 1))
        z += rng.uniform(0.32, 0.52) * (1 - 0.3 * t)
        k += 1
    # the leader: a spire of small branchlets
    for i in range(10):
        zz = H - 0.35 - i * 0.1
        for sd in range(4):
            a = rng.uniform(0, 2 * np.pi)
            sp = curve((0, 0, zz), (math.cos(a), math.sin(a), 0.8), 0.25, 2, droop=0.0)
            ribbon(g, sp, 0.12, "needles")
    return g


def larch(H, rng, gold=0.5):
    """European larch: a slender trunk, airy tiers of long horizontal
    branches with pendulous twigs, soft tufts of needles turning gold."""
    g = Geo()
    r0 = H * 0.015 + 0.05
    zs = np.linspace(0, H, 22)
    tube(g, np.stack([np.zeros_like(zs), np.zeros_like(zs), zs], 1), r0 * (1 - zs / H * 0.95) ** 0.9 + 0.01, "bark_larch", 8)
    z = H * 0.25
    Rb = H * 0.22
    while z < H - 0.5:
        t = (z - H * 0.25) / (H * 0.75)
        R = Rb * (1 - t) ** 0.7 * (1 + 0.2 * rng.normal()) + 0.3
        for b in range(int(rng.integers(5, 9))):
            a = rng.uniform(0, 2 * np.pi)
            d = np.array([math.cos(a), math.sin(a), 0.1 - 0.2 * (1 - t)])
            pts = curve((0, 0, z), d, R, 8, droop=0.15, up_tip=0.3, rng=rng, wiggle=0.12)
            tube(g, pts, np.linspace(0.03, 0.006, len(pts)) * (H / 24) ** 0.5, "bark_larch", 5)
            ribbon(g, pts[1:], np.linspace(0.6, 0.25, len(pts) - 1), "needles_larch", up=(0, 0, 1), twist=0.8)
            nt_ = max(int(R / 0.18), 2)
            for s_ in range(nt_):
                u = (s_ + 0.5) / nt_
                i = min(int(u * (len(pts) - 1)), len(pts) - 2)
                p = pts[i]
                hang = rng.normal(0, 0.5, 3) + np.array([0, 0, -0.8])
                sp = curve(p, hang, rng.uniform(0.5, 1.2), 3, droop=0.2, rng=rng, wiggle=0.2)
                ribbon(g, sp, 0.24, "needles_larch", up=(1, 0, 0), twist=rng.uniform(-2, 2))
        z += rng.uniform(0.35, 0.65)
    return g


def pine(H, rng):
    """Swiss stone pine: a stout trunk and a dense, dark, round-topped crown
    of upswept branches ending in brushes of long needles."""
    g = Geo()
    r0 = H * 0.03 + 0.05
    zs = np.linspace(0, H * 0.92, 16)
    tube(g, np.stack([np.zeros_like(zs), np.zeros_like(zs), zs], 1), r0 * (1 - zs / H * 0.85) + 0.02, "bark", 8)
    z = H * 0.12
    while z < H * 0.95:
        t = (z - H * 0.12) / (H * 0.83)
        R = H * 0.28 * math.sqrt(max(1 - t * t, 0.02)) * (0.85 + 0.3 * rng.uniform()) + 0.3
        for b in range(int(rng.integers(4, 7))):
            a = rng.uniform(0, 2 * np.pi)
            pts = curve((0, 0, z), (math.cos(a), math.sin(a), 0.5 + 0.3 * t), R, 5, droop=0.05, up_tip=0.4, rng=rng, wiggle=0.15)
            tube(g, pts, np.linspace(0.05, 0.015, len(pts)), "bark", 5)
            ribbon(g, pts[1:], np.linspace(0.9, 0.5, len(pts) - 1), "needles_pine", up=(0, 0, 1), twist=0.7)
            for i in range(1, len(pts)):
                for k in range(7):
                    sp = curve(pts[i], rng.normal(0, 1, 3) + np.array([0, 0, 0.6]), 0.45, 2, droop=0.0)
                    ribbon(g, sp, 0.42, "needles_pine", up=rng.normal(0, 1, 3), twist=1.0)
        z += rng.uniform(0.3, 0.5)
    return g


def birch(H, rng, lean=0.0):
    """Birch: a slender white trunk, a narrow oval crown of fine drooping
    twigs, leaves yellowing."""
    g = Geo()
    zs = np.linspace(0, H * 0.9, 18)
    xs = lean * zs * zs / H
    tube(g, np.stack([xs, np.zeros_like(zs), zs], 1), (H * 0.012 + 0.04) * (1 - zs / H * 0.9) + 0.01, "bark_birch", 8)
    z = H * 0.3
    while z < H * 0.95:
        t = (z - H * 0.3) / (H * 0.65)
        R = H * 0.18 * math.sin(math.pi * min(t * 0.9 + 0.1, 1.0)) + 0.4
        for b in range(int(rng.integers(2, 4))):
            a = rng.uniform(0, 2 * np.pi)
            p0 = (lean * z * z / H, 0, z)
            pts = curve(p0, (math.cos(a), math.sin(a), 0.9), R, 5, droop=0.25, rng=rng, wiggle=0.2)
            tube(g, pts, np.linspace(0.03, 0.006, len(pts)), "bark_birch", 5)
            for i in range(1, len(pts)):
                for k in range(3):
                    c = pts[i] + rng.normal(0, 0.35, 3)
                    ang = rng.uniform(0, 2 * np.pi)
                    s = rng.uniform(0.5, 0.9)
                    ax = np.array([math.cos(ang), math.sin(ang), rng.normal(0, 0.3)])
                    ax /= np.linalg.norm(ax)
                    up = np.array([0, 0, 1.0])
                    sd = np.cross(ax, up)
                    sd /= np.linalg.norm(sd) + 1e-9
                    V = [c - sd * s / 2 - up * s / 2, c + sd * s / 2 - up * s / 2, c + sd * s / 2 + up * s / 2, c - sd * s / 2 + up * s / 2]
                    g.add(V, [(0, 1, 2), (0, 2, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)], "leaves")
        z += rng.uniform(0.6, 1.1)
    return g


def shrub(H, rng, spread=1.0, tone="alder"):
    """A shrub: several stems from one stool, arching out, twigs along them
    carrying leaf sprays - a rounded mass as wide as it is tall. The
    juniper is a low dense cushion."""
    g = Geo()
    stems = int(rng.integers(6, 11)) if tone != "juniper" else 14
    leaf_s = 0.55 if tone != "juniper" else 0.4
    for k in range(stems):
        a = rng.uniform(0, 2 * np.pi)
        tilt = rng.uniform(0.35, 0.9) if tone != "juniper" else rng.uniform(1.2, 2.2)
        d0 = np.array([math.cos(a) * tilt, math.sin(a) * tilt, 1.0])
        L_ = H * rng.uniform(0.75, 1.15) * (1.2 if tone == "juniper" else 1.0)
        pts = curve(np.array([rng.normal(0, 0.12), rng.normal(0, 0.12), 0.0]), d0 / np.linalg.norm(d0), L_, 6,
                    droop=0.35 if tone == "willow" else 0.2, rng=rng, wiggle=0.25)
        tube(g, pts, np.linspace(0.05, 0.01, len(pts)) * (H / 3.5 + 0.3), "bark", 5)
        for i in range(1, len(pts)):
            for m in range(4):
                c = pts[i] + rng.normal(0, 0.28 * spread, 3) * np.array([1, 1, 0.8])
                ang = rng.uniform(0, 2 * np.pi)
                s_ = rng.uniform(0.7, 1.1) * leaf_s * (H / 3.5 + 0.5)
                ax = np.array([math.cos(ang), math.sin(ang), rng.normal(0, 0.4)])
                ax /= np.linalg.norm(ax)
                up = np.array([0, 0, 1.0])
                sd = np.cross(ax, up)
                sd /= np.linalg.norm(sd) + 1e-9
                V = [c - sd * s_ / 2 - up * s_ / 2, c + sd * s_ / 2 - up * s_ / 2, c + sd * s_ / 2 + up * s_ / 2, c - sd * s_ / 2 + up * s_ / 2]
                g.add(V, [(0, 1, 2), (0, 2, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)], "leaves")
    return g


BUILDERS = {"fir": spruce, "larch": larch, "pine": pine, "birch": birch, "bush": shrub}


# ---------------------------------------------------------------------------
# materials for rendering the full trees

def _image_from(arr, name, colorspace='sRGB'):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    px = np.ascontiguousarray(arr[::-1]).astype(np.float32)
    img.pixels.foreach_set(px.ravel())
    img.alpha_mode = 'STRAIGHT'
    return img


def foliage_material(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = img
    tx.interpolation = 'Linear'
    uv = nt.nodes.new('ShaderNodeUVMap')
    nt.links.new(uv.outputs[0], tx.inputs['Vector'])
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(tx.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = 0.6
    try:
        bs.inputs['Subsurface Weight'].default_value = 0.0
        bs.inputs['Transmission Weight'].default_value = 0.0
    except KeyError:
        pass
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    # alpha-tested: needles are either there or not (clean edges in the render)
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.35
    nt.links.new(tx.outputs['Alpha'], gt.inputs[0])
    nt.links.new(gt.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(bs.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def bark_material(name, base, dark, white=False):
    from .scene import new_material
    m, g = new_material(name)
    pos = g.texco('Object')
    x, y, z = g.separate(pos)
    streak = g.noise(g.combine(g.mul(x, 30.0), g.mul(y, 30.0), g.mul(z, 3.0)), scale=4.0, detail=6.0)
    col = g.mix(g.smooth(streak, 0.4, 0.65), g.rgb(tuple(srgb(*base))), g.rgb(tuple(srgb(*dark))))
    if white:
        lent = g.noise(g.combine(g.mul(x, 8.0), g.mul(y, 8.0), g.mul(z, 25.0)), scale=3.0, detail=3.0)
        col = g.mix(g.smooth(lent, 0.62, 0.7), col, g.rgb(tuple(srgb(30, 28, 26))))
    g.output(g.principled(col, rough=0.9, normal=g.bump(streak, 0.4, 0.02)))
    return m


def materials(seed=0):
    mats = {}
    mats["needles"] = foliage_material("needles", _image_from(needle_spray(seed=seed + 1, color=(30, 50, 30), tip=(52, 76, 42),
                                                                         density=1.9, length=0.38), "tex_needles"))
    mats["needles_larch"] = None
    mats["needles_pine"] = foliage_material("needles_pine", _image_from(
        needle_spray(seed=seed + 3, color=(30, 50, 30), tip=(50, 74, 44), length=0.45, density=1.6), "tex_needles_pine"))
    mats["leaves"] = None
    mats["bark"] = bark_material("bark", (92, 70, 58), (54, 40, 34))
    mats["bark_larch"] = bark_material("bark_larch", (118, 72, 52), (66, 40, 30))
    mats["bark_birch"] = bark_material("bark_birch", (222, 218, 206), (170, 164, 150), white=True)
    return mats


def species_materials(mats, species, extra, seed):
    m = dict(mats)
    if species == "larch":
        gold = extra.get("gold", 0.5)
        m["needles_larch"] = foliage_material(f"needles_larch_{seed}", _image_from(
            needle_spray(seed=seed + 2, color=(96, 116, 50), tip=(146, 138, 62), density=1.15, droop=0.2, gold=gold,
                         length=0.34),
            f"tex_needles_larch_{seed}"))
    if species == "birch":
        m["leaves"] = foliage_material(f"leaves_{seed}", _image_from(leaf_cluster(seed=seed + 4, gold=0.45), f"tex_leaves_{seed}"))
    if species == "bush":
        kw = {"alder": dict(green=(62, 84, 40), gold=0.12, size=1.2, n=80),
              "willow": dict(green=(106, 124, 88), gold=0.18, size=1.1, narrow=3.0, n=110),
              "hazel": dict(green=(88, 110, 44), gold=0.35, size=1.5, n=55),
              "juniper": dict(green=(46, 66, 44), gold=0.02, size=0.6, narrow=2.5, n=160)}[extra.get("tone", "alder")]
        m["leaves"] = foliage_material(f"leaves_{seed}", _image_from(leaf_cluster(seed=seed + 4, **kw), f"tex_leaves_{seed}"))
    return m


def build_tree(species, variant, H, seed, extra, col, mats):
    rng = np.random.default_rng(seed)
    kw = {k: v for k, v in extra.items() if k in ("crown_base", "young", "gold", "lean", "spread", "tone")}
    if species != "bush":
        kw.pop("spread", None)
        kw.pop("tone", None)
    if species != "larch":
        kw.pop("gold", None)
    if species != "birch":
        kw.pop("lean", None)
    if species != "fir":
        kw.pop("crown_base", None)
        kw.pop("young", None)
    g = BUILDERS[species](H, rng, **kw)
    V, F, UV, M = g.arrays()
    names = sorted(set(M))
    ob = S.mesh_object(f"tree_{species}_{variant}", V, F, col, uvs={"UVMap": _per_vertex_uv(V, F, UV)}, smooth=True)
    sm = species_materials(mats, species, extra, seed)
    for nm in names:
        ob.data.materials.append(sm[nm])
    idx = {nm: i for i, nm in enumerate(names)}
    ob.data.polygons.foreach_set("material_index", np.array([idx[m] for m in M], np.int32))
    ob.data.update()
    return ob


def _per_vertex_uv(V, F, UV):
    return UV


# ---------------------------------------------------------------------------
# impostors

def render_impostors(out_dir, quick=False, only=None):
    """Render every variant from the side into its species atlas (`only`:
    just these species, merged into the existing impostors.json)."""
    import json
    t0 = time.time()
    os.makedirs(out_dir, exist_ok=True)
    px_w, px_h = (IMP_W // 2, IMP_H // 2) if quick else (IMP_W, IMP_H)
    info = {}
    jp = os.path.join(out_dir, "impostors.json")
    if only and os.path.exists(jp):
        info = json.load(open(jp))
    for species, variants in VARIANTS.items():
        if only and species not in only:
            continue
        tiles_alb, tiles_nrm, dims = [], [], []
        for variant, H, seed, extra in variants:
            sc = S.reset_scene("tree")
            S.setup_gpu(sc)
            mats = materials(seed)
            ob = build_tree(species, variant, H, seed, extra, sc.collection, mats)
            V = np.array([v.co[:] for v in ob.data.vertices])
            w = 2 * max(np.abs(V[:, 0]).max(), np.abs(V[:, 1]).max()) * 1.04
            hgt = V[:, 2].max() * 1.02
            # frame: the card is w wide, hgt tall; keep the species' aspect
            asp = ASPECT.get(species, 2.0)
            fw = max(w, hgt / asp)
            fh = fw * asp
            alb, nrm = _render_side(sc, fw, fh, px_w, int(px_w * asp))
            tiles_alb.append(alb)
            tiles_nrm.append(nrm)
            dims.append(dict(variant=variant, height_m=float(fh), width_m=float(fw), tree_height_m=float(V[:, 2].max()),
                             tris=len(ob.data.polygons)))
            log(f"{species}.{variant}: {len(ob.data.polygons):,} tris, card {fw:.1f} x {fh:.1f} m ({time.time() - t0:.0f}s)")
        atlas_a = np.concatenate(tiles_alb, axis=1)
        atlas_n = np.concatenate(tiles_nrm, axis=1)
        write_img(os.path.join(out_dir, f"{species}_albedo.png"), atlas_a)
        write_img(os.path.join(out_dir, f"{species}_normal.png"), atlas_n)
        info[species] = dict(variants=dims, atlas=[atlas_a.shape[1], atlas_a.shape[0]], cells=len(dims))
    json.dump(info, open(jp, "w"), indent=1)
    return info


def _render_side(sc, fw, fh, pw, ph):
    """Orthographic render from -Y (the card faces the viewer): albedo with
    alpha, and the normal in card space (x right, y up, z toward the viewer)
    with AO in alpha."""
    cam = bpy.data.objects.new("impcam", bpy.data.cameras.new("impcam"))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = fh
    cam.data.sensor_fit = 'VERTICAL'
    cam.location = (0, -200.0, fh / 2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.clip_end = 500
    sc.collection.objects.link(cam)
    sc.camera = cam
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sc.world = w
    sc.world.light_settings.distance = 1.5
    S.render_settings(sc, pw, ph, 24, denoise=False)
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.cycles.transparent_max_bounces = 64
    sc.cycles.max_bounces = 4
    vl = sc.view_layers[0]
    vl.use_pass_diffuse_color = True
    vl.use_pass_normal = True
    vl.use_pass_ambient_occlusion = True
    s = sc.render.image_settings
    if hasattr(s, 'media_type'):
        s.media_type = 'MULTI_LAYER_IMAGE'
    s.file_format = 'OPEN_EXR_MULTILAYER'
    s.color_depth = '32'
    path = os.path.join(bpy.app.tempdir or "/tmp", "_imp.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    from .tiles import _read_layers
    L = _read_layers(path)
    import OpenImageIO as oiio
    # alpha from the combined pass
    inp = oiio.ImageInput.open(path)
    inp.seek_subimage(0, 0)
    spec = inp.spec()
    comb = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
    inp.close()
    alpha = comb[..., 3]
    dc = L['DiffCol']
    nw = L['Normal']
    ao = L['AO'][..., 0] if L['AO'].ndim == 3 else L['AO']
    # premultiplied passes: un-premultiply by coverage
    cov = np.clip(alpha, 1e-4, 1)[..., None]
    dc = np.clip(dc / cov, 0, 1)
    nw = nw / cov
    nw /= np.maximum(np.linalg.norm(nw, axis=-1, keepdims=True), 1e-6)
    # world -> card: x = +X, y = +Z, z = -Y (toward the camera at -Y)
    nc = np.stack([nw[..., 0], nw[..., 2], -nw[..., 1]], -1)
    nc[..., 2] = np.abs(nc[..., 2])
    enc = np.where(dc <= 0.0031308, dc * 12.92, 1.055 * np.power(dc, 1 / 2.4) - 0.055)
    alb = np.concatenate([enc, alpha[..., None]], -1)
    aoc = np.clip(ao / cov[..., 0], 0, 1)
    nrm = np.concatenate([nc * 0.5 + 0.5, aoc[..., None]], -1)
    # bleed colours into the transparent border so mips do not darken edges
    alb[..., :3], nrm[..., :3] = _bleed(alb[..., :3], alpha), _bleed(nrm[..., :3], alpha)
    return alb, nrm


def _bleed(rgb, alpha, iters=24):
    known = alpha > 0.3
    out = rgb.copy()
    for _ in range(iters):
        if known.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(known.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(out, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        grow = (~known) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        known |= grow
    return out
