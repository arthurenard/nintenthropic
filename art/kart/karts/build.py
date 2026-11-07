"""
Grip Prix's kart, modelled from nothing in Blender (run headless):

    /Applications/Blender.app/Contents/MacOS/Blender -b -P art/kart/karts/build.py

Writes public/assets/kart/karts.glb (Draco). Nodes (glTF names):

    kart.body      everything fixed to the kart: the sculpted tub with its
                   cockpit, seat, engine and stacks, chrome tailpipes, wing,
                   lamps, bumper, suspension. Material "paint" is recoloured
                   per racer by the game.
    kart.wheel     ONE wheel, origin at the hub, axis along x, outer face toward
                   +x, rear-wheel size (the game scales it to 0.84 for the
                   front, and places it four times).
    kart.steering  the steering wheel, origin at its hub, ring in the xy plane;
                   the game tilts and turns it under the driver's hands.

Everything is built in the game's frame (metres, y up, the kart faces +z, its
left is +x) and written to Blender's z-up space on the way in. Materials are
glTF PBR; the game reads the material NAMES (paint, trim, stripe, chrome, rim,
steel, rubber, plastic, seat, lamp, tail, glass) to choose its kart surfaces
(src/kart/render/kartArt.ts). Ambient occlusion is baked into vertex colours.
"""
import bpy
import bmesh
import math
import os
import sys
import time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

# ── Where things are ────────────────────────────────────────────────────────


def _script_path():
    for i, a in enumerate(sys.argv):
        if a in ("-P", "--python") and i + 1 < len(sys.argv):
            return os.path.abspath(sys.argv[i + 1])
    return os.path.abspath(globals().get("__file__", "art/kart/karts/build.py"))


ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_script_path()))))
OUT = os.environ.get("KART_OUT", os.path.join(ROOT, "public", "assets", "kart", "karts.glb"))

# ── The footprint (the code-built kart's: src/kart/render/kartModel.ts) ─────

WHEEL_R, WHEEL_HALF = 0.43, 0.21           # the rear wheel; the front is this x 0.84
REAR = (0.95, 0.43, -0.84)                 # rear hubs (x, y, z), mirrored in x
FRONT = (0.86, 0.36, 0.94)                 # front hubs
FRONT_SCALE = 0.84
SPINDLE = 0.27                             # how far the wheel's spindle reaches toward the car
EXHAUST = (0.30, 0.64, -1.50)              # tailpipe mouths
PLATE_Z = -1.342                           # the number plate's face (the game writes the digit there)
PLATE_Y = 0.62

# ── Small maths ─────────────────────────────────────────────────────────────


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RX(a):
    return Matrix.Rotation(a, 4, "X")


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


def to_blender(p):
    """Game (x, y up, z forward) -> Blender (x, -z, y): a proper rotation, so winding is kept."""
    return (p[0], -p[2], p[1])


# ── Mesh bookkeeping ────────────────────────────────────────────────────────

MAT_NAMES = ["paint", "trim", "livery", "stripe", "chrome", "rim", "steel", "rubber", "tread", "plastic", "seat", "lamp", "tail", "glass"]
MI = {n: i for i, n in enumerate(MAT_NAMES)}


class M:
    """A bag of polygons in game space: vertices, faces, a material index and a smooth flag per face."""

    def __init__(self):
        self.v = []
        self.f = []
        self.m = []
        self.s = []

    ledger = []

    def add(self, other):
        if M.ledger is not None:
            M.ledger.append((sys._getframe(1).f_lineno, other.tris()))
        base = len(self.v)
        self.v += other.v
        self.f += [[i + base for i in f] for f in other.f]
        self.m += other.m
        self.s += other.s
        return self

    def xf(self, matrix):
        self.v = [tuple(matrix @ Vector(p)) for p in self.v]
        return self

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def mat(self, name):
        self.m = [MI[name]] * len(self.f)
        return self

    def flat(self):
        self.s = [False] * len(self.f)
        return self

    def bounds(self):
        xs, ys, zs = zip(*self.v)
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def volume(m):
    """Signed volume of a closed mesh: negative when it is inside out."""
    v = 0.0
    for f in m.f:
        p = [Vector(m.v[i]) for i in f]
        for k in range(1, len(f) - 1):
            v += p[0].dot(p[k].cross(p[k + 1])) / 6
    return v


def watch(m, what):
    if volume(m) < 0:
        print("WARNING: %s came out inside out (volume %.5f)" % (what, volume(m)))
    return m


def finish(bm, mat, closed=True, weld=1e-5, smooth=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld)
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    out = M()
    out.v = [tuple(v.co) for v in bm.verts]
    out.f = [[v.index for v in f.verts] for f in bm.faces]
    out.m = [MI[mat]] * len(out.f)
    out.s = [smooth] * len(out.f)
    bm.free()
    if closed:
        watch(out, "a part made at line %d" % sys._getframe(1).f_lineno)
    return out


def rbox(sx, sy, sz, r, mat, seg=2):
    """A rounded box centred on the origin."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    r = min(r, min(sx, sy, sz) * 0.49)
    if r > 1e-4:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=r, offset_type="OFFSET", segments=seg, profile=0.5, affect="EDGES")
    return finish(bm, mat)


def block(sx, sy, sz, top, mat):
    """A flat-shaded tapered block standing on y = 0 .. sy with no bottom: tread lugs."""
    pts = []
    for yy, k in ((0.0, 1.0), (sy, top)):
        for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pts.append((x * sx / 2 * k, yy, z * sz / 2 * k))
    out = M()
    out.v = pts
    out.f = [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    # outward winding: top faces +y
    out.f = [[7, 6, 5, 4], [4, 5, 1, 0], [5, 6, 2, 1], [6, 7, 3, 2], [7, 4, 0, 3]]
    out.m = [MI[mat]] * 5
    out.s = [False] * 5
    return out


def ellipsoid(rx, ry, rz, mat, u=14, v=9):
    """A smooth ellipsoid, poles up."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    for vert in bm.verts:
        x, y, z = vert.co.x, vert.co.y, vert.co.z
        vert.co = Vector((x * rx, z * ry, y * rz))
    return finish(bm, mat)


def lathe(profile, seg, mat, loop=True, seg_mats=None):
    """Revolves a (radius, height) profile about the y axis; `loop` closes the profile on itself.
    `seg_mats` names the material of each profile segment."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        rings.append([bm.verts.new((r * math.cos(math.tau * j / seg), h, r * math.sin(math.tau * j / seg))) for j in range(seg)])
    n = len(profile)
    pairs = n if loop else n - 1
    for i in range(pairs):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(seg):
            try:
                f = bm.faces.new((a[j], b[j], b[(j + 1) % seg], a[(j + 1) % seg]))
                f.material_index = MI[seg_mats[i]] if seg_mats else MI[mat]
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    out = M()
    out.v = [tuple(v.co) for v in bm.verts]
    out.f = [[v.index for v in f.verts] for f in bm.faces]
    out.m = [f.material_index if seg_mats else MI[mat] for f in bm.faces]
    out.s = [True] * len(out.f)
    bm.free()
    return watch(out, "a lathe made at line %d" % sys._getframe(1).f_lineno)


def loft(rings, mat, close_first=True, close_last=True, loop=False):
    """Skins rings (lists of 3D points, same count) into a solid; `loop` also joins the last ring to the first."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    pairs = len(vr) if loop else len(vr) - 1
    for i in range(pairs):
        a, b = vr[i], vr[(i + 1) % len(vr)]
        n = len(a)
        for j in range(n):
            try:
                bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
            except ValueError:
                pass
    if close_first and not loop:
        try:
            bm.faces.new(vr[0])
        except ValueError:
            pass
    if close_last and not loop:
        try:
            bm.faces.new(vr[-1][::-1])
        except ValueError:
            pass
    return finish(bm, mat)


