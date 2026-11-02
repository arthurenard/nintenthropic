import { describe, expect, it } from "vitest";
import { EDGE, edgeWay, nearEdge } from "./edges";
import { Rig, wheelHands } from "./testHands";

const WIDE = 16 / 9;
const WHOLE = [0, 1] as const;

describe("hands near the edge of the picture", () => {
  it("leaves a hand well inside alone", () => {
    expect(nearEdge({ x: 0.5, y: 0.45, size: 0.12 }, WHOLE, WIDE)).toBeNull();
    expect(nearEdge({ x: 0.3, y: 0.5, size: 0.12 }, WHOLE, WIDE)).toBeNull();
  });

  it("says to move back in, as the player sees themself: a fist near the right edge moves left", () => {
    expect(nearEdge({ x: 0.95, y: 0.45, size: 0.12 }, WHOLE, WIDE)?.way).toBe("left");
    expect(nearEdge({ x: 0.05, y: 0.45, size: 0.12 }, WHOLE, WIDE)?.way).toBe("right");
    expect(nearEdge({ x: 0.5, y: 0.06, size: 0.12 }, WHOLE, WIDE)?.way).toBe("down");
    expect(nearEdge({ x: 0.5, y: 0.94, size: 0.12 }, WHOLE, WIDE)?.way).toBe("up");
  });

  it("measures the margin in hand sizes, so a hand near the camera is warned further from the edge", () => {
    // 0.14 picture heights from the right edge.
    const x = 1 - 0.14 / WIDE;
    expect(nearEdge({ x, y: 0.45, size: 0.08 }, WHOLE, WIDE)).toBeNull();
    expect(nearEdge({ x, y: 0.45, size: 0.16 }, WHOLE, WIDE)?.way).toBe("left");
    // A tiny, far hand still gets the least margin.
    expect(nearEdge({ x: 1 - (EDGE.least * 0.9) / WIDE, y: 0.45, size: 0.01 }, WHOLE, WIDE)?.way).toBe("left");
  });

  it("goes by the player's own column of a shared camera", () => {
    const second = [0.25, 0.5] as const;
    expect(nearEdge({ x: 0.375, y: 0.45, size: 0.06 }, second, WIDE)).toBeNull();
    expect(nearEdge({ x: 0.48, y: 0.45, size: 0.06 }, second, WIDE)?.way).toBe("left");
    expect(nearEdge({ x: 0.27, y: 0.45, size: 0.06 }, second, WIDE)?.way).toBe("right");
  });

  it("is surer the nearer it gets", () => {
    const far = nearEdge({ x: 1 - 0.1 / WIDE, y: 0.45, size: 0.12 }, WHOLE, WIDE)!;
    const close = nearEdge({ x: 1 - 0.02 / WIDE, y: 0.45, size: 0.12 }, WHOLE, WIDE)!;
    expect(close.room).toBeLessThan(far.room);
    expect(nearEdge({ x: 1.02, y: 0.45, size: 0.12 }, WHOLE, WIDE)!.room).toBe(0);
  });

  it("puts a hand that has just gone out first, and forgets it after a while", () => {
    const inside = { reading: { x: 0.05, y: 0.45, size: 0.12 }, ago: 0, present: true };
    const out = { reading: { x: 0.96, y: 0.45, size: 0.12 }, ago: 0.6, present: false };
    expect(edgeWay([inside, out], WHOLE, WIDE)).toBe("left");
    expect(edgeWay([inside, { ...out, ago: EDGE.gone + 0.1 }], WHOLE, WIDE)).toBe("right");
    expect(edgeWay([{ reading: null, ago: Infinity, present: false }], WHOLE, WIDE)).toBeNull();
  });
});

describe("the wheel says which way to move", () => {
  it("says nothing for a wheel held in the middle", () => {
    const rig = new Rig();
    expect(rig.wheel(1, { angle: 0 }).status.edge).toBeNull();
  });

  it("says to move left as the wheel drifts to the right edge, before a hand is lost", () => {
    const rig = new Rig();
    rig.wheel(0.5, { angle: 0 });
    // Shuffling right over a second: the right fist ends near the edge, still in the picture.
    const out = rig.run(1.5, (t) => wheelHands({ angle: 0, centre: [0.5 + 0.34 * Math.min(1, t), 0.45] }));
    expect(out.status.hands).toBe(2);
    expect(out.status.edge).toBe("left");
  });

  it("still says it while the hand that went out is missing, then hands over to the lost hands", () => {
    const rig = new Rig();
    rig.wheel(0.5, { angle: 0, centre: [0.84, 0.45] });
    // The right fist goes out of the picture; the left one stays.
    const [left] = wheelHands({ angle: 0, centre: [0.84, 0.45] });
    const one = rig.hold(0.6, [left]);
    expect(one.status.hands).toBe(1);
    expect(one.status.edge).toBe("left");
    expect(rig.empty(EDGE.gone + 0.5).status.edge).toBeNull();
  });

  it("goes by the player's column with several on one camera", () => {
    const rig = new Rig({ seat: { index: 0, of: 2 } });
    expect(rig.wheel(0.6, { angle: 0, centre: [0.25, 0.45], span: 0.3 }).status.edge).toBeNull();
    // Edging toward the neighbour's column: the right fist nears the line down the middle.
    const out = rig.run(1.5, (t) => wheelHands({ angle: 0, centre: [0.25 + 0.15 * Math.min(1, t), 0.45], span: 0.3 }));
    expect(out.status.edge).toBe("left");
  });
});
