/**
 * Reading one hand for the wheel: where its palm is, how big it looks, and
 * whether it is a fist or open.
 *
 * Fist or open comes from the hand's WORLD landmarks (metric 3D), not the
 * picture. Held like a wheel, a fist shows the camera its knuckles or the
 * side of its fist, and an open hand for braking shows its palm: in the image
 * the fingers are foreshortened differently in each, but the distances between
 * the real points are the same whichever way the hand faces.
 */
import type { Landmark, SeenHand } from "../../tracking/types";

/** The wrist and the four knuckles across the palm: their mean is the palm's centre. */
export const PALM_POINTS = [0, 5, 9, 13, 17] as const;

/**
 * Each finger's tip and its middle joint (PIP), index to little finger. The
 * thumb is left out: held on top of a fist it sticks out or tucks in, and says
 * nothing about whether the hand is gripping.
 */
export const FINGER_JOINTS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
] as const;

/** Where the fist/open line is drawn. Every number is here so real hands can move it. */
export const GRIP = {
  /**
   * A finger is out when its tip is this many times farther from the wrist
   * than its middle joint. A straight finger is about 1.3 times, a curled one
   * 0.6-0.8 times, so 1.15 sits well clear of both.
   */
  outRatio: 1.15,
  /** Fingers out (of four) for a hand to count as open. */
  openFingers: 3,
  /** Fingers out for a fist: with two out the hand is neither, and keeps what it was (hysteresis). */
  fistFingers: 1,
  /** A hand changes between fist and open only after the new reading has lasted this long, seconds. */
  hold: 0.12,
  /**
   * ...and has been backed by at least this many frames, however few the camera gave in that time: a hand read on one
   * frame in three (three or four players on one camera) must not flip on a single misread frame.
   */
  frames: 2,
} as const;

export type GripState = "fist" | "open";

/** A change in waiting that no frame has backed for this long starts its hold again, seconds. */
const GAP = 0.25;

/** One hand, read from one camera frame. */
export interface HandReading {
  /** The palm's centre in the mirrored picture (as the player sees themself), 0..1, y down. */
  x: number;
  y: number;
  /** Wrist to middle knuckle, in picture heights (so it means the same on any camera shape). */
  size: number;
  /** Fingers out, 0..4. */
  fingers: number;
}

const distance = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The mean of the wrist and the four knuckles, in the camera's own picture (not mirrored). */
export function palmCentre(landmarks: readonly Landmark[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    const point = landmarks[i]!;
    x += point.x;
    y += point.y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

/**
 * How many of the four fingers are out: tip well beyond the middle joint, as
 * measured from the wrist in the world points.
 */
export function fingersOut(world: readonly Landmark[], outRatio: number = GRIP.outRatio): number {
  const wrist = world[0]!;
  let out = 0;
  for (const [tip, pip] of FINGER_JOINTS) {
    const reach = distance(world[tip]!, wrist);
    const middle = distance(world[pip]!, wrist);
    if (middle > 0 && reach > middle * outRatio) out++;
  }
  return out;
}

/**
 * Where a hand's palm is, and nothing else yet (`size` and `fingers` are 0 until `finishReading`): all that is needed to
 * tell whose column of a shared picture a hand is in, which is asked of every hand in the frame, the other players' too.
 */
export function readPalm(hand: SeenHand): HandReading {
  const centre = palmCentre(hand.landmarks);
  return { x: 1 - centre.x, y: centre.y, size: 0, fingers: 0 };
}

/** The rest of a reading begun with `readPalm`, for a hand that counts. */
export function finishReading(reading: HandReading, hand: SeenHand, aspect: number): HandReading {
  const wrist = hand.landmarks[0]!;
  const knuckle = hand.landmarks[9]!;
  reading.size = Math.hypot((knuckle.x - wrist.x) * aspect, knuckle.y - wrist.y);
  reading.fingers = fingersOut(hand.world);
  return reading;
}

/**
 * Reads a hand. `aspect` is the picture's width over its height: the image
 * points are fractions of each, so a distance only means something once x is
 * stretched back by it.
 */
export function readHand(hand: SeenHand, aspect: number): HandReading {
  return finishReading(readPalm(hand), hand, aspect);
}

/**
 * One hand's fist-or-open, steadied. The finger count has a dead band (two
 * fingers out is neither) and a change has to last GRIP.hold before it counts:
 * a single misread frame, or a hand on its way from fist to open, never
 * flickers the state.
 */
export class Grip {
  /** Null until the hand has been seen once. */
  state: GripState | null = null;
  /**
   * When the current state's reading first appeared (the start of the hold,
   * not the moment it was accepted), seconds. A flick's length is measured from here.
   */
  since = 0;
  private pending: GripState | null = null;
  private pendingSince = 0;
  private pendingLast = 0;
  private pendingFrames = 0;
  /** Frames in a row that backed the state (1 on first sight): a state not yet backed twice is a guess, not a grip. */
  private agreeing = 0;

  /**
   * Has the state been seen on two frames (or arrived by a change that held)? A hand's first frame back in the picture
   * is the one most likely misread, and takes the state at once; it is not braked on until a second frame says the same.
   */
  get steady(): boolean {
    return this.state !== null && this.agreeing >= GRIP.frames;
  }

  /** Feeds one frame's finger count; returns true when the state changed. */
  update(fingers: number, now: number, hold: number = GRIP.hold): boolean {
    const reading: GripState | null = fingers >= GRIP.openFingers ? "open" : fingers <= GRIP.fistFingers ? "fist" : null;
    if (this.state === null) {
      // First sight: take what is there at once, there is nothing to hold against.
      this.state = reading ?? "fist";
      this.since = now;
      this.agreeing = 1;
      return true;
    }
    if (reading === null) return false; // in the dead band: a change under way waits
    if (reading === this.state) {
      this.pending = null;
      this.agreeing++;
      return false;
    }
    // A change under way that has gone unsupported for a while (a hand that sat
    // in the dead band) starts its hold again.
    if (this.pending !== reading || now - this.pendingLast > GAP) {
      this.pending = reading;
      this.pendingSince = now;
      this.pendingFrames = 0;
    }
    this.pendingLast = now;
    this.pendingFrames++;
    if (now - this.pendingSince >= hold && this.pendingFrames >= GRIP.frames) {
      this.state = reading;
      this.since = this.pendingSince;
      this.pending = null;
      this.agreeing = this.pendingFrames;
      return true;
    }
    return false;
  }

  /** Forgets everything: the next sight of the hand is a first sight. */
  reset(): void {
    this.state = null;
    this.pending = null;
    this.since = 0;
    this.agreeing = 0;
    this.pendingFrames = 0;
  }
}
