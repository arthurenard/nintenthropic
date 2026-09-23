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


def test_points_a_hair_off_a_line_are_as_degenerate_as_points_on_it():
    """Only exactly collinear points were refused. A billionth off the line,
    the fit went through and came back magnifying movement 450 million times."""
    for offset in (1e-4, 1e-6, 1e-9):
        nearly = [(0.3, 0.3), (0.5, 0.5 + offset), (0.7, 0.7), (0.3, 0.7)]
        assert homography.fit(nearly, CORNERS) is None, offset


# --- the humbler fitters the shooting setup actually ships -----------------

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


def test_a_point_on_the_horizon_does_not_blow_up():
    # A transform whose weight goes to zero somewhere in the plane.
    matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, -0.5)
    assert homography.apply(matrix, (0.5, 0.2)) == (0.5, 0.5)


def test_a_residual_without_points_is_zero():
    assert homography.residual(homography.IDENTITY, [], []) == 0.0
