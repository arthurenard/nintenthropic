import { describe, expect, it } from "vitest";
import { Scorer } from "./scoring";

describe("scoring", () => {
  it("pays 150 a headshot kill, 60 a body kill, 100 a crawler however it falls", () => {
    const s = new Scorer();
    expect(s.kill({ kind: "walker", headshot: true, distance: 10 }).points).toBe(150);
    expect(s.kill({ kind: "walker", headshot: false, distance: 10 }).points).toBe(60);
    expect(s.kill({ kind: "crawler", headshot: false, distance: 10 }).points).toBe(100);
    expect(s.kill({ kind: "crawler", headshot: true, distance: 10 }).points).toBe(100);
    expect(s.kills).toBe(4);
    expect(s.headshots).toBe(2);
  });

  it("adds 50 for a runner, and half as much again for a kill beyond 30 m", () => {
    const s = new Scorer();
    expect(s.kill({ kind: "runner", headshot: true, distance: 12 })).toEqual({ points: 200, labels: ["Headshot", "Runner"], multiplier: 1 });
    expect(s.kill({ kind: "walker", headshot: true, distance: 31 })).toEqual({ points: 225, labels: ["Headshot", "Long Shot"], multiplier: 1 });
    expect(s.kill({ kind: "walker", headshot: true, distance: 30 }).points).toBe(150);
  });

  it("pays 1000 for the Mechanic, 100 for his mask, 100 for each caught in a bloater's chain", () => {
    const s = new Scorer();
    expect(s.mask()).toEqual({ points: 100, labels: ["Mask Off"], multiplier: 1 });
    expect(s.kill({ kind: "mechanic", headshot: true, distance: 8 }).points).toBe(1000);
    expect(s.chain(3)).toEqual({ points: 300, labels: ["Chain ×3"], multiplier: 1 });
    expect(s.kills).toBe(4);
  });

  it("builds a streak ×1 → ×4 on consecutive hits, and a miss resets it", () => {
    const s = new Scorer();
    const ups: number[] = [];
    for (let i = 0; i < 10; i++) if (s.shot(true)) ups.push(s.multiplier);
    expect(ups).toEqual([2, 3, 4]);
    expect(s.kill({ kind: "walker", headshot: true, distance: 5 }).points).toBe(600);
    s.shot(false);
    expect(s.multiplier).toBe(1);
    expect(s.bestStreak).toBe(10);
  });

  it("takes 300 for a survivor, breaks the streak, and never goes below zero", () => {
    const s = new Scorer();
    s.shot(true);
    s.shot(true);
    s.shot(true);
    expect(s.survivor()).toEqual({ points: -300, labels: ["Survivor"], multiplier: 1 });
    expect(s.score).toBe(0);
    expect(s.multiplier).toBe(1);
    s.kill({ kind: "walker", headshot: true, distance: 5 });
    s.kill({ kind: "walker", headshot: true, distance: 5 });
    s.kill({ kind: "walker", headshot: true, distance: 5 });
    s.survivor();
    expect(s.score).toBe(150);
  });

  it("closes a wave with accuracy, Untouched and Clean Hands", () => {
    const s = new Scorer();
    for (let i = 0; i < 4; i++) s.shot(i < 3);
    const b = s.endWave();
    expect(b).toEqual({ accuracy: 0.75, accuracyPoints: 380, untouched: 500, cleanHands: 250, total: 1130 });
    s.hurt();
    s.survivor();
    const c = s.endWave();
    expect(c.untouched).toBe(0);
    expect(c.cleanHands).toBe(0);
    // The next wave starts clean.
    expect(s.endWave()).toMatchObject({ untouched: 500, cleanHands: 250 });
  });
});
