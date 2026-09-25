"""HIGH NOON: a dusty frontier main street, bottles on the rail, bandits in the doors.

Everything is drawn with OpenCV primitives. The street itself - sky, false-front
buildings, water tower, boardwalk, rail and barrels, and every shadow the sun
throws - is built once per *hour* of the round and copied in each frame; the
round is split into a handful of hours, and as the clock runs down the sun
drops, the light goes amber and the shadows stretch. Only the things that move
(bottles, cans, swinging signs, whoever is standing in a doorway, glass in the
air, tumbleweed and dust) and the things that accumulate (bullet holes, broken
glass on the table) are drawn on top.

The rules: bottles shatter, cans spin off, signs swing, and bandits show
themselves for a moment in doorways, windows and behind barrels. Townsfolk step
out too - shooting one costs you. A bandit is worth more the faster you drop him.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import cv2
import numpy as np

from ..game import DANGER, MISS, PLAIN, Hit, Impact, Readout, Rect, Round

# --- rules -------------------------------------------------------------------

BOTTLE_POINTS = 30
CAN_POINTS = 20
SIGN_POINTS = 25
BANDIT_POINTS = 100
QUICK_DRAW_BONUS = 100      # scaled by how little of the reaction window you used
QUICK_DRAW_WINDOW = 1.5     # seconds after he shows himself
QUICK_DRAW_LIMIT = 0.7      # under this, it counts as a quick draw
TOWNSFOLK_PENALTY = 50

FIGURE_LIFETIME = (2.4, 3.6)   # how long a bandit stays out, seconds
FIGURE_RISE = 0.22             # seconds to step out (and back)
FIGURE_INTERVAL = (0.6, 1.3)
FIGURES_AT_ONCE = 4
TOWNSFOLK_CHANCE = 0.28
RAIL_SLOTS = 7
RAIL_REFILL = 1.0
SIGN_COOLDOWN = 0.8
SIGN_SWING = 1.4               # radians either way before the chains fetch it up
SHARD_LIFE = 1.6
GRAVITY = 1500.0               # px/s^2 at reference scale, scaled by area height
DUST_DEVIL_INTERVAL = (5.0, 9.0)
DUST_DEVIL_LIFE = 7.0
TUMBLEWEED_INTERVAL = (4.0, 8.0)
MAX_SHARDS = 160
MAX_HOLES = 160
MAX_LITTER = 240
MOTE_COUNT = 70
HOURS = 6                      # how many times the light changes over a round

# --- light: the sun stands high on the left and sinks as the round runs ---------

SUN_NOON = (0.20, 0.06)        # of the play area's width and height
SUN_LATE = (0.10, 0.22)
LEAN_NOON = 0.5                # horizontal run per unit of height, for every shadow
LEAN_LATE = 1.25
MAUVE = (104, 76, 90)          # cool shadow colour (BGR)
SHADOW_STRENGTH = 0.5

# --- palette (BGR): bleached wood, ochre dust and a sky going white with heat -------

SKY_TOP = (192, 138, 70)
SKY_MID = (226, 208, 172)
SKY_HORIZON = (156, 204, 238)
SKY_TOP_LATE = (150, 112, 90)
SKY_MID_LATE = (120, 170, 232)
SKY_HORIZON_LATE = (60, 140, 238)
HAZE = (176, 206, 228)
HAZE_LATE = (90, 160, 236)
MESA = (150, 146, 170)
DUST = (118, 160, 194)
DUST_NEAR = (92, 134, 174)
RUT = (84, 118, 150)
PLANK = (96, 136, 176)
PLANK_DARK = (62, 92, 128)
WOOD_PALETTE = (
    (104, 146, 182),   # sun-bleached tan
    (96, 122, 172),    # dusty ochre
    (66, 74, 150),     # faded barn red
    (160, 150, 130),   # grey-blue weatherboard
    (190, 204, 212),   # whitewash
    (84, 112, 140),    # old brown
    (110, 150, 120),   # sage green
)
TRIM_PALETTE = ((218, 226, 230), (176, 214, 236), (52, 58, 74), (150, 170, 184))
ROOF_PALETTE = ((44, 44, 50), (70, 92, 128), (58, 76, 62), (118, 118, 124), (54, 60, 96))
TRIM = (218, 226, 230)
TRIM_DARK = (46, 54, 68)
GLASS = (86, 70, 52)
GLASS_LIGHT = (170, 150, 120)
DOOR_DEEP = (16, 20, 32)
DOOR_COLD = (54, 46, 40)
LAMP = (64, 150, 240)
LAMP_CORE = (160, 230, 255)
RIM = (96, 188, 250)
TANK = (70, 96, 130)
TANK_DARK = (44, 60, 84)
RAIL = (112, 150, 182)
RAIL_DARK = (66, 92, 122)
BARREL = (60, 84, 118)
BARREL_BAND = (48, 52, 58)
GLASS_COLORS = ((120, 170, 90), (80, 150, 200), (175, 205, 225), (60, 110, 150))
CAN = (176, 182, 186)
CAN_DARK = (92, 98, 104)
CAN_LABELS = (((50, 50, 200), "BEANS"), ((160, 110, 40), "COFFEE"), ((60, 150, 60), "PEAS"))
SIGN_BOARD = (92, 124, 160)
INK = (236, 236, 236)
MUTED = (150, 146, 142)
SCORE_INK = (70, 222, 255)
SCORE_EDGE = (18, 16, 20)
PENALTY_INK = (60, 64, 240)
BANDIT_COAT = (34, 40, 58)
BANDIT_HAT = (22, 20, 26)
STRIPE = (52, 62, 96)
HAT_BAND = (40, 56, 90)
BRIM_SHADE = (28, 26, 36)
TROUSERS_DARK = (36, 42, 54)
GUN_LIT = (150, 156, 166)
SUN_RIM = (178, 226, 250)
GRIP = (42, 70, 120)
BANDANA = (36, 36, 190)
SKIN = (150, 180, 220)
GUN = (40, 42, 46)
GLINT = (240, 250, 255)
DRESS = (170, 130, 80)
APRON = (232, 236, 240)
SHIRT = (222, 228, 232)
STRAW = (110, 190, 230)
TROUSERS = (70, 86, 110)
WEED = (70, 120, 160)
HOLE = (30, 34, 44)
SPLINTER = (170, 196, 216)

FONT = cv2.FONT_HERSHEY_SIMPLEX
SLAB = cv2.FONT_HERSHEY_TRIPLEX


def _mix(a, b, t: float) -> tuple[int, int, int]:
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


# --- the street ----------------------------------------------------------------

@dataclass(frozen=True)
class Building:
    x: int
    width: int
    top: int            # the top of the false front
    color: tuple[int, int, int]
    style: str          # "flat", "step" or "peak"
    awning: bool
    door_x: int | None  # centre of the door, if there is one
    windows: tuple[int, ...]  # window centres along the upper storey
    sign: str
    trim: tuple[int, int, int] = TRIM
    roof: tuple[int, int, int] = (44, 44, 50)
    door_lit: bool = True
    door_style: str = "batwing"   # or "open"


@dataclass(frozen=True)
class Spot:
    """Somewhere a figure can show himself."""

    kind: str           # "door", "window" or "barrel"
    x: float
    floor_y: float      # where the feet are when he is fully out
    height: float       # of the figure, feet to hat
    clip: Rect          # he is only ever drawn inside this
    lit: bool = True    # warm light behind him, or not


@dataclass(frozen=True)
class Street:
    """Every fixed measurement of the scene, from the play area."""

    area: Rect
    ground_y: int       # where the buildings stand
    walk_y: int         # the front edge of the boardwalk
    rail_y: int         # the top of the hitching rail
    rail_x: tuple[int, int]
    buildings: tuple[Building, ...]
    spots: tuple[Spot, ...]
    barrels: tuple[tuple[int, int, int], ...]   # (centre x, bottom y, width)
    tower_x: int
    sign_pivots: tuple[tuple[int, int], ...]

    @property
    def unit(self) -> float:
        return self.area.height / 600.0

    @property
    def awning_y(self) -> int:
        return self.ground_y - int(AWNING_Y * self.area.height)

    @property
    def skyline(self) -> int:
        return min(b.top for b in self.buildings) - int(0.06 * self.area.height)

    def slot_x(self, index: int) -> float:
        left, right = self.rail_x
        return left + (right - left) * (index + 0.5) / RAIL_SLOTS


SIGN_WORDS = ("SALOON", "BANK", "HOTEL", "GENERAL STORE", "SHERIFF", "BARBER",
              "ASSAY OFFICE", "LIVERY", "DRY GOODS", "GUNSMITH")

DOOR_W, DOOR_H = 0.15, 0.30        # of the area height
WIN_W, WIN_H = 0.10, 0.11
WIN_TOP = 0.43                     # above the ground line
AWNING_Y = 0.305
FIGURE_H = 0.275                   # a man in a doorway, feet to hat crown
# Parts of a figure that stand out past its body, in units of its height (x out
# from the middle, y up from the feet): drawn from these and hit-tested
# against them, so what sticks out can be hit.
HAT_CROWN = (0.11, 1.1)                        # a bandit's: half its width, its top
RAISED_ARM = ((0.16, 0.72), (0.3, 0.98), 0.03)  # townsfolk: shoulder, wrist, half width
RAISED_HAND = ((0.3, 1.0), 0.045)               # and the hand held up: centre, radius


def build_street(area: Rect, seed: int) -> Street:
    rng = np.random.default_rng(seed)
    h = area.height
    ground_y = int(area.y + 0.56 * h)
    walk_y = int(ground_y + 0.05 * h)
    rail_y = int(area.y + 0.80 * h)
    rail_x = (int(area.x + area.width * 0.24), int(area.x + area.width * 0.76))

    buildings: list[Building] = []
    spots: list[Spot] = []
    sign_pivots: list[tuple[int, int]] = []
    words = list(SIGN_WORDS)
    rng.shuffle(words)
    x = area.x - int(0.05 * h)
    index = 0
    lit_pattern = (True, False, True, True, False, True, False, True, True, False)
    while x < area.right + int(0.05 * h):
        width = int(rng.uniform(0.28, 0.46) * h)
        front = int(rng.uniform(0.46, 0.58) * h)
        top = ground_y - front
        style = ("flat", "step", "peak")[int(rng.integers(3))]
        if style == "peak" and front > 0.50 * h:
            style = "flat"
        color = WOOD_PALETTE[int(rng.integers(len(WOOD_PALETTE)))]
        awning = bool(rng.random() < 0.65)
        door_x = x + int(width * rng.uniform(0.3, 0.7)) if rng.random() < 0.8 else None
        window_count = 2 if width > 0.36 * h else 1
        windows = tuple(int(x + width * (i + 1) / (window_count + 1))
                        for i in range(window_count)) if front >= 0.55 * h else ()
        if windows:
            style = "flat"   # a tall front with windows carries a plain cornice
        # Light and dark trim alternate with the wall so every front breaks cleanly.
        trim = TRIM_PALETTE[int(rng.integers(len(TRIM_PALETTE)))]
        if sum(trim) > 500 and sum(color) > 560:
            trim = TRIM_PALETTE[2]
        roof = ROOF_PALETTE[int(rng.integers(len(ROOF_PALETTE)))]
        door_lit = lit_pattern[index % len(lit_pattern)]
        door_style = "batwing" if rng.random() < 0.5 else "open"
        building = Building(x=x, width=width, top=top, color=color, style=style,
                            awning=awning, door_x=door_x, windows=windows,
                            sign=words[index % len(words)], trim=trim, roof=roof,
                            door_lit=door_lit, door_style=door_style)
        buildings.append(building)
        figure_h = FIGURE_H * h
        if door_x is not None and area.x < door_x < area.right:
            door_w, door_h = int(DOOR_W * h), int(DOOR_H * h)
            spots.append(Spot("door", door_x, ground_y - 0.004 * h, figure_h,
                              Rect(door_x - door_w // 2, ground_y - door_h, door_w, door_h), door_lit))
        for wx in windows:
            if not area.x < wx < area.right:
                continue
            win_w, win_h = int(WIN_W * h), int(WIN_H * h)
            win_top = ground_y - int(WIN_TOP * h)
            spots.append(Spot("window", wx, win_top + win_h + figure_h * 0.42, figure_h,
                              Rect(wx - win_w // 2, win_top, win_w, win_h), False))
        pivot_x = x + int(width * 0.9)
        if awning and rng.random() < 0.6 and area.x + 0.1 * h < pivot_x < area.right - 0.1 * h:
            sign_pivots.append((pivot_x, ground_y - int((AWNING_Y - 0.02) * h)))
        x += width + (int(rng.uniform(0.02, 0.06) * h) if rng.random() < 0.6 else 0)
        index += 1

    # A hanging sign must never swing in front of a doorway, anyone's doorway.
    doors = [s.x for s in spots if s.kind == "door"]
    sign_pivots = [p for p in sign_pivots if all(abs(p[0] - dx) > 0.17 * h for dx in doors)]

    barrel_w = int(0.15 * h)
    barrels = ((int(area.x + area.width * 0.09), area.bottom - int(0.02 * h), barrel_w),
               (int(area.right - area.width * 0.09), area.bottom - int(0.02 * h), barrel_w))
    for bx, by, bw in barrels:
        top = by - int(bw * 1.35)
        figure_h = 0.32 * h
        spots.append(Spot("barrel", bx, top + figure_h * 0.5, figure_h,
                          Rect(bx - int(0.2 * h), area.y, int(0.4 * h), top - area.y), False))

    return Street(area=area, ground_y=ground_y, walk_y=walk_y, rail_y=rail_y,
                  rail_x=rail_x, buildings=tuple(buildings), spots=tuple(spots),
                  barrels=barrels, tower_x=int(area.x + area.width * 0.64),
                  sign_pivots=tuple(sign_pivots[:3]))


# --- things on the street --------------------------------------------------------

@dataclass
class Bottle:
    slot: int
    x: float
    base_y: float
    height: float
    color: tuple[int, int, int]
    kind: str = "bottle"
    neck: float = 0.4
    spawned_at: float = 0.0

    @property
    def width(self) -> float:
        return self.height * 0.36

    @property
    def y(self) -> float:
        return self.base_y - self.height * 0.5

    def contains(self, x: float, y: float) -> bool:
        return (abs(x - self.x) <= self.width * 0.6 + 3
                and self.base_y - self.height - 3 <= y <= self.base_y + 2)


@dataclass
class Can:
    slot: int
    x: float
    base_y: float
    height: float
    kind: str = "can"
    label: int = 0
    spawned_at: float = 0.0
    hit_at: float | None = None   # once hit it spins off and is gone

    @property
    def width(self) -> float:
        return self.height * 0.7

    @property
    def y(self) -> float:
        return self.base_y - self.height * 0.5

    def contains(self, x: float, y: float) -> bool:
        return (abs(x - self.x) <= self.width * 0.55 + 3
                and self.base_y - self.height - 3 <= y <= self.base_y + 2)


@dataclass
class Sign:
    pivot: tuple[int, int]
    length: float
    width: float
    depth: float
    word: str
    angle: float = 0.0
    velocity: float = 0.0
    kind: str = "sign"
    last_hit: float = -10.0

    @property
    def centre(self) -> tuple[float, float]:
        return (self.pivot[0] + math.sin(self.angle) * self.length,
                self.pivot[1] + math.cos(self.angle) * self.length)

    @property
    def x(self) -> float:
        return self.centre[0]

    @property
    def y(self) -> float:
        return self.centre[1]

    def step(self, dt: float, elapsed: float) -> None:
        # A pendulum in a light breeze: the gusts keep it from ever hanging still.
        # They blow on the round's clock, so a sign swings the same way at the
        # same moment of every round, and so where a shot finds it does too.
        accel = -16.0 * math.sin(self.angle) - 0.9 * self.velocity
        accel += 2.2 * math.sin(elapsed * 1.3 + self.pivot[0] * 0.01)
        self.velocity += accel * dt
        self.angle += self.velocity * dt
        # Hung on chains, it can be kicked up high but never over its bracket:
        # at the top of its swing the chains fetch it up and it drops back.
        if abs(self.angle) > SIGN_SWING:
            self.angle = math.copysign(SIGN_SWING, self.angle)
            if self.velocity * self.angle > 0:
                self.velocity *= -0.3

    def contains(self, x: float, y: float) -> bool:
        cx, cy = self.centre
        # Rotate the shot into the board's frame.
        dx, dy = x - cx, y - cy
        c, s = math.cos(self.angle), math.sin(self.angle)
        u = dx * c - dy * s
        v = dx * s + dy * c
        return abs(u) <= self.width / 2 + 2 and abs(v) <= self.depth / 2 + 2


@dataclass
class Figure:
    """Someone in a doorway. ``bandit`` or one of the townsfolk."""

    spot: Spot
    bandit: bool
    variant: int
    appeared_at: float
    lifetime: float
    down_at: float | None = None

    @property
    def kind(self) -> str:
        return "bandit" if self.bandit else "townsfolk"

    def rise(self, now: float) -> float:
        """0 hidden, 1 fully out; steps out, waits, and steps back."""
        if self.down_at is not None:
            return max(0.0, 1.0 - (now - self.down_at) / 0.3)
        age = now - self.appeared_at
        if age < FIGURE_RISE:
            return max(0.0, age / FIGURE_RISE)
        remaining = self.appeared_at + self.lifetime - now
        if remaining < FIGURE_RISE:
            return max(0.0, remaining / FIGURE_RISE)
        return 1.0

    def is_gone(self, now: float) -> bool:
        if self.down_at is not None:
            return now - self.down_at > 0.3
        return now >= self.appeared_at + self.lifetime

    def is_shootable(self, now: float) -> bool:
        return self.down_at is None and self.rise(now) >= 0.5

    def feet(self, now: float) -> tuple[float, float]:
        spot = self.spot
        return spot.x, spot.floor_y + (1.0 - self.rise(now)) * spot.height

    @property
    def x(self) -> float:
        return self.spot.x

    @property
    def y(self) -> float:
        return self.spot.floor_y - self.spot.height * 0.6

    def contains(self, x: float, y: float, now: float) -> bool:
        if not self.is_shootable(now):
            return False
        fx, fy = self.feet(now)
        height = self.spot.height
        if not self.spot.clip.contains(x, y):
            return False
        if fy - height * 0.78 <= y <= fy and abs(x - fx) <= height * 0.24:
            return True
        # Head and hat.
        if fy - height * 1.02 <= y <= fy - height * 0.78 and abs(x - fx) <= height * 0.2:
            return True
        u, v = (x - fx) / height, (fy - y) / height
        if self.bandit:
            half, top = HAT_CROWN  # the crown stands up above the brim
            return abs(u) <= half and v <= top
        # Townsfolk have their hands up, and a shot on those is a shot on them.
        (shoulder_x, shoulder_y), (wrist_x, wrist_y), arm = RAISED_ARM
        (hand_x, hand_y), hand = RAISED_HAND
        u = abs(u)  # both arms are up
        return (_to_segment(u, v, (shoulder_x, shoulder_y), (wrist_x, wrist_y)) <= arm
                or math.hypot(u - hand_x, v - hand_y) <= hand)


def _to_segment(x: float, y: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    """How far the point is from the line segment ``a``-``b``."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    span = dx * dx + dy * dy
    t = 0.0 if span == 0.0 else min(max(((x - a[0]) * dx + (y - a[1]) * dy) / span, 0.0), 1.0)
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)


