"""Assembling a person: every part as a game mesh plus the field and paint to bake it.

A "job" is one game mesh with what the atlas baker needs:
  ob       the Blender mesh (world space)
  field    the sculpt it is baked from (in the part's own frame)
  paint    points in that frame -> (albedo, roughness, metalness)
  origin/M the frame: local = (world - origin) @ M
  weight   relative texel density in the atlas
  ao_group which parts may shadow it (variants never shadow the body)
"""
import numpy as np
from . import sdf as S, polygonize as PG, bl, head as HD, hands as HN, body as BD, garments as G, rings as R, gear as GR, paint as PT
from .texture import srgb, smoothstep, value_noise, fbm


def decimated(name, field, lo, hi, res, tris, coll=None, M=None, o=None, blur=1.0, symmetry=False):
    V, Q = PG.mesh_sdf(field, lo, hi, res, blur=blur)
    if M is not None:
        V = V @ np.asarray(M, np.float32).T + np.asarray(o, np.float32)
    ob = bl.mesh_from_arrays(name, V, Q, coll)
    if M is not None and np.linalg.det(M) < 0:
        bl.recalc_normals(ob)
    bl.decimate(ob, tris, symmetry=symmetry)
    return ob


# ------------------------------------------------------------------ folds

def sleeve_folds(bp):
    """Cloth folds as a small displacement: compression rings inside the elbow,
    drape lines down the torso, blousing over the belt."""
    from .garments import point_on_arm
    def f(P):
        z = P[:, 2]
        d = np.zeros(len(P))
        # blousing: horizontal soft folds just above the belt
        bl_ = smoothstep(1.00, 1.04, z) * (1 - smoothstep(1.10, 1.16, z)) * (np.abs(P[:, 0]) < 0.3)
        d += 0.0035 * bl_ * np.sin(z * 2 * np.pi / 0.028 + 3 * value_noise(P, 30, seed=5))
        # long vertical drape on the torso
        th = np.arctan2(P[:, 0], -P[:, 1])
        tor = smoothstep(1.02, 1.1, z) * (1 - smoothstep(1.36, 1.42, z)) * (np.abs(P[:, 0]) < 0.19)
        d += 0.0022 * tor * np.sin(th * 9 + 4 * value_noise(P, 12, seed=6)) ** 3
        # elbows: bunched rings on the inside of each sleeve
        for tag in ("L", "R"):
            from .skeleton import JOINTS
            el = np.array(JOINTS[f"forearm.{tag}"][0])
            q = P - el
            r = np.linalg.norm(q, axis=1)
            m = np.exp(-(r / 0.07) ** 2) * (np.abs(P[:, 0]) > 0.25)
            d += 0.004 * m * np.sin(r * 2 * np.pi / 0.022 + 5 * value_noise(P, 50, seed=7))
            # armpit gathers
            sh = np.array(JOINTS[f"upper_arm.{tag}"][0])
            ap = sh + np.array([-0.02 * np.sign(sh[0]), 0.0, -0.09])
            r2 = np.linalg.norm(P - ap, axis=1)
            d += 0.003 * np.exp(-(r2 / 0.06) ** 2) * np.sin(np.arctan2(P[:, 1] - ap[1], P[:, 2] - ap[2]) * 7) ** 2
        return (-d).astype(np.float32)
    return f


def trouser_folds(bp):
    def f(P):
        z = P[:, 2]
        d = np.zeros(len(P))
        from .skeleton import JOINTS
        for tag in ("L", "R"):
            kn = np.array(JOINTS[f"shin.{tag}"][0])
            q = P - kn
            r = np.linalg.norm(q, axis=1)
            behind = smoothstep(-0.01, 0.03, q[:, 1])
            d += 0.0014 * np.exp(-(r / 0.065) ** 2) * (0.3 + 0.7 * behind) * np.sin(q[:, 2] * 2 * np.pi / (0.022 + 0.012 * value_noise(P, 20, seed=18)) + 5 * value_noise(P, 40, seed=8)) ** 2
            # bunching above the boot tops
            top = bp["boot_top"]
            b = smoothstep(top - 0.01, top + 0.02, z) * (1 - smoothstep(top + 0.09, top + 0.13, z)) * (np.abs(P[:, 0] - kn[0]) < 0.12)
            d += 0.005 * b * np.sin(z * 2 * np.pi / 0.03 + 3 * value_noise(P, 25, seed=9)) ** 2
        # crotch pull lines
        cr = np.exp(-((P[:, 0] / 0.08) ** 2 + ((z - 0.86) / 0.07) ** 2)) * (P[:, 1] < 0)
        d += 0.0012 * cr * np.sin(np.arctan2(z - 0.84, P[:, 0]) * 8) ** 2
        # seat and thigh drape
        d += 0.0012 * np.sin(P[:, 0] * 90 + 20 * P[:, 2]) * smoothstep(0.55, 0.8, z) * (1 - smoothstep(0.85, 0.95, z))
        return (-d).astype(np.float32)
    return f


