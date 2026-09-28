import { describe, expect, it } from "vitest";
import { DIFFICULTY } from "./tuning";
import { newMatch } from "./testkit";

const standard = DIFFICULTY.standard;
const relaxed = DIFFICULTY.relaxed;

describe("the difficulty table", () => {
  it("plays Standard exactly as designed", () => {
    expect(standard).toEqual({ speedFactor: 1, strikeFactor: 1, ringLead: 5, heatFactor: 1, droneRate: 6 });
  });

  it("makes Relaxed's debris a quarter slower and its strikes about a third softer", () => {
    expect(relaxed.speedFactor).toBeCloseTo(0.75, 6);
    expect(relaxed.strikeFactor).toBeGreaterThanOrEqual(0.65);
    expect(relaxed.strikeFactor).toBeLessThanOrEqual(0.72);
  });

  it("rings at seven seconds on Relaxed, heats the laser more slowly and mends faster", () => {
    expect(relaxed.ringLead).toBe(7);
    expect(relaxed.heatFactor).toBeLessThan(1);
    expect(relaxed.droneRate).toBeGreaterThan(standard.droneRate);
  });

  it("is read by the match from the setting", () => {
    expect(newMatch(1, "relaxed").match.tuning).toBe(relaxed);
    expect(newMatch(1).match.tuning).toBe(standard);
  });
});
