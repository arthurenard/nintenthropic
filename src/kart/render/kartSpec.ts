/**
 * What every kart model agrees on, whoever made it (the code-built one in
 * kartModel.ts, the Blender one in kartArt.ts): where its wheels, exhausts,
 * driver and steering wheel are, so the effects (skid marks, exhaust flames,
 * drift smoke), the collisions and the driver line up with either.
 *
 * Metres, in the kart's own frame: it faces +z, its left is +x.
 */

/** A wheel: its hub (x is the left wheel's; the right one mirrors it), radius and width. */
export interface WheelSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  w: number;
}

export const WHEEL_FRONT: WheelSpec = { x: 0.86, y: 0.36, z: 0.94, r: 0.36, w: 0.3 };
export const WHEEL_REAR: WheelSpec = { x: 0.95, y: 0.43, z: -0.84, r: 0.43, w: 0.42 };

/** Where the rear wheels and exhausts are, for effects: metres to the right of, and ahead of, the kart's centre. */
export const KART_REAR_WHEEL = { right: WHEEL_REAR.x, forward: WHEEL_REAR.z };
export const KART_EXHAUST = { right: 0.3, forward: -1.5, y: 0.64 };
/** How far the kart's widest part (a rear tyre's outer edge) is from its middle, metres. */
export const KART_HALF_WIDTH = WHEEL_REAR.x + WHEEL_REAR.w / 2;

/** Beyond this many metres from the camera the kart is drawn as one welded mesh. */
export const FAR_DISTANCE = 34;

/** The driver's hips, in the kart's frame. */
export const DRIVER_AT = [0, 0.9, -0.28] as const;
/** The steering wheel's hub, and how far it is tilted (about x) and turned per unit of steer. */
export const STEERING = { at: [0, 1.04, 0.24] as const, tilt: -0.95, turn: 1.5 };
/** The number plate's rear face (z) and its centre's height: the kart's number is written on it. */
export const PLATE = { z: -1.342, y: 0.62 };
