/**
 * Gestures beyond driving, read from the same two hands as the wheel
 * (docs/GRIP_PRIX.md, "Input"):
 *
 *   - clap: the two hands come together and apart again at once -> a horn
 *   - cheer: both open hands raised high above where the wheel is held, for a moment -> `emote: "cheer"`
 *   - wave: one open hand swinging side to side, the other down or a fist -> `emote: "wave"`
 *
 * Pure like the wheel: it is fed what the wheel has already read (where each
 * palm is, how big it looks, whether it is open) and the time, and touches no
 * camera or clock. Every distance is measured in hand lengths (a hand's span,
 * wrist to fingertip: twice the wrist-to-knuckle size the reader gives), so
 * it means the same near the camera and far from it.
 *
 * The wheel stands aside while one of these is under way: palms pressed
 * together or both open hands held high in a cheer are not a brake, a lifted
 * wheel or an item (`stands`).
 */
import type { Emote } from "../contract";

/** Every number the gestures rest on, in one place so real hands can move them. */
export const GESTURES = {
  clap: {
    /** The palms are together when closer than this many hand lengths... */
    close: 0.6,
    /** ...and have come from at least this far apart (the wheel's own width is more)... */
    apart: 1,
    /** ...within this long before, seconds. */
    from: 0.7,
    /** The palms are apart again at this many hand lengths. */
    release: 0.9,
    /** Together and apart again within this long is a clap, seconds. */
    within: 0.5,
    /** A hand lost on the way in (one behind the other) counts as together if the palms were this near and closing. */
    nearly: 0.9,
    /** A wheel turned further than this (|steer|) is not clapping. */
    steer: 0.8,
    /** A hand missing this long while together ends it, seconds. */
    coast: 0.25,
    /** No second horn for this long, seconds. */
    cooldown: 0.4,
    /** After a clap the wheel stays out of the brake, item and hop for this long, seconds. */
    grace: 0.5,
  },
  cheer: {
    /**
     * The wheel's centre is this many hand lengths above its usual height (a
     * hand lifted off the wheel to brake, or a hop's jerk, is not nearly so
     * far)...
     */
    raise: 2,
    /** ...with each hand at least this share of that. */
    each: 0.6,
    /** ...for this long, seconds. */
    hold: 0.3,
    /** It lets go after the hands have been down this long, seconds. */
    release: 0.2,
    /** The usual height is learnt from fists over this long before cheering can start, seconds. */
    learn: 0.5,
    /** The usual height follows the wheel with this time constant, seconds. */
    follow: 3,
  },
  wave: {
    /** A swing counts when the hand has moved this many hand sizes (wrist to knuckle) across. */
    swing: 0.6,
    /** This many turns round... */
    turns: 2,
    /** ...within this long, seconds. */
    window: 1,
    /** It lets go this long after the last of them, seconds. */
    release: 0.5,
  },
} as const;

/** One hand as the gestures see it. */
export interface GestureHand {
  /** The palm's centre, as the wheel's HandReading: the mirrored picture's fractions. */
  x: number;
  y: number;
  /** Wrist to middle knuckle, in picture heights. */
  size: number;
  /** Open, a fist, or neither (in between). */
  grip: "open" | "fist" | null;
}

const hypot = Math.hypot;

export class Gestures {
  /** How many times the player has honked, ever: a count, like the item presses. */
  horns = 0;

  // The clap.
  private apartAt = -Infinity;
  /** Was the wheel braking when the palms were last apart? A brake held before the clap is no clap; open hands opening on the way in are. */
  private apartBraking = false;
  private closeSince: number | null = null;
  private lastRatio = Infinity;
  private prevRatio = Infinity;
  private lastBoth = -Infinity;
  private hornAllowedAt = -Infinity;
  private graceUntil = -Infinity;

  // The cheer.
  private rest: number | null = null;
  private restTime = 0;
  private lastFrame = -Infinity;
  private raisedSince: number | null = null;
  private raisedAt = -Infinity;
  private cheering = false;

  // The wave.
  private readonly trails: Record<"left" | "right", { t: number; x: number }[]> = { left: [], right: [] };
  private waveUntil = -Infinity;

  /**
   * One frame of the wheel. `left` and `right` are the hands in view (null:
   * not seen), `steer` the wheel's, `braking` whether it is braking, `aspect`
   * the picture's width over its height.
   */
  frame(t: number, aspect: number, left: GestureHand | null, right: GestureHand | null, steer: number, braking: boolean): void {
    const dt = Number.isFinite(this.lastFrame) ? Math.max(0, Math.min(0.5, t - this.lastFrame)) : 0;
    this.lastFrame = t;
    this.clap(t, aspect, left, right, steer, braking);
    this.cheer(t, left, right, dt);
    this.wave(t, aspect, left, right);
  }

  /** Forgets the hands, not the horns. */
  reset(): void {
    this.apartAt = -Infinity;
    this.closeSince = null;
    this.lastRatio = this.prevRatio = Infinity;
    this.lastBoth = -Infinity;
    this.raisedSince = null;
    this.raisedAt = -Infinity;
    this.cheering = false;
    this.trails.left.length = 0;
    this.trails.right.length = 0;
    this.waveUntil = -Infinity;
    this.lastFrame = -Infinity;
  }

  /**
   * The palms are together, or just were, or both open hands are cheering:
   * the wheel does not brake, hop or flick an item meanwhile.
   */
  stands(t: number): boolean {
    return this.together(t) || t < this.graceUntil || this.cheeringAt(t);
  }

