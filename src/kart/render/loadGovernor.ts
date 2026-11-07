/**
 * The race's load governor: when frames run long mid-race it takes work away a step at a time, and gives it back
 * only when the machine has shown it can carry it.
 *
 * Dynamic resolution (engine/dynamicResolution.ts) trades pixels, and a tier (quality.ts) is chosen once per race. The
 * work that grows with several players on one screen is not pixels: it is what is drawn again for every view (the
 * shadow pass, the karts, the far scenery, the particles). A step here takes some of that away, cheapest to see first.
 *
 *  - Down is quick but never hasty: two slow windows in a row (about 1.5 s), then a pause for the frames to settle.
 *  - A step that bought no quicker frame is undone and the governor leaves things as they are until the frames change
 *    (a browser saving the battery at 30 fps, a busy hand tracker: less drawing would not help and would only cost).
 *  - Up is slow: a long run of easy windows, then ONE step as a trial. A trial that fails is stepped back at once and
 *    that step is closed for twice as long as the last time; after `TRIALS` trials in a race it stays where it is. So
 *    it cannot flicker between two looks.
 */

/** How many steps below the full picture there are. */
export const MAX_LEVEL = 4;

/** What a level changes. Level 0 is the picture as it has always been. */
export interface LoadLook {
  /** Views whose karts are within this many metres share one shadow pass (0: a pass for each view). */
  shadowSpread: number;
  /** The most shadow passes a frame may make. */
  shadowPasses: number;
  /** The most metres from a camera at which a kart is drawn as its full set of parts (the rest welded). Infinity: the tier's own. */
  kartDetail: number;
  /** Share of the particles to make (1 = all). */
  particles: number;
  /** Scenery farther than this share of the fog's far distance is not drawn (0: all of it, as before). */
  sceneryReach: number;
  /** The most samples along the rush's streaks (the boost's blur). */
  rushTaps: number;
}

/** `range` is the tier's shadow half width, metres. */
export function lookFor(level: number, range: number): LoadLook {
  switch (Math.max(0, Math.min(MAX_LEVEL, Math.round(level)))) {
    case 0:
      return { shadowSpread: 0, shadowPasses: 4, kartDetail: Infinity, particles: 1, sceneryReach: 0, rushTaps: 6 };
    case 1:
      return { shadowSpread: range * 0.5, shadowPasses: 4, kartDetail: 24, particles: 0.75, sceneryReach: 0, rushTaps: 4 };
    case 2:
      return { shadowSpread: range, shadowPasses: 3, kartDetail: 18, particles: 0.55, sceneryReach: 1, rushTaps: 3 };
    case 3:
      return { shadowSpread: range * 1.5, shadowPasses: 2, kartDetail: 15, particles: 0.4, sceneryReach: 0.85, rushTaps: 2 };
    default:
      return { shadowSpread: range * 2, shadowPasses: 1, kartDetail: 12, particles: 0.3, sceneryReach: 0.7, rushTaps: 0 };
  }
}

/** Frames per judgement: three quarters of a second at 60 fps. */
const WINDOW = 45;
/** Slower than this multiple of the target, by the window's median, is slow. */
const SLOW = 1.25;
/** Quicker than this multiple is room to spare. */
const EASY = 1.08;
/** Slow windows in a row before a step down. */
const SLOW_WINDOWS = 2;
/** Frames left alone after a step for the frames to settle (about 2.5 s). */
const SETTLE = 150;
/** Easy windows in a row before a trial step up (about 12 s). */
const EASY_WINDOWS = 16;
/** A trial step up holds if it is still easy this many frames later (about 6 s). */
const TRIAL_FRAMES = 360;
/** How long a step that failed a trial stays closed, in frames: 30 s, doubling. */
const CLOSED = 1800;
const CLOSED_MOST = 14400;
/** Trial steps up a race may make. */
const TRIALS = 3;
/** A step down is kept if the frames are at least this much quicker (a 5% gain). */
const GAIN = 0.95;
/** Futile steps hold while the frames stay within this band of what they were when it was found. */
const BAND: readonly [number, number] = [0.8, 1.25];
/** An interval this long is a hitch (a tab switch, a debugger), not a trend. */
const HITCH = 250;

export class LoadGovernor {
  level: number;
  /** Frames seen: the clock of the governor. */
  private frames = 0;
  private window: number[] = [];
  private slowWindows = 0;
  private easyWindows = 0;
  private settleUntil = 0;
  /** The step just made down, to be judged: the interval it began from, and when to judge. */
  private judging: { before: number; at: number } | null = null;
  /** A trial step up in progress: from which level, and when it began. */
  private trial: { from: number; at: number } | null = null;
  private trials = 0;
  private closedFrom = Infinity;
  private closedUntil = 0;
  private closedFor = CLOSED;
  /** Frames at which less drawing bought nothing; held until they change. */
  private futile: number | null = null;
  private lastInterval = 0;

  constructor(
    readonly target = 1000 / 60,
    start = 0,
    private readonly max = MAX_LEVEL,
  ) {
    this.level = Math.max(0, Math.min(max, start));
  }

