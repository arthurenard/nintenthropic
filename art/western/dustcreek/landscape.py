"""The ground: Main Street's packed dirt with wheel ruts and hoofprints, the
desert floor around the town, and the ridge behind the church.

The street ground is a dense height field (a few cm per quad near the
player) because wheel ruts only look real when the low sun makes them cast
little shadows; the hoofprints are drawn by the dirt shader. That dense mesh
is what Cycles bakes; the exported street is a lighter mesh that reads the
same baked picture (see bake.py).
"""

import bpy
import numpy as np

from .core import rng, tag
from .nodes import new_material
from .materials import lin

# Street area covered by the dense height field (Blender coords)
STREET_X = (-32.0, 32.0)
STREET_Y = (-8.0, 80.0)


# ---------------------------------------------------------------------------
# Height field

def _grid_axis(a, b, fine, coarse, fine_range, grow=None):
    """1D coordinates from a to b, `fine` spacing inside fine_range and
    growing to `coarse` outside; grow(y) optionally scales spacing with
    distance from the player."""
    xs = [a]
    x = a
    while x < b:
        inside = fine_range[0] <= x <= fine_range[1]
        step = fine if inside else coarse
        if grow is not None:
            step *= grow(x)
        x = min(b, x + step)
        xs.append(x)
    return np.array(xs)


def lanes():
    """Wagon lanes as (x(y) function, weight). Traffic hugs two lanes and
    swings toward the livery doors at the far left."""
    def lane(x0, amp, ph, bend_to=None, bend_start=38.0):
        def f(y):
            x = x0 + amp * np.sin(y * 0.07 + ph) + 0.25 * np.sin(y * 0.23 + ph * 2)
            if bend_to is not None:
                t = np.clip((y - bend_start) / 10.0, 0, 1)
                t = t * t * (3 - 2 * t)
                x = x * (1 - t) + bend_to * t
            return x
        return f
    return [
        (lane(-2.6, 0.5, 0.3), 1.0),
        (lane(-2.2, 0.4, 1.9, bend_to=-6.5, bend_start=36.0), 0.7),
        (lane(2.1, 0.45, 2.7), 1.0),
        (lane(2.6, 0.35, 4.1), 0.6),
        (lane(-0.2, 0.8, 5.3), 0.4),
    ]


def height_field(X, Y, r):
    """Heights (m) for grid arrays X, Y. Also returns a 'rut' mask (0..1)
    and a 'print' mask used by the dirt shader."""
    H = np.zeros_like(X)
    # crowned street, drainage to the sides, gentle undulation
    H += 0.05 * np.exp(-(X / 6.0) ** 2)
    H += 0.03 * np.sin(X * 0.4 + 1.3) * np.sin(Y * 0.21) + 0.02 * np.sin(Y * 0.53 + X * 0.3)
    rut = np.zeros_like(X)
    lane = np.zeros_like(X)
    track = 0.78  # half gauge of a wagon
    # Real ruts in packed dirt are shallow (1-3 cm) and narrow (an iron tyre
    # is ~6 cm): several wagons' passes, slightly offset, make each track.
    for f, wgt in lanes():
        cx = f(Y)
        lane = np.maximum(lane, wgt * np.exp(-((X - cx) / 0.55) ** 2))
        for side in (-1, 1):
            for k, (off, depth, w) in enumerate(((0.0, 0.016, 0.05), (0.09, 0.008, 0.045), (-0.07, 0.01, 0.04))):
                dx = X - (cx + side * track + off * side)
                prof = np.exp(-(dx / w) ** 2)
                berm = np.exp(-((np.abs(dx) - 2.2 * w) / (0.8 * w)) ** 2)
                H -= wgt * depth * prof
                H += wgt * depth * 0.22 * berm
                rut = np.maximum(rut, wgt * prof)
    # fade the ruts out under the boardwalks and near buildings
    fade = np.clip((7.6 - np.abs(X)) / 1.5, 0, 1)
    H = H * (0.35 + 0.65 * fade)
    rut *= fade
    lane *= fade
    return H, rut, lane


