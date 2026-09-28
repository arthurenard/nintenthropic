"""The river, the reservoir, the mist over the river, and the roads.

water.river      a ribbon on the river's surface from the dam's outlet down-
                 valley: UV.u across (0..1 bank to bank), UV.v along the flow
                 in metres (downstream = +v); COLOR_0.r foam / white water,
                 .g depth (0 at the banks, 1 mid-stream). It runs 1.5 m under
                 the banks so the shoreline is where the ground meets it.
water.reservoir  the lake behind the dam at RESERVOIR_Z, clipped to where the
                 ground is below it.
mist.river       optional: soft ribbons 3-14 m over the river (UV.u across,
                 UV.v along; COLOR_0.a fades them at the edges) for the
                 game's mist shader.
road.*           the road, the farm lane, the switchbacks and the dam road
                 beyond the crest as ribbons 4 cm over the carved ground:
                 UV.u across the road (the road tile spans its width), UV.v
                 along in tile lengths.
"""

import math

import numpy as np

from . import layout as L
from . import mesh as M
from . import scene as S


def _ribbon(curve, s0, s1, step, half_fn, z_fn, n_across=4):
    ss = np.arange(s0, s1, step)
    if ss[-1] < s1:
        ss = np.append(ss, s1)
    V, UV = [], []
    ds = max(curve.s[1] - curve.s[0], 1e-6)
    for s in ss:
        p = curve.at(s)
        t = curve.tan[min(int(s / ds), len(curve.tan) - 1)]
        n = np.array([-t[1], t[0]])
        h = half_fn(s)
        for k in range(n_across + 1):
            u = k / n_across
            q = p + n * (u * 2 - 1) * h
            V.append((q[0], q[1], z_fn(s, q, u)))
            UV.append((u, s))
    V = np.array(V)
    UV = np.array(UV)
    F = []
    m = n_across + 1
    for i in range(len(ss) - 1):
        for k in range(n_across):
            a = i * m + k
            F += [(a, a + 1, a + m + 1), (a, a + m + 1, a + m)]
    return V, np.array(F), UV


RIFFLES = (230.0, 470.0, 880.0, 1120.0, 1380.0, 1640.0, 1900.0)


def river_rocks(riv=None):
    """Boulders in the riffles, the water breaking white round them:
    (x, y, z_water, size, s, lateral) each; lateral > 0 left of the flow."""
    riv = riv or L.river()
    rng = np.random.default_rng(5151)
    sb = riv.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    step = riv.s[1] - riv.s[0]
    out = []
    for sr in RIFFLES:
        if abs(sr - sb) < 80.0:
            continue
        for k in range(int(rng.integers(4, 9))):
            s_ = sr + rng.uniform(-9.0, 9.0)
            side = 1.0 if rng.uniform() < 0.5 else -1.0
            hw = riv.at(s_, 'wl' if side > 0 else 'wr')
            lat = side * rng.uniform(0.05, 0.85) * hw
            n = riv.nrm[min(int(s_ / step), len(riv.nrm) - 1)]
            p = riv.at(s_) + n * lat
            out.append((float(p[0]), float(p[1]), float(riv.at(s_, 'z')), float(rng.uniform(0.35, 1.1)), float(s_), float(lat)))
    return out


