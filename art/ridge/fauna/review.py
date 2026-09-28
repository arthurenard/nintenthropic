"""Review renders of the animals, from the scene build.py saves with --blend.

    Blender -b art/ridge/build/fauna/fauna.blend -P art/ridge/fauna/review.py -- \\
        [--out DIR] [--what turn,close,clips,scope] [--only cow,eagle] [--clips cow.walk] [--frames 8] [--fast]

turn    turnaround sheet per animal (front, three-quarter, side, back, above)
close   close-ups: the cow's face and bell, the eagle's head at 1 m, faces of the rest
clips   one contact sheet per clip (frames across, side and three-quarter rows)
scope   what the player sees through the 6x scope (vertical FOV 7.5 deg, 2560x1440,
        dawn: a low warm sun behind the camera to its left, blue sky fill):
        cows at 250 m on grass and sheep at 700 m, from 60 m up; the goat on a
        grey cliff at 600 m; the eagle landed 2.5 m in front of a camera near
        the ground (the secret), through the scope and without it

Sheets are composited into single PNGs so a review is a handful of images.
Renders go to art/ridge/build/review/fauna/ (git-ignored).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


OUT = arg("--out", os.path.join(os.path.dirname(HERE), "build", "review", "fauna"))
WHAT = arg("--what", "turn,close,clips,scope").split(",")
ONLY = arg("--only", "").split(",") if arg("--only") else None
CLIPS = arg("--clips", "").split(",") if arg("--clips") else None
NF = int(arg("--frames", "8"))
FAST = "--fast" in argv
os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(OUT, "_tmp")
os.makedirs(TMP, exist_ok=True)

sc = bpy.context.scene
ANIMALS = [o for o in sc.objects if o.type == "ARMATURE" and o.name in ("cow", "sheep", "goat", "eagle", "dog")]
if ONLY:
    ANIMALS = [a for a in ANIMALS if a.name in ONLY]
MESH = {a.name: next(o for o in sc.objects if o.type == "MESH" and o.parent == a) for a in ANIMALS}
SIZE = {"cow": 1.5, "sheep": 0.9, "goat": 0.95, "eagle": 0.8, "dog": 0.8}
for a in ANIMALS:
    ad = a.animation_data_create()
    for tr in ad.nla_tracks:
        tr.mute = True


# ------------------------------------------------------------------ scene helpers

def world(color=(0.42, 0.52, 0.66), strength=1.0):
    w = bpy.data.worlds.get("review") or bpy.data.worlds.new("review")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*color, 1)
    bg.inputs[1].default_value = strength


def sun(direction_to_sun, energy=4.0, color=(1.0, 0.85, 0.7), angle=1.5):
    s = bpy.data.objects.get("review_sun")
    if not s:
        s = bpy.data.objects.new("review_sun", bpy.data.lights.new("review_sun", "SUN"))
        sc.collection.objects.link(s)
    s.data.energy = energy
    s.data.color = color
    s.data.angle = math.radians(angle)
    d = Vector(direction_to_sun).normalized()
    s.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return s


def sun_from(cam_pos, target, elev, side=-35.0, energy=4.0, color=(1.0, 0.78, 0.55)):
    """A sun behind the camera, `side` degrees to its left, `elev` degrees up."""
    f = (Vector(target) - Vector(cam_pos))
    f.z = 0
    f.normalize()
    left = Vector((-f.y, f.x, 0))          # the camera's left, seen from above
    a = math.radians(abs(side))
    h = (-f * math.cos(a) + left * math.sin(a)).normalized()
    e = math.radians(elev)
    d = Vector((h.x * math.cos(e), h.y * math.cos(e), math.sin(e)))
    return sun(d, energy, color)


def camera(lens=None, fov_v=None, clip_end=2000.0):
    c = bpy.data.objects.get("review_cam")
    if not c:
        c = bpy.data.objects.new("review_cam", bpy.data.cameras.new("review_cam"))
        sc.collection.objects.link(c)
    if fov_v:
        c.data.sensor_fit = "VERTICAL"
        c.data.angle_y = math.radians(fov_v)
    else:
        c.data.sensor_fit = "AUTO"
        c.data.lens = lens or 50
    c.data.clip_start = 0.02 if clip_end < 100 else 0.5
    c.data.clip_end = clip_end
    sc.camera = c
    return c


def look(c, pos, tgt):
    c.location = Vector(pos)
    c.rotation_euler = (Vector(tgt) - c.location).to_track_quat("-Z", "Y").to_euler()


def material(name, color, rough=0.9, noise=None, bump=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    if noise:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise[0]
        tex.inputs["Detail"].default_value = 8
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*noise[1], 1)
        ramp.color_ramp.elements[1].color = (*noise[2], 1)
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        if bump:
            bp = nt.nodes.new("ShaderNodeBump")
            bp.inputs["Strength"].default_value = bump
            nt.links.new(tex.outputs["Fac"], bp.inputs["Height"])
            nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    else:
        b.inputs["Base Color"].default_value = (*color, 1)
    return m


def plane(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
    me = bpy.data.meshes.new(name)
    s = size / 2
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    me.uv_layers.new()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(mat)
    return o


def clear(prefix="rv_"):
    for o in list(sc.objects):
        if o.name.startswith(prefix):
            bpy.data.objects.remove(o)


def render(path, w, h, samples=32):
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 8 if FAST else samples
        sc.eevee.use_shadows = True
    except Exception:
        pass
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def sheet(paths, cols, out, pad=4, bg=0.12):
    """Composite rendered PNGs into one grid image."""
    imgs = [bpy.data.images.load(p, check_existing=False) for p in paths]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    W, Hh = cols * w + (cols + 1) * pad, rows * h + (rows + 1) * pad
    canvas = np.full((Hh, W, 4), bg, np.float32)
    canvas[..., 3] = 1
    for i, im in enumerate(imgs):
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        r, c = divmod(i, cols)
        y0 = Hh - (r + 1) * (h + pad)
        x0 = pad + c * (w + pad)
        canvas[y0:y0 + h, x0:x0 + w] = a
    o = bpy.data.images.new("sheet", W, Hh, alpha=False)
    o.pixels.foreach_set(canvas.ravel())
    o.filepath_raw = out
    o.file_format = "PNG"
    o.save()
    bpy.data.images.remove(o)
    for im in imgs:
        bpy.data.images.remove(im)
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
    print("[review] wrote", out, flush=True)


def show_only(names):
    for a in ANIMALS:
        vis = a.name in names
        MESH[a.name].hide_render = not vis
        a.hide_render = not vis


def set_action(rig, name, frame):
    act = bpy.data.actions.get(name)
    ad = rig.animation_data_create()
    ad.action = act
    if act is not None and act.slots and ad.action_slot is None:
        ad.action_slot = act.slots[0]
    sc.frame_set(int(frame))


def actions_of(rig):
    return [tr.name for tr in rig.animation_data.nla_tracks]


def first_clip(rig, pref=("idle", "stand", "graze", "glide")):
    acts = actions_of(rig)
    for p in pref:
        n = f"{rig.name}.{p}"
        if n in acts:
            return n
    return acts[0]


def clone(rig, name):
    """A second copy of an animal (armature + mesh) with its own animation."""
    r2 = rig.copy()
    r2.data = rig.data
    r2.name = name
    sc.collection.objects.link(r2)
    r2.animation_data_clear()
    r2.animation_data_create()
    m = MESH[rig.name]
    m2 = m.copy()
    m2.name = name + "_mesh"
    sc.collection.objects.link(m2)
    m2.parent = r2
    for md in m2.modifiers:
        if md.type == "ARMATURE":
            md.object = r2
    m2.hide_render = False
    r2.hide_render = False
    return r2


# ------------------------------------------------------------------ views

def turn(a):
    show_only([a.name])
    world((0.50, 0.56, 0.64), 0.9)
    sun((0.5, -0.8, 0.9), 3.5, (1.0, 0.92, 0.82))
    plane("rv_ground", 40, material("rv_grey", (0.35, 0.33, 0.30)))
    set_action(a, first_clip(a, ("idle", "stand", "glide")), 1)
    if a.name == "eagle":
        set_action(a, "eagle.stare" if "eagle.stare" in actions_of(a) else "eagle.land", 200)
    H = SIZE[a.name]
    c = camera(60)
    paths = []
    for vn, az, el in (("front", 0, 12), ("q34", 40, 15), ("side", 90, 8), ("back", 180, 12), ("q34b", 220, 25)):
        r = H * 2.4
        aa, e = math.radians(az), math.radians(el)
        tgt = Vector((0, 0.0, H * 0.5))
        pos = tgt + Vector((math.sin(aa) * math.cos(e), -math.cos(aa) * math.cos(e), math.sin(e))) * r
        look(c, pos, tgt)
        paths.append(render(os.path.join(TMP, f"{a.name}_{vn}.png"), 640, 640, 24))
    sheet(paths, 5, os.path.join(OUT, f"{a.name}_turn.png"))
    if a.name == "eagle":
        set_action(a, "eagle.glide", 1)
        a.location = (0, 0, 0.3)
        paths = []
        for vn, pos in (("below", (0.6, -0.8, -2.2)), ("above", (0.4, 0.6, 3.0)), ("front", (0, -3.2, 0.9))):
            look(c, pos, (0, 0, 0.6))
            paths.append(render(os.path.join(TMP, f"eagle_glide_{vn}.png"), 800, 640, 24))
        a.location = (0, 0, 0)
        sheet(paths, 3, os.path.join(OUT, "eagle_turn_glide.png"))


def close(a):
    show_only([a.name])
    world((0.45, 0.55, 0.70), 0.8)
    plane("rv_ground", 40, material("rv_grass", None, 0.95, (40, (0.10, 0.16, 0.05), (0.20, 0.26, 0.08))))
    c = camera(85)
    pb = a.pose.bones
    if a.name == "cow":
        c.data.lens = 55
        set_action(a, "cow.idle", 1)
        head = a.matrix_world @ pb["head"].head
        tgt = head + Vector((0, -0.25, -0.12))
        sun_from(tgt + Vector((0.3, -1.4, 0.2)), tgt, 12, -35, 4.0)
        paths = []
        for vn, off in (("front", (0.0, -1.7, 0.15)), ("q34", (1.15, -1.25, 0.2)), ("side", (1.7, -0.1, 0.08))):
            look(c, tgt + Vector(off), tgt)
            paths.append(render(os.path.join(TMP, f"cow_face_{vn}.png"), 800, 800, 48))
        bell = a.matrix_world @ pb["cow.bell"].head
        look(c, bell + Vector((0.62, -0.12, -0.02)), bell + Vector((0, 0.0, -0.06)))
        paths.append(render(os.path.join(TMP, "cow_bell.png"), 800, 800, 48))
        sheet(paths, 4, os.path.join(OUT, "cow_close.png"))
    elif a.name == "eagle":
        last = "eagle.stare" if "eagle.stare" in actions_of(a) else "eagle.land"
        set_action(a, last, 1 if last == "eagle.stare" else bpy.data.actions[last].frame_range[1])
        head = a.matrix_world @ pb["head"].head
        tgt = head + Vector((0, -0.04, 0.0))
        paths = []
        for vn, off in (("front", (0.0, -1.0, 0.02)), ("q34", (0.65, -0.75, 0.05)), ("side", (1.0, -0.05, 0.02)), ("low", (0.3, -0.9, -0.25))):
            sun_from(tgt + Vector(off), tgt, 10, -35, 4.5)
            look(c, tgt + Vector(off), tgt)
            paths.append(render(os.path.join(TMP, f"eagle_head_{vn}.png"), 800, 800, 64))
        sheet(paths, 4, os.path.join(OUT, "eagle_close.png"))
    else:
        set_action(a, first_clip(a), 1)
        head = a.matrix_world @ pb["head"].tail
        tgt = head + Vector((0, 0.08, 0.0))
        paths = []
        for vn, off in (("front", (0.0, -0.9, 0.08)), ("q34", (0.6, -0.65, 0.1)), ("side", (0.9, 0.0, 0.05))):
            sun_from(tgt + Vector(off), tgt, 12, -35, 4.0)
            look(c, tgt + Vector(off), tgt)
            paths.append(render(os.path.join(TMP, f"{a.name}_face_{vn}.png"), 700, 700, 48))
        sheet(paths, 3, os.path.join(OUT, f"{a.name}_close.png"))


def clips(a):
    show_only([a.name])
    world((0.50, 0.56, 0.64), 0.9)
    sun((0.5, -0.8, 0.9), 3.5, (1.0, 0.92, 0.82))
    plane("rv_ground", 60, material("rv_grey", (0.35, 0.33, 0.30)))
    H = SIZE[a.name]
    c = camera(50)
    for name in actions_of(a):
        if CLIPS and name not in CLIPS:
            continue
        act = bpy.data.actions[name]
        f0, f1 = act.frame_range
        fr = sorted(set(int(round(f0 + i * (f1 - f0) / (NF - 1))) for i in range(NF)))
        paths = []
        flying = a.name == "eagle" and name in ("eagle.glide", "eagle.flap")
        for row, (az, el) in enumerate(((90, 6), (35, 22))):
            for f in fr:
                set_action(a, name, f)
                a.location = (0, 0, 1.2 if flying else 0)
                r = H * (2.7 if not flying else 3.6)
                aa, e = math.radians(az), math.radians(el)
                tgt = Vector((0, 0.0, H * 0.45 + (1.2 if flying else 0)))
                look(c, tgt + Vector((math.sin(aa) * math.cos(e), -math.cos(aa) * math.cos(e), math.sin(e))) * r, tgt)
                paths.append(render(os.path.join(TMP, f"{name}_{row}_{f:03d}.png"), 400, 320, 16))
        a.location = (0, 0, 0)
        sheet(paths, len(fr), os.path.join(OUT, f"clip_{name}.png"))


def scope():
    """The 6x scope's view (vertical FOV 7.5 deg) at dawn."""
    world((0.36, 0.50, 0.74), 0.9)
    grass = material("rv_grass", None, 0.95, (0.35, (0.07, 0.12, 0.035), (0.16, 0.22, 0.07)))
    rock = material("rv_rock", None, 0.9, (0.9, (0.26, 0.26, 0.27), (0.46, 0.45, 0.44)), bump=0.6)
    c = camera(fov_v=7.5, clip_end=5000)
    names = [a.name for a in ANIMALS]
    if "cow" in names or "sheep" in names:
        clear()
        show_only([])
        plane("rv_ground", 3000, grass)
        cam = Vector((0, -250, 60))
        clones = []
        if "cow" in names:
            cow = next(a for a in ANIMALS if a.name == "cow")
            spots = [((-7, 2), 20, "cow.graze", 10), ((-2, -3), -60, "cow.graze", 90), ((3, 1), 160, "cow.walk", 12),
                     ((8, -2), 90, "cow.idle", 40), ((12, 4), 200, "cow.look_up", 60)]
            for i, ((x, y), yaw, clip, f) in enumerate(spots):
                r = clone(cow, f"rv_cow{i}")
                r.location = (x, y, 0)
                r.rotation_euler = (0, 0, math.radians(yaw))
                set_action(r, clip, f)
                clones.append(r)
        look(c, cam, (2.5, 0, 1.0))
        sun_from(cam, (0, 0, 0), 9, -35, 4.5)
        render(os.path.join(OUT, "scope_cows_250m.png"), 2560 if not FAST else 1280, 1440 if not FAST else 720, 32)
        # the siren: every cow turns to look at the player
        for r in clones:
            set_action(r, "cow.look_up", 54)
            d = cam - r.location
            r.rotation_euler = (0, 0, math.atan2(d.x, -d.y))
        sc.frame_set(54)
        render(os.path.join(OUT, "scope_cows_siren.png"), 2560 if not FAST else 1280, 1440 if not FAST else 720, 32)
        clear()
    if "sheep" in names:
        sheep = next(a for a in ANIMALS if a.name == "sheep")
        plane("rv_ground", 3000, grass, (0, 700, 0), (math.radians(-18), 0, 0))
        clones = []
        rng = np.random.default_rng(3)
        for i in range(9):
            x, y = rng.uniform(-14, 14), rng.uniform(-8, 8)
            z = (y) * math.tan(math.radians(18))
            r = clone(sheep, f"rv_sheep{i}")
            r.location = (x, 700 + y, z)
            r.rotation_euler = (0, 0, rng.uniform(0, 6.28))
            set_action(r, "sheep.graze" if i % 3 else "sheep.walk", int(rng.integers(1, 60)))
        cam = Vector((0, 0, 60))
        look(c, cam, (0, 700, 1.0))
        sun_from(cam, (0, 700, 0), 9, -35, 4.5)
        render(os.path.join(OUT, "scope_sheep_700m.png"), 2560 if not FAST else 1280, 1440 if not FAST else 720, 32)
        clear()
    if "goat" in names:
        goat = next(a for a in ANIMALS if a.name == "goat")
        # a grey rock face at 600 m with a ledge; the goat stands on the ledge
        plane("rv_ground", 3000, grass)
        cliff = plane("rv_cliff", 200, rock, (0, 612, 100), (math.radians(80), 0, 0))
        ledge = plane("rv_ledge", 6, rock, (0, 600.6, 80), (0, 0, 0))
        g = clone(goat, "rv_goat")
        g.location = (0, 600.3, 80)
        g.rotation_euler = (0, 0, math.radians(70))
        set_action(g, "goat.stand", 20)
        cam = Vector((0, 0, 60))
        look(c, cam, (0, 600, 80.6))
        sun_from(cam, (0, 600, 80), 9, -35, 4.5)
        render(os.path.join(OUT, "scope_goat_600m.png"), 2560 if not FAST else 1280, 1440 if not FAST else 720, 32)
        clear()
    if "eagle" in names:
        eagle = next(a for a in ANIMALS if a.name == "eagle")
        show_only([])
        plane("rv_ground", 400, grass, (0, 0, -0.2))
        me = bpy.data.meshes.new("rv_rock")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.5)
        for v in bm.verts:
            v.co.x *= 1.4
            v.co.z *= 0.55
            n = math.sin(v.co.x * 9) * 0.03 + math.sin(v.co.y * 11 + 1) * 0.03
            v.co += v.co.normalized() * n
        bm.to_mesh(me)
        bm.free()
        rk = bpy.data.objects.new("rv_rock", me)
        sc.collection.objects.link(rk)
        rk.data.materials.append(rock)
        rk.location = (0, 0, 0.02 - 0.275)
        for p in me.polygons:
            p.use_smooth = True
        e = clone(eagle, "rv_eagle")
        e.location = (0, 0, 0.0)
        e.rotation_euler = (0, 0, 0)
        last = "eagle.stare" if "eagle.stare" in actions_of(eagle) else "eagle.land"
        set_action(e, last, 1 if last == "eagle.stare" else bpy.data.actions[last].frame_range[1])
        cam = Vector((0.0, -2.5, 0.28))
        look(c, cam, (0, 0, 0.42))
        sun_from(cam, (0, 0, 0), 10, -35, 4.5)
        render(os.path.join(OUT, "scope_eagle_2m5.png"), 2560 if not FAST else 1280, 1440 if not FAST else 720, 64)
        c = camera(fov_v=45, clip_end=5000)
        look(c, cam, (0, 0, 0.35))
        render(os.path.join(OUT, "wide_eagle_2m5.png"), 1920 if not FAST else 960, 1080 if not FAST else 540, 32)
        clear()


for a in ANIMALS:
    if "turn" in WHAT:
        turn(a)
        clear()
    if "close" in WHAT:
        close(a)
        clear()
    if "clips" in WHAT:
        clips(a)
        clear()
if "scope" in WHAT:
    scope()
print("[review] done", flush=True)