# ------------------------------------------------------------------ paints

def shirt_paint(color, pattern=None, seed=0, garters=False, cravat=False):
    def paint(P):
        col, r, m = PT.fabric(P, color, "cotton", dust_amt=0.18, fade=0.3, seed=seed, grime=0.3)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        if garters:
            # sleeve garters: a band round each upper arm
            from .skeleton import JOINTS
            for tag in ("L", "R"):
                sh = np.array(JOINTS[f"upper_arm.{tag}"][0])
                el = np.array(JOINTS[f"forearm.{tag}"][0])
                dd = (el - sh) / np.linalg.norm(el - sh)
                s_ = (P - sh) @ dd
                rad = np.linalg.norm((P - sh) - np.outer(s_, dd), axis=1)
                g = (np.abs(s_ - 0.17) < 0.013) & (rad < 0.09)
                col[g] = srgb(0.45, 0.12, 0.10)
        if cravat:
            cv = (z > 1.47) & (y < -0.02) & (np.abs(x) < 0.05)
            col[cv] = srgb(0.03, 0.03, 0.03)
            r[cv] = 0.4
        if pattern == "stripe":
            s = smoothstep(0.35, 0.5, np.abs(np.sin(x * 2 * np.pi / 0.012 + 0.2 * np.sin(z * 20))))
            col *= (0.82 + 0.18 * s)[:, None]
        elif pattern == "check":
            a = np.abs(np.sin(x * 2 * np.pi / 0.03)) > 0.8
            b = np.abs(np.sin(z * 2 * np.pi / 0.03)) > 0.8
            col *= (1 - 0.18 * a - 0.18 * b + 0.08 * (a & b))[:, None]
        # placket and buttons down the front
        front = (y < -0.05) & (z > 0.98) & (z < 1.49)
        pl = front & (np.abs(x) < 0.013)
        col[pl] *= 0.9
        bz = (z - 1.02) % 0.085
        btn = front & (np.abs(x) < 0.0055) & (np.abs(bz - 0.04) < 0.0055)
        col[btn] = srgb(0.72, 0.68, 0.60)
        r[btn] = 0.4
        # sweat and grime at the collar, armpits and rolled cuffs
        cuff = np.zeros(len(P))
        from .skeleton import JOINTS
        for tag in ("L", "R"):
            el = np.array(JOINTS[f"forearm.{tag}"][0])
            wr = np.array(JOINTS[f"hand.{tag}"][0])
            dd = (wr - el) / np.linalg.norm(wr - el)
            cuff = np.maximum(cuff, np.exp(-((np.linalg.norm(P - (el + dd * 0.09), axis=1)) / 0.03) ** 2))
            sh = np.array(JOINTS[f"upper_arm.{tag}"][0])
            ap = sh + np.array([-0.03 * np.sign(sh[0]), 0.0, -0.10])
            sw = np.exp(-(np.linalg.norm(P - ap, axis=1) / 0.06) ** 2)
            col *= (1 - 0.25 * sw)[:, None]
        col *= (1 - 0.3 * cuff)[:, None]
        coll = smoothstep(1.49, 1.52, z)
        col *= (1 - 0.15 * coll * fbm(P, 80, 2, seed=seed + 4))[:, None]
        return col, r, m
    return paint


