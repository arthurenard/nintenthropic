"""The sheep: an alpine ewe after the Valais Blacknose - a shaggy white fleece,
black face, ears, knees, hocks and feet, horns curled in a spiral.

The shepherd's flock grazes the far slope at 600-800 m, where a sheep is a
few pixels through the scope: a white, lumpy, low body on thin dark legs,
head down. Close up (the review) she has a black face under a woolly white
forelock, drooping black ears, amber eyes, locks of wool hanging from her
flanks.

Blender space: facing -Y, left +X, hooves on z = 0; withers 0.78 m in wool.
"""
import math
import numpy as np
from mathutils import Vector
from . import lib as L, quad as Q
from .lib import S, srgb, smoothstep, value_noise, fbm, Frame, nrm, chain, flow_noise, add, pulse

NAME = "sheep"
HEAD = Frame((0, -0.51, 0.70), (0, -0.18, -0.15))
WOOL = 0.062          # fleece depth over the body


def mix(a, b, t):
    t = np.asarray(t, float)[:, None]
    return a * (1 - t) + b * t


def ear_frame(s):
    base = HEAD.p(s * 0.052, 0.05, -0.022)
    d = nrm((s * 1.0, 0.22, -0.55))
    return base, d, L.frame_from(d, up=(0, -1.0, 0.2))


def horn_points(s, n=28):
    """A ewe's horn: up and back from the poll, curling down behind the ear
    and forward again - a little over one turn, widening outward."""
    top = HEAD.p(s * 0.035, 0.025, 0.045)
    c = top + np.array([s * 0.04, 0.03, -0.032])
    a0 = math.atan2(top[2] - c[2], top[1] - c[1])
    pts = []
    for i in range(n):
        u = i / (n - 1)
        a = a0 - u * 2 * math.pi * 0.85          # backward over the top, then down and forward
        r = 0.052 * (1 - 0.35 * u)
        pts.append(c + np.array([s * (0.005 + 0.06 * u), r * math.cos(a), r * math.sin(a)]))
    return np.array(pts)


