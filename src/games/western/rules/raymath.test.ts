import { describe, expect, it } from "vitest";
import { effectiveRadius, probePoint, probeSegment, type RayProbe } from "./raymath";

const o = { x: 0, y: 0, z: 0 };
const fwd = { x: 0, y: 0, z: -1 };

describe("ray probes", () => {
  it("measures the closest approach to a point", () => {
    const r: RayProbe = { t: 0, miss: 0 };
    probePoint(o, fwd, { x: 0.3, y: 0.4, z: -10 }, r);
    expect(r.t).toBeCloseTo(10);
    expect(r.miss).toBeCloseTo(0.5);
    probePoint(o, fwd, { x: 0, y: 0, z: 5 }, r);
    expect(r.t).toBeLessThan(0);
  });

  it("measures the closest approach to a segment (a capsule's axis)", () => {
    const r: RayProbe = { t: 0, miss: 0 };
    // A vertical torso 20 m ahead, 0.1 m to the right.
    probeSegment(o, fwd, { x: 0.1, y: -0.5, z: -20 }, { x: 0.1, y: 0.5, z: -20 }, r);
    expect(r.t).toBeCloseTo(20);
    expect(r.miss).toBeCloseTo(0.1);
    // Above its top end: distance to the end cap.
    probeSegment(o, fwd, { x: 0, y: -1.5, z: -20 }, { x: 0, y: -0.5, z: -20 }, r);
    expect(r.miss).toBeCloseTo(0.5);
    // A segment along the ray.
    probeSegment(o, fwd, { x: 0.2, y: 0, z: -5 }, { x: 0.2, y: 0, z: -8 }, r);
    expect(r.miss).toBeCloseTo(0.2);
  });

  it("widens small far targets to a minimum angle", () => {
    expect(effectiveRadius(0.2, 5, 0.01)).toBe(0.2);
    expect(effectiveRadius(0.2, 40, 0.01)).toBeCloseTo(40 * Math.tan(0.01));
  });
});
