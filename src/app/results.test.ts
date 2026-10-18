// How a finished round is weighed against its record, and the share card's
// line breaking.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameEntry, GameStats } from "../engine/types";
import { readBest } from "./prefs";
import { difficultyLabel, outcomeTone, recordRound, secretsLine, wrapLines } from "./results";

const GAME: GameEntry = { id: "high-noon", title: "High Noon", blurb: "", poster: "", create: () => Promise.reject(new Error("not here")) };

const round = (score: number, outcome = "Fell on Wave 6"): GameStats => ({
  outcome,
  won: false,
  score,
  stats: [],
  secretsFound: 0,
  secretsTotal: 8,
});

describe("a finished round", () => {
  let kept: Map<string, string>;

  beforeEach(() => {
    kept = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is the first best when it scores at all, and is kept at once", () => {
    const verdict = recordRound(GAME, round(10230, "Fell on Wave 5"), { difficulty: "standard", control: "hand" }, 1000);
    expect(verdict).toEqual({ best: true, previous: null });
    expect(readBest("high-noon", "standard", "hand")).toEqual({ score: 10230, outcome: "Fell on Wave 5", at: 1000 });
    expect(recordRound(GAME, round(0), { difficulty: "relaxed", control: "hand" }).best).toBe(false);
    expect(readBest("high-noon", "relaxed", "hand")).toBeNull();
  });

  it("beats the record only by scoring more, and says what it beat", () => {
    recordRound(GAME, round(10230, "Fell on Wave 5"), { difficulty: "standard", control: "hand" }, 1000);
    const lower = recordRound(GAME, round(9000), { difficulty: "standard", control: "hand" }, 2000);
    expect(lower.best).toBe(false);
    expect(lower.previous?.score).toBe(10230);
    const higher = recordRound(GAME, round(12340), { difficulty: "standard", control: "hand" }, 3000);
    expect(higher).toEqual({ best: true, previous: { score: 10230, outcome: "Fell on Wave 5", at: 1000 } });
    expect(readBest("high-noon", "standard", "hand")).toEqual({ score: 12340, outcome: "Fell on Wave 6", at: 3000 });
  });

  it("never mixes a mouse's record with the hand's, or Relaxed with Standard", () => {
    recordRound(GAME, round(50000), { difficulty: "standard", control: "pointer" });
    recordRound(GAME, round(20000), { difficulty: "relaxed", control: "hand" });
    expect(recordRound(GAME, round(900), { difficulty: "standard", control: "hand" })).toEqual({ best: true, previous: null });
    expect([...kept.keys()].sort()).toEqual([
      "handy.best.v2.high-noon.relaxed.hand",
      "handy.best.v2.high-noon.standard.hand",
      "handy.best.v2.high-noon.standard.pointer",
    ]);
  });
});

describe("the difficulty's name", () => {
  it("is said for Relaxed, and goes without saying for Standard", () => {
    expect(difficultyLabel("relaxed")).toBe("Relaxed");
    expect(difficultyLabel("standard")).toBeNull();
  });
});

describe("the outcome's tone", () => {
  it("is green for a win and red for a loss", () => {
    expect(outcomeTone(true, false)).toBe("won");
    expect(outcomeTone(false, false)).toBe("lost");
  });

  it("never tells off a new best in red: a lost round that beat the record is said plainly", () => {
    expect(outcomeTone(false, true)).toBe("plain");
    expect(outcomeTone(true, true)).toBe("won");
  });
});

describe("the secrets line", () => {
  it("counts the secrets found", () => {
    expect(secretsLine(3, 8)).toBe("Secrets 3 of 8");
  });

  it("with none found yet, says where they hide", () => {
    expect(secretsLine(0, 8)).toBe("Secrets 0 of 8. The scenery can take a shot.");
  });

  it("with every one found, says so", () => {
    expect(secretsLine(8, 8)).toBe("Secrets 8 of 8. Nothing left unshot.");
  });
});

describe("the share card's lines", () => {
  // Every character is 10 wide.
  const measure = (text: string) => text.length * 10;

  it("keeps a short line whole", () => {
    expect(wrapLines("A rifleman on the roof.", 400, measure)).toEqual(["A rifleman on the roof."]);
  });

  it("breaks between words, never inside one", () => {
    expect(wrapLines("A rifleman on the bank roof. Riflemen glint for longer.", 300, measure)).toEqual([
      "A rifleman on the bank roof.",
      "Riflemen glint for longer.",
    ]);
  });

  it("ends a note too long for two lines with an ellipsis that fits", () => {
    const lines = wrapLines("A rifleman on the bank roof. Riflemen glint for longer - watch the rooftops.", 300, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(300);
  });

  it("puts a word too long for any line on its own line", () => {
    expect(wrapLines("Supercalifragilistic", 50, measure, 2)).toEqual(["Supercalifragilistic"]);
  });

  it("has nothing to say for nothing", () => {
    expect(wrapLines("   ", 300, measure)).toEqual([]);
  });
});
