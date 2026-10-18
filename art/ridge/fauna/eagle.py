"""The eagle: a golden eagle that circles high over the valley - and, for the
secret, lands on the rock two metres in front of the scope and stares.

That landing is the closest anything in the game comes to the player, so the
head is built for a close-up at a metre: a hooked bill, dark at the tip and
horn-grey at the base, a yellow cere and gape, the brow ridge shading a
hazel eye, gold hackles on the nape, small overlapping feathers everywhere
(relief in the normal map, paler edges in the colour).

Two sets of wings live in the one skinned mesh:
- spread wings (flight, the flare) on wing.1-3.L/R, primaries fingered;
- folded wings, sculpted lying along the back with the primaries crossed
  over the tail, on fold.L/R (the stare).
A folded wing is not a spread wing bent: feathers slide over each other, a
mesh cannot. So the set not in use is scaled to nothing (its bone scale
0.001: its vertices collapse to the shoulder, inside the body), and `land`
swaps them in the middle of folding (see SWAP).

Rest pose (Blender): flight attitude, facing -Y, the body level, wings
spread, legs down, the feet on z = 0 at the origin. Perched, the body tilts
45 degrees nose-up about the hips and the neck brings the head level.
"""
import math
import numpy as np
from . import lib as L
from .lib import S, A, srgb, smoothstep, value_noise, fbm, Frame, nrm, chain, flow_noise, add

NAME = "eagle"
HEAD = Frame((0, -0.255, 0.385), (0, -1.0, -0.08))
LAND = dict(touch=1.2, swap=1.85, stare=2.6, duration=3.0)
SIDES = (("L", 1.0), ("R", -1.0))

# the spread wing's planform (left wing: x out along the span, y back along the chord)
LE = [(0.02, -0.10), (0.10, -0.115), (0.25, -0.125), (0.44, -0.125), (0.60, -0.105), (0.745, -0.08)]
TE = [(0.765, 0.10), (0.66, 0.20), (0.52, 0.27), (0.36, 0.29), (0.20, 0.27), (0.08, 0.22), (0.02, 0.16)]
# the fingered primaries, outermost first: (base x, base y, angle back from +x in degrees, length)
FINGERS = [(0.70, -0.075, -9.0, 0.30), (0.71, -0.035, 0.0, 0.33), (0.72, 0.005, 9.0, 0.33),
           (0.72, 0.045, 19.0, 0.31), (0.71, 0.085, 29.0, 0.27), (0.69, 0.12, 39.0, 0.22)]


def zc(x):
    """Height of the spread wing's mid-surface: a shallow V and upswept tips."""
    x = np.abs(np.asarray(x, float))
    return 0.36 + (x - 0.02) * math.tan(math.radians(6.0)) + 0.05 * smoothstep(0.5, 1.02, x) ** 2


def y_le(x):
    return np.interp(np.abs(x), [p[0] for p in LE], [p[1] for p in LE])


def mix(a, b, t):
    t = np.asarray(t, float)[:, None]
    return a * (1 - t) + b * t


def poly_sd(P2, poly):
    """Signed distance to a closed 2D polygon (negative inside), vectorised."""
    poly = np.asarray(poly, float)
    d = np.full(len(P2), np.inf)
    inside = np.zeros(len(P2), bool)
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        e = b - a
        w = P2 - a
        t = np.clip((w @ e) / (e @ e), 0, 1)
        q = w - t[:, None] * e
        d = np.minimum(d, (q * q).sum(1))
        c1 = P2[:, 1] >= a[1]
        c2 = P2[:, 1] < b[1]
        c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        inside ^= flip
    return np.sqrt(d) * np.where(inside, -1.0, 1.0)


class Wing(S.Node):
    """A spread wing: the planform extruded to an airfoil (thick along the
    leading edge where the arm bones and coverts are, thin at the trailing
    edge), bent to the dihedral. s = +1 left, -1 right."""

    def __init__(self, s):
        self.s = s
        self.poly = LE + TE
        x0, x1 = (0.0, 0.8) if s > 0 else (-0.8, 0.0)
        self.lo = np.array([x0, -0.2, 0.28], np.float32)
        self.hi = np.array([x1, 0.35, 0.52], np.float32)

    def thick(self, X, Y):
        lead = np.exp(-((Y - y_le(X) - 0.035) / 0.065) ** 2)
        t = 0.005 + 0.016 * lead * (1 - 0.6 * smoothstep(0.3, 0.8, X))
        return t + 0.02 * smoothstep(0.16, 0.02, X)

    def eval(self, P):
        P = np.asarray(P, np.float64)
        X = self.s * P[:, 0]
        d2 = poly_sd(np.stack([X, P[:, 1]], 1), self.poly)
        dz = np.abs(P[:, 2] - zc(X)) - self.thick(X, P[:, 1])
        return np.where((d2 > 0) & (dz > 0), np.sqrt(d2 * d2 + dz * dz), np.maximum(d2, dz)).astype(np.float32)


def finger_fields(s):
    out = []
    for bx, by, ang, ln in FINGERS:
        a = math.radians(ang)
        d = np.array([s * math.cos(a), math.sin(a), 0.0])
        c2 = np.array([s * bx, by, 0.0]) + d * ln * 0.5
        slope = (zc(abs(c2[0]) + 0.01) - zc(abs(c2[0]) - 0.01)) / 0.02 + 0.12
        d3 = nrm(d + np.array([0, 0, slope * abs(d[0])]))
        c = np.array([c2[0], c2[1], zc(c2[0])])
        R = L.frame_from(d3, up=(0, 0, 1))
        out.append(S.Ellipsoid(c, (0.024, ln * 0.5, 0.0058), R))
    return S.Union(out)


