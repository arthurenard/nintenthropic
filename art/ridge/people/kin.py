"""Kinematics for authoring clips: where the eyes, the mouth, the shoulder
pocket are for a torso pose, and which wrist targets put a prop exactly
where it must be.

charlib's clips give the hands IK targets and orientations by hand. Here the
prop comes first: a rifle is placed so its sights line up with the right eye
and its butt sits in the shoulder, binoculars on the eyes, a cigarette on the
lips, a steering wheel's rim in the fists - and both wrists are solved from
it (the right hand holds socket.gun, the left hand socket.hand.L, the mirror
of socket.gun on the left fist). So a hand never floats off what it holds.

Armature axes (charlib): x = his left, y = back, z = up; he faces -y. A pose
is a charlib pose dict ('root', bone Eulers, 'ik.hand.R', 'rot.hand.R'...).
"""
import math
import numpy as np
from mathutils import Matrix, Vector
from charlib import anim as A, hands as HN, head as HD
from charlib.skeleton import JOINTS

RIG = A.RIG
SOCK_R = np.array(HN.grip_socket_matrix(), float)
_SX = np.diag([-1.0, 1.0, 1.0, 1.0])
SOCK_L = _SX @ SOCK_R @ _SX
WRIST = {"R": np.array(JOINTS["hand.R"][0], float), "L": np.array(JOINTS["hand.L"][0], float)}
_eL, _eR = HD._eyes(HD.P())
EYE = {"L": HD.HEAD_ORIGIN + np.asarray(_eL, float), "R": HD.HEAD_ORIGIN + np.asarray(_eR, float)}
MOUTH = HD.HEAD_ORIGIN + np.array([0.0, -0.100, -0.066])
POCKET_R = np.array([-0.128, -0.100, 1.395])      # the hollow in front of the right shoulder a butt sits in
TORSO = ("hips", "spine", "chest", "neck", "head")


def v(x):
    return np.asarray(x, float)


def unit(x):
    x = v(x)
    return x / np.linalg.norm(x)


def torso_fk(pose):
    """(G, pos) for the torso bones of a pose (the arms do not move them)."""
    R = {b: A.E(*pose[b]) for b in TORSO if b in pose}
    return RIG.fk(R, Vector(pose.get("root", (0, 0, 0))))


def at(G, pos, bone, p_rest):
    """World position of a point rigidly carried by `bone`, given its rest position."""
    return v(pos[bone] + G[bone] @ (Vector(tuple(p_rest)) - RIG.head[bone]))


def rot(G, bone):
    return np.array(G[bone], float)


def eye(pose, side="R"):
    G, pos = torso_fk(pose)
    return at(G, pos, "head", EYE[side])


def frame(y, z_hint):
    """Rotation (columns X, Y, Z) with Y along y and Z as close to z_hint as possible."""
    Y = unit(y)
    Z = v(z_hint) - Y * (v(z_hint) @ Y)
    Z = unit(Z)
    return np.stack([np.cross(Y, Z), Y, Z], 1)


def euler(Rm):
    e = Matrix(Rm.tolist()).to_euler("XYZ")
    return tuple(math.degrees(a) for a in e)


def hand_for(side, T):
    """IK channels putting a hand's socket (socket.gun for R, socket.hand.L
    for L) at the world 4x4 T."""
    S0 = SOCK_R if side == "R" else SOCK_L
    Rh = T[:3, :3] @ S0[:3, :3].T
    wrist = T[:3, 3] - Rh @ (S0[:3, 3] - WRIST[side])
    return {f"ik.hand.{side}": tuple(wrist), f"rot.hand.{side}": euler(Rh)}


def hand_at(side, p, knuckles, back):
    """IK channels for a free hand: the fist's centre at p, the knuckles
    pointing along `knuckles`, the back of the hand facing `back` (a limp
    hand on the ground: back = down for palm up)."""
    Y = unit(knuckles)
    Xd = v(back) - Y * (v(back) @ Y)
    Xd = unit(Xd)
    X = Xd if side == "R" else -Xd          # socket.gun's X is the back of the hand, socket.hand.L's the palm
    Z = np.cross(X, Y)
    return hand_for(side, T_of(np.stack([X, Y, Z], 1), v(p)))


