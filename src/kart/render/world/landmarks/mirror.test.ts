import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../builder";
import { mirrorModel } from "./mirror";
import type { LandmarkModel } from "./types";

/** The normal a triangle's winding gives (counter-clockwise from the front), to check it still agrees with the stored one. */
function windingNormal(b: MeshBuilder, tri: number): Vector3 {
  const p = b.position.slice(tri * 9, tri * 9 + 9);
  const e1 = new Vector3(p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!);
  const e2 = new Vector3(p[6]! - p[0]!, p[7]! - p[1]!, p[8]! - p[2]!);
  return e1.cross(e2).normalize();
}

describe("a landmark model in a mirror", () => {
  const lit = new MeshBuilder();
  lit.tri([1, 0, 0], [3, 0, 1], [1, 2, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const model: LandmarkModel = {
    lit,
    halos: [{ x: 2, y: 1, z: 0, size: 1, colour: [1, 1, 1], alpha: 1 }],
    moving: [
      {
        lit,
        pivot: [2, 1, 0],
        update(_t: number, part: Object3D) {
          part.rotation.z = 0.5;
          part.position.set(1, 0, 0);
        },
      },
    ],
  };

  it("is the original reflected across x = 0: positions and normals negated in x, each corner keeping its colour", () => {
    const m = mirrorModel(model);
    const a = [...lit.position];
    // The winding swaps the second and third corners.
    expect(m.lit.position.slice(0, 3)).toEqual([-a[0]!, a[1]!, a[2]!]);
    expect(m.lit.position.slice(3, 6)).toEqual([-a[6]!, a[7]!, a[8]!]);
    expect(m.lit.position.slice(6, 9)).toEqual([-a[3]!, a[4]!, a[5]!]);
    expect(m.lit.color.slice(3, 6)).toEqual(lit.color.slice(6, 9));
    expect(m.lit.normal[0]).toBeCloseTo(-lit.normal[0]!);
    expect(m.halos![0]!.x).toBe(-2);
    expect(m.moving![0]!.pivot).toEqual([-2, 1, 0]);
  });

  it("still faces the way its normal says (the winding turns with the reflection), and mirroring twice gives the original back", () => {
    const m = mirrorModel(model);
    const stored = new Vector3(m.lit.normal[0], m.lit.normal[1], m.lit.normal[2]);
    expect(windingNormal(m.lit, 0).dot(stored)).toBeGreaterThan(0.99);
    const twice = mirrorModel(m);
    expect(twice.lit.position).toEqual(lit.position);
    expect(twice.lit.color).toEqual(lit.color);
    // The original is untouched.
    expect(lit.position[0]).toBe(1);
  });

  it("moves its parts as the original's reflection: swung to the other side, turning the other way", () => {
    const part = new Object3D();
    mirrorModel(model).moving![0]!.update(0, part);
    expect(part.position.x).toBe(-1);
    expect(part.rotation.z).toBe(-0.5);
  });
});
