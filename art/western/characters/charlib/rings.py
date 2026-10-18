"""Ring topology for garments that bend: shirts, trousers, coats, vests, dresses.

A deforming mesh wants edge loops around every joint, perpendicular to the
bone, and quads that stay square when an elbow folds. A decimated sculpt does
not give that, so garments are built the way a modeller would box them out:

- a torso as stacked rings,
- armholes cut out of its sides (4 x 2 faces -> a 12-vertex loop),
- arm tubes bridged onto those loops, with rings bunched at the elbow,
- a crotch template that splits the pelvis ring into two leg loops,
- rolled cuffs, collars and hems as explicit rings.

Initial positions are analytic (ellipses and circles); then every vertex is
snapped onto the garment's field and the junctions are relaxed so the quads
even out. UVs come straight from the ring grid: one island per tube.
"""
import numpy as np
from . import sdf as S


class RingMesh:
    def __init__(self):
        self.V = []
        self.F = []
        self.FUV = []        # per face: list of (u, v) per corner, in the island's own space
        self.island = []     # per face: island name
        self.relax_w = []    # per vertex: 0 = keep as placed, 1 = free to even out
        self.pinned = []     # per vertex: never projected (analytic rolls, collars)
        self.tags = {}

    def add(self, p, relax=0.0, pin=False):
        self.V.append(np.asarray(p, np.float64))
        self.relax_w.append(relax)
        self.pinned.append(pin)
        return len(self.V) - 1

    def ring(self, pts, relax=0.0, pin=False):
        return np.array([self.add(p, relax, pin) for p in pts])

    def face(self, idx, uvs, island):
        self.F.append(tuple(int(i) for i in idx))
        self.FUV.append([tuple(map(float, u)) for u in uvs])
        self.island.append(island)

    def bridge(self, ra, rb, va, vb, island, closed=True, ua=None, ub=None):
        """Quads between two rings of equal length. va/vb: the v coordinate of
        each ring; ua/ub: per-vertex u (default: index / n, closing at 1)."""
        n = len(ra)
        assert len(rb) == n
        m = n if closed else n - 1
        ua = np.arange(n + 1) / n if ua is None else ua
        ub = ua if ub is None else ub
        for j in range(m):
            j2 = (j + 1) % n
            self.face((ra[j], ra[j2], rb[j2], rb[j]),
                      [(ua[j], va), (ua[j + 1], va), (ub[j + 1], vb), (ub[j], vb)], island)


def ellipse_ring(c, rx, ry, n, z=None, start=0.0):
    """Points on an ellipse around a vertical axis; index 0 straight ahead (-Y),
    increasing toward the character's left (+X)."""
    th = start + 2 * np.pi * np.arange(n) / n
    return np.stack([c[0] + rx * np.sin(th), c[1] - ry * np.cos(th), np.full(n, c[2] if z is None else z)], 1)


def limb_frame(d, up=(0, -1, 0)):
    """Two unit vectors perpendicular to a limb direction d."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    u = np.asarray(up, float)
    e1 = u - (u @ d) * d
    if np.linalg.norm(e1) < 1e-6:
        e1 = np.array([1.0, 0, 0]) - d[0] * d
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    return e1, e2


def circle(c, d, r, phis, e1=None, e2=None, rscale=None):
    d = np.asarray(d, float) / np.linalg.norm(d)
    if e1 is None:
        e1, e2 = limb_frame(d)
    rs = r if rscale is None else r * rscale
    return np.asarray(c) + np.outer(np.cos(phis) * rs, e1) + np.outer(np.sin(phis) * rs, e2)


def loop_angles(pts, c, d, e1, e2):
    q = np.asarray(pts) - c
    return np.arctan2(q @ e2, q @ e1)


def ring_angles(pts, c, d, e1, e2):
    """Angles of a closed loop around an axis, made monotonic in whichever
    direction the loop actually winds; also returns that direction (+1/-1)."""
    a = loop_angles(pts, c, d, e1, e2)
    steps = np.angle(np.exp(1j * np.diff(np.concatenate([a, a[:1]]))))
    sgn = 1.0 if steps.sum() >= 0 else -1.0
    return sgn * unwrap_angles(sgn * a), sgn


def unwrap_angles(a):
    """Make a closed loop's angles monotonic increasing from a[0]."""
    out = [a[0]]
    for x in a[1:]:
        prev = out[-1]
        while x < prev:
            x += 2 * np.pi
        while x - prev > 2 * np.pi:
            x -= 2 * np.pi
        out.append(x)
    return np.array(out)


