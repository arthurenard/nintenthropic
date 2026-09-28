"""soldier.glb: one infantryman of a fictional mid-century army, and the
variants that make the valley's sentries, patrols, drivers, the officer, the
machine-gunners and the counter-sniper out of him.

    char.soldier        head, tunic, trousers into boots, webbing (always on)
    var.helmet          steel helmet with its chin strap      (rigid on head)
    var.cap.officer     peaked service cap                    (rigid on head)
    var.coat.officer    the officer's dark greatcoat, belted, with a holster
    var.ghillie         the counter-sniper's hooded suit of burlap and scrim
    var.pack            rucksack, rolled groundsheet, entrenching tool (rigid on chest)
    socket.gun          on hand.R:  gun.rifle, gun.rifle.scoped (+ socket.glint),
                                    gun.mg, prop.binoculars
    socket.hand.L       on hand.L:  prop.cigarette
    socket.back         on chest:   gun.rifle.slung

Two 1024 atlases: `soldier` (the man and what he wears) and `soldier_kit`
(the weapons, binoculars, cigarette and the ghillie suit).
"""
import time
import numpy as np
import bpy
from mathutils import Matrix
from . import env, assemble as AS, parts as PA, wear as W, arms as AR, ghillie as GH
from charlib import bl, sdf as S, body as BD, head as HD, hands as HN, garments as G, rings as R, skeleton as SK
from charlib import character as C, pipeline as PL
from charlib.texture import srgb

log = env.log

SOLDIER = dict(
    head=HD.P(age=0.28, hair="crop", hair_len=0.9, jaw=1.08, chin=1.05, brow=1.15, cheekbone=1.1, fat=0.15, nose_bridge=1.08,
              nose_len=1.02, lips=0.85, beard=0.0, neck=1.08),
    look=dict(skin="tanned", hair="brown", iris="brown", stubble=0.35, grime=0.35, hatline=False, flush=0.9),
    body=BD.P(sleeves="full", boot_top=0.255, chest=1.03, shoulders=1.04, arms=1.03, legs=1.02),
)
HEM = 0.845
LOOSE = 0.009


def socket_matrices():
    """World 4x4 of each socket in the rest pose. socket.hand.L is
    socket.gun mirrored across x = 0 (the left fist is the right one
    mirrored); socket.back is world-aligned behind the right shoulder."""
    Mg = HN.grip_socket_matrix()
    Sx = np.diag([-1.0, 1.0, 1.0, 1.0])
    Ml = Sx @ Mg @ Sx
    Mb = np.eye(4)
    Mb[:3, 3] = (-0.12, 0.10, 1.35)
    return {"socket.gun": (Mg, "hand.R"), "socket.hand.L": (Ml, "hand.L"), "socket.back": (Mb, "chest")}


def make_sockets(rig):
    out = {}
    for name, (M, bone) in socket_matrices().items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "ARROWS"
        e.empty_display_size = 0.08
        bpy.context.scene.collection.objects.link(e)
        e.parent = rig
        e.parent_type = "BONE"
        e.parent_bone = bone
        e.matrix_world = Matrix(M.tolist())
        out[name] = e
    return out


def body_jobs(spec, quick=False):
    """The man as he always is: head, hands, tunic, trousers, boots, webbing."""
    bp = spec["body"]
    jobs = PA.head_jobs("head", spec["head"], spec["look"], tris=1900)
    jobs += PA.hand_jobs({"R": "grip", "L": "hold"}, tone=spec["look"]["skin"], grime=0.45, sleeve="full")
    tf = W.tunic_field(bp, HEM, LOOSE)
    rm = W.build_tunic(bp, tf, HEM, loose=LOOSE)
    jobs.append(PA.ring_job(rm, "tunic", S.Displace(tf, W.tunic_details(bp, HEM), 0.006), W.tunic_paint(W.OLIVE, hem_z=HEM),
                            weight=1.0, skin=("coat", HEM), part="tunic"))
    jobs[-1]["ao_field"] = tf
    trf = BD.trousers(bp)
    rt = G.build_trousers(bp, trf)
    jobs.append(PA.ring_job(rt, "trousers", S.Displace(trf, C.trouser_folds(bp), 0.006), W.trouser_paint(W.OLIVE), weight=0.7, part="trousers"))
    jobs[-1]["ao_field"] = trf
    jobs += PA.boot_jobs(lambda side: W.combat_boot_sdf(side, top=bp["boot_top"] + 0.004), W.combat_boot_paint(), tris=420)
    wf, _ = W.webbing_field(tf)
    jobs.append(PA.sculpt_job("webbing", wf, W.webbing_paint(), (-0.25, -0.20, 0.82), (0.25, 0.22, 1.56), 0.0018, 1100,
                              weight=0.7, part="webbing"))
    return jobs, tf, wf


