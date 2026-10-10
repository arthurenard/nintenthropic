import { describe, expect, it } from "vitest";
import { QUIET_AFTER, QUIET_EVERY, TileSchedule, joinTiles, tileRects, untile } from "./tiles";
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

describe("which tiles are read", () => {
  /** Reads `frames` camera frames of a picture whose tiles find `hands[i]` hands each; returns the reads per tile. */
  function run(schedule: TileSchedule, hands: number[], frames: number): number[] {
    const reads = hands.map(() => 0);
    for (let f = 0; f < frames; f++) {
      const due = schedule.next();
      schedule.record(due.map((read, i) => (read ? hands[i]! : null)));
      due.forEach((read, i) => (reads[i]! += read ? 1 : 0));
    }
    return reads;
  }

  it("reads every tile on every frame while each has hands, and at the start before anything is known", () => {
    expect(run(new TileSchedule(4), [2, 2, 2, 2], 60)).toEqual([60, 60, 60, 60]);
    expect(run(new TileSchedule(4), [0, 0, 0, 0], QUIET_AFTER)).toEqual([QUIET_AFTER, QUIET_AFTER, QUIET_AFTER, QUIET_AFTER]);
  });

  it("looks at an empty seat only every few frames, and the seats that sit empty on different frames", () => {
    const schedule = new TileSchedule(4);
    const reads = run(schedule, [2, 2, 0, 0], 300);
    expect(reads[0]).toBe(300);
    expect(reads[1]).toBe(300);
    // After the settling frames, an empty tile is read on every QUIET_EVERY-th.
    expect(reads[2]).toBeLessThanOrEqual(QUIET_AFTER + Math.ceil((300 - QUIET_AFTER) / QUIET_EVERY));
    expect(reads[2]).toBeGreaterThanOrEqual(QUIET_AFTER + Math.floor((300 - QUIET_AFTER) / QUIET_EVERY));
    // Never the two empty tiles on the same late frame.
    const late = new TileSchedule(4);
    run(late, [2, 2, 0, 0], 100);
    for (let f = 0; f < 12; f++) {
      const due = late.next();
      late.record(due.map((read, i) => (read ? [2, 2, 0, 0][i]! : null)));
      expect(due[2] && due[3]).toBe(false);
    }
  });

  it("finds a hand raised in a quiet tile within a few frames, then reads that tile every frame again", () => {
    const schedule = new TileSchedule(3);
    run(schedule, [2, 0, 0], 50);
    let waited = 0;
    let found = false;
    while (!found && waited < 20) {
      const due = schedule.next();
      schedule.record(due.map((read, i) => (read ? [2, 2, 0][i]! : null)));
      found = due[1]!;
      waited++;
    }
    expect(found).toBe(true);
    expect(waited).toBeLessThanOrEqual(QUIET_EVERY);
    expect(run(schedule, [2, 2, 0], 10)[1]).toBe(10);
  });

  it("goes on reading a tile for a moment after its hands go, so a hand lost for a frame is not lost for good", () => {
    const schedule = new TileSchedule(1);
    run(schedule, [2], 20);
    expect(run(schedule, [0], QUIET_AFTER - 1)).toEqual([QUIET_AFTER - 1]);
  });

  it("finds a player whose hands were lost for less than a second on the very next frame they come back", () => {
    // Hands out of the picture for 25 reads (opening them to brake, a fast turn, a duck), then back: no read was skipped, so none was late.
    const schedule = new TileSchedule(4);
    run(schedule, [2, 2, 2, 2], 100);
    const lost = run(schedule, [0, 2, 2, 2], 25);
    expect(lost[0]).toBe(25);
    const due = schedule.next();
    expect(due[0]).toBe(true);
  });

  it("holds that grace for about a second at the camera's pace, and an empty seat is quiet soon after", () => {
    expect(QUIET_AFTER).toBeGreaterThanOrEqual(30);
    const schedule = new TileSchedule(2);
    const reads = run(schedule, [2, 0], 300);
    expect(reads[1]).toBeLessThan(300 / 2);
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
