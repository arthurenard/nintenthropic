"""The dog: the farm's Bernese mountain dog.

Jet black with the breed's rust and white: a white blaze down the face to a
white muzzle, a white cross on the chest, white paws and tail tip; rust on
the cheeks, spots over the eyes, the legs above the white and under the tail.
Long coat (strands that lie back and down), a bushy tail hanging in a
sabre's curve, heavy ears that flop when she runs (a pendulum per ear).

At the farm, 250 m away, she is 30 px long through the scope: a black dog
with a white chest and a moving tail. Clips: idle (panting, tail wagging),
walk, run (a rotary gallop), bark.

Blender space: facing -Y, left +X, paws on z = 0; withers 0.66 m.
"""
import math
import numpy as np
from mathutils import Vector
from . import lib as L, quad as Q
from .lib import S, A, srgb, smoothstep, value_noise, fbm, Frame, nrm, chain, flow_noise, add, pulse

NAME = "dog"
HEAD = Frame((0, -0.46, 0.76), (0, -0.24, -0.06))
HS = 1.18        # the head was sculpted a size too small: scaled about the poll
FUR = 0.026


def big(p):
    """A point of the unscaled head sculpt, where it is on the scaled head."""
    return HEAD.o + (np.asarray(p, float) - HEAD.o) * HS


def small(P):
    """Points on the scaled head, back in the unscaled sculpt's frame (masks)."""
    return HEAD.o + (np.asarray(P, float) - HEAD.o) / HS


def mix(a, b, t):
    t = np.asarray(t, float)[:, None]
    return a * (1 - t) + b * t


def ear_frame(s):
    base = big(HEAD.p(s * 0.062, 0.05, 0.035))
    d = nrm((s * 0.32, -0.08, -1.0))
    return base, d, L.frame_from(d, up=(s * 1.0, 0, 0.0))