def catmull_path(points, per=6, closed=False):
    """Resamples a polyline as a Catmull-Rom spline through its points."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    out = []
    rng = n if closed else n - 1
    for i in range(rng):
        g = (lambda k: pts[k % n]) if closed else (lambda k: pts[max(0, min(n - 1, k))])
        p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(pts[-1])
    return out


def tube(points, radii, seg, mat, smooth=0, caps=True, closed=False):
    """A round pipe along a path (radii: one value, or one per control point)."""
    path = catmull_path(points, smooth, closed) if smooth else [Vector(p) for p in points]
    n = len(path)
    if isinstance(radii, (int, float)):
        rad = [radii] * n
    else:
        k = len(radii)
        rad = []
        for i in range(n):
            f = i / max(n - 1, 1) * (k - 1)
            lo = min(int(f), k - 2)
            t = f - lo
            rad.append(radii[lo] * (1 - t) + radii[lo + 1] * t)
    rings = []
    prev = None
    for i in range(n):
        if closed:
            t = (path[(i + 1) % n] - path[(i - 1) % n]).normalized()
        else:
            t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        if closed:
            ref = Vector((0, 1, 0))
            nrm = (ref - t * ref.dot(t)).normalized()
        elif prev is None:
            ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            nrm = (ref - t * ref.dot(t)).normalized()
        else:
            nrm = (prev - t * prev.dot(t)).normalized()
        prev = nrm
        b = t.cross(nrm)
        rings.append([tuple(path[i] + (nrm * math.cos(math.tau * j / seg) + b * math.sin(math.tau * j / seg)) * rad[i]) for j in range(seg)])
    return loft(rings, mat, close_first=caps, close_last=caps, loop=closed)


def prism(poly, depth, mat, bevel=0.0, seg=2, plane="xy"):
    """A flat polygon (2D points (u, v)) extruded `depth` along the third axis, centred on it."""
    bm = bmesh.new()

    def P(u, v, w):
        if plane == "xy":
            return (u, v, w)
        if plane == "yz":  # u -> y, v -> z, w -> x
            return (w, u, v)
        return (u, w, v)  # "xz": u -> x, v -> z, w -> y

    vs = [bm.verts.new(P(u, v, -depth / 2)) for u, v in poly]
    f = bm.faces.new(vs)
    ex = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ex["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec={"xy": (0, 0, depth), "yz": (depth, 0, 0), "xz": (0, depth, 0)}[plane])
    if bevel > 1e-4:
        # Only the sharp rim edges (not the small facets of rounded corners); never let a bevel overlap.
        sharp = [e for e in bm.edges if e.calc_face_angle(0.0) > 0.9]
        bmesh.ops.bevel(bm, geom=sharp, offset=bevel, offset_type="OFFSET", segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    return finish(bm, mat)


def rounded_poly(pts, radius, per=4):
    """Rounds the corners of a closed 2D polygon with quadratic curves."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        a, b = p0 - p1, p2 - p1
        r = min(radius, a.length * 0.45, b.length * 0.45)
        a.normalize()
        b.normalize()
        s, e = p1 + a * r, p1 + b * r
        for k in range(per + 1):
            t = k / per
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t * t * e
            out.append((q.x, q.y))
    return out


def aim(m, point, normal, spin=0.0, level=False):
    """Turns a part built along +z so +z follows `normal`, and puts it at `point`.
    `level` also rolls it about the normal so its x axis stays as horizontal as the surface allows."""
    n = Vector(normal).normalized()
    r = Vector((0, 0, 1)).rotation_difference(n).to_matrix()
    if level:
        x = r @ Vector((1, 0, 0))
        level_x = Vector((1, 0, 0)) - n * n.x
        if level_x.length > 1e-4:
            level_x.normalize()
            roll = x.angle(level_x)
            if x.cross(level_x).dot(n) < 0:
                roll = -roll
            r = Matrix.Rotation(roll, 3, n) @ r
    return m.xf(RZ(spin)).xf(r.to_4x4()).xf(T(*point))


# ── The tubs: one hull a weight class ───────────────────────────────────────

#          z      half-width  bottom   top    squareness
PROFILES = {
    # The classic sprint kart: rounded, a little long in the nose.
    "middle": dict(
        keys=[
            (-1.33, 0.36, 0.34, 0.70, 2.4),
            (-1.22, 0.60, 0.29, 0.82, 3.0),
            (-0.95, 0.71, 0.26, 0.88, 3.4),
            (-0.65, 0.73, 0.25, 0.85, 3.4),
            (-0.25, 0.70, 0.25, 0.79, 3.2),
            (0.15, 0.65, 0.25, 0.76, 3.0),
            (0.55, 0.58, 0.25, 0.76, 2.9),
            (0.95, 0.51, 0.26, 0.65, 2.7),
            (1.30, 0.44, 0.28, 0.56, 2.5),
            (1.60, 0.35, 0.32, 0.49, 2.3),
        ],
        well=dict(z0=-0.10, hx=0.45, hz=0.66, r=0.30, depth=0.21),
    ),
    # The nimble buggy: a slim open tub on a tube frame, a little nose.
    "light": dict(
        keys=[
            (-1.30, 0.22, 0.38, 0.62, 2.4),
            (-1.18, 0.38, 0.31, 0.70, 2.8),
            (-0.90, 0.44, 0.28, 0.74, 3.0),
            (-0.55, 0.45, 0.27, 0.72, 3.0),
            (-0.15, 0.43, 0.27, 0.68, 3.0),
            (0.25, 0.38, 0.27, 0.62, 2.8),
            (0.65, 0.32, 0.28, 0.55, 2.6),
            (1.00, 0.26, 0.30, 0.50, 2.4),
            (1.28, 0.20, 0.33, 0.45, 2.2),
            (1.48, 0.12, 0.36, 0.42, 2.0),
        ],
        well=dict(z0=-0.12, hx=0.36, hz=0.62, r=0.24, depth=0.14),
    ),
    # The muscle kart: wide shoulders, a tall tail and a blunt, heavy nose.
    "heavy": dict(
        keys=[
            (-1.33, 0.50, 0.30, 0.86, 2.6),
            (-1.22, 0.72, 0.27, 0.96, 3.2),
            (-0.95, 0.80, 0.25, 1.00, 3.6),
            (-0.50, 0.82, 0.25, 0.95, 3.6),
            (-0.10, 0.80, 0.25, 0.88, 3.4),
            (0.30, 0.76, 0.25, 0.80, 3.2),
            (0.70, 0.70, 0.26, 0.80, 3.0),
            (1.05, 0.64, 0.27, 0.78, 2.9),
            (1.40, 0.58, 0.29, 0.70, 2.7),
            (1.75, 0.46, 0.33, 0.60, 2.4),
        ],
        well=dict(z0=-0.10, hx=0.42, hz=0.66, r=0.28, depth=0.22),
    ),
}
KEYS = PROFILES["middle"]["keys"]
WELL = PROFILES["middle"]["well"]
Z_REAR, Z_FRONT = KEYS[0][0], KEYS[-1][0]


def use_profile(name):
    """Makes `name`'s tub the one hull() builds."""
    global KEYS, WELL, Z_REAR, Z_FRONT
    KEYS = PROFILES[name]["keys"]
    WELL = PROFILES[name]["well"]
    Z_REAR, Z_FRONT = KEYS[0][0], KEYS[-1][0]


def catmull_scalar(p0, p1, p2, p3, t):
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)


def key_at(z):
    i = 0
    while i < len(KEYS) - 2 and z > KEYS[i + 1][0]:
        i += 1
    k = lambda n: KEYS[max(0, min(len(KEYS) - 1, n))]
    t = clamp((z - k(i)[0]) / ((k(i + 1)[0] - k(i)[0]) or 1))
    return [catmull_scalar(k(i - 1)[c], k(i)[c], k(i + 1)[c], k(i + 2)[c], t) for c in range(1, 5)]


def cap_scale(z):
    rear = min(1.0, (z - Z_REAR) / 0.22)
    front = min(1.0, (Z_FRONT - z) / 0.36)
    u = max(0.0, min(rear, front))
    return math.sqrt(max(0.0, 1 - (1 - u) * (1 - u)))


def rr_sdf(px, pz, hx, hz, r):
    qx = abs(px) - (hx - r)
    qz = abs(pz) - (hz - r)
    return math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0) - r


def well(z, x):
    return 1 - smoothstep(-0.085, 0.0, rr_sdf(x, z - WELL["z0"], WELL["hx"], WELL["hz"], WELL["r"]))


def hull_stations():
    zs = set()
    n = 22
    for i in range(n + 1):  # clustered toward both ends
        zs.add(round(Z_REAR + (Z_FRONT - Z_REAR) * (0.5 - 0.5 * math.cos(math.pi * i / n)), 4))
    z = WELL["z0"] - WELL["hz"] - 0.08
    while z < WELL["z0"] + WELL["hz"] + 0.1:  # evenly round the cockpit
        zs.add(round(z, 4))
        z += 0.056
    return sorted(zs)


XI_TOP = [1.0, 0.92, 0.82, 0.70, 0.56, 0.42, 0.28, 0.14, 0.0]


