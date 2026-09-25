"""Dead of night: a road out of the fog, and things walking up it.

The map is built on a real pinhole projection rather than sprites scaled by
taste, so distance behaves the way distance does - a walker forty metres out is a
grey smudge worth aiming carefully at, and one at three metres fills the screen
and is about to reach you. Every figure is drawn from the same measurements the
shot is tested against, so what you see is exactly what you can hit.

The road, the treeline and the moon are painted once per window size into a
cached backdrop; each frame copies that and draws only what moves - the fog
rolling along the horizon, the rain, the walkers, what is left of the ones that
fell. The walkers' outlines are cached as well, a couple of dozen poses to a
stride, so a frame only blends two of them and fills them in, and the whole
picture stays well inside the per-frame budget.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import cached_property, lru_cache
from typing import NamedTuple

import cv2
import numpy as np

from ..game import MISS, Hit, Impact, Rect, Round, RoundOptions
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
MOONLIGHT = (206, 198, 184)
RIM = (240, 228, 200)  # the cold edge the moon puts on skull and shoulders
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


# --- the figures ---------------------------------------------------------------

#: Seconds a body shot knocks one of them off its stride.
STAGGER = 0.45

# The three kinds of solid a figure is built from.
LIMB, ELLIPSE, POLYGON = 0, 1, 2


class Part(NamedTuple):
    """One solid piece of a figure, as it is built: in units of its height,
    for the cached poses (see :class:`Mesh`).

    A limb - tapering through its joints - for a leg, an arm or a finger; an
    ellipse for a palm or a foot; a polygon for a skull, a torso or a ragged
    coat. The same outlines are painted and shot at, so a part that is drawn
    can be hit, and a shot that finds nothing drawn finds nothing.
    """

    zone: str  # "head" or "body"
    tone: str  # which of the walker's colours it is painted in
    kind: int
    #: A limb's joints as (x, y, radius) triples; an ellipse's (cx, cy, rx,
    #: ry, degrees); a polygon's outline, as an (n, 2) float32 array.
    shape: tuple | np.ndarray
    #: Half its thickness: how far in from the edge the moon may reach.
    depth: float
    #: The least detail (see :func:`_detail`) a figure must be drawn at to have
    #: this part at all: fingers only near enough to see them.
    lod: int = 0


def _limb(zone: str, tone: str, *joints: tuple[float, float, float], lod: int = 0) -> Part:
    """One piece bent at its joints, so a knee or an elbow is not a seam."""
    return Part(zone, tone, LIMB, joints, min(joint[2] for joint in joints), lod)


def _ellipse(zone: str, tone: str, centre: tuple[float, float], rx: float, ry: float,
             degrees: float = 0.0) -> Part:
    return Part(zone, tone, ELLIPSE, (centre[0], centre[1], rx, ry, degrees), min(rx, ry))


def _polygon(zone: str, tone: str, points: list, depth: float, lod: int = 0) -> Part:
    return Part(zone, tone, POLYGON, np.array(points, np.float32), depth, lod)


class Piece(NamedTuple):
    """Where one part's outline lies in its figure's mesh."""

    zone: str
    tone: str
    start: int
    stop: int
    lod: int
    depth: float


class Mesh(NamedTuple):
    """Every part's outline, end to end, each point written as a centre, a
    direction and a distance along it: a limb's points stand off its joints,
    a skull's off its middle. The part pulled in by ``inset`` pixels is then
    ``centre + (radius - inset) * direction`` - a few sums over the whole
    figure at once, however many parts it has."""

    centre: np.ndarray  # (n, 2)
    direction: np.ndarray  # (n, 2)
    radius: np.ndarray  # (n,)
    depth: np.ndarray  # (n,): half the thickness of the part each point is on
    pieces: tuple[Piece, ...]
    #: Runs of pieces filled in one call: the same colour, and not touching -
    #: a pair of legs, of feet, of hands. Outlines filled in one call cancel
    #: where they cross, so only ones that cannot cross are put together.
    groups: tuple[tuple[int, ...], ...]


@lru_cache(maxsize=8)
def _arc(count: int) -> tuple[np.ndarray, np.ndarray]:
    """``count`` steps round half a circle, ends left out."""
    angles = np.linspace(0.0, math.pi, count + 2, dtype=np.float32)[1:-1]
    return np.cos(angles)[None, :, None], np.sin(angles)[None, :, None]


def _limb_outlines(limbs: list[tuple], arc: int) -> tuple[np.ndarray, ...]:
    """Every limb's outline at once: down one side of its joints, round the
    far end, back up the other side and round the near end. A bent joint is
    mitred, so an elbow comes to a bony point rather than a seam."""
    joints = np.array([limb if len(limb) == 3 else
                       (limb[0], tuple((a + b) / 2 for a, b in zip(*limb)), limb[1])
                       for limb in limbs], np.float32)
    points, radii = joints[:, :, :2], joints[:, :, 2]
    along = points[:, 1:] - points[:, :-1]
    along /= np.maximum(np.linalg.norm(along, axis=2, keepdims=True), 1e-6)
    normal = np.stack((-along[..., 1], along[..., 0]), axis=2)
    bend = (normal[:, 0] + normal[:, 1]) / np.maximum(
        1.0 + (normal[:, 0] * normal[:, 1]).sum(axis=1, keepdims=True), 0.78)
    sides = np.stack((normal[:, 0], bend, normal[:, 1]), axis=1)
    cos, sin = _arc(arc)
    far = cos * normal[:, 1][:, None] + sin * along[:, 1][:, None]
    near = -cos * normal[:, 0][:, None] - sin * along[:, 0][:, None]
    centre = np.concatenate((points, np.repeat(points[:, 2:], arc, axis=1), points[:, ::-1],
                             np.repeat(points[:, :1], arc, axis=1)), axis=1)
    direction = np.concatenate((sides, far, -sides[:, ::-1], near), axis=1)
    radius = np.concatenate((radii, np.repeat(radii[:, 2:], arc, axis=1), radii[:, ::-1],
                             np.repeat(radii[:, :1], arc, axis=1)), axis=1)
    return centre, direction, radius


def _ellipse_outlines(ellipses: list[tuple], count: int) -> tuple[np.ndarray, ...]:
    shapes = np.array(ellipses, np.float32)
    t = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float32)
    across, down = shapes[:, 2:3] * np.cos(t), shapes[:, 3:4] * np.sin(t)
    angle = np.radians(shapes[:, 4:5])
    wx = across * np.cos(angle) - down * np.sin(angle)
    wy = across * np.sin(angle) + down * np.cos(angle)
    radius = np.maximum(np.hypot(wx, wy), 1e-6)
    direction = np.stack((wx / radius, wy / radius), axis=2)
    centre = np.broadcast_to(shapes[:, None, :2], direction.shape)
    return centre, direction, radius


def _mesh(parts: tuple[Part, ...]) -> Mesh:
    """All of a figure's parts as one mesh, in the order they are painted,
    at its finest detail: a smaller figure leaves some pieces out."""
    limbs = [part.shape for part in parts if part.kind == LIMB]
    ellipses = [part.shape for part in parts if part.kind == ELLIPSE]
    built = {LIMB: _limb_outlines(limbs, 5) if limbs else None,
             ELLIPSE: _ellipse_outlines(ellipses, 14) if ellipses else None}
    counters = {LIMB: 0, ELLIPSE: 0}
    centres, directions, radii, depths, pieces, boxes = [], [], [], [], [], []
    at = 0
    for part in parts:
        if part.kind == POLYGON:
            points = part.shape
            middle = (points.min(axis=0) + points.max(axis=0)) * 0.5
            offset = points - middle
            radius = np.maximum(np.hypot(offset[:, 0], offset[:, 1]), 1e-6)
            centre = np.broadcast_to(middle, points.shape)
            direction = offset / radius[:, None]
        else:
            index = counters[part.kind]
            counters[part.kind] += 1
            centre, direction, radius = (array[index] for array in built[part.kind])
        count = len(radius)
        edge = centre + radius[:, None] * direction
        boxes.append((edge.min(axis=0), edge.max(axis=0)))
        centres.append(centre)
        directions.append(direction)
        radii.append(radius)
        depths.append(np.full(count, part.depth, np.float32))
        pieces.append(Piece(part.zone, part.tone, at, at + count, part.lod, part.depth))
        at += count
    groups: list[list[int]] = []
    for index, piece in enumerate(pieces):
        if groups:
            run = groups[-1]
            first = pieces[run[0]]
            if ((piece.tone, piece.zone, piece.lod, piece.depth)
                    == (first.tone, first.zone, first.lod, first.depth)
                    and all(_apart(boxes[index], boxes[other]) for other in run)):
                run.append(index)
                continue
        groups.append([index])
    return Mesh(np.concatenate(centres).astype(np.float32),
                np.concatenate(directions).astype(np.float32),
                np.concatenate(radii).astype(np.float32),
                np.concatenate(depths), tuple(pieces), tuple(map(tuple, groups)))


def _apart(a: tuple[np.ndarray, np.ndarray], b: tuple[np.ndarray, np.ndarray]) -> bool:
    """Whether two boxes are clear of each other by a couple of hundredths of
    the figure's height, room enough that no pose between two cached ones and
    no pixel of antialiasing brings them into contact."""
    gap = 0.02
    return bool((a[1] + gap < b[0]).any() or (b[1] + gap < a[0]).any())


#: How many poses a stride is cached at. Each frame is drawn between the two
#: either side of it, so this is a cache size, not a frame rate.
POSE_STEPS = 16


def _detail(height: float) -> int:
    """How much of a figure is worth drawing at this height in pixels: 0 a
    silhouette with eyes; 1 hair, collars and torn cuffs; 2 fingers; 3 every
    finger, the thumbs, and a softer fall of light."""
    return 0 if height < 40 else 1 if height < 100 else 2 if height < 200 else 3


# What they wear, BGR, before the moon and the fog get to it. Dark and cold,
# so the eyes and the moonlit edges carry the picture; the flesh a shade paler
# than the rags so the skull is always the thing that reads as a head.
SKINS = ((44, 50, 47), (50, 52, 51), (40, 46, 51), (34, 39, 40))
COATS = ((18, 16, 15), (25, 19, 16), (16, 21, 20), (15, 19, 26), (27, 27, 27))
SHIRTS = ((30, 32, 33), (33, 27, 23), (24, 28, 32), (36, 38, 35))
TROUSERS = ((13, 12, 12), (28, 20, 17), (18, 23, 26), (17, 16, 16))
HAIRS = ((10, 10, 12), (24, 25, 26), (11, 13, 18))
GOWN = (38, 41, 37)  # the hospital gown some of them walked out in


class Look(NamedTuple):
    """How one of them is built and what it is wearing: fixed by its seed, so
    the same one looks the same all the way up the road, and on it after."""

    width: float  # narrow to broad, across the shoulders and the hips
    clothes: str  # "shirt", "jacket", "coat" or "gown"
    sleeves: tuple[bool, bool]  # left, right: a sleeve left, or a bare arm
    long_sleeves: bool
    bare_shin: int  # the trouser leg torn off below the knee: -1, 1, or 0
    hair: int  # 0 bald, 1 a matted cap, 2 long and lank
    jaw: float  # how far the jaw hangs open, 0..1
    shoulders: float  # how much higher the left shoulder sits, in heights
    knees: float  # knock-kneed below zero, bow-legged above
    arms: int  # a shambler's reach: both arms, one of them, or one raised
    lead_arm: int  # the side that reaches, or raises
    stiff: int  # the side of the limper's dragging leg
    skin: tuple[int, int, int]
    cloth: tuple[int, int, int]
    shirt: tuple[int, int, int]
    legs: tuple[int, int, int]
    hair_tone: tuple[int, int, int]


@lru_cache(maxsize=512)
def _look(seed: int) -> Look:
    def pick(options: tuple, index: int):
        return options[int(_rag(seed, index) * len(options)) % len(options)]

    roll = _rag(seed, 40)
    clothes = ("coat" if roll < 0.3 else "jacket" if roll < 0.55 else "shirt" if roll < 0.87
               else "gown")
    gown = clothes == "gown"
    return Look(
        width=0.9 + 0.22 * _rag(seed, 41),
        clothes=clothes,
        sleeves=(not gown and _rag(seed, 5) >= 0.3, not gown and _rag(seed, 6) >= 0.3),
        long_sleeves=_rag(seed, 42) < 0.5,
        bare_shin=0 if _rag(seed, 14) >= 0.4 else (1 if _rag(seed, 43) < 0.5 else -1),
        hair=min(2, int(_rag(seed, 13) * 3)),
        jaw=_rag(seed, 12),
        shoulders=(_rag(seed, 44) - 0.5) * 0.06,
        knees=(_rag(seed, 45) - 0.5) * 0.024,
        arms=min(2, int(_rag(seed, 46) * 3)),
        lead_arm=1 if _rag(seed, 52) < 0.5 else -1,
        stiff=1 if _rag(seed, 9) < 0.5 else -1,
        skin=pick(SKINS, 47),
        cloth=GOWN if gown else pick(COATS, 48),
        shirt=pick(SHIRTS, 49),
        legs=pick(TROUSERS, 50),
        hair_tone=pick(HAIRS, 51),
    )


@dataclass(frozen=True)
class Figure:
    """Where every part of a walker is on screen, this frame.

    Drawing and hit-testing both read :attr:`parts`, so the silhouette and the
    hitbox can never drift apart.
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
    #: How far the shoulders, and the head on them, lead the hips, in pixels.
    #: Already in ``head``: the skull is drawn where it is tested.
    lead: float = 0.0
    #: A machine, not one of them: it stands straight and keeps its hands in.
    robot: bool = False
    #: How hard the last body shot is still knocking it back, 0..1.
    recoil: float = 0.0
    #: How much detail it is built with; below zero, as much as its size merits.
    detail: int = -1

    @property
    def hand_radius(self) -> float:
        return self.height * (0.04 if self.gait == "crawl" else 0.042)

    @property
    def look(self) -> Look:
        return _look(self.seed)

    @property
    def lod(self) -> int:
        return self.detail if self.detail >= 0 else _detail(self.height)

    @property
    def margin(self) -> float:
        """How far outside a part a shot still lands on it, in pixels. The
        moon's rim is painted just outside the silhouette on the side towards
        it, softened by a pixel of antialiasing, and every pixel that is
        painted is one that can be hit."""
        return max(2.5, self.height * 0.012)

    def shoulder_at(self, side: int) -> float:
        """The screen row of one shoulder. They are never level: one sits
        higher for good, and the pair rock against the hips with the stride."""
        if self.robot or self.gait == "crawl":
            return self.shoulder_y
        rock = math.sin(self.phase) * 0.012
        return self.shoulder_y + self.height * side * (rock - self.look.shoulders)

    def arms(self) -> tuple[tuple[tuple[float, float], ...], ...]:
        """Shoulder, elbow and wrist of each arm, on screen: reaching, hanging,
        raised or clutched to a wound, by gait and by build."""
        return tuple(arm[:3] for arm in self._arms)

    def _arm_pose(self, side: int) -> str:
        if self.robot or self.gait == "lurch":
            return "hang"
        look = self.look
        if self.gait == "limp":
            return "clutch" if side == -look.stiff else "reach"
        if look.arms == 0:
            return "reach"
        if look.arms == 1:
            return "reach" if side == look.lead_arm else "hang"
        return "raised" if side == look.lead_arm else "reach"

    @cached_property
    def _arms(self) -> tuple:
        """Each arm's shoulder, elbow and wrist, and the way its hand hangs."""
        height, x = self.height, self.x
        arms = []
        if self.gait == "crawl":
            # Planted ahead, one always further than the other, elbows up.
            pull = math.sin(self.phase)
            for side in (-1, 1):
                ahead = 0.05 * pull * side
                arms.append(((x + side * height * 0.13, self.ground_y - height * 0.32),
                             (x + side * height * (0.22 + ahead * 0.4),
                              self.ground_y - height * 0.16),
                             (x + side * height * (0.24 + ahead), self.ground_y - height * 0.05),
                             (side * 0.55, 0.85)))
            return tuple(arms)
        half = self.half_shoulder * self.look.width
        for side in (-1, 1):
            swing = math.sin(self.phase + side * 1.7)
            sx = x + self.lead + side * half * 0.84
            sy = self.shoulder_at(side) + height * (0.03 if self.robot else 0.06)
            pose = self._arm_pose(side)
            if pose == "reach":
                # Reaching for you, out and forward: from here the forearm is
                # short, and the hand hangs from the wrist.
                elbow = (sx + side * height * (0.085 + 0.01 * swing),
                         sy + height * (0.11 + 0.015 * swing))
                wrist = (sx + side * height * (0.145 + 0.015 * swing),
                         sy + height * (0.125 + 0.045 * swing))
                hand = (side * 0.3, 1.0)
            elif pose == "raised":
                # Held up at the height of your face, the hand hanging limp.
                elbow = (sx + side * height * 0.1, sy + height * (0.02 + 0.015 * swing))
                wrist = (sx + side * height * 0.15, sy - height * (0.06 + 0.025 * swing))
                hand = (side * 0.25, 1.0)
            elif pose == "clutch":
                # Holding the wound it died of.
                elbow = (sx + side * height * 0.075, sy + height * 0.135)
                wrist = (x + self.lead * 0.25 + side * height * 0.045,
                         self.hip_y - height * 0.035)
                hand = (-side, 0.35)
            else:
                # Hanging, heavy, swinging with the stride; a machine's straighter.
                stiff = 0.35 if self.robot else 1.0
                elbow = (sx + side * height * (0.03 + 0.01 * swing * stiff),
                         sy + height * 0.17)
                wrist = (elbow[0] + side * height * 0.012 + height * 0.03 * swing * stiff,
                         elbow[1] + height * 0.16)
                hand = (wrist[0] - elbow[0], wrist[1] - elbow[1])
            if self.recoil > 0.0:
                # Knocked back by the shot: the arms fly up and out.
                k = self.recoil
                elbow = (elbow[0] + (sx + side * height * 0.115 - elbow[0]) * k,
                         elbow[1] + (sy - elbow[1]) * k)
                wrist = (wrist[0] + (sx + side * height * 0.16 - wrist[0]) * k,
                         wrist[1] + (sy - height * 0.085 - wrist[1]) * k)
                hand = (hand[0] + (side * 0.3 - hand[0]) * k, hand[1] + (-1.0 - hand[1]) * k)
            norm = math.hypot(*hand) or 1.0
            arms.append(((sx, sy), elbow, wrist, (hand[0] / norm, hand[1] / norm)))
        return tuple(arms)

    def legs(self) -> tuple[tuple[tuple[float, ...], ...], ...]:
        """Each standing leg's hip, knee and ankle, and its foot as (x, y,
        degrees). From in front, a stride is a foot lifting and swinging
        through while the weight rides over the other."""
        height, x, ground = self.height, self.x, self.ground_y
        look = self.look
        lurch = self.gait == "lurch"
        width = 1.0 if self.robot else look.width
        stance = (0.062 if lurch else 0.046) * width
        step = math.sin(self.phase)
        legs = []
        for side in (-1, 1):
            hip = (x + side * height * 0.05 * width, self.hip_y + height * 0.02)
            if self.gait == "limp" and side == look.stiff:
                # The bad leg stays straight and trails, toe scraping the road.
                ankle = (x + side * height * (stance + 0.018), ground - height * 0.03)
                knee = ((hip[0] + ankle[0]) / 2 + side * height * 0.004,
                        (hip[1] + ankle[1]) / 2)
                foot = (ankle[0] + side * height * 0.008, ground - height * 0.012, side * 30.0)
            else:
                lift = max(0.0, -step * side)  # this foot is off the road, swinging through
                rise = lift * height * (0.035 if self.robot else 0.075 if lurch
                                        else 0.07 if self.gait == "limp" else 0.055)
                bend = 0.0 if self.robot else 0.012 + look.knees + 0.018 * lift + (
                    0.012 if lurch else 0.0)
                ankle = (x + side * height * (stance + 0.012 * lift), ground - height * 0.042 - rise)
                knee = (x + side * height * (0.056 * width + bend),
                        ground - height * 0.27 - rise * 0.55)
                foot = (ankle[0] + side * height * 0.006, ankle[1] + height * 0.026,
                        side * 12.0)
            legs.append((hip, knee, ankle, foot))
        return tuple(legs)

    def trailing_legs(self) -> tuple[tuple[tuple[float, float], ...], ...]:
        """A crawler's hip and foot on each side. They trail up the road behind
        it, which from here means up the picture, above the rest of it."""
        pull = math.sin(self.phase)
        height, ground = self.height, self.ground_y
        return tuple(((self.x + side * height * 0.05, ground - height * 0.43),
                      (self.x + side * height * (0.08 + 0.02 * pull * side),
                       ground - height * (0.55 + 0.03 * _rag(self.seed, 3 + side))))
                     for side in (-1, 1))

    @cached_property
    def parts(self) -> tuple[Part, ...]:
        """Every solid piece of it, in the order they are painted, back to front."""
        if self.robot:
            return tuple(_robot_parts(self))
        if self.gait == "crawl":
            return tuple(_crawler_parts(self))
        return tuple(_standing_parts(self))

    @cached_property
    def mesh(self) -> Mesh:
        """Its outlines in pixels, this frame: the walker's cached poses either
        side of this moment of its stride, blended, scaled to its height and
        stood where it is. Painted and shot at alike."""
        step = (self.phase % math.tau) / math.tau * POSE_STEPS
        low = int(step)
        t = np.float32(step - low)
        key = (self.seed, self.gait, self.robot, self.hunch, self.tilt,
               round(self.recoil * 8) / 8)
        a = _pose_mesh(*key, low % POSE_STEPS)
        b = _pose_mesh(*key, (low + 1) % POSE_STEPS)
        if a.pieces != b.pieces:
            b = a
        groups = a.groups
        if groups != b.groups:
            # Apart in one pose and not the other: fill them one at a time.
            groups = tuple((index,) for index in range(len(a.pieces)))
        height = np.float32(self.height)
        root = np.float32((self.x - self.lean * self.height, self.ground_y))
        centre = (a.centre + (b.centre - a.centre) * t) * height + root
        direction = a.direction + (b.direction - a.direction) * t
        radius = (a.radius + (b.radius - a.radius) * t) * height
        return Mesh(centre, direction, radius, a.depth * height, a.pieces, groups)

    @cached_property
    def groups(self) -> tuple[tuple[Piece, ...], ...]:
        """The pieces it is drawn and shot with at its size, in the runs they
        are filled in."""
        lod, pieces = self.lod, self.mesh.pieces
        runs = (tuple(pieces[index] for index in group if pieces[index].lod <= lod)
                for group in self.mesh.groups)
        return tuple(run for run in runs if run)

    @cached_property
    def outline(self) -> np.ndarray:
        """Every point of every part's edge, in pixels."""
        mesh = self.mesh
        return mesh.centre + mesh.radius[:, None] * mesh.direction

    @cached_property
    def bounds(self) -> tuple[float, float, float, float]:
        """The box every part fits in, margin included: x0, y0, x1, y1."""
        low, high = self.outline.min(axis=0), self.outline.max(axis=0)
        pad = self.margin + 1.0
        return (float(low[0]) - pad, float(low[1]) - pad, float(high[0]) + pad,
                float(high[1]) + pad)

    def hit_zone(self, x: float, y: float) -> str | None:
        """"head", "body", or None. The head is small and worth the trouble."""
        if math.hypot(x - self.head[0], y - self.head[1]) <= self.head_radius * 1.2:
            return "head"
        x0, y0, x1, y1 = self.bounds
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return None
        outline, point, margin = self.outline, (float(x), float(y)), -self.margin
        for run in self.groups:
            for piece in run:
                if cv2.pointPolygonTest(outline[piece.start:piece.stop], point,
                                        True) >= margin:
                    return "body"
        return None


