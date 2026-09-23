"""Target range: an indoor lane with straw bosses, and faces that fade in and out.

The hall is built once per window size (wall, lane lights, boards, occlusion)
and copied each frame; targets are pre-rendered sprites keyed by radius, so a
frame costs a backdrop copy plus a few small alpha composites. Everything that
moves (arrows, ring flashes, score popups) is drawn into a small region of
interest around the face rather than through a full-frame overlay.
"""

from __future__ import annotations

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import lru_cache

import cv2
import numpy as np

from ..game import MISS, Hit, Impact, Round

#: Points per ring, from the bullseye outwards.
RING_SCORES = (10, 8, 6, 4, 2)
RINGS = len(RING_SCORES)

#: Ring colours from the bullseye outwards, following World Archery's faces.
RING_COLORS = (
    (0, 215, 255),    # gold
    (55, 45, 225),    # red
    (191, 124, 44),   # blue
    (48, 48, 48),     # black
    (238, 238, 238),  # white
)

HIT = (120, 230, 130)
GOLD = (90, 225, 255)
MISS_MARK = (120, 120, 190)

FADE_IN = 0.25
FADE_OUT = 0.7
IMPACT_FLASH = 0.35
#: The score popup rises and fades over this long.
POPUP_LIFE = 0.65
POPUP_RISE = 30

#: How long a struck face stays up with the arrow in it, and how long it fades.
STRUCK_HOLD = 0.9
STRUCK_FADE = 0.5
#: Seconds between rings lighting up after a hit (from the hit ring outwards).
RING_FLASH_STEP = 0.07
#: Arrow holes the wall remembers.
MAX_HOLES = 80
#: Extra clearance between faces, as a fraction of the new face's radius.
SPAWN_GAP = 0.12
#: The straw boss's radius relative to the paper face pinned to it.
BOSS_SCALE = 1.16
#: Face radii are snapped to this many pixels. A sprite is cached by its exact
#: integer radius, and drawn from a continuous range a round asked for some
#: thirty-five different ones; on this lattice it asks for a dozen, so faces
#: start sharing sprites, and the wall still looks like a wall of different
#: faces. (What keeps a cold build off the frame is the oven further down -
#: this only makes there be fewer of them.)
RADIUS_STEP = 4

# Hall colours, BGR.
WALL = (80, 90, 102)
BOARD_A = (62, 92, 126)
BOARD_B = (56, 84, 116)
SEAM = (34, 48, 64)
LANE_LINE = (150, 170, 190)
SHOOTING_LINE = (70, 190, 230)
STRAW = (92, 150, 190)
STRAW_DARK = (60, 104, 136)
SHAFT_LIGHT = (150, 196, 228)
SHAFT_DARK = (62, 98, 138)
VANE_RED = (60, 60, 220)
VANE_WHITE = (238, 238, 238)


@dataclass(frozen=True)
class Target:
    """A concentric archery target."""

    x: float
    y: float
    radius: float
    spawned_at: float
    lifetime: float

    def age(self, now: float) -> float:
        return now - self.spawned_at

    def is_expired(self, now: float) -> bool:
        return self.age(now) >= self.lifetime

    def ring_at(self, x: float, y: float) -> int | None:
        """Ring index hit by a shot (0 = bullseye), or None for a miss."""
        offset = math.hypot(x - self.x, y - self.y)
        if offset > self.radius:
            return None
        return min(int(offset / (self.radius / RINGS)), RINGS - 1)


@dataclass(frozen=True)
class Struck:
    """A face that has just taken an arrow: it stays up a moment, then fades."""

    target: Target
    ring: int
    x: float
    y: float
    at: float

    def alpha(self, now: float) -> float:
        age = now - self.at
        if age < STRUCK_HOLD:
            return 1.0
        return max(0.0, 1.0 - (age - STRUCK_HOLD) / STRUCK_FADE)


@dataclass
class ArcheryRound(Round):
    """Keeps the field stocked with targets and scores by ring."""

    targets: list[Target] = field(default_factory=list, init=False)
    struck: list[Struck] = field(default_factory=list, init=False, repr=False)
    #: Where missed arrows went into the backstop.
    holes: list[tuple[int, int]] = field(default_factory=list, init=False, repr=False)
    #: Where hits tore through a face: (x, y, radius of the face), kept after
    #: the face has come down so the wall accumulates a round's damage.
    punctures: list[tuple[int, int, float]] = field(default_factory=list, init=False,
                                                    repr=False)
    #: The face each hit scored on, by hit point: (centre x, centre y, radius),
    #: so the score popup can be anchored over the face rather than the rings.
    scored: dict[tuple[float, float], tuple[float, float, float]] = field(
        default_factory=dict, init=False, repr=False)
    _next_spawn: float = field(default=0.0, init=False, repr=False)

    PERFECT_LABEL = "bullseyes"
    RADIUS_RANGE = (48.0, 92.0)

    def advance(self, now: float) -> None:
        self.targets = [t for t in self.targets if not t.is_expired(now)]
        self.struck = [s for s in self.struck if s.alpha(now) > 0.0]
        # An empty range refills at once; otherwise spawns are paced.
        due = now >= self._next_spawn or not self.targets
        if len(self.targets) < self.options.density and due:
            target = self._spawn(now)
            if target is not None:
                self.targets.append(target)
                self._next_spawn = now + self.options.spawn_interval

    def resolve(self, x: float, y: float, now: float) -> Hit:
        """The closest target containing the shot wins, so overlaps never pay twice."""
        best: Target | None = None
        best_offset = float("inf")
        for target in self.targets:
            if target.ring_at(x, y) is None:
                continue
            offset = math.hypot(x - target.x, y - target.y)
            if offset < best_offset:
                best, best_offset = target, offset

        if best is None:
            self.holes.append((int(x), int(y)))
            del self.holes[:-MAX_HOLES]
            return MISS
        ring = best.ring_at(x, y)
        self.targets.remove(best)
        self.struck.append(Struck(target=best, ring=ring, x=x, y=y, at=now))
        self.punctures.append((int(x), int(y), best.radius))
        del self.punctures[:-MAX_HOLES]
        self.scored[(x, y)] = (best.x, best.y, best.radius)
        for key in list(self.scored)[:-MAX_HOLES]:
            del self.scored[key]
        return Hit(points=RING_SCORES[ring], ring=ring, perfect=ring == 0)

    def _spawn(self, now: float) -> Target | None:
        """Place a target clear of every face still on the wall.

        Faces that have just been struck are still drawn while they hold and
        fade, so they count as occupied too: a fresh face must never land on
        top of one the player is still looking at.
        """
        low, high = self.RADIUS_RANGE
        scale = self.options.scale
        radius = _on_lattice(self.rng.uniform(low * scale, high * scale))
        area = self.area
        # Faces hang on the backstop, so the straw boss (a little wider than
        # the paper) must clear the skirting where the wall meets the floor.
        boss = radius * BOSS_SCALE
        wall_bottom = _floor_line(_area_key(self)) - max(2, int(0.012 * area.height))
        low_x, high_x = area.x + boss, area.right - boss
        low_y, high_y = area.y + boss, min(area.bottom, wall_bottom) - boss
        if low_x > high_x or low_y > high_y:
            return None  # play area too small for this radius

        # A struck face is still on the wall while it holds and fades, and it
        # counts at full size: a fresh face never lands on one the player is
        # still looking at, even one that is nearly gone.
        occupied = [(t.x, t.y, t.radius) for t in self.targets]
        occupied += [(s.target.x, s.target.y, s.target.radius) for s in self.struck]
        gap = SPAWN_GAP * radius + (BOSS_SCALE - 1.0) * 2 * radius
        for _ in range(32):
            x = self.rng.uniform(low_x, high_x)
            y = self.rng.uniform(low_y, high_y)
            if all(math.hypot(x - ox, y - oy) > radius + r + gap
                   for ox, oy, r in occupied):
                return Target(x=x, y=y, radius=radius, spawned_at=now,
                              lifetime=self.options.lifetime)
        return None


