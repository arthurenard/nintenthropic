"""Weapons and hand props, sculpted in their socket's frame.

The frame is charlib's grip frame (socket.gun on hand.R): the origin is the
centre of the fist, +Y runs along the barrel (glTF -Z), +Z is the top of the
gun (glTF +Y), +X the shooter's right. Every prop is exported as a child of
its socket with an identity transform, so its vertices are in this frame and
the game only toggles visibility.

- gun.rifle           a bolt-action service rifle, held at the wrist of the stock
- gun.rifle.scoped    the counter-sniper's: the same rifle with a telescope;
                      socket.glint (an empty, its child) sits on the
                      objective lens, looking down the barrel
- gun.mg              a bipod light machine gun with a top-mounted magazine
- prop.binoculars     held in the right fist round the right barrel
- prop.cigarette      on socket.hand.L (the left fist's mirror of socket.gun)
- gun.rifle.slung     the rifle hung on the right shoulder, muzzle up (on
                      socket.back, which rides the chest)
"""
import numpy as np
from charlib import sdf as S, paint as PT
from charlib.texture import srgb, smoothstep, value_noise

BORE_Z = 0.052          # the rifle's bore above the centre of the fist
MUZZLE_Y = 0.770
BUTT_Y = -0.355
SCOPE_Z = BORE_Z + 0.042
LENS_Y = 0.364          # the scope's objective lens
MG_BORE_Z = 0.052
MG_MUZZLE_Y = 0.845
MG_FOOT = (0.105, 0.715, -0.245)   # bipod feet (x either side): 0.297 m below the bore

WOOD = (0.20, 0.115, 0.06)
BLUED = (0.075, 0.078, 0.082)


# ------------------------------------------------------------------ the rifle

def _stock():
    """Butt and wrist: a straight comb, the toe dropping to a steel butt plate."""
    return S.Tube([(0, BUTT_Y, -0.043), (0, -0.25, -0.031), (0, -0.14, -0.017), (0, -0.06, -0.003), (0, 0.0, 0.012), (0, 0.05, 0.030)],
                  [0.021, 0.020, 0.018, 0.0155, 0.0145, 0.0155], [0.062, 0.053, 0.041, 0.029, 0.024, 0.026], side=(1, 0, 0))


