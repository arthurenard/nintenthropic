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


class _Answering:
    """A stand-in live-stream recogniser that answers only when told to."""

    def __init__(self, options):
        self.answer = options.result_callback
        self.stamps: list[int] = []

    def recognize_async(self, _image, timestamp_ms: int) -> None:
        self.stamps.append(timestamp_ms)

    def reply(self, timestamp_ms: int) -> None:
        from types import SimpleNamespace

        empty = SimpleNamespace(hand_landmarks=[], handedness=[], gestures=[])
        self.answer(empty, None, timestamp_ms)

    def close(self) -> None:
        pass


def _answering_stream(monkeypatch):
    from handy import recognition

    made = []
    monkeypatch.setattr(recognition.vision.GestureRecognizer, "create_from_options",
                        staticmethod(lambda options: made.append(_Answering(options))
                                     or made[-1]))
    return recognition.GestureStream(Path("unused.task")), made


def test_waiting_returns_the_submitted_frames_own_answer(monkeypatch):
    """Reading right after submitting got the previous frame's answer, so the
    crosshair ran a whole camera frame behind the hand."""
    import threading
    import time

    import numpy as np

    stream, (recognizer,) = _answering_stream(monkeypatch)
    first = stream.submit(np.zeros((8, 8, 3), np.uint8))
    recognizer.reply(first)
    second = stream.submit(np.zeros((8, 8, 3), np.uint8))
    assert recognizer.stamps == [first, second] and second > first
    assert stream.latest().timestamp_ms == first  # not answered yet
    threading.Timer(0.05, recognizer.reply, (second,)).start()
    began = time.monotonic()
    assert stream.wait(second, 5).timestamp_ms == second
    assert time.monotonic() - began < 2, "returns on the answer, not the timeout"
    stream.close()


def test_a_frame_never_answered_costs_only_the_timeout(monkeypatch):
    """MediaPipe drops frames when it is busy, and never answers those."""
    import time

    import numpy as np

    stream, (recognizer,) = _answering_stream(monkeypatch)
    answered = stream.submit(np.zeros((8, 8, 3), np.uint8))
    recognizer.reply(answered)
    dropped = stream.submit(np.zeros((8, 8, 3), np.uint8))
    began = time.monotonic()
    frame = stream.wait(dropped, 0.05)
    assert 0.04 < time.monotonic() - began < 1
    assert frame.timestamp_ms == answered  # the newest reading stands in
    stream.close()


def test_a_later_answer_satisfies_a_wait_for_an_earlier_frame(monkeypatch):
    import numpy as np

    stream, (recognizer,) = _answering_stream(monkeypatch)
    early = stream.submit(np.zeros((8, 8, 3), np.uint8))
    late = stream.submit(np.zeros((8, 8, 3), np.uint8))
    recognizer.reply(late)  # the early one was dropped
    assert stream.wait(early, 5).timestamp_ms == late


def test_closing_releases_a_waiter_at_once(monkeypatch):
    """A game closed mid-frame - by another tab, or Ctrl+C - must not leave the
    frame waiting out its timeout, or hang if the timeout were long."""
    import threading
    import time

    import numpy as np

    stream, _ = _answering_stream(monkeypatch)
    stamp = stream.submit(np.zeros((8, 8, 3), np.uint8))
    returned = []
    waiter = threading.Thread(target=lambda: returned.append(stream.wait(stamp, 30)))
    waiter.start()
    time.sleep(0.05)
    began = time.monotonic()
    stream.close()
    waiter.join(5)
    assert not waiter.is_alive() and time.monotonic() - began < 2
    assert returned == [stream.latest()]
    began = time.monotonic()
    stream.wait(stamp + 1, 30)  # and a wait after closing does not block
    assert time.monotonic() - began < 2
