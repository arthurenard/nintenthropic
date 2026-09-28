import { Group, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { beamVolume } from "./beam";
import { BEAM, Flashlight } from "./flashlight";
import { nightUniforms } from "./shading";

function eye(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 1.6, 0.1, 400);
  cam.position.set(0, 1.7, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** The road as a flat ground a ray can hit. */
const ground = {
  cast(origin: Vector3, dir: Vector3, far: number, out: { point: Vector3; normal: Vector3; distance: number; object: null }) {
    if (dir.y >= -1e-4) return null;
    const t = -origin.y / dir.y;
    if (t > far) return null;
    out.point.copy(dir).multiplyScalar(t).add(origin);
    out.normal.set(0, 1, 0);
    out.distance = t;
    return out;
  },
};

describe("the flashlight", () => {
  it("sits under the barrel and points its beam where the crosshair is", () => {
    const cam = eye();
    const f = new Flashlight(new Group());
    f.reset(cam);
    for (let i = 0; i < 90; i++) {
      f.aim(cam, 0.5, 0.62, ground);
      f.update(1 / 60, cam);
    }
    // Below and to the right of the eye.
    expect(f.position.y).toBeLessThan(1.7);
    expect(f.position.x).toBeGreaterThan(0);
    // Its beam lands on the road where the crosshair's ray does.
    const hit = { point: new Vector3(), normal: new Vector3(), distance: 0, object: null };
    const toGround = ground.cast(f.position, f.direction, 200, hit)!;
    const ray = new Vector3(0, (0.5 - 0.62) * 2 * Math.tan((25 * Math.PI) / 180), -1).normalize();
    const aimed = ground.cast(cam.position, ray, 200, { point: new Vector3(), normal: new Vector3(), distance: 0, object: null })!;
    expect(toGround.point.distanceTo(aimed.point)).toBeLessThan(0.3);
  });

  it("follows the aim with a little weight, not in one frame", () => {
    const cam = eye();
    const f = new Flashlight(new Group());
    f.reset(cam);
    for (let i = 0; i < 60; i++) {
      f.aim(cam, 0.5, 0.5, ground);
      f.update(1 / 60, cam);
    }
    const before = f.direction.clone();
    f.aim(cam, 0.8, 0.5, ground);
    f.update(1 / 60, cam);
    const moved = f.direction.angleTo(before);
    for (let i = 0; i < 30; i++) {
      f.aim(cam, 0.8, 0.5, ground);
      f.update(1 / 60, cam);
    }
    const settled = f.direction.angleTo(before);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(settled * 0.5);
  });

  it("lights what is in its cone, less with distance, and nothing outside it", () => {
    const cam = eye();
    const f = new Flashlight(new Group());
    f.reset(cam);
    f.update(1 / 60, cam);
    const along = (d: number) => f.position.clone().addScaledVector(f.direction, d);
    expect(f.lightAt(along(10))).toBeCloseTo(1, 1);
    expect(f.lightAt(along(30))).toBeLessThan(f.lightAt(along(10)));
    expect(f.lightAt(along(30))).toBeCloseTo(Math.pow(10 / 30, BEAM.decay), 2);
    const aside = along(10).add(new Vector3(8, 0, 0));
    expect(f.lightAt(aside)).toBe(0);
  });

  it("hands the same beam to the road and to the fog", () => {
    const cam = eye();
    const f = new Flashlight(new Group());
    f.reset(cam);
    f.update(1 / 60, cam);
    const u = nightUniforms();
    const v = beamVolume();
    f.apply(u, v);
    expect(u.uBeamPos.value.equals(v.uBeamPos.value)).toBe(true);
    expect(u.uBeamDir.value.equals(v.uBeamDir.value)).toBe(true);
    expect(u.uBeamShape.value.equals(v.uBeamShape.value)).toBe(true);
    // The dead catch it with a gentler falloff than the road: never a harsher one.
    expect(f.spot.decay).toBe(BEAM.figureDecay);
    expect(BEAM.figureDecay).toBeLessThanOrEqual(BEAM.decay);
    expect(f.spot.angle).toBe(BEAM.angle);
  });

  it("drops at the fall and comes to rest on the asphalt, its beam along the ground", () => {
    const cam = eye();
    const f = new Flashlight(new Group());
    f.reset(cam);
    f.update(1 / 60, cam);
    f.drop(1, () => 0.5);
    for (let i = 0; i < 60 * 4; i++) f.update(1 / 60, cam);
    expect(f.dropped).toBe(true);
    expect(f.position.y).toBeLessThan(0.15);
    expect(Math.abs(f.direction.y)).toBeLessThan(0.2);
  });
});