@dataclass
class Shard:
    x: float
    y: float
    vx: float
    vy: float
    size: float
    color: tuple[int, int, int]
    born: float
    floor: float
    spin: float = 0.0

    def step(self, dt: float, gravity: float) -> None:
        self.vy += gravity * dt
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.spin += self.vx * dt * 0.1
        if self.y >= self.floor and self.vy > 0:
            self.y = self.floor
            self.vy = -self.vy * 0.35
            self.vx *= 0.6
            if abs(self.vy) < 40:
                self.vy = 0.0

    def life(self, now: float) -> float:
        return max(0.0, 1.0 - (now - self.born) / SHARD_LIFE)

    @property
    def at_rest(self) -> bool:
        return self.vy == 0.0 and self.y >= self.floor - 0.5


@dataclass
class DustDevil:
    x: float
    y: float
    drift: float
    born: float
    height: float

    def life(self, now: float) -> float:
        age = now - self.born
        return max(0.0, min(age / 1.0, 1.0, (DUST_DEVIL_LIFE - age) / 1.5))


@dataclass
class Tumbleweed:
    """A ball of dry brush bowling down the street, hopping as it goes."""

    x: float
    y: float            # the ground line it rolls along
    radius: float
    vx: float
    born: float
    spin: float = 0.0

    def step(self, dt: float) -> None:
        self.x += self.vx * dt
        self.spin += self.vx * dt / max(self.radius, 1.0)

    def hop(self, now: float) -> float:
        """How far off the ground it is right now: it bounces as it rolls."""
        return abs(math.sin((now - self.born) * 3.1)) * self.radius * 0.7

    def is_gone(self, area: Rect) -> bool:
        return self.x < area.x - 3 * self.radius or self.x > area.right + 3 * self.radius


@dataclass(frozen=True)
class Hole:
    """A bullet hole, in wood or in the dirt, that stays for the round."""

    x: int
    y: int
    size: int
    wood: bool


# --- the round ----------------------------------------------------------------------

@dataclass
class WesternRound(Round):
    """High noon on main street. Drop the bandits, spare the townsfolk."""

    bottles: list[Bottle] = field(default_factory=list, init=False)
    cans: list[Can] = field(default_factory=list, init=False)
    signs: list[Sign] = field(default_factory=list, init=False)
    figures: list[Figure] = field(default_factory=list, init=False)
    shards: list[Shard] = field(default_factory=list, init=False)
    holes: list[Hole] = field(default_factory=list, init=False)
    litter: list[tuple[int, int, tuple[int, int, int]]] = field(default_factory=list, init=False)
    dust_devils: list[DustDevil] = field(default_factory=list, init=False)
    tumbleweeds: list[Tumbleweed] = field(default_factory=list, init=False)
    bandits_down: int = field(default=0, init=False)
    townsfolk_hit: int = field(default=0, init=False)
    bottles_broken: int = field(default=0, init=False)
    _refill_at: dict = field(default_factory=dict, init=False, repr=False)
    _next_figure: float = field(default=0.0, init=False, repr=False)
    _next_devil: float = field(default=2.0, init=False, repr=False)
    _next_weed: float = field(default=1.0, init=False, repr=False)
    _last_tick: float | None = field(default=None, init=False, repr=False)
    _tolled: bool = field(default=False, init=False, repr=False)

    PERFECT_LABEL = "quick draws"
    IMPACT_TTL = 1.2

    def __post_init__(self) -> None:
        super().__post_init__()
        # ``rng`` decides who steps out of the doorways. The rail restocks after
        # the player's hits and the weather runs on timers of its own, so each
        # keeps its own dice and neither can change who comes out next.
        self.rail_rng = self.stream("rail")
        self.weather_rng = self.stream("weather")
        self.street = build_street(self.options.area, self.options.seed or 0)
        u = self.street.unit
        self.signs = [Sign(pivot=pivot, length=0.075 * self.area.height,
                           width=0.15 * self.area.height, depth=0.055 * self.area.height,
                           word=("WELLS", "BEER", "BATHS")[i % 3],
                           angle=self.rng.uniform(-0.4, 0.4))
                      for i, pivot in enumerate(self.street.sign_pivots)]
        self.gravity = GRAVITY * u
        # Dust in the air: a fixed cloud of motes, each on its own slow drift.
        motes = np.random.default_rng((self.options.seed or 0) + 17)
        self.motes = np.stack([
            motes.uniform(0, 1, MOTE_COUNT), motes.uniform(0.2, 0.98, MOTE_COUNT),
            motes.uniform(0, math.tau, MOTE_COUNT), motes.uniform(0.01, 0.035, MOTE_COUNT)], axis=1)
        for slot in range(RAIL_SLOTS):
            self._fill_slot(slot, 0.0)

    def begin(self, now: float) -> None:
        # The timers start in seconds from the start of the round: the first
        # tumbleweed a second in, the first dust devil two.
        self._next_figure += now
        self._next_devil += now
        self._next_weed += now

    # --- what can be shot ---------------------------------------------------------

    @property
    def targets(self) -> list:
        """Everything worth a shot right now, the bandits first."""
        now = self._last_tick or 0.0
        # A bandit only heads the list once he has been out long enough to be seen.
        bandits = [f for f in self.figures if f.bandit and f.is_shootable(now)
                   and now - f.appeared_at >= 1.8]
        folk = [f for f in self.figures if not f.bandit and f.is_shootable(now)]
        cans = [c for c in self.cans if c.hit_at is None]
        return bandits + cans + self.bottles + self.signs + folk

    def outcome(self) -> str:
        return "CLEANED UP" if self.townsfolk_hit == 0 else ""

    def readouts(self, now: float) -> tuple[Readout, ...]:
        """The street's count beside the score: bandits and bottles down, and
        townsfolk hit - in red once there are any, since each one costs."""
        return (Readout("Bandits", str(self.bandits_down)),
                Readout("Bottles", str(self.bottles_broken)),
                Readout("Townsfolk", str(self.townsfolk_hit),
                        tone=DANGER if self.townsfolk_hit else PLAIN))

    def won(self) -> bool:
        return self.townsfolk_hit == 0

    def hour(self, now: float) -> int:
        """Which of the round's hours it is: 0 at noon, HOURS - 1 as the clock runs out."""
        if self.duration is None or self.duration <= 0:
            return 0
        return min(HOURS - 1, max(0, int(self.elapsed(now) / self.duration * HOURS)))

    # --- the clock -----------------------------------------------------------------

    def advance(self, now: float) -> None:
        dt = 0.0 if self._last_tick is None else min(now - self._last_tick, 0.25)
        self._last_tick = now
        if not self._tolled:
            self._tolled = True
            self.cues.append("bell_toll")

        for sign in self.signs:
            sign.step(dt, self.elapsed(now))

        for shard in self.shards:
            shard.step(dt, self.gravity)
        # Glass that has come to rest stays on the table as litter.
        for shard in self.shards:
            if shard.life(now) <= 0 and shard.at_rest:
                self.litter.append((int(shard.x), int(shard.y), shard.color))
        del self.litter[:-MAX_LITTER]
        self.shards = [s for s in self.shards if s.life(now) > 0]

        self.cans = [c for c in self.cans if c.hit_at is None or now - c.hit_at < 1.2]

        # The rail refills a moment after something is knocked off it.
        for slot, at in list(self._refill_at.items()):
            if now >= at:
                del self._refill_at[slot]
                self._fill_slot(slot, now)

        # Doors and windows.
        self.figures = [f for f in self.figures if not f.is_gone(now)]
        if now >= self._next_figure:
            if len(self.figures) < FIGURES_AT_ONCE:
                spawned = self._spawn_figure(now)
                if spawned is not None:
                    self.figures.append(spawned)
            self._next_figure = now + self.rng.uniform(*FIGURE_INTERVAL)

        # Weather.
        self.dust_devils = [d for d in self.dust_devils if now - d.born < DUST_DEVIL_LIFE]
        for devil in self.dust_devils:
            devil.x += devil.drift * dt
        if now >= self._next_devil and len(self.dust_devils) < 2:
            self.dust_devils.append(self._spawn_devil(now))
            self.cues.append("wind_dust")
            self._next_devil = now + self.weather_rng.uniform(*DUST_DEVIL_INTERVAL)
        for weed in self.tumbleweeds:
            weed.step(dt)
        self.tumbleweeds = [w for w in self.tumbleweeds if not w.is_gone(self.area)]
        if now >= self._next_weed and len(self.tumbleweeds) < 2:
            self.tumbleweeds.append(self._spawn_weed(now))
            self._next_weed = now + self.weather_rng.uniform(*TUMBLEWEED_INTERVAL)

    def resolve(self, x: float, y: float, now: float) -> Hit:
        self.cues.append("rifle_crack")

        # Nearest first: barrels in front of the rail, the rail in front of the doors.
        for figure in self.figures:
            if figure.spot.kind == "barrel" and figure.contains(x, y, now):
                return self._shoot_figure(figure, now)
        for bottle in self.bottles:
            if bottle.contains(x, y):
                return self._shoot_bottle(bottle, now)
        for can in self.cans:
            if can.hit_at is None and can.contains(x, y):
                return self._shoot_can(can, now)
        for sign in self.signs:
            if sign.contains(x, y):
                return self._shoot_sign(sign, now)
        for figure in self.figures:
            if figure.spot.kind != "barrel" and figure.contains(x, y, now):
                return self._shoot_figure(figure, now)

        wood = self.street.skyline < y < self.street.walk_y
        self.cues.append("wood_splinter" if wood else "ricochet")
        if self.area.contains(x, y):
            self.holes.append(Hole(int(x), int(y), max(2, int(self.effects_rng.uniform(2.0, 3.5) * self.street.unit)), wood))
            del self.holes[:-MAX_HOLES]
        return MISS

    def _shoot_bottle(self, bottle: Bottle, now: float) -> Hit:
        self.bottles.remove(bottle)
        self.bottles_broken += 1
        self._refill_at[bottle.slot] = now + RAIL_REFILL
        self._shatter(bottle, now)
        self.cues.append("bottle_break")
        return Hit(points=BOTTLE_POINTS, ring=1, label="BOTTLE")

    def _shoot_can(self, can: Can, now: float) -> Hit:
        can.hit_at = now
        self._refill_at[can.slot] = now + RAIL_REFILL
        self.cues.append("ricochet")
        # The round goes on through the tin and dents the rail behind it.
        self.holes.append(Hole(int(can.x + self.effects_rng.uniform(-0.3, 0.3) * can.width),
                               int(can.base_y + 0.006 * self.area.height),
                               max(1, int(1.8 * self.street.unit)), True))
        del self.holes[:-MAX_HOLES]
        return Hit(points=CAN_POINTS, ring=2, label="CAN")

    def _shoot_sign(self, sign: Sign, now: float) -> Hit:
        dice = self.effects_rng
        sign.velocity += dice.choice((-1, 1)) * dice.uniform(4.0, 7.0)
        self.cues.append("wood_splinter")
        if now - sign.last_hit < SIGN_COOLDOWN:
            # Still swinging from the last one: it pays once per swing, so
            # this is not a hit - or ten shots in a second would be ten hits.
            return MISS
        sign.last_hit = now
        return Hit(points=SIGN_POINTS, ring=2, label="SIGN")

    def _shoot_figure(self, figure: Figure, now: float) -> Hit:
        figure.down_at = now
        if not figure.bandit:
            self.townsfolk_hit += 1
            self.score = max(0, self.score - TOWNSFOLK_PENALTY)
            self.cues.append("bell_toll")
            return Hit(points=0, ring=None, label=f"TOWNSFOLK  -{TOWNSFOLK_PENALTY}")
        self.bandits_down += 1
        reaction = now - figure.appeared_at - FIGURE_RISE
        unused = max(0.0, 1.0 - max(reaction, 0.0) / QUICK_DRAW_WINDOW)
        points = BANDIT_POINTS + int(QUICK_DRAW_BONUS * unused)
        quick = reaction <= QUICK_DRAW_LIMIT
        self.cues.append("bandit_down")
        return Hit(points=points, ring=0, label="QUICK DRAW" if quick else "BANDIT",
                   perfect=quick)

    # --- spawning --------------------------------------------------------------------

    def _fill_slot(self, slot: int, now: float) -> None:
        street = self.street
        h = self.area.height
        x = street.slot_x(slot) + self.rail_rng.uniform(-0.01, 0.01) * h
        if self.rail_rng.random() < 0.3:
            self.cans.append(Can(slot=slot, x=x, base_y=street.rail_y,
                                 height=self.rail_rng.uniform(0.075, 0.09) * h,
                                 label=self.rail_rng.randrange(len(CAN_LABELS)), spawned_at=now))
        else:
            self.bottles.append(Bottle(
                slot=slot, x=x, base_y=street.rail_y,
                height=self.rail_rng.uniform(0.12, 0.16) * h,
                color=self.rail_rng.choice(GLASS_COLORS),
                neck=self.rail_rng.uniform(0.3, 0.5), spawned_at=now))

    def _spawn_figure(self, now: float) -> Figure | None:
        taken = {f.spot for f in self.figures}
        free = [s for s in self.street.spots if s not in taken]
        if not free:
            return None
        # Doorways twice as often as anywhere else: that is where the fight is.
        weights = [2 if s.kind == "door" else 1 for s in free]
        spot = self.rng.choices(free, weights=weights)[0]
        return Figure(spot=spot, bandit=self.rng.random() >= TOWNSFOLK_CHANCE,
                      variant=self.rng.randrange(3), appeared_at=now,
                      lifetime=self.rng.uniform(*FIGURE_LIFETIME))

    def _spawn_devil(self, now: float) -> DustDevil:
        area = self.area
        street = self.street
        from_left = self.weather_rng.random() < 0.5
        return DustDevil(
            x=area.x - 40 if from_left else area.right + 40,
            y=self.weather_rng.uniform(street.walk_y + 0.04 * area.height, street.rail_y),
            drift=self.weather_rng.uniform(60, 110) * street.unit * (1 if from_left else -1),
            born=now, height=self.weather_rng.uniform(0.18, 0.3) * area.height)

    def _spawn_weed(self, now: float) -> Tumbleweed:
        area = self.area
        street = self.street
        from_left = self.weather_rng.random() < 0.5
        radius = self.weather_rng.uniform(0.035, 0.06) * area.height
        return Tumbleweed(
            x=area.x - 2 * radius if from_left else area.right + 2 * radius,
            y=self.weather_rng.uniform(street.walk_y + 0.06 * area.height, street.rail_y - 0.02 * area.height),
            radius=radius, vx=self.weather_rng.uniform(90, 150) * street.unit * (1 if from_left else -1),
            born=now)

    def _shatter(self, bottle: Bottle, now: float) -> None:
        count = 22
        ground = self.area.bottom - 0.015 * self.area.height
        table = self.street.rail_y + 0.012 * self.area.height
        u = self.street.unit
        dice = self.effects_rng
        for _ in range(count):
            angle = dice.uniform(-math.pi, 0.0)  # mostly upwards and outwards
            speed = dice.uniform(120, 420) * u
            # Most of the glass lands on the table; the rest flies clear to the dirt.
            floor = table if dice.random() < 0.7 else ground
            self.shards.append(Shard(
                x=bottle.x + dice.uniform(-0.5, 0.5) * bottle.width,
                y=bottle.base_y - dice.uniform(0.1, 1.0) * bottle.height,
                vx=math.cos(angle) * speed, vy=math.sin(angle) * speed * 0.8,
                size=dice.uniform(3.0, 7.0) * u, color=bottle.color,
                born=now, floor=floor + dice.uniform(-3, 3) * u))
        del self.shards[:-MAX_SHARDS]


# --- drawing helpers ------------------------------------------------------------------