def T_of(Rm, p):
    T = np.eye(4)
    T[:3, :3] = Rm
    T[:3, 3] = p
    return T


def left_grip(Rrifle, p, palm=0.55):
    """socket.hand.L frame for a left fist closed round a rod running along
    the rifle's barrel at p: the rod through the fist (the thumb along it,
    forward), the palm under it turned `palm` (0 up .. 1 his right)."""
    Xr, Yr, Zr = Rrifle[:, 0], Rrifle[:, 1], Rrifle[:, 2]
    ZL = Yr
    XL = unit(math.cos(palm) * Zr + math.sin(palm) * Xr)
    YL = np.cross(ZL, XL)
    return T_of(np.stack([XL, YL, ZL], 1), p)


# ------------------------------------------------------------------ the rifle

RIFLE_EYE = (0.0, -0.150, 0.074)      # the aiming eye in the rifle's (grip) frame: over the comb, on the sight line
SCOPE_EYE = (0.0, -0.075, 0.096)       # behind the telescope's eyepiece
FOREND = (0.0, 0.305, 0.036)          # where the left fist holds the forend
BUTT = (0.0, -0.355, -0.043)


def rifle_at(pose, aim=(0, -1, 0), up=(0, 0, 1), eye_local=RIFLE_EYE, forend=FOREND, palm=0.55, cant=0.0):
    """Hands for a shouldered rifle: the sight line through the right eye
    along `aim`. Returns (channels, rifle world 4x4)."""
    e = eye(pose, "R")
    Rr = frame(aim, up)
    if cant:
        c, s = math.cos(math.radians(cant)), math.sin(math.radians(cant))
        X, Z = Rr[:, 0].copy(), Rr[:, 2].copy()
        Rr[:, 0], Rr[:, 2] = c * X + s * Z, -s * X + c * Z
    p = e - Rr @ v(eye_local)
    T = T_of(Rr, p)
    ch = hand_for("R", T)
    ch.update(hand_for("L", left_grip(Rr, T[:3, 3] + Rr @ v(forend), palm)))
    return ch, T


def rifle_held(T, forend=FOREND, palm=0.55, left=True):
    """Hands for a rifle placed at the world 4x4 T (carried, at the ready)."""
    ch = hand_for("R", T)
    if left:
        Rr = T[:3, :3]
        ch.update(hand_for("L", left_grip(Rr, T[:3, 3] + Rr @ v(forend), palm)))
    return ch


def rifle_T(grip, barrel, top):
    return T_of(frame(barrel, top), v(grip))


def butt_gap(pose, T):
    """How far the butt plate's centre is from the shoulder pocket (m), and
    that offset in the chest's frame - for tuning a shouldered pose."""
    G, pos = torso_fk(pose)
    pocket = at(G, pos, "chest", POCKET_R)
    b = T[:3, :3] @ v(BUTT) + T[:3, 3]
    return float(np.linalg.norm(b - pocket)), rot(G, "chest").T @ (b - pocket)


def with_hands(pose, ch):
    out = dict(pose)
    out.update(ch)
    return out


def chest_carry(pose):
    """The arms of a posed dict as chest-relative channels (ikc/rotc/pole),
    so the same hold - a rifle at the ready, a hand on a sling - can be put
    on any torso and ride it rigidly."""
    c = A.chestify(RIG, pose)
    out = {}
    for side in ("L", "R"):
        for k in (f"ikc.hand.{side}", f"rotc.hand.{side}", f"pole.hand.{side}", f"ikw.hand.{side}",
                  f"shoulder.{side}", f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"):
            if k in c:
                out[k] = c[k]
    return out


def solved(pose):
    """(G, pos) of every bone once a pose is solved."""
    c = A.chestify(RIG, pose)
    q, loc, G, pos = A.solve(RIG, c)
    return G, pos


def elbows(pose):
    """World position of both elbows once the pose is solved (the prone
    clips plant them on the ground)."""
    G, pos = solved(pose)
    return {s: v(pos[f"forearm.{s}"]) for s in ("L", "R")}
