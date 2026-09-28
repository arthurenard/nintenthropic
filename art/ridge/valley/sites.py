"""The other sites: the farm, the checkpoint, the stone bridge, the dam and
its tunnel, the alp. Same kit and conventions as buildings.py; each returns
(objects, info) where info carries the points the contract nodes need
(where the sentries stand, the cart's wedge, the siren...).
"""

import math

import numpy as np

from . import layout as L
from . import kit as K
from .kit import frame, xf, wall, gable_roof, gable_wall
from .buildings import SURFACES, house, barn, BURY


def _h(ter, p):
    return float(ter.height(np.array([p[0]]), np.array([p[1]]))[0])


def road_frame(c):
    """(direction along the road toward the bridge, normal away from the
    player) at the road point nearest c."""
    rd = L.road()
    s = rd.nearest(np.array([c[0]]), np.array([c[1]]))[1][0]
    t = rd.tan[min(int(s), len(rd.tan) - 1)]
    n = np.array([-t[1], t[0]])
    if np.dot(n, rd.at(s)) < 0:
        n = -n
    return rd.at(s), t, n, s


# ---------------------------------------------------------------------------
# the farm

def fence(kit, pts, ter, post_step=2.6, h=1.15):
    """Post-and-rail fence along a polyline: split larch posts and two rails."""
    pts = [np.asarray(p, float) for p in pts]
    for a, b in zip(pts[:-1], pts[1:]):
        L_ = np.linalg.norm(b - a)
        n = max(int(L_ / post_step), 1)
        d = (b - a) / L_
        ang = math.atan2(d[1], d[0])
        prev = None
        for i in range(n + 1):
            p = a + d * L_ * i / n
            z = _h(ter, p)
            M = frame(p, ang, z)
            kit.box(M, (-0.06, -0.06, -0.4), (0.06, 0.06, h), "timber", skip=('-z',))
            if prev is not None:
                q, zq = prev
                for zz in (0.45, 0.95):
                    mid = (p + q) / 2
                    Mr = frame(mid, ang, (z + zq) / 2 + zz)
                    ln = np.linalg.norm(p - q)
                    kit.box(Mr, (-ln / 2, -0.03, -0.05), (ln / 2, 0.03, 0.05), "timber")
            prev = (p, z)


def hay_bale(kit, M, r=0.62, l=1.2):
    kit.cylinder(M @ _ry(), (0, 0), r, -l / 2, l / 2, "hay", n=14)
    kit.cylinder(M @ _ry() @ _flip(), (0, 0), r, -l / 2, -l / 2 + 0.001, "hay", n=14)


def _ry():
    R = np.eye(4)
    R[:3, :3] = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]
    return R


def _flip():
    R = np.eye(4)
    R[:3, :3] = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]
    return R


