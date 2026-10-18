"""The ground of Route 9: the wet road, the station's concrete apron, gravel
shoulders, grassy ditches, the ploughed field under the corn and the hills
the road climbs into the fog.

One height field for all of it (a rectilinear grid, fine near the eye and
the road, coarse far away), with per-vertex zone masks the shader turns into
asphalt, concrete, gravel, soil and grass, and a puddle mask. The same masks
decide each face's `surface` for impacts when the export splits the ground,
so a bullet splashes exactly where the picture shows water.

It rained an hour ago: everything is wet. Water stands in the low spots -
along the road's edges where the crown drains, in wheel ruts and potholes,
around the pumps - and those puddles are what mirror the sodium light.
"""

import math

import bpy
import numpy as np

from .common import lin, tag, DN, WESTERN
from . import layout as L

import sys
_CHAR = __import__("os").path.join(WESTERN, "characters")
if _CHAR not in sys.path:
    sys.path.append(_CHAR)
from charlib.texture import value_noise, fbm  # noqa: E402  (numpy noise, read-only reuse)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Grid axes

def axis(a, b, step_fn):
    xs = [a]
    x = a
    while x < b:
        x = min(b, x + step_fn(x))
        xs.append(x)
    return np.array(xs)


def x_axis(fine=0.1):
    """Fine across the road and the apron, coarser over the fields."""
    def step(x):
        d = max(0.0, max(-10.5 - x, x - 16.0))       # distance outside the fine band
        return fine * (1.0 + d / 1.6) if d < 60 else fine * (1 + 60 / 1.6) * (1 + (d - 60) / 60.0)
    return axis(-520.0, 520.0, step)


def y_axis(fine=0.1):
    """Fine at the barricade, growing with distance from the eye."""
    def step(y):
        d = max(y, 0.0) + 3.0
        return fine * max(1.0, d / 4.5) ** 1.02 + (0.0 if y > -2 else fine * (-2 - y))
    return axis(-14.0, 760.0, step)


# ---------------------------------------------------------------------------
# Heights

def road_z(y):
    """Height of Route 9's centre line: level past the farm, then up the hill
    the drive-in stands on."""
    y = np.asarray(y, float)
    return 13.0 * smoothstep(150.0, 330.0, y) + 6.0 * smoothstep(330.0, 600.0, y)


def hills(X, Y):
    """The land beyond the fields: a long rise north, the drive-in's hill to
    the north-west, low wooded ridges east and west."""
    h = 16.0 * smoothstep(140.0, 340.0, Y) * (0.8 + 0.2 * np.sin(X * 0.011 + 0.7))
    h += 10.0 * np.exp(-(((X - L.DRIVEIN_SCREEN[0]) / 110.0) ** 2 + ((Y - L.DRIVEIN_SCREEN[1] + 20) / 90.0) ** 2))
    h += 12.0 * smoothstep(90.0, 300.0, np.abs(X)) * smoothstep(-40.0, 120.0, Y)
    h += 2.5 * np.sin(X * 0.018 + 1.3) * np.sin(Y * 0.013 + 0.4) * smoothstep(60.0, 200.0, np.hypot(X, Y))
    return h


