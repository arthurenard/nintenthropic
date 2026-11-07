"""What every driver is made of: a racing suit, gloved arms, a helmet, glossy eyes, a smile.

The species files call these with their own proportions and colours and add
what makes them themselves (ears, bills, tails, goggles).
"""
import numpy as np

import sdflib as S
from rig import Part

lin = S.srgb

INK = lin("#16151f")
WHITE = lin("#f6f7fa")
NAVY = lin("#1d2547")
PINK = lin("#f4a1b4")

# Where the game turns things (src/kart/render/drivers/parts.ts).
HEAD_AT = (0.0, 0.84, 0.06)
SHOULDER_Y = 0.46
SHOULDER_Z = 0.02
ARM_LEN = 0.54


def furvar(P, s=0.06):
    """Soft fur or feather colour variation: a gentle multiplier, brighter and duller patches."""
    return 1.0 - s + s * 1.7 * (S.noise(P, 9.0, 3.1) * 0.6 + S.noise(P, 23.0, 8.7) * 0.4)[:, None]


def band(lo, hi, axis=1):
    """A slab region (negative where lo < p[axis] < hi) for cutting patches."""
    mid, half = (lo + hi) / 2.0, (hi - lo) / 2.0
    return lambda P: np.abs(P[:, axis] - mid) - half


def patch(base, region, lift=0.006, k=0.008):
    """A skin laid over `base` where `region` is negative: a raised decal with rounded edges (belt, bib, stripe)."""
    return S.intersect(S.offset(base, lift), region, k)


# ---------------------------------------------------------------- the suit


def torso_sdf(w, d, shoulder, thigh=0.085, spread=0.15, chest_y=0.33, chest_h=0.31, belly_k=0.05):
    """(the upper body, the hips and thighs)."""
    chest = S.ellipsoid((0, chest_y, 0), (w, chest_h, d))
    neck = S.ellipsoid((0, 0.56, 0.02), (w * 0.6, 0.1, d * 0.72))
    shoulders = S.mirror(S.ellipsoid((shoulder - 0.035, 0.46, 0.02), (0.1, 0.095, 0.1)))
    upper = S.union(chest, neck, shoulders, k=belly_k)
    hips = S.ellipsoid((0, 0.10, -0.02), (w * 0.98, 0.17, 0.25))
    thighs = S.mirror(S.roundcone((spread, 0.045, 0.0), (spread + 0.04, 0.0, 0.4), thigh, thigh * 0.9))
    return upper, S.union(hips, thighs, k=0.04)


def shoe_sdf(thigh=0.085, spread=0.15, scale=1.0):
    r = thigh
    return S.mirror(S.ellipsoid((spread + 0.04, -0.005, 0.465), (r * 1.18 * scale, r * 0.98, r * 1.55 * scale)))


