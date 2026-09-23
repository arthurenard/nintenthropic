"""Face and eye tracking, for the look-and-blink control scheme.

MediaPipe's face landmarker gives 478 points - including the two irises - and a
set of expression blendshapes, two of which say how closed each eye is. Between
them that is everything the eye scheme needs: where the person is looking, and
whether they just winked.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

Point = tuple[float, float]

# Landmark indices in MediaPipe's face mesh.
LEFT_EYE_CORNERS = (33, 133)
RIGHT_EYE_CORNERS = (362, 263)
LEFT_IRIS = 468
RIGHT_IRIS = 473
#: How far the eyes can swing within their sockets, in eye-widths, before the
#: reading is more likely a bad landmark than a real look.
MAX_IRIS_OFFSET = 0.45


@dataclass(frozen=True)
class Face:
    """One face, reduced to what the aiming needs."""

    landmarks: tuple[Point, ...]
    blink_left: float
    blink_right: float
    yaw: float  # radians, head turned left or right
    pitch: float  # radians, head tipped up or down
    #: The model's own trained estimate of where the eyes point, from the
    #: eyeLook blendshapes, averaged over both eyes. None when the model gave
    #: no blendshapes, in which case the geometric iris offset stands in.
    look: Point | None = None

    @property
    def eye_span(self) -> float:
        """Distance between the two irises: how much of the frame the face fills."""
        return math.dist(self.landmarks[LEFT_IRIS], self.landmarks[RIGHT_IRIS])

    #: Above this much closure the "open" eye is not open: both are shutting,
    #: and whatever asymmetry there is belongs to a blink, not a wink.
    OPEN_EYE = 0.60
    OPEN_EYE_BAND = 0.30

    @property
    def wink(self) -> float:
        """How much one eye is shut while the other stays open.

        The difference, not the sum: a blink closes both eyes and happens by
        itself fifteen times a minute, so it must never fire the gun. A wink is
        deliberate, and shows up here and nowhere else.

        The difference alone is not quite enough once the trigger is made
        sensitive: the two lids of a blink do not move in perfect step, and an
        uneven blink reads as a small, brief wink. So the difference is gated on
        the *open* eye actually being open - the one thing a blink never has.
        """
        difference = abs(self.blink_left - self.blink_right)
        more_open = min(self.blink_left, self.blink_right)
        openness = (self.OPEN_EYE - more_open) / self.OPEN_EYE_BAND
        return difference * min(max(openness, 0.0), 1.0)

    @property
    def closure(self) -> float:
        """Whether either lid is closed, independent of gaze or the other eye."""
        return max(self.blink_left, self.blink_right)

    def iris_offset(self) -> Point:
        """Where the irises sit inside their sockets, in eye-widths.

        Averaged over both eyes and measured in image coordinates, so the two
        contribute in the same direction.
        """
        offsets = []
        for corners, iris in ((LEFT_EYE_CORNERS, LEFT_IRIS),
                              (RIGHT_EYE_CORNERS, RIGHT_IRIS)):
            first, second = self.landmarks[corners[0]], self.landmarks[corners[1]]
            width = math.dist(first, second)
            if width <= 1e-6:
                continue
            centre = ((first[0] + second[0]) / 2, (first[1] + second[1]) / 2)
            offsets.append(((self.landmarks[iris][0] - centre[0]) / width,
                            (self.landmarks[iris][1] - centre[1]) / width))
        if not offsets:
            return (0.0, 0.0)
        return (sum(o[0] for o in offsets) / len(offsets),
                sum(o[1] for o in offsets) / len(offsets))

    def eye_direction(self) -> Point:
        """Where the eyes point within their sockets, one 2D quantity.

        Preferably the model's own trained estimate (the eyeLook blendshapes);
        the geometric iris offset stands in when blendshapes are missing.
        """
        if self.look is not None:
            return self.look
        horizontal, vertical = self.iris_offset()
        limit = MAX_IRIS_OFFSET
        return (min(max(horizontal, -limit), limit),
                min(max(vertical, -limit), limit))

    def gaze(self, weights: Point) -> Point:
        """Where the person is looking, as one 2D quantity.

        Looking somewhere is head plus eyes: you turn towards a target and then
        your eyes finish the job. Both are angles, so they add. How much the
        eyes contribute - per axis, because eyes sweep further sideways than up
        and down, and in which direction, which depends on conventions not worth
        guessing at - is settled by calibration, which tries a grid of weights
        and keeps whichever describes the person best.
        """
        horizontal, vertical = self.eye_direction()
        return (self.yaw + weights[0] * horizontal,
                self.pitch + weights[1] * vertical)


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


def _eye_look(categories) -> Point | None:
    """The trained eyeLook blendshapes folded into one direction, both eyes.

    Each eye reports how hard it looks in, out, up and down, 0..1. In image
    coordinates one eye's "out" is the other's "in", so the two are summed with
    their senses matched.

    Note that these names are ANATOMICAL - measured on the face, not on the
    picture. Covering the eye on the image's left raises ``eyeBlinkRight``,
    because that is the subject's right eye; and mirroring the frame leaves
    these values unchanged while it negates the head pose, which is measured in
    the image. So this quantity and the head yaw do not share a sign convention,
    and nothing here tries to reconcile them: calibration fits whatever comes
    out, per axis, and a fitted map is correctly oriented by construction.
    """
    if not categories:
        return None
    names = {category.category_name for category in categories}
    if not any(name.startswith("eyeLook") for name in names):
        return None
    left = {"in": _blendshape(categories, "eyeLookInLeft"),
            "out": _blendshape(categories, "eyeLookOutLeft"),
            "up": _blendshape(categories, "eyeLookUpLeft"),
            "down": _blendshape(categories, "eyeLookDownLeft")}
    right = {"in": _blendshape(categories, "eyeLookInRight"),
             "out": _blendshape(categories, "eyeLookOutRight"),
             "up": _blendshape(categories, "eyeLookUpRight"),
             "down": _blendshape(categories, "eyeLookDownRight")}
    horizontal = ((right["out"] + left["in"]) - (right["in"] + left["out"])) / 2.0
    vertical = ((left["down"] + right["down"]) - (left["up"] + right["up"])) / 2.0
    return (horizontal, vertical)


def _head_angles(matrix) -> tuple[float, float]:
    """Yaw and pitch of the head, from the facial transformation matrix.

    Both in image convention - yaw grows to the right, pitch grows DOWNWARD -
    so that they add to the eye direction, which is measured the same way, and
    so that the uncalibrated default map sends a downward look down the screen.
    MediaPipe's 3D space is Y-up, hence the sign on the pitch.
    """
    if matrix is None:
        return (0.0, 0.0)
    forward = np.asarray(matrix)[:3, 2]
    depth = float(forward[2])
    if abs(depth) < 1e-6:
        return (0.0, 0.0)
    return (math.atan2(float(forward[0]), depth),
            -math.atan2(float(forward[1]), depth))


def _to_frame(result, timestamp_ms: int) -> FaceFrame:
    faces = []
    for index, landmarks in enumerate(result.face_landmarks):
        blendshapes = (result.face_blendshapes[index]
                       if index < len(result.face_blendshapes) else ())
        matrixes = getattr(result, "facial_transformation_matrixes", None) or ()
        yaw, pitch = _head_angles(matrixes[index] if index < len(matrixes) else None)
        faces.append(Face(
            landmarks=tuple((point.x, point.y) for point in landmarks),
            blink_left=_blendshape(blendshapes, "eyeBlinkLeft"),
            blink_right=_blendshape(blendshapes, "eyeBlinkRight"),
            yaw=yaw, pitch=pitch, look=_eye_look(blendshapes)))
    return FaceFrame(faces=tuple(faces), timestamp_ms=timestamp_ms)


def _options(model_path: Path, running_mode, callback=None):
    return vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path)),
        running_mode=running_mode, num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
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
