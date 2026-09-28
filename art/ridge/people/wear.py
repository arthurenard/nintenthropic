"""The soldiers' clothes and kit: field tunic, combat boots, webbing, helmet,
officer's cap and greatcoat, the pack.

Everything is sculpted around High Noon's skeleton in its world space
(Blender: Z up, facing -Y, his left = +X, soles on z = 0), with charlib's
field primitives and ring garments; nothing here edits charlib.

Read through a 6x scope at 250-900 m, a soldier is a dark green figure with a
round steel dome on his head and a rifle: the helmet is a little larger and
rounder than life, the uniform is one dark green from collar to boots, and
the webbing is a paler olive-khaki so the Y of the straps catches the dawn
light on his chest. Close up he is a real mid-century infantryman of no
particular nation: no insignia, no emblems.
"""
import math
import numpy as np
from charlib import sdf as S, rings as R, garments as G, body as BD, head as HD, paint as PT
from charlib.texture import srgb, smoothstep, value_noise, fbm
from charlib.skeleton import JOINTS

OLIVE = (0.200, 0.228, 0.145)        # the uniform: a dark field green (still green, not black, in the dawn light)
OLIVE_DARK = (0.105, 0.118, 0.085)   # the officer's greatcoat, darker and greyer
WEBBING = (0.33, 0.33, 0.22)         # pale olive-khaki canvas webbing
HELMET = (0.175, 0.200, 0.130)       # painted steel
LEATHER_BLACK = (0.045, 0.040, 0.035)


def _j(n, e=0):
    return np.array(JOINTS[n][e], float)


# ------------------------------------------------------------------ the field tunic

BELT_Z = 1.005          # the waist belt's centre, front


def cinch(z, amount):
    """How far a belt pulls the cloth in round the waist."""
    return amount * np.exp(-((z - BELT_Z) / 0.024) ** 2)


def tunic_profile(bp, hem_z, loose, belt=0.006):
    base = G.coat_profile(bp, hem_z, 0.35, loose)

    def prof(z):
        rx, ry, cy = base(z)
        c = cinch(z, belt)
        return rx - c, ry - c, cy
    return prof


def tunic_field(bp, hem_z=0.84, loose=0.008, belt=0.006):
    """The tunic's surface: the shirt (torso and full sleeves) let out a
    little, a short skirt over the seat of the trousers to the hip, and the
    cloth drawn in where the belt goes round it."""
    f = G.coat_field(bp, hem_z, 0.35, loose)
    if hem_z < 0.97:
        # worn over trousers: the cloth hangs outside their seat and waistband
        # (a shirt's torso tapers in at the waist, where it would tuck in)
        f = S.Union([f, S.Offset(trouser_pelvis(bp), loose + 0.004)], k=0.02)
    return S.Displace(f, lambda P: cinch(P[:, 2], belt).astype(np.float32), belt + 0.001)


def trouser_pelvis(bp):
    """The seat and waistband of charlib's trousers (body.trousers' pelvis tube)."""
    hp = bp["hips"]
    st = [(1.075, 0.160 * hp, 0.113, 0.004), (1.030, 0.163 * hp, 0.118, 0.006), (0.960, 0.172 * hp, 0.124, 0.010),
          (0.890, 0.170 * hp, 0.120, 0.008)]
    return S.Tube([(0, cy, z) for z, rx, ry, cy in st], [s[1] for s in st], [s[2] for s in st])


def build_tunic(bp, field, hem_z=0.84, M=24, arm_n=12, loose=0.008, sleeve_loose=None, neck_open=0.0, front_open=None,
                belt=0.006, collar_grow=None):
    """charlib's coat, closed: the torso rings run down into a hip-length
    skirt, sleeves to the wrist, a turned collar. `neck_open` columns stay
    open at the throat; `front_open(z)` -> half width in columns opens a
    greatcoat's skirt."""
    rm = R.RingMesh()
    skirt_z = [z for z in (0.36, 0.44, 0.52, 0.60, 0.68, 0.76, 0.84, 0.91) if z >= hem_z - 1e-6]
    zs = skirt_z + list(G.TORSO_Z)
    arm0 = len(skirt_z) + G.ARMPIT
    h = M // 2

    def skip(i, j):
        z = 0.5 * (zs[i] + zs[i + 1]) if i + 1 < len(zs) else zs[i]
        c = j + 0.5
        d = min(c, M - c)
        w = float(np.interp(z, [1.40, 1.47, 1.52], [0.0, 0.6 * neck_open, 1.2 * neck_open]))
        if front_open is not None:
            w = max(w, front_open(z))
        if d < w:
            return True
        if hem_z < 0.7 and z < 0.62 and j == h - 1:
            return True                  # a greatcoat's back vent
        return False
    ex = (loose if sleeve_loose is None else sleeve_loose) - 0.004
    a = bp["arms"] ** 0.8
    arm_rings = [(s, r * a + ex) for s, r in ((0.045, 0.066), (0.100, 0.061), (0.160, 0.057), (0.215, 0.054), (0.262, 0.053),
                                               (0.292, 0.052), (0.318, 0.051), (0.36, 0.049), (0.42, 0.047), (0.48, 0.045), (0.535, 0.043))]
    out = G.build_torso_with_arms(rm, bp, M, arm_n, zs, arm_rings, "full", "", skip=skip,
                                  inflate=0.0, profile=tunic_profile(bp, hem_z, loose, belt), armpit=arm0, root_r=0.086 + ex)
    for i in range(len(skirt_z)):
        for idx in out["T"][i]:
            rm.relax_w[idx] = 0.0
    R.snap_and_relax(rm, field)
    G.collar(rm, out["T"][-1], M, "collar", grow=(0.016 + ex) if collar_grow is None else collar_grow, height=1.15)
    return rm


