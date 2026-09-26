"""Hands and forearms, sculpted in a pose (the rig has no finger bones).

The contract's rig stops at hand.L/R, so each hand is modelled holding the
pose it lives in: a bandit's right hand closed round a grip with the index
finger along the trigger guard, his left hand loosely curled; a townsman's
hands open enough to wave or go up. The forearm is part of the same mesh,
running up under the rolled sleeve.

Canonical frame (right hand): origin at the wrist joint, +Y toward the
knuckles, +Z toward the thumb (radial side), +X = Y x Z (the back of the hand).
Fingers flex toward -X. A left hand is the same sculpt mirrored in world X.
"""
import math
import numpy as np
from . import sdf as S
from .skeleton import JOINTS, hand_frame

# finger: (MCP position (x, y, z), phalanx lengths, radii at MCP and tip, splay deg)
FINGERS = {
    "index": ((0.0035, 0.093, 0.0285), (0.043, 0.025, 0.020), (0.0098, 0.0078), 6),
    "middle": ((0.0040, 0.097, 0.0090), (0.047, 0.029, 0.021), (0.0100, 0.0080), 1),
    "ring": ((0.0035, 0.093, -0.0105), (0.044, 0.028, 0.021), (0.0094, 0.0075), -3),
    "pinky": ((0.0025, 0.085, -0.0285), (0.034, 0.020, 0.018), (0.0083, 0.0068), -9),
}

POSES = {
    # flexion (MCP, PIP, DIP) per finger in degrees, thumb (spread, MCP, IP)
    "grip": dict(index=(38, 62, 26), middle=(82, 95, 45), ring=(86, 97, 45), pinky=(90, 95, 42), thumb=(55, 35, 25), open=0.0),
    "relaxed": dict(index=(18, 28, 14), middle=(24, 34, 16), ring=(28, 38, 18), pinky=(32, 40, 20), thumb=(30, 12, 10), open=0.3),
    "open": dict(index=(6, 10, 6), middle=(8, 12, 6), ring=(10, 14, 8), pinky=(12, 16, 8), thumb=(40, 8, 6), open=1.0),
}


def _rot(axis, deg):
    a = math.radians(deg)
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


def finger_chain(name, pose):
    """Joint positions of a finger (MCP, PIP, DIP, tip) in the hand frame."""
    (mx, my, mz), lens, rads, splay = FINGERS[name]
    fl = POSES[pose][name]
    d = _rot((1, 0, 0), splay * (0.5 + 0.5 * POSES[pose]["open"])) @ np.array([0, 1.0, 0])
    # flexion rotates about the knuckle line (Z), curling toward the palm (-X)
    pts = [np.array([mx, my, mz])]
    total = 0.0
    for L, f in zip(lens, fl):
        total += f
        R = _rot((0, 0, 1), total)
        pts.append(pts[-1] + R @ d * L)
    return pts, rads


def thumb_chain(pose):
    sp, f1, f2 = POSES[pose]["thumb"]
    cmc = np.array([-0.006, 0.020, 0.022])
    # the thumb leaves the palm heading distal, radial and palmar; `spread` swings it across the palm
    d0 = np.array([-0.30, 0.72, 0.62])
    d0 = _rot((0, 1, 0), -sp * 0.6) @ d0
    d0 /= np.linalg.norm(d0)
    p1 = cmc + d0 * 0.046
    axis = np.cross(d0, np.array([-1.0, 0, 0]))
    axis /= np.linalg.norm(axis)
    d1 = _rot(axis, f1) @ d0
    p2 = p1 + d1 * 0.031
    d2 = _rot(axis, f1 + f2) @ d0
    p3 = p2 + d2 * 0.026
    return [cmc, p1, p2, p3]


