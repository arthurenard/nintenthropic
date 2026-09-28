"""Procedural source materials, baked into each vehicle's atlas (bake.py).

The look: lusterless olive drab that has lived outdoors for years. The paint
is darker and greener where it is sheltered and faded where the sun hits the
tops; dust lies on every upward face and in the corners; mud is thrown up the
lower body, heaviest behind each wheel; the edges people and branches touch
are chipped to dark steel that is starting to rust; the canvas is a lighter,
yellower olive than the paint, bleached on top and water-stained down the
sides; the bed's boards were painted too, and boots and crates have worn the
paint off the floor and the board edges; the tyres are black rubber with a
cross-country lug pattern, their grooves packed with dirt.

Every material exposes its albedo, roughness and metalness through emission
shaders and its normal (bump on top of a Bevel-node normal that rounds the
hard edges of the low-poly boxes) through a Principled BSDF; route() points
the output at one of them for each bake pass. Colours are linear albedos
picked from sRGB swatches (lin), kept in real-world ranges (paint 0.05-0.12,
dust 0.2-0.3) so the runtime lighting stays physically sane.

Coordinates inside the shaders: world position in Blender (the vehicle
faces -Y). The authoring frame is recovered as xa = -x, ya = -y - shift
(before recentring) so seams and louvres are placed with the model's numbers.
"""

import math

import bpy

from dustcreek.nodes import G

_MATS = {}      # material name -> (material, route nodes)


