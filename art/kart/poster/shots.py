"""
The three Blender shots: the poster (1600x900), the title screen's wide shot (2560x1440) and the app icon (1024x1024),
all on the game's meadow circuit with the game's own karts, drivers, trees and windmill. Each `build_*` makes the whole
scene in an empty file and returns the scene; build.py renders it.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

import kit
import world as W
import fx

DEG = math.pi / 180


def az(deg):
    """A horizontal direction by compass azimuth (0 = +y 'north', 90 = +x 'east')."""
    return (math.sin(deg * DEG), math.cos(deg * DEG))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit._lib["loaded"] = False
    W._PROP_MAT.clear()
    fx._cone_cache.clear()
    return bpy.context.scene


def make_camera(scene, loc, target, lens=28.0, roll=0.0, fstop=None, focus=None, sensor=36.0, shift=(0.0, 0.0)):
    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cd = cam.data
    cd.lens = lens
    cd.sensor_width = sensor
    cd.clip_end = 6000.0
    cd.shift_x, cd.shift_y = shift
    if fstop:
        cd.dof.use_dof = True
        cd.dof.aperture_fstop = fstop
        cd.dof.focus_distance = focus if focus is not None else (Vector(target) - Vector(loc)).length
    kit.aim_camera(cam, Vector(loc), Vector(target), roll)
    return cam


def project(scene, cam, p):
    """Where a world point lands in the frame, 0..1 from the top-left (and its distance)."""
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()
    co = world_to_camera_view(scene, cam, Vector(p))
    return round(co.x, 3), round(1 - co.y, 3), round(co.z, 1)


def road_frame(road, s, u):
    c, t, n, b = road.sample(s)
    pos = road.point(s, u)
    slope = math.atan2(road.c[min(int(s) + 1, len(road.s) - 1)][2] - road.c[int(s)][2], 1.0)
    return pos, (t[0], t[1]), (slope, math.atan(b))


# ── The circuit every shot is set on ────────────────────────────────────────

# the road in travel order: far (north-west, climbing toward the windmill's hill) to near, bending left through the corner
ROAD = [(-150, 560, 22), (-104, 420, 16), (-62, 305, 10), (-28, 210, 5.5), (-8, 150, 2.6), (6, 112, 1.0), (22, 82, 0.2), (44, 62, 0.0), (72, 52, 0.0), (104, 54, 0.0), (140, 66, 0.0), (200, 90, 0.0)]
HILLS = [(-190, 330, 80, 26), (70, 330, 100, 26), (-300, 110, 100, 34), (280, 150, 100, 24), (-60, 560, 120, 40),
         (0, 1100, 250, 110), (-520, 900, 200, 80), (520, 900, 220, 95), (-700, 300, 200, 100), (700, 300, 200, 100)]


class Meadow:
    """Terrain, road, kerbs and lines: the stage. The road comes first (the karts and the camera are placed on it);
    `finish(hills)` then builds the terrain once the camera has said where the landmarks' hills belong."""

    def __init__(self, road_pts=ROAD, width=14.0):
        self.road = W.Road(list(road_pts), width=width)
        self.terrain = None

    def finish(self, hills=HILLS, fine=((-260, 260), (-130, 540))):
        self.terrain = W.Terrain(self.road, hills)
        self.terrain.build(*fine)
        self.road.build()
        W.Road.dashes(self.road, W.paint_material("road.dash", "#f4f4ef", 0.55, coat=0.1), 3.0, 4.5, 0.26)

    def ground(self, x, y):
        if self.terrain is None:  # before the terrain exists the ground is the road's own height nearby
            _, d, _u = self.road.nearest([x], [y])
            i = int(self.road.nearest([x], [y])[0][0])
            return float(self.road.c[i][2])
        return float(self.terrain.height(np.array([float(x)]), np.array([float(y)]))[0][0])


def kart_on_road(m, name, s, u, colour, character, heading_off=0.0, pose=None):
    """A kart at arc length s, lateral u on the road, facing along it turned left by `heading_off` radians."""
    pos, (tx, ty), (slope, bank) = road_frame(m.road, s, u)
    root, parts = kit.build_kart(name, colour, character, pose)
    a = math.atan2(ty, tx) + heading_off
    kit.place(root, pos, (math.cos(a), math.sin(a)), (slope, bank))
    return root, parts, pos


def sky_for(scene, az_deg, el_deg, **kw):
    d = dir_of(az_deg, el_deg)
    W.make_sky(scene, d, **kw)
    return d


def dir_of(az_deg, el_deg):
    """A unit direction from a compass azimuth (0 = +y 'north', 90 = +x 'east') and an elevation."""
    return Vector((math.sin(az_deg * DEG) * math.cos(el_deg * DEG), math.cos(az_deg * DEG) * math.cos(el_deg * DEG), math.sin(el_deg * DEG)))


class Visible:
    """Is a world point inside the camera's view (plus a margin)? So that only what the picture shows is built."""

    def __init__(self, cam, res, margin=0.12, min_x=None):
        self.min_x = min_x  # nothing is built left of this normalised x (-1 .. 1): the title's calm side
        bpy.context.view_layer.update()
        self.inv = cam.matrix_world.inverted()
        self.k = cam.data.lens / (cam.data.sensor_width / 2)
        self.aspect = res[0] / res[1]
        self.margin = margin

    def __call__(self, p, radius=0.0):
        q = self.inv @ Vector(p)
        d = -q.z
        if d < 0.5:
            return False
        x = q.x / d * self.k
        y = q.y / d * self.k * self.aspect
        pad = 1.0 + self.margin + radius / d * self.k * 1.5
        if self.min_x is not None and x + radius / d * self.k * 0.45 < self.min_x:
            return False
        return abs(x) < pad and abs(y) < pad


