/**
 * A small, fast, seeded random source (mulberry32): the same seed gives the
 * same sequence on every machine, so a game can be replayed and a test can
 * be exact. Not for anything that needs to be unguessable.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normally distributed numbers from a uniform source (Box-Muller). */
export function gaussian(random: () => number): (mean?: number, deviation?: number) => number {
  return (mean = 0, deviation = 1) => {
    // 1 - u keeps the logarithm away from zero.
    const u = 1 - random();
    const v = random();
    return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