def lin(r, g, b):
    def c(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (c(r), c(g), c(b))


OD = lin(66, 68, 42)            # olive drab, as painted (lusterless, brownish)
OD_DARK = lin(52, 55, 34)
OD_LIGHT = lin(76, 78, 50)
OD_FADED = lin(94, 94, 70)      # sun-bleached on the tops
DUST = lin(150, 139, 116)
MUD_DRY = lin(118, 103, 82)
MUD_WET = lin(66, 55, 42)
STEEL = lin(62, 60, 57)
RUST = lin(94, 60, 38)           # brown, not orange: old rust under dust
RUST_DARK = lin(62, 44, 30)
GRIME = lin(40, 38, 29)
CANVAS = lin(98, 99, 66)
CANVAS_BLEACH = lin(128, 127, 96)
RUBBER = lin(24, 24, 23)


class Ctx:
    """Per-material handles on position, normal and the vehicle's layout."""

    def __init__(self, g, v, spin=False):
        self.g = g
        self.v = v
        self.P = g.geo('Position')
        self.px, self.py, self.pz = g.separate(self.P)
        self.N = g.geo('Normal')
        self.nx, self.ny, self.nz = g.separate(self.N)
        self.rand = g.attr('rand')
        shift = getattr(v, "shift", 0.0)
        self.xa = g.mul(self.px, -1.0)
        self.yf = g.mul(self.py, -1.0)                 # authoring Y after recentring
        self.ya = g.sub(self.yf, shift)                # authoring Y as modelled
        self.z = self.pz
        # a wheel spins: nothing on it may depend on which way is up
        self.up = g.value(0.0) if spin else g.smooth(self.nz, 0.35, 0.95)
        self.spin = spin
        self._edge = {}
        self._cav = {}

    def edge(self, radius=0.012, lo=0.015, hi=0.2):
        """Convex and concave edges: where the Bevel node's rounded normal
        departs from the true normal."""
        key = (radius, lo, hi)
        if key not in self._edge:
            g = self.g
            bev = g.node('ShaderNodeBevel', inputs={'Radius': radius}, out='Normal', samples=8)
            d = g.vmath('DOT_PRODUCT', bev, self.N, out=1)
            self._edge[key] = g.smooth(g.sub(1.0, d), lo, hi)
        return self._edge[key]

    def cavity(self, dist=0.2):
        if dist not in self._cav:
            g = self.g
            ao = g.node('ShaderNodeAmbientOcclusion', inputs={'Distance': dist}, out='AO', samples=8,
                        only_local=False, inside=False)
            self._cav[dist] = g.sub(1.0, ao)
        return self._cav[dist]

    def bevel_normal(self, radius=0.012):
        return self.g.node('ShaderNodeBevel', inputs={'Radius': radius}, out='Normal', samples=8)

    def vec(self, sx, sy, sz, ox=0.0):
        """World position scaled per axis (anisotropic noise: streaks, grain)."""
        g = self.g
        return g.combine(g.madd(self.px, sx, ox), g.mul(self.py, sy), g.mul(self.pz, sz))


# ---------------------------------------------------------------------------
# layers

def dust_mud(c, col, rough, h, dust_k=1.0, mud_k=1.0, mud_top=None):
    """Dust on upward faces, low on the body and in corners; mud dense along
    the bottom edges, breaking up into splatter higher up, fanned out behind
    each wheel, with a few runs down the vertical faces."""
    g = c.g
    v = c.v
    mud_top = mud_top if mud_top is not None else v.mud_top
    n1 = g.noise(c.P, scale=2.0, detail=6.0, rough=0.62)
    n2 = g.noise(c.P, scale=13.0, detail=4.0, rough=0.55)
    cav = c.cavity(0.25)
    low = g.smooth(c.z, mud_top + 0.5, 0.05)
    dv = g.add(g.add(g.mul(c.up, 0.45), g.mul(low, 0.30)), g.mul(cav, 0.45))
    dv = g.add(dv, g.add(g.mul(g.sub(n1, 0.5), 0.7), g.mul(g.sub(n2, 0.5), 0.3)))
    dust = g.mul(g.smooth(dv, 0.40, 0.95), dust_k, clamp=True)
    col = g.mix(g.mul(dust, 0.7), col, DUST)
    # a thin film everywhere: nothing out here is clean
    col = g.mix(0.12 * dust_k, col, DUST)
    rough = g.mixf(dust, rough, 0.95)
    h = g.add(h, g.mul(dust, 0.00008))
    if mud_k <= 0:
        return col, rough, h
    grad = g.smooth(c.z, mud_top, mud_top - 0.55)
    spray = None
    for (yw, zw, r) in v.mud:
        dy = g.sub(c.yf, yw)
        dz = g.sub(c.z, zw)
        d = g.math('SQRT', g.add(g.mul(dy, dy), g.mul(dz, dz)))
        ring = g.smooth(d, r + 0.75, r + 0.03)
        behind = g.madd(g.smooth(g.mul(dy, -1.0), -0.2, 0.6), 0.8, 0.35)
        s = g.mul(ring, behind, clamp=True)
        spray = s if spray is None else g.math('MAXIMUM', spray, s)
    src = g.math('MAXIMUM', g.mul(grad, 1.0), g.mul(spray, 0.85))
    fine = g.noise(c.P, scale=48.0, detail=10.0, rough=0.72)
    med = g.noise(g.vmul(c.P, (1.0, 1.0, 1.8)), scale=8.0, detail=6.0, rough=0.6)
    # fine splatter carries the edge; the mid-scale noise only breaks the line
    # (too much of it reads as camouflage blotches, not mud)
    cover = g.add(g.mul(src, 1.15), g.add(g.mul(g.sub(med, 0.5), 0.32), g.mul(g.sub(fine, 0.5), 0.9)))
    mud = g.smooth(cover, 0.64, 0.68)
    # droplets thrown above the mud line
    vor = g.voronoi(c.P, scale=75.0, feature='F1')
    vsz = g.noise(c.P, scale=30.0, detail=2.0)
    drops = g.sub(1.0, g.smooth(vor, g.mul(vsz, 0.10), g.add(g.mul(vsz, 0.10), 0.03)))
    drops = g.mul(drops, g.smooth(g.add(src, g.mul(g.sub(med, 0.5), 0.4)), 0.25, 0.6))
    # runs: rain washing the mud down the vertical faces
    vert = g.sub(1.0, g.math('ABSOLUTE', c.nz))
    runs = g.noise(c.vec(40.0, 40.0, 2.0), scale=1.0, detail=3.0)
    runs = g.mul(g.mul(g.smooth(runs, 0.6, 0.72), vert), g.smooth(src, 0.15, 0.5))
    mud = g.math('MAXIMUM', mud, g.math('MAXIMUM', drops, g.mul(runs, 0.6)))
    mud = g.mul(mud, mud_k, clamp=True)
    thick = g.mul(g.smooth(cover, 0.85, 1.1), mud_k, clamp=True)
    mc = g.mix(thick, MUD_DRY, MUD_WET)
    mc = g.mix(g.mul(n2, 0.5), mc, g.hsv(mc, v=1.2))
    col = g.mix(mud, col, mc)
    rough = g.mixf(mud, rough, g.mixf(thick, 0.93, 0.8))
    h = g.add(h, g.add(g.mul(mud, 0.0005), g.mul(thick, g.mul(fine, 0.0012))))
    return col, rough, h


def chips(c, col, rough, metal, h, amount=1.0, radius=0.05, low_dots=1.0):
    """Paint worn off the edges people and branches touch, down to dark steel
    rusting in places, in a ragged band a few centimetres wide; stone chips
    scattered low on the body."""
    g = c.g
    # convex edges only: inside corners collect grime, they do not chip
    # (the upper threshold lets rounded corners wear less than sharp edges)
    e = g.mul(c.edge(radius, 0.002, 0.075), g.sub(1.0, g.smooth(c.cavity(0.06), 0.12, 0.45)))
    cn = g.noise(c.P, scale=38.0, detail=10.0, rough=0.7)
    cn2 = g.noise(c.P, scale=5.0, detail=3.0)
    cv = g.add(g.mul(e, 0.80 * amount), g.add(g.mul(g.sub(cn, 0.5), 1.1), g.mul(g.sub(cn2, 0.5), 0.6)))
    chip = g.smooth(cv, 0.52, 0.55)
    vor = g.voronoi(c.P, scale=55.0, feature='F1')
    dotm = g.mul(g.smooth(c.z, 1.0, 0.25), g.smooth(g.noise(c.P, scale=4.0, detail=2.0), 0.48, 0.66))
    dots = g.mul(g.sub(1.0, g.smooth(vor, 0.035, 0.07)), g.mul(dotm, low_dots))
    chip = g.math('MAXIMUM', chip, dots)
    rim = g.mul(g.sub(g.smooth(cv, 0.47, 0.55), chip), 1.0, clamp=True)
    rustm = g.smooth(g.noise(c.P, scale=22.0, detail=4.0), 0.40, 0.60)
    cc = g.mix(rustm, STEEL, g.mix(g.noise(c.P, scale=90.0, detail=2.0), RUST, RUST_DARK))
    col = g.mix(g.mul(rim, 0.35), col, GRIME)
    col = g.mix(chip, col, cc)
    rough = g.mixf(chip, rough, g.mixf(rustm, 0.45, 0.88))
    metal = g.mixf(chip, metal, g.mixf(rustm, 0.8, 0.0))
    h = g.sub(h, g.mul(chip, 0.0003))
    # rust weeping from the chips down the vertical faces
    vert = g.sub(1.0, g.math('ABSOLUTE', c.nz))
    wn = g.noise(c.vec(60.0, 60.0, 3.0), scale=1.0, detail=3.0)
    weep = g.mul(g.mul(g.smooth(wn, 0.62, 0.75), vert), g.mul(g.smooth(e, 0.05, 0.4), rustm))
    col = g.mix(g.mul(weep, 0.25), col, RUST_DARK)
    return col, rough, metal, h


def olive(c, tone=1.0):
    """Base olive drab with mottling, a per-part tone and sun-faded tops."""
    g = c.g
    mott = g.noise(c.P, scale=0.9, detail=3.0, rough=0.5)
    fine = g.noise(c.P, scale=7.0, detail=5.0, rough=0.6)
    base = g.mix(g.smooth(mott, 0.3, 0.7), OD_DARK, OD_LIGHT)
    base = g.mix(g.mul(g.sub(fine, 0.5), 0.5), base, g.hsv(base, v=1.15))
    r = c.rand
    base = g.hsv(base, h=g.madd(r, 0.03, 0.485), s=g.madd(r, 0.3, 0.84), v=g.madd(r, 0.26, 0.87 * tone))
    base = g.mix(g.mul(c.up, 0.4), base, OD_FADED)
    # grime settled in the corners, rain streaks down the vertical faces
    cav = c.cavity(0.18)
    base = g.mix(g.mul(g.smooth(cav, 0.08, 0.55), 0.6), base, GRIME)
    st = g.noise(c.vec(28.0, 28.0, 1.2), scale=1.0, detail=4.0, rough=0.6)
    vert = g.sub(1.0, g.math('ABSOLUTE', c.nz))
    streak = g.mul(g.mul(g.smooth(st, 0.56, 0.78), vert), 0.42)
    base = g.mix(streak, base, lin(52, 50, 38))
    rough = g.madd(fine, 0.1, 0.76)
    return base, rough


def seam_line(c, coord, c0, along, lo, hi, band=None, w=0.0025):
    """1 on a thin groove where coord == c0, for `along` in [lo, hi], and
    optionally only where a third coordinate is inside band (lo, hi)."""
    g = c.g
    m = g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(coord, c0)), w * 0.4, w))
    m = g.mul(m, g.mul(g.smooth(along, lo - 0.004, lo + 0.004), g.smooth(along, hi + 0.004, hi - 0.004)))
    if band is not None:
        bc, blo, bhi = band
        m = g.mul(m, g.mul(g.smooth(bc, blo - 0.01, blo + 0.01), g.smooth(bc, bhi + 0.01, bhi - 0.01)))
    return m


