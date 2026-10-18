"""What lies close: the rock the rifle rests on, the grass and the last
wildflowers under the scope (the design wants them in the frame, out of
focus), outcrops and boulders on the player's pasture, and the stands of the
soldiers' target range.

    foreground.rock    the rifle's rest, 1 m in front of the eye
    foreground.grass   tufts and flowers from 0.6 to 14 m (vertex-coloured
                       blades: COLOR_0 is their colour; sway them by uv.v,
                       0 at the root and 1 at the tip)
    rocks.slope        boulders and outcrops on the slope below
    range.stands       posts and crossbars the plates hang from
"""

import math

import numpy as np

from . import layout as L
from . import scene as S


def log(*a):
    print("[foreground]", *a, flush=True)


def _z(ter, x, y):
    return ter.height(np.asarray(x, float), np.asarray(y, float))


def tip_limit(b_deg, r):
    """Highest a tuft may reach at bearing b and range r: its tip must stay
    under the sightlines to the valley - 19 degrees down in the middle of the
    view, 12 at the sides (where the grass may frame the picture)."""
    lim = -19.0 + 13.0 * min(max((abs(b_deg) - 22.0) / 16.0, 0.0), 1.0)
    return r * math.tan(math.radians(lim))


def blades(ter, rng, n_tufts=420):
    V, F, C, UV = [], [], [], []
    base = 0
    greens = np.array([[0.045, 0.075, 0.022], [0.06, 0.09, 0.03], [0.09, 0.10, 0.035], [0.13, 0.11, 0.05], [0.16, 0.14, 0.07]])
    for t in range(n_tufts):
        # denser close in front of the scope, thinning out to 14 m
        r = 0.5 + 5.5 * rng.uniform() ** 1.8
        bd = rng.uniform(-55, 55)
        b = math.radians(bd)
        cx, cy = r * math.sin(b), r * math.cos(b)
        cz = float(_z(ter, cx, cy))
        hmax = tip_limit(bd, r) - cz
        if hmax < 0.05:
            continue
        nb = int(rng.integers(10, 26))
        for k in range(nb):
            a = rng.uniform(0, 2 * np.pi)
            rr = rng.uniform(0, 0.09)
            bx, by = cx + rr * math.cos(a), cy + rr * math.sin(a)
            h = min(rng.uniform(0.06, 0.22), hmax * rng.uniform(0.6, 1.0))
            w = rng.uniform(0.004, 0.008)
            lean = rng.uniform(0.1, 0.6)
            d = np.array([math.cos(a), math.sin(a)])
            tw = rng.uniform(0, np.pi)
            sx, sy = -math.sin(tw) * w / 2, math.cos(tw) * w / 2
            col = greens[rng.integers(len(greens))] * rng.uniform(0.8, 1.2)
            if rng.uniform() < 0.25:
                col = np.array([0.20, 0.17, 0.08]) * rng.uniform(0.8, 1.2)       # dry, late September
            segs = 4
            for i in range(segs + 1):
                s = i / segs
                off = d * lean * h * s * s
                ww = 1 - s * 0.9
                p = np.array([bx + off[0], by + off[1], cz - 0.02 + h * s * (1 - 0.25 * lean * s)])
                V.append(p + [sx * ww, sy * ww, 0])
                V.append(p - [sx * ww, sy * ww, 0])
                c = col * (0.45 + 0.55 * s)
                C += [c, c]
                UV += [(0.0, s), (1.0, s)]
            for i in range(segs):
                a0 = base + 2 * i
                F += [(a0, a0 + 1, a0 + 3), (a0, a0 + 3, a0 + 2)]
            base += 2 * (segs + 1)
        # now and then a flower on a stalk: harebell blue, a yellow hawkbit
        if rng.uniform() < 0.035 and abs(bd) > 12:
            fc = np.array([0.20, 0.22, 0.55]) if rng.uniform() < 0.5 else np.array([0.75, 0.55, 0.05])
            hh = min(rng.uniform(0.12, 0.25), hmax)
            top = np.array([cx, cy, cz + hh])
            ring = [top + np.array([0.011 * math.cos(q), 0.011 * math.sin(q), -0.004]) for q in np.linspace(0, 2 * np.pi, 7)[:-1]]
            V += [top + [0, 0, 0.012]] + ring
            C += [fc] * 7
            UV += [(0.5, 1.0)] * 7
            F += [(base, base + 1 + j, base + 1 + (j + 1) % 6) for j in range(6)]
            base += 7
            V += [np.array([cx - 0.002, cy, cz]), np.array([cx + 0.002, cy, cz]), top + [0.002, 0, 0], top - [0.002, 0, 0]]
            C += [np.array([0.05, 0.08, 0.03])] * 4
            UV += [(0, 0), (1, 0), (1, 1), (0, 1)]
            F += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
            base += 4
    return np.array(V), np.array(F), np.array(C), np.array(UV)


