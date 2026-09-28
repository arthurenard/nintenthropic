"""The valley's buildings: the village's stone houses and chapel, the farm,
the checkpoint and its watchtower, the stone bridge, the dam and the tunnel.

Built with kit.py into one object per (site, material): `village.rubble`,
`bridge.ashlar`, ... under a `site.<name>` empty. Every building stands on
the pad the terrain stage levelled for it (layout.village_plan), its walls
running 0.8 m into the ground so no uneven edge ever shows a gap.
"""

import math
import time

import numpy as np

from . import layout as L
from . import kit as K
from .kit import frame, xf, wall, window, gable_roof, gable_wall

FLOOR_H = 2.75
BURY = 0.8

SURFACES = {
    "rubble": "stone", "ashlar": "stone", "plaster": "stone", "boards": "wood", "slabs": "stone", "shingles": "wood",
    "concrete": "stone", "paint": "metal", "sandbag": "cloth", "road": "dirt", "setts": "stone", "timber": "wood",
    "glass": "glass", "dark": "stone", "metal": "metal", "hay": "cloth", "cheese": "cloth", "rock": "rock",
}


def log(*a):
    print("[buildings]", *a, flush=True)


def side_frames(M, w, d):
    """Frames of the four walls (front -Y, right +X, back +Y, left -X): in
    each, local x runs along the wall as seen from outside, outward is -Y."""
    out = []
    for (ox, oy, rot, span) in ((-w / 2, -d / 2, 0.0, w), (w / 2, -d / 2, math.pi / 2, d),
                                (w / 2, d / 2, math.pi, w), (-w / 2, d / 2, -math.pi / 2, d)):
        out.append((M @ frame((ox, oy), rot), span))
    return out


def openings_row(rng, span, n, wdt, hgt, z, jitter=0.25, avoid=()):
    ops = []
    if n <= 0:
        return ops
    step = span / n
    for i in range(n):
        c = step * (i + 0.5) + rng.uniform(-jitter, jitter) * step * 0.3
        a, b = c - wdt / 2, c + wdt / 2
        if a < 0.5 or b > span - 0.5:
            continue
        if any(not (b < o[0] - 0.3 or a > o[1] + 0.3) for o in avoid):
            continue
        ops.append((a, b, z, z + hgt))
    return ops


# ---------------------------------------------------------------------------
# houses and barns

