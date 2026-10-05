import { describe, expect, it } from "vitest";
import { angleDiff, clamp, damp, dampAngle, fbm2, formatRaceTime, hash2, noise2, ordinal, smoothstep, wrapAngle } from "./math";

describe("angles", () => {
  it("wraps into -PI..PI", () => {
    expect(Math.abs(wrapAngle(7))).toBeLessThanOrEqual(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 10);
    expect(wrapAngle(2 * Math.PI + 0.25)).toBeCloseTo(0.25, 10);
    expect(wrapAngle(-2 * Math.PI - 0.25)).toBeCloseTo(-0.25, 10);
  });
  it("takes the short way round", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDiff(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 10);
    expect(angleDiff(-3.0, 3.0)).toBeCloseTo(6 - 2 * Math.PI, 10);
  });
  it("damps across the seam without spinning the long way", () => {
    const a = dampAngle(3.0, -3.0, 10, 0.05);
    // 3.0 → -3.0 is a short step forward through PI, so the angle rises past 3.0.
    expect(a).toBeGreaterThan(3.0);
  });
});

describe("damp", () => {
  it("closes the same distance however the time is sliced", () => {
    const once = damp(0, 1, 8, 0.1);
    let stepped = 0;
    for (let i = 0; i < 10; i++) stepped = damp(stepped, 1, 8, 0.01);
    expect(stepped).toBeCloseTo(once, 6);
  });
  it("never overshoots", () => {
    expect(damp(0, 1, 100, 10)).toBeLessThanOrEqual(1);
  });
});

describe("smoothstep and clamp", () => {
  it("is 0, 0.5, 1", () => {
    expect(smoothstep(0, 2, -1)).toBe(0);
    expect(smoothstep(0, 2, 1)).toBeCloseTo(0.5, 10);
    expect(smoothstep(0, 2, 3)).toBe(1);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe("noise", () => {
  it("is repeatable and bounded", () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    for (let i = 0; i < 200; i++) {
      const v = fbm2(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(noise2(2, 3)).toBeCloseTo(hash2(2, 3), 10);
  });
});

describe("text", () => {
  it("formats race times", () => {
    expect(formatRaceTime(48.31)).toBe("0:48.3");
    expect(formatRaceTime(0)).toBe("0:00.0");
    expect(formatRaceTime(125.96)).toBe("2:05.9");
    expect(formatRaceTime(61, 0)).toBe("1:01");
  });
  it("says places", () => {
    expect(ordinal(1)).toEqual({ number: "1", suffix: "st" });
    expect(ordinal(2).suffix).toBe("nd");
    expect(ordinal(3).suffix).toBe("rd");
    expect(ordinal(4).suffix).toBe("th");
    expect(ordinal(11).suffix).toBe("th");
    expect(ordinal(12).suffix).toBe("th");
    expect(ordinal(21).suffix).toBe("st");
  });
});