def trouser_paint(color, seed=0, chaps=None):
    def paint(P):
        col, r, m = PT.fabric(P, color, "wool", dust_amt=0.55, fade=0.15, seed=seed + 10)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        if chaps is not None:
            # leather chaps over the front and sides of the legs, open at the seat
            lc, lr, lm = PT.leather(P, chaps, 0.45, 0.6, seed=seed + 12)
            front = (y < 0.03) | (np.abs(x) > 0.12)
            ch = front & (z < 0.99)
            col[ch], r[ch], m[ch] = lc[ch], lr[ch], lm[ch]
            # a row of conchos down the outer seam
            ax = np.abs(x)
            con = ch & (ax > 0.14) & (np.abs(((z - 0.45) % 0.12) - 0.06) < 0.008) & (np.abs(y) < 0.03)
            col[con] = srgb(0.72, 0.72, 0.70)
            m[con] = 1.0
            r[con] = 0.3
        from .skeleton import JOINTS
        for tag in ("L", "R"):
            kn = np.array(JOINTS[f"shin.{tag}"][0])
            q = P - kn
            knee = np.exp(-((q[:, 0] / 0.05) ** 2 + ((q[:, 2] - 0.01) / 0.07) ** 2)) * (q[:, 1] < -0.02)
            col = col * (1 - 0.35 * knee[:, None]) + (col * 1.35 + 0.02) * 0.35 * knee[:, None]
            # outer leg seam
            ax = x * (1 if tag == "L" else -1)
            side = (ax > 0.05) & (np.abs(y - 0.005) < 0.003) & (z < 0.95)
            col[side] *= 0.8
        # waistband and belt loops a little darker
        col *= (1 - 0.15 * smoothstep(1.03, 1.05, z))[:, None]
        return col, r, m
    return paint


def boot_paint(color=(0.16, 0.095, 0.055), seed=0, shine=0.0):
    def paint(P):
        col, r, m = PT.leather(P, color, dust_amt=0.3, wear=0.45 * (1 - shine), seed=seed + 20, shine=shine)
        z = P[:, 2]
        sole = z < 0.016
        col[sole] = col[sole] * 0.45
        # scuffed toe caps
        toe = smoothstep(-0.10, -0.17, P[:, 1]) * (z < 0.06)
        col = col * (1 - 0.4 * toe[:, None]) + (col * 1.8 + 0.03) * 0.4 * toe[:, None]
        r = r + 0.15 * toe
        # stitched pattern on the shaft: a few curling seams
        sh = (z > 0.16) & (z < 0.38)
        th = np.arctan2(P[:, 0] - np.sign(P[:, 0]) * 0.105, -P[:, 1])
        stitch = sh & (np.abs(np.sin(th * 4 + 6 * np.sin(z * 30))) < 0.05)
        col[stitch] = col[stitch] * 1.35 + 0.015
        # spur and its strap: iron
        metal = (P[:, 1] > 0.074) & (z < 0.06) & (z > 0.03)
        mc, mr, mm = PT.metal(P, (0.35, 0.34, 0.32), 0.45, rust=0.4)
        col[metal] = mc[metal]
        r[metal] = mr[metal]
        m[metal] = mm[metal]
        return col, r, m
    return paint


# ------------------------------------------------------------------ the base body

