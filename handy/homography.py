"""The map from hand space to screen space, and fitting it.

Where the camera sits relative to the screen changes the shape of that map. A
webcam above a laptop screen sees a very different sweep from one off to the side
of an external monitor: the hand plane is rotated, sheared and foreshortened
against the screen plane. An axis-aligned box cannot express that; an affine map
covers the rotation and shear, which is what setup fits from the shots the
player takes. Every map is kept as a 3x3 homography - the general projective
transform between two planes - so that a projective map saved by an older setup
is applied, and its gain measured, exactly as before.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

Point = tuple[float, float]
Matrix = tuple[float, ...]  # 9 numbers, row-major 3x3

#: The most a fit may be ill-conditioned, as a ratio of singular values, before
#: it is refused as degenerate. Exactly collinear points are not the only ones
#: that cannot determine a map: a hair off a line, least squares still finds a
#: unique answer - and it magnifies movement millions of times. Real placements
#: sit far below this (a camera at the fusion gain limit is around five);
#: judging those is the gain gate's job, not this one's.
MAX_CONDITION = 1e3

#: How close to its horizon a point may come and still be mapped, as a fraction
#: of the size of the matrix's projective row. A homography sends its horizon
#: line off to infinity and brings everything beyond it back from the far side,
#: mirrored: a fingertip a little past the line lands in the opposite corner.
HORIZON = 1e-6


def box_mapping(low: Point, high: Point) -> Matrix:
    """The plain axis-aligned map, as a homography: ``low`` to 0, ``high`` to 1."""
    width, height = high[0] - low[0], high[1] - low[1]
    if width <= 0 or height <= 0:
        raise ValueError("the box must have a positive width and height")
    return (1 / width, 0.0, -low[0] / width,
            0.0, 1 / height, -low[1] / height,
            0.0, 0.0, 1.0)


def weight(matrix: Matrix, point: Point) -> float:
    """The projective weight at ``point``: positive on the side the map is for.

    A homography's overall sign is free, but every map here keeps it meaning
    something - setup fits affine maps, positive everywhere, and the old pose
    fitter pinned its projective maps positive on the points it fitted - so
    the sign alone says which side of the horizon a point is on.
    """
    x, y = point
    return matrix[6] * x + matrix[7] * y + matrix[8]


def _in_front(matrix: Matrix, value: float) -> bool:
    """Whether a weight is clear of the horizon; NaN never is."""
    return value > HORIZON * (abs(matrix[6]) + abs(matrix[7]) + abs(matrix[8]))


def apply(matrix: Matrix, point: Point) -> Point | None:
    """Map one point through ``matrix``, dividing out the projective weight.

    None for a point on or beyond the map's horizon. The formula would still
    give an answer there - on the far side of the screen, mirrored - and a
    crosshair that flips to the opposite corner when the hand strays too far
    is worse than one that admits it has no idea.
    """
    x, y = point
    value = weight(matrix, point)
    if not _in_front(matrix, value):
        return None
    return ((matrix[0] * x + matrix[1] * y + matrix[2]) / value,
            (matrix[3] * x + matrix[4] * y + matrix[5]) / value)


def defined_over(matrix: Matrix, low: Point, high: Point) -> bool:
    """Whether every point of the box from ``low`` to ``high`` has an image.

    The weight is linear, so it is clear of the horizon across the whole box
    exactly when it is clear at the four corners.
    """
    corners = ((low[0], low[1]), (high[0], low[1]),
               (low[0], high[1]), (high[0], high[1]))
    return all(_in_front(matrix, weight(matrix, corner)) for corner in corners)


def _conditioning(points: np.ndarray) -> np.ndarray:
    """Hartley normalisation: centre on the origin, scale to a mean radius of sqrt(2).

    A fit's conditioning measured on raw coordinates says as much about where
    the points sit as about their shape; this is the standard remedy, and it
    costs two matrix multiplies.
    """
    centre = points.mean(axis=0)
    spread = np.sqrt(((points - centre) ** 2).sum(axis=1)).mean()
    scale = np.sqrt(2) / spread if spread > 1e-12 else 1.0
    return np.array([[scale, 0.0, -scale * centre[0]],
                     [0.0, scale, -scale * centre[1]],
                     [0.0, 0.0, 1.0]])


def _well_conditioned(matrix: np.ndarray) -> bool:
    """Whether ``matrix`` is far enough from singular to mean something.

    Compared as a product rather than a ratio, so a singular value of exactly
    zero reads as degenerate instead of dividing by it.
    """
    singular = np.linalg.svd(matrix, compute_uv=False)
    return bool(singular[-1] * MAX_CONDITION >= singular[0] > 0.0)


def gain(matrix: Matrix, point: Point) -> float:
    """The most a small movement here can be magnified by the map.

    The largest singular value of the local Jacobian, not the square root of its
    determinant: a nearly side-on camera has a map that is enormously stretched
    in one direction and squashed in the other, and the determinant - a
    geometric mean - hides exactly that. Worst-case amplification is what decides
    how much a camera's opinion is worth, and when to stop listening to it.
    """
    landed = apply(matrix, point)
    if landed is None:
        return float("inf")  # on or past the horizon: no image to magnify
    u, v = landed
    value = weight(matrix, point)
    a = (matrix[0] - u * matrix[6]) / value
    b = (matrix[1] - u * matrix[7]) / value
    c = (matrix[3] - v * matrix[6]) / value
    d = (matrix[4] - v * matrix[7]) / value

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
    # Rank only catches points exactly on a line. A billionth off it, least
    # squares finds a unique map that magnifies movement 450 million times;
    # the condition number of the design sees that. Judged on conditioned
    # coordinates, so it measures the shape of the point cloud - how nearly it
    # collapses onto a line - and not where it sits or how large it is.
    if not _well_conditioned((_conditioning(src) @ design.T).T):
        return None  # collinear, coincident, or as good as
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
    errors = []
    for point, target in zip(source, destination):
        landed = apply(matrix, point)
        if landed is None:
            return float("inf")  # a map that cannot even place its own points
        errors.append(math.dist(landed, target))
    return float(np.mean(errors))
