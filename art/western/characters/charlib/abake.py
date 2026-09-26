"""Analytic baking: textures straight from the sculpt's field, no rays.

Every part of a character is a signed distance field with a paint function. So
instead of ray-casting from the game mesh to a dense sculpt (which misses on
thin features - a nose bridge, a jaw corner - and needs a cage everywhere), we
rasterise the game mesh's UV triangles in numpy, and for each texel:

  1. take its point on the game mesh,
  2. snap it onto the sculpt's surface by Newton steps along the field's
     gradient (the nearest surface point - it always exists),
  3. evaluate the paint (albedo, roughness, metalness) there,
  4. take the field's gradient as the sculpted normal and express it in the
     game mesh's MikkTSpace tangent frame (what Blender and glTF viewers use),
  5. estimate ambient occlusion by sampling the whole character's field along
     the normal (the classic SDF AO), so a collar darkens the neck under it.

The result is exact, has no misses, and runs in seconds.
"""
import numpy as np
import bpy
from . import sdf as S, bl


def _srgb_encode(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def raster(ob, size, uv_name=None):
    """Texels covered by ob's UV triangles: pixel indices, world position,
    normal, tangent and bitangent sign (interpolated like a vertex shader)."""
    me = ob.data
    uvl = me.uv_layers[uv_name] if uv_name else me.uv_layers.active
    me.calc_tangents(uvmap=uvl.name)
    me.calc_loop_triangles()
    nl = len(me.loops)
    lv = np.empty(nl, np.int32)
    me.loops.foreach_get("vertex_index", lv)
    ln = np.empty(nl * 3, np.float32)
    me.loops.foreach_get("normal", ln)
    ln = ln.reshape(-1, 3)
    lt = np.empty(nl * 3, np.float32)
    me.loops.foreach_get("tangent", lt)
    lt = lt.reshape(-1, 3)
    ls = np.empty(nl, np.float32)
    me.loops.foreach_get("bitangent_sign", ls)
    uv = np.empty(nl * 2, np.float32)
    uvl.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    V = bl.verts_np(ob)
    M = np.array(ob.matrix_world, np.float64)
    V = V @ M[:3, :3].T + M[:3, 3]
    R = M[:3, :3]
    ln = ln @ R.T
    lt = lt @ R.T
    nt = len(me.loop_triangles)
    tl = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    tl = tl.reshape(-1, 3)
    me.free_tangents()
    out_pix, out_p, out_n, out_t, out_s = [], [], [], [], []
    for tri in tl:
        u = uv[tri] * size - 0.5          # texel centres sit at integer coordinates
        x0, y0 = np.floor(u.min(0)).astype(int)
        x1, y1 = np.ceil(u.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        P = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
        a, b, c = u
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (P[:, 0] - c[0]) + (c[0] - b[0]) * (P[:, 1] - c[1])) / d
        w1 = ((c[1] - a[1]) * (P[:, 0] - c[0]) + (a[0] - c[0]) * (P[:, 1] - c[1])) / d
        w2 = 1 - w0 - w1
        e = -0.02  # a hair of overlap so no texel between two triangles is lost
        m = (w0 >= e) & (w1 >= e) & (w2 >= e)
        if not m.any():
            continue
        W = np.stack([w0[m], w1[m], w2[m]], 1)
        vi = lv[tri]
        out_pix.append(P[m].astype(np.int32))
        out_p.append(W @ V[vi])
        out_n.append(W @ ln[tri])
        out_t.append(W @ lt[tri])
        out_s.append(W @ ls[tri])
    pix = np.concatenate(out_pix)
    # a texel claimed by two triangles keeps the first claim
    key = pix[:, 1] * size + pix[:, 0]
    _, first = np.unique(key, return_index=True)
    sel = np.sort(first)
    P = np.concatenate(out_p)[sel]
    N = np.concatenate(out_n)[sel]
    T = np.concatenate(out_t)[sel]
    Sg = np.sign(np.concatenate(out_s)[sel])
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
    T = T - (T * N).sum(1)[:, None] * N
    T /= np.maximum(np.linalg.norm(T, axis=1), 1e-9)[:, None]
    B = np.cross(N, T) * np.where(Sg == 0, 1, Sg)[:, None]
    return pix[sel], P.astype(np.float32), N.astype(np.float32), T.astype(np.float32), B.astype(np.float32)


def sdf_ao(field, P, N, dists=(0.004, 0.009, 0.016, 0.026, 0.040, 0.060), strength=1.0):
    """Occlusion from how much the field closes in along the normal."""
    occ = np.zeros(len(P))
    w = 1.0
    for h in dists:
        d = field((P + N * h).astype(np.float32))
        occ += w * np.clip((h - d) / h, 0, 1)
        w *= 0.72
    norm = sum(0.72 ** i for i in range(len(dists)))
    return np.clip(1 - strength * occ / norm, 0, 1)


class Atlas:
    """The four textures of a character, filled part by part."""

    def __init__(self, size):
        self.size = size
        self.albedo = np.zeros((size, size, 3), np.float32)
        self.normal = np.zeros((size, size, 3), np.float32)
        self.orm = np.zeros((size, size, 3), np.float32)
        self.known = np.zeros((size, size), bool)
        self.debug = np.zeros((size, size, 3), np.float32)  # snap distance, fallback, residual
        self.dbgQ = np.zeros((size, size, 3), np.float32)
        self.dbgN = np.zeros((size, size, 3), np.float32)

    def bake(self, ob, field, paint, ao_field=None, snap=True, snap_iters=5, clamp=0.012,
             grad_eps=2.5e-4, ao_strength=1.0, to_local=None, to_world_dir=None, to_world=None):
        """field/paint take world points unless `to_local` maps world -> the part's frame.
        paint(P) -> (albedo linear (n,3), rough (n,), metal (n,))."""
        pix, P, N, T, B = raster(ob, self.size)
        tl = to_local or (lambda X: X)
        Q = tl(P)
        if snap:
            Q = S.project_to_surface(field, Q, iters=snap_iters, clamp=clamp)
        g = S.gradient(field, Q, grad_eps)
        n_hi = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
        if to_world_dir is not None:
            n_hi = to_world_dir(n_hi)   # part frame -> world (rotations/mirrors only)
        bad = ~np.isfinite(n_hi).all(1) | ((n_hi * N).sum(1) < -0.2)
        n_hi[bad] = N[bad]
        ts = np.stack([(n_hi * T).sum(1), (n_hi * B).sum(1), (n_hi * N).sum(1)], 1)
        ts /= np.maximum(np.linalg.norm(ts, axis=1), 1e-9)[:, None]
        alb, rough, metal = paint(Q)
        if ao_field is not None:
            Pw = to_world(Q) if to_world is not None else P + (Q - tl(P))
            ao = sdf_ao(ao_field, Pw, n_hi, strength=ao_strength)
        else:
            ao = np.ones(len(P))
        y, x = pix[:, 1], pix[:, 0]
        self.albedo[y, x] = alb
        self.normal[y, x] = ts * 0.5 + 0.5
        self.orm[y, x, 0] = ao
        self.orm[y, x, 1] = rough
        self.orm[y, x, 2] = metal
        self.known[y, x] = True
        self.debug[y, x, 0] = np.linalg.norm(Q - tl(P), axis=1)
        self.debug[y, x, 1] = bad
        self.debug[y, x, 2] = np.abs(field(Q))
        self.dbgQ[y, x] = Q
        self.dbgN[y, x] = n_hi
        return len(pix)

    def dilate(self, iters=128):
        """Grow the baked texels outward so filtering never samples the gap between islands."""
        known = self.known.copy()
        arrs = [self.albedo, self.normal, self.orm]
        for _ in range(iters):
            if known.all():
                break
            cnt = np.zeros(known.shape, np.float32)
            accs = [np.zeros_like(a) for a in arrs]
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = np.roll(known, (dy, dx), (0, 1))
                cnt += k
                for acc, a in zip(accs, arrs):
                    acc += np.roll(a, (dy, dx), (0, 1)) * k[..., None]
            grow = (~known) & (cnt > 0)
            for acc, a in zip(accs, arrs):
                a[grow] = acc[grow] / cnt[grow][:, None]
            known |= grow
        rest = ~known
        self.albedo[rest] = 0.3
        self.normal[rest] = (0.5, 0.5, 1.0)
        self.orm[rest] = (1.0, 0.8, 0.0)

    def images(self, name):
        """Blender images (rows already run bottom-up, like UV v and Blender pixels)."""
        out = {}
        for key, arr, srgb in (("albedo", self.albedo, True), ("normal", self.normal, False), ("orm", self.orm, False)):
            img = bpy.data.images.get(f"{name}_{key}")
            if img:
                bpy.data.images.remove(img)
            img = bpy.data.images.new(f"{name}_{key}", self.size, self.size, alpha=False)
            img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
            rgb = _srgb_encode(arr) if srgb else np.clip(arr, 0, 1)
            rgba = np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float32)], 2)
            img.pixels.foreach_set(rgba.astype(np.float32).ravel())
            img.pack()
            out[key] = img
        return out


