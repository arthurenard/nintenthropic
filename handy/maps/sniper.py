"""OVERWATCH RIDGE: a long valley, a rifle, and an eye for the scope.

You are lying on a ridge at golden hour with an alpine valley below you. A road
runs across it past a ruined farmstead, and the people walking that road are a
long way off - two hundred to six hundred metres. Unscoped you see the whole
valley and shoot from the hip, which is hopeless at that range. Close one eye
and the view jumps six times closer, pans with your hand, and a fixed reticle
sits at the centre of the glass.

The world is a real pinhole projection (apparent size halves when the distance
doubles), and the shot is real ballistics on top of it: the bullet takes time
to get there, it drops on the way, and the wind pushes it sideways - all three
in proportion to the distance. The reticle's mil marks are calibrated to that
drop, so holding a mark high at the range the HUD reads is how you hit.

Public surface: ``SniperRound``, ``draw_world``, ``draw_hud``, ``draw_emblem``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import cv2
import numpy as np

from ..game import MISS, Hit, Rect, Round
from ..scene import blend

# --- the world --------------------------------------------------------------

ELEVATION = 42.0  # metres the ridge stands above the valley floor
FOCAL_FRACTION = 1.55  # focal length as a fraction of the frame width: ~36 deg
HORIZON_FRACTION = 0.36
MAN_HEIGHT = 1.78
TRUCK_LENGTH, TRUCK_HEIGHT = 5.4, 2.3

SCOPE_ZOOM = 6.0
SCOPE_RADIUS = 0.315  # of the frame height
# The glass sits below the middle of the screen, whole, clear of the readout
# panel above it and the hint line below: the reticle is fixed there, and so
# is a scoped shot.
SCOPE_CENTRE_Y = 0.627  # of the frame height
SCOPE_IN_SECONDS = 0.35
SWAY_HZ = 0.3  # breathing
SWAY_PX = (1.7, 2.8)  # base pixels, sideways and up-down
TREMOR_PX = 0.35
HIP_SPREAD = 0.011  # of the frame width, one sigma, shooting unscoped

# Ballistics. A slow, heavy round so that the drop means something at 400 m.
MUZZLE_VELOCITY = 600.0  # m/s
DRAG = 0.0006  # per metre: v(d) = v0 * exp(-DRAG * d)
GRAVITY = 9.81
ZERO_RANGE = 150.0  # the rifle is sighted to land dead on here
MAX_WIND = 8.0  # m/s
BOLT_SECONDS = 0.6

STAGE_SECONDS = 20.0
MAX_HOSTILES = 10
BODY_HEALTH = 3
HULL_HEALTH = 5

HEAD_POINTS = 100
DRIVER_POINTS = 150
KILL_POINTS = 40
WOUND_POINTS = 10
HULL_POINTS = 6

# Palette, BGR. Golden hour: a warm sky, cool shadows, long light from the right.
SKY_TOP = (92, 58, 30)
SKY_MID = (176, 148, 108)
SKY_HORIZON = (110, 190, 248)
SUN = (214, 246, 255)
SUN_GLOW = (120, 200, 255)
RIDGE_FAR = (182, 160, 168)
RIDGE_MID = (132, 104, 108)
RIDGE_NEAR = (86, 70, 76)
SNOW = (226, 232, 244)
FLOOR_FAR = (126, 170, 210)
FLOOR_NEAR = (52, 104, 92)
HAZE = (124, 178, 222)
FIELD_COLOURS = ((72, 138, 150), (58, 118, 96), (66, 102, 104), (80, 146, 166),
                 (50, 110, 86), (92, 126, 136), (60, 126, 110))
WATER = (170, 142, 104)
RIVER_GLINT = (224, 236, 250)
TARMAC = (110, 124, 134)
ROAD_EDGE = (136, 150, 158)
TREE = (34, 62, 44)
TREE_LIT = (72, 124, 104)
SHADOW = (34, 46, 44)
WALL = (130, 142, 150)
WALL_SHADE = (72, 82, 94)
ROOF = (52, 66, 92)
FOREGROUND = (24, 30, 30)
GRASS_LIT = (64, 132, 136)
FIGURE = (22, 24, 30)
FIGURE_EDGE = (8, 8, 10)
FIGURE_RIM = (176, 226, 255)
TAG = (244, 246, 248)
TAG_DARK = (10, 12, 14)
TRUCK = (44, 66, 62)
TRUCK_LIT = (86, 122, 110)
WINDOW = (170, 190, 200)
TRACER = (150, 230, 255)
DUST = (140, 176, 204)
BLOOD = (36, 30, 150)
SCORE_INK = (140, 220, 235)
RETICLE = (12, 12, 14)
RETICLE_EDGE = (120, 130, 140)
INFO = (210, 224, 232)

# --- ballistics ---------------------------------------------------------------

def flight_time(distance: float) -> float:
    """Seconds to cover ``distance`` against drag."""
    return (math.exp(DRAG * distance) - 1.0) / (DRAG * MUZZLE_VELOCITY)


def _raw_drop(distance: float) -> float:
    t = flight_time(distance)
    return 0.5 * GRAVITY * t * t


def bullet_drop(distance: float) -> float:
    """Metres the round lands below the aim at ``distance``, for a rifle zeroed
    at :data:`ZERO_RANGE`. Zero at the zero range, growing faster than linearly."""
    return _raw_drop(distance) - _raw_drop(ZERO_RANGE) * distance / ZERO_RANGE


def wind_drift(distance: float, wind: float) -> float:
    """Metres the round is pushed sideways by a crosswind of ``wind`` m/s.

    The lag rule: drift is the wind speed times how much longer the round took
    than it would have in a vacuum, so it grows steeply with range.
    """
    return wind * (flight_time(distance) - distance / MUZZLE_VELOCITY)


def mils(metres: float, distance: float) -> float:
    return metres / max(distance, 1.0) * 1000.0


# --- projection and view ------------------------------------------------------

@dataclass(frozen=True)
class Valley:
    """Pinhole camera on the ridge: metres in, wide-view (base) pixels out."""

    width: int
    height: int

    @property
    def centre_x(self) -> float:
        return self.width / 2

    @property
    def horizon(self) -> float:
        return HORIZON_FRACTION * self.height

    @property
    def focal(self) -> float:
        return FOCAL_FRACTION * self.width

    def project(self, x: float, distance: float, height: float = 0.0
                ) -> tuple[float, float]:
        """A point ``x`` metres right of dead ahead, ``distance`` out, ``height``
        above the valley floor."""
        distance = max(distance, 1.0)
        return (self.centre_x + self.focal * x / distance,
                self.horizon + self.focal * (ELEVATION - height) / distance)

    def size_px(self, metres: float, distance: float) -> float:
        return self.focal * metres / max(distance, 1.0)

    def ground_distance(self, base_y: float) -> float:
        """How far away the valley floor is under this row; inf above the horizon."""
        below = base_y - self.horizon
        return math.inf if below <= 0.0 else self.focal * ELEVATION / below

    def ground_lateral(self, base_x: float, distance: float) -> float:
        return (base_x - self.centre_x) * distance / self.focal

    def mil_px(self, zoom: float) -> float:
        return self.focal * zoom / 1000.0


@dataclass(frozen=True)
class View:
    """What part of the wide view is on screen: a base point at the centre and a
    magnification around it. Zoom 1 centred on the frame is the wide view."""

    width: int
    height: int
    centre: tuple[float, float]
    zoom: float = 1.0
    #: Where ``centre`` lands on screen; None for the middle of the frame.
    anchor: tuple[int, int] | None = None

    @classmethod
    def wide(cls, width: int, height: int) -> "View":
        return cls(width, height, (width / 2, height / 2), 1.0)

    @classmethod
    def scope_anchor(cls, width: int, height: int) -> tuple[int, int]:
        """The middle of the glass, which is where a scoped shot goes."""
        return (width // 2, int(SCOPE_CENTRE_Y * height))

    @property
    def screen_centre(self) -> tuple[int, int]:
        return self.anchor if self.anchor is not None else (self.width // 2, self.height // 2)

    def to_screen(self, base_x: float, base_y: float) -> tuple[float, float]:
        ax, ay = self.screen_centre
        return ((base_x - self.centre[0]) * self.zoom + ax,
                (base_y - self.centre[1]) * self.zoom + ay)

    def to_base(self, screen_x: float, screen_y: float) -> tuple[float, float]:
        ax, ay = self.screen_centre
        return ((screen_x - ax) / self.zoom + self.centre[0],
                (screen_y - ay) / self.zoom + self.centre[1])


class Road:
    """A polyline across the valley floor, walked by arc length."""

    def __init__(self, points: tuple[tuple[float, float], ...]) -> None:
        self.points = points
        self.marks = [0.0]
        for (x0, d0), (x1, d1) in zip(points, points[1:]):
            self.marks.append(self.marks[-1] + math.hypot(x1 - x0, d1 - d0))
        self.length = self.marks[-1]

    def point_at(self, s: float) -> tuple[float, float]:
        s = min(max(s, 0.0), self.length)
        for index in range(len(self.points) - 1):
            if s <= self.marks[index + 1]:
                span = self.marks[index + 1] - self.marks[index]
                t = (s - self.marks[index]) / span if span else 0.0
                (x0, d0), (x1, d1) = self.points[index], self.points[index + 1]
                return (x0 + (x1 - x0) * t, d0 + (d1 - d0) * t)
        return self.points[-1]

    def tangent_at(self, s: float) -> tuple[float, float]:
        ahead, behind = self.point_at(s + 3.0), self.point_at(s - 3.0)
        dx, dd = ahead[0] - behind[0], ahead[1] - behind[1]
        norm = math.hypot(dx, dd) or 1.0
        return (dx / norm, dd / norm)


# Far left to near right; both ends are off the wide view.
ROAD = Road(((-320.0, 620.0), (-220.0, 540.0), (-150.0, 470.0), (-120.0, 410.0),
             (-50.0, 360.0), (10.0, 320.0), (60.0, 280.0), (105.0, 240.0),
             (160.0, 200.0), (220.0, 165.0), (280.0, 140.0)))
RIVER = ((40.0, 1400.0), (90.0, 900.0), (120.0, 700.0), (150.0, 560.0), (130.0, 500.0),
         (160.0, 430.0), (140.0, 380.0), (170.0, 330.0), (210.0, 290.0), (250.0, 250.0))
FARM = (28.0, 462.0)
WINDSOCK = (FARM[0] + 16.0, FARM[1] - 5.0, 6.5)  # x, distance, pole height in metres
# The sun sits low over the far right, so every shadow lies towards you and to
# the left: this unit vector, in metres, is the one direction they all share.
SHADOW_DIR = (-0.76, -0.65)
SHADOW_REACH = 5.2  # shadow length per metre of height, at this hour
# The warm light itself: what the sunward side of anything upright is lit with.
RIM_WARM = (150, 214, 255)
MAX_CRATERS = 40
#: How many bodies the valley keeps. Every one of them is rebuilt into a
#: Figure and repainted on every frame, so an endless round with no cap
#: walks draw_world straight through its budget and never comes back.
MAX_FALLEN = 24
SENTRY_POSTS = ((20.0, 446.0), (2.0, 482.0), (-30.0, 300.0), (72.0, 440.0),
                (70.0, 200.0), (52.0, 348.0), (-14.0, 452.0), (-50.0, 352.0),
                (-62.0, 398.0), (110.0, 250.0))


# --- what stands in the valley ------------------------------------------------

@dataclass(frozen=True)
class Figure:
    """Where every part of a hostile is on screen, this frame, in whatever view
    it was asked for. Drawing and hit-testing both read this."""

    kind: str
    x: float
    ground_y: float
    height: float
    head: tuple[float, float]
    head_radius: float
    shoulder_y: float
    hip_y: float
    half_width: float
    facing: float = 1.0
    phase: float = 0.0
    stagger: float = 0.0
    alive: bool = True
    distance: float = 0.0
    #: Where the shadow of the head falls on screen: the low sun throws it a
    #: long way, and every figure's lies the same way the trees' do.
    shadow: tuple[float, float] | None = None
    #: Seconds since they fell; 0 while alive.
    fallen_for: float = 0.0

    def hit_zone(self, x: float, y: float) -> str | None:
        """"head", "body" or None. For a vehicle the head is the cab window."""
        if not self.alive:
            return None
        if self.kind == "vehicle":
            if (abs(x - self.head[0]) <= max(self.head_radius * 1.2, 3.0)
                    and abs(y - self.head[1]) <= max(self.head_radius * 0.9, 2.5)):
                return "head"
            if (abs(x - self.x) <= self.half_width
                    and self.ground_y - self.height <= y <= self.ground_y):
                return "body"
            return None
        if math.hypot(x - self.head[0], y - self.head[1]) <= max(self.head_radius * 1.3, 3.0):
            return "head"
        if (abs(x - self.x) <= max(self.half_width * 1.5, 2.5)
                and self.shoulder_y - self.head_radius <= y <= self.ground_y):
            return "body"
        return None


@dataclass
class Hostile:
    """Someone down there. Position is a function of time, so a shot that takes
    a second to arrive can be tested against where they will be."""

    kind: str  # "patrol", "sentry" or "vehicle"
    born: float
    start: float = 0.0  # arc length along the road, or unused for a sentry
    direction: float = 1.0
    speed: float = 1.3
    post: tuple[float, float] = (0.0, 300.0)
    phase: float = 0.0
    health: int = BODY_HEALTH
    dead_at: float | None = None
    fell_at: tuple[float, float] | None = None
    staggered_until: float = 0.0

    def arc(self, now: float) -> float:
        return self.start + self.direction * self.speed * (now - self.born)

    def on_road(self) -> bool:
        return self.kind in ("patrol", "vehicle")

    def gone(self, now: float) -> bool:
        """Walked or driven off the far end of the road."""
        return (self.on_road() and self.dead_at is None
                and not 0.0 <= self.arc(now) <= ROAD.length)

    def world_at(self, now: float) -> tuple[float, float]:
        if self.fell_at is not None and self.dead_at is not None and now >= self.dead_at:
            return self.fell_at
        if self.on_road():
            return ROAD.point_at(self.arc(now))
        x, d = self.post
        # Timed from when they took the post, not from whatever the clock reads,
        # so where a sentry stands at a given moment of the round is the same
        # every time the round is played.
        drift = math.sin((now - self.born) * 0.35 + self.phase) * 0.6
        return (x + drift, d)

    def facing_at(self, valley: Valley, now: float) -> float:
        if self.on_road():
            s = self.arc(now)
            dx, dd = ROAD.tangent_at(s)
            x, d = ROAD.point_at(s)
            ahead = valley.project(x + dx, d + dd)[0] - valley.project(x, d)[0]
            return math.copysign(1.0, ahead * self.direction or 1.0)
        return 1.0 if self.phase % 2.0 < 1.0 else -1.0

    def alive_at(self, now: float) -> bool:
        return self.dead_at is None or now < self.dead_at

    def figure(self, view: View, now: float, valley: Valley | None = None) -> Figure:
        valley = valley or Valley(view.width, view.height)
        x, distance = self.world_at(now)
        base_x, ground_base = valley.project(x, distance)
        sx, ground_y = view.to_screen(base_x, ground_base)
        facing = self.facing_at(valley, now)
        alive = self.alive_at(now)
        stagger = 1.0 if now < self.staggered_until else 0.0

        if self.kind == "vehicle":
            length = valley.size_px(TRUCK_LENGTH, distance) * view.zoom
            height = valley.size_px(TRUCK_HEIGHT, distance) * view.zoom
            dx, dd = ROAD.tangent_at(self.arc(now))
            # How much of the truck's length lies across the view.
            across = abs(valley.project(x + dx, distance + dd)[0]
                         - valley.project(x, distance)[0])
            along = abs(valley.project(x, distance + dd)[1] - valley.project(x, distance)[1])
            flat = across / max(math.hypot(across, along), 1e-6)
            half = 0.5 * length * (0.42 + 0.58 * flat)
            cab_x = sx + facing * half * 0.62
            return Figure(kind="vehicle", x=sx, ground_y=ground_y, height=height,
                          head=(cab_x, ground_y - height * 0.72),
                          head_radius=half * 0.26, shoulder_y=ground_y - height,
                          hip_y=ground_y - height * 0.45, half_width=half,
                          facing=facing, phase=self.phase, alive=alive,
                          distance=distance)

        height = valley.size_px(MAN_HEIGHT, distance) * view.zoom
        shadow = view.to_screen(*valley.project(*shadow_of(x, distance, MAN_HEIGHT)))
        fallen_for = 0.0
        if not alive:
            height *= 0.35
            fallen_for = now - self.dead_at
        lean = stagger * 0.08 * height
        return Figure(kind=self.kind, x=sx, ground_y=ground_y, height=height,
                      shadow=shadow, fallen_for=fallen_for,
                      head=(sx + lean + facing * height * 0.02, ground_y - height * 0.905),
                      head_radius=height * 0.075,
                      shoulder_y=ground_y - height * 0.78,
                      hip_y=ground_y - height * 0.48,
                      half_width=height * 0.16, facing=facing,
                      phase=self.phase + (now - self.born) * self.speed * 4.2,
                      stagger=stagger, alive=alive, distance=distance)


@dataclass
class Shot:
    """A round in the air, and what it did when it got there."""

    fired: float
    lands: float
    origin: tuple[float, float]  # base pixels
    target: tuple[float, float]  # base pixels
    distance: float
    zone: str | None  # "head", "body" or None
    label: str = ""
    points: int = 0
    hit_vehicle: bool = False
    announced: bool = False
    bolt: bool = False


@dataclass
class SniperRound(Round):
    """Overwatch over the valley until the light goes."""

    hostiles: list[Hostile] = field(default_factory=list, init=False)
    fallen: list[Hostile] = field(default_factory=list, init=False)
    flights: list[Shot] = field(default_factory=list, init=False)
    wind: float = field(default=0.0, init=False)
    wind_target: float = field(default=0.0, init=False)
    kills: int = field(default=0, init=False)
    craters: list[tuple[float, float, float]] = field(default_factory=list, init=False)
    clouds: list[list[float]] = field(default_factory=list, init=False)
    #: Dust in the air: (x, distance, born, strength), in metres and seconds.
    dust: list[tuple[float, float, float, float]] = field(default_factory=list, init=False)
    #: How far the sky's clouds have gone across, in wide-view pixels.
    sky_drift: float = field(default=0.0, init=False)
    pan: tuple[float, float] = field(default=(0.5, 0.5), init=False)
    scoped: bool = field(default=False, init=False)
    scope_sensitivity: float = field(default=1.0, init=False)
    _last_pointer: tuple[float, float] | None = field(default=None, init=False)
    scoped_since: float | None = field(default=None, init=False)
    unscoped_since: float | None = field(default=None, init=False)
    _now: float = field(default=0.0, init=False, repr=False)
    _next_spawn: float = field(default=0.0, init=False, repr=False)
    _next_vehicle: float = field(default=8.0, init=False, repr=False)
    _next_gust: float = field(default=0.0, init=False, repr=False)
    _next_dust: float = field(default=0.0, init=False, repr=False)
    _last_tick: float | None = field(default=None, init=False, repr=False)

    IMPACT_TTL = 2.6
    PERFECT_LABEL = "headshots"

    def __post_init__(self) -> None:
        super().__post_init__()
        self.frame = frame_for(self.options.area, self.options.scale)
        self.valley = Valley(*self.frame)
        self.view = View.wide(*self.frame)
        # The weather keeps its own dice, so the gusts come the same whatever
        # else happens in the valley; ``rng`` is left to the hostiles.
        self.weather_rng = self.stream("weather")
        self.wind = self.wind_target = self.weather_rng.uniform(-4.0, 4.0)
        # Cloud shadows: [x, distance, half-width, half-depth] in metres, drifting.
        self.clouds = [[self.weather_rng.uniform(-0.4, 0.4) * d, d,
                        self.weather_rng.uniform(28.0, 55.0), self.weather_rng.uniform(70.0, 150.0)]
                       for d in (260.0, 380.0, 520.0, 700.0, 950.0)]
        # Something to look at from the first frame.
        self.hostiles = [
            Hostile("sentry", 0.0, post=SENTRY_POSTS[0], phase=0.4),
            Hostile("sentry", 0.0, post=SENTRY_POSTS[2], phase=1.3),
            Hostile("sentry", 0.0, post=SENTRY_POSTS[3], phase=2.2),
            Hostile("sentry", 0.0, post=SENTRY_POSTS[5], phase=0.9),
            Hostile("sentry", 0.0, post=SENTRY_POSTS[6], phase=3.1),
            Hostile("patrol", 0.0, start=ROAD.length * 0.45, direction=1.0, speed=1.25),
            Hostile("patrol", 0.0, start=ROAD.length * 0.62, direction=-1.0, speed=1.1,
                    phase=2.0),
        ]

    def begin(self, now: float) -> None:
        # Everything above was set out in seconds from the start of the round.
        # A patrol's place on the road is worked out from when it was born, so
        # left at zero against a clock reading 300,000 the opening two would
        # be kilometres off the end of it and gone on the first frame.
        for hostile in self.hostiles:
            hostile.born += now
        self._next_spawn += now
        self._next_vehicle += now
        self._next_gust += now
        self._next_dust += now

    # --- the view ------------------------------------------------------------

    def set_frame(self, width: int, height: int) -> None:
        """The canvas is the authority on the frame size; the area only predicts it."""
        if (width, height) != self.frame:
            self.frame = (width, height)
            self.valley = Valley(width, height)
            self._refresh_view()

    def sway(self, now: float) -> tuple[float, float]:
        """Breathing, in base pixels: what the player has to time."""
        breath = math.tau * SWAY_HZ * now
        return (SWAY_PX[0] * math.sin(breath * 0.8 + 0.7) + TREMOR_PX * math.sin(now * 7.1),
                SWAY_PX[1] * math.sin(breath) + TREMOR_PX * math.cos(now * 5.3))

    def _refresh_view(self) -> None:
        width, height = self.frame
        if not self.scoped:
            self.view = View.wide(width, height)
            return
        zoom = SCOPE_ZOOM
        # Breathing on the round's clock, so the same moment of the same round
        # sways the same way.
        sway = self.sway(self.elapsed(self._now))
        cx = self.pan[0] * (width - 1) + sway[0]
        cy = self.pan[1] * (height - 1) + sway[1]
        anchor = View.scope_anchor(width, height)
        # Keep the whole glass inside the world: the reach of the disc, in base
        # pixels, is what may not cross the edge.
        reach = SCOPE_RADIUS * height / zoom + 1.0
        cx = min(max(cx, reach), width - reach)
        cy = min(max(cy, reach), height - reach)
        self.view = View(width, height, (cx, cy), zoom, anchor)

    def look(self, position: tuple[float, float] | None, scoped: bool) -> None:
        if position is not None:
            if scoped and self.scoped:
                if self._last_pointer is not None:
                    self.pan = tuple(min(1.0, max(0.0, self.pan[i] +
                        (position[i] - self._last_pointer[i]) * self.scope_sensitivity))
                        for i in (0, 1))
            else:
                self.pan = tuple(min(max(v, 0.0), 1.0) for v in position)
            self._last_pointer = position
        else:
            # Reacquisition must not turn an unseen hand movement into a jump.
            self._last_pointer = None
        if scoped != self.scoped:
            self.cues.append("scope_in" if scoped else "scope_out")
            if scoped:
                self.scoped_since = self._now
            else:
                self.unscoped_since = self._now
        self.scoped = scoped
        self._refresh_view()

    @property
    def scoped_shot(self) -> tuple[int, int]:
        return self.view.screen_centre

    @property
    def targets(self) -> list[Hostile]:
        """The live hostiles, nearest first."""
        return sorted((h for h in self.hostiles if h.alive_at(self._now)),
                      key=lambda h: h.world_at(self._now)[1])

    def stage(self, now: float) -> int:
        return int(self.elapsed(now) // STAGE_SECONDS) + 1

    def range_under_reticle(self, now: float) -> tuple[float, Hostile | None]:
        """Metres to whatever the scope centre rests on: a hostile, or the ground."""
        sx, sy = self.view.screen_centre
        for hostile in self.targets:
            figure = hostile.figure(self.view, now, self.valley)
            if figure.hit_zone(sx, sy) is not None:
                return figure.distance, hostile
        base = self.view.to_base(sx, sy)
        return self.valley.ground_distance(base[1]), None

    # --- rules -----------------------------------------------------------------

    def advance(self, now: float) -> None:
        dt = 0.0 if self._last_tick is None else min(now - self._last_tick, 0.25)
        self._last_tick = now
        self._now = now
        self._refresh_view()

        # Wind drifts towards a target that is picked afresh every so often.
        if now >= self._next_gust:
            previous = self.wind_target
            self.wind_target = self.weather_rng.uniform(-MAX_WIND, MAX_WIND)
            self._next_gust = now + self.weather_rng.uniform(9.0, 15.0)
            if abs(self.wind_target - previous) > 2.5:
                self.cues.append("wind_gust")
        step = 1.6 * dt
        self.wind += min(max(self.wind_target - self.wind, -step), step)
        self.sky_drift += (4.0 + 2.2 * self.wind) * dt * (self.frame[0] / 1280.0)

        # Dust off the road and the fields, more of it the harder it blows, and
        # a plume behind anything driving. The plume is rolled for every frame,
        # so it draws on the effects' dice: from the world's, it made the wind
        # depend on the frame rate.
        dice = self.effects_rng
        if now >= self._next_dust:
            strength = 0.5 + abs(self.wind) / MAX_WIND
            s = dice.uniform(0.15, 0.95) * ROAD.length
            x, d = ROAD.point_at(s)
            self.dust.append((x + dice.uniform(-6.0, 6.0), d, now, strength))
            self._next_dust = now + dice.uniform(0.35, 0.9) / strength
        for hostile in self.hostiles:
            if hostile.kind == "vehicle" and hostile.alive_at(now) and dice.random() < 4.0 * dt:
                x, d = hostile.world_at(now)
                self.dust.append((x - 2.0 * hostile.direction, d + 1.0, now, 0.8))
        self.dust = [p for p in self.dust if now - p[2] < DUST_SECONDS][-MAX_DUST:]

        # Cloud shadows slide across the fields with the wind, a little faster
        # than it, and come back round the other side.
        for cloud in self.clouds:
            cloud[0] += (2.5 * math.copysign(1.0, self.wind or 1.0) + 2.0 * self.wind) * dt
            limit = 0.55 * cloud[1] + cloud[2]
            if cloud[0] > limit:
                cloud[0] = -limit
            elif cloud[0] < -limit:
                cloud[0] = limit

        for hostile in list(self.hostiles):
            if hostile.dead_at is not None and now >= hostile.dead_at:
                self.hostiles.remove(hostile)
                self.fallen.append(hostile)
                del self.fallen[:-MAX_FALLEN]  # the oldest go cold, as craters do
            elif hostile.gone(now):
                self.hostiles.remove(hostile)

        for shot in self.flights:
            if not shot.bolt and now >= shot.fired + BOLT_SECONDS:
                shot.bolt = True
                self.cues.append("bolt_cycle")
            if not shot.announced and now >= shot.lands:
                shot.announced = True
                self.cues.append("headshot_ping" if shot.zone == "head"
                                 else "distant_impact")
                if shot.zone is None:
                    # The ground keeps the mark.
                    self.craters.append((shot.target[0], shot.target[1], shot.distance))
                    del self.craters[:-MAX_CRATERS]
                    kicked = self.valley.ground_lateral(shot.target[0], shot.distance)
                    self.dust.append((kicked, shot.distance, now, 1.2))
        self.flights = [s for s in self.flights if now - s.lands < self.IMPACT_TTL]

        stage = self.stage(now)
        allowed = min(self.options.density + stage, MAX_HOSTILES)
        live = [h for h in self.hostiles if h.dead_at is None]
        if len(live) < allowed and now >= self._next_spawn:
            self.hostiles.append(self._spawn(now, stage))
            self._next_spawn = now + max(self.options.spawn_interval * 3.2 * 0.85 ** (stage - 1), 1.6)
        if now >= self._next_vehicle and not any(h.kind == "vehicle" for h in self.hostiles):
            self.hostiles.append(Hostile("vehicle", now, start=0.0, direction=1.0,
                                         speed=6.5 + 0.8 * stage, health=HULL_HEALTH))
            self._next_vehicle = now + 28.0

    def _spawn(self, now: float, stage: int) -> Hostile:
        taken = {h.post for h in self.hostiles if h.kind == "sentry"}
        free = [post for post in SENTRY_POSTS if post not in taken]
        if free and self.rng.random() < 0.35:
            return Hostile("sentry", now, post=self.rng.choice(free),
                           phase=self.rng.uniform(0.0, 4.0))
        from_far = self.rng.random() < 0.6
        return Hostile("patrol", now, start=0.0 if from_far else ROAD.length,
                       direction=1.0 if from_far else -1.0,
                       speed=self.rng.uniform(1.0, 1.5) * (1.0 + 0.12 * (stage - 1)),
                       phase=self.rng.uniform(0.0, math.tau))

    def resolve(self, x: float, y: float, now: float) -> Hit:
        """Screen coordinates in; the round is flown out to whatever it meets."""
        self.cues.append("sniper_shot")
        width = self.frame[0]
        base_x, base_y = self.view.to_base(x, y)
        if not self.scoped:
            base_x += self.effects_rng.gauss(0.0, HIP_SPREAD * width)
            base_y += self.effects_rng.gauss(0.0, HIP_SPREAD * width)
        origin = self.view.to_base(width / 2, self.frame[1])
        focal = self.valley.focal
        zoom = self.view.zoom

        for hostile in self.targets:
            distance = hostile.world_at(now)[1]
            lands = now + flight_time(distance)
            # Where the round actually is when it passes this range.
            bullet = (base_x + focal * wind_drift(distance, self.wind) / distance,
                      base_y + focal * bullet_drop(distance) / distance)
            # Tested at the magnification the player aimed at, so the slack the
            # hitbox allows is a few pixels of what they saw, not of the wide view.
            probe = View(width, self.frame[1], bullet, zoom)
            figure = hostile.figure(probe, lands, self.valley)
            zone = figure.hit_zone(*probe.to_screen(*bullet))
            if zone is None:
                continue
            return self._strike(hostile, zone, figure, bullet, origin, now, lands, distance)

        distance = self._ground_range(base_x, base_y)
        lands = now + flight_time(distance)
        target = (base_x + focal * wind_drift(distance, self.wind) / distance,
                  base_y + focal * bullet_drop(distance) / distance)
        self.flights.append(Shot(fired=now, lands=lands, origin=origin, target=target,
                                 distance=distance, zone=None))
        return MISS

    def _ground_range(self, base_x: float, base_y: float) -> float:
        """Where a missed round meets the valley floor, allowing for its drop."""
        valley = self.valley
        slope = (base_y - valley.horizon) / valley.focal  # metres down per metre out
        low, high = 60.0, 1800.0
        for _ in range(24):
            mid = 0.5 * (low + high)
            if slope * mid + bullet_drop(mid) >= ELEVATION:
                high = mid
            else:
                low = mid
        return high

    def _strike(self, hostile: Hostile, zone: str, figure: Figure, bullet, origin,
                now: float, lands: float, distance: float) -> Hit:
        bonus = (1.0 + distance / 250.0) * (1.0 + 0.15 * (self.stage(now) - 1))
        vehicle = hostile.kind == "vehicle"
        if zone == "head":
            self._kill(hostile, lands, now)
            points = int((DRIVER_POINTS if vehicle else HEAD_POINTS) * bonus)
            label = "DRIVER" if vehicle else "HEADSHOT"
            hit = Hit(points=points, ring=0, label=label, perfect=True)
        else:
            hostile.health -= 1
            hostile.staggered_until = lands + 0.5
            if hostile.health <= 0:
                self._kill(hostile, lands, now)
                points = int(KILL_POINTS * bonus)
                label = "DISABLED" if vehicle else "DOWN"
                hit = Hit(points=points, ring=1, label=label)
            else:
                points = HULL_POINTS if vehicle else WOUND_POINTS
                hit = Hit(points=points, ring=2, label="")
        self.flights.append(Shot(fired=now, lands=lands, origin=origin, target=bullet,
                                 distance=distance, zone=zone, label=hit.label,
                                 points=hit.points, hit_vehicle=vehicle))
        return hit

    def _kill(self, hostile: Hostile, lands: float, now: float) -> None:
        hostile.dead_at = lands
        hostile.fell_at = hostile.world_at(lands)
        self.kills += 1
        # The fall throws up dust, which the wind then takes.
        x, d = hostile.fell_at
        self.dust.append((x, d, lands, 0.6))

    @property
    def remaining_hostiles(self) -> int:
        return sum(1 for h in self.hostiles if h.dead_at is None)


def frame_for(area: Rect, scale: float) -> tuple[int, int]:
    """The window this play area was cut from (see ``app.layout_for``)."""
    return (2 * area.x + area.width, area.bottom + max(1, round(56 * scale)))

# --- the backdrop -------------------------------------------------------------
#
# Three layers. The smooth things - sky, sun, the ridges, the floor's gradient -
# are rasterised once at twice the frame size and warped to the view each
# frame; softness there reads as distance. The ground's grain - stubble, furrows,
# the mottle of a meadow - is a second raster in the same space, multiplied
# over the flat ground before anything stands on it. Everything with an edge -
# fields, road, river, trees, the farm, the grass you are lying in - is kept as
# a list of polygons in wide-view pixels and drawn through the current view
# with culling, so the scope is as sharp at six times as the wide view is at one.

def _lerp(a, b, t: float) -> tuple[int, int, int]:
    return tuple(int(round(p + (q - p) * t)) for p, q in zip(a, b))


def _gradient(rows: int, stops: list[tuple[float, tuple]]) -> np.ndarray:
    """An (rows, 3) float ramp through colour stops at fractions of the height."""
    t = np.linspace(0.0, 1.0, max(rows, 1))
    out = np.zeros((rows, 3), np.float32)
    for channel in range(3):
        out[:, channel] = np.interp(t, [s for s, _ in stops], [c[channel] for _, c in stops])
    return out


def haze_at(distance: float) -> float:
    """How much of the air's colour has got between you and something this far off."""
    return min(max((distance - 150.0) / 950.0, 0.0), 1.0) ** 0.9 * 0.8