def variant_jobs(spec, tf, wf, quick=False):
    bp = spec["body"]
    jobs = []
    # the helmet and its chin strap: one mesh, one field, rigid on the head
    hf = W.helmet_field()
    hm = W.helmet_rings(hf)
    helmet = R.to_blender(hm, "var.helmet")
    bl.set_verts(helmet, bl.verts_np(helmet) + HD.HEAD_ORIGIN.astype(np.float32))
    sf = W.chin_strap_field(spec["head"])
    strap = C.decimated("strap", sf, (-0.10, -0.09, -0.14), (0.10, 0.03, 0.02), 0.0010, 240, None, M=np.eye(3), o=HD.HEAD_ORIGIN)
    helmet = bl.join([helmet, strap], "var.helmet")
    both = S.Union([hf, sf], k=0.0)

    def helmet_paint(P, hp=W.helmet_paint(), sp=W.strap_paint, sf=sf, hf=hf):
        c, r, m = hp(P)
        on_strap = sf(P) < hf(P)
        c2, r2, m2 = sp(P)
        c[on_strap], r[on_strap], m[on_strap] = c2[on_strap], r2[on_strap], m2[on_strap]
        return c, r, m
    jobs.append(dict(ob=helmet, field=both, paint=helmet_paint, origin=HD.HEAD_ORIGIN, weight=1.1, ao_field=both, ao_group="var.helmet",
                     smart_uv=True, uv_angle=66, skin=("rigid", "head")))
    # the officer's cap
    cf = W.cap_field()
    jobs.append(PA.ring_job(W.cap_rings(cf), "var.cap.officer", cf, W.cap_paint(), weight=0.9, skin=("rigid", "head"),
                            ao_group="var.cap.officer", origin=HD.HEAD_ORIGIN, smart_uv=True, uv_angle=66))
    # the officer's greatcoat: over the tunic and its webbing, to below the knee
    jobs.append(greatcoat_job(bp))
    # the pack
    pf = W.pack_field()
    jobs.append(PA.sculpt_job("var.pack", pf, W.pack_paint(), (-0.2, 0.09, 1.02), (0.2, 0.34, 1.52), 0.0025, 900,
                              weight=0.6, skin=("rigid", "chest"), ao_group="var.pack"))
    return jobs


def greatcoat_job(bp, hem=0.50, loose=0.027):
    """A double-breasted greatcoat to below the knee, belted, its collar
    turned down wide over the tunic's, the skirt parting a little at the hem."""
    cf = W.tunic_field(bp, hem, loose, belt=0.004)
    cf = S.Union([cf, holster_field()], k=0.004)

    def front_open(z):
        return float(np.interp(z, [0.45, 0.58, 0.66], [0.9, 0.4, 0.0]))
    rm = W.build_tunic(bp, cf, hem, loose=loose, sleeve_loose=0.019, neck_open=1.4, front_open=front_open, belt=0.004,
                       collar_grow=0.034)
    j = PA.ring_job(rm, "var.coat.officer", S.Displace(cf, W.tunic_details(bp, hem, pockets=False), 0.006), W.greatcoat_paint(), weight=0.55,
                    skin=("coat", hem), ao_group="var.coat.officer")
    j["ao_field"] = cf
    # the pistol holster on the belt, left front (butt forward): its own mesh, same variant
    return j


def holster_field():
    """A small closed pistol holster on the greatcoat's belt, his left hip."""
    c = np.array([0.175, -0.07, 0.975])
    body = S.Box(c, (0.016, 0.055, 0.050), S.rot_x(-25) @ S.rot_z(-20), rad=0.012)
    flap = S.Box(c + np.array([0.0, -0.01, 0.045]), (0.018, 0.045, 0.014), S.rot_x(-25) @ S.rot_z(-20), rad=0.008)
    return S.Union([body, flap], k=0.004)


