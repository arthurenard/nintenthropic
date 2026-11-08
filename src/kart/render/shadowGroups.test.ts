import { describe, expect, it } from "vitest";
import { shadowGroups } from "./shadowGroups";

const at = (x: number, z: number, y = 0) => ({ x, y, z });

describe("shadowGroups", () => {
  it("gives every view its own pass at spread 0, aimed at its own kart", () => {
    const g = shadowGroups([at(0, 0), at(1, 0), at(2, 0)], 0);
    expect(g.map((x) => x.views)).toEqual([[0], [1], [2]]);
    expect(g[1]!.centre).toEqual(at(1, 0));
  });

  it("puts karts on one grid in one group, aimed between them", () => {
    const g = shadowGroups([at(0, 0), at(6, 0), at(0, 6), at(6, 6)], 12);
    expect(g).toHaveLength(1);
    expect(g[0]!.views).toEqual([0, 1, 2, 3]);
    expect(g[0]!.centre).toEqual(at(3, 3));
  });

  it("keeps a far kart out of the group and leads each group with its first view", () => {
    const g = shadowGroups([at(0, 0), at(200, 0), at(5, 0), at(210, 0)], 20);
    expect(g.map((x) => x.views)).toEqual([[0, 2], [1, 3]]);
  });

  it("never lets a group spread wider than asked", () => {
    const g = shadowGroups([at(0, 0), at(10, 0), at(20, 0), at(30, 0)], 12);
    expect(g.map((x) => x.views)).toEqual([[0, 1], [2, 3]]);
  });

  it("merges the closest groups when there may be fewer passes", () => {
    const g = shadowGroups([at(0, 0), at(100, 0), at(110, 0), at(500, 0)], 0, 2);
    expect(g.map((x) => x.views)).toEqual([[0, 1, 2], [3]]);
  });

  it("makes one pass of everything at one group", () => {
    const g = shadowGroups([at(0, 0), at(300, 0), at(600, 0)], 0, 1);
    expect(g).toHaveLength(1);
    expect(g[0]!.views).toEqual([0, 1, 2]);
  });
});
