"""
The kit the Grip Prix key-art shots are built from: the real game models
(public/assets/kart/karts.glb, drivers.glb, world-meadow.glb) loaded into
Blender and assembled exactly as the game assembles them (src/kart/render/
kartArt.ts, kartSpec.ts, drivers/index.ts, drivers/fromArt.ts), their materials
rebuilt as Cycles shaders from the same material names, plus the Cycles set-up.

Everything about the game's frame lives here. The game is metres, y up, a kart
faces +z, its left is +x. Blender's glTF importer turns that into z up, a
kart faces -y, left is +x: (x, y, z)_game -> (x, -z, y)_blender. Transforms
are written in the game's frame and converted with `gm()`.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

# ── Where things are ────────────────────────────────────────────────────────


def _script_dir():
    f = globals().get("__file__")
    if f:
        return os.path.dirname(os.path.abspath(f))
    for i, a in enumerate(sys.argv):
        if a in ("-P", "--python") and i + 1 < len(sys.argv):
            return os.path.dirname(os.path.abspath(sys.argv[i + 1]))
    return os.path.abspath("art/kart/poster")


HERE = _script_dir()
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
ASSETS = os.environ.get("KART_ASSETS", os.path.join(ROOT, "public", "assets", "kart"))
BUILD = os.path.join(HERE, "build")  # git-ignored scratch (renders before encoding)

# ── The game's numbers (src/kart/render/kartSpec.ts, drivers/index.ts, contract.ts) ──

WHEEL_FRONT = (0.86, 0.36, 0.94)   # hub x (left), y, z
WHEEL_REAR = (0.95, 0.43, -0.84)
FRONT_SCALE = 0.36 / 0.43
DRIVER_AT = (0.0, 0.9, -0.28)
DRIVER_SCALE = 1.14
STEER_AT = (0.0, 1.04, 0.24)
STEER_TILT = -0.95
STEER_TURN = 1.5
WHEEL_GRIP = {"centre": (0.0, 0.12, 0.52), "tilt": -0.95, "grip": 0.15, "turn": 1.5}
ARM_LEN = 0.54
KART_EXHAUST = (0.3, 0.64, -1.5)   # right, y, forward

PLAYER_COLOURS = ["#FF453A", "#0A84FF", "#30D158", "#FFD60A"]
BOT_COLOURS = ["#FF9F0A", "#BF5AF2", "#64D2FF", "#FF375F"]

# The same meadow palette the game's world uses (src/kart/render/world/themes.ts)
MEADOW = {
    "road": "#4b5059", "speckle": "#6a707a", "line": "#f4f4ef",
    "verge": ("#79d255", "#6ac648"), "kerb": ("#ff3b30", "#fbfbf7"),
    "sky_zenith": "#2b78e4", "sky_mid": "#62aef5", "sky_horizon": "#d3ebff",
}

# ── Colour ──────────────────────────────────────────────────────────────────


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexl(h, a=1.0):
    h = h.lstrip("#")
    return (s2l(int(h[0:2], 16) / 255), s2l(int(h[2:4], 16) / 255), s2l(int(h[4:6], 16) / 255), a)


def mix3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ── The game frame -> Blender ───────────────────────────────────────────────

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


def gm(m):
    """A transform written in the game's frame, as the equivalent Blender matrix (for a Blender-frame mesh)."""
    return C @ m @ CI


def gp(p):
    """A game-frame point as a Blender point."""
    return Vector((p[0], -p[2], p[1]))


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RX(a):
    return Matrix.Rotation(a, 4, "X")


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


def S(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))


def look_rot(frm, to, roll=0.0):
    """Rotation (a Blender-frame Matrix) for a camera at `frm` looking at `to`, turned by `roll` about its view axis."""
    d = (Vector(to) - Vector(frm)).normalized()
    q = d.to_track_quat("-Z", "Y")
    m = q.to_matrix().to_4x4()
    if roll:
        m = m @ RZ(roll)
    return m


# ── Cycles ──────────────────────────────────────────────────────────────────


