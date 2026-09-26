"""Leather and iron: boots, belts, the holster. Rigid pieces, sculpted and decimated.

All in world space around the shared skeleton. Boots are built for one side
and mirrored, so the pair is identical.
"""
import math
import numpy as np
from . import sdf as S
from .skeleton import JOINTS


def _j(n, e=0):
    return np.array(JOINTS[n][e], float)


def boot_sdf(side="L", top=0.40, heel=0.038, toe="narrow", shaft_r=0.052, spur=True):
    """A riding boot: pointed toe, an underslung riding heel, a tall shaft
    with a dipped top and pull straps."""
    s = 1.0 if side == "L" else -1.0
    X = lambda p: np.array([s * p[0], p[1], p[2]])
    an = _j("foot.L")
    x0 = an[0]
    parts = []
    # sole: a thin plate under the whole foot, pointed at the toe
    sole = S.Tube([X((x0, 0.070, 0.010)), X((x0, 0.0, 0.010)), X((x0 + 0.004, -0.09, 0.009)), X((x0 + 0.006, -0.155, 0.009)), X((x0 + 0.006, -0.195, 0.011))],
                  [0.036, 0.038, 0.046, 0.042, 0.012], [0.010, 0.010, 0.009, 0.009, 0.008], side=(1, 0, 0))
    parts.append(sole)
    # heel block: taller at the back, sloping under the arch
    heelb = S.Box(X((x0, 0.047, heel * 0.5)), (0.029, 0.024, heel * 0.5), S.rot_x(-8), rad=0.004)
    parts.append(heelb)
    # the foot inside: instep rising to the ankle, narrowing to the toe
    vamp = S.Tube([X((x0, 0.050, 0.085)), X((x0, 0.012, 0.080)), X((x0 + 0.002, -0.040, 0.060)),
                   X((x0 + 0.004, -0.095, 0.040)), X((x0 + 0.006, -0.150, 0.033)), X((x0 + 0.006, -0.185, 0.027))],
                  [0.038, 0.040, 0.044, 0.046, 0.034, 0.014], [0.048, 0.050, 0.040, 0.026, 0.020, 0.012], side=(1, 0, 0))
    parts.append(vamp)
    counter = S.Ellipsoid(X((x0, 0.050, 0.070)), (0.035, 0.034, 0.050))
    parts.append(counter)
    # shaft: follows the shin, flares a little at the top
    kn = _j("shin.L")
    d = (kn - an) / np.linalg.norm(kn - an)
    t_top = (top - an[2]) / d[2]
    p_top = an + d * t_top
    shaft = S.RoundCone(X(an + np.array([0, 0.012, -0.01])), X(p_top), shaft_r - 0.004, shaft_r + 0.004)
    parts.append(shaft)
    boot = S.Union(parts, k=0.012)
    # dip the top: a shallow V at front and back
    def cut(P):
        q = P - X(p_top)
        return (q[:, 2] + 0.012 * (1 - np.abs(q[:, 0] * s) / 0.06) ** 2 * (np.abs(q[:, 0]) < 0.06) - 0.004).astype(np.float32)
    boot = S.Intersect(boot, S.Fn(cut, (-1, -1, -1), (1, 1, p_top[2] + 0.05)))
    extras = []
    # pull straps: two small loops above the rim at the sides
    for sd in (1, -1):
        c = X(p_top + np.array([sd * 0.052, 0.0, 0.006]))
        extras.append(S.Torus(c, 0.011, 0.0022, S.rot_y(90) if True else None))
    if spur:
        # spur: a strap over the instep and a rowel behind the heel
        extras.append(S.Torus(X((x0, 0.030, 0.050)), 0.047, 0.0035, S.rot_x(-35)))
        extras.append(S.RoundCone(X((x0, 0.080, 0.045)), X((x0, 0.098, 0.043)), 0.004))
        extras.append(S.Cylinder(X((x0, 0.104, 0.043)), 0.013, 0.0012, S.rot_y(90), rad=0.0006))
    boot = S.Union([boot] + extras, k=0.002)
    # the shaft is open at the top so the trousers can be seen going in
    hole = S.RoundCone(X(p_top - d * 0.035), X(p_top + d * 0.03), shaft_r - 0.006, shaft_r - 0.003)
    boot = S.Subtract(boot, hole, k=0.002)
    return boot, p_top


