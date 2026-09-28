import { describe, expect, it } from "vitest";
import { placeholderRoad, playUntilDeath, shippedRoad, SLOWEST, standIdle, STEADY, WILD, type Skill } from "./testkit";

/**
 * Simulated players against the real rules on Standard, over many seeds
 * (testkit.ts says how each plays), on the road the game ships with (its
 * lanes, barricade and survivors' runs, read from road.glb): the night
 * should be fair early, tense later, and end for everyone in the end.
 */
const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
const road = (await shippedRoad()) ?? placeholderRoad();

function falls(skill: Skill): { waves: number[]; median: number } {
  const waves = seeds.map((s) => playUntilDeath(s, skill, { maxTime: 3600, road }).wave).sort((a, b) => a - b);
  return { waves, median: waves[Math.floor(waves.length / 2)] as number };
}

// Each case plays sixteen whole nights: give a busy machine time.
describe("the night on Standard", { timeout: 120_000 }, () => {
  it("lets a steady hand through the first waves and a long way into the night, and still takes it", () => {
    const { waves, median } = falls(STEADY);
    // eslint-disable-next-line no-console
    console.log(`steady hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(6);
    expect(median).toBeGreaterThanOrEqual(10);
    expect(median).toBeLessThanOrEqual(20);
    expect(waves.filter((w) => w <= 25).length).toBe(seeds.length);
  });

  it("is harder on a slow, wild hand, which rarely sees wave 11", () => {
    const { waves, median } = falls(WILD);
    // eslint-disable-next-line no-console
    console.log(`slow, wild hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(2);
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(10);
    expect(waves.filter((w) => w > 11).length).toBeLessThanOrEqual(2);
  });

  it("gives the slowest hand a few waves", () => {
    const { waves, median } = falls(SLOWEST);
    // eslint-disable-next-line no-console
    console.log(`slowest hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(2);
    expect(median).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThanOrEqual(7);
  });
});

describe("an idle player", () => {
  it("is overrun on the first wave, when the first walker reaches the barricade", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const x = standIdle(seed, "standard", 240, road);
      expect(x.dead, `seed ${seed}`).toBe(true);
      expect(x.wave, "never shooting, the first wave never clears").toBe(1);
      expect(x.time).toBeGreaterThan(40);
      expect(x.time).toBeLessThan(120);
    }
  });
});
