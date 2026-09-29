"""The cloud map, built by weather regime.

Real cloud from orbit is not one texture: it is a handful of regimes, each
with its own structure, laid out by the general circulation. Each regime
below has its own generator, and the map is their union:

    clear highs       the subtropics over the deserts and the centres of
                      the oceanic highs: nearly cloudless, crisp edges
    trade cumulus     the tropical oceans: small cumulus in open cells and
                      arcs 50-150 km across (partial cover; the renderer's
                      detail texture turns it into individual puffs)
    stratocumulus     the cold eastern oceans of the subtropics: closed
                      cells near the coast (a bright honeycomb with thin
                      dark lanes), opening into rings further out, a clear
                      strip along the coast itself
    deep convection   the ITCZ and wet tropical land: clusters of round
                      anvils with crisp edges and fibrous outflow downwind
    mid-latitude lows comma heads with spiral bands, a long cold front with
                      a sharp leading edge and convective cells along it,
                      a warm-front shield, a dry slot, and behind the front
                      the cold sector's open cells and cloud streets
    storm-track haze  broken layers streaked by the flow between the lows
    polar stratus     grey sheets with breaks, thinner over the ice
    cirrus            thin fibrous veils in the jets and off the anvils
    hurricanes        eye, eyewall, dense overcast, spiral bands

Values are cloud opacity (0..1). Solid cloud is drawn with crisp edges
(1-3 map pixels); fields of small cloud are left as partial cover, which
the renderer breaks into cloudlets with detail.webp (see planetrender).
Global mean about 0.55, very uneven.
"""

import math

import numpy as np

from . import noise as N

F32 = np.float32
R_KM = 6371.0


def gauss(x, mu, sd):
    return np.exp(-((x - mu) / sd) ** 2).astype(F32)


def unit(lon_deg, lat_deg):
    lo, la = math.radians(lon_deg), math.radians(lat_deg)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)], F32)


def union(*layers):
    out = np.zeros_like(layers[0])
    for l in layers:
        out = 1 - (1 - out) * (1 - np.clip(l, 0, 1))
    return out


def solid(shape, pert, width=0.05, tex=None):
    """Solid cloud from a smooth shape (0..1): the edge is where shape +
    pert crosses 0.5, sharp (width) but as irregular as the noise; inside,
    brightness varies with the texture (thick and thin parts)."""
    v = N.smoothstep(0.5 - width, 0.5 + width, shape + pert)
    if tex is not None:
        v = v * (0.72 + 0.28 * tex)
    return v


def km_freq(size_km):
    """Worley/noise frequency on the unit sphere for features size_km apart."""
    return R_KM / size_km


def splat(p, arr, lon, lat, radius_rad, fn):
    """Evaluate fn(P_sub, ang_to_centre_rad, (ys, xs)) over the map rows and
    columns within 3 radii of (lon, lat) and max it into arr."""
    H, W = arr.shape
    la, lo = math.radians(lat), math.radians(lon)
    r_px = radius_rad / (2 * math.pi) * W * 3 + 2
    cx = (lo + math.pi) / (2 * math.pi) * W
    cy = (math.pi / 2 - la) / math.pi * H
    y0, y1 = int(max(0, cy - r_px)), int(min(H, cy + r_px + 1))
    rx = min(W / 2, r_px / max(math.cos(la), 0.05))
    xs = np.arange(int(cx - rx), int(cx + rx) + 1) % W
    if y1 <= y0:
        return
    sub = p.P[y0:y1][:, xs]
    c = unit(lon, lat)
    ang = np.arccos(np.clip(sub @ c, -1, 1))
    v = fn(sub, ang, (slice(y0, y1), xs))
    arr[y0:y1, xs] = np.maximum(arr[y0:y1, xs], v.astype(F32))


# ---------------------------------------------------------------------------

