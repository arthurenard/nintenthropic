import { describe, expect, it } from "vitest";
import { HintLine, TIP_SECONDS } from "./hints";
import { Streak } from "./streak";

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
});

describe("a game's hint line", () => {
  it("keeps showing a tip learned by doing until the player does it", () => {
    const seen = new Set<string>();
    for (let game = 0; game < 2; game++) {
      const line = new HintLine(seen, ["night.reload"]);
      line.setQuiet(false);
      line.offer("night.reload", "Point off the screen to reload.");
      line.offer("night.headshot", "Aim for the head.");
      for (let t = 0; t < (TIP_SECONDS * 2 + 1) * 60; t++) line.update(1 / 60);
    }
    expect(seen.has("night.reload")).toBe(false);
    expect(seen.has("night.headshot")).toBe(true);
  });
});
