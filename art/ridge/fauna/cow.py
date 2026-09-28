"""The cow: an alpine Brown Swiss in the farm pasture, with her bell.

Seen through the scope at 250 m she is about 60 px tall, so what matters is
the silhouette (a deep dairy barrel, angular hips, a long head carried low,
big fringed ears, short horns, the udder, a tail with a dark switch) and her
colour (mouse grey-brown, darker neck and face, the pale ring round a slate
nose). Up close, for the review and the siren secret's glance, the hair lies
backward and down, the hide wrinkles on the neck, the eye is wet and dark.

The bell is a bronze Glocke on an embroidered leather strap: the strap is
skinned to the neck, the bell rigid on its own bone `cow.bell`, which hangs
from the bottom of the strap and swings by simulation in every clip (the
game may add its own swing on top).

Blender space: facing -Y, left +X, hooves on z = 0; withers 1.44 m.
"""
import math
import numpy as np
from mathutils import Vector
from . import lib as L, quad as Q
from .lib import S, A, srgb, smoothstep, value_noise, fbm, Frame, nrm, chain, flow_noise, add, pulse

NAME = "cow"
# the head is carried nose-down; it is sculpted in its own frame (origin at the poll)
HEAD = Frame((0, -1.02, 1.34), (0, -0.36, -0.34))
# the strap sits round the upper neck, a hand behind the jaw
STRAP_C = np.array([0.0, -0.93, 1.25])
STRAP_N = nrm((0, -0.92, 0.40))


def ear_frame(s):
    """Base, direction and frame (x width, y length, z toward the cup) of an ear."""
    base = HEAD.p(s * 0.10, 0.05, -0.04)
    d = nrm((s * 1.0, 0.16, -0.36))
    return base, d, L.frame_from(d, up=(0, -1.0, 0.35))


def mix(a, b, t):
    t = np.asarray(t, float)[:, None]
    return a * (1 - t) + b * t


