"""civilian.glb: the people of the Valle Serra who are not at war. Four
people on the shared armature, each one whole mesh with its own 1024 atlas,
dressed by the game with one `var.person.*`:

    var.person.farmer    a weathered man in faded blue bib-and-brace overalls
                         over a pale check shirt, rubber boots, a straw hat
    var.person.cyclist   a young woman in a red jacket, navy skirt and
                         stockings, a yellow headscarf; with the `bicycle`
    var.person.shepherd  an old man with a white beard, a red wool jacket, a
                         mustard knitted scarf, a felt hat, his crook
    var.person.child     a boy of nine in a yellow jumper, shorts and knee
                         socks; built on the adult skeleton with a child's
                         head and build - show him scaled by extras.scale

    bicycle              bones and rigid meshes (see bicycle.py), animated in `cycle`
"""
import time
import numpy as np
import bpy
from . import env, assemble as AS, parts as PA, wear as W, wear_civ as WC, bicycle as BK, kin as K
from charlib import bl, sdf as S, body as BD, head as HD, garments as G, rings as R, skeleton as SK
from charlib import character as C, pipeline as PL, outfits as OF, gear as GR
from charlib.texture import srgb, HAIR

# a child's fair hair, lighter than any grown-up's in the valley (a dark bowl of
# hair on a small head would read like a helmet through the scope)
HAIR.setdefault("blond", srgb(0.74, 0.60, 0.36))

log = env.log
CHILD_SCALE = 0.64       # the game scales the whole rig by this for var.person.child: 1.80 m -> 1.15 m


def shirt_jobs(bp, color, pattern=None, seed=0):
    shf = BD.shirt(bp)
    rm = G.build_shirt(bp, shf)
    return [PA.ring_job(rm, "shirt", S.Displace(shf, C.sleeve_folds(bp), 0.006),
                        C.shirt_paint(color, pattern, seed=seed), weight=0.9, part="shirt") | {"ao_field": shf}]


def trouser_jobs(bp, paint, name="trousers", weight=0.7):
    trf = BD.trousers(bp)
    rt = G.build_trousers(bp, trf)
    return [PA.ring_job(rt, name, S.Displace(trf, C.trouser_folds(bp), 0.006), paint, weight=weight) | {"ao_field": trf}]


def jacket_jobs(bp, color, hem, loose, name="jacket", pockets=True, bust=False, belt=0.006, paint=None, weight=1.0):
    tf = W.tunic_field(bp, hem, loose, belt=belt)
    if bust:
        b = S.Union([S.Ellipsoid((s * 0.056, -0.092, 1.262), (0.058, 0.048, 0.056)) for s in (1, -1)], k=0.02)
        tf = S.Union([tf, S.Offset(b, loose)], k=0.03)
    rm = W.build_tunic(bp, tf, hem, loose=loose, belt=belt)
    p = paint or W.tunic_paint(color, hem_z=hem, pockets=pockets, dust=0.25)
    return [PA.ring_job(rm, name, S.Displace(tf, W.tunic_details(bp, hem, pockets=pockets), 0.006), p, weight=weight,
                        skin=("coat", hem)) | {"ao_field": tf}], tf


def shoe_jobs(color=(0.10, 0.06, 0.04), tris=340):
    """Laced leather shoes to the ankle, round-toed."""
    sdf = lambda side: W.combat_boot_sdf(side, top=0.150, heel=0.022, sole=0.011)
    return PA.boot_jobs(sdf, W.combat_boot_paint(color), tris=tris, name="shoe")


def hat_job(kind):
    """One of charlib's hats, made part of the person (joined, rigid on the head)."""
    j = PL.hat_job(kind, "hat")
    j["ao_group"] = "body"
    j["weight"] = 0.55
    return j


# ------------------------------------------------------------------ the people

FARMER = dict(
    head=HD.P(age=0.55, fat=0.35, jaw=1.05, nose_len=1.08, nose_tip=1.12, brow=1.1, hair="short", hairline=0.35, moustache="walrus",
              beard=0.1, eye_open=0.9),
    look=dict(skin="ruddy", hair="salt", moustache_color="grey", iris="blue", stubble=0.6, grime=0.4, hatline=True, flush=1.3),
    body=BD.P(belly=0.35, chest=1.04, arms=1.06, sleeves="rolled", boot_top=0.36, shirt_loose=1.04))