def torso(sp, w=0.25, d=0.19, shoulder=0.28, thigh=0.085, spread=0.15, shoe="#2d3350", shoe_mat="plastic", pants=NAVY, belly=None,
          chest="vest", chest_albedo=None, bib=True, collar=True, belt=True, collar_mat="paintcloth", extra=None, belly_size=(0.74, 0.24, 0.62), budget=1.0,
          chest_h=0.31, chest_y=0.33, collar_h=0.072, chest_band=True):
    """The body: trousers over the hips and thighs (forward over the kart's hood) and shoes, a racing jacket over the chest
    and shoulders, a belt in the kart's colour where they meet, a bib on the back, a collar.

    `chest` is the jacket's material ("vest" for the jacket in the kart's tint, "fur" for a creature in its own coat, with
    `chest_albedo`). `belly` is a colour for a furry belly patch on the front. `extra(part)` adds the species' own bits.
    """
    part = Part(sp, "torso")
    upper, lower = torso_sdf(w, d, shoulder, thigh, spread, chest_y=chest_y, chest_h=chest_h)
    shoes = shoe_sdf(thigh, spread)
    shoe_c = lin(shoe) if isinstance(shoe, str) else np.asarray(shoe)
    t = lambda n: max(40, int(n * budget))
    part.solid(lower, (-0.5, -0.12, -0.42), (0.5, 0.45, 0.62), h=0.011, tris=t(300), albedo=np.asarray(pants), mat="cloth", ao=0.5)
    part.solid(shoes, (-0.4, -0.12, 0.25), (0.4, 0.14, 0.7), h=0.008, tris=t(100), albedo=shoe_c, mat=shoe_mat, ao=0.4)
    part.solid(upper, (-0.5, -0.02, -0.4), (0.5, 0.72, 0.4), h=0.0085, tris=t(560), albedo=chest_albedo if chest == "fur" else (1, 1, 1), mat=chest, ao=0.4)
    body = S.union(upper, lower, k=0.03)
    if belt:
        part.solid(patch(body, band(0.175, 0.232), 0.012, 0.012), (-0.4, 0.1, -0.35), (0.4, 0.34, 0.35), h=0.008, tris=t(110), mat="paintcloth", ao=0.25)
    if chest_band and chest == "vest":
        # A racing band across the chest, a white pin below it.
        front = lambda P: np.maximum(np.abs(P[:, 1] - 0.415) - 0.03, 0.02 - P[:, 2])
        part.solid(patch(upper, front, 0.013, 0.012), (-0.4, 0.2, -0.05), (0.4, 0.62, 0.4), h=0.0075, tris=t(120), mat="paintcloth", ao=0.25)
        pin = lambda P: np.maximum(np.abs(P[:, 1] - 0.368) - 0.007, 0.02 - P[:, 2])
        part.solid(patch(upper, pin, 0.011, 0.005), (-0.4, 0.2, -0.05), (0.4, 0.62, 0.4), h=0.0055, tris=t(60), mat="trim", albedo=WHITE, ao=0.0)
    if bib:
        back = lambda P: np.maximum(np.abs(P[:, 0]) - w * 0.55, np.maximum(np.abs(P[:, 1] - 0.38) - 0.14, -(P[:, 2] + d * 0.1)))
        part.solid(patch(upper, back, 0.014, 0.014), (-0.4, 0.15, -0.35), (0.4, 0.6, 0.0), h=0.008, tris=t(120), mat="paintcloth", ao=0.25)
        stripe = lambda P: np.maximum(np.abs(P[:, 0]) - w * 0.42, np.maximum(np.abs(P[:, 1] - 0.4) - 0.028, -(P[:, 2] + d * 0.1)))
        part.solid(patch(upper, stripe, 0.02, 0.01), (-0.4, 0.2, -0.35), (0.4, 0.55, 0.0), h=0.007, tris=t(50), mat="trim", albedo=WHITE, ao=0.0)
    if collar:
        neck = S.ellipsoid((0, 0.57, 0.02), (w * 0.84, collar_h, d * 0.94))
        part.solid(neck, (-0.4, 0.45, -0.3), (0.4, 0.68, 0.3), h=0.008, tris=t(130), mat=collar_mat, ao=0.3)
    if belly is not None:
        bc = lin(belly) if isinstance(belly, str) else np.asarray(belly)
        bulge = S.ellipsoid((0, chest_y - 0.03, d * 0.52), (w * belly_size[0], belly_size[1], d * belly_size[2]))
        part.solid(bulge, (-0.4, 0.0, 0.0), (0.4, 0.62, 0.4), h=0.0075, tris=t(130), albedo=bc, mat="fur", ao=0.35, reach=0.06)
    if extra:
        extra(part)
    return part


# ------------------------------------------------------------------- arms