class Sculpt:
    def __init__(self):
        H = HEAD
        # the body under the fleece
        barrel = L.tube([(0, 0.44, 0.60), (0, 0.36, 0.585), (0, 0.20, 0.565), (0, 0.0, 0.555), (0, -0.18, 0.57),
                         (0, -0.32, 0.565), (0, -0.40, 0.575)],
                        [0.03, 0.10, 0.15, 0.16, 0.15, 0.10, 0.03], [0.04, 0.12, 0.165, 0.175, 0.165, 0.13, 0.04])
        neck = L.tube([(0, -0.28, 0.56), (0, -0.40, 0.625), (0, -0.49, 0.675)], [0.085, 0.062, 0.05], [0.115, 0.08, 0.06])
        thighs = [S.Ellipsoid((s * 0.09, 0.29, 0.47), (0.06, 0.11, 0.14), S.rot_x(12)) for s in (1, -1)]
        shoulders = [S.Ellipsoid((s * 0.09, -0.29, 0.50), (0.055, 0.09, 0.13), S.rot_x(-20)) for s in (1, -1)]
        rump = S.Ellipsoid((0, 0.35, 0.565), (0.14, 0.13, 0.155))
        brisket = S.Ellipsoid((0, -0.30, 0.555), (0.12, 0.11, 0.15))
        core = S.Union([barrel, neck, rump, brisket] + thighs + shoulders, k=0.05)
        self.core = core
        # the fleece: an offset of the body, lumpy with locks that hang on the flanks
        self.fleece = S.Displace(S.Offset(core, WOOL), self.locks, 0.03)
        self.legs = [self.leg(1.0, True), self.leg(-1.0, True), self.leg(1.0, False), self.leg(-1.0, False)]
        self.hooves = [self.hoof(s * 0.083, -0.335) for s in (1, -1)] + [self.hoof(s * 0.083, 0.33) for s in (1, -1)]
        legs = S.Union([lg for lg in self.legs] + self.hooves, k=0.006)
        self.trunk = self.fleece
        # --- head (x: left, s: poll -> muzzle, h: up the forehead)
        cran = S.Ellipsoid(H.p(0, 0.05, -0.02), (0.058, 0.065, 0.055), H.R)
        face = S.RoundCone(H.p(0, 0.06, -0.015), H.p(0, 0.19, -0.03), 0.047, 0.035)
        nose_bridge = S.Ellipsoid(H.p(0, 0.13, 0.0), (0.03, 0.07, 0.03), H.R)       # a Roman nose
        muzzle = S.Ellipsoid(H.p(0, 0.215, -0.04), (0.035, 0.03, 0.036), H.R)
        jaw = S.RoundCone(H.p(0, 0.04, -0.07), H.p(0, 0.20, -0.068), 0.035, 0.022)
        cheeks = [S.Ellipsoid(H.p(s * 0.035, 0.09, -0.05), (0.028, 0.05, 0.04), H.R) for s in (1, -1)]
        self.eyes = [H.p(s * 0.052, 0.085, 0.004) for s in (1, -1)]
        eyes = [S.Sphere(e, 0.0125) for e in self.eyes]
        head = S.Union([cran, face, nose_bridge, muzzle, jaw] + cheeks, k=0.02)
        head = S.Union([head] + eyes, k=0.004)
        nostrils = S.Union([S.Ellipsoid(H.p(s * 0.016, 0.24, -0.03), (0.006, 0.01, 0.005), H.R) for s in (1, -1)])
        head = S.Subtract(head, nostrils, k=0.003)
        self.forelock = S.Displace(S.Ellipsoid(H.p(0, 0.035, 0.028), (0.062, 0.06, 0.045), H.R), self.curls, 0.01)
        self.head = S.Union([head, self.forelock], k=0.015)
        self.ear_f = [self.ear(1.0), self.ear(-1.0)]
        tail_c = chain([(0, 0.42, 0.585), (0, 0.475, 0.50), (0, 0.49, 0.41), (0, 0.49, 0.32)], [0.03, 0.028, 0.024, 0.02], n=10)
        self.tail = S.Displace(S.Offset(tail_c, 0.02), self.curls, 0.01)
        body = S.Union([self.fleece, legs], k=0.03)
        body = S.Union([body, self.head], k=0.035)
        body = S.Union([body] + self.ear_f, k=0.008)
        body = S.Union([body, self.tail], k=0.02)
        self.body = body
        self.rest = S.Union([S.Union([self.fleece, legs], k=0.03), self.head], k=0.035)
        self.horns = [chain(horn_points(s), np.linspace(0.017, 0.006, 6), n=40) for s in (1, -1)]
        self.all = S.Union([body] + self.horns)
        self.relief = (self.wool_mask, self.detail)
        self.tail_root_z = 0.57
        self.ears = [(ef, ear_frame(s)[0], 0.11) for s, ef in zip((1, -1), self.ear_f)]

    # -- parts
    @staticmethod
    def leg(s, front):
        x = lambda v: s * v
        if front:
            parts = [S.RoundCone((x(0.09), -0.28, 0.37), (x(0.085), -0.31, 0.21), 0.034, 0.02),
                     S.Ellipsoid((x(0.085), -0.31, 0.20), (0.021, 0.022, 0.026)),
                     S.RoundCone((x(0.085), -0.31, 0.19), (x(0.084), -0.32, 0.055), 0.016, 0.014),
                     S.Ellipsoid((x(0.084), -0.32, 0.05), (0.018, 0.019, 0.018)),
                     S.RoundCone((x(0.084), -0.322, 0.045), (x(0.083), -0.335, 0.025), 0.015, 0.017)]
        else:
            parts = [S.RoundCone((x(0.10), 0.20, 0.36), (x(0.086), 0.37, 0.25), 0.04, 0.02),
                     S.RoundCone((x(0.092), 0.35, 0.40), (x(0.086), 0.39, 0.26), 0.013, 0.012),
                     S.Ellipsoid((x(0.086), 0.375, 0.25), (0.02, 0.026, 0.024)),
                     S.RoundCone((x(0.086), 0.37, 0.24), (x(0.084), 0.34, 0.055), 0.017, 0.014),
                     S.Ellipsoid((x(0.084), 0.338, 0.05), (0.018, 0.019, 0.018)),
                     S.RoundCone((x(0.084), 0.336, 0.045), (x(0.083), 0.33, 0.025), 0.015, 0.017)]
        return S.Union(parts, k=0.012)

    @staticmethod
    def hoof(cx, cy):
        h = S.Ellipsoid((cx, cy - 0.004, 0.013), (0.021, 0.029, 0.02))
        lo, hi = (cx - 0.04, cy - 0.05, -0.02), (cx + 0.04, cy + 0.05, 0.05)
        h = S.Intersect(h, S.Plane((cx, cy, 0.0), (0, 0, -1), lo, hi))
        return S.Subtract(h, S.Box((cx, cy - 0.02, 0.015), (0.0015, 0.018, 0.02)), k=0.0015)

    @staticmethod
    def ear(s):
        base, d, R = ear_frame(s)
        c = base + d * 0.055
        outer = S.Ellipsoid(c, (0.027, 0.058, 0.0095), R)
        cup = S.Ellipsoid(c + R[:, 2] * 0.007 + d * 0.006, (0.018, 0.045, 0.006), R)
        return S.Subtract(outer, cup, k=0.003)

    @staticmethod
    def locks(P):
        """Wool: fat lumps, finer curls, and locks that hang straight down the
        flanks (stretched noise along the vertical there)."""
        P = np.asarray(P, np.float64)
        lump = fbm(P, 18.0, 2, seed=41)
        curl = value_noise(P, 70.0, seed=42)
        down = np.tile(np.array([0, 0, 1.0]), (len(P), 1))
        hang = flow_noise(P, down, 8.0, 45.0, seed=43)
        side = smoothstep(0.62, 0.45, P[:, 2])
        d = 0.018 * (lump - 0.5) + 0.006 * (curl - 0.5) + 0.012 * side * (hang - 0.5)
        return (-d).astype(np.float32)

    @staticmethod
    def curls(P):
        P = np.asarray(P, np.float64)
        return (-(0.005 * (value_noise(P, 90.0, seed=44) - 0.5) + 0.003 * (value_noise(P, 200.0, seed=45) - 0.5))).astype(np.float32)

    def wool_mask(self, Q):
        """1 on the fleece (and the forelock), 0 on hair: once per texel."""
        Qf = np.asarray(Q, np.float32)
        w = smoothstep(0.004, -0.004, self.fleece(Qf) - self.legs_and_head(Qf))
        return np.maximum(w, smoothstep(0.006, 0.0, self.forelock(Qf)))

    def detail(self, P, wool):
        """Normal-map relief: tight curls in the wool, short hair elsewhere."""
        P = np.asarray(P, np.float64)
        c1 = value_noise(P, 160.0, seed=46)
        c2 = value_noise(P, 320.0, seed=47)
        d = wool * (0.0022 * (c1 - 0.5) + 0.0010 * (c2 - 0.5))
        down = np.tile(np.array([0, 0, -1.0]), (len(P), 1))
        d += (1 - wool) * 0.0004 * (flow_noise(P, down, 20.0, 150.0, seed=48) - 0.5)
        return (-d).astype(np.float32)

    def legs_and_head(self, Pf):
        return np.minimum(np.min([lg(Pf) for lg in self.legs], axis=0), self.head(Pf))

    def parts(self):
        b = lambda f, d: (lambda P: f(P) - d)
        legs = [S.Union([lg, hf]) for lg, hf in zip(self.legs, self.hooves)]
        return ([("fleece", self.fleece, 1.0), ("head", b(self.head, 0.002), 2.4), ("tail", b(self.tail, 0.002), 1.0)]
                + [(f"ear{i}", b(e, 0.002), 1.8) for i, e in enumerate(self.ear_f)]
                + [(f"leg{i}", lg, 1.2) for i, lg in enumerate(legs)])

    def jaw_mask(self, V):
        hx, hs, hh = HEAD.local(V)
        return smoothstep(-0.045, -0.06, hh) * smoothstep(0.05, 0.1, hs) * (hs < 0.28) * (np.abs(hx) < 0.07)

    def extra_jobs(self):
        jobs = []
        for side, h in zip("LR", self.horns):
            ob = L.sculpt_mesh("sheep.horn." + side, h, h.lo - 0.01, h.hi + 0.01, 0.0018, 160, symmetry=False)
            jobs.append(dict(ob=ob, field=h, paint=self.horn_paint, weight=1.4, skin="head"))
        return jobs

    # -- paint
    def paint(self, P):
        P = np.asarray(P, np.float64)
        Pf = P.astype(np.float32)
        n = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        d_fl = self.fleece(Pf)
        d_lg = np.min([lg(Pf) for lg in self.legs + self.hooves], axis=0)
        d_hd = self.head(Pf)
        d_tl = self.tail(Pf)
        d_ear = np.min([e(Pf) for e in self.ear_f], axis=0)
        near = np.minimum.reduce([d_fl, d_lg, d_hd, d_tl, d_ear])
        wool = ((d_fl <= near + 0.003) | (d_tl <= near + 0.003)).astype(float)
        leg = (d_lg <= near + 0.002) & (wool < 0.5)
        ear = (d_ear <= near + 0.002)
        # fleece: creamy white, yellowing with lanolin and grubby low down; lock
        # tips lighter than their roots
        lump = fbm(P, 18.0, 2, seed=41)
        cream = srgb(0.87, 0.85, 0.79)
        dirty = srgb(0.66, 0.60, 0.50)
        c = np.tile(cream, (n, 1)) * (0.88 + 0.16 * lump[:, None])
        low = smoothstep(0.62, 0.36, z) * (0.6 + 0.4 * fbm(P, 12, 2, seed=49))
        c = mix(c, dirty, 0.75 * low)
        c = mix(c, srgb(0.80, 0.76, 0.64), 0.25 * fbm(P, 5, 2, seed=50))
        curl = value_noise(P, 160.0, seed=46)
        c *= (0.9 + 0.14 * curl)[:, None]
        r = np.full(n, 0.9)
        # legs: short white hair, black knees, hocks and feet
        legc = srgb(0.78, 0.76, 0.70) * (0.9 + 0.1 * fbm(P, 60, 2, seed=51)[:, None])
        black = srgb(0.045, 0.04, 0.04)
        knees = np.zeros(n)
        for sx in (1, -1):
            for cy, cz in ((-0.31, 0.20), (0.375, 0.25)):
                dd = np.sqrt((x - sx * 0.085) ** 2 + (y - cy) ** 2 + ((z - cz) / 1.6) ** 2)
                knees = np.maximum(knees, smoothstep(0.05, 0.035, dd))
        feet = smoothstep(0.1, 0.075, z)
        lc = mix(legc, black, np.maximum(knees, feet) * (0.85 + 0.15 * value_noise(P, 200, seed=52)))
        c[leg] = lc[leg]
        r[leg] = 0.8
        hf = leg & (z < 0.03)
        c[hf] = srgb(0.09, 0.08, 0.07)
        r[hf] = 0.45
        # the face: black from the eyes down under a white woolly forelock
        hx, hs, hh = HEAD.local(P)
        inhead = (d_hd <= near + 0.002) & (wool < 0.5)
        lock = smoothstep(0.008, 0.002, self.forelock(Pf))
        face = inhead.astype(float) * (1 - smoothstep(0.3, 0.8, lock))
        fc = black * (0.85 + 0.3 * value_noise(P, 300, seed=53)[:, None])
        # the black runs back along the jaw and fades into the neck wool
        c = mix(c, fc, face)
        r = r * (1 - face) + 0.7 * face
        nose = face * smoothstep(0.215, 0.235, hs)
        r = r * (1 - nose) + 0.5 * nose
        c[ear] = (black * (0.85 + 0.3 * value_noise(P[ear], 300, seed=54)[:, None]))
        r[ear] = 0.75
        # eyes: amber with a dark horizontal pupil
        for e in self.eyes:
            q = P - e
            d = np.linalg.norm(q, axis=1)
            ey = smoothstep(0.0128, 0.0115, d)
            amber = srgb(0.62, 0.45, 0.16)
            pupil = (np.abs(q[:, 2]) < 0.0022) & (np.abs(q[:, 1]) < 0.007)
            ec = np.where(pupil[:, None], srgb(0.02, 0.02, 0.02)[None, :], amber[None, :])
            c = mix(c, ec, ey)
            r = r * (1 - ey) + 0.08 * ey
        return np.clip(c, 0, 1), np.clip(r, 0.05, 1), np.zeros(n)

    @staticmethod
    def horn_paint(P):
        P = np.asarray(P, np.float64)
        n = len(P)
        rings = 0.5 + 0.5 * np.sin(np.linalg.norm(P - HEAD.o, axis=1) * 900 + 3 * value_noise(P, 150, seed=55))
        c = np.tile(srgb(0.60, 0.55, 0.46), (n, 1)) * (0.8 + 0.25 * rings[:, None])
        return c, 0.55 + 0.1 * rings, np.zeros(n)


