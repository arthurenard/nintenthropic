"""The counter-sniper's ghillie suit: var.ghillie.

A baggy one-piece suit with a hood, drawn over the whole man (helmet off),
and hundreds of strips of jute and scrim sewn to it. Seen through a scope it
breaks up his outline into a lump of dead grass on a ledge; up close it is
burlap strips in dull greens, tans and browns.

- The suit: the body's fields (tunic, trousers, webbing, head) let out by a
  few centimetres with a lumpy low-frequency swell, the face left open in
  the hood, polygonised and decimated. Skinned from the body like a coat.
- The strips: thin tapered ribbons rooted on the suit, lying along it
  toward the feet (down a standing man, back along a prone one) and lifting
  off it a little; a fringe of them hangs from the hood over the brow. Each
  strip takes the skin weights of its root, so it rides the suit without
  stretching. They are baked with a flat normal and the burlap's colours.
"""
import math
import numpy as np
from charlib import sdf as S, bl, abake as AB, body as BD, head as HD, paint as PT, character as C
from charlib.texture import srgb, smoothstep, value_noise, fbm
from . import wear as W

JUTE = [srgb(0.34, 0.30, 0.20), srgb(0.24, 0.24, 0.15), srgb(0.20, 0.19, 0.12), srgb(0.30, 0.26, 0.17),
        srgb(0.17, 0.18, 0.12), srgb(0.38, 0.34, 0.24), srgb(0.22, 0.20, 0.14)]


def suit_field(spec, tf, wf):
    """The suit's surface: the clothed body let out and swollen, hooded,
    open at the face, cut off above the boots and at the wrists."""
    bp = spec["body"]
    trf = BD.trousers(bp)
    hf = HD.head_sdf(spec["head"], low=True)
    o = HD.HEAD_ORIGIN.astype(np.float32)
    head = S.Fn(lambda P: hf(np.asarray(P, np.float32) - o), hf.lo + o, hf.hi + o)
    # a real union let out by an Offset (charlib's nodes pad their culling by
    # the offset's reach; a box-bounded lookup would grow slabs at 3 cm)
    swollen = S.Displace(S.Offset(S.Union([tf, trf, wf, head], k=0.03), 0.030),
                         lambda P: (-0.024 * (fbm(P, 9, 2, seed=301) - 0.5)).astype(np.float32), 0.013)
    lo, hi = np.array([-0.62, -0.32, 0.10]), np.array([0.62, 0.34, 1.90])

    def f(P):
        d = swollen(P).astype(np.float64)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # the face opening in the hood (head-local ellipse in front of the face)
        q = P - HD.HEAD_ORIGIN
        face = np.sqrt((q[:, 0] / 0.060) ** 2 + ((q[:, 2] + 0.030) / 0.080) ** 2) - 1.0
        face = np.maximum(face * 0.06, -(q[:, 1] + 0.035))
        d = np.maximum(d, -face)
        # open at the wrists and above the boots
        for s in (1, -1):
            from charlib.skeleton import JOINTS
            wr = np.array(JOINTS[f"hand.{'L' if s > 0 else 'R'}"][0])
            el = np.array(JOINTS[f"forearm.{'L' if s > 0 else 'R'}"][0])
            dd = (wr - el) / np.linalg.norm(wr - el)
            cut = (P - (wr - dd * 0.035)) @ dd
            d = np.maximum(d, np.where(np.linalg.norm(P - wr, axis=1) < 0.12, cut, -1.0))
        d = np.maximum(d, 0.20 - z)
        return d.astype(np.float32)
    return S.Fn(f, lo, hi)


def suit_paint(P):
    n = len(P)
    # a mottle of the jute colours, large patches, with a coarse weave
    k = value_noise(P, 7, seed=311)
    idx = np.clip((k * len(JUTE)).astype(int), 0, len(JUTE) - 1)
    base = np.array(JUTE)[idx]
    weave = 0.85 + 0.25 * np.abs(np.sin(P[:, 0] * 900) * np.sin(P[:, 2] * 900))
    col = base * weave[:, None] * (0.8 + 0.4 * fbm(P, 60, 3, seed=312))[:, None]
    return np.clip(col, 0, 1), np.full(n, 0.95), np.zeros(n)


