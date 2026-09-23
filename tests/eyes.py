"""Synthetic faces with eye geometry we control exactly."""

from __future__ import annotations

from handy.faces import (LEFT_EYE_CORNERS, LEFT_IRIS, RIGHT_EYE_CORNERS,
                         RIGHT_IRIS, Face, FaceFrame)

EYE_HALF_WIDTH = 0.022
EYE_LINE = 0.40


def make_face(iris: tuple[float, float] = (0.0, 0.0), yaw: float = 0.0,
              pitch: float = 0.0, blink: tuple[float, float] = (0.2, 0.2)) -> Face:
    """A face whose irises sit ``iris`` eye-widths off centre in their sockets."""
    points = [(0.5, 0.5)] * 478
    for corners, centre_x, iris_index in ((LEFT_EYE_CORNERS, 0.45, LEFT_IRIS),
                                          (RIGHT_EYE_CORNERS, 0.55, RIGHT_IRIS)):
        left = (centre_x - EYE_HALF_WIDTH, EYE_LINE)
        right = (centre_x + EYE_HALF_WIDTH, EYE_LINE)
        points[corners[0]], points[corners[1]] = left, right
        width = 2 * EYE_HALF_WIDTH
        points[iris_index] = (centre_x + iris[0] * width, EYE_LINE + iris[1] * width)
    return Face(landmarks=tuple(points), blink_left=blink[0], blink_right=blink[1],
                yaw=yaw, pitch=pitch)


def frame_of(*faces: Face) -> FaceFrame:
    return FaceFrame(faces=tuple(faces))
