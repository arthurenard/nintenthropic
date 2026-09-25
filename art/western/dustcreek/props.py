"""Street furniture and props: barrels, crates, troughs, hitching rails, lamp
posts, benches, the broken wagon, coffins, hay, the horse at the livery, the
saloon piano, the barber's pole...

Each prop draws into a MeshBuilder so a group's props become a few objects.
Props that the game must address on their own (the piano) are built into a
dedicated builder and emitted with their contract name.
"""

import math

import bpy
import bmesh
from mathutils import Vector, Matrix

from .core import Frame, MeshBuilder, rng, tag, smooth
from . import buildings as B

WALK_EDGE = B.STREET_HALF - B.WALK_DEPTH   # 7.4: street edge of the boardwalks
WAGON = ((-2.0, 21.5, 0.0), 20.0)           # broken wagon: centre, heading (deg)
DECK = B.DECK_Z


# ---------------------------------------------------------------------------
# Primitive props (draw into builders)

def barrel(mb, metal, f, r, h=0.88, rad=0.29, lid=True):
    """A stave barrel with four iron hoops. Frame origin at the barrel's base."""
    prof = [(0.0, 0.86), (0.12, 0.94), (0.3, 0.99), (0.5, 1.0), (0.7, 0.99), (0.88, 0.94), (1.0, 0.86)]
    seg = 18
    rings = []
    for t, s in prof:
        rings.append([(math.cos(2 * math.pi * i / seg) * rad * s, math.sin(2 * math.pi * i / seg) * rad * s, t * h)
                      for i in range(seg)])
    for i in range(seg):
        j = (i + 1) % seg
        rr = r.random()
        for k in range(len(prof) - 1):
            pts = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            t0, t1 = prof[k][0] * h, prof[k + 1][0] * h
            a0, a1 = i / seg * 2 * math.pi * rad, (i + 1) / seg * 2 * math.pi * rad
            mb.add_face([f.p(*p) for p in pts], 'wood_barrel', rr, grain=[(t0, a0), (t0, a1), (t1, a1), (t1, a0)],
                        local=[(t0, 0), (t0, 1), (t1, 1), (t1, 0)])
    # lid (slightly inset)
    inset = 0.025
    top = [(x * 0.97, y * 0.97, h - inset) for (x, y, _) in rings[-1]]
    mb.add_face([f.p(*p) for p in top], 'wood_barrel', r.random(), grain=[(p[0], p[1]) for p in top],
                local=[(p[0], 0.5) for p in top])
    for i in range(seg):
        j = (i + 1) % seg
        a, b = rings[-1][i], rings[-1][j]
        c, d = top[j], top[i]
        mb.add_face([f.p(*a), f.p(*b), f.p(*c), f.p(*d)], 'wood_barrel', 0.3)
    # hoops
    for t in (0.07, 0.3, 0.7, 0.93):
        s = 1.0 - 0.14 * abs(t - 0.5) ** 1.6 * 2
        s = 0.86 + (1.0 - 0.86) * (1 - abs(t - 0.5) * 2) ** 0.5 if True else s
        metal.cylinder(f, (0, 0, t * h - 0.025), rad * s + 0.006, 0.05, 'iron_rusty', segments=seg,
                       caps=(False, False))


def crate(mb, f, r, sx=0.7, sy=0.55, sz=0.55, mat='wood_crate', slats=3):
    """A slatted crate: boards on every face with gaps, corner battens."""
    g = 0.012
    t = 0.022
    # side boards (horizontal) on +-x and +-y faces
    for (axis, sign) in ((0, -1), (0, 1), (1, -1), (1, 1)):
        L = sy if axis == 0 else sx
        for k in range(slats):
            z0 = k * sz / slats + g / 2
            z1 = (k + 1) * sz / slats - g / 2
            if axis == 0:
                x0 = -sx / 2 if sign < 0 else sx / 2 - t
                mb.box(f, (x0, -sy / 2, z0), (x0 + t, sy / 2, z1), mat, rand=r.random(), grain_axis=1)
            else:
                y0 = -sy / 2 if sign < 0 else sy / 2 - t
                mb.box(f, (-sx / 2, y0, z0), (sx / 2, y0 + t, z1), mat, rand=r.random(), grain_axis=0)
    # top boards
    n = max(2, int(sx / 0.15))
    for k in range(n):
        x0 = -sx / 2 + k * sx / n + g / 2
        mb.box(f, (x0, -sy / 2, sz - t), (x0 + sx / n - g, sy / 2, sz), mat, rand=r.random(), grain_axis=1)
    # corner battens
    for cx in (-1, 1):
        for cy in (-1, 1):
            x = cx * (sx / 2 + 0.005)
            y = cy * (sy / 2 + 0.005)
            mb.box(f, (min(x, x - cx * 0.06), min(y, y - cy * 0.06), 0.0),
                   (max(x, x - cx * 0.06), max(y, y - cy * 0.06), sz + 0.005), mat, rand=r.random(), grain_axis=2)
    # dark inside so the gaps read
    mb.box(f, (-sx / 2 + t, -sy / 2 + t, 0.01), (sx / 2 - t, sy / 2 - t, sz - t), 'backing', rand=0.1)


