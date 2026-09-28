"""The cupola of Station Meridian: a seven-windowed observation dome, seen
from inside by a player floating at its base, looking out along its axis.

Built in the cupola's own frame - x to the right, y along the axis (the
view), z up on screen - then pitched down with the view (world.PITCH_DEG),
so every object's matrix is PITCH @ local.

The shape is a truncated hexagonal pyramid: a round centre window in the
top plate, and six trapezoid windows in the six sloping facets around it,
with their narrow edge toward the centre. The hexagon's corners point up
and down, so the side windows sit right, upper-right, upper-left, left,
lower-left and lower-right, and the mullions between them run toward the
screen's corners - on a wide screen that is what lets the most glass show.

Everything the eye can see near the frame is modelled as the real thing
is made: the dome is a machined forging with raised window-retention
frames and rings of bolts; ribs cover the joints; each window has a crank
for its outer shutter, a number placard, a rubber seal; blue anodised
handrails on stand-offs; velcro squares where crew stick things; cable
runs in clips; a laptop on an articulated arm; LED strips at the base;
and a few things adrift on tethers.
"""

import math

import bpy
from mathutils import Matrix, Vector

from . import bl, world
from .bl import Geo, rng

# ---- the shape (metres, cupola frame) --------------------------------------
A_TOP = 1.50        # top plate's inner face, along the axis from the eye
R_TOP = 0.53        # top hexagon inradius
R_CW = 0.40         # centre window clear radius (an 80 cm window, as on the real one)
A_BASE = 0.26       # base plane
R_BASE = 1.10       # base hexagon inradius
WIN_T0, WIN_T1 = 0.05, 0.63   # side windows along the facet (0 top edge .. 1 base edge)
MULLION = 0.036     # half-width of frame left beside each side window
SHELL = 0.075       # thickness of the dome's forging (the window reveals)
GLASS_IN = 0.035    # the pane sits this far into the reveal
PANE_NAMES = {0: "pane.center"}
# pane numbering, clockwise from the upper-left as the player sees them
# facet index k: facet centre at angle 60k degrees (0 = right, 90 = up)
FACET_PANE = {2: 1, 1: 2, 0: 3, 5: 4, 4: 5, 3: 6}
PANE_LABEL = {0: "center", 1: "upper-left", 2: "upper-right", 3: "right", 4: "lower-right", 5: "lower-left", 6: "left"}


def pitch_matrix():
    return Matrix.Rotation(math.radians(world.PITCH_DEG), 4, 'X')


def rdir(phi):
    return Vector((math.cos(phi), 0.0, math.sin(phi)))


AX = Vector((0.0, 1.0, 0.0))


def facet(k):
    """Geometry of facet k: top/bottom edge midpoints, slant and lateral
    unit vectors, inward normal, and a function giving the facet's half
    width at slant parameter t."""
    phi = math.radians(60 * k)
    d = rdir(phi)
    T = d * R_TOP + AX * A_TOP
    B = d * R_BASE + AX * A_BASE
    s = (B - T)
    L = s.length
    s.normalize()
    lat = Vector((-math.sin(phi), 0.0, math.cos(phi)))       # counter-clockwise along the facet
    n_in = lat.cross(s).normalized()
    if n_in.dot(-d) < 0:
        n_in = -n_in
    half = lambda t: (R_TOP + (R_BASE - R_TOP) * t) * math.tan(math.radians(30))
    return dict(phi=phi, d=d, T=T, B=B, s=s, L=L, lat=lat, n=n_in, half=half)


def fpt(F, t, w, depth=0.0):
    """Point on facet F at slant t (0..1), lateral offset w (m), pushed
    `depth` metres outward (into the forging) along -n."""
    return F['T'] + F['s'] * (F['L'] * t) + F['lat'] * w - F['n'] * depth


def window_corners(F, inset=0.0):
    """Side window opening corners (inner face), CCW seen from the eye."""
    t0 = WIN_T0 + inset / F['L']
    t1 = WIN_T1 - inset / F['L']
    w0 = F['half'](t0) - MULLION - inset
    w1 = F['half'](t1) - MULLION - inset
    return [fpt(F, t0, -w0), fpt(F, t0, w0), fpt(F, t1, w1), fpt(F, t1, -w1)]