# a plain painted number on the bonnet sides (no insignia): text, where
# (ya0, ya1, z0, z1) in the authoring frame, and |x| beyond which it is painted
NUMBERS = {"truck": ("4-27", (2.33, 2.92, 1.27, 1.45), 0.46),
           "jeep": ("12", (1.02, 1.30, 0.80, 0.92), 0.42)}
STENCIL_WHITE = lin(158, 154, 134)


def stencil_image(text, w=512, h=160):
    """Rasterise text in Blender's built-in font into a mask image (numpy,
    2x2 supersampled): the number is painted from it, nothing is downloaded."""
    import numpy as np
    name = f"stencil.{text}"
    img = bpy.data.images.get(name)
    if img:
        return img
    cu = bpy.data.curves.new("stencil", 'FONT')
    cu.body = text
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new("stencil", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    V = np.array([v.co[:2] for v in me.vertices], np.float64)
    me.calc_loop_triangles()
    T = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    bpy.data.meshes.remove(me)
    lo, hi = V.min(0), V.max(0)
    s = min(w * 0.94 / (hi[0] - lo[0]), h * 0.90 / (hi[1] - lo[1]))
    P = (V - (lo + hi) / 2) * s + np.array([w / 2, h / 2])
    ss = 2
    mask = np.zeros((h * ss, w * ss), np.float32)
    P = P * ss
    for a, b, c2 in P[T]:
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c2)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c2)).astype(int)
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, w * ss - 1) + 1) + 0.5,
                             np.arange(max(y0, 0), min(y1, h * ss - 1) + 1) + 0.5)
        d = (b[1] - c2[1]) * (a[0] - c2[0]) + (c2[0] - b[0]) * (a[1] - c2[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c2[1]) * (xs - c2[0]) + (c2[0] - b[0]) * (ys - c2[1])) / d
        w1 = ((c2[1] - a[1]) * (xs - c2[0]) + (a[0] - c2[0]) * (ys - c2[1])) / d
        inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
        mask[ys[inside].astype(int), xs[inside].astype(int)] = 1.0
    mask = mask.reshape(h, ss, w, ss).mean((1, 3))
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.stack([mask, mask, mask, np.ones_like(mask)], 2)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def number(c, col):
    g = c.g
    text, (y0, y1, z0, z1), xmin = NUMBERS[c.v.name]
    img = stencil_image(text)
    # read left to right from either side: forward is to the right on the
    # vehicle's right flank and to the left on its left flank
    right = g.smooth(c.xa, -0.01, 0.01)
    u = g.mixf(right, g.mul(g.sub(y1, c.ya), 1 / (y1 - y0)), g.mul(g.sub(c.ya, y0), 1 / (y1 - y0)))
    v = g.mul(g.sub(c.z, z0), 1 / (z1 - z0))
    m = g.image(img, g.combine(u, v, 0.0), out='Color', extension='CLIP')
    m, _, _ = g.sep_rgb(m)
    side = g.mul(g.smooth(g.math('ABSOLUTE', c.xa), xmin - 0.01, xmin + 0.005),
                 g.smooth(g.math('ABSOLUTE', c.nx), 0.6, 0.85))
    wear = g.smooth(g.noise(c.P, scale=70.0, detail=6.0, rough=0.7), 0.28, 0.42)
    return g.mix(g.mul(g.mul(m, side), g.mul(wear, 0.92)), col, STENCIL_WHITE)


