"""Where every tree stands, and the forest as the game draws it.

Candidates on a jittered grid (7 m) are kept by the land cover's forest
density (the same rule that paints the forest floor under them), then given
a species by altitude and setting: birch along the river and in the village,
spruce everywhere below the treeline, larch rising toward it, stone pine at
it, young spruces at edges and in clearings; a few solitary trees stand in
the pastures. Each tree is an impostor card turned to face the eye
(yaw = -bearing), scaled 0.75-1.15, and half of them mirrored (the tree seen
from its other side) for variety.

Instances are saved to build/forest.npz for the export (EXT_mesh_gpu_instancing
per species x variant x mirror) and the light bake; for review renders the
cards are merged into one mesh per group.
"""

import json
import math
import os
import time

import bpy
import numpy as np

from . import layout as L
from . import mesh as M
from . import noise as N
from . import landcover as LC
from . import scene as S
from .noise import smoothstep

SEED = 9311
SPACING = 7.0
SINK = 0.35


def log(*a):
    print("[forest]", *a, flush=True)


def candidates(spacing=SPACING, rmax=5200.0):
    rng = np.random.default_rng(SEED)
    xs = np.arange(-5200, 5200, spacing)
    ys = np.arange(-50, rmax, spacing)
    X, Y = np.meshgrid(xs, ys)
    X = X + rng.uniform(-0.45, 0.45, X.shape) * spacing
    Y = Y + rng.uniform(-0.45, 0.45, Y.shape) * spacing
    x, y = X.ravel(), Y.ravel()
    th = np.arctan2(x, y)
    r = np.hypot(x, y)
    ok = (th > M.THETA0 + 0.01) & (th < M.THETA1 - 0.01) & (r > 25) & (r < rmax)
    return x[ok], y[ok]


def place(ter, F, quick=False):
    global _TER
    _TER = ter
    t0 = time.time()
    x, y = candidates()
    rng = np.random.default_rng(SEED + 1)
    n = len(x)
    keep = np.zeros(n, bool)
    info = {}
    CH = 400_000
    dens = np.zeros(n)
    alt = np.zeros(n)
    slope = np.zeros(n)
    dr = np.zeros(n)
    droad = np.zeros(n)
    z = np.zeros(n)
    tl = np.zeros(n)
    for a in range(0, n, CH):
        b = min(a + CH, n)
        d = LC.evaluate(F, x[a:b], y[a:b], need_forest_only=True)
        dens[a:b], alt[a:b], slope[a:b] = d['forest'], d['alt'], d['slope']
        dr[a:b], droad[a:b], z[a:b], tl[a:b] = d['dr'], d['droad'], d['z'], d['treeline']
    r = np.hypot(x, y)
    u = rng.uniform(0, 1, n)
    forest = u < np.clip(dens * 1.15, 0, 1) ** 1.2
    # solitary trees in the pastures and meadows, and birches by the river
    th = np.degrees(np.arctan2(x, y))
    open_slope = (r < 480) & (np.abs(th) < 36)
    meadow = (~forest) & (u < 0.02) & (slope < 30) & (alt < tl - 30) & (droad > 12) & (dr > 14) & ~open_slope
    clump = smoothstep(0.15, 0.55, N.fbm(x, y, SEED + 7, octaves=3, scale=1 / 90.0))
    river = (~forest) & (dr > 11) & (dr < 28) & (u < 0.16 * clump) & (droad > 8) & (alt < 30)
    keep = forest | meadow | river
    # nothing on the valley floor's sites, the roads, the river
    for c, rad in ((L.FARM_C, 34.0), (L.CHECKPOINT_C, 30.0), (L.DAM_CREST_C, 90.0)):
        keep &= np.hypot(x - c[0], y - c[1]) > rad
    for h in L.village_plan():
        keep &= np.hypot(x - h['c'][0], y - h['c'][1]) > 0.6 * max(h['w'], h['d']) + 3.0
    keep &= (dr > 10) & (droad > 5.5)
    # the player's own crest stays open: no tree within 60 m, none in the
    # sightlines straight down the slope to the road
    keep &= r > 60
    x, y, z, alt, dr, dens, tl, u = x[keep], y[keep], z[keep], alt[keep], dr[keep], dens[keep], tl[keep], u[keep]
    riverside = river[keep]
    n = len(x)
    # species
    rs = rng.uniform(0, 1, n)
    p_birch = np.where(riverside, 0.85, 0.0) + np.where(alt < 40, 0.06, 0.0)
    p_pine = 0.4 * smoothstep(tl - 110, tl, alt)
    p_larch = 0.10 + 0.45 * smoothstep(120, tl - 20, alt)
    species = np.full(n, "fir", object)
    species[rs < p_birch] = "birch"
    m2 = (species == "fir") & (rs < p_birch + p_pine)
    species[m2] = "pine"
    m3 = (species == "fir") & (rs < p_birch + p_pine + p_larch)
    species[m3] = "larch"
    # variants
    rv = rng.uniform(0, 1, n)
    variant = np.full(n, "a", object)
    edge = (dens < 0.55) | (alt > tl - 60)
    fir = species == "fir"
    variant[fir & (rv < 0.45)] = "b"
    variant[fir & ((rv > 0.8) | (edge & (rv > 0.55)))] = "c"
    variant[(species == "larch") & (rv < 0.5)] = "b"
    variant[(species == "birch") & (rv < 0.45)] = "b"
    scale = rng.uniform(0.78, 1.14, n) * (1 - 0.3 * smoothstep(tl - 80, tl + 20, alt))
    mirror = rng.uniform(0, 1, n) < 0.5
    zb = ter.height(x, y) - SINK
    # drop the trees the eye can never see (behind ridges, over the crest):
    # a point at 40% of the tree's height, hidden by more than 2 m of ground
    t1 = time.time()
    hgt = np.where(species == "fir", 24.0, np.where(species == "larch", 21.0, 13.0)) * scale
    P = np.stack([x, y, zb + 0.4 * hgt], 1)
    vis = np.ones(n, bool)
    far = np.hypot(x, y) > 150
    vis[far] = M.visible_mask(ter, P[far], margin=2.0)
    log(f"visibility: {np.count_nonzero(~vis):,} of {n:,} hidden ({time.time() - t1:.0f}s)")
    x, y, zb, species, variant, scale, mirror = x[vis], y[vis], zb[vis], species[vis], variant[vis], scale[vis], mirror[vis]
    hgt = hgt[vis]
    n = len(x)
    # keep every line of sight the game needs clear: no tree may stand in
    # front of the road, the sites, the dam's crest and the tunnel
    t1 = time.time()
    clear = sightline_clear(x, y, zb, hgt * 1.0, np.where(species == "birch", 4.0, np.where(species == "fir", 5.5, 5.0)) * scale)
    log(f"sightlines: {np.count_nonzero(~clear):,} trees removed ({time.time() - t1:.0f}s)")
    x, y, zb, species, variant, scale, mirror = x[clear], y[clear], zb[clear], species[clear], variant[clear], scale[clear], mirror[clear]
    n = len(x)
    yaw = -np.arctan2(x, y)           # the card faces the eye
    counts = {}
    for sp in ("fir", "larch", "pine", "birch"):
        counts[sp] = int(np.count_nonzero(species == sp))
    log(f"{n:,} trees {counts} ({time.time() - t0:.0f}s)")
    return dict(x=x, y=y, z=zb, species=species.astype(str), variant=variant.astype(str), scale=scale,
                mirror=mirror, yaw=yaw)