def house(kit, c, w, d, rot, floors, rng, z0, style=None):
    """A village house: rubble (or plastered, or Walser timber on a stone
    ground floor), deep-set windows with shutters, a door to the street,
    sometimes a wooden balcony on the gable, a slab roof and a chimney.
    Local frame: front (to the street) at -Y."""
    M = frame(c, rot, z0)
    style = style or rng.choice(["rubble", "rubble", "plaster", "walser"])
    z_eave = floors * FLOOR_H + 0.25
    pitch = rng.uniform(28, 34)
    depth = 0.5
    for si, (Ms, span) in enumerate(side_frames(M, w, d)):
        ops_by_floor = []
        for f in range(floors):
            zf = f * FLOOR_H
            n = max(1, int(span / 3.3)) if si in (0, 2) else max(1, int(span / 3.8))
            if si == 0 and f == 0:
                door = (span / 2 - 0.5 + rng.uniform(-1, 1), span / 2 + 0.5 + rng.uniform(-1, 1))
                door = (max(door[0], 0.9), max(door[0], 0.9) + 1.0)
                ops = [(door[0], door[1], 0.0, 2.05)]
                ops += openings_row(rng, span, n, 0.72, 0.95, zf + 0.95, avoid=[door])
            else:
                ops = openings_row(rng, span, n, 0.72, 0.98, zf + 0.9)
            ops_by_floor.append(ops)
        ops = [o for fl in ops_by_floor for o in fl]
        if style == "walser":
            low = [o for o in ops if o[3] <= FLOOR_H]
            high = [o for o in ops if o[3] > FLOOR_H]
            wall(kit, Ms, 0, span, -BURY, FLOOR_H, "rubble", low, depth)
            wall(kit, Ms, 0, span, FLOOR_H, z_eave, "boards", high, 0.18, reveal_mat="timber")
        else:
            m = "plaster" if style == "plaster" else "rubble"
            wall(kit, Ms, 0, span, -BURY, z_eave, m, ops, depth)
            if style == "plaster":
                # a stone plinth under the plaster
                kit.box(Ms, (0, -0.03, -BURY), (span, 0.0, 0.6), "rubble", skip=('+y', '-z'))
        for o in ops:
            if o[2] < 0.1:          # the door
                kit.box(Ms, (o[0], depth - 0.12, 0.0), (o[1], depth - 0.06, o[3]), "boards")
                continue
            dep = 0.18 if (style == "walser" and o[3] > FLOOR_H) else depth
            window(kit, Ms, o[0], o[1], o[2], o[3], dep, shutters=rng.choice(["open", "open", "closed", None]), rng=rng)
        # quoins at the corners of stone houses
        if style in ("rubble", "plaster"):
            zc = -BURY
            k = 0
            while zc < z_eave - 0.1:
                hq = min(0.36, z_eave - zc)
                L_ = 0.55 if k % 2 == 0 else 0.35
                kit.box(Ms, (0, -0.025, zc), (L_, 0.0, zc + hq - 0.01), "ashlar", skip=('+y', '-z'))
                zc += hq
                k += 1
    # gables: ridge along local Y (gable ends front and back)
    zr = gable_roof(kit, M, w, d, z_eave, pitch, "slabs")
    for y, mat in ((-d / 2, "boards" if style == "walser" else ("plaster" if style == "plaster" else "rubble")),
                   (d / 2, "rubble" if style != "walser" else "boards")):
        gable_wall(kit, M, w, z_eave, zr - 0.2, y, mat)
    # a gable window (hay door / attic) at the front
    if rng.uniform() < 0.6:
        Mf = M @ frame((-0.35, -d / 2 - 0.01), 0.0)
        kit.box(Mf, (0, 0, z_eave + 0.4), (0.7, 0.04, z_eave + 1.2), "boards")
    # chimney
    cx = rng.uniform(-w * 0.15, w * 0.15)
    cy = rng.uniform(-d * 0.25, d * 0.25)
    zt = zr + 0.9
    kit.box(M, (cx - 0.3, cy - 0.3, zr - 1.2), (cx + 0.3, cy + 0.3, zt), "rubble", skip=('-z',))
    kit.box(M, (cx - 0.42, cy - 0.42, zt), (cx + 0.42, cy + 0.42, zt + 0.08), "slabs")
    # balcony on the front gable
    if floors >= 2 and rng.uniform() < 0.5:
        bw = w * rng.uniform(0.5, 0.7)
        zb = FLOOR_H + 0.05
        Mb = M @ frame((0, -d / 2), 0.0)
        kit.box(Mb, (-bw / 2, -1.15, zb - 0.12), (bw / 2, 0.0, zb), "timber")
        for sx in (-bw / 2 + 0.1, bw / 2 - 0.1):
            kit.box(Mb, (sx - 0.06, -1.1, zb - 0.9), (sx + 0.06, 0.0, zb - 0.12), "timber")
        kit.box(Mb, (-bw / 2, -1.15, zb), (bw / 2, -1.1, zb + 1.0), "boards", skip=('-z',))
        kit.box(Mb, (-bw / 2, -1.15, zb), (-bw / 2 + 0.05, 0.0, zb + 1.0), "boards", skip=('-z',))
        kit.box(Mb, (bw / 2 - 0.05, -1.15, zb), (bw / 2, 0.0, zb + 1.0), "boards", skip=('-z',))
        kit.box(Mb, (-bw / 2 - 0.02, -1.18, zb + 1.0), (bw / 2 + 0.02, -1.07, zb + 1.06), "timber")
    return dict(z_eave=z_eave, ridge=zr, style=style)


