import { describe, expect, it } from "vitest";
import { MeshPhysicalMaterial, ShaderChunk, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { addBakedSun, makeBakeUniforms } from "./shading";

/** What a renderer hands onBeforeCompile when it builds the material's shader (only what the patch touches). */
function build(material: MeshPhysicalMaterial): WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: ShaderChunk.common, fragmentShader: ShaderChunk.common } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

describe("the karts' baked sun", () => {
  it("is read from the uniforms of the race being drawn, not only the first race's", () => {
    // One kart material for every race; each race's renderer has uniforms of its own and builds its own shader.
    const material = new MeshPhysicalMaterial();
    const first = makeBakeUniforms();
    const second = makeBakeUniforms();
    addBakedSun(material, first);
    expect(build(material).uniforms.uSunMap).toBe(first.uSunMap);
    addBakedSun(material, second);
    expect(build(material).uniforms.uSunMap).toBe(second.uSunMap);
    expect(build(material).uniforms.uSunInfo).toBe(second.uSunInfo);
  });

  it("is patched in once, however many races there are", () => {
    const material = new MeshPhysicalMaterial();
    addBakedSun(material, makeBakeUniforms());
    addBakedSun(material, makeBakeUniforms());
    expect(material.customProgramCacheKey()).toMatch(/\+baked-sun$/);
    expect(material.customProgramCacheKey().match(/baked-sun/g)).toHaveLength(1);
  });
});
