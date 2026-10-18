"""The small stuff that makes a street look lived in: stones and pebbles,
tufts of dry grass along the boardwalks and around posts, straw blown out of
the livery, horse droppings. Cheap geometry (a few thousand triangles), but
the low sun gives every pebble a shadow, and that is what sells the dirt.
"""

import math

import bmesh
from mathutils import Vector, noise as mnoise

from .core import MeshBuilder, Frame, rng
from .nodes import new_material
from .materials import lin
from . import buildings as B
from .landscape import ground_z


def group_for(x, y):
    """Atlas group by where a thing sits (ground clutter follows the side)."""
    if y > 50:
        return 'far'
    side = 'left' if x < 0 else 'right'
    if side == 'left':
        return 'left_near' if y < 17 else ('left_mid' if y < 31 else 'left_far')
    return 'right_near' if y < 25 else 'right_far'


def rock(mb, p, size, r, mat='stone_rock', flat=0.6, subdiv=1):
    """An irregular stone: a jittered icosahedron squashed into the dirt."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    ph = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    sx, sy = r.uniform(0.8, 1.3), r.uniform(0.7, 1.2)
    for v in bm.verts:
        n = mnoise.noise(v.co * 1.7 + ph)
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * flat)) * size * (1 + 0.35 * n)
        v.co.z -= size * 0.28          # bedded in the packed dirt
    f = Frame((p.x, p.y, ground_z(p.x, p.y)), r.uniform(0, 6.28))
    mb.add_bmesh(f, bm, mat, rand=r.random())
    bm.free()


def tuft(mb, p, height, r, n=None, lean=None, mat='dry_grass'):
    """Dry bunchgrass: thin tapered blades fanning out from a point."""
    n = n or r.randint(7, 13)
    lean = r.uniform(0, 6.28) if lean is None else lean
    for i in range(n):
        a = r.uniform(0, 6.28)
        tilt = r.uniform(0.15, 0.75)
        h = height * r.uniform(0.55, 1.05)
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        d += Vector((math.cos(lean), math.sin(lean), 0)) * 0.25
        d.normalize()
        w = r.uniform(0.006, 0.012)
        side = Vector((-math.sin(a), math.cos(a), 0)) * w
        base = p + Vector((r.uniform(-0.03, 0.03), r.uniform(-0.03, 0.03), 0))
        base.z = ground_z(base.x, base.y) - 0.01
        mid = base + d * h * 0.55 + Vector((0, 0, -0.02))
        tip = base + d * h + Vector((math.cos(lean), math.sin(lean), -0.4)) * h * 0.15
        rr = r.random()
        mb.add_face([base - side, base + side, mid + side * 0.7, mid - side * 0.7], mat, rr,
                    grain=[(0, 0), (0, 1), (0.55, 1), (0.55, 0)], local=[(0, 0), (0, 1), (0.55, 1), (0.55, 0)])
        mb.add_face([mid - side * 0.7, mid + side * 0.7, tip], mat, rr, grain=[(0.55, 0), (0.55, 1), (1, 0.5)],
                    local=[(0.55, 0), (0.55, 1), (1, 0.5)])


def straw(mb, p, r, count=30, spread=1.2):
    for i in range(count):
        a = r.uniform(0, 6.28)
        rad = spread * math.sqrt(r.random())
        c = p + Vector((math.cos(a) * rad, math.sin(a) * rad, 0.0))
        c.z = ground_z(c.x, c.y) + 0.006
        b = r.uniform(0, 6.28)
        L = r.uniform(0.08, 0.22)
        d = Vector((math.cos(b), math.sin(b), 0)) * L / 2
        s = Vector((-math.sin(b), math.cos(b), 0)) * 0.004
        mb.add_face([c - d - s, c + d - s, c + d + s, c - d + s], 'hay', r.random())


def materials(lib):
    m, g = new_material("dry_grass")
    uv = g.uv('local')
    u, v, _ = g.separate(uv)
    r = g.attr('rand')
    base = g.mix(r, g.rgb(lin(150, 128, 84)), g.rgb(lin(196, 172, 118)))
    base = g.mix(g.mul(g.sub(1.0, u), 0.6), base, g.rgb(lin(96, 86, 58)))       # darker at the root
    base = g.mix(g.smooth(r, 0.85, 0.9), base, g.rgb(lin(120, 118, 80)))        # a few greyer stems
    g.output(g.principled(base, rough=0.8, sheen=0.4, subsurface=None))
    m["surface"] = 'dirt'
    lib["dry_grass"] = m
    m, g = new_material("stone_rock")
    pos = g.geo('Position')
    n = g.noise(pos, scale=18.0, detail=8.0, rough=0.65)
    r = g.attr('rand')
    col = g.mix(r, g.rgb(lin(92, 80, 70)), g.rgb(lin(138, 120, 102)))
    col = g.mix(g.smooth(r, 0.7, 0.75), col, g.rgb(lin(128, 80, 58)))            # reddish sandstone ones
    col = g.mix(g.mul(n, 0.5), col, g.hsv(col, v=0.7))
    top = g.smooth(g.separate(g.geo('Normal'))[2], 0.5, 0.95)
    col = g.mix(g.mul(top, 0.3), col, g.rgb(lin(160, 134, 106)))                 # dust on top
    g.output(g.principled(col, rough=0.9, normal=g.bump(n, strength=0.4, distance=0.01)))
    m["surface"] = 'stone'
    lib["stone_rock"] = m
    # a weathered sandstone boulder: darker, rounded, lichen-dull
    m, g = new_material("stone_boulder")
    pos = g.geo('Position')
    n = g.noise(pos, scale=6.0, detail=10.0, rough=0.65)
    n2 = g.noise(pos, scale=1.5, detail=4.0)
    col = g.ramp(g.add(g.mul(n, 0.5), g.mul(n2, 0.5)), [(0.3, lin(96, 70, 54)), (0.55, lin(132, 100, 76)),
                                                       (0.75, lin(150, 120, 94))])
    top = g.smooth(g.separate(g.geo('Normal'))[2], 0.7, 0.98)
    col = g.mix(g.mul(top, 0.18), col, g.rgb(lin(150, 128, 104)))
    g.output(g.principled(col, rough=0.93, normal=g.bump(n, strength=0.6, distance=0.02)))
    m["surface"] = 'stone'
    lib["stone_boulder"] = m
    m, g = new_material("dung")
    pos = g.geo('Position')
    n = g.noise(pos, scale=40.0, detail=6.0)
    col = g.mix(n, g.rgb(lin(62, 48, 34)), g.rgb(lin(98, 78, 52)))
    g.output(g.principled(col, rough=0.9, normal=g.bump(n, strength=0.5, distance=0.005)))
    m["surface"] = 'dirt'
    lib["dung"] = m


def build(lib, col):
    if "dry_grass" not in lib:
        materials(lib)
    r = rng("clutter")
    builders = {}

    def G(x, y):
        k = group_for(x, y)
        if k not in builders:
            builders[k] = MeshBuilder(f"clutter.{k}")
        return builders[k]

    edge = B.STREET_HALF - B.WALK_DEPTH
    # pebbles: dense near the player, thinning out; more toward the edges
    for i in range(340):
        y = 2.5 + (r.random() ** 1.6) * 45.0
        x = r.gauss(0, 3.8)
        if abs(x) > edge - 0.1:
            continue
        s = r.uniform(0.018, 0.05) * (1.0 + 0.6 * (abs(x) / edge))
        rock(G(x, y), Vector((x, y, 0.0)), s, r)
    # bigger stones at the street edges and in the alleys
    for i in range(70):
        side = r.choice((-1, 1))
        x = side * r.uniform(edge - 1.4, edge - 0.05)
        y = r.uniform(3.0, 52.0)
        rock(G(x, y), Vector((x, y, 0.0)), r.uniform(0.06, 0.16), r)
    # dry grass along the boardwalk edges, thicker at the posts and in gaps
    for i in range(170):
        side = r.choice((-1, 1))
        x = side * (edge - r.uniform(-0.05, 0.9) * (1 if r.random() < 0.8 else 3))
        y = r.uniform(4.0, 56.0)
        p = Vector((x, y, 0.0))
        tuft(G(x, y), p, r.uniform(0.12, 0.38), r)
        if r.random() < 0.4:
            tuft(G(x, y), p + Vector((r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2), 0)), r.uniform(0.1, 0.25), r)
    # alley mouths collect grass and tumbleweed debris
    for (xa, ya) in ((-10.6, 16.9), (-10.6, 31.7), (-10.6, 39.2), (10.6, 16.1), (10.6, 25.1), (10.6, 39.0)):
        for i in range(10):
            p = Vector((xa + r.uniform(-1.2, 1.4) * (1 if xa < 0 else -1), ya + r.uniform(-0.6, 0.6), 0.0))
            tuft(G(p.x, p.y), p, r.uniform(0.18, 0.5), r)
    # straw blown out of the livery doors, droppings along the lanes
    straw(G(-9.0, 47.0), Vector((-9.2, 47.0, 0.0)), r, count=160, spread=2.2)
    straw(G(-7.0, 44.0), Vector((-7.0, 44.5, 0.0)), r, count=60, spread=3.0)
    for i in range(14):
        y = r.uniform(8.0, 50.0)
        x = r.gauss(-1.0, 2.0)
        p = Vector((x, y, 0.0))
        mb = G(x, y)
        for k in range(r.randint(3, 6)):
            q = p + Vector((r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), 0))
            rock(mb, q, r.uniform(0.025, 0.04), r, mat='dung', flat=0.7)
    objs = []
    for k, mb in builders.items():
        objs.append(mb.build(col, lib, surface='dirt', group=k))
    return objs