def details(c, col, rough, h):
    """Panel seams and louvres pressed into the steel (per vehicle)."""
    g = c.g
    ax = g.math('ABSOLUTE', c.xa)
    seams = []
    lou = None
    if c.v.name == "truck":
        side = (ax, 0.90, 1.2)
        seams += [seam_line(c, c.ya, 1.405, c.z, 0.90, 2.31, side), seam_line(c, c.ya, 0.38, c.z, 0.90, 2.31, side),
                  seam_line(c, c.z, 0.905, c.ya, 0.38, 1.405, side)]
        seams += [seam_line(c, c.z, 1.12, c.ya, 1.6, 2.97, (ax, 0.44, 0.5))]
        # bonnet louvres: pressed slots in the side panels, behind the number
        u = g.math('FRACT', g.mul(g.sub(c.ya, 1.74), 1 / 0.055))
        inz = g.mul(g.smooth(c.z, 1.23, 1.25), g.smooth(c.z, 1.49, 1.47))
        iny = g.mul(g.smooth(c.ya, 1.73, 1.75), g.smooth(c.ya, 2.24, 2.22))
        lou = g.mul(g.mul(inz, iny), g.smooth(ax, 0.44, 0.46))
        # diamond tread plate on the running boards
        da = g.math('FRACT', g.mul(g.add(c.ya, c.xa), 1 / 0.032))
        db = g.math('FRACT', g.mul(g.sub(c.ya, c.xa), 1 / 0.032))
        dd = g.math('SQRT', g.add(g.mul(g.mul(g.sub(da, 0.5), g.sub(da, 0.5)), 5.0), g.mul(g.sub(db, 0.5), g.sub(db, 0.5))))
        dots = g.sub(1.0, g.smooth(dd, 0.16, 0.24))
        board = g.mul(g.mul(g.smooth(c.nz, 0.8, 0.95), g.mul(g.smooth(c.z, 0.80, 0.81), g.smooth(c.z, 0.835, 0.825))),
                      g.mul(g.smooth(ax, 0.69, 0.71), g.smooth(c.ya, 0.29, 0.31)))
        h = g.add(h, g.mul(g.mul(dots, board), 0.0015))
    else:
        side = (ax, 0.60, 0.7)
        seams += [seam_line(c, c.ya, -0.95, c.z, 0.44, 0.86, side), seam_line(c, c.z, 0.62, c.ya, -1.36, -0.95, side)]
        seams += [seam_line(c, c.xa, 0.0, c.ya, 0.6, 1.45, (c.z, 0.95, 1.0))]
        u = g.math('FRACT', g.mul(g.sub(c.ya, 0.62), 1 / 0.045))
        inz = g.mul(g.smooth(c.z, 0.82, 0.84), g.smooth(c.z, 0.93, 0.91))
        iny = g.mul(g.smooth(c.ya, 0.61, 0.63), g.smooth(c.ya, 0.98, 0.96))
        lou = g.mul(g.mul(inz, iny), g.smooth(ax, 0.41, 0.43))
    s = seams[0]
    for m in seams[1:]:
        s = g.math('MAXIMUM', s, m)
    col = number(c, col)
    col = g.mix(g.mul(s, 0.7), col, GRIME)
    h = g.sub(h, g.mul(s, 0.0012))
    if lou is not None:
        # a louvre: a dark slot under a raised lip that catches the light
        slot = g.mul(g.smooth(u, 0.18, 0.26), g.smooth(u, 0.52, 0.44))
        lip = g.mul(g.smooth(u, 0.44, 0.60), g.smooth(u, 0.98, 0.80))
        col = g.mix(g.mul(g.mul(slot, lou), 0.85), col, lin(14, 14, 12))
        h = g.add(h, g.mul(lou, g.sub(g.mul(lip, 0.004), g.mul(slot, 0.002))))
    return col, rough, h


# ---------------------------------------------------------------------------
# materials

def m_paint(c, interior=False, chassis=False):
    g = c.g
    col, rough = olive(c, tone=0.82 if chassis else 1.0)
    metal = g.value(0.0)
    h = g.value(0.0)
    col, rough, h = details(c, col, rough, h) if not (interior or chassis) else (col, rough, h)
    col, rough, metal, h = chips(c, col, rough, metal, h, amount=0.5 if interior else 1.0,
                                 low_dots=0.0 if interior else 1.0)
    if interior:
        # boots have worn the floor to bare steel
        floor = g.mul(g.smooth(c.nz, 0.8, 0.95), g.smooth(c.z, c.v.floor + 0.06, c.v.floor + 0.02))
        wear = g.mul(floor, g.smooth(g.noise(c.P, scale=5.0, detail=6.0), 0.35, 0.6))
        col = g.mix(g.mul(wear, 0.8), col, lin(70, 66, 58))
        rough = g.mixf(wear, rough, 0.5)
        col, rough, h = dust_mud(c, col, rough, h, dust_k=0.7, mud_k=0.0)
    else:
        col, rough, h = dust_mud(c, col, rough, h, dust_k=1.2 if chassis else 1.0, mud_k=1.6 if chassis else 1.0)
    if chassis:
        col = g.mix(0.35, col, g.mix(c.cavity(0.3), MUD_DRY, GRIME))
    return col, rough, metal, h, 0.012


