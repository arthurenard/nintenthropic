/**
 * Synthetic hands with geometry we control exactly (a port of tests/hands.py),
 * for the aim tests and for the scripted input the end-to-end tests drive.
 */
import type { Landmark } from "../tracking/types";

export const WRIST_XY: readonly [number, number] = [0.5, 0.8];
export const PALM_SPAN = 0.2;
export const THUMB_LENGTH = 0.15;

export function rotate(vector: readonly [number, number], degrees: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [vector[0] * cos - vector[1] * sin, vector[0] * sin + vector[1] * cos];
}

export interface HandPose {
  /** How far the thumb sits off the palm's up axis, in degrees. */
  thumbDegrees?: number;
  /** Thumb-tip-to-index-knuckle distance, in palm spans. */
  reach?: number;
  /** The fingertip, as the player sees it (the mirrored image). */
  indexTip?: readonly [number, number];
  /** Turns the whole hand, to check rotation invariance. */
  roll?: number;
  /** Size in the frame: 1 at arm's length, smaller further away. */
  scale?: number;
  wrist?: readonly [number, number];
}

const point = (x: number, y: number): Landmark => ({ x, y, z: 0 });
const mix = (a: Landmark, b: Landmark, t: number): Landmark =>
  point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/**
 * A hand whose thumb sits `thumbDegrees` off the palm's up axis, with its 21
 * points in the image as the player sees it (mirrored). The points the aim
 * reads - wrist, thumb base and tip, index knuckle and tip, middle knuckle -
 * are placed exactly as in tests/hands.py; the rest are filled in as a
 * curled fist so a drawn skeleton looks like a hand.
 */
export function makeHand(pose: HandPose = {}): Landmark[] {
  const { thumbDegrees = 0, reach = 1, indexTip = [0.5, 0.5], roll = 0, scale = 1, wrist = WRIST_XY } = pose;
  const up = rotate([0, -1], roll); // image coordinates: up is -y
  const side = rotate(up, 90); // across the palm, towards the little finger
  const span = PALM_SPAN * scale;
  const at = (along: number, across: number) =>
    point(wrist[0] + up[0] * span * along + side[0] * span * across, wrist[1] + up[1] * span * along + side[1] * span * across);

  const landmarks: Landmark[] = Array.from({ length: 21 }, () => point(0, 0));
  landmarks[0] = point(wrist[0], wrist[1]);
  landmarks[9] = at(1, 0);
  landmarks[2] = at(0.25, 0);
  const thumb = rotate(up, thumbDegrees);
  const length = THUMB_LENGTH * scale;
  landmarks[4] = point(landmarks[2].x + thumb[0] * length, landmarks[2].y + thumb[1] * length);
  // The index knuckle, placed to give the requested reach exactly.
  landmarks[5] = point(landmarks[4].x + reach * span, landmarks[4].y);
  landmarks[8] = point(indexTip[0], indexTip[1]);
  // The rest, for looks only: the thumb's joints between its base and tip,
  // the index finger reaching for its tip, and the other three knuckles in a
  // row beside the middle one with their fingers curled into the palm.
  landmarks[1] = mix(landmarks[0], landmarks[2], 0.5);
  landmarks[1] = point(landmarks[1].x + side[0] * span * 0.12, landmarks[1].y + side[1] * span * 0.12);
  landmarks[3] = mix(landmarks[2], landmarks[4], 0.55);
  landmarks[6] = mix(landmarks[5], landmarks[8], 0.4);
  landmarks[7] = mix(landmarks[5], landmarks[8], 0.72);
  const palm = at(0.55, 0.1);
  for (const [base, along, across] of [
    [9, 1, 0],
    [13, 0.95, -0.28],
    [17, 0.84, -0.52],
  ] as const) {
    const knuckle = base === 9 ? landmarks[9] : at(along, across);
    landmarks[base] = knuckle;
    const bent = point(knuckle.x + (palm.x - knuckle.x) * 0.35, knuckle.y + (palm.y - knuckle.y) * 0.35);
    const middle = point(bent.x + side[0] * span * 0.12, bent.y + side[1] * span * 0.12);
    landmarks[base + 1] = middle;
    landmarks[base + 2] = mix(middle, palm, 0.55);
    landmarks[base + 3] = mix(middle, palm, 0.85);
  }
  return landmarks;
}

/** The same hand as the camera sees it: the image un-mirrored. */
export function asCameraSees(hand: readonly Landmark[]): Landmark[] {
  return hand.map(({ x, y, z }) => ({ x: 1 - x, y, z }));
}