def kit_jobs(sockets_M):
    jobs = []
    Mg = sockets_M["socket.gun"][0]
    Ml = sockets_M["socket.hand.L"][0]
    Mb = sockets_M["socket.back"][0]

    def prop(name, field, paint, lo, hi, res, tris, M4, socket, weight):
        M, o = M4[:3, :3], M4[:3, 3]
        ob = C.decimated(name, field, lo, hi, res, tris, None, M=M, o=o)
        return dict(ob=ob, field=field, paint=paint, origin=o, M=M, weight=weight, ao_field=field, ao_group=name, ao_self_only=True,
                    smart_uv=True, uv_angle=70, skin=("prop",), socket=socket)
    jobs.append(prop("gun.rifle", AR.rifle_field(), AR.rifle_paint(), (-0.06, AR.BUTT_Y - 0.02, -0.12), (0.06, AR.MUZZLE_Y + 0.02, 0.08),
                     0.0012, 1100, Mg, "socket.gun", 0.9))
    jobs.append(prop("gun.rifle.scoped", AR.rifle_field(True), AR.rifle_paint(True), (-0.06, AR.BUTT_Y - 0.02, -0.12), (0.06, AR.MUZZLE_Y + 0.02, 0.13),
                     0.0012, 1400, Mg, "socket.gun", 0.9))
    jobs.append(prop("gun.mg", AR.mg_field(), AR.mg_paint, (-0.13, -0.42, -0.28), (0.13, AR.MG_MUZZLE_Y + 0.02, 0.36),
                     0.0015, 1500, Mg, "socket.gun", 0.8))
    bf = AR.binoculars_field()
    jobs.append(prop("prop.binoculars", bf, AR.binoculars_paint, bf.lo, bf.hi, 0.0010, 520, Mg, "socket.gun", 0.7))
    cg = AR.cigarette_field()
    jobs.append(prop("prop.cigarette", cg, AR.cigarette_paint, cg.lo - 0.005, cg.hi + 0.005, 0.0006, 60, Ml, "socket.hand.L", 0.3))
    sf = AR.slung_field()
    ob = C.decimated("gun.rifle.slung", sf, sf.lo, sf.hi, 0.0013, 1150, None)
    jobs.append(dict(ob=ob, field=sf, paint=AR.slung_paint(), origin=np.zeros(3), weight=0.5, ao_field=sf, ao_group="gun.rifle.slung",
                     smart_uv=True, uv_angle=70, skin=("prop",), socket="socket.back"))
    return jobs


def glint_socket(scoped_ob, Mg):
    """socket.glint: an empty on the scope's objective lens, child of
    gun.rifle.scoped, axes as socket.gun's (glTF -Z out through the lens)."""
    e = bpy.data.objects.new("socket.glint", None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.03
    bpy.context.scene.collection.objects.link(e)
    e.parent = scoped_ob
    e.matrix_parent_inverse = Matrix.Identity(4)
    e.location = (0.0, AR.LENS_Y + 0.001, AR.SCOPE_Z)
    return e


def build(path, size=1024, quick=False, clips=None):
    t0 = time.time()
    bl.clear_scene()
    spec = SOLDIER
    log("soldier: sculpting the man")
    jobs, tf, wf = body_jobs(spec, quick)
    log(f"soldier: wardrobe ({time.time() - t0:.0f}s)")
    jobs += variant_jobs(spec, tf, wf, quick)
    jobs += GH.ghillie_jobs(spec, tf, wf, quick)
    SM = socket_matrices()
    jobs += kit_jobs(SM)
    for j in jobs:
        log(f"   {j['ob'].name}: {bl.tri_count(j['ob'])} tris")
    rig = SK.create_armature("rig")
    sockets = make_sockets(rig)
    kit = lambda j: j["ob"].name.startswith(("gun.", "prop.", "var.ghillie"))
    log(f"soldier: baking and rigging ({time.time() - t0:.0f}s)")
    AS.person("char.soldier", jobs, rig, sockets, [("soldier_kit", kit), ("soldier", lambda j: True)], size,
              proxy_res=0.0075 if quick else 0.0055)
    glint_socket(bpy.data.objects["gun.rifle.scoped"], SM["socket.gun"][0])
    log(f"soldier: animating ({time.time() - t0:.0f}s)")
    animate(rig, clips)
    size_b = PL.export(path)
    log(f"soldier: wrote {path} ({size_b / 1024:.0f} KB) in {time.time() - t0:.0f}s")
    return path


def animate(rig, clips=None, only=None):
    """(Re)bake the clips onto the rig: every action is replaced."""
    import importlib
    from . import clips_soldier as CS
    importlib.reload(CS)
    clips = clips or CS.CLIPS
    for a in list(bpy.data.actions):
        if only is None or a.name in only:
            bpy.data.actions.remove(a)
    PL.bake_clips(rig, {k: v for k, v in clips.items() if only is None or k in only})
