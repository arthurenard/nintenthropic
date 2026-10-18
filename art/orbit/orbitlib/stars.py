"""The sky behind the planet: stars and a faint Milky Way, as an equirect.

Mapping (three.js's own, EquirectangularReflectionMapping, in the game's
Y-up world): u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 with row 0
at the top (+Y). The player looks along -Z, which is u = 0.25: the band of
the Milky Way is laid so that its bright core rises over the planet's limb
a little left of the centre of the view, and the band arcs up and across
the space above it.

Stars follow a magnitude law (a hundred bright ones, tens of thousands of
faint), crowd toward the galactic plane, and take blackbody colours
(mostly white, some orange, a few blue). The Milky Way is a diffuse band
with a bulge, star clouds, and dark dust lanes down its middle; two small
satellite galaxies sit off the band. Linear light, scaled so the brightest
stars saturate and the band stays faint: it only shows when the sun is
behind the planet.
"""

import math

import numpy as np

from . import noise as N

F32 = np.float32
SEED = 1968


def dirs(W, H):
    u = (np.arange(W, dtype=F32) + 0.5) / W
    v = (np.arange(H, dtype=F32) + 0.5) / H
    lon = (u - 0.5) * 2 * math.pi
    lat = (0.5 - v) * math.pi
    cl = np.cos(lat)[:, None]
    D = np.empty((H, W, 3), F32)
    D[..., 0] = cl * np.cos(lon)[None, :]
    D[..., 1] = np.sin(lat)[:, None]
    D[..., 2] = cl * np.sin(lon)[None, :]
    return D


def to_uv(D):
    u = np.arctan2(D[..., 2], D[..., 0]) / (2 * math.pi) + 0.5
    v = 0.5 - np.arcsin(np.clip(D[..., 1], -1, 1)) / math.pi
    return u, v


def from_elev_az(elev_deg, az_deg):
    """A direction in the game's frame from elevation above the horizontal
    and azimuth from the view direction (-Z), positive to the right (+X)."""
    e, a = math.radians(elev_deg), math.radians(az_deg)
    return np.array([math.cos(e) * math.sin(a), math.sin(e), -math.cos(e) * math.cos(a)], F32)


def blackbody(T):
    """Approximate sRGB-ish linear colour of a blackbody (normalised)."""
    t = T / 100.0
    r = np.where(t <= 66, 255.0, 329.7 * np.power(np.maximum(t - 60, 1e-3), -0.1332))
    g = np.where(t <= 66, 99.47 * np.log(np.maximum(t, 1e-3)) - 161.1, 288.1 * np.power(np.maximum(t - 60, 1e-3), -0.0755))
    b = np.where(t >= 66, 255.0, np.where(t <= 19, 0.0, 138.5 * np.log(np.maximum(t - 10, 1e-3)) - 305.0))
    c = np.clip(np.stack([r, g, b], -1) / 255.0, 0, 1)
    c = c ** 2.2
    return c / np.maximum(c.max(-1, keepdims=True), 1e-6)


def generate(W=4096, H=2048, seed=SEED, log=print):
    rng = np.random.default_rng(seed)
    D = dirs(W, H)
    # galactic frame: the core above the limb, left of centre; the band
    # rising steeply to the upper right
    core = from_elev_az(14.0, -22.0)
    along = from_elev_az(62.0, 40.0)
    along = along - core * (along @ core)
    along /= np.linalg.norm(along)
    pole = np.cross(core, along)
    gl = np.arctan2(D @ along, D @ core)            # galactic longitude
    gb = np.arcsin(np.clip(D @ pole, -1, 1))        # galactic latitude
    f = N.Field(seed, 12)
    # ---- the band ----
    bdeg = np.degrees(gb)
    ldeg = np.degrees(gl)
    thick = 6.5 + 3.0 * np.exp(-(ldeg / 25) ** 2)
    band = np.exp(-(bdeg / thick) ** 2) * (0.35 + 0.65 * np.exp(-(ldeg / 70) ** 2))
    bulge = np.exp(-((ldeg / 11) ** 2 + (bdeg / 8) ** 2)) * 1.4
    clouds = 0.55 + 0.9 * np.clip(f.fbm(D, 5.0, 7) + 0.3, 0, 1.5)
    dust_n = f.ridged(D, 3.5, 6, sharp=2.5, first=8)
    lane = np.exp(-((bdeg + 1.2 * np.sin(np.radians(ldeg) * 3)) / 2.2) ** 2) * N.smoothstep(0.35, 0.8, dust_n + 0.2)
    dust = 1 - 0.85 * np.clip(lane * (0.7 + 0.6 * f.fbm(D, 12.0, 5, first=3)) + 0.4 * N.smoothstep(0.6, 0.9, dust_n) * band, 0, 1)
    glow = (band * clouds + bulge) * dust
    warm = np.array([1.0, 0.86, 0.68], F32)
    cool = np.array([0.78, 0.86, 1.0], F32)
    col = warm * np.clip(bulge / 1.4 + 0.3, 0, 1)[..., None] + cool * (1 - np.clip(bulge / 1.4 + 0.3, 0, 1))[..., None]
    img = glow[..., None] * col * F32(0.018)
    # two little satellite galaxies
    for (e, a, r) in ((-8.0, 125.0, 3.0), (-18.0, 138.0, 1.7)):
        c = from_elev_az(e, a)
        ang = np.degrees(np.arccos(np.clip(D @ c, -1, 1)))
        img += (np.exp(-(ang / r) ** 2) * (0.5 + 0.5 * f.fbm(D, 30.0, 4, first=11)))[..., None] * cool * F32(0.012)
    # unresolved star haze in the band: fine speckle
    speck = np.clip(f.fbm(D, 400.0, 2, first=20), 0, 1) ** 3
    img += (speck * band * dust)[..., None] * F32(0.02)
    log("  milky way done")
    # ---- stars ----
    n = 42000
    m = 1.0 + 7.8 * rng.random(n) ** 0.42           # faint stars far outnumber bright ones
    # place: uniform, plus a share crowded toward the plane
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    k = rng.random(n) < 0.45
    lg = rng.uniform(-math.pi, math.pi, k.sum())
    bg = np.radians(rng.normal(0, 7, k.sum()))
    v[k] = (np.cos(bg)[:, None] * (np.cos(lg)[:, None] * core + np.sin(lg)[:, None] * along) + np.sin(bg)[:, None] * pole)
    T = np.exp(rng.normal(math.log(5600), 0.32, n))
    T = np.where(rng.random(n) < 0.06, rng.uniform(9000, 25000, n), T)
    c = blackbody(T) * 0.55 + 0.45            # stars look nearly white to the eye
    flux = 10 ** (-0.4 * (m - 1.0)) * 0.9
    u, vv = to_uv(v)
    x = u * W - 0.5
    y = vv * H - 0.5
    stars = np.zeros((H, W, 3), F32)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0
    val = flux[:, None] * c
    for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        yy = np.clip(y0 + dy, 0, H - 1)
        xx = (x0 + dx) % W
        for ch in range(3):
            np.add.at(stars[..., ch], (yy, xx), (val[:, ch] * w).astype(F32))
    # a soft point-spread so bright stars read as round, not as pixels
    halo = N.blur(stars, 1, 2)
    img = img + stars * 0.8 + halo * 0.9
    log(f"  {n} stars")
    meta = dict(core_dir=[float(x) for x in core], mapping="three.js equirect: u=atan2(z,x)/2pi+0.5, v=asin(y)/pi+0.5, row 0 = +Y")
    return np.clip(img, 0, None).astype(F32), meta
