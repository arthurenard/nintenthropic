"""Orbital decay: debris tumbling past a station window, in silence.

You are looking out of a cupola pane at Earth's limb. Fragments of something
that broke up a few orbits ago come in on ballistic arcs; some of them are
going to miss the station and some of them are coming straight at the glass.
A shot on a big fragment does not make it disappear - it splits it, and the
pieces keep the momentum the parent had, so a careless shot turns one problem
into two. The pane keeps a ledger of every hit it takes. When it fails, the
round is over.

Everything out there is drawn from the same pinhole projection the shot is
tested against: a fragment's silhouette on screen is the polygon the hit test
uses, so what you see is exactly what you can hit.

A maintenance drone is working outside. It is not debris.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import cv2
import numpy as np

from ..game import MISS, Hit, Impact, Rect, Round
from ..scene import ACCENT, EDGE, draw_text, shade_panel

# --- the world --------------------------------------------------------------

#: Depth, in metres, at which a fragment reaches the glass.
Z_WINDOW = 0.6
SPAWN_DEPTH = (16.0, 27.0)
APPROACH_SPEED = (3.0, 6.5)
#: The residual pull towards Earth that bends every arc. Not real gravity;
#: orbital mechanics at this scale is a gentle curve, and that is all we need.
GRAVITY = 0.45
RADIUS_RANGE = (0.3, 1.3)
#: Three sizes of debris: shrapnel, chunks, and the big slabs. Metres.
SIZE_TIERS = ((0.3, 0.45), (0.55, 0.8), (0.95, 1.3))
TIER_WEIGHTS = (0.35, 0.4, 0.25)
#: Below this size a hit vaporises the piece instead of splitting it.
MIN_SPLIT_RADIUS = 0.55
MAX_FRAGMENTS = 14
#: How hard a round hits, as a momentum kick along the line of fire.
BULLET_IMPULSE = 0.12

FULL_INTEGRITY = 100
ALARM_INTEGRITY = 35
FRIENDLY_PENALTY = 150
DRONE_DEPTH = 7.0
DRONE_RADIUS = 0.55  # metres, body half width

# Scoring
CLEAR_POINTS = 80
SPLIT_POINTS = 40
FAR_BONUS = 1.0  # doubled at the spawn depth

IMPACT_FLASH = 0.3
#: Where the sun is, as a direction: up and to the right of the pane, and a
#: little towards you. Everything out there is lit from here: the planet's
#: terminator, the panel's glare, the lit face of every rock.
SUN_DIRECTION = (0.8, -0.15, 0.2)
#: How far the cloud deck slides under you, in pixels, as the station moves.
CLOUD_DRIFT = 26.0
STAGES = ("EARLY", "MID", "LATE")

# Palette, BGR. One light in the scene: a warm key from the sun, up and to
# the right, and a cool blue fill bouncing up off the planet underneath.
SPACE = (12, 8, 6)
OCEAN = (88, 42, 12)
OCEAN_SHALLOW = (160, 110, 36)
LAND = (58, 108, 92)
LAND_HIGH = (86, 140, 150)
LAND_ROCK = (54, 70, 86)
LAND_WET = (44, 112, 60)
CLOUD = (240, 236, 230)
NIGHT = (26, 14, 8)
TWILIGHT = (40, 90, 170)
CITY = (90, 170, 240)
ATMOSPHERE = (232, 176, 92)
LIMB = (255, 236, 200)
LIMB_BLUE = (255, 214, 150)    # the air seen sideways: bright sky blue
LIMB_ORANGE = (110, 190, 255)  # the air seen into the sun
SUN = (226, 244, 255)
SUN_WARM = (160, 214, 255)
KEY_LIGHT = (200, 226, 250)   # the warm rim every lit edge gets
FILL_LIGHT = (176, 128, 64)   # the cool bounce every underside gets
ROCK = (92, 96, 104)
ROCK_RIM = (228, 236, 244)
EARTHSHINE = (170, 120, 60)
#: What the debris is made of, as base tones: rock, bare alloy, and the
#: gold insulation foil everything up here is wrapped in.
MATERIALS = ((92, 96, 104), (150, 146, 140), (48, 128, 196))
STREAK = (54, 56, 62)
SPARK = (200, 225, 245)
EMBER = (90, 190, 255)
STRUT = (50, 52, 58)
STRUT_LIT = (112, 116, 124)
PANEL_BASE = (96, 64, 36)
PANEL_SPEC = (214, 200, 176)
PANEL_GRID = (44, 32, 20)
INTERIOR = (34, 33, 31)
INTERIOR_LIGHT = (74, 72, 68)
FRAME = (52, 50, 47)
FRAME_LIT = (112, 108, 102)
FRAME_DARK = (22, 21, 20)
CRACK = (246, 240, 232)
CRACK_SOFT = (160, 140, 118)
SUIT = (226, 224, 218)
SUIT_SHADE = (150, 146, 140)
SUIT_DARK = (72, 70, 66)
VISOR = (24, 40, 60)
VISOR_GOLD = (60, 150, 210)
NAV_GREEN = (90, 230, 110)
NAV_RED = (70, 70, 230)
SCORE_INK = (150, 230, 240)
RETICLE_GLOW = (110, 150, 175)   # a soft cream, additive
RETICLE_RING = (210, 228, 240)
WARN = (60, 70, 230)
TETHER = (120, 126, 134)


@dataclass(frozen=True)
class Projection:
    """Pinhole camera looking out through the pane: metres in, pixels out."""

    area: Rect
    focal: float

    @classmethod
    def for_area(cls, area: Rect) -> "Projection":
        return cls(area=area, focal=area.height * 0.9)

    @property
    def centre(self) -> tuple[float, float]:
        return (self.area.x + self.area.width / 2.0, self.area.y + self.area.height / 2.0)

    def screen(self, x: float, y: float, z: float) -> tuple[float, float]:
        cx, cy = self.centre
        z = max(z, 0.05)
        return (cx + x * self.focal / z, cy + y * self.focal / z)

    def size_px(self, metres: float, z: float) -> float:
        return metres * self.focal / max(z, 0.05)

    def pane_half_extent(self, z: float) -> tuple[float, float]:
        """Half the pane's width and height in metres, at depth ``z``."""
        return (self.area.width / 2.0 * z / self.focal,
                self.area.height / 2.0 * z / self.focal)


@dataclass
class Fragment:
    """A piece of something, coming your way or not.

    ``px, py, pz`` are metres from the centre of the pane, ``pz`` straight out;
    ``x, y`` are where that puts it on screen this frame.
    """

    view: Projection
    px: float
    py: float
    pz: float
    vx: float
    vy: float
    vz: float  # negative: closing on the window
    radius: float
    angle: float
    spin: float
    shape: tuple[float, ...]  # vertex radii, as fractions of ``radius``
    tumble: float = 0.0
    generation: int = 0
    material: int = 0
    #: Per-vertex angular jitter, so no two silhouettes share an outline.
    offsets: tuple[float, ...] = ()

    @property
    def mass(self) -> float:
        return self.radius ** 3

    @property
    def x(self) -> float:
        return self.view.screen(self.px, self.py, self.pz)[0]

    @property
    def y(self) -> float:
        return self.view.screen(self.px, self.py, self.pz)[1]

    @property
    def size(self) -> float:
        """Radius on screen, in pixels."""
        return self.view.size_px(self.radius, self.pz)

    def advance(self, dt: float) -> None:
        self.vy += GRAVITY * dt
        self.px += self.vx * dt
        self.py += self.vy * dt
        self.pz += self.vz * dt
        self.angle += self.spin * dt
        self.tumble += dt * abs(self.spin) * 0.6

    def time_to_window(self) -> float:
        if self.vz >= 0:
            return math.inf
        return max(0.0, (self.pz - Z_WINDOW) / -self.vz)

    def polygon(self) -> np.ndarray:
        """The silhouette on screen this frame, as float vertices."""
        cx, cy = self.view.screen(self.px, self.py, self.pz)
        scale = self.size
        count = len(self.shape)
        angles = self.angle + np.arange(count) * (math.tau / count)
        if len(self.offsets) == count:
            angles = angles + np.asarray(self.offsets)
        radii = np.asarray(self.shape) * scale
        squash = 0.72 + 0.28 * math.cos(self.tumble)
        xs = cx + np.cos(angles) * radii * squash
        ys = cy + np.sin(angles) * radii
        return np.stack([xs, ys], axis=1).astype(np.float32)

    def contains(self, x: float, y: float, slack: float = 3.0) -> bool:
        return cv2.pointPolygonTest(self.polygon(), (float(x), float(y)), True) >= -slack


@dataclass
class Drone:
    """The maintenance drone. Friendly. Do not."""

    x: float
    y: float
    z: float
    vx: float
    launched_at: float
    hit_at: float | None = None
    spin: float = 0.0

    def position(self, now: float) -> tuple[float, float, float]:
        t = now - self.launched_at
        x = self.x + self.vx * t
        y = self.y + 0.5 * math.sin(t * 0.6)
        if self.hit_at is not None:
            # Knocked off station: it tumbles away and drops.
            since = now - self.hit_at
            y += 0.8 * since + 0.4 * since * since
            x += self.vx * since * 1.5
        return x, y, self.z

    def radius_px(self, view: Projection) -> float:
        return view.size_px(DRONE_RADIUS, self.z)

    def contains(self, view: Projection, x: float, y: float, now: float) -> bool:
        px, py, pz = self.position(now)
        sx, sy = view.screen(px, py, pz)
        return math.hypot(x - sx, y - sy) <= self.radius_px(view) * 1.25


@dataclass(frozen=True)
class Crack:
    """A crack in the pane, fixed for the rest of the round."""

    x: int
    y: int
    branches: tuple[np.ndarray, ...]
    rings: tuple[int, ...]
    at: float