def sight_targets():
    """Points the player must be able to see: the road every 8 m (1.5 m up),
    the lanes, the sites, the dam's crest road and the tunnel's mouth."""
    pts = []
    for curve, step, up in ((L.road(), 8.0, 1.6), (L.dam_road(), 6.0, 1.6), (L.farm_lane(), 10.0, 1.2),
                            (L.switchbacks(), 12.0, 1.4)):
        for s_ in np.arange(0, curve.length, step):
            p = curve.at(s_)
            pts.append((p[0], p[1], up))
    for c, rad in ((L.FARM_C, 20.0), (L.CHECKPOINT_C, 16.0), (L.CHAPEL_C, 14.0), (L.VILLAGE_C, 40.0),
                   (L.BRIDGE_C, 22.0), (L.DAM_CREST_C, 70.0), (L.ALP_C, 20.0), (L.GOAT_CRAG_C, 30.0)):
        for a in np.linspace(0, 2 * np.pi, 9)[:-1]:
            for rr in (0.0, rad * 0.5, rad):
                pts.append((c[0] + rr * np.cos(a), c[1] + rr * np.sin(a), 2.0))
    pts.append((L.TUNNEL[0], L.TUNNEL[1], 3.0))
    return np.array(pts)


_TER = None


def sightline_clear(x, y, zb, h, half_w):
    """True for trees that hide none of the sight targets: a tree hides a
    target when the target lies behind it, within its card's angular width
    and between its base and its top as seen from the eye."""
    tg = sight_targets()
    tz = _TER.height(tg[:, 0], tg[:, 1]) + tg[:, 2]
    tb = np.arctan2(tg[:, 0], tg[:, 1])
    tr = np.hypot(tg[:, 0], tg[:, 1])
    te = np.arctan2(tz, tr)
    r = np.hypot(x, y)
    b = np.arctan2(x, y)
    e0 = np.arctan2(zb, r)
    e1 = np.arctan2(zb + h, r)
    aw = half_w / r
    ok = np.ones(len(x), bool)
    order = np.argsort(tb)
    tbs, trs, tes = tb[order], tr[order], te[order]
    for i in range(len(x)):
        lo = np.searchsorted(tbs, b[i] - aw[i])
        hi = np.searchsorted(tbs, b[i] + aw[i])
        if hi <= lo:
            continue
        sl = slice(lo, hi)
        hit = (trs[sl] > r[i] + 5.0) & (tes[sl] > e0[i]) & (tes[sl] < e1[i])
        if hit.any():
            ok[i] = False
    return ok


