"""The first look: the ground under the player's view when a game starts.

At the start of play the station is over (lon -150, lat 14) heading
north-east (world.SUBPOINT, world.HEADING_DEG), and the view takes in the
ground from about lon -152 to -134, lat 8 to 27 - north-west to the left of
the screen, south-east to the right. The generated world alone put open
ocean there. This module draws a landscape into it, designed for that view
and blended into the generated world around it, so the first look says
"a world":

    a coast running from the lower left toward the limb on the right,
    with a turquoise shelf and a sediment plume off a river delta;
    a desert behind it - a sand sea of linear dunes west of the river,
    dark rocky plateau cut by dry valleys east of it, a salt flat;
    a Nile-like river from a snow-capped range down through the desert,
    a green ribbon that widens into irrigated lowlands at its delta;
    greener foothills on the range's seaward side, steppe beyond it.

Every feature is placed in lon/lat, drawn with the same noise as the rest
of the planet and faded into it, so there is no seam. Coordinates: a local
tangent plane around CENTRE in kilometres (x east, y north).
"""

import math

import numpy as np

from . import noise as N

F32 = np.float32
R_KM = 6371.0
CENTRE = (-145.0, 17.0)
BOX = (-162.0, -126.0, 2.0, 34.0)        # lon0, lon1, lat0, lat1 (the region touched)
CORE = (-156.0, -132.0, 7.0, 29.0)        # fully designed inside, faded to the world outside

# the subcontinent's mass (lon, lat, radius deg, weight) for planet.continents
MASSES = [(-145.0, 31.0, 13.0, 0.95), (-156.0, 27.0, 8.0, 0.6), (-133.0, 26.0, 9.0, 0.6)]
# the coast, west to east, land to the north (left of the direction of travel)
COAST = [(-160.0, 21.5), (-156.5, 20.0), (-153.0, 18.6), (-150.5, 17.4), (-148.6, 16.6),
         (-147.2, 16.2), (-146.4, 15.6), (-145.2, 15.7), (-143.6, 15.1), (-141.5, 14.1),
         (-139.0, 12.9), (-136.5, 11.6), (-133.5, 10.6), (-129.0, 10.0)]
# the range, west to east, roughly parallel to the coast
RANGE = [(-159.0, 23.6), (-155.0, 22.3), (-151.0, 21.3), (-147.5, 20.6), (-144.0, 19.9),
         (-140.5, 18.8), (-137.0, 17.2), (-133.5, 15.6), (-130.0, 14.8)]
# the river, from its source on the range's flank to the delta
RIVER = [(-148.2, 20.9), (-148.0, 20.2), (-147.3, 19.4), (-147.7, 18.6), (-147.1, 17.9),
         (-146.9, 17.1), (-146.6, 16.4), (-146.35, 15.95)]
DELTA = (-146.4, 15.75)
SALT = (-141.8, 15.3)


def to_xy(lon, lat):
    lo0, la0 = CENTRE
    k = math.pi / 180 * R_KM
    return (np.asarray(lon) - lo0) * k * math.cos(math.radians(la0)), (np.asarray(lat) - la0) * k


def region(p):
    """Row/column slices of the map covering BOX, and the lon/lat there."""
    lo0, lo1, la0, la1 = BOX
    W, H = p.W, p.H
    x0 = int((lo0 + 180) / 360 * W)
    x1 = int((lo1 + 180) / 360 * W) + 1
    y0 = int((90 - la1) / 180 * H)
    y1 = int((90 - la0) / 180 * H) + 1
    ys, xs = slice(y0, y1), slice(x0, x1)
    lon = np.degrees(p.LON[ys, xs])
    lat = np.degrees(p.LAT[ys, xs])
    return ys, xs, lon, lat


def weight(lon, lat):
    """1 inside CORE, fading to 0 at BOX."""
    lo0, lo1, la0, la1 = CORE
    Lo0, Lo1, La0, La1 = BOX
    wx = np.minimum(N.smoothstep(Lo0, lo0, lon), N.smoothstep(Lo1, lo1, lon))
    wy = np.minimum(N.smoothstep(La0, la0, lat), N.smoothstep(La1, la1, lat))
    return (wx * wy).astype(F32)


