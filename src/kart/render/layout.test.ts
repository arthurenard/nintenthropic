import { describe, expect, it } from "vitest";
import { hudScale, layoutViews, VIEW_GAP, type Rect } from "./layout";

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(r: Rect, w: number, h: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h && r.w > 0 && r.h > 0;
}

describe("layoutViews", () => {
  const sizes: [number, number][] = [
    [1440, 900],
    [900, 1440],
    [1281, 721],
    [1000, 1000],
    [390, 844],
  ];

  it("gives one view the whole canvas", () => {
    expect(layoutViews(1, 1440, 900)).toEqual({ views: [{ x: 0, y: 0, w: 1440, h: 900 }], free: null });
  });

  it("splits two top and bottom on a wide screen", () => {
    const { views } = layoutViews(2, 1440, 900);
    expect(views).toHaveLength(2);
    expect(views[0]!.w).toBe(1440);
    expect(views[1]!.y).toBeGreaterThan(views[0]!.y + views[0]!.h - 1);
    expect(views[0]!.y).toBe(0);
  });

  it("splits two side by side on a tall screen", () => {
    const { views } = layoutViews(2, 900, 1440);
    expect(views[0]!.h).toBe(1440);
    expect(views[1]!.x).toBeGreaterThan(views[0]!.x + views[0]!.w - 1);
  });

  it("makes quadrants for four, in reading order", () => {
    const { views, free } = layoutViews(4, 1440, 900);
    expect(free).toBeNull();
    expect(views).toHaveLength(4);
    expect(views[0]!.x).toBeLessThan(views[1]!.x);
    expect(views[0]!.y).toBe(views[1]!.y);
    expect(views[2]!.y).toBeGreaterThan(views[0]!.y);
    expect(views[2]!.x).toBe(0);
    expect(views[3]!.x).toBe(views[1]!.x);
    expect(views[3]!.y).toBe(views[2]!.y);
  });

  it("leaves the fourth quadrant free for three", () => {
    const { views, free } = layoutViews(3, 1440, 900);
    expect(views).toHaveLength(3);
    expect(free).not.toBeNull();
    // The free quadrant is where a fourth view would be.
    const four = layoutViews(4, 1440, 900).views[3]!;
    expect(free).toEqual(four);
  });

  it("never overlaps, never leaves the canvas, and leaves only the gap between views", () => {
    for (const [w, h] of sizes) {
      for (let n = 1; n <= 4; n++) {
        const { views, free } = layoutViews(n, w, h);
        const all = free ? [...views, free] : views;
        for (const r of all) expect(inside(r, w, h)).toBe(true);
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
        }
        // Every pixel is a view, the free quadrant, or part of a divider.
        const area = all.reduce((sum, r) => sum + r.w * r.h, 0);
        const gaps = w * h - area;
        const maxGaps = (n > 1 ? (w + h) * VIEW_GAP : 0);
        expect(gaps).toBeGreaterThanOrEqual(0);
        expect(gaps).toBeLessThanOrEqual(maxGaps);
      }
    }
  });

  it("copes with nonsense counts", () => {
    expect(layoutViews(0, 100, 100).views).toEqual([]);
    expect(layoutViews(9, 400, 300).views).toHaveLength(4);
    expect(layoutViews(2, 0, 0).views).toHaveLength(2);
  });
});

describe("hudScale", () => {
  it("is about 1 for a full 1440x900 view and smaller for a quadrant", () => {
    expect(hudScale(1440, 900)).toBeGreaterThan(0.95);
    expect(hudScale(1440, 900)).toBeLessThanOrEqual(1.5);
    expect(hudScale(720, 450)).toBeLessThan(hudScale(1440, 900));
  });
  it("never goes illegibly small", () => {
    expect(hudScale(100, 80)).toBeGreaterThanOrEqual(0.5);
  });
});