class Sculpt:
    """Every part of the cow as a signed distance field (and what paint and
    weights need to know about them)."""

    def __init__(self):
        H = HEAD
        barrel = L.tube(
            [(0, 0.93, 1.17), (0, 0.80, 1.15), (0, 0.50, 1.10), (0, 0.15, 1.03), (0, -0.20, 1.04),
             (0, -0.50, 1.08), (0, -0.74, 1.05), (0, -0.86, 1.07)],
            [0.08, 0.20, 0.275, 0.335, 0.345, 0.29, 0.21, 0.10],
            [0.14, 0.23, 0.32, 0.395, 0.395, 0.37, 0.30, 0.16])
        # a dairy cow's rump is a flat table with the hip bones at its front corners
        rump = S.Ellipsoid((0, 0.56, 1.325), (0.255, 0.40, 0.095))
        hooks = [S.Ellipsoid((s * 0.228, 0.42, 1.325), (0.045, 0.062, 0.038)) for s in (1, -1)]
        pins = [S.Ellipsoid((s * 0.095, 0.855, 1.29), (0.038, 0.045, 0.034)) for s in (1, -1)]
        ridge = S.RoundCone((0, 0.82, 1.395), (0, -0.40, 1.425), 0.035, 0.03)
        tailhead = S.Ellipsoid((0, 0.87, 1.37), (0.055, 0.08, 0.05))
        neck = L.tube([(0, -0.58, 1.10), (0, -0.80, 1.19), (0, -0.94, 1.26), (0, -1.03, 1.30)],
                      [0.22, 0.17, 0.14, 0.12], [0.34, 0.26, 0.20, 0.165])
        dewlap = S.Ellipsoid((0, -0.84, 0.93), (0.035, 0.11, 0.17), S.rot_x(35))
        shoulders = [S.Ellipsoid((s * 0.19, -0.50, 1.16), (0.075, 0.16, 0.25), S.rot_x(-22)) for s in (1, -1)]
        arms = [S.Ellipsoid((s * 0.205, -0.64, 0.88), (0.095, 0.12, 0.17), S.rot_x(30)) for s in (1, -1)]
        thighs = [S.Ellipsoid((s * 0.19, 0.57, 0.90), (0.12, 0.22, 0.32), S.rot_x(12)) for s in (1, -1)]
        udder = S.Union([S.Ellipsoid((0, 0.47, 0.60), (0.145, 0.19, 0.13)),
                         S.Ellipsoid((0, 0.63, 0.73), (0.12, 0.10, 0.15))], k=0.05)
        self.udder = udder
        self.neck = neck
        trunk = S.Union([barrel, rump, neck, dewlap, ridge, tailhead] + hooks + pins + shoulders + arms + thighs + [udder], k=0.07)
        self.legs = [self.leg(1.0, True), self.leg(-1.0, True), self.leg(1.0, False), self.leg(-1.0, False)]
        self.hooves = [self.hoof(s * 0.172, -0.625) for s in (1, -1)] + [self.hoof(s * 0.17, 0.60) for s in (1, -1)]
        self.trunk = trunk
        limbs = S.Union([trunk] + self.legs, k=0.045)
        limbs = S.Union([limbs] + self.hooves, k=0.012)
        # --- head (x: left, s: poll -> muzzle, h: toward the forehead)
        cran = S.Ellipsoid(H.p(0, 0.085, -0.035), (0.13, 0.115, 0.098), H.R)
        poll = S.Ellipsoid(H.p(0, 0.012, 0.0), (0.122, 0.05, 0.055), H.R)
        face = S.RoundCone(H.p(0, 0.12, -0.05), H.p(0, 0.37, -0.045), 0.096, 0.075)
        cheeks = [S.Ellipsoid(H.p(s * 0.072, 0.16, -0.10), (0.05, 0.10, 0.08), H.R) for s in (1, -1)]
        jaw = S.RoundCone(H.p(0, 0.08, -0.14), H.p(0, 0.38, -0.125), 0.07, 0.046)
        muzzle = S.Ellipsoid(H.p(0, 0.44, -0.055), (0.096, 0.066, 0.08), H.R)
        chin = S.Ellipsoid(H.p(0, 0.40, -0.135), (0.05, 0.055, 0.04), H.R)
        brows = [S.Ellipsoid(H.p(s * 0.097, 0.145, 0.03), (0.03, 0.04, 0.026), H.R) for s in (1, -1)]
        self.eyes = [H.p(s * 0.116, 0.165, 0.006) for s in (1, -1)]
        eyes = [S.Sphere(e, 0.0245) for e in self.eyes]
        head = S.Union([cran, poll, face, jaw, muzzle, chin] + cheeks + brows, k=0.035)
        head = S.Union([head] + eyes, k=0.008)
        nostrils = S.Union([S.Ellipsoid(H.p(s * 0.037, 0.506, -0.035), (0.012, 0.022, 0.011), H.R) for s in (1, -1)])
        head = S.Subtract(head, nostrils, k=0.006)
        self.head = head
        self.ear_f = [self.ear(1.0), self.ear(-1.0)]
        self.tail_f = chain([(0, 0.875, 1.36), (0, 0.965, 1.20), (0, 0.99, 0.92), (0, 0.985, 0.60)],
                            [0.042, 0.03, 0.022, 0.018], n=12)
        self.switch = S.Ellipsoid((0, 0.985, 0.46), (0.045, 0.04, 0.14))
        tail = S.Union([self.tail_f, self.switch], k=0.03)
        self.tail = tail
        teats = [S.RoundCone((sx * 0.06, sy, 0.50), (sx * 0.062, sy, 0.425), 0.017, 0.013) for sx in (1, -1) for sy in (0.40, 0.55)]
        body = S.Union([limbs, head], k=0.06)
        body = S.Union([body] + self.ear_f, k=0.015)
        body = S.Union([body, tail] + teats, k=0.018)
        self.teats = S.Union(teats)
        self.body = body
        self.rest = S.Union([limbs, head], k=0.06)       # everything but tail and ears (for weights)
        self.horns = [self.horn(1.0), self.horn(-1.0)]
        self.collar = self.strap()
        self.bell_pivot = self.find_pivot()
        self.bell = self.bell_field(self.bell_pivot)
        self.all = S.Union([body] + self.horns + [self.collar, self.bell])
        self.detailed = S.Displace(body, self.detail, 0.0012)

    # -- parts
    @staticmethod
    def leg(s, front):
        x = lambda v: s * v
        if front:
            parts = [S.RoundCone((x(0.20), -0.53, 0.72), (x(0.18), -0.585, 0.41), 0.094, 0.05),
                     S.Sphere((x(0.20), -0.48, 0.74), 0.06),
                     S.Ellipsoid((x(0.18), -0.585, 0.40), (0.05, 0.052, 0.06)),
                     S.RoundCone((x(0.18), -0.585, 0.38), (x(0.175), -0.60, 0.14), 0.045, 0.039),
                     S.Ellipsoid((x(0.175), -0.595, 0.125), (0.047, 0.05, 0.045)),
                     S.RoundCone((x(0.175), -0.60, 0.12), (x(0.172), -0.625, 0.07), 0.039, 0.044)]
        else:
            parts = [S.Ellipsoid((x(0.20), 0.41, 0.73), (0.058, 0.08, 0.08)),
                     S.RoundCone((x(0.21), 0.42, 0.70), (x(0.18), 0.68, 0.48), 0.092, 0.05),
                     S.RoundCone((x(0.19), 0.64, 0.80), (x(0.18), 0.745, 0.50), 0.032, 0.03),
                     S.Ellipsoid((x(0.18), 0.695, 0.48), (0.048, 0.06, 0.058)),
                     S.RoundCone((x(0.18), 0.68, 0.46), (x(0.175), 0.635, 0.14), 0.046, 0.04),
                     S.Ellipsoid((x(0.175), 0.63, 0.125), (0.047, 0.05, 0.045)),
                     S.RoundCone((x(0.175), 0.63, 0.12), (x(0.172), 0.605, 0.07), 0.039, 0.044)]
        return S.Union(parts, k=0.025)

    @staticmethod
    def hoof(cx, cy):
        """Two claws: a low dome cut flat on the ground, split at the toe."""
        h = S.Ellipsoid((cx, cy - 0.005, 0.03), (0.056, 0.072, 0.05))
        lo, hi = (cx - 0.08, cy - 0.1, -0.02), (cx + 0.08, cy + 0.1, 0.1)
        h = S.Intersect(h, S.Plane((cx, cy, 0.0), (0, 0, -1), lo, hi))
        cleft = S.Box((cx, cy - 0.05, 0.035), (0.0035, 0.04, 0.05))
        dew = [S.Sphere((cx + d, cy + 0.06, 0.10), 0.012) for d in (-0.022, 0.022)]
        return S.Union([S.Subtract(h, cleft, k=0.003)] + dew, k=0.01)

    @staticmethod
    def ear(s):
        """Big fringed ears held out sideways, cupped toward the front."""
        base, d, R = ear_frame(s)
        c = base + d * 0.105
        outer = S.Ellipsoid(c, (0.058, 0.108, 0.02), R)
        cup = S.Ellipsoid(c + R[:, 2] * 0.017 + d * 0.012, (0.044, 0.088, 0.013), R)
        return S.Subtract(outer, cup, k=0.006)

    @staticmethod
    def horn(s):
        """Short horns: out from the poll, then up and a little forward."""
        H = HEAD
        pts = [H.p(s * 0.095, 0.03, 0.02), H.p(s * 0.14, 0.012, 0.038), H.p(s * 0.17, -0.004, 0.075), H.p(s * 0.172, 0.01, 0.108)]
        return chain(pts, [0.021, 0.017, 0.011, 0.004], n=12)

    def march(self, field, start, d, reach=0.6):
        """First point outside `field` going from `start` along `d`."""
        t = np.linspace(0, reach, 1200)
        P = (np.asarray(start)[None, :] + t[:, None] * np.asarray(d)[None, :]).astype(np.float32)
        return P[int(np.argmax(field(P) > 0))].astype(float)

    def strap(self):
        """The leather strap: a band hugging the neck, cut by a slab across
        it, with a small iron buckle on top."""
        c, n = STRAP_C, STRAP_N
        w = 0.042
        lo, hi = c - 0.45, c + 0.45
        slab = S.Intersect(S.Plane(c + n * w, n, lo, hi), S.Plane(c - n * w, -n, lo, hi))
        band = S.Shell(S.Offset(self.neck, 0.013), 0.0065)
        up = nrm(np.cross((1, 0, 0), n))
        up = up if up[2] > 0 else -up
        top = self.march(self.neck, c, up)
        R = np.stack([np.array([1.0, 0, 0]), n, up], 1).astype(np.float32)
        self.buckle_at = top + up * 0.02
        frame_ = S.Box(self.buckle_at, (0.024, 0.02, 0.004), R, rad=0.002)
        hole = S.Box(self.buckle_at, (0.016, 0.012, 0.01), R)
        buckle = S.Subtract(frame_, hole)
        return S.Union([S.Intersect(band, slab), buckle], k=0.002)

    def find_pivot(self):
        """Where the bell hangs: down the strap's plane to the throat."""
        d = np.cross(STRAP_N, (1, 0, 0))
        d = nrm(d if d[2] < 0 else -d)
        return self.march(self.neck, STRAP_C, d) + d * 0.03 + np.array([0, 0, -0.005])

    @staticmethod
    def bell_field(p):
        """A cast bronze bell, a little oval, hollow at the mouth, on a loop."""
        p = np.asarray(p, float)
        body = S.RoundCone(p + (0, 0, -0.045), p + (0, 0, -0.13), 0.036, 0.062)
        crown = S.Ellipsoid(p + (0, 0, -0.04), (0.034, 0.03, 0.02))
        lip = S.Torus(p + (0, 0, -0.165), 0.058, 0.007)
        mouth = S.Ellipsoid(p + (0, 0, -0.19), (0.058, 0.05, 0.05))
        bell = S.Subtract(S.Union([body, crown, lip], k=0.01), mouth, k=0.006)
        loop = S.Torus(p + (0, 0, -0.012), 0.02, 0.0055, S.rot_y(90))
        clapper = S.Sphere(p + (0, 0, -0.158), 0.014)
        f = S.Union([bell, loop, clapper], k=0.004)
        # Swiss bells are oval, flattened front to back
        return S.Fn(lambda P: f(p + (np.asarray(P, np.float32) - p) * np.array([1.0, 1.15, 1.0], np.float32)) * 0.93,
                    f.lo - 0.01, f.hi + 0.01)

    # -- hair and hide
    @staticmethod
    def flow(P):
        """The way the hair lies: back along the body, down the flanks and legs,
        up the face from the muzzle to the poll."""
        z = P[:, 2]
        down = smoothstep(1.05, 0.55, z)
        f = np.stack([np.zeros(len(P)), 1.0 - 0.8 * down, -0.35 - 1.2 * down], 1)
        hx, hs, hh = HEAD.local(P)
        inhead = smoothstep(-0.02, 0.06, hs) * (np.abs(hx) < 0.2)
        fh = np.tile(-HEAD.S, (len(P), 1))
        f = f * (1 - inhead[:, None]) + fh * inhead[:, None]
        return f / np.linalg.norm(f, axis=1)[:, None]

    def detail(self, P):
        """Relief for the normal map: the lie of the hair (finer on the face,
        which gets more texels) and soft folds of hide round the lower neck.
        Nothing finer than two texels: anything finer only aliases."""
        P = np.asarray(P, np.float64)
        fl = self.flow(P)
        n = flow_noise(P, fl, 10.0, 70.0, seed=3)
        d = 0.0005 * (n - 0.5)
        hx, hs, hh = HEAD.local(P)
        face = smoothstep(-0.05, 0.05, hs) * (P[:, 1] < -0.9)
        d += 0.0004 * face * (flow_noise(P, fl, 25.0, 190.0, seed=8) - 0.5)
        y, z = P[:, 1], P[:, 2]
        nk = smoothstep(-0.62, -0.72, y) * smoothstep(-1.02, -0.92, y) * smoothstep(1.2, 0.95, z)
        d += 0.0011 * nk * np.sin((y * 0.9 - z * 0.45) * 2 * np.pi / 0.06 + 3 * value_noise(P, 12, seed=4)) ** 2
        return (-d).astype(np.float32)

    def parts(self):
        """The anatomical parts the body is unwrapped by, with their texel
        weights (the face gets the most). A small bias lets a part win the
        faces it shares with the trunk it is blended into."""
        b = lambda f, d: (lambda P: f(P) - d)
        legs = [S.Union([lg, hf]) for lg, hf in zip(self.legs, self.hooves)]
        return ([("trunk", self.trunk, 1.0), ("head", self.head, 2.6),
                 ("udder", b(S.Union([self.udder, self.teats]), 0.004), 1.0), ("tail", b(self.tail, 0.003), 1.0)]
                + [(f"ear{i}", b(e, 0.003), 1.6) for i, e in enumerate(self.ear_f)]
                + [(f"leg{i}", lg, 1.0) for i, lg in enumerate(legs)])

    def density(self, C):
        """Texel density by region: the face and the bell get the most."""
        x, s, h = HEAD.local(C)
        w = 1.0 + 1.6 * float(smoothstep(-0.05, 0.08, s[0]) * (abs(x[0]) < 0.3))
        return w

    def paint(self, P):
        P = np.asarray(P, np.float64)
        n = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        base = srgb(0.44, 0.38, 0.33)
        dark = srgb(0.30, 0.245, 0.205)
        light = srgb(0.66, 0.60, 0.53)
        c = np.tile(base, (n, 1))
        m = fbm(P, 2.5, 3, seed=11)
        c *= (0.9 + 0.2 * m)[:, None]
        # which part a point belongs to, from the parts' own fields (height
        # alone would paint the tail's switch like the belly it hangs beside)
        Pf = P.astype(np.float32)
        d_trunk = self.trunk(Pf)
        d_leg = np.min([lg(Pf) for lg in self.legs], axis=0)
        d_tail = self.tail(Pf)
        legw = smoothstep(0.012, -0.012, d_leg - d_trunk) * (z < 0.8)
        tailw = smoothstep(0.004, -0.004, d_tail - np.minimum(d_trunk, d_leg))
        body = (1 - legw) * (1 - tailw)
        # darker neck, shoulders and face; paler belly and inner thighs; the legs
        # darken toward the hooves and carry the pasture's mud
        neck = smoothstep(-0.40, -0.80, y) * smoothstep(0.75, 1.0, z)
        c = mix(c, dark, 0.5 * neck * (0.7 + 0.3 * m))
        belly = smoothstep(0.86, 0.64, z) * body
        c = mix(c, light, 0.5 * belly)
        inner = smoothstep(0.16, 0.10, ax) * smoothstep(0.95, 0.6, z) * (y > 0.3) * (1 - tailw)
        c = mix(c, light, 0.45 * inner)
        back = np.exp(-(x / 0.06) ** 2) * smoothstep(1.34, 1.41, z) * (y > -0.55) * (1 - tailw)
        c = mix(c, light * 0.95, 0.3 * back)
        legs = smoothstep(0.62, 0.25, z) * (1 - tailw)
        c = mix(c, srgb(0.31, 0.265, 0.23), 0.6 * legs)
        mud = smoothstep(0.24, 0.06, z) * (0.4 + 0.6 * fbm(P, 25, 2, seed=5)) * (1 - tailw)
        c = mix(c, srgb(0.22, 0.17, 0.12), 0.65 * mud)
        # hair: the colour varies along the lie of the hair
        fl = self.flow(P)
        hn = flow_noise(P, fl, 14.0, 110.0, seed=3)
        hn2 = flow_noise(P, fl, 5.0, 40.0, seed=9)
        c *= (0.90 + 0.14 * hn + 0.08 * (hn2 - 0.5))[:, None]
        r = 0.74 + 0.1 * hn
        # udder and teats: bare pink-grey skin
        ud = smoothstep(0.03, 0.0, self.udder(Pf)) * (z < 0.72) * (1 - tailw) * (1 - legw)
        teat = (z < 0.51) & (np.abs(y - 0.475) < 0.12) & (ax < 0.1)
        ud = np.maximum(ud, teat.astype(float))
        c = mix(c, srgb(0.70, 0.56, 0.52) * (0.9 + 0.2 * m[:, None]), 0.8 * ud)
        r = r * (1 - ud) + 0.5 * ud
        # the switch: coarse dark hair
        sw = smoothstep(0.66, 0.58, z) * tailw
        c = mix(c, srgb(0.13, 0.105, 0.09) * (0.8 + 0.4 * hn[:, None]), sw)
        # hooves and dewclaws: dark horn, a little shiny
        hf = (z < 0.078) | ((z < 0.115) & (np.abs(np.abs(y) - 0.66) < 0.02) & (ax > 0.14))
        c[hf] = srgb(0.12, 0.10, 0.09) * (0.8 + 0.3 * m[hf, None])
        r[hf] = 0.42
        # --- the head
        hx, hs, hh = HEAD.local(P)
        hax = np.abs(hx)
        inh = (hs > -0.05) & (y < -0.9)
        # the face darker toward the muzzle, a paler forehead tuft
        face = smoothstep(0.05, 0.3, hs) * inh
        c = mix(c, dark * 0.95, 0.35 * face)
        tuft = smoothstep(0.1, 0.0, hs) * smoothstep(0.0, 0.06, hh) * inh
        c = mix(c, light * 0.9, 0.25 * tuft)
        # the mealy ring round the muzzle, the slate nose pad in it
        ring = smoothstep(0.355, 0.40, hs) * inh
        c = mix(c, srgb(0.78, 0.74, 0.66) * (0.92 + 0.12 * hn[:, None]), ring)
        nose = smoothstep(0.435, 0.455, hs) * smoothstep(-0.125, -0.105, hh) * inh * (hax < 0.085)
        nose = np.maximum(nose, (smoothstep(0.49, 0.5, hs) * inh))
        nc = srgb(0.15, 0.145, 0.155) * (0.8 + 0.4 * value_noise(P, 600, seed=12)[:, None])
        c = mix(c, nc, nose)
        r = r * (1 - nose) + 0.28 * nose
        # nostrils read darker
        for s in (1, -1):
            e = np.exp(-(((hx - s * 0.037) / 0.013) ** 2 + ((hh + 0.035) / 0.011) ** 2)) * smoothstep(0.48, 0.5, hs)
            c *= (1 - 0.7 * e)[:, None]
        # eyes: dark and wet, a lighter rim of hair round them
        for e in self.eyes:
            d = np.linalg.norm(P - e, axis=1)
            rim = smoothstep(0.045, 0.028, d)
            c = mix(c, light * 0.85, 0.35 * rim)
            ey = smoothstep(0.0225, 0.019, d)
            c = mix(c, srgb(0.035, 0.025, 0.02), ey)
            r = r * (1 - ey) + 0.06 * ey
            lid = smoothstep(0.025, 0.0215, d) * (1 - ey)
            c = mix(c, srgb(0.12, 0.09, 0.08), lid)
        # ears: pale fringe inside the cup, darker rims
        for s, ef in zip((1, -1), self.ear_f):
            de = ef(P.astype(np.float32))
            near = smoothstep(0.012, 0.0, de) * (s * x > 0.1)
            base, d, R = ear_frame(s)
            q = (P - base) @ R
            inside = smoothstep(-0.002, 0.006, q[:, 2]) * near
            c = mix(c, srgb(0.68, 0.63, 0.57) * (0.8 + 0.35 * hn[:, None]), 0.7 * inside)
            tip = smoothstep(0.15, 0.2, q[:, 1]) * near
            c = mix(c, dark * 0.8, 0.5 * tip)
        return np.clip(c, 0, 1), np.clip(r, 0.05, 1), np.zeros(n)

    @staticmethod
    def horn_paint(s):
        H = HEAD
        root = H.p(s * 0.09, 0.03, 0.02)

        def paint(P):
            P = np.asarray(P, np.float64)
            n = len(P)
            t = np.clip(np.linalg.norm(P - root, axis=1) / 0.20, 0, 1)
            c = mix(np.tile(srgb(0.86, 0.80, 0.66), (n, 1)), np.tile(srgb(0.13, 0.11, 0.10), (n, 1)), smoothstep(0.55, 0.95, t))
            rings = 0.5 + 0.5 * np.sin(t * 90 + 2 * value_noise(P, 200, seed=13))
            c *= (0.92 + 0.08 * rings * (1 - t))[:, None]
            c = mix(c, srgb(0.55, 0.47, 0.38), 0.4 * smoothstep(0.2, 0.0, t))
            return c, 0.45 + 0.1 * rings, np.zeros(n)
        return paint

    def strap_paint(self, P):
        P = np.asarray(P, np.float64)
        n = len(P)
        across = (P - STRAP_C) @ STRAP_N
        c = np.tile(srgb(0.17, 0.10, 0.065), (n, 1)) * (0.85 + 0.3 * fbm(P, 60, 3, seed=14)[:, None])
        r = np.full(n, 0.55)
        # stitched edges and a row of pale embroidered flowers down the middle
        stitch = (np.abs(np.abs(across) - 0.034) < 0.0025) & (np.sin(np.arctan2(P[:, 2] - 1.1, P[:, 0]) * 160) > 0)
        c[stitch] = srgb(0.85, 0.80, 0.68)
        ang = np.arctan2(P[:, 2] - STRAP_C[2], P[:, 0])
        cell = np.abs(((ang * 0.22 / 0.035) % 1.0) - 0.5) * 0.035
        flower = (np.sqrt(cell ** 2 + across ** 2) < 0.012) & (np.abs(across) < 0.025)
        petal = flower & (np.cos(np.arctan2(across, cell) * 5) > -0.2)
        c[petal] = srgb(0.88, 0.86, 0.80)
        heart = (np.sqrt(cell ** 2 + across ** 2) < 0.004)
        c[heart] = srgb(0.85, 0.65, 0.20)
        buckle = np.linalg.norm(P - self.buckle_at, axis=1) < 0.03
        c[buckle] = srgb(0.30, 0.29, 0.27) * (0.8 + 0.4 * fbm(P[buckle], 300, 2, seed=18)[:, None])
        m = np.zeros(n)
        m[buckle] = 1.0
        r[buckle] = 0.35
        return c, r, m

    def bell_paint(self, P):
        P = np.asarray(P, np.float64)
        n = len(P)
        a = self.bell_pivot[2] - P[:, 2]
        c = np.tile(srgb(0.66, 0.50, 0.28), (n, 1)) * (0.85 + 0.3 * fbm(P, 90, 3, seed=15)[:, None])
        r = 0.32 + 0.1 * fbm(P, 150, 2, seed=16)
        # cast rings and a dark patina in them; the inside of the mouth dark
        ring = (np.abs(a - 0.07) < 0.0025) | (np.abs(a - 0.10) < 0.002) | (np.abs(a - 0.135) < 0.0025)
        c[ring] *= 0.62
        pat = smoothstep(0.55, 0.8, fbm(P, 40, 3, seed=17))
        c = mix(c, srgb(0.30, 0.33, 0.22), 0.35 * pat)
        r = r + 0.25 * pat
        rad = np.linalg.norm((P - self.bell_pivot)[:, :2], axis=1)
        inside = (a > 0.12) & (rad < 0.048)
        c[inside] = srgb(0.08, 0.06, 0.04)
        loop = a < 0.03
        c[loop] = srgb(0.35, 0.34, 0.32)
        m = np.ones(n)
        m[inside] = 0.3
        return np.clip(c, 0, 1), np.clip(r, 0.1, 1), m


