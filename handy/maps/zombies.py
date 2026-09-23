"""Dead of night: a road out of the fog, and things walking up it.

The map is built on a real pinhole projection rather than sprites scaled by
taste, so distance behaves the way distance does - a walker forty metres out is a
grey smudge worth aiming carefully at, and one at three metres fills the screen
and is about to reach you. Every figure is drawn from the same measurements the
shot is tested against, so what you see is exactly what you can hit.

The road, the treeline and the moon are painted once per window size into a
cached backdrop; each frame copies that and draws only what moves - the fog
rolling along the horizon, the rain, the walkers, what is left of the ones that
fell - so the whole picture stays well inside the per-frame budget.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import cv2
import numpy as np

from ..game import MISS, Hit, Impact, Rect, Round
from ..scene import blend, draw_text

# --- the world --------------------------------------------------------------

EYE_HEIGHT = 1.62  # metres; the player is standing
WALKER_HEIGHT = 1.78
SPAWN_DISTANCE = (9.5, 14.5)
CONTACT_DISTANCE = 1.5  # metres: close enough to reach you
NEAR_PLANE = 2.0

BITE_DAMAGE = 18
FULL_HEALTH = 100
LOW_HEALTH = BITE_DAMAGE * 2  # where the heartbeat starts

WAVE_SECONDS = 15.0
MAX_WALKERS = 9

# Scoring
HEADSHOT_POINTS = 100
KILL_POINTS = 40
WOUND_POINTS = 8
BODY_HEALTH = 3

# Palette, BGR. Everything is cold except the blood and the muzzle flash.
SKY_TOP = (14, 9, 6)
SKY_HORIZON = (56, 47, 38)
FOG = (78, 72, 64)
GROUND_FAR = (44, 42, 38)
VERGE = (24, 28, 26)
SHOULDER = (50, 47, 44)
ASPHALT = (38, 34, 31)  # wet tar, blue-grey under the moon
ROAD_LINE = (150, 148, 138)
POST = (11, 11, 12)
TREE = (9, 9, 10)
RAGS = (22, 20, 22)  # what is left of the clothes: near-black, a touch cold
SHADE = (8, 7, 8)  # the side of a walker away from the moon
SKIN = (58, 60, 66)  # dead flesh: a dark core, only a shade paler than the rags
MOONLIGHT = (206, 198, 184)
RIM = (236, 214, 150)  # the cold cyan edge the moon puts on skull and shoulders
EYESHINE = (200, 240, 224)
FLASH = (70, 140, 236)  # the muzzle: warm, the only warm light on the road
FLASH_GLOW = (40, 90, 200)
BLOOD = (18, 12, 72)  # maroon, almost black in the dark
BLOOD_FRESH = (26, 22, 128)
STAIN = (10, 8, 34)
GLOSS = (150, 146, 136)  # the moon on a wet pool
SCORE_INK = (72, 166, 240)  # the HUD's amber, for the points
TAG_INK = (120, 196, 244)  # a paler amber for the word
POPUP_POP = 0.07  # seconds the popup lands oversized, two frames at thirty
SPECULAR = (224, 216, 200)  # the moon in the wet of the road

STAIN_LIMIT = 90
IMPACT_FLASH = 0.3
MUZZLE_FLASH = 0.08  # seconds the shot lights the road


@dataclass(frozen=True)
class Perspective:
    """Ground-plane projection: metres in, pixels out."""

    area: Rect
    horizon: float
    focal: float

    @classmethod
    def for_area(cls, area: Rect, horizon_fraction: float = 0.30) -> "Perspective":
        horizon = area.y + horizon_fraction * area.height
        # Fix the focal length so a walker at the near plane stands on the
        # bottom edge of the play area.
        focal = (area.bottom - horizon) * NEAR_PLANE / EYE_HEIGHT
        return cls(area=area, horizon=horizon, focal=focal)

    def ground_y(self, distance: float) -> float:
        return self.horizon + self.focal * EYE_HEIGHT / max(distance, 0.4)

    def screen_x(self, lane: float, distance: float) -> float:
        return self.area.centre_x + self.focal * lane / max(distance, 0.4)

    def height_px(self, distance: float, metres: float = WALKER_HEIGHT) -> float:
        return self.focal * metres / max(distance, 0.4)

    def ground_point(self, lane: float, distance: float) -> tuple[int, int]:
        return int(self.screen_x(lane, distance)), int(self.ground_y(distance))


@dataclass(frozen=True)
class Figure:
    """Where every part of a walker is on screen, this frame.

    Drawing and hit-testing both read this, so the silhouette and the hitbox can
    never drift apart.
    """

    x: float
    ground_y: float
    height: float
    lean: float
    fog: float
    head: tuple[float, float]
    head_radius: float
    shoulder_y: float
    hip_y: float
    half_shoulder: float
    phase: float = 0.0  # gait, driving the stride and the arm swing
    hunch: float = 0.0
    tilt: float = 0.0
    gait: str = "shamble"
    seed: int = 0  # which rags it wears

    def hit_zone(self, x: float, y: float) -> str | None:
        """"head", "body", or None. The head is small and worth the trouble."""
        if math.hypot(x - self.head[0], y - self.head[1]) <= self.head_radius * 1.2:
            return "head"
        # The body box is widened to take in the reaching arms.
        if (abs(x - self.x) <= self.half_shoulder * 1.45
                and self.shoulder_y - self.head_radius <= y <= self.ground_y):
            return "body"
        return None


@dataclass
class Walker:
    """One of them."""

    lane: float  # metres left or right of dead ahead
    distance: float
    speed: float
    phase: float
    sway: float
    build: float
    hunch: float = 0.0  # how far the shoulders lead the hips
    tilt: float = 0.0  # head cocked, in degrees
    health: int = BODY_HEALTH
    staggered_until: float = 0.0
    gait: str = "shamble"
    seed: int = 0

    def advance(self, dt: float, now: float) -> None:
        pace = self.speed * (0.25 if now < self.staggered_until else 1.0)
        self.distance = max(0.0, self.distance - pace * dt)
        self.phase += dt * (2.2 + self.speed)
        # They weave as they shamble, but they are coming for you: the lane
        # closes as the distance does.
        self.lane += math.sin(self.phase * 0.5) * self.sway * dt
        self.lane -= self.lane * 0.14 * dt

    def figure(self, view: Perspective, now: float) -> Figure:
        height = view.height_px(self.distance) * self.build
        ground_y = view.ground_y(self.distance)
        fog = min(max((self.distance - 5.0) / 26.0, 0.0), 0.86)
        lurch = math.sin(self.phase) * 0.035
        if self.gait == "lurch":
            lurch = math.sin(self.phase) * 0.06
        if now < self.staggered_until:
            lurch += 0.09  # knocked off balance by the last round
        x = view.screen_x(self.lane, self.distance) + lurch * height

        if self.gait == "crawl":
            # On its hands, dragging itself up the road: low, wide, head first.
            return Figure(
                x=x, ground_y=ground_y, height=height, lean=lurch, fog=fog,
                hunch=self.hunch, tilt=self.tilt,
                head=(x + lurch * height * 0.3, ground_y - height * 0.23),
                head_radius=height * 0.074,
                shoulder_y=ground_y - height * 0.36,
                hip_y=ground_y - height * 0.44,
                half_shoulder=height * 0.20,
                phase=self.phase, gait=self.gait, seed=self.seed)

        drop = 0.0
        if self.gait == "limp":
            drop = abs(math.sin(self.phase * 0.5)) * 0.035  # the bad leg gives
        elif self.gait == "lurch":
            drop = 0.045  # bent forward, head thrust out
        head_radius = height * 0.076
        return Figure(
            x=x,
            ground_y=ground_y,
            height=height,
            lean=lurch,
            fog=fog,
            hunch=self.hunch,
            tilt=self.tilt,
            head=(x + lurch * height * 0.6 + (height * 0.06 if self.gait == "lurch"
                                               else 0.0),
                  ground_y - height * (0.905 - drop)),
            head_radius=head_radius,
            shoulder_y=ground_y - height * (0.79 - drop),
            hip_y=ground_y - height * 0.47,
            half_shoulder=height * 0.15,
            phase=self.phase,
            gait=self.gait,
            seed=self.seed,
        )


@dataclass
class ZombieRound(Round):
    """Hold the road until dawn. They do not stop coming."""

    walkers: list[Walker] = field(default_factory=list, init=False)
    #: Where each one fell: x, y, size, when, and which way it landed.
    stains: list[tuple[float, float, float, float, int]] = field(
        default_factory=list, init=False)
    health: int = field(default=FULL_HEALTH, init=False)
    kills: int = field(default=0, init=False)
    bitten_at: float | None = field(default=None, init=False)
    _next_spawn: float = field(default=0.0, init=False, repr=False)
    _last_tick: float | None = field(default=None, init=False, repr=False)

    IMPACT_TTL = 1.1
    PERFECT_LABEL = "headshots"

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.options.enemy not in ("zombies", "robots"):
            raise ValueError("enemy must be zombies or robots")
        self.view = Perspective.for_area(self.options.area)
        self.skyline = _skyline(self.options.area, self.options.seed or 0)

    # --- rules -------------------------------------------------------------

    @property
    def is_lost(self) -> bool:
        return self.health <= 0

    def outcome(self) -> str:
        return "OVERRUN" if self.is_lost else "SURVIVED"

    def won(self) -> bool:
        return not self.is_lost

    def wave(self, now: float) -> int:
        return int(self.elapsed(now) // WAVE_SECONDS) + 1

    def last_shot(self) -> float | None:
        return max((impact.at for impact in self.impacts), default=None)

    def advance(self, now: float) -> None:
        dt = 0.0 if self._last_tick is None else min(now - self._last_tick, 0.25)
        self._last_tick = now
        wave = self.wave(now)

        for walker in self.walkers:
            walker.advance(dt, now)

        reached = [w for w in self.walkers if w.distance <= CONTACT_DISTANCE]
        for walker in reached:
            # It gets a hand on you, you shove it off, it costs you.
            self.health = max(0, self.health - BITE_DAMAGE)
            self.bitten_at = now
            self.cues.append("hurt")
            self.walkers.remove(walker)

        allowed = min(self.options.density + wave - 1, MAX_WALKERS)
        gap = max(self.options.spawn_interval * 0.82 ** (wave - 1), 0.45)
        if len(self.walkers) < allowed and now >= self._next_spawn:
            # The night opens with a few of them already on the road; after
            # that they come one at a time, on the clock.
            first = self._next_spawn == 0.0 and not self.walkers
            for _ in range(min(3, allowed) if first else 1):
                self.walkers.append(self._spawn(wave))
            self.cues.append("static" if self.options.enemy == "robots" else "groan")
            self._next_spawn = now + gap

    def resolve(self, x: float, y: float, now: float) -> Hit:
        """Nearest walker whose silhouette contains the shot takes it."""
        struck: Walker | None = None
        zone = None
        for walker in sorted(self.walkers, key=lambda w: w.distance):
            found = walker.figure(self.view, now).hit_zone(x, y)
            if found is not None:
                struck, zone = walker, found
                break
        if struck is None:
            return MISS

        # Further away is worth more: it is a harder shot and buys more time.
        bonus = 1.0 + min(struck.distance / 22.0, 1.0)
        if zone == "head":
            self._kill(struck, now)
            return Hit(points=int(HEADSHOT_POINTS * bonus), ring=0,
                       label="HEADSHOT", perfect=True)

        struck.health -= 1
        struck.staggered_until = now + 0.45
        if struck.health <= 0:
            self._kill(struck, now)
            return Hit(points=int(KILL_POINTS * bonus), ring=1, label="DOWN")
        return Hit(points=WOUND_POINTS, ring=2)

    def _kill(self, walker: Walker, now: float) -> None:
        self.walkers.remove(walker)
        self.kills += 1
        if self.options.enemy == "robots":
            return
        figure = walker.figure(self.view, now)
        self.stains.append((figure.x, figure.ground_y, figure.height * 0.18, now,
                            walker.seed))
        del self.stains[:-STAIN_LIMIT]

    def _spawn(self, wave: int) -> Walker:
        pace = 1.0 + 0.12 * (wave - 1)
        # Each wave they start closer: less road to cross, less time to aim.
        near = max(SPAWN_DISTANCE[0] - 1.2 * (wave - 1), 5.5)
        far = max(SPAWN_DISTANCE[1] - 1.6 * (wave - 1), 9.5)
        roll = self.rng.random()
        crawl = min(0.10 + 0.04 * wave, 0.30)
        if roll < crawl:
            gait = "crawl"
        elif roll < crawl + 0.22:
            gait = "limp"
        elif roll < crawl + 0.47:
            gait = "lurch"
        else:
            gait = "shamble"
        if self.options.enemy == "robots":
            gait = "shamble"
        speed = self.rng.uniform(0.55, 0.95) * pace
        if gait == "crawl":
            speed *= 0.7
        elif gait == "limp":
            speed *= 0.85
        return Walker(
            lane=self.rng.uniform(-7.0, 7.0),
            distance=self.rng.uniform(near, far),
            speed=speed,
            phase=self.rng.uniform(0.0, math.tau),
            sway=self.rng.uniform(0.15, 0.45),
            build=self.rng.uniform(0.92, 1.08),
            hunch=self.rng.uniform(-0.9, 0.9),
            tilt=self.rng.uniform(-26.0, 26.0),
            gait=gait,
            seed=self.rng.randrange(1 << 16),
        )


# --- the backdrop -----------------------------------------------------------

def _fogged(color: tuple[int, int, int], fog: float) -> tuple[int, int, int]:
    return tuple(int(c + (f - c) * fog) for c, f in zip(color, FOG))


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def _skyline(area: Rect, seed: int) -> tuple[tuple[int, int], ...]:
    """A ragged treeline along the horizon, fixed for the whole round."""
    rng = np.random.default_rng(seed)
    horizon = int(Perspective.for_area(area).horizon)
    points = [(0, horizon + 4)]
    x = 0
    while x < area.width + 40:
        x += int(rng.integers(24, 70))
        points.append((x, horizon - int(rng.integers(4, 46))))
    points.append((x, horizon + 4))
    return tuple(points)


ROAD_HALF_WIDTH = 3.4  # metres, from the centre line to the verge
POST_SPACING = (7.0, 11.0, 16.0, 22.0, 30.0, 40.0, 54.0, 72.0)
LANE_EXTENT = 12.0  # metres either side covered by the ground texture
TEXTURE_NEAR, TEXTURE_FAR = 1.2, 140.0
TEXTURE_SIZE = (1536, 1536)  # columns across the lanes, rows along the distance


def _road_texture(seed: int) -> np.ndarray:
    """The ground in its own coordinates: lanes across, log-distance down.

    Painted flat, then bent onto the screen through the projection, so every
    crack, patch and painted dash converges the way the real thing does.
    """
    width, height = TEXTURE_SIZE
    rng = np.random.default_rng(seed + 11)
    span = math.log(TEXTURE_FAR / TEXTURE_NEAR)

    def column(lane: float) -> int:
        return int((lane / LANE_EXTENT + 1.0) * 0.5 * (width - 1))

    def row(distance: float) -> int:
        return int(math.log(max(distance, TEXTURE_NEAR) / TEXTURE_NEAR) / span
                   * (height - 1))

    lanes = (np.arange(width) / (width - 1) * 2.0 - 1.0) * LANE_EXTENT
    on_road = np.abs(lanes) <= ROAD_HALF_WIDTH
    on_shoulder = (~on_road) & (np.abs(lanes) <= ROAD_HALF_WIDTH + 0.9)

    # Base coat: verge, gravel shoulder, asphalt.
    base = np.empty((height, width, 3), np.float32)
    base[:] = VERGE
    base[:, on_shoulder] = SHOULDER
    base[:, on_road] = ASPHALT

    # Grain at two scales; the verge is rougher than the road.
    fine = rng.normal(0, 1, (height, width)).astype(np.float32)
    coarse = cv2.resize(rng.normal(0, 1, (height // 8, width // 8)).astype(np.float32),
                        (width, height), interpolation=cv2.INTER_CUBIC)
    grain = np.where(on_road[None, :], fine * 5 + coarse * 6, fine * 9 + coarse * 10)
    base += grain[:, :, None]

    # Wheel tracks, worn a shade lighter; the crown between them stays dark.
    for track in (-2.3, -1.0, 1.0, 2.3):
        base[:, on_road] += (7.0 * np.exp(-((lanes[on_road] - track) / 0.45) ** 2))[None, :, None]

    canvas = np.clip(base, 0, 255).astype(np.uint8)

    # Repairs: darker patches with a lighter seam of tar around them.
    for _ in range(7):
        lane = rng.uniform(-ROAD_HALF_WIDTH + 0.6, ROAD_HALF_WIDTH - 0.6)
        distance = TEXTURE_NEAR * math.exp(rng.uniform(0.3, 0.85) * span)
        x0, x1 = column(lane - rng.uniform(0.4, 1.1)), column(lane + rng.uniform(0.4, 1.1))
        y0, y1 = row(distance), row(distance * rng.uniform(1.04, 1.2))
        cv2.rectangle(canvas, (x0, y0), (x1, y1), (31, 28, 25), -1)
        cv2.rectangle(canvas, (x0, y0), (x1, y1), (52, 48, 43), 2)

    # Cracks: wandering dark lines, each with a pale lip where the edge catches
    # the moon. More of them out at the edges, where a road goes first.
    for _ in range(140):
        edge = rng.random() < 0.6
        lane = (rng.choice((-1, 1)) * rng.uniform(2.0, ROAD_HALF_WIDTH - 0.1) if edge
                else rng.uniform(-2.0, 2.0))
        x, y = column(lane), int(rng.uniform(height * 0.1, height * 0.97))
        points = [(x, y)]
        for _ in range(int(rng.integers(3, 8))):
            x += int(rng.integers(-9, 10))
            y += int(rng.integers(-14, 15))
            points.append((x, y))
        crack = np.array(points, np.int32)
        cv2.polylines(canvas, [crack + (0, 1)], False, (58, 53, 47), 1, cv2.LINE_AA)
        cv2.polylines(canvas, [crack], False, (18, 16, 15), 1, cv2.LINE_AA)

    for _ in range(5):  # potholes
        centre = (column(rng.uniform(-2.8, 2.8)),
                  int(rng.uniform(height * 0.2, height * 0.9)))
        axes = (int(rng.uniform(10, 28)), int(rng.uniform(8, 18)))
        cv2.ellipse(canvas, centre, axes, 0, 0, 360, (54, 50, 45), 2, cv2.LINE_AA)
        cv2.ellipse(canvas, centre, axes, 0, 0, 360, (14, 13, 12), -1, cv2.LINE_AA)

    # Paint: a dashed centre line and solid edge lines, chipped and faded.
    paint = np.zeros((height, width), np.uint8)
    distance = TEXTURE_NEAR
    while distance < TEXTURE_FAR:
        cv2.rectangle(paint, (column(-0.09), row(distance)),
                      (column(0.09), row(distance + 3.0)), 255, -1)
        distance += 9.0
    for side in (-1, 1):
        lane = side * (ROAD_HALF_WIDTH - 0.3)
        cv2.rectangle(paint, (column(lane - 0.07), 0), (column(lane + 0.07), height), 255,
                      -1)
    wear = cv2.GaussianBlur(rng.random((height, width)).astype(np.float32), (0, 0), 2.5)
    wear = np.clip((wear - 0.42) * 6.0, 0.0, 1.0)
    alpha = (paint / 255.0) * (0.35 + 0.65 * wear)
    line_colour = np.array(ROAD_LINE, np.float32)
    canvas = (canvas * (1 - alpha[:, :, None]) + line_colour * alpha[:, :, None])
    canvas = canvas.astype(np.uint8)

    # The far rows land on a handful of screen pixels; soften them first so the
    # distance does not shimmer.
    for start, sigma in ((int(height * 0.45), 1.2), (int(height * 0.65), 2.5),
                         (int(height * 0.8), 4.5)):
        canvas[start:] = cv2.GaussianBlur(canvas[start:], (0, 0), sigma)
    near = int(height * 0.3)  # magnified most on screen: keep the grain from blocking up
    canvas[:near] = cv2.GaussianBlur(canvas[:near], (0, 0), 1.1)
    return canvas


def _lay_ground(canvas: np.ndarray, view: Perspective, seed: int) -> None:
    """Bend the flat texture onto the ground plane through the projection."""
    height, width = canvas.shape[:2]
    horizon = int(view.horizon)
    rows = np.arange(horizon + 1, height, dtype=np.float32)
    distance = view.focal * EYE_HEIGHT / (rows - view.horizon)
    columns = np.arange(width, dtype=np.float32)
    lane = (columns[None, :] - view.area.centre_x) * (distance[:, None] / view.focal)
    tex_w, tex_h = TEXTURE_SIZE
    map_x = ((lane / LANE_EXTENT + 1.0) * 0.5 * (tex_w - 1)).astype(np.float32)
    span = math.log(TEXTURE_FAR / TEXTURE_NEAR)
    v = np.log(np.clip(distance, TEXTURE_NEAR, TEXTURE_FAR) / TEXTURE_NEAR) / span
    map_y = np.repeat((v * (tex_h - 1)).astype(np.float32)[:, None], width, axis=1)
    ground = cv2.remap(_road_texture(seed), map_x, map_y, cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=VERGE)

    # Distance fog on the ground, and the moon catching the wet crown of the road.
    fog = np.clip((distance - 4.0) / 70.0, 0.0, 0.82).astype(np.float32)
    moon_x = width * 0.76
    # The moon's reflection: a column of light under the moon, broken into
    # vertical streaks by the ripples and the camber, brightest near the
    # horizon and thinning as the road comes towards you. Wet tar reflects
    # the sky too, so the whole road lifts a little towards a cold blue.
    rng = np.random.default_rng(seed + 29)
    streak = cv2.GaussianBlur(rng.random((1, width)).astype(np.float32), (0, 0), 1.6)
    streak = np.clip((streak - 0.35) * 2.4, 0.0, 1.0)[0]
    sheen = np.exp(-((columns - moon_x) / (width * 0.075)) ** 2).astype(np.float32)
    sheen = sheen * (0.35 + 0.65 * streak)
    tall = np.clip(1.0 - (rows[:, None] - horizon) / (height * 0.6), 0, 1) ** 1.4
    sheen = sheen[None, :] * tall
    on_road = (np.abs(lane) <= ROAD_HALF_WIDTH).astype(np.float32)
    wet = np.abs(lane) <= ROAD_HALF_WIDTH + 0.9
    light = (sheen * on_road * 0.34)[:, :, None]
    ground = ground.astype(np.float32)
    ground[wet] += np.float32((9.0, 4.0, 0.0))
    ground = ground * (1 - fog[:, None, None]) + np.float32(FOG) * fog[:, None, None]
    ground = ground * (1 - light) + np.float32(SPECULAR) * light
    canvas[horizon + 1:] = np.clip(ground, 0, 255).astype(np.uint8)


def _draw_tree(canvas: np.ndarray, base: tuple[int, int], height: float,
               color, kind: int, rng: np.random.Generator) -> None:
    """One tree, drawn to a height in pixels: a conifer, a dead hardwood, or scrub."""
    x, y = base
    if height < 3:
        return
    if kind == 0:  # conifer: stacked ragged triangles
        trunk = max(1, int(height * 0.03))
        cv2.line(canvas, (x, y), (x, int(y - height * 0.3)), color, trunk, cv2.LINE_AA)
        tiers = 3
        for tier in range(tiers):
            top = y - height * (1.0 - tier * 0.22)
            bottom = y - height * (0.62 - tier * 0.22)
            half = height * (0.16 + tier * 0.08) * rng.uniform(0.85, 1.15)
            points = [(x, top)]
            steps = 4
            for step in range(1, steps + 1):
                t = step / steps
                points.append((x + half * t * rng.uniform(0.8, 1.1),
                               top + (bottom - top) * t))
            for step in range(steps, 0, -1):
                t = step / steps
                points.append((x - half * t * rng.uniform(0.8, 1.1),
                               top + (bottom - top) * t))
            cv2.fillPoly(canvas, [np.array(points, np.int32)], color, cv2.LINE_AA)
    elif kind == 1:  # dead hardwood: a trunk and a few forks of bare branches
        def branch(start, angle, length, depth, thickness):
            end = (start[0] + math.cos(angle) * length, start[1] - math.sin(angle) * length)
            cv2.line(canvas, (int(start[0]), int(start[1])), (int(end[0]), int(end[1])),
                     color, max(1, int(thickness)), cv2.LINE_AA)
            if depth == 0 or length < 3:
                return
            for sign in (-1, 1):
                branch(end, angle + sign * rng.uniform(0.3, 0.8),
                       length * rng.uniform(0.5, 0.72), depth - 1, thickness * 0.6)
        branch((x, y), math.pi / 2 + rng.uniform(-0.1, 0.1), height * 0.45, 3,
               height * 0.035)
    else:  # scrub: a low jagged tuft of dead grass
        points = [(x - height * 0.7, y + 1)]
        for step in range(12):
            t = step / 11
            points.append((x - height * 0.7 + height * 1.4 * t,
                           y - height * rng.uniform(0.15, 1.0) * math.sin(t * math.pi)))
        points.append((x + height * 0.7, y + 1))
        cv2.fillPoly(canvas, [np.array(points, np.int32)], color, cv2.LINE_AA)


def _draw_moon(canvas: np.ndarray, centre: tuple[int, int], disc: int,
               rng: np.random.Generator) -> None:
    """A gibbous moon: a soft-edged disc, maria as a slow gradient across it,
    the limb darkening a little towards the lower left, and a tight halo."""
    reach = int(disc * 3.6)
    x0, y0 = centre[0] - reach, centre[1] - reach
    x1, y1 = centre[0] + reach + 1, centre[1] + reach + 1
    height, width = canvas.shape[:2]
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height or disc < 2:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx, dy = (xs - centre[0]).astype(np.float32), (ys - centre[1]).astype(np.float32)
    r = np.sqrt(dx * dx + dy * dy) / disc
    # The disc with a one-pixel-soft edge, and a halo the haze carries outwards.
    body = np.clip((1.0 - r) * disc * 0.9 + 0.5, 0.0, 1.0)
    # Two halos: a tight bright one at the limb, and a wide soft bloom the
    # haze carries a long way, so the disc never ends in a hard edge.
    halo = (np.exp(-((r - 1.0) / 0.45) ** 2) * 0.62
            + np.exp(-((r - 1.0) / 1.6) ** 2) * 0.28) * (r > 1.0)
    # Maria: low-frequency mottling, darkest in a band across the upper left.
    mottle = cv2.resize(rng.random((5, 5)).astype(np.float32), (x1 - x0, y1 - y0),
                        interpolation=cv2.INTER_CUBIC)
    mottle = (mottle - 0.5) * 0.22 + np.exp(-(((dx + disc * 0.25) ** 2
                                              + (dy + disc * 0.15) ** 2)
                                             / (disc * 0.65) ** 2)) * -0.14
    # Limb darkening and a terminator: the lower-left edge of the disc is in shade.
    shade = np.clip(0.55 + 0.45 * (0.5 + (dx - dy) / (2.2 * disc)), 0.0, 1.0)
    tone = np.clip(1.0 + mottle, 0.0, 1.0) * shade * np.clip(1.0 - r * r * 0.18, 0.0, 1.0)
    patch = canvas[y0:y1, x0:x1].astype(np.float32)
    moon_colour = np.float32((246, 246, 240))
    halo_colour = np.float32(MOONLIGHT)
    patch = patch * (1 - halo[:, :, None]) + halo_colour * halo[:, :, None]
    lit = moon_colour * (0.66 + 0.34 * tone)[:, :, None]
    patch = patch * (1 - body[:, :, None]) + lit * body[:, :, None]
    canvas[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)


@lru_cache(maxsize=6)
def _environment(area: tuple, width: int, height: int, seed: int,
                 skyline: tuple) -> np.ndarray:
    """The static road, treeline, moon and roadside. Built once, copied each frame."""
    view = Perspective.for_area(Rect(*area))
    horizon = int(view.horizon)
    rng = np.random.default_rng(seed + 3)
    canvas = np.zeros((height, width, 3), np.uint8)
    canvas[:horizon] = np.linspace(SKY_TOP, SKY_HORIZON, horizon)[:, None, :]
    canvas[horizon:] = GROUND_FAR

    # Stars, thinning towards the haze at the horizon.
    for _ in range(160):
        x, y = int(rng.uniform(0, width)), int(rng.uniform(0, horizon * 0.85))
        bright = rng.uniform(0.2, 1.0) * (1.0 - y / max(horizon, 1)) ** 0.5
        tone = int(60 + 150 * bright)
        canvas[y, x] = (tone, tone - 6, tone - 14)

    # Cloud: a slow smear of lighter haze across the upper sky.
    cloud = cv2.resize(rng.random((4, 9)).astype(np.float32), (width, max(horizon, 1)),
                       interpolation=cv2.INTER_CUBIC)
    cloud = np.clip((cloud - 0.45) * 1.2, 0, 1) * np.linspace(0.3, 0.0, max(horizon, 1))[:, None]
    sky = canvas[:horizon].astype(np.float32)
    canvas[:horizon] = (sky * (1 - cloud[:, :, None])
                        + np.float32(FOG) * cloud[:, :, None]).astype(np.uint8)

    # Moon: a hard disc inside a bloom the haze carries a long way.
    moon = (int(width * 0.76), int(horizon - height * 0.17))
    glow = np.zeros((height, width, 3), np.uint8)
    # The radii double as blur sigmas, and a GaussianBlur of sigma 0 with no
    # kernel size to fall back on is an assertion failure, not a no-op. On the
    # chooser card this environment is drawn a couple of dozen pixels tall, and
    # the tightest of the three rounds to nothing there.
    for radius, weight in ((max(1, int(height * 0.34)), 0.16),
                           (max(1, int(height * 0.12)), 0.30),
                           (max(1, int(height * 0.05)), 0.34)):
        glow[:] = 0
        cv2.circle(glow, moon, radius, MOONLIGHT, -1, cv2.LINE_AA)
        cv2.GaussianBlur(glow, (0, 0), radius / 2.0, dst=glow)
        cv2.addWeighted(canvas, 1.0, glow, weight, 0.0, dst=canvas)
    # Rays: the haze lit in shafts fanning down and to the left from the moon,
    # the one key light everything else in the picture agrees with.
    glow[:] = 0
    for index in range(7):
        angle = math.radians(118 + index * 9.5 + 4 * math.sin(index * 2.3))
        spread = math.radians(1.6 + 1.2 * (index % 3))
        reach = height * 1.6
        ray = np.array([
            moon,
            (moon[0] + math.cos(angle - spread) * reach, moon[1] + math.sin(angle - spread) * reach),
            (moon[0] + math.cos(angle + spread) * reach, moon[1] + math.sin(angle + spread) * reach)],
            np.int32)
        cv2.fillPoly(glow, [ray], MOONLIGHT, cv2.LINE_AA)
    cv2.GaussianBlur(glow, (0, 0), width * 0.012, dst=glow)
    cv2.addWeighted(canvas, 1.0, glow, 0.09, 0.0, dst=canvas)
    _draw_moon(canvas, moon, int(height * 0.028), rng)

    # The far treeline: a ragged wall of pines on the horizon, deep in the haze.
    far = _fogged(TREE, 0.78)
    cv2.fillPoly(canvas, [np.array(skyline, np.int32)], far, cv2.LINE_AA)
    layer = canvas.copy()
    for x in range(-20, width + 20, 9):
        _draw_tree(layer, (x, horizon + 5), view.height_px(150.0, rng.uniform(9, 18)),
                   far, 0, rng)
    blend(canvas, layer, 0.9)

    _lay_ground(canvas, view, seed)

    # Middle woods at sixty metres, either side of the road.
    mid = _fogged(TREE, 0.58)
    for side in (-1, 1):
        lane = 5.0
        while lane < 60.0:
            distance = rng.uniform(48.0, 72.0)
            base = view.ground_point(side * lane, distance)
            _draw_tree(canvas, base, view.height_px(distance, rng.uniform(7, 15)), mid,
                       int(rng.choice((0, 0, 1))), rng)
            lane += rng.uniform(1.2, 2.6)

    # Near trees and scrub framing the road, dark and sharp.
    for side in (-1, 1):
        distance = 9.0
        while distance < 42.0:
            lane = side * rng.uniform(5.2, 11.0)
            base = view.ground_point(lane, distance)
            if abs(base[0] - moon[0]) < width * 0.11:
                # Nothing tall stands in front of the moon.
                distance *= rng.uniform(1.12, 1.3)
                continue
            fog = min(max((distance - 6.0) / 60.0, 0.0), 0.5)
            kind = int(rng.choice((0, 1, 1)))
            tall = view.height_px(distance, rng.uniform(6, 13))
            # The moon side of the trunk and branches catches a thin edge of
            # light: the same silhouette, once pale and nudged towards the
            # moon, once black on top of it.
            state = rng.bit_generator.state
            lift = max(1, int(tall * 0.006))
            _draw_tree(canvas, (base[0] + lift, base[1] - lift), tall,
                       _fogged(_mix(TREE, RIM, 0.32), fog * 1.3), kind, rng)
            rng.bit_generator.state = state
            _draw_tree(canvas, base, tall, _fogged(TREE, fog), kind, rng)
            distance *= rng.uniform(1.12, 1.3)
        for distance in (2.6, 3.0, 3.5, 4.1, 4.8, 5.6, 6.6, 7.8, 9.5, 12.0, 16.0):
            for _ in range(2):
                lane = side * rng.uniform(3.8, 6.5)
                base = view.ground_point(lane, distance)
                _draw_tree(canvas, base, view.height_px(distance, rng.uniform(0.12, 0.3)),
                           _fogged((12, 15, 13), 0.1), 2, rng)

    # Telegraph poles along the verge, wires sagging between them: repeating
    # verticals at known spacing sell the distance better than anything.
    for side in (-1, 1):
        tops = []
        lane = side * (ROAD_HALF_WIDTH + 1.3)
        for distance in POST_SPACING:
            base = view.ground_point(lane, distance)
            pole = view.height_px(distance, 7.5)
            fog = min(max((distance - 6.0) / 50.0, 0.0), 0.8)
            color = _fogged(POST, fog)
            thickness = max(1, int(view.height_px(distance, 0.22)))
            top = (base[0], int(base[1] - pole))
            cv2.line(canvas, base, top, color, thickness, cv2.LINE_AA)
            if thickness >= 3:
                # The moon catches the right-hand edge of the pole.
                edge = max(1, thickness // 3)
                rim_x = base[0] + thickness // 2 - edge // 2
                cv2.line(canvas, (rim_x, base[1]), (rim_x, top[1]),
                         _fogged(_mix(POST, RIM, 0.22), fog), edge, cv2.LINE_AA)
            arm = view.height_px(distance, 1.2)
            cv2.line(canvas, (int(top[0] - arm / 2), top[1] + thickness * 2),
                     (int(top[0] + arm / 2), top[1] + thickness * 2), color,
                     max(1, thickness // 2), cv2.LINE_AA)
            tops.append((top, color, thickness, arm))
        for (a, color, thickness, arm), (b, _, _, arm_b) in zip(tops, tops[1:]):
            for end in (-0.4, 0.4):
                start = (int(a[0] + arm * end), a[1] + thickness * 2)
                stop = (int(b[0] + arm_b * end), b[1] + thickness * 2)
                sag = (int((start[0] + stop[0]) / 2),
                       int((start[1] + stop[1]) / 2 + abs(start[1] - stop[1]) * 0.08))
                cv2.polylines(canvas, [np.array([start, sag, stop], np.int32)], False,
                              color, 1, cv2.LINE_AA)

    # Haze, banked tightly around the horizon so it hides the join and nothing else.
    band = np.zeros((height, 1, 3), np.float32)
    band[:horizon, 0] = np.linspace(0.02, 0.40, horizon)[:, None] ** 1.6
    band[horizon:, 0] = np.linspace(0.40, 0.0, height - horizon)[:, None] ** 1.6
    fog_plane = np.full((height, width, 3), FOG, np.uint8)
    canvas[:] = (canvas * (1 - band) + fog_plane * band).astype(np.uint8)
    return canvas


@lru_cache(maxsize=4)
def _fog_bank(width: int, height: int, horizon: int) -> tuple[int, np.ndarray, np.ndarray,
                                                               np.ndarray]:
    """Two drifting layers of ground fog around the horizon, tiled so they wrap.

    Returns the top row of the strip, two alpha layers and the fog colour plane.
    """
    top = max(0, int(horizon - height * 0.10))
    bottom = min(height, int(horizon + height * 0.26))
    rows = bottom - top
    rng = np.random.default_rng(5)

    def layer(cells: int, seed_offset: int, strength: float) -> np.ndarray:
        low = np.random.default_rng(5 + seed_offset).random((max(rows // 40, 2), cells))
        tiled = np.concatenate([low, low, low], axis=1).astype(np.float32)
        big = cv2.resize(tiled, (width * 3, rows), interpolation=cv2.INTER_CUBIC)
        noise = np.clip(big[:, width:width * 2], 0, 1)
        y = (np.arange(rows) + top - horizon) / height
        envelope = np.exp(-((y - 0.05) / 0.075) ** 2) * (y > -0.06)
        envelope = np.where(y < 0, np.exp(-((y) / 0.035) ** 2) * envelope, envelope)
        return (noise ** 1.5 * strength * envelope[:, None]).astype(np.float32)

    del rng
    plane = np.empty((rows, width, 3), np.uint8)
    columns = np.arange(width, dtype=np.float32)
    moonward = np.exp(-((columns - width * 0.76) / (width * 0.3)) ** 2)
    for channel in range(3):
        plane[:, :, channel] = (FOG[channel] + 30 * moonward)[None, :].astype(np.uint8)
    return top, layer(14, 1, 0.55), layer(26, 2, 0.35), plane


def draw_fog(canvas: np.ndarray, view: Perspective, now: float) -> None:
    """The banks roll slowly left to right, two layers at two speeds."""
    height, width = canvas.shape[:2]
    top, slow, fast, plane = _fog_bank(width, height, int(view.horizon))
    rows = slow.shape[0]
    if rows <= 0:
        return
    alpha = np.roll(slow, int(now * 9) % width, axis=1)
    alpha += np.roll(fast, int(now * 23) % width, axis=1)
    np.clip(alpha, 0.0, 0.85, out=alpha)
    region = canvas[top:top + rows]
    region[:] = cv2.blendLinear(region, plane, 1.0 - alpha, alpha)


@lru_cache(maxsize=4)
def _vignette(width: int, height: int) -> np.ndarray:
    """A soft red frame, for the moment one of them gets a hand on you."""
    mask = np.zeros((height, width), np.float32)
    cv2.ellipse(mask, (width // 2, height // 2),
                (int(width * 0.58), int(height * 0.58)), 0, 0, 360, 1.0, -1)
    mask = 1.0 - cv2.GaussianBlur(mask, (0, 0), width * 0.09)
    return (mask[:, :, None] * np.float32([30, 22, 210])).astype(np.uint8)


@lru_cache(maxsize=4)
def _muzzle_glow(width: int, height: int) -> np.ndarray:
    """Warm light thrown up the road from a gun held just below the picture.

    Tight and low: it lights the tar in front of you and the nearest of them,
    and is gone by the middle distance, so the one warm light in the scene
    plainly comes from the bottom of the frame and not from nowhere.
    """
    glow = np.zeros((height, width, 3), np.uint8)
    cv2.ellipse(glow, (width // 2, height), (int(width * 0.16), int(height * 0.26)), 0,
                0, 360, FLASH_GLOW, -1, cv2.LINE_AA)
    cv2.ellipse(glow, (width // 2, height), (int(width * 0.06), int(height * 0.11)), 0,
                0, 360, FLASH, -1, cv2.LINE_AA)
    return cv2.GaussianBlur(glow, (0, 0), width * 0.035)


def draw_muzzle_burst(canvas: np.ndarray, area: Rect, now: float) -> None:
    """The flash itself, at the bottom of the picture where the gun is: a
    white-hot core with a few spikes, the source of the warm light on the road."""
    height, width = canvas.shape[:2]
    cx, cy = area.centre_x, min(height - 1, area.bottom - 2)
    size = max(8, int(area.height * 0.036))
    x0, y0 = max(0, cx - size * 3), max(0, cy - size * 3)
    x1, y1 = min(width, cx + size * 3), min(height, cy + size)
    if x1 <= x0 or y1 <= y0:
        return
    patch = canvas[y0:y1, x0:x1]
    burst = np.zeros_like(patch)
    centre = (cx - x0, cy - y0)
    spin = now * 37.0
    for index in range(7):
        angle = math.radians(-90 + (index - 3) * 24 + 6 * math.sin(spin + index))
        reach = size * (1.6 + 1.2 * _rag(int(now * 60) + index, 50))
        tip = (int(centre[0] + math.cos(angle) * reach), int(centre[1] + math.sin(angle) * reach))
        cv2.line(burst, centre, tip, FLASH, max(1, size // 5), cv2.LINE_AA)
    cv2.circle(burst, centre, int(size * 0.9), FLASH, -1, cv2.LINE_AA)
    cv2.circle(burst, centre, int(size * 0.45), (220, 244, 255), -1, cv2.LINE_AA)
    cv2.GaussianBlur(burst, (0, 0), size * 0.25, dst=burst)
    cv2.add(patch, burst, dst=patch)


def _heartbeat(now: float, period: float) -> float:
    """Lub-dub. 0..1 over one period."""
    phase = (now % period) / period
    return max(math.exp(-(phase / 0.08) ** 2),
               0.6 * math.exp(-((phase - 0.22) / 0.08) ** 2))


# --- the walkers --------------------------------------------------------------

def _rag(seed: int, index: int) -> float:
    """A stable pseudo-random 0..1 for this walker's rags; no generator needed."""
    value = math.sin(seed * 12.9898 + index * 78.233) * 43758.5453
    return value - math.floor(value)