def radius_at(field, z, axis, sign, r0=0.02, r1=0.35):
    """Distance from the body's axis to a field's surface along one direction
    at height z (the outermost crossing), by marching in from outside."""
    for r in np.linspace(r1, r0, 200):
        p = np.zeros((1, 3), np.float32)
        p[0, axis] = sign * r
        p[0, 2] = z
        if field(p)[0] < 0:
            return float(r)
    return r0


def cloth_folds(bp, blouse=0.0018):
    """charlib's shirt folds, gentler: a soft blousing only just above the
    belt, the drape down the torso, bunched rings inside the elbows, gathers
    at the armpits."""
    from charlib.garments import point_on_arm

    def f(P):
        z = P[:, 2]
        d = np.zeros(len(P))
        bl_ = smoothstep(BELT_Z + 0.02, BELT_Z + 0.035, z) * (1 - smoothstep(BELT_Z + 0.06, BELT_Z + 0.10, z)) * (np.abs(P[:, 0]) < 0.3)
        d += blouse * bl_ * np.sin(np.arctan2(P[:, 0], -P[:, 1]) * 11 + 3 * value_noise(P, 30, seed=5)) ** 2
        th = np.arctan2(P[:, 0], -P[:, 1])
        tor = smoothstep(1.06, 1.12, z) * (1 - smoothstep(1.36, 1.42, z)) * (np.abs(P[:, 0]) < 0.19)
        d += 0.0016 * tor * np.sin(th * 9 + 4 * value_noise(P, 12, seed=6)) ** 3
        for tag in ("L", "R"):
            el = np.array(JOINTS[f"forearm.{tag}"][0])
            r = np.linalg.norm(P - el, axis=1)
            m = np.exp(-(r / 0.07) ** 2) * (np.abs(P[:, 0]) > 0.25)
            d += 0.0035 * m * np.sin(r * 2 * np.pi / 0.022 + 5 * value_noise(P, 50, seed=7))
            sh = np.array(JOINTS[f"upper_arm.{tag}"][0])
            ap = sh + np.array([-0.02 * np.sign(sh[0]), 0.0, -0.09])
            r2 = np.linalg.norm(P - ap, axis=1)
            d += 0.003 * np.exp(-(r2 / 0.06) ** 2) * np.sin(np.arctan2(P[:, 1] - ap[1], P[:, 2] - ap[2]) * 7) ** 2
        return (-d).astype(np.float32)
    return f


def tunic_details(bp, hem_z=0.84, seed=0, pockets=True):
    """Pockets, flaps and shoulder straps as a small relief on the tunic's
    field (only the normal map carries it), over gentle cloth folds."""
    base_folds = cloth_folds(bp)

    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        d = base_folds(P).astype(np.float64)
        front = smoothstep(-0.04, -0.07, y)
        # patch pockets on the chest and on the skirt: raised panels with a
        # flap whose lower edge casts a groove
        for (x0, x1, z0, z1, fz) in (((0.035, 0.125, 1.225, 1.345, 1.325), (0.045, 0.150, hem_z + 0.03, 0.965, 0.945)) if pockets else ()):
            inside = smoothstep(x0 - 0.004, x0 + 0.002, ax) * smoothstep(x1 + 0.004, x1 - 0.002, ax) * \
                smoothstep(z0 - 0.004, z0 + 0.002, z) * smoothstep(z1 + 0.004, z1 - 0.002, z) * front
            d -= 0.0028 * inside
            flap = inside * smoothstep(fz - 0.003, fz + 0.002, z)
            d -= 0.0016 * flap
            d += 0.0012 * np.exp(-((z - fz) / 0.0018) ** 2) * inside
        # the button placket down the front
        d -= 0.0012 * np.exp(-(x / 0.012) ** 2) * front * (z > hem_z) * (z < 1.46)
        # shoulder straps (epaulettes, bare - no rank on them)
        for s in (1, -1):
            sh = _j(f"upper_arm.{'L' if s > 0 else 'R'}")
            u = (s * x - 0.03) / max(abs(sh[0]) - 0.03, 1e-3)
            strap = smoothstep(-0.05, 0.05, u) * smoothstep(1.02, 0.9, u) * np.exp(-(y / 0.024) ** 4) * smoothstep(1.40, 1.44, z)
            d -= 0.0022 * strap
        return d.astype(np.float32)
    return f