def m_under(c):
    """Fender and apron undersides: caked with mud over dark paint."""
    g = c.g
    col, rough = olive(c, tone=0.7)
    n = g.noise(c.P, scale=9.0, detail=8.0, rough=0.7)
    caked = g.smooth(n, 0.35, 0.55)
    col = g.mix(caked, col, g.mix(g.smooth(n, 0.55, 0.8), MUD_DRY, MUD_WET))
    rough = g.mixf(caked, rough, 0.9)
    h = g.mul(caked, g.mul(n, 0.002))
    return col, rough, g.value(0.0), h, 0.006


def m_steel(c):
    """Exhaust, levers, latches, chains: dark oxidised steel with rust."""
    g = c.g
    n = g.noise(c.P, scale=18.0, detail=8.0, rough=0.65)
    big = g.noise(c.P, scale=3.0, detail=3.0)
    rust = g.smooth(g.add(n, g.mul(g.sub(big, 0.5), 0.6)), 0.45, 0.62)
    col = g.mix(rust, g.hsv(g.rgb(STEEL), v=g.madd(c.rand, 0.4, 0.75)), g.mix(g.noise(c.P, scale=60.0), RUST, RUST_DARK))
    rough = g.mixf(rust, g.madd(n, 0.2, 0.45), 0.85)
    metal = g.mixf(rust, 0.8, 0.05)
    h = g.mul(rust, g.mul(n, 0.0006))
    col, rough, h = dust_mud(c, col, rough, h, dust_k=0.8, mud_k=0.8)
    return col, rough, metal, h, 0.004


def m_black(c):
    """Rubber and bakelite: steering wheel, pedal pads, wipers, mud flaps."""
    g = c.g
    n = g.noise(c.P, scale=30.0, detail=5.0)
    col = g.mix(g.mul(n, 0.4), g.rgb(lin(20, 20, 19)), g.rgb(lin(34, 33, 31)))
    rough = g.madd(n, 0.15, 0.62)
    h = g.mul(n, 0.0002)
    col, rough, h = dust_mud(c, col, rough, h, dust_k=0.9, mud_k=1.0)
    return col, rough, g.value(0.0), h, 0.004


def m_seat(c):
    g = c.g
    if c.v.name == "truck":
        base = lin(62, 44, 31)       # leatherette, cracked and worn pale where sat on
    else:
        base = lin(92, 88, 60)       # canvas-covered cushions
    n = g.noise(c.P, scale=24.0, detail=6.0, rough=0.6)
    wear = g.mul(c.up, g.smooth(g.noise(c.P, scale=4.0, detail=3.0), 0.4, 0.7))
    col = g.mix(g.mul(n, 0.3), g.rgb(base), g.hsv(g.rgb(base), v=1.3))
    col = g.mix(g.mul(wear, 0.5), col, g.hsv(g.rgb(base), s=0.7, v=1.5))
    cav = c.cavity(0.1)
    col = g.mix(g.mul(cav, 0.6), col, GRIME)
    rough = g.madd(n, 0.1, 0.62 if c.v.name == "truck" else 0.88)
    h = g.mul(g.noise(c.P, scale=60.0, detail=4.0), 0.0004)
    return col, rough, g.value(0.0), h, 0.02


def m_canvas(c, inside=False):
    """The cover: olive duck, bleached on top, water-stained down the sides,
    sewn in panels over the bows, dusty along the hem."""
    g = c.g
    v = c.v
    ax = g.math('ABSOLUTE', c.xa)
    band = g.math('FLOOR', g.mul(c.ya, 1 / 0.83))
    pr = g.node('ShaderNodeTexWhiteNoise', inputs={'Vector': g.combine(band, 3.1, 0.0)}, out='Value',
                noise_dimensions='3D')
    mott = g.noise(c.P, scale=1.2, detail=4.0, rough=0.55)
    col = g.mix(g.smooth(mott, 0.3, 0.7), g.hsv(g.rgb(CANVAS), v=0.9), g.hsv(g.rgb(CANVAS), v=1.08))
    col = g.hsv(col, h=g.madd(pr, 0.02, 0.49), v=g.madd(pr, 0.12, 0.94))
    if inside:
        col = g.hsv(col, s=0.9, v=0.7)
        n = g.noise(c.P, scale=40.0, detail=4.0)
        return col, g.value(0.92), g.value(0.0), g.mul(n, 0.0002), 0.01
    col = g.mix(g.mul(c.up, 0.5), col, CANVAS_BLEACH)
    # water: dark runs down the sides from the roof, tide marks near the hem
    st = g.noise(c.vec(9.0, 9.0, 0.6), scale=1.0, detail=5.0, rough=0.62)
    vert = g.sub(1.0, g.math('ABSOLUTE', c.nz))
    run = g.mul(g.mul(g.smooth(st, 0.5, 0.72), vert), 0.5)
    col = g.mix(run, col, lin(80, 77, 54))
    hem = g.smooth(c.z, v.hem + 0.35, v.hem)
    col = g.mix(g.mul(hem, 0.45), col, g.mix(g.noise(c.P, scale=6.0), lin(96, 88, 68), MUD_DRY))
    # seams: the roof panel joins the sides along the shoulder; cross seams over the bows
    seams = [seam_line(c, c.z, v.shoulder, c.ya, -3.5, 0.1, (ax, 0.9, 1.2), w=0.006)]
    for yb in v.bows:
        seams.append(seam_line(c, c.ya, yb + 0.03, c.z, v.hem, 3.0, None, w=0.006))
    s = seams[0]
    for m in seams[1:]:
        s = g.math('MAXIMUM', s, m)
    col = g.mix(g.mul(s, 0.35), col, lin(78, 74, 52))
    # wrinkles: soft creases running with the pull between the bows
    wr = g.noise(g.combine(g.mul(c.px, 6.0), g.mul(c.py, 1.4), g.mul(c.pz, 6.0)), scale=2.0, detail=6.0, rough=0.55)
    weave = g.noise(c.P, scale=260.0, detail=2.0)
    h = g.add(g.mul(wr, 0.004), g.add(g.mul(weave, 0.00015), g.mul(s, 0.0015)))
    rough = g.madd(weave, 0.06, 0.86)
    col, rough, h = dust_mud(c, col, rough, h, dust_k=0.8, mud_k=0.7)
    return col, rough, g.value(0.0), h, 0.02


