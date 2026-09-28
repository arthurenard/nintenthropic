"""Review renders of Overwatch Ridge's people, from a scene saved by
build.py --blend (renders land in art/ridge/build/review/people/, git-ignored).

    Blender -b art/ridge/build/people/soldier.blend -t 4 -P art/ridge/people/review.py -- \\
        --what turn,faces,hands,strips,distance [--dress "var.helmet+var.pack+gun.rifle,..."] [--clips a,b] [--frames 8]

turn      turnaround (front, 3/4, side, back) of each dressing, studio light
faces     close-ups of the face (and of the first dressing's head gear)
hands     the hands, holding their props, in a clip pose
strips    a contact sheet per clip: --frames frames from a 3/4 view
distance  the game: a 6x scope (vertical field of view 7.5 degrees) from 60 m
          above the valley floor, 2560x1440, figures at 250, 400 and 600 m
          on grass by a grey road, dawn light (sun 6 degrees up, behind the
          camera and to its left; blue sky fill); a soldier and a farmer side
          by side (--pair soldier.blend,civilian.blend loads the second file's
          person next to this one) - lit, and in the valley's blue shadow
sheet     only rebuild the contact sheets from frames already rendered

A dressing is a '+'-joined list of node names to show: var.*, gun.*, prop.*,
bicycle; every other variant and prop is hidden. Engine: EEVEE.
"""
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out", os.path.join(os.path.dirname(HERE), "build", "review", "people"))
WHAT = arg("--what", "turn,faces,strips").split(",")
TAG = arg("--tag", os.path.splitext(os.path.basename(bpy.data.filepath))[0])
NF = int(arg("--frames", "8"))
DRESS = [d.split("+") if d else [] for d in arg("--dress", "").split(",")] if arg("--dress") else [[]]
ONLY = arg("--clips", "").split(",") if arg("--clips") else None
STRIP_DRESS = arg("--strip-dress")
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == "ARMATURE")
for o in sc.objects:
    if o.type == "MESH":
        o.data.validate()


def toggles():
    return [o for o in sc.objects if o.type == "MESH" and (o.name.startswith(("var.", "gun.", "prop.", "bicycle")))]


def dress(names):
    names = set(names)
    for o in sc.objects:
        if o.type != "MESH":
            continue
        n = o.name
        if n.startswith(("var.", "gun.", "prop.")):
            o.hide_render = n not in names
        elif n.startswith("bicycle"):
            o.hide_render = "bicycle" not in names
        else:
            o.hide_render = False


def world(strength=1.0, sky=(0.42, 0.52, 0.66), haze=0.0):
    w = bpy.data.worlds.get("review") or bpy.data.worlds.new("review")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = strength
    out = nt.nodes.get("World Output")
    vol = nt.nodes.get("haze")
    if haze > 0:
        if vol is None:
            vol = nt.nodes.new("ShaderNodeVolumePrincipled")
            vol.name = "haze"
        vol.inputs["Color"].default_value = (*sky, 1)
        vol.inputs["Density"].default_value = haze
        nt.links.new(vol.outputs[0], out.inputs["Volume"])
    elif vol is not None:
        nt.nodes.remove(vol)


def sun(elev=18.0, az=180.0, energy=4.0, color=(1.0, 0.82, 0.62), angle=1.0):
    """az: where the light comes FROM, degrees from -Y (the figure's front),
    positive toward +X (the figure's left = the viewer's right)."""
    s = bpy.data.objects.get("review_sun")
    if not s:
        s = bpy.data.objects.new("review_sun", bpy.data.lights.new("review_sun", "SUN"))
        sc.collection.objects.link(s)
    s.data.energy = energy
    s.data.color = color
    s.data.angle = math.radians(angle)
    a, e = math.radians(az), math.radians(elev)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    s.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    s.hide_render = energy <= 0
    return s


