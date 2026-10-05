/**
 * Made-up hands for the wheel's tests: 21 image points and 21 world points
 * for a fist or an open hand, placed at a position, size and rotation in 3D,
 * the way MediaPipe would report them (only without its noise, unless asked).
 * Not part of the game: tests import it.
 *
 * The hand is built in its own space (metres): x across the palm towards the
 * little finger, y along the fingers, z out of the palm. A finger is three
 * bones bending towards the palm, so a fist and an open hand are the same
 * hand with different joint angles, and turning it (yaw, pitch, roll) shows
 * the camera its palm, the side of its fist or its back with every distance
 * between the real points unchanged - exactly what the world landmarks give.
 */
import { mulberry32 } from "../../engine/rules/rng";
import type { HandFrame, Landmark, SeenHand } from "../../tracking/types";
import type { WheelOutput } from "./wheel";
import { WheelReader, type WheelOptions } from "./wheel";

type Vec = [number, number, number];

/** How many fingers are out (0 fist .. 4 open); "fist" and "open" for short. */
export type Fingers = "fist" | "open" | number;

export interface SynthHand {
  /** The palm's centre in the mirrored picture (as the player sees themself), 0..1, y down. */
  x: number;
  y: number;
  fingers: Fingers;
  /** Wrist to middle knuckle in picture heights when seen palm-on (default 0.08). */
  size?: number;
  /**
   * Turn about the vertical axis, degrees: 0 palm to the camera, 90 the side
   * of the hand to it (a wheel-holding fist shows its knuckles or its side), 180 the back.
   */
  yaw?: number;
  /** Turn about the horizontal axis, degrees: 0 fingers up, 90 fingers towards the camera. */
  pitch?: number;
  /** Turn in the picture's plane, degrees, clockwise as the player sees it. */
  roll?: number;
  /** Which hand MediaPipe says it is (default: by the side of the picture). */
  handedness?: "Left" | "Right";
}

// The finger bones in metres: where each knuckle (MCP) sits on the palm and
// how long its three bones are. Index, middle, ring, little: landmarks 5, 9, 13, 17.
const FINGERS = [
  { mcp: [-0.03, 0.09], bones: [0.04, 0.025, 0.02], first: 5 },
  { mcp: [-0.005, 0.095], bones: [0.045, 0.028, 0.022], first: 9 },
  { mcp: [0.02, 0.09], bones: [0.042, 0.026, 0.02], first: 13 },
  { mcp: [0.043, 0.08], bones: [0.032, 0.02, 0.018], first: 17 },
] as const;
/** The bend of each joint into a fist, degrees, cumulative from the finger pointing up. */
const FIST_BEND = [80, 180, 230] as const;
/** Wrist to middle knuckle, metres: what `size` is measured against. */
const WRIST_TO_KNUCKLE = Math.hypot(0.005, 0.095);

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** A hand in its own space: 21 points in metres, wrist at the origin. */
function localHand(fingers: number): Vec[] {
  const points: Vec[] = Array.from({ length: 21 }, () => [0, 0, 0] as Vec);
  points[0] = [0, 0, 0];
  const out = Math.round(fingers);
  FINGERS.forEach((finger, index) => {
    // Fingers go out from the index finger on, so "2 out" is the index and middle.
    const straight = index < out;
    const [x, y] = finger.mcp;
    let at: Vec = [x, y, 0];
    points[finger.first] = at;
    for (let joint = 0; joint < 3; joint++) {
      const angle = straight ? 0 : rad(FIST_BEND[joint]!);
      at = [at[0], at[1] + finger.bones[joint]! * Math.cos(angle), at[2] + finger.bones[joint]! * Math.sin(angle)];
      points[finger.first + 1 + joint] = at;
    }
  });
  // The thumb: out beside the palm for an open hand, laid across the fingers in a fist.
  const tucked = out < 3;
  points[1] = [-0.025, 0.02, 0];
  points[2] = tucked ? [-0.035, 0.04, 0.012] : [-0.04, 0.045, 0.005];
  points[3] = tucked ? [-0.03, 0.058, 0.03] : [-0.052, 0.065, 0.01];
  points[4] = tucked ? [-0.012, 0.066, 0.042] : [-0.06, 0.085, 0.012];
  return points;
}

/** Rotates in the picture's axes: u right, v down, w away from the camera. */
function turn([u, v, w]: Vec, yaw: number, pitch: number, roll: number): Vec {
  // Yaw, about the vertical (v).
  let a = u * Math.cos(yaw) + w * Math.sin(yaw);
  let c = -u * Math.sin(yaw) + w * Math.cos(yaw);
  let b = v;
  // Pitch, about the horizontal (u).
  const b2 = b * Math.cos(pitch) - c * Math.sin(pitch);
  c = b * Math.sin(pitch) + c * Math.cos(pitch);
  b = b2;
  // Roll, in the picture's plane (u, v); with v down this is clockwise.
  const a2 = a * Math.cos(roll) - b * Math.sin(roll);
  b = a * Math.sin(roll) + b * Math.cos(roll);
  a = a2;
  return [a, b, c];
}

export interface FrameOptions {
  /** The picture's width over its height (default 16:9). */
  aspect?: number;
  /** Random wobble on every point, in metres (about 0.002 is MediaPipe on a good day). */
  jitter?: number;
  /** Seeds the wobble. */
  seed?: number;
}