def street_ground(lib, col, dense=True):
    """The dense street height field as an object named `ground.street`."""
    r = rng("ground")
    grow = lambda y: max(1.0, (abs(y) + 2.0) / 9.0) ** 0.85
    if dense:
        xs = _grid_axis(STREET_X[0], STREET_X[1], 0.04, 0.25, (-9.0, 9.0))
        ys = _grid_axis(STREET_Y[0], STREET_Y[1], 0.04, 0.04, (STREET_Y[0], STREET_Y[1]), grow=grow)
    else:
        xs = _grid_axis(STREET_X[0], STREET_X[1], 0.5, 1.5, (-9.0, 9.0))
        ys = _grid_axis(STREET_Y[0], STREET_Y[1], 0.5, 0.5, (STREET_Y[0], STREET_Y[1]), grow=grow)
    X, Y = np.meshgrid(xs, ys)
    H, rut, lane = height_field(X, Y, r)
    # Hoof- and bootprints are drawn by the dirt shader (crisp at any mesh
    # density); the mesh carries only the ruts and the lane mask.
    # blend the edges of the field to z=0 so the terrain meets it cleanly
    ex = np.clip((STREET_X[1] - np.abs(X)) / 3.0, 0, 1)
    ey = np.clip(np.minimum(Y - STREET_Y[0], STREET_Y[1] - Y) / 3.0, 0, 1)
    H *= ex * ey
    ob = grid_object("ground.street", X, Y, H, col, attrs={'rut': rut, 'lane': lane})
    ob.data.materials.append(lib['ground_dirt'])
    tag(ob, surface='dirt', group='ground')
    print(f"street ground: {len(xs)}x{len(ys)} = {len(xs) * len(ys)} verts")
    return ob


def ground_z(x, y):
    """Street surface height at (x, y) (the same field as the dense mesh),
    for placing stones, grass and props."""
    X = np.array([[float(x)]])
    Y = np.array([[float(y)]])
    H, _, _ = height_field(X, Y, None)
    ex = np.clip((STREET_X[1] - np.abs(X)) / 3.0, 0, 1)
    ey = np.clip(np.minimum(Y - STREET_Y[0], STREET_Y[1] - Y) / 3.0, 0, 1)
    if not (STREET_X[0] <= x <= STREET_X[1] and STREET_Y[0] <= y <= STREET_Y[1]):
        return 0.0
    return float((H * ex * ey)[0, 0])


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


def terrain_height(X, Y):
    """Desert around the town: flat near the street, a ridge behind the
    church (where the windmill stands), low bluffs to the sides."""
    d_town = np.maximum(0, np.maximum(np.abs(X) - 28, 0) + np.maximum(Y - 76, 0) + np.maximum(-Y - 6, 0))
    base = np.clip(d_town / 40.0, 0, 1) ** 1.5
    ridge = 8.0 * np.exp(-((Y - 215 - 30 * np.sin(X * 0.012 + 0.5)) / 55.0) ** 2) * (0.7 + 0.3 * np.sin(X * 0.02))
    swell = 2.0 * np.sin(X * 0.021 + 1.2) * np.sin(Y * 0.017) + 1.2 * np.sin(X * 0.05 + Y * 0.03)
    bluffs = 10.0 * np.clip((np.abs(X) - 120) / 150.0, 0, 1)
    far = 6.0 * np.clip((Y - 280) / 200.0, 0, 1) * np.sin(X * 0.008 + 2.0)
    return base * (ridge + swell + bluffs + far + 2.0)


def terrain(lib, col):
    """Desert floor to ~1.2 km, with a hole where the dense street lies."""
    xs = np.concatenate([np.linspace(-1200, -130, 26), np.linspace(-120, 120, 61), np.linspace(130, 1200, 26)])
    ys = np.concatenate([np.linspace(-300, -20, 12), np.linspace(-16, 300, 80), np.linspace(310, 1400, 30)])
    X, Y = np.meshgrid(xs, ys)
    H = terrain_height(X, Y)
    ob = grid_object("ground.terrain", X, Y, H, col)
    # cut out quads fully inside the dense street area (they would z-fight)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = []
    for f in bm.faces:
        xs_ = [v.co.x for v in f.verts]
        ys_ = [v.co.y for v in f.verts]
        if (min(xs_) >= STREET_X[0] - 0.01 and max(xs_) <= STREET_X[1] + 0.01 and
                min(ys_) >= STREET_Y[0] - 0.01 and max(ys_) <= STREET_Y[1] + 0.01):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.materials.append(lib['ground_desert'])
    tag(ob, surface='dirt', group='ground')
    return ob


