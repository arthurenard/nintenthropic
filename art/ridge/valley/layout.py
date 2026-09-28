"""The plan of the Valle Serra: every curve and site the other modules share.

Blender coordinates, metres: the player's eye at the origin, looking down +Y
(the exporter turns that into glTF -Z, as the contract wants), +X to his
right, Z up. The valley floor lies about 60 m below the eye.

The valley bends round the spur the player lies on. The river comes out of
the dam at the valley's head (far right, 900 m), runs toward the player to
the stone bridge at the apex of the bend (350 m, straight ahead), then turns
left and away down-valley into the haze. The road follows the near bank
(the player's side) past the farm (250 m left) to the checkpoint (280 m),
crosses the bridge, climbs through the village on its alluvial fan (500 m),
and traverses the far slope up to the dam's crest and the tunnel (900 m).
The far side rises through forest, a band of cliffs and alpine meadows to a
wall of peaks 2-3.5 km away, the highest (the Punta Serra) nearly straight
ahead.

Distances in the design doc are ranges from the eye; `polar()` places things
by (bearing, range): bearing in degrees from straight ahead, positive right.
"""

import math

import numpy as np

EYE = np.array([0.0, 0.0, 0.0])
FLOOR_Z = -60.0            # the valley floor at the bridge, 60 m below the eye

# the player's view (camera.player): vertical field of view and pitch
VFOV_DEG = 50.0
PITCH_DEG = -1.0

# the low dawn sun, behind the player's left shoulder: bearing of the sun
# (degrees from straight ahead, positive right: 215 = behind and to the left)
SUN_BEARING = 215.0
SUN_ELEV = 5.5             # at the start of a run; the game raises it slowly
SUN_ELEV_RANGE = (4.0, 9.0)


def polar(bearing_deg, rng, z=0.0):
    b = math.radians(bearing_deg)
    return np.array([rng * math.sin(b), rng * math.cos(b), z])


def bearing_range(p):
    return math.degrees(math.atan2(p[0], p[1])), math.hypot(p[0], p[1])


def sun_vector(elev=SUN_ELEV, bearing=SUN_BEARING):
    """Unit vector from the scene toward the sun (Blender axes)."""
    b, e = math.radians(bearing), math.radians(elev)
    return np.array([math.sin(b) * math.cos(e), math.cos(b) * math.cos(e), math.sin(e)])


# ---------------------------------------------------------------------------
# Curves

