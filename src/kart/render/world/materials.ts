/**
 * The materials the world is drawn with, by theme: the ground (with the
 * detail texture and, in the volcano, a glow from within), the road (a glass
 * ribbon in space, cracked and glowing under the volcano), the patches that
 * change how the road drives, additive light ribbons, lava and the sea.
 *
 * Every function adds what it makes to `own`, which the world disposes.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Material,
  type Texture,
} from "three";
import type { Surface } from "../../track/geometry";
import type { QualitySettings } from "../quality";
import { roadTexture } from "./textures";
import { groundDetail, roadGlowTexture, surfaceTexture, type GroundDetail } from "./themeTextures";
import type { ThemeStyle } from "./themes";

export type Own = { dispose(): void }[];

/** Lets a Lambert material take a per-vertex `aGlow` (0..1) as extra light of `colour`: cracks and hot banks that need no light. */
function glowFromVertices(material: MeshLambertMaterial, colour: Color, strength: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowColour = { value: colour.clone().multiplyScalar(strength) };
    // The painted cracks (the emissive map) glow on level ground only: on a mountainside they would stretch into a web.
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vFlat;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;\nvFlat = smoothstep(0.8, 0.97, normal.y);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nvarying float vFlat;\nuniform vec3 uGlowColour;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vFlat;\ntotalEmissiveRadiance += uGlowColour * vGlow;");
  };
}

export interface GroundMaterial {
  material: MeshLambertMaterial;
  detail: GroundDetail | null;
}

export function groundMaterial(style: ThemeStyle, quality: QualitySettings, own: Own): GroundMaterial {
  const detail = groundDetail(style, quality.anisotropy, quality.tier === "low" ? 256 : 512);
  const material = new MeshLambertMaterial({ vertexColors: true, map: detail?.map ?? null });
  own.push(material);
  if (detail) {
    own.push(detail.map);
    if (detail.glow) {
      own.push(detail.glow);
      material.emissive = new Color(0.55, 0.5, 0.5);
      material.emissiveMap = detail.glow;
    }
  }
  if (style.id === "volcano") glowFromVertices(material, new Color(1.0, 0.36, 0.07), 1.3);
  return { material, detail };
}

export function roadMaterial(style: ThemeStyle, quality: QualitySettings, own: Own): Material {
  const map = roadTexture(style, quality.anisotropy, quality.roadTexture);
  own.push(map);
  const glow = roadGlowTexture(style, quality.anisotropy, quality.roadTexture);
  if (glow) own.push(glow);
  if (style.id === "space") {
    // A ribbon of dark glass with light in it: you see the stars through it, a little.
    const m = new MeshLambertMaterial({ map, emissive: new Color(1, 1, 1), emissiveMap: glow, transparent: true, opacity: 0.8 });
    own.push(m);
    return m;
  }
  const m = new MeshLambertMaterial({ map });
  if (glow) {
    m.emissive = new Color(0.6, 0.5, 0.48);
    m.emissiveMap = glow;
  }
  own.push(m);
  return m;
}

/** A patch of ice (glossy), mud, sand, snow or grass laid on the road. */
export function patchMaterial(kind: Exclude<Surface, "boost">, quality: QualitySettings, own: Own): Material {
  const map: Texture = surfaceTexture(kind, quality.anisotropy);
  own.push(map);
  const common = { vertexColors: true, map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } as const;
  const m =
    kind === "ice"
      ? new MeshPhongMaterial({ ...common, specular: new Color(1, 1, 1), shininess: 140, opacity: 0.92 })
      : new MeshLambertMaterial({ ...common });
  own.push(m);
  return m;
}

/** Bright ribbons added to what is behind them: the space road's edges, a holographic rail. */
export function additiveMaterial(own: Own): Material {
  const m = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide });
  own.push(m);
  return m;
}

// ─── Lava ────────────────────────────────────────────────────────────────────

const lavaVertex = /* glsl */ `
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

const lavaFragment = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 p = vWorld.xz * 0.06;
  // Slow flow, two layers drifting different ways.
  float n1 = fbm(p + vec2(uTime * 0.03, uTime * 0.012));
  float n2 = fbm(p * 2.1 - vec2(uTime * 0.02, -uTime * 0.035) + 7.0);
  float n = n1 * 0.6 + n2 * 0.4;
  // Dark crust floats on it in plates; between the plates it glows.
  float crust = smoothstep(0.52, 0.64, n);
  vec3 hot = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.8, 0.22), smoothstep(0.25, 0.5, n2));
  vec3 col = hot * 2.0;
  vec3 plate = mix(vec3(0.16, 0.035, 0.03), vec3(0.4, 0.1, 0.04), n2);
  col = mix(col, plate, crust * 0.85);
  // Glowing seams between the plates.
  float seam = smoothstep(0.03, 0.0, abs(n - 0.58));
  col += vec3(1.0, 0.55, 0.12) * seam * 1.2;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface Animated {
  material: ShaderMaterial;
  update(time: number): void;
}

export function lavaMaterial(own: Own): Animated {
  const uniforms = UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]);
  const material = new ShaderMaterial({ vertexShader: lavaVertex, fragmentShader: lavaFragment, uniforms, fog: true });
  own.push(material);
  return {
    material,
    update(time) {
      uniforms.uTime!.value = time;
    },
  };
}

// ─── The sea around the palm island ──────────────────────────────────────────

const seaVertex = lavaVertex;

const seaFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float a = cos(p.x * 0.35 + t * 1.1) + 0.6 * cos(p.x * 1.1 - p.y * 0.9 + t * 1.8) + 0.35 * cos(p.y * 2.3 + t * 2.4);
  float b = cos(p.y * 0.31 - t * 0.8) + 0.6 * cos(p.y * 1.3 + p.x * 0.8 - t * 1.5) + 0.35 * cos(p.x * 2.1 - t * 2.1);
  vec3 n = normalize(vec3(a * 0.045, 1.0, b * 0.045));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 220.0);
  // Sparkles on the ripples.
  float g = pow(max(0.0, sin(p.x * 2.9 + t * 1.3) * sin(p.y * 3.3 - t * 1.1) * sin((p.x + p.y) * 1.9 + t * 0.7)), 5.0);
  vec3 tint = vec3(0.1, 0.8, 0.82);
  vec3 col = mix(tint, uSky, fres * 0.8) + uSunColour * spec * 2.4 + uSky * g * 0.5;
  // Mostly clear over the shallows so the sand shows through; milkier with the glancing angle.
  float alpha = clamp(0.42 + fres * 0.4 + spec * 0.5 + g * 0.3, 0.0, 0.92);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function seaMaterial(style: ThemeStyle, own: Own): Animated {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uSky: { value: new Color(style.sky.horizon) },
      uSunDir: { value: new Vector3(...style.sky.sunDir).normalize() },
      uSunColour: { value: new Color(style.sky.sunColour) },
    },
  ]);
  const material = new ShaderMaterial({ vertexShader: seaVertex, fragmentShader: seaFragment, uniforms, fog: true, transparent: true, depthWrite: false });
  own.push(material);
  return {
    material,
    update(time) {
      uniforms.uTime!.value = time;
    },
  };
}
