import cv2
import numpy as np
import pytest

from handy import homography

# What an off-axis camera sees when the player traces the four screen corners:
# rotated, sheared, and with the far side foreshortened.
SKEWED = [(0.30, 0.42), (0.62, 0.36), (0.68, 0.66), (0.34, 0.72)]
CORNERS = [(0.08, 0.08), (0.92, 0.08), (0.92, 0.92), (0.08, 0.92)]


def test_a_box_mapping_puts_its_corners_at_the_screen_corners():
    matrix = homography.box_mapping((0.2, 0.3), (0.8, 0.7))
    assert homography.apply(matrix, (0.2, 0.3)) == pytest.approx((0.0, 0.0))
    assert homography.apply(matrix, (0.8, 0.7)) == pytest.approx((1.0, 1.0))
    assert homography.apply(matrix, (0.5, 0.5)) == pytest.approx((0.5, 0.5))


def test_a_box_with_no_area_is_refused():
    with pytest.raises(ValueError):
        homography.box_mapping((0.5, 0.2), (0.5, 0.8))


def test_the_fit_reproduces_its_own_calibration_points():
    matrix = homography.fit(SKEWED, CORNERS)
    assert matrix is not None
    for source, target in zip(SKEWED, CORNERS):
        assert homography.apply(matrix, source) == pytest.approx(target, abs=1e-6)
    assert homography.residual(matrix, SKEWED, CORNERS) == pytest.approx(0.0, abs=1e-6)


def test_it_agrees_with_opencv():
    """Cross-check the hand-rolled DLT against a trusted implementation."""
    ours = np.asarray(homography.fit(SKEWED, CORNERS)).reshape(3, 3)
    theirs = cv2.getPerspectiveTransform(np.float32(SKEWED), np.float32(CORNERS))
    assert ours == pytest.approx(theirs / theirs[2, 2], abs=1e-6)


def test_extra_points_are_averaged_rather_than_rejected():
    source = SKEWED + [(0.49, 0.54)]
    destination = CORNERS + [(0.5, 0.5)]
    matrix = homography.fit(source, destination)

    assert matrix is not None
    # A least-squares fit spreads the small inconsistency instead of failing.
    assert homography.residual(matrix, source, destination) < 0.02


def test_noise_in_the_samples_barely_moves_a_nine_point_fit():
    rng = np.random.default_rng(3)
    truth = homography.fit(SKEWED, CORNERS)
    grid = [(x, y) for y in (0.08, 0.5, 0.92) for x in (0.08, 0.5, 0.92)]
    # Invert the picture: where would the hand be for each screen point?
    inverse = np.linalg.inv(np.asarray(truth).reshape(3, 3))
    observed = []
    for point in grid:
        homogeneous = inverse @ np.array([*point, 1.0])
        exact = homogeneous[:2] / homogeneous[2]
        observed.append(tuple(exact + rng.normal(0, 0.004, 2)))

    fitted = homography.fit(observed, grid)
    assert homography.residual(fitted, observed, grid) < 0.02


def test_degenerate_point_sets_are_refused():
    assert homography.fit([(0, 0), (1, 1), (2, 2), (3, 3)], CORNERS) is None  # collinear
    assert homography.fit([(0.5, 0.5)] * 4, CORNERS) is None  # all the same point
    assert homography.fit(SKEWED[:3], CORNERS[:3]) is None  # too few
    assert homography.fit(SKEWED, CORNERS[:3]) is None  # mismatched
    assert homography.fit([], []) is None


def test_a_point_on_the_horizon_does_not_blow_up():
    # A transform whose weight goes to zero somewhere in the plane.
    matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -0.5)
    assert homography.apply(matrix, (0.5, 0.2)) == (0.5, 0.5)


def test_a_residual_without_points_is_zero():
    assert homography.residual(homography.box_mapping((0, 0), (1, 1)), [], []) == 0.0