def m_rope(c):
    g = c.g
    u, vv, _ = g.separate(g.uv('grain'))
    tw = g.wave(g.combine(g.add(g.mul(u, 1.0), g.mul(vv, 0.6)), 0.0, 0.0), scale=40.0, direction='X', profile='SIN')
    col = g.mix(g.mul(tw, 0.4), g.rgb(lin(118, 106, 80)), g.rgb(lin(140, 128, 98)))
    h = g.mul(tw, 0.0008)
    col, rough, h = dust_mud(c, col, g.value(0.9), h, dust_k=0.7, mud_k=0.5)
    return col, rough, g.value(0.0), h, 0.003


def m_wood(c):
    """Boards painted olive drab, the paint worn through to grey timber at the
    board edges, on the floor and on the bench tops."""
    g = c.g
    u, vv, _ = g.separate(g.uv('grain'))
    bw = 0.145
    bi = g.math('FLOOR', g.mul(vv, 1 / bw))
    br = g.node('ShaderNodeTexWhiteNoise', inputs={'Vector': g.combine(bi, g.mul(c.rand, 17.0), 0.0)}, out='Value',
                noise_dimensions='3D')
    fv = g.math('FRACT', g.mul(vv, 1 / bw))
    edgev = g.math('MINIMUM', fv, g.sub(1.0, fv))
    groove = g.sub(1.0, g.smooth(edgev, 0.012, 0.045))
    grain = g.noise(g.combine(g.mul(u, 0.7), g.mul(vv, 45.0), g.mul(br, 9.0)), scale=2.0, detail=6.0, rough=0.6, dist=0.3)
    wood = g.mix(g.smooth(grain, 0.3, 0.75), lin(86, 76, 62), lin(132, 120, 100))
    wood = g.hsv(wood, v=g.madd(br, 0.3, 0.85))
    paint = g.hsv(g.rgb(OD), h=g.madd(br, 0.02, 0.49), v=g.madd(br, 0.18, 0.95))
    paint = g.mix(g.mul(c.up, 0.45), paint, OD_FADED)
    wn = g.noise(c.P, scale=9.0, detail=8.0, rough=0.7)
    wear = g.add(g.mul(g.sub(1.0, g.smooth(edgev, 0.0, 0.12)), 0.55), g.mul(g.sub(wn, 0.5), 1.1))
    floor = g.mul(c.up, g.smooth(c.z, c.v.bed_floor + 0.4, c.v.bed_floor + 0.25) if c.v.name == "truck" else 0.0)
    wear = g.add(wear, g.mul(floor, 0.45))
    bare = g.smooth(wear, 0.42, 0.5)
    col = g.mix(bare, paint, wood)
    col = g.mix(g.mul(groove, 0.8), col, lin(30, 27, 22))
    cav = c.cavity(0.15)
    col = g.mix(g.mul(g.smooth(cav, 0.1, 0.6), 0.5), col, GRIME)
    rough = g.mixf(bare, 0.72, 0.86)
    h = g.add(g.mul(groove, -0.002), g.mul(grain, g.mul(bare, 0.0004)))
    col, rough, h = dust_mud(c, col, rough, h, dust_k=1.1, mud_k=0.9)
    return col, rough, g.value(0.0), h, 0.008


def _cyl(c):
    """Cylindrical coordinates about the prototype wheel's axle (local X)."""
    g = c.g
    r = g.math('SQRT', g.add(g.mul(c.py, c.py), g.mul(c.pz, c.pz)))
    th = g.math('ARCTAN2', c.pz, c.py)
    return r, th