def _pose(gait: str, robot: bool, hunch: float, tilt: float, seed: int, phase: float,
          recoil: float, height: float, x: float, ground: float, fog: float = 0.0,
          detail: int = -1) -> Figure:
    """One of them at one moment of its stride, ``height`` pixels tall with its
    feet at (``x``, ``ground``)."""
    lurch = math.sin(phase) * (0.06 if gait == "lurch" else 0.035)
    # Knocked off balance by the last round: thrown aside at once, and
    # finding its feet again over the rest of the stagger.
    lurch += 0.09 * recoil
    x += lurch * height
    common = dict(x=x, ground_y=ground, height=height, lean=lurch, fog=fog, hunch=hunch,
                  tilt=tilt, phase=phase, gait=gait, seed=seed, robot=robot, recoil=recoil,
                  detail=detail)
    if gait == "crawl":
        # On its hands, dragging itself up the road: low, wide, head first.
        return Figure(head=(x + lurch * height * 0.3, ground - height * 0.23),
                      head_radius=height * 0.074, shoulder_y=ground - height * 0.36,
                      hip_y=ground - height * 0.44, half_shoulder=height * 0.20, **common)
    drop = 0.0
    if gait == "limp":
        drop = abs(math.sin(phase * 0.5)) * 0.035  # the bad leg gives
    elif gait == "lurch":
        drop = 0.045  # bent forward, head thrust out
    # The shoulders lead the hips by the hunch, and a lurcher's lead further
    # still. Folded into the head here rather than added when it is drawn,
    # or a shot at the middle of a lurcher's skull scores nothing.
    lead = 0.0
    if not robot:
        lead = hunch * height * 0.085 + (height * 0.07 if gait == "lurch" else 0.0)
    return Figure(
        head=(x + lead + lurch * height * 0.6 + (height * 0.06 if gait == "lurch" else 0.0),
              ground - height * (0.905 - drop)),
        head_radius=height * 0.076,
        shoulder_y=ground - height * (0.79 - drop),
        hip_y=ground - height * 0.47,
        half_shoulder=height * 0.15,
        lead=lead,
        **common,
    )


