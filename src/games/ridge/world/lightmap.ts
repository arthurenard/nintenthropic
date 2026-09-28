/**
 * The valley's light map, worked out on the GPU from the ground's heights
 * at load: for every few metres of the valley, how high the ground stands
 * toward the sun (the horizon the dawn must climb over to light it) and how
 * much of the sky it sees (its ambient occlusion). The sun only turns about
 * the sky in elevation over a run, so this is made once; the shaders compare
 * the sun's elevation with it every frame (atmosphere.ts's atmoSun).
 */
import {
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import type { Grid } from "./heightfield";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uHeight;
uniform vec4 uBounds;
uniform vec2 uToSun;
varying vec2 vUv;

float H(vec2 xz) {
  vec2 uv = (xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
  return texture2D(uHeight, clamp(uv, 0.0, 1.0)).r;
}

void main() {
  vec2 xz = mix(uBounds.xy, uBounds.zw, vUv);
  // A man's height above the ground: the light that reaches his chest.
  float h0 = H(xz) + 1.5;
  float horizon = -1.5;
  float d = 6.0;
  for (int i = 0; i < 72; i++) {
    float h = H(xz + uToSun * d);
    horizon = max(horizon, atan(h - h0, d));
    d = d * 1.06 + 3.0;
  }
  // How much sky it sees: the ground's own horizon in eight directions, near by.
  float occluded = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.78539816;
    vec2 dir = vec2(cos(a), sin(a));
    float m = 0.0;
    float dd = 5.0;
    for (int i = 0; i < 9; i++) {
      float h = H(xz + dir * dd);
      m = max(m, (h - h0 + 1.0) / dd);
      dd *= 1.55;
    }
    occluded += atan(m);
  }
  float ao = clamp(1.0 - occluded / (8.0 * 1.2), 0.25, 1.0);
  gl_FragColor = vec4(horizon, ao, 0.0, 1.0);
}
`;

export interface LightMap {
  texture: WebGLRenderTarget["texture"];
  /** x0, z0, x1, z1 in metres. */
  bounds: Vector4;
  dispose(): void;
}

/** The grid's heights as a half-float texture the GPU can filter. */
function heightTexture(grid: Grid): DataTexture {
  const data = new Uint16Array(grid.nx * grid.nz);
  for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(grid.heights[i] as number);
  const t = new DataTexture(data, grid.nx, grid.nz, RedFormat, HalfFloatType);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Render the light map for a sun whose light comes from horizontal direction `toSun` (unit, x and z). */
export function buildLightMap(renderer: WebGLRenderer, grid: Grid, toSun: Vector2, size = 1024): LightMap {
  const heights = heightTexture(grid);
  const bounds = new Vector4(grid.x0, grid.z0, grid.x1, grid.z1);
  const target = new WebGLRenderTarget(size, size, { type: HalfFloatType, format: RGBAFormat, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: false });
  const material = new ShaderMaterial({
    uniforms: { uHeight: { value: heights }, uBounds: { value: bounds }, uToSun: { value: toSun.clone().normalize() } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  heights.dispose();
  return {
    texture: target.texture,
    bounds,
    dispose: () => target.dispose(),
  };
}
