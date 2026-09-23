"""How the player points and how they pull the trigger.

There is one way to aim - the finger pistol - and the sniper map adds an eye
scope on top of it. The two differ only in what is tracked: the calibration,
the projective map, the camera fusion, the filtering and the recoil are the same
underneath, because all of them work on a two-dimensional pointer and a single
trigger measurement.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import numpy as np

from . import rendering
from .aiming import INDEX_TIP, palm_span, thumb_angle
from .recognition import GestureStream
from .marksman import MarksmanStream, draw_marksman

Point = tuple[float, float]


@dataclass(frozen=True)
class Scheme:
    """A way of aiming and shooting. The trigger is always the thumb
    (:func:`aiming.thumb_pull`); schemes differ in what else they track."""

    key: str
    title: str
    models: tuple[str, ...]  # which MediaPipe bundles it needs, in open_stream order
    footer: str
    pointer: Callable[[Any], Point]  # subject -> screen-bound point
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
    #: sweeps most of the camera frame around 0.5.
    pointer_centre: tuple[float, float] = (0.5, 0.5)
    pointer_span: float = 0.35
    #: One Euro filter defaults (min_cutoff, beta) when the player sets none.
    smoothing: tuple[float, float] = (1.2, 0.8)
    #: How far the thumb has to fold to fire, and how far back up it has to
    #: come before the next shot: fractions of the built-in pull, 0 thumb up to
    #: 1 folded.
    fire_above: float = 0.50
    arm_below: float = 0.30


# --- the finger pistol ------------------------------------------------------

PISTOL = Scheme(
    key="pistol",
    title="FINGER PISTOL",
    models=("gesture_recognizer",),
    footer="point your finger like a pistol, fold your thumb to shoot",
    pointer=lambda hand: hand.landmarks[INDEX_TIP],
    scale=palm_span,
    describe_subject=lambda hand: (
        f"thumb {thumb_angle(hand):5.1f} deg   span {palm_span(hand):.3f}"),
    # One hand, deliberately: the game aims with a single hand, and letting the
    # recogniser track a second costs CPU and can hand the crosshair to a
    # bystander walking through the frame.
    open_stream=lambda model_path: GestureStream(model_path, max_hands=1),
    draw=lambda image, frame, scale: rendering.draw_hands(
        image, frame, scale=scale, show_captions=False),
)


# --- the marksman: hand to aim and fire, an eye to look down the scope -------

MARKSMAN = Scheme(
    key="marksman",
    title="HAND + EYE SCOPE",
    models=("gesture_recognizer", "face_landmarker"),
    footer="point to aim, drop your thumb to fire, close an eye to scope in",
    pointer=lambda subject: PISTOL.pointer(subject.hand),
    scale=lambda subject: PISTOL.scale(subject.hand),
    open_stream=lambda hand_model, face_model: MarksmanStream(hand_model, face_model),
    draw=draw_marksman,
    describe_subject=lambda subject: (
        PISTOL.describe_subject(subject.hand)
        + (f"   eye {subject.face.closure:.2f}" if subject.face is not None else "   no face")),
    scope=lambda subject: subject.face.closure if subject.face is not None else None,
)


# Every tracking implementation. Only the pistol is a player control; the
# marksman is selected by the sniper map itself.
SCHEMES: tuple[Scheme, ...] = (PISTOL, MARKSMAN)
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
