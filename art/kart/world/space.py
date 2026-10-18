"""The space world's landmarks: a glowing ribbon of road in the dark, a ringed planet, a station, ring gates, satellites, rock."""
import math

from mathutils import Vector

from wlib import (C, Landmark, TAU, aim, chrome, faceted, mix, mul, smoothstep, with_breaks)

HULL = C("#d9e0ea")
HULL_D = C("#7a8699")
TEAL = C("#1fb8c8")
CYAN = (0.25, 0.9, 1.0)
MAGENTA = (1.0, 0.25, 0.8)
AMBER = (1.0, 0.7, 0.25)
GOLD_FOIL = chrome(C("#6b4a12"), C("#ffe08a"), horizon=0.0, band=0.3, tint=(1.0, 0.9, 0.7))
SILVER = chrome(C("#3a4358"), C("#e8f0ff"), horizon=0.0, band=0.25)
SOLAR = C("#1b3f9a")
SOLAR_L = C("#3b72d8")


def noise3(p, f=1.0, seed=0.0):
    x, y, z = p.x * f + seed, p.y * f, p.z * f
    return (math.sin(x * 1.7 + math.sin(y * 2.1 + z)) + math.sin(y * 1.3 + math.sin(z * 2.3 + x)) + math.sin(z * 1.9 + math.sin(x * 2.7 + y))) / 3.0


def dot(m, p, r=0.3, col=CYAN):
    m.sphere(r, at=tuple(p), segs=6, rings=4, col=col, mat="glow")


# ─── Ringed planet ───────────────────────────────────────────────────────────

PR = 216.0
PC = Vector((0.0, 209.0, 0.0))


def planet_col(p, n):
    d = p - PC
    lat = math.asin(max(-1.0, min(1.0, d.y / PR)))
    lon = math.atan2(d.x, d.z)
    warp = 0.07 * math.sin(lon * 3.0 + lat * 5.0) + 0.04 * math.sin(lon * 7.0 - lat * 11.0)
    t = lat + warp
    band = 0.5 + 0.5 * math.sin(t * 17.0) * 0.8 + 0.2 * math.sin(t * 41.0 + 1.3)
    cream, tan, rust, pale = C("#f1e0b8"), C("#d9a15e"), C("#b5603a"), C("#f6efdc")
    c = mix(mix(tan, cream, band), mix(rust, pale, 0.5 + 0.5 * math.sin(t * 9.0 + 2.0)), 0.25 + 0.2 * math.sin(t * 5.0))
    # the great storm
    a = lon - 0.9
    dl = (lat + 0.32)
    e = (a * math.cos(lat)) ** 2 / 0.05 + dl * dl / 0.012
    if e < 1.0:
        c = mix(C("#c8402f"), C("#f2a86a"), smoothstep(0.1, 1.0, e))
    pole = smoothstep(0.78, 1.15, abs(lat) * 1.0)
    c = mix(c, C("#7b88a8"), 0.55 * pole)
    # night side, softly
    return c


def ringed_planet() -> Landmark:
    lm = Landmark("ringed-planet", ao=0.0, ground=False)
    prof = [(0.0, -PR)] + [(PR * math.sin(math.pi * i / 64), -PR * math.cos(math.pi * i / 64)) for i in range(1, 64)] + [(0.0, PR)]
    lm.lathe(prof, at=tuple(PC), segs=128, col=planet_col, mat="matte")
    # the rings: bands of solid dust and faint glass, tilted
    tilt = (24.0, 0.0, -9.0)
    edges = [285.0, 296.0, 312.0, 320.0, 338.0, 362.0, 368.0, 392.0, 414.0, 420.0, 440.0, 458.0]
    cols = [C("#8a7a66"), C("#e9d8b4"), C("#a89478"), C("#f3e6c8"), C("#c8b08a"), C("#efe0bc"), C("#b49a78"), C("#e4d2ac"), C("#9c8668"), C("#f0e4c4"), C("#bba184")]
    for i in range(len(edges) - 1):
        r0, r1 = edges[i], edges[i + 1]
        solid = i % 3 != 2
        lm.lathe([(r0, 0.0), (r1, 0.0)], at=tuple(PC), rot=tilt, segs=140, col=cols[i], mat="matte" if solid else "glass", closed=False)
    # two moons
    for pos, r, c in (((260.0, 330.0, -190.0), 20.0, C("#b9b4aa")), ((-330.0, 90.0, 210.0), 11.0, C("#8c8f9c"))):
        lm.sphere(r, at=pos, segs=28, rings=18, col=lambda p, n, c=c: mix(mul(c, 0.7), c, smoothstep(-0.4, 0.8, n.y)), mat="matte", disp=lambda p, r=r: 0.05 * r * noise3(p, 0.4 / r * 8))
    return lm


