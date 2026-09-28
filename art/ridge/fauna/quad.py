"""What every four-legged animal here shares: the bone table, the legs' IK, a
gait generator and the small layers that make an animal look alive.

Skeleton (a cow's, a sheep's, a goat's and a dog's are the same tree with
different joints):

    pelvis (root) - spine - chest - neck - head [- jaw] [- ear.L/R]
    pelvis - tail.1 - tail.2 - tail.3
    chest  - front.upper.L/R (humerus) - front.lower (forearm) - front.foot (cannon + hoof, or paw)
    pelvis - hind.upper.L/R (femur)    - hind.lower (tibia)    - hind.foot (cannon + hoof, or paw)

A leg is IK: the clip says where the hoof is and at what angle the cannon
stands; the hock or carpus follows, the elbow and stifle bend where they
did at rest (elbows back, stifles forward).

Gaits are generated, not keyed: each foot has a phase in the cycle; in stance
it is planted and travels back under the body at exactly the walking speed
(so the game moving the root at that speed shows no skating), in swing its
top (carpus, hock) travels forward on a Hermite curve whose end velocities
match the stance, while the cannon flexes (a cow's front hoof flips back and
up, the hind hock folds) and reaches forward before it lands.
"""
import math
import numpy as np
from mathutils import Vector
from .lib import A, add, smoothstep

LEGS = {"fl": ("front.upper.L", "front.lower.L", "front.foot.L"),
        "fr": ("front.upper.R", "front.lower.R", "front.foot.R"),
        "hl": ("hind.upper.L", "hind.lower.L", "hind.foot.L"),
        "hr": ("hind.upper.R", "hind.lower.R", "hind.foot.R")}

# lateral-sequence walk: left hind, left fore, right hind, right fore
WALK_PHASE = {"hl": 0.0, "fl": 0.25, "hr": 0.5, "fr": 0.75}
# trot: diagonal pairs together
TROT_PHASE = {"hl": 0.0, "fr": 0.0, "hr": 0.5, "fl": 0.5}


def bones(jaw=True, ears=True, tail=3, extra=(), neck2=True):
    """The bone table. Two neck bones (`neck`, `neck.2`): a grazing animal
    bends its neck along its whole length, and one bone pivoting at the
    shoulders cannot bring a muzzle to the turf without tearing the withers."""
    B = [("pelvis", None), ("spine", "pelvis"), ("chest", "spine"), ("neck", "chest")]
    if neck2:
        B += [("neck.2", "neck"), ("head", "neck.2")]
    else:
        B += [("head", "neck")]
    if jaw:
        B.append(("jaw", "head"))
    if ears:
        B += [("ear.L", "head"), ("ear.R", "head")]
    for i in range(1, tail + 1):
        B.append((f"tail.{i}", "pelvis" if i == 1 else f"tail.{i - 1}"))
    for s in "LR":
        B += [(f"front.upper.{s}", "chest"), (f"front.lower.{s}", f"front.upper.{s}"), (f"front.foot.{s}", f"front.lower.{s}")]
    for s in "LR":
        B += [(f"hind.upper.{s}", "pelvis"), (f"hind.lower.{s}", f"hind.upper.{s}"), (f"hind.foot.{s}", f"hind.lower.{s}")]
    B += list(extra)
    return B