def _hazed(colour, distance: float) -> tuple[int, int, int]:
    return _lerp(colour, HAZE, haze_at(distance))


def shadow_of(x: float, d: float, height: float) -> tuple[float, float]:
    """Where the shadow of something ``height`` tall standing at (x, d) ends."""
    reach = height * SHADOW_REACH
    return (x + SHADOW_DIR[0] * reach, d + SHADOW_DIR[1] * reach)


@lru_cache(maxsize=4)
def _sky_layer(width: int, height: int, ss: int, seed: int) -> np.ndarray:
    """Sky, sun, three ranges of mountains and the bare valley floor."""
    valley = Valley(width, height)
    W, H = width * ss, height * ss
    rng = np.random.default_rng(seed)
    img = np.zeros((H, W, 3), np.uint8)
    horizon = int(valley.horizon * ss)

    img[:horizon] = _gradient(horizon, [(0.0, SKY_TOP), (0.62, SKY_MID),
                                        (1.0, SKY_HORIZON)])[:, None, :].astype(np.uint8)
    sun = (int(width * 0.74 * ss), int((valley.horizon - height * 0.04) * ss))

    def glow(radius: float, sigma: float, weight: float) -> None:
        gs = 8
        small = np.zeros((H // gs + 1, W // gs + 1, 3), np.uint8)
        cv2.circle(small, (sun[0] // gs, sun[1] // gs), max(1, int(radius / gs)),
                   SUN_GLOW, -1, cv2.LINE_AA)
        cv2.GaussianBlur(small, (0, 0), max(1.0, sigma / gs), dst=small)
        cv2.addWeighted(img, 1.0, cv2.resize(small, (W, H), interpolation=cv2.INTER_LINEAR),
                        weight, 0.0, dst=img)

    glow(H * 0.22, H * 0.10, 0.42)
    glow(H * 0.06, H * 0.03, 0.6)
    cv2.circle(img, sun, int(H * 0.022), SUN, -1, cv2.LINE_AA)

    rng.uniform(0, 1, 20)  # the clouds used to be drawn here; the ridges keep their seed
    def ridge(base: float, amp: float, bumps: int) -> np.ndarray:
        xs = np.linspace(-0.05 * W, 1.05 * W, 220)
        ys = np.full(xs.size, horizon - base * H, np.float64)
        for _ in range(bumps):
            freq = rng.uniform(2.0, 9.0) * math.pi / W
            # Peaks, not swells: folded sines come to a point at the top.
            ys -= amp * H * rng.uniform(0.3, 1.0) * (1 - np.abs(np.sin(xs * freq + rng.uniform(0, 6.3)))) ** 1.3
        ys -= np.abs(rng.normal(0, amp * H * 0.05, xs.size))
        return np.column_stack([xs, ys])

    for base, amp, colour, snow_line in ((0.05, 0.038, RIDGE_FAR, 0.10),
                                         (0.025, 0.026, RIDGE_MID, 0.072),
                                         (0.006, 0.014, RIDGE_NEAR, None)):
        line = ridge(base, amp, 4)
        outline = np.vstack([line, [[1.05 * W, H], [-0.05 * W, H]]])
        if snow_line is not None:
            cv2.fillPoly(img, [outline.astype(np.int32)], SNOW, cv2.LINE_AA)
            clipped = outline.copy()
            clipped[:, 1] = np.maximum(clipped[:, 1], horizon - snow_line * H)
            cv2.fillPoly(img, [clipped.astype(np.int32)], colour, cv2.LINE_AA)
        else:
            cv2.fillPoly(img, [outline.astype(np.int32)], colour, cv2.LINE_AA)
        cv2.polylines(img, [line.astype(np.int32)], False, _lerp(colour, SUN, 0.4),
                      max(1, ss), cv2.LINE_AA)
        # Gullies down the faces, darker on the side away from the sun.
        for _ in range(12):
            i = rng.integers(10, len(line) - 10)
            top = line[i]
            foot = (top[0] - rng.uniform(0.01, 0.03) * W, min(H, top[1] + rng.uniform(0.02, 0.05) * H))
            cv2.line(img, (int(top[0]), int(top[1])), (int(foot[0]), int(foot[1])),
                     _lerp(colour, (20, 18, 24), 0.12), max(1, ss), cv2.LINE_AA)

    # The floor's colour follows true distance, so the haze is physical.
    rows = np.arange(horizon, H)
    dist = valley.focal * ELEVATION / ((rows / ss) - valley.horizon + 1e-6)
    t = np.clip((dist - 120.0) / 1400.0, 0.0, 1.0) ** 0.5
    floor = (np.array(FLOOR_NEAR, np.float32)[None] * (1 - t[:, None])
             + np.array(FLOOR_FAR, np.float32)[None] * t[:, None])
    h = np.array([haze_at(d) for d in dist], np.float32)[:, None]
    floor = floor * (1 - h) + np.array(HAZE, np.float32)[None] * h
    # The light comes from the low right: the floor warms and brightens towards
    # the sun and cools away from it, with the near ground in the ridge's lee.
    across = np.linspace(0.0, 1.0, W, dtype=np.float32)
    gain = (0.84 + 0.30 * across)[None, :, None]
    warm = np.array((-10.0, 4.0, 18.0), np.float32)[None, None, :] * (across[None, :, None] - 0.5)
    shaded = floor[:, None, :] * gain + warm
    img[horizon:] = np.clip(shaded, 0, 255).astype(np.uint8)
    glow(H * 0.4, H * 0.2, 0.12)
    return img


@lru_cache(maxsize=4)
def _ground_texture(width: int, height: int, ss: int, seed: int) -> np.ndarray:
    """Grain for the valley floor as a brightness multiplier (128 is unity),
    sampled in metres so furrows and stubble foreshorten like the fields do,
    and fading out where the haze and the pixel pitch would turn it to static."""
    valley = Valley(width, height)
    W, H = width * ss, height * ss
    rng = np.random.default_rng(seed + 17)
    tex = np.full((H, W), 128, np.uint8)
    horizon = int(valley.horizon * ss) + 2
    if horizon >= H:
        return tex

    # One tile of ground, half a metre per texel: a slow mottle, furrows
    # running across the valley, and fine stubble on top.
    N = 512
    coarse = cv2.resize(rng.normal(0, 1, (20, 20)).astype(np.float32), (N, N),
                        interpolation=cv2.INTER_CUBIC)
    cv2.GaussianBlur(coarse, (0, 0), 18, dst=coarse)
    mid = cv2.resize(rng.normal(0, 1, (64, 64)).astype(np.float32), (N, N),
                     interpolation=cv2.INTER_LINEAR)
    fine = rng.normal(0, 1, (N, N)).astype(np.float32)
    fine = cv2.blur(fine, (9, 1))  # streaked sideways: stubble rows
    furrows = np.sin(np.arange(N, dtype=np.float32)[:, None] * (math.tau / 7.0))
    furrows = np.repeat(furrows, N, axis=1) * 0.5
    tile = 0.45 * coarse + 0.5 * mid + 1.1 * fine + furrows
    tile = np.clip(128 + tile * 11.0, 0, 255).astype(np.uint8)

    rows = np.arange(horizon, H, dtype=np.float32)
    dist = valley.focal * ELEVATION / (rows / ss - valley.horizon)
    xs = np.arange(W, dtype=np.float32) / ss
    lateral = (xs[None, :] - valley.centre_x) * (dist[:, None] / valley.focal)
    map_x = np.mod(lateral * 2.0, N - 1).astype(np.float32)
    map_y = np.mod(np.repeat(dist[:, None] * 2.0, W, axis=1), N - 1).astype(np.float32)
    sampled = cv2.remap(tile, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    # Grain amplitude: full nearby, gone into the haze, and damped where one
    # pixel spans more than a texel so it cannot alias.
    texels_per_px = dist * 2.0 / (valley.focal * ss)
    amp = np.clip(1.0 / np.maximum(texels_per_px, 1.0), 0.0, 1.0)
    amp *= 1.0 - np.array([haze_at(d) for d in dist], np.float32) / 0.8
    amp = np.clip(amp, 0.0, 1.0)[:, None]
    tex[horizon:] = np.clip(128 + (sampled.astype(np.float32) - 128) * amp, 0, 255).astype(np.uint8)
    return tex


class Scenery:
    """Every hard-edged thing in the valley, as polygons in wide-view pixels,
    sorted far to near within layers (flat ground, roads, shadows, upright)."""

    FLAT, STRIP, SHADOW, UPRIGHT, FOREGROUND = range(5)

    def __init__(self) -> None:
        self.items: list[tuple[int, float, tuple, np.ndarray, int]] = []

    def add(self, layer: int, depth: float, colour, points, thickness: int = 0) -> None:
        self.items.append((layer, depth, tuple(colour), np.asarray(points, np.float32), thickness))

    def freeze(self) -> None:
        self.items.sort(key=lambda item: (item[0], -item[1]))
        self.points = np.vstack([item[3] for item in self.items]) if self.items else np.zeros((0, 2), np.float32)
        counts = np.array([len(item[3]) for item in self.items], np.int64)
        self.starts = np.concatenate([[0], np.cumsum(counts)[:-1]]) if len(counts) else np.zeros(0, np.int64)
        self.counts = counts

    def draw(self, canvas: np.ndarray, view: View, dynamics=(), ground=None) -> None:
        """Paint through ``view``; ``dynamics`` are (depth, painter) pairs slotted
        into the upright layer by distance, so a patrol walks behind the trees.
        ``ground`` is called once the flat ground is down and before anything
        stands on it: the texture and the cloud shadows go there."""
        if not self.items:
            return
        height, width = canvas.shape[:2]
        pts = (self.points - np.float32(view.centre)) * np.float32(view.zoom) \
            + np.float32((width / 2, height / 2))
        mins = np.minimum.reduceat(pts, self.starts, axis=0)
        maxs = np.maximum.reduceat(pts, self.starts, axis=0)
        visible = ((maxs[:, 0] >= 0) & (mins[:, 0] <= width)
                   & (maxs[:, 1] >= 0) & (mins[:, 1] <= height))
        moving = sorted(dynamics, key=lambda d: -d[0])
        grounded = ground is None
        for index, (layer, depth, colour, _, thickness) in enumerate(self.items):
            if not grounded and layer >= self.SHADOW:
                ground(canvas)
                grounded = True
            while moving and (layer > self.UPRIGHT or (layer == self.UPRIGHT and moving[0][0] >= depth)):
                moving.pop(0)[1](canvas)
            if not visible[index]:
                continue
            start = self.starts[index]
            poly = pts[start:start + self.counts[index]].astype(np.int32)
            if thickness:
                cv2.polylines(canvas, [poly], False, colour,
                              max(1, int(round(thickness * view.zoom))), cv2.LINE_AA)
            else:
                cv2.fillPoly(canvas, [poly], colour, cv2.LINE_AA)
        if not grounded:
            ground(canvas)
        for _, painter in moving:
            painter(canvas)


def _ellipse_points(cx: float, cy: float, rx: float, ry: float, n: int = 10) -> list:
    return [(cx + rx * math.cos(a), cy + ry * math.sin(a))
            for a in np.linspace(0, math.tau, n, endpoint=False)]


def _ground_ellipse(valley: Valley, x: float, d: float, rx: float, rd: float, n: int = 14) -> list:
    """An ellipse lying on the valley floor, in metres, projected."""
    return [valley.project(x + rx * math.cos(a), d + rd * math.sin(a))
            for a in np.linspace(0, math.tau, n, endpoint=False)]


@lru_cache(maxsize=4)
def _scenery(width: int, height: int, seed: int) -> Scenery:
    valley = Valley(width, height)
    rng = np.random.default_rng(seed)
    scene = Scenery()
    G = valley.project

    # Fields: a quilt laid on the floor in metres, so it foreshortens.
    for _ in range(90):
        d0 = rng.uniform(150.0, 1600.0)
        x0 = rng.uniform(-0.45, 0.45) * d0
        w, depth = rng.uniform(30.0, 140.0), rng.uniform(30.0, 120.0)
        colour = FIELD_COLOURS[rng.integers(len(FIELD_COLOURS))]
        colour = tuple(int(min(max(c + rng.uniform(-10, 10), 0), 255)) for c in colour)
        scene.add(Scenery.FLAT, d0 + depth, _hazed(colour, d0 + depth * 0.5),
                  [G(x0, d0), G(x0 + w, d0), G(x0 + w, d0 + depth), G(x0, d0 + depth)])
        # A hedge line along the far edge, with its shadow thrown back over the field.
        if rng.random() < 0.5:
            hedge = rng.uniform(1.2, 2.2)
            scene.add(Scenery.STRIP, d0 + depth, _hazed(_lerp(TREE, colour, 0.35), d0 + depth),
                      [G(x0, d0 + depth), G(x0 + w, d0 + depth)], thickness=max(1, int(valley.size_px(hedge, d0 + depth))))

    def strip(points, half_width: float, colour, step: float) -> None:
        road = Road(tuple(points))
        s = 0.0
        while s < road.length:
            a, b = s, min(s + step, road.length)
            (x0, d0), (x1, d1) = road.point_at(a), road.point_at(b)
            tx, td = road.tangent_at(0.5 * (a + b))
            nx, nd = -td * half_width, tx * half_width
            scene.add(Scenery.STRIP, max(d0, d1), _hazed(colour, 0.5 * (d0 + d1)),
                      [G(x0 + nx, d0 + nd), G(x0 - nx, d0 - nd), G(x1 - nx, d1 - nd), G(x1 + nx, d1 + nd)])
            s += step

    strip(RIVER, 5.0, WATER, 14.0)
    strip(RIVER, 0.9, RIVER_GLINT, 14.0)
    strip(ROAD.points, 3.4, _lerp(TARMAC, SHADOW, 0.2), 9.0)  # the verge
    strip(ROAD.points, 2.8, TARMAC, 9.0)
    strip(ROAD.points, 0.3, ROAD_EDGE, 9.0)

    # Conifers along the river and up the valley sides, and a line of them on
    # the sunward side of the road so their shadows lie across it.
    trees = []
    river = Road(RIVER)
    for _ in range(110):
        s = rng.uniform(0, river.length)
        x, d = river.point_at(s)
        trees.append((x + rng.uniform(7.0, 28.0) * rng.choice([-1, 1]), d + rng.uniform(-6, 6)))
    for _ in range(170):
        d = rng.uniform(150.0, 1400.0)
        trees.append((rng.uniform(0.25, 0.48) * d * rng.choice([-1, 1]), d))
    for _ in range(26):
        d = rng.uniform(200.0, 1000.0)
        trees.append((rng.uniform(-0.4, 0.4) * d, d))
    for s in np.arange(ROAD.length * 0.08, ROAD.length * 0.92, 11.0):
        if rng.random() < 0.55:
            x, d = ROAD.point_at(s)
            tx, td = ROAD.tangent_at(s)
            # The right-hand verge, away from the shadow direction.
            trees.append((x - td * rng.uniform(6.0, 10.0), d + tx * rng.uniform(6.0, 10.0)))
    for x, d in trees:
        if d < 140.0:
            continue
        h = rng.uniform(5.0, 9.0)
        fx, fy = G(x, d)
        tall = valley.size_px(h, d)
        wide = tall * 0.30
        tint = _hazed(_lerp(TREE, (44, 78, 60), rng.uniform(0, 1)), d)
        # The shadow: a wedge from the foot to where the tip's shadow falls.
        tip = shadow_of(x, d, h)
        half = h * 0.3
        scene.add(Scenery.SHADOW, d, _hazed(_lerp(SHADOW, FLOOR_NEAR, 0.15), d),
                  [G(x - half, d), G(x + half, d), G(tip[0] + half * 0.3, tip[1]), G(tip[0] - half * 0.3, tip[1])])
        scene.add(Scenery.UPRIGHT, d, tint, [(fx - wide, fy), (fx, fy - tall), (fx + wide, fy)])
        scene.add(Scenery.UPRIGHT, d, _hazed(_lerp(tint, TREE_LIT, 0.6), d),
                  [(fx + wide * 0.2, fy), (fx, fy - tall), (fx + wide, fy)])
        # The sun catches the right-hand edge: a warm sliver down the lit side.
        scene.add(Scenery.UPRIGHT, d, _hazed(_lerp(tint, RIM_WARM, 0.55), d),
                  [(fx + wide * 0.62, fy), (fx, fy - tall), (fx + wide, fy)])

    # Scrub, boulders and the odd haystack across the fields: dots in the wide
    # view, and the things the scope's magnification makes real.
    for _ in range(380):
        d = rng.uniform(160.0, 1100.0)
        x = rng.uniform(-0.46, 0.46) * d
        if abs(x - FARM[0]) < 30 and abs(d - FARM[1]) < 20:
            continue
        kind = rng.random()
        if kind < 0.72:  # a bush
            h = rng.uniform(0.8, 1.8)
            colour = _hazed(_lerp(TREE, (48, 96, 70), rng.uniform(0.2, 1.0)), d)
            fx, fy = G(x, d)
            tall = valley.size_px(h, d)
            tip = shadow_of(x, d, h)
            scene.add(Scenery.SHADOW, d, _hazed(_lerp(SHADOW, FLOOR_NEAR, 0.15), d),
                      [G(x - h * 0.5, d), G(x + h * 0.5, d), G(tip[0], tip[1])])
            scene.add(Scenery.UPRIGHT, d, colour, _ellipse_points(fx, fy - tall * 0.45, tall * 0.7, tall * 0.5, 7))
            scene.add(Scenery.UPRIGHT, d, _hazed(_lerp(colour, RIM_WARM, 0.4), d),
                      _ellipse_points(fx + tall * 0.3, fy - tall * 0.55, tall * 0.35, tall * 0.28, 6))
        elif kind < 0.9:  # a boulder
            h = rng.uniform(0.5, 1.3)
            fx, fy = G(x, d)
            tall = valley.size_px(h, d)
            tip = shadow_of(x, d, h)
            scene.add(Scenery.SHADOW, d, _hazed(_lerp(SHADOW, FLOOR_NEAR, 0.15), d),
                      [G(x - h * 0.6, d), G(x + h * 0.6, d), G(tip[0], tip[1])])
            scene.add(Scenery.UPRIGHT, d, _hazed(WALL_SHADE, d),
                      [(fx - tall * 0.8, fy), (fx - tall * 0.5, fy - tall), (fx + tall * 0.4, fy - tall * 0.9), (fx + tall * 0.8, fy)])
            scene.add(Scenery.UPRIGHT, d, _hazed(_lerp(WALL, RIM_WARM, 0.35), d),
                      [(fx + tall * 0.4, fy - tall * 0.9), (fx + tall * 0.8, fy), (fx + tall * 0.1, fy - tall * 0.45)])
        else:  # a haystack
            h = rng.uniform(1.2, 1.8)
            fx, fy = G(x, d)
            tall = valley.size_px(h, d)
            tip = shadow_of(x, d, h)
            scene.add(Scenery.SHADOW, d, _hazed(_lerp(SHADOW, FLOOR_NEAR, 0.15), d),
                      [G(x - h * 0.7, d), G(x + h * 0.7, d), G(tip[0], tip[1])])
            scene.add(Scenery.UPRIGHT, d, _hazed((80, 140, 170), d),
                      _ellipse_points(fx, fy - tall * 0.4, tall * 0.9, tall * 0.55, 8))
            scene.add(Scenery.UPRIGHT, d, _hazed((120, 180, 206), d),
                      _ellipse_points(fx + tall * 0.3, fy - tall * 0.5, tall * 0.4, tall * 0.3, 6))

    # A burnt-out truck on the verge past the farm: the last patrol's story.
    wx, wd = ROAD.point_at(ROAD.length * 0.52)
    wx += 4.5
    tip = shadow_of(wx, wd, 2.2)
    scene.add(Scenery.SHADOW, wd, _hazed(SHADOW, wd),
              [G(wx - 2.8, wd), G(wx + 2.8, wd), G(tip[0] + 2.0, tip[1]), G(tip[0] - 2.8, tip[1])])
    scene.add(Scenery.UPRIGHT, wd, _hazed((30, 34, 38), wd),
              [G(wx - 2.8, wd, 0.0), G(wx + 2.8, wd, 0.0), G(wx + 2.8, wd, 1.4), G(wx + 1.2, wd, 2.2),
               G(wx - 0.4, wd, 2.1), G(wx - 2.8, wd, 1.3)])
    scene.add(Scenery.UPRIGHT, wd - 0.01, _hazed((60, 70, 86), wd),
              [G(wx - 2.6, wd, 1.2), G(wx - 0.5, wd, 1.95), G(wx + 1.0, wd, 2.0), G(wx + 2.6, wd, 1.3)])
    for k in (-1.9, 1.6):
        cx_, cy_ = G(wx + k, wd, 0.45)
        scene.add(Scenery.UPRIGHT, wd - 0.02, _hazed((20, 22, 26), wd),
                  _ellipse_points(cx_, cy_, valley.size_px(0.5, wd), valley.size_px(0.5, wd), 7))

    # The farmstead: a roofless house, a barn, a tower, a wall, all from 3-D corners.
    def ground_shadow(corners, h: float, depth: float) -> None:
        foot = [G(x, d) for x, d in corners]
        cast = [G(*shadow_of(x, d, h)) for x, d in corners]
        hull = cv2.convexHull(np.array(foot + cast, np.float32)).reshape(-1, 2)
        scene.add(Scenery.SHADOW, depth, _hazed(SHADOW, depth), hull)

    def box(x0, x1, d0, d1, h, wall, shade) -> None:
        depth = d0
        ground_shadow([(x0, d0), (x1, d0), (x1, d1), (x0, d1)], h, depth)
        side_x = x1 if (x0 + x1) / 2 < 0 else x0
        scene.add(Scenery.UPRIGHT, depth, _hazed(shade, depth),
                  [G(side_x, d0), G(side_x, d1), G(side_x, d1, h), G(side_x, d0, h)])
        scene.add(Scenery.UPRIGHT, depth, _hazed(_lerp(wall, SUN, 0.18), depth),
                  [G(x0, d0, h), G(x1, d0, h), G(x1, d1, h), G(x0, d1, h)])
        scene.add(Scenery.UPRIGHT, depth - 0.01, _hazed(wall, depth),
                  [G(x0, d0), G(x1, d0), G(x1, d0, h), G(x0, d0, h)])
        # Courses of stone: faint lines across the front face.
        for k in range(1, int(h / 0.9)):
            y = k * 0.9
            scene.add(Scenery.UPRIGHT, depth - 0.015, _hazed(_lerp(wall, shade, 0.3), depth),
                      [G(x0, d0, y), G(x1, d0, y)], thickness=1)

    fx, fd = FARM
    box(fx - 6, fx + 6, fd, fd + 9, 4.2, WALL, WALL_SHADE)
    for wx0, wx1, h0, h1 in ((fx - 4.5, fx - 2.5, 1.6, 3.0), (fx + 2.5, fx + 4.5, 1.6, 3.0),
                             (fx - 0.8, fx + 0.8, 0.0, 2.6)):
        scene.add(Scenery.UPRIGHT, fd - 0.02, _hazed(FIGURE, fd),
                  [G(wx0, fd, h0), G(wx1, fd, h0), G(wx1, fd, h1), G(wx0, fd, h1)])
    scene.add(Scenery.UPRIGHT, fd - 0.02, _hazed(ROOF, fd),
              [G(fx - 6.5, fd, 4.2), G(fx - 1, fd, 7.2), G(fx + 1.5, fd, 4.2)])
    scene.add(Scenery.UPRIGHT, fd - 0.02, _hazed(_lerp(ROOF, SUN, 0.25), fd),
              [G(fx - 1, fd, 7.2), G(fx + 1.5, fd, 4.2), G(fx + 6.5, fd, 4.2)])
    # The chimney the smoke comes from.
    scene.add(Scenery.UPRIGHT, fd - 0.03, _hazed(WALL_SHADE, fd),
              [G(fx + 3.2, fd, 4.0), G(fx + 4.0, fd, 4.0), G(fx + 4.0, fd, 6.0), G(fx + 3.2, fd, 6.0)])
    box(fx - 24, fx - 11, fd + 4, fd + 16, 3.6, WALL_SHADE, _lerp(WALL_SHADE, SHADOW, 0.5))
    box(fx + 9, fx + 11.5, fd + 3, fd + 5.5, 6.0, WALL, WALL_SHADE)
    scene.add(Scenery.STRIP, fd - 6, _hazed(WALL_SHADE, fd),
              [G(fx - 30, fd - 6), G(fx + 18, fd - 6), G(fx + 18, fd + 18)], thickness=1)
    # The windsock's pole; the sock itself moves, and is drawn each frame.
    sx, sd, sh = WINDSOCK
    ground_shadow([(sx - 0.15, sd), (sx + 0.15, sd)], sh, sd)
    scene.add(Scenery.UPRIGHT, sd, _hazed((90, 96, 104), sd), [G(sx, sd), G(sx, sd, sh)], thickness=1)

    # The ridge you are lying on, with backlit grass along its lip.
    top = height * 0.915
    xs = np.linspace(-0.02 * width, 1.02 * width, 90)
    ys = top - (np.sin(xs / width * 9.0) * 0.018 + np.sin(xs / width * 23.0 + 1.0) * 0.012) * height \
        - rng.uniform(0, 0.006 * height, xs.size)
    ys[:8] -= np.linspace(0.05, 0.0, 8) * height
    outline = np.vstack([np.column_stack([xs, ys]), [[1.02 * width, height * 1.1], [-0.02 * width, height * 1.1]]])
    scene.add(Scenery.FOREGROUND, 1.0, FOREGROUND, outline)
    scene.freeze()
    scene.lip = np.column_stack([xs, ys])
    return scene


@lru_cache(maxsize=4)
def _grass_blades(width: int, height: int, seed: int) -> np.ndarray:
    """The grass along the lip of the ridge: (root x, root y, height, phase,
    lean) per blade in wide-view pixels. Swayed by the wind each frame."""
    lip = _scenery(width, height, seed).lip
    rng = np.random.default_rng(seed + 5)
    blades = []
    for x, y in lip:
        for _ in range(4):
            blades.append((x + rng.uniform(-0.012, 0.012) * width, y + 2,
                           rng.uniform(0.012, 0.034) * height, rng.uniform(0, math.tau),
                           rng.uniform(-0.3, 0.3)))
    return np.array(blades, np.float32)


def _draw_grass(canvas: np.ndarray, view: View, wind: float, now: float, seed: int) -> None:
    """Backlit blades leaning with the wind and shivering in the gusts."""
    blades = _grass_blades(view.width, view.height, seed)
    roots = np.stack([blades[:, 0], blades[:, 1]], axis=1)
    sway = (0.18 * wind / MAX_WIND
            + 0.10 * np.sin(now * 2.4 + blades[:, 3]) * (0.4 + abs(wind) / MAX_WIND)
            + 0.04 * np.sin(now * 7.0 + blades[:, 3] * 2.0))
    lean = blades[:, 4] + sway
    tips = np.stack([blades[:, 0] + blades[:, 2] * lean, blades[:, 1] - 2 - blades[:, 2]], axis=1)
    ax, ay = view.screen_centre
    shift = np.float32((ax - view.centre[0] * view.zoom, ay - view.centre[1] * view.zoom))
    roots = (roots * np.float32(view.zoom) + shift).astype(np.int32)
    tips = (tips * np.float32(view.zoom) + shift).astype(np.int32)
    keep = (tips[:, 1] < view.height) & (roots[:, 0] >= -4) & (roots[:, 0] <= view.width + 4)
    segments = np.stack([roots[keep], tips[keep]], axis=1)
    thickness = max(1, int(round(view.zoom)))
    for k, colour in ((1, GRASS_LIT), (0, _lerp(GRASS_LIT, FOREGROUND, 0.45))):
        cv2.polylines(canvas, list(segments[k::2]), False, colour, thickness, cv2.LINE_AA)


def _view_matrix(view: View, ss: int) -> np.ndarray:
    k = view.zoom / ss
    ax, ay = view.screen_centre
    return np.array([[k, 0.0, ax - view.centre[0] * view.zoom],
                     [0.0, k, ay - view.centre[1] * view.zoom]], np.float64)


def _cloud_shade(view: View, clouds, valley: Valley) -> np.ndarray | None:
    """The cloud shadows as a darkening mask: drawn small and softened, so a
    few polygons become the soft-edged shapes clouds throw."""
    if not clouds:
        return None
    q = 8
    width, height = view.width, view.height
    mask = np.zeros((height // q + 1, width // q + 1), np.uint8)
    for x, d, rx, rd in clouds:
        pts = np.array([view.to_screen(*p) for p in _ground_ellipse(valley, x, d, rx, rd)], np.float32) / q
        cv2.fillPoly(mask, [pts.astype(np.int32)], 255, cv2.LINE_AA)
    if not mask.any():
        return None
    cv2.GaussianBlur(mask, (0, 0), max(2.0, 2.6 * view.zoom / q), dst=mask)
    shade = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
    return (shade * 0.26).astype(np.uint8)


def _ground_pass(canvas: np.ndarray, view: View, seed: int, clouds, valley: Valley) -> None:
    """Grain on the fields, then the cloud shadows drifting over them."""
    height, width = canvas.shape[:2]
    ss = 2
    texture = _ground_texture(width, height, ss, seed)
    if view.zoom == 1.0 and view.centre == (width / 2, height / 2):
        grain = cv2.resize(texture, (width, height), interpolation=cv2.INTER_AREA)
    else:
        grain = cv2.warpAffine(texture, _view_matrix(view, ss), (width, height),
                               flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    shade = _cloud_shade(view, clouds, valley)
    if shade is not None:
        cv2.subtract(grain, shade, dst=grain)
    cv2.multiply(canvas, cv2.cvtColor(grain, cv2.COLOR_GRAY2BGR), dst=canvas, scale=1.0 / 128.0)


def _paint_view(canvas: np.ndarray, view: View, seed: int, dynamics=(), clouds=()) -> None:
    """The whole valley through ``view``: the raster layer warped, then the scene."""
    height, width = canvas.shape[:2]
    ss = 2
    layer = _sky_layer(width, height, ss, seed)
    if view.zoom == 1.0 and view.centre == (width / 2, height / 2):
        cv2.resize(layer, (width, height), dst=canvas, interpolation=cv2.INTER_AREA)
    else:
        cv2.warpAffine(layer, _view_matrix(view, ss), (width, height), dst=canvas,
                       flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    valley = Valley(width, height)
    _scenery(width, height, seed).draw(
        canvas, view, dynamics,
        ground=lambda c: _ground_pass(c, view, seed, clouds, valley))


@lru_cache(maxsize=4)
def _wide_backdrop(width: int, height: int, seed: int) -> np.ndarray:
    """The unscoped frame's still parts are painted once and copied."""
    canvas = np.zeros((height, width, 3), np.uint8)
    _paint_view(canvas, View.wide(width, height), seed)
    return canvas


@lru_cache(maxsize=4)
def _scope_mask(width: int, height: int) -> np.ndarray:
    """Per-pixel brightness through the glass: full across the inner seventy
    percent, falling off only at the rim, and black outside it. Applied with
    one multiply."""
    radius = SCOPE_RADIUS * height
    ax, ay = View.scope_anchor(width, height)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    r = np.hypot(xs - ax, ys - ay) / radius
    inside = np.clip((1.0 - r) * radius / 5.0, 0.0, 1.0)
    vignette = 1.0 - 0.42 * np.clip((r - 0.7) / 0.3, 0.0, 1.0) ** 1.6
    mask = (inside * vignette * 255).astype(np.uint8)
    return np.dstack([mask, mask, mask])


@lru_cache(maxsize=4)
def _lens_ring(width: int, height: int) -> np.ndarray:
    """The chromatic edge of the glass, added over the picture: a ring just
    inside the tube that goes amber where the light comes in and blue across
    from it, the way a cheap objective colours its rim."""
    radius = SCOPE_RADIUS * height
    ax, ay = View.scope_anchor(width, height)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    dx, dy = xs - ax, ys - ay
    r = np.hypot(dx, dy) / radius
    band = np.clip((r - 0.90) / 0.07, 0.0, 1.0) * np.clip((1.01 - r) / 0.03, 0.0, 1.0)
    band = (band ** 1.4)[..., None]
    angle = np.arctan2(dy, dx)
    # Amber from the upper right (the sun's side), blue opposite.
    warm = 0.5 + 0.5 * np.cos(angle + math.pi * 0.3)
    amber = np.array((40, 150, 250), np.float32)
    blue = np.array((250, 170, 70), np.float32)
    colour = amber[None, None, :] * warm[..., None] + blue[None, None, :] * (1.0 - warm[..., None])
    return np.clip(colour * band * 0.55, 0, 255).astype(np.uint8)


def _glass_box(width: int, height: int) -> tuple[int, int, int, int]:
    """The square of the frame the glass can show, a little wider than the
    rim. Everything outside it is masked black, so the lens effects - shimmer,
    fringe, focus - are only worked inside it: a quarter of the frame."""
    ax, ay = View.scope_anchor(width, height)
    r = int(SCOPE_RADIUS * height) + 12
    return max(0, ax - r), max(0, ay - r), min(width, ax + r), min(height, ay + r)


@lru_cache(maxsize=4)
def _fringe_weight(width: int, height: int, cx: int, cy: int,
                   radius: float) -> tuple[np.ndarray, np.ndarray]:
    """How much of the lens's colour error shows - none in the middle, all at
    the rim - and its complement, as the blend wants both."""
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    r = np.hypot(xs - cx, ys - cy) / radius
    w = (np.clip((r - 0.35) / 0.65, 0.0, 1.0) ** 1.6).astype(np.float32)
    return w, (1.0 - w).astype(np.float32)


@lru_cache(maxsize=4)
def _lens_dirt(width: int, height: int) -> np.ndarray:
    """What the glass itself adds: a little dust, a thumb smudge, and the sun
    swept across the objective as a soft diagonal glare."""
    radius = SCOPE_RADIUS * height
    cx, cy = View.scope_anchor(width, height)
    rng = np.random.default_rng(3)
    dirt = np.zeros((height, width, 3), np.uint8)
    for _ in range(50):
        a, r = rng.uniform(0, math.tau), radius * math.sqrt(rng.uniform(0.05, 1.0))
        size = int(rng.uniform(1, 3))
        v = int(rng.uniform(3, 10))
        cv2.circle(dirt, (int(cx + r * math.cos(a)), int(cy + r * math.sin(a))), size,
                   (v, v, v), -1, cv2.LINE_AA)
    soft = np.zeros((height, width), np.uint8)
    # The smudge: a soft arc low on the left.
    cv2.ellipse(soft, (int(cx - radius * 0.45), int(cy + radius * 0.55)),
                (int(radius * 0.42), int(radius * 0.12)), -28, 0, 360, 16, -1, cv2.LINE_AA)
    # The glare: one broad sweep from the sun's side across the glass, and a
    # brighter core where it catches hardest.
    cv2.ellipse(soft, (int(cx + radius * 0.3), int(cy - radius * 0.3)),
                (int(radius * 0.95), int(radius * 0.13)), -38, 0, 360, 34, -1, cv2.LINE_AA)
    cv2.ellipse(soft, (int(cx + radius * 0.58), int(cy - radius * 0.58)),
                (int(radius * 0.2), int(radius * 0.06)), -42, 0, 360, 80, -1, cv2.LINE_AA)
    small = cv2.resize(soft, (width // 8, height // 8), interpolation=cv2.INTER_AREA)
    cv2.GaussianBlur(small, (0, 0), 5, dst=small)
    glare = cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)
    # Glare is warm: the sun's colour, not white.
    tint = np.array((0.8, 0.92, 1.0), np.float32)
    dirt = cv2.add(dirt, np.clip(glare[..., None].astype(np.float32) * tint, 0, 255).astype(np.uint8))
    # Only inside the glass.
    mask = np.zeros((height, width), np.uint8)
    cv2.circle(mask, (cx, cy), int(radius), 255, -1, cv2.LINE_AA)
    return cv2.bitwise_and(dirt, cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR))


@lru_cache(maxsize=4)
def _shimmer_grid(width: int, rows: int) -> tuple[np.ndarray, np.ndarray]:
    """Identity remap coordinates for the band of rows the heat rises through."""
    xs = np.tile(np.arange(width, dtype=np.float32), (rows, 1))
    ys = np.repeat(np.arange(rows, dtype=np.float32)[:, None], width, axis=1)
    return xs, ys


def _heat_shimmer(canvas: np.ndarray, now: float, zoom: float,
                  top: int | None = None, reach: int | None = None) -> None:
    """Warm ground seen through six times of glass: the lower half wobbles.

    ``top`` is the row the heat starts from (the middle of the glass) and
    ``reach`` how many rows the wobble grows over; both default to the whole
    canvas so a cut-out of the frame shimmers exactly as the frame would."""
    height, width = canvas.shape[:2]
    if top is None:
        top = View.scope_anchor(width, height)[1]
    if reach is None:
        reach = height - top
    rows = np.arange(height - top, dtype=np.float32)
    amp = (0.28 * zoom) * np.clip(rows / max(reach, 1), 0.0, 1.0) ** 0.7
    shift = amp * (np.sin(rows * 0.11 + now * 5.3) + 0.6 * np.sin(rows * 0.037 - now * 3.1))
    xs, ys = _shimmer_grid(width, height - top)
    roi = canvas[top:]
    out = cv2.remap(roi, xs + shift.astype(np.float32)[:, None], ys, cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_REPLICATE)
    roi[:] = out


def _chromatic_fringe(canvas: np.ndarray, anchor: tuple[int, int] | None = None,
                      radius: float | None = None) -> None:
    """The lens's colour error: red spreads outwards and blue inwards, more
    the further from the axis, so the rim of the picture fringes cyan and amber."""
    height, width = canvas.shape[:2]
    cx, cy = anchor if anchor is not None else View.scope_anchor(width, height)
    if radius is None:
        radius = SCOPE_RADIUS * height
    e = 0.006
    # Only the red and blue channels move, so only they are warped: a third of
    # the work of warping the whole picture twice, for the same result.
    blue_in, green, red_in = cv2.split(canvas)
    out = cv2.warpAffine(red_in, np.array([[1 + e, 0, -cx * e], [0, 1 + e, -cy * e]]),
                         (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    in_ = cv2.warpAffine(blue_in, np.array([[1 - e, 0, cx * e], [0, 1 - e, cy * e]]),
                         (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    w, inverse = _fringe_weight(width, height, cx, cy, radius)
    red = cv2.blendLinear(red_in, out, inverse, w)
    blue = cv2.blendLinear(blue_in, in_, inverse, w)
    cv2.merge([blue, green, red], dst=canvas)


# --- drawing the moving things ------------------------------------------------

_FACE = cv2.FontFace("uni") if hasattr(cv2, "FontFace") else None


def _mono_face():
    """A monospace face for the glass readout, if the system has one."""
    if not hasattr(cv2, "FontFace"):
        return None
    for path in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/SFNSMono.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        try:
            face = cv2.FontFace(path)
            cv2.getTextSize((0, 0), "0", (0, 0), face, 12)
            return face
        except cv2.error:
            continue
    return None


_MONO = _mono_face()


def _mono_width(text: str, size: int) -> int:
    if _MONO is None:
        return cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, size / 26, 1)[0][0]
    return cv2.getTextSize((0, 0), text, (0, 0), _MONO, size)[2]


def _mono(canvas: np.ndarray, text: str, origin: tuple[int, int], colour, size: int,
          weight: int = 400) -> int:
    origin = (int(origin[0]), int(origin[1]))
    if _MONO is None:
        cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, size / 26, colour,
                    2 if weight >= 600 else 1, cv2.LINE_AA)
    else:
        cv2.putText(canvas, text, origin, colour, _MONO, size, weight)
    return _mono_width(text, size)


def _label_width(text: str, size: int) -> int:
    if _FACE is None:
        return cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, size / 26, 1)[0][0]
    return cv2.getTextSize((0, 0), text, (0, 0), _FACE, size)[2]


def _label(canvas: np.ndarray, text: str, origin: tuple[int, int], colour,
           size: int, weight: int = 0) -> int:
    """Text in the interface's own face, ``size`` pixels tall, baseline left.
    One font for the whole readout, numerals included. Returns the width."""
    origin = (int(origin[0]), int(origin[1]))
    if _FACE is None:
        cv2.putText(canvas, text, origin, cv2.FONT_HERSHEY_SIMPLEX, size / 26, colour,
                    2 if weight >= 600 else 1, cv2.LINE_AA)
    else:
        cv2.putText(canvas, text, origin, colour, _FACE, size, weight)
    return _label_width(text, size)


def _soft_blob(canvas: np.ndarray, cx: float, cy: float, rx: float, ry: float,
               colour, alpha: float) -> None:
    """A translucent ellipse, blended only inside its own box so it is cheap."""
    height, width = canvas.shape[:2]
    rx, ry = max(1, int(rx)), max(1, int(ry))
    x0, y0 = max(int(cx - rx) - 1, 0), max(int(cy - ry) - 1, 0)
    x1, y1 = min(int(cx + rx) + 2, width), min(int(cy + ry) + 2, height)
    if x1 <= x0 or y1 <= y0 or alpha <= 0.01:
        return
    roi = canvas[y0:y1, x0:x1]
    layer = roi.copy()
    cv2.ellipse(layer, (int(cx) - x0, int(cy) - y0), (rx, ry), 0, 0, 360, colour, -1, cv2.LINE_AA)
    cv2.addWeighted(roi, 1.0 - alpha, layer, alpha, 0.0, dst=roi)


def _draw_person(canvas: np.ndarray, figure: Figure, colour, rim) -> None:
    """A hostile, the same at every size: a hard dark silhouette, a rim of sun
    down the right-hand side, and a long shadow lying the way every shadow does."""
    h = figure.height
    x, ground = figure.x, figure.ground_y
    if not figure.alive:
        _draw_fallen(canvas, figure, colour, rim)
        return
    if figure.shadow is not None:
        # The shadow: from the feet to where the head's falls, tapering.
        tip = figure.shadow
        foot_w = max(1.0, h * 0.14)
        poly = np.array([(x - foot_w, ground), (x + foot_w, ground),
                         (tip[0] + foot_w * 0.45, tip[1]), (tip[0] - foot_w * 0.45, tip[1])], np.int32)
        cv2.fillPoly(canvas, [poly], _hazed(SHADOW, figure.distance), cv2.LINE_AA)
    if h < 3.0:
        cv2.circle(canvas, (int(x), int(ground - h * 0.5)), 1, FIGURE_EDGE, -1, cv2.LINE_AA)
        return

    def paint(col, dx: float, dy: float, grow: float) -> None:
        limb = max(1, int(round(h * 0.075 + grow * 1.6)))
        stride = math.sin(figure.phase) * h * 0.09 * (0.0 if figure.kind == "sentry" else 1.0)
        for side in (-1, 1):
            hip = (int(x + dx + side * h * 0.04), int(figure.hip_y + dy))
            foot = (int(x + dx + side * h * 0.05 + stride * side), int(ground + dy))
            cv2.line(canvas, hip, foot, col, limb, cv2.LINE_AA)
        torso = np.array([
            (x + dx - figure.half_width - grow, figure.shoulder_y + dy),
            (x + dx + figure.half_width + grow, figure.shoulder_y + dy),
            (x + dx + figure.half_width * 0.7 + grow, figure.hip_y + dy),
            (x + dx - figure.half_width * 0.7 - grow, figure.hip_y + dy)], np.int32)
        cv2.fillPoly(canvas, [torso], col, cv2.LINE_AA)
        # The rifle, slung low across the front.
        cv2.line(canvas, (int(x + dx - figure.facing * h * 0.12), int(figure.hip_y + dy - h * 0.02)),
                 (int(x + dx + figure.facing * h * 0.32), int(figure.shoulder_y + dy + h * 0.04)),
                 col, max(1, int(limb * 0.7 + grow * 0.5)), cv2.LINE_AA)
        head = (int(figure.head[0] + dx), int(figure.head[1] + dy))
        cv2.circle(canvas, head, max(1, int(figure.head_radius + grow)), col, -1, cv2.LINE_AA)

    if h >= 14.0:
        # Big enough for an outline: the silhouette a shade wider than the
        # body, so the figure has a hard dark edge against whatever it stands
        # in front of, then the rim of sun down the right as the body shifted
        # sunward and mostly covered by the body itself.
        paint(FIGURE_EDGE, 0.0, 0.0, min(max(1.0, h * 0.04), 4.0))
        paint(rim, min(max(1.0, h * 0.04), 3.5), -min(max(0.5, h * 0.015), 1.5), 0.0)
        paint(colour, 0.0, 0.0, 0.0)
        # A warmer, broader catch of light on the shoulder and the head.
        cv2.ellipse(canvas, (int(figure.head[0] + figure.head_radius * 0.45), int(figure.head[1] - figure.head_radius * 0.2)),
                    (max(1, int(figure.head_radius * 0.35)), max(1, int(figure.head_radius * 0.6))), 0, 0, 360,
                    rim, -1, cv2.LINE_AA)
        return
    # Small on screen: the silhouette, then the lit edge as a hairline down the
    # sunward side - one bright pixel is what says which way the light comes.
    paint(colour, 0.0, 0.0, 0.0)
    cv2.line(canvas, (int(x + figure.half_width), int(figure.shoulder_y)),
             (int(x + figure.half_width * 0.7), int(figure.hip_y)), rim, 1, cv2.LINE_AA)
    cv2.circle(canvas, (int(figure.head[0] + 1), int(figure.head[1])), 1, rim, -1, cv2.LINE_AA)


def _draw_fallen(canvas: np.ndarray, figure: Figure, colour, rim) -> None:
    """Where they fell, and how: a body lying along the ground, an arm flung
    out, and the dust the fall threw up hanging in the air over it for a while."""
    h = figure.height / 0.35  # the height they stood
    x, ground = figure.x, figure.ground_y
    facing = figure.facing
    haze = figure.distance
    # The ground keeps a darker scuff where they went down.
    cv2.ellipse(canvas, (int(x), int(ground)), (max(2, int(h * 0.7)), max(1, int(h * 0.11))),
                0, 0, 360, _hazed(_lerp(SHADOW, FLOOR_NEAR, 0.4), haze), -1, cv2.LINE_AA)
    if h < 4.0:
        cv2.line(canvas, (int(x - h * 0.4), int(ground - 1)), (int(x + h * 0.4), int(ground - 1)),
                 FIGURE_EDGE, 1, cv2.LINE_AA)
        return
    thick = max(1, int(round(h * 0.13)))
    limb = max(1, int(round(h * 0.07)))
    hip = (x - facing * h * 0.05, ground - h * 0.07)
    shoulder = (x + facing * h * 0.33, ground - h * 0.09)
    head = (x + facing * h * 0.46, ground - h * 0.1)
    head_r = max(1, int(h * 0.07))

    def body(col, dy: float, grow: int) -> None:
        cv2.line(canvas, (int(hip[0]), int(hip[1] + dy)), (int(shoulder[0]), int(shoulder[1] + dy)),
                 col, thick + grow, cv2.LINE_AA)
        # Legs trailing the other way, one bent.
        cv2.line(canvas, (int(hip[0]), int(hip[1] + dy)), (int(hip[0] - facing * h * 0.38), int(ground - h * 0.03 + dy)),
                 col, limb + grow, cv2.LINE_AA)
        cv2.line(canvas, (int(hip[0]), int(hip[1] + dy)), (int(hip[0] - facing * h * 0.22), int(ground - h * 0.16 + dy)),
                 col, limb + grow, cv2.LINE_AA)
        cv2.line(canvas, (int(hip[0] - facing * h * 0.22), int(ground - h * 0.16 + dy)),
                 (int(hip[0] - facing * h * 0.4), int(ground - h * 0.12 + dy)), col, limb + grow, cv2.LINE_AA)
        # One arm out above the head, the other under the body.
        cv2.line(canvas, (int(shoulder[0]), int(shoulder[1] + dy)),
                 (int(shoulder[0] + facing * h * 0.2), int(ground - h * 0.22 + dy)), col, limb + grow, cv2.LINE_AA)
        cv2.circle(canvas, (int(head[0]), int(head[1] + dy)), head_r + grow, col, -1, cv2.LINE_AA)

    # Dust: a puff that climbs and thins for six seconds behind them, then a
    # trace of it that stays on the ground.
    age = figure.fallen_for
    if age < 6.0:
        u = age / 6.0
        for k, (ox, oy, r) in enumerate(((0.0, 0.25, 0.45), (0.35, 0.12, 0.32), (-0.3, 0.18, 0.36))):
            rad = h * r * (0.4 + 0.9 * u)
            _soft_blob(canvas, x + ox * h + u * h * 0.3 * k, ground - (oy + 0.45 * u) * h,
                       rad, rad * 0.7, _hazed(DUST, haze), 0.32 * (1.0 - u) ** 1.4)
    _soft_blob(canvas, x, ground - h * 0.1, h * 0.75, h * 0.25, _hazed(DUST, haze), 0.12)

    if h >= 14.0:
        body(FIGURE_EDGE, 0.0, min(4, max(1, int(h * 0.04))))
    body(colour, 0.0, 0)
    # The sun still finds the top of them.
    cv2.line(canvas, (int(hip[0]), int(hip[1] - thick * 0.45)), (int(shoulder[0]), int(shoulder[1] - thick * 0.45)),
             rim, 1, cv2.LINE_AA)
    # The rifle dropped beside them.
    cv2.line(canvas, (int(x + facing * h * 0.1), int(ground - h * 0.02)),
             (int(x + facing * h * 0.5), int(ground + h * 0.02)), FIGURE_EDGE, 1, cv2.LINE_AA)


def _draw_vehicle(canvas: np.ndarray, figure: Figure) -> None:
    h, half = figure.height, figure.half_width
    x, ground = figure.x, figure.ground_y
    if h < 3:
        cv2.circle(canvas, (int(x), int(ground - 1)), 2, FIGURE_EDGE, -1)
        return
    body_top = ground - h * 0.95
    cv2.ellipse(canvas, (int(x - h * 1.2), int(ground + h * 0.05)), (max(2, int(half * 1.15)), max(1, int(h * 0.14))),
                0, 0, 360, SHADOW, -1, cv2.LINE_AA)
    cv2.rectangle(canvas, (int(x - half) - 1, int(body_top) - 1), (int(x + half) + 1, int(ground - h * 0.22) + 1),
                  FIGURE_EDGE, -1)
    cv2.rectangle(canvas, (int(x - half), int(body_top)), (int(x + half), int(ground - h * 0.22)),
                  TRUCK, -1)
    if figure.alive:
        cv2.rectangle(canvas, (int(x - half), int(body_top)), (int(x + half), int(body_top + h * 0.12)),
                      TRUCK_LIT, -1)
    cab_x0 = x + figure.facing * half * 0.28
    cab_x1 = x + figure.facing * half
    cv2.rectangle(canvas, (int(min(cab_x0, cab_x1)) - 1, int(ground - h) - 1),
                  (int(max(cab_x0, cab_x1)) + 1, int(ground - h * 0.22)), FIGURE_EDGE, -1)
    cv2.rectangle(canvas, (int(min(cab_x0, cab_x1)), int(ground - h)),
                  (int(max(cab_x0, cab_x1)), int(ground - h * 0.22)), TRUCK_LIT, -1)
    win = figure.head
    cv2.rectangle(canvas, (int(win[0] - figure.head_radius), int(win[1] - figure.head_radius * 0.7)),
                  (int(win[0] + figure.head_radius), int(win[1] + figure.head_radius * 0.7)),
                  WINDOW if figure.alive else BLOOD, -1)
    # Sun on the cab roof.
    cv2.line(canvas, (int(min(cab_x0, cab_x1)), int(ground - h)), (int(max(cab_x0, cab_x1)), int(ground - h)),
             FIGURE_RIM, 1, cv2.LINE_AA)
    # And down the right-hand edge, whichever end that is.
    cv2.line(canvas, (int(x + half), int(body_top)), (int(x + half), int(ground - h * 0.22)),
             RIM_WARM, max(1, int(h * 0.04)), cv2.LINE_AA)
    for wx in (x - half * 0.65, x + half * 0.65):
        cv2.circle(canvas, (int(wx), int(ground - h * 0.18)), max(1, int(h * 0.2)), FIGURE_EDGE, -1, cv2.LINE_AA)
    if not figure.alive:
        cv2.ellipse(canvas, (int(x), int(body_top - h * 0.25)), (max(2, int(half * 0.5)), max(2, int(h * 0.4))),
                    0, 0, 360, (40, 40, 44), -1, cv2.LINE_AA)


def _draw_crater(canvas: np.ndarray, crater, view: View) -> None:
    """Where a round went into the ground: a scorch that stays all round."""
    base_x, base_y, distance = crater
    sx, sy = view.to_screen(base_x, base_y)
    if not (-20 <= sx <= view.width + 20 and -20 <= sy <= view.height + 20):
        return
    metres_px = FOCAL_FRACTION * view.width * view.zoom / max(distance, 1.0)
    rx = max(2, int(metres_px * 0.45))
    ry = max(1, int(rx * 0.4))
    # The thrown earth - pale, the subsoil turned up - then the small dark hole.
    _soft_blob(canvas, sx, sy, rx * 1.8, ry * 1.6, _hazed((118, 150, 172), distance), 0.45)
    if rx >= 4:
        cv2.ellipse(canvas, (int(sx), int(sy)), (rx, ry), 0, 0, 360, _hazed((34, 42, 48), distance), -1, cv2.LINE_AA)
    if rx >= 6:
        cv2.ellipse(canvas, (int(sx), int(sy - ry * 0.5)), (int(rx * 0.85), max(1, int(ry * 0.5))), 0, 190, 350,
                    _hazed((110, 128, 140), distance), 1, cv2.LINE_AA)


def _draw_windsock(canvas: np.ndarray, view: View, valley: Valley, wind: float, now: float) -> None:
    sx, sd, sh = WINDSOCK
    top = view.to_screen(*valley.project(sx, sd, sh))
    per_m = valley.size_px(1.0, sd) * view.zoom
    if per_m < 1.2:
        return
    strength = min(abs(wind) / MAX_WIND, 1.0)
    side = 1.0 if wind >= 0 else -1.0
    reach = (0.6 + 2.6 * strength) * per_m
    droop = (2.4 * (1.0 - strength) ** 1.5 + 0.3) * per_m
    flap = math.sin(now * (5.0 + 9.0 * strength)) * per_m * (0.25 + 0.35 * strength)
    pts = []
    for k, u in enumerate((0.0, 0.35, 0.7, 1.0)):
        px = top[0] + side * reach * u
        py = top[1] + droop * u * u + flap * u * math.sin(k * 1.7 + now * 3.0) * 0.3
        w = per_m * (0.55 - 0.28 * u)
        pts.append(((px, py - w), (px, py + w)))
    outline = np.array([p[0] for p in pts] + [p[1] for p in reversed(pts)], np.int32)
    orange = _hazed((50, 110, 240), sd)
    white = _hazed((230, 238, 244), sd)
    cv2.fillPoly(canvas, [outline], orange, cv2.LINE_AA)
    band = np.array([pts[1][0], pts[2][0], pts[2][1], pts[1][1]], np.int32)
    cv2.fillPoly(canvas, [band], white, cv2.LINE_AA)


def _draw_smoke(canvas: np.ndarray, view: View, valley: Valley, wind: float, now: float) -> None:
    """The farmhouse chimney: puffs that rise, spread and go with the wind."""
    fx, fd = FARM
    per_m = valley.size_px(1.0, fd) * view.zoom
    if per_m < 1.0:
        return
    for k in range(9):
        age = ((now * 0.45 + k * 0.111) % 1.0)
        rise = 1.2 + age * 9.0
        drift = age * age * wind * 4.0 + math.sin(now * 1.3 + k) * 0.4 * age
        px, py = view.to_screen(*valley.project(fx + 3.6 + drift, fd, 6.0 + rise))
        r = max(1, int(per_m * (0.3 + 1.6 * age)))
        fade = 1.0 - age
        colour = _lerp(_hazed((150, 158, 164), fd), (236, 240, 244), 0.3 * fade)
        px += math.sin(k * 2.3 + now * 0.7) * r * 0.5
        _soft_blob(canvas, px, py, r, r * 0.8, colour, 0.32 * (0.3 + 0.7 * fade))


def _draw_dust(canvas: np.ndarray, view: View, valley: Valley, dust, wind: float, now: float) -> None:
    """Dust lifted off the road and the fields, going with the wind."""
    for x0, d, born, strength in dust:
        age = now - born
        if age < 0.0 or age > DUST_SECONDS:
            continue
        u = age / DUST_SECONDS
        x = x0 + wind * 1.1 * age + math.sin(age * 2.0 + x0) * 0.4
        lift = 0.4 + 2.2 * u
        px, py = view.to_screen(*valley.project(x, d, lift))
        per_m = valley.size_px(1.0, d) * view.zoom
        r = per_m * (0.8 + 3.2 * u) * strength
        if r < 1.0:
            continue
        alpha = 0.42 * (1.0 - u) ** 1.3 * min(1.0, strength)
        _soft_blob(canvas, px, py, r, r * 0.55, _hazed(DUST, d), alpha)


DUST_SECONDS = 3.2
MAX_DUST = 28


def _draw_clouds(canvas: np.ndarray, view: View, drift: float, seed: int) -> None:
    """Long, thin clouds lit from below, going across with the wind."""
    width, height = view.width, view.height
    horizon = HORIZON_FRACTION * height
    rng = np.random.default_rng(seed + 9)
    span = 1.4 * width
    for _ in range(6):
        cy = horizon - rng.uniform(0.12, 0.3) * height
        cx = rng.uniform(0.0, span)
        length = rng.uniform(0.07, 0.2) * width
        thick = rng.uniform(0.004, 0.009) * height
        rate = rng.uniform(0.7, 1.3)
        x = (cx + drift * rate) % span - 0.2 * width
        sx, sy = view.to_screen(x, cy)
        if sx + length * view.zoom < 0 or sx - length * view.zoom > width or sy > height or sy < -20:
            continue
        axes = (max(1, int(length * view.zoom)), max(1, int(thick * view.zoom)))
        cv2.ellipse(canvas, (int(sx), int(sy)), axes, 0, 0, 360, _lerp(SKY_MID, SUN, 0.5), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (int(sx), int(sy + thick * 0.9 * view.zoom)),
                    (max(1, int(length * 0.9 * view.zoom)), max(1, int(thick * 0.6 * view.zoom))),
                    0, 0, 360, _lerp(SKY_MID, SKY_TOP, 0.35), -1, cv2.LINE_AA)


def _draw_birds(canvas: np.ndarray, view: View, now: float) -> None:
    """A skein crossing the valley, high over the far ridge."""
    width, height = view.width, view.height
    horizon = HORIZON_FRACTION * height
    lead_x = (0.2 * width + now * 0.022 * width) % (1.5 * width) - 0.25 * width
    lead_y = horizon - 0.2 * height + math.sin(now * 0.3) * 0.01 * height
    wing = 0.0045 * width
    colour = (40, 38, 44)
    for k in range(7):
        row = (k + 1) // 2
        side = -1 if k % 2 else 1
        bx = lead_x - row * wing * 2.6
        by = lead_y + side * row * wing * 1.3 * (1 if k else 0)
        flap = math.sin(now * 7.0 + k * 0.9) * wing * 0.8
        sx, sy = view.to_screen(bx, by)
        if not (-10 <= sx <= width + 10 and -10 <= sy <= height + 10):
            continue
        z = view.zoom
        for w in (-1, 1):
            cv2.line(canvas, (int(sx), int(sy)), (int(sx + w * wing * z), int(sy - flap * z)),
                     colour, max(1, int(z * 0.6)), cv2.LINE_AA)


def _draw_tag(canvas: np.ndarray, figure: Figure, now: float, scale: float) -> None:
    """A spotter's mark on a live hostile in the wide view: a bracket that
    breathes, and the range in the interface face - the brightest thing in
    the valley, so a speck on a road reads as a target."""
    x, y = figure.x, figure.ground_y - figure.height * 0.5
    pulse = 0.5 + 0.5 * math.sin(now * 3.2 + figure.phase)
    reach = max(10.0 * scale, figure.height * 0.95) + 3.0 * scale * pulse
    gap = reach * 0.5
    col = TAG if figure.kind != "vehicle" else (120, 200, 255)
    thin = max(1, round(1.2 * scale))
    for pass_colour, thick in ((TAG_DARK, thin + 2), (col, thin)):
        for sx_, sy_ in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            cx_, cy_ = int(x + sx_ * reach), int(y + sy_ * reach)
            cv2.line(canvas, (cx_, cy_), (int(cx_ - sx_ * gap), cy_), pass_colour, thick, cv2.LINE_AA)
            cv2.line(canvas, (cx_, cy_), (cx_, int(cy_ - sy_ * gap)), pass_colour, thick, cv2.LINE_AA)
    label = f"{figure.distance:.0f} m"
    size = max(11, round(12.5 * scale))
    tw = _label_width(label, size)
    pad = max(3, round(3.5 * scale))
    tx, ty = int(x + reach + 5 * scale), int(y - reach + size * 0.5)
    box = (tx - pad, ty - size - pad + 2, tx + tw + pad, ty + pad)
    cv2.rectangle(canvas, box[:2], box[2:], TAG_DARK, -1)
    cv2.line(canvas, (box[0], box[1]), (box[0], box[3]), col, max(1, round(2 * scale)))
    _label(canvas, label, (tx + 1, ty), col, size, 600)


def _draw_glass_mark(canvas: np.ndarray, figure: Figure, now: float, scale: float) -> None:
    """Through the glass a live hostile gets a faint breathing bracket: enough
    to say 'that one moves', not enough to get in the way of the shot."""
    ax, ay = View.scope_anchor(canvas.shape[1], canvas.shape[0])
    radius = SCOPE_RADIUS * canvas.shape[0]
    x, y = figure.x, figure.ground_y - figure.height * 0.5
    if math.hypot(x - ax, y - ay) > radius * 0.92:
        return
    pulse = 0.5 + 0.5 * math.sin(now * 2.6 + figure.phase)
    reach = figure.height * 0.75 + 6.0 * scale * pulse
    gap = reach * 0.35
    col = (150, 200, 120) if figure.kind != "vehicle" else (120, 190, 230)
    for sx_, sy_ in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        cx_, cy_ = int(x + sx_ * reach), int(y + sy_ * reach)
        cv2.line(canvas, (cx_, cy_), (int(cx_ - sx_ * gap), cy_), col, 1, cv2.LINE_AA)
        cv2.line(canvas, (cx_, cy_), (cx_, int(cy_ - sy_ * gap)), col, 1, cv2.LINE_AA)


def _draw_shot(canvas: np.ndarray, shot: Shot, view: View, now: float, ttl: float, scale: float) -> None:
    zoom = view.zoom
    if now < shot.lands:
        # A tracer: a bright streak a little way behind the round itself.
        u = min(max((now - shot.fired) / max(shot.lands - shot.fired, 1e-6), 0.0), 1.0)
        u = u ** 0.85  # quick out of the barrel, slowing with drag
        ox, oy = shot.origin
        tx, ty = shot.target
        head = view.to_screen(ox + (tx - ox) * u, oy + (ty - oy) * u)
        tail_u = max(u - 0.05, 0.0)
        tail = view.to_screen(ox + (tx - ox) * tail_u, oy + (ty - oy) * tail_u)
        cv2.line(canvas, (int(tail[0]), int(tail[1])), (int(head[0]), int(head[1])),
                 TRACER, 1 if zoom < 2 else 2, cv2.LINE_AA)
        return

    age = now - shot.lands
    life = max(0.0, 1.0 - age / ttl)
    if life <= 0.0:
        return
    sx, sy = view.to_screen(*shot.target)
    centre = (int(sx), int(sy))
    # Apparent size of the puff: a couple of metres at that range.
    metres_px = FOCAL_FRACTION * view.width * zoom / max(shot.distance, 1.0)
    if shot.zone is None or shot.hit_vehicle:
        spread = 1.0 - life
        radius = max(2, int(metres_px * (0.6 + 2.2 * spread)))
        _soft_blob(canvas, centre[0], sy - radius * 0.5, radius, radius, DUST, 0.55 * life)
        _soft_blob(canvas, sx - radius * 0.6, sy - radius * 0.3, radius * 0.7, radius * 0.7, DUST, 0.45 * life)
    else:
        radius = max(2, int(metres_px * 0.35 * (1.0 + (1.0 - life))))
        _soft_blob(canvas, sx, sy, radius, radius, BLOOD, 0.7 * life ** 0.5)
    if shot.zone is not None and age < 1.6:
        lift = int((14 + 26 * age) * scale)
        x_text = centre[0] + int(12 * scale)
        size = max(12, round(15 * scale))
        if shot.label:
            _label(canvas, shot.label, (x_text + 1, centre[1] - lift + 1), TAG_DARK, size, 700)
            _label(canvas, shot.label, (x_text, centre[1] - lift), BLOOD if not shot.hit_vehicle else DUST,
                   size, 700)
            lift += int(20 * scale)
        _label(canvas, f"+{shot.points}", (x_text + 1, centre[1] - lift + 1), TAG_DARK, size, 700)
        _label(canvas, f"+{shot.points}", (x_text, centre[1] - lift), SCORE_INK, size, 700)


def _draw_reticle(canvas: np.ndarray, round_: SniperRound, now: float) -> None:
    width, height = canvas.shape[1], canvas.shape[0]
    cx, cy = View.scope_anchor(width, height)
    radius = int(SCOPE_RADIUS * height)
    mil = round_.valley.mil_px(round_.view.zoom)
    thick = max(2, int(height / 420))
    scale = round_.options.scale

    def line(a, b, t=thick) -> None:
        cv2.line(canvas, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), RETICLE, t, cv2.LINE_AA)

    # German #4: heavy posts in from the rim, fine cross in the middle.
    post = max(4, int(height / 90))
    reach = radius * 0.55
    line((cx - radius, cy), (cx - reach, cy), post)
    line((cx + radius, cy), (cx + reach, cy), post)
    line((cx, cy + radius), (cx, cy + reach), post)
    gap = mil * 0.5
    line((cx - reach, cy), (cx - gap, cy))
    line((cx + gap, cy), (cx + reach, cy))
    line((cx, cy - reach * 0.8), (cx, cy - gap))
    line((cx, cy + gap), (cx, cy + reach))
    # Mil dots each way, and the holdover ticks below the centre.
    dot = max(2, int(mil * 0.16))
    for k in range(1, 6):
        for px, py in ((cx - k * mil, cy), (cx + k * mil, cy), (cx, cy - k * mil)):
            if math.hypot(px - cx, py - cy) < reach:
                cv2.circle(canvas, (int(px), int(py)), dot, RETICLE, -1, cv2.LINE_AA)
    for k in range(1, 12):
        y = cy + k * mil
        if y > cy + reach:
            break
        half = mil * (0.32 if k % 2 else 0.18)
        line((cx - half, y), (cx + half, y), max(1, thick - 1))
    # Where the round lands at round ranges, labelled in hundreds of metres.
    for metres in (200, 300, 400, 500, 600):
        hold = mils(bullet_drop(metres), metres)
        y = cy + hold * mil
        if y > cy + reach:
            continue
        _label(canvas, str(metres // 100), (int(cx + mil * 0.7), int(y + 5)), RETICLE,
               max(10, round(11 * scale)), 600)

    # The readout: range, hold and wind on a dark band across the foot of the
    # glass, in a light monospace face, so it reads against anything the
    # scope happens to be looking at.
    distance, hostile = round_.range_under_reticle(now)
    size = max(12, round(14 * scale))
    big = size + round(9 * scale)
    band_top = int(cy + radius * 0.62)
    _lens_band(canvas, cx, cy, radius, band_top)
    if math.isfinite(distance):
        hold = mils(bullet_drop(distance), distance)
        drift = mils(wind_drift(distance, round_.wind), distance)
        arrow = ">" if drift > 0 else "<"
        left = f"{distance:.0f} m"
        lines = (f"HOLD {hold:.1f}", f"WIND {abs(drift):.1f} {arrow}")
    else:
        left, lines = "--- m", ("SKY", "")
    # The range, large, left of centre; the hold and the wind stacked to the
    # right of it, the column divided by a hairline.
    row = int(radius * 0.115)
    y1 = band_top + int(radius * 0.07) + size
    y2 = y1 + row
    ty = (y1 + y2) // 2 + big // 2 - round(3 * scale)
    gap = int(14 * scale)
    x_left = cx - gap - _mono_width(left, big)
    x_right = cx + gap
    _mono(canvas, left, (x_left, ty), INFO, big, 600)
    _mono(canvas, lines[0], (x_right, y1), INFO, size, 400)
    _mono(canvas, lines[1], (x_right, y2), _lerp(INFO, (0, 0, 0), 0.2), size, 400)
    cv2.line(canvas, (cx, y1 - size), (cx, y2 + round(3 * scale)), (80, 84, 88), 1, cv2.LINE_AA)
    if hostile is not None:
        # On target: the lock light beside the range.
        pulse = 0.5 + 0.5 * math.sin(now * 6.0)
        cv2.circle(canvas, (x_left - int(12 * scale), ty - size // 2), max(2, int(3 * scale)),
                   _lerp((60, 140, 60), (120, 250, 130), pulse), -1, cv2.LINE_AA)

    # The rim of the tube, and the eyepiece housing around it: a little grey
    # in the black, so the glass sits in something.
    cv2.circle(canvas, (cx, cy), radius + int(radius * 0.075), (22, 22, 25), int(radius * 0.09), cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), radius + int(radius * 0.12), (34, 34, 38), 2, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), radius + 5, (8, 8, 10), 10, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), radius, (26, 27, 30), 2, cv2.LINE_AA)


@lru_cache(maxsize=4)
def _band_mask(width: int, height: int, cx: int, cy: int, radius: int, top: int) -> np.ndarray:
    """The dark band's shape: the chord of the glass below ``top``."""
    mask = np.zeros((height, width), np.uint8)
    cv2.circle(mask, (cx, cy), radius, 255, -1, cv2.LINE_AA)
    mask[:top] = 0
    # A soft upper edge.
    feather = max(2, radius // 40)
    mask[top:top + feather] = (mask[top:top + feather].astype(np.float32)
                               * np.linspace(0.0, 1.0, feather)[:, None]).astype(np.uint8)
    # What is kept of the picture under the band, and the band's own dark grey
    # laid over it, so a black silhouette under the band is buried in it too.
    bottom = min(cy + radius + 2, height)
    keep = cv2.cvtColor((255 - mask[top:bottom] * 0.95).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    lift = cv2.cvtColor((mask[top:bottom] * (16.0 / 255.0)).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    return keep, lift


def _lens_band(canvas: np.ndarray, cx: int, cy: int, radius: int, top: int) -> None:
    height, width = canvas.shape[:2]
    keep, lift = _band_mask(width, height, cx, cy, radius, top)
    roi = canvas[top:top + keep.shape[0]]
    cv2.multiply(roi, keep, dst=roi, scale=1.0 / 255.0)
    cv2.add(roi, lift, dst=roi)


def _soft_focus(canvas: np.ndarray, strength: float) -> None:
    """The moment the eye finds the glass: a blur that clears in a third of a second."""
    if strength <= 0.02:
        return
    h, w = canvas.shape[:2]
    small = cv2.resize(canvas, (max(8, w // 6), max(8, h // 6)), interpolation=cv2.INTER_AREA)
    cv2.GaussianBlur(small, (0, 0), 1.5 + 4.0 * strength, dst=small)
    blend(canvas, cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR), min(1.0, strength))


def _painters(round_: SniperRound, now: float, view: View) -> list:
    """Everything that moves, as (distance, painter) pairs for the scene to slot in."""
    valley = round_.valley
    painters = []
    for hostile in round_.fallen + round_.hostiles:
        figure = hostile.figure(view, now, valley)
        depth = figure.distance + (0.5 if not hostile.alive_at(now) else 0.0)
        if hostile.kind == "vehicle":
            painters.append((depth, lambda c, f=figure: _draw_vehicle(c, f)))
        else:
            painters.append((depth, lambda c, f=figure: _draw_person(c, f, FIGURE, FIGURE_RIM)))
    for crater in round_.craters:
        painters.append((crater[2] + 0.75, lambda c, k=crater: _draw_crater(c, k, view)))
    wind = round_.wind
    painters.append((WINDSOCK[1] - 0.01, lambda c: _draw_windsock(c, view, valley, wind, now)))
    painters.append((FARM[1] - 0.5, lambda c: _draw_smoke(c, view, valley, wind, now)))
    dust = list(round_.dust)
    painters.append((100.0, lambda c: _draw_dust(c, view, valley, dust, wind, now)))
    return painters


def hud_origin(width: int, height: int, scale: float) -> tuple[int, int]:
    """Where the app puts the score block (see ``app.layout_for``), so the
    world can lay a panel under it before the text arrives."""
    margin = max(1, round(16 * scale))
    return (width // 4 + margin + max(1, round(28 * scale)), margin)


def hud_panel(width: int, height: int, scale: float) -> tuple[int, int, int, int]:
    """The one panel the camera feed and the whole readout sit on: from the
    camera's corner (``app.layout_for`` puts it at the margin, a quarter of the
    window each way) across to the end of the score block."""
    margin = max(1, round(16 * scale))
    pad = round(10 * scale)
    x, y = hud_origin(width, height, scale)
    right = x + round(330 * scale)
    bottom = max(margin + height // 4, y + round(196 * scale)) + pad
    return (margin - pad, margin - pad, right, bottom)


def _hud_backing(canvas: np.ndarray, width: int, height: int, scale: float) -> None:
    """A solid panel behind the camera and the whole readout - score, tally,
    wind - drawn as part of the world, so the text the app lays on top sits on
    a panel rather than on the sky, and the feed is framed by the same panel."""
    x0, y0, x1, y1 = hud_panel(width, height, scale)
    _panel(canvas, x0, y0, x1, y1, 0.93)
    cv2.rectangle(canvas, (x0, y0), (x1 - 1, y1 - 1), (40, 42, 44), 1)
    # The score block's own division from the feed: a hairline.
    x, y = hud_origin(width, height, scale)
    cv2.line(canvas, (x - round(16 * scale), y + round(6 * scale)),
             (x - round(16 * scale), y1 - round(16 * scale)), (40, 42, 44), 1)


def draw_world(canvas: np.ndarray, round_: SniperRound, now: float) -> None:
    height, width = canvas.shape[:2]
    round_.set_frame(width, height)
    seed = round_.options.seed or 0
    scale = round_.options.scale
    view = round_.view
    painters = _painters(round_, now, view)
    clouds = [tuple(c) for c in round_.clouds]

    if view.zoom == 1.0:
        canvas[:] = _wide_backdrop(width, height, seed)
        _draw_clouds(canvas, view, round_.sky_drift, seed)
        _draw_birds(canvas, view, now)
        valley = round_.valley
        # The cloud shadows move over the still backdrop; the grain is baked in.
        shade = _cloud_shade(view, clouds, valley)
        if shade is not None:
            top = int(valley.horizon)
            light = cv2.subtract(np.full_like(shade[top:], 255), shade[top:])
            cv2.multiply(canvas[top:], cv2.cvtColor(light, cv2.COLOR_GRAY2BGR), dst=canvas[top:],
                         scale=1.0 / 255.0)
        for _, painter in sorted(painters, key=lambda p: -p[0]):
            painter(canvas)
        _draw_grass(canvas, view, round_.wind, now, seed)
        if not round_.scoped:
            for hostile in round_.targets:
                _draw_tag(canvas, hostile.figure(view, now, round_.valley), now, scale)
    else:
        _paint_view(canvas, view, seed, painters, clouds)
        _draw_clouds(canvas, view, round_.sky_drift, seed)
        _draw_birds(canvas, view, now)
        _draw_grass(canvas, view, round_.wind, now, seed)
        if round_.scoped:
            for hostile in round_.targets:
                _draw_glass_mark(canvas, hostile.figure(view, now, round_.valley), now, scale)
    for shot in round_.flights:
        _draw_shot(canvas, shot, view, now, round_.IMPACT_TTL - 0.9, scale)

    if round_.scoped:
        since = now - (round_.scoped_since if round_.scoped_since is not None else now)
        settle = 1.0 if since < 0.0 else min(since / SCOPE_IN_SECONDS, 1.0)
        # The lens effects are worked only on the square the glass shows.
        gx0, gy0, gx1, gy1 = _glass_box(width, height)
        glass = canvas[gy0:gy1, gx0:gx1]
        ax, ay = View.scope_anchor(width, height)
        _heat_shimmer(glass, now, view.zoom, top=ay - gy0, reach=height - ay)
        _chromatic_fringe(glass, (ax - gx0, ay - gy0), SCOPE_RADIUS * height)
        _soft_focus(glass, 1.0 - settle)
        mask = _scope_mask(width, height)[gy0:gy1, gx0:gx1]
        if settle < 1.0:
            # The iris opens as the eye settles behind the glass.
            shrunk = np.zeros_like(mask)
            r = int(SCOPE_RADIUS * height * (0.45 + 0.55 * settle))
            cv2.circle(shrunk, (ax - gx0, ay - gy0), r, (255, 255, 255), -1, cv2.LINE_AA)
            mask = cv2.min(mask, shrunk)
        # Outside the glass is black; inside, a touch of gain, as the lens
        # gathers light. The picture is only multiplied where it can show.
        canvas[:gy0] = 0
        canvas[gy1:] = 0
        canvas[gy0:gy1, :gx0] = 0
        canvas[gy0:gy1, gx1:] = 0
        cv2.multiply(glass, mask, dst=glass, scale=1.12 / 255.0)
        cv2.add(glass, _lens_dirt(width, height)[gy0:gy1, gx0:gx1], dst=glass)
        cv2.add(glass, _lens_ring(width, height)[gy0:gy1, gx0:gx1], dst=glass)
        _draw_reticle(canvas, round_, now)
        _hud_backing(canvas, width, height, scale)
    else:
        _hud_backing(canvas, width, height, scale)
        if round_.unscoped_since is not None:
            since = now - round_.unscoped_since
            if since < 0.25:
                _soft_focus(canvas, 0.6 * (1.0 - since / 0.25))


def _panel(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int, alpha: float = 0.62) -> None:
    """A dark backing, blended only over its own rectangle."""
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, canvas.shape[1]), min(y1, canvas.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    cv2.addWeighted(roi, 1.0 - alpha, roi, 0.0, 13.0 * alpha, dst=roi)


def _wind_gauge(canvas: np.ndarray, x: int, y: int, span: int, wind: float, accent, scale: float) -> None:
    """An arrow the length of the wind, pointing the way it blows."""
    cv2.line(canvas, (x, y), (x + span, y), (70, 72, 74), 1, cv2.LINE_AA)
    mid = x + span // 2
    for k in range(-4, 5):
        tick = 5 if k == 0 else 2
        tx = mid + int(k * span / 8)
        cv2.line(canvas, (tx, y - tick), (tx, y + tick), (120, 122, 124), 1)
    reach = int(wind / MAX_WIND * span * 0.5)
    if abs(reach) >= 2:
        cv2.arrowedLine(canvas, (mid, y), (mid + reach, y), accent,
                        max(2, round(2 * scale)), cv2.LINE_AA, tipLength=min(0.5, 6.0 / abs(reach)))


def draw_hud(canvas: np.ndarray, round_: SniperRound, origin: tuple[int, int],
             now: float) -> None:
    """Hostiles left, the tally, the stage and the wind - in the readout's one
    face, on the readout's one panel, scoped or not. The range and the hold
    are read off the glass itself."""
    x, y = origin
    scale = round_.options.scale
    label = (168, 172, 176)
    value = (232, 234, 236)
    accent = (110, 210, 250)
    small, big = max(11, round(13 * scale)), max(14, round(18 * scale))

    def at(offset: float) -> int:
        return y + round(offset * scale)

    # The panel is already under us (the world laid it); the accent bar the app
    # draws beside the score carries on down past the tally.
    left, right = x + round(4 * scale), x + round(330 * scale)
    cv2.line(canvas, (left, at(112)), (left, at(190)), accent, max(1, round(2 * scale)))
    cv2.line(canvas, (x + round(14 * scale), at(136)), (right - round(10 * scale), at(136)), (54, 56, 58), 1)

    # Line one: the count, the tally, the stage - labels, then numbers.
    tx = x + round(14 * scale)
    tx += _label(canvas, "HOSTILES", (tx, at(160)), label, small) + round(10 * scale)
    tx += _label(canvas, str(round_.remaining_hostiles), (tx, at(161)), value, big, 600) + round(22 * scale)
    tx += _label(canvas, "DOWN", (tx, at(160)), label, small) + round(10 * scale)
    _label(canvas, str(round_.kills), (tx, at(161)), value, big, 600)
    stage = f"STAGE {round_.stage(now)}"
    _label(canvas, stage, (right - round(10 * scale) - _label_width(stage, small), at(160)), accent, small)

    # Line two: the wind gauge, with the number right-aligned after it.
    _label(canvas, "WIND", (x + round(14 * scale), at(186)), label, small)
    _wind_gauge(canvas, x + round(76 * scale), at(181), round(150 * scale), round_.wind, accent, scale)
    speed = f"{abs(round_.wind):.1f} m/s"
    _label(canvas, speed, (right - round(10 * scale) - _label_width(speed, small), at(186)), accent, small)


def draw_emblem(panel: np.ndarray) -> None:
    """The card art: the valley at golden hour, and in the glass the farmhouse
    itself with a sentry at its corner, backlit by the low sun - the same
    figure, the same walls, the same light as the game."""
    height, width = panel.shape[:2]
    valley = Valley(width, height)
    seed = 5
    wide = View.wide(width, height)
    _paint_view(panel, wide, seed)
    _draw_clouds(panel, wide, 0.0, seed)
    # Darken the surround so the glass is the bright thing.
    dim = panel.copy()
    cv2.rectangle(dim, (0, 0), (width, height), (14, 16, 18), -1)
    blend(panel, dim, 0.34)

    centre = (width // 2, height // 2)
    radius = int(height * 0.44)
    fx, fd = FARM
    sentry = Hostile("sentry", 0.0, post=(fx + 3.4, fd - 2.0), phase=0.5)
    base = sentry.figure(wide, 1.5, valley)
    zoom = (radius * 0.42) / max(base.height, 1e-3)
    scoped = View(width, height, (base.x + base.height * 0.9, base.hip_y - base.height * 0.12),
                  zoom, centre)
    figure = sentry.figure(scoped, 1.5, valley)
    glass = np.zeros_like(panel)
    _paint_view(glass, scoped, seed,
                [(figure.distance, lambda c, f=figure: _draw_person(c, f, FIGURE, FIGURE_RIM))])
    # Heat off the yard, and the glass vignetting towards its rim.
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    r = np.hypot(xs - centre[0], ys - centre[1]) / radius
    shade = (np.clip(1.0 - 0.55 * np.clip(r, 0, 1) ** 2.4, 0, 1) * 255).astype(np.uint8)
    glass = cv2.multiply(glass, cv2.cvtColor(shade, cv2.COLOR_GRAY2BGR), scale=1.0 / 255.0)
    mask = np.zeros((height, width, 3), np.uint8)
    cv2.circle(mask, centre, radius, (255, 255, 255), -1, cv2.LINE_AA)
    panel[:] = np.where(mask > 0, glass, panel)

    # The reticle, fine, so the figure stays the subject.
    gap = radius * 0.16
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        cv2.line(panel, (int(centre[0] + dx * gap), int(centre[1] + dy * gap)),
                 (int(centre[0] + dx * radius), int(centre[1] + dy * radius)), RETICLE,
                 1 if dy <= 0 else 2, cv2.LINE_AA)
    for k in range(1, 4):
        for dx, dy in ((-1, 0), (1, 0), (0, 1)):
            cv2.circle(panel, (int(centre[0] + dx * k * radius * 0.2), int(centre[1] + dy * k * radius * 0.2)),
                       1, RETICLE, -1, cv2.LINE_AA)
    cv2.circle(panel, centre, radius + 2, (10, 10, 12), 5, cv2.LINE_AA)
    cv2.ellipse(panel, centre, (radius, radius), 0, 100, 260, (232, 200, 110), 1, cv2.LINE_AA)
    cv2.ellipse(panel, centre, (radius, radius), 0, -80, 80, (70, 130, 236), 1, cv2.LINE_AA)
