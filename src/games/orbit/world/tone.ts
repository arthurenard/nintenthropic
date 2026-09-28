/**
 * One exposure and one tone curve for everything lit at run time - the
 * station, the debris, the drone, the Derelict - the same the planet's
 * shader uses (glsl.ts's orbitTone, the art's AgX), so a white blanket in
 * the sun sits beside a sunlit cloud as it does in the art's renders. The
 * baked cupola is display-ready already and is left alone; so is anything
 * made to glow (lamps, the beam, sparks), which must stay bright enough to
 * bloom.
 */
import type { Material, Mesh, Object3D, WebGLProgramParametersWithUniforms } from "three";
import { EXPOSURE_STOPS } from "./atmosphere";
import { TONE } from "./glsl";

export class Tone {
  /** 2^stops: the art's exposure, opened up a little at night. */
  readonly exposure = { value: Math.pow(2, EXPOSURE_STOPS) };
  private readonly patched = new WeakSet<Material>();

  /** Tone-map a lit material in its own shader. */
  patch(material: Material): void {
    if (this.patched.has(material)) return;
    const m = material as Material & { isMeshStandardMaterial?: boolean; isMeshPhysicalMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
    if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.isMeshLambertMaterial && !m.isMeshPhongMaterial) return;
    this.patched.add(material);
    const exposure = this.exposure;
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      before.call(material, shader, renderer);
      shader.uniforms["uExposure"] = exposure;
      shader.fragmentShader = `${TONE}\n${shader.fragmentShader}`.replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = orbitTone(gl_FragColor.rgb);");
    };
    const key = material.customProgramCacheKey.bind(material);
    material.customProgramCacheKey = () => `${key()}|orbit-tone`;
    material.needsUpdate = true;
  }

  /** Every lit material under `root`. */
  patchTree(root: Object3D): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) this.patch(mat);
    });
  }
}
