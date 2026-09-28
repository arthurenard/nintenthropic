"""A small numpy renderer for the planet, seen from orbit.

It draws exactly what the game's runtime shader is meant to draw from the
delivered maps (see README, "Rendering the planet"), so the review renders
judge the maps as the player will see them:

- the ground: albedo lit by the sun through the atmosphere (a Lambert term
  with the height map's relief), skylight, cloud shadows, and on the night
  side the city lights;
- the ocean's sun glint: GGX with a wind-roughened surface (water mask);
- the cloud deck: a thin layer 6 km up, its opacity from the clouds map
  sharpened by the detail texture, shaded with a relief normal taken from
  its own gradient (so cumulus tops and storm towers catch a low sun);
- the atmosphere: single-scattered Rayleigh + Mie light with ozone
  absorption, integrated along every eye ray through an exponential shell,
  sun light attenuated through a precomputed transmittance table, plus a
  cheap multiple-scattering term. That is what makes the blue limb, the
  haze toward the horizon and the orange band at the terminator.

Units: kilometres. Everything happens in the planet frame (map axes: +Z
north, longitude 0 on +X); callers pass the eye and view rays in it.
Output is scene-linear radiance (sun irradiance = SUN_E); the caller tone
maps it (Blender's AgX, like every other picture of the build).
"""

import math

import numpy as np

from . import noise as N

F32 = np.float32

R = 6371.0
ATM = 100.0                  # atmosphere shell thickness (km)
H_R = 8.0                    # Rayleigh scale height (km)
H_M = 1.2                    # Mie scale height (km)
BETA_R = np.array([5.802e-3, 13.558e-3, 33.1e-3], F32)     # per km at sea level
BETA_M_S = F32(3.996e-3)
BETA_M_E = F32(4.40e-3)
BETA_O = np.array([0.650e-3, 1.881e-3, 0.085e-3], F32)
G_MIE = 0.8
CLOUD_H = 6.0                # cloud layer altitude (km)
AIRGLOW_H = 95.0             # km
AIRGLOW_SIGMA = 5.0          # km: the layer's half-thickness
AIRGLOW_COLOR = np.array([0.30, 1.0, 0.42], F32) * F32(2.0e-5)
CLOUD_RELIEF = 10.0          # exaggerated cloud-top relief (km) for the shading normal
SUN_E = F32(20.0)            # sun irradiance at the top of the atmosphere
SUN_COLOR = np.array([1.0, 0.985, 0.96], F32)
SUN_RADIUS = math.radians(0.268)


def srgb_to_lin(a):
    a = a.astype(F32)
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).astype(F32)


class Maps:
    """The delivered maps as float arrays, linear where they are colour."""

    def __init__(self, albedo, clouds, night, water, height=None, detail=None, stars=None):
        self.albedo = albedo.astype(F32)
        self.clouds = clouds.astype(F32)
        self.night = night.astype(F32)
        self.water = water.astype(F32)
        self.height = None if height is None else height.astype(F32)
        self.detail = detail
        self.det_r = None if detail is None else np.ascontiguousarray(detail[..., 0])
        self.det_g = None if detail is None else np.ascontiguousarray(detail[..., 1])
        self.det_b = None if detail is None else np.ascontiguousarray(detail[..., 2])
        self.stars = stars

    @classmethod
    def from_planet(cls, p, stars=None):
        return cls(p.albedo, p.clouds, p.night, p.water, p.height, p.detail_rgb, stars)


# ---------------------------------------------------------------------------
# Atmosphere tables

def densities(h):
    hr = np.exp(-np.maximum(h, 0) / H_R).astype(F32)
    hm = np.exp(-np.maximum(h, 0) / H_M).astype(F32)
    ho = np.maximum(0, 1 - np.abs(h - 25.0) / 15.0).astype(F32)
    return hr, hm, ho


def extinction(h):
    hr, hm, ho = densities(h)
    return BETA_R * hr[..., None] + BETA_M_E * hm[..., None] + BETA_O * ho[..., None]


