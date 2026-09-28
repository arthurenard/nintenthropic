"""What covers the ground: the one set of rules the terrain maps (splat,
colour, normals) and the forest's placement share, so trees stand exactly
where the ground under them is forest floor.

Materials (the splat channels the game's terrain shader blends):
    splat0.r grass      pasture and valley meadow (green)
    splat0.g rock       limestone and gneiss faces, outcrops
    splat0.b scree      talus below cliffs, gully fans
    splat0.a snow       old snowfields and the first snow on the peaks
    splat1.r dirt       bare earth: tracks, banks, farmyards, cow paths
    splat1.g forest     forest floor under the trees: needles, moss
    splat1.b gravel     river gravel bars, fans, shoulders
    splat1.a alpine     dry alpine turf above the trees, autumn gold

The inputs are geometric (altitude, slope, aspect, curvature, how much
water gathers there) and designed (distance to the river, roads, sites).
"""

import math
import time

import numpy as np

from . import layout as L
from . import noise as N
from .noise import Grid, smoothstep

SEED = 7717
MATERIALS = ["grass", "rock", "scree", "snow", "dirt", "forest", "gravel", "alpine"]

# linear albedo (mean colour) of each material: the colour map is built from
# these and the tiles are normalised to them (the shader multiplies the
# colour map by tile / mean)
MEAN = {
    "grass": (0.105, 0.135, 0.050),
    "rock": (0.135, 0.128, 0.118),
    "scree": (0.180, 0.172, 0.160),
    "snow": (0.78, 0.80, 0.83),
    "dirt": (0.135, 0.100, 0.070),
    "forest": (0.055, 0.058, 0.035),
    "gravel": (0.225, 0.215, 0.195),
    "alpine": (0.170, 0.150, 0.075),
}


def log(*a):
    print("[landcover]", *a, flush=True)


# ---------------------------------------------------------------------------
# Fields on the coarse grid

def flow_accumulation(g):
    """Upslope area (in cells) of every cell of the coarse grid, by D8 flow:
    each cell passes its water to its steepest downhill neighbour, cells
    processed from the highest down."""
    t = time.time()
    z = g.v
    ny, nx = z.shape
    zp = np.pad(z, 1, mode='edge')
    best = np.zeros((ny, nx))
    tgt = np.full((ny, nx), -1, np.int64)
    idx = np.arange(ny * nx).reshape(ny, nx)
    for dj, di, dist in ((-1, -1, 1.414), (-1, 0, 1), (-1, 1, 1.414), (0, -1, 1), (0, 1, 1), (1, -1, 1.414),
                         (1, 0, 1), (1, 1, 1.414)):
        nb = zp[1 + dj:1 + dj + ny, 1 + di:1 + di + nx]
        drop = (z - nb) / dist
        j = np.clip(np.arange(ny)[:, None] + dj, 0, ny - 1)
        i = np.clip(np.arange(nx)[None, :] + di, 0, nx - 1)
        better = drop > best
        best = np.where(better, drop, best)
        tgt = np.where(better, j * nx + i, tgt)
    order = np.argsort(-z.ravel(), kind='stable').tolist()
    acc = [1.0] * (ny * nx)
    tflat = tgt.ravel().tolist()
    # in height order a cell's donors are all higher, so by the time we
    # reach it its accumulation is final (plain lists: numpy scalars in a
    # Python loop are ten times slower)
    for k in order:
        d = tflat[k]
        if d >= 0:
            acc[d] += acc[k]
    acc = np.array(acc)
    log(f"flow accumulation {time.time() - t:.1f}s (max {acc.max():.0f} cells)")
    return acc.reshape(ny, nx)


def curvature(v, dx, sigma):
    s = N.blur(v, sigma)
    lap = (np.roll(s, 1, 0) + np.roll(s, -1, 0) + np.roll(s, 1, 1) + np.roll(s, -1, 1) - 4 * s) / (dx * dx)
    return lap


class Fields:
    """Precomputed grids the rules sample: flow, curvature, and the terrain."""

    def __init__(self, ter, flow=None):
        self.ter = ter
        c = ter.coarse
        acc = flow if flow is not None else flow_accumulation(c)
        # D8 streams run along the grid's axes and diagonals: blur the log so
        # they read as soft channels, not a circuit board
        self.flow = Grid(c.x0, c.y0, c.dx, c.nx, c.ny, N.blur(np.log1p(acc), 1.6))
        self.curv = Grid(c.x0, c.y0, c.dx, c.nx, c.ny, curvature(c.v, c.dx, 1.5) * 64.0)
        f = ter.fine
        self.fcurv = Grid(f.x0, f.y0, f.dx, f.nx, f.ny, curvature(f.v, f.dx, 3.0) * 8.0)
        self.riv = L.river(step=2.0)
        self.rd = L.road()
        self.lanes = [L.farm_lane(), L.switchbacks(), L.dam_road()]
        self.plan = L.village_plan()


