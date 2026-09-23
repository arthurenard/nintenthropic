"""Eye tracking, for the sniper's scope.

MediaPipe's face landmarker gives 478 points and a set of expression
blendshapes, two of which say how closed each eye is. The scope needs only
those two: whether either lid is being held shut.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

Point = tuple[float, float]


@dataclass(frozen=True)
class Face:
    """One face, reduced to what the scope needs."""

    landmarks: tuple[Point, ...]
    blink_left: float
    blink_right: float

    @property
    def closure(self) -> float:
        """Whether either lid is closed, independent of gaze or the other eye."""
        return max(self.blink_left, self.blink_right)


@dataclass(frozen=True)
class FaceFrame:
    """Everything recognised in a single video frame."""

    faces: tuple[Face, ...] = ()
    timestamp_ms: int = 0

    @property
    def subjects(self) -> tuple[Face, ...]:
        return self.faces


def _blendshape(categories, name: str) -> float:
    for category in categories:
        if category.category_name == name:
            return float(category.score)
    return 0.0


def _to_frame(result, timestamp_ms: int) -> FaceFrame:
    faces = []
    for index, landmarks in enumerate(result.face_landmarks):
        blendshapes = (result.face_blendshapes[index]
                       if index < len(result.face_blendshapes) else ())
        faces.append(Face(
            landmarks=tuple((point.x, point.y) for point in landmarks),
            blink_left=_blendshape(blendshapes, "eyeBlinkLeft"),
            blink_right=_blendshape(blendshapes, "eyeBlinkRight")))
    return FaceFrame(faces=tuple(faces), timestamp_ms=timestamp_ms)


def _options(model_path: Path, running_mode, callback=None):
    return vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=running_mode, num_faces=1,
        output_face_blendshapes=True,
        result_callback=callback)


class FaceStream:
    """Recognises a face in a live video stream, the same shape as GestureStream."""

    def __init__(self, model_path: Path) -> None:
        self._latest = FaceFrame()
        self._started = time.perf_counter()
        self._clock = -1
        self._landmarker = vision.FaceLandmarker.create_from_options(
            _options(model_path, vision.RunningMode.LIVE_STREAM, self._on_result))

    def _on_result(self, result, _image, timestamp_ms: int) -> None:
        self._latest = _to_frame(result, timestamp_ms)

    def submit(self, bgr_frame: np.ndarray) -> None:
        import cv2

        rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        self._landmarker.detect_async(image, self._next_timestamp())

    def _next_timestamp(self) -> int:
        """A millisecond stamp that never repeats; see GestureStream._next_timestamp."""
        elapsed_ms = int((time.perf_counter() - self._started) * 1000)
        self._clock = max(self._clock + 1, elapsed_ms)
        return self._clock

    def latest(self) -> FaceFrame:
        return self._latest

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self) -> "FaceStream":
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None,
                 tb: TracebackType | None) -> None:
        self.close()


def detect_image(bgr_frame: np.ndarray, model_path: Path) -> FaceFrame:
    """Find a face in a single still image. Used for tests and one-off checks."""
    import cv2

    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    with vision.FaceLandmarker.create_from_options(
            _options(model_path, vision.RunningMode.IMAGE)) as landmarker:
        result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    return _to_frame(result, timestamp_ms=0)