# ------------------------------------------------------------------ skeleton

def skeleton(pivot):
    H = HEAD
    eb, ed, _ = ear_frame(1.0)
    J = {
        "pelvis": ((0, 0.50, 1.20), (0, 0.10, 1.22)),
        "spine": ((0, 0.10, 1.22), (0, -0.28, 1.23)),
        "chest": ((0, -0.28, 1.23), (0, -0.58, 1.26)),
        "neck": ((0, -0.56, 1.12), (0, -0.80, 1.24)),
        "neck.2": ((0, -0.80, 1.24), (0, -1.02, 1.34)),
        "head": ((0, -1.02, 1.34), (0, -1.38, 1.00)),
        "jaw": (H.p(0, 0.08, -0.14), H.p(0, 0.40, -0.14)),
        "ear.L": (eb, eb + ed * 0.21),
        "tail.1": ((0, 0.875, 1.36), (0, 0.965, 1.20)),
        "tail.2": ((0, 0.965, 1.20), (0, 0.99, 0.92)),
        "tail.3": ((0, 0.99, 0.92), (0, 0.985, 0.34)),
        "front.upper.L": ((0.205, -0.66, 0.96), (0.20, -0.52, 0.72)),
        "front.lower.L": ((0.20, -0.52, 0.72), (0.18, -0.585, 0.40)),
        "front.foot.L": ((0.18, -0.585, 0.40), (0.172, -0.625, 0.0)),
        "hind.upper.L": ((0.20, 0.56, 1.02), (0.215, 0.40, 0.72)),
        "hind.lower.L": ((0.215, 0.40, 0.72), (0.18, 0.69, 0.48)),
        "hind.foot.L": ((0.18, 0.69, 0.48), (0.17, 0.60, 0.0)),
        "cow.bell": (tuple(pivot), tuple(np.asarray(pivot) + (0, 0, -0.16))),
    }
    return L.Skeleton(Q.bones(neck2=True, extra=[("cow.bell", "neck.2")]), J)


