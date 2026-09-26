"""The wardrobe: hats, bandanas, the iron plate, and the guns and dynamite.

Hats and bandanas are fitted to the particular head they sit on (built from
the same head parameters), so a bowler never floats and a bandana follows the
nose and jaw. Guns are modelled in the grip's own frame (barrel +Y, top of the
gun +Z, the grip centred on the origin) and hang from socket.gun.
"""
import math
import numpy as np
from . import sdf as S, head as HD
from .texture import srgb, smoothstep, value_noise, fbm
from . import paint as PT

# ------------------------------------------------------------------ hats

HAT_SEAT = np.array([0.0, 0.004, 0.058])      # head-local centre of the hatband


def _ellipse_dist(x, y, a, b):
    """Approximate signed distance from (x, y) to an ellipse (a, b)."""
    k0 = np.sqrt((x / a) ** 2 + (y / b) ** 2)
    k1 = np.sqrt((x / a ** 2) ** 2 + (y / b ** 2) ** 2)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def brim(a, b, width, thick=0.0055, curl=0.0, dip=0.0, droop=0.0, roll=0.0, back_up=0.0):
    """A hat brim around an ellipse (a, b): `curl` lifts the sides, `dip` pulls
    the front down, `droop` sags it all (a soft hat), `roll` rolls the edge."""
    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        e = _ellipse_dist(x, y, a, b)
        u = np.clip(e / width, 0, 1.2)
        th = np.arctan2(x, -y)
        side = np.sin(th) ** 2
        front = np.clip(np.cos(th), 0, 1) ** 2
        back = np.clip(-np.cos(th), 0, 1) ** 2
        h = curl * u ** 2 * side - dip * u ** 2 * front - droop * u ** 1.5 + back_up * u ** 2 * back + roll * u ** 8
        d = np.maximum(np.abs(z - h) - thick * 0.5, e - width)
        d = np.maximum(d, -e - 0.02)
        return d.astype(np.float32)
    m = max(a, b) + width + 0.02
    return S.Fn(f, (-m, -m, -0.08), (m, m, 0.08))


def crown(a, b, h, taper=0.9, top="round", crease=0.0, pinch=0.0, dent_back=0.0, flare=1.0):
    """A felt crown: elliptical sections from inside the head up to h."""
    zs = [-0.02, 0.0, h * 0.35, h * 0.7, h * 0.92]
    tp = [1.0, 1.0, 1.0 - 0.3 * (1 - taper), 1.0 - 0.7 * (1 - taper), taper]
    if flare != 1.0:
        tp = [1.0, 1.0, 1.0 + 0.3 * (flare - 1), 1.0 + 0.7 * (flare - 1), flare]
    body = S.Tube([(0, 0, z) for z in zs], [a * t for t in tp], [b * t for t in tp])
    if top == "round":
        cap = S.Ellipsoid((0, 0, h * 0.82), (a * taper, b * taper, h * 0.24))
    elif top == "dome":
        cap = S.Ellipsoid((0, 0, h * 0.35), (a * 1.0, b * 1.0, h * 0.68))
    else:  # flat
        cap = S.Cylinder((0, 0, h * 0.9), max(a, b) * taper, h * 0.1, None, rad=0.008)
        cap = S.Ellipsoid((0, 0, h * 0.86), (a * taper, b * taper, h * 0.16))
    c = S.Union([body, cap], k=0.01)
    c = S.Intersect(c, S.Plane((0, 0, h), (0, 0, 1), (-1, -1, -1), (1, 1, 1)), k=0.008)
    if crease:
        # the cattleman crease: a broad groove front to back, deeper at the front
        c = S.Subtract(c, S.Ellipsoid((0, 0.006, h + 0.006), (0.021, b * 0.82, crease)), k=0.014)
    if pinch:
        # the two front pinches where a hand takes the hat off
        for s in (1, -1):
            c = S.Subtract(c, S.Ellipsoid((s * a * 0.98, -b * 0.52, h * 0.74), (0.020, 0.034, 0.042), S.rot_z(s * 25)), k=0.012 * pinch)
    if dent_back:
        c = S.Subtract(c, S.Ellipsoid((0, b * 1.02, h * 0.8), (0.03, 0.018, 0.03)), k=0.01)
    return c