def hull():
    rings = []
    for z in hull_stations():
        hw, yb, yt, sq = key_at(z)
        s = cap_scale(z)
        hw, hh, ym, e = hw * s, (yt - yb) / 2 * s, (yt + yb) / 2, 2.0 / sq
        ts = [0.5 * math.pi * k / 3 for k in range(3)]                       # the bottom, centre toward the side
        ts += [math.pi - math.asin(min(1.0, xi ** (sq / 2.0))) for xi in XI_TOP]  # the side, over the top to its centre
        ts = ts + [math.tau - t for t in reversed(ts[1:-1])]
        pts = []
        for t in ts:
            x = hw * spow(math.sin(t), e)
            y = ym - hh * spow(math.cos(t), e)
            y -= WELL["depth"] * well(z, x) * smoothstep(-0.3, 0.7, -math.cos(t))
            pts.append((x, y, z))
        rings.append(pts)
    return loft(rings, "paint")


# ── The wheel ───────────────────────────────────────────────────────────────


def wheel(style="middle"):
    """One wheel in its own frame: origin at the hub, axis x, outer face toward +x.
    `style`: middle five spokes, light eight wire spokes, heavy a deep dished disc with lug nuts."""
    R = WHEEL_R
    out = M()
    # Built about y (height = along the axis), turned onto x at the end.
    half = [(0.268, 0.165), (0.298, 0.199), (0.343, 0.2125), (0.358, 0.2132), (0.395, 0.2065), (0.41, 0.16), (0.412, 0.0)]
    prof = [(r, -h) for r, h in half] + [(r, h) for r, h in reversed(half[:-1])]
    tyre = lathe(prof, 32, "rubber")
    for fi, f in enumerate(tyre.f):  # the pinstripe on the outer wall
        c = sum((Vector(tyre.v[i]) for i in f), Vector()) / len(f)
        if c.y > 0.19 and 0.345 < math.hypot(c.x, c.z) < 0.357:
            tyre.m[fi] = MI["paint"]
    out.add(tyre)
    # Tread lugs: tapered blocks standing on the tread (block's +y is radial), chevroned, two staggered rings.
    n = 20 if style != "heavy" else 16
    lw, ll = (0.092, 0.082) if style != "heavy" else (0.115, 0.1)
    for side in (-1, 1):
        for i in range(n):
            a = math.tau * (i + (0.5 if side > 0 else 0.0)) / n
            lug = block(lw, 0.03 if style != "heavy" else 0.04, ll, 0.7, "tread")
            lug.xf(RY(side * 0.5))                    # chevron about the radial axis
            lug.xf(RZ(-math.pi / 2))                  # radial y -> x (the lug now points along +x)
            lug.xf(T(R - 0.03, side * 0.088, 0))      # onto the tread, offset along the axis (y)
            out.add(lug.xf(RY(-a)))                   # round the wheel
    out.add(lathe([(0.305, 0.19), (0.296, 0.211), (0.272, 0.214), (0.25, 0.19), (0.238, 0.12), (0.238, 0.05), (0.305, 0.05)], 28, "rim"))
    if style == "heavy":
        # A deep dish: a dark well inside the lip, a raised hub with six lug nuts.
        out.add(lathe([(0.24, 0.19), (0.236, 0.11), (0.2, 0.07), (0.1, 0.06), (0.0, 0.07), (0.0, 0.03), (0.24, 0.03)], 24, "steel"))
        out.add(lathe([(0.15, 0.07), (0.15, 0.11), (0.12, 0.135), (0.0, 0.14), (0.0, 0.07)], 24, "rim"))
        for k in range(6):
            a = math.tau * k / 6
            nut = lathe([(0.0, 0.0), (0.028, 0.0), (0.028, 0.03), (0.0, 0.034)], 6, "chrome")
            out.add(nut.xf(T(0.095 * math.cos(a), 0.125, 0.095 * math.sin(a))))
        out.add(lathe([(0.0, 0.14), (0.05, 0.14), (0.05, 0.16), (0.0, 0.162)], 12, "paint"))
    else:
        out.add(lathe([(0.0, 0.075), (0.24, 0.1), (0.24, 0.05), (0.0, 0.03)], 20, "steel"))
        spokes, half_w = (8, 0.026) if style == "light" else (5, 0.04)
        for k in range(spokes):
            a = math.tau * k / spokes + 0.3
            spoke = prism([(-half_w, 0.04), (half_w, 0.04), (half_w * 1.4, 0.255), (-half_w * 1.4, 0.255)], 0.05 if style != "light" else 0.034, "rim", bevel=0.011 if style != "light" else 0.006, seg=1, plane="xz")
            out.add(spoke.xf(T(0, 0.12, 0)).xf(RY(a)))
        out.add(ellipsoid(0.09, 0.055, 0.09, "paint", u=12, v=6).xf(T(0, 0.135, 0)))
        out.add(lathe([(0.0, 0.19), (0.036, 0.186), (0.044, 0.17), (0.0, 0.165)], 12, "rim"))
    out.add(lathe([(0.0, -SPINDLE), (0.05, -SPINDLE), (0.056, -0.1), (0.0, -0.1)], 10, "steel"))
    return out.xf(RZ(-math.pi / 2))  # the axis, y, becomes +x


# ── The steering wheel ──────────────────────────────────────────────────────


def steering():
    out = M()
    R = 0.165
    ring = lathe([(R + 0.03 * math.cos(math.tau * k / 8), 0.03 * math.sin(math.tau * k / 8)) for k in range(8)], 20, "plastic")
    ring.xf(RX(math.pi / 2))  # the ring's axis, y, becomes z
    for fi, f in enumerate(ring.f):  # the top grip in paint
        c = sum((Vector(ring.v[i]) for i in f), Vector()) / len(f)
        if abs(math.atan2(c.y, c.x) - math.pi / 2) < 0.5:
            ring.m[fi] = MI["paint"]
    out.add(ring)
    for k in range(3):
        a = math.tau * k / 3 + math.pi / 2
        spoke = prism([(-0.022, 0.0), (0.022, 0.0), (0.017, R)], 0.032, "rim", bevel=0.0, seg=1, plane="xy")
        out.add(spoke.xf(RZ(a - math.pi / 2)))
    out.add(ellipsoid(0.06, 0.04, 0.06, "rim", u=10, v=6).xf(RX(math.pi / 2)).xf(T(0, 0, 0.012)))
    out.add(ellipsoid(0.036, 0.02, 0.036, "paint", u=8, v=5).xf(RX(math.pi / 2)).xf(T(0, 0, 0.04)))
    return out


# ── Ambient occlusion (into vertex colours) ─────────────────────────────────


def hemisphere(n):
    pts = []
    for i in range(n):
        u = (i + 0.5) / n
        phi = i * 2.399963
        r = math.sqrt(u)
        pts.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u))))
    return pts


def bake_ao(body, occluders, samples=26, reach=0.5, floor=0.36):
    """Per-vertex ambient occlusion of `body` against itself and `occluders`."""
    allm = M().add(body)
    for o in occluders:
        allm.add(o)
    tree = BVHTree.FromPolygons([Vector(p) for p in allm.v], [tuple(f) for f in allm.f], epsilon=1e-6)
    normals = [Vector() for _ in body.v]
    for f in body.f:
        p = [Vector(body.v[i]) for i in f]
        for k in range(1, len(f) - 1):
            n = (p[k] - p[0]).cross(p[k + 1] - p[0])
            for i in (f[0], f[k], f[k + 1]):
                normals[i] += n
    dirs = hemisphere(samples)
    ao = []
    for i, p in enumerate(body.v):
        n = normals[i]
        if n.length < 1e-12:
            ao.append(1.0)
            continue
        n = n.normalized()
        t = n.cross(Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))).normalized()
        b = n.cross(t)
        origin = Vector(p) + n * 0.006
        vis = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = tree.ray_cast(origin, w, reach)
            # open sky counts a little more when it is overhead
            vis += (0.7 + 0.3 * clamp(w.y * 0.5 + 0.5)) if hit[0] is None else (hit[3] / reach) * 0.4
        # Lit from above: undersides and flanks a little darker (the toy-like gradient the code-built kart had).
        ao.append(vis / samples * (0.74 + 0.26 * smoothstep(-0.85, 0.45, n.y)))
    return [floor + (1 - floor) * clamp(a) ** 1.3 for a in ao]


# ── Parts the three karts share the idea of ─────────────────────────────────


