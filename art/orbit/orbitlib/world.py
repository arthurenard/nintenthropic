"""Where everything is: the eye, the planet, the sun. One place, shared by
the bakes, the review renders, the poster and the exported contract nodes,
so every picture agrees with the game.

Blender coordinates (Z up, metres). The glTF exporter maps Blender
(x, y, z) to glTF (x, z, -y): the player's eye is at the origin and looks
along Blender +Y (glTF -Z), pitched 20 degrees down toward the planet.

The station is not "level": in orbit there is no down but the planet's.
The planet's centre lies a little ahead of straight below the eye, so its
limb (the horizon dips 20.3 degrees at 420 km) crosses the view about a
third of the way down from the top, with a slight roll - the planet fills
the lower two thirds of the view, as the design asks.
"""

import math

import numpy as np

R_KM = 6371.0
ALT_KM = 420.0
PITCH_DEG = -20.0          # the view, below the station's horizontal
VFOV_DEG = 62.0            # the player's vertical field of view
LIMB_ABOVE_CENTRE_DEG = 11.0
HORIZON_ROLL_DEG = -4.0    # the limb rises a little toward the left
# Which part of the planet is under the station in the baked lighting and
# the review renders (the game turns the planet as it likes).
SUBPOINT = (-150.0, 14.0)  # lon, lat (deg) under the station: open ocean under cumulus fields
HEADING_DEG = 60.0         # the view's heading over the ground (from north)

# The baked sun: up on the left and ahead, so the debris is side- and
# front-lit (facets flash as they turn), the station's white blankets rake
# in hard light, the ocean's glint shows in the left window, and sunlight
# streams in through the left-hand windows onto the right of the frame.
SUN_ELEV_DEG = 30.0        # above the station's horizontal
SUN_AZ_DEG = -62.0         # from the view direction, + to the right
SUN_COLOR = (1.0, 0.985, 0.96)
SUN_ANGLE_DEG = 0.53

F32 = np.float32


def vec(x, y, z):
    return np.array([x, y, z], np.float64)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def forward():
    p = math.radians(PITCH_DEG)
    return vec(0.0, math.cos(p), math.sin(p))


def camera_rotation():
    """Blender camera rotation matrix (columns right, up, back)."""
    f = forward()
    right = vec(1.0, 0.0, 0.0)
    up = np.cross(right, f)
    return np.stack([right, up, -f], 1)


def camera_euler():
    return (math.radians(90.0 + PITCH_DEG), 0.0, 0.0)


def from_view(elev_deg, az_deg):
    """A world direction from elevation above the station's horizontal and
    azimuth from the view's heading (+ to the right)."""
    e, a = math.radians(elev_deg), math.radians(az_deg)
    return vec(math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))


def nadir():
    """Unit vector from the eye toward the planet's centre (world)."""
    dip = math.degrees(math.asin(R_KM / (R_KM + ALT_KM)))    # angle nadir -> limb
    # angle between the view axis and the nadir so that the limb, in the
    # vertical plane of the view, sits LIMB_ABOVE_CENTRE above the centre
    ang = dip - LIMB_ABOVE_CENTRE_DEG
    f = forward()
    right = vec(1.0, 0.0, 0.0)
    down_in_view = -np.cross(right, f)
    n = f * math.cos(math.radians(ang)) + down_in_view * math.sin(math.radians(ang))
    # roll the planet about the view axis
    r = math.radians(HORIZON_ROLL_DEG)
    k = f
    n = n * math.cos(r) + np.cross(k, n) * math.sin(r) + k * (k @ n) * (1 - math.cos(r))
    return n / np.linalg.norm(n)


def planet_center_km():
    return nadir() * (R_KM + ALT_KM)


def station_up():
    return -nadir()


def planet_rotation(subpoint=None, heading=None):
    """Rotation taking planet-frame vectors (+Z north, lon 0 on +X) to
    world: the local vertical at the subpoint becomes the station's up, and
    the heading there points along the view's horizontal direction."""
    lon, lat = map(math.radians, subpoint or SUBPOINT)
    HEADING = HEADING_DEG if heading is None else heading
    up_p = vec(math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))
    east_p = vec(-math.sin(lon), math.cos(lon), 0.0)
    north_p = np.cross(up_p, east_p)
    h = math.radians(HEADING)
    fwd_p = north_p * math.cos(h) + east_p * math.sin(h)
    side_p = np.cross(fwd_p, up_p)
    up_w = station_up()
    f = forward()
    fwd_w = f - up_w * (f @ up_w)
    fwd_w /= np.linalg.norm(fwd_w)
    side_w = np.cross(fwd_w, up_w)
    A = np.stack([fwd_p, side_p, up_p], 1)
    B = np.stack([fwd_w, side_w, up_w], 1)
    return B @ A.T


def sun_dir():
    """World unit vector toward the sun (for the baked light)."""
    up = station_up()
    f = forward()
    fh = f - up * (f @ up)
    fh /= np.linalg.norm(fh)
    right = np.cross(fh, up)
    e, a = math.radians(SUN_ELEV_DEG), math.radians(SUN_AZ_DEG)
    s = (fh * math.cos(a) + right * math.sin(a)) * math.cos(e) + up * math.sin(e)
    return s / np.linalg.norm(s)


def to_planet(v_world, rot=None):
    """World direction -> planet-frame direction."""
    return (planet_rotation() if rot is None else rot).T @ np.asarray(v_world, np.float64)


def eye_in_planet_km(rot=None):
    """The eye's position in the planet frame (km)."""
    return to_planet(-planet_center_km(), rot)


ASPECT = 16 / 9


def view_dir(sx, sy, aspect=ASPECT):
    """World direction through the player's screen at NDC (sx, sy), each
    in -1..1 (x right, y up) for a screen of the given aspect."""
    t = math.tan(math.radians(VFOV_DEG) / 2)
    R = camera_rotation()
    d = R[:, 0] * (sx * t * aspect) + R[:, 1] * (sy * t) - R[:, 2]
    return d / np.linalg.norm(d)


def view_point(sx, sy, dist, aspect=ASPECT):
    """The point `dist` metres from the eye along the ray through (sx, sy)."""
    return view_dir(sx, sy, aspect) * dist


def to_ndc(p, aspect=ASPECT):
    """World point -> player's screen NDC (x, y) and depth along the view."""
    R = camera_rotation()
    v = np.asarray(p, np.float64)
    z = -(v @ R[:, 2])
    t = math.tan(math.radians(VFOV_DEG) / 2)
    return (v @ R[:, 0]) / (z * t * aspect), (v @ R[:, 1]) / (z * t), z


def gltf(v):
    """Blender world vector -> glTF world vector (x, z, -y)."""
    return [float(v[0]), float(v[2]), float(-v[1])]


def describe():
    return dict(nadir=nadir().tolist(), sun=sun_dir().tolist(), eye_planet=eye_in_planet_km().tolist())