def base_body(spec, coll=None, log=print):
    """Head, hands, clothes, footwear, belts and holsters of one person.

    spec keys: head, look, body (see body.P), outfit ('cowboy' | 'dress'),
    shirt_color, shirt_pattern, trouser_color, chaps (colour or None),
    footwear ('riding' | 'shoes'), boot_color, belt, gunbelt (None | 'single'
    | 'twin'), pose_R, pose_L, garters, cravat, dress_color."""
    jobs = []
    hp, look, bp = spec["head"], spec["look"], spec["body"]
    for j in HD.make("head", hp, look, coll, tris=spec.get("head_tris", 1900)):
        jobs.append(j)
    outfit = spec.get("outfit", "cowboy")
    if outfit == "cowboy":
        shf = BD.shirt(bp)
        rm = G.build_shirt(bp, shf)
        shirt = R.to_blender(rm, "shirt", coll)
        jobs.append(dict(ob=shirt, field=S.Displace(shf, sleeve_folds(bp), 0.006),
                         paint=shirt_paint(spec["shirt_color"], spec.get("shirt_pattern"), garters=spec.get("garters"), cravat=spec.get("cravat")),
                         origin=np.zeros(3), weight=1.0, ao_field=shf))
        trf = BD.trousers(bp)
        rt = G.build_trousers(bp, trf)
        tr = R.to_blender(rt, "trousers", coll)
        jobs.append(dict(ob=tr, field=S.Displace(trf, trouser_folds(bp), 0.006),
                         paint=trouser_paint(spec["trouser_color"], chaps=spec.get("chaps")),
                         origin=np.zeros(3), weight=0.7, ao_field=trf))
        log(f"  garments: shirt {bl.tri_count(shirt)} tris, trousers {bl.tri_count(tr)} tris")
    else:
        df = G.dress_field()
        rm = G.build_dress(df)
        dr = R.to_blender(rm, "dress", coll)
        jobs.append(dict(ob=dr, field=S.Displace(df, G.dress_folds, 0.007), paint=dress_paint(spec["dress_color"]),
                         origin=np.zeros(3), weight=1.0, ao_field=df, skin=("coat", 0.02)))
        log(f"  garments: dress {bl.tri_count(dr)} tris")
    # hands
    tone = look.get("skin", "tanned")
    for side, pose in (("R", spec.get("pose_R", "grip")), ("L", spec.get("pose_L", "relaxed"))):
        full = outfit == "dress" or bp.get("sleeves") == "full"
        hf, nails = HN.hand_sdf(pose, female=bp["female"], sleeve="full" if full else "rolled")
        M, o = HN.world_xform(side)
        ob = decimated(f"hand.{side}", hf, (-0.07, -0.21, -0.07), (0.06, 0.20, 0.08), 0.0009, spec.get("hand_tris", 520), coll, M=M, o=o)

        def hpaint(P, nails=nails, M=M, o=o):
            Pw = P @ M.T + o
            col, r, m = PT.skin(Pw, tone, seed=3, dirt=look.get("grime", 0.3) + 0.1)
            nm = HN.nail_mask(P, nails)
            col = col * (1 - 0.6 * nm[:, None]) + srgb(0.72, 0.55, 0.50) * 0.6 * nm[:, None]
            r = r - 0.2 * nm
            back = smoothstep(0.004, 0.012, P[:, 0])
            col *= (1 - 0.08 * back)[:, None]
            return col, r, m
        jobs.append(dict(ob=ob, field=hf, paint=hpaint, origin=o, M=M, weight=1.3, ao_field=hf, smart_uv=True, uv_angle=75))
    if outfit == "dress":
        return jobs
    # footwear
    shoes = spec.get("footwear", "riding") == "shoes"
    for side in ("L", "R"):
        if shoes:
            bf, top = GR.boot_sdf(side, top=0.165, heel=0.026, shaft_r=0.047, spur=False)
        else:
            bf, top = GR.boot_sdf(side, top=bp["boot_top"] + 0.005, spur=spec.get("spurs", True))
        x0 = 0.105 if side == "L" else -0.105
        ztop = (0.165 if shoes else bp["boot_top"]) + 0.06
        ob = decimated(f"boot.{side}", bf, (x0 - 0.08, -0.23, -0.01), (x0 + 0.08, 0.14, ztop), 0.0016, spec.get("boot_tris", 420 if not shoes else 320), coll)
        jobs.append(dict(ob=ob, field=bf, paint=boot_paint(spec.get("boot_color", (0.16, 0.095, 0.055)), shine=0.5 if shoes else 0.0),
                         origin=np.zeros(3), weight=0.6, ao_field=bf, smart_uv=True, uv_angle=80))
    if spec.get("belt", True):
        tb = GR.trouser_belt()
        ob = decimated("belt", tb, (-0.2, -0.16, 1.0), (0.2, 0.16, 1.1), 0.0015, 260, coll)

        def belt_paint(P, tb=tb):
            col, r, m = PT.leather(P, (0.16, 0.10, 0.06), 0.2, 0.5, seed=31)
            bk = (P[:, 1] < -0.118) & (np.abs(P[:, 0]) < 0.027)
            mc, mr, mm = PT.metal(P, (0.55, 0.45, 0.25), 0.35)
            col[bk], r[bk], m[bk] = mc[bk], mr[bk], mm[bk]
            return col, r, m
        jobs.append(dict(ob=ob, field=tb, paint=belt_paint, origin=np.zeros(3), weight=0.6, ao_field=tb, smart_uv=True, uv_angle=80))
    gb = spec.get("gunbelt", "single")
    if gb:
        band, hol, gun = GR.gunbelt(bp)
        ob = decimated("gunbelt", band, (-0.23, -0.18, 0.88), (0.23, 0.18, 1.05), 0.0016, 420, coll)
        leather = spec.get("gunbelt_color", (0.24, 0.15, 0.08))

        def gb_paint(P, leather=leather):
            col, r, m = PT.leather(P, leather, 0.3, 0.5, seed=33)
            th = np.arctan2(P[:, 0], -(P[:, 1] - 0.010))
            zc = 0.975 + 0.010 * np.cos(th) + 0.022 * np.sin(th)
            cart = (np.abs(P[:, 2] - zc) < 0.017) & (np.abs(th) > 0.9) & (np.cos(th * 34) > 0.2)
            mc, mr, mm = PT.metal(P, (0.62, 0.48, 0.24), 0.3)
            col[cart], r[cart], m[cart] = mc[cart], mr[cart], mm[cart]
            bk = (P[:, 1] < -0.13) & (np.abs(P[:, 0]) < 0.033)
            mc, mr, mm = PT.metal(P, (0.5, 0.5, 0.5), 0.4)
            col[bk], r[bk], m[bk] = mc[bk], mr[bk], mm[bk]
            return col, r, m
        jobs.append(dict(ob=ob, field=band, paint=gb_paint, origin=np.zeros(3), weight=0.6, ao_field=band, smart_uv=True, uv_angle=80))
        sides = [1, -1] if gb == "twin" else [1]
        for sx in sides:
            both = S.Union([hol, gun], k=0.002)
            if sx < 0:
                both = mirrored(both)
            nm = "holster" if sx > 0 else "holster.2"
            lo = (-0.24, -0.08, 0.72) if sx > 0 else (0.13, -0.08, 0.72)
            hi = (-0.13, 0.10, 1.06) if sx > 0 else (0.24, 0.10, 1.06)
            ob = decimated(nm, both, lo, hi, 0.0012, 360, coll)
            fancy = spec.get("fancy_guns", False)

            def hol_paint(P, gun=gun, sx=sx, leather=spec.get("holster_color", (0.36, 0.22, 0.11)), fancy=fancy):
                Q = P * np.array([sx, 1, 1])
                col, r, m = PT.leather(P, leather, 0.35, 0.6, seed=35)
                g = gun(Q.astype(np.float32)) < 0.0015
                if fancy:
                    wc, wr_, wm = np.tile(srgb(0.86, 0.82, 0.72), (len(P), 1)), np.full(len(P), 0.35), np.zeros(len(P))
                    mc, mr, mm = PT.metal(P, (0.72, 0.72, 0.70), 0.25)
                else:
                    wc, wr_, wm = PT.wood(P, (0.24, 0.13, 0.07), axis=(0, 0.5, 1))
                    mc, mr, mm = PT.metal(P, (0.16, 0.17, 0.19), 0.4)
                grip = g & (P[:, 2] > 0.99)
                fr = g & ~grip
                col[grip], r[grip], m[grip] = wc[grip], wr_[grip], wm[grip]
                col[fr], r[fr], m[fr] = mc[fr], mr[fr], mm[fr]
                return col, r, m
            jobs.append(dict(ob=ob, field=both, paint=hol_paint, origin=np.zeros(3), weight=0.6, ao_field=both, smart_uv=True, uv_angle=80))
    return jobs