def build(p):
    H, W = p.H, p.W
    lat = p.LAT
    dlat = np.degrees(np.abs(lat))
    slat = np.degrees(lat)
    land = p.land
    ocean = 1 - land
    f = p.field("clouds-regimes", 12)
    Q = p.Q
    logP = np.log10(np.maximum(p.Pmm, 10))
    say = p.say

    # --- regimes (smooth weights) ----------------------------------------
    itcz_lat = 5.0 + 4.0 * np.sin(p.LON * 2 + 0.7)
    itcz = gauss(slat, itcz_lat, 6.5)
    subhigh = gauss(dlat, 26, 7.5)
    storm = N.smoothstep(33, 43, dlat) * N.smoothstep(70, 60, dlat)
    polar = N.smoothstep(60, 72, dlat)
    land4 = p.down4(land)
    east_land = p._upwind(land4, p.LAT4, [250, 700, 1400], [1, 1, 0.7], np.full_like(land4, -1.0))
    deck = p.up(east_land) * gauss(dlat, 23, 9) * ocean
    deck = N.smoothstep(0.12, 0.5, deck)
    near_coast = p.up(p._upwind(land4, p.LAT4, [120, 300], [1, 1], np.full_like(land4, -1.0)))
    wet_warm_land = land * N.smoothstep(2.7, 3.15, logP) * N.smoothstep(8, 20, p.T)
    desert = np.maximum(p.desert, land * (1 - N.smoothstep(2.2, 2.6, logP)))

    # --- the textures ------------------------------------------------------
    Pw = N.tangent_warp(Q, f.vec(Q, 12.0, 3), 0.008)
    say("clouds: regimes")
    # cells: Worley on the flow-carried sphere. Decks ~45 km, open cells
    # ~70 km
    F1a, F2a = N.worley(Pw, km_freq(45.0), 101)
    wall45 = (F2a - F1a).astype(F32)
    F1b, F2b = N.worley(N.tangent_warp(Pw, f.vec(Pw, 30.0, 2), 0.004), km_freq(75.0), 103)
    wall75 = (F2b - F1b).astype(F32)
    say("clouds: cells")
    fine = f.fbm(Pw, 160.0, 3, first=20)
    clumps = f.fbm(Pw, 25.0, 5, first=24)

    # 1. trade cumulus, in the three shapes it takes: "flowers" (clumps
    # 30-90 km across with clear sea between), "gravel" (broken rings of
    # small cumulus), "sugar" (a thin sprinkle)
    Fb, _ = N.worley(p.P2, km_freq(110.0), 109)
    flowers_ = N.smoothstep(0.55, 0.28, p.up(Fb.astype(F32)) + 0.2 * clumps) * (0.4 + 0.35 * N.smoothstep(-0.3, 0.5, fine))
    gravel = N.smoothstep(0.22, 0.06, wall75) * N.smoothstep(-0.1, 0.35, clumps) * 0.4
    sugar = 0.08 + 0.10 * N.smoothstep(0.0, 0.6, clumps)
    kind = f.fbm(p.P, 1.6, 3, first=90)
    trade = np.maximum.reduce([flowers_ * N.smoothstep(-0.3, 0.0, kind), gravel * N.smoothstep(-0.2, -0.4, kind), sugar])
    zones = N.smoothstep(-0.25, 0.25, f.fbm(p.P, 2.2, 4, first=96))       # cloudy and clear zones, 1000-3000 km
    trade = trade * (0.25 + 0.75 * zones) + flowers_ * zones * 0.5
    trade_w = ocean * gauss(dlat, 14, 13) * (1 - deck) * (1 - 0.6 * itcz)
    # fair-weather cumulus over warm wet land, a little over any land
    landcu = np.clip(0.10 + 0.35 * N.smoothstep(-0.2, 0.5, clumps + 0.3 * gravel), 0, 0.6)
    landcu_w = land * (0.25 + 0.75 * wet_warm_land) * (1 - desert)

    # 2. stratocumulus decks: closed cells near the coast, open further out;
    # cells vary in brightness and the lanes between them come and go
    lanes = N.smoothstep(0.02, 0.16, wall45 + 0.06 * (fine + 1))
    closed = (0.75 + 0.25 * lanes) * (0.8 + 0.2 * fine) * N.smoothstep(-0.6, -0.2, clumps + 0.3 * fine)
    openc = N.smoothstep(0.26, 0.05, wall75) * N.smoothstep(-0.35, 0.15, clumps) * 0.75
    closeness = N.smoothstep(0.1, 0.6, near_coast)
    deckcloud = (openc * (1 - closeness) + closed * closeness) * deck
    # the coast itself stays clear (the offshore flow sinks over the shelf)
    coastal = N.smoothstep(0.62, 0.35, p.up(N.blur(land4, 1, 1)))
    deckcloud *= coastal

    # 3. deep convection: clusters of anvils
    conv = convection(p, f)
    say("clouds: convection")

    # 4. mid-latitude lows
    lows, cold_sector = lows_layer(p, f, Pw, wall75, fine)
    say("clouds: lows")

    # 5. storm-track haze between the lows: broken layers streaked by the flow
    Pz = Pw * np.array([1.0, 1.0, 3.0], F32)
    streak = f.fbm(Pz, 6.0, 7, first=30)
    haze = N.smoothstep(-0.05, 0.35, streak) * 0.75 + N.smoothstep(0.25, 0.55, streak) * 0.25
    haze = haze * (0.8 + 0.2 * fine)
    haze_w = storm * (0.85 + 0.15 * ocean)

    # 6. polar stratus: grey sheets with rifts, streaked by the flow
    sheet = solid(0.5 + 0.5 * f.fbm(Pw, 3.0, 5, first=40), 0.3 * f.fbm(Pz, 10.0, 4, first=44) + 0.12 * fine, 0.06,
                  0.5 + 0.5 * fine) * 0.8
    polar_w = polar * (1 - 0.55 * p.seaice) * (1 - 0.7 * (p.ice * land))

    # the ITCZ itself: a broken band of mid-level cloud and cirrus in which
    # the storm clusters sit
    itcz_band = solid(itcz * N.smoothstep(-0.1, 0.5, f.fbm(Pw, 5.0, 5, first=100)),
                      0.3 * f.fbm(Pz, 14.0, 4, first=104) + 0.1 * fine, 0.05, 0.5 + 0.5 * fine) * 0.7

    # 7. cirrus veils
    cir = f.ridged(Pw * np.array([1.0, 1.0, 2.4], F32), 9.0, 5, sharp=3.2, first=50)
    cirrus = N.smoothstep(0.62, 0.92, cir) * (0.45 * gauss(dlat, 40, 9) + 0.3 * itcz) \
        * N.smoothstep(-0.1, 0.35, f.fbm(p.P, 3.0, 3, first=57)) * 0.5

    # --- union ---------------------------------------------------------------
    clear = 1 - 0.9 * np.maximum(subhigh * (1 - deck) * (0.5 + 0.5 * land), desert)
    base = union(trade * trade_w, landcu * landcu_w, deckcloud, haze * haze_w, sheet * polar_w, itcz_band)
    base = base * clear
    out = union(base, conv, lows, cold_sector)
    for s in p.systems:
        if s['kind'] == 'tropical':
            out = np.maximum(out, p._hurricane(s, f))
    out = union(out, cirrus)
    # orographic caps on the high ranges; nothing grows on the ice plateau
    oro = N.smoothstep(2.0, 3.5, p.elev) * land * N.smoothstep(0.2, 0.6, f.fbm(Pw, 60.0, 3, first=60)) * 0.6
    out = union(out, oro * (1 - desert * 0.7))
    out *= 1 - 0.5 * N.smoothstep(2.8, 4.0, p.elev) * (p.ice > 0.5)
    # thicken partial cloud everywhere a little (the regimes are drawn
    # conservatively): 0.3 -> 0.42, 0.5 -> 0.66, solid stays solid
    out = 1 - (1 - np.clip(out, 0, 1)) ** 1.5
    from . import hero
    hero.clouds(p, out)
    say(f"clouds: mean opacity {out.mean():.2f} (tropics {out[np.abs(slat) < 30].mean():.2f}, "
        f"mid-latitudes {out[(dlat > 35) & (dlat < 65)].mean():.2f})")
    return np.clip(out, 0, 1).astype(F32)


