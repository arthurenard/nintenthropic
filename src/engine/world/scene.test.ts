import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, ShaderMaterial, Sprite, SpriteMaterial, Texture } from "three";
import { disposablesUnder, disposeTree } from "./scene";

/** Counts the 'dispose' events three.js listens for to free GPU memory. */
function watch(...things: { addEventListener(type: "dispose", listener: () => void): void }[]): () => number {
  let freed = 0;
  for (const thing of things) thing.addEventListener("dispose", () => freed++);
  return () => freed;
}

function scene() {
  const map = new Texture();
  const uniformTexture = new Texture();
  const spriteMap = new Texture();
  const solid = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ map }));
  const custom = new Mesh(new BoxGeometry(), new ShaderMaterial({ uniforms: { tAlbedo: { value: uniformTexture }, uTime: { value: 0 } } }));
  const sprite = new Sprite(new SpriteMaterial({ map: spriteMap }));
  const root = new Group().add(solid, custom, sprite);
  const textures = [map, uniformTexture, spriteMap];
  const geometries = [solid.geometry, custom.geometry];
  const materials = [solid.material, custom.material, sprite.material];
  return { root, solid, textures, geometries, materials };
}

describe("disposeTree", () => {
  it("lets go of every geometry, material and texture, including a shader's uniforms and a sprite's map", () => {
    const { root, textures, geometries, materials } = scene();
    const freed = watch(...textures, ...geometries, ...materials);
    disposeTree(root);
    expect(freed()).toBe(textures.length + geometries.length + materials.length);
  });
});

describe("disposablesUnder", () => {
  it("lists a tree's GPU resources now, so they can be let go after its pieces are taken out of it", () => {
    const { root, solid, textures, geometries, materials } = scene();
    const held = disposablesUnder(root);
    solid.removeFromParent();
    const freed = watch(...textures, ...geometries, ...materials);
    for (const item of held) item.dispose();
    // The box that was taken out (its geometry, material and map) is freed too.
    expect(freed()).toBe(textures.length + geometries.length + materials.length);
    expect(held.has(solid.geometry)).toBe(true);
  });
});
