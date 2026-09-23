"""Turns hand landmarks into an aim point and trigger pulls.

The player holds their hand like a pistol and points it at the screen. Seen from
the webcam the index finger is then heavily foreshortened, so aiming is driven by
*where the hand is*, not by the direction the finger appears to point. The shot
is the thumb: pointing up along the hand the pistol is cocked, rotated away from
up it fires.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from .filtering import MedianOf3, PointFilter
from .fusion import Opinion, fuse
from .recognition import Hand

# Landmark indices in MediaPipe's hand topology.
WRIST = 0
THUMB_MCP = 2
THUMB_TIP = 4
INDEX_MCP = 5
INDEX_TIP = 8
MIDDLE_MCP = 9

Point = tuple[float, float]


def _vector(origin: Point, tip: Point) -> Point:
    return (tip[0] - origin[0], tip[1] - origin[1])


def distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def angle_between(a: Point, b: Point) -> float:
    """Unsigned angle between two vectors, in degrees (0..180).

    Computed from the cross and dot products rather than from ``acos`` alone,
    which loses all precision exactly where the two poses have to be told apart -
    when the vectors are nearly parallel.
    """
    cross = a[0] * b[1] - a[1] * b[0]
    dot = a[0] * b[0] + a[1] * b[1]
    if cross == 0.0 and dot == 0.0:
        return 0.0  # a degenerate, zero-length vector
    return math.degrees(abs(math.atan2(cross, dot)))


def palm_span(hand: Hand) -> float:
    """Wrist-to-middle-knuckle length, the scale distances are measured in."""
    return distance(hand.landmarks[WRIST], hand.landmarks[MIDDLE_MCP])


def hand_up(hand: Hand) -> Point:
    """The hand's own "up": wrist towards the middle knuckle.

    Using the hand's axis instead of the screen's means the trigger keeps working
    when the player tilts or rolls their wrist while tracking a target.
    """
    return _vector(hand.landmarks[WRIST], hand.landmarks[MIDDLE_MCP])


def thumb_angle(hand: Hand) -> float:
    """Degrees the thumb has rotated away from pointing up along the hand.

    Small while the thumb stands up beside the fist, large once it drops onto it.
    """
    return angle_between(hand_up(hand),
                         _vector(hand.landmarks[THUMB_MCP], hand.landmarks[THUMB_TIP]))


def thumb_extension(hand: Hand) -> float:
    """Thumb reach from the index knuckle, in palm spans.

    Scale-invariant, so it behaves the same whether the hand is near the camera
    or far from it. The fallback signal for thumbs that fold without rotating.
    """
    span = palm_span(hand)
    if span <= 0.0:
        return 0.0
    return distance(hand.landmarks[THUMB_TIP], hand.landmarks[INDEX_MCP]) / span


def thumb_pull(subject) -> float:
    """Built-in thumb fold, independent of aim calibration and hand size.

    Either a rotation away from the palm's up axis or a fold toward the
    index knuckle counts. Both must release before the next shot can arm.
    """
    hand = getattr(subject, "hand", subject)
    angle = (thumb_angle(hand) - 25.0) / 40.0
    reach = (0.85 - thumb_extension(hand)) / 0.45
    return min(1.0, max(0.0, angle, reach))


class Recoil:
    """The kick that follows a shot.

    The crosshair jumps up and settles back over a couple of hundred
    milliseconds, so firing as fast as the thumb allows genuinely costs accuracy
    instead of being free. Shots stack, up to a cap.
    """

    def __init__(self, kick: float = 26.0, rise: float = 0.04,
                 decay: float = 0.22) -> None:
        self.kick = max(0.0, kick)
        self.rise = max(rise, 1e-3)
        self.decay = max(decay, 1e-3)
        self._shots: list[float] = []

    @property
    def _memory(self) -> float:
        return self.rise + 6.0 * self.decay

    def fire(self, now: float) -> None:
        if not self.kick:
            return  # nothing to remember: with no kick the list would only grow
        self._shots.append(now)

    def offset(self, now: float) -> tuple[float, float]:
        """Pixels to add to the aim point: up is negative, as on screen."""
        self._shots = [t for t in self._shots if now - t < self._memory]
        if not self.kick:
            return (0.0, 0.0)
        total = 0.0
        for shot in self._shots:
            age = now - shot
            if age < 0.0:
                continue
            if age < self.rise:
                total += self.kick * age / self.rise
            else:
                total += self.kick * math.exp(-(age - self.rise) / self.decay)
        return (0.0, -min(total, 2.5 * self.kick))

    def reset(self) -> None:
        self._shots.clear()


def _clamp(point: Point) -> Point:
    return (min(max(point[0], 0.0), 1.0), min(max(point[1], 0.0), 1.0))


class CameraProfile(Protocol):
    """What :class:`AimController` needs to know about one camera."""

    slide: Point
    jitter: float
    usable: bool

    def project(self, point: Point) -> Point: ...

    def local_gain(self, point: Point) -> float: ...


class Scheme(Protocol):
    """How the player aims. Duck-typed to keep the modules apart."""

    def pointer(self, subject: object) -> Point: ...

    def scale(self, subject: object) -> float: ...


@dataclass(frozen=True)
class Aim:
    """The aiming state for one frame."""

    position: Point | None = None  # normalised to the play area, None without a hand
    armed: bool = False  # thumb up: ready to fire
    fired: bool = False  # the thumb dropped on this very frame
    travel: float = 0.0  # the thumb's fold, 0 up to 1 folded (see thumb_pull)
    spread: float = 0.0  # how far apart the cameras were, 0..1 of the screen
    cameras: int = 0  # how many cameras were listened to this frame
    depth: float = 0.0  # solved drift off the calibration surface

    @property
    def tracking(self) -> bool:
        return self.position is not None


class AimController:
    """Smooths the aim and turns the thumb's fold into discrete shots.

    The trigger is the built-in thumb gesture, :func:`thumb_pull`: the same for
    every player and every hand size, so it needs no calibration. It fires once
    the fold passes ``fire_above`` and will not fire again until the thumb has
    come back up under ``arm_below``. The gap between the two lines is what
    keeps a thumb wobbling on either of them from firing twice.
    """

    #: How long the subject may vanish before the trigger forgets its state.
    #: Trackers drop a frame now and then, and a hand is likeliest to be lost
    #: mid-fold, when the thumb blurs. Resetting on a single missing frame
    #: disarms the gun, which turns the shot into nothing. A brief gap is
    #: bridged instead.
    GRACE = 0.3

    def __init__(self, scheme: Scheme, *, fire_above: float = 0.50,
                 arm_below: float = 0.30, min_cutoff: float = 1.2,
                 beta: float = 0.8) -> None:
        if arm_below >= fire_above:
            raise ValueError("arm_below must be under fire_above to give hysteresis")
        self.scheme = scheme
        self.fire_above = fire_above
        self.arm_below = arm_below
        self._filter = PointFilter(min_cutoff=min_cutoff, beta=beta)
        # The median-of-three guards the thumb against one misread frame.
        self._travel = MedianOf3()
        # Not armed until the thumb has been seen up: a hand first seen already
        # folded must not fire the moment it is acquired.
        self._armed = False
        self._last_seen: float | None = None

    def reset_position(self) -> None:
        """A new aim fit must not interpolate from the previous mapping."""
        self._filter.reset()

    def update(self, views: Sequence[tuple[object, CameraProfile]],
               timestamp: float) -> Aim:
        """One frame from each camera, paired with that camera's calibration."""
        opinions = [self._opinion(frame, profile) for frame, profile in views
                    if frame.subjects]
        fused = fuse(opinions)
        if fused is None:
            gone_for = (float("inf") if self._last_seen is None
                        else timestamp - self._last_seen)
            if gone_for > self.GRACE:
                # Properly lost. Forget everything, so a shot never fires on
                # re-acquisition from a stale stroke.
                self._filter.reset()
                self._travel.reset()
                self._armed = False
            return Aim(armed=self._armed)

        self._last_seen = timestamp
        position = self._filter(_clamp(fused.position), timestamp)
        travel = self._travel(fused.travel)

        fired = self._armed and travel > self.fire_above
        if fired:
            self._armed = False
        elif travel < self.arm_below:
            self._armed = True
        return Aim(position=position, armed=self._armed, fired=fired,
                   travel=travel, spread=fused.spread, cameras=fused.cameras,
                   depth=fused.depth)

    def _opinion(self, frame: object, profile: CameraProfile) -> Opinion:
        subject = frame.subjects[0]
        pointed = self.scheme.pointer(subject)
        return Opinion(position=profile.project(pointed), travel=thumb_pull(subject),
                       gain=profile.local_gain(pointed), slide=profile.slide,
                       span=self.scheme.scale(subject), jitter=profile.jitter,
                       usable=profile.usable)