def zones(X, Y):
    """Soft 0..1 masks: asphalt, concrete, gravel, soil (ploughed field and
    farm yard). Grass is what is left."""
    dx = X - L.ROAD_X
    route = (np.abs(dx) < L.ROAD_HALF) & (Y > L.APRON[3] - 0.05)
    east = (np.abs(Y - L.CROSS_Y) < L.CROSS_HALF) & (X > L.FARM_ROAD_X)
    # the corners of the crossroads are rounded (a 4 m kerb radius)
    rr = 4.0
    corner = np.zeros_like(X, bool)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = L.ROAD_X + sx * (L.ROAD_HALF + rr)
            cy = L.CROSS_Y + sy * (L.CROSS_HALF + rr)
            inbox = (sx * (X - L.ROAD_X) > L.ROAD_HALF - 0.01) & (sx * (X - cx) < 0) & \
                    (sy * (Y - L.CROSS_Y) > L.CROSS_HALF - 0.01) & (sy * (Y - cy) < 0)
            corner |= inbox & (np.hypot(X - cx, Y - cy) > rr)
    motel_lot = (X > 6.0) & (X < 34.0) & (Y > L.CROSS_Y + L.CROSS_HALF) & (Y < L.MOTEL_Y - 1.4)
    asph = (route | east | corner | motel_lot).astype(float)
    a0, a1, b0, b1 = L.APRON
    conc = ((X > a0) & (X < a1) & (Y > b0) & (Y < b1)).astype(float)
    s0, s1, t0, t1 = L.APRON_STRIP
    conc = np.maximum(conc, ((X > s0) & (X < s1) & (Y > t0) & (Y < t1)).astype(float))
    # the motel's walk and the station's back lot
    conc = np.maximum(conc, ((X > 8.0) & (X < 33.0) & (Y > L.MOTEL_Y - 1.5) & (Y < L.MOTEL_Y + 0.2)).astype(float))
    shoulder = (np.abs(dx) >= L.ROAD_HALF) & (np.abs(dx) < L.ROAD_HALF + L.SHOULDER) & (Y > L.APRON[3])
    farm = (np.abs(Y - L.CROSS_Y) < 2.4) & (X <= L.FARM_ROAD_X + 0.5) & (X > -90)
    track = (np.abs(X - (L.BARN[0] + 9.0)) < 1.8) & (Y > L.CROSS_Y) & (Y < L.BARN[1] - 3)
    grav = (shoulder | farm | track).astype(float)
    grav = np.maximum(grav, ((np.abs(Y - L.CROSS_Y) < L.CROSS_HALF + 0.9) & (np.abs(Y - L.CROSS_Y) >= L.CROSS_HALF) &
                             (X > L.FARM_ROAD_X) & (np.abs(dx) > L.ROAD_HALF + 2)).astype(float))
    grav = np.maximum(grav, ((X > L.STATION[0]) & (X < L.STATION[1] + 6) & (Y > L.STATION[3]) & (Y < L.CROSS_Y - 4)).astype(float))
    soil = np.zeros_like(X)
    for x0, x1, y0, y1 in L.CORN:
        soil = np.maximum(soil, ((X > x0) & (X < x1) & (Y > y0) & (Y < y1)).astype(float))
    yard = (np.hypot((X - L.BARN[0]) / 22.0, (Y - L.BARN[1]) / 16.0) < 1.0) | \
           (np.hypot((X - L.SILO[0]) / 8.0, (Y - L.SILO[1]) / 8.0) < 1.0)
    soil = np.maximum(soil, yard.astype(float))
    # precedence: concrete > asphalt > gravel > soil
    asph = asph * (1 - conc)
    grav = grav * (1 - conc) * (1 - asph)
    soil = soil * (1 - conc) * (1 - asph) * (1 - grav)
    return asph, conc, grav, soil


