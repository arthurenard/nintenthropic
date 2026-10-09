import { describe, expect, it } from "vitest";
import { nearestTurn, springIn } from "./stage";

const TAU = Math.PI * 2;

describe("the driver stage's turns", () => {
  it("brings a kart that has turned round back to the rest view by the short way", () => {
    expect(nearestTurn(0.1, 0.5)).toBeCloseTo(0.5);
    // Turned almost a whole circle one way: the rest view is just ahead, not a lap back.
    expect(nearestTurn(TAU - 0.2, 0.5)).toBeCloseTo(TAU + 0.5);
    // ... or the other way.
    expect(nearestTurn(-TAU + 0.1, 0.5)).toBeCloseTo(-TAU + 0.5);
    // Half way round it may go either way, but never more than half a turn.
    expect(Math.abs(nearestTurn(Math.PI + 0.5, 0.5) - (Math.PI + 0.5))).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it("springs a new rider in from nothing to full size, overshooting a little on the way", () => {
    expect(springIn(0)).toBe(0);
    expect(springIn(-1)).toBe(0);
    expect(springIn(10)).toBe(1);
    const peak = Math.max(...Array.from({ length: 90 }, (_, i) => springIn(i / 100)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
  });
});
