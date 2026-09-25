"""Thin, typed wrapper around the MediaPipe gesture recognizer."""

from __future__ import annotations

import threading
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


class Results:
    """The newest answer from a live stream, and a way to wait for a given one.

    MediaPipe answers on its own thread a few milliseconds after a frame goes
    in. Reading straight after submitting gets the answer to the frame before,
    so everything aimed from it runs a whole frame late. :meth:`wait` lets a
    caller that can spare the time block, briefly, for the frame it just sent.
    """

    def __init__(self, empty) -> None:
        self._latest = empty
        self._arrived = threading.Condition()
        self._closed = False

    def put(self, frame) -> None:
        """Publish an answer. Called on MediaPipe's thread."""
        with self._arrived:
            self._latest = frame
            self._arrived.notify_all()

    def latest(self):
        return self._latest

    def wait(self, timestamp_ms: int, timeout: float):
        """The answer to the frame stamped ``timestamp_ms``, or to a later one,
        if it arrives within ``timeout`` seconds; the newest there is if not.

        MediaPipe answers in stamp order, so any answer at or past the stamp is
        at least as fresh as the one asked for. A frame the graph dropped is
        never answered at all, which is why the wait is bounded.
        """
        with self._arrived:
            self._arrived.wait_for(
                lambda: self._closed or self._latest.timestamp_ms >= timestamp_ms,
                max(0.0, timeout))
            return self._latest

    def close(self) -> None:
        """Release every waiter now: no answer is coming after this."""
        with self._arrived:
            self._closed = True
            self._arrived.notify_all()


class GestureStream:
    """Recognises hands in a live video stream.

    MediaPipe's live-stream mode is asynchronous: frames are pushed in and
    results arrive on a callback thread. :meth:`latest` returns the most recent
    result, so the render loop never blocks on inference; :meth:`wait` blocks
    for a bounded time on the answer to one frame in particular.
    """

    def __init__(self, model_path: Path, max_hands: int = 2) -> None:
        self._results = Results(Frame())
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
        self._results.put(_to_frame(result, timestamp_ms))

    def submit(self, bgr_frame: np.ndarray) -> int:
        """Queue a frame (OpenCV BGR) for recognition.

        Returns the stamp its answer will carry, for :meth:`wait`.
        """
        import cv2  # local import keeps this module importable without a display

        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        stamp = self._next_timestamp()
        self._recognizer.recognize_async(image, stamp)
        return stamp

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
        return self._results.latest()

    def wait(self, stamp: int, timeout: float) -> Frame:
        """The result for the frame :meth:`submit` stamped ``stamp``, waiting up
        to ``timeout`` seconds for it; :meth:`latest` if it is not ready by then."""
        return self._results.wait(stamp, timeout)

    def close(self) -> None:
        # Release waiters first: once the graph closes no answer is coming, and
        # each would otherwise sit out its whole timeout.
        self._results.close()
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
