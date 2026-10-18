"""mechanic.glb: the Mechanic. A huge man - two metres and more, heavy through
the chest and belly - in grease-black coveralls and a leather welding apron,
a welding mask down over his face, a tyre iron in his fist.

    char.mechanic      the man (head, hands, coveralls, apron, boots)
    var.mask           the welding mask, rigid on `head`, its own node so the
                       game can knock it off (two shots) and let it fly
    socket.weapon      an empty on hand.R at the centre of the grip
      prop.tyre_iron   the lug wrench, identity transform under the socket
                       (shaft up out of the fist along the socket's glTF -Z)
    eyes               his eyeballs (the eyeshine, seen once the mask is off)

The rig is the shared humanoid scaled 1.15 at its root (feet stay on the
origin), so every walker clip plays on him; he adds roar, mask_off, swing.
"""

import time

import bpy
import numpy as np

from .common import S, SK, BD, HN, PT, bl, srgb, smoothstep, value_noise, fbm, log
from . import heads as H, bodies, outfits as O, eyes, assemble
from . import meshfix as MF

SCALE = 1.15


def mask_part(coll=None):
    """A flip-down welding helmet: a moulded shell over the face and the
    sides of the head, a dark filter lens, the headband ratchet."""
    outer = S.Ellipsoid((0.0, -0.035, -0.02), (0.108, 0.105, 0.135))
    inner = S.Ellipsoid((0.0, -0.030, -0.02), (0.100, 0.097, 0.127))
    shell = S.Subtract(outer, inner)
    front = S.Plane((0.0, -0.01, 0.0), (0.0, 1.0, 0.0), (-0.2, -0.2, -0.3), (0.2, 0.2, 0.2))
    shell = S.Intersect(shell, front, k=0.006)
    chin = S.Plane((0, 0, -0.135), (0, 0, -1), (-0.2, -0.2, -0.3), (0.2, 0.2, 0.2))
    shell = S.Intersect(shell, chin, k=0.004)
    # a raised ridge down the middle, the lens frame
    ridge = S.RoundCone((0.0, -0.137, 0.08), (0.0, -0.138, -0.10), 0.006)
    frame = S.Box((0.0, -0.132, 0.005), (0.058, 0.012, 0.028), S.rot_x(-8), rad=0.006)
    band = S.Torus((0.0, 0.004, 0.045), 0.088, 0.006, S.rot_x(-12))
    knob = S.Cylinder((0.105, 0.0, 0.02), 0.022, 0.012, S.rot_y(90), rad=0.004)
    f = S.Union([shell, ridge, frame, band, knob, S.Cylinder((-0.105, 0.0, 0.02), 0.018, 0.01, S.rot_y(90), rad=0.004)], k=0.004)
    ob = MF.decimated("var.mask", f, (-0.13, -0.16, -0.16), (0.13, 0.12, 0.12), 0.0014, 1100, coll, M=np.eye(3), o=H.HEAD_ORIGIN, symmetry=True)

    def paint(P):
        n = len(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        c = np.tile(srgb(0.07, 0.07, 0.075), (n, 1)) * (0.85 + 0.3 * fbm(P, 30, 3, seed=3)[:, None])
        r = np.full(n, 0.55)
        m = np.zeros(n)
        lens = (y < -0.12) & (np.abs(x) < 0.052) & (np.abs(z - 0.005) < 0.022)
        c[lens] = srgb(0.03, 0.05, 0.035)
        r[lens] = 0.05
        scratch = smoothstep(0.8, 0.9, value_noise(P * np.array([1, 1, 8]), 200, seed=5))
        c = c * (1 - 0.0 * scratch[:, None]) + srgb(0.3, 0.3, 0.3) * 0.25 * scratch[:, None]
        # scorch round the lens, grease thumbprints, a chipped paint edge
        sc = np.exp(-((x / 0.08) ** 2 + ((z - 0.005) / 0.05) ** 2)) * (y < -0.1)
        c = c * (1 - 0.3 * sc[:, None]) + srgb(0.12, 0.08, 0.05) * 0.3 * sc[:, None]
        band = np.abs(z - 0.045 + 0.2 * (y - 0.004)) < 0.009
        c[band & (y > -0.05)] = srgb(0.12, 0.10, 0.08)
        c, r = O.grave_wear(P + 3.0, c, r, 0.6, seed=7, mud=False, tears=False)
        return c, r, m
    return dict(ob=ob, field=f, paint=paint, origin=H.HEAD_ORIGIN, weight=0.9, ao_field=f, ao_group="var.mask",
                smart_uv=True, uv_angle=66, skin=("rigid", "head"), name="var.mask")


def tyre_iron_part(sock_M, coll=None):
    """An L lug wrench, in the socket's frame: the long shaft up out of the
    fist (+Y), the cranked end with its socket at the top, a tyre lever's
    flat blade at the butt."""
    shaft = S.RoundCone((0.0, -0.10, 0.0), (0.0, 0.46, 0.0), 0.011, 0.010)
    crank = S.RoundCone((0.0, 0.46, 0.0), (0.0, 0.50, -0.16), 0.011)
    sockt = S.Cylinder((0.0, 0.52, -0.18), 0.017, 0.035, S.rot_x(-80), rad=0.003)
    blade = S.Box((0.0, -0.12, 0.0), (0.016, 0.03, 0.004), rad=0.002)
    f = S.Union([shaft, crank, sockt, blade], k=0.006)
    M = np.asarray(sock_M, float)
    ob = MF.decimated("prop.tyre_iron", f, (-0.05, -0.18, -0.24), (0.05, 0.58, 0.05), 0.0012, 500, coll, M=M[:3, :3], o=M[:3, 3])

    def paint(P):
        c, r, m = PT.metal(P, (0.30, 0.30, 0.31), 0.45, rust=0.8, seed=11)
        grip = (P[:, 1] > -0.05) & (P[:, 1] < 0.12)
        c[grip] *= 0.6
        # something dark dried on the business end
        end = smoothstep(0.35, 0.5, P[:, 1]) * smoothstep(0.5, 0.8, fbm(P, 60, 3, seed=13))
        c = c * (1 - 0.6 * end[:, None]) + srgb(0.12, 0.05, 0.04) * 0.6 * end[:, None]
        m = m * (1 - end)
        return c, r, m
    return dict(ob=ob, field=f, paint=paint, origin=M[:3, 3], M=M[:3, :3], weight=0.6, ao_field=f, ao_group="prop",
                ao_self_only=True, smart_uv=True, uv_angle=70, skin=("prop",), name="prop.tyre_iron")


def welding_apron():
    """A heavy leather welder's bib apron: a stiff panel down the front from
    the chest to the knee (it does not wrap the sides the way a waist apron
    does), a strap round the neck, ties at the waist."""
    zs = [0.45, 0.62, 0.80, 0.98, 1.10, 1.24, 1.36, 1.43]
    rx = [0.27, 0.265, 0.255, 0.245, 0.235, 0.215, 0.185, 0.17]
    ry = [0.20, 0.195, 0.19, 0.19, 0.185, 0.17, 0.16, 0.15]
    cy = [-0.005, -0.012, -0.022, -0.030, -0.030, -0.028, -0.022, -0.018]
    tube = S.Tube([(0, c, z) for c, z in zip(cy, zs)], rx, ry)
    shell = S.Shell(tube, 0.0035)

    def front(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # the panel: in front of a line swept back a little at the hem; the
        # bib narrows above the waist
        half = np.interp(z, [0.45, 1.00, 1.12, 1.43], [0.24, 0.22, 0.17, 0.13])
        return np.maximum.reduce([y + 0.055 + 0.03 * (1 - np.clip((z - 0.45) / 0.5, 0, 1)), np.abs(x) - half,
                                  0.45 - z, z - 1.43]).astype(np.float32)
    panel = S.Intersect(shell, S.Fn(front, (-0.35, -0.4, 0.3), (0.35, 0.2, 1.6)), k=0.003)
    straps = []
    for sgn in (1, -1):
        straps.append(S.RoundCone((sgn * 0.12, -0.155, 1.425), (sgn * 0.085, -0.02, 1.565), 0.008))
        straps.append(S.RoundCone((sgn * 0.085, -0.02, 1.565), (0.0, 0.07, 1.55), 0.008))
        straps.append(S.RoundCone((sgn * 0.235, -0.07, 1.05), (sgn * 0.19, 0.10, 1.04), 0.007))
    return S.Union([panel] + straps, k=0.006)


def build(path, size=1024, quick=False):
    t0 = time.time()
    bl.clear_scene()
    rig = SK.create_armature("rig")
    bp = BD.P(sleeves="full", chest=1.22, shoulders=1.18, arms=1.28, legs=1.16, belly=0.8, shirt_loose=1.1, boot_top=0.30, hips=1.12)
    p = H.P(age=0.55, fat=0.35, width=1.08, jaw=1.3, chin=1.2, brow=1.35, cheekbone=1.15, nose_len=1.1, nose_w=1.25, nose_bridge=0.8,
            neck=1.4, eye_open=0.8, lips=1.0, hair="bald", brows=0.5, dead=dict(sunken=0.7, gaunt=0.3, mouth=0.45, fresh=0.1))
    look = dict(tone="sallow", grime=0.9, stubble=1.0, trickle=1, seed=101,
                scratch=((0.045, -0.085, 0.045), (0.06, -0.06, -0.06)))
    jobs, field = H.make("mech.head", p, look, None, tris=3200 if quick else 5000)
    for j in jobs:
        j["ao_group"] = "body"
    hands = bodies.hand_jobs("mech", side_poses=(("R", "grip"), ("L", "claw")), tone="sallow", sleeve="full", bony=-0.003,
                             tris=600 if quick else 900, seed=17)
    jobs += hands
    base = (0.22, 0.24, 0.26)

    def grease(P, c, r, amount=1.0):
        g = smoothstep(0.45, 0.75, fbm(P, 10, 4, seed=103)) * amount
        c = c * (1 - 0.7 * g[:, None]) + srgb(0.03, 0.03, 0.03) * 0.7 * g[:, None]
        return c, r - 0.3 * g

    def top(P):
        c, r, m = O.fabric(P, base, "canvas", seed=105, wear=1.2)
        c, r = grease(P, c, r, 1.2)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        patch = (y < -0.05) & (np.abs(x + 0.10) < 0.05) & (np.abs(z - 1.38) < 0.025)
        c[patch] = srgb(0.7, 0.66, 0.56)
        return c, r, m

    def legs(P):
        c, r, m = O.fabric(P, base, "canvas", seed=107, wear=1.2, stains=False)
        return (*grease(P, c, r, 1.0), m)

    def apron_paint(P):
        c, r, m = PT.leather(P, (0.20, 0.13, 0.08), 0.0, 0.8, seed=109)
        c, r = grease(P, c, r, 0.8)
        c, r = O.grave_wear(P, c, r, 1.0, seed=111, mud=True, tears=False)
        return c, r, m
    jobs.append(O.shirt_part(bp, "mech.coveralls.top", top))
    jobs.append(O.trousers_part(bp, "mech.coveralls.legs", legs))
    af = welding_apron()
    ap = MF.decimated("mech.apron", af, (-0.32, -0.34, 0.40), (0.32, 0.10, 1.58), 0.0016, 700 if quick else 1000, None, symmetry=True)
    jobs.append(dict(ob=ap, field=af, paint=apron_paint, origin=np.zeros(3), weight=0.6, ao_field=af, smart_uv=True, uv_angle=70,
                     skin=("coat", 0.45)))
    jobs += O.boots_parts("mech", (0.10, 0.08, 0.06), top=0.30, tris=420)
    for j in jobs:
        j.setdefault("name", "char.mechanic")
        j.setdefault("ao_group", "body")
    jobs.append(mask_part())
    sockM = HN.grip_socket_matrix()
    jobs.append(tyre_iron_part(sockM))
    for j in jobs:
        log(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    mat = assemble.bake_atlas(jobs, size, "mechanic")
    body = [j for j in jobs if j["name"] == "char.mechanic"]
    assemble.skin(body + [jobs[-2]], rig, [(j["ao_field"], j["origin"], j.get("M")) for j in body if j.get("skin", ("transfer",))[0] != "rigid"])
    groups = {}
    for j in jobs:
        groups.setdefault(j["name"], []).append(j["ob"])
    for name, objs in groups.items():
        assemble.join(objs, name, mat)
    sock = assemble.socket(rig, "socket.weapon", "hand.R", sockM)
    assemble.attach_prop(bpy.data.objects["prop.tyre_iron"], sock)
    ey = eyes.build("eyes")
    assemble.rigid_object(ey, rig, "head")
    from . import clips_dead, clips_mech
    # the crawler's .low clips are the walker file's only: the Mechanic stands
    clips = {k: v for k, v in clips_dead.CLIPS.items() if k not in clips_dead.LOW_CLIPS}
    clips.update(clips_mech.CLIPS)
    assemble.bake_clips(rig, clips)
    rig.scale = (SCALE, SCALE, SCALE)
    meta = {k: v for k, v in clips_dead.META.items() if k not in clips_dead.LOW_CLIPS}
    meta.update(clips_mech.META)
    size_b = assemble.export(path, extras=dict(scale=SCALE, clips=meta,
                                               dressing={"mechanic": "char.mechanic + var.mask + prop.tyre_iron + eyes"}))
    log(f"mechanic: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path
