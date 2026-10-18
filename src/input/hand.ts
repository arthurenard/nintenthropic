/**
 * Turns hand landmarks into a pointer and a trigger measurement (ported from
 * the geometry in aiming.py, in the Python version: git tag `python-final`).
 *
 * The player holds their hand like a pistol and points it at the screen. Seen
 * from the webcam the index finger is then heavily foreshortened, so aiming is
 * driven by *where the fingertip is*, not by the direction the finger appears
 * to point. The shot is the thumb: pointing up along the hand the pistol is
 * cocked, rotated away from up (or folded onto the fist) it fires.
 */
import type { Point } from "./filter";

// Landmark indices in MediaPipe's hand topology.
export const WRIST = 0;
export const THUMB_MCP = 2;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;

/** Anything with x and y: MediaPipe's landmarks, or a test's synthetic hand. */
export interface Planar {
  x: number;
  y: number;
}
export type Hand = readonly Planar[];

const vector = (origin: Planar, tip: Planar): Point => [tip.x - origin.x, tip.y - origin.y];

export function distance(a: Planar, b: Planar): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Unsigned angle between two vectors, in degrees (0..180).
 *
 * Computed from the cross and dot products rather than from acos alone, which
 * loses all precision exactly where the two poses have to be told apart - when
 * the vectors are nearly parallel.
 */
export function angleBetween(a: Point, b: Point): number {
  const cross = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1];
  if (cross === 0 && dot === 0) return 0; // a degenerate, zero-length vector
  return (Math.abs(Math.atan2(cross, dot)) * 180) / Math.PI;
}

/** Wrist-to-middle-knuckle length, the scale distances are measured in. */
export function palmSpan(hand: Hand): number {
  return distance(hand[WRIST]!, hand[MIDDLE_MCP]!);
}

/**
 * The hand's own "up": wrist towards the middle knuckle. Using the hand's axis
 * instead of the screen's means the trigger keeps working when the player
 * tilts or rolls their wrist while tracking a target.
 */
export function handUp(hand: Hand): Point {
  return vector(hand[WRIST]!, hand[MIDDLE_MCP]!);
}

/** Degrees the thumb has rotated away from pointing up along the hand: small
 * while the thumb stands up beside the fist, large once it drops onto it. */
export function thumbAngle(hand: Hand): number {
  return angleBetween(handUp(hand), vector(hand[THUMB_MCP]!, hand[THUMB_TIP]!));
}

/**
 * Thumb reach from the index knuckle, in palm spans. Scale-invariant, so it
 * behaves the same whether the hand is near the camera or far from it: the
 * fallback signal for thumbs that fold without rotating.
 */
export function thumbExtension(hand: Hand): number {
  const span = palmSpan(hand);
  if (!(span > 0)) return 0;
  return distance(hand[THUMB_TIP]!, hand[INDEX_MCP]!) / span;
}

/**
 * The built-in thumb fold, 0 (cocked) to 1 (folded), the same for every
 * player and hand size, so it needs no setup. Either a rotation away from the
 * palm's up axis or a fold toward the index knuckle counts; both must release
 * before the next shot can arm.
 */
export function thumbPull(hand: Hand): number {
  const angle = (thumbAngle(hand) - 25) / 40;
  const reach = (0.85 - thumbExtension(hand)) / 0.45;
  return Math.min(1, Math.max(0, angle, reach));
}

/**
 * Where the player is pointing, in the mirrored camera image: the fingertip as
 * the player sees themselves, so moving the hand right moves the aim right.
 */
export function pointer(hand: Hand): Point {
  const tip = hand[INDEX_TIP]!;
  return [1 - tip.x, tip.y];
}
