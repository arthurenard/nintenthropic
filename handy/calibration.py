"""Fitting the range to the player's own hand, and to where their camera sits.

Three things differ from person to person and from desk to desk: how far the hand
comfortably travels in front of the camera, how far the thumb rotates between
cocked and fired, and - the awkward one - how the camera is placed relative to
the screen being aimed at. Calibration measures all three at once.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from collections.abc import Sequence
from typing import Any

from . import fusion, homography
from .homography import Matrix, Point
from .storage import write_atomically

#: Two poses can only be told apart if they separate by more than this many
#: noise widths; below it the measurement is not trustworthy.
MIN_SEPARATION = 2.5

#: A fit that lands this far from its own calibration points, as a fraction of
#: the screen, is not describing anything real.
MAX_FIT_ERROR = 0.12

#: The honest gate: how far the fit misses a marker it never trained on. The
#: training residual cannot carry this job - a homography has eight degrees of
#: freedom, and on nine noisy points it will fit the noise and pass. Beyond this
#: much held-out error the map is not describing the player, and playing on it
#: feels like the crosshair ignoring you - worse than falling back and saying so.
MAX_GENERALISATION = 0.08

#: Aim markers stop short of the very edge so they stay comfortably visible; the
#: fitted map extrapolates the rest.
GRID_MARGIN = 0.08

#: Pointer settings whose fits land this close together are treated as equally
#: good, and decided on other grounds.
FIT_TIE = 0.004

DEFAULT_MAPPING = homography.box_mapping((0.15, 0.15), (0.85, 0.85))

#: The calibration file's format, written into it so a later change can tell
#: what it is reading. Every file from before the field existed is version 1.
BOOK_VERSION = 2


@dataclass(frozen=True)
class Calibration:
    """One camera's hand-to-screen map, and what it knows about its own errors."""

    mapping: Matrix = DEFAULT_MAPPING
    signal: str = "angle"  # which of the scheme's trigger signals to read
    cocked: float = 20.0
    folded: float = 70.0
    tuning: tuple[float, float] = (0.0, 0.0)  # pointer weights, chosen at setup
    fit_error: float = 0.0  # mean miss of the fit, as a fraction of the screen
    generalisation: float = 0.0  # mean held-out miss: the honest accuracy figure
    #: Did the aim map come from this player's own trace, or is it the fallback?
    #: The error figures cannot answer that: when the fallback is a previously
    #: successful calibration they are inherited from it, non-zero and flattering.
    aim_fitted: bool = False
    trigger_fitted: bool = False  # were the two trigger poses actually measured?
    jitter: float = 0.004  # this camera's own landmark shake, measured at setup
    gain: float = 1.0  # how much this camera's map magnifies movement
    slide: Point = (0.0, 0.0)  # where its estimate goes when the hand changes depth

    def __post_init__(self) -> None:
        if len(self.mapping) != 9:
            raise ValueError("a mapping is nine numbers, row-major")
        if len(self.tuning) != 2 or len(self.slide) != 2:
            raise ValueError("a tuning and a slide are two numbers each")
        # Python's json reads and writes NaN and Infinity without a murmur, and
        # one NaN in a map is a NaN crosshair: the filter carries it for the
        # rest of the session and the game loop's round() raises on it. So
        # nothing non-finite gets in, whether from disk, a browser or a fit.
        numbers = (*self.mapping, self.cocked, self.folded, *self.tuning,
                   *self.slide, self.fit_error, self.generalisation, self.jitter)
        if not all(_finite(value) for value in numbers):
            raise ValueError("a calibration holds finite numbers only")
        # Bar one: an infinite gain is how a camera is told to sit the game out.
        if not (_finite(self.gain) or self.gain == float("inf")) or self.gain < 0:
            raise ValueError("a gain is a magnification: zero or more")
        if self.cocked == self.folded:
            raise ValueError("the cocked and folded poses must differ")

    @property
    def usable(self) -> bool:
        """False for a camera placed where its map has to stretch beyond sense."""
        return self.gain <= fusion.GAIN_LIMIT

    def project(self, point: Point) -> Point | None:
        """Map a camera-space point onto the screen, without clamping.

        Fusion needs the raw answer: clamping first would hide exactly the
        disagreement between cameras that the depth solve reads. None where
        the map has no answer at all - past its horizon, see ``apply``.
        """
        return homography.apply(self.mapping, point)

    def to_play_area(self, point: Point) -> Point | None:
        """Map a camera-space point onto the screen, 0..1, clamped at the edges."""
        projected = self.project(point)
        return None if projected is None else clamp(projected)

    def local_gain(self, point: Point) -> float:
        """How much this camera's map magnifies movement right here."""
        return homography.gain(self.mapping, point)

    def travel(self, measured: float) -> float:
        """How far the trigger has moved: 0 at the cocked pose, 1 at the fired one.

        Working in travel rather than raw degrees or blink scores means the same
        thresholds fit every player and every scheme, and a signal may run in
        either direction.
        """
        return (measured - self.cocked) / (self.folded - self.cocked)

    def to_dict(self) -> dict:
        return {
            "mapping": list(self.mapping),
            "signal": self.signal,
            "cocked": self.cocked,
            "folded": self.folded,
            "tuning": list(self.tuning),
            "fit_error": self.fit_error,
            "generalisation": self.generalisation,
            "aim_fitted": self.aim_fitted,
            "trigger_fitted": self.trigger_fitted,
            "jitter": self.jitter,
            # An idle camera's infinite gain is written as null: JSON proper
            # has no Infinity, and the file is saved strictly.
            "gain": self.gain if math.isfinite(self.gain) else None,
            "slide": list(self.slide),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Calibration":
        if "mapping" in data:
            mapping = tuple(float(value) for value in data["mapping"])
        else:
            # A file from before the map was projective: read its box instead.
            mapping = homography.box_mapping(tuple(data["aim_min"]),
                                             tuple(data["aim_max"]))
        # The trigger poses are optional. The built-in thumb trigger ignores
        # them, and a browser that stored only what it uses was refused on
        # every start for want of fields nothing would have read.
        defaults = cls()
        gain = data.get("gain", defaults.gain)
        return cls(
            mapping=mapping,
            signal=str(data.get("signal", defaults.signal)),
            cocked=float(data.get("cocked", defaults.cocked)),
            folded=float(data.get("folded", defaults.folded)),
            tuning=_tuning_from(data.get("tuning", (0.0, 0.0))),
            fit_error=float(data.get("fit_error", 0.0)),
            generalisation=float(data.get("generalisation", 0.0)),
            # A file written before the flag existed: a non-zero error figure is
            # the only trace a real fit left in it, so read it that way.
            aim_fitted=bool(data.get("aim_fitted",
                                     bool(data.get("fit_error"))
                                     or bool(data.get("generalisation")))),
            trigger_fitted=bool(data.get("trigger_fitted", False)),
            jitter=float(data.get("jitter", 0.004)),
            gain=float("inf") if gain is None else float(gain),
            slide=_pair_from(data.get("slide", (0.0, 0.0))),
        )


def clamp(point: Point) -> Point:
    return tuple(min(max(value, 0.0), 1.0) for value in point)


def _finite(value) -> bool:
    """A real, finite number; anything else - a string, None - is not."""
    try:
        return math.isfinite(value)
    except TypeError:
        return False


def _tuning_from(value) -> tuple[float, float]:
    """Read a tuning that may be a pair, or a scalar from an older save."""
    if isinstance(value, (int, float)):
        return (float(value), float(value))
    return (float(value[0]), float(value[1]))


def _pair_from(value) -> tuple[float, float]:
    """Exactly two numbers. A string of two characters is not a pair."""
    first, second = value
    return (float(first), float(second))


def default_calibration(scheme) -> Calibration:
    """A believable starting point for one camera under ``scheme``.

    Everything here is in the scheme's own units - the trigger thresholds in the
    primary signal's range, the map spanning the box its pointer actually sweeps.
    This is what the game runs on when setup was skipped, so it has to be
    playable, not merely well-formed.
    """
    primary = scheme.signals[0]
    cx, cy = scheme.pointer_centre
    span = scheme.pointer_span
    return Calibration(
        mapping=homography.box_mapping((cx - span, cy - span), (cx + span, cy + span)),
        signal=primary.name, cocked=primary.rest, folded=primary.fired,
        tuning=scheme.default_tuning)


def default_rig(scheme, cameras: int) -> "Rig":
    """One scheme-appropriate default per camera."""
    return Rig(tuple(default_calibration(scheme) for _ in range(cameras)))


@dataclass(frozen=True)
class Rig:
    """The calibration of every camera in the setup, in camera order."""

    cameras: tuple[Calibration, ...] = (Calibration(),)

    def __post_init__(self) -> None:
        if not self.cameras:
            raise ValueError("a rig needs at least one camera")

    def __len__(self) -> int:
        return len(self.cameras)

    def __getitem__(self, index: int) -> Calibration:
        return self.cameras[index]

    def resized(self, count: int, fill: Calibration | None = None) -> "Rig":
        """Fit the rig to ``count`` cameras, padding with ``fill`` if it grows."""
        cameras = list(self.cameras[:count])
        cameras += [fill or Calibration() for _ in range(count - len(cameras))]
        return Rig(tuple(cameras))

    @property
    def usable(self) -> tuple[bool, ...]:
        return tuple(camera.usable for camera in self.cameras)

    def to_dict(self) -> dict:
        return {"cameras": [camera.to_dict() for camera in self.cameras]}

    def save(self, path: Path) -> None:
        write_atomically(path, json.dumps(self.to_dict(), indent=2,
                                          allow_nan=False) + "\n")

    @classmethod
    def from_dict(cls, data: dict) -> "Rig":
        # A file from before the second camera holds one calibration, bare.
        entries = data["cameras"] if "cameras" in data else [data]
        return cls(tuple(Calibration.from_dict(entry) for entry in entries))

    @classmethod
    def load(cls, path: Path) -> "Rig | None":
        """Read a saved rig, or None if it is missing or unusable."""
        try:
            return cls.from_dict(json.loads(path.read_text()))
        except (OSError, ValueError, KeyError, TypeError):
            return None


@dataclass
class RigBook:
    """Every scheme's rig, in one file.

    Aiming with a hand and aiming with your eyes produce entirely different maps,
    so they cannot share a calibration - but they can share a file.
    """

    rigs: dict[str, Rig] = field(default_factory=dict)

    def get(self, scheme: str) -> Rig | None:
        return self.rigs.get(scheme)

    def set(self, scheme: str, rig: Rig) -> None:
        self.rigs[scheme] = rig

    def to_dict(self) -> dict:
        return {"version": BOOK_VERSION,
                "schemes": {key: rig.to_dict() for key, rig in self.rigs.items()}}

    def save(self, path: Path) -> bool:
        """Write the book out. False, with a line printed, if the disk said no.

        ``load`` treats an unreadable file as an empty book; a write that cannot
        happen is no worse. It costs the player the setup they just did - which
        is why it says so - but the alternative was a traceback landing the
        instant setup succeeded, and the round never starting at all.
        """
        try:
            # Strict JSON: nothing non-finite should exist to write, and if it
            # somehow does, losing the save beats poisoning every later load.
            write_atomically(path, json.dumps(self.to_dict(), indent=2,
                                              allow_nan=False) + "\n")
        except (OSError, ValueError) as error:
            print(f"Could not save the calibration to {path}: {error}\n"
                  f"This session is calibrated; the next one will ask again.")
            return False
        return True

    @classmethod
    def load(cls, path: Path) -> "RigBook":
        """Read the book, one scheme's rig at a time.

        A file that cannot be read at all starts an empty book. An entry that
        cannot be read - a rig from an older version, a hand edit gone wrong -
        is skipped on its own. It used to take every other scheme's rig down
        with it, and the next save then made the loss permanent.
        """
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return cls()
        if not isinstance(data, dict):
            return cls()
        # A file from before there was more than one way to aim holds one rig.
        entries = data["schemes"] if "schemes" in data else {"pistol": data}
        if not isinstance(entries, dict):
            return cls()
        rigs = {}
        for key, entry in entries.items():
            try:
                rigs[str(key)] = Rig.from_dict(entry)
            except (ValueError, KeyError, TypeError, AttributeError) as error:
                print(f"Skipping the saved {key} calibration in {path}: "
                      f"it could not be read ({error}).")
        return cls(rigs)


@dataclass(frozen=True)
class Step:
    """One pose the player is asked to hold."""

    key: str
    instruction: str
    detail: str
    target: Point | None = None  # where on screen to point or look, if anywhere
    records: str = "aim"  # "aim", "reach" or "trigger"


def aim_steps(scheme, grid: int = 3) -> tuple[Step, ...]:
    """A ``grid`` by ``grid`` sweep of markers to aim at, in snake order.

    Snake order - left to right, then right to left - keeps the player travelling
    to the next marker rather than jumping back across the screen.
    """
    if grid < 2:
        raise ValueError("the grid needs at least two points per side")
    span = 1.0 - 2 * GRID_MARGIN
    coordinates = [GRID_MARGIN + span * index / (grid - 1) for index in range(grid)]

    steps = []
    for row, y in enumerate(coordinates):
        columns = coordinates if row % 2 == 0 else list(reversed(coordinates))
        for x in columns:
            steps.append(Step(key=f"aim_{len(steps)}",
                              instruction=scheme.aim.instruction,
                              detail=scheme.aim.detail,
                              target=(x, y), records="aim"))
    return tuple(steps)


def reach_steps(scheme) -> tuple[Step, ...]:
    """Two more looks at the same marker, from two different distances.

    The gap between them is how far each camera's estimate slides when the
    subject moves nearer or further - the quantity a second camera exists to
    measure. Schemes whose subject never changes distance, like the eyes, skip it.
    """
    if not scheme.needs_reach:
        return ()
    return (
        Step("reach_near", "Point at the marker, arm DRAWN IN",
             "elbow bent, hand close to your body", target=(0.5, 0.5),
             records="reach"),
        Step("reach_far", "Point at the marker, arm STRETCHED OUT",
             "same marker, arm as long as it goes", target=(0.5, 0.5),
             records="reach"),
    )


def trigger_steps(scheme) -> tuple[Step, ...]:
    return (
        Step("cocked", scheme.cocked.instruction, scheme.cocked.detail,
             records="trigger"),
        Step("fired", scheme.fired.instruction, scheme.fired.detail,
             records="trigger"),
    )


def steps_for(scheme, grid: int = 3) -> tuple[Step, ...]:
    return aim_steps(scheme, grid) + reach_steps(scheme) + trigger_steps(scheme)


@dataclass(frozen=True)
class Progress:
    """What the calibration overlay should show right now."""

    step: Step
    index: int
    total: int
    fraction: float  # 0..1 of the dwell for this step
    tracking: bool
    settling: bool = False  # showing the next instruction, not yet sampling
    all_targets: tuple[Point, ...] = ()  # every aim marker, for the overview dots
    seen: tuple[bool, ...] = ()  # which cameras have the subject right now


class CalibrationSession:
    """Walks the player through the grid, the reach, and the two trigger poses.

    Every camera watches the same walkthrough at the same time, so one pass
    calibrates the whole rig. Each records only the frames in which it actually
    saw the player; a camera that missed too much falls back to the defaults
    rather than dragging a bad fit into the game.

    Each step samples for ``dwell`` seconds and keeps the median, so a shaky pose
    or a single bad frame cannot skew the result. Between steps nothing is
    sampled for ``settle`` seconds: right after a step ends the player is still
    holding the previous pose and reading the new instruction.
    """

    def __init__(self, scheme, cameras: int = 1, grid: int = 3, dwell: float = 1.2,
                 settle: float = 0.7, fallback: Rig | None = None,
                 quick: bool = False) -> None:
        if cameras < 1:
            raise ValueError("a session needs at least one camera")
        self.scheme = scheme
        self.cameras = cameras
        self.steps = steps_for(scheme, grid)
        if quick and cameras == 1:
            self.steps = tuple(s for s in self.steps if s.records != "reach")
        self.dwell = dwell
        self.settle = settle
        # Whatever falls through a failed step must still speak this scheme's
        # units, so the pad is the scheme's own default, never the bare one.
        self.fallback = (fallback or default_rig(scheme, cameras)).resized(
            cameras, fill=default_calibration(scheme))
        self._hold_until = float("-inf")
        self._index = 0
        self._started: float | None = None
        self._samples: list[list] = [[] for _ in range(cameras)]
        self._recorded: dict[str, list[list]] = {}

    @property
    def aim_targets(self) -> tuple[Point, ...]:
        return tuple(step.target for step in self.steps
                     if step.target is not None and step.records == "aim")

    @property
    def is_done(self) -> bool:
        return self._index >= len(self.steps)

    @property
    def step(self) -> Step:
        return self.steps[min(self._index, len(self.steps) - 1)]

    def _progress(self, fraction: float, seen: Sequence[bool],
                  settling: bool = False) -> Progress:
        return Progress(self.step, self._index, len(self.steps), fraction,
                        any(seen), settling, self.aim_targets, tuple(seen))

    def update(self, frames: Sequence[Any], now: float) -> Progress:
        """Feed one frame per camera in and get the overlay state back."""
        subjects = [frame.subjects[0] if frame.subjects else None for frame in frames]
        seen = [subject is not None for subject in subjects]

        if self.is_done:
            return self._progress(1.0, seen)
        if not any(seen):
            self._reset_step()
            return self._progress(0.0, seen)
        if now < self._hold_until:
            self._reset_step()
            return self._progress(0.0, seen, settling=True)

        if self._started is None:
            self._started = now
        for index, subject in enumerate(subjects):
            if subject is None:
                continue
            if self.step.records == "trigger":
                # Record every candidate signal; which one is used is decided at
                # the end, by whichever separates this player's poses best.
                self._samples[index].append(
                    {signal.name: signal.measure(subject)
                     for signal in self.scheme.signals})
            else:
                # Likewise every candidate pointer setting.
                self._samples[index].append(
                    tuple(self.scheme.pointer(subject, tuning)
                          for tuning in self.scheme.tunings))

        fraction = min((now - self._started) / self.dwell, 1.0)
        if fraction >= 1.0 and any(self._samples):
            self._recorded[self.step.key] = self._samples
            self._index += 1
            self._reset_step()
            self._hold_until = now + self.settle
            return self._progress(0.0, seen, settling=True)
        return self._progress(fraction, seen)

    def _reset_step(self) -> None:
        self._started = None
        self._samples = [[] for _ in range(self.cameras)]

    def retry(self, now: float) -> None:
        """Discard the current attempt without throwing away earlier poses."""
        self._index = min(self._index, len(self.steps) - 1)
        self._recorded.pop(self.step.key, None)
        self._reset_step()
        self._hold_until = now + self.settle

    def back(self, now: float) -> None:
        """Revisit the previous pose and invalidate every later measurement."""
        self._index = max(0, self._index - 1)
        for step in self.steps[self._index:]:
            self._recorded.pop(step.key, None)
        self.retry(now)

    # --- building the result ----------------------------------------------

    def result(self) -> Rig:
        """Build one calibration per camera, falling back field by field."""
        return Rig(tuple(self._camera(index) for index in range(self.cameras)))

    def _camera(self, index: int) -> Calibration:
        fallback = self.fallback[index]
        mapping, error, score, gain, tuning, fitted = self._aiming_map(index,
                                                                       fallback)
        if not fitted and self.cameras > 1:
            # Nothing was measured for this camera while others were: let it sit
            # the game out rather than vote with a map that is not its own.
            gain = float("inf")
        signal, cocked, folded, measured = self._trigger_poses(index, fallback)
        return Calibration(
            mapping=mapping, signal=signal, cocked=cocked, folded=folded,
            tuning=tuning, fit_error=error, generalisation=score,
            aim_fitted=fitted, trigger_fitted=measured,
            jitter=self._jitter(index, fallback, tuning), gain=gain,
            slide=self._slide(index, mapping, tuning))

    def _tuning_index(self, tuning: tuple[float, float]) -> int:
        tunings = self.scheme.tunings
        return min(range(len(tunings)),
                   key=lambda i: (tunings[i][0] - tuning[0]) ** 2
                   + (tunings[i][1] - tuning[1]) ** 2)

    def _aiming_map(self, index: int, fallback: Calibration
                    ) -> tuple[Matrix, float, float, float,
                               tuple[float, float], bool]:
        """Fit the map, trying every pointer setting the scheme offers.

        For a hand there is only one. For the eyes there is a grid of head/eye
        weightings, because how much a look is head and how much is eyes differs
        from person to person. The winner is not the one that fits the traced
        markers tightest - on nine noisy points that rewards fitting the noise -
        but the one that predicts each marker from the other eight best:
        leave-one-out cross-validation, which punishes both overfitting and the
        cancelling weightings in one honest number.
        """
        # Richest to humblest. Every one of them, whatever it fits, comes out
        # correctly oriented, because each is fitted to what the player actually
        # did - so as long as one survives, no axis can end up reversed. The
        # simplest is hardest to defeat: it asks only that the signal moved with
        # the target, which is why it is here at all.
        fitters = [homography.fit_affine, homography.fit_scaled]
        if getattr(self.scheme, "projective", True):
            fitters.insert(0, homography.fit)

        candidates: list[tuple[float, float, Matrix, float,
                               tuple[float, float]]] = []
        for position, tuning in enumerate(self.scheme.tunings):
            observed, intended = [], []
            for step in self.steps:
                if step.records != "aim":
                    continue
                centre = self._median_point(step.key, index, position)
                if centre is not None:
                    observed.append(centre)
                    intended.append(step.target)

            for fit in fitters:
                matrix = fit(observed, intended)
                if matrix is None:
                    continue
                error = homography.residual(matrix, observed, intended)
                gain = statistics.median(homography.gain(matrix, point)
                                         for point in observed)
                candidates.append((_generalisation(observed, intended, fit),
                                   error, matrix, gain, tuning))

        if not candidates:
            return (fallback.mapping, fallback.fit_error,
                    fallback.generalisation, fallback.gain,
                    fallback.tuning, False)

        # The gain breaks exact ties only (a noiseless symmetric trace scores
        # several weightings identically); it must not overrule the held-out
        # error, or it drags the fit towards the largest weight on offer.
        score, error, matrix, gain, tuning = min(
            candidates, key=lambda c: (round(c[0], 6), c[3]))

        # The gate is the held-out score, not the training residual: with eight
        # or six free parameters on nine points, the residual flatters any map.
        if error > MAX_FIT_ERROR or not score < MAX_GENERALISATION:
            # The trace does not predict itself - the signal was too noisy, or
            # the player drifted. A map like that aims at nothing; fall back
            # and let the caller say so.
            return (fallback.mapping, fallback.fit_error,
                    fallback.generalisation, fallback.gain,
                    fallback.tuning, False)
        return matrix, error, score, gain, tuning, True

    def _slide(self, index: int, mapping: Matrix,
               tuning: tuple[float, float]) -> Point:
        """Half the gap between the two reach poses, in screen units."""
        position = self._tuning_index(tuning)
        near = self._median_point("reach_near", index, position)
        far = self._median_point("reach_far", index, position)
        if near is None or far is None:
            return (0.0, 0.0)
        close, distant = homography.apply(mapping, near), homography.apply(mapping, far)
        if close is None or distant is None:
            return (0.0, 0.0)  # a reach the map cannot place measures nothing
        return ((distant[0] - close[0]) / 2.0, (distant[1] - close[1]) / 2.0)

    def _jitter(self, index: int, fallback: Calibration,
                tuning: tuple[float, float]) -> float:
        """This camera's own landmark shake, from the spread within each dwell."""
        position = self._tuning_index(tuning)
        spreads = []
        for step in self.steps:
            if step.records == "trigger":
                continue
            samples = self._samples_for(step.key, index)
            if len(samples) > 1:
                spreads.append((_spread([s[position][0] for s in samples])
                                + _spread([s[position][1] for s in samples])) / 2.0)
        return statistics.median(spreads) if spreads else fallback.jitter

    def _trigger_poses(self, index: int,
                       fallback: Calibration) -> tuple[str, float, float, bool]:
        """Pick the signal that tells this player's two poses apart best."""
        cocked = self._samples_for("cocked", index)
        fired = self._samples_for("fired", index)
        if not cocked or not fired:
            return fallback.signal, fallback.cocked, fallback.folded, False

        best: tuple[float, str, float, float] | None = None
        for signal in self.scheme.signals:
            down = [sample[signal.name] for sample in cocked]
            up = [sample[signal.name] for sample in fired]
            centre_down, centre_up = statistics.median(down), statistics.median(up)
            separation = abs(centre_up - centre_down)
            if separation < signal.min_travel:
                continue
            # Separation counted in noise widths: how confidently one frame can
            # be assigned to a pose. A pose held unsteadily still counts if the
            # two are simply far apart - an unsteady wink is still a wink, and
            # refusing it leaves the player with a trigger that never fires.
            confidence = separation / (_spread(down) + _spread(up) + 1e-6)
            if confidence < MIN_SEPARATION and separation < 3 * signal.min_travel:
                continue
            if best is None or confidence > best[0]:
                best = (confidence, signal.name, centre_down, centre_up)

        if best is None:
            # The poses overlap: keep the defaults rather than fit a hair trigger.
            return fallback.signal, fallback.cocked, fallback.folded, False
        _, name, centre_down, centre_up = best
        chosen = self.scheme.signal(name)
        span = centre_up - centre_down
        if abs(span) > chosen.max_span:
            # Setup poses are deliberate and exaggerated; the scale they set must
            # stay within what a comfortable play stroke actually spans, or every
            # quick pull becomes a near miss against a heroic calibration.
            centre_up = centre_down + math.copysign(chosen.max_span, span)
        return name, centre_down, centre_up, True

    def _samples_for(self, key: str, index: int) -> list:
        recorded = self._recorded.get(key)
        if not recorded or index >= len(recorded):
            return []
        return recorded[index]

    def _median_point(self, key: str, index: int, tuning: int) -> Point | None:
        samples = self._samples_for(key, index)
        if not samples:
            return None
        return (statistics.median(s[tuning][0] for s in samples),
                statistics.median(s[tuning][1] for s in samples))


def _generalisation(observed: list[Point], intended: list[Point],
                    fit=homography.fit) -> float:
    """Mean leave-one-out error: how well the fit predicts a marker it never saw.

    Never the plain residual, however few the points. That substitution used to
    happen below five markers, which is exactly where it does most harm: with
    ``--calibration-grid 2`` there are four, an eight-parameter homography
    passes through all four exactly, and residual and held-out score alike came
    out at 1e-16 - so a map fitted entirely to noise sailed through the quality
    gate and told the player it was accurate to 0.0% of the screen. A fit with
    no held-out evidence is not certified; each fitter says so itself, by
    failing on the reduced set when it has too little left to work with.
    """
    if len(observed) < 3:
        return float("inf")  # nothing left to test a fit against
    errors = []
    for held in range(len(observed)):
        matrix = fit(observed[:held] + observed[held + 1:],
                     intended[:held] + intended[held + 1:])
        if matrix is None:
            return float("inf")
        predicted = homography.apply(matrix, observed[held])
        if predicted is None:
            return float("inf")  # the held-out marker fell past the horizon
        errors.append(math.dist(predicted, intended[held]))
    return sum(errors) / len(errors)


def _spread(samples: list[float]) -> float:
    return statistics.stdev(samples) if len(samples) > 1 else 0.0