def folded_field(s):
    """A folded wing lying along the back and flank, the wrist knob in front,
    the primaries crossing over the tail."""
    panel = S.Ellipsoid((s * 0.064, 0.10, 0.35), (0.028, 0.25, 0.08), S.rot_y(-38 * s))
    wrist = S.Ellipsoid((s * 0.076, -0.095, 0.35), (0.027, 0.048, 0.032))
    prim = S.Ellipsoid((s * 0.022, 0.37, 0.362), (0.02, 0.16, 0.026), S.rot_z(8 * s) @ S.rot_y(-25 * s))
    return S.Union([panel, wrist, prim], k=0.03)


def bill_field():
    """The hooked upper bill and the lower mandible, narrow from the side."""
    H = HEAD
    up = chain([H.p(0, 0.050, 0.012), H.p(0, 0.075, 0.010), H.p(0, 0.094, 0.0), H.p(0, 0.104, -0.016), H.p(0, 0.102, -0.031)],
               [0.016, 0.0135, 0.010, 0.006, 0.0014], n=16)
    lo = chain([H.p(0, 0.046, -0.013), H.p(0, 0.064, -0.0155), H.p(0, 0.075, -0.017)], [0.0088, 0.0058, 0.0024], n=8)
    both = S.Union([up, lo], k=0.004)
    o = H.p(0, 0.07, 0)
    k = np.array([1 / 0.72, 1.0, 1.0], np.float32)
    return S.Fn(lambda P: both(o + (np.asarray(P, np.float32) - o) * k) * 0.8, both.lo - 0.01, both.hi + 0.01)


def march_out(field, start, d, reach=0.1):
    """The first point outside `field` going from `start` along `d`."""
    t = np.linspace(0, reach, 2000)
    P = (np.asarray(start)[None, :] + t[:, None] * np.asarray(d)[None, :]).astype(np.float32)
    return P[int(np.argmax(field(P) > 0))].astype(float)


def toe_fields(s):
    """Three toes forward and one back, feathered tarsus above; black talons."""
    base = np.array([s * 0.05, -0.005, 0.02])
    toes, talons = [], []
    for ang, ln in ((-18, 0.05), (0, 0.055), (18, 0.048), (180, 0.036)):
        a = math.radians(ang)
        d = np.array([s * math.sin(a), -math.cos(a), -0.12])
        d /= np.linalg.norm(d)
        end = base + d * ln
        toes.append(chain([base, base + d * ln * 0.5 + (0, 0, 0.004), end], [0.0095, 0.0085, 0.0068], n=6))
        dd = d.copy()
        dd[2] = 0
        dd /= np.linalg.norm(dd)
        talons.append(chain([end, end + dd * 0.012 + (0, 0, -0.002), end + dd * 0.019 + (0, 0, -0.012)], [0.0058, 0.0042, 0.0008], n=8))
    return S.Union(toes, k=0.006), S.Union(talons, k=0.002)


