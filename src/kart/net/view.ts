/**
 * How a guest turns the host's snapshots (30 a second, a little late and a
 * little uneven) into pictures at the screen's own pace.
 *
 * Other people's karts are drawn a moment in the past, between two snapshots
 * the guest already has, so they glide instead of stepping. The price is that
 * they are ~70 ms behind (more over an uneven line: `LagMeter`); the guest's
 * own karts do not pay it (they are predicted, see guest.ts).
 */
import { TICK, type KartView, type Race, type RaceView, type ThingView } from "../contract";
import { clamp, lerp, lerpAngle } from "./util";

/** How far behind the newest snapshot the others are drawn on a steady line, seconds. */
export const RENDER_LAG = 0.07;
/** And at most, on the most uneven, seconds. */
export const MAX_LAG = 0.25;
/** Arrivals the lag is judged on: three seconds of snapshots. */
const LAG_WINDOW = 90;
/** The share of arrivals the lag covers: one straggler in ten is carried over (`SnapshotBuffer.at`) instead. */
const LAG_SHARE = 0.9;
/** Room kept over the snapshots' own spacing and their lateness, seconds. */
const LAG_MARGIN = 0.02;
/** One arrival this much later or sooner than the one before is not unevenness but a stop (a pause, a sleeping tab), seconds. */
const LAG_BREAK = 0.5;
/** How far past the newest snapshot a kart is carried on while the next is awaited, seconds. */
const MAX_EXTRAPOLATION = 0.1;
/** Snapshots kept: about half a second. */
const KEEP = 16;

/**
 * The race's picture now, to keep. A race builds a new picture, karts and things and all, on every call to `view`, so
 * there is nothing to copy (sim.test.ts holds the sim to that); only the events it hands over with it are dropped,
 * since the feed tells them.
 */
export function pictureOf(race: Race): RaceView {
  const view = race.view();
  view.events = [];
  return view;
}

function blendKart(a: KartView, b: KartView, f: number): KartView {
  // A kart that has not moved (on the grid, or waiting for the light) is the newer one as it is.
  if (a.x === b.x && a.y === b.y && a.z === b.z && a.heading === b.heading) return b;
  return {
    ...b,
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    z: lerp(a.z, b.z, f),
    heading: lerpAngle(a.heading, b.heading, f),
  };
}

function blendThing(a: ThingView, b: ThingView, f: number): ThingView {
  // A thing that changed kind or hid between the two is not the same thing: no gliding.
  if (a.kind !== b.kind || !a.active || !b.active) return b;
  // Nor does one that stands still, which is every item box.
  if (a.x === b.x && a.y === b.y && a.z === b.z && a.heading === b.heading) return b;
  return {
    ...b,
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    z: lerp(a.z, b.z, f),
    heading: lerpAngle(a.heading, b.heading, f),
  };
}

/**
 * Each of `to` blended with the one of the same id in `from`. The two lists nearly always line up (the same karts in
 * the same order, the same boxes, then whatever is flying), so each is looked at first in its own place; ids are
 * looked up only once one does not line up.
 */
function blendEach<T extends { id: number }>(from: readonly T[], to: readonly T[], f: number, blend: (a: T, b: T, f: number) => T): T[] {
  let byId: Map<number, T> | undefined;
  return to.map((item, i) => {
    let was = from[i];
    if (was?.id !== item.id) {
      byId ??= new Map(from.map((other) => [other.id, other]));
      was = byId.get(item.id);
    }
    return was ? blend(was, item, f) : item;
  });
}

/**
 * Between two views, `f` of the way from `a` to `b` (0..1): karts' (and
 * things') place and heading blend; everything else is `b`'s, the newer.
 * `f` beyond 1 carries on the same way past `b` (see `SnapshotBuffer.at`).
 */
export function blendViews(a: RaceView, b: RaceView, f: number): RaceView {
  if (a === b || f === 1) return b;
  if (f === 0) return a;
  return { ...b, karts: blendEach(a.karts, b.karts, f, blendKart), things: blendEach(a.things, b.things, f, blendThing) };
}

interface Frame {
  /** The host's clock when this was true, seconds. */
  time: number;
  view: RaceView;
}

/** Snapshots in the order of the host's clock, however they arrived. */
export class SnapshotBuffer {
  private frames: Frame[] = [];

  get newest(): Frame | null {
    return this.frames[this.frames.length - 1] ?? null;
  }