def _shade(color, amount: float) -> tuple[int, int, int]:
    """Darken (amount < 0) or lighten (amount > 0) a colour."""
    if amount < 0:
        return tuple(int(c * (1 + amount)) for c in color)
    return tuple(int(c + (255 - c) * amount) for c in color)


def _poly(canvas, points, color, thickness=-1):
    pts = np.array(points, np.int32).reshape(-1, 1, 2)
    if thickness < 0:
        cv2.fillPoly(canvas, [pts], color, cv2.LINE_AA)
    else:
        cv2.polylines(canvas, [pts], True, color, thickness, cv2.LINE_AA)


def _roi_blend(canvas: np.ndarray, box: tuple[int, int, int, int], alpha: float, draw) -> None:
    """Draw translucently inside a box only, so the blend costs its own size."""
    h, w = canvas.shape[:2]
    x0, y0, x1, y1 = box
    x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1))
    if x1 <= x0 or y1 <= y0 or alpha <= 0:
        return
    roi = canvas[y0:y1, x0:x1]
    over = roi.copy()
    draw(over, -x0, -y0)
    cv2.addWeighted(over, min(alpha, 1.0), roi, 1.0 - min(alpha, 1.0), 0.0, dst=roi)


def _clip_box(canvas, x0, y0, x1, y1):
    h, w = canvas.shape[:2]
    return max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1))


