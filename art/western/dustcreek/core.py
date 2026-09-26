"""Shared plumbing for the Dust Creek build: seeded randomness, collections,
custom properties, and a MeshBuilder that assembles many boards/boxes into one
object.

Why a builder instead of bpy.ops primitives: a western facade is hundreds of
individual planks. Creating each as its own object would make Blender crawl
and the glTF bloated; building them as raw vertex/face lists and emitting one
object per (part, material set) is fast, deterministic and keeps per-plank
identity in a face attribute ("rand") the shaders use for variation.

Coordinates are Blender's (Z up). The player stands at the origin looking down
+Y (which the glTF exporter turns into -Z, as the asset contract wants).
"""

import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

# One seed for the whole town: the build is reproducible bit for bit.
SEED = 1873
_rng = random.Random(SEED)


def rng(tag=None):
    """A child random stream. Tagged streams stay stable when unrelated parts
    of the town gain or lose random calls, so tweaking the saloon does not
    reshuffle every plank of the bank."""
    if tag is None:
        return _rng
    return random.Random(f"{SEED}:{tag}")


# ---------------------------------------------------------------------------
# Scene / collections

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "DustCreek"
    scene.unit_settings.system = 'METRIC'
    return scene


def collection(name, parent=None):
    """Get or create a collection linked under parent (default: scene root)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def tag(obj, **props):
    """Custom properties. The glTF exporter writes object props as node extras,
    which is how `surface`, `kind`, `emerge`... reach the game."""
    for k, v in props.items():
        obj[k] = v
    return obj


def empty(name, loc, col, rot=None, size=0.25, display='PLAIN_AXES', **props):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = display
    ob.empty_display_size = size
    ob.location = loc
    if rot is not None:
        if isinstance(rot, Matrix):
            ob.rotation_euler = rot.to_euler()
        else:
            ob.rotation_euler = rot
    col.objects.link(ob)
    tag(ob, **props)
    return ob


# ---------------------------------------------------------------------------
# Frames: building-local coordinates

class Frame:
    """A local coordinate frame (translation + rotation about Z + optional
    tilt). Buildings are authored in a frame where the facade lies in the
    XZ plane at y=0, facing -Y (toward the street), X runs along the frontage.
    """

    def __init__(self, origin=(0, 0, 0), rot_z=0.0, matrix=None):
        if matrix is not None:
            self.m = matrix.copy()
        else:
            self.m = Matrix.Translation(Vector(origin)) @ Matrix.Rotation(rot_z, 4, 'Z')

    def sub(self, offset=(0, 0, 0), rot_z=0.0, rot_x=0.0, rot_y=0.0):
        m = (self.m @ Matrix.Translation(Vector(offset)) @ Matrix.Rotation(rot_z, 4, 'Z')
             @ Matrix.Rotation(rot_y, 4, 'Y') @ Matrix.Rotation(rot_x, 4, 'X'))
        return Frame(matrix=m)

    def p(self, x, y=0.0, z=0.0):
        return self.m @ Vector((x, y, z))

    def d(self, x, y=0.0, z=0.0):
        return self.m.to_3x3() @ Vector((x, y, z))


WORLD = Frame()


# ---------------------------------------------------------------------------
# MeshBuilder

class MeshBuilder:
    """Accumulates quads/tris with per-face material slot, a per-face random
    value ("rand": one value per board so each plank weathers differently) and
    two UV maps:

    - "grain": metres, U along the wood grain / long axis, V across. Wood and
      metal shaders read it so grain runs along every board however it is
      oriented.
    - "local": U in metres along the board, V normalised 0..1 across the
      board (nails sit on V=0.5, paint peels from V near 0 and 1).
    """

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []      # tuples of vertex indices
        self.fmat = []       # material slot name per face
        self.frand = []      # float per face
        self.uv_grain = []   # per face: list of (u,v)
        self.uv_local = []
        self.slots = []

    def _slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return mat

    def add_face(self, pts, mat, rand=0.0, grain=None, local=None):
        base = len(self.verts)
        self.verts.extend(Vector(p) for p in pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        self.fmat.append(self._slot(mat))
        self.frand.append(rand)
        n = len(pts)
        self.uv_grain.append(grain if grain is not None else [(0.0, 0.0)] * n)
        self.uv_local.append(local if local is not None else [(0.0, 0.0)] * n)

    # -- boxes -------------------------------------------------------------
    def box(self, frame, cmin, cmax, mat, rand=None, grain_axis=None, skip=(),
            uv_offset=None, taper=None):
        """Axis-aligned box in `frame` from cmin to cmax.

        grain_axis: 0/1/2, the long axis by default. skip: face ids to omit
        ('-x','+x','-y','+y','-z','+z') — hidden faces cost triangles and
        texels, so builders drop the ones nobody can ever see.
        taper: optional (dx, dy) shrink of the +z face, for posts and legs.
        """
        if rand is None:
            rand = _rng.random()
        x0, y0, z0 = cmin
        x1, y1, z1 = cmax
        size = (x1 - x0, y1 - y0, z1 - z0)
        if grain_axis is None:
            grain_axis = max(range(3), key=lambda i: size[i])
        tx, ty = (taper or (0.0, 0.0))

        def P(ix, iy, iz):
            x = (x0, x1)[ix]
            y = (y0, y1)[iy]
            z = (z0, z1)[iz]
            if iz == 1 and (tx or ty):
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                x = cx + (x - cx) * (1 - tx)
                y = cy + (y - cy) * (1 - ty)
            return (x, y, z)

        faces = {
            '-x': [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
            '+x': [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
            '-y': [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
            '+y': [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
            '-z': [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
            '+z': [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
        }
        off = uv_offset if uv_offset is not None else (rand * 7.31, rand * 3.17)
        for fid, corners in faces.items():
            if fid in skip:
                continue
            local_pts = [P(*c) for c in corners]
            world_pts = [frame.p(*lp) for lp in local_pts]
            nax = 'xyz'.index(fid[1])
            # U along grain axis (or the next axis for end-grain faces)
            ua = grain_axis if grain_axis != nax else (grain_axis + 1) % 3
            va = 3 - nax - ua
            vmin = (x0, y0, z0)[va]
            vlen = max(size[va], 1e-6)
            g, l = [], []
            for lp in local_pts:
                u = lp[ua] + off[0]
                v = lp[va] + off[1]
                g.append((u, v))
                l.append((u, (lp[va] - vmin) / vlen))
            self.add_face(world_pts, mat, rand, g, l)

    def board(self, frame, a, b, width, thick, mat, up=(0, 0, 1), rand=None, skip=()):
        """A board from point a to point b (frame coords) of given width
        (along `up` projected perpendicular) and thickness."""
        a, b = Vector(a), Vector(b)
        axis = (b - a)
        length = axis.length
        xdir = axis.normalized()
        updir = Vector(up)
        zdir = (updir - xdir * updir.dot(xdir)).normalized()
        ydir = zdir.cross(xdir)
        m = Matrix.Identity(4)
        m.col[0][:3] = xdir
        m.col[1][:3] = ydir
        m.col[2][:3] = zdir
        m.col[3][:3] = a
        f = Frame(matrix=frame.m @ m)
        self.box(f, (0, -thick / 2, -width / 2), (length, thick / 2, width / 2), mat,
                 rand=rand, grain_axis=0, skip=skip)

    # -- cylinders ------------------------------------------------------------
    def cylinder(self, frame, center, radius, height, mat, segments=12, rand=None,
                 caps=(True, True), radius_top=None, axis='Z', profile=None):
        """Cylinder along frame Z (or 'X'/'Y'). profile: optional list of
        (t, radius_scale) for barrels/bottles (t from 0 to 1 along height)."""
        if rand is None:
            rand = _rng.random()
        rt = radius if radius_top is None else radius_top
        if profile is None:
            profile = [(0.0, 1.0), (1.0, rt / radius if radius else 1.0)]
        cx, cy, cz = center

        def to_frame(px, py, pz):
            if axis == 'Z':
                return (cx + px, cy + py, cz + pz)
            if axis == 'X':
                return (cx + pz, cy + px, cz + py)
            return (cx + px, cy + pz, cz + py)

        rings = []
        for t, s in profile:
            ring = []
            for i in range(segments):
                ang = 2 * math.pi * i / segments
                ring.append((math.cos(ang) * radius * s, math.sin(ang) * radius * s, t * height))
            rings.append(ring)
        circ = 2 * math.pi * radius
        for r in range(len(rings) - 1):
            for i in range(segments):
                j = (i + 1) % segments
                pts = [rings[r][i], rings[r][j], rings[r + 1][j], rings[r + 1][i]]
                wp = [frame.p(*to_frame(*p)) for p in pts]
                u0, u1 = i / segments * circ, (i + 1) / segments * circ
                t0, t1 = profile[r][0] * height, profile[r + 1][0] * height
                g = [(t0, u0), (t0, u1), (t1, u1), (t1, u0)]
                l = [(t0, i / segments), (t0, (i + 1) / segments), (t1, (i + 1) / segments), (t1, i / segments)]
                self.add_face(wp, mat, rand, g, l)
        if caps[0]:
            pts = [frame.p(*to_frame(*p)) for p in reversed(rings[0])]
            self.add_face(pts, mat, rand, [(p[0], p[1]) for p in reversed(rings[0])])
        if caps[1]:
            pts = [frame.p(*to_frame(*p)) for p in rings[-1]]
            self.add_face(pts, mat, rand, [(p[0], p[1]) for p in rings[-1]])

    def quad(self, frame, pts, mat, rand=None, uv=None):
        if rand is None:
            rand = _rng.random()
        wp = [frame.p(*p) for p in pts]
        if uv is None:
            # planar metres in the quad's own plane
            a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[-1])
            ex = (b - a).normalized()
            n = (b - a).cross(c - a).normalized()
            ey = n.cross(ex)
            uv = [((Vector(p) - a).dot(ex), (Vector(p) - a).dot(ey)) for p in pts]
        self.add_face(wp, mat, rand, uv, uv)

    def add_bmesh(self, frame, bm, mat, rand=None, uv_scale=1.0):
        """Append an existing bmesh (in frame coords). UVs: box-projected metres."""
        if rand is None:
            rand = _rng.random()
        for f in bm.faces:
            pts = [v.co.copy() for v in f.verts]
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            ua, va = [(1, 2), (0, 2), (0, 1)][ax]
            uv = [(p[ua] * uv_scale, p[va] * uv_scale) for p in pts]
            self.add_face([frame.p(*p) for p in pts], mat, rand, uv, uv)

    # -- output -------------------------------------------------------------
    def build(self, col, materials, **props):
        """Create the object. `materials` maps slot name -> bpy material."""
        if not self.faces:
            return None
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.validate(clean_customdata=False)
        for s in self.slots:
            me.materials.append(materials[s] if isinstance(materials, dict) else materials(s))
        idx = {s: i for i, s in enumerate(self.slots)}
        me.polygons.foreach_set("material_index", [idx[s] for s in self.fmat])
        attr = me.attributes.new("rand", 'FLOAT', 'FACE')
        attr.data.foreach_set("value", self.frand)
        for uvname, data in (("grain", self.uv_grain), ("local", self.uv_local)):
            uvl = me.uv_layers.new(name=uvname)
            flat = []
            for poly_uv in data:
                for uv in poly_uv:
                    flat.extend(uv)
            uvl.data.foreach_set("uv", flat)
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        col.objects.link(ob)
        tag(ob, **props)
        # flat shading reads as crisp carpentry; curved props opt into smooth
        return ob


def smooth(ob, angle=40):
    """Smooth-shade by angle (edges sharper than `angle` stay hard)."""
    me = ob.data
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(angle))
    except AttributeError:
        pass
    return ob


def bm_to_object(bm, name, col, mats=(), **props):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    tag(ob, **props)
    return ob


def facing_matrix(forward, up=(0, 0, 1)):
    """Rotation (3x3) whose local -Y points along `forward` and local +Z stays
    as close to `up` as possible.

    Why -Y: the glTF exporter maps Blender (x, y, z) to glTF (x, z, -y), so a
    node's Blender -Y axis becomes its glTF +Z axis — and characters face +Z in
    glTF. An empty built with this matrix therefore 'faces' `forward` in the
    game's convention.
    """
    y = -Vector(forward).normalized()
    upv = Vector(up)
    z = (upv - y * upv.dot(y))
    if z.length < 1e-6:
        z = Vector((0, 0, 1)) if abs(y.z) < 0.9 else Vector((1, 0, 0))
    z.normalize()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def axis_matrix(y_axis, up=(0, 0, 1)):
    """Rotation (3x3) whose local +Y points along `y_axis` (used for `sun`:
    Blender +Y becomes glTF -Z, the axis the contract says points along the
    sunlight)."""
    return facing_matrix(-Vector(y_axis), up)


def setup_gpu(scene=None):
    """Cycles on the Metal GPU (falls back to CPU if none). Headless builds
    share the machine with other jobs, so we only ever ask for the GPU."""
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for t in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                break
        except TypeError:
            continue
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    for sc in ([scene] if scene else bpy.data.scenes):
        sc.cycles.device = 'GPU'
