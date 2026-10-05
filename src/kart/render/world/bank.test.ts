import { describe, expect, it } from "vitest";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { Bank, MAX_ROLL } from "./bank";

/** A rounded rectangle driven round to the right (x is mirrored: a kart facing +z has its right at -x). */
function loop(bank?: number): TrackDef {
  return {
    id: "t",
    name: "t",
    theme: "meadow",
    laps: 1,
    width: 14,
    itemRows: [],
    bank,
    points: [
      { x: 0, z: 0 },
      { x: 0, z: 200 },
      { x: -20, z: 230 },
      { x: -60, z: 240 },
      { x: -100, z: 230 },
      { x: -120, z: 200 },
      { x: -120, z: 0 },
      { x: -100, z: -30 },
      { x: -60, z: -40 },
      { x: -20, z: -30 },
    ],
  };
}

describe("bank", () => {
  it("is flat when the track says nothing", () => {
    const g = TrackGeometry.build(loop());
    const bank = new Bank(g);
    expect(bank.any).toBe(false);
    expect(bank.rollAt(100)).toBe(0);
    expect(bank.lift(100, 5)).toBe(0);
  });

  it("leans into a right-hand bend: the right side is the low one", () => {
    const g = TrackGeometry.build(loop(10));
    const bank = new Bank(g);
    // The bend at about (-60, 240) turns right.
    const s = g.project(-60, 240).s;
    expect(g.at(s).curvature).toBeGreaterThan(0.005);
    expect(bank.rollAt(s)).toBeGreaterThan(0.02);
    expect(bank.lift(s, 5)).toBeLessThan(-0.1);
    expect(bank.lift(s, -5)).toBeGreaterThan(0.1);
    expect(bank.lift(s, 0)).toBeCloseTo(0, 6);
  });

  it("never leans harder than the limit, and holds the edge's height beyond the road", () => {
    const g = TrackGeometry.build(loop(500));
    const bank = new Bank(g);
    for (let s = 0; s < g.length; s += 7) expect(Math.abs(bank.rollAt(s))).toBeLessThanOrEqual(MAX_ROLL + 1e-6);
    const s = g.project(-60, 240).s;
    expect(bank.lift(s, 30)).toBeCloseTo(bank.lift(s, 7), 6);
  });

  it("is flat on the straights", () => {
    const g = TrackGeometry.build(loop(10));
    const bank = new Bank(g);
    const s = g.project(0, 100).s;
    expect(Math.abs(bank.rollAt(s))).toBeLessThan(0.01);
  });
});
