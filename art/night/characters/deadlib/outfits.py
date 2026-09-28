"""What they died in: six outfits for the walkers, each a whole set of
clothes (`var.outfit.<name>`) worn over `char.walker`'s head and hands.

    farmer          chambray work shirt, sleeves rolled; denim bib overalls; work boots
    trucker         red-black flannel, sleeves rolled; jeans; boots; a mesh-back cap
    waitress        a mint uniform dress with a white collar; a stained apron; flat shoes
    hunter          blaze-orange vest over an olive thermal; canvas trousers; boots; orange cap
    mechanic_small  grey-blue coveralls, a name patch, grease to the elbows; boots
    suit            charcoal jacket and trousers, white shirt, a dark tie; dress shoes

Garments are built by High Noon's ring-topology builders (charlib.garments),
snapped onto its garment fields, then aged here for the grave: ground-in mud
climbing from the hems, old dark stains down the fronts (dried, never wet:
PG-13), tears painted with frayed pale fibre at their edges, a sleeve's cuff
torn, knees black from falling.
"""

import math

import numpy as np

from .common import S, BD, G, R, GR, OF, HD, C, PT, bl, srgb, smoothstep, value_noise, fbm, JOINTS
from . import meshfix as MF
from . import heads as H


def grave_wear(P, col, rough, amount=1.0, seed=0, stains=True, tears=True, mud=True):
    """Age any garment paint for the grave, in place."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    n = len(P)
    if mud:
        m = np.clip((0.75 - z) / 0.75, 0, 1) ** 1.3 * (0.4 + 0.9 * fbm(P, 16, 3, seed=seed + 1))
        m += 0.5 * smoothstep(0.55, 0.8, fbm(P, 9, 3, seed=seed + 2)) * smoothstep(0.7, 0.4, z)
        m = np.clip(m * amount, 0, 1)
        col = col * (1 - 0.6 * m[:, None]) + srgb(0.22, 0.17, 0.12) * 0.6 * m[:, None]
        rough = rough * (1 - 0.3 * m) + 0.95 * 0.3 * m
        # knees black from falling
        for tag in ("L", "R"):
            kn = np.array(JOINTS[f"shin.{tag}"][0])
            k = np.exp(-(((x - kn[0]) / 0.07) ** 2 + ((z - kn[2]) / 0.09) ** 2)) * (y < 0.0) * amount
            col = col * (1 - 0.5 * k[:, None]) + srgb(0.12, 0.10, 0.08) * 0.5 * k[:, None]
    if stains:
        # an old dark stain down the front from the collar, and splashes
        front = smoothstep(0.0, -0.06, y)
        run = smoothstep(0.62, 0.78, fbm(np.stack([x * 3, y * 3, z * 0.8], 1), 4.0, 3, seed=seed + 3)) * front * smoothstep(0.9, 1.45, z)
        spl = smoothstep(0.78, 0.86, value_noise(P, 26, seed=seed + 4)) * front
        s = np.clip((run + 0.7 * spl) * amount, 0, 1)
        col = col * (1 - 0.65 * s[:, None]) + srgb(0.14, 0.06, 0.05) * 0.65 * s[:, None]
        rough = rough - 0.12 * s
    if tears:
        # tears: a dark hole with a frayed pale rim
        t = fbm(P, 11, 4, seed=seed + 5)
        hole = smoothstep(0.735, 0.75, t) * amount
        rim = (smoothstep(0.70, 0.735, t) - smoothstep(0.735, 0.75, t)) * amount
        fray = value_noise(P * np.array([1, 1, 4]), 900, seed=seed + 6)
        col = col * (1 - 0.35 * (rim * fray)[:, None]) + srgb(0.62, 0.58, 0.50) * 0.35 * (rim * fray)[:, None]
        col = col * (1 - 0.88 * hole[:, None]) + srgb(0.04, 0.03, 0.03) * 0.88 * hole[:, None]
    grime = smoothstep(0.5, 0.85, fbm(P, 30, 3, seed=seed + 7)) * 0.35 * amount
    col = col * (1 - grime[:, None])
    return np.clip(col, 0, 1), np.clip(rough, 0.2, 1)


def plaid(P, a, b, band=0.055, seed=0):
    """Flannel: a two-colour check, bands across and down, a twill haze."""
    x, z = P[:, 0], P[:, 2]
    y = P[:, 1]
    u = x + 0.3 * y
    s1 = smoothstep(0.35, 0.5, np.abs(np.sin(u * math.pi / band)))
    s2 = smoothstep(0.35, 0.5, np.abs(np.sin(z * math.pi / band)))
    thin = (np.abs(np.sin(u * math.pi / (band * 0.25))) < 0.12) | (np.abs(np.sin(z * math.pi / (band * 0.25))) < 0.12)
    A, Bc = srgb(*a), srgb(*b)
    k = 0.5 * (1 - s1) + 0.5 * (1 - s2)
    col = A[None, :] * (1 - k[:, None]) + Bc[None, :] * k[:, None]
    col = np.where(thin[:, None], col * 0.7 + srgb(0.8, 0.75, 0.6) * 0.1, col)
    return col


def fabric(P, color, kind="cotton", seed=0, wear=1.0, pattern=None, stains=True, tears=True):
    c, r, m = PT.fabric(P, color, kind, dust_amt=0.0, fade=0.3, seed=seed, grime=0.3)
    if pattern is not None:
        c = pattern(P) * (c / np.maximum(np.asarray(srgb(*color))[None, :], 1e-3)).clip(0.6, 1.4)
    c, r = grave_wear(P, c, r, wear, seed=seed + 100, stains=stains, tears=tears)
    return c, r, m


# ---------------------------------------------------------------------------
# Parts

def shirt_part(bp, name, paint, coll=None, weight=1.0):
    from .common import C as _C
    shf = BD.shirt(bp)
    rm = G.build_shirt(bp, shf)
    ob = R.to_blender(rm, name, coll)
    return dict(ob=ob, field=S.Displace(shf, _C.sleeve_folds(bp), 0.006), paint=paint, origin=np.zeros(3), weight=weight, ao_field=shf)


def trousers_part(bp, name, paint, coll=None, weight=0.7):
    from .common import C as _C
    trf = BD.trousers(bp)
    rt = G.build_trousers(bp, trf)
    ob = R.to_blender(rt, name, coll)
    return dict(ob=ob, field=S.Displace(trf, _C.trouser_folds(bp), 0.006), paint=paint, origin=np.zeros(3), weight=weight, ao_field=trf)


def boots_parts(prefix, color, coll=None, shoes=False, top=None, tris=380, shine=0.0, muddy=1.0):
    out = []
    for side in ("L", "R"):
        if shoes:
            bf, t = GR.boot_sdf(side, top=0.13, heel=0.022, shaft_r=0.046, spur=False)
        else:
            bf, t = GR.boot_sdf(side, top=top or 0.30, heel=0.03, shaft_r=0.058, spur=False)
        x0 = 0.105 if side == "L" else -0.105
        ztop = (0.13 if shoes else (top or 0.30)) + 0.06
        ob = MF.decimated(f"{prefix}.boot.{side}", bf, (x0 - 0.08, -0.23, -0.01), (x0 + 0.08, 0.14, ztop), 0.0016, tris, coll)

        def paint(P, color=color):
            c, r, m = PT.leather(P, color, dust_amt=0.0, wear=0.5, seed=31, shine=shine)
            sole = P[:, 2] < 0.018
            c[sole] *= 0.4
            laces = (np.abs(P[:, 0] - np.sign(P[:, 0]) * 0.105) < 0.018) & (P[:, 1] < -0.02) & (P[:, 2] > 0.06) & \
                (np.abs(np.sin(P[:, 2] * 180)) > 0.7)
            c[laces] = srgb(0.3, 0.26, 0.2)
            c, r = grave_wear(P, c, r, muddy, seed=33, stains=False, tears=False)
            return c, r, m
        out.append(dict(ob=ob, field=bf, paint=paint, origin=np.zeros(3), weight=0.55, ao_field=bf, smart_uv=True, uv_angle=80))
    return out


def belt_part(prefix, coll=None, color=(0.14, 0.09, 0.06)):
    tb = GR.trouser_belt()
    ob = MF.decimated(f"{prefix}.belt", tb, (-0.2, -0.16, 1.0), (0.2, 0.16, 1.1), 0.0015, 240, coll)

    def paint(P):
        c, r, m = PT.leather(P, color, 0.2, 0.5, seed=41)
        bk = (P[:, 1] < -0.118) & (np.abs(P[:, 0]) < 0.027)
        mc, mr, mm = PT.metal(P, (0.45, 0.42, 0.36), 0.45, rust=0.6)
        c[bk], r[bk], m[bk] = mc[bk], mr[bk], mm[bk]
        return c, r, m
    return dict(ob=ob, field=tb, paint=paint, origin=np.zeros(3), weight=0.5, ao_field=tb, smart_uv=True, uv_angle=80)


_HEAD = {}


def walker_head_field():
    """The walker's head sculpt (what a cap has to fit), built once."""
    if "f" not in _HEAD:
        from . import bodies
        wh = bodies.WALKER_HEAD
        _HEAD["f"] = H.head_sdf(H.P(**{k: v for k, v in wh.items() if k != "dead"}, dead=wh["dead"]))
    return _HEAD["f"]


