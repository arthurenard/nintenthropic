import { describe, expect, it } from "vitest";
import { Streak, streakRate } from "./streak";

describe("the streak multiplier", () => {
  it("steps up every `step` hits in a row to its ceiling, and a miss sends it back", () => {
    const streak = new Streak(2, 3);
    const ups: number[] = [];
    for (let i = 0; i < 8; i++) if (streak.hit()) ups.push(streak.multiplier);
    expect(ups).toEqual([2, 3]);
    expect(streak.multiplier).toBe(3);
    streak.break();
    expect(streak.multiplier).toBe(1);
    expect(streak.best).toBe(8);
  });

  it("climbs its chime up a major triad: the root at ×2, the third at ×3, the fifth from ×4", () => {
    expect([2, 3, 4, 5].map((m) => Math.round(streakRate(m) * 1000) / 1000)).toEqual([1, 1.26, 1.498, 1.498]);
  });
});
