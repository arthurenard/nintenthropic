"""Heads of the dead: sculpted the way High Noon's are (soft volumes melted
together, charlib.head), then pushed toward the grave - the eyes sunk into
their orbits, the cheeks fallen in under the bone, the temples hollowed,
the lips drawn thin and the jaw hanging a little open on a row of teeth.

The eyeballs are not part of the head: the sockets are left open behind the
lids and the eyes are their own small mesh (`eyes`, eyes.py), so the game can
make them shine in the flashlight - the tell that something is standing in
the fog. Every dead head puts its eyes in exactly the same place, so one
`eyes` mesh serves every body in walker.glb.

Head-local frame (charlib.head): origin between the eyes, 7 cm behind them;
x = the character's left, y = back, z = up; HEAD_ORIGIN in world.

Game mesh: the sculpt polygonised densely and collapse-decimated with
symmetry to ~5k triangles (High Noon's heads had 1.9k: that is where their
faceted jaws and cheek seams came from), UVs split face / scalp with the
face island enlarged, normals and paint baked from the exact sculpt.
"""

import math

import numpy as np

from .common import S, PG, bl, HD, T, srgb, smoothstep, value_noise, fbm
from . import meshfix as MF

HEAD_ORIGIN = HD.HEAD_ORIGIN
EYE_X = 0.0315
EYE_Y = -0.0736        # a hair behind the living eye's place: the dead's sit back
EYE_Z = 0.0005
BALL_R = 0.0117

DEAD = dict(
    sunken=0.8,      # orbital hollow
    gaunt=0.8,       # buccal hollows under the cheekbones
    mouth=0.6,       # how far the jaw hangs (0 closed .. 1 slack)
    swollen=0.0,     # bloat: puffy lids and jowls
    teeth=1.0,
    fresh=0.0,       # 0 long dead .. 1 recently
)


def P(dead=None, **kw):
    p = HD.P(**kw)
    d = dict(DEAD)
    d.update(dead or {})
    p["dead"] = d
    return p


def eyes_local():
    return np.array([EYE_X, EYE_Y, EYE_Z]), np.array([-EYE_X, EYE_Y, EYE_Z])


class Warp(S.Node):
    """Evaluate a child at a displaced point: moves a region of the sculpt
    (the jaw dropping) rather than growing or carving it."""

    def __init__(self, child, fn, reach):
        self.child, self.fn = child, fn
        self.reach = reach
        self.lo, self.hi = child.lo - reach, child.hi + reach
        self.label = child.label

    def _reach(self):
        return self.reach

    def eval(self, P_):
        return self.child.eval((P_ - self.fn(P_)).astype(np.float32))


