/**
 * The hands come first: while the hand tracker beside a race cannot keep up with the camera, the race's picture gives up
 * pixels until it can.
 *
 * Every read of the camera's picture ends by fetching the landmarker's answer back from the GPU, and that waits behind
 * whatever the race has asked the GPU to draw. Measured on an M4 Max, three players on one camera beside three views at
 * the high tier (docs/GRIP_PRIX.md, Performance): each player's hands were read 11.7 times a second, 62 ms behind the
 * camera, with the race at its full resolution; at 0.6 of it, 25.8 times a second, 40 ms behind. The race's own dynamic
 * resolution never notices (it holds 60 fps either way), so this watches the tracker instead: the share of the camera
 * frames it was due to read that it did read (a frame that arrives while its worker is still busy is dropped). Below
 * STARVED for a second, the ceiling on the race's resolution comes down a step; above EASY for three seconds it goes back
 * up a little, and a step up that brings the drops back is undone and not tried again for a while. Steps down that do
 * not help (at the floor, the tracker reads no larger a share than before the first: it is slow for another reason, a
 * busy CPU) are undone too, so the picture never pays for nothing.
 * Pure: fed the tracker's counts and the time, so it is tested without a camera.
 */

/** Below this share of its due frames read, the tracker is short of the GPU. */
export const STARVED = 0.75;
/** At or above this share, it has room. */
export const EASY = 0.93;
/** The judgement's window, seconds. */
export const WINDOW = 0.5;
/** Windows in a row below STARVED before a step down, and at or above EASY before a step up. */
export const STARVED_WINDOWS = 2;
export const EASY_WINDOWS = 6;
/** The steps, and the lowest ceiling (the race's own dynamic resolution goes no lower either). */
export const STEP_DOWN = 0.1;
export const STEP_UP = 0.05;
export const FLOOR = 0.6;
/** The windows looked at to see whether a step up held, or whether the steps down helped once at the floor. */
export const JUDGE_WINDOWS = 4;
/** Steps down must lift the share read by this much to be kept. */
export const HELPS = 0.05;
/** How long a step that failed is not tried again, seconds (doubling each time, up to LONGEST). */
export const BLOCK = 20;
export const LONGEST = 120;

export interface TrackerCounts {
  /** Frames read (one per column read, for players read in workers of their own). */
  frames: number;
  /** Due frames dropped because the worker was still busy. */
  skipped: number;
  /** The columns read each in a worker of their own (1: the whole picture, or one worker for all). */
  columns?: number;
}

export class HandsFirst {
  /** The most of its resolution the race may use, FLOOR..1. */
  ceiling = 1;
  private windowStart = -Infinity;
  private windowCounts: TrackerCounts | null = null;
  private starved = 0;
  private easy = 0;
  /** The last JUDGE_WINDOWS shares, for what the tracker read before a descent began (judged the same way as after). */
  private recent: number[] = [];
  /** Steps down since the tracker last had room: from where, the mean share of the windows before the first, and those at the floor. */
  private descent: { from: number; before: number; atFloor: number[] } | null = null;
  /** A step up under watch: from where, and the windows since. */
  private climb: { from: number; windows: number } | null = null;
  private downBlockedUntil = -Infinity;
  private upBlockedUntil = -Infinity;
  /** A ceiling a step up failed at: not tried again before upBlockedUntil. */
  private upLimit = Infinity;
  private block = BLOCK;

  /**
   * The tracker's running counts at `now` (seconds). Returns true when the ceiling changed. Call it as often as convenient
   * (every frame is fine); it judges every WINDOW seconds.
   */
  sample(counts: TrackerCounts, now: number): boolean {
    if (!this.windowCounts || counts.frames < this.windowCounts.frames || counts.skipped < this.windowCounts.skipped) {
      // The first sample, or a new tracker whose counts started again.
      this.windowCounts = { ...counts };
      this.windowStart = now;
      return false;
    }
    if (now - this.windowStart < WINDOW) return false;
    const read = counts.frames - this.windowCounts.frames;
    const dropped = counts.skipped - this.windowCounts.skipped;
    this.windowCounts = { ...counts };
    this.windowStart = now;
    // A window with nothing due (no camera, no hands to read) says nothing.
    if (read + dropped === 0) return false;
    return this.judge(read / (read + dropped), now);
  }

  /** Back to the full picture and a clean slate (a new race). */
  reset(): void {
    this.ceiling = 1;
    this.windowCounts = null;
    this.starved = 0;
    this.easy = 0;
    this.recent = [];
    this.descent = null;
    this.climb = null;
    this.downBlockedUntil = -Infinity;
    this.upBlockedUntil = -Infinity;
    this.upLimit = Infinity;
    this.block = BLOCK;
  }

  private judge(share: number, now: number): boolean {
    this.recent.push(share);
    if (this.recent.length > JUDGE_WINDOWS) this.recent.shift();
    const climb = this.climb;
    if (climb) {
      // A step up that brings the drops back is undone, and that height left alone for a while.
      if (share < STARVED) {
        this.climb = null;
        this.upLimit = this.ceiling;
        this.upBlockedUntil = now + this.block;
        this.block = Math.min(this.block * 2, LONGEST);
        this.starved = 0;
        this.easy = 0;
        return this.set(climb.from);
      }
      if (++climb.windows >= JUDGE_WINDOWS) {
        this.climb = null;
        this.block = BLOCK;
      }
      return false;
    }
    const descent = this.descent;
    if (descent && this.ceiling <= FLOOR + 1e-9 && share < EASY) {
      // As low as it goes: did the pixels given up help? Judged on every window there, starved or not.
      descent.atFloor.push(share);
      if (descent.atFloor.length >= JUDGE_WINDOWS) {
        this.descent = null;
        const after = descent.atFloor.reduce((sum, v) => sum + v, 0) / descent.atFloor.length;
        if (after < descent.before + HELPS) {
          // Not: the tracker is slow for another reason, and the picture gets its pixels back.
          this.downBlockedUntil = now + this.block;
          this.block = Math.min(this.block * 2, LONGEST);
          this.starved = 0;
          this.easy = 0;
          return this.set(descent.from);
        }
      }
    }
    if (share < STARVED) {
      this.easy = 0;
      if (++this.starved < STARVED_WINDOWS || this.ceiling <= FLOOR + 1e-9 || now < this.downBlockedUntil) return false;
      this.starved = 0;
      // A descent lasts until it is judged: a window of relief between two steps does not start a new one.
      this.descent ??= { from: this.ceiling, before: this.recent.reduce((sum, v) => sum + v, 0) / this.recent.length, atFloor: [] };
      return this.set(this.ceiling - STEP_DOWN);
    }
    this.starved = 0;
    if (share < EASY) {
      this.easy = 0;
      return false;
    }
    // Room to spare: whatever was given up helped, and some of it can come back.
    this.descent = null;
    if (++this.easy < EASY_WINDOWS || this.ceiling >= 1 - 1e-9) return false;
    this.easy = 0;
    const next = Math.min(1, this.ceiling + STEP_UP);
    if (now < this.upBlockedUntil && next >= this.upLimit - 1e-9) return false;
    this.climb = { from: this.ceiling, windows: 0 };
    return this.set(next);
  }

  private set(ceiling: number): boolean {
    const next = Math.round(Math.min(1, Math.max(FLOOR, ceiling)) * 100) / 100;
    if (next === this.ceiling) return false;
    this.ceiling = next;
    return true;
  }
}
