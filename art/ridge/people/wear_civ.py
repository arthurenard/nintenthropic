"""The valley's people's clothes: the farmer's bib-and-brace overalls and
rubber boots, the cyclist's red jacket, skirt, stockings and headscarf, the
shepherd's red wool jacket, knitted scarf and crook, the boy's jumper,
shorts and knee socks.

The rule the game plays by: through a 6x scope at 250-900 m a civilian is
unmistakable - no helmet, no weapon, bright clothes. So every civilian wears
at least one strong colour a soldier never does (the farmer's blue overalls
over a pale shirt under a straw hat, the cyclist's red and yellow, the
shepherd's red jacket and mustard scarf, the boy's yellow jumper), and no
hat is a round dome.
"""
import math
import numpy as np
from charlib import sdf as S, rings as R, garments as G, body as BD, head as HD, paint as PT, gear as GR
from charlib.texture import srgb, smoothstep, value_noise, fbm
from charlib.skeleton import JOINTS
from . import wear as W

DENIM = (0.13, 0.25, 0.52)
RED = (0.62, 0.075, 0.055)
MUSTARD = (0.80, 0.55, 0.10)
YELLOW = (0.86, 0.66, 0.10)


def _j(n, e=0):
    return np.array(JOINTS[n][e], float)


# ------------------------------------------------------------------ bib and braces

def bib_field(bp):
    """The bib's cloth, a few millimetres over the shirt (its snapping surface)."""
    return S.Offset(BD.shirt(bp), 0.007)


def build_bib(field, z0=1.045, z1=1.33, n_u=11, rows=7):
    """The bib as a front panel of rings, like charlib's apron: arcs across
    the chest, snapped onto the shirt let out a little."""
    rm = R.RingMesh()
    zs = np.linspace(z0, z1, rows)
    rings = []
    for z in zs:
        u = (z - z0) / (z1 - z0)
        half = 0.66 - 0.16 * u          # narrower toward the top
        th = np.linspace(-half, half, n_u)
        pts = np.stack([0.20 * np.sin(th), -0.02 - 0.16 * np.cos(th), np.full(n_u, z)], 1)
        rings.append(rm.ring(pts, relax=0.0))
    ua = np.linspace(0, 1, n_u)
    for k in range(rows - 1):
        rm.bridge(rings[k], rings[k + 1], zs[k], zs[k + 1], "bib", closed=False, ua=ua)
    V = np.array(rm.V, np.float32)
    rm.V = list(S.project_to_surface(field, V, iters=8, clamp=0.05).astype(np.float64))
    rm.field = field
    return rm


def braces_field(bp, top=1.33):
    """Two braces from the bib's top corners over the shoulders, crossing in
    an X on the back down to the waistband, with their buckles."""
    shirt = S.Offset(BD.shirt(bp), 0.007)
    parts = []
    for s in (1, -1):
        path = [(s * 0.085, -0.13, top - 0.01), (s * 0.095, -0.11, 1.40), (s * 0.105, -0.05, 1.465), (s * 0.100, 0.04, 1.47),
                (s * 0.075, 0.11, 1.38), (0.0, 0.13, 1.24), (-s * 0.075, 0.125, 1.12), (-s * 0.100, 0.12, 1.07)]
        p = W.surface_path(shirt, path, 0.003)
        parts.append(S.Tube(p, [0.017] * len(p), [0.0025] * len(p), side=(1, 0, 0)))
        parts.append(S.Box(p[0] + np.array([0, -0.006, -0.012]), (0.018, 0.004, 0.015), S.rot_x(-10), rad=0.003))
    return S.Union(parts, k=0.003)