def skull(p):
    """charlib.head.skull, adapted: no eyeballs (the sockets stay open behind
    the lids), the eyes fixed where `eyes` expects them, the orbits and
    cheeks sunk, the temples hollowed, the mouth hanging open on its teeth."""
    d = p["dead"]
    w = p["width"] * (1 - 0.05 * p["sex"])
    jaw = p["jaw"] * (1 - 0.12 * p["sex"])
    age = p["age"]
    fem = p["sex"]
    sw = d["swollen"]
    cran = HD.ovoid((0, 0.010, 0.034), (0.0745 * w, 0.092, 0.080), taper=0.07)
    forehead = S.Ellipsoid((0, -0.048, 0.046), (0.064 * w, 0.046, 0.060))
    head = S.Union([cran, forehead], k=0.02)
    br = p["brow"] * (1 - 0.6 * fem) * (1 + 0.08 * d["sunken"])
    brow = []
    for s in (1, -1):
        brow.append(S.RoundCone((s * 0.010, -0.0945, 0.018), (s * 0.034, -0.0925, 0.0215), 0.0056 + 0.0022 * br))
        brow.append(S.RoundCone((s * 0.034, -0.0925, 0.0215), (s * 0.056, -0.076, 0.018), 0.0056 + 0.0022 * br, 0.0046 + 0.0014 * br))
    head = S.Union([head] + brow, k=0.014)
    mid = S.Ellipsoid((0, -0.046, -0.024), (0.054 * w, 0.046, 0.048))
    muzzle = S.Ellipsoid((0, -0.068, -0.063), (0.028 * p["mouth_w"], 0.025, 0.028))
    head = S.Union([head, mid, muzzle], k=0.018)
    cb = p["cheekbone"] * (1 + 0.04 * d["gaunt"])
    zyg = []
    for s in (1, -1):
        R_ = S.rot_z(s * 35)
        zyg.append(S.Ellipsoid((s * 0.050, -0.064, -0.012), (0.016 * cb, 0.020, 0.012 * cb), R_))
        zyg.append(S.RoundCone((s * 0.056, -0.052, -0.011), (s * 0.062 * w, -0.012, -0.013), 0.0056 * cb, 0.0048))
    head = S.Union([head] + zyg, k=0.02)
    jw = []
    for s in (1, -1):
        gon = (s * 0.050 * jaw, 0.002, -0.080 + 0.006 * fem)
        jw.append(S.RoundCone((s * 0.055 * jaw, 0.006, -0.028), gon, 0.009))
        jw.append(S.RoundCone(gon, (s * 0.016, -0.080, -0.104 + 0.004 * fem), 0.0095, 0.0088))
    ch = p["chin"]
    chin = S.Ellipsoid((0, -0.0850 - 0.003 * (ch - 1), -0.0985 + 0.004 * fem), (0.0185 * ch * (1 - 0.15 * fem), 0.0155, 0.0165))
    head = S.Union([head] + jw + [chin], k=0.018)
    fat = p["fat"] + 1.2 * sw
    cheeks = [S.Ellipsoid((s * 0.040, -0.068, -0.030), (0.012 + 0.007 * fat, 0.013 + 0.005 * fat, 0.018 + 0.004 * fat)) for s in (1, -1)]
    head = S.Union([head] + cheeks, k=0.025)
    if sw > 0:
        jowls = [S.Ellipsoid((s * 0.045, -0.055, -0.075), (0.02 + 0.01 * sw, 0.02, 0.022 + 0.008 * sw)) for s in (1, -1)]
        head = S.Union([head] + jowls + [S.Ellipsoid((0, -0.045, -0.118), (0.035 * (1 + sw), 0.03, 0.02 + 0.01 * sw))], k=0.03)
    # lips, thinned and drawn back by drying
    lf = p["lips"] * (1 + 0.25 * fem) * (1 - 0.35 * d["gaunt"] * (1 - d["fresh"]))
    mw = p["mouth_w"]
    lips = []
    for s_ in (1, -1):
        lips.append(S.RoundCone((0, -0.0957, -0.0593), (s_ * 0.0225 * mw, -0.0885, -0.0650), 0.0049 * lf, 0.0016))
        lips.append(S.RoundCone((s_ * 0.004, -0.0937, -0.0718), (s_ * 0.0205 * mw, -0.0885, -0.0668), 0.0058 * lf, 0.0017))
    head = S.Union([head, S.Sphere((0, -0.0990, -0.0610), 0.0022 * lf)] + lips, k=0.008)
    # the nose
    nl, nw, nb, nt = p["nose_len"], p["nose_w"], p["nose_bridge"], p["nose_tip"]
    nose_tip = np.array([0, -0.1135 - 0.006 * (nl - 1), -0.0270 - 0.004 * (nl - 1)])
    bridge = S.RoundCone((0, -0.0905, 0.006), (0, -0.1105 - 0.004 * (nb - 1) - 0.005 * (nl - 1), -0.020 - 0.003 * (nl - 1)), 0.0058 * nw, 0.0076 * nw)
    hump = S.Sphere((0, -0.1005 - 0.004 * (nb - 1), -0.010), 0.0062 * nw * (0.9 + 0.2 * (nb - 1)))
    tip = S.Sphere(nose_tip, 0.0094 * nt)
    alae = [S.Ellipsoid((s * 0.0122 * nw, -0.0990, -0.0352), (0.0070 * nw, 0.0090, 0.0060)) for s in (1, -1)]
    colum = S.Ellipsoid((0, -0.1070, -0.0395), (0.0042, 0.0085, 0.0040))
    head = S.Union([head, S.Union([bridge, hump, tip, colum] + alae, k=0.007)], k=0.009)
    nostrils = S.Union([S.Ellipsoid((s * 0.0072 * nw, -0.1055, -0.0425), (0.0036 * nw, 0.0056, 0.0021)) for s in (1, -1)])
    head = S.Subtract(head, nostrils, k=0.0015)
    nlf = S.Union([S.RoundCone((s * 0.0185, -0.0985, -0.036), (s * 0.030, -0.0900, -0.064), 0.0012) for s in (1, -1)])
    head = S.Subtract(head, nlf, k=0.004 + 0.003 * age)
    # the orbits: the charlib hollow, then the dead's deeper one under the brow
    eL, eR = eyes_local()
    # (the living's orbits are shallower: no ledge of brow over the eye)
    so = 0.74 if d.get("living") else 1.0
    sockets = S.Union([S.Ellipsoid(e + np.array([0, -0.0125, 0.0022]), (0.0185 * so, 0.0120 * so, 0.0125 * so)) for e in (eL, eR)])
    head = S.Subtract(head, sockets, k=0.007)
    sk = d["sunken"]
    if sk > 0:
        # sunken eyes are hollows round the lids, not missing lids: the sulcus
        # under the brow and the trough under the lower lid fall in, and the
        # lids themselves stay wrapped round the eyeball
        hollows = []
        for e in (eL, eR):
            s_ = np.sign(e[0])
            hollows.append(S.Ellipsoid(e + np.array([0.002 * s_, -0.0095, 0.0125]), (0.0165, 0.009, 0.0055 + 0.002 * sk)))
            hollows.append(S.Ellipsoid(e + np.array([0.004 * s_, -0.0085, -0.0135]), (0.0155, 0.0085, 0.005 + 0.002 * sk)))
        head = S.Subtract(head, S.Union(hollows), k=0.006 + 0.004 * sk)
    lid_puff = 1.0 + 0.35 * sw
    # the lids stand a good 3 mm off the eyeball: a thinner shell would be
    # lost between the voxels of the 1.2 mm polygonisation, leaving the eyes
    # bare in their sockets (the bug-eyed look of the first sculpts)
    mounds = [S.Ellipsoid(e + np.array([0, -0.0010, 0.0000]), (0.0178 * lid_puff, 0.0172, 0.0160 * lid_puff)) for e in (eL, eR)]
    head = S.Union([head] + mounds, k=0.004)
    head = S.Subtract(head, S.Union([HD._fissure(e, p) for e in (eL, eR)]), k=0.0009)
    # the eyeball's place, left empty (a smooth pocket the `eyes` mesh fills)
    pockets = S.Union([S.Sphere(e, BALL_R + 0.0008) for e in (eL, eR)])
    head = S.Subtract(head, pockets, k=0.0008)
    # temples and cheeks fallen in
    # (high on the side of the head, above the arch: a hollow reaching down to
    # eye level leaves a groove from the eye to the ear)
    temples = S.Union([S.Ellipsoid((s * 0.079 * w, -0.036, 0.040), (0.014, 0.028, 0.022)) for s in (1, -1)])
    head = S.Subtract(head, temples, k=0.022 + 0.012 * age + 0.01 * d["gaunt"])
    g = d["gaunt"] * (1 - 0.8 * sw)
    if g > 0:
        hollows = S.Union([S.Ellipsoid((s * 0.052, -0.058, -0.052), (0.011, 0.0065 * g + 0.004, 0.018)) for s in (1, -1)])
        head = S.Subtract(head, hollows, k=0.022)
    # neck: thinner when wasted, tendons standing out
    nk = p["neck"] * (1 - 0.14 * fem) * (1.04 - 0.04 * d["gaunt"] + 0.2 * sw)
    neck = S.RoundCone((0, 0.014, -0.072), (0, 0.030, -0.205), 0.057 * nk, 0.064 * nk)
    scm = [S.RoundCone((s * 0.050 * nk, 0.020, -0.040), (s * 0.017, -0.030, -0.195), (0.0115 + 0.002 * g) * nk) for s in (1, -1)]
    neckall = S.Union([neck] + scm, k=0.02 - 0.008 * g)
    if fem < 0.5:
        neckall = S.Union([neckall, S.Ellipsoid((0, -0.030, -0.132), (0.0085, 0.010, 0.013))], k=0.012)
    head = S.Union([head, neckall], k=0.008)
    # the mouth: the jaw dropped, the lips parted on a dark gap and teeth
    m = d["mouth"]
    if m > 0:
        drop = 0.0075 * m

        def jaw_warp(P_):
            z = P_[:, 2]
            y = P_[:, 1]
            # the mandible only: from the lips down to the chin's underside, not the throat
            t = smoothstep(-0.058, -0.075, z) * smoothstep(0.03, -0.02, y) * smoothstep(-0.14, -0.115, z)
            off = np.zeros_like(P_)
            off[:, 2] = -drop * t
            off[:, 1] = 0.002 * m * t
            return off.astype(np.float32)
        head = Warp(head, jaw_warp, drop + 0.003)
        gap = S.Ellipsoid((0, -0.093, -0.0655 - drop * 0.45), (0.021 * mw, 0.022, 0.0012 + drop * 0.42))
        corners = [S.Sphere((s * 0.021 * mw, -0.088, -0.0660 - drop * 0.4), 0.0016 + drop * 0.15) for s in (1, -1)]
        head = S.Subtract(head, S.Union([gap] + corners, k=0.004), k=0.0025)
    else:
        slit = S.Ellipsoid((0, -0.1025, -0.0656), (0.0232 * mw, 0.0075, 0.0007))
        head = S.Subtract(head, slit, k=0.0025)
    th = teeth_node(p)
    if th is not None:
        head = S.Union([head, th], k=0.0004)
    cut = S.Plane((0, 0, -0.205), (0, 0, -1), (-0.2, -0.2, -0.3), (0.2, 0.2, 0.3))
    return S.Intersect(head, cut)


