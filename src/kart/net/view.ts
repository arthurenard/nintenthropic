/**
 * How a guest turns the host's snapshots (30 a second, a little late and a
 * little uneven) into pictures at the screen's own pace.
 *
 * Other people's karts are drawn a moment in the past, between two snapshots
 * the guest already has, so they glide instead of stepping. The price is that
 * they are ~70 ms behind; the guest's own karts do not pay it (they are
 * predicted, see guest.ts).
 */
import { TICK, type KartView, type Race, type RaceView, type ThingView } from "../contract";
import { clamp, lerp, lerpAngle } from "./util";

/** How far behind the newest snapshot the others are drawn, seconds. */
export const RENDER_LAG = 0.07;
/** How far past the newest snapshot a kart is carried on while the next is awaited, seconds. */
const MAX_EXTRAPOLATION = 0.1;
/** Snapshots kept: about half a second. */
const KEEP = 16;

/** A view that shares nothing mutable with the sim's. */
export function cloneView(view: RaceView): RaceView {
  return {
    ...view,
    karts: view.karts.map((k) => ({ ...k })),
    things: view.things.map((t) => ({ ...t })),
    events: [],
  };
}

/**
 * The race's picture now, to keep. A race builds a new picture, karts and things and all, on every call to `view`, so
 * there is nothing to copy; only the events it hands over with it are dropped (the feed tells them).
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
 * The host-time a guest draws the others at. It keeps pace with real time and
 * leans gently toward "newest snapshot minus the lag" — a little faster when
 * behind, slower when ahead — so the uneven arrival of snapshots never shows
 * as a stutter, and it never runs backwards.
 */
export class DisplayClock {
  private time = Number.NaN;

  reset(): void {
    this.time = Number.NaN;
  }

  /** Moves on by `dt` real seconds; `newest` is the host time of the latest snapshot. */
  advance(dt: number, newest: number): number {
    const target = newest - RENDER_LAG;
    if (Number.isNaN(this.time) || Math.abs(target - this.time) > 0.5) {
      this.time = target;
    } else {
      const error = target - this.time;
      this.time += clamp(dt, 0, 0.1) * (1 + clamp(error * 1.5, -0.15, 0.15));
    }
    return this.time;
  }
}
