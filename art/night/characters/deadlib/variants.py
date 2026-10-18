"""The other dead of walker.glb, each a whole person on the shared rig:

    char.runner     recently dead, young and lean: a letterman jacket, jeans,
                   sneakers; the face still close to a face
    char.bloater    swollen tight, pale green and marbled: a stained undershirt
                   ridden up over a huge belly, braces straining; puffy face
    char.crawler   an old man whose legs end below the knees - the trousers torn
                   off there, the stumps bound in dark rags (no gore) - who
                   drags himself on his claws

They share the walker's eyes (every dead head seats its eyeballs the same).
"""

import numpy as np

from .common import S, BD, PT, srgb, smoothstep, value_noise, fbm, JOINTS
from . import meshfix as MF
from . import heads as H, bodies, outfits as O, hair as HR


HEADS = {
    # name: (head params, dead params, look, hair style (thickness, extra, colour, grey, greasy))
    "runner": (dict(age=0.25, fat=0.1, cheekbone=1.05, jaw=1.0, chin=1.05, brow=1.0, eye_open=0.8, lips=1.0, neck=0.92, hair="bald"),
               dict(sunken=0.45, gaunt=0.35, mouth=0.75, fresh=0.65),
               dict(tone="fresh", grime=0.35, stubble=0.15, trickle=-1, seed=41, scratch=((-0.03, -0.09, 0.02), (-0.06, -0.06, -0.05))),
               (dict(hair="short", hair_len=1.3, hairline=0.0), None, (0.20, 0.14, 0.09), 0.0, 0.2)),
    "bloater": (dict(age=0.6, fat=1.0, cheekbone=0.9, jaw=1.15, chin=0.9, brow=1.0, eye_open=1.15, lips=1.2, neck=1.05, width=1.04, hair="bald"),
                dict(sunken=0.35, gaunt=0.0, mouth=0.4, swollen=1.0, fresh=0.0),
                dict(tone="bloat", grime=0.5, stubble=0.6, trickle=1, seed=61),
                (dict(hair="short", hair_len=0.7, hairline=0.7), None, (0.30, 0.28, 0.24), 0.3, 0.6)),
    "crawler": (dict(age=1.0, fat=0.05, cheekbone=1.1, jaw=0.98, chin=1.1, brow=1.1, eye_open=0.55, lips=0.7, neck=0.9, width=0.97,
                     nose_len=1.02, nose_bridge=1.12, hair="bald"),
                dict(sunken=0.85, gaunt=0.95, mouth=0.85, fresh=0.0),
                dict(tone="ashen", grime=0.8, stubble=0.8, trickle=1, seed=81, scratch=((0.02, -0.095, 0.05), (0.06, -0.07, 0.0))),
                (dict(hair="short", hair_len=0.6, hairline=0.9), None, (0.55, 0.53, 0.5), 0.6, 0.0)),
}


def head_with_hair(prefix, who, quick=False, coll=None):
    head_kw, dead, look, style = HEADS[who]
    p = H.P(**head_kw, dead=dead)
    jobs, field = H.make(f"{prefix}.head", p, look, coll, tris=4400 if quick else 6000)
    jobs.append(HR.job(f"{prefix}.hair", jobs[0]["ob"], p, style, coll, seed=5))
    return jobs, p


def runner(quick=False, coll=None):
    bp = BD.P(sleeves="full", chest=0.93, shoulders=0.96, arms=0.9, legs=0.94, shirt_loose=0.98, boot_top=0.13)
    jobs, p = head_with_hair("runner", "runner", quick=quick, coll=coll)
    jobs += bodies.hand_jobs("runner", tone="fresh", fresh=0.6, sleeve="full", tris=600 if quick else 800, coll=coll, seed=5)

    def tee(P):
        c, r, m = O.fabric(P, (0.72, 0.72, 0.70), "cotton", seed=51, wear=1.0)
        return c, r, m

    def jacket(P):
        # a letterman jacket: maroon wool body, cream leather sleeves, striped cuffs
        c, r, m = O.fabric(P, (0.36, 0.07, 0.08), "wool", seed=53, wear=0.9)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        arm = np.abs(x) > 0.2
        lc, lr, lm = PT.leather(P, (0.78, 0.74, 0.62), 0.0, 0.5, seed=55)
        lc, lr = O.grave_wear(P, lc, lr, 0.9, seed=57, mud=False)
        c[arm], r[arm] = lc[arm], lr[arm]
        for tag in ("L", "R"):
            wr = np.array(JOINTS[f"hand.{tag}"][0])
            cuff = np.linalg.norm(P - wr, axis=1) < 0.075
            stripe = cuff & (np.abs(np.sin(np.linalg.norm(P - wr, axis=1) * 180)) > 0.6)
            c[cuff] = srgb(0.36, 0.07, 0.08)
            c[stripe] = srgb(0.8, 0.76, 0.62)
        letter = (y < -0.08) & (np.abs(x - 0.09) < 0.035) & (np.abs(z - 1.30) < 0.04)
        c[letter] = srgb(0.82, 0.78, 0.64)
        return c, r, m

    def jeans(P):
        return O.fabric(P, (0.20, 0.26, 0.38), "denim", seed=59, wear=0.9, stains=False)
    jobs += [O.shirt_part(bp, "runner.tee", tee, coll), O.trousers_part(bp, "runner.jeans", jeans, coll),
             O.coat_part(bp, "runner.jacket", jacket, hem_z=0.92, flare=0.3, coll=coll, seed=5)]
    jobs += O.boots_parts("runner", (0.78, 0.76, 0.72), coll, shoes=True, shine=0.0, muddy=1.2)
    return jobs


