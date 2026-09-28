"""Review renders of public/assets/ridge/vehicles.glb (the exported asset, not
the build scene: what is judged here is what the game loads).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -t 4 \\
        -P art/ridge/vehicles/review.py -- [--views turn,close,scope,seat] [--only truck] [--quick]

turn    daylight turnarounds: front, 3/4 front, side, 3/4 rear, back, top
close   close-ups: cab and windshield, grille, wheels, canvas, interior
scope   the player's 6x scope at dawn: camera 60 m up, the vehicle at 300 m
        and 900 m, vertical field of view 7.5 deg, 2560x1440; low warm sun from
        behind the camera and to its left, blue sky fill (and one in the
        valley's blue shadow)
seat    a driver proxy built to the contract's numbers (pelvis 0.42 m up,
        feet 0.45 m ahead, hands on the rim) in every seat, from the side
Renders go to art/ridge/build/review/vehicles/ (gitignored).
"""

import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
RIDGE = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(RIDGE, "..", ".."))
OUT = os.path.join(RIDGE, "build", "review", "vehicles")
GLB = os.path.join(REPO, "public", "assets", "ridge", "vehicles.glb")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


VIEWS = arg("--views", "turn,close,scope,seat").split(",")
ONLY = arg("--only")
QUICK = "--quick" in argv
TAG = arg("--tag", "")


