/**
 * The finger pistol as an InputSource: HandFrames in, one Aim per new camera
 * frame out, read by the engine every animation frame.
 */
import type { Aim, InputSource } from "../engine/types";
import type { HandFrame, HandSource } from "../tracking/types";
import { AimController, Recoil, type AimReading } from "./aim";
import { Velocity } from "./filter";
import { palmSpan } from "./hand";
import type { Matrix } from "./homography";

/** How far past an edge the crosshair must go to count as off the screen, in
 * viewport fractions; it counts as back once within half of that. */
export const OFFSCREEN_MARGIN = 0.04;
/** Extrapolation never looks further ahead than this, in ms. */
export const MAX_PREDICTION = 60;
/** A fold under this is still aiming; past it the hand moves with the shot. */
const STILL_AIMING = 0.35;
/** How long the aim from before a fold is trusted as the shot's aim, in ms. */
const AIM_MEMORY = 300;

/** One camera frame's reading, for the aim check. */
export interface HandReading extends AimReading {
  frame: HandFrame;
  /** The hand's size in the picture, for the aim check's distance tip. */
  span: number | undefined;
}

export interface Viewport {
  width: number;
  height: number;
}

export class HandInput implements InputSource {
  readonly kind = "hand" as const;
  readonly controller: AimController;
  /** Extrapolate the crosshair by the tracking delay (see sample). */
  compensate = true;
  /** Every camera frame's reading, for the aim check. */
  onReading: ((reading: HandReading) => void) | null = null;

  private readonly unsubscribe: () => void;
  private readonly vx = new Velocity();
  private readonly vy = new Velocity();
  // A short kick, settling in about 250 ms, as High Noon's revolver asks:
  // in fractions of the smaller side of the view.
  private readonly recoil = new Recoil({ kick: 0.022, rise: 0.035, decay: 0.07 });
  private reading: AimReading | null = null;
  private capturedAt = 0;
  private last: [number, number] = [0.5, 0.5];
  private offscreen = false;
  private firedPending = false;
  private shotAt: [number, number] | null = null;
  private held: { at: number; position: [number, number] } | null = null;

  constructor(
    private readonly source: HandSource,
    private readonly viewport: () => Viewport,
    mapping?: Matrix,
  ) {
    this.controller = new AimController({ mapping });
    this.unsubscribe = source.subscribe((frame) => this.onFrame(frame));
  }

  /** The aim learned by the aim check (or saved from before). */
  setMapping(mapping: Matrix): void {
    this.controller.setMapping(mapping);
    this.vx.reset();
    this.vy.reset();
  }

  /** Forget the hand (after a pause), so no stale fold fires on return. */
  reset(): void {
    this.controller.reset();
    this.vx.reset();
    this.vy.reset();
    this.recoil.reset();
    this.reading = null;
    this.firedPending = false;
    this.offscreen = false;
    this.held = null;
  }

  private onFrame(frame: HandFrame): void {
    const time = frame.capturedAt / 1000;
    const reading = this.controller.update(frame.landmarks, time);
    this.reading = reading;
    this.capturedAt = frame.capturedAt;
    const at = reading.unclamped;
    if (at) {
      this.vx.update(at[0], time);
      this.vy.update(at[1], time);
      // Off the screen is decided on the unclamped aim, before it is pinned
      // to the edge, with a little hysteresis so a hand resting on the
      // margin does not flicker in and out.
      const beyond = Math.max(-at[0], at[0] - 1, -at[1], at[1] - 1);
      if (!this.offscreen && beyond > OFFSCREEN_MARGIN) this.offscreen = true;
      else if (this.offscreen && beyond < OFFSCREEN_MARGIN / 2) this.offscreen = false;
      // The aim just before the thumb began to fold: where the shot goes,
      // since the hand moves with the fold.
      if (reading.armed && reading.travel < STILL_AIMING) this.held = { at: frame.capturedAt, position: at };
    } else {
      this.vx.reset();
      this.vy.reset();
    }
    if (reading.fired) {
      this.firedPending = true;
      const recent = this.held && frame.capturedAt - this.held.at <= AIM_MEMORY ? this.held.position : at;
      this.shotAt = recent ? [...recent] : null;
      this.recoil.fire(time);
    }
    this.onReading?.({
      ...reading,
      frame,
      span: frame.landmarks ? palmSpan(frame.landmarks) : undefined,
    });
  }

  /**
   * The latest aim. With `compensate` on, the crosshair is carried forward
   * along the filtered aim's velocity by the time since the camera took the
   * frame (at most MAX_PREDICTION), so between camera frames it keeps moving
   * with the hand instead of stepping at 30 Hz behind it.
   */
  sample(now: number): Aim {
    const reading = this.reading;
    const fired = this.firedPending;
    this.firedPending = false;
    if (!reading?.unclamped) {
      return {
        x: this.last[0],
        y: this.last[1],
        tracking: false,
        armed: reading?.armed ?? false,
        fired: false,
        travel: 0,
        offscreen: false,
        capturedAt: this.capturedAt,
      };
    }
    const ahead = this.compensate ? Math.min(Math.max(now - this.capturedAt, 0), MAX_PREDICTION) / 1000 : 0;
    let [x, y] = fired && this.shotAt ? this.shotAt : reading.unclamped;
    if (!fired) {
      x += this.vx.value * ahead;
      y += this.vy.value * ahead;
    }
    const { width, height } = this.viewport();
    const side = Math.min(width, height) || 1;
    const kick = this.recoil.offset(now / 1000)[1];
    if (!fired) y += (kick * side) / (height || 1);
    this.last = [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
    return {
      x: this.last[0],
      y: this.last[1],
      tracking: true,
      armed: reading.armed,
      fired,
      travel: reading.travel,
      offscreen: this.offscreen,
      capturedAt: this.capturedAt,
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.onReading = null;
  }
}