@lru_cache(maxsize=1024)
def _pose_mesh(seed: int, gait: str, robot: bool, hunch: float, tilt: float,
               recoil: float, step: int) -> Mesh:
    """One walker at one step of its stride, one unit tall with its feet at
    the origin. A walker's poses are built in its first stride and reused for
    the rest of the road; nine walkers' worth fit many times over. Sixteen to a
    stride is plenty: a frame is drawn between two of them, and nothing moves
    far enough between two to bend a straight line visibly."""
    figure = _pose(gait, robot, hunch, tilt, seed, step * math.tau / POSE_STEPS, recoil,
                   height=1.0, x=0.0, ground=0.0, detail=3)
    return _mesh(figure.parts)


def _skull(figure: Figure, metal: bool = False) -> list[tuple[float, float]]:
    """The outline of the head in one piece, crown to chin: a cranium, cheeks
    drawn in under the bones, and a jaw that hangs - or a helmet's square chin.
    Every point of it is inside the circle a head shot is tested against."""
    width = 0.8 if metal else 0.84
    points = []
    for index in range(11):
        a = math.radians(-10.0 + 20.0 * index)
        points.append((width * math.cos(a), -0.13 - 0.9 * math.sin(a)))
    if metal:
        chin = ((-0.76, 0.46), (-0.44, 0.86), (0.44, 0.86), (0.76, 0.46))
    else:
        drop = 0.15 * figure.look.jaw  # the further it hangs, the longer the face
        chin = ((-0.78, 0.14), (-0.6, 0.38), (-0.6, 0.6 + drop * 0.4), (-0.26, 0.92 + drop),
                (0.26, 0.92 + drop), (0.6, 0.6 + drop * 0.4), (0.6, 0.38), (0.78, 0.14))
    return [_head_point(figure, px, py) for px, py in points + list(chin)]


def _head_parts(figure: Figure, parts: list[Part], metal: bool = False) -> None:
    """The skull, and what hair is left on it."""
    radius = figure.head_radius
    parts.append(_polygon("head", "plate" if metal else "skin", _skull(figure, metal),
                          radius * 0.7))
    look = figure.look
    if metal or not look.hair:
        return
    # Over the crown, then a ragged edge back across the brow: a matted cap,
    # or hanging lank past the ears.
    lank = look.hair == 2
    start = -0.16 if lank else 0.03
    cap = []
    for index in range(9):
        a = math.pi * (start + (1.0 - 2.0 * start) * index / 8)
        cap.append(_head_point(figure, -math.cos(a) * 0.9, -0.13 - math.sin(a) * 0.96))
    edge = ((0.84, 0.34), (0.68, -0.14), (0.42, -0.38), (0.12, -0.5), (-0.2, -0.42),
            (-0.5, -0.4), (-0.7, -0.12), (-0.84, 0.34)) if lank else (
            (0.84, -0.14), (0.6, -0.44), (0.34, -0.32), (0.1, -0.54), (-0.16, -0.4),
            (-0.42, -0.52), (-0.66, -0.32), (-0.84, -0.14))
    for index, (px, py) in enumerate(edge):
        cap.append(_head_point(figure, px, py - 0.1 * _rag(figure.seed, 70 + index)))
    parts.append(_polygon("head", "hair", cap, radius * 0.25, lod=1))


def _hand_parts(figure: Figure, wrist: tuple[float, float], hand: tuple[float, float],
                side: int, tone: str = "skin", claws: bool = True) -> list[list[Part]]:
    """A palm hanging from the wrist, and the fingers, which only a near one
    shows: as layers - the palm, then each finger in turn - so a pair of
    hands can be laid down together."""
    height = figure.height
    dx, dy = hand
    palm = (wrist[0] + dx * height * 0.024, wrist[1] + dy * height * 0.024)
    layers = [[_ellipse("body", tone, palm, height * 0.03, height * 0.021,
                        math.degrees(math.atan2(dy, dx)))]]
    if not claws:
        return layers
    # Across the palm; the thumb is on the side towards the body.
    px, py = -dy, dx
    if px * side > 0:
        px, py = -px, -py
    base_angle = math.atan2(dy, dx)
    fingers = ((-1.4, -24.0, 0.8, 3), (-0.45, -8.0, 1.0, 2), (0.5, 7.0, 0.95, 2),
               (1.4, 22.0, 0.75, 2))
    thick = height * 0.0062
    for index, (across, spread, long, lod) in enumerate(fingers):
        a = base_angle + math.radians(spread) * -side
        # Each finger crooked at the knuckle, curling back towards the palm.
        curl = a + math.radians(18.0) * side
        base = (palm[0] + dx * height * 0.016 + px * height * 0.0085 * across,
                palm[1] + dy * height * 0.016 + py * height * 0.0085 * across)
        reach = height * (0.024 + 0.008 * _rag(figure.seed, 80 + index + 4 * side)) * long
        knuckle = (base[0] + math.cos(a) * reach, base[1] + math.sin(a) * reach)
        tip = (knuckle[0] + math.cos(curl) * reach * 0.9, knuckle[1] + math.sin(curl) * reach * 0.9)
        layers.append([_limb("body", tone, (*base, thick), (*knuckle, thick * 0.85),
                             (*tip, thick * 0.6), lod=lod)])
    a = base_angle + math.radians(55.0) * side
    base = (palm[0] - px * height * 0.014, palm[1] - py * height * 0.014)
    tip = (base[0] + math.cos(a) * height * 0.026, base[1] + math.sin(a) * height * 0.026)
    layers.append([_limb("body", tone, (*base, thick * 1.15), (*tip, thick * 0.7), lod=3)])
    return layers


def _tatters(tone: str, joint: tuple[float, float], direction: tuple[float, float],
             radius: float, height: float, seed: int) -> Part:
    """A sleeve torn off at a joint: a ragged cuff hanging a little way down
    the bare arm below it."""
    dx, dy = direction
    norm = math.hypot(dx, dy) or 1.0
    dx, dy = dx / norm, dy / norm
    px, py = -dy, dx
    jx, jy = joint
    points = [(jx + px * radius * 1.1 - dx * radius * 0.7, jy + py * radius * 1.1 - dy * radius * 0.7)]
    for index, (across, down) in enumerate(((0.95, 0.6), (0.5, 1.2), (0.12, 0.35),
                                            (-0.3, 1.0), (-0.78, 0.45))):
        reach = height * 0.028 * down * (0.55 + 0.9 * _rag(seed, 90 + index))
        points.append((jx + px * radius * across + dx * reach,
                       jy + py * radius * across + dy * reach))
    points.append((jx - px * radius * 1.1 - dx * radius * 0.7, jy - py * radius * 1.1 - dy * radius * 0.7))
    return _polygon("body", tone, points, radius * 0.5, lod=1)


def _arm_layers(figure: Figure, side: int, arm: tuple) -> list[list[Part]]:
    """One arm - sleeve or bare, torn at the cuff - and its hand, as layers:
    upper arm, forearm, cuff, palm, each finger."""
    height, look = figure.height, figure.look
    shoulder, elbow, wrist, hand = arm
    sleeve_tone = "shirt" if look.clothes == "shirt" else "cloth"
    sleeve = look.sleeves[0 if side < 0 else 1]
    upper = sleeve_tone if sleeve else "skin"
    fore = sleeve_tone if sleeve and look.long_sleeves else "skin"
    top = height * (0.034 if sleeve else 0.026)
    at_elbow = height * (0.025 if fore != "skin" else 0.021)
    if upper == fore:
        layers = [[_limb("body", upper, (*shoulder, top), (*elbow, at_elbow),
                         (*wrist, height * 0.016))], []]
    else:
        layers = [[_limb("body", upper, (*shoulder, top), (*elbow, height * 0.026))],
                  [_limb("body", fore, (*elbow, at_elbow), (*wrist, height * 0.016))]]
    cuff = []
    if sleeve:
        joint, radius, onward = ((wrist, height * 0.021, hand) if look.long_sleeves else
                                 (elbow, height * 0.028,
                                  (wrist[0] - elbow[0], wrist[1] - elbow[1])))
        cuff.append(_tatters(sleeve_tone, joint, onward, radius, height, figure.seed + side))
    return layers + [cuff] + _hand_parts(figure, wrist, hand, side)


def _side_by_side(parts: list[Part], *sides: list[list[Part]]) -> None:
    """Lay down two sides' layers together - both upper arms, then both
    forearms, both hands - so each pair can be filled in one call. The two
    sides never overlap, so the order between them does not matter."""
    for layer in range(max((len(layers) for layers in sides), default=0)):
        for layers in sides:
            if layer < len(layers):
                parts.extend(layers[layer])


