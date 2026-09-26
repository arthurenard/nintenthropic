import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { bottleSeen, findStand } from "./bottles";
import { TownQueries } from "./queries";
import type { TownLayout } from "./town";

/** A scrap of street: the ground, a crate stack 12 m out, and a post in front of a sign's cap 30 m out. */
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
    box(40, 0.2, 80, 0, -0.1, -30), // the street
    box(1.2, 1.2, 1.2, 4.6, 0.6, -12.3), // crates, top at 1.2 m
    box(1.2, 3, 0.4, 5.9, 1.5, -16.6), // a wall standing in front of the rail behind it
  ];
  root.updateMatrixWorld(true);
  return new TownQueries({ root, solids } as unknown as TownLayout);
}

describe("the bottles' stands", () => {
  const eye = new Vector3(0, 1.7, 0);
  const queries = street();
  const behindWall = new Vector3(5.9, 1.0, -17.5);

  it("knows a bottle set behind something is out of sight", () => {
    expect(bottleSeen(queries, eye, behindWall)).toBe(false);
    expect(bottleSeen(queries, eye, new Vector3(0, 0, -10))).toBe(true);
  });

  it("finds the nearest level top in plain view instead", () => {
    const stand = findStand(queries, eye, behindWall);
    expect(stand).not.toBeNull();
    expect(bottleSeen(queries, eye, stand!)).toBe(true);
    // On something flat and solid: the crates' lid or the street itself.
    expect(Math.abs(queries.groundAt(stand!.x, stand!.z, stand!.y + 0.2) - stand!.y)).toBeLessThan(0.03);
    // Near where it was wanted, seen from the eye.
    const a = behindWall.clone().sub(eye).normalize();
    const b = stand!.clone().sub(eye).normalize();
    expect((Math.acos(Math.min(1, a.dot(b))) * 180) / Math.PI).toBeLessThan(5);
  });

  it("gives up when there is nothing to stand on within reach", () => {
    const sky = new Vector3(0, 60, -30);
    expect(findStand(queries, eye, sky, 1)).toBeNull();
  });
});