def setup_cycles(scene, w, h, samples, exposure=0.0, look="", transform="Khronos PBR Neutral", seed=7):
    transform = os.environ.get("VIEW", transform)
    look = os.environ.get("LOOK", look)
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != "CPU"
        scene.cycles.device = "GPU"
    except Exception as e:  # CPU is fine, just slow
        print("cycles: no GPU:", e)
    cy = scene.cycles
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    try:
        cy.denoising_use_gpu = True
    except Exception:
        pass
    cy.max_bounces = 6
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 4
    cy.transmission_bounces = 6
    cy.transparent_max_bounces = 12
    cy.volume_bounces = 0
    cy.seed = seed
    cy.sample_clamp_indirect = 8.0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 1.0
    vs = scene.view_settings
    vs.view_transform = transform
    if look:
        try:
            vs.look = look
        except Exception as e:
            print("look:", e)
    vs.exposure = exposure


# ── Materials ───────────────────────────────────────────────────────────────


def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    out.location = (600, 0)
    bsdf.location = (300, 0)
    return nt, bsdf


def _set(bsdf, **kw):
    names = {
        "base": "Base Color", "metal": "Metallic", "rough": "Roughness", "coat": "Coat Weight",
        "coat_rough": "Coat Roughness", "emit": "Emission Color", "emit_k": "Emission Strength",
        "sheen": "Sheen Weight", "sheen_rough": "Sheen Roughness", "spec": "Specular IOR Level", "ior": "IOR",
        "trans": "Transmission Weight", "alpha": "Alpha", "sss": "Subsurface Weight", "sss_scale": "Subsurface Scale",
        "sss_radius": "Subsurface Radius", "sss_col": "Subsurface Color",
    }
    for k, v in kw.items():
        sock = bsdf.inputs.get(names.get(k, k))
        if sock is None:
            print("no socket", k)
            continue
        sock.default_value = v


def attr_node(nt, name="Color"):
    n = nt.nodes.new("ShaderNodeAttribute")
    n.attribute_name = name
    n.attribute_type = "GEOMETRY"
    n.location = (-600, 0)
    return n


def vcol_material(name, base=(1, 1, 1), tint=None, **pbr):
    """Base colour = the mesh's vertex colour (the baked ambient occlusion or the art's own colour) x `base`."""
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    a = attr_node(nt)
    col = a.outputs["Color"]
    if tuple(base[:3]) != (1, 1, 1):
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs["Factor"].default_value = 1.0
        mx.inputs["B"].default_value = (base[0], base[1], base[2], 1.0)
        nt.links.new(col, mx.inputs["A"])
        col = mx.outputs["Result"]
    nt.links.new(col, bsdf.inputs["Base Color"])
    _set(bsdf, **pbr)
    return mat


def emissive_material(name, colour, strength, base=None, **pbr):
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    _set(bsdf, base=base or colour, emit=colour, emit_k=strength, **pbr)
    return mat


def kart_materials(accent_hex, golden=False):
    """The kart's glTF materials by name (art/kart/karts/build.py PBR table), with the racer's colour in "paint" and "seat"."""
    acc = hexl(accent_hex)
    table = {
        # name: (base, metallic, roughness, coat)
        "paint": (acc, 0.32, 0.30, 1.0),
        "trim": (hexl("#f4f5f8"), 0.05, 0.34, 1.0),
        "stripe": (hexl("#f8f9fc"), 0.05, 0.34, 1.0),
        "chrome": (hexl("#f4f6ff"), 1.0, 0.10, 0.0),
        "rim": (hexl("#f4f6ff"), 1.0, 0.12, 0.0),
        "steel": (hexl("#8d919c"), 0.9, 0.34, 0.0),
        "rubber": (hexl("#16171b"), 0.0, 0.86, 0.0),
        "tread": (hexl("#33343b"), 0.0, 0.88, 0.0),
        "plastic": (hexl("#202128"), 0.02, 0.50, 0.55),
        "seat": (mix3(acc, hexl("#6b6e78"), 0.0), 0.0, 0.70, 0.2),
        "glass": (hexl("#b6d2ff"), 0.55, 0.05, 1.0),
    }
    out = {}
    for name, (base, metal, rough, coat) in table.items():
        out[name] = vcol_material(f"kart.{name}.{accent_hex}", base=base, metal=metal, rough=rough, coat=coat, coat_rough=0.05)
    out["lamp"] = emissive_material("kart.lamp", hexl("#fff0cc"), 3.0, base=hexl("#fff3d6"), rough=0.3)
    out["tail"] = emissive_material("kart.tail", hexl("#ff3a2a"), 4.0, base=hexl("#ff2418"), rough=0.3)
    return out