def _paint(canvas: np.ndarray, figure: Figure, cloth, skin, grow: float,
           shift: tuple[float, float]) -> None:
    """Lay down the whole figure: rags in ``cloth``, head and hands in ``skin``.

    Called three times: fattened and nudged towards the moon for the rim,
    nudged away from it for the shaded side, and at true size for the body.
    Painting the rim as an outline rather than a stroke inside the silhouette
    keeps it off the chest, where it read as a stripe of light down the front.
    """
    if figure.gait == "crawl":
        _paint_crawler(canvas, figure, cloth, skin, grow, shift)
        return

    height = figure.height
    dx, dy = shift
    x, ground = figure.x + dx, figure.ground_y + dy
    gait = figure.gait
    lead = figure.hunch * height * 0.085 + (height * 0.07 if gait == "lurch" else 0.0)
    limb = max(1, int(height * 0.058 + grow))
    half = figure.half_shoulder
    shoulder_y, hip_y = figure.shoulder_y + dy, figure.hip_y + dy
    seed = figure.seed
    stiff = 1 if _rag(seed, 9) < 0.5 else -1  # which leg the limper drags
    bare = _rag(seed, 14) < 0.4  # trousers torn off below one knee

    # Legs: a dragging gait, knees never quite straightening.
    stride = math.sin(figure.phase) * height * (0.11 if gait == "lurch" else 0.085)
    stance = 0.065 if gait == "lurch" else 0.045
    for side in (-1, 1):
        swing = stride * side
        hip = (int(x + side * height * stance), int(hip_y))
        shin = skin if (bare and side == stiff) else cloth
        if gait == "limp" and side == stiff:
            # The bad leg stays straight and trails, toe scraping the road.
            foot = (int(x + side * height * 0.04 + swing * 0.35 - side * height * 0.035),
                    int(ground - height * 0.012))
            cv2.line(canvas, hip, foot, shin, max(1, int(limb * 0.9)), cv2.LINE_AA)
            cv2.ellipse(canvas, foot, (max(1, int(height * 0.05 + grow)),
                                       max(1, int(height * 0.014 + grow))),
                        0, 0, 360, cloth, -1, cv2.LINE_AA)
            continue
        knee = (int(hip[0] + side * height * 0.02 + swing * 0.6),
                int(hip_y + (ground - hip_y) * 0.55))
        foot = (int(x + side * height * (stance + 0.01) + swing), int(ground))
        cv2.line(canvas, hip, knee, cloth, limb, cv2.LINE_AA)
        cv2.line(canvas, knee, foot, shin, max(1, int(limb * 0.85)), cv2.LINE_AA)
        cv2.ellipse(canvas, foot, (max(1, int(height * 0.045 + grow)),
                                   max(1, int(height * 0.018 + grow))),
                    0, 0, 360, cloth, -1, cv2.LINE_AA)

    # Torso, in whatever is left of its clothes: the hem hangs in torn points,
    # and some of them are still in a coat that reaches the knee.
    coat = _rag(seed, 0) < 0.45
    hem = hip_y + (height * 0.14 if coat else height * 0.02)
    droop = (height * 0.028 if gait == "lurch" else 0.0)
    torso = [
        (x + lead - half - grow, shoulder_y + height * 0.035 + droop),
        (x + lead - half * 0.55, shoulder_y - height * 0.012 - grow + droop),
        (x + lead + half * 0.55, shoulder_y - height * 0.012 - grow),
        (x + lead + half + grow, shoulder_y + height * 0.035),
        (x + half * 0.7 + grow, hip_y)]
    points = 5
    for index in range(points + 1):
        t = index / points
        torso.append((x + half * 0.72 - half * 1.44 * t + grow * (1 - 2 * t),
                      hem + height * 0.06 * _rag(seed, 1 + index) * (index % 2)))
    torso.append((x - half * 0.7 - grow, hip_y))
    cv2.fillPoly(canvas, [np.array(torso, np.int32)], cloth, cv2.LINE_AA)
    if _rag(seed, 15) < 0.5 and height > 40:
        # The shirt torn open: a wedge of chest showing through.
        tear = np.array([
            (x + lead - half * 0.3, shoulder_y + height * 0.06),
            (x + lead + half * 0.35, shoulder_y + height * 0.05),
            (x + half * 0.1, hip_y - height * 0.05 * _rag(seed, 16))], np.int32)
        cv2.fillPoly(canvas, [tear], skin, cv2.LINE_AA)

    # Arms. Reaching, hanging, or one clutched to a wound, by gait.
    for side in (-1, 1):
        reach = math.sin(figure.phase + side * 1.7) * height * 0.045
        shoulder = (int(x + lead + side * half * 0.9), int(shoulder_y + height * 0.03))
        if gait == "lurch":
            elbow = (int(shoulder[0] + side * height * 0.035 + reach * 0.5),
                     int(shoulder[1] + height * 0.17))
            hand = (int(elbow[0] + side * height * 0.015 + reach),
                    int(elbow[1] + height * 0.16))
        elif gait == "limp" and side == -stiff:
            elbow = (int(shoulder[0] + side * height * 0.08),
                     int(shoulder[1] + height * 0.13))
            hand = (int(x + side * height * 0.02), int(hip_y - height * 0.02))
        else:
            elbow = (int(shoulder[0] + side * height * 0.11),
                     int(shoulder[1] + height * 0.15 + reach))
            hand = (int(x + side * half * 1.9), int(shoulder_y + height * 0.33 + reach))
        sleeve = _rag(seed, 5 + side) < 0.55  # a sleeve left, or a bare arm
        cv2.line(canvas, shoulder, elbow, cloth if sleeve else skin, limb, cv2.LINE_AA)
        cv2.line(canvas, elbow, hand, skin, max(1, int(limb * 0.9)), cv2.LINE_AA)
        cv2.circle(canvas, hand, max(1, int(height * 0.042 + grow)), skin, -1,
                   cv2.LINE_AA)
        # A torn sleeve hanging off the elbow.
        flap = height * (0.04 + 0.06 * _rag(seed, 7 + side))
        if flap > 2 and sleeve:
            cv2.fillPoly(canvas, [np.array([
                (elbow[0] - limb, elbow[1] - limb),
                (elbow[0] + limb, elbow[1] - limb),
                (elbow[0] + side * limb * 0.5, elbow[1] + flap)], np.int32)],
                cloth, cv2.LINE_AA)

    head = (int(figure.head[0] + lead + dx), int(figure.head[1] + dy))
    radius = max(1, int(figure.head_radius + grow))
    cv2.line(canvas, (int(x + lead), int(shoulder_y)), head, skin,
             max(1, int(limb * 0.95)), cv2.LINE_AA)
    cv2.ellipse(canvas, head, (radius, max(1, int(figure.head_radius * 1.15 + grow))),
                figure.tilt, 0, 360, skin, -1, cv2.LINE_AA)
    if _rag(seed, 12) < 0.35 and radius > 3:
        # A jaw hanging open.
        angle = math.radians(figure.tilt)
        jaw = (int(head[0] - math.sin(angle) * radius * 1.1 + math.cos(angle) * radius * 0.45),
               int(head[1] + math.cos(angle) * radius * 1.1 + math.sin(angle) * radius * 0.45))
        cv2.circle(canvas, jaw, max(1, int(radius * 0.45)), skin, -1, cv2.LINE_AA)
    if radius > 4 and _rag(seed, 13) < 0.6:
        # What hair it has left, matted down on one side.
        angle = math.radians(figure.tilt)
        hair = (int(head[0] - math.sin(angle) * radius * 0.35),
                int(head[1] - math.cos(angle) * radius * 0.45))
        cv2.ellipse(canvas, hair, (radius, max(1, int(radius * 0.7))), figure.tilt,
                    200, 340, cloth, -1, cv2.LINE_AA)


