/**
 * Teaching the item. A player who has never used one is told how, in their
 * own viewport beside the item slot, in the words of what they drive with:
 * when they first hold an item, and again each time they have held one for
 * HINT_EVERY seconds without using it. Using one is learning it: that player
 * is never told again this session (the page's lifetime, across races).
 */
import type { ControlKind } from "../contract";

/** How long the words stay up each time, seconds. */
export const HINT_ON = 4.5;
/** Held this long without being used, seconds, and the words come back. */
export const HINT_EVERY = 8;

export function hintWords(kind: ControlKind): string {
  switch (kind) {
    case "wheel":
      return "Flick one hand open to use it.";
    case "keyboard":
      return "Press E to use it.";
    case "gamepad":
      return "Press B to use it.";
  }
}

/** Whether the words show after holding an item for `heldFor` seconds. */
export function hintVisible(heldFor: number, taught: boolean): boolean {
  if (taught || heldFor < 0) return false;
  return heldFor % HINT_EVERY < HINT_ON;
}

/** Who has used an item this session, by player slot (or kart id for one with no slot). */
const taughtThisSession = new Set<number>();

export function markTaught(who: number): void {
  taughtThisSession.add(who);
}

export function isTaught(who: number): boolean {
  return taughtThisSession.has(who);
}

/** Forgets everyone (a new session, and the tests). */
export function forgetTaught(): void {
  taughtThisSession.clear();
}

/** One viewport's hint, stepped once a frame. */
export class ItemHint {
  private heldFor = -1;

  /** `holding`: an item is in hand and its roulette has stopped. Returns whether the words show. */
  step(who: number, holding: boolean, dt: number): boolean {
    if (!holding) {
      this.heldFor = -1;
      return false;
    }
    this.heldFor = this.heldFor < 0 ? 0 : this.heldFor + dt;
    return hintVisible(this.heldFor, isTaught(who));
  }

  /** A new race. */
  reset(): void {
    this.heldFor = -1;
  }
}