def rifle_parts(scoped=False):
    bz = BORE_Z
    parts = [_stock()]
    # forend under the barrel, upper handguard on top of it
    parts.append(S.Tube([(0, 0.04, bz - 0.014), (0, 0.30, bz - 0.012), (0, 0.66, bz - 0.009)], [0.0165, 0.0160, 0.0125], [0.021, 0.019, 0.014], side=(1, 0, 0)))
    parts.append(S.Tube([(0, 0.25, bz + 0.004), (0, 0.56, bz + 0.004)], [0.0115, 0.0105], [0.0105, 0.0095], side=(1, 0, 0)))
    # receiver, bolt and its handle (on the right), magazine well, guard, trigger
    parts.append(S.Cylinder((0, 0.125, bz), 0.0135, 0.095, S.rot_x(90), rad=0.003))
    parts.append(S.Cylinder((0, 0.035, bz + 0.004), 0.0095, 0.055, S.rot_x(90), rad=0.003))
    hz = bz - (0.018 if scoped else 0.010)
    parts.append(S.RoundCone((0.010, 0.012, bz + 0.004), (0.040, 0.004, hz), 0.0038, 0.0034))
    parts.append(S.Sphere((0.043, 0.004, hz - 0.002), 0.0085))
    parts.append(S.Box((0, 0.095, bz - 0.030), (0.0105, 0.038, 0.014), None, rad=0.003))
    guard = S.Torus((0, 0.036, 0.004), 0.021, 0.0028, S.rot_y(90))
    parts.append(S.Intersect(guard, S.Plane((0, 0, 0.014), (0, 0, 1), (-0.1, -0.1, -0.1), (0.1, 0.1, 0.1))))
    parts.append(S.RoundCone((0, 0.036, 0.018), (0, 0.031, 0.002), 0.0025))
    # barrel, bands, sights
    parts.append(S.RoundCone((0, 0.20, bz), (0, MUZZLE_Y, bz), 0.0098, 0.0082))
    for y in (0.45, 0.635):
        parts.append(S.Cylinder((0, y, bz - 0.006), 0.021 if y < 0.5 else 0.018, 0.007, S.rot_x(90), rad=0.002))
    parts.append(S.Box((0, MUZZLE_Y - 0.015, bz + 0.012), (0.0014, 0.006, 0.006), None, rad=0.001))
    parts.append(S.Box((0, 0.232, bz + 0.013), (0.009, 0.020, 0.0045), None, rad=0.0015))
    # butt plate
    parts.append(S.Box((0, BUTT_Y - 0.001, -0.043), (0.021, 0.004, 0.063), None, rad=0.004))
    # the sling: from the front band's swivel, hanging below, to the butt
    sl = [(0, 0.625, bz - 0.030), (0, 0.45, -0.050), (0, 0.18, -0.085), (0, -0.05, -0.095), (0, -0.20, -0.098), (0, -0.265, -0.090)]
    parts.append(S.Tube(sl, [0.0125] * len(sl), [0.0019] * len(sl), side=(1, 0, 0)))
    for sw in ((0, 0.625, bz - 0.026), (0, -0.265, -0.082)):
        parts.append(S.Torus(sw, 0.008, 0.0018, S.rot_y(90)))
    if scoped:
        sz = SCOPE_Z
        parts.append(S.Cylinder((0, 0.17, sz), 0.0125, 0.14, S.rot_x(90), rad=0.004))
        parts.append(S.RoundCone((0, 0.285, sz), (0, 0.345, sz), 0.0135, 0.0215))
        parts.append(S.Cylinder((0, 0.352, sz), 0.0222, 0.0125, S.rot_x(90), rad=0.004))
        parts.append(S.RoundCone((0, 0.055, sz), (0, 0.012, sz), 0.0135, 0.0185))
        parts.append(S.Cylinder((0, 0.004, sz), 0.019, 0.012, S.rot_x(90), rad=0.004))
        parts.append(S.Cylinder((0, 0.17, sz + 0.016), 0.0085, 0.008, None, rad=0.002))
        parts.append(S.Cylinder((0.016, 0.17, sz), 0.0085, 0.008, S.rot_y(90), rad=0.002))
        for y in (0.075, 0.20):
            parts.append(S.Box((0, y, (bz + sz) * 0.5), (0.008, 0.008, (sz - bz) * 0.5), None, rad=0.002))
            parts.append(S.Torus((0, y, sz), 0.0135, 0.0032, S.rot_x(90)))
    return parts


def rifle_field(scoped=False):
    return S.Union(rifle_parts(scoped), k=0.003)


