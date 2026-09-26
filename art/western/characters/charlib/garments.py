"""Garment game meshes built with ring topology (see rings.py) and snapped
onto the garment fields of body.py."""
import math
import numpy as np
from . import sdf as S, rings as R
from .skeleton import JOINTS

TORSO_Z = [0.985, 1.045, 1.105, 1.165, 1.225, 1.282, 1.338, 1.400, 1.462, 1.500, 1.528]
ARMPIT = 6          # ring index where the armhole starts (2 rings tall)


def _j(n, e=0):
    return np.array(JOINTS[n][e], float)


def arm_path(tag):
    sh, el, wr = _j(f"upper_arm.{tag}"), _j(f"forearm.{tag}"), _j(f"hand.{tag}")
    return sh, el, wr


def point_on_arm(tag, s):
    """Point and direction at arc length s along shoulder->elbow->wrist."""
    sh, el, wr = arm_path(tag)
    l1 = np.linalg.norm(el - sh)
    d1 = (el - sh) / l1
    d2 = (wr - el) / np.linalg.norm(wr - el)
    if s <= l1:
        p = sh + d1 * s
    else:
        p = el + d2 * (s - l1)
    # blend the ring plane across the elbow so rings fan instead of crossing
    t = np.clip((s - (l1 - 0.035)) / 0.07, 0, 1)
    d = d1 * (1 - t) + d2 * t
    return p, d / np.linalg.norm(d)


def point_on_leg(tag, s):
    hp, kn, an = _j(f"thigh.{tag}"), _j(f"shin.{tag}"), _j(f"foot.{tag}")
    l1 = np.linalg.norm(kn - hp)
    d1 = (kn - hp) / l1
    d2 = (an - kn) / np.linalg.norm(an - kn)
    p = hp + d1 * s if s <= l1 else kn + d2 * (s - l1)
    t = np.clip((s - (l1 - 0.04)) / 0.08, 0, 1)
    d = d1 * (1 - t) + d2 * t
    return p, d / np.linalg.norm(d)


def torso_profile(bp):
    from .body import torso_tube
    tube = torso_tube(bp)
    zs = tube.pts[:, 2]

    def at(z):
        t = np.interp(z, zs, np.arange(len(zs)))
        c = np.interp(z, zs, tube.pts[:, 1])
        return S.catmull(tube.rx, np.array([t]))[0], S.catmull(tube.ry, np.array([t]))[0], c
    return at


def _arc(pts, closed=True):
    d = np.linalg.norm(np.diff(np.vstack([pts, pts[:1]]) if closed else pts, axis=0), axis=1)
    return np.concatenate([[0], np.cumsum(d)])