# --- the hall ---------------------------------------------------------------

def _on_lattice(radius: float) -> float:
    """The nearest radius the sprite cache is likely to be holding already.

    Snapped at spawn rather than at draw time, so the rings a shot is scored
    against are the rings the player sees - the sprite and the hit test read
    the same number.
    """
    return float(max(RADIUS_STEP, RADIUS_STEP * round(radius / RADIUS_STEP)))


def _floor_line(area: tuple[int, int, int, int]) -> int:
    """Where the backstop wall meets the boards."""
    _, top, _, area_height = area
    return int(top + area_height * 0.82)


def _fixture_y(height: int, area: tuple[int, int, int, int]) -> float:
    """How high above the play area the light fixtures hang."""
    _, ay, _, _ = area
    return max(ay - 0.03 * height, 2.0)


def _lamps(width: int, height: int, area: tuple[int, int, int, int]) -> tuple[list[float], float]:
    """The overhead fixtures: one per lane, along the top of the play area."""
    ax, _, aw, _ = area
    lanes = max(1, round(aw / max(1.0, 0.26 * width)))
    return [ax + (i + 0.5) * aw / lanes for i in range(lanes)], _fixture_y(height, area)


def _shadow_lean(x: float, width: int, lamps: list[float]) -> int:
    """Which way a face's shadow falls, quantised: away from the nearest lamp."""
    if not lamps:
        return 0
    nearest = min(lamps, key=lambda lx: abs(lx - x))
    lean = (x - nearest) / max(1.0, 0.15 * width)
    return int(round(max(-3.0, min(3.0, lean * 3.0))))


def _shadow_fall(y: float, height: int, area: tuple[int, int, int, int]) -> int:
    """How far below the fixtures a face hangs, quantised 0..3: lower faces
    throw longer shadows."""
    fixture_y = _fixture_y(height, area)
    wall = max(1.0, _floor_line(area) - fixture_y)
    return int(round(max(0.0, min(3.0, 3.0 * (y - fixture_y) / wall))))


def _variant(target: Target) -> int:
    """Which paper a face is printed on, fixed for the face's lifetime."""
    seed = math.sin(target.x * 0.731 + target.y * 1.213 + target.radius) * 9137.17
    frac = seed - math.floor(seed)
    return 0 if frac < 0.5 else (1 if frac < 0.76 else 2)


def _haze(radius: float, radius_range: tuple[float, float]) -> int:
    """Smaller faces are further down the hall, and sit in its haze (0..3)."""
    low, high = radius_range
    if high <= low:
        return 0
    return int(round(3.0 * max(0.0, min(1.0, (high - radius) / (high - low)))))


