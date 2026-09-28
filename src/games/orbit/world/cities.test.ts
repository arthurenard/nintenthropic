import { describe, expect, it } from "vitest";
import { lightAround, pickLitRegions } from "./cities";

/** A dark 96 × 48 world with bright patches at the given (lon, lat) degrees. */
function world(patches: [number, number, number][]): Float32Array {
  const w = 96;
  const h = 48;
  const lum = new Float32Array(w * h);
  for (const [lon, lat, v] of patches) {
    const i = Math.floor(((lon + 180) / 360) * w);
    const j = Math.floor(((90 - lat) / 180) * h);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) lum[(j + dj) * w + ((i + di + w) % w)] = v;
  }
  return lum;
}

describe("the night's lit regions", () => {
  it("finds the brightest countries first, well apart", () => {
    const lum = world([
      [-100, 40, 0.8],
      [20, 45, 0.5],
      [120, 30, 0.3],
      [24, 47, 0.5],
    ]);
    const r = pickLitRegions(lum, 96, 48, 3);
    expect(r.length).toBe(3);
    expect(r[0]!.lon).toBeGreaterThan(-110);
    expect(r[0]!.lon).toBeLessThan(-90);
    expect(Math.abs(r[0]!.lat - 40)).toBeLessThan(6);
    // The two patches round (20, 45) are one country.
    expect(Math.abs(r[1]!.lon - 22)).toBeLessThan(8);
    expect(Math.abs(r[2]!.lon - 120)).toBeLessThan(8);
    expect(r[0]!.light).toBeGreaterThan(r[2]!.light);
  });

  it("stays away from where it is told to", () => {
    const lum = world([
      [-100, 40, 0.8],
      [60, 10, 0.2],
    ]);
    const r = pickLitRegions(lum, 96, 48, 2, 7, 25, [[-100, 40]]);
    expect(r.length).toBe(1);
    expect(Math.abs(r[0]!.lon - 60)).toBeLessThan(8);
  });

  it("finds countries as busy as a given one, rather than the densest", () => {
    const lum = world([
      [-100, 40, 1],
      [20, 45, 0.45],
      [120, 30, 0.1],
    ]);
    const like = { light: lightAround(lum, 96, 48, 20, 45) * 1.1, wide: lightAround(lum, 96, 48, 20, 45, 14) };
    const r = pickLitRegions(lum, 96, 48, 3, 7, 25, [], like);
    expect(Math.abs(r[0]!.lon - 20)).toBeLessThan(8);
    // Too dim to stand for it.
    expect(r.some((x) => Math.abs(x.lon - 120) < 8)).toBe(false);
  });

  it("weighs the light round any place as it weighs the regions", () => {
    const lum = world([
      [-100, 40, 0.8],
      [60, 10, 0.2],
    ]);
    const [top] = pickLitRegions(lum, 96, 48, 1);
    expect(lightAround(lum, 96, 48, top!.lon, top!.lat)).toBeCloseTo(top!.light, 5);
    expect(lightAround(lum, 96, 48, 0, -60)).toBe(0);
  });

  it("finds nothing in the dark", () => {
    expect(pickLitRegions(new Float32Array(96 * 48), 96, 48, 3)).toEqual([]);
  });
});
