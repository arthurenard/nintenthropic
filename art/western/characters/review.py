"""Review renders of a built character scene (.blend saved by build.py --blend).

    Blender -b BLEND -P art/western/characters/review.py -- --out DIR --what turn,faces,strips,distance,lineup

turn      turnaround (front, 3/4, side, back) in the dressings given by --dress
faces     close-ups of the face (front, 3/4, profile) and of the hands
strips    contact strip frames for every clip (--frames per clip)
distance  the player's view: eye height 1.7 m, the figure at 10, 20 and 35 m,
          on the street and in an upper window, warm low sun from behind the camera
lineup    every dressing side by side

Renders stay out of the repository; only the script lives here.
"""
import math
import os
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


OUT = arg("--out", "/tmp/char_review")
WHAT = arg("--what", "turn,faces,strips,distance").split(",")
TAG = arg("--tag", os.path.splitext(os.path.basename(bpy.data.filepath))[0])
NF = int(arg("--frames", "6"))
DRESS = [d.split("+") if d else [] for d in arg("--dress", "").split(",")] if arg("--dress") else None
PROP = arg("--prop", "gun.revolver")
ONLY = arg("--clips", "").split(",") if arg("--clips") else None   # strips: just these clips
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == "ARMATURE")
meshes = [o for o in sc.objects if o.type == "MESH"]
for o in meshes:
    o.data.validate()      # scenes saved before bl.decimate validated could crash EEVEE


def dress(names):
    for o in meshes:
        n = o.name
        if n.startswith("var."):
            o.hide_render = n not in names
        elif n.startswith("gun.") or n.startswith("prop."):
            o.hide_render = n != PROP
        else:
            o.hide_render = False


def world(strength=1.0, sky=(0.42, 0.52, 0.66)):
    w = bpy.data.worlds.get("review") or bpy.data.worlds.new("review")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = strength


def sun(elev=18.0, az=180.0, energy=4.0, color=(1.0, 0.82, 0.62)):
    """A low sun; az is where the light comes FROM, measured from -Y (the
    character's front) - 180 puts it behind a camera that faces him."""
    s = bpy.data.objects.get("review_sun")
    if not s:
        s = bpy.data.objects.new("review_sun", bpy.data.lights.new("review_sun", "SUN"))
        sc.collection.objects.link(s)
    s.data.energy = energy
    s.data.color = color
    s.data.angle = math.radians(1.0)
    a, e = math.radians(az), math.radians(elev)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))  # direction toward the sun
    s.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return s


def camera(lens=50):
    c = bpy.data.objects.get("review_cam")
    if not c:
        c = bpy.data.objects.new("review_cam", bpy.data.cameras.new("review_cam"))
        sc.collection.objects.link(c)
    c.data.lens = lens
    c.data.clip_start = 0.05
    c.data.clip_end = 300
    sc.camera = c
    return c


def look(c, pos, tgt):
    c.location = Vector(pos)
    c.rotation_euler = (Vector(tgt) - c.location).to_track_quat("-Z", "Y").to_euler()


def ground(size=60, color=(0.50, 0.40, 0.30)):
    g = bpy.data.objects.get("review_ground")
    if not g:
        me = bpy.data.meshes.new("review_ground")
        s = size / 2
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new("review_ground", me)
        sc.collection.objects.link(g)
        m = bpy.data.materials.new("review_ground")
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        g.data.materials.append(m)
    return g


