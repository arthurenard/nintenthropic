import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { bottleSeen, clearOfThePicture, findStand } from "./bottles";
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

describe("the camera picture's corner", () => {
  const eye = new Vector3(0, 1.7, 0);
  const turn = new Quaternion();
  const fov = 45;
  /** A spot seen at the given place in the view (x in half-heights, y as -1..1), 8 m out. */
  const seenAt = (x: number, y: number) => {
    const t = Math.tan((fov * Math.PI) / 360);
    return new Vector3(x * t, y * t, -1).setLength(8).add(eye);
  };
  const whereSeen = (p: Vector3) => {
    const v = p.clone().sub(eye);
    const t = Math.tan((fov * Math.PI) / 360);
    return { x: v.x / -v.z / t, y: v.y / -v.z / t };
  };

  it("lifts a spot low in the lower-left corner, along the same sideways angle", () => {
    const lifted = clearOfThePicture(eye, turn, fov, seenAt(-0.88, -0.47));
    expect(lifted).not.toBeNull();
    const at = whereSeen(lifted!);
    expect(at.x).toBeCloseTo(-0.88, 3);
    expect(at.y).toBeGreaterThan(-0.3);
  });

  it("leaves every other spot where the art put it", () => {
    for (const [x, y] of [[-0.88, -0.03], [0, -0.54], [0.88, -0.47], [-1.9, -0.47], [-0.2, -0.47]] as const) {
      expect(clearOfThePicture(eye, turn, fov, seenAt(x, y))).toBeNull();
    }
  });
});
