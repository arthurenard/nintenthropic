"""survivor.glb: the living, running for the motel with a lantern. Unmistakably
not the dead: warm skin, bright eyes, clean colours, and the light they carry.

    var.person.daughter   Miller's daughter: twenties, a ponytail, a pale blue
                          blouse under a red cardigan, jeans rolled at the ankle,
                          saddle shoes
    var.person.owner      the old motel owner: seventies, bald on top, a grey
                          moustache, a green cardigan over a checked shirt,
                          slacks and slippers
    socket.lantern        an empty on hand.L at the centre of the grip
      prop.lantern        a hurricane lantern hanging from its bail
        lantern.flame  its flame (own material, emissive: the game lights it
                            and puts a warm point light at it)

Show one person and the lantern. Clips: run, run_lantern, duck, wave.
"""

import math
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

from .common import S, SK, BD, HN, HD, C, PT, PG, G, R, bl, srgb, smoothstep, value_noise, fbm, JOINTS, log
from . import outfits as O, assemble
from . import meshfix as MF


def left_grip_matrix():
    """socket on hand.L: the right hand's grip socket mirrored (as a rotation)."""
    M = HN.grip_socket_matrix()
    Sx = np.diag([-1.0, 1.0, 1.0])
    out = np.eye(4)
    out[:3, :3] = Sx @ M[:3, :3] @ Sx
    out[:3, 3] = M[:3, 3] * np.array([-1.0, 1, 1])
    return out


LIVING = dict(sunken=0.0, gaunt=0.0, mouth=0.0, swollen=0.0, teeth=0.0, fresh=1.0, living=True)


def living_head(name, p, look, hair_style=None, iris="brown", tris=5400):
    """The living head: the same sculpt as the dead's (heads.py - High Noon's
    head with thicker lids, open sockets and separate eyeballs) with nothing
    of the grave in it, High Noon's living skin paint, hair grown from the
    head mesh (hair.py), and eyeballs baked into the person's atlas."""
    from .common import T
    from . import heads as H, hair as HR, eyes as EY
    field = H.head_sdf(p)
    detailed = HD.skin_detail(field, p)
    lo = H.head_mesh(name, field, tris)
    HD.head_uv(lo, face_scale=2.4)

    def paint(Pt):
        c, r = T.head_paint(Pt, p, look)
        if look.get("lipstick"):
            # 1950s red on the lips, a little rouge high on the cheeks
            ax, y, z = np.abs(Pt[:, 0]), Pt[:, 1], Pt[:, 2]
            lipd = np.exp(-((ax / 0.022) ** 2 + ((z + 0.0655) / 0.0085) ** 2)) * smoothstep(-0.088, -0.097, y)
            lipm = smoothstep(0.35, 0.8, lipd)[:, None]
            c = c * (1 - 0.75 * lipm) + srgb(*look["lipstick"]) * 0.75 * lipm
            r = r - 0.15 * lipm[:, 0]
            rouge = (np.exp(-(((ax - 0.042) / 0.016) ** 2 + ((z + 0.028) / 0.014) ** 2)) * smoothstep(-0.05, -0.07, y))[:, None]
            c = c * (1 - 0.18 * rouge) + srgb(0.78, 0.42, 0.40) * 0.18 * rouge
        return c, r, np.zeros(len(Pt))

    def paint_ear(Pt):
        c, r = T.head_paint(Pt, p, look, is_ear=True)
        return c, r, np.zeros(len(Pt))
    jobs = [dict(ob=lo, field=detailed, paint=paint, origin=H.HEAD_ORIGIN, weight=3.4, ao_field=field)]
    for side, tag in ((1, "L"), (-1, "R")):
        e = HD.ear_sdf(p, side)
        Ve, Qe = PG.mesh_sdf(e, e.lo, e.hi, 0.0008, blur=1.0)
        elo = bl.mesh_from_arrays(f"{name}.ear.{tag}", Ve + H.HEAD_ORIGIN, Qe, None)
        MF.decimate(elo, 160, symmetry=False)
        jobs.append(dict(ob=elo, field=e, paint=paint_ear, origin=H.HEAD_ORIGIN, weight=1.1, ao_field=e, smart_uv=True, uv_angle=80))
    if hair_style:
        jobs.append(HR.job(f"{name}.hair", lo, p, hair_style, None, seed=7))
    jobs.append(EY.living_job(f"{name}.eyes", iris))
    return jobs


