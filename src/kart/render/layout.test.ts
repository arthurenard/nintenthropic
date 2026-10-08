import { describe, expect, it } from "vitest";
import { clearance, hudScale, layoutViews, mapPlacement, VIEW_GAP, type Rect } from "./layout";

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

describe("mapPlacement", () => {
  const sizes: [number, number][] = [
    [1920, 1080],
    [1440, 900],
    [1281, 721],
    [900, 1440],
    [390, 844],
  ];
  const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  it("has no map for no views", () => {
    expect(mapPlacement(layoutViews(0, 1440, 900))).toBeNull();
  });

  it("puts the map bottom left with one view", () => {
    const p = mapPlacement(layoutViews(1, 1920, 1080))!;
    expect(p.mode).toBe("corner");
    expect(p.rect.x).toBeLessThan(60);
    expect(p.rect.y + p.rect.h).toBeGreaterThan(1080 - 60);
    expect(p.strip).toBeNull();
  });

  it("puts the map on the right edge, centred on the split, with two stacked views", () => {
    const layout = layoutViews(2, 1920, 1080);
    const p = mapPlacement(layout)!;
    const split = layout.views[0]!.h + VIEW_GAP / 2;
    expect(p.mode).toBe("edge");
    expect(Math.abs(centre(p.rect).y - split)).toBeLessThan(1);
    expect(p.rect.x + p.rect.w).toBeGreaterThan(1920 - 40);
    expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(1920);
    // It straddles the split: part over each view.
    expect(p.rect.y).toBeLessThan(layout.views[0]!.h);
    expect(p.rect.y + p.rect.h).toBeGreaterThan(layout.views[1]!.y);
    expect(p.strip).toBeNull();
  });

  it("puts the map in the middle with two side-by-side views", () => {
    const layout = layoutViews(2, 900, 1440);
    const p = mapPlacement(layout)!;
    expect(p.mode).toBe("centre");
    expect(Math.abs(centre(p.rect).x - (layout.views[0]!.w + VIEW_GAP / 2))).toBeLessThan(1);
    expect(Math.abs(centre(p.rect).y - 720)).toBeLessThan(1);
  });

  it("gives the free quadrant, and its standings, to three views", () => {
    const layout = layoutViews(3, 1920, 1080);
    const p = mapPlacement(layout)!;
    expect(p.mode).toBe("free");
    expect(p.rect).toEqual(layout.free);
  });

  it("puts a small map and a standings strip where four quadrants meet", () => {
    const layout = layoutViews(4, 1920, 1080);
    const p = mapPlacement(layout, 1.5, 8)!;
    const junction = { x: layout.views[0]!.w + VIEW_GAP / 2, y: layout.views[0]!.h + VIEW_GAP / 2 };
    expect(p.mode).toBe("centre");
    expect(Math.abs(centre(p.rect).x - junction.x)).toBeLessThan(1);
    expect(Math.abs(centre(p.rect).y - junction.y)).toBeLessThan(1);
    expect(p.strip).not.toBeNull();
    // Small: well under a third of the screen each way, but big enough to read from a sofa.
    expect(p.rect.w).toBeLessThan(1920 / 3);
    expect(p.rect.h).toBeLessThan(1080 / 3);
    expect(p.canvas!.w).toBeGreaterThanOrEqual(150);
  });

  it("grows with the screen", () => {
    const small = mapPlacement(layoutViews(4, 1280, 720))!;
    const big = mapPlacement(layoutViews(4, 2560, 1440))!;
    expect(big.canvas!.w).toBeGreaterThan(small.canvas!.w);
    const one = mapPlacement(layoutViews(1, 1280, 720))!;
    const oneBig = mapPlacement(layoutViews(1, 2560, 1440))!;
    expect(oneBig.canvas!.w).toBeGreaterThan(one.canvas!.w);
  });

  it("always fits on the canvas and never swallows it", () => {
    for (const [w, h] of sizes) {
      for (let n = 1; n <= 4; n++) {
        const p = mapPlacement(layoutViews(n, w, h), 1.4, 8)!;
        expect(p.rect.x).toBeGreaterThanOrEqual(0);
        expect(p.rect.y).toBeGreaterThanOrEqual(0);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(w + 0.5);
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(h + 0.5);
        if (p.mode !== "free") {
          expect(p.rect.w).toBeLessThanOrEqual(w * 0.5 + 0.5);
          expect(p.rect.h).toBeLessThanOrEqual(h * 0.5 + 0.5);
        }
      }
    }
  });
});

describe("clearance", () => {
  const view = { x: 0, y: 0, w: 958, h: 538 };

  it("leaves a view alone when the map is nowhere near its furniture", () => {
    expect(clearance(view, { x: 700, y: 0, w: 200, h: 100 }, 0.63)).toEqual({ place: 0, lap: 0 });
    expect(clearance(view, { x: 1500, y: 800, w: 200, h: 100 }, 0.63)).toEqual({ place: 0, lap: 0 });
  });

  it("moves the place left of a map that sits over the view's bottom right", () => {
    const card = { x: 740, y: 425, w: 440, h: 230 };
    const c = clearance(view, card, 0.63);
    expect(c.place).toBeGreaterThan(958 - 740);
    expect(c.lap).toBe(0);
  });

  it("moves the lap panel right of a map over the view's top left", () => {
    const quadrant = { x: 962, y: 541, w: 958, h: 539 };
    const card = { x: 740, y: 425, w: 440, h: 230 };
    const c = clearance(quadrant, card, 0.63);
    expect(c.lap).toBeGreaterThan(1180 - 962);
    expect(c.place).toBe(0);
  });
});
