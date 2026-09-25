"""A hand and a face from the same camera, read as one subject.

The marksman scheme aims and fires with the hand and looks down the scope with
an eye, so it needs both recognisers on every frame. This binds them together
behind the same interface a single stream presents.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

import numpy as np

from .faces import Face, FaceStream
from .recognition import GestureStream, Hand
from .rendering import draw_eyes, draw_hands


@dataclass(frozen=True)
class Marksman:
    """One player: the hand that aims, and the face that may be squinting."""

    hand: Hand
    face: Face | None


@dataclass(frozen=True)
class MarksmanFrame:
    subjects: tuple[Marksman, ...] = ()
    hands: tuple[Hand, ...] = ()
    faces: tuple[Face, ...] = ()
    timestamp_ms: int = 0


class MarksmanStream:
    """Both recognisers, fed the same frames, reporting one subject."""

    def __init__(self, hand_model: Path, face_model: Path) -> None:
        self._hands = GestureStream(hand_model, max_hands=1)
        try:
            self._faces = FaceStream(face_model)
        except BaseException:
            # __init__ never returned, so no `with` or ExitStack can close the
            # recogniser that did open: a bad face bundle would otherwise leak
            # a live MediaPipe graph and its threads on every attempt.
            self._hands.close()
            raise

    def submit(self, bgr_frame: np.ndarray) -> tuple[int, int]:
        """Queue a frame for both; returns what :meth:`wait` needs to find it."""
        return self._hands.submit(bgr_frame), self._faces.submit(bgr_frame)

    def wait(self, stamps: tuple[int, int], timeout: float) -> MarksmanFrame:
        """Both answers to the frame :meth:`submit` returned ``stamps`` for,
        waiting up to ``timeout`` seconds in all; :meth:`latest` after that.

        The two recognisers run side by side, so waiting on the hand and then
        the face costs the slower of the two, not their sum.
        """
        deadline = time.monotonic() + timeout
        self._hands.wait(stamps[0], timeout)
        self._faces.wait(stamps[1], deadline - time.monotonic())
        return self.latest()

    def latest(self) -> MarksmanFrame:
        hands = self._hands.latest()
        faces = self._faces.latest()
        if not hands.hands:
            return MarksmanFrame(hands=(), faces=faces.faces,
                                 timestamp_ms=hands.timestamp_ms)
        # A stale closed-eye result must not leave the scope engaged.
        # Each tracker starts its elapsed clock when its model is constructed.
        # Compare on the shared wall-clock axis, including model startup time.
        offset = 1000 * (getattr(self._hands, "_started", 0)
                         - getattr(self._faces, "_started", 0))
        fresh_face = abs(hands.timestamp_ms - faces.timestamp_ms + offset) <= 250
        face = faces.faces[0] if faces.faces and fresh_face else None
        return MarksmanFrame(subjects=(Marksman(hands.hands[0], face),),
                             hands=hands.hands, faces=faces.faces if fresh_face else (),
                             timestamp_ms=hands.timestamp_ms)

    def close(self) -> None:
        try:
            self._hands.close()
        finally:
            self._faces.close()  # one failing to close must not strand the other

    def __enter__(self) -> "MarksmanStream":
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        self.close()


def draw_marksman(image: np.ndarray, frame, scale: float) -> None:
    """Hand skeleton and eye outlines together on the inset."""
    hands = getattr(frame, "hands", ())
    faces = getattr(frame, "faces", ())
    if hands:
        from .recognition import Frame

        draw_hands(image, Frame(hands=tuple(hands)), scale=scale, show_captions=False)
    if faces:
        from .faces import FaceFrame

        draw_eyes(image, FaceFrame(faces=tuple(faces)), scale=scale)