def height(X, Y):
    """Surface height (m) and the zone masks."""
    X = np.asarray(X, float)
    Y = np.asarray(Y, float)
    asph, conc, grav, soil = zones(X, Y)
    dx = X - L.ROAD_X
    zr = road_z(Y)
    # Route 9's crown and the county road's
    crown = 0.07 * (1 - np.clip(np.abs(dx) / L.ROAD_HALF, 0, 1) ** 2)
    crown_e = 0.06 * (1 - np.clip(np.abs(Y - L.CROSS_Y) / L.CROSS_HALF, 0, 1) ** 2)
    road = zr + np.maximum(crown * (Y > L.APRON[3]), crown_e * (np.abs(Y - L.CROSS_Y) < L.CROSS_HALF) * (X > L.FARM_ROAD_X))
    # beyond the shoulder the verge falls into a ditch, then the field
    edge = np.abs(dx) - (L.ROAD_HALF + L.SHOULDER)
    ditch_d = 0.45 * np.exp(-((edge - 1.5) / 0.75) ** 2)
    verge = zr - 0.04 - 0.10 * smoothstep(0.0, 1.0, edge) - ditch_d * (Y > L.APRON[3] + 2)
    field = zr - 0.18 + 0.12 * np.sin(X * 0.21 + 0.4) * np.sin(Y * 0.17)
    near_road = smoothstep(4.0, 0.0, edge)
    ground = np.where(edge < 0, road, near_road * verge + (1 - near_road) * np.minimum(field, verge + 0.3))
    # the county road likewise
    edge_e = np.abs(Y - L.CROSS_Y) - (L.CROSS_HALF + 0.9)
    dd = 0.35 * np.exp(-((edge_e - 1.3) / 0.6) ** 2) * (X > L.FARM_ROAD_X - 3) * (np.abs(dx) > L.ROAD_HALF + 3.5)
    ground = np.where((edge_e < 0) & (X > L.FARM_ROAD_X - 60), np.maximum(ground, zr + crown_e * 0.7), ground - dd)
    # flat slabs: the apron (draining gently toward the road), the motel lot
    a0, a1, b0, b1 = L.APRON
    ground = np.where(conc > 0.5, 0.02 + 0.004 * (Y - b0) / (b1 - b0) - 0.002 * np.abs(X) / 10.0, ground)
    lot = (X > 6.0) & (X < 34.0) & (Y > L.CROSS_Y + L.CROSS_HALF) & (Y < L.MOTEL_Y + 0.2)
    ground = np.where(lot, np.maximum(ground, 0.03), ground)
    # far land rises into hills (the road climbs with it)
    far = hills(X, Y)
    wr = smoothstep(18.0, 60.0, np.abs(dx))       # the land near the road follows the road
    ground = ground + far * wr
    return ground, asph, conc, grav, soil


def puddles(X, Y, asph, conc, grav, soil):
    """0..1 standing water. Water collects where the crown drains (along the
    road's edges), in the wheel tracks, in potholes, around the pumps."""
    P = np.stack([X, Y, np.zeros_like(X)], -1).reshape(-1, 3)
    n1 = fbm(P, 0.55, 3, seed=701).reshape(X.shape)
    n2 = value_noise(P, 2.3, seed=703).reshape(X.shape)
    n3 = value_noise(P * np.array([4.0, 0.35, 1.0]), 1.0, seed=705).reshape(X.shape)
    dx = np.abs(X - L.ROAD_X)
    edge_band = np.exp(-((dx - (L.ROAD_HALF - 0.35)) / 0.45) ** 2)       # along the edge lines
    tracks = sum(np.exp(-((dx - c) / 0.28) ** 2) for c in (0.9, 2.45))   # wheel tracks in each lane
    v = n1 * 0.7 + n2 * 0.3
    road_w = asph * (0.20 + 0.55 * edge_band + 0.25 * tracks * n3)
    apron_w = conc * (0.28 + 0.25 * np.exp(-((X - L.PUMP[0]) ** 2 + (Y - L.PUMP[1] - 1.7) ** 2) / 3.0))
    grav_w = grav * 0.42
    soil_w = soil * 0.30
    w = road_w + apron_w + grav_w + soil_w
    p = smoothstep(0.93 - 0.45 * w, 1.02 - 0.45 * w, v)
    # nothing under the barricade or right at the player's feet
    p *= smoothstep(1.0, 2.2, np.hypot(X, Y - 0.5) - 0.0)
    return np.clip(p, 0.0, 1.0)


def grass_amount(X, Y):
    P = np.stack([X, Y, np.zeros_like(X)], -1).reshape(-1, 3)
    return fbm(P, 0.35, 3, seed=711).reshape(X.shape)


# ---------------------------------------------------------------------------
# Mesh

def grid_object(name, X, Y, H, col, attrs=None):
    ny, nx = X.shape
    verts = np.stack([X.ravel(), Y.ravel(), H.ravel()], axis=1).astype(np.float32)
    ii, jj = np.meshgrid(np.arange(ny - 1), np.arange(nx - 1), indexing='ij')
    a = (ii * nx + jj).ravel()
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], axis=1)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
    me.update(calc_edges=True)
    me.validate()
    for k, v in (attrs or {}).items():
        at = me.attributes.new(k, 'FLOAT', 'POINT')
        at.data.foreach_set("value", v.ravel().astype(np.float32))
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def fields(xs, ys):
    X, Y = np.meshgrid(xs, ys)
    H, asph, conc, grav, soil = height(X, Y)
    pud = puddles(X, Y, asph, conc, grav, soil)
    # the water surface is flat: lower the rim a hair so the puddle reads
    # as sitting in a dip, and flatten the bottom to the water level
    H = H - 0.012 * pud
    grass = grass_amount(X, Y)
    return X, Y, H, dict(asph=asph, conc=conc, grav=grav, soil=soil, puddle=pud, grass=grass)