# ---------------------------------------------------------------------------

def convection(p, f):
    """Thunderstorm clusters: a few anvils each, of very different sizes,
    merged, with irregular crisp edges (the anvil's upwind edge is the
    sharpest), fibrous outflow blown westward, towering cumulus around."""
    H, W = p.H, p.W
    rng = p.rng("anvils")
    out = np.zeros((H, W), F32)
    clusters = []
    n = 140
    for _ in range(n * 4):
        lo = rng.uniform(-180, 180)
        la = rng.normal(6, 7)
        u = (lo + 180) / 360
        v = (90 - la) / 180
        yi = min(p.H4 - 1, int(v * p.H4))
        xi = min(p.W4 - 1, int(u * p.W4))
        wet = p.P4mm[yi, xi] > 1400
        if wet or rng.random() < 0.08:
            clusters.append((lo, la))
        if len(clusters) >= n:
            break
    best = None
    for lo, la in clusters:
        yi, xi = int((90 - la) / 180 * p.H), int((lo + 180) / 360 * p.W) % p.W
        if 0 <= yi < p.H and p.land[yi, xi] > 0 and (best is None or abs(la) < abs(best[1])):
            best = (lo, la)
    if best:
        clusters.append(best)
        p.meta['storm'] = (round(best[0], 2), round(best[1], 2))
    horizon = (-136.8, 8.6)
    clusters.append(horizon)
    edge_n = f.fbm(p.Q, 70.0, 5, first=70)
    fib = f.ridged(p.Q * np.array([1.0, 1.0, 2.0], F32), 40.0, 4, sharp=2.5, first=74)
    tex = f.fbm(p.Q, 150.0, 3, first=78)
    for lo, la in clusters:
        big = (lo, la) in (best, horizon)
        k = int(rng.integers(3, 9)) + (4 if big else 0)
        for _ in range(k):
            dlo = rng.normal(0, 1.1 if big else 0.8)
            dla = rng.normal(0, 0.6 if big else 0.45)
            rad = math.radians(rng.lognormal(math.log(0.28), 0.45) * (1.3 if big else 1.0))
            clo, cla = lo + dlo, la + dla
            east = np.array([-math.sin(math.radians(clo)), math.cos(math.radians(clo)), 0.0], F32)

            def anvil(sub, ang, idx, rad=rad, east=east):
                e = edge_n[idx[0]][:, idx[1]]
                fb = fib[idx[0]][:, idx[1]]
                tx = tex[idx[0]][:, idx[1]]
                d = ang / rad
                env = N.smoothstep(3.0, 2.2, d)          # nothing reaches the splat's edge
                x = (sub @ east) / rad
                # upwind (east) edge crisp, downwind edge softer and pulled out
                stretch = np.where(x < 0, 1.0 + 0.6 * np.minimum(-x, 2.0), 1.0)
                shape = np.exp(-(d / stretch) ** 2 * 0.7)
                core = solid(shape, 0.45 * e, np.where(x < 0, 0.08, 0.03), 0.5 + 0.5 * tx)
                plume = N.smoothstep(2.8, 0.8, d - np.maximum(-x, 0) * 0.6) * N.smoothstep(0.3, -0.9, x) * \
                    (0.15 + 0.35 * N.smoothstep(0.55, 0.9, fb))
                towers = N.smoothstep(1.9, 1.1, d) * N.smoothstep(0.25, 0.6, e + 0.3) * 0.4
                return np.maximum.reduce([core, plume, towers]) * env
            splat(p, out, clo, cla, rad * 1.05, anvil)
    return out


