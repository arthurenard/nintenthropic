// The crosshair's measurements for each of the player's choices.
import { describe, expect, it } from "vitest";
import { CROSSHAIR_SCALE, crosshairMetrics, type CrosshairStyle } from "./crosshair";

const STANDARD: CrosshairStyle = { size: "standard", highContrast: false };
const LARGE: CrosshairStyle = { size: "large", highContrast: false };

describe("the crosshair's size", () => {
  it("is the Python version's by default: about 22 px across the ring at 1440x900", () => {
    const { unit, weight, thin, outline } = crosshairMetrics(1440, 900, 1, STANDARD);
    expect(unit).toBeCloseTo(0.75 * 1.5, 9);
    expect(weight).toBeCloseTo(2.25, 9);
    expect(thin).toBeCloseTo(1.2375, 9);
    expect(outline).toBe(0);
    // The ring's radius is 20 units.
    expect(20 * unit).toBeCloseTo(22.5, 9);
  });

  it("grows with the window and the pixel ratio", () => {
    const small = crosshairMetrics(1280, 720, 1, STANDARD);
    const retina = crosshairMetrics(1280, 720, 2, STANDARD);
    const large = crosshairMetrics(2560, 1440, 1, STANDARD);
    expect(retina.unit).toBeCloseTo(2 * small.unit, 9);
    expect(large.unit).toBeCloseTo(2 * small.unit, 9);
  });

  it("is half as big again when Large", () => {
    expect(CROSSHAIR_SCALE.large / CROSSHAIR_SCALE.standard).toBe(1.5);
    for (const [width, height, ratio] of [
      [1280, 720, 1],
      [1512, 945, 2],
      [2560, 1440, 1],
      [390, 844, 3],
    ] as const) {
      const standard = crosshairMetrics(width, height, ratio, STANDARD);
      const large = crosshairMetrics(width, height, ratio, LARGE);
      expect(large.unit).toBeCloseTo(1.5 * standard.unit, 9);
      expect(large.weight).toBeCloseTo(1.5 * standard.weight, 9);
      expect(large.thin).toBeCloseTo(1.5 * standard.thin, 9);
    }
  });

  it("never draws a stroke too thin to see, even in a small window", () => {
    const tiny = crosshairMetrics(320, 240, 1, STANDARD);
    expect(tiny.weight).toBe(1.5);
    expect(tiny.thin).toBe(1);
    const tinyLarge = crosshairMetrics(320, 240, 1, LARGE);
    expect(tinyLarge.weight).toBe(2.25);
    expect(tinyLarge.thin).toBe(1.5);
  });
});

describe("High Contrast", () => {
  it("gives every stroke a dark edge, wider on a sharper screen", () => {
    const plain = crosshairMetrics(1440, 900, 1, STANDARD);
    const outlined = crosshairMetrics(1440, 900, 1, { size: "standard", highContrast: true });
    expect(plain.outline).toBe(0);
    expect(outlined.outline).toBeGreaterThan(1);
    expect(outlined.weight).toBe(plain.weight);
    const retina = crosshairMetrics(1440, 900, 2, { size: "standard", highContrast: true });
    expect(retina.outline).toBeGreaterThanOrEqual(2 * outlined.outline - 1e-9);
  });

  it("goes with Large as well", () => {
    const both = crosshairMetrics(1440, 900, 1, { size: "large", highContrast: true });
    const outlined = crosshairMetrics(1440, 900, 1, { size: "standard", highContrast: true });
    expect(both.outline).toBeGreaterThan(outlined.outline);
  });
});