def _standing_parts(figure: Figure) -> list[Part]:
    """One of them on its feet: legs, a torso that leans with its shoulders
    and narrows to the waist, clothes torn at the hem and the sleeve, the
    skull, and the arms and hands."""
    height, x, ground = figure.height, figure.x, figure.ground_y
    look = figure.look
    seed = figure.seed
    half = figure.half_shoulder * look.width
    top, hips = figure.shoulder_y, figure.hip_y
    left, right = figure.shoulder_at(-1), figure.shoulder_at(1)
    span = max(hips - min(left, right), 1e-6)
    lead = figure.lead
    parts: list[Part] = []

    def over(y: float) -> float:
        """The middle of the body at row ``y``: leaning out with the shoulders."""
        return x + lead * min(max((hips - y) / span, 0.0), 1.1)

    gown = look.clothes == "gown"
    legs = []
    for side, (hip, knee, ankle, foot) in zip((-1, 1), figure.legs()):
        thigh = "cloth" if gown else "legs"
        shin = "skin" if gown or look.bare_shin == side else "legs"
        if shin == thigh:
            layers = [[_limb("body", thigh, (*hip, height * 0.044), (*knee, height * 0.03),
                             (*ankle, height * 0.018))], []]
        else:
            layers = [[_limb("body", thigh, (*hip, height * 0.044), (*knee, height * 0.031))],
                      [_limb("body", shin, (*knee, height * 0.024), (*ankle, height * 0.016))]]
        legs.append(layers + [[_ellipse("body", "skin" if gown else "shoe", foot[:2],
                                        height * 0.034, height * 0.019, foot[2])]])
    _side_by_side(parts, *legs)

    hx, hy = figure.head
    parts.append(_limb("body", "skin", (over(top), top + height * 0.02, height * 0.034),
                       (hx, hy + figure.head_radius * 0.45, height * 0.029)))

    # Arms that stay clear of the body hang behind it, so the shoulder is the
    # torso's own; one that crosses the body is drawn over it.
    arms = list(zip((-1, 1), figure._arms))
    front = [(side, arm) for side, arm in arms
             if figure._arm_pose(side) in ("clutch", "hang") or figure.recoil > 0.3]
    _side_by_side(parts, *(_arm_layers(figure, side, arm) for side, arm in arms
                           if (side, arm) not in front))

    # The torso: hunched up round the neck, one shoulder low, narrowing to the
    # waist; the hem of whatever it wears hanging in torn points, a coat's to
    # the knee and split up the middle.
    long = look.clothes in ("coat", "gown")
    hem = ground - height * 0.3 if long else hips + height * 0.035
    flare = 0.84 if long else 0.74
    outline = [
        (over(top) - half * 0.2, top - height * 0.044),
        (over(top) + half * 0.2, top - height * 0.044),
        (over(right) + half * 0.48, right - height * 0.024),
        (over(right) + half * 0.86, right + height * 0.018),
        (over(right) + half * 1.0, right + height * 0.062),
        (over(right + height * 0.13) + half * 0.9, right + height * 0.13),
        (over(ground - height * 0.6) + half * 0.7, ground - height * 0.6),
        (x + half * 0.74, hips),
    ]
    hem_points = 9
    for index in range(hem_points + 1):
        t = (index + 0.4 * (_rag(seed, 75 + index) - 0.5) * (0 < index < hem_points)) / hem_points
        px = x + half * flare * (1.0 - 2.0 * t)
        torn = _rag(seed, 60 + index)
        ragged = height * (0.005 + (0.07 if torn > 0.8 else 0.035) * torn) * (index % 2)
        if look.clothes == "coat" and index == hem_points // 2 + 1:
            # The split up the front of a long coat, to the crotch.
            outline += [(x + half * 0.12, hem + ragged * 0.3),
                        (x + half * 0.03, ground - height * 0.44),
                        (x - half * 0.03, ground - height * 0.44),
                        (x - half * 0.12, hem + height * 0.02)]
        outline.append((px, hem + ragged))
    outline += [
        (x - half * 0.74, hips),
        (over(ground - height * 0.6) - half * 0.7, ground - height * 0.6),
        (over(left + height * 0.13) - half * 0.9, left + height * 0.13),
        (over(left) - half * 1.0, left + height * 0.062),
        (over(left) - half * 0.86, left + height * 0.018),
        (over(left) - half * 0.48, left - height * 0.024),
    ]
    parts.append(_polygon("body", "shirt" if look.clothes == "shirt" else "cloth", outline,
                          half * 0.6))
    if look.clothes in ("jacket", "coat"):
        # The shirt underneath, where the jacket hangs open.
        deep = top + height * (0.26 if look.clothes == "coat" else 0.19)
        parts.append(_polygon("body", "shirt", [
            (over(top) - half * 0.26, top - height * 0.022),
            (over(top) + half * 0.26, top - height * 0.022),
            (over(deep) + half * 0.07, deep), (over(deep) - half * 0.09, deep - height * 0.02)],
            half * 0.15, lod=1))

    _head_parts(figure, parts)
    _side_by_side(parts, *(_arm_layers(figure, side, arm) for side, arm in front))
    return parts


def _crawler_parts(figure: Figure) -> list[Part]:
    """Dragging itself up the road on its hands: legs trailing up the picture
    behind it, the back humped between the shoulders, the head low and up."""
    height, x, ground = figure.height, figure.x, figure.ground_y
    look = figure.look
    parts: list[Part] = []
    _side_by_side(parts, *([[_limb("body", "legs", (*hip, height * 0.042),
                                   (*foot, height * 0.03))],
                            [_ellipse("body", "shoe", (foot[0], foot[1] - height * 0.012),
                                      height * 0.024, height * 0.02)]]
                           for hip, foot in figure.trailing_legs()))
    roll = math.sin(figure.phase) * height * 0.02  # the shoulder of the reaching arm rides up
    tone = "shirt" if look.clothes == "shirt" else "cloth"
    seed = figure.seed
    back = [(x - height * 0.17, ground - height * 0.3),
            (x - height * 0.15, ground - height * 0.37 + roll),
            (x - height * 0.07, ground - height * 0.4),
            (x - height * 0.085, ground - height * 0.46)]
    for index in range(5):  # the shirt ridden up, ragged at the waist
        t = index / 4
        back.append((x + height * 0.085 * (2 * t - 1),
                     ground - height * (0.47 + 0.035 * _rag(seed, 60 + index) * (index % 2))))
    back += [(x + height * 0.085, ground - height * 0.46),
             (x + height * 0.07, ground - height * 0.4),
             (x + height * 0.15, ground - height * 0.37 - roll),
             (x + height * 0.17, ground - height * 0.3),
             (x + height * 0.1, ground - height * 0.25),
             (x - height * 0.1, ground - height * 0.25)]
    parts.append(_polygon("body", tone, back, height * 0.08))
    arms = []
    for side, (shoulder, elbow, wrist, hand) in zip((-1, 1), figure._arms):
        if look.sleeves[0 if side < 0 else 1]:
            layers = [[_limb("body", tone, (*shoulder, height * 0.034),
                             (*elbow, height * 0.027))],
                      [_limb("body", "skin", (*elbow, height * 0.024),
                             (*wrist, height * 0.018))]]
        else:
            layers = [[_limb("body", "skin", (*shoulder, height * 0.03),
                             (*elbow, height * 0.024), (*wrist, height * 0.018))], []]
        arms.append(layers + _hand_parts(figure, wrist, hand, side))
    _side_by_side(parts, *arms)
    hx, hy = figure.head
    parts.append(_limb("body", "skin", (x, ground - height * 0.31, height * 0.032),
                       (hx, hy + figure.head_radius * 0.3, height * 0.028)))
    _head_parts(figure, parts)
    return parts


def _robot_parts(figure: Figure) -> list[Part]:
    """An armoured humanoid: plated shins, chest and helmet over a dark frame,
    the joints showing between the plates."""
    height, x = figure.height, figure.x
    half = figure.half_shoulder
    top, hips = figure.shoulder_y, figure.hip_y
    parts: list[Part] = []
    _side_by_side(parts, *([[_limb("body", "frame", (*hip, height * 0.034),
                                   (*knee, height * 0.027))],
                            [_limb("body", "plate", (*knee, height * 0.036),
                                   (*ankle, height * 0.023))],
                            [_ellipse("body", "plate", (knee[0], knee[1] - height * 0.012),
                                      height * 0.028, height * 0.03)],
                            [_ellipse("body", "plate", foot[:2], height * 0.036, height * 0.02,
                                      foot[2])]]
                           for hip, knee, ankle, foot in figure.legs()))
    parts.append(_polygon("body", "plate", [
        (x - height * 0.09, hips - height * 0.03), (x + height * 0.09, hips - height * 0.03),
        (x + height * 0.078, hips + height * 0.045), (x, hips + height * 0.085),
        (x - height * 0.078, hips + height * 0.045)], height * 0.04))
    parts.append(_limb("body", "frame", (x, hips - height * 0.01, height * 0.05),
                       (x, top + height * 0.2, height * 0.056)))
    hx, hy = figure.head
    parts.append(_limb("body", "frame", (x, top, height * 0.022),
                       (hx, hy + figure.head_radius * 0.5, height * 0.02)))
    arms = list(zip((-1, 1), figure._arms))
    for _, (shoulder, elbow, *_) in arms:
        parts.append(_limb("body", "frame", (*shoulder, height * 0.024),
                           (*elbow, height * 0.021)))
    parts.append(_polygon("body", "plate", [
        (x - half * 0.22, top - height * 0.022), (x + half * 0.22, top - height * 0.022),
        (x + half * 0.64, top - height * 0.006), (x + half * 0.93, top + height * 0.04),
        (x + half * 0.82, top + height * 0.14), (x + half * 0.5, top + height * 0.235),
        (x + half * 0.18, top + height * 0.275), (x - half * 0.18, top + height * 0.275),
        (x - half * 0.5, top + height * 0.235), (x - half * 0.82, top + height * 0.14),
        (x - half * 0.93, top + height * 0.04), (x - half * 0.64, top - height * 0.006)],
        half * 0.5))
    _head_parts(figure, parts, metal=True)
    _side_by_side(parts, *([[_ellipse("body", "frame", elbow, height * 0.023, height * 0.023)],
                            [_limb("body", "plate", (*elbow, height * 0.03),
                                   (*wrist, height * 0.023))],
                            *_hand_parts(figure, wrist, hand, side, tone="frame", claws=False),
                            [_ellipse("body", "plate",
                                      (shoulder[0] + side * height * 0.006,
                                       shoulder[1] - height * 0.012),
                                      height * 0.052, height * 0.038, side * 18.0)]]
                           for side, (shoulder, elbow, wrist, hand) in arms))
    return parts


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
    robot: bool = False

    def advance(self, dt: float, now: float) -> None:
        pace = self.speed * (0.25 if now < self.staggered_until else 1.0)
        self.distance = max(0.0, self.distance - pace * dt)
        self.phase += dt * (2.2 + self.speed)
        # They weave as they shamble, but they are coming for you: the lane
        # closes as the distance does.
        self.lane += math.sin(self.phase * 0.5) * self.sway * dt
        self.lane -= self.lane * 0.14 * dt

    def figure(self, view: Perspective, now: float) -> Figure:
        since = now - (self.staggered_until - STAGGER)
        recoil = 0.0
        if self.staggered_until > 0.0 and 0.0 <= since < STAGGER:
            recoil = min(1.0, since / 0.05) * (1.0 - since / STAGGER) ** 2
        return _pose(self.gait, self.robot, self.hunch, self.tilt, self.seed, self.phase,
                     recoil, height=view.height_px(self.distance) * self.build,
                     x=view.screen_x(self.lane, self.distance),
                     ground=view.ground_y(self.distance),
                     fog=min(max((self.distance - 5.0) / 26.0, 0.0), 0.86))


