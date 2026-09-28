"""The valley floor's fields, and what the farmers have done to them this
late-September morning.

The floor is cut into strips square to the river, as alpine valleys are:
26-78 m wide along the river, each split once across into a lower and an
upper field, with the boundaries wandering a little. Every field has a
state, which the land cover and the colour map paint and the detail meshes
dress:

    mown       cut a week ago: short, pale, yellow-green, in mower stripes
    hay        cut and drying: straw windrows, haycocks on poles
    meadow     not yet cut: taller, darker, the autumn crocus in flower
    pasture    grazed: mottled, tussocks of rushes, dung, cow paths
    aftermath  cut early, grown back a vivid green

and every boundary a kind: none (only the uncut strip a mower leaves),
a post-and-rail fence, a dry-stone wall, or a hedge.

Coordinates of a point: `s` along the river, `side` of it, `de` its distance
from the bank (the water's edge plus any gravel bar). Everything here is
deterministic numpy; the land cover asks `query`, the detail stage asks for
the boundaries' polylines.
"""

import math

import numpy as np

from . import layout as L
from . import noise as N
from .noise import smoothstep

SEED = 6060
STATES = ["mown", "hay", "meadow", "pasture", "aftermath"]
P_STATE = np.cumsum([0.30, 0.16, 0.24, 0.20, 0.10])
EDGES = ["none", "fence", "wall", "hedge"]
P_EDGE = np.cumsum([0.40, 0.27, 0.19, 0.14])
BANK = 10.0            # the riparian strip next to the river: rough grass, rushes, bushes
MAX_DE = 460.0


def _hash(*a):
    h = 0.0
    for i, v in enumerate(a):
        h = h + np.asarray(v, float) * (12.9898 + 31.7 * i)
    h = np.sin(h + 4.1) * 43758.5453
    return h - np.floor(h)