# ─── Space station ───────────────────────────────────────────────────────────


def solar_wing(m, x0, x1, y, z, panels=3, w=5.8):
    """A wing of blue panels along x from x0 to x1 (outward), on a truss."""
    sg = 1 if x1 > x0 else -1
    L = abs(x1 - x0)
    m.rod((x0, y, z), (x1, y, z), 0.22, sides=6, col=SILVER, mat="metal")
    pl = L / panels
    for i in range(panels):
        xc = x0 + sg * (i + 0.5) * pl
        for dz in (-1, 1):
            m.rbox((pl - 0.3, 0.2, w), at=(xc, y, z + dz * (w / 2 + 0.3)), bevel=0.05, bseg=1, col=SOLAR, mat="glossy")
            for k in range(1, 6):
                m.rbox((pl - 0.4, 0.04, 0.08), at=(xc, y + 0.12, z + dz * (0.3 + w * k / 6)), col=SOLAR_L, mat="glossy")
            for k in range(1, 4):
                m.rbox((0.08, 0.04, w - 0.2), at=(xc - (pl - 0.4) / 2 + (pl - 0.4) * k / 4, y + 0.12, z + dz * (w / 2 + 0.3)), col=SOLAR_L, mat="glossy")
    m.rbox((0.7, 0.7, 0.7), at=(x1, y, z), bevel=0.1, col=HULL_D, mat="lit")


