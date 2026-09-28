import { describe, expect, it } from "vitest";
import { farBonus, Scorer } from "./scoring";
import { ACCURACY_BONUS_MAX, DERELICT_POINTS, DRONE_PENALTY, GOOD_NEIGHBOUR_BONUS, NOT_A_SCRATCH_BONUS, SPLIT_POINTS, TANK_HIT_POINTS, VAPORISE_POINTS } from "./tuning";

describe("scoring", () => {
  it("pays double far out, down to single at 20 m", () => {
    expect(farBonus(120)).toBe(2);
    expect(farBonus(60)).toBe(2);
    expect(farBonus(40)).toBeCloseTo(1.5, 6);
    expect(farBonus(20)).toBe(1);
    expect(farBonus(3)).toBe(1);
  });

  it("vaporises for 80 and splits for 40, times the far bonus", () => {
    const s = new Scorer();
    expect(s.hit("vaporise", 10).points).toBe(VAPORISE_POINTS);
    expect(s.hit("vaporise", 100).points).toBe(VAPORISE_POINTS * 2);
    const split = s.hit("split", 40);
    expect(split.points).toBe(SPLIT_POINTS * 1.5);
    expect(split.labels).toContain("Split");
  });

  it("pays the Derelict's tank 200 a hit and 1500 for the break-up, far or near", () => {
    const s = new Scorer();
    expect(s.hit("tank", 100).points).toBe(TANK_HIT_POINTS);
    expect(s.hit("breakup", 100).points).toBe(TANK_HIT_POINTS + DERELICT_POINTS);
    expect(s.derelicts).toBe(1);
  });

  it("builds a streak a step every three hits to ×4, and a miss resets it", () => {
    const s = new Scorer();
    const ups: number[] = [];
    for (let i = 0; i < 12; i++) if (s.shot(true)) ups.push(s.multiplier);
    expect(ups).toEqual([2, 3, 4]);
    expect(s.hit("vaporise", 10).points).toBe(VAPORISE_POINTS * 4);
    s.shot(false);
    expect(s.multiplier).toBe(1);
    expect(s.bestStreak).toBe(12);
  });

  it("costs 300 and the streak for shooting the drone, and Good Neighbour for the pass", () => {
    const s = new Scorer();
    s.score = 1000;
    for (let i = 0; i < 6; i++) s.shot(true);
    const a = s.drone();
    expect(a.points).toBe(-DRONE_PENALTY);
    expect(s.score).toBe(1000 - DRONE_PENALTY);
    expect(s.multiplier).toBe(1);
    expect(s.endPass().goodNeighbour).toBe(0);
    expect(s.endPass().goodNeighbour).toBe(GOOD_NEIGHBOUR_BONUS);
  });

  it("ends a pass with its accuracy bonus, Not a Scratch and Good Neighbour", () => {
    const s = new Scorer();
    s.shot(true);
    s.shot(true);
    s.shot(true);
    s.shot(false);
    const b = s.endPass();
    expect(b.accuracy).toBeCloseTo(0.75, 6);
    expect(b.accuracyPoints).toBe(Math.round((0.75 * ACCURACY_BONUS_MAX) / 10) * 10);
    expect(b.notAScratch).toBe(NOT_A_SCRATCH_BONUS);
    expect(b.goodNeighbour).toBe(GOOD_NEIGHBOUR_BONUS);
    s.damaged();
    expect(s.endPass().notAScratch).toBe(0);
  });
});