def weights(sc, names):
    """Bone heat, corrected where a sculpt's parts touch but must not move
    together: the tail hangs against the buttocks, the ears against the
    head, the jaw under it."""
    it = {b: i for i, b in enumerate(names)}
    tail_i = [it["tail.1"], it["tail.2"], it["tail.3"]]
    ear_i = [it["ear.L"], it["ear.R"]]

    def override(ob, V, W):
        V = np.asarray(V, np.float32)
        W = W.copy()
        dt = S.Union([sc.tail_f, sc.switch], k=0.03)(V)
        dr = sc.rest(V)
        is_tail = (dt < dr) & (V[:, 2] < 1.33)
        W[np.ix_(~is_tail, tail_i)] = 0.0
        # a tail vertex follows only the tail (the root blends into the pelvis)
        keep = np.zeros(W.shape[1], bool)
        keep[tail_i] = True
        keep[it["pelvis"]] = True
        W[np.ix_(is_tail, ~keep)] = 0.0
        W[is_tail] += 1e-4 * np.eye(W.shape[1])[tail_i[0]]
        for s, ef, ei in zip((1, -1), sc.ear_f, ear_i):
            de = ef(V)
            is_ear = (de < dr) & (s * V[:, 0] > 0.05)
            others = np.ones(W.shape[1], bool)
            others[[ei, it["head"]]] = False
            W[np.ix_(is_ear, others)] = 0.0
            W[np.ix_(~is_ear, [ei])] = 0.0
            # the far part of the ear is all ear
            far = is_ear & (np.abs(V[:, 0]) > 0.17)
            W[np.ix_(far, [it["head"]])] = 0.0
            W[far, ei] = np.maximum(W[far, ei], 1.0)
        # the jaw: the lower half of the face below the mouth line
        hx, hs, hh = HEAD.local(V)
        jw = smoothstep(-0.085, -0.115, hh) * smoothstep(0.1, 0.2, hs) * (hs < 0.56) * (np.abs(hx) < 0.14)
        hw = W[:, it["head"]] + W[:, it["jaw"]]
        W[:, it["jaw"]] = hw * jw
        W[:, it["head"]] = hw * (1 - jw)
        return W
    return override