def space_station() -> Landmark:
    lm = Landmark("space-station", ao=0.5, ao_dist=8.0, rays=12, ground=False)
    prof = [(0.0, 8.5), (2.0, 8.5), (3.4, 10.0), (3.4, 14.0), (4.2, 15.0), (4.2, 20.0), (3.4, 21.0), (3.4, 27.0), (4.0, 28.0), (4.0, 31.0), (3.0, 32.5), (3.0, 37.0), (0.0, 37.0)]
    bands = [14.5, 20.5, 27.5, 31.5]
    lm.lathe(with_breaks(prof, bands), segs=32, col=lambda p, n: (TEAL if (14.0 < p.y < 15.2 or 27.2 < p.y < 28.2) else (HULL_D if p.y < 10.5 else HULL)), mat="glossy")
    for y in (17.5, 29.5):
        for k in range(8):
            a = TAU * k / 8
            r = 4.25 if y < 20 else 4.05
            lm.rbox((0.9, 1.1, 0.12), at=(math.cos(a) * r, y, math.sin(a) * r), rot=(0, math.degrees(-a) + 90, 0), col=(1.0, 0.85, 0.55), mat="glow")
    lm.cone(r=3.0, h=1.3, at=(0, 37.0, 0), segs=16, col=HULL, mat="glossy")
    lm.rod((0, 38.0, 0), (0, 44.0, 0), 0.12, sides=5, col=SILVER, mat="metal")
    dot(lm, (0, 44.2, 0), 0.45, (1.0, 0.2, 0.2))
    # the dish
    lm.sphere(2.6, at=(5.0, 35.5, 0), scale=(0.35, 1.0, 1.0), rot=(0, 0, -35), segs=20, rings=10, col=HULL, mat="glossy")
    lm.rod((3.0, 33.0, 0), (4.8, 35.2, 0), 0.15, sides=5, col=SILVER, mat="metal")
    # solar wings out to either side, radiators fore and aft
    solar_wing(lm, 3.8, 28.0, 31.0, 0.0)
    solar_wing(lm, -3.8, -28.0, 31.0, 0.0)
    for sz in (-1, 1):
        lm.rod((0, 14.0, sz * 3.0), (0, 14.0, sz * 20.0), 0.2, sides=6, col=SILVER, mat="metal")
        lm.rbox((8.0, 0.18, 6.0), at=(0, 14.0, sz * 17.0), bevel=0.05, bseg=1, col=C("#c8d0dc"), mat="glossy")
        for k in range(1, 6):
            lm.rbox((8.0, 0.04, 0.08), at=(0, 14.12, sz * (14.0 + k)), col=C("#8693a8"), mat="glossy")
    # thrusters glowing under it
    for k in range(4):
        a = TAU * k / 4 + 0.78
        lm.cylinder(r=0.7, h=1.0, at=(math.cos(a) * 1.5, 7.9, math.sin(a) * 1.5), segs=10, col=C("#2b3342"), mat="metal")
        dot(lm, (math.cos(a) * 1.5, 7.8, math.sin(a) * 1.5), 0.55, CYAN)
    # the habitat ring turns about the core, on six spokes
    ring = lm.spin("ring", "y", (0, 24.0, 0), 0.35)
    R = 14.0
    ring.torus(R=R, r=2.5, at=(0, 24.0, 0), segs=64, sides=14, col=faceted(lambda p, n: HULL if int(((math.atan2(p.z, p.x) % TAU) / TAU) * 32) % 2 == 0 else mix(HULL, HULL_D, 0.4)), mat="glossy")
    ring.torus(R=R + 0.5, r=0.9, at=(0, 24.0, 0), segs=64, sides=8, col=TEAL, mat="glossy")
    for k in range(48):
        a = TAU * (k + 0.5) / 48
        ring.rbox((0.9, 0.9, 0.12), at=(math.cos(a) * (R - 2.52), 24.0, math.sin(a) * (R - 2.52)), rot=(0, math.degrees(-a) + 90, 0), col=(1.0, 0.86, 0.55), mat="glow")
    for k in range(6):
        a = TAU * k / 6
        ring.rod((math.cos(a) * 3.2, 24.0, math.sin(a) * 3.2), (math.cos(a) * (R - 2.2), 24.0, math.sin(a) * (R - 2.2)), 0.55, sides=8, col=SILVER, mat="metal")
        dot(ring, (math.cos(a) * (R + 1.0), 25.1, math.sin(a) * (R + 1.0)), 0.4, (1.0, 0.25, 0.25) if k % 2 else (0.25, 1.0, 0.4))
    return lm


# ─── Ring gate (a neon ring over the road) ───────────────────────────────────