  get size(): number {
    return this.frames.length;
  }

  clear(): void {
    this.frames = [];
  }

  /** False for a tick that is no newer than the newest held: the unreliable channel may deliver a late one, or one twice. */
  accepts(tick: number): boolean {
    const last = this.newest;
    return !last || tick * TICK > last.time;
  }

  /** Adds one (see `accepts`). */
  push(tick: number, view: RaceView): boolean {
    if (!this.accepts(tick)) return false;
    const time = tick * TICK;
    this.frames.push({ time, view });
    if (this.frames.length > KEEP) this.frames.shift();
    return true;
  }

  /**
   * The view at host time `time`: gliding between the snapshots around it.
   * Past the newest (the next one is late or lost) it carries on at the pace
   * of the last two for a tenth of a second, then holds: a gap in snapshots
   * should look like a kart that kept going, not one that stopped and then
   * leapt.
   */
  at(time: number): RaceView | null {
    const frames = this.frames;
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (!first || !last) return null;
    if (time <= first.time) return first.view;
    if (time >= last.time) {
      const before = frames[frames.length - 2];
      if (!before) return last.view;
      const over = Math.min(time - last.time, MAX_EXTRAPOLATION);
      return blendViews(before.view, last.view, 1 + over / (last.time - before.time));
    }
    for (let i = frames.length - 1; i > 0; i--) {
      const b = frames[i]!;
      const a = frames[i - 1]!;
      if (time >= a.time) return blendViews(a.view, b.view, (time - a.time) / (b.time - a.time));
    }
    return last.view;
  }
}

/**
 * How far behind the newest snapshot to draw the others, from how unevenly
 * snapshots arrive. An arrival's lateness is how much longer it took than the
 * quickest of the last three seconds, and the lag covers nine in ten. On a
 * steady line (one Wi-Fi) that is `RENDER_LAG`, as it always was; over the
 * internet, where snapshots bunch up and straggle, it grows (to `MAX_LAG`)
 * so the others still glide instead of stalling and leaping. It rises at
 * once, and eases back down over a few seconds once the line steadies.
 */
export class LagMeter {
  private offsets = new Float64Array(LAG_WINDOW);
  private sorted = new Float64Array(LAG_WINDOW);
  private count = 0;
  private next = 0;
  private last = Number.NaN;
  private lag_ = RENDER_LAG;

  get lag(): number {
    return this.lag_;
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.last = Number.NaN;
    this.lag_ = RENDER_LAG;
  }

  /** A snapshot of host time `time` arrived at this device's time `at`, both seconds. Returns the lag. */
  note(time: number, at: number): number {
    const offset = at - time;
    if (Math.abs(offset - this.last) > LAG_BREAK) {
      this.count = 0;
      this.next = 0;
    }
    this.last = offset;
    this.offsets[this.next] = offset;
    this.next = (this.next + 1) % LAG_WINDOW;
    if (this.count < LAG_WINDOW) this.count++;
    // Until the window is full, what it holds is its start.
    const sorted = this.sorted.subarray(0, this.count);
    sorted.set(this.offsets.subarray(0, this.count));
    sorted.sort();
    const lateness = sorted[Math.floor((this.count - 1) * LAG_SHARE)]! - sorted[0]!;
    const target = clamp(2 * TICK + lateness + LAG_MARGIN, RENDER_LAG, MAX_LAG);
    this.lag_ = target > this.lag_ ? target : lerp(this.lag_, target, 0.05);
    return this.lag_;
  }
}

/**
 * The host-time a guest draws the others at. It keeps pace with real time and
 * leans gently toward "newest snapshot minus the lag" (`RENDER_LAG`, or the
 * `LagMeter`'s) — a little faster when
 * behind, slower when ahead — so the uneven arrival of snapshots never shows
 * as a stutter, and it never runs backwards.
 */
export class DisplayClock {
  private time = Number.NaN;

  reset(): void {
    this.time = Number.NaN;
  }

  /** Moves on by `dt` real seconds; `newest` is the host time of the latest snapshot. */
  advance(dt: number, newest: number, lag = RENDER_LAG): number {
    const target = newest - lag;
    if (Number.isNaN(this.time) || Math.abs(target - this.time) > 0.5) {
      this.time = target;
    } else {
      const error = target - this.time;
      this.time += clamp(dt, 0, 0.1) * (1 + clamp(error * 1.5, -0.15, 0.15));
    }
    return this.time;
  }
}