def snap_and_relax(rm, field, iters=24, lam=0.5, snap_iters=3, clamp=0.01):
    """Snap every unpinned vertex onto the field, then relax the free ones
    tangentially (Laplacian in the surface's tangent plane) and snap again."""
    rm.field = field            # to_blender orients the faces by it
    V = np.array(rm.V, np.float32)
    w = np.array(rm.relax_w, np.float32)
    pin = np.array(rm.pinned, bool)
    free = ~pin
    V[free] = S.project_to_surface(field, V[free], iters=snap_iters + 3, clamp=clamp)
    nbr = [set() for _ in range(len(V))]
    for f in rm.F:
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            nbr[a].add(b)
            nbr[b].add(a)
    rel = np.nonzero((w > 0) & free)[0]
    if len(rel) == 0:
        rm.V = list(V.astype(np.float64))
        return
    for _ in range(iters):
        avg = np.array([V[list(nbr[i])].mean(0) if nbr[i] else V[i] for i in rel], np.float32)
        g = S.gradient(field, V[rel])
        n = g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]
        dlt = avg - V[rel]
        dlt -= (dlt * n).sum(1)[:, None] * n
        V[rel] += (lam * w[rel])[:, None] * dlt
        V[rel] = S.project_to_surface(field, V[rel], iters=snap_iters, clamp=clamp)
    rm.V = list(V.astype(np.float64))


def to_blender(rm, name, coll=None):
    """Mesh object with one UV map; islands are laid out side by side (the
    atlas packer rearranges them anyway)."""
    from . import bl
    ob = bl.mesh_from_arrays(name, np.array(rm.V, np.float32), rm.F, coll)
    # lay islands out on a strip, each scaled to its real size (u,v are metres)
    uv = []
    offs = {}
    x = 0.0
    for isl in dict.fromkeys(rm.island):
        pts = np.array([u for f, i in zip(rm.FUV, rm.island) if i == isl for u in f])
        lo = pts.min(0)
        offs[isl] = (x - lo[0], -lo[1])
        x += (pts[:, 0].max() - lo[0]) + 0.05
    for f, isl in zip(rm.FUV, rm.island):
        ox, oy = offs[isl]
        for u in f:
            uv.append((u[0] + ox, u[1] + oy))
    uv = np.array(uv, np.float32)
    uv /= max(uv.max(), 1e-6)
    bl.set_uv(ob, uv)
    bl.recalc_normals(ob)
    if getattr(rm, "field", None) is not None:
        orient_by_field(ob, rm.field)
    else:
        orient_outward(ob)
    return ob


def orient_by_field(ob, field):
    """Point every face out of the garment's field. recalc_face_normals only
    agrees within a manifold patch, and the armhole seams are not manifold,
    so a whole sleeve could come out wound inward (dark in three.js, whose
    double-sided shading then lights its inside). Each patch reachable across
    two-face edges votes, area-weighted, with the field's gradient."""
    import bmesh
    from . import sdf as S
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    faces = bm.faces
    C = np.array([f.calc_center_median() for f in faces], np.float32)
    N = np.array([f.normal for f in faces], np.float32)
    A = np.array([f.calc_area() for f in faces], np.float32)
    agree = (N * S.gradient(field, C)).sum(1) * A
    region = np.full(len(faces), -1)
    flip = []
    for f in faces:
        if region[f.index] >= 0:
            continue
        k = f.index
        region[k] = k
        stack, members = [f], [k]
        while stack:
            g = stack.pop()
            for e in g.edges:
                if len(e.link_faces) != 2:
                    continue
                for h in e.link_faces:
                    if region[h.index] < 0:
                        region[h.index] = k
                        members.append(h.index)
                        stack.append(h)
        if agree[members].sum() < 0:
            flip += members
    if flip:
        bmesh.ops.reverse_faces(bm, faces=[faces[i] for i in flip])
        bm.to_mesh(me)
        me.update()
    bm.free()


def orient_outward(ob):
    """recalc_face_normals guesses on open meshes (a shirt is all holes); make
    sure faces point away from the body's vertical axis, area-weighted."""
    import bmesh
    me = ob.data
    s = 0.0
    for p in me.polygons:
        c = np.array(p.center)
        s += p.area * float(np.dot(np.array(p.normal), c - np.array([0.0, 0.0, c[2]])))
    if s < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
        me.update()
