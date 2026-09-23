from pathlib import Path

import cv2

from eyes import frame_of, make_face
from handy.faces import FaceFrame, detect_image

PORTRAIT = "tests/data/portrait.jpg"


# --- against the real model ------------------------------------------------

def test_a_real_photograph_gives_a_usable_reading(model_path):
    from handy.aiming import EyeScope
    from handy.models import ensure_model

    frame = detect_image(cv2.imread(PORTRAIT), ensure_model("face_landmarker"))

    assert len(frame.faces) == 1
    face = frame.faces[0]
    assert len(face.landmarks) == 478
    assert face.closure < EyeScope().enter_above, "both eyes are open: no scope"


def test_closure_is_whichever_lid_is_more_shut():
    assert make_face(blink=(0.9, 0.1)).closure == 0.9
    assert make_face(blink=(0.1, 0.8)).closure == 0.8, "either eye"


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
