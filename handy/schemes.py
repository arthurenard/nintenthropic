"""How the player points and how they pull the trigger.

Hand aiming and the sniper scope share one pointer and trigger pipeline.
The experimental gaze implementation is not offered in the game. Trackers differ in
what is watched and what counts as a shot - the calibration, the projective map,
the camera fusion, the filtering and the recoil are the same underneath, because
all of them work on a two-dimensional pointer and a single trigger measurement.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

import numpy as np

from . import faces, rendering
from .aiming import INDEX_TIP, palm_span, thumb_angle, thumb_extension
from .faces import FaceStream
from .recognition import GestureStream
from .marksman import MarksmanStream, draw_marksman

Point = tuple[float, float]
Tuning = tuple[float, float]


def _weight_grid(values: tuple[float, ...]) -> tuple[Tuning, ...]:
    """Every pairing of per-axis weights, for calibration to choose between."""
    return tuple((wx, wy) for wx in values for wy in values)


@dataclass(frozen=True)
class Signal:
    """One candidate measurement of the trigger.

    A scheme may offer several: calibration keeps whichever tells the player's
    two poses apart most confidently, because people differ.
    """

    name: str
    measure: Callable[[Any], float]
    #: Smallest gap between the two poses worth trusting, in this signal's units.
    min_travel: float
    #: Where a typical player's two poses sit, in this signal's own units. These
    #: are what the game runs on when setup was skipped or a step failed - so
    #: they must be believable for THIS signal, never borrowed from another
    #: scheme. (A wink is 0..1; borrowing the thumb's 20..70 degrees left the
    #: eye scheme with a trigger that could never fire.)
    rest: float
    fired: float
    #: The widest span calibration may claim between the two poses. Setup asks
    #: for a deliberate, exaggerated pose; letting a thumb slammed flat to 88
    #: degrees define the scale makes every quick play-stroke a near miss. The
    #: cap is what a comfortable stroke actually spans.
    max_span: float = float("inf")


@dataclass(frozen=True)
class Instruction:
    """What the setup screen says for one step."""

    instruction: str
    detail: str


@dataclass(frozen=True)
class Scheme:
    """A way of aiming and shooting."""

    key: str
    title: str
    blurb: str
    models: tuple[str, ...]  # which MediaPipe bundles it needs, in open_stream order
    aim: Instruction
    cocked: Instruction
    fired: Instruction
    footer: str
    signals: tuple[Signal, ...]
    pointer: Callable[[Any, Tuning], Point]  # subject, tuning -> screen-bound point
    scale: Callable[[Any], float]  # how much of the frame the subject fills
    open_stream: Callable[..., Any]
    draw: Callable[[np.ndarray, Any, float], None]
    #: One line of raw readings for the debug HUD, so a player whose aim feels
    #: dead can see whether the signal even moves when they do.
    describe_subject: Callable[[Any], str] | None = None
    #: A second, independent control: how hard the player is asking to look
    #: down the scope, 0..1. None for schemes with no scope.
    scope: Callable[[Any], float] | None = None
    #: The half-width of the box the pointer sweeps, in the pointer's own units,
    #: for the default map used before any calibration exists. A fingertip
    #: sweeps most of the camera frame around 0.5; a gaze sweeps a fraction of
    #: a radian around zero.
    pointer_centre: tuple[float, float] = (0.5, 0.5)
    pointer_span: float = 0.35
    default_tuning: Tuning = (0.0, 0.0)
    #: Whether the aim map may be a full homography. A hand sweeping a plane in
    #: front of an off-axis camera is genuinely projective; gaze angles are not,
    #: and the two extra parameters only chase noise.
    projective: bool = True
    #: One Euro filter defaults (min_cutoff, beta) when the player sets none. A
    #: fingertip is a clean signal; a gaze needs a heavier hand.
    smoothing: tuple[float, float] = (1.2, 0.8)
    #: Trigger strokes as fractions of the calibrated travel: fire on rising
    #: this far from the trough, re-arm on falling this far from the peak.
    #: Setup measures a deliberate, held pose; the stroke that has to count in
    #: play is quicker and smaller than that.
    fire_above: float = 0.50
    arm_below: float = 0.30
    #: Whether a median-of-three may sit on the trigger. Right for a thumb,
    #: wrong for an eye: a wink can be over inside a single detection.
    trigger_median: bool = True
    needs_reach: bool = True
    #: How many cameras this scheme can actually make use of. None means all of
    #: them; a scheme with nothing to gain from a second view says so here.
    max_cameras: int | None = None
    #: Candidate settings for the pointer, tried at calibration and the best kept.
    tunings: tuple[Tuning, ...] = ((0.0, 0.0),)

    def signal(self, name: str) -> Signal:
        for candidate in self.signals:
            if candidate.name == name:
                return candidate
        return self.signals[0]

    def measure(self, name: str, subject: Any) -> float:
        return self.signal(name).measure(subject)


# --- the finger pistol ------------------------------------------------------

PISTOL = Scheme(
    key="pistol",
    title="FINGER PISTOL",
    blurb="Point your hand like a pistol. Drop your thumb to fire.",
    models=("gesture_recognizer",),
    footer="point your finger like a pistol, fold your thumb to shoot",
    aim=Instruction("Point at the marker",
                    "this is how the game learns where your cameras are"),
    cocked=Instruction("Thumb UP, pistol cocked", "hold the pose you will aim with"),
    fired=Instruction("Thumb DOWN, as if firing",
                      "hold the thumb where it lands when you shoot"),
    signals=(
        Signal("angle", thumb_angle, min_travel=8.0, rest=20.0, fired=70.0,
               max_span=45.0),
        Signal("reach", thumb_extension, min_travel=0.15, rest=1.0, fired=0.45,
               max_span=0.55),
    ),
    pointer=lambda hand, _tuning: hand.landmarks[INDEX_TIP],
    scale=palm_span,
    describe_subject=lambda hand: (
        f"thumb {thumb_angle(hand):5.1f} deg   span {palm_span(hand):.3f}"),
    # One hand, deliberately: the game aims with a single hand, and letting the
    # recogniser track a second costs CPU and can hand the crosshair to a
    # bystander walking through the frame.
    open_stream=lambda model_path: GestureStream(model_path, max_hands=1),
    draw=lambda image, frame, scale: rendering.draw_hands(
        image, frame, scale=scale, show_captions=False),
    pointer_centre=(0.5, 0.5),
    pointer_span=0.35,
    needs_reach=True,
)


# --- the eyes ---------------------------------------------------------------

def _draw_eyes(image: np.ndarray, frame: faces.FaceFrame, scale: float) -> None:
    from .rendering import draw_eyes

    draw_eyes(image, frame, scale=scale)


GAZE = Scheme(
    key="gaze",
    title="EYE TRACKING",
    blurb="Look at the target. Wink one eye to fire.",
    models=("face_landmarker",),
    footer="look at the target, wink one eye to shoot",
    aim=Instruction("Look at the marker",
                    "the way you naturally would - face and eyes together"),
    cocked=Instruction("Both eyes OPEN", "look at the screen, normally"),
    fired=Instruction("WINK one eye", "hold it shut, the other eye open"),
    signals=(Signal("wink", lambda face: face.wink, min_travel=0.10,
                    # Reachable on purpose: few people wink without the other eye
                    # closing a little, and a threshold set for a perfect wink is
                    # a threshold most players never cross. The eye only has to
                    # come most of the way down, not slam shut.
                    rest=0.03, fired=0.36, max_span=0.45),),
    pointer=lambda face, tuning: face.gaze(tuning),
    scale=lambda face: face.eye_span,
    describe_subject=lambda face: (
        f"head ({math.degrees(face.yaw):+5.1f}, {math.degrees(face.pitch):+5.1f}) deg"
        f"   eyes ({face.eye_direction()[0]:+.2f}, {face.eye_direction()[1]:+.2f})"
        f"   wink {face.wink:.2f}"),
    open_stream=FaceStream,
    draw=_draw_eyes,
    # A look sweeps a fraction of a radian, centred on straight-ahead.
    pointer_centre=(0.0, 0.0),
    pointer_span=0.30,
    default_tuning=(0.3, 0.2),
    projective=False,
    smoothing=(0.5, 0.3),
    fire_above=0.30,
    arm_below=0.14,
    trigger_median=False,
    needs_reach=False,
    # One camera, deliberately. A second view only pays for itself when it can
    # measure something the first cannot - and here it cannot. Without the reach
    # steps there is no baseline to solve depth from, so two cameras could only
    # be averaged, which is measurably worse than trusting the better one; and a
    # face seen steeply from the side gives poor iris geometry to average in.
    max_cameras=1,
    # Head turn and eye turn add up, but how strongly - separately per axis,
    # because eyes sweep further sideways than up and down - and in which
    # direction, depends on the person and on conventions not worth guessing
    # at. Calibration tries every pairing and keeps the one that describes the
    # traced grid best.
    tunings=_weight_grid((-0.9, -0.45, -0.2, 0.0, 0.2, 0.45, 0.9)),
)


# --- the marksman: hand to aim and fire, an eye to look down the scope -------

MARKSMAN = Scheme(
    key="marksman",
    title="HAND + EYE SCOPE",
    blurb="Aim and fire with your hand. Close one eye to look down the scope.",
    models=("gesture_recognizer", "face_landmarker"),
    footer="point to aim, drop your thumb to fire, close an eye to scope in",
    aim=PISTOL.aim,
    cocked=PISTOL.cocked,
    fired=PISTOL.fired,
    # The pistol's signals, each unwrapped to the hand inside the marksman.
    # ``replace`` rather than a fresh Signal: listing the fields by hand once
    # dropped max_span, which silently made the marksman's trigger far heavier
    # than the pistol's it is supposed to be a copy of.
    signals=tuple(
        replace(signal,
                measure=(lambda subject, measure=signal.measure: measure(subject.hand)))
        for signal in PISTOL.signals),
    pointer=lambda subject, tuning: PISTOL.pointer(subject.hand, tuning),
    scale=lambda subject: PISTOL.scale(subject.hand),
    open_stream=lambda hand_model, face_model: MarksmanStream(hand_model, face_model),
    draw=draw_marksman,
    describe_subject=lambda subject: (
        PISTOL.describe_subject(subject.hand)
        + (f"   eye {subject.face.closure:.2f}" if subject.face is not None else "   no face")),
    scope=lambda subject: subject.face.closure if subject.face is not None else None,
    pointer_centre=PISTOL.pointer_centre,
    pointer_span=PISTOL.pointer_span,
    needs_reach=True,
)


# Internal tracking implementations. Gaze is retained for the research tests,
# but is not a player control. Marksman is selected by the sniper map itself.
SCHEMES: tuple[Scheme, ...] = (PISTOL, GAZE, MARKSMAN)
CONTROLS: tuple[Scheme, ...] = (PISTOL,)
DEFAULT = PISTOL


def keys() -> tuple[str, ...]:
    return tuple(scheme.key for scheme in CONTROLS)


def for_map(map_key: str | None) -> Scheme:
    """Hand controls gain an uncalibrated eye scope on the sniper map."""
    return MARKSMAN if map_key == "sniper" else PISTOL


def calibration_key(scheme: Scheme) -> str:
    """The scope adds no calibration measurements to the hand setup."""
    return "pistol" if scheme.key == "marksman" else scheme.key


def by_key(key: str) -> Scheme:
    for scheme in SCHEMES:
        if scheme.key == key:
            return scheme
    raise KeyError(f"unknown control scheme {key!r}; try one of {', '.join(keys())}")
