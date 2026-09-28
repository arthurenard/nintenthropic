"""Station Meridian outside the cupola: what the player sees through the
seven windows, 4 to 60 metres away.

Laid out for the view, not for an engineering drawing: every structure is
placed by where it lands on the player's screen (NDC x, y in -1..1 on a
16:9 screen) and how far away it is, then built in the world around that.

    the main truss        across the top, above the limb, 18 m out
    two solar wings       from the truss ends, reaching forward, cells to the sun
    the radiator          hanging down on the right, edge-on to the sun
    the robotic arm       from the truss, its hand in the right window
    a module + capsule    lower left, the capsule docked at its nose
    the laser turret      below the cupola, lower right of centre
    a sensor mast         a thin boom whose beacon sits near the centre
    a stowage platform    lower right, ORU boxes under blankets

Materials: white beta-cloth blankets, gold and silver MLI, bare and painted
aluminium, yellow EVA handrails, solar cells. Everything is lit at runtime
(PBR, see pbrbake.py); only the running lights glow.
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import bl, world
from .bl import Geo, rng

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))


def V(p):
    return Vector(tuple(float(c) for c in p))


def vp(sx, sy, d):
    return V(world.view_point(sx, sy, d))


# ---------------------------------------------------------------------------
# Parts

def lattice_truss(g, a, b, width, up, mat_long='white_paint', mat_cross='alu_bare', bay=2.4, r_long=0.06, r_x=0.035):
    """A square lattice truss from a to b: four longerons, a square frame
    at each bay, a diagonal on every face."""
    a, b = V(a), V(b)
    ax = (b - a)
    L = ax.length
    ax.normalize()
    u = (V(up) - ax * V(up).dot(ax)).normalized()
    v = ax.cross(u)
    h = width / 2
    corners = [u * h + v * h, u * h - v * h, -u * h - v * h, -u * h + v * h]
    I = Matrix.Identity(4)
    for c in corners:
        g.cyl(I, a + c, b + c, r_long, mat_long, seg=10, caps=(True, True))
    n = max(1, int(round(L / bay)))
    for i in range(n + 1):
        p = a + ax * (L * i / n)
        for k in range(4):
            g.cyl(I, p + corners[k], p + corners[(k + 1) % 4], r_x, mat_cross, seg=8, caps=(False, False))
        if i < n:
            q = a + ax * (L * (i + 1) / n)
            for k in range(4):
                c0, c1 = corners[k], corners[(k + 1) % 4]
                if (i + k) % 2:
                    g.cyl(I, p + c0, q + c1, r_x * 0.8, mat_cross, seg=6, caps=(False, False))
                else:
                    g.cyl(I, p + c1, q + c0, r_x * 0.8, mat_cross, seg=6, caps=(False, False))
            # node fittings
            for c in corners:
                g.box(bl.frame(p + c, ax, u, v), (0.18, 0.16, 0.16), 'alu_bare', bevel=0.02)
    return ax, u, v


def blanket_box(g, M, size, mat='beta_cloth', edge='alu_bare', mli=None):
    """An equipment box (ORU) wrapped in a blanket, with a handling
    fixture and a couple of connectors."""
    g.box(M, size, mat, bevel=min(size) * 0.08)
    sx, sy, sz = size
    if mli:
        g.box(M, (sx * 0.7, sy * 0.7, 0.01), mli, center=(0, 0, sz / 2 + 0.004))
    g.box(M, (0.12, 0.12, 0.05), edge, center=(0, 0, sz / 2 + 0.03), bevel=0.01)
    g.cyl(M, (sx * 0.3, sy * 0.5, 0), (sx * 0.3, sy * 0.5 + 0.06, 0), 0.03, 'alu_bare', seg=10)


def handrail(g, a, b, n_up, mat='handrail_yellow'):
    """An EVA handrail: a rounded bar on two stand-offs."""
    a, b = V(a), V(b)
    n = V(n_up).normalized()
    I = Matrix.Identity(4)
    h = 0.11
    g.tube(I, [a, a + n * h, b + n * h, b], 0.017, mat, seg=8)


def solar_wing(g, root, along, normal, length=30.0, blanket_w=4.4, gap=1.4):
    """A roll-out wing: a lattice mast down the middle, two blankets of
    cells either side, a blanket box at each end, tension wires."""
    root, along, normal = V(root), V(along).normalized(), V(normal).normalized()
    side = along.cross(normal).normalized()
    normal = side.cross(along).normalized()
    I = Matrix.Identity(4)
    # mast (thin lattice) along the centre
    lattice_truss(g, root, root + along * length, 0.5, normal, mat_long='alu_bare', mat_cross='alu_bare', bay=1.2, r_long=0.03, r_x=0.012)
    for sgn in (-1, 1):
        c0 = root + side * (sgn * (gap / 2 + blanket_w / 2)) + along * 1.2
        # the blanket: panels of cells with thin hinges between them
        npan = 14
        plen = (length - 2.4) / npan
        for i in range(npan):
            p = c0 + along * (plen * (i + 0.5))
            M = bl.frame(p, side, along, normal)
            g.box(M, (blanket_w, plen - 0.04, 0.012), 'solar_cell', mats={'-z': 'solar_back'})
        # end boxes and the tension bar
        for t in (0.0, length - 1.2):
            p = root + side * (sgn * (gap / 2 + blanket_w / 2)) + along * (t + 0.6)
            g.box(bl.frame(p, side, along, normal), (blanket_w + 0.2, 0.35, 0.25), 'white_paint', bevel=0.03)
        for w in (-0.45, 0.45):
            a = c0 + side * (w * blanket_w) - along * 0.2
            g.cyl(I, a, a + along * (length - 2.0), 0.006, 'alu_bare', seg=4, caps=(False, False))
    # base gimbal
    g.cyl(I, root - along * 0.6, root + along * 0.4, 0.6, 'white_paint', seg=24)
    g.cyl(I, root - along * 0.8, root - along * 0.6, 0.7, 'mli_silver', seg=24)


def radiator(g, root, along, normal, length=14.0, width=3.0, panels=6):
    root, along, normal = V(root), V(along).normalized(), V(normal).normalized()
    side = along.cross(normal).normalized()
    normal = side.cross(along).normalized()
    I = Matrix.Identity(4)
    plen = length / panels
    for i in range(panels):
        p = root + along * (plen * (i + 0.5))
        M = bl.frame(p, side, along, normal)
        g.box(M, (width, plen - 0.08, 0.06), 'radiator', bevel=0.01)
        # the flex hoses between panels
        if i:
            for w in (-0.4, 0.4):
                a = root + along * (plen * i) + side * (w * width)
                g.tube(I, [a - along * 0.05, a + normal * 0.08, a + along * 0.05], 0.025, 'alu_bare', seg=6)
    # the scissor-deploy frame along both edges
    for w in (-0.52, 0.52):
        g.cyl(I, root + side * (w * width), root + side * (w * width) + along * length, 0.03, 'alu_bare', seg=6)
    g.box(bl.frame(root - along * 0.4, side, along, normal), (width * 0.6, 0.8, 0.6), 'beta_cloth', bevel=0.05)


def arm(g_boom, root, elbow, wrist, up):
    """A two-boom robotic arm: shoulder joints on a base, white booms with
    blanket-wrapped joints, an elbow, a wrist. Returns the wrist frame."""
    root, elbow, wrist = V(root), V(elbow), V(wrist)
    I = Matrix.Identity(4)
    g = g_boom
    # base and shoulder joints
    d0 = (elbow - root).normalized()
    g.cyl(I, root - V(up) * 0.9, root, 0.42, 'white_paint', seg=24)
    g.cyl(I, root - V(up) * 0.95, root - V(up) * 0.85, 0.5, 'alu_bare', seg=24)
    sh = root + d0 * 0.6
    g.cyl(I, root, sh, 0.34, 'beta_cloth', seg=24)
    # booms
    for a, b in ((sh, elbow - (elbow - sh).normalized() * 0.45), (elbow + (wrist - elbow).normalized() * 0.45, wrist - (wrist - elbow).normalized() * 0.5)):
        g.cyl(I, a, b, 0.19, 'white_paint', seg=24)
        L = (b - a).length
        ax = (b - a).normalized()
        for t in (0.08, 0.5, 0.92):
            c = a + ax * (L * t)
            g.cyl(I, c - ax * 0.12, c + ax * 0.12, 0.2, 'mli_silver' if t == 0.5 else 'alu_bare', seg=24)
        # a camera and light on each boom
        c = a + ax * (L * 0.3)
        nrm = ax.orthogonal().normalized()
        g.box(bl.frame(c + nrm * 0.26, ax, nrm, ax.cross(nrm)), (0.3, 0.14, 0.18), 'white_paint', bevel=0.02)
    # elbow joint: two cylinders crossed
    e_ax = (elbow - sh).normalized().cross((wrist - elbow).normalized()).normalized()
    g.cyl(I, elbow - e_ax * 0.35, elbow + e_ax * 0.35, 0.36, 'beta_cloth', seg=24)
    g.cyl(I, elbow - e_ax * 0.38, elbow - e_ax * 0.34, 0.38, 'alu_bare', seg=24)
    g.cyl(I, elbow + e_ax * 0.34, elbow + e_ax * 0.38, 0.38, 'alu_bare', seg=24)
    return wrist, (wrist - elbow).normalized()


def arm_hand(lib, col, wrist, ax):
    """The end effector (secret.arm.hand): a wrist roll joint and the
    snare cylinder, its own object pivoting at the wrist so it can wave."""
    g = Geo("secret.arm.hand")
    I = Matrix.Identity(4)
    o = Vector((0, 0, 0))
    a = V(ax)
    side = a.orthogonal().normalized()
    g.cyl(I, o, o + a * 0.4, 0.3, 'beta_cloth', seg=24)
    g.cyl(I, o + a * 0.4, o + a * 0.46, 0.33, 'alu_bare', seg=24)
    g.cyl(I, o + a * 0.46, o + a * 1.2, 0.26, 'white_paint', seg=24)
    g.cyl(I, o + a * 1.2, o + a * 1.3, 0.27, 'black_paint', seg=24, caps=(True, False))
    # snare: open end with three wires inside
    g.cyl(I, o + a * 1.3, o + a * 1.32, 0.27, 'alu_bare', seg=24, caps=(False, False))
    # camera and light on the side
    g.box(bl.frame(o + a * 0.8 + side * 0.3, a, side, a.cross(side)), (0.28, 0.12, 0.16), 'alu_darkext', bevel=0.02)
    g.cyl(I, o + a * 0.9 + side * 0.36, o + a * 1.0 + side * 0.36, 0.05, 'window_dark', seg=12)
    ob = g.build(col, lib)
    ob.location = V(wrist)
    bl.tag(ob, surface='metal', secret='arm', pivot='wrist', wave_axis=[round(float(c), 4) for c in world.gltf(a)])
    return ob


def module(g, a, b, radius, rnd, ports=True):
    """A pressurised module: a cylinder wrapped in white blanket panels
    with seams, a few gold MLI patches, handrails, a grapple fixture."""
    a, b = V(a), V(b)
    ax = (b - a)
    L = ax.length
    ax.normalize()
    u = ax.orthogonal().normalized()
    v = ax.cross(u)
    I = Matrix.Identity(4)
    M = bl.frame(a, u, v, ax)
    # the blanket skin in panels (lathe segments with a gap line)
    nseg = 8
    for s in range(nseg):
        a0 = 2 * math.pi * s / nseg + 0.01
        a1 = 2 * math.pi * (s + 1) / nseg - 0.01
        for ring in range(int(L / 1.6) + 1):
            z0 = ring * 1.6
            z1 = min(L, z0 + 1.58)
            if z1 <= z0:
                continue
            mat = 'beta_cloth'
            if rnd.random() < 0.08:
                mat = 'mli_gold'
            elif rnd.random() < 0.05:
                mat = 'mli_silver'
            g.lathe(M, [(radius, z0), (radius, z1)], mat, seg=6, a0=a0, a1=a1, closed=False)
    # end cones and rings
    g.lathe(M, [(radius, 0), (radius * 0.96, -0.3), (radius * 0.6, -0.6), (0.9, -0.7)], 'beta_cloth', seg=32)
    g.lathe(M, [(radius, L), (radius * 0.96, L + 0.3), (radius * 0.55, L + 0.6), (0.85, L + 0.7)], 'beta_cloth', seg=32)
    for zz in (0.02, L - 0.02):
        g.lathe(M, [(radius + 0.01, zz - 0.06), (radius + 0.05, zz), (radius + 0.01, zz + 0.06)], 'alu_bare', seg=48)
    # handrails along the top and sides
    for ang in (0.3, 1.9, 3.5, 5.0):
        n = u * math.cos(ang) + v * math.sin(ang)
        for k in range(int(L / 1.5)):
            p0 = a + ax * (0.5 + k * 1.5) + n * radius
            handrail(g, p0, p0 + ax * 0.6, n)
    # grapple fixture
    n = u * math.cos(1.1) + v * math.sin(1.1)
    p = a + ax * (L * 0.55) + n * radius
    gm = bl.frame(p, ax, n.cross(ax), n)
    g.box(gm, (0.6, 0.6, 0.08), 'alu_bare', center=(0, 0, 0.04), bevel=0.01)
    g.cyl(gm, (0, 0, 0.08), (0, 0, 0.35), 0.05, 'alu_bare', seg=12)
    g.box(gm, (0.3, 0.08, 0.25), 'black_paint', center=(0.18, 0, 0.2), bevel=0.01)
    return ax, u, v


def capsule(lib, col, nose_port, axis, up):
    """A crew capsule docked nose-in: a truncated cone with side windows,
    a trunk with solar cells, fins, a docking adapter. Returns the body and
    the window/shade objects."""
    port = V(nose_port)
    ax = V(axis).normalized()               # from the port outward, along the capsule
    u = (V(up) - ax * V(up).dot(ax)).normalized()
    v = ax.cross(u)
    M = bl.frame(port, u, v, ax)
    g = Geo("station.capsule")
    # docking adapter
    g.lathe(M, [(0.9, 0.0), (0.9, 0.35), (0.8, 0.4)], 'alu_bare', seg=32)
    g.lathe(M, [(0.8, 0.4), (0.8, 0.55), (1.0, 0.6)], 'white_paint', seg=32)
    # the capsule: nose cap to heat-shield
    prof = [(0.5, 0.6), (0.9, 0.75), (1.05, 0.95), (1.55, 2.4), (1.85, 3.7), (1.9, 3.85), (1.88, 4.0)]
    g.lathe(M, prof, 'capsule_white', seg=64)
    g.lathe(M, [(1.88, 4.0), (1.8, 4.2), (1.2, 4.35), (0.0, 4.4)], 'heatshield', seg=64)
    # trunk behind with body-mounted cells and fins
    g.lathe(M, [(1.85, 4.4), (1.85, 7.2), (1.85, 7.25), (0.0, 7.3)], 'solar_cell', seg=48, mats=['solar_cell', 'alu_bare', 'alu_bare'])
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        n = u * math.cos(a) + v * math.sin(a)
        p = port + ax * 6.6 + n * 1.85
        g.box(bl.frame(p, ax, n, ax.cross(n)), (1.1, 0.9, 0.05), 'white_paint', center=(0, 0.45, 0), bevel=0.01)
    # thruster pods (Draco-like) around the shoulder
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        n = u * math.cos(a) + v * math.sin(a)
        p = port + ax * 1.6 + n * 1.18
        g.box(bl.frame(p, ax, n, ax.cross(n)), (0.28, 0.08, 0.2), 'black_paint', center=(0, 0.02, 0), bevel=0.02)
    # side windows (dark glass), except the one the game uses
    wins = []
    for k in range(4):
        a = -0.55 + k * 0.37
        n = u * math.cos(a) + v * math.sin(a)
        # a point on the cone surface at z = 2.0
        rz = 1.05 + (1.55 - 1.05) * (2.0 - 0.95) / (2.4 - 0.95)
        p = port + ax * 2.0 + n * rz
        slope = math.atan2(1.55 - 1.05, 2.4 - 0.95)
        nn = (n * math.cos(slope) - ax * math.sin(slope)).normalized()
        wins.append((p, nn, n))
    for i, (p, nn, n) in enumerate(wins):
        if i == 1:
            continue
        t = ax.cross(n).normalized()
        g.box(bl.frame(p + nn * 0.01, t, nn.cross(t), nn), (0.36, 0.26, 0.02), 'window_dark', bevel=0.006)
    body = g.build(col, lib, smooth_angle=35)
    bl.tag(body, surface='metal')
    # the secret window (its own node) and its shade, rolled up at the top
    p, nn, n = wins[1]
    t = ax.cross(n).normalized()
    up_w = nn.cross(t).normalized()
    gw = Geo("secret.capsule.window")
    gw.box(bl.frame(Vector((0, 0, 0)), t, up_w, nn), (0.38, 0.28, 0.02), 'window_dark', center=(0, 0, 0.01), bevel=0.006)
    wob = gw.build(col, lib)
    wob.location = p
    bl.tag(wob, surface='glass', secret='capsule')
    gs = Geo("secret.capsule.shade")
    # rolled up: a thin cylinder along the window's top edge, inside
    gs.cyl(Matrix.Identity(4), -t * 0.17 + up_w * 0.11 - nn * 0.04, t * 0.17 + up_w * 0.11 - nn * 0.04, 0.015, 'fabric', seg=10)
    sob = gs.build(col, lib)
    sob.location = p
    bl.tag(sob, surface='cloth', secret='capsule', note="pull down: scale local -up from the top edge to 0.24 m")
    # a crew member behind the glass: a face in a helmet-less cap, dim
    gc = Geo("station.capsule.crew")
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.11)
    gc.add_bmesh(bm, bl.frame(p - nn * 0.28, t, up_w, nn), 'fabric', smooth=True)
    bm.free()
    cob = gc.build(col, lib)
    bl.tag(cob, surface='cloth')
    return body, wob, sob


def turret(lib, col, base, aim):
    """The point-defence laser: a gimballed turret on a short boom, a
    finned housing and a lens barrel. Returns the body and the muzzle."""
    g = Geo("station.turret")
    I = Matrix.Identity(4)
    base, aim = V(base), V(aim).normalized()
    up = Vector((0, 0, 1))
    # boom from below
    foot = base - up * 2.6 - aim * 1.2
    g.cyl(I, foot, base - up * 0.5, 0.16, 'white_paint', seg=16)
    g.cyl(I, base - up * 0.55, base - up * 0.3, 0.42, 'alu_bare', seg=24)
    # yoke
    side = aim.cross(up).normalized()
    upv = side.cross(aim).normalized()
    g.box(bl.frame(base - up * 0.2, side, aim, up), (0.9, 0.5, 0.2), 'white_paint', bevel=0.03)
    for s in (-1, 1):
        g.box(bl.frame(base + side * (0.42 * s), side, aim, up), (0.1, 0.4, 0.55), 'white_paint', center=(0, 0, 0.1), bevel=0.02)
    # housing with fins
    Mh = bl.frame(base + up * 0.15, side, aim, upv)
    g.box(Mh, (0.7, 0.9, 0.5), 'alu_darkext', bevel=0.05)
    for k in range(7):
        g.box(Mh, (0.02, 0.8, 0.12), 'alu_bare', center=(-0.3 + k * 0.1, -0.05, 0.3))
    g.box(Mh, (0.72, 0.4, 0.52), 'mli_gold', center=(0, -0.3, 0))
    # barrel and lens
    muzzle = base + up * 0.15 + aim * 1.25
    g.cyl(I, base + up * 0.15 + aim * 0.4, muzzle - aim * 0.1, 0.13, 'white_paint', seg=24)
    g.cyl(I, muzzle - aim * 0.1, muzzle, 0.17, 'alu_bare', seg=24, cap_mat='window_dark')
    ob = g.build(col, lib)
    bl.tag(ob, surface='metal')
    return ob, muzzle


def beacon(lib, col, name, pos, normal, kind):
    """A running light: a small housing and an emissive lens. The contract
    empty calib.<n> sits at the lens centre."""
    g = Geo(f"station.light.{name}")
    n = V(normal).normalized()
    M = bl.frame(V(pos), n.orthogonal().normalized(), n.cross(n.orthogonal()).normalized(), n)
    g.box(M, (0.22, 0.22, 0.1), 'white_paint', center=(0, 0, -0.05), bevel=0.02)
    import bmesh as _bm
    bm = _bm.new()
    _bm.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.075)
    for vv in bm.verts:
        if vv.co.z < 0:
            vv.co.z *= 0.2
    g.add_bmesh(bm, M, {'red': 'nav_red', 'green': 'nav_green', 'white': 'nav_white'}[kind], smooth=True)
    bm.free()
    ob = g.build(col, lib)
    bl.tag(ob, surface='metal', light=kind)
    return ob


# ---------------------------------------------------------------------------

def build(lib, col, c_con):
    r = rng("station")
    I = Matrix.Identity(4)
    objs = {}
    # ---------------- the truss across the top ----------------------------
    t_mid = vp(0.0, 0.93, 30.0)
    truss_up = Vector((0, 0.25, 1)).normalized()
    g = Geo("station.truss")
    a, b = t_mid - X * 62, t_mid + X * 58
    lattice_truss(g, a, b, 2.5, truss_up)
    # utility trays, ORU boxes and blankets along the front face
    front = -Y
    for i in range(22):
        x = -40 + i * 3.8 + r.uniform(-0.8, 0.8)
        if abs(x) < 2.5:
            continue
        p = t_mid + X * x + front * 1.45 + Z * r.uniform(-0.6, 0.6)
        sz = (r.uniform(0.8, 1.8), r.uniform(0.5, 0.9), r.uniform(0.5, 1.0))
        blanket_box(g, bl.frame(p, X, -front, Z), sz, r.choice(('beta_cloth', 'beta_cloth', 'mli_gold', 'mli_silver')),
                    mli=r.choice((None, 'mli_gold', 'kapton')))
    # rail along the top face
    for s in (-0.4, 0.4):
        g.cyl(I, a + truss_up * 1.35 + Y * s, b + truss_up * 1.35 + Y * s, 0.05, 'alu_bare', seg=8)
    # yellow handrails on the front face
    for i in range(-14, 14):
        p = t_mid + X * (i * 3.0 + 0.8) + front * 1.28 - truss_up * 0.9
        handrail(g, p, p + X * 0.6, front)
    objs['truss'] = g.build(col, lib, smooth_angle=40)
    # a dish antenna on a boom above the truss, left
    g = Geo("station.antenna")
    base = t_mid - X * 14 + truss_up * 1.3
    tip = base + truss_up * 3.5 + Y * 1.5
    g.cyl(I, base, tip, 0.12, 'white_paint', seg=12)
    dish_axis = (-Y * 0.8 + Z * 0.4 + X * 0.3).normalized()
    Md = bl.frame(tip, dish_axis.orthogonal().normalized(), dish_axis.cross(dish_axis.orthogonal()).normalized(), dish_axis)
    g.lathe(Md, [(0.0, 0.0), (0.6, 0.08), (1.1, 0.3), (1.15, 0.33)], 'white_paint', seg=40)
    g.cyl(Md, (0, 0, 0.0), (0, 0, 0.7), 0.04, 'alu_bare', seg=8)
    g.box(Md, (0.16, 0.16, 0.2), 'mli_gold', center=(0, 0, 0.75), bevel=0.02)
    objs['antenna'] = g.build(col, lib)
    # ---------------- solar wings -----------------------------------------
    sun = V(world.sun_dir())
    for side_x, name in ((-27.0, 'left'), (25.0, 'right')):
        g = Geo(f"station.array.{name}")
        root = t_mid + X * side_x
        along = (Y * 1.0 - Z * 0.12 + X * (0.30 if side_x < 0 else -0.30)).normalized()
        normal = (sun - along * sun.dot(along)).normalized()
        for off in ((-6.0, 6.0) if side_x > 0 else (-6.0, 6.0)):
            solar_wing(g, root + X * off + along * 1.0, along, normal, length=34.0)
        g.box(bl.frame(root, X, Y, Z), (4.0, 3.0, 3.0), 'beta_cloth', bevel=0.2)
        objs[f'array_{name}'] = g.build(col, lib, smooth_angle=40)
    # ---------------- radiator on the right --------------------------------
    g = Geo("station.radiator")
    rroot = t_mid + X * 20.0 - truss_up * 1.4
    r_along = (-Z * 0.8 + Y * 0.55 + X * 0.1).normalized()
    # edge-on to the sun: its normal is perpendicular to the sun direction
    rn = r_along.cross(sun).normalized()
    radiator(g, rroot, r_along, rn, length=16.0, width=3.2, panels=7)
    objs['radiator'] = g.build(col, lib)
    # ---------------- robotic arm -----------------------------------------
    g = Geo("station.arm")
    aroot = t_mid + X * 7.0 - truss_up * 1.3 - Y * 0.6
    # the arm reaches in from the right: its hand pokes into the centre
    # window, the way Canadarm2 hangs in so many cupola photographs
    elbow = vp(0.95, 0.42, 15.0)
    wrist = vp(0.24, 0.04, 11.5)
    wpos, wax = arm(g, aroot, elbow, wrist, truss_up)
    objs['arm'] = g.build(col, lib, smooth_angle=40)
    objs['hand'] = arm_hand(lib, col, wpos, wax)
    # ---------------- module and capsule, lower left ------------------------
    mod_axis = (X * 1.0 - Y * 0.25).normalized()
    m_end = vp(-0.46, -0.50, 19.0)
    m_start = m_end - mod_axis * 12.0
    g = Geo("station.module")
    module(g, m_start, m_end, 2.1, r)
    # docking port at the nose
    Mp = bl.frame(m_end, mod_axis.orthogonal().normalized(), mod_axis.cross(mod_axis.orthogonal()).normalized(), mod_axis)
    g.lathe(Mp, [(0.85, 0.7), (0.85, 1.3), (1.0, 1.35), (1.0, 1.5)], 'alu_bare', seg=40)
    objs['module'] = g.build(col, lib, smooth_angle=40)
    cap_body, cap_win, cap_shade = capsule(lib, col, m_end + mod_axis * 1.5, mod_axis, -Y + Z * 0.3)
    objs['capsule'] = cap_body
    # ---------------- stowage platform, lower right ------------------------
    g = Geo("station.platform")
    pc = vp(0.6, -0.62, 12.0)
    Mpf = bl.frame(pc, X, Y, Z)
    lattice_truss(g, pc - X * 3.2 - Z * 0.6, pc + X * 3.2 - Z * 0.6, 0.6, Z, bay=1.6, r_long=0.05, r_x=0.03)
    g.box(Mpf, (6.6, 2.4, 0.12), 'alu_bare', center=(0, 0, -0.25), bevel=0.02)
    for i in range(4):
        sz = (r.uniform(0.8, 1.2), r.uniform(0.8, 1.5), r.uniform(0.6, 1.1))
        blanket_box(g, bl.frame(pc + X * (-2.6 + i * 1.15) + Z * (sz[2] / 2 - 0.19), X, Y, Z), sz,
                    r.choice(('beta_cloth', 'mli_gold', 'beta_cloth', 'mli_silver')), mli=r.choice((None, 'kapton', 'mli_gold')))
    # its support strut back to the station
    g.cyl(I, pc - Z * 0.6 - X * 2.5, pc - Z * 6.0 - Y * 4.0 - X * 4.0, 0.14, 'white_paint', seg=12)
    objs['platform'] = g.build(col, lib, smooth_angle=40)
    # the drone's cradle sits on the platform's right end
    dock = pc + X * 2.2 + Z * 0.35
    # ---------------- the laser turret below ------------------------------
    t_base = vp(0.24, -0.76, 5.2)
    tur, muzzle = turret(lib, col, t_base, V(world.forward()))
    objs['turret'] = tur
    # ---------------- sensor mast near the centre --------------------------
    for ob in objs.values():
        if ob is not None and 'surface' not in ob.keys():
            ob['surface'] = 'metal'

    # ---------------- running lights (calib.1-9) --------------------------
    lights = [
        ('1', t_mid - X * 14.0 - Y * 1.5 - truss_up * 1.2, 'red'),     # top-left, truss
        ('2', t_mid + X * 3.2 - Y * 1.5 - truss_up * 1.2, 'white'),     # top-centre, truss
        ('3', t_mid + X * 15.0 - Y * 1.5 - truss_up * 1.2, 'green'),    # top-right, truss
        ('4', vp(-0.86, 0.05, 30.0), 'red'),      # left, array root area
        ('5', wpos + wax * 0.0 + Vector((0, 0, 0.42)), 'white'),  # centre, on the arm's wrist
        ('6', rroot + r_along * 15.6, 'green'),    # right, radiator tip
        ('7', m_end + mod_axis * 1.5 + mod_axis * 7.35, 'red'),   # bottom-left, capsule trunk
        ('8', t_base - Z * 0.35 + X * 0.55, 'white'),            # bottom-centre, turret yoke
        ('9', pc + Z * 0.2 - X * 3.3, 'green'),   # bottom-right, platform
    ]
    calib = {}
    for name, p, kind in lights:
        nrm = (-p).normalized()
        beacon(lib, col, name, p, nrm, kind)
        calib[int(name)] = bl.empty(f"calib.{name}", c_con, loc=p, size=0.3, light=kind, surface='metal')
    # ---------------- contract empties ------------------------------------
    bl.empty("emitter", c_con, matrix=bl.look_matrix(muzzle, world.forward(), (0, 0, 1)), size=0.4,
             note="the laser's muzzle; the beam leaves along the node's -Z")
    bl.empty("drone.dock", c_con, matrix=bl.look_matrix(dock, -dock, (0, 0, 1)), size=0.5)
    objs['drone_dock'] = dock_cradle(lib, col, dock)
    # the drone's rounds: a loop out from the dock past the windows and back
    route = [dock + Vector((0, -2.0, 0.8)), vp(0.22, 0.30, 6.0), vp(-0.35, 0.25, 5.0), vp(-0.45, -0.35, 5.5),
             vp(0.05, -0.55, 5.0), vp(0.45, -0.3, 5.5), vp(0.5, 0.35, 7.0)]
    for i, p in enumerate(route, 1):
        bl.empty(f"drone.path.{i}", c_con, loc=p, size=0.25)
    # where it hovers to mend each pane: 1.1 m outside the glass
    from . import cupola as C
    for n, pane in _pane_centres().items():
        c, nrm = pane
        bl.empty(f"drone.work.{n}", c_con, matrix=bl.look_matrix(c + nrm * 1.1, -nrm, (0, 0, 1)), size=0.2, pane=n)
    # the spacewalker's route along the truss's front face, left to right
    for i in range(8):
        x = -16 + i * 4.2
        p = t_mid + X * x - Y * 1.9 - truss_up * 0.4
        bl.empty(f"astronaut.path.{i + 1}", c_con, matrix=bl.look_matrix(p, X, truss_up), size=0.3)
    # the duck's drift through the debris field
    for i, (sx, sy, d) in enumerate(((-1.4, 0.35, 70), (-0.7, 0.2, 60), (0.0, 0.1, 55), (0.7, -0.05, 62), (1.4, -0.2, 75)), 1):
        bl.empty(f"secret.duck.path.{i}", c_con, loc=vp(sx, sy, d), size=0.5)
    # debris lanes begin far out, spread over the view
    k = 1
    rs = rng("spawn")
    for sy in (0.25, -0.05, -0.35, -0.65):
        for sx in (-0.75, -0.25, 0.25, 0.75):
            d = rs.uniform(80, 120)
            p = vp(sx + rs.uniform(-0.12, 0.12), sy + rs.uniform(-0.08, 0.08), d)
            bl.empty(f"spawn.{k}", c_con, loc=p, size=1.0, depth_m=round(d, 1))
            k += 1
    return objs


def dock_cradle(lib, col, dock):
    g = Geo("station.dock")
    I = Matrix.Identity(4)
    d = V(dock)
    # the drone parks on this cradle: a plate with four guide posts, on a
    # boom that rises from the station's belly
    g.box(bl.frame(d - Z * 0.45, X, Y, Z), (1.3, 1.3, 0.12), 'alu_bare', bevel=0.02)
    for sx in (-0.55, 0.55):
        for sy in (-0.55, 0.55):
            g.cyl(I, d - Z * 0.45 + X * sx + Y * sy, d - Z * 0.1 + X * sx + Y * sy, 0.035, 'white_paint', seg=8)
    g.box(bl.frame(d - Z * 0.6, X, Y, Z), (0.9, 0.9, 0.25), 'beta_cloth', bevel=0.04)
    g.box(bl.frame(d - Z * 0.45 - Y * 0.66, X, Y, Z), (0.7, 0.02, 0.1), 'label_yellow')
    g.box(bl.frame(d - Z * 0.4 + X * 0.75, X, Y, Z), (0.18, 0.4, 0.18), 'white_paint', bevel=0.02)
    ob = g.build(col, lib)
    bl.tag(ob, surface='metal')
    return ob


def _pane_centres():
    """World centre and outward normal of each pane (for drone.work.<n>)."""
    from . import cupola as C
    P = C.pitch_matrix()
    out = {}
    for k in range(6):
        F = C.facet(k)
        c = sum(C.window_corners(F), Vector()) / 4 - F['n'] * C.SHELL
        out[C.FACET_PANE[k]] = ((P @ c.to_4d()).to_3d(), (P.to_3x3() @ (-F['n'])).normalized())
    c = C.AX * (C.A_TOP + C.SHELL)
    out[0] = ((P @ c.to_4d()).to_3d(), (P.to_3x3() @ C.AX).normalized())
    return out
