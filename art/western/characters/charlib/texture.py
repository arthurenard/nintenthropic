"""Painting in numpy: colour helpers, value noise and fBm, and the skin's paint.

The large-scale look of a face or a garment - where the skin reddens, where the
stubble is, the line a hat leaves on a sun-browned forehead, dust gathering
toward the hem - is a function of points on the sculpt, which the atlas bake
(abake.py) evaluates at every texel. Fine relief (skin grain, wrinkles) is a
displacement of the sculpt's field instead (head.skin_detail), so the normal
map carries it.
"""
import numpy as np


def srgb(*c):
    """sRGB 0..1 (as picked by eye) -> linear, the space vertex colours and bakes use."""
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    h = h & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFFFF).astype(np.float64) / float(0xFFFFFF)


def value_noise(P, scale, seed=0):
    """Smooth 3D value noise in [0, 1]."""
    q = np.asarray(P, np.float64) * scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    u = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out = out + wx * wy * wz * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(P, scale, octaves=4, seed=0, gain=0.5):
    tot, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        tot = tot + amp * value_noise(P, scale * (2.0 ** o), seed + 17 * o)
        norm += amp
        amp *= gain
    return tot / norm


def spots(P, scale, density, seed=0):
    """Sparse blotches (freckles, moles, stains): 1 inside a spot, 0 elsewhere."""
    n = value_noise(P, scale, seed)
    return smoothstep(1 - density, 1 - density * 0.4, n)


# ------------------------------------------------------------------ heads

SKIN = {
    "tanned": srgb(0.66, 0.49, 0.39),
    "weathered": srgb(0.60, 0.44, 0.35),
    "fair": srgb(0.78, 0.62, 0.53),
    "pale": srgb(0.80, 0.68, 0.62),
    "olive": srgb(0.62, 0.48, 0.36),
    "ruddy": srgb(0.72, 0.52, 0.44),
}
HAIR = {
    "black": srgb(0.10, 0.09, 0.08),
    "dark": srgb(0.18, 0.13, 0.10),
    "brown": srgb(0.30, 0.21, 0.14),
    "auburn": srgb(0.38, 0.21, 0.12),
    "sandy": srgb(0.52, 0.41, 0.28),
    "grey": srgb(0.50, 0.48, 0.46),
    "white": srgb(0.76, 0.74, 0.71),
    "salt": srgb(0.36, 0.34, 0.32),
}
IRIS = {
    "brown": srgb(0.28, 0.16, 0.08),
    "hazel": srgb(0.36, 0.28, 0.14),
    "blue": srgb(0.32, 0.44, 0.52),
    "grey": srgb(0.40, 0.43, 0.44),
    "green": srgb(0.30, 0.36, 0.22),
}


