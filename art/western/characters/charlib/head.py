"""Heads: a parametric face sculpted from soft volumes, then a clean game mesh.

The face is built the way a sculptor blocks one in - skull, brow ridge, cheek
bones, jaw, the barrel of the mouth, the nose, eye sockets, eyeballs and lids -
each a soft volume melted into its neighbours. Parameters (jaw width, nose,
brow, age, fat...) make the gang's faces different people rather than one
face with different hats.

Local frame: origin between the eyes at eyeball-centre height, 7 cm behind
them (roughly over the ear canals); x = the character's left, y = back, z = up.
"""
import math
import numpy as np
from . import sdf as S

HEAD_ORIGIN = np.array([0.0, 0.0, 1.687])  # world position of the local origin

DEFAULT = dict(
    sex=0.0,          # 0 male .. 1 female
    age=0.35,         # 0 young .. 1 old: hollows, sag, wrinkles
    width=1.0,        # skull width
    jaw=1.0,          # jaw width
    chin=1.0,         # chin projection / size
    brow=1.0,         # brow ridge
    cheekbone=1.0,
    fat=0.3,          # cheek fullness
    nose_len=1.0,
    nose_w=1.0,
    nose_bridge=1.0,  # bridge height (a hook when > 1)
    nose_tip=1.0,
    lips=1.0,
    mouth_w=1.0,
    eye_open=1.0,
    ear=1.0,
    neck=1.0,         # neck thickness
    hair="short",     # short, slick, bald, bun, long_back, crop
    hair_len=1.0,
    hairline=0.0,     # receding (0..1)
    brows=1.0,        # eyebrow thickness
    moustache=None,   # None, 'walrus', 'handlebar', 'chevron', 'horseshoe'
    beard=0.0,        # 0 clean .. 1 short full beard (0.3 = heavy stubble)
    sideburns=0.0,    # mutton chops 0..1
)


def P(**kw):
    p = dict(DEFAULT)
    p.update(kw)
    return p


def ovoid(c, r, taper):
    """An egg: an ellipsoid whose width grows toward the back (+y), like a skull seen from above."""
    c = np.asarray(c, np.float32)
    r = np.asarray(r, np.float32)
    e = S.Ellipsoid(c, r)

    def f(Pt):
        q = Pt - c
        k = 1.0 + taper * np.clip(q[:, 1] / r[1], -1.2, 1.2)
        q2 = np.stack([q[:, 0] / k, q[:, 1], q[:, 2]], 1) + c
        return e.eval(q2.astype(np.float32))
    ext = r * np.array([1 + taper, 1, 1])
    return S.Fn(f, c - ext, c + ext)


def _eyes(p):
    ex = 0.0315 * (1 - 0.03 * p["sex"])
    return np.array([ex, -0.0742, 0.0005]), np.array([-ex, -0.0742, 0.0005])


def _fissure(eye, p):
    """The palpebral fissure: an almond-shaped opening cut through the lid volume
    in front of the eyeball. The upper margin arches highest a little toward the
    nose, the lower one dips lowest toward the outer corner, and the outer
    corner sits slightly higher - the shapes that make an eye read as an eye."""
    side = math.copysign(1.0, eye[0])
    op = p["eye_open"]
    W = 0.0148 * (1 - 0.04 * p["sex"])

    def f(Pt):
        q = Pt - eye
        lat = q[:, 0] * side                                  # + toward the outer corner
        tilt = 0.07 * lat + 0.0003
        uu = np.clip((lat + 0.0025) / (W + 0.0025 * np.sign(-lat) * 0 + 1e-9), -1, 1)
        ul = np.clip((lat - 0.002) / W, -1, 1)
        zu = 0.0046 * op * (1 - uu * uu) ** 0.55 + tilt
        zl = -0.0047 * op * (1 - ul * ul) ** 0.85 + tilt
        d2 = np.maximum(np.maximum(q[:, 2] - zu, zl - q[:, 2]), np.abs(lat) - W)
        return np.maximum(d2, q[:, 1] + 0.001)              # only in front of the ball's centre
    return S.Fn(f, eye - np.array([0.02, 0.03, 0.02]), eye + np.array([0.02, 0.0, 0.02]))