# ---------------------------------------------------------------------------
# Materials

def dirt_material(lib):
    """Packed street dirt: warm tan with darker compacted ruts, pale loose
    dust, pebbles, dry crust cracks, and hoof- and bootprints drawn
    procedurally so they stay crisp at any mesh density."""
    import math as _m
    m, g = new_material("ground_dirt")
    pos = g.geo('Position')
    x, y, z = g.separate(pos)
    rut = g.attr('rut')
    lane = g.attr('lane')
    xy = g.combine(x, y, 0.0)
    big = g.noise(xy, scale=0.08, detail=3.0, rough=0.5)
    mid = g.noise(pos, scale=0.9, detail=6.0, rough=0.6)
    fine = g.noise(pos, scale=18.0, detail=4.0, rough=0.6)
    col = g.ramp(g.add(g.mul(big, 0.6), g.mul(mid, 0.4)), [
        (0.30, lin(140, 114, 92)), (0.5, lin(166, 140, 114)), (0.72, lin(188, 166, 140))])
    # metre-scale patches: packed, slightly redder earth vs pale loose dust
    patch = g.noise(xy, scale=0.35, detail=4.0, rough=0.55)
    col = g.mix(g.smooth(patch, 0.38, 0.62), g.hsv(col, s=1.18, v=0.86), g.hsv(col, s=0.8, v=1.08))
    grain = g.noise(pos, scale=70.0, detail=2.0)
    col = g.mix(g.mul(grain, 0.18), col, g.hsv(col, v=0.8))
    # compacted tracks: a little darker, smoother
    col = g.mix(g.mul(rut, 0.45), col, g.hsv(col, v=0.8, s=1.05))

    # --- prints: one candidate per Voronoi cell, kept where horses walk
    def prints(scale, keep_fac, half_w, half_l, notch_w, notch_l, spread, seed):
        vin = g.vadd(xy, (seed, seed * 0.7, 0.0))
        cp = g.voronoi(vin, scale=scale, feature='F1', dims='2D', out='Position')
        cc = g.voronoi(vin, scale=scale, feature='F1', dims='2D', out='Color')
        cr, cg, cb = g.sep_rgb(cc)
        lx, ly, _ = g.separate(g.vmath('SUBTRACT', vin, cp))
        # hooves point along the street, either way
        ang = g.add(g.mul(g.sub(cr, 0.5), spread), g.mul(g.math('GREATER_THAN', cb, 0.5), _m.pi))
        ca, sa = g.math('COSINE', ang), g.math('SINE', ang)
        u = g.add(g.mul(ca, lx), g.mul(sa, ly))
        v = g.sub(g.mul(ca, ly), g.mul(sa, lx))
        e = g.add(g.math('POWER', g.math('DIVIDE', u, half_w), 2.0), g.math('POWER', g.math('DIVIDE', v, half_l), 2.0))
        shape = g.sub(1.0, g.smooth(e, 0.7, 1.0))
        if notch_w:
            nt = g.add(g.math('POWER', g.math('DIVIDE', u, notch_w), 2.0),
                       g.math('POWER', g.math('DIVIDE', g.add(v, half_l * 0.8), notch_l), 2.0))
            shape = g.mul(shape, g.smooth(nt, 0.7, 1.3))
        keep = g.math('LESS_THAN', cg, keep_fac)
        age = g.madd(cb, 0.8, 0.2)       # old prints are half filled with dust
        rim = g.mul(g.mul(g.mul(g.smooth(e, 0.85, 1.05), g.sub(1.0, g.smooth(e, 1.05, 1.6))), keep), age)
        return g.mul(g.mul(shape, keep), age), rim

    hoof, hrim = prints(2.6, g.madd(lane, 0.32, 0.02), 0.055, 0.062, 0.026, 0.036, 0.6, 0.0)
    walk = g.mul(g.smooth(g.math('ABSOLUTE', x), 4.8, 6.2), g.sub(1.0, g.smooth(g.math('ABSOLUTE', x), 7.3, 7.6)))
    boot, brim = prints(3.2, g.mul(walk, 0.35), 0.045, 0.13, 0.0, 0.0, 1.2, 3.7)
    pr = g.math('MAXIMUM', hoof, boot)
    rim = g.math('MAXIMUM', hrim, brim)
    col = g.mix(g.mul(rim, 0.2), col, g.rgb(lin(200, 178, 150)))
    col = g.mix(g.mul(pr, 0.2), col, g.hsv(col, v=0.88))

    # pebbles: voronoi cells, a few darker/greyer stones
    vor = g.voronoi(pos, scale=28.0, feature='F1', out='Distance')
    vcol = g.voronoi(pos, scale=28.0, feature='F1', out='Color')
    vr, vg, vb = g.sep_rgb(vcol)
    pebble = g.mul(g.sub(1.0, g.smooth(vor, 0.12, 0.22)), g.smooth(vr, 0.8, 0.82))
    pc = g.mix(vg, g.rgb(lin(124, 108, 94)), g.rgb(lin(192, 176, 158)))
    col = g.mix(g.mul(pebble, 0.9), col, pc)
    # dry crust cracks away from the tracks
    crk = g.voronoi(pos, scale=3.5, feature='DISTANCE_TO_EDGE', out='Distance')
    crack = g.mul(g.sub(1.0, g.smooth(crk, 0.0, 0.012)), g.mul(g.sub(1.0, rut), g.smooth(mid, 0.58, 0.7)))
    col = g.mix(g.mul(crack, 0.2), col, g.hsv(col, v=0.78))
    col = g.mix(g.mul(fine, 0.25), col, g.hsv(col, v=0.85))
    h = g.add(g.add(g.mul(fine, 0.25), g.mul(pebble, 0.6)), g.add(g.mul(crack, -0.3), g.sub(g.mul(rim, 0.15), pr)))
    nrm = g.bump(h, strength=0.55, distance=0.01)
    bsdf = g.principled(col, rough=g.mixf(rut, 0.95, 0.86), normal=nrm, spec=0.3)
    g.output(bsdf)
    m["surface"] = 'dirt'
    lib["ground_dirt"] = m
    return m


