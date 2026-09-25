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


def test_the_face_stream_waits_for_the_frame_it_was_given(monkeypatch):
    """The sniper's scope reads the face from the same frame the hand aims from."""
    import threading
    import time
    from types import SimpleNamespace

    import numpy as np

    from handy import faces as faces_module

    made = []

    class Answering:
        def __init__(self, options):
            self.answer = options.result_callback

        def detect_async(self, _image, timestamp_ms: int) -> None:
            empty = SimpleNamespace(face_landmarks=[], face_blendshapes=[])
            threading.Timer(0.05, self.answer, (empty, None, timestamp_ms)).start()

        def close(self) -> None:
            pass

    monkeypatch.setattr(faces_module.vision.FaceLandmarker, "create_from_options",
                        staticmethod(lambda options: made.append(Answering(options))
                                     or made[-1]))
    stream = faces_module.FaceStream(Path("unused.task"))
    stamp = stream.submit(np.zeros((8, 8, 3), np.uint8))
    assert stream.wait(stamp, 5).timestamp_ms == stamp
    # Never answered: closing releases the waiter instead of leaving it blocked.
    monkeypatch.setattr(made[0], "detect_async", lambda *_args: None)
    silent = stream.submit(np.zeros((8, 8, 3), np.uint8))
    threading.Timer(0.05, stream.close).start()
    began = time.monotonic()
    assert stream.wait(silent, 30).timestamp_ms == stamp
    assert time.monotonic() - began < 5


def test_the_marksman_waits_for_hand_and_face_within_one_deadline():
    """Both recognisers work on the frame at once: the wait is the slower of
    the two, and never the timeout twice over."""
    import time

    from eyes import make_face
    from hands import frame_of, make_hand
    from handy.marksman import MarksmanStream

    class Slow:
        def __init__(self, frame, delay):
            self.frame, self.delay, self.asked = frame, delay, []

        def submit(self, _image):
            return self.frame.timestamp_ms

        def wait(self, stamp, timeout):
            self.asked.append((stamp, timeout))
            time.sleep(min(self.delay, max(timeout, 0)))
            return self.frame

        def latest(self):
            return self.frame

    from dataclasses import replace

    stream = MarksmanStream.__new__(MarksmanStream)
    hand, face = make_hand(), make_face()
    stream._hands = Slow(replace(frame_of(hand), timestamp_ms=7), 0.08)
    stream._faces = Slow(FaceFrame(faces=(face,), timestamp_ms=9), 0.5)
    ticket = stream.submit(None)
    assert ticket == (7, 9)
    began = time.monotonic()
    frame = stream.wait(ticket, 0.2)
    assert time.monotonic() - began < 0.35
    assert stream._hands.asked[0] == (7, 0.2)
    face_stamp, face_timeout = stream._faces.asked[0]
    assert face_stamp == 9 and face_timeout <= 0.2 - 0.07
    assert frame.subjects[0].hand is hand
