/**
 * The finger pistol as an InputSource: HandFrames in, one Aim per new camera
 * frame out, read by the engine every animation frame.
 */
import type { Aim, InputSource } from "../engine/types";
import type { HandFrame, HandSource } from "../tracking/types";
import { AimController, Recoil, type AimReading } from "./aim";
import { Velocity } from "./filter";
import { palmSpan } from "./hand";
import { apply, type Matrix } from "./homography";
import type { ScopeControl } from "./scope";
import { HandTrust } from "./trust";

/** How far past an edge the crosshair must go to count as off the screen, in
 * viewport fractions; it counts as back once within half of that. */
export const OFFSCREEN_MARGIN = 0.04;
/** Extrapolation never looks further ahead than this, in ms. */
export const MAX_PREDICTION = 60;
/**
 * A camera frame older than this is not a hand, in ms. A camera that stops
 * delivering frames (unplugged, asleep, taken by another app) leaves its last
 * frame behind; without this the crosshair would stand there, "tracking", and
 * the game would never know the hand had gone.
 */
export const STALE_FRAME = 400;
/**
 * How long a hand that left the picture across an edge still counts as
 * pointing off the screen, in ms: swinging the hand away is High Noon's
 * reload, and the camera loses the hand the moment it leaves the picture.
 */
export const EXIT_MOMENT = 1200;
/** A fingertip this close to the picture's edge, in fractions of it, is on its way out. */
export const EXIT_EDGE = 0.04;
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
  private readonly unsubscribeFace: () => void = () => {};
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
  /** Whether the aim was off the screen on the frame the shot was taken on. */
  private shotOffscreen = false;
  private held: { at: number; position: [number, number] } | null = null;
  /** When the hand was last seen, and whether it was then on its way out of the picture. */
  private seen: { at: number; leaving: boolean } | null = null;
  /** Keeps the aim on the player's hand when another comes into the picture. */
  private readonly trust = new HandTrust();

  constructor(
    private readonly source: HandSource,
    private readonly viewport: () => Viewport,
    mapping?: Matrix,
    /**
     * The scope, in a game that has one: Shift, and - when it reads the
     * eye - the face on the same frames, closing one eye (scope.ts).
     */
    private readonly scope: ScopeControl | null = null,
  ) {
    this.controller = new AimController({ mapping });
    this.unsubscribe = source.subscribe((frame) => this.onFrame(frame));
    const eye = scope?.eye;
    if (eye && source.subscribeFace) this.unsubscribeFace = source.subscribeFace((face) => eye.read(face.eyes, face.capturedAt));
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
    this.seen = null;
    this.trust.reset();
    this.scope?.reset();
  }

  private onFrame(frame: HandFrame): void {
    const time = frame.capturedAt / 1000;
    // A hand that turns up far from the player's (someone else's, most
    // likely) is no hand until it has stayed a moment: it moves no aim and
    // fires nothing. One that stays is followed from scratch - its aim not
    // slid over from the last hand's, its thumb raised before it can fire.
    const judged = this.trust.judge(frame.landmarks, frame.capturedAt);
    const hand = judged === "trusted" || judged === "adopted" ? frame.landmarks : null;
    if (judged === "adopted") {
      this.controller.reset();
      this.held = null;
    }
    const reading = this.controller.update(hand, time);
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
      // Leaving: pointing past the view's edge - by the filtered aim, or the
      // raw one, which a fast swing takes there a frame or two sooner - or
      // the fingertip at the picture's own edge, about to be cut off by it.
      const tip = reading.pointer;
      const raw = tip ? apply(this.controller.currentMapping, tip) : null;
      const rawBeyond = raw ? Math.max(-raw[0], raw[0] - 1, -raw[1], raw[1] - 1) : 0;
      const edge = tip ? Math.min(tip[0], 1 - tip[0], tip[1], 1 - tip[1]) : 1;
      this.seen = { at: frame.capturedAt, leaving: this.offscreen || rawBeyond > OFFSCREEN_MARGIN || edge < EXIT_EDGE };
    } else {
      this.vx.reset();
      this.vy.reset();
    }
    if (reading.fired) {
      this.firedPending = true;
      const recent = this.held && frame.capturedAt - this.held.at <= AIM_MEMORY ? this.held.position : at;
      this.shotAt = recent ? [...recent] : null;
      this.shotOffscreen = this.offscreen;
      this.recoil.fire(time);
    }
    this.onReading?.({
      ...reading,
      frame,
      span: hand ? palmSpan(hand) : undefined,
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
    const scope = this.scope?.active(now) ?? false;
    const stale = now - this.capturedAt > STALE_FRAME;
    if (fired && this.shotAt && !reading?.unclamped && !stale) {
      // The frame after the shot lost the hand (the tracker drops one most often mid-fold), and came before this
      // read: the shot is the trigger's all the same, and goes where it was aimed.
      this.last = [Math.min(Math.max(this.shotAt[0], 0), 1), Math.min(Math.max(this.shotAt[1], 0), 1)];
      return {
        x: this.last[0],
        y: this.last[1],
        tracking: true,
        armed: false,
        fired: true,
        travel: 1,
        offscreen: this.shotOffscreen,
        capturedAt: this.capturedAt,
        scope,
      };
    }
    if (!reading?.unclamped || stale) {
      // A hand last seen leaving the picture across an edge was swung off
      // the screen, and says so for a moment; one that simply vanished
      // mid-view (or a camera gone quiet) is only lost.
      const seen = this.seen;
      const gone = seen ? now - seen.at : Number.POSITIVE_INFINITY;
      return {
        x: this.last[0],
        y: this.last[1],
        tracking: false,
        armed: reading?.armed ?? false,
        fired: false,
        travel: 0,
        offscreen: seen !== null && seen.leaving && gone <= EXIT_MOMENT,
        capturedAt: this.capturedAt,
        scope,
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
      scope,
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeFace();
    this.onReading = null;
  }
}