class TransmittanceLUT:
    """T(h, mu): transmittance from height h toward a direction with cosine
    mu (to the zenith) out to space; zero if the ray meets the ground."""

    def __init__(self, nh=96, nmu=512, steps=96):
        self.nh, self.nmu = nh, nmu
        # heights spaced finer near the ground
        u = np.linspace(0, 1, nh, dtype=F32)
        self.h = (u ** 2) * ATM
        self.mu = np.linspace(-1, 1, nmu, dtype=F32)
        Hh, Mu = np.meshgrid(self.h, self.mu, indexing='ij')
        r = R + Hh
        # distance to the top of the atmosphere along mu
        b = r * Mu
        c = r * r - (R + ATM) ** 2
        t_top = -b + np.sqrt(np.maximum(b * b - c, 0))
        cg = r * r - R * R
        dg = b * b - cg
        hits = (dg > 0) & (-b - np.sqrt(np.maximum(dg, 0)) > 0)
        tau = np.zeros(Hh.shape + (3,), F32)
        for i in range(steps):
            t = t_top * (i + 0.5) / steps
            x2 = r * r + t * t + 2 * r * t * Mu
            hh = np.sqrt(np.maximum(x2, 0)) - R
            tau += extinction(hh) * (t_top / steps)[..., None]
        T = np.exp(-tau)
        T[hits] = 0
        self.T = T.astype(F32)

    def __call__(self, h, mu):
        u = np.sqrt(np.clip(h / ATM, 0, 1)) * (self.nh - 1)
        v = (np.clip(mu, -1, 1) + 1) * 0.5 * (self.nmu - 1)
        u0 = np.clip(np.floor(u).astype(np.int64), 0, self.nh - 2)
        v0 = np.clip(np.floor(v).astype(np.int64), 0, self.nmu - 2)
        fu = (u - u0).astype(F32)[..., None]
        fv = (v - v0).astype(F32)[..., None]
        T = self.T
        a = T[u0, v0] * (1 - fv) + T[u0, v0 + 1] * fv
        b = T[u0 + 1, v0] * (1 - fv) + T[u0 + 1, v0 + 1] * fv
        return a * (1 - fu) + b * fu


_LUT = None


def lut():
    global _LUT
    if _LUT is None:
        _LUT = TransmittanceLUT()
    return _LUT


def phase_r(c):
    return F32(3.0 / (16 * math.pi)) * (1 + c * c)


def phase_m(c, g=G_MIE):
    g2 = g * g
    return F32(3.0 / (8 * math.pi)) * ((1 - g2) * (1 + c * c)) / ((2 + g2) * np.power(1 + g2 - 2 * g * c, 1.5))


# ---------------------------------------------------------------------------
# Map lookups

def uv_of(x):
    """Planet-frame points -> equirect uv."""
    n = x / np.linalg.norm(x, axis=-1, keepdims=True)
    return N.dir_to_uv(n)


def detail_at(maps, u, v, lat, scale=1.0):
    """The tileable detail texture sampled at two scales, with the
    longitude repeat widened by 1/cos(lat) so texels stay square."""
    d = maps.detail
    if d is None:
        return None
    H, W = d.shape[:2]
    cl = np.maximum(np.cos(lat), 0.2)
    out = 0
    for rep, w in ((48 * scale, 0.6), (192 * scale, 0.4)):
        uu = (u * rep * 2 * cl) % 1.0      # lon repeat twice the lat one (360 vs 180 degrees)
        vv = (v * rep) % 1.0
        out = out + w * N.sample(d, uu, vv) if isinstance(out, np.ndarray) else w * N.sample(d, uu, vv)
    return out


DETAIL_REP = (48.0, 192.0)        # tiles per unit of v (and twice that in u)
DETAIL_TEXELS_KM = math.pi * R / (DETAIL_REP[0] * 1024)
CLOUDLET_H = 2.2                   # km: the relief of a cloudlet at full cover (exaggerated)


def detail_uv(u, v, lat, rep):
    cl = np.maximum(np.cos(lat), 0.2)
    return (u * rep * 2 * cl) % 1.0, (v * rep) % 1.0


