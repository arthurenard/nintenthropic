import cv2
import numpy as np
import pytest

from handy import homography


def test_a_box_mapping_puts_its_corners_at_the_screen_corners():
    matrix = homography.box_mapping((0.2, 0.3), (0.8, 0.7))
    assert homography.apply(matrix, (0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert homography.apply(matrix, (0.8, 0.7)) == pytest.approx((1.0, 1.0))
    assert homography.apply(matrix, (0.5, 0.5)) == pytest.approx((0.5, 0.5))


def test_a_box_with_no_area_is_refused():
    with pytest.raises(ValueError):
        homography.box_mapping((0.5, 0.2), (0.5, 0.8))


# --- the fitters the shooting setup ships -----------------------------------

# An affine placement: rotated, sheared and offset, but no perspective.
AFFINE = (1.6, 0.4, -0.5,
          -0.3, 1.9, -0.4,
          0.0, 0.0, 1.0)
HAND = [(0.30, 0.35), (0.70, 0.40), (0.65, 0.70), (0.35, 0.65), (0.50, 0.52)]


def test_an_affine_fit_recovers_the_placement_it_was_traced_on():
    screen = [homography.apply(AFFINE, point) for point in HAND]
    assert homography.fit_affine(HAND, screen) == pytest.approx(AFFINE, abs=1e-9)
    # Three points determine it exactly, and OpenCV agrees.
    ours = np.asarray(homography.fit_affine(HAND[:3], screen[:3])).reshape(3, 3)
    theirs = cv2.getAffineTransform(np.float32(HAND[:3]), np.float32(screen[:3]))
    assert ours[:2] == pytest.approx(theirs, abs=1e-5)


def test_an_affine_fit_spreads_noise_rather_than_failing():
    rng = np.random.default_rng(5)
    screen = [homography.apply(AFFINE, point) for point in HAND]
    shaken = [tuple(np.add(point, rng.normal(0, 0.004, 2))) for point in HAND]
    matrix = homography.fit_affine(shaken, screen)
    assert matrix is not None and matrix[6:] == (0.0, 0.0, 1.0)
    assert homography.residual(matrix, shaken, screen) < 0.02


def test_a_camera_far_off_to_the_side_still_gets_an_affine_fit():
    """The conditioning gate is for numerical nonsense, not for placements: a
    side-on camera right at the fusion gain limit is still a real camera, and
    judging it is the gain gate's job."""
    targets = [(0.15, 0.22), (0.85, 0.62), (0.85, 0.22), (0.15, 0.62), (0.5, 0.38)]
    squeezed = [(0.5 + 0.05 * x, 0.3 + 0.4 * y) for x, y in targets]
    matrix = homography.fit_affine(squeezed, targets)
    assert matrix is not None
    assert homography.gain(matrix, (0.5, 0.5)) == pytest.approx(20.0)


def test_an_affine_fit_refuses_what_cannot_determine_it():
    screen = [homography.apply(AFFINE, point) for point in HAND]
    assert homography.fit_affine(HAND[:2], screen[:2]) is None  # too few
    assert homography.fit_affine(HAND, screen[:4]) is None  # mismatched
    assert homography.fit_affine([(0.5, 0.5)] * 3, screen[:3]) is None  # one point
    line = [(0.3, 0.3), (0.5, 0.5), (0.7, 0.7)]
    assert homography.fit_affine(line, screen[:3]) is None  # collinear
    assert homography.fit_affine([(float("nan"), 0.5)] + HAND[1:], screen) is None


def test_an_affine_fit_refuses_points_a_hair_off_a_line():
    """Least squares on points 1e-9 off a line finds a unique answer - with a
    gain of 4.5e8. Rank said three; the conditioning says nonsense."""
    screen = [(0.15, 0.22), (0.85, 0.62), (0.85, 0.22)]
    for offset in (1e-4, 1e-6, 1e-9):
        nearly = [(0.3, 0.4), (0.7, 0.6), (0.5, 0.5 + offset)]
        assert homography.fit_affine(nearly, screen) is None, offset
    # While a triangle with some body to it is fitted.
    assert homography.fit_affine([(0.3, 0.4), (0.7, 0.6), (0.5, 0.6)], screen)


def test_a_scaled_fit_recovers_each_axis_including_a_reversed_one():
    """Four numbers: a scale and an offset per axis. Fitted to what the player
    actually did, so an axis that runs backwards comes out backwards too."""
    truth = (2.0, 0.0, -0.5, 0.0, -1.5, 1.25, 0.0, 0.0, 1.0)
    screen = [homography.apply(truth, point) for point in HAND]
    assert homography.fit_scaled(HAND, screen) == pytest.approx(truth, abs=1e-9)
    # Two points already determine it.
    assert homography.fit_scaled(HAND[:2], screen[:2]) == pytest.approx(truth, abs=1e-9)


def test_a_scaled_fit_refuses_a_signal_that_never_moved():
    screen = [(0.15, 0.22), (0.85, 0.62), (0.85, 0.22)]
    assert homography.fit_scaled([(0.5, 0.4), (0.5, 0.6), (0.5, 0.5)], screen) is None
    assert homography.fit_scaled([(0.3, 0.5), (0.7, 0.5), (0.5, 0.5)], screen) is None
    # Nor does it learn from a target that did not move with the signal.
    assert homography.fit_scaled([(0.3, 0.3), (0.7, 0.7)],
                                 [(0.5, 0.2), (0.5, 0.8)]) is None


def test_a_scaled_fit_refuses_what_cannot_determine_it():
    assert homography.fit_scaled([(0.3, 0.3)], [(0.1, 0.1)]) is None  # one point
    assert homography.fit_scaled(HAND, HAND[:3]) is None  # mismatched
    assert homography.fit_scaled([(0.3, float("inf")), (0.7, 0.7)],
                                 [(0.1, 0.1), (0.9, 0.9)]) is None


def test_a_point_on_or_past_the_horizon_has_no_image():
    """On the horizon the old code answered the centre of the screen; a hair
    past it, the far side of the screen, mirrored. Neither is where the hand is."""
    # A transform whose weight goes to zero along x = 0.5, positive beyond it.
    matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -0.5)
    assert homography.apply(matrix, (0.5, 0.2)) is None
    assert homography.apply(matrix, (0.5 - 1e-11, 0.2)) is None
    assert homography.apply(matrix, (0.4, 0.2)) is None
    assert homography.apply(matrix, (0.6, 0.2)) == pytest.approx((6.0, 2.0))
    assert homography.gain(matrix, (0.4, 0.2)) == float("inf")


# The map an old pose calibration saved on the player's own machine. Its
# horizon crosses the camera frame at x = 0.82 along the top edge.
LEGACY = (2.871934573670249, -0.061145355513888985, -1.2142552975804075,
          -0.9041251222717106, 2.3601729633571686, -0.8949543501390803,
          -1.2131671258909114, 0.4386268157484197, 1.0)


def test_a_fingertip_past_the_horizon_is_not_thrown_to_the_opposite_corner():
    """A quarter of the frame past the screen edge the crosshair used to flip
    from the top-right corner to the bottom-left: the weight changes sign and
    both coordinates with it."""
    before = homography.apply(LEGACY, (0.895, 0.2))
    assert before[0] > 1.0 and before[1] < 0.0, "off the top right, as it should be"
    assert homography.apply(LEGACY, (0.899, 0.2)) is None
    assert homography.apply(LEGACY, (0.95, 0.2)) is None


def test_whether_a_map_is_defined_across_a_whole_box():
    frame = ((0.0, 0.0), (1.0, 1.0))
    assert homography.defined_over(homography.box_mapping((0, 0), (1, 1)), *frame)
    assert homography.defined_over(AFFINE, *frame), "an affine map has no horizon"
    assert not homography.defined_over(LEGACY, *frame), "its horizon is in view"
    assert homography.defined_over(LEGACY, (0.2, 0.2), (0.7, 0.8))
    assert not homography.defined_over((float("nan"),) * 9, *frame)


def test_a_residual_counts_a_point_it_cannot_place_as_infinitely_wrong():
    matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -0.5)
    assert homography.residual(matrix, [(0.4, 0.2)], [(0.4, 0.2)]) == float("inf")


def test_a_residual_without_points_is_zero():
    assert homography.residual(homography.box_mapping((0, 0), (1, 1)), [], []) == 0.0
