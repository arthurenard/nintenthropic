import cv2
import numpy as np
import pytest

from handy import homography

CORNERS = [(0.08, 0.08), (0.92, 0.08), (0.92, 0.92), (0.08, 0.92)]
# What a camera off to the side sees when the player points at the four screen
# corners: rotated and sheared - the part of an off-axis view an affine map
# can express.
SKEW = np.array([[0.40, 0.12, 0.26], [-0.08, 0.36, 0.40]])
SKEWED = [tuple(SKEW @ np.array([x, y, 1.0])) for x, y in CORNERS]


def test_a_box_mapping_puts_its_corners_at_the_screen_corners():
    matrix = homography.box_mapping((0.2, 0.3), (0.8, 0.7))
    assert homography.apply(matrix, (0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert homography.apply(matrix, (0.8, 0.7)) == pytest.approx((1.0, 1.0))
    assert homography.apply(matrix, (0.5, 0.5)) == pytest.approx((0.5, 0.5))


def test_a_box_with_no_area_is_refused():
    with pytest.raises(ValueError):
        homography.box_mapping((0.5, 0.2), (0.5, 0.8))


def test_the_affine_fit_reproduces_its_own_points():
    matrix = homography.fit_affine(SKEWED, CORNERS)
    assert matrix is not None
    for source, target in zip(SKEWED, CORNERS):
        assert homography.apply(matrix, source) == pytest.approx(target, abs=1e-6)
    assert homography.residual(matrix, SKEWED, CORNERS) == pytest.approx(0.0, abs=1e-6)


def test_the_affine_fit_agrees_with_opencv():
    """Cross-check the least-squares fit against a trusted implementation."""
    ours = np.asarray(homography.fit_affine(SKEWED[:3], CORNERS[:3])).reshape(3, 3)
    theirs = cv2.getAffineTransform(np.float32(SKEWED[:3]), np.float32(CORNERS[:3]))
    assert ours[:2] == pytest.approx(theirs, abs=1e-5)


def test_extra_points_are_averaged_rather_than_rejected():
    source = SKEWED + [tuple(SKEW @ np.array([0.5, 0.5, 1.0]) + 0.01)]
    destination = CORNERS + [(0.5, 0.5)]
    matrix = homography.fit_affine(source, destination)

    assert matrix is not None
    # A least-squares fit spreads the small inconsistency instead of failing.
    assert homography.residual(matrix, source, destination) < 0.02


def test_degenerate_point_sets_are_refused():
    fit = homography.fit_affine
    assert fit([(0, 0), (1, 1), (2, 2), (3, 3)], CORNERS) is None  # collinear
    assert fit([(0.5, 0.5)] * 4, CORNERS) is None  # all the same point
    assert fit(SKEWED[:2], CORNERS[:2]) is None  # too few
    assert fit(SKEWED, CORNERS[:3]) is None  # mismatched
    assert fit([], []) is None


def test_the_scaled_fit_keeps_each_axis_the_right_way_round():
    source = [(0.3, 0.6), (0.7, 0.2)]  # the hand's y runs against the screen's
    matrix = homography.fit_scaled(source, [(0.1, 0.1), (0.9, 0.9)])
    assert matrix is not None
    assert homography.apply(matrix, (0.3, 0.6)) == pytest.approx((0.1, 0.1))
    assert homography.apply(matrix, (0.7, 0.2)) == pytest.approx((0.9, 0.9))


def test_the_scaled_fit_needs_the_hand_to_move_on_both_axes():
    assert homography.fit_scaled([(0.3, 0.5), (0.7, 0.5)],
                                 [(0.1, 0.1), (0.9, 0.9)]) is None
    assert homography.fit_scaled([(0.3, 0.5)], [(0.1, 0.1)]) is None


def test_a_point_on_the_horizon_does_not_blow_up():
    # A transform whose weight goes to zero somewhere in the plane.
    matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -0.5)
    assert homography.apply(matrix, (0.5, 0.2)) == (0.5, 0.5)


def test_a_residual_without_points_is_zero():
    assert homography.residual(homography.box_mapping((0, 0), (1, 1)), [], []) == 0.0