def build_farm(ter, col):
    from . import scene as S
    rng = np.random.default_rng(2255)
    kit = K.Kit("farm")
    c = L.FARM_C
    rot = math.radians(-29.0 + 90)
    z0 = _h(ter, c)
    Mf = frame(c, rot, z0)
    P = lambda x, y: xf(Mf, [(x, y, 0)])[0][:2]
    info = {}
    hc = P(11.0, -3.0)
    house(kit, hc, 11.0, 9.0, rot + math.pi / 2, 2, np.random.default_rng(31), _h(ter, hc) - 0.05, style="walser")
    bc = P(-9.0, 3.0)
    barn(kit, bc, 16.0, 11.0, rot + math.pi / 2, rng, _h(ter, bc) - 0.05, roof="shingles")
    # round bales stacked by the barn
    for i, (x, y, zz) in enumerate(((-9, -9.5, 0.62), (-7.7, -9.5, 0.62), (-6.4, -9.5, 0.62), (-8.35, -9.5, 1.68),
                                    (-7.05, -9.5, 1.68), (-12.5, -8.0, 0.62), (-3.5, -11.5, 0.62))):
        p = P(x, y)
        hay_bale(kit, frame(p, rot + rng.uniform(-0.1, 0.1), _h(ter, p) + zz - 0.05))
    # a water trough (a hollowed larch log) and a woodpile against the house
    tp = P(3.0, 5.5)
    Mt = frame(tp, rot + 0.3, _h(ter, tp))
    kit.box(Mt, (-1.4, -0.35, 0.0), (1.4, 0.35, 0.55), "timber")
    kit.box(Mt, (-1.25, -0.22, 0.4), (1.25, 0.22, 0.56), "dark", skip=('-z',))
    wp = P(11.0, -8.2)
    Mw = frame(wp, rot, _h(ter, wp))
    for k in range(4):
        for j in range(9):
            kit.cylinder(Mw @ _ry(), (-0.14 - k * 0.27, -2.2 + j * 0.28 + (k % 2) * 0.14), 0.13, -0.5, 0.5, "timber", n=7)
    # the cart with the cheese, parked at the top of the lane
    lane = L.farm_lane()
    cp = lane.at(3.0)
    ta = lane.tan[3]
    cang = math.atan2(ta[1], ta[0])
    zc = _h(ter, cp)
    Mc = frame(cp, cang, zc)
    kit.box(Mc, (-1.3, -0.65, 0.62), (1.3, 0.65, 0.72), "boards")
    for sy in (-0.65, 0.61):
        kit.box(Mc, (-1.3, sy, 0.72), (1.3, sy + 0.04, 1.0), "boards")
    kit.box(Mc, (1.3, -0.08, 0.62), (2.9, 0.08, 0.7), "timber")          # the shaft
    wheels = []
    for sy in (-0.78, 0.78):
        Mwh = Mc @ frame((0.0, sy), 0.0) @ _rxw()
        kit.cylinder(Mwh, (0, 0.55), 0.55, -0.05, 0.05, "timber", n=16)
        wheels.append(xf(Mc, [(0.0, sy, 0.55)])[0])
    # the cheese wheel: its own object (the game rolls it down the lane)
    cheese_c = xf(Mc, [(-0.5, 0.0, 0.72)])[0]
    ck = K.Kit("secret.cheese")
    ck.cylinder(np.eye(4), (0, 0), 0.32, 0.0, 0.11, "cheese", n=20)
    ck.cylinder(_flip(), (0, 0), 0.32, 0.0, 0.0005, "cheese", n=20)
    cheese_objs = ck.build(col, {"cheese": "cloth"})
    for o in cheese_objs:
        o.location = cheese_c
        o.name = "secret.cheese"
        o.data.name = "secret.cheese"
    # the wedge under the downhill wheel
    wedge_p = xf(Mc, [(0.62, 0.78, 0.0)])[0]
    wk = K.Kit("secret.cart.wedge")
    wk.mesh([(-0.12, -0.08, 0), (0.12, -0.08, 0), (-0.12, -0.08, 0.14), (-0.12, 0.08, 0), (0.12, 0.08, 0), (-0.12, 0.08, 0.14)],
            [(0, 1, 2), (3, 5, 4), (0, 3, 4), (0, 4, 1), (1, 4, 5), (1, 5, 2), (0, 2, 5), (0, 5, 3)],
            [(0, 0), (1, 0), (0, 1), (0, 0), (1, 0), (0, 1)], "timber")
    wedge_objs = wk.build(col, SURFACES)
    for o in wedge_objs:
        o.location = wedge_p
        o.rotation_euler = (0, 0, cang)
        o.name = "secret.cart.wedge"
        o.data.name = "secret.cart.wedge"
    info['cart'] = dict(center=cp.tolist(), z=zc, heading=cang, cheese=cheese_c.tolist(), wedge=wedge_p.tolist())
    # the pasture's fence, west of the lane, down toward the road
    pasture = [L.polar(b, r)[:2] for b, r in ((-31.0, 262), (-39.5, 272), (-41.0, 336), (-31.5, 344))]
    fence(kit, pasture + [pasture[0]], ter)
    info['pasture'] = [p.tolist() for p in pasture]
    objs = kit.build(col, SURFACES) + cheese_objs + wedge_objs
    return objs, info


def _rxw():
    """Wheel frame: cylinder axis along local Y."""
    R = np.eye(4)
    R[:3, :3] = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
    return R


# ---------------------------------------------------------------------------
# the checkpoint