def _paint_crawler(canvas: np.ndarray, figure: Figure, cloth, skin, grow: float,
                   shift: tuple[float, float]) -> None:
    """Dragging itself towards you on its elbows, legs trailing up the road."""
    height = figure.height
    dx, dy = shift
    x, ground = figure.x + dx, figure.ground_y + dy
    limb = max(1, int(height * 0.045 + grow))
    pull = math.sin(figure.phase)

    # Legs trail behind, which from here means up the picture and foreshortened.
    for side in (-1, 1):
        hip = (int(x + side * height * 0.05), int(ground - height * 0.43))
        foot = (int(x + side * height * (0.08 + 0.02 * pull * side)),
                int(ground - height * (0.55 + 0.03 * _rag(figure.seed, 3 + side))))
        cv2.line(canvas, hip, foot, cloth, limb, cv2.LINE_AA)

    torso = np.array([
        (x - height * 0.15 - grow, ground - height * 0.30),
        (x - height * 0.09, ground - height * 0.46 - grow),
        (x + height * 0.09, ground - height * 0.46 - grow),
        (x + height * 0.15 + grow, ground - height * 0.30),
        (x + height * 0.1, ground - height * 0.24 + grow),
        (x - height * 0.1, ground - height * 0.24 + grow)], np.int32)
    cv2.fillPoly(canvas, [torso], cloth, cv2.LINE_AA)

    # Arms planted ahead, one always further than the other.
    for side in (-1, 1):
        ahead = 0.05 * pull * side
        shoulder = (int(x + side * height * 0.13), int(ground - height * 0.32))
        elbow = (int(x + side * height * (0.22 + ahead * 0.4)), int(ground - height * 0.16))
        hand = (int(x + side * height * (0.24 + ahead)), int(ground - height * 0.03))
        cv2.line(canvas, shoulder, elbow, cloth, limb, cv2.LINE_AA)
        cv2.line(canvas, elbow, hand, skin, limb, cv2.LINE_AA)
        cv2.circle(canvas, hand, max(1, int(height * 0.04 + grow)), skin, -1, cv2.LINE_AA)

    head = (int(figure.head[0] + dx), int(figure.head[1] + dy))
    radius = max(1, int(figure.head_radius + grow))
    cv2.line(canvas, (int(x), int(ground - height * 0.32)), head, skin, limb, cv2.LINE_AA)
    cv2.ellipse(canvas, head, (radius, max(1, int(radius * 0.9))), figure.tilt, 0, 360,
                skin, -1, cv2.LINE_AA)