def barn(kit, c, w, d, rot, rng, z0, roof="slabs"):
    """A hay barn: rubble ground floor (the byre), a timber upper floor of
    vertical boards with gaps for the hay to breathe, a big door in the
    gable, small byre windows."""
    M = frame(c, rot, z0)
    z1 = 3.0
    z_eave = 7.2
    for si, (Ms, span) in enumerate(side_frames(M, w, d)):
        low = openings_row(rng, span, max(1, int(span / 4)), 0.55, 0.5, 1.5)
        if si == 0:
            low = [(span / 2 - 1.1, span / 2 + 1.1, 0.0, 2.3)]
        wall(kit, Ms, 0, span, -BURY, z1, "rubble", low, 0.5)
        for o in low:
            if o[2] < 0.1:
                kit.box(Ms, (o[0], 0.35, 0), (o[1], 0.42, o[3]), "boards")
            else:
                kit.face(xf(Ms, [(o[0], 0.4, o[2]), (o[1], 0.4, o[2]), (o[1], 0.4, o[3]), (o[0], 0.4, o[3])]), "dark")
        up = []
        if si == 2:
            up = [(span / 2 - 1.5, span / 2 + 1.5, z1 + 0.2, z1 + 3.0)]
        wall(kit, Ms, 0, span, z1, z_eave, "boards", up, 0.1, reveal_mat="timber")
        for o in up:
            kit.face(xf(Ms, [(o[0], 0.1, o[2]), (o[1], 0.1, o[2]), (o[1], 0.1, o[3]), (o[0], 0.1, o[3])]), "dark")
    zr = gable_roof(kit, M, w, d, z_eave, 30.0, roof, over_side=0.8, over_gable=0.6)
    for y in (-d / 2, d / 2):
        gable_wall(kit, M, w, z_eave, zr - 0.2, y, "boards")
    return dict(z_eave=z_eave, ridge=zr)


# ---------------------------------------------------------------------------
# the chapel