def sack(mb, f, r, rad=0.26, h=0.45):
    """A grain sack: a lumpy squashed sphere."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=rad)
    for v in bm.verts:
        z = v.co.z
        v.co.z = (z + rad) / (2 * rad) * h
        sq = 1.0 + 0.25 * (1 - v.co.z / h) - 0.15 * (v.co.z / h) ** 2
        v.co.x *= sq * (1 + r.uniform(-0.05, 0.05))
        v.co.y *= sq * 0.85 * (1 + r.uniform(-0.05, 0.05))
        if v.co.z > h * 0.85:
            v.co.x *= 0.5
            v.co.y *= 0.5
    mb.add_bmesh(f, bm, 'canvas', rand=r.random())
    bm.free()


def hitching_rail(mb, f, r, length=3.0, h=0.95):
    for s in (0.0, length):
        mb.box(f, (s - 0.07, -0.07, -0.1), (s + 0.07, 0.07, h + 0.05), 'wood_post', rand=r.random(), grain_axis=2)
    mb.cylinder(f.sub((0, 0, h - 0.02)).sub(rot_y=math.pi / 2), (0, 0, -0.15), 0.055, length + 0.3, 'wood_grey',
                segments=8, caps=(True, True))


def trough(mb, f, r, L=2.0, W=0.6, H=0.62, water=True):
    t = 0.05
    for (a, b) in (((-L / 2, -W / 2), (L / 2, -W / 2 + t)), ((-L / 2, W / 2 - t), (L / 2, W / 2))):
        n = 3
        for k in range(n):
            z0 = 0.08 + k * (H - 0.08) / n
            mb.box(f, (a[0], a[1], z0 + 0.004), (b[0], b[1], z0 + (H - 0.08) / n - 0.004), 'wood_raw',
                   rand=r.random(), grain_axis=0)
    for s in (-L / 2, L / 2 - t):
        mb.box(f, (s, -W / 2 + t, 0.08), (s + t, W / 2 - t, H), 'wood_raw', rand=r.random(), grain_axis=1)
    mb.box(f, (-L / 2 + t, -W / 2 + t, 0.08), (L / 2 - t, W / 2 - t, 0.13), 'wood_dark', rand=r.random())
    for s in (-L / 2 + 0.15, L / 2 - 0.25):
        mb.box(f, (s, -W / 2 - 0.04, 0.0), (s + 0.1, W / 2 + 0.04, 0.1), 'wood_dark', rand=r.random(), grain_axis=1)
    # iron straps
    for s in (-L / 4, L / 4):
        mb.box(f, (s - 0.025, -W / 2 - 0.006, 0.08), (s + 0.025, W / 2 + 0.006, H + 0.004), 'iron_rusty',
               rand=r.random(), grain_axis=2)
    if water:
        mb.quad(f, [(-L / 2 + t, -W / 2 + t, H - 0.09), (L / 2 - t, -W / 2 + t, H - 0.09),
                    (L / 2 - t, W / 2 - t, H - 0.09), (-L / 2 + t, W / 2 - t, H - 0.09)], 'water')


def bench(mb, f, r, L=1.8):
    mb.box(f, (-L / 2, -0.2, 0.42), (L / 2, 0.2, 0.46), 'wood_grey', rand=r.random(), grain_axis=0)
    for s in (-L / 2 + 0.12, L / 2 - 0.16):
        mb.box(f, (s, -0.17, 0.0), (s + 0.04, 0.17, 0.42), 'wood_grey', rand=r.random(), grain_axis=1)
    mb.box(f, (-L / 2 + 0.1, -0.02, 0.15), (L / 2 - 0.1, 0.02, 0.22), 'wood_grey', rand=r.random(), grain_axis=0)
    # back rest
    mb.box(f, (-L / 2, 0.16, 0.46), (L / 2, 0.2, 0.9), 'wood_grey', rand=r.random(), grain_axis=0, skip=())


def chair(mb, f, r, mat='wood_dark'):
    for (x, y) in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        mb.box(f, (x - 0.02, y - 0.02, 0), (x + 0.02, y + 0.02, 0.45 if y < 0 else 0.95), mat, rand=r.random(),
               grain_axis=2)
    mb.box(f, (-0.23, -0.23, 0.43), (0.23, 0.23, 0.47), mat, rand=r.random())
    for z in (0.65, 0.85):
        mb.box(f, (-0.22, 0.18, z), (0.22, 0.22, z + 0.06), mat, rand=r.random(), grain_axis=0)


def lamp_post(mb, metal, f, r, h=3.3):
    """A street lamp: square post, iron arm, square lantern with glass
    (glass as plain dusty material here; the game does not break these)."""
    mb.box(f, (-0.075, -0.075, 0.0), (0.075, 0.075, h), 'wood_post', rand=r.random(), grain_axis=2)
    mb.box(f, (-0.1, -0.1, h), (0.1, 0.1, h + 0.05), 'wood_post', rand=r.random())
    lz = h + 0.05
    metal.box(f, (-0.13, -0.13, lz), (0.13, 0.13, lz + 0.03), 'iron_black')
    for (x, y) in ((-0.12, -0.12), (0.12, -0.12), (-0.12, 0.12), (0.12, 0.12)):
        metal.box(f, (x - 0.012, y - 0.012, lz), (x + 0.012, y + 0.012, lz + 0.42), 'iron_black')
    for (a, b) in (((-0.11, -0.115), (0.11, -0.11)), ((-0.11, 0.11), (0.11, 0.115)),
                   ((-0.115, -0.11), (-0.11, 0.11)), ((0.11, -0.11), (0.115, 0.11))):
        metal.box(f, (a[0], a[1], lz + 0.03), (b[0], b[1], lz + 0.4), 'bottle_green')
    metal.cylinder(f, (0, 0, lz + 0.42), 0.19, 0.14, 'iron_black', segments=4, radius_top=0.03)
    metal.cylinder(f, (0, 0, lz + 0.56), 0.03, 0.06, 'iron_black', segments=6)
    metal.cylinder(f, (0, 0, lz + 0.03), 0.035, 0.12, 'brass', segments=8)


def wheel(mb, metal, f, r, radius=0.6, width=0.07, spokes=12, broken=0):
    """A wagon wheel in its frame's XZ plane (axle along Y)."""
    rim_in = radius - 0.07
    seg = 24
    wf = f.sub(rot_x=math.pi / 2)  # cylinder axis Z -> frame Y
    # felloe: ring of boxes
    for i in range(seg):
        if broken and i < broken:
            continue
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        p = [(math.cos(a0) * rim_in, math.sin(a0) * rim_in), (math.cos(a1) * rim_in, math.sin(a1) * rim_in),
             (math.cos(a1) * radius, math.sin(a1) * radius), (math.cos(a0) * radius, math.sin(a0) * radius)]
        rr = r.random()
        for (y0, y1, face_pts) in ((-width / 2, -width / 2, p), (width / 2, width / 2, list(reversed(p)))):
            mb.add_face([f.p(x, y0, z) for (x, z) in face_pts], 'wood_dark', rr)
        # outer tyre (iron)
        metal.add_face([f.p(p[3][0], -width / 2, p[3][1]), f.p(p[2][0], -width / 2, p[2][1]),
                        f.p(p[2][0], width / 2, p[2][1]), f.p(p[3][0], width / 2, p[3][1])], 'iron', rr)
        mb.add_face([f.p(p[0][0], width / 2, p[0][1]), f.p(p[1][0], width / 2, p[1][1]),
                     f.p(p[1][0], -width / 2, p[1][1]), f.p(p[0][0], -width / 2, p[0][1])], 'wood_dark', rr)
    # hub
    mb.cylinder(wf, (0, 0, -0.12), 0.1, 0.24, 'wood_dark', segments=12)
    metal.cylinder(wf, (0, 0, -0.125), 0.105, 0.03, 'iron', segments=12, caps=(False, False))
    metal.cylinder(wf, (0, 0, 0.095), 0.105, 0.03, 'iron', segments=12, caps=(False, False))
    for i in range(spokes):
        if broken and i < broken // 2:
            continue
        a = 2 * math.pi * (i + 0.5) / spokes
        d = Vector((math.cos(a), 0, math.sin(a)))
        mb.board(f, d * 0.09, d * (rim_in + 0.01), 0.045, 0.03, 'wood_dark', up=(0, 1, 0))


