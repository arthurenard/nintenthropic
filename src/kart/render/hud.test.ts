import { describe, expect, it } from "vitest";
import { bannerFor, mapIsDue, placeChange, PLACE_POP } from "./hud";

describe("the banners under the item slot", () => {
  it("show one at a time: a skyrocket on its way, then the wrong way, then the final lap", () => {
    expect(bannerFor(false, false, false)).toBeNull();
    expect(bannerFor(false, false, true)).toBe("final");
    expect(bannerFor(false, true, true)).toBe("wrong");
    expect(bannerFor(true, true, true)).toBe("incoming");
    expect(bannerFor(true, false, true)).toBe("incoming");
  });
});

describe("the place", () => {
  it("springs up for a place won and sinks in for a place lost", () => {
    expect(placeChange(3, 2)).toBe("gp-gain");
    expect(placeChange(2, 1)).toBe("gp-gain");
    expect(placeChange(1, 2)).toBe("gp-lose");
    expect(placeChange(4, 7)).toBe("gp-lose");
  });
  it("pops at most a few times a second, so two karts side by side do not make it flicker", () => {
    expect(PLACE_POP).toBeGreaterThanOrEqual(0.25);
    expect(PLACE_POP).toBeLessThanOrEqual(0.6);
  });
});

describe("the minimap's clock", () => {
  it("draws the first time, then every 30 ms, and at once after the clock restarts", () => {
    expect(mapIsDue(0, -Infinity, 0.03)).toBe(true);
    expect(mapIsDue(0.02, 0, 0.03)).toBe(false);
    expect(mapIsDue(0.03, 0, 0.03)).toBe(true);
    expect(mapIsDue(0.5, 3, 0.03)).toBe(true);
  });
});