def camera(lens=50, sensor=36.0):
    c = bpy.data.objects.get("review_cam")
    if not c:
        c = bpy.data.objects.new("review_cam", bpy.data.cameras.new("review_cam"))
        sc.collection.objects.link(c)
    c.data.lens = lens
    c.data.sensor_width = sensor
    c.data.sensor_fit = "AUTO"
    c.data.clip_start = 0.05
    c.data.clip_end = 5000
    sc.camera = c
    return c


def look(c, pos, tgt):
    c.location = Vector(pos)
    c.rotation_euler = (Vector(tgt) - c.location).to_track_quat("-Z", "Y").to_euler()


def mat(name, color, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def plane(name, x0, y0, x1, y1, z, m):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    o.data.materials.append(m)
    return o


def studio_ground():
    for n in ("ground", "road", "grass"):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o)
    plane("ground", -30, -30, 30, 30, 0, mat("studio_ground", (0.30, 0.28, 0.24)))


def valley_ground():
    """Pasture grass either side of a grey gravel road running across the view."""
    o = bpy.data.objects.get("ground")
    if o:
        bpy.data.objects.remove(o)
    g = mat("grass", (0.10, 0.14, 0.05), 0.95)
    nt = g.node_tree
    b = nt.nodes["Principled BSDF"]
    if not nt.nodes.get("noise"):
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.name = "noise"
        nz.inputs["Scale"].default_value = 0.6
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.075, 0.11, 0.04, 1)
        ramp.color_ramp.elements[1].color = (0.15, 0.17, 0.07, 1)
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    plane("grass", -800, -800, 800, 800, -0.01, g)
    plane("road", -800, -3.2, 800, 1.2, 0.0, mat("road", (0.30, 0.29, 0.27), 0.95))


def render(path, w=900, h=1100, samples=32, film_transparent=False):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = film_transparent
    try:
        sc.eevee.taa_render_samples = samples
        sc.eevee.use_shadows = True
    except Exception:
        pass
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


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
    return sorted(a.name for a in bpy.data.actions if a.users or a.use_fake_user)