def skull(p, low=False):
    """Everything but the ears, hair and facial hair."""
    w = p["width"] * (1 - 0.05 * p["sex"])
    jaw = p["jaw"] * (1 - 0.12 * p["sex"])
    age = p["age"]
    fem = p["sex"]
    parts = []
    cran = ovoid((0, 0.010, 0.034), (0.0745 * w, 0.092, 0.080), taper=0.07)
    forehead = S.Ellipsoid((0, -0.048, 0.046), (0.064 * w, 0.046, 0.060))
    head = S.Union([cran, forehead], k=0.02)
    # brow ridge (heavier in men, softened by fat)
    br = p["brow"] * (1 - 0.6 * fem)
    brow = []
    for s in (1, -1):
        brow.append(S.RoundCone((s * 0.010, -0.0945, 0.018), (s * 0.034, -0.0925, 0.0215), 0.0056 + 0.0022 * br))
        brow.append(S.RoundCone((s * 0.034, -0.0925, 0.0215), (s * 0.056, -0.076, 0.018), 0.0056 + 0.0022 * br, 0.0046 + 0.0014 * br))
    head = S.Union([head] + brow, k=0.014)
    # midface and the barrel of the mouth
    mid = S.Ellipsoid((0, -0.046, -0.024), (0.054 * w, 0.046, 0.048))
    muzzle = S.Ellipsoid((0, -0.068, -0.063), (0.028 * p["mouth_w"], 0.025, 0.028))
    head = S.Union([head, mid, muzzle], k=0.018)
    # cheekbones and zygomatic arches
    cb = p["cheekbone"]
    zyg = []
    for s in (1, -1):
        R = S.rot_z(s * 35)
        zyg.append(S.Ellipsoid((s * 0.050, -0.064, -0.012), (0.016 * cb, 0.020, 0.012 * cb), R))
        zyg.append(S.RoundCone((s * 0.057, -0.052, -0.011), (s * 0.065 * w, -0.012, -0.013), 0.0062 * cb, 0.0052))
    head = S.Union([head] + zyg, k=0.02)
    # jaw: ramus down from the ear, body forward to the chin
    jw = []
    for s in (1, -1):
        gon = (s * 0.050 * jaw, 0.002, -0.080 + 0.006 * fem)
        jw.append(S.RoundCone((s * 0.055 * jaw, 0.006, -0.028), gon, 0.009))
        jw.append(S.RoundCone(gon, (s * 0.016, -0.080, -0.104 + 0.004 * fem), 0.0095, 0.0088))
    ch = p["chin"]
    chin = S.Ellipsoid((0, -0.0850 - 0.003 * (ch - 1), -0.0985 + 0.004 * fem), (0.0185 * ch * (1 - 0.15 * fem), 0.0155, 0.0165))
    head = S.Union([head] + jw + [chin], k=0.018)
    # cheek fat, softer with fullness and age
    fat = p["fat"]
    cheeks = [S.Ellipsoid((s * 0.040, -0.068, -0.030), (0.012 + 0.007 * fat, 0.013 + 0.005 * fat, 0.018 + 0.004 * fat)) for s in (1, -1)]
    head = S.Union([head] + cheeks, k=0.025)
    # lips
    lf = p["lips"] * (1 + 0.25 * fem)
    mw = p["mouth_w"]
    # lips as two tapering halves that follow the dental arch back to the corners
    lips = []
    for s_ in (1, -1):
        lips.append(S.RoundCone((0, -0.0957, -0.0593), (s_ * 0.0225 * mw, -0.0885, -0.0650), 0.0049 * lf, 0.0016))
        lips.append(S.RoundCone((s_ * 0.004, -0.0937, -0.0718), (s_ * 0.0205 * mw, -0.0885, -0.0668), 0.0058 * lf, 0.0017))
    tubercle = S.Sphere((0, -0.0990, -0.0610), 0.0022 * lf)
    head = S.Union([head, tubercle] + lips, k=0.008)
    slit = S.Ellipsoid((0, -0.1025, -0.0656), (0.0232 * mw, 0.0075, 0.0007))
    corners = [S.Sphere((s * 0.0232 * mw, -0.0880, -0.0660), 0.0014) for s in (1, -1)]
    if not low:
        head = S.Subtract(head, S.Union([slit] + corners, k=0.004), k=0.0025)
    # nose
    nl, nw, nb, nt = p["nose_len"], p["nose_w"], p["nose_bridge"], p["nose_tip"]
    nose_tip = np.array([0, -0.1135 - 0.006 * (nl - 1), -0.0270 - 0.004 * (nl - 1)])
    bridge = S.RoundCone((0, -0.0905, 0.006), (0, -0.1105 - 0.004 * (nb - 1) - 0.005 * (nl - 1), -0.020 - 0.003 * (nl - 1)), 0.0058 * nw, 0.0076 * nw)
    hump = S.Sphere((0, -0.1005 - 0.004 * (nb - 1), -0.010), 0.0062 * nw * (0.9 + 0.2 * (nb - 1)))
    tip = S.Sphere(nose_tip, 0.0094 * nt)
    alae = [S.Ellipsoid((s * 0.0122 * nw, -0.0990, -0.0352), (0.0070 * nw, 0.0090, 0.0060)) for s in (1, -1)]
    colum = S.Ellipsoid((0, -0.1070, -0.0395), (0.0042, 0.0085, 0.0040))
    nose = S.Union([bridge, hump, tip, colum] + alae, k=0.007)
    head = S.Union([head, nose], k=0.009)
    nostrils = S.Union([S.Ellipsoid((s * 0.0072 * nw, -0.1055, -0.0425), (0.0036 * nw, 0.0056, 0.0021)) for s in (1, -1)])
    if not low:
        head = S.Subtract(head, nostrils, k=0.0015)
    # nasolabial folds deepen with age
    nlf = S.Union([S.RoundCone((s * 0.0185, -0.0985, -0.036), (s * 0.030, -0.0900, -0.064), 0.0012) for s in (1, -1)])
    head = S.Subtract(head, nlf, k=0.004 + 0.003 * age)
    # eye sockets, eyeballs, lids
    eL, eR = _eyes(p)
    # the orbit: a shallow hollow under the brow, then the lid volume draped over
    # the ball, then the opening cut through it and the ball itself showing inside
    sockets = S.Union([S.Ellipsoid(e + np.array([0, -0.0125, 0.0022]), (0.0185, 0.0120, 0.0125)) for e in (eL, eR)])
    head = S.Subtract(head, sockets, k=0.007)
    mounds = [S.Ellipsoid(e + np.array([0, -0.0006, -0.0002]), (0.0168, 0.0142, 0.0139)) for e in (eL, eR)]
    head = S.Union([head] + mounds, k=0.005)
    if not low:
        head = S.Subtract(head, S.Union([_fissure(e, p) for e in (eL, eR)]), k=0.0009)
    balls = [S.Sphere(e, 0.0122) for e in (eL, eR)]
    corneas = [S.Sphere(e + np.array([0, -0.0052, 0.0004]), 0.0079) for e in (eL, eR)]
    head = S.Union([head] + balls + corneas, k=0.0006)
    # temples hollow a little with age and leanness
    temples = S.Union([S.Ellipsoid((s * 0.079 * w, -0.038, 0.030), (0.014, 0.030, 0.028)) for s in (1, -1)])
    head = S.Subtract(head, temples, k=0.025 + 0.02 * age)
    # neck with the Adam's apple and the sternocleidomastoids
    nk = p["neck"] * (1 - 0.14 * fem)
    neck = S.RoundCone((0, 0.014, -0.072), (0, 0.030, -0.205), 0.057 * nk, 0.064 * nk)
    scm = [S.RoundCone((s * 0.050 * nk, 0.020, -0.040), (s * 0.017, -0.030, -0.195), 0.0115 * nk) for s in (1, -1)]
    neckall = S.Union([neck] + scm, k=0.02)
    if fem < 0.5:
        neckall = S.Union([neckall, S.Ellipsoid((0, -0.030, -0.132), (0.0085, 0.010, 0.013))], k=0.012)
    head = S.Union([head, neckall], k=0.008)
    # the neck ends in a flat cut buried inside the collar
    cut = S.Plane((0, 0, -0.205), (0, 0, -1), (-0.2, -0.2, -0.3), (0.2, 0.2, 0.3))
    head = S.Intersect(head, cut)
    return head