def skeleton():
    H = HEAD
    eb, ed, _ = ear_frame(1.0)
    J = {
        "pelvis": ((0, 0.27, 0.58), (0, 0.06, 0.60)),
        "spine": ((0, 0.06, 0.60), (0, -0.15, 0.61)),
        "chest": ((0, -0.15, 0.61), (0, -0.32, 0.62)),
        "neck": ((0, -0.30, 0.56), (0, -0.42, 0.63)),
        "neck.2": ((0, -0.42, 0.63), (0, -0.51, 0.70)),
        "head": ((0, -0.51, 0.70), (0, -0.69, 0.55)),
        "jaw": (H.p(0, 0.05, -0.06), H.p(0, 0.21, -0.065)),
        "ear.L": (eb, eb + ed * 0.11),
        "tail.1": ((0, 0.42, 0.585), (0, 0.475, 0.50)),
        "tail.2": ((0, 0.475, 0.50), (0, 0.49, 0.41)),
        "tail.3": ((0, 0.49, 0.41), (0, 0.49, 0.30)),
        "front.upper.L": ((0.095, -0.36, 0.50), (0.09, -0.27, 0.36)),
        "front.lower.L": ((0.09, -0.27, 0.36), (0.085, -0.31, 0.20)),
        "front.foot.L": ((0.085, -0.31, 0.20), (0.083, -0.335, 0.0)),
        "hind.upper.L": ((0.095, 0.29, 0.52), (0.10, 0.19, 0.37)),
        "hind.lower.L": ((0.10, 0.19, 0.37), (0.085, 0.37, 0.25)),
        "hind.foot.L": ((0.085, 0.37, 0.25), (0.083, 0.33, 0.0)),
    }
    return L.Skeleton(Q.bones(), J)