HATS = {
    # crown height, crown top taper, top style, crease depth, pinch, brim width, curl, dip, roll, back_up, flare
    "stetson": dict(h=0.106, taper=0.86, top="round", crease=0.022, pinch=1.0, w=0.080, curl=0.030, dip=0.012, roll=0.0, back=0.010,
                    col=(0.23, 0.17, 0.12), band=(0.10, 0.07, 0.05), mat="felt", band_h=0.022),
    "boss": dict(h=0.116, taper=0.82, top="round", crease=0.028, pinch=1.4, w=0.086, curl=0.036, dip=0.016, roll=0.0, back=0.012,
                 col=(0.055, 0.05, 0.05), band=(0.62, 0.62, 0.62), mat="felt", band_h=0.024),
    "bowler": dict(h=0.098, taper=1.0, top="dome", crease=0.0, pinch=0.0, w=0.040, curl=0.020, dip=0.004, roll=0.004, back=0.0,
                   col=(0.09, 0.085, 0.08), band=(0.05, 0.05, 0.05), mat="felt", band_h=0.016),
    "flat": dict(h=0.084, taper=0.95, top="flat", crease=0.0, pinch=0.0, w=0.082, curl=0.004, dip=0.003, roll=0.0, back=0.0,
                 col=(0.13, 0.11, 0.095), band=(0.06, 0.05, 0.045), mat="felt", band_h=0.020),
    "top": dict(h=0.180, taper=1.06, top="flat", crease=0.0, pinch=0.0, w=0.046, curl=0.024, dip=0.006, roll=0.0, back=0.0,
                col=(0.035, 0.033, 0.033), band=(0.02, 0.02, 0.02), mat="silk", band_h=0.03),
    "straw": dict(h=0.078, taper=0.95, top="flat", crease=0.0, pinch=0.0, w=0.090, curl=0.006, dip=0.008, roll=0.0, back=0.0,
                  col=(0.72, 0.60, 0.38), band=(0.25, 0.10, 0.07), mat="straw", band_h=0.018),
}
HAT_A, HAT_B = 0.081, 0.101


def hat_field(kind):
    """(field in hat frame, band height, colour, band colour, material kind)."""
    k = HATS[kind]
    A, B = HAT_A, HAT_B
    c = crown(A, B, k["h"], min(k["taper"], 1.0), k["top"], crease=k["crease"], pinch=k["pinch"],
              dent_back=1 if kind == "boss" else 0, flare=k["taper"] if k["taper"] > 1 else 1.0)
    b = brim(A - 0.004, B - 0.004, k["w"], curl=k["curl"], dip=k["dip"], roll=k["roll"], back_up=k["back"])
    f = S.Union([c, b], k=0.006)
    return f, k["band_h"], k["col"], k["band"], k["mat"]