def teeth_node(p):
    """The two rows of teeth behind the parted lips (None if the mouth is shut)."""
    d = p["dead"]
    m = d["mouth"]
    if not (d["teeth"] > 0 and m > 0):
        return None
    drop = 0.0075 * m
    mw = p["mouth_w"]
    teeth = []
    for jrow, (zc, h) in enumerate(((-0.0610 - drop * 0.1, 0.0045), (-0.0712 - drop * 0.85, 0.004))):
        for k in range(-4, 5):
            a = k * 0.19
            c = (math.sin(a) * 0.020 * mw, -0.0905 + 0.010 * (1 - math.cos(a)) + 0.0015 * jrow, zc)
            teeth.append(S.Box(c, (0.0022 + 0.0006 * (abs(k) < 2), 0.0022, h), S.rot_z(-math.degrees(a)), rad=0.0009))
    return S.Union(teeth, k=0.0006)


def head_sdf(p):
    base = skull(p)
    if p["dead"]["swollen"] > 0:
        base = S.Offset(base, 0.0025 * p["dead"]["swollen"])
    bw = p["brows"]
    beard = p["beard"]

    def disp(Pt):
        t = 0.0012 * bw * HD.brow_field(Pt, p)
        t = np.maximum(t, 0.0022 * HD.moustache_field(Pt, p))
        if beard > 0:
            t = np.maximum(t, 0.004 * max(beard - 0.3, 0) * HD.beard_field(Pt, p))
        return -t.astype(np.float32)
    return S.Displace(base, disp, 0.006)