def build_torso_with_arms(rm, bp, M, arm_n, zs, arm_rings, sleeve, prefix, open_front=False,
                          armholes=True, arms=True, inflate=0.0):
    """Torso rings with two armholes and, optionally, sleeves bridged onto them.
    arm_rings: list of (s along the arm, radius). Returns dict of ring index arrays."""
    prof = torso_profile(bp)
    T = []
    for i, z in enumerate(zs):
        rx, ry, cy = prof(z)
        pts = R.ellipse_ring((0, cy, z), rx + inflate, ry + inflate, M)
        near_arm = 1.0 if ARMPIT - 2 <= i <= ARMPIT + 3 else 0.35
        T.append(rm.ring(pts, relax=near_arm))
    T = np.array(T)
    q = M // 4                   # quarter: left side column
    cols_L = list(range(q - 2, q + 3))
    cols_R = list(range(3 * q - 2, 3 * q + 3))
    a = ARMPIT
    hole = set()
    if armholes:
        for i in (a, a + 1):
            for j in cols_L[:-1] + cols_R[:-1]:
                hole.add((i, j))
    # torso faces (u: arc length around the reference ring, seam at the front)
    ref = np.array([rm.V[k] for k in T[len(zs) // 2]])
    uarc = _arc(ref)
    centers = np.array([np.mean([rm.V[k] for k in T[i]], 0) for i in range(len(zs))])
    varc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(centers, axis=0), axis=1))])
    for i in range(len(zs) - 1):
        for j in range(M):
            if (i, j) in hole:
                continue
            if open_front and j == M - 1:
                continue
            j2 = (j + 1) % M
            rm.face((T[i][j], T[i][j2], T[i + 1][j2], T[i + 1][j]),
                    [(uarc[j], varc[i]), (uarc[j + 1], varc[i]), (uarc[j + 1], varc[i + 1]), (uarc[j], varc[i + 1])],
                    prefix + "torso")
    out = dict(T=T)
    if not (armholes and arms):
        return out
    for tag, cols in (("L", cols_L), ("R", cols_R)):
        loop = [T[a][c] for c in cols] + [T[a + 1][cols[-1]]] + [T[a + 2][c] for c in cols[::-1]] + [T[a + 1][cols[0]]]
        loop = np.array(loop)
        rings = [loop]
        p0, d0 = point_on_arm(tag, 0.0)
        e1, e2 = R.limb_frame(d0, (0, 0, 1))
        ang, sgn = R.ring_angles([rm.V[k] for k in loop], p0, d0, e1, e2)
        # re-seat the armhole loop around the root of the arm (a tilted oval
        # from the shoulder top down into the armpit) so the first sleeve
        # quads are not twisted between a vertical hole and a slanted arm
        uni = ang[0] + sgn * 2 * np.pi * np.arange(len(loop)) / len(loop)
        ang = 0.4 * ang + 0.6 * uni
        root = R.circle(p0 - d0 * 0.012, d0, 0.080 * bp["arms"] + inflate, ang, e1, e2)
        for k, idx in enumerate(loop):
            rm.V[idx] = root[k]
            rm.relax_w[idx] = 1.0
        for i in range(a - 1, a + 4):
            for c in list(cols) + [cols[0] - 1, cols[-1] + 1]:
                rm.relax_w[T[i][c % M]] = 1.0
        for k, (s, r) in enumerate(arm_rings):
            p, d = point_on_arm(tag, s)
            f1, f2 = R.limb_frame(d, (0, 0, 1))
            t = min(1.0, (k + 1) / 3.0)
            uni = ang[0] + sgn * 2 * np.pi * np.arange(arm_n) / arm_n
            phis = ang * (1 - t) + uni * t
            pts = R.circle(p, d, r + inflate, phis, f1, f2)
            rings.append(rm.ring(pts, relax=1.0 if k < 2 else 0.2))
        out["arm" + tag] = rings
        # faces
        refa = np.array([rm.V[k] for k in rings[min(3, len(rings) - 1)]])
        ua = _arc(refa)
        cen = [np.mean([rm.V[k] for k in rr], 0) for rr in rings]
        va = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(cen, axis=0), axis=1))])
        for k in range(len(rings) - 1):
            rm.bridge(rings[k], rings[k + 1], va[k], va[k + 1], prefix + "arm" + tag, ua=ua)
    return out


def rolled_cuff(rm, tag, last_ring, s0, r, arm_n, island, v0):
    """A sleeve rolled twice: out and up over itself, ending in a lip that
    curls back in toward the forearm (pinned: the shape is analytic)."""
    prof = [(0.004, r + 0.004), (0.009, r + 0.011), (0.020, r + 0.013), (0.028, r + 0.008), (0.030, r - 0.001), (0.026, r - 0.006)]
    rings = [last_ring]
    p_last = np.mean([rm.V[k] for k in last_ring], 0)
    _, dref = point_on_arm(tag, s0)
    f1, f2 = R.limb_frame(dref, (0, 0, 1))
    ang, _ = R.ring_angles([rm.V[k] for k in last_ring], p_last, dref, f1, f2)
    for ds, rr in prof:
        p, d = point_on_arm(tag, s0 + ds)
        rings.append(rm.ring(R.circle(p, dref, rr, ang, f1, f2), pin=True))
    ua = np.linspace(0, 2 * np.pi * r, arm_n + 1)
    v = v0
    for k in range(len(rings) - 1):
        v2 = v + 0.012
        rm.bridge(rings[k], rings[k + 1], v, v2, island, ua=ua)
        v = v2
    return rings


def collar(rm, top_ring, M, island):
    """A turned-down shirt collar: up the neck, folded over, resting outward."""
    c0 = np.mean([rm.V[k] for k in top_ring], 0)
    prof = [(0.030, 0.068, 0.004), (0.036, 0.074, 0.006), (0.024, 0.086, 0.004), (0.004, 0.094, 0.0)]
    rings = [top_ring]
    for dz, r, dy in prof:
        pts = R.ellipse_ring((0, c0[1] + dy, c0[2] + dz), r, r * 0.95, M)
        # the collar dips at the front, points spread apart
        th = 2 * np.pi * np.arange(M) / M
        pts[:, 2] -= 0.018 * np.cos(th) ** 8 * (1 if dz < 0.03 else 0.6)
        rings.append(rm.ring(pts, pin=True))
    ua = np.linspace(0, 2 * np.pi * 0.07, M + 1)
    for k in range(len(rings) - 1):
        rm.bridge(rings[k], rings[k + 1], 0.02 * k, 0.02 * (k + 1), island, ua=ua)
    return rings


