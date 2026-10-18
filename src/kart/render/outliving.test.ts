import { describe, expect, it } from "vitest";
import { BoxGeometry, DataTexture, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, type WebGLRenderer } from "three";
import { outliving } from "./outliving";

describe("what a picture lets go of with its renderer", () => {
  it("is everything it draws with, and three's shared table its glossy materials were given", () => {
    const lut = new DataTexture(new Uint8Array(4), 1, 1);
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const glossy = new MeshPhysicalMaterial();
    const flat = new MeshBasicMaterial({ map });
    const shape = new BoxGeometry();
    const root = new Group();
    root.add(new Mesh(shape, glossy), new Group().add(new Mesh(shape, [flat, glossy])));
    const renderer = { properties: { get: (m: object) => (m === glossy ? { uniforms: { dfgLUT: { value: lut } } } : {}) } } as unknown as WebGLRenderer;
    const found = outliving(renderer, root);
    expect([...found]).toEqual(expect.arrayContaining([shape, glossy, flat, map, lut]));
    expect(found.size).toBe(5);
  });

  it("frees the renderer's hold on them: their dispose listeners go", () => {
    // What three does when it uploads a texture, and what keeps the renderer: a listener for the texture's dispose.
    const lut = new DataTexture(new Uint8Array(4), 1, 1);
    let held = true;
    const release = () => {
      held = false;
      lut.removeEventListener("dispose", release);
    };
    lut.addEventListener("dispose", release);
    const glossy = new MeshPhysicalMaterial();
    const renderer = { properties: { get: () => ({ uniforms: { dfgLUT: { value: lut } } }) } } as unknown as WebGLRenderer;
    for (const thing of outliving(renderer, new Mesh(new BoxGeometry(), glossy))) thing.dispose();
    expect(held).toBe(false);
    expect(lut.hasEventListener("dispose", release)).toBe(false);
  });
});
