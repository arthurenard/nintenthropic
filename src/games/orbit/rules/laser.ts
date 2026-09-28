/**
 * The station's point-defence laser. It never runs out: every shot adds
 * heat, a burst fills the gauge quickly, and at the top it overheats and
 * locks for 2.5 s. Pointing off the screen (or V) vents it at once - the
 * same gesture as reloading in the other games - emptying the gauge in a
 * breath and cutting a lock short. Left alone it cools by itself.
 */
import { COOL_DELAY, COOL_RATE, HEAT_PER_SHOT, OVERHEAT_LOCK, SHOT_INTERVAL, VENT_TIME } from "./tuning";

export type LaserResult = "fired" | "overheated" | "venting" | "rhythm";

export class Laser {
  /** 0 cold .. 1 too hot to fire. */
  heat = 0;
  /** Seconds left locked after an overheat (unless vented sooner). */
  lockLeft = 0;
  /** Seconds left of a vent in progress. */
  ventLeft = 0;
  private since = Infinity;
  private ventFrom = 0;
  private wasOffscreen = false;
  /** The aim check's shots: fire, but add no heat. */
  cold = false;

  constructor(
    /** Multiplies the heat each shot adds (the difficulty's). */
    private readonly heatFactor = 1,
  ) {}

  /** Overheated: locked until it cools or is vented. */
  get locked(): boolean {
    return this.lockLeft > 0;
  }

  get venting(): boolean {
    return this.ventLeft > 0;
  }

  /** What the gauge shows as "cannot fire, cooling": a lock or a vent. */
  get cooling(): boolean {
    return this.locked || this.venting;
  }

  /** The finger folds (or the mouse clicks). */
  trigger(): LaserResult {
    if (this.venting) return "venting";
    if (this.locked) return "overheated";
    if (this.since < SHOT_INTERVAL) return "rhythm";
    this.since = 0;
    if (!this.cold) {
      this.heat = Math.min(1, this.heat + HEAT_PER_SHOT * this.heatFactor);
      // Rounding: the shot that reaches the top is the one that locks it.
      if (this.heat >= 0.999) {
        this.heat = 1;
        this.lockLeft = OVERHEAT_LOCK;
      }
    }
    return "fired";
  }

  /** Vent now, if there is anything to vent. Returns whether it started. */
  vent(): boolean {
    if (this.venting || (this.heat < 0.02 && !this.locked)) return false;
    this.ventLeft = VENT_TIME;
    this.ventFrom = this.heat;
    return true;
  }

  /**
   * Time passes; `offscreen` is the aim this frame (its first frame off the
   * screen vents). Returns what changed: "vent" when a vent starts (by the
   * gesture), "vented" when one ends, "cooled" when a lock runs out by itself.
   */
  update(dt: number, offscreen: boolean): "vent" | "vented" | "cooled" | null {
    let event: "vent" | "vented" | "cooled" | null = null;
    if (offscreen && !this.wasOffscreen && this.vent()) event = "vent";
    this.wasOffscreen = offscreen;
    this.since += dt;
    if (this.ventLeft > 0) {
      this.ventLeft = Math.max(0, this.ventLeft - dt);
      this.heat = this.ventFrom * (this.ventLeft / VENT_TIME);
      if (this.ventLeft === 0) {
        this.heat = 0;
        this.lockLeft = 0;
        event = "vented";
      }
      return event;
    }
    if (this.lockLeft > 0) {
      this.lockLeft = Math.max(0, this.lockLeft - dt);
      // Locked, it still cools, and is cold enough to fire again when the lock ends.
      this.heat = Math.max(0.35, 1 - (1 - this.lockLeft / OVERHEAT_LOCK) * 0.65);
      if (this.lockLeft === 0) event = "cooled";
      return event;
    }
    if (this.since > COOL_DELAY) this.heat = Math.max(0, this.heat - COOL_RATE * dt);
    return event;
  }

  reset(): void {
    this.heat = 0;
    this.lockLeft = 0;
    this.ventLeft = 0;
    this.since = Infinity;
    this.wasOffscreen = false;
  }
}