# ------------------------------------------------------------------ clips

WALK_SPEED = 0.9     # m/s
WALK_T = 1.2


def rest(body, **kw):
    return body.rest(**kw)


def graze_pose(body, reach=0.0, sweep=0.0):
    """Head down in the grass: the forehand lowered a little, the lower neck
    and the upper neck bent, the face nearly vertical, muzzle at the turf."""
    return dict(root=(0, -0.01, -0.035), pelvis=(4.0, 0, 0), chest=(2.0, 0, 0),
                neck=(34 + 3 * reach, 0, 4 * sweep), **{"neck.2": (46 + 4 * reach, 0, 6 * sweep)},
                head=(-38 - 2 * reach, 0, 3 * sweep), jaw=(2, 0, 0))


def clip_graze(body):
    """8 s loop: tearing grass - a quick sideways rip of the head every couple
    of seconds, chewing between, the muzzle wandering across the turf; a front
    hoof steps forward and later back; a hind hoof stamps at a fly; the tail
    swishes; the ears flick."""
    T = 8.0
    c = L.Clip("cow.graze", T, True)
    fl0 = Vector(body.foot0["fl"])
    hr0 = Vector(body.foot0["hr"])
    keys = [(0.0, 0.0, 0.0), (1.4, 0.4, 0.5), (2.6, 0.8, 0.2), (3.8, 1.0, -0.4), (5.2, 0.6, -0.8), (6.6, 0.2, -0.3), (8.0, 0.0, 0.0)]
    for t, reach, sweep in keys:
        p = rest(body, **graze_pose(body, reach, sweep))
        c.kd(t, p, "inout")
    # the step: front left forward 14 cm (2.9-3.4 s), back again (6.2-6.7 s)
    step = Vector((0, -0.14, 0))
    for t, off, lift in ((0, 0, 0), (2.9, 0, 0), (3.15, 0.5, 0.1), (3.4, 1, 0), (6.2, 1, 0), (6.45, 0.5, 0.09), (6.7, 0, 0), (8.0, 0, 0)):
        c.kd(t, {"ik.fl": tuple(fl0 + step * off + Vector((0, 0, lift))), "rot.fl": (60 * lift / 0.1, 0, 0)}, "inout")
    # a stamp of the right hind at a fly
    for t, lift in ((0, 0), (4.6, 0), (4.72, 0.08), (4.9, 0), (8.0, 0)):
        c.kd(t, {"ik.hr": tuple(hr0 + Vector((0, 0.02 * lift / 0.08, lift))), "rot.hr": (40 * lift / 0.08, 0, 0)}, "out" if lift else "in")

    def tear(t, pose):
        # rips: the head snaps sideways and up, the jaw had closed on the grass
        for t0, side in ((0.9, 1), (2.3, -1), (4.1, 1), (5.9, -1), (7.3, 1)):
            e = pulse(t, t0, 0.09, 0.05, 0.35)
            add(pose, "neck.2", (-5 * e, 0, 4 * side * e))
            add(pose, "head", (-9 * e, 3 * side * e, 9 * side * e))
            pre = pulse(t, t0 - 0.35, 0.2, 0.1, 0.1)
            add(pose, "jaw", (7 * pre, 0, 0))
    c.layers += [tear, Q.chew(5, 2.5, 1.5, T=T),
                 Q.swish([(1.2, 1, 0.9), (4.4, -1, 1.0), (7.0, 1, 0.7)], amp=(0, 6, 28)),
                 Q.flicks([(0.7, 0, (0, 0, -30), 0.35), (2.8, 1, (0, 0, -35), 0.4), (5.5, 2, (15, 0, -25), 0.45), (6.9, 0, (-20, 0, 20), 0.5)]),
                 Q.drift(T, {"ear.L": (4, 4, 6), "ear.R": (4, 4, 6), "tail.3": (0, 0, 4)}, seed=5)]
    c.post.append(L.pendulum("cow.bell", damping=1.2, max_deg=40, gain=1.25))
    return c


