/**
 * The map from hand space to screen space, and fitting it (ported from
 * homography.py, in the Python version: git tag `python-final`).
 *
 * Where the camera sits relative to the screen changes the shape of that map. A
 * webcam above a laptop screen sees a very different sweep from one off to the
 * side of an external monitor: the hand plane is rotated, sheared and
 * foreshortened against the screen plane. An axis-aligned box cannot express
 * that; an affine map covers the rotation and shear, which is what the aim
 * check fits from the shots the player takes. Every map is kept as a 3x3
 * homography, row-major, so that a projective map is applied, and its gain
 * measured, exactly as the Python version did.
 */
import type { Point } from "./filter";

/** Nine numbers, row-major 3x3. */
export type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/**
 * The most a fit may be ill-conditioned, as a ratio of singular values, before
 * it is refused as degenerate. Exactly collinear points are not the only ones
 * that cannot determine a map: a hair off a line, least squares still finds a
 * unique answer - and it magnifies movement millions of times.
 */
export const MAX_CONDITION = 1e3;

/**
 * How close to its horizon a point may come and still be mapped, as a fraction
 * of the size of the matrix's projective row. A homography sends its horizon
 * line off to infinity and brings everything beyond it back from the far side,
 * mirrored: a fingertip a little past the line lands in the opposite corner.
 */
export const HORIZON = 1e-6;

/** The plain axis-aligned map, as a homography: `low` to 0, `high` to 1. */
export function boxMapping(low: Point, high: Point): Matrix {
  const width = high[0] - low[0];
  const height = high[1] - low[1];
  if (!(width > 0) || !(height > 0)) throw new RangeError("the box must have a positive width and height");
  return [1 / width, 0, -low[0] / width, 0, 1 / height, -low[1] / height, 0, 0, 1];
}

/** The projective weight at `point`: positive on the side the map is for. */
export function weight(matrix: Matrix, point: Point): number {
  return matrix[6] * point[0] + matrix[7] * point[1] + matrix[8];
}

/** Whether a weight is clear of the horizon; NaN never is. */
function inFront(matrix: Matrix, value: number): boolean {
  return value > HORIZON * (Math.abs(matrix[6]) + Math.abs(matrix[7]) + Math.abs(matrix[8]));
}

/**
 * Map one point through `matrix`, dividing out the projective weight.
 *
 * Null for a point on or beyond the map's horizon. The formula would still give
 * an answer there - on the far side of the screen, mirrored - and a crosshair
 * that flips to the opposite corner when the hand strays too far is worse than
 * one that admits it has no idea.
 */
export function apply(matrix: Matrix, point: Point): [number, number] | null {
  const [x, y] = point;
  const value = weight(matrix, point);
  if (!inFront(matrix, value)) return null;
  return [(matrix[0] * x + matrix[1] * y + matrix[2]) / value, (matrix[3] * x + matrix[4] * y + matrix[5]) / value];
}

/** Whether every point of the box from `low` to `high` has an image. The
 * weight is linear, so it is clear of the horizon across the whole box exactly
 * when it is clear at the four corners. */
export function definedOver(matrix: Matrix, low: Point, high: Point): boolean {
  const corners: Point[] = [
    [low[0], low[1]],
    [high[0], low[1]],
    [low[0], high[1]],
    [high[0], high[1]],
  ];
  return corners.every((corner) => inFront(matrix, weight(matrix, corner)));
}

/**
 * The most a small movement here can be magnified by the map: the largest
 * singular value of the local Jacobian. Not the square root of its
 * determinant - a nearly side-on camera has a map enormously stretched one way
 * and squashed the other, and the determinant, a geometric mean, hides that.
 */
export function gain(matrix: Matrix, point: Point): number {
  const landed = apply(matrix, point);
  if (landed === null) return Number.POSITIVE_INFINITY; // on or past the horizon
  const [u, v] = landed;
  const value = weight(matrix, point);
  const a = (matrix[0] - u * matrix[6]) / value;
  const b = (matrix[1] - u * matrix[7]) / value;
  const c = (matrix[3] - v * matrix[6]) / value;
  const d = (matrix[4] - v * matrix[7]) / value;
  // Largest singular value of [[a, b], [c, d]], in closed form.
  const total = a * a + b * b + c * c + d * d;
  const difference = Math.hypot(a * a + b * b - c * c - d * d, 2 * (a * c + b * d));
  return Math.sqrt(Math.max(total + difference, 0) / 2);
}

export const MIN_AFFINE_POINTS = 3;
export const MIN_SCALED_POINTS = 2;

/** A slope flatter than this means the signal did not move with the target at
 * all, so nothing can be learned about which way round it goes. */
const MIN_SLOPE = 1e-6;

const finite = (points: readonly Point[]) => points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

/**
 * Independent scale and offset on each axis: four parameters.
 *
 * The humblest map that can still be wrong-way-round, and therefore the one
 * that matters most. It needs only that the signal moved *with* the target,
 * not that it moved cleanly - so it survives noise that defeats the richer
 * models, and whatever it fits comes out correctly oriented because it was
 * fitted to what the player actually did.
 */
