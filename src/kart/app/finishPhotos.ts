/**
 * The finish-line photos, as the screens see them: when each wheel player's is taken (`FinishShutter`), which of a few
 * stills after the line is kept (`PhotoBurst`, `reaction`: the one that caught them celebrating), and how the results
 * lay them out (`arrangePhotos`, `arrangePodium`). The picture itself is the camera's (Services.photo,
 * input/photo.ts); these are plain logic, tested without a DOM.
 */
import type { RaceView, WheelStatus } from "../contract";

/**
 * When to take each finish-line photo: for each kart watched (this screen's wheel players'), once, on the first of
 *   - the race's `finish` event for it: the sim's word, on the tick it crossed the line (the host's, and solo's, frame
 *     that ran that tick; a guest's when the host's events come, one way down the line later, a round trip after its
 *     own screen drew the crossing, since it draws its own kart ahead of the host's word);
 *   - its kart finished in the view (an event this screen did not see: the race was still loading);
 *   - the race decided before it got there (the rest are placed by how far round they got): the photo as it ends.
 * A new race (a restart: the tick goes back) starts again.
 */
export class FinishShutter {
  private taken = new Set<number>();
  private lastEvent = -1;
  private lastTick = -1;

  /** Forgets every photo taken: the next race. */
  reset(): void {
    this.taken.clear();
    this.lastEvent = -1;
    this.lastTick = -1;
  }

  /** The karts of `watched` to photograph now, each once in a race. Call it with every view drawn. */
  due(view: RaceView, watched: readonly number[]): number[] {
    if (view.tick < this.lastTick - 5) this.reset();
    this.lastTick = view.tick;
    const now: number[] = [];
    const take = (kart: number) => {
      if (this.taken.has(kart) || !watched.includes(kart)) return;
      this.taken.add(kart);
      now.push(kart);
    };
    for (const event of view.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === "finish") take(event.kart);
    }
    for (const kart of watched) {
      if (this.taken.has(kart)) continue;
      const seen = view.karts.find((candidate) => candidate.id === kart);
      if (!seen) continue;
      if (seen.finished !== null || view.phase === "finished") take(kart);
    }
    return now;
  }

  /** Whether this kart's photo has been taken in this race. */
  has(kart: number): boolean {
    return this.taken.has(kart);
  }
}

/**
 * A photo is chosen from a burst of stills: one as the kart crosses the line, then one every `every` ms for `ms`, so
 * the arms going up a moment later are caught too.
 */
export const BURST = { ms: 1200, every: 300 } as const;

/**
 * How much a still shows the player celebrating, by what the wheel saw as it was taken: both open hands raised high (a
 * cheer) most, then a wave, then hands let go of the wheel; the hands still on it, or gone, least.
 */
export function reaction(status: WheelStatus | null): number {
  if (!status) return 0;
  if (status.emote === "cheer") return 3;
  if (status.emote === "wave") return 2;
  return status.grip === "open" || status.grip === "one-open" ? 1 : 0;
}

/**
 * One player's burst of stills after the line (BURST): which to take when, and the one kept, the most celebrating
 * (`reaction`) and of those the first, so with nothing better the photo is the moment they crossed the line.
 */
export class PhotoBurst<T> {
  private next: number;
  private readonly until: number;
  private kept: { still: T; score: number } | null = null;

  constructor(start: number) {
    this.next = start;
    this.until = start + BURST.ms;
  }

  /** Whether a still is due at `now` (ms). */
  due(now: number): boolean {
    return this.next <= this.until && now >= this.next;
  }

  /** A still taken at `now` (null: none could be), and how much it shows them celebrating. */
  offer(still: T | null, score: number, now: number): void {
    this.next = Math.max(this.next + BURST.every, now + BURST.every / 2);
    if (still !== null && (this.kept === null || score > this.kept.score)) this.kept = { still, score };
  }

  /** Every still has been taken. */
  get over(): boolean {
    return this.next > this.until;
  }

  /** The still kept so far, or null. */
  get best(): T | null {
    return this.kept?.still ?? null;
  }
}

/** One row of photos as laid out: which (by index, in order) and each one's height, the same along the row. */
export interface PhotoRow {
  items: number[];
  height: number;
}

/** In order, `n` items in `rows` rows as even as they go (the longer rows first). */
function split(n: number, rows: number): number[][] {
  const out: number[][] = [];
  let at = 0;
  for (let r = 0; r < rows; r++) {
    const count = Math.ceil((n - at) / (rows - r));
    out.push(Array.from({ length: count }, (_, i) => at + i));
    at += count;
  }
  return out;
}

/**
 * The photos (their widths over their heights, in order) laid out in rows across `width`, each row one height so the
 * pictures are never cut, all of them within `maxHeight`: the number of rows that shows the most of them, the fewest
 * on a tie. Rows that would make it taller come down in height together (and are then narrower than `width`).
 */
