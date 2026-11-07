import { describe, expect, it } from "vitest";
import { MARK_FAR, markLook } from "./rivalMarks";

describe("the nemesis marker's look", () => {
  it("is not there on top of you or out of sight", () => {
    expect(markLook(0).opacity).toBe(0);
    expect(markLook(3).opacity).toBe(0);
    expect(markLook(MARK_FAR).opacity).toBe(0);
    expect(markLook(500).opacity).toBe(0);
    expect(markLook(Number.NaN).opacity).toBe(0);
  });

  it("is subtle: never fully opaque", () => {
    for (let d = 5; d < MARK_FAR; d += 5) expect(markLook(d).opacity).toBeLessThanOrEqual(0.85);
  });

  it("fades in over the first metres and out towards the far end", () => {
    expect(markLook(4).opacity).toBeLessThan(markLook(10).opacity);
    expect(markLook(40).opacity).toBeCloseTo(0.85, 5);
    expect(markLook(MARK_FAR - 10).opacity).toBeLessThan(markLook(40).opacity);
  });

  it("shrinks with distance but stays readable", () => {
    expect(markLook(8).scale).toBeGreaterThan(markLook(60).scale);
    for (let d = 5; d < MARK_FAR; d += 5) {
      expect(markLook(d).scale).toBeGreaterThanOrEqual(0.55);
      expect(markLook(d).scale).toBeLessThanOrEqual(1);
    }
  });
});