class Sculpt:
    def __init__(self):
        H = HEAD
        barrel = L.tube([(0, 0.40, 0.55), (0, 0.30, 0.54), (0, 0.15, 0.53), (0, -0.05, 0.52), (0, -0.22, 0.51),
                         (0, -0.32, 0.51), (0, -0.38, 0.52)],
                        [0.04, 0.10, 0.125, 0.135, 0.14, 0.10, 0.04], [0.05, 0.12, 0.145, 0.165, 0.175, 0.155, 0.06])
        rump = S.Ellipsoid((0, 0.31, 0.55), (0.10, 0.11, 0.12))
        brisket = S.Ellipsoid((0, -0.31, 0.47), (0.095, 0.09, 0.14))
        neck = L.tube([(0, -0.30, 0.56), (0, -0.40, 0.67), (0, -0.46, 0.745)], [0.09, 0.07, 0.06], [0.11, 0.085, 0.07])
        thighs = [S.Ellipsoid((s * 0.085, 0.28, 0.45), (0.06, 0.11, 0.15), S.rot_x(15)) for s in (1, -1)]
        shoulders = [S.Ellipsoid((s * 0.085, -0.27, 0.48), (0.05, 0.09, 0.13), S.rot_x(-20)) for s in (1, -1)]
        core = S.Union([barrel, rump, brisket, neck] + thighs + shoulders, k=0.05)
        self.coat = S.Displace(S.Offset(core, FUR), self.strands, 0.02)
        self.trunk = self.coat
        self.legs = [self.leg(1.0, True), self.leg(-1.0, True), self.leg(1.0, False), self.leg(-1.0, False)]
        self.paws = [self.paw(s * 0.085, -0.30) for s in (1, -1)] + [self.paw(s * 0.085, 0.30) for s in (1, -1)]
        limbs = S.Union([self.coat] + self.legs, k=0.03)
        limbs = S.Union([limbs] + self.paws, k=0.012)
        # --- head: broad flat skull, a stop, a straight strong muzzle, lips
        skull = S.Ellipsoid(H.p(0, 0.07, 0.0), (0.072, 0.09, 0.068), H.R)
        brows = S.Ellipsoid(H.p(0, 0.13, 0.022), (0.058, 0.04, 0.04), H.R)
        muzzle = S.RoundCone(H.p(0, 0.13, -0.022), H.p(0, 0.225, -0.028), 0.046, 0.037)
        flews = [S.Ellipsoid(H.p(s * 0.022, 0.19, -0.054), (0.022, 0.048, 0.028), H.R) for s in (1, -1)]
        self.nose_c = H.p(0, 0.247, -0.008)          # (unscaled: paint works in the unscaled frame)
        nose = S.Ellipsoid(self.nose_c, (0.027, 0.017, 0.02), H.R)
        jaw = S.RoundCone(H.p(0, 0.08, -0.07), H.p(0, 0.215, -0.074), 0.036, 0.024)
        cheeks = [S.Ellipsoid(H.p(s * 0.05, 0.09, -0.035), (0.036, 0.055, 0.042), H.R) for s in (1, -1)]
        self.eyes = [H.p(s * 0.041, 0.137, 0.014) for s in (1, -1)]
        eyes = [S.Sphere(e, 0.0115) for e in self.eyes]
        head = S.Union([skull, brows, muzzle, jaw] + flews + cheeks, k=0.022)
        head = S.Union([head, nose] + eyes, k=0.006)
        nostrils = S.Union([S.Ellipsoid(H.p(s * 0.011, 0.262, -0.008), (0.006, 0.008, 0.005), H.R) for s in (1, -1)])
        self.head = L.scaled(S.Subtract(head, nostrils, k=0.003), HEAD.o, HS)
        self.ear_f = [self.ear(1.0), self.ear(-1.0)]
        tail_c = chain([(0, 0.40, 0.575), (0, 0.47, 0.46), (0, 0.50, 0.32), (0, 0.49, 0.21), (0, 0.46, 0.15)],
                       [0.028, 0.026, 0.022, 0.018, 0.012], n=14)
        self.tail = S.Displace(S.Offset(tail_c, 0.03), self.strands, 0.015)
        body = S.Union([limbs, self.head], k=0.03)
        body = S.Union([body] + self.ear_f, k=0.006)
        body = S.Union([body, self.tail], k=0.02)
        self.body = body
        self.rest = S.Union([limbs, self.head], k=0.03)
        self.all = body
        self.relief = (self.fur_mask, self.detail)
        self.tail_root_z = 0.59
        self.ears = [(ef, ear_frame(s)[0], 0.11 * HS) for s, ef in zip((1, -1), self.ear_f)]

    @staticmethod
    def leg(s, front):
        x = lambda v: s * v
        if front:
            parts = [S.RoundCone((x(0.09), -0.225, 0.33), (x(0.085), -0.27, 0.11), 0.037, 0.025),
                     S.RoundCone((x(0.085), -0.27, 0.10), (x(0.085), -0.29, 0.035), 0.025, 0.027)]
        else:
            parts = [S.RoundCone((x(0.098), 0.16, 0.33), (x(0.085), 0.355, 0.165), 0.048, 0.022),
                     S.Ellipsoid((x(0.09), 0.30, 0.30), (0.035, 0.06, 0.09), S.rot_x(-35)),       # trousers
                     S.Sphere((x(0.085), 0.375, 0.165), 0.02),
                     S.RoundCone((x(0.085), 0.36, 0.16), (x(0.085), 0.305, 0.035), 0.022, 0.026)]
        return S.Union(parts, k=0.018)

    @staticmethod
    def paw(cx, cy):
        pad = S.Ellipsoid((cx, cy - 0.008, 0.022), (0.035, 0.044, 0.026))
        toes = [S.Sphere((cx + dx, cy - 0.035 + abs(dx) * 0.4, 0.016), 0.014) for dx in (-0.021, -0.007, 0.007, 0.021)]
        p = S.Union([pad] + toes, k=0.008)
        lo, hi = (cx - 0.06, cy - 0.07, -0.02), (cx + 0.06, cy + 0.06, 0.06)
        return S.Intersect(p, S.Plane((cx, cy, 0.0), (0, 0, -1), lo, hi))

    @staticmethod
    def ear(s):
        """A heavy triangular flap hanging against the skull."""
        base, d, R = ear_frame(s)
        c = base + d * 0.05 * HS + R[:, 2] * 0.006 * HS
        return S.Ellipsoid(c, (0.04 * HS, 0.058 * HS, 0.011 * HS), R)

    @staticmethod
    def flow(P):
        """Long hair lies back along the body and down the flanks and legs."""
        z = P[:, 2]
        down = smoothstep(0.62, 0.38, z)
        f = np.stack([np.zeros(len(P)), 1.0 - 0.7 * down, -0.3 - 1.3 * down], 1)
        return f / np.linalg.norm(f, axis=1)[:, None]

    def strands(self, P):
        P = np.asarray(P, np.float64)
        fl = self.flow(P)
        a = flow_noise(P, fl, 9.0, 55.0, seed=71)
        b = fbm(P, 16.0, 2, seed=72)
        return (-(0.010 * (a - 0.5) + 0.008 * (b - 0.5))).astype(np.float32)

    def fur_mask(self, Q):
        Qf = np.asarray(Q, np.float32)
        return smoothstep(0.004, -0.004, np.minimum(self.coat(Qf), self.tail(Qf)) - self.head(Qf))

    def detail(self, P, fur):
        P = np.asarray(P, np.float64)
        fl = self.flow(P)
        d = fur * 0.0010 * (flow_noise(P, fl, 12.0, 160.0, seed=73) - 0.5)
        hx, hs, hh = HEAD.local(P)
        fh = np.tile(-HEAD.S, (len(P), 1))
        d += (1 - fur) * 0.0005 * (flow_noise(P, fh, 25.0, 200.0, seed=74) - 0.5)
        return (-d).astype(np.float32)

    def parts(self):
        b = lambda f, d: (lambda P: f(P) - d)
        legs = [S.Union([lg, pw]) for lg, pw in zip(self.legs, self.paws)]
        return ([("coat", self.coat, 1.0), ("head", b(self.head, 0.002), 2.4), ("tail", b(self.tail, 0.002), 1.0)]
                + [(f"ear{i}", b(e, 0.002), 1.6) for i, e in enumerate(self.ear_f)]
                + [(f"leg{i}", lg, 1.1) for i, lg in enumerate(legs)])

    def jaw_mask(self, V):
        hx, hs, hh = HEAD.local(small(V))
        return smoothstep(-0.05, -0.068, hh) * smoothstep(0.07, 0.12, hs) * (hs < 0.28) * (np.abs(hx) < 0.06)

    def extra_jobs(self):
        return []

    def paint(self, P):
        P = np.asarray(P, np.float64)
        Pf = P.astype(np.float32)
        n = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        d_co = self.coat(Pf)
        d_lg = np.min([lg(Pf) for lg in self.legs + self.paws], axis=0)
        d_hd = self.head(Pf)
        d_tl = self.tail(Pf)
        d_ear = np.min([e(Pf) for e in self.ear_f], axis=0)
        near = np.minimum.reduce([d_co, d_lg, d_hd, d_tl, d_ear])
        leg = (d_lg <= near + 0.002) & (z < 0.36)
        inhead = d_hd <= near + 0.002
        tail = d_tl <= near + 0.002
        black = srgb(0.045, 0.04, 0.038)
        rust = srgb(0.46, 0.22, 0.09)
        white = srgb(0.86, 0.84, 0.80)
        fl = self.flow(P)
        hn = flow_noise(P, fl, 9.0, 55.0, seed=71)
        c = np.tile(black, (n, 1)) * (0.8 + 0.5 * hn[:, None])
        r = 0.55 + 0.15 * hn
        # the chest: a white cross with rust at its sides
        front = smoothstep(-0.26, -0.33, y) * (1 - leg)
        cross = front * smoothstep(0.075, 0.05, ax) * smoothstep(0.32, 0.36, z) * smoothstep(0.66, 0.60, z)
        bar = front * smoothstep(0.12, 0.09, ax) * np.exp(-((z - 0.52) / 0.05) ** 2)
        wc = np.clip(np.maximum(cross, bar), 0, 1)
        rs = front * smoothstep(0.16, 0.10, ax) * smoothstep(0.34, 0.40, z) * smoothstep(0.62, 0.56, z) * (1 - wc)
        c = mix(c, rust * (0.85 + 0.3 * hn[:, None]), 0.9 * rs)
        c = mix(c, white * (0.9 + 0.15 * hn[:, None]), wc)
        # legs: black above, rust, white paws (the front legs' rust runs up the front)
        lw = leg.astype(float)
        legrust = lw * smoothstep(0.21, 0.15, z)
        paws = lw * smoothstep(0.075, 0.05, z)
        c = mix(c, rust * (0.85 + 0.3 * hn[:, None]), legrust * (1 - paws))
        c = mix(c, white, paws)
        # rust under the tail, the tail's white tip
        under = (1 - lw) * smoothstep(0.38, 0.42, y) * smoothstep(0.50, 0.44, z) * smoothstep(0.08, 0.03, ax) * (~tail)
        c = mix(c, rust, 0.8 * under)
        tip = tail & (z < 0.2)
        c[tip] = white
        # the head: white blaze to a white muzzle, rust cheeks and eyebrow spots, black nose
        Pu = small(P)
        hx, hs, hh = HEAD.local(Pu)
        hax = np.abs(hx)
        ih = inhead.astype(float)
        blaze = ih * (smoothstep(0.011 + 0.12 * np.clip(hs - 0.1, 0, 1), 0.005 + 0.12 * np.clip(hs - 0.1, 0, 1), hax)
                      * smoothstep(0.03, 0.07, hs))
        muzzle = ih * smoothstep(0.155, 0.18, hs) * smoothstep(0.05, 0.03, hax + 0.3 * np.maximum(hh + 0.02, 0))
        cheek = ih * smoothstep(0.075, 0.1, hs) * smoothstep(0.2, 0.16, hs) * smoothstep(0.025, 0.045, hax) * smoothstep(0.0, -0.03, hh)
        c = mix(c, rust * (0.85 + 0.3 * hn[:, None]), cheek)
        for e in self.eyes:
            spot = e + HEAD.H * 0.026 - HEAD.S * 0.006
            c = mix(c, rust * 1.2, ih * smoothstep(0.016, 0.011, np.linalg.norm(Pu - spot, axis=1)))
        wf = np.clip(np.maximum(blaze, muzzle), 0, 1)
        c = mix(c, white * (0.9 + 0.12 * hn[:, None]), wf)
        nose = ih * smoothstep(0.024, 0.02, np.linalg.norm((Pu - self.nose_c) / np.array([1.0, 1.25, 1.1]), axis=1))
        c = mix(c, srgb(0.03, 0.03, 0.03), nose)
        r = r * (1 - nose) + 0.3 * nose
        lip = ih * smoothstep(-0.068, -0.076, hh) * smoothstep(0.14, 0.18, hs)
        c = mix(c, srgb(0.05, 0.04, 0.04), 0.7 * lip)
        for e in self.eyes:
            d = np.linalg.norm(Pu - e, axis=1)
            ey = smoothstep(0.0118, 0.0105, d)
            side = np.sign((e - HEAD.o) @ HEAD.X)
            look = nrm(HEAD.S + side * HEAD.X * 0.5 + HEAD.H * 0.1)
            pupil = smoothstep(0.0062, 0.0048, np.linalg.norm(Pu - (e + look * 0.0112), axis=1))
            ec = mix(np.tile(srgb(0.22, 0.11, 0.04), (n, 1)), np.tile(srgb(0.01, 0.01, 0.01), (n, 1)), pupil)
            c = mix(c, ec, ey)
            r = r * (1 - ey) + 0.06 * ey
        return np.clip(c, 0, 1), np.clip(r, 0.05, 1), np.zeros(n)