def m_tyre(c):
    """Cross-country tyre: chevron lugs from each shoulder, offset half a pitch,
    over a centre rib; grooves packed with dirt; dusty sidewalls with a rim
    guard ring. Radially symmetric apart from the lugs, so it spins right."""
    g = c.g
    ws = c.v.wheel_spec
    R, half, rim = ws["R"], ws["half"], ws["rim"]
    r, th = _cyl(c)
    x = c.px
    tz = g.smooth(r, R - 0.030, R - 0.012)                      # tread face and shoulders
    lugs = 22 if c.v.name == "truck" else 20
    s = g.mul(th, lugs / (2 * math.pi))
    xn = g.mul(x, 1.0 / (half * 0.9))
    xa = g.math('ABSOLUTE', xn)
    side = g.math('SIGN', xn)
    ph = g.add(s, g.add(g.mul(xa, 0.55), g.mul(g.add(side, 1.0), 0.25)))
    f = g.math('FRACT', ph)
    lug = g.mul(g.smooth(f, 0.04, 0.10), g.smooth(f, 0.56, 0.50))
    lug = g.mul(lug, g.smooth(xa, 0.12, 0.18))
    lug = g.math('MAXIMUM', lug, g.smooth(xa, 0.14, 0.10))       # centre rib
    lug = g.math('MAXIMUM', lug, g.smooth(xa, 1.02, 1.12))       # shoulder blocks beyond the tread
    groove = g.mul(tz, g.sub(1.0, lug))
    # sidewall rings: the rim guard and a raised band
    sw = g.sub(1.0, tz)
    ring = g.mul(g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(r, rim + 0.028)), 0.004, 0.009)), sw)
    band = g.mul(g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(r, R - 0.06)), 0.002, 0.006)), sw)
    n = g.noise(c.P, scale=35.0, detail=6.0, rough=0.6)
    col = g.mix(g.mul(n, 0.35), g.rgb(RUBBER), g.rgb(lin(38, 37, 35)))
    col = g.mix(g.mul(g.mul(tz, lug), 0.5), col, lin(46, 45, 42))                    # lug tops scuffed grey
    # dirt: in the grooves, a dusty film on the sidewalls, splashes near the tread
    dn = g.noise(c.P, scale=12.0, detail=8.0, rough=0.65)
    dirtg = g.mul(groove, g.smooth(dn, 0.25, 0.5))
    col = g.mix(dirtg, col, g.mix(dn, MUD_WET, MUD_DRY))
    # dust clings near the shoulder and the bead, in patches; the rubber shows between
    band_d = g.math('MAXIMUM', g.smooth(r, R - 0.10, R - 0.03), g.smooth(r, rim + 0.06, rim + 0.01))
    swd = g.mul(sw, g.add(0.15, g.mul(band_d, 0.6)))
    swd = g.mul(swd, g.smooth(g.add(dn, g.mul(g.sub(g.noise(c.P, scale=4.0), 0.5), 0.6)), 0.45, 0.8))
    col = g.mix(g.mul(swd, 0.7), col, lin(98, 91, 78))
    splash = g.mul(g.mul(sw, g.smooth(r, R - 0.09, R - 0.03)), g.smooth(dn, 0.45, 0.6))
    col = g.mix(g.mul(splash, 0.8), col, MUD_DRY)
    rough = g.mixf(g.add(dirtg, swd), 0.86, 0.95)
    h = g.add(g.mul(g.mul(tz, lug), 0.010), g.add(g.mul(ring, 0.002), g.mul(band, 0.0012)))
    h = g.add(h, g.mul(dirtg, 0.004))
    h = g.add(h, g.mul(n, 0.0002))
    return col, rough, g.value(0.0), h, 0.006


def m_rim(c, back=False):
    """Steel disc wheel in olive drab: lug nuts on the bolt circle, hand holes
    (truck), chipped flange, dirt thrown into the well."""
    g = c.g
    ws = c.v.wheel_spec
    rim, hub = ws["rim"], ws["hub"]
    r, th = _cyl(c)
    col, rough = olive(c, tone=0.92)
    metal = g.value(0.0)
    h = g.value(0.0)
    if not back:
        n_nuts = 10 if c.v.name == "truck" else 5
        rb = hub * 0.95
        a = g.mul(th, n_nuts / (2 * math.pi))
        fa = g.sub(g.math('FRACT', a), 0.5)
        arc = g.mul(fa, g.mul(r, 2 * math.pi / n_nuts))
        dr = g.sub(r, rb)
        d = g.math('SQRT', g.add(g.mul(arc, arc), g.mul(dr, dr)))
        nr = 0.016 if c.v.name == "truck" else 0.014
        nut = g.sub(1.0, g.smooth(d, nr * 0.8, nr * 1.05))
        washer = g.sub(1.0, g.smooth(d, nr * 1.15, nr * 1.4))
        col = g.mix(washer, col, g.mix(g.noise(c.P, scale=80.0), RUST_DARK, STEEL))
        col = g.mix(nut, col, g.mix(g.smooth(g.noise(c.P, scale=50.0), 0.45, 0.7), lin(46, 45, 41), RUST_DARK))
        rough = g.mixf(washer, rough, 0.7)
        metal = g.mixf(nut, metal, 0.5)
        h = g.add(h, g.add(g.mul(nut, 0.008), g.mul(washer, 0.002)))
        if c.v.name == "truck":
            ah = g.mul(th, 5 / (2 * math.pi))
            fh = g.sub(g.math('FRACT', ah), 0.5)
            arch = g.mul(fh, g.mul(r, 2 * math.pi / 5))
            drh = g.mul(g.sub(r, rim * 0.80), 1.4)
            dh = g.math('SQRT', g.add(g.mul(arch, arch), g.mul(drh, drh)))
            hole = g.sub(1.0, g.smooth(dh, 0.028, 0.034))
            col = g.mix(hole, col, lin(10, 10, 9))
            h = g.sub(h, g.mul(hole, 0.006))
    col, rough, metal, h = chips(c, col, rough, metal, h, amount=0.8, radius=0.02, low_dots=0.0)
    # dirt: radial, worst in the well by the tyre
    dn = g.noise(c.P, scale=14.0, detail=8.0, rough=0.65)
    wellm = g.smooth(r, rim * 0.62, rim * 0.98)
    dirt = g.smooth(g.add(g.mul(wellm, 0.7), g.mul(g.sub(dn, 0.5), 0.8)), 0.35, 0.6)
    col = g.mix(g.mul(dirt, 0.85), col, g.mix(dn, MUD_WET, MUD_DRY))
    rough = g.mixf(dirt, rough, 0.92)
    dust = g.smooth(g.add(0.3, g.mul(g.sub(g.noise(c.P, scale=3.0), 0.5), 1.2)), 0.3, 0.8)
    col = g.mix(g.mul(dust, 0.45), col, DUST)
    return col, rough, metal, h, 0.006