def hat_mesh(kind, name, coll=None, n=26):
    """A clean game mesh for a hat, built as rings and snapped onto its field:
    the crown from inside the band to the top, then the brim - top face out
    to a rolled edge and bottom face back in - so a thin brim never tears the
    way a decimated one does, and a dome stays round."""
    from . import rings as R, bl
    k = HATS[kind]
    f, *_ = hat_field(kind)
    A, B = HAT_A, HAT_B
    rm = R.RingMesh()
    th = 2 * np.pi * np.arange(n) / n

    def ring(a, b, z, relax=0.0):
        pts = np.stack([a * np.sin(th), -b * np.cos(th), np.full(n, z)], 1)
        return rm.ring(pts, relax=relax)
    h = k["h"]
    crown_z = [-0.012, 0.0, 0.25 * h, 0.55 * h, 0.8 * h, 0.95 * h]
    if k["top"] == "dome":
        crown_z = [-0.012, 0.0, 0.2 * h, 0.45 * h, 0.65 * h, 0.82 * h, 0.94 * h]
    rings = []
    for z in crown_z:
        t = np.clip(z / h, 0, 1)
        sc = 1 + (k["taper"] - 1) * t
        if k["top"] == "dome":
            sc = np.sqrt(max(1 - max(t - 0.3, 0) ** 2 / 0.7 ** 2, 0.05))
        rings.append(ring(A * sc + 0.002, B * sc + 0.002, z, 0.3))
    # rings across the top so a crease or a dent has somewhere to live
    if k["top"] != "dome":
        for sc_ in (0.72, 0.42):
            rings.append(ring(A * k["taper"] * sc_, B * k["taper"] * sc_, h + 0.004, 0.3))
    top = rm.add((0, 0, h + 0.004), relax=0.3)
    # brim: top face outward, a rolled edge, the underside back in
    w = k["w"]
    brim_top = []
    for u in (0.3, 0.65, 1.0):
        a, b = A - 0.004 + w * u, B - 0.004 + w * u
        e = u
        zz = k["curl"] * e * e * np.sin(th) ** 2 - k["dip"] * e * e * np.clip(np.cos(th), 0, 1) ** 2 + k["back"] * e * e * np.clip(-np.cos(th), 0, 1) ** 2 + k["roll"] * e ** 8
        pts = np.stack([a * np.sin(th), -b * np.cos(th), zz + 0.003], 1)
        brim_top.append(rm.ring(pts))
    edge = rm.ring(np.array([rm.V[i] for i in brim_top[-1]]) * np.array([1.012, 1.012, 1.0]) - np.array([0, 0, 0.003]))
    brim_bot = []
    for u in (1.0, 0.55, 0.12):
        a, b = A - 0.004 + w * u, B - 0.004 + w * u
        e = u
        zz = k["curl"] * e * e * np.sin(th) ** 2 - k["dip"] * e * e * np.clip(np.cos(th), 0, 1) ** 2 + k["back"] * e * e * np.clip(-np.cos(th), 0, 1) ** 2 + k["roll"] * e ** 8
        pts = np.stack([a * np.sin(th), -b * np.cos(th), zz - 0.003], 1)
        brim_bot.append(rm.ring(pts))
    ua = np.linspace(0, 1, n + 1)
    seq = [rings[0]] * 0
    # crown faces (outward)
    for i in range(len(rings) - 1):
        rm.bridge(rings[i + 1], rings[i], i + 1, i, "crown", ua=ua)
    for j in range(n):
        j2 = (j + 1) % n
        rm.face((rings[-1][j], rings[-1][j2], top), [(ua[j], 9), (ua[j + 1], 9), (ua[j] + 0.5 / n, 10)], "crown")
    # brim: from the crown's band ring outward on top, round the edge, back underneath
    chain = [rings[1]] + brim_top + [edge] + brim_bot + [rings[0]]
    for i in range(len(chain) - 1):
        rm.bridge(chain[i], chain[i + 1], i, i + 1, "brim", ua=ua)
    V = np.array(rm.V, np.float32)
    V = S.project_to_surface(f, V, iters=8, clamp=0.006)
    rm.V = list(V.astype(np.float64))
    ob = R.to_blender(rm, name, coll)
    return ob, f


def hat_mesh_orient(ob):
    """Crown and brim faces must point out of the felt: flip any face whose
    normal points into the field."""
    return ob


