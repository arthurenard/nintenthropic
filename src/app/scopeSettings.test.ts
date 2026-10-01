import { describe, expect, it } from "vitest";
import { EYE_SCOPE, EyeScope, type EyeView } from "../input/scope";
import { DEFAULT_SCOPE, loadEyeProfile, loadScopePreferences, saveEyeProfile, saveScopePreferences } from "./prefs";
import { eyeTestWords, scopeFoot } from "./settings";

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("the scope's settings", () => {
  it("default to the eye on and the buttons held, and come back as saved", () => {
    const storage = new MemoryStorage();
    expect(loadScopePreferences(storage)).toEqual({ eye: true, button: "hold" });
    expect(saveScopePreferences({ eye: false, button: "toggle" }, storage)).toBe(true);
    expect(loadScopePreferences(storage)).toEqual({ eye: false, button: "toggle" });
    expect(storage.key(0)).toBe("handy.scope.v1");
  });

  it("read a bad value as its default, and only that one", () => {
    const storage = new MemoryStorage();
    storage.setItem("handy.scope.v1", JSON.stringify({ eye: "yes", button: "toggle" }));
    expect(loadScopePreferences(storage)).toEqual({ ...DEFAULT_SCOPE, button: "toggle" });
    storage.setItem("handy.scope.v1", "[1, 2]");
    expect(loadScopePreferences(storage)).toEqual(DEFAULT_SCOPE);
  });

  it("say how to scope in the player's terms", () => {
    expect(scopeFoot({ eye: true, button: "hold" }, false, true)).toBe(
      "Close one eye for a moment, or hold Shift or the right mouse button, to look through the scope.",
    );
    expect(scopeFoot({ eye: false, button: "hold" }, false, true)).toBe("Hold Shift or the right mouse button to look through the scope.");
    expect(scopeFoot({ eye: true, button: "toggle" }, true, true)).toBe(
      "Close one eye for a moment to look through the scope, or press the Scope button: once to look, again to stop.",
    );
    // No game that reads the eye: the eye goes unsaid.
    expect(scopeFoot({ eye: true, button: "toggle" }, false, false)).toBe(
      "Press Shift or the right mouse button once to look through the scope, and again to stop.",
    );
  });
});

describe("what the scope learns of a player's eyes", () => {
  it("is kept apart from the other choices, comes back as saved, and reads nothing it cannot trust", () => {
    const storage = new MemoryStorage();
    expect(loadEyeProfile(storage)).toBeNull();
    expect(saveEyeProfile({ open: 0.12, closed: 0.7 }, storage)).toBe(true);
    expect(loadEyeProfile(storage)).toEqual({ open: 0.12, closed: 0.7 });
    expect(storage.key(0)).toBe("handy.eye.v1");
    // Out of range, it is brought back to what the scope can use; not numbers, it is not a profile.
    storage.setItem("handy.eye.v1", JSON.stringify({ open: 0.9, closed: 0.1 }));
    expect(loadEyeProfile(storage)).toEqual({ open: 0.45, closed: 0.3 });
    storage.setItem("handy.eye.v1", JSON.stringify({ open: "wide", closed: 0.7 }));
    expect(loadEyeProfile(storage)).toBeNull();
    storage.setItem("handy.eye.v1", "[0.1, 0.7]");
    expect(loadEyeProfile(storage)).toBeNull();
  });
});

describe("the Eye Test's words", () => {
  const view = (fields: Partial<EyeView>): EyeView => ({ seen: true, left: 0.05, right: 0.06, closing: 0, threshold: 0.36, scoped: false, held: false, ...fields });

  it("say whether the face is seen, and what to do next", () => {
    expect(eyeTestWords(view({ seen: false }), false)).toBe("Looking for your face. Face the camera, with your hand down.");
    expect(eyeTestWords(view({}), false)).toBe("Your face is seen. Close one eye past the mark and hold it.");
    expect(eyeTestWords(view({ closing: 0.7 }), false)).toBe("Almost. Close it a little more.");
  });

  it("say when an eye is shut, and when the scope has learned it", () => {
    expect(eyeTestWords(view({ scoped: true, closing: 1, left: 0.8 }), false)).toBe("One eye closed. That opens the scope.");
    expect(eyeTestWords(view({ scoped: true, closing: 1, right: 0.8 }), false)).toBe("One eye closed. That opens the scope.");
    expect(eyeTestWords(view({}), true)).toBe("Got it. The scope now fits how your eye closes.");
  });

  it("follow a real eye through a test: seen, shut, learned", () => {
    const eye = new EyeScope({ ...EYE_SCOPE, learn: 1 });
    let t = 0;
    const read = (left: number, right: number, ms: number) => {
      for (const end = t + ms; t < end; t += 1000 / 15) eye.read({ blinkLeft: left, blinkRight: right }, t);
    };
    read(0.05, 0.06, 600);
    expect(eyeTestWords(eye.view(t), false)).toBe("Your face is seen. Close one eye past the mark and hold it.");
    read(0.9, 0.2, 1500);
    expect(eyeTestWords(eye.view(t), false)).toBe("One eye closed. That opens the scope.");
    let learned = false;
    eye.onLearn = () => (learned = true);
    read(0.05, 0.06, 400);
    expect(learned).toBe(true);
  });
});