class Sculpt:
    def __init__(self):
        H = HEAD
        core = S.Ellipsoid((0, 0.0, 0.32), (0.095, 0.16, 0.085))
        chest = S.Ellipsoid((0, -0.085, 0.305), (0.085, 0.09, 0.085))
        mantle = S.Ellipsoid((0, 0.03, 0.36), (0.08, 0.14, 0.05))
        vent = S.Ellipsoid((0, 0.14, 0.295), (0.05, 0.08, 0.04))
        neck = S.RoundCone((0, -0.12, 0.335), (0, -0.215, 0.378), 0.056, 0.043)
        self.tail = S.Ellipsoid((0, 0.30, 0.31), (0.07, 0.17, 0.011))
        self.torso = S.Union([core, chest, mantle, vent, neck], k=0.04)
        # head: a flat crown, the face narrowing to the bill; the eyes are
        # seated on the head's own surface (found by marching out to it) so
        # they bulge a little, and the brow ridge juts out over each
        skull = S.Ellipsoid(H.p(0, 0.0, 0.0), (0.035, 0.052, 0.035), H.R)
        crown = S.Ellipsoid(H.p(0, 0.012, 0.018), (0.032, 0.045, 0.02), H.R)
        face = [S.Ellipsoid(H.p(s * 0.014, 0.03, -0.012), (0.023, 0.031, 0.026), H.R) for s in (1, -1)]
        cere = S.Ellipsoid(H.p(0, 0.054, 0.004), (0.016, 0.013, 0.015), H.R)
        hackles = S.Ellipsoid(H.p(0, -0.03, 0.006), (0.042, 0.05, 0.04), H.R)
        self.bill = bill_field()
        skullf = S.Union([skull, crown, hackles] + face, k=0.02)
        self.eyes, brows = [], []
        for s in (1, -1):
            start = H.p(0, 0.030, 0.004)
            out = nrm(H.X * s * 0.88 + H.S * 0.47)
            surf = march_out(skullf, start, out)
            e = surf - out * 0.0045
            self.eyes.append(e)
            b = e + H.H * 0.0102 + out * 0.0035 - H.S * 0.002
            # tilted down toward the bill: a frown, not a worried look
            brows.append(S.Ellipsoid(b, (0.0125, 0.030, 0.0046), H.R @ S.rot_y(-16 * s)))
        eyes = [S.Sphere(e, 0.0093) for e in self.eyes]
        head = S.Union([skullf, cere] + brows, k=0.008)
        head = S.Union([head] + eyes, k=0.0025)
        self.head = S.Union([head, self.bill], k=0.004)
        # legs: feathered trousers and tarsi, bare yellow toes, black talons
        legs, self.toes, self.talons = [], [], []
        for _, s in SIDES:
            thigh = S.Ellipsoid((s * 0.05, 0.035, 0.235), (0.042, 0.055, 0.07))
            tars = S.RoundCone((s * 0.05, 0.045, 0.165), (s * 0.05, 0.0, 0.035), 0.024, 0.018)
            toes, tal = toe_fields(s)
            legs.append(S.Union([thigh, tars], k=0.03))
            self.toes.append(toes)
            self.talons.append(tal)
        self.legs = legs
        feet = S.Union(self.toes + self.talons, k=0.002)
        body = S.Union([self.torso, self.tail], k=0.03)
        body = S.Union([body] + legs, k=0.03)
        body = S.Union([body, self.head], k=0.02)
        self.body = S.Union([body, feet], k=0.008)
        self.rest = self.body
        self.wings = [Wing(s) for _, s in SIDES]
        self.fingers = [finger_fields(s) for _, s in SIDES]
        self.spread = [S.Union([w, f], k=0.01) for w, f in zip(self.wings, self.fingers)]
        self.folded = [folded_field(s) for _, s in SIDES]
        self.all = S.Union([self.body] + self.folded)

    # -- relief: feathers everywhere, finer on the head
    def regions(self, Q):
        """Per texel (once): which part it is on, and the feather coordinates."""
        Qf = np.asarray(Q, np.float32)
        dh = self.head(Qf)
        db = np.minimum(self.torso(Qf), self.tail(Qf))
        dl = np.min([lg(Qf) for lg in self.legs], axis=0)
        dt = np.min([t(Qf) for t in self.toes + self.talons], axis=0)
        dbl = self.bill(Qf)
        near = np.minimum.reduce([dh, db, dl, dt])
        return dict(head=dh <= near + 0.001, bill=dbl <= near + 0.0015, feet=dt <= near + 0.001,
                    leg=dl <= near + 0.001, tail=self.tail(Qf) <= near + 0.001)

    @staticmethod
    def feather_uv(P, part):
        """(u along the lie of the feathers, v across), metres, jittered so the
        rows wander like real plumage rather than tiling like scales."""
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        if part == "head":
            hx, hs, hh = HEAD.local(P)
            u, v, k = -hs, np.arctan2(hx, hh) * 0.035, 0.011
        elif part == "leg":
            u, v, k = -z, np.arctan2(np.abs(x) - 0.05, y - 0.03) * 0.045, 0.018
        else:
            u, v, k = y, np.arctan2(x, z - 0.32) * 0.09, 0.034
        ju = value_noise(P, 1.0 / (2.5 * k), seed=88) - 0.5
        jv = value_noise(P * 1.37, 1.0 / (2.5 * k), seed=89) - 0.5
        return u + 0.4 * k * ju, v + 0.4 * k * jv

    @staticmethod
    def cells(u, v, Lf, Wf, seed=0):
        """Overlapping feathers: fu 0 at a feather's hidden base to 1 at its
        rounded tip, which lies over the next row; edge > 0 inside the tip's arc."""
        iu = np.floor(u / Lf)
        fu = u / Lf - iu
        vv = v / Wf + 0.5 * (iu % 2)
        iv = np.floor(vv)
        fv = vv - iv
        tip = 1.0 - 0.45 * (2 * fv - 1) ** 2
        edge = tip - fu
        h = np.clip(fu / np.maximum(tip, 1e-3), 0, 1) * smoothstep(0.0, 0.12, edge)
        rnd = (np.sin(iu * 12.9898 + iv * 78.233 + seed) * 43758.5453) % 1.0
        return h, edge, fv, rnd

    def detail(self, P, reg):
        P = np.asarray(P, np.float64)
        d = np.zeros(len(P))
        for part, Lf, Wf, amp in (("head", 0.011, 0.0085, 0.0006), ("leg", 0.018, 0.014, 0.0008), ("body", 0.034, 0.028, 0.0011)):
            if part == "head":
                m = reg["head"] & ~reg["bill"]
            elif part == "leg":
                m = reg["leg"] & ~reg["feet"]
            else:
                m = ~(reg["head"] | reg["leg"] | reg["feet"])
            if not m.any():
                continue
            u, v = self.feather_uv(P[m], part)
            h, edge, fv, rnd = self.cells(u, v, Lf, Wf)
            rachis = np.exp(-((fv - 0.5) / 0.05) ** 2) * 0.25
            d[m] += amp * (h + rachis * h)
        return (-d).astype(np.float32)

    def paint(self, P):
        P = np.asarray(P, np.float64)
        n = len(P)
        reg = self.regions(P)
        y, z = P[:, 1], P[:, 2]
        brown = srgb(0.20, 0.13, 0.08)
        edge_c = srgb(0.36, 0.25, 0.15)
        gold = srgb(0.74, 0.54, 0.27)
        c = np.tile(brown, (n, 1)) * (0.85 + 0.3 * fbm(P, 8, 3, seed=81)[:, None])
        r = np.full(n, 0.72)
        # feathers: dark centres, paler worn edges at their tips
        for part, Lf, Wf in (("head", 0.011, 0.0085), ("leg", 0.018, 0.014), ("body", 0.034, 0.028)):
            if part == "head":
                m = reg["head"] & ~reg["bill"]
            elif part == "leg":
                m = reg["leg"] & ~reg["feet"]
            else:
                m = ~(reg["head"] | reg["leg"] | reg["feet"])
            if not m.any():
                continue
            u, v = self.feather_uv(P[m], part)
            h, edge, fv, rnd = self.cells(u, v, Lf, Wf)
            rim = smoothstep(0.14, 0.0, edge) * (edge > -0.02)
            cm = c[m] * (0.82 + 0.3 * rnd[:, None])
            c[m] = mix(cm, edge_c * (0.8 + 0.3 * rnd[:, None]), 0.3 * rim)
            c[m] *= (0.88 + 0.15 * h)[:, None]
        # the golden nape and crown, streaked
        hx, hs, hh = HEAD.local(P)
        nape = reg["head"] * smoothstep(0.035, -0.02, hs) * smoothstep(-0.02, 0.02, hh + 0.4 * (hs + 0.02))
        nape = np.maximum(nape, smoothstep(-0.20, -0.235, y) * smoothstep(0.37, 0.40, z) * (~reg["head"]))
        streak = 0.75 + 0.35 * flow_noise(P, np.tile(np.array([0, 1.0, -0.2]), (n, 1)), 30, 400, seed=82)
        c = mix(c, gold * streak[:, None], 0.85 * np.clip(nape, 0, 1))
        # tawny trousers
        legm = reg["leg"] & ~reg["feet"]
        c[legm] = mix(c[legm], srgb(0.50, 0.36, 0.20), 0.6 * np.ones(legm.sum()))
        # the face: dark lores, the bill horn-grey to a black tip, yellow cere and gape
        face = reg["head"] & (hs > 0.01)
        c[face] *= 0.8
        bill = reg["bill"]
        tipness = smoothstep(0.07, 0.1, hs)
        bc = mix(np.tile(srgb(0.46, 0.48, 0.52), (n, 1)), np.tile(srgb(0.08, 0.08, 0.09), (n, 1)), tipness)
        c[bill] = bc[bill]
        r[bill] = 0.28
        ce = (hx / 0.0155) ** 2 + ((hs - 0.056) / 0.0125) ** 2 + ((hh - 0.004) / 0.014) ** 2
        cere = smoothstep(1.25, 1.0, ce) * smoothstep(-0.006, -0.002, hh) * reg["head"] * (~bill)
        gline = np.abs(hh + 0.0085 + 0.08 * (hs - 0.05))
        gape = smoothstep(0.0018, 0.0008, gline) * smoothstep(0.040, 0.044, hs) * smoothstep(0.055, 0.050, hs) * reg["head"] * (~bill)
        yellow = srgb(0.93, 0.74, 0.26) * (0.9 + 0.15 * value_noise(P, 800, seed=83)[:, None])
        yl = np.clip(np.maximum(cere, 0.0 * gape), 0, 1)
        c = mix(c, yellow, yl)
        r = r * (1 - yl) + 0.45 * yl
        # eyes: hazel-gold iris, dark ring, pupil looking forward, wet
        for e in self.eyes:
            q = P - e
            dist = np.linalg.norm(q, axis=1)
            ey = smoothstep(0.0101, 0.0095, dist)
            side = np.sign(e[0])
            look = nrm(HEAD.S * 0.8 + np.array([side, 0, 0]) * 0.5)
            a = np.degrees(np.arccos(np.clip((q @ look) / np.maximum(dist, 1e-6), -1, 1)))
            iris = srgb(0.58, 0.35, 0.11) * (0.8 + 0.4 * value_noise(np.stack([a * 0.3, np.arctan2(q[:, 2], q[:, 0]) * 5, a * 0], 1), 1.0, seed=84)[:, None])
            ec = mix(iris, srgb(0.10, 0.06, 0.03) * np.ones((n, 1)), smoothstep(52, 60, a))
            ec = mix(ec, srgb(0.01, 0.01, 0.01) * np.ones((n, 1)), smoothstep(24, 20, a))
            c = mix(c, ec, ey)
            r = r * (1 - ey) + 0.05 * ey
            lid = smoothstep(0.0118, 0.0101, dist) * (1 - ey)
            c = mix(c, srgb(0.10, 0.08, 0.06), lid)
        # feet: yellow scaled toes, black glossy talons
        feet = reg["feet"]
        tal = np.min([t(P.astype(np.float32)) for t in self.talons], axis=0) <= np.min([t(P.astype(np.float32)) for t in self.toes], axis=0)
        scales = 0.85 + 0.2 * value_noise(P, 900, seed=85)
        c[feet] = yellow[feet] * scales[feet, None]
        r[feet] = 0.5
        tm = feet & tal
        c[tm] = srgb(0.05, 0.05, 0.05)
        r[tm] = 0.25
        # tail: grey-brown with faint darker bands and a dark tip
        tl = reg["tail"]
        band = 0.5 + 0.5 * np.sin((y - 0.13) * 2 * math.pi / 0.06)
        tc = mix(np.tile(srgb(0.30, 0.25, 0.20), (n, 1)), np.tile(srgb(0.17, 0.12, 0.08), (n, 1)), 0.35 * band + 0.6 * smoothstep(0.40, 0.46, y))
        c[tl] = tc[tl] * (0.9 + 0.2 * fbm(P[tl], 30, 2, seed=86)[:, None])
        return np.clip(c, 0, 1), np.clip(r, 0.05, 1), np.zeros(n)

    # -- wings
    def wing_paint(self, s, folded=False):
        def paint(P):
            P = np.asarray(P, np.float64)
            n = len(P)
            X = s * P[:, 0]
            y = P[:, 1]
            if folded:
                # the folded wing: coverts in front, the long flight feathers behind
                chord = np.clip((y + 0.15) / 0.62, 0, 1)
                top = np.ones(n, bool)
            else:
                le = y_le(X)
                chord = np.clip((y - le) / np.maximum(0.40 - 0.15 * smoothstep(0.5, 0.8, X), 0.05), 0, 1.3)
                top = P[:, 2] >= zc(X)
            coverts = smoothstep(0.62, 0.48, chord)
            u, v = y, X
            h, edge, fv, rnd = self.cells(u, v, 0.04, 0.034, seed=3)
            brown = srgb(0.19, 0.12, 0.075)
            flight = srgb(0.12, 0.085, 0.06)
            c = mix(np.tile(flight, (n, 1)), np.tile(brown, (n, 1)), coverts)
            c *= (0.85 + 0.3 * (coverts * rnd + (1 - coverts) * 0.5))[:, None]
            rim = smoothstep(0.16, 0.0, edge) * coverts
            c = mix(c, srgb(0.34, 0.24, 0.14), 0.45 * rim)
            # the pale tawny bar across the upper-wing coverts
            bar = smoothstep(0.12, 0.2, chord) * smoothstep(0.45, 0.33, chord) * smoothstep(0.55, 0.40, X) * top
            c = mix(c, srgb(0.52, 0.38, 0.22) * (0.85 + 0.3 * rnd[:, None]), (0.35 if folded else 0.75) * bar)
            # grey barring on the flight feathers (seen best from below)
            barring = (1 - coverts) * (0.5 + 0.5 * np.sin(chord * 2 * math.pi * 7 + X * 3))
            c = mix(c, srgb(0.36, 0.33, 0.30), 0.35 * barring * np.where(top, 0.4, 1.0))
            if not folded:
                fing = X > 0.72
                c[fing] = srgb(0.07, 0.055, 0.045) * (0.85 + 0.2 * fbm(P[fing], 60, 2, seed=87)[:, None])
            return np.clip(c, 0, 1), np.full(n, 0.7), np.zeros(n)
        return paint

    def wing_relief(self, s, folded=False):
        def h(P, _):
            P = np.asarray(P, np.float64)
            X = s * P[:, 0]
            y = P[:, 1]
            if folded:
                chord = np.clip((y + 0.15) / 0.62, 0, 1)
            else:
                chord = np.clip((y - y_le(X)) / 0.4, 0, 1.3)
            coverts = smoothstep(0.62, 0.48, chord)
            hh, edge, fv, rnd = self.cells(y, X, 0.04, 0.034, seed=3)
            # flight feathers: long vanes side by side, a shaft down each
            fw = 0.036
            fx = (X / fw) % 1.0
            vane = 0.5 + 0.5 * np.cos(2 * math.pi * (fx - 0.5)) + 0.6 * np.exp(-((fx - 0.5) / 0.05) ** 2)
            d = coverts * 0.0014 * hh + (1 - coverts) * 0.0006 * vane
            return (-d).astype(np.float32)
        return (lambda Q: None, h)