def arm(sp, side, shoulder_x, r=0.07, fur=(0.8, 0.5, 0.2), glove=WHITE, glove_mat="trim", sleeve=True, cuff_mat="paintcloth", handR=None, thumb=True, length=ARM_LEN,
        glove_ring=True, budget=1.0, flipper=False, arm_mat="fur"):
    """An arm along +z from its shoulder (side +1 is the driver's left, +x): a furred arm in a short sleeve with a cuff in
    the kart's colour, and a gloved hand with a thumb. Origin at the shoulder (a ball joint: the arm turns about it)."""
    name = "arm.L" if side > 0 else "arm.R"
    part = Part(sp, name, (side * shoulder_x, SHOULDER_Y, SHOULDER_Z))
    hr = handR or r * 1.4
    zh = length * 0.855
    t = lambda n: max(40, int(n * budget))
    fur_c = np.asarray(fur)
    glove_c = np.asarray(glove)
    if flipper:
        # A flat paddle of a flipper: no glove, no sleeve.
        fl = S.scaled(S.roundcone((0, 0, 0.0), (0, 0, length * 0.92), r * 1.55, r * 1.0), (1, 0.42, 1), about=(0, 0, length * 0.4))
        part.solid(fl, (-0.22, -0.22, -0.22), (0.22, 0.22, length + 0.1), h=0.0075, tris=t(220), albedo=fur_c, mat=arm_mat, ao=0.35, symmetric=False)
        return part
    upper = S.roundcone((0, 0, 0.0), (0, 0, length * 0.42), r * 1.1, r * 1.04)
    fore = S.roundcone((0, 0, length * 0.3), (0, 0, zh - hr * 0.5), r * 1.02, r * 0.92)
    bounds = ((-0.22, -0.22, -0.22), (0.22, 0.22, length + 0.1))
    part.solid(S.union(upper, fore, k=0.02), *bounds, h=0.0075, tris=t(110), albedo=fur_c, mat=arm_mat, ao=0.35, symmetric=False)
    # The glove: a flared cuff, a round mitt, a thumb on the inner, upper side (the hand holds the wheel thumb up and in).
    mitt = [S.ellipsoid((0, 0, zh), (hr, hr * 0.96, hr * 1.12)), S.roundcone((0, 0, zh - hr * 1.25), (0, 0, zh - hr * 0.2), r * 1.2, hr * 0.92)]
    if thumb:
        mitt.append(S.roundcone((-side * hr * 0.55, hr * 0.5, zh - hr * 0.35), (-side * hr * 0.95, hr * 0.85, zh + hr * 0.45), hr * 0.38, hr * 0.28))
    gl = S.union(*mitt, k=0.02)
    part.solid(gl, *bounds, h=0.0065, tris=t(140), albedo=glove_c, mat=glove_mat, ao=0.35, symmetric=False)
    if glove_ring:
        wrist = zh - hr * 1.0
        ring = S.intersect(S.offset(gl, 0.005), band(wrist - 0.016, wrist + 0.016, 2), 0.006)
        part.solid(ring, *bounds, h=0.005, tris=t(50), mat=cuff_mat, ao=0.2, symmetric=False)
    if sleeve:
        zc = length * 0.33
        sl = S.intersect(S.roundcone((0, 0, 0.0), (0, 0, zc + 0.05), r * 1.34, r * 1.26), lambda P: P[:, 2] - zc, 0.008)
        part.solid(sl, *bounds, h=0.0065, tris=t(100), mat="vest", ao=0.35, symmetric=False)
        rim = S.intersect(S.offset(sl, 0.006), band(zc - 0.034, zc + 0.002, 2), 0.006)
        part.solid(rim, *bounds, h=0.005, tris=t(60), mat=cuff_mat, ao=0.2, symmetric=False)
    return part


def scarf_tail(sp, at=(0.1, 0.58, -0.14)):
    """The scarf's tail, hanging from the knot behind the shoulder (the game flutters it): the kart's colour, a white band."""
    part = Part(sp, "scarf", at)
    part.solid(S.box((0, -0.16, -0.02), (0.052, 0.17, 0.017), 0.013), (-0.15, -0.4, -0.1), (0.15, 0.1, 0.07), h=0.0055, tris=110, mat="paintcloth", ao=0.25, symmetric=False)
    part.solid(S.box((0, -0.3, -0.02), (0.055, 0.02, 0.019), 0.009), (-0.15, -0.4, -0.1), (0.15, 0.1, 0.07), h=0.005, tris=60, mat="trim", albedo=WHITE, ao=0.0, symmetric=False)
    return part


# ----------------------------------------------------------------- helmet


