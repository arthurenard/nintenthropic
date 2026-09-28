// What the page keeps between visits: settings, records and tips, read back
// only when they make sense, and a window without storage that plays on.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  PersistentSet,
  bestKey,
  controlClass,
  forgetEverything,
  forgetSavedAims,
  hasSavedAim,
  judge,
  loadPreferences,
  prefs,
  readBest,
  savePreferences,
  writeBest,
  type Preferences,
} from "./prefs";

/** localStorage's shape, over a Map. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
  keys(): string[] {
    return [...this.items.keys()];
  }
}

/** A window whose storage refuses everything (a private window, a sandbox). */
class RefusingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new DOMException("denied", "SecurityError");
  }
  override setItem(): void {
    throw new DOMException("full", "QuotaExceededError");
  }
}

const settingsWith = (value: unknown): MemoryStorage => {
  const storage = new MemoryStorage();
  storage.setItem("handy.settings.v1", JSON.stringify(value));
  return storage;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the player's settings", () => {
  it("are the defaults when nothing is kept", () => {
    expect(loadPreferences(new MemoryStorage())).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it("default to the game as it plays today", () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      volume: 1,
      difficulty: "standard",
      crosshair: { size: "standard", highContrast: false },
      steadiness: "balanced",
      cameraInPlay: true,
      reduceMotion: null,
      reduceFlashing: false,
    });
  });

  it("come back as they were saved", () => {
    const storage = new MemoryStorage();
    const chosen: Preferences = {
      volume: 0.35,
      difficulty: "relaxed",
      crosshair: { size: "large", highContrast: true },
      steadiness: "steady",
      cameraInPlay: false,
      reduceMotion: false,
      reduceFlashing: true,
    };
    expect(savePreferences(chosen, storage)).toBe(true);
    expect(loadPreferences(storage)).toEqual(chosen);
    expect(storage.keys()).toEqual(["handy.settings.v1"]);
  });

  it("keep a Reduce Motion left to the system apart from one turned off", () => {
    const storage = new MemoryStorage();
    savePreferences({ ...DEFAULT_PREFERENCES, reduceMotion: null }, storage);
    expect(loadPreferences(storage).reduceMotion).toBeNull();
    savePreferences({ ...DEFAULT_PREFERENCES, reduceMotion: false }, storage);
    expect(loadPreferences(storage).reduceMotion).toBe(false);
  });

  it("read each bad value as its default, and only that one", () => {
    const loaded = loadPreferences(
      settingsWith({
        volume: "loud",
        difficulty: "nightmare",
        crosshair: { size: "huge", highContrast: true },
        steadiness: "balanced",
        cameraInPlay: "yes",
        reduceMotion: 1,
        reduceFlashing: true,
      }),
    );
    expect(loaded).toEqual({
      ...DEFAULT_PREFERENCES,
      crosshair: { size: "standard", highContrast: true },
      reduceFlashing: true,
    });
  });

  it("hold the volume between silent and full", () => {
    expect(loadPreferences(settingsWith({ volume: 3 })).volume).toBe(1);
    expect(loadPreferences(settingsWith({ volume: -1 })).volume).toBe(0);
    expect(loadPreferences(settingsWith({ volume: null })).volume).toBe(1);
    expect(loadPreferences(settingsWith({ volume: 0 })).volume).toBe(0);
  });

  it("survive anything that is not an object of settings", () => {
    for (const saved of ["not json {", "[1,2]", "null", "42", '"standard"']) {
      const storage = new MemoryStorage();
      storage.setItem("handy.settings.v1", saved);
      expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    }
    expect(loadPreferences(settingsWith({ crosshair: "large" })).crosshair).toEqual(DEFAULT_PREFERENCES.crosshair);
  });

  it("play on without remembering where storage refuses", () => {
    const storage = new RefusingStorage();
    expect(loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
    expect(savePreferences({ ...DEFAULT_PREFERENCES, volume: 0.5 }, storage)).toBe(false);
  });

  it("play on where there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(savePreferences(DEFAULT_PREFERENCES)).toBe(false);
    expect(prefs.muted).toBe(false);
    expect(() => (prefs.muted = true)).not.toThrow();
  });

  it("are read from the page's own storage by default", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    savePreferences({ ...DEFAULT_PREFERENCES, difficulty: "relaxed" });
    expect(loadPreferences().difficulty).toBe("relaxed");
    expect(storage.getItem("handy.settings.v1")).toContain('"relaxed"');
  });
});