class Shell:
    """A hull you can ask questions of: where its surface is, and decals laid on it."""

    def __init__(self, H):
        self.H = H
        self.tree = BVHTree.FromPolygons([Vector(p) for p in H.v], [tuple(f) for f in H.f], epsilon=1e-6)

    def surface_y(self, x, z):
        hit = self.tree.ray_cast(Vector((x, 3.0, z)), Vector((0, -1, 0)), 6.0)
        return None if hit[0] is None else hit[0].y

    def hull_hit(self, x, y, z, direction):
        """Where a ray from (x, y, z) along `direction` meets the hull: (point, normal)."""
        hit = self.tree.ray_cast(Vector((x, y, z)), Vector(direction), 8.0)
        return (None, None) if hit[0] is None else (hit[0], hit[1])

    def strip(self, x0, x1, z0, z1, mat, nx=3, nz=36, lift=0.004):
        """A ribbon laid on the deck, projected down onto the hull."""
        rows = []
        for i in range(nz + 1):
            z = z0 + (z1 - z0) * i / nz
            row = []
            for j in range(nx):
                x = x0 + (x1 - x0) * j / (nx - 1)
                y = self.surface_y(x, z)
                if y is None:
                    return M()
                row.append((x, y + lift, z))
            rows.append(row)
        bm = bmesh.new()
        vr = [[bm.verts.new(p) for p in row] for row in rows]
        for i in range(nz):
            for j in range(nx - 1):
                bm.faces.new((vr[i][j], vr[i + 1][j], vr[i + 1][j + 1], vr[i][j + 1]))
        out = finish(bm, mat, closed=False)
        for f in out.f:
            a, b, c = (Vector(out.v[i]) for i in f[:3])
            if (b - a).cross(c - a).y < 0:
                f.reverse()
        return out

    def project(self, mode, sx, a, b):
        """The hull's surface under the 2D point (a along the kart, b across or up): (point, normal) or None.
        `side` looks at the flank on side sx (b is height), `top` down on the deck (b is x)."""
        if mode == "side":
            p, n = self.hull_hit(sx * 3.0, b, a, (-sx, 0, 0))
        else:
            p, n = self.hull_hit(b, 3.0, a, (0, -1, 0))
        return None if p is None else (p, n)


# ── Livery: a second colour in a pattern, laid on the flanks and the hood ────

LIVERIES = ["flames", "spots", "checks", "waves", "tiger", "chevrons", "bolts", "diamonds", "twin"]


def resample(pts, per=6):
    """Straight subdivision of a 2D polyline."""
    out = []
    for i in range(len(pts) - 1):
        for k in range(per):
            t = k / per
            out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t))
    out.append(pts[-1])
    return out


def decal(sh, mode, sx, prims, lift=0.006):
    """Primitives (in the 2D metric of the window) projected onto the hull as one mesh of the "livery" material."""
    out = M()
    normals = []

    def P(a, b):
        return sh.project(mode, sx, a, b)

    def grid(rows):
        hits = [[P(a, b) for a, b in row] for row in rows]
        idx = {}
        for i, row in enumerate(hits):
            for j, h in enumerate(row):
                if h:
                    idx[(i, j)] = len(out.v)
                    out.v.append(tuple(h[0] + h[1] * lift))
                    normals.append(h[1])
        for i in range(len(hits) - 1):
            for j in range(len(hits[i]) - 1):
                ks = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                if all(k in idx for k in ks):
                    out.f.append([idx[k] for k in ks])

    for prim in prims:
        kind = prim[0]
        if kind == "ribbon":
            _, pts, widths, smooth = prim
            if smooth:
                path = [(v.x, v.y) for v in catmull_path([(a, b, 0.0) for a, b in pts], smooth)]
            else:
                path = resample(pts, 6)
            n = len(path)
            rows = []
            for i, (a, b) in enumerate(path):
                f = i / max(n - 1, 1) * (len(widths) - 1)
                lo = min(int(f), len(widths) - 2)
                w = max(0.006, widths[lo] * (1 - (f - lo)) + widths[lo + 1] * (f - lo))
                a2, b2 = path[min(i + 1, n - 1)]
                a1, b1 = path[max(i - 1, 0)]
                ta, tb = a2 - a1, b2 - b1
                ln = math.hypot(ta, tb) or 1.0
                pa, pb = -tb / ln, ta / ln
                rows.append([(a - pa * w / 2, b - pb * w / 2), (a, b), (a + pa * w / 2, b + pb * w / 2)])
            grid(rows)
        elif kind == "quad":
            _, a0, b0, a1, b1 = prim
            rows = [[(a0 + (a1 - a0) * j / 2, b0 + (b1 - b0) * i / 2) for j in range(3)] for i in range(3)]
            grid(rows)
        elif kind == "disc":
            _, ca, cb, r, seg = prim
            hits = [P(ca, cb)] + [P(ca + math.cos(math.tau * k / seg + math.pi / seg * (seg == 4)) * r * s, cb + math.sin(math.tau * k / seg + math.pi / seg * (seg == 4)) * r * s) for s in (0.55, 1.0) for k in range(seg)]
            if not all(hits):
                continue
            base = len(out.v)
            for h in hits:
                out.v.append(tuple(h[0] + h[1] * lift))
                normals.append(h[1])
            for k in range(seg):
                k2 = (k + 1) % seg
                out.f.append([base, base + 1 + k, base + 1 + k2])
                out.f.append([base + 1 + k, base + 1 + seg + k, base + 1 + seg + k2, base + 1 + k2])
    # Face outward, like the hull under each face.
    for f in out.f:
        pts = [Vector(out.v[i]) for i in f]
        nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        avg = sum((normals[i] for i in f), Vector())
        if nrm.dot(avg) < 0:
            f.reverse()
    out.m = [MI["livery"]] * len(out.f)
    out.s = [True] * len(out.f)
    return out


def pattern(name, a0, a1, b0, b1):
    """The primitives of livery `name` in the window a0..a1 (along the kart, forward is +a) by b0..b1."""
    L, bc, bh = a1 - a0, (b0 + b1) / 2, (b1 - b0) / 2
    u = lambda t: a0 + L * t
    v = lambda w: bc + bh * w
    prims = []
    if name == "flames":
        for k, (w0, ln, sgn) in enumerate([(-0.55, 0.85, 1), (0.0, 1.0, -1), (0.55, 0.7, 1)]):
            pts = [(u(0.0), v(w0)), (u(ln * 0.3), v(w0 + 0.1 * sgn)), (u(ln * 0.62), v(w0 - 0.07 * sgn)), (u(ln), v(w0 + 0.16 * sgn))]
            prims.append(("ribbon", pts, [bh * 0.62, bh * 0.58, bh * 0.34, 0.01], 4))
    elif name == "spots":
        for t, w, r in [(0.1, -0.5, 0.3), (0.3, 0.4, 0.4), (0.5, -0.25, 0.28), (0.68, 0.5, 0.34), (0.86, -0.4, 0.3), (0.88, 0.45, 0.2), (0.5, 0.62, 0.14), (0.28, -0.7, 0.14)]:
            prims.append(("disc", u(t), v(w), bh * r, 12))
    elif name == "checks":
        cols = max(4, int(L / (bh * 0.9)))
        for i in range(cols):
            for j in range(2):
                if (i + j) % 2 == 0:
                    prims.append(("quad", u(i / cols), v(-1 + j), u((i + 1) / cols), v(j)))
    elif name == "waves":
        for w0, ph in ((-0.45, 0.0), (0.45, 1.6)):
            pts = [(u(t / 8), v(w0 + 0.22 * math.sin(t / 8 * math.tau * 1.5 + ph))) for t in range(9)]
            prims.append(("ribbon", pts, [bh * 0.3], 3))
    elif name == "tiger":
        for i in range(5):
            t = (i + 0.5) / 5
            prims.append(("ribbon", [(u(t - 0.05), v(-0.92)), (u(t), v(0.0)), (u(t + 0.05), v(0.92))], [L * 0.02, L * 0.075, L * 0.02], 0))
    elif name == "chevrons":
        for t0 in (0.08, 0.38, 0.68):
            prims.append(("ribbon", [(u(t0), v(-0.85)), (u(t0 + 0.2), v(0.0)), (u(t0), v(0.85))], [bh * 0.26], 4))
    elif name == "bolts":
        prims.append(("ribbon", [(u(0.0), v(0.9)), (u(0.55), v(-0.05))], [bh * 0.08, bh * 0.5], 0))
        prims.append(("ribbon", [(u(0.4), v(0.1)), (u(1.0), v(-0.92))], [bh * 0.5, bh * 0.06], 0))
    elif name == "diamonds":
        for t, r in [(0.14, 0.5), (0.38, 0.75), (0.64, 0.75), (0.88, 0.5)]:
            prims.append(("disc", u(t), v(0.0), bh * r, 4))
    elif name == "twin":
        for w0 in (-0.5, 0.5):
            prims.append(("ribbon", [(u(0.0), v(w0)), (u(1.0), v(w0))], [bh * 0.3], 0))
    return prims


