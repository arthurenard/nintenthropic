"""Signed distance fields in numpy: the "clay" every character is sculpted from.

Why SDFs: a face, a hand or a boot is easiest to describe as soft volumes that
melt into each other (a cheekbone into a cheek, a heel into a sole). Smooth
unions give that for free, and the same field can be polygonised densely for a
high-poly "sculpt" (baked into normal maps) and sampled again to snap a clean
low-poly game mesh onto the exact same surface.

Conventions: negative inside, metres, float32, points are (N, 3) arrays.
Every node knows a bounding box so unions can skip children that are far from
the query points - that is what makes millions of samples affordable.
"""
import math
import numpy as np

F = np.float32


def v3(x):
    return np.asarray(x, dtype=F).reshape(3)


def norm(v):
    v = np.asarray(v, dtype=np.float64)
    return (v / np.linalg.norm(v)).astype(F)


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], F)


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], F)


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], F)


def smin(a, b, k):
    """Polynomial smooth minimum: a fillet of radius ~k where two shapes meet."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


class Node:
    lo = None
    hi = None
    label = 0
    ctx = 0.0          # largest blend radius of any operation enclosing this node

    def __call__(self, P):
        if not getattr(self, "_prepared", False):
            self.prepare(0.0)
        return self.eval(np.asarray(P, dtype=F))

    def prepare(self, ctx):
        """Tell every node how far an enclosing smooth operation reaches, so a
        union only culls children that could not have blended with anything.
        (Culling with only the node's own radius leaves hairline steps in the
        field exactly on box faces - invisible in a mesh, glaring in a normal map.)"""
        self.ctx = max(self.ctx, ctx)
        self._prepared = True
        for c in self._kids():
            c.prepare(self.ctx + self._reach())

    def _kids(self):
        return [getattr(self, a) for a in ("a", "b", "child") if isinstance(getattr(self, a, None), Node)] + \
            list(getattr(self, "children", []))

    def _reach(self):
        return float(getattr(self, "k", 0.0))

    def _pad(self):
        return 2.0 * max(float(getattr(self, "k", 0.0)), self.ctx) + 0.003

    def eval(self, P):
        raise NotImplementedError

    def eval_label(self, P):
        """Distance plus the material label of whichever leaf is nearest."""
        return self.eval(P), np.full(len(P), self.label, np.int16)

    def bbox_dist(self, P):
        q = np.maximum(np.maximum(self.lo - P, P - self.hi), 0.0)
        return np.sqrt((q * q).sum(1))

    # sugar
    def __or__(self, o):
        return Union([self, o])

    def __sub__(self, o):
        return Subtract(self, o)

    def __and__(self, o):
        return Intersect(self, o)

    def tag(self, label):
        self.label = label
        return self


def _inside(P, lo, hi):
    return np.all((P >= lo) & (P <= hi), axis=1)


class Union(Node):
    """Smooth union. Children outside a point's reach contribute a cheap lower
    bound (distance to their box) instead of being evaluated."""

    def __init__(self, children, k=0.0, label=None):
        self.children = [c for c in children if c is not None]
        self.k = float(k)
        self.lo = np.min([c.lo for c in self.children], 0) - self.k
        self.hi = np.max([c.hi for c in self.children], 0) + self.k
        if label is not None:
            self.label = label

    def _eval(self, P, want_label):
        d = np.full(len(P), 1e3, F)
        lab = np.zeros(len(P), np.int16) if want_label else None
        # a culled child must be one that could not have blended with anything:
        # on a fillet the running distance is itself up to ~k, and enclosing
        # operations blend over their own radius (ctx), hence ~2 max(k, ctx)
        pad = self._pad()
        for c in self.children:
            m = _inside(P, c.lo - pad, c.hi + pad)
            idx = np.nonzero(m)[0]
            out = np.nonzero(~m)[0]
            if len(out):
                d[out] = np.minimum(d[out], c.bbox_dist(P[out]))
            if len(idx) == 0:
                continue
            if want_label:
                dc, lc = c.eval_label(P[idx])
                better = dc < d[idx]
                lab[idx[better]] = lc[better]
            else:
                dc = c.eval(P[idx])
            d[idx] = smin(d[idx], dc, self.k)
        return d, lab

    def eval(self, P):
        return self._eval(P, False)[0]

    def eval_label(self, P):
        d, lab = self._eval(P, True)
        if self.label:
            lab[:] = self.label
        return d, lab


class Subtract(Node):
    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi
        self.label = a.label

    def _b(self, P):
        pad = self._pad()
        m = _inside(P, self.b.lo - pad, self.b.hi + pad)
        db = np.full(len(P), 1e3, F)
        idx = np.nonzero(m)[0]
        if len(idx):
            db[idx] = self.b.eval(P[idx])
        return db

    def eval(self, P):
        return smax(self.a.eval(P), -self._b(P), self.k)

    def eval_label(self, P):
        d, lab = self.a.eval_label(P)
        return smax(d, -self._b(P), self.k), lab


class Intersect(Node):
    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo = np.maximum(a.lo, b.lo)
        self.hi = np.minimum(a.hi, b.hi)
        self.label = a.label

    def eval(self, P):
        return smax(self.a.eval(P), self.b.eval(P), self.k)

    def eval_label(self, P):
        d, lab = self.a.eval_label(P)
        return smax(d, self.b.eval(P), self.k), lab


class Displace(Node):
    """Adds a small analytic displacement (wrinkles, folds, seams). `amp` bounds |f|."""

    def _reach(self):
        return self.amp

    def __init__(self, child, fn, amp):
        self.amp = float(amp)
        self.child, self.fn = child, fn
        self.lo, self.hi = child.lo - amp, child.hi + amp
        self.label = child.label

    def eval(self, P):
        return self.child.eval(P) + self.fn(P)

    def eval_label(self, P):
        d, lab = self.child.eval_label(P)
        return d + self.fn(P), lab


class Shell(Node):
    """Hollow version of a shape: |d| - t (for brims, cloth panels)."""

    def _reach(self):
        return self.t

    def __init__(self, child, t):
        self.child, self.t = child, float(t)
        self.lo, self.hi = child.lo - t, child.hi + t
        self.label = child.label

    def eval(self, P):
        return np.abs(self.child.eval(P)) - self.t


class Offset(Node):
    def _reach(self):
        return abs(self.r)

    def __init__(self, child, r):
        self.child, self.r = child, float(r)
        self.lo, self.hi = child.lo - max(r, 0), child.hi + max(r, 0)
        self.label = child.label

    def eval(self, P):
        return self.child.eval(P) - self.r

    def eval_label(self, P):
        d, lab = self.child.eval_label(P)
        return d - self.r, lab


class Fn(Node):
    """Arbitrary field with an explicit box (for one-off shapes)."""

    def __init__(self, fn, lo, hi, label=0):
        self.fn = fn
        self.lo, self.hi = v3(lo), v3(hi)
        self.label = label

    def eval(self, P):
        return self.fn(P).astype(F)


# --------------------------------------------------------------------------- primitives

class Sphere(Node):
    def __init__(self, c, r, label=0):
        self.c, self.r = v3(c), F(r)
        self.lo, self.hi = self.c - r, self.c + r
        self.label = label

    def eval(self, P):
        return np.linalg.norm(P - self.c, axis=1) - self.r


class Ellipsoid(Node):
    """Ellipsoid with radii r along the columns of rotation R (a good bound near the surface)."""

    def __init__(self, c, r, R=None, label=0):
        self.c, self.r = v3(c), v3(r)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        ext = np.abs(self.R) @ self.r
        self.lo, self.hi = self.c - ext, self.c + ext
        self.label = label

    def eval(self, P):
        q = (P - self.c) @ self.R  # into local frame
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return (k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)).astype(F)


class RoundCone(Node):
    """Capsule whose radius goes from ra at a to rb at b (exact, after Inigo Quilez)."""

    def __init__(self, a, b, ra, rb=None, label=0):
        self.a, self.b = v3(a), v3(b)
        self.ra = F(ra)
        self.rb = F(ra if rb is None else rb)
        r = max(self.ra, self.rb)
        self.lo = np.minimum(self.a, self.b) - r
        self.hi = np.maximum(self.a, self.b) + r
        self.label = label

    def eval(self, P):
        a, b, r1, r2 = self.a, self.b, float(self.ra), float(self.rb)
        ba = b - a
        l2 = float(ba @ ba)
        rr = r1 - r2
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        pa = P - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - np.outer(y, ba)
        x2 = (xv * xv).sum(1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2
        out = np.empty(len(P), np.float64)
        c1 = np.sign(z) * a2 * z2 > k
        c2 = np.sign(y) * a2 * y2 < k
        c3 = ~(c1 | c2)
        out[c1] = np.sqrt(x2[c1] + z2[c1]) * il2 - r2
        out[c2] = np.sqrt(x2[c2] + y2[c2]) * il2 - r1
        out[c3] = (np.sqrt(x2[c3] * a2 * il2) + y[c3] * rr) * il2 - r1
        return out.astype(F)


class Box(Node):
    """Rounded box: half extents h along the columns of R, corner radius rad."""

    def __init__(self, c, h, R=None, rad=0.0, label=0):
        self.c, self.h = v3(c), v3(h)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        self.rad = F(rad)
        ext = np.abs(self.R) @ (self.h + rad)
        self.lo, self.hi = self.c - ext, self.c + ext
        self.label = label

    def eval(self, P):
        q = np.abs((P - self.c) @ self.R) - self.h
        outside = np.linalg.norm(np.maximum(q, 0.0), axis=1)
        inside = np.minimum(q.max(1), 0.0)
        return (outside + inside - self.rad).astype(F)


class Torus(Node):
    """Torus in the local XY plane (axis = local Z = third column of R)."""

    def __init__(self, c, R_major, r_minor, R=None, label=0):
        self.c = v3(c)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        self.Rm, self.rm = F(R_major), F(r_minor)
        e = R_major + r_minor
        self.lo, self.hi = self.c - e, self.c + e
        self.label = label

    def eval(self, P):
        q = (P - self.c) @ self.R
        qx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - self.Rm
        return np.sqrt(qx * qx + q[:, 2] ** 2) - self.rm


class Cylinder(Node):
    """Capped cylinder along local Z of R, radius r, half height h, edge radius rad."""

    def __init__(self, c, r, h, R=None, rad=0.0, label=0):
        self.c = v3(c)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        self.r, self.h, self.rad = F(r), F(h), F(rad)
        e = max(r, h) + rad
        self.lo, self.hi = self.c - e * 1.01, self.c + e * 1.01
        self.label = label

    def eval(self, P):
        q = (P - self.c) @ self.R
        dx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - (self.r - self.rad)
        dz = np.abs(q[:, 2]) - (self.h - self.rad)
        o = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dz, 0) ** 2)
        return (o + np.minimum(np.maximum(dx, dz), 0) - self.rad).astype(F)


class Plane(Node):
    """Half space below a plane: n.(p - c) <= 0 is inside. Bounded by an explicit box."""

    def __init__(self, c, n, lo, hi, label=0):
        self.c, self.n = v3(c), norm(n)
        self.lo, self.hi = v3(lo), v3(hi)
        self.label = label

    def eval(self, P):
        return (P - self.c) @ self.n


def catmull(vals, t):
    """Catmull-Rom interpolation of per-station values at fractional station index t."""
    vals = np.asarray(vals, np.float64)
    n = len(vals)
    t = np.clip(t, 0, n - 1)
    i = np.clip(np.floor(t).astype(int), 0, n - 2)
    u = (t - i)[..., None] if vals.ndim > 1 else (t - i)
    p0 = vals[np.clip(i - 1, 0, n - 1)]
    p1 = vals[i]
    p2 = vals[i + 1]
    p3 = vals[np.clip(i + 2, 0, n - 1)]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)


class Tube(Node):
    """A generalised cylinder: the workhorse for torsos, limbs and sleeves.

    Stations along a centre polyline each carry half-widths (rx along `side`,
    ry along side x tangent) and optional radial harmonics, interpolated with
    Catmull-Rom so the silhouette is smooth. Ends are flat caps; they are meant
    to be buried in neighbouring shapes or cut by openings.
    """

    def __init__(self, pts, rx, ry, side=(1, 0, 0), harm=None, label=0, cap=True):
        self.pts = np.asarray(pts, np.float64)
        self.n = len(self.pts)
        self.rx = np.asarray(rx, np.float64)
        self.ry = np.asarray(ry, np.float64)
        # harm: per station list of (k, cos_amp, sin_amp) relative radius modulations
        self.harm = harm
        self.cap = cap
        seg = self.pts[1:] - self.pts[:-1]
        self.seglen = np.linalg.norm(seg, axis=1)
        self.segdir = seg / self.seglen[:, None]
        # station tangents and frames
        tang = np.zeros_like(self.pts)
        tang[0], tang[-1] = self.segdir[0], self.segdir[-1]
        for i in range(1, self.n - 1):
            t = self.segdir[i - 1] + self.segdir[i]
            tang[i] = t / np.linalg.norm(t)
        side = np.asarray(side, np.float64)
        xs = side[None, :] - (tang @ side)[:, None] * tang
        xs /= np.linalg.norm(xs, axis=1)[:, None]
        self.xs = xs
        self.tang = tang
        r = max(self.rx.max(), self.ry.max()) * 1.3
        self.lo = (self.pts.min(0) - r).astype(F)
        self.hi = (self.pts.max(0) + r).astype(F)
        self.label = label

    def radius(self, t, theta):
        rx = catmull(self.rx, t)
        ry = catmull(self.ry, t)
        c, s = np.cos(theta), np.sin(theta)
        R = 1.0 / np.sqrt((c / rx) ** 2 + (s / ry) ** 2)
        if self.harm is not None:
            mod = np.zeros_like(R)
            for k in range(len(self.harm[0])):
                kk = self.harm[0][k][0]
                ca = catmull([h[k][1] for h in self.harm], t)
                sa = catmull([h[k][2] for h in self.harm], t)
                mod += ca * np.cos(kk * theta) + sa * np.sin(kk * theta)
            R = R * (1.0 + mod)
        return R

    def frame_at(self, t):
        i = np.clip(np.floor(t).astype(int), 0, self.n - 2)
        u = (t - i)[:, None]
        c = self.pts[i] * (1 - u) + self.pts[i + 1] * u
        x = self.xs[i] * (1 - u) + self.xs[i + 1] * u
        tg = self.tang[i] * (1 - u) + self.tang[i + 1] * u
        tg /= np.linalg.norm(tg, axis=1)[:, None]
        x = x - (x * tg).sum(1)[:, None] * tg
        x /= np.linalg.norm(x, axis=1)[:, None]
        y = np.cross(tg, x)
        return c, x, y, tg

    def project(self, P):
        """Closest segment -> fractional station index t and the along-axis overshoot at the ends."""
        P = np.asarray(P, np.float64)
        best = np.full(len(P), 1e9)
        bt = np.zeros(len(P))
        for i in range(self.n - 1):
            a = self.pts[i]
            d = self.segdir[i]
            L = self.seglen[i]
            s = np.clip((P - a) @ d, 0, L)
            q = P - (a + s[:, None] * d)
            dist = (q * q).sum(1)
            m = dist < best
            best[m] = dist[m]
            bt[m] = i + s[m] / L
        return bt

    def eval(self, P):
        P64 = np.asarray(P, np.float64)
        t = self.project(P64)
        c, x, y, tg = self.frame_at(t)
        q = P64 - c
        along = (q * tg).sum(1)
        qp = q - along[:, None] * tg
        qx, qy = (qp * x).sum(1), (qp * y).sum(1)
        theta = np.arctan2(qy, qx)
        rho = np.sqrt(qx * qx + qy * qy)
        d = rho - self.radius(t, theta)
        if self.cap:
            # beyond the first/last station the tube is cut flat
            end0 = -((P64 - self.pts[0]) @ self.tang[0])
            end1 = (P64 - self.pts[-1]) @ self.tang[-1]
            e = np.maximum(end0, end1)
            d = np.where(e > 0, np.where(d > 0, np.sqrt(d * d + e * e), e), np.maximum(d, e))
        return d.astype(F)


def gradient(sdf, P, h=2e-4):
    """Central-difference gradient (the fields are not all exact, so no analytic gradients)."""
    P = np.asarray(P, F)
    g = np.empty_like(P)
    for i in range(3):
        e = np.zeros(3, F)
        e[i] = h
        g[:, i] = (sdf(P + e) - sdf(P - e)) / (2 * h)
    return g


def project_to_surface(sdf, P, iters=6, clamp=0.02):
    """Newton steps onto the zero set: p -= f * grad / |grad|^2 (clamped for robustness)."""
    P = np.asarray(P, F).copy()
    for _ in range(iters):
        d = sdf(P)
        g = gradient(sdf, P)
        g2 = np.maximum((g * g).sum(1), 1e-8)
        step = (d / g2)[:, None] * g
        ln = np.linalg.norm(step, axis=1)
        s = np.minimum(1.0, clamp / np.maximum(ln, 1e-9))
        P -= step * s[:, None]
    return P