class Parcels:
    def __init__(self, riv=None):
        self.riv = riv if riv is not None else L.river(step=2.0)
        rng = np.random.default_rng(SEED)
        self.cuts = {}
        for side in (-1, 1):
            b = [-40.0]
            while b[-1] < self.riv.length + 100:
                b.append(b[-1] + rng.uniform(26.0, 78.0))
            self.cuts[side] = np.array(b)

    # -- coordinates --------------------------------------------------------
    def warp(self, de, s, side):
        return 9.0 * N.fbm(de / 70.0, s / 400.0 + side * 3.1, SEED + 1, 2)

    def row_split(self, side, i):
        return BANK + 50.0 + 75.0 * _hash(side, i, 1.0)

    def coords(self, x, y):
        d, s, side = self.riv.nearest(x, y)
        ok = np.isfinite(d) & (d < MAX_DE + 40.0)
        d = np.where(ok, d, 1e9)
        side = np.where(side >= 0, 1, -1)
        hw, bar, _ = L.river_edges(self.riv, s, side)
        de = d - hw - bar
        return s, side, de, ok

    def query(self, x, y):
        """Per point: in (0/1 inside a field), state index, s_loc (m along the
        river from the field's edge), d_loc (m from its lower edge), width,
        depth, edge (m to the nearest boundary), edge kind index of that
        boundary, de (m from the bank), and the field's id (a float hash)."""
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        s, side, de, ok = self.coords(x, y)
        sw = s + self.warp(de, s, side)
        out = {k: np.zeros(x.shape) for k in ("state", "s_loc", "d_loc", "width", "depth", "edge", "kind", "fid")}
        out["de"] = de
        out["side"] = side
        inside = ok & (de > BANK) & (de < MAX_DE)
        for sd in (-1, 1):
            m = side == sd
            cuts = self.cuts[sd]
            i = np.clip(np.searchsorted(cuts, sw[m]) - 1, 0, len(cuts) - 2)
            a, b = cuts[i], cuts[i + 1]
            sl = sw[m] - a
            width = b - a
            split = self.row_split(sd, i)
            upper = de[m] > split
            j = upper.astype(float)
            d0 = np.where(upper, split, BANK)
            depth = np.where(upper, MAX_DE - split, split - BANK)
            dl = de[m] - d0
            fid = _hash(sd, i, j, 2.0)
            st = np.searchsorted(P_STATE, _hash(sd, i, j, 3.0))
            # the nearest boundary and its kind: the cuts (i, i+1) and the row line
            e_a, e_b = sl, width - sl
            e_row = np.abs(de[m] - split)
            k_a = np.searchsorted(P_EDGE, _hash(sd, i, 5.0))
            k_b = np.searchsorted(P_EDGE, _hash(sd, i + 1, 5.0))
            k_r = np.searchsorted(P_EDGE, _hash(sd, i, 6.0))
            edge = np.minimum.reduce([e_a, e_b, e_row])
            kind = np.where(edge == e_a, k_a, np.where(edge == e_b, k_b, k_r))
            for key, v in (("state", st), ("s_loc", sl), ("d_loc", dl), ("width", width), ("depth", depth),
                           ("edge", edge), ("kind", kind), ("fid", fid)):
                out[key][m] = v
        out["in"] = inside.astype(float)
        return out

    # -- the boundaries as polylines ------------------------------------------
    def point(self, s, de, side):
        """World (x, y) of river coordinates (s, de, side)."""
        s = np.clip(np.asarray(s, float), 0, self.riv.length)
        step = self.riv.s[1] - self.riv.s[0]
        idx = np.clip((s / step).astype(int), 0, len(self.riv.nrm) - 1)
        hw, bar, _ = L.river_edges(self.riv, s, np.full(np.shape(s), side))
        return self.riv.at(s) + self.riv.nrm[idx] * (side * (de + hw + bar))[..., None]

    @staticmethod
    def _smooth(P, iters=6):
        """Offsets from a bending river kink far from it: relax the line, and
        cut it where it still turns sharply."""
        P = P.copy()
        for _ in range(iters):
            P[1:-1] = 0.5 * P[1:-1] + 0.25 * (P[:-2] + P[2:])
        d = np.diff(P, axis=0)
        a = np.arctan2(d[:, 1], d[:, 0])
        turn = np.abs((np.diff(a) + np.pi) % (2 * np.pi) - np.pi)
        cut = np.nonzero(turn > np.radians(40))[0] + 1
        return [q for q in np.split(P, cut) if len(q) >= 3]

    def boundaries(self, step=3.0):
        """[(kind, side, polyline (n, 2))] - every field boundary, the cuts
        across the floor and the row lines along it (unclipped: the caller
        keeps the parts where there are fields)."""
        out = []
        for sd in (-1, 1):
            cuts = self.cuts[sd]
            for i in range(len(cuts)):
                if cuts[i] < 0 or cuts[i] > self.riv.length:
                    continue
                kind = EDGES[int(np.searchsorted(P_EDGE, _hash(sd, i, 5.0)))]
                de = np.arange(BANK, MAX_DE, step)
                s = np.full_like(de, cuts[i])
                for _ in range(2):                 # invert the warp
                    s = cuts[i] - self.warp(de, s, sd)
                # stop where the offsets from the river crowd together (inside
                # a bend the fields' lines would cross)
                pp, pm = self.point(s + 2.0, de, sd), self.point(s - 2.0, de, sd)
                ok = np.linalg.norm(pp - pm, axis=1) / 4.0 > 0.45
                end = int(np.argmin(ok)) if not ok.all() else len(ok)
                if end < 3:
                    continue
                for q in self._smooth(self.point(s[:end], de[:end], sd)):
                    out.append((kind, sd, q))
            for i in range(len(cuts) - 1):
                kind = EDGES[int(np.searchsorted(P_EDGE, _hash(sd, i, 6.0)))]
                de0 = self.row_split(sd, i)
                sw = np.arange(cuts[i], cuts[i + 1], step)
                s = sw.copy()
                for _ in range(2):
                    s = sw - self.warp(np.full_like(sw, de0), s, sd)
                pp, pm = self.point(s + 2.0, np.full_like(s, de0), sd), self.point(s - 2.0, np.full_like(s, de0), sd)
                if (np.linalg.norm(pp - pm, axis=1) / 4.0 < 0.45).any():
                    continue
                for q in self._smooth(self.point(s, np.full_like(s, de0), sd)):
                    out.append((kind, sd, q))
        return out


_P = None


def parcels():
    global _P
    if _P is None:
        _P = Parcels()
    return _P