def rifle_paint(scoped=False):
    bz = BORE_Z

    def paint(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        c, r, m = PT.metal(P, BLUED, 0.42, rust=0.12, seed=201)
        # oiled walnut: the stock, the forend and the handguard
        wood = ((y < 0.045) & (z < bz - 0.010)) | ((y > 0.03) & (y < 0.67) & (z < bz - 0.011)) | ((y > 0.245) & (y < 0.565) & (z > bz + 0.006))
        wood &= ~((y < -0.345))                       # butt plate
        wood &= ~((np.abs(y - 0.036) < 0.024) & (z < 0.02) & (z > -0.02) & (np.abs(x) < 0.006))
        wood &= ~((np.abs(y - 0.45) < 0.008) | (np.abs(y - 0.635) < 0.008))
        # a coarser grain than charlib's (its rings alias on a rifle's few texels)
        wc, wr, wm = PT.wood(P * 0.35, WOOD, axis=(0, 1, 0.12), seed=202, rough=0.45)
        # handling: darker and smoother where hands go, dents on the butt
        grip = np.exp(-((y - 0.0) / 0.05) ** 2) + np.exp(-((y - 0.33) / 0.08) ** 2)
        wc *= (1 - 0.25 * np.clip(grip, 0, 1))[:, None]
        wr = wr - 0.1 * np.clip(grip, 0, 1)
        dents = smoothstep(0.8, 0.86, value_noise(P, 300, seed=203)) * (y < -0.1)
        wc *= (1 - 0.3 * dents)[:, None]
        c[wood], r[wood], m[wood] = wc[wood], wr[wood], wm[wood]
        # the sling: brown leather
        sling = (z < bz - 0.02) & (np.abs(x) < 0.014) & ~wood & (y > -0.27) & (y < 0.62) & (z < -0.03 + 0.1 * (y > 0.4))
        sling |= (z < -0.07) & (y > -0.27) & (np.abs(x) < 0.014)
        lc, lr, lm = PT.leather(P, (0.20, 0.12, 0.06), 0.15, 0.5, seed=204)
        c[sling], r[sling], m[sling] = lc[sling], lr[sling], lm[sling]
        # worn bright on the bolt knob and the muzzle
        wear = np.exp(-(np.linalg.norm(P - np.array([0.043, 0.004, bz - 0.012]), axis=1) / 0.012) ** 2) + np.exp(-((y - MUZZLE_Y) / 0.012) ** 2)
        c = c * (1 - 0.5 * np.clip(wear, 0, 1)[:, None]) + srgb(0.35, 0.35, 0.36) * 0.5 * np.clip(wear, 0, 1)[:, None]
        if scoped:
            sc = (z > bz + 0.028)
            scol, sr, sm = PT.metal(P, (0.04, 0.042, 0.045), 0.35, seed=205)
            c[sc], r[sc], m[sc] = scol[sc], sr[sc], sm[sc]
            # glass: the objective and the eyepiece, deep blue-black and glossy
            lens = ((y > LENS_Y - 0.004) | (y < -0.004)) & (np.hypot(x, z - SCOPE_Z) < 0.017)
            c[lens] = srgb(0.02, 0.035, 0.06)
            r[lens] = 0.04
            m[lens] = 0.0
        return np.clip(c, 0, 1), np.clip(r, 0.03, 1), m
    return paint


# ------------------------------------------------------------------ the machine gun

def mg_field():
    """A bipod light machine gun built on the rifle's key points - the fist
    on its pistol grip where the rifle's wrist is, the same butt plate, bore
    height and forend - so every rifle clip holds it too; what reads is
    different: a top-mounted curved magazine, a heavy finned barrel, a
    carrying handle, a bipod."""
    bz = MG_BORE_Z
    parts = []
    parts.append(S.Box((0, 0.105, bz - 0.002), (0.021, 0.135, 0.030), None, rad=0.006))           # receiver
    parts.append(S.Tube([(0, 0.006, 0.030), (0, -0.010, -0.012), (0, -0.028, -0.058)], [0.0135, 0.014, 0.0145],
                        [0.019, 0.021, 0.022], side=(1, 0, 0)))                                     # pistol grip
    guard = S.Torus((0, 0.036, 0.008), 0.020, 0.0028, S.rot_y(90))
    parts.append(S.Intersect(guard, S.Plane((0, 0, 0.022), (0, 0, 1), (-0.1, -0.1, -0.1), (0.1, 0.1, 0.1))))
    parts.append(S.RoundCone((0, 0.036, 0.022), (0, 0.030, 0.004), 0.0025))
    # a skeleton stock dropping to the rifle's butt plate
    parts.append(S.Tube([(0, -0.030, bz - 0.010), (0, -0.14, 0.010), (0, -0.25, -0.017), (0, -0.350, -0.043)],
                        [0.015, 0.016, 0.018, 0.020], [0.024, 0.036, 0.050, 0.060], side=(1, 0, 0)))
    parts.append(S.Box((0, BUTT_Y - 0.001, -0.043), (0.021, 0.004, 0.063), None, rad=0.004))
    # wooden handguard under the barrel where the left hand holds it
    parts.append(S.Tube([(0, 0.24, 0.036), (0, 0.42, 0.036)], [0.019, 0.017], [0.021, 0.019], side=(1, 0, 0)))
    # the barrel: finned jacket ahead of the handguard, gas tube, flash hider
    parts.append(S.RoundCone((0, 0.24, bz), (0, 0.80, bz), 0.0125, 0.011))
    parts.append(S.Cylinder((0, 0.48, bz), 0.019, 0.055, S.rot_x(90), rad=0.004))
    parts.append(S.Union([S.Cylinder((0, y, bz), 0.0225, 0.0022, S.rot_x(90)) for y in np.linspace(0.435, 0.525, 7)]))
    parts.append(S.RoundCone((0, 0.42, bz - 0.026), (0, 0.62, bz - 0.026), 0.0080))
    parts.append(S.RoundCone((0, 0.795, bz), (0, MG_MUZZLE_Y, bz), 0.0135, 0.017))
    parts.append(S.Box((0, 0.805, bz + 0.022), (0.0015, 0.006, 0.010), None, rad=0.001))
    # carrying handle
    h = S.Torus((0, 0.48, bz + 0.036), 0.028, 0.0045, S.rot_y(90))
    parts.append(S.Intersect(h, S.Plane((0, 0, bz + 0.034), (0, 0, -1), (-0.1, 0.3, -0.1), (0.1, 0.6, 0.3))))
    # the curved magazine standing on top, the rear sight offset left of it
    mag = [(0, 0.080, bz + 0.024), (0, 0.090, bz + 0.100), (0, 0.115, bz + 0.175), (0, 0.155, bz + 0.235)]
    parts.append(S.Tube(mag, [0.014] * 4, [0.036, 0.037, 0.037, 0.036], side=(1, 0, 0)))
    parts.append(S.Box((-0.027, 0.02, bz + 0.034), (0.007, 0.012, 0.012), None, rad=0.003))
    # bipod: a clamp on the barrel, legs splayed down and forward
    fx, fy, fz = MG_FOOT
    parts.append(S.Cylinder((0, 0.64, bz), 0.018, 0.012, S.rot_x(90), rad=0.003))
    for s_ in (1, -1):
        top = np.array([s_ * 0.013, 0.645, bz - 0.012])
        foot = np.array([s_ * fx, fy, fz])
        parts.append(S.RoundCone(top, foot, 0.0065, 0.0055))
        parts.append(S.RoundCone(foot, foot + np.array([0, 0.004, -0.016]), 0.0055, 0.002))
        parts.append(S.Cylinder(foot + (top - foot) * 0.12, 0.011, 0.0025, None, rad=0.001))
    return S.Union(parts, k=0.003)


def mg_paint(P):
    y, z = P[:, 1], P[:, 2]
    bz = MG_BORE_Z
    c, r, m = PT.metal(P, (0.085, 0.088, 0.085), 0.55, rust=0.15, seed=211)
    stock = (y < -0.035) & (y > -0.350)
    grip = (y < 0.03) & (y > -0.05) & (z < 0.02)
    guard = (y > 0.235) & (y < 0.425) & (z < bz - 0.012)
    wood = stock | grip | guard
    wc, wr, wm = PT.wood(P * 0.35, (0.18, 0.10, 0.05), axis=(0, 1, 0.1), seed=212, rough=0.5)
    c[wood], r[wood], m[wood] = wc[wood], wr[wood], wm[wood]
    # the finned jacket and the muzzle heat-browned
    hot = (np.abs(y - 0.48) < 0.06) | (y > 0.79)
    c[hot] = c[hot] * 0.7 + srgb(0.10, 0.07, 0.05) * 0.3
    mag = (z > bz + 0.03) & (y > 0.05) & (y < 0.20)
    c[mag] = c[mag] * 0.85
    return np.clip(c, 0, 1), r, m


# ------------------------------------------------------------------ binoculars

def _bino_frame():
    """Where the binoculars sit in socket.gun's frame. Modelled held up to
    the eyes: optical axes along -Y (ahead), eyepieces at y = 0, the right
    barrel on his right (-x). The right fist closes round the right prism
    housing, fingers over the top, thumb underneath pointing back at the eye:
    socket +Y (knuckles) = up, +Z (thumb) = back (+y), +X = his right."""
    c = np.array([-0.052, -0.085, -0.004])
    Rm = np.array([[-1.0, 0, 0], [0, 0, 1.0], [0, 1.0, 0]]).T      # columns: socket X, Y, Z in binocular space
    return c, Rm


def binoculars_bino_field():
    parts = []
    for s in (1, -1):
        ex, ox = s * 0.032, s * 0.056
        parts.append(S.Cylinder((ex, 0.012, 0.0), 0.0155, 0.022, S.rot_x(90), rad=0.004))          # eyepiece
        parts.append(S.Box(((ex + ox) / 2, -0.055, -0.004), (0.030, 0.032, 0.024), None, rad=0.012))  # prism housing
        parts.append(S.Cylinder((ox, -0.120, -0.008), 0.024, 0.048, S.rot_x(90), rad=0.006))       # objective barrel
        parts.append(S.Cylinder((ox, -0.172, -0.008), 0.026, 0.006, S.rot_x(90), rad=0.003))
    parts.append(S.Cylinder((0, -0.04, 0.004), 0.011, 0.055, S.rot_x(90), rad=0.003))            # hinge
    parts.append(S.Cylinder((0, 0.006, 0.010), 0.010, 0.008, S.rot_x(90), rad=0.003))            # focus wheel
    return S.Union(parts, k=0.004)


def binoculars_field():
    fb = binoculars_bino_field()
    c, Rm = _bino_frame()
    # socket-frame point q -> binocular space p = Rm q + c
    f = S.Fn(lambda Q: fb((np.asarray(Q, np.float32) @ Rm.T.astype(np.float32)) + c.astype(np.float32)),
             *_bounds(fb, c, Rm))
    return f


def _bounds(field, c, Rm):
    lo, hi = np.asarray(field.lo), np.asarray(field.hi)
    corners = np.array([[a, b, d] for a in (lo[0], hi[0]) for b in (lo[1], hi[1]) for d in (lo[2], hi[2])])
    q = (corners - c) @ Rm           # p = Rm q + c  ->  q = Rm^T (p - c)
    return q.min(0) - 0.01, q.max(0) + 0.01


def binoculars_paint(P):
    c, Rm = _bino_frame()
    B = P @ Rm.T + c
    col, r, m = PT.leather(P, (0.03, 0.03, 0.028), 0.05, 0.3, seed=221)
    x, y, z = B[:, 0], B[:, 1], B[:, 2]
    metal = (y > 0.0) | (y < -0.165) | (np.abs(x) < 0.013)
    mc, mr, mm = PT.metal(P, (0.06, 0.06, 0.06), 0.4, seed=222)
    col[metal], r[metal], m[metal] = mc[metal], mr[metal], mm[metal]
    lens = ((y < -0.176) & (np.hypot(np.abs(x) - 0.056, z + 0.008) < 0.02)) | ((y > 0.030) & (np.hypot(np.abs(x) - 0.032, z) < 0.011))
    col[lens] = srgb(0.03, 0.05, 0.07)
    r[lens] = 0.05
    m[lens] = 0.0
    return np.clip(col, 0, 1), r, m


# ------------------------------------------------------------------ the cigarette (socket.hand.L)

# pinched between the thumb and the side of the index at the top of the left
# fist (socket.hand.L's frame), the lit end cupped toward the palm, the other
# end (CIG_B) standing out of the fist - it is the end put to the lips
_CIG_P = np.array([0.0, 0.020, 0.040])
_CIG_D = np.array([0.15, 0.55, 0.82]) / np.linalg.norm([0.15, 0.55, 0.82])
CIG_A = _CIG_P - 0.020 * _CIG_D
CIG_B = _CIG_P + 0.060 * _CIG_D


def cigarette_field():
    return S.RoundCone(CIG_A, CIG_B, 0.0042, 0.0042)


def cigarette_paint(P):
    n = len(P)
    t = ((P - CIG_A) @ (CIG_B - CIG_A)) / float((CIG_B - CIG_A) @ (CIG_B - CIG_A))
    col = np.tile(srgb(0.86, 0.84, 0.78), (n, 1))
    r = np.full(n, 0.8)
    ash = t < 0.07              # the lit end is A, cupped toward the palm
    col[ash] = srgb(0.35, 0.33, 0.32)
    ember = t < 0.015
    col[ember] = srgb(0.9, 0.25, 0.05)
    return col, r, np.zeros(n)


# ------------------------------------------------------------------ the slung rifle (socket.back, rides the chest)

def slung_frame():
    """World placement of the grip frame when the rifle hangs from the right
    shoulder, muzzle up behind it, butt at the hip (rest pose)."""
    up = np.array([0.02, -0.10, 1.0])
    up /= np.linalg.norm(up)
    top = np.array([0.95, 0.20, 0.0])       # the gun's top faces out to his right-back
    top = -top
    top -= up * (top @ up)
    top /= np.linalg.norm(top)
    x = np.cross(up, top)
    Rm = np.stack([x, up, top], 1)          # columns: grip X, Y (barrel), Z (top) in world
    o = np.array([-0.215, 0.115, 1.02])     # the wrist of the stock, behind the right hip
    return Rm, o


def slung_field():
    """The rifle in its slung placement, with the sling over the shoulder
    (world space, rigid on the chest)."""
    Rm, o = slung_frame()
    rf = rifle_field()
    parts = [S.Fn(lambda P: rf(((np.asarray(P, np.float32) - o) @ Rm).astype(np.float32)), *_bounds_w(rf, Rm, o))]
    # the sling: from the upper swivel over the front of the right shoulder,
    # down under the armpit and back to the butt swivel
    up_sw = o + Rm @ np.array([0, 0.625, BORE_Z - 0.026])
    lo_sw = o + Rm @ np.array([0, -0.265, -0.082])
    path = [up_sw, (-0.200, 0.02, 1.515), (-0.195, -0.075, 1.47), (-0.205, -0.10, 1.38), (-0.215, -0.02, 1.27), lo_sw]
    parts.append(S.Tube(np.array(path, float), [0.0125] * len(path), [0.0022] * len(path), side=(1, 0, 0)))
    return S.Union(parts, k=0.003)


def _bounds_w(field, Rm, o):
    lo, hi = np.asarray(field.lo), np.asarray(field.hi)
    corners = np.array([[a, b, d] for a in (lo[0], hi[0]) for b in (lo[1], hi[1]) for d in (lo[2], hi[2])])
    w = corners @ Rm.T + o
    return w.min(0) - 0.01, w.max(0) + 0.01


def slung_paint():
    Rm, o = slung_frame()
    base = rifle_paint()

    def paint(P):
        Q = (P - o) @ Rm
        c, r, m = base(Q)
        # the part of the sling over the shoulder, away from the rifle
        far = np.abs(Q[:, 0]) > 0.03
        lc, lr, lm = PT.leather(P, (0.20, 0.12, 0.06), 0.15, 0.5, seed=204)
        c[far], r[far], m[far] = lc[far], lr[far], lm[far]
        return c, r, m
    return paint
