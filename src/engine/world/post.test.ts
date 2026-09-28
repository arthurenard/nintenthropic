import { describe, expect, it } from "vitest";
import { GradeEffect } from "./post";

describe("the grade pass's effects, chosen per game", () => {
  it("has them all by default, with the blood and the flash in their colours", () => {
    const grade = new GradeEffect();
    expect([...grade.defines.keys()].sort()).toEqual(["DESATURATE", "FLASH", "FLASH_COLOR", "HURT", "HURT_COLOR", "SEPIA", "SHOULDER", "VIGNETTE"]);
    expect(grade.defines.get("HURT_COLOR")).toBe("vec3(0.3, 0.012, 0.008)");
    expect(grade.defines.get("VIGNETTE")).toBe("0.22");
  });

  it("compiles out what a game leaves out, and takes its own grade and colours", () => {
    const grade = new GradeEffect({
      hurt: { color: [0.1, 0.4, 1] },
      sepia: false,
      flash: false,
      vignette: 0,
      grade: { glsl: "vec3 grade(vec3 c, float l) { return c * moon; }", uniforms: { moon: 0.5 } },
    });
    const defines = grade.defines;
    expect(defines.has("SEPIA")).toBe(false);
    expect(defines.has("FLASH")).toBe(false);
    expect(defines.has("VIGNETTE")).toBe(false);
    expect(defines.get("HURT_COLOR")).toBe("vec3(0.1, 0.4, 1.0)");
    expect(defines.has("GRADE")).toBe(true);
    expect(grade.getFragmentShader()).toContain("uniform float moon;");
    expect(grade.getFragmentShader()).toContain("return c * moon;");
    grade.set("moon", 0.8);
    expect(grade.uniforms.get("moon")!.value).toBe(0.8);
    // A name the pass does not have is let go quietly.
    grade.set("nothing", 1);
  });
});