def driver_materials(accent_hex):
    """The driver's glTF materials (art/kart/drivers/rig.py): vertex colour is the colour, except the kart-painted ones."""
    kart = hexl(accent_hex)[:3]
    white = hexl("#f6f7fa")[:3]
    top = mix3(kart, (1, 1, 1), 0.14)
    low = tuple(c * 0.64 for c in kart)
    vest = mix3(white, kart, 0.12)
    out = {}
    plain = {
        "fur": (0.0, 0.82, {"sheen": 0.35, "sheen_rough": 0.5}),
        "cloth": (0.0, 0.70, {}),
        "trim": (0.05, 0.34, {"coat": 0.6}),
        "plastic": (0.02, 0.50, {"coat": 0.4}),
        "steel": (0.9, 0.34, {}),
        "gloss": (0.0, 0.06, {"coat": 1.0, "coat_rough": 0.02, "spec": 1.0}),
        "glass": (0.55, 0.05, {}),
    }
    for name, (metal, rough, extra) in plain.items():
        out[name] = vcol_material(f"drv.{name}", metal=metal, rough=rough, **extra)
    for name, k in (("lamp", 2.1), ("glow", 6.0)):
        mat = bpy.data.materials.new(f"drv.{name}")
        nt, bsdf = _nodes(mat)
        a = attr_node(nt)
        nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(a.outputs["Color"], bsdf.inputs["Emission Color"])
        _set(bsdf, emit_k=k * 0.5, rough=0.3)
        out[name] = mat

    def painted(name, metal, rough, coat, lo, hi):
        mat = bpy.data.materials.new(f"drv.{name}.{accent_hex}")
        nt, bsdf = _nodes(mat)
        a = attr_node(nt)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(a.outputs["Color"], sep.inputs["Color"])
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.inputs["A"].default_value = (lo[0], lo[1], lo[2], 1.0)
        mx.inputs["B"].default_value = (hi[0], hi[1], hi[2], 1.0)
        nt.links.new(sep.outputs["Red"], mx.inputs["Factor"])
        nt.links.new(mx.outputs["Result"], bsdf.inputs["Base Color"])
        _set(bsdf, metal=metal, rough=rough, coat=coat, coat_rough=0.05)
        return mat

    out["paint"] = painted("paint", 0.32, 0.30, 1.0, low, top)
    out["paintcloth"] = painted("paintcloth", 0.0, 0.70, 0.0, low, top)
    vest_lo = tuple(c * 0.55 for c in vest)
    out["vest"] = painted("vest", 0.0, 0.70, 0.0, vest_lo, vest)
    return out


# ── The library: the game's models, loaded once ─────────────────────────────

_lib = {"loaded": False}


def _strip(name):
    return name.split(".")[0] if name[-4:-3] != "." else name[:-4]


def _base_name(mat_name):
    """glTF material names come back from the importer as "paint", "paint.001"..."""
    n = mat_name
    if len(n) > 4 and n[-4] == "." and n[-3:].isdigit():
        n = n[:-4]
    return n


def load_library():
    """Imports the three glbs into a hidden collection; returns {glTF node name: object}."""
    if _lib["loaded"]:
        return _lib["objs"]
    coll = bpy.data.collections.new("library")
    bpy.context.scene.collection.children.link(coll)
    objs = {}
    wm = {}
    for fname in ("karts.glb", "drivers.glb", "world-meadow.glb"):
        before = set(bpy.data.objects.keys())
        bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, fname))
        bpy.context.view_layer.update()
        for o in list(bpy.data.objects):
            if o.name in before:
                continue
            wm[o.name] = o.matrix_world.copy()
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
            o.hide_render = True
            o.hide_viewport = True
            objs[o.name] = o
    # The import leaves the objects' own materials: remember which glTF material sits in each slot.
    for o in objs.values():
        if o.type == "MESH":
            o["slots"] = [_base_name(m.name) if m else "" for m in o.data.materials]
    _lib["loaded"] = True
    _lib["objs"] = objs
    _lib["wm"] = wm
    return objs