def wagon(mb, metal, f, r):
    """The broken freight wagon: bed on its axles, front-left wheel off and
    lying in the dirt, the bed dropped onto its front corner."""
    L, W, H = 3.4, 1.25, 0.55
    # frame (tilted: front-left corner on the ground)
    bed = f.sub((0, 0, 0.0))
    tilt_f = bed.sub((0, 0, 0.93)).sub(rot_y=math.radians(6.0), rot_x=math.radians(-7.5))
    # floor boards
    n = 8
    for k in range(n):
        y0 = -W / 2 + k * W / n
        mb.box(tilt_f, (-L / 2, y0 + 0.004, 0.0), (L / 2, y0 + W / n - 0.004, 0.035), 'wood_raw',
               rand=r.random(), grain_axis=0)
    # sides: three boards each, one broken off on the near side
    for side in (-1, 1):
        for k in range(3):
            if side < 0 and k == 2:
                continue
            z0 = 0.035 + k * 0.18
            y0 = side * W / 2 - (0.03 if side > 0 else 0.0)
            mb.box(tilt_f, (-L / 2, y0, z0), (L / 2, y0 + 0.03, z0 + 0.17), 'paint_green' if k < 2 else 'wood_raw',
                   rand=r.random(), grain_axis=0)
    for end in (-1, 1):
        for k in range(3):
            z0 = 0.035 + k * 0.18
            x0 = end * L / 2 - (0.03 if end > 0 else 0.0)
            mb.box(tilt_f, (x0, -W / 2, z0), (x0 + 0.03, W / 2, z0 + 0.17), 'paint_green', rand=r.random(),
                   grain_axis=1)
    # stakes
    for s in (-L / 2 + 0.3, 0.0, L / 2 - 0.3):
        for side in (-1, 1):
            mb.box(tilt_f, (s - 0.03, side * (W / 2 + 0.02) - 0.02, 0.0), (s + 0.03, side * (W / 2 + 0.02) + 0.02,
                   0.42), 'wood_dark', rand=r.random(), grain_axis=2)
    # sills under the bed
    for side in (-1, 1):
        mb.box(tilt_f, (-L / 2, side * 0.4 - 0.05, -0.12), (L / 2, side * 0.4 + 0.05, 0.0), 'wood_dark',
               rand=r.random(), grain_axis=0)
    # rear axle + wheels (standing)
    rear = f.sub((L / 2 - 0.55, 0, 0))
    metal.box(rear, (-0.05, -W / 2 - 0.25, 0.62), (0.05, W / 2 + 0.25, 0.72), 'iron')
    for side in (-1, 1):
        wheel(mb, metal, rear.sub((0, side * (W / 2 + 0.2), 0.67)), r, radius=0.67)
    # front right wheel still on, front left wheel lying flat in the dirt
    front = f.sub((-L / 2 + 0.55, 0, 0))
    wheel(mb, metal, front.sub((0, W / 2 + 0.2, 0.52)), r, radius=0.52)
    wheel(mb, metal, f.sub((-L / 2 - 0.4, -W / 2 - 0.9, 0.05)).sub(rot_x=math.pi / 2, rot_z=0.4), r,
          radius=0.52, broken=5)
    # the tongue, dropped
    mb.board(f, (-L / 2 - 0.1, 0.0, 0.35), (-L / 2 - 2.3, 0.25, 0.05), 0.09, 0.08, 'wood_dark', up=(0, 0, 1))
    # spilled cargo: crates slid under the dropped bed, sacks, a crate that
    # rolled clear toward the street
    crate(mb, f.sub((0.45, 0.15, 0.0), rot_z=0.12), r, sx=0.95, sy=0.75, sz=0.72)
    crate(mb, f.sub((-0.55, 0.25, 0.0), rot_z=-0.2), r, sx=0.8, sy=0.7, sz=0.66)
    sack(mb, f.sub((1.3, 0.1, 0.0), rot_z=0.4), r)
    sack(mb, f.sub((1.05, 0.45, 0.0), rot_z=1.9), r)
    crate(mb, f.sub((0.2, -W / 2 - 0.9, 0.0), rot_z=0.3), r, sx=0.6, sy=0.45, sz=0.45)
    sack(mb, f.sub((-0.6, -W / 2 - 0.65, 0.0), rot_z=1.0), r)
    return tilt_f


