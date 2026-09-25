import { describe, expect, it } from "vitest";
import { aimTimeFor, damageFor, isBossWave, waveSpec } from "./waves";

describe("the wave table", () => {
  it("matches HIGH_NOON.md for the first five waves", () => {
    expect(waveSpec(1).bandits).toBe(4);
    expect(waveSpec(2).bandits).toBe(6);
    expect(waveSpec(3).bandits).toBe(8);
    expect(waveSpec(4).bandits).toBe(10);
    expect(waveSpec(5).bandits).toBe(8);
    expect(waveSpec(5).boss).toBe(true);
    for (const w of [1, 2, 3, 4, 6]) expect(waveSpec(w).boss).toBe(false);
  });

  it("adds two bandits a wave from wave 6", () => {
    expect(waveSpec(6).bandits).toBe(12);
    expect(waveSpec(7).bandits).toBe(14);
    expect(waveSpec(8).bandits).toBe(16);
  });

  it("brings Black Jack back every fifth wave", () => {
    expect([5, 10, 15].every(isBossWave)).toBe(true);
    expect([1, 4, 6, 9, 11].some(isBossWave)).toBe(false);
    expect(waveSpec(10).boss).toBe(true);
  });

  it("introduces each kind of bandit on its wave", () => {
    expect(waveSpec(2).runners).toBe(0);
    expect(waveSpec(3).runners).toBeGreaterThan(0);
    expect(waveSpec(3).dynamiters).toBe(0);
    expect(waveSpec(4).dynamiters).toBeGreaterThan(0);
    expect(waveSpec(5).riflemen).toBe(0);
    expect(waveSpec(5).armoured).toBe(0);
    expect(waveSpec(6).riflemen).toBeGreaterThan(0);
    expect(waveSpec(6).armoured).toBeGreaterThan(0);
  });

  it("aims in 1.4 s on wave 1, falling to 0.7 s and no lower", () => {
    expect(aimTimeFor(1)).toBeCloseTo(1.4);
    expect(aimTimeFor(10)).toBeCloseTo(0.7);
    expect(aimTimeFor(20)).toBeCloseTo(0.7);
    for (let w = 1; w < 12; w++) expect(aimTimeFor(w + 1)).toBeLessThanOrEqual(aimTimeFor(w));
  });

  it("hits for 34 early and harder later", () => {
    expect(damageFor(1)).toBe(34);
    expect(damageFor(5)).toBe(34);
    expect(damageFor(6)).toBeGreaterThan(34);
    expect(damageFor(12)).toBeGreaterThan(damageFor(6));
  });

  it("keeps role counts inside the wave's head count", () => {
    for (let w = 1; w <= 20; w++) {
      const s = waveSpec(w);
      expect(s.runners + s.dynamiters + s.riflemen).toBeLessThanOrEqual(s.bandits);
      expect(s.armoured).toBeLessThanOrEqual(s.bandits - s.runners - s.dynamiters);
      expect(s.maxAiming).toBeLessThanOrEqual(s.maxActive);
      expect(s.hitChance).toBeLessThanOrEqual(0.75);
    }
  });

  it("uses fewer covers on wave 1 so the town can be learned", () => {
    expect(waveSpec(1).coverTier).toBe(1);
    expect(waveSpec(2).coverTier).toBe(2);
    expect(waveSpec(1).maxAiming).toBe(1);
  });
});
