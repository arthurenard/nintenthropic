"""
icon.png: Grip Prix's app icon. Mango in her red kart, three-quarter front, on a vivid sky-to-meadow gradient.
Full-bleed square with no rounded corners (the OS masks it); the kart is centred with a margin so a squircle mask keeps it whole.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import kit
import world as W
import fx
import shots
from shots import DEG, dir_of, make_camera, project, reset
from kit import hexl, PLAYER_COLOURS

P = dict(
    heading=160.0, cam_phi=15.0, cam_dist=9.2, cam_h=1.05, lens=70.0, look=(0.0, 0.0, 0.78), shift=(0.04, 0.04),
    exposure=0.2, sun_az_rel=140.0, sun_el=44.0, sun_energy=6.0, sun_colour="#fff0d0",
    haze=0.007, sparks=60,
)


def build(res=(1024, 1024), samples=256, preview=False, **over):
    p = dict(P, **over)
    scene = reset()
    kit.setup_cycles(scene, res[0], res[1], samples, exposure=p["exposure"])

    # the kart, drifting a little: front wheels turned, the driver looking at us
    pose = dict(steer=-0.55, lean=-0.14, slide=0.12, roll=0.035, head_yaw=-0.32, head_pitch=0.03, spin=0.5)
    hero, parts = kit.build_kart("mango", PLAYER_COLOURS[0], "mango", pose)
    hd = (math.sin(p["heading"] * DEG), math.cos(p["heading"] * DEG))
    kit.place(hero, Vector((0, 0, 0)), hd)
    bpy.context.view_layer.update()

    nose = Vector((hd[0], hd[1], 0.0))
    cam_dir = Matrix.Rotation(-p["cam_phi"] * DEG, 3, "Z") @ nose
    cam_loc = Vector((cam_dir.x * p["cam_dist"], cam_dir.y * p["cam_dist"], p["cam_h"]))
    target = Vector(p["look"])
    cam = make_camera(scene, cam_loc, target, lens=p["lens"], fstop=5.6, focus=(Vector((0, 0, 0.9)) - cam_loc).length, shift=p["shift"])
    cam_az = math.degrees(math.atan2((target - cam_loc).x, (target - cam_loc).y))

    # sky: the game's own meadow blues, deeper at the top; a warm sun from the upper left
    sun_dir = shots.sky_for(scene, cam_az + p["sun_az_rel"], p["sun_el"], sun_energy=p["sun_energy"], sun_colour=p["sun_colour"], fog_density=0.0,
                            zenith="#0f55d6", mid="#45a6f7", horizon="#fff0c6")
    # a soft sun in the corner and a few clouds
    W.sun_disc(scene, dir_of(cam_az - 26, 24), radius_deg=1.6)
    cm = W.cloud_material(sun_dir)
    rng = np.random.default_rng(2)
    for i, (rel, el, dist, size) in enumerate(((-12, 19, 600, 120), (20, 15, 700, 150), (-30, 11, 800, 140))):
        d = dir_of(cam_az + rel, el) * dist
        W.cloud(f"cloud{i}", (cam_loc.x + d.x, cam_loc.y + d.y, d.z), size, rng, cm)

    # the meadow: one big plane with mowing stripes, bright and saturated, fading into haze toward the horizon
    bpy.ops.mesh.primitive_plane_add(size=8000.0)
    g = bpy.context.object
    g.name = "meadow"
    m, nt, b = W._mat("meadow.ground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = W._sep(nt, tc.outputs["Object"])
    # broad, soft mowing bands that fan out from the horizon, and a little grain of colour
    r = W._noise(nt, tc.outputs["Object"], 0.05, 2.0, 0.5, 0.4)
    col = W._mix(nt, hexl("#86e04f")[:3], hexl("#5fc83d")[:3], W._math(nt, "MULTIPLY", W._math(nt, "SUBTRACT", r, 0.35), 2.5, clamp=True))
    nt.links.new(col, b.inputs["Base Color"])
    kit._set(b, rough=0.8, sheen=0.2)
    g.data.materials.append(m)
    if p["haze"]:
        W.add_haze(p["haze"], "#fff0c6")

    if p["sparks"]:
        back = -nose
        fw = hero.matrix_world
        rng2 = np.random.default_rng(9)
        fx.sparks(lambda i: fw @ Vector(kit.gp(((1 if i % 2 else -1) * 0.95, 0.04, -0.84))), p["sparks"], rng2, speed_dir=Vector((back.x, back.y, 0.1)), spread=0.5, reach=2.6, length=(0.15, 0.5), thickness=0.012)

    # frame report: where the kart's extremes land (0..1), to centre it and keep it inside the squircle's safe area
    pts = [(1.2, 0.0, -1.7), (-1.2, 0.0, -1.7), (1.2, 0.0, 1.95), (-1.2, 0.0, 1.95), (0.0, 2.1, -0.3), (0.0, 0.0, 2.0)]
    proj = [project(scene, cam, hero.matrix_world @ Vector(kit.gp(q))) for q in pts]
    xs, ys = [q[0] for q in proj], [q[1] for q in proj]
    print("kart box x", round(min(xs), 3), round(max(xs), 3), "y", round(min(ys), 3), round(max(ys), 3))
    info = dict(cam=cam, post={})
    return scene, None, cam, info
