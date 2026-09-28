"""The debris: what a collision of two satellites leaves in an orbit.

    shrapnel.<n>   fist-sized scraps: torn skin, a bent bracket, a crushed
                   tube, a sandwich-panel shard, a carbon splinter, a nut
                   plate with its bolts
    chunk.<n>      suitcase-sized pieces of hull: a dented avionics box in
                   torn blanket, a bent pipe with a flange, a truss node with
                   its tube stubs, a reaction-wheel housing
    slab.<n>       door-sized torn panels: an isogrid skin, a honeycomb
                   panel holed through, a bent radiator panel
    shard.<n>      pieces of a solar wing: cells on one side, bare on the back
    foil.<n>       gold insulation crumpled round a dense core

Every whole sits at the file's origin, its own origin at its centre of mass,
with extras {kind, mass_kg, size_m}. Chunks, slabs and foil cores are pre-fractured: their pieces sit in
a sibling group `<name>.pieces` whose transform is the whole's, so cloning
that group onto a whole's transform reassembles it (see README).

The atlas is baked for the wholes first; the pieces are cut afterwards and
keep the wholes' UVs, so a piece looks exactly like the part of the chunk it
was. Fresh fracture faces map into a small swatch of torn metal in the atlas.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import bl, shapes, fracture
from .bl import rng

DENSITY = {'alu': 2700.0 * 0.35, 'box': 600.0, 'panel': 180.0, 'solar': 60.0, 'core': 3000.0}


def to_object(bm, name, mats, col, uv_scale=1.0, faceted=None):
    """bmesh -> object with slots `mats` (names from materials.LIB), a box-
    projected 'tex' UV in metres and a per-object 'rand'."""
    from . import materials as MT
    me = bpy.data.meshes.new(name)
    uvl = bm.loops.layers.uv.get('tex') or bm.loops.layers.uv.new('tex')
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for l in f.loops:
            l[uvl].uv = (l.vert.co[a] * uv_scale, l.vert.co[b] * uv_scale)
    bm.to_mesh(me)
    for m in mats:
        me.materials.append(MT.LIB[m])
    r = rng(name).random()
    at = me.attributes.new("rand", 'FLOAT', 'FACE')
    at.data.foreach_set("value", [r] * len(me.polygons))
    # crumpled metal is drawn faceted: each facet catches the sun on its
    # own and flashes as the piece tumbles
    if faceted is None:
        faceted = name.split('.')[0] in ('shrapnel', 'slab', 'shard', 'poster')
    if faceted:
        me.shade_flat()
    else:
        me.shade_smooth()
        try:
            me.set_sharp_from_angle(angle=math.radians(38))
        except AttributeError:
            pass
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# Shrapnel

def shrapnel_skin(r):
    out = shapes.torn_outline(0.11, 0.075, r, n=26, jag=0.3)
    bm = shapes.sheet(out, 0.003, 0.014, mats=(0, 1, 2))
    shapes.crumple(bm, 0.012, 14.0, r.uniform(0, 9), along=(0, 0, 1))
    shapes.fold(bm, (0.02, 0, 0), (0.3, 1, 0), (1, -0.3, 0), math.radians(r.uniform(35, 70)))
    shapes.crumple(bm, 0.004, 40.0, r.uniform(0, 9))
    return bm, ['torn_white', 'torn_alu', 'burnt']


def shrapnel_bracket(r):
    bm = bmesh.new()
    for (w, h, M) in ((0.16, 0.05, Matrix.Identity(4)), (0.16, 0.04, Matrix.Rotation(math.radians(90), 4, 'X'))):
        out = [(-w / 2, 0), (w / 2, 0), (w / 2 + r.uniform(-0.01, 0.02), h), (-w / 2, h)]
        b2 = shapes.sheet(out, 0.004, 0.012, mats=(0, 0, 1))
        shapes.transform(b2, M)
        me = bpy.data.meshes.new("__tmp")
        b2.to_mesh(me)
        b2.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    shapes.twist(bm, (0, 0, 0), (1, 0, 0), r.uniform(1.5, 3.5))
    shapes.fold(bm, (0.04, 0, 0), (0, 0.3, 1), (1, 0, 0), math.radians(r.uniform(20, 45)))
    shapes.crumple(bm, 0.003, 30.0, r.uniform(0, 9))
    return bm, ['torn_alu', 'burnt']


def shrapnel_tube(r):
    bm = shapes.cylinder_bm(0.032, 0.2, seg=18, rings=8, caps=False)
    for v in bm.verts:
        z = v.co.z
        # crushed toward one end, ragged rims
        k = max(0.0, (z + 0.02) / 0.12)
        v.co.x *= 1 - 0.55 * min(k, 1)
        v.co.y *= 1 + 0.25 * min(k, 1)
        if abs(abs(z) - 0.1) < 1e-4:
            v.co.z += r.uniform(-0.025, 0.012) * (1 if z > 0 else -1)
    # give the wall thickness
    ret = bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.003)
    shapes.crumple(bm, 0.004, 25.0, r.uniform(0, 9))
    shapes.transform(bm, Matrix.Rotation(math.radians(90), 4, 'Y'))
    for f in bm.faces:
        f.material_index = 0
    return bm, ['torn_alu']


def shrapnel_sandwich(r):
    out = shapes.torn_outline(0.1, 0.06, r, n=20, jag=0.25)
    bm = shapes.sheet(out, 0.018, 0.012, mats=(0, 1, 2))
    shapes.crumple(bm, 0.003, 20.0, r.uniform(0, 9))
    return bm, ['torn_white', 'composite', 'honeycomb']


def shrapnel_splinter(r):
    out = [(-0.13, 0.0), (-0.04, 0.012), (0.05, 0.022), (0.14, 0.004), (0.09, -0.01), (-0.02, -0.018), (-0.1, -0.008)]
    bm = shapes.sheet(out, 0.006, 0.01, mats=(0, 0, 1))
    shapes.twist(bm, (0, 0, 0), (1, 0, 0), r.uniform(1.0, 3.0))
    shapes.crumple(bm, 0.002, 30.0, r.uniform(0, 9))
    return bm, ['composite', 'burnt']


def shrapnel_nutplate(r):
    out = [(-0.05, -0.03), (0.06, -0.035), (0.07, 0.03), (-0.045, 0.035)]
    bm = shapes.sheet(out, 0.006, 0.012, mats=(0, 0, 1))
    shapes.fold(bm, (0.035, 0, 0), (0, 1, 0), (1, 0, 0), math.radians(r.uniform(40, 80)))
    g = bl.Geo("__bolts")
    for (x, y) in ((-0.025, 0.0), (0.005, 0.012)):
        g.cyl(Matrix.Identity(4), (x, y, 0.006), (x, y, 0.012), 0.009, 'steel', seg=6, smooth=False)
        g.cyl(Matrix.Identity(4), (x, y, -0.04), (x, y, 0.006), 0.004, 'steel', seg=8)
    idx = {'torn_alu': 0, 'burnt': 1, 'steel': 2}
    base = len(bm.verts)
    vs = [bm.verts.new(v) for v in g.V]
    bm.verts.ensure_lookup_table()
    for f, m in zip(g.F, g.FM):
        try:
            nf = bm.faces.new([vs[i] for i in f])
            nf.material_index = idx[m]
        except ValueError:
            pass
    return bm, ['torn_alu', 'burnt', 'steel']


SHRAPNEL = [shrapnel_skin, shrapnel_bracket, shrapnel_tube, shrapnel_sandwich, shrapnel_splinter, shrapnel_nutplate]


# ---------------------------------------------------------------------------
# Chunks

def chunk_box(r):
    """An avionics box torn off its bus: dented, a corner caved in, fins on
    one side, a connector, and a gold blanket still wrapped round half of
    it, torn along a ragged line and peeling back."""
    bm = shapes.box_bm((0.55, 0.4, 0.3), (8, 8, 8))
    for _ in range(3):
        c = Vector((r.uniform(-0.27, 0.27), r.uniform(-0.2, 0.2), r.uniform(-0.15, 0.15)))
        shapes.dent(bm, c, r.uniform(0.08, 0.16), r.uniform(0.02, 0.05), -c)
    shapes.dent(bm, (0.27, 0.2, 0.15), 0.16, 0.07, (-1, -1, -1))
    shapes.crumple(bm, 0.006, 8.0, r.uniform(0, 9))
    for f in bm.faces:
        f.material_index = 0
    # the blanket: a crumpled shell a little outside the box, cut off along
    # a noisy plane so it covers one end and peels at the tear
    wrap = shapes.box_bm((0.575, 0.425, 0.325), (10, 10, 10))
    from mathutils import noise as mn
    ph = r.uniform(0, 9)
    kill = [f for f in wrap.faces
            if f.calc_center_median().x + 0.06 * mn.noise(f.calc_center_median() * 9 + Vector((ph, 0, 0))) > 0.03]
    bmesh.ops.delete(wrap, geom=kill, context='FACES')
    shapes.crumple(wrap, 0.012, 14.0, r.uniform(0, 9))
    # peel: the torn edge lifts away from the box
    for v in wrap.verts:
        k = max(0.0, (v.co.x + 0.05) / 0.08)
        v.co += Vector((0.0, v.co.y, v.co.z)).normalized() * (0.03 * min(k, 1.0) ** 2)
    bmesh.ops.solidify(wrap, geom=wrap.faces[:], thickness=0.003)
    for f in wrap.faces:
        f.material_index = 1
    me = bpy.data.meshes.new("__wrap")
    wrap.to_mesh(me)
    wrap.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # heat-sink fins on the -x face, a connector, a torn cable
    g = bl.Geo("__fins")
    for i in range(6):
        y = -0.15 + i * 0.06
        g.box(Matrix.Identity(4), (0.05, 0.006, 0.24), 'alu_bare', center=(-0.3, y, 0.0))
    g.box(Matrix.Identity(4), (0.06, 0.05, 0.03), 'black_paint', center=(0.1, 0.21, 0.08))
    g.cyl(Matrix.Identity(4), (0.1, 0.23, 0.08), (0.1, 0.30, 0.08), 0.012, 'steel', seg=10)
    g.tube(Matrix.Identity(4), [(0.1, 0.30, 0.08), (0.14, 0.36, 0.1), (0.2, 0.38, 0.06), (0.24, 0.43, 0.09)], 0.006, 'black_paint', seg=6)
    _merge_geo(bm, g, {'torn_white': 0, 'mli_gold': 1, 'alu_bare': 2, 'black_paint': 3, 'steel': 4})
    return bm, ['torn_white', 'mli_gold', 'alu_bare', 'black_paint', 'steel']


def chunk_pipe(r):
    bm = shapes.cylinder_bm(0.13, 0.7, seg=24, rings=10, caps=False)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012)
    for v in bm.verts:
        if v.co.z > 0.33:
            v.co.z += r.uniform(-0.06, 0.0)
    shapes.fold(bm, (0, 0, 0.0), (1, 0, 0), (0, 0, 1), math.radians(r.uniform(18, 30)))
    shapes.crumple(bm, 0.008, 6.0, r.uniform(0, 9))
    for f in bm.faces:
        f.material_index = 0
    g = bl.Geo("__flange")
    g.lathe(Matrix.Translation((0, 0, -0.35)), [(0.13, 0.0), (0.2, 0.0), (0.2, 0.03), (0.13, 0.03)], 'alu_bare', seg=24)
    for i in range(8):
        a = 2 * math.pi * i / 8
        g.cyl(Matrix.Identity(4), (math.cos(a) * 0.17, math.sin(a) * 0.17, -0.352), (math.cos(a) * 0.17, math.sin(a) * 0.17, -0.31), 0.01, 'steel', seg=6)
    g.box(Matrix.Identity(4), (0.12, 0.12, 0.12), 'white_paint', center=(0.16, 0, -0.12), bevel=0.01)
    _merge_geo(bm, g, {'white_paint': 0, 'alu_bare': 1, 'steel': 2})
    return bm, ['torn_white', 'alu_bare', 'steel']


def chunk_node(r):
    g = bl.Geo("__node")
    I = Matrix.Identity(4)
    g.box(I, (0.2, 0.2, 0.2), 'white_paint', bevel=0.02)
    for d in ((1, 0, 0), (0, 1, 0.2), (-0.6, -0.4, 0.8)):
        dv = Vector(d).normalized()
        L = r.uniform(0.25, 0.45)
        g.cyl(I, dv * 0.09, dv * L, 0.055, 'white_paint', seg=16)
        g.cyl(I, dv * L, dv * (L + 0.02), 0.057, 'burnt', seg=16, caps=(False, True))
    g.box(I, (0.08, 0.02, 0.12), 'label_yellow', center=(0.0, -0.105, 0.0))
    bm = bmesh.new()
    _merge_geo(bm, g, {'white_paint': 0, 'burnt': 1, 'label_yellow': 2})
    shapes.crumple(bm, 0.006, 7.0, r.uniform(0, 9))
    return bm, ['torn_white', 'burnt', 'label_yellow']


def chunk_wheel(r):
    g = bl.Geo("__wheel")
    I = Matrix.Identity(4)
    g.lathe(I, [(0.0, -0.09), (0.24, -0.09), (0.26, -0.07), (0.26, 0.07), (0.24, 0.09), (0.08, 0.1), (0.0, 0.1)], 'alu_darkext', seg=32)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        g.box(I @ Matrix.Rotation(a, 4, 'Z'), (0.12, 0.05, 0.02), 'alu_bare', center=(0.28, 0, -0.08), bevel=0.005)
    g.box(I, (0.1, 0.06, 0.04), 'black_paint', center=(0.0, 0.2, 0.1), bevel=0.005)
    for k in range(3):
        g.tube(I, [(0.02 * k, 0.22, 0.12), (0.02 * k + 0.05, 0.3, 0.2), (0.02 * k + 0.02, 0.36, 0.22)], 0.006,
               'cable_black' if k else 'cable_orange', seg=6)
    bm = bmesh.new()
    _merge_geo(bm, g, {'alu_darkext': 0, 'alu_bare': 1, 'black_paint': 2, 'cable_black': 3, 'cable_orange': 4})
    shapes.dent(bm, (0.26, 0.0, 0.0), 0.12, 0.05, (-1, 0, 0))
    shapes.crumple(bm, 0.004, 9.0, r.uniform(0, 9))
    return bm, ['alu_darkext', 'alu_bare', 'black_paint', 'cable_black', 'cable_orange']


CHUNKS = [chunk_box, chunk_pipe, chunk_node, chunk_wheel]


# ---------------------------------------------------------------------------
# Slabs

def slab_isogrid(r):
    out = shapes.torn_outline(0.95, 0.52, r, n=34, jag=0.16, spikes=0.3)
    bm = shapes.sheet(out, 0.004, 0.08, mats=(0, 1, 2))
    # the ribs: a triangle grid on the inner face (-z)
    g = bl.Geo("__iso")
    I = Matrix.Identity(4)
    s = 0.16
    for k in range(-8, 9):
        for ang in (0, 60, 120):
            a = math.radians(ang)
            d = Vector((math.cos(a), math.sin(a), 0))
            n = Vector((-d.y, d.x, 0))
            c = n * (k * s * 0.866)
            p0, p1 = c - d * 1.0, c + d * 1.0
            # clip to the plate's rough ellipse
            pts = []
            for t in [i / 40 for i in range(41)]:
                p = p0.lerp(p1, t)
                if (p.x / 0.85) ** 2 + (p.y / 0.45) ** 2 < 1:
                    pts.append(p)
            if len(pts) > 2:
                M = bl.frame(pts[0], (pts[-1] - pts[0]).normalized(), n, Vector((0, 0, 1)))
                L = (pts[-1] - pts[0]).length
                g.box(M, (L, 0.004, 0.03), 'torn_alu', center=(L / 2, 0, -0.015))
    _merge_geo(bm, g, {'white_paint': 0, 'torn_alu': 1, 'burnt': 2})
    # curve it like a cylinder skin, fold a corner, dent
    for v in bm.verts:
        v.co.z -= (v.co.x ** 2) / (2 * 2.6)
    shapes.fold(bm, (0.5, 0.2, 0), (0.6, -1, 0), (1, 0.6, 0), math.radians(r.uniform(30, 55)))
    shapes.crumple(bm, 0.02, 2.5, r.uniform(0, 9), along=(0, 0, 1))
    return bm, ['torn_white', 'torn_alu', 'burnt']


def slab_sandwich(r):
    out = shapes.torn_outline(0.9, 0.55, r, n=30, jag=0.14, spikes=0.25)
    bm = shapes.sheet(out, 0.03, 0.09, mats=(0, 1, 2))
    shapes.tear_hole(bm, (r.uniform(-0.3, 0.3), r.uniform(-0.15, 0.15), 0), 0.18, r)
    # line the hole: bridge its top and bottom rims with honeycomb walls
    rim = [e for e in bm.edges if e.is_boundary]
    if rim:
        res = bmesh.ops.bridge_loops(bm, edges=rim)
        for f in res.get('faces', []):
            f.material_index = 2
    shapes.fold(bm, (-0.55, 0, 0), (0.2, 1, 0), (-1, 0.2, 0), math.radians(r.uniform(-40, -20)))
    shapes.crumple(bm, 0.015, 3.0, r.uniform(0, 9), along=(0, 0, 1))
    return bm, ['torn_white', 'composite', 'honeycomb']


def slab_radiator(r):
    out = shapes.torn_outline(1.0, 0.46, r, n=30, jag=0.12, spikes=0.3)
    bm = shapes.sheet(out, 0.02, 0.09, mats=(0, 1, 2))
    shapes.fold(bm, (0.1, 0, 0), (0, 1, 0), (1, 0, 0), math.radians(r.uniform(12, 22)))
    shapes.crumple(bm, 0.012, 3.5, r.uniform(0, 9), along=(0, 0, 1))
    return bm, ['radiator', 'alu_bare', 'burnt']


SLABS = [slab_isogrid, slab_sandwich, slab_radiator]


# ---------------------------------------------------------------------------
# Solar shards and foil

def shard(r):
    out = shapes.torn_outline(r.uniform(0.5, 0.7), r.uniform(0.35, 0.5), r, n=9, jag=0.25, spikes=0.5)
    bm = shapes.sheet(out, 0.01, 0.11, mats=(0, 1, 2))
    shapes.crumple(bm, 0.02, 1.8, r.uniform(0, 9), along=(0, 0, 1))
    return bm, ['solar_cell', 'solar_back', 'burnt']


def foil_core(r, k):
    g = bl.Geo("__core")
    I = Matrix.Identity(4)
    if k == 0:
        g.box(I, (0.26, 0.2, 0.16), 'alu_darkext', bevel=0.012)
        g.cyl(I, (0.13, 0, 0), (0.2, 0, 0), 0.04, 'steel', seg=12)
    elif k == 1:
        g.cyl(I, (0, 0, -0.15), (0, 0, 0.12), 0.09, 'alu_darkext', seg=20)
        g.cyl(I, (0, 0, 0.12), (0, 0, 0.2), 0.05, 'steel', seg=16, r1=0.08)
    else:
        g.lathe(I, [(0.0, -0.12), (0.12, -0.12), (0.14, 0.0), (0.12, 0.12), (0.0, 0.12)], 'alu_darkext', seg=20)
        g.box(I, (0.08, 0.3, 0.05), 'black_paint', bevel=0.01)
    bm = bmesh.new()
    _merge_geo(bm, g, {'alu_darkext': 0, 'steel': 1, 'black_paint': 2})
    return bm, ['alu_darkext', 'steel', 'black_paint']


def foil_wrap(r, k):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=0.21)
    for v in bm.verts:
        v.co.x *= 1.25 if k == 0 else 1.0
        v.co.z *= 1.3 if k == 1 else 1.0
    shapes.crumple(bm, 0.035, 9.0, r.uniform(0, 9))
    shapes.crumple(bm, 0.012, 24.0, r.uniform(0, 9))
    # torn open on one side, loose flaps
    ph = r.uniform(0, 9)
    from mathutils import noise as mn
    kill = [f for f in bm.faces if f.calc_center_median().x + 0.08 * mn.noise(f.calc_center_median() * 12 + Vector((ph, 0, 0))) > 0.12]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.002)
    for f in bm.faces:
        f.material_index = 0
    return bm, ['mli_gold']


# ---------------------------------------------------------------------------

def _merge_geo(bm, g, idx):
    vs = [bm.verts.new(v) for v in g.V]
    for f, m in zip(g.F, g.FM):
        try:
            nf = bm.faces.new([vs[i] for i in f])
            nf.material_index = idx[m]
        except ValueError:
            pass
    bm.normal_update()


ROWS = {'shrapnel': 0, 'chunk': 1, 'slab': 2, 'shard': 3, 'foil': 4}


def slot(row, i):
    return Vector((i * 2.6, row * 3.2, 0.0))


def slot_of(name):
    parts = name.split('.')
    if len(parts) >= 2 and parts[0] in ROWS and parts[1].isdigit():
        return slot(ROWS[parts[0]], int(parts[1]) - 1)
    return None


def build(col, pieces_col=None):
    """Build every whole at the origin of its own grid slot. Returns
    [(object, kind, fracture_seed_count)]."""
    out = []
    r = rng("debris")
    x = 0.0

    def place(ob, row, i):
        # spread out while baking (so nothing shades anything else); the
        # stage brings every whole back to the origin before export
        ob.matrix_world = Matrix.Translation(slot(row, i))

    for i, fn in enumerate(SHRAPNEL):
        rr = rng(f"shrapnel{i}")
        bm, mats = fn(rr)
        ob = to_object(bm, f"shrapnel.{i + 1}", mats, col)
        bm.free()
        place(ob, 0, i)
        out.append((ob, 'shrapnel', 0))
    for i, fn in enumerate(CHUNKS):
        rr = rng(f"chunk{i}")
        bm, mats = fn(rr)
        ob = to_object(bm, f"chunk.{i + 1}", mats, col)
        bm.free()
        place(ob, 1, i)
        out.append((ob, 'chunk', 3 if i % 2 == 0 else 2))
    for i, fn in enumerate(SLABS):
        rr = rng(f"slab{i}")
        bm, mats = fn(rr)
        ob = to_object(bm, f"slab.{i + 1}", mats, col)
        bm.free()
        place(ob, 2, i)
        out.append((ob, 'slab', 3))
    for i in range(4):
        rr = rng(f"shard{i}")
        bm, mats = shard(rr)
        ob = to_object(bm, f"shard.{i + 1}", mats, col)
        bm.free()
        place(ob, 3, i)
        out.append((ob, 'shard', 0))
    for i in range(3):
        rr = rng(f"foil{i}")
        bm, mats = foil_core(rr, i)
        core = to_object(bm, f"foil.{i + 1}.core", mats, col)
        bm.free()
        bm, mats = foil_wrap(rr, i)
        wrap = to_object(bm, f"foil.{i + 1}.wrap", mats, col)
        bm.free()
        place(core, 4, i)
        place(wrap, 4, i)
        out.append((core, 'foil_core', 2))
        out.append((wrap, 'foil_wrap', 0))
    return out
