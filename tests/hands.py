"""Synthetic hands with geometry we control exactly, for the aiming tests."""

from __future__ import annotations

import math

from handy.recognition import Frame, Hand

WRIST_XY = (0.5, 0.8)
PALM_SPAN = 0.2
THUMB_LENGTH = 0.15


def rotate(vector: tuple[float, float], degrees: float) -> tuple[float, float]:
    angle = math.radians(degrees)
    cos, sin = math.cos(angle), math.sin(angle)
    return (vector[0] * cos - vector[1] * sin, vector[0] * sin + vector[1] * cos)


def make_hand(thumb_degrees: float = 0.0, reach: float = 1.0,
              index_tip: tuple[float, float] = (0.5, 0.5),
              roll: float = 0.0, scale: float = 1.0,
              wrist: tuple[float, float] = WRIST_XY) -> Hand:
    """A hand whose thumb sits ``thumb_degrees`` off the palm's up axis.

    ``reach`` is the thumb-tip-to-index-knuckle distance in palm spans, and
    ``roll`` turns the whole hand, so tests can check rotation invariance.
    """
    up = rotate((0.0, -1.0), roll)  # image coordinates: up is -y
    span = PALM_SPAN * scale

    landmarks = [(0.0, 0.0)] * 21
    landmarks[0] = wrist
    landmarks[9] = (wrist[0] + up[0] * span, wrist[1] + up[1] * span)
    landmarks[2] = (wrist[0] + up[0] * span * 0.25, wrist[1] + up[1] * span * 0.25)

    thumb = rotate(up, thumb_degrees)
    length = THUMB_LENGTH * scale
    landmarks[4] = (landmarks[2][0] + thumb[0] * length,
                    landmarks[2][1] + thumb[1] * length)
    # Place the index knuckle to hit the requested reach exactly.
    landmarks[5] = (landmarks[4][0] + reach * span, landmarks[4][1])
    landmarks[8] = index_tip
    return Hand(landmarks=tuple(landmarks), handedness="Right", gesture=None, score=0.0)


def frame_of(*hands: Hand) -> Frame:
    return Frame(hands=tuple(hands))