# ------------------------------------------------------------------ hair & facial hair

def _az(Pt):
    """Azimuth around the vertical axis: 0 = straight ahead, +90 = character's left."""
    return np.degrees(np.arctan2(Pt[:, 0], -(Pt[:, 1] - 0.005)))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hairline_z(Pt, p):
    """Height of the hairline around the head (receding lifts the front and temples)."""
    az = np.abs(_az(Pt))
    rec = p["hairline"]
    front = 0.074 + 0.022 * rec
    temple = 0.060 + 0.030 * rec
    return np.interp(az, [0, 25, 45, 70, 95, 115, 140, 180],
                     [front, front - 0.003, temple, 0.046, 0.030, 0.020, -0.030, -0.058])


def sideburn_mask(Pt, p):
    """Hair in front of the ear, down to the ear lobe (longer for mutton chops)."""
    x, y, z = np.abs(Pt[:, 0]), Pt[:, 1], Pt[:, 2]
    bottom = -0.012 - 0.045 * p["sideburns"]
    # a strip in front of the ear that narrows toward its lower end
    u = np.clip((z - bottom) / (0.05 - bottom), 0, 1)
    front = -0.013 - 0.009 * u
    m = smoothstep(0.050, 0.058, x) * smoothstep(front - 0.003, front + 0.003, y) * smoothstep(0.004, -0.001, y)
    m *= smoothstep(bottom - 0.004, bottom + 0.006, z)
    if p["sideburns"] > 0:
        # chops widen forward over the cheek
        m = np.maximum(m, smoothstep(0.045, 0.058, x) * smoothstep(-0.050, -0.035, y) * smoothstep(0.012, 0.0, y)
                       * smoothstep(bottom - 0.008, bottom + 0.006, z) * smoothstep(0.03, 0.01, z) * p["sideburns"])
    return m


