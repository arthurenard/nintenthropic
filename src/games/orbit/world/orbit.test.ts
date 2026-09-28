import { describe, expect, it } from "vitest";
import { BREATHER } from "../rules/tuning";
import { BELOW_LIMB, moonAt, MOON_TOP, nightFor, PASS_SINK, RISE_START, SET_AZIMUTH, SET_END, skyAt } from "./orbit";

const DEG = Math.PI / 180;
const DIP = 20.3 * DEG;
const DAY = { elevation: 30 * DEG, azimuth: -62 * DEG };

describe("the orbit's sky", () => {
  it("keeps the art's sun at the start of a pass, and lets it sink slowly through it", () => {
    const start = skyAt({ kind: "day", t: 0 }, DAY, DIP);
    expect(start.sun.elevation).toBeCloseTo(DAY.elevation, 6);
    expect(start.sun.azimuth).toBeCloseTo(DAY.azimuth, 6);
    expect(start.night).toBe(0);
    const late = skyAt({ kind: "day", t: 1000 }, DAY, DIP);
    expect(late.sun.elevation).toBeCloseTo(DAY.elevation - PASS_SINK, 6);
    // Never so low it sets in a pass.
    expect(late.night).toBe(0);
  });

  it("sets the sun over the limb in each breather, in view, a few seconds of night, and raises it again", () => {
    const set = skyAt({ kind: "breather", t: SET_END }, DAY, DIP);
    expect(set.sun.elevation).toBeCloseTo(-DIP - BELOW_LIMB, 6);
    expect(set.sun.azimuth).toBeCloseTo(SET_AZIMUTH, 6);
    expect(set.night).toBe(1);
    expect(skyAt({ kind: "breather", t: (SET_END + RISE_START) / 2 }, DAY, DIP).night).toBe(1);
    const risen = skyAt({ kind: "breather", t: BREATHER }, DAY, DIP);
    expect(risen.sun.elevation).toBeCloseTo(DAY.elevation, 6);
    expect(risen.night).toBe(0);
  });

  it("lingers over the limb as it sets: the last few degrees take the most time", () => {
    const over = (t: number) => skyAt({ kind: "breather", t }, DAY, DIP).sun.elevation + DIP;
    // The first half of the sunset covers far more sky than the second.
    const first = over(0) - over(SET_END / 2);
    const second = over(SET_END / 2) - over(SET_END);
    expect(first).toBeGreaterThan(second * 3);
    // Night comes only once the sun is below the limb.
    for (let t = 0; t <= BREATHER; t += 0.1) {
      const s = skyAt({ kind: "breather", t }, DAY, DIP);
      if (s.sun.elevation + DIP > 0) expect(s.night).toBe(0);
    }
  });

  it("calls it night by the sun's height over the limb", () => {
    expect(nightFor({ elevation: -DIP + 1 * DEG, azimuth: 0 }, DIP)).toBe(0);
    expect(nightFor({ elevation: -DIP - 3 * DEG, azimuth: 0 }, DIP)).toBe(1);
    const dusk = nightFor({ elevation: -DIP - 1.2 * DEG, azimuth: 0 }, DIP);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("raises the Moon from under the limb to its height over it", () => {
    expect(moonAt(0, DIP).elevation).toBeLessThan(-DIP);
    expect(moonAt(10000, DIP).elevation).toBeCloseTo(-DIP + MOON_TOP, 6);
    expect(moonAt(30, DIP).elevation).toBeGreaterThan(moonAt(10, DIP).elevation);
  });
});
