import { describe, expect, it } from "vitest";
import { playUntilDeath, standIdle } from "./testkit";

/**
 * A simulated player with a finger for a gun (testkit.ts): sees a bandit,
 * takes about two thirds of a second to get the shot off, hits four times
 * in five, can fold the thumb at most three times a second, and reloads when
 * empty. Played against the real rules over many seeds, the difficulty curve
 * should be fair early and tense later.
 */
describe("difficulty", () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  it("lets a steady hand through the first waves, and still gets them in the end", () => {
    const waves = seeds.map((s) => playUntilDeath(s, { reaction: 0.65, accuracy: 0.8 }).wave).sort((a, b) => a - b);
    const median = waves[Math.floor(waves.length / 2)] as number;
    console.log(`steady hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(3);
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(16);
  });

  it("is harder on a slow, wild hand, but never over in the first wave", () => {
    const waves = seeds.map((s) => playUntilDeath(s, { reaction: 1.0, accuracy: 0.55 }).wave).sort((a, b) => a - b);
    const median = waves[Math.floor(waves.length / 2)] as number;
    console.log(`slow, wild hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThan(10);
  });
});

describe("an idle player", () => {
  it("is overrun in the end, however forgiving the first wave", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const x = standIdle(seed, "standard", 240);
      expect(x.dead, `seed ${seed}`).toBe(true);
      expect(x.wave, "never shooting, the first wave never clears").toBe(1);
    }
  });
});