def hand_sdf(pose="relaxed", scale=1.0, female=0.0, forearm_len=0.19, sleeve="rolled"):
    """The right hand (and forearm) in the canonical frame."""
    parts = []
    k = 0.012
    fs = 1 - 0.1 * female
    # palm: a rounded slab, thicker at the heel of the hand
    palm = S.Box((-0.001, 0.052, -0.001), (0.005 * fs, 0.034, 0.030 * fs), None, rad=0.0105)
    thenar = S.Ellipsoid((-0.009, 0.036, 0.020), (0.012, 0.026, 0.014), S.rot_x(-20))
    hypo = S.Ellipsoid((-0.007, 0.046, -0.027), (0.010, 0.032, 0.010))
    heel = S.Ellipsoid((-0.004, 0.012, -0.003), (0.015, 0.018, 0.030))
    parts += [palm, thenar, hypo, heel]
    # forearm: flattened, widening toward the elbow
    fa = S.Tube([(0, -forearm_len, 0), (0, -0.12, 0), (0, -0.05, 0), (0, 0.0, 0), (0, 0.012, 0)],
                [0.037 * fs, 0.035 * fs, 0.027 * fs, 0.020 * fs, 0.019 * fs],
                [0.047 * fs, 0.045 * fs, 0.037 * fs, 0.030 * fs, 0.031 * fs], side=(1, 0, 0))
    parts.append(fa)
    # wrist bones: the ulnar head's bump
    parts.append(S.Sphere((0.006, -0.012, -0.024), 0.0075))
    hand = S.Union(parts, k=0.016)
    fingers = []
    nails = []
    for name in FINGERS:
        pts, (r0, r1) = finger_chain(name, pose)
        rr = np.linspace(r0, r1, 4) * fs
        for i in range(3):
            fingers.append(S.RoundCone(pts[i], pts[i + 1], rr[i], rr[i + 1]))
        # knuckles on the back of the hand
        fingers.append(S.Sphere(pts[0] + np.array([0.004, -0.004, 0]), rr[0] * 0.95))
        # the pad and the nail of the last joint
        tip_dir = pts[3] - pts[2]
        tip_dir /= np.linalg.norm(tip_dir)
        back = np.cross(np.array([0, 0, 1.0]), tip_dir)  # toward the back of the finger
        nails.append((pts[2] + tip_dir * 0.011 + back * rr[3] * 0.72, tip_dir, back, rr[3]))
    tpts = thumb_chain(pose)
    tr = np.array([0.012, 0.011, 0.0095, 0.0082]) * fs
    for i in range(3):
        fingers.append(S.RoundCone(tpts[i], tpts[i + 1], tr[i], tr[i + 1]))
    tdir = tpts[3] - tpts[2]
    tdir /= np.linalg.norm(tdir)
    tback = np.cross(tdir, tpts[2] - tpts[1])
    tback = np.array([0.6, 0.0, 0.8]) if np.linalg.norm(tback) < 1e-6 else tback / np.linalg.norm(tback)
    nails.append((tpts[2] + tdir * 0.013 + tback * tr[3] * 0.7, tdir, tback, tr[3]))
    fingers.append(S.Ellipsoid((-0.004, 0.030, 0.030), (0.010, 0.020, 0.010)))  # web of the thumb
    hand = S.Union([hand] + fingers, k=0.0045)
    nail_nodes = []
    for c, t, b, r in nails:
        side = np.cross(t, b)
        R = np.stack([side, t, b], 1)
        nail_nodes.append(S.Ellipsoid(c, (r * 0.78, r * 1.05, r * 0.28), R))
    hand = S.Union([hand] + nail_nodes, k=0.0015)
    return hand, nails


def grip_socket_local():
    """Centre of the fist and the gun's orientation in the canonical frame:
    barrel along +Y (with the forearm), top of the gun toward the thumb (+Z)."""
    c = np.array([-0.018, 0.078, 0.004])
    Rg = np.eye(3)
    return c, Rg


def world_xform(side):
    """(M, o): local = (world - o) @ M, world = local @ M.T + o. The left hand
    is the right one mirrored in X (det M = -1)."""
    o, H = hand_frame("R")
    if side == "R":
        return H.copy(), o.copy()
    Sx = np.diag([-1.0, 1.0, 1.0])
    return Sx @ H, o * np.array([-1.0, 1, 1])


def grip_socket_matrix():
    """World 4x4 of socket.gun in the rest pose."""
    c, Rg = grip_socket_local()
    M, o = world_xform("R")
    pos = c @ M.T + o
    rot = M @ Rg  # local axes to world
    T = np.eye(4)
    T[:3, :3] = rot
    T[:3, 3] = pos
    return T


def nail_mask(P, nails):
    m = np.zeros(len(P))
    for c, t, b, r in nails:
        q = P - c
        side = np.cross(t, b)
        e = (q @ side / (r * 0.85)) ** 2 + (q @ t / (r * 1.1)) ** 2 + ((q @ b - r * 0.15) / (r * 0.6)) ** 2
        m = np.maximum(m, np.clip(1.3 - e, 0, 1))
    return np.clip(m * 1.5, 0, 1)
