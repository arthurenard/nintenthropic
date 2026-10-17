/**
 * Reading a picture in side-by-side tiles, for players sharing a camera.
 *
 * MediaPipe finds a hand by squeezing the whole picture into a 192-pixel
 * square and looking for a palm in that. Four people side by side a metre
 * and a half back hold their fists at about a twentieth of the picture's
 * width, which is a handful of pixels in that square: too few to be found.
 * Cut into one tile per player, the picture keeps three or four times as
 * many of them. Each tile has its own landmarker (looking for two hands);
 * this file cuts the picture and joins what they found, and touches no
 * MediaPipe, so it is tested without one.
 */
import type { Landmark, SeenHand } from "./types";

/** How much each tile reaches into its neighbours (picture widths), so a hand on a line is whole in one of them. */
export const TILE_OVERLAP = 0.06;

/** A region of the camera's picture, in its pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The tile for each of `count` players, left to right in the camera's own (unmirrored) picture. */
export function tileRects(count: number, width: number, height: number, overlap: number = TILE_OVERLAP): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.max(0, Math.round((i / count - (i > 0 ? overlap : 0)) * width));
    const to = Math.min(width, Math.round(((i + 1) / count + (i < count - 1 ? overlap : 0)) * width));
    rects.push({ x: from, y: 0, width: to - from, height });
  }
  return rects;
}

/**
 * Reads a tile may go without a hand before it is looked at only now and then: about a second at the camera's pace (a player who
 * opens their hands to brake, turns fast or ducks out of the picture for a moment is found again on the very next frame).
 */
export const QUIET_AFTER = 30;
/** A quiet tile is looked at on every this-many camera frames (staggered across the tiles). */
export const QUIET_EVERY = 3;

/**
 * Which tiles are worth reading on a camera frame. Every tile with hands in
 * it (or that had some within the last second) is read on every frame, so a
 * player steering never waits; a tile nobody has held a hand up in for longer
 * (an empty seat, a player who has walked off) is read on every third frame, and
 * the ones that are quiet together on different frames, so the worker's time
 * is spent where the hands are. A hand raised in a quiet tile is found within
 * `QUIET_EVERY` frames, the one time it matters: when a player starts.
 */
export class TileSchedule {
  /** Camera frames in a row each tile has come back empty. */
  private readonly empty: number[];
  private reads = 0;

  constructor(
    readonly count: number,
    private readonly after: number = QUIET_AFTER,
    private readonly every: number = QUIET_EVERY,
  ) {
    this.empty = Array.from({ length: count }, () => 0);
  }

  /** Which tiles to read on the next camera frame (counts the frame). */
  next(): boolean[] {
    const frame = this.reads++;
    return this.empty.map((quiet, i) => quiet < this.after || (frame + i) % this.every === 0);
  }

  /** Whether a tile has gone long enough without a hand to be read only now and then (an empty seat). */
  quiet(i: number): boolean {
    return (this.empty[i] ?? 0) >= this.after;
  }

  /** What each tile found on the frame just read: how many hands, or null for a tile that was skipped. */
  record(found: readonly (number | null)[]): void {
    found.forEach((hands, i) => {
      if (hands === null) return;
      this.empty[i] = hands > 0 ? 0 : Math.min(this.after, (this.empty[i] ?? 0) + 1);
    });
  }
}

const PALM = [0, 5, 9, 13, 17] as const;

/** The palm's centre in the picture's pixels. */
function palm(hand: SeenHand, width: number, height: number): { x: number; y: number; size: number } {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += hand.landmarks[i]!.x;
    y += hand.landmarks[i]!.y;
  }
  const wrist = hand.landmarks[0]!;
  const knuckle = hand.landmarks[9]!;
  return {
    x: (x / PALM.length) * width,
    y: (y / PALM.length) * height,
    size: Math.hypot((knuckle.x - wrist.x) * width, (knuckle.y - wrist.y) * height),
  };
}

/** A hand found in a tile, put back where it is in the whole picture. */
export function untile(hand: SeenHand, tile: Rect, width: number, height: number): SeenHand {
  const place = (point: Landmark): Landmark => ({
    x: (tile.x + point.x * tile.width) / width,
    y: (tile.y + point.y * tile.height) / height,
    // Depth is measured in the picture's width, as x is: a tile's width is not the picture's.
    z: (point.z * tile.width) / width,
  });
  return { ...hand, landmarks: hand.landmarks.map(place) };
}

/**
 * What the tiles found, as one picture's hands: each put back in place, and a
 * hand that two tiles both saw (on a line between them) kept once, the
 * surer one, or the one tile `fresh` saw (a tile just read, beside others
 * read a moment ago: tracker.ts, lanes), whose view stands for all it
 * covers. Left to right across the picture.
 */
export function joinTiles(found: readonly { tile: Rect; hands: readonly SeenHand[] }[], width: number, height: number, fresh = -1): SeenHand[] {
  const all = found.flatMap(({ tile, hands }, i) => hands.map((hand) => ({ hand: untile(hand, tile, width, height), first: i === fresh ? 1 : 0 })));
  const kept: { hand: SeenHand; at: ReturnType<typeof palm> }[] = [];
  const looked = found[fresh]?.tile;
  for (const { hand, first } of all.sort((a, b) => b.first - a.first || b.hand.score - a.hand.score)) {
    const at = palm(hand, width, height);
    // Where the fresh tile has just looked (but for its edges), what it did not see is not there: another tile's older
    // sighting of a hand that has moved since is left out, not kept as a third hand beside the two it found.
    if (looked && !first && at.x > looked.x + at.size / 2 && at.x < looked.x + looked.width - at.size / 2) continue;
    // The same hand if the palms are less than half a hand apart.
    if (kept.some((other) => Math.hypot(other.at.x - at.x, other.at.y - at.y) < 0.5 * Math.max(other.at.size, at.size))) continue;
    kept.push({ hand, at });
  }
  return kept.sort((a, b) => a.at.x - b.at.x).map((one) => one.hand);
}