# ------------------------------------------------------------------ skeleton

def skeleton():
    J = {
        "body": ((0, 0.03, 0.30), (0, -0.12, 0.335)),
        "neck": ((0, -0.12, 0.335), (0, -0.215, 0.378)),
        "head": ((0, -0.215, 0.38), (0, -0.36, 0.37)),
        "tail": ((0, 0.13, 0.315), (0, 0.47, 0.31)),
        "wing.1.L": ((0.06, -0.05, float(zc(0.06))), (0.26, 0.02, float(zc(0.26)))),
        "wing.2.L": ((0.26, 0.02, float(zc(0.26))), (0.44, -0.08, float(zc(0.44)))),
        "wing.3.L": ((0.44, -0.08, float(zc(0.44))), (1.0, -0.02, float(zc(1.0)))),
        "fold.L": ((0.07, -0.08, 0.37), (0.07, 0.34, 0.36)),
        "thigh.L": ((0.05, 0.03, 0.28), (0.05, 0.045, 0.165)),
        "shin.L": ((0.05, 0.045, 0.165), (0.05, -0.005, 0.03)),
        "foot.L": ((0.05, -0.005, 0.03), (0.05, -0.055, 0.009)),
    }
    B = [("body", None), ("neck", "body"), ("head", "neck"), ("tail", "body")]
    for sd in "LR":
        B += [(f"wing.1.{sd}", "body"), (f"wing.2.{sd}", f"wing.1.{sd}"), (f"wing.3.{sd}", f"wing.2.{sd}"), (f"fold.{sd}", "body")]
    for sd in "LR":
        B += [(f"thigh.{sd}", "body"), (f"shin.{sd}", f"thigh.{sd}"), (f"foot.{sd}", f"shin.{sd}")]
    return L.Skeleton(B, J)