def cloud_cover(maps, u, v, lat, use_detail=True, with_d=False):
    """The cloud layer's opacity at (u, v): the map's cover, broken into
    cloudlets by the detail texture (two scales plus the fibrous channel).
    with_d also returns the detail value (for the cloud-top relief)."""
    a = N.sample(maps.clouds, u, v)
    if not use_detail or maps.detail is None:
        return (a, np.full_like(a, 0.5)) if with_d else a
    u1, v1 = detail_uv(u, v, lat, DETAIL_REP[0])
    u2, v2 = detail_uv(u, v, lat, DETAIL_REP[1])
    d1 = N.sample(maps.det_r, u1, v1)
    d2 = N.sample(maps.det_r, u2, v2)
    fb = N.sample(maps.det_b, u1, v1)
    d = np.clip(0.75 * d1 + 0.25 * fb + (d2 - 0.5) * 0.35, 0, 1)
    s = sharpen_clouds(a, d)
    return (s, d) if with_d else s


def sharpen_clouds(alpha, d, soft=0.14):
    """Sub-pixel cloud structure. The map's opacity is read as coverage:
    keep the detail texture's values above 1 - coverage, with a soft edge.
    Partial cover becomes distinct, crisp cloudlets in the right amount;
    overcast stays overcast and clear stays clear."""
    if d is None:
        return alpha
    lo = 1.0 - alpha - soft
    t = np.clip((d - lo) / (2 * soft), 0, 1)
    a = t * t * (3 - 2 * t)
    return np.clip(np.maximum(a * np.minimum(alpha * 1.25, 1.0) ** 0.7, alpha * 0.08), 0, 1).astype(F32)


# ---------------------------------------------------------------------------
# The renderer

class Settings:
    samples = 48
    exposure = 1.0
    night_gain = 0.6
    star_gain = 1.0
    ocean_rough = 0.13
    clouds_on = True
    detail = True
    sun_disc = True
    multi = 0.55             # multiple-scattering strength
    airglow = 1.0            # the green oxygen airglow at ~95 km (night limb)


def render_rays(O, D, sun, maps, st=None, chunk=65536):
    """O: (3,) eye in the planet frame (km). D: (N, 3) unit view rays.
    sun: (3,) unit vector toward the sun. Returns (N, 3) radiance and an
    (N,) coverage (1 on the planet, the atmosphere's glow fraction off it)."""
    st = st or Settings()
    out = np.zeros((D.shape[0], 3), F32)
    cov = np.zeros(D.shape[0], F32)
    for a in range(0, D.shape[0], chunk):
        o, c = _render_chunk(np.asarray(O, F32), D[a:a + chunk].astype(F32), np.asarray(sun, F32), maps, st)
        out[a:a + chunk] = o
        cov[a:a + chunk] = c
    return out, cov


def _sphere(O, D, r):
    b = D @ O
    c = F32(O @ O - r * r)
    disc = b * b - c
    s = np.sqrt(np.maximum(disc, 0))
    return disc > 0, -b - s, -b + s


