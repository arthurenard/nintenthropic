"""Review renders of Dead of Night's people, from the scenes build.py saves.

    Blender -b art/night/build/characters/walker.blend -P art/night/characters/review.py -- \\
        [--out DIR] [--what turn,faces,strips,distance,lineup] [--dress NAME,...] [--quick]

turn      front, three-quarter, side, back of each dressing, moonlight and a fill
faces     the head close: front, three-quarter, profile - in a torch's light, which
          is how the player sees a face - and the hands
strips    one contact sheet per clip (frames across, the pose every few frames)
distance  the player's view: eye 1.7 m, the figure at 10, 25 and 40 m on a wet
          road in the game's fog, a flashlight from the eye on it, the moon
          low in front (as on Route 9) - the eyes should shine before the
          body resolves
lineup    every dressing side by side

Cycles on the GPU. Renders go to art/night/build/review/characters (git-ignored).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
NIGHT = os.path.dirname(HERE)
sys.path.insert(0, NIGHT)
sys.path.insert(0, HERE)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


OUT = arg("--out", os.path.join(NIGHT, "build", "review", "characters"))
WHAT = arg("--what", "turn,faces,strips,distance,lineup").split(",")
QUICK = "--quick" in argv
TAG = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == "ARMATURE")
meshes = [o for o in sc.objects if o.type == "MESH"]
for o in meshes:
    o.data.validate()

DRESSINGS = {
    "walker": {
        "farmer": ["char.walker", "var.outfit.farmer", "var.hair.short", "eyes"],
        "trucker": ["char.walker", "var.outfit.trucker", "var.hair.greasy", "eyes"],
        "waitress": ["char.walker", "var.outfit.waitress", "var.hair.long", "eyes"],
        "hunter": ["char.walker", "var.outfit.hunter", "var.hair.balding", "eyes"],
        "mechanic_small": ["char.walker", "var.outfit.mechanic_small", "var.hair.short", "eyes"],
        "suit": ["char.walker", "var.outfit.suit", "var.hair.balding", "eyes"],
        "runner": ["char.runner", "eyes"],
        "bloater": ["char.bloater", "eyes"],
        "crawler": ["char.crawler", "eyes"],
    },
    "mechanic": {"mechanic": ["char.mechanic", "var.mask", "prop.tyre_iron", "eyes"],
                 "unmasked": ["char.mechanic", "prop.tyre_iron", "eyes"]},
    "survivor": {"daughter": ["var.person.daughter", "prop.lantern", "lantern.flame"],
                 "owner": ["var.person.owner", "prop.lantern", "lantern.flame"]},
    "cat": {"cat": ["char.cat", "eyes"]},
}.get(TAG, {"all": [o.name for o in meshes]})
if arg("--dress"):
    DRESSINGS = {k: v for k, v in DRESSINGS.items() if k in arg("--dress").split(",")}
IDLE = {"cat": "sit", "survivor": "run"}.get(TAG, "idle")
H = 0.42 if TAG == "cat" else 1.8


def dress(names):
    for o in meshes:
        o.hide_render = o.name not in names


def world(color=(0.012, 0.016, 0.026), strength=1.0):
    w = bpy.data.worlds.get("review") or bpy.data.worlds.new("review")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength


def light(name, kind, loc, target, energy, color=(1, 1, 1), size=0.1, spot=None):
    o = bpy.data.objects.get(name)
    if not o:
        o = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
        sc.collection.objects.link(o)
    o.data.energy = energy
    o.data.color = color
    if kind == 'SUN':
        o.data.angle = math.radians(size)
    else:
        o.data.shadow_soft_size = size
    if spot:
        o.data.spot_size = math.radians(spot)
        o.data.spot_blend = 0.5
    o.location = Vector(loc)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    o.hide_render = False
    return o


def lights_off():
    for o in sc.objects:
        if o.type == 'LIGHT':
            o.hide_render = True


def moon(energy=1.3):
    # low in front and to the left of the player, as on Route 9 (the figure faces the player)
    az, el = math.radians(-24.0), math.radians(14.0)
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    # the review stages the figure at the origin facing -Y, the camera at -Y: the moon is behind the figure
    return light("rv_moon", 'SUN', d * -10.0 * -1, (0, 0, 0), energy, (0.62, 0.75, 1.0), 2.2)


def camera(lens=50):
    c = bpy.data.objects.get("rv_cam")
    if not c:
        c = bpy.data.objects.new("rv_cam", bpy.data.cameras.new("rv_cam"))
        sc.collection.objects.link(c)
    c.data.lens = lens
    c.data.clip_start = 0.02
    c.data.clip_end = 500
    sc.camera = c
    return c


def look(c, pos, tgt):
    c.location = Vector(pos)
    c.rotation_euler = (Vector(tgt) - c.location).to_track_quat("-Z", "Y").to_euler()


def ground(size=200):
    g = bpy.data.objects.get("rv_ground")
    if not g:
        me = bpy.data.meshes.new("rv_ground")
        s = size / 2
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new("rv_ground", me)
        sc.collection.objects.link(g)
        m = bpy.data.materials.new("rv_road")
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 3.0
        nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["To Min"].default_value = 0.12
        mr.inputs["To Max"].default_value = 0.45
        nt.links.new(n.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])
        b.inputs["Base Color"].default_value = (0.035, 0.035, 0.037, 1)
        g.data.materials.append(m)
    return g


def render(path, w, h, samples, fog=False, eye=None, fwd=None):
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.use_adaptive_sampling = True
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    from roadlib import post
    post.render(sc, path, fog=fog)
    print("wrote", path, flush=True)


def set_clip(name, frame):
    act = bpy.data.actions.get(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    sc.frame_set(int(frame))


def rest():
    if rig.animation_data:
        rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def actions():
    return sorted(a.name for a in bpy.data.actions)


def eyes_glow(strength):
    m = bpy.data.materials.get("eyes")
    if m:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs["Emission Strength"].default_value = strength


def sheet(paths, out, cols):
    """Tile frames into one contact sheet."""
    imgs = [bpy.data.images.load(p) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    S = np.zeros((rows * h, cols * w, 4), np.float32)
    for i, im in enumerate(imgs):
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        r, c = divmod(i, cols)
        S[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a
    out_img = bpy.data.images.new("sheet", cols * w, rows * h, alpha=False)
    out_img.pixels.foreach_set(S.ravel())
    out_img.filepath_raw = out
    out_img.file_format = 'PNG'
    out_img.save()
    for im in imgs:
        bpy.data.images.remove(im)
    for p in paths:
        os.remove(p)
    print("wrote", out, flush=True)


dressings = list(DRESSINGS.items())
S_ = 16 if QUICK else 48

if "turn" in WHAT:
    world((0.02, 0.025, 0.035), 1.0)
    lights_off()
    moon(1.6)
    light("rv_fill", 'AREA', (2.5, -3.0, 2.5), (0, 0, 1.0), 120.0, (0.8, 0.85, 1.0), 2.0)
    ground()
    c = camera(60)
    for name, d in dressings:
        dress(d)
        clip = "crawl" if name == "crawler" else IDLE
        if clip in actions():
            set_clip(clip, 1)
        for vn, az in (("front", 0), ("q34", 35), ("side", 90), ("back", 180)):
            a = math.radians(az)
            dist = H * 2.2
            ht = H * 0.5 if name != "crawler" else 0.25
            look(c, (math.sin(a) * dist, -math.cos(a) * dist, ht + H * 0.1), (0, 0 if name != "crawler" else -0.3, ht))
            render(os.path.join(OUT, f"{TAG}_{name}_turn_{vn}.png"), 600, 860, S_)

if "faces" in WHAT and TAG != "cat":
    world((0.01, 0.012, 0.02), 1.0)
    lights_off()
    moon(1.3)
    c = camera(85)
    eyes_glow(0.0)
    seen = set()
    for name, d in dressings:
        head = next((n for n in d if n in ("char.walker", "char.runner", "char.bloater", "char.crawler", "char.mechanic",
                                             "var.person.daughter", "var.person.owner")), None)
        key = head if head != "char.walker" else ("char.walker" if "char.walker" not in seen else None)
        if key is None or key in seen:
            continue
        seen.add(key)
        dress(d)
        rest()
        # the head's place in the rest pose, through the rig's own scale (the Mechanic is 1.15x)
        sc_ = rig.matrix_world.to_scale().x
        t = rig.matrix_world @ Vector((0, -0.02, 1.66))
        for vn, az in (("front", 0), ("q34", 35), ("profile", 90)):
            a = math.radians(az)
            cam = t + Vector((math.sin(a) * 0.75, -math.cos(a) * 0.75, 0.04)) * sc_
            look(c, cam, t)
            # a torch held low beside the camera: how the player sees a face
            light("rv_torch", 'SPOT', cam + Vector((0.12, 0.05, -0.2)), t, 18.0, (1.0, 0.93, 0.8), 0.02, spot=30)
            render(os.path.join(OUT, f"{TAG}_{name}_face_{vn}.png"), 700, 700, S_ * 2)
        # the hands
        if IDLE in actions():
            set_clip("claw" if "claw" in actions() else IDLE, 10)
        for side in ("R", "L"):
            pb = rig.pose.bones[f"hand.{side}"]
            p = rig.matrix_world @ pb.head
            cam = p + Vector((0.3 if side == "L" else -0.3, -0.45, 0.12))
            look(c, cam, p + Vector((0, -0.08, 0)))
            light("rv_torch", 'SPOT', cam + Vector((0.1, 0.05, -0.1)), p, 12.0, (1.0, 0.93, 0.8), 0.02, spot=35)
            render(os.path.join(OUT, f"{TAG}_{name}_hand_{side}.png"), 500, 500, S_)
    eyes_glow(1.0)

if "strips" in WHAT:
    world((0.03, 0.035, 0.045), 1.0)
    lights_off()
    moon(1.5)
    light("rv_fill", 'AREA', (2.5, -3.0, 2.5), (0, 0, 1.0), 140.0, (0.85, 0.88, 1.0), 2.0)
    ground()
    c = camera(45)
    name0, d0 = dressings[0]
    only = arg("--clips")
    for act in actions():
        if only and act not in only.split(","):
            continue
        d = DRESSINGS.get("crawler", d0) if act == "crawl" or act.endswith(".low") else (DRESSINGS.get("bloater", d0) if act == "bloat_burst" else d0)
        dress(d)
        a = bpy.data.actions[act]
        f0, f1 = a.frame_range
        n = 8
        frames = sorted(set(int(round(f0 + i * (f1 - f0) / (n - 1))) for i in range(n)))
        paths = []
        low = act in ("crawl",) or act.startswith("death") or act in ("bloat_burst",) or act.endswith(".low")
        for f in frames:
            set_clip(act, f)
            az = math.radians(55)
            dist = H * (2.9 if low else 2.5)
            look(c, (math.sin(az) * dist, -math.cos(az) * dist, H * 0.55), (0, 0.15 if low else 0, H * (0.3 if low else 0.5)))
            p = os.path.join(OUT, f"_tmp_{act}_{f:03d}.png")
            render(p, 300, 420, 12 if QUICK else 24)
            paths.append(p)
        sheet(paths, os.path.join(OUT, f"{TAG}_clip_{act}.png"), len(paths))

if "distance" in WHAT and TAG != "cat":
    # the sky at the horizon is the fog's colour (as sky.webp is on Route 9),
    # so the far road melts into it instead of ending at a line
    from roadlib import post as _post
    world(tuple(float(v) for v in _post.fog_color()), 1.0)
    lights_off()
    moon(1.3)
    ground(400)
    c = camera(35)
    c.data.sensor_fit = 'VERTICAL'
    c.data.angle_y = math.radians(30.0)
    eyes_glow(2.5)
    for name, d in dressings:
        dress(d)
        clip = "crawl" if name == "crawler" else ("walk.shamble" if "walk.shamble" in actions() else IDLE)
        if clip in actions():
            set_clip(clip, 6)
        for dist in (10, 25, 40):
            rig.location = (0, 0, 0)
            cam = Vector((0.4, -dist, 1.7))
            look(c, cam, (0, 0, 1.1 if name != "crawler" else 0.3))
            # the flashlight: ~3 W/m2 on the figure at 10 m (a little over twice the moon), falling off with distance
            light("rv_torch", 'SPOT', cam + Vector((0.15, 0.3, -0.3)), (0, 0, 1.2 if name != "crawler" else 0.3), 4000.0,
                  (1.0, 0.93, 0.8), 0.02, spot=18)
            render(os.path.join(OUT, f"{TAG}_{name}_dist_{dist}m.png"), 960, 540, S_, fog=True)
    eyes_glow(1.0)

if "lineup" in WHAT:
    world((0.02, 0.025, 0.035), 1.0)
    lights_off()
    moon(1.6)
    light("rv_fill", 'AREA', (0.0, -4.0, 2.5), (0, 0, 1.0), 160.0, (0.85, 0.88, 1.0), 3.0)
    ground()
    c = camera(40)
    paths = []
    for i, (name, d) in enumerate(dressings):
        dress(d)
        clip = "crawl" if name == "crawler" else IDLE
        if clip in actions():
            set_clip(clip, 1 + i * 7)
        look(c, (0, -H * 2.6, H * 0.55), (0, 0 if name != "crawler" else -0.3, H * 0.5 if name != "crawler" else 0.3))
        p = os.path.join(OUT, f"_tmp_lineup_{i}.png")
        render(p, 320, 600, S_)
        paths.append(p)
    if paths:
        sheet(paths, os.path.join(OUT, f"{TAG}_lineup.png"), len(paths))
