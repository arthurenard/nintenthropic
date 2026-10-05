import { describe, expect, it } from "vitest";
import { DEFAULT_NAMES } from "./format";
import { DEFAULT_LEVELS, loadLevels, loadYou, saveLevels, saveYou, setWheelChecked, wheelChecked } from "./prefs";

/** A storage in memory, as the browser's but without the browser. */
function memory(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("the player Grip Prix remembers", () => {
  it("is a friendly first-time driver with the wheel, and keeps the name it gave", () => {
    const storage = memory();
    const first = loadYou(0.5, storage);
    expect(DEFAULT_NAMES).toContain(first.name);
    expect(first.drive).toBe("wheel");
    expect(first.steering).toBe("normal");
    expect(first.second).toBe(false);
    // The second driver's default is never the first's.
    expect(first.secondName).not.toBe(first.name);
    // Another visit sees the same name, whatever the dice say.
    expect(loadYou(0.99, storage).name).toBe(first.name);
  });

  it("remembers what was chosen", () => {
    const storage = memory();
    saveYou({ name: "Maya", drive: "keyboard", steering: "quick", second: true, secondName: "Lou" }, storage);
    expect(loadYou(0, storage)).toEqual({ name: "Maya", drive: "keyboard", steering: "quick", second: true, secondName: "Lou" });
  });

  it("reads anything odd as the default", () => {
    const storage = memory({ "handy.kart.you.v1": JSON.stringify({ name: 7, drive: "jetpack", steering: "wild", second: "yes" }) });
    const you = loadYou(0, storage);
    expect(you.name).toBe(DEFAULT_NAMES[0]);
    expect(you.drive).toBe("wheel");
    expect(you.steering).toBe("normal");
    expect(you.second).toBe(false);
    expect(loadYou(0, memory({ "handy.kart.you.v1": "not json{" })).drive).toBe("wheel");
  });

  it("plays without a storage", () => {
    expect(loadYou(0, undefined).drive).toBe("wheel");
    expect(saveYou(loadYou(0, undefined), undefined)).toBe(false);
  });

  it("remembers the wheel check was done", () => {
    const storage = memory();
    expect(wheelChecked(storage)).toBe(false);
    setWheelChecked(storage);
    expect(wheelChecked(storage)).toBe(true);
  });
});

describe("the Music and Effects sliders", () => {
  it("start where the tune sits a little under the engines, and are remembered", () => {
    const storage = memory();
    expect(loadLevels(storage)).toEqual(DEFAULT_LEVELS);
    saveLevels({ music: 0.25, effects: 0.6 }, storage);
    expect(loadLevels(storage)).toEqual({ music: 0.25, effects: 0.6 });
  });

  it("read anything odd as the default, each slider on its own", () => {
    const storage = memory({ "handy.kart.sound.v1": JSON.stringify({ music: "loud", effects: 7 }) });
    expect(loadLevels(storage)).toEqual({ music: DEFAULT_LEVELS.music, effects: 1 });
    expect(loadLevels(memory({ "handy.kart.sound.v1": "{" }))).toEqual(DEFAULT_LEVELS);
    expect(loadLevels(undefined)).toEqual(DEFAULT_LEVELS);
  });
});