def build_river(col, rocks=()):
    """The water's surface between its two edges (wider under the bars and
    banks, which hide the overlap), finer where the scope reaches it.
    COLOR_0: r foam (the outlet, riffles, the wakes of the rocks), g depth
    (0 at the edges, 1 in the deepest water)."""
    riv = L.river()
    rr = np.hypot(riv.xy[:, 0], riv.xy[:, 1])
    s1 = riv.s[np.argmax(rr > M.R_MAX - 200)] if (rr > M.R_MAX - 200).any() else riv.length
    s_near = min(2200.0, s1)
    ss = np.concatenate([np.arange(0.0, s_near, 1.5), np.arange(s_near, s1, 4.0), [s1]])
    step = riv.s[1] - riv.s[0]
    na = 12
    V, UV, D = [], [], []
    for s_ in ss:
        p = riv.at(s_)
        n = riv.nrm[min(int(s_ / step), len(riv.nrm) - 1)]
        wl, wr, bl, br = (float(riv.at(s_, k)) for k in ('wl', 'wr', 'bl', 'br'))
        left, right = wl + 1.2 + 0.4 * bl, wr + 1.2 + 0.4 * br
        zw = float(riv.at(s_, 'z'))
        for k in range(na + 1):
            u = k / na
            lat = -right + u * (left + right)
            q = p + n * lat
            V.append((q[0], q[1], zw))
            UV.append((u, s_))
            e = lat / wl if lat > 0 else -lat / wr
            D.append((lat, np.clip(1 - e * e, 0, 1) ** 0.35))
    V = np.array(V)
    UV = np.array(UV)
    D = np.array(D)
    F = []
    m = na + 1
    for i in range(len(ss) - 1):
        for k in range(na):
            a = i * m + k
            F += [(a, a + 1, a + m + 1), (a, a + m + 1, a + m)]
    F = np.array(F)
    s = UV[:, 1]
    lat = D[:, 0]
    depth = D[:, 1]
    from . import noise as N
    foam = np.clip(1 - s / 70.0, 0, 1) ** 1.5
    for sr in RIFFLES:
        foam = np.maximum(foam, 0.3 * np.exp(-((s - sr) / 12.0) ** 2) *
                          (0.5 + 0.5 * N.fbm(lat / 2.0, s / 3.0, 5152, 2)))
    for (_, _, _, size, s_r, lat_r) in rocks:
        ds = s - s_r
        dl = lat - lat_r
        ring = np.exp(-(dl * dl + ds * ds) / (1.4 * size) ** 2)
        wake = (ds > 0) * np.exp(-np.maximum(ds, 0) / (7.0 * size)) * np.exp(-(dl / (0.7 * size + 0.1 * np.maximum(ds, 0))) ** 2)
        foam = np.maximum(foam, 0.95 * ring + 0.55 * wake)
    foam = np.clip(foam, 0, 1)
    ob = S.mesh_object("water.river", V, F, col, uvs={"UVMap": UV}, smooth=True, surface="water",
                       note="the river's surface: uv.u across (0..1), uv.v metres downstream; COLOR_0 r foam, g depth")
    me = ob.data
    ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.stack([foam, depth, np.zeros_like(foam), np.ones_like(foam)], 1).astype(np.float32).ravel())
    return ob


def build_river_rocks(col, rocks):
    """The riffles' boulders, one mesh (the rock tile times COLOR_0)."""
    import bpy
    from .crags import boulder_mesh
    obs = []
    for i, (x, y, zw, size, _, _) in enumerate(rocks):
        obs.append(boulder_mesh(col, f"_rr{i}", (x, y, zw - 0.3 * size), size, seed=700 + i, detail=1))
    if not obs:
        return None
    with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, selected_objects=obs):
        bpy.ops.object.join()
    ob = obs[0]
    ob.name = ob.data.name = "rocks.river"
    S.tag(ob, surface="rock", material_key="rock_vc", note="boulders in the riffles; the water's foam rings them")
    return ob


def build_reservoir(ter, col):
    res = L.reservoir()
    pts = res.xy
    lo = pts.min(0) - 420
    hi = pts.max(0) + 420
    step = 10.0
    xs = np.arange(lo[0], hi[0], step)
    ys = np.arange(lo[1], hi[1], step)
    X, Y = np.meshgrid(xs, ys)
    Z = ter.height(X, Y)
    # upstream of the dam's crest only
    up = (X - L.DAM_CREST_C[0]) * L.DAM_UP[0] + (Y - L.DAM_CREST_C[1]) * L.DAM_UP[1]
    wet = (Z < L.RESERVOIR_Z + 1.0) & (up > 2.0)
    ny, nx = X.shape
    idx = np.arange(nx * ny).reshape(ny, nx)
    q = np.stack([idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()], 1)
    w = wet.ravel()
    keep = w[q].any(1)
    q = q[keep]
    used = np.unique(q)
    rm = np.full(nx * ny, -1)
    rm[used] = np.arange(len(used))
    V = np.stack([X.ravel()[used], Y.ravel()[used], np.full(len(used), L.RESERVOIR_Z)], 1)
    F = rm[q]
    UV = V[:, :2] / 50.0
    UV -= np.floor(UV.min(0))
    return S.mesh_object("water.reservoir", V, F, col, uvs={"UVMap": UV}, smooth=True, surface="water",
                         note="the lake behind the dam, flat at RESERVOIR_Z")


