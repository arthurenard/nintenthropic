"""A small signed-distance-field modeller (numpy only; no Blender in here).

A shape is a function  f(P) -> d  for P an (N, 3) array of points and d the
(approximate) distance to the surface, negative inside. Shapes are combined
with smooth unions so ears melt into heads and tails into bodies, then turned
into a mesh with surface nets (one vertex per cell the surface crosses, a quad
per grid edge it crosses), snapped back onto the surface, and given exact
smooth normals from the field's gradient.

Every coordinate here is the GAME's: metres, y up, the driver faces +z, the
driver's left is +x. (build.py turns them into Blender's frame at the end.)
"""
import numpy as np

# ---------------------------------------------------------------- transforms


def euler(yaw=0.0, pitch=0.0, roll=0.0):
    """A rotation (degrees) as a 3x3 matrix, local -> world: roll about z, then pitch about x, then yaw about y."""
    y, p, r = np.radians([yaw, pitch, roll])
    cy, sy, cp, sp, cr, sr = np.cos(y), np.sin(y), np.cos(p), np.sin(p), np.cos(r), np.sin(r)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return ry @ rx @ rz


def _local(c, rot):
    c = np.asarray(c, float)
    R = None if rot is None else (euler(*rot) if len(np.shape(rot)) == 1 else np.asarray(rot))
    if R is None:
        return lambda P: P - c
    return lambda P: (P - c) @ R


# --------------------------------------------------------------- primitives


def ellipsoid(c, r, rot=None):
    r = np.asarray(r, float)
    loc = _local(c, rot)
    rmin = float(r.min())

    def f(P):
        q = loc(P)
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.maximum(np.linalg.norm(q / (r * r), axis=1), 1e-9)
        return np.where(k0 < 1e-6, -rmin, k0 * (k0 - 1.0) / k1)

    return f


def sphere(c, r):
    c = np.asarray(c, float)
    return lambda P: np.linalg.norm(P - c, axis=1) - r


