"""Combining what several cameras say about the same hand.

One camera cannot tell distance from displacement. Calibration fits the map on
the surface the hand swept while tracing the grid; when the hand later drifts
nearer or further than that surface, the camera's estimate slides, and there is
nothing in its own picture that says so.

A second camera looking from somewhere else slides a different way. That is the
whole value of it: the disagreement between two cameras is not noise, it is a
direct measurement of how far off the surface the hand is. Solve for it, undo it
in both, and you get an answer better than either camera alone - and better than
averaging them, which only splits the difference between two wrong numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Point = tuple[float, float]

#: A camera whose map magnifies movement more than this, measured across the
#: whole calibration grid, is not worth listening to. Real placements come out
#: between 2 and 10; a camera looking straight down the axis the player sweeps
#: measures in the hundreds, because its map has to stretch a direction it can
#: barely see. Judged once at setup - a single frame's local gain is too noisy
#: a signal to disqualify a camera on.
GAIN_LIMIT = 20.0

#: How far off the calibration surface the hand is expected to wander, in units
#: of the reach measured during setup. Used to damp an uncertain depth solve.
DEPTH_PRIOR = 1.0

MIN_BASELINE = 1e-6


@dataclass(frozen=True)
class Opinion:
    """What one camera makes of the hand this frame."""

    position: Point  # already mapped to the screen, 0..1
    travel: float  # trigger travel, 0 cocked to 1 fired
    gain: float  # worst-case magnification of this camera's map, here
    slide: Point = (0.0, 0.0)  # screen movement per unit of depth drift
    span: float = 0.1  # palm width in the camera's own frame
    jitter: float = 0.004  # this camera's own landmark noise, measured at setup
    usable: bool = True  # decided once at setup, not frame by frame

    @property
    def position_weight(self) -> float:
        """Inverse variance: landmark noise arrives multiplied by the map's gain."""
        if not (self.usable and math.isfinite(self.gain) and self.gain > 0):
            return 0.0
        return 1.0 / (self.gain * self.gain)

    @property
    def travel_weight(self) -> float:
        """A hand filling more of the frame gives a better-measured angle."""
        return max(self.span, 0.0) ** 2

    @property
    def noise(self) -> float:
        """Expected error of this camera's screen estimate."""
        if not (self.usable and math.isfinite(self.gain)):
            return float("inf")
        return self.gain * self.jitter


@dataclass(frozen=True)
class Fused:
    """One answer, from however many cameras had one."""

    position: Point
    travel: float
    spread: float  # how far apart the cameras were, as a fraction of the screen
    cameras: int  # how many were actually listened to
    depth: float = 0.0  # solved drift off the calibration surface, in reach units

    @property
    def agrees(self) -> bool:
        return self.cameras < 2 or self.spread < 0.08


def spread_of(positions: list[Point]) -> float:
    """The widest disagreement between any two cameras.

    Worth watching: it is the part of the error a single camera cannot see.
    """
    return max((math.dist(a, b) for index, a in enumerate(positions)
                for b in positions[index + 1:]), default=0.0)


def solve_depth(first: Opinion, second: Opinion) -> float:
    """How far off the calibration surface the hand is, from two disagreeing views.

    Each camera reports the truth plus its own slide times the drift. The drift
    is unknown but shared, so subtracting the two estimates leaves it exposed.
    The answer is then damped by how much of the disagreement could just be
    noise, which quietly switches the correction off when it cannot be trusted.
    """
    baseline = (first.slide[0] - second.slide[0], first.slide[1] - second.slide[1])
    denominator = baseline[0] ** 2 + baseline[1] ** 2
    if denominator < MIN_BASELINE:
        return 0.0  # the two cameras slide the same way and cancel nothing

    difference = (first.position[0] - second.position[0],
                  first.position[1] - second.position[1])
    raw = (difference[0] * baseline[0] + difference[1] * baseline[1]) / denominator

    variance = (first.noise ** 2 + second.noise ** 2) / denominator
    trust = DEPTH_PRIOR / (DEPTH_PRIOR + variance)
    return max(-3.0, min(3.0, raw * trust))


def _pair_for_depth(opinions: list[Opinion]) -> tuple[Opinion, Opinion] | None:
    """The two cameras whose slides differ most: the best-conditioned baseline."""
    best, widest = None, MIN_BASELINE
    for index, first in enumerate(opinions):
        for second in opinions[index + 1:]:
            gap = math.dist(first.slide, second.slide)
            if gap > widest:
                best, widest = (first, second), gap
    return best


def fuse(opinions: list[Opinion]) -> Fused | None:
    """The hand's screen position, from every camera worth listening to."""
    listened = [o for o in opinions if o.usable]
    if not listened:
        # Every map is degenerate; fall back to the raw average of whatever came in.
        if not opinions:
            return None
        listened = opinions

    travel = _weighted(listened, [o.travel for o in listened],
                       [o.travel_weight for o in listened])
    raw_spread = spread_of([o.position for o in listened])

    depth = 0.0
    pair = _pair_for_depth(listened) if len(listened) > 1 else None
    if pair is not None:
        depth = solve_depth(*pair)

    positions = [(o.position[0] - depth * o.slide[0],
                  o.position[1] - depth * o.slide[1]) for o in listened]
    weights = [o.position_weight for o in listened]
    if sum(weights) <= 0.0:
        weights = [1.0] * len(listened)

    return Fused(
        position=(_weighted(listened, [p[0] for p in positions], weights),
                  _weighted(listened, [p[1] for p in positions], weights)),
        travel=travel, spread=raw_spread, cameras=len(listened), depth=depth)


def _weighted(opinions: list[Opinion], values: list[float],
              weights: list[float]) -> float:
    total = sum(weights)
    if total <= 0.0:
        return sum(values) / len(values)
    return sum(value * weight for value, weight in zip(values, weights)) / total