def chapel(kit, c, rot, rng, z0):
    """The chapel of the Valle Serra: a whitewashed nave under a steep slab
    roof, its semicircular apse toward the sunrise (toward the player), a
    rubble campanile at the front corner with an open belfry - the bell
    inside, and room for a man to lie behind the parapet."""
    M = frame(c, rot, z0)
    w, d = 10.5, 21.0
    z_eave = 7.4
    for si, (Ms, span) in enumerate(side_frames(M, w, d)):
        ops = []
        if si in (1, 3):
            for k in range(3):
                x = span * (k + 1) / 4
                ops.append((x - 0.45, x + 0.45, 2.6, 5.6))
        if si == 0:
            ops = [(span / 2 - 0.8, span / 2 + 0.8, 0.0, 3.0)]
        wall(kit, Ms, 0, span, -BURY, z_eave, "plaster", ops, 0.8)
        kit.box(Ms, (0, -0.04, -BURY), (span, 0.0, 0.7), "rubble", skip=('+y', '-z'))
        for o in ops:
            if o[2] < 0.1:
                kit.box(Ms, (o[0], 0.6, 0.0), (o[1], 0.7, o[3]), "boards")
                kit.box(Ms, (o[0] - 0.25, -0.12, o[3]), (o[1] + 0.25, 0.0, o[3] + 0.35), "ashlar")
            else:
                kit.face(xf(Ms, [(o[0], 0.6, o[2]), (o[1], 0.6, o[2]), (o[1], 0.6, o[3]), (o[0], 0.6, o[3])]), "glass")
                kit.box(Ms, (o[0] - 0.15, -0.05, o[2] - 0.15), (o[1] + 0.15, 0.0, o[2]), "ashlar")
                kit.box(Ms, (o[0] - 0.15, -0.05, o[3]), (o[1] + 0.15, 0.0, o[3] + 0.2), "ashlar")
    zr = gable_roof(kit, M, w, d, z_eave, 38.0, "slabs", over_side=0.5, over_gable=0.3)
    gable_wall(kit, M, w, z_eave, zr - 0.2, -d / 2, "plaster")
    gable_wall(kit, M, w, z_eave, zr - 0.2, d / 2, "plaster")
    # the apse: a half-cylinder off the back wall under a half-cone roof
    ra = w / 2 - 0.9
    Ma = M @ frame((0, d / 2), 0.0)
    n = 10
    for i in range(n):
        a0 = math.pi * i / n
        a1 = math.pi * (i + 1) / n
        p0 = (ra * math.cos(a0), ra * math.sin(a0))
        p1 = (ra * math.cos(a1), ra * math.sin(a1))
        kit.face(xf(Ma, [(p1[0], p1[1], -BURY), (p0[0], p0[1], -BURY), (p0[0], p0[1], 6.2), (p1[0], p1[1], 6.2)]), "plaster")
        q0 = ((ra + 0.4) * math.cos(a0), (ra + 0.4) * math.sin(a0))
        q1 = ((ra + 0.4) * math.cos(a1), (ra + 0.4) * math.sin(a1))
        kit.face(xf(Ma, [(q1[0], q1[1], 6.0), (q0[0], q0[1], 6.0), (0, 0, 8.6)]), "slabs")
    # the campanile at the front-left corner
    tw = 4.3
    tc = (-w / 2 - tw / 2 + 0.6, -d / 2 + tw / 2 + 0.8)
    Mt = M @ frame(tc, 0.0)
    z_bel0, z_bel1 = 15.2, 18.6
    for si, (Ms, span) in enumerate(side_frames(Mt, tw, tw)):
        ops = [(span / 2 - 0.25, span / 2 + 0.25, 6.0 + 3.6 * k, 6.9 + 3.6 * k) for k in range(2)]
        wall(kit, Ms, 0, span, -BURY, z_bel0, "rubble", ops, 0.7)
        for o in ops:
            kit.face(xf(Ms, [(o[0], 0.68, o[2]), (o[1], 0.68, o[2]), (o[1], 0.68, o[3]), (o[0], 0.68, o[3])]), "dark")
        # the belfry: two openings a side with a pier between
        bel = [(0.55, span / 2 - 0.3, z_bel0 + 0.9, z_bel1), (span / 2 + 0.3, span - 0.55, z_bel0 + 0.9, z_bel1)]
        wall(kit, Ms, 0, span, z_bel0, z_bel1 + 1.1, "rubble", bel, 0.7, reveal_mat="ashlar")
        kit.box(Ms, (-0.12, -0.15, z_bel0 - 0.1), (span + 0.12, 0.0, z_bel0 + 0.1), "ashlar", skip=('+y',))
        kit.box(Ms, (-0.12, -0.18, z_bel1 + 1.0), (span + 0.12, 0.0, z_bel1 + 1.22), "ashlar", skip=('+y',))
        zc = -BURY
        k = 0
        while zc < z_bel1 + 1.0:
            L_ = 0.6 if k % 2 == 0 else 0.38
            kit.box(Ms, (0, -0.03, zc), (L_, 0.0, zc + 0.39), "ashlar", skip=('+y', '-z'))
            zc += 0.4
            k += 1
    # the belfry's floor and inner walls, so the openings read as a room
    kit.box(Mt, (-tw / 2 + 0.7, -tw / 2 + 0.7, z_bel0 - 0.2), (tw / 2 - 0.7, tw / 2 - 0.7, z_bel0 + 0.9), "timber")
    for (Ms, span) in side_frames(Mt, tw - 1.4, tw - 1.4):
        kit.face(xf(Ms, [(span, 0, z_bel0 + 0.9), (0, 0, z_bel0 + 0.9), (0, 0, z_bel1 + 1.1), (span, 0, z_bel1 + 1.1)]), "rubble")
    # a pyramid roof in slabs, an iron cross on it
    zt = z_bel1 + 1.22
    h = 5.2
    o = tw / 2 + 0.3
    for (a, b) in (((-o, -o), (o, -o)), ((o, -o), (o, o)), ((o, o), (-o, o)), ((-o, o), (-o, -o))):
        kit.face(xf(Mt, [(a[0], a[1], zt), (b[0], b[1], zt), (0, 0, zt + h)]), "slabs")
    kit.box(Mt, (-0.04, -0.04, zt + h), (0.04, 0.04, zt + h + 1.3), "metal")
    kit.box(Mt, (-0.35, -0.04, zt + h + 0.75), (0.35, 0.04, zt + h + 0.83), "metal")
    tower_world = xf(M, [(tc[0], tc[1], 0.0)])[0]
    return dict(tower=tower_world, tower_w=tw, rot=rot, belfry=(z0 + z_bel0 + 0.9, z0 + z_bel1), ridge=zr + z0)


