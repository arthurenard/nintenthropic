import { describe, expect, it } from "vitest";
import { placeholderRoad, playUntilDeath, shippedRoad, SLOWEST, standIdle, STEADY, WILD, type Skill } from "./testkit";

/**
 * Simulated players against the real rules on Standard, over many seeds
 * (testkit.ts says how each plays), on the road the game ships with (its
 * lanes, barricade and survivors' runs, read from road.glb): the night
 * should be tense from the start and end for everyone in the end. A steady
 * hand falls around wave 9, a slow, wild one around 5-6 and the slowest
 * around 3-4; Relaxed carries each of them several waves further
 * (difficulty.test.ts).
 */
const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
const road = (await shippedRoad()) ?? placeholderRoad();

function falls(skill: Skill): { waves: number[]; median: number } {
  const waves = seeds.map((s) => playUntilDeath(s, skill, { maxTime: 3600, road }).wave).sort((a, b) => a - b);
  return { waves, median: waves[Math.floor(waves.length / 2)] as number };
}

// Each case plays sixteen whole nights: give a busy machine time.
describe("the night on Standard", { timeout: 120_000 }, () => {
  it("lets a steady hand through the first waves, takes it around wave 9, and ends the night for all of them", () => {
    const { waves, median } = falls(STEADY);
    console.log(`steady hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(5);
    expect(median).toBeGreaterThanOrEqual(8);
    expect(median).toBeLessThanOrEqual(10);
    expect(waves.filter((w) => w <= 25).length).toBe(seeds.length);
    // Nobody coasts to wave 14: the night is tense for a hand that does everything right.
    expect(waves[waves.length - 1]).toBeLessThanOrEqual(13);
  });

  it("is harder on a slow, wild hand, which falls around wave 5 or 6 and rarely sees wave 9", () => {
    const { waves, median } = falls(WILD);
    console.log(`slow, wild hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(2);
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(6);
    expect(waves.filter((w) => w > 9).length).toBe(0);
  });

  it("gives the slowest hand a few waves: it falls around the third or fourth, and hardly ever on the first", () => {
    const { waves, median } = falls(SLOWEST);
    console.log(`slowest hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves.filter((w) => w === 1).length).toBeLessThanOrEqual(2);
    expect(median).toBeGreaterThanOrEqual(3);
    expect(median).toBeLessThanOrEqual(4);
  });
});

describe("an idle player", () => {
  it("is overrun on the first wave, when the first walkers reach the barricade, in about half a minute", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const x = standIdle(seed, "standard", 240, road);
      expect(x.dead, `seed ${seed}`).toBe(true);
      expect(x.wave, "never shooting, the first wave never clears").toBe(1);
      // The first wave opens with a burst (the phone booth's walker is 22 m out): 22-35 s on the shipped road.
      expect(x.time).toBeGreaterThan(15);
      expect(x.time).toBeLessThan(45);
    }
  });
});