def hair_thickness(Pt, p):
    style = p["hair"]
    if style == "bald":
        return np.zeros(len(Pt))
    base = {"short": 0.0042, "crop": 0.0025, "slick": 0.0035, "bun": 0.0045, "long_back": 0.006}[style] * p["hair_len"]
    z = Pt[:, 2]
    hl = hairline_z(Pt, p)
    t = base * np.maximum(smoothstep(-0.002, 0.020, z - hl), 0.35 * sideburn_mask(Pt, p))
    az = _az(Pt)
    # more volume on the crown and the back, flatter at the temples
    t *= 0.8 + 0.5 * smoothstep(0.02, 0.10, z) + 0.2 * smoothstep(90, 170, np.abs(az))
    if style == "slick":
        # combed back: flat on top, a little lift at the back
        t *= 0.75 + 0.5 * smoothstep(120, 180, np.abs(az))
    if p["hairline"] > 0.5 and style != "bald":
        # a bald crown with a horseshoe of hair
        crown = smoothstep(0.075, 0.095, z) * smoothstep(-0.02, 0.06, -(Pt[:, 1] - 0.02) + 0.05)
        t *= 1 - 0.95 * crown
    return t


def hair_mask(Pt, p):
    return (hair_thickness(Pt, p) > 0.0008).astype(np.float32)


def brow_field(Pt, p):
    """Eyebrow volume: a band over each brow ridge, thicker at the inner end."""
    out = np.zeros(len(Pt))
    for s in (1, -1):
        q = Pt.copy()
        lat = q[:, 0] * s
        u = np.clip((lat - 0.008) / 0.046, 0, 1)        # 0 inner .. 1 outer
        zc = 0.0205 + 0.006 * np.sin(u * math.pi * 0.9) - 0.004 * u
        band = 1 - smoothstep(0.0025 + 0.0015 * (1 - u), 0.0045 + 0.002 * (1 - u), np.abs(q[:, 2] - zc))
        inx = smoothstep(0.004, 0.009, lat) * (1 - smoothstep(0.052, 0.060, lat))
        front = smoothstep(-0.06, -0.085, q[:, 1])
        out = np.maximum(out, band * inx * front * (1.0 - 0.3 * u))
    return out * p["brows"]


