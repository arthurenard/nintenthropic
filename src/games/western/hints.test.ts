import { describe, expect, it } from "vitest";
import { innocentWord, reloadHint } from "./hints";

describe("reloadHint", () => {
  it("speaks to the hand, the mouse and the touch screen in their own terms", () => {
    expect(reloadHint("hand")).toBe("Point off the screen to reload.");
    expect(reloadHint(undefined)).toBe("Point off the screen to reload.");
    expect(reloadHint("mouse")).toBe("Right-click or press R to reload.");
    expect(reloadHint("touch")).toBe("Tap with two fingers to reload.");
  });
});

describe("innocentWord", () => {
  it("says who it was, calmly, in a short sentence", () => {
    expect(innocentWord("barber")).toBe("That was the barber.");
    for (const role of ["barber", "woman", "bartender", "undertaker", "preacher"] as const) {
      expect(innocentWord(role)).toMatch(/^That was (the|a) [a-z]+\.$/);
    }
  });
});