def _alpha_ellipse(canvas: np.ndarray, centre: tuple[int, int], axes: tuple[int, int],
                   color, alpha: float, angle: float = 0.0) -> None:
    """A translucent ellipse, composited through a patch no bigger than itself."""
    height, width = canvas.shape[:2]
    reach = max(axes) + 2
    x0, y0 = max(0, centre[0] - reach), max(0, centre[1] - reach)
    x1, y1 = min(width, centre[0] + reach + 1), min(height, centre[1] + reach + 1)
    if x1 <= x0 or y1 <= y0 or alpha <= 0.0:
        return
    patch = canvas[y0:y1, x0:x1]
    overlay = patch.copy()
    cv2.ellipse(overlay, (centre[0] - x0, centre[1] - y0), axes, angle, 0, 360, color, -1,
                cv2.LINE_AA)
    cv2.addWeighted(overlay, min(alpha, 1.0), patch, 1.0 - min(alpha, 1.0), 0.0, dst=patch)


def _eye_points(figure: Figure) -> tuple[tuple[int, int], tuple[int, int]]:
    angle = math.radians(figure.tilt)
    lead = figure.hunch * figure.height * 0.085
    if figure.gait == "lurch":
        lead += figure.height * 0.07
    if figure.gait == "crawl":
        lead = 0.0
    eyes = []
    for side in (-0.4, 0.4):
        eyes.append((int(figure.head[0] + lead + math.cos(angle) * figure.head_radius * side
                         - math.sin(angle) * figure.head_radius * 0.1),
                     int(figure.head[1] + math.sin(angle) * figure.head_radius * side
                         + math.cos(angle) * figure.head_radius * 0.1)))
    return eyes[0], eyes[1]


