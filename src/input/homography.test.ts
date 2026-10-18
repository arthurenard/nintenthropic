// Ported from the Python version's tests/test_homography.py (git tag `python-final`).
import { describe, expect, it } from "vitest";
import { gaussian, seededRandom } from "../engine/random";
import type { Point } from "./filter";
import { apply, boxMapping, definedOver, fitAffine, fitScaled, gain, residual, type Matrix } from "./homography";

const close = (actual: readonly number[] | null, expected: readonly number[], digits = 9) => {
  expect(actual).not.toBeNull();
  actual!.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
};

// An affine placement: rotated, sheared and offset, but no perspective.
const AFFINE: Matrix = [1.6, 0.4, -0.5, -0.3, 1.9, -0.4, 0, 0, 1];
const HAND: Point[] = [
  [0.3, 0.35],
  [0.7, 0.4],
  [0.65, 0.7],
  [0.35, 0.65],
  [0.5, 0.52],
];
const traced = (matrix: Matrix, points: Point[]) => points.map((p) => apply(matrix, p)!);

describe("box mappings", () => {
  it("put their corners at the screen's corners", () => {
    const matrix = boxMapping([0.2, 0.3], [0.8, 0.7]);
    close(apply(matrix, [0.2, 0.3]), [0, 0]);
    close(apply(matrix, [0.8, 0.7]), [1, 1]);
    close(apply(matrix, [0.5, 0.5]), [0.5, 0.5]);
  });

  it("refuse a box with no area", () => {
    expect(() => boxMapping([0.5, 0.2], [0.5, 0.8])).toThrow();
  });
});

describe("the affine fit", () => {
  it("recovers the placement it was traced on", () => {
    const screen = traced(AFFINE, HAND);
    close(fitAffine(HAND, screen), AFFINE);
    // Three points determine it exactly.
    close(fitAffine(HAND.slice(0, 3), screen.slice(0, 3)), AFFINE, 7);
  });

  it("spreads noise rather than failing", () => {
    const noise = gaussian(seededRandom(5));
    const screen = traced(AFFINE, HAND);
    const shaken = HAND.map((p): Point => [p[0] + noise(0, 0.004), p[1] + noise(0, 0.004)]);
    const matrix = fitAffine(shaken, screen);
    expect(matrix).not.toBeNull();
    expect(matrix!.slice(6)).toEqual([0, 0, 1]);
    expect(residual(matrix!, shaken, screen)).toBeLessThan(0.02);
  });

  it("still fits a camera far off to the side", () => {
    // The conditioning gate is for numerical nonsense, not for placements: a
    // side-on camera right at the gain limit is still a real camera.
    const targets: Point[] = [
      [0.15, 0.22],
      [0.85, 0.62],
      [0.85, 0.22],
      [0.15, 0.62],
      [0.5, 0.38],
    ];
    const squeezed = targets.map(([x, y]): Point => [0.5 + 0.05 * x, 0.3 + 0.4 * y]);
    const matrix = fitAffine(squeezed, targets);
    expect(matrix).not.toBeNull();
    expect(gain(matrix!, [0.5, 0.5])).toBeCloseTo(20, 6);
  });

  it("refuses what cannot determine it", () => {
    const screen = traced(AFFINE, HAND);
    expect(fitAffine(HAND.slice(0, 2), screen.slice(0, 2))).toBeNull(); // too few
    expect(fitAffine(HAND, screen.slice(0, 4))).toBeNull(); // mismatched
    expect(fitAffine([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], screen.slice(0, 3))).toBeNull(); // one point
    const line: Point[] = [
      [0.3, 0.3],
      [0.5, 0.5],
      [0.7, 0.7],
    ];
    expect(fitAffine(line, screen.slice(0, 3))).toBeNull(); // collinear
    expect(fitAffine([[Number.NaN, 0.5], ...HAND.slice(1)], screen)).toBeNull();
  });

  it("refuses points a hair off a line", () => {
    // Least squares on points 1e-9 off a line finds a unique answer - with a
    // gain of 4.5e8. Rank said three; the conditioning says nonsense.
    const screen: Point[] = [
      [0.15, 0.22],
      [0.85, 0.62],
      [0.85, 0.22],
    ];
    for (const offset of [1e-4, 1e-6, 1e-9]) {
      expect(fitAffine([[0.3, 0.4], [0.7, 0.6], [0.5, 0.5 + offset]], screen)).toBeNull();
    }
    // While a triangle with some body to it is fitted.
    expect(fitAffine([[0.3, 0.4], [0.7, 0.6], [0.5, 0.6]], screen)).not.toBeNull();
  });
});