def cap_part(prefix, paint, coll=None, visor=0.075, tris=520, crown=1.0):
    """A ball cap on the dead head, in the head's frame, rigid on the head
    bone: the crown is the head's own sculpt pushed out 6 mm (it clears the
    short hair and never floats), raised a little at the top, cut along a
    band that runs low at the nape and across the brow; a curved visor."""
    head = walker_head_field()
    inner = S.Union([S.Offset(head, 0.006), S.Ellipsoid((0, -0.014, 0.080), (0.060, 0.074, 0.034 + 0.008 * crown))], k=0.02)
    shell = S.Shell(inner, 0.0025)
    # the band: 4.5 cm above the eyes at the brow, level with them at the nape
    n = np.array([0.0, -0.04, -0.19])
    n /= np.linalg.norm(n)
    band = S.Plane((0, -0.09, 0.045), tuple(n), (-0.2, -0.2, -0.1), (0.2, 0.2, 0.2))
    cap = S.Intersect(shell, band, k=0.002)
    button = S.Sphere((0.0, -0.004, 0.118 + 0.006 * crown), 0.005)

    def vis(Pt):
        x, y, z = Pt[:, 0], Pt[:, 1], Pt[:, 2]
        # a curved plate in front: lens-shaped outline, bent down at the sides
        yy = y + 0.094
        out = np.sqrt((x / 0.085) ** 2 + (np.maximum(-yy, 0) / visor) ** 2) - 1.0
        zc = 0.047 - 0.25 * x * x - 0.10 * np.maximum(-yy, 0)
        plate = np.maximum(np.abs(z - zc) - 0.0028, out * 0.05)
        plate = np.maximum(plate, yy - 0.006)
        return plate.astype(np.float32)
    v = S.Fn(vis, (-0.1, -0.094 - visor - 0.01, 0.0), (0.1, -0.06, 0.07))
    f = S.Union([cap, button, v], k=0.003)
    ob = MF.decimated(f"{prefix}.cap", f, (-0.1, -0.19, -0.02), (0.1, 0.13, 0.15), 0.0012, tris, coll, M=np.eye(3), o=H.HEAD_ORIGIN, symmetry=True)
    return dict(ob=ob, field=f, paint=paint, origin=H.HEAD_ORIGIN, weight=0.5, ao_field=f, smart_uv=True, uv_angle=70,
                skin=("rigid", "head"))