def farmer_jobs():
    sp = FARMER
    bp = sp["body"]
    jobs = PA.head_jobs("head", sp["head"], sp["look"], fill=1.1)
    jobs += PA.hand_jobs({"R": "open", "L": "relaxed"}, tone="ruddy", grime=0.5, sleeve="rolled")
    jobs += shirt_jobs(bp, (0.74, 0.76, 0.72), "check", seed=1)
    jobs += trouser_jobs(bp, WC.overalls_paint(), name="overalls")
    bf = WC.bib_field(bp)
    jobs.append(PA.ring_job(WC.build_bib(bf), "bib", bf, WC.overalls_paint(), weight=0.7))
    br = WC.braces_field(bp)
    jobs.append(PA.sculpt_job("braces", br, WC.overalls_paint(), (-0.2, -0.2, 1.0), (0.2, 0.2, 1.52), 0.0016, 700, weight=0.5))
    jobs += PA.boot_jobs(lambda side: WC.rubber_boot_sdf(side, top=bp["boot_top"] + 0.006), WC.rubber_paint(), tris=380, name="boot")
    jobs.append(hat_job("straw"))
    return jobs


CYCLIST = dict(
    head=HD.P(sex=1.0, age=0.22, hair="bun", hair_len=1.2, brows=0.7, lips=1.0, fat=0.4, nose_len=0.92, nose_w=0.85, jaw=0.92, chin=0.92,
              cheekbone=1.06, eye_open=1.08, neck=0.92),
    look=dict(skin="fair", hair="brown", iris="brown", stubble=0.0, grime=0.08, hatline=False, flush=1.2),
    body=BD.P(female=1.0, sleeves="full", chest=0.95, shoulders=0.93, arms=0.88, legs=0.92, hips=1.04, boot_top=0.16))


def cyclist_jobs():
    sp = CYCLIST
    bp = sp["body"]
    jobs = PA.head_jobs("head", sp["head"], sp["look"], fill=0.6)
    jobs += PA.hand_jobs({"R": "hold", "L": "hold"}, tone="fair", grime=0.05, sleeve="full", female=1.0, tris=480)
    jj, tf = jacket_jobs(bp, WC.RED, 0.90, 0.010, pockets=False, bust=True, belt=0.008,
                         paint=W.tunic_paint(WC.RED, hem_z=0.90, pockets=False, buttons=True, dust=0.15))
    jobs += jj
    sf = WC.skirt_field()
    jobs.append(PA.ring_job(WC.build_skirt(sf), "skirt", S.Displace(sf, WC.skirt_folds, 0.006), WC.skirt_paint(), weight=0.7,
                            skin=("override", WC.skirt_override())))
    legs = BD.P(female=1.0, legs=0.74, hips=0.92, boot_top=0.16)
    jobs += trouser_jobs(legs, WC.legwear_paint("fair", stocking=(0.50, 0.40, 0.34), under=(0.56, (0.07, 0.10, 0.24))),
                         name="stockings", weight=0.6)
    jobs += shoe_jobs((0.12, 0.05, 0.03))
    hf = WC.headscarf_field(sp["head"])
    jobs.append(PA.sculpt_job("headscarf", hf, WC.headscarf_paint(), (-0.11, -0.12, -0.16), (0.11, 0.14, 0.14), 0.0014, 900,
                              weight=0.8, skin=("rigid", "head"), origin=HD.HEAD_ORIGIN))
    return jobs


SHEPHERD = dict(
    head=HD.P(age=0.85, fat=0.1, cheekbone=1.2, jaw=1.0, nose_len=1.15, nose_bridge=1.2, brow=1.25, hair="short", hairline=0.55,
              moustache="walrus", beard=0.85, sideburns=0.4, eye_open=0.8, neck=0.95),
    look=dict(skin="weathered", hair="white", beard_color="white", moustache_color="white", iris="grey", stubble=0.3, grime=0.3,
              hatline=True, flush=1.1),
    body=BD.P(chest=0.97, shoulders=0.98, arms=0.95, legs=0.97, sleeves="full", boot_top=0.24))


def shepherd_jobs():
    sp = SHEPHERD
    bp = sp["body"]
    jobs = PA.head_jobs("head", sp["head"], sp["look"], fill=0.8)
    jobs += PA.hand_jobs({"R": "relaxed", "L": "hold"}, tone="weathered", grime=0.45, sleeve="full")
    jj, tf = jacket_jobs(bp, WC.RED, 0.80, 0.016, pockets=True, belt=0.0,
                         paint=W.tunic_paint(WC.RED, hem_z=0.80, pockets=True, buttons=True, dust=0.35))
    jobs += jj
    jobs += trouser_jobs(bp, W.trouser_paint((0.20, 0.15, 0.10)), weight=0.6)
    jobs += PA.boot_jobs(lambda side: W.combat_boot_sdf(side, top=bp["boot_top"] + 0.004),
                         W.combat_boot_paint((0.13, 0.08, 0.05)), tris=400, name="boot")
    kf = WC.knit_scarf_field()
    jobs.append(PA.sculpt_job("scarf", kf, WC.knit_paint(), (-0.14, -0.18, 1.18), (0.14, 0.14, 1.60), 0.0018, 700, weight=0.7))
    hat = PL.hat_job("flat", "hat")
    hat.update(ao_group="body", weight=0.55)
    hat["paint"] = felt_hat_paint()
    jobs.append(hat)
    # the crook, held in the left fist (socket.hand.L's frame), rigid on hand.L
    Ml = K.SOCK_L
    cf = WC.crook_field()
    ob = C.decimated("crook", cf, (-0.03, -0.18, -0.97), (0.03, 0.03, 0.67), 0.0020, 700, None, M=Ml[:3, :3], o=Ml[:3, 3])
    jobs.append(dict(ob=ob, field=cf, paint=WC.crook_paint, origin=Ml[:3, 3], M=Ml[:3, :3], weight=0.35, ao_field=cf,
                     smart_uv=True, uv_angle=70, skin=("rigid", "hand.L")))
    return jobs