def strands(field, suit_ob, rng, n=900, veil=40):
    """Strip ribbons rooted on the suit mesh. Returns (verts, faces, uvs per
    face corner, root per vertex, strand id per vertex)."""
    V = bl.verts_np(suit_ob)
    F = [tuple(p.vertices) for p in suit_ob.data.polygons]
    tri = []
    for f in F:
        for k in range(1, len(f) - 1):
            tri.append((f[0], f[k], f[k + 1]))
    tri = np.array(tri)
    a, b, c = V[tri[:, 0]], V[tri[:, 1]], V[tri[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    cen = (a + b + c) / 3
    q = cen - HD.HEAD_ORIGIN
    # no strips on the face's rim, the soles, the palms' side of the wrists
    ok = ~((q[:, 1] < -0.03) & (np.abs(q[:, 0]) < 0.08) & (q[:, 2] > -0.12) & (q[:, 2] < 0.06))
    ok &= cen[:, 2] > 0.24
    w = area * ok
    pick = rng.choice(len(tri), size=n, p=w / w.sum())
    roots, dirs = [], []
    for i in pick:
        u, v_ = rng.random(), rng.random()
        if u + v_ > 1:
            u, v_ = 1 - u, 1 - v_
        p = a[i] + (b[i] - a[i]) * u + (c[i] - a[i]) * v_
        roots.append(p)
    roots = np.array(roots, np.float32)
    g = S.gradient(field, roots)
    nrm = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
    # the veil: a fringe hanging from the hood's brow over the face
    th = rng.uniform(-1.0, 1.0, veil)
    brow = HD.HEAD_ORIGIN + np.stack([0.062 * np.sin(th * 1.2), -0.085 + 0.02 * np.abs(th), 0.050 - 0.02 * th ** 2], 1)
    roots = np.vstack([roots, brow.astype(np.float32)])
    nrm = np.vstack([nrm, np.tile([0.0, -1.0, 0.25], (veil, 1)).astype(np.float32)])
    verts, faces, uvs, root_of, sid = [], [], [], [], []
    for k, (p, nn) in enumerate(zip(roots, nrm)):
        nn = nn / np.linalg.norm(nn)
        down = np.array([0.0, 0.0, -1.0])
        t = down - nn * (down @ nn)
        if np.linalg.norm(t) < 0.2:
            t = np.cross(nn, [1.0, 0.0, 0.0])
        t /= np.linalg.norm(t)
        # twist the strip's direction about the normal, lift it off the suit
        ang = rng.normal(0, 0.40)
        side = np.cross(nn, t)
        t = t * math.cos(ang) + side * math.sin(ang)
        lift = rng.uniform(0.06, 0.32) if k < n else rng.uniform(0.02, 0.15)
        L = rng.uniform(0.06, 0.13) if k < n else rng.uniform(0.06, 0.10)
        wd = rng.uniform(0.009, 0.015)
        side = np.cross(nn, t)
        segs = 3
        base = len(verts)
        for s in range(segs + 1):
            u = s / segs
            # curls away from the suit then droops: a strip of cloth
            c_ = p + t * L * u + nn * (0.004 + L * u * math.sin(lift) * (1 - 0.6 * u))
            half = wd * 0.5 * (1 - 0.7 * u)
            twist = rng.normal(0, 0.25) * u
            sd = side * math.cos(twist) + nn * math.sin(twist)
            verts += [c_ - sd * half, c_ + sd * half]
            root_of += [p, p]
            sid += [k, k]
        for s in range(segs):
            i0 = base + 2 * s
            faces.append((i0, i0 + 1, i0 + 3, i0 + 2))
            uvs.append([(0, s / segs), (1, s / segs), (1, (s + 1) / segs), (0, (s + 1) / segs)])
    return np.array(verts, np.float32), faces, uvs, np.array(root_of, np.float32), np.array(sid)


def strand_paint_fn(centres):
    """Each strip one of the jute colours (by its index), fibres along it."""
    pal = np.array(JUTE)
    tone = np.random.default_rng(11).uniform(0.8, 1.15, len(centres))

    def paint(P):
        n = len(P)
        k = np.empty(n, int)
        for i in range(0, n, 4096):
            d = ((P[i:i + 4096, None, :] - centres[None, :, :]) ** 2).sum(-1)
            k[i:i + 4096] = np.argmin(d, 1)
        col = pal[(k * 7 + 3) % len(pal)] * tone[k][:, None]
        fib = value_noise(P, 900, seed=321)
        col *= (0.72 + 0.5 * fib)[:, None]
        return np.clip(col, 0, 1), np.full(n, 0.95), np.zeros(n)
    return paint


def ghillie_jobs(spec, tf, wf, quick=False, seed=7):
    rng = np.random.default_rng(seed)
    sf = suit_field(spec, tf, wf)
    res = 0.012          # the suit is lumpy anyway and decimated hard; its union field is slow to sample
    suit = C.decimated("var.ghillie", sf, sf.lo, sf.hi, res, 2600, None, symmetry=False)
    jobs = [dict(ob=suit, field=sf, paint=suit_paint, origin=np.zeros(3), weight=0.35, ao_field=sf, ao_group="var.ghillie",
                 smart_uv=True, uv_angle=66, skin=("transfer",))]
    V, Fc, UV, roots, sid = strands(sf, suit, rng)
    ob = bl.mesh_from_arrays("var.ghillie.strips", V, Fc)
    bl.set_uv(ob, np.array([u for f in UV for u in f], np.float32))
    nst = sid.max() + 1
    centres = np.array([V[sid == k].mean(0) for k in range(nst)], np.float32)
    jobs.append(dict(ob=ob, field=sf, paint=strand_paint_fn(centres), origin=np.zeros(3), weight=0.55, ao_field=sf,
                     ao_group="var.ghillie", smart_uv=True, uv_angle=80, snap=False, flat=True, skin=("points", roots),
                     join_into="var.ghillie"))
    return jobs
