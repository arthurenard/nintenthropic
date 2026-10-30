import { describe, expect, it } from "vitest";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { mirrorTrack } from "../../track/mirror";
import { Bank, MAX_ROLL } from "./bank";
import { GROUND_SINK, Terrain } from "./terrain";
import { styleFor } from "./themes";

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

/** The same loop, its points leaning on their own: the far straight tilts right then left (a twist), the far bend banked hard. */
function twisted(): TrackDef {
  const def = loop();
  def.points = def.points.map((p) => {
    if (p.x === -120 && p.z === 200) return { ...p, bank: 0.25 };
    if (p.x === -120 && p.z === 0) return { ...p, bank: -0.25 };
    if (p.x === -60 && p.z === 240) return { ...p, bank: 0.3 };
    return p;
  });
  return def;
}

describe("a road that leans where its points say", () => {
  const g = TrackGeometry.build(twisted());
  const bank = new Bank(g);

  it("leans as each point asks, easing between them, and not at all where no point leans", () => {
    expect(bank.any).toBe(true);
    expect(bank.rollAt(g.project(-60, 240).s)).toBeCloseTo(0.3, 2);
    expect(bank.rollAt(g.project(-120, 200).s)).toBeCloseTo(0.25, 2);
    expect(bank.rollAt(g.project(-120, 0).s)).toBeCloseTo(-0.25, 2);
    // Halfway along the twisting straight it is level again, on its way from one lean to the other.
    expect(Math.abs(bank.rollAt(g.project(-120, 100).s))).toBeLessThan(0.02);
    expect(bank.rollAt(g.project(0, 100).s)).toBe(0);
    // + leans the right side down (right of the road is +x on the far straight, driven toward -z).
    const s = g.project(-120, 200).s;
    expect(bank.lift(s, 5)).toBeLessThan(-1);
    expect(bank.lift(s, -5)).toBeGreaterThan(1);
  });

  it("adds the track's own banking on top, within the limit", () => {
    const both = TrackGeometry.build({ ...twisted(), bank: 40 });
    const b = new Bank(both);
    const s = both.project(-60, 240).s;
    expect(b.rollAt(s)).toBeGreaterThan(0.3);
    for (let x = 0; x < both.length; x += 5) expect(Math.abs(b.rollAt(x))).toBeLessThanOrEqual(MAX_ROLL + 1e-6);
  });

  it("leans the other way in the mirror", () => {
    const m = TrackGeometry.build(mirrorTrack(twisted()));
    const mb = new Bank(m);
    for (const s of [100, 300, 500, 700]) expect(mb.rollAt(s)).toBeCloseTo(-bank.rollAt(s), 5);
  });

  it("is built once per track when asked for that way", () => {
    expect(Bank.of(g)).toBe(Bank.of(g));
  });

  it("is followed by the ground: level with each edge beside it, up on the high side and down on the low", () => {
    const terrain = Terrain.build(g, styleFor("meadow"), 4);
    const s = g.project(-60, 240).s;
    const c = g.at(s);
    for (const side of [-1, 1]) {
      const o = side * (c.width / 2 + 3);
      const p = g.point(s, o);
      const edge = c.y + bank.lift(s, o);
      expect(terrain.heightAt(p.x, p.z)).toBeCloseTo(edge - GROUND_SINK, 0);
    }
    // The low side (+, the right) really is low: the ground there is well under the centre line.
    const low = g.point(s, c.width / 2 + 3);
    expect(terrain.heightAt(low.x, low.z)).toBeLessThan(c.y - GROUND_SINK - 1.5);
  });
});