def skeleton():
    H = HEAD
    eb, ed, _ = ear_frame(1.0)
    J = {
        "pelvis": ((0, 0.28, 0.56), (0, 0.06, 0.58)),
        "spine": ((0, 0.06, 0.58), (0, -0.14, 0.59)),
        "chest": ((0, -0.14, 0.59), (0, -0.30, 0.60)),
        "neck": ((0, -0.30, 0.58), (0, -0.40, 0.68)),
        "neck.2": ((0, -0.40, 0.68), (0, -0.46, 0.76)),
        "head": (tuple(HEAD.o), tuple(big(HEAD.p(0, 0.25, 0.0)))),
        "jaw": (big(H.p(0, 0.08, -0.068)), big(H.p(0, 0.225, -0.074))),
        "ear.L": (eb, eb + ed * 0.11 * HS),
        "tail.1": ((0, 0.40, 0.575), (0, 0.47, 0.46)),
        "tail.2": ((0, 0.47, 0.46), (0, 0.50, 0.32)),
        "tail.3": ((0, 0.50, 0.32), (0, 0.46, 0.15)),
        "front.upper.L": ((0.09, -0.30, 0.46), (0.09, -0.225, 0.33)),
        "front.lower.L": ((0.09, -0.225, 0.33), (0.085, -0.27, 0.10)),
        "front.foot.L": ((0.085, -0.27, 0.10), (0.085, -0.30, 0.0)),
        "hind.upper.L": ((0.09, 0.27, 0.50), (0.10, 0.155, 0.33)),
        "hind.lower.L": ((0.10, 0.155, 0.33), (0.085, 0.36, 0.16)),
        "hind.foot.L": ((0.085, 0.36, 0.16), (0.085, 0.30, 0.0)),
    }
    return L.Skeleton(Q.bones(), J)


