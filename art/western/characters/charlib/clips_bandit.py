"""The Carver gang's clips: how a gunman hides, shows himself, shoots and dies.

Everything is in place (the feet never leave the character's origin area
unless the clip is a run or a fall) and every emerge clip ends exactly on the
AIM pose, every hide clip starts on it, so the game can chain
  hidden -> rise / lean_*_out / step_out -> aim -> fire -> sink / lean_*_in / step_in
with short crossfades and nothing pops.

Armature axes: x = his left, y = backward, z = up; he faces -y.
"""
import math
from .anim import Clip, hand_rot

# ------------------------------------------------------------------ key poses

AIM_ROT = hand_rot("R", (0.0, -1.0, 0.0), (0.0, 0.0, 1.0))           # gun level, straight ahead
UP_ROT = hand_rot("R", (0.05, -0.25, 1.0), (0.0, 1.0, 0.0))          # muzzle up by the shoulder
LOW_ROT = hand_rot("R", (0.0, -0.55, -0.85), (0.0, -0.8, 0.5))        # muzzle down, ahead of the boot

STANCE = {
    "ik.foot.L": (0.125, -0.075, 0.102), "rot.foot.L": (0, 0, 16), "pole.foot.L": (0.25, -1, 0),
    "ik.foot.R": (-0.130, 0.085, 0.102), "rot.foot.R": (0, 0, 30), "pole.foot.R": (-0.05, -1, 0),
}


