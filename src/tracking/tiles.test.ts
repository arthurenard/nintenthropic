import { describe, expect, it } from "vitest";
import { joinTiles, tileRects, untile } from "./tiles";
import type { Landmark, SeenHand } from "./types";

/** A hand whose 21 points sit at (x, y) in its own picture, a little spread out, with a score. */
function hand(x: number, y: number, score = 0.9, spread = 0.05): SeenHand {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * spread * 0.1, y: y - (i % 4) * spread * 0.2, z: 0.1 }));
  return { landmarks, world: landmarks.map((p) => ({ ...p })), handedness: null, score };
}

describe("the tiles a picture is cut into", () => {
  it("covers the picture, each tile reaching a little into its neighbours", () => {
    const rects = tileRects(4, 1920, 1080);
    expect(rects).toHaveLength(4);
    expect(rects[0]!.x).toBe(0);
    expect(rects[3]!.x + rects[3]!.width).toBe(1920);
    for (let i = 1; i < 4; i++) {
      // Each starts before the one before it ends.
      expect(rects[i]!.x).toBeLessThan(rects[i - 1]!.x + rects[i - 1]!.width);
    }
    expect(rects.every((rect) => rect.y === 0 && rect.height === 1080)).toBe(true);
    // The middle ones are the quarter and the overlap either side; the ends only on the inside.
    expect(rects[1]!.width).toBeGreaterThan(rects[0]!.width);
  });
});

describe("a hand found in a tile", () => {
  it("is put back where it is in the whole picture, depth in the picture's own width", () => {
    const tile = { x: 480, y: 0, width: 600, height: 1080 };
    const put = untile(hand(0.5, 0.5), tile, 1920, 1080);
    expect(put.landmarks[0]!.x).toBeCloseTo((480 + 0.5 * 600) / 1920, 5);
    expect(put.landmarks[0]!.y).toBeCloseTo(0.5, 5);
    expect(put.landmarks[0]!.z).toBeCloseTo((0.1 * 600) / 1920, 5);
    // The metric points are not a picture's, and stay as they were.
    expect(put.world[0]).toEqual(hand(0.5, 0.5).world[0]);
  });
});

describe("what the tiles found, joined", () => {
  const rects = tileRects(4, 1920, 1080);

  it("is every hand, left to right across the picture", () => {
    const joined = joinTiles(
      [
        { tile: rects[2]!, hands: [hand(0.5, 0.5)] },
        { tile: rects[0]!, hands: [hand(0.3, 0.5), hand(0.8, 0.5)] },
      ],
      1920,
      1080,
    );
    expect(joined).toHaveLength(3);
    const xs = joined.map((one) => one.landmarks[0]!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("keeps a hand two tiles both saw once, the surer reading", () => {
    // The same hand on the line between the first two tiles, as each tile sees it.
    const a = rects[0]!;
    const b = rects[1]!;
    const sameX = 0.26; // the whole picture's, 0..1
    const inA = hand((sameX * 1920 - a.x) / a.width, 0.5, 0.7);
    const inB = hand((sameX * 1920 - b.x) / b.width, 0.5, 0.95);
    const joined = joinTiles(
      [
        { tile: a, hands: [inA] },
        { tile: b, hands: [inB] },
      ],
      1920,
      1080,
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]!.score).toBe(0.95);
  });

  it("keeps two different hands side by side", () => {
    const a = rects[1]!;
    const joined = joinTiles([{ tile: a, hands: [hand(0.2, 0.5), hand(0.8, 0.5)] }], 1920, 1080);
    expect(joined).toHaveLength(2);
  });

  it("is nothing when nothing was found", () => {
    expect(joinTiles(rects.map((tile) => ({ tile, hands: [] })), 1920, 1080)).toEqual([]);
  });
});