def skin_detail(field, p):
    """The grain the normal map carries: pores, and on the dead the fine
    wrinkling of skin gone slack, veins standing under it, the brow lines."""
    age = p["age"]
    d = p["dead"]
    decay = 1 - d["fresh"]

    def f(Pt):
        x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
        grain = (T.value_noise(Pt, 520, seed=61) - 0.5) * 0.00012 + (T.value_noise(Pt, 1400, seed=63) - 0.5) * 0.00005
        fore = T.smoothstep(0.030, 0.040, z) * (1 - T.smoothstep(0.062, 0.074, z)) * T.smoothstep(-0.07, -0.085, y) * (1 - T.smoothstep(0.035, 0.05, np.abs(x)))
        lines = np.sin(z * 2 * np.pi / 0.0085 + 6.0 * T.value_noise(Pt, 45, seed=65)) ** 6 * (0.4 + 0.6 * T.value_noise(Pt, 90, seed=66))
        crepe = (T.value_noise(Pt * np.array([1, 1, 3.0]), 420, seed=67) - 0.5) * 0.00007 * decay
        ridge = 1 - np.abs(2 * T.fbm(Pt, 70, 3, seed=69) - 1)
        veins = T.smoothstep(0.93, 0.985, ridge) * 0.00003 * decay
        wr = (0.3 + age) * (0.00016 * fore * lines)
        return (grain + wr + crepe - veins).astype(np.float32)
    return S.Displace(field, f, 0.0008)