def build(ter, col, plates=None):
    from .contract import rock_mesh
    rng = np.random.default_rng(611)
    objs = []
    # the rifle's rest: a lichened block of gneiss just in front of the eye
    rock = rock_mesh(col, "foreground.rock", (0.03, 0.95, -0.72), 0.32, seed=17, surface="rock", detail=5,
                     note="the rock the rifle rests on; its top is ~0.45 m under the eye")
    rock.scale = (1.3, 0.8, 0.8)
    objs.append(rock)
    V, F, C, UV = blades(ter, rng)
    g = S.mesh_object("foreground.grass", V, F, col, uvs={"UVMap": UV}, smooth=True, surface="grass", material_key="grass_blades",
                      note="tufts and flowers under the scope; COLOR_0 is their colour, uv.v 0 at the root to 1 at the tip")
    ca = g.data.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set("color", np.hstack([C, np.ones((len(C), 1))]).astype(np.float32).ravel())
    objs.append(g)
    log(f"grass: {len(F):,} triangles")
    # boulders and outcrops on the slope below (clear of the plates' lines)
    rocks = []
    for k in range(34):
        b = rng.uniform(-44, 44)
        r = 40 + 260 * rng.uniform() ** 1.3
        p = L.polar(b, r)[:2]
        size = rng.uniform(0.5, 2.6) * (1.6 if rng.uniform() < 0.15 else 1.0)
        z = float(_z(ter, p[0], p[1]))
        rocks.append(rock_mesh(col, f"_rock{k}", (p[0], p[1], z - size * 0.2), size, seed=100 + k))
    # join them into one object
    import bpy
    with bpy.context.temp_override(active_object=rocks[0], selected_editable_objects=rocks, selected_objects=rocks):
        bpy.ops.object.join()
    rocks[0].name = "rocks.slope"
    rocks[0].data.name = "rocks.slope"
    S.tag(rocks[0], surface="rock", material_key="rock_vc")
    objs.append(rocks[0])
    # the range's stands: a post and a crossbar for each plate
    from . import kit as K
    kit = K.Kit("range")
    for i in range(1, 10):
        ob = bpy.data.objects.get(f"calib.{i}")
        if ob is None:
            continue
        c = np.array(ob.matrix_world.translation)
        e = -c[:2] / np.linalg.norm(c[:2])
        side = np.array([e[1], -e[0]])
        zg = float(_z(ter, c[0], c[1]))
        ang = math.atan2(side[1], side[0])
        M = K.frame(c[:2] + side * 0.55, ang, zg)
        kit.box(M, (-0.05, -0.05, -0.3), (0.05, 0.05, c[2] - zg + 0.45), "timber", skip=('-z',))
        M2 = K.frame(c[:2], ang, c[2] + 0.4)
        kit.box(M2, (-0.6, -0.04, -0.04), (0.6, 0.04, 0.04), "timber")
        M3 = K.frame(c[:2] - side * 0.55, ang, zg)
        kit.box(M3, (-0.05, -0.05, -0.3), (0.05, 0.05, c[2] - zg + 0.45), "timber", skip=('-z',))
    objs += kit.build(col, {"timber": "wood"})
    return objs