LEGS = {"l": ("thigh.L", "shin.L", "foot.L"), "r": ("thigh.R", "shin.R", "foot.R")}


def spread_weights(ob, names, s):
    """A spread wing's weights by span: the arm, the forearm, the hand."""
    V = L.bl.verts_np(ob)
    X = s * V[:, 0]
    sd = "L" if s > 0 else "R"
    w1 = smoothstep(0.30, 0.22, X)
    w3 = smoothstep(0.40, 0.49, X)
    w2 = np.clip(1 - w1 - w3, 0, 1)
    W = np.zeros((len(V), len(names)), np.float32)
    W[:, names.index(f"wing.1.{sd}")] = w1
    W[:, names.index(f"wing.2.{sd}")] = w2
    W[:, names.index(f"wing.3.{sd}")] = w3
    return W


# ------------------------------------------------------------------ poses and clips

def wing(side, up=0.0, sweep=0.0, twist=0.0):
    """A wing bone's rotation for a side: up (tip up), sweep (tip forward),
    twist (leading edge down), in degrees - mirrored for the right wing."""
    s = 1.0 if side == "L" else -1.0
    return (twist, -s * up, -s * sweep)


def base(bd, perched):
    """Common channels: which wing set shows, the legs."""
    p = bd.rest()
    for sd, s in SIDES:
        p[f"scale.wing.1.{sd}"] = (0.001 if perched else 1.0,)
        p[f"scale.fold.{sd}"] = (1.0 if perched else 0.001,)
        for b in ("wing.1", "wing.2", "wing.3"):
            p[f"{b}.{sd}"] = (0.0, 0.0, 0.0)
        p[f"fold.{sd}"] = (0.0, 0.0, 0.0)
    return p


