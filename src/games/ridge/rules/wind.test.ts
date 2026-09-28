import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../engine/rules/rng";
import { stageWind, Wind } from "./wind";

describe("the wind down the valley", () => {
  it("gusts and lulls round its breeze, and never turns round", () => {
    const w = new Wind(mulberry32(3), 8);
    w.set({ base: 4, gust: 0.4 }, 0);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 120; t += 0.1) {
      w.update(0.1);
      lo = Math.min(lo, w.speed);
      hi = Math.max(hi, w.speed);
    }
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(3.4);
    expect(hi).toBeGreaterThan(4.8);
    expect(hi).toBeLessThanOrEqual(8);
  });

  it("never blows harder than its ceiling (Relaxed keeps it under 4 m/s)", () => {
    const w = new Wind(mulberry32(5), 4);
    w.set({ base: -7, gust: 0.7 }, 0);
    for (let t = 0; t < 200; t += 0.1) {
      w.update(0.1);
      expect(Math.abs(w.speed)).toBeLessThanOrEqual(4);
    }
    expect(w.spec.base).toBe(-4);
  });

  it("eases a new wind in, so the readout shows it coming", () => {
    const w = new Wind(mulberry32(1), 8);
    w.set({ base: 2, gust: 0 }, 0);
    w.update(0.1);
    expect(w.speed).toBeCloseTo(2);
    w.set({ base: -6, gust: 0 }, 2.5);
    w.update(0.5);
    expect(w.speed).toBeGreaterThan(-6);
    expect(w.speed).toBeLessThan(2);
    for (let t = 0; t < 3; t += 0.1) w.update(0.1);
    expect(w.speed).toBeCloseTo(-6);
  });

  it("replays exactly from the same seed", () => {
    const a = new Wind(mulberry32(9), 8);
    const b = new Wind(mulberry32(9), 8);
    a.set({ base: 3, gust: 0.5 }, 0);
    b.set({ base: 3, gust: 0.5 }, 0);
    for (let i = 0; i < 300; i++) {
      a.update(1 / 30);
      b.update(1 / 30);
      expect(a.speed).toBe(b.speed);
    }
  });

  it("grows stronger over the stages: a light breeze first, a strong wind for the officer", () => {
    const r = mulberry32(2);
    const avg = (stage: number) => {
      let s = 0;
      for (let i = 0; i < 40; i++) s += Math.abs(stageWind(stage, r).base);
      return s / 40;
    };
    expect(avg(1)).toBeLessThan(2.6);
    expect(avg(5)).toBeGreaterThan(4.9);
    expect(avg(6)).toBeGreaterThan(avg(1));
    for (let stage = 1; stage < 20; stage++) expect(Math.abs(stageWind(stage, r).base)).toBeLessThanOrEqual(8);
  });
});