def hexagon(R, a, rot=math.radians(30)):
    """Corners of a hexagon (inradius R) in the plane y=a; corners at
    30 + 60j degrees so edges face 0, 60, 120..."""
    Rc = R / math.cos(math.radians(30))
    return [rdir(rot + math.radians(60) * j) * Rc + AX * a for j in range(6)]


# ---------------------------------------------------------------------------

def build(lib, col):
    """Build the cupola; returns a dict of the objects the rest of the
    build needs (panes, floats, the contract empties)."""
    P = pitch_matrix()
    r = rng("cupola")
    out = {'panes': {}, 'floats': [], 'shutters': []}

    # ---------------- the forging: top plate and six facets ----------------
    shell = Geo("cupola.shell")
    # The forging is built as separate plates - six sectors round the centre
    # window, four strips round each side window - rather than plates with
    # holes: each becomes its own compact UV island, so the baked atlas has
    # no empty window-shaped holes in it.
    top = hexagon(R_TOP, A_TOP)
    # plate lies in x-z plane; the sheet builder extrudes along its local +Z,
    # so map local (X, Y, Z) -> cupola (x, z, y)
    Mt = Matrix(((1, 0, 0, 0), (0, 0, 1, A_TOP), (0, 1, 0, 0), (0, 0, 0, 1)))
    for j in range(6):
        a0 = math.atan2(top[j].z, top[j].x)
        a1 = math.atan2(top[(j + 1) % 6].z, top[(j + 1) % 6].x)
        if a1 < a0:
            a1 += 2 * math.pi
        arc = [(R_CW * math.cos(a1 - (a1 - a0) * i / 12), R_CW * math.sin(a1 - (a1 - a0) * i / 12)) for i in range(13)]
        sector = [(top[j].x, top[j].z), (top[(j + 1) % 6].x, top[(j + 1) % 6].z)] + arc
        shell.sheet(Mt, sector, SHELL, 'alu_dark', side_mat='alu_frame')
    for k in range(6):
        F = facet(k)
        # facet plates in its own 2D frame: X = lateral, Y = slant (m)
        Mf = bl.frame(F['T'], F['lat'], F['s'], -F['n'])
        L = F['L']
        TL, TR, BR, BL = (-F['half'](0), 0), (F['half'](0), 0), (F['half'](1), L), (-F['half'](1), L)
        c = []
        for p in window_corners(F):
            q = p - F['T']
            c.append((q.dot(F['lat']), q.dot(F['s'])))
        c0, c1, c2, c3 = c                      # top-left, top-right, bottom-right, bottom-left
        for strip in ([TL, TR, c1, c0], [c1, TR, BR, c2], [c3, c2, BR, BL], [TL, c0, c3, BL]):
            shell.sheet(Mf, strip, SHELL, 'alu_dark', side_mat='alu_frame')
    ob = shell.build(col, lib, smooth_angle=30)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='shell')

    # ---------------- window frames, bolts, seals, glass --------------------
    fr = Geo("cupola.frames")
    # centre window: a machined retention ring (lathe profile, z = axis)
    Mc = Matrix(((1, 0, 0, 0), (0, 0, 1, A_TOP), (0, -1, 0, 0), (0, 0, 0, 1)))   # local z -> -y (toward the eye)
    ring = [(R_CW - 0.004, 0.0), (R_CW - 0.004, 0.012), (R_CW + 0.006, 0.026), (R_CW + 0.030, 0.030),
            (R_CW + 0.080, 0.030), (R_CW + 0.092, 0.020), (R_CW + 0.100, 0.0)]
    fr.lathe(Mc, ring, 'alu_frame', seg=96)
    # seal between ring and glass
    fr.lathe(Mc, [(R_CW - 0.001, -GLASS_IN + 0.004), (R_CW - 0.006, -0.004), (R_CW - 0.006, 0.004)], 'rubber', seg=64)
    for i in range(24):
        a = 2 * math.pi * (i + 0.5) / 24
        pos = Vector((math.cos(a) * (R_CW + 0.055), A_TOP - 0.030, math.sin(a) * (R_CW + 0.055)))
        fr.bolt(Matrix.Identity(4), pos, (0, -1, 0), 'steel', head=0.0085, height=0.006)
    # side windows: raised frames (a ring of 4 bars with mitred corners), bolts
    for k in range(6):
        F = facet(k)
        inner = window_corners(F, 0.0)
        outer = window_corners(F, -0.055)
        h = F['n'] * 0.022
        for i in range(4):
            a0, a1 = inner[i], inner[(i + 1) % 4]
            b0, b1 = outer[i], outer[(i + 1) % 4]
            fr.poly([a0 + h, a1 + h, b1 + h, b0 + h], 'alu_frame')                         # face
            fr.poly([a0, a1, a1 + h, a0 + h], 'alu_frame')                                 # inner lip
            fr.poly([b1, b0, b0 + h, b1 + h], 'alu_frame')                                 # outer edge
            # bolts along the frame
            L = (a1 - a0).length
            nb = max(3, int(L / 0.075))
            for j in range(nb):
                t = (j + 0.5) / nb
                pa = a0.lerp(a1, t)
                pb = b0.lerp(b1, t)
                pos = pa.lerp(pb, 0.55) + h
                fr.bolt(Matrix.Identity(4), pos, F['n'], 'steel', head=0.0075, height=0.005)
        # rubber seal inside the reveal
        seal_in = window_corners(F, 0.004)
        for i in range(4):
            a0, a1 = seal_in[i], seal_in[(i + 1) % 4]
            fr.poly([a0 - F['n'] * (GLASS_IN - 0.004), a1 - F['n'] * (GLASS_IN - 0.004), a1 - F['n'] * 0.002, a0 - F['n'] * 0.002], 'rubber')
    ob = fr.build(col, lib, smooth_angle=40)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='frames')

    # ---------------- ribs over the joints -------------------------------
    rb = Geo("cupola.ribs")
    top = hexagon(R_TOP, A_TOP)
    base = hexagon(R_BASE, A_BASE)
    for j in range(6):
        a, b = top[j], base[j]
        d = (b - a).normalized()
        radial = Vector((a.x, 0, a.z)).normalized()
        inward = (-radial - d * (-radial).dot(d)).normalized()
        side = d.cross(inward).normalized()
        M = bl.frame(a, side, d, inward)
        L = (b - a).length
        rb.box(M, (0.085, L + 0.05, 0.030), 'alu_frame', center=(0, L / 2, 0.012), bevel=0.006)
        rb.box(M, (0.040, L - 0.04, 0.012), 'alu_dark', center=(0, L / 2, 0.032), bevel=0.003)
        for t in [0.12 + 0.76 * i / 7 for i in range(8)]:
            for sgn in (-1, 1):
                p = a + d * (L * t) + side * (0.030 * sgn) + inward * 0.027
                rb.bolt(Matrix.Identity(4), p, inward, 'steel', head=0.0055, height=0.004, washer=False)
    # the ring where the top plate meets the facets
    for j in range(6):
        a, b = top[j], top[(j + 1) % 6]
        e = (b - a)
        L = e.length
        e.normalize()
        mid = (a + b) / 2
        inward = Vector((-mid.x, 0, -mid.z)).normalized()
        M = bl.frame(a, e, inward.cross(e), inward)
        rb.box(M, (L, 0.05, 0.022), 'alu_frame', center=(L / 2, 0.0, 0.009), bevel=0.005)
    ob = rb.build(col, lib, smooth_angle=40)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='ribs')

    # ---------------- base ring (the berthing ring, mostly out of view) ---
    br = Geo("cupola.base")
    Mb = Matrix(((1, 0, 0, 0), (0, 0, 1, A_BASE), (0, -1, 0, 0), (0, 0, 0, 1)))
    Rb = R_BASE / math.cos(math.radians(30))
    br.lathe(Mb, [(Rb * 0.93, 0.0), (Rb * 0.93, 0.06), (Rb * 0.99, 0.06), (Rb * 0.99, 0.10), (Rb * 1.05, 0.12), (Rb * 1.05, -0.05)], 'alu_frame', seg=72)
    # LED strip on the ring, facing up the dome
    for c in range(6):
        a = math.radians(60 * c)
        br.lathe(Mb, [(Rb * 0.945, 0.061), (Rb * 0.975, 0.061)], 'led', seg=24, a0=a - math.radians(18), a1=a + math.radians(18), closed=False)
    ob = br.build(col, lib, smooth_angle=40)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='base')

    # ---------------- panels, velcro and placards below the windows -------
    pn = Geo("cupola.panels")
    for k in range(6):
        F = facet(k)
        t0, t1 = WIN_T1 + 0.09, 0.97
        w0, w1 = F['half'](t0) - 0.07, F['half'](t1) - 0.07
        pts = [fpt(F, t0, -w0), fpt(F, t0, w0), fpt(F, t1, w1), fpt(F, t1, -w1)]
        off = F['n'] * 0.008
        pn.poly([p + off for p in pts], 'paint_panel')
        # panel fasteners
        for p in pts:
            q = p.lerp(sum(pts, Vector()) / 4, 0.06)
            pn.bolt(Matrix.Identity(4), q + off, F['n'], 'steel', head=0.006, height=0.003, washer=False)
        # velcro squares where the crew stick things
        for v in range(r.randint(2, 4)):
            tc = r.uniform(t0 + 0.05, t1 - 0.12)
            wc = r.uniform(-F['half'](tc) * 0.6, F['half'](tc) * 0.6)
            sz = r.choice((0.04, 0.05, 0.06, 0.08))
            ar = r.uniform(0.6, 1.8)
            c = fpt(F, tc, wc) + F['n'] * 0.0105
            a1, a2 = F['lat'] * (sz * ar / 2), F['s'] * (sz / 2)
            pn.poly([c - a1 - a2, c + a1 - a2, c + a1 + a2, c - a1 + a2], r.choice(('velcro', 'velcro', 'velcro_grey')))
        # window number placard at the frame's lower-left corner
        wc = window_corners(F, -0.07)
        c = wc[3].lerp(wc[2], 0.18) + F['s'] * 0.03 + F['n'] * 0.0105
        a1, a2 = F['lat'] * 0.035, F['s'] * 0.018
        pn.poly([c - a1 - a2, c + a1 - a2, c + a1 + a2, c - a1 + a2], 'label')
    ob = pn.build(col, lib)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='panels')

    # ---------------- shutter cranks ---------------------------------------
    ck = Geo("cupola.cranks")
    for k in range(6):
        F = facet(k)
        wc = window_corners(F, -0.08)
        # on the rib side of the window's lower-right corner
        p = wc[2].lerp(wc[1], 0.25) + F['n'] * 0.01
        M = bl.frame(p, F['lat'], F['s'], F['n'])
        ck.box(M, (0.07, 0.09, 0.035), 'alu_frame', center=(0, 0, 0.0175), bevel=0.005)
        ck.box(M, (0.071, 0.02, 0.036), 'label_yellow', center=(0, -0.035, 0.0176))
        ck.cyl(M, (0, 0.015, 0.035), (0, 0.015, 0.05), 0.012, 'steel', seg=16)
        ang = r.uniform(0, 2 * math.pi)
        arm_end = Vector((math.cos(ang) * 0.055, 0.015 + math.sin(ang) * 0.055, 0.052))
        ck.tube(M, [(0, 0.015, 0.052), tuple(arm_end)], 0.006, 'steel', seg=8)
        ck.cyl(M, tuple(arm_end), tuple(arm_end + Vector((0, 0, 0.035))), 0.009, 'plastic_black', seg=12)
    ob = ck.build(col, lib)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='cranks')

    # ---------------- handrails -------------------------------------------
    hr = Geo("cupola.handrails")
    for k, (ta, tb) in {3: (0.64, 0.64), 0: (0.66, 0.66), 4: (0.75, 0.75), 5: (0.72, 0.72), 1: (0.8, 0.8), 2: (0.8, 0.8)}.items():
        F = facet(k)
        span = F['half'](ta) * 0.62
        a = fpt(F, ta, -span) + F['n'] * 0.075
        b = fpt(F, tb, span) + F['n'] * 0.075
        pts = [a + (b - a) * (i / 12) for i in range(13)]
        hr.tube(Matrix.Identity(4), pts, 0.0135, 'handrail', seg=14)
        for end in (a, b):
            foot = end - F['n'] * 0.068
            hr.tube(Matrix.Identity(4), [end, foot], 0.010, 'handrail', seg=10)
            M = bl.frame(foot, F['lat'], F['s'], F['n'])
            hr.box(M, (0.05, 0.05, 0.01), 'handrail', center=(0, 0, 0.0), bevel=0.003)
            for dx in (-0.017, 0.017):
                hr.bolt(M, (dx, 0.0, 0.005), (0, 0, 1), 'steel', head=0.004, height=0.003, washer=False)
    ob = hr.build(col, lib, smooth_angle=50)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='handrails')

    # ---------------- the laptop on its arm -------------------------------
    lp = laptop(lib, col, P)
    out['laptop'] = lp

    # ---------------- cable runs ------------------------------------------
    cables(lib, col, P, r)

    # ---------------- panes -----------------------------------------------
    for k in range(6):
        F = facet(k)
        n = FACET_PANE[k]
        out['panes'][n] = side_pane(lib, col, P, F, n)
    out['panes'][0] = centre_pane(lib, col, P)


    # ---------------- floating things --------------------------------------
    out['floats'] = floats(lib, col, P)
    return out