def lows_layer(p, f, Pw, wall75, fine):
    """Every extratropical low in its own frame (x east, y poleward, in units
    of its radius r): a comma head of spiral bands, a dry slot, the cold
    front, the warm-front shield, and the cold sector behind the front."""
    H, W = p.H, p.W
    out = np.zeros((H, W), F32)
    cold = np.zeros((H, W), F32)
    ns = f.fbm(Pw, 12.0, 6, first=80)
    ns2 = f.fbm(Pw, 45.0, 4, first=86)
    ns3 = f.fbm(Pw * np.array([1.0, 1.0, 2.5], F32), 30.0, 4, first=92)
    openc = N.smoothstep(0.24, 0.05, wall75)
    lat = p.LAT
    for s in p.systems:
        if s['kind'] != 'low':
            continue
        y0, y1, x, y, ok = p._low_frame(s, 5.5)
        a = ns[y0:y1]
        a2 = ns2[y0:y1]
        a3 = ns3[y0:y1]
        rr = np.sqrt(x * x + y * y)
        th = np.arctan2(y, x)
        # the smooth shapes: comma head (spiral bands round a core), cold
        # front, warm-front shield; then one irregular crisp edge for all
        arm = 0.5 + 0.5 * np.cos(th - np.log(np.maximum(rr, 1e-3)) * 2.3 + a * 0.8)
        head = (arm ** 1.5) * np.exp(-(rr / 1.5) ** 4) * N.smoothstep(0.05, 0.2, rr)
        core = np.exp(-(rr / 0.6) ** 2)
        slot_th = th + np.log(np.maximum(rr, 0.05)) * 1.3
        slot = np.exp(-(np.angle(np.exp(1j * (slot_th + 2.2))) / 0.4) ** 2) * N.smoothstep(2.4, 0.7, rr) * N.smoothstep(0.1, 0.3, rr)
        bend = 0.28 * math.sin(s['age'] * 6.0)
        sgrid = np.linspace(0, 3.8, 48)
        fx = 0.35 - 0.95 * sgrid + 0.16 * sgrid ** 2 + bend * np.sin(sgrid * 1.4)
        fy = -0.35 - 1.0 * sgrid
        d2 = np.full(x.shape, 99.0, F32)
        along = np.zeros(x.shape, F32)
        for k in range(sgrid.size):
            dd = (x - fx[k]) ** 2 + (y - fy[k]) ** 2
            m = dd < d2
            d2 = np.where(m, dd, d2)
            along = np.where(m, sgrid[k], along)
        fxa = 0.35 - 0.95 * along + 0.16 * along ** 2 + bend * np.sin(along * 1.4)
        across = (x - fxa) * 0.75                           # + ahead (east) of the front (slanted)
        w0 = 0.10 * (1.0 + 0.5 * a2)
        lead = np.exp(-(np.maximum(across, 0) / 0.05) ** 2)           # sharp leading edge
        trail = np.exp(-(np.minimum(across + w0, 0) / 0.12) ** 2)     # ragged trailing edge
        fl = s.get('flen', 1.9) * (0.0 if s.get('occluded') else 1.0)
        front = lead * trail * np.exp(-(np.maximum(along - fl, 0) / 0.5) ** 2) * (along < fl + 1.5) * (0.75 + 0.35 * a3) * \
            N.smoothstep(-0.45, -0.1, a2 + 0.25 * np.sin(along * 5.0 + s['age'] * 7))
        shield_d = np.sqrt(((x - 0.9) / 1.1) ** 2 + ((y - 0.45) / 0.7) ** 2)
        shield = np.exp(-shield_d ** 4) * (0.55 + 0.45 * math.cos(s['age'] * 9.0))
        shape = np.maximum.reduce([head, core, front, shield]) - 0.9 * slot
        tex = 0.5 + 0.5 * a3
        fn = fine[y0:y1]
        solid_ = solid(shape, 0.36 * a + 0.16 * a2 + 0.1 * fn, 0.03, tex)
        # convective cells along the leading edge
        cells = N.smoothstep(0.12, 0.02, np.abs(across + 0.05)) * N.smoothstep(0.1, 0.5, a2 + 0.2) * 0.85 * \
            np.exp(-(np.maximum(along - fl, 0) / 0.5) ** 2) * (along < fl + 1.5)
        solid_ = np.maximum(solid_, cells)
        # the warm sector: broken stratocumulus between the fronts
        warm = N.smoothstep(0.05, 0.4, across) * N.smoothstep(0.3, -0.5, y) * N.smoothstep(3.5, 1.5, rr)
        warm = warm * np.clip(0.3 + 0.35 * N.smoothstep(-0.2, 0.4, a2), 0, 0.6)
        # the cold sector: open cells over the sea behind the front
        behind = N.smoothstep(-0.25, -0.6, across) * N.smoothstep(-4.5, -0.8, y) * N.smoothstep(4.5, 1.5, rr)
        sea = 1 - p.land[y0:y1]
        cs = behind * (openc[y0:y1] * N.smoothstep(-0.3, 0.2, a2) * 0.7 * (0.7 + 0.3 * fine[y0:y1])) * (0.35 + 0.65 * sea)
        # cloud streets near the coast downwind of land: rolls along the wind
        k = R_KM / 34.0
        rolls = 0.5 + 0.5 * np.sin(lat[y0:y1] * k * 2 * math.pi + 3.5 * a)
        streets = N.smoothstep(0.55, 0.85, rolls) * N.smoothstep(-0.2, 0.3, a2) * 0.7
        near = p.up(p._upwind(p.down4(p.land), p.LAT4, [150, 400], [1, 1], np.ones_like(p.LAT4)))[y0:y1]
        streetmix = N.smoothstep(0.1, 0.5, near) * sea
        cs = cs * (1 - streetmix) + behind * streets * streetmix
        infl = N.smoothstep(5.5, 3.5, rr) * ok
        out[y0:y1] = np.maximum(out[y0:y1], (np.maximum(solid_, warm) * infl).clip(0, 1).astype(F32))
        cold[y0:y1] = np.maximum(cold[y0:y1], (cs * infl).astype(F32))
    return np.clip(out, 0, 1), cold