def bib_part(prefix, bp, paint, coll=None, tris=700):
    """The bib and straps of a pair of overalls, over the shirt."""
    torso = S.Offset(BD.torso_tube(bp), 0.013)
    front = S.Fn(lambda P: np.maximum.reduce([P[:, 1] + 0.035, np.abs(P[:, 0]) - (0.13 - 0.12 * np.clip((P[:, 2] - 1.05) / 0.4, 0, 1) * 0.3),
                                              P[:, 2] - 1.36, 1.02 - P[:, 2]]).astype(np.float32),
                 (-0.2, -0.3, 0.95), (0.2, 0.0, 1.4))
    bib = S.Intersect(S.Shell(torso, 0.0035), front, k=0.004)
    straps = []
    for s in (1, -1):
        a = (s * 0.095, -0.118, 1.35)
        top = (s * 0.115, 0.01, 1.515)
        back = (s * 0.05, 0.125, 1.18)
        straps += [S.RoundCone(a, top, 0.009), S.RoundCone(top, back, 0.009)]
    buckles = [S.Box((s * 0.095, -0.124, 1.345), (0.014, 0.004, 0.018), rad=0.002) for s in (1, -1)]
    f = S.Union([bib] + straps + buckles, k=0.006)
    ob = MF.decimated(f"{prefix}.bib", f, (-0.2, -0.16, 0.95), (0.2, 0.16, 1.56), 0.0016, tris, coll, symmetry=True)
    return dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=f, smart_uv=True, uv_angle=70)


