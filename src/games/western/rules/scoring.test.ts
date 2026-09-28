import { describe, expect, it } from "vitest";
import { Scorer } from "./scoring";

const plain = { headshot: false, quickDraw: false, runner: false, boss: false, blast: false };

describe("scoring", () => {
  it("pays 100 a kill, +50 headshot, +100 quick draw, +50 runner", () => {
    const s = new Scorer();
    expect(s.kill(plain).points).toBe(100);
    expect(s.kill({ ...plain, headshot: true }).points).toBe(150);
    expect(s.kill({ ...plain, quickDraw: true }).points).toBe(200);
    expect(s.kill({ ...plain, runner: true }).points).toBe(150);
    const all = s.kill({ ...plain, headshot: true, quickDraw: true, runner: true });
    expect(all.points).toBe(300);
    expect(all.labels).toEqual(["Headshot", "Quick Draw", "Runner"]);
    expect(s.kills).toBe(5);
    expect(s.headshots).toBe(2);
  });

  it("pays 150 for dynamite in the air", () => {
    const s = new Scorer();
    expect(s.dynamiteInAir().points).toBe(150);
  });

  it("raises the multiplier every three hits in a row, up to x4, and a miss resets it", () => {
    const s = new Scorer();
    const ups: number[] = [];
    for (let i = 0; i < 12; i++) if (s.shot(true)) ups.push(s.multiplier);
    expect(ups).toEqual([2, 3, 4]);
    expect(s.multiplier).toBe(4);
    expect(s.kill(plain).points).toBe(400);
    s.shot(false);
    expect(s.multiplier).toBe(1);
    expect(s.bestStreak).toBe(12);
  });

  it("costs 200, the streak and Clean Hands for shooting an innocent", () => {
    const s = new Scorer();
    s.shot(true);
    s.kill(plain);
    s.kill(plain);
    s.kill(plain);
    expect(s.score).toBe(300);
    s.innocent();
    expect(s.score).toBe(100);
    expect(s.streak).toBe(0);
    const b = s.endWave();
    expect(b.cleanHands).toBe(0);
  });

  it("never goes below zero", () => {
    const s = new Scorer();
    s.innocent();
    expect(s.score).toBe(0);
  });

  it("names the penalty in words, for a popup that reads without its colour", () => {
    const award = new Scorer().innocent();
    expect(award.points).toBe(-200);
    expect(award.labels).toEqual(["Townsperson"]);
  });

  it("adds accuracy, Untouchable and Clean Hands at the end of a wave", () => {
    const s = new Scorer();
    s.shot(true);
    s.shot(true);
    s.shot(true);
    s.shot(false);
    const b = s.endWave();
    expect(b.accuracy).toBeCloseTo(0.75);
    expect(b.accuracyPoints).toBe(380);
    expect(b.untouchable).toBe(500);
    expect(b.cleanHands).toBe(250);
    expect(s.score).toBe(380 + 500 + 250);
  });

  it("takes Untouchable away if you were hit, and resets per wave", () => {
    const s = new Scorer();
    s.damaged();
    expect(s.endWave().untouchable).toBe(0);
    expect(s.endWave().untouchable).toBe(500);
  });

  it("counts overall accuracy across waves", () => {
    const s = new Scorer();
    s.shot(true);
    s.shot(false);
    s.endWave();
    s.shot(true);
    s.shot(true);
    expect(s.accuracy).toBeCloseTo(0.75);
  });
});