# ------------------------------------------------------------------ clips

WALK_SPEED, WALK_T = 0.7, 0.8
RUN_SPEED, RUN_T = 2.6, 14 / 30       # a loop must be whole frames long


def graze_pose(reach=0.0, sweep=0.0):
    return dict(root=(0, -0.005, -0.02), pelvis=(4.0, 0, 0), chest=(2.0, 0, 0),
                neck=(38 + 4 * reach, 0, 5 * sweep), **{"neck.2": (44 + 4 * reach, 0, 7 * sweep)},
                head=(-30 - 2 * reach, 0, 4 * sweep), jaw=(2, 0, 0))


def clip_graze(body):
    """6 s loop: a sheep nibbles - quick little bites, the head working along
    the turf, jaw going, a step forward and back, the tail wagging."""
    T = 6.0
    c = L.Clip("sheep.graze", T, True)
    for t, reach, sweep in ((0, 0, 0), (1.2, 0.5, 0.6), (2.5, 1.0, 0.0), (3.6, 0.7, -0.7), (4.8, 0.2, -0.3), (6.0, 0, 0)):
        c.kd(t, body.rest(**graze_pose(reach, sweep)))
    fl0 = Vector(body.foot0["fl"])
    for t, off, lift in ((0, 0, 0), (2.1, 0, 0), (2.28, 0.5, 0.05), (2.45, 1, 0), (4.9, 1, 0), (5.08, 0.5, 0.05), (5.25, 0, 0), (6.0, 0, 0)):
        c.kd(t, {"ik.fl": tuple(fl0 + Vector((0, -0.08 * off, lift))), "rot.fl": (70 * lift / 0.05, 0, 0)})

    def bites(t, pose):
        for k in range(12):
            t0 = 0.2 + k * 0.48 + 0.07 * math.sin(k * 2.3)
            e = pulse(t, t0, 0.06, 0.03, 0.18)
            add(pose, "head", (-6 * e, 0, 4 * math.sin(k * 1.7) * e))
            add(pose, "jaw", (6 * pulse(t, t0 - 0.12, 0.08, 0.02, 0.06), 0, 0))
    c.layers += [bites, Q.chew(4, 2, 2.2, T=T),
                 Q.swish([(0.8, 1, 0.5), (1.3, -1, 0.5), (3.9, 1, 0.45), (4.3, -1, 0.45)], amp=(0, 0, 22), lag=0.05),
                 Q.flicks([(0.5, 0, (0, 0, -25), 0.3), (3.1, 1, (0, 0, -30), 0.3), (5.4, 2, (-20, 0, 10), 0.35)]),
                 Q.drift(T, {"ear.L": (5, 4, 6), "ear.R": (5, 4, 6)}, seed=21)]
    return c


