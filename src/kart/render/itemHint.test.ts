import { afterEach, describe, expect, it } from "vitest";
import { HINT_EVERY, HINT_ON, ItemHint, forgetTaught, hintVisible, hintWords, isTaught, markTaught } from "./itemHint";

afterEach(() => forgetTaught());

describe("hintWords", () => {
  it("speaks in what the player drives with", () => {
    expect(hintWords("wheel")).toBe("Flick one hand open to use it.");
    expect(hintWords("keyboard")).toBe("Press E to use it.");
    expect(hintWords("gamepad")).toBe("Press B to use it.");
  });
});

describe("hintVisible", () => {
  it("shows at once, fades after a few seconds, and comes back after eight of holding", () => {
    expect(hintVisible(0, false)).toBe(true);
    expect(hintVisible(HINT_ON - 0.1, false)).toBe(true);
    expect(hintVisible(HINT_ON + 0.1, false)).toBe(false);
    expect(hintVisible(HINT_EVERY - 0.1, false)).toBe(false);
    expect(hintVisible(HINT_EVERY + 0.1, false)).toBe(true);
    expect(hintVisible(HINT_EVERY * 2 + 0.1, false)).toBe(true);
  });

  it("never shows to someone who has used an item", () => {
    expect(hintVisible(0, true)).toBe(false);
    expect(hintVisible(HINT_EVERY + 0.1, true)).toBe(false);
  });
});

describe("ItemHint", () => {
  const run = (hint: ItemHint, who: number, holding: boolean, seconds: number): boolean => {
    let on = false;
    for (let t = 0; t < seconds - 1e-9; t += 0.1) on = hint.step(who, holding, 0.1);
    return on;
  };

  it("shows the first time an item is held, and not while there is none", () => {
    const hint = new ItemHint();
    expect(run(hint, 0, false, 3)).toBe(false);
    expect(hint.step(0, true, 0.1)).toBe(true);
  });

  it("fades, then returns after eight seconds of holding it unused", () => {
    const hint = new ItemHint();
    expect(run(hint, 0, true, 2)).toBe(true);
    expect(run(hint, 0, true, 3.5)).toBe(false); // 5.5 s in
    expect(run(hint, 0, true, 3)).toBe(true); // 8.5 s in
  });

  it("goes the moment the item is used, and never returns for that player", () => {
    const hint = new ItemHint();
    expect(run(hint, 2, true, 1)).toBe(true);
    markTaught(2);
    expect(hint.step(2, true, 0.1)).toBe(false);
    expect(hint.step(2, false, 0.1)).toBe(false);
    // The next item, held for ages: still quiet.
    expect(run(hint, 2, true, 20)).toBe(false);
    expect(isTaught(2)).toBe(true);
  });

  it("starts the count again with each new item", () => {
    const hint = new ItemHint();
    run(hint, 1, true, 6); // past the first showing
    expect(hint.step(1, false, 0.1)).toBe(false); // used or lost
    expect(hint.step(1, true, 0.1)).toBe(true); // the next one is new
  });

  it("teaches each player separately", () => {
    markTaught(0);
    const a = new ItemHint();
    const b = new ItemHint();
    expect(a.step(0, true, 0.1)).toBe(false);
    expect(b.step(1, true, 0.1)).toBe(true);
  });
});