def _render_chunk(O, D, sun, maps, st):
    n = D.shape[0]
    T = lut()
    hit_a, ta0, ta1 = _sphere(O, D, R + ATM)
    hit_a &= ta1 > 0
    ta0 = np.maximum(ta0, 0)
    hit_g, tg, _ = _sphere(O, D, R)
    hit_g &= tg > 0
    t_end = np.where(hit_g, tg, ta1)
    seg = np.where(hit_a, np.maximum(t_end - ta0, 0), 0).astype(F32)
    cos_t = D @ sun
    pr = phase_r(cos_t)[:, None]
    pm = phase_m(cos_t)[:, None]
    L_in = np.zeros((n, 3), F32)
    tau = np.zeros((n, 3), F32)
    S = st.samples
    ds = (seg / S)[:, None]
    # sample positions biased toward the end of the path (where the air is
    # densest for ground-hitting rays) by a mild power curve
    for i in range(S):
        f0 = (i / S)
        f1 = ((i + 1) / S)
        fm = (i + 0.5) / S
        t = ta0 + seg * fm
        x = O + D * t[:, None]
        r = np.linalg.norm(x, axis=1)
        h = r - R
        hr, hm, ho = densities(h)
        ext = BETA_R * hr[:, None] + BETA_M_E * hm[:, None] + BETA_O * ho[:, None]
        tau_mid = tau + ext * ds * 0.5
        mu_s = (x @ sun) / r
        Ts = T(h, mu_s)
        Tv = np.exp(-tau_mid)
        scat = BETA_R * hr[:, None] * pr + BETA_M_S * hm[:, None] * pm
        L_in += scat * Ts * Tv * ds
        # multiple scattering: an isotropic glow from the lit air around
        amb = (BETA_R * hr[:, None] + BETA_M_S * hm[:, None]) * F32(1 / (4 * math.pi))
        L_in += amb * Tv * ds * st.multi * np.clip(mu_s + 0.12, 0, 1)[:, None] * np.array([0.55, 0.75, 1.0], F32)
        tau = tau + ext * ds
    Tview = np.exp(-tau)
    L = L_in * SUN_E * SUN_COLOR
    # airglow: a thin emitting shell ~95 km up, integrated analytically at
    # the ray's two crossings (a tangent path through it is what shows)
    if st.airglow > 0:
        rg = R + AIRGLOW_H
        hitg_, t0g, t1g = _sphere(O, D, rg)
        glow = np.zeros(n, F32)
        mu_min = math.sqrt(2 * AIRGLOW_SIGMA / rg)
        for tc in (t0g, t1g):
            ok = hitg_ & (tc > 0) & (tc < t_end + 1e-3)
            xg = O + D * tc[:, None]
            mu = np.abs(np.sum(D * xg, 1)) / rg
            glow += np.where(ok, AIRGLOW_SIGMA * math.sqrt(math.pi) / np.maximum(mu, mu_min), 0.0).astype(F32)
        L += glow[:, None] * (AIRGLOW_COLOR * st.airglow)
    # ---------------- the surface ----------------
    gi = np.nonzero(hit_g)[0]
    if gi.size:
        Dg = D[gi]
        xg = O + Dg * tg[gi, None]
        ng = xg / R
        u, v = N.dir_to_uv(ng)
        lat = np.arcsin(np.clip(ng[:, 2], -1, 1))
        alb = N.sample(maps.albedo, u, v)
        wat = N.sample(maps.water, u, v)
        nig = N.sample(maps.night, u, v)
        det = detail_at(maps, u, v, lat) if (st.detail and maps.detail is not None) else None
        if det is not None:
            # terrain below the map's pixel: two scales of the detail's G
            u2, v2 = detail_uv(u, v, lat, DETAIL_REP[1])
            g2 = N.sample(maps.det_g, u2, v2)
            k_ = (0.6 + 0.8 * det[:, 1]) * (0.85 + 0.3 * g2)
            alb = alb * k_[:, None] ** (1 - wat[:, None])
        # relief normal from the height map
        nrm = ng
        if maps.height is not None:
            eps = 0.35 / maps.height.shape[1]
            hc = N.sample(maps.height, u, v)
            hu = N.sample(maps.height, u + eps, v)
            hv = N.sample(maps.height, u, v + eps)
            if det is not None:
                dd = (det[:, 1] - 0.5) * 0.02
                hc = hc + dd
            east = np.stack([-np.sin(2 * math.pi * (u - 0.5)), np.cos(2 * math.pi * (u - 0.5)), np.zeros_like(u)], 1)
            north = np.cross(ng, east)
            k = F32(9.0)        # exaggeration: 6 km of relief over a pixel of ~10 km
            dx = (hu - hc) * k * 6.0 / (eps * 2 * math.pi * R * np.maximum(np.cos(lat), 0.1))
            dy = (hv - hc) * k * 6.0 / (eps * math.pi * R)
            nrm = ng - east * dx[:, None] + north * dy[:, None]
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        mu_g = np.sum(ng * sun, 1)
        mu_n = np.sum(nrm * sun, 1)
        Tsun_g = T(np.zeros_like(mu_g), mu_g)
        # cloud shadow: the cloud above the point, offset toward the sun
        shadow = np.ones_like(mu_g)
        if st.clouds_on:
            tan_z = np.sqrt(np.maximum(1 - mu_g * mu_g, 0)) / np.maximum(mu_g, 0.05)
            sp = sun - ng * mu_g[:, None]
            spn = sp / np.maximum(np.linalg.norm(sp, axis=1, keepdims=True), 1e-6)
            xs = ng * (R + CLOUD_H) + spn * (CLOUD_H * np.minimum(tan_z, 40))[:, None]
            us, vs = uv_of(xs)
            cs = cloud_cover(maps, us, vs, lat, det is not None)
            shadow = 1 - 0.85 * cs
        direct = SUN_E * SUN_COLOR * Tsun_g * (np.maximum(mu_n, 0) * shadow)[:, None]
        sky = SUN_E * np.array([0.07, 0.10, 0.16], F32) * np.clip(mu_g + 0.15, 0, 1.15)[:, None] ** 1.5 * (0.6 + 0.4 * shadow[:, None])
        Lg = alb / F32(math.pi) * (direct + sky)
        # sun glint on water (GGX, Schlick Fresnel, Smith G)
        V = -Dg
        Hh = sun + V
        Hh /= np.maximum(np.linalg.norm(Hh, axis=1, keepdims=True), 1e-6)
        ndh = np.clip(np.sum(ng * Hh, 1), 0, 1)
        ndv = np.clip(np.sum(ng * V, 1), 1e-3, 1)
        ndl = np.clip(mu_g, 0, 1)
        a = st.ocean_rough
        if det is not None:
            a = a * (0.75 + 0.5 * det[:, 2])
        a2 = a * a
        Dggx = a2 / (math.pi * (ndh * ndh * (a2 - 1) + 1) ** 2)
        k_ = a2 / 2
        Gs = (ndv / (ndv * (1 - k_) + k_)) * (ndl / (ndl * (1 - k_) + k_))
        vdh = np.clip(np.sum(V * Hh, 1), 0, 1)
        F = 0.02 + 0.98 * (1 - vdh) ** 5
        spec = (Dggx * Gs * F / (4 * ndv * np.maximum(ndl, 1e-3)))
        spec = spec * ndl * shadow * wat
        Lg = Lg + SUN_E * SUN_COLOR * Tsun_g * spec[:, None]
        # the ocean also mirrors the sky near the horizon
        Lg = Lg + wat[:, None] * (0.02 + 0.98 * (1 - ndv) ** 5)[:, None] * SUN_E * np.array([0.02, 0.035, 0.07], F32) * np.clip(mu_g + 0.1, 0, 1)[:, None]
        # city lights in the dark
        dark = N.smoothstep(0.06, -0.08, mu_g)
        if det is not None:
            u3, v3 = detail_uv(u, v, lat, DETAIL_REP[1] * 2)
            sp = N.sample(maps.det_r, u3, v3)
            nig = nig * (0.35 + 1.7 * sp ** 2)[:, None]
        Ln = nig * (st.night_gain * dark)[:, None]
        Lsurf = Lg + Ln
        # ---------------- clouds ----------------
        if st.clouds_on:
            hc_, tc, _ = _sphere(O, Dg, R + CLOUD_H)
            tc = np.where(hc_ & (tc > 0), tc, tg[gi])
            xc = O + Dg * tc[:, None]
            nc = xc / np.linalg.norm(xc, axis=1, keepdims=True)
            uc, vc = N.dir_to_uv(nc)
            latc = np.arcsin(np.clip(nc[:, 2], -1, 1))
            use_d = det is not None
            ca = cloud_cover(maps, uc, vc, latc, use_d)
            # relief normal from the cloud field's gradient (thick = high)
            eps = 0.6 / maps.clouds.shape[1]
            cu = N.sample(maps.clouds, uc + eps, vc)
            cv = N.sample(maps.clouds, uc, vc + eps)
            east = np.stack([-np.sin(2 * math.pi * (uc - 0.5)), np.cos(2 * math.pi * (uc - 0.5)), np.zeros_like(uc)], 1)
            north = np.cross(nc, east)
            # cloud tops treated as a height field ~CLOUD_RELIEF km tall at
            # full opacity: slope = relief * d(alpha)/d(km)
            kx = CLOUD_RELIEF * (cu - N.sample(maps.clouds, uc - eps, vc)) / (2 * eps * 2 * math.pi * R * np.maximum(np.cos(latc), 0.1))
            ky = -CLOUD_RELIEF * (cv - N.sample(maps.clouds, uc, vc - eps)) / (2 * eps * math.pi * R)
            if use_d:
                # cloudlet relief: the sharpened cover as a height field at
                # the detail texture's own scale
                dv = 1.0 / (DETAIL_REP[0] * 1024)
                du = dv / (2 * np.maximum(np.cos(latc), 0.2))
                # heights: the cover itself, domed by the detail so even an
                # overcast deck has lumpy, sunlit and shadowed tops
                def hf(uu, vv):
                    a_, d_ = cloud_cover(maps, uu, vv, latc, with_d=True)
                    return CLOUDLET_H * a_ ** 1.5 * (0.45 + 0.55 * d_)
                kx = kx + (hf(uc + du, vc) - hf(uc - du, vc)) / (2 * DETAIL_TEXELS_KM)
                ky = ky - (hf(uc, vc + dv) - hf(uc, vc - dv)) / (2 * DETAIL_TEXELS_KM)
            ncl = nc - east * kx[:, None] + north * ky[:, None]
            ncl /= np.linalg.norm(ncl, axis=1, keepdims=True)
            mu_c = np.sum(nc * sun, 1)
            mu_cl = np.sum(ncl * sun, 1)
            Tsun_c = T(np.full_like(mu_c, CLOUD_H), mu_c)
            wrap = np.clip((mu_cl + 0.25) / 1.25, 0, 1) ** 1.3
            thick = 0.6 + 0.4 * ca
            Lc = F32(0.92 / math.pi) * SUN_E * SUN_COLOR * Tsun_c * (wrap * thick)[:, None]
            Lc = Lc + F32(0.92 / math.pi) * SUN_E * np.array([0.08, 0.11, 0.16], F32) * np.clip(mu_c + 0.15, 0, 1.15)[:, None]
            # forward scattering through thin cloud edges toward the sun
            fwd = phase_m(np.sum(Dg * sun, 1), 0.6) * (1 - ca) * ca * 4
            Lc = Lc + SUN_E * SUN_COLOR * Tsun_c * fwd[:, None] * 0.3
            # night: lights glow through thin cloud, lit from below a little
            Lsurf = Lsurf * (1 - ca[:, None]) + Ln * ca[:, None] * 0.12
            Lsurf = Lsurf * 1.0 + ca[:, None] * Lc
        L[gi] += Tview[gi] * Lsurf
    # ---------------- space: stars and the sun ----------------
    si = np.nonzero(~hit_g)[0]
    if si.size:
        Ds = D[si]
        Lbg = np.zeros((si.size, 3), F32)
        if maps.stars is not None:
            us, vs = N.dir_to_uv(Ds)
            Lbg += N.sample(maps.stars, us, vs) * st.star_gain
        if st.sun_disc:
            ang = np.arccos(np.clip(Ds @ sun, -1, 1))
            disc = N.smoothstep(SUN_RADIUS * 1.15, SUN_RADIUS * 0.85, ang)
            Lbg += disc[:, None] * SUN_E * 6.0e4 * SUN_COLOR
        L[si] += Tview[si] * Lbg
    cov = np.where(hit_g, 1.0, np.clip(np.max(L_in, 1) * 60, 0, 1)).astype(F32)
    return L * st.exposure, cov