def felt_hat_paint():
    base = OF.hat_paint("flat")

    def paint(P):
        c, r, m = base(P)
        c = c * np.array([0.8, 0.95, 0.75]) + np.array([0.0, 0.01, 0.0])
        return np.clip(c, 0, 1), r, m
    return paint


CHILD = dict(
    head=HD.P(age=0.0, fat=1.0, jaw=0.80, chin=0.84, nose_len=0.74, nose_w=0.9, nose_bridge=0.7, nose_tip=1.1, brow=0.5, cheekbone=0.8,
              lips=0.92, mouth_w=0.9, eye_open=1.18, hair="short", hair_len=1.2, hairline=0.0, brows=0.8, neck=0.80, width=1.04),
    look=dict(skin="fair", hair="blond", iris="blue", stubble=0.0, grime=0.2, hatline=False, flush=1.5),
    body=BD.P(chest=0.86, shoulders=0.88, arms=0.86, legs=0.84, hips=0.88, sleeves="full", boot_top=0.60, shirt_loose=0.98))
CHILD_HEAD = 1.30                                            # his head against the adult's
CHILD_HEAD_ORIGIN = HD.HEAD_ORIGIN + np.array([0.0, 0.004, -0.028])


def child_jobs():
    sp = CHILD
    bp = sp["body"]
    jobs = PA.head_jobs("head", sp["head"], sp["look"], scale=CHILD_HEAD, origin=CHILD_HEAD_ORIGIN, weight=3.0, fill=1.25)
    jobs += PA.hand_jobs({"R": "open", "L": "relaxed"}, tone="fair", grime=0.4, sleeve="full", thin=0.55, tris=440)
    jj, tf = jacket_jobs(bp, WC.YELLOW, 0.86, 0.008, name="jumper", pockets=False, belt=0.0, paint=WC.knit_jumper_paint())
    jobs += jj
    jobs += trouser_jobs(bp, W.trouser_paint((0.10, 0.14, 0.30)), name="shorts", weight=0.6)
    legs = BD.P(legs=0.66, hips=0.82, boot_top=0.15)
    jobs += trouser_jobs(legs, WC.legwear_paint("fair", sock_top=0.44, under=(0.60, (0.10, 0.14, 0.30))), name="legs", weight=0.7)
    jobs += shoe_jobs((0.06, 0.04, 0.03), tris=300)
    return jobs


PEOPLE = [("var.person.farmer", "farmer", farmer_jobs), ("var.person.cyclist", "cyclist", cyclist_jobs),
          ("var.person.shepherd", "shepherd", shepherd_jobs), ("var.person.child", "child", child_jobs)]


def build(path, size=1024, quick=False):
    t0 = time.time()
    bl.clear_scene()
    rig = SK.create_armature("rig")
    sockets = {}
    for mesh_name, atlas, fn in PEOPLE:
        log(f"civilian: {atlas} ({time.time() - t0:.0f}s)")
        jobs = fn()
        if atlas == "cyclist":
            jobs += BK.jobs(quick)
        for j in jobs:
            log(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
        on_weighted = (lambda r: BK.add_bones(r)) if atlas == "cyclist" else None
        ob = AS.person(mesh_name, jobs, rig, sockets, [(atlas, lambda j: True)], size, proxy_res=0.0075 if quick else 0.0055,
                       on_weighted=on_weighted)
        if atlas == "child":
            ob["scale"] = CHILD_SCALE
        log(f"   {mesh_name}: {bl.tri_count(ob)} tris")
    log(f"civilian: animating ({time.time() - t0:.0f}s)")
    animate(rig)
    size_b = PL.export(path)
    log(f"civilian: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path


def animate(rig, clips=None, only=None):
    import importlib
    from . import clips_civilian as CC
    importlib.reload(CC)
    clips = clips or CC.CLIPS
    for a in list(bpy.data.actions):
        if only is None or a.name in only:
            bpy.data.actions.remove(a)
    todo = {k: v for k, v in clips.items() if only is None or k in only}
    PL.bake_clips(rig, todo)
    if "cycle" in todo:
        act = bpy.data.actions["cycle"]
        rig.animation_data_create()
        n = int(round(2 * BK.CRANK_T * 30))
        BK.key_rotations(rig, act, CC.bicycle_rotations, 30, n)
        rig.animation_data.action = None
        for pb in rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