def coffin(mb, f, r, L=1.9, lid=True, open_=False):
    """Six-sided pine coffin standing on its foot end (frame origin at the
    bottom centre, standing along +Z, face toward -Y)."""
    w_sh, w_head, w_foot = 0.56, 0.42, 0.3
    d = 0.32
    prof = [(-w_foot / 2, 0.0), (w_foot / 2, 0.0), (w_sh / 2, L * 0.72), (w_head / 2, L), (-w_head / 2, L),
            (-w_sh / 2, L * 0.72)]
    rr = r.random()
    # back and front (lid) faces
    for (y, rev) in ((d, False), (0.0, True)):
        pts = [(x, y, z) for (x, z) in prof]
        if rev:
            pts = list(reversed(pts))
        mb.add_face([f.p(*p) for p in pts], 'wood_new' if not open_ or y > 0 else 'wood_new', rr,
                    grain=[(p[2], p[0]) for p in pts], local=[(p[2], 0.5) for p in pts])
    for i in range(6):
        a, b = prof[i], prof[(i + 1) % 6]
        mb.add_face([f.p(a[0], 0, a[1]), f.p(b[0], 0, b[1]), f.p(b[0], d, b[1]), f.p(a[0], d, a[1])], 'wood_new', rr,
                    grain=[(a[1], 0), (b[1], 0), (b[1], d), (a[1], d)])
    if lid:
        # the lid stands proud with a bevelled edge
        lp = [(x * 0.92, z * 0.98 + 0.02) for (x, z) in prof]
        pts = [(x, -0.03, z) for (x, z) in lp][::-1]
        mb.add_face([f.p(*p) for p in pts], 'wood_new', r.random(), grain=[(p[2], p[0]) for p in pts])
        for i in range(6):
            a, b = lp[i], lp[(i + 1) % 6]
            mb.add_face([f.p(a[0], -0.03, a[1]), f.p(b[0], -0.03, b[1]), f.p(b[0], 0.0, b[1]), f.p(a[0], 0.0, a[1])],
                        'wood_new', rr)