def living_hands(prefix, tone, female=0.0, sleeve="full", tris=700):
    jobs = []
    for side, pose in (("R", "open"), ("L", "grip")):
        hf, nails = HN.hand_sdf(pose, female=female, sleeve=sleeve)
        M, o = HN.world_xform(side)
        ob = MF.decimated(f"{prefix}.handmesh.{side}", hf, (-0.07, -0.21, -0.07), (0.06, 0.20, 0.08), 0.0009, tris, None, M=M, o=o)

        def hp(P, nails=nails, M=M, o=o):
            Pw = P @ M.T + o
            col, r, m = PT.skin(Pw, tone, seed=3, dirt=0.25)
            nm = HN.nail_mask(P, nails)
            col = col * (1 - 0.5 * nm[:, None]) + srgb(0.75, 0.58, 0.54) * 0.5 * nm[:, None]
            return col, r, m
        jobs.append(dict(ob=ob, field=hf, paint=hp, origin=o, M=M, weight=1.1, ao_field=hf, smart_uv=True, uv_angle=75))
    return jobs


def daughter():
    from . import heads as H
    # (the scalp is painted with the same hair the cap is grown from, so the
    # cap's edge sits on hair-coloured skin)
    p = H.P(sex=1.0, age=0.15, hair="slick", hair_len=1.15, hairline=0.0, brows=0.3, brow=0.3, lips=1.2, fat=0.75, nose_len=0.8,
            nose_w=0.76, nose_tip=0.82, nose_bridge=0.7, jaw=0.82, chin=0.86, cheekbone=0.85, eye_open=1.0, neck=0.84, width=0.95,
            dead=LIVING)
    look = dict(skin="fair", hair="auburn", iris="green", stubble=0.0, grime=0.15, hatline=False, flush=1.2,
                lipstick=(0.60, 0.12, 0.14))
    # auburn, drawn back off the face into the ponytail
    jobs = living_head("daughter.head", p, look, hair_style=(dict(hair="slick", hair_len=1.15, hairline=0.0), None, (0.38, 0.21, 0.12), 0.0, 0.2),
                       iris="green")
    # a ponytail instead of the bun: a tapering hank from the crown down the back
    pony = S.Union([S.RoundCone((0.0, 0.085, 0.045), (0.0, 0.118, -0.05), 0.022, 0.018),
                    S.RoundCone((0.0, 0.118, -0.05), (0.004, 0.105, -0.17), 0.018, 0.006),
                    S.Torus((0.0, 0.086, 0.048), 0.016, 0.005, S.rot_x(70))], k=0.01)
    ob = MF.decimated("daughter.pony", pony, (-0.05, 0.03, -0.2), (0.05, 0.16, 0.09), 0.0012, 500, None, M=np.eye(3), o=HD.HEAD_ORIGIN,
                      symmetry=True)

    def pony_paint(P):
        az = np.arctan2(P[:, 0], P[:, 1] - 0.1)
        st = value_noise(np.stack([az * 8, P[:, 2] * 40, P[:, 1] * 10], 1), 1.0, seed=3)
        c = np.tile(srgb(0.38, 0.21, 0.12), (len(P), 1)) * (0.7 + 0.5 * st[:, None])
        band = np.abs(P[:, 2] - 0.045) < 0.008
        c[band] = srgb(0.1, 0.25, 0.55)
        return c, np.full(len(P), 0.55), np.zeros(len(P))
    jobs.append(dict(ob=ob, field=pony, paint=pony_paint, origin=HD.HEAD_ORIGIN, weight=0.4, ao_field=pony, smart_uv=True, uv_angle=66,
                     skin=("rigid", "head")))
    jobs += living_hands("daughter", "fair", female=1.0)
    bp = BD.P(female=1.0, sleeves="full", chest=0.9, shoulders=0.9, arms=0.85, legs=0.95, hips=1.02, boot_top=0.13, shirt_loose=1.0)

    def blouse(P):
        c, r, m = PT.fabric(P, (0.68, 0.76, 0.84), "cotton", dust_amt=0.1, fade=0.1, seed=5)
        return O.shirt_extras(P, c), r, m

    def cardigan(P):
        c, r, m = PT.fabric(P, (0.62, 0.10, 0.09), "wool", dust_amt=0.1, fade=0.1, seed=7)
        knit = np.abs(np.sin(P[:, 2] * 700 + np.sin(P[:, 0] * 300))) > 0.85
        c[knit] *= 0.85
        return c, r, m

    def jeans(P):
        c, r, m = PT.fabric(P, (0.22, 0.30, 0.44), "denim", dust_amt=0.3, fade=0.2, seed=9)
        cuff = P[:, 2] < 0.2
        c[cuff] = c[cuff] * 1.15 + 0.02
        return c, r, m
    jobs.append(O.shirt_part(bp, "daughter.blouse", blouse))
    jobs.append(O.trousers_part(bp, "daughter.jeans", jeans))
    jobs.append(O.coat_part(bp, "daughter.cardigan", cardigan, hem_z=0.95, flare=0.2, seed=9))

    def saddle(P):
        c, r, m = PT.leather(P, (0.82, 0.80, 0.74), 0.2, 0.3, seed=13, shine=0.3)
        mid = np.abs(P[:, 1] + 0.02) < 0.05
        c[mid] = srgb(0.08, 0.07, 0.07)
        c[P[:, 2] < 0.018] = srgb(0.3, 0.12, 0.08)
        return c, r, m
    for side in ("L", "R"):
        bf, t = O.GR.boot_sdf(side, top=0.10, heel=0.02, shaft_r=0.045, spur=False)
        x0 = 0.105 if side == "L" else -0.105
        ob = MF.decimated(f"daughter.shoe.{side}", bf, (x0 - 0.08, -0.23, -0.01), (x0 + 0.08, 0.14, 0.17), 0.0015, 320, None)
        jobs.append(dict(ob=ob, field=bf, paint=saddle, origin=np.zeros(3), weight=0.5, ao_field=bf, smart_uv=True, uv_angle=80))
    return jobs


