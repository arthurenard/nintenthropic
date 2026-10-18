import { describe, expect, it } from "vitest";
import { chickenWord, innocentWord, reloadHint } from "./hints";

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

  it("counts the second, and from the third the town has noticed", () => {
    expect(innocentWord("barber", 1)).toBe("That was the barber.");
    expect(innocentWord("woman", 2)).toBe("That was a townswoman. That makes two.");
    expect(innocentWord("preacher", 3)).toBe("The town has noticed.");
    expect(innocentWord("bartender", 7)).toBe("The town has noticed.");
  });
});

describe("chickenWord", () => {
  it("reassures you twice; the third shot is the secret's to announce", () => {
    expect(chickenWord(1)).toBe("The chicken is fine.");
    expect(chickenWord(2)).toBe("The chicken is still fine.");
    expect(chickenWord(3)).toBeNull();
    expect(chickenWord(4)).toBeNull();
  });
});
