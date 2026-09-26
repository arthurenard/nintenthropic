import { describe, expect, it } from "vitest";
import { reloadHint } from "./hints";

describe("reloadHint", () => {
  it("speaks to the hand, the mouse and the touch screen in their own terms", () => {
    expect(reloadHint("hand")).toBe("Point off the screen to reload.");
    expect(reloadHint(undefined)).toBe("Point off the screen to reload.");
    expect(reloadHint("mouse")).toBe("Right-click or press R to reload.");
    expect(reloadHint("touch")).toBe("Tap with two fingers to reload.");
  });
});
