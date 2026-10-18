"""The people of Dust Creek: who they are, what they wear, and how each file is built.

Colours are chosen for the street at golden hour: the facades are warm,
sunlit, mid-light wood, so the gang reads by value against them - dark hats,
dark coats, a red or black bandana - while the townsfolk are pale and
unarmed, as the design asks.
"""
import time
from . import bl, skeleton as SK, pipeline as PL, character as C, head as HD, body as BD
from . import hands as HN, clips_bandit as CB

LOG = PL.log

BANDIT = dict(
    name="bandit",
    head=HD.P(moustache="chevron", beard=0.35, age=0.35, hair="short", jaw=1.06, nose_bridge=1.12, brow=1.1, cheekbone=1.08, fat=0.2),
    look=dict(skin="tanned", hair="dark", iris="hazel", stubble=0.8, grime=0.4, hatline=True),
    body=BD.P(),
    shirt_color=(0.40, 0.45, 0.52), shirt_pattern=None,     # faded chambray: reads against sunlit planks
    trouser_color=(0.24, 0.21, 0.18),
    boot_color=(0.15, 0.09, 0.05),
    pose_R="grip", pose_L="relaxed",
)


def build_bandit(path, size=1024, quick=False):
    t0 = time.time()
    bl.clear_scene()
    spec = BANDIT
    coll = None
    LOG("bandit: sculpting the body")
    jobs = C.base_body(spec, coll, log=LOG)
    LOG("bandit: wardrobe")
    for kind, name in (("stetson", "var.hat.stetson"), ("bowler", "var.hat.bowler"), ("flat", "var.hat.flat")):
        jobs.append(PL.hat_job(kind, name, coll))
    jobs.append(PL.bandana_job(spec["head"], (0.55, 0.10, 0.07), "var.bandana.red", coll))
    jobs.append(PL.bandana_job(spec["head"], (0.075, 0.07, 0.065), "var.bandana.black", coll, pattern=False))
    jobs.append(PL.vest_job(spec["body"], (0.16, 0.12, 0.09), "var.vest", coll))
    jobs.append(PL.coat_job(spec["body"], (0.23, 0.19, 0.15), "var.coat.duster", hem_z=0.36, coll=coll, seed=1, kind="canvas"))
    jobs.append(PL.coat_job(spec["body"], (0.20, 0.19, 0.18), "var.coat.jacket", hem_z=0.84, coll=coll, seed=2, kind="wool"))
    jobs.append(PL.armour_job("var.armour", coll))
    sock = HN.grip_socket_matrix()
    for kind, name in (("revolver", "gun.revolver"), ("rifle", "gun.rifle"), ("dynamite", "prop.dynamite")):
        jobs.append(PL.prop_job(kind, name, sock, coll))
    for j in jobs:
        LOG(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    LOG(f"bandit: baking and rigging ({time.time() - t0:.0f}s)")
    rig = SK.create_armature("rig")
    socket = SK.add_socket(rig)
    PL.person("char.bandit", jobs, rig, socket, "bandit", size)
    LOG(f"bandit: animating ({time.time() - t0:.0f}s)")
    PL.bake_clips(rig, CB.CLIPS)
    size_b = PL.export(path)
    LOG(f"bandit: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path


# ------------------------------------------------------------------ Black Jack Carver

BOSS = dict(
    name="boss",
    head=HD.P(age=0.62, fat=0.1, cheekbone=1.2, jaw=1.15, chin=1.1, brow=1.3, nose_bridge=1.3, nose_len=1.08,
              hair="short", hairline=0.25, moustache="horseshoe", beard=0.45, sideburns=0.3, neck=1.1, eye_open=0.85),
    look=dict(skin="weathered", hair="dark", beard_color="salt", moustache_color="salt", grey=0.45, iris="grey", stubble=1.0,
              grime=0.35, flush=0.8, hatline=True,
              scar=((0.047, -0.087, 0.036), (0.029, -0.083, -0.052), 0.0038)),
    body=BD.P(chest=1.06, shoulders=1.07, arms=1.06, belly=0.12, legs=1.03),
    shirt_color=(0.30, 0.07, 0.06), trouser_color=(0.15, 0.14, 0.13), chaps=(0.05, 0.045, 0.04),
    boot_color=(0.05, 0.045, 0.04), gunbelt="twin", gunbelt_color=(0.06, 0.05, 0.045), holster_color=(0.07, 0.06, 0.05),
    fancy_guns=True, pose_R="grip", pose_L="relaxed",
)


def boss_revolver_paint(P):
    from . import paint as PT
    from .texture import srgb
    c, r, m = PT.metal(P, (0.70, 0.70, 0.68), 0.22, seed=141)
    grip = (P[:, 2] < 0.028) & (P[:, 1] < 0.0)
    c[grip] = srgb(0.86, 0.82, 0.72)
    r[grip] = 0.35
    m[grip] = 0.0
    return c, r, m


def build_boss(path, size=1024):
    t0 = time.time()
    bl.clear_scene()
    spec = BOSS
    LOG("boss: sculpting Black Jack Carver")
    jobs = C.base_body(spec, None, log=LOG)
    vest = PL.vest_job(spec["body"], (0.035, 0.032, 0.03), "vest", None, seed=5)
    vest["ao_group"] = "body"
    jobs.append(vest)
    jobs.append(PL.hat_job("boss", "var.hat.stetson", None, tris=600))
    jobs.append(PL.coat_job(spec["body"], (0.045, 0.042, 0.04), "var.coat.duster", hem_z=0.30, flare=1.15, seed=7, kind="canvas"))
    sock = HN.grip_socket_matrix()
    for kind, name in (("revolver", "gun.revolver"), ("rifle", "gun.rifle"), ("dynamite", "prop.dynamite")):
        j = PL.prop_job(kind, name, sock, None)
        if kind == "revolver":
            j["paint"] = boss_revolver_paint
        jobs.append(j)
    for j in jobs:
        LOG(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    rig = SK.create_armature("rig")
    socket = SK.add_socket(rig)
    PL.person("char.boss", jobs, rig, socket, "boss", size)
    PL.bake_clips(rig, CB.CLIPS)
    size_b = PL.export(path)
    LOG(f"boss: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path


# ------------------------------------------------------------------ the townsfolk

BARBER = dict(
    head=HD.P(age=0.55, hair="slick", hairline=0.65, moustache="handlebar", brows=1.2, fat=0.5, nose_tip=1.15, jaw=0.95, chin=0.95),
    look=dict(skin="fair", hair="salt", moustache_color="grey", iris="blue", stubble=0.1, grime=0.1, hatline=False, flush=1.4),
    body=BD.P(belly=0.35, sleeves="full", boot_top=0.14, shirt_loose=1.05),
    shirt_color=(0.84, 0.82, 0.76), shirt_pattern="stripe", trouser_color=(0.19, 0.18, 0.17), footwear="shoes",
    boot_color=(0.04, 0.035, 0.03), gunbelt=None, belt=True, garters=True, pose_R="open", pose_L="open",
)
WOMAN = dict(
    head=HD.P(sex=1.0, age=0.25, hair="bun", hair_len=1.3, brows=0.7, lips=1.05, fat=0.45, nose_len=0.9, nose_w=0.85,
              jaw=0.9, chin=0.9, cheekbone=1.05, eye_open=1.1, neck=0.9),
    look=dict(skin="fair", hair="auburn", iris="green", stubble=0.0, grime=0.05, hatline=False, flush=0.9),
    body=BD.P(female=1.0), outfit="dress", dress_color=(0.72, 0.64, 0.76), pose_R="open", pose_L="open",
)
UNDERTAKER = dict(
    head=HD.P(age=0.75, fat=0.0, cheekbone=1.25, jaw=1.05, chin=1.15, nose_len=1.15, nose_bridge=1.2, brow=1.2,
              hair="short", hair_len=0.7, hairline=0.35, sideburns=0.7, neck=0.9, eye_open=0.85, width=0.96),
    look=dict(skin="pale", hair="grey", beard_color="grey", iris="grey", stubble=0.15, grime=0.1, hatline=False, flush=0.3),
    body=BD.P(chest=0.95, shoulders=0.95, arms=0.9, legs=0.95, sleeves="full", boot_top=0.14),
    shirt_color=(0.80, 0.78, 0.72), trouser_color=(0.05, 0.045, 0.045), footwear="shoes", boot_color=(0.03, 0.03, 0.03),
    gunbelt=None, belt=False, cravat=True, pose_R="open", pose_L="open",
)


def apron_job(name="apron"):
    import numpy as np
    from . import garments as G, rings as R, paint as PT
    f = G.apron_field()
    rm = G.build_apron(f)
    ob = R.to_blender(rm, name)

    def paint(P):
        c, r, m = PT.fabric(P, (0.88, 0.86, 0.80), "cotton", dust_amt=0.2, fade=0.05, seed=151, grime=0.25)
        tie = P[:, 2] > 1.04
        c[tie] = c[tie] * 0.9
        return c, r, m
    return dict(ob=ob, field=f, paint=paint, origin=np.zeros(3), weight=0.6, ao_field=f, skin=("coat", 0.46))


def build_townsfolk(path, size=1024):
    """Three people on one armature, dressed by the game's outfit names: each
    var.coat.* is a whole person (the barber in his apron - with var.vest he is
    the bartender -, the woman in her dress, the undertaker in his black frock
    coat - hatless, the preacher), and var.hat.* / var.vest are worn on top."""
    t0 = time.time()
    bl.clear_scene()
    rig = SK.create_armature("rig")
    socket = SK.add_socket(rig)
    # the barber / bartender, with his vest and a straw hat
    LOG("townsfolk: the barber")
    jobs = C.base_body(BARBER, None, log=LOG)
    jobs.append(apron_job())
    jobs.append(PL.vest_job(BARBER["body"], (0.30, 0.10, 0.09), "var.vest", None, seed=9))
    jobs.append(PL.hat_job("straw", "var.hat.straw", None))
    PL.person("var.coat.apron", jobs, rig, socket, "townsman", size)
    # the woman on the hotel balcony
    LOG("townsfolk: the woman")
    jobs = C.base_body(WOMAN, None, log=LOG)
    jobs.append(PL.hat_job("bonnet", "var.hat.bonnet", None, tris=600))
    PL.person("var.coat.dress", jobs, rig, socket, "woman", size)
    # the undertaker (and, hatless, the preacher)
    LOG("townsfolk: the undertaker")
    jobs = C.base_body(UNDERTAKER, None, log=LOG)
    # a black waistcoat under the frock coat: without it the open front shows
    # a big white shirt bib, which reads as a hole at a distance
    waist = PL.vest_job(UNDERTAKER["body"], (0.03, 0.028, 0.028), "waistcoat", None, seed=12)
    waist["ao_group"] = "body"
    jobs.append(waist)
    coat = PL.coat_job(UNDERTAKER["body"], (0.035, 0.032, 0.032), "frockcoat", hem_z=0.55, flare=0.6, seed=11, kind="wool")
    coat["ao_group"] = "body"
    jobs.append(coat)
    jobs.append(PL.hat_job("top", "var.hat.top", None, tris=560))
    PL.person("var.coat.black", jobs, rig, socket, "undertaker", size)
    from . import clips_town as CT
    PL.bake_clips(rig, CT.CLIPS)
    size_b = PL.export(path)
    LOG(f"townsfolk: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path


def build_chicken(path, size=512):
    from . import chicken
    return chicken.build(path, size)