def clip_walk(body):
    """0.9 m/s lateral-sequence walk (1.2 s cycle, 1.08 m stride): hooves
    planted and travelling back at walking speed, the front hooves flipping
    up as the knees fold, the head nodding twice a cycle, the bell swinging."""
    T, v = WALK_T, WALK_SPEED
    c = L.Clip("cow.walk", T, True)
    p = rest(body, neck=(8, 0, 0), **{"neck.2": (6, 0, 0)}, head=(-6, 0, 0))
    c.kd(0, p).kd(T, p)
    flex = {"f": [(0.35, 92.0), (0.78, -8.0), (1.0, 0.0)], "h": [(0.3, 30.0), (0.75, -12.0), (1.0, 0.0)]}
    c.layers.append(Q.gait(body, T, v, Q.WALK_PHASE, (0.64, 0.64), flex, (0.05, 0.04), toe=0.055, breakover=(30, 24)))
    c.layers.append(Q.walk_body(T, (0.64, 0.64), bob=0.018, body_len=1.05, roll=2.2, sway=0.015, yaw=1.6, nod=4.5, tail=7))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.WALK_PHASE, 0.64, 0.055))
    c.layers.append(Q.flicks([(0.3, 0, (0, 0, -20), 0.3)]))
    c.post.append(L.pendulum("cow.bell", damping=1.0, max_deg=40, gain=1.3))
    return c


