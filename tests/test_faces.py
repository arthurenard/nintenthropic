import math
from pathlib import Path

import cv2
import pytest

from eyes import frame_of, make_face
from handy.faces import MAX_IRIS_OFFSET, FaceFrame, detect_image
from handy.schemes import GAZE

PORTRAIT = "tests/data/portrait.jpg"


# --- the geometry ----------------------------------------------------------

def test_iris_offset_is_measured_in_eye_widths():
    assert make_face(iris=(0.0, 0.0)).iris_offset() == pytest.approx((0.0, 0.0))
    assert make_face(iris=(0.25, -0.1)).iris_offset() == pytest.approx((0.25, -0.1))


def test_gaze_adds_the_head_and_the_eyes():
    face = make_face(iris=(0.2, 0.1), yaw=0.3, pitch=-0.2)
    assert face.gaze((0.0, 0.0)) == pytest.approx((0.3, -0.2)), "head alone"
    assert face.gaze((1.0, 1.0)) == pytest.approx((0.5, -0.1)), "head plus eyes"
    assert face.gaze((-1.0, -1.0)) == pytest.approx((0.1, -0.3)), "the other way"


def test_each_axis_has_its_own_weight():
    """Eyes sweep further sideways than up and down; one weight cannot fit both."""
    face = make_face(iris=(0.2, 0.1), yaw=0.0, pitch=0.0)
    assert face.gaze((1.0, 0.5)) == pytest.approx((0.2, 0.05))


def test_the_models_own_look_estimate_wins_over_the_geometry():
    """The blendshapes are trained to answer exactly this question."""
    from handy.faces import Face

    face = Face(landmarks=tuple((0.5, 0.5) for _ in range(478)),
                blink_left=0.1, blink_right=0.1, yaw=0.0, pitch=0.0,
                look=(0.4, -0.2))
    assert face.eye_direction() == (0.4, -0.2)
    assert face.gaze((1.0, 1.0)) == pytest.approx((0.4, -0.2))


def test_a_wild_iris_reading_cannot_swing_the_aim_across_the_room():
    wild = make_face(iris=(9.0, -9.0), yaw=0.0, pitch=0.0)
    horizontal, vertical = wild.gaze((1.0, 1.0))
    assert abs(horizontal) <= MAX_IRIS_OFFSET and abs(vertical) <= MAX_IRIS_OFFSET


def test_an_eyeless_face_does_not_divide_by_zero():
    from handy.faces import Face

    flat = Face(landmarks=tuple((0.5, 0.5) for _ in range(478)),
                blink_left=0.0, blink_right=0.0, yaw=0.1, pitch=0.2)
    assert flat.iris_offset() == (0.0, 0.0)
    assert flat.gaze((1.0, 1.0)) == pytest.approx((0.1, 0.2))


# --- the trigger -----------------------------------------------------------

def test_a_wink_is_one_eye_and_a_blink_is_both():
    """The distinction the whole scheme rests on: blinks must never fire."""
    assert make_face(blink=(0.9, 0.1)).wink == pytest.approx(0.8)
    assert make_face(blink=(0.1, 0.9)).wink == pytest.approx(0.8), "either eye"
    assert make_face(blink=(0.95, 0.95)).wink == pytest.approx(0.0), "a blink"
    assert make_face(blink=(0.05, 0.05)).wink == pytest.approx(0.0), "eyes open"


def test_a_natural_blink_never_reaches_the_trigger():
    from handy.calibration import Calibration

    calibration = Calibration(signal="wink", cocked=0.03, folded=0.70)
    blink = GAZE.measure("wink", make_face(blink=(0.88, 0.84)))
    wink = GAZE.measure("wink", make_face(blink=(0.90, 0.08)))

    assert calibration.travel(blink) < 0.35, "under the re-arm line, so it cannot fire"
    assert calibration.travel(wink) > 0.65


