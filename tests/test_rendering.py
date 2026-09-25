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


def test_the_skeleton_is_white_whichever_hand_it_is():
    """Drawn in white with soft round joints, not in debug colours: which hand
    it is only ever mattered to the debug captions."""
    left, right = (np.zeros((480, 640, 3), np.uint8) for _ in range(2))
    draw_hands(left, Frame(hands=(make_hand(handedness="Left"),)), show_captions=False)
    draw_hands(right, Frame(hands=(make_hand(handedness="Right"),)), show_captions=False)
    assert np.array_equal(left, right)
    ink = left[left.max(axis=2) > 0]
    assert (ink[:, 0] == ink[:, 1]).all() and (ink[:, 1] == ink[:, 2]).all(), "grey"
    assert ink.max() == 255


def test_the_skeleton_keeps_a_shadow_so_it_reads_on_a_pale_picture():
    image = np.full((480, 640, 3), 235, np.uint8)
    draw_hands(image, Frame(hands=(make_hand(),)), show_captions=False)
    assert image.min() < 200, "a white skeleton on a white wall needs its shadow"


def test_an_empty_frame_draws_nothing():
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    draw_hands(image, Frame())
    assert not image.any()
