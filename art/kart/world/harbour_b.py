"""The harbour, continued: the ship."""
import math

from harbour import (BUILDERS, CONTAINER_COLOURS, DARK, GREEN_L, NAVY, RED, RED_L, WHITE, WINDOW, bulb, paint)
from wlib import C, Landmark, faceted, smoothstep
from wtext import Plane


def hull_half_beam(t):
    """Half the beam (m) at a place t (0 stern .. 1 bow) along the hull."""
    stern = 0.8 + 0.2 * smoothstep(0.0, 0.16, t)
    bow = math.sqrt(max(0.0, 1.0 - max(0.0, (t - 0.62) / 0.38) ** 2.1))
    return 22.0 * stern * bow


def deck_y(t):
    return 7.0 + 2.4 * smoothstep(0.82, 1.0, t)


def hull_ring(x, L0=-70.0, L1=74.0, lift=0.0):
    t = (x - L0) / (L1 - L0)
    b = max(0.35, hull_half_beam(t))
    dk = deck_y(t)
    flare = 1.0 + 0.1 * smoothstep(0.5, 1.0, t)
    side = [(0.0, -2.2), (0.5 * b, -2.15), (0.86 * b, -1.5), (0.98 * b, -0.5), (b, 0.0), (b, 5.2), (b * flare, dk - 0.5), (b * flare, dk)]
    right = [(z, y) for z, y in side]
    left = [(-z, y) for z, y in reversed(side[1:])]
    pts = right + left
    return [(x, y, z) for z, y in pts]