def test_the_scheme_reads_the_face_it_is_given():
    face = make_face(iris=(0.1, 0.0), yaw=0.2, blink=(0.7, 0.1))
    assert GAZE.pointer(face, (1.0, 1.0)) == pytest.approx(face.gaze((1.0, 1.0)))
    assert GAZE.measure("wink", face) == pytest.approx(0.6)
    assert GAZE.scale(face) > 0.0


# --- against the real model ------------------------------------------------

def test_a_real_photograph_gives_a_usable_reading(model_path):
    from handy.models import ensure_model

    frame = detect_image(cv2.imread(PORTRAIT), ensure_model("face_landmarker"))

    assert len(frame.faces) == 1
    face = frame.faces[0]
    assert len(face.landmarks) == 478
    assert abs(math.degrees(face.yaw)) < 25 and abs(math.degrees(face.pitch)) < 25
    horizontal, vertical = face.iris_offset()
    assert abs(horizontal) < 0.3 and abs(vertical) < 0.3
    assert face.wink < 0.2, "both eyes are open in the photograph"
    assert 0.02 < face.eye_span < 0.6
    assert face.look is not None, "the trained eyeLook estimate is populated"
    assert all(abs(value) < 1.0 for value in face.look)


def test_a_frame_with_nobody_in_it_is_simply_empty():
    assert FaceFrame().faces == () and FaceFrame().subjects == ()
    assert frame_of().subjects == ()


def test_the_pistol_stream_tracks_exactly_one_hand(monkeypatch):
    """Two tracked hands cost CPU and can give the crosshair to a bystander.

    Asserted on what the recogniser is actually opened with, not on the text of
    the lambda that opens it: the old version grepped the source for
    "max_hands=1", which a reformat breaks and a behavioural change survives.
    """
    from handy import recognition
    from handy.schemes import PISTOL

    seen = {}

    def create_from_options(options):
        seen["num_hands"] = options.num_hands
        return object()

    monkeypatch.setattr(recognition.vision.GestureRecognizer, "create_from_options",
                        staticmethod(create_from_options))
    PISTOL.open_stream(Path("unused.task"))

    assert seen["num_hands"] == 1


def test_the_face_stream_stamps_frames_that_always_increase(monkeypatch):
    """The same crash the gesture stream had: two detections inside one
    millisecond used to carry the same timestamp, and MediaPipe's live-stream
    mode raises ValueError on the second."""
    import numpy as np

    from handy import faces as faces_module

    stamps: list[int] = []

    class FakeLandmarker:
        def detect_async(self, _image, timestamp_ms: int) -> None:
            if stamps and timestamp_ms <= stamps[-1]:
                raise ValueError("Input timestamp must be monotonically increasing")
            stamps.append(timestamp_ms)

        def close(self) -> None:
            pass

    monkeypatch.setattr(faces_module.vision.FaceLandmarker, "create_from_options",
                        staticmethod(lambda options: FakeLandmarker()))
    monkeypatch.setattr(faces_module.time, "perf_counter", lambda: 7.0)

    with faces_module.FaceStream(Path("unused.task")) as stream:
        for _ in range(30):
            stream.submit(np.zeros((8, 8, 3), np.uint8))

    assert all(b > a for a, b in zip(stamps, stamps[1:]))


def test_pitch_grows_downward_so_the_default_map_sends_a_downward_look_down():
    """MediaPipe's 3D space is Y-up; image convention is y-down. The default
    (uncalibrated) map has no fit to absorb a sign, so the sign must be right."""
    import numpy as np

    from handy.calibration import default_calibration
    from handy.faces import _head_angles
    from handy.schemes import GAZE

    def facing(forward):
        matrix = np.eye(4)
        matrix[:3, 2] = forward
        return matrix

    _, looking_down = _head_angles(facing((0.0, -0.2, 0.98)))
    _, looking_up = _head_angles(facing((0.0, 0.2, 0.98)))
    assert looking_down > 0 > looking_up

    default = default_calibration(GAZE)
    assert default.to_play_area((0.0, looking_down))[1] > 0.5
    assert default.to_play_area((0.0, looking_up))[1] < 0.5
