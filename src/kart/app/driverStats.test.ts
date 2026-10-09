import { describe, expect, it } from "vitest";
import { CHARACTERS, WEIGHTS } from "../characters";
import { CLASS_WORDS, SEGMENTS, segmentsFor, statsOf } from "./driverStats";

const of = (weight: Parameters<typeof statsOf>[0]) => Object.fromEntries(statsOf(weight).map((stat) => [stat.id, stat.segments]));

describe("the driver's bars", () => {
  it("read the sim's own numbers: the class with the most of a thing has five, the class with the least has one", () => {
    expect(of("heavy")).toEqual({ speed: 5, acceleration: 1, handling: 1, weight: 5 });
    expect(of("light")).toEqual({ speed: 1, acceleration: 5, handling: 5, weight: 1 });
  });

  it("put the middle weight in the middle of what the numbers say, never at an end", () => {
    const middle = of("middle");
    for (const segments of Object.values(middle)) {
      expect(segments).toBeGreaterThan(1);
      expect(segments).toBeLessThan(SEGMENTS);
    }
    // 0.97, 1.0, 1.03 of top speed: exactly between.
    expect(middle.speed).toBe(3);
    expect(middle.weight).toBe(3);
  });

  it("order the classes as the multipliers order them, stat by stat", () => {
    const light = of("light");
    const middle = of("middle");
    const heavy = of("heavy");
    expect(WEIGHTS.heavy.topSpeed).toBeGreaterThan(WEIGHTS.light.topSpeed);
    expect(light.speed).toBeLessThan(middle.speed!);
    expect(middle.speed).toBeLessThan(heavy.speed!);
    expect(WEIGHTS.light.acceleration).toBeGreaterThan(WEIGHTS.heavy.acceleration);
    expect(light.acceleration).toBeGreaterThan(middle.acceleration!);
    expect(middle.acceleration).toBeGreaterThan(heavy.acceleration!);
    expect(light.handling).toBeGreaterThan(heavy.handling!);
    // Shoved less is weightier.
    expect(WEIGHTS.heavy.shoved).toBeLessThan(WEIGHTS.light.shoved);
    expect(heavy.weight).toBeGreaterThan(light.weight!);
  });

  it("stay within one to five for every driver, and every driver's class has a name", () => {
    for (const character of CHARACTERS) {
      for (const stat of statsOf(character.weight)) {
        expect(stat.segments).toBeGreaterThanOrEqual(1);
        expect(stat.segments).toBeLessThanOrEqual(SEGMENTS);
        expect(Number.isInteger(stat.segments)).toBe(true);
      }
      expect(CLASS_WORDS[character.weight]).toMatch(/weight$/);
    }
  });

  it("know what a bar is: the least is one, the most five, a tie is the middle", () => {
    expect(segmentsFor(0.9, 0.9, 1.1)).toBe(1);
    expect(segmentsFor(1.1, 0.9, 1.1)).toBe(5);
    expect(segmentsFor(1.0, 0.9, 1.1)).toBe(3);
    expect(segmentsFor(2, 1, 1)).toBe(3);
    expect(segmentsFor(0, 1, 2)).toBe(1);
    expect(segmentsFor(9, 1, 2)).toBe(5);
  });
});