def boot_paint_zones(P, side="L"):
    """(sole, heel side, stitched shaft, spur metal) masks."""
    s = 1.0 if side == "L" else -1.0
    x = P[:, 0] * s
    sole = (P[:, 2] < 0.017).astype(float)
    return sole


def belt_sdf(z_front, z_back, width, thick=0.006, rx=0.170, ry=0.124, cy=0.008, tilt_x=0.0):
    """A belt: a band of leather around an ellipse, tilted (a gun belt rides
    lower on the holster side). Returns the band field."""
    def f(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        th = np.arctan2(x, -(y - cy))
        # height of the belt's centre line around the body
        zc = 0.5 * (z_front + z_back) + 0.5 * (z_front - z_back) * np.cos(th) + tilt_x * np.sin(th)
        r = np.sqrt((x / rx) ** 2 + ((y - cy) / ry) ** 2)
        rr = (r - 1.0) * min(rx, ry)
        band = np.maximum(np.abs(rr - thick * 0.5) - thick * 0.5, np.abs(z - zc) - width * 0.5)
        return band.astype(np.float32)
    m = max(rx, ry) + 0.03
    return S.Fn(f, (-m, cy - m, min(z_front, z_back) - width - abs(tilt_x) - 0.01), (m, cy + m, max(z_front, z_back) + width + abs(tilt_x) + 0.01))


def gunbelt(bp=None):
    """A cartridge belt slung low, higher on the left hip, dropping to a
    holster on the right thigh, with a revolver butt showing."""
    band = belt_sdf(0.965, 0.985, 0.052, 0.007, rx=0.184, ry=0.136, cy=0.010, tilt_x=0.022)
    # cartridge loops: a row of small bumps along the back and sides
    def loops(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        th = np.arctan2(x, -(y - 0.010))
        zc = 0.975 + 0.010 * np.cos(th) + 0.022 * np.sin(th)
        rowed = np.abs(z - zc) < 0.020
        bump = 0.0028 * (0.5 + 0.5 * np.cos(th * 34)) * rowed * (np.abs(th) > 0.9)
        return -bump.astype(np.float32)
    band = S.Displace(band, loops, 0.004)
    buckle = S.Box((0.0, -0.142, 0.955), (0.030, 0.004, 0.024), S.rot_x(4), rad=0.003)
    # holster: a leather pocket on the right thigh, hanging from the belt
    hx, hy = -0.185, -0.012
    hol = S.Tube([(hx, hy, 0.965), (hx - 0.004, hy - 0.004, 0.90), (hx - 0.008, hy - 0.010, 0.82), (hx - 0.010, hy - 0.016, 0.745)],
                 [0.020, 0.024, 0.020, 0.013], [0.030, 0.036, 0.030, 0.020], side=(1, 0, 0))
    # the gun in it: grip and hammer above the holster mouth
    grip = S.RoundCone((hx - 0.001, hy + 0.030, 0.985), (hx + 0.001, hy + 0.058, 1.030), 0.012, 0.015)
    frame = S.Box((hx, hy + 0.004, 0.972), (0.012, 0.028, 0.018), S.rot_x(-15), rad=0.004)
    tie = S.Torus((hx + 0.03, hy - 0.005, 0.79), 0.07, 0.003, S.rot_x(8))
    tie = S.Intersect(tie, S.Box((hx + 0.08, hy, 0.79), (0.07, 0.1, 0.02)))
    return S.Union([band, buckle], k=0.002), S.Union([hol, tie], k=0.004), S.Union([grip, frame], k=0.004)


def trouser_belt():
    band = belt_sdf(1.052, 1.060, 0.036, 0.005, rx=0.166, ry=0.121, cy=0.005)
    buckle = S.Box((0.0, -0.126, 1.052), (0.024, 0.0035, 0.020), None, rad=0.003)
    return S.Union([band, buckle], k=0.002)
