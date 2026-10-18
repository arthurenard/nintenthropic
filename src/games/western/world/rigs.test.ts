import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { singlePass } from "./rigs";

describe("singlePass", () => {
  it("draws every figure's materials in one pass, and their clones too", () => {
    const scene = new Group();
    const body = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ side: DoubleSide, transparent: true }));
    const hat = new Mesh(new BoxGeometry(), [new MeshStandardMaterial({ side: DoubleSide }), new MeshStandardMaterial()]);
    scene.add(body, hat);
    singlePass(scene);
    const all = [body.material, ...(hat.material as MeshStandardMaterial[])] as MeshStandardMaterial[];
    expect(all.every((m) => m.forceSinglePass)).toBe(true);
    // A rig's own materials are clones of these.
    expect((body.material as MeshStandardMaterial).clone().forceSinglePass).toBe(true);
  });
});