def coat_part(bp, name, paint, hem_z=0.8, flare=0.8, coll=None, seed=0):
    f = G.coat_field(bp, hem_z, flare)
    rm = G.build_coat(bp, f, hem_z=hem_z, flare=flare, vent=hem_z < 0.7)
    ob = R.to_blender(rm, name, coll)

    def folds(P):
        th = np.arctan2(P[:, 0], -P[:, 1])
        return (-0.003 * smoothstep(0.95, 0.85, P[:, 2]) * np.sin(th * 7 + 3 * value_noise(P, 8, seed=seed)) ** 2).astype(np.float32)
    return dict(ob=ob, field=S.Displace(f, folds, 0.004), paint=paint, origin=np.zeros(3), weight=0.45, ao_field=f,
                skin=("coat", hem_z))


def vest_part(bp, name, paint, coll=None, tris=900):
    """A sleeveless vest over the shirt: the shirt's torso pushed out a
    little more than a centimetre and cut to a shell from the hip to the
    shoulders, a V down the front to the breastbone, the arms left out."""
    torso = S.Offset(BD.torso_tube(bp), 0.014)

    def cut(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        body = np.maximum(0.99 - z, z - 1.50)
        v = np.where(y < 0, np.abs(x) - np.clip((z - 1.24) * 0.42, 0, 0.1), 1.0)           # the V at the neck
        arms = np.abs(x) - (0.160 - 0.25 * np.clip(z - 1.32, 0, 0.2))                      # armholes open
        arms = np.where(z > 1.30, arms, -1.0)
        return np.maximum.reduce([body, -v, arms]).astype(np.float32)
    f = S.Intersect(S.Shell(torso, 0.0035), S.Fn(cut, (-0.3, -0.3, 0.9), (0.3, 0.3, 1.6)), k=0.004)
    ob = MF.decimated(name, f, (-0.24, -0.2, 0.95), (0.24, 0.2, 1.56), 0.0016, tris, coll, symmetry=True)
    return dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=f, smart_uv=True, uv_angle=70)


# ---------------------------------------------------------------------------
# The waitress's uniform: a 1950s diner dress to just below the knee

UNIFORM_TORSO = [  # z, half width, half depth, centre y: a fitted bodice, a small round collar
    (1.000, 0.150, 0.112, 0.004), (1.080, 0.128, 0.094, -0.004), (1.160, 0.136, 0.100, -0.012),
    (1.240, 0.148, 0.112, -0.022), (1.300, 0.150, 0.110, -0.018), (1.360, 0.152, 0.100, -0.008),
    (1.415, 0.158, 0.094, 0.000), (1.465, 0.130, 0.086, 0.012), (1.505, 0.078, 0.070, 0.022), (1.535, 0.062, 0.058, 0.024)]
UNIFORM_SKIRT = [  # an A-line from the waist to the hem, room for a stride
    (1.080, 0.128, 0.094, -0.004), (1.020, 0.162, 0.132, 0.008), (0.920, 0.186, 0.150, 0.012), (0.780, 0.206, 0.162, 0.010),
    (0.640, 0.222, 0.172, 0.008), (0.540, 0.232, 0.178, 0.006), (0.470, 0.236, 0.180, 0.006)]
UNIFORM_HEM = 0.47


