/**
 * The harbour's water: one huge plane with a small shader. Gently moving
 * ripples tilt the surface, which reflects the night sky more at a glancing
 * angle and glints where the moon's reflection falls; the lamps' light lies on
 * it as warm streaks. Fog takes it into the horizon.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { WATER_LEVEL } from "./terrain";
import type { ThemeStyle } from "./themes";

const vertex = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float a = cos(p.x * 0.55 + t * 1.2) + 0.6 * cos(p.x * 1.7 - p.y * 1.3 + t * 2.0) + 0.35 * cos(p.y * 3.1 + t * 2.6);
  float b = cos(p.y * 0.48 - t * 0.9) + 0.6 * cos(p.y * 1.9 + p.x * 1.1 - t * 1.7) + 0.35 * cos(p.x * 2.8 - t * 2.3);
  vec3 n = normalize(vec3(a * 0.05, 1.0, b * 0.05));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 col = mix(uDeep, uSky, 0.08 + fres * 0.85);
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 260.0);
  col += uSunColour * spec * 2.5;
  // Little glints scattered over the ripples.
  float g = pow(max(0.0, sin(p.x * 3.7 + t * 1.3) * sin(p.y * 4.1 - t) * sin((p.x + p.y) * 2.3 + t * 0.7)), 6.0);
  col += uSky * g * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface Water {
  mesh: Mesh;
  update(time: number): void;
  dispose(): void;
}

export function createWater(style: ThemeStyle, centre: { x: number; z: number }): Water {
  const geometry = new PlaneGeometry(6000, 6000, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new Color("#0a2447") },
      uSky: { value: new Color(style.sky.horizon).multiplyScalar(0.9) },
      uSunDir: { value: new Vector3(...style.sky.sunDir).normalize() },
      uSunColour: { value: new Color(style.sky.sunColour) },
    },
  ]);
  const material = new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, fog: true });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(centre.x, WATER_LEVEL, centre.z);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(time) {
      uniforms.uTime!.value = time;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
