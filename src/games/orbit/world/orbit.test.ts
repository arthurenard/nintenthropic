import { describe, expect, it } from "vitest";
import { BREATHER } from "../rules/tuning";
import { BELOW_LIMB, monotone, moonAt, MOON_TOP, nightFor, PASS_SINK, RISE_START, SET_AZIMUTH, SET_END, skyAt } from "./orbit";

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

  it("starts each breather where the pass left the sun, and ends it where the next begins", () => {
    for (const after of [10, 60, 400]) {
      const end = skyAt({ kind: "day", t: after }, DAY, DIP).sun;
      const start = skyAt({ kind: "breather", t: 0, after }, DAY, DIP).sun;
      expect(start.elevation).toBeCloseTo(end.elevation, 6);
      expect(start.azimuth).toBeCloseTo(end.azimuth, 6);
    }
    const last = skyAt({ kind: "breather", t: BREATHER, after: 60 }, DAY, DIP).sun;
    expect(last.elevation).toBeCloseTo(DAY.elevation, 6);
    expect(last.azimuth).toBeCloseTo(DAY.azimuth, 6);
  });

  it("sets the sun over the limb in each breather, in view, a few seconds of night, and raises it again", () => {
    const set = skyAt({ kind: "breather", t: SET_END }, DAY, DIP);
    expect(set.sun.elevation).toBeCloseTo(-DIP - BELOW_LIMB, 6);
    expect(set.sun.azimuth).toBeCloseTo(SET_AZIMUTH, 6);
    expect(set.night).toBe(1);
    expect(skyAt({ kind: "breather", t: (SET_END + RISE_START) / 2 }, DAY, DIP).night).toBe(1);
    // Full night for a couple of seconds at least.
    let dark = 0;
    for (let t = 0; t <= BREATHER; t += 0.01) if (skyAt({ kind: "breather", t }, DAY, DIP).night === 1) dark += 0.01;
    expect(dark).toBeGreaterThan(2);
    const risen = skyAt({ kind: "breather", t: BREATHER }, DAY, DIP);
    expect(risen.night).toBe(0);
  });

  it("lingers at the limb as it sets and rises: the last degrees take the time, and it never bobs back", () => {
    const over = (t: number) => skyAt({ kind: "breather", t }, DAY, DIP).sun.elevation + DIP;
    // More than a second within a few degrees of the limb, going down.
    let near = 0;
    for (let t = 0; t <= SET_END; t += 0.01) if (Math.abs(over(t)) < 3 * DEG) near += 0.01;
    expect(near).toBeGreaterThan(1.2);
    for (let t = 0.01; t <= SET_END; t += 0.01) expect(over(t)).toBeLessThanOrEqual(over(t - 0.01) + 1e-9);
    for (let t = RISE_START + 0.01; t <= BREATHER; t += 0.01) expect(over(t)).toBeGreaterThanOrEqual(over(t - 0.01) - 1e-9);
    // Night comes only once the sun is below the limb.
    for (let t = 0; t <= BREATHER; t += 0.1) {
      const s = skyAt({ kind: "breather", t }, DAY, DIP);
      if (s.sun.elevation + DIP > 0) expect(s.night).toBe(0);
    }
  });

  it("draws a monotone curve through its keys", () => {
    const keys: [number, number][] = [
      [0, 10],
      [1, 2],
      [2, 1],
      [3, 1],
      [4, 5],
    ];
    for (const [t, v] of keys) expect(monotone(keys, t)).toBeCloseTo(v, 9);
    for (let t = 0; t < 2; t += 0.01) expect(monotone(keys, t + 0.01)).toBeLessThanOrEqual(monotone(keys, t) + 1e-9);
    for (let t = 2; t <= 3; t += 0.1) expect(monotone(keys, t)).toBeCloseTo(1, 9);
    expect(monotone(keys, -1)).toBe(10);
    expect(monotone(keys, 9)).toBe(5);
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