def sandbag_nest(kit, M, r=1.7, h=1.05, arc=(-100, 100)):
    """A horseshoe of sandbags, open at the back, facing local +X."""
    n = 12
    a0, a1 = math.radians(arc[0]), math.radians(arc[1])
    for i in range(n):
        t0 = a0 + (a1 - a0) * i / n
        t1 = a0 + (a1 - a0) * (i + 1) / n
        for rr, sgn in ((r, 1), (r - 0.55, -1)):
            p = [(rr * math.cos(t0), rr * math.sin(t0), -0.2), (rr * math.cos(t1), rr * math.sin(t1), -0.2),
                 (rr * math.cos(t1), rr * math.sin(t1), h), (rr * math.cos(t0), rr * math.sin(t0), h)]
            kit.face(xf(M, p if sgn > 0 else p[::-1]), "sandbag")
        top = [(r * math.cos(t0), r * math.sin(t0), h), (r * math.cos(t1), r * math.sin(t1), h),
               ((r - 0.55) * math.cos(t1), (r - 0.55) * math.sin(t1), h), ((r - 0.55) * math.cos(t0), (r - 0.55) * math.sin(t0), h)]
        kit.face(xf(M, top[::-1]), "sandbag")


def build_checkpoint(ter, col):
    """A barrier across the road before the bridge, a guard hut, a timber
    watchtower, two sandbagged machine-gun nests, drums and crates."""
    rng = np.random.default_rng(3107)
    kit = K.Kit("checkpoint")
    c, t, n, s = road_frame(L.CHECKPOINT_C)
    ang = math.atan2(t[1], t[0])
    z0 = _h(ter, c)
    M = frame(c, ang, z0)             # x along the road (to the bridge), y away from the player

    def at(x, y):
        p = xf(M, [(x, y, 0)])[0][:2]
        return p, _h(ter, p)
    info = {}
    # the barrier: a post each side, the striped pole on a pivot with a counterweight
    for y in (-3.4, 3.4):
        p, z = at(0.0, y)
        kit.box(frame(p, ang, z), (-0.12, -0.12, -0.5), (0.12, 0.12, 1.1), "paint")
    p, z = at(0.0, -3.4)
    Mb = frame(p, ang, z + 1.0)
    for k in range(8):
        y0 = -0.3 + k * 0.9
        kit.box(Mb, (-0.06, y0, -0.06), (0.06, y0 + 0.9, 0.06), "paint:red" if k % 2 == 0 else "paint:white")
    kit.box(Mb, (-0.15, -0.75, -0.2), (0.15, -0.3, 0.2), "paint")
    info['barrier'] = dict(pivot=[float(p[0]), float(p[1]), z + 1.0], heading=ang)
    # the guard hut on the player's side
    hp, hz = at(-7.0, -6.8)
    Mh = frame(hp, ang, hz)
    for si, (Ms, span) in enumerate(_frames(Mh, 3.0, 2.4)):
        ops = [(span / 2 - 0.45, span / 2 + 0.45, 1.0, 1.9)] if si in (0, 1) else []
        if si == 2:
            ops = [(0.5, 1.3, 0.0, 2.0)]
        wall(kit, Ms, 0, span, -0.3, 2.4, "boards", ops, 0.12, reveal_mat="timber")
        for o in ops:
            m = "dark" if o[2] < 0.1 else "glass"
            kit.face(xf(Ms, [(o[0], 0.1, o[2]), (o[1], 0.1, o[2]), (o[1], 0.1, o[3]), (o[0], 0.1, o[3])]), m)
    kit.face(xf(Mh, [(-1.8, -1.6, 2.6), (1.8, -1.6, 2.6), (1.8, 1.6, 2.35), (-1.8, 1.6, 2.35)]), "paint")
    kit.face(xf(Mh, [(-1.8, 1.6, 2.33), (1.8, 1.6, 2.33), (1.8, -1.6, 2.58), (-1.8, -1.6, 2.58)]), "paint")
    info['hut'] = [float(hp[0]), float(hp[1]), hz]
    # the watchtower, across the road on the river side
    tp, tz = at(-12.0, 8.5)
    Mt = frame(tp, ang, tz)
    H = 7.2
    for (x, y) in ((-1.5, -1.5), (1.5, -1.5), (1.5, 1.5), (-1.5, 1.5)):
        # legs lean in a little
        lean = 0.12
        kit.mesh(*_in_frame(Mt, *_beam((x, y, -0.6), (x * (1 - lean * 0.6), y * (1 - lean * 0.6), H + 2.2), 0.13)), "timber")
    for z in (2.2, 4.7):
        for (a, b) in (((-1.45, -1.45), (1.45, -1.45)), ((1.45, -1.45), (1.45, 1.45)), ((1.45, 1.45), (-1.45, 1.45)), ((-1.45, 1.45), (-1.45, -1.45))):
            kit.mesh(*_in_frame(Mt, *_beam((a[0], a[1], z), (b[0], b[1], z + 2.3), 0.07)), "timber")
            kit.mesh(*_in_frame(Mt, *_beam((b[0], b[1], z), (a[0], a[1], z + 2.3), 0.07)), "timber")
    kit.box(Mt, (-1.9, -1.9, H - 0.15), (1.9, 1.9, H), "boards")
    for (Ms, span) in _frames(Mt @ frame((0, 0), 0), 3.8, 3.8):
        kit.box(Ms, (0, 0, H), (span, 0.06, H + 1.1), "boards", skip=('-z',))
    kit.face(xf(Mt, [(-2.2, -2.2, H + 2.2), (2.2, -2.2, H + 2.2), (0, 0, H + 3.2)]), "shingles")
    kit.face(xf(Mt, [(2.2, -2.2, H + 2.2), (2.2, 2.2, H + 2.2), (0, 0, H + 3.2)]), "shingles")
    kit.face(xf(Mt, [(2.2, 2.2, H + 2.2), (-2.2, 2.2, H + 2.2), (0, 0, H + 3.2)]), "shingles")
    kit.face(xf(Mt, [(-2.2, 2.2, H + 2.2), (-2.2, -2.2, H + 2.2), (0, 0, H + 3.2)]), "shingles")
    for (x, y) in ((-1.8, -1.8), (1.8, -1.8), (1.8, 1.8), (-1.8, 1.8)):
        kit.box(Mt, (x - 0.06, y - 0.06, H + 1.1), (x + 0.06, y + 0.06, H + 2.2), "timber")
    # the ladder
    for x in (-0.3, 0.3):
        kit.mesh(*_in_frame(Mt, *_beam((x, -1.9, -0.3), (x, -1.6, H), 0.04)), "timber")
    for k in range(int(H / 0.3)):
        z = 0.2 + k * 0.3
        kit.box(Mt, (-0.3, -1.9 + 0.3 * z / H - 0.03, z), (0.3, -1.9 + 0.3 * z / H + 0.03, z + 0.05), "timber")
    info['tower'] = dict(base=[float(tp[0]), float(tp[1]), tz], platform=tz + H, heading=ang)
    # two machine-gun nests covering the road both ways
    nests = []
    for (x, y, face) in ((9.0, -6.5, 0.0), (-17.0, 6.0, math.pi)):
        p, z = at(x, y)
        sandbag_nest(kit, frame(p, ang + face, z))
        nests.append(dict(pos=[float(p[0]), float(p[1]), z], heading=ang + face))
    info['nests'] = nests
    # drums and crates by the hut
    for (x, y) in ((-4.2, -5.6), (-3.6, -6.3), (-4.6, -6.5)):
        p, z = at(x, y)
        kit.cylinder(frame(p, 0, z), (0, 0), 0.29, -0.1, 0.88, "paint:green", n=12)
    for (x, y, zz) in ((-9.6, -5.2, 0.0), (-9.4, -4.4, 0.0), (-9.5, -4.8, 0.6)):
        p, z = at(x, y)
        kit.box(frame(p, ang + rng.uniform(-0.3, 0.3), z + zz), (-0.4, -0.3, -0.05), (0.4, 0.3, 0.6), "boards")
    info['frame'] = dict(c=[float(c[0]), float(c[1]), z0], heading=ang, away=[float(n[0]), float(n[1])])
    return kit.build(col, SURFACES), info