/** One hand as MediaPipe would report it for a camera that does not mirror. */
export function seenHand(hand: SynthHand, options: FrameOptions = {}): SeenHand {
  const aspect = options.aspect ?? 16 / 9;
  const size = hand.size ?? 0.08;
  const random = mulberry32(options.seed ?? 1);
  const wobble = () => (options.jitter ? (random() - 0.5) * 2 * options.jitter : 0);
  const local = localHand(hand.fingers === "fist" ? 0 : hand.fingers === "open" ? 4 : hand.fingers);
  const centre = [0, 5, 9, 13, 17].reduce<Vec>((sum, i) => [sum[0] + local[i]![0], sum[1] + local[i]![1], sum[2] + local[i]![2]], [0, 0, 0]).map((n) => n / 5) as Vec;
  const yaw = rad(hand.yaw ?? 0);
  const pitch = rad(hand.pitch ?? 0);
  const roll = rad(hand.roll ?? 0);
  const scale = size / WRIST_TO_KNUCKLE; // picture heights per metre
  const landmarks: Landmark[] = [];
  const world: Landmark[] = [];
  for (const point of local) {
    // To the picture's axes with the palm to the camera and the fingers up, about the palm's centre.
    const view = turn([point[0] - centre[0],-(point[1] - centre[1]), -(point[2] - centre[2])], yaw, pitch, roll);
    const [u, v, w] = [view[0] + wobble(), view[1] + wobble(), view[2] + wobble()];
    // Mirrored picture to the camera's: x runs the other way.
    landmarks.push({ x: 1 - (hand.x + (u * scale) / aspect), y: hand.y + v * scale, z: (w * scale) / aspect });
    world.push({ x: -u, y: v, z: w });
  }
  return { landmarks, world, handedness: hand.handedness ?? (hand.x < 0.5 ? "Right" : "Left"), score: 0.95 };
}

let sequence = 0;

/** A camera frame of these hands (none: an empty picture), taken at `at` ms. */
export function handFrame(hands: readonly SynthHand[], at: number, options: FrameOptions = {}): HandFrame {
  const seen = hands.map((hand, index) => seenHand(hand, { ...options, seed: (options.seed ?? 1) + index + at }));
  return {
    landmarks: seen[0]?.landmarks ?? null,
    handedness: seen[0]?.handedness ?? null,
    hands: seen,
    capturedAt: at,
    sequence: ++sequence,
  };
}

export interface WheelPose {
  /** The wheel's turn, degrees: + is the right hand lower. */
  angle: number;
  /** The wheel's centre in the mirrored picture (default the middle, a little above it). */
  centre?: readonly [number, number];
  /** The distance between the palms, in picture heights (default 0.5). */
  span?: number;
  /** Both hands' fingers (default fists). */
  fingers?: Fingers;
  /** Per hand overrides (a hand opened for an item flick, say). */
  left?: Partial<SynthHand>;
  right?: Partial<SynthHand>;
  yaw?: number;
  pitch?: number;
  aspect?: number;
}

/** Both hands on a wheel turned `angle`: the left hand first. */
export function wheelHands(pose: WheelPose): [SynthHand, SynthHand] {
  const [cx, cy] = pose.centre ?? [0.5, 0.45];
  const span = pose.span ?? 0.5;
  const aspect = pose.aspect ?? 16 / 9;
  const turn = rad(pose.angle);
  const dx = (Math.cos(turn) * span) / 2 / aspect;
  const dy = (Math.sin(turn) * span) / 2;
  const common = { fingers: pose.fingers ?? "fist", yaw: pose.yaw ?? 90, pitch: pose.pitch ?? 0, roll: pose.angle };
  return [
    { ...common, x: cx - dx, y: cy - dy, handedness: "Right", ...pose.left },
    { ...common, x: cx + dx, y: cy + dy, handedness: "Left", ...pose.right },
  ];
}

/**
 * A player at the wheel in a test: feeds frames at 30 a second and samples at
 * 60, as the game does, with a clock of its own.
 */
export class Rig {
  readonly reader: WheelReader;
  /** The clock, ms. */
  now = 1000;
  last: WheelOutput;
  private tick = 0;

  constructor(
    options: WheelOptions & { fps?: number; jitter?: number } = {},
  ) {
    this.reader = new WheelReader(options);
    this.fps = options.fps ?? 30;
    this.jitter = options.jitter ?? 0;
    this.last = this.reader.sample(this.now);
  }

  readonly fps: number;
  private readonly jitter: number;

  /** Runs `seconds` with the hands `pose` says at each moment (seconds since the call began); returns the last output. */
  run(seconds: number, pose: (elapsed: number) => readonly SynthHand[]): WheelOutput {
    const began = this.now;
    const end = began + seconds * 1000;
    const ticks = 1000 / 60;
    const every = Math.max(1, Math.round(60 / this.fps));
    while (this.now < end - 1e-6) {
      this.now += ticks;
      if (this.tick++ % every === 0) {
        const hands = pose((this.now - began) / 1000);
        this.reader.push(handFrame(hands, this.now, { aspect: this.reader.aspect, jitter: this.jitter }));
      }
      this.last = this.reader.sample(this.now);
    }
    return this.last;
  }

  /** Holds the same hands for `seconds`. */
  hold(seconds: number, hands: readonly SynthHand[]): WheelOutput {
    return this.run(seconds, () => hands);
  }

  /** Holds a wheel pose for `seconds`. */
  wheel(seconds: number, pose: WheelPose): WheelOutput {
    return this.hold(seconds, wheelHands({ aspect: this.reader.aspect, ...pose }));
  }

  /** No hands in the picture for `seconds`. */
  empty(seconds: number): WheelOutput {
    return this.hold(seconds, []);
  }
}