def hay_bale(mb, f, r, L=0.95, W=0.48, H=0.38):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= L
        v.co.y *= W
        v.co.z = (v.co.z + 0.5) * H
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.05, segments=2, affect='EDGES')
    for v in bm.verts:
        v.co += Vector((r.uniform(-0.01, 0.01), r.uniform(-0.01, 0.01), r.uniform(-0.01, 0.01)))
    mb.add_bmesh(f, bm, 'hay', rand=r.random())
    bm.free()
    for x in (-L * 0.25, L * 0.25):
        mb.box(f, (x - 0.008, -W / 2 - 0.004, H - 0.002), (x + 0.008, W / 2 + 0.004, H + 0.004), 'rope')


def hay_pile(mb, f, r, rad=1.0, h=0.7):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=1.0)
    for v in bm.verts:
        z = max(v.co.z, -0.1)
        n = 1 + 0.12 * math.sin(v.co.x * 7 + v.co.y * 5) + r.uniform(-0.06, 0.06)
        v.co = Vector((v.co.x * rad * n, v.co.y * rad * n * 0.8, (z + 0.1) / 1.1 * h * n))
    mb.add_bmesh(f, bm, 'hay', rand=r.random())
    bm.free()


def barber_pole(mb, metal, f, r, h=1.5):
    """Wall-mounted barber's pole: brass caps, the striped cylinder (its
    material draws the helix), a milk-glass globe on top."""
    metal.cylinder(f, (0, 0, 0.0), 0.075, 0.08, 'brass', segments=16)
    mb.cylinder(f, (0, 0, 0.08), 0.06, h - 0.2, 'barber_stripes', segments=20, caps=(False, False))
    metal.cylinder(f, (0, 0, h - 0.12), 0.075, 0.07, 'brass', segments=16)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.09)
    for v in bm.verts:
        v.co.z += h + 0.03
    metal.add_bmesh(f, bm, 'milk_glass')
    bm.free()