def bloater(quick=False, coll=None):
    bp = BD.P(sleeves="none", chest=1.2, shoulders=1.08, arms=1.25, legs=1.2, belly=1.0, shirt_loose=1.12, boot_top=0.2, hips=1.15)
    jobs, p = head_with_hair("bloater", "bloater", quick=quick, coll=coll)
    # bare swollen arms: the hands with long forearms up into the undershirt's armholes
    jobs += bodies.hand_jobs("bloater", tone="bloat", sleeve="rolled", bony=-0.004, tris=600 if quick else 800, coll=coll, seed=9)
    # upper arms: fat swollen tubes of skin from the shoulder to the elbow
    arms = []
    for tag in ("L", "R"):
        sh = np.array(JOINTS[f"upper_arm.{tag}"][0])
        el = np.array(JOINTS[f"forearm.{tag}"][0])
        wr = np.array(JOINTS[f"hand.{tag}"][0])
        f = S.Union([S.RoundCone(sh, el, 0.060, 0.050), S.RoundCone(el, el + (wr - el) * 0.6, 0.050, 0.043)], k=0.02)
        ob = MF.decimated(f"bloater.arm.{tag}", f, np.minimum(sh, wr) - 0.1, np.maximum(sh, wr) + 0.1, 0.002, 500, coll)

        def ap(P, tag=tag):
            c, r = H.dead_skin(P, P * 3 + 1.0, "bloat", 0.0, 0.5, seed=63)
            ridge = 1 - np.abs(2 * fbm(P, 40, 3, seed=65) - 1)
            v = smoothstep(0.9, 0.97, ridge)
            c = c * (1 - 0.4 * v[:, None]) + srgb(0.26, 0.32, 0.30) * 0.4 * v[:, None]
            return c, r - 0.15, np.zeros(len(P))
        arms.append(dict(ob=ob, field=f, paint=ap, origin=np.zeros(3), weight=0.7, ao_field=f, smart_uv=True, uv_angle=70))
    jobs += arms
    # the torso: a vest undershirt stretched over a huge round belly
    tor = BD.torso_tube(bp)
    belly = S.Ellipsoid((0.0, -0.10, 1.10), (0.20, 0.17, 0.20))
    tf = S.Union([tor, belly], k=0.08)
    # the shoulders: rounded caps where the swollen arms go in (not the
    # shirt's sleeve heads, which ballooned on this chest)
    caps = [S.RoundCone(np.array(JOINTS[f"upper_arm.{t}"][0]) * np.array([0.6, 1, 1]) + np.array([0, 0, 0.01]),
                        np.array(JOINTS[f"upper_arm.{t}"][0]), 0.066, 0.058) for t in ("L", "R")]
    shf = S.Union([tf] + caps, k=0.04)
    ob = MF.decimated("bloater.torso", shf, (-0.36, -0.32, 0.90), (0.36, 0.25, 1.56), 0.003, 2600 if not quick else 1600, coll, symmetry=True)

    def undershirt(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        c, r, m = O.fabric(P, (0.70, 0.68, 0.58), "cotton", seed=67, wear=1.3)
        # where it rode up and split: the belly's skin, marbled green-grey
        sk, sr = H.dead_skin(P, P * 2 + 3.0, "bloat", 0.0, 0.4, seed=69)
        ridge = 1 - np.abs(2 * fbm(P, 30, 3, seed=71) - 1)
        v = smoothstep(0.9, 0.97, ridge)
        sk = sk * (1 - 0.45 * v[:, None]) + srgb(0.24, 0.32, 0.30) * 0.45 * v[:, None]
        exposed = (z < 1.12 + 0.04 * np.sin(x * 20)) & (y < 0.02)
        exposed |= (y < -0.1) & (np.abs(x) < 0.06 + 0.02 * np.sin(z * 30)) & (z < 1.3)
        c[exposed], r[exposed] = sk[exposed], sr[exposed] - 0.2
        # the armholes' and shoulders' bare skin (it is a singlet)
        bare = (np.abs(x) > 0.17) | ((z > 1.44) & (np.abs(x) > 0.07))
        c[bare], r[bare] = sk[bare], sr[bare]
        return c, r, m
    jobs.append(dict(ob=ob, field=shf, paint=undershirt, origin=np.zeros(3), weight=1.1, ao_field=shf, smart_uv=True, uv_angle=60))

    def trousers(P):
        c, r, m = O.fabric(P, (0.30, 0.26, 0.20), "wool", seed=73, wear=1.1, stains=False)
        # braces over the shoulders
        return c, r, m
    trp = O.trousers_part(bp, "bloater.trousers", trousers, coll)
    jobs.append(trp)
    jobs += O.boots_parts("bloater", (0.12, 0.09, 0.07), coll, top=0.2)
    return jobs


def crawler(quick=False, coll=None):
    bp = BD.P(sleeves="rolled", chest=0.95, arms=0.95, legs=0.9, shirt_loose=1.08, boot_top=0.40)
    jobs, p = head_with_hair("crawler", "crawler", quick=quick, coll=coll)
    jobs += bodies.hand_jobs("crawler", tone="ashen", sleeve="rolled", tris=600 if quick else 900, coll=coll, seed=11)

    def shirt(P):
        c, r, m = O.fabric(P, (0.56, 0.52, 0.44), "cotton", seed=83, wear=1.5)
        return O.shirt_extras(P, c), r, m

    def trousers(P):
        c, r, m = O.fabric(P, (0.22, 0.20, 0.18), "wool", seed=85, wear=1.4, stains=False)
        # the torn ends: ragged, dark
        end = smoothstep(0.58, 0.5, P[:, 2])
        c = c * (1 - 0.6 * end[:, None])
        return c, r, m
    jobs.append(O.shirt_part(bp, "crawler.shirt", shirt, coll))
    trp = O.trousers_part(bp, "crawler.trousers", trousers, coll)
    cut_below(trp["ob"], 0.47)
    jobs.append(trp)
    # the stumps: bound in rags, a bundle at each knee
    for tag in ("L", "R"):
        kn = np.array(JOINTS[f"shin.{tag}"][0])
        an = np.array(JOINTS[f"foot.{tag}"][0])
        d = (an - kn) / np.linalg.norm(an - kn)
        c0 = kn + d * 0.03
        f = S.Union([S.RoundCone(kn - d * 0.03, c0 + d * 0.035, 0.062, 0.05),
                     S.Ellipsoid(c0 + d * 0.045, (0.048, 0.048, 0.03))], k=0.015)

        def wrap(Pt):
            return (-0.002 * np.abs(np.sin((Pt @ d) * 160 + 2 * value_noise(Pt, 60, seed=87)))).astype(np.float32)
        f = S.Displace(f, wrap, 0.003)
        ob = MF.decimated(f"crawler.stump.{tag}", f, kn - 0.12, kn + 0.12, 0.0012, 300, coll)

        def rag(P):
            c, r, m = PT.fabric(P, (0.20, 0.17, 0.14), "canvas", dust_amt=0.0, fade=0.0, seed=89, grime=0.8)
            dark = smoothstep(0.5, 0.75, fbm(P, 40, 3, seed=91))
            c = c * (1 - 0.6 * dark[:, None]) + srgb(0.10, 0.05, 0.04) * 0.6 * dark[:, None]
            return c, r, m
        jobs.append(dict(ob=ob, field=f, paint=rag, origin=np.zeros(3), weight=0.4, ao_field=f, smart_uv=True, uv_angle=70))
    return jobs


def cut_below(ob, z):
    """Delete a garment below a height (the crawler's trousers end at the knee)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if all(v.co.z < z for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()


def build_all(quick=False):
    return {"char.runner": runner(quick), "char.bloater": bloater(quick), "char.crawler": crawler(quick)}
