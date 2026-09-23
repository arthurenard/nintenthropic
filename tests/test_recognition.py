from pathlib import Path

import cv2

from handy.recognition import recognize_image

SAMPLE = Path(__file__).parent / "data" / "thumbs_down.jpg"


def test_recognizes_a_thumbs_down(model_path: Path):
    frame = recognize_image(cv2.imread(str(SAMPLE)), model_path)

    assert len(frame.hands) == 1
    hand = frame.hands[0]
    assert hand.gesture == "Thumb_Down"
    assert hand.score > 0.5
    assert hand.handedness in {"Left", "Right"}
    assert len(hand.landmarks) == 21
    assert all(0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 for x, y in hand.landmarks)


def test_two_submits_in_the_same_millisecond_still_advance(monkeypatch):
    """MediaPipe's live-stream mode rejects a timestamp that does not increase.

    The stamps used to be `int(elapsed * 1000)`, so any two frames inside the
    same millisecond carried the same one and the second raised ValueError -
    which `cli.main` catches and turns into the player losing the round to
    "Input timestamp must be monotonically increasing." The game loop was slow
    enough to hide it; one renderer optimisation is all it took to find it.
    """
    import numpy as np

    from handy import recognition

    stamps: list[int] = []

    class FakeRecognizer:
        def recognize_async(self, _image, timestamp_ms: int) -> None:
            if stamps and timestamp_ms <= stamps[-1]:
                raise ValueError("Input timestamp must be monotonically increasing")
            stamps.append(timestamp_ms)

        def close(self) -> None:
            pass

    monkeypatch.setattr(recognition.vision.GestureRecognizer,
                        "create_from_options",
                        staticmethod(lambda options: FakeRecognizer()))
    # A clock that never moves is the worst case, and the one a fast loop
    # approaches: every frame lands in the same millisecond.
    monkeypatch.setattr(recognition.time, "perf_counter", lambda: 12.0)

    with recognition.GestureStream(Path("unused.task")) as stream:
        for _ in range(50):
            stream.submit(np.zeros((8, 8, 3), np.uint8))

    assert len(stamps) == 50
    assert all(b > a for a, b in zip(stamps, stamps[1:]))


def test_a_frame_after_a_long_pause_keeps_the_wall_clock(monkeypatch):
    """The counter is a floor, not a replacement: a stream that idles for a
    second must not spend the next second catching its stamps up."""
    import numpy as np

    from handy import recognition

    stamps: list[int] = []

    class FakeRecognizer:
        def recognize_async(self, _image, timestamp_ms: int) -> None:
            stamps.append(timestamp_ms)

        def close(self) -> None:
            pass

    monkeypatch.setattr(recognition.vision.GestureRecognizer,
                        "create_from_options",
                        staticmethod(lambda options: FakeRecognizer()))
    clock = [100.0]
    monkeypatch.setattr(recognition.time, "perf_counter", lambda: clock[0])

    with recognition.GestureStream(Path("unused.task")) as stream:
        stream.submit(np.zeros((8, 8, 3), np.uint8))  # t=0
        stream.submit(np.zeros((8, 8, 3), np.uint8))  # same ms: nudged to 1
        clock[0] += 2.0
        stream.submit(np.zeros((8, 8, 3), np.uint8))

    assert stamps == [0, 1, 2000]