def _frames(M, w, d):
    from .buildings import side_frames
    return side_frames(M, w, d)


def _beam(a, b, r):
    """A square beam from a to b (world or frame coords) as (V, F, UV)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    L_ = np.linalg.norm(d)
    d /= L_
    u = np.cross(d, [0, 0, 1.0]) if abs(d[2]) < 0.9 else np.cross(d, [1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(d, u)
    V, UV = [], []
    for p, t in ((a, 0.0), (b, L_)):
        for k, (su, sv) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            V.append(p + (u * su + v * sv) * r)
            UV.append((k * 0.25, t))
    F = []
    for k in range(4):
        k2 = (k + 1) % 4
        F += [(k, k2, 4 + k2), (k, 4 + k2, 4 + k)]
    return np.array(V), np.array(F), np.array(UV)


def _in_frame(M, V, F, UV):
    return xf(M, V), F, UV


# ---------------------------------------------------------------------------
# the stone bridge

def build_bridge(ter, col):
    """A three-arch stone bridge: a segmental main arch over the river, a
    small flood arch on each bank, rubble spandrels, dressed-stone arch rings,
    cutwaters on the piers, parapets with a coping, setts on the deck."""
    kit = K.Kit("bridge")
    ax = L.bridge_axis()
    rd = L.road()
    bs = rd.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    half = L.BRIDGE_LEN / 2
    ang = math.atan2(ax[1], ax[0])
    riv_z = -60.6
    M = frame(L.BRIDGE_C, ang, 0.0)        # local x along the bridge (near bank -> far bank), y across
    W = 5.2
    deck = lambda x: np.interp(bs + x, rd.s, rd['z'])  # the road's own profile over the span
    arches = [(-15.0, -10.0, riv_z + 1.2, riv_z + 4.3), (-8.5, 8.5, riv_z + 0.2, deck(0.0) - 0.9),
              (10.0, 15.0, riv_z + 1.2, riv_z + 4.3)]     # (x0, x1, springing z, crown z)

    def intrados(x):
        for (x0, x1, zs, zc) in arches:
            if x0 < x < x1:
                c = (x0 + x1) / 2
                hw = (x1 - x0) / 2
                rise = zc - zs
                R = (hw * hw + rise * rise) / (2 * rise)
                return zs + (math.sqrt(max(R * R - (x - c) ** 2, 0)) - (R - rise))
        return None
    xs = np.linspace(-half - 2, half + 2, 181)
    base = riv_z - 3.0
    for sy, mat in ((-W / 2, "rubble"), (W / 2, "rubble")):
        for i in range(len(xs) - 1):
            xa, xb = xs[i], xs[i + 1]
            za, zb = deck(xa) - 0.25, deck(xb) - 0.25
            ia, ib = intrados((xa + xb) / 2), intrados((xa + xb) / 2)
            lo_a = intrados(xa) if intrados(xa) is not None else base
            lo_b = intrados(xb) if intrados(xb) is not None else base
            if ia is not None:
                lo_a = intrados(xa) if intrados(xa) is not None else intrados((xa + xb) / 2)
                lo_b = intrados(xb) if intrados(xb) is not None else intrados((xa + xb) / 2)
            pts = [(xa, sy, lo_a), (xb, sy, lo_b), (xb, sy, zb), (xa, sy, za)]
            if sy > 0:
                pts = pts[::-1]
            kit.face(xf(M, pts), mat)
    # the arch rings (voussoirs, proud of the spandrel) and the soffits
    for (x0, x1, zs, zc) in arches:
        n = 24
        for i in range(n):
            xa = x0 + (x1 - x0) * i / n
            xb = x0 + (x1 - x0) * (i + 1) / n
            za = intrados(xa + 1e-4) or zs
            zb = intrados(xb - 1e-4) or zs
            kit.face(xf(M, [(xb, -W / 2, zb), (xa, -W / 2, za), (xa, W / 2, za), (xb, W / 2, zb)]), "ashlar")
            for sy in (-W / 2 - 0.08, W / 2 + 0.08):
                ring = [(xa, sy, za), (xb, sy, zb), (xb, sy, zb + 0.75), (xa, sy, za + 0.75)]
                if sy > 0:
                    ring = ring[::-1]
                kit.face(xf(M, ring), "ashlar")
    # piers' cutwaters (upstream and downstream), between the arches
    for xp in (-9.25, 9.25):
        for sy in (-1, 1):
            p = [(xp - 0.75, sy * W / 2, base), (xp + 0.75, sy * W / 2, base), (xp, sy * (W / 2 + 1.4), base),
                 (xp - 0.75, sy * W / 2, riv_z + 2.6), (xp + 0.75, sy * W / 2, riv_z + 2.6), (xp, sy * (W / 2 + 1.4), riv_z + 2.2)]
            Vc = xf(M, p)
            F = [(0, 2, 5), (0, 5, 3), (2, 1, 4), (2, 4, 5), (3, 5, 4)]
            if sy < 0:
                F = [(a, c, b) for a, b, c in F]
            kit.mesh(Vc, F, K.planar_uv(Vc, K.tile_size("ashlar")), "ashlar")
    # parapets with a coping, and the deck in setts
    for i in range(len(xs) - 1):
        xa, xb = xs[i], xs[i + 1]
        za, zb = deck(xa), deck(xb)
        for sy in (-1, 1):
            y0, y1 = sy * W / 2, sy * (W / 2 - 0.42)
            for (yy, flip) in ((y0, sy < 0), (y1, sy > 0)):
                q = [(xa, yy, za), (xb, yy, zb), (xb, yy, zb + 0.95), (xa, yy, za + 0.95)]
                kit.face(xf(M, q[::-1] if not flip else q), "rubble")
            kit.face(xf(M, [(xa, y0 - sy * 0.05, za + 0.95), (xb, y0 - sy * 0.05, zb + 0.95), (xb, y1 + sy * 0.05, zb + 1.05),
                            (xa, y1 + sy * 0.05, za + 1.05)][::(-1 if sy > 0 else 1)]), "ashlar")
        kit.face(xf(M, [(xa, -W / 2 + 0.42, za), (xb, -W / 2 + 0.42, zb), (xb, W / 2 - 0.42, zb), (xa, W / 2 - 0.42, za)]), "setts")
    # abutments: rubble wing walls into the banks
    for xe in (-half - 2, half + 2):
        for sy in (-1, 1):
            kit.box(M @ frame((xe, sy * (W / 2 + 0.6)), 0.0), (-2.0, -0.6, base), (2.0, 0.6, deck(xe) + 0.2), "rubble", skip=('-z',))
    info = dict(axis=ax.tolist(), center=list(L.BRIDGE_C), near_end=(L.BRIDGE_C - ax * half).tolist(),
                far_end=(L.BRIDGE_C + ax * half).tolist(), deck_z_near=float(deck(-half)), width=W,
                parapet_top=float(deck(0.0) + 1.0))
    return kit.build(col, SURFACES), info


# ---------------------------------------------------------------------------
# the dam and the tunnel

def build_dam(ter, col):
    """A concrete arch dam closing the gorge: the arch's centre upstream,
    the downstream face battered (3.5 m thick at the crest, 13 m at the
    toe), a crest road between railings with lamp posts, the siren on its
    mast, a valve house at the toe where the river comes out. The tunnel
    portal in the right abutment's rock."""
    kit = K.Kit("dam")
    R = L.DAM_ARCH_R
    cc = L.DAM_CREST_C + L.DAM_UP * R             # the arch's centre, upstream
    th_half = math.asin((L.DAM_HALF + 8.0) / R)
    zt, zb = L.DAM_CREST_Z, L.DAM_BASE_Z - 4.0
    base_dir = -L.DAM_UP                          # from the centre toward the crest's middle

    def pt(theta, rad, z):
        c_, s_ = math.cos(theta), math.sin(theta)
        d = np.array([base_dir[0] * c_ - base_dir[1] * s_, base_dir[0] * s_ + base_dir[1] * c_])
        p = cc + d * rad
        return (p[0], p[1], z)
    nt, nz = 40, 14
    thetas = np.linspace(-th_half, th_half, nt + 1)
    zs = np.linspace(zb, zt, nz + 1)
    thick = lambda z: 3.5 + 9.5 * ((zt - z) / (zt - zb)) ** 1.6
    ts = K.tile_size("concrete")
    for i in range(nt):
        for j in range(nz):
            a, b = thetas[i], thetas[i + 1]
            z0, z1 = zs[j], zs[j + 1]
            u0, u1 = a * R / ts, b * R / ts
            # the upstream face (the downstream one, the player's, is dam.face)
            q = [pt(a, R, z0), pt(b, R, z0), pt(b, R, z1), pt(a, R, z1)]
            kit.face(q, "concrete", uv=[(u0, z0 / ts), (u1, z0 / ts), (u1, z1 / ts), (u0, z1 / ts)])
    # the crest: road deck, parapet walls, railings, lamps
    for i in range(nt):
        a, b = thetas[i], thetas[i + 1]
        kit.face([pt(a, R - 0.4, zt), pt(b, R - 0.4, zt), pt(b, R + 3.9, zt), pt(a, R + 3.9, zt)][::-1], "concrete")
        for (r0, r1) in ((R - 0.4, R - 0.1), (R + 3.6, R + 3.9)):
            for rr, fl in ((r0, True), (r1, False)):
                q = [pt(a, rr, zt), pt(b, rr, zt), pt(b, rr, zt + 1.05), pt(a, rr, zt + 1.05)]
                kit.face(q if fl else q[::-1], "concrete")
            kit.face([pt(a, r0, zt + 1.05), pt(b, r0, zt + 1.05), pt(b, r1, zt + 1.05), pt(a, r1, zt + 1.05)][::-1], "concrete")
    lamps = []
    for k in range(7):
        th = -th_half + (2 * th_half) * (k + 0.5) / 7
        p = pt(th, R + 3.75, zt + 1.05)
        kit.cylinder(frame(p[:2], 0, p[2]), (0, 0), 0.06, 0.0, 4.2, "paint", n=8)
        kit.box(frame(p[:2], th, p[2] + 4.2), (-0.18, -0.6, -0.15), (0.18, 0.1, 0.05), "paint")
        lamps.append(p)
    # the siren: a mast and a trumpet loudspeaker, its own object
    th_s = th_half * 0.35
    sp = pt(th_s, R + 3.75, zt + 1.05)
    kit.cylinder(frame(sp[:2], 0, sp[2]), (0, 0), 0.09, 0.0, 6.5, "paint", n=8)
    sk = K.Kit("secret.siren")
    horn = np.eye(4)
    horn[:3, :3] = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]      # axis along -Y: the horn faces the valley
    sk.cylinder(horn, (0, 0), 0.08, -0.1, 0.5, "paint", n=12, r1=0.42)
    sk.cylinder(horn @ frame((0, 0), 0, 0.0), (0, 0), 0.14, -0.3, -0.1, "paint", n=10)
    siren_objs = sk.build(col, {"paint": "metal"})
    siren_pos = (sp[0], sp[1], sp[2] + 6.2)
    for o in siren_objs:
        o.name = "secret.siren"
        o.data.name = "secret.siren"
        o.location = siren_pos
        o.rotation_euler = (0, 0, math.atan2(-sp[0], sp[1]) * 0 + math.atan2(-(0 - sp[0]), (0 - sp[1])) + math.pi)
    # the valve house at the toe, the river's outlet
    vh = L.DAM_C - L.DAM_UP * 14.0 + L.DAM_AXIS * 16.0
    Mv = frame(vh, math.atan2(L.DAM_AXIS[1], L.DAM_AXIS[0]), L.DAM_BASE_Z + 1.5)
    kit.box(Mv, (-4.0, -3.0, -1.5), (4.0, 3.0, 4.5), "concrete", skip=('-z',))
    kit.box(Mv, (-4.3, -3.3, 4.5), (4.3, 3.3, 4.8), "concrete")
    kit.face(xf(Mv, [(-1.0, -3.02, 0.0), (1.0, -3.02, 0.0), (1.0, -3.02, 2.4), (-1.0, -3.02, 2.4)]), "paint:green")
    out = L.DAM_C - L.DAM_UP * 2.0
    Mo = frame(out, math.atan2(L.DAM_AXIS[1], L.DAM_AXIS[0]), L.DAM_BASE_Z)
    kit.face(xf(Mo, [(-3.0, 0.0, -0.3), (3.0, 0.0, -0.3), (3.0, 0.0, 3.2), (-3.0, 0.0, 3.2)]), "dark")
    # the tunnel portal: a concrete face in the rock with an arched mouth
    tp = L.TUNNEL
    dr_ = L.dam_road()
    t_end = dr_.tan[-3]
    tang = math.atan2(t_end[1], t_end[0])
    Mt = frame(tp[:2], tang - math.pi / 2, tp[2] - 0.1)       # local -Y faces back along the road
    Wp, Hp = 12.0, 9.5
    op = [(Wp / 2 - 3.0, Wp / 2 + 3.0, 0.0, 5.2)]
    Mw = Mt @ frame((-Wp / 2, 0.0), 0.0)
    wall(kit, Mw, 0, Wp, -1.0, Hp, "concrete", op, 12.0, reveal_mat="concrete")
    kit.face(xf(Mw, [(Wp / 2 - 3.0, 11.9, 0.0), (Wp / 2 + 3.0, 11.9, 0.0), (Wp / 2 + 3.0, 11.9, 5.2), (Wp / 2 - 3.0, 11.9, 5.2)]),
             "dark")
    kit.face(xf(Mw, [(Wp / 2 - 3.0, 0.0, 0.01), (Wp / 2 + 3.0, 0.0, 0.01), (Wp / 2 + 3.0, 11.9, 0.01), (Wp / 2 - 3.0, 11.9, 0.01)]),
             "concrete")
    kit.box(Mt @ frame((0, 0), 0), (-Wp / 2 - 0.3, -0.4, Hp), (Wp / 2 + 0.3, 0.3, Hp + 0.5), "concrete")
    info = dict(crest_z=zt, lamps=[list(p) for p in lamps], siren=list(siren_pos), tunnel=list(map(float, tp)),
                tunnel_heading=tang, valve_house=vh.tolist(), outlet=out.tolist(),
                crest_left=list(pt(-th_half + 0.05, R + 1.75, zt)), crest_right=list(pt(th_half - 0.05, R + 1.75, zt)))
    face = _dam_face(col, pt, th_half, R, thick, zb, zt, ts)
    return kit.build(col, SURFACES) + siren_objs + [face], info