def owner():
    from . import heads as H
    p = H.P(age=0.85, fat=0.35, hair="short", hair_len=0.7, hairline=0.85, moustache="walrus", brows=1.1, nose_tip=1.12, nose_len=1.04,
            jaw=0.95, eye_open=0.8, neck=0.95, dead=LIVING)
    look = dict(skin="fair", hair="white", moustache_color="grey", iris="blue", stubble=0.2, grime=0.15, hatline=False, flush=1.5,
                grey=0.8)
    # a white horseshoe round a bald crown
    jobs = living_head("owner.head", p, look, hair_style=(dict(hair="short", hair_len=0.7, hairline=0.85), None, (0.74, 0.72, 0.70), 0.2, 0.0),
                       iris="blue")
    jobs += living_hands("owner", "fair")
    bp = BD.P(sleeves="full", chest=0.96, belly=0.55, shoulders=0.95, arms=0.92, legs=0.95, boot_top=0.12, shirt_loose=1.04)

    def shirt(P):
        c, r, m = PT.fabric(P, (0.70, 0.66, 0.56), "cotton", dust_amt=0.1, fade=0.1, seed=21)
        c = O.plaid(P, (0.70, 0.66, 0.56), (0.30, 0.34, 0.42), 0.03) * 0.9
        return O.shirt_extras(P, c), r, m

    def cardigan(P):
        c, r, m = PT.fabric(P, (0.26, 0.32, 0.22), "wool", dust_amt=0.1, fade=0.1, seed=23)
        btn = (P[:, 1] < -0.1) & (np.abs(P[:, 0] - 0.04) < 0.008) & (np.abs(((P[:, 2] - 0.95) % 0.08) - 0.04) < 0.008)
        c[btn] = srgb(0.3, 0.22, 0.14)
        return c, r, m

    def slacks(P):
        return PT.fabric(P, (0.30, 0.28, 0.25), "wool", dust_amt=0.3, fade=0.2, seed=25)
    jobs.append(O.shirt_part(bp, "owner.shirt", shirt))
    jobs.append(O.trousers_part(bp, "owner.slacks", slacks))
    jobs.append(O.coat_part(bp, "owner.cardigan", cardigan, hem_z=0.84, flare=0.3, seed=11))
    jobs += O.boots_parts("owner", (0.20, 0.10, 0.08), shoes=True, shine=0.2, muddy=0.3)
    return jobs


