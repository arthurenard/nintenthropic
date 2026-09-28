/**
 * How the night is shaded, shared by everything drawn in it: the fog that
 * lies on the road and the fields, the flashlight's beam falling on the
 * baked road, the streetlight's flicker, and the muzzle flash.
 *
 * The road is baked (docs/DEAD_OF_NIGHT.md, "Asset contract"): every
 * surface carries its `lit` colour (the moon, the sky, the steady practical
 * lights, no fog) and its `albedo` (its own colour, no light). The baked
 * material shows `lit`, takes away the streetlight's share of it as the
 * lamp flickers (`flicker`: where its light falls), and adds `albedo ×` the
 * flashlight and the muzzle flash - the same spotlight, with the same
 * falloff and cone, that lights the characters through three.js's own
 * SpotLight, so a walker and the road under his feet are lit alike. Then
 * the fog, which every material here computes the same way.
 *
 * All the uniforms live in one NightUniforms, shared by reference by every
 * material that uses them: the game sets each once a frame.
 */
import {
  Color,
  DoubleSide,
  FrontSide,
  ShaderMaterial,
  Vector3,
  Vector4,
  type IUniform,
  type Material,
  type Side,
  type Texture,
} from "three";

export interface NightUniforms {
  /** The fog: its colour, its density at the eye's height (exponential-squared, per metre), how much thicker it lies on the ground and how fast that thins with height, and the clock for its drift. */
  uFogColor: IUniform<Color>;
  uFogDensity: IUniform<number>;
  uFogGround: IUniform<number>;
  uFogFalloff: IUniform<number>;
  uFogTime: IUniform<number>;
  /** The flashlight: where it is, where it points, its colour × intensity, and its shape (cos of the cone, cos of the hot centre, the falloff's exponent, its reach). */
  uBeamPos: IUniform<Vector3>;
  uBeamDir: IUniform<Vector3>;
  uBeamColor: IUniform<Color>;
  uBeamShape: IUniform<Vector4>;
  /** A muzzle flash: where, and its colour × intensity (black when there is none). */
  uFlashPos: IUniform<Vector3>;
  uFlashColor: IUniform<Color>;
  /** The streetlight's baked light, as the lamp gives it now: its tint × strength, and 1 steady … 0 out. */
  uStreetTint: IUniform<Color>;
  uStreetOn: IUniform<number>;
  /** Up to eight of the dead pushing through the corn: x, z, strength, 0. */
  uPush: IUniform<Vector4[]>;
  uWind: IUniform<number>;
}

export function nightUniforms(): NightUniforms {
  return {
    uFogColor: { value: new Color("#3b4552") },
    uFogDensity: { value: 0.016 },
    uFogGround: { value: 1.6 },
    uFogFalloff: { value: 0.35 },
    uFogTime: { value: 0 },
    uBeamPos: { value: new Vector3() },
    uBeamDir: { value: new Vector3(0, 0, -1) },
    uBeamColor: { value: new Color(0, 0, 0) },
    uBeamShape: { value: new Vector4(Math.cos(0.3), Math.cos(0.12), 1.3, 70) },
    uFlashPos: { value: new Vector3() },
    uFlashColor: { value: new Color(0, 0, 0) },
    uStreetTint: { value: new Color(0, 0, 0) },
    uStreetOn: { value: 1 },
    uPush: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, 0, 0)) },
    uWind: { value: 0.6 },
  };
}

/**
 * The fog, as every material here computes it: exponential-squared by
 * distance (so the near road is clear and far things close in quickly, as
 * fog does), denser where the ray runs low over the ground (the fog lies on
 * the road and the fields: a far walker's feet go before his head), and
 * patchy, drifting slowly.
 */
export const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogGround;
uniform float uFogFalloff;
uniform float uFogTime;

float nightHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nightNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nightHash(i), nightHash(i + vec2(1.0, 0.0)), f.x), mix(nightHash(i + vec2(0.0, 1.0)), nightHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** How much of what is at world point p the fog hides from the eye, 0..1. */
float nightFog(vec3 p) {
  vec3 cam = cameraPosition;
  float dist = distance(p, cam);
  float k = uFogFalloff;
  float h0 = max(cam.y, 0.0);
  float h1 = max(p.y, 0.0);
  float dh = h1 - h0;
  float e0 = exp(-k * h0);
  float e1 = exp(-k * h1);
  // The mean of exp(-k h) along the ray, from the eye to the point.
  float mean = abs(dh) > 0.02 ? (e0 - e1) / (k * dh) : 0.5 * (e0 + e1);
  // Normalised so a ray level with the eye sees exactly uFogDensity.
  float density = uFogDensity * (1.0 + uFogGround * mean) / (1.0 + uFogGround * e0);
  vec2 q = p.xz * 0.045 + vec2(uFogTime * 0.021, uFogTime * 0.013);
  density *= 0.78 + 0.44 * nightNoise(q) * (0.6 + 0.4 * nightNoise(q * 2.7 - uFogTime * 0.01));
  float t = density * dist;
  return 1.0 - exp(-t * t);
}
`;

/**
 * The flashlight's light at a surface, as three.js's SpotLight computes it
 * for the characters (irradiance: before the albedo and 1/π): the cone's
 * smooth edge, a falloff of distance to the `decay` power cut off at its
 * reach, and the surface's angle to the light.
 */
export const BEAM_GLSL = /* glsl */ `
uniform vec3 uBeamPos;
uniform vec3 uBeamDir;
uniform vec3 uBeamColor;
uniform vec4 uBeamShape;
uniform vec3 uFlashPos;
uniform vec3 uFlashColor;

vec3 beamIrradiance(vec3 p, vec3 n) {
  vec3 toL = uBeamPos - p;
  float d = length(toL);
  vec3 L = toL / max(d, 1e-4);
  float spot = smoothstep(uBeamShape.x, uBeamShape.y, dot(-L, uBeamDir));
  float fall = 1.0 / max(pow(d, uBeamShape.z), 0.01);
  float cut = clamp(1.0 - pow(d / uBeamShape.w, 4.0), 0.0, 1.0);
  return uBeamColor * spot * fall * cut * cut * max(dot(n, L), 0.0);
}

vec3 flashIrradiance(vec3 p, vec3 n) {
  vec3 toL = uFlashPos - p;
  float d = length(toL);
  vec3 L = toL / max(d, 1e-4);
  float cut = clamp(1.0 - pow(d / 14.0, 4.0), 0.0, 1.0);
  return uFlashColor * cut * cut / max(d * d, 0.25) * max(dot(n, L), 0.0);
}
`;

const BAKED_VERTEX = /* glsl */ `
#include <common>
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
#ifdef VERTEX_LIT
attribute vec3 albedo;
attribute float street;
varying vec3 vLit;
varying vec3 vAlbedo;
varying float vStreet;
#endif
#ifdef SWAY
uniform vec4 uPush[8];
uniform float uWind;
uniform float uFogTime;
#endif
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
#ifdef USE_INSTANCING
  world = modelMatrix * instanceMatrix * vec4(position, 1.0);
#endif
#ifdef SWAY
  // The corn bends with the wind, more toward its tips, and away from the
  // dead pushing through it: the tell of one coming.
  float h = clamp(world.y / 2.4, 0.0, 1.0);
  float bend = h * h;
  float gust = sin(uFogTime * 1.3 + world.x * 0.21 + world.z * 0.17) * 0.6 + sin(uFogTime * 2.9 + world.x * 0.9 - world.z * 0.4) * 0.25;
  vec2 lean = vec2(0.09, 0.05) * gust * uWind;
  for (int i = 0; i < 8; i++) {
    vec4 push = uPush[i];
    if (push.z <= 0.0) continue;
    vec2 away = world.xz - push.xy;
    float d = length(away);
    float k = push.z * (1.0 - smoothstep(0.4, 2.6, d));
    lean += (away / max(d, 0.2)) * k * 0.55;
    // Shaken as it passes.
    lean += vec2(sin(uFogTime * 17.0 + world.x * 3.0), cos(uFogTime * 15.0 + world.z * 3.0)) * k * 0.06;
  }
  world.xz += lean * bend;
  world.y -= dot(lean, lean) * bend * 0.35;
#endif
  vWorld = world.xyz;
  mat3 nm = mat3(modelMatrix);
#ifdef USE_INSTANCING
  nm = mat3(modelMatrix) * mat3(instanceMatrix);
#endif
  vNormalW = normalize(nm * normal);
#ifdef VERTEX_LIT
  vLit = color;
  vAlbedo = albedo;
  vStreet = street;
#endif
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BAKED_FRAGMENT = /* glsl */ `
#include <common>
${FOG_GLSL}
${BEAM_GLSL}
uniform vec3 uStreetTint;
uniform float uStreetOn;
uniform float uGlow;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormalW;
#ifdef VERTEX_LIT
varying vec3 vLit;
varying vec3 vAlbedo;
varying float vStreet;
#endif
#ifdef USE_LIT_MAP
uniform sampler2D litMap;
#endif
#ifdef USE_ALBEDO_MAP
uniform sampler2D albedoMap;
#endif
#ifdef USE_FLICKER_MAP
uniform sampler2D flickerMap;
#endif
#ifdef USE_DETAIL_MAP
uniform sampler2D detailMap;
#endif
void main() {
  vec3 lit = vec3(0.0);
  vec3 albedo = vec3(0.5);
  float street = 0.0;
  float alpha = uOpacity;
#ifdef VERTEX_LIT
  lit = vLit;
  albedo = vAlbedo;
  street = vStreet;
#endif
#ifdef USE_LIT_MAP
  vec4 litTex = texture2D(litMap, vUv);
  lit = litTex.rgb;
  alpha *= litTex.a;
#endif
#ifdef USE_ALBEDO_MAP
  albedo = texture2D(albedoMap, vUv).rgb;
#endif
#ifdef USE_FLICKER_MAP
  street = texture2D(flickerMap, vUv).r;
#endif
#ifdef USE_DETAIL_MAP
  vec4 detail = texture2D(detailMap, vUv);
  lit *= detail.rgb;
  albedo *= detail.rgb;
  alpha *= detail.a;
#endif
#ifdef ALPHA_TEST
  if (alpha < 0.5) discard;
#endif
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  // The streetlight's share of the bake, gone as the lamp flickers.
  vec3 c = max(lit * uGlow - albedo * uStreetTint * street * (1.0 - uStreetOn), 0.0);
  c += albedo * RECIPROCAL_PI * (beamIrradiance(vWorld, n) + flashIrradiance(vWorld, n));
  c = mix(c, uFogColor, nightFog(vWorld));
  gl_FragColor = vec4(c, alpha);
  #include <colorspace_fragment>
}
`;

export interface BakedOptions {
  /** The baked light: a texture, or (the placeholders) vertex colours with `albedo` and `street` attributes. */
  lit: Texture | "vertex";
  albedo?: Texture | null;
  flicker?: Texture | null;
  /** A greyscale detail over both (the placeholders' planks and asphalt). */
  detail?: Texture | null;
  /** How much brighter than the bake it glows (neon, lamps): 1 for an ordinary surface. */
  glow?: number;
  transparent?: boolean;
  alphaTest?: boolean;
  side?: Side;
  /** The corn: it sways with the wind and away from the dead. */
  sway?: boolean;
  instanced?: boolean;
}

/** A baked surface of the road, lit by the night's uniforms (shared by reference). */
export function bakedMaterial(u: NightUniforms, o: BakedOptions): ShaderMaterial {
  const defines: Record<string, string> = {};
  const uniforms: Record<string, IUniform> = {
    ...u,
    uGlow: { value: o.glow ?? 1 },
    uOpacity: { value: 1 },
  };
  if (o.lit === "vertex") defines["VERTEX_LIT"] = "";
  else {
    defines["USE_LIT_MAP"] = "";
    uniforms["litMap"] = { value: o.lit };
  }
  if (o.albedo) {
    defines["USE_ALBEDO_MAP"] = "";
    uniforms["albedoMap"] = { value: o.albedo };
  }
  if (o.flicker) {
    defines["USE_FLICKER_MAP"] = "";
    uniforms["flickerMap"] = { value: o.flicker };
  }
  if (o.detail) {
    defines["USE_DETAIL_MAP"] = "";
    uniforms["detailMap"] = { value: o.detail };
  }
  if (o.alphaTest) defines["ALPHA_TEST"] = "";
  if (o.sway) defines["SWAY"] = "";
  const m = new ShaderMaterial({
    uniforms,
    defines,
    vertexShader: BAKED_VERTEX,
    fragmentShader: BAKED_FRAGMENT,
    vertexColors: o.lit === "vertex",
    transparent: o.transparent ?? false,
    // Glass lets what is behind it show and does not hide it from what comes after.
    depthWrite: !(o.transparent ?? false),
    side: o.side ?? FrontSide,
    name: "night-baked",
  });
  if (o.side === DoubleSide) m.forceSinglePass = true;
  return m;
}

/**
 * The night's fog on a lit material (the characters, the jars, the debris):
 * three.js's own lighting (the moon, the streetlight, the flashlight's
 * SpotLight), then the same fog as the baked road instead of three's.
 * Chains any onBeforeCompile already there (the engine's rig patch), and
 * shares one program for every material patched with the same key.
 */
export function withNightFog(m: Material, u: NightUniforms, key: string): void {
  const previous = m.onBeforeCompile.bind(m);
  const previousKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms["uFogColor"] = u.uFogColor;
    shader.uniforms["uFogDensity"] = u.uFogDensity;
    shader.uniforms["uFogGround"] = u.uFogGround;
    shader.uniforms["uFogFalloff"] = u.uFogFalloff;
    shader.uniforms["uFogTime"] = u.uFogTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vNightWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tvNightWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vNightWorld;\n${FOG_GLSL}`)
      .replace("#include <fog_fragment>", "gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, nightFog(vNightWorld));");
  };
  m.customProgramCacheKey = () => `${previousKey()}|night-fog|${key}`;
  (m as { fog?: boolean }).fog = false;
  m.needsUpdate = true;
}