# ------------------------------------------------------------------ clips

WALK_SPEED, WALK_T = 1.0, 0.7
RUN_SPEED, RUN_T = 4.5, 0.4


def ears(c, gain=1.2, cone=30):
    for b in ("ear.L", "ear.R"):
        c.post.append(L.pendulum(b, damping=4.0, max_deg=cone, gain=gain))


def clip_idle(body):
    """5 s loop: standing, panting, the tail wagging, looking about."""
    T = 5.0
    c = L.Clip("dog.idle", T, True)
    a = body.rest(neck=(-4, 0, 0), head=(4, 0, 0))
    b = body.rest(neck=(-2, 0, 14), **{"neck.2": (0, 0, 16)}, head=(4, 6, 10))
    d = body.rest(neck=(-6, 0, -10), **{"neck.2": (-2, 0, -12)}, head=(2, -5, -8))
    for t, p in ((0, a), (1.2, a), (1.5, b), (2.6, b), (2.9, d), (4.2, d), (4.6, a), (5.0, a)):
        c.kd(t, p, "inout")
    n = 15      # breaths per loop (3 per second)

    def pant(t, pose):
        w = 2 * math.pi * n * t / T
        add(pose, "jaw", (14 + 4 * math.sin(w), 0, 0))
        add(pose, "chest", (-1.2 * math.sin(w), 0, 0))
        add(pose, "head", (0.8 * math.sin(w + 0.5), 0, 0))
        # the tail wags, the tip following the root
        for i, bn in enumerate(("tail.1", "tail.2", "tail.3")):
            add(pose, bn, (-6, 0, (10 + 6 * i) * math.sin(2 * math.pi * 7 * t / T - 0.7 * i)))
    c.layers.append(pant)
    ears(c)
    return c