def P(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    for k, v in kw.items():
        out[k.replace("__", ".")] = v
    return out


# the fighting stance: bladed a third of a turn, arm out, eye down the barrel
AIM = P(STANCE, root=(0.0, 0.012, -0.032), hips=(0, 0, 18), spine=(2, 0, 5), chest=(-3, -2, 10),
        neck=(0, 0, -13), head=(7, 3, -15),
        shoulder__R=(0, 0, -4), ik__hand__R=(-0.055, -0.60, 1.425), rot__hand__R=AIM_ROT, pole__hand__R=(-0.6, 0.4, -0.7),
        shoulder__L=(0, 0, 0), upper_arm__L=(6, 36, 6), forearm__L=(-22, 0, 0), hand__L=(0, 8, 0))

# relaxed: weight on the left leg, revolver hanging in the right hand
IDLE = P({"ik.foot.L": (0.105, -0.02, 0.102), "rot.foot.L": (0, 0, 9), "pole.foot.L": (0.1, -1, 0),
          "ik.foot.R": (-0.115, 0.035, 0.102), "rot.foot.R": (0, 0, -9), "pole.foot.R": (-0.1, -1, 0)},
         root=(0.022, 0.004, -0.012), hips=(0, -3, 4), spine=(1, 2, -3), chest=(-1, 1, -3), neck=(2, 0, 3), head=(4, -1, 3),
         shoulder__R=(0, 0, 0), upper_arm__R=(-8, -37, 0), forearm__R=(-24, 0, 0), hand__R=(-10, 0, 0),
         shoulder__L=(0, 0, 0), upper_arm__L=(-4, 35, 2), forearm__L=(-18, 0, 0), hand__L=(0, 6, 0))

# crouched behind cover, gun up by the shoulder, looking up at the lip of it
CROUCH = P({"ik.foot.L": (0.165, -0.03, 0.102), "rot.foot.L": (0, 0, 14), "pole.foot.L": (0.45, -1, 0),
            "ik.foot.R": (-0.140, 0.07, 0.102), "rot.foot.R": (0, 0, -12), "pole.foot.R": (-0.45, -1, 0)},
           root=(0.0, 0.09, -0.43), hips=(22, 0, 0), spine=(18, 0, 0), chest=(12, 0, 2), neck=(-22, 0, 0), head=(-10, 0, 0),
           shoulder__R=(0, 0, 8), ikc__hand__R=(-0.13, -0.17, 1.30), rotc__hand__R=UP_ROT, pole__hand__R=(-0.4, 0.5, -0.8),
           ik__hand__L=(0.17, -0.24, 0.56), rot__hand__L=(-40, 0, 10), pole__hand__L=(0.5, 0.3, -0.5))

# half-hidden behind a corner on his right: torso and head displaced to his
# right, gun up and ready - the start of lean_left_out
LEAN_HIDE_L = P(STANCE, root=(-0.15, 0.02, -0.05), hips=(0, -6, 12), spine=(4, -14, 4), chest=(2, -12, 6),
                neck=(0, 10, -6), head=(4, 10, -8),
                shoulder__R=(0, 0, 4), ikc__hand__R=(-0.12, -0.16, 1.33), rotc__hand__R=UP_ROT, pole__hand__R=(-0.5, 0.5, -0.7),
                upper_arm__L=(10, 30, 0), forearm__L=(-40, 0, 0), hand__L=(0, 6, 0))


ARM_KEYS = ("shoulder", "upper_arm", "forearm", "hand.", "ik.hand", "ikc.hand", "rot.hand", "rotc.hand", "pole.hand")


def mirror_pose(p, arms=False):
    """Mirror a pose left <-> right (for lean_right_* from lean_left_*). The gun
    stays in his right hand, so by default the arms are left as they are - the
    right hand's target is chest-relative and follows the mirrored torso."""
    out = {}
    for k, v in p.items():
        is_arm = any(k.startswith(a) for a in ARM_KEYS)
        if is_arm and not arms:
            out[k] = v
            continue
        k2 = k.replace(".L", ".TMP").replace(".R", ".L").replace(".TMP", ".R")
        v = list(v)
        if k.startswith("ik") or k == "root" or k.startswith("pole"):
            v[0] = -v[0]
        else:
            # rotations: mirror across the x = 0 plane -> negate y and z angles
            v = [v[0], -v[1], -v[2]]
        out[k2] = tuple(v)
    return out


# ------------------------------------------------------------------ layers

def breathe(amp=1.0, period=None):
    def layer(t, pose, amp=amp, period=period):
        per = period or 3.0
        s = math.sin(2 * math.pi * t / per)
        for b, a in (("chest", 1.3), ("spine", 0.4), ("neck", -0.8)):
            if b in pose:
                x, y, z = pose[b]
                pose[b] = (x - a * amp * s, y, z)
        if "root" in pose:
            x, y, z = pose["root"]
            pose["root"] = (x, y, z + 0.0025 * amp * s)
    return layer


def sway(amp=1.0, period=3.0, seed=0.0):
    """Slow weight drift and a searching head (loops: period divides the clip)."""
    def layer(t, pose):
        a = 2 * math.pi * t / period
        if "root" in pose:
            x, y, z = pose["root"]
            pose["root"] = (x + 0.006 * amp * math.sin(a + seed), y + 0.004 * amp * math.sin(2 * a + 1 + seed), z)
        if "head" in pose:
            x, y, z = pose["head"]
            pose["head"] = (x + 1.5 * amp * math.sin(2 * a + 2 + seed), y, z + 4.0 * amp * math.sin(a + 0.7 + seed))
    return layer


def aim_wobble(amp=1.0, period=1.0):
    """The tiny hunt of a gun held at arm's length."""
    def layer(t, pose):
        a = 2 * math.pi * t / period
        if "ikc.hand.R" in pose:
            x, y, z = pose["ikc.hand.R"]
            pose["ikc.hand.R"] = (x + 0.004 * amp * math.sin(a + 0.3), y, z + 0.005 * amp * math.sin(2 * a))
    return layer


# ------------------------------------------------------------------ clips

def idle():
    c = Clip("idle", 3.0, loop=True)
    c.pose(0.0, IDLE)
    # a small weight transfer and a glance down the street, back to the start
    mid = dict(IDLE)
    mid.update({"root": (0.012, 0.0, -0.016), "hips": (0, -1, 2), "head": (2, 0, -6), "neck": (2, 0, -3)})
    c.pose(1.5, mid, "inout")
    c.pose(3.0, IDLE, "inout")
    c.layers += [breathe(1.0, 3.0), sway(0.8, 3.0)]
    return c


def aim():
    c = Clip("aim", 1.0, loop=True)
    c.pose(0.0, AIM)
    c.pose(1.0, AIM)
    c.layers += [breathe(0.6, 1.0), aim_wobble(1.0, 1.0)]
    return c


def fire():
    """Recoil: the muzzle kicks up and back through the wrist and elbow, the
    shoulders take it, the head blinks; then the arm settles back on target."""
    c = Clip("fire", 0.36)
    kick = dict(AIM)
    kick.update({"ik.hand.R": (-0.05, -0.545, 1.475), "rot.hand.R": hand_rot("R", (0, -0.78, 0.62), (0, 0.62, 0.78)),
                 "chest": (-6, -2, 12), "head": (2, 3, -15), "root": (0.0, 0.02, -0.03), "shoulder.R": (0, 0, -1)})
    c.pose(0.0, AIM)
    c.pose(0.04, kick, "snap")
    over = dict(AIM)
    over.update({"ik.hand.R": (-0.056, -0.605, 1.418), "chest": (-2, -2, 9.5)})
    c.pose(0.20, over, "inout")
    c.pose(0.36, AIM, "inout")
    return c


def hidden():
    c = Clip("hidden", 2.0, loop=True)
    c.pose(0.0, CROUCH)
    look = dict(CROUCH)
    look.update({"head": (-14, 4, 10), "neck": (-22, 0, 6)})
    c.pose(0.9, look, "inout")
    c.pose(2.0, CROUCH, "inout")
    c.layers += [breathe(1.8, 1.0)]    # breathing hard: two breaths a loop
    return c


def rise():
    """Up from behind a barrel: a push through the legs, the gun comes up
    last, overshoots a hair and settles on target."""
    c = Clip("rise", 0.40)
    c.pose(0.0, CROUCH)
    dip = dict(CROUCH)
    dip.update({"root": (0.0, 0.095, -0.45), "spine": (21, 0, 0)})
    c.pose(0.05, dip, "inout")
    mid = dict(AIM)
    mid.update({"root": (0.0, 0.03, -0.09), "spine": (8, 0, 4), "chest": (2, -2, 8), "head": (0, 3, -12)})
    c.pose(0.22, mid, "out")
    top = dict(AIM)
    top.update({"root": (0.0, 0.010, -0.022)})
    c.pose(0.31, top, "inout")
    c.pose(0.40, AIM, "inout")
    c.lag.update({"ikc.hand.R": 0.03, "rotc.hand.R": 0.03, "head": 0.02})
    return c


def sink():
    c = Clip("sink", 0.34)
    c.pose(0.0, AIM)
    drop = dict(CROUCH)
    drop.update({"root": (0.0, 0.085, -0.46)})
    c.pose(0.24, drop, "in2")
    c.pose(0.34, CROUCH, "out")
    c.lag.update({"head": -0.02})
    return c


def lean_out(side="L"):
    """From behind a corner, lean out toward his `side` into the aim."""
    hide = LEAN_HIDE_L if side == "L" else mirror_pose(LEAN_HIDE_L)
    name = f"lean_{'left' if side == 'L' else 'right'}_out"
    c = Clip(name, 0.34)
    c.pose(0.0, hide)
    ant = dict(hide)
    r = ant["root"]
    ant["root"] = (r[0] * 1.08, r[1], r[2] - 0.008)
    c.pose(0.05, ant, "inout")
    past = dict(AIM)
    sgn = 1 if side == "L" else -1
    past.update({"root": (0.012 * sgn, 0.012, -0.035), "spine": (2, 3 * sgn, 5), "chest": (-3, 1 * sgn, 10)})
    c.pose(0.22, past, "out")
    c.pose(0.34, AIM, "inout")
    c.lag.update({"ikc.hand.R": 0.035, "rotc.hand.R": 0.035, "head": 0.02})
    return c


def lean_in(side="L"):
    hide = LEAN_HIDE_L if side == "L" else mirror_pose(LEAN_HIDE_L)
    c = Clip(f"lean_{'left' if side == 'L' else 'right'}_in", 0.30)
    c.pose(0.0, AIM)
    c.pose(0.22, hide, "inout")
    settle = dict(hide)
    r = settle["root"]
    settle["root"] = (r[0] * 1.04, r[1], r[2])
    c.pose(0.30, hide, "out")
    c.lag.update({"head": -0.02})
    return c


# ------------------------------------------------------------------ more poses

FOOT_L_AIM = STANCE["ik.foot.L"]
FOOT_R_AIM = STANCE["ik.foot.R"]

# standing ready: gun up by the shoulder, not yet aiming
READY = P(STANCE, root=(0.0, 0.02, -0.04), hips=(0, 0, 10), spine=(4, 0, 3), chest=(2, 0, 5), neck=(-2, 0, -6), head=(0, 0, -8),
          shoulder__R=(0, 0, 4), ikc__hand__R=(-0.13, -0.17, 1.31), rotc__hand__R=UP_ROT, pole__hand__R=(-0.4, 0.5, -0.8),
          upper_arm__L=(10, 32, 0), forearm__L=(-35, 0, 0), hand__L=(0, 6, 0))


def shifted(pose, dy=0.0, dx=0.0):
    out = dict(pose)
    for k in ("root", "ik.foot.L", "ik.foot.R"):
        if k in out:
            x, y, z = out[k]
            out[k] = (x + dx, y + dy, z)
    return out


def step_out():
    """Out of a doorway: weight back onto the right foot, one step forward
    with the left, the right foot follows, the gun comes up last."""
    back = 0.40
    start = shifted(READY, dy=back)
    c = Clip("step_out", 0.44)
    c.pose(0.0, start)
    c.key(0.07, "inout", root=(-0.03, back + 0.02, -0.06))
    c.key(0.07, "inout", ik__foot__L=start["ik.foot.L"])
    c.key(0.17, "inout", ik__foot__L=(0.12, 0.13, 0.17))
    c.key(0.25, "out", ik__foot__L=FOOT_L_AIM)
    c.key(0.25, "inout", root=(0.025, 0.10, -0.075))
    c.key(0.23, "inout", ik__foot__R=start["ik.foot.R"])
    c.key(0.31, "inout", ik__foot__R=(-0.13, 0.26, 0.15))
    c.key(0.37, "out", ik__foot__R=FOOT_R_AIM)
    c.pose(0.44, AIM, "out")
    c.lag.update({"ikc.hand.R": 0.06, "rotc.hand.R": 0.06, "head": 0.02})
    return c


def step_in():
    back = 0.40
    end = shifted(READY, dy=back)
    c = Clip("step_in", 0.44)
    c.pose(0.0, AIM)
    c.key(0.05, "inout", root=(0.02, 0.01, -0.045))
    c.key(0.05, "inout", ik__foot__R=FOOT_R_AIM)
    c.key(0.15, "inout", ik__foot__R=(-0.13, 0.30, 0.16))
    c.key(0.22, "out", ik__foot__R=end["ik.foot.R"])
    c.key(0.24, "inout", root=(-0.02, back - 0.05, -0.06))
    c.key(0.20, "inout", ik__foot__L=FOOT_L_AIM)
    c.key(0.30, "inout", ik__foot__L=(0.12, 0.16, 0.15))
    c.key(0.38, "out", ik__foot__L=end["ik.foot.L"])
    c.pose(0.44, end, "out")
    c.lag.update({"head": -0.03})
    return c


def run():
    """A sprint across the street, in place: 0.66 s for two steps at about
    4 m/s (the game moves him). Contact feet travel back at running speed so
    nothing slides; the hips drop into each stance and fly between; the
    shoulders counter the hips; the gun arm pumps with the muzzle up."""
    T = 0.66
    c = Clip("run", T, loop=True)
    # one leg's trajectory over its cycle (phase, y, z, foot pitch)
    table = [(0.00, -0.27, 0.110, -8), (0.10, -0.12, 0.104, 0), (0.20, 0.04, 0.104, 4), (0.33, 0.24, 0.13, 38),
             (0.48, 0.34, 0.36, 70), (0.64, 0.10, 0.46, 30), (0.80, -0.18, 0.34, -5), (0.92, -0.32, 0.18, -14), (1.00, -0.27, 0.110, -8)]
    for side, off, x in (("L", 0.0, 0.10), ("R", 0.5, -0.10)):
        pts = sorted((((ph + off) % 1.0) * T, y, z, pitch) for ph, y, z, pitch in table)
        # make the loop seamless at t = 0 and t = T
        first = pts[0]
        last = pts[-1]
        for t, y, z, pitch in pts:
            c.key(t, "smooth", **{f"ik__foot__{side}": (x, y, z), f"rot__foot__{side}": (pitch, 0, 8 if side == "L" else -8),
                                  f"pole__foot__{side}": (0.15 if side == "L" else -0.15, -1, 0.2)})
        # wrap: interpolate the value at 0 and T between the last and first keys
        if first[0] > 0 or last[0] < T:
            ta, ya, za, pa = last
            tb, yb, zb, pb = first
            span = (T - ta) + tb
            u = (T - ta) / span
            y0, z0, p0 = ya + (yb - ya) * u, za + (zb - za) * u, pa + (pb - pa) * u
            for t in (0.0, T):
                c.key(t, "smooth", **{f"ik__foot__{side}": (x, y0, z0), f"rot__foot__{side}": (p0, 0, 8 if side == "L" else -8),
                                      f"pole__foot__{side}": (0.15 if side == "L" else -0.15, -1, 0.2)})
    # body: lowest at mid stance (0.13, 0.46), highest in flight (0.30, 0.63)
    for ph, z in ((0.0, -0.075), (0.14, -0.105), (0.30, -0.055), (0.5, -0.075), (0.64, -0.105), (0.80, -0.055), (1.0, -0.075)):
        c.key(ph * T, "smooth", root=(0.0, -0.02, z))
    # pelvis yaw follows the forward leg, chest counters, head stays level
    for ph, s in ((0.0, 1), (0.5, -1), (1.0, 1)):
        c.key(ph * T, "inout", hips=(8, 0, -9 * s), spine=(10, 0, 4 * s), chest=(7, 0, 9 * s), neck=(-8, 0, -3 * s), head=(-6, 0, -2 * s))
        # arms pump against the legs: left arm forward when the right leg is
        # arms tucked to the sides (lowered 40 degrees from the A-pose), pumping
        c.key(ph * T, "inout", upper_arm__L=(40 * s - 8, 40, -6), forearm__L=(-80 + 18 * s, 0, 0), hand__L=(0, 6, 0),
              shoulder__L=(0, 0, 5 * s), ikw__hand__L=(0, 0, 0),
              upper_arm__R=(-40 * s - 14, -40, 6), forearm__R=(-92 - 14 * s, 0, 0), hand__R=(-25, 0, 0),
              shoulder__R=(0, 0, 5 * s), ikw__hand__R=(0, 0, 0))
    return c


def throw():
    """Lobbing a lit stick of dynamite, from the idle stance he lit it in:
    a quick coil (weight back, left arm sighting), the whip (the stick leaves
    the hand at THROW_RELEASE = 0.30 s, hand high and in front - the game's
    rules release it then), follow-through, and back to a ready stance."""
    c = Clip("throw", 0.62)
    feet = {"ik.foot.L": (0.12, -0.09, 0.102), "rot.foot.L": (0, 0, 16), "ik.foot.R": (-0.12, 0.10, 0.102), "rot.foot.R": (0, 0, 32),
            "pole.foot.L": (0.2, -1, 0), "pole.foot.R": (-0.1, -1, 0)}
    coil = P(feet, root=(-0.03, 0.07, -0.07), hips=(-4, 0, -26), spine=(-6, -4, -12), chest=(-10, -6, -14), neck=(4, 0, 22), head=(2, 2, 20),
             shoulder__R=(0, 0, 10), ikc__hand__R=(-0.26, 0.20, 1.62), rotc__hand__R=hand_rot("R", (0, 0.6, 0.8), (0, -0.8, 0.6)), pole__hand__R=(-0.5, 0.6, -0.2),
             upper_arm__L=(-80, -10, 20), forearm__L=(-15, 0, 0), hand__L=(0, 0, 0))
    release = P(feet, root=(0.02, -0.03, -0.05), hips=(4, 0, 22), spine=(10, 2, 14), chest=(8, 4, 18), neck=(-2, 0, -14), head=(-6, 0, -16),
                shoulder__R=(0, 0, -8), ikc__hand__R=(-0.14, -0.38, 1.62), rotc__hand__R=hand_rot("R", (0, -0.9, 0.2), (0, 0.2, 0.9)), pole__hand__R=(-0.6, 0.2, 0.3),
                upper_arm__L=(10, 42, -20), forearm__L=(-60, 0, 0))
    follow = P(feet, root=(0.04, -0.07, -0.09), hips=(12, 0, 30), spine=(22, 4, 16), chest=(14, 4, 18), neck=(-8, 0, -18), head=(-10, 0, -14),
               shoulder__R=(0, 0, -10), ikc__hand__R=(0.12, -0.40, 1.02), rotc__hand__R=hand_rot("R", (0.5, -0.4, -0.7), (0, -0.8, 0.5)), pole__hand__R=(-0.8, 0.2, -0.2),
               upper_arm__L=(10, 45, -20), forearm__L=(-70, 0, 0))
    follow["rot.foot.R"] = (30, 0, 32)
    follow["ik.foot.R"] = (-0.11, 0.11, 0.13)
    c.pose(0.0, IDLE)
    c.pose(0.18, coil, "inout")
    c.pose(0.30, release, "in2")
    c.pose(0.42, follow, "out")
    c.pose(0.62, READY, "inout")
    c.lag.update({"head": 0.03, "neck": 0.02})
    return c


def hit(kind="body"):
    """A hit that does not kill: the impact snaps the torso back and twists
    it, the knees give, the head whips; he claws back on target."""
    c = Clip(f"hit_{kind}", 0.52)
    c.pose(0.0, AIM)
    imp = dict(AIM)
    if kind == "body":
        imp.update({"root": (0.015, 0.06, -0.06), "hips": (-4, 2, 12), "spine": (-8, 4, 0), "chest": (-14, 6, 18), "neck": (6, 0, -10), "head": (10, 6, -8),
                    "ik.hand.R": (-0.18, -0.46, 1.26), "rot.hand.R": hand_rot("R", (-0.4, -0.7, -0.4), (0, 0.4, 0.9))})
    else:
        imp.update({"root": (0.0, 0.05, -0.04), "hips": (-2, 0, 16), "spine": (-6, 0, 4), "chest": (-10, 2, 10), "neck": (-18, 6, -10), "head": (-26, 10, -8),
                    "ik.hand.R": (-0.12, -0.52, 1.52), "rot.hand.R": hand_rot("R", (0, -0.6, 0.8), (0, 0.8, 0.6))})
    c.pose(0.05, imp, "snap")
    sag = dict(imp)
    sag.update({"root": (0.01, 0.05, -0.085)})
    c.pose(0.20, sag, "inout")
    c.pose(0.52, AIM, "inout")
    c.lag.update({"head": 0.025, "neck": 0.015, "ikc.hand.R": 0.02, "rotc.hand.R": 0.02})
    return c


def hit_body():
    return hit("body")


def hit_head():
    return hit("head")


LIMP_ARMS = {"ikw.hand.L": (0, 0, 0), "ikw.hand.R": (0, 0, 0)}


def death_back():
    """Taken in the chest: flung back, the legs go, he sits into the fall,
    lands on his back with a bounce and lies still."""
    c = Clip("death_back", 1.25)
    c.pose(0.0, AIM)
    imp = dict(AIM)
    imp.update({"root": (0.0, 0.07, -0.05), "hips": (-6, 0, 10), "spine": (-12, 0, 2), "chest": (-18, 0, 8), "neck": (8, 0, 0), "head": (14, 0, 0),
                "ik.hand.R": (-0.30, -0.30, 1.55), "rot.hand.R": hand_rot("R", (-0.3, -0.2, 0.9), (0, 1, 0))})
    c.pose(0.05, imp, "snap")
    buckle = P(STANCE, LIMP_ARMS, root=(0.0, 0.18, -0.38), hips=(-20, 0, 6), spine=(-14, 0, 0), chest=(-12, 0, 0), neck=(10, 0, 0), head=(20, 0, 6),
               upper_arm__R=(-40, -90, 0), forearm__R=(-40, 0, 0), hand__R=(0, 0, 0),
               upper_arm__L=(-30, 70, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.42, buckle, "inout")
    # on his back: legs out, arms flung wide on the ground (abduction keeps
    # them in the torso's plane, which is now the street)
    fall = P({"ik.foot.L": (0.20, -0.30, 0.10), "rot.foot.L": (-60, 0, 30), "ik.foot.R": (-0.14, -0.24, 0.10), "rot.foot.R": (-55, 0, -25),
              "pole.foot.L": (0.4, -0.3, 1.0), "pole.foot.R": (-0.4, -0.3, 1.0)}, LIMP_ARMS,
             root=(0.0, 0.52, -0.80), hips=(-88, 0, 4), spine=(-4, 0, 0), chest=(-4, 0, 2), neck=(8, 0, 10), head=(10, 0, 16),
             upper_arm__R=(-8, 52, 0), forearm__R=(-25, 0, 0), hand__R=(0, 0, 0),
             upper_arm__L=(-4, -38, 0), forearm__L=(-35, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.85, fall, "in2")
    bounce = dict(fall)
    bounce.update({"root": (0.0, 0.54, -0.76), "chest": (-10, 0, 2), "head": (-6, 0, 16), "neck": (0, 0, 10)})
    c.pose(0.95, bounce, "out")
    rest = dict(fall)
    rest.update({"root": (0.0, 0.55, -0.81), "head": (14, 0, 24)})
    c.pose(1.25, rest, "bounce")
    c.lag.update({"head": 0.04, "neck": 0.03})
    return c


def death_forward():
    """Gut-shot: doubles over, drops to his knees, topples onto his face."""
    c = Clip("death_forward", 1.2)
    c.pose(0.0, AIM)
    fold = P(STANCE, LIMP_ARMS, root=(0.0, 0.06, -0.10), hips=(10, 0, 10), spine=(28, 0, 4), chest=(22, 0, 4), neck=(10, 0, 0), head=(12, 0, 0),
             upper_arm__R=(-50, -40, 10), forearm__R=(-90, 0, 0), hand__R=(0, 0, 0),
             upper_arm__L=(-50, 40, -10), forearm__L=(-90, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.08, fold, "snap")
    kneel = P({"ik.foot.L": (0.13, 0.30, 0.09), "rot.foot.L": (70, 0, 10), "ik.foot.R": (-0.13, 0.34, 0.09), "rot.foot.R": (70, 0, -10),
               "pole.foot.L": (0.1, -1, -0.3), "pole.foot.R": (-0.1, -1, -0.3)}, LIMP_ARMS,
              root=(0.0, 0.04, -0.46), hips=(6, 0, 4), spine=(26, 0, 0), chest=(20, 0, 0), neck=(14, 0, 0), head=(16, 0, 0),
              upper_arm__R=(-10, -60, 0), forearm__R=(-30, 0, 0), hand__R=(0, 0, 0),
              upper_arm__L=(-10, 60, 0), forearm__L=(-30, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.42, kneel, "in2")
    down = P({"ik.foot.L": (0.14, 0.44, 0.07), "rot.foot.L": (90, 0, 10), "ik.foot.R": (-0.14, 0.46, 0.07), "rot.foot.R": (90, 0, -10),
              "pole.foot.L": (0.1, 0.2, -1), "pole.foot.R": (-0.1, 0.2, -1)}, LIMP_ARMS,
             root=(0.0, -0.36, -0.82), hips=(86, 0, 4), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 20), head=(-8, 0, 40),
             upper_arm__R=(-150, -20, 0), forearm__R=(-20, 0, 0), hand__R=(0, 0, 0),
             upper_arm__L=(-60, 70, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.85, down, "in")
    bounce = dict(down)
    bounce.update({"root": (0.0, -0.37, -0.785), "chest": (-6, 0, 0)})
    c.pose(0.93, bounce, "out")
    c.pose(1.2, down, "bounce")
    c.lag.update({"head": 0.04, "neck": 0.03, "upper_arm.L": 0.03, "upper_arm.R": 0.03})
    return c


def death_fall():
    """Shot at a window or on a roof edge: a jolt, a lurch forward over the
    edge, then the drop - arms windmilling, legs kicking - landing face down
    at 78% of the clip (the game drops the root under gravity and stretches
    the clip so this moment meets the street), a bounce, still."""
    T = 1.3
    land = 0.78 * T
    c = Clip("death_fall", T)
    c.pose(0.0, AIM)
    imp = dict(AIM)
    imp.update({"root": (0.0, 0.06, -0.05), "chest": (-14, 0, 8), "head": (12, 0, -6),
                "ik.hand.R": (-0.25, -0.35, 1.55), "rot.hand.R": hand_rot("R", (-0.2, -0.4, 0.9), (0, 1, 0))})
    c.pose(0.05, imp, "snap")
    legs0 = dict(thigh__L=(0, 0, 0), shin__L=(0, 0, 0), foot__L=(0, 0, 0), thigh__R=(0, 0, 0), shin__R=(0, 0, 0), foot__R=(0, 0, 0))
    lurch = P(STANCE, LIMP_ARMS, legs0, root=(0.0, -0.10, -0.08), hips=(30, 0, 6), spine=(20, 0, 0), chest=(12, 0, 0), neck=(-10, 0, 0), head=(-14, 0, 0),
              upper_arm__R=(-60, -70, 0), forearm__R=(-30, 0, 0), upper_arm__L=(-50, 80, 0), forearm__L=(-30, 0, 0))
    lurch = {k.replace("__", "."): v for k, v in lurch.items()}
    c.pose(0.18, lurch, "inout")
    # airborne: legs let go, the body keeps pitching forward, limbs flail
    n = 6
    t0 = 0.26
    for i in range(n + 1):
        u = i / n
        t = t0 + u * (land - 0.10 - t0)
        s1 = math.sin(u * math.pi * 3.0)
        c1 = math.cos(u * math.pi * 3.0)
        pose = P(LIMP_ARMS, root=(0.0, -0.18 - 0.14 * u, -0.10 - 0.30 * u), hips=(40 + 40 * u, 8 * s1, 10 * c1),
                 spine=(8 - 14 * s1, 0, 6 * s1), chest=(4 - 10 * c1, 0, 8 * c1), neck=(-20, 0, 10 * s1), head=(-25 + 10 * c1, 0, 12 * s1),
                 upper_arm__R=(-120 * (0.5 + 0.5 * s1), -60 - 40 * c1, 0), forearm__R=(-40 - 30 * c1, 0, 0), hand__R=(0, 0, 0),
                 upper_arm__L=(-120 * (0.5 - 0.5 * s1), 70 + 40 * s1, 0), forearm__L=(-40 + 30 * s1, 0, 0), hand__L=(0, 0, 0),
                 thigh__L=(-40 * (0.5 + 0.5 * c1), 0, 8), shin__L=(70 * (0.5 - 0.5 * c1) + 10, 0, 0), foot__L=(20, 0, 0),
                 thigh__R=(-40 * (0.5 - 0.5 * c1), 0, -8), shin__R=(70 * (0.5 + 0.5 * c1) + 10, 0, 0), foot__R=(20, 0, 0))
        pose.update({"ikw.foot.L": (0, 0, 0), "ikw.foot.R": (0, 0, 0)})
        c.pose(t, pose, "smooth")
    # bracing: arms thrown forward just before the ground
    brace = P(LIMP_ARMS, root=(0.0, -0.40, -0.55), hips=(75, 0, 4), spine=(6, 0, 0), chest=(4, 0, 0), neck=(-22, 0, 0), head=(-20, 0, 6),
              upper_arm__R=(-150, -20, 0), forearm__R=(-20, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-150, 20, 0), forearm__L=(-20, 0, 0), hand__L=(0, 0, 0),
              thigh__L=(-10, 0, 6), shin__L=(40, 0, 0), foot__L=(30, 0, 0), thigh__R=(-20, 0, -6), shin__R=(50, 0, 0), foot__R=(30, 0, 0))
    brace.update({"ikw.foot.L": (0, 0, 0), "ikw.foot.R": (0, 0, 0)})
    c.pose(land - 0.05, brace, "inout")
    down = P(LIMP_ARMS, root=(0.0, -0.36, -0.82), hips=(88, 0, 4), spine=(2, 0, 0), chest=(0, 0, 0), neck=(-10, 0, 18), head=(-8, 0, 38),
             upper_arm__R=(-150, -40, 0), forearm__R=(-20, 0, 0), hand__R=(0, 0, 0), upper_arm__L=(-70, 60, 0), forearm__L=(-40, 0, 0), hand__L=(0, 0, 0),
             thigh__L=(0, 0, 6), shin__L=(10, 0, 0), foot__L=(40, 0, 0), thigh__R=(-6, 0, -8), shin__R=(30, 0, 0), foot__R=(40, 0, 0))
    down.update({"ikw.foot.L": (0, 0, 0), "ikw.foot.R": (0, 0, 0)})
    c.pose(land, down, "in")
    bounce = dict(down)
    bounce.update({"root": (0.0, -0.37, -0.77), "chest": (-8, 0, 0), "hips": (84, 0, 4)})
    c.pose(land + 0.09, bounce, "out")
    c.pose(T, down, "bounce")
    # the feet release their plant between the lurch and take-off
    c.key(0.0, "linear", ikw__foot__L=(1, 0, 0), ikw__foot__R=(1, 0, 0))
    c.key(0.18, "linear", ikw__foot__L=(1, 0, 0), ikw__foot__R=(1, 0, 0))
    c.key(0.28, "inout", ikw__foot__L=(0, 0, 0), ikw__foot__R=(0, 0, 0))
    return c


def death_slump():
    """Hit at a window sill or behind a barrel: the legs go, he folds forward
    over the edge in front of him, arms hanging down the far side."""
    c = Clip("death_slump", 1.0)
    c.pose(0.0, AIM)
    imp = dict(AIM)
    imp.update({"root": (0.0, 0.05, -0.05), "chest": (-12, 0, 8), "head": (10, 0, -8)})
    c.pose(0.05, imp, "snap")
    fold = P(STANCE, LIMP_ARMS, root=(0.0, 0.06, -0.14), hips=(30, 0, 8), spine=(30, 0, 2), chest=(24, 0, 2), neck=(20, 0, 0), head=(24, 0, 6),
             upper_arm__R=(-70, -20, 0), forearm__R=(-10, 0, 0), hand__R=(0, 0, 0),
             upper_arm__L=(-70, 20, 0), forearm__L=(-10, 0, 0), hand__L=(0, 0, 0))
    c.pose(0.55, fold, "in2")
    bounce = dict(fold)
    bounce.update({"spine": (27, 0, 2), "chest": (20, 0, 2), "root": (0.0, 0.06, -0.13)})
    c.pose(0.66, bounce, "out")
    rest = dict(fold)
    rest.update({"root": (0.0, 0.065, -0.15), "head": (30, 0, 10), "neck": (24, 0, 4)})
    c.pose(1.0, rest, "inout")
    c.lag.update({"head": 0.05, "neck": 0.04, "upper_arm.L": 0.05, "upper_arm.R": 0.05, "forearm.L": 0.08, "forearm.R": 0.08})
    return c


# ------------------------------------------------------------------ rifles

RIFLE_ROT = hand_rot("R", (0.0, -1.0, 0.03), (0.0, 0.03, 1.0))
AIM_RIFLE = P(STANCE, root=(0.0, 0.015, -0.04), hips=(0, 0, 22), spine=(4, 0, 8), chest=(-2, -2, 14), neck=(4, -8, -18), head=(10, -12, -18),
              shoulder__R=(0, 0, 4), ik__hand__R=(-0.10, -0.22, 1.39), rot__hand__R=RIFLE_ROT, pole__hand__R=(-0.8, 0.2, -0.4),
              ik__hand__L=(-0.05, -0.56, 1.36), rot__hand__L=hand_rot("L", (0.0, -1.0, 0.0), (0.0, 0.0, -1.0)), pole__hand__L=(0.7, 0.2, -0.6))


def aim_rifle():
    c = Clip("aim_rifle", 1.0, loop=True)
    c.pose(0.0, AIM_RIFLE)
    c.pose(1.0, AIM_RIFLE)
    c.layers += [breathe(0.5, 1.0)]
    return c


def fire_rifle():
    c = Clip("fire_rifle", 0.5)
    c.pose(0.0, AIM_RIFLE)
    kick = dict(AIM_RIFLE)
    kick.update({"root": (0.0, 0.05, -0.04), "chest": (-8, -2, 16), "head": (4, -12, -18),
                 "ik.hand.R": (-0.10, -0.17, 1.42), "rot.hand.R": hand_rot("R", (0.0, -0.94, 0.33), (0.0, 0.33, 0.94)),
                 "ik.hand.L": (-0.05, -0.50, 1.43)})
    c.pose(0.05, kick, "snap")
    c.pose(0.5, AIM_RIFLE, "inout")
    c.lag.update({"head": 0.02})
    return c


CLIPS = {
    "idle": idle, "hidden": hidden,
    "lean_left_out": lambda: lean_out("L"), "lean_left_in": lambda: lean_in("L"),
    "lean_right_out": lambda: lean_out("R"), "lean_right_in": lambda: lean_in("R"),
    "rise": rise, "sink": sink, "step_out": step_out, "step_in": step_in,
    "aim": aim, "fire": fire, "run": run, "throw": throw,
    "hit_body": hit_body, "hit_head": hit_head,
    "death_back": death_back, "death_forward": death_forward, "death_fall": death_fall, "death_slump": death_slump,
    "aim_rifle": aim_rifle, "fire_rifle": fire_rifle,
}
THROW_RELEASE = 0.30   # seconds into `throw` when the stick leaves the hand (the game's rules agree)
FALL_LAND = 0.78       # fraction of `death_fall` where the body meets the ground
THUD = {'death_back': 0.85, 'death_forward': 0.85, 'death_slump': 0.55}