class Curve:
    """A smooth curve through control points (Catmull-Rom, centripetal-ish),
    resampled every `step` metres, carrying per-point values (z, width...)
    interpolated along it."""

    def __init__(self, pts, step=1.0, closed=False, **values):
        P = np.asarray(pts, float)
        self.closed = closed
        dense = _catmull(P[:, :2], 16, closed)
        seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
        s = np.concatenate([[0.0], np.cumsum(seg)])
        n = max(int(s[-1] / step), 2)
        si = np.linspace(0, s[-1], n + 1)
        self.xy = np.stack([np.interp(si, s, dense[:, 0]), np.interp(si, s, dense[:, 1])], 1)
        self.s = si
        self.length = si[-1]
        # control point arc positions, to interpolate the per-point values
        cps = []
        for p in P[:, :2]:
            cps.append(si[np.argmin(np.linalg.norm(self.xy - p, axis=1))])
        self.cps = np.array(cps)
        self.values = {}
        for k, v in values.items():
            v = np.asarray(v, float)
            self.values[k] = np.interp(si, self.cps, v)
        t = np.gradient(self.xy, axis=0)
        self.tan = t / np.maximum(np.linalg.norm(t, axis=1), 1e-9)[:, None]
        self.nrm = np.stack([-self.tan[:, 1], self.tan[:, 0]], 1)   # left of the direction of travel

    def __getitem__(self, k):
        return self.values[k]

    def at(self, s, key=None):
        s = np.clip(s, 0, self.length)
        if key is None:
            return np.stack([np.interp(s, self.s, self.xy[:, 0]), np.interp(s, self.s, self.xy[:, 1])], -1)
        return np.interp(s, self.s, self.values[key])

    def point3(self, s, key='z'):
        xy = self.at(s)
        return np.array([xy[0], xy[1], self.at(s, key)])

    def nearest(self, x, y, max_dist=None):
        """(distance, arc position, signed side) of points to the curve;
        side > 0 left of the direction of travel. With max_dist, vectorised
        by segment with a bounding-box cull; without, a two-level search (a
        coarse polyline finds the neighbourhood, the fine one the answer),
        so either scales to millions of points."""
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        shape = np.broadcast(x, y).shape
        xf = np.broadcast_to(x, shape).ravel()
        yf = np.broadcast_to(y, shape).ravel()
        if max_dist is None:
            return tuple(a.reshape(shape) for a in self._nearest_all(xf, yf))
        best = np.full(xf.shape, np.inf)
        bs = np.zeros(xf.shape)
        side = np.zeros(xf.shape)
        P = self.xy
        # coarse chunks of the polyline for culling
        C = 32
        md = max_dist if max_dist is not None else np.inf
        for c0 in range(0, len(P) - 1, C):
            c1 = min(c0 + C, len(P) - 1)
            seg = P[c0:c1 + 1]
            lo = seg.min(0) - (md if np.isfinite(md) else 1e9)
            hi = seg.max(0) + (md if np.isfinite(md) else 1e9)
            m = (xf >= lo[0]) & (xf <= hi[0]) & (yf >= lo[1]) & (yf <= hi[1])
            if not m.any():
                continue
            idx = np.nonzero(m)[0]
            px, py = xf[idx], yf[idx]
            for i in range(c0, c1):
                ax, ay = P[i]
                bx, by = P[i + 1]
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                t = np.clip(((px - ax) * dx + (py - ay) * dy) / max(L2, 1e-12), 0, 1)
                qx = ax + t * dx - px
                qy = ay + t * dy - py
                d = np.sqrt(qx * qx + qy * qy)
                better = d < best[idx]
                if better.any():
                    j = idx[better]
                    best[j] = d[better]
                    bs[j] = self.s[i] + t[better] * (self.s[i + 1] - self.s[i])
                    side[j] = np.sign(dx * (py[better] - ay) - dy * (px[better] - ax))
        return best.reshape(shape), bs.reshape(shape), side.reshape(shape)

    def _seg_query(self, px, py, i):
        """Distance etc. from points to segment i (arrays of segment indices allowed)."""
        P = self.xy
        i = np.clip(i, 0, len(P) - 2)
        ax, ay = P[i, 0], P[i, 1]
        dx, dy = P[i + 1, 0] - ax, P[i + 1, 1] - ay
        L2 = np.maximum(dx * dx + dy * dy, 1e-12)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
        qx = ax + t * dx - px
        qy = ay + t * dy - py
        d = np.sqrt(qx * qx + qy * qy)
        s = self.s[i] + t * (self.s[i + 1] - self.s[i])
        side = np.sign(dx * (py - ay) - dy * (px - ax))
        return d, s, side

    def _nearest_all(self, xf, yf):
        K = 24
        n = len(self.xy) - 1
        coarse = np.arange(0, n, K)
        best = np.full(xf.shape, np.inf)
        bi = np.zeros(xf.shape, np.int64)
        P = self.xy
        for ci in coarse:
            j = min(ci + K, n)
            ax, ay = P[ci]
            bx, by = P[j]
            dx, dy = bx - ax, by - ay
            L2 = max(dx * dx + dy * dy, 1e-12)
            t = np.clip(((xf - ax) * dx + (yf - ay) * dy) / L2, 0, 1)
            d = np.hypot(ax + t * dx - xf, ay + t * dy - yf)
            b = d < best
            best[b] = d[b]
            bi[b] = ci
        # refine among the fine segments of the chosen coarse one and its neighbours
        best = np.full(xf.shape, np.inf)
        bs = np.zeros(xf.shape)
        side = np.zeros(xf.shape)
        for off in range(-K, 2 * K):
            i = bi + off
            ok = (i >= 0) & (i < n)
            d, s, sd = self._seg_query(xf, yf, np.clip(i, 0, n - 1))
            b = ok & (d < best)
            best[b] = d[b]
            bs[b] = s[b]
            side[b] = sd[b]
        return best, bs, side