def helmet(sp, at, r, tilt=0.35, cut=0.08, ear_holes=None, stripe=True, peak=True, rim=True, peak_size=1.0, h=0.0075, tris=520, budget=1.0, paint_mat="paint",
           rim_loop=22):
    """A racing helmet over the crown in the kart's colour ("paint"): a dome cut by a plane that rides higher at the
    brow and lower at the nape, a pale rolled rim, a stripe over the crown and a peak. Origin = the head's centre.
    `ear_holes` is a shape cut out of the shell (ears through it)."""
    part = Part(sp, "helmet", HEAD_AT)
    c = np.asarray(at, float)
    r = np.asarray(r, float)
    nrm = float(np.sqrt(1 + tilt * tilt))
    plane = lambda P: (cut + tilt * (P[:, 2] - c[2]) - P[:, 1]) / nrm
    dome = S.ellipsoid(c, r)
    shell = S.intersect(dome, plane, 0.016)
    if peak:
        zf = c[2] + r[2] * 0.8
        yf = cut + tilt * (zf - c[2])
        bill = S.ellipsoid((0, yf + 0.012, zf + 0.035), (r[0] * 0.46 * peak_size, 0.024, 0.075 * peak_size), rot=(0, 11, 0))
        shell = S.union(shell, bill, k=0.016)
    if ear_holes is not None:
        shell = S.subtract(shell, ear_holes, 0.012)
    lo = (c[0] - r[0] - 0.06, c[1] - r[1] - 0.06, c[2] - r[2] - 0.06)
    hi = (c[0] + r[0] + 0.06, c[1] + r[1] + 0.06, c[2] + r[2] + 0.16)
    t = lambda n: max(40, int(n * budget))
    part.solid(shell, lo, hi, h=h, tris=t(tris), mat=paint_mat, ao=0.3, reach=0.06)
    if rim:
        # A pale rolled edge: a tube along the cut where it meets the dome.
        pts, nors = [], []
        for phi in np.linspace(0, 2 * np.pi, rim_loop, endpoint=False):
            lo_r, hi_r = 0.0, 0.6
            for _ in range(30):
                m = (lo_r + hi_r) / 2
                x, z = c[0] + m * np.sin(phi), c[2] + m * np.cos(phi)
                y = cut + tilt * (z - c[2])
                inside = dome(np.array([[x, y, z]]))[0] < 0
                lo_r, hi_r = (m, hi_r) if inside else (lo_r, m)
            m = (lo_r + hi_r) / 2
            p = np.array([c[0] + m * np.sin(phi), cut + tilt * (m * np.cos(phi)), c[2] + m * np.cos(phi)])
            n = S.normals(dome, p[None, :])[0]
            pts.append(p + n * 0.002)
            nors.append(n)
        v, nn, fc = S.tube(np.array(pts), 0.0115, 5, loop=True)
        part.mesh(v, nn, fc, "trim", WHITE)
    if stripe:
        sl = lambda P: np.maximum(np.abs(P[:, 0]) - 0.032, -(P[:, 1] - (c[1] + 0.03)))
        part.solid(patch(shell, sl, 0.006, 0.008), lo, hi, h=0.006, tris=t(110), mat="trim", albedo=WHITE, ao=0.0, reach=0.05)
    return part


# ------------------------------------------------------------------- face


def _aim(n):
    """The yaw and pitch (degrees) that turn +z to point along n."""
    n = np.asarray(n, float)
    n = n / np.linalg.norm(n)
    return float(np.degrees(np.arctan2(n[0], n[2]))), float(np.degrees(-np.arcsin(n[1])))


# The eyes are drawn a little bigger than each species asks, and the game's eyelids (face.ts EYE_GROW) follow.
EYE_GROW = 1.14


def eye(part, c, r=0.045, iris="#7a4a22", aim=(0.0, 0.0, 1.0), squash=(1.0, 1.2, 0.8), sparkle=True, ring=True):
    """A big glossy bead of an eye with a coloured ring round the pupil and two glints. `c` is its centre, `aim` where it looks."""
    yaw, pitch = _aim(aim)
    r = r * EYE_GROW
    rv = np.array(squash) * r
    rings = [0.0, 0.26, 0.52, 0.82, 1.14, 1.46, 1.75]
    ic = lin(iris) if isinstance(iris, str) else np.asarray(iris)
    cols = [INK, INK, ic * 0.95 if ring else INK, ic * 0.55 if ring else INK, INK, INK, INK]
    v, n, f, th = S.polar_ball(c, rv, rings, 10, rot=(yaw, pitch, 0.0))
    ringcol = np.array([cols[rings.index(t)] for t in th])
    part.mesh(v, n, f, "gloss", ringcol)
    if sparkle:
        R = S.euler(yaw, pitch, 0.0)
        for d, size in (((-0.36, 0.46, 0.80), 0.40), ((0.38, -0.46, 0.80), 0.19)):
            d = np.asarray(d) / np.linalg.norm(d)
            at = np.asarray(c) + R @ (d * rv * 1.0)
            hv, hn, hf, _ = S.polar_ball(at, (r * size, r * size * 1.05, r * size * 0.5), [0.0, 0.7, 1.4], 8, rot=(yaw, pitch, 0.0))
            part.mesh(hv, hn, hf, "lamp", np.array([1.0, 1.0, 1.0]))


