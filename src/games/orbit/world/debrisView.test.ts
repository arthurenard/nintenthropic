// The debris view lets go of what no scene holds when the game is put away:
// the library it clones from, the Derelict's parts, the pool.
import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry, type Material } from "three";
import { mulberry32 } from "../../../engine/rules/rng";
import type { Effects } from "./effects";
import { DebrisView } from "./debrisView";
import type { DerelictParts, Library } from "./library";

function counted<T extends BufferGeometry | Material>(thing: T, freed: Set<unknown>): T {
  thing.addEventListener("dispose", () => freed.add(thing));
  return thing;
}

describe("the debris view", () => {
  it("frees the library's loose wholes and pieces and the Derelict's parts when it is put away", () => {
    const freed = new Set<unknown>();
    const made: unknown[] = [];
    const mesh = (): Mesh => {
      const g = counted(new BoxGeometry(0.3, 0.3, 0.3), freed);
      const m = counted(new MeshStandardMaterial(), freed);
      made.push(g, m);
      return new Mesh(g, m);
    };
    const library: Library = {
      shrapnel: [{ name: "shrapnel.1", whole: mesh(), pieces: [], size: 0.3 }],
      chunk: [{ name: "chunk.1", whole: mesh(), pieces: [mesh(), mesh()], size: 0.8 }],
      slab: [],
      shard: [],
      foil: [],
    };
    const root = new Group();
    root.add(mesh());
    const derelict: DerelictParts = { root, body: null, tank: null, panels: [], pieces: [mesh()], tankDir: new Vector3(0, 0, 1), size: 4 };
    const scene = new Object3D();
    const view = new DebrisView(scene, library, derelict, {} as Effects, new Vector3(), mulberry32(1));
    view.dispose();
    expect(made.length).toBe(12);
    for (const thing of made) expect(freed.has(thing)).toBe(true);
  });
});