def bell_mesh(size=0.75):
    """A bronze bell (a lathe profile), mouth down, the yoke's pivot at the
    origin. Returns (V, F, UV)."""
    prof = [(0.02, 0.0), (0.18, 0.0), (0.26, -0.06), (0.30, -0.25), (0.34, -0.5), (0.45, -0.68), (0.5, -0.74),
            (0.46, -0.76), (0.40, -0.72)]
    prof = [(r * size, zz * size - 0.12) for r, zz in prof]
    n = 16
    V, F, UV = [], [], []
    for i, (r, zz) in enumerate(prof):
        for j in range(n):
            a = 2 * math.pi * j / n
            V.append((r * math.cos(a), r * math.sin(a), zz))
            UV.append((j / n, i / len(prof)))
    for i in range(len(prof) - 1):
        for j in range(n):
            a = i * n + j
            b = i * n + (j + 1) % n
            F += [(a, b + n, b), (a, a + n, b + n)]
    # the yoke: a beam across the top
    base = len(V)
    for (x, y, z) in [(-0.7, -0.08, -0.05), (0.7, -0.08, -0.05), (0.7, 0.08, -0.05), (-0.7, 0.08, -0.05),
                      (-0.7, -0.08, 0.1), (0.7, -0.08, 0.1), (0.7, 0.08, 0.1), (-0.7, 0.08, 0.1)]:
        V.append((x, y, z))
        UV.append((0, 0))
    for q in ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
        F += [(base + q[0], base + q[1], base + q[2]), (base + q[0], base + q[2], base + q[3])]
    return np.array(V), np.array(F), np.array(UV)


# ---------------------------------------------------------------------------
# the village

def build_village(ter, col):
    rng = np.random.default_rng(1907)
    kit = K.Kit("village")
    info = {}
    for h in L.village_plan():
        c = np.array(h['c'])
        z0 = float(ter.height(np.array([c[0]]), np.array([c[1]]))[0])
        if h['kind'] == 'chapel':
            info['chapel'] = chapel(kit, c, h['rot'], rng, z0)
        elif h['kind'] == 'square':
            M = frame(c, h['rot'], z0 + 0.03)
            kit.face(xf(M, [(-h['w'] / 2, -h['d'] / 2, 0), (h['w'] / 2, -h['d'] / 2, 0), (h['w'] / 2, h['d'] / 2, 0),
                            (-h['w'] / 2, h['d'] / 2, 0)]), "setts")
            kit.box(M, (-1.6, -0.6, -0.3), (1.6, 0.6, 0.75), "ashlar")
            kit.box(M, (-1.45, -0.45, 0.6), (1.45, 0.45, 0.76), "dark", skip=('-z',))
            kit.box(M, (1.6, -0.2, -0.3), (2.0, 0.2, 1.6), "ashlar")
            info['square'] = (c, z0)
        else:
            house(kit, c, h['w'], h['d'], h['rot'], h['floors'], np.random.default_rng(h['seed']), z0 - 0.05)
    objs = kit.build(col, SURFACES)
    return objs, info



def jsonable(o):
    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    return o


def _sites():
    from . import sites
    return [("village", build_village), ("farm", sites.build_farm), ("checkpoint", sites.build_checkpoint),
            ("bridge", sites.build_bridge), ("dam", sites.build_dam), ("alp", sites.build_alp)]