def clip_walk(body):
    """1.0 m/s lateral-sequence walk, 0.7 s cycle (0.7 m stride)."""
    T, v = WALK_T, WALK_SPEED
    c = L.Clip("dog.walk", T, True)
    p = body.rest(neck=(2, 0, 0), head=(2, 0, 0))
    c.kd(0, p).kd(T, p)
    flex = {"f": [(0.35, 80.0), (0.78, -10.0), (1.0, 0.0)], "h": [(0.3, 40.0), (0.75, -12.0), (1.0, 0.0)]}
    c.layers.append(Q.gait(body, T, v, Q.WALK_PHASE, (0.6, 0.6), flex, (0.035, 0.03), toe=0.03, breakover=(30, 25)))
    c.layers.append(Q.walk_body(T, (0.6, 0.6), bob=0.012, body_len=0.55, roll=2.5, sway=0.01, yaw=2.5, nod=3.0, tail=0))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.WALK_PHASE, 0.6, 0.035))

    def wag(t, pose):
        for i, bn in enumerate(("tail.1", "tail.2", "tail.3")):
            add(pose, bn, (-4, 0, (8 + 5 * i) * math.sin(2 * math.pi * 2 * t / T - 0.8 * i)))
    c.layers.append(wag)
    ears(c)
    return c