def uniform_field():
    from .common import C as _C
    from charlib.garments import arm_path, _table_profile
    from charlib.body import _frame_z
    top = S.Tube([(0, t[3], t[0]) for t in UNIFORM_TORSO], [t[1] for t in UNIFORM_TORSO], [t[2] for t in UNIFORM_TORSO])
    bust = S.Union([S.Ellipsoid((s * 0.050, -0.086, 1.262), (0.052, 0.042, 0.050)) for s in (1, -1)], k=0.02)
    parts = [top, bust]
    for tag in ("L", "R"):
        sh, el, wr = arm_path(tag)
        parts.append(S.Ellipsoid(sh, (0.056, 0.056, 0.050)))
        parts.append(S.RoundCone(sh - (el - sh) * 0.08, el, 0.058, 0.047))
        parts.append(S.RoundCone(el, wr - (wr - el) * 0.04, 0.047, 0.043))
        d = (wr - el) / np.linalg.norm(wr - el)
        parts.append(S.Cylinder(wr - d * 0.04, 0.046, 0.02, _frame_z(d), rad=0.005))
    bodice = S.Union(parts, k=0.03)
    zs = [t[0] for t in UNIFORM_SKIRT][::-1]
    prof = _table_profile(UNIFORM_SKIRT)
    skirt = S.Tube([(0, prof(z)[2], z) for z in zs], [prof(z)[0] for z in zs], [prof(z)[1] for z in zs])
    return S.Union([bodice, skirt], k=0.03)


def build_uniform(field, M=28, arm_n=12):
    from charlib.garments import build_torso_with_arms, _table_profile
    rm = R.RingMesh()
    skirt_z = [UNIFORM_HEM, 0.56, 0.66, 0.78, 0.90, 1.00]
    top_z = [1.080, 1.140, 1.200, 1.255, 1.300, 1.350, 1.405, 1.462, 1.500, 1.520, 1.535]
    top = _table_profile(UNIFORM_TORSO)
    skirt = _table_profile(UNIFORM_SKIRT)

    def prof(z):
        return top(z) if z >= 1.08 else skirt(z)
    arm_rings = [(0.045, 0.066), (0.100, 0.063), (0.160, 0.058), (0.215, 0.052), (0.262, 0.049),
                 (0.292, 0.048), (0.318, 0.047), (0.36, 0.047), (0.42, 0.046), (0.48, 0.046), (0.525, 0.046)]
    out = build_torso_with_arms(rm, None, M, arm_n, skirt_z + top_z, arm_rings, "full", "", inflate=0.0,
                                profile=prof, armpit=len(skirt_z) + 5, root_r=0.084)
    for i in range(len(skirt_z)):
        for idx in out["T"][i]:
            rm.relax_w[idx] = 0.0
    R.snap_and_relax(rm, field)
    return rm


def stocking_legs(prefix, coll=None, tris=700):
    """Below the hem: the calves in dark nylon, from under the skirt to the shoes."""
    parts = []
    for tag in ("L", "R"):
        knee = np.array(JOINTS[f"shin.{tag}"][0]) + np.array([0, 0, 0.06])
        ankle = np.array(JOINTS[f"shin.{tag}"][1])
        calf = knee + (ankle - knee) * 0.32 + np.array([0, 0.010, 0])
        parts += [S.RoundCone(knee, calf, 0.047, 0.050), S.RoundCone(calf, ankle + np.array([0, 0, 0.02]), 0.050, 0.030)]
    f = S.Union(parts, k=0.02)
    ob = MF.decimated(f"{prefix}.legs", f, (-0.2, -0.1, 0.05), (0.2, 0.12, 0.64), 0.0016, tris, coll, symmetry=True)

    def paint(P):
        c, r = H.dead_skin(P, P, "grave", 0.0, 0.6, seed=17)
        nylon = srgb(0.30, 0.24, 0.20)
        c = c * 0.45 + nylon * 0.55
        run = (np.abs(P[:, 0] - 0.112) < 0.0025) & (P[:, 1] > 0) & (P[:, 2] < 0.45)        # a ladder up one calf
        c[run] = c[run] * 0.6 + srgb(0.55, 0.55, 0.48) * 0.4
        c, r = grave_wear(P, c, r, 0.8, seed=19, stains=False, tears=True)
        return c, r, np.zeros(len(P))
    return dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.5, ao_field=f, smart_uv=True, uv_angle=70)


# ---------------------------------------------------------------------------
# The six outfits

def shirt_extras(P, c, placket=True, collar_z=1.49):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    if placket:
        front = (y < -0.05) & (z > 0.98) & (z < collar_z)
        c[front & (np.abs(x) < 0.013)] *= 0.88
        bz = (z - 1.02) % 0.085
        btn = front & (np.abs(x) < 0.0055) & (np.abs(bz - 0.04) < 0.0055)
        c[btn] = srgb(0.6, 0.56, 0.48)
    return c


