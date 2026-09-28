"""The goat: a chamois-coloured Swiss mountain goat on an impossible ledge.

Chestnut coat with the breed's black: a stripe down the spine, the belly,
stockings below knees and hocks, stripes from the horns over the eyes to the
muzzle, the tail. Scimitar horns sweep back. Seen at 500-700 m on a grey
cliff face, the warm chestnut against the rock and the horned head held
high are what read; the hop is a big, clear motion.

The hop is in place like every clip, and the game moves the root along a
simple arc (see HOP below and the README): the clip was authored as the
physical path of the body (crouch, push-off, ballistic flight, landing on the
forelegs, absorbing) minus that arc, so as long as the game follows the arc
the body moves as a real jump would.

Blender space: facing -Y, left +X, hooves on z = 0; withers 0.78 m.
"""
import math
import numpy as np
from mathutils import Vector
from . import lib as L, quad as Q
from .lib import S, A, srgb, smoothstep, value_noise, fbm, Frame, nrm, chain, flow_noise, add, pulse

NAME = "goat"
HEAD = Frame((0, -0.44, 0.86), (0, -0.18, -0.14))

# the hop: the game moves the root, during [takeoff, land], from the start to
# start + forward * FORWARD + up * UP along u -> (FORWARD u, UP u + 4 ARC u (1 - u))
HOP = dict(takeoff=0.45, land=1.07, forward=1.62, up=1.5, arc=0.35, duration=1.9)


def mix(a, b, t):
    t = np.asarray(t, float)[:, None]
    return a * (1 - t) + b * t


def ear_frame(s):
    base = HEAD.p(s * 0.04, 0.042, -0.008)
    d = nrm((s * 1.0, -0.2, 0.12))
    return base, d, L.frame_from(d, up=(0, -1.0, 0.5))


def horn_points(s):
    base = HEAD.p(s * 0.024, 0.022, 0.038)
    return [base, base + (s * 0.010, 0.028, 0.065), base + (s * 0.022, 0.085, 0.118), base + (s * 0.032, 0.165, 0.135),
            base + (s * 0.038, 0.225, 0.108)]


