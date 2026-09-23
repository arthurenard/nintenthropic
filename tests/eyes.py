"""Synthetic faces whose eyelids we control exactly."""

from __future__ import annotations

from handy.faces import Face, FaceFrame


def make_face(blink: tuple[float, float] = (0.2, 0.2)) -> Face:
    """A face whose left and right lids are ``blink`` closed, 0 open to 1 shut."""
    return Face(landmarks=((0.5, 0.5),) * 478, blink_left=blink[0],
                blink_right=blink[1])


def frame_of(*faces: Face) -> FaceFrame:
    return FaceFrame(faces=tuple(faces))
