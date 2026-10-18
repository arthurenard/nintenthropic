import { describe, expect, it } from "vitest";
import { Effects } from "./effects";

describe("the particles", () => {
  it("all go when a new race begins, so the last one's smoke and confetti do not hang over the grid", () => {
    const fx = new Effects(400);
    fx.confetti(0, 0, 0);
    fx.puff(0, 0, 0, 12);
    fx.update(1 / 60);
    expect(fx.live).toBeGreaterThan(90);
    fx.clear();
    expect(fx.live).toBe(0);
    fx.dispose();
  });
});
