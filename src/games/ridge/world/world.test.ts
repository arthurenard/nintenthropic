/**
 * The world's own maths, the parts the rules lean on: the height grid a
 * round and the sun are tested against, and the scope's field of view and
 * the reticle's marks inside it.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { describe, expect, it } from "vitest";
import { holdMils, rangeMarkMils } from "../rules/ballistics";
import { SCOPE_POWER } from "../rules/tuning";
import { Heightfield } from "./heightfield";
import { EYE_FOV, scopedFov } from "./scope";

/** A hill ten metres high on a flat meadow at y = 0. */
const hill = (x: number, z: number) => 10 * Math.exp(-((x - 20) ** 2 + (z + 30) ** 2) / 400);

function hillMesh(): Mesh {
  const g = new PlaneGeometry(400, 400, 160, 160);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setY(i, hill(p.getX(i), p.getZ(i)));
  return new Mesh(g, new MeshBasicMaterial());
}

describe("the height grid", () => {
  const field = Heightfield.fromMesh(hillMesh(), [-100, -100, 100, 100], 1, 8);

  it("gives the ground's height from the mesh, fine where the targets are and coarse beyond", () => {
    for (const [x, z] of [
      [20, -30],
      [5, -30],
      [-60, 40],
      [30, -18],
    ] as const) {
      expect(field.height(x, z)).toBeCloseTo(hill(x, z), 1);
    }
    // Outside the fine grid, the coarse one still knows the meadow.
    expect(field.height(170, 170)).toBeCloseTo(0, 1);
  });

  it("finds where a level shot meets the hill's side", () => {
    // Five metres up, along z = -30: the hill is five metres high at x = 20 - 20·√ln2.
    const t = field.segmentHit(-100, 5, -30, 100, 5, -30);
    const x = -100 + 200 * t;
    expect(x).toBeCloseTo(20 - 20 * Math.sqrt(Math.log(2)), 0);
    // Over the top it passes clean.
    expect(field.segmentHit(-100, 11, -30, 100, 11, -30)).toBe(-1);
  });

  it("measures the horizon a low sun must clear", () => {
    // From a metre above the meadow 100 m west of the top, the hill stands about 5° high.
    const a = field.horizon(-80, 1, -30, 1, 0, 400);
    expect(a).toBeGreaterThan(0.08);
    expect(a).toBeLessThan(0.1);
    // Looking away from it, nothing rises above level.
    expect(field.horizon(-80, 1, -30, -1, 0, 100)).toBeLessThan(0);
  });
});

describe("the scope", () => {
  it("magnifies an eye's 40° six times, whatever the window's shape", () => {
    const fov = scopedFov();
    expect(Math.tan((fov * Math.PI) / 360) * SCOPE_POWER).toBeCloseTo(Math.tan((EYE_FOV * Math.PI) / 360), 6);
    expect(fov).toBeCloseTo(6.94, 2);
  });

  it("has room in its glass for every range mark down to 900 m", () => {
    // The glass is the view's height; half of it in milliradians is the reticle's reach below centre.
    const halfMils = Math.tan((scopedFov() * Math.PI) / 360) * 1000;
    const marks = rangeMarkMils();
    expect(marks[marks.length - 1]!.range).toBe(900);
    expect(marks[marks.length - 1]!.mils).toBeLessThan(halfMils * 0.5);
    // And the marks are the holds: the first at 300 m, one per hundred metres.
    for (const m of marks) expect(m.mils).toBeCloseTo(holdMils(m.range), 6);
  });
});