  /** One frame's interval, ms. True when the level changed. */
  sample(interval: number): boolean {
    if (!(interval > 0) || interval > HITCH) {
      this.window = [];
      return false;
    }
    this.frames++;
    if (this.frames >= this.closedUntil) this.closedFrom = Infinity;
    if (this.trial && this.frames - this.trial.at > TRIAL_FRAMES) {
      this.trial = null;
      this.closedFor = CLOSED;
    }
    if (this.frames < this.settleUntil) {
      this.window = [];
      return false;
    }
    this.window.push(interval);
    if (this.window.length < WINDOW) return false;
    const sorted = [...this.window].sort((a, b) => a - b);
    this.window = [];
    const median = (sorted[(WINDOW >> 1) - 1]! + sorted[WINDOW >> 1]!) / 2;
    // The mean of the middle, for judging a step: one hitch should not decide it.
    let sum = 0;
    for (let i = 5; i < WINDOW - 5; i++) sum += sorted[i]!;
    const mean = sum / (WINDOW - 10);
    this.lastInterval = mean;

    const slow = median > this.target * SLOW;
    const easy = median < this.target * EASY;

    // A step down is judged once the frames have settled after it.
    if (this.judging && this.frames >= this.judging.at) {
      const { before } = this.judging;
      this.judging = null;
      if (slow && mean > before * GAIN && this.level > 0) {
        // Nothing came of it: put it back, and leave this alone while the frames stay as they are.
        this.futile = mean;
        return this.set(this.level - 1);
      }
    }
    if (!slow) this.futile = null;

    if (slow) {
      this.easyWindows = 0;
      if (this.futile !== null && mean > this.futile * BAND[0] && mean < this.futile * BAND[1]) return false;
      this.futile = null;
      this.slowWindows++;
      if (this.trial) {
        // The trial failed: back down at once, that step closed for twice as long as before.
        const from = this.trial.from;
        this.closedFrom = from;
        this.closedUntil = this.frames + this.closedFor;
        this.closedFor = Math.min(this.closedFor * 2, CLOSED_MOST);
        this.trial = null;
        this.slowWindows = 0;
        return this.set(from);
      }
      if (this.slowWindows >= SLOW_WINDOWS && this.level < this.max) {
        this.slowWindows = 0;
        this.judging = { before: mean, at: this.frames + SETTLE };
        return this.set(this.level + 1);
      }
      return false;
    }

    this.slowWindows = 0;
    if (easy) {
      this.easyWindows++;
      const next = this.level - 1;
      if (this.level > 0 && this.easyWindows >= EASY_WINDOWS && this.trials < TRIALS && this.level < this.closedFrom && !this.trial) {
        this.trials++;
        this.trial = { from: this.level, at: this.frames };
        return this.set(next);
      }
    } else {
      this.easyWindows = 0;
    }
    return false;
  }

  /** How long the last window's frames took (ms), for the tools. */
  get interval(): number {
    return this.lastInterval;
  }

  /** A new race: back to `level`, with the trials and the closed steps forgotten. */
  reset(level = 0): void {
    this.level = Math.max(0, Math.min(this.max, level));
    this.window = [];
    this.slowWindows = 0;
    this.easyWindows = 0;
    this.settleUntil = this.frames + SETTLE;
    this.judging = null;
    this.trial = null;
    this.trials = 0;
    this.closedFrom = Infinity;
    this.closedFor = CLOSED;
    this.futile = null;
  }

  private set(level: number): boolean {
    const next = Math.max(0, Math.min(this.max, level));
    this.settleUntil = this.frames + SETTLE;
    this.easyWindows = 0;
    if (next === this.level) return false;
    this.level = next;
    return true;
  }
}

// ─── What a device remembers ───────────────────────────────────────────────

/** Where the level a race ended at is kept, per number of views (four views need more taken away than one). */
export const LOAD_KEY = "handy.kart.load.v1";
/** A remembered level is good for 14 days. */
const KEPT_MS = 14 * 24 * 3600 * 1000;

interface Kept {
  [views: string]: { level: number; at: number } | undefined;
}

/** The level to start a race with `views` views at on this device (0 where nothing is kept, or storage is unavailable). */
export function keptLevel(storage: Pick<Storage, "getItem"> | null | undefined, views: number, now = Date.now()): number {
  try {
    const kept = JSON.parse(storage?.getItem(LOAD_KEY) ?? "{}") as Kept;
    const one = kept[String(views)];
    if (!one || !(one.level >= 0) || now - one.at > KEPT_MS) return 0;
    return Math.min(MAX_LEVEL, Math.round(one.level));
  } catch {
    return 0;
  }
}

/** Remembers the level a race with `views` views is at. */
export function keepLevel(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, views: number, level: number, now = Date.now()): void {
  try {
    if (!storage) return;
    let kept: Kept = {};
    try {
      kept = JSON.parse(storage.getItem(LOAD_KEY) ?? "{}") as Kept;
    } catch {
      kept = {};
    }
    kept[String(views)] = { level, at: now };
    storage.setItem(LOAD_KEY, JSON.stringify(kept));
  } catch {
    // Private windows and full disks: the next race starts at the top, which is all that is lost.
  }
}