def ring_gate() -> Landmark:
    lm = Landmark("ring-gate", span=True, cut=2.4, ao=0.5, ao_dist=5.0, rays=10)
    CX, CY, RR, TR = 0.0, 7.3, 14.2, 2.0
    path = [(RR, -2.4, 0.0), (RR, 1.5, 0.0), (RR, 4.5, 0.0)] + [(CX + RR * math.cos(math.radians(a)), CY + RR * math.sin(math.radians(a)), 0.0) for a in range(0, 181, 5)] + [(-RR, 4.5, 0.0), (-RR, 1.5, 0.0), (-RR, -2.4, 0.0)]
    pts = [Vector(p) for p in path]
    prof = [(TR * math.cos(TAU * i / 20), TR * math.sin(TAU * i / 20)) for i in range(20)]
    lm.sweep([tuple(p) for p in pts], prof, up=(0, 0, 1), col=faceted(lambda p, n: C("#4a5fa8") if int(((math.atan2(p.y - CY, p.x) % TAU) / TAU) * 36) % 2 == 0 else C("#2f3d78")), mat="glossy")
    # the neon channel on the inner edge
    inner = [Vector((CX + (RR - TR + 0.25) * math.cos(math.radians(a)), CY + (RR - TR + 0.25) * math.sin(math.radians(a)), 0.0)) for a in range(0, 181, 4)]
    inner = [Vector((RR - TR + 0.25, 1.0, 0.0)), Vector((RR - TR + 0.25, 4.5, 0.0))] + inner + [Vector((-(RR - TR + 0.25), 4.5, 0.0)), Vector((-(RR - TR + 0.25), 1.0, 0.0))]
    lm.tube([tuple(p) for p in inner], r=0.8, sides=8, col=faceted(lambda p, n: mix(CYAN, MAGENTA, smoothstep(0.0, 1.0, 0.5 + 0.5 * math.sin(math.atan2(p.y - CY, p.x) * 2.0)))), mat="glow")
    # collars round the ring and a row of lights on its outer face
    for a in range(10, 171, 20):
        r = math.radians(a)
        with lm.group(at=(CX + RR * math.cos(r), CY + RR * math.sin(r), 0.0), rot=(0, 0, a - 90)):
            lm.rbox((TR * 2 + 0.7, 0.8, TR * 2 + 0.7), bevel=0.2, col=C("#15c4d8"), mat="glossy")
    for a in range(0, 181, 9):
        r = math.radians(a)
        dot(lm, (CX + (RR + TR + 0.1) * math.cos(r), CY + (RR + TR + 0.1) * math.sin(r), 0.0), 0.34, AMBER if (a // 9) % 2 else CYAN)
    for sx in (-1, 1):
        lm.rbox((6.0, 2.4, 6.0), at=(sx * RR, -0.4, 0.0), bevel=0.4, col=C("#2a3350"), mat="glossy")
        for k in range(3):
            lm.rbox((0.4, 1.6, 0.12), at=(sx * RR - 1.4 + k * 1.4, -0.4, 3.05), col=CYAN, mat="glow")
            lm.rbox((0.4, 1.6, 0.12), at=(sx * RR - 1.4 + k * 1.4, -0.4, -3.05), col=CYAN, mat="glow")
    return lm


# ─── Satellite ───────────────────────────────────────────────────────────────


def satellite() -> Landmark:
    lm = Landmark("satellite", ao=0.4, ground=False)
    sat = lm.spin("sat", "y", (0, 14.0, 0), 0.25, bob=0.7, bobspeed=0.7, phase=0.5)
    sat.rbox((3.8, 4.4, 3.8), at=(0, 14.0, 0), bevel=0.3, bseg=2, col=GOLD_FOIL, mat="metal")
    sat.rbox((4.2, 0.7, 4.2), at=(0, 16.5, 0), bevel=0.15, col=SILVER, mat="metal")
    sat.rbox((4.2, 0.5, 4.2), at=(0, 11.6, 0), bevel=0.15, col=SILVER, mat="metal")
    for sg in (-1, 1):
        solar_wing(sat, sg * 2.0, sg * 13.4, 14.0, 0.0, panels=2, w=2.6)
    # dish, antennas, a lit sensor eye
    sat.sphere(2.2, at=(0, 19.6, 0), scale=(1.0, 0.35, 1.0), rot=(18, 0, 0), segs=20, rings=10, col=SILVER, mat="metal")
    sat.rod((0, 16.8, 0), (0, 19.6, 0.0), 0.16, sides=6, col=SILVER, mat="metal")
    sat.rod((0, 19.6, 0), (0.0, 21.5, 1.2), 0.1, sides=5, col=SILVER, mat="metal")
    dot(sat, (0, 21.6, 1.3), 0.3, (1.0, 0.25, 0.25))
    sat.rod((1.2, 16.4, 1.2), (2.2, 24.6, 2.4), 0.07, sides=4, col=SILVER, mat="metal")
    sat.rod((-1.2, 16.4, -1.2), (-2.4, 24.0, -2.4), 0.07, sides=4, col=SILVER, mat="metal")
    sat.cylinder(r=0.6, h=1.0, at=(0, 9.8, 0), segs=12, col=C("#2b3342"), mat="metal")
    dot(sat, (0, 9.6, 0), 0.5, CYAN)
    sat.sphere(1.0, at=(0, 14.0, 2.3), segs=14, rings=8, col=C("#101830"), mat="glossy")
    dot(sat, (0, 14.0, 2.75), 0.35, CYAN)
    return lm


# ─── Asteroid ────────────────────────────────────────────────────────────────


def asteroid() -> Landmark:
    lm = Landmark("asteroid", ao=0.55, ao_dist=6.0, ground=False)
    ROCK, ROCK_L = C("#5d5560"), C("#9d8f88")
    craters = [Vector((6.0, 8.0, 4.0)), Vector((-7.0, 5.0, 6.0)), Vector((2.0, -9.0, 8.0)), Vector((-3.0, 9.0, -7.0)), Vector((9.0, -2.0, -3.0))]

    def rock_col(p, n):
        d = p - Vector((0, 18, 0))
        v = 0.5 + 0.5 * noise3(d, 0.35)
        c = mix(ROCK, ROCK_L, v * 0.8 + 0.2 * max(0.0, n.y))
        for q in craters:
            if (d - q).length < 4.0:
                c = mul(c, 0.8)
        return c

    def disp(p):
        d = p - Vector((0, 18, 0))
        h = 1.6 * noise3(d, 0.28) + 0.6 * noise3(d, 0.8, 3.0)
        for q in craters:
            r = (d - q.normalized() * 11.5).length
            h -= 1.9 * max(0.0, 1.0 - r / 4.5) ** 1.3
        return h

    lm.sphere(11.0, at=(0, 18.0, 0), scale=(1.1, 0.95, 1.05), segs=56, rings=36, col=rock_col, mat="matte", disp=disp)
    # ore crystals, glowing faintly
    for k, (a, e) in enumerate(((0.4, 0.5), (2.0, 0.9), (3.6, 0.2), (5.0, 0.7), (1.2, -0.5))):
        d = Vector((math.cos(a) * math.cos(e), math.sin(e), math.sin(a) * math.cos(e)))
        base = Vector((0, 18, 0)) + d * 10.4
        lm.cone(r=0.9, h=3.2, at=tuple(base), rot=aim(d), segs=6, col=(0.3 + 0.1 * k % 2, 0.85, 1.0), mat="glow")
    # a few loose rocks circling it
    for j, (spd, rs) in enumerate(((0.45, ((-23.0, 21.0, 6.0, 4.0), (22.0, 10.0, 11.0, 3.4))), (-0.3, ((-13.0, 33.0, -12.0, 3.2), (17.0, 28.0, -9.0, 2.8))))):
        part = lm.spin(f"rocks{j}", "y", (0, 18.0, 0), spd, bob=0.9, bobspeed=0.8 + 0.3 * j, phase=j * 2.0)
        for (x, y, z, r) in rs:
            part.sphere(r, at=(x, y, z), scale=(1.2, 0.85, 1.0), segs=20, rings=12, col=lambda p, n: mix(ROCK, ROCK_L, 0.4 + 0.4 * max(0.0, n.y)), mat="matte", disp=lambda p, r=r: 0.18 * r * noise3(p, 0.7 / r * 3))
    return lm


BUILDERS = {"ringed-planet": ringed_planet, "space-station": space_station, "ring-gate": ring_gate, "satellite": satellite, "asteroid": asteroid}