def desert_material(lib):
    m, g = new_material("ground_desert")
    pos = g.geo('Position')
    big = g.noise(g.vmul(pos, (1, 1, 0)), scale=0.01, detail=4.0, rough=0.55)
    mid = g.noise(pos, scale=0.2, detail=6.0, rough=0.6)
    fine = g.noise(pos, scale=6.0, detail=4.0)
    col = g.ramp(g.add(g.mul(big, 0.55), g.mul(mid, 0.45)), [
        (0.3, lin(156, 122, 92)), (0.55, lin(180, 148, 112)), (0.75, lin(166, 138, 106))])
    # scrub: sparse dark grey-green dots
    scr = g.voronoi(pos, scale=0.9, feature='F1', out='Distance')
    scrcol = g.voronoi(pos, scale=0.9, feature='F1', out='Color')
    sr, _, _ = g.sep_rgb(scrcol)
    scrub = g.mul(g.sub(1.0, g.smooth(scr, 0.05, 0.18)), g.smooth(sr, 0.4, 0.45))
    col = g.mix(g.mul(scrub, 0.8), col, g.rgb(lin(96, 98, 72)))
    col = g.mix(g.mul(fine, 0.2), col, g.hsv(col, v=0.85))
    nrm = g.bump(g.add(fine, g.mul(scrub, 2.0)), strength=0.3, distance=0.05)
    g.output(g.principled(col, rough=0.95, normal=nrm, spec=0.3))
    m["surface"] = 'dirt'
    lib["ground_desert"] = m
    return m


def build(lib, col):
    dirt_material(lib)
    desert_material(lib)
    street_ground(lib, col, dense=True)
    terrain(lib, col)
