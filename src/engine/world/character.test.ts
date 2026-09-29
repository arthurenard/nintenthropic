import { describe, expect, it } from "vitest";
import { patchRigFragment } from "./character";

const SOURCE = ["#include <common>", "void main() {", "#include <lights_fragment_begin>", "#include <lights_fragment_maps>", "#include <opaque_fragment>", "}"].join("\n");

describe("the rig shader patch", () => {
  const out = patchRigFragment(SOURCE);

  it("applies the key light to the directional light (the chunk is expanded to reach its line)", () => {
    expect(out).not.toContain("#include <lights_fragment_begin>");
    const at = out.indexOf("getDirectionalLightInfo( directionalLight, directLight );");
    expect(at).toBeGreaterThan(0);
    expect(out.slice(at, at + 120)).toContain("directLight.color *= uKeyLight;");
    expect(out.split("uKeyLight;").length - 1).toBe(2);
  });

  it("declares its uniforms and leaves the rest of the shader's includes alone", () => {
    expect(out).toContain("uniform float uKeyLight;");
    expect(out).toContain("uniform float uShade;");
    expect(out).toContain("outgoingLight *= uShade;");
    expect(out).toContain("#include <lights_fragment_maps>");
    expect(out).toContain("#include <opaque_fragment>");
  });
});