class Sculpt:
    def __init__(self):
        H = HEAD
        barrel = L.tube([(0, 0.40, 0.63), (0, 0.32, 0.615), (0, 0.15, 0.595), (0, -0.05, 0.59), (0, -0.20, 0.605),
                         (0, -0.30, 0.615), (0, -0.36, 0.625)],
                        [0.03, 0.10, 0.135, 0.14, 0.125, 0.09, 0.03], [0.04, 0.14, 0.172, 0.178, 0.175, 0.15, 0.04])
        rump = S.Ellipsoid((0, 0.33, 0.64), (0.105, 0.11, 0.13))
        brisket = S.Ellipsoid((0, -0.29, 0.59), (0.095, 0.09, 0.15))
        hips = [S.Ellipsoid((s * 0.07, 0.24, 0.725), (0.028, 0.04, 0.022)) for s in (1, -1)]
        neck = L.tube([(0, -0.27, 0.63), (0, -0.37, 0.745), (0, -0.43, 0.845)], [0.075, 0.056, 0.046], [0.115, 0.08, 0.06])
        thighs = [S.Ellipsoid((s * 0.082, 0.27, 0.50), (0.056, 0.115, 0.16), S.rot_x(15)) for s in (1, -1)]
        shoulders = [S.Ellipsoid((s * 0.08, -0.26, 0.56), (0.045, 0.085, 0.12), S.rot_x(-20)) for s in (1, -1)]
        self.trunk = S.Union([barrel, rump, brisket, neck] + hips + thighs + shoulders, k=0.045)
        self.legs = [self.leg(1.0, True), self.leg(-1.0, True), self.leg(1.0, False), self.leg(-1.0, False)]
        self.hooves = [self.hoof(s * 0.075, -0.30) for s in (1, -1)] + [self.hoof(s * 0.075, 0.31) for s in (1, -1)]
        limbs = S.Union([self.trunk] + self.legs, k=0.03)
        limbs = S.Union([limbs] + self.hooves, k=0.006)
        # --- head: long and narrow, straight in profile
        cran = S.Ellipsoid(H.p(0, 0.045, -0.015), (0.047, 0.058, 0.047), H.R)
        face = S.RoundCone(H.p(0, 0.06, -0.012), H.p(0, 0.19, -0.026), 0.034, 0.021)
        muzzle = S.Ellipsoid(H.p(0, 0.207, -0.034), (0.021, 0.023, 0.024), H.R)
        jaw = S.RoundCone(H.p(0, 0.035, -0.052), H.p(0, 0.198, -0.052), 0.026, 0.013)
        cheeks = [S.Ellipsoid(H.p(s * 0.028, 0.08, -0.04), (0.022, 0.045, 0.032), H.R) for s in (1, -1)]
        self.eyes = [H.p(s * 0.039, 0.07, 0.008) for s in (1, -1)]
        eyes = [S.Sphere(e, 0.0105) for e in self.eyes]
        head = S.Union([cran, face, muzzle, jaw] + cheeks, k=0.016)
        head = S.Union([head] + eyes, k=0.004)
        nostrils = S.Union([S.Ellipsoid(H.p(s * 0.012, 0.232, -0.028), (0.005, 0.009, 0.004), H.R) for s in (1, -1)])
        head = S.Subtract(head, nostrils, k=0.002)
        chin = H.p(0, 0.16, -0.062)
        self.beard = chain([chin, chin + (0, -0.012, -0.03), chin + (0, -0.006, -0.058)], [0.016, 0.014, 0.006], n=8)
        self.head = S.Union([head, self.beard], k=0.008)
        self.ear_f = [self.ear(1.0), self.ear(-1.0)]
        self.tail = chain([(0, 0.39, 0.66), (0, 0.44, 0.705), (0, 0.475, 0.735), (0, 0.495, 0.75)], [0.022, 0.02, 0.015, 0.008], n=10)
        body = S.Union([limbs, self.head], k=0.03)
        body = S.Union([body] + self.ear_f, k=0.006)
        body = S.Union([body, self.tail], k=0.012)
        self.body = body
        self.rest = S.Union([limbs, self.head], k=0.03)
        self.horns = [self.horn(s) for s in (1, -1)]
        self.all = S.Union([body] + self.horns)
        self.relief = (lambda Q: None, lambda P, _: self.detail(P))
        self.tail_root_z = 0.68
        self.ears = [(ef, ear_frame(s)[0], 0.10) for s, ef in zip((1, -1), self.ear_f)]

    @staticmethod
    def leg(s, front):
        x = lambda v: s * v
        if front:
            parts = [S.RoundCone((x(0.08), -0.245, 0.41), (x(0.076), -0.28, 0.23), 0.032, 0.018),
                     S.Sphere((x(0.08), -0.225, 0.415), 0.025),
                     S.Ellipsoid((x(0.076), -0.28, 0.22), (0.019, 0.02, 0.024)),
                     S.RoundCone((x(0.076), -0.28, 0.21), (x(0.075), -0.29, 0.06), 0.015, 0.013),
                     S.Ellipsoid((x(0.075), -0.29, 0.052), (0.017, 0.018, 0.017)),
                     S.RoundCone((x(0.075), -0.291, 0.048), (x(0.075), -0.30, 0.026), 0.014, 0.016)]
        else:
            parts = [S.RoundCone((x(0.088), 0.20, 0.43), (x(0.077), 0.35, 0.285), 0.05, 0.02),
                     S.Ellipsoid((x(0.085), 0.25, 0.40), (0.035, 0.06, 0.07), S.rot_x(-40)),
                     S.RoundCone((x(0.085), 0.33, 0.44), (x(0.077), 0.378, 0.29), 0.012, 0.011),
                     S.Ellipsoid((x(0.077), 0.36, 0.28), (0.018, 0.024, 0.022)),
                     S.RoundCone((x(0.077), 0.355, 0.27), (x(0.075), 0.32, 0.06), 0.016, 0.013),
                     S.Ellipsoid((x(0.075), 0.318, 0.052), (0.017, 0.018, 0.017)),
                     S.RoundCone((x(0.075), 0.316, 0.048), (x(0.075), 0.31, 0.026), 0.014, 0.016)]
        return S.Union(parts, k=0.016)

    @staticmethod
    def hoof(cx, cy):
        h = S.Ellipsoid((cx, cy - 0.004, 0.013), (0.019, 0.027, 0.02))
        lo, hi = (cx - 0.04, cy - 0.05, -0.02), (cx + 0.04, cy + 0.05, 0.05)
        h = S.Intersect(h, S.Plane((cx, cy, 0.0), (0, 0, -1), lo, hi))
        return S.Subtract(h, S.Box((cx, cy - 0.02, 0.015), (0.0015, 0.017, 0.02)), k=0.0015)

    @staticmethod
    def ear(s):
        """Held out sideways and a little forward, cupped to the front."""
        base, d, R = ear_frame(s)
        c = base + d * 0.05
        outer = S.Ellipsoid(c, (0.019, 0.053, 0.009), R)
        cup = S.Ellipsoid(c + R[:, 2] * 0.006 + d * 0.006, (0.013, 0.043, 0.006), R)
        return S.Subtract(outer, cup, k=0.003)

    @staticmethod
    def horn(s):
        pts = horn_points(s)
        return chain(pts, [0.019, 0.017, 0.013, 0.008, 0.003], n=24)

    @staticmethod
    def flow(P):
        z = P[:, 2]
        down = smoothstep(0.62, 0.40, z)
        f = np.stack([np.zeros(len(P)), 1.0 - 0.8 * down, -0.35 - 1.2 * down], 1)
        hx, hs, hh = HEAD.local(P)
        inhead = smoothstep(-0.02, 0.04, hs) * (P[:, 1] < -0.42)
        f = f * (1 - inhead[:, None]) + np.tile(-HEAD.S, (len(P), 1)) * inhead[:, None]
        return f / np.linalg.norm(f, axis=1)[:, None]

    def detail(self, P):
        P = np.asarray(P, np.float64)
        fl = self.flow(P)
        d = 0.0005 * (flow_noise(P, fl, 14.0, 110.0, seed=61) - 0.5)
        return (-d).astype(np.float32)

    def parts(self):
        b = lambda f, d: (lambda P: f(P) - d)
        legs = [S.Union([lg, hf]) for lg, hf in zip(self.legs, self.hooves)]
        return ([("trunk", self.trunk, 1.0), ("head", b(self.head, 0.002), 2.4), ("tail", b(self.tail, 0.002), 1.2)]
                + [(f"ear{i}", b(e, 0.002), 1.8) for i, e in enumerate(self.ear_f)]
                + [(f"leg{i}", lg, 1.1) for i, lg in enumerate(legs)])

    def jaw_mask(self, V):
        hx, hs, hh = HEAD.local(V)
        return smoothstep(-0.038, -0.052, hh) * smoothstep(0.04, 0.09, hs) * (hs < 0.27) * (np.abs(hx) < 0.06)

    def extra_jobs(self):
        jobs = []
        for side, s, h in zip("LR", (1, -1), self.horns):
            ob = L.sculpt_mesh("goat.horn." + side, h, h.lo - 0.01, h.hi + 0.01, 0.0016, 170, symmetry=False)
            jobs.append(dict(ob=ob, field=h, paint=self.horn_paint(s), weight=1.6, skin="head"))
        return jobs

    def paint(self, P):
        P = np.asarray(P, np.float64)
        Pf = P.astype(np.float32)
        n = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        d_tr = self.trunk(Pf)
        d_lg = np.min([lg(Pf) for lg in self.legs + self.hooves], axis=0)
        d_hd = self.head(Pf)
        d_tl = self.tail(Pf)
        d_ear = np.min([e(Pf) for e in self.ear_f], axis=0)
        near = np.minimum.reduce([d_tr, d_lg, d_hd, d_tl, d_ear])
        legw = (d_lg <= near + 0.002).astype(float) * (z < 0.46)
        tail = d_tl <= near + 0.002
        ear = d_ear <= near + 0.002
        chest = srgb(0.47, 0.29, 0.165)
        c = np.tile(chest, (n, 1))
        m = fbm(P, 6.0, 3, seed=62)
        c *= (0.88 + 0.22 * m)[:, None]
        c = mix(c, srgb(0.56, 0.37, 0.22), 0.3 * smoothstep(0.55, 0.68, z) * smoothstep(0.08, 0.14, ax))
        black = srgb(0.045, 0.035, 0.03)
        # the breed's black: dorsal stripe, belly, stockings, tail
        stripe = smoothstep(0.024, 0.012, ax) * smoothstep(0.66, 0.72, z) * (y > -0.40) * (1 - legw)
        belly = smoothstep(0.47, 0.43, z) * smoothstep(0.30, 0.22, y) * smoothstep(-0.32, -0.26, y) * (1 - legw)
        stock = legw * smoothstep(0.30, 0.24, z)
        backleg = legw * smoothstep(0.46, 0.40, z) * 0.0
        blk = np.clip(np.maximum.reduce([stripe, belly, stock, backleg, tail.astype(float)]), 0, 1)
        c = mix(c, black * (0.8 + 0.4 * m[:, None]), blk)
        # hair
        fl = self.flow(P)
        hn = flow_noise(P, fl, 14.0, 110.0, seed=61)
        c *= (0.9 + 0.16 * hn)[:, None]
        r = 0.72 + 0.1 * hn
        hf = (z < 0.03) & (legw > 0.5)
        c[hf] = srgb(0.07, 0.06, 0.05)
        r[hf] = 0.45
        # the face: chestnut, black stripes from the horns over the eyes to the
        # corners of the mouth, a dark muzzle, pale edges to the lips
        hx, hs, hh = HEAD.local(P)
        inh = d_hd <= near + 0.002
        for s in (1, -1):
            # the stripe's centre line runs from (0.030, 0.0) to (0.024, 0.20) in (x, s)
            cx_ = s * (0.030 - 0.03 * np.clip(hs / 0.2, 0, 1))
            band = smoothstep(0.018, 0.010, np.abs(hx - cx_)) * smoothstep(-0.01, 0.02, hs) * smoothstep(0.24, 0.2, hs) * inh
            c = mix(c, black, band * 0.95)
        muz = smoothstep(0.17, 0.2, hs) * inh
        c = mix(c, black * 1.2, muz * 0.9)
        beard = smoothstep(0.004, -0.002, self.beard(Pf) - d_hd) * inh
        c = mix(c, black, beard)
        ec = c[ear].copy()
        c[ear] = mix(ec, srgb(0.62, 0.42, 0.26), 0.4 * np.ones(ear.sum()))
        # eyes: amber with the goat's horizontal pupil
        for e in self.eyes:
            q = P - e
            d = np.linalg.norm(q, axis=1)
            ey = smoothstep(0.0128, 0.0115, d)
            pupil = (np.abs(q[:, 2]) < 0.0025) & (np.abs(q[:, 1]) < 0.0075)
            ec = np.where(pupil[:, None], srgb(0.02, 0.02, 0.02)[None, :], srgb(0.55, 0.40, 0.13)[None, :])
            c = mix(c, ec, ey)
            r = r * (1 - ey) + 0.08 * ey
        return np.clip(c, 0, 1), np.clip(r, 0.05, 1), np.zeros(n)

    @staticmethod
    def horn_paint(s):
        base = horn_points(s)[0]

        def paint(P):
            P = np.asarray(P, np.float64)
            n = len(P)
            t = np.clip(np.linalg.norm(P - base, axis=1) / 0.27, 0, 1)
            ridges = 0.5 + 0.5 * np.sin(t * 150 + 2 * value_noise(P, 120, seed=63))
            c = np.tile(srgb(0.42, 0.37, 0.30), (n, 1)) * (0.75 + 0.3 * ridges[:, None])
            c = mix(c, srgb(0.25, 0.22, 0.19), smoothstep(0.6, 1.0, t))
            return c, 0.55 + 0.15 * ridges, np.zeros(n)
        return paint