# ---------------------------------------------------------------------------
# Paint

DEAD_SKIN = {
    # long-dead: grey-yellow, a green cast in the hollows
    "grave": srgb(0.52, 0.53, 0.46),
    "ashen": srgb(0.56, 0.56, 0.56),
    "sallow": srgb(0.60, 0.57, 0.47),
    "fresh": srgb(0.70, 0.60, 0.52),
    "bloat": srgb(0.56, 0.60, 0.46),
}


def dead_skin(Pw, V, tone="grave", fresh=0.0, grime=0.5, seed=0):
    """Colour and roughness of dead skin anywhere on a body. Pw: world
    points (for the livor that pools low), V: the part's own frame."""
    n = len(V)
    base = DEAD_SKIN[tone] * (1 - fresh) + DEAD_SKIN["fresh"] * fresh
    col = np.tile(base, (n, 1))
    m1 = fbm(V, 45, 4, seed=seed + 3)
    m2 = fbm(V, 180, 3, seed=seed + 5)
    col *= (0.86 + 0.26 * m1)[:, None]
    # mottling: blotches of grey-violet and of jaundiced yellow-green
    blot = smoothstep(0.55, 0.75, fbm(V, 25, 4, seed=seed + 7))
    col = col * (1 - 0.30 * blot[:, None]) + srgb(0.42, 0.36, 0.44) * 0.30 * blot[:, None]
    yel = smoothstep(0.58, 0.8, fbm(V + 7.1, 22, 3, seed=seed + 9))
    col = col * (1 - 0.22 * yel[:, None]) + srgb(0.60, 0.60, 0.36) * 0.22 * yel[:, None]
    # veins: a marbled net under the skin, blue-grey
    ridge = 1 - np.abs(2 * fbm(V, 70, 3, seed=seed + 11) - 1)
    vein = smoothstep(0.90, 0.975, ridge) * (0.5 + 0.5 * m2) * (1 - 0.6 * fresh)
    col = col * (1 - 0.35 * vein[:, None]) + srgb(0.30, 0.32, 0.40) * 0.35 * vein[:, None]
    # livor: blood settled low in the body, a dusky purple (strongest low and behind)
    liv = smoothstep(1.6, 0.6, Pw[:, 2]) * smoothstep(0.4, 0.75, fbm(V, 12, 3, seed=seed + 13)) * (1 - fresh)
    col = col * (1 - 0.25 * liv[:, None]) + srgb(0.38, 0.28, 0.36) * 0.25 * liv[:, None]
    # grime
    col *= (1 - grime * 0.35 * smoothstep(0.5, 0.8, fbm(V, 60, 3, seed=seed + 15)))[:, None]
    rough = 0.55 - 0.08 * m2 + 0.1 * smoothstep(0.5, 0.8, fbm(V, 60, 3, seed=seed + 15)) * grime
    return np.clip(col, 0, 1), np.clip(rough, 0.25, 1)


