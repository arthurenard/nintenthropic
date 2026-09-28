import { describe, expect, it } from "vitest";
import { designPanes } from "./layout";
import { arcTo, insidePane, positionAt, rebase, strikeOf, velocityAt } from "./motion";
import { add, distance, scale, sub, v3 } from "./vec";

const panes = designPanes();
const centre = panes.find((p) => p.id === 0)!;

describe("an arc", () => {
  it("reaches its mark on time, however it bends", () => {
    const from = v3(20, 10, -100);
    const to = v3(0.1, -0.3, -1.4);
    const m = arcTo(from, to, 5, 6, v3(0.4, -0.2, 0.1));
    const p = positionAt(m, 11);
    expect(distance(p, to)).toBeLessThan(1e-9);
    expect(distance(positionAt(m, 5), from)).toBeLessThan(1e-9);
  });

  it("curves: halfway along it is off the straight line", () => {
    const from = v3(0, 0, -100);
    const to = v3(0, 0, 0);
    const m = arcTo(from, to, 0, 5, v3(1, 0, 0));
    const mid = positionAt(m, 2.5);
    expect(Math.abs(mid.x)).toBeGreaterThan(0.5);
  });

  it("carries on from a split with the same velocity, plus the kick", () => {
    const m = arcTo(v3(10, 0, -90), v3(0, 0, -1), 0, 8, v3(0.3, 0, 0));
    const kick = v3(0, 1.5, 0);
    const piece = rebase(m, 3, v3(0.2, 0, 0), kick);
    const before = velocityAt(m, 3);
    const after = velocityAt(piece, 3);
    expect(distance(sub(after, before), kick)).toBeLessThan(1e-9);
    expect(distance(positionAt(piece, 3), add(positionAt(m, 3), v3(0.2, 0, 0)))).toBeLessThan(1e-9);
    expect(piece.a).toEqual(m.a);
  });
});

describe("the strike", () => {
  it("finds the pane a fragment is sent at, and when", () => {
    const from = scale(centre.center, 60);
    const m = arcTo(from, centre.center, 0, 4, v3(0.2, 0.1, 0));
    const s = strikeOf(m, 0, 10, panes);
    expect(s?.pane).toBe(0);
    expect(s!.time).toBeCloseTo(4, 3);
    expect(s!.speed).toBeGreaterThan(10);
  });

  it("finds none for a fragment that goes by", () => {
    const m = arcTo(v3(0, 0, -100), v3(9, 0, 2), 0, 5, v3(0, 0, 0));
    expect(strikeOf(m, 0, 10, panes)).toBeNull();
  });

  it("finds none before `from`, nor past the horizon", () => {
    const m = arcTo(scale(centre.center, 60), centre.center, 0, 4, v3());
    expect(strikeOf(m, 0, 2, panes)).toBeNull();
    expect(strikeOf(m, 4.5, 5, panes)).toBeNull();
  });

  it("knows the inside of a pane from the outside", () => {
    const side = panes.find((p) => p.id === 3)!;
    expect(insidePane(side, side.center)).toBe(true);
    expect(insidePane(side, add(side.center, v3(0, 5, 0)))).toBe(false);
    expect(insidePane(centre, add(centre.center, scale(v3(1, 0, 0), centre.radius * 0.9)))).toBe(true);
  });
});
