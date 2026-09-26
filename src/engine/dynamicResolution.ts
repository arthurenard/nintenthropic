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
 * between two sizes.
 */
export interface DynamicResolutionOptions {
  min?: number;
  max?: number;
  /** The frame interval to hold, in ms: 60 fps. */
  target?: number;
  /** The starting scale, from the GPU tier guess. */
  initial?: number;
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

  constructor(options: DynamicResolutionOptions = {}) {
    this.min = options.min ?? 0.6;
    this.max = options.max ?? 1;
    this.target = options.target ?? 1000 / 60;
    this.scale = this.clamp(options.initial ?? this.max);
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

    if (average > this.target * SLOW && this.scale > this.min) {
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

  /** Back to a clean slate: after a pause, or when a new game starts. */
  reset(scale = this.scale): void {
    this.window = [];
    this.easyWindows = 0;
    this.cooldown = 0;
    this.blockedFrom = Number.POSITIVE_INFINITY;
    this.probe = null;
    this.backoff = REMEMBER;
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