def farmer(coll=None):
    bp = BD.P(sleeves="rolled", shirt_loose=1.05, boot_top=0.30, legs=1.06)

    def shirt_paint(P):
        c, r, m = fabric(P, (0.42, 0.48, 0.56), "cotton", seed=1, wear=0.9)
        return shirt_extras(P, c), r, m

    def denim(P):
        c, r, m = fabric(P, (0.20, 0.27, 0.40), "denim", seed=3, wear=1.0, stains=False)
        # seams and the patch pockets' stitching
        x = P[:, 0]
        seam = (np.abs(np.abs(x) - 0.17) < 0.004) & (P[:, 2] < 0.95)
        c[seam] = c[seam] * 1.25 + 0.02
        return c, r, m

    def bib_paint(P):
        c, r, m = fabric(P, (0.20, 0.27, 0.40), "denim", seed=4, wear=0.8)
        pocket = (np.abs(P[:, 0]) < 0.06) & (np.abs(P[:, 2] - 1.25) < 0.05)
        c[pocket] *= 0.85
        met = (np.abs(np.abs(P[:, 0]) - 0.095) < 0.016) & (np.abs(P[:, 2] - 1.345) < 0.02)
        mc, mr, mm = PT.metal(P, (0.5, 0.48, 0.42), 0.4, rust=0.5)
        c[met], r[met], m[met] = mc[met], mr[met], mm[met]
        return c, r, m
    parts = [shirt_part(bp, "farmer.shirt", shirt_paint, coll), trousers_part(bp, "farmer.trousers", denim, coll),
             bib_part("farmer", bp, bib_paint, coll)] + boots_parts("farmer", (0.22, 0.15, 0.09), coll)
    return parts, bp


def trucker(coll=None):
    bp = BD.P(sleeves="rolled", shirt_loose=1.08, boot_top=0.26, belly=0.35)

    def flannel(P):
        c, r, m = fabric(P, (0.42, 0.10, 0.08), "wool", seed=5, wear=0.9,
                         pattern=lambda Q: plaid(Q, (0.46, 0.10, 0.08), (0.05, 0.05, 0.05), 0.05))
        return shirt_extras(P, c), r, m

    def jeans(P):
        c, r, m = fabric(P, (0.16, 0.22, 0.34), "denim", seed=7, wear=1.0, stains=False)
        return c, r, m

    def cap_paint(P):
        n = len(P)
        c = np.tile(srgb(0.16, 0.30, 0.18), (n, 1))
        back = P[:, 1] > -0.02
        mesh = back & (np.abs(np.sin(P[:, 0] * 900) * np.sin(P[:, 2] * 900)) > 0.5)
        c[back] = srgb(0.1, 0.1, 0.1)
        c[mesh] = srgb(0.03, 0.03, 0.03)
        front = (P[:, 1] < -0.05) & (P[:, 2] > 0.05)
        c[front] = srgb(0.78, 0.76, 0.68)
        patch = front & (np.abs(P[:, 0]) < 0.03) & (np.abs(P[:, 2] - 0.09) < 0.02)
        c[patch] = srgb(0.16, 0.30, 0.18)
        visor = P[:, 1] < -0.1
        c[visor] = srgb(0.16, 0.30, 0.18)
        r = np.full(n, 0.9)
        c, r = grave_wear(P + 5, c, r, 0.8, seed=9, mud=False, tears=False)
        return c, r, np.zeros(n)
    parts = [shirt_part(bp, "trucker.shirt", flannel, coll), trousers_part(bp, "trucker.jeans", jeans, coll),
             belt_part("trucker", coll), cap_part("trucker", cap_paint, coll)] + boots_parts("trucker", (0.26, 0.17, 0.10), coll)
    return parts, bp