def weights_override(sc, names):
    """Bone heat, corrected where a sculpt's parts touch but must not move
    together: a tail hangs against the buttocks, ears against the head, the
    jaw under it. Uses the sculpt's own fields to tell which part a vertex is:
    sc.rest (all but tail and ears), sc.tail, sc.tail_root_z, sc.ears
    [(field, base, length)] and sc.jaw_mask(V) -> 0..1."""
    it = {b: i for i, b in enumerate(names)}
    tail_i = [it[b] for b in names if b.startswith("tail.")]
    ear_i = [it[b] for b in ("ear.L", "ear.R") if b in it]

    def override(ob, V, W):
        V = np.asarray(V, np.float32)
        W = W.copy()
        dr = sc.rest(V)
        if tail_i and getattr(sc, "tail", None) is not None:
            is_tail = (sc.tail(V) < dr) & (V[:, 2] < sc.tail_root_z)
            W[np.ix_(~is_tail, tail_i)] = 0.0
            keep = np.zeros(W.shape[1], bool)
            keep[tail_i] = True
            keep[it["pelvis"]] = True
            W[np.ix_(is_tail, ~keep)] = 0.0
            W[is_tail, tail_i[0]] += 1e-4
        for (ef, base, ln), ei in zip(getattr(sc, "ears", []), ear_i):
            is_ear = ef(V) < dr
            others = np.ones(W.shape[1], bool)
            others[[ei, it["head"]]] = False
            W[np.ix_(is_ear, others)] = 0.0
            W[np.ix_(~is_ear, [ei])] = 0.0
            # past its first third the ear is all ear
            far = is_ear & (np.linalg.norm(V - np.asarray(base, np.float32), axis=1) > 0.33 * ln)
            W[np.ix_(far, [it["head"]])] = 0.0
            W[far, ei] = np.maximum(W[far, ei], 1.0)
        if "jaw" in it and hasattr(sc, "jaw_mask"):
            jw = sc.jaw_mask(V)
            hw = W[:, it["head"]] + W[:, it["jaw"]]
            W[:, it["jaw"]] = hw * jw
            W[:, it["head"]] = hw * (1 - jw)
        return W
    return override