def skeleton():
    H = HEAD
    eb, ed, _ = ear_frame(1.0)
    J = {
        "pelvis": ((0, 0.26, 0.64), (0, 0.06, 0.66)),
        "spine": ((0, 0.06, 0.66), (0, -0.14, 0.67)),
        "chest": ((0, -0.14, 0.67), (0, -0.30, 0.69)),
        "neck": ((0, -0.27, 0.62), (0, -0.37, 0.745)),
        "neck.2": ((0, -0.37, 0.745), (0, -0.44, 0.86)),
        "head": ((0, -0.44, 0.86), (0, -0.62, 0.72)),
        "jaw": (H.p(0, 0.035, -0.055), H.p(0, 0.215, -0.06)),
        "ear.L": (eb, eb + ed * 0.10),
        "tail.1": ((0, 0.39, 0.66), (0, 0.44, 0.705)),
        "tail.2": ((0, 0.44, 0.705), (0, 0.475, 0.735)),
        "tail.3": ((0, 0.475, 0.735), (0, 0.50, 0.752)),
        "front.upper.L": ((0.085, -0.32, 0.55), (0.08, -0.24, 0.41)),
        "front.lower.L": ((0.08, -0.24, 0.41), (0.076, -0.28, 0.22)),
        "front.foot.L": ((0.076, -0.28, 0.22), (0.075, -0.30, 0.0)),
        "hind.upper.L": ((0.085, 0.28, 0.58), (0.09, 0.18, 0.42)),
        "hind.lower.L": ((0.09, 0.18, 0.42), (0.077, 0.36, 0.28)),
        "hind.foot.L": ((0.077, 0.36, 0.28), (0.075, 0.31, 0.0)),
    }
    return L.Skeleton(Q.bones(), J)