def moustache_field(Pt, p):
    """Moustache volume (0..1) over the upper lip; shapes differ in droop and reach."""
    kind = p["moustache"]
    if not kind:
        return np.zeros(len(Pt))
    x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
    ax = np.abs(x)
    front = smoothstep(-0.078, -0.094, y)
    if kind == "walrus":      # thick, drooping over the lip
        top, bot, wid, droop = -0.0465, -0.0655, 0.029, 2.5
    elif kind == "horseshoe":  # down past the mouth corners to the jaw
        top, bot, wid, droop = -0.0465, -0.063, 0.029, 0.0
    elif kind == "handlebar":  # waxed ends curling up
        top, bot, wid, droop = -0.047, -0.0585, 0.038, -1.5
    else:                      # chevron
        top, bot, wid, droop = -0.0465, -0.060, 0.026, 0.5
    b = bot - droop * ax * ax + (0.0 if kind != "handlebar" else 0.35 * np.maximum(ax - 0.022, 0))
    # the top follows the nostrils and falls away toward the corners of the mouth
    tt = top - 7.0 * ax * ax - 0.10 * np.maximum(ax - 0.010, 0)
    h = np.clip((tt - z) / np.maximum(tt - b, 1e-3), 0, 1)
    prof = np.clip(np.sin(np.pi * h), 0, 1) ** 0.6 * (0.55 + 0.45 * h)   # fuller at the lower edge
    side = np.clip(1 - (ax / wid) ** 2, 0, 1) ** 0.4
    m = prof * side * front
    if kind == "horseshoe":
        leg = smoothstep(0.022, 0.026, ax) * (1 - smoothstep(0.031, 0.035, ax)) * smoothstep(-0.105, -0.095, z) * (1 - smoothstep(-0.060, -0.050, z))
        m = np.maximum(m, leg * smoothstep(-0.070, -0.090, y))
    return m


def beard_field(Pt, p):
    """Where a beard/stubble grows: jaw, chin, cheeks below the cheekbone, upper lip."""
    x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
    ax = np.abs(x)
    cheek_line = -0.030 - 0.25 * np.maximum(0.045 - ax, 0)   # beard line over the cheek
    m = smoothstep(cheek_line + 0.006, cheek_line - 0.006, z)
    m *= smoothstep(0.022, 0.0, y)                          # stops at the ramus
    neckline = smoothstep(-0.165, -0.125, z)
    m *= neckline
    lips = np.exp(-((ax / 0.024) ** 2 + ((z + 0.066) / 0.0085) ** 2)) * smoothstep(-0.085, -0.095, y)
    m *= 1 - 0.95 * np.clip(lips, 0, 1)
    return np.clip(m, 0, 1)


BUN = (np.array([0.0, 0.094, 0.032]), 0.030)


def bun_mask(Pt, p):
    if p["hair"] != "bun":
        return np.zeros(len(Pt))
    c, r = BUN
    d = np.linalg.norm(Pt - c, axis=1) - r
    return smoothstep(0.006, 0.0, d)


def head_sdf(p, low=False):
    """Skull plus hair/brow/moustache/beard volumes as a small outward displacement."""
    base = skull(p, low)
    if p["hair"] == "bun":
        # hair gathered into a knot at the back of the head
        c, r = BUN
        base = S.Union([base, S.Ellipsoid(c, (r * 1.15, r * 0.85, r)), S.Ellipsoid(c + np.array([0, -0.012, 0.018]), (0.030, 0.018, 0.012))], k=0.012)
    bw = p["brows"]
    beard = p["beard"]

    def disp(Pt):
        t = hair_thickness(Pt, p)
        t = np.maximum(t, 0.0012 * bw * brow_field(Pt, p))
        t = np.maximum(t, 0.0022 * moustache_field(Pt, p))
        if beard > 0:
            t = np.maximum(t, 0.004 * max(beard - 0.3, 0) * beard_field(Pt, p))
        return -t.astype(np.float32)
    return S.Displace(base, disp, 0.012)


# ------------------------------------------------------------------ ears