def waitress(coll=None):
    from .common import G as _G

    def dress_paint(P):
        c, r, m = fabric(P, (0.56, 0.72, 0.64), "cotton", seed=11, wear=1.0)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        collar = (z > 1.49)
        c[collar] = srgb(0.84, 0.82, 0.76) * 0.9
        cuffs = np.zeros(len(P), bool)
        for tag in ("L", "R"):
            wr = np.array(JOINTS[f"hand.{tag}"][0])
            cuffs |= np.linalg.norm(P - wr, axis=1) < 0.06
        c[cuffs] = srgb(0.84, 0.82, 0.76) * 0.9
        btn = (y < -0.06) & (np.abs(x) < 0.005) & (np.abs(((z - 1.10) % 0.05) - 0.025) < 0.005) & (z > 1.1) & (z < 1.5)
        c[btn] = srgb(0.9, 0.9, 0.86)
        tag = (y < -0.05) & (np.abs(x - 0.075) < 0.03) & (np.abs(z - 1.36) < 0.012)
        c[tag] = srgb(0.86, 0.84, 0.8)
        return c, r, m
    df = uniform_field()
    rm = build_uniform(df)
    dr = R.to_blender(rm, "waitress.dress", coll)
    parts = [dict(ob=dr, field=S.Displace(df, _G.dress_folds, 0.007), paint=dress_paint, origin=np.zeros(3), weight=1.0,
                  ao_field=df, skin=("coat", UNIFORM_HEM))]
    af = _G.apron_field(top=1.07, bottom=0.56, rx=0.24, ry=0.188)
    ra = _G.build_apron(af, top=1.07, bottom=0.56)
    ap = R.to_blender(ra, "waitress.apron", coll)
    parts.append(stocking_legs("waitress", coll))

    def apron_paint(P):
        c, r, m = PT.fabric(P, (0.86, 0.84, 0.78), "cotton", dust_amt=0.0, fade=0.05, seed=13, grime=0.4)
        c, r = grave_wear(P, c, r, 1.2, seed=113)
        return c, r, m
    parts.append(dict(ob=ap, field=af, paint=apron_paint, origin=np.zeros(3), weight=0.5, ao_field=af, skin=("coat", 0.56)))
    parts += boots_parts("waitress", (0.06, 0.05, 0.05), coll, shoes=True, shine=0.4, muddy=0.8)
    return parts, BD.P(female=1.0, sleeves="full")


def hunter(coll=None):
    bp = BD.P(sleeves="full", shirt_loose=1.05, boot_top=0.34, chest=1.04)

    def thermal(P):
        c, r, m = fabric(P, (0.28, 0.30, 0.20), "wool", seed=15, wear=0.9)
        return c, r, m

    def canvas(P):
        c, r, m = fabric(P, (0.36, 0.30, 0.20), "canvas", seed=17, wear=1.0, stains=False)
        return c, r, m

    def blaze(P):
        c, r, m = fabric(P, (0.92, 0.36, 0.06), "cotton", seed=19, wear=0.9)
        # the mesh weave of a safety vest, pockets
        weave = (np.abs(np.sin(P[:, 0] * 700)) > 0.85) | (np.abs(np.sin(P[:, 2] * 700)) > 0.85)
        c[weave] *= 0.8
        pock = (P[:, 1] < -0.05) & (np.abs(np.abs(P[:, 0]) - 0.1) < 0.045) & (np.abs(P[:, 2] - 1.12) < 0.05)
        c[pock] *= 0.85
        return c, r, m

    def cap_paint(P):
        n = len(P)
        c = np.tile(srgb(0.92, 0.38, 0.06), (n, 1))
        r = np.full(n, 0.85)
        c, r = grave_wear(P + 9, c, r, 0.8, seed=21, mud=False, tears=False)
        return c, r, np.zeros(n)
    parts = [shirt_part(bp, "hunter.thermal", thermal, coll), trousers_part(bp, "hunter.trousers", canvas, coll),
             vest_part(bp, "hunter.vest", blaze, coll), belt_part("hunter", coll), cap_part("hunter", cap_paint, coll, visor=0.07)] + \
        boots_parts("hunter", (0.20, 0.14, 0.08), coll, top=0.34)
    return parts, bp