def ground_z(x, y):
    """Surface height at a point (for placing props)."""
    H, *_ = height(np.array([[float(x)]]), np.array([[float(y)]]))
    return float(H[0, 0])


def build(lib, col, dense=True):
    xs = x_axis(0.1 if dense else 0.45)
    ys = y_axis(0.1 if dense else 0.4)
    X, Y, H, attrs = fields(xs, ys)
    ob = grid_object("ground", X, Y, H, col, attrs=attrs)
    ob.data.materials.append(lib['ground'])
    tag(ob, surface='asphalt', group='ground')
    print(f"ground: {len(xs)} x {len(ys)} = {len(xs) * len(ys)} verts")
    return ob


def surface_of_faces(ob):
    """Per-face surface names from the masks at the face corners."""
    me = ob.data
    n = len(me.vertices)
    vals = {}
    for k in ('asph', 'conc', 'grav', 'soil', 'puddle'):
        a = np.empty(n, np.float32)
        me.attributes[k].data.foreach_get('value', a)
        vals[k] = a
    npoly = len(me.polygons)
    ls = np.empty(npoly, np.int32)
    lt = np.empty(npoly, np.int32)
    me.polygons.foreach_get('loop_start', ls)
    me.polygons.foreach_get('loop_total', lt)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    cnt = lt.astype(np.float32)
    mean = {k: np.add.reduceat(v[lv], ls) / cnt for k, v in vals.items()}
    out = np.full(npoly, 'dirt', dtype=object)
    hard = (mean['asph'] + mean['conc']) > 0.5
    out[hard] = 'asphalt'
    out[mean['puddle'] > 0.45] = 'water'
    return out


# ---------------------------------------------------------------------------
# The ground's shader

