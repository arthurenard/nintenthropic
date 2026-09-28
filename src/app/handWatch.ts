/**
 * Keeps a round fair when the hand goes. A bandit's shots do not wait for a
 * camera that lost the player's hand, so a hand gone for longer than any
 * reload's swing out of the picture freezes the round; once the hand has
 * been seen steadily again a short 3-2-1 brings it back, and a hand that
 * drops during the count goes back to waiting.
 *
 * Only the timing lives here, fed whether the hand is seen each tick; the
 * page decides what freezing and resuming mean.
 */

/** The hand gone this long in play freezes the round, ms. Longer than
 * HandInput's EXIT_MOMENT, so swinging out of the picture to reload never does. */
export const LOST_AFTER = 1500;
/** Seen this long without a break, the hand is back, ms. */
export const STEADY_FOR = 500;
/** Each beat of the 3-2-1, ms. */
export const BEAT = 500;
/** A gap shorter than this is a frame the tracker dropped, not a hand gone, ms. */
export const DROP = 250;
/** Resuming from the pause sheet: how long to look for the hand before asking for it, ms. */
export const QUIET = 400;

export type HandWatchState = "watching" | "waiting" | "counting";

export type HandWatchEvent =
  /** Freeze the round and ask for the hand. */
  | { type: "hold" }
  /** Ask for the hand (the round is already held). */
  | { type: "ask" }
  /** One beat of the count: 3, 2, 1. */
  | { type: "count"; beat: number }
  /** Carry on with the round. */
  | { type: "go" };

export interface HandWatchTiming {
  lostAfter: number;
  steadyFor: number;
  beat: number;
  drop: number;
  quiet: number;
}

const TIMING: HandWatchTiming = { lostAfter: LOST_AFTER, steadyFor: STEADY_FOR, beat: BEAT, drop: DROP, quiet: QUIET };

export class HandWatch {
  state: HandWatchState = "watching";
  /** The count's beat on screen (3, 2, 1), 0 when not counting. */
  beat = 0;
  /** Whether the player is being asked for their hand right now. */
  asking = false;
  private lastSeen: number;
  private seenSince: number | null = null;
  private heldAt = 0;
  private countFrom = 0;
  private readonly timing: HandWatchTiming;

  constructor(now: number, timing: Partial<HandWatchTiming> = {}) {
    this.timing = { ...TIMING, ...timing };
    this.lastSeen = now;
  }

  /** Play is running from `now` with nothing held: a round starting, or play resumed without a wait. */
  watch(now: number): void {
    this.state = "watching";
    this.lastSeen = now;
    this.seenSince = null;
    this.beat = 0;
    this.asking = false;
  }

  /**
   * Hold the round from `now` and wait for the hand - when resuming from the
   * pause sheet, or after the camera came back. The camera needs a moment
   * to see a hand that is already there, so the player is asked for it only
   * if it has not been seen within QUIET.
   */
  hold(now: number): void {
    this.state = "waiting";
    this.heldAt = now;
    this.lastSeen = Number.NEGATIVE_INFINITY;
    this.seenSince = null;
    this.beat = 0;
    this.asking = false;
  }

  /** One tick: is the hand seen now? Returns what changed, if anything. */
  update(now: number, seen: boolean): HandWatchEvent | null {
    const { lostAfter, steadyFor, beat, drop, quiet } = this.timing;
    if (seen) {
      if (this.seenSince === null || now - this.lastSeen > drop) this.seenSince = now;
      this.lastSeen = now;
    } else if (now - this.lastSeen > drop) {
      this.seenSince = null;
    }
    switch (this.state) {
      case "watching":
        if (seen || now - this.lastSeen < lostAfter) return null;
        this.state = "waiting";
        this.heldAt = now;
        this.asking = true;
        return { type: "hold" };
      case "waiting":
        if (this.seenSince !== null && now - this.seenSince >= steadyFor) {
          this.state = "counting";
          this.countFrom = now;
          this.beat = 3;
          this.asking = false;
          return { type: "count", beat: 3 };
        }
        if (!this.asking && this.seenSince === null && now - this.heldAt >= quiet) {
          this.asking = true;
          return { type: "ask" };
        }
        return null;
      case "counting": {
        if (now - this.lastSeen > drop) {
          this.state = "waiting";
          this.beat = 0;
          this.asking = true;
          return { type: "ask" };
        }
        const left = 3 - Math.floor((now - this.countFrom) / beat);
        if (left <= 0) {
          this.watch(now);
          return { type: "go" };
        }
        if (left === this.beat) return null;
        this.beat = left;
        return { type: "count", beat: left };
      }
    }
  }
}

/**
 * Play Again with the hand, on the results card. The hand is still up when
 * the player falls, and a fold meant for a bandit must not start the next
 * round: only a deliberate shot counts - the thumb seen raised after the
 * card appeared, then folded, once the card has settled.
 */
export class FireToPlay {
  private raised = false;

  constructor(
    /** When the card appeared, ms. */
    private readonly shownAt: number,
    /** How long the card takes to settle, ms. */
    private readonly settle = 1200,
  ) {}

  /** One camera frame's trigger. Returns true when it is the shot that plays again. */
  observe(now: number, reading: { seen: boolean; armed: boolean; travel: number; fired: boolean }): boolean {
    if (now < this.shownAt) return false;
    if (reading.fired) {
      const counts = this.raised && now - this.shownAt >= this.settle;
      // A fold before the card settled spends the raise: raise again.
      this.raised = false;
      return counts;
    }
    if (reading.seen && reading.armed && reading.travel < 0.3) this.raised = true;
    return false;
  }
}
