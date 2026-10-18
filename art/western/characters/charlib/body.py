"""The clothed body: shirt and trousers sculpted as one field around the skeleton.

Under the clothes nobody sees anatomy, only what cloth does over it: a shirt
blousing over the belt, a sleeve that is loose above the elbow and rolled
below it, trousers that sag at the seat, break at the knee and bunch where
they are stuffed into boots. So the body is modelled as the garments' outer
surface directly - tubes along the skeleton, blended where limbs meet - with
fold displacement that only the normal map will carry.

World space (Blender): Z up, facing -Y, left = +X, boot soles on z = 0.
"""
import numpy as np
from . import sdf as S
from .skeleton import JOINTS

DEFAULT = dict(
    chest=1.0,        # chest girth
    belly=0.0,        # 0 flat .. 1 a proper paunch
    shoulders=1.0,    # shoulder width
    hips=1.0,
    arms=1.0,         # upper arm / forearm thickness
    legs=1.0,
    shirt_loose=1.0,  # extra ease in the shirt
    sleeves="rolled",  # rolled | full | none
    tucked=True,      # trousers into the boots
    boot_top=0.40,    # height the trousers disappear into the boots
    female=0.0,
)


def P(**kw):
    p = dict(DEFAULT)
    p.update(kw)
    return p


def _j(name, end=0):
    return JOINTS[name][end]


def lerp(a, b, t):
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def torso_tube(p, top=1.530, bottom=0.975):
    """The shirt's torso from the waist (inside the trousers) to the collar."""
    ch, bl, sh, lo = p["chest"], p["belly"], p["shoulders"], p["shirt_loose"]
    fem = p["female"]
    # z, half width, half depth, centre y  (a loose cotton shirt over a lean man)
    st = [
        (bottom, 0.150, 0.106, 0.006),
        (1.050, 0.157 + 0.02 * bl, 0.113 + 0.035 * bl, -0.002 - 0.02 * bl),
        (1.120, 0.158 + 0.012 * bl, 0.112 + 0.03 * bl, -0.008 - 0.018 * bl),
        (1.200, 0.165 * ch, 0.115 * ch + 0.012 * bl, -0.010 - 0.008 * bl),
        (1.280, 0.175 * ch, 0.120 * ch, -0.012),
        (1.350, 0.180 * ch * sh, 0.119 * ch, -0.009),
        (1.415, 0.182 * sh, 0.110, 0.000),
        (1.470, 0.160 * sh, 0.096, 0.012),
        (1.505, 0.108, 0.080, 0.020),
        (top, 0.072, 0.068, 0.024),
    ]
    st = [(z, rx * (1 + 0.03 * (lo - 1)), ry * (1 + 0.03 * (lo - 1)), cy) for z, rx, ry, cy in st]
    if fem:
        # narrower shoulders and waist, a bust
        st = [(z, rx * (1 - 0.08 * fem * (z > 1.3)) * (1 - 0.1 * fem * (1.05 < z < 1.2)), ry, cy) for z, rx, ry, cy in st]
    pts = [(0, cy, z) for z, rx, ry, cy in st]
    return S.Tube(pts, [s[1] for s in st], [s[2] for s in st], side=(1, 0, 0))


def arm_parts(p, side):
    """Sleeve over the upper arm and the elbow, with a rolled cuff below it."""
    s = 1 if side == "L" else -1
    tag = "L" if s > 0 else "R"
    sh = np.array(_j(f"upper_arm.{tag}"))
    el = np.array(_j(f"forearm.{tag}"))
    wr = np.array(_j(f"hand.{tag}"))
    a = p["arms"] * p["shirt_loose"] ** 0.3
    parts = []
    # shoulder cap: a deltoid mound over the joint, the shirt draped on it
    parts.append(S.Ellipsoid(sh + np.array([s * 0.006, 0.0, 0.012]), (0.068 * a, 0.064 * a, 0.064 * a)))
    up = S.RoundCone(sh - (el - sh) * 0.10, el, 0.060 * a, 0.050 * a)
    parts.append(up)
    sleeve = p["sleeves"]
    if sleeve == "rolled":
        d = (wr - el) / np.linalg.norm(wr - el)
        cuff_c = el + d * 0.085
        parts.append(S.RoundCone(el, cuff_c, 0.050 * a, 0.048 * a))
        # the roll: a fat ring of folded cloth
        R = _frame_z(d)
        parts.append(S.Torus(cuff_c - d * 0.006, 0.044 * a, 0.0115, R))
    elif sleeve == "full":
        parts.append(S.RoundCone(el, wr - (wr - el) * 0.03, 0.046 * a, 0.036 * a))
        d = (wr - el) / np.linalg.norm(wr - el)
        parts.append(S.Cylinder(wr - d * 0.035, 0.039 * a, 0.022, _frame_z(d), rad=0.006))
    return parts


