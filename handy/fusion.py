"""Combining what several cameras say about the same hand.

Each camera maps the hand onto the screen through its own fitted map, and each
map magnifies the landmark noise by its own gain: a camera looking at the sweep
square-on barely stretches it, one looking along it has to stretch a direction
it can hardly see. So the cameras' answers are combined by inverse variance -
the steadier map carries the more weight - and a camera whose map stretches
beyond sense is not listened to at all.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

Point = tuple[float, float]

#: A camera whose map magnifies movement more than this, measured across the
#: targets shot at setup, is not worth listening to. Real placements come out
#: between 2 and 10; a camera looking straight down the axis the player sweeps
#: measures in the hundreds, because its map has to stretch a direction it can
#: barely see. Judged once at setup - a single frame's local gain is too noisy
#: a signal to disqualify a camera on.
GAIN_LIMIT = 20.0


@dataclass(frozen=True)
class Opinion:
    """What one camera makes of the hand this frame."""

    position: Point  # already mapped to the screen, 0..1
    travel: float  # trigger travel, 0 cocked to 1 fired
    gain: float  # worst-case magnification of this camera's map, here
    span: float = 0.1  # palm width in the camera's own frame
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


@dataclass(frozen=True)
class Fused:
    """One answer, from however many cameras had one."""

    position: Point
    travel: float
    spread: float  # how far apart the cameras were, as a fraction of the screen
    cameras: int  # how many were actually listened to


def spread_of(positions: list[Point]) -> float:
    """The widest disagreement between any two cameras.

    Worth watching: it is the part of the error a single camera cannot see.
    """
    return max((math.dist(a, b) for index, a in enumerate(positions)
                for b in positions[index + 1:]), default=0.0)


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
    weights = [o.position_weight for o in listened]
    if sum(weights) <= 0.0:
        weights = [1.0] * len(listened)

    return Fused(
        position=(_weighted(listened, [o.position[0] for o in listened], weights),
                  _weighted(listened, [o.position[1] for o in listened], weights)),
        travel=travel, spread=spread_of([o.position for o in listened]),
        cameras=len(listened))


def _weighted(opinions: list[Opinion], values: list[float],
              weights: list[float]) -> float:
    total = sum(weights)
    if total <= 0.0:
        return sum(values) / len(values)
    return sum(value * weight for value, weight in zip(values, weights)) / total