def bonnet_field():
    """A cotton bonnet in the head's own frame: a hood over the crown and the
    bun, open round the face with a stiffened brim, ribbons tied under the chin."""
    hood = S.Shell(S.Ellipsoid((0, 0.022, 0.026), (0.090, 0.112, 0.100)), 0.0035)
    n = np.array([0.0, -0.88, 0.47])
    n /= np.linalg.norm(n)
    opening = S.Plane((0, -0.040, 0.010), n, (-0.2, -0.2, -0.2), (0.2, 0.2, 0.2))
    nape = S.Plane((0, 0.0, -0.055), (0, 0, -1), (-0.2, -0.2, -0.2), (0.2, 0.2, 0.2))
    hood = S.Intersect(S.Intersect(hood, opening, k=0.004), nape, k=0.004)
    R = np.stack([np.array([1.0, 0, 0]), np.cross(n, [1.0, 0, 0]), n], 1)
    brim = S.Torus((0, -0.052, 0.020), 0.094, 0.011, R)
    brim = S.Intersect(brim, S.Plane((0, 0.0, -0.035), (0, 0, -1), (-0.2, -0.2, -0.2), (0.2, 0.2, 0.2)), k=0.004)
    ribbons = [S.RoundCone((s * 0.080, -0.030, -0.030), (s * 0.014, -0.070, -0.125), 0.005, 0.004) for s in (1, -1)]
    bow = [S.Ellipsoid((s * 0.016, -0.074, -0.128), (0.016, 0.006, 0.009)) for s in (1, -1)]
    tails = [S.RoundCone((s * 0.006, -0.076, -0.13), (s * 0.014, -0.078, -0.19), 0.004, 0.003) for s in (1, -1)]
    return S.Union([hood, brim] + ribbons + bow + tails, k=0.004)


def bonnet_paint(P):
    c, r, m = PT.fabric(P + 7.0, (0.86, 0.82, 0.72), "cotton", dust_amt=0.0, fade=0.1, seed=131)
    rib = (P[:, 2] < -0.035)
    c[rib] = srgb(0.46, 0.22, 0.26)
    return c, r, m


def hat_frame(tilt=5.0):
    """(M, o) of the hat frame in world space: seated on the head, tipped forward."""
    R = np.array(S.rot_x(tilt), float)      # columns: hat axes in world (tipped forward)
    o = HD.HEAD_ORIGIN + HAT_SEAT
    return R, o


def hat_paint(kind):
    f, band_h, col, band_col, mat = hat_field(kind)

    def paint(P):
        n = len(P)
        if mat == "straw":
            weave = np.abs(np.sin(np.arctan2(P[:, 0], -P[:, 1]) * 90 + P[:, 2] * 400)) ** 0.5
            c = np.tile(srgb(*col), (n, 1)) * (0.8 + 0.25 * weave[:, None])
            r = np.full(n, 0.7)
        else:
            c, r, _ = PT.fabric(P + 3.0, col, "wool", dust_amt=0.0, fade=0.0, seed=71)
            r = np.full(n, 0.82 if mat == "felt" else 0.42)
            # sweat stain above the band, dust on the brim top
            stain = smoothstep(band_h + 0.022, band_h + 0.004, P[:, 2]) * (P[:, 2] > band_h) * smoothstep(0.4, 0.7, fbm(P, 30, 2, seed=72))
            c *= (1 - 0.35 * stain)[:, None]
            dusty = (np.abs(P[:, 2]) < 0.05) * smoothstep(0.1, 0.16, np.hypot(P[:, 0], P[:, 1]))
            c = c * (1 - 0.25 * dusty[:, None]) + PT.DUST * 0.25 * dusty[:, None]
        band = (P[:, 2] > 0.0) & (P[:, 2] < band_h) & (np.hypot(P[:, 0] / 0.081, P[:, 1] / 0.101) < 1.08)
        bc = np.tile(srgb(*band_col), (n, 1))
        c[band] = bc[band]
        m = np.zeros(n)
        if kind == "boss":
            # silver conchos around the band
            th = np.arctan2(P[:, 0], -P[:, 1])
            con = band & (np.cos(th * 8) > 0.6)
            c[con] = srgb(0.75, 0.74, 0.70)
            m[con] = 1.0
            r[con] = 0.3
            c[band & ~con] = srgb(0.08, 0.07, 0.06)
        return c, r, m
    return paint


# ------------------------------------------------------------------ bandanas