# ---------------------------------------------------------------------------
# Cameras

def perspective_rays(W, H, fov_y_deg, cam_rot, shift=(0.0, 0.0)):
    """cam_rot: 3x3 whose columns are the camera's right, up and backward
    axes in the planet frame (Blender's camera convention: it looks along
    its local -Z). Returns (H*W, 3) unit rays, top row first."""
    t = math.tan(math.radians(fov_y_deg) / 2)
    ys = (1 - (np.arange(H, dtype=F32) + 0.5) / H * 2) * t
    xs = ((np.arange(W, dtype=F32) + 0.5) / W * 2 - 1) * t * W / H
    X, Y = np.meshgrid(xs + shift[0] * 2 * t * W / H, ys + shift[1] * 2 * t)
    d = np.stack([X, Y, -np.ones_like(X)], -1).reshape(-1, 3) @ np.asarray(cam_rot, F32).T
    return (d / np.linalg.norm(d, axis=1, keepdims=True)).astype(F32)


def equirect_rays(W, H, frame_from_world=None):
    """Rays for an equirect panorama in this build's convention (the same
    as the planet maps): u = atan2(y, x) / 2pi + 0.5 (u = 0.5 looks along
    +X), row 0 at the top (+Z). In Blender the world shader reads it with
    the vector (u, 1 - v) computed the same way (see pipeline.world_env).
    frame_from_world rotates world directions into the planet frame."""
    u = (np.arange(W, dtype=F32) + 0.5) / W
    v = (np.arange(H, dtype=F32) + 0.5) / H
    U, V = np.meshgrid(u, v)
    lon = (U - 0.5) * 2 * math.pi
    lat = (0.5 - V) * math.pi
    d = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1).reshape(-1, 3).astype(F32)
    if frame_from_world is not None:
        d = d @ np.asarray(frame_from_world, F32).T
    return d