def perch(bd, **kw):
    """Perched: the body 45 degrees nose-up about the hips, the head level,
    the feet on the rock, the folded wings showing."""
    p = base(bd, True)
    p.update({"root": (0, 0.0, -0.015), "body": (-50.0, 0, 0), "neck": (28.0, 0, 0), "head": (22.0, 0, 0), "tail": (10.0, 0, 0)})
    for k, v in kw.items():
        p[k.replace("__", ".")] = v
    return p


def fly(bd, **kw):
    """Flying: body level, wings spread, feet tucked under the tail, toes curled."""
    p = base(bd, False)
    p.update({"neck": (-4.0, 0, 0), "head": (12.0, 0, 0)})
    for sd, s in SIDES:
        leg = sd.lower()
        p[f"ik.{leg}"] = (s * 0.035, 0.22, 0.30)
        p[f"rot.{leg}"] = (150.0, 0, 0)
    for k, v in kw.items():
        p[k.replace("__", ".")] = v
    return p


def clip_glide(body):
    """4 s loop: soaring on spread wings, primaries fingered; small balancing
    corrections - the hands flex, the tail twists, the body rolls a little -
    and the head turning to look down at the valley."""
    T = 4.0
    c = L.Clip("eagle.glide", T, True)
    p = fly(body)
    c.kd(0, p).kd(T, p)

    def balance(t, pose):
        r = L.loop_noise(t, T, 91, 3, 1, 2)
        q = L.loop_noise(t, T, 92, 3, 1, 3)
        add(pose, "body", (1.5 * q, 3.5 * r, 0))
        for sd, s in SIDES:
            add(pose, f"wing.1.{sd}", wing(sd, up=2.0 + 2.0 * s * r + 1.5 * q))
            add(pose, f"wing.3.{sd}", wing(sd, up=3.0 * L.loop_noise(t, T, 93 + (s > 0), 2, 1, 3), twist=1.5 * q))
        add(pose, "tail", (2.0 * q, 6.0 * L.loop_noise(t, T, 95, 2, 1, 2), 0))
        add(pose, "neck", (6 * L.loop_noise(t, T, 96, 2, 1, 2), 0, 14 * L.loop_noise(t, T, 97, 2, 1, 2)))
        add(pose, "head", (10 + 6 * L.loop_noise(t, T, 98, 2, 1, 2), 0, 10 * L.loop_noise(t, T, 99, 2, 1, 2)))
    c.layers.append(balance)
    return c


def flap_layer(t, pose, T, n=2, amp=1.0):
    """Wingbeats: a long powerful downstroke with the wings fully out, an
    upstroke with the hands folded back and up; the body lifted by each."""
    ph = (t / T * n) % 1.0
    down = 0.56
    if ph < down:
        u = A.ease("inout", ph / down)
        up = 48 - 85 * u
        hand, sweep, fold2 = 0.0, 10 * math.sin(math.pi * u), 0.0
    else:
        u = A.ease("inout", (ph - down) / (1 - down))
        up = -37 + 85 * u
        fold2 = 32 * math.sin(math.pi * u)
        hand, sweep = 45 * math.sin(math.pi * u), -8 * math.sin(math.pi * u)
    for sd, s in SIDES:
        add(pose, f"wing.1.{sd}", wing(sd, up=up * amp, sweep=sweep * amp, twist=-6 * amp * math.sin(2 * math.pi * ph)))
        add(pose, f"wing.2.{sd}", wing(sd, up=-8 * amp * (fold2 / 32), sweep=-fold2 * amp))
        add(pose, f"wing.3.{sd}", wing(sd, up=10 * amp * (hand / 45) - 6 * amp * (1 - hand / 45) * math.sin(math.pi * min(ph / down, 1)), sweep=-hand * amp))
    lift = math.sin(2 * math.pi * (ph - 0.1))
    add(pose, "root", (0, 0, 0.03 * amp * lift))
    add(pose, "neck", (-3 * amp * lift, 0, 0))
    add(pose, "head", (3 * amp * lift, 0, 0))
    add(pose, "tail", (4 * amp * math.sin(2 * math.pi * ph), 0, 0))