def lib_world(name):
    """The library node's world matrix as it was imported (Blender frame)."""
    load_library()
    return _lib["wm"][name]


def instance(src, name, mats, parent=None, matrix=None, collection=None):
    """A linked duplicate of a library mesh whose slots take `mats` by the glTF material names; mats is {name: Material}."""
    o = bpy.data.objects.new(name, src.data)
    (collection or bpy.context.scene.collection).objects.link(o)
    slots = list(src["slots"])
    for i, sl in enumerate(o.material_slots):
        sl.link = "OBJECT"
        m = mats.get(slots[i])
        if m is None:
            raise KeyError(f"{src.name}: no material for {slots[i]!r}")
        sl.material = m
    if parent is not None:
        o.parent = parent
    if matrix is not None:
        o.matrix_basis = matrix
    return o


def empty(name, parent=None, matrix=None, collection=None, kind="PLAIN_AXES", size=0.1):
    o = bpy.data.objects.new(name, None)
    o.empty_display_type = kind
    o.empty_display_size = size
    (collection or bpy.context.scene.collection).objects.link(o)
    if parent is not None:
        o.parent = parent
    if matrix is not None:
        o.matrix_basis = matrix
    return o


# ── The kart, assembled as the game assembles it ────────────────────────────

SPECIES = {"bun": "rabbit", "pepper": "penguin", "moss": "frog", "kit": "fox", "juniper": "otter", "mango": "cat",
           "bramble": "bear", "rivet": "robot", "dabble": "duck"}
BITS = {"rabbit": ["tail"], "penguin": ["scarf"], "frog": ["sac"], "fox": ["tail"], "otter": ["scarf", "tail"],
        "cat": ["tail"], "bear": [], "robot": ["bulb"], "duck": ["tail"]}


def arm_matrix(side, shoulder, steer, lean_roll=0.0):
    """The game's arm pose (Driver.update): the arm group turns +z onto the line shoulder -> the hand on the wheel and
    stretches to reach it. `side` +1 is the driver's left (+x). Returns the arm's game-frame matrix (root-local)."""
    g = WHEEL_GRIP
    a = 0.2 if side > 0 else math.pi - 0.2
    m = RX(g["tilt"]) @ RZ(-steer * g["turn"])
    p = m @ Vector((math.cos(a) * g["grip"], math.sin(a) * g["grip"], 0.0))
    p = Vector((p.x + g["centre"][0], p.y + g["centre"][1], p.z + g["centre"][2]))
    if lean_roll:
        p = RZ(-lean_roll) @ p
    hand = p / DRIVER_SCALE - Vector(shoulder)
    length = hand.length
    q = Vector((0, 0, 1)).rotation_difference(hand.normalized())
    sz = min(1.35, max(0.7, length / ARM_LEN))
    return T(*shoulder) @ q.to_matrix().to_4x4() @ S(1, 1, sz)


