import { describe, expect, it } from "vitest";
import { TrackGeometry, type TrackDef } from "./geometry";
import { TRACKS } from "./tracks";

/** A circle of radius `r` from (r, 0) toward +z: facing +z, right is -x, so every bend is a right. */
function circle(r: number, n = 16): TrackDef {
  const points = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: r * Math.cos(a), z: r * Math.sin(a) };
  });
  return { id: "circle", name: "Circle", theme: "meadow", laps: 3, points, width: 12, itemRows: [] };
}

describe("TrackGeometry", () => {
  const r = 50;
  const g = TrackGeometry.build(circle(r));

  it("measures the loop", () => {
    expect(g.length).toBeCloseTo(2 * Math.PI * r, 0);
  });

  it("knows which way is right", () => {
    // At the start (r, 0) facing +z, the centre (0, 0) is to the right.
    const p = g.project(0.5 * r, 0, 0);
    expect(p.offset).toBeCloseTo(0.5 * r, 0);
    expect(g.at(0).curvature).toBeCloseTo(1 / r, 2);
  });

  it("projects a point back to where it was made", () => {
    for (const s of [0, 10, 77.5, 200, g.length - 1]) {
      for (const offset of [-5, 0, 3.5]) {
        const p = g.point(s, offset);
        const back = g.project(p.x, p.z, s + 2);
        expect(Math.abs(g.delta(back.s, s))).toBeLessThan(0.5);
        expect(back.offset).toBeCloseTo(offset, 1);
      }
    }
  });

  it("wraps and measures the short way round", () => {
    expect(g.wrap(-1)).toBeCloseTo(g.length - 1);
    expect(g.delta(g.length - 2, 3)).toBeCloseTo(5);
    expect(g.delta(3, g.length - 2)).toBeCloseTo(-5);
  });

  it("faces down the track", () => {
    const h = g.heading(0);
    expect(Math.sin(h)).toBeCloseTo(0, 1);
    expect(Math.cos(h)).toBeCloseTo(1, 1);
  });
});

describe("the tracks", () => {
  for (const def of TRACKS) {
    it(`${def.name} builds, and never passes close to itself`, () => {
      const g = TrackGeometry.build(def);
      expect(g.length).toBeGreaterThan(300);
      // Two stretches more than 60 m apart along the lap must be at least a road and a verge apart.
      const step = 4;
      for (let i = 0; i < g.samples.length; i += step) {
        for (let j = i + step; j < g.samples.length; j += step) {
          const a = g.samples[i]!;
          const b = g.samples[j]!;
          if (Math.abs(g.delta(a.s, b.s)) < 60) continue;
          const gap = Math.hypot(a.x - b.x, a.z - b.z);
          expect(gap, `${def.id} at ${a.s.toFixed(0)} m and ${b.s.toFixed(0)} m`).toBeGreaterThan((a.width + b.width) / 2 + 8);
        }
      }
    });
  }
});