def tunic_paint(color=OLIVE, seed=0, hem_z=0.84, buttons=True, pockets=True, dust=0.45):
    def paint(P):
        col, r, m = PT.fabric(P, color, "wool", dust_amt=dust, fade=0.28, seed=seed, grime=0.35)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ax = np.abs(x)
        front = y < -0.045
        if pockets:
            for (x0, x1, z0, z1, fz) in ((0.035, 0.125, 1.225, 1.345, 1.325), (0.045, 0.150, hem_z + 0.03, 0.965, 0.945)):
                inside = front & (ax > x0) & (ax < x1) & (z > z0) & (z < z1)
                edge = inside & ((ax - x0 < 0.004) | (x1 - ax < 0.004) | (z - z0 < 0.004) | (z1 - z < 0.003))
                col[edge] *= 0.72
                flap = inside & (np.abs(z - fz) < 0.0022)
                col[flap] *= 0.55
                if buttons:
                    bt = inside & (np.hypot(ax - 0.5 * (x0 + x1), z - (fz + 0.008)) < 0.0055)
                    col[bt] = srgb(0.07, 0.075, 0.06)
                    r[bt] = 0.45
        if buttons:
            bz = (z - (hem_z + 0.04)) % 0.085
            btn = front & (np.abs(x) < 0.0058) & (np.abs(bz - 0.04) < 0.0058) & (z < 1.46)
            col[btn] = srgb(0.07, 0.075, 0.06)
            r[btn] = 0.45
        # the seam down the front and the placket's edge
        seam = front & (np.abs(np.abs(x) - 0.013) < 0.0012) & (z < 1.46)
        col[seam] *= 0.78
        # sweat and grime: collar, armpits, cuffs; worn pale on the elbows
        for tag in ("L", "R"):
            wr = _j(f"hand.{tag}")
            el = _j(f"forearm.{tag}")
            cuff = np.exp(-(np.linalg.norm(P - (wr + (el - wr) * 0.12), axis=1) / 0.045) ** 2)
            col *= (1 - 0.25 * cuff)[:, None]
            elb = np.exp(-(np.linalg.norm(P - el - np.array([0, 0.03, 0]), axis=1) / 0.04) ** 2)
            col = col * (1 - 0.25 * elb[:, None]) + (col * 1.4 + 0.02) * 0.25 * elb[:, None]
        coll = smoothstep(1.49, 1.53, z)
        col *= (1 - 0.18 * coll * fbm(P, 60, 2, seed=seed + 4))[:, None]
        return np.clip(col, 0, 1), r, m
    return paint


