/**
 * Smooths the aim and turns the thumb's fold into discrete shots (a port of
 * the desktop's AimController and Recoil, for the browser's single camera).
 */
import { MedianOf3, PointFilter, type Point } from "./filter";
import { apply, boxMapping, type Matrix } from "./homography";
import { pointer as fingertip, thumbPull, type Hand } from "./hand";

/** Before any aim has been learned: the fingertip's usual sweep, stretched
 * over the screen (as the desktop's default). */
export const DEFAULT_MAPPING: Matrix = boxMapping([0.15, 0.15], [0.85, 0.85]);

/**
 * How far past the screen's edge the filter may follow the hand, in viewport
 * fractions. Far enough that "pointing off the screen" is seen for what it is
 * (the reload gesture), near enough that coming back is not a long slide in
 * from nowhere.
 */
export const REACH_BEYOND = 0.25;

/** The aiming state after one camera frame. */
export interface AimReading {
  /** Filtered, in viewport fractions, clamped to the screen; null without a hand. */
  position: [number, number] | null;
  /** Filtered but not clamped: how far past an edge the hand is pointing. */
  unclamped: [number, number] | null;
  /** The fingertip in the mirrored camera image, unfiltered: what the aim check fits. */
  pointer: Point | null;
  /** Thumb up: ready to fire. */
  armed: boolean;
  /** The thumb dropped on this very frame. */
  fired: boolean;
  /** The thumb's fold, 0 up to 1 folded (see thumbPull). */
  travel: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export interface AimOptions {
  fireAbove?: number;
  armBelow?: number;
  minCutoff?: number;
  beta?: number;
  mapping?: Matrix;
}

/**
 * The trigger is the built-in thumb gesture, thumbPull: the same for every
 * player and every hand size, so it needs no setup. It fires once the fold
 * passes `fireAbove` and will not fire again until the thumb has come back up
 * under `armBelow`. The gap between the two lines is what keeps a thumb
 * wobbling on either of them from firing twice.
 */
export class AimController {
  /**
   * How long the hand may vanish, in seconds, before the trigger forgets its
   * state. Trackers drop a frame now and then, and a hand is likeliest to be
   * lost mid-fold, when the thumb blurs. Resetting on a single missing frame
   * disarms the gun, which turns the shot into nothing. A brief gap is
   * bridged instead.
   */
  static readonly GRACE = 0.3;

  readonly fireAbove: number;
  readonly armBelow: number;
  private mapping: Matrix;
  private readonly filter: PointFilter;
  // The median-of-three guards the thumb against one misread frame.
  private readonly travel = new MedianOf3();
  // Not armed until the thumb has been seen up: a hand first seen already
  // folded must not fire the moment it is acquired.
  private armed = false;
  private lastSeen: number | null = null;

  constructor(options: AimOptions = {}) {
    this.fireAbove = options.fireAbove ?? 0.5;
    this.armBelow = options.armBelow ?? 0.3;
    if (this.armBelow >= this.fireAbove) throw new RangeError("armBelow must be under fireAbove to give hysteresis");
    this.filter = new PointFilter(options.minCutoff ?? 1.2, options.beta ?? 0.8);
    this.mapping = options.mapping ?? DEFAULT_MAPPING;
  }

  get currentMapping(): Matrix {
    return this.mapping;
  }

  /** A new aim fit must not interpolate from the previous mapping. */
  setMapping(mapping: Matrix): void {
    this.mapping = mapping;
    this.filter.reset();
  }

  /** One camera frame's hand (null if none was seen), at `time` seconds. */
  update(hand: Hand | null, time: number): AimReading {
    const pointed = hand ? fingertip(hand) : null;
    const mapped = pointed ? apply(this.mapping, pointed) : null;
    // A hand the map cannot place - past its horizon, or a non-finite
    // reading - counts as no hand this frame. Anything else would put the
    // crosshair on the wrong side of the screen, or feed the filter a NaN it
    // would carry for the rest of the game.
    if (!hand || !pointed || !mapped || !mapped.every(Number.isFinite)) {
      const goneFor = this.lastSeen === null ? Number.POSITIVE_INFINITY : time - this.lastSeen;
      if (goneFor > AimController.GRACE) {
        // Properly lost. Forget everything, so a shot never fires on
        // re-acquisition from a stale stroke.
        this.filter.reset();
        this.travel.reset();
        this.armed = false;
      }
      return { position: null, unclamped: null, pointer: pointed, armed: this.armed, fired: false, travel: 0 };
    }
    this.lastSeen = time;
    const limited: Point = [
      clamp(mapped[0], -REACH_BEYOND, 1 + REACH_BEYOND),
      clamp(mapped[1], -REACH_BEYOND, 1 + REACH_BEYOND),
    ];
    const unclamped = this.filter.filter(limited, time);
    const travel = this.travel.filter(thumbPull(hand));
    const fired = this.armed && travel > this.fireAbove;
    if (fired) this.armed = false;
    else if (travel < this.armBelow) this.armed = true;
    return {
      position: [clamp(unclamped[0], 0, 1), clamp(unclamped[1], 0, 1)],
      unclamped,
      pointer: pointed,
      armed: this.armed,
      fired,
      travel,
    };
  }

  /** Forget the hand entirely: after a pause, or when the aim check starts. */
  reset(): void {
    this.filter.reset();
    this.travel.reset();
    this.armed = false;
    this.lastSeen = null;
  }
}

/**
 * The kick that follows a shot.
 *
 * The crosshair jumps up and settles back over a couple of hundred
 * milliseconds, so firing as fast as the thumb allows genuinely costs accuracy
 * instead of being free. Shots stack, up to a cap. Units are the caller's:
 * the hand input uses fractions of the viewport's smaller side.
 */
export class Recoil {
  readonly kick: number;
  readonly rise: number;
  readonly decay: number;
  shots: number[] = [];

  constructor({ kick = 26, rise = 0.04, decay = 0.22 }: { kick?: number; rise?: number; decay?: number } = {}) {
    this.kick = Math.max(0, kick);
    this.rise = Math.max(rise, 1e-3);
    this.decay = Math.max(decay, 1e-3);
  }

  private get memory(): number {
    return this.rise + 6 * this.decay;
  }

  fire(now: number): void {
    if (!this.kick) return; // nothing to remember: with no kick the list would only grow
    this.shots.push(now);
  }

  /** How far to move the aim point: up is negative, as on screen. */
  offset(now: number): [number, number] {
    this.shots = this.shots.filter((t) => now - t < this.memory);
    if (!this.kick) return [0, 0];
    let total = 0;
    for (const shot of this.shots) {
      const age = now - shot;
      if (age < 0) continue;
      total += age < this.rise ? (this.kick * age) / this.rise : this.kick * Math.exp(-(age - this.rise) / this.decay);
    }
    return [0, total > 0 ? -Math.min(total, 2.5 * this.kick) : 0];
  }

  reset(): void {
    this.shots = [];
  }
}