@dataclass
class ZombieRound(Round):
    """Hold the road until dawn. They do not stop coming."""

    walkers: list[Walker] = field(default_factory=list, init=False)
    #: Where each one bled: x, y, size, when, and which way it landed.
    stains: list[tuple[float, float, float, float, int]] = field(
        default_factory=list, init=False)
    #: Every one put down - the walker as it was, when, and whether it was a
    #: head shot - so it can fall, and then lie where it fell.
    fallen: list[tuple[Walker, float, bool]] = field(default_factory=list, init=False)
    #: The backdrop with the settled dead painted into it, kept between frames:
    #: (the backdrop it was painted on, the road, the time it is painted up to).
    road: tuple | None = field(default=None, init=False, repr=False)
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
            self._kill(struck, now, headshot=True)
            return Hit(points=int(HEADSHOT_POINTS * bonus), ring=0,
                       label="HEADSHOT", perfect=True)

        struck.health -= 1
        struck.staggered_until = now + STAGGER
        if struck.health <= 0:
            self._kill(struck, now)
            return Hit(points=int(KILL_POINTS * bonus), ring=1, label="DOWN")
        return Hit(points=WOUND_POINTS, ring=2)

    def _kill(self, walker: Walker, now: float, headshot: bool = False) -> None:
        self.walkers.remove(walker)
        self.kills += 1
        self.fallen.append((walker, now, headshot))
        del self.fallen[:-STAIN_LIMIT]
        if self.options.enemy == "robots":
            return  # a machine leaves a wreck on the road, but no blood
        figure = walker.figure(self.view, now)
        # The pool spreads under where the body comes to rest: across the road
        # from its feet, the way it fell - but a crawler just drops flat.
        rests = figure.x
        if walker.gait != "crawl":
            rests += _fall_side(walker.seed) * figure.height * 0.42
        self.stains.append((rests, figure.ground_y, figure.height * 0.18, now, walker.seed))
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
            robot=self.options.enemy == "robots",
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