def ear_sdf(p, side=1):
    """An auricle: a cupped plate hinged at the side of the head and flaring out
    toward the back, with a rolled helix rim, a carved concha, a tragus and a lobe."""
    es = p["ear"] * (1 - 0.1 * p["sex"])
    fl, tilt = math.radians(22), math.radians(12)
    A = np.array([side * 0.0645, 0.004, -0.008])           # front hinge, just ahead of the ear canal
    v = np.array([0.0, math.sin(tilt), math.cos(tilt)])    # up the ear, leaning back
    u = np.array([side * math.sin(fl), math.cos(fl), 0.0])  # back along the ear, flaring out
    u = u - (u @ v) * v
    u /= np.linalg.norm(u)
    n = side * np.cross(u, v)                               # out of the outer face
    W, Hh = 0.0165 * es, 0.031 * es
    C = A + u * 0.016 * es - v * 0.002

    def f(Pt):
        q = Pt - C
        a, b, c = q @ u, q @ v, q @ n
        bn = b / Hh
        w = W * (1.0 - 0.32 * np.clip(-bn, 0, 1) ** 1.6) * (1.0 + 0.08 * np.clip(bn, 0, 1))
        e = np.sqrt((a / w) ** 2 + bn ** 2)
        outline = (e - 1.0) * w
        c0 = -0.0045 * (1 - np.clip(e, 0, 1) ** 2)          # cupped: the middle sits closer to the head
        thick = 0.0017 + 0.0012 * np.clip(-bn - 0.55, 0, 1)
        plate = np.abs(c - c0) - thick
        body = np.maximum(outline, plate)
        # helix: a rolled rim over the top and down the back
        on = np.clip((bn + 0.45) * 2.0, 0, 1) * np.clip((a / w + 0.6) * 2.0, 0, 1)
        helix = np.sqrt(((e - 0.90) * w) ** 2 + (c - c0 - 0.0012) ** 2) - 0.0024 * on
        d = np.minimum(body, np.where(on > 0.05, helix, 1.0))
        # concha: a bowl carved into the outer face, low and forward
        ec = np.sqrt(((a + 0.002 * es) / (0.0085 * es)) ** 2 + ((b + 0.0045 * es) / (0.012 * es)) ** 2)
        carve_depth = 0.0022 * np.clip(1 - ec * ec, 0, 1)
        d = np.maximum(d, -((c0 + thick - carve_depth) - c) * (ec < 1) - (ec >= 1) * 1.0)
        # tragus: a small flap guarding the canal
        tr = np.linalg.norm(Pt - (C - u * 0.0115 * es - v * 0.006 * es + n * 0.0015), axis=1) - 0.0033
        return np.minimum(d, tr)
    return S.Fn(f, C - 0.045, C + 0.045)


# ------------------------------------------------------------------ game meshes

def _warp(n, knots, weights, lo, hi):
    """n+1 samples between lo and hi, denser where `weights` (at `knots`) is high."""
    x = np.linspace(lo, hi, 2001)
    w = np.interp(x, knots, weights)
    c = np.concatenate([[0], np.cumsum(0.5 * (w[1:] + w[:-1]) * np.diff(x))])
    c /= c[-1]
    return np.interp(np.linspace(0, 1, n + 1), c, x)