def head_paint(V, p, look, is_ear=False):
    """The dead face: pale and mottled, the orbits bruise-dark, the lips grey
    and split, a dried dark trickle from a mouth corner, grime in the creases."""
    d = p["dead"]
    fresh = d["fresh"]
    Pw = V + HEAD_ORIGIN
    col, rough = dead_skin(Pw, V, look.get("tone", "grave"), fresh, look.get("grime", 0.5), seed=look.get("seed", 0))
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    n = len(V)
    # the orbits: deep violet-brown shadow painted into the hollows
    eL, eR = eyes_local()
    for e in (eL, eR):
        q = V - e
        dd = np.linalg.norm(q / np.array([1.25, 1.0, 1.05]), axis=1)
        sock = np.exp(-((dd - 0.013) / 0.010) ** 2) * smoothstep(-0.055, -0.080, y)
        sock = np.clip(sock * (0.6 + 0.8 * d["sunken"]), 0, 1)
        col = col * (1 - 0.55 * sock[:, None]) + srgb(0.24, 0.16, 0.18) * 0.55 * sock[:, None]
        # the lids' rims raw and red-grey
        rim = np.exp(-((dd - 0.0145) / 0.0022) ** 2) * smoothstep(-0.075, -0.085, y)
        col = col * (1 - 0.3 * rim[:, None]) + srgb(0.42, 0.24, 0.24) * 0.3 * rim[:, None]
    # cheek hollows and temples a shade darker, greener
    hol = np.exp(-(((ax - 0.050) / 0.014) ** 2 + ((z + 0.052) / 0.02) ** 2)) * d["gaunt"]
    col = col * (1 - 0.25 * hol[:, None]) + srgb(0.38, 0.40, 0.32) * 0.25 * hol[:, None]
    # nose and ears: blood gone from the cartilage, a greyer tip
    nose = np.exp(-((ax / 0.012) ** 2 + ((z + 0.026) / 0.015) ** 2)) * smoothstep(-0.098, -0.112, y)
    col = col * (1 - 0.2 * nose[:, None]) + srgb(0.50, 0.44, 0.48) * 0.2 * nose[:, None]
    if is_ear:
        col = col * 0.82 + srgb(0.46, 0.34, 0.38) * 0.18
    # lips: grey-violet, cracked; the mouth's inside dark
    lipd = np.exp(-((ax / 0.022) ** 2 + ((z + 0.0655) / 0.0095) ** 2)) * smoothstep(-0.086, -0.096, y)
    lipm = smoothstep(0.35, 0.8, lipd)
    col = col * (1 - 0.6 * lipm[:, None]) + srgb(0.36, 0.28, 0.32) * 0.6 * lipm[:, None]
    crack = smoothstep(0.7, 0.9, np.abs(np.sin(x * 900 + 3 * value_noise(V, 300, seed=91)))) * lipm
    col *= (1 - 0.4 * crack)[:, None]
    inner = smoothstep(-0.090, -0.075, y) * np.exp(-((ax / 0.024) ** 2 + ((z + 0.067) / 0.012) ** 2))
    col = col * (1 - 0.9 * inner[:, None]) + srgb(0.08, 0.04, 0.05) * 0.9 * inner[:, None]
    rough = rough - 0.2 * inner
    # teeth: yellow-grey, dark at the gums
    m = d["mouth"]
    th = teeth_node(p)
    if th is not None:
        # teeth where the surface is the teeth themselves (not the lips over them)
        near = (np.abs(z + 0.066) < 0.02) & (ax < 0.03) & (y < -0.07)
        teeth = np.zeros(n, bool)
        if near.any():
            teeth[near] = th.eval(V[near].astype(np.float32)) < 0.0005
        col[teeth] = srgb(0.62, 0.56, 0.42) * (0.8 + 0.3 * value_noise(V[teeth], 800, seed=93)[:, None])
        rough[teeth] = 0.35
    # stubble on the men, grey
    if p["sex"] < 0.5:
        beard = HD.beard_field(V, p)
        dots = value_noise(V, 2600, seed=11)
        sm = np.clip(beard * look.get("stubble", 0.5), 0, 1) * (0.55 + 0.45 * smoothstep(0.3, 0.8, dots))
        col = col * (1 - 0.32 * sm[:, None]) + srgb(0.28, 0.28, 0.29) * 0.32 * sm[:, None]
    # brows
    bm = smoothstep(0.1, 0.7, HD.brow_field(V, p)) * (0.45 + 0.55 * value_noise(np.stack([x * 900, z * 2500, y * 900], 1), 1.0, seed=29))
    hc = look.get("brow_color", srgb(0.18, 0.15, 0.13))
    col = col * (1 - 0.8 * bm[:, None]) + hc * 0.8 * bm[:, None]
    # the scalp under the hair meshes: bruise-grey, a little darker
    scalp = smoothstep(0.06, 0.09, z + 0.02 * smoothstep(-0.02, 0.06, y))
    col = col * (1 - 0.12 * scalp[:, None])
    # a dried dark trickle from one corner of the mouth down the chin, and a
    # scratch across the cheek (PG-13: old, dark, never wet)
    side = look.get("trickle", 1)
    if side:
        tx = side * 0.020 + 0.004 * np.sin(z * 90)
        tr = np.exp(-((x - tx) / (0.0025 + 0.004 * smoothstep(-0.07, -0.11, z))) ** 2) * smoothstep(-0.064, -0.070, z) * \
            smoothstep(-0.13, -0.10, z) * smoothstep(-0.07, -0.085, y)
        tr *= 0.5 + 0.5 * value_noise(V, 300, seed=97)
        col = col * (1 - 0.7 * tr[:, None]) + srgb(0.16, 0.06, 0.05) * 0.7 * tr[:, None]
        rough = rough - 0.15 * tr
    scr = look.get("scratch")
    if scr:
        a, b = np.array(scr[0]), np.array(scr[1])
        ab = b - a
        t = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
        dist = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
        for off in (0.0, 0.004, 0.008):
            s_ = np.exp(-((dist - off) / 0.0009) ** 2) * smoothstep(0, 0.1, t) * smoothstep(1, 0.8, t)
            col = col * (1 - 0.6 * s_[:, None]) + srgb(0.28, 0.10, 0.10) * 0.6 * s_[:, None]
    return np.clip(col, 0, 1).astype(np.float32), np.clip(rough, 0.05, 1).astype(np.float32)


