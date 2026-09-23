"""Thin, typed wrapper around the MediaPipe gesture recognizer."""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

#: Landmark indices of the five fingertips, in MediaPipe's hand topology.
FINGERTIPS = frozenset({4, 8, 12, 16, 20})

#: Bones connecting the 21 hand landmarks, as (start, end) index pairs.
HAND_CONNECTIONS: tuple[tuple[int, int], ...] = tuple(
    (connection.start, connection.end)
    for connection in vision.HandLandmarksConnections.HAND_CONNECTIONS
)


@dataclass(frozen=True)
class Hand:
    """One detected hand, decoupled from MediaPipe's own result types."""

    landmarks: tuple[tuple[float, float], ...]  # 21 points, normalised to [0, 1]
    handedness: str  # "Left" or "Right", from the viewer's perspective
    gesture: str | None  # canned gesture name, None when nothing is recognised
    score: float

    @property
    def is_left(self) -> bool:
        return self.handedness == "Left"


@dataclass(frozen=True)
class Frame:
    """Everything recognised in a single video frame."""

    hands: tuple[Hand, ...] = ()
    timestamp_ms: int = 0

    @property
    def subjects(self) -> tuple[Hand, ...]:
        """What was recognised, under the name the control schemes share."""
        return self.hands


def _to_hand(landmarks, handedness, gestures) -> Hand:
    top = gestures[0] if gestures else None
    # MediaPipe reports the "None" category when no canned gesture matches.
    name = top.category_name if top and top.category_name != "None" else None
    return Hand(
        landmarks=tuple((point.x, point.y) for point in landmarks),
        handedness=handedness[0].category_name if handedness else "?",
        gesture=name,
        score=top.score if top else 0.0,
    )


def _to_frame(result, timestamp_ms: int) -> Frame:
    hands = tuple(
        _to_hand(
            result.hand_landmarks[i],
            result.handedness[i] if i < len(result.handedness) else (),
            result.gestures[i] if i < len(result.gestures) else (),
        )
        for i in range(len(result.hand_landmarks))
    )
    return Frame(hands=hands, timestamp_ms=timestamp_ms)


class GestureStream:
    """Recognises hands in a live video stream.

    MediaPipe's live-stream mode is asynchronous: frames are pushed in and
    results arrive on a callback thread. :meth:`latest` returns the most recent
    result, so the render loop never blocks on inference.
    """

    def __init__(self, model_path: Path, max_hands: int = 2) -> None:
        self._latest = Frame()
        self._started = time.perf_counter()
        self._clock = -1
        options = vision.GestureRecognizerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.LIVE_STREAM,
            num_hands=max_hands,
            result_callback=self._on_result,
        )
        self._recognizer = vision.GestureRecognizer.create_from_options(options)

    def _on_result(self, result, _image, timestamp_ms: int) -> None:
        self._latest = _to_frame(result, timestamp_ms)

    def submit(self, bgr_frame: np.ndarray) -> None:
        """Queue a frame (OpenCV BGR) for recognition."""
        import cv2  # local import keeps this module importable without a display

        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        self._recognizer.recognize_async(image, self._next_timestamp())

    def _next_timestamp(self) -> int:
        """A millisecond stamp that never repeats.

        Live-stream mode rejects a timestamp that is not strictly greater than
        the last one, and two submits inside the same millisecond otherwise
        produce the same elapsed count. Tracking the wall clock keeps the stamps
        honest whenever frames are far enough apart; the counter takes over when
        they are not, so a fast loop advances by a millisecond a frame instead of
        raising.
        """
        elapsed_ms = int((time.perf_counter() - self._started) * 1000)
        self._clock = max(self._clock + 1, elapsed_ms)
        return self._clock

    def latest(self) -> Frame:
        """The most recent recognition result, or an empty frame before the first."""
        return self._latest

    def close(self) -> None:
        self._recognizer.close()

    def __enter__(self) -> "GestureStream":
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        self.close()


def recognize_image(bgr_frame: np.ndarray, model_path: Path, max_hands: int = 2) -> Frame:
    """Recognise hands in a single still image. Used for tests and one-off checks."""
    import cv2

    options = vision.GestureRecognizerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        num_hands=max_hands,
    )
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    with vision.GestureRecognizer.create_from_options(options) as recognizer:
        result = recognizer.recognize(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    return _to_frame(result, timestamp_ms=0)