def low_head_grid(field, n_az=36, n_el=24, n_neck=3):
    """Cast rays from inside the skull onto the (smoothed) head field on a
    face-weighted latitude/longitude grid; the neck is a short tube below.
    Returns vertices, quads/tris and per-loop UVs (the grid parameter itself,
    so the face - which has most rows and columns - gets most of the texels)."""
    az = _warp(n_az, [-180, -120, -70, 0, 70, 120, 180], [0.45, 0.6, 1.0, 1.15, 1.0, 0.6, 0.45], -180, 180)[:-1]
    el = _warp(n_el - 1, [-60, -35, 0, 25, 45, 90], [0.8, 1.1, 1.2, 1.0, 0.55, 0.4], -60, 84)
    C = np.array([0, 0.005, 0.0], np.float32)
    rows = []
    # neck rows, bottom up: horizontal rays from the neck axis
    for z in np.linspace(-0.200, -0.128, n_neck):
        yax = np.interp(z, [-0.205, -0.072], [0.030, 0.014])
        a = np.radians(az)
        D = np.stack([np.sin(a), -np.cos(a), np.zeros_like(a)], 1).astype(np.float32)
        O = np.tile(np.array([0, yax, z], np.float32), (len(a), 1))
        t, ok = S.raycast(field, O, D, 0.12)
        rows.append(O + D * t[:, None])
    for e in el:
        a = np.radians(az)
        er = math.radians(e)
        D = np.stack([np.sin(a) * math.cos(er), -np.cos(a) * math.cos(er), np.full_like(a, math.sin(er))], 1).astype(np.float32)
        O = np.tile(C, (len(a), 1))
        t, ok = S.raycast(field, O, D, 0.16)
        rows.append(O + D * t[:, None])
    # crown pole
    t, ok = S.raycast(field, C[None], np.array([[0, 0.05, 1]], np.float32) / np.linalg.norm([0, 0.05, 1]), 0.16)
    pole = C + np.array([0, 0.05, 1], np.float32) / np.linalg.norm([0, 0.05, 1]) * t[0]
    V = np.concatenate(rows + [pole[None]], 0)
    nr, nc = len(rows), len(az)
    faces, uvs = [], []
    vrow = np.linspace(0, 1, nr + 1)
    for r in range(nr - 1):
        for c in range(nc):
            c2 = (c + 1) % nc
            a, b = r * nc + c, r * nc + c2
            d_, e_ = (r + 1) * nc + c, (r + 1) * nc + c2
            faces.append((a, b, e_, d_))
            u0, u1 = c / nc, (c + 1) / nc
            uvs.append([(u0, vrow[r]), (u1, vrow[r]), (u1, vrow[r + 1]), (u0, vrow[r + 1])])
    pi = len(V) - 1
    for c in range(nc):
        c2 = (c + 1) % nc
        faces.append(((nr - 1) * nc + c, (nr - 1) * nc + c2, pi))
        uvs.append([(c / nc, vrow[nr - 1]), ((c + 1) / nc, vrow[nr - 1]), ((c + 0.5) / nc, 1.0)])
    # the grid's u runs from the back seam around to the back seam (az -180..180)
    return V, faces, uvs


def relax_rows(V, nc, nrows, field, iters=3):
    """A light tangential smoothing of the ray-cast grid (rays fan out unevenly
    where the surface is oblique), re-projected onto the field each time."""
    for _ in range(iters):
        G = V[: nrows * nc].reshape(nrows, nc, 3)
        avg = G.copy()
        avg[1:-1] = 0.25 * (np.roll(G, 1, 1) + np.roll(G, -1, 1))[1:-1] + 0.25 * (G[:-2] + G[2:])
        G = 0.5 * G + 0.5 * avg
        V[: nrows * nc] = G.reshape(-1, 3)
        V[: nrows * nc] = S.project_to_surface(field, V[: nrows * nc], iters=3, clamp=0.004)
    return V


def skin_detail(field, p):
    """Fine relief for the texture bake: skin grain, and with age the forehead
    lines and crow's feet. Too small for geometry, just right for a normal map."""
    from . import texture as T
    age = p["age"]

    def f(Pt):
        x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
        grain = (T.value_noise(Pt, 520, seed=61) - 0.5) * 0.00010 + (T.value_noise(Pt, 1400, seed=63) - 0.5) * 0.00004
        fore = T.smoothstep(0.030, 0.040, z) * (1 - T.smoothstep(0.062, 0.074, z)) * T.smoothstep(-0.07, -0.085, y) * (1 - T.smoothstep(0.035, 0.05, np.abs(x)))
        lines = np.sin(z * 2 * np.pi / 0.0085 + 3.0 * T.value_noise(Pt, 60, seed=65)) ** 8
        crow = 0.0
        for s_ in (1, -1):
            c = np.array([s_ * 0.047, -0.070, 0.002])
            q = Pt - c
            r = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
            ang = np.arctan2(q[:, 2], np.abs(q[:, 0]))
            m = T.smoothstep(0.004, 0.008, r) * (1 - T.smoothstep(0.014, 0.022, r)) * T.smoothstep(0.0, 0.004, q[:, 0] * s_)
            crow = crow + m * np.sin(ang * 9.0) ** 12
        wr = age * (0.00030 * fore * lines + 0.00022 * crow)
        return (grain + wr).astype(np.float32)
    return S.Displace(field, f, 0.0006)


_AZ_W = ([-180, -120, -70, -25, 0, 25, 70, 120, 180], [0.45, 0.6, 1.0, 1.3, 1.4, 1.3, 1.0, 0.6, 0.45])
_EL_W = ([-84, -60, -35, 0, 25, 45, 90], [0.55, 0.9, 1.2, 1.3, 1.0, 0.45, 0.35])