def clip_run(body):
    """4.5 m/s rotary gallop, 0.4 s stride (1.8 m): the back stretching and
    rounding, a float with the legs gathered, ears flying."""
    T, v = RUN_T, RUN_SPEED
    c = L.Clip("dog.run", T, True)
    p = body.rest(neck=(8, 0, 0), head=(-4, 0, 0), jaw=(10, 0, 0))
    c.kd(0, p).kd(T, p)
    duty = (0.3, 0.3)
    flex = {"f": [(0.3, 110.0), (0.7, -20.0), (1.0, -8.0)], "h": [(0.35, 70.0), (0.75, -25.0), (1.0, -8.0)]}
    c.layers.append(Q.gait(body, T, v, Q.GALLOP_PHASE, duty, flex, (0.09, 0.08), toe=0.03, breakover=(40, 40)))
    c.layers.append(Q.gallop_body(T, flex=12.0, stretch=0.05, bob=0.05, nod=6.0, tail=10.0))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.GALLOP_PHASE, 0.3, 0.04))
    ears(c, gain=1.4, cone=45)
    return c


def clip_bark(body):
    """1.2 s loop, two barks: braced on the forelegs, the head thrust forward
    and up with each, the jaw snapping open and shut, the tail up and stiff."""
    T = 1.2
    c = L.Clip("dog.bark", T, True)
    base = body.rest(root=(0, 0.0, -0.025), pelvis=(-1, 0, 0), neck=(-8, 0, 0), head=(6, 0, 0))
    c.kd(0, base).kd(T, base)
    fl0, fr0 = Vector(body.foot0["fl"]), Vector(body.foot0["fr"])
    brace = {"ik.fl": tuple(fl0 + Vector((0.012, -0.025, 0))), "ik.fr": tuple(fr0 + Vector((-0.012, -0.025, 0)))}
    c.kd(0, brace).kd(T, brace)

    def barks(t, pose):
        for t0 in (0.1, 0.62):
            e = pulse(t, t0, 0.07, 0.06, 0.25)
            add(pose, "neck", (-8 * e, 0, 0))
            add(pose, "neck.2", (-6 * e, 0, 0))
            add(pose, "head", (-10 * e, 0, 0))
            add(pose, "jaw", (32 * pulse(t, t0 + 0.02, 0.05, 0.06, 0.12), 0, 0))
            add(pose, "root", (0, 0.008 * e, 0.006 * e))
            add(pose, "ear.L", (0, 0, -10 * e))
            add(pose, "ear.R", (0, 0, 10 * e))
        for i, bn in enumerate(("tail.1", "tail.2", "tail.3")):
            add(pose, bn, (-35 + 10 * i, 0, 8 * math.sin(2 * math.pi * 5 * t / T - 0.6 * i)))
    c.layers.append(barks)
    ears(c, gain=1.3)
    return c


CLIPS = [clip_idle, clip_walk, clip_run, clip_bark]


def build(quick=False, size=512):
    """The dog: armature `dog` with one skinned mesh `dog.body`."""
    with L.stage("dog: sculpt"):
        sc = Sculpt()
    return Q.build("dog", sc, skeleton(), CLIPS, (-0.30, -0.78, -0.01), (0.30, 0.62, 0.90), 0.004, 4200,
                   quick=quick, size=size, ao_scale=1.0, proxy_res=0.006,
                   speeds={"dog.walk": WALK_SPEED, "dog.run": RUN_SPEED})