def build(name, sc, skel, clips, lo, hi, res, tris, quick=False, size=1024, ao_scale=1.0, ao_strength=0.9,
          no_heat=(), speeds=None, proxy_res=0.011, extras=None):
    """Everything after the sculpt for a four-legged animal: the game mesh,
    the atlas, the armature (named after the animal: the glTF root), the
    weights, the clips (stashed for export). `sc` provides body, detailed,
    paint, parts(), all (for occlusion), rest/tail/ears/jaw_mask (weights)
    and extra_jobs() (horns, a bell...). Bones in `no_heat` take no skin in
    bone heat (a bell's bone must not take the throat)."""
    from . import lib as L
    with L.stage(f"{name}: game meshes"):
        body_ob = L.sculpt_mesh(f"{name}.body", sc.body, lo, hi, res * (1.8 if quick else 1.0), tris // 2 if quick else tris)
        jobs = [dict(ob=body_ob, field=sc.body, relief=sc.relief, paint=sc.paint, weight=1.0, parts=sc.parts())] + sc.extra_jobs()
    with L.stage(f"{name}: atlas"):
        imgs, at = L.bake_atlas(jobs, 512 if quick else size, name, sc.all, ao_scale=ao_scale, ao_strength=ao_strength)
    L.save_atlas_previews(imgs, L.ATLAS_DIR, name)
    mat = L.material(name, imgs)
    rig = skel.create(name)
    with L.stage(f"{name}: weights"):
        for b in no_heat:
            rig.data.bones[b].use_deform = False
        L.skin_jobs(jobs, rig, skel.names, sc.body, lo, hi, res=proxy_res * (1.5 if quick else 1.0),
                    override=weights_override(sc, skel.names))
        for b in no_heat:
            rig.data.bones[b].use_deform = True
    ntris = sum(L.bl.tri_count(j["ob"]) for j in jobs)
    mesh = L.finish_mesh(f"{name}.body", jobs, mat)
    body = L.Body(skel, LEGS)
    with L.stage(f"{name}: clips"):
        acts = [L.bake_clip(body, mk(body), rig) for mk in clips]
    L.stash(rig, acts)
    if speeds:
        rig["speeds"] = speeds
    for k, v in (extras or {}).items():
        rig[k] = v
    return dict(rig=rig, mesh=mesh, tris=ntris, images=imgs, clips=[a.name for a in acts])


def keyed(pts, u):
    """Piecewise smoothstep through (u, value) points."""
    if u <= pts[0][0]:
        return pts[0][1]
    for (u0, v0), (u1, v1) in zip(pts[:-1], pts[1:]):
        if u <= u1:
            w = (u - u0) / max(u1 - u0, 1e-9)
            w = w * w * (3 - 2 * w)
            return v0 + (v1 - v0) * w
    return pts[-1][1]


def hermite(p0, p1, m0, m1, u):
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1


def foot_state(body, leg, ph, speed, T, duty, flex, lift, toe, breakover, stride_scale=1.0, y_off=0.0):
    """Hoof target and cannon pitch of one leg at phase ph (0 = touchdown)."""
    u_, l_, f_ = body.legs[leg]
    rig = body.rig
    foot = rig.tail[f_] - rig.head[f_]
    x0, y0, z0 = body.foot0[leg]
    y0 += y_off
    s = speed * T * duty * stride_scale
    if ph < duty:
        u = ph / duty
        th = breakover * smoothstep(0.72, 1.0, u)
        y = y0 - s / 2 + s * u
        return Vector((x0, y, z0 + toe * math.sin(math.radians(th)))), th
    u = (ph - duty) / (1 - duty)
    th = keyed([(0.0, breakover)] + list(flex), u)
    lo = Vector((x0, y0 + s / 2, z0 + toe * math.sin(math.radians(breakover)))) - A.E(breakover, 0, 0) @ foot
    td = Vector((x0, y0 - s / 2, z0)) - foot
    m = speed * T * (1 - duty)
    top = Vector((lo.x + (td.x - lo.x) * u,
                  hermite(lo.y, td.y, m, m, u),
                  lo.z + (td.z - lo.z) * u + lift * math.sin(math.pi * u) ** 0.9))
    return top + A.E(th, 0, 0) @ foot, th


def gait(body, T, speed, phases, duty, flex, lift, toe=0.05, breakover=(28, 22)):
    """Layer: every foot of an in-place gait. duty/lift/breakover per (front, hind);
    flex: {'f': [(u, deg)...], 'h': [...]} the cannon's pitch through the swing."""
    def layer(t, pose):
        for leg, off in phases.items():
            k = 0 if leg[0] == "f" else 1
            ph = (t / T - off) % 1.0
            hoof, th = foot_state(body, leg, ph, speed, T, duty[k], flex["fh"[k]], lift[k], toe, breakover[k])
            pose[f"ik.{leg}"] = tuple(hoof)
            pose[f"rot.{leg}"] = (th, 0.0, 0.0)
    return layer


def shoulder_slide(body, T, speed, phases, duty, amp):
    """Layer (after gait): the shoulder joint glides forward as the fore leg
    reaches and back as it pushes - the shoulder blade rotating on the ribs,
    which an animal's stride depends on and a fixed humerus head would lose."""
    s = speed * T * duty

    def layer(t, pose):
        for leg in ("fl", "fr"):
            if f"ik.{leg}" not in pose:
                continue
            u = body.legs[leg][0]
            y0 = body.foot0[leg][1]
            k = max(-1.0, min(1.0, (pose[f"ik.{leg}"][1] - y0) / (s / 2)))
            pose[f"move.{u}"] = (0.0, amp * k, 0.0)
    return layer


def walk_body(T, duty=(0.66, 0.66), bob=0.015, body_len=1.0, roll=2.0, sway=0.012, yaw=1.5, nod=4.0, head_keep=0.5,
              tail=6.0, bob_front=None, phases=WALK_PHASE):
    """Layer: what the body does over a lateral-sequence walk. The hips are
    highest when a hind leg stands vertical under them (mid-stance), the
    withers when a fore leg does - a quarter cycle apart, so the back rocks;
    the hips drop on the side of the swinging hind leg and the body leans onto
    the standing side; the head nods twice a cycle, lowest just after each fore
    hoof lands, and the head keeps some of its level against the neck."""
    dh, df = duty[1], duty[0]
    bf = bob if bob_front is None else bob_front
    h_mid = phases["hl"] + dh / 2
    f_mid = phases["fl"] + df / 2
    h_swing = phases["hl"] + dh + (1 - dh) / 2
    f_swing = phases["fl"] + df + (1 - df) / 2
    nod_ph = phases["fl"] + 0.1

    def layer(t, pose):
        w = 2 * math.pi * t / T
        hz = bob * math.cos(2 * (w - 2 * math.pi * h_mid))
        fz = bf * math.cos(2 * (w - 2 * math.pi * f_mid))
        add(pose, "root", (0, 0, hz))
        # the pelvis pitch carries the chest to its own bob (positive x tips the front down)
        add(pose, "pelvis", (-math.degrees((fz - hz) / body_len), 0, 0))
        rh = math.cos(w - 2 * math.pi * h_swing)
        rf = math.cos(w - 2 * math.pi * f_swing)
        add(pose, "pelvis", (0, roll * rh, yaw * rh))
        add(pose, "root", (-sway * rh, 0, 0))
        add(pose, "chest", (0, roll * 0.7 * (rf - rh), -yaw * 1.4 * rh))
        n = math.cos(2 * (w - 2 * math.pi * nod_ph))
        add(pose, "neck", (nod * n, 0, yaw * 0.8 * rf))
        add(pose, "head", (-nod * head_keep * n, 0, 0))
        if tail:
            for i, b in enumerate(("tail.1", "tail.2", "tail.3")):
                add(pose, b, (0, 0, tail * (0.6 + 0.4 * i) * math.cos(w - 2 * math.pi * h_swing - 0.9 * (i + 1))))
    return layer


def trot_body(T, duty, bob=0.03, pitch=1.5, roll=1.5, nod=5.0, tail=10.0, phases=TROT_PHASE):
    """Layer: the body over a trot with suspension. Each diagonal pair lands,
    the body sinks onto it (lowest at mid-stance), is thrown up and floats
    while no foot is down - twice a cycle; the head bobs against it."""
    mid = phases["hl"] + duty / 2          # mid-stance of the first diagonal

    def layer(t, pose):
        w = 2 * math.pi * (t / T - mid)
        z = -bob * math.cos(2 * w)             # lowest at mid-stance, highest in the air
        add(pose, "root", (0, 0, z))
        add(pose, "pelvis", (pitch * math.sin(2 * w), roll * math.sin(w), 0))
        add(pose, "chest", (0, -roll * 0.8 * math.sin(w), 0))
        add(pose, "neck", (nod * math.cos(2 * w - 0.6), 0, 0))
        add(pose, "head", (-nod * 0.6 * math.cos(2 * w - 0.6), 0, 0))
        if tail:
            add(pose, "tail.1", (tail * 0.5 * math.cos(2 * w), 0, tail * 0.3 * math.sin(w)))
            add(pose, "tail.2", (tail * 0.4 * math.cos(2 * w - 0.8), 0, tail * 0.4 * math.sin(w - 0.8)))
    return layer


GALLOP_PHASE = {"hl": 0.0, "hr": 0.09, "fr": 0.36, "fl": 0.46}   # rotary: round the body, then a float


def gallop_body(T, flex=10.0, stretch=0.05, bob=0.05, nod=6.0, tail=12.0):
    """Layer: the back of a galloping dog. It stretches while the hind legs
    push (the chest thrown forward, the forelegs reaching), rounds while the
    forelegs take the weight and through the float that follows (the hind
    legs swing forward under the belly). The body is highest in the float."""
    def layer(t, pose):
        w = 2 * math.pi * t / T
        # 0 at mid hind stance (stretching), pi at the float (rounded)
        k = math.cos(w - 2 * math.pi * 0.2)
        add(pose, "spine", (flex * 0.5 * k, 0, 0))
        add(pose, "chest", (flex * 0.5 * k, 0, 0))
        add(pose, "pelvis", (-flex * 0.6 * k, 0, 0))
        pose["move.chest"] = (0.0, -stretch * max(k, -0.6), 0.0)
        add(pose, "root", (0, 0, bob * math.cos(w - 2 * math.pi * 0.85)))
        add(pose, "neck", (-nod * k, 0, 0))
        add(pose, "head", (nod * 0.8 * k, 0, 0))
        if tail:
            add(pose, "tail.1", (-tail * 0.5 * k, 0, 0))
            add(pose, "tail.2", (-tail * 0.5 * math.cos(w - 2 * math.pi * 0.3), 0, 0))
            add(pose, "tail.3", (-tail * 0.6 * math.cos(w - 2 * math.pi * 0.4), 0, 0))
    return layer


def chew(amp=6.0, side=3.0, rate=1.4, t0=0.0, t1=1e9, T=None):
    """Layer: a ruminant chewing - the jaw opens a little and grinds side to side.
    With T (a loop) the rate is rounded so the loop closes."""
    if T:
        rate = max(1, round(rate * T)) / T

    def layer(t, pose):
        e = smoothstep(t0, t0 + 0.3, t) * (1 - smoothstep(t1 - 0.3, t1, t))
        if e <= 0:
            return
        w = 2 * math.pi * rate * (t - t0)
        add(pose, "jaw", (amp * 0.5 * (1 - math.cos(w)) * e, 0, side * math.sin(w) * e))
    return layer


def flicks(events, bones_=("ear.L", "ear.R")):
    """Layer: quick flicks. events: (t, which, (x, y, z) degrees, duration);
    which 0/1/2 = left, right, both. A flick snaps out and eases back."""
    def layer(t, pose):
        for t0, which, rot, dur in events:
            if t0 <= t <= t0 + dur:
                u = (t - t0) / dur
                e = A.ease("out", u / 0.25) if u < 0.25 else 1 - A.ease("inout", (u - 0.25) / 0.75)
                for i, b in enumerate(bones_):
                    if which == 2 or which == i:
                        r = np.asarray(rot, float)
                        if i == 1:
                            r = r * np.array([1, -1, -1])   # mirror for the right side
                        add(pose, b, r * e)
    return layer


def swish(events, amp=(0, 0, 30), lag=0.09, grow=1.35, bones_=("tail.1", "tail.2", "tail.3")):
    """Layer: tail swishes (at flies): the root of the tail swings out and back,
    each bone further down following a moment later and further - the whip.
    events: (t, side +1/-1, duration)."""
    def layer(t, pose):
        for t0, side, dur in events:
            for i, b in enumerate(bones_):
                tt = t - t0 - lag * i
                if 0 <= tt <= dur:
                    u = tt / dur
                    e = math.sin(math.pi * u) * (1 - 0.3 * u)
                    add(pose, b, np.asarray(amp, float) * side * e * grow ** i)
    return layer


def breathe(T, rate=0.3, amp=0.6):
    """Layer: a slow rise of the chest (a loop's rate is rounded to close it)."""
    n = max(1, round(rate * T))

    def layer(t, pose):
        add(pose, "chest", (-amp * math.sin(2 * math.pi * n * t / T), 0, 0))
    return layer


def drift(T, chans, seed=0):
    """Layer: slow looped wander of some channels. chans: {channel: (x, y, z) amplitude}."""
    from .lib import loop_noise

    def layer(t, pose):
        for i, (k, amp) in enumerate(chans.items()):
            a = np.asarray(amp, float)
            v = np.array([loop_noise(t, T, seed + 31 * i + j, 3, 1, 3) for j in range(3)])
            add(pose, k, a * v)
    return layer
