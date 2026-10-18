"""
The sunny meadow circuit the key art is shot on: a road (asphalt, red-and-white kerbs, painted lines) swept along a
spline, rolling hills and mowing stripes, the game's own trees, bushes, flowers and the windmill, puffy clouds, a sky
and a warm sun, and the glossy item boxes. Blender frame: z up, the scene's "north" is +y.
"""
import math

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

import kit
from kit import hexl, MEADOW

# ── Small numerics ──────────────────────────────────────────────────────────


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def catmull_rom(pts, per=60):
    """Centripetal-ish uniform Catmull-Rom through the points (open path), as dense samples."""
    P = np.asarray(pts, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t = np.linspace(0, 1, per, endpoint=False)[:, None]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2][None, :])
    return np.vstack(out)


# ── Materials ───────────────────────────────────────────────────────────────


def _mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m, nt, bsdf


def _uv(nt):
    return nt.nodes.new("ShaderNodeUVMap")


def _math(nt, op, a=None, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _mix(nt, a, b, fac):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    for sock, v in ((n.inputs["A"], a), (n.inputs["B"], b)):
        if isinstance(v, tuple):
            sock.default_value = (v[0], v[1], v[2], 1.0)
        else:
            nt.links.new(v, sock)
    if isinstance(fac, (int, float)):
        n.inputs["Factor"].default_value = fac
    else:
        nt.links.new(fac, n.inputs["Factor"])
    return n.outputs["Result"]


def _noise(nt, vec, scale, detail=2.0, rough=0.5, distort=0.0):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = distort
    if vec is not None:
        nt.links.new(vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def _sep(nt, vec):
    n = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(vec, n.inputs["Vector"])
    return n.outputs


def _comb(nt, x, y, z=0.0):
    n = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, v in enumerate((x, y, z)):
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs["Vector"]


def asphalt_material(road_len, width):
    m, nt, b = _mat("road.asphalt")
    uv = _uv(nt).outputs["UV"]
    xyz = _sep(nt, uv)
    u, v = xyz[0], xyz[1]
    # u in 0..1 across, v in metres along. Rubbered-in streaks along the road + a fine speckle.
    streak_vec = _comb(nt, _math(nt, "MULTIPLY", u, 14.0 * 2.5), _math(nt, "MULTIPLY", v, 0.07))
    streak = _noise(nt, streak_vec, 1.0, 4.0, 0.55)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    speck = _noise(nt, tc.outputs["Object"], 70.0, 1.0, 0.6)
    base = _mix(nt, hexl(MEADOW["road"])[:3], hexl("#5c626d")[:3], _math(nt, "MULTIPLY", streak, 1.15, clamp=True))
    base = _mix(nt, base, hexl(MEADOW["speckle"])[:3], _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", speck, 0.5), 0.9, clamp=True))
    # A darker driven line, a little off the middle and wide.
    line = _math(nt, "SUBTRACT", 1.0, _math(nt, "MULTIPLY", _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", u, 0.34)), 4.0), clamp=True)
    base = _mix(nt, base, hexl("#3a3f48")[:3], _math(nt, "MULTIPLY", line, 0.45))
    nt.links.new(base, b.inputs["Base Color"])
    kit._set(b, rough=0.72, spec=0.35)
    return m


def kerb_material(period=1.6):
    m, nt, b = _mat("road.kerb")
    uv = _uv(nt).outputs["UV"]
    v = _sep(nt, uv)[1]
    # alternate red / white every `period` metres
    k = _math(nt, "FLOORED_MODULO", _math(nt, "FLOOR", _math(nt, "DIVIDE", v, period)), 2.0)
    col = _mix(nt, hexl(MEADOW["kerb"][0])[:3], hexl(MEADOW["kerb"][1])[:3], k)
    nt.links.new(col, b.inputs["Base Color"])
    kit._set(b, rough=0.34, coat=0.6, coat_rough=0.08)
    return m


def paint_material(name, colour, rough=0.5, **kw):
    m, nt, b = _mat(name)
    kit._set(b, base=hexl(colour), rough=rough, **kw)
    return m


def grass_material():
    m, nt, b = _mat("ground.grass")
    d = nt.nodes.new("ShaderNodeAttribute")
    d.attribute_name = "dist"
    dist = d.outputs["Fac"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    obj = tc.outputs["Object"]
    # mowing stripes parallel to the road near it, every 4.5 m; they fade into patchwork fields far away
    stripe = _math(nt, "FLOORED_MODULO", _math(nt, "FLOOR", _math(nt, "DIVIDE", dist, 4.5)), 2.0)
    near = _mix(nt, hexl(MEADOW["verge"][0])[:3], hexl(MEADOW["verge"][1])[:3], stripe)
    fields = _noise(nt, obj, 0.012, 3.0, 0.5, 0.6)
    far_a = _mix(nt, hexl("#7bd24f")[:3], hexl("#58b83e")[:3], _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", fields, 0.35), 3.0, clamp=True))
    gold = _noise(nt, obj, 0.006, 2.0, 0.5, 0.2)
    far_b = _mix(nt, far_a, hexl("#b6d452")[:3], _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", gold, 0.55), 5.0, clamp=True))
    t_far = _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", _math(nt, "DIVIDE", dist, 70.0), 0.5), 1.0, clamp=True)
    col = _mix(nt, near, far_b, t_far)
    # fine variation so it is never a flat plastic
    fine = _noise(nt, obj, 1.3, 3.0, 0.6)
    col = _mix(nt, col, hexl("#4aa535")[:3], _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", fine, 0.45), 0.55, clamp=True))
    nt.links.new(col, b.inputs["Base Color"])
    kit._set(b, rough=0.78, sheen=0.2, sheen_rough=0.6)
    return m


def prop_material(name="scenery.lit", rough=0.72):
    return kit.vcol_material(name, rough=rough, sheen=0.25, sheen_rough=0.5)


# ── Sky and light ───────────────────────────────────────────────────────────


def make_sky(scene, sun_dir, zenith=MEADOW["sky_zenith"], mid=MEADOW["sky_mid"], horizon=MEADOW["sky_horizon"],
             strength=1.0, fog_density=0.0016, fog_colour="#dcebff", sun_energy=4.2, sun_angle=0.045, sun_colour="#fff1d2"):
    """A gradient sky in the game's own colours, a sun lamp, and a thin haze that pales the distance."""
    w = bpy.data.worlds.new("sky")
    scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    z = _sep(nt, tc.outputs["Generated"])[2]
    # elevation 0 (horizon) .. 1 (zenith), mapped through a ramp
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    el = ramp.color_ramp.elements
    el[0].position = 0.0
    el[0].color = hexl(horizon)
    el[1].position = 1.0
    el[1].color = hexl(zenith)
    e1 = el.new(0.16)
    e1.color = hexl(mid)
    e2 = el.new(0.5)
    e2.color = hexl(mix_hex(mid, zenith, 0.5))
    nt.links.new(_math(nt, "ABSOLUTE", z), ramp.inputs["Fac"])
    # below the horizon: the haze colour (it is only ever seen in reflections)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    if fog_density > 0:
        vs = nt.nodes.new("ShaderNodeVolumeScatter")
        vs.inputs["Color"].default_value = hexl(fog_colour)
        vs.inputs["Density"].default_value = fog_density
        vs.inputs["Anisotropy"].default_value = 0.35
        nt.links.new(vs.outputs["Volume"], out.inputs["Volume"])
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = sun_energy
    sun.angle = sun_angle
    sun.color = hexl(sun_colour)[:3]
    so = bpy.data.objects.new("sun", sun)
    scene.collection.objects.link(so)
    d = Vector(sun_dir).normalized()  # direction TOWARD the sun
    so.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return so


def mix_hex(a, b, t):
    ca, cb = hexl(a), hexl(b)
    lin = [ca[i] + (cb[i] - ca[i]) * t for i in range(3)]

    def l2s(c):
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    return "#" + "".join(f"{int(round(max(0, min(1, l2s(c))) * 255)):02x}" for c in lin)


def sun_disc(scene, sun_dir, distance=3000.0, radius_deg=2.4, colour="#fff6dc", strength=60.0, glow_strength=3.0):
    """A visible sun: an emissive disc facing the camera plus a wide soft glow disc behind it."""
    d = Vector(sun_dir).normalized()
    for name, rad, k in (("sun.disc", radius_deg, strength), ("sun.glow", radius_deg * 5.0, glow_strength)):
        bpy.ops.mesh.primitive_circle_add(vertices=64, radius=math.tan(math.radians(rad)) * distance, fill_type="NGON")
        o = bpy.context.object
        o.name = name
        o.location = d * distance * (1.0 if name == "sun.disc" else 1.02)
        o.rotation_euler = (-d).to_track_quat("Z", "Y").to_euler()
        m, nt, b = _mat(name)
        if name == "sun.disc":
            kit._set(b, base=hexl(colour), emit=hexl(colour), emit_k=k)
        else:
            # radial falloff glow, transparent at the rim
            tc = nt.nodes.new("ShaderNodeTexCoord")
            sep = _sep(nt, tc.outputs["Generated"])
            r2 = nt.nodes.new("ShaderNodeVectorMath")
            r2.operation = "LENGTH"
            vec = _comb(nt, _math(nt, "SUBTRACT", sep[0], 0.5), _math(nt, "SUBTRACT", sep[1], 0.5))
            nt.links.new(vec, r2.inputs[0])
            rr = _math(nt, "MULTIPLY", r2.outputs["Value"], 2.0, clamp=True)
            fall = _math(nt, "POWER", _math(nt, "SUBTRACT", 1.0, rr, clamp=True), 2.6)
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = hexl("#ffe6b0")
            em.inputs["Strength"].default_value = k
            mixs = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(fall, mixs.inputs["Fac"])
            nt.links.new(tr.outputs["BSDF"], mixs.inputs[1])
            nt.links.new(em.outputs["Emission"], mixs.inputs[2])
            out = nt.nodes["Material Output"]
            nt.links.new(mixs.outputs["Shader"], out.inputs["Surface"])
        o.data.materials.append(m)
        o.visible_shadow = False
        o.visible_glossy = False
        o.visible_diffuse = False
        o.visible_transmission = False


def add_haze(density=0.0011, colour="#d3ebff", strength=1.0, skip=("sun.", "cloud", "sky", "skid", "smoke")):
    """Atmospheric perspective: every surface fades toward the horizon colour with its distance from the camera
    (1 - exp(-density * metres)). A shader-side haze instead of a world volume: cheap, and exactly the sky's horizon colour."""
    for mat in list(bpy.data.materials):
        if not mat.use_nodes or mat.name.startswith(skip):
            continue
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if out is None:
            continue
        link = next((l for l in nt.links if l.to_node is out and l.to_socket.name == "Surface"), None)
        if link is None:
            continue
        src = link.from_socket
        tc = nt.nodes.new("ShaderNodeTexCoord")
        ln = nt.nodes.new("ShaderNodeVectorMath")
        ln.operation = "LENGTH"
        nt.links.new(tc.outputs["Camera"], ln.inputs[0])
        k = _math(nt, "MULTIPLY", ln.outputs["Value"], -density)
        fac = _math(nt, "SUBTRACT", 1.0, _math(nt, "EXPONENT", k), clamp=True)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = hexl(colour)
        em.inputs["Strength"].default_value = strength
        mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fac, mx.inputs["Fac"])
        nt.links.new(src, mx.inputs[1])
        nt.links.new(em.outputs["Emission"], mx.inputs[2])
        nt.links.remove(link)
        nt.links.new(mx.outputs["Shader"], out.inputs["Surface"])


# ── The road ────────────────────────────────────────────────────────────────


class Road:
    """A road swept along a spline. Lateral offset `u` is positive to the LEFT of the direction of travel."""

    def __init__(self, pts, width=14.0, kerb=1.5, bank_gain=60.0, max_bank=0.11):
        c = catmull_rom(pts, 80)
        seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        n = int(s[-1])
        ss = np.linspace(0, s[-1], n + 1)
        self.c = np.stack([np.interp(ss, s, c[:, i]) for i in range(3)], axis=1)
        self.s = ss
        self.width = width
        self.kerb = kerb
        t = np.gradient(self.c[:, :2], axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        self.t = t
        self.n = np.stack([-t[:, 1], t[:, 0]], axis=1)  # left
        cross = np.gradient(np.arctan2(t[:, 1], t[:, 0]))
        cross = (cross + np.pi) % (2 * np.pi) - np.pi
        self.curv = cross  # per metre (samples are 1 m apart), + = turning left
        k = np.convolve(self.curv, np.ones(21) / 21, mode="same")
        self.bank = np.clip(k * bank_gain, -max_bank, max_bank)
        self.bank = np.convolve(self.bank, np.ones(15) / 15, mode="same")

    def __len__(self):
        return len(self.s)

    def sample(self, s):
        """(position xyz centre, tangent xy, left-normal xy, bank slope) at arc length s (metres)."""
        s = float(np.clip(s, 0, self.s[-1]))
        i = min(int(s), len(self.s) - 2)
        f = s - i
        c = self.c[i] * (1 - f) + self.c[i + 1] * f
        t = self.t[i] * (1 - f) + self.t[i + 1] * f
        t = t / np.linalg.norm(t)
        n = np.array([-t[1], t[0]])
        b = self.bank[i] * (1 - f) + self.bank[i + 1] * f
        return c, t, n, b

    def point(self, s, u, lift=0.0):
        """World point (Blender) at arc length s and lateral offset u (left +), on the banked surface, `lift` above it."""
        c, t, n, b = self.sample(s)
        x, y = c[0] + n[0] * u, c[1] + n[1] * u
        z = c[2] - u * b + lift
        return Vector((x, y, z))

    def nearest(self, x, y, chunk=20000):
        """For arrays of points: index of the nearest centre sample, the distance to it, and the signed lateral offset."""
        x = np.asarray(x).ravel()
        y = np.asarray(y).ravel()
        idx = np.empty(len(x), int)
        dist = np.empty(len(x))
        cx, cy = self.c[:, 0], self.c[:, 1]
        for a in range(0, len(x), chunk):
            xs, ys = x[a:a + chunk, None], y[a:a + chunk, None]
            d2 = (xs - cx[None, :]) ** 2 + (ys - cy[None, :]) ** 2
            j = d2.argmin(axis=1)
            idx[a:a + chunk] = j
            dist[a:a + chunk] = np.sqrt(d2[np.arange(len(j)), j])
        u = (x - cx[idx]) * self.n[idx, 0] + (y - cy[idx]) * self.n[idx, 1]
        return idx, dist, u

    # ── meshes ──

    def _strip(self, name, stations, material, uv_fn=None, smooth=True, s0=0, s1=None, step=1):
        """A ribbon: `stations` is a list of (lateral offset, height above the banked surface); ribbons run along s."""
        s1 = len(self.s) if s1 is None else s1
        idxs = np.arange(s0, s1, step)
        M = len(stations)
        verts = []
        uvs = []
        for i in idxs:
            c, n, b = self.c[i], self.n[i], self.bank[i]
            for j, (u, h) in enumerate(stations):
                verts.append((c[0] + n[0] * u, c[1] + n[1] * u, c[2] - u * b + h))
                uvs.append(((u - stations[0][0]) / (stations[-1][0] - stations[0][0]), self.s[i]))
        faces = []
        for a in range(len(idxs) - 1):
            for j in range(M - 1):
                p = a * M + j
                faces.append((p, p + M, p + M + 1, p + 1))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        uvl = mesh.uv_layers.new(name="UV")
        vi = np.empty(len(mesh.loops), int)
        mesh.loops.foreach_get("vertex_index", vi)
        uvl.data.foreach_set("uv", np.asarray(uvs, float)[vi].ravel())
        mesh.polygons.foreach_set("use_smooth", [smooth] * len(mesh.polygons))
        o = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(material)
        return o

    def build(self, s0=0, s1=None):
        w, k = self.width, self.kerb
        out = []
        stations = [(-w / 2 + w * i / 6, 0.0) for i in range(7)]
        out.append(self._strip("road.asphalt", stations, asphalt_material(self.s[-1], w), s0=s0, s1=s1))
        km = kerb_material()
        for side in (1, -1):
            sg = side
            prof = [(sg * w / 2, 0.0), (sg * (w / 2 + 0.12), 0.075), (sg * (w / 2 + k - 0.14), 0.075), (sg * (w / 2 + k), 0.0)]
            if sg < 0:
                prof = prof[::-1]
            out.append(self._strip(f"road.kerb.{'L' if sg > 0 else 'R'}", prof, km, smooth=False, s0=s0, s1=s1))
        lm = paint_material("road.line", MEADOW["line"], rough=0.55, coat=0.1)
        for side in (1, -1):
            a, b = side * (w / 2 - 0.85), side * (w / 2 - 0.5)
            st = [(min(a, b), 0.014), (max(a, b), 0.014)]
            out.append(self._strip(f"road.edge.{'L' if side > 0 else 'R'}", st, lm, s0=s0, s1=s1))
        return out

    def dashes(self, material, length=3.0, gap=4.5, width=0.28, u=0.0, s0=0, s1=None):
        s1 = len(self.s) if s1 is None else s1
        verts, faces = [], []
        s = float(s0)
        while s + length < s1 - 1:
            for i, (ss, uu) in enumerate(((s, -width / 2), (s, width / 2), (s + length, width / 2), (s + length, -width / 2))):
                p = self.point(ss, u + uu, 0.014)
                verts.append(tuple(p))
            n = len(verts)
            faces.append((n - 4, n - 3, n - 2, n - 1))
            s += length + gap
        mesh = bpy.data.meshes.new("road.dashes")
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        o = bpy.data.objects.new("road.dashes", mesh)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(material)
        return o


# ── Terrain ─────────────────────────────────────────────────────────────────


class Terrain:
    def __init__(self, road, hills, seed=3, noise_amp=1.0):
        self.road = road
        self.hills = hills  # (x, y, radius, height)
        rng = np.random.default_rng(seed)
        self.waves = [(rng.uniform(0, 2 * np.pi), rng.uniform(0, 2 * np.pi), rng.uniform(0, 2 * np.pi), wl, a * noise_amp)
                      for wl, a in ((140, 3.0), (70, 1.6), (33, 0.8), (17, 0.35))]

    def natural(self, x, y):
        h = np.zeros_like(x, dtype=float)
        for hx, hy, r, ht in self.hills:
            h += ht * np.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * r * r))
        for ph1, ph2, ph3, wl, a in self.waves:
            k = 2 * np.pi / wl
            h += a * (np.sin(x * k * 0.8 + ph1 + np.sin(y * k * 0.5 + ph3)) * np.cos(y * k + ph2) )
        return h

    def height(self, x, y):
        x = np.asarray(x, float)
        y = np.asarray(y, float)
        r = self.road
        idx, d, u = r.nearest(x, y)
        L = r.width / 2 + r.kerb + 0.6
        uu = np.clip(u, -L, L)
        zr = r.c[idx, 2] - uu * r.bank[idx] - 0.09
        m = 1.0 - smoothstep(L + 0.5, L + 16.0, d)
        nat = self.natural(x.ravel(), y.ravel()) * smoothstep(8.0, 95.0, d)
        # keep the natural ground from dropping below the road level right at the verge (no ditch)
        z = zr * m + nat * (1 - m)
        return z.reshape(x.shape), d.reshape(x.shape)

    def build(self, xr, yr, cell=2.0, far=3200.0, growth=1.12):
        """A grid that is `cell` fine over the box xr x yr (where the road and the action are) and grows coarser outward."""
        def axis(lo, hi):
            left, right = [lo], [hi]
            step = cell
            while left[-1] > -far:
                left.append(left[-1] - step)
                step *= growth
            step = cell
            while right[-1] < far:
                right.append(right[-1] + step)
                step *= growth
            mid = np.arange(lo, hi, cell)
            return np.concatenate([np.array(left[:0:-1]), mid, np.array(right)])

        xs, ys = axis(*xr), axis(*yr)
        X, Y = np.meshgrid(xs, ys)
        Z, D = self.height(X, Y)
        ny, nx = X.shape
        verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3)
        idx = np.arange(nx * ny).reshape(ny, nx)
        faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], axis=-1).reshape(-1, 4)
        mesh = bpy.data.meshes.new("terrain")
        mesh.from_pydata(verts.tolist(), [], faces.tolist())
        mesh.update()
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        at = mesh.attributes.new("dist", "FLOAT", "POINT")
        at.data.foreach_set("value", D.ravel())
        o = bpy.data.objects.new("terrain", mesh)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(grass_material())
        return o


# ── Scenery from the game's own meadow kit ──────────────────────────────────

_PROP_MAT = {}


def prop_mat():
    if "m" not in _PROP_MAT:
        _PROP_MAT["m"] = prop_material()
    return _PROP_MAT["m"]


def prop(name, loc, scale=1.0, yaw=0.0, collection=None, lift=0.0):
    """One of the game's meadow scenery meshes (scenery.tree.0, ...) standing at `loc` (its vertices are local to its node origin)."""
    src = kit.load_library()[name]
    m = prop_mat()
    o = kit.instance(src, name, {s: m for s in set(src["slots"])}, None, None, collection)
    o.matrix_basis = Matrix.Translation((loc[0], loc[1], loc[2] + lift)) @ kit.RZ(yaw) @ kit.S(scale)
    return o


def landmark(kind, loc, yaw=0.0, scale=1.0, spin=None):
    """A modelled landmark (windmill, barn, hot-air balloon) with its footprint centre at `loc`, facing as the game's +z does
    turned by `yaw`. `spin` = {node name: angle}: turns a `.spin.<axis>` node about its own axis (the game's axes)."""
    lib = kit.load_library()
    root = lib[f"landmark.{kind}"]
    mat = prop_mat()
    glow = kit.emissive_material("glow.lm", hexl("#ffb040"), 8.0)
    made = {}
    axes = {"x": Vector((1, 0, 0)), "y": Vector((0, 0, 1)), "z": Vector((0, -1, 0))}  # the game's axes in Blender's frame

    def walk(src, parent, parent_src):
        if src.type == "MESH":
            mats = {s: (glow if "glow" in src.name else mat) for s in set(src["slots"])}
            o = kit.instance(src, src.name, mats, parent, None)
        else:
            o = kit.empty(src.name, parent)
        made[src.name] = o
        wm = kit.lib_world(src.name)
        rel = wm if parent_src is None else kit.lib_world(parent_src.name).inverted() @ wm
        if parent_src is None:
            rel = Matrix.Identity(4)
        o.matrix_basis = rel
        if src.name in (spin or {}):
            ax = axes[src.name.rsplit(".", 1)[-1][0]]
            o.matrix_basis = rel @ Matrix.Rotation(spin[src.name], 4, ax)
        for ch in src.children:
            walk(ch, o, src)
        return o

    top = walk(root, None, None)
    top.matrix_basis = Matrix.Translation(loc) @ kit.RZ(yaw) @ kit.S(scale)
    return top


def scatter(road, terrain, rng, kinds, count, area, min_road=16.0, min_gap=6.0, scale=(1.0, 1.4), avoid=(), seed=0):
    """Trees/bushes/rocks dropped on the ground inside the (x0, y0, x1, y1) `area`, clear of the road and of each other."""
    x0, y0, x1, y1 = area
    placed = []
    tries = 0
    out = []
    while len(placed) < count and tries < count * 40:
        tries += 1
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        _, d, _u = road.nearest([x], [y])
        if d[0] < min_road:
            continue
        if any((x - px) ** 2 + (y - py) ** 2 < (min_gap * ps) ** 2 for px, py, ps in placed):
            continue
        if any((x - ax) ** 2 + (y - ay) ** 2 < ar * ar for ax, ay, ar in avoid):
            continue
        sc = rng.uniform(*scale)
        z = float(terrain.height(np.array([x]), np.array([y]))[0][0])
        kind = rng.choice(kinds)
        out.append(prop(kind, (x, y, z - 0.05), sc, rng.uniform(0, 2 * math.pi)))
        placed.append((x, y, sc))
    return out


# ── Clouds ──────────────────────────────────────────────────────────────────


def cloud_material(sun_dir):
    """Cartoon cumulus shading: warm white where the sun strikes it, cool blue-grey underneath, a little surface lumpiness."""
    m, nt, b = _mat("cloud")
    ng = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = tuple(sun_dir)
    nt.links.new(ng.outputs["Normal"], dot.inputs[0])
    lit = _math(nt, "MULTIPLY", _math(nt, "ADD", dot.outputs["Value"], 0.45), 0.9, clamp=True)
    up = _math(nt, "MULTIPLY", _math(nt, "ADD", _sep(nt, ng.outputs["Normal"])[2], 1.0), 0.5, clamp=True)
    shade = _mix(nt, hexl("#9fbbe8")[:3], hexl("#e9f1ff")[:3], up)
    col = _mix(nt, shade, hexl("#fffaf0")[:3], _math(nt, "POWER", lit, 0.8))
    tc = nt.nodes.new("ShaderNodeTexCoord")
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    nt.links.new(_noise(nt, tc.outputs["Object"], 0.35, 5.0, 0.55), bump.inputs["Height"])
    nt.links.new(col, b.inputs["Base Color"])
    nt.links.new(col, b.inputs["Emission Color"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    kit._set(b, rough=1.0, emit_k=0.85, spec=0.0)
    return m


def cloud(name, centre, size, rng, material, puffs=30, flat=0.55, spread=1.0):
    """A cartoon cumulus: a cluster of overlapping spheres (metaballs) in a rounded heap, flattish underneath."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = max(0.5, size / 36)
    mb.render_resolution = max(0.4, size / 52)
    mb.threshold = 0.5
    o = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material)
    for i in range(puffs):
        f = rng.uniform(-1, 1)                              # position along the cloud, -1..1
        x = f * size * 0.5 * spread
        envelope = 1.0 - f * f * 0.75                        # taller in the middle
        r = size * rng.uniform(0.07, 0.17) * (0.55 + 0.6 * envelope)
        y = rng.normal(0, size * 0.1)
        z = r * 0.55 + rng.uniform(0, 1) * size * 0.2 * envelope * (1.0 if i >= 8 else 0.12)
        e = mb.elements.new(type="BALL")
        e.co = (x, y, z)
        e.radius = r * 2.1
        e.stiffness = 2.2
    o.scale = (1.0, 0.9, flat + 0.35)
    o.location = centre
    return o


# ── Item boxes: the game's glassy rainbow cubes, with a bright question mark on every face ──


def rainbow_glass_material():
    m, nt, b = _mat("itembox.glass")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    s = _sep(nt, tc.outputs["Object"])
    h = _math(nt, "MULTIPLY", _math(nt, "ADD", _math(nt, "ADD", s[0], s[1]), _math(nt, "MULTIPLY", s[2], 0.7)), 0.6)
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    nt.links.new(_math(nt, "ADD", h, 0.55), hsv.inputs["Hue"])
    hsv.inputs["Saturation"].default_value = 1.0
    hsv.inputs["Value"].default_value = 1.0
    hsv.inputs["Color"].default_value = (0.95, 0.12, 0.12, 1.0)
    nt.links.new(hsv.outputs["Color"], b.inputs["Base Color"])
    kit._set(b, trans=0.55, rough=0.04, ior=1.3, coat=1.0, coat_rough=0.02, spec=1.0)
    nt.links.new(hsv.outputs["Color"], b.inputs["Emission Color"])
    kit._set(b, emit_k=0.45)
    return m


def question_material():
    """The bright white of a box's question mark: glowing on its front, clear from behind (so the far side's marks do not show through the glass)."""
    m = bpy.data.materials.new("itembox.q")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    glow = nt.nodes.new("ShaderNodeEmission")
    glow.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    glow.inputs["Strength"].default_value = 4.5
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(glow.outputs["Emission"], mix.inputs[1])
    nt.links.new(clear.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return m


def item_box(loc, yaw=0.0, size=1.6, tilt=(0.0, 0.0)):
    """Returns the root empty. The cube's edge is `size` (the game's BOX_SIZE 1.6): a glassy rainbow cube, a bright question mark
    on each side, a glow at its heart."""
    root = kit.empty("itembox", None, None, kind="CUBE", size=size / 2)
    root.matrix_basis = Matrix.Translation(loc) @ kit.RZ(yaw) @ kit.RX(tilt[0]) @ kit.RY(tilt[1])
    bpy.ops.mesh.primitive_cube_add(size=size)
    cube = bpy.context.object
    cube.name = "itembox.cube"
    bevel = cube.modifiers.new("bevel", "BEVEL")
    bevel.width = size * 0.15
    bevel.segments = 6
    bevel.limit_method = "NONE"
    sub = cube.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    cube.data.materials.append(rainbow_glass_material())
    for p in cube.data.polygons:
        p.use_smooth = True
    cube.parent = root
    core = bpy.data.objects.new("itembox.core", bpy.data.meshes.new("itembox.core"))
    bpy.context.scene.collection.objects.link(core)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=size * 0.06)
    bm.to_mesh(core.data)
    bm.free()
    core.data.materials.append(kit.emissive_material("itembox.core", hexl("#fff0c8"), 1.8))
    core.parent = root
    core.visible_shadow = False
    qm = question_material()
    for k in range(4):
        cu = bpy.data.curves.new("q", "FONT")
        cu.body = "?"
        cu.size = size * 0.66
        # A flat glyph, one sided: seen through the glass from the far side it is the back of a face's mark, and is left clear, so
        # each side shows one clean "?" the right way round (an extruded one showed its mirror image through the glass, overlapping).
        cu.extrude = 0.0
        cu.bevel_depth = 0.0
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        q = bpy.data.objects.new("itembox.q", cu)
        bpy.context.scene.collection.objects.link(q)
        q.data.materials.append(qm)
        q.parent = root
        q.matrix_basis = kit.RZ(k * math.pi / 2) @ Matrix.Translation((0, -size * 0.5 - size * 0.012, 0)) @ kit.RX(math.pi / 2)
        q.visible_shadow = False
    return root