def _frame_z(d):
    """Rotation whose third column is d (a local Z along the limb)."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    t = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    x = np.cross(t, d)
    x /= np.linalg.norm(x)
    y = np.cross(d, x)
    return np.stack([x, y, d], 1).astype(np.float32)


def shirt(p):
    t = torso_tube(p)
    arms = arm_parts(p, "L") + arm_parts(p, "R")
    body = S.Union([t] + arms, k=0.035)
    # collar: a folded band standing around the neck
    col = S.Torus((0, 0.022, 1.530), 0.074, 0.012, S.rot_x(-12))
    body = S.Union([body, col], k=0.012)
    return body


def trousers(p):
    hp, lg = p["hips"], p["legs"]
    st = [
        (1.075, 0.160 * hp, 0.113, 0.004),   # waistband, over the shirt
        (1.030, 0.163 * hp, 0.118, 0.006),
        (0.960, 0.172 * hp, 0.124, 0.010),   # hips and seat
        (0.890, 0.170 * hp, 0.120, 0.008),
        (0.845, 0.150 * hp, 0.105, 0.004),
    ]
    pts = [(0, cy, z) for z, rx, ry, cy in st]
    pelvis = S.Tube(pts, [s[1] for s in st], [s[2] for s in st])
    legs = []
    top_z = p["boot_top"]
    for s, tag in ((1, "L"), (-1, "R")):
        hipj = np.array(_j(f"thigh.{tag}"))
        kn = np.array(_j(f"shin.{tag}"))
        an = np.array(_j(f"foot.{tag}"))
        legs.append(S.RoundCone(hipj + np.array([s * 0.004, 0.004, -0.02]), kn, 0.086 * lg, 0.063 * lg))
        # knee: a little bag of cloth in front
        legs.append(S.Ellipsoid(kn + np.array([0, -0.012, 0.0]), (0.060 * lg, 0.062 * lg, 0.07)))
        # shin down to where it vanishes into the boot, bunched just above it
        t = (kn[2] - top_z) / (kn[2] - an[2])
        bt = lerp(kn, an, t)
        legs.append(S.RoundCone(kn, bt + np.array([0, 0, 0.015]), 0.060 * lg, 0.056 * lg))
        legs.append(S.Ellipsoid(bt + np.array([0, 0.002, 0.03]), (0.060 * lg, 0.060 * lg, 0.035)))
    return S.Union([pelvis] + legs, k=0.03)


def cuts(p):
    """Planes (point, normal) where the closed field is opened afterwards."""
    out = [((0, 0.02, 1.550), (0, 0.15, 1.0))]   # collar top
    top_z = p["boot_top"]
    for tag in ("L", "R"):
        kn = np.array(_j(f"shin.{tag}"))
        an = np.array(_j(f"foot.{tag}"))
        t = (kn[2] - top_z) / (kn[2] - an[2])
        out.append((tuple(lerp(kn, an, t) - np.array([0, 0, 0.005])), (0, 0, -1)))
        if p["sleeves"] == "rolled":
            el = np.array(_j(f"forearm.{tag}"))
            wr = np.array(_j(f"hand.{tag}"))
            d = (wr - el) / np.linalg.norm(wr - el)
            out.append((tuple(el + d * 0.090), tuple(d)))
    return out