def build_kart(name, racer_colour, character="mango", pose=None, collection=None, golden=False):
    """The kart with its driver as a hierarchy: returns (root, parts). `root`'s frame is the kart's own (front -y in Blender).
    pose: steer, lean (driver's lean), roll, pitch, slide (body yaw), hop, spin (wheel angle), flame."""
    lib = load_library()
    pose = dict(pose or {})
    steer = pose.get("steer", 0.0)
    lean = pose.get("lean", 0.0)
    roll = pose.get("roll", 0.0)
    pitch = pose.get("pitch", 0.0)
    slide = pose.get("slide", 0.0)
    hop = pose.get("hop", 0.0)
    spin = pose.get("spin", 0.0)
    species = SPECIES[character]
    km = kart_materials(racer_colour, golden)
    dm = driver_materials(racer_colour)
    root = empty(f"{name}", collection=collection, size=0.5)
    parts = {"root": root}

    # The body group: pitch, slide (yaw) and roll in three.js' YXZ order, hopping a little.
    body_g = T(0, hop, 0) @ RY(slide) @ RX(-pitch) @ RZ(roll)
    body = empty(f"{name}.body", root, gm(body_g), collection)
    parts["body"] = body
    instance(lib["kart.body"], f"{name}.tub", km, body, None, collection)
    # Steering wheel: a ring in xy, tilted, turned under the hands.
    steer_g = T(*STEER_AT) @ RX(STEER_TILT) @ RZ(-steer * STEER_TURN)
    instance(lib["kart.steering"], f"{name}.steering", km, body, gm(steer_g), collection)

    # The driver.
    d_g = T(*DRIVER_AT) @ RZ(lean) @ S(DRIVER_SCALE)
    droot = empty(f"{name}.driver", body, gm(d_g), collection)
    parts["driver"] = droot
    pre = f"driver.{species}."
    instance(lib[pre + "torso"], f"{name}.torso", dm, droot, None, collection)
    head_at = lib[pre + "head"].location.copy()  # Blender frame already
    head_g = Matrix.Identity(4)
    head_g = RY(pose.get("head_yaw", -steer * 0.4)) @ RX(pose.get("head_pitch", 0.0)) @ RZ(-lean * 0.35)
    head_m = Matrix.Translation(head_at) @ gm(head_g)
    head = empty(f"{name}.head", droot, head_m, collection)
    parts["head"] = head
    instance(lib[pre + "head"], f"{name}.face", dm, head, None, collection)
    instance(lib[pre + "helmet"], f"{name}.helmet", dm, head, None, collection)
    for side, key in ((1, "arm.L"), (-1, "arm.R")):
        sh = lib[pre + key].location
        shoulder = (sh.x, sh.z, -sh.y)  # Blender back to the game frame
        m = arm_matrix(side, shoulder, steer, lean)
        instance(lib[pre + key], f"{name}.{key}", dm, droot, gm(m), collection)
    for bit in BITS[species]:
        key = pre + bit
        if key in lib:
            parts[bit] = instance(lib[key], f"{name}.{bit}", dm, droot, Matrix.Translation(lib[key].location), collection)

    # Wheels: the front pair turns about its hubs; the rear pair sits on the rear axle. All spin about x.
    wheel = lib["kart.wheel"]
    for side in (1, -1):
        for kind, hub, sc in (("f", WHEEL_FRONT, FRONT_SCALE), ("r", WHEEL_REAR, 1.0)):
            yaw = -steer * 0.5 if kind == "f" else 0.0
            hub_g = T(side * hub[0], hub[1], hub[2]) @ RY(yaw) @ RX(spin)
            h = empty(f"{name}.hub.{kind}{'L' if side > 0 else 'R'}", root, gm(hub_g), collection)
            parts[f"hub.{kind}{'L' if side > 0 else 'R'}"] = h
            wm = gm(RY(math.pi if side < 0 else 0.0) @ S(sc))
            instance(wheel, f"{name}.wheel.{kind}{'L' if side > 0 else 'R'}", km, h, wm, collection)
    return root, parts


def set_wheel_spin(parts, spin, steer=0.0):
    """Turn all four wheels to `spin` radians (the hubs are the empties build_kart made)."""
    for key, hub in (("hub.fL", WHEEL_FRONT), ("hub.fR", WHEEL_FRONT), ("hub.rL", WHEEL_REAR), ("hub.rR", WHEEL_REAR)):
        side = 1 if key.endswith("L") else -1
        yaw = -steer * 0.5 if key[4] == "f" else 0.0
        parts[key].matrix_basis = gm(T(side * hub[0], hub[1], hub[2]) @ RY(yaw) @ RX(spin))


def place(obj, pos, heading, up_tilt=(0.0, 0.0)):
    """Put a kart (or anything built in the kart's frame) at `pos` (Blender), facing the Blender direction `heading` (x, y).
    `up_tilt`: (pitch, roll) of the whole kart, for the road's slope and bank."""
    dx, dy = heading
    yaw = math.atan2(dx, -dy)
    m = Matrix.Translation(pos) @ RZ(yaw) @ RX(-up_tilt[0]) @ RY(up_tilt[1])
    obj.matrix_basis = m


def keyframe_matrix(obj, frame):
    obj.keyframe_insert("location", frame=frame)
    obj.keyframe_insert("rotation_euler", frame=frame)
    obj.keyframe_insert("scale", frame=frame)


def aim_camera(cam_obj, frm, to, roll=0.0):
    cam_obj.matrix_basis = Matrix.Translation(frm) @ look_rot(frm, to, roll)
