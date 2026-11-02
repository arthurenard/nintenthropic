/**
 * "Move Left": a player's hands are nearing the edge of the camera's view (input/edges.ts says which way to move them
 * back in). The note comes once the hands have been near the edge a moment, so a fist swung out in a hard turn and
 * straight back does not flash it, and it stays a little after they are back in, so it does not flicker on the line.
 * Pure: fed the way and the time.
 */
import type { EdgeWay } from "../contract";

/** Near the edge this long, ms, before the note comes. */
export const EDGE_AFTER = 250;
/** Back in this long, ms, before it goes. */
export const EDGE_KEEP = 600;

export class EdgeHint {
  private way: EdgeWay | null = null;
  private since = 0;
  private clearSince: number | null = null;
  /** The way the note says now, or null when there is none. */
  shown: EdgeWay | null = null;

  /** The way the wheel says now (null: well inside, or the hands are lost and another note says so). */
  update(way: EdgeWay | null, now: number): EdgeWay | null {
    if (way !== this.way) {
      this.way = way;
      this.since = now;
    }
    if (way) {
      this.clearSince = null;
      if (now - this.since >= EDGE_AFTER) this.shown = way;
    } else if (this.shown) {
      this.clearSince ??= now;
      if (now - this.clearSince >= EDGE_KEEP) this.shown = null;
    }
    return this.shown;
  }

  reset(): void {
    this.way = null;
    this.shown = null;
    this.clearSince = null;
  }
}

/** What the note says for each way. */
export const EDGE_WORDS: Readonly<Record<EdgeWay, string>> = {
  left: "Move Left",
  right: "Move Right",
  down: "Lower Your Hands",
  up: "Raise Your Hands",
};