def facade(y=0.9, color=(0.55, 0.38, 0.24), window=False):
    """A sunlit plank wall behind the figure (what he is read against in the
    game), with a window opening at 3 m when needed."""
    name = "review_wall"
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new(name)
    verts = [(-4, y, 0), (4, y, 0), (4, y, 6), (-4, y, 6)]
    faces = [(0, 1, 2, 3)]
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexWave")
    tex.inputs["Scale"].default_value = 3.0
    tex.wave_type = "BANDS"
    tex.bands_direction = "Z"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*color, 1)
    mix.inputs["B"].default_value = (color[0] * 0.8, color[1] * 0.8, color[2] * 0.8, 1)
    nt.links.new(tex.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    o.data.materials.append(m)
    return o


def render(path, w=900, h=1100, samples=32):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    try:
        sc.eevee.taa_render_samples = samples
        sc.eevee.use_shadows = True
    except Exception:
        pass
    sc.view_settings.view_transform = "AgX"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


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
    return sorted(a.name for a in bpy.data.actions if a.name != "review")


chicken = any(b.name == "body" for b in rig.data.bones)
H = 0.45 if chicken else 1.8
dressings = DRESS or [[]]

if "turn" in WHAT:
    world(0.9)
    sun(40, 150, 3.5)
    ground()
    c = camera(60)
    idle = "idle" if "idle" in actions() else ("peck" if chicken else None)
    for di, d in enumerate(dressings):
        dress(d)
        if idle:
            set_clip(idle, 1)
        for vn, az in (("front", 0), ("q34", 35), ("side", 90), ("back", 180)):
            a = math.radians(az)
            dist = H * 2.1
            look(c, (math.sin(a) * dist, -math.cos(a) * dist, H * 0.62), (0, 0, H * 0.5))
            render(os.path.join(OUT, f"{TAG}_turn{di}_{vn}.png"), 700, 1000)

if "faces" in WHAT and not chicken:
    world(0.8)
    sun(30, 160, 3.2)
    c = camera(90)
    for di, d in enumerate(dressings[:2]):
        dress(d)
        rest()
        for vn, az in (("front", 0), ("q34", 35), ("profile", 90)):
            a = math.radians(az)
            t = Vector((0, -0.02, 1.66))
            look(c, t + Vector((math.sin(a) * 0.9, -math.cos(a) * 0.9, 0.05)), t)
            render(os.path.join(OUT, f"{TAG}_face{di}_{vn}.png"), 700, 700, 48)
    dress(dressings[0])
    set_clip("aim" if "aim" in actions() else "idle", 1)
    for side, tgt in (("R", "hand.R"), ("L", "hand.L")):
        pb = rig.pose.bones[tgt]
        p = rig.matrix_world @ pb.head
        look(c, p + Vector((0.35 if side == "L" else -0.1, -0.45, 0.12)), p + Vector((0, -0.05, 0)))
        render(os.path.join(OUT, f"{TAG}_hand_{side}.png"), 600, 600, 48)

if "strips" in WHAT:
    world(0.9)
    sun(40, 150, 3.5)
    ground()
    c = camera(60)
    dress(dressings[0])
    for name in actions():
        if ONLY and name not in ONLY:
            continue
        act = bpy.data.actions[name]
        PROP = "prop.dynamite" if name == "throw" else ("gun.rifle" if "rifle" in name else arg("--prop", "gun.revolver"))
        dress(dressings[0])
        f0, f1 = act.frame_range
        frames = sorted(set(int(round(f0 + i * (f1 - f0) / (NF - 1))) for i in range(NF)))
        for f in frames:
            set_clip(name, f)
            # close enough that the frame is mostly figure; a death needs room
            # for the body lying along the view axis
            dist = H * (2.7 if name.startswith("death") else 2.3)
            az = math.radians(30)
            look(c, (math.sin(az) * dist, -math.cos(az) * dist, H * 0.7), (0, 0.2 if name.startswith("death") else 0, H * 0.47))
            render(os.path.join(OUT, f"{TAG}_clip_{name}_{f:03d}.png"), 360, 480, 16)

if "distance" in WHAT:
    world(0.7, (0.45, 0.55, 0.70))
    sun(16, 12, 4.5)                   # low, warm, from behind the camera (a little to its left)
    ground(200)
    c = camera(35)                     # about a 54 degree vertical view on a 16:9 frame
    for di, d in enumerate(dressings):
        dress(d)
        for clip in ([] if chicken else [arg("--clip", "aim")]) + (["peck"] if chicken else []):
            if clip not in actions():
                continue
            set_clip(clip, 5)
            for dist in (10, 20, 35):
                for where, z in (("street", 0.0), ("window", 3.4)) if not chicken else (("street", 0.0),):
                    rig.location = (0, 0, z)
                    wall = facade(0.9, window=where == "window")
                    look(c, (0, -dist, 1.7), (0, 0, 1.2 + z * 0.9 if not chicken else 0.25))
                    render(os.path.join(OUT, f"{TAG}_dist{di}_{clip}_{dist}m_{where}.png"), 960, 540, 32)
                    bpy.data.objects.remove(wall)
            rig.location = (0, 0, 0)

if "lineup" in WHAT:
    world(0.8)
    sun(25, 170, 4.0)
    ground()
    c = camera(40)
    idle = "idle" if "idle" in actions() else "peck"
    for di, d in enumerate(dressings):
        dress(d)
        set_clip(idle, 1 + di * 7)
        look(c, (0, -H * 2.6, H * 0.6), (0, 0, H * 0.5))
        render(os.path.join(OUT, f"{TAG}_lineup_{di}.png"), 420, 760, 24)