def horse_head(col, lib, f, name="prop.horse", group='left_far'):
    """A horse looking out over a stall's half door. Built as a skin-modifier
    armature of the skull, neck and muzzle, subdivided, then applied."""
    bm = bmesh.new()
    # spine of the head: from inside the stall (neck) out to the muzzle
    pts = [(0.0, 0.55, -0.35, 0.2), (0.0, 0.35, -0.12, 0.2), (0.0, 0.12, 0.08, 0.17),
           (0.0, -0.05, 0.14, 0.13), (0.0, -0.22, 0.06, 0.11), (0.0, -0.38, -0.06, 0.1),
           (0.0, -0.5, -0.16, 0.095), (0.0, -0.57, -0.22, 0.09)]
    vs = [bm.verts.new((x, y, z)) for (x, y, z, _) in pts]
    for a, b in zip(vs[:-1], vs[1:]):
        bm.edges.new((a, b))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    sk = ob.modifiers.new("skin", 'SKIN')
    for i, (_, _, _, rad) in enumerate(pts):
        sv = me.skin_vertices[0].data[i]
        # heads are taller than they are wide
        sv.radius = (rad * 0.75, rad * 1.15)
    me.skin_vertices[0].data[0].use_root = True
    ob.modifiers.new("sub", 'SUBSURF').levels = 2
    ob.matrix_world = f.m
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me2
    bpy.data.meshes.remove(me)
    me2.materials.append(lib['horse'])
    # ears, eyes, mane strands, halter: small extra meshes joined in
    extra = MeshBuilder(name + ".x")
    lf = Frame(matrix=f.m)
    for sx in (-1, 1):
        extra.cylinder(lf.sub((sx * 0.07, 0.1, 0.24), rot_y=sx * 0.25, rot_x=-0.3), (0, 0, 0), 0.04, 0.16, 'horse',
                       segments=6, radius_top=0.005)
        # eyes, set on the sides of the skull
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.025)
        extra.add_bmesh(lf.sub((sx * 0.1, -0.1, 0.1)), bm, 'piano_black')
        bm.free()
        # halter straps
        extra.board(lf, (sx * 0.1, -0.3, 0.04), (sx * 0.11, -0.28, -0.12), 0.03, 0.01, 'leather', up=(0, 1, 0))
    extra.board(lf, (-0.11, -0.3, 0.02), (0.11, -0.3, 0.02), 0.03, 0.01, 'leather', up=(0, 0, 1))
    for k in range(7):
        y = 0.12 + k * 0.07
        extra.board(lf, (0.0, y, 0.17 - k * 0.04), (0.0, y + 0.06, -0.05 - k * 0.04), 0.05, 0.03, 'paint_black',
                    up=(1, 0, 0))
    xo = extra.build(col, lib)
    ob.select_set(True)
    xo.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    smooth(ob, 60)
    tag(ob, surface='cloth', group=group)
    return ob


def piano(col, lib, f, name="secret.piano", group='left_mid'):
    """Upright piano, built around its own origin (floor, centre of the
    keyboard edge) so the game can find and shake it."""
    mb = MeshBuilder(name)
    r = rng("piano")
    lf = Frame()
    W, D, H = 1.5, 0.6, 1.3
    mb.box(lf, (-W / 2, 0.0, 0.0), (W / 2, D, 0.12), 'piano_wood', rand=0.1, grain_axis=0)
    mb.box(lf, (-W / 2, 0.25, 0.12), (W / 2, D, H), 'piano_wood', rand=0.2, grain_axis=0)
    mb.box(lf, (-W / 2 - 0.02, 0.2, H), (W / 2 + 0.02, D + 0.02, H + 0.04), 'piano_wood', rand=0.3, grain_axis=0)
    for s in (-W / 2, W / 2 - 0.06):
        mb.box(lf, (s, -0.05, 0.12), (s + 0.06, 0.25, 0.78), 'piano_wood', rand=0.4, grain_axis=1)
        mb.box(lf, (s, -0.05, 0.0), (s + 0.06, 0.02, 0.12), 'piano_wood', rand=0.45)
    mb.box(lf, (-W / 2 + 0.06, 0.0, 0.66), (W / 2 - 0.06, 0.25, 0.72), 'piano_wood', rand=0.5, grain_axis=0)
    # keys
    kw = (W - 0.16) / 52
    for k in range(52):
        x = -W / 2 + 0.08 + k * kw
        mb.box(lf, (x + 0.001, 0.02, 0.72), (x + kw - 0.001, 0.17, 0.745), 'piano_keys', rand=r.random(), grain_axis=1)
        if k % 7 not in (2, 6):
            mb.box(lf, (x + kw * 0.65, 0.09, 0.745), (x + kw * 1.35, 0.17, 0.765), 'piano_black', rand=0.2)
    mb.box(lf, (-W / 2 + 0.06, 0.17, 0.72), (W / 2 - 0.06, 0.26, 0.82), 'piano_wood', rand=0.6, grain_axis=0)
    # music rest and a sheet of music
    mb.box(lf, (-0.35, 0.22, 0.86), (0.35, 0.25, 1.1), 'piano_wood', rand=0.7, grain_axis=0)
    mb.quad(lf, [(-0.22, 0.215, 0.88), (0.0, 0.215, 0.88), (0.0, 0.215, 1.12), (-0.22, 0.215, 1.12)], 'paper_plain')
    mb.quad(lf, [(0.0, 0.215, 0.88), (0.22, 0.215, 0.88), (0.22, 0.215, 1.12), (0.0, 0.215, 1.12)], 'paper_plain')
    # a whiskey bottle and a glass on top
    mb.cylinder(lf, (0.45, 0.4, H + 0.04), 0.04, 0.22, 'bottle_green', segments=8,
                profile=[(0, 1), (0.6, 1), (0.75, 0.4), (1, 0.35)])
    mb.cylinder(lf, (0.3, 0.45, H + 0.04), 0.03, 0.07, 'bottle_green', segments=8)
    ob = mb.build(col, lib, surface='wood', group=group)
    ob.matrix_world = f.m
    # set the origin: mesh was built in local frame, so the object transform
    # *is* the pivot
    return ob