def _vertical_shade(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int,
                    top: float, bottom: float) -> None:
    """Multiply a box by a top-to-bottom gradient: lit up high, dimmer low down."""
    x0, y0, x1, y1 = _clip_box(canvas, x0, y0, x1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    gain = np.linspace(top, bottom, y1 - y0, dtype=np.float32)[:, None, None]
    roi[:] = np.clip(roi.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def _horizontal_shade(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int,
                      left: float, right: float) -> None:
    """Multiply a box by a left-to-right gradient."""
    x0, y0, x1, y1 = _clip_box(canvas, x0, y0, x1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    gain = np.linspace(left, right, x1 - x0, dtype=np.float32)[None, :, None]
    roi[:] = np.clip(roi.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def _vertical_fill(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int, top, bottom) -> None:
    """Fill a box with a top-to-bottom colour gradient."""
    x0, y0, x1, y1 = _clip_box(canvas, x0, y0, x1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    t = np.linspace(0.0, 1.0, y1 - y0, dtype=np.float32)[:, None]
    rows = np.array(top, np.float32) + (np.array(bottom, np.float32) - np.array(top, np.float32)) * t
    canvas[y0:y1, x0:x1] = np.clip(rows, 0, 255).astype(np.uint8)[:, None, :]


def _ao_strip(canvas: np.ndarray, x0: int, y0: int, x1: int, depth: int, strength: float = 0.45) -> None:
    """Ambient occlusion: a soft band of shade hanging under an overhang."""
    if depth <= 0:
        return
    _vertical_shade(canvas, x0, y0, x1, y0 + depth, 1.0 - strength, 1.0)


def _grain(canvas: np.ndarray, x0: int, y0: int, x1: int, y1: int, rng, sigma: float,
           streaks: bool = False) -> None:
    """Wood or sand grain: per-pixel noise, or streaked down the boards."""
    x0, y0, x1, y1 = _clip_box(canvas, x0, y0, x1, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    if streaks:
        noise = rng.normal(0, sigma * 0.6, (1, x1 - x0, 1)) + rng.normal(0, sigma * 0.5, (y1 - y0, x1 - x0, 1))
    else:
        noise = rng.normal(0, sigma, (y1 - y0, x1 - x0, 1))
    roi[:] = np.clip(roi.astype(np.int16) + noise.astype(np.int16), 0, 255).astype(np.uint8)


def _cast_shadows(canvas: np.ndarray, mask: np.ndarray, strength: float = SHADOW_STRENGTH) -> None:
    """Lay every shadow drawn on ``mask`` over the canvas at once, in cool mauve."""
    if not mask.any():
        return
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    soft = cv2.GaussianBlur(mask[y0:y1, x0:x1], (0, 0), 1.2)
    a = (soft.astype(np.float32) / 255.0 * strength)[..., None]
    roi = canvas[y0:y1, x0:x1]
    roi[:] = (roi.astype(np.float32) * (1 - a) + np.array(MAUVE, np.float32) * a).astype(np.uint8)


def _ground_shadow(canvas: np.ndarray, cx: int, cy: int, rx: int, ry: int) -> None:
    """A small soft ellipse of shade under something standing on the ground."""
    _roi_blend(canvas, (cx - rx - 1, cy - ry - 1, cx + rx + 2, cy + ry + 2), 0.45,
               lambda over, dx, dy: cv2.ellipse(over, (cx + dx, cy + dy), (rx, ry), 0, 0, 360, MAUVE, -1, cv2.LINE_AA))


SQUASH = 0.2   # how much of a thing's height its ground shadow spans, toward you


def _sheared(points, base_y: float, lean: float, squash: float = SQUASH) -> list[tuple[int, int]]:
    """Project an upright silhouette standing on ``base_y`` onto the ground as the
    sun throws it: every point slides right by its height times ``lean`` and
    the whole thing is flattened toward the viewer."""
    out = []
    for x, y in points:
        hgt = base_y - y
        out.append((int(x + hgt * lean), int(base_y + hgt * squash)))
    return out


def _cast_shadow(canvas: np.ndarray, points, base_y: float, lean: float, alpha: float = 0.5,
                 squash: float = SQUASH) -> None:
    """Lay one sheared shadow straight onto the canvas (the per-frame version)."""
    pts = _sheared(points, base_y, lean, squash)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    _roi_blend(canvas, (min(xs) - 2, min(ys) - 2, max(xs) + 3, max(ys) + 3), alpha,
               lambda over, dx, dy: _poly(over, [(x + dx, y + dy) for x, y in pts], MAUVE))


def _hour_t(hour: int) -> float:
    return 0.0 if HOURS <= 1 else min(1.0, max(0.0, hour / (HOURS - 1)))


def _sun_at(rect: Rect, hour: int) -> tuple[int, int]:
    t = _hour_t(hour)
    fx = SUN_NOON[0] + (SUN_LATE[0] - SUN_NOON[0]) * t
    fy = SUN_NOON[1] + (SUN_LATE[1] - SUN_NOON[1]) * t
    return int(rect.x + rect.width * fx), int(rect.y + rect.height * fy)


def _lean_for(hour: int) -> float:
    return LEAN_NOON + (LEAN_LATE - LEAN_NOON) * _hour_t(hour)


def _tint_for(hour: int) -> np.ndarray:
    """How the hour colours everything: noon is white, the late hours are amber."""
    t = _hour_t(hour)
    return np.array((1.0 - 0.30 * t, 1.0 - 0.10 * t, 1.0 + 0.03 * t), np.float32)


# --- drawing the street ---------------------------------------------------------------

def _draw_building(canvas: np.ndarray, b: Building, street: Street, vanish: tuple[int, int],
                   shadows: np.ndarray, rng, lean: float) -> None:
    h = street.area.height
    ground = street.ground_y
    x0, x1 = b.x, b.x + b.width
    trim_color = b.trim
    trim_shade = _shade(trim_color, -0.45)

    def _lean(height: float) -> int:
        return int(height * lean)

    # The side wall, receding towards the vanishing point; the neighbour nearer
    # the centre will cover most of it, which is exactly what depth looks like.
    toward_right = (x0 + x1) / 2 < vanish[0]
    edge_x = x1 if toward_right else x0
    depth = 0.09

    def recede(px, py):
        return (int(px + (vanish[0] - px) * depth), int(py + (vanish[1] - py) * depth))

    wall_top = b.top + int(0.05 * h)   # the false front stands proud of the roof
    # A wall facing right turns away from the sun and falls into cool shade; one
    # facing left takes the sun full on and comes up warmer than the front.
    side_color = _cool(b.color, 0.5) if toward_right else _warm(_shade(b.color, -0.08), 0.12)
    _poly(canvas, [(edge_x, wall_top), (edge_x, ground), recede(edge_x, ground),
                   recede(edge_x, wall_top)], side_color)
    if not toward_right:
        # Clapboard lines run back toward the vanishing point on the lit wall.
        far_top, far_bot = recede(edge_x, wall_top), recede(edge_x, ground)
        for frac in np.linspace(0.1, 0.95, 12):
            ya = int(wall_top + (ground - wall_top) * frac)
            yb = int(far_top[1] + (far_bot[1] - far_top[1]) * frac)
            cv2.line(canvas, (edge_x, ya), (far_top[0], yb), _shade(side_color, -0.25), 1, cv2.LINE_AA)

    # The front: clapboards lit from above, darker down by the boardwalk, with
    # grain, and every board throwing a hairline of shade on the one beneath it.
    cv2.rectangle(canvas, (x0, b.top), (x1, ground), _warm(b.color, 0.06), -1)
    _vertical_shade(canvas, x0, b.top, x1, ground, 1.12, 0.78)
    _grain(canvas, x0, b.top, x1, ground, rng, 5.0, streaks=True)
    board = max(3, int(0.022 * h))
    gap = _shade(b.color, -0.32)
    lit = _shade(b.color, 0.16)
    for y in range(b.top + board, ground, board):
        cv2.line(canvas, (x0, y), (x1, y), gap, 1)
        cv2.line(canvas, (x0, y + 1), (x1, y + 1), lit, 1)
    # Corner boards, the material break at either edge of the front.
    trim = max(1, int(0.006 * h))
    corner = max(2, int(0.012 * h))
    cv2.rectangle(canvas, (x0, b.top), (x0 + corner, ground), trim_color, -1)
    cv2.rectangle(canvas, (x1 - corner, b.top), (x1, ground), trim_color, -1)
    cv2.line(canvas, (x0 + corner, b.top), (x0 + corner, ground), trim_shade, 1)
    cv2.line(canvas, (x1 - corner - 1, b.top), (x1 - corner - 1, ground), trim_shade, 1)

    cornice_h = int(0.03 * h)
    roof_dark = _shade(b.roof, -0.35)
    if b.style == "flat":
        # A tarred parapet cap over a deep trim cornice.
        cv2.rectangle(canvas, (x0 - trim, b.top - trim), (x1 + trim, b.top + int(0.012 * h)), b.roof, -1)
        cv2.rectangle(canvas, (x0, b.top + int(0.012 * h)), (x1, b.top + cornice_h), trim_color, -1)
        cv2.line(canvas, (x0, b.top + cornice_h), (x1, b.top + cornice_h), trim_shade, trim)
        # Dentils along the cornice.
        for px in range(x0 + corner, x1 - corner, max(4, int(0.02 * h))):
            cv2.rectangle(canvas, (px, b.top + int(0.02 * h)), (px + max(2, int(0.008 * h)), b.top + cornice_h),
                          trim_shade, -1)
        eave = b.top + cornice_h
    elif b.style == "step":
        step = int(b.width * 0.18)
        cap = int(0.05 * h)
        cv2.rectangle(canvas, (x0, b.top), (x0 + step, b.top + cap), _shade(b.color, 0.12), -1)
        cv2.rectangle(canvas, (x1 - step, b.top), (x1, b.top + cap), _shade(b.color, 0.12), -1)
        cv2.rectangle(canvas, (x0 - trim, b.top - trim), (x0 + step, b.top + int(0.012 * h)), b.roof, -1)
        cv2.rectangle(canvas, (x1 - step, b.top - trim), (x1 + trim, b.top + int(0.012 * h)), b.roof, -1)
        cv2.rectangle(canvas, (x0 + step, b.top + int(0.012 * h)), (x1 - step, b.top + int(0.03 * h)), b.roof, -1)
        cv2.rectangle(canvas, (x0 + step, b.top + int(0.03 * h)), (x1 - step, b.top + cap), trim_color, -1)
        cv2.rectangle(canvas, (x0, b.top + cap), (x1, b.top + int(0.07 * h)), trim_color, -1)
        cv2.line(canvas, (x0, b.top + int(0.07 * h)), (x1, b.top + int(0.07 * h)), trim_shade, trim)
        eave = b.top + int(0.07 * h)
    else:
        peak = int(b.width * 0.5)
        rise = int(0.05 * h)
        base_y = b.top + int(0.07 * h)
        cv2.rectangle(canvas, (x0, b.top), (x1, base_y), _shade(b.color, 0.3), -1)
        # A shingled gable: the sunward slope lit, the other in its own shade.
        _poly(canvas, [(x0, base_y), (x0 + peak, b.top - rise), (x0 + peak, base_y)], b.roof)
        _poly(canvas, [(x0 + peak, b.top - rise), (x1, base_y), (x0 + peak, base_y)], roof_dark)
        for frac in (0.3, 0.55, 0.8):
            yy = int(b.top - rise + (base_y - b.top + rise) * frac)
            half = int(peak * frac)
            cv2.line(canvas, (x0 + peak - half, yy), (x0 + peak + half, yy), _shade(b.roof, -0.5), 1)
        _poly(canvas, [(x0, base_y), (x0 + peak, b.top - rise), (x1, base_y)], trim_color, trim + 1)
        cv2.rectangle(canvas, (x0, base_y), (x1, base_y + int(0.012 * h)), trim_color, -1)
        eave = base_y + int(0.012 * h)
    # Eave shadow: the cornice throws a dark band down the boards, and the
    # overhang keeps the top of the wall in ambient shade.
    cv2.rectangle(shadows, (x0, eave), (x1, eave + int(0.03 * h)), 255, -1)
    _ao_strip(canvas, x0, eave, x1, int(0.05 * h), 0.4)
    cv2.line(canvas, (x0, b.top), (x0, ground), TRIM_DARK, 1)
    cv2.line(canvas, (x1, b.top), (x1, ground), TRIM_DARK, 1)

    # The name board across the false front, lettered to fit and never cut off.
    sign_h = int(0.055 * h)
    sign_y = min(eave + int(0.02 * h), ground - int(AWNING_Y * h) - sign_h - int(0.02 * h))
    sx0, sx1 = x0 + trim * 3 + corner, x1 - trim * 3 - corner
    cv2.rectangle(canvas, (sx0, sign_y), (sx1, sign_y + sign_h), _shade(b.color, -0.5), -1)
    cv2.rectangle(canvas, (sx0, sign_y), (sx1, sign_y + sign_h), trim_color, 1)
    cv2.line(canvas, (sx0 + 1, sign_y + sign_h - 1), (sx1 - 1, sign_y + sign_h - 1), _shade(b.color, -0.7), 1)
    cv2.rectangle(shadows, (sx0 + _lean(sign_h * 0.2), sign_y + sign_h), (sx1 + _lean(sign_h * 0.2), sign_y + sign_h + trim * 2), 255, -1)
    canvas_w = canvas.shape[1]
    if sx0 >= 0 and sx1 <= canvas_w and sign_h > 7:
        scale = sign_h / 40.0
        width = cv2.getTextSize(b.sign, SLAB, scale, 1)[0][0]
        room = sx1 - sx0 - int(0.03 * h)
        if width > room:
            scale *= room / width
            width = cv2.getTextSize(b.sign, SLAB, scale, 1)[0][0]
        if scale > 0.3:
            origin = (int((sx0 + sx1) / 2 - width / 2), sign_y + int(sign_h * 0.72))
            cv2.putText(canvas, b.sign, (origin[0] + 1, origin[1] + 1), SLAB, scale, (20, 20, 24), 1, cv2.LINE_AA)
            cv2.putText(canvas, b.sign, origin, SLAB, scale, TRIM, 1, cv2.LINE_AA)

    # Upstairs windows: a bevelled frame, dark glass, one slanting pane of sky,
    # and the frame's own shadow thrown down the boards.
    win_w, win_h = int(WIN_W * h), int(WIN_H * h)
    win_top = ground - int(WIN_TOP * h)
    for wx in b.windows:
        fx0, fy0, fx1, fy1 = wx - win_w // 2 - trim * 2, win_top - trim * 2, wx + win_w // 2 + trim * 2, win_top + win_h + trim * 2
        cv2.rectangle(canvas, (fx0, fy0), (fx1, fy1), trim_color, -1)
        cv2.line(canvas, (fx0, fy1), (fx1, fy1), trim_shade, trim)
        cv2.line(canvas, (fx1, fy0), (fx1, fy1), trim_shade, trim)
        cv2.rectangle(canvas, (wx - win_w // 2, win_top), (wx + win_w // 2, win_top + win_h), GLASS, -1)
        _poly(canvas, [(wx - win_w // 2, win_top), (wx - win_w // 2 + int(win_w * 0.55), win_top),
                       (wx - win_w // 2, win_top + int(win_h * 0.6))], GLASS_LIGHT)
        cv2.line(canvas, (wx, win_top), (wx, win_top + win_h), trim_color, 1)
        cv2.line(canvas, (wx - win_w // 2, win_top + win_h // 2), (wx + win_w // 2, win_top + win_h // 2), trim_color, 1)
        sill = trim * 2
        cv2.rectangle(canvas, (fx0 - trim, fy1), (fx1 + trim, fy1 + sill), trim_color, -1)
        _poly(shadows, [(fx1, fy0 + sill), (fx1 + _lean(sill * 2), fy0 + sill), (fx1 + _lean(sill * 2), fy1 + sill),
                        (fx1, fy1 + sill)], 255)
        _poly(shadows, [(fx0 + _lean(sill), fy1 + sill), (fx1 + trim + _lean(sill), fy1 + sill),
                        (fx1 + trim + _lean(sill * 2), fy1 + sill * 2), (fx0 + _lean(sill * 2), fy1 + sill * 2)], 255)

    # The door: a room behind it, lamp-lit or not, so whoever steps out is a
    # silhouette; a lintel and jambs in the trim, and batwing doors on some.
    if b.door_x is not None:
        door_w, door_h = int(DOOR_W * h), int(DOOR_H * h)
        dx0, dy0, dx1 = b.door_x - door_w // 2, ground - door_h, b.door_x + door_w // 2
        jamb = trim * 2
        cv2.rectangle(canvas, (dx0 - jamb, dy0 - jamb * 2), (dx1 + jamb, ground), trim_color, -1)
        cv2.line(canvas, (dx1 + jamb, dy0 - jamb * 2), (dx1 + jamb, ground), trim_shade, trim)
        cv2.line(canvas, (dx0 - jamb, dy0 - jamb), (dx1 + jamb, dy0 - jamb), trim_shade, 1)
        if b.door_lit:
            _vertical_fill(canvas, dx0, dy0, dx1, ground, LAMP, DOOR_DEEP)
            room = canvas[max(0, dy0):ground, max(0, dx0):dx1]
            if room.size:
                lamp = np.zeros_like(room)
                cv2.ellipse(lamp, (room.shape[1] // 2, int(room.shape[0] * 0.16)),
                            (int(room.shape[1] * 0.45), int(room.shape[0] * 0.22)), 0, 0, 360, (60, 90, 90), -1, cv2.LINE_AA)
                cv2.GaussianBlur(lamp, (0, 0), max(1.0, room.shape[1] * 0.2), dst=lamp)
                cv2.add(room, lamp, dst=room)
                cv2.circle(room, (room.shape[1] // 2, int(room.shape[0] * 0.14)), max(2, int(room.shape[1] * 0.06)),
                           LAMP_CORE, -1, cv2.LINE_AA)
                cv2.line(room, (0, int(room.shape[0] * 0.9)), (room.shape[1], int(room.shape[0] * 0.9)),
                         _shade(LAMP, -0.6), 1)
        else:
            _vertical_fill(canvas, dx0, dy0, dx1, ground, DOOR_COLD, DOOR_DEEP)
            # A slant of daylight across the dark floor inside.
            _poly(canvas, [(dx0, ground), (dx0 + int(door_w * 0.5), ground), (dx0, ground - int(door_h * 0.18))],
                  _shade(DOOR_COLD, 0.25))
        # The recess: ambient occlusion darkens the reveal on both jambs and under
        # the lintel, and the sunward jamb's inside catches a sliver of the room light.
        reveal = max(2, int(door_w * 0.14))
        _horizontal_shade(canvas, dx0, dy0, dx0 + reveal, ground, 0.45, 1.0)
        _horizontal_shade(canvas, dx1 - reveal, dy0, dx1, ground, 1.0, 0.4)
        _ao_strip(canvas, dx0, dy0, dx1, max(2, int(door_h * 0.12)), 0.55)
        cv2.line(canvas, (dx0, dy0), (dx0, ground), _shade(LAMP if b.door_lit else DOOR_COLD, 0.2), max(1, trim))
        if b.door_style == "batwing":
            # Batwing half-doors swung back against the jambs, seen edge-on.
            wing_w = int(door_w * 0.22)
            top, bottom = ground - int(door_h * 0.72), ground - int(door_h * 0.2)
            wood = _shade(b.color, -0.2) if sum(b.color) < 560 else _shade(PLANK_DARK, 0.1)
            for side in (-1, 1):
                jx = dx0 if side < 0 else dx1
                far = jx + side * wing_w
                pts = [(jx, top), (far, top + int(door_h * 0.05)), (far, bottom - int(door_h * 0.05)), (jx, bottom)]
                _poly(canvas, pts, wood)
                _poly(canvas, pts, _shade(wood, -0.5), 1)
                for frac in (0.25, 0.5, 0.75):
                    yy = int(top + (bottom - top) * frac)
                    cv2.line(canvas, (jx, yy), (far, yy + side * 0), _shade(wood, -0.45), 1)
            cv2.rectangle(shadows, (dx1 + jamb, top), (dx1 + jamb + _lean(wing_w), bottom), 255, -1)
        else:
            # An open door standing back against the wall beside the frame.
            leaf_w = int(door_w * 0.3)
            leaf = _shade(b.color, -0.35)
            cv2.rectangle(canvas, (dx1 + jamb, dy0 - jamb), (dx1 + jamb + leaf_w, ground), leaf, -1)
            cv2.rectangle(canvas, (dx1 + jamb, dy0 - jamb), (dx1 + jamb + leaf_w, ground), _shade(leaf, -0.5), 1)
            for frac in (0.3, 0.7):
                yy = int(dy0 + door_h * frac)
                cv2.rectangle(canvas, (dx1 + jamb + 2, yy - int(door_h * 0.12)), (dx1 + jamb + leaf_w - 2, yy + int(door_h * 0.12)),
                              _shade(leaf, -0.3), 1)
            cv2.circle(canvas, (dx1 + jamb + 3, int(dy0 + door_h * 0.5)), max(1, trim), GLINT, -1, cv2.LINE_AA)
            cv2.rectangle(shadows, (dx1 + jamb + leaf_w, dy0), (dx1 + jamb + leaf_w + _lean(jamb * 2), ground), 255, -1)
        cv2.rectangle(shadows, (dx1 + jamb, dy0), (dx1 + jamb + _lean(jamb * 2), ground), 255, -1)

    # The awning: a plank roof on posts, and the long shadow it throws across the
    # front and down onto the boardwalk, with ambient shade tucked under it.
    if b.awning:
        awn_y = ground - int(AWNING_Y * h)
        awn_d = int(0.035 * h)
        lean_px = _lean(awn_d * 2)
        cv2.rectangle(canvas, (x0, awn_y), (x1, awn_y + awn_d), PLANK_DARK, -1)
        cv2.rectangle(canvas, (x0, awn_y), (x1, awn_y + int(awn_d * 0.4)), PLANK, -1)
        cv2.rectangle(canvas, (x0, awn_y - trim), (x1, awn_y), b.roof, -1)
        for px in range(x0, x1, max(3, int(0.02 * h))):
            cv2.line(canvas, (px, awn_y), (px, awn_y + awn_d), _shade(PLANK_DARK, -0.3), 1)
        # The porch beneath is in the awning's shade: at noon almost to the
        # boards, shortening as the sun drops; the sunward end slants with the light.
        late = (lean - LEAN_NOON) / max(1e-6, LEAN_LATE - LEAN_NOON)
        band = int((ground - awn_y - awn_d) * (0.88 - 0.42 * late))
        _poly(shadows, [(x0 + lean_px // 2, awn_y + awn_d), (x1 + lean_px, awn_y + awn_d),
                        (x1 + lean_px * 2, awn_y + awn_d + band), (x0 + lean_px * 2, awn_y + awn_d + band)], 255)
        _ao_strip(canvas, x0, awn_y + awn_d, x1, int(0.05 * h), 0.4)
        # And across the boardwalk beneath it.
        _poly(shadows, [(x0 + lean_px * 2, ground), (x1 + lean_px * 2, ground),
                        (x1 + lean_px * 3, street.walk_y), (x0 + lean_px * 3, street.walk_y)], 255)
        post_w = max(2, int(0.012 * h))
        for px in (x0 + post_w * 2, x1 - post_w * 2):
            cv2.line(canvas, (px, awn_y + awn_d), (px, street.walk_y), PLANK_DARK, post_w, cv2.LINE_AA)
            cv2.line(canvas, (px - post_w // 2, awn_y + awn_d), (px - post_w // 2, street.walk_y),
                     PLANK, 1, cv2.LINE_AA)
            # Each post throws a slanting line across the boards.
            cv2.line(shadows, (px, ground), (px + _lean(street.walk_y - ground) + post_w * 2, street.walk_y),
                     255, post_w)


def _draw_water_tower(canvas: np.ndarray, street: Street, shadows: np.ndarray, lean: float) -> None:
    h = street.area.height
    x = street.tower_x
    base = street.ground_y - int(0.02 * h)
    tank_w, tank_h = int(0.17 * h), int(0.14 * h)
    tank_bottom = base - int(0.42 * h)
    # Legs, braced.
    leg = max(2, int(0.012 * h))
    for side in (-1, 1):
        cv2.line(canvas, (x + side * int(tank_w * 0.38), tank_bottom),
                 (x + side * int(tank_w * 0.52), base), TANK_DARK, leg, cv2.LINE_AA)
    for frac in (0.3, 0.65):
        y = int(tank_bottom + (base - tank_bottom) * frac)
        half = int(tank_w * (0.38 + 0.14 * frac))
        cv2.line(canvas, (x - half, y), (x + half, y), TANK_DARK, max(1, leg // 2), cv2.LINE_AA)
        cv2.line(canvas, (x - half, y), (x + half, y - int(0.06 * h)), TANK_DARK, 1, cv2.LINE_AA)
        cv2.line(canvas, (x + half, y), (x - half, y - int(0.06 * h)), TANK_DARK, 1, cv2.LINE_AA)
    # Tank: a cylinder lit from the left, with a soft gradient across it.
    cv2.rectangle(canvas, (x - tank_w // 2, tank_bottom - tank_h), (x + tank_w // 2, tank_bottom), TANK, -1)
    roi = canvas[tank_bottom - tank_h:tank_bottom, x - tank_w // 2:x + tank_w // 2]
    if roi.size:
        gain = np.linspace(1.3, 0.55, roi.shape[1], dtype=np.float32)[None, :, None]
        roi[:] = np.clip(roi.astype(np.float32) * gain, 0, 255).astype(np.uint8)
    for frac in (0.25, 0.75):
        y = int(tank_bottom - tank_h * frac)
        cv2.line(canvas, (x - tank_w // 2, y), (x + tank_w // 2, y), BARREL_BAND, max(1, leg // 2))
    # Conical roof.
    _poly(canvas, [(x - int(tank_w * 0.58), tank_bottom - tank_h), (x, tank_bottom - tank_h - int(0.08 * h)),
                   (x + int(tank_w * 0.58), tank_bottom - tank_h)], TANK_DARK)
    _poly(canvas, [(x - int(tank_w * 0.58), tank_bottom - tank_h), (x, tank_bottom - tank_h - int(0.08 * h)),
                   (x - int(tank_w * 0.05), tank_bottom - tank_h)], _shade(TANK, 0.15))


def _draw_barrel(canvas: np.ndarray, x: int, bottom: int, width: int) -> None:
    height = int(width * 1.35)
    top = bottom - height
    bulge = int(width * 0.06)
    _poly(canvas, [(x - width // 2, top), (x + width // 2, top), (x + width // 2 + bulge, bottom - height // 2),
                   (x + width // 2, bottom), (x - width // 2, bottom), (x - width // 2 - bulge, bottom - height // 2)],
          BARREL)
    # Staves, lit on the sunward side and falling into shade on the other.
    for i in range(1, 6):
        sx = x - width // 2 + width * i // 6
        cv2.line(canvas, (sx, top), (sx, bottom), _shade(BARREL, -0.25), 1, cv2.LINE_AA)
    cv2.rectangle(canvas, (x - width // 2, top), (x - width // 2 + width // 6, bottom), _warm(BARREL, 0.28), -1)
    cv2.rectangle(canvas, (x - width // 2 + width // 6, top), (x - width // 2 + width // 3, bottom), _warm(BARREL, 0.1), -1)
    cv2.rectangle(canvas, (x + width // 2 - width // 4, top), (x + width // 2, bottom), _cool(BARREL, 0.3), -1)
    cv2.rectangle(canvas, (x + width // 2 - width // 8, top), (x + width // 2, bottom), _cool(BARREL, 0.55), -1)
    cv2.line(canvas, (x - width // 2 - bulge // 2, top + 2), (x - width // 2 - bulge, bottom - height // 2), _warm(BARREL, 0.5), 1, cv2.LINE_AA)
    band = max(2, int(width * 0.05))
    for frac in (0.15, 0.5, 0.85):
        y = int(top + height * frac)
        cv2.line(canvas, (x - width // 2 - (bulge if frac == 0.5 else 0), y),
                 (x + width // 2 + (bulge if frac == 0.5 else 0), y), BARREL_BAND, band)
        cv2.line(canvas, (x - width // 2, y - band // 2), (x + width // 2, y - band // 2), _shade(BARREL_BAND, 0.4), 1)
    cv2.ellipse(canvas, (x, top), (width // 2, max(2, width // 10)), 0, 0, 360, _shade(BARREL, -0.3), -1, cv2.LINE_AA)


def _draw_sky(canvas: np.ndarray, rect: Rect, ground: int, hour: int) -> None:
    """Blue overhead, bleaching to a dusty ochre at the horizon, with a haze
    lying low over the mesas and the sun in a soft bloom. The later the hour,
    the lower the sun and the more amber the whole sky."""
    height, width = canvas.shape[:2]
    h = rect.height
    t = _hour_t(hour)
    top = np.array(_mix(SKY_TOP, SKY_TOP_LATE, t), np.float32)
    mid = np.array(_mix(SKY_MID, SKY_MID_LATE, t), np.float32)
    hor = np.array(_mix(SKY_HORIZON, SKY_HORIZON_LATE, t), np.float32)
    rows = np.arange(ground, dtype=np.float32) / max(1, ground - 1)
    split = 0.55
    t_hi = np.clip(rows / split, 0, 1)[:, None]
    t_lo = np.clip((rows - split) / (1 - split), 0, 1)[:, None] ** 1.4
    sky = np.where(rows[:, None] < split, top + (mid - top) * t_hi, mid + (hor - mid) * t_lo)
    canvas[:ground] = np.clip(sky, 0, 255).astype(np.uint8)[:, None, :]

    # The sun: a wide soft bloom, a tighter halo and a small hot disc, computed
    # on a coarse grid and scaled up, which costs a few milliseconds rather than
    # a large blur of the whole frame.
    sun = _sun_at(rect, hour)
    step = 4
    gh, gw = (ground + step - 1) // step, (width + step - 1) // step
    ys, xs = np.mgrid[0:gh, 0:gw].astype(np.float32) * step
    d = np.hypot(xs - sun[0], ys - sun[1]) / h
    bloom = np.exp(-(d / 0.55) ** 2) * 0.55 + np.exp(-(d / 0.16) ** 2) * 0.75 + np.exp(-(d / 0.045) ** 2) * 1.6
    glow_color = np.array(_mix((80, 120, 150), (40, 120, 200), t), np.float32)
    glow = (bloom[..., None] * glow_color)
    glow = cv2.resize(glow, (width, ground), interpolation=cv2.INTER_LINEAR)
    region = canvas[:ground].astype(np.float32) + glow
    canvas[:ground] = np.clip(region, 0, 255).astype(np.uint8)
    # The disc itself, a little over-exposed.
    disc = np.zeros((ground, width, 3), np.float32)
    cv2.circle(disc, sun, int(0.028 * h), (150, 170, 180), -1, cv2.LINE_AA)
    cv2.GaussianBlur(disc, (0, 0), 0.012 * h, dst=disc)
    canvas[:ground] = np.clip(canvas[:ground].astype(np.float32) + disc, 0, 255).astype(np.uint8)


def _draw_haze(canvas: np.ndarray, rect: Rect, top: int, ground: int, hour: int) -> None:
    """Dust hanging low over the horizon: the far ground washes out into it."""
    x0, y0, x1, y1 = _clip_box(canvas, 0, top, canvas.shape[1], ground)
    if y1 <= y0:
        return
    haze = np.array(_mix(HAZE, HAZE_LATE, _hour_t(hour)), np.float32)
    a = (np.linspace(0.0, 1.0, y1 - y0, dtype=np.float32) ** 1.6 * 0.75)[:, None, None]
    roi = canvas[y0:y1, x0:x1]
    roi[:] = (roi.astype(np.float32) * (1 - a) + haze * a).astype(np.uint8)


def _draw_street_plane(canvas: np.ndarray, street: Street, rng, vanish: tuple[int, int], lean: float) -> None:
    """What lies on the sand: wagon ruts running at the vanishing point, a
    wander of hoofprints, and the debris of a working street, each with a
    sliver of sun-side highlight and lee-side shade."""
    height, width = canvas.shape[:2]
    rect = street.area
    h = rect.height
    walk = street.walk_y
    vx, vy = vanish
    bottom = height

    def toward(x_near: float, t: float) -> tuple[int, int]:
        # A point t of the way from the bottom edge up toward the vanishing point.
        return (int(x_near + (vx - x_near) * t), int(bottom + (vy - bottom) * t))

    t_top = (walk + 0.03 * h - bottom) / (vy - bottom)   # where the sand meets the boardwalk
    # Two wagons' worth of ruts, each wheel a soft-edged groove: drawn as a dark
    # trough with a lit right lip on a layer of its own, blurred, then laid
    # over the sand so the edges crumble rather than cut.
    layer = canvas[walk:].copy()
    steps = 16
    for x_near in (rect.x + rect.width * 0.06, rect.x + rect.width * 0.27,
                   rect.x + rect.width * 0.71, rect.x + rect.width * 0.95):
        wobble = rng.uniform(-0.015, 0.015) * rect.width
        pts = [toward(x_near + wobble * math.sin(i * 0.7), t_top * i / steps) for i in range(steps + 1)]
        for i in range(steps):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            near = 1 - i / steps
            w = max(2, int(0.075 * h * (0.12 + 0.88 * near)))
            cv2.line(layer, (ax, ay - walk), (bx, by - walk), _cool(DUST_NEAR, 0.22), w, cv2.LINE_AA)
            cv2.line(layer, (ax - w // 4, ay - walk), (bx - w // 4, by - walk), _cool(RUT, 0.2), max(1, w // 3), cv2.LINE_AA)
            cv2.line(layer, (ax + w // 2, ay - walk), (bx + w // 2, by - walk), _warm(DUST, 0.3), max(1, w // 4), cv2.LINE_AA)
    cv2.GaussianBlur(layer, (0, 0), max(1.5, 0.007 * h), dst=layer)
    cv2.addWeighted(layer, 0.75, canvas[walk:], 0.25, 0.0, dst=canvas[walk:])

    # Hoofprints wander across between the ruts, small crescents pressed in.
    for _ in range(3):
        x_near = rng.uniform(rect.x + rect.width * 0.35, rect.x + rect.width * 0.65)
        drift = rng.uniform(-0.2, 0.2) * rect.width
        for i in range(18):
            t = t_top * i / 18 * rng.uniform(0.95, 1.05)
            px, py = toward(x_near + drift * (i / 18), t)
            px += int(rng.choice((-1, 1)) * 0.012 * h * (1 - t))
            r = max(1, int(0.012 * h * (1 - t * 0.8)))
            cv2.ellipse(canvas, (px, py), (r, max(1, r // 2)), 0, 0, 360, _cool(DUST_NEAR, 0.35), -1, cv2.LINE_AA)
            cv2.ellipse(canvas, (px, py), (r, max(1, r // 2)), 0, 180, 360, _warm(DUST, 0.2), 1, cv2.LINE_AA)

    # Pebbles, each with its own speck of shadow on the lee side.
    for _ in range(int(rect.width / 9)):
        px, py = int(rng.uniform(0, width)), int(rng.uniform(walk + 0.04 * h, height))
        r = max(1, int(rng.uniform(1, 3) * h / 600))
        cv2.ellipse(canvas, (px + r, py + 1), (r + 1, max(1, r // 2)), 0, 0, 360, _cool(DUST_NEAR, 0.35), -1, cv2.LINE_AA)
        cv2.circle(canvas, (px, py), r, _shade(DUST_NEAR, rng.uniform(-0.25, 0.3)), -1, cv2.LINE_AA)
        cv2.circle(canvas, (px - r // 2, py - r // 2), max(1, r // 2), _warm(DUST, 0.3), -1)

    # Debris: a dropped plank, a horseshoe, a broken wheel spoke, a few bones.
    def shadowed(points, base_y):
        _poly(canvas, _sheared(points, base_y, lean, SQUASH * 0.5), _cool(DUST_NEAR, 0.4))

    plank_x = int(rect.x + rect.width * rng.uniform(0.12, 0.2))
    plank_y = int(walk + 0.17 * h)
    pw, ph = int(0.14 * h), int(0.018 * h)
    box = cv2.boxPoints(((plank_x, plank_y), (pw, ph), -8.0)).astype(np.int32)
    lifted = [(int(px), int(py - ph * 0.6)) for px, py in box]
    shadowed(lifted, plank_y + ph // 2)
    cv2.fillPoly(canvas, [box], PLANK_DARK, cv2.LINE_AA)
    cv2.fillPoly(canvas, [np.array([box[0], box[1], (box[1] + box[2]) // 2, (box[0] + box[3]) // 2])], _warm(PLANK, 0.1), cv2.LINE_AA)
    cv2.polylines(canvas, [box], True, _shade(PLANK_DARK, -0.4), 1, cv2.LINE_AA)

    shoe_x = int(rect.x + rect.width * rng.uniform(0.78, 0.86))
    shoe_y = int(walk + 0.24 * h)
    sr = max(3, int(0.02 * h))
    cv2.ellipse(canvas, (shoe_x + int(sr * lean * 0.5), shoe_y + 1), (sr + 1, max(1, sr // 2 + 1)), 0, 0, 360, _cool(DUST_NEAR, 0.4), -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (shoe_x, shoe_y), (sr, max(1, sr // 2)), 0, 200, 520, (60, 62, 68), max(1, sr // 3), cv2.LINE_AA)
    cv2.ellipse(canvas, (shoe_x, shoe_y - 1), (sr, max(1, sr // 2)), 0, 200, 340, (140, 146, 156), 1, cv2.LINE_AA)

    for _ in range(2):
        bx = int(rng.uniform(rect.x + 0.1 * rect.width, rect.right - 0.1 * rect.width))
        by = int(rng.uniform(walk + 0.06 * h, height - 0.02 * h))
        ln = int(rng.uniform(0.03, 0.05) * h)
        ang = rng.uniform(-0.4, 0.4)
        ex, ey = bx + int(math.cos(ang) * ln), by + int(math.sin(ang) * ln * 0.4)
        cv2.line(canvas, (bx + 2, by + 2), (ex + 2, ey + 2), _cool(DUST_NEAR, 0.4), 2, cv2.LINE_AA)
        cv2.line(canvas, (bx, by), (ex, ey), (210, 222, 232), 2, cv2.LINE_AA)
        cv2.circle(canvas, (bx, by), 2, (210, 222, 232), -1, cv2.LINE_AA)
        cv2.circle(canvas, (ex, ey), 2, (196, 208, 220), -1, cv2.LINE_AA)

    # A few dry tufts of grass in the lee of the boardwalk.
    for _ in range(7):
        gx = int(rng.uniform(0, width))
        gy = int(walk + rng.uniform(0.03, 0.1) * h)
        for k in range(5):
            a = -math.pi / 2 + (k - 2) * 0.32
            ln = int(rng.uniform(0.012, 0.025) * h)
            cv2.line(canvas, (gx, gy), (gx + int(math.cos(a) * ln), gy + int(math.sin(a) * ln)),
                     _shade(WEED, rng.uniform(-0.2, 0.3)), 1, cv2.LINE_AA)


@lru_cache(maxsize=8)
def _backdrop(area: tuple, width: int, height: int, seed: int, hour: int = 0) -> np.ndarray:
    """The whole street at one hour of the round, fixed until the next. Built once."""
    rect = Rect(*area)
    street = build_street(rect, seed)
    h = rect.height
    canvas = np.zeros((height, width, 3), np.uint8)
    ground = street.ground_y
    rng = np.random.default_rng(seed + 3)
    lean = _lean_for(hour)

    _draw_sky(canvas, rect, ground, hour)

    # Distant mesas, flat-topped and hazed out.
    mesa_y = ground - int(0.12 * h)
    x = rect.x - int(0.2 * h)
    while x < rect.right + int(0.2 * h):
        w = int(rng.uniform(0.3, 0.7) * h)
        top = mesa_y - int(rng.uniform(0.05, 0.16) * h)
        slope = int(rng.uniform(0.02, 0.06) * h)
        _poly(canvas, [(x, ground), (x + slope, top), (x + w - slope, top), (x + w, ground)],
              _shade(MESA, rng.uniform(0.1, 0.35)))
        x += w + int(rng.uniform(-0.05, 0.1) * h)
    _draw_haze(canvas, rect, ground - int(0.34 * h), ground, hour)

    # Street and boardwalk, under everything.
    canvas[ground:] = np.linspace(DUST, DUST_NEAR, height - ground)[:, None, :]

    shadows = np.zeros((height, width), np.uint8)
    _draw_water_tower(canvas, street, shadows, lean)
    # Buildings from the edges inwards, so nearer-centre fronts cover side walls.
    # Their shadows gather on one mask and are laid down together.
    vanish = (rect.centre_x, ground - int(0.10 * h))
    for b in sorted(street.buildings, key=lambda b: -abs((b.x + b.width / 2) - vanish[0])):
        _draw_building(canvas, b, street, vanish, shadows, rng, lean)
    # Every false front stands proud of its neighbour on the right, and throws a
    # slanting strip of shade down that wall; a taller front throws a longer one.
    fronts = sorted(street.buildings, key=lambda b: b.x)
    for b, nb in zip(fronts, fronts[1:]):
        x1 = b.x + b.width
        if nb.x - x1 > 0.07 * h:
            continue
        proud = int(0.05 * h + max(0, nb.top - b.top) * 0.15)
        w = int(proud * lean)
        top = max(b.top, nb.top)
        _poly(shadows, [(x1, top), (x1 + w, top + int(w * 0.9)), (x1 + w, ground), (x1, ground)], 255)

    # The boardwalk: sun-bleached planks with a shadowed front edge, and the
    # dark of the crawlspace under it.
    walk = street.walk_y
    cv2.rectangle(canvas, (0, ground), (width, walk), PLANK, -1)
    plank = max(3, int(0.025 * h))
    for px in range(0, width, plank):
        cv2.line(canvas, (px, ground), (px, walk), PLANK_DARK, 1)
    _grain(canvas, 0, ground, width, walk, rng, 6.0, streaks=True)
    _ao_strip(canvas, 0, ground, width, int(0.015 * h), 0.3)
    edge = max(2, int(0.012 * h))
    cv2.rectangle(canvas, (0, walk), (width, walk + edge), PLANK_DARK, -1)
    cv2.rectangle(canvas, (0, walk + edge), (width, walk + edge * 2), _shade(PLANK_DARK, -0.5), -1)
    cv2.rectangle(shadows, (0, walk + edge), (width, walk + int(0.02 * h + 0.02 * h * lean)), 255, -1)
    _cast_shadows(canvas, shadows)
    _ao_strip(canvas, 0, walk + edge * 2, width, int(0.04 * h), 0.35)

    # Sand grain first, then everything lying on it.
    grain = rng.normal(0, 7, (height - walk, width, 1))
    weight = np.linspace(0.2, 1.0, height - walk)[:, None, None]
    street_px = canvas[walk:].astype(np.int16) + (grain * weight).astype(np.int16)
    canvas[walk:] = np.clip(street_px, 0, 255).astype(np.uint8)
    _draw_street_plane(canvas, street, rng, vanish, lean)

    # The hitching rail in the foreground: bleached, grained, on posts; the rail
    # and the barrels throw the same long sheared shadows as everything else.
    left, right = street.rail_x
    rail_y = street.rail_y
    bar = max(3, int(0.024 * h))
    post = max(3, int(0.018 * h))
    post_bottom = rail_y + int(0.13 * h)
    near = np.zeros((height, width), np.uint8)
    for px in (left, right):
        _poly(near, _sheared([(px - post // 2, rail_y), (px + post // 2, rail_y),
                              (px + post // 2, post_bottom), (px - post // 2, post_bottom)], post_bottom, lean), 255)
    _poly(near, _sheared([(left - post, rail_y), (right + post, rail_y),
                          (right + post, rail_y + bar), (left - post, rail_y + bar)], post_bottom, lean), 255)
    for bx, by, bw in street.barrels:
        bh = int(bw * 1.35)
        bulge = int(bw * 0.06)
        _poly(near, _sheared([(bx - bw // 2, by - bh), (bx + bw // 2, by - bh), (bx + bw // 2 + bulge, by - bh // 2),
                              (bx + bw // 2, by), (bx - bw // 2, by), (bx - bw // 2 - bulge, by - bh // 2)], by, lean), 255)
    _cast_shadows(canvas, near, 0.55)
    for px in (left, right):
        cv2.rectangle(canvas, (px - post // 2, rail_y), (px + post // 2, post_bottom), RAIL_DARK, -1)
        cv2.rectangle(canvas, (px - post // 2, rail_y), (px - post // 2 + max(1, post // 3), post_bottom), _warm(RAIL, 0.2), -1)
        _grain(canvas, px - post // 2, rail_y, px + post // 2, post_bottom, rng, 8.0, streaks=True)
        _ground_shadow(canvas, px + post // 2, post_bottom, post, max(1, post // 3))
    cv2.rectangle(canvas, (left - post, rail_y), (right + post, rail_y + bar), RAIL, -1)
    _grain(canvas, left - post, rail_y, right + post, rail_y + bar, rng, 9.0, streaks=True)
    cv2.rectangle(canvas, (left - post, rail_y), (right + post, rail_y + max(1, bar // 3)), _warm(RAIL, 0.4), -1)
    cv2.rectangle(canvas, (left - post, rail_y + bar - max(1, bar // 3)), (right + post, rail_y + bar), _cool(RAIL, 0.45), -1)
    for _ in range(6):
        kx = int(rng.uniform(left, right))
        cv2.ellipse(canvas, (kx, rail_y + bar // 2), (max(2, bar // 3), max(1, bar // 5)), 0, 0, 360,
                    RAIL_DARK, 1, cv2.LINE_AA)

    for bx, by, bw in street.barrels:
        _draw_barrel(canvas, bx, by, bw)

    # The hour's colour over everything.
    tint = _tint_for(hour)
    if not np.allclose(tint, 1.0):
        canvas[:] = np.clip(canvas.astype(np.float32) * tint, 0, 255).astype(np.uint8)

    # Below the play area a dark strip, so the footer line can be read.
    strip = rect.bottom + max(2, int(0.006 * h))
    if strip < height:
        roi = canvas[strip:]
        roi[:] = (roi.astype(np.float32) * 0.22).astype(np.uint8)
    return canvas


# --- drawing what moves ------------------------------------------------------------

def draw_bottle(canvas: np.ndarray, bottle: Bottle, lean: float = LEAN_NOON) -> None:
    x, base = int(bottle.x), int(bottle.base_y)
    hgt = bottle.height
    w = bottle.width
    neck_w = w * 0.42
    shoulder = base - hgt * (1 - bottle.neck)
    color = bottle.color
    outline = [(x - w / 2, base), (x + w / 2, base), (x + w / 2, shoulder + hgt * 0.06),
               (x + neck_w / 2, shoulder - hgt * 0.06), (x + neck_w / 2, base - hgt),
               (x - neck_w / 2, base - hgt), (x - neck_w / 2, shoulder - hgt * 0.06),
               (x - w / 2, shoulder + hgt * 0.06)]
    # Its shadow across the plank first: the whole bottle, sheared by the sun.
    _cast_shadow(canvas, outline, base + 2, lean * 0.9, 0.45, 0.06)
    _ground_shadow(canvas, int(x + w * 0.2), base, int(w * 0.5), max(1, int(w * 0.12)))
    body = np.array(outline, np.int32)
    cv2.fillPoly(canvas, [body], color, cv2.LINE_AA)
    # Glass has an inside: the far wall shows through as a lighter core, the
    # rims at either edge go dark where the glass is thickest, and the base is
    # a heavy dark foot.
    x0, x1 = int(x - w / 2), int(x + w / 2)
    cv2.rectangle(canvas, (int(x - w * 0.22), int(base - hgt * 0.1)), (int(x + w * 0.12), int(shoulder + hgt * 0.05)),
                  _shade(color, 0.18), -1)
    cv2.rectangle(canvas, (int(x - neck_w * 0.2), int(base - hgt * 0.95)), (int(x + neck_w * 0.1), int(shoulder - hgt * 0.05)),
                  _shade(color, 0.18), -1)
    cv2.line(canvas, (int(x + w * 0.42), int(base - hgt * 0.05)), (int(x + w * 0.42), int(shoulder + hgt * 0.05)),
             _cool(color, 0.5), max(1, int(w * 0.14)), cv2.LINE_AA)
    cv2.line(canvas, (int(x - w * 0.45), int(base - hgt * 0.05)), (int(x - w * 0.45), int(shoulder + hgt * 0.05)),
             _shade(color, -0.3), max(1, int(w * 0.08)), cv2.LINE_AA)
    cv2.line(canvas, (int(x + neck_w * 0.38), int(base - hgt * 0.95)), (int(x + neck_w * 0.38), int(shoulder - hgt * 0.05)),
             _cool(color, 0.5), max(1, int(neck_w * 0.25)), cv2.LINE_AA)
    # The liquid inside, with a meniscus.
    fill_y = int(base - hgt * 0.34)
    cv2.rectangle(canvas, (x0 + 1, fill_y), (x1 - 1, base - 1), _shade(color, -0.22), -1)
    cv2.rectangle(canvas, (int(x - w * 0.2), fill_y), (int(x + w * 0.08), base - 1), _shade(color, -0.08), -1)
    cv2.ellipse(canvas, (x, fill_y), (int(w / 2) - 1, max(1, int(w * 0.08))), 0, 0, 360, _shade(color, 0.2), 1, cv2.LINE_AA)
    foot = int(hgt * 0.09)
    cv2.rectangle(canvas, (x0, base - foot), (x1, base), _cool(color, 0.55), -1)
    cv2.ellipse(canvas, (x, base - foot), (int(w / 2), max(1, int(w * 0.1))), 0, 0, 180, _shade(color, -0.6), 1, cv2.LINE_AA)
    # Specular: one hard white stripe down the sunward side, a softer one
    # beside it, and a bead on the shoulder where the glass turns.
    cv2.line(canvas, (int(x - w * 0.3), int(base - hgt * 0.12)), (int(x - w * 0.3), int(shoulder + hgt * 0.02)),
             _shade(color, 0.9), max(1, int(w * 0.09)), cv2.LINE_AA)
    cv2.line(canvas, (int(x - w * 0.16), int(base - hgt * 0.12)), (int(x - w * 0.16), int(shoulder + hgt * 0.02)),
             _shade(color, 0.45), 1, cv2.LINE_AA)
    cv2.line(canvas, (int(x - neck_w * 0.3), int(base - hgt * 0.93)), (int(x - neck_w * 0.3), int(shoulder - hgt * 0.06)),
             _shade(color, 0.9), max(1, int(neck_w * 0.16)), cv2.LINE_AA)
    cv2.circle(canvas, (int(x - w * 0.28), int(shoulder + hgt * 0.02)), max(1, int(w * 0.07)), GLINT, -1, cv2.LINE_AA)
    # The lip: a thicker collar of glass with a bright rim.
    cv2.rectangle(canvas, (int(x - neck_w / 2 - 1), int(base - hgt)), (int(x + neck_w / 2 + 1), int(base - hgt * 0.94)),
                  _shade(color, -0.25), -1)
    cv2.rectangle(canvas, (int(x - neck_w / 2 - 1), int(base - hgt)), (int(x - neck_w * 0.15), int(base - hgt * 0.94)),
                  _shade(color, 0.3), -1)
    cv2.line(canvas, (int(x - neck_w / 2 - 1), int(base - hgt)), (int(x + neck_w / 2 + 1), int(base - hgt)),
             GLINT, 1, cv2.LINE_AA)
    cv2.polylines(canvas, [body], True, _shade(color, -0.45), 1, cv2.LINE_AA)


def draw_can(canvas: np.ndarray, can: Can, now: float, lean: float = LEAN_NOON) -> None:
    hgt, w = can.height, can.width
    cx, cy = can.x, can.base_y - hgt / 2
    angle = 0.0
    label_color, word = CAN_LABELS[can.label % len(CAN_LABELS)]
    if can.hit_at is not None:
        # Spins up and off the rail, tumbling.
        t = now - can.hit_at
        cx += 180 * t * (hgt / 60)
        cy -= (260 * t - 500 * t * t) * (hgt / 60)
        angle = t * 900
        box = cv2.boxPoints(((float(cx), float(cy)), (float(w), float(hgt)), angle))
        cv2.fillPoly(canvas, [box.astype(np.int32)], CAN, cv2.LINE_AA)
        label = cv2.boxPoints(((float(cx), float(cy)), (float(w), float(hgt * 0.42)), angle))
        cv2.fillPoly(canvas, [label.astype(np.int32)], label_color, cv2.LINE_AA)
        # A lit edge and a dark edge, whichever way it is turned.
        pts = box.astype(np.int32)
        cv2.line(canvas, tuple(pts[0]), tuple(pts[1]), _cool(CAN, 0.5), 2, cv2.LINE_AA)
        cv2.line(canvas, tuple(pts[2]), tuple(pts[3]), _warm(CAN, 0.6), 2, cv2.LINE_AA)
        cv2.polylines(canvas, [pts], True, CAN_DARK, 1, cv2.LINE_AA)
        return

    x0, x1 = int(cx - w / 2), int(cx + w / 2)
    top, bottom = int(can.base_y - hgt), int(can.base_y)
    _cast_shadow(canvas, [(x0, top), (x1, top), (x1, bottom), (x0, bottom)], bottom + 2, lean * 0.9, 0.45, 0.06)
    _ground_shadow(canvas, int(cx + w * 0.15), bottom, int(w * 0.55), max(1, int(w * 0.12)))
    # The cylinder: bands of tone from the lit left edge round into the shade.
    tones = (0.35, 0.6, 0.3, 0.05, -0.2, -0.4, -0.55)
    n = len(tones)
    for i, tone in enumerate(tones):
        sx0 = x0 + int(w * i / n)
        sx1 = x0 + int(w * (i + 1) / n) + 1
        color = _warm(CAN, tone) if tone > 0 else _cool(CAN, -tone)
        cv2.rectangle(canvas, (sx0, top), (min(sx1, x1), bottom), color, -1)
    # The label wraps round with the same light on it, and a word printed on it.
    ly0, ly1 = int(cy - hgt * 0.22), int(cy + hgt * 0.22)
    for i, tone in enumerate(tones):
        sx0 = x0 + int(w * i / n)
        sx1 = x0 + int(w * (i + 1) / n) + 1
        color = _warm(label_color, tone * 0.6) if tone > 0 else _cool(label_color, -tone)
        cv2.rectangle(canvas, (sx0, ly0), (min(sx1, x1), ly1), color, -1)
    cv2.rectangle(canvas, (x0 + int(w * 0.08), ly0 + 2), (x1 - int(w * 0.08), ly1 - 2), (240, 240, 240), 1)
    scale = hgt / 150.0
    if scale > 0.2:
        tw = cv2.getTextSize(word, FONT, scale, 1)[0][0]
        cv2.putText(canvas, word, (int(cx - tw / 2 - w * 0.06), int(cy + hgt * 0.07)), FONT, scale,
                    (250, 250, 250), 1, cv2.LINE_AA)
    # A hard specular stripe down the lit side, and the shade's dark edge.
    cv2.line(canvas, (x0 + int(w * 0.16), top + 2), (x0 + int(w * 0.16), bottom - 2), (244, 246, 248), max(1, int(w * 0.06)), cv2.LINE_AA)
    cv2.line(canvas, (x1 - 1, top), (x1 - 1, bottom), _shade(CAN_DARK, -0.5), 1, cv2.LINE_AA)
    # Rolled ridges top and bottom with a highlight over each, a dark base, and the lid.
    for ry in (top + int(hgt * 0.1), bottom - int(hgt * 0.1)):
        cv2.line(canvas, (x0, ry), (x1, ry), CAN_DARK, 1)
        cv2.line(canvas, (x0, ry - 1), (x0 + int(w * 0.55), ry - 1), (236, 240, 242), 1)
    cv2.rectangle(canvas, (x0, bottom - max(1, int(hgt * 0.04))), (x1, bottom), _cool(CAN, 0.65), -1)
    lid = (int(w / 2), max(1, int(w * 0.13)))
    cv2.ellipse(canvas, (int(cx), top), lid, 0, 0, 360, _warm(CAN, 0.25), -1, cv2.LINE_AA)
    cv2.ellipse(canvas, (int(cx), top), (int(w * 0.38), max(1, int(w * 0.09))), 0, 0, 360, _cool(CAN, 0.3), 1, cv2.LINE_AA)
    cv2.ellipse(canvas, (int(cx), top), lid, 0, 0, 360, CAN_DARK, 1, cv2.LINE_AA)
    cv2.ellipse(canvas, (int(cx), top), lid, 0, 200, 330, GLINT, 1, cv2.LINE_AA)


def draw_sign(canvas: np.ndarray, sign: Sign) -> None:
    px, py = sign.pivot
    cx, cy = sign.centre
    cv2.line(canvas, (px, py), (int(cx), int(cy)), TRIM_DARK, 2, cv2.LINE_AA)
    cv2.circle(canvas, (px, py), 3, TRIM_DARK, -1, cv2.LINE_AA)
    angle_deg = -math.degrees(sign.angle)
    box = cv2.boxPoints(((float(cx), float(cy)), (float(sign.width), float(sign.depth)), angle_deg))
    pts = box.astype(np.int32)
    shadow = pts + np.array([[int(sign.depth * 0.25), int(sign.depth * 0.2)]], np.int32)
    cv2.fillPoly(canvas, [shadow], MAUVE, cv2.LINE_AA)
    cv2.fillPoly(canvas, [pts], SIGN_BOARD, cv2.LINE_AA)
    cv2.polylines(canvas, [pts], True, TRIM, 1, cv2.LINE_AA)
    scale = sign.depth / 40.0
    if scale > 0.3:
        width = cv2.getTextSize(sign.word, SLAB, scale, 1)[0][0]
        # Lettering drawn upright in the board's frame, then placed on it.
        c, s = math.cos(sign.angle), math.sin(sign.angle)
        ox, oy = -width / 2, sign.depth * 0.3
        tx, ty = cx + ox * c - oy * s, cy + ox * s + oy * c
        cv2.putText(canvas, sign.word, (int(tx), int(ty)), SLAB, scale, TRIM, 1, cv2.LINE_AA)


def _warm(color, amount: float) -> tuple[int, int, int]:
    """Lighten toward the sun's own colour: more red and green than blue."""
    b, g, r = color
    return (int(min(255, b + (255 - b) * amount * 0.45)), int(min(255, g + (255 - g) * amount * 0.85)),
            int(min(255, r + (255 - r) * amount)))


def _cool(color, amount: float) -> tuple[int, int, int]:
    """Darken into the shade, which on this street is a cool mauve."""
    return _mix(_shade(color, -amount), MAUVE, amount * 0.35)


def _figure_silhouette(H: float, bandit: bool, variant: int):
    """The outline of a figure H tall with his feet at the origin, in units of H
    (x right, y up), used for the shadow he throws."""
    if bandit:
        return [(-0.12, 0.0), (0.12, 0.0), (0.25, 0.36), (0.23, 0.66), (0.12, 0.8), (0.24, 0.93),
                (0.11, 1.08), (-0.11, 1.08), (-0.24, 0.93), (-0.12, 0.8), (-0.23, 0.66), (-0.25, 0.36)]
    if variant == 0:
        return [(-0.26, 0.0), (0.26, 0.0), (0.14, 0.5), (0.16, 0.74), (0.31, 1.0), (0.13, 0.9), (0.1, 0.97),
                (-0.1, 0.97), (-0.13, 0.9), (-0.31, 1.0), (-0.16, 0.74), (-0.14, 0.5)]
    return [(-0.13, 0.0), (0.13, 0.0), (0.15, 0.42), (0.18, 0.76), (0.31, 1.0), (0.2, 0.92), (0.09, 1.02),
            (-0.09, 1.02), (-0.2, 0.92), (-0.31, 1.0), (-0.18, 0.76), (-0.15, 0.42)]


def _draw_person(canvas: np.ndarray, fx: float, fy: float, H: float, bandit: bool, variant: int,
                 dx: int = 0, dy: int = 0, lit: bool = True) -> None:
    """A figure standing with his feet at (fx, fy), H tall, shifted by (dx, dy).

    The sun stands high on the left, so every figure has a warm-lit left side, a
    cool right side, and a brim of shadow across the eyes."""
    x, y0 = fx + dx, fy + dy

    def p(ox, oy):
        return (int(x + ox * H), int(y0 - oy * H))

    def px(ox, oy):
        return (x + ox * H, y0 - oy * H)

    def lit_half(pts, color, split=0.0):
        # The sunward part of a polygon: everything left of ``split``.
        clipped = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            ina, inb = a[0] <= split, b[0] <= split
            if ina:
                clipped.append(a)
            if ina != inb:
                t = (split - a[0]) / (b[0] - a[0])
                clipped.append((split, a[1] + (b[1] - a[1]) * t))
        if len(clipped) >= 3:
            _poly(canvas, [p(*q) for q in clipped], color)

    head_y = 0.84
    r = max(2, int(0.085 * H))
    line = max(1, int(0.012 * H))
    if bandit:
        coat = BANDIT_COAT
        coat_lit = _warm(coat, 0.28)
        coat_dark = _cool(coat, 0.45)
        rim = SUN_RIM if not lit else _mix(SUN_RIM, RIM, 0.5)
        rim_w = max(1, int(0.02 * H))
        # Legs and boots: trousers in shade under the poncho, boots with a lit welt.
        for side in (-1, 1):
            leg = [(-0.16, 0.4), (-0.05, 0.4), (-0.04, 0.0), (-0.17, 0.0)] if side < 0 else \
                  [(0.05, 0.4), (0.16, 0.4), (0.17, 0.0), (0.04, 0.0)]
            _poly(canvas, [p(*q) for q in leg], TROUSERS_DARK)
            lit_half(leg, _warm(TROUSERS_DARK, 0.22), leg[0][0] + 0.05)
            boot = [(leg[3][0] - 0.02, 0.07), (leg[2][0] + 0.01, 0.07), (leg[2][0] + 0.02, 0.0), (leg[3][0] - 0.03, 0.0)]
            _poly(canvas, [p(*q) for q in boot], BANDIT_HAT)
            cv2.line(canvas, p(boot[0][0], 0.07), p(boot[1][0], 0.07), _shade(coat_lit, -0.2), 1, cv2.LINE_AA)
        # The poncho: shoulders flaring to the hips, with a point hanging low. Base
        # cloth, a warm-lit left half, a cool deep right edge and the woven stripe.
        poncho = [(-0.13, 0.78), (0.13, 0.78), (0.23, 0.66), (0.25, 0.36), (0.08, 0.3),
                  (0.0, 0.24), (-0.08, 0.3), (-0.25, 0.36), (-0.23, 0.66)]
        _poly(canvas, [p(*q) for q in poncho], coat)
        lit_half(poncho, coat_lit, -0.03)
        _poly(canvas, [p(0.13, 0.78), p(0.23, 0.66), p(0.25, 0.36), p(0.17, 0.33), p(0.15, 0.7)], coat_dark)
        # Folds: a few dark creases falling from the shoulders.
        for ox in (-0.14, -0.05, 0.06):
            cv2.line(canvas, p(ox, 0.72), p(ox * 1.5, 0.36), _shade(coat, -0.35), 1, cv2.LINE_AA)
        cv2.line(canvas, p(-0.24, 0.5), p(0.24, 0.5), STRIPE, max(1, int(0.03 * H)))
        cv2.line(canvas, p(-0.245, 0.42), p(0.245, 0.42), _shade(STRIPE, -0.3), 1)
        cv2.line(canvas, p(-0.245, 0.5), p(-0.05, 0.5), _warm(STRIPE, 0.3), max(1, int(0.03 * H)))
        # Rim light down the sunward edge of the poncho.
        cv2.polylines(canvas, [np.array([p(-0.13, 0.78), p(-0.23, 0.66), p(-0.25, 0.36)], np.int32)], False,
                      rim, rim_w, cv2.LINE_AA)
        # The face: skin with the hat's brim throwing a hard shadow across the
        # eyes, two glints in it, and a bandana up over the nose.
        cv2.circle(canvas, p(0, head_y), r, SKIN, -1, cv2.LINE_AA)
        cv2.circle(canvas, p(0.03, head_y), r, _cool(SKIN, 0.3), -1, cv2.LINE_AA)
        cv2.circle(canvas, p(-0.02, head_y + 0.01), int(r * 0.85), SKIN, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.9), (r + 1, max(1, int(r * 0.5))), 0, 180, 360, BRIM_SHADE, -1, cv2.LINE_AA)
        cv2.rectangle(canvas, p(-0.1, 0.935), p(0.1, 0.9), BRIM_SHADE, -1)
        for ex in (-0.035, 0.035):
            cv2.ellipse(canvas, p(ex, 0.885), (max(1, int(0.02 * H)), max(1, int(0.011 * H))), 0, 0, 360,
                        (200, 236, 255), -1, cv2.LINE_AA)
            cv2.circle(canvas, p(ex + 0.005, 0.885), max(1, int(0.008 * H)), (10, 10, 14), -1, cv2.LINE_AA)
        _poly(canvas, [p(-0.105, 0.875), p(0.105, 0.875), p(0.11, 0.84), p(0.0, 0.72), p(-0.11, 0.84)], BANDANA)
        _poly(canvas, [p(0.0, 0.875), p(0.105, 0.875), p(0.11, 0.84), p(0.0, 0.72)], _cool(BANDANA, 0.35))
        cv2.line(canvas, p(-0.09, 0.86), p(-0.02, 0.77), _warm(BANDANA, 0.3), 1, cv2.LINE_AA)
        for i in range(3):
            cv2.circle(canvas, p(-0.06 + i * 0.05, 0.8 - i * 0.02), max(1, int(0.008 * H)), (236, 236, 240), -1)
        # The hat: a tall crown with a lit left face, a pinched dent, a band,
        # and a wide brim with the sun on its upper-left edge.
        half, top = HAT_CROWN
        _poly(canvas, [p(-half, 0.95), p(half, 0.95), p(half - 0.01, top), p(0.04, top - 0.02),
                       p(-0.04, top - 0.02), p(-half + 0.01, top)], BANDIT_HAT)
        _poly(canvas, [p(-half, 0.95), p(-0.01, 0.95), p(-0.01, top - 0.02), p(-0.04, top - 0.02),
                       p(-half + 0.01, top)], _warm(BANDIT_HAT, 0.3))
        cv2.line(canvas, p(-0.12, 0.975), p(0.12, 0.975), HAT_BAND, max(1, int(0.02 * H)))
        brim = (int(0.2 * H), max(1, int(0.035 * H)))
        cv2.ellipse(canvas, p(0, 0.95), brim, 0, 0, 360, BANDIT_HAT, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.95), brim, 0, 180, 300, _warm(BANDIT_HAT, 0.55), rim_w, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.95), brim, 0, 0, 180, _shade(BANDIT_HAT, -0.3), 1, cv2.LINE_AA)
        # The gun arm comes out from under the poncho and brings the revolver
        # up across his chest, where it reads in profile against the cloth: a
        # long barrel with a lit top edge, a fat cylinder, the hammer back and
        # a wooden grip in his fist.
        side = -1 if variant % 2 else 1
        fist = p(side * 0.19, 0.58)
        cv2.line(canvas, p(side * 0.2, 0.7), fist, coat_lit if side < 0 else coat_dark,
                 max(2, int(0.075 * H)), cv2.LINE_AA)
        ux, uy = -side * math.cos(math.radians(28)), -math.sin(math.radians(28))   # along the barrel, up and across
        base = (fist[0] + int(ux * 0.03 * H), fist[1] + int(uy * 0.03 * H))
        bar_len = 0.27 * H
        bar_w = max(2, int(0.042 * H))
        tip = (int(base[0] + ux * bar_len), int(base[1] + uy * bar_len))
        cv2.line(canvas, base, tip, GUN, bar_w, cv2.LINE_AA)
        off = max(1, int(bar_w * 0.32))
        cv2.line(canvas, (base[0], base[1] - off), (tip[0], tip[1] - off), GUN_LIT, 1, cv2.LINE_AA)
        cv2.line(canvas, (base[0], base[1] + off), (tip[0], tip[1] + off), _shade(GUN, -0.5), 1, cv2.LINE_AA)
        cyl = (int(base[0] + ux * 0.07 * H), int(base[1] + uy * 0.07 * H))
        cr = max(2, int(0.042 * H))
        cv2.circle(canvas, cyl, cr, GUN, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, cyl, (cr, cr), 0, 190, 300, GUN_LIT, 1, cv2.LINE_AA)
        cv2.circle(canvas, cyl, max(1, int(0.012 * H)), _shade(GUN, -0.6), -1, cv2.LINE_AA)
        hammer = (base[0] - int(ux * 0.035 * H), base[1] - int(0.04 * H))
        cv2.line(canvas, base, hammer, GUN, max(1, int(0.02 * H)), cv2.LINE_AA)
        grip = [base, (base[0] - int(ux * 0.045 * H), base[1] + int(0.01 * H)),
                (base[0] - int(ux * 0.07 * H), base[1] + int(0.085 * H)),
                (base[0] - int(ux * 0.025 * H), base[1] + int(0.09 * H))]
        _poly(canvas, grip, GRIP)
        cv2.line(canvas, grip[0], grip[1], _warm(GRIP, 0.35), 1, cv2.LINE_AA)
        cv2.ellipse(canvas, (fist[0], fist[1] + int(0.015 * H)), (max(2, int(0.045 * H)), max(2, int(0.035 * H))), 0, 0, 360, SKIN, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (fist[0] + 1, fist[1] + int(0.015 * H)), (max(2, int(0.045 * H)), max(2, int(0.035 * H))), 0, 0, 360, _cool(SKIN, 0.3), 1, cv2.LINE_AA)
        cv2.circle(canvas, tip, max(1, int(0.014 * H)), GLINT, -1, cv2.LINE_AA)
        return

    # Townsfolk: hands up, unarmed, and dressed like the afternoon.
    if variant == 0:
        # A woman in a blue dress with a white apron and a bonnet: the dress
        # falls in folds, lit on the left and cool on the right.
        skirt = [(-0.14, 0.5), (0.14, 0.5), (0.26, 0.0), (-0.26, 0.0)]
        _poly(canvas, [p(*q) for q in skirt], DRESS)
        lit_half(skirt, _warm(DRESS, 0.2), -0.04)
        _poly(canvas, [p(0.14, 0.5), p(0.26, 0.0), p(0.16, 0.0), p(0.09, 0.5)], _cool(DRESS, 0.4))
        for ox in (-0.2, -0.1, 0.02, 0.12):
            cv2.line(canvas, p(ox * 0.55, 0.48), p(ox, 0.01), _shade(DRESS, -0.3), 1, cv2.LINE_AA)
        apron = [(-0.08, 0.48), (0.08, 0.48), (0.16, 0.02), (-0.16, 0.02)]
        _poly(canvas, [p(*q) for q in apron], APRON)
        _poly(canvas, [p(0.04, 0.48), p(0.08, 0.48), p(0.16, 0.02), p(0.08, 0.02)], _cool(APRON, 0.22))
        cv2.line(canvas, p(-0.15, 0.03), p(0.15, 0.03), _cool(APRON, 0.3), 1, cv2.LINE_AA)
        bodice = [(-0.17, 0.76), (0.17, 0.76), (0.14, 0.48), (-0.14, 0.48)]
        _poly(canvas, [p(*q) for q in bodice], DRESS)
        lit_half(bodice, _warm(DRESS, 0.2), -0.03)
        _poly(canvas, [p(0.09, 0.76), p(0.17, 0.76), p(0.14, 0.48), p(0.08, 0.48)], _cool(DRESS, 0.4))
        cv2.line(canvas, p(-0.13, 0.5), p(0.13, 0.5), _cool(DRESS, 0.5), max(1, int(0.02 * H)))
        cv2.circle(canvas, p(0, head_y), r, SKIN, -1, cv2.LINE_AA)
        cv2.circle(canvas, p(0.03, head_y), r, _cool(SKIN, 0.3), -1, cv2.LINE_AA)
        cv2.circle(canvas, p(-0.02, head_y + 0.01), int(r * 0.85), SKIN, -1, cv2.LINE_AA)
        # The bonnet: a deep hood with a cool inside and a lit crown.
        cv2.ellipse(canvas, p(0, 0.86), (int(0.14 * H), int(0.13 * H)), 0, 180, 360, _cool(APRON, 0.35), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.87), (int(0.13 * H), int(0.1 * H)), 0, 195, 345, APRON, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(-0.03, 0.88), (int(0.08 * H), int(0.06 * H)), 0, 200, 330, _warm(APRON, 0.4), -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.9), (r, max(1, int(r * 0.5))), 0, 0, 180, BRIM_SHADE, -1, cv2.LINE_AA)
        cv2.line(canvas, p(-0.09, 0.78), p(0.02, 0.72), _cool(APRON, 0.25), 1, cv2.LINE_AA)
        arm_color = DRESS
        sleeve = True
    else:
        # A man in shirtsleeves with a straw hat and braces, the shirt rounded.
        for side in (-1, 1):
            leg = [(-0.13, 0.45), (-0.02, 0.45), (-0.02, 0.0), (-0.13, 0.0)] if side < 0 else \
                  [(0.02, 0.45), (0.13, 0.45), (0.13, 0.0), (0.02, 0.0)]
            _poly(canvas, [p(*q) for q in leg], TROUSERS)
            lit_half(leg, _warm(TROUSERS, 0.2), leg[0][0] + 0.04)
            cv2.rectangle(canvas, p(leg[3][0] - 0.02, 0.05), p(leg[2][0] + 0.01, 0.0), BANDIT_HAT, -1)
        shirt = [(-0.18, 0.76), (0.18, 0.76), (0.15, 0.42), (-0.15, 0.42)]
        _poly(canvas, [p(*q) for q in shirt], SHIRT)
        lit_half(shirt, _warm(SHIRT, 0.5), -0.05)
        _poly(canvas, [p(0.1, 0.76), p(0.18, 0.76), p(0.15, 0.42), p(0.09, 0.42)], _cool(SHIRT, 0.3))
        cv2.line(canvas, p(0.0, 0.74), p(0.0, 0.44), _cool(SHIRT, 0.2), 1, cv2.LINE_AA)
        for bx in (-0.07, 0.07):
            cv2.line(canvas, p(bx, 0.75), p(bx, 0.44), TROUSERS, max(1, int(0.025 * H)), cv2.LINE_AA)
        cv2.rectangle(canvas, p(-0.15, 0.46), p(0.15, 0.42), _shade(TROUSERS, -0.4), -1)
        cv2.circle(canvas, p(0, head_y), r, SKIN, -1, cv2.LINE_AA)
        cv2.circle(canvas, p(0.03, head_y), r, _cool(SKIN, 0.3), -1, cv2.LINE_AA)
        cv2.circle(canvas, p(-0.02, head_y + 0.01), int(r * 0.85), SKIN, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.895), (r + 1, max(1, int(r * 0.55))), 0, 180, 360, BRIM_SHADE, -1, cv2.LINE_AA)
        # The straw hat: a rounded crown with a band and a lit left side.
        cv2.ellipse(canvas, p(0, 0.92), (int(0.21 * H), max(1, int(0.035 * H))), 0, 0, 360, STRAW, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, p(0, 0.92), (int(0.21 * H), max(1, int(0.035 * H))), 0, 0, 180, _cool(STRAW, 0.3), 1, cv2.LINE_AA)
        _poly(canvas, [p(-0.1, 0.92), p(0.1, 0.92), p(0.09, 1.02), p(-0.09, 1.02)], STRAW)
        _poly(canvas, [p(-0.1, 0.92), p(-0.01, 0.92), p(-0.01, 1.02), p(-0.09, 1.02)], _warm(STRAW, 0.35))
        _poly(canvas, [p(0.04, 0.92), p(0.1, 0.92), p(0.09, 1.02), p(0.04, 1.02)], _cool(STRAW, 0.3))
        cv2.line(canvas, p(-0.1, 0.945), p(0.1, 0.945), HAT_BAND, max(1, int(0.02 * H)))
        arm_color = SHIRT
        sleeve = False
    # A face: eyes under the brim, a mouth, a nose line.
    for ex in (-0.03, 0.03):
        cv2.circle(canvas, p(ex, 0.86), max(1, int(0.012 * H)), TRIM_DARK, -1, cv2.LINE_AA)
    cv2.line(canvas, p(-0.02, 0.81), p(0.02, 0.81), _cool(SKIN, 0.4), 1, cv2.LINE_AA)
    cv2.line(canvas, p(0.0, 0.85), p(0.012, 0.825), _cool(SKIN, 0.35), 1, cv2.LINE_AA)
    # Arms up, in sleeves, with the sunward one lit and a shadow under each hand.
    (shoulder_x, shoulder_y), (wrist_x, wrist_y), arm = RAISED_ARM
    (hand_x, hand_y), hand = RAISED_HAND
    for side in (-1, 1):
        color = _warm(arm_color, 0.3) if side < 0 else _cool(arm_color, 0.25)
        cv2.line(canvas, p(side * shoulder_x, shoulder_y), p(side * wrist_x, wrist_y), color,
                 max(2, int(2 * arm * H)), cv2.LINE_AA)
        if sleeve:
            cv2.line(canvas, p(side * 0.27, 0.92), p(side * wrist_x, wrist_y), APRON,
                     max(2, int(0.055 * H)), cv2.LINE_AA)
        cv2.circle(canvas, p(side * hand_x, hand_y), max(2, int(hand * H)), SKIN, -1, cv2.LINE_AA)
        cv2.circle(canvas, p(side * (hand_x + 0.01), hand_y - 0.01), max(2, int(hand * H)),
                   _cool(SKIN, 0.25), 1, cv2.LINE_AA)
    cv2.line(canvas, p(-0.06, 0.0), p(0.06, 0.0), BRIM_SHADE, line)


def draw_figure(canvas: np.ndarray, figure: Figure, now: float, lean: float = LEAN_NOON) -> None:
    rise = figure.rise(now)
    if rise <= 0:
        return
    clip = figure.spot.clip
    h, w = canvas.shape[:2]
    x0, y0 = max(0, clip.x), max(0, clip.y)
    x1, y1 = min(w, clip.right), min(h, clip.bottom)
    if x1 <= x0 or y1 <= y0:
        return
    fx, fy = figure.feet(now)
    H = figure.spot.height
    if figure.spot.kind == "door":
        # A hard shadow across the boards in front of the door, from the sun on
        # the left: the whole man, sheared flat, growing as he steps out.
        shape = [(fx + ox * H, fy - oy * H) for ox, oy in _figure_silhouette(H, figure.bandit, figure.variant)]
        _cast_shadow(canvas, shape, fy, lean * 0.9, 0.5 * rise, SQUASH)
    roi = canvas[y0:y1, x0:x1]
    if figure.spot.kind == "window":
        # A lamp comes up in the room behind him, so he reads against the glass.
        glow = roi.copy()
        _vertical_fill(glow, 0, 0, glow.shape[1], glow.shape[0], LAMP, _shade(LAMP, -0.55))
        cv2.addWeighted(glow, 0.85 * rise, roi, 1.0 - 0.85 * rise, 0.0, dst=roi)
    elif figure.spot.kind == "barrel":
        # His shadow falls across the sand beside the barrel.
        shape = [(fx + ox * H, fy - oy * H) for ox, oy in _figure_silhouette(H, figure.bandit, figure.variant)]
        _cast_shadow(canvas, shape, fy + H * 0.35, lean * 0.8, 0.45 * rise, SQUASH * 0.6)
    _draw_person(roi, fx, fy, H, figure.bandit, figure.variant, -x0, -y0,
                 figure.spot.lit or figure.spot.kind == "window")
    if figure.spot.kind == "window":
        # The sash bars sit in front of whoever is at the window.
        cv2.line(canvas, (clip.centre_x, clip.y), (clip.centre_x, clip.bottom), TRIM, 1)
        cv2.line(canvas, (clip.x, clip.y + clip.height // 2), (clip.right, clip.y + clip.height // 2), TRIM, 1)


def draw_shards(canvas: np.ndarray, shards: list[Shard], now: float) -> None:
    """Glass in the air: each shard a spinning sliver with one edge catching
    the sun, fading to its resting tint as it settles."""
    for shard in shards:
        life = shard.life(now)
        if life <= 0:
            continue
        size = max(1.5, shard.size * (0.6 + 0.4 * life))
        c, s = math.cos(shard.spin), math.sin(shard.spin)
        pts = np.array([(shard.x + c * size, shard.y + s * size),
                        (shard.x - s * size * 0.55, shard.y + c * size * 0.55),
                        (shard.x - c * size * 0.9, shard.y - s * size * 0.9)], np.int32)
        color = _shade(shard.color, 0.35 * (1 - life) + 0.1)
        cv2.fillPoly(canvas, [pts], color, cv2.LINE_AA)
        # The edge toward the sun is a bright line; the other falls dark.
        cv2.line(canvas, tuple(pts[0]), tuple(pts[1]), _shade(shard.color, 0.85), 1, cv2.LINE_AA)
        cv2.line(canvas, tuple(pts[1]), tuple(pts[2]), _shade(shard.color, -0.4), 1, cv2.LINE_AA)
        if (int(shard.spin * 2.5) + int(shard.x)) % 3 == 0:
            cv2.circle(canvas, (int(shard.x - s * size * 0.3), int(shard.y)), 1, GLINT, -1)


def draw_litter(canvas: np.ndarray, litter: list, now: float) -> None:
    """Broken glass lying where it fell: small slivers on the plank and the
    sand, each with a bright edge, and one or two flashing as the sun finds them."""
    if not litter:
        return
    h, w = canvas.shape[:2]
    for i, (x, y, color) in enumerate(litter):
        if not (2 <= x < w - 5 and 2 <= y < h - 3):
            continue
        k = (x * 7 + y * 13) % 4
        pts = np.array([(x - 2, y + 1), (x + 2 + k, y + 1), (x + k - 1, y - 1 - (k % 2))], np.int32)
        cv2.fillPoly(canvas, [pts], _shade(color, 0.08))
        canvas[y - 1 - (k % 2), x + max(0, k - 1)] = _shade(color, 0.8)
        canvas[y + 1, x - 1:x + 2 + k] = _shade(color, -0.25)
        if (i + int(now * 3)) % 5 == 0:
            canvas[y, x + 1] = GLINT
            canvas[y - 1, x + 1] = GLINT


def draw_holes(canvas: np.ndarray, holes: list[Hole]) -> None:
    """Bullet holes: splintered wood on the fronts, little craters in the dirt."""
    for hole in holes:
        c = (hole.x, hole.y)
        if hole.wood:
            cv2.circle(canvas, c, hole.size + 1, SPLINTER, -1, cv2.LINE_AA)
            cv2.circle(canvas, c, hole.size, HOLE, -1, cv2.LINE_AA)
            cv2.line(canvas, (hole.x - hole.size * 2, hole.y + 1), (hole.x - hole.size, hole.y), SPLINTER, 1, cv2.LINE_AA)
        else:
            cv2.ellipse(canvas, c, (hole.size + 1, max(1, hole.size // 2)), 0, 0, 360, _shade(DUST_NEAR, -0.3), -1, cv2.LINE_AA)
            cv2.ellipse(canvas, (hole.x, hole.y - 1), (hole.size + 1, max(1, hole.size // 2)), 0, 180, 360,
                        _shade(DUST, 0.2), 1, cv2.LINE_AA)


def draw_dust_devil(canvas: np.ndarray, devil: DustDevil, now: float) -> None:
    life = devil.life(now)
    if life <= 0:
        return
    t = now - devil.born
    x, y = int(devil.x), int(devil.y)
    H = devil.height
    box = (x - int(H * 0.5), int(y - H), x + int(H * 0.5), y + int(H * 0.05))

    def paint(over, dx, dy):
        # A twisting column: a thin stack of rings, lighter and wider at the top,
        # with streaks of lifted dust spun off it.
        for i in range(10):
            frac = i / 9
            wobble = math.sin(t * 6 + i * 0.9) * H * 0.06 * frac
            cy = int(y - H * frac + dy)
            rx = max(1, int(H * (0.03 + 0.13 * frac) * (0.85 + 0.15 * math.sin(t * 9 + i))))
            ry = max(1, int(H * 0.018 * (0.5 + frac)))
            cv2.ellipse(over, (x + int(wobble) + dx, cy), (rx, ry), 0, 0, 360,
                        _shade((160, 190, 214), 0.25 * frac), -1, cv2.LINE_AA)
            cv2.ellipse(over, (x + int(wobble) + dx, cy), (rx, ry), 0, int(t * 400 + i * 40) % 360,
                        int(t * 400 + i * 40) % 360 + 120, _shade((160, 190, 214), -0.25), 1, cv2.LINE_AA)
    _roi_blend(canvas, box, 0.3 * life, paint)


def draw_tumbleweed(canvas: np.ndarray, weed: Tumbleweed, now: float) -> None:
    r = int(weed.radius)
    if r < 2:
        return
    hop = weed.hop(now)
    cx, cy = int(weed.x), int(weed.y - r - hop)
    # Its shadow stays on the ground and shrinks as it hops.
    sr = max(2, int(r * (1.0 - 0.4 * hop / max(weed.radius, 1))))
    _ground_shadow(canvas, cx + int(r * 0.6), int(weed.y), sr, max(1, sr // 4))
    # A tangle: a ring of thin ellipses at different tilts, turning with the roll.
    deg = math.degrees(weed.spin)
    for i in range(5):
        tilt = deg + i * 36
        cv2.ellipse(canvas, (cx, cy), (r, max(1, int(r * (0.25 + 0.12 * i)))), tilt, 0, 360, WEED, 1, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), r, _shade(WEED, 0.2), 1, cv2.LINE_AA)
    cv2.ellipse(canvas, (cx, cy), (int(r * 0.6), int(r * 0.6)), deg * 0.5, 0, 360, _shade(WEED, -0.3), 1, cv2.LINE_AA)


def draw_motes(canvas: np.ndarray, motes: np.ndarray, area: Rect, now: float) -> None:
    """Dust in the air, drifting right on the breeze and bobbing as it goes."""
    if motes is None or len(motes) == 0:
        return
    u, v, phase, speed = motes.T
    xs = area.x + ((u + now * speed) % 1.0) * area.width
    ys = area.y + (v + 0.012 * np.sin(now * 0.9 + phase)) * area.height
    h, w = canvas.shape[:2]
    xs = np.clip(xs.astype(np.int32), 0, w - 2)
    ys = np.clip(ys.astype(np.int32), 0, h - 2)
    bright = (0.5 + 0.5 * np.sin(now * 2.1 + phase * 3)) > 0.35
    xs, ys = xs[bright], ys[bright]
    canvas[ys, xs] = (236, 240, 244)
    canvas[ys, xs + 1] = (220, 226, 232)


def _floater(canvas: np.ndarray, text: str, centre: tuple[int, int], color, scale: float, alpha: float,
             thickness: int = 2) -> None:
    """A pop-up: one bold line of outlined lettering with nothing behind it."""
    (tw, th), _ = cv2.getTextSize(text, FONT, scale, thickness)
    origin = (centre[0] - tw // 2, centre[1] + th // 2)
    pad = thickness + 6

    def paint(over, dx, dy):
        o = (origin[0] + dx, origin[1] + dy)
        cv2.putText(over, text, (o[0] + 2, o[1] + 2), FONT, scale, SCORE_EDGE, thickness + 5, cv2.LINE_AA)
        cv2.putText(over, text, o, FONT, scale, SCORE_EDGE, thickness + 4, cv2.LINE_AA)
        cv2.putText(over, text, o, FONT, scale, color, thickness, cv2.LINE_AA)
        cv2.putText(over, text, (o[0], o[1] - 1), FONT, scale, _shade(color, 0.35), max(1, thickness // 2), cv2.LINE_AA)
    _roi_blend(canvas, (origin[0] - pad, origin[1] - th - pad, origin[0] + tw + pad + 2, origin[1] + pad + 2),
               alpha, paint)


def draw_impact(canvas: np.ndarray, impact: Impact, now: float, ttl: float,
                avoid: tuple[int, int] | None = None) -> None:
    """The shot's mark and its pop-up: one bold line that lands big, settles,
    and fades as it drifts up. ``avoid`` is a band of rows (the name boards
    across the fronts) the pop-up is kept out of."""
    age = now - impact.at
    life = max(0.0, 1.0 - age / ttl)
    if life <= 0:
        return
    centre = (int(impact.x), int(impact.y))
    unit = canvas.shape[0] / 945.0
    pop = 1.0 + 0.6 * max(0.0, 1.0 - age / 0.18) ** 2     # lands big, settles fast
    fade = min(1.0, life / 0.45)                            # holds, then fades out
    lift = int((16 + 40 * (1 - life)) * unit)               # and drifts upwards
    if not impact.is_hit:
        # A puff of dust or a splinter of wood, either way a puff.
        radius = int((6 + 22 * (1 - life)) * unit)
        _roi_blend(canvas, (centre[0] - radius - 2, centre[1] - radius - 2, centre[0] + radius + 2, centre[1] + radius + 2),
                   0.5 * life, lambda over, dx, dy: cv2.circle(over, (centre[0] + dx, centre[1] + dy), radius,
                                                              (180, 200, 220), -1, cv2.LINE_AA))
        if impact.label:
            _floater(canvas, impact.label.replace("  ", " "), (centre[0], _clear_of(centre[1] - int(24 * unit) - lift, avoid)),
                     PENALTY_INK, 0.72 * pop * unit, fade, 2)
        return
    if age < 0.25:
        cv2.circle(canvas, centre, int((4 + 14 * age / 0.25) * unit), (255, 255, 255), 2, cv2.LINE_AA)
    if not impact.score:
        return
    y = _clear_of(centre[1] - int(22 * unit) - lift, avoid)
    text = f"+{impact.score}"
    if impact.label and impact.label.upper().startswith("QUICK"):
        text = f"QUICK DRAW  +{impact.score}"
    _floater(canvas, text, (centre[0], y), SCORE_INK, 0.82 * pop * unit, fade, 2)


def _clear_of(y: int, band: tuple[int, int] | None) -> int:
    """Keep a pop-up's row out of the band where the name boards are: it is
    dropped beneath the awnings, never lifted out of the play area."""
    if band is None:
        return y
    top, bottom = band
    return bottom + 14 if top <= y <= bottom else y


def _shimmer(canvas: np.ndarray, backdrop: np.ndarray, street: Street, now: float) -> None:
    """Heat off the street: the far ground wavers a pixel or two, in bands."""
    h = street.area.height
    top = street.walk_y + int(0.03 * h)
    bottom = street.walk_y + int(0.14 * h)
    band = 4
    for y in range(top, bottom, band):
        shift = int(round(2.2 * math.sin(now * 5.0 + y * 0.21)))
        if shift:
            canvas[y:y + band] = np.roll(backdrop[y:y + band], shift, axis=1)


def build_hours(round_: WesternRound, width: int, height: int) -> None:
    """Build the street at every hour this round will show, ahead of time.

    Each hour is a new picture - the sun lower, the shadows longer - and one
    takes the best part of a tenth of a second to build. Built as the hour
    turns, that is a stutter every ten seconds of a minute's round; built
    here, off the play thread, they are all waiting in the cache.
    """
    area = round_.area
    for hour in range(HOURS if round_.duration else 1):
        _backdrop((area.x, area.y, area.width, area.height), width, height,
                  round_.options.seed or 0, hour)


def draw_world(canvas: np.ndarray, round_: WesternRound, now: float) -> None:
    area = round_.area
    street = round_.street
    hour = round_.hour(now)
    lean = _lean_for(hour)
    backdrop = _backdrop((area.x, area.y, area.width, area.height), canvas.shape[1], canvas.shape[0],
                         round_.options.seed or 0, hour)
    canvas[:] = backdrop
    _shimmer(canvas, backdrop, street, now)
    draw_holes(canvas, round_.holes)

    # Far to near: the doors and windows, then the rail, then the barrels.
    for figure in round_.figures:
        if figure.spot.kind != "barrel":
            draw_figure(canvas, figure, now, lean)
    for sign in round_.signs:
        draw_sign(canvas, sign)
    for devil in round_.dust_devils:
        draw_dust_devil(canvas, devil, now)
    for weed in round_.tumbleweeds:
        if weed.y < street.rail_y:
            draw_tumbleweed(canvas, weed, now)
    draw_litter(canvas, round_.litter, now)
    for bottle in round_.bottles:
        draw_bottle(canvas, bottle, lean)
    stage = canvas[:area.bottom]      # a tumbling can never falls into the footer
    for can in round_.cans:
        draw_can(stage if can.hit_at is not None else canvas, can, now, lean)
    draw_shards(canvas, round_.shards, now)
    for weed in round_.tumbleweeds:
        if weed.y >= street.rail_y:
            draw_tumbleweed(canvas, weed, now)
    for figure in round_.figures:
        if figure.spot.kind == "barrel":
            draw_figure(canvas, figure, now, lean)
            bx, by, bw = next(b for b in street.barrels if b[0] == int(figure.spot.x))
            _draw_barrel(canvas, bx, by, bw)
    draw_motes(canvas, getattr(round_, "motes", None), area, now)
    boards = (street.skyline, street.awning_y + int(0.02 * area.height))
    for impact in round_.impacts:
        draw_impact(canvas, impact, now, round_.IMPACT_TTL, boards)


# --- the card -------------------------------------------------------------------------

@lru_cache(maxsize=2)
def _card_art(width: int, height: int) -> np.ndarray:
    """The chooser card: the real street at the real composition, titled."""
    # Render at the game's own proportions, then fit the play area to the card.
    full_w, full_h = 1512, 945
    area = Rect(31, 294, 1450, 578)
    seed = 11
    full = _backdrop((area.x, area.y, area.width, area.height), full_w, full_h, seed, HOURS - 1).copy()
    street = build_street(area, seed)
    h = area.height
    rng = np.random.default_rng(seed)
    for i in range(RAIL_SLOTS):
        x = street.slot_x(i)
        if i in (2, 5):
            draw_can(full, Can(slot=i, x=x, base_y=street.rail_y, height=0.085 * h, label=i % 3), 0.0, LEAN_LATE)
        elif i == 4:
            continue
        else:
            draw_bottle(full, Bottle(slot=i, x=x, base_y=street.rail_y, height=(0.12 + 0.01 * (i % 3)) * h,
                                     color=GLASS_COLORS[i % len(GLASS_COLORS)], neck=0.4), LEAN_LATE)
    # Glass in the air where the fourth bottle was.
    x4 = street.slot_x(4)
    shards = [Shard(x=x4 + rng.uniform(-30, 30), y=street.rail_y - rng.uniform(0, 90), vx=0, vy=0,
                    size=rng.uniform(3, 7), color=GLASS_COLORS[1], born=0.0, floor=area.bottom, spin=rng.uniform(0, 6))
              for _ in range(16)]
    draw_shards(full, shards, 0.4)
    doors = [s for s in street.spots if s.kind == "door"]
    doors.sort(key=lambda s: abs(s.x - area.centre_x))
    for index, spot in enumerate(doors[:3]):
        draw_figure(full, Figure(spot=spot, bandit=index != 1, variant=index, appeared_at=0.0, lifetime=9.0), 1.0, LEAN_LATE)
    windows = [s for s in street.spots if s.kind == "window"]
    if windows:
        draw_figure(full, Figure(spot=windows[0], bandit=True, variant=1, appeared_at=0.0, lifetime=9.0), 1.0)
    barrel = next(s for s in street.spots if s.kind == "barrel")
    draw_figure(full, Figure(spot=barrel, bandit=True, variant=0, appeared_at=0.0, lifetime=9.0), 1.0)
    bx, by, bw = street.barrels[0]
    _draw_barrel(full, bx, by, bw)
    draw_tumbleweed(full, Tumbleweed(x=area.x + area.width * 0.5, y=area.bottom - 0.06 * h, radius=0.045 * h,
                                     vx=100, born=0.0, spin=1.0), 0.3)

    # Crop in on the doors and the rail, and fit that to the card without distortion.
    crop_w = int(area.width / 1.2)
    crop_h = int(crop_w * height / width)
    cx0 = area.centre_x - crop_w // 2
    cy0 = int(street.ground_y - 0.58 * h)
    crop = full[cy0:cy0 + crop_h, cx0:cx0 + crop_w]
    art = np.ascontiguousarray(cv2.resize(crop, (width, height), interpolation=cv2.INTER_AREA))

    # A dusk vignette: the corners fall off warm, the middle keeps its light.
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    d = np.hypot((xs - width / 2) / (width / 2), (ys - height * 0.4) / (height / 2))
    vig = np.clip(1.0 - 0.6 * np.clip(d - 0.5, 0, 1.6) ** 1.4, 0.25, 1.0)[..., None]
    warm = np.array((0.8, 0.92, 1.0), np.float32)
    art = np.clip(art.astype(np.float32) * (vig * warm + (1 - vig) * 1.0) * (0.65 + 0.35 * vig), 0, 255).astype(np.uint8)

    # The title on a sign: a plank of weathered wood hung across the bottom on
    # two chains, bevelled, grained, the letters carved in and lit from the
    # upper left like everything else on the street, and shot through twice.
    title = "HIGH NOON"
    scale = height / 165.0
    thick = max(2, int(height / 70))
    (tw, th), _ = cv2.getTextSize(title, SLAB, scale, thick)
    pad_x, pad_y = int(height * 0.07), int(height * 0.06)
    bx0, bx1 = (width - tw) // 2 - pad_x, (width + tw) // 2 + pad_x
    by1 = height - int(height * 0.06)
    by0 = by1 - th - pad_y * 2
    bevel = max(2, int(height * 0.012))
    # Chains up to the top edge.
    for cx in (bx0 + pad_x, bx1 - pad_x):
        for ly in range(0, by0, max(3, bevel)):
            cv2.ellipse(art, (cx, ly + bevel // 2), (max(1, bevel // 3), max(2, bevel // 2)), 0, 0, 360, (70, 74, 82), 1, cv2.LINE_AA)
    # The plank's shadow on the scene, then the plank.
    shadow = np.zeros((height, width), np.uint8)
    cv2.rectangle(shadow, (bx0 + bevel * 2, by0 + bevel * 2), (bx1 + bevel * 2, by1 + bevel * 2), 255, -1)
    _cast_shadows(art, shadow, 0.7)
    wood = (78, 112, 150)
    cv2.rectangle(art, (bx0, by0), (bx1, by1), wood, -1)
    _grain(art, bx0, by0, bx1, by1, rng, 7.0, streaks=True)
    for gy in np.linspace(by0 + 4, by1 - 4, 7):
        cv2.line(art, (bx0, int(gy)), (bx1, int(gy + rng.uniform(-3, 3))), _shade(wood, -0.18), 1, cv2.LINE_AA)
    # Bevels: lit on top and left, dark below and right.
    _poly(art, [(bx0, by0), (bx1, by0), (bx1 - bevel, by0 + bevel), (bx0 + bevel, by0 + bevel)], _warm(wood, 0.35))
    _poly(art, [(bx0, by0), (bx0 + bevel, by0 + bevel), (bx0 + bevel, by1 - bevel), (bx0, by1)], _warm(wood, 0.2))
    _poly(art, [(bx0, by1), (bx0 + bevel, by1 - bevel), (bx1 - bevel, by1 - bevel), (bx1, by1)], _cool(wood, 0.5))
    _poly(art, [(bx1, by0), (bx1, by1), (bx1 - bevel, by1 - bevel), (bx1 - bevel, by0 + bevel)], _cool(wood, 0.4))
    cv2.rectangle(art, (bx0, by0), (bx1, by1), _shade(wood, -0.6), 1)
    # A crack across one end.
    cv2.line(art, (bx1 - pad_x // 2, by0 + bevel), (bx1 - pad_x // 3, by0 + (by1 - by0) // 2), _shade(wood, -0.55), 1, cv2.LINE_AA)
    # Carved letters: a dark groove, its lower-right lip catching the light.
    tx, ty = (width - tw) // 2, by1 - pad_y
    cv2.putText(art, title, (tx - 1, ty - 1), SLAB, scale, _shade(wood, -0.75), thick + 2, cv2.LINE_AA)
    cv2.putText(art, title, (tx + 1, ty + 1), SLAB, scale, _warm(wood, 0.45), thick + 1, cv2.LINE_AA)
    cv2.putText(art, title, (tx, ty), SLAB, scale, (24, 34, 52), thick, cv2.LINE_AA)
    cv2.putText(art, title, (tx, ty), SLAB, scale, (36, 48, 70), max(1, thick // 2), cv2.LINE_AA)
    # Two bullet holes through the plank, splintered around the edges.
    for hx, hy in ((bx0 + pad_x + int(tw * 0.12), by0 + pad_y // 2 + 2), (bx1 - pad_x - int(tw * 0.06), by1 - pad_y // 2 - 2)):
        r = max(2, int(height * 0.016))
        for _ in range(7):
            a = rng.uniform(0, math.tau)
            ln = r * rng.uniform(1.4, 2.4)
            cv2.line(art, (hx, hy), (int(hx + math.cos(a) * ln), int(hy + math.sin(a) * ln)), _warm(wood, 0.5), 1, cv2.LINE_AA)
        cv2.circle(art, (hx, hy), r + 1, _warm(wood, 0.6), -1, cv2.LINE_AA)
        cv2.circle(art, (hx, hy), r, (12, 14, 18), -1, cv2.LINE_AA)
        cv2.ellipse(art, (hx, hy), (r, r), 0, 200, 340, (70, 72, 80), 1, cv2.LINE_AA)
    # Nails in the corners.
    for nx, ny in ((bx0 + bevel * 2, by0 + bevel * 2), (bx1 - bevel * 2, by0 + bevel * 2),
                   (bx0 + bevel * 2, by1 - bevel * 2), (bx1 - bevel * 2, by1 - bevel * 2)):
        cv2.circle(art, (nx, ny), max(1, bevel // 2), (60, 64, 72), -1, cv2.LINE_AA)
        cv2.circle(art, (nx - 1, ny - 1), 1, (170, 176, 186), -1)
    sub = "bottles on the rail  .  bandits in the doors"
    s2 = scale * 0.3
    (sw, sh), _ = cv2.getTextSize(sub, FONT, s2, 1)
    sx, sy = (width - sw) // 2, by0 - int(height * 0.03)
    cv2.putText(art, sub, (sx + 1, sy + 1), FONT, s2, (10, 10, 12), 1, cv2.LINE_AA)
    cv2.putText(art, sub, (sx, sy), FONT, s2, (210, 232, 248), 1, cv2.LINE_AA)
    return art


def draw_emblem(panel: np.ndarray) -> None:
    """The card art: the street, a bandit in a doorway, bottles on the rail."""
    height, width = panel.shape[:2]
    panel[:] = _card_art(width, height)