# Where the pattern goes: a window on the flank (a: along z, b: height) and one on the hood (b: x, mirrored).
LIVERY_WINDOWS = {
    "middle": dict(side=(-0.36, 0.5, 0.37, 0.73), top=(0.64, 1.38, 0.17, 0.36)),
    "light": dict(side=(-0.38, 0.5, 0.34, 0.63), top=(0.45, 1.1, 0.04, 0.17)),
    "heavy": dict(side=(-0.36, 0.5, 0.37, 0.85), top=(0.7, 1.5, 0.24, 0.5)),
}


def livery(sh, cls, name):
    out = M()
    a0, a1, b0, b1 = LIVERY_WINDOWS[cls]["side"]
    for sx in (-1, 1):
        out.add(decal(sh, "side", sx, pattern(name, a0, a1, b0, b1)))
    a0, a1, x0, x1 = LIVERY_WINDOWS[cls]["top"]
    for sx in (-1, 1):
        lo, hi = sorted((sx * x0, sx * x1))
        out.add(decal(sh, "top", sx, pattern(name, a0, a1, lo, hi)))
    return out


# ── Small assemblies ────────────────────────────────────────────────────────


def coil(top, bot, radius, turns, wire, mat="steel", per=7, seg=4):
    """A coil spring wound round the line from `top` to `bot`."""
    top, bot = Vector(top), Vector(bot)
    axis = bot - top
    ln = axis.length
    ax = axis / ln
    ref = Vector((1, 0, 0)) if abs(ax.x) < 0.9 else Vector((0, 1, 0))
    u = ax.cross(ref).normalized()
    w = ax.cross(u)
    n = int(turns * per)
    pts = [tuple(top + ax * (ln * i / n) + (u * math.cos(math.tau * turns * i / n) + w * math.sin(math.tau * turns * i / n)) * radius) for i in range(n + 1)]
    return tube(pts, wire, seg, mat)


def fender(sx, hub, R, x0, x1, a0=0.15, a1=2.95, rise=0.075, thick=0.05, mat="paint"):
    """A flared mudguard arching over a wheel (hub = (x, y, z); x0..x1 the span across, on the side sx)."""
    rings = []
    n = 14
    cx, hw = (x0 + x1) / 2, (x1 - x0) / 2
    for i in range(n + 1):
        t = i / n
        a = a0 + (a1 - a0) * t
        d = Vector((0, math.sin(a), math.cos(a)))
        taper = 0.4 + 0.6 * math.sin(math.pi * t) ** 0.6
        c = Vector((0, hub[1], hub[2])) + d * (R + rise)
        ring = []
        for k in range(10):
            ph = math.tau * k / 10
            ex = hw * spow(math.cos(ph), 0.7) * taper
            ed = thick * spow(math.sin(ph), 0.7) * (0.7 + 0.3 * taper)
            p = c + d * ed
            ring.append((sx * (cx + ex), p.y, p.z))
        rings.append(ring)
    return loft(rings, mat)


def seat(body, w=1.0):
    """The bucket seat: a plastic shell, a cushion, a padded back with bolsters and a headrest."""
    body.add(rbox(0.62 * w, 0.26, 0.54, 0.08, "plastic", seg=2).xf(T(0, 0.66, -0.18)))
    body.add(rbox(0.56 * w, 0.12, 0.5, 0.05, "seat", seg=2).xf(T(0, 0.775, -0.17)))
    body.add(rbox(0.68 * w, 0.64, 0.12, 0.07, "paint", seg=2).xf(RX(0.2)).xf(T(0, 1.1, -0.6)))
    body.add(rbox(0.54 * w, 0.5, 0.07, 0.04, "seat", seg=1).xf(RX(0.2)).xf(T(0, 1.06, -0.535)))
    for sx in (-1, 1):
        body.add(ellipsoid(0.07, 0.3, 0.075, "seat", u=10, v=6).xf(RX(0.2)).xf(T(sx * 0.3 * w, 1.02, -0.53)))
    body.add(ellipsoid(0.17, 0.1, 0.07, "seat", u=12, v=7).xf(RX(0.2)).xf(T(0, 1.4, -0.595)))


def column_and_dash(body, dash_w=0.46):
    body.add(rbox(dash_w, 0.1, 0.2, 0.05, "plastic", seg=1).xf(RX(-0.25)).xf(T(0, 0.8, 0.5)))
    body.add(tube([(0.0, 0.72, 0.5), (0.0, 0.9, 0.36), (STEER_AT[0], STEER_AT[1] - 0.02, STEER_AT[2])], 0.03, 8, "steel", smooth=2))


def megaphones(body, scale=1.0, lean=0.06):
    """The tailpipes: chrome horns, dark inside, mouths at the exhaust the effects fire from."""
    horn = lathe(
        [(0.05, 0.0), (0.062, 0.16), (0.09, 0.31), (0.126, 0.44), (0.118, 0.468), (0.098, 0.452), (0.04, 0.12), (0.0, 0.1), (0.0, 0.0)],
        14,
        "chrome",
        seg_mats=["chrome"] * 4 + ["plastic"] * 5,
    )
    for sx in (-1, 1):
        h = M().add(horn)
        h.xf(Matrix.Diagonal((scale, scale, scale, 1.0)))
        h.xf(RX(-math.pi / 2)).xf(RY(sx * lean)).xf(T(sx * EXHAUST[0], EXHAUST[1], EXHAUST[2] + 0.468 * scale))
        body.add(h)


def lamp(body, sh, x, y, r=0.1, seg=12):
    """A headlamp in a chrome bezel set into the nose."""
    p, n = sh.hull_hit(x, y, 3.0, (0, 0, -1))
    if p is None:
        return
    lm = M()
    lm.add(lathe([(r + 0.018 * math.cos(math.tau * k / 6), 0.018 * math.sin(math.tau * k / 6)) for k in range(6)], seg, "chrome"))
    lm.add(ellipsoid(r * 0.88, 0.05, r * 0.88, "lamp", u=seg, v=6).xf(T(0, -0.012, 0)))
    lm.xf(RX(math.pi / 2))
    body.add(aim(lm, p + n * 0.012, n))


def tail_lamps(body, sh, x, y, size=(0.24, 0.07, 0.05)):
    ok = False
    for sx in (-1, 1):
        p, n = sh.hull_hit(sx * x, y, -3.0, (0, 0, 1))
        if p is not None:
            body.add(aim(rbox(*size, 0.02, "tail", seg=1), p + n * 0.012, n, level=True))
            ok = True
    if not ok:
        for sx in (-1, 1):
            body.add(rbox(size[0], size[1], size[2], 0.02, "tail", seg=1).xf(T(sx * x, y, PLATE_Z + 0.05)))


def number_plate(body, bracket=None):
    body.add(rbox(0.46, 0.27, 0.06, 0.03, "trim", seg=1).xf(T(0, PLATE_Y, PLATE_Z + 0.03)))
    if bracket:
        for sx in (-1, 1):
            body.add(tube([(sx * 0.15, PLATE_Y - 0.1, PLATE_Z + 0.06), (sx * 0.14, PLATE_Y - 0.08, PLATE_Z + 0.2)], 0.016, 6, "steel"))


def mirrors(body, x=0.68, y=0.96, z=0.37, stalk_from=(0.5, 0.74, 0.42), size=1.0):
    for sx in (-1, 1):
        body.add(tube([(sx * stalk_from[0], stalk_from[1], stalk_from[2]), (sx * x, y - 0.01, z + 0.01)], 0.014 * size, 6, "chrome"))
        mir = M().add(rbox(0.11 * size, 0.08 * size, 0.034, 0.016, "paint", seg=1)).add(rbox(0.09 * size, 0.062 * size, 0.01, 0.002, "glass", seg=1).xf(T(0, 0, -0.018)))
        body.add(mir.xf(RY(sx * 0.35)).xf(T(sx * x, y, z)))