def _catmull(P, sub, closed=False):
    if closed:
        P = np.vstack([P[-1:], P, P[:2]])
    else:
        P = np.vstack([P[:1] * 2 - P[1:2], P, P[-1:] * 2 - P[-2:-1]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def _pb(pairs):
    return [polar(b, r)[:2] for b, r in pairs]


# ---------------------------------------------------------------------------
# The river, from the dam's outflow down-valley. Water surface z, width.

RIVER_PTS = _pb([(31.0, 905), (27.5, 790), (22.0, 650), (16.5, 530), (12.0, 440), (8.5, 380), (6.0, 350),
                 (0.0, 327), (-5.0, 320), (-15.0, 325), (-25.0, 360), (-33.0, 440), (-38.0, 600),
                 (-41.0, 900), (-43.0, 1400), (-44.0, 2200), (-45.0, 3500), (-45.5, 5200), (-46.0, 7500)])
RIVER_Z = [-50.4, -53.0, -55.8, -57.8, -59.2, -60.2, -60.6, -60.9, -61.1, -61.4, -61.7, -62.1, -62.8,
           -63.9, -65.6, -68.2, -72.5, -78.0, -85.0]
RIVER_W = [10.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 17.0, 17.5, 18.0, 18.5, 19.0, 20.0,
           21.0, 23.0, 25.0, 28.0, 30.0, 32.0]
# half-widths of the flat valley floor beside the river, on the player's
# (near) side and the far side: the gorge at the dam, the far-bank fan the
# village stands on, the broad floor down-valley
RIVER_WN = [14, 18, 24, 32, 38, 44, 48, 52, 55, 57, 58, 60, 64, 75, 95, 120, 150, 170, 190]
RIVER_WF = [14, 20, 35, 70, 130, 190, 230, 250, 250, 245, 230, 215, 200, 190, 175, 170, 180, 190, 200]


def river(step=1.0):
    c = Curve(RIVER_PTS, step=step, z=RIVER_Z, w=RIVER_W)
    # down-valley, past the bend, the river wanders across its floor in
    # meanders a couple of hundred metres long (the plan's points only give
    # its course)
    from . import noise as N
    ramp = np.clip((c.s - 950.0) / 350.0, 0, 1) ** 2
    off = 24.0 * N.fbm(c.s / 230.0, np.full_like(c.s, 0.73), 7704, 3) * ramp
    # never toward the near-bank road closer than 34 m (the road's plan
    # points: road() itself needs the river for the bridge's axis)
    R = np.array(_pb(ROAD_NEAR))
    best = np.full(len(c.s), np.inf)
    toward = np.zeros(len(c.s))
    for a, b in zip(R[:-1], R[1:]):
        ab = b - a
        t = np.clip(((c.xy - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
        q = a + t[:, None] * ab
        d = np.linalg.norm(q - c.xy, axis=1)
        better = d < best
        best = np.where(better, d, best)
        toward = np.where(better, np.sign(((q - c.xy) * c.nrm).sum(1)), toward)
    room = np.maximum(best - 34.0, 0.0)
    off = np.where(np.sign(off) == toward, np.clip(off, -room, room), off)
    c.xy = c.xy + c.nrm * off[:, None]
    t = np.gradient(c.xy, axis=0)
    c.tan = t / np.maximum(np.linalg.norm(t, axis=1), 1e-9)[:, None]
    c.nrm = np.stack([-c.tan[:, 1], c.tan[:, 0]], 1)
    _river_shape(c)
    return c


def _river_shape(c):
    """A river, not a canal: the water's two edges drawn separately.

        wl, wr   half-widths of the water, left and right of the flow: the
                 width breathes +-25% along the river, and on the inside of
                 a bend the water pulls back from a gravel bar
        bl, br   the bar's width beyond the water's edge (0 on straights)
        ul, ur   0..1, how much the outside of a bend cuts under its bank
                 (a steep earth scarp, the deep water beside it)

    Held steady by the bridge (its arches were built for the channel) and at
    the dam's outlet."""
    from . import noise as N
    s = c.s
    half = c.values['w'] / 2
    ds = max(s[1] - s[0], 1e-6)
    sb = c.nearest(np.array([BRIDGE_C[0]]), np.array([BRIDGE_C[1]]))[1][0]
    calm = np.minimum(np.clip((np.abs(s - sb) - 30.0) / 50.0, 0, 1), np.clip((s - 40.0) / 60.0, 0, 1))
    breathe = 1 + 0.25 * N.fbm(s / 140.0, np.full_like(s, 0.37), 7703, 3) * calm
    k = max(int(30.0 / ds), 1)
    i = np.arange(len(s))
    t0, t1 = c.tan[np.clip(i - k, 0, len(s) - 1)], c.tan[np.clip(i + k, 0, len(s) - 1)]
    curv = t0[:, 0] * t1[:, 1] - t0[:, 1] * t1[:, 0]           # > 0: the river turns left
    left_in = np.clip(curv * 3.5, 0, 1) * calm
    right_in = np.clip(-curv * 3.5, 0, 1) * calm
    h = half * breathe
    c.values['wl'] = h * (1 - 0.36 * left_in)
    c.values['wr'] = h * (1 - 0.36 * right_in)
    c.values['bl'] = h * 0.36 * left_in + 7.0 * left_in
    c.values['br'] = h * 0.36 * right_in + 7.0 * right_in
    c.values['ul'] = right_in
    c.values['ur'] = left_in


def river_edges(riv, s, side):
    """(water half-width, bar width, undercut) on the given side of the
    river at arc positions s (side > 0: left of the flow)."""
    left = np.asarray(side) > 0
    pick = lambda a, b: np.where(left, riv.at(s, a), riv.at(s, b))
    return pick('wl', 'wr'), pick('bl', 'br'), pick('ul', 'ur')


# the stone bridge: centre, and its axis across the river
BRIDGE_C = polar(6.0, 350)[:2]
BRIDGE_LEN = 44.0          # abutment to abutment
BRIDGE_DECK_Z = FLOOR_Z + 6.2


def bridge_axis():
    """Unit vector along the bridge, from the near bank to the far bank:
    square to the river where it crosses."""
    r = river()
    d, s, _ = r.nearest(np.array([BRIDGE_C[0]]), np.array([BRIDGE_C[1]]))
    i = int(np.searchsorted(r.s, s[0]))
    t = r.tan[min(i, len(r.tan) - 1)]
    a = np.array([-t[1], t[0]])
    if np.dot(a, BRIDGE_C) < 0:      # point away from the player
        a = -a
    return a


# ---------------------------------------------------------------------------
# The dam at the valley's head: an arch dam in a gorge, crest road, tunnel.

DAM_C = polar(31.0, 905)[:2]             # downstream toe, on the river axis
DAM_BASE_Z = -50.5
DAM_CREST_Z = -6.0
RESERVOIR_Z = -8.5
DAM_AXIS = np.array([0.62, -0.785])      # along the crest, from the far bank (left) to the near bank (right)
DAM_AXIS = DAM_AXIS / np.linalg.norm(DAM_AXIS)
DAM_UP = np.array([0.785, 0.62])         # upstream, into the reservoir
DAM_HALF = 66.0                          # half crest length
DAM_CREST_C = DAM_C + DAM_UP * 24.0      # the crest runs 24 m upstream of the toe (the arch leans)
DAM_ARCH_R = 150.0                       # radius of the crest's arch (centre upstream)
TUNNEL = np.array([*(DAM_CREST_C + DAM_AXIS * (DAM_HALF + 34.0) - DAM_UP * 6.0), DAM_CREST_Z + 0.2])

# the reservoir behind the dam, up the head valley
RESERVOIR_PTS = [DAM_CREST_C + DAM_UP * 8, DAM_CREST_C + DAM_UP * 260 + DAM_AXIS * 30,
                 DAM_CREST_C + DAM_UP * 600 + DAM_AXIS * -40, DAM_CREST_C + DAM_UP * 950 + DAM_AXIS * 30,
                 DAM_CREST_C + DAM_UP * 1250 + DAM_AXIS * 120]
RESERVOIR_W = [110.0, 230.0, 300.0, 240.0, 120.0]


def reservoir():
    return Curve(RESERVOIR_PTS, step=2.0, w=RESERVOIR_W)


def valley_axis(step=1.0):
    """The whole valley's axis for the terrain's distance fields: from the
    head of the valley, down the reservoir to the dam, then the river down-
    valley. z is the floor's water level (the lake bed above the dam), wn/wf
    the floor's half-widths on the player's side and the far side."""
    head = [DAM_CREST_C + DAM_UP * 2300 + DAM_AXIS * 300, DAM_CREST_C + DAM_UP * 1700 + DAM_AXIS * 220]
    res = list(reversed(RESERVOIR_PTS))
    pts = head + res + RIVER_PTS
    z = [150.0, 20.0, -16.0, -24.0, -32.0, -39.0, -46.0] + RIVER_Z
    wn = [40, 60, 70, 120, 150, 115, 22] + RIVER_WN
    wf = [40, 60, 70, 120, 150, 115, 22] + RIVER_WF
    return Curve(pts, step=step, z=z, wn=wn, wf=wf)


# ---------------------------------------------------------------------------
# Roads. The main road: down-valley on the near bank -> checkpoint ->
# bridge -> village -> along the far slope to the dam's crest (left end).
# z is the road surface, w its width.

# The near-bank stretch keeps about 36 m inside the river (measured off the
# river's offset curve), at the foot of the player's hillside.
ROAD_NEAR = [(-43.8, 1062), (-43.0, 823), (-41.3, 583), (-38.8, 462), (-36.0, 401), (-30.7, 345),
             (-21.4, 301), (-12.0, 287), (-5.0, 281), (2.0, 287), (6.0, 304)]
ROAD_NEAR_Z = [-62.2, -61.5, -60.6, -60.1, -59.8, -59.5, -59.2, -58.9, -58.8, -58.7, -58.5]
ROAD_FAR = [(4.8, 400), (6.0, 440), (7.0, 480), (8.5, 515), (10.5, 543), (13.0, 567), (16.0, 605),
            (19.5, 675), (22.5, 755), (25.0, 838), (26.8, 905)]
ROAD_FAR_Z = [-58.0, -57.0, -55.9, -54.7, -53.7, -52.8, -51.2, -46.8, -38.5, -27.5, -15.8]
BRIDGE_END_Z = -58.2       # the deck at the abutments (it humps to BRIDGE_DECK_Z)


def _road():
    ax = bridge_axis()
    half = BRIDGE_LEN / 2
    pts = _pb(ROAD_NEAR) + [BRIDGE_C - ax * half, BRIDGE_C, BRIDGE_C + ax * half] + _pb(ROAD_FAR)
    pts.append(dam_road().at(0.0) - DAM_AXIS * 6.0)
    z = ROAD_NEAR_Z + [BRIDGE_END_Z, BRIDGE_DECK_Z, BRIDGE_END_Z] + ROAD_FAR_Z + [DAM_CREST_Z]
    w = [5.2] * len(ROAD_NEAR) + [4.4] * 3 + [5.0] * (len(ROAD_FAR) + 1)
    return pts, z, w


def road():
    pts, z, w = _road()
    return Curve(pts, step=1.0, z=z, w=w)


# the dam road: across the crest to the tunnel
def dam_arc_point(theta, radial=1.75):
    """A point on the arch dam's crest: theta (radians) from the crest's
    middle, positive toward the right (near-bank) end; `radial` metres out
    from the upstream face (the crest road's centre is 1.75 m out)."""
    cc = DAM_CREST_C + DAM_UP * DAM_ARCH_R
    b = -DAM_UP
    c_, s_ = math.cos(theta), math.sin(theta)
    d = np.array([b[0] * c_ - b[1] * s_, b[0] * s_ + b[1] * c_])
    return cc + d * (DAM_ARCH_R + radial)


DAM_THETA = math.asin(DAM_HALF / DAM_ARCH_R)    # the crest road's ends


def dam_road():
    """The crest road along the arch, from its far-bank (left) end to the
    right end, then on into the tunnel."""
    ths = np.linspace(-DAM_THETA, DAM_THETA, 9)
    # which way is 'right' (toward the near bank / the tunnel)?
    if np.dot(dam_arc_point(ths[-1]) - dam_arc_point(ths[0]), DAM_AXIS) < 0:
        ths = ths[::-1]
    pts = [dam_arc_point(t) for t in ths]
    end = pts[-1]
    pts.append(end + (TUNNEL[:2] - end) * 0.5)
    pts.append(TUNNEL[:2])
    return Curve(pts, step=1.0, z=[DAM_CREST_Z] * 10 + [TUNNEL[2]], w=[5.0] * 11)


# the switchbacks from the top of the village up to the alp on the far slope
def switchbacks():
    pts = _pb([(3.0, 585), (-1.5, 640), (-6.0, 700), (-2.5, 735), (3.5, 745), (0.5, 790), (-5.5, 830),
               (-2.0, 870), (4.0, 880), (1.0, 925), (-4.0, 965)])
    return Curve(pts, step=1.0, w=[3.6] * len(pts))


# the farm lane: from the farmyard down across the road to the river bank
def farm_lane():
    pts = _pb([(-27.5, 232), (-28.4, 262), (-28.6, 300), (-28.2, 335), (-27.4, 362), (-27.0, 378)])
    return Curve(pts, step=1.0, w=[3.2] * len(pts))


# ---------------------------------------------------------------------------
# Sites

FARM_C = polar(-29.0, 245)[:2]
CHECKPOINT_C = polar(-5.0, 281)[:2]
VILLAGE_C = polar(8.0, 515)[:2]
CHAPEL_C = polar(4.5, 505)[:2]
ALP_C = polar(-3.5, 975)[:2]

# the far-side skyline: (bearing, range, crest z) from down-valley to the head.
# Set by elevation angle from the eye (15-19 degrees; the summits add ~1-2
# more): high enough to tower over the valley, low enough to leave the dawn
# sky above them in the player's frame.
CREST = [(-75, 2400, 643), (-62, 2900, 832), (-52, 3400, 1007), (-44, 3700, 1131), (-36, 3200, 918), (-28, 2950, 976), (-21, 3100, 936), (-13, 3300, 1047), (-7, 3400, 1191), (-2, 3250, 1043), (4, 2950, 891), (11, 2750, 925), (17, 2700, 825), (23, 2550, 819), (29, 2400, 715), (35, 2300, 756), (42, 2200, 639), (50, 2050, 635), (58, 1950, 544), (68, 1750, 456), (80, 1550, 372)]
# summits: (bearing, range, height above crest line, radius) - pyramids on the crest
PEAKS = [(-7, 3400, 110, 560), (-28, 2950, 80, 460), (11, 2750, 70, 400), (35, 2300, 60, 360),
         (-44, 3700, 70, 600), (50, 2050, 50, 330)]

# the great cliff across the valley (the echo secret), the goat's crag, the snowfield
CLIFF_C = polar(-15.0, 1330)[:2]
GOAT_CRAG_C = polar(-20.0, 760)[:2]
YETI_C = polar(7.0, 1850)[:2]


# ---------------------------------------------------------------------------
# The village: houses along the road on the far bank, the chapel on its
# little square to the left of the road. A plan (pure data) that the terrain
# levels pads for and the buildings stage builds on.

CHAPEL_AXIS_BEARING = 215.0      # the apse points east - where the sun rises, behind the player


def village_plan(seed=1907):
    """[dict(kind, c=(x, y), w, d, rot (radians about Z; the building's local
    -Y is its front), floors, seed)] - deterministic."""
    rng = np.random.default_rng(seed)
    rd = road()
    pa, pb = polar(6.4, 468), polar(15.5, 600)
    s0 = rd.nearest(np.array([pa[0]]), np.array([pa[1]]))[1][0]
    s1 = rd.nearest(np.array([pb[0]]), np.array([pb[1]]))[1][0]
    houses = []
    ab = math.radians(CHAPEL_AXIS_BEARING)
    # the chapel's local +Y runs from its door to its apse, toward the sunrise
    chapel = dict(kind="chapel", c=tuple(CHAPEL_C), w=10.5, d=21.0, rot=-ab, floors=0, seed=1)
    square = dict(kind="square", c=tuple(polar(6.6, 512)[:2]), w=24.0, d=20.0, rot=0.0, floors=0, seed=2)

    def clear(c, r):
        for h in houses + [chapel, square]:
            if np.hypot(c[0] - h['c'][0], c[1] - h['c'][1]) < r + 0.5 * max(h['w'], h['d']) + 1.5:
                return False
        return True
    s = s0
    while s < s1:
        i = min(int(s), len(rd.tan) - 1)
        p = rd.at(s)
        t = rd.tan[i]
        n = np.array([-t[1], t[0]])
        for sd in (1, -1):
            if rng.uniform() < 0.15:
                continue
            w = rng.uniform(8.5, 12.5)
            dd = rng.uniform(8.0, 11.0)
            off = 5.0 + dd / 2 + rng.uniform(0.5, 3.0)
            c = p + n * off * sd + t * rng.uniform(-2, 2)
            if not clear(c, max(w, dd) * 0.5):
                continue
            face = -n * sd                                  # toward the road
            rot = math.atan2(face[0], -face[1]) + rng.uniform(-0.10, 0.10)
            houses.append(dict(kind="house", c=tuple(c), w=w, d=dd, rot=rot, floors=int(rng.choice([2, 2, 3])),
                               seed=int(rng.integers(1 << 30))))
            if rng.uniform() < 0.5:
                c2 = p + n * (off + dd / 2 + 6 + rng.uniform(0, 6)) * sd + t * rng.uniform(-6, 6)
                w2, d2 = rng.uniform(7.5, 11), rng.uniform(7, 10)
                if clear(c2, max(w2, d2) * 0.5):
                    houses.append(dict(kind="house", c=tuple(c2), w=w2, d=d2, rot=rot + rng.uniform(-0.25, 0.25),
                                       floors=int(rng.choice([1, 2, 2])), seed=int(rng.integers(1 << 30))))
        s += rng.uniform(14.0, 20.0)
    return [chapel, square] + houses