@lru_cache(maxsize=6)
def _hall(width: int, height: int, area: tuple[int, int, int, int]) -> np.ndarray:
    """The static range: backstop wall, lane lights, boards, occlusion."""
    ax, ay, aw, ah = area
    floor_y = min(max(_floor_line(area), 1), height - 1)
    lights, fixture_y = _lamps(width, height, area)
    lanes = len(lights)
    rng = np.random.default_rng(3)
    xs = np.arange(width, dtype=np.float32)[None, :]

    # --- the wall: flat paint, then the lights pooling down it. ---
    wall_rows = np.arange(floor_y, dtype=np.float32)[:, None]
    drop = np.clip((wall_rows - fixture_y) / max(1.0, floor_y - fixture_y), 0, 1)
    light = np.zeros((floor_y, width), np.float32)
    for lx in lights:
        # A cone: tight under the tube, opening as it drops, and dimming with
        # the square of the distance so the lower wall falls into shade.
        spread = 0.035 * width + 0.26 * width * drop
        light += np.exp(-((xs - lx) / spread) ** 2) * (1.0 - 0.62 * drop ** 0.8)
    # The housing shades the wall above the tube: only a soft spill gets up there.
    above = np.clip((fixture_y - wall_rows) / max(1.0, 0.08 * height), 0, 1)
    light *= 1.0 - 0.65 * above ** 0.7
    wall_gain = 0.46 + 0.78 * np.clip(light, 0, 1.15)
    wall_gain *= 1.0 - 0.22 * drop ** 1.5
    # Ambient occlusion: the wall/floor junction and the hall's corners.
    wall_gain *= 1.0 - 0.52 * np.exp(-(floor_y - wall_rows) / (0.07 * height))
    wall_gain *= 1.0 - 0.35 * np.exp(-xs / (0.05 * width))
    wall_gain *= 1.0 - 0.35 * np.exp(-(width - 1 - xs) / (0.05 * width))
    wall_gain *= 1.0 - 0.25 * np.exp(-wall_rows / (0.05 * height))
    grain = rng.normal(0.0, 0.018, (floor_y, width)).astype(np.float32)
    wall = np.empty((floor_y, width, 3), np.float32)
    # The lamps are warm: where they pool, the paint goes a touch amber.
    warmth = np.clip(light, 0, 1)[:, :, None] * np.array([-4.0, 2.0, 8.0], np.float32)
    for channel, value in enumerate(WALL):
        wall[:, :, channel] = (value + warmth[:, :, channel]) * (wall_gain + grain)

    # Faint panel seams so the wall reads as a surface, not a gradient.
    course = max(8, int(0.09 * height))
    panel = max(8, int(0.16 * width))
    for y in range(course, floor_y, course):
        wall[y, :] *= 0.93
        shift = (panel // 2) if (y // course) % 2 else 0
        for x in range(shift, width, panel):
            wall[y - course + 1:y, x] *= 0.94

    # A skirting board where the wall meets the floor.
    skirt = max(2, int(0.012 * height))
    wall[floor_y - skirt:floor_y] *= 0.70
    wall[floor_y - skirt - 1] *= 1.15

    canvas = np.zeros((height, width, 3), np.float32)
    canvas[:floor_y] = wall

    # --- the floor: boards running to the wall, under pooled light. ---
    depth = height - floor_y
    cx = width / 2
    # Every board edge converges on one vanishing point above the wall base;
    # ``scale(t)`` is the perspective scale at a fraction t down the floor.
    horizon = 0.9 * depth  # distance of the vanishing point above the floor line
    far = horizon / (horizon + depth)

    def scale(t: float) -> float:
        return (t * depth + horizon) / (horizon + depth)

    def row_at(z: float) -> int:
        """Screen row of a point at world distance z (0 near .. 1 far)."""
        s = 1.0 / (1.0 + z * (1.0 / far - 1.0))
        return int((s * (horizon + depth) - horizon) / max(1, depth) * depth)

    floor = np.zeros((depth, width, 3), np.uint8)
    planks = max(8, int(width / 52))
    plank_w = width / planks * 1.35
    edges = [(i - planks / 2) * plank_w for i in range(planks + 1)]
    for i in range(planks):
        near = (cx + edges[i], cx + edges[i + 1])
        far_x = (cx + edges[i] * far, cx + edges[i + 1] * far)
        poly = np.array([[far_x[0], 0], [far_x[1], 0],
                         [near[1], depth], [near[0], depth]], np.int32)
        tone = BOARD_A if i % 2 else BOARD_B
        wobble = int(rng.integers(-7, 8))
        cv2.fillPoly(floor, [poly], tuple(int(c + wobble) for c in tone), cv2.LINE_AA)
        # Wood grain: a few faint streaks running the board's length.
        for _ in range(3):
            g = float(rng.uniform(0.15, 0.85))
            gx_near = cx + (edges[i] + g * plank_w)
            cv2.line(floor, (int(cx + (gx_near - cx) * far), 0), (int(gx_near), depth),
                     tuple(int(c + wobble - 5) for c in tone), 1, cv2.LINE_AA)
        cv2.line(floor, (int(far_x[0]), 0), (int(near[0]), depth), SEAM, 1, cv2.LINE_AA)
        # Board ends, staggered, spaced in perspective: denser towards the wall.
        z = float(rng.uniform(0.0, 0.3))
        while z < 1.0:
            y = row_at(z)
            if 2 < y < depth - 2:
                s = scale(y / depth)
                cv2.line(floor, (int(cx + edges[i] * s), y),
                         (int(cx + edges[i + 1] * s), y), SEAM, 1, cv2.LINE_AA)
            z += float(rng.uniform(0.22, 0.42))
    # Lane dividers, and the shooting line kept well clear of the footer text.
    for i in range(lanes + 1):
        x_near = ax + i * aw / lanes
        x_far = cx + (x_near - cx) * far
        cv2.line(floor, (int(x_far), 0), (int(x_near), depth), LANE_LINE, 2, cv2.LINE_AA)
    t_line = 0.42
    s_line = scale(t_line)
    y_line = int(t_line * depth)
    cv2.line(floor, (int(cx + (ax - cx) * s_line), y_line),
             (int(cx + (ax + aw - cx) * s_line), y_line), SHOOTING_LINE,
             max(2, int(0.005 * height)), cv2.LINE_AA)

    floor_rows = np.arange(depth, dtype=np.float32)[:, None]
    t = floor_rows / max(1, depth)
    s_rows = (t * depth + horizon) / (horizon + depth)
    world_x = cx + (xs - cx) / s_rows
    pool = np.zeros((depth, width), np.float32)
    for lx in lights:
        pool += (np.exp(-((world_x - lx) / (0.085 * width)) ** 2)
                 * np.exp(-((t - 0.10) / 0.40) ** 2))
    pool = np.clip(pool, 0, 1.1)
    floor_gain = 0.34 + 0.72 * pool
    # The floor falls away from the wall's light into the dark of the hall.
    floor_gain *= 1.0 - 0.30 * t ** 1.3
    floor_gain *= 1.0 - 0.46 * np.exp(-floor_rows / (0.035 * height))
    floor_gain *= 1.0 - 0.30 * np.exp(-xs / (0.05 * width))
    floor_gain *= 1.0 - 0.30 * np.exp(-(width - 1 - xs) / (0.05 * width))
    floor_gain *= 1.0 - 0.25 * np.exp(-(depth - 1 - floor_rows) / (0.06 * height))
    # The hint text sits below the play area: a soft dark band grounds it so
    # it is not floating on the boards.
    band_top = max(0, min(depth, ay + ah - floor_y))
    band = np.clip((floor_rows - band_top + 0.02 * height) / max(1.0, depth - band_top), 0, 1)
    floor_gain *= 1.0 - 0.55 * band ** 0.8
    lit_floor = floor.astype(np.float32) * floor_gain[:, :, None]
    # Varnish: the pooled light reflects as a soft, slightly desaturated sheen,
    # and each tube leaves a gloss streak on the boards straight beneath it,
    # stretched towards the viewer and broken up by the board seams.
    sheen = (pool ** 2 * np.exp(-t / 0.35))[:, :, None] * np.array([30.0, 32.0, 34.0], np.float32)
    gloss = np.zeros((depth, width), np.float32)
    for lx in lights:
        gloss += (np.exp(-((xs - lx) / (0.022 * width + 0.04 * width * t)) ** 2)
                  * np.exp(-t / 0.26))
    seams = (floor.max(axis=2) <= max(SEAM) + 2).astype(np.float32)
    gloss *= 1.0 - 0.6 * seams
    gloss = cv2.GaussianBlur(gloss, (0, 0), 1.2)
    gloss = gloss[:, :, None] * np.array([150.0, 172.0, 188.0], np.float32)
    canvas[floor_y:] = lit_floor + ((sheen + gloss) * (1.0 - band)[:, :, None])
    # The junction: a tight occlusion band where boards meet the skirting.
    junction = np.exp(-np.abs(np.arange(height, dtype=np.float32) - floor_y) / (0.012 * height))
    canvas *= (1.0 - 0.35 * junction)[:, None, None]

    # --- the fixtures: a rounded housing, a tube with a soft halo, and the
    # bloom the wall catches beneath it. ---
    fy = int(fixture_y)
    half_w, half_h = int(0.045 * aw), max(2, int(0.006 * height))
    halo = np.zeros((height, width, 3), np.float32)
    tube = np.zeros((height, width, 3), np.float32)
    for lx in lights:
        x = int(lx)
        # The halo: a wide, faint glow round the tube, and the wash downwards.
        cv2.ellipse(halo, (x, fy), (int(half_w * 1.5), half_h * 6),
                    0, 0, 360, (150, 185, 205), -1, cv2.LINE_AA)
        cv2.ellipse(halo, (x, fy + half_h), (int(half_w * 1.6), half_h * 5),
                    0, 0, 360, (70, 85, 95), -1, cv2.LINE_AA)
        # The housing: a dark rounded bar with a lit underside.
        _rounded(canvas, (x - half_w - 4, fy - half_h - 4),
                 (x + half_w + 4, fy + half_h + 4), (28, 30, 33), half_h + 3)
        _rounded(canvas, (x - half_w - 2, fy + half_h - 1),
                 (x + half_w + 2, fy + half_h + 4), (74, 82, 90), 2)
        # The tube itself, a warm white with a brighter core.
        _rounded(tube, (x - half_w, fy - half_h), (x + half_w, fy + half_h),
                 (215, 232, 242), half_h)
        _rounded(tube, (x - half_w + 2, fy - half_h // 2),
                 (x + half_w - 2, fy + half_h // 2), (250, 253, 255), max(1, half_h // 2))
    halo = cv2.GaussianBlur(halo, (0, 0), max(1.0, 0.02 * height))
    canvas += halo
    tube_mask = cv2.GaussianBlur(tube.max(axis=2), (0, 0), 0.8)[:, :, None] > 8
    bloom = cv2.GaussianBlur(tube, (0, 0), max(1.0, 0.004 * height)) * 0.8
    canvas += bloom
    np.copyto(canvas, tube, where=np.repeat(tube_mask, 3, axis=2))
    return np.clip(canvas, 0, 255).astype(np.uint8)


def _rounded(image: np.ndarray, top_left: tuple[int, int], bottom_right: tuple[int, int],
             colour: tuple, radius: int) -> None:
    """A filled rectangle with rounded corners."""
    (x0, y0), (x1, y1) = top_left, bottom_right
    radius = max(1, min(radius, (x1 - x0) // 2, (y1 - y0) // 2))
    cv2.rectangle(image, (x0 + radius, y0), (x1 - radius, y1), colour, -1, cv2.LINE_AA)
    cv2.rectangle(image, (x0, y0 + radius), (x1, y1 - radius), colour, -1, cv2.LINE_AA)
    for cx in (x0 + radius, x1 - radius):
        for cy in (y0 + radius, y1 - radius):
            cv2.circle(image, (cx, cy), radius, colour, -1, cv2.LINE_AA)


# --- the faces --------------------------------------------------------------

def _build_face_sprite(radius: int, lean: int = 0, variant: int = 0, haze: int = 0,
                       fall: int = 1) -> tuple[np.ndarray, np.ndarray, int]:
    """A boss with its paper face, pre-composited with an alpha mask.

    ``lean`` is which way the overhead light throws the shadow (-3..3, left to
    right), so faces under a lamp shadow straight down and faces off to its
    side shadow away from it; ``fall`` (0..3) is how far below the fixture the
    face hangs, which lengthens the shadow. ``variant`` picks the paper: 0 a
    round face, 1 a square sheet with a scored tally, 2 a round face with a
    torn edge. ``haze`` (0..3) is depth: far faces lose contrast and colour.

    Returns (premultiplied BGR float32, alpha float32, margin) where margin is
    the distance from the sprite's edge to the face centre, i.e. the sprite is
    ``2 * margin`` square and the face sits at its middle.
    """
    r = max(radius, 4)
    boss_r = int(r * BOSS_SCALE)
    margin = int(boss_r * 1.7)
    size = 2 * margin
    c = (margin, margin)
    rng = np.random.default_rng(r * 7 + variant)
    lean = max(-3, min(3, lean))
    fall = max(0, min(3, fall))
    haze = max(0, min(3, haze))

    colour = np.zeros((size, size, 3), np.float32)  # premultiplied
    alpha = np.zeros((size, size), np.float32)

    def over(layer: np.ndarray, layer_alpha: np.ndarray) -> None:
        nonlocal colour, alpha
        a = layer_alpha[:, :, None]
        colour = layer * a + colour * (1.0 - a)
        alpha = layer_alpha + alpha * (1.0 - layer_alpha)

    # Shadow cast on the wall by the overhead lights: downwards, thrown away
    # from the nearest lamp and longer the further below it the face hangs;
    # soft at the edge and dense at the contact.
    shadow = np.zeros((size, size), np.float32)
    sx = int((0.10 + 0.03 * fall) * r * lean)
    sy = int((0.16 + 0.07 * fall) * r)
    cv2.circle(shadow, (c[0] + sx, c[1] + sy), int(boss_r * 1.04), 0.70, -1, cv2.LINE_AA)
    shadow = cv2.GaussianBlur(shadow, (0, 0), max(1.5, (0.10 + 0.03 * fall) * r))
    contact = np.zeros((size, size), np.float32)
    cv2.circle(contact, (c[0] + sx // 3, c[1] + int(0.08 * r)),
               int(boss_r * 1.0), 0.5, -1, cv2.LINE_AA)
    contact = cv2.GaussianBlur(contact, (0, 0), max(1.0, 0.05 * r))
    over(np.zeros((size, size, 3), np.float32), np.clip(shadow + contact, 0, 0.85))

    # The straw boss: a coiled disc, lit from above, with a darker rim.
    boss = np.zeros((size, size, 3), np.uint8)
    cv2.circle(boss, c, boss_r, STRAW, -1, cv2.LINE_AA)
    for ring_r in range(4, boss_r, max(3, int(0.05 * r))):
        cv2.circle(boss, c, ring_r, STRAW_DARK, 1, cv2.LINE_AA)
    boss = boss.astype(np.float32)
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    dist = np.hypot(xs - c[0], ys - c[1])
    shade = np.clip(1.0 - 0.45 * ((dist / boss_r) ** 4), 0.4, 1.0)
    shade *= 1.0 - 0.14 * np.clip((ys - c[1]) / boss_r, -1, 1)
    boss *= (shade * (1.0 + rng.normal(0.0, 0.04, (size, size))))[:, :, None]
    boss_mask = np.zeros((size, size), np.float32)
    cv2.circle(boss_mask, c, boss_r, 1.0, -1, cv2.LINE_AA)
    over(np.clip(boss, 0, 255), boss_mask)

    # The paper: its outline depends on the variant, the rings never do.
    paper_mask = np.zeros((size, size), np.float32)
    if variant == 1:
        half = int(r * 1.04)
        tilt = float(rng.uniform(-0.05, 0.05))
        box = cv2.boxPoints(((c[0], c[1]), (2 * half, 2 * half), math.degrees(tilt)))
        cv2.fillPoly(paper_mask, [np.round(box).astype(np.int32)], 1.0, cv2.LINE_AA)
    elif variant == 2:
        angles = np.linspace(0, 2 * math.pi, 28, endpoint=False)
        wobble = r * (1.06 + rng.uniform(-0.06, 0.05, angles.size))
        wobble[int(rng.integers(0, 28))] *= 0.93  # one bite out of the edge
        pts = np.stack([c[0] + np.cos(angles) * wobble, c[1] + np.sin(angles) * wobble], 1)
        cv2.fillPoly(paper_mask, [np.round(pts).astype(np.int32)], 1.0, cv2.LINE_AA)
    else:
        cv2.circle(paper_mask, c, r, 1.0, -1, cv2.LINE_AA)
    face = np.zeros((size, size, 3), np.uint8)
    face[:] = RING_COLORS[-1]
    # The rings, outermost first. Exactly the hittable geometry.
    for ring in reversed(range(RINGS)):
        cv2.circle(face, c, int(round(r * (ring + 1) / RINGS)),
                   RING_COLORS[ring], -1, cv2.LINE_AA)
    for ring in range(RINGS):
        cv2.circle(face, c, int(round(r * (ring + 1) / RINGS)),
                   (36, 36, 36), 1, cv2.LINE_AA)
    # The inner ten, and the cross at the centre.
    cv2.circle(face, c, max(2, int(r * 0.1)), (36, 36, 36), 1, cv2.LINE_AA)
    if variant in (1, 2):
        # A scored tally in the corner, in pencil, from an earlier end.
        tx, ty = c[0] + int(r * (0.72 if variant == 1 else 0.62)), c[1] - int(r * 0.78)
        step = max(2, int(r * 0.055))
        for k in range(int(rng.integers(3, 6))):
            cv2.line(face, (tx + k * step, ty), (tx + k * step - 1, ty + 3 * step),
                     (120, 120, 128), 1, cv2.LINE_AA)
        cv2.line(face, (tx - 1, ty + 3 * step - 1), (tx + 4 * step, ty + 1),
                 (120, 120, 128), 1, cv2.LINE_AA)
    face = face.astype(np.float32)
    paper = 1.0 + rng.normal(0.0, 0.035, (size, size)).astype(np.float32)
    paper = cv2.GaussianBlur(paper, (0, 0), 0.8)
    paper *= 1.0 - 0.08 * np.clip(dist / r, 0, 1) ** 2  # a touch of curl shading
    face *= paper[:, :, None]
    # The paper's own thin shadow on the straw, where it lifts at the edge.
    paper_shadow = cv2.GaussianBlur(
        np.roll(paper_mask, (2, 2), axis=(0, 1)) * 0.45, (0, 0), 1.5)
    over(np.zeros((size, size, 3), np.float32), paper_shadow * (1 - paper_mask))
    over(np.clip(face, 0, 255), paper_mask)

    # Pins holding the paper on: one at each compass point, each with a shadow.
    pin_r = max(2, int(0.045 * r))
    pins = np.zeros((size, size, 3), np.float32)
    pins_mask = np.zeros((size, size), np.float32)
    reach = 0.9 if variant != 1 else 0.96
    spots = ((0, -1), (0, 1), (-1, 0), (1, 0))
    if variant == 1:
        spots = ((-0.72, -0.72), (0.72, -0.72), (-0.72, 0.72), (0.72, 0.72))
        reach = 1.3
    for dx, dy in spots:
        px, py = c[0] + int(dx * r * reach), c[1] + int(dy * r * reach)
        cv2.circle(pins_mask, (px + 1, py + 2), pin_r + 1, 0.5, -1, cv2.LINE_AA)
    pins_shadow = cv2.GaussianBlur(pins_mask, (0, 0), 1.0)
    over(pins, pins_shadow)
    pins_mask[:] = 0
    for dx, dy in spots:
        px, py = c[0] + int(dx * r * reach), c[1] + int(dy * r * reach)
        cv2.circle(pins, (px, py), pin_r, (60, 70, 80), -1, cv2.LINE_AA)
        cv2.circle(pins, (px - pin_r // 3, py - pin_r // 3), max(1, pin_r // 2),
                   (200, 210, 215), -1, cv2.LINE_AA)
        cv2.circle(pins_mask, (px, py), pin_r, 1.0, -1, cv2.LINE_AA)
    over(pins, pins_mask)

    # The lamps catch the top of the straw and the paper's upper edge: a warm
    # rim that fades round the sides, biased a little towards the light.
    rim = np.zeros((size, size), np.float32)
    cv2.circle(rim, c, boss_r - 1, 1.0, max(2, int(0.06 * r)), cv2.LINE_AA)
    cv2.circle(rim, c, r, 0.7, max(1, int(0.03 * r)), cv2.LINE_AA)
    rim = cv2.GaussianBlur(rim, (0, 0), max(1.0, 0.03 * r))
    angle = np.arctan2(ys - c[1], xs - c[0])  # -pi/2 is straight up
    facing = np.cos(angle + math.pi / 2 + 0.25 * lean)
    rim *= np.clip(facing, 0, 1) ** 1.6 * 0.85
    warm = np.array([170.0, 215.0, 245.0], np.float32)
    colour = colour + (warm - colour) * rim[:, :, None] * alpha[:, :, None] * 0.9

    if haze:
        # Depth: the far end of the hall is a little dimmer and greyer, and
        # its colours sit closer to the wall they hang on.
        amount = 0.09 * haze
        grey = colour.mean(axis=2, keepdims=True)
        colour = colour + (grey - colour) * amount
        wall = np.array(WALL, np.float32) * 0.9 * alpha[:, :, None]
        colour = colour * (1.0 - 0.25 * amount) + wall * 0.35 * amount
    return colour, alpha, margin


def _composite(canvas: np.ndarray, colour: np.ndarray, alpha: np.ndarray,
               x: int, y: int, strength: float) -> None:
    """Alpha-composite a premultiplied sprite centred at (x, y), clipped."""
    if strength <= 0.0:
        return
    size = alpha.shape[0]
    margin = size // 2
    height, width = canvas.shape[:2]
    x0, y0 = x - margin, y - margin
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1, sy1 = size - max(0, x0 + size - width), size - max(0, y0 + size - height)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    roi = canvas[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1]
    a = alpha[sy0:sy1, sx0:sx1, None] * strength
    mixed = roi.astype(np.float32) * (1.0 - a) + colour[sy0:sy1, sx0:sx1] * strength
    roi[:] = mixed.astype(np.uint8)


def _roi(canvas: np.ndarray, x: int, y: int, reach: int) -> tuple[np.ndarray, int, int]:
    """A view of the canvas around (x, y), and the offset to draw through it."""
    height, width = canvas.shape[:2]
    x0, y0 = max(0, x - reach), max(0, y - reach)
    x1, y1 = min(width, x + reach), min(height, y + reach)
    return canvas[y0:y1, x0:x1], x0, y0


def target_alpha(target: Target, now: float) -> float:
    """Targets fade in when they appear and fade out as they time out."""
    age = target.age(now)
    remaining = target.lifetime - age
    if age < FADE_IN:
        return max(0.0, age / FADE_IN)
    if remaining < FADE_OUT:
        return max(0.0, remaining / FADE_OUT)
    return 1.0


# --- keeping the cold builds off the frame ----------------------------------
#
# A sprite is keyed by its radius AND by its lighting, paper and depth, so
# every face on the wall wants one of its own and a round's worth of faces is a
# round's worth of cold builds. One is several full-size Gaussian blurs over a
# float buffer - 6 ms for a small face, 25 for a big one - and done inline it
# lands in the very frame the face first appears in, which is a visibly dropped
# frame every time, on the map that is meant to be the calm one. Quantising the
# radius is not enough on its own: it collapses the radii, but the lighting,
# paper and depth still give nearly every face a key of its own.
#
# A face fades in over FADE_IN seconds, though, and for the first of them it is
# barely there. That is the window: the build goes to a worker, the face is not
# drawn until its sprite is ready, and if the fade runs out first the frame
# pays for it after all rather than leave a face missing.

_SPRITE_OVEN = ThreadPoolExecutor(max_workers=1, thread_name_prefix="archery-faces")
#: How many built faces the wall keeps. A round wants one per face standing,
#: plus the few still fading out; past that the oldest is dropped, which is
#: what stops an endless round from remembering every face it ever showed.
SPRITE_CACHE = 96
#: Below this much of its fade a face can wait for its sprite; above it, not.
SPRITE_PATIENCE = 0.6

_sprites: dict[tuple, tuple] = {}
_baking: set[tuple] = set()
_sprite_lock = threading.Lock()


def _face_sprite(radius: int, lean: int = 0, variant: int = 0, haze: int = 0,
                 fall: int = 1) -> tuple[np.ndarray, np.ndarray, int]:
    """The built sprite for one face, building it here if it is not ready.

    An explicit cache rather than ``lru_cache`` so that :func:`_sprite_for` can
    ask whether a sprite exists without building it.
    """
    key = (radius, lean, variant, haze, fall)
    sprite = _sprites.get(key)
    if sprite is not None:
        return sprite
    sprite = _build_face_sprite(*key)
    with _sprite_lock:
        _sprites[key] = sprite
        while len(_sprites) > SPRITE_CACHE:
            del _sprites[next(iter(_sprites))]  # insertion order: the oldest goes
    return sprite


def _bake(key: tuple) -> None:
    try:
        _face_sprite(*key)
    finally:
        _baking.discard(key)


def _sprite_for(key: tuple, urgent: bool):
    """The sprite for this face, or None while a worker is still building it."""
    sprite = _sprites.get(key)
    if sprite is not None:
        return sprite
    if urgent:
        return _face_sprite(*key)
    if key not in _baking:
        _baking.add(key)
        _SPRITE_OVEN.submit(_bake, key)
    return None


def _draw_face(canvas: np.ndarray, target: Target, strength: float,
               lean: int = 0, haze: int = 0, fall: int = 1) -> None:
    key = (int(round(target.radius)), lean, _variant(target), haze, fall)
    if strength <= 0.0:
        _sprite_for(key, urgent=False)  # invisible, but its build can start now
        return
    sprite = _sprite_for(key, urgent=strength >= SPRITE_PATIENCE)
    if sprite is None:
        return  # still faint, and its sprite is on its way
    colour, alpha, _ = sprite
    _composite(canvas, colour, alpha, int(round(target.x)), int(round(target.y)),
               strength)


def draw_target(canvas: np.ndarray, target: Target, now: float,
                lean: int = 0, haze: int = 0, fall: int = 1) -> None:
    _draw_face(canvas, target, target_alpha(target, now), lean, haze, fall)


def _arrow_angle(x: float, y: float, width: int, height: int) -> float:
    """The lean of the arrow that landed at (x, y).

    Seen from the shooting line, the shaft points back towards the archer at
    the near end of the lane, so the tail sits below the tip and swings
    outwards the further off-centre the hit; a little per-shot scatter on top
    so no two arrows stand alike.
    """
    seed = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    frac = seed - math.floor(seed)
    shooter = (width * 0.5, height * 1.35)
    towards = math.atan2(shooter[1] - y, shooter[0] - x)
    return towards + math.radians(-38 + 76 * frac)


def _draw_tear(roi: np.ndarray, tip: tuple[int, int], size: int,
               seed: float) -> None:
    """Torn paper round a puncture: a dark hole and a few curling flaps."""
    rng = np.random.default_rng(int(seed) & 0xFFFF)
    for _ in range(4):
        angle = rng.uniform(0, 2 * math.pi)
        reach = size * rng.uniform(1.2, 2.2)
        end = (int(tip[0] + math.cos(angle) * reach), int(tip[1] + math.sin(angle) * reach))
        cv2.line(roi, tip, end, (28, 28, 30), 1, cv2.LINE_AA)
        lift = (int(end[0] - math.sin(angle) * 2), int(end[1] + math.cos(angle) * 2))
        cv2.line(roi, end, lift, (214, 216, 218), 1, cv2.LINE_AA)
    cv2.circle(roi, tip, size, (16, 16, 16), -1, cv2.LINE_AA)
    cv2.circle(roi, tip, size + 1, (70, 66, 60), 1, cv2.LINE_AA)


def _draw_arrow(canvas: np.ndarray, x: int, y: int, length: float,
                alpha: float) -> None:
    """An arrow standing in the face, seen from behind and slightly above."""
    if alpha <= 0.0 or length < 4:
        return
    angle = _arrow_angle(x, y, canvas.shape[1], canvas.shape[0])
    length *= 0.85 + 0.3 * abs(math.cos(angle))  # side-on shafts foreshorten less
    ux, uy = math.cos(angle), math.sin(angle)
    px, py = -uy, ux  # perpendicular, for the vanes and the highlight
    reach = int(length * 1.3) + 12
    roi, ox, oy = _roi(canvas, x, y, reach)
    if roi.size == 0:
        return
    base = roi.copy() if alpha < 1.0 else None
    tip = (x - ox, y - oy)

    def at(d: float, side: float = 0.0) -> tuple[int, int]:
        return (int(round(tip[0] + ux * d + px * side)),
                int(round(tip[1] + uy * d + py * side)))

    thick = max(3, int(length * 0.075))
    # The shaft's cast shadow on the paper: offset down-right, soft, partial;
    # then a tight, dark contact shadow right under the shaft so it sits on
    # the face rather than floating over it.
    shade = roi.copy()
    cv2.line(shade, (tip[0] + 3, tip[1] + 5), (at(length)[0] + 4, at(length)[1] + 7),
             (18, 18, 18), thick + 3, cv2.LINE_AA)
    cv2.addWeighted(shade, 0.40, roi, 0.60, 0.0, dst=roi)
    shade[:] = roi
    cv2.line(shade, (tip[0] + 1, tip[1] + 2), (at(length)[0] + 1, at(length)[1] + 2),
             (10, 10, 12), thick + 1, cv2.LINE_AA)
    cv2.addWeighted(shade, 0.75, roi, 0.25, 0.0, dst=roi)

    # The shaft: a gradient from the dark, buried point to the pale nock, a
    # darker lower edge, and a bright metallic highlight along the upper one.
    steps = 7
    for i in range(steps):
        f0, f1 = i / steps, (i + 1) / steps
        mix = f0 ** 0.8
        colour = tuple(int(SHAFT_DARK[k] + (SHAFT_LIGHT[k] - SHAFT_DARK[k]) * mix)
                       for k in range(3))
        cv2.line(roi, at(length * f0), at(length * f1 + 0.5), colour, thick, cv2.LINE_AA)
    cv2.line(roi, at(length * 0.05, thick * 0.4), at(length * 0.95, thick * 0.4),
             (40, 62, 90), 1, cv2.LINE_AA)
    cv2.line(roi, at(length * 0.05, -thick * 0.3), at(length * 0.95, -thick * 0.3),
             (236, 246, 252), 1, cv2.LINE_AA)
    cv2.line(roi, at(length * 0.30, -thick * 0.3), at(length * 0.60, -thick * 0.3),
             (255, 255, 255), 1, cv2.LINE_AA)
    # The point: a short steel pile at the tip, brighter than the wood.
    cv2.line(roi, at(0), at(min(length * 0.12, thick * 1.8)), (150, 160, 170),
             max(2, thick - 1), cv2.LINE_AA)

    # Fletching: three vanes near the nock, two cock-feather reds and a white.
    # Each vane is two-tone, split along its spine where the light turns.
    span = max(4, int(0.26 * length))
    vane_start, vane_end = length * 0.70, length * 0.92
    for side, colour in ((-1.0, VANE_RED), (1.0, VANE_RED)):
        lit = tuple(min(255, int(c * 1.25 + 18)) for c in colour)
        dark = tuple(int(c * 0.62) for c in colour)
        outer = at(vane_start + 0.12 * length, side * span)
        trail = at(vane_end, side * span * 0.7)
        mid_a = at(vane_start + 0.10 * length, side * span * 0.45)
        mid_b = at(vane_end, side * span * 0.32)
        front = np.array([at(vane_start), outer, trail, mid_b, mid_a], np.int32)
        back = np.array([at(vane_start), mid_a, mid_b, at(vane_end)], np.int32)
        cv2.fillPoly(roi, [front], lit if side < 0 else dark, cv2.LINE_AA)
        cv2.fillPoly(roi, [back], dark if side < 0 else colour, cv2.LINE_AA)
        cv2.line(roi, mid_a, mid_b, (30, 30, 48), 1, cv2.LINE_AA)
        poly = np.array([at(vane_start), outer, trail, at(vane_end)], np.int32)
        cv2.polylines(roi, [poly], True, (40, 40, 60), 1, cv2.LINE_AA)
    top = np.array([at(vane_start, -thick * 0.3), at(vane_start + 0.1 * length, -thick * 0.9),
                    at(vane_end, -thick * 0.8), at(vane_end, -thick * 0.2)], np.int32)
    cv2.fillPoly(roi, [top], VANE_WHITE, cv2.LINE_AA)
    cv2.line(roi, at(vane_start + 0.1 * length, -thick * 0.6), at(vane_end, -thick * 0.5),
             (170, 176, 182), 1, cv2.LINE_AA)
    # The nock, and the torn paper where the point went in.
    cv2.circle(roi, at(length), max(2, thick // 2 + 1), (36, 36, 40), -1, cv2.LINE_AA)
    _draw_tear(roi, tip, max(2, thick // 2 + 1), x * 7 + y * 13)

    if base is not None:
        cv2.addWeighted(roi, alpha, base, 1.0 - alpha, 0.0, dst=roi)


def _draw_struck(canvas: np.ndarray, struck: Struck, now: float,
                 lean: int = 0, haze: int = 0, fall: int = 1) -> None:
    """The face the arrow just landed in: rings flash outwards, arrow stays."""
    strength = struck.alpha(now)
    if strength <= 0.0:
        return
    target = struck.target
    _draw_face(canvas, target, strength, lean, haze, fall)
    cx, cy = int(round(target.x)), int(round(target.y))
    age = now - struck.at

    # Ring-by-ring flash: the struck ring lights first, then each one outward.
    lit = int(age / RING_FLASH_STEP)
    roi, ox, oy = _roi(canvas, cx, cy, int(target.radius) + 6)
    centre = (cx - ox, cy - oy)
    overlay = None
    for ring in range(struck.ring, RINGS):
        step = ring - struck.ring
        if step > lit:
            break
        glow = max(0.0, 1.0 - (age - step * RING_FLASH_STEP) / (RING_FLASH_STEP * 4))
        if glow <= 0.0:
            continue
        if overlay is None:
            overlay = roi.copy()
        outer = int(round(target.radius * (ring + 1) / RINGS))
        inner = int(round(target.radius * ring / RINGS))
        width = max(2, outer - inner)
        colour = GOLD if struck.ring == 0 else (235, 245, 250)
        cv2.circle(overlay, centre, (outer + inner) // 2 + 1, colour, width, cv2.LINE_AA)
        cv2.addWeighted(overlay, 0.55 * glow, roi, 1.0 - 0.55 * glow, 0.0, dst=roi)
        overlay[:] = roi
    _draw_arrow(canvas, int(round(struck.x)), int(round(struck.y)),
                0.78 * target.radius, strength)


@lru_cache(maxsize=16)
def _hole_sprite(kind: int) -> tuple[np.ndarray, np.ndarray]:
    """A miss in the plaster: a dark hole of 3-5px with a chipped, lighter
    halo where the paint flaked, and a few hairline cracks radiating out.

    Returns (premultiplied BGR float32, alpha float32), a square sprite.
    """
    rng = np.random.default_rng(kind * 101 + 5)
    hole_r = int(rng.integers(3, 6))
    size = 34
    c = size // 2
    colour = np.zeros((size, size, 3), np.float32)
    alpha = np.zeros((size, size), np.float32)

    def over(layer: np.ndarray, layer_alpha: np.ndarray) -> None:
        nonlocal colour, alpha
        a = layer_alpha[:, :, None]
        colour = layer * a + colour * (1.0 - a)
        alpha = layer_alpha + alpha * (1.0 - layer_alpha)

    # Flaked plaster: a pale, uneven halo, denser nearer the hole.
    halo_mask = np.zeros((size, size), np.float32)
    angles = np.linspace(0, 2 * math.pi, 12, endpoint=False)
    reach = hole_r * rng.uniform(1.7, 2.8, angles.size)
    pts = np.stack([c + np.cos(angles) * reach, c + np.sin(angles) * reach], 1)
    cv2.fillPoly(halo_mask, [np.round(pts).astype(np.int32)], 0.85, cv2.LINE_AA)
    halo_mask = cv2.GaussianBlur(halo_mask, (0, 0), 1.0)
    halo = np.zeros((size, size, 3), np.float32)
    halo[:] = (168, 178, 188)
    over(halo, halo_mask)
    # Hairline cracks out of the hole, kinked once on the way.
    crack_layer = np.zeros((size, size, 3), np.float32)
    crack_mask = np.zeros((size, size), np.float32)
    for _ in range(int(rng.integers(2, 4))):
        a = float(rng.uniform(0, 2 * math.pi))
        length = hole_r * float(rng.uniform(2.2, 3.6))
        bend = a + float(rng.uniform(-0.5, 0.5))
        knee = (c + math.cos(a) * length * 0.5, c + math.sin(a) * length * 0.5)
        tail = (knee[0] + math.cos(bend) * length * 0.5, knee[1] + math.sin(bend) * length * 0.5)
        pts = np.array([[c, c], knee, tail], np.int32)
        cv2.polylines(crack_mask, [pts], False, 1.0, 1, cv2.LINE_AA)
    over(crack_layer + (20, 22, 24), crack_mask)
    # The hole: a dark core, a chipped edge that catches the light low-right.
    rim = np.zeros((size, size), np.float32)
    cv2.circle(rim, (c + 1, c + 1), hole_r + 1, 0.7, -1, cv2.LINE_AA)
    over(crack_layer + (178, 186, 192), rim)
    core = np.zeros((size, size), np.float32)
    cv2.circle(core, (c, c), hole_r, 1.0, -1, cv2.LINE_AA)
    over(crack_layer + (16, 18, 20), core)
    inner = np.zeros((size, size), np.float32)
    cv2.circle(inner, (c - 1, c - 1), max(1, hole_r - 2), 0.6, -1, cv2.LINE_AA)
    over(crack_layer + (48, 50, 54), inner)
    # Flakes: a chip or two of paint lifted beside the hole.
    for _ in range(int(rng.integers(0, 3))):
        a = float(rng.uniform(0, 2 * math.pi))
        d = hole_r * float(rng.uniform(1.6, 2.6))
        chip = np.zeros((size, size), np.float32)
        cv2.circle(chip, (int(c + math.cos(a) * d), int(c + math.sin(a) * d)),
                   int(rng.integers(1, 3)), 0.8, -1, cv2.LINE_AA)
        over(crack_layer + (36, 38, 42), chip)
    return colour, alpha


def _hole_kind(x: int, y: int) -> int:
    return (x * 73856093 ^ y * 19349663) % 16


def _draw_holes(canvas: np.ndarray, holes: list[tuple[int, int]],
                punctures: list[tuple[int, int, float]]) -> None:
    """Where arrows went into the backstop: cracked holes for misses, and the
    ragged punctures left behind where a face was shot through."""
    for x, y in holes:
        kind = _hole_kind(x, y)
        colour, alpha = _hole_sprite(kind)
        _composite(canvas, colour, alpha, x, y, 1.0)
        # Some misses came in as a pair: a second, smaller strike close by.
        if kind % 5 == 0:
            colour, alpha = _hole_sprite((kind * 7 + 3) % 16)
            _composite(canvas, colour, alpha, x + 6 + kind % 4, y - 4 + kind % 3, 0.85)
    for x, y, radius in punctures:
        # The backstop behind a face takes the same cracked hole, with a
        # wider scuff where the boss ground against the plaster.
        kind = _hole_kind(x * 3 + 1, y * 5 + 2)
        roi, ox, oy = _roi(canvas, x, y, 16)
        if roi.size == 0:
            continue
        scuff = roi.copy()
        cv2.circle(scuff, (x - ox, y - oy + 2), 7 + (radius > 70) * 2, (58, 62, 68), -1,
                   cv2.LINE_AA)
        cv2.addWeighted(scuff, 0.35, roi, 0.65, 0.0, dst=roi)
        colour, alpha = _hole_sprite(kind)
        _composite(canvas, colour, alpha, x, y, 0.95)


def draw_impact(canvas: np.ndarray, impact: Impact, now: float,
                ttl: float, lift: float = 0.0,
                anchor: tuple[float, float] | None = None) -> None:
    """The burst at the point of impact and, for a hit, the rising score.

    ``lift`` is the struck face's radius and ``anchor`` its centre, when
    known: the popup then hangs above the boss's rim, never over the rings.
    Without an anchor it rises from the point of impact.
    """
    age = now - impact.at
    life = max(0.0, 1.0 - age / ttl)
    if life <= 0.0:
        return
    centre = (int(impact.x), int(impact.y))

    if age < IMPACT_FLASH:
        # A ring bursting outwards from the point of impact.
        burst = age / IMPACT_FLASH
        roi, ox, oy = _roi(canvas, centre[0], centre[1], 56)
        if roi.size == 0:
            return  # the shot went off the canvas: nothing to draw into
        overlay = roi.copy()
        cv2.circle(overlay, (centre[0] - ox, centre[1] - oy), int(10 + 40 * burst),
                   HIT if impact.is_hit else MISS_MARK, 2, cv2.LINE_AA)
        cv2.addWeighted(overlay, 1.0 - burst, roi, burst, 0.0, dst=roi)

    if impact.is_hit:
        popup = min(1.0, age / min(ttl, POPUP_LIFE))
        # Hold at full strength, then go quickly: the colour stays clean
        # rather than spending its life half-mixed with the wall.
        fade = 1.0 if popup < 0.7 else max(0.0, 1.0 - (popup - 0.7) / 0.3)
        if fade <= 0.0:
            return
        bullseye = impact.ring == 0
        # It lands big and settles: a quick scale-in, then a slow drift up.
        settle = min(1.0, popup / 0.18)
        scale = (1.0 if bullseye else 0.82) * (1.35 - 0.35 * settle) * (1.0 - 0.12 * (1 - fade))
        text = f"+{impact.score}"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
        rise = (0.35 * lift + POPUP_RISE) * popup ** 0.7
        if anchor is not None:
            ax, ay = int(anchor[0]), int(anchor[1])
            gap = max(6, int(0.18 * lift))
            top = ay - lift * BOSS_SCALE - gap
            x = ax - tw // 2
            y = int(top - 0.35 * rise)
        else:
            x = centre[0] - tw // 2
            y = int(centre[1] - 0.35 * lift - th - rise)
        y = max(th + 4, y)  # never off the top of the hall
        x = max(2, min(canvas.shape[1] - tw - 2, x))
        roi, ox, oy = _roi(canvas, x + tw // 2, int(y - th / 2), tw // 2 + th + 14)
        if roi.size == 0:
            return
        overlay = roi.copy()
        colour = GOLD if bullseye else HIT
        # A soft drop shadow, then a dark outline, then the figure.
        cv2.putText(overlay, text, (x - ox + 3, y - oy + 4), cv2.FONT_HERSHEY_SIMPLEX,
                    scale, (8, 8, 8), 6, cv2.LINE_AA)
        cv2.addWeighted(overlay, 0.5, roi, 0.5, 0.0, dst=overlay)
        cv2.putText(overlay, text, (x - ox, y - oy), cv2.FONT_HERSHEY_SIMPLEX, scale,
                    (12, 12, 12), 5, cv2.LINE_AA)
        cv2.putText(overlay, text, (x - ox, y - oy), cv2.FONT_HERSHEY_SIMPLEX, scale,
                    colour, 2, cv2.LINE_AA)
        cv2.addWeighted(overlay, fade, roi, 1.0 - fade, 0.0, dst=roi)
    else:
        roi, ox, oy = _roi(canvas, centre[0], centre[1], 14)
        if roi.size == 0:
            return
        overlay = roi.copy()
        cv2.drawMarker(overlay, (centre[0] - ox, centre[1] - oy), MISS_MARK,
                       cv2.MARKER_TILTED_CROSS, 16, 2, cv2.LINE_AA)
        cv2.addWeighted(overlay, life, roi, 1.0 - life, 0.0, dst=roi)


def _area_key(round_: ArcheryRound) -> tuple[int, int, int, int]:
    area = round_.area
    return (int(area.x), int(area.y), int(area.width), int(area.height))


def draw_world(canvas: np.ndarray, round_: ArcheryRound, now: float) -> None:
    height, width = canvas.shape[:2]
    area = _area_key(round_)
    canvas[:] = _hall(width, height, area)
    lamps, _ = _lamps(width, height, area)
    low, high = round_.RADIUS_RANGE
    scale = round_.options.scale
    radii = (low * scale, high * scale)
    _draw_holes(canvas, round_.holes, round_.punctures)
    # Further faces (smaller, higher on the wall) first, so a near one that
    # overlaps while fading reads as in front.
    for struck in sorted(round_.struck, key=lambda s: s.target.radius):
        t = struck.target
        _draw_struck(canvas, struck, now, _shadow_lean(t.x, width, lamps),
                     _haze(t.radius, radii), _shadow_fall(t.y, height, area))
    for target in sorted(round_.targets, key=lambda t: t.radius):
        draw_target(canvas, target, now, _shadow_lean(target.x, width, lamps),
                    _haze(target.radius, radii), _shadow_fall(target.y, height, area))
    # Popups hang over the face they scored on, by the hit point.
    for impact in round_.impacts:
        face = round_.scored.get((impact.x, impact.y))
        if face is None:
            draw_impact(canvas, impact, now, round_.IMPACT_TTL, lift=40.0)
        else:
            cx, cy, r = face
            draw_impact(canvas, impact, now, round_.IMPACT_TTL, lift=r, anchor=(cx, cy))


def draw_emblem(panel: np.ndarray) -> None:
    """The card art: a corner of the range mid-round.

    A near face with an arrow just landed and its score rising, a smaller
    face further down the lane, under the lamps and their pooled light.
    """
    height, width = panel.shape[:2]
    margin = max(2, int(0.06 * height))
    area = (margin, margin, width - 2 * margin, height - 2 * margin)
    panel[:] = _hall(width, height, area)
    unit = min(width, height)
    far = Target(x=width * 0.74, y=height * 0.40, radius=unit * 0.17,
                 spawned_at=0.0, lifetime=99.0)
    near = Target(x=width * 0.36, y=height * 0.60, radius=unit * 0.30,
                  spawned_at=0.0, lifetime=99.0)
    lamps, _ = _lamps(width, height, area)
    radii = (far.radius, near.radius)
    draw_target(panel, far, now=1.0, lean=_shadow_lean(far.x, width, lamps),
                haze=_haze(far.radius, radii), fall=_shadow_fall(far.y, height, area))
    hit_x, hit_y = near.x + near.radius * 0.06, near.y - near.radius * 0.04
    _draw_struck(panel, Struck(target=near, ring=0, x=hit_x, y=hit_y, at=0.0), now=0.6,
                 lean=_shadow_lean(near.x, width, lamps), haze=0,
                 fall=_shadow_fall(near.y, height, area))
    draw_impact(panel, Impact(x=hit_x, y=hit_y, score=10, at=0.0, ring=0),
                now=0.2, ttl=1.4, lift=near.radius, anchor=(near.x, near.y))
