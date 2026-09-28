import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE, loadScopePreferences, saveScopePreferences } from "./prefs";
import { scopeFoot } from "./settings";

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