export function fitScaled(source: readonly Point[], destination: readonly Point[]): Matrix | null {
  if (source.length !== destination.length || source.length < MIN_SCALED_POINTS) return null;
  if (!finite(source) || !finite(destination)) return null;
  const slopes: number[] = [];
  const offsets: number[] = [];
  for (const axis of [0, 1] as const) {
    const meanSource = source.reduce((sum, p) => sum + p[axis], 0) / source.length;
    const meanTarget = destination.reduce((sum, p) => sum + p[axis], 0) / destination.length;
    let variance = 0;
    let covariance = 0;
    source.forEach((p, i) => {
      const spread = p[axis] - meanSource;
      variance += spread * spread;
      covariance += spread * (destination[i]![axis] - meanTarget);
    });
    if (variance < MIN_SLOPE) return null; // the signal never moved on this axis
    const slope = covariance / variance;
    if (Math.abs(slope) < MIN_SLOPE) return null;
    slopes.push(slope);
    offsets.push(meanTarget - slope * meanSource);
  }
  return [slopes[0]!, 0, offsets[0]!, 0, slopes[1]!, offsets[1]!, 0, 0, 1];
}

/**
 * Hartley normalisation: centre on the origin, scale to a mean radius of
 * sqrt(2). A fit's conditioning measured on raw coordinates says as much about
 * where the points sit as about their shape; this is the standard remedy.
 */
function conditioning(points: readonly Point[]): { scale: number; cx: number; cy: number } {
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const spread = points.reduce((sum, p) => sum + Math.hypot(p[0] - cx, p[1] - cy), 0) / points.length;
  return { scale: spread > 1e-12 ? Math.SQRT2 / spread : 1, cx, cy };
}

/** Eigenvalues of a symmetric 3x3 matrix, by Jacobi rotations. */
function symmetricEigenvalues(input: number[][]): number[] {
  const a = input.map((row) => [...row]);
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i]![j]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
      }
    }
  }
  return [a[0]![0]!, a[1]![1]!, a[2]![2]!];
}

/**
 * Whether an n x 3 design matrix is far enough from singular to mean
 * something. Its singular values are the square roots of the eigenvalues of
 * its Gram matrix; compared as a product rather than a ratio, so a singular
 * value of exactly zero reads as degenerate instead of dividing by it.
 */
function wellConditioned(rows: readonly (readonly [number, number, number])[]): boolean {
  const gram = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((sum, row) => sum + row[i]! * row[j]!, 0)));
  const singular = symmetricEigenvalues(gram)
    .map((value) => Math.sqrt(Math.max(value, 0)))
    .sort((a, b) => b - a);
  return singular[2]! * MAX_CONDITION >= singular[0]! && singular[0]! > 0;
}

/** Solves a 3x3 linear system by Gaussian elimination with partial pivoting. */
function solve3(matrix: number[][], rhs: number[]): number[] | null {
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    if (Math.abs(m[pivot]![col]!) < 1e-300) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = col + 1; row < 3; row++) {
      const factor = m[row]![col]! / m[col]![col]!;
      for (let k = col; k < 4; k++) m[row]![k]! -= factor * m[col]![k]!;
    }
  }
  const x = [0, 0, 0];
  for (let row = 2; row >= 0; row--) {
    let sum = m[row]![3]!;
    for (let k = row + 1; k < 3; k++) sum -= m[row]![k]! * x[k]!;
    x[row] = sum / m[row]![row]!;
  }
  return x;
}

/**
 * Least-squares affine map taking `source` onto `destination`.
 *
 * Six degrees of freedom instead of the homography's eight. On the handful of
 * noisy points the aim check collects, the two projective parameters do
 * nothing but chase noise: they buy a tighter training fit and a wilder map
 * everywhere else. Solved on conditioned coordinates, where the normal
 * equations are well behaved, then carried back.
 */
export function fitAffine(source: readonly Point[], destination: readonly Point[]): Matrix | null {
  if (source.length !== destination.length || source.length < MIN_AFFINE_POINTS) return null;
  if (!finite(source) || !finite(destination)) return null;
  const { scale, cx, cy } = conditioning(source);
  const rows = source.map((p) => [scale * (p[0] - cx), scale * (p[1] - cy), 1] as const);
  // Rank only catches points exactly on a line. A billionth off it, least
  // squares finds a unique map that magnifies movement 450 million times; the
  // condition number of the conditioned design sees that.
  if (!wellConditioned(rows)) return null;
  const normal = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((sum, row) => sum + row[i]! * row[j]!, 0)));
  const solveFor = (axis: 0 | 1) =>
    solve3(
      normal,
      [0, 1, 2].map((i) => rows.reduce((sum, row, k) => sum + row[i]! * destination[k]![axis], 0)),
    );
  const u = solveFor(0);
  const v = solveFor(1);
  if (!u || !v) return null;
  // Back from conditioned coordinates: x' = scale (x - cx).
  const a = u[0]! * scale;
  const b = u[1]! * scale;
  const tx = u[2]! - a * cx - b * cy;
  const c = v[0]! * scale;
  const d = v[1]! * scale;
  const ty = v[2]! - c * cx - d * cy;
  if (![a, b, c, d, tx, ty].every(Number.isFinite)) return null;
  if (Math.abs(a * d - b * c) < 1e-12) return null;
  return [a, b, tx, c, d, ty, 0, 0, 1];
}

/** Mean distance between where points land and where they should, 0..1 of the screen. */
export function residual(matrix: Matrix, source: readonly Point[], destination: readonly Point[]): number {
  if (!source.length) return 0;
  let total = 0;
  for (let i = 0; i < source.length; i++) {
    const landed = apply(matrix, source[i]!);
    if (landed === null) return Number.POSITIVE_INFINITY; // a map that cannot even place its own points
    total += Math.hypot(landed[0] - destination[i]![0], landed[1] - destination[i]![1]);
  }
  return total / source.length;
}

/** Whether a value read back from storage is a usable map. */
export function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 9 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}