def clip_idle(body):
    """5 s loop, standing: chewing, looking about, an ear twitch."""
    T = 5.0
    c = L.Clip("sheep.idle", T, True)
    a = body.rest(neck=(4, 0, 0), **{"neck.2": (0, 0, 0)}, head=(-4, 0, 0))
    b = body.rest(neck=(2, 0, 12), **{"neck.2": (-2, 0, 16)}, head=(-8, 5, 10))
    d = body.rest(neck=(6, 0, -8), **{"neck.2": (2, 0, -10)}, head=(-2, -4, -8))
    for t, p in ((0, a), (1.1, a), (1.5, b), (2.6, b), (3.0, d), (4.3, d), (5.0, a)):
        c.kd(t, p)
    c.layers += [Q.chew(4, 2.5, 1.6, T=T), Q.breathe(T, 0.4, 0.5),
                 Q.swish([(2.2, 1, 0.45), (2.6, -1, 0.45)], amp=(0, 0, 20), lag=0.05),
                 Q.flicks([(0.9, 0, (0, 0, -30), 0.3), (3.6, 1, (10, 0, -25), 0.35)]),
                 Q.drift(T, {"ear.L": (4, 3, 5), "ear.R": (4, 3, 5)}, seed=23)]
    return c


def clip_walk(body):
    """0.7 m/s lateral-sequence walk, 0.8 s cycle (0.56 m stride)."""
    T, v = WALK_T, WALK_SPEED
    c = L.Clip("sheep.walk", T, True)
    p = body.rest(neck=(6, 0, 0), **{"neck.2": (4, 0, 0)}, head=(-4, 0, 0))
    c.kd(0, p).kd(T, p)
    flex = {"f": [(0.35, 85.0), (0.78, -8.0), (1.0, 0.0)], "h": [(0.3, 30.0), (0.75, -12.0), (1.0, 0.0)]}
    c.layers.append(Q.gait(body, T, v, Q.WALK_PHASE, (0.62, 0.62), flex, (0.03, 0.025), toe=0.02, breakover=(28, 22)))
    c.layers.append(Q.walk_body(T, (0.62, 0.62), bob=0.01, body_len=0.55, roll=2.5, sway=0.008, yaw=1.5, nod=4.0, tail=8))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.WALK_PHASE, 0.62, 0.03))
    return c