# ---------------------------------------------------------------------------
# Street placement

def build_street(lib, col, blds):
    r = rng("street")
    groups = {}

    def G(name):
        if name not in groups:
            groups[name] = (MeshBuilder(f"props.{name}.wood"), MeshBuilder(f"props.{name}.metal"),
                            MeshBuilder(f"props.{name}.cloth"))
        return groups[name]

    W = Frame()
    walkL = -WALK_EDGE   # x of the left boardwalk's street edge
    walkR = WALK_EDGE

    # --- left boardwalk: store -------------------------------------------
    wd, mt, cl = G('left_near')
    for (y, rz) in ((7.0, 0.3), (7.7, 1.2), (15.2, 0.7)):
        barrel(wd, mt, W.sub((-9.3, y, DECK), rot_z=rz), r)
    barrel(wd, mt, W.sub((-8.8, 7.3, DECK + 0.0), rot_z=2.0), r, h=0.72, rad=0.25)
    crate(wd, W.sub((-9.4, 14.0, DECK), rot_z=0.05), r)
    crate(wd, W.sub((-9.35, 14.1, DECK + 0.55), rot_z=-0.12), r, sx=0.6, sy=0.5, sz=0.45)
    sack(cl, W.sub((-9.0, 13.2, DECK), rot_z=0.4), r)
    sack(cl, W.sub((-9.2, 12.8, DECK), rot_z=1.9), r)
    bench(wd, W.sub((-9.6, 10.3, DECK), rot_z=math.pi / 2), r)
    hitching_rail(wd, W.sub((walkL + 0.9, 9.0, 0.0), rot_z=math.pi / 2), r, length=3.2)

    # --- left: saloon ------------------------------------------------------
    wd, mt, cl = G('left_mid')
    hitching_rail(wd, W.sub((walkL + 0.9, 20.0, 0.0), rot_z=math.pi / 2), r, length=3.0)
    hitching_rail(wd, W.sub((walkL + 0.9, 26.5, 0.0), rot_z=math.pi / 2), r, length=3.0)
    trough(wd, W.sub((walkL + 0.4, 23.8, 0.0), rot_z=math.pi / 2), r)
    barrel(wd, mt, W.sub((-9.5, 30.3, DECK), rot_z=0.2), r)
    chair(wd, W.sub((-9.5, 19.2, DECK), rot_z=-math.pi / 2 + 0.3), r)

    # --- left: wagon (broken, mid-left in the street) -------------------
    wd, mt, cl = G('left_far')
    wagon(wd, mt, W.sub(WAGON[0], rot_z=math.radians(WAGON[1])), r)
    # barber pole + livery props
    barrel(wd, mt, W.sub((-9.4, 38.0, DECK), rot_z=0.4), r)

    # --- right boardwalk ---------------------------------------------------
    wd, mt, cl = G('right_near')
    crate(wd, W.sub((9.3, 23.0, DECK), rot_z=0.1), r)
    crate(wd, W.sub((9.2, 23.75, DECK), rot_z=-0.08), r, sx=0.6, sy=0.6, sz=0.6)
    crate(wd, W.sub((9.28, 23.35, DECK + 0.55), rot_z=0.25), r, sx=0.55, sy=0.45, sz=0.45)
    bench(wd, W.sub((9.62, 21.1, DECK), rot_z=-math.pi / 2), r, L=1.4)
    hitching_rail(wd, W.sub((walkR - 0.9, 18.2, 0.0), rot_z=math.pi / 2), r, length=3.0)
    trough(wd, W.sub((walkR - 0.4, 12.5, 0.0), rot_z=math.pi / 2), r, L=1.8)
    barrel(wd, mt, W.sub((9.4, 16.2, DECK), rot_z=1.1), r)

    wd, mt, cl = G('right_far')
    hitching_rail(wd, W.sub((walkR - 0.9, 30.0, 0.0), rot_z=math.pi / 2), r, length=3.4)
    # a freight drop in the street: crates two high, waiting for the store
    crate(wd, W.sub((5.9, 33.0, 0.0), rot_z=0.25), r, sx=0.9, sy=0.7, sz=0.6)
    crate(wd, W.sub((6.45, 33.35, 0.0), rot_z=0.1), r, sx=0.7, sy=0.6, sz=0.55)
    crate(wd, W.sub((5.95, 33.05, 0.6), rot_z=0.35), r, sx=0.75, sy=0.6, sz=0.5)
    sack(cl, W.sub((5.3, 32.6, 0.0), rot_z=1.2), r)
    # barrels at the far end of the street, by the blacksmith
    for (x, y, rz, hh) in ((4.4, 50.5, 0.2, 0.88), (5.0, 50.9, 1.3, 0.88), (4.6, 51.2, 2.0, 0.88),
                           (4.75, 50.85, 0.7, 0.72)):
        barrel(wd, mt, W.sub((x, y, 0.0 if hh > 0.8 else 0.88), rot_z=rz), r, h=hh, rad=0.29 if hh > 0.8 else 0.25)
    chair(wd, W.sub((9.4, 28.2, DECK), rot_z=math.pi / 2 - 0.4), r)
    chair(wd, W.sub((9.5, 35.8, DECK), rot_z=math.pi / 2 + 0.2), r)
    # coffins leaning against the undertaker's front
    for i, (yy, ang) in enumerate(((44.4, 0.14), (45.3, 0.1), (46.4, 0.16))):
        cf = W.sub((9.62, yy, DECK), rot_z=math.pi / 2).sub(rot_x=ang)
        coffin(wd, cf, r)

    # lamp posts along both walks
    for (x, y, grp) in ((walkL + 0.15, 17.3, 'left_mid'), (walkL + 0.15, 39.2, 'left_far'),
                        (walkR - 0.15, 16.3, 'right_near'), (walkR - 0.15, 39.8, 'right_far')):
        wd, mt, cl = G(grp)
        lamp_post(wd, mt, W.sub((x, y, DECK if abs(x) > WALK_EDGE else 0.0)), r)

    objs = []
    for gname, (wd, mt, cl) in groups.items():
        for mb, surf in ((wd, 'wood'), (mt, 'metal'), (cl, 'cloth')):
            ob = mb.build(col, lib, surface=surf, group=gname)
            if ob:
                objs.append(ob)
    return objs


