import { describe, expect, it } from "vitest";
import { dailyCard, cardById, rulesLine } from "../rules";
import { raceWords } from "./loading";
import { loadRules, saveRules } from "./prefs";

/** A storage in memory, as the browser's but without the browser. */
function memory(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

describe("the host's last rules", () => {
  it("are remembered between rooms, and read as Normal when nothing was kept", () => {
    const storage = memory();
    expect(loadRules(storage)).toBe("normal");
    expect(saveRules("ice", storage)).toBe(true);
    expect(loadRules(storage)).toBe("ice");
    saveRules("daily", storage);
    expect(loadRules(storage)).toBe("daily");
    expect(storage.getItem("handy.kart.rules.v1")).toBe('"daily"');
  });

  it("read as Normal when what is kept is not a choice (a card from a newer build, or damage)", () => {
    expect(loadRules(memory({ "handy.kart.rules.v1": '"mirror-madness"' }))).toBe("normal");
    expect(loadRules(memory({ "handy.kart.rules.v1": "{oops" }))).toBe("normal");
    expect(loadRules(undefined)).toBe("normal");
  });
});

describe("what the lobby says of the rules", () => {
  it("gives the card's line, and for Today's Card names today's card", () => {
    expect(rulesLine("normal")).toMatch(/No twist/);
    expect(rulesLine("tiny")).toBe(cardById("tiny")!.line);
    const day = "2026-11-07";
    const today = cardById(dailyCard(day))!;
    expect(rulesLine("daily", day)).toBe(`Today’s card is ${today.name}: ${today.line}`);
  });
});

describe("what the loading screen says of the card", () => {
  it("names the card and says what it does, when the host dealt one", () => {
    const words = raceWords({ track: "meadow-loop", laps: 3 }, null, "bigheads");
    expect(words.rule).toEqual({ name: "Big Heads", line: cardById("bigheads")!.line });
    expect(words.eyebrow).toBe("Acorn Cup · 3 laps");
  });

  it("says nothing for no card, or one this build does not know", () => {
    expect(raceWords({ track: "meadow-loop", laps: 3 }, null).rule).toBeUndefined();
    expect(raceWords({ track: "meadow-loop", laps: 3 }, null, "nope").rule).toBeUndefined();
  });
});
