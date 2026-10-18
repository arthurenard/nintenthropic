import { describe, expect, it } from "vitest";
import { innocentWord, lastOneWord, scopeHint, spotterWord, tipText, turnWord } from "./tips";

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

describe("the word after an innocent is hit", () => {
  it("says who it was, calmly", () => {
    expect(innocentWord("farmer")).toBe("That was the farmer.");
    expect(innocentWord("cow")).toBe("That was a cow.");
  });

  it("keeps the herd's count, and the herd keeps it too", () => {
    expect(["cow", "cow", "cow", "cow"].map((r, i) => innocentWord(r, i + 1))).toEqual(["That was a cow.", "That was another cow.", "The herd has noticed.", "The herd has noticed."]);
    expect(innocentWord("sheep", 2)).toBe("That was another sheep.");
    expect(innocentWord("sheep", 3)).toBe("The flock has noticed.");
  });

  it("never makes a joke of a person", () => {
    for (const role of ["farmer", "cyclist", "shepherd", "child"]) expect(innocentWord(role, 3)).toBe(innocentWord(role));
  });
});

describe("the drop's lesson", () => {
  it("speaks the reticle's language: its marks are labelled in hundreds of metres", () => {
    const words = tipText("ridge.drop", "hand", { eye: true, button: "hold" });
    expect(words).toBe("It drops with distance. Put the mark for his range on him: 4 is 400 m.");
  });
});
