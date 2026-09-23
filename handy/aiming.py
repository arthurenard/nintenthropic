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
    signal: str
    tuning: tuple[float, float]

    def project(self, point: Point) -> Point: ...

    def local_gain(self, point: Point) -> float: ...

    def travel(self, measured: float) -> float: ...


class Scheme(Protocol):
    """How the player aims and fires. Duck-typed to keep the modules apart."""

    def pointer(self, subject: object, tuning: tuple[float, float]) -> Point: ...

    def measure(self, signal: str, subject: object) -> float: ...

    def scale(self, subject: object) -> float: ...


@dataclass(frozen=True)
class Aim:
    """The aiming state for one frame."""

    position: Point | None = None  # normalised to the play area, None without a hand
    armed: bool = False  # thumb up: ready to fire
    fired: bool = False  # the thumb dropped on this very frame
    travel: float = 0.0  # 0 at the cocked pose, 1 at the fired one
    baseline: float = 0.0  # where the trigger has been resting lately
    spread: float = 0.0  # how far apart the cameras were, 0..1 of the screen
    cameras: int = 0  # how many cameras were listened to this frame
    depth: float = 0.0  # solved drift off the calibration surface

    @property
    def pull(self) -> float:
        """Travel measured from rest: what the thresholds actually compare."""
        return self.travel - self.baseline

    @property
    def tracking(self) -> bool:
        return self.position is not None


