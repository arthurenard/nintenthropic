import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { centreClear, hiddenFrom, readySpots, shiftCovers, unblockCovers } from "./coverCheck";
import { TownQueries } from "./queries";
import type { TownLayout } from "./town";
import type { Cover } from "../rules/types";

/**
 * A scrap of the right side of Main Street, down −Z: a facade at x = 10
 * with a door opening (z −21.4 … −22.6) and the wall beside it, a porch post
 * at x = 8.6, z = −20.5 standing between the eye and a man at the door, and
 * a corner: a wall running out to x = 9 at z = −40 with an alley behind it.
 */
function street(): TownQueries {
  const root = new Group();
  const mat = new MeshBasicMaterial();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const solids = [
    box(60, 0.2, 120, 0, -0.1, -40), // the street
    box(0.3, 4, 18.6, 10.15, 2, -12.1), // facade, near the player, up to the door
    box(0.3, 4, 17.4, 10.15, 2, -31.3), // facade beyond the door
    box(0.3, 1.6, 1.2, 10.15, 3.2, -22), // over the door
    box(0.15, 3, 0.15, 8.62, 1.5, -20.5), // the porch post
    box(3, 4, 0.3, 10.5, 2, -40), // the corner's wall, out to x = 9
  ];
  root.updateMatrixWorld(true);
  return new TownQueries({ root, solids } as unknown as TownLayout);
}

function cover(id: string, kind: Cover["kind"], emerge: Cover["emerge"], exposed: Cover["exposed"], hidden: Cover["hidden"]): Cover {
  return { id, kind, emerge, level: 0, exposed, hidden, distance: Math.hypot(exposed.x, exposed.z), side: 1, tags: [] };
}

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

describe("covers in the real street", () => {
  const queries = street();
  const door = cover("hotel.door", "door", "step_out", { x: 9.25, y: 0, z: -22 }, { x: 10.6, y: 0, z: -20.8 });
  const corner = cover("hotel.alley", "corner", "lean_right", { x: 8.6, y: 0, z: -40.6 }, { x: 11, y: 0, z: -40.6 });

  it("steps a man clear of a post standing in front of the middle of him", () => {
    expect(centreClear(queries, eye, door.exposed)).toBe(false);
    const { covers, moved } = unblockCovers([door, corner], queries, eye);
    expect(moved).toEqual(["hotel.door"]);
    const p = covers[0]!.exposed;
    expect(centreClear(queries, eye, p)).toBe(true);
    expect(Math.hypot(p.x - 9.25, p.z + 22)).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(covers[1]).toBe(corner);
  });

  it("brings a man out of a doorway from its threshold, not through the wall beside it", () => {
    const [ready] = readySpots([door], queries, eye).map((c) => c.ready!);
    // In the opening, at the facade.
    expect(ready!.x).toBeGreaterThan(9.9);
    expect(ready!.x).toBeLessThan(10.35);
    expect(ready!.z).toBeLessThan(-21.4);
    expect(ready!.z).toBeGreaterThan(-22.6);
  });

  it("brings a man round a corner from its edge, out of sight, not from deep in the alley", () => {
    const [c] = readySpots([corner], queries, eye);
    const ready = c!.ready!;
    expect(hiddenFrom(queries, eye, ready, [1.4, 1.62, 1.85])).toBe(true);
    const fromExposed = Math.hypot(ready.x - corner.exposed.x, ready.z - corner.exposed.z);
    expect(fromExposed).toBeLessThan(1.4);
    expect(fromExposed).toBeGreaterThan(0.3);
  });

  it("keeps a cover he rises from as it is", () => {
    const barrel = cover("street.barrel", "barrel", "rise", { x: 4, y: 0, z: -15 }, { x: 4, y: 0, z: -15 });
    expect(readySpots([barrel], queries, eye)[0]!.ready).toEqual(barrel.exposed);
  });
});
