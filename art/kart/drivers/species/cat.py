"""Mango the cat: pointed ears through the helmet, tabby stripes, whiskers, and a tall tail that curls."""
import numpy as np

import sdflib as S
import shared as H
from rig import Part

FUR = H.lin("#ffae42")
STRIPE = H.lin("#d9701c")
CREAM = H.lin("#ffe9c7")
PINK = H.lin("#f59fb0")


def ear_shape():
    cone = S.roundcone((0.17, 0.2, -0.02), (0.245, 0.55, -0.055), 0.12, 0.012)
    return S.scaled(cone, (1, 1, 0.5), about=(0.21, 0.37, -0.04))


def stripe_piece(part, face, x, y, length, ang, thick=0.0115, width=0.0):
    """A dark tabby stripe laid on the face at (x, y), `ang` degrees off vertical: a short tapered tube pressed into the fur."""
    a = np.radians(ang)
    t = np.array([-1.0, 0.0, 1.0])
    xs = x + np.sin(a) * length * t
    ys = y + np.cos(a) * length * t
    pts = S.surface_point(face, xs, ys)
    pts = pts + S.normals(face, pts) * -0.002
    v, nn, fc = S.tube(pts, [thick * 0.35, thick, thick * 0.35], 4)
    part.mesh(v, nn, fc, "fur", STRIPE)


def build():
    parts = []
    skull = S.ellipsoid((0, 0, 0), (0.3, 0.26, 0.27))
    cheeks = S.mirror(S.ellipsoid((0.19, -0.09, 0.1), (0.12, 0.1, 0.14)))
    muzzle = S.ellipsoid((0, -0.08, 0.235), (0.1, 0.07, 0.075))
    face = S.union(skull, cheeks, muzzle, k=0.04)
    ears = S.mirror(ear_shape())
    head = S.union(face, ears, k=0.03)

    def albedo(P, N):
        out = np.tile(FUR, (len(P), 1))
        out = S.mix(out, STRIPE, S.smoothstep(0.43, 0.54, P[:, 1]) * (np.abs(P[:, 0]) > 0.12) * 0.8)
        return out * H.furvar(P, 0.03)

    h = Part("cat", "head", H.HEAD_AT)
    h.solid(head, (-0.46, -0.3, -0.38), (0.46, 0.7, 0.46), h=0.0085, tris=660, albedo=albedo, mat="fur", ao=0.45, reach=0.09)
    pads = S.union(S.mirror(S.ellipsoid((0.058, -0.1, 0.25), (0.082, 0.064, 0.078))), S.ellipsoid((0, -0.125, 0.245), (0.07, 0.05, 0.08)), k=0.02)
    face2 = S.union(face, pads, k=0.0)
    h.solid(pads, (-0.25, -0.3, 0.0), (0.25, 0.1, 0.4), h=0.0055, tris=150, albedo=CREAM, mat="fur", ao=0.4, reach=0.05)
    inner = S.mirror(S.scaled(S.roundcone((0.185, 0.27, -0.01), (0.235, 0.47, -0.04), 0.07, 0.012), (1, 1, 0.45), about=(0.21, 0.37, -0.03)))
    h.solid(inner, (-0.4, 0.1, -0.25), (0.4, 0.6, 0.1), h=0.005, tris=70, albedo=PINK, mat="fur", ao=0.3, reach=0.04)
    nose = S.ellipsoid((0, -0.047, 0.318), (0.034, 0.026, 0.022))
    h.solid(nose, (-0.1, -0.12, 0.2), (0.1, 0.05, 0.42), h=0.004, tris=44, albedo=PINK * 0.85, mat="gloss", ao=0.2, reach=0.03)
    ez = float(S.surface_point(face, [0.115], [0.055])[0, 2]) - 0.005
    H.eyes(h, 0.115, 0.055, ez, r=0.047, iris="#6ec23e", turn=0.24)
    # Forehead stripes and cheek stripes.
    for sx in (-1, 1):
        stripe_piece(h, face, sx * 0.06, 0.18, 0.05, 8 * sx)
        stripe_piece(h, face, sx * 0.13, 0.17, 0.04, 28 * sx, width=0.017)
        stripe_piece(h, face, sx * 0.268, -0.045, 0.026, 80 * sx, width=0.014)
        H.brow(h, face, sx * 0.115, 0.125, length=0.07, slant=0.3, arch=0.01, r=0.0075, colour=STRIPE * 0.55)
    stripe_piece(h, face, 0.0, 0.2, 0.05, 0, width=0.016)
    # The mouth is drawn live by the game (src/kart/render/drivers/expression.ts).
    H.whiskers(h, face2, 0.12, -0.09, length=0.2, count=2, spread=0.04)
    parts.append(h)

    parts.append(H.helmet("cat", (0, 0.05, -0.01), (0.31, 0.28, 0.29), ear_holes=S.offset(ears, 0.013)))
    parts.append(H.torso("cat", w=0.24, d=0.19, shoulder=0.27, shoe="#ffe9c7", shoe_mat="fur"))
    for side in (1, -1):
        parts.append(H.arm("cat", side, 0.27, r=0.066, fur=FUR, glove=CREAM, glove_mat="fur"))

    # A tail that rises behind the seat and curls over, rings of stripe.
    tail = Part("cat", "tail", (0.0, 0.12, -0.24))
    pts = [(0, 0.0, -0.07), (0, 0.08, -0.14), (0, 0.17, -0.19), (0, 0.27, -0.21), (0, 0.37, -0.2), (0, 0.46, -0.16), (0, 0.53, -0.09)]
    rad = [0.095, 0.092, 0.09, 0.088, 0.086, 0.084, 0.082]
    curl = S.union(S.chain(pts, rad, k=0.0), S.ellipsoid((0, 0.545, -0.075), (0.085, 0.085, 0.085)), k=0.03)

    def tail_albedo(P, N):
        out = np.tile(FUR, (len(P), 1))
        ring = S.smoothstep(-0.2, 0.2, np.sin((P[:, 1] + 0.02) * 2 * np.pi / 0.115) * 1.0)
        out = S.mix(out, STRIPE, ring * 0.9 * S.smoothstep(0.02, 0.08, P[:, 1]))
        out = S.mix(out, CREAM, S.smoothstep(0.52, 0.58, P[:, 1]) * 0.9)
        return out * H.furvar(P, 0.04)

    tail.solid(curl, (-0.2, -0.2, -0.4), (0.2, 0.7, 0.2), h=0.008, tris=240, albedo=tail_albedo, mat="fur", ao=0.4, reach=0.07)
    parts.append(tail)
    return parts