def lin(r, g, b):
    def c(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (c(r), c(g), c(b))


# ---------------------------------------------------------------------------
# scene

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != 'CPU'
    sc.cycles.device = 'GPU'
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.view_settings.view_transform = 'AgX'
    sc.render.film_transparent = False
    bpy.ops.import_scene.gltf(filepath=GLB)
    roots = {n: bpy.data.objects[n] for n in ("truck", "jeep") if n in bpy.data.objects}
    return sc, roots


def ground():
    """A meadow with a dirt road along X through the origin."""
    me = bpy.data.meshes.new("ground")
    s = 4000.0
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    tc = N('ShaderNodeTexCoord')
    geo = N('ShaderNodeNewGeometry')
    sep = N('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    n1 = N('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 0.35
    n1.inputs['Detail'].default_value = 8
    nt.links.new(geo.outputs['Position'], n1.inputs['Vector'])
    n2 = N('ShaderNodeTexNoise')
    n2.inputs['Scale'].default_value = 6.0
    n2.inputs['Detail'].default_value = 6
    nt.links.new(geo.outputs['Position'], n2.inputs['Vector'])
    grass = N('ShaderNodeValToRGB')
    grass.color_ramp.elements[0].color = (*lin(58, 66, 34), 1)
    grass.color_ramp.elements[1].color = (*lin(96, 98, 56), 1)
    nt.links.new(n1.outputs[0], grass.inputs[0])
    mixg = N('ShaderNodeMix')
    mixg.data_type = 'RGBA'
    mixg.blend_type = 'MULTIPLY'
    mixg.inputs['Factor'].default_value = 0.35
    nt.links.new(grass.outputs[0], mixg.inputs['A'])
    nt.links.new(n2.outputs['Color'], mixg.inputs['B'])
    # the road: |y| < 2.6 m around the road axis (the vehicle's own frame is placed on it)
    ab = N('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs['Y'], ab.inputs[0])
    wob = N('ShaderNodeMath')
    wob.operation = 'MULTIPLY_ADD'
    nt.links.new(n2.outputs[0], wob.inputs[0])
    wob.inputs[1].default_value = 0.6
    nt.links.new(ab.outputs[0], wob.inputs[2])
    road = N('ShaderNodeMapRange')
    road.interpolation_type = 'SMOOTHSTEP'
    road.inputs['From Min'].default_value = 3.2
    road.inputs['From Max'].default_value = 2.6
    nt.links.new(wob.outputs[0], road.inputs['Value'])
    dirt = N('ShaderNodeValToRGB')
    dirt.color_ramp.elements[0].color = (*lin(96, 86, 70), 1)
    dirt.color_ramp.elements[1].color = (*lin(138, 126, 104), 1)
    nt.links.new(n2.outputs[0], dirt.inputs[0])
    mix = N('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(road.outputs[0], mix.inputs['Factor'])
    nt.links.new(mixg.outputs['Result'], mix.inputs['A'])
    nt.links.new(dirt.outputs[0], mix.inputs['B'])
    b = N('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = 0.95
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    out = N('ShaderNodeOutputMaterial')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    me.materials.append(m)
    return ob


def light(kind, cam_dir=Vector((0, 1, 0))):
    """kind: 'day' (high sun, neutral), 'dawn' (low warm sun from behind the
    camera and to its left, blue sky fill), 'shadow' (sky only, the valley
    floor before the sun reaches it)."""
    sc = bpy.context.scene
    for o in list(sc.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o)
    w = bpy.data.worlds.get("sky") or bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(ramp.outputs[0], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    # Generated Z of the world runs 0 (down) .. 1 (up); 0.5 is the horizon
    e = ramp.color_ramp.elements
    if kind == 'day':
        e[0].position, e[0].color = 0.5, (0.62, 0.70, 0.82, 1)
        e[1].position, e[1].color = 1.0, (0.20, 0.38, 0.78, 1)
        bg.inputs['Strength'].default_value = 1.1
        sun_dir, sun_col, sun_str = (-0.55, -0.35, -0.76), (1.0, 0.95, 0.88), 4.2
    else:
        e[0].position, e[0].color = 0.5, (0.62, 0.66, 0.78, 1)
        e[1].position, e[1].color = 1.0, (0.24, 0.40, 0.78, 1)
        bg.inputs['Strength'].default_value = 0.9
        # light travels away from the camera, to its right, and slightly down
        d = Vector(cam_dir).normalized()
        right = d.cross(Vector((0, 0, 1))).normalized()
        sd = (d * 0.85 + right * 0.5)
        sd.z = -0.13
        sun_dir, sun_col, sun_str = tuple(sd.normalized()), (1.0, 0.64, 0.40), 4.5
    if kind != 'shadow':
        ld = bpy.data.lights.new("sun", 'SUN')
        ld.energy = sun_str
        ld.color = sun_col
        ld.angle = math.radians(0.6)
        lo = bpy.data.objects.new("sun", ld)
        sc.collection.objects.link(lo)
        lo.rotation_euler = Vector(sun_dir).to_track_quat('-Z', 'Y').to_euler()
    sc.view_settings.exposure = 0.0 if kind != 'shadow' else 0.8


def camera(loc, target, lens=50.0, vfov=None, res=(1600, 1000)):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cd = cam.data
    cd.clip_start = 0.05
    cd.clip_end = 10000
    sc.render.resolution_x, sc.render.resolution_y = res
    if vfov is not None:
        cd.sensor_fit = 'VERTICAL'
        cd.sensor_height = 24.0
        cd.lens = 12.0 / math.tan(math.radians(vfov) / 2)
    else:
        cd.sensor_fit = 'AUTO'
        cd.lens = lens
    return cam


def render(name, samples):
    sc = bpy.context.scene
    sc.cycles.samples = max(8, samples // (4 if QUICK else 1))
    if QUICK:
        sc.render.resolution_percentage = 50
    sc.render.filepath = os.path.join(OUT, f"{TAG}{name}.png")
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"[review] {name} in {time.time() - t:.1f}s", flush=True)


ALL = {}


def show_only(roots, keep):
    for n, r in ALL.items():
        vis = n == keep
        for o in [r] + list(r.children_recursive):
            o.hide_render = not vis
    for o in bpy.context.scene.objects:
        if o.name.startswith("proxy.") and o.get("vehicle") and o["vehicle"] != keep:
            o.hide_render = True
        elif o.name.startswith("proxy."):
            o.hide_render = False


def place(root, loc=(0, 0, 0), yaw=0.0):
    root.location = Vector(loc)
    root.rotation_mode = 'XYZ'          # the glTF importer leaves quaternions
    root.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()


def child(root, name):
    """A contract node under root. Blender renames the jeep's copies on import
    (wheel.1 becomes wheel.007), so wheels are found by their extras."""
    if name.startswith("wheel."):
        n = int(name.split(".")[1])
        ws = sorted((o for o in root.children_recursive if "radius" in o.keys()),
                    key=lambda o: (round(o.matrix_world.translation.y, 2), -o.matrix_world.translation.x))
        return ws[n - 1] if n <= len(ws) else None
    for o in root.children_recursive:
        if o.name == name or o.name.startswith(name + "."):
            return o
    return None


def bbox_centre(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(pts, Vector()) / 8


# ---------------------------------------------------------------------------
# a seated figure built to the contract's numbers (not exported)

def driver_proxy(seat, vname):
    """In the seat's frame (forward = local -Y, up = +Z): pelvis 0.42 m up
    and 0.02 m back, feet 0.45 m ahead on the floor, hands on the rim of the
    wheel whose centre is 0.80 up and 0.38 ahead."""
    sys.path.insert(0, RIDGE)
    from vehicles.geo import Builder
    b = Builder(f"proxy.{vname}.{seat.name}", "proxy", pre=None)
    F = lambda f, u, l=0.0: (l, -f, u)
    for l in (-0.1, 0.1):
        b.cyl(F(-0.02, 0.42, l), F(0.40, 0.46, l * 1.1), 0.075, 8, "cloth")
        b.cyl(F(0.40, 0.46, l * 1.1), F(0.45, 0.10, l * 1.1), 0.055, 8, "cloth")
        b.box((l * 1.1 - 0.05, -(0.45 + 0.20), 0.0), (l * 1.1 + 0.05, -(0.45 - 0.04), 0.09), "boot")
    b.box((-0.17, 0.02 - 0.11, 0.33), (0.17, 0.02 + 0.13, 0.55), "cloth")
    b.cyl(F(-0.03, 0.50), F(-0.02, 0.95), 0.155, 10, "cloth")
    b.cyl(F(-0.02, 0.95), F(-0.01, 1.03), 0.05, 8, "skin")
    b.revolve([(-0.11, 0.0), (-0.08, 0.075), (0.0, 0.105), (0.08, 0.075), (0.11, 0.0)], 12, "skin",
              M=Matrix.Translation(F(0.0, 1.13)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    b.revolve([(0.0, 0.14), (0.06, 0.125), (0.11, 0.07), (0.13, 0.0)], 12, "helmet",
              M=Matrix.Translation(F(-0.01, 1.14)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y'))
    for l in (-1, 1):
        sh = F(-0.02, 0.92, l * 0.21)
        hand = F(0.36, 0.84, l * 0.18)
        el = F(0.16, 0.70, l * 0.26)
        b.cyl(sh, el, 0.05, 8, "cloth")
        b.cyl(el, hand, 0.042, 8, "cloth")
    ob = b.build(bpy.context.scene.collection, smooth_angle=60)
    cols = {"cloth": lin(44, 50, 30), "boot": lin(25, 20, 16), "skin": lin(160, 110, 84), "helmet": lin(52, 58, 36)}
    for m in ob.data.materials:
        k = m.name.split(".", 1)[1]
        m.use_nodes = True
        bs = m.node_tree.nodes.get("Principled BSDF")
        bs.inputs['Base Color'].default_value = (*cols[k], 1)
        bs.inputs['Roughness'].default_value = 0.8
    ob.parent = seat
    ob["vehicle"] = vname
    return ob


def add_drivers(roots):
    for vname, r in roots.items():
        for o in r.children_recursive:
            if o.name.startswith("seat.driver") or o.name.startswith("seat.passenger"):
                driver_proxy(o, vname)


# ---------------------------------------------------------------------------

def turnaround(roots):
    light('day')
    for vname, r in roots.items():
        show_only(roots, vname)
        place(r)
        size = 7.0 if vname == "truck" else 3.5
        h = 1.3 if vname == "truck" else 0.75
        for name, d in (("front", (0.0, -1.0, 0.10)), ("34front", (-0.95, -1.0, 0.42)), ("side", (1.0, 0.0, 0.06)),
                        ("34rear", (1.0, 1.05, 0.45)), ("back", (0.0, 1.0, 0.16)), ("top", (0.0001, 0.0, 1.0))):
            dv = Vector(d).normalized()
            camera(Vector((0, 0, h)) + dv * size * 1.6, (0, 0, h), lens=50)
            render(f"turn_{vname}_{name}", 96)


def closeups(roots):
    light('day')
    for vname, r in roots.items():
        show_only(roots, vname)
        place(r)
        glass = child(r, "cab.glass")
        eng = child(r, "engine")
        w1 = child(r, "wheel.1")
        views = []
        gc = bbox_centre(glass)
        ec = bbox_centre(eng)
        views.append(("cab", gc + Vector((-1.4, -3.4, 0.5)), gc + Vector((0, 0, -0.1)), 45))
        views.append(("grille", ec + Vector((-0.9, -3.2, 0.25)), ec + Vector((0, -0.5, -0.1)), 45))
        views.append(("wheel", w1.matrix_world.translation + Vector((2.2, -0.9, 0.35)), w1.matrix_world.translation, 50))
        if vname == "truck":
            w3 = child(r, "wheel.3")
            can = bbox_centre(child(r, "canvas"))
            views.append(("duals", w3.matrix_world.translation + Vector((2.6, 1.8, 0.6)),
                          w3.matrix_world.translation + Vector((0, -0.4, 0.1)), 40))
            views.append(("canvas", can + Vector((3.4, 4.4, 2.2)), can + Vector((0, 0.6, 0.0)), 35))
            views.append(("rear", can + Vector((0.8, 6.0, -0.2)), can + Vector((0, 1.5, -0.6)), 35))
            views.append(("interior", gc + Vector((-0.3, -1.6, 0.05)), gc + Vector((0.2, 1.0, -0.35)), 28))
        else:
            views.append(("rear", Vector((-1.6, 4.5, 1.6)), Vector((0, 1.4, 0.6)), 40))
            views.append(("interior", Vector((1.2, 1.6, 2.4)), Vector((0, 0.0, 0.7)), 35))
        for name, loc, tgt, lens in views:
            camera(loc, tgt, lens=lens)
            render(f"close_{vname}_{name}", 128)


def scope(roots):
    """Camera 60 m up at the origin looking along +Y; the vehicle on the
    valley floor at 300 m and 900 m, heading across and toward the camera
    (the player sees the windshield) or broadside."""
    for vname, r in roots.items():
        show_only(roots, vname)
        for dist in (300, 900):
            for head, yaw in (("34", 45), ("broad", 90)):
                if dist == 900 and head == "34" and vname == "truck":
                    continue
                target = Vector((0, dist, 1.2 if vname == "truck" else 0.8))
                place(r, (0, dist, 0), yaw)
                cam = Vector((0, 0, 60))
                d = (target - cam)
                kinds = ('dawn', 'shadow') if dist == 300 and head == "34" else ('dawn',)
                for kind in kinds:
                    light(kind, cam_dir=Vector((d.x, d.y, 0)))
                    camera(cam, target, vfov=7.5, res=(2560, 1440))
                    render(f"scope_{vname}_{dist}m_{head}_{kind}", 64)


def seats(roots):
    light('day')
    for vname, r in roots.items():
        show_only(roots, vname)
        place(r)
        glass = child(r, "cab.glass")
        gc = bbox_centre(glass)
        # the driver's side, level with his head, the door window between us
        camera(gc + Vector((5.0, 0.4, 0.2)), gc + Vector((0, 0.4, -0.35)), lens=45)
        render(f"seat_{vname}_side", 96)
        camera(gc + Vector((-1.2, -4.5, 0.6)), gc + Vector((0, 0.3, -0.2)), lens=45)
        render(f"seat_{vname}_front", 96)


def main():
    os.makedirs(OUT, exist_ok=True)
    sc, roots = setup()
    ALL.update(roots)
    if ONLY:
        roots = {ONLY: roots[ONLY]}
    ground()
    add_drivers(roots)
    t = time.time()
    if "turn" in VIEWS:
        turnaround(roots)
    if "close" in VIEWS:
        closeups(roots)
    if "seat" in VIEWS:
        seats(roots)
    if "scope" in VIEWS:
        scope(roots)
    print(f"[review] all in {time.time() - t:.1f}s -> {OUT}", flush=True)


main()