# ------------------------------------------------------------------ clips

STAND = dict(neck=(-8, 0, 0), **{"neck.2": (-10, 0, 0)}, head=(8, 0, 0))


def stand_pose(body, **kw):
    p = body.rest(**STAND)
    for k, v in kw.items():
        p[k.replace("__", ".")] = v
    return p


def clip_stand(body):
    """6 s loop, alert on the ledge: the head held high, snapping from one
    direction to another and holding still between, ears turning to sounds,
    the tail flicking, a hoof shifted."""
    T = 6.0
    c = L.Clip("goat.stand", T, True)
    looks = [(0.0, 0, 0, 0), (0.9, 0, 0, 0), (1.05, 22, 30, 6), (2.4, 22, 30, 6), (2.55, -18, -26, -5), (3.7, -18, -26, -5),
             (3.85, -6, -8, 18), (4.9, -6, -8, 18), (5.1, 0, 0, 0), (6.0, 0, 0, 0)]
    for t, nz, hz, hx in looks:
        c.kd(t, stand_pose(body, **{"neck.2": (-10, 0, nz), "head": (8 + hx, 0.25 * hz, hz)}), "out")
    fr0 = Vector(body.foot0["fr"])
    for t, lift in ((0, 0), (3.0, 0), (3.12, 0.04), (3.25, 0), (6.0, 0)):
        c.kd(t, {"ik.fr": tuple(fr0 + Vector((0, -0.01 * lift / 0.04, lift))), "rot.fr": (60 * lift / 0.04, 0, 0)})
    c.layers += [Q.breathe(T, 0.5, 0.6),
                 Q.swish([(0.6, 1, 0.18), (0.8, 1, 0.18), (3.3, 1, 0.18), (5.4, 1, 0.2)], amp=(-35, 0, 0), lag=0.03, grow=1.1),
                 Q.flicks([(0.4, 0, (0, 0, 35), 0.35), (1.2, 1, (0, 0, 35), 0.4), (2.7, 0, (15, 0, -30), 0.4),
                           (4.0, 2, (0, 0, 30), 0.45), (5.3, 1, (-15, 0, 25), 0.35)])]
    return c


