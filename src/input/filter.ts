/**
 * Jitter filtering for the crosshair (a port of the desktop's filtering.py).
 *
 * A plain exponential average forces a bad trade: enough smoothing to hold the
 * crosshair still on a target also makes it lag behind fast movement. The One
 * Euro filter [1] adapts instead - it smooths hard when the hand is slow, where
 * jitter is visible and precision matters, and lets go when the hand moves
 * fast, where lag is visible and jitter is not.
 *
 * [1] Casiez, Roussel & Vogel, "1€ Filter: A Simple Speed-based Low-pass
 *     Filter for Noisy Input in Interactive Systems", CHI 2012.
 *
 * Times are in seconds throughout, as in the original.
 */

/** Exponential-average weight for a low-pass at `cutoff` Hz over `dt` s. */
export function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** A one-pole low-pass whose weight is supplied per sample. */
export class LowPass {
  value: number | null = null;

  step(sample: number, alpha: number): number {
    if (this.value === null) this.value = sample;
    else this.value += alpha * (sample - this.value);
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * Speed-adaptive low-pass filter for a single scalar.
 *
 * `minCutoff` sets how still the signal is held when the hand barely moves -
 * lower is steadier. `beta` sets how quickly the filter opens up as the hand
 * speeds up - higher is more responsive but jumpier.
 */
export class OneEuroFilter {
  private readonly value = new LowPass();
  private readonly speed = new LowPass();
  private lastTime: number | null = null;
  private _minCutoff = 1.2;
  private _beta = 0.8;

  constructor(
    minCutoff = 1.2,
    beta = 0.8,
    readonly derivativeCutoff = 1.0,
  ) {
    if (!(derivativeCutoff > 0)) throw new RangeError("cutoffs must be positive");
    this.tune(minCutoff, beta);
  }

  get minCutoff(): number {
    return this._minCutoff;
  }

  get beta(): number {
    return this._beta;
  }

  /**
   * New settings from the next sample on, keeping what the filter has seen:
   * the player changing their Aim Steadiness mid-game sees no jump.
   */
  tune(minCutoff: number, beta: number): void {
    if (!(minCutoff > 0)) throw new RangeError("cutoffs must be positive");
    if (!(beta >= 0)) throw new RangeError("beta must not be negative");
    this._minCutoff = minCutoff;
    this._beta = beta;
  }

  filter(sample: number, timestamp: number): number {
    if (!Number.isFinite(sample) || !Number.isFinite(timestamp)) {
      // One NaN folded into the average would stay there for good, and every
      // later output with it. Hold what we have instead.
      return this.value.value ?? sample;
    }
    if (this.lastTime === null) {
      // First sample: nothing to derive a speed from yet.
      this.lastTime = timestamp;
      this.speed.step(0, 1);
      return this.value.step(sample, 1);
    }
    const dt = timestamp - this.lastTime;
    if (dt <= 0) {
      // A clock that stalled or ran backwards: no time has passed to move in.
      // Starting afresh here would pass the raw sample straight through - one
      // unfiltered jump - and throw away the speed estimate; winding the clock
      // back would mismeasure the next real frame too.
      return this.value.value ?? sample;
    }
    this.lastTime = timestamp;
    const previous = this.value.value;
    const rate = previous === null ? 0 : (sample - previous) / dt;
    const speed = this.speed.step(rate, smoothingFactor(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(speed);
    return this.value.step(sample, smoothingFactor(cutoff, dt));
  }

  /** The last output, or null before the first sample. */
  get current(): number | null {
    return this.value.value;
  }

  reset(): void {
    this.value.reset();
    this.speed.reset();
    this.lastTime = null;
  }
}

/**
 * How fast a filtered signal is moving, in units per second.
 *
 * The One Euro filter's own speed term is not a velocity: it compares each raw
 * sample with the lagging filtered value, so under steady motion it reads the
 * true speed divided by the smoothing weight - two or three times too fast.
 * Extrapolating the crosshair needs the real rate of change of what is on
 * screen, so it is measured here from the filter's successive outputs and
 * lightly smoothed, which also keeps one noisy frame from flinging the
 * prediction.
 */
export class Velocity {
  private readonly smooth = new LowPass();
  private last: { value: number; time: number } | null = null;

  constructor(readonly cutoff = 5) {}

  update(value: number, time: number): number {
    if (this.last !== null && time > this.last.time) {
      const dt = time - this.last.time;
      this.smooth.step((value - this.last.value) / dt, smoothingFactor(this.cutoff, dt));
    }
    if (this.last === null || time > this.last.time) this.last = { value, time };
    return this.smooth.value ?? 0;
  }

  get value(): number {
    return this.smooth.value ?? 0;
  }

  reset(): void {
    this.smooth.reset();
    this.last = null;
  }
}

export type Point = readonly [number, number];

/** One Euro filter applied to a 2D point, one axis each. */
export class PointFilter {
  private readonly x: OneEuroFilter;
  private readonly y: OneEuroFilter;

  constructor(minCutoff = 1.2, beta = 0.8) {
    this.x = new OneEuroFilter(minCutoff, beta);
    this.y = new OneEuroFilter(minCutoff, beta);
  }

  filter(point: Point, timestamp: number): [number, number] {
    return [this.x.filter(point[0], timestamp), this.y.filter(point[1], timestamp)];
  }

  tune(minCutoff: number, beta: number): void {
    this.x.tune(minCutoff, beta);
    this.y.tune(minCutoff, beta);
  }

  get minCutoff(): number {
    return this.x.minCutoff;
  }

  get beta(): number {
    return this.x.beta;
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
  }
}

/**
 * Drops single-frame outliers from a scalar without adding real lag.
 *
 * The window is filled on the first sample rather than grown into. A window of
 * two has no middle - the larger of the pair would pass - so a part-filled
 * filter used to pass an upward spike straight through, on the frame right
 * after every reset. That is precisely the worst moment for it: the trigger
 * resets this filter when it loses the hand, arms on the first frame back that
 * shows the thumb up, and would then read one misread second frame as a pull -
 * a shot the player never took, at the moment the hand came back. Repeating
 * the first reading costs one frame of lag, once, and nothing after that.
 */
export class MedianOf3 {
  private history: number[] = [];

  filter(sample: number): number {
    const window = this.history.length ? this.history : [sample, sample];
    this.history = [...window.slice(-2), sample];
    const sorted = [...this.history].sort((a, b) => a - b);
    return sorted[1]!;
  }

  reset(): void {
    this.history = [];
  }
}
