import { describe, expect, it } from "vitest";
import { TrackGeometry, type TrackDef } from "../../track/geometry";
import { analyseFeatures, inMetres, RAMP_HEIGHT, RAMP_LENGTH, rampHeight, WALL_DISTANCE } from "./features";

/** An oval, two 200 m straights and a bend at each end (about 900 m round), with room for features. */
function track(extra: Partial<TrackDef> = {}): TrackDef {
  return {
    id: "t",
    name: "t",
    theme: "kitchen",
    laps: 1,
    width: 14,
    itemRows: [],
    points: [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
      { x: 0, z: 200 },
      { x: -50, z: 260 },
      { x: -150, z: 260 },
      { x: -200, z: 200 },
      { x: -200, z: 100 },
      { x: -200, z: 0 },
      { x: -150, z: -60 },
      { x: -50, z: -60 },
    ],
    ...extra,
  };
}

describe("rampHeight", () => {
  const ramps = [{ lip: 300, length: RAMP_LENGTH, height: RAMP_HEIGHT, trick: true }];

  it("is nothing before the foot and after the lip", () => {
    expect(rampHeight(ramps, 300 - RAMP_LENGTH - 1, 1000)).toBe(0);
    expect(rampHeight(ramps, 300.5, 1000)).toBe(0);
    expect(rampHeight(ramps, 100, 1000)).toBe(0);
  });

  it("rises smoothly to the height at the lip", () => {
    let last = 0;
    for (let s = 300 - RAMP_LENGTH; s <= 300; s += 0.5) {
      const h = rampHeight(ramps, s, 1000);
      expect(h).toBeGreaterThanOrEqual(last - 1e-9);
      last = h;
    }
    expect(rampHeight(ramps, 299.999, 1000)).toBeCloseTo(RAMP_HEIGHT, 1);
  });

  it("finds a ramp whose foot is over the start line", () => {
    const wrap = [{ lip: 4, length: RAMP_LENGTH, height: RAMP_HEIGHT, trick: true }];
    expect(rampHeight(wrap, 995, 1000)).toBeGreaterThan(0);
    expect(rampHeight(wrap, 2, 1000)).toBeGreaterThan(0);
  });
});

describe("inMetres", () => {
  it("wraps over the start line", () => {
    expect(inMetres({ from: 950, to: 30 }, 990, 1000)).toBe(true);
    expect(inMetres({ from: 950, to: 30 }, 10, 1000)).toBe(true);
    expect(inMetres({ from: 950, to: 30 }, 500, 1000)).toBe(false);
  });
});

describe("analyseFeatures", () => {
  it("has nothing open and the usual wall on a plain track", () => {
    const f = analyseFeatures(TrackGeometry.build(track()));
    expect(f.anyDrop).toBe(false);
    expect(f.gap.every((g) => g === 0)).toBe(true);
    expect(f.wallLeft[10]).toBe(WALL_DISTANCE);
    expect(f.ramps).toHaveLength(0);
  });

  it("opens the edge it is told to, on that side, and eases it open and shut", () => {
    const g = TrackGeometry.build(track({ drops: [{ from: 0.2, to: 0.3, side: "right" }] }));
    const f = analyseFeatures(g);
    const mid = Math.round((0.25 * g.length) / g.spacing);
    expect(f.dropRight[mid]).toBeCloseTo(1, 5);
    expect(f.dropLeft[mid]).toBe(0);
    const before = Math.round((0.2 * g.length) / g.spacing) - 8;
    expect(f.dropRight[before]).toBe(0);
    // Right at the boundary it is half way: not a step.
    const edge = Math.round((0.2 * g.length) / g.spacing);
    expect(f.dropRight[edge]).toBeGreaterThan(0.1);
    expect(f.dropRight[edge]).toBeLessThan(0.9);
  });

  it("calls a short drop on both sides just behind a ramp a gap in the road, and no other", () => {
    const withRamp = TrackGeometry.build(track({ ramps: [{ at: 0.3 }], drops: [{ from: 0.31, to: 0.335, side: "both" }] }));
    const f = analyseFeatures(withRamp);
    const mid = Math.round((0.32 * withRamp.length) / withRamp.spacing);
    expect(f.gap[mid]).toBe(1);
    expect(f.ramps).toHaveLength(1);
    expect(f.ramps[0]!.lip).toBeCloseTo(0.3 * withRamp.length, 5);

    const without = analyseFeatures(TrackGeometry.build(track({ drops: [{ from: 0.31, to: 0.335, side: "both" }] })));
    expect(without.gap[mid]).toBe(0);
    // A long open edge beside a ramp is not a gap either.
    const longOne = analyseFeatures(TrackGeometry.build(track({ ramps: [{ at: 0.3 }], drops: [{ from: 0.31, to: 0.6, side: "both" }] })));
    expect(longOne.gap[mid]).toBe(0);
  });

  it("moves the barrier out where a verge is, on its side", () => {
    const g = TrackGeometry.build(track({ verges: [{ from: 0.1, to: 0.2, side: "left", distance: 24, surface: "sand" }] }));
    const f = analyseFeatures(g);
    const mid = Math.round((0.15 * g.length) / g.spacing);
    expect(f.wallLeft[mid]).toBe(24);
    expect(f.wallRight[mid]).toBe(WALL_DISTANCE);
    expect(f.vergeLeft[mid]).toBe("sand");
    expect(f.vergeRight[mid]).toBeNull();
  });

  it("scales a ramp's height with its lift", () => {
    const f = analyseFeatures(TrackGeometry.build(track({ ramps: [{ at: 0.3, lift: 14 }] })));
    expect(f.ramps[0]!.height).toBeCloseTo(RAMP_HEIGHT * 2, 5);
  });
});