def clip_bleat(body):
    """1.6 s: the head goes up and forward, the jaw opens and trembles
    ("meh-eh-eh", 0.3-1.0 s), the ears go back, then settles to `stand`."""
    T = 1.6
    c = L.Clip("goat.bleat", T, False)
    s0 = stand_pose(body)
    up = stand_pose(body, neck=(-16, 0, 0), **{"neck.2": (-22, 0, 0)}, head=(-14, 0, 0))
    c.kd(0, s0).kd(0.28, up, "out").kd(1.05, up, "linear").kd(1.4, s0, "inout").kd(T, s0, "linear")
    c.kd(0, {"jaw": (0, 0, 0)}).kd(0.25, {"jaw": (0, 0, 0)}).kd(0.34, {"jaw": (22, 0, 0)}, "out")
    c.kd(0.95, {"jaw": (18, 0, 0)}, "linear").kd(1.12, {"jaw": (0, 0, 0)}, "inout").kd(T, {"jaw": (0, 0, 0)})
    ears_back = {"ear.L": (0, 0, -25), "ear.R": (0, 0, 25)}
    c.kd(0, {"ear.L": (0, 0, 0), "ear.R": (0, 0, 0)}).kd(0.3, ears_back).kd(1.0, ears_back).kd(1.4, {"ear.L": (0, 0, 0), "ear.R": (0, 0, 0)})

    def tremble(t, pose):
        e = smoothstep(0.34, 0.42, t) * (1 - smoothstep(0.9, 1.0, t))
        add(pose, "jaw", (7 * e * math.sin(2 * math.pi * 8.5 * t), 0, 0))
        add(pose, "head", (1.5 * e * math.sin(2 * math.pi * 8.5 * t + 1.0), 0, 0))
    c.layers += [tremble, Q.swish([(0.3, 1, 0.2), (0.55, 1, 0.2)], amp=(-35, 0, 0), lag=0.03, grow=1.1)]
    return c