def front_suspension(body, inner_x=0.46, sleeve=True, spring=(0.05, 4, 0.011), arm_r=0.024):
    """Wishbones to the front hubs (ending at the wheel's spindle), a damper wrapped in a coil spring."""
    spindle = FRONT_SCALE * SPINDLE
    for sx in (-1, 1):
        hub = (sx * (FRONT[0] - spindle), FRONT[1], FRONT[2])
        body.add(tube([(sx * inner_x, 0.4, FRONT[2] + 0.22), (sx * (inner_x + 0.1), 0.38, FRONT[2] + 0.1), hub], arm_r, 6, "chrome", smooth=2))
        body.add(tube([(sx * inner_x, 0.34, FRONT[2] - 0.22), (sx * (inner_x + 0.1), 0.35, FRONT[2] - 0.1), hub], arm_r, 6, "chrome", smooth=2))
        top, bot = Vector((sx * (inner_x - 0.06), 0.62, FRONT[2])), Vector(hub)
        body.add(tube([tuple(top), tuple(bot)], 0.016, 6, "chrome"))
        if sleeve:
            body.add(tube([tuple(top + (bot - top) * 0.04), tuple(top + (bot - top) * 0.26)], 0.04, 8, "paint"))
        r, turns, wire = spring
        body.add(coil(top + (bot - top) * (0.3 if sleeve else 0.18), top + (bot - top) * 0.86, r, turns, wire))


def rear_suspension(body, spring=None):
    """A trailing arm to the rear hub and, behind the wheel, a damper (with a coil, if asked)."""
    for sx in (-1, 1):
        body.add(tube([(sx * 0.6, 0.31, -0.34), (sx * (REAR[0] - 0.24), REAR[1], REAR[2])], 0.034, 6, "steel"))
        top, bot = (sx * 0.4, 0.92, REAR[2] - 0.2), (sx * (REAR[0] - 0.25), REAR[1] + 0.06, REAR[2] - 0.12)
        body.add(tube([top, bot], 0.016, 6, "chrome"))
        if spring:
            r, turns, wire = spring
            t, b = Vector(top), Vector(bot)
            body.add(coil(t + (b - t) * 0.18, t + (b - t) * 0.86, r, turns, wire))


def cockpit_piping(body, sh, z0, tube_r=0.024):
    ring = []
    for k in range(32):
        a = math.tau * k / 32
        dx, dz = math.sin(a), math.cos(a)
        lo, hi = 0.0, 2.0
        for _ in range(24):
            mid = (lo + hi) / 2
            if rr_sdf(dx * mid, dz * mid, WELL["hx"] - 0.02, WELL["hz"] - 0.02, WELL["r"]) < 0:
                lo = mid
            else:
                hi = mid
        x, z = dx * lo, dz * lo + WELL["z0"]
        y = sh.surface_y(x, z)
        if y is not None:
            ring.append((x, y + 0.008, z))
    body.add(tube(ring, tube_r, 5, "trim", closed=True))


# ── The three karts ─────────────────────────────────────────────────────────


def build_middle(sh):
    """The classic sprint kart: a rounded tub, racing stripes, a wing on curved struts, chrome bumpers."""
    body = M()
    body.add(sh.H)
    body.add(sh.strip(-0.1, 0.1, -1.2, -0.81, "stripe", nz=10))
    body.add(sh.strip(-0.1, 0.1, 0.6, 1.5, "stripe", nz=22))
    for sx in (-1, 1):
        body.add(sh.strip(sx * 0.15, sx * 0.17, -1.2, -0.81, "stripe", nx=2, nz=10))
        body.add(sh.strip(sx * 0.15, sx * 0.17, 0.6, 1.4, "stripe", nx=2, nz=18))
    cockpit_piping(body, sh, -0.1)

    # The underplate, and side pods: dark skirts with a white rail.
    body.add(rbox(1.04, 0.05, 2.72, 0.02, "plastic", seg=1).xf(T(0, 0.225, 0.12)))
    for sx in (-1, 1):
        body.add(ellipsoid(0.11, 0.13, 0.62, "plastic", u=12, v=8).xf(T(sx * 0.67, 0.40, 0.12)))
        body.add(rbox(0.045, 0.045, 1.0, 0.02, "trim", seg=1).xf(T(sx * 0.775, 0.43, 0.12)))
    seat(body)

    # The engine behind the seat: a cover, ribs, two chrome stacks.
    body.add(rbox(0.6, 0.3, 0.46, 0.1, "steel", seg=2).xf(T(0, 1.0, -1.02)))
    for k in range(3):
        body.add(rbox(0.5 - k * 0.07, 0.026, 0.05, 0.012, "chrome", seg=1).xf(T(0, 0.93 + k * 0.065, -1.265 + k * 0.03)))
    for sx in (-1, 1):
        horn = lathe([(0.03, 0.0), (0.05, 0.12), (0.078, 0.2), (0.07, 0.205), (0.026, 0.05)], 12, "chrome")
        body.add(horn.xf(T(sx * 0.14, 1.12, -0.97)))
    megaphones(body)

    # The wing: an aerofoil on two curved chrome struts, with end plates.
    chord, span = 0.46, 1.30
    thick = lambda x: 0.8 * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    camber = lambda x: 0.03 * math.sin(math.pi * x)
    xs = [i / 8 for i in range(9)]
    upper = [(x, thick(x) + camber(x)) for x in xs]
    lower = [(x, -thick(x) + camber(x)) for x in reversed(xs[1:-1])]
    sect = [(-(x - 0.5) * chord, y * chord) for x, y in upper + lower]
    wing_rings = [[(x, y, z) for z, y in sect] for x in (-span / 2, -0.1, 0.1, span / 2)]
    wing = loft(wing_rings, "paint")
    for fi, f in enumerate(wing.f):
        pts = [Vector(wing.v[i]) for i in f]
        if len(f) == 4 and all(abs(p.x) < 0.11 for p in pts):
            nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            if nrm.y > 0.0 and sum(p.y for p in pts) / 4 > 0.0:
                wing.m[fi] = MI["stripe"]
    body.add(wing.xf(RX(0.1)).xf(T(0, 1.17, -1.38)))
    for sx in (-1, 1):
        plate = prism(rounded_poly([(0.16, -0.27), (0.16, 0.12), (0.0, 0.25), (-0.14, 0.2), (-0.14, -0.2)], 0.05, per=2), 0.03, "trim", bevel=0.008, seg=1, plane="yz")
        body.add(plate.xf(T(sx * 0.665, 1.17, -1.38)))
        body.add(tube([(sx * 0.38, 0.78, -1.12), (sx * 0.38, 0.95, -1.2), (sx * 0.38, 1.13, -1.32)], 0.028, 8, "chrome", smooth=3))
    rear = [(0.52, 0.4, -0.96), (0.55, 0.4, -1.2), (0.4, 0.4, -1.46), (0.0, 0.4, -1.55), (-0.4, 0.4, -1.46), (-0.55, 0.4, -1.2), (-0.52, 0.4, -0.96)]
    body.add(tube(rear, 0.03, 8, "chrome", smooth=3))
    number_plate(body)
    tail_lamps(body, sh, 0.4, 0.74)
    for sx in (-1, 1):
        lamp(body, sh, sx * 0.19, 0.44)

    # The bumper: a chrome U round the nose, on two brackets, and a splitter with end plates.
    bump = [(0.47, 0.42, 1.12), (0.52, 0.42, 1.38), (0.38, 0.43, 1.66), (0.0, 0.43, 1.76), (-0.38, 0.43, 1.66), (-0.52, 0.42, 1.38), (-0.47, 0.42, 1.12)]
    body.add(tube(bump, 0.034, 8, "chrome", smooth=3))
    for sx in (-1, 1):
        body.add(tube([(sx * 0.2, 0.4, 1.5), (sx * 0.22, 0.42, 1.64), (sx * 0.2, 0.43, 1.74)], 0.026, 6, "chrome", smooth=2))
    split = prism(rounded_poly([(-0.8, 1.52), (0.8, 1.52), (0.62, 1.9), (-0.62, 1.9)], 0.12, per=2), 0.035, "trim", bevel=0.01, seg=1, plane="xz")
    body.add(split.xf(T(0, 0.3, 0)))
    for sx in (-1, 1):
        plate = prism(rounded_poly([(-0.02, 1.54), (-0.02, 1.86), (0.14, 1.82), (0.2, 1.6)], 0.04, per=2), 0.03, "paint", bevel=0.007, seg=1, plane="yz")
        body.add(plate.xf(T(sx * 0.78, 0.3, 0)))
    front_suspension(body)
    rear_suspension(body)
    mirrors(body)
    column_and_dash(body)
    return body