def ship() -> Landmark:
    lm = Landmark("ship", ao=0.7, ao_dist=9.0, rays=12)
    xs = [-70.0 + 144.0 * i / 36 for i in range(37)]
    rings = [hull_ring(x) for x in xs]

    def hull_col(p, n):
        y = p.y
        if n.y > 0.7 and y > 6.0:
            return C("#4a525e")
        if y < 0.9:
            return paint(C("#b52a24"), 0.1)(p, n)
        if y > 5.7:
            return paint(WHITE, 0.1)(p, n)
        return paint(NAVY, 0.2)(p, n)

    lm.loft(rings, closed=True, caps=True, col=faceted(lambda p, n: hull_col(p, n)), mat="glossy")
    # foam round the waterline
    outline_in = []
    for i in range(0, 37):
        r = hull_ring(xs[i])
        outline_in.append((xs[i], 0.12, r[0][2] + 0.0))
    right = [(x, 0.12, hull_half_beam((x + 70.0) / 144.0) + 0.0) for x in xs]
    left = [(x, 0.12, -hull_half_beam((x + 70.0) / 144.0)) for x in reversed(xs)]
    inner = right + left
    outer = []
    for x, y, z in inner:
        sg = 1 if z >= 0 else -1
        outer.append((x + (1.8 if x > 60 else 0.0), y, z + sg * 1.3))
    lm.loft([inner, outer], closed=True, caps=False, col=(0.92, 0.97, 1.0), mat="lit")
    # containers on deck: stacks, tier by tier
    CL, CW, CH = 11.8, 4.8, 5.0
    k = 0
    for bay in range(7):
        x = -40.0 + bay * 12.2
        tt = (x + 70.0) / 144.0
        half = hull_half_beam(tt) - 2.0
        n_rows = max(1, int(half * 2 / (CW + 0.15)))
        for row in range(n_rows):
            z = (row - (n_rows - 1) / 2) * (CW + 0.15)
            tiers = 3 if abs(z) < 12 else 2
            if bay == 6:
                tiers = 1 if abs(z) < 14 else 0
            c = CONTAINER_COLOURS[(k + row) % len(CONTAINER_COLOURS)]
            for lev in range(tiers):
                cc = CONTAINER_COLOURS[(k + lev * 2 + row) % len(CONTAINER_COLOURS)]
                dk = deck_y(tt)
                n = int(CL / 1.3)
                pts = []
                for i in range(n + 1):
                    pts.append((x - CL / 2 + CL * i / n, z - CW / 2 - (0.15 if i % 2 == 0 else 0.0)))
                for i in range(n, -1, -1):
                    pts.append((x - CL / 2 + CL * i / n, z + CW / 2 + (0.15 if i % 2 == 0 else 0.0)))
                lm.prism(pts, CH - 0.15, y0=dk + 0.1 + lev * CH, col=paint(cc, 0.1), mat="lit")
            k += 1
    # the accommodation block aft, tier by tier, with lit windows; a bridge wing; the funnel and mast
    tiers = [(-64.0, -49.0, 7.0, 3.1, 19.0), (-63.0, -50.0, 10.1, 3.1, 18.0), (-62.0, -51.0, 13.2, 3.1, 17.0), (-61.0, -52.0, 16.3, 3.1, 16.0), (-60.5, -52.5, 19.4, 2.9, 20.0)]
    for x0, x1, y0, h, w in tiers:
        lm.rbox((x1 - x0, h, w), at=((x0 + x1) / 2, y0 + h / 2, 0.0), bevel=0.3, bseg=2, col=paint(C("#f2f0ea"), 0.1), mat="glossy")
        cols = int((x1 - x0 - 1.4) / 1.8)
        for sx in (-1, 1):
            for i in range(cols):
                lm.rbox((0.9, 0.9, 0.1), at=(x0 + 1.4 + i * 1.8 + 0.2, y0 + h * 0.55, sx * (w / 2 + 0.05)), col=WINDOW, mat="glow")
        for i in range(int((w - 2.0) / 1.8) + 1):
            lm.rbox((0.1, 0.9, 0.9), at=(x1 + 0.05, y0 + h * 0.55, -w / 2 + 1.4 + i * 1.8), col=WINDOW, mat="glow")
    lm.rbox((13.0, 0.5, 26.0), at=(-56.5, 22.5, 0.0), bevel=0.2, col=C("#d6d8de"), mat="lit")
    lm.cylinder(r=4.2, h=6.0, at=(-57.5, 22.0, 3.0), scale=(1.0, 1.0, 0.75), segs=24, rb=0.4, rt=0.5, col=faceted(lambda p, n: C("#2b2f38") if p.y > 27.0 else (WHITE if 24.3 < p.y < 25.4 else paint(RED, 0.18)(p, n))), mat="glossy")
    lm.rod((-55.0, 22.5, -2.0), (-55.0, 27.6, -2.0), 0.18, sides=6, col=DARK, mat="lit")
    bulb(lm, (-55.0, 27.7, -2.0), 0.4, (1.0, 1.0, 0.9))
    lm.rod((52.0, 9.4, 0.0), (52.0, 20.0, 0.0), 0.25, sides=6, col=DARK, mat="lit")
    bulb(lm, (52.0, 20.2, 0.0), 0.4, (1.0, 1.0, 0.9))
    for sg, c in ((1, GREEN_L), (-1, RED_L)):
        bulb(lm, (-56.5, 23.2, sg * 13.4), 0.45, c)
        bulb(lm, (66.0, 10.4, sg * 5.6), 0.4, c)
    # portholes along the hull
    for sg in (-1, 1):
        for i in range(34):
            x = -58.0 + i * 3.6
            t = (x + 70.0) / 144.0
            b = hull_half_beam(t)
            if b < 6:
                continue
            flare = 1.0 + 0.1 * smoothstep(0.5, 1.0, t)
            zs = b * (1.0 + 0.5 * (flare - 1.0) * 0.57) + 0.12
            lm.decal(Plane((x, 4.0, sg * zs), (0, 0, sg)), [(-0.4, -0.35), (0.4, -0.35), (0.4, 0.35), (-0.4, 0.35)], WINDOW, 0.05, "glow")
    # the ship's name, big on the bow
    return lm


BUILDERS["ship"] = ship
