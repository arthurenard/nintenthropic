import { RELOAD_TIME, REVOLVER_CAPACITY } from "./tuning";

export type TriggerResult = "fired" | "dry" | "reloading";

/**
 * Six rounds and a cylinder. Reloading is the arcade classic — point off the
 * screen — or the R key; either way it takes 0.9 s and cannot be cut short.
 */
export class Revolver {
  readonly capacity = REVOLVER_CAPACITY;
  rounds = REVOLVER_CAPACITY;
  reloading = false;
  /** Seconds left on the current reload. */
  reloadLeft = 0;
  /** The last frame's offscreen flag, so only the moment the aim leaves reloads. */
  private wasOffscreen = false;

  trigger(): TriggerResult {
    if (this.reloading) return "reloading";
    if (this.rounds <= 0) return "dry";
    this.rounds--;
    return "fired";
  }

  /** Start a reload if there is anything to reload. Returns whether it started. */
  reload(): boolean {
    if (this.reloading || this.rounds >= this.capacity) return false;
    this.reloading = true;
    this.reloadLeft = RELOAD_TIME;
    return true;
  }

  /**
   * Advance the reload and watch the gesture. Returns "started" or "done" on
   * the frames those happen, so the caller can play the cylinder's sounds.
   */
  update(dt: number, offscreen: boolean): "started" | "done" | null {
    let result: "started" | "done" | null = null;
    if (offscreen && !this.wasOffscreen && this.reload()) result = "started";
    this.wasOffscreen = offscreen;
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloading = false;
        this.reloadLeft = 0;
        this.rounds = this.capacity;
        result = "done";
      }
    }
    return result;
  }

  reset(): void {
    this.rounds = this.capacity;
    this.reloading = false;
    this.reloadLeft = 0;
    this.wasOffscreen = false;
  }
}