def load_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.array(img.pixels[:], np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return a


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("sheet", w, h, alpha=True)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def sheet(paths, out, cols):
    """Tile rendered frames left to right, top to bottom (Blender pixels run bottom-up)."""
    ims = [load_png(p) for p in paths]
    h, w = ims[0].shape[:2]
    rows = (len(ims) + cols - 1) // cols
    S = np.ones((rows * h, cols * w, 4), np.float32)
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        S[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = im
    save_png(S, out)


def head_pos():
    pb = rig.pose.bones["head"]
    return rig.matrix_world @ pb.head


def bone_pos(name, tail=False):
    pb = rig.pose.bones[name]
    return rig.matrix_world @ (pb.tail if tail else pb.head)


H = 1.8
if "turn" in WHAT:
    world(0.9, (0.45, 0.55, 0.70))
    sun(28, -35, 4.0)                    # warm, from the viewer's left
    studio_ground()
    c = camera(60)
    for di, d in enumerate(DRESS):
        dress(d)
        clip = arg("--turn-clip", "idle")
        if clip in actions():
            set_clip(clip, int(arg("--turn-frame", "1")))
        else:
            rest()
        names = []
        prone = clip.startswith("prone")
        for vn, az in (("front", 0), ("q34", 35), ("side", 90), ("back", 180)):
            a = math.radians(az)
            dist = H * 2.2
            if prone:
                look(c, (math.sin(a) * 4.2, -math.cos(a) * 4.2 + 0.25, 1.6), (0, 0.25, 0.2))
                names.append(render(os.path.join(OUT, f"{TAG}_turn{di}_{vn}.png"), 900, 600, 32))
            else:
                look(c, (math.sin(a) * dist, -math.cos(a) * dist, H * 0.6), (0, 0, H * 0.5))
                names.append(render(os.path.join(OUT, f"{TAG}_turn{di}_{vn}.png"), 600, 900, 32))
        sheet(names, os.path.join(OUT, f"{TAG}_turn{di}.png"), 2 if prone else 4)
        for p in names:
            os.remove(p)

if "faces" in WHAT:
    world(0.8, (0.45, 0.55, 0.70))
    sun(20, -40, 3.6)
    studio_ground()
    c = camera(100)
    for di, d in enumerate(DRESS):
        dress(d)
        rest()
        names = []
        hp = head_pos() + Vector((0, -0.03, 0.06))
        for vn, az in (("front", 0), ("q34", 35), ("profile", 90)):
            a = math.radians(az)
            look(c, hp + Vector((math.sin(a) * 1.0, -math.cos(a) * 1.0, 0.04)), hp)
            names.append(render(os.path.join(OUT, f"{TAG}_face{di}_{vn}.png"), 600, 600, 48))
        sheet(names, os.path.join(OUT, f"{TAG}_face{di}.png"), 3)
        for p in names:
            os.remove(p)

if "hands" in WHAT:
    world(0.8, (0.45, 0.55, 0.70))
    sun(25, -40, 3.6)
    studio_ground()
    c = camera(85)
    for di, d in enumerate(DRESS):
        dress(d)
        clip = arg("--hand-clip", "aim")
        set_clip(clip, int(arg("--hand-frame", "1")))
        names = []
        for side in ("R", "L"):
            p = bone_pos(f"hand.{side}")
            for k, off in enumerate((Vector((-0.25, -0.45, 0.12)), Vector((0.45, -0.25, 0.10)))):
                look(c, p + off, p)
                names.append(render(os.path.join(OUT, f"{TAG}_hand{di}_{side}{k}.png"), 500, 500, 48))
        sheet(names, os.path.join(OUT, f"{TAG}_hands{di}.png"), 4)
        for p in names:
            os.remove(p)

def box(name, lo, hi, color=(0.25, 0.22, 0.18)):
    """A plain box (a stand-in for the truck's bed, the seat)."""
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    V = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(V, [], F)
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    o.data.materials.append(mat(name, color))
    return o


def wheel_ring(name, centre, radius, tilt_deg):
    """The contract's steering wheel: a torus, its plane tilted back."""
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.013, location=centre,
                                     rotation=(math.radians(90 - tilt_deg), 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat(name, (0.05, 0.05, 0.05), 0.5))
    return o


def props_for(name):
    """Stand-ins for what a clip touches (the vehicles artist's numbers)."""
    for n in ("_seat", "_wheel", "_bed"):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o)
    if name.startswith("drive"):
        box("_seat", (-0.25, -0.12, 0.0), (0.25, 0.30, 0.33))
        wheel_ring("_wheel", (0.0, -0.38, 0.80), 0.19, 30.0)
    elif name == "dismount":
        box("_bed", (-1.0, 0.25, 0.0), (1.0, 2.6, 1.15), (0.20, 0.24, 0.16))


if "strips" in WHAT:
    world(0.9, (0.45, 0.55, 0.70))
    sun(30, -35, 4.0)
    studio_ground()
    c = camera(55)
    dress(DRESS[0])
    default_dress = DRESS[0]
    strip_dress = {}
    if STRIP_DRESS:
        for item in STRIP_DRESS.split(";"):
            k, v = item.split("=")
            strip_dress[k] = v.split("+") if v else []
    for name in actions():
        if ONLY and name not in ONLY:
            continue
        act = bpy.data.actions[name]
        dress(strip_dress.get(name, default_dress))
        f0, f1 = act.frame_range
        frames = sorted(set(int(round(f0 + i * (f1 - f0) / (NF - 1))) for i in range(NF)))
        props_for(name)
        flat = any(k in name for k in ("prone", "death"))
        low = flat or any(k in name for k in ("wound", "crouch", "duck", "kneel"))
        names = []
        for f in frames:
            set_clip(name, f)
            az = math.radians(float(arg("--strip-az", "60")))
            if flat:
                dist, cz, tgt = 4.4, 1.6, (0, 0.15, 0.25)
            elif name == "dismount":
                dist, cz, tgt = 5.0, 1.6, (0, 0.35, 0.95)
            elif low:
                dist, cz, tgt = 3.4, 1.2, (0, 0, 0.55)
            else:
                dist, cz, tgt = 3.6, 1.25, (0, 0, 0.88)
            look(c, (math.sin(az) * dist, -math.cos(az) * dist + tgt[1], cz), tgt)
            names.append(render(os.path.join(OUT, f"_{TAG}_{name}_{f:03d}.png"), 400, 480, 16))
        sheet(names, os.path.join(OUT, f"{TAG}_clip_{name}.png"), len(names))
        for p in names:
            os.remove(p)
    props_for("")

if "distance" in WHAT:
    # the scope: 45 degrees / 6 vertical on 2560x1440
    world(0.55, (0.36, 0.48, 0.66), haze=float(arg("--haze", "0")))
    valley_ground()
    c = camera(35)
    c.data.sensor_fit = "VERTICAL"
    c.data.sensor_height = 24.0
    c.data.lens = 12.0 / math.tan(math.radians(7.5 / 2))
    pair = arg("--pair")
    others = []
    pair_clip = arg("--pair-clip", "idle")
    own = set(sc.objects)
    if pair:
        # append the other file's person beside this one, posed in its own clip
        with bpy.data.libraries.load(pair, link=False) as (src, dst):
            dst.objects = [n for n in src.objects if n != "review_sun" and n != "review_cam"]
            dst.actions = [a for a in src.actions if a == pair_clip]
        for o in dst.objects:
            if o is None:
                continue
            sc.collection.objects.link(o)
            others.append(o)
        prig = next(o for o in others if o.type == "ARMATURE")
        prig.location = (2.0, 0.4, 0)
        prig.animation_data_create()
        prig.animation_data.action = dst.actions[0] if dst.actions else None
    pd = arg("--pair-dress", "").split("+")
    if others and "var.person.child" in pd:
        prig.scale = (0.64, 0.64, 0.64)          # the child's extras.scale
    clip = arg("--dist-clip", "idle")
    base = lambda n: n.rsplit(".", 1)[0] if n[-4:-3] == "." and n[-3:].isdigit() else n
    for di, d in enumerate(DRESS):
        dress(d)
        for o in others:
            if o.type == "MESH" and base(o.name).startswith(("var.", "gun.", "prop.", "bicycle")):
                o.hide_render = not (base(o.name) in pd or (base(o.name).startswith("bicycle") and "bicycle" in pd))
        if clip in actions():
            set_clip(clip, 3)
        for light in ("lit", "shade"):
            if light == "lit":
                sun(6.0, 180 + 35, 5.0, (1.0, 0.72, 0.48), angle=0.6)
                world(0.55, (0.36, 0.48, 0.66), haze=float(arg("--haze", "0")))
            else:
                sun(6.0, 180 + 35, 0.0)
                world(0.75, (0.36, 0.48, 0.66), haze=float(arg("--haze", "0")))
            for D in (250, 400, 600):
                look(c, (0, -D, 60.0), (1.1, 0, 1.0))
                p = render(os.path.join(OUT, f"{TAG}_dist{di}_{light}_{D}m.png"), 2560, 1440, 32)
                # aerial perspective: the air between the ridge and the figures
                # (applied to the image - an EEVEE world volume renders black here)
                a = load_png(p)
                Tr = math.exp(-math.hypot(D, 60.0) / float(arg("--haze-m", "2600")))
                a[..., :3] = a[..., :3] * Tr + np.array([0.60, 0.66, 0.75]) * (1 - Tr)
                save_png(a, p)
                h, w = a.shape[:2]
                cw, ch = 160, 90
                crop = a[h // 2 - ch // 2:h // 2 + ch // 2, w // 2 - cw // 2:w // 2 + cw // 2]
                big = np.repeat(np.repeat(crop, 4, 0), 4, 1)
                save_png(big, os.path.join(OUT, f"{TAG}_dist{di}_{light}_{D}m_crop.png"))
