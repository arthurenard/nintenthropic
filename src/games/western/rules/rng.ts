/**
 * Small helpers over the game's seeded random source.
 *
 * Every decision the gang makes goes through the `() => number` the host puts
 * in GameContext.random, so a seed replays a whole gunfight exactly — which is
 * what makes the rules testable and a reported bug reproducible.
 */
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
 * A tiny, fast, well-mixed PRNG for the dev harness and tests. The app brings
 * its own seeded source; this one only exists so a `?seed=` can be replayed.
 */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