def roundcone(a, b, ra, rb=None):
    """A capsule from a to b, radius ra at a and rb at b (iq's exact round cone)."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    rb = ra if rb is None else rb
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def f(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        x2 = np.sum((pa * l2 - np.outer(y, ba)) ** 2, axis=1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d_b = np.sqrt(x2 + z2) * il2 - rb
        d_a = np.sqrt(x2 + y2) * il2 - ra
        d_m = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra
        return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_m))

    return f


def box(c, half, rad=0.0, rot=None):
    """A rounded box: `half` the half-extents (the corners are rounded by `rad`, inside them)."""
    half = np.asarray(half, float) - rad
    loc = _local(c, rot)

    def f(P):
        q = np.abs(loc(P)) - half
        return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(np.max(q, axis=1), 0.0) - rad

    return f


def cylinder(c, r, half_h, rad=0.0, rot=None):
    """A rounded cylinder about the local y axis."""
    loc = _local(c, rot)

    def f(P):
        q = loc(P)
        dx = np.hypot(q[:, 0], q[:, 2]) - (r - rad)
        dy = np.abs(q[:, 1]) - (half_h - rad)
        return np.minimum(np.maximum(dx, dy), 0.0) + np.hypot(np.maximum(dx, 0.0), np.maximum(dy, 0.0)) - rad

    return f


def torus(c, R, r, rot=None):
    """A torus about the local y axis: ring radius R, tube radius r."""
    loc = _local(c, rot)

    def f(P):
        q = loc(P)
        return np.hypot(np.hypot(q[:, 0], q[:, 2]) - R, q[:, 1]) - r

    return f




# --------------------------------------------------------------- operators


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def union(*fs, k=0.0):
    def f(P):
        d = fs[0](P)
        for g in fs[1:]:
            d = smin(d, g(P), k)
        return d

    return f


def intersect(a, b, k=0.0):
    return lambda P: smax(a(P), b(P), k)


def subtract(a, b, k=0.0):
    return lambda P: smax(a(P), -b(P), k)


def offset(a, d):
    """Grow (d > 0) or shrink the shape."""
    return lambda P: a(P) - d


def shell(a, t):
    """A hollow skin of thickness 2t about the surface."""
    return lambda P: np.abs(a(P)) - t


def mirror(a):
    """The shape and its mirror image across x = 0 (a shape that sits on the +x side)."""

    def f(P):
        Q = P.copy()
        Q[:, 0] = np.abs(Q[:, 0])
        return a(Q)

    return f


def scaled(a, s, about=(0.0, 0.0, 0.0)):
    """Stretch a shape about a point by s=(sx, sy, sz): a quick way to flatten a capsule into a paddle."""
    s = np.asarray(s, float)
    about = np.asarray(about, float)
    m = float(s.min())
    return lambda P: a(about + (P - about) / s) * m




def chain(points, radii, k=0.0):
    """Round cones joined along a polyline (a tail, an arm, a curl)."""
    parts = [roundcone(points[i], points[i + 1], radii[i], radii[i + 1]) for i in range(len(points) - 1)]
    return union(*parts, k=k)




# ------------------------------------------------------------------ fields


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def inside(f, soft=0.01):
    """A 0..1 weight: 1 well inside the shape, 0 outside, blended across `soft` metres of its surface."""
    return lambda P: 1.0 - smoothstep(-soft, soft, f(P))


def _hash(ix, iy, iz):
    h = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7) * 43758.5453
    return h - np.floor(h)


def noise(P, freq=1.0, seed=0.0):
    """Smooth value noise in 0..1."""
    q = P * freq + seed
    i = np.floor(q)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return out


def srgb(hex_or_rgb):
    """A colour (#rrggbb or sRGB floats) as linear RGB."""
    if isinstance(hex_or_rgb, str):
        s = hex_or_rgb.lstrip("#")
        c = np.array([int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    else:
        c = np.asarray(hex_or_rgb, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def mix(a, b, t):
    t = np.asarray(t, float)
    t = t[:, None] if t.ndim == 1 else t
    return a * (1.0 - t) + b * t


# -------------------------------------------------------- meshing (surface nets)


def sample(f, lo, hi, h, chunk=300000):
    xs = np.arange(lo[0], hi[0] + h * 0.5, h)
    ys = np.arange(lo[1], hi[1] + h * 0.5, h)
    zs = np.arange(lo[2], hi[2] + h * 0.5, h)
    n = len(xs) * len(ys) * len(zs)
    F = np.empty(n, np.float32)
    gx, gy, gz = np.meshgrid(xs, ys, zs, indexing="ij")
    flat = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    for s in range(0, n, chunk):
        F[s:s + chunk] = f(flat[s:s + chunk])
    return F.reshape(len(xs), len(ys), len(zs))


def surface_nets(F, lo, h):
    """Vertices (V,3) and quads (Q,4) of the zero level set of the grid F (negative inside)."""
    nx, ny, nz = F.shape
    cx, cy, cz = nx - 1, ny - 1, nz - 1
    neg = F < 0
    corners = [(i, j, k) for k in (0, 1) for j in (0, 1) for i in (0, 1)]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]

    def at(c):
        i, j, k = c
        return F[i:i + cx, j:j + cy, k:k + cz]

    acc = np.zeros((cx, cy, cz, 3), np.float32)
    cnt = np.zeros((cx, cy, cz), np.int8)
    for a, b in edges:
        fa, fb = at(corners[a]), at(corners[b])
        m = (fa < 0) != (fb < 0)
        denom = np.where(m, fa - fb, 1.0)
        t = np.where(m, fa / denom, 0.0)
        pa = np.array(corners[a], np.float32)
        pb = np.array(corners[b], np.float32)
        acc += np.where(m[..., None], pa + t[..., None] * (pb - pa), 0.0)
        cnt += m
    has = cnt > 0
    idx = np.full((cx, cy, cz), -1, np.int64)
    ids = np.nonzero(has)
    idx[has] = np.arange(len(ids[0]))
    verts = (acc[has] / cnt[has][:, None] + np.stack(ids, axis=1)) * h + np.asarray(lo, float)

    quads = []
    for e in range(3):
        order = (e, (e + 1) % 3, (e + 2) % 3)
        nn = np.transpose(neg, order)
        ii = np.transpose(idx, order)
        s0 = nn[:-1, 1:-1, 1:-1]
        s1 = nn[1:, 1:-1, 1:-1]
        m = s0 != s1
        i, j, k = np.nonzero(m)
        j = j + 1
        k = k + 1
        q = np.stack([ii[i, j - 1, k - 1], ii[i, j, k - 1], ii[i, j, k], ii[i, j - 1, k]], axis=1)
        flip = s0[m]
        q = np.where(flip[:, None], q, q[:, ::-1])
        quads.append(q)
    quads = np.concatenate(quads, axis=0)
    return verts, quads[(quads >= 0).all(axis=1)]


def gradient(f, P, eps=0.0035):
    g = np.empty_like(P)
    for a in range(3):
        d = np.zeros(3)
        d[a] = eps
        g[:, a] = f(P + d) - f(P - d)
    return g / (2 * eps)


def snap(f, P, iterations=3):
    """Move points onto the surface along the gradient."""
    P = P.copy()
    for _ in range(iterations):
        d = f(P)
        g = gradient(f, P)
        P -= (d / np.maximum(np.sum(g * g, axis=1), 1e-9))[:, None] * g
    return P


def normals(f, P):
    g = gradient(f, P)
    return g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]


def occlusion(f, P, N, reach=0.1, steps=5):
    """Ambient occlusion by marching a few steps along the normal: 1 open, toward 0 in a crease."""
    occ = np.zeros(len(P))
    w = 1.0
    for s in range(1, steps + 1):
        d = reach * s / steps
        occ += w * np.maximum(d - f(P + N * d), 0.0) / d
        w *= 0.62
    return np.clip(1.0 - occ * 0.85, 0.0, 1.0)


# ------------------------------------------------------------- explicit meshes


def tube(points, radii, sides=6, closed_ends=True, loop=False):
    """A tube through a polyline (or round a closed loop): (verts, normals, faces). Radii may differ per point."""
    pts = np.asarray(points, float)
    n = len(pts)
    rad = np.broadcast_to(np.asarray(radii, float), (n,)) if np.ndim(radii) else np.full(n, float(radii))
    if loop:
        tang = np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)
        closed_ends = False
    else:
        tang = np.gradient(pts, axis=0)
    tang /= np.linalg.norm(tang, axis=1)[:, None]
    ref = np.array([0.0, 1.0, 0.0])
    verts, nors = [], []
    for i in range(n):
        t = tang[i]
        u = np.cross(t, ref)
        if np.linalg.norm(u) < 1e-3:
            u = np.cross(t, np.array([1.0, 0.0, 0.0]))
        u /= np.linalg.norm(u)
        v = np.cross(t, u)
        for s in range(sides):
            a = 2 * np.pi * s / sides
            d = np.cos(a) * u + np.sin(a) * v
            verts.append(pts[i] + d * rad[i])
            nors.append(d)
    faces = []
    for i in range(n if loop else n - 1):
        j = (i + 1) % n
        for s in range(sides):
            a, b = i * sides + s, i * sides + (s + 1) % sides
            c, d = j * sides + s, j * sides + (s + 1) % sides
            faces.append((a, b, d))
            faces.append((a, d, c))
    verts = np.array(verts)
    nors = np.array(nors)
    if closed_ends:
        for end, sgn in ((0, -1.0), (n - 1, 1.0)):
            c = len(verts)
            verts = np.vstack([verts, pts[end] + tang[end] * rad[end] * 0.15 * sgn])
            nors = np.vstack([nors, tang[end] * sgn])
            for s in range(sides):
                a, b = end * sides + s, end * sides + (s + 1) % sides
                faces.append((a, c, b) if sgn < 0 else (a, b, c))
    return verts, nors, np.array(faces)


def polar_ball(c, r, rings, segs=12, rot=None):
    """An ellipsoid meshed about its local +z pole (so rings are circles round the gaze): (verts, normals, faces, theta).

    `rings` are the polar angles in radians from the pole (first 0.0); if the last is below pi the back is left open.
    """
    r = np.asarray(r, float)
    R = np.eye(3) if rot is None else euler(*rot)
    verts, nors, theta = [], [], []
    for ti, t in enumerate(rings):
        if ti == 0:
            ring = [(0.0, 0.0)]
        else:
            ring = [(t, 2 * np.pi * s / segs) for s in range(segs)]
        for t_, p in ring:
            q = np.array([np.sin(t_) * np.cos(p), np.sin(t_) * np.sin(p), np.cos(t_)]) * r
            nn = np.array([np.sin(t_) * np.cos(p), np.sin(t_) * np.sin(p), np.cos(t_)]) / r
            verts.append(np.asarray(c, float) + R @ q)
            nors.append(R @ (nn / np.linalg.norm(nn)))
            theta.append(t)
    faces = []
    for s in range(segs):
        faces.append((0, 1 + s, 1 + (s + 1) % segs))
    for ti in range(1, len(rings) - 1):
        a0 = 1 + (ti - 1) * segs
        b0 = 1 + ti * segs
        for s in range(segs):
            s1 = (s + 1) % segs
            faces.append((a0 + s, b0 + s, b0 + s1))
            faces.append((a0 + s, b0 + s1, a0 + s1))
    return np.array(verts), np.array(nors), np.array(faces), np.array(theta)


def surface_point(f, x, y, z_hi=0.7, steps=24):
    """Where a ray along -z from (x, y, z_hi) first meets the surface of f (walk in, then bisect). x, y are arrays."""
    x = np.atleast_1d(np.asarray(x, float))
    y = np.atleast_1d(np.asarray(y, float))
    z = np.full(len(x), z_hi)
    for _ in range(140):
        inside = f(np.stack([x, y, z], axis=1)) < 0
        if inside.all():
            break
        z = np.where(inside, z, z - 0.01)
    lo = z
    hi = z + 0.01
    for _ in range(steps):
        mid = (lo + hi) / 2
        inside = f(np.stack([x, y, mid], axis=1)) < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    return np.stack([x, y, (lo + hi) / 2], axis=1)