export function arrangePhotos(aspects: readonly number[], width: number, maxHeight: number, gap: number): PhotoRow[] {
  const n = aspects.length;
  if (n === 0 || width <= 0 || maxHeight <= 0) return [];
  let best: PhotoRow[] = [];
  let bestArea = -1;
  for (let rows = 1; rows <= n; rows++) {
    const groups = split(n, rows);
    const heights = groups.map((items) => (width - gap * (items.length - 1)) / items.reduce((sum, i) => sum + aspects[i]!, 0));
    const tall = heights.reduce((sum, h) => sum + h, 0);
    const room = maxHeight - gap * (rows - 1);
    if (room <= 0) break;
    const scale = Math.min(1, room / tall);
    const laid = groups.map((items, r) => ({ items, height: heights[r]! * scale }));
    const area = laid.reduce((sum, row) => sum + row.items.reduce((inner, i) => inner + row.height * row.height * aspects[i]!, 0), 0);
    if (area > bestArea + 1e-6) {
      best = laid;
      bestArea = area;
    }
  }
  return best;
}

/** The others' rows are at most this much of the leader's height. */
const BELOW_LEAD = 0.7;

/**
 * The photos with the first (the best placed) in a row of its own, the biggest, and the rest in rows under it
 * (arrangePhotos), no taller than this much of the leader; the lot within `maxHeight`. One photo is simply laid out.
 */
export function arrangePodium(aspects: readonly number[], width: number, maxHeight: number, gap: number): PhotoRow[] {
  if (aspects.length <= 1) return arrangePhotos(aspects, width, maxHeight, gap);
  const rest = aspects.slice(1);
  // The leader takes what it can while leaving the others room for a row as tall as BELOW_LEAD of it.
  const lead = Math.min(width / aspects[0]!, (maxHeight - gap) / (1 + BELOW_LEAD));
  if (lead <= 0) return [];
  const below = arrangePhotos(rest, width, maxHeight - lead - gap, gap).map((row) => ({
    items: row.items.map((i) => i + 1),
    height: Math.min(row.height, lead * BELOW_LEAD),
  }));
  // Room left over when the others need less: the leader grows into it, up to its width.
  const used = below.reduce((sum, row) => sum + row.height + gap, 0);
  const grown = Math.min(width / aspects[0]!, maxHeight - used);
  return [{ items: [0], height: Math.max(lead, grown) }, ...below];
}

/** Where one card goes, px from the top left of the whole. */
export interface PhotoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rows as boxes, each row centred in the widest. */
function rowBoxes(rows: readonly PhotoRow[], aspects: readonly number[], gap: number): { boxes: PhotoBox[]; width: number; height: number } {
  const across = rows.map((row) => row.items.reduce((sum, i) => sum + aspects[i]! * row.height, 0) + gap * (row.items.length - 1));
  const width = Math.max(0, ...across);
  const boxes: PhotoBox[] = [];
  let y = 0;
  rows.forEach((row, r) => {
    let x = (width - across[r]!) / 2;
    for (const i of row.items) {
      const w = aspects[i]! * row.height;
      boxes[i] = { x, y, w, h: row.height };
      x += w + gap;
    }
    y += row.height + gap;
  });
  return { boxes, width, height: Math.max(0, y - gap) };
}

/** How much a layout shows: every card's area, the leader's counted twice (it is the one to see). */
const shows = (boxes: readonly PhotoBox[]) => boxes.reduce((sum, box, i) => sum + box.w * box.h * (i === 0 ? 2 : 1), 0);

/**
 * The cards as the results and the shared picture lay them out, the first (the best placed) the biggest: either
 * stacked (arrangePodium: the leader in a row of its own over the rest), or, where that shows more (tall photos: two
 * to four on one camera), side by side: the leader as tall as there is room for, the rest in rows beside it, no taller
 * than 70% of it. The boxes are in the order of `aspects`; the whole is at most `width` by `maxHeight`.
 */
export function layoutPodium(aspects: readonly number[], width: number, maxHeight: number, gap: number): { boxes: PhotoBox[]; width: number; height: number } {
  let best = rowBoxes(arrangePodium(aspects, width, maxHeight, gap), aspects, gap);
  if (aspects.length < 2) return best;
  const rest = aspects.slice(1);
  for (const share of [1, 0.9, 0.8, 0.7, 0.6]) {
    const tall = maxHeight * share;
    const lead = aspects[0]! * tall;
    const room = width - lead - gap;
    if (room < 40) continue;
    const rows = arrangePhotos(rest, room, tall, gap).map((row) => ({ items: row.items, height: Math.min(row.height, tall * BELOW_LEAD) }));
    const side = rowBoxes(rows, rest, gap);
    const top = (tall - side.height) / 2;
    const boxes = [{ x: 0, y: 0, w: lead, h: tall }, ...side.boxes.map((box) => ({ ...box, x: box.x + lead + gap, y: box.y + top }))];
    if (shows(boxes) > shows(best.boxes) + 1e-6) best = { boxes, width: lead + gap + side.width, height: tall };
  }
  return best;
}
