/**
 * A finger-gun as 21 hand points (MediaPipe's topology), for the small camera
 * picture in the corner: the app's own Pip class draws the skeleton, this
 * only supplies the points. No camera and no person are involved.
 *
 * Local units are palm spans, x to the right and y up, the wrist at the
 * origin; `fold` is the thumb, 0 raised (cocked) to 1 folded (fired).
 */
import type { Landmark } from "../../src/tracking/types";

export interface GunPose {
  /** Where the player points, as fractions of the stage (0..1). */
  x: number;
  y: number;
  /** 0 = thumb up, 1 = thumb folded. */
  fold: number;
  /** A small kick of the whole hand, 0..1 (decays after a shot). */
  recoil?: number;
  /** A slow wobble, in palm spans. */
  wobble?: readonly [number, number];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A finger curled into the palm: a hairpin from its knuckle. */
function curled(mx: number, my: number, lean: number): [number, number][] {
  return [
    [mx, my],
    [mx + 0.07 + lean, my + 0.13],
    [mx + 0.05 + lean * 0.5, my - 0.05],
    [mx - 0.01, my - 0.2],
  ];
}

/** The hand's 21 points in palm spans, before it is placed in the picture. */
export function fingerGunLocal(fold: number): [number, number][] {
  const p: [number, number][] = new Array(21);
  p[0] = [0, 0];
  // The thumb: base fixed, two joints that swing from raised to across the palm.
  p[1] = [-0.3, 0.22];
  p[2] = [-0.47, 0.47];
  const a1 = rad(lerp(-14, 78, fold));
  const a2 = rad(lerp(-9, 100, fold));
  p[3] = [p[2][0] + 0.3 * Math.sin(a1), p[2][1] + 0.3 * Math.cos(a1)];
  p[4] = [p[3][0] + 0.27 * Math.sin(a2), p[3][1] + 0.27 * Math.cos(a2)];
  // The index finger: straight out, the barrel.
  p[5] = [-0.2, 0.98];
  p[6] = [-0.195, 1.29];
  p[7] = [-0.19, 1.54];
  p[8] = [-0.185, 1.78];
  const middle = curled(0.08, 1.02, 0.02);
  const ring = curled(0.33, 0.93, 0.02);
  const pinky = curled(0.55, 0.8, 0.0);
  [middle, ring, pinky].forEach((finger, k) => {
    for (let j = 0; j < 4; j++) p[9 + k * 4 + j] = finger[j]!;
  });
  return p;
}

/** The camera-space landmarks (what the tracker would report, un-mirrored) for a pose. */
export function fingerGun(pose: GunPose): Landmark[] {
  const local = fingerGunLocal(pose.fold);
  const S = 0.4; // a palm span, in picture heights
  const aspect = 4 / 3; // the preview box is 4:3
  const recoil = pose.recoil ?? 0;
  // The hand leans and slides with the aim (as a real one would), and kicks on a shot.
  const roll = rad((pose.x - 0.5) * 26 - recoil * 5);
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  const wrist = [0.52 + (pose.x - 0.5) * 0.22, 0.95 + (pose.y - 0.5) * 0.14 + recoil * 0.012];
  const wob = pose.wobble ?? [0, 0];
  return local.map(([lx, ly]) => {
    // Rotate about the wrist, in palm spans.
    const rx = lx * cos - ly * sin + wob[0] * ly;
    const ry = lx * sin + ly * cos + wob[1] * ly;
    // To the picture: heights first, then x is divided by the box's aspect.
    const seenX = wrist[0]! + (rx * S) / aspect;
    const seenY = wrist[1]! - ry * S;
    // The tracker reports the camera's view; the preview mirrors it back.
    return { x: 1 - seenX, y: seenY, z: 0 };
  });
}