  private cheeringAt(t: number): boolean {
    return this.cheering && t - this.raisedAt <= GESTURES.cheer.release;
  }

  /** The palms are together now (a clap under way). */
  together(t: number): boolean {
    return this.closeSince !== null && t - this.lastBoth <= GESTURES.clap.coast;
  }

  /** What the hands are doing, held while they do it. */
  emoteAt(t: number): Emote | null {
    if (this.cheeringAt(t)) return "cheer";
    if (t < this.waveUntil) return "wave";
    return null;
  }

  // ─── The clap ───────────────────────────────────────────────────────────────

  private clap(t: number, aspect: number, left: GestureHand | null, right: GestureHand | null, steer: number, braking: boolean): void {
    const c = GESTURES.clap;
    if (!left || !right) {
      if (this.closeSince !== null) {
        // A hand that vanishes as the palms meet is the tracker losing one behind the other: it still counts as together a moment.
        if (t - this.lastBoth > c.coast) this.closeSince = null;
      } else if (this.lastRatio <= c.nearly && this.lastRatio < this.prevRatio && this.lastBoth - this.apartAt <= c.from && this.lastBoth >= this.hornAllowedAt && !this.apartBraking && Math.abs(steer) <= c.steer) {
        this.closeSince = this.lastBoth;
      }
      return;
    }
    const length = left.size + right.size;
    if (!(length > 0.01)) return;
    const ratio = hypot((right.x - left.x) * aspect, right.y - left.y) / length;
    this.prevRatio = this.lastRatio;
    this.lastRatio = ratio;
    if (ratio >= c.apart) {
      this.apartAt = t;
      this.apartBraking = braking;
    }
    if (this.closeSince === null) {
      if (ratio <= c.close && t - this.apartAt <= c.from && t >= this.hornAllowedAt && !this.apartBraking && Math.abs(steer) <= c.steer) this.closeSince = t;
    } else if (ratio >= c.release) {
      if (t - this.closeSince <= c.within && t >= this.hornAllowedAt) {
        this.horns++;
        this.hornAllowedAt = t + c.cooldown;
        this.graceUntil = t + c.grace;
      }
      this.closeSince = null;
    } else if (t - this.closeSince > c.within) {
      // Together too long to be a clap: hands pressed, not clapped.
      this.closeSince = null;
    }
    this.lastBoth = t;
  }

  // ─── The cheer ──────────────────────────────────────────────────────────────

  private cheer(t: number, left: GestureHand | null, right: GestureHand | null, dt: number): void {
    const c = GESTURES.cheer;
    if (!left || !right) {
      this.raisedSince = null;
      return;
    }
    const centre = (left.y + right.y) / 2;
    const length = left.size + right.size;
    const bothOpen = left.grip === "open" && right.grip === "open";
    // The usual height: learnt from the wheel held in fists, followed slowly.
    if (!bothOpen && left.grip === "fist" && right.grip === "fist" && !this.cheering) {
      this.rest = this.rest === null ? centre : this.rest + (centre - this.rest) * Math.min(1, dt / c.follow);
      this.restTime += dt;
    }
    if (this.rest === null || this.restTime < c.learn || !bothOpen) {
      this.raisedSince = null;
      return;
    }
    const rise = (this.rest - centre) / length;
    const eachRise = (this.rest - Math.max(left.y, right.y)) / length;
    if (rise >= c.raise && eachRise >= c.raise * c.each) {
      this.raisedAt = t;
      this.raisedSince ??= t;
      if (t - this.raisedSince >= c.hold) this.cheering = true;
    } else {
      this.raisedSince = null;
    }
    if (this.cheering && t - this.raisedAt > c.release) this.cheering = false;
  }

  // ─── The wave ───────────────────────────────────────────────────────────────

  private wave(t: number, aspect: number, left: GestureHand | null, right: GestureHand | null): void {
    const w = GESTURES.wave;
    if (this.cheeringAt(t)) {
      this.trails.left.length = 0;
      this.trails.right.length = 0;
      return;
    }
    for (const side of ["left", "right"] as const) {
      const hand = side === "left" ? left : right;
      const other = side === "left" ? right : left;
      const trail = this.trails[side];
      // One hand open and waving, the other down (out of the picture) or a fist on the wheel.
      if (!hand || hand.grip !== "open" || (other && other.grip !== "fist")) {
        trail.length = 0;
        continue;
      }
      trail.push({ t, x: hand.x * aspect });
      while (trail.length > 1 && t - trail[0]!.t > w.window) trail.shift();
      if (turns(trail, w.swing * hand.size) >= w.turns) this.waveUntil = t + w.release;
    }
  }
}

/** How many times the path turned round, ignoring wobbles smaller than `swing`. */
export function turns(trail: readonly { x: number }[], swing: number): number {
  if (!trail.length || !(swing > 0)) return 0;
  let low = trail[0]!.x;
  let high = low;
  let direction = 0;
  let count = 0;
  for (const { x } of trail) {
    if (direction === 0) {
      if (x - low >= swing) {
        direction = 1;
        high = x;
      } else if (high - x >= swing) {
        direction = -1;
        low = x;
      } else {
        low = Math.min(low, x);
        high = Math.max(high, x);
      }
    } else if (direction === 1) {
      if (x > high) high = x;
      else if (high - x >= swing) {
        direction = -1;
        low = x;
        count++;
      }
    } else if (x < low) low = x;
    else if (x - low >= swing) {
      direction = 1;
      high = x;
      count++;
    }
  }
  return count;
}