def trouser_paint(color=OLIVE, seed=0):
    """Wool field trousers: knees worn pale and muddy, the seat shiny, dust
    and mud climbing from the boots."""
    def paint(P):
        col, r, m = PT.fabric(P, color, "wool", dust_amt=0.7, fade=0.15, seed=seed + 10, grime=0.3)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        for tag in ("L", "R"):
            kn = _j(f"shin.{tag}")
            q = P - kn
            knee = np.exp(-((q[:, 0] / 0.055) ** 2 + ((q[:, 2] - 0.01) / 0.075) ** 2)) * (q[:, 1] < -0.015)
            mud = srgb(0.23, 0.19, 0.14)
            col = col * (1 - 0.45 * knee[:, None]) + mud * 0.45 * knee[:, None]
            ax = x * (1 if tag == "L" else -1)
            side = (ax > 0.05) & (np.abs(y - 0.005) < 0.0028) & (z < 0.95)
            col[side] *= 0.8
            # cargo pocket on the outer thigh
            pk = (ax > 0.06) & (np.abs(y + 0.02) < 0.05) & (np.abs(z - 0.70) < 0.06)
            edge = pk & ((np.abs(y + 0.02) > 0.045) | (np.abs(z - 0.70) > 0.055))
            col[edge] *= 0.72
        # mud spatter low on the legs
        spat = smoothstep(0.55, 0.25, z) * smoothstep(0.62, 0.72, value_noise(P, 140, seed=seed + 12))
        col = col * (1 - 0.5 * spat[:, None]) + srgb(0.22, 0.18, 0.13) * 0.5 * spat[:, None]
        return np.clip(col, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ combat boots

def combat_boot_sdf(side="L", top=0.25, heel=0.026, sole=0.014):
    """An ankle-high laced field boot: a round, blunt toe cap, a thick sole
    with a heel, the shaft closing over the trouser leg (which blouses over
    its top)."""
    s = 1.0 if side == "L" else -1.0
    X = lambda p: np.array([s * p[0], p[1], p[2]])
    an = _j("foot.L")
    x0 = an[0]
    parts = []
    # sole and heel: a flat, slightly wider slab, rounded at the toe
    so = S.Tube([X((x0, 0.078, sole * 0.5)), X((x0, 0.0, sole * 0.5)), X((x0 + 0.004, -0.09, sole * 0.5)),
                 X((x0 + 0.006, -0.150, sole * 0.5)), X((x0 + 0.006, -0.188, sole * 0.55))],
                [0.040, 0.041, 0.050, 0.047, 0.020], [sole * 0.55] * 5, side=(1, 0, 0))
    parts.append(so)
    parts.append(S.Box(X((x0, 0.050, heel * 0.5)), (0.037, 0.030, heel * 0.5), None, rad=0.004))
    # upper: instep to a blunt toe
    vamp = S.Tube([X((x0, 0.055, 0.090)), X((x0, 0.012, 0.090)), X((x0 + 0.002, -0.040, 0.070)),
                   X((x0 + 0.004, -0.095, 0.050)), X((x0 + 0.006, -0.150, 0.043)), X((x0 + 0.006, -0.178, 0.038))],
                  [0.041, 0.043, 0.047, 0.049, 0.044, 0.028], [0.050, 0.053, 0.044, 0.030, 0.026, 0.020], side=(1, 0, 0))
    parts.append(vamp)
    parts.append(S.Ellipsoid(X((x0 + 0.006, -0.150, 0.038)), (0.043, 0.036, 0.028)))   # the toe cap
    parts.append(S.Ellipsoid(X((x0, 0.052, 0.072)), (0.038, 0.037, 0.052)))            # heel counter
    kn = _j("shin.L")
    d = (kn - an) / np.linalg.norm(kn - an)
    t_top = (top - an[2]) / d[2]
    p_top = an + d * t_top
    parts.append(S.RoundCone(X(an + np.array([0, 0.010, -0.01])), X(p_top), 0.050, 0.054))
    boot = S.Union(parts, k=0.012)
    boot = S.Intersect(boot, S.Plane(X(p_top), (0, 0, 1), (-1, -1, -1), (1, 1, 2)))
    # the tongue and lacing: a slight ridge down the instep
    lace = S.RoundCone(X(an + np.array([0.0, -0.045, 0.00])), X(p_top + np.array([0, -0.042, -0.01])), 0.012, 0.014)
    boot = S.Union([boot, lace], k=0.01)
    hole = S.RoundCone(X(p_top - d * 0.03), X(p_top + d * 0.03), 0.045, 0.047)
    boot = S.Subtract(boot, hole, k=0.002)
    return boot, p_top


def combat_boot_paint(color=(0.045, 0.036, 0.030), seed=0):
    def paint(P):
        col, r, m = PT.leather(P, color, dust_amt=0.10, wear=0.25, seed=seed + 20, shine=0.3)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        sole = z < 0.016
        col[sole] = srgb(0.035, 0.032, 0.03)
        r[sole] = 0.9
        # laces across the instep, and eyelets
        ax = np.abs(x) - 0.103
        instep = (np.abs(ax) < 0.016) & (y < -0.010) & (z > 0.06)
        cross = instep & (np.abs(np.sin((z + 0.6 * y) * 2 * np.pi / 0.018)) < 0.28)
        col[cross] = srgb(0.09, 0.08, 0.06)
        # scuffed toe and dried mud
        toe = smoothstep(-0.13, -0.18, y) * (z < 0.07)
        col = col * (1 - 0.35 * toe[:, None]) + (col * 2.0 + 0.03) * 0.35 * toe[:, None]
        mud = smoothstep(0.07, 0.015, z) * smoothstep(0.45, 0.7, fbm(P, 60, 3, seed=seed + 23))
        col = col * (1 - 0.6 * mud[:, None]) + srgb(0.25, 0.20, 0.14) * 0.6 * mud[:, None]
        r = r + 0.3 * mud
        return np.clip(col, 0, 1), np.clip(r, 0, 1), m
    return paint


# ------------------------------------------------------------------ webbing


def surface_path(field, pts, out=0.004, iters=8):
    """Points snapped onto a field's surface and lifted `out` off it."""
    P = S.project_to_surface(field, np.asarray(pts, np.float32), iters=iters, clamp=0.02)
    g = S.gradient(field, P)
    n = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
    return P + n * out


def webbing_field(tunic):
    """A waist belt with a double ammunition pouch either side of the
    buckle, braces that rise over the shoulders and meet in a Y behind, and
    a water bottle on the right hip. Canvas, laid onto the tunic."""
    parts = []
    # the tunic's girth under the belt (its widest over the belt's width),
    # then a band just outside it
    zz = (BELT_Z - 0.024, BELT_Z, BELT_Z + 0.024)
    rx = max(radius_at(tunic, z, 0, 1) for z in zz) + 0.006
    fr = max(radius_at(tunic, z, 1, -1) for z in zz)
    bk = max(radius_at(tunic, z, 1, 1) for z in zz)
    ry, cy = 0.5 * (fr + bk) + 0.006, 0.5 * (bk - fr)
    band = _belt_band(BELT_Z, BELT_Z + 0.008, 0.050, 0.006, rx, ry, cy)
    parts.append(band)
    parts.append(S.Box((0, cy - ry - 0.004, BELT_Z), (0.030, 0.004, 0.027), None, rad=0.003))   # buckle plate
    # pouches: boxes standing on the belt's front, facing along the belt's normal
    pouch_c = []
    for s in (1, -1):
        for xx in (0.058, 0.118):
            th = math.asin(min(xx / rx, 0.99))
            yy = cy - ry * math.cos(th)
            nrm = np.array([math.sin(th) * ry, -math.cos(th) * rx, 0.0])
            nrm /= np.linalg.norm(nrm)
            c = np.array([s * xx, yy, BELT_Z + 0.022]) + nrm * np.array([s, 1, 1]) * 0.020
            ang = math.degrees(math.atan2(nrm[0], -nrm[1])) * s
            Rz = S.rot_z(ang)
            parts.append(S.Box(c, (0.027, 0.018, 0.045), Rz, rad=0.006))
            # the lid, a hair proud of the box
            parts.append(S.Box(c + np.array([0, 0, 0.036]) + (Rz @ np.array([0, -0.003, 0])), (0.028, 0.0195, 0.012), Rz, rad=0.005))
            pouch_c.append(c)
    # the brace ring between the shoulder blades
    specs = brace_specs(tunic)
    parts.append(S.Torus(specs[-1][0][0] + np.array([0, 0.004, 0]), 0.016, 0.0035, S.rot_x(90)))
    # the water bottle in its cover, on the right hip
    bott = np.array([-0.150, 0.080, 0.925])
    parts.append(S.Ellipsoid(bott, (0.032, 0.050, 0.075), S.rot_z(-35)))
    parts.append(S.Cylinder(bott + np.array([0.0, 0.0, 0.080]), 0.012, 0.012, None, rad=0.003))
    parts.append(S.Box(bott + np.array([0.012, -0.012, 0.070]), (0.010, 0.014, 0.020), S.rot_z(-35), rad=0.003))
    hardware = S.Union(parts, k=0.004)
    return S.Union([hardware, straps_field(specs)], k=0.004), pouch_c, hardware, specs


def brace_specs(tunic):
    """The braces as (centre line, half width, half thickness): from the
    outer pouches up over the shoulders to a ring between the shoulder
    blades, one strap down the back to the belt."""
    specs = []
    for s in (1, -1):
        path = [(s * 0.098, -0.15, BELT_Z + 0.07), (s * 0.100, -0.15, 1.18), (s * 0.104, -0.13, 1.32), (s * 0.108, -0.09, 1.43),
                (s * 0.110, 0.00, 1.485), (s * 0.100, 0.08, 1.44), (s * 0.075, 0.12, 1.36), (s * 0.030, 0.13, 1.285), (0.0, 0.13, 1.26)]
        specs.append((surface_path(tunic, densify(path, 0.03), 0.004), 0.020, 0.0035))
    back = surface_path(tunic, densify([(0.0, 0.13, 1.27), (0.0, 0.135, 1.16), (0.0, 0.135, BELT_Z + 0.03)], 0.03), 0.004)
    specs.append((back, 0.022, 0.0035))
    return specs


def densify(pts, step):
    """A polyline resampled so no segment is longer than `step`."""
    pts = np.asarray(pts, float)
    out = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        k = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        for i in range(1, k + 1):
            out.append(a + (b - a) * i / k)
    return np.array(out)


def straps_field(specs):
    return S.Union([S.Tube(p, [w] * len(p), [t] * len(p), side=(1, 0, 0)) for p, w, t in specs], k=0.002)


def strap_ribbons(name, specs, side=(1.0, 0.0, 0.0)):
    """Straps as clean ribbons of flattened hexagonal section along their
    centre lines (a decimated thin plate tears at its edges): the same frame
    as charlib's Tube, so the bake snaps each texel onto its own strap."""
    from charlib import bl
    V, F = [], []
    ang = np.radians([0, 50, 130, 180, 230, 310])
    for pts, w, th in specs:
        pts = np.asarray(pts, float)
        n = len(pts)
        base = len(V)
        for i in range(n):
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            t /= np.linalg.norm(t)
            x = np.asarray(side) - (np.asarray(side) @ t) * t
            x /= np.linalg.norm(x)
            y = np.cross(t, x)
            for a in ang:
                V.append(pts[i] + x * w * np.cos(a) + y * th * np.sin(a))
        m = len(ang)
        for i in range(n - 1):
            for k in range(m):
                k2 = (k + 1) % m
                F.append((base + i * m + k, base + i * m + k2, base + (i + 1) * m + k2, base + (i + 1) * m + k))
        # end caps as triangle fans (the tangent-space bake takes tris and quads only)
        e0, e1 = base, base + (n - 1) * m
        for k in range(1, m - 1):
            F.append((e0, e0 + k + 1, e0 + k))
            F.append((e1, e1 + k, e1 + k + 1))
    ob = bl.mesh_from_arrays(name, np.array(V, np.float32), F)
    bl.recalc_normals(ob)
    return ob


def _belt_band(z_front, z_back, width, thick, rx, ry, cy):
    from charlib import gear as GR
    return GR.belt_sdf(z_front, z_back, width, thick, rx, ry, cy)


def webbing_paint(seed=0):
    def paint(P):
        col, r, m = PT.fabric(P, WEBBING, "canvas", dust_amt=0.35, fade=0.3, seed=seed + 60, grime=0.4)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # woven canvas: fine ribs across the straps
        rib = 0.94 + 0.06 * np.sin(z * 2 * np.pi / 0.004)
        col *= rib[:, None]
        # brass fittings: the buckle, the brace ring, the pouch studs
        bk = (y < -0.12) & (np.abs(x) < 0.031) & (np.abs(z - BELT_Z) < 0.028)
        mc, mr, mm = PT.metal(P, (0.40, 0.34, 0.20), 0.45, seed=seed + 61)
        col[bk], r[bk], m[bk] = mc[bk] * 0.7, mr[bk], mm[bk]
        ring = (y > 0.12) & (np.abs(z - 1.265) < 0.022) & (np.abs(x) < 0.022)
        col[ring], r[ring], m[ring] = mc[ring] * 0.7, mr[ring], mm[ring]
        # the bottle cover: a darker felt
        bott = np.linalg.norm((P - np.array([-0.150, 0.080, 0.925])) / np.array([0.04, 0.06, 0.09]), axis=1) < 1.0
        col[bott] = col[bott] * 0.7
        cap = (np.abs(x + 0.150) < 0.016) & (np.abs(y - 0.080) < 0.016) & (z > 0.99) & (z < 1.02)
        col[cap] = srgb(0.08, 0.08, 0.07)
        return np.clip(col, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ the steel helmet

# head-local frame (charlib.head): origin between the eyes at eyeball
# height, 7 cm behind them; x his left, y back, z up. The cranium tops out at
# z = 0.114, the brows are at z ~ 0.02, the ear tops at z ~ 0.02.
HELMET_C = np.array([0.0, 0.012, 0.0])
HELMET_ABH = (0.1085, 0.1265, 0.142)


def helmet_rim_z(t):
    """Height of the rim round the head (t = 0 ahead, pi/2 his left): high
    over the brow, low over the ears and lower still at the nape."""
    c = np.cos(t)
    return 0.042 * np.clip(c, 0, 1) ** 2 + 0.002 * (1 - c * c) - 0.006 * np.clip(-c, 0, 1) ** 2


def helmet_field():
    """A pressed-steel dome (its outer skin) with a rolled lip round the rim."""
    A, B, H = HELMET_ABH

    def f(P):
        q = P - HELMET_C
        t = np.arctan2(q[:, 0], -q[:, 1])
        zr = helmet_rim_z(t)
        rn = np.sqrt((q[:, 0] / A) ** 2 + (q[:, 1] / B) ** 2)
        h = (q[:, 2] - zr) / (H - zr)
        above = h >= 0
        e = np.where(above, np.sqrt(rn ** 2 + np.maximum(h, 0) ** 2), rn) - 1.0
        dome = np.abs(e * 0.115 + 0.0025) - 0.0025
        dome = np.maximum(dome, zr - 0.004 - q[:, 2])
        # the lip: a small roll just outside and below the rim
        rho = (rn - 1.0) * 0.115
        lip = np.sqrt((rho - 0.010) ** 2 + (q[:, 2] - zr + 0.009) ** 2) - 0.0075
        return np.minimum(dome, lip).astype(np.float32)
    return S.Fn(f, HELMET_C - np.array([A + 0.03, B + 0.03, 0.05]), HELMET_C + np.array([A + 0.03, B + 0.03, H + 0.02]))


def helmet_rings(field, n=40, rows=11):
    """The dome as rings from the rim to the crown, then the lip rolled out
    and under; every vertex snapped onto the field."""
    A, B, H = HELMET_ABH
    th = 2 * np.pi * np.arange(n) / n
    zr = helmet_rim_z(th)
    rm = R.RingMesh()
    dome = []
    for k in range(rows):
        phi = (k / (rows - 1)) * (math.pi / 2) * 0.96
        sc = math.cos(phi)
        pts = np.stack([HELMET_C[0] + A * sc * np.sin(th), HELMET_C[1] - B * sc * np.cos(th), zr + (H - zr) * math.sin(phi)], 1)
        dome.append(rm.ring(pts))
    top = rm.add(HELMET_C + np.array([0, 0, H]))
    lip = []
    for (dr, dz) in ((0.006, -0.002), (0.014, -0.005), (0.018, -0.010), (0.016, -0.015), (0.009, -0.017), (0.001, -0.013)):
        a, b = A + dr * 1.0, B + dr * 1.1
        pts = np.stack([HELMET_C[0] + a * np.sin(th), HELMET_C[1] - b * np.cos(th), zr + dz], 1)
        lip.append(rm.ring(pts))
    ua = np.linspace(0, 1, n + 1)
    for i in range(len(dome) - 1):
        rm.bridge(dome[i], dome[i + 1], i, i + 1, "dome", ua=ua)
    for j in range(n):
        j2 = (j + 1) % n
        rm.face((dome[-1][j], dome[-1][j2], top), [(ua[j], rows), (ua[j + 1], rows), (ua[j] + 0.5 / n, rows + 1)], "dome")
    chain = [dome[0]] + lip
    for i in range(len(chain) - 1):
        rm.bridge(chain[i], chain[i + 1], i, i + 1, "lip", ua=ua)
    V = np.array(rm.V, np.float32)
    V = S.project_to_surface(field, V, iters=8, clamp=0.004)
    rm.V = list(V.astype(np.float64))
    rm.field = field
    return rm


def chin_strap_field(hp):
    """A webbing chin strap from the helmet's sides under the jaw, laid on
    the face (head-local)."""
    face = HD.head_sdf(hp, low=True)
    parts = []
    for s in (1, -1):
        path = [(s * 0.084, 0.006, 0.004), (s * 0.074, -0.012, -0.040), (s * 0.058, -0.030, -0.085),
                (s * 0.034, -0.060, -0.112), (s * 0.010, -0.068, -0.122), (0.0, -0.069, -0.123)]
        p = surface_path(face, path, 0.0028)
        parts.append(S.Tube(p, [0.0075] * len(p), [0.0018] * len(p), side=(0, 0, 1)))
    return S.Union(parts, k=0.002)


def helmet_paint(color=HELMET, seed=0):
    def paint(P):
        c, r, m = PT.metal(P, color, 0.74, rust=0.0, seed=seed + 70)
        m[:] = 0.0          # painted: the steel only shows where it is chipped
        z = P[:, 2]
        grit = value_noise(P, 900, seed=seed + 71)
        c *= (0.9 + 0.12 * grit)[:, None]
        t = np.arctan2(P[:, 0] - HELMET_C[0], -(P[:, 1] - HELMET_C[1]))
        zr = helmet_rim_z(t)
        near_rim = 1 - smoothstep(0.0, 0.03, z - zr)
        chips = smoothstep(0.74, 0.80, fbm(P, 160, 3, seed=seed + 72)) * np.clip(near_rim + 0.25, 0, 1)
        sc, sr, sm = PT.metal(P, (0.30, 0.30, 0.29), 0.45, rust=0.4, seed=seed + 73)
        c = c * (1 - chips[:, None]) + sc * chips[:, None]
        r = r * (1 - chips) + sr * chips
        m = m * (1 - chips) + sm * chips * 0.6
        # dust settled on the crown
        top = smoothstep(0.07, 0.14, z) * (0.4 + 0.6 * fbm(P, 40, 2, seed=seed + 74))
        c = c * (1 - 0.2 * top[:, None]) + PT.DUST * 0.2 * top[:, None]
        # under the lip: the dark liner
        under = z < zr - 0.012
        c[under] *= 0.45
        return np.clip(c, 0, 1), np.clip(r, 0, 1), m
    return paint


def strap_paint(P):
    c, r, m = PT.fabric(P + 11.0, WEBBING, "canvas", dust_amt=0.0, fade=0.1, seed=75)
    c *= 0.75
    return c, r, m


# ------------------------------------------------------------------ the officer's peaked cap

CAP_ZB = 0.020          # bottom of the cap band (head-local), just above the brows
CAP_AB = (0.081, 0.101)


def cap_crown_lift(y):
    """A service cap's crown rises at the front (the stiffener)."""
    return 0.030 * np.clip(-(y - 0.006) / 0.14, 0, 1) ** 1.5


def cap_field():
    """A peaked service cap: a band round the head, a stiffened crown that
    sits wide and rises at the front, a black visor, all as one field."""
    A, B = CAP_AB
    zb = CAP_ZB

    def f(P):
        x, y, z = P[:, 0], P[:, 1] - 0.006, P[:, 2]
        rn = np.sqrt((x / A) ** 2 + (y / B) ** 2)
        band = np.maximum((rn - 1.0) * 0.09 - 0.003, np.abs(z - (zb + 0.017)) - 0.020)
        lift = cap_crown_lift(P[:, 1])
        # the crown: a squashed disc, widest just above the band, dished on top
        rc = np.sqrt((x / (A + 0.034)) ** 2 + ((y + 0.004) / (B + 0.044)) ** 2)
        zc = zb + 0.056 + lift
        crown = np.maximum((rc - 1.0) * 0.12, np.abs(z - zc) - 0.013 * np.sqrt(np.clip(1.15 - rc ** 2, 0.05, 1.2)))
        cr = S.smin(band, crown, 0.02)
        # visor: a thin plate from the band's front edge, pitched down
        rv = np.sqrt((x / (A + 0.034)) ** 2 + (y / (B + 0.060)) ** 2)
        front = -y > 0.02
        vz = zb + 0.001 - 0.36 * np.maximum(rv - 0.94, 0) * 0.12
        vis = np.maximum(np.abs(z - vz) - 0.0018, np.maximum(rv - 1.0, 0.93 - rv) * 0.1)
        vis = np.where(front, vis, 1.0)
        return np.minimum(cr, vis).astype(np.float32)
    return S.Fn(f, (-0.14, -0.20, -0.02), (0.14, 0.16, 0.16))


def cap_rings(field, n=36):
    A, B = CAP_AB
    zb = CAP_ZB
    rm = R.RingMesh()
    th = 2 * np.pi * np.arange(n) / n

    def ring(a, b, z, dy=0.0, lift=True):
        y = 0.006 + dy - b * np.cos(th)
        zz = z + (cap_crown_lift(y) if lift else np.zeros(n))
        return rm.ring(np.stack([a * np.sin(th), y, zz], 1))
    rows = [ring(A + 0.001, B + 0.001, zb - 0.002, lift=False), ring(A + 0.002, B + 0.002, zb + 0.017, lift=False),
            ring(A + 0.003, B + 0.003, zb + 0.034, lift=False),
            ring(A + 0.012, B + 0.016, zb + 0.042), ring(A + 0.025, B + 0.033, zb + 0.047, dy=-0.004),
            ring(A + 0.033, B + 0.043, zb + 0.056, dy=-0.004), ring(A + 0.028, B + 0.037, zb + 0.066, dy=-0.004),
            ring(A + 0.014, B + 0.019, zb + 0.069, dy=-0.004)]
    top = rm.add((0.0, 0.002, zb + 0.069 + float(cap_crown_lift(np.array([0.002]))[0])))
    ua = np.linspace(0, 1, n + 1)
    for i in range(len(rows) - 1):
        rm.bridge(rows[i], rows[i + 1], i, i + 1, "crown", ua=ua)
    for j in range(n):
        j2 = (j + 1) % n
        rm.face((rows[-1][j], rows[-1][j2], top), [(ua[j], 9), (ua[j + 1], 9), (ua[j] + 0.5 / n, 10)], "crown")
    # the visor: a half-ellipse plate, top face out and back underneath
    m = 13
    ph = np.linspace(-1.2, 1.2, m)
    chain = []
    for (w, dz) in ((0.0, 0.0015), (0.030, -0.009), (0.058, -0.019), (0.058, -0.022), (0.030, -0.012), (0.0, -0.0015)):
        a, b = A + 0.004 + w * 0.5, B + 0.004 + w
        chain.append(rm.ring(np.stack([a * np.sin(ph), 0.006 - b * np.cos(ph), np.full(m, zb + dz)], 1)))
    uv = np.linspace(0, 1, m)
    for i in range(len(chain) - 1):
        rm.bridge(chain[i], chain[i + 1], i, i + 1, "visor", closed=False, ua=uv)
    V = np.array(rm.V, np.float32)
    V = S.project_to_surface(field, V, iters=6, clamp=0.004)
    rm.V = list(V.astype(np.float64))
    rm.field = field
    return rm


def cap_paint(color=OLIVE_DARK):
    zb = CAP_ZB

    def paint(P):
        c, r, m = PT.fabric(P + 5.0, color, "wool", dust_amt=0.0, fade=0.05, seed=81)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        band = (z > zb - 0.006) & (z < zb + 0.036) & (np.hypot(x / 0.086, (y - 0.006) / 0.106) < 1.05)
        c[band] = srgb(0.05, 0.05, 0.045)
        # the crown's piping, a thin paler line round its edge
        rc = np.hypot(x / (CAP_AB[0] + 0.034), (y + 0.002) / (CAP_AB[1] + 0.044))
        pipe = (np.abs(rc - 1.0) < 0.035) & (z > zb + 0.045)
        c[pipe] = srgb(0.30, 0.28, 0.20)
        # visor: black lacquer
        vis = (y < -0.09) & (z < zb + 0.004)
        c[vis] = srgb(0.02, 0.02, 0.02)
        r[vis] = 0.2
        # chin cord across the band's front, and a plain oval cockade
        cord = band & (y < -0.05) & (np.abs(z - (zb + 0.006)) < 0.0035)
        c[cord] = srgb(0.20, 0.18, 0.12)
        cock = (np.hypot(x / 0.012, (z - (zb + 0.050 + 0.02)) / 0.010) < 1.0) & (y < -0.08)
        c[cock] = srgb(0.40, 0.36, 0.27)
        m[cock] = 1.0
        r[cock] = 0.35
        return np.clip(c, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ the pack

PACK_C = np.array([0.0, 0.186, 1.225])


def pack_field():
    """A canvas rucksack high on the back - soft and full, a flap buckled
    over its mouth, a pocket either side, a rolled groundsheet strapped on
    top, an entrenching tool's blade in its cover down the left side."""
    R6 = S.rot_x(-6)
    body = S.Union([S.Box(PACK_C, (0.112, 0.046, 0.118), R6, rad=0.05),
                    S.Ellipsoid(PACK_C + np.array([0, 0.030, -0.02]), (0.135, 0.070, 0.160), R6)], k=0.04)
    flap = S.Box(PACK_C + np.array([0, 0.020, 0.080]), (0.122, 0.058, 0.055), R6, rad=0.04)
    pockets = [S.Box(PACK_C + np.array([s * 0.128, 0.010, -0.045]), (0.022, 0.040, 0.060), R6, rad=0.018) for s in (1, -1)]
    roll = S.Cylinder(PACK_C + np.array([0, -0.004, 0.182]), 0.046, 0.165, S.rot_y(90), rad=0.03)
    straps = [S.Torus(PACK_C + np.array([s * 0.10, -0.004, 0.182]), 0.048, 0.004, S.rot_y(90)) for s in (1, -1)]
    buckles = [S.Box(PACK_C + np.array([s * 0.06, 0.082, 0.045]), (0.010, 0.004, 0.030), R6, rad=0.003) for s in (1, -1)]
    tool = S.Box(PACK_C + np.array([0.100, 0.075, -0.060]), (0.024, 0.012, 0.100), R6, rad=0.012)
    handle = S.RoundCone(PACK_C + np.array([0.100, 0.075, 0.03]), PACK_C + np.array([0.100, 0.070, 0.15]), 0.010)
    return S.Union([body, flap, roll] + pockets + straps + buckles + [tool, handle], k=0.008)


def pack_paint(seed=0):
    def paint(P):
        col, r, m = PT.fabric(P, (0.24, 0.25, 0.17), "canvas", dust_amt=0.3, fade=0.35, seed=seed + 90, grime=0.4)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        q = P - PACK_C
        roll = (q[:, 2] > 0.14)
        col[roll] = col[roll] * 0.6 + srgb(0.16, 0.14, 0.10) * 0.4
        strap = roll & (np.abs(np.abs(q[:, 0]) - 0.11) < 0.008)
        col[strap] = srgb(0.08, 0.07, 0.05)
        tool = (q[:, 0] > 0.08) & (q[:, 1] > 0.05)
        col[tool] = col[tool] * 0.8
        flap = (q[:, 2] > 0.03) & (q[:, 2] < 0.14) & (q[:, 1] > 0.05)
        col[flap] *= 0.9
        edge = (np.abs(q[:, 2] - 0.028) < 0.004) & (q[:, 1] > 0.05)
        col[edge] *= 0.6
        bk = (np.abs(np.abs(q[:, 0]) - 0.06) < 0.011) & (np.abs(q[:, 2] - 0.045) < 0.03) & (q[:, 1] > 0.075)
        col[bk] = srgb(0.08, 0.07, 0.05)
        return np.clip(col, 0, 1), r, m
    return paint


# ------------------------------------------------------------------ the officer's greatcoat

def greatcoat_paint(color=OLIVE_DARK, seed=0):
    base = tunic_paint(color, seed=seed, hem_z=0.52, pockets=False, buttons=False, dust=0.35)

    def paint(P):
        col, r, m = base(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        front = y < -0.06
        # double-breasted: two columns of dark buttons down to the belt
        for bx in (0.055, -0.055):
            bz = (z - 1.02) % 0.075
            btn = front & (np.abs(x - bx) < 0.0075) & (np.abs(bz - 0.037) < 0.0075) & (z > 1.06) & (z < 1.36)
            col[btn] = srgb(0.03, 0.03, 0.03)
            r[btn] = 0.4
        # the leather belt and its buckle
        belt = np.abs(z - 1.02) < 0.024
        lc, lr, lm = PT.leather(P, LEATHER_BLACK, 0.1, 0.3, seed=seed + 97, shine=0.6)
        col[belt], r[belt], m[belt] = lc[belt], lr[belt], lm[belt]
        bk = belt & front & (np.abs(x) < 0.028)
        mc, mr, mm = PT.metal(P, (0.45, 0.43, 0.38), 0.35, seed=seed + 98)
        col[bk], r[bk], m[bk] = mc[bk], mr[bk], mm[bk]
        # the collar a shade darker (it is a separate cloth)
        col[z > 1.47] *= 0.8
        return np.clip(col, 0, 1), r, m
    return paint