def mechanic_small(coll=None):
    bp = BD.P(sleeves="full", shirt_loose=1.1, boot_top=0.26, belly=0.2)
    base = (0.30, 0.36, 0.42)

    def grease(P, c, r):
        g = smoothstep(0.55, 0.8, fbm(P, 14, 4, seed=23))
        arms = np.zeros(len(P))
        for tag in ("L", "R"):
            el = np.array(JOINTS[f"forearm.{tag}"][0])
            wr = np.array(JOINTS[f"hand.{tag}"][0])
            d = wr - el
            t = np.clip(((P - el) @ d) / (d @ d), 0, 1.2)
            arms = np.maximum(arms, np.exp(-(np.linalg.norm(P - (el + t[:, None] * d), axis=1) / 0.07) ** 2) * t)
        thigh = np.exp(-((P[:, 2] - 0.8) / 0.12) ** 2) * (np.abs(P[:, 0]) > 0.08) * (P[:, 1] < 0.02)
        gg = np.clip(0.5 * g + 0.8 * arms + 0.6 * thigh, 0, 1)
        c = c * (1 - 0.65 * gg[:, None]) + srgb(0.05, 0.05, 0.05) * 0.65 * gg[:, None]
        r = r - 0.3 * gg
        return c, r

    def top(P):
        c, r, m = fabric(P, base, "cotton", seed=25, wear=0.9)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        zip_ = (y < -0.05) & (np.abs(x) < 0.006) & (z > 0.9)
        c[zip_] = srgb(0.25, 0.25, 0.26)
        patch = (y < -0.05) & (np.abs(x - 0.085) < 0.045) & (np.abs(z - 1.36) < 0.022)
        c[patch] = srgb(0.84, 0.82, 0.76)
        stitch = (y < -0.05) & (np.abs(x - 0.085) < 0.03) & (np.abs(z - 1.36) < 0.006)
        c[stitch] = srgb(0.5, 0.1, 0.08)
        c, r = grease(P, c, r)
        return c, r, m

    def bottom(P):
        c, r, m = fabric(P, base, "cotton", seed=27, wear=1.0, stains=False)
        c, r = grease(P, c, r)
        return c, r, m
    parts = [shirt_part(bp, "coveralls.top", top, coll), trousers_part(bp, "coveralls.legs", bottom, coll)] + \
        boots_parts("coveralls", (0.10, 0.08, 0.06), coll)
    return parts, bp


def suit(coll=None):
    bp = BD.P(sleeves="full", shirt_loose=0.98, boot_top=0.13, chest=0.98)

    def shirt_paint(P):
        c, r, m = fabric(P, (0.80, 0.80, 0.76), "cotton", seed=29, wear=1.1)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # the tie: a dark blue-red stripe down the front from the knot
        w = 0.022 + 0.018 * smoothstep(1.48, 1.2, z)
        tie = (y < -0.05) & (np.abs(x) < w) & (z > 1.08) & (z < 1.50)
        tc = np.tile(srgb(0.12, 0.10, 0.16), (len(P), 1))
        stripe = np.abs(np.sin((z + x) * 90)) > 0.85
        tc[stripe] = srgb(0.40, 0.08, 0.08)
        c[tie] = tc[tie]
        r[tie] = 0.6
        return c, r, m

    def wool(P):
        c, r, m = fabric(P, (0.13, 0.13, 0.14), "wool", seed=31, wear=1.0, stains=False)
        pin = np.abs(np.sin(P[:, 0] * 400)) > 0.96
        c[pin] = c[pin] * 1.3 + 0.01
        return c, r, m

    def jacket(P):
        c, r, m = fabric(P, (0.13, 0.13, 0.14), "wool", seed=33, wear=1.0)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        btn = (y < -0.1) & (np.abs(x - 0.055) < 0.008) & (np.abs(z - 1.02) < 0.008)
        c[btn] = srgb(0.05, 0.05, 0.05)
        pocket = (y < -0.05) & (np.abs(np.abs(x) - 0.12) < 0.06) & (np.abs(z - 0.96) < 0.004)
        c[pocket] *= 0.6
        return c, r, m
    parts = [shirt_part(bp, "suit.shirt", shirt_paint, coll), trousers_part(bp, "suit.trousers", wool, coll),
             coat_part(bp, "suit.jacket", jacket, hem_z=0.80, flare=0.55, coll=coll, seed=3), belt_part("suit", coll, (0.05, 0.04, 0.04))] + \
        boots_parts("suit", (0.04, 0.035, 0.03), coll, shoes=True, shine=0.6, muddy=0.7)
    return parts, bp


OUTFITS = {
    "farmer": farmer, "trucker": trucker, "waitress": waitress,
    "hunter": hunter, "mechanic_small": mechanic_small, "suit": suit,
}