def material(lib):
    """Wet asphalt, concrete slabs, gravel, soil and grass by the zone masks;
    paint lines on the road; puddles as still water."""
    m, g = DN.new_material("ground")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    xy = g.combine(x, y, 0.0)
    asph = g.attr('asph')
    conc = g.attr('conc')
    grav = g.attr('grav')
    soil = g.attr('soil')
    pud = g.attr('puddle')
    grass_n = g.attr('grass')
    big = g.noise(xy, scale=0.06, detail=3.0, rough=0.5)
    mid = g.noise(xy, scale=0.7, detail=5.0, rough=0.6)
    fine = g.noise(pos, scale=24.0, detail=3.0, rough=0.6)
    edge_n = g.noise(xy, scale=3.0, detail=4.0, rough=0.6)

    def ragged(mask, width=0.18):
        # break the straight zone edges with noise (gravel spilling onto grass)
        return g.smooth(g.add(mask, g.mul(g.sub(edge_n, 0.5), width * 2.0)), 0.5 - width * 0.5, 0.5 + width * 0.5)

    # --- asphalt: dark aggregate, a sheen of water, cracks, tar snakes, patches
    agg = g.voronoi(pos, scale=140.0, feature='F1', out='Color')
    ar, ag_, ab = g.sep_rgb(agg)
    a_col = g.ramp(g.add(g.mul(mid, 0.6), g.mul(big, 0.4)), [
        (0.25, lin(30, 30, 31)), (0.55, lin(42, 42, 43)), (0.8, lin(52, 51, 50))])
    a_col = g.mix(g.mul(g.smooth(ar, 0.72, 0.8), 0.6), a_col, g.rgb(lin(88, 86, 82)))    # pale chips
    a_col = g.mix(g.mul(g.smooth(ag_, 0.85, 0.9), 0.5), a_col, g.rgb(lin(18, 18, 19)))   # dark chips
    # patched rectangles of newer, blacker asphalt
    pv = g.voronoi(g.combine(g.mul(x, 0.35), g.mul(y, 0.12), 0.0), scale=1.0, feature='F1', dims='2D', out='Color')
    pr, pg, pb = g.sep_rgb(pv)
    patch = g.smooth(pr, 0.82, 0.83)
    a_col = g.mix(g.mul(patch, 0.7), a_col, g.rgb(lin(24, 24, 25)))
    # alligator cracking in patches, and long cracks sealed with tar
    cr = g.voronoi(g.combine(x, y, 0.0), scale=2.2, feature='DISTANCE_TO_EDGE', dims='2D', out='Distance')
    crz = g.smooth(g.noise(xy, scale=0.25, detail=2.0), 0.55, 0.68)
    crack = g.mul(g.sub(1.0, g.smooth(cr, 0.0, 0.009)), crz)
    snake_n = g.noise(g.combine(g.mul(x, 1.3), g.mul(y, 0.22), 0.0), scale=1.0, detail=3.0, dist=0.6)
    snake = g.mul(g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(snake_n, 0.5)), 0.004, 0.014)),
                  g.smooth(g.noise(xy, scale=0.08, detail=1.0), 0.45, 0.55))
    a_col = g.mix(g.mul(crack, 0.85), a_col, g.rgb(lin(12, 12, 12)))
    a_col = g.mix(g.mul(snake, 0.9), a_col, g.rgb(lin(10, 10, 11)))
    # oil down the middle of each lane
    dxr = g.sub(x, L.ROAD_X)
    lane_c = g.math('ABSOLUTE', g.sub(g.math('ABSOLUTE', dxr), 1.65))
    oil = g.mul(g.sub(1.0, g.smooth(lane_c, 0.15, 0.55)), g.smooth(g.noise(xy, scale=0.9, detail=3.0), 0.5, 0.75))
    a_col = g.mix(g.mul(oil, 0.5), a_col, g.rgb(lin(16, 15, 15)))

    # road paint: Route 9's double yellow and white edge lines, the county
    # road's centre line and stop bars; worn where the tyres run
    def band(v, c, w):
        return g.sub(1.0, g.smooth(g.math('ABSOLUTE', g.sub(v, c)), w * 0.5, w * 0.5 + 0.012))
    ay = g.math('ABSOLUTE', g.sub(y, L.CROSS_Y))
    in_x = g.smooth(ay, L.CROSS_HALF + 0.3, L.CROSS_HALF + 0.6)      # not inside the intersection
    on_r9 = g.mul(g.smooth(y, L.APRON[3] + 0.4, L.APRON[3] + 0.9), in_x)
    yel = g.mul(g.add(band(dxr, -0.11, 0.1), band(dxr, 0.11, 0.1)), on_r9)
    wht = g.mul(g.add(band(dxr, -(L.LANE_W + 0.05), 0.11), band(dxr, L.LANE_W + 0.05, 0.11)), on_r9)
    east_side = g.smooth(g.math('ABSOLUTE', dxr), L.ROAD_HALF + 0.6, L.ROAD_HALF + 1.0)
    e_on = g.mul(east_side, g.smooth(x, L.FARM_ROAD_X + 1.0, L.FARM_ROAD_X + 2.0))
    dash = g.smooth(g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(x, 1.0 / 9.0)), 0.5)), 0.16, 0.18)
    yel = g.add(yel, g.mul(g.mul(band(y, L.CROSS_Y, 0.1), e_on), dash))
    stop = g.mul(band(g.math('ABSOLUTE', dxr), L.ROAD_HALF + 1.4, 0.4),
                 g.mul(g.smooth(ay, 0.1, 0.2), g.sub(1.0, g.smooth(ay, L.CROSS_HALF - 0.1, L.CROSS_HALF))))
    # a stop bar only on the incoming lane of each approach
    wht = g.add(wht, g.mul(stop, g.smooth(g.mul(g.sub(y, L.CROSS_Y), g.math('SIGN', dxr)), -0.05, 0.05)))
    wear = g.smooth(g.add(g.noise(pos, scale=6.0, detail=5.0, rough=0.7), g.mul(g.noise(xy, scale=0.5), 0.3)), 0.52, 0.72)
    tyre = g.mul(g.sub(1.0, g.smooth(lane_c, 0.35, 0.9)), 0.6)
    keep = g.mul(g.sub(1.0, wear), g.sub(1.0, tyre))
    a_col = g.mix(g.mul(g.math('MINIMUM', yel, 1.0), keep), a_col, g.rgb(lin(168, 128, 38)))
    a_col = g.mix(g.mul(g.math('MINIMUM', wht, 1.0), keep), a_col, g.rgb(lin(170, 170, 162)))
    paint = g.mul(g.math('MINIMUM', g.add(yel, wht), 1.0), keep)
    a_rough = g.madd(g.noise(xy, scale=1.6, detail=4.0), 0.3, 0.18)   # a thin film of water, patchy

    # --- concrete: slabs with joints, oil round the pumps, rust stains
    joint_x = g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(x, 1.0 / 3.0)), 0.5))
    joint_y = g.math('ABSOLUTE', g.sub(g.math('FRACT', g.mul(y, 1.0 / 3.0)), 0.5))
    joint = g.math('MAXIMUM', g.smooth(joint_x, 0.494, 0.4985), g.smooth(joint_y, 0.494, 0.4985))
    c_col = g.ramp(g.add(g.mul(mid, 0.5), g.mul(fine, 0.5)), [
        (0.3, lin(96, 95, 90)), (0.55, lin(118, 116, 110)), (0.8, lin(132, 130, 124))])
    slab = g.voronoi(g.combine(g.math('FLOOR', g.mul(x, 1.0 / 3.0)), g.math('FLOOR', g.mul(y, 1.0 / 3.0)), 0.0),
                     scale=1.0, feature='F1', out='Color')
    sr, sg, sb = g.sep_rgb(slab)
    c_col = g.hsv(c_col, v=g.madd(sr, 0.25, 0.85))
    c_col = g.mix(g.mul(joint, 0.9), c_col, g.rgb(lin(28, 27, 26)))
    ccr = g.voronoi(pos, scale=1.1, feature='DISTANCE_TO_EDGE', out='Distance')
    c_crack = g.mul(g.sub(1.0, g.smooth(ccr, 0.0, 0.006)), g.smooth(g.noise(xy, scale=0.4), 0.5, 0.62))
    c_col = g.mix(g.mul(c_crack, 0.8), c_col, g.rgb(lin(30, 29, 28)))
    pump_d = g.math('SQRT', g.add(g.math('POWER', g.sub(x, L.PUMP[0]), 2.0), g.math('POWER', g.sub(y, L.PUMP[1] + 1.2), 2.0)))
    stain = g.mul(g.sub(1.0, g.smooth(pump_d, 0.8, 3.2)), g.smooth(g.noise(xy, scale=1.2, detail=4.0), 0.35, 0.65))
    blots = g.smooth(g.noise(xy, scale=0.45, detail=4.0, dist=0.5), 0.62, 0.7)
    c_col = g.mix(g.mul(g.math('MAXIMUM', stain, blots), 0.75), c_col, g.rgb(lin(34, 32, 30)))
    c_rough = g.madd(g.noise(xy, scale=1.1, detail=3.0), 0.35, 0.25)

    # --- gravel: grey stones in a dark wet matrix
    gv = g.voronoi(pos, scale=55.0, feature='F1', out='Distance')
    gc = g.voronoi(pos, scale=55.0, feature='F1', out='Color')
    gr, gg, gb = g.sep_rgb(gc)
    stone = g.sub(1.0, g.smooth(gv, 0.28, 0.42))
    g_col = g.mix(stone, g.rgb(lin(40, 37, 33)), g.mix(gr, g.rgb(lin(88, 86, 82)), g.rgb(lin(128, 124, 116))))
    g_col = g.mix(g.mul(g.smooth(mid, 0.4, 0.8), 0.5), g_col, g.rgb(lin(58, 50, 40)))   # mud
    g_rough = g.mixf(stone, 0.75, 0.42)

    # --- soil: ploughed rows under the corn, puddled farm yard
    rows = g.math('ABSOLUTE', g.math('SINE', g.mul(x, math.pi / 0.76)))
    s_col = g.ramp(g.add(g.mul(mid, 0.6), g.mul(fine, 0.4)), [
        (0.3, lin(38, 30, 24)), (0.6, lin(56, 45, 35)), (0.85, lin(70, 58, 46))])
    s_col = g.mix(g.mul(g.smooth(rows, 0.6, 1.0), 0.35), s_col, g.hsv(s_col, v=1.25))
    straw = g.mul(g.smooth(g.noise(pos, scale=9.0, detail=3.0), 0.62, 0.7), 0.7)
    s_col = g.mix(straw, s_col, g.rgb(lin(120, 100, 66)))
    s_rough = g.madd(fine, 0.2, 0.62)

    # --- grass: dark wet verge grass, straw-coloured dead patches
    gb_n = g.noise(pos, scale=30.0, detail=4.0, rough=0.7)
    q_col = g.ramp(g.add(g.mul(grass_n, 0.6), g.mul(gb_n, 0.4)), [
        (0.25, lin(34, 38, 22)), (0.5, lin(52, 56, 30)), (0.7, lin(86, 78, 46)), (0.85, lin(104, 92, 58))])
    blades = g.noise(g.combine(g.mul(x, 60.0), g.mul(y, 60.0), g.mul(z, 8.0)), scale=1.0, detail=2.0)
    q_col = g.mix(g.mul(blades, 0.35), q_col, g.hsv(q_col, v=0.6))
    q_rough = g.madd(blades, 0.25, 0.55)

    # --- combine by zone
    col = q_col
    rough = q_rough
    for mask, c, r in ((ragged(soil, 0.3), s_col, s_rough), (ragged(grav, 0.25), g_col, g_rough),
                       (ragged(asph, 0.03), a_col, a_rough), (conc, c_col, c_rough)):
        col = g.mix(mask, col, c)
        rough = g.mixf(mask, rough, r)
    # painted lines are smoother than the asphalt
    rough = g.mixf(g.mul(paint, 0.6), rough, 0.35)

    # --- wetness: water darkens porous surfaces; standing water mirrors
    pedge = g.add(pud, g.mul(g.sub(g.noise(xy, scale=5.0, detail=4.0), 0.5), 0.35))
    water = g.smooth(pedge, 0.42, 0.55)
    damp = g.smooth(pedge, 0.12, 0.45)
    col = g.mix(g.mul(damp, 0.5), col, g.hsv(col, s=1.1, v=0.72))
    col = g.mix(water, col, g.hsv(col, s=0.9, v=0.55))
    rough = g.mixf(damp, rough, g.mul(rough, 0.6))
    ripple = g.noise(pos, scale=9.0, detail=2.0)
    rough = g.mixf(water, rough, g.madd(ripple, 0.03, 0.015))

    # --- relief: aggregate, cracks, joints, gravel, soil rows; flat water
    h = g.add(g.mul(fine, 0.4), g.mul(g.smooth(ar, 0.7, 0.8), 0.3))
    h = g.sub(h, g.mul(g.add(crack, g.mul(joint, 0.8)), 0.9))
    h = g.add(h, g.mul(g.mul(stone, ragged(grav, 0.25)), 2.0))
    h = g.add(h, g.mul(g.mul(g.smooth(rows, 0.3, 1.0), ragged(soil, 0.3)), 4.0))
    h = g.add(h, g.mul(g.mul(blades, 2.0), g.sub(1.0, g.math('MAXIMUM', g.math('MAXIMUM', asph, conc), g.math('MAXIMUM', grav, soil)))))
    h = g.mul(h, g.sub(1.0, water))
    nrm = g.bump(h, strength=0.35, distance=0.006)
    bsdf = g.principled(col, rough=rough, normal=nrm, spec=0.5)
    g.output(bsdf)
    m["surface"] = 'asphalt'
    lib["ground"] = m
    return m