def clip_idle(body):
    """6 s loop standing: chewing the cud, looking about, ears and tail busy."""
    T = 6.0
    c = L.Clip("cow.idle", T, True)
    a = rest(body, neck=(6, 0, 0), **{"neck.2": (2, 0, 0)}, head=(-4, 0, 0))
    b = rest(body, neck=(4, 0, 10), **{"neck.2": (0, 0, 14)}, head=(-8, 4, 10))
    d = rest(body, neck=(8, 0, -6), **{"neck.2": (4, 0, -8)}, head=(-2, -3, -8))
    for t, p in ((0, a), (1.6, a), (2.3, b), (3.5, b), (4.2, d), (5.2, d), (6.0, a)):
        c.kd(t, p, "inout")
    c.layers += [Q.chew(4, 3, 1.3, T=T), Q.breathe(T, 0.3, 0.5),
                 Q.swish([(0.8, 1, 1.0), (3.9, -1, 1.1)], amp=(0, 6, 26)),
                 Q.flicks([(1.1, 1, (0, 0, -30), 0.35), (2.9, 0, (10, 0, 25), 0.4), (4.7, 2, (0, 0, -25), 0.4)]),
                 Q.drift(T, {"ear.L": (4, 3, 5), "ear.R": (4, 3, 5), "pelvis": (0, 0.6, 0.6)}, seed=9)]
    c.post.append(L.pendulum("cow.bell", damping=1.2, max_deg=40, gain=1.25))
    return c