def importance(V):
    """How much a head vertex matters (low = keep its triangles): the face
    most, the crown, nape and neck least."""
    az = np.degrees(np.arctan2(np.abs(V[:, 0]), -(V[:, 1] - 0.005)))
    face = smoothstep(80, 55, az) * smoothstep(-0.14, -0.11, V[:, 2]) * smoothstep(0.075, 0.045, V[:, 2])
    eyes = np.exp(-(((np.abs(V[:, 0]) - EYE_X) / 0.022) ** 2 + ((V[:, 2] - EYE_Z) / 0.016) ** 2)) * (V[:, 1] < -0.06)
    mouth = np.exp(-((V[:, 0] / 0.03) ** 2 + ((V[:, 2] + 0.066) / 0.014) ** 2)) * (V[:, 1] < -0.07)
    return np.clip(1.0 - 0.5 * face - 0.3 * eyes - 0.2 * mouth, 0.1, 1.0)


def head_mesh(name, field, tris, coll=None, box=((-0.12, -0.16, -0.215), (0.12, 0.14, 0.15)), res=0.0012):
    """The game mesh: the sculpt polygonised densely, collapse-decimated with
    the face weighted to keep its triangles, then relaxed onto the sculpt."""
    Vd, Qd = PG.mesh_sdf(field, box[0], box[1], res, blur=0.9)
    lo = bl.mesh_from_arrays(name, Vd + HEAD_ORIGIN, Qd, coll)
    MF.decimate_weighted(lo, tris, importance(Vd), symmetry=True)
    MF.relax_project(lo, field, HEAD_ORIGIN, iters=3, lam=0.35)
    return lo


def make(name, p, look, coll=None, tris=6400):
    """The head's bake jobs: the game mesh (face/scalp UVs) and the ears."""
    field = head_sdf(p)
    detailed = skin_detail(field, p)
    if p["dead"].get("swollen", 0) > 0:
        # a swollen head and neck overflow the usual box (it cut them flat)
        lo = head_mesh(name, field, tris, coll, box=((-0.16, -0.18, -0.215), (0.16, 0.17, 0.17)))
    else:
        lo = head_mesh(name, field, tris, coll)
    HD.head_uv(lo, face_scale=2.4)

    def paint(Pt):
        c, r = head_paint(Pt, p, look)
        return c, r, np.zeros(len(Pt))

    def paint_ear(Pt):
        c, r = head_paint(Pt, p, look, is_ear=True)
        return c, r, np.zeros(len(Pt))
    jobs = [dict(ob=lo, field=detailed, paint=paint, origin=HEAD_ORIGIN, weight=3.6, ao_field=field)]
    for side, tag in ((1, "L"), (-1, "R")):
        e = HD.ear_sdf(p, side)
        Ve, Qe = PG.mesh_sdf(e, e.lo, e.hi, 0.0008, blur=1.0)
        elo = bl.mesh_from_arrays(f"{name}.ear.{tag}", Ve + HEAD_ORIGIN, Qe, coll)
        MF.decimate(elo, 180, symmetry=False)
        jobs.append(dict(ob=elo, field=e, paint=paint_ear, origin=HEAD_ORIGIN, weight=1.2, ao_field=e, smart_uv=True, uv_angle=80))
    return jobs, field