def save(path, inst):
    np.savez_compressed(path, **inst)


def load(path):
    d = np.load(path, allow_pickle=False)
    return {k: d[k] for k in d.files}


# ---------------------------------------------------------------------------
# cards and the impostor material

def card_geometry(dims, cell, cells, mirror):
    """A vertical card, base centred at the origin, facing -Y (Blender):
    (V, F, UV) with UVs in the species atlas' cell."""
    w, h = dims['width_m'], dims['height_m']
    V = np.array([[-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, 0, h], [-w / 2, 0, h]], np.float32)
    u0, u1 = cell / cells, (cell + 1) / cells
    if mirror:
        u0, u1 = u1, u0
    UV = np.array([[u0, 0], [u1, 0], [u1, 1], [u0, 1]], np.float32)
    F = np.array([[0, 1, 2], [0, 2, 3]])
    return V, F, UV


def impostor_material(species, imp_dir):
    from .scene import new_material
    m, g = new_material(f"impostor_{species}")
    uv = g.uv('UVMap')
    alb = g.new('ShaderNodeTexImage', interpolation='Linear', extension='EXTEND')
    ia = bpy.data.images.load(os.path.join(imp_dir, f"{species}_albedo.png"), check_existing=True)
    ia.colorspace_settings.name = 'sRGB'
    ia.alpha_mode = 'STRAIGHT'
    alb.image = ia
    g.links.new(uv, alb.inputs['Vector'])
    nrm = g.new('ShaderNodeTexImage', interpolation='Linear', extension='EXTEND')
    inn = bpy.data.images.load(os.path.join(imp_dir, f"{species}_normal.png"), check_existing=True)
    inn.colorspace_settings.name = 'Non-Color'
    inn.alpha_mode = 'CHANNEL_PACKED'
    nrm.image = inn
    g.links.new(uv, nrm.inputs['Vector'])
    nm = g.node('ShaderNodeNormalMap', inputs={'Color': nrm.outputs['Color'], 'Strength': 1.0}, space='TANGENT', uv_map='UVMap')
    ao = nrm.outputs['Alpha']
    col = g.mix(1.0, alb.outputs['Color'], g.combine(ao, ao, ao), blend='MULTIPLY')
    bs = g.principled(col, rough=0.75, spec=0.3, normal=nm)
    tr = g.node('ShaderNodeBsdfTransparent', out=0)
    cut = g.math('GREATER_THAN', alb.outputs['Alpha'], 0.4)
    g.output(g.node('ShaderNodeMixShader', inputs={0: cut, 1: tr, 2: bs}, out=0))
    return m


def build_review_objects(inst, imp_dir, col):
    """One merged mesh per species (every card of every instance), for renders."""
    meta = json.load(open(os.path.join(imp_dir, "impostors.json")))
    objs = []
    for sp in ("fir", "larch", "pine", "birch"):
        sel = inst['species'] == sp
        if not sel.any():
            continue
        cells = meta[sp]['cells']
        dims = {d['variant']: (i, d) for i, d in enumerate(meta[sp]['variants'])}
        Vs, Fs, UVs = [], [], []
        base = 0
        idx = np.nonzero(sel)[0]
        for i in idx:
            cell, d = dims[inst['variant'][i]]
            V, F, UV = card_geometry(d, cell, cells, bool(inst['mirror'][i]))
            c, s_ = math.cos(inst['yaw'][i]), math.sin(inst['yaw'][i])
            R = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])
            V = (V * inst['scale'][i]) @ R.T + np.array([inst['x'][i], inst['y'][i], inst['z'][i]])
            Vs.append(V)
            Fs.append(F + base)
            UVs.append(UV)
            base += 4
        V = np.vstack(Vs)
        F = np.vstack(Fs)
        UV = np.vstack(UVs)
        ob = S.mesh_object(f"review_forest.{sp}", V, F, col, uvs={"UVMap": UV}, smooth=False, export=0)
        ob.data.materials.append(impostor_material(sp, imp_dir))
        objs.append(ob)
        log(f"review mesh {sp}: {len(idx):,} cards")
    return objs