def _dam_face(col, pt, th_half, R, thick, zb, zt, ts):
    """The downstream face as its own finer mesh, weathered in COLOR_0 (the
    concrete tile times it): pours in lifts of 1.5 m and blocks of 15 m each a
    shade apart, black seepage streaks hanging from the crest's drains, damp
    patches, white lime bleeding from the lift joints, moss at the toe."""
    from . import scene as S
    from . import noise as N
    from .noise import smoothstep
    nt, nz = 120, 44
    th = np.linspace(-th_half, th_half, nt + 1)
    zs = np.linspace(zb, zt, nz + 1)
    TH, ZZ = np.meshgrid(th, zs)
    V = np.array([pt(a, R + thick(z), z) for a, z in zip(TH.ravel(), ZZ.ravel())])
    s_ = TH.ravel() * R
    z = ZZ.ravel()
    idx = np.arange(len(V)).reshape(nz + 1, nt + 1)
    a_, b_, c_, d_ = idx[:-1, 1:], idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:]
    F = np.concatenate([np.stack([a_, b_, c_], -1).reshape(-1, 3), np.stack([a_, c_, d_], -1).reshape(-1, 3)])
    UV = np.stack([s_ / ts, z / ts], -1)

    def hsh(k, m):
        return (np.sin(k * 12.9898 + m * 78.233) * 43758.5453) % 1.0
    lift = np.floor((z - zb) / 1.5)
    block = np.floor((s_ + 500.0) / 15.0)
    tone = 0.74 + 0.08 * hsh(lift, 1.0) + 0.08 * hsh(block, 2.0)
    depth = zt - z
    reach = 10.0 + 22.0 * (0.5 + 0.5 * N.fbm(s_ / 7.0, np.full_like(s_, 3.3), 3301, 2))
    streak = smoothstep(0.05, 0.55, N.fbm(s_ / 1.6, z / 35.0, 3302, 3)) * np.exp(-depth / reach)
    damp = smoothstep(0.0, 0.6, N.fbm(s_ / 18.0, z / 12.0, 3303, 3)) * 0.22
    col_ = tone[:, None] * (1 - 0.55 * streak - damp)[:, None] * np.array([1.0, 1.0, 1.02])
    lime = smoothstep(0.45, 0.8, N.fbm(s_ / 2.5, z / 8.0, 3304, 3)) * (np.abs(((z - zb) / 1.5) % 1.0 - 0.5) > 0.3)
    col_ = col_ * (1 + 0.25 * lime)[:, None]
    moss = smoothstep(zb + 10.0, zb + 1.0, z) * (0.6 + 0.4 * N.fbm(s_ / 3.0, z / 3.0, 3305, 2))
    col_ = col_ * (1 - 0.5 * moss)[:, None] + np.array([0.20, 0.24, 0.12]) * (0.5 * moss)[:, None]
    ob = S.mesh_object("dam.face", V, F, col, uvs={"UVMap": UV}, smooth=True, surface=SURFACES.get("concrete", "stone"),
                       material_key="concrete_vc", note="the dam's downstream face; COLOR_0 weathers the concrete tile")
    ca = ob.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.hstack([np.clip(col_, 0.02, 1.2), np.ones((len(V), 1))]).astype(np.float32).ravel())
    return ob


# ---------------------------------------------------------------------------
# the alp

def build_alp(ter, col):
    rng = np.random.default_rng(4411)
    kit = K.Kit("alp")
    info = {}
    for i, (db, dr, w, d, rot) in enumerate(((-1.5, -8.0, 9.0, 7.0, 0.3), (3.0, 12.0, 7.5, 6.0, -0.2))):
        p = L.ALP_C + np.array([db, dr])
        z = _h(ter, p)
        barn(kit, p, w, d, math.atan2(-p[0], p[1]) + rot, rng, z - 0.05, roof="slabs")
        info[f"barn{i}"] = [float(p[0]), float(p[1]), z]
    return kit.build(col, SURFACES), info
