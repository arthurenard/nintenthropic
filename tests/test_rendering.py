import numpy as np

from handy.recognition import Frame, Hand
from handy.rendering import caption, draw_hands


def make_hand(**overrides) -> Hand:
    defaults = dict(
        landmarks=tuple((0.4 + 0.01 * i, 0.4 + 0.01 * i) for i in range(21)),
        handedness="Right",
        gesture="Thumb_Up",
        score=0.93,
    )
    return Hand(**{**defaults, **overrides})


def test_caption_formats_gesture_name():
    assert caption(make_hand()) == "Right: Thumb Up 0.93"


def test_caption_without_recognised_gesture():
    assert caption(make_hand(gesture=None, handedness="Left")) == "Left: hand"


def test_hands_are_drawn_on_the_frame():
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    draw_hands(image, Frame(hands=(make_hand(),)))
    assert image.any(), "the skeleton should paint something"


def test_left_and_right_hands_are_told_apart_by_colour():
    left, right = (np.zeros((480, 640, 3), np.uint8) for _ in range(2))
    draw_hands(left, Frame(hands=(make_hand(handedness="Left"),)), show_captions=False)
    draw_hands(right, Frame(hands=(make_hand(handedness="Right"),)), show_captions=False)
    assert not np.array_equal(left, right)


def test_an_empty_frame_draws_nothing():
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    draw_hands(image, Frame())
    assert not image.any()