describe("the scaled fit", () => {
  it("recovers each axis, including a reversed one", () => {
    const truth: Matrix = [2, 0, -0.5, 0, -1.5, 1.25, 0, 0, 1];
    const screen = traced(truth, HAND);
    close(fitScaled(HAND, screen), truth);
    // Two points already determine it.
    close(fitScaled(HAND.slice(0, 2), screen.slice(0, 2)), truth);
  });

  it("refuses a signal that never moved", () => {
    const screen: Point[] = [
      [0.15, 0.22],
      [0.85, 0.62],
      [0.85, 0.22],
    ];
    expect(fitScaled([[0.5, 0.4], [0.5, 0.6], [0.5, 0.5]], screen)).toBeNull();
    expect(fitScaled([[0.3, 0.5], [0.7, 0.5], [0.5, 0.5]], screen)).toBeNull();
    // Nor does it learn from a target that did not move with the signal.
    expect(fitScaled([[0.3, 0.3], [0.7, 0.7]], [[0.5, 0.2], [0.5, 0.8]])).toBeNull();
  });

  it("refuses what cannot determine it", () => {
    expect(fitScaled([[0.3, 0.3]], [[0.1, 0.1]])).toBeNull();
    expect(fitScaled(HAND, HAND.slice(0, 3))).toBeNull();
    expect(fitScaled([[0.3, Number.POSITIVE_INFINITY], [0.7, 0.7]], [[0.1, 0.1], [0.9, 0.9]])).toBeNull();
  });
});

describe("the horizon", () => {
  // A transform whose weight goes to zero along x = 0.5, positive beyond it.
  const edge: Matrix = [1, 0, 0, 0, 1, 0, 1, 0, -0.5];
  // The map an old pose calibration saved on the player's own machine. Its
  // horizon crosses the camera frame at x = 0.82 along the top edge.
  const LEGACY: Matrix = [
    2.871934573670249, -0.061145355513888985, -1.2142552975804075, -0.9041251222717106, 2.3601729633571686,
    -0.8949543501390803, -1.2131671258909114, 0.4386268157484197, 1.0,
  ];

  it("gives a point on or past it no image", () => {
    expect(apply(edge, [0.5, 0.2])).toBeNull();
    expect(apply(edge, [0.5 - 1e-11, 0.2])).toBeNull();
    expect(apply(edge, [0.4, 0.2])).toBeNull();
    close(apply(edge, [0.6, 0.2]), [6, 2]);
    expect(gain(edge, [0.4, 0.2])).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not throw a fingertip past it to the opposite corner", () => {
    const before = apply(LEGACY, [0.895, 0.2])!;
    expect(before[0]).toBeGreaterThan(1);
    expect(before[1]).toBeLessThan(0);
    expect(apply(LEGACY, [0.899, 0.2])).toBeNull();
    expect(apply(LEGACY, [0.95, 0.2])).toBeNull();
  });

  it("decides whether a map covers a whole box", () => {
    const frame: [Point, Point] = [
      [0, 0],
      [1, 1],
    ];
    expect(definedOver(boxMapping([0, 0], [1, 1]), ...frame)).toBe(true);
    expect(definedOver(AFFINE, ...frame)).toBe(true); // an affine map has no horizon
    expect(definedOver(LEGACY, ...frame)).toBe(false); // its horizon is in view
    expect(definedOver(LEGACY, [0.2, 0.2], [0.7, 0.8])).toBe(true);
    expect(definedOver(Array(9).fill(Number.NaN) as unknown as Matrix, ...frame)).toBe(false);
  });

  it("counts a point it cannot place as infinitely wrong", () => {
    expect(residual(edge, [[0.4, 0.2]], [[0.4, 0.2]])).toBe(Number.POSITIVE_INFINITY);
    expect(residual(boxMapping([0, 0], [1, 1]), [], [])).toBe(0);
  });
});