describe("the tips already shown", () => {
  it("are kept the moment one is added", () => {
    const storage = new MemoryStorage();
    const seen = new PersistentSet("handy.tips-seen.v1", () => storage);
    seen.add("glint");
    expect(JSON.parse(storage.getItem("handy.tips-seen.v1")!)).toEqual(["glint"]);
    seen.add("townsfolk").add("glint");
    expect(JSON.parse(storage.getItem("handy.tips-seen.v1")!)).toEqual(["glint", "townsfolk"]);
    // A new visit remembers them.
    const again = new PersistentSet("handy.tips-seen.v1", () => storage);
    expect([...again]).toEqual(["glint", "townsfolk"]);
    expect(again.has("glint")).toBe(true);
  });

  it("forget one or all, and keep that too", () => {
    const storage = new MemoryStorage();
    const seen = new PersistentSet("tips", () => storage);
    seen.add("a").add("b");
    expect(seen.delete("a")).toBe(true);
    expect(seen.delete("a")).toBe(false);
    expect(JSON.parse(storage.getItem("tips")!)).toEqual(["b"]);
    seen.clear();
    expect(JSON.parse(storage.getItem("tips")!)).toEqual([]);
  });

  it("do not write when nothing changed", () => {
    const storage = new MemoryStorage();
    const write = vi.spyOn(storage, "setItem");
    const seen = new PersistentSet("tips", () => storage);
    expect(write).not.toHaveBeenCalled();
    seen.add("a");
    seen.add("a");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("are a plain Set to the game", () => {
    const seen: Set<string> = new PersistentSet("tips", () => new MemoryStorage());
    seen.add("first-wave");
    expect(seen.size).toBe(1);
    expect(seen instanceof Set).toBe(true);
  });

  it("ignore anything unreadable, and keep only strings", () => {
    const storage = new MemoryStorage();
    storage.setItem("tips", "{oops");
    expect(new PersistentSet("tips", () => storage).size).toBe(0);
    storage.setItem("tips", JSON.stringify(["glint", 4, null, "bell"]));
    expect([...new PersistentSet("tips", () => storage)]).toEqual(["glint", "bell"]);
  });

  it("work in memory where storage refuses", () => {
    const seen = new PersistentSet("tips", () => new RefusingStorage());
    expect(() => seen.add("glint")).not.toThrow();
    expect(seen.has("glint")).toBe(true);
    const none = new PersistentSet("tips", () => undefined);
    none.add("glint");
    expect(none.has("glint")).toBe(true);
  });
});

describe("personal records", () => {
  it("are kept apart by game, difficulty and control", () => {
    expect(bestKey("high-noon", "relaxed", "pointer")).toBe("handy.best.v2.high-noon.relaxed.pointer");
    expect(bestKey("high-noon", "standard", "hand")).toBe("handy.best.v2.high-noon.standard.hand");
    const storage = new MemoryStorage();
    writeBest("high-noon", "standard", "hand", { score: 12340, outcome: "Fell on Wave 6", at: 1 }, storage);
    expect(readBest("high-noon", "standard", "hand", storage)).toEqual({ score: 12340, outcome: "Fell on Wave 6", at: 1 });
    expect(readBest("high-noon", "relaxed", "hand", storage)).toBeNull();
    expect(readBest("high-noon", "standard", "pointer", storage)).toBeNull();
  });

  it("count a mouse and a touch screen as a pointer, apart from the hand", () => {
    expect(controlClass("hand")).toBe("hand");
    expect(controlClass("mouse")).toBe("pointer");
    expect(controlClass("touch")).toBe("pointer");
  });

  it("ignore the first version's numbers", () => {
    const storage = new MemoryStorage();
    storage.setItem("handy.best.v1.high-noon", "99999");
    expect(readBest("high-noon", "standard", "hand", storage)).toBeNull();
  });

  it("read only a sensible score, and fill in what is missing", () => {
    const storage = new MemoryStorage();
    const key = bestKey("g", "standard", "hand");
    for (const bad of ['{"score":-5}', '{"score":"lots"}', '{"score":null}', "7", "[]", "nope"]) {
      storage.setItem(key, bad);
      expect(readBest("g", "standard", "hand", storage)).toBeNull();
    }
    storage.setItem(key, '{"score":800}');
    expect(readBest("g", "standard", "hand", storage)).toEqual({ score: 800, outcome: "", at: 0 });
  });

  it("are beaten only by a higher score that scores at all", () => {
    const earlier = { score: 10230, outcome: "Fell on Wave 5", at: 1 };
    expect(judge(500, null)).toEqual({ best: true, previous: null });
    expect(judge(0, null).best).toBe(false);
    expect(judge(10230, earlier).best).toBe(false);
    expect(judge(10000, earlier)).toEqual({ best: false, previous: earlier });
    expect(judge(12340, earlier)).toEqual({ best: true, previous: earlier });
  });

  it("play on without remembering where storage refuses", () => {
    const storage = new RefusingStorage();
    expect(writeBest("g", "standard", "hand", { score: 1, outcome: "", at: 0 }, storage)).toBe(false);
    expect(readBest("g", "standard", "hand", storage)).toBeNull();
  });
});

describe("forgetting", () => {
  const kept = () => {
    const storage = new MemoryStorage();
    storage.setItem("handy.aim.v1.cam-a.1280x720", "{}");
    storage.setItem("handy.aim.v1.cam-b.640x480", "{}");
    storage.setItem("handy.best.v2.high-noon.standard.hand", '{"score":1}');
    storage.setItem("handy.settings.v1", "{}");
    storage.setItem("someone-else", "theirs");
    return storage;
  };

  it("the saved aim takes every camera's and nothing else", () => {
    const storage = kept();
    expect(hasSavedAim(storage)).toBe(true);
    expect(forgetSavedAims(storage)).toBe(2);
    expect(hasSavedAim(storage)).toBe(false);
    expect(storage.keys()).toEqual(["handy.best.v2.high-noon.standard.hand", "handy.settings.v1", "someone-else"]);
    expect(forgetSavedAims(storage)).toBe(0);
  });

  it("everything takes all Handy keeps, in both storages, and nothing of anyone else's", () => {
    const local = kept();
    const session = new MemoryStorage();
    session.setItem("handy.unlocks.v1", '["golden"]');
    session.setItem("other", "x");
    forgetEverything([local, session]);
    expect(local.keys()).toEqual(["someone-else"]);
    expect(session.keys()).toEqual(["other"]);
  });

  it("does nothing, quietly, without storage", () => {
    expect(() => forgetEverything([undefined, new RefusingStorage()])).not.toThrow();
    expect(hasSavedAim(undefined)).toBe(false);
    expect(forgetSavedAims(undefined)).toBe(0);
  });
});
