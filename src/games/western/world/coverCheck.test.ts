import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { shiftCovers } from "./coverCheck";
import type { TownQueries } from "./queries";
import type { Cover } from "../rules/types";

const roof: Cover = {
  id: "saloon.roof",
  kind: "roof",
  emerge: "rise",
  level: 2,
  exposed: { x: -7.7, y: 7.15, z: -22.55 },
  hidden: { x: -9.5, y: 7.36, z: -22.55 },
  distance: 23.8,
  side: -1,
  tags: [],
};

/** A town whose floor is the roof at 7.15 m up to z = −26 and the street beyond. */
const town = { groundAt: (_x: number, z: number) => (z > -26 ? 7.15 : 0) } as unknown as TownQueries;
const eye = new Vector3(0, 1.7, 0);

describe("shiftCovers", () => {
  it("moves a cover's two spots together, where the same floor carries it", () => {
    const { covers, shifted } = shiftCovers([roof], town, eye, { "saloon.roof": { dx: 0, dz: -2.6 } });
    expect(shifted).toEqual(["saloon.roof"]);
    expect(covers[0]!.exposed.z).toBeCloseTo(-25.15);
    expect(covers[0]!.hidden.z).toBeCloseTo(-25.15);
    expect(covers[0]!.distance).toBeCloseTo(Math.hypot(7.7, 25.15));
  });

  it("leaves it where the art put it if the move would step off the roof", () => {
    const { covers, shifted } = shiftCovers([roof], town, eye, { "saloon.roof": { dx: 0, dz: -5 } });
    expect(shifted).toEqual([]);
    expect(covers[0]).toBe(roof);
  });
});
