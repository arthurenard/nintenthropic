"""
The pack shot: Mango leads in a drift through the bend below the windmill hill with her rivals on her tail. A low camera beside
the road, a wide lens, shallow depth of field, motion blur. poster.webp is this shot; the title screen (shot_title.py) is the
same stage with another cast, camera and a calm left side.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import kit
import world as W
import fx
import shots
from shots import DEG, Meadow, Visible, dir_of, kart_on_road, make_camera, project, reset
from kit import PLAYER_COLOURS, gp

P = dict(
    s_hero=522.0, u_hero=1.0, width=11.5,
    cam_dist=6.4, cam_phi=21.0, cam_h=1.3, lens=21.0, aim_up=-0.05, aim_side=1.8, cam_roll=-3.5, aim_back=0.0, shift=(0.0, 0.04),
    sun_rel_az=-58.0, sun_el=40.0, disc_rel_az=-27.0, disc_el=19.0, exposure=0.18, sun_energy=6.2, sun_colour="#ffe0b0",
    windmill_rel_az=-16.0, windmill_dist=165.0, windmill_scale=1.6,
    fstop=0.9, motion=True, haze=0.0016, speed=26.0, shutter=0.5,
    tree_scale=0.62, bush_scale=0.42, flower_scale=0.55, trees=120, bushes=34, flowers=100, calm_x=None,
    hero=dict(steer=-0.85, lean=-0.2, slide=0.14, roll=0.04, pitch=0.01, head_yaw=-0.32, head_pitch=0.04),
    cast=[
        # name, colour, character, ds (metres along the road from the hero; negative = behind), u, heading offset, pose
        ("bun", PLAYER_COLOURS[3], "bun", -7.0, -3.9, 0.10, dict(steer=-0.4, lean=-0.1, slide=0.05, head_yaw=-0.1)),
        ("pepper", PLAYER_COLOURS[1], "pepper", -9.5, 3.9, 0.16, dict(steer=-0.5, lean=-0.1, slide=0.06, head_yaw=-0.1)),
        ("moss", PLAYER_COLOURS[2], "moss", -15.0, -1.3, 0.08, dict(steer=-0.3, lean=-0.08)),
    ],
    # rel az from the camera's view axis, elevation, distance, size
    sky=[(-14, 40, 650, 190), (22, 34, 800, 240), (-6, 13, 1100, 300), (40, 18, 700, 150), (-46, 14, 900, 170), (8, 50, 650, 150), (30, 52, 700, 120)],
    balloon=(12, 17, 360),
    boxes=[(-0.4, (-3.7,)), (-72.0, (-3.2, 0.4, 3.9))],
    sparks=120, skids=False,
)


def animate_blur(scene, movers, bases, delta, spins, shutter):
    """Motion blur: frame 1 -> 2 the camera and the karts travel `delta` together (so they stay sharp and the world streaks)
    while every wheel turns by its own angle. `movers` are root objects; `spins` is [(parts, steer, spin0, spin_per_frame)]."""
    scene.frame_start, scene.frame_end = 1, 2
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = shutter
    try:
        scene.cycles.motion_blur_position = "START"
    except Exception:
        pass
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    for frame in (1, 2):
        scene.frame_set(frame)
        k = frame - 1
        for o in movers:
            o.matrix_basis = Matrix.Translation(delta * k) @ bases[o.name]
            kit.keyframe_matrix(o, frame)
        for parts, steer, s0, ds in spins:
            kit.set_wheel_spin(parts, s0 + ds * k, steer)
            for key in ("hub.fL", "hub.fR", "hub.rL", "hub.rR"):
                kit.keyframe_matrix(parts[key], frame)
    scene.frame_set(1)


def build(res=(1600, 900), samples=160, preview=False, **over):
    p = dict(P, **over)
    scene = reset()
    kit.setup_cycles(scene, res[0], res[1], samples, exposure=p["exposure"])
    rng = np.random.default_rng(5)
    m = Meadow(width=p["width"])
    road = m.road

    # ── the karts ──
    hero, hparts, hpos = kart_on_road(m, "mango", p["s_hero"], p["u_hero"], PLAYER_COLOURS[0], "mango", 0.30, p["hero"])
    packs = []
    for name, col, ch, ds, u, off, pose in p["cast"]:
        packs.append(kart_on_road(m, name, p["s_hero"] + ds, u, col, ch, off, pose))
    bpy.context.view_layer.update()

    # ── the camera: on the hero's right-front, low, looking up a little ──
    nose = Vector((-hero.matrix_basis[0][1], -hero.matrix_basis[1][1], 0.0)).normalized()
    cam_dir = Matrix.Rotation(-p["cam_phi"] * DEG, 3, "Z") @ nose
    cam_xy = Vector(hpos[:2]) + cam_dir.xy * p["cam_dist"]
    cam_z = max(m.ground(cam_xy.x, cam_xy.y), hpos.z) + p["cam_h"]
    cam_loc = Vector((cam_xy.x, cam_xy.y, cam_z))
    head = hpos + Vector((0, 0, 1.45))
    fwd = (head - cam_loc).normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    aim = head - right * p["aim_side"] + Vector((0, 0, p["aim_up"])) + fwd * p["aim_back"]
    cam = make_camera(scene, cam_loc, aim, lens=p["lens"], fstop=p["fstop"], focus=(head - cam_loc).length, roll=p["cam_roll"] * DEG, shift=p["shift"])
    cam_az = math.degrees(math.atan2((aim - cam_loc).x, (aim - cam_loc).y))
    hfov = 2 * math.degrees(math.atan(18.0 / p["lens"]))

    # ── sky: the lamp from the camera's left, the disc in the frame's corner ──
    sun_dir = shots.sky_for(scene, cam_az + p["sun_rel_az"], p["sun_el"], fog_density=0.0, sun_energy=p["sun_energy"], sun_colour=p["sun_colour"])
    disc = dir_of(cam_az + p["disc_rel_az"], p["disc_el"])
    W.sun_disc(scene, disc)
    sx, sy, _ = project(scene, cam, cam_loc + disc * 3000.0)

    # the windmill's hill: ahead of the camera, beside the karts
    wa = dir_of(cam_az + p["windmill_rel_az"], 0) * p["windmill_dist"]
    windmill_at = (cam_loc.x + wa.x, cam_loc.y + wa.y)
    m.finish(shots.HILLS + [(windmill_at[0], windmill_at[1], 46, 15)])

    # ── the world ──
    vis = Visible(cam, res, min_x=p["calm_x"])
    shots.dress_meadow(m, rng, vis, cam_loc, cam_az, hfov, windmill_at=windmill_at, trees=p["trees"], flowers=p["flowers"], bushes=p["bushes"],
                       tree_scale=p["tree_scale"], bush_scale=p["bush_scale"], flower_scale=p["flower_scale"], windmill_scale=p["windmill_scale"])
    cm = W.cloud_material(sun_dir)
    for i, (rel, el, dist, size) in enumerate(p["sky"]):
        d = dir_of(cam_az + rel, el) * dist
        W.cloud(f"cloud{i}", (cam_loc.x + d.x, cam_loc.y + d.y, cam_loc.z + d.z), size, rng, cm)
    if p["balloon"]:
        rel, el, dist = p["balloon"]
        d = dir_of(cam_az + rel, el) * dist
        W.landmark("hot-air-balloon", (cam_loc.x + d.x, cam_loc.y + d.y, cam_loc.z + d.z - 32), 0.6, 1.0, spin={"balloon.envelope.spin.y": 0.5})
    for ds, us in p["boxes"]:  # item boxes in rows across the road, floating 1.25 m up (the game's BOX_LIFT)
        for u in us:
            pos = road.point(p["s_hero"] + ds, u, 1.25)
            toward = cam_loc - pos  # turn a "?" to face the lens, a little askew
            W.item_box(pos, yaw=math.atan2(toward.x, -toward.y) + rng.uniform(-0.75, 0.75))

    # ── effects on the hero ──
    fx.exhaust_flames(hparts, "hero", scale=1.35)
    fx_world = hero.matrix_world

    def rear_contact(i):
        side = 1 if i % 2 == 0 else -1
        return fx_world @ Vector(gp((side * 0.95, 0.04, -0.84)))

    back = -nose
    if p["sparks"]:
        fx.sparks(rear_contact, p["sparks"], rng, speed_dir=Vector((back.x, back.y, 0.1)), spread=0.5, reach=3.8, length=(0.2, 0.7), thickness=0.013)
    sm = fx.smoke_material()
    out = Vector((nose.y, -nose.x, 0.0))  # to the kart's right (the outside of a left drift)
    for i in range(5):
        t = i / 4
        c = Vector(hpos) + back * (3.4 + t * 4.2) + out * (1.2 + t * 1.6) + Vector((0, 0, 0.2 + t * 0.55)) + Vector((rng.normal(0, 0.2), rng.normal(0, 0.2), 0))
        fx.puff(f"smoke{i}", c, 0.3 + t * 0.55, sm, rng)
    if p["skids"]:
        sk = fx.skid_material()
        ss = np.linspace(p["s_hero"] - 34, p["s_hero"] - 0.5, 48)
        for du in (-0.95, 0.95):
            pts = [tuple(road.point(s, p["u_hero"] + du + (p["s_hero"] - s) * -0.03, 0.0)) for s in ss]
            fx.ground_ribbon(pts, 0.55, sk, lift=0.03)

    # ── motion: the camera rides with the karts; the world streaks past ──
    if p["motion"]:
        tan = Vector((road.t[int(p["s_hero"])][0], road.t[int(p["s_hero"])][1], 0.0)).normalized()
        delta = tan * p["speed"] * p["shutter"] / 25.0
        movers = [cam, hero] + [k[0] for k in packs]
        bases = {o.name: o.matrix_basis.copy() for o in movers}
        spins = [(hparts, -0.85, 0.0, 1.5)] + [(k[1], -0.4, 0.0, 1.3) for k in packs]
        animate_blur(scene, movers, bases, delta, spins, 1.0)

    if p["haze"]:
        W.add_haze(p["haze"], "#cfe6ff")

    info = dict(cam=cam, hero=hero, hpos=hpos, packs=packs, cam_az=cam_az, head=head, post=dict(sun=[sx, sy], sun_strength=0.42))
    print("proj head", project(scene, cam, head), "pack", [project(scene, cam, k[2]) for k in packs], "windmill", project(scene, cam, Vector((windmill_at[0], windmill_at[1], 25))), "sun", (sx, sy))
    return scene, m, cam, info
