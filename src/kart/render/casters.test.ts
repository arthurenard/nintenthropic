import { describe, expect, it } from "vitest";
import { Frustum, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { Casters, shadowInView } from "./casters";

/** A chase camera at the origin's back, 2 m up, looking along +z. */
function view(): Frustum {
  const eye = new PerspectiveCamera(60, 16 / 9, 0.4, 2600);
  eye.position.set(0, 2, -6);
  eye.lookAt(0, 1, 10);
  eye.updateMatrixWorld();
  eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
}

const HIGH_SUN = new Vector3(0.5, 0.74, -0.45).normalize();

describe("which karts a view's shadow pass draws", () => {
  it("keeps the karts in view, and those just beside it", () => {
    const f = view();
    expect(shadowInView(f, 0, 0, 0, 0, HIGH_SUN, 60)).toBe(true);
    expect(shadowInView(f, 3, 0, 20, 0, HIGH_SUN, 60)).toBe(true);
    // Just out of the side of the picture: its shadow, or its own edge, may still be in it.
    expect(shadowInView(f, 14, 0, 12, 0, HIGH_SUN, 60)).toBe(true);
  });

  it("leaves out a kart well behind the camera", () => {
    expect(shadowInView(view(), 0, 0, -30, 0, HIGH_SUN, 60)).toBe(false);
    expect(shadowInView(view(), 4, 0, -16, 0, HIGH_SUN, 60)).toBe(false);
  });

  it("keeps a kart behind the camera whose long shadow a low sun lays ahead into the picture", () => {
    // The sun low behind the camera's back (pointing at it means -z here): the shadow runs a long way toward +z.
    const low = new Vector3(0, 0.12, -1).normalize();
    expect(shadowInView(view(), 0, 0, -16, 0, low, 60)).toBe(true);
    // ...though no farther than the shadow map reaches.
    expect(shadowInView(view(), 0, 0, -80, 0, low, 20)).toBe(false);
  });

  it("follows a kart high in the air to where its shadow lands", () => {
    // Over the camera's head and behind it, its shadow falls well ahead, on the road in view.
    const sunBehind = new Vector3(0, 0.5, -0.86).normalize();
    expect(shadowInView(view(), 0, 14, -12, 0, sunBehind, 60)).toBe(true);
  });
});

describe("a kart's casters", () => {
  it("switch off together and come back as they were", () => {
    const root = new Group();
    const body = new Mesh(undefined, new MeshBasicMaterial());
    const glass = new Mesh(undefined, new MeshBasicMaterial());
    body.castShadow = true;
    glass.castShadow = false;
    root.add(body, glass);
    const casters = new Casters();
    casters.set(root, false);
    expect(body.castShadow).toBe(false);
    casters.set(root, false);
    casters.set(root, true);
    expect(body.castShadow).toBe(true);
    // What never cast is not made to.
    expect(glass.castShadow).toBe(false);
  });
});
