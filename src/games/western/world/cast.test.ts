import { describe, expect, it } from "vitest";
import { risingDip } from "./cast";

const man = (state: string, exposure: number, emerge = "rise") => ({ state, exposure, cover: { emerge } });

describe("a rise's first frame", () => {
  it("starts below the cover's edge, so no hat shows before the man does", () => {
    expect(risingDip(man("emerging", 0))).toBeGreaterThanOrEqual(0.25);
  });

  it("comes up to his crouch's height, never above it, and stays there", () => {
    let last = Infinity;
    for (let e = 0; e <= 1.0001; e += 0.05) {
      const d = risingDip(man("emerging", e));
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      expect(d).toBeGreaterThanOrEqual(0);
      last = d;
    }
    expect(risingDip(man("emerging", 0.4))).toBe(0);
    expect(risingDip(man("aiming", 1))).toBe(0);
  });

  it("goes down past the crouch at the end of the sink", () => {
    expect(risingDip(man("hiding", 0))).toBeGreaterThan(0.25);
    expect(risingDip(man("hiding", 1))).toBe(0);
  });

  it("leaves leaning, stepping and running men alone", () => {
    for (const emerge of ["lean_left", "lean_right", "step_out"]) expect(risingDip(man("emerging", 0, emerge))).toBe(0);
    expect(risingDip(man("running", 0))).toBe(0);
  });
});
