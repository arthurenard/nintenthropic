/**
 * The events a screen has not seen yet. The sim hands them out once, but a
 * guest hears of some twice (the reliable batch and, after a reconnect, a
 * snapshot's replay): here each id is let through once, and `drain` gives the
 * frame what arrived since the last frame, oldest first.
 */
import type { RaceEvent } from "../contract";

/** Remembered ids; far more than a second's worth, far less than a race. */
const REMEMBER = 1024;

export class EventFeed {
  private waiting: RaceEvent[] = [];
  private seen = new Set<number>();

  push(events: readonly RaceEvent[]): void {
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      this.waiting.push(event);
      if (this.seen.size > REMEMBER) {
        // Sets iterate in insertion order: this forgets the oldest.
        this.seen.delete(this.seen.values().next().value as number);
      }
    }
    // A screen that stops drawing (a hidden tab) must not pile up events for ever.
    if (this.waiting.length > 512) this.waiting.splice(0, this.waiting.length - 512);
  }

  drain(): RaceEvent[] {
    const out = this.waiting;
    this.waiting = [];
    return out;
  }

  clear(): void {
    this.waiting = [];
    this.seen.clear();
  }
}
