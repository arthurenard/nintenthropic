/**
 * The bolt-action rifle: five rounds, one in the chamber. After each shot
 * the spent case sits in the chamber until the bolt is worked - with the
 * hand, by raising the thumb again (the re-arm) - which takes BOLT_TIME and
 * feeds the next round, or leaves the bolt open on an empty magazine.
 * Nothing fires until the bolt is closed on a round. A clip strips five in
 * through the open action in RELOAD_TIME.
 */
import type { AmmoStyle } from "../../../engine/types";
import { BOLT_TIME, MAGAZINE, RELOAD_TIME } from "./tuning";

/**
 * - ready: closed on a live round;
 * - spent: closed on the case of the last shot, waiting for the bolt;
 * - cycling: the bolt being worked;
 * - open: back, on an empty magazine;
 * - reloading: a clip going in.
 */
export type BoltState = "ready" | "spent" | "cycling" | "open" | "reloading";

export type TriggerResult = "fired" | "spent" | "dry" | "busy";

export class Rifle {
  readonly capacity = MAGAZINE;
  /** Rounds left, the one in the chamber included. */
  rounds = MAGAZINE;
  state: BoltState = "ready";
  /** Seconds left of the bolt's working or the reload. */
  private left = 0;

  /** A live round is in the chamber and the bolt is closed on it. */
  get chambered(): boolean {
    return this.state === "ready" && this.rounds > 0;
  }

  get reloading(): boolean {
    return this.state === "reloading";
  }

  get cycling(): boolean {
    return this.state === "cycling";
  }

  /** The trigger: fires only with the bolt closed on a round. */
  trigger(): TriggerResult {
    if (this.state === "cycling" || this.state === "reloading") return "busy";
    if (this.state === "spent") return "spent";
    if (this.state === "open" || this.rounds <= 0) return "dry";
    this.rounds--;
    this.state = "spent";
    return "fired";
  }

  /** Work the bolt: from a spent case only. True when it starts. */
  cycle(): boolean {
    if (this.state !== "spent") return false;
    this.state = "cycling";
    this.left = BOLT_TIME;
    return true;
  }

  /** A clip in. Not while already reloading, nor with a full magazine and a round ready. */
  reload(): boolean {
    if (this.state === "reloading") return false;
    if (this.state === "ready" && this.rounds >= this.capacity) return false;
    this.state = "reloading";
    this.left = RELOAD_TIME;
    return true;
  }

  /** Time passes. Returns what finished this frame: the bolt closed (or opened on empty), or a reload. */
  update(dt: number): "cycled" | "opened" | "reloaded" | null {
    if (this.state !== "cycling" && this.state !== "reloading") return null;
    this.left -= dt;
    if (this.left > 0) return null;
    this.left = 0;
    if (this.state === "reloading") {
      this.rounds = this.capacity;
      this.state = "ready";
      return "reloaded";
    }
    this.state = this.rounds > 0 ? "ready" : "open";
    return this.state === "ready" ? "cycled" : "opened";
  }

  /** Back to a full magazine and a round in the chamber (a new game). */
  reset(): void {
    this.rounds = this.capacity;
    this.state = "ready";
    this.left = 0;
  }

  /** How the page's magazine should show it (HudSink.ammo's style). */
  style(): AmmoStyle {
    const action: AmmoStyle["action"] = this.state === "cycling" ? "cycling" : this.state === "open" || this.state === "reloading" ? "open" : "ready";
    return { kind: "magazine", chambered: this.chambered, action };
  }
}
