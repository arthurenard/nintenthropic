"""Kit the fox: a sharp snout, tall dark-tipped ears through the helmet, big cream cheeks, a brush of a tail with a white tip."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

ORANGE = H.lin("#ee7f2d")
DEEP = H.lin("#d9631c")
CREAM = H.lin("#fff0da")
DARK = H.lin("#3f2620")
PINKY = H.lin("#f6b9a5")


def furvar(P, s=0.07):
    return 1.0 - s + s * 1.6 * (S.noise(P, 9.0, 3.1) * 0.6 + S.noise(P, 21.0, 8.7) * 0.4)[:, None]


def ear_shape():
    base, tip = (0.155, 0.19, -0.035), (0.265, 0.6, -0.105)
    cone = S.roundcone(base, tip, 0.118, 0.012)
    return S.scaled(cone, (1, 1, 0.42), about=(0.21, 0.4, -0.07))


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.29, 0.262, 0.272))
    cheeks = S.mirror(S.ellipsoid((0.2, -0.105, 0.085), (0.118, 0.098, 0.155), rot=(-12, 0, 0)))
    muzzle = S.ellipsoid((0, -0.055, 0.268), (0.098, 0.078, 0.128))
    jaw = S.ellipsoid((0, -0.108, 0.25), (0.086, 0.05, 0.105))
    ruffs = S.mirror(S.scaled(S.roundcone((0.17, -0.1, 0.12), (0.37, -0.18, -0.04), 0.115, 0.014), (1, 1, 0.8), about=(0.2, -0.1, 0.1)))
    face = S.union(skull, cheeks, muzzle, jaw, k=0.045)
    face_r = S.union(face, ruffs, k=0.05)
    ears = S.mirror(ear_shape())
    head = S.union(face_r, ears, k=0.03)
    mask = S.ellipsoid((0, 0.125, 0.15), (0.2, 0.1, 0.16))
    cream = S.union(S.mirror(S.ellipsoid((0.235, -0.125, 0.07), (0.14, 0.105, 0.2), rot=(-12, 0, 0))), S.ellipsoid((0, -0.14, 0.24), (0.115, 0.075, 0.14)), ruffs, k=0.03)

    def albedo(P, N):
        out = np.tile(ORANGE, (len(P), 1))
        out = S.mix(out, DEEP, S.inside(mask, 0.06)(P) * 0.55)
        out = S.mix(out, CREAM, S.inside(cream, 0.022)(P))
        out = S.mix(out, DARK, S.smoothstep(0.43, 0.52, P[:, 1]) * (np.abs(P[:, 0]) > 0.1))
        return out * furvar(P)

    h = Part("fox", "head", H.HEAD_AT)
    h.solid(head, (-0.46, -0.28, -0.42), (0.46, 0.7, 0.5), h=0.0085, tris=1050, albedo=albedo, mat="fur", ao=0.5, reach=0.09)
    inner = S.mirror(S.scaled(S.roundcone((0.19, 0.27, -0.03), (0.255, 0.54, -0.085), 0.075, 0.01), (1, 1, 0.5), about=(0.2, 0.35, -0.055)))
    h.solid(inner, (-0.4, 0.1, -0.25), (0.4, 0.7, 0.1), h=0.005, tris=90, albedo=PINKY, mat="fur", ao=0.3, reach=0.04)
    nose = S.ellipsoid((0, -0.03, 0.392), (0.046, 0.036, 0.033))
    h.solid(nose, (-0.1, -0.12, 0.3), (0.1, 0.08, 0.5), h=0.005, tris=60, albedo=DARK * 0.5, mat="gloss", ao=0.2, reach=0.03)
    # eyes, brows, a small smile
    ez = float(S.surface_point(face, [0.118], [0.058])[0, 2]) - 0.006
    H.eyes(h, 0.118, 0.058, ez, r=0.043, iris="#d98a1c", turn=0.3)
    for sx in (-1, 1):
        H.brow(h, head, sx * 0.118, 0.128, length=0.085, slant=0.3, arch=0.012, colour=DARK * 0.9)
    H.smile(h, face, half=0.075, y=-0.112, depth=0.02, r=0.0058, colour=DARK, n=9)
    parts.append(h)

    parts.append(H.helmet("fox", (0, 0.05, -0.01), (0.307, 0.282, 0.292), ear_holes=S.offset(ears, 0.012)))
    parts.append(H.torso("fox", w=0.25, d=0.19, shoulder=0.28, shoe="#3f2620"))
    for side in (1, -1):
        parts.append(H.arm("fox", side, 0.28, r=0.068, fur=ORANGE, glove=DARK, glove_mat="fur", handR=0.095))

    # ---- the brush
    t = Part("fox", "tail", (0.0, 0.2, -0.26))
    brush = S.union(
        S.ellipsoid((0, 0.0, -0.12), (0.115, 0.115, 0.17)),
        S.ellipsoid((0, 0.04, -0.32), (0.155, 0.155, 0.22)),
        S.ellipsoid((0, 0.1, -0.53), (0.115, 0.115, 0.17)),
        S.roundcone((0, 0.1, -0.55), (0, 0.13, -0.7), 0.09, 0.012),
        k=0.07,
    )

    def tail_albedo(P, N):
        out = np.tile(ORANGE, (len(P), 1))
        out = S.mix(out, DEEP, S.smoothstep(-0.2, -0.45, P[:, 2]) * 0.4)
        out = S.mix(out, CREAM, S.smoothstep(-0.50, -0.58, P[:, 2]))
        return out * furvar(P)

    t.solid(brush, (-0.26, -0.22, -0.8), (0.26, 0.3, 0.06), h=0.01, tris=300, albedo=tail_albedo, mat="fur", ao=0.45, reach=0.1)
    parts.append(t)
    return parts
