/**
 * The late-wave pressure, as High Noon and Dead of Night share it: a wave
 * dragged on turns against the player. After a while the other side grows
 * bolder a little every second, up to a limit, and an easier difficulty's
 * allowances wear off toward Standard's as it does, so a Relaxed player who
 * stops shooting is not kept alive for ever. When the clock starts, and what
 * the boldness multiplies, is each game's own.
 */

/** A difficulty's late-wave pressure: bolder after `boldAfter` seconds, by `boldRate` a second, to `boldMax` times. */
export interface BoldTuning {
  boldAfter: number;
  boldRate: number;
  boldMax: number;
}

/** How bold `seconds` of a wave have made the other side, as a multiplier: 1 until boldAfter, then climbing to boldMax. */
export function boldnessAfter(t: BoldTuning, seconds: number): number {
  return Math.min(t.boldMax, 1 + Math.max(0, seconds - t.boldAfter) * t.boldRate);
}

/** A boldness as a fraction of the way to the most it can be: 0 (none yet) to 1 (at boldMax). */
export function pressureOf(t: BoldTuning, boldness: number): number {
  const max = t.boldMax;
  return max > 1 ? (boldness - 1) / (max - 1) : 0;
}

/** The numbers named by `keys` worn from a difficulty's own (`from`) toward Standard's (`to`), the fraction `k` of the way. */
export function wearToward<K extends string>(tuning: Record<K, number>, from: Readonly<Record<K, number>>, to: Readonly<Record<K, number>>, keys: readonly K[], k: number): void {
  for (const key of keys) tuning[key] = from[key] + (to[key] - from[key]) * k;
}
