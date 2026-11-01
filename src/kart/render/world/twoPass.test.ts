import { BackSide, BoxGeometry, DoubleSide, FrontSide, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { splitTwoPass } from "./twoPass";

/** A box, without the one group of each face that three gives it for six materials. */
const box = (size = 1) => {
  const geometry = new BoxGeometry(size, size, size);
  geometry.clearGroups();
  return geometry;
};
const glass = () => new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.5, depthWrite: false });

describe("drawing a transparent double-sided mesh as its two passes", () => {
  it("gives it a back-faces material and a front-faces one, over all of its geometry, that look as the original does", () => {
    const geometry = box(2);
    const original = glass();
    const mesh = new Mesh(geometry, original);
    const root = new Group().add(mesh);
    const done = splitTwoPass(root);
    expect(done.split).toBe(1);
    const [back, front] = mesh.material as unknown as [MeshLambertMaterial, MeshLambertMaterial];
    expect(back.side).toBe(BackSide);
    expect(front.side).toBe(FrontSide);
    for (const m of [back, front]) {
      expect(m.type).toBe(original.type);
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBe(0.5);
      expect(m.depthWrite).toBe(false);
      expect(m.vertexColors).toBe(true);
      expect(m.onBeforeCompile).toBe(original.onBeforeCompile);
    }
    const all = geometry.index!.count;
    expect(geometry.groups).toEqual([
      { start: 0, count: all, materialIndex: 0 },
      { start: 0, count: all, materialIndex: 1 },
    ]);
    done.dispose();
  });

  it("makes one pair for a material shared by several meshes, and groups a shared geometry once", () => {
    const geometry = box();
    const shared = new MeshPhysicalMaterial({ side: DoubleSide, transparent: true, opacity: 0.5 });
    const a = new Mesh(geometry, shared);
    const b = new Mesh(geometry, shared);
    const done = splitTwoPass(new Group().add(a, b));
    expect(done.split).toBe(2);
    expect(a.material).toBe(b.material);
    expect(geometry.groups).toHaveLength(2);
    done.dispose();
  });

  it("leaves alone what three would not draw in two passes, or what is not its to change", () => {
    const geometry = box();
    const opaque = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
    const front = new Mesh(geometry, new MeshBasicMaterial({ transparent: true }));
    const once = new Mesh(geometry, Object.assign(glass(), { forceSinglePass: true }));
    const shader = new Mesh(geometry, new ShaderMaterial({ side: DoubleSide, transparent: true }));
    const instanced = new InstancedMesh(geometry, glass(), 4);
    const casting = new Mesh(geometry, glass());
    casting.castShadow = true;
    const array = new Mesh(geometry, [glass(), glass()]);
    const all = [opaque, front, once, shader, instanced, casting, array];
    const before = all.map((m) => m.material);
    const done = splitTwoPass(new Group().add(...all));
    expect(done.split).toBe(0);
    expect(all.map((m) => m.material)).toEqual(before);
    expect(geometry.groups).toHaveLength(0);
  });
});