@dataclass
class OrbitRound(Round):
    """Keep the glass whole until the debris has passed."""

    targets: list[Fragment] = field(default_factory=list, init=False)
    drone: Drone | None = field(default=None, init=False)
    cracks: list[Crack] = field(default_factory=list, init=False)
    integrity: int = field(default=FULL_INTEGRITY, init=False)
    cleared: int = field(default=0, init=False)
    friendly_hits: int = field(default=0, init=False)
    struck_at: float | None = field(default=None, init=False)
    failed_at: float | None = field(default=None, init=False)
    _alarm_raised: bool = field(default=False, init=False, repr=False)
    _next_spawn: float = field(default=0.0, init=False, repr=False)
    _next_drone: float = field(default=6.0, init=False, repr=False)
    _last_tick: float | None = field(default=None, init=False, repr=False)
    #: The cracks, rendered once into an additive layer and re-laid each frame.
    _crack_layer: np.ndarray | None = field(default=None, init=False, repr=False)
    _crack_layer_count: int = field(default=-1, init=False, repr=False)
    #: The array's damage: scorched (row, col) cells, kinked rib indices, and
    #: the recent strikes on it as (x, y, when) for the sparks.
    dead_cells: list[tuple[int, int]] = field(default_factory=list, init=False)
    bent_ribs: list[int] = field(default_factory=list, init=False)
    array_strikes: list[tuple[int, int, float]] = field(default_factory=list, init=False)
    _next_pit: float = field(default=math.inf, init=False, repr=False)
    #: Where the player is aiming, 0..1 of the window, for the reticle's glow.
    aim: tuple[float, float] | None = field(default=None, init=False, repr=False)

    IMPACT_TTL = 1.1
    PERFECT_LABEL = "vaporised"

    def __post_init__(self) -> None:
        super().__post_init__()
        self.view = Projection.for_area(self.options.area)

    # --- rules -------------------------------------------------------------

    @property
    def is_lost(self) -> bool:
        return self.integrity <= 0

    def outcome(self) -> str:
        return "PANE FAILED" if self.is_lost else "PANE HELD"

    def won(self) -> bool:
        return not self.is_lost

    def stage(self, now: float) -> float:
        """0 at the start of the round, 1 at the end; endless rounds ramp over 90 s."""
        span = self.duration if self.duration else 90.0
        return min(self.elapsed(now) / span, 1.0)

    def look(self, position: tuple[float, float] | None, scoped: bool) -> None:
        self.aim = position

    def advance(self, now: float) -> None:
        dt = 0.0 if self._last_tick is None else min(now - self._last_tick, 0.25)
        self._last_tick = now
        stage = self.stage(now)

        tilt = array_angle(now)
        for fragment in list(self.targets):
            before = fragment.pz
            fragment.advance(dt)
            if before > PANEL_DEPTH >= fragment.pz:
                cell = array_cell(self.area, fragment.x, fragment.y, tilt)
                if cell is not None:
                    self.strike_array(fragment, cell, now)
        for fragment in list(self.targets):
            if fragment.pz <= Z_WINDOW:
                self._arrive(fragment, now)
            elif self._gone(fragment):
                self.targets.remove(fragment)

        self._tend_drone(now)
        # Micrometeoroids too small to see pit the array now and then once the
        # debris field has thickened: the slow wear the late round shows.
        if self._next_pit is math.inf and stage > 0.25:
            self._next_pit = now + self.rng.uniform(4.0, 9.0)
        if now >= self._next_pit:
            self._next_pit = now + self.rng.uniform(9.0, 15.0)
            self.pit_array((int(self.rng.randint(0, ARRAY_ROWS - 1)),
                            int(self.rng.randint(0, ARRAY_COLS - 1))), now)

        allowed = min(self.options.density + int(stage * 5), MAX_FRAGMENTS)
        gap = max(self.options.spawn_interval * (1.0 - 0.45 * stage), 0.5)
        if len(self.targets) < allowed and now >= self._next_spawn:
            self.targets.append(self.spawn(stage))
            self._next_spawn = now + gap

    def _gone(self, fragment: Fragment) -> bool:
        """Past the station and out of the picture, never to return."""
        sx, sy = fragment.x, fragment.y
        margin = fragment.size + 40
        area = self.area
        off_x = sx < area.x - margin or sx > area.right + margin
        off_y = sy < area.y - margin or sy > area.bottom + margin
        if not (off_x or off_y):
            return False
        # Still off to one side but drifting back in: keep it.
        dx, dy = sx - self.view.centre[0], sy - self.view.centre[1]
        return dx * fragment.vx + dy * fragment.vy >= 0 or fragment.vz >= 0

    def _arrive(self, fragment: Fragment, now: float) -> None:
        """A fragment reaches the depth of the glass."""
        self.targets.remove(fragment)
        half_w, half_h = self.view.pane_half_extent(Z_WINDOW)
        if abs(fragment.px) <= half_w + fragment.radius * 0.5 and \
                abs(fragment.py) <= half_h + fragment.radius * 0.5:
            self.damage(fragment, now)
        elif abs(fragment.px) <= half_w * 1.8 and abs(fragment.py) <= half_h * 1.8:
            self.cues.append("hull_thud")  # glanced off the frame around the pane

    def strike_array(self, fragment: Fragment, cell: tuple[int, int], now: float) -> None:
        """A piece of debris hits the solar array instead of the glass: the
        cell it struck is scorched dead, a rib may kink, and the piece is
        spent against the panel."""
        if fragment in self.targets:
            self.targets.remove(fragment)
        self.pit_array(cell, now)
        self.cues.append("hull_thud")
        if fragment.radius >= MIN_SPLIT_RADIUS and len(self.bent_ribs) < ARRAY_COLS - 1:
            rib = 1 + (cell[1] % (ARRAY_COLS - 1))
            if rib not in self.bent_ribs:
                self.bent_ribs.append(rib)

    def pit_array(self, cell: tuple[int, int], now: float) -> None:
        """Scorch one cell of the array and mark the strike for its sparks."""
        if cell not in self.dead_cells and len(self.dead_cells) < ARRAY_ROWS * ARRAY_COLS - 2:
            self.dead_cells.append(cell)
        corners = array_corners(self.area, array_angle(now)).astype(np.float32)
        a, b = (cell[1] + 0.5) / ARRAY_COLS, (cell[0] + 0.5) / ARRAY_ROWS
        near = corners[0] + (corners[3] - corners[0]) * b
        far = corners[1] + (corners[2] - corners[1]) * b
        point = near + (far - near) * a
        self.array_strikes.append((int(point[0]), int(point[1]), now))
        del self.array_strikes[:-6]

    def damage(self, fragment: Fragment, now: float) -> None:
        """A fragment hits the glass. Mass and speed decide what it costs."""
        mass_fraction = (fragment.radius / RADIUS_RANGE[1]) ** 3
        speed = min(-fragment.vz / APPROACH_SPEED[1], 1.5)
        cost = int(round(6 + 40 * mass_fraction * max(speed, 0.5)))
        self.integrity = max(0, self.integrity - cost)
        self.struck_at = now
        self.cues.append("glass_crack")
        if mass_fraction > 0.25:
            self.cues.append("hull_thud")

        sx, sy = self.view.screen(fragment.px, fragment.py, max(fragment.pz, Z_WINDOW))
        area = self.area
        sx = min(max(sx, area.x + 12), area.right - 12)
        sy = min(max(sy, area.y + 12), area.bottom - 12)
        self.cracks.append(make_crack(int(sx), int(sy), cost, self.rng, now,
                                      self.options.scale))
        del self.cracks[:-24]

        if self.integrity <= 0:
            self.failed_at = now
            self.cues.append("alarm")
        elif self.integrity <= ALARM_INTEGRITY and not self._alarm_raised:
            self._alarm_raised = True
            self.cues.append("alarm")

    def _tend_drone(self, now: float) -> None:
        if self.drone is not None:
            x, y, z = self.drone.position(now)
            half_w, half_h = self.view.pane_half_extent(z)
            if abs(x) > half_w * 1.4 or y > half_h * 1.6:
                self.drone = None
                self._next_drone = now + self.rng.uniform(5.0, 9.0)
            return
        if now >= self._next_drone:
            side = self.rng.choice((-1.0, 1.0))
            half_w, half_h = self.view.pane_half_extent(DRONE_DEPTH)
            self.drone = Drone(
                x=-side * half_w * 1.3,
                y=self.rng.uniform(-half_h * 0.7, half_h * 0.2),
                z=DRONE_DEPTH,
                vx=side * self.rng.uniform(0.45, 0.7),
                launched_at=now,
            )

    def spawn(self, stage: float) -> Fragment:
        """A fresh fragment at the far edge, aimed at the pane or past it."""
        rng = self.rng
        z = rng.uniform(*SPAWN_DEPTH)
        tier = rng.choices(SIZE_TIERS, weights=TIER_WEIGHTS)[0]
        radius = rng.uniform(*tier)
        vz = -rng.uniform(*APPROACH_SPEED) * (1.0 + 0.5 * stage)
        flight = (z - Z_WINDOW) / -vz

        # Where it arrives at the glass. Over the round, more of them are
        # coming straight at you.
        half_w, half_h = self.view.pane_half_extent(Z_WINDOW)
        if rng.random() < 0.3 + 0.3 * stage:
            tx = rng.uniform(-half_w * 0.8, half_w * 0.8)
            ty = rng.uniform(-half_h * 0.8, half_h * 0.8)
        else:
            tx = rng.choice((-1.0, 1.0)) * rng.uniform(half_w * 1.6, half_w * 4.0)
            ty = rng.uniform(-half_h * 2.0, half_h * 2.5)

        # Where it starts: somewhere in the wide field of view at that depth.
        far_w, far_h = self.view.pane_half_extent(z)
        x = rng.uniform(-far_w * 0.9, far_w * 0.9)
        y = rng.uniform(-far_h * 0.95, far_h * 0.4)
        # Lead the arc so it lands on target despite the pull downwards.
        vx = (tx - x) / flight
        vy = (ty - y) / flight - 0.5 * GRAVITY * flight

        count = int(rng.randint(6, 10))
        return Fragment(view=self.view, px=x, py=y, pz=z, vx=vx, vy=vy, vz=vz, radius=radius,
                        angle=rng.uniform(0.0, math.tau),
                        spin=rng.uniform(-2.4, 2.4),
                        shape=tuple(rng.uniform(0.5, 1.0) for _ in range(count)),
                        offsets=tuple(rng.uniform(-0.3, 0.3) for _ in range(count)),
                        material=rng.choices((0, 1, 2), weights=(0.5, 0.3, 0.2))[0])

    def resolve(self, x: float, y: float, now: float) -> Hit:
        """Nearest thing whose silhouette contains the shot takes it."""
        self.cues.append("suppressed_shot")
        if not self.in_pane(x, y):
            return MISS  # into the wall
        struck = self._nearest_fragment(x, y)

        if self.drone is not None and self.drone.hit_at is None \
                and self.drone.contains(self.view, x, y, now) \
                and (struck is None or struck.pz > DRONE_DEPTH):
            return self._hit_drone(now)

        if struck is None:
            return MISS
        self.cues.append("debris_hit")
        bonus = 1.0 + FAR_BONUS * min(struck.pz / SPAWN_DEPTH[0], 1.0)
        if struck.radius < MIN_SPLIT_RADIUS:
            self.targets.remove(struck)
            self.cleared += 1
            return Hit(points=int(CLEAR_POINTS * bonus), ring=0, label="CLEARED",
                       perfect=True)
        pieces = self.split(struck, (x, y))
        self.targets.remove(struck)
        self.targets.extend(pieces)
        del self.targets[MAX_FRAGMENTS:]
        return Hit(points=int(SPLIT_POINTS * bonus), ring=1, label="SPLIT")

    def in_pane(self, x: float, y: float) -> bool:
        """Whether a point on screen is glass rather than wall."""
        polygon = _pane_polygon(self.area, grow=-_bevel(self.area)).astype(np.float32)
        return cv2.pointPolygonTest(polygon, (float(x), float(y)), False) >= 0

    def _nearest_fragment(self, x: float, y: float) -> Fragment | None:
        for fragment in sorted(self.targets, key=lambda f: f.pz):
            if fragment.contains(x, y):
                return fragment
        return None

    def _hit_drone(self, now: float) -> Hit:
        assert self.drone is not None
        self.drone.hit_at = now
        self.drone.spin = self.rng.uniform(3.0, 5.0)
        self.friendly_hits += 1
        # Floored, as western floors its townsfolk penalty: the drone costs
        # more than any fragment pays, so an early mistake would otherwise
        # send the round - and the high-score table - negative.
        self.score = max(0, self.score - FRIENDLY_PENALTY)
        self.cues.append("static")
        self.cues.append("alarm")
        return Hit(points=0, ring=None, label="FRIENDLY")

    def split(self, parent: Fragment, shot: tuple[float, float]) -> list[Fragment]:
        """Break a fragment into pieces that carry its momentum between them."""
        rng = self.rng
        count = 3 if parent.radius > 0.5 else 2
        fractions = [rng.uniform(0.6, 1.0) for _ in range(count)]
        total = sum(fractions)
        fractions = [f / total for f in fractions]

        # The round's impulse: a push along the line from the pane to the piece.
        length = math.hypot(parent.px, parent.py, parent.pz)
        impulse = tuple(BULLET_IMPULSE * c / length for c in (parent.px, parent.py, parent.pz))
        mass = parent.mass
        v_cm = ((mass * parent.vx + impulse[0]) / mass,
                (mass * parent.vy + impulse[1]) / mass,
                (mass * parent.vz + impulse[2]) / mass)

        # Internal kicks that sum to zero: the pieces fly apart, the centre of
        # mass does not care.
        kick = min(-parent.vz, 6.0) * 0.16
        direction = rng.uniform(0.0, math.tau)
        kicks = []
        for index in range(count):
            theta = direction + index * math.tau / count
            kicks.append((math.cos(theta) * kick, math.sin(theta) * kick,
                          rng.uniform(-0.25, 0.25) * kick))
        # Remove any residual so momentum balances exactly.
        residual = [sum(k[axis] for k in kicks) / count for axis in range(3)]
        kicks = [tuple(k[axis] - residual[axis] for axis in range(3)) for k in kicks]

        pieces = []
        for fraction, kick_vector in zip(fractions, kicks):
            child_mass = mass * fraction
            radius = child_mass ** (1.0 / 3.0)
            offset = radius * 0.8 / kick if kick else 0.0
            count_v = int(rng.randint(6, 9))
            pieces.append(Fragment(
                view=parent.view,
                px=parent.px + kick_vector[0] * offset,
                py=parent.py + kick_vector[1] * offset,
                pz=parent.pz,
                vx=v_cm[0] + kick_vector[0] / child_mass,
                vy=v_cm[1] + kick_vector[1] / child_mass,
                vz=v_cm[2] + kick_vector[2] / child_mass,
                radius=radius,
                angle=rng.uniform(0.0, math.tau),
                spin=parent.spin * 1.6 + rng.uniform(-2.0, 2.0),
                shape=tuple(rng.uniform(0.45, 1.0) for _ in range(count_v)),
                offsets=tuple(rng.uniform(-0.3, 0.3) for _ in range(count_v)),
                material=parent.material,
                generation=parent.generation + 1,
            ))
        return pieces


def momentum(fragments) -> tuple[float, float, float]:
    """Total momentum of some fragments, for the books."""
    return (sum(f.mass * f.vx for f in fragments),
            sum(f.mass * f.vy for f in fragments),
            sum(f.mass * f.vz for f in fragments))


def make_crack(x: int, y: int, cost: int, rng, now: float, scale: float = 1.0) -> Crack:
    """An impact chip in laminated glass: a handful of radial cracks with a
    little wander, and the crazing between them as a web of rings."""
    reach = (16 + cost * 2.0) * scale
    branches = []
    count = int(rng.randint(5, 7))
    radials = []
    for index in range(count):
        angle = index * math.tau / count + rng.uniform(-0.35, 0.35)
        length = reach * rng.uniform(0.5, 1.0)
        points = [(x, y)]
        px, py = float(x), float(y)
        steps = 4
        for _ in range(steps):
            angle += rng.uniform(-0.14, 0.14)  # glass runs nearly straight
            px += math.cos(angle) * length / steps
            py += math.sin(angle) * length / steps
            points.append((int(px), int(py)))
        branches.append(np.array(points, np.int32))
        radials.append(points)
        # A side split off the main crack, the way glass does.
        if rng.random() < 0.25:
            fork = points[int(rng.randint(1, 2))]
            side = angle + rng.choice((-1.0, 1.0)) * rng.uniform(0.5, 1.1)
            tip = (int(fork[0] + math.cos(side) * length * 0.3),
                   int(fork[1] + math.sin(side) * length * 0.3))
            branches.append(np.array([fork, tip], np.int32))
    # The web: rings joining the radials at a fraction of their length, each
    # ring a closed polyline through a point on every radial, so the crazing
    # follows the cracks rather than cutting across them.
    ring_fractions = (0.3,) if cost < 20 else (0.25, 0.55)
    for fraction in ring_fractions:
        ring = []
        for points in radials:
            step = fraction * (len(points) - 1)
            index = int(step)
            t = step - index
            a, b = points[index], points[min(index + 1, len(points) - 1)]
            ring.append((int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t)))
        ring.append(ring[0])
        branches.append(np.array(ring, np.int32))
    rings = tuple(int(reach * f) for f in ring_fractions)
    return Crack(x=x, y=y, branches=tuple(branches), rings=rings, at=now)