# ---------------------------------------------------------------------------

def node_room(lib, col):
    """The node module behind the player: never seen (it is behind the
    camera) and never exported, but it is what lights the faces of the
    frame that look back at the eye - its white walls and LED panels bounce
    light up into the cupola, as they do on the real station."""
    P = pitch_matrix()
    g = Geo("room.node")
    R = 2.25
    # a cylinder across the view (axis along x), its wall tangent to the
    # cupola's base ring
    cy = A_BASE - 0.02 - R
    M = bl.frame((-3.5, cy, 0.0), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)))
    seg = 24
    ang0 = math.radians(18)          # leave the port for the cupola open
    for i in range(seg):
        a0 = ang0 + (2 * math.pi - 2 * ang0) * i / seg
        a1 = ang0 + (2 * math.pi - 2 * ang0) * (i + 1) / seg
        mat = 'led_room' if i in (5, 17) else 'paint_panel'
        g.lathe(M, [(R, 0.0), (R, 7.0)], mat, seg=1, a0=a0, a1=a1, closed=False)
    ob = g.build(col, lib)
    ob.matrix_world = P
    bl.tag(ob, export=0, part='room')
    return ob


def side_pane(lib, col, P, F, n):
    """A side window's glass: a flat trapezoid in the reveal, its own mesh
    (pane.n) with its origin at the pane's centre. UVs are planar in the
    glass, scaled by the pane's largest extent so texels are square, (0.5,
    0.5) at the centre, U along the pane's width (counter-clockwise round the dome
    as the player sees it), V from the outer edge (0) toward the centre
    window (1): a crack texture is never stretched."""
    c = [p - F['n'] * GLASS_IN for p in window_corners(F, -0.004)]
    centre = sum(c, Vector()) / 4
    lat, s = F['lat'], F['s']
    ext_u = max(abs((p - centre).dot(lat)) for p in c)
    ext_v = max(abs((p - centre).dot(s)) for p in c)
    size = 2 * max(ext_u, ext_v)
    uv = [(0.5 + (p - centre).dot(lat) / size, 0.5 - (p - centre).dot(s) / size) for p in c]
    g = Geo(f"pane.{n}")
    local = [p - centre for p in c]
    g.poly(local, 'glass', uv=uv, rand=0.5)
    ob = g.build(col, lib)
    ob.matrix_world = P @ Matrix.Translation(centre)
    bl.tag(ob, pane=n, surface='glass', label=PANE_LABEL[n], size_m=round(size, 4))
    return ob