def filmic_preview(L):
    """A quick tone curve for previews outside Blender (the build itself
    goes through Blender's AgX)."""
    x = np.maximum(L, 0)
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    y = (x * (a * x + b)) / (x * (c * x + d) + e)
    y = np.clip(y, 0, 1)
    return np.where(y <= 0.0031308, y * 12.92, 1.055 * np.power(y, 1 / 2.4) - 0.055)


def local_frame(lon_deg, lat_deg):
    """East, north, up unit vectors at a point on the planet."""
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)], F32)
    east = np.array([-math.sin(lo), math.cos(lo), 0.0], F32)
    north = np.cross(up, east)
    return east, north, up


def orbit_camera(lon_deg, lat_deg, alt_km, heading_deg, depression_deg, roll_deg=0.0):
    """Eye position and camera rotation (columns right, up, back) for a
    camera above (lon, lat) looking along `heading` (clockwise from north)
    and `depression` degrees below the local horizontal."""
    east, north, up = local_frame(lon_deg, lat_deg)
    eye = up * (R + alt_km)
    hd = math.radians(heading_deg)
    fwd_h = north * math.cos(hd) + east * math.sin(hd)
    dp = math.radians(depression_deg)
    fwd = fwd_h * math.cos(dp) - up * math.sin(dp)
    right = np.cross(fwd, up)
    right /= np.linalg.norm(right)
    cup = np.cross(right, fwd)
    rl = math.radians(roll_deg)
    r2 = right * math.cos(rl) + cup * math.sin(rl)
    u2 = -right * math.sin(rl) + cup * math.cos(rl)
    rot = np.stack([r2, u2, -fwd], 1).astype(F32)
    return eye.astype(F32), rot


def sun_from(lon_deg, lat_deg, heading_deg, elev_deg, az_deg):
    """Sun direction given its elevation above the station's local horizon
    and its azimuth relative to the view heading (0 = straight ahead,
    +90 = to the right)."""
    east, north, up = local_frame(lon_deg, lat_deg)
    a = math.radians(heading_deg + az_deg)
    e = math.radians(elev_deg)
    h = north * math.cos(a) + east * math.sin(a)
    s = h * math.cos(e) + up * math.sin(e)
    return (s / np.linalg.norm(s)).astype(F32)