def hop_root(t):
    """The root arc the game follows (Blender axes: forward is -Y)."""
    t0, t1 = HOP["takeoff"], HOP["land"]
    u = min(max((t - t0) / (t1 - t0), 0.0), 1.0)
    return Vector((0.0, -HOP["forward"] * u, HOP["up"] * u + 4 * HOP["arc"] * u * (1 - u)))


def hop_body(t):
    """The physical path of the pelvis (forward, height), from the start's root:
    a crouch, a 0.1 s push accelerating it to 2.0 m/s forward and 5.25 up, a
    ballistic flight, the forelegs landing just past the top of the arc, and
    0.3 s absorbing the forward speed."""
    t0, t1 = HOP["takeoff"], HOP["land"]
    tc, tp = 0.30, t0 - 0.10
    v0 = (2.0, 5.25)
    fc, zc = -0.02, -0.07
    if t <= tc:
        u = A.ease("inout", t / tc)
        return fc * u, zc * u
    if t <= tp:
        return fc, zc
    if t <= t0:
        u = (t - tp) / (t0 - tp)
        return fc + 0.5 * v0[0] * 0.10 * u * u, zc + 0.5 * v0[1] * 0.10 * u * u
    F0, Z0 = fc + 0.05 * v0[0], zc + 0.05 * v0[1]
    if t <= t1:
        s = t - t0
        return F0 + v0[0] * s, Z0 + v0[1] * s - 4.905 * s * s
    s1 = t1 - t0
    F1, Z1 = F0 + v0[0] * s1, Z0 + v0[1] * s1 - 4.905 * s1 * s1
    vz1 = v0[1] - 9.81 * s1
    Fend, Zend = HOP["forward"], HOP["up"]
    ta = 0.3
    u = min((t - t1) / ta, 1.0)
    F = F1 + (Fend - F1) * (2 * u - u * u)
    # height: from the landing height down into a dip and back up to rest
    Z = Q.hermite(Z1, Zend, vz1 * ta, 0.0, u) - 0.07 * math.sin(math.pi * u) ** 1.5
    return F, Z