def centre_pane(lib, col, P):
    g = Geo("pane.center")
    N = 64
    R = R_CW + 0.003
    pts = [Vector((R * math.cos(2 * math.pi * i / N), 0.0, R * math.sin(2 * math.pi * i / N))) for i in range(N)]
    uv = [(0.5 + p.x / (2 * R), 0.5 + p.z / (2 * R)) for p in pts]
    g.poly(pts[::-1], 'glass', uv=uv[::-1], rand=0.5)
    ob = g.build(col, lib)
    ob.matrix_world = P @ Matrix.Translation(AX * (A_TOP + GLASS_IN))
    bl.tag(ob, pane=0, surface='glass', label=PANE_LABEL[0], size_m=round(2 * R, 4))
    return ob


def shutter(lib, col, P, F, n):
    """The outer shutter of a side window, folded open against the dome's
    skin below the window. Its origin is on the hinge (the window's outer
    edge) and its local X runs along the hinge: closing it is a rotation
    about X (see README)."""
    wc = window_corners(F, -0.06)
    hinge_a, hinge_b = wc[3] - F['n'] * SHELL, wc[2] - F['n'] * SHELL
    mid = (hinge_a + hinge_b) / 2
    w = (hinge_b - hinge_a).length
    h = (wc[3] - wc[0]).length
    g = Geo(f"shutter.{n}")
    x = (hinge_b - hinge_a).normalized()
    # open: the panel lies along +s (down the facet), outside the skin
    y = F['s']
    z = -F['n']
    M = bl.frame((0, 0, 0), x, y, z)
    g.box(M, (w, h * 0.96, 0.022), 'white_paint', center=(0, h * 0.5, 0.02), bevel=0.004)
    g.box(M, (w * 0.8, h * 0.7, 0.01), 'beta_cloth', center=(0, h * 0.5, 0.034))
    g.cyl(M, (-w / 2, 0, 0.01), (w / 2, 0, 0.01), 0.012, 'alu_bare', seg=10)
    ob = g.build(col, lib)
    ob.matrix_world = P @ Matrix.Translation(mid)
    bl.tag(ob, pane=n, surface='metal', hinge_axis="x", closed_angle_deg=180.0)
    return ob


