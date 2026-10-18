/**
 * Dynamic resolution: render fewer pixels when frames run long, more when
 * there is room, so an ordinary laptop holds a steady frame rate instead of
 * stuttering at full resolution.
 *
 * It watches the interval between animation frames, which is what the player
 * feels. With vsync that interval is quantised - a frame that misses its slot
 * takes two - so a GPU that cannot keep up shows as intervals well above the
 * target, not slightly above it, and the thresholds can be generous. Going
 * down is quick (half a second of slow frames); coming back up is slow (two
 * seconds of easy ones). A step up that does not hold goes straight back and
 * waits twice as long before trying again, so the picture does not pump
 * between two sizes. Asked to (`restoreFutile`), it also undoes a run of
 * steps down that bought no quicker frame, and leaves it at that.
 */
export interface DynamicResolutionOptions {
  min?: number;
  max?: number;
  /** The frame interval to hold, in ms: 60 fps. */
  target?: number;
  /** The starting scale, from the GPU tier guess. */
  initial?: number;
  /**
   * Give the pixels back when fewer of them bought no quicker frame: the
   * frame rate is held by something else - a browser saving the battery at
   * 30 fps (Chrome's Energy Saver, Low Power Mode), or a busy main thread -
   * and a blurred picture would cost the player for nothing. A game that
   * answers a machine that cannot keep up by lowering its effects (Grip Prix,
   * through StrainWatch) watches `spent`, not the floor, with it on.
   */
  restoreFutile?: boolean;
}

/** Frames per judgement: about half a second at 60 fps. */
const WINDOW = 30;
/** Slower than this multiple of the target, on average, is too slow. */
const SLOW = 1.2;
/** Faster than this multiple, on average, is room to spare. */
const EASY = 1.05;
/** Easy windows in a row before the scale goes back up (two seconds). */
const EASY_WINDOWS = 4;
/** How long a scale that proved too slow is left alone, in frames (ten
 * seconds), doubling each time a retry fails, up to a minute. */
const REMEMBER = 600;
const REMEMBER_MOST = 3600;
/** A step up that lasts this many frames has held. */
const TRIAL = WINDOW * EASY_WINDOWS * 2;
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;
/**
 * restoreFutile: a descent is judged once this far below where it began (a
 * third less on each side, about half the pixels) or at the floor; if the
 * frames are not at least FUTILE_GAIN quicker by then, it is undone.
 */
const FUTILE_DEPTH = 0.3;
const FUTILE_GAIN = 0.95;
/** Restored, the scale is held while the frames stay within this band of what they were; outside it, something changed. */
const FUTILE_BAND: readonly [number, number] = [0.8, 1.25];
/** An interval this long is a hitch - a tab switch, a paused debugger - not a trend. */
const HITCH = 250;

export class DynamicResolution {
  readonly min: number;
  readonly max: number;
  readonly target: number;
  scale: number;
  private window: number[] = [];
  private frames = 0;
  private easyWindows = 0;
  private cooldown = 0;
  private blockedFrom = Number.POSITIVE_INFINITY;
  private blockedUntil = 0;
  private backoff = REMEMBER;
  private probe: { from: number; at: number } | null = null;
  private readonly restoreFutile: boolean;
  /** restoreFutile: where the current run of steps down began, and how long its frames took then. */
  private descent: { from: number; interval: number } | null = null;
  /** restoreFutile: fewer pixels were found to buy nothing at frames this long; held until they change. */
  private futile: number | null = null;

  constructor(options: DynamicResolutionOptions = {}) {
    this.min = options.min ?? 0.6;
    this.max = options.max ?? 1;
    this.target = options.target ?? 1000 / 60;
    this.scale = this.clamp(options.initial ?? this.max);
    this.restoreFutile = options.restoreFutile ?? false;
  }