def _cdf(knots, weights, lo, hi):
    x = np.linspace(lo, hi, 4001)
    w = np.interp(x, knots, weights)
    c = np.concatenate([[0], np.cumsum(0.5 * (w[1:] + w[:-1]) * np.diff(x))])
    return x, c / c[-1]


def head_uv(ob, face_scale=2.2):
    """Unwrap a head as two islands - the face, and the scalp with the neck -
    split along the hairline, the ears and under the jaw, with the scalp also
    cut down the back of the head. Angle-based flattening never folds (a
    radial projection does, around the lids, nose and jaw), and the face island
    is then enlarged so it gets most of the texels."""
    import bmesh
    from . import bl, bake as B
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    cls = {}
    side = {}
    for f in bm.faces:
        c = np.array(f.calc_center_median()) - HEAD_ORIGIN
        q = c - np.array([0, 0.005, 0.0])
        az = math.degrees(math.atan2(abs(q[0]), -q[1]))
        el = math.degrees(math.atan2(q[2], math.hypot(q[0], q[1])))
        cls[f.index] = 1 if (az < 68 and -56 < el < 38) else 0
        side[f.index] = c[0] > 0
        f.select = True
    back = lambda f: (np.array(f.calc_center_median()) - HEAD_ORIGIN)[1] > -0.035
    for e in bm.edges:
        lf = e.link_faces
        e.seam = False
        if len(lf) == 2:
            a, b = lf
            if cls[a.index] != cls[b.index]:
                e.seam = True
            elif cls[a.index] == 0 and side[a.index] != side[b.index] and back(a) and back(b):
                e.seam = True
    bm.to_mesh(me)
    bm.free()
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    B._edit([ob], lambda: bpy_unwrap())
    uv = bl.get_uv(ob)
    fl = np.zeros(len(me.loops), bool)
    for p in me.polygons:
        if cls[p.index]:
            fl[p.loop_start:p.loop_start + p.loop_total] = True
    c = uv[fl].mean(0)
    uv[fl] = (uv[fl] - c) * face_scale + c
    bl.set_uv(ob, uv)


def bpy_unwrap():
    import bpy
    bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, margin=0.02)


def make(name, p, look, coll=None, tris=1900):
    """Build a head's game meshes (radial-grid head + two decimated ears) and
    return bake jobs: (mesh, field, paint, local->world offset, uv weight)."""
    from . import bl, polygonize as PG, texture as T
    field = head_sdf(p)
    if look.get("scar"):
        base = field
        field = S.Displace(base, lambda Pt: -T.scar_displacement(Pt, look).astype(np.float32), 0.001)
    detailed = skin_detail(field, p)
    # game mesh: the sculpt decimated (it keeps lids, nostrils, lips and the jaw
    # line where they matter), with UVs from the face-weighted radial map
    Vd, Qd = PG.mesh_sdf(field, (-0.11, -0.15, -0.205), (0.11, 0.13, 0.14), 0.0016, blur=1.2)
    lo = bl.mesh_from_arrays(name, Vd + HEAD_ORIGIN, Qd, coll)
    bl.decimate(lo, tris, symmetry=True)
    head_uv(lo)

    def paint(Pt):
        c, r = T.head_paint(Pt, p, look)
        return c, r, np.zeros(len(Pt))

    def paint_ear(Pt):
        c, r = T.head_paint(Pt, p, look, is_ear=True)
        return c, r, np.zeros(len(Pt))
    jobs = [dict(ob=lo, field=detailed, paint=paint, origin=HEAD_ORIGIN, weight=3.4, ao_field=field)]
    for side, tag in ((1, "L"), (-1, "R")):
        e = ear_sdf(p, side)
        Ve, Qe = PG.mesh_sdf(e, e.lo, e.hi, 0.0008, blur=1.0)
        elo = bl.mesh_from_arrays(f"{name}.ear.{tag}", Ve + HEAD_ORIGIN, Qe, coll)
        bl.decimate(elo, 130, symmetry=False)
        jobs.append(dict(ob=elo, field=e, paint=paint_ear, origin=HEAD_ORIGIN, weight=1.4, ao_field=e, smart_uv=True, uv_angle=80))
    return jobs