# --- drawing ----------------------------------------------------------------
#
# One light. The sun sits up and to the right of the pane and everything
# out there agrees with it: the planet's terminator, the glint on the sea,
# the lit face of the array, the bright edge of every rock. Under it all
# the planet throws a cool blue fill upwards, so shadow sides are blue, not
# black. The static parts - the planet, the truss, the cabin - are built once
# and copied; each frame only draws what moves.

def _noise(rng, height: int, width: int, cells: int, sigma: float) -> np.ndarray:
    """Smooth 0..1 noise, from a coarse random grid blown up and blurred."""
    coarse = rng.random((max(cells * height // width, 2), cells), np.float32)
    field_ = cv2.resize(coarse, (width, height), interpolation=cv2.INTER_CUBIC)
    if sigma >= 0.5:
        field_ = cv2.GaussianBlur(field_, (0, 0), sigma)
    low, high = float(field_.min()), float(field_.max())
    return (field_ - low) / max(high - low, 1e-6)


def _fbm(rng, height: int, width: int, base_cells: int, octaves: int) -> np.ndarray:
    """Layered noise: big shapes with ever finer detail on their edges, which
    is what coastlines are."""
    total = np.zeros((height, width), np.float32)
    weight, cells, norm = 1.0, base_cells, 0.0
    for _ in range(octaves):
        total += weight * _noise(rng, height, width, cells, width * 0.12 / cells)
        norm += weight
        weight *= 0.5
        cells = min(cells * 2, width // 2)
    return total / norm


def _earth_geometry(area: Rect, width: int) -> tuple[float, float, float]:
    radius = width * 1.35
    cx = area.x + area.width * 0.55
    cy = area.y + area.height * 0.66 + radius
    return cx, cy, radius


def _sun_vector() -> np.ndarray:
    light = np.array(SUN_DIRECTION, np.float32)
    return light / np.linalg.norm(light)


def _daylight(dx, dy, nz, ys, height: int):
    """How much sun a point on the planet gets, 0..1, with the terminator
    running diagonally across the visible strip rather than straight down.

    Returns the raw light (signed) and the soft day factor.
    """
    light_dir = _sun_vector()
    light = dx * light_dir[0] + dy * light_dir[1] + nz * light_dir[2]
    # The great circle of the terminator, seen this close to the limb, leans:
    # lower on the picture is further round the planet, away from the sun.
    light = light - (ys / height) * 0.3 + 0.17
    day = np.clip((light + 0.04) / 0.2, 0.0, 1.0)
    day = day * day * (3 - 2 * day)  # smoothstep: a soft twilight band
    return light, day


def _planet(canvas: np.ndarray, area: Rect, rng) -> None:
    """Earth's limb across the bottom of the view: oceans, coasts, relief,
    a terminator with a band of twilight, cities on the night side, the
    sun's glint off the sea, and the atmosphere wrapped round the horizon."""
    height, width = canvas.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    cx, cy, radius = _earth_geometry(area, width)
    dx, dy = (xs - cx) / radius, (ys - cy) / radius
    dist = np.sqrt(dx * dx + dy * dy)
    inside = dist < 1.0
    nz = np.sqrt(np.clip(1.0 - dist * dist, 0.0, 1.0))
    light, day = _daylight(dx, dy, nz, ys, height)

    # Land from layered noise: fractal coasts, a shallow shelf round them.
    continents = _fbm(rng, height, width, 6, 5)
    coast = 0.55
    shelf = np.clip((continents - coast + 0.08) / 0.08, 0.0, 1.0)
    land = np.clip((continents - coast) / 0.01, 0.0, 1.0)
    relief = _fbm(rng, height, width, 30, 3)
    # Fine grain: valleys and forest at a scale the coast noise cannot hold,
    # so the ground reads as terrain rather than a blurred field.
    grain = _noise(rng, height, width, 110, 1.2)
    interior = np.clip((continents - coast) / 0.06, 0.0, 1.0)  # deep inland

    surface = np.empty_like(canvas)
    surface[:] = OCEAN
    surface += (np.float32(OCEAN_SHALLOW) - np.float32(OCEAN)) * (shelf * 0.85)[..., None]
    # Land: green near the coasts where it is wet, tan inland, and bare rock
    # where the relief peaks.
    lowland = np.clip((continents - coast) / 0.05, 0.0, 1.0)
    # Hillshade: slopes facing the sun (to the right) catch it, the far
    # sides fall into shadow, so the relief reads as ground with height.
    slope = cv2.Sobel(relief, cv2.CV_32F, 1, 0, ksize=3)
    hill = np.clip(1.0 + 4.5 * slope, 0.6, 1.35)
    land_tone = np.float32(LAND)[None, None] * (
        (0.66 + 0.4 * relief + 0.28 * grain) * hill)[..., None]
    land_tone += (np.float32(LAND_WET) - land_tone) * ((1 - lowland) * 0.7)[..., None]
    highland = np.clip((relief - 0.55) / 0.3, 0.0, 1.0) * interior * 0.8
    land_tone += (np.float32(LAND_HIGH) - land_tone) * highland[..., None]
    peaks = np.clip((relief - 0.78) / 0.12, 0.0, 1.0) * interior
    land_tone += (np.float32(LAND_ROCK) - land_tone) * peaks[..., None]
    surface = surface * (1 - land[..., None]) + land_tone * land[..., None]
    # The sea has its own grain too: swell and current, faint.
    surface *= (0.94 + 0.12 * grain * (1 - land))[..., None]

    # The day side, the night side, and the orange band between them. The
    # surface curves away from the sun too, so the lit side has its own
    # gentle falloff.
    shading = (0.55 + 0.45 * np.clip(light * 1.6 + 0.3, 0.0, 1.0))
    lit = surface * (day * shading)[..., None] + np.float32(NIGHT) * (1 - day)[..., None]
    # The terminator: a narrow dusty band, the ground going amber as the sun
    # sets on it - not a glow, a shadow's edge.
    twilight = np.exp(-((light - 0.0) / 0.06) ** 2) * 0.28
    lit += np.float32(TWILIGHT)[None, None] * twilight[..., None]

    # Sun glint off the sea: where the surface mirrors the disc to you, a
    # warm patch stretched along the limb, masked by the land.
    gx = area.x + area.width * 0.74
    gy = cy - radius + area.height * 0.085
    glint = np.exp(-(((xs - gx) / (area.width * 0.16)) ** 2
                     + ((ys - gy) / (area.height * 0.07)) ** 2))
    glint = glint * (1 - land) * (1 - shelf * 0.5) * day
    lit += np.float32(LIMB)[None, None] * (glint * 1.3)[..., None]
    lit += np.float32((255, 255, 255))[None, None] * (glint ** 2 * 1.0)[..., None]
    # Fresnel rim: the air seen edge-on is bright and blue, on the day side.
    rim = (1.0 - nz) ** 5
    lit += np.float32(ATMOSPHERE) * rim[..., None] * (0.2 + 0.8 * day[..., None])
    canvas[inside] = lit[inside]

    # City lights: clusters on the dark land, brighter the deeper into night.
    night_land = inside & (day < 0.3) & (continents > coast)
    candidates = np.argwhere(night_land)
    if len(candidates):
        lights = np.zeros((height, width, 3), np.float32)
        picks = candidates[rng.integers(0, len(candidates), size=20 + 150 * width // 1512)]
        dusk = np.clip((0.3 - day) / 0.3, 0.0, 1.0)
        for y, x in picks:
            cluster = int(rng.integers(2, 10))
            spread = float(rng.uniform(3, 12)) * max(0.4, width / 1512)
            for _ in range(cluster):
                ox, oy = rng.normal(0, spread, 2)
                px, py = int(x + ox), int(y + oy * 0.4)
                if 0 <= px < width and 0 <= py < height and night_land[py, px]:
                    lights[py, px] = np.float32(CITY) * dusk[py, px]
        glow = cv2.GaussianBlur(lights, (0, 0), 3)
        canvas += lights * 0.9 + glow * 2.2

    # The atmosphere: a hard bright limb line, a thin scatter band right
    # above it, and a wider blue shell fading into space. Thicker on the day
    # side; blue where you look through it sideways, going orange towards the
    # sun, where you look through it into the light.
    outside = np.clip(dist - 1.0, 0.0, None) * radius
    shell_light = np.clip(light * 2.5 + 0.6, 0.1, 1.0)
    toward_sun = np.clip((xs - area.x) / max(area.width, 1), 0.0, 1.0) ** 3
    sunward = (toward_sun * np.clip(day + 0.2, 0.0, 1.0))[..., None]
    limb = np.exp(-((dist - 1.0) * radius / 1.6) ** 2)
    limb_tone = np.float32(LIMB_BLUE)[None, None] * (1 - sunward) + np.float32(LIMB_ORANGE) * sunward
    canvas += limb_tone * (limb * shell_light * 1.0)[..., None]
    scatter = np.exp(-outside / (height * 0.011)) * (~inside)
    scatter_tone = (np.float32((250, 205, 150))[None, None] * (1 - sunward)
                    + np.float32((110, 170, 250)) * sunward)
    canvas += scatter_tone * (scatter * shell_light * 0.85)[..., None]
    shell = np.exp(-outside / (height * 0.034)) * (~inside)
    shell_tone = (np.float32(ATMOSPHERE)[None, None] * (1 - sunward)
                  + np.float32(LIMB_ORANGE) * sunward)
    canvas += shell_tone * (shell * shell_light)[..., None] * 0.7


def _vignette(area: Rect, width: int, height: int) -> np.ndarray:
    """The glass darkens towards the frame, so whatever is cut off by it
    fades rather than stops: float multiplier per pixel."""
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    reach = area.width * 0.12
    from_x = np.minimum(xs - area.x, area.right - xs) / reach
    from_y = np.minimum(ys - area.y, area.bottom - ys) / (reach * 0.7)
    edge = np.clip(np.minimum(from_x, from_y), 0.0, 1.0)
    edge = edge * edge * (3 - 2 * edge)
    return (0.5 + 0.5 * edge)[..., None]


@lru_cache(maxsize=6)
def _backdrop(area: tuple, width: int, height: int, seed: int,
              dressed: bool = True) -> np.ndarray:
    """Space, Earth's limb, the truss outside and the wall inside. Built once."""
    area_ = Rect(*area)
    rng = np.random.default_rng(seed + 101)
    canvas = np.zeros((height, width, 3), np.float32)
    canvas[:] = SPACE
    _planet(canvas, area_, rng)
    if dressed:
        canvas *= _vignette(area_, width, height)
    canvas = np.clip(canvas, 0, 255).astype(np.uint8)
    if dressed:
        _draw_truss(canvas, area_)
        _draw_interior(canvas, area_, rng)
    return canvas


@lru_cache(maxsize=6)
def _cloud_layer(area: tuple, width: int, height: int, seed: int) -> tuple:
    """The cloud deck and the shadow it throws on the ground below, as two
    sprites a little wider than the screen: one to subtract, one to add.

    Kept apart from the backdrop so it can slide under the station a few
    pixels a second: the one thing on the planet that visibly moves.
    Returns ``(top_row, shadow, cloud)``.
    """
    area_ = Rect(*area)
    rng = np.random.default_rng(seed + 303)
    pad = int(CLOUD_DRIFT)
    cx, cy, radius = _earth_geometry(area_, width)
    top = max(0, int(cy - radius) - 4)
    rows = height - top
    wide = width + 2 * pad
    ys, xs = np.mgrid[top:height, -pad:width + pad].astype(np.float32)
    dx, dy = (xs - cx) / radius, (ys - cy) / radius
    dist = np.sqrt(dx * dx + dy * dy)
    nz = np.sqrt(np.clip(1.0 - dist * dist, 0.0, 1.0))
    _, day = _daylight(dx, dy, nz, ys, height)
    # Fade out in the last pixels before the limb, so sliding the deck never
    # pushes a cloud off the edge of the planet.
    edge = np.clip((1.0 - dist) * radius / (pad * 1.5), 0.0, 1.0)

    # Two decks at different scales: long weather fronts, and the fine
    # broken cumulus riding on them - hard-edged where they are thick,
    # wispy at their margins. Then a faint high haze over the lot.
    bands = cv2.resize(rng.random((4, 30), np.float32), (wide, rows),
                       interpolation=cv2.INTER_CUBIC)  # weather runs with the latitude
    bands = cv2.GaussianBlur(bands, (0, 0), width * 0.012)
    fronts = 0.5 * bands + 0.5 * _fbm(rng, rows, wide, 12, 3)
    cumulus = _fbm(rng, rows, wide, 55, 3)
    streaks = _noise(rng, rows, wide, 140, width * 0.001)
    front = np.clip((fronts - 0.42) / 0.22, 0.0, 1.0)
    puff = np.clip((cumulus * 0.75 + streaks * 0.25 - 0.4) / 0.2, 0.0, 1.0)
    cloud = np.clip(front * (0.2 + 0.8 * puff) * 1.3, 0.0, 1.0) ** 1.1
    haze = np.clip((fronts - 0.42) / 0.4, 0.0, 1.0) * 0.07
    # Lit tops towards the sun, shaded undersides away from it.
    shade = np.clip(cv2.Sobel(cloud, cv2.CV_32F, 1, 0, ksize=5) * -0.025 + 0.86, 0.55, 1.0)
    alpha = np.clip(cloud * 0.82 + haze, 0.0, 1.0) * day * edge * shade
    sprite = np.clip(alpha[..., None] * np.float32(CLOUD), 0, 255).astype(np.uint8)
    # The shadow: the same deck, blurred and shifted down-left, away from the
    # sun, as a darkening on whatever is underneath.
    soft = cv2.GaussianBlur(cloud * day * edge, (0, 0), 3)
    shadow = np.zeros_like(soft)
    shift = max(3, int(area_.height * 0.012))
    shadow[shift:, :wide - shift] = soft[:rows - shift, shift:]
    # Darken in the ground's own proportions, so the shadow on the sea is a
    # deeper blue rather than a purple rim.
    shadow_sprite = np.clip(shadow[..., None] * np.float32(OCEAN) * 0.75, 0, 255).astype(np.uint8)
    # Never over the truss or the cabin: they are in front of the planet.
    keep = np.zeros((height, width), np.uint8)
    cv2.fillPoly(keep, [_pane_polygon(area_, grow=-_bevel(area_))], 255)
    keep[_truss_mask(area, width, height)] = 0
    for layer in (sprite, shadow_sprite):
        layer[:, pad:pad + width][keep[top:] == 0] = 0
        layer[:, :pad] = 0
        layer[:, pad + width:] = 0
    return top, shadow_sprite, sprite


def draw_clouds(canvas: np.ndarray, area: Rect, seed: int, now: float) -> None:
    """Slide the cloud deck under the station: its shadow first, then it."""
    height, width = canvas.shape[:2]
    top, shadow, sprite = _cloud_layer((area.x, area.y, area.width, area.height),
                                       width, height, seed)
    pad = int(CLOUD_DRIFT)
    offset = int(pad + (pad - 1) * math.sin(now * 0.11))
    roi = canvas[top:height, :]
    cv2.subtract(roi, shadow[:, offset:offset + width], dst=roi)
    cv2.add(roi, sprite[:, offset:offset + width], dst=roi)


def _truss_frame(area: Rect):
    """The beam's geometry: a function from (distance along, side) to pixels."""
    w, h = area.width, area.height
    start = (area.x - w * 0.02, area.bottom + h * 0.05)
    end = (area.x + w * 0.36, area.y + h * 0.2)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    nx, ny = -math.sin(angle), math.cos(angle)  # the beam's normal

    def along(t: float, side: float) -> tuple[int, int]:
        depth = h * 0.055 * (1.0 - 0.45 * t)  # narrows with distance
        return (int(start[0] + (end[0] - start[0]) * t + nx * side * depth),
                int(start[1] + (end[1] - start[1]) * t + ny * side * depth))

    return along


def _draw_lattice(canvas: np.ndarray, area: Rect, along, dark, lit, key=None,
                  fill=None) -> None:
    """Chords and braces. The beam runs up and to the right, so its
    right-hand (lower) chord faces the sun and takes the key light along its
    edge; the upper-left chord faces away and sits in cool ambient."""
    h = area.height
    steps = 14
    for index in range(steps):
        t0, t1 = index / steps, (index + 1) / steps
        thick = max(2, int(h * 0.009 * (1.0 - 0.5 * t0)))
        cv2.line(canvas, along(t0, -1), along(t1, -1), dark, thick, cv2.LINE_AA)
        cv2.line(canvas, along(t0, 1), along(t1, 1), lit, thick, cv2.LINE_AA)
        brace = along(t0, 1 if index % 2 else -1), along(t1, -1 if index % 2 else 1)
        cv2.line(canvas, brace[0], brace[1], dark, max(2, thick - 1), cv2.LINE_AA)
        if index % 3 == 0:
            cv2.line(canvas, along(t0, 1), along(t0, -1), lit, max(2, thick - 1), cv2.LINE_AA)
        if key is not None:
            cv2.line(canvas, along(t0, 1.12), along(t1, 1.12), key, 1, cv2.LINE_AA)
            cv2.line(canvas, along(t0, -1.1), along(t1, -1.1), fill, 1, cv2.LINE_AA)
    cv2.circle(canvas, along(0.04, 0.0), int(h * 0.04), dark, -1, cv2.LINE_AA)
    cv2.circle(canvas, along(0.04, 0.0), int(h * 0.04), lit, 2, cv2.LINE_AA)
    if key is not None:
        cv2.ellipse(canvas, along(0.04, 0.0), (int(h * 0.04), int(h * 0.04)), 0, 290, 380,
                    key, 2, cv2.LINE_AA)
        cv2.ellipse(canvas, along(0.04, 0.0), (int(h * 0.04), int(h * 0.04)), 0, 110, 200,
                    fill, 1, cv2.LINE_AA)


def _panel_corners(along) -> np.ndarray:
    return np.array([along(0.62, -1.0), along(0.96, -1.0), along(0.96, -4.2),
                     along(0.62, -4.6)], np.int32)


def _draw_solar_panel(canvas: np.ndarray, corners: np.ndarray, sun, rows: int,
                      cols: int, dead: tuple = (), bent: tuple = ()) -> None:
    """A solar array: a specular gradient across the cells, brightest on the
    side facing the sun, one hard glare band where the glass catches the
    disc square on, a grid of grooves, and a lit rim on the sunward edges.

    ``sun`` is where the disc is on screen; the corners go (near-inner,
    far-inner, far-outer, near-outer). ``dead`` lists (row, col) cells that
    debris has scorched; ``bent`` lists grid lines that have been kinked.
    """
    height, width = canvas.shape[:2]
    x0, y0 = max(0, int(corners[:, 0].min())), max(0, int(corners[:, 1].min()))
    x1, y1 = min(width, int(corners[:, 0].max()) + 1), min(height, int(corners[:, 1].max()) + 1)
    if x1 <= x0 or y1 <= y0:
        return
    centre = corners.astype(np.float32).mean(axis=0)
    to_sun = np.float32([sun[0] - centre[0], sun[1] - centre[1]])
    to_sun /= max(float(np.linalg.norm(to_sun)), 1e-6)
    across = np.float32([-to_sun[1], to_sun[0]])
    reach = float(np.abs((corners - centre) @ to_sun).max()) or 1.0
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    u = ((xs - centre[0]) * to_sun[0] + (ys - centre[1]) * to_sun[1]) / reach
    v = ((xs - centre[0]) * across[0] + (ys - centre[1]) * across[1]) / reach
    # The sheen climbs towards the sun; the glare is a band just short of the
    # sunward edge, leaning a little with the grain of the glass.
    sheen = np.clip(0.5 + 0.5 * u, 0.0, 1.0)
    glare = np.exp(-((u - 0.5 + 0.25 * v) / 0.17) ** 2)
    mix = np.clip(0.08 + sheen * 0.4 + glare * 0.85, 0.0, 1.0)[..., None]
    cells = (np.float32(PANEL_BASE) * (1 - mix) + np.float32(PANEL_SPEC) * mix)
    cells += np.float32((0, 12, 34)) * glare[..., None]  # the glare is the sun's colour
    mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(mask, [corners - np.array([x0, y0], np.int32)], 255, cv2.LINE_AA)
    region = canvas[y0:y1, x0:x1]
    alpha = (mask.astype(np.float32) / 255.0)[..., None]
    region[:] = np.clip(region * (1 - alpha) + cells * alpha, 0, 255).astype(np.uint8)

    def at(a: float, b: float) -> tuple[int, int]:
        """Bilinear point on the panel: a along the axis, b across it."""
        near = corners[0] + (corners[3] - corners[0]) * b
        far = corners[1] + (corners[2] - corners[1]) * b
        p = near + (far - near) * a
        return int(p[0]), int(p[1])

    # Scorched cells: the glass gone dark, a pale pit where the piece struck,
    # and hairline fractures running out of it.
    for row, col in dead:
        cell = np.array([at(col / cols, row / rows), at((col + 1) / cols, row / rows),
                         at((col + 1) / cols, (row + 1) / rows),
                         at(col / cols, (row + 1) / rows)], np.int32)
        cv2.fillPoly(canvas, [cell], (30, 29, 28), cv2.LINE_AA)
        pit = at((col + 0.5) / cols, (row + 0.5) / rows)
        radius = max(2, int(math.hypot(*(cell[0] - cell[2])) * 0.08))
        cv2.circle(canvas, pit, radius * 2, (52, 50, 48), -1, cv2.LINE_AA)
        cv2.circle(canvas, pit, radius, (120, 118, 114), -1, cv2.LINE_AA)
        for step in range(4):
            angle = step * 1.7 + row * 0.9 + col * 1.3
            tip = (int(pit[0] + math.cos(angle) * radius * 4.5),
                   int(pit[1] + math.sin(angle) * radius * 4.5))
            cv2.line(canvas, pit, tip, (88, 86, 82), 1, cv2.LINE_AA)
    for index in range(1, cols):
        a = index / cols
        if index in bent:  # a kinked rib: two segments meeting off the line
            kink = at(a + 0.02, 0.55)
            cv2.line(canvas, at(a, 0.0), kink, PANEL_GRID, 2, cv2.LINE_AA)
            cv2.line(canvas, kink, at(a, 1.0), PANEL_GRID, 2, cv2.LINE_AA)
            cv2.line(canvas, at(a + 0.006, 0.0), kink, STRUT_LIT, 1, cv2.LINE_AA)
            continue
        cv2.line(canvas, at(a, 0.0), at(a, 1.0), PANEL_GRID, 2, cv2.LINE_AA)
        cv2.line(canvas, at(a + 0.006, 0.0), at(a + 0.006, 1.0), PANEL_SPEC, 1, cv2.LINE_AA)
    for index in range(1, rows):
        b = index / rows
        cv2.line(canvas, at(0.0, b), at(1.0, b), PANEL_GRID, 2, cv2.LINE_AA)
        cv2.line(canvas, at(0.0, b - 0.015), at(1.0, b - 0.015), PANEL_SPEC, 1, cv2.LINE_AA)
    cv2.polylines(canvas, [corners], True, STRUT_LIT, 2, cv2.LINE_AA)
    # Each rim is lit by whichever light it faces: the sun, or the planet.
    for index in range(4):
        a, b = corners[index], corners[(index + 1) % 4]
        edge = (b - a).astype(np.float32)
        normal = np.float32([edge[1], -edge[0]])
        if float(normal @ (a - centre)) < 0:
            normal = -normal
        normal /= max(float(np.linalg.norm(normal)), 1e-6)
        facing = float(normal @ to_sun)
        if facing > 0.15:
            cv2.line(canvas, tuple(a), tuple(b), KEY_LIGHT, 1, cv2.LINE_AA)
        elif normal[1] > 0.3:
            cv2.line(canvas, tuple(a), tuple(b), FILL_LIGHT, 1, cv2.LINE_AA)


#: Where the array hangs, in metres out from the glass: debris crossing this
#: depth over the panel strikes it.
PANEL_DEPTH = 3.2
#: How far the array swings either way as it tracks the sun, in degrees.
ARRAY_SWAY = 3.5
ARRAY_ROWS, ARRAY_COLS = 3, 4


def _array_pivot(along) -> tuple[int, int]:
    """Where the array's arm meets the truss: what it turns about."""
    return along(0.79, -1.0)


def array_angle(now: float) -> float:
    """The array's tilt this frame, degrees: a slow sway as it tracks the sun."""
    return ARRAY_SWAY * math.sin(now * 0.05)


def array_corners(area: Rect, angle: float = 0.0) -> np.ndarray:
    """The array's four corners on screen, turned ``angle`` degrees on its arm."""
    along = _truss_frame(area)
    corners = _panel_corners(along).astype(np.float32)
    if angle:
        pivot = np.float32(_array_pivot(along))
        matrix = cv2.getRotationMatrix2D((float(pivot[0]), float(pivot[1])), angle, 1.0)
        corners = (np.hstack([corners, np.ones((4, 1), np.float32)]) @ matrix.T)
    return corners.astype(np.int32)


def array_cell(area: Rect, x: float, y: float, angle: float = 0.0) -> tuple[int, int] | None:
    """Which cell of the array a screen point is over, or None if it is not."""
    corners = array_corners(area, angle).astype(np.float32)
    if cv2.pointPolygonTest(corners, (float(x), float(y)), False) < 0:
        return None
    best, best_dist = None, math.inf
    for row in range(ARRAY_ROWS):
        for col in range(ARRAY_COLS):
            a, b = (col + 0.5) / ARRAY_COLS, (row + 0.5) / ARRAY_ROWS
            near = corners[0] + (corners[3] - corners[0]) * b
            far = corners[1] + (corners[2] - corners[1]) * b
            p = near + (far - near) * a
            dist = math.hypot(p[0] - x, p[1] - y)
            if dist < best_dist:
                best, best_dist = (row, col), dist
    return best


@lru_cache(maxsize=48)
def _array_sprite(area: tuple, angle_q: int, dead: tuple, bent: tuple) -> tuple:
    """The array, drawn once per tilt and damage state, as a sprite with a
    mask: ``(x0, y0, pixels, mask)``."""
    area_ = Rect(*area)
    corners = array_corners(area_, angle_q * 0.25)
    x0, y0 = int(corners[:, 0].min()) - 4, int(corners[:, 1].min()) - 4
    x1, y1 = int(corners[:, 0].max()) + 5, int(corners[:, 1].max()) + 5
    local = corners - np.array([x0, y0], np.int32)
    sprite = np.zeros((y1 - y0, x1 - x0, 3), np.uint8)
    sun = sun_position(area_, 30.0)
    _draw_solar_panel(sprite, local, (sun[0] - x0, sun[1] - y0), ARRAY_ROWS, ARRAY_COLS,
                      dead, bent)
    mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(mask, [local], 255, cv2.LINE_AA)
    cv2.polylines(mask, [local], True, 255, 3, cv2.LINE_AA)
    return x0, y0, sprite, mask


def draw_array(canvas: np.ndarray, area: Rect, now: float, dead: tuple = (),
               bent: tuple = ()) -> None:
    """The array on its arm, swung to this frame's tilt, with its damage."""
    height, width = canvas.shape[:2]
    angle_q = int(round(array_angle(now) / 0.25))
    x0, y0, sprite, mask = _array_sprite((area.x, area.y, area.width, area.height),
                                         angle_q, tuple(sorted(dead)), tuple(sorted(bent)))
    x1, y1 = x0 + sprite.shape[1], y0 + sprite.shape[0]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    cut = mask[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)]
    cv2.copyTo(sprite[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)], cut, roi)


def _draw_truss(canvas: np.ndarray, area: Rect) -> None:
    """The station's own truss, running out from below the window on the
    left, and the arm the array hangs from. The array itself is drawn each
    frame, since it moves and takes damage."""
    height, width = canvas.shape[:2]
    along = _truss_frame(area)
    _draw_lattice(canvas, area, along, STRUT, STRUT_LIT, KEY_LIGHT, FILL_LIGHT)

    # The panel throws a soft shadow down the lattice, away from the sun.
    lattice = np.zeros((height, width), np.uint8)
    _draw_lattice(lattice, area, along, 255, 255)
    panel = _panel_corners(along)
    shadow = np.zeros((height, width), np.float32)
    shift = np.array([-area.height * 0.04, area.height * 0.06], np.int32)
    cv2.fillPoly(shadow, [panel + shift], 1.0)
    shadow = cv2.GaussianBlur(shadow, (0, 0), area.height * 0.012)
    under = (lattice > 0) & (shadow > 0.01)
    canvas[under] = (canvas[under] * (1.0 - 0.55 * shadow[under])[:, None]).astype(np.uint8)

    # The arm it hangs from, and the hinge.
    cv2.line(canvas, along(0.79, -1.0), along(0.79, -0.2), STRUT_LIT, 3, cv2.LINE_AA)
    cv2.line(canvas, along(0.79, -0.95), along(0.79, -0.25), KEY_LIGHT, 1, cv2.LINE_AA)
    cv2.circle(canvas, _array_pivot(along), max(2, int(area.height * 0.008)), STRUT_LIT, -1,
               cv2.LINE_AA)


def _tether_anchor(area: Rect) -> tuple[int, int]:
    """Where the drone's line is clipped to the station: a point on the truss."""
    return _truss_frame(area)(0.42, -1.0)


def _draw_interior(canvas: np.ndarray, area: Rect, rng) -> None:
    """Everything inside the station: the wall around the pane, and its frame."""
    height, width = canvas.shape[:2]
    wall = np.full((height, width, 3), INTERIOR, np.uint8)
    # A soft light fall-off across the wall, so it is not a flat slab.
    wash = np.linspace(1.15, 0.8, height, dtype=np.float32)[:, None, None]
    wall = np.clip(wall * wash, 0, 255).astype(np.uint8)
    cut = _pane_polygon(area)
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [cut], 255)
    # Everything not pane is wall.
    canvas[mask == 0] = wall[mask == 0]

    # Frame: a thick bevel around the octagonal cut, lit from above.
    bevel = _bevel(area)
    cv2.polylines(canvas, [cut], True, FRAME, bevel * 2, cv2.LINE_AA)
    cv2.polylines(canvas, [cut], True, FRAME_DARK, bevel, cv2.LINE_AA)
    cv2.polylines(canvas, [_pane_polygon(area, grow=bevel * 1.45)], True, FRAME_LIT, 1,
                  cv2.LINE_AA)
    cv2.polylines(canvas, [_pane_polygon(area, grow=-bevel * 0.5)], True, FRAME_LIT, 1,
                  cv2.LINE_AA)
    # Bolts along the long edges.
    for t in np.linspace(0.08, 0.92, 9):
        for y in (area.y - bevel * 0.6, area.bottom + bevel * 0.6):
            x = int(area.x + area.width * t)
            cv2.circle(canvas, (x, int(y)), max(2, bevel // 4), FRAME_LIT, -1, cv2.LINE_AA)
            cv2.circle(canvas, (x, int(y)), max(2, bevel // 4), FRAME_DARK, 1, cv2.LINE_AA)

    # Panel seams on the wall.
    for x in (int(area.x - bevel * 3), int(area.right + bevel * 3)):
        if 0 < x < width:
            cv2.line(canvas, (x, 0), (x, height), INTERIOR_LIGHT, 1, cv2.LINE_AA)
    cv2.line(canvas, (0, int(area.bottom + bevel * 3)), (width, int(area.bottom + bevel * 3)),
             INTERIOR_LIGHT, 1, cv2.LINE_AA)


def _bevel(area: Rect) -> int:
    """How far the frame's bevel reaches in over the glass."""
    return max(6, int(area.height * 0.022))


def _pane_polygon(area: Rect, grow: float = 0.0) -> np.ndarray:
    """The pane: a rectangle with its corners cut, the way cupola panes are."""
    cut = area.height * 0.11
    x0, y0 = area.x - grow, area.y - grow
    x1, y1 = area.right + grow, area.bottom + grow
    return np.array([
        (x0 + cut, y0), (x1 - cut, y0), (x1, y0 + cut), (x1, y1 - cut),
        (x1 - cut, y1), (x0 + cut, y1), (x0, y1 - cut), (x0, y0 + cut)], np.int32)


@lru_cache(maxsize=6)
def _space_mask(area: tuple, width: int, height: int) -> np.ndarray:
    """Where stars may show: the pane, above the limb, not behind the truss."""
    area_ = Rect(*area)
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [_pane_polygon(area_, grow=-_bevel(area_))], 255)
    cx, cy, radius = _earth_geometry(area_, width)
    cv2.circle(mask, (int(cx), int(cy)), int(radius + width * 0.01), 0, -1)
    mask[_truss_mask(area, width, height)] = 0
    return mask > 0


@lru_cache(maxsize=6)
def _stars(area: tuple, width: int, height: int, seed: int) -> tuple:
    """Two layers of stars; the near layer drifts faster as the station moves."""
    rng = np.random.default_rng(seed + 7)
    layers = []
    for count, speed, brightness in ((420, 4.0, 120), (160, 9.0, 210)):
        xs = rng.uniform(0, width, count).astype(np.float32)
        ys = rng.uniform(0, height, count).astype(np.float32)
        tone = rng.uniform(0.55, 1.0, count).astype(np.float32)
        layers.append((xs, ys, tone, speed, brightness))
    return tuple(layers)


def draw_stars(canvas: np.ndarray, area: Rect, seed: int, now: float) -> None:
    height, width = canvas.shape[:2]
    mask = _space_mask((area.x, area.y, area.width, area.height), width, height)
    for xs, ys, tone, speed, brightness in _stars(
            (area.x, area.y, area.width, area.height), width, height, seed):
        sx = ((xs - now * speed) % width).astype(np.int32)
        sy = ys.astype(np.int32)
        show = mask[sy, sx]
        sx, sy, level = sx[show], sy[show], tone[show]
        value = (brightness * level).astype(np.uint8)
        canvas[sy, sx] = np.stack([value, value, np.minimum(value + 18, 255)], axis=1)
        if brightness > 150:  # the bright layer gets a cross of half-light
            dim = (value * 0.45).astype(np.uint8)
            for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = np.clip(sx + ox, 0, width - 1), np.clip(sy + oy, 0, height - 1)
                keep = mask[ny, nx]
                canvas[ny[keep], nx[keep]] = np.stack([dim, dim, dim], axis=1)[keep]


def sun_position(area: Rect, now: float) -> tuple[float, float]:
    """The sun: up and to the right, creeping slowly as the station turns.

    It stays in that quadrant all round, so the light on the planet, the
    panel and every rock agrees with where the disc is.
    """
    t = (now % 120.0) / 120.0
    x = area.right - area.width * (0.13 + 0.06 * t)
    y = area.y + area.height * (0.17 + 0.05 * math.sin(t * math.pi))
    return x, y


@lru_cache(maxsize=64)
def _glow_sprite(reach: int, color: tuple, strength: float, softness: float,
                 squash: float = 1.0, tilt: float = 0.0) -> np.ndarray:
    """An additive light blob: colour times a smooth falloff, ready for
    cv2.add. ``squash`` flattens it into a streak, ``tilt`` (degrees) turns it."""
    # Callers size these off the panel, and on a chooser card a few dozen pixels
    # tall several of them round to nothing - which divides by zero here and
    # fills the sprite with NaN. One pixel is the smallest light there is.
    reach = max(1, reach)
    span = np.arange(-reach, reach + 1, dtype=np.float32)
    xs, ys = np.meshgrid(span / reach, span / (reach * squash))
    dist = np.sqrt(xs * xs + ys * ys)
    alpha = np.clip(1.0 - dist, 0.0, 1.0) ** softness * strength
    sprite = np.clip(alpha[..., None] * np.float32(color), 0, 255).astype(np.uint8)
    if tilt:
        matrix = cv2.getRotationMatrix2D((reach, reach), tilt, 1.0)
        sprite = cv2.warpAffine(sprite, matrix, (2 * reach + 1, 2 * reach + 1))
    return sprite


@lru_cache(maxsize=32)
def _ghost_sprite(radius: int, color: tuple, strength: float) -> np.ndarray:
    """A lens ghost: a soft-edged hexagon, the shape of the aperture."""
    reach = radius + 4
    sprite = np.zeros((2 * reach + 1, 2 * reach + 1, 3), np.uint8)
    points = np.array([(reach + radius * math.cos(a), reach + radius * math.sin(a))
                       for a in np.linspace(0, math.tau, 7)[:-1] + 0.3], np.int32)
    cv2.fillPoly(sprite, [points], tuple(int(c * strength) for c in color), cv2.LINE_AA)
    cv2.polylines(sprite, [points], True, tuple(int(c * strength * 1.6) for c in color), 1,
                  cv2.LINE_AA)
    return cv2.GaussianBlur(sprite, (0, 0), max(1.0, radius * 0.08))


def _stamp(canvas: np.ndarray, centre: tuple[int, int], sprite: np.ndarray) -> None:
    """Add a sprite onto the canvas, centred, clipped to the edges."""
    height, width = canvas.shape[:2]
    reach_y, reach_x = sprite.shape[0] // 2, sprite.shape[1] // 2
    x0, y0 = centre[0] - reach_x, centre[1] - reach_y
    x1, y1 = x0 + sprite.shape[1], y0 + sprite.shape[0]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    cv2.add(roi, sprite[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)], dst=roi)


def draw_sun(canvas: np.ndarray, area: Rect, now: float) -> None:
    """The disc, its halo, the long thin streak the pane's coating throws
    off it, and the aperture ghosts marching through the centre."""
    sx, sy = sun_position(area, now)
    if not (area.x - area.width * 0.1 < sx < area.right + area.width * 0.1):
        return
    centre = (int(sx), int(sy))
    radius = int(area.height * 0.035)
    cx, cy = area.x + area.width / 2, area.y + area.height / 2
    # How much of the flare reaches you: full once the disc is well inside.
    inside = min(max((area.right + area.width * 0.1 - sx) / (area.width * 0.3), 0.0), 1.0)
    inside = min(inside, max((sx - area.x + area.width * 0.1) / (area.width * 0.3), 0.0))
    inside = round(inside * 20) / 20  # quantised, so the sprites cache

    _stamp(canvas, centre, _glow_sprite(radius * 8, SUN_WARM, 0.26 * inside, 2.4))
    _stamp(canvas, centre, _glow_sprite(radius * 3, SUN, 0.7 * inside, 1.6))
    cv2.circle(canvas, centre, radius, SUN, -1, cv2.LINE_AA)
    # The streak: long, thin, warm, and not quite level - it follows the
    # grain of the coating, not the frame. A shorter cooler one crosses it.
    _stamp(canvas, centre, _glow_sprite(int(area.width * 0.4), SUN_WARM, 0.26 * inside, 1.6,
                                        squash=0.014, tilt=-11.0))
    _stamp(canvas, centre, _glow_sprite(int(area.width * 0.18), (255, 225, 190),
                                        0.2 * inside, 1.6, squash=0.025, tilt=6.0))
    for t, size, tint in ((0.4, 0.8, (200, 170, 120)), (0.75, 1.5, (150, 130, 110)),
                          (1.2, 0.55, (140, 200, 190)), (1.55, 2.2, (130, 120, 110))):
        ghost = (int(sx + (cx - sx) * t), int(sy + (cy - sy) * t))
        _stamp(canvas, ghost, _ghost_sprite(int(radius * size), tint, 0.15 * inside))


def _shade(color, amount: float) -> tuple[int, int, int]:
    return tuple(int(min(255, c * amount)) for c in color)


def _tone(color_a, color_b, t: float) -> tuple[int, int, int]:
    return tuple(int(a + (b - a) * t) for a, b in zip(color_a, color_b))


def _warm(color, amount: float) -> tuple[int, int, int]:
    """Lift a tone towards the sun's colour: more red than blue."""
    b, g, r = color
    return (int(min(255, b * amount * 0.92)), int(min(255, g * amount)),
            int(min(255, r * amount * 1.08 + 8)))


def _cool(color, amount: float) -> tuple[int, int, int]:
    """Sink a tone into the planet's bounce: half its own shade, half blue."""
    return _tone(_shade(color, amount), FILL_LIGHT, 0.5)


def _material_tones(material: int) -> tuple:
    """Four facet tones for a material: sunlit, half-lit, shadow, and the
    underside lit blue by the planet."""
    base = MATERIALS[material % len(MATERIALS)]
    return (_warm(base, 1.35), _shade(base, 1.05), _shade(base, 0.5), _cool(base, 0.55))


def draw_fragment(canvas: np.ndarray, fragment: Fragment, sun: tuple[float, float]) -> None:
    """A lump of rock, alloy or foil: faceted, lit hard on the sunward side,
    with a cool Earth-shine on its underside, and a streak of motion
    behind it."""
    polygon = fragment.polygon()
    size = fragment.size
    lit, mid, dark, under = _material_tones(fragment.material)
    base = MATERIALS[fragment.material % len(MATERIALS)]
    if size < 1.5:
        x, y = polygon.mean(axis=0)
        canvas[int(y) % canvas.shape[0], int(x) % canvas.shape[1]] = mid
        return
    points = polygon.astype(np.int32)
    centre = polygon.mean(axis=0)
    to_sun = np.array([sun[0] - centre[0], sun[1] - centre[1]], np.float32)
    to_sun /= max(float(np.linalg.norm(to_sun)), 1e-6)

    # Motion: a ghost of the silhouette where it was a moment ago, blended
    # faintly behind it - the blur a fast thing leaves on a long exposure.
    if size >= 4:
        view = fragment.view
        bx, by = view.screen(fragment.px - fragment.vx * 0.06, fragment.py - fragment.vy * 0.06,
                             fragment.pz - fragment.vz * 0.06)
        dx, dy = bx - centre[0], by - centre[1]
        length = math.hypot(dx, dy)
        if length > 2.0:
            cap = min(length, size * 1.2)
            dx, dy = dx / length * cap, dy / length * cap
            _ghost_polygon(canvas, points, (dx, dy), _tone(base, dark, 0.5), 0.3)
    if size < 4:
        # Too small for facets, but the same material and the same light: a
        # two-tone chip, its body in the half-shade, the sunward edge warm.
        cv2.fillPoly(canvas, [points], _tone(dark, mid, 0.6), cv2.LINE_AA)
        count = len(points)
        for index in range(count):
            a, b = points[index], points[(index + 1) % count]
            edge_mid = (a + b) * 0.5 - centre
            if float(edge_mid @ to_sun) > 0.2 * size:
                cv2.line(canvas, tuple(a), tuple(b), lit, 1, cv2.LINE_AA)
        return
    cv2.fillPoly(canvas, [points], base, cv2.LINE_AA)

    # Facets: a fan of triangles from an off-centre core, each toned by how
    # squarely its outer edge faces the sun, with the planet's blue on the
    # faces that look down. Then a bright rim along the lit edges.
    count = len(points)
    edges = np.roll(polygon, -1, axis=0) - polygon
    normals = np.stack([edges[:, 1], -edges[:, 0]], axis=1)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-6)
    # Inward-facing normals point the other way on a clockwise polygon.
    if float(np.sum(normals * (polygon - centre), axis=1).mean()) < 0:
        normals = -normals
    facing = normals @ to_sun
    core = centre - to_sun * size * 0.12  # the crust is thicker on the lit side
    inner = (core + (polygon - core) * 0.4).astype(np.int32)
    for index in range(count):
        face = float(facing[index])
        down = float(normals[index, 1])
        if face > 0.35:
            tone = lit
        elif face > -0.2:
            tone = mid
        elif down > 0.45:
            tone = under
        else:
            tone = dark
        tri = np.array([points[index], points[(index + 1) % count], inner[index]], np.int32)
        cv2.fillPoly(canvas, [tri], tone, cv2.LINE_AA)
    # The core, half-lit, so the facets read as a crust around it.
    cv2.fillPoly(canvas, [inner], _tone(dark, mid, 0.45), cv2.LINE_AA)
    for index in range(count):
        a, b = tuple(points[index]), tuple(points[(index + 1) % count])
        face = float(facing[index])
        if face > 0.2:
            cv2.line(canvas, a, b, ROCK_RIM, 1, cv2.LINE_AA)
        elif face < -0.3 and normals[index, 1] > 0.3:
            cv2.line(canvas, a, b, EARTHSHINE, 1, cv2.LINE_AA)
    if size > 14:
        # A pit on the shadow side, a scar across the crust, and one glint.
        ox, oy = -to_sun * size * 0.3
        cv2.circle(canvas, (int(centre[0] + ox), int(centre[1] + oy)),
                   max(2, int(size * 0.16)), dark, -1, cv2.LINE_AA)
        cv2.ellipse(canvas, (int(centre[0] + ox), int(centre[1] + oy)),
                    (max(2, int(size * 0.16)), max(1, int(size * 0.1))), 0, 200, 340,
                    mid, 1, cv2.LINE_AA)
        scar = (points[count // 3], inner[(count // 3 + 2) % count])
        cv2.line(canvas, tuple(scar[0]), tuple(scar[1]), dark, 1, cv2.LINE_AA)
        glint = (int(centre[0] + to_sun[0] * size * 0.42),
                 int(centre[1] + to_sun[1] * size * 0.42))
        cv2.circle(canvas, glint, max(1, int(size * 0.07)), ROCK_RIM, -1, cv2.LINE_AA)
        if fragment.material == 2 and size > 20:
            # Foil crinkles: a few short bright creases on the lit side.
            for step in range(3):
                a = fragment.angle * 0.5 + step * 2.1
                px = int(centre[0] + to_sun[0] * size * 0.2 + math.cos(a) * size * 0.3)
                py = int(centre[1] + to_sun[1] * size * 0.2 + math.sin(a) * size * 0.3)
                cv2.line(canvas, (px, py), (int(px + math.cos(a + 1) * size * 0.2),
                                            int(py + math.sin(a + 1) * size * 0.2)),
                         _warm(base, 2.2), 1, cv2.LINE_AA)


def _ghost_polygon(canvas: np.ndarray, points: np.ndarray, shift: tuple[float, float],
                   color, alpha: float) -> None:
    """Blend a shifted copy of a polygon under it, at a fraction of strength."""
    height, width = canvas.shape[:2]
    moved = points + np.array([int(shift[0]), int(shift[1])], np.int32)
    x0, y0 = max(0, int(moved[:, 0].min()) - 1), max(0, int(moved[:, 1].min()) - 1)
    x1, y1 = min(width, int(moved[:, 0].max()) + 2), min(height, int(moved[:, 1].max()) + 2)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    over = roi.copy()
    cv2.fillPoly(over, [moved - np.array([x0, y0], np.int32)], color, cv2.LINE_AA)
    cv2.addWeighted(over, alpha, roi, 1 - alpha, 0.0, dst=roi)


def draw_tether(canvas: np.ndarray, area: Rect, drone: Drone, view: Projection,
                now: float) -> None:
    """The safety line from the station to the drone: slack, so it sags a
    little, and snapped short once the drone has been knocked loose."""
    x, y, z = drone.position(now)
    sx, sy = view.screen(x, y, z)
    size = drone.radius_px(view)
    ax, ay = _tether_anchor(area)
    end = (sx - size * 0.2, sy + size * 0.35)
    if drone.hit_at is not None:
        # Snapped: a short length trailing from the drone, whipping about.
        since = now - drone.hit_at
        for step in range(4):
            t0, t1 = step / 4, (step + 1) / 4
            wobble = math.sin(since * 9 + step * 1.8) * size * 0.25
            p0 = (int(end[0] - t0 * size * 1.4 + wobble * t0), int(end[1] + t0 * size * 0.9))
            p1 = (int(end[0] - t1 * size * 1.4 + wobble * t1), int(end[1] + t1 * size * 0.9))
            cv2.line(canvas, p0, p1, TETHER, 1, cv2.LINE_AA)
        return
    sag = (0.5 * (ax + end[0]), 0.5 * (ay + end[1]) + abs(end[0] - ax) * 0.12
           + math.sin(now * 0.7) * size * 0.15)
    points = []
    for step in range(17):
        t = step / 16
        px = (1 - t) ** 2 * ax + 2 * (1 - t) * t * sag[0] + t * t * end[0]
        py = (1 - t) ** 2 * ay + 2 * (1 - t) * t * sag[1] + t * t * end[1]
        points.append((int(px), int(py)))
    poly = np.array(points, np.int32)
    cv2.polylines(canvas, [poly], False, _tone(SPACE, TETHER, 0.3), 2, cv2.LINE_AA)
    cv2.polylines(canvas, [poly], False, TETHER, 1, cv2.LINE_AA)


def draw_drone(canvas: np.ndarray, drone: Drone, view: Projection, now: float,
               area: Rect | None = None) -> None:
    """The maintenance drone: a suited figure on a line, visor towards you,
    with a tool in hand and a light blinking on its pack. Visibly not a rock."""
    x, y, z = drone.position(now)
    sx, sy = view.screen(x, y, z)
    size = drone.radius_px(view)
    facing = -1.0 if drone.vx < 0 else 1.0  # which way it is working its way
    if drone.hit_at is not None:
        tilt = (now - drone.hit_at) * drone.spin * 57.3
    else:
        tilt = math.sin(now * 0.8) * 6.0 + facing * 8.0

    def at(dx: float, dy: float) -> tuple[int, int]:
        """Suit coordinates, in body radii, to pixels."""
        a = math.radians(tilt)
        dx, dy = dx * facing * size, dy * size
        return (int(sx + dx * math.cos(a) - dy * math.sin(a)),
                int(sy + dx * math.sin(a) + dy * math.cos(a)))

    def poly(*pairs) -> np.ndarray:
        return np.array([at(dx, dy) for dx, dy in pairs], np.int32)

    s = size
    # The life-support pack, behind and a little above the shoulders.
    pack = poly((-0.9, -0.75), (-0.2, -0.75), (-0.2, 0.35), (-0.9, 0.35))
    cv2.fillPoly(canvas, [pack], SUIT_SHADE, cv2.LINE_AA)
    cv2.polylines(canvas, [pack], True, SUIT_DARK, 1, cv2.LINE_AA)
    cv2.line(canvas, at(-0.9, -0.75), at(-0.2, -0.75), KEY_LIGHT, 1, cv2.LINE_AA)
    # Legs: two stubs with the red identity stripe every suit carries.
    for leg in (-0.22, 0.22):
        cv2.line(canvas, at(leg, 0.5), at(leg + 0.12, 1.25), SUIT, max(2, int(s * 0.26)),
                 cv2.LINE_AA)
        cv2.line(canvas, at(leg + 0.03, 0.95), at(leg + 0.1, 1.05), NAV_RED,
                 max(1, int(s * 0.08)), cv2.LINE_AA)
        cv2.circle(canvas, at(leg + 0.14, 1.3), max(2, int(s * 0.16)), SUIT_SHADE, -1,
                   cv2.LINE_AA)
    # Torso: a rounded block, with seams and the chest control box.
    torso = poly((-0.55, -0.5), (0.55, -0.5), (0.62, 0.0), (0.5, 0.6), (-0.5, 0.6),
                 (-0.62, 0.0))
    cv2.fillPoly(canvas, [torso], SUIT, cv2.LINE_AA)
    # Lit from the upper right, blue bounce from below.
    cv2.line(canvas, at(0.55, -0.5), at(0.62, 0.0), KEY_LIGHT, 2, cv2.LINE_AA)
    cv2.line(canvas, at(-0.55, -0.5), at(0.55, -0.5), KEY_LIGHT, 1, cv2.LINE_AA)
    cv2.line(canvas, at(-0.5, 0.6), at(0.5, 0.6), FILL_LIGHT, 2, cv2.LINE_AA)
    cv2.line(canvas, at(-0.62, 0.0), at(-0.5, 0.6), _tone(SUIT, FILL_LIGHT, 0.5), 2,
             cv2.LINE_AA)
    for seam in (-0.2, 0.1, 0.4):
        cv2.line(canvas, at(-0.5, seam), at(0.52, seam), SUIT_SHADE, 1, cv2.LINE_AA)
    chest = poly((-0.3, -0.35), (0.25, -0.35), (0.25, 0.02), (-0.3, 0.02))
    cv2.fillPoly(canvas, [chest], SUIT_DARK, cv2.LINE_AA)
    cv2.circle(canvas, at(-0.17, -0.17), max(1, int(s * 0.05)), NAV_GREEN, -1, cv2.LINE_AA)
    cv2.circle(canvas, at(0.0, -0.17), max(1, int(s * 0.05)), (230, 200, 90), -1, cv2.LINE_AA)
    cv2.rectangle(canvas, at(-0.48, 0.15), at(-0.3, 0.3), (60, 60, 200), -1)  # the flag
    # Arms: one out to the work, holding a tool; one steadying on the line.
    for shoulder, hand in (((0.45, -0.3), (1.25, 0.05)), ((-0.4, -0.3), (-0.6, 0.75))):
        cv2.line(canvas, at(*shoulder), at(*hand), SUIT, max(2, int(s * 0.24)), cv2.LINE_AA)
        cv2.line(canvas, at(shoulder[0], shoulder[1] - 0.08),
                 at(hand[0], hand[1] - 0.08), KEY_LIGHT, 1, cv2.LINE_AA)
        cv2.circle(canvas, at(*hand), max(2, int(s * 0.15)), SUIT_SHADE, -1, cv2.LINE_AA)
    cv2.line(canvas, at(1.2, 0.0), at(1.55, -0.25), SUIT_DARK, max(2, int(s * 0.1)),
             cv2.LINE_AA)  # the tool
    # Helmet, and the visor with the sun on its rim and the planet in its bowl.
    helmet = at(0.08, -0.95)
    hr = max(3, int(s * 0.42))
    cv2.circle(canvas, helmet, hr, SUIT, -1, cv2.LINE_AA)
    cv2.ellipse(canvas, helmet, (hr, hr), 0, 215, 330, KEY_LIGHT, 2, cv2.LINE_AA)
    cv2.ellipse(canvas, helmet, (hr, hr), 0, 40, 150, FILL_LIGHT, 1, cv2.LINE_AA)
    visor = (int(hr * 0.8), int(hr * 0.62))
    cv2.ellipse(canvas, helmet, visor, tilt, 0, 360, VISOR, -1, cv2.LINE_AA)
    cv2.ellipse(canvas, helmet, visor, tilt, 0, 360, VISOR_GOLD, 1, cv2.LINE_AA)
    # Reflections: the planet's blue crescent low in the bowl, the sun's
    # hard highlight high on the sunward side.
    cv2.ellipse(canvas, helmet, (int(visor[0] * 0.8), int(visor[1] * 0.8)), tilt, 20, 160,
                (200, 140, 60), max(1, int(hr * 0.18)), cv2.LINE_AA)
    cv2.ellipse(canvas, (helmet[0] + int(hr * 0.28), helmet[1] - int(hr * 0.3)),
                (max(1, int(hr * 0.28)), max(1, int(hr * 0.12))), -35, 0, 360,
                (240, 248, 255), -1, cv2.LINE_AA)
    # Nav lights on the pack: green blinks once a second, red out of step.
    if drone.hit_at is None:
        if (now % 1.0) < 0.35:
            cv2.circle(canvas, at(-0.55, -0.62), max(2, int(s * 0.1)), NAV_GREEN, -1,
                       cv2.LINE_AA)
            _stamp(canvas, at(-0.55, -0.62), _glow_sprite(max(3, int(s * 0.3)), NAV_GREEN,
                                                           0.5, 1.5))
        if ((now + 0.5) % 1.0) < 0.35:
            cv2.circle(canvas, at(-0.55, 0.22), max(2, int(s * 0.1)), NAV_RED, -1, cv2.LINE_AA)
    else:
        # Venting: a plume from the pack that grows as it tumbles away.
        since = now - drone.hit_at
        for index in range(5):
            puff = at(-0.9 - index * 0.3 * since, -0.4 - index * 0.2)
            cv2.circle(canvas, puff, max(2, int(s * (0.1 + 0.06 * index))), (150, 150, 150),
                       -1, cv2.LINE_AA)
    if size > 22 and area is not None and drone.hit_at is None:
        _draw_tag(canvas, area, "EVA-2", (int(sx), int(sy)), size)


def _draw_tag(canvas: np.ndarray, area: Rect, text: str, anchor: tuple[int, int],
              size: float) -> None:
    """A small label on a leader line, held clear of the thing it names."""
    scale = max(0.34, min(0.5, size / 90.0))
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
    inner = _pane_inner(area)
    # Up and away from the station side, so it never sits on the figure.
    x = anchor[0] + int(size * 1.3)
    y = anchor[1] - int(size * 1.55)
    if x + tw + 14 > inner.right:
        x = anchor[0] - int(size * 1.3) - tw - 14
    y = max(inner.y + th + 8, y)
    x = max(inner.x, x)
    pill = Rect(x, y - th - 5, tw + 14, th + 10)
    _pill(canvas, pill, 0.55)
    cv2.rectangle(canvas, (pill.x, pill.y), (pill.right, pill.bottom), _tone(SPACE, TETHER, 0.7), 1)
    draw_text(canvas, text, (x + 7, y), (210, 214, 218), scale=scale, thickness=1,
              outline=False)
    elbow = (pill.x if x > anchor[0] else pill.right, pill.bottom)
    cv2.line(canvas, (anchor[0] + int(size * 0.4 * (1 if x > anchor[0] else -1)),
                      anchor[1] - int(size * 0.9)), elbow, TETHER, 1, cv2.LINE_AA)


def _pill(canvas: np.ndarray, rect: Rect, alpha: float) -> None:
    """A translucent dark rounded box under a label, so it reads over anything."""
    height, width = canvas.shape[:2]
    x0, y0 = max(0, rect.x), max(0, rect.y)
    x1, y1 = min(width, rect.right + 1), min(height, rect.bottom + 1)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    dark = roi.copy()
    radius = min(rect.height // 2, 8)
    cv2.rectangle(dark, (radius, 0), (x1 - x0 - radius, y1 - y0), (14, 12, 10), -1)
    cv2.rectangle(dark, (0, radius), (x1 - x0, y1 - y0 - radius), (14, 12, 10), -1)
    for cx in (radius, x1 - x0 - radius):
        for cy in (radius, y1 - y0 - radius):
            cv2.circle(dark, (cx, cy), radius, (14, 12, 10), -1, cv2.LINE_AA)
    cv2.addWeighted(dark, alpha, roi, 1 - alpha, 0.0, dst=roi)


def _crack_strokes(crack: Crack, layer: np.ndarray, origin: tuple[int, int]) -> None:
    """Paint one crack into the additive layer: a frosted core where the
    piece struck, thin bright fractures radiating out, and partial rings
    where the glass crazed between them."""
    shift = np.array(origin, np.int32)
    centre = (crack.x - origin[0], crack.y - origin[1])
    reach = max(crack.rings) if crack.rings else 20
    branches = [branch - shift for branch in crack.branches]
    # The radial bloom: crushed glass round the strike scatters light into a
    # wide soft disc, strongest at the core.
    _stamp(layer, centre, _glow_sprite(max(6, int(reach * 0.9)), CRACK_SOFT, 0.45, 2.2))
    # The fractures: a soft pale halo, then the bright hairline, broken into
    # short runs with gaps the way glass fractures catch the light unevenly.
    cv2.polylines(layer, branches, False, _shade(CRACK_SOFT, 0.3), 3, cv2.LINE_AA)
    for branch in branches:
        for index in range(len(branch) - 1):
            if (index + crack.x) % 3 == 2:
                continue  # a gap: this run faces away from the light
            cv2.line(layer, tuple(branch[index]), tuple(branch[index + 1]),
                     _shade(CRACK, 0.6), 1, cv2.LINE_AA)
    # The frosted core: crushed glass scatters light into a pale blob.
    core = max(2, int(reach * 0.1))
    _stamp(layer, centre, _glow_sprite(core * 4, CRACK, 0.4, 2.0))
    cv2.circle(layer, centre, core, _shade(CRACK, 0.8), -1, cv2.LINE_AA)
    cv2.circle(layer, centre, max(1, core // 2), (255, 255, 255), -1, cv2.LINE_AA)


def _crack_layer(round_: OrbitRound, shape: tuple[int, int]) -> np.ndarray | None:
    """The cracks as one additive sheet the size of the pane, rebuilt only
    when a crack is added: re-laying it is one cv2.add on the pane."""
    if not round_.cracks:
        return None
    area = round_.area
    if round_._crack_layer is None or round_._crack_layer_count != len(round_.cracks):
        layer = np.zeros((area.height, area.width, 3), np.uint8)
        for crack in round_.cracks:
            _crack_strokes(crack, layer, (area.x, area.y))
        # The glass only exists inside the frame.
        mask = np.zeros((area.height, area.width), np.uint8)
        cv2.fillPoly(mask, [_pane_polygon(Rect(0, 0, area.width, area.height),
                                          grow=-_bevel(area))], 255)
        cv2.bitwise_and(layer, layer, dst=layer, mask=mask)
        round_._crack_layer = layer
        round_._crack_layer_count = len(round_.cracks)
    return round_._crack_layer


def draw_cracks(canvas: np.ndarray, round_: OrbitRound, now: float) -> None:
    layer = _crack_layer(round_, canvas.shape[:2])
    if layer is None:
        return
    area = round_.area
    height, width = canvas.shape[:2]
    x0, y0 = max(0, area.x), max(0, area.y)
    x1, y1 = min(width, area.right), min(height, area.bottom)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    cv2.add(roi, layer[y0 - area.y:y1 - area.y, x0 - area.x:x1 - area.x], dst=roi)
    # A fresh strike: the same bloom and sparks a hit gets, in the same
    # orange, plus a white flash at the core of the glass.
    for crack in round_.cracks[-3:]:
        age = now - crack.at
        if age < 0.8:
            _draw_burst(canvas, (crack.x, crack.y), crack.at, age, SPARK, count=10, reach=60.0)
        if age < 0.5:
            fresh = 1.0 - age / 0.5
            _stamp(canvas, (crack.x, crack.y), _glow_sprite(24, CRACK, 0.8 * fresh, 1.5))


def _pane_inner(area: Rect) -> Rect:
    """The glass proper, inside the frame's bevel, where popups may sit."""
    bevel = _bevel(area)
    cut = int(area.height * 0.11)
    return Rect(area.x + bevel + cut // 2, area.y + bevel + 4,
                area.width - 2 * bevel - cut, area.height - 2 * bevel - 8)


def _popup_origin(area: Rect, centre: tuple[int, int], lift: int,
                  lines: list[tuple[str, float]]) -> tuple[int, int, int]:
    """Where a score label goes: up from the hit and outward, away from the
    middle of the pane, clear of the reticle (which sits on the hit), and
    clamped inside the glass.

    Returns the left x, the baseline y of the first line, and the line step.
    """
    widths = [cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)[0][0]
              for text, scale in lines]
    step = 20
    box_w, box_h = max(widths), step * len(lines)
    inner = _pane_inner(area)
    outward = 1 if centre[0] >= area.centre_x else -1
    x = centre[0] + 44 if outward > 0 else centre[0] - 44 - box_w
    y = centre[1] - 42 - lift
    if x + box_w > inner.right:
        x = centre[0] - 44 - box_w
    if x < inner.x:
        x = centre[0] + 44
    if y - box_h < inner.y:  # no room above: hang it below instead
        y = centre[1] + 44 + box_h + lift
    x = min(max(x, inner.x), inner.right - box_w)
    y = min(max(y, inner.y + box_h), inner.bottom)
    return x, y - box_h + step - 4, step


def _draw_burst(canvas: np.ndarray, centre: tuple[int, int], seed: float, age: float,
                color, count: int = 8, reach: float = 52.0) -> None:
    """A hit: a bright core that blows out in the first frames, a shockwave
    ring racing outward and thinning, and a handful of glowing fragments
    with blurred tails, slowing as they go and cooling as they fade."""
    life = 0.8
    if age >= life:
        return
    progress = age / life
    fade = 1.0 - progress
    # The core: white-hot, gone in a quarter second.
    if age < IMPACT_FLASH:
        flash = 1.0 - age / IMPACT_FLASH
        _stamp(canvas, centre, _glow_sprite(int(10 + 22 * (1 - flash)), color,
                                            round(flash * 10) / 10, 1.6))
        cv2.circle(canvas, centre, max(1, int(6 * flash)), (255, 255, 255), -1, cv2.LINE_AA)
    # The shockwave: a ring that grows fast, thins, and dims.
    ring = 1.0 - (1.0 - min(progress * 1.6, 1.0)) ** 2
    if ring < 1.0:
        cv2.circle(canvas, centre, int(4 + reach * 0.9 * ring), _tone(SPACE, color, 1 - ring),
                   max(1, int(3 * (1 - ring))), cv2.LINE_AA)
    # The embers, each with a tail where it was a few frames ago.
    spread = 1.0 - (1.0 - progress) ** 2
    earlier = max(0.0, 1.0 - (1.0 - max(progress - 0.12, 0.0)) ** 2)
    for index in range(count):
        angle = index * math.tau / count + seed * 7.0 + (index % 3) * 0.45
        share = 0.5 + 0.5 * ((index * 37) % 10) / 10.0
        drop = 14 * spread * spread
        head = (int(centre[0] + math.cos(angle) * reach * spread * share),
                int(centre[1] + math.sin(angle) * reach * spread * share + drop))
        tail = (int(centre[0] + math.cos(angle) * reach * earlier * share),
                int(centre[1] + math.sin(angle) * reach * earlier * share + drop * 0.7))
        tone = _tone(EMBER, color, fade)
        cv2.line(canvas, tail, head, _tone(SPACE, tone, 0.45 * fade), 2, cv2.LINE_AA)
        cv2.line(canvas, tail, head, _tone(SPACE, tone, fade), 1, cv2.LINE_AA)
        if fade > 0.3:
            cv2.circle(canvas, head, 1, (255, 255, 255) if index % 2 else tone, -1)


def draw_impact(canvas: np.ndarray, area: Rect, impact: Impact, now: float,
                ttl: float) -> None:
    age = now - impact.at
    life = max(0.0, 1.0 - age / ttl)
    if life <= 0.0:
        return
    centre = (int(impact.x), int(impact.y))
    if impact.label == "FRIENDLY":
        # The warning pulses: a ring that throbs and a label that flashes
        # between red and white, so it is not mistaken for a score.
        pulse = 0.5 + 0.5 * math.sin(age * 18.0)
        cv2.circle(canvas, centre, int(14 + 10 * pulse), WARN, 2, cv2.LINE_AA)
        cv2.circle(canvas, centre, int(10 + 40 * (1 - life)), _tone(SPACE, WARN, life), 1,
                   cv2.LINE_AA)
        lines = [("FRIENDLY", 0.7), (f"-{FRIENDLY_PENALTY}", 0.6)]
        x, y, step = _popup_origin(area, centre, 0, lines)
        width = max(cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, s, 2)[0][0] for t, s in lines)
        _pill(canvas, Rect(x - 8, y - 20, width + 16, step * 2 + 8), 0.55)
        ink = WARN if (age % 0.3) < 0.15 else (240, 240, 250)
        for text, scale in lines:
            draw_text(canvas, text, (x, y), ink, scale=scale)
            y += step
        # A warning triangle beside it.
        tx, ty = x - 22, y - step - 8
        tri = np.array([(tx, ty), (tx - 8, ty + 14), (tx + 8, ty + 14)], np.int32)
        cv2.polylines(canvas, [tri], True, ink, 2, cv2.LINE_AA)
        return
    if not impact.is_hit:
        if area.contains(*centre):
            cv2.circle(canvas, centre, int(3 + 20 * (1 - life)), (90, 90, 100), 1, cv2.LINE_AA)
        return
    _draw_burst(canvas, centre, impact.at, age, SPARK)
    # The score: one treatment everywhere - a dark pill, the number in warm
    # yellow, the word beneath in cream - rising off the hit and fading out.
    lift = int(46 * (1 - life))
    lines = [(f"+{impact.score}", 0.6)]
    if impact.label:
        lines.append((impact.label, 0.5))
    x, y, step = _popup_origin(area, centre, lift, lines)
    _popup(canvas, x, y, step, lines, min(1.0, life * 2.2))


def _popup(canvas: np.ndarray, x: int, y: int, step: int, lines: list, alpha: float) -> None:
    """A score label on its pill, blended in at ``alpha`` so it can fade."""
    width = max(cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, s, 2)[0][0] for t, s in lines)
    rect = Rect(x - 9, y - 18, width + 18, step * len(lines) + 8)
    height, full = canvas.shape[:2]
    x0, y0 = max(0, rect.x - 2), max(0, rect.y - 2)
    x1, y1 = min(full, rect.right + 3), min(height, rect.bottom + 3)
    if x1 <= x0 or y1 <= y0:
        return
    roi = canvas[y0:y1, x0:x1]
    over = roi.copy()
    _pill(over, Rect(rect.x - x0, rect.y - y0, rect.width, rect.height), 0.62)
    cv2.rectangle(over, (rect.x - x0, rect.y - y0), (rect.right - x0, rect.bottom - y0),
                  _tone((14, 12, 10), SCORE_INK, 0.35), 1, cv2.LINE_AA)
    ink = SCORE_INK
    for text, scale in lines:
        draw_text(over, text, (x - x0, y - y0), ink, scale=scale, thickness=2, outline=False)
        ink = (214, 222, 228)
        y += step
    cv2.addWeighted(over, alpha, roi, 1 - alpha, 0.0, dst=roi)


def draw_readout(canvas: np.ndarray, round_: OrbitRound, now: float) -> None:
    """Pane integrity, as a pill set into the frame's bottom rail, in the
    same dark-and-amber dress as the HUD above."""
    area = round_.area
    scale = round_.options.scale
    pill_h = max(16, int(22 * scale))
    pill = Rect(int(area.x + area.height * 0.11 + 14 * scale), area.bottom - pill_h // 2,
                int(250 * scale), pill_h)
    shade_panel(canvas, pill, pill.height // 2, (40, 38, 36), (24, 23, 22), EDGE)
    low = round_.integrity <= ALARM_INTEGRITY
    blink = low and (now % 0.8) < 0.4
    ink = WARN if blink else (200, 196, 190)
    text_y = pill.y + pill.height - max(5, int(7 * scale))
    draw_text(canvas, f"PANE {round_.integrity:3d}%", (pill.x + int(12 * scale), text_y),
              ink, scale=0.42 * scale, thickness=1, outline=False)
    # The bar: a thin accent line, the track dark behind it.
    bar_x0 = pill.x + int(92 * scale)
    bar_x1 = pill.x + int(170 * scale)
    bar_y = pill.y + pill.height // 2
    cv2.line(canvas, (bar_x0, bar_y), (bar_x1, bar_y), FRAME_DARK, max(2, int(4 * scale)),
             cv2.LINE_AA)
    filled = int((bar_x1 - bar_x0) * round_.integrity / FULL_INTEGRITY)
    if filled:
        cv2.line(canvas, (bar_x0, bar_y), (bar_x0 + filled, bar_y), WARN if low else ACCENT,
                 max(2, int(4 * scale)), cv2.LINE_AA)
    draw_text(canvas, f"{round_.cleared} CLEARED", (bar_x1 + int(12 * scale), text_y),
              (200, 196, 190), scale=0.42 * scale, thickness=1, outline=False)
    if round_.failed_at is not None:
        x = int(area.x + area.width * 0.5 - 120 * scale)
        y = int(area.y + area.height * 0.5)
        _pill(canvas, Rect(x - 24, y - int(40 * scale), int(290 * scale), int(58 * scale)), 0.7)
        draw_text(canvas, "PANE FAILED", (x, y), WARN, scale=1.3 * scale, thickness=3)


def draw_world(canvas: np.ndarray, round_: OrbitRound, now: float) -> None:
    area = round_.area
    key = (area.x, area.y, area.width, area.height)
    seed = round_.options.seed or 0
    height, width = canvas.shape[:2]
    backdrop = _backdrop(key, width, height, seed)
    canvas[:] = backdrop
    draw_stars(canvas, area, seed, now)
    draw_clouds(canvas, area, seed, now)
    draw_sun(canvas, area, now)
    _restore_truss(canvas, backdrop, key, sun_position(area, now))
    draw_array(canvas, area, now, tuple(round_.dead_cells), tuple(round_.bent_ribs))
    for x, y, at in round_.array_strikes:
        if now - at < 0.8:
            _draw_burst(canvas, (x, y), at, now - at, SPARK, count=6, reach=36.0)

    sun = sun_position(area, now)
    if round_.drone is not None:
        draw_tether(canvas, area, round_.drone, round_.view, now)
    # Painter's algorithm: the far ones first, so the near ones stand in front.
    things = [(f.pz, "fragment", f) for f in round_.targets]
    if round_.drone is not None:
        things.append((round_.drone.z, "drone", round_.drone))
    for _, kind, thing in sorted(things, key=lambda t: -t[0]):
        if kind == "drone":
            draw_drone(canvas, thing, round_.view, now, area)
        else:
            draw_fragment(canvas, thing, sun)

    # Anything that went past the pane's depth is drawn over by the frame:
    # re-lay the wall so big near fragments do not spill into the cabin.
    _relay_wall(canvas, backdrop, area)
    draw_cracks(canvas, round_, now)

    for impact in round_.impacts:
        draw_impact(canvas, area, impact, now, round_.IMPACT_TTL)

    if round_.struck_at is not None:
        flash = 1.0 - min((now - round_.struck_at) / 0.35, 1.0)
        if flash > 0:
            pane = canvas[area.y:area.bottom, area.x:area.right]
            cv2.addWeighted(pane, 1 - 0.35 * flash, np.full_like(pane, 255), 0.35 * flash,
                            0.0, dst=pane)
    draw_readout(canvas, round_, now)
    if round_.aim is not None:
        draw_reticle_glow(canvas, round_.aim, round_.options.scale)


def draw_reticle_glow(canvas: np.ndarray, aim: tuple[float, float], scale: float) -> None:
    """What sits under the crosshair: a soft cream glow and a hairline outer
    ring, so the reticle the game lays on top reads as a lit HUD element
    rather than a flat drawing."""
    height, width = canvas.shape[:2]
    centre = (int(aim[0] * (width - 1)), int(aim[1] * (height - 1)))
    _stamp(canvas, centre, _glow_sprite(max(8, int(36 * scale)), RETICLE_GLOW, 0.32, 2.0))
    cv2.circle(canvas, centre, max(4, int(38 * scale)), _tone(SPACE, RETICLE_RING, 0.55), 1,
               cv2.LINE_AA)
    cv2.circle(canvas, centre, max(2, int(6 * scale)), _tone(SPACE, RETICLE_RING, 0.35), 1,
               cv2.LINE_AA)


@lru_cache(maxsize=6)
def _truss_mask(area: tuple, width: int, height: int) -> np.ndarray:
    probe = np.zeros((height, width, 3), np.uint8)
    _draw_truss(probe, Rect(*area))
    return probe.any(axis=2)


def _restore_truss(canvas: np.ndarray, backdrop: np.ndarray, key: tuple,
                   sun: tuple[float, float]) -> None:
    """Put the truss back in front of the sun's glare, near the sun only."""
    height, width = canvas.shape[:2]
    reach = int(key[3] * 0.035 * 8)
    x0, x1 = max(0, int(sun[0]) - reach), min(width, int(sun[0]) + reach)
    y0, y1 = max(0, int(sun[1]) - reach), min(height, int(sun[1]) + reach)
    if x1 <= x0 or y1 <= y0:
        return
    mask = _truss_mask(key, width, height)[y0:y1, x0:x1]
    roi = canvas[y0:y1, x0:x1]
    roi[mask] = backdrop[y0:y1, x0:x1][mask]


@lru_cache(maxsize=6)
def _wall_mask(area: tuple, width: int, height: int) -> np.ndarray:
    """Boolean: pixels that belong to the cabin, not the view outside."""
    mask = np.full((height, width), 255, np.uint8)
    cv2.fillPoly(mask, [_pane_polygon(Rect(*area), grow=-_bevel(Rect(*area)))], 0)
    return mask > 0


def _relay_wall(canvas: np.ndarray, backdrop: np.ndarray, area: Rect) -> None:
    """Put the cabin back over anything drawn past the glass.

    Four band copies for the bulk of it, and a masked copy only in the small
    squares where the corners are cut: masking the whole frame costs more than
    everything else put together.
    """
    height, width = canvas.shape[:2]
    bevel = _bevel(area)
    x0, y0 = max(0, area.x + bevel), max(0, area.y + bevel)
    x1, y1 = min(width, area.right - bevel), min(height, area.bottom - bevel)
    canvas[:y0] = backdrop[:y0]
    canvas[y1:] = backdrop[y1:]
    canvas[y0:y1, :x0] = backdrop[y0:y1, :x0]
    canvas[y0:y1, x1:] = backdrop[y0:y1, x1:]
    mask = _wall_mask((area.x, area.y, area.width, area.height), width, height)
    corner = int(area.height * 0.11) + 2
    for cx, cy in ((x0, y0), (x1 - corner, y0), (x0, y1 - corner), (x1 - corner, y1 - corner)):
        roi = (slice(cy, cy + corner), slice(cx, cx + corner))
        patch = mask[roi]
        canvas[roi][patch] = backdrop[roi][patch]


def draw_hud(canvas: np.ndarray, round_: OrbitRound, origin: tuple[int, int],
             now: float) -> None:
    """Optional extra HUD: the readout already lives on the frame."""


def draw_emblem(panel: np.ndarray) -> None:
    """The card art, composed as a poster: the array sweeping in from the
    foreground, debris tumbling through the middle distance, the drone on
    its line, and the sun's glint on the sea behind them all."""
    height, width = panel.shape[:2]
    area = Rect(0, 0, width, height)
    view = Projection.for_area(area)
    panel[:] = _backdrop((0, 0, width, height), width, height, 3, False)
    draw_stars(panel, area, 3, 12.0)
    draw_clouds(panel, area, 3, 4.0)
    draw_sun(panel, area, 20.0)
    sun = sun_position(area, 20.0)

    # The drone, on a line back to the array's root.
    drone = Drone(x=0.55, y=-0.2, z=DRONE_DEPTH * 1.3, vx=-0.3, launched_at=0.0)
    sx, sy = view.screen(*drone.position(0.2))
    size = drone.radius_px(view)
    root = (int(width * 0.92), int(height * 1.1))
    sag = (0.5 * (root[0] + sx), 0.5 * (root[1] + sy) + height * 0.12)
    points = [(int((1 - t) ** 2 * root[0] + 2 * (1 - t) * t * sag[0] + t * t * (sx + size * 0.5)),
               int((1 - t) ** 2 * root[1] + 2 * (1 - t) * t * sag[1] + t * t * (sy + size * 0.3)))
              for t in np.linspace(0, 1, 17)]
    cv2.polylines(panel, [np.array(points, np.int32)], False, TETHER, 1, cv2.LINE_AA)
    draw_drone(panel, drone, view, 0.2)

    # Debris in the middle distance, three materials, lit from the disc.
    rng = np.random.default_rng(5)
    for x, y, z, radius, material in ((-0.95, -0.35, 3.2, 0.34, 0), (-0.3, -0.45, 6.5, 0.5, 2),
                                      (-0.35, -0.05, 12.0, 0.55, 1), (0.7, -0.75, 18.0, 0.6, 0),
                                      (-1.5, 0.3, 2.6, 0.2, 1)):
        count = 8
        draw_fragment(panel, Fragment(
            view=view, px=x, py=y, pz=z, vx=0.3, vy=0.1, vz=-4, radius=radius,
            angle=float(rng.uniform(0, 6)), spin=1.0, material=material,
            shape=tuple(rng.uniform(0.5, 1.0, count)),
            offsets=tuple(rng.uniform(-0.3, 0.3, count))), sun)

    # The array, big, sweeping in from the bottom right corner in front of
    # everything, on its arm.
    w, h = width, height
    corners = np.array([(w * 0.62, h * 1.05), (w * 1.08, h * 0.62), (w * 0.98, h * 0.35),
                        (w * 0.52, h * 0.78)], np.int32)
    cv2.line(panel, (int(w * 0.75), int(h * 0.72)), (int(w * 0.9), int(h * 1.1)),
             STRUT, max(2, int(h * 0.02)), cv2.LINE_AA)
    cv2.line(panel, (int(w * 0.75), int(h * 0.72)), (int(w * 0.9), int(h * 1.1)),
             KEY_LIGHT, 1, cv2.LINE_AA)
    _draw_solar_panel(panel, corners, sun, rows=2, cols=5, dead=((1, 3),))

    # The title, set small in the lower left with a rule, the way a poster
    # carries its name.
    scale = max(0.4, h / 240.0)
    x0, y0 = int(w * 0.14), int(h * 0.3)
    draw_text(panel, "ORBITAL", (x0, y0), (240, 240, 244), scale=scale, thickness=1)
    draw_text(panel, "DECAY", (x0, int(y0 + 30 * scale)), (240, 240, 244), scale=scale,
              thickness=1)
    cv2.line(panel, (x0, int(y0 + 8 * scale)), (x0 + int(w * 0.17), int(y0 + 8 * scale)),
             ACCENT, 1, cv2.LINE_AA)