def build_shirt(bp, field, M=24, arm_n=12, name="shirt"):
    rm = R.RingMesh()
    sleeves = bp["sleeves"]
    if sleeves == "rolled":
        arm_rings = [(0.045, 0.064), (0.100, 0.060), (0.160, 0.056), (0.215, 0.053), (0.262, 0.051),
                     (0.292, 0.050), (0.318, 0.050), (0.345, 0.049), (0.375, 0.049)]
    else:
        arm_rings = [(0.045, 0.060), (0.100, 0.056), (0.160, 0.052), (0.215, 0.049), (0.262, 0.048),
                     (0.292, 0.047), (0.318, 0.046), (0.36, 0.045), (0.42, 0.043), (0.48, 0.040), (0.53, 0.038)]
    out = build_torso_with_arms(rm, bp, M, arm_n, TORSO_Z, arm_rings, sleeves, "")
    R.snap_and_relax(rm, field)
    if sleeves == "rolled":
        for tag in ("L", "R"):
            rolled_cuff(rm, tag, out["arm" + tag][-1], arm_rings[-1][0], arm_rings[-1][1] * bp["arms"], arm_n, "arm" + tag, 0.6)
    collar(rm, out["T"][-1], M, "collar")
    return rm


def build_trousers(bp, field, M=24, leg_n=14):
    rm = R.RingMesh()
    zs = [1.078, 1.036, 0.978, 0.918, 0.868]
    from .body import P as _p
    prof = [(1.078, 0.162, 0.115, 0.004), (1.036, 0.164, 0.119, 0.006), (0.978, 0.172, 0.124, 0.010),
            (0.918, 0.172, 0.121, 0.008), (0.868, 0.158, 0.110, 0.005)]
    Pr = []
    for z, rx, ry, cy in prof:
        Pr.append(rm.ring(R.ellipse_ring((0, cy, z), rx * bp["hips"], ry, M), relax=0.4 if z < 0.95 else 0.0))
    Pr = np.array(Pr)
    uarc = _arc(np.array([rm.V[k] for k in Pr[2]]))
    cen = [np.mean([rm.V[k] for k in r], 0) for r in Pr]
    varc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(cen, axis=0), axis=1))])
    for i in range(len(Pr) - 1):
        rm.bridge(Pr[i], Pr[i + 1], varc[i], varc[i + 1], "pelvis", ua=uarc)
    last = Pr[-1]
    h = M // 2
    c = rm.add((0, 0.004, 0.842), relax=1.0)
    legs = {}
    top = bp["boot_top"]
    for tag, sgn in (("L", 1), ("R", -1)):
        if sgn > 0:
            loop = np.array(list(last[: h + 1]) + [c])
        else:
            loop = np.array([last[0]] + list(last[h:][::-1]) + [c])
        hp = _j(f"thigh.{tag}")
        kn = _j(f"shin.{tag}")
        an = _j(f"foot.{tag}")
        l1 = np.linalg.norm(kn - hp)
        s_top = l1 + (kn[2] - top) / (kn[2] - an[2]) * np.linalg.norm(an - kn)
        spec = [(0.10, 0.083), (0.17, 0.079), (0.24, 0.074), (0.31, 0.068), (0.37, 0.064), (l1 - 0.012, 0.063),
                (l1 + 0.025, 0.061), (l1 + 0.06, 0.058), (s_top - 0.045, 0.057), (s_top - 0.018, 0.062), (s_top + 0.006, 0.056)]
        p0, d0 = point_on_leg(tag, 0.0)
        e1, e2 = R.limb_frame(d0, (0, -1, 0))
        ang, sgn = R.ring_angles([rm.V[k] for k in loop], p0, d0, e1, e2)
        rings = [loop]
        for k, (s, r) in enumerate(spec):
            p, d = point_on_leg(tag, s)
            f1, f2 = R.limb_frame(d, (0, -1, 0))
            t = min(1.0, (k + 1) / 3.0)
            uni = ang[0] + sgn * 2 * np.pi * np.arange(leg_n) / leg_n
            phis = ang * (1 - t) + uni * t
            rings.append(rm.ring(R.circle(p, d, r * bp["legs"], phis, f1, f2), relax=1.0 if k < 2 else 0.25))
        ua = _arc(np.array([rm.V[k] for k in rings[3]]))
        cenl = [np.mean([rm.V[k] for k in rr], 0) for rr in rings]
        va = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(cenl, axis=0), axis=1))])
        for k in range(len(rings) - 1):
            rm.bridge(rings[k], rings[k + 1], va[k], va[k + 1], "leg" + tag, ua=ua)
        legs[tag] = rings
    R.snap_and_relax(rm, field)
    return rm