def bandana_field(p):
    """A kerchief pulled up over nose and mouth, knotted behind the head: the
    face shell below the nose bridge, a drape that falls from the nose over
    the chin like a curtain, a point at the throat, a knot and two tails."""
    face = HD.head_sdf(p, low=True)
    shell = S.Offset(face, 0.0035)
    drape = S.Union([S.Ellipsoid((0, -0.080, -0.088), (0.070, 0.042, 0.080)),
                     S.Ellipsoid((0, -0.064, -0.150), (0.060, 0.045, 0.050))], k=0.02)
    cloth = S.Union([shell, drape], k=0.022)

    def edges(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        th = np.abs(np.arctan2(x, -(y - 0.005)))
        top = -0.004 - 0.040 * smoothstep(0.3, 1.9, th) - 0.012 * smoothstep(2.0, 3.1, th)
        # the hem: a point low at the throat, rising round the sides, tied off behind
        hem = -0.195 + 0.075 * smoothstep(0.0, 1.2, th) + 0.02 * smoothstep(1.5, 3.1, th)
        return np.maximum(z - top, hem - z).astype(np.float32)
    band = S.Intersect(cloth, S.Fn(edges, (-0.2, -0.2, -0.3), (0.2, 0.2, 0.1)), k=0.003)
    knot = S.Union([S.Ellipsoid((0, 0.098, -0.045), (0.016, 0.013, 0.012)),
                    S.RoundCone((0.004, 0.100, -0.052), (0.016, 0.084, -0.110), 0.008, 0.004),
                    S.RoundCone((-0.004, 0.100, -0.052), (-0.013, 0.082, -0.104), 0.007, 0.004)], k=0.006)
    b = S.Union([band, knot], k=0.008)

    def folds(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        r = np.hypot(x, z + 0.03)
        ang = np.arctan2(z + 0.03, x)
        # folds radiate from where the cloth hangs off the nose
        return (-0.0016 * np.sin(ang * 9 + 3 * value_noise(P, 40, seed=81)) ** 2 * smoothstep(0.03, 0.08, r)).astype(np.float32)
    return S.Displace(b, folds, 0.002)


def bandana_paint(color, pattern=True):
    def paint(P):
        c, r, m = PT.fabric(P + 5.0, color, "cotton", dust_amt=0.0, fade=0.2, seed=82)
        if pattern:
            # a faded print: small pale motifs, washed into the cloth
            dots = smoothstep(0.80, 0.86, value_noise(P, 420, seed=83)) * (0.6 + 0.4 * value_noise(P, 60, seed=84))
            c = c * (1 - 0.22 * dots[:, None]) + (c * 0.5 + srgb(0.80, 0.74, 0.62) * 0.5) * 0.22 * dots[:, None]
        # damp and darker round the mouth
        breath = np.exp(-((P[:, 0] / 0.03) ** 2 + ((P[:, 2] + 0.066) / 0.025) ** 2))
        c *= (1 - 0.2 * breath)[:, None]
        return c, r, m
    return paint


# ------------------------------------------------------------------ iron

def armour_field():
    """A plate of boiler iron over the chest, riveted, on leather straps."""
    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # a curved plate: part of a cylinder-ish shell in front of the chest
        cy = 0.12
        R = 0.235
        rr = np.hypot(x, (y - cy) / 1.0)
        shell = np.abs(rr - R) - 0.004
        box = np.maximum(np.abs(x) - 0.150, np.maximum(np.abs(z - 1.30) - 0.155, y - (cy - 0.14)))
        # clip the top corners into shoulders
        corner = (np.abs(x) - 0.11) + (z - 1.40)
        d = np.maximum(shell, np.maximum(box, corner - 0.04))
        return d.astype(np.float32)
    plate = S.Fn(f, (-0.17, -0.14, 1.12), (0.17, 0.0, 1.48))
    rivets = []
    for zz in (1.17, 1.43):
        for xx in (-0.12, -0.04, 0.04, 0.12):
            yy = 0.12 - math.sqrt(max(0.235 ** 2 - xx ** 2, 0)) - 0.004
            if zz > 1.40 and abs(xx) > 0.11:
                continue
            rivets.append(S.Sphere((xx, yy, zz), 0.006))
    straps = []
    for s in (1, -1):
        straps.append(S.Box((s * 0.085, 0.01, 1.47), (0.018, 0.12, 0.006), S.rot_x(-8), rad=0.002))
    return S.Union([plate] + rivets + straps, k=0.002)


def armour_paint(P):
    c, r, m = PT.metal(P, (0.26, 0.25, 0.24), 0.55, rust=0.55, seed=91)
    # hammered dents and a bright scrape where a bullet glanced
    scr = smoothstep(0.78, 0.86, value_noise(P * np.array([1, 1, 5.0]), 60, seed=92))
    c = c * (1 - scr[:, None]) + srgb(0.55, 0.55, 0.53) * scr[:, None]
    strap = P[:, 2] > 1.455
    lc, lr, lm = PT.leather(P, (0.25, 0.16, 0.09), 0.2, 0.5, seed=93)
    c[strap], r[strap], m[strap] = lc[strap], lr[strap], lm[strap]
    return c, r, m


# ------------------------------------------------------------------ guns and dynamite

def revolver_field():
    """A single-action army revolver in the grip frame: barrel along +Y above
    the fist, cylinder, frame and hammer, trigger guard, walnut grip."""
    bz = 0.047
    barrel = S.RoundCone((0, 0.050, bz), (0, 0.172, bz), 0.0068, 0.0066)
    ejector = S.RoundCone((0.004, 0.055, bz - 0.011), (0.004, 0.13, bz - 0.011), 0.0038)
    sight = S.Box((0, 0.168, bz + 0.0075), (0.0012, 0.004, 0.003))
    cyl = S.Cylinder((0, 0.030, bz - 0.004), 0.0185, 0.021, S.rot_x(90), rad=0.004)
    flutes = S.Union([S.Cylinder((0.0185 * math.cos(a), 0.030, bz - 0.004 + 0.0185 * math.sin(a)), 0.004, 0.019, S.rot_x(90)) for a in np.linspace(0, 2 * math.pi, 7)[:-1]])
    cyl = S.Subtract(cyl, flutes, k=0.002)
    frame = S.Box((0, 0.028, bz - 0.006), (0.009, 0.028, 0.017), None, rad=0.004)
    hammer = S.RoundCone((0, 0.000, bz + 0.004), (0, -0.012, bz + 0.016), 0.004, 0.003)
    guard = S.Torus((0, 0.012, 0.012), 0.013, 0.0022, S.rot_y(90))
    guard = S.Intersect(guard, S.Plane((0, 0, 0.018), (0, 0, 1), (-0.1, -0.1, -0.1), (0.1, 0.1, 0.1)))
    trigger = S.RoundCone((0, 0.010, 0.022), (0, 0.006, 0.010), 0.0022)
    grip = S.Tube([(0, -0.004, 0.030), (0, -0.012, 0.0), (0, -0.022, -0.035), (0, -0.030, -0.062)],
                  [0.0125, 0.0135, 0.0145, 0.0140], [0.0145, 0.0165, 0.0180, 0.0170], side=(1, 0, 0))
    gun = S.Union([barrel, ejector, sight, cyl, frame, hammer, guard, trigger, grip], k=0.0025)
    return gun


def revolver_paint(P):
    c, r, m = PT.metal(P, (0.13, 0.135, 0.15), 0.34, seed=101)
    # blueing worn silver at the edges of the cylinder and muzzle
    wear = smoothstep(0.6, 0.8, fbm(P, 400, 2, seed=102))
    c = c * (1 - 0.6 * wear[:, None]) + srgb(0.5, 0.5, 0.52) * 0.6 * wear[:, None]
    grip = (P[:, 2] < 0.028) & (P[:, 1] < 0.0)
    wc, wr, wm = PT.wood(P, (0.26, 0.13, 0.06), axis=(0, 0.3, 1.0), seed=103, rough=0.45)
    c[grip], r[grip], m[grip] = wc[grip], wr[grip], wm[grip]
    return c, r, m


def rifle_field():
    """A lever-action carbine gripped at the wrist of the stock: receiver in
    front of the hand, barrel and magazine tube, forend, lever loop, butt."""
    bz = 0.050
    barrel = S.RoundCone((0, 0.10, bz), (0, 0.60, bz), 0.0085, 0.0078)
    tube = S.RoundCone((0, 0.10, bz - 0.017), (0, 0.52, bz - 0.017), 0.0072)
    band = S.Cylinder((0, 0.36, bz - 0.008), 0.016, 0.006, S.rot_x(90), rad=0.002)
    fore = S.RoundCone((0, 0.105, bz - 0.012), (0, 0.33, bz - 0.010), 0.0145, 0.013)
    recv = S.Box((0, 0.060, bz - 0.006), (0.011, 0.042, 0.022), None, rad=0.004)
    lever = S.Torus((0, 0.030, -0.018), 0.022, 0.003, S.rot_y(90))
    lever = S.Intersect(lever, S.Plane((0, 0, 0.005), (0, 0, 1), (-0.1, -0.1, -0.1), (0.1, 0.1, 0.1)))
    wrist = S.Tube([(0, 0.020, 0.030), (0, -0.030, 0.018), (0, -0.08, 0.004)], [0.013, 0.014, 0.016], [0.018, 0.020, 0.024])
    butt = S.Tube([(0, -0.08, 0.004), (0, -0.18, -0.020), (0, -0.30, -0.045), (0, -0.335, -0.050)],
                  [0.016, 0.018, 0.020, 0.020], [0.024, 0.038, 0.052, 0.055])
    plate = S.Box((0, -0.338, -0.048), (0.019, 0.004, 0.056), S.rot_x(-12), rad=0.003)
    return S.Union([barrel, tube, band, fore, recv, lever, wrist, butt, plate], k=0.004)


def rifle_paint(P):
    c, r, m = PT.metal(P, (0.14, 0.14, 0.15), 0.4, rust=0.2, seed=111)
    recv = (P[:, 1] > 0.015) & (P[:, 1] < 0.105) & (P[:, 2] > bz_lo())
    bc, br, bm = PT.metal(P, (0.62, 0.48, 0.25), 0.35, seed=112)     # a brass receiver
    c[recv], r[recv], m[recv] = bc[recv], br[recv], bm[recv]
    wood = ((P[:, 1] < 0.02) | ((P[:, 1] > 0.105) & (P[:, 1] < 0.335) & (P[:, 2] < 0.046))) & ~recv
    wc, wr, wm = PT.wood(P, (0.30, 0.16, 0.07), axis=(0, 1, 0.1), seed=113, rough=0.5)
    c[wood], r[wood], m[wood] = wc[wood], wr[wood], wm[wood]
    return c, r, m


def bz_lo():
    return 0.012


def dynamite_field():
    """Three sticks bound with twine, a fuse curling from the top."""
    sticks = []
    for i, a in enumerate((0, 2.1, 4.2)):
        x, y = 0.0155 * math.cos(a), 0.0155 * math.sin(a)
        sticks.append(S.Cylinder((x, y + 0.004, 0.02), 0.0142, 0.100, None, rad=0.004))
    twine = [S.Torus((0, 0.004, z), 0.030, 0.0022) for z in (-0.04, 0.075)]
    fuse = S.Union([S.RoundCone((0, 0.004, 0.12), (0.01, -0.01, 0.16), 0.0025, 0.0022),
                    S.RoundCone((0.01, -0.01, 0.16), (0.03, -0.012, 0.18), 0.0022, 0.002)], k=0.004)
    return S.Union(sticks + twine + [fuse], k=0.002)


def dynamite_paint(P):
    n = len(P)
    c = np.tile(srgb(0.62, 0.12, 0.08), (n, 1)) * (0.85 + 0.25 * fbm(P, 120, 2, seed=121)[:, None])
    r = np.full(n, 0.7)
    tw = (np.abs(P[:, 2] + 0.04) < 0.004) | (np.abs(P[:, 2] - 0.075) < 0.004)
    c[tw] = srgb(0.55, 0.47, 0.33)
    fuse = P[:, 2] > 0.121
    c[fuse] = srgb(0.20, 0.17, 0.12)
    tip = P[:, 2] > 0.175
    c[tip] = srgb(0.9, 0.55, 0.2)
    return c, r, np.zeros(n)