def clip_run(body):
    """2.6 m/s bounding trot (0.47 s cycle, 1.2 m stride): diagonal pairs,
    a float between them, head up, the fleece bouncing."""
    T, v = RUN_T, RUN_SPEED
    c = L.Clip("sheep.run", T, True)
    p = body.rest(neck=(-6, 0, 0), **{"neck.2": (-4, 0, 0)}, head=(4, 0, 0))
    c.kd(0, p).kd(T, p)
    duty = 0.38
    flex = {"f": [(0.3, 110.0), (0.75, -18.0), (1.0, -5.0)], "h": [(0.3, 55.0), (0.72, -20.0), (1.0, -5.0)]}
    c.layers.append(Q.gait(body, T, v, Q.TROT_PHASE, (duty, duty), flex, (0.07, 0.06), toe=0.02, breakover=(35, 30)))
    c.layers.append(Q.trot_body(T, duty, bob=0.035, pitch=2.0, roll=2.0, nod=6.0, tail=18.0))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.TROT_PHASE, duty, 0.035))
    c.layers.append(Q.drift(T, {"ear.L": (8, 0, 6), "ear.R": (8, 0, 6)}, seed=24))
    return c


CLIPS = [clip_idle, clip_graze, clip_walk, clip_run]


def build(quick=False, size=512):
    """The sheep: armature `sheep` with one skinned mesh `sheep.body`."""
    with L.stage("sheep: sculpt"):
        sc = Sculpt()
    return Q.build("sheep", sc, skeleton(), CLIPS, (-0.32, -0.80, -0.01), (0.32, 0.62, 0.92), 0.0042, 3600,
                   quick=quick, size=size, ao_scale=1.1, proxy_res=0.007,
                   speeds={"sheep.walk": WALK_SPEED, "sheep.run": RUN_SPEED})
