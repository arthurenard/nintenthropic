import { LEVER_TIME, RELOAD_LEVER, RIFLE_CAPACITY, ROUND_TIME } from "./tuning";

export type TriggerResult = "fired" | "dry" | "busy";

/** The lever-action's action, as the HUD's magazine shows it. */
export type Action = "ready" | "cycling" | "open";

/** What happened to the rifle this frame, for the sounds and the HUD. */
export interface RifleEvents {
  /** A reload began by the gesture (R is the caller's own: reload() says it started). */
  started: boolean;
  /** Rounds thumbed into the gate this frame (one a sound). */
  roundsIn: number;
  /** The lever was worked and a round chambered (after a shot, or to finish a reload). */
  chambered: boolean;
  /** The reload is done. */
  done: boolean;
}

/**
 * Eight rounds and a lever. Each shot works the lever (a short moment in
 * which it cannot fire); the last shot leaves the action open on an empty
 * chamber, and pulling the trigger then clicks dry. Reloading - pointing off
 * the screen, or R - thumbs the rounds in one at a time through the loading
 * gate, and, if the chamber was empty, works the lever at the end: an
 * empty rifle takes 1.2 s to load. A reload runs to the end once begun.
 */
export class Rifle {
  readonly capacity = RIFLE_CAPACITY;
  /** Rounds in the gun, the chambered one included. */
  rounds = RIFLE_CAPACITY;
  /** The chamber holds a live round, ready to fire. */
  chambered = true;
  /** Seconds left working the lever. */
  cycling = 0;
  reloading = false;
  /** Seconds to the next round going in (or, with the tube full, to the reload's end). */
  private reloadNext = 0;
  /** The reload must work the lever at its end: it began with the chamber empty. */
  private leverAfter = false;
  private wasOffscreen = false;
  readonly events: RifleEvents = { started: false, roundsIn: 0, chambered: false, done: false };

  get action(): Action {
    if (this.cycling > 0) return "cycling";
    return this.chambered ? "ready" : "open";
  }

  trigger(): TriggerResult {
    if (this.reloading || this.cycling > 0) return "busy";
    if (!this.chambered || this.rounds <= 0) return "dry";
    this.rounds--;
    this.chambered = false;
    // The lever is worked straight away; with the tube empty it stays open.
    this.cycling = this.rounds > 0 ? LEVER_TIME : 0;
    return "fired";
  }

  /** Start a reload if there is anything to load. Returns whether it started. */
  reload(): boolean {
    if (this.reloading || this.rounds >= this.capacity) return false;
    this.reloading = true;
    // A lever still coming back finishes first.
    this.reloadNext = Math.max(this.cycling, 0) + ROUND_TIME;
    this.leverAfter = false;
    return true;
  }

  /**
   * Advance the lever and the reload, and watch the gesture: only the moment
   * the aim leaves the screen reloads, not every frame it stays off it.
   */
  update(dt: number, offscreen: boolean): RifleEvents {
    const e = this.events;
    e.started = false;
    e.roundsIn = 0;
    e.chambered = false;
    e.done = false;
    if (offscreen && !this.wasOffscreen && this.reload()) e.started = true;
    this.wasOffscreen = offscreen;
    if (this.cycling > 0) {
      this.cycling -= dt;
      if (this.cycling <= 0) {
        this.cycling = 0;
        if (this.rounds > 0 && !this.chambered) {
          this.chambered = true;
          e.chambered = true;
        }
      }
    }
    if (!this.reloading) return e;
    this.reloadNext -= dt;
    while (this.reloadNext <= 0 && this.reloading) {
      if (this.rounds < this.capacity) {
        this.rounds++;
        e.roundsIn++;
        if (!this.chambered) this.leverAfter = true;
        this.reloadNext += this.rounds < this.capacity ? ROUND_TIME : this.leverAfter ? RELOAD_LEVER : 0;
        if (this.rounds >= this.capacity && !this.leverAfter) this.finish(e);
      } else {
        // The last round is in; the lever chambers one.
        this.chambered = true;
        e.chambered = true;
        this.finish(e);
      }
    }
    return e;
  }

  private finish(e: RifleEvents): void {
    this.reloading = false;
    this.reloadNext = 0;
    this.leverAfter = false;
    this.cycling = 0;
    e.done = true;
  }

  reset(): void {
    this.rounds = this.capacity;
    this.chambered = true;
    this.cycling = 0;
    this.reloading = false;
    this.reloadNext = 0;
    this.leverAfter = false;
    this.wasOffscreen = false;
  }
}