def clip_flap(body):
    """1.1 s loop, two big wingbeats (about 1.8 a second)."""
    T = 1.1
    c = L.Clip("eagle.flap", T, True)
    p = fly(body)
    c.kd(0, p).kd(T, p)
    c.layers.append(lambda t, pose: flap_layer(t, pose, T, 2))
    return c


def clip_land(body):
    """3 s: from a glide, the flare (body up, wings cupped forward, tail down,
    legs thrown forward, talons open), a braking beat, touchdown at 1.2 s (the
    game brings the root to the rock by then), balancing, the wings folding
    (the folded set replaces the spread one at 1.85 s), a settle, a cock of
    the head, and from 2.6 s the stare, held (the last frame is the stare)."""
    T = LAND["duration"]
    touch, swap = LAND["touch"], LAND["swap"]
    c = L.Clip("eagle.land", T, False)
    g = fly(body)
    flare = fly(body, body=(-52.0, 0, 0), neck=(30.0, 0, 0), head=(20.0, 0, 0), tail=(38.0, 0, 0))
    for sd, s in SIDES:
        leg = sd.lower()
        flare[f"wing.1.{sd}"] = wing(sd, up=28, sweep=22, twist=-12)
        flare[f"wing.2.{sd}"] = wing(sd, up=0, sweep=-6)
        flare[f"wing.3.{sd}"] = wing(sd, up=14, sweep=-10)
        flare[f"ik.{leg}"] = (s * 0.05, -0.20, 0.12)
        flare[f"rot.{leg}"] = (-35.0, 0, 0)
    brake = dict(flare)
    for sd, s in SIDES:
        brake[f"wing.1.{sd}"] = wing(sd, up=-18, sweep=16, twist=-8)
        brake[f"wing.3.{sd}"] = wing(sd, up=-8, sweep=0)
    down = perch(body, root=(0, 0.0, -0.035), body=(-38.0, 0, 0), neck=(22.0, 0, 0), head=(16.0, 0, 0), tail=(20.0, 0, 0))
    for sd, s in SIDES:
        down[f"scale.wing.1.{sd}"] = (1.0,)
        down[f"scale.fold.{sd}"] = (0.001,)
        down[f"wing.1.{sd}"] = wing(sd, up=42, sweep=12, twist=-10)
        down[f"wing.2.{sd}"] = wing(sd, sweep=-10)
        down[f"wing.3.{sd}"] = wing(sd, up=12, sweep=-15)
    balance = dict(down)
    for sd, s in SIDES:
        balance[f"wing.1.{sd}"] = wing(sd, up=20, sweep=6, twist=-4)
    # folding: the arm swings back along the body, the forearm forward, the hand back
    folding = dict(down)
    folding.update({"body": (-44.0, 0, 0), "root": (0, 0, -0.02)})
    for sd, s in SIDES:
        folding[f"wing.1.{sd}"] = wing(sd, up=-8, sweep=-62, twist=20)
        folding[f"wing.2.{sd}"] = wing(sd, up=0, sweep=120)
        folding[f"wing.3.{sd}"] = wing(sd, up=0, sweep=-140)
    shown = perch(body)
    for sd, s in SIDES:
        shown[f"fold.{sd}"] = (0, 0, -s * 14.0)
    st = perch(body)
    cock = perch(body, head=(22.0, 12.0, -6.0))
    c.kd(0.0, g).kd(0.35, g, "linear").kd(0.72, flare, "inout").kd(0.92, brake, "inout").kd(touch, down, "out")
    c.kd(1.38, balance, "inout").kd(1.55, down, "inout").kd(swap - 0.001, folding, "inout")
    c.kd(swap, shown, "linear").kd(2.15, st, "out").kd(2.35, cock, "inout").kd(2.5, cock, "linear").kd(LAND["stare"], st, "inout")
    c.kd(T, st, "linear")
    # the scale swap happens on one frame: keep those channels stepped
    for k in list(c.ch):
        if k.startswith("scale."):
            vals = [(t, v) for t, v, _ in sorted(c.ch[k], key=lambda kv: kv[0])]
            c.ch[k] = [(t, v, "linear") for t, v in vals]
    return c


def clip_stare(body):
    """3 s loop, perched: the fierce stare - the head held dead still between
    small quick adjustments, a slow cock of the head, breathing."""
    T = 3.0
    c = L.Clip("eagle.stare", T, True)
    st = perch(body)
    c.kd(0, st).kd(T, st)
    moves = [(0.0, 0, 0, 0), (0.5, 0, 0, 0), (0.56, 3, -4, 0), (1.1, 3, -4, 0), (1.3, 1, -6, 12), (1.9, 1, -6, 12),
             (2.1, 0, 2, 0), (2.5, 0, 2, 0), (2.56, 0, 0, 0), (3.0, 0, 0, 0)]
    for t, pitch, yaw, roll in moves:
        c.kd(t, {"head": (22.0 + pitch, roll, yaw)}, "out")

    def breathe(t, pose):
        add(pose, "body", (0.6 * math.sin(2 * math.pi * 3 * t / T), 0, 0))
        add(pose, "tail", (1.5 * math.sin(2 * math.pi * 3 * t / T - 1), 0, 0))
    c.layers.append(breathe)
    return c


CLIPS = [clip_glide, clip_flap, clip_land, clip_stare]


# ------------------------------------------------------------------ build