def polyline(x, y, pts):
    """Distance (km) from each point to a polyline given in lon/lat, the
    signed side (+ left of the direction of travel), and the arc-length
    position (km) of the nearest point along it."""
    px, py = to_xy([q[0] for q in pts], [q[1] for q in pts])
    best = np.full(x.shape, 1e9, F32)
    side = np.zeros(x.shape, F32)
    along = np.zeros(x.shape, F32)
    acc = 0.0
    for i in range(len(pts) - 1):
        ax, ay, bx, by = px[i], py[i], px[i + 1], py[i + 1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        L = math.sqrt(L2)
        t = np.clip(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1)
        qx, qy = ax + t * dx, ay + t * dy
        d = np.hypot(x - qx, y - qy)
        m = d < best
        best = np.where(m, d, best)
        cr = dx * (y - ay) - dy * (x - ax)
        side = np.where(m, np.sign(cr), side)
        along = np.where(m, acc + t * L, along)
        acc += L
    return best, side, along


def _sub(p, arr):
    ys, xs, _, _ = region(p)
    return arr[ys, xs]


# ---------------------------------------------------------------------------

def coast(p):
    """Pin the coastline in view: within ~400 km of the designed coast the
    continent field follows it (rugged at every scale, the delta pushing
    out to sea); the sea side stays sea and the land side stays land for
    700 km inland. Beyond that band the generated subcontinent (MASSES)
    carries on as the generator made it."""
    ys, xs, lon, lat = region(p)
    x, y = to_xy(lon, lat)
    d, side, _ = polyline(x, y, COAST)
    sd = d * side                                        # + on land (north)
    f = p.field("hero-coast")
    P = p.P[ys, xs]
    Pw = N.tangent_warp(P, f.vec(P, 14.0, 3), 0.012)
    dl = np.hypot(*[a - b for a, b in zip(to_xy(lon, lat), to_xy(*DELTA))])
    calm = N.smoothstep(40.0, 160.0, dl)
    wig = (0.07 * f.fbm(Pw, 18.0, 6) + 0.035 * f.fbm(Pw, 75.0, 4, first=6)) * (0.35 + 0.65 * calm)
    lobe = 0.12 * np.exp(-(dl / 55.0) ** 2)             # the delta pushes out to sea
    ch = np.clip(sd / 800.0, -0.5, 0.45) + wig + lobe
    c = p.c[ys, xs]
    band = N.smoothstep(450.0, 150.0, np.abs(sd))
    cb = c * (1 - band) + ch * band
    cb = np.where(sd < 0, np.minimum(cb, ch), cb)
    cb = np.where((sd > 0) & (sd < 700.0), np.maximum(cb, 0.03 + 0.5 * np.maximum(wig, 0)), cb)
    w = weight(lon, lat)
    p.c[ys, xs] = (c * (1 - w) + cb * w).astype(F32)
    p.land = (p.c > 0).astype(F32)


def mountains(p):
    """The range, snow-capped: ridged peaks along the polyline, foothills,
    and a high plateau behind it."""
    ys, xs, lon, lat = region(p)
    x, y = to_xy(lon, lat)
    d, side, along = polyline(x, y, RANGE)
    f = p.field("hero-range")
    P = p.P[ys, xs]
    Pw = N.tangent_warp(P, f.vec(P, 10.0, 3), 0.01)
    ridges = f.ridged(Pw, 45.0, 6, sharp=2.4)
    # height varies along the chain: massifs and saddles
    massif = 0.55 + 0.45 * N.smoothstep(-0.3, 0.4, f.fbm(P, 6.0, 3, first=9))
    core = np.exp(-(d / 70.0) ** 2)
    foot = np.exp(-(d / 190.0) ** 2)
    plateau = N.smoothstep(0.0, 1.0, np.clip(side * d / 250.0, 0, 1)) * (side > 0) * (0.3 + 0.4 * N.smoothstep(-0.3, 0.4, f.fbm(P, 4.0, 3, first=12)))
    add = core * massif * (2.2 + 3.8 * ridges) + foot * (0.5 + 0.9 * ridges) + plateau * 0.9
    w = weight(lon, lat)
    land = p.c[ys, xs] > 0
    e = p.elev[ys, xs]
    p.elev[ys, xs] = np.where(land, e + add * w, e).astype(F32)
    p.ridges[ys, xs] = (p.ridges[ys, xs] * (1 - w) + np.maximum(ridges, p.ridges[ys, xs]) * w).astype(F32)


def climate(p):
    """Dry between the coast and the range (a hot desert: no rain from the
    trades that come over land), wetter on the range's seaward slopes where
    the monsoon breaks, steppe on the plateau beyond."""
    H4, W4 = p.H4, p.W4
    lon = np.degrees(p.LON4)
    lat = np.degrees(p.LAT4)
    x, y = to_xy(lon, lat)
    dc, sc, _ = polyline(x, y, COAST)
    dr, sr, _ = polyline(x, y, RANGE)
    w = weight(lon, lat)
    land = p.down4(p.land) > 0.5
    desert = (sc > 0) & (sr < 0)
    P = p.P4mm
    target = np.where(desert, 70.0 + 60.0 * N.smoothstep(0, 1, 1 - dr / 260.0), 320.0)
    # the monsoon slopes: rain where the range rises from the desert
    target = target + 900.0 * np.exp(-((dr - 40.0) / 70.0) ** 2) * (sr < 0)
    p.P4mm = np.where(land, P * (1 - w) + target * w, P).astype(F32)


def river_line(p):
    """The river's course, meandering, as a dense lon/lat polyline (and the
    delta's distributaries)."""
    rng = p.rng("hero-river")
    lons, lats = [], []
    for (a, b) in zip(RIVER[:-1], RIVER[1:]):
        for t in np.linspace(0, 1, 40, endpoint=False):
            lons.append(a[0] + (b[0] - a[0]) * t)
            lats.append(a[1] + (b[1] - a[1]) * t)
    lons.append(RIVER[-1][0])
    lats.append(RIVER[-1][1])
    lons, lats = np.array(lons), np.array(lats)
    s = np.linspace(0, 1, lons.size)
    off = 0.10 * np.sin(s * 37.0) + 0.05 * np.sin(s * 91.0 + 1.3) + 0.03 * np.sin(s * 211.0)
    main = list(zip(lons + off, lats + off * 0.6))
    apex = main[-12]
    arms = []
    for ang in (-60, -25, 5, 40):
        a = math.radians(ang - 90)
        L = rng.uniform(0.35, 0.55)
        t = np.linspace(0, 1, 30)
        arms.append(list(zip(apex[0] + np.cos(a) * L * t + 0.03 * np.sin(t * 17 + ang),
                             apex[1] + np.sin(a) * L * t * 0.8)))
    return main, arms


def river(p):
    """The great river as a smooth mask (distance to its meandering course,
    so it never shows the map's pixels): p.hero_river, which the water
    mask, the albedo and the city lights read."""
    ys, xs, lon, lat = region(p)
    x, y = to_xy(lon, lat)
    main, arms = river_line(p)
    d, _, _ = polyline(x, y, main)
    m = N.smoothstep(2.8, 0.6, d)
    for arm in arms:
        da, _, _ = polyline(x, y, arm)
        m = np.maximum(m, 0.7 * N.smoothstep(3.0, 0.6, da))
    c = p.c[ys, xs]
    m = m * (c > -0.02)
    p.hero_river = np.zeros((p.H, p.W), F32)
    p.hero_river[ys, xs] = (m * weight(lon, lat)).astype(F32)
    p.hero_river_d = (ys, xs, d)


def soft(sd, width):
    """0 -> 1 across a signed distance (km), over +-width."""
    return N.smoothstep(-width, width, sd)


def surface(p):
    """Colour the designed landscape: sand sea with linear dunes, rocky
    plateau with dry valleys, a salt flat, the green river corridor opening
    into a delta fan and an irrigated coastal plain, greener monsoon
    foothills, snowfields on the range. Every mask is a soft signed
    distance, so nothing shows the map's pixels when magnified."""
    from .planet import srgb, lerp
    ys, xs, lon, lat = region(p)
    x, y = to_xy(lon, lat)
    w = weight(lon, lat)
    col = p.albedo[ys, xs].copy()
    elev = p.elev[ys, xs]
    c = p.c[ys, xs]
    gc = np.sqrt(np.gradient(c, axis=0) ** 2 + np.gradient(c, axis=1) ** 2) + 1e-6
    landf = np.clip(0.5 + c / gc, 0, 1)
    f = p.field("hero-surface")
    P = p.P[ys, xs]
    Pw = N.tangent_warp(P, f.vec(P, 12.0, 3), 0.01)
    n1 = f.fbm(Pw, 30.0, 5)
    n2 = f.fbm(Pw, 110.0, 4, first=5)
    dr, sr, _ = polyline(x, y, RANGE)
    driv, sriv, along = polyline(x, y, RIVER)
    driv_m = p.hero_river_d[2]
    dc, sc, _ = polyline(x, y, COAST)
    desert = soft(sc * dc - 20.0, 40.0) * soft(-sr * dr - 50.0, 90.0) * landf
    east = soft(sriv * driv, 30.0)                  # east of the river (left of its course)
    west = 1 - east
    # --- desert ---
    sand = srgb((216, 160, 102))
    sand_pale = srgb((234, 206, 160))
    sand_red = srgb((196, 118, 70))
    reg = srgb((184, 156, 118))            # gravel plains
    rock = srgb((126, 98, 72))
    rock_dark = srgb((74, 58, 46))
    basalt = srgb((52, 46, 44))
    # sand seas: a few big ones, mostly west of the river, with linear
    # dunes running with the wind (north-east to south-west)
    th = math.radians(35)
    v = -x * math.sin(th) + y * math.cos(th)
    lam = 30.0
    dunes = 0.5 + 0.5 * np.sin(v / lam * 2 * math.pi + 3.0 * f.fbm(Pw, 20.0, 3, first=9))
    dunes = dunes * N.smoothstep(-0.2, 0.3, f.fbm(Pw, 40.0, 3, first=12))
    erg = N.smoothstep(-0.08, 0.08, f.fbm(Pw, 5.0, 5, first=14) + 0.22 * (west - east) * soft(driv - 30.0, 60.0) - 0.08)
    reds = N.smoothstep(-0.1, 0.4, f.fbm(Pw, 6.0, 3, first=40))
    ergcol = lerp(lerp(sand, sand_red, reds[..., None] * 0.75), sand_pale, (dunes * 0.4)[..., None])
    # gravel plains cut by wadis, rock outcrops, black basalt fields
    wadi = N.smoothstep(0.80, 0.95, f.ridged(Pw, 60.0, 4, first=20))
    plain = lerp(reg, rock, N.smoothstep(0.0, 0.5, n1)[..., None] * 0.5)
    plain = lerp(plain, sand_pale, wadi[..., None] * 0.6)
    outcrop = N.smoothstep(0.08, 0.32, f.fbm(Pw, 11.0, 5, first=70))
    plain = lerp(plain, rock_dark, outcrop[..., None] * 0.75)
    lava = N.smoothstep(0.52, 0.6, f.fbm(Pw, 8.0, 5, first=76)) * east
    plain = lerp(plain, basalt, lava[..., None] * 0.9)
    dcol = lerp(plain, ergcol, erg[..., None])
    dcol = dcol * (1 + 0.12 * n1 + 0.07 * n2)[..., None]
    # a pale strip of tidal flats along the shore
    sabkha = N.smoothstep(14.0, 4.0, sc * dc + 6 * n1) * (1 - erg * 0.5)
    dcol = lerp(dcol, srgb((222, 214, 196)), sabkha[..., None] * 0.6)
    col = lerp(col, dcol, (desert * w)[..., None])
    # --- the range: bare dark rock, ridges lit and valleys pale with scree ---
    rocky = N.smoothstep(1.0, 2.6, elev) * landf
    rid = f.ridged(Pw, 90.0, 4, sharp=2.0, first=60)
    mcol = lerp(srgb((150, 126, 100)), srgb((66, 54, 46)), N.smoothstep(0.3, 0.8, rid)[..., None])
    col = lerp(col, mcol, (rocky * w)[..., None])
    # --- the river corridor, the delta fan and the irrigated coastal plain ---
    corridor = N.smoothstep(16.0, 4.0, driv_m + 3 * n1) * soft(sc * dc + 5, 10.0)
    # the delta: a fan opening from its apex (60 km up the river) to the sea
    ax, ay = to_xy(RIVER[-2][0], RIVER[-2][1])
    mx, my = to_xy(DELTA[0], DELTA[1])
    dx, dy = mx - ax, my - ay
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    s_al = ((x - ax) * ux + (y - ay) * uy) / L          # 0 at the apex, 1 at the coast
    s_ac = (-(x - ax) * uy + (y - ay) * ux)
    fan = N.smoothstep(-0.1, 0.25, s_al) * N.smoothstep(1.35, 1.0, s_al) * \
        N.smoothstep(0.0, -10.0, np.abs(s_ac) - (5.0 + 42.0 * np.clip(s_al, 0, 1.3)) + 8 * n1)
    # the plain: a coastal strip east of the delta, 20-50 km deep
    plain = soft(sc * dc - 3.0, 6.0) * N.smoothstep(55.0, 30.0, sc * dc + 12 * n1) * \
        N.smoothstep(-40.0, 0.0, x - mx) * N.smoothstep(520.0, 380.0, x - mx)
    green = srgb((52, 92, 34))
    field_mix = N.smoothstep(-0.1, 0.3, f.fbm(P, 250.0, 2, first=24))
    farm = lerp(green, srgb((96, 104, 52)), field_mix[..., None] * 0.55)
    g = np.maximum.reduce([corridor, fan, plain * 0.85]) * landf
    col = lerp(col, farm, (g * w)[..., None])
    # the river's water itself in its lower course
    col = lerp(col, srgb((24, 46, 50)), (p.hero_river[ys, xs] * landf * 0.8)[..., None])
    # --- monsoon foothills and snowfields ---
    slopes = np.exp(-((dr - 55.0) / 60.0) ** 2) * (sr < 0) * N.smoothstep(0.6, 1.5, elev)
    col = lerp(col, srgb((70, 84, 44)) * (1 + 0.2 * n1[..., None]), (slopes * 0.7 * w * landf)[..., None])
    snow = N.smoothstep(4.3, 5.0, elev + 1.6 * (rid - 0.5) + 0.8 * n2) * landf * N.smoothstep(0.35, 0.6, rid)
    col = lerp(col, srgb((238, 242, 248)), (snow * w)[..., None])
    # --- the sea: a turquoise shelf and the delta's sediment plume ---
    sea = 1 - landf
    shelf = N.smoothstep(70.0, 3.0, dc + 25 * n1) * sea
    col = lerp(col, srgb((36, 116, 126)), (shelf * 0.75 * w)[..., None])
    plume = N.smoothstep(170.0, 10.0, np.hypot(x - mx, y - my) + 60 * f.fbm(Pw, 25.0, 3, first=30)) * sea
    col = lerp(col, srgb((104, 112, 76)), (plume * 0.5 * w)[..., None])
    p.albedo[ys, xs] = np.clip(col, 0, 1).astype(F32)
    p.desert[ys, xs] = np.maximum(p.desert[ys, xs], (desert * w).astype(F32))


def clouds(p, cl):
    """The first look's weather: clear desert, cumulus caps along the range,
    and over the sea trade cumulus in "flowers" - clumps of cloud 30-80 km
    across with clear sea between - clear along the coast where the sea
    breeze sinks. (The thunderstorm cluster on the horizon is one of the
    clusters in clouds.convection.)"""
    ys, xs, lon, lat = region(p)
    x, y = to_xy(lon, lat)
    w = weight(lon, lat)
    c = p.c[ys, xs]
    gc = np.sqrt(np.gradient(c, axis=0) ** 2 + np.gradient(c, axis=1) ** 2) + 1e-6
    landf = np.clip(0.5 + c / gc, 0, 1)
    dc, sc, _ = polyline(x, y, COAST)
    dr, sr, _ = polyline(x, y, RANGE)
    f = p.field("hero-clouds")
    Q = p.Q[ys, xs]
    Pw = N.tangent_warp(Q, f.vec(Q, 20.0, 3), 0.006)
    old = cl[ys, xs]
    # the range: cumulus caps in clusters on the peaks, none on the lee side
    caps = np.exp(-((dr - 15.0) / 45.0) ** 2) * N.smoothstep(0.15, 0.5, f.fbm(Pw, 55.0, 4)) * 0.85
    desert_clear = soft(-sr * dr - 40.0, 40.0)
    over_land = np.maximum(caps, old * (1 - desert_clear) * 0.6)
    # the sea: flowers of trade cumulus
    F1, F2 = N.worley(Pw, 6371.0 / 90.0, 71)
    blob = N.smoothstep(0.55, 0.25, F1 + 0.18 * f.fbm(Pw, 60.0, 3, first=8))
    size = N.smoothstep(-0.3, 0.5, f.fbm(Pw, 15.0, 3, first=5))
    flowers = blob * (0.35 + 0.4 * size)
    sugar = 0.06 + 0.08 * N.smoothstep(0.0, 0.6, f.fbm(Pw, 40.0, 3, first=12))
    sea = np.maximum(flowers, sugar) * N.smoothstep(20.0, 80.0, dc)
    target = over_land * landf + sea * (1 - landf)
    cl[ys, xs] = (old * (1 - w) + target * w).astype(F32)
