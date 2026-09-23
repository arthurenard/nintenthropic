"""Fitting the projective map from hand space to screen space.

Where the camera sits relative to the screen changes the shape of that map. A
webcam above a laptop screen sees a very different sweep from one off to the side
of an external monitor: the hand plane is rotated, sheared and foreshortened
against the screen plane. An axis-aligned box cannot express any of that, but a
homography - the general projective transform between two planes - expresses all
of it, and costs four calibration points instead of two.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

Point = tuple[float, float]
Matrix = tuple[float, ...]  # 9 numbers, row-major 3x3

IDENTITY: Matrix = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)

#: Fewer correspondences than this cannot determine a homography.
MIN_POINTS = 4


def box_mapping(low: Point, high: Point) -> Matrix:
    """The plain axis-aligned map, as a homography: ``low`` to 0, ``high`` to 1."""
    width, height = high[0] - low[0], high[1] - low[1]
    if width <= 0 or height <= 0:
        raise ValueError("the box must have a positive width and height")
    return (1 / width, 0.0, -low[0] / width,
            0.0, 1 / height, -low[1] / height,
            0.0, 0.0, 1.0)


def apply(matrix: Matrix, point: Point) -> Point:
    """Map one point through ``matrix``, dividing out the projective weight."""
    x, y = point
    weight = matrix[6] * x + matrix[7] * y + matrix[8]
    if abs(weight) < 1e-12:
        # The point sits on the horizon of this transform: no finite image.
        return (0.5, 0.5)
    return ((matrix[0] * x + matrix[1] * y + matrix[2]) / weight,
            (matrix[3] * x + matrix[4] * y + matrix[5]) / weight)


def _conditioning(points: np.ndarray) -> np.ndarray:
    """Hartley normalisation: centre on the origin, scale to a mean radius of sqrt(2).

    The direct linear transform is badly conditioned on raw coordinates; this is
    the standard remedy and costs two matrix multiplies.
    """
    centre = points.mean(axis=0)
    spread = np.sqrt(((points - centre) ** 2).sum(axis=1)).mean()
    scale = np.sqrt(2) / spread if spread > 1e-12 else 1.0
    return np.array([[scale, 0.0, -scale * centre[0]],
                     [0.0, scale, -scale * centre[1]],
                     [0.0, 0.0, 1.0]])


def fit(source: Sequence[Point], destination: Sequence[Point]) -> Matrix | None:
    """Least-squares homography taking ``source`` onto ``destination``.

    Returns None when the correspondences cannot determine one - too few points,
    or points that are collinear or coincident.
    """
    if len(source) != len(destination) or len(source) < MIN_POINTS:
        return None

    src = np.asarray(source, dtype=float)
    dst = np.asarray(destination, dtype=float)
    if not (np.all(np.isfinite(src)) and np.all(np.isfinite(dst))):
        return None

    normalise_src, normalise_dst = _conditioning(src), _conditioning(dst)
    src_n = (normalise_src @ np.hstack([src, np.ones((len(src), 1))]).T).T
    dst_n = (normalise_dst @ np.hstack([dst, np.ones((len(dst), 1))]).T).T

    rows = []
    for (x, y, _), (u, v, _) in zip(src_n, dst_n):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])

    try:
        _, singular, vectors = np.linalg.svd(np.asarray(rows))
    except np.linalg.LinAlgError:
        return None
    # A near-zero second-smallest singular value means the solution is not unique,
    # which is what degenerate point sets look like.
    if singular[-2] < 1e-9:
        return None

    matrix = vectors[-1].reshape(3, 3)
    matrix = np.linalg.inv(normalise_dst) @ matrix @ normalise_src
    if abs(matrix[2, 2]) < 1e-12 or not np.all(np.isfinite(matrix)):
        return None
    matrix = matrix / matrix[2, 2]
    if abs(np.linalg.det(matrix)) < 1e-12:
        return None
    return tuple(float(value) for value in matrix.reshape(9))


def gain(matrix: Matrix, point: Point) -> float:
    """The most a small movement here can be magnified by the map.

    The largest singular value of the local Jacobian, not the square root of its
    determinant: a nearly side-on camera has a map that is enormously stretched
    in one direction and squashed in the other, and the determinant - a
    geometric mean - hides exactly that. Worst-case amplification is what decides
    how much a camera's opinion is worth, and when to stop listening to it.
    """
    x, y = point
    weight = matrix[6] * x + matrix[7] * y + matrix[8]
    if abs(weight) < 1e-12:
        return float("inf")
    u, v = apply(matrix, point)
    a = (matrix[0] - u * matrix[6]) / weight
    b = (matrix[1] - u * matrix[7]) / weight
    c = (matrix[3] - v * matrix[6]) / weight
    d = (matrix[4] - v * matrix[7]) / weight

    # Largest singular value of [[a, b], [c, d]], in closed form.
    total = a * a + b * b + c * c + d * d
    difference = math.hypot(a * a + b * b - c * c - d * d, 2 * (a * c + b * d))
    return math.sqrt(max(total + difference, 0.0) / 2.0)


MIN_AFFINE_POINTS = 3
MIN_SCALED_POINTS = 2

#: A slope flatter than this means the signal did not move with the target at
#: all, so nothing can be learned about which way round it goes.
MIN_SLOPE = 1e-6


def fit_scaled(source: Sequence[Point], destination: Sequence[Point]) -> Matrix | None:
    """Independent scale and offset on each axis: four parameters.

    The humblest map that can still be wrong-way-round, and therefore the one
    that matters most. It needs only that the signal moved *with* the target,
    not that it moved cleanly - so it survives noise that defeats the richer
    models, and whatever it fits comes out correctly oriented because it was
    fitted to what the player actually did.
    """
    if len(source) != len(destination) or len(source) < MIN_SCALED_POINTS:
        return None
    src = np.asarray(source, dtype=float)
    dst = np.asarray(destination, dtype=float)
    if not (np.all(np.isfinite(src)) and np.all(np.isfinite(dst))):
        return None

    slopes, offsets = [], []
    for axis in (0, 1):
        spread = src[:, axis] - src[:, axis].mean()
        variance = float(spread @ spread)
        if variance < MIN_SLOPE:
            return None  # the signal never moved on this axis
        slope = float(spread @ (dst[:, axis] - dst[:, axis].mean())) / variance
        if abs(slope) < MIN_SLOPE:
            return None
        slopes.append(slope)
        offsets.append(float(dst[:, axis].mean() - slope * src[:, axis].mean()))

    return (slopes[0], 0.0, offsets[0],
            0.0, slopes[1], offsets[1],
            0.0, 0.0, 1.0)


def fit_affine(source: Sequence[Point], destination: Sequence[Point]) -> Matrix | None:
    """Least-squares affine map taking ``source`` onto ``destination``.

    Six degrees of freedom instead of the homography's eight. On the handful of
    noisy points setup collects, the two projective parameters do nothing but
    chase noise: they buy a tighter training fit and a wilder map everywhere
    else.
    """
    if len(source) != len(destination) or len(source) < MIN_AFFINE_POINTS:
        return None
    src = np.asarray(source, dtype=float)
    dst = np.asarray(destination, dtype=float)
    if not (np.all(np.isfinite(src)) and np.all(np.isfinite(dst))):
        return None

    ones = np.ones((len(src), 1))
    design = np.hstack([src, ones])
    try:
        coefficients, _, rank, _ = np.linalg.lstsq(design, dst, rcond=None)
    except np.linalg.LinAlgError:
        return None
    if rank < 3:
        return None  # collinear or coincident points
    (a, c), (b, d), (tx, ty) = coefficients
    matrix = (float(a), float(b), float(tx),
              float(c), float(d), float(ty),
              0.0, 0.0, 1.0)
    if abs(a * d - b * c) < 1e-12:
        return None
    return matrix


def residual(matrix: Matrix, source: Sequence[Point],
             destination: Sequence[Point]) -> float:
    """Mean distance between where points land and where they should, 0..1 of screen."""
    if not source:
        return 0.0
    errors = [np.hypot(*(np.subtract(apply(matrix, point), target)))
              for point, target in zip(source, destination)]
    return float(np.mean(errors))
