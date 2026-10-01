import { describe, expect, it } from "vitest";
import { placeName, scopeHint, spotterWord, tipText, turnWord } from "./tips";

describe("how Overwatch Ridge says to look through the scope", () => {
  it("tells a hand player the eye and the way that always works", () => {
    expect(scopeHint("hand", { eye: true, button: "hold" })).toBe("Close one eye to look through the scope. Or hold Shift.");
    expect(scopeHint("hand", { eye: true, button: "toggle" })).toBe("Close one eye to look through the scope. Or press Shift.");
  });

  it("names the Scope button for a hand player with a touch screen", () => {
    expect(scopeHint("hand", { eye: true, button: "hold", touch: true })).toBe("Close one eye to look through the scope. Or hold Scope.");
    expect(scopeHint("hand", { eye: false, button: "toggle", touch: true })).toBe("Press Scope to look through the scope.");
  });

  it("says Shift alone when the eye is off or cannot be read, and the buttons a pointer has", () => {
    expect(scopeHint("hand", { eye: false, button: "hold" })).toBe("Hold Shift to look through the scope.");
    expect(scopeHint("mouse", { eye: false, button: "hold" })).toBe("Hold Shift or the right button to look through the scope.");
    expect(scopeHint("touch", { eye: false, button: "toggle" })).toBe("Tap Scope to look through the scope.");
    expect(tipText("ridge.scope", "hand", { eye: true, button: "hold" })).toBe(scopeHint("hand", { eye: true, button: "hold" }));
  });
});

describe("the spotter's words", () => {
  it("name a place without its preposition", () => {
    expect(placeName("at the checkpoint")).toBe("Checkpoint");
    expect(placeName("on the river road")).toBe("River road");
    expect(placeName("on the watchtower")).toBe("Watchtower");
    expect(placeName("")).toBe("Target");
  });

  it("say where the men are and which way to turn", () => {
    expect(spotterWord("at the checkpoint", 289.4)).toBe("Your spotter has them at the checkpoint, 289 m out. Marked.");
    expect(turnWord("left")).toBe("Your spotter: they’re to your left.");
    expect(turnWord("up")).toBe("Your spotter: look higher.");
  });
});