def draw_walker(canvas: np.ndarray, walker: Walker, view: Perspective,
                now: float, light: float = 0.0) -> None:
    """One of them, moonlit from up and to the right, its shadow thrown down the road.

    Three passes of the same silhouette: a pale rim nudged towards the moon, a
    black shade nudged away from it, and the body on top. ``light`` is how much
    of the muzzle flash reaches it this frame: lit from the front, the whole
    figure lifts warm for an instant.
    """
    figure = walker.figure(view, now)
    if figure.height < 5:
        return
    haze = figure.fog * 0.5
    cloth = _fogged(RAGS, haze)
    skin = _fogged(SKIN, haze)
    if light > 0.0:
        cloth = _mix(cloth, FLASH, light * 0.28)
        skin = _mix(skin, FLASH, light * 0.45)

    # The shadow: long, down and to the left, away from the moon, and a tight
    # dark contact patch under the feet so it stands on the road.
    length = figure.height * (0.28 if figure.gait == "crawl" else 0.5)
    ground_fade = 1.0 - figure.fog * 0.6
    _alpha_ellipse(canvas, (int(figure.x - length * 0.42), int(figure.ground_y + length * 0.13)),
                   (max(2, int(length * 0.5)), max(1, int(figure.height * 0.05))),
                   (4, 4, 5), 0.5 * ground_fade, angle=-17.0)
    _alpha_ellipse(canvas, (int(figure.x), int(figure.ground_y + figure.height * 0.005)),
                   (max(2, int(figure.height * 0.17)), max(1, int(figure.height * 0.04))),
                   (3, 3, 4), 0.45 * ground_fade)
    _alpha_ellipse(canvas, (int(figure.x), int(figure.ground_y)),
                   (max(2, int(figure.height * 0.11)), max(1, int(figure.height * 0.022))),
                   (2, 2, 3), 0.75 * ground_fade)

    nudge = max(1.2, figure.height * 0.014)
    # The moon's rim, from the moment it is on the road: a small figure in the
    # fog is the one that needs an edge most, so the rim barely fades with the
    # haze and is never thinner than a pixel and a half.
    strength = 0.7 + 0.3 * (1.0 - figure.fog)
    rim = _fogged(_mix(RAGS, RIM, strength), haze * 0.3)
    _paint(canvas, figure, rim, rim, grow=max(1.0, figure.height * 0.006),
           shift=(nudge, -nudge * 0.8))
    if light > 0.0 and figure.height > 24:
        # The muzzle flash catches the near, low edge of it: a warm rim opposite
        # the moon's, for the one frame the shot lasts.
        warm = _mix(cloth, FLASH, min(1.0, light * 0.9))
        _paint(canvas, figure, warm, warm, grow=max(1.0, figure.height * 0.003),
               shift=(-nudge * 0.8, nudge * 0.9))
    if figure.height > 40:
        shade = _fogged(SHADE, haze)
        _paint(canvas, figure, shade, shade, grow=0.0, shift=(-nudge * 0.7, nudge * 0.5))
    _paint(canvas, figure, cloth, skin, grow=0.0, shift=(0.0, 0.0))
    if figure.height > 60:
        # A wet-skin highlight on the skull, moon side.
        head = (int(figure.head[0] + nudge * 1.2), int(figure.head[1] - nudge * 1.4))
        gleam = _fogged(_mix(skin, RIM, 0.55), haze)
        _alpha_ellipse(canvas, head, (max(1, int(figure.head_radius * 0.45)),
                                      max(1, int(figure.head_radius * 0.3))),
                       gleam, 0.5, angle=figure.tilt - 35.0)

    # The eyes: catching the moon at any distance, which is how you find them.
    # A soft glow around each, at every size, so even a far one has a pair of
    # pale points where its face is.
    shine = _mix(EYESHINE, FLASH, light * 0.6)
    left, right = _eye_points(figure)
    radius = max(1, int(figure.head_radius * 0.14))
    if figure.height < 14:
        mid = ((left[0] + right[0]) // 2, (left[1] + right[1]) // 2)
        _alpha_ellipse(canvas, mid, (3, 2), shine, 0.35)
        cv2.line(canvas, left, right, shine, 1, cv2.LINE_AA)
    else:
        for eye in (left, right):
            _alpha_ellipse(canvas, eye, (radius * 4 + 1, radius * 3 + 1), shine, 0.16)
            _alpha_ellipse(canvas, eye, (radius * 2 + 1, radius * 2), shine, 0.3)
            cv2.circle(canvas, eye, radius, shine, -1, cv2.LINE_AA)


def draw_stains(canvas: np.ndarray, round_: ZombieRound, now: float = 0.0) -> None:
    """What is left where they fell: the body, and what ran out of it.

    The pool spreads for a few seconds after the fall, then keeps creeping out
    across the asphalt and drying to black for the rest of the night, so the
    road at the end of the round reads as the battlefield it was.
    """
    if not round_.stains:
        return
    height, width = canvas.shape[:2]
    xs = [int(x) for x, *_ in round_.stains]
    ys = [int(y) for _, y, *_ in round_.stains]
    rs = [int(r * 3.4) + 3 for _, _, r, *_ in round_.stains]
    x0 = max(0, min(x - r for x, r in zip(xs, rs)))
    x1 = min(width, max(x + r for x, r in zip(xs, rs)))
    y0 = max(0, min(y - r for y, r in zip(ys, rs)))
    y1 = min(height, max(y + r for y, r in zip(ys, rs)))
    if x1 <= x0 or y1 <= y0:
        return
    patch = canvas[y0:y1, x0:x1]
    overlay = patch.copy()
    gloss = []
    for x, y, radius, at, seed in round_.stains:
        age = max(0.0, now - at)
        spread = min(1.0, 0.35 + age / 3.0) + 0.4 * min(1.0, age / 45.0)
        dry = min(1.0, age / 40.0)
        colour = _mix(_mix(BLOOD_FRESH, BLOOD, min(1.0, age / 6.0)), STAIN, dry)
        if age > 14.0:
            # An old pool is a dark wet patch, no redder than the tar around it.
            colour = _mix(colour, (26, 22, 24), 0.4)
        cx, cy = int(x) - x0, int(y) - y0
        # The pool is flat on the road, so it is foreshortened like the road.
        main = (max(1, int(radius * 1.7 * spread)), max(1, int(radius * 0.38 * spread)))
        cv2.ellipse(overlay, (cx, cy), main, 0, 0, 360, colour, -1, cv2.LINE_AA)
        for index in range(6):
            # Spatter thrown a little way, in the direction it fell, and runnels
            # finding the cracks.
            ox = (_rag(seed, index) - 0.3) * radius * 3.4 * spread
            oy = (_rag(seed, index + 4) - 0.5) * radius * 0.8 * spread
            size = max(1, int(radius * (0.12 + 0.25 * _rag(seed, index + 8))))
            cv2.ellipse(overlay, (int(cx + ox), int(cy + oy)),
                        (size, max(1, int(size * 0.35))), 0, 0, 360, colour, -1, cv2.LINE_AA)
        if main[0] > 4 and dry < 0.9:
            gloss.append(((cx + int(main[0] * 0.3), cy - int(main[1] * 0.35)),
                          (max(1, int(main[0] * 0.35)), max(1, int(main[1] * 0.3))),
                          0.35 * (1.0 - dry)))
    cv2.addWeighted(overlay, 0.78, patch, 0.22, 0.0, dst=patch)
    for centre, axes, alpha in gloss:
        # The moon on the wet of it: a sheen on the moon side of the pool.
        _alpha_ellipse(patch, centre, axes, GLOSS, alpha)

    # The bodies lie where they dropped, across the road, flattened by the
    # angle you see the road at: a full walker's length, lying down. A fresh
    # kill has the moon on its upper edge and its blood still bright; as the
    # minutes pass the rim goes, the rags soak to the colour of the tar, and
    # what is left is a low dark shape on the road, not a drawing of a body.
    for x, y, radius, at, seed in sorted(round_.stains, key=lambda stain: stain[1]):
        if radius < 2.5:
            continue
        fresh = max(0.0, 1.0 - max(0.0, now - at) / 14.0)
        settle = 1.0 - fresh
        side = 1 if _rag(seed, 20) < 0.5 else -1
        cx, cy = int(x), int(y - radius * 0.1)
        tilt = side * (4 + 10 * _rag(seed, 21))
        slope = math.tan(math.radians(tilt))
        face_up = _rag(seed, 27) < 0.5
        thick = max(1, int(radius * 0.13))
        lift = max(1, int(radius * 0.06))
        cloth = _mix(RAGS, (24, 22, 20), settle * 0.7)
        flesh = _mix(SKIN, (40, 38, 36), settle * 0.75)
        rim = _mix(cloth, RIM, 0.7 * fresh)
        rim_skin = _mix(flesh, RIM, 0.65 * fresh)

        def along(t: float, drop: float = 0.0, cx=cx, cy=cy, side=side,
                  radius=radius, slope=slope) -> tuple[int, int]:
            """A point ``t`` body-radii towards the head, ``drop`` radii down."""
            return int(cx + side * radius * t), int(cy + side * radius * t * slope
                                                    + radius * drop)

        torso = (max(1, int(radius * 1.25)), max(1, int(radius * 0.42)))
        head = along(1.55, 0.02)
        head_r = max(1, int(radius * 0.36))
        legs = [(along(-1.1, -0.02), along(-2.6 - 0.4 * _rag(seed, 22 + leg),
                                           (0.22 - 0.5 * leg) * (0.6 + _rag(seed, 24 + leg))))
                for leg in range(2)]
        arms = [(along(0.6, -0.1), along(0.9 + 0.6 * _rag(seed, 26), 0.55)),
                (along(0.3, -0.15), along(1.4 + 0.5 * _rag(seed, 28), -0.35))]
        passes = [(cloth, flesh, 0)]
        if fresh > 0.05:
            passes.insert(0, (rim, rim_skin, -lift))
        for pass_cloth, pass_skin, shift in passes:
            for start, end in legs:
                cv2.line(canvas, (start[0], start[1] + shift), (end[0], end[1] + shift),
                         pass_cloth, thick, cv2.LINE_AA)
            cv2.ellipse(canvas, (cx, cy + shift), torso, tilt, 0, 360, pass_cloth, -1,
                        cv2.LINE_AA)
            for index, (start, end) in enumerate(arms):
                sleeve = pass_cloth if index == 0 else pass_skin
                cv2.line(canvas, (start[0], start[1] + shift), (end[0], end[1] + shift),
                         sleeve, max(1, int(thick * 0.8)), cv2.LINE_AA)
                cv2.circle(canvas, (end[0], end[1] + shift), max(1, int(thick * 0.6)),
                           pass_skin, -1, cv2.LINE_AA)
            cv2.ellipse(canvas, (head[0], head[1] + shift),
                        (head_r, max(1, int(head_r * 0.85))), tilt, 0, 360, pass_skin, -1,
                        cv2.LINE_AA)
        if head_r > 3 and face_up:
            # The mouth still open; the head-shot, a dark hole above the eye.
            cv2.circle(canvas, (head[0] + side * head_r // 3, head[1] - head_r // 4),
                       max(1, head_r // 4), STAIN, -1, cv2.LINE_AA)
        if radius > 6 and fresh > 0.0:
            # The exit wound's spray, short and dark, thrown past the head;
            # it dries into the road with the rest.
            spray_colour = _mix(STAIN, BLOOD_FRESH, fresh)
            for index in range(4):
                spray = along(1.9 + 1.2 * _rag(seed, 30 + index),
                              (_rag(seed, 34 + index) - 0.5) * 0.8)
                cv2.circle(canvas, spray, max(1, int(radius * 0.08)), spray_colour, -1,
                           cv2.LINE_AA)


def _depth_scale(view: Perspective, y: float) -> float:
    """How big a thing at this row of the road should look: small far, big near."""
    span = max(1.0, view.area.bottom - view.horizon)
    return min(max(0.45 + 0.75 * (y - view.horizon) / span, 0.45), 1.2)


def _label(canvas: np.ndarray, text: str, origin: tuple[int, int], colour, scale: float,
           thickness: int, fade: float = 1.0) -> None:
    """Popup text in the HUD's manner: amber on a black outline, with a soft drop
    shadow under it. ``fade`` dims the whole thing towards the night."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    x, y = origin
    drop = max(2, int(3 * scale))
    ink = _mix((8, 8, 10), colour, fade)
    outline = _mix((8, 8, 10), (16, 14, 12), fade)
    cv2.putText(canvas, text, (x + drop, y + drop), font, scale, (4, 4, 4), thickness + 5,
                cv2.LINE_AA)
    cv2.putText(canvas, text, (x, y), font, scale, outline, thickness + 3, cv2.LINE_AA)
    cv2.putText(canvas, text, (x, y), font, scale, ink, thickness, cv2.LINE_AA)


def draw_impact(canvas: np.ndarray, impact: Impact, now: float, ttl: float,
                view: Perspective | None = None) -> None:
    """The shot itself: a puff off the road, or a spray of it. No text here."""
    age = now - impact.at
    life = max(0.0, 1.0 - age / ttl)
    if life <= 0.0:
        return
    centre = (int(impact.x), int(impact.y))
    depth = _depth_scale(view, impact.y) if view is not None else 1.0

    if not impact.is_hit:
        ring = int(4 + 30 * (1 - life))
        _alpha_ellipse(canvas, centre, (ring, max(1, int(ring * 0.5))), (80, 80, 80),
                       life * 0.4)
        return

    if age < IMPACT_FLASH:
        spray = age / IMPACT_FLASH
        for index in range(9):
            angle = index * math.tau / 9 + impact.at
            reach = (6 + 40 * spray) * (0.5 + 0.5 * math.sin(angle * 3)) * depth
            speck = (int(centre[0] + math.cos(angle) * reach),
                     int(centre[1] + math.sin(angle) * reach * 0.7 + 30 * spray * spray * depth))
            cv2.circle(canvas, speck, max(1, int((2 * (1 - spray) + 1) * depth)), BLOOD, -1,
                       cv2.LINE_AA)
    size = 5 * life * depth * max(0.5, (canvas.shape[0] / 720.0))
    _alpha_ellipse(canvas, centre, (max(1, int(size)), max(1, int(size * 0.9))), BLOOD,
                   life * 0.8)


def draw_popups(canvas: np.ndarray, impacts: list, now: float, ttl: float,
                view: Perspective) -> None:
    """The score for each hit, anchored over the hit itself: amber points and the
    word beneath, landing oversized for a couple of frames, then drifting up a
    little and fading into the night.

    Drawn after every impact so they sit over everything; scaled by how far down
    the road the hit was; and stacked, so two kills in the same patch of fog do
    not write over each other.
    """
    font = cv2.FONT_HERSHEY_SIMPLEX
    taken: list[tuple[int, int, int, int]] = []
    for impact in sorted(impacts, key=lambda i: i.at):
        age = now - impact.at
        life = max(0.0, 1.0 - age / ttl)
        if life <= 0.0 or not impact.is_hit or impact.score <= 0:
            continue
        pop = max(0.0, 1.0 - age / POPUP_POP)  # lands big, settles in two frames
        base = 0.9 * max(0.75, _depth_scale(view, impact.y)) * (canvas.shape[0] / 720.0)
        scale = base * (1.0 + 0.6 * pop)
        thickness = max(1, int(round(2.2 * scale)))
        fade = min(1.0, life * 2.2)  # solid for most of its life, then gone
        lift = int(canvas.shape[0] * 0.02 * (1 - life))
        points = f"+{impact.score}"
        tag = impact.label or ""
        (points_w, points_h), _ = cv2.getTextSize(points, font, scale, thickness)
        tag_scale = scale * 0.62
        tag_w = cv2.getTextSize(tag, font, tag_scale, thickness)[0][0] if tag else 0
        gap = int(points_h * 0.45)
        width = max(points_w, tag_w)
        box_h = points_h + (int(points_h * 0.62) + gap if tag else 0)
        # Anchored just above the head, centred on it: the number is the hit.
        x = int(impact.x) - width // 2
        y = int(impact.y) - int(24 * base) - lift  # baseline of the lowest line
        # Slide up past anything already drawn there.
        for _ in range(8):
            top = y - box_h
            clash = any(x < tx1 and x + width > tx0 and top < ty1 and y > ty0
                        for tx0, ty0, tx1, ty1 in taken)
            if not clash:
                break
            y -= box_h + 4
        taken.append((x, y - box_h, x + width, y))
        if tag:
            _label(canvas, tag, (int(impact.x) - tag_w // 2, y), TAG_INK, tag_scale,
                   thickness, fade)
            y -= int(points_h * 0.62) + gap
        _label(canvas, points, (int(impact.x) - points_w // 2, y), SCORE_INK, scale,
               thickness, fade)


def draw_rain(canvas: np.ndarray, area: Rect, now: float, drops: int = 110,
              view: Perspective | None = None) -> None:
    """Rain with depth to it: a pixel-thin drizzle near the horizon, longer and
    brighter streaks the nearer it falls, a few bright ones right in front of
    you, and rings on the wet road where the drops land.

    The streaks are light on the drops, so they are added to the picture rather
    than painted over it: rain can only ever brighten what is behind it, and a
    drop crossing the moon vanishes into it instead of scratching it black.
    """
    height, width = canvas.shape[:2]
    top, bottom = area.y, min(height, area.bottom + 8)
    span = max(1, bottom - top)
    if span <= 0 or width <= 0:
        return
    horizon = view.horizon if view is not None else top + 0.3 * span
    mask = np.zeros((span, width), np.uint8)
    for index in range(drops):
        layer = index % 3
        speed = (420, 640, 900)[layer]
        x = int((_rag(index, 1) * 1.25 - 0.1) * width + now * (-30 - 18 * layer))
        x %= width + 40
        y = int((_rag(index, 2) * span + now * speed) % span)
        depth = min(max((y + top - horizon) / max(1.0, bottom - horizon), 0.0), 1.0)
        if layer == 2 and depth < 0.25:
            continue  # the foreground layer falls in front of the road only
        length = int((4 + 6 * layer) + (10 + 14 * layer) * depth)
        tone = int(22 + 58 * (0.25 + 0.35 * layer) * (0.3 + 0.7 * depth))
        cv2.line(mask, (x, y), (x - 1 - 2 * layer, y + length), tone, 1, cv2.LINE_AA)
    # The bright few: close enough to catch the moon, two pixels wide.
    for index in range(max(4, drops // 14)):
        x = int((_rag(index + 900, 1) * 1.1 - 0.05) * width + now * -70) % (width + 40)
        y = int((_rag(index + 900, 2) * span + now * 1250) % span)
        if y + top < horizon + span * 0.2:
            continue
        length = int(16 + 18 * _rag(index + 900, 3))
        cv2.line(mask, (x, y), (x - 3, y + length), 46, 2, cv2.LINE_AA)
        cv2.line(mask, (x, y), (x - 3, y + length), 96, 1, cv2.LINE_AA)
    if view is not None:
        _draw_ripples(mask, view, now, max(6, drops // 8), top)
    region = canvas[top:bottom]
    cv2.add(region, cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR), dst=region)


def _draw_ripples(mask: np.ndarray, view: Perspective, now: float, count: int,
                  top: int = 0) -> None:
    """Rings spreading on the puddles: each drop's ring, foreshortened flat,
    drawn as light into the rain mask so they only ever brighten the road."""
    height = mask.shape[0]
    for index in range(count):
        cycle = 0.7 + 0.5 * _rag(index, 40)
        phase = ((now + _rag(index, 41) * cycle) % cycle) / cycle
        lane = (_rag(index, 42) - 0.5) * 2.0 * (ROAD_HALF_WIDTH - 0.2)
        distance = 2.2 * math.exp(_rag(index, 43) * math.log(9.0))
        ground = view.ground_point(lane, distance)
        y = ground[1] - top
        if y >= height or y < 0:
            continue
        reach = view.height_px(distance, 0.05 + 0.11 * phase)
        axes = (max(1, int(reach)), max(1, int(reach * 0.28)))
        fade = (1.0 - phase) * (1.0 - min(distance / 22.0, 0.8))
        cv2.ellipse(mask, (ground[0], y), axes, 0, 0, 360, int(70 * fade), 1, cv2.LINE_AA)


def draw_footer_strip(canvas: np.ndarray, area: Rect) -> None:
    """A solid dark strip under the play area, for the help text to sit on."""
    height, width = canvas.shape[:2]
    top = min(height, max(0, area.bottom))
    if top >= height:
        return
    strip = canvas[top:]
    cv2.addWeighted(strip, 0.18, np.zeros_like(strip), 0.82, 0.0, dst=strip)
    cv2.line(canvas, (0, top), (width, top), (30, 30, 34), 1)


def draw_robot(canvas: np.ndarray, walker: Walker, view: Perspective,
               now: float, light: float = 0.0) -> None:
    """Armoured humanoid, using the very same figure as the hit test."""
    f = walker.figure(view, now)
    h, x = f.height, f.x
    metal = _fogged((130, 119, 105), f.fog)
    edge = _fogged((233, 216, 170), f.fog)
    dark = _fogged((41, 37, 32), f.fog)
    cyan = _fogged((250, 229, 64), f.fog)

    def limb(a, b, thickness):
        a, b = tuple(map(int, a)), tuple(map(int, b))
        cv2.line(canvas, a, b, dark, max(2, int(h * thickness + 3)), cv2.LINE_AA)
        cv2.line(canvas, a, b, metal, max(1, int(h * thickness)), cv2.LINE_AA)
        cv2.circle(canvas, a, max(2, int(h * .026)), edge, -1, cv2.LINE_AA)

    stride = math.sin(f.phase) * h * .045
    for sign in (-1, 1):
        hip = (x + sign * h * .055, f.hip_y)
        knee = (x + sign * h * .07, f.hip_y + h * .19)
        foot = (x + sign * h * .09 + sign * stride, f.ground_y)
        limb(hip, knee, .065)
        limb(knee, foot, .055)
        shoulder = (x + sign * f.half_shoulder * .85, f.shoulder_y)
        elbow = (x + sign * f.half_shoulder * 1.15, f.shoulder_y + h * .14)
        limb(shoulder, elbow, .05)
        limb(elbow, (x + sign * f.half_shoulder, f.hip_y + h * .06), .04)
    body = np.array([(x - f.half_shoulder, f.shoulder_y),
                     (x + f.half_shoulder, f.shoulder_y),
                     (x + h * .07, f.hip_y), (x - h * .07, f.hip_y)], np.int32)
    cv2.fillConvexPoly(canvas, body, metal, cv2.LINE_AA)
    cv2.polylines(canvas, [body], True, edge, max(1, int(h * .008)), cv2.LINE_AA)
    hx, hy = map(int, f.head)
    r = max(2, int(f.head_radius * .83))
    cv2.rectangle(canvas, (hx-r, hy-r), (hx+r, hy+r), metal, -1)
    cv2.rectangle(canvas, (hx-r, hy-r), (hx+r, hy+r), edge, 1)
    cv2.line(canvas, (hx-r+1, hy), (hx+r-1, hy), cyan, max(1, r//3))
    cv2.circle(canvas, (int(x), int(f.shoulder_y + h * .075)),
               max(2, int(h * .025)), cyan, -1, cv2.LINE_AA)


def draw_world(canvas: np.ndarray, round_: ZombieRound, now: float) -> None:
    area = round_.area
    height, width = canvas.shape[:2]
    canvas[:] = _environment(
        (area.x, area.y, area.width, area.height), width, height,
        round_.options.seed or 0, round_.skyline)
    robots = round_.options.enemy == "robots"
    if not robots:
        draw_stains(canvas, round_, now)
    draw_enemy = draw_robot if robots else draw_walker

    last_shot = round_.last_shot()
    flash = (last_shot is not None and 0.0 <= now - last_shot < MUZZLE_FLASH)

    # Painter's algorithm: the far ones first, so the near ones stand in front,
    # with the fog rolling between the far ones and the near ones.
    ordered = sorted(round_.walkers, key=lambda w: -w.distance)
    def lit(walker: Walker) -> float:
        if not flash:
            return 0.0
        return max(0.0, 1.0 - (walker.distance / 13.0) ** 2)

    for walker in ordered:
        if walker.distance > 9.0:
            draw_enemy(canvas, walker, round_.view, now, lit(walker))
    draw_fog(canvas, round_.view, now)
    for walker in ordered:
        if walker.distance <= 9.0:
            draw_enemy(canvas, walker, round_.view, now, lit(walker))
    for impact in round_.impacts:
        if robots:
            age = now - impact.at
            if impact.is_hit and age < .3:
                for i in range(8):
                    angle = i * math.tau / 8
                    length = (8 + age * 70) * round_.options.scale
                    start = (int(impact.x), int(impact.y))
                    end = (int(impact.x + math.cos(angle) * length),
                           int(impact.y + math.sin(angle) * length))
                    cv2.line(canvas, start, end, (100, 230, 255), 2, cv2.LINE_AA)
        else:
            draw_impact(canvas, impact, now, round_.IMPACT_TTL, round_.view)

    # The weather closes in with the night: heavier rain every wave.
    draw_rain(canvas, area, now, drops=min(90 + 35 * round_.wave(now), 240),
              view=round_.view)
    draw_popups(canvas, round_.impacts, now, round_.IMPACT_TTL, round_.view)

    if flash:
        glow = _muzzle_glow(width, height)
        cv2.addWeighted(canvas, 1.0, glow, 0.5, 0.0, dst=canvas)
        draw_muzzle_burst(canvas, area, now)

    # Red at the edges: a bite, and below that, your own pulse in your ears.
    red = 0.0
    if round_.bitten_at is not None:
        red = max(red, 1.0 - min((now - round_.bitten_at) / 0.7, 1.0))
    if 0 < round_.health <= LOW_HEALTH:
        fear = 1.0 - (round_.health - 1) / LOW_HEALTH  # 0.5-ish at two bites left
        period = 1.1 - 0.5 * fear
        red = max(red, (0.12 + 0.5 * _heartbeat(now, period)) * (0.5 + 0.5 * fear))
    if red > 0.0:
        cv2.addWeighted(canvas, 1.0 - 0.35 * red, _vignette(width, height), red, 0.0,
                        dst=canvas)
    draw_footer_strip(canvas, area)
    draw_text(canvas, f"ENEMY: {round_.options.enemy.upper()}",
              (area.x + 18, area.bottom - 12), MOONLIGHT, scale=.45 * round_.options.scale)


def draw_hud(canvas: np.ndarray, round_: ZombieRound, origin: tuple[int, int],
             now: float) -> None:
    """Health, wave and kill count, under the shared score block."""
    x, y = origin
    scale = min(max(canvas.shape[0] / 720.0, 0.7), 2.4)

    def line(offset: float) -> int:
        return y + round(offset * scale)

    bar = Rect(x, line(146), round(240 * scale), round(14 * scale))
    cv2.rectangle(canvas, (bar.x, bar.y), (bar.right, bar.bottom), (30, 28, 27), -1)
    filled = int(bar.width * round_.health / FULL_HEALTH)
    if filled:
        low = round_.health <= LOW_HEALTH
        colour = (60, 60, 210) if low else (96, 150, 104)
        if low:
            colour = _mix(colour, (80, 90, 255), _heartbeat(now, 0.85))
        cv2.rectangle(canvas, (bar.x, bar.y), (bar.x + filled, bar.bottom), colour, -1)
    for tick in range(1, 5):
        tx = bar.x + bar.width * tick // 5
        cv2.line(canvas, (tx, bar.y), (tx, bar.bottom), (20, 20, 20), 1)
    cv2.rectangle(canvas, (bar.x, bar.y), (bar.right, bar.bottom), (120, 116, 110), 1)
    draw_text(canvas, f"WAVE {round_.wave(now)}   {round_.kills} down",
              (x, line(182)), (168, 164, 158), scale=0.6 * scale)


def draw_emblem(panel: np.ndarray) -> None:
    """The card art, from the same renderer as the game: the nearest of them
    almost on you, lit warm by your own shot, the crosshair on its skull, and
    what has already fallen on the road between you."""
    height, width = panel.shape[:2]
    area = Rect(0, 0, width, height)
    view = Perspective.for_area(area, horizon_fraction=0.40)
    panel[:] = _environment((0, 0, width, height), width, height, 7,
                            _skyline(area, 7))
    round_ = ZombieRound.__new__(ZombieRound)
    round_.stains = []
    for distance, lane, seed, age in ((5.2, 1.6, 31, 20.0), (3.4, -1.5, 12, 6.0)):
        figure = Walker(lane=lane, distance=distance, speed=0.7, phase=0.0, sway=0.0,
                        build=1.0, seed=seed).figure(view, 0.0)
        round_.stains.append((figure.x, figure.ground_y, figure.height * 0.18,
                              -age, seed))
    draw_stains(panel, round_, 0.0)
    far = [Walker(lane=lane, distance=distance, speed=0.7, phase=distance, sway=0.2,
                  build=1.0, gait=gait, seed=int(distance * 7), hunch=hunch)
           for distance, lane, gait, hunch in ((12.0, -2.4, "shamble", 0.2),
                                               (7.5, 2.4, "limp", -0.4),
                                               (5.0, -1.3, "lurch", 0.6))]
    for walker in far:
        draw_walker(panel, walker, view, 0.0)
    draw_fog(panel, view, 3.0)
    near = Walker(lane=0.5, distance=2.15, speed=0.7, phase=1.2, sway=0.0, build=1.0,
                  gait="lurch", seed=44, hunch=0.3, tilt=-12.0)
    draw_walker(panel, near, view, 0.0, light=0.5)
    draw_rain(panel, area, 1.0, drops=40, view=view)
    glow = _muzzle_glow(width, height)
    cv2.addWeighted(panel, 1.0, glow, 0.4, 0.0, dst=panel)
    draw_muzzle_burst(panel, area, 0.0)
    # The crosshair, on the skull of the one that is about to reach you: a
    # quiet green ring with a warm core, so it reads against the HUD's green.
    figure = near.figure(view, 0.0)
    centre = (int(figure.head[0]), int(figure.head[1]))
    radius = max(6, int(figure.head_radius * 1.6))
    green = (110, 190, 120)
    cv2.circle(panel, centre, radius, (10, 30, 14), 4, cv2.LINE_AA)
    cv2.circle(panel, centre, radius, green, 2, cv2.LINE_AA)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cv2.line(panel, (centre[0] + dx * radius // 2, centre[1] + dy * radius // 2),
                 (centre[0] + dx * (radius + radius // 2), centre[1] + dy * (radius + radius // 2)),
                 green, 2, cv2.LINE_AA)
    cv2.circle(panel, centre, 3, (10, 20, 30), -1, cv2.LINE_AA)
    cv2.circle(panel, centre, 2, SCORE_INK, -1, cv2.LINE_AA)