def build_mist(col):
    riv = L.river()
    rr = np.hypot(riv.xy[:, 0], riv.xy[:, 1])
    s1 = riv.s[np.argmax(rr > 3500)]
    objs = []
    for k, (hgt, half, ph) in enumerate(((3.0, 45.0, 0.0), (7.5, 70.0, 1.7), (13.0, 110.0, 3.1))):
        V, F, UV = _ribbon(riv, 20.0, s1, 12.0, lambda s: half * (1 + 0.25 * math.sin(s / 140.0 + ph)),
                           lambda s, q, u: riv.at(s, 'z') + hgt, n_across=6)
        ob = S.mesh_object(f"mist.river.{k + 1}", V, F, col, uvs={"UVMap": UV}, smooth=True, surface="water", export=1,
                           height_m=hgt, note="optional mist layer: fade by COLOR_0.a, scroll noise along uv.v")
        a = np.sin(np.pi * UV[:, 0]) ** 1.5
        ca = ob.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set("color", np.stack([np.ones_like(a), np.ones_like(a), np.ones_like(a), a], 1).astype(np.float32).ravel())
        objs.append(ob)
    return objs


def build_roads(ter, col):
    objs = []
    rd = L.road()
    bs = rd.nearest(np.array([L.BRIDGE_C[0]]), np.array([L.BRIDGE_C[1]]))[1][0]
    half = L.BRIDGE_LEN / 2

    def zf(s, q, u):
        return float(ter.height(np.array([q[0]]), np.array([q[1]]))[0]) + 0.04
    parts = [("road.main.1", rd, 0.0, bs - half + 1.0), ("road.main.2", rd, bs + half - 1.0, rd.length),
             ("road.lane", L.farm_lane(), 0.0, None), ("road.switchbacks", L.switchbacks(), 0.0, None)]
    dm = L.dam_road()
    # the dam road beyond the crest, into the tunnel (the crest itself is the dam's deck)
    e = L.dam_arc_point(L.DAM_THETA if np.dot(L.dam_arc_point(L.DAM_THETA) - L.DAM_CREST_C, L.DAM_AXIS) > 0 else -L.DAM_THETA)
    s_end = dm.nearest(np.array([e[0]]), np.array([e[1]]))[1][0] + 2.0
    parts.append(("road.dam", dm, s_end, dm.length))
    for name, curve, s0, s1 in parts:
        s1 = curve.length if s1 is None else s1
        w = lambda s, c=curve: c.at(s, 'w') / 2 + 0.25
        V, F, UV = _ribbon(curve, s0, s1, 2.0, w, zf, n_across=4)
        UV[:, 1] = UV[:, 1] / 5.0
        UV[:, 1] -= math.floor(UV[:, 1].min())
        ob = S.mesh_object(name, V, F, col, uvs={"UVMap": UV}, smooth=True, surface="dirt", material_key="road")
        objs.append(ob)
    return objs


def water_material(name="water"):
    """Review material: a clear mountain river reflecting the sky, ripples
    along the flow; the bed showing through where it is shallow (COLOR_0.g),
    white water where COLOR_0.r says (broken up by noise). The game gives
    the river its own shader built on the same inputs."""
    from .scene import new_material
    m, g = new_material(name)
    uv = g.uv('UVMap')
    u, v, _ = g.separate(uv)
    vc = g.new('ShaderNodeVertexColor')
    vc.layer_name = "Col"
    foam_v, depth_v, _ = g.sep_rgb(vc.outputs['Color'])
    rip = g.noise(g.combine(g.mul(u, 6.0), g.mul(v, 0.25), 0.0), scale=1.0, detail=6.0, rough=0.6)
    brk = g.noise(g.combine(g.mul(u, 30.0), g.mul(v, 1.2), 0.0), scale=1.0, detail=4.0, rough=0.7)
    foam = g.math('MULTIPLY', foam_v, g.math('POWER', brk, 1.6))
    foam = g.math('MINIMUM', g.mul(foam, 2.2), 1.0)
    nrm = g.bump(g.add(rip, g.mul(foam, 0.6)), strength=0.25, distance=0.05)
    shallow = g.mix(g.math('POWER', depth_v, 0.6), (0.075, 0.072, 0.050), (0.010, 0.016, 0.015))
    col = g.mix(foam, shallow, (0.75, 0.78, 0.80))
    rough = g.add(g.mul(foam, 0.55), 0.04)
    b = g.principled(col, rough=rough, spec=0.6, normal=nrm)
    g.output(b)
    return m
