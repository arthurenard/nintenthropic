import { describe, expect, it } from "vitest";
import { lastOneWord, scopeHint, spotterWord, tipText, turnWord } from "./tips";

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
  it("say where the men are and how far, and that they are marked only when Aim Assist has marked them", () => {
    expect(spotterWord("at the guard post", 289.4)).toBe("Your spotter has them at the guard post, 289 m out. Marked.");
    expect(spotterWord("at the guard post", 289.4, false)).toBe("Your spotter has them at the guard post, 289 m out.");
    expect(spotterWord("on the dam", 880, true, false)).toBe("Your spotter has him on the dam, 880 m out. Marked.");
  });

  it("say which way to turn a scope that looks at nothing", () => {
    expect(turnWord("left")).toBe("Your spotter: they’re to your left.");
    expect(turnWord("up")).toBe("Your spotter: look higher.");
  });

  it("say where the last one is, in the words you would point him out with", () => {
    expect(lastOneWord("by the watchtower, right of the guard post")).toBe("Last one: by the watchtower, right of the guard post.");
  });

  it("never call the guard post on the road a checkpoint", () => {
    const words = [spotterWord("at the guard post", 300), lastOneWord("by the guard post, left of the watchtower")];
    for (const line of words) expect(line).not.toMatch(/checkpoint/i);
  });
});
