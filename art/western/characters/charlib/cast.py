"""The people of Dust Creek: who they are, what they wear, and how each file is built.

Colours are chosen for the street at golden hour: the facades are warm,
sunlit, mid-light wood, so the gang reads by value against them - dark hats,
dark coats, a red or black bandana - while the townsfolk are pale and
unarmed, as the design asks.
"""
import time
import numpy as np
import bpy
from . import bl, abake as AB, materials as MT, skeleton as SK, pipeline as PL, character as C, head as HD, body as BD
from . import hands as HN, clips_bandit as CB

LOG = PL.log

BANDIT = dict(
    name="bandit",
    head=HD.P(moustache="chevron", beard=0.35, age=0.35, hair="short", jaw=1.06, nose_bridge=1.12, brow=1.1, cheekbone=1.08, fat=0.2),
    look=dict(skin="tanned", hair="dark", iris="hazel", stubble=0.8, grime=0.4, hatline=True),
    body=BD.P(),
    shirt_color=(0.55, 0.47, 0.36), shirt_pattern=None,
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
    jobs.append(PL.coat_job(spec["body"], (0.30, 0.25, 0.19), "var.coat.duster", hem_z=0.36, coll=coll, seed=1, kind="canvas"))
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