def pasture(x, y, g, w):
    """Grazed ground over the grass colour g where w (0..1): mottle, rushes,
    dung, cow paths worn to earth. Returns (colour, path weight)."""
    mott = N.fbm(x, y, SEED + 15, 3, scale=1 / 2.5)
    rush = smoothstep(0.5, 0.75, N.fbm(x, y, SEED + 16, 3, scale=1 / 3.0))
    pc = g * (1 + 0.18 * mott)[None]
    pc = pc * (1 - 0.5 * rush) + np.array([0.040, 0.052, 0.022])[:, None] * 0.5 * rush
    cp = np.abs(N.fbm(x, y, SEED + 17, 2, scale=1 / 45.0))
    paths = smoothstep(0.035, 0.012, cp) * smoothstep(0.0, 0.3, N.fbm(x, y, SEED + 18, 2, scale=1 / 25.0))
    return g * (1 - w)[None] + pc * w[None], paths * w * 0.8


def colour(q, x, y, g, floor):
    """The fields' colour over the grass colour g (3, n), linear; `floor`
    0..1 where there are fields. Returns (colour, hay weight 0..1 for the
    alpine-turf channel, path weight 0..1 for the dirt channel)."""
    st = q["state"].astype(int)
    f = floor * q["in"]
    n = len(x)
    c = g.copy()
    hay = np.zeros(n)
    path = np.zeros(n)
    fid = q["fid"]
    sl, dl = q["s_loc"], q["d_loc"]
    # each field its own shade: soil, aspect, when it was manured
    c = c * (1 + 0.16 * (fid - 0.5))[None] * (1 + np.array([0.10, 0.0, -0.14])[:, None] * (_hash(fid, 7.0) - 0.5))
    mown = st == 0
    stripe = np.where(((sl / 2.4).astype(int) % 2) == 0, 1.0, -1.0)
    mc = c * np.array([1.30, 1.18, 0.78])[:, None] * (1 + 0.09 * stripe)[None]
    hayf = st == 1
    wind = smoothstep(0.75, 0.95, np.abs(np.sin(sl * math.pi / 6.5 + 0.8 * N.fbm(x, y, SEED + 11, 2, scale=1 / 9.0))))
    hc = c * np.array([1.40, 1.20, 0.72])[:, None] * (1 - 0.5 * wind) + np.array([0.30, 0.25, 0.12])[:, None] * 0.5 * wind
    meadow = st == 2
    crocus = smoothstep(0.55, 0.8, N.fbm(x, y, SEED + 12, 3, scale=1 / 2.2)) * smoothstep(-0.1, 0.3, N.fbm(x, y, SEED + 13, 2, scale=1 / 30.0))
    white = smoothstep(0.62, 0.85, N.fbm(x, y, SEED + 14, 3, scale=1 / 1.6))
    mc2 = c * np.array([0.74, 0.88, 0.86])[:, None]
    mc2 = mc2 * (1 - 0.55 * crocus) + np.array([0.30, 0.17, 0.34])[:, None] * 0.55 * crocus
    mc2 = mc2 * (1 - 0.3 * white) + np.array([0.42, 0.42, 0.36])[:, None] * 0.3 * white
    past = st == 3
    mott = N.fbm(x, y, SEED + 15, 3, scale=1 / 2.5)
    rush = smoothstep(0.5, 0.75, N.fbm(x, y, SEED + 16, 3, scale=1 / 3.0))
    pc = c * (1 + 0.16 * mott)[None] * np.array([0.95, 0.98, 1.0])[:, None]
    pc = pc * (1 - 0.5 * rush) + np.array([0.040, 0.052, 0.022])[:, None] * 0.5 * rush
    # cow paths: winding lines where a slow noise crosses zero, worn to earth
    cp = np.abs(N.fbm(x, y, SEED + 17, 2, scale=1 / 45.0))
    paths = smoothstep(0.035, 0.012, cp) * smoothstep(0.0, 0.3, N.fbm(x, y, SEED + 18, 2, scale=1 / 25.0))
    aft = st == 4
    ac = c * np.array([0.88, 1.22, 0.92])[:, None]
    out = np.where(mown[None], mc, np.where(hayf[None], hc, np.where(meadow[None], mc2, np.where(past[None], pc, ac))))
    # the uncut strip the mower leaves along a boundary, nettles by a wall
    strip = smoothstep(1.8, 0.5, q["edge"]) * (~past)
    out = out * (1 - 0.5 * strip)[None] + (g * np.array([0.72, 0.86, 0.8])[:, None]) * (0.5 * strip)[None]
    c = g * (1 - f)[None] + out * f[None]
    hay = f * (hayf * (0.35 + 0.5 * wind) + mown * 0.18)
    path = f * past * paths * 0.8
    return c, hay, path