def lantern(sockM):
    """A hurricane lantern hanging from its bail: the bail's top in the fist
    (the socket's origin), the lantern below it."""
    # built in world space at the rest pose, hanging straight down from the fist
    o = sockM[:3, 3]
    top = o + np.array([0.0, 0.0, -0.02])
    def P(x, y, z):
        return top + np.array([x, y, z])
    tank = S.Cylinder(P(0, 0, -0.26), 0.075, 0.03, rad=0.012)
    collar = S.Cylinder(P(0, 0, -0.225), 0.045, 0.008, rad=0.003)
    globe_o = S.Ellipsoid(P(0, 0, -0.155), (0.055, 0.055, 0.07))
    globe = S.Subtract(globe_o, S.Ellipsoid(P(0, 0, -0.155), (0.050, 0.050, 0.065)))
    cap = S.Union([S.Cylinder(P(0, 0, -0.078), 0.05, 0.012, rad=0.004), S.Ellipsoid(P(0, 0, -0.06), (0.035, 0.035, 0.022))], k=0.006)
    guards = [S.RoundCone(P(0.068 * math.cos(a), 0.068 * math.sin(a), -0.235), P(0.052 * math.cos(a), 0.052 * math.sin(a), -0.085), 0.0025)
              for a in np.linspace(0, 2 * math.pi, 4, endpoint=False) + 0.4]
    tubes = [S.RoundCone(P(s * 0.078, 0, -0.24), P(s * 0.06, 0, -0.07), 0.005) for s in (1, -1)]
    bail = S.Torus(P(0, 0, -0.07), 0.075, 0.0025, S.rot_x(90))
    bail = S.Intersect(bail, S.Plane(P(0, 0, -0.07), (0, 0, -1), o - 0.3, o + 0.3))
    f = S.Union([tank, collar, globe, cap, bail] + guards + tubes, k=0.003)
    lo, hi = o - np.array([0.1, 0.1, 0.32]), o + np.array([0.1, 0.1, 0.03])
    ob = MF.decimated("prop.lantern", f, lo, hi, 0.0009, 900, None)

    def paint(Pw):
        c, r, m = PT.metal(Pw, (0.55, 0.12, 0.08), 0.5, rust=0.3, seed=31)
        q = Pw - top
        glass = (q[:, 2] < -0.09) & (q[:, 2] > -0.22) & (np.hypot(q[:, 0], q[:, 1]) > 0.045) & (np.hypot(q[:, 0], q[:, 1]) < 0.06)
        c[glass] = srgb(0.75, 0.70, 0.55)
        r[glass] = 0.1
        m[glass] = 0.0
        soot = glass & (q[:, 2] > -0.12)
        c[soot] *= 0.4
        return c, r, m
    job = dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=f, ao_group="prop", ao_self_only=True,
               smart_uv=True, uv_angle=70, skin=("prop",), name="prop.lantern")
    # the flame: a small teardrop over the wick, its own emissive material
    fl = S.Union([S.Ellipsoid(P(0, 0, -0.165), (0.010, 0.010, 0.022)), S.Sphere(P(0, 0, -0.18), 0.009)], k=0.006)
    fo = MF.decimated("lantern.flame", fl, P(-0.02, -0.02, -0.2), P(0.02, 0.02, -0.13), 0.0008, 120, None)
    m = bpy.data.materials.new("flame")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1.0, 0.6, 0.2, 1)
    b.inputs["Emission Color"].default_value = (1.0, 0.55, 0.18, 1)
    b.inputs["Emission Strength"].default_value = 6.0
    m["flame"] = {"drive": "emissiveIntensity", "note": "flicker it; put a warm point light here (~1800 K)"}
    fo.data.materials.append(m)
    return job, fo


def build(path, size=1024, quick=False):
    from . import clips_survivor as CS
    t0 = time.time()
    bl.clear_scene()
    rig = SK.create_armature("rig")
    jobs = []
    d = daughter()
    for j in d:
        j["name"] = "var.person.daughter"
        j["ao_group"] = "var.person.daughter"
        j["ao_self_only"] = True
    o = owner()
    for j in o:
        j["name"] = "var.person.owner"
        j["ao_group"] = "var.person.owner"
        j["ao_self_only"] = True
    sockM = left_grip_matrix()
    lj, flame = lantern(sockM)
    jobs = d + o + [lj]
    for j in jobs:
        log(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    mat = assemble.bake_atlas(jobs, size, "survivor")
    for person in (d, o):
        assemble.skin(person, rig, [(j["ao_field"], j["origin"], j.get("M")) for j in person if j.get("skin", ("transfer",))[0] != "rigid"])
    groups = {}
    for j in jobs:
        groups.setdefault(j["name"], []).append(j["ob"])
    for name, objs in groups.items():
        assemble.join(objs, name, mat)
    sock = assemble.socket(rig, "socket.lantern", "hand.L", sockM)
    lo = bpy.data.objects["prop.lantern"]
    assemble.attach_prop(lo, sock)
    mw = flame.matrix_world.copy()
    flame.parent = lo
    flame.matrix_world = mw
    flame.data.transform(flame.matrix_basis)
    flame.matrix_basis = Matrix.Identity(4)
    assemble.bake_clips(rig, CS.CLIPS)
    size_b = assemble.export(path, extras=dict(clips=CS.META, dressing={
        "daughter": "var.person.daughter + prop.lantern (+ lantern.flame lit)",
        "owner": "var.person.owner + prop.lantern (+ lantern.flame lit)"}))
    log(f"survivor: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path