def build_light(sh):
    """The nimble buggy: a slim open tub on a painted tube frame, an exposed engine, springs in the open, a small nose."""
    body = M()
    body.add(sh.H)
    body.add(sh.strip(-0.07, 0.07, 0.55, 1.3, "stripe", nz=16))
    body.add(sh.strip(-0.07, 0.07, -1.2, -0.8, "stripe", nz=8))
    cockpit_piping(body, sh, -0.12, 0.02)
    body.add(rbox(0.78, 0.04, 2.5, 0.02, "plastic", seg=1).xf(T(0, 0.235, 0.1)))
    seat(body, 0.82)

    # The roll cage: a main hoop behind the driver, a dash arch, side rails and braces, in the kart's colour over steel.
    hoop = [(0.40, 0.55, -0.64), (0.40, 1.25, -0.68), (0.30, 1.7, -0.71), (0, 1.84, -0.72), (-0.30, 1.7, -0.71), (-0.40, 1.25, -0.68), (-0.40, 0.55, -0.64)]
    body.add(tube(hoop, 0.032, 8, "paint", smooth=3))
    arch = [(0.34, 0.62, 0.45), (0.31, 1.0, 0.43), (0.18, 1.14, 0.41), (-0.18, 1.14, 0.41), (-0.31, 1.0, 0.43), (-0.34, 0.62, 0.45)]
    body.add(tube(arch, 0.026, 6, "steel", smooth=3))
    for sx in (-1, 1):
        body.add(tube([(sx * 0.4, 1.25, -0.68), (sx * 0.37, 1.1, -0.1), (sx * 0.33, 0.98, 0.42)], 0.026, 6, "steel", smooth=3))
        body.add(tube([(sx * 0.33, 0.98, 0.42), (sx * 0.22, 0.62, 0.9), (sx * 0.1, 0.44, 1.38)], 0.02, 6, "chrome", smooth=3))
        body.add(tube([(sx * 0.3, 1.7, -0.71), (sx * 0.34, 1.2, -1.04), (sx * 0.32, 0.72, -1.26)], 0.026, 6, "paint", smooth=3))
        body.add(tube([(sx * 0.4, 0.58, -0.62), (sx * 0.34, 0.9, -1.08)], 0.02, 6, "steel"))
    body.add(tube([(-0.4, 1.3, -0.69), (0.4, 0.82, -0.64)], 0.02, 6, "steel"))
    body.add(tube([(0.4, 1.3, -0.69), (-0.4, 0.82, -0.64)], 0.02, 6, "steel"))
    # A pennant on an aerial.
    body.add(tube([(0.0, 1.82, -0.72), (0.0, 2.25, -0.72)], 0.008, 5, "steel"))
    body.add(prism([(0.0, 0.0), (0.0, 0.2), (-0.22, 0.1)], 0.01, "livery", bevel=0.0, seg=1, plane="xy").xf(RY(math.pi / 2)).xf(T(0, 2.07, -0.72)))

    # The engine, bare in the back: a block with cooling fins, a chrome air filter, a pair of short stacks.
    body.add(rbox(0.36, 0.26, 0.34, 0.07, "steel", seg=2).xf(T(0, 0.86, -1.0)))
    for k in range(4):
        body.add(rbox(0.46, 0.022, 0.4, 0.01, "chrome", seg=1).xf(T(0, 0.96 + k * 0.05, -1.0)))
    body.add(lathe([(0.0, 0.0), (0.09, 0.0), (0.12, 0.06), (0.11, 0.12), (0.0, 0.13)], 14, "chrome").xf(T(0, 1.16, -1.0)))
    for sx in (-1, 1):
        body.add(lathe([(0.03, 0.0), (0.045, 0.1), (0.06, 0.18), (0.052, 0.185), (0.024, 0.05)], 10, "chrome").xf(T(sx * 0.14, 0.94, -0.84)))
    megaphones(body, 0.78, 0.1)

    number_plate(body, bracket=True)
    tail_lamps(body, sh, 0.17, 0.66, (0.16, 0.06, 0.05))
    rear = [(0.3, 0.42, -1.0), (0.32, 0.42, -1.25), (0.14, 0.42, -1.5), (-0.14, 0.42, -1.5), (-0.32, 0.42, -1.25), (-0.3, 0.42, -1.0)]
    body.add(tube(rear, 0.026, 6, "chrome", smooth=3))

    # The nose: a single round lamp, a small chrome bumper and a thin splitter.
    lamp(body, sh, 0.0, 0.405, 0.085)
    bump = [(0.28, 0.4, 1.0), (0.3, 0.4, 1.3), (0.16, 0.4, 1.58), (0.0, 0.4, 1.62), (-0.16, 0.4, 1.58), (-0.3, 0.4, 1.3), (-0.28, 0.4, 1.0)]
    body.add(tube(bump, 0.028, 6, "chrome", smooth=3))
    split = prism(rounded_poly([(-0.5, 1.12), (0.5, 1.12), (0.3, 1.66), (-0.3, 1.66)], 0.1, per=2), 0.03, "trim", bevel=0.008, seg=1, plane="xz")
    body.add(split.xf(T(0, 0.31, 0)))
    front_suspension(body, 0.36, sleeve=False, spring=(0.058, 4, 0.012), arm_r=0.026)
    rear_suspension(body, spring=(0.05, 4, 0.011))
    column_and_dash(body, 0.34)
    return body