def clip_look_up(body):
    """1.8 s, from grazing: the head stops chewing, comes up and settles
    looking straight ahead (+Z in glTF) and 14 degrees up - at a player 60 m
    above a cow 250 m away. The last frame holds (the game clamps it)."""
    T = 1.8
    c = L.Clip("cow.look_up", T, False)
    g = rest(body, **graze_pose(body, 0.0, 0.0))
    dip = rest(body, **graze_pose(body, 0.3, 0.0))
    up = rest(body, root=(0, 0, 0.0), pelvis=(-1.0, 0, 0), neck=(-10, 0, 0), **{"neck.2": (-12, 0, 0)}, head=(-2, 0, 0))
    over = rest(body, root=(0, 0, 0.005), pelvis=(-1.5, 0, 0), neck=(-12, 0, 3), **{"neck.2": (-15, 0, 5)}, head=(-4, 2, 4))
    c.kd(0.0, g).kd(0.12, dip, "inout").kd(0.62, over, "out").kd(1.05, up, "inout").kd(T, up, "linear")
    ears_fwd = {"ear.L": (-25, 0, 22), "ear.R": (-25, 0, -22)}
    c.kd(0.0, {"ear.L": (0, 0, 0), "ear.R": (0, 0, 0)}).kd(0.5, {"ear.L": (0, 0, 0), "ear.R": (0, 0, 0)})
    c.kd(0.8, ears_fwd, "back").kd(T, ears_fwd, "linear")
    c.kd(0.0, {"jaw": (2, 0, 0)}).kd(0.3, {"jaw": (0, 0, 0)}).kd(T, {"jaw": (0, 0, 0)})
    c.layers += [Q.swish([(0.5, -1, 0.8)], amp=(0, 5, 18)), Q.flicks([(1.35, 1, (0, 0, -18), 0.3)])]
    c.post.append(L.pendulum("cow.bell", damping=1.4, max_deg=40, gain=1.2))
    return c


CLIPS = [clip_idle, clip_graze, clip_walk, clip_look_up]


# ------------------------------------------------------------------ build

def build(quick=False, size=1024):
    """Sculpt, mesh, bake, rig, weight and animate the cow. Returns her
    armature (the glTF root `cow`) and her one skinned mesh `cow.body`."""
    with L.stage("cow: sculpt"):
        sc = Sculpt()
    lo, hi = (-0.62, -1.50, -0.01), (0.62, 1.12, 1.62)
    with L.stage("cow: game meshes"):
        body_ob = L.sculpt_mesh("cow.body", sc.body, lo, hi, 0.010 if quick else 0.0055, 2400 if quick else 4800)
        jobs = [dict(ob=body_ob, field=sc.detailed, paint=sc.paint, weight=1.0, parts=sc.parts())]
        for i, (s, h) in enumerate(zip((1, -1), sc.horns)):
            ob = L.sculpt_mesh(f"cow.horn.{'LR'[i]}", h, h.lo - 0.01, h.hi + 0.01, 0.0022, 110, symmetry=False)
            jobs.append(dict(ob=ob, field=h, paint=sc.horn_paint(s), weight=2.0, skin="head"))
        ob = L.sculpt_mesh("cow.strap", sc.collar, STRAP_C - 0.34, STRAP_C + 0.34, 0.0028, 560)
        jobs.append(dict(ob=ob, field=sc.collar, paint=sc.strap_paint, weight=2.2))
        p = sc.bell_pivot
        ob = L.sculpt_mesh("cow.bellmesh", sc.bell, p - (0.1, 0.1, 0.22), p + (0.1, 0.1, 0.03), 0.002, 380)
        jobs.append(dict(ob=ob, field=sc.bell, paint=sc.bell_paint, weight=2.6, skin="cow.bell"))
    with L.stage("cow: atlas"):
        imgs, at = L.bake_atlas(jobs, 512 if quick else size, "cow", sc.all, ao_scale=2.2, ao_strength=0.9)
    L.save_atlas_previews(imgs, L.ATLAS_DIR, "cow")
    mat = L.material("cow", imgs)
    skel = skeleton(sc.bell_pivot)
    rig = skel.create("cow")
    with L.stage("cow: weights"):
        # the bell's bone must not take the throat's skin in bone heat
        rig.data.bones["cow.bell"].use_deform = False
        L.skin_jobs(jobs, rig, skel.names, sc.body, lo, hi, res=0.016 if quick else 0.011, override=weights(sc, skel.names))
        rig.data.bones["cow.bell"].use_deform = True
    tris = sum(L.bl.tri_count(j["ob"]) for j in jobs)
    mesh = L.finish_mesh("cow.body", jobs, mat)
    body = L.Body(skel, Q.LEGS)
    with L.stage("cow: clips"):
        acts = [L.bake_clip(body, mk(body), rig) for mk in CLIPS]
    L.stash(rig, acts)
    rig["speeds"] = {"cow.walk": WALK_SPEED}
    return dict(rig=rig, mesh=mesh, tris=tris, images=imgs, clips=[a.name for a in acts])