def decimate_head_first(ob, head_mask_fn, rest_tris, head_tris):
    """Two decimation passes on one mesh (no seam): the body to its budget
    with the head masked, then the head to its own with the rest masked -
    the head keeps several times the density a single pass would give it."""
    for mask_head, target in ((True, None), (False, rest_tris + head_tris)):
        V = L.bl.verts_np(ob)
        keep = head_mask_fn(V) if mask_head else ~head_mask_fn(V)
        g = ob.vertex_groups.new(name="keep")
        idx = np.nonzero(keep)[0].tolist()
        if idx:
            g.add(idx, 1.0, "REPLACE")
        tris = L.bl.tri_count(ob)
        if target is None:
            C = np.array([p.center[:] for p in ob.data.polygons])
            nh = sum(len(p.vertices) - 2 for p, hm in zip(ob.data.polygons, head_mask_fn(C)) if hm)
            target = rest_tris + nh
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = min(1.0, target / tris)
        m.use_symmetry = True
        m.symmetry_axis = "X"
        m.use_collapse_triangulate = True
        m.vertex_group = "keep"
        m.invert_vertex_group = True
        L.bl.apply_modifiers(ob)
        ob.vertex_groups.clear()
    ob.data.validate()
    return ob


def build(quick=False, size=1024):
    with L.stage("eagle: sculpt"):
        sc = Sculpt()
    sk = skeleton()
    names = sk.names
    lo, hi = (-0.16, -0.40, -0.02), (0.16, 0.50, 0.46)
    with L.stage("eagle: game meshes"):
        from charlib import polygonize as PG
        V, Qd = PG.mesh_sdf(sc.body, lo, hi, 0.004 if quick else 0.0022, blur=1.0)
        body_ob = L.bl.mesh_from_arrays("eagle.body", V, Qd)
        head_mask = lambda X: (HEAD.local(X)[1] > -0.035) & (X[:, 1] < -0.17)
        decimate_head_first(body_ob, head_mask, 1300 if quick else 2500, 500 if quick else 1300)
        L.log(f"  eagle.body: {L.bl.tri_count(body_ob)} tris")
        b = lambda f, d: (lambda P: f(P) - d)
        parts = [("torso", sc.torso, 1.0), ("tail", b(sc.tail, 0.002), 0.9), ("head", b(sc.head, 0.002), 3.0)]
        parts += [(f"leg{i}", S.Union([lg, t, tl]), 1.4) for i, (lg, t, tl) in enumerate(zip(sc.legs, sc.toes, sc.talons))]
        jobs = [dict(ob=body_ob, field=sc.body, paint=sc.paint, relief=(sc.regions, sc.detail), weight=1.0, parts=parts)]
        for (sd, s), sp, fo in zip(SIDES, sc.spread, sc.folded):
            w = L.sculpt_mesh(f"eagle.wing.{sd}", sp, sp.lo - 0.01, sp.hi + 0.01, 0.006 if quick else 0.0035,
                              700 if quick else 1300, symmetry=False, blur=0.5)
            jobs.append(dict(ob=w, field=sp, paint=sc.wing_paint(s), relief=sc.wing_relief(s), weight=0.6, uv_angle=66,
                             skin=("spread", s)))
            f = L.sculpt_mesh(f"eagle.fold.{sd}", fo, fo.lo - 0.01, fo.hi + 0.01, 0.005 if quick else 0.003,
                              300 if quick else 800, symmetry=False, blur=0.6)
            jobs.append(dict(ob=f, field=fo, paint=sc.wing_paint(s, True), relief=sc.wing_relief(s, True), weight=0.8,
                             skin=f"fold.{sd}"))
    with L.stage("eagle: atlas"):
        imgs, at = L.bake_atlas(jobs, 512 if quick else size, "eagle", sc.all, ao_scale=0.8, ao_strength=0.85, ground=False)
    L.save_atlas_previews(imgs, L.ATLAS_DIR, "eagle")
    mat = L.material("eagle", imgs)
    rig = sk.create("eagle")
    with L.stage("eagle: weights"):
        no_heat = [bn for bn in names if bn.startswith("wing.") or bn.startswith("fold.")]
        for bn in no_heat:
            rig.data.bones[bn].use_deform = False
        body_jobs = [j for j in jobs if j.get("skin", "transfer") == "transfer"]
        L.skin_jobs(body_jobs, rig, names, sc.body, lo, hi, res=0.006 if quick else 0.0045)
        for bn in no_heat:
            rig.data.bones[bn].use_deform = True
        for j in jobs:
            sk_ = j.get("skin", "transfer")
            if isinstance(sk_, tuple):
                L.SKN.apply_weights(j["ob"], spread_weights(j["ob"], names, sk_[1]), rig, 3, names)
            elif sk_ != "transfer":
                W = np.zeros((len(j["ob"].data.vertices), len(names)), np.float32)
                W[:, names.index(sk_)] = 1.0
                L.SKN.apply_weights(j["ob"], W, rig, 1, names)
    ntris = sum(L.bl.tri_count(j["ob"]) for j in jobs)
    mesh = L.finish_mesh("eagle.body", jobs, mat)
    body = L.Body(sk, LEGS)
    with L.stage("eagle: clips"):
        acts = [L.bake_clip(body, mk(body), rig) for mk in CLIPS]
    L.stash(rig, acts)
    for sd, s in SIDES:
        rig.pose.bones[f"wing.1.{sd}"].scale = (1, 1, 1)
    rig["land"] = LAND
    return dict(rig=rig, mesh=mesh, tris=ntris, images=imgs, clips=[a.name for a in acts])
