import { describe, expect, it } from "vitest";
import { seenStretch } from "./duckPath";

/** A river along x, a node every 25 m. */
const river = Array.from({ length: 11 }, (_, i) => ({ x: i * 25, y: 0, z: 0 }));
const along = (p: { x: number }) => p.x;

describe("the duck's swim", () => {
  it("starts where the duck first comes out from behind the bank", () => {
    const out = seenStretch(river, (p) => along(p) >= 60);
    expect(out[0]!.x).toBeGreaterThanOrEqual(60);
    expect(out[0]!.x).toBeLessThan(62.5);
    // The art's own nodes after the cut are kept.
    expect(out.slice(1).map((p) => p.x)).toEqual([75, 100, 125, 150, 175, 200, 225, 250]);
  });

  it("ends where it is last seen", () => {
    const out = seenStretch(river, (p) => along(p) <= 110);
    expect(out[0]).toEqual(river[0]);
    expect(out[out.length - 1]!.x).toBeGreaterThan(108);
    expect(out[out.length - 1]!.x).toBeLessThanOrEqual(110);
    expect(out.length).toBeLessThanOrEqual(6);
  });

  it("is left as it was when seen end to end, or never", () => {
    expect(seenStretch(river, () => true)).toEqual(river);
    expect(seenStretch(river, () => false)).toEqual(river);
  });

  it("never gives a zero-length step", () => {
    for (const from of [50, 60, 75]) {
      const out = seenStretch(river, (p) => along(p) >= from && along(p) <= 200);
      for (let i = 1; i < out.length; i++) expect(Math.hypot(out[i]!.x - out[i - 1]!.x, out[i]!.z - out[i - 1]!.z)).toBeGreaterThan(0.01);
    }
  });
});
