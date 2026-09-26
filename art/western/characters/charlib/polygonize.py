"""Turning a signed distance field into a dense mesh (the high-poly "sculpt").

Naive surface nets: one vertex per grid cell the surface passes through, placed
at the mean of the cell's edge crossings, and one quad per crossing edge. It
needs no lookup tables, is fully vectorised, and gives even, well-shaped quads,
which bake cleanly. A final Newton step snaps the vertices onto the true surface.
"""
import math
import numpy as np
from . import sdf as S

F = np.float32


def sample_grid(field, lo, hi, h, block=8):
    """Sample `field` on a regular grid, exactly only near the surface.

    A coarse pass (every `block` cells) finds where the surface can be; fine
    samples are computed only in blocks within reach of it. Elsewhere only the
    sign matters to surface nets, so the coarse value is copied.
    """
    lo = np.asarray(lo, F)
    hi = np.asarray(hi, F)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    nb = (n + block - 1) // block
    n = nb * block + 1
    H = h * block
    ci = [np.arange(nb[i] + 1) for i in range(3)]
    CX, CY, CZ = np.meshgrid(*ci, indexing="ij")
    Pc = lo + np.stack([CX, CY, CZ], -1).reshape(-1, 3).astype(F) * H
    Fc = np.nan_to_num(field(Pc), nan=1.0).reshape(CX.shape)
    # a block is "near" if any of its 8 coarse corners is within reach of the surface
    reach = H * 1.9
    nearc = np.abs(Fc) < reach
    nearb = np.zeros(tuple(nb), bool)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                nearb |= nearc[dx:dx + nb[0], dy:dy + nb[1], dz:dz + nb[2]]
    # default fine values: nearest coarse sample (sign only matters far away)
    idx = [np.minimum((np.arange(n[i]) + block // 2) // block, nb[i]) for i in range(3)]
    G = Fc[np.ix_(idx[0], idx[1], idx[2])].astype(F)
    G = np.where(G < 0, F(-1.0), F(1.0)) * np.maximum(np.abs(G), F(H))
    bi = np.argwhere(nearb)
    if len(bi):
        o = np.stack(np.meshgrid(np.arange(block + 1), np.arange(block + 1), np.arange(block + 1), indexing="ij"), -1).reshape(-1, 3)
        # evaluate in chunks of blocks to bound memory
        chunk = 4096
        for s in range(0, len(bi), chunk):
            b = bi[s:s + chunk]
            gi = (b[:, None, :] * block + o[None, :, :]).reshape(-1, 3)
            P = lo + gi.astype(F) * h
            vals = np.nan_to_num(field(P), nan=1.0)  # a NaN would read as 'outside' silently
            G[gi[:, 0], gi[:, 1], gi[:, 2]] = vals
    return G, lo, h


def surface_nets(G, lo, h):
    """Quads (outward facing) and vertices of the zero level set of grid G."""
    inside = G < 0
    nx, ny, nz = G.shape
    cfg = np.zeros((nx - 1, ny - 1, nz - 1), np.uint8)
    bit = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                cfg |= (inside[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz].astype(np.uint8) << bit)
                bit += 1
    active = (cfg != 0) & (cfg != 255)
    cell_id = np.full(cfg.shape, -1, np.int64)
    nact = int(active.sum())
    cell_id[active] = np.arange(nact)
    sx = np.zeros(nact)
    sy = np.zeros(nact)
    sz = np.zeros(nact)
    cnt = np.zeros(nact)
    quads = []
    shape_c = np.array(cfg.shape)
    for axis in range(3):
        a = G[:nx - (axis == 0), :ny - (axis == 1), :nz - (axis == 2)]
        sl = [slice(None)] * 3
        sl[axis] = slice(1, None)
        b = G[tuple(sl)]
        cross = (a < 0) != (b < 0)
        ii = np.argwhere(cross)
        if len(ii) == 0:
            continue
        av = a[cross].astype(np.float64)
        bv = b[cross].astype(np.float64)
        t = av / (av - bv)
        pos = ii.astype(np.float64)
        pos[:, axis] += t
        pos = lo + pos * h
        others = [ax for ax in range(3) if ax != axis]
        # accumulate the crossing into the four cells sharing this edge
        for d1 in (0, 1):
            for d2 in (0, 1):
                c = ii.copy()
                c[:, others[0]] -= d1
                c[:, others[1]] -= d2
                ok = np.all((c >= 0) & (c < shape_c), axis=1)
                cid = cell_id[c[ok, 0], c[ok, 1], c[ok, 2]]
                sx += np.bincount(cid, pos[ok, 0], nact)
                sy += np.bincount(cid, pos[ok, 1], nact)
                sz += np.bincount(cid, pos[ok, 2], nact)
                cnt += np.bincount(cid, None, nact)
        # one quad per interior crossing edge
        o0, o1 = others
        ok = (ii[:, o0] >= 1) & (ii[:, o0] < G.shape[o0] - 1) & (ii[:, o1] >= 1) & (ii[:, o1] < G.shape[o1] - 1)
        e = ii[ok]
        outward_pos = (av[ok] < 0)  # inside at the low end: surface faces +axis

        def cells(d0, d1_):
            c = e.copy()
            c[:, o0] -= d0
            c[:, o1] -= d1_
            return cell_id[c[:, 0], c[:, 1], c[:, 2]]
        q = np.stack([cells(1, 1), cells(0, 1), cells(0, 0), cells(1, 0)], 1)
        # the (o0, o1) order is right-handed with `axis` for axis 0 and 2, not for 1
        flip = outward_pos if axis == 1 else ~outward_pos
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    verts = np.stack([sx, sy, sz], 1) / np.maximum(cnt, 1)[:, None]
    quads = np.concatenate(quads, 0) if quads else np.zeros((0, 4), np.int64)
    return verts.astype(F), quads


def blur_grid(G, sigma):
    """Separable Gaussian blur of the sampled field: melts the small creases
    where blended volumes meet, the way a sculptor's smooth brush would."""
    r = max(1, int(math.ceil(2.5 * sigma)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k = (k / k.sum()).astype(F)
    for ax in range(3):
        Gp = np.pad(G, [(r, r) if a == ax else (0, 0) for a in range(3)], mode="edge")
        acc = np.zeros_like(G)
        n = G.shape[ax]
        for i, w in enumerate(k):
            sl = [slice(None)] * 3
            sl[ax] = slice(i, i + n)
            acc += w * Gp[tuple(sl)]
        G = acc
    return G


def mesh_sdf(field, lo, hi, h, snap=True, block=8, blur=0.0):
    G, lo, h = sample_grid(field, lo, hi, h, block)
    if blur > 0:
        G = blur_grid(G, blur)
        snap = False  # snapping would undo the smoothing
    V, Q = surface_nets(G, lo, h)
    if snap and len(V):
        V = S.project_to_surface(field, V, iters=2, clamp=h)
    return V, Q