class ScopeToggle:
    """Turns a 0..1 "how closed is one eye" reading into scoped / not scoped.

    Hysteresis, so a half-closed eye at the threshold does not flicker the scope
    in and out; and a short grace, so the face dropping out for a frame does not
    snap the player out of the scope mid-shot.
    """

    def __init__(self, enter_above: float = 0.14, leave_below: float = 0.07,
                 grace: float = 0.3) -> None:
        if leave_below >= enter_above:
            raise ValueError("leave_below must be under enter_above")
        self.enter_above = enter_above
        self.leave_below = leave_below
        self.grace = grace
        self.scoped = False
        self._last_seen: float | None = None

    def update(self, reading: float | None, timestamp: float) -> bool:
        if reading is None:
            if self._last_seen is not None and timestamp - self._last_seen > self.grace:
                self.scoped = False
            return self.scoped
        self._last_seen = timestamp
        if self.scoped and reading < self.leave_below:
            self.scoped = False
        elif not self.scoped and reading > self.enter_above:
            self.scoped = True
        return self.scoped


class EyeScope(ScopeToggle):
    """A held closed lid engages the scope; a normal brief blink does not."""

    def __init__(self):
        super().__init__(enter_above=0.55, leave_below=0.30, grace=0.2)
        self.closed_since = None

    def update(self, reading, timestamp):
        if reading is None:
            self.closed_since = None
            return super().update(None, timestamp)
        self._last_seen = timestamp
        if reading < self.leave_below:
            self.scoped = False
            self.closed_since = None
        elif reading > self.enter_above:
            if self.closed_since is None:
                self.closed_since = timestamp
            if timestamp - self.closed_since >= 0.18:
                self.scoped = True
        elif not self.scoped:
            self.closed_since = None
        return self.scoped