def _barber_material(lib):
    from .nodes import new_material
    from .materials import lin
    m, g = new_material("barber_stripes")
    pos = g.geo('Position')
    uv = g.uv('local')
    u, v, _ = g.separate(uv)
    # helix: red, white, blue, white bands winding up the pole
    ph = g.math('FRACT', g.add(g.mul(u, 2.2), v))
    red = g.sub(1.0, g.smooth(ph, 0.23, 0.26))
    blue = g.mul(g.smooth(ph, 0.49, 0.52), g.sub(1.0, g.smooth(ph, 0.73, 0.76)))
    col = g.rgb(lin(220, 214, 200))
    col = g.mix(red, col, g.rgb(lin(150, 30, 26)))
    col = g.mix(blue, col, g.rgb(lin(40, 60, 110)))
    n = g.noise(pos, scale=20.0, detail=4.0)
    col = g.mix(g.mul(n, 0.3), col, g.hsv(col, v=0.7))
    g.output(g.principled(col, rough=0.35, coat=0.3))
    m["surface"] = 'glass'
    lib["barber_stripes"] = m


def _milk_glass(lib):
    from .materials import simple, lin
    lib["milk_glass"] = simple("milk_glass", lin(230, 226, 214), rough=0.2, surface='glass', noise=0.05)


def extra_materials(lib):
    """Prop materials other modules also use; created before any building."""
    _barber_material(lib)
    _milk_glass(lib)