def mirrored(node):
    """A field mirrored across x = 0."""
    lo, hi = np.asarray(node.lo), np.asarray(node.hi)
    return S.Fn(lambda P: node((P * np.array([-1, 1, 1], np.float32)).astype(np.float32)),
                np.array([-hi[0], lo[1], lo[2]]), np.array([-lo[0], hi[1], hi[2]]))


def dress_paint(color, seed=0):
    def paint(P):
        c, r, m = PT.fabric(P, color, "cotton", dust_amt=0.25, fade=0.2, seed=seed + 60)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        # a darker sash at the waist and lace at the collar and cuffs
        sash = np.abs(z - 1.085) < 0.022
        c[sash] = c[sash] * 0.6
        lace = (z > 1.53) | (np.abs(z - 0.87) < 0.0)
        c[lace] = srgb(0.88, 0.85, 0.78)
        # a column of small buttons up the bodice
        btn = (y < -0.06) & (np.abs(x) < 0.005) & (np.abs(((z - 1.10) % 0.045) - 0.022) < 0.005) & (z > 1.1) & (z < 1.52)
        c[btn] = srgb(0.30, 0.25, 0.22)
        # the hem is dusty
        c = c * (1 - 0.3 * smoothstep(0.25, 0.02, z)[:, None]) + PT.DUST * 0.3 * smoothstep(0.25, 0.02, z)[:, None]
        return c, r, m
    return paint
