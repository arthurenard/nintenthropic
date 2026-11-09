/**
 * Counting the players on a camera: everyone who is driving holds up both
 * fists, and the count is how many pairs of hands the tracker finds, up to
 * four. Two hands are a player, and an odd hand out is one more (a friend who
 * has raised one fist so far), so a hand missed for a moment never loses a
 * player; which hands belong together is not asked, so it does not matter
 * whose hand MediaPipe thinks is whose. The count is the most players seen in
 * enough of the last second's pictures (COUNT_SHARE): a player whose fists
 * are missed now and then still counts, and a hand seen twice on one picture
 * (once in a while the tracker finds five hands among four) adds nobody. It
 * is settled once it has stayed the same for a while: a friend still raising
 * their fists has time to.
 *
 * Plain logic, no DOM and no MediaPipe: the count screen (count.ts) feeds it.
 */
import { MAX_ON_CAMERA } from "./prefs";

/** The players in a picture with this many hands in it: two hands each, an odd one counting too, at most four. */
export function playersFor(hands: number): 0 | 1 | 2 | 3 | 4 {
  return Math.min(MAX_ON_CAMERA, Math.max(0, Math.ceil(hands / 2))) as 0 | 1 | 2 | 3 | 4;
}

/** The pictures the count is taken over: the last this long, ms. */
export const COUNT_WINDOW = 1000;
/**
 * The count is the most players seen in at least this share of those pictures, and in two of them at least.
 * Measured on pictures of two players' four fists (e2e/tracker.html, ?players=2, as the count reads them): 4 hands on 38
 * pictures of 48, 3 on 7, 2 on 2, and 5 on 1.
 */
export const COUNT_SHARE = 0.3;
/** A count settles once it has not changed for this long, ms. */
export const SETTLE_AFTER = 1500;

export interface Headcount {
  /** Players counted now, 0 to 4. */
  players: 0 | 1 | 2 | 3 | 4;
  /** The count has stayed the same for SETTLE_AFTER (and is at least one). */
  settled: boolean;
  /** How far towards settling the count is, 0..1 (0 with no one counted). */
  progress: number;
}

export class HeadCounter {
  /** Each picture's players and when it was seen, the last COUNT_WINDOW of them (the newest two kept, however old). */
  private seen: { at: number; players: 0 | 1 | 2 | 3 | 4 }[] = [];
  private players: 0 | 1 | 2 | 3 | 4 = 0;
  /** When `players` last changed. */
  private since = 0;
  /** The most players there is room for (the room's free seats): more fists than that are that many, and settle. */
  private most: 1 | 2 | 3 | 4 = MAX_ON_CAMERA;

  /** A picture with this many hands in it, seen at `now` (ms). */
  push(hands: number, now: number): void {
    this.seen.push({ at: now, players: playersFor(hands) });
    this.update(now);
  }

  /** How the count stands at `now` (ms). */
  read(now: number): Headcount {
    this.update(now);
    const held = now - this.since;
    const progress = this.players > 0 ? Math.min(1, held / SETTLE_AFTER) : 0;
    return { players: this.players, settled: this.players > 0 && held >= SETTLE_AFTER, progress };
  }

  /** Starts again: nobody counted, and room for `most` players. */
  reset(now: number, most: 1 | 2 | 3 | 4 = MAX_ON_CAMERA): void {
    this.seen = [];
    this.players = 0;
    this.since = now;
    this.most = most;
  }

  private update(now: number): void {
    // Pictures that have left the window go, but the newest two stay: a camera that stops sending keeps its last word.
    while (this.seen.length > 2 && this.seen[0]!.at < now - COUNT_WINDOW) this.seen.shift();
    const enough = Math.max(2, Math.ceil(COUNT_SHARE * this.seen.length));
    let most = 0;
    for (let players: number = this.most; players > 0 && most === 0; players--) {
      if (this.seen.filter((one) => one.players >= players).length >= enough) most = players;
    }
    if (most !== this.players) {
      this.players = most as 0 | 1 | 2 | 3 | 4;
      this.since = now;
    }
  }
}