class WorldUnion:
    """The whole character as one field in world space, for occlusion:
    every part's field, translated into place, combined by a hard min."""

    def __init__(self, parts):
        self.parts = [(f, np.asarray(o, np.float32), None if M is None else np.asarray(M, np.float32)) for f, o, M in parts]

    def __call__(self, P):
        P = np.asarray(P, np.float32)
        d = np.full(len(P), 1.0, np.float32)
        for f, o, M in self.parts:
            Q = P - o if M is None else (P - o) @ M
            # evaluate a part only near its box; farther away its box distance
            # is a safe stand-in (some fields are only distance-like up close)
            m = np.all((Q >= f.lo - 0.01) & (Q <= f.hi + 0.01), axis=1)
            if m.any():
                d[m] = np.minimum(d[m], f(Q[m]))
            if (~m).any():
                q = np.maximum(np.maximum(f.lo - Q[~m], Q[~m] - f.hi), 0)
                d[~m] = np.minimum(d[~m], np.sqrt((q * q).sum(1)))
        return d


def bake_character(jobs, size, name, log=print):
    """UV-pack every job's mesh into one atlas, bake them all, return the images.

    A job: dict(ob, field, paint, origin, weight, ao_field[, smart_uv, ao_strength])."""
    from . import bake as B
    import time
    t = time.time()
    for j in jobs:
        if j.get("smart_uv"):
            B.smart_uv(j["ob"], j.get("uv_angle", 62))
    obs = [j["ob"] for j in jobs]
    B.normalise_density(obs, [j.get("weight", 1.0) for j in jobs])
    B.pack(obs, 0.004)
    log(f"  uv packed {len(obs)} meshes in {time.time() - t:.1f}s")
    groups = {}
    for j in jobs:
        if j.get("ao_field") is not None:
            groups.setdefault(j.get("ao_group", "body"), []).append((j["ao_field"], j["origin"], j.get("M")))
    at = Atlas(size)
    for j in jobs:
        t = time.time()
        # a variant is shadowed by the body and by itself, the body only by itself
        g = j.get("ao_group", "body")
        parts = groups.get("body", []) + (groups.get(g, []) if g != "body" else [])
        if j.get("ao_self_only"):
            parts = groups.get(g, [])
        aof = WorldUnion(parts)
        o = np.asarray(j["origin"], np.float32)
        M = j.get("M")
        if M is None:
            tl, tw, twd = (lambda X, o=o: X - o), (lambda Q, o=o: Q + o), None
        else:
            M = np.asarray(M, np.float32)
            tl = lambda X, o=o, M=M: (X - o) @ M
            tw = lambda Q, o=o, M=M: Q @ M.T + o
            twd = lambda n, M=M: n @ M.T
        n = at.bake(j["ob"], j["field"], j["paint"], ao_field=aof, to_local=tl, to_world=tw, to_world_dir=twd,
                    ao_strength=j.get("ao_strength", 1.0), snap=j.get("snap", True))
        log(f"  baked {j['ob'].name}: {n} texels in {time.time() - t:.1f}s")
    at.dilate()
    imgs = at.images(name)
    imgs['_atlas'] = at
    return imgs