def _dist_curve(curve, x, y, md):
    d, s, _ = curve.nearest(x, y, max_dist=md)
    return np.where(np.isfinite(d), d, 1e9), s


def evaluate(F, x, y, z=None, nrm=None, need_forest_only=False):
    """Material weights (8, n) and helper fields at world points (x, y)."""
    ter = F.ter
    x = np.asarray(x, float).ravel()
    y = np.asarray(y, float).ravel()
    n = len(x)
    if z is None:
        z = ter.height(x, y)
    if nrm is None:
        e = 1.5
        zx = (ter.height(x + e, y) - ter.height(x - e, y)) / (2 * e)
        zy = (ter.height(x, y + e) - ter.height(x, y - e)) / (2 * e)
        nrm = np.stack([-zx, -zy, np.ones(n)], 1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    slope = np.degrees(np.arccos(np.clip(nrm[:, 2], -1, 1)))
    alt = z - L.FLOOR_Z                       # height above the valley floor at the bridge
    r = np.hypot(x, y)
    flow = F.flow.sample(x, y)
    curv = F.curv.sample(x, y)
    fin = F.ter.fine.inside(x, y, 1.0)
    fcurv = np.where(fin, F.fcurv.sample(x, y), 0.0)
    # low-frequency variety fields
    n1 = N.fbm(x, y, SEED + 1, octaves=4, scale=1 / 260.0)
    n2 = N.fbm(x, y, SEED + 2, octaves=4, scale=1 / 70.0)
    n3 = N.fbm(x, y, SEED + 3, octaves=3, scale=1 / 900.0)
    dr, _ = _dist_curve(F.riv, x, y, 90.0)
    rw = 9.0
    droad, _ = _dist_curve(F.rd, x, y, 30.0)
    dlane = np.full(n, 1e9)
    for c in F.lanes:
        dl, _ = _dist_curve(c, x, y, 20.0)
        dlane = np.minimum(dlane, dl)
    # ---- the treeline and the forest
    treeline = 330.0 + 70.0 * n3 + 35.0 * n1
    floor_zone = smoothstep(18.0, 6.0, alt - 0.02 * np.clip(r - 400, 0, None) * 0) * smoothstep(12.0, 6.0, slope)
    forest = smoothstep(treeline + 10, treeline - 50, alt) * smoothstep(44.0, 34.0, slope)
    # clearings, meadows on the benches, pastures round the farm and alp
    clear = smoothstep(0.25, 0.45, n1 + 0.3 * n2)
    forest *= 1 - clear
    # avalanche tracks and streams: where water gathers on steep ground
    track = smoothstep(5.2, 6.5, flow + 0.6 * n2) * smoothstep(20.0, 30.0, slope)
    forest *= 1 - track
    # the valley floor is farmland; the player's own hillside is pasture
    forest *= 1 - floor_zone
    # the player's own slope is open pasture - the aim check's plates and the
    # sightlines to the road and the checkpoint cross it - with woods only on
    # its flanks, framing the view
    th = np.degrees(np.arctan2(x, y))
    ours = smoothstep(520.0, 440.0, r) * smoothstep(40.0, 32.0, np.abs(th))
    forest *= 1 - ours
    # riverside trees: a ribbon of alder/birch along the banks (placed by the
    # forest stage as 'birch'); here the ground there stays grass
    forest *= smoothstep(25.0, 45.0, dr)
    # keep the forest off roads, lanes, sites
    forest *= smoothstep(8.0, 16.0, droad) * smoothstep(5.0, 10.0, dlane)
    sites = np.zeros(n)
    for c, rad in ((L.FARM_C, 70.0), (L.CHECKPOINT_C, 45.0), (L.ALP_C, 90.0), (L.VILLAGE_C, 150.0),
                   (L.DAM_CREST_C, 110.0)):
        sites = np.maximum(sites, smoothstep(rad, rad * 0.6, np.hypot(x - c[0], y - c[1])))
    forest *= 1 - sites
    forest = np.clip(forest, 0, 1)
    if need_forest_only:
        return dict(forest=forest, alt=alt, slope=slope, treeline=treeline, dr=dr, droad=droad, z=z)
    # ---- rock, scree, snow
    rock = smoothstep(33.0, 45.0, slope + 6.0 * n2) * smoothstep(8.0, 20.0, alt)
    rock = np.maximum(rock, smoothstep(26.0, 36.0, slope) * smoothstep(treeline + 40, treeline + 160, alt) * 0.9)
    # scree: moderate slopes below and among rock, where debris collects (concave)
    scree = (smoothstep(18.0, 28.0, slope) * smoothstep(40.0, 33.0, slope) *
             smoothstep(treeline - 60, treeline + 60, alt) * smoothstep(-0.05, 0.25, curv + 0.2 * n2))
    scree = np.maximum(scree, smoothstep(5.8, 7.5, flow) * smoothstep(12.0, 22.0, slope) *
                       smoothstep(treeline - 150, treeline, alt) * 0.8)
    # snow: an old-snow line and the first snow on the peaks; NE faces (toward
    # the player) hold it; gullies hold it lower; steep rock sheds it
    snowline = 700.0 + 60.0 * n3 - 90.0 * smoothstep(0.1, 0.6, curv) - 60.0 * smoothstep(5.5, 7.0, flow)
    snow = smoothstep(snowline - 40, snowline + 60, alt) * smoothstep(52.0, 38.0, slope + 8 * n2)
    dust = smoothstep(820.0, 1000.0, alt + 60 * n1) * 0.55         # a dusting that clings even to steep rock
    snow = np.clip(np.maximum(snow, dust * smoothstep(70.0, 50.0, slope)), 0, 1)
    # ---- grass and alpine turf
    alpine = smoothstep(treeline - 40, treeline + 60, alt)
    grass = 1.0 - alpine
    # ---- dirt: tracks, banks, farmyards, cow paths
    # the roads and lanes are their own meshes: only a trodden verge shows
    dirt = np.maximum(smoothstep(1.2, 0.2, droad - 3.2), smoothstep(1.0, 0.2, dlane - 1.7)) * 0.55
    # cow paths: faint, broken terracettes along the contours of the pastures
    cp = np.abs(np.sin((z + 6.0 * N.fbm(x, y, SEED + 5, 2, scale=1 / 30.0)) * 2 * math.pi / 3.1))
    cowpaths = smoothstep(0.965, 0.995, cp) * smoothstep(0.1, 0.5, N.fbm(x, y, SEED + 6, 3, scale=1 / 18.0))
    dirt = np.maximum(dirt, cowpaths * smoothstep(9.0, 16.0, slope) * smoothstep(30.0, 22.0, slope) *
                      smoothstep(700.0, 450.0, r) * 0.3)
    for c, rad in ((L.FARM_C, 26.0), (L.CHECKPOINT_C, 16.0), (L.ALP_C, 18.0)):
        dirt = np.maximum(dirt, smoothstep(rad, rad * 0.5, np.hypot(x - c[0], y - c[1])) * (0.6 + 0.3 * n2))
    # ---- gravel: the river's bars and banks, fans at the gullies' mouths
    # the channel's bed (under the water) and the bars on the inside of bends
    gravel = smoothstep(rw + 1.5, rw - 1.0, dr) * 0.9
    gravel = np.maximum(gravel, smoothstep(rw + 6.0, rw, dr) * smoothstep(0.1, 0.5, n2) * 0.6)
    # fans of washed gravel where the far slope's gullies reach the floor
    gravel = np.maximum(gravel, smoothstep(6.5, 8.0, flow) * smoothstep(22.0, 10.0, slope) * smoothstep(60.0, 8.0, alt)
                        * smoothstep(450.0, 650.0, r) * 0.6)
    # ---- compose: exclusive-ish layers, then normalise
    W = np.zeros((8, n))
    W[0] = grass
    W[7] = alpine
    W[5] = forest * 1.2
    W[0] *= 1 - forest
    W[7] *= 1 - forest
    for i, m in ((1, rock), (2, scree)):
        W[i] = m
        for j in (0, 5, 7):
            W[j] *= 1 - m
    W[6] = gravel
    W[4] = dirt
    for j in (0, 1, 2, 5, 7):
        W[j] *= 1 - np.maximum(gravel, dirt)
    W[3] = snow
    for j in (0, 1, 2, 4, 5, 6, 7):
        W[j] *= 1 - snow
    s = W.sum(0)
    W /= np.maximum(s, 1e-6)
    return W, dict(slope=slope, alt=alt, flow=flow, curv=curv, fcurv=fcurv, n1=n1, n2=n2, n3=n3, dr=dr,
                   droad=droad, treeline=treeline, forest=forest, z=z, nrm=nrm, snow=snow, rock=rock)
