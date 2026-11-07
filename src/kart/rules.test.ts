import { describe, expect, it } from "vitest";
import {
  CARDS,
  CHOICES,
  DAILY,
  NO_RULE,
  NORMAL,
  SHUFFLE,
  cardById,
  cleanChoice,
  dailyCard,
  dealCard,
  effectsOf,
  hashText,
  todayKey,
} from "./rules";

describe("the cards", () => {
  it("are nine, each with a name, a one-line explanation and a change from the usual", () => {
    expect(CARDS.map((c) => c.id)).toEqual(["tiny", "bigheads", "heavy", "feather", "ice", "frenzy", "pucks", "turbo", "reverse"]);
    for (const card of CARDS) {
      expect(card.name).toMatch(/^[A-Z]/);
      expect(card.line.length).toBeGreaterThan(10);
      expect(card.line.length).toBeLessThan(90);
      expect(card.effects).not.toEqual(NO_RULE);
    }
    expect(new Set(CARDS.map((c) => c.name)).size).toBe(CARDS.length);
  });

  it("say what they do in numbers the sim and the picture read", () => {
    expect(effectsOf("tiny")).toMatchObject({ size: 0.6, turn: 1.12 });
    expect(effectsOf("bigheads").headScale).toBe(1.8);
    expect(effectsOf("heavy").weight).toBe("heavy");
    expect(effectsOf("feather").weight).toBe("light");
    expect(effectsOf("ice").slippery).toBe(true);
    expect(effectsOf("frenzy").boxRespawn).toBeLessThan(1);
    expect(effectsOf("frenzy").strongItems).toBeGreaterThan(1);
    expect(effectsOf("pucks").itemsOnly).toEqual(["puck", "puck3"]);
    expect(effectsOf("turbo")).toMatchObject({ topSpeed: 1.15 });
    expect(effectsOf("reverse").reverseGrid).toBe(true);
  });

  it("change nothing for no card, or one this build does not know", () => {
    expect(effectsOf(undefined)).toBe(NO_RULE);
    expect(effectsOf("mirror-madness")).toBe(NO_RULE);
    expect(cardById("nope")).toBeUndefined();
  });
});

describe("the host's choice", () => {
  it("lists Normal first, then every card, then Shuffle and Today's Card", () => {
    expect(CHOICES[0]!.id).toBe(NORMAL);
    expect(CHOICES.slice(1, -2).map((c) => c.id)).toEqual(CARDS.map((c) => c.id));
    expect(CHOICES.slice(-2).map((c) => c.id)).toEqual([SHUFFLE, DAILY]);
  });

  it("keeps a choice it knows and reads anything else as Normal", () => {
    expect(cleanChoice("ice")).toBe("ice");
    expect(cleanChoice(SHUFFLE)).toBe(SHUFFLE);
    expect(cleanChoice("lava")).toBe(NORMAL);
    expect(cleanChoice(7)).toBe(NORMAL);
    expect(cleanChoice(undefined)).toBe(NORMAL);
  });
});

describe("dealing a card", () => {
  it("deals nothing for Normal and the card itself for a card", () => {
    expect(dealCard(NORMAL, 5, "2026-11-07")).toBeNull();
    expect(dealCard(undefined, 5, "2026-11-07")).toBeNull();
    for (const card of CARDS) expect(dealCard(card.id, 99, "2026-11-07")).toBe(card.id);
  });

  it("deals Today's Card from the date alone: the same for everyone, whatever the race's seed", () => {
    const day = "2026-11-07";
    const first = dealCard(DAILY, 1, day);
    expect(first).not.toBeNull();
    for (const seed of [2, 3, 4_000_000_000]) expect(dealCard(DAILY, seed, day)).toBe(first);
    expect(dealCard(DAILY, 1, day, first)).toBe(first);
    expect(dailyCard(day)).toBe(first);
  });

  it("changes Today's Card from day to day, and uses all the cards over a season", () => {
    const seen = new Set<string>();
    let changes = 0;
    let before = "";
    for (let d = 0; d < 270; d++) {
      const day = todayKey(new Date(Date.UTC(2026, 0, 1 + d)));
      const card = dailyCard(day);
      seen.add(card);
      if (card !== before) changes++;
      before = card;
    }
    expect(seen.size).toBe(CARDS.length);
    // A different card most days (a run of the same one every day would not be a daily card).
    expect(changes).toBeGreaterThan(200);
  });

  it("shuffles by the race's seed, replays the same, and never repeats the card just played", () => {
    expect(dealCard(SHUFFLE, 1234, "2026-11-07")).toBe(dealCard(SHUFFLE, 1234, "2026-11-07"));
    const seen = new Set<string>();
    let last: string | null = null;
    for (let seed = 1; seed <= 200; seed++) {
      const card: string = dealCard(SHUFFLE, seed * 7919, "2026-11-07", last)!;
      expect(card).not.toBe(last);
      expect(cardById(card)).toBeDefined();
      seen.add(card);
      last = card;
    }
    expect(seen.size).toBe(CARDS.length);
  });

  it("reads the date in UTC, as the day's seed", () => {
    expect(todayKey(new Date(Date.UTC(2026, 10, 7, 23, 59)))).toBe("2026-11-07");
    expect(todayKey(new Date(Date.UTC(2026, 10, 8, 0, 1)))).toBe("2026-11-08");
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});