def head_paint(V, p, look, is_ear=False):
    """Colour (linear RGB) and roughness for every high-poly head vertex.

    V is in head-local coordinates. `look` holds skin, hair, iris names plus
    optional extras: hatline (a pale band where the hat sits), scar, grime.
    """
    from . import head as H
    n = len(V)
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    ax = np.abs(x)
    skin = SKIN[look.get("skin", "tanned")]
    col = np.tile(skin, (n, 1))
    rough = np.full(n, 0.60)
    # mottling: broad blotches of redder and sallower skin
    m1 = fbm(V, 60, 4, seed=3)
    m2 = fbm(V, 220, 3, seed=5)
    col *= (0.90 + 0.20 * m1)[:, None]
    red = srgb(0.62, 0.30, 0.25)
    # flush on cheeks, nose, ears and lips; sun on the nose ridge and forehead
    cheek = np.exp(-(((ax - 0.040) / 0.018) ** 2 + ((y + 0.072) / 0.02) ** 2 + ((z + 0.020) / 0.02) ** 2))
    nose = np.exp(-((ax / 0.013) ** 2 + ((z + 0.020) / 0.016) ** 2)) * smoothstep(-0.098, -0.112, y)
    ears = np.full(n, 0.6) if is_ear else np.zeros(n)   # ears are thin and flush red against the light
    flush = np.clip(0.55 * cheek + 0.55 * nose + 0.5 * ears, 0, 1) * (0.6 + 0.6 * m2) * look.get("flush", 1.0)
    col = col * (1 - 0.35 * flush[:, None]) + red * (0.35 * flush[:, None])
    # a paler forehead where the hat brim shades it every day
    if look.get("hatline", True):
        band = smoothstep(0.030, 0.050, z) * smoothstep(-0.02, -0.07, y)
        col = col * (1 - 0.25 * band[:, None]) + srgb(0.80, 0.63, 0.53) * 0.25 * band[:, None] * (1.0 - 0.2 * m2[:, None])
    # darker, sallow sockets and eyelids
    eL, eR = H._eyes(p)
    for e in (eL, eR):
        d = np.linalg.norm(V - e, axis=1)
        sock = np.exp(-((d - 0.016) / 0.007) ** 2) * smoothstep(-0.060, -0.080, y)
        col *= (1 - 0.18 * sock)[:, None]
        col = col * (1 - 0.1 * sock[:, None]) + srgb(0.45, 0.28, 0.28) * 0.1 * sock[:, None]
    # lips: a slightly darker, redder vermilion with a soft edge
    lipd = np.exp(-((ax / 0.022) ** 2 + ((z + 0.0655) / 0.0085) ** 2)) * smoothstep(-0.088, -0.097, y)
    lipm = smoothstep(0.35, 0.8, lipd)
    col = col * (1 - 0.45 * lipm[:, None]) + srgb(0.55, 0.30, 0.27) * 0.45 * lipm[:, None]
    rough = rough - 0.12 * lipm
    # nostrils and the mouth line read as shadow even in flat light
    for s in (1, -1):
        nos = np.exp(-(((x - s * 0.0072) / 0.0045) ** 2 + ((z + 0.0425) / 0.003) ** 2)) * smoothstep(-0.098, -0.104, y)
        col *= (1 - 0.75 * np.clip(nos, 0, 1))[:, None]
    mline = np.exp(-(((z + 0.0656) / 0.0009) ** 2)) * (1 - smoothstep(0.018, 0.024, ax)) * smoothstep(-0.090, -0.098, y)
    col *= (1 - 0.55 * np.clip(mline, 0, 1))[:, None]
    # stubble / beard: blue-grey shadow of shaved growth, dotted
    beard = H.beard_field(V, p)
    stub = look.get("stubble", 0.5) + p["beard"]
    dots = value_noise(V, 2600, seed=11)
    hair_c = HAIR[look.get("hair", "dark")]
    beard_c = HAIR[look.get("beard_color", look.get("hair", "dark"))]
    sm = np.clip(beard * stub, 0, 1)
    shade = (0.55 + 0.45 * smoothstep(0.3, 0.8, dots)) * sm
    stub_c = beard_c * 0.7 + srgb(0.30, 0.30, 0.33) * 0.3
    col = col * (1 - 0.42 * shade[:, None]) + stub_c * 0.42 * shade[:, None]
    # hair on the scalp: strands flowing back from the hairline
    ht = H.hair_thickness(V, p)
    hmask = np.maximum(smoothstep(0.0003, 0.0022, ht), 0.9 * H.sideburn_mask(V, p) * (0.6 + 0.4 * value_noise(V, 1800, seed=27)))
    hmask = np.maximum(hmask, H.bun_mask(V, p))
    az = np.degrees(np.arctan2(x, -(y - 0.005)))
    strand = value_noise(np.stack([az * 0.25, z * 12, y * 4], 1), 1.0, seed=21)
    strand2 = value_noise(np.stack([az * 1.2, z * 40, y * 10], 1), 1.0, seed=23)
    hc = hair_c * (0.65 + 0.35 * strand[:, None] + 0.25 * (strand2[:, None] - 0.5))
    if look.get("grey", 0) > 0:
        g = smoothstep(0.55 - 0.5 * look["grey"], 0.9 - 0.5 * look["grey"], fbm(V, 400, 2, seed=31))
        hc = hc * (1 - g[:, None]) + HAIR["white"] * g[:, None] * (0.8 + 0.2 * strand2[:, None])
    # the scalp shows through at a thin hairline
    col = col * (1 - hmask[:, None]) + hc * hmask[:, None]
    rough = rough * (1 - hmask) + 0.62 * hmask
    # eyebrows, moustache
    fine = value_noise(np.stack([x * 900, z * 2500, y * 900], 1), 1.0, seed=29)
    bm = smoothstep(0.1, 0.7, H.brow_field(V, p)) * (0.45 + 0.55 * fine)
    col = col * (1 - 0.85 * bm[:, None]) + hair_c * 0.85 * bm[:, None]
    mm = smoothstep(0.05, 0.5, H.moustache_field(V, p)) * (0.75 + 0.25 * fine)
    mcol = HAIR[look.get("moustache_color", look.get("beard_color", look.get("hair", "dark")))]
    mstr = value_noise(np.stack([x * 1400, z * 350, y * 600], 1), 1.0, seed=33)
    col = col * (1 - mm[:, None]) + mcol * (0.75 + 0.5 * mstr[:, None]) * mm[:, None]
    rough = rough * (1 - mm) + 0.6 * mm
    # eyes: sclera, iris with a dark limbal ring, pupil; wet and glossy
    iris_c = IRIS[look.get("iris", "brown")]
    for e in (eL, eR):
        q = V - e
        d = np.linalg.norm(q, axis=1)
        on = smoothstep(0.0129, 0.01235, d) * smoothstep(-0.002, -0.006, q[:, 1])
        fwd = np.array([0.08 * np.sign(e[0]), -1.0, 0.0])
        fwd /= np.linalg.norm(fwd)
        ang = np.degrees(np.arccos(np.clip((q @ fwd) / np.maximum(d, 1e-6), -1, 1)))
        sclera = srgb(0.78, 0.74, 0.68) * (1 - 0.12 * smoothstep(20, 50, ang))[:, None]
        sclera = sclera * (1 - 0.15 * smoothstep(35, 60, ang)[:, None]) + srgb(0.6, 0.35, 0.33) * 0.1 * smoothstep(35, 60, ang)[:, None]
        radial = value_noise(np.stack([np.arctan2(q[:, 0], q[:, 2]) * 8, ang * 0.3, ang * 0.0], 1), 1.0, seed=41)
        ic = iris_c * (0.7 + 0.6 * radial[:, None])
        ic = ic * (1 - 0.6 * smoothstep(21, 26, ang)[:, None])     # limbal ring
        ec = sclera * smoothstep(24, 27, ang)[:, None] + ic * (1 - smoothstep(24, 27, ang))[:, None]
        ec = ec * (1 - smoothstep(9.5, 8, ang))[:, None] + srgb(0.02, 0.02, 0.02) * smoothstep(9.5, 8, ang)[:, None]
        col = col * (1 - on[:, None]) + ec * on[:, None]
        rough = rough * (1 - on) + 0.08 * on
    # a scar: a pale, glossy, slightly pink seam of tissue
    if look.get("scar"):
        a, b, w = look["scar"]
        a, b = np.asarray(a), np.asarray(b)
        ab = b - a
        t = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
        dist = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
        sc = smoothstep(w, w * 0.3, dist) * (0.8 + 0.2 * m2)
        col = col * (1 - 0.6 * sc[:, None]) + srgb(0.78, 0.55, 0.50) * 0.6 * sc[:, None]
        edge = smoothstep(w * 1.8, w, dist) * (1 - sc)
        col *= (1 - 0.15 * edge)[:, None]
        rough -= 0.15 * sc
    # grime in the creases and a film of dust
    grime = look.get("grime", 0.3)
    col *= (1 - grime * 0.25 * smoothstep(0.55, 0.8, fbm(V, 90, 3, seed=51)))[:, None]
    col = np.clip(col, 0, 1)
    return col.astype(np.float32), np.clip(rough, 0.05, 1).astype(np.float32)


def scar_displacement(V, look):
    """The scar as a slight ridge with a sunken line down its middle."""
    if not look.get("scar"):
        return np.zeros(len(V))
    a, b, w = look["scar"]
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    t = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
    dist = np.linalg.norm(V - (a + t[:, None] * ab), axis=1)
    ends = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.85, t)
    return (0.0006 * np.exp(-(dist / (w * 0.9)) ** 2) - 0.0005 * np.exp(-(dist / (w * 0.3)) ** 2)) * ends
