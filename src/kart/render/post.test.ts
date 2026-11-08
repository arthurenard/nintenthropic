import { describe, expect, it } from "vitest";
import { BloomEffect, LuminanceMaterial } from "postprocessing";
import { guardBrightPass } from "./post";

describe("the glow's guard against a NaN or infinite pixel (one bad pixel must never become a black block)", () => {
  it("goes into the library's own bright pass, once", () => {
    const material = new LuminanceMaterial(false);
    expect(guardBrightPass(material)).toBe(true);
    expect(material.fragmentShader).toContain("if(any(isnan(texel))||any(isinf(texel)))texel=vec4(0.0);");
    // The guard sits right after the read, before the brightness is measured from it.
    expect(material.fragmentShader.indexOf("isnan(texel)")).toBeLessThan(material.fragmentShader.indexOf("luminance(texel.rgb)"));
    const once = material.fragmentShader;
    expect(guardBrightPass(material)).toBe(true);
    expect(material.fragmentShader).toBe(once);
  });

  it("reaches the bloom the race uses (a library update that moves the read fails here, not on a player's screen)", () => {
    const bloom = new BloomEffect({ luminanceThreshold: 1, luminanceSmoothing: 0.25, mipmapBlur: true });
    expect(guardBrightPass(bloom.luminanceMaterial)).toBe(true);
    expect(bloom.luminanceMaterial.fragmentShader).toContain("isnan(texel)");
  });

  it("leaves a shader it does not know alone", () => {
    const other = { fragmentShader: "void main(){gl_FragColor=vec4(1.0);}", needsUpdate: false };
    expect(guardBrightPass(other)).toBe(false);
    expect(other.fragmentShader).toBe("void main(){gl_FragColor=vec4(1.0);}");
    expect(other.needsUpdate).toBe(false);
  });
});
