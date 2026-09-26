/**
 * How accurate the player's aim is, from the errors of their last shots.
 *
 * Each shot of the aim check gives an honest predictive error: where the map
 * in force said the shot went, minus the target's centre, in fractions of the
 * viewport's smaller side. Treating those errors as a 2D Gaussian, the score is
 * the probability that a shot lands within R of where the player aims.
 */

/** R: 3.5% of the smaller viewport side - a bandit's torso at mid-street. */
export const AIM_RADIUS = 0.035;
/** The check ends on its own at this score. */
export const READY_SCORE = 0.95;
/** How many of the latest predictive errors the score is measured over. */
export const SCORE_WINDOW = 6;
/** The fewest predictive errors a score is trusted from. */
export const MIN_ERRORS = 3;

export type Vector = readonly [number, number];

/**
 * σ of a 2D Gaussian fitted to the errors, `σ² = Σ|e|² / 2n`, and their mean
 * vector: the systematic bias a good σ can hide (every shot a little left).
 */
export function spread(errors: readonly Vector[]): { sigma: number; bias: [number, number] } {
  if (!errors.length) return { sigma: Number.POSITIVE_INFINITY, bias: [0, 0] };
  let squares = 0;
  let bx = 0;
  let by = 0;
  for (const [x, y] of errors) {
    squares += x * x + y * y;
    bx += x;
    by += y;
  }
  return { sigma: Math.sqrt(squares / (2 * errors.length)), bias: [bx / errors.length, by / errors.length] };
}

/** `1 − exp(−R² / 2σ²)`: the chance a shot lands within R of the aim point. */
export function aimScore(sigma: number, radius = AIM_RADIUS): number {
  if (!(sigma > 0)) return sigma === 0 ? 1 : 0;
  if (!Number.isFinite(sigma)) return 0;
  return 1 - Math.exp(-(radius * radius) / (2 * sigma * sigma));
}

export interface Measure {
  /** 0..1; null until there is a first predictive error. */
  score: number | null;
  sigma: number;
  bias: [number, number];
  /** How many errors the score is over (at most SCORE_WINDOW). */
  count: number;
  /** The aim is good enough to play: score, count and bias all agree. */
  ready: boolean;
}

/** The score over the latest errors, and whether it is good enough to play. */
export function measure(errors: readonly Vector[], radius = AIM_RADIUS): Measure {
  const recent = errors.slice(-SCORE_WINDOW);
  if (!recent.length) return { score: null, sigma: Number.POSITIVE_INFINITY, bias: [0, 0], count: 0, ready: false };
  const { sigma, bias } = spread(recent);
  const score = aimScore(sigma, radius);
  const ready = recent.length >= MIN_ERRORS && score >= READY_SCORE && Math.hypot(bias[0], bias[1]) < radius / 2;
  return { score, sigma, bias, count: recent.length, ready };
}
