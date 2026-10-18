"""Bodies of the dead: bony clawed hands, and the base of every walker
(`char.walker`: the head with its neck and ears, and the hands - the skin
that shows whatever they died in).

The rig has no finger bones, so a hand is sculpted in the pose it lives in:
the dead's hands are claws - fingers bent at the middle and last joints,
spread, the thumb out - which reads at forty metres as reaching.
"""

import numpy as np

from .common import S, HN, srgb, smoothstep, fbm
from . import meshfix as MF
from . import heads as H

# a claw: MCP (knuckle) flexed a little, PIP and DIP hard, fingers splayed
HN.POSES.setdefault("claw", dict(index=(14, 58, 42), middle=(18, 62, 46), ring=(22, 64, 46), pinky=(26, 62, 44),
                                 thumb=(34, 30, 26), open=1.0))
HN.POSES.setdefault("hang", dict(index=(18, 30, 20), middle=(22, 36, 24), ring=(26, 40, 26), pinky=(30, 44, 28),
                                 thumb=(14, 18, 16), open=0.5))


def hand_jobs(prefix, side_poses=(("R", "claw"), ("L", "claw")), tone="grave", fresh=0.0, sleeve="rolled",
              female=0.0, bony=0.0012, tris=900, coll=None, grime=0.6, seed=0):
    jobs = []
    for side, pose in side_poses:
        hf, nails = HN.hand_sdf(pose, female=female, sleeve=sleeve)
        if bony != 0:
            hf = S.Offset(hf, -bony)
        M, o = HN.world_xform(side)
        ob = MF.decimated(f"{prefix}.handmesh.{side}", hf, (-0.07, -0.21, -0.07), (0.06, 0.20, 0.08), 0.0008, tris, coll, M=M, o=o)

        def hpaint(P, nails=nails, M=M, o=o, side=side):
            Pw = P @ M.T + o
            col, r = H.dead_skin(Pw, P + (7.0 if side == "L" else 3.0), tone, fresh, grime, seed=seed + 21)
            nm = HN.nail_mask(P, nails)
            # nails: long-dead, yellow-grey going dark, dirt packed under them
            col = col * (1 - 0.75 * nm[:, None]) + srgb(0.40, 0.36, 0.28) * 0.75 * nm[:, None]
            tipdirt = nm * smoothstep(0.5, 1.0, nm)
            col = col * (1 - 0.4 * tipdirt[:, None])
            r = r - 0.15 * nm
            # knuckles and fingertips darker; the backs of the hands veined
            back = smoothstep(0.004, 0.012, P[:, 0])
            col *= (1 - 0.1 * back)[:, None]
            dirt = smoothstep(0.55, 0.85, fbm(P, 90, 3, seed=seed + 23)) * (0.4 + 0.6 * smoothstep(0.08, 0.13, P[:, 1]))
            col = col * (1 - 0.45 * dirt[:, None]) + srgb(0.20, 0.15, 0.11) * 0.45 * dirt[:, None]
            return col, r, np.zeros(len(P))
        jobs.append(dict(ob=ob, field=hf, paint=hpaint, origin=o, M=M, weight=1.3, ao_field=hf, smart_uv=True, uv_angle=75))
    return jobs


WALKER_HEAD = dict(age=0.8, fat=0.12, cheekbone=1.05, jaw=1.04, chin=1.05, brow=1.0, nose_len=0.95, nose_bridge=1.0,
                   hair="bald", brows=0.6, eye_open=0.62, lips=0.85, neck=0.95, width=0.98,
                   dead=dict(sunken=0.65, gaunt=0.75, mouth=0.55, fresh=0.0))
WALKER_LOOK = dict(tone="grave", grime=0.55, stubble=0.5, trickle=1, seed=3,
                   scratch=((0.030, -0.088, -0.020), (0.058, -0.060, -0.060)))


def walker_base(coll=None, quick=False):
    """char.walker: head (neck, ears) and the two hands."""
    p = H.P(**{k: v for k, v in WALKER_HEAD.items() if k != "dead"}, dead=WALKER_HEAD["dead"])
    jobs, field = H.make("walker.head", p, WALKER_LOOK, coll, tris=4800 if quick else 6400)
    jobs += hand_jobs("walker", sleeve="rolled", tris=600 if quick else 900, coll=coll)
    return jobs, p


def body_proxy_fields(bp):
    """A generic clothed body (shirt, trousers, boots) for bone heat: every
    outfit takes its weights from the same proxy, so they bend alike."""
    from .common import BD, GR
    fields = [(BD.shirt(bp), np.zeros(3), None), (BD.trousers(bp), np.zeros(3), None)]
    for side in ("L", "R"):
        bf, _ = GR.boot_sdf(side, top=0.3, spur=False)
        fields.append((bf, np.zeros(3), None))
    return fields