def build_heavy(sh):
    """The muscle kart: wide flared fenders, a deep bumper and grille, a hood scoop, twin stacks and pipes, a ducktail wing."""
    body = M()
    body.add(sh.H)
    body.add(sh.strip(-0.14, 0.14, -1.2, -0.81, "stripe", nz=10))
    for sx in (-1, 1):
        body.add(sh.strip(sx * 0.3, sx * 0.4, 1.12, 1.62, "stripe", nz=14, nx=2))
    cockpit_piping(body, sh, -0.1, 0.028)

    # Fenders over all four wheels.
    for sx in (-1, 1):
        body.add(fender(sx, FRONT, WHEEL_R * FRONT_SCALE, 0.64, 1.08, 0.12, 2.9, 0.075, 0.05))
        body.add(fender(sx, REAR, WHEEL_R, 0.7, 1.17, 0.2, 2.85, 0.08, 0.055))
    # Side skirts with a chrome rail, and a heavy plate under it all.
    body.add(rbox(1.2, 0.06, 2.9, 0.025, "plastic", seg=1).xf(T(0, 0.22, 0.14)))
    for sx in (-1, 1):
        body.add(rbox(0.1, 0.16, 1.2, 0.05, "plastic", seg=1).xf(T(sx * 0.8, 0.38, -0.05)))
        body.add(rbox(0.04, 0.04, 1.1, 0.018, "chrome", seg=1).xf(T(sx * 0.855, 0.42, -0.05)))
    seat(body, 1.1)

    # A thick painted roll hoop behind the seat.
    hoop = [(0.5, 0.7, -0.78), (0.5, 1.3, -0.8), (0.36, 1.66, -0.82), (0, 1.76, -0.83), (-0.36, 1.66, -0.82), (-0.5, 1.3, -0.8), (-0.5, 0.7, -0.78)]
    body.add(tube(hoop, 0.048, 8, "paint", smooth=3))

    # Twin stacks and big pipes.
    for sx in (-1, 1):
        body.add(lathe([(0.055, 0.0), (0.07, 0.3), (0.1, 0.52), (0.092, 0.54), (0.05, 0.3)], 12, "chrome").xf(T(sx * 0.3, 0.95, -1.12)))
        body.add(tube([(sx * 0.3, 0.95, -1.12), (sx * 0.3, 0.95, -1.0)], 0.07, 8, "steel"))
    megaphones(body, 1.3, 0.05)

    # The ducktail wing: a thick lip on two posts, with deep end plates.
    wing = prism(rounded_poly([(-0.74, -0.2), (0.74, -0.2), (0.74, 0.2), (-0.74, 0.2)], 0.09, per=3), 0.07, "paint", bevel=0.02, seg=2, plane="xz")
    body.add(wing.xf(RX(0.2)).xf(T(0, 1.3, -1.4)))
    body.add(rbox(1.0, 0.025, 0.1, 0.012, "stripe", seg=1).xf(RX(0.2)).xf(T(0, 1.345, -1.31)))
    for sx in (-1, 1):
        plate = prism(rounded_poly([(0.18, -0.2), (0.18, 0.18), (-0.06, 0.28), (-0.2, 0.2), (-0.2, -0.2)], 0.05, per=2), 0.035, "trim", bevel=0.008, seg=1, plane="yz")
        body.add(plate.xf(T(sx * 0.76, 1.3, -1.4)))
        body.add(tube([(sx * 0.46, 0.9, -1.1), (sx * 0.46, 1.1, -1.28), (sx * 0.46, 1.27, -1.38)], 0.034, 8, "chrome", smooth=3))
    body.add(tube([(0.62, 0.38, -1.0), (0.66, 0.38, -1.25), (0.5, 0.38, -1.5), (0, 0.38, -1.58), (-0.5, 0.38, -1.5), (-0.66, 0.38, -1.25), (-0.62, 0.38, -1.0)], 0.046, 8, "chrome", smooth=3))
    number_plate(body, bracket=True)
    tail_lamps(body, sh, 0.5, 0.8, (0.3, 0.09, 0.05))

    # The hood scoop: a raised wedge with a dark mouth and a pair of pins.
    body.add(rbox(0.4, 0.15, 0.7, 0.07, "paint", seg=2).xf(RX(-0.09)).xf(T(0, 0.88, 0.98)))
    body.add(rbox(0.3, 0.075, 0.05, 0.02, "plastic", seg=1).xf(RX(-0.09)).xf(T(0, 0.88, 1.35)))
    body.add(rbox(0.1, 0.02, 0.5, 0.008, "stripe", seg=1).xf(RX(-0.09)).xf(T(0, 0.972, 0.97)))
    for sx in (-1, 1):
        body.add(tube([(sx * 0.3, 0.84, 0.74), (sx * 0.3, 0.9, 0.74)], 0.012, 6, "chrome"))

    # The nose: big twin lamps, a grille of chrome slats, a deep bumper bar.
    for sx in (-1, 1):
        lamp(body, sh, sx * 0.3, 0.5, 0.115)
    body.add(rbox(0.5, 0.17, 0.05, 0.03, "plastic", seg=1).xf(T(0, 0.5, 1.7)))
    for k in range(5):
        body.add(rbox(0.018, 0.14, 0.03, 0.008, "chrome", seg=1).xf(T(-0.16 + k * 0.08, 0.5, 1.735)))
    body.add(rbox(1.1, 0.16, 0.2, 0.07, "steel", seg=2).xf(T(0, 0.34, 1.76)))
    body.add(rbox(1.14, 0.045, 0.14, 0.02, "chrome", seg=1).xf(T(0, 0.43, 1.84)))
    for sx in (-1, 1):
        body.add(rbox(0.12, 0.2, 0.2, 0.05, "paint", seg=1).xf(T(sx * 0.58, 0.42, 1.6)))
    front_suspension(body, 0.5, sleeve=True, spring=(0.06, 3, 0.016), arm_r=0.034)
    rear_suspension(body)
    mirrors(body, 0.86, 1.0, 0.4, (0.64, 0.84, 0.42), 1.2)
    column_and_dash(body, 0.56)
    return body


STEER_AT = (0.0, 1.04, 0.24)


# ── Blender objects and the export ──────────────────────────────────────────

PBR = {
    # name: (base colour sRGB hex, metallic, roughness, coat, emissive hex, emissive strength)
    "paint": ("#ffffff", 0.32, 0.30, 1.0, None, 0),
    "trim": ("#f4f5f8", 0.05, 0.34, 1.0, None, 0),
    "stripe": ("#f8f9fc", 0.05, 0.34, 1.0, None, 0),
    "livery": ("#ffffff", 0.05, 0.34, 1.0, None, 0),
    "chrome": ("#f4f6ff", 1.0, 0.10, 0.0, None, 0),
    "rim": ("#f4f6ff", 1.0, 0.12, 0.0, None, 0),
    "steel": ("#8d919c", 0.9, 0.34, 0.0, None, 0),
    "rubber": ("#16171b", 0.0, 0.86, 0.0, None, 0),
    "tread": ("#33343b", 0.0, 0.88, 0.0, None, 0),
    "plastic": ("#202128", 0.02, 0.50, 0.55, None, 0),
    "seat": ("#6b6e78", 0.0, 0.70, 0.2, None, 0),
    "lamp": ("#fff3d6", 0.0, 0.30, 0.5, "#fff0cc", 2.0),
    "tail": ("#ff2418", 0.0, 0.30, 0.5, "#ff3a2a", 3.0),
    "glass": ("#b6d2ff", 0.55, 0.05, 1.0, None, 0),
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def make_materials():
    mats = []
    for name in MAT_NAMES:
        base, metal, rough, coat, emit, strength = PBR[name]
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = hex_lin(base)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
        if emit:
            bsdf.inputs["Emission Color"].default_value = hex_lin(emit)
            bsdf.inputs["Emission Strength"].default_value = strength
        mats.append(mat)
    return mats


def make_object(name, m, mats, ao):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(p) for p in m.v], [], m.f)
    for mat in mats:
        mesh.materials.append(mat)
    mesh.polygons.foreach_set("material_index", m.m)
    mesh.polygons.foreach_set("use_smooth", m.s)
    mesh.validate(verbose=False)
    mesh.update()
    attr = mesh.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
    flat = []
    for a in ao:
        flat += [a, a, a, 1.0]
    attr.data.foreach_set("color", flat)
    mesh.color_attributes.active_color = attr
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new("normals", "WEIGHTED_NORMAL")
    mod.mode = "FACE_AREA"
    mod.weight = 50
    mod.keep_sharp = True
    return obj


def report(name, m):
    lo, hi = m.bounds()
    print("%-14s %6d tris %6d verts   x %+.2f..%+.2f  y %+.2f..%+.2f  z %+.2f..%+.2f" % (name, m.tris(), len(m.v), lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))




def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    steer = steering()
    st_ao = bake_ao(steer, [], samples=20, reach=0.15, floor=0.6)
    objs = {}
    wheels = {}
    for cls in ("middle", "light", "heavy"):
        use_profile(cls)
        sh = Shell(hull())
        body = {"middle": build_middle, "light": build_light, "heavy": build_heavy}[cls](sh)
        wh = wheel(cls)
        wheels[cls] = wh
        report("body." + cls, body)
        report("wheel." + cls, wh)
        # Occluders for the body's ambient occlusion: the four wheels where they will stand.
        occ = []
        for (hx, hy, hz), k in ((REAR, 1.0), (FRONT, FRONT_SCALE)):
            for sx in (-1, 1):
                w = M().add(wh)
                w.xf(RY(0 if sx > 0 else math.pi)).xf(Matrix.Diagonal((k, k, k, 1.0))).xf(T(sx * hx, hy, hz))
                occ.append(w)
        ao_body = bake_ao(body, occ)
        ao_wheel = bake_ao(wh, [], samples=26, reach=0.3, floor=0.45)
        suffix = "" if cls == "middle" else "." + cls
        objs["body" + suffix] = make_object("kart.body" + suffix, body, mats, ao_body)
        make_object("kart.wheel" + suffix, wh, mats, ao_wheel)
        # The liveries: decals on this tub, one node a pattern, lit like the body under them.
        near = BVHTree.FromPolygons([Vector(p) for p in body.v], [tuple(f) for f in body.f], epsilon=1e-6)
        for pat in LIVERIES:
            lv = livery(sh, cls, pat)
            if not lv.f:
                print("WARNING: livery %s on %s is empty" % (pat, cls))
                continue
            ao = []
            for p in lv.v:
                hit = near.find_nearest(Vector(p))
                poly = body.f[hit[2]]
                best = min(poly, key=lambda i: (Vector(body.v[i]) - Vector(p)).length)
                ao.append(ao_body[best])
            make_object("kart.livery.%s.%s" % (cls, pat), lv, mats, ao)
            report("livery.%s.%s" % (cls, pat), lv)
    # The middle kart is also named for its class (the same mesh).
    alias = bpy.data.objects.new("kart.body.middle", objs["body"].data)
    bpy.context.scene.collection.objects.link(alias)
    make_object("kart.steering", steer, mats, st_ao)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_normals=True,
        export_texcoords=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=12,
        export_draco_color_quantization=10,
    )
    print("wrote %s (%d bytes) in %.1fs" % (OUT, os.path.getsize(OUT), time.time() - t0))


if __name__ == "__main__":
    main()
