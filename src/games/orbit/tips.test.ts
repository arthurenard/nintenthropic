import { describe, expect, it } from "vitest";
import { ALL_TIPS, HintLine, tipText, TIP_SECONDS, ventHint } from "./tips";

describe("Orbital Decay's tips", () => {
  it("has the design's five, prefixed with the game's name", () => {
    expect([...ALL_TIPS].sort()).toEqual(["orbit.derelict", "orbit.drone", "orbit.heat", "orbit.ring", "orbit.split"]);
  });

  it("says each in the design's words", () => {
    expect(tipText("orbit.split", "hand")).toBe("Big pieces split. Clear the pieces too.");
    expect(tipText("orbit.ring", "hand")).toBe("A ring means it’s coming at the glass.");
    expect(tipText("orbit.drone", "hand")).toBe("The drone mends the glass. Don’t shoot it.");
    expect(tipText("orbit.derelict", "hand")).toBe("Hit its fuel tank.");
    expect(tipText("orbit.heat", "hand")).toBe("Point off the screen to vent the laser.");
  });

  it("says how to vent in the player's own terms", () => {
    expect(ventHint(undefined)).toBe("Point off the screen to vent the laser.");
    expect(ventHint("mouse")).toBe("Right-click or press V to vent the laser.");
    expect(ventHint("touch")).toBe("Tap with two fingers to vent the laser.");
  });

  it("learns venting by doing it, and every other tip by seeing it", () => {
    const seen = new Set<string>();
    const line = new HintLine(seen);
    line.setQuiet(false);
    line.offer("orbit.heat", tipText("orbit.heat", "hand"));
    line.update(0.01);
    expect(line.text).toBe("Point off the screen to vent the laser.");
    line.update(TIP_SECONDS + 0.1);
    // Shown, but not learned: it comes back next game until they vent by themselves.
    expect(seen.has("orbit.heat")).toBe(false);
    line.learned("orbit.heat");
    expect(seen.has("orbit.heat")).toBe(true);
    line.offer("orbit.ring", tipText("orbit.ring", "hand"));
    line.update(1);
    line.update(0.01);
    expect(line.text).toBe("A ring means it’s coming at the glass.");
    expect(seen.has("orbit.ring")).toBe(true);
  });
});