def overalls_paint(seed=0):
    """Faded denim: paler over the knees and seat, a double-stitched seam
    down the legs, a bib pocket, brass buckles and buttons."""
    def paint(P):
        col, r, m = PT.fabric(P, DENIM, "denim", dust_amt=0.45, fade=0.35, seed=seed + 400, grime=0.25)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # twill: fine diagonal ribs
        tw = 0.92 + 0.08 * np.sin((z + 0.6 * x + 0.3 * y) * 2 * np.pi / 0.003)
        col *= tw[:, None]
        for tag in ("L", "R"):
            kn = _j(f"shin.{tag}")
            q = P - kn
            knee = np.exp(-((q[:, 0] / 0.05) ** 2 + ((q[:, 2] - 0.01) / 0.08) ** 2)) * (q[:, 1] < -0.02)
            col = col * (1 - 0.3 * knee[:, None]) + (col * 1.5 + 0.03) * 0.3 * knee[:, None]
            ax = x * (1 if tag == "L" else -1)
            seam = (ax > 0.05) & (np.abs(y - 0.005) < 0.0025) & (z < 0.95)
            col[seam] = srgb(0.62, 0.45, 0.20)
        # the bib pocket and its stitching
        pk = (np.abs(x) < 0.06) & (z > 1.17) & (z < 1.27) & (y < -0.08)
        edge = pk & ((np.abs(np.abs(x) - 0.06) < 0.004) | (np.abs(z - 1.17) < 0.004) | (np.abs(z - 1.27) < 0.004))
        col[edge] = srgb(0.62, 0.45, 0.20)
        # buckles at the bib's corners, buttons at the hips
        mc, mr, mm = PT.metal(P, (0.62, 0.50, 0.26), 0.35, seed=seed + 401)
        bk = (np.abs(np.abs(x) - 0.085) < 0.02) & (np.abs(z - 1.318) < 0.017) & (y < -0.10)
        bt = (np.abs(np.abs(x) - 0.165) < 0.008) & (np.abs(z - 1.04) < 0.008)
        met = bk | bt
        col[met], r[met], m[met] = mc[met], mr[met], mm[met]
        return np.clip(col, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ rubber boots

def rubber_boot_sdf(side="L", top=0.36):
    """A wellington: a round toe, a flat cleated sole, a wide straight shaft."""
    s = 1.0 if side == "L" else -1.0
    X = lambda p: np.array([s * p[0], p[1], p[2]])
    an = _j("foot.L")
    x0 = an[0]
    parts = [S.Tube([X((x0, 0.078, 0.009)), X((x0, 0.0, 0.009)), X((x0 + 0.004, -0.09, 0.009)), X((x0 + 0.006, -0.150, 0.009)),
                     X((x0 + 0.006, -0.190, 0.010))], [0.043, 0.044, 0.052, 0.049, 0.024], [0.010] * 5, side=(1, 0, 0)),
             S.Tube([X((x0, 0.055, 0.090)), X((x0, 0.010, 0.090)), X((x0 + 0.002, -0.050, 0.068)), X((x0 + 0.005, -0.110, 0.048)),
                     X((x0 + 0.006, -0.160, 0.040)), X((x0 + 0.006, -0.182, 0.034))],
                    [0.046, 0.048, 0.050, 0.050, 0.043, 0.026], [0.056, 0.058, 0.046, 0.032, 0.028, 0.020], side=(1, 0, 0)),
             S.Ellipsoid(X((x0 + 0.006, -0.150, 0.036)), (0.046, 0.040, 0.030)),
             S.Ellipsoid(X((x0, 0.052, 0.07)), (0.044, 0.040, 0.055))]
    kn = _j("shin.L")
    d = (kn - an) / np.linalg.norm(kn - an)
    p_top = an + d * ((top - an[2]) / d[2])
    parts.append(S.RoundCone(X(an + np.array([0, 0.012, -0.01])), X(p_top), 0.058, 0.070))
    boot = S.Union(parts, k=0.014)
    boot = S.Intersect(boot, S.Plane(X(p_top), (0, 0, 1), (-1, -1, -1), (1, 1, 2)))
    boot = S.Subtract(boot, S.RoundCone(X(p_top - d * 0.04), X(p_top + d * 0.03), 0.060, 0.064), k=0.002)
    return boot, p_top


def rubber_paint(color=(0.10, 0.13, 0.08), seed=0):
    def paint(P):
        n = len(P)
        col = np.tile(srgb(*color), (n, 1)) * (0.92 + 0.1 * fbm(P, 90, 2, seed=seed + 410))[:, None]
        r = np.full(n, 0.42) + 0.1 * value_noise(P, 200, seed=seed + 411)
        z = P[:, 2]
        sole = z < 0.018
        col[sole] = srgb(0.05, 0.05, 0.05)
        mud = smoothstep(0.16, 0.02, z) * smoothstep(0.35, 0.65, fbm(P, 50, 3, seed=seed + 412))
        col = col * (1 - 0.75 * mud[:, None]) + srgb(0.28, 0.22, 0.15) * 0.75 * mud[:, None]
        r = r * (1 - mud) + 0.9 * mud
        return np.clip(col, 0, 1), np.clip(r, 0, 1), np.zeros(n)
    return paint


# ------------------------------------------------------------------ the headscarf

def headscarf_field(hp):
    """A kerchief over the hair, knotted at the nape with two short tails
    (head-local): the scalp let out, cut at the brow, above the ears and
    under the occiput."""
    head = HD.head_sdf(hp, low=True)
    shell = S.Offset(head, 0.0055)

    def edge(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        az = np.abs(np.degrees(np.arctan2(x, -(y - 0.005))))
        # lower edge: at the hairline in front, down over the ears' tops, low at the back
        lo = np.interp(az, [0, 40, 80, 120, 180], [0.052, 0.040, 0.008, -0.030, -0.070])
        return (lo - z).astype(np.float32)
    cloth = S.Intersect(shell, S.Fn(edge, (-0.2, -0.2, -0.3), (0.2, 0.2, 0.3)), k=0.003)
    knot = S.Union([S.Ellipsoid((0, 0.100, -0.062), (0.020, 0.016, 0.015)),
                    S.RoundCone((0.006, 0.108, -0.070), (0.020, 0.110, -0.135), 0.010, 0.005),
                    S.RoundCone((-0.006, 0.108, -0.070), (-0.016, 0.106, -0.128), 0.009, 0.005)], k=0.006)

    def folds(P):
        a = np.arctan2(P[:, 2] + 0.07, P[:, 0])
        return (-0.0012 * np.sin(a * 11 + 3 * value_noise(P, 40, seed=421)) ** 2).astype(np.float32)
    return S.Displace(S.Union([cloth, knot], k=0.008), folds, 0.0015)


def headscarf_paint(base=YELLOW, dots=(0.92, 0.90, 0.84)):
    def paint(P):
        c, r, m = PT.fabric(P + 9.0, base, "cotton", dust_amt=0.0, fade=0.15, seed=431)
        u = P[:, 0] * 90
        v = (P[:, 2] + 0.3 * P[:, 1]) * 90
        dot = (np.sin(u) * np.sin(v)) > 0.82
        c[dot] = srgb(*dots)
        return c, r, m
    return paint


# ------------------------------------------------------------------ the skirt

# (under the jacket the skirt stays well inside its hem - two near-coincident
# faceted surfaces flicker - and comes out below it at 0.90)
SKIRT = [(1.035, 0.142, 0.106, 0.004), (0.98, 0.160, 0.124, 0.010), (0.90, 0.186, 0.148, 0.012), (0.78, 0.210, 0.166, 0.010),
         (0.66, 0.226, 0.180, 0.008), (0.52, 0.244, 0.194, 0.006)]


def skirt_field():
    zs = [t[0] for t in SKIRT][::-1]
    prof = G._table_profile(SKIRT)
    tube = S.Tube([(0, prof(z)[2], z) for z in zs], [prof(z)[0] for z in zs], [prof(z)[1] for z in zs])
    return S.Shell(tube, 0.003)


def skirt_folds(P):
    th = np.arctan2(P[:, 0], -(P[:, 1] - 0.01))
    sk = smoothstep(1.02, 0.94, P[:, 2])
    return (-0.005 * sk * np.sin(th * 13 + 2.0 * value_noise(P * np.array([1, 1, 0.3]), 6, seed=441)) ** 2).astype(np.float32)


def build_skirt(field, M=28):
    rm = R.RingMesh()
    prof = G._table_profile(SKIRT)
    zs = [0.52, 0.60, 0.68, 0.76, 0.84, 0.92, 0.98, 1.035]
    rings = []
    for z in zs:
        rx, ry, cy = prof(z)
        rings.append(rm.ring(R.ellipse_ring((0, cy, z), rx + 0.004, ry + 0.004, M), relax=0.0))
    ua = np.linspace(0, 1, M + 1)
    for k in range(len(rings) - 1):
        rm.bridge(rings[k], rings[k + 1], zs[k], zs[k + 1], "skirt", ua=ua)
    R.snap_and_relax(rm, field, iters=0)
    return rm


def skirt_override():
    """A skirt over pedalling knees: the front follows its own thigh (the
    panel between them their average), the back hangs from the hips."""
    from charlib.skeleton import BONE_NAMES
    ih = BONE_NAMES.index("hips")
    iL, iR = BONE_NAMES.index("thigh.L"), BONE_NAMES.index("thigh.R")

    def f(ob, V, Wt):
        z = V[:, 2]
        below = np.clip((1.00 - z) / 0.22, 0, 1)
        side = np.clip(V[:, 0] / 0.12, -1, 1)
        front = np.clip(-(V[:, 1] - 0.01) / 0.14, 0, 1)
        leg = np.clip((0.98 - z) / 0.30, 0, 1) * (0.25 + 0.6 * front)
        Wn = np.zeros_like(Wt)
        Wn[:, iL] = leg * np.clip(0.5 + 0.5 * side, 0, 1)
        Wn[:, iR] = leg * np.clip(0.5 - 0.5 * side, 0, 1)
        Wn[:, ih] = 1.0 - Wn[:, iL] - Wn[:, iR]
        return Wt * (1 - below[:, None]) + Wn * below[:, None]
    return f


def skirt_paint(color=(0.07, 0.10, 0.24), seed=0):
    def paint(P):
        c, r, m = PT.fabric(P, color, "wool", dust_amt=0.35, fade=0.2, seed=seed + 450)
        z = P[:, 2]
        band = np.abs(z - 1.03) < 0.012
        c[band] *= 0.8
        hem = z < 0.535
        c[hem] *= 0.85
        return c, r, m
    return paint


# ------------------------------------------------------------------ stockings, knee socks

def legwear_paint(skin_tone="fair", sock_top=None, sock=(0.82, 0.80, 0.74), stocking=None, seed=0, under=None):
    """Bare legs with knee socks (sock_top: where the sock ends), or legs in
    stockings (stocking: a colour over the skin). `under` = (z, colour): above
    z the legs are under a garment - painted its colour, so a chink in it
    never shows skin."""
    from charlib.texture import SKIN
    base = _legwear(skin_tone, sock_top, sock, stocking, seed)

    def paint(P):
        c, r, m = base(P)
        if under is not None:
            hid = P[:, 2] > under[0]
            c[hid] = srgb(*under[1]) * 0.7
        return c, r, m
    return paint


def _legwear(skin_tone, sock_top, sock, stocking, seed):
    from charlib.texture import SKIN

    def paint(P):
        n = len(P)
        z = P[:, 2]
        if stocking is not None:
            c, r, m = PT.fabric(P, stocking, "silk", dust_amt=0.15, fade=0.0, seed=seed + 460)
            # the knee and shin catch the light: sheer over skin
            sk = np.tile(SKIN[skin_tone], (n, 1))
            c = c * 0.75 + sk * 0.25
            seam = (np.abs(P[:, 1] - 0.055) < 0.0015) & (z < 0.9)
            c[seam] *= 0.6
            return np.clip(c, 0, 1), r, m
        c, r, m = PT.skin(P, skin_tone, seed=seed + 461, dirt=0.35)
        if sock_top is not None:
            s_c, s_r, s_m = PT.fabric(P, sock, "wool", dust_amt=0.4, fade=0.1, seed=seed + 462)
            rib = 0.9 + 0.1 * np.sin(np.arctan2(P[:, 0] - np.sign(P[:, 0]) * 0.1, P[:, 1]) * 30)
            s_c *= rib[:, None]
            on = z < sock_top
            turn = on & (z > sock_top - 0.03)
            s_c[turn] *= 0.88
            c[on], r[on], m[on] = s_c[on], s_r[on], s_m[on]
            # grazed, grubby knees
            for tag in ("L", "R"):
                kn = _j(f"shin.{tag}")
                q = P - kn
                graze = np.exp(-((q[:, 0] / 0.03) ** 2 + ((q[:, 2] + 0.01) / 0.03) ** 2)) * (q[:, 1] < -0.02)
                c = c * (1 - 0.3 * graze[:, None]) + srgb(0.55, 0.30, 0.25) * 0.3 * graze[:, None]
        return np.clip(c, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ scarf

def knit_scarf_field():
    """A knitted scarf wound once round the neck over the collar, one end
    hanging down the chest on his left."""
    parts = [S.Torus((0, 0.018, 1.525), 0.082, 0.024, S.rot_x(-14)),
             S.Torus((0, 0.012, 1.500), 0.090, 0.020, S.rot_x(-8))]
    tail = S.Tube([(0.050, -0.095, 1.49), (0.062, -0.130, 1.40), (0.066, -0.140, 1.30), (0.070, -0.142, 1.22)],
                  [0.045, 0.048, 0.050, 0.050], [0.010, 0.010, 0.010, 0.010], side=(1, 0, 0))
    fringe = S.Box((0.070, -0.143, 1.205), (0.050, 0.008, 0.018), None, rad=0.004)
    return S.Union(parts + [tail, fringe], k=0.012)


def knit_paint(color=MUSTARD, stripe=(0.55, 0.10, 0.07)):
    def paint(P):
        c, r, m = PT.fabric(P + 13.0, color, "wool", dust_amt=0.0, fade=0.1, seed=471)
        # garter-stitch ridges and a couple of stripes near the end
        rid = 0.85 + 0.15 * np.abs(np.sin(P[:, 2] * 2 * np.pi / 0.008 + P[:, 0] * 200))
        c *= rid[:, None]
        st = (P[:, 2] < 1.30) & (np.abs(((P[:, 2] - 1.22) % 0.05) - 0.025) < 0.008)
        c[st] = srgb(*stripe)
        return np.clip(c, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ the crook

def crook_field():
    """A shepherd's crook in the left fist's grip frame (socket.hand.L): the
    staff runs through the fist along +Z (up, 0.60 m to the hook) and -Z
    (down, 0.95 m to the tip); the hook opens forward."""
    staff = S.RoundCone((0, 0, -0.95), (0, 0, 0.58), 0.0115, 0.0125)
    hook = S.Torus((0, -0.055, 0.60), 0.055, 0.0115, S.rot_y(90))
    hook = S.Intersect(hook, S.Plane((0, 0, 0.60), (0, 0, -1), (-0.2, -0.2, 0.3), (0.2, 0.2, 0.8)))
    tip = S.RoundCone((0, -0.110, 0.60), (0, -0.112, 0.575), 0.0115, 0.009)
    ferrule = S.Cylinder((0, 0, -0.93), 0.0135, 0.02, None, rad=0.003)
    return S.Union([staff, S.Union([hook, tip], k=0.004), ferrule], k=0.004)


def crook_paint(P):
    c, r, m = PT.wood(P * 0.4, (0.32, 0.20, 0.10), axis=(0, 0, 1), seed=481, rough=0.5)
    grip = np.abs(P[:, 2]) < 0.06
    c[grip] *= 0.7
    iron = P[:, 2] < -0.91
    mc, mr, mm = PT.metal(P, (0.20, 0.20, 0.20), 0.5, rust=0.4, seed=482)
    c[iron], r[iron], m[iron] = mc[iron], mr[iron], mm[iron]
    return c, r, m


# ------------------------------------------------------------------ jumper

def knit_jumper_paint(color=YELLOW, seed=0):
    def paint(P):
        c, r, m = PT.fabric(P, color, "wool", dust_amt=0.35, fade=0.15, seed=seed + 490, grime=0.25)
        z = P[:, 2]
        # stocking stitch: vertical rows of little Vs
        th = np.arctan2(P[:, 0], -P[:, 1])
        knit = 0.9 + 0.1 * np.abs(np.sin(th * 60 + np.abs(np.sin(z * 2 * np.pi / 0.006)) * 1.5))
        c *= knit[:, None]
        # ribbed hem, cuffs and neck band
        rib = (z < 0.90) | (z > 1.50)
        c[rib] *= (0.85 + 0.15 * np.sin(th[rib] * 90))[:, None]
        # a darker band across the chest
        band = np.abs(z - 1.30) < 0.018
        c[band] = srgb(0.55, 0.10, 0.06)
        return np.clip(c, 0, 1), r, m
    return paint