def eyes(part, x, y, z, turn=0.22, **kw):
    """Two eyes at (+-x, y, z), each turned `turn` outward."""
    for sx in (-1, 1):
        eye(part, (sx * x, y, z), aim=(sx * turn, 0.0, 1.0), **kw)


def smile(part, f, half=0.1, y=-0.1, depth=0.03, r=0.0062, colour=INK, lift=-0.003, curl=0.0, n=9, mat="cloth"):
    """Not drawn here any more: the game draws every mouth live (src/kart/render/drivers/expression.ts), so it can change."""
    return
    xs = np.linspace(-half, half, n)
    ys = y - depth * (1 - (xs / half) ** 2) + curl * (xs / half) ** 4
    pts = S.surface_point(f, xs, ys)
    pts = pts + S.normals(f, pts) * lift
    rad = r * (0.55 + 0.45 * np.sin(np.linspace(0.0, np.pi, n)))
    v, nn, fc = S.tube(pts, rad, 6)
    part.mesh(v, nn, fc, mat, colour)


def brow(part, f, x, y, length=0.08, slant=0.35, arch=0.012, r=0.0085, colour=INK, lift=-0.002, n=7, mat="cloth"):
    """Not drawn here any more: the game draws every brow live (src/kart/render/drivers/expression.ts), so it can move."""
    return
    sx = 1.0 if x >= 0 else -1.0
    t = np.linspace(-1, 1, n)
    px = x + t * length * 0.5 * sx
    py = y + t * length * 0.5 * slant + arch * (1 - t * t)
    pts = S.surface_point(f, px, py)
    pts = pts + S.normals(f, pts) * lift
    rad = r * (0.5 + 0.5 * np.sin(np.linspace(0.15, np.pi - 0.15, n)))
    v, nn, fc = S.tube(pts, rad, 5)
    part.mesh(v, nn, fc, mat, colour)


def whiskers(part, f, x, y, length=0.17, count=3, spread=0.03, colour=WHITE, r=0.0032, droop=0.25):
    for sx in (-1, 1):
        for i in range(count):
            dy = (i - (count - 1) / 2) * spread
            base = S.surface_point(f, np.array([sx * x]), np.array([y + dy * 0.4]))[0] - np.array([0.0, 0.0, 0.012])
            ang = (i - (count - 1) / 2) * 0.28
            tip = base + np.array([sx * length * np.cos(ang), -length * droop * 0.4 + dy * 1.6, length * 0.35])
            mid = (base + tip) / 2 + np.array([0.0, 0.012, 0.01])
            v, nn, fc = S.tube(np.array([base, mid, tip]), [r * 1.2, r, r * 0.4], 4)
            part.mesh(v, nn, fc, "cloth", colour)


def blush(part, face, x, y, rx=0.045, ry=0.032, colour=PINK, out=0.006):
    """A rosy patch on the cheek at (x, y): a flat disc laid on the face shape, mirrored."""
    for sx in (-1, 1):
        p = S.surface_point(face, np.array([sx * x]), np.array([y]))[0]
        n = S.normals(face, p[None, :])[0]
        yaw, pitch = _aim(n)
        disc = S.ellipsoid(p - n * 0.004, (rx, ry, 0.011 + out * 0.5), rot=(yaw, pitch, 0.0))
        c = p
        part.solid(disc, tuple(c - 0.08), tuple(c + 0.08), h=0.0045, tris=44, albedo=np.asarray(colour), mat="fur", ao=0.15, reach=0.03, symmetric=False)