  /** One frame's interval, in ms. True when the scale changed. */
  sample(interval: number): boolean {
    if (!(interval > 0) || interval > HITCH) {
      this.window = [];
      return false;
    }
    this.frames++;
    if (this.frames >= this.blockedUntil) this.blockedFrom = Number.POSITIVE_INFINITY;
    if (this.probe && this.frames - this.probe.at > TRIAL) {
      this.probe = null; // it held
      this.backoff = REMEMBER;
    }
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    this.window.push(interval);
    if (this.window.length < WINDOW) return false;
    // The window's median, not its mean: a GPU that cannot keep up misses
    // most of its slots, while one hitch - a tab switch, garbage collection,
    // the tracker compiling a shader - is one frame and says nothing about
    // the resolution.
    const sorted = [...this.window].sort((a, b) => a - b);
    const average = (sorted[(WINDOW >> 1) - 1]! + sorted[WINDOW >> 1]!) / 2;
    this.window = [];
    const slow = average > this.target * SLOW;

    if (this.restoreFutile) {
      // How long the frames take, to tell whether fewer pixels helped: the
      // mean of the middle of the window, so one hitch does not decide it.
      let sum = 0;
      for (let i = 3; i < WINDOW - 3; i++) sum += sorted[i]!;
      const interval = sum / (WINDOW - 6);
      if (!slow) {
        this.descent = null;
        this.futile = null;
      } else if (this.futile !== null) {
        if (interval > this.futile * FUTILE_BAND[0] && interval < this.futile * FUTILE_BAND[1]) {
          this.easyWindows = 0;
          return false;
        }
        this.futile = null; // heavier or lighter: the pixels may matter now
      } else if (this.descent && (this.descent.from - this.scale >= FUTILE_DEPTH - 1e-9 || this.scale <= this.min + 1e-9) && interval > this.descent.interval * FUTILE_GAIN) {
        const from = this.descent.from;
        this.descent = null;
        this.futile = interval;
        this.probe = null;
        this.blockedFrom = Number.POSITIVE_INFINITY;
        return this.set(from);
      }
      if (slow && !this.descent && !this.probe && this.scale > this.min) this.descent = { from: this.scale, interval };
    }

    if (slow && this.scale > this.min) {
      const back = this.probe ? this.probe.from : this.scale - STEP_DOWN;
      this.backoff = this.probe ? Math.min(this.backoff * 2, REMEMBER_MOST) : REMEMBER;
      this.blockedFrom = this.scale;
      this.blockedUntil = this.frames + this.backoff;
      this.probe = null;
      return this.set(back);
    }
    if (average < this.target * EASY) {
      this.easyWindows++;
      const next = this.clamp(this.scale + STEP_UP);
      if (this.easyWindows >= EASY_WINDOWS && next > this.scale + 1e-9 && next < this.blockedFrom - 1e-9) {
        this.probe = { from: this.scale, at: this.frames };
        return this.set(next);
      }
    } else {
      this.easyWindows = 0;
    }
    return false;
  }

  /**
   * Pixels have done all they can for frames that are still slow: the scale is
   * at its floor, or (restoreFutile) fewer pixels were found to buy nothing at
   * these frames and the scale is held where it began.
   */
  get spent(): boolean {
    return this.scale <= this.min + 1e-6 || this.futile !== null;
  }

  /** Back to a clean slate: after a pause, or when a new game starts. */
  reset(scale = this.scale): void {
    this.window = [];
    this.easyWindows = 0;
    this.cooldown = 0;
    this.blockedFrom = Number.POSITIVE_INFINITY;
    this.probe = null;
    this.backoff = REMEMBER;
    this.descent = null;
    // What the frames were found to be held by (the browser's own cap) is
    // the page's, not the game's or the round's: it stays.
    this.scale = this.clamp(scale);
  }

  private clamp(scale: number): number {
    return Math.round(Math.min(this.max, Math.max(this.min, scale)) * 100) / 100;
  }

  private set(scale: number): boolean {
    const next = this.clamp(scale);
    this.easyWindows = 0;
    // A new size takes a frame or two to settle; judge it after that.
    this.cooldown = 10;
    if (next === this.scale) return false;
    this.scale = next;
    return true;
  }
}

/**
 * Notices a machine that dynamic resolution cannot save: pixels have been
 * spent (`DynamicResolution.spent`, or the floor), frame after frame, for
 * `after` seconds. A hitch (a tab put away, a debugger) is not time spent
 * struggling and starts the count again. It speaks once, and keeps how long
 * those frames took, so a remedy can later be judged by whether it made them
 * quicker. Running `steadyAfter` seconds without speaking is the other
 * answer: the machine kept up.
 */
export class StrainWatch {
  private seconds = 0;
  private total = 0;
  private told = false;
  private frames: number[] = [];

  constructor(
    private readonly after = 6,
    private readonly steadyAfter = Number.POSITIVE_INFINITY,
  ) {}

  /** One frame of `seconds`; true, once, when pixels have been spent long enough. */
  frame(seconds: number, spent: boolean): boolean {
    const hitch = !(seconds > 0) || seconds > HITCH / 1000;
    if (!hitch) this.total += seconds;
    if (!spent || hitch) {
      this.seconds = 0;
      if (!this.told) this.frames = [];
      return false;
    }
    this.seconds += seconds;
    if (this.told) return false;
    this.frames.push(seconds * 1000);
    if (this.seconds < this.after) return false;
    this.told = true;
    return true;
  }

  /** The median interval, in ms, of the frames it spoke about (null until it has). */
  get interval(): number | null {
    if (!this.told || this.frames.length === 0) return null;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  /** True once `steadyAfter` seconds have run without it speaking. */
  get steady(): boolean {
    return !this.told && this.total >= this.steadyAfter;
  }
}
