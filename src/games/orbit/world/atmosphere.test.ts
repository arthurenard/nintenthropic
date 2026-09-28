import { describe, expect, it } from "vitest";
import { ATM, horizonDip, LUT_ANGLES, LUT_HEIGHTS, R, sunlightAt, transmittance, transmittanceTable } from "./atmosphere";

describe("the atmosphere", () => {
  it("lets most of an overhead sun through to the ground, blue a little less than red", () => {
    const t = transmittance(0, 1);
    expect(t[0]).toBeGreaterThan(0.85);
    expect(t[2]).toBeGreaterThan(0.6);
    expect(t[2]).toBeLessThan(t[0]);
  });

  it("reddens a low sun and hides one behind the planet", () => {
    const low = transmittance(0, 0.02);
    expect(low[0]).toBeGreaterThan(low[1]);
    expect(low[1]).toBeGreaterThan(low[2]);
    expect(transmittance(0, -0.2)).toEqual([0, 0, 0]);
    // At the top of the air, nothing is in the way looking up.
    const top = transmittance(ATM, 0.5);
    for (const c of top) expect(c).toBeGreaterThan(0.999);
  });

  it("gives the station white sunlight by day, orange at the limb, none behind the planet", () => {
    const eye: [number, number, number] = [0, R + 420, 0];
    const day = sunlightAt(eye, [0.5, 0.8660254, 0]);
    expect(Math.min(...day)).toBeGreaterThan(0.999);
    // Just grazing the air over the limb.
    const dip = horizonDip(420);
    const graze = (lift: number): [number, number, number] => {
      const a = -dip + lift;
      return [Math.cos(a), Math.sin(a), 0];
    };
    const sunset = sunlightAt(eye, graze(0.0035));
    expect(sunset[0]).toBeGreaterThan(sunset[2] * 2);
    expect(sunlightAt(eye, graze(-0.03))).toEqual([0, 0, 0]);
  });

  it("puts the limb 20 degrees below the station's horizontal at 420 km", () => {
    expect((horizonDip(420) * 180) / Math.PI).toBeCloseTo(20.3, 1);
  });

  it("makes a table of the right size, all values in 0..1", () => {
    const t = transmittanceTable(8, 16);
    expect(t.length).toBe(8 * 16 * 4);
    for (const v of t) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(LUT_ANGLES * LUT_HEIGHTS).toBeGreaterThan(1000);
  });
});