def centre_shutter(lib, col, P):
    g = Geo("shutter.0")
    R = R_CW + 0.12
    hinge = Vector((R_CW + 0.02, A_TOP + SHELL + 0.006, 0.0))
    # folded back: the disc stands out along the axis beside the window
    pts = [(R * 0.98 * math.cos(2 * math.pi * i / 40), R * 0.98 * math.sin(2 * math.pi * i / 40)) for i in range(40)]
    # open, the disc lies folded back on the top plate's outer skin to the
    # right of the window: sheet (X, Y, Z) -> cupola (x, z, y)
    g.sheet(Matrix(((1, 0, 0, R * 0.98), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1))), pts, 0.022, 'white_paint')
    ob = g.build(col, lib)
    ob.matrix_world = P @ Matrix.Translation(hinge)
    bl.tag(ob, pane=0, surface='metal', hinge_axis="z", closed_angle_deg=180.0)
    return ob


def laptop(lib, col, P):
    """A station laptop on an articulated arm, clamped to the lower-right
    rib, its screen turned toward the player."""
    g = Geo("cupola.laptop")
    F = facet(5)                               # lower-right facet
    base = fpt(F, 0.80, F['half'](0.8) * 0.72) + F['n'] * 0.012
    # arm: clamp, two links, a ball joint, the tray
    j1 = base + F['n'] * 0.09
    j2 = j1 + F['n'] * 0.12 + Vector((-0.10, -0.05, 0.10))
    j3 = j2 + Vector((-0.14, -0.02, 0.07))
    I = Matrix.Identity(4)
    Mb = bl.frame(base, F['lat'], F['s'], F['n'])
    g.box(Mb, (0.07, 0.07, 0.03), 'alu_frame', center=(0, 0, 0.0), bevel=0.004)
    g.tube(I, [base, j1], 0.016, 'alu_frame', seg=14)
    g.tube(I, [j1, j2], 0.014, 'alu_frame', seg=14)
    g.tube(I, [j2, j3], 0.013, 'alu_frame', seg=14)
    for j in (j1, j2):
        g.cyl(I, j - Vector((0.024, 0, 0)), j + Vector((0.024, 0, 0)), 0.022, 'plastic_black', seg=18)
    # the laptop: base facing the eye-ish, screen raised
    eye_dir = (-j3).normalized()
    up = Vector((0, 0, 1))
    right = eye_dir.cross(up).normalized()
    upv = right.cross(eye_dir).normalized()
    # tray plane: tilted toward the eye
    tray_n = (upv * 0.6 + eye_dir * 0.8).normalized()
    tray_y = tray_n.cross(right).normalized()                  # away from the viewer on the tray
    Mt = bl.frame(j3 + tray_n * 0.02, right, tray_y, tray_n)
    W, D = 0.34, 0.24
    g.box(Mt, (W + 0.02, D + 0.02, 0.012), 'alu_frame', center=(0, 0, -0.006), bevel=0.003)
    g.box(Mt, (W, D, 0.022), 'plastic_black', center=(0, 0, 0.011), bevel=0.006)
    # keyboard and touchpad
    for row in range(5):
        for colk in range(13):
            kx = -W / 2 + 0.03 + colk * (W - 0.06) / 12
            ky = -D / 2 + 0.105 + row * 0.022
            g.box(Mt, (0.018, 0.016, 0.004), 'plastic_grey' if (row + colk) % 7 else 'plastic_black', center=(kx, ky, 0.023))
    g.box(Mt, (0.09, 0.055, 0.002), 'plastic_grey', center=(0, -D / 2 + 0.05, 0.0225))
    # screen hinged at the back edge, opened ~105 degrees
    hinge = Vector((0, D / 2, 0.022))
    ang = math.radians(105)
    sy = Vector((0, -math.cos(ang), math.sin(ang)))
    sz = Vector((0, math.sin(ang), math.cos(ang)))
    Ms = Mt @ bl.frame(hinge, Vector((1, 0, 0)), sy, sz)
    g.box(Ms, (W, 0.225, 0.012), 'plastic_black', center=(0, 0.1125, 0.006), bevel=0.004)
    # the display: a quad with 0..1 UVs for the UI
    sw, sh = W - 0.03, 0.19
    c = (0, 0.1125, 0.0125)
    pts = [(c[0] - sw / 2, c[1] - sh / 2, c[2]), (c[0] + sw / 2, c[1] - sh / 2, c[2]),
           (c[0] + sw / 2, c[1] + sh / 2, c[2]), (c[0] - sw / 2, c[1] + sh / 2, c[2])]
    g.poly(pts, 'screen', M=Ms, uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
    # a status LED
    g.box(Mt, (0.006, 0.004, 0.002), 'led_green', center=(W / 2 - 0.02, -D / 2 + 0.01, 0.0225))
    ob = g.build(col, lib)
    ob.matrix_world = P
    bl.tag(ob, surface='metal', part='laptop')
    return ob


def cables(lib, col, P, r):
    """Cable runs: from the laptop down its arm to a connector box on the
    rib, and bundles in clips along the lower-left and left facets."""
    g = Geo("cupola.cables")
    I = Matrix.Identity(4)
    # bundle along the lower-left facet's lower region, clipped every ~12 cm
    for k, tt, cols in ((4, 0.70, ('cable_black', 'cable_grey', 'cable_orange')),
                        (3, 0.76, ('cable_black', 'cable_blue', 'cable_white')),
                        (5, 0.92, ('cable_black', 'cable_grey')),
                        (0, 0.86, ('cable_yellow', 'cable_black'))):
        F = facet(k)
        span = F['half'](tt) * 0.9
        for ci, cm in enumerate(cols):
            off = (ci - (len(cols) - 1) / 2) * 0.013
            pts = []
            for i in range(25):
                w = -span + 2 * span * i / 24
                sag = 0.012 * math.sin(i / 24 * math.pi * 3 + ci) * (i % 6 != 0)
                p = fpt(F, tt + off / F['L'], w) + F['n'] * (0.03 + sag + 0.004 * ci)
                pts.append(p)
            g.tube(I, pts, 0.0055, cm, seg=8)
        for i in range(0, 25, 6):
            w = -span + 2 * span * i / 24
            p = fpt(F, tt, w) + F['n'] * 0.012
            M = bl.frame(p, F['lat'], F['s'], F['n'])
            g.box(M, (0.018, 0.06, 0.04), 'plastic_black', center=(0, 0, 0.02), bevel=0.003)
    # connector box with a few plugs on the lower-right facet
    F = facet(5)
    p = fpt(F, 0.9, -F['half'](0.9) * 0.3) + F['n'] * 0.01
    M = bl.frame(p, F['lat'], F['s'], F['n'])
    g.box(M, (0.16, 0.08, 0.04), 'alu_frame', center=(0, 0, 0.02), bevel=0.004)
    g.box(M, (0.161, 0.012, 0.041), 'label_yellow', center=(0, 0.035, 0.0205))
    for i in range(4):
        g.cyl(M, (-0.06 + i * 0.04, 0, 0.04), (-0.06 + i * 0.04, 0, 0.065), 0.011, 'steel' if i % 2 else 'plastic_black', seg=12)
    ob = g.build(col, lib, smooth_angle=60)
    ob.matrix_world = P
    bl.tag(ob, surface='cloth', part='cables')


def floats(lib, col, P):
    """Things adrift on tethers: a camera, a pen, a checklist card and a
    small plush planet. Each is its own object (float.<n>) with its origin
    on the tether's anchor, so the game can bob and sway it about there."""
    out = []
    I = Matrix.Identity(4)
    items = [
        # (facet, t, lateral fraction, what, offset from anchor (cupola frame))
        (3, 0.60, 0.35, 'camera', Vector((0.10, -0.26, 0.10))),
        (1, 0.62, -0.45, 'pen', Vector((-0.06, -0.20, -0.10))),
        (0, 0.60, 0.50, 'card', Vector((-0.08, -0.22, 0.04))),
        (2, 0.66, 0.30, 'plush', Vector((0.09, -0.24, -0.08))),
    ]
    for i, (k, t, wf, what, off) in enumerate(items, 1):
        F = facet(k)
        anchor = fpt(F, t, F['half'](t) * wf) + F['n'] * 0.012
        g = Geo(f"float.{i}")
        obj_c = off
        # tether: a slack cord from the anchor to the object
        mid = obj_c * 0.5 + Vector((0, 0, -0.03))
        cord = [Vector((0, 0, 0)).lerp(mid, a / 5) for a in range(6)] + [mid.lerp(obj_c, a / 5) for a in range(1, 6)]
        g.tube(I, cord, 0.0018, 'cable_white', seg=6, caps=False)
        Ma = bl.frame((0, 0, 0), F['lat'], F['s'], F['n'])
        g.box(Ma, (0.03, 0.03, 0.006), 'velcro_grey', center=(0, 0, -0.006))
        if what == 'camera':
            M = bl.look_matrix(obj_c, Vector((0.3, 1.0, -0.2)), (0, 0, 1))
            g.box(M, (0.14, 0.08, 0.10), 'plastic_black', center=(0, 0, 0), bevel=0.012)
            g.box(M, (0.05, 0.05, 0.03), 'plastic_black', center=(0.045, -0.01, 0.055), bevel=0.008)
            g.cyl(M, (0, 0.04, 0), (0, 0.18, 0), 0.042, 'plastic_black', seg=24)
            g.cyl(M, (0, 0.18, 0), (0, 0.20, 0), 0.046, 'rubber', seg=24)
            g.cyl(M, (0, 0.20, 0), (0, 0.205, 0), 0.036, 'glass', seg=24, caps=(False, True))
            g.cyl(M, (0, 0.09, 0), (0, 0.12, 0), 0.0435, 'rubber', seg=24, caps=(False, False))
            g.box(M, (0.03, 0.01, 0.03), 'label', center=(-0.05, -0.041, 0.02))
        elif what == 'pen':
            M = bl.look_matrix(obj_c, Vector((0.6, 0.2, 0.7)), (0, 0, 1))
            g.cyl(M, (0, -0.07, 0), (0, 0.06, 0), 0.0055, 'cable_blue', seg=10)
            g.cyl(M, (0, 0.06, 0), (0, 0.075, 0), 0.0055, 'steel', seg=10, r1=0.0015)
            g.box(M, (0.002, 0.04, 0.006), 'steel', center=(0.006, -0.045, 0))
        elif what == 'card':
            M = bl.look_matrix(obj_c, Vector((0.4, 1.0, 0.1)), (0, 0, 1))
            g.box(M, (0.12, 0.002, 0.16), 'label', center=(0, 0, 0))
            g.cyl(M, (-0.045, -0.004, 0.07), (-0.045, 0.004, 0.07), 0.01, 'steel', seg=12, caps=(False, False))
        elif what == 'plush':
            from mathutils import Vector as V
            M = bl.look_matrix(obj_c, Vector((0.2, 1.0, 0.3)), (0, 0, 1))
            import bmesh
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=0.045)
            g.add_bmesh(bm, M, 'velcro', smooth=True)
            bm.free()
            g.lathe(M @ Matrix.Rotation(0.4, 4, 'X'), [(0.075, -0.004), (0.078, 0.0), (0.075, 0.004), (0.05, 0.001), (0.05, -0.001)], 'cable_orange', seg=32)
        ob = g.build(col, lib, smooth_angle=50)
        ob.matrix_world = P @ Matrix.Translation(anchor)
        bl.tag(ob, float=i, what=what, surface='cloth')
        out.append(ob)
    return out