def m_simple(c, color, rough, metal=0.0, dust=0.6, mud=0.5, spec_noise=0.0):
    g = c.g
    n = g.noise(c.P, scale=40.0, detail=3.0)
    col = g.mix(g.mul(n, 0.2), g.rgb(color), g.hsv(g.rgb(color), v=1.15))
    r = g.madd(n, spec_noise, rough)
    h = g.mul(n, 0.0001)
    col, r, h = dust_mud(c, col, r, h, dust_k=dust, mud_k=mud)
    return col, r, g.value(metal), h, 0.004


def m_radiator(c):
    g = c.g
    fins = g.wave(g.combine(g.mul(c.pz, 1.0), 0, 0), scale=110.0, direction='X', profile='SIN')
    tubes = g.wave(g.combine(g.mul(c.px, 1.0), 0, 0), scale=45.0, direction='X', profile='SAW')
    col = g.mix(g.mul(fins, 0.4), g.rgb(lin(14, 14, 13)), g.rgb(lin(34, 33, 30)))
    h = g.add(g.mul(fins, 0.0008), g.mul(g.smooth(tubes, 0.85, 0.95), 0.0012))
    col, rough, h = dust_mud(c, col, g.value(0.7), h, dust_k=0.9, mud_k=0.8)
    return col, rough, g.value(0.2), h, 0.003


def m_lens(c):
    g = c.g
    n = g.noise(c.P, scale=25.0, detail=4.0)
    # glass over a silvered reflector: mid grey, glossy, a little metallic
    col = g.mix(g.mul(n, 0.4), g.rgb(lin(96, 100, 102)), g.rgb(lin(80, 82, 80)))
    dust = g.smooth(g.add(g.mul(c.up, 0.5), g.mul(g.sub(n, 0.5), 1.0)), 0.3, 0.8)
    col = g.mix(g.mul(dust, 0.5), col, DUST)
    rough = g.mixf(dust, 0.1, 0.6)
    return col, rough, g.mixf(dust, 0.35, 0.0), g.mul(n, 0.0001), 0.003


# which recipe each material name uses; the value is (fn, kwargs)
RECIPES = {
    "paint": (m_paint, {}),
    "paint_in": (m_paint, {"interior": True}),
    "chassis": (m_paint, {"chassis": True}),
    "under": (m_under, {}),
    "steel": (m_steel, {}),
    "black": (m_black, {}),
    "seat": (m_seat, {}),
    "canvas": (m_canvas, {}),
    "canvas_in": (m_canvas, {"inside": True}),
    "rope": (m_rope, {}),
    "wood": (m_wood, {}),
    "tyre": (m_tyre, {}),
    "rim": (m_rim, {}),
    "rim_back": (m_rim, {"back": True}),
    "radiator": (m_radiator, {}),
    "lens": (m_lens, {}),
    "lamp_red": (m_simple, {"color": lin(120, 18, 12), "rough": 0.2, "dust": 0.5, "mud": 0.4}),
    "mirror": (m_simple, {"color": lin(200, 204, 206), "rough": 0.06, "metal": 1.0, "dust": 0.3, "mud": 0.0}),
}


# ---------------------------------------------------------------------------

def build_material(m, v, kind):
    fn, kw = RECIPES[kind]
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    g = G(nt)
    c = Ctx(g, v, spin=kind in ("tyre", "rim", "rim_back"))
    col, rough, metal, h, bev = fn(c, **kw)
    nb = c.bevel_normal(bev)
    nrm = g.bump(h, strength=1.0, distance=1.0, normal=nb)
    em_a = g.node('ShaderNodeEmission', inputs={'Color': col, 'Strength': 1.0}, out=None)
    em_r = g.node('ShaderNodeEmission', inputs={'Color': g.combine(rough, rough, rough), 'Strength': 1.0}, out=None)
    em_m = g.node('ShaderNodeEmission', inputs={'Color': g.combine(metal, metal, metal), 'Strength': 1.0}, out=None)
    bsdf = g.node('ShaderNodeBsdfPrincipled', inputs={'Base Color': col, 'Roughness': rough, 'Metallic': metal,
                                                      'Normal': nrm}, out=None)
    out = g.node('ShaderNodeOutputMaterial', out=None)
    out.target = 'CYCLES'
    tgt = g.node('ShaderNodeTexImage', out=None)
    tgt.name = "TGT"
    nt.nodes.active = tgt
    _MATS[m.name] = (m, {"albedo": em_a, "rough": em_r, "metal": em_m, "normal": bsdf, "ao": bsdf, "out": out,
                         "tgt": tgt})
    route(m.name, "normal")


def route(name, kind):
    m, n = _MATS[name]
    nt = m.node_tree
    out = n["out"]
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    nt.links.new(n[kind].outputs[0], out.inputs['Surface'])


def route_all(kind):
    for name in _MATS:
        route(name, kind)


def target(img):
    for name, (m, n) in _MATS.items():
        n["tgt"].image = img
        m.node_tree.nodes.active = n["tgt"]


def assign(v, parts, proto):
    """Fill the placeholder materials of this vehicle's bake objects."""
    names = set()
    for ob in [p[0] for p in parts] + [proto]:
        for m in ob.data.materials:
            if m:
                names.add(m.name)
    for full in sorted(names):
        kind = full.split(".", 1)[1]
        build_material(bpy.data.materials[full], v, kind)


def ground_material():
    m = bpy.data.materials.get("occ.ground") or bpy.data.materials.new("occ.ground")
    m.use_nodes = True
    return m
