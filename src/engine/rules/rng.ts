/**
 * Small helpers over a game's seeded random source.
 *
 * Every decision a game's rules make should go through the `() => number` the
 * host puts in GameContext.random, so a seed replays a whole round exactly —
 * which is what makes the rules testable and a reported bug reproducible
 * (High Noon's gang decides everything this way).
 */
import { seededRandom } from "../random";

export type Random = () => number;

export function range(random: Random, low: number, high: number): number {
  return low + (high - low) * random();
}

export function chance(random: Random, p: number): boolean {
  return random() < p;
}

export function pickIndex(random: Random, length: number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

export function pick<T>(random: Random, list: readonly T[]): T {
  const item = list[pickIndex(random, list.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

/** Fisher–Yates, in place. */
export function shuffle<T>(random: Random, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = list[i] as T;
    list[i] = list[j] as T;
    list[j] = a;
  }
  return list;
}

/**
 * A tiny, fast, well-mixed PRNG (engine/random.ts's seededRandom, mulberry32),
 * typed as a Random: for a game's own fixed-seed choices (scenery, layouts,
 * the placeholders' paint) and the dev harness's `?seed=`.
 */
export function mulberry32(seed: number): Random {
  return seededRandom(seed);
}