def clip_hop(body):
    """1.9 s: the jump up onto a higher ledge (see HOP). 0-0.30 s gather
    (look up at the ledge, sink on the hocks), 0.35 s the forelegs leave,
    0.45 s takeoff (hind hooves leave), flight with the forelegs tucked then
    reaching, 1.07 s the forelegs land, 1.14 s the hind legs, absorb, settle
    to the stand pose by 1.9 s (root then at +1.62 m forward, +1.5 m up)."""
    T = HOP["duration"]
    t0, t1 = HOP["takeoff"], HOP["land"]
    c = L.Clip("goat.hop", T, False)
    s0 = stand_pose(body)
    c.kd(0, s0).kd(T, s0)
    rig = body.rig

    def layer(t, pose):
        F, Z = hop_body(t)
        root = hop_root(t)
        off = Vector((0.0, -F, Z)) - root
        pose["root"] = tuple(off)
        # pitch: nose up through the push, level at the top, nose down to land
        pitch = (-22 * smoothstep(0.30, t0, t) + 22 * smoothstep(t0, 0.78, t) + 12 * smoothstep(0.78, t1, t)
                 - 12 * smoothstep(t1, t1 + 0.25, t))
        crouch = 6 * pulse(t, 0.0, 0.3, 0.05, 0.1)
        add(pose, "pelvis", (pitch + crouch, 0, 0))
        add(pose, "chest", (-4 * pulse(t, 0.3, 0.15, 0.3, 0.3), 0, 0))
        # the head leads: up at the ledge, stretched in the push, up again on landing
        look = pulse(t, 0.0, 0.25, 0.1, 0.25)
        add(pose, "neck.2", (-12 * look - 8 * pulse(t, 0.35, 0.1, 0.3, 0.3) + 10 * pulse(t, t1 - 0.1, 0.1, 0.05, 0.4), 0, 0))
        add(pose, "head", (-10 * look + 8 * pulse(t, 0.4, 0.1, 0.3, 0.3), 0, 0))
        add(pose, "neck", (-pitch * 0.5, 0, 0))
        # legs: planted in the start's world, then tucked to the body, then
        # planted on the ledge (the final root's world)
        R = A.E(pitch + crouch, 0, 0)
        piv = rig.head["pelvis"]
        start = Vector((0, 0, 0)) - root
        final = Vector((0, -HOP["forward"], HOP["up"])) - root
        for leg in ("fl", "fr", "hl", "hr"):
            f0 = Vector(body.foot0[leg])
            front = leg[0] == "f"
            lift_t = 0.35 if front else t0 - 0.02
            land_t = t1 if front else t1 + 0.07
            tuck = Vector((0, 0.09, 0.26)) if front else Vector((0, -0.10, 0.22))
            body_rel = off + piv + R @ (f0 + tuck - piv)
            reach = Vector((0, -0.10, 0.10)) if front else Vector((0, 0.02, 0.10))
            reach_rel = off + piv + R @ (f0 + reach - piv)
            on_start = start + f0
            on_ledge = final + f0
            if t <= lift_t:
                p, rot = on_start, (48 * smoothstep(lift_t - 0.12, lift_t, t) if not front else 0.0)
            elif t >= land_t:
                p, rot = on_ledge, 0.0
            else:
                u = (t - lift_t) / (land_t - lift_t)
                a = smoothstep(0.0, 0.3, u)
                p = on_start.lerp(body_rel, a)
                b = smoothstep(0.55, 0.95, u)
                p = p.lerp(reach_rel, b)
                p = p.lerp(on_ledge, smoothstep(0.85, 1.0, u))
                flexd = 110 if front else 60
                rot = flexd * a * (1 - b) + (-12 if front else -8) * b * (1 - smoothstep(0.9, 1.0, u))
            pose[f"ik.{leg}"] = tuple(p)
            pose[f"rot.{leg}"] = (rot, 0.0, 0.0)
        # the tail up through the jump, ears back in the push
        e = pulse(t, 0.3, 0.1, 0.7, 0.3)
        add(pose, "tail.1", (-30 * e, 0, 0))
        add(pose, "tail.2", (-15 * e, 0, 0))
        add(pose, "ear.L", (0, 0, -20 * e))
        add(pose, "ear.R", (0, 0, 20 * e))
    c.layers.append(layer)
    return c


WALK_SPEED, WALK_T = 0.8, 22 / 30      # a loop must be whole frames long


def clip_walk(body):
    """0.8 m/s lateral-sequence walk (0.73 s cycle, 0.59 m stride), head high."""
    T, v = WALK_T, WALK_SPEED
    c = L.Clip("goat.walk", T, True)
    p = stand_pose(body)
    c.kd(0, p).kd(T, p)
    flex = {"f": [(0.35, 90.0), (0.78, -8.0), (1.0, 0.0)], "h": [(0.3, 32.0), (0.75, -12.0), (1.0, 0.0)]}
    c.layers.append(Q.gait(body, T, v, Q.WALK_PHASE, (0.62, 0.62), flex, (0.035, 0.03), toe=0.02, breakover=(28, 22)))
    c.layers.append(Q.walk_body(T, (0.62, 0.62), bob=0.01, body_len=0.55, roll=2.0, sway=0.008, yaw=1.5, nod=4.0, tail=0))
    c.layers.append(Q.shoulder_slide(body, T, v, Q.WALK_PHASE, 0.62, 0.03))
    return c


CLIPS = [clip_stand, clip_hop, clip_bleat, clip_walk]


def build(quick=False, size=512):
    """The goat: armature `goat` with one skinned mesh `goat.body`."""
    with L.stage("goat: sculpt"):
        sc = Sculpt()
    return Q.build("goat", sc, skeleton(), CLIPS, (-0.30, -0.72, -0.01), (0.30, 0.56, 1.0), 0.0035, 4200,
                   quick=quick, size=size, ao_scale=1.0, proxy_res=0.006,
                   speeds={"goat.walk": WALK_SPEED}, extras={"hop": HOP})