class AimController:
    """Smooths the aim and turns thumb rotation into discrete shots.

    The trigger is measured in STROKES, not levels: it fires when the signal has
    RISEN by ``fire_above`` from its recent trough, and re-arms when it has
    FALLEN by ``arm_below`` from its peak since the shot. Absolute levels are
    the wrong thing to compare against, three times over: rest is not zero (an
    asymmetric face reads a standing wink; a relaxed thumb is not vertical), a
    play stroke is quicker and shallower than the deliberate pose calibration
    measured, and the return between shots is rarely complete - a thumb that
    comes half way back up has plainly ended its pull, and demanding it return
    to some absolute line silently eats the next shot.

    One absolute line does hold, though, and it is what keeps the ARMED light
    honest. Travel 1.0 is the pose setup measured as *fired*, so reaching it has
    to fire: the trough may never RISE above :attr:`trough_ceiling`, whether by
    drift or by re-arming part way down from a peak. Without that ceiling the
    hysteresis eats itself - re-arming asks for only ``arm_below`` of return
    while firing asks for ``fire_above`` of rise, so a thumb that comes half way
    back re-arms the gun into a state it can never fire from, and says ARMED
    about it for the rest of the round.

    The ceiling is a ceiling on rises only. A trigger first seen already folded
    keeps that reading as its rest, however high, because on the first frame
    there is no way to tell a resting pose from the middle of a stroke - and
    hauling it down would fire a shot the player never took the moment tracking
    came back. Only a persistent dip brings such a trough down again.
    """

    #: The trough the firing stroke is measured from may only creep upward, so
    #: a slow postural drift is absorbed rather than accumulated into a phantom
    #: stroke - while a real pull, far above the trough, drags it barely at all.
    TROUGH_CREEP = 0.01

    #: How much stroke the ceiling keeps in hand, as a multiple of ``fire_above``.
    #: A trough at exactly ``1 - fire_above`` leaves the calibrated fired pose
    #: landing precisely ON the threshold, and "precisely on" is not a trigger -
    #: setup measures a deliberate, held pose and play strokes fall short of it,
    #: which is why ``fire_above`` is a half and not a whole in the first place.
    TROUGH_HEADROOM = 1.2

    #: And it accepts a LOWER level only once that level has persisted this many
    #: frames. A blink, read through the wink gate, is a two-or-three-frame dip
    #: to zero and back; chase it down and the return trip reads as a firing
    #: stroke. A genuinely lower rest persists; a blink never does.
    DIP_FRAMES = 5

    #: How long the subject may vanish before the trigger forgets its state.
    #: Trackers drop a frame now and then - and a face is likeliest to be lost
    #: in the very moment an eye closes. Resetting on a single missing frame
    #: disarms the gun and re-seeds the resting level at the wink itself, which
    #: turns the shot into nothing. A brief gap is bridged instead.
    GRACE = 0.3

    def __init__(self, scheme: Scheme, *, fire_above: float = 0.50,
                 arm_below: float = 0.30, min_cutoff: float = 1.2,
                 beta: float = 0.8, median: bool = True,
                 native_thumb: bool = False) -> None:
        if arm_below >= fire_above:
            raise ValueError("arm_below must be under fire_above to give hysteresis")
        self.scheme = scheme
        self.native_thumb = native_thumb
        self._thumb_ready = False
        self.fire_above = fire_above
        self.arm_below = arm_below
        self._filter = PointFilter(min_cutoff=min_cutoff, beta=beta)
        # The median-of-three guards a slow trigger (a thumb) against one misread
        # frame. A fast one (an eye) can be over and done inside a single
        # detection, and the same guard would swallow the shot.
        self._travel = MedianOf3() if median else None
        self._armed = True
        self._trough: float | None = None
        self._below = 0
        self._peak: float = 0.0
        self._last_seen: float | None = None

    def reset_position(self) -> None:
        """A new aim fit must not interpolate from the previous mapping."""
        self._filter.reset()

    @property
    def trough_ceiling(self) -> float:
        """The highest the trough may be RAISED to and still leave a stroke.

        Travel 1.0 is the deliberate pose setup recorded as *fired*; reaching it
        has to fire, with room to spare, whatever the trigger has been resting
        at since.
        """
        return 1.0 - self.fire_above * self.TROUGH_HEADROOM

    def _raise_trough(self, towards: float, by: float = float("inf")) -> None:
        """Move the trough towards ``towards``, by at most ``by``.

        Only the upward direction is rationed. A rise stops at
        :attr:`trough_ceiling`, so a resting level that drifts up can never
        climb past the point where the calibrated fired pose still fires; a
        trough already above the ceiling therefore does not rise at all.

        A fall is not capped, and both callers want that: re-arming seats the
        trough at the level the trigger actually came back to, which is the
        whole point of measuring strokes rather than levels, and a trough left
        stranded above that level would ask for a longer pull than the player
        just demonstrated.
        """
        assert self._trough is not None
        room = max(0.0, self.trough_ceiling - self._trough)
        self._trough += min(towards - self._trough, by, room)

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
                if self._travel is not None:
                    self._travel.reset()
                self._armed = False
                self._thumb_ready = False
                self._trough = None
                self._below = 0
            # Each trigger reports its own readiness. `_armed` belongs to the
            # stroke trigger, which the native thumb never updates: it reads
            # True until the first long loss and False for ever after - so a
            # folded thumb showed ARMED through every hiccup, and later every
            # hiccup dropped the light and brought it back with a re-cock
            # click, the thumb never having moved.
            armed = self._thumb_ready if self.native_thumb else self._armed
            return Aim(armed=armed, baseline=self._trough or 0.0)

        self._last_seen = timestamp
        position = self._filter(_clamp(fused.position), timestamp)

        travel = (self._travel(fused.travel) if self._travel is not None
                  else fused.travel)

        if self.native_thumb:
            fired = self._thumb_ready and travel > self.fire_above
            if fired:
                self._thumb_ready = False
            elif travel < self.arm_below:
                self._thumb_ready = True
            return Aim(position=position, armed=self._thumb_ready, fired=fired,
                       travel=travel, spread=fused.spread, cameras=fused.cameras,
                       depth=fused.depth)

        fired = False
        if self._trough is None:
            # First sight: whatever the signal reads now is a resting trough,
            # never the middle of a stroke - so nothing fires on acquisition.
            # Uncapped, deliberately: capping it here would read a hand
            # re-acquired mid-fold as a pull and fire on the spot.
            self._trough = travel
            self._below = 0
            self._armed = True
        elif self._armed:
            if travel < self._trough:
                # Only a persistent lower level becomes the new trough.
                self._below += 1
                if self._below >= self.DIP_FRAMES:
                    self._trough = travel
            else:
                self._below = 0
                # A slow rise is posture, not a pull; creep, don't chase.
                self._raise_trough(travel, self.TROUGH_CREEP * self.fire_above)
            if travel - self._trough > self.fire_above:
                fired = True
                self._armed = False
                self._peak = travel
        else:
            self._peak = max(self._peak, travel)
            if self._peak - travel > self.arm_below:
                self._armed = True
                # Re-arm at the level the trigger came back to, but no higher
                # than the ceiling: hysteresis asks for only `arm_below` of
                # return while firing asks for `fire_above` of rise, so seating
                # the trough at the return level alone would leave a band that
                # re-arms the gun and can never fire it again.
                self._raise_trough(travel)
                self._below = 0

        return Aim(position=position, armed=self._armed, fired=fired, travel=travel,
                   baseline=self._trough, spread=fused.spread, cameras=fused.cameras,
                   depth=fused.depth)

    def _opinion(self, frame: object, profile: CameraProfile) -> Opinion:
        subject = frame.subjects[0]
        pointed = self.scheme.pointer(subject, profile.tuning)
        measured = self.scheme.measure(profile.signal, subject)
        return Opinion(position=profile.project(pointed),
                       travel=(thumb_pull(subject) if self.native_thumb
                               else profile.travel(measured)),
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
