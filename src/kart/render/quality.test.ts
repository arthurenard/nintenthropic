import { describe, expect, it } from "vitest";
import { FAR_DISTANCE } from "./kartSpec";
import { QUALITY, TIERS, capTier, hudBlurFor, lowerTier, pixelRatioFor } from "./quality";

describe("the quality tiers", () => {
  it("are ordered low to high, and each costs less than the one above", () => {
    expect(TIERS).toEqual(["low", "medium", "high"]);
    for (let i = 1; i < TIERS.length; i++) {
      const lo = QUALITY[TIERS[i - 1]!];
      const hi = QUALITY[TIERS[i]!];
      expect(lo.particles).toBeLessThan(hi.particles);
      expect(lo.shadowMap).toBeLessThan(hi.shadowMap);
      expect(lo.pixelRatioCap).toBeLessThan(hi.pixelRatioCap);
      // Fewer draw calls where the machine has less to spare: karts welded sooner, the ground in bigger tiles.
      expect(lo.kartDetail).toBeLessThan(hi.kartDetail);
      expect(lo.groundTile).toBeGreaterThan(hi.groundTile);
    }
  });

  it("keep the high tier's kart detail where the models say it is", () => {
    expect(QUALITY.high.kartDetail).toBe(FAR_DISTANCE);
  });

  it("step down one at a time, and stop at the bottom", () => {
    expect(lowerTier("high")).toBe("medium");
    expect(lowerTier("medium")).toBe("low");
    expect(lowerTier("low")).toBeNull();
  });

  it("are held under a ceiling, never raised by one", () => {
    expect(capTier("high", "medium")).toBe("medium");
    expect(capTier("medium", "high")).toBe("medium");
    expect(capTier("low", "medium")).toBe("low");
    expect(capTier("high", null)).toBe("high");
    expect(capTier("high", undefined)).toBe("high");
  });
});

describe("the HUD's glass beside the hand tracker", () => {
  it("blurs for one wheel player or none, and stays flat from two wheel players on", () => {
    expect(hudBlurFor(true, {})).toBe(true);
    expect(hudBlurFor(true, { 0: "keyboard" })).toBe(true);
    expect(hudBlurFor(true, { 0: "wheel" })).toBe(true);
    expect(hudBlurFor(true, { 0: "wheel", 1: "keyboard" })).toBe(true);
    expect(hudBlurFor(true, { 0: "wheel", 1: "wheel" })).toBe(false);
    expect(hudBlurFor(true, { 0: "wheel", 1: "wheel", 2: "wheel", 3: "wheel" })).toBe(false);
  });

  it("never turns a tier's missing blur on", () => {
    expect(hudBlurFor(false, { 0: "wheel" })).toBe(false);
    expect(QUALITY.low.glassBlur).toBe(false);
  });
});

describe("the pixel budget", () => {
  it("leaves an ordinary window as it was and holds a TV or a 5K display to the tier's budget", () => {
    // 1440 x 900 at 2x: 5.2 million pixels, under the high tier's budget.
    expect(pixelRatioFor(2, QUALITY.high, 1, 1440, 900)).toBe(2);
    expect(pixelRatioFor(1, QUALITY.high, 1, 1920, 1080)).toBe(1);
    // A 4K television at 1x (3840 x 2160 css pixels) and a 5K display at 2x (2560 x 1440 css).
    for (const [w, h, dpr] of [[3840, 2160, 1], [2560, 1440, 2]] as const) {
      const ratio = pixelRatioFor(dpr, QUALITY.high, 1, w, h);
      expect(ratio).toBeLessThan(dpr);
      expect(w * h * ratio * ratio).toBeLessThanOrEqual(QUALITY.high.pixelBudget * 1.0001);
    }
  });

  it("still lets each step of dynamic resolution take pixels away", () => {
    const full = pixelRatioFor(1, QUALITY.high, 1, 3840, 2160);
    expect(pixelRatioFor(1, QUALITY.high, 0.8, 3840, 2160)).toBeCloseTo(full * 0.8, 6);
    expect(pixelRatioFor(1, QUALITY.high, 0.01, 3840, 2160)).toBe(0.5);
  });

  it("is smaller for each lesser tier", () => {
    for (let i = 1; i < TIERS.length; i++) expect(QUALITY[TIERS[i - 1]!].pixelBudget).toBeLessThan(QUALITY[TIERS[i]!].pixelBudget);
  });
});