def dress_meadow(m, rng, vis, cam_loc, cam_az, hfov, *, windmill_at=None, trees=90, bushes=40, flowers=120, rocks=10,
                 rmin=26.0, rmax=520.0, near_road=16.0, windmill=True, windmill_yaw=None, view_cone=1.35, tree_scale=1.0, bush_scale=1.0, flower_scale=1.0, windmill_scale=1.6):
    """The meadow's props: trees and pines in groves, bushes and flowers along the verges, rocks, and the windmill on its hill.
    Positions are drawn from the camera's own view (log-spaced distance, within its cone) and kept clear of the road."""
    road = m.road
    placed = []
    kinds_tree = ["scenery.tree.0", "scenery.tree.1", "scenery.tree.2", "scenery.tree.3", "scenery.tree.4", "scenery.pine.0", "scenery.pine.1"]
    kinds_bush = ["scenery.bush.0", "scenery.bush.1", "scenery.bush.2"]
    kinds_rock = ["scenery.rock.0", "scenery.rock.1", "scenery.rock.2"]
    kinds_flower = [f"scenery.flower.{i}" for i in range(6)]
    cone = hfov / 2 * view_cone

    def draw(rlo, rhi):
        r = math.exp(rng.uniform(math.log(rlo), math.log(rhi)))
        a = (cam_az + rng.uniform(-cone, cone)) * DEG
        return cam_loc.x + math.sin(a) * r, cam_loc.y + math.cos(a) * r

    def put(kind, x, y, scale, min_gap, gap_scale=1.0):
        for px, py, pr in placed:
            if (x - px) ** 2 + (y - py) ** 2 < (min_gap * scale + pr) ** 2:
                return None
        z = m.ground(x, y)
        if not vis((x, y, z + 2.5 * scale), 3.0 * scale):
            return None
        o = W.prop(kind, (x, y, z - 0.04), scale, rng.uniform(0, 2 * math.pi))
        placed.append((x, y, 0.8 * scale * gap_scale))
        return o

    def road_clear(x, y, d):
        _, dist, _u = road.nearest([x], [y])
        return dist[0] >= d

    # trees in groves: pick centres, drop several around each
    made = 0
    tries = 0
    while made < trees and tries < trees * 80:
        tries += 1
        cx, cy = draw(rmin, rmax)
        if not road_clear(cx, cy, near_road + 8):
            continue
        for _ in range(int(rng.integers(1, 6))):
            x, y = cx + rng.normal(0, 9), cy + rng.normal(0, 9)
            if not road_clear(x, y, near_road):
                continue
            sc = rng.uniform(1.6, 2.7) * (1.0 if rng.random() > 0.15 else 1.3) * tree_scale
            if put(rng.choice(kinds_tree), x, y, sc, 2.6):
                made += 1
    # bushes, close to the verge on both sides, in the view
    made = 0
    tries = 0
    while made < bushes and tries < bushes * 120:
        tries += 1
        x, y = draw(8, 140)
        _, dist, _u = road.nearest([x], [y])
        if not (road.width / 2 + road.kerb + 2.2 < dist[0] < road.width / 2 + road.kerb + 14):
            continue
        sc = rng.uniform(1.6, 2.8) * bush_scale
        if put(rng.choice(kinds_bush), x, y, sc, 1.4):
            made += 1
    # flower patches
    made = 0
    tries = 0
    while made < flowers and tries < flowers * 60:
        tries += 1
        cx, cy = draw(6, 110)
        _, dist, _u = road.nearest([cx], [cy])
        if not (road.width / 2 + road.kerb + 1.8 < dist[0] < road.width / 2 + road.kerb + 20):
            continue
        for _ in range(int(rng.integers(4, 12))):
            x, y = cx + rng.normal(0, 2.2), cy + rng.normal(0, 2.2)
            _, d2, _u = road.nearest([x], [y])
            if d2[0] < road.width / 2 + road.kerb + 1.2:
                continue
            if put(rng.choice(kinds_flower), x, y, rng.uniform(2.0, 3.4) * flower_scale, 0.5):
                made += 1
    # rocks
    made = 0
    tries = 0
    while made < rocks and tries < rocks * 100:
        tries += 1
        x, y = draw(12, 200)
        if not road_clear(x, y, road.width / 2 + road.kerb + 4):
            continue
        if put(rng.choice(kinds_rock), x, y, rng.uniform(1.8, 3.4), 2.0):
            made += 1
    # the windmill on its hill, turned to face the camera
    if windmill and windmill_at:
        wx, wy = windmill_at
        wz = m.ground(wx, wy)
        yaw = windmill_yaw if windmill_yaw is not None else math.atan2(cam_loc.x - wx, -(cam_loc.y - wy))
        W.landmark("windmill", (wx, wy, wz - 0.3), yaw, windmill_scale, spin={"windmill.sails.spin.z": 0.42})
    return placed


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