def _bloom(height: int, width: int, centre: tuple[int, int], radius: int,
           colour) -> np.ndarray:
    """A disc of ``colour`` blurred by half its radius: one ring of the moon's
    bloom, as an image the size of the frame.

    The widest ring is a Gaussian of sigma 160 on a full-size frame, and
    blurred at that size it took nearly three seconds - the whole of the
    backdrop's cold build - for a picture with nothing sharp left in it. So
    the disc is painted and blurred small, with about eight pixels of blur
    left at the small size, and scaled back up: within a level of the full
    blur everywhere. Rings too small to gain anything are blurred as they are.
    """
    sigma = radius / 2.0
    step = max(1, int(sigma / 8.0))
    if step == 1:
        glow = np.zeros((height, width, 3), np.uint8)
        cv2.circle(glow, centre, radius, colour, -1, cv2.LINE_AA)
        return cv2.GaussianBlur(glow, (0, 0), sigma)
    # Painted at full size and averaged down in blocks, so the small disc
    # carries exactly the light the big one does, in exactly the same place.
    # It is mirrored out past the frame first, as the full blur mirrors the
    # frame at its edges, and the block average is itself a little blur, taken
    # off the one that follows.
    disc = np.zeros((height, width, 3), np.uint8)
    cv2.circle(disc, centre, radius, colour, -1, cv2.LINE_AA)
    margin = math.ceil(4.0 * sigma / step) * step
    rows, cols = -(-height // step), -(-width // step)
    disc = cv2.copyMakeBorder(disc, margin, margin + rows * step - height,
                              margin, margin + cols * step - width, cv2.BORDER_REFLECT_101)
    small = cv2.resize(disc, (disc.shape[1] // step, disc.shape[0] // step),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
    cv2.GaussianBlur(small, (0, 0), math.sqrt(sigma ** 2 - (step ** 2 - 1) / 12.0) / step,
                     dst=small)
    grown = cv2.resize(small, (disc.shape[1], disc.shape[0]), interpolation=cv2.INTER_CUBIC)
    return np.clip(grown[margin:margin + height, margin:margin + width] + 0.5, 0,
                   255).astype(np.uint8)


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
    moon = _moon_centre(width, height, horizon)
    # The radii double as blur sigmas, and a GaussianBlur of sigma 0 with no
    # kernel size to fall back on is an assertion failure, not a no-op. On the
    # chooser card this environment is drawn a couple of dozen pixels tall, and
    # the tightest of the three rounds to nothing there.
    for radius, weight in ((max(1, int(height * 0.34)), 0.16),
                           (max(1, int(height * 0.12)), 0.30),
                           (max(1, int(height * 0.05)), 0.34)):
        glow = _bloom(height, width, moon, radius, MOONLIGHT)
        cv2.addWeighted(canvas, 1.0, glow, weight, 0.0, dst=canvas)
    # Rays: the haze lit in shafts fanning down and to the left from the moon,
    # the one key light everything else in the picture agrees with.
    glow = np.zeros((height, width, 3), np.uint8)
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
    slow, fast = layer(14, 1, 0.55), layer(26, 2, 0.35)
    # Only the rows the fog can change by half a level or more: the banks
    # thin to nothing well inside the strip, and every row costs a blend.
    reach = np.flatnonzero((slow + fast).max(axis=1) * 255.0 >= 0.5)
    first, last = (int(reach[0]), int(reach[-1]) + 1) if reach.size else (0, 0)
    slow, fast = np.ascontiguousarray(slow[first:last]), np.ascontiguousarray(fast[first:last])
    plane = np.empty((last - first, width, 3), np.uint8)
    columns = np.arange(width, dtype=np.float32)
    moonward = np.exp(-((columns - width * 0.76) / (width * 0.3)) ** 2)
    for channel in range(3):
        plane[:, :, channel] = (FOG[channel] + 30 * moonward)[None, :].astype(np.uint8)
    return top + first, slow, fast, plane


def draw_fog(canvas: np.ndarray, view: Perspective, now: float) -> None:
    """The banks roll slowly left to right, two layers at two speeds."""
    height, width = canvas.shape[:2]
    top, slow, fast, plane = _fog_bank(width, height, int(view.horizon))
    rows = slow.shape[0]
    if rows <= 0:
        return
    # Each layer rolled round by slicing it into place, not by np.roll, which
    # would build a copy of each only to add them together.
    alpha = np.empty_like(slow)
    shift = int(now * 9) % width
    alpha[:, shift:] = slow[:, :width - shift]
    alpha[:, :shift] = slow[:, width - shift:]
    shift = int(now * 23) % width
    alpha[:, shift:] += fast[:, :width - shift]
    alpha[:, :shift] += fast[:, width - shift:]
    np.minimum(alpha, 0.85, out=alpha)
    region = canvas[top:top + rows]
    cv2.blendLinear(region, plane, 1.0 - alpha, alpha, dst=region)


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


#: Figures are painted with four bits of sub-pixel precision, so a small one in
#: the fog glides instead of hopping a pixel at a time, and a moonlit edge can
#: be a pixel and a half wide.
FIX_BITS = 4
FIX = 1 << FIX_BITS


def _fix(value: float) -> int:
    return int(round(value * FIX))


def _fixed(points: np.ndarray) -> np.ndarray:
    """Outline points in pixels, as the fixed-point integers OpenCV draws with."""
    return np.rint(points * FIX).astype(np.int32)


def _fill(canvas: np.ndarray, groups: tuple[tuple[Piece, ...], ...], fixed: np.ndarray,
          colours: list) -> None:
    """Fill each run of pieces, in order, in its colour: one call a run."""
    for run, colour in zip(groups, colours):
        cv2.fillPoly(canvas, [fixed[piece.start:piece.stop] for piece in run], colour,
                     cv2.LINE_AA, FIX_BITS)


# How the moon takes each tone: how much of it the side of a form turned to
# the moon picks up, and how bright its very edge goes. Wet skin and machined
# plate shine; wool and denim barely do.
_SHEEN = {"skin": (0.25, 0.92), "cloth": (0.17, 0.74), "shirt": (0.2, 0.78),
          "legs": (0.14, 0.7), "shoe": (0.1, 0.55), "hair": (0.12, 0.62),
          "plate": (0.3, 0.96), "frame": (0.12, 0.66)}
MOON_TINT = (214, 206, 192)  # the moon's cold white on the side of a form turned to it
SHOE = (14, 14, 16)
SOCKET = (11, 10, 12)  # eye sockets, a mouth: the darkest things on the road
PLATE = (50, 47, 44)  # the machines: gunmetal plates over a near-black frame
FRAME = (27, 26, 26)
SEAM = (20, 19, 19)
VISOR = (255, 234, 150)  # a machine's one light, where its eyes would be


@lru_cache(maxsize=512)
def _tones(seed: int, robot: bool, haze: float, light: float) -> dict[str, tuple]:
    """Each of one walker's colours as (rim, lit side, body, and one for a
    part too thin to show the lit side), in its fog and in the muzzle flash.
    ``haze`` and ``light`` come rounded, so there are few."""
    if robot:
        base = {"plate": PLATE, "frame": FRAME}
    else:
        look = _look(seed)
        base = {"skin": look.skin, "cloth": look.cloth, "shirt": look.shirt,
                "legs": look.legs, "shoe": SHOE, "hair": look.hair_tone}
    tones = {}
    for name, colour in base.items():
        sheen, edge = _SHEEN[name]
        body = _mix(colour, FLASH, light * (0.2 if name == "skin" else 0.1))
        lit = _mix(body, MOON_TINT, sheen)
        rim = _mix(colour, RIM, edge)
        # The fog takes the body; the moon's edge, which is light in the fog
        # itself, it barely touches - a far one is found by its outline.
        lit, body = _fogged(lit, haze), _fogged(body, haze)
        tones[name] = (_fogged(rim, haze * 0.35), lit, body, _mix(body, lit, 0.25))
    return tones


def _moon_centre(width: int, height: int, horizon: float) -> tuple[int, int]:
    """Where the moon hangs in the backdrop: the light everything is lit by."""
    return int(width * 0.76), int(int(horizon) - height * 0.17)


def _moonward(canvas: np.ndarray, view: Perspective, figure: Figure) -> tuple[float, float]:
    """The way to the moon on screen from this figure's chest: the side its rim
    is on. Never quite straight up, so one under the moon still has an edge
    down its side."""
    height, width = canvas.shape[:2]
    mx, my = _moon_centre(width, height, view.horizon)
    dx, dy = mx - figure.x, my - (figure.shoulder_y + figure.hip_y) * 0.5
    norm = math.hypot(dx, dy) or 1.0
    dx, dy = dx / norm, dy / norm
    if abs(dx) < 0.45:
        dx = math.copysign(0.45, dx or 1.0)
        dy = -math.sqrt(1.0 - dx * dx)
    return dx, dy


@lru_cache(maxsize=256)
def _shadow_stamp(rx: int, ry: int, degrees: int, strength: int) -> np.ndarray:
    """A soft ellipse of shade as a multiplier: 255 leaves the road as it is,
    less darkens it. ``strength`` is in percent."""
    angle = math.radians(degrees)
    pad = max(2, int(ry * 1.2))
    half_w = int(math.hypot(rx * math.cos(angle), ry * math.sin(angle))) + pad
    half_h = int(math.hypot(rx * math.sin(angle), ry * math.cos(angle))) + pad
    mask = np.zeros((2 * half_h + 1, 2 * half_w + 1), np.float32)
    cv2.ellipse(mask, (half_w, half_h), (rx, ry), degrees, 0, 360, 1.0, -1, cv2.LINE_AA)
    mask = cv2.GaussianBlur(mask, (0, 0), max(0.7, ry * 0.45))
    keep = np.clip(255.0 - mask * strength * 2.55, 0, 255).astype(np.uint8)
    return cv2.merge((keep, keep, keep))


def _shade(canvas: np.ndarray, centre: tuple[float, float], rx: float, ry: float,
           degrees: float, strength: float) -> None:
    """Darken a soft ellipse of the road: a shadow, with no edge to it. Sizes
    and strengths are rounded, so the frames either side share a stamp."""
    stamp = _shadow_stamp(max(2, _bucket(rx)), _bucket(ry), int(degrees),
                          int(strength * 10 + 0.5) * 10)
    _stamp(canvas, stamp, centre, cv2.multiply, 1.0 / 255.0)


def _bucket(value: float) -> int:
    """A size in pixels rounded to about six percent, and to the pixel below
    sixteen."""
    if value < 16.0:
        return max(1, int(round(value)))
    return int(round(1.06 ** round(math.log(value, 1.06))))


def _stamp(canvas: np.ndarray, stamp: np.ndarray, centre: tuple[float, float], op,
           scale: float = 1.0) -> None:
    """Apply ``stamp`` centred on ``centre`` with ``op`` (add or multiply),
    cut to the canvas."""
    height, width = canvas.shape[:2]
    sh, sw = stamp.shape[:2]
    x0, y0 = int(round(centre[0])) - sw // 2, int(round(centre[1])) - sh // 2
    cx0, cy0 = max(0, x0), max(0, y0)
    cx1, cy1 = min(width, x0 + sw), min(height, y0 + sh)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    patch = canvas[cy0:cy1, cx0:cx1]
    piece = stamp[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]
    if scale == 1.0:
        op(patch, piece, dst=patch)
    else:
        op(patch, piece, dst=patch, scale=scale)


@lru_cache(maxsize=128)
def _glow_stamp(radius: int, colour: tuple[int, int, int]) -> np.ndarray:
    """A soft point of light, to be added to the picture."""
    reach = radius * 3
    ys, xs = np.mgrid[-reach:reach + 1, -reach:reach + 1].astype(np.float32)
    fall = np.exp(-(xs * xs + ys * ys) / (2.0 * radius * radius))
    return (fall[:, :, None] * np.float32(colour)).astype(np.uint8)


def _glow(canvas: np.ndarray, centre: tuple[float, float], radius: float, colour,
          strength: float) -> None:
    tint = tuple(int(c * strength) for c in colour)
    _stamp(canvas, _glow_stamp(max(1, int(round(radius))), tint), centre, cv2.add)


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


def _head_point(figure: Figure, px: float, py: float) -> tuple[float, float]:
    """A point on the face, in head radii from the middle of the skull, turned
    with the head."""
    angle = math.radians(figure.tilt * (0.3 if figure.robot else 1.0))
    cos, sin = math.cos(angle), math.sin(angle)
    radius, (hx, hy) = figure.head_radius, figure.head
    return hx + (px * cos - py * sin) * radius, hy + (px * sin + py * cos) * radius


def _eye_points(figure: Figure) -> tuple[tuple[float, float], tuple[float, float]]:
    return _head_point(figure, -0.36, 0.08), _head_point(figure, 0.36, 0.08)


def _cast_shadow(canvas: np.ndarray, figure: Figure, edge: np.ndarray,
                 fall: float = 0.0) -> None:
    """Its shadow: thrown long down the road and away from the moon, and a
    tight dark patch where it touches the road, so it stands on it. Going
    over, the long shadow shortens and the patch spreads under the body."""
    height, fade = figure.height, 1.0 - figure.fog * 0.6
    crawl = figure.gait == "crawl"
    if fall < 1.0:
        reach = height * (0.28 if crawl else 0.5) * (1.0 - fall)
        _shade(canvas, (figure.x - reach * 0.42, figure.ground_y + reach * 0.12),
               max(2.0, reach * 0.52), height * 0.05, -17.0, 0.5 * fade)
    if fall > 0.0:
        low, high = edge.min(axis=0), edge.max(axis=0)
        _shade(canvas, ((low[0] + high[0]) * 0.5, figure.ground_y),
               (high[0] - low[0]) * 0.55, height * 0.035, 0.0, 0.7 * fade * fall)
    if fall < 1.0:
        _shade(canvas, (figure.x, figure.ground_y - height * (0.02 if crawl else 0.0)),
               height * (0.24 if crawl else 0.15), height * 0.03, 0.0,
               0.75 * fade * (1.0 - fall))


#: Seconds one takes to hit the road once it is put down.
FALL = 0.4
#: Seconds after a kill that its pool has stopped spreading and its body has
#: soaked to the colour of the tar: from then on it is part of the road.
SETTLED = 12.0
TAR = (24, 22, 20)  # what the rags and the flesh soak to, lying on the road


def _fall_side(seed: int) -> int:
    """Which way this one falls, and lies: to its left or its right."""
    return 1 if _rag(seed, 20) < 0.5 else -1


def _toppled(figure: Figure, fall: float) -> tuple[np.ndarray, np.ndarray]:
    """How far over it has gone, ``fall`` from 0 upright to 1 flat on the road,
    as a transform about its feet: turned sideways and flattened into the
    angle you see the road at. Gravity: slow to start, fast at the end. A
    crawler has nowhere to fall to, and only drops flat."""
    eased = fall * fall
    side = _fall_side(figure.seed)
    turn = math.radians((12.0 if figure.gait == "crawl" else 86.0) * side * eased)
    flat = 1.0 - (0.45 if figure.gait == "crawl" else 0.58) * eased
    cos, sin = math.cos(turn), math.sin(turn)
    transform = np.float32(((cos, -sin), (sin * flat, cos * flat)))
    return transform, np.float32((figure.x - figure.lean * figure.height, figure.ground_y))


@lru_cache(maxsize=256)
def _dead_tones(seed: int, robot: bool, haze: float, settle: float) -> dict[str, tuple]:
    """A body's colours as it lies: the moon still on its upper edge while it is
    fresh; then the edge goes, and the rags and the flesh soak to the colour of
    the tar, until it is a low dark shape on the road, not a drawing of a body."""
    tones = {}
    for name, (rim, lit, body, _) in _tones(seed, robot, haze, 0.0).items():
        body = _mix(body, _fogged(TAR, haze), settle * 0.7)
        lit = _mix(lit, body, 0.3 + 0.7 * settle)
        tones[name] = (_mix(rim, lit, 0.25 + 0.75 * settle), lit, body, _mix(body, lit, 0.25))
    return tones


def _draw_figure(canvas: np.ndarray, figure: Figure, view: Perspective,
                 light: float, fall: float = 0.0, settle: float = 0.0,
                 eyes: float = 1.0) -> None:
    """The whole silhouette first, nudged towards the moon in its rim colour,
    so a thin cold edge shows only on the side the moon is on; then part by
    part, back to front, each in its lit colour and again drawn in and nudged
    away from the moon in its own dark body colour, so every limb and the
    skull are rounded by a band of moonlight down one side.

    ``fall`` topples it towards the road; ``settle`` soaks a body that has
    lain there a while into the tar; ``eyes`` is how much light is left in
    them."""
    height = figure.height
    haze = round(figure.fog * 0.8, 2)
    if settle > 0.0:
        tones = _dead_tones(figure.seed, figure.robot, haze, round(settle, 1))
    else:
        tones = _tones(figure.seed, figure.robot, haze, round(light, 1))
    mesh, outline, groups = figure.mesh, figure.outline, figure.groups
    if fall > 0.0:
        turn, feet = _toppled(figure, fall)

        def place(points: np.ndarray) -> np.ndarray:
            return (points - feet) @ turn.T + feet
    else:
        def place(points: np.ndarray) -> np.ndarray:
            return points
    edge = place(outline)
    _cast_shadow(canvas, figure, edge, fall)

    mx, my = _moonward(canvas, view, figure)
    rim = max(1.25, height * 0.0075)
    _fill(canvas, groups, _fixed(edge + np.float32((mx * rim, my * rim))),
          [tones[run[0].tone][0] for run in groups])
    if light > 0.0 and height > 24:
        # The muzzle flash catches the edge turned to the gun, below the
        # picture: a warm rim opposite the moon's, for the frame the shot lasts.
        gx, gy = view.area.centre_x - figure.x, view.area.bottom + height - figure.ground_y
        norm = (math.hypot(gx, gy) or 1.0) / (rim * 1.3)
        warm = _mix((40, 40, 44), FLASH, min(1.0, light) * 0.8)
        _fill(canvas, groups, _fixed(edge + np.float32((gx / norm, gy / norm))),
              [warm] * len(groups))
    if figure.lod == 0:
        _fill(canvas, groups, _fixed(edge), [tones[run[0].tone][3] for run in groups])
    else:
        # The planes are lit from further round to the moon's side than the
        # rim is: from straight below it, both flanks of a limb would catch
        # the same light and every limb would read as outlined.
        lx, ly = mx + math.copysign(0.7, mx), my
        norm = math.hypot(lx, ly)
        away = np.float32((-lx / norm, -ly / norm))
        inset = np.minimum(np.float32(height * 0.011), mesh.depth * np.float32(0.3))
        passes = [(_fixed(edge), 1)]
        if figure.lod >= 3:
            # Near enough to see the step: soften it with one between.
            soft = inset * np.float32(0.55)
            passes.append((_fixed(place(mesh.centre + (mesh.radius - soft)[:, None]
                                        * mesh.direction)
                                  + (inset * np.float32(0.8))[:, None] * away), None))
        passes.append((_fixed(place(mesh.centre + (mesh.radius - inset)[:, None]
                                    * mesh.direction)
                              + (inset * np.float32(1.35))[:, None] * away), 2))
        # A part whose band of light would be under a pixel wide is filled
        # once: the band would not show, and the fill is most of the cost.
        band = height * 0.011
        for run in groups:
            _, lit, body, even = tones[run[0].tone]
            if min(band, run[0].depth * height * 0.3) < 0.6:
                cv2.fillPoly(canvas, [passes[0][0][piece.start:piece.stop] for piece in run],
                             even, cv2.LINE_AA, FIX_BITS)
                continue
            for fixed, which in passes:
                colour = lit if which == 1 else body if which == 2 else _mix(lit, body, 0.55)
                cv2.fillPoly(canvas, [fixed[piece.start:piece.stop] for piece in run], colour,
                             cv2.LINE_AA, FIX_BITS)
    if fall == 0.0:
        if figure.robot:
            _draw_machine(canvas, figure, haze, light)
        else:
            _draw_face(canvas, figure, haze, light)
    elif eyes > 0.0 and not figure.robot:
        # Going over, the light in its eyes goes out.
        shine = _mix(EYESHINE, FLASH, light * 0.6)
        for eye in place(np.float32(_eye_points(figure))):
            _glow(canvas, eye, max(1.2, figure.head_radius * 0.3), shine, 0.5 * eyes)


def _draw_face(canvas: np.ndarray, figure: Figure, haze: float, light: float) -> None:
    """Sunken sockets, the hole of a nose, a mouth hanging open - and in the
    sockets the eyes, catching the moon at any distance, which is how you find
    them in the fog."""
    radius = figure.head_radius
    dark = _fogged(SOCKET, haze)
    left, right = _eye_points(figure)
    degrees = figure.tilt
    if radius >= 4.5:
        for eye, slant in ((left, -14.0), (right, 14.0)):
            cv2.ellipse(canvas, (_fix(eye[0]), _fix(eye[1])),
                        (_fix(radius * 0.3), _fix(radius * 0.21)), degrees + slant, 0, 360, dark,
                        -1, cv2.LINE_AA, FIX_BITS)
    if radius >= 8:
        opened = 0.3 * figure.look.jaw
        shapes = [((0.0, 0.26), (-0.1, 0.42), (0.0, 0.38), (0.1, 0.42))]
        if figure.look.jaw > 0.3:
            shapes.append(((-0.22, 0.56), (0.02, 0.53), (0.22, 0.58), (0.15, 0.66 + opened),
                           (-0.02, 0.74 + opened), (-0.2, 0.66 + opened)))
        for shape in shapes:
            points = np.array([_head_point(figure, px, py) for px, py in shape], np.float32)
            cv2.fillPoly(canvas, [np.rint(points * FIX).astype(np.int32)], dark, cv2.LINE_AA,
                         FIX_BITS)
    shine = _mix(EYESHINE, FLASH, light * 0.6)
    if figure.height < 14:
        # Too small for two: one soft pale point where its face is.
        mid = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
        _glow(canvas, mid, 1.6, shine, 0.55)
        cv2.line(canvas, (int(left[0]), int(left[1])), (int(right[0]), int(right[1])), shine,
                 1, cv2.LINE_AA)
        return
    for eye in (left, right):
        _glow(canvas, eye, max(1.2, radius * 0.3), shine, 0.5)
        cv2.circle(canvas, (_fix(eye[0]), _fix(eye[1])), _fix(max(0.8, radius * 0.11)), shine,
                   -1, cv2.LINE_AA, FIX_BITS)


def _draw_machine(canvas: np.ndarray, figure: Figure, haze: float, light: float) -> None:
    """A machine's face is one lit visor; its chest carries a second light,
    and the seams between its plates show once it is near enough."""
    height, x = figure.height, figure.x
    visor = _fogged(VISOR, haze * 0.4)
    seam = _fogged(SEAM, haze)
    top = figure.shoulder_y
    thin = max(1, int(height * 0.004))
    if height >= 60:
        half = figure.half_shoulder
        lines = (((x, top + height * 0.0), (x, top + height * 0.27)),
                 ((x - half * 0.8, top + height * 0.13), (x - half * 0.1, top + height * 0.17)),
                 ((x + half * 0.8, top + height * 0.13), (x + half * 0.1, top + height * 0.17)),
                 ((x - height * 0.045, top + height * 0.3), (x + height * 0.045, top + height * 0.3)),
                 ((x - height * 0.048, top + height * 0.34), (x + height * 0.048, top + height * 0.34)))
        for a, b in lines:
            cv2.line(canvas, (_fix(a[0]), _fix(a[1])), (_fix(b[0]), _fix(b[1])), seam, thin,
                     cv2.LINE_AA, FIX_BITS)
        for _, knee, ankle, _ in figure.legs():
            mid = ((knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2)
            cv2.line(canvas, (_fix(mid[0]), _fix(mid[1] - height * 0.05)),
                     (_fix(mid[0]), _fix(mid[1] + height * 0.06)), seam, thin, cv2.LINE_AA,
                     FIX_BITS)
    band = np.array([_head_point(figure, px, py) for px, py in (
        (-0.66, -0.12), (0.66, -0.12), (0.6, 0.1), (-0.6, 0.1))], np.float32)
    cv2.fillPoly(canvas, [np.rint(band * FIX).astype(np.int32)], _mix(visor, SEAM, 0.35),
                 cv2.LINE_AA, FIX_BITS)
    slit = np.array([_head_point(figure, px, py) for px, py in (
        (-0.58, -0.05), (0.58, -0.05), (0.54, 0.04), (-0.54, 0.04))], np.float32)
    cv2.fillPoly(canvas, [np.rint(slit * FIX).astype(np.int32)], visor, cv2.LINE_AA, FIX_BITS)
    radius = figure.head_radius
    for px in (-0.3, 0.3):
        _glow(canvas, _head_point(figure, px, 0.0), max(1.2, radius * 0.35), visor, 0.45)
    core = (x, top + height * 0.075)
    _glow(canvas, core, max(1.2, height * 0.02), visor, 0.5)
    cv2.circle(canvas, (_fix(core[0]), _fix(core[1])), _fix(max(0.8, height * 0.011)), visor,
               -1, cv2.LINE_AA, FIX_BITS)


def draw_walker(canvas: np.ndarray, walker: Walker, view: Perspective,
                now: float, light: float = 0.0) -> None:
    """One of them - or one of the machines - moonlit from behind and up to
    the right, its shadow thrown down the road towards you. ``light`` is how
    much of the muzzle flash reaches it this frame."""
    figure = walker.figure(view, now)
    if figure.height < 5:
        return
    _draw_figure(canvas, figure, view, light)


def draw_robot(canvas: np.ndarray, walker: Walker, view: Perspective,
               now: float, light: float = 0.0) -> None:
    """One of the machines: the same figure, the same moon, in plate and a lit
    visor instead of rags and eyes."""
    draw_walker(canvas, walker, view, now, light)


def draw_stains(canvas: np.ndarray, round_: ZombieRound, now: float = 0.0,
                after: float = -math.inf) -> None:
    """What is left where they fell: what ran out of them, and the bodies.

    A pool spreads fast for a few seconds after the fall, then creeps out
    across the asphalt and dries towards black, and each body soaks slowly to
    the colour of the tar, so the road at the end of the round reads as the
    battlefield it was. Only the kills since ``after`` are drawn: the game
    paints older ones, which have stopped changing, into the road itself.
    """
    stains = [stain for stain in round_.stains if stain[3] > after]
    bodies = [(walker, at, headshot) for walker, at, headshot in round_.fallen
              if at > after and now - at >= FALL]
    if stains:
        _draw_pools(canvas, stains, now)
    view = round_.view
    for walker, at, headshot in sorted(bodies, key=lambda body: -body[0].distance):
        _draw_fallen(canvas, view, walker, at, headshot, now)


def _draw_pools(canvas: np.ndarray, stains: list, now: float) -> None:
    height, width = canvas.shape[:2]
    xs = [int(x) for x, *_ in stains]
    ys = [int(y) for _, y, *_ in stains]
    rs = [int(r * 3.4) + 3 for _, _, r, *_ in stains]
    x0 = max(0, min(x - r for x, r in zip(xs, rs)))
    x1 = min(width, max(x + r for x, r in zip(xs, rs)))
    y0 = max(0, min(y - r for y, r in zip(ys, rs)))
    y1 = min(height, max(y + r for y, r in zip(ys, rs)))
    if x1 <= x0 or y1 <= y0:
        return
    patch = canvas[y0:y1, x0:x1]
    overlay = patch.copy()
    gloss = []
    for x, y, radius, at, seed in stains:
        age = min(now - at - FALL, SETTLED)
        if age < 0.0:
            continue  # it has not landed yet
        spread = min(1.0, 0.35 + age / 3.0) + 0.4 * age / SETTLED
        dry = age / SETTLED
        colour = _mix(_mix(BLOOD_FRESH, BLOOD, min(1.0, age / 6.0)), STAIN, dry)
        if age > SETTLED * 0.6:
            # An old pool is a dark wet patch, no redder than the tar around it.
            colour = _mix(colour, (26, 22, 24), 0.4 * min(1.0, (age - SETTLED * 0.6) / 2.0))
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



def _draw_fallen(canvas: np.ndarray, view: Perspective, walker: Walker, at: float,
                 headshot: bool, now: float, light: float = 0.0) -> None:
    """One that has been put down: going over, and then lying where it fell.

    It keeps the pose it had when the shot landed, arms flung up as it goes,
    and falls about its feet. The light in its eyes fades as it falls - or
    goes out at once, for a head shot."""
    age = max(0.0, now - at)
    fall = min(1.0, age / FALL)
    struck = walker.figure(view, at)
    down = fall >= 1.0
    figure = _pose(walker.gait, walker.robot, walker.hunch, walker.tilt, walker.seed,
                   walker.phase, max(struck.recoil, 1.0 if down else fall),
                   height=struck.height, x=view.screen_x(walker.lane, walker.distance),
                   ground=struck.ground_y, fog=struck.fog,
                   # Lying still, no one sees its fingers.
                   detail=min(_detail(struck.height), 1) if down else -1)
    if figure.height < 5:
        return
    settle = min(1.0, (age - FALL) / SETTLED) if down else 0.0
    _draw_figure(canvas, figure, view, light, fall=fall, settle=settle,
                 eyes=0.0 if headshot else 1.0 - fall)
    if headshot and down and figure.height > 30 and settle < 1.0:
        # The exit wound's spray, thrown past the head along the road; it
        # dries into the road with the rest.
        turn, feet = _toppled(figure, 1.0)
        head = (np.float32(figure.head) - feet) @ turn.T + feet
        side = _fall_side(walker.seed)
        colour = _mix(BLOOD_FRESH, STAIN, min(1.0, age / 4.0))
        for index in range(5):
            reach = figure.head_radius * (1.6 + 2.2 * _rag(walker.seed, 30 + index))
            spot = (head[0] + side * reach,
                    head[1] + (_rag(walker.seed, 34 + index) - 0.5) * figure.head_radius)
            cv2.circle(canvas, (_fix(spot[0]), _fix(spot[1])),
                       _fix(max(0.8, figure.head_radius * 0.16)), colour, -1, cv2.LINE_AA,
                       FIX_BITS)


def _road(round_: ZombieRound, now: float, width: int, height: int) -> np.ndarray:
    """The backdrop, with every kill that has settled painted into the road.

    A pool that has stopped spreading and a body soaked to the colour of the
    tar no longer change, so they are painted once, into a copy of the
    backdrop, instead of every frame: the road carries a whole night of them
    for the cost of copying it. Painted up to a time, and started again if
    asked for an earlier one."""
    area = round_.area
    backdrop = _environment((area.x, area.y, area.width, area.height), width, height,
                            round_.options.seed or 0, round_.skyline)
    road = round_.road
    if road is None or road[0] is not backdrop or now < road[2]:
        road = (backdrop, backdrop.copy(), -math.inf)
    _, image, done = road
    settled = now - FALL - SETTLED
    if settled > done:
        pools = [stain for stain in round_.stains if done < stain[3] <= settled]
        if pools:
            _draw_pools(image, pools, math.inf)
        bodies = [body for body in round_.fallen
                  if done < body[1] <= settled]
        for walker, at, headshot in sorted(bodies, key=lambda body: -body[0].distance):
            _draw_fallen(image, round_.view, walker, at, headshot, at + FALL + SETTLED)
        road = (backdrop, image, settled)
    round_.road = road
    return image


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

    head = impact.ring == 0
    if age < IMPACT_FLASH:
        spray = age / IMPACT_FLASH
        # A head shot throws twice as much, twice as far.
        specks = 16 if head else 9
        throw = 70 if head else 40
        for index in range(specks):
            angle = index * math.tau / specks + impact.at
            reach = (6 + throw * spray) * (0.5 + 0.5 * math.sin(angle * 3)) * depth
            speck = (int(centre[0] + math.cos(angle) * reach),
                     int(centre[1] + math.sin(angle) * reach * 0.7 + 30 * spray * spray * depth))
            cv2.circle(canvas, speck, max(1, int((2 * (1 - spray) + 1) * depth)), BLOOD, -1,
                       cv2.LINE_AA)
    if head and age < 0.12:
        # And the skull flashes pale as the round goes through: there and gone.
        scale = max(0.5, canvas.shape[0] / 720.0)
        _glow(canvas, centre, 9 * depth * scale, MOONLIGHT, 0.9 * (1.0 - age / 0.12))
    size = 5 * life * depth * max(0.5, (canvas.shape[0] / 720.0))
    _alpha_ellipse(canvas, centre, (max(1, int(size)), max(1, int(size * 0.9))), BLOOD,
                   life * 0.8)


def draw_sparks(canvas: np.ndarray, impact: Impact, now: float,
                view: Perspective | None = None) -> None:
    """A round off armour: sparks thrown out in streaks, white-hot at the start
    and cooling to orange as they fly and drop, over in a third of a second -
    and a head shot throws twice as many off the helmet."""
    age = now - impact.at
    if not impact.is_hit or not 0.0 <= age < 0.3:
        return
    life = age / 0.3
    depth = _depth_scale(view, impact.y) if view is not None else 1.0
    scale = max(0.5, canvas.shape[0] / 720.0) * depth
    if age < 0.08:
        _glow(canvas, (impact.x, impact.y), 7 * scale, (170, 230, 255), 1.0 - age / 0.08)
    count = 14 if impact.ring == 0 else 8
    colour = _mix((230, 250, 255), (40, 150, 255), life)
    for index in range(count):
        angle = index * math.tau / count + _rag(int(impact.at * 1000), index) * 0.6
        speed = (50 + 70 * _rag(int(impact.at * 1000), index + 20)) * scale
        head = speed * life
        tail = max(0.0, head - 14 * scale * (1.0 - life * 0.5))
        drop = 40 * scale * life * life
        start = (impact.x + math.cos(angle) * tail, impact.y + math.sin(angle) * tail + drop * 0.6)
        end = (impact.x + math.cos(angle) * head, impact.y + math.sin(angle) * head + drop)
        cv2.line(canvas, (_fix(start[0]), _fix(start[1])), (_fix(end[0]), _fix(end[1])), colour,
                 max(1, int(round(1.6 * scale * (1.0 - life * 0.5)))), cv2.LINE_AA, FIX_BITS)


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
        tag = (impact.label or "").title()  # the voice's Title Case: "Headshot"
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
    # The light, drawn grey straight into three channels, to be added on.
    mask = np.zeros((span, width, 3), np.uint8)
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
        cv2.line(mask, (x, y), (x - 1 - 2 * layer, y + length), (tone, tone, tone), 1,
                 cv2.LINE_AA)
    # The bright few: close enough to catch the moon, two pixels wide.
    for index in range(max(4, drops // 14)):
        x = int((_rag(index + 900, 1) * 1.1 - 0.05) * width + now * -70) % (width + 40)
        y = int((_rag(index + 900, 2) * span + now * 1250) % span)
        if y + top < horizon + span * 0.2:
            continue
        length = int(16 + 18 * _rag(index + 900, 3))
        cv2.line(mask, (x, y), (x - 3, y + length), (46, 46, 46), 2, cv2.LINE_AA)
        cv2.line(mask, (x, y), (x - 3, y + length), (96, 96, 96), 1, cv2.LINE_AA)
    if view is not None:
        _draw_ripples(mask, view, now, max(6, drops // 8), top)
    region = canvas[top:bottom]
    cv2.add(region, mask, dst=region)


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
        tone = int(70 * fade)
        cv2.ellipse(mask, (ground[0], y), axes, 0, 0, 360, (tone, tone, tone), 1, cv2.LINE_AA)


def draw_footer_strip(canvas: np.ndarray, area: Rect) -> None:
    """A solid dark strip under the play area, for the help text to sit on."""
    height, width = canvas.shape[:2]
    top = min(height, max(0, area.bottom))
    if top >= height:
        return
    strip = canvas[top:]
    cv2.addWeighted(strip, 0.18, np.zeros_like(strip), 0.82, 0.0, dst=strip)
    cv2.line(canvas, (0, top), (width, top), (30, 30, 34), 1)


def draw_world(canvas: np.ndarray, round_: ZombieRound, now: float) -> None:
    area = round_.area
    height, width = canvas.shape[:2]
    canvas[:] = _road(round_, now, width, height)
    robots = round_.options.enemy == "robots"
    draw_stains(canvas, round_, now, after=now - FALL - SETTLED)
    draw_enemy = draw_robot if robots else draw_walker

    last_shot = round_.last_shot()
    flash = (last_shot is not None and 0.0 <= now - last_shot < MUZZLE_FLASH)

    # Painter's algorithm: the far ones first, so the near ones stand in front,
    # with the fog rolling between the far ones and the near ones. The ones
    # going over are in among them, where they were standing.
    falling = [(walker, at, headshot) for walker, at, headshot in round_.fallen
               if 0.0 <= now - at < FALL]
    ordered = sorted([(walker, None) for walker in round_.walkers] + [
        (walker, (at, headshot)) for walker, at, headshot in falling],
        key=lambda entry: -entry[0].distance)

    def lit(walker: Walker) -> float:
        if not flash:
            return 0.0
        return max(0.0, 1.0 - (walker.distance / 13.0) ** 2)

    def draw(walker: Walker, fell: tuple | None) -> None:
        if fell is None:
            draw_enemy(canvas, walker, round_.view, now, lit(walker))
        else:
            _draw_fallen(canvas, round_.view, walker, fell[0], fell[1], now, lit(walker))

    for walker, fell in ordered:
        if walker.distance > 9.0:
            draw(walker, fell)
    draw_fog(canvas, round_.view, now)
    for walker, fell in ordered:
        if walker.distance <= 9.0:
            draw(walker, fell)
    for impact in round_.impacts:
        if robots:
            draw_sparks(canvas, impact, now, round_.view)
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


# --- the readouts ------------------------------------------------------------

class Readout(NamedTuple):
    """One thing this map says beside the score: a short label, its value as
    it reads, and for a gauge how full it is and how many steps it goes down
    in."""

    label: str
    value: str
    level: float | None = None
    steps: int | None = None


def readouts(round_: ZombieRound, now: float) -> tuple[Readout, ...]:
    """What the night stands at, for whichever panel carries it - today the
    strip this map draws under the score, later the app's one score panel.

    Health is a gauge that goes down a bite at a time; the rest are numbers
    in the voice of the rest of the game."""
    return (Readout("Health", str(round_.health), round_.health / FULL_HEALTH,
                    math.ceil(FULL_HEALTH / BITE_DAMAGE)),
            Readout("Wave", str(round_.wave(now))),
            Readout("Down", f"{round_.kills:,}"),
            Readout("Enemy", round_.options.enemy.title()))


def readout_line(round_: ZombieRound, now: float) -> str:
    """The readouts as the one line under the health gauge: "Wave 1 · 0 down"."""
    values = {readout.label: readout.value for readout in readouts(round_, now)}
    return f"Wave {values['Wave']} · {values['Down']} down"


def draw_hud(canvas: np.ndarray, round_: ZombieRound, origin: tuple[int, int],
             now: float) -> None:
    """The health gauge and the line under it, below the shared score block."""
    x, y = origin
    scale = min(max(canvas.shape[0] / 720.0, 0.7), 2.4)

    def line(offset: float) -> int:
        return y + round(offset * scale)

    health = readouts(round_, now)[0]
    bar = Rect(x, line(146), round(240 * scale), round(14 * scale))
    cv2.rectangle(canvas, (bar.x, bar.y), (bar.right, bar.bottom), (30, 28, 27), -1)
    filled = int(bar.width * health.level)
    if filled:
        low = round_.health <= LOW_HEALTH
        colour = (60, 60, 210) if low else (96, 150, 104)
        if low:
            colour = _mix(colour, (80, 90, 255), _heartbeat(now, 0.85))
        cv2.rectangle(canvas, (bar.x, bar.y), (bar.x + filled, bar.bottom), colour, -1)
    # A notch where the bar will stand after each bite, so it reads in bites
    # left rather than in percent - however many the constants make that.
    for bite in range(1, health.steps):
        tx = bar.x + bar.width * (FULL_HEALTH - bite * BITE_DAMAGE) // FULL_HEALTH
        cv2.line(canvas, (tx, bar.y), (tx, bar.bottom), (20, 20, 20), 1)
    cv2.rectangle(canvas, (bar.x, bar.y), (bar.right, bar.bottom), (120, 116, 110), 1)
    draw_text(canvas, readout_line(round_, now), (x, line(182)), (168, 164, 158),
              scale=0.6 * scale)


#: The poster's cast: (gait, metres away, where across the picture as a
#: fraction of its width, seed, hunch, tilt, phase). Placed by where they
#: land in the picture rather than by lane, so the card and the wide score
#: card frame them alike.
POSTER = (("shamble", 15.0, 0.62, 71, 0.4, 10.0, 2.0),
          ("limp", 12.5, 0.36, 58, -0.5, -14.0, 4.4),
          ("shamble", 8.5, 0.53, 23, 0.7, 8.0, 5.3),
          ("lurch", 5.6, 0.25, 40, 0.5, -18.0, 0.9),
          ("crawl", 4.4, 0.47, 90, 0.0, 12.0, 2.6))
POSTER_HERO = ("shamble", 1.75, 0.7, 44, 0.35, -14.0, 1.1)


def draw_emblem(panel: np.ndarray) -> None:
    """The map's poster, for its card and its score card, from the same
    renderer as the game: the nearest of them close enough to touch, moonlit
    down one side, your sights on its skull; the rest coming up the road out
    of the fog behind it; and one already down on the tar between you."""
    height, width = panel.shape[:2]
    # The horizon a little lower than in play: more sky, and the moon in it.
    top = int(height * 0.17)
    area = Rect(0, top, width, height - top)
    round_ = ZombieRound(RoundOptions(area=area, seed=7))
    view = round_.view
    panel[:] = _environment((area.x, area.y, area.width, area.height), width, height, 7,
                            round_.skyline)

    def cast(gait: str, distance: float, across: float, seed: int, hunch: float,
             tilt: float, phase: float) -> Walker:
        lane = (across * width - area.centre_x) * distance / view.focal
        return Walker(lane=lane, distance=distance, speed=0.7, phase=phase, sway=0.0,
                      build=1.0, hunch=hunch, tilt=tilt, gait=gait, seed=seed)

    # One already down, a few seconds ago: still wet, the moon still on it.
    fallen = cast("shamble", 3.6, 0.3, 12, 0.2, 10.0, 0.0)
    round_.walkers = [fallen]
    round_._kill(fallen, 0.0, headshot=True)
    draw_stains(panel, round_, 3.0)
    crowd = sorted((cast(*member) for member in POSTER), key=lambda w: -w.distance)
    for walker in crowd:
        if walker.distance > 9.0:
            draw_walker(panel, walker, view, 0.0)
    draw_fog(panel, view, 3.0)
    for walker in crowd:
        if walker.distance <= 9.0:
            draw_walker(panel, walker, view, 0.0)
    hero = cast(*POSTER_HERO)
    draw_walker(panel, hero, view, 0.0)
    draw_rain(panel, Rect(0, 0, width, height), 1.0, drops=max(30, width // 9), view=view)

    # Your sights on its skull: a thin ring and four ticks in the tint that
    # means your gun is ready.
    figure = hero.figure(view, 0.0)
    centre = figure.head
    radius = max(6.0, figure.head_radius * 1.45)
    weight = max(1, int(round(height / 300)))
    for colour, thick in (((12, 24, 14), weight + 2), ((88, 209, 48), weight)):
        cv2.circle(panel, (_fix(centre[0]), _fix(centre[1])), _fix(radius), colour, thick,
                   cv2.LINE_AA, FIX_BITS)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv2.line(panel, (_fix(centre[0] + dx * radius * 0.55),
                             _fix(centre[1] + dy * radius * 0.55)),
                     (_fix(centre[0] + dx * radius * 1.3), _fix(centre[1] + dy * radius * 1.3)),
                     colour, thick, cv2.LINE_AA, FIX_BITS)
