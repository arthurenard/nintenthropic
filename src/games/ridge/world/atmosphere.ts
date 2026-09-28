/**
 * The air between the ridge and everything in the valley, and the dawn's
 * light on it all - one piece of GLSL every material in the valley shares:
 *
 * - Aerial perspective: with distance a surface's own colour gives way to
 *   the sky's, bluer first (blue light scatters most), until at the far
 *   peaks it meets the horizon of the sky behind them without a seam.
 * - Height mist: a thin mist lying low over the valley floor and thickest
 *   by the river, drifting with the wind and burning off as the morning
 *   goes on.
 * - The sun's reach: a light map worked out from the ground itself says,
 *   for every point of the valley, how high the ridge and the mountains
 *   behind the player stand toward the sun; the sun lights a point only
 *   once it has climbed above that. So the valley floor lies in blue shadow
 *   while the peaks glow, and the shadow line creeps down the far slope as
 *   the sun rises. The same map carries the ground's ambient occlusion.
 *
 * Standard materials (the buildings, the people, the vehicles) are patched
 * to use it (`patchStandard`); the terrain, the water and the forest have
 * their own shaders and include it directly.
 */
import { Color, DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector2, Vector3, Vector4, type Material, type Texture } from "three";

/** The uniforms every valley material shares: one object, updated once a frame. */
export interface AtmosphereUniforms {
  uHazeSky: { value: Texture };
  uHazeBlue: { value: Color };
  uHazeDensity: { value: number };
  uMistColor: { value: Color };
  uMistDensity: { value: number };
  uMistBase: { value: number };
  uMistFalloff: { value: number };
  uWindDrift: { value: Vector2 };
  uLight: { value: Texture | null };
  uLightBounds: { value: Vector4 };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
  uSunElev: { value: number };
  uSkyUp: { value: Color };
  uSkyLow: { value: Color };
  uBounce: { value: Color };
  uTime: { value: number };
}

export function atmosphereUniforms(): AtmosphereUniforms {
  return {
    uHazeSky: { value: flatSky(new Color("#b8c4d6")) },
    // Linear light: the shade of dawn is dim and blue, the low sun strong and gold.
    uHazeBlue: { value: new Color(0.16, 0.21, 0.33) },
    uHazeDensity: { value: 0.00032 },
    uMistColor: { value: new Color(0.3, 0.34, 0.43) },
    uMistDensity: { value: 0.0014 },
    uMistBase: { value: -60 },
    uMistFalloff: { value: 0.09 },
    uWindDrift: { value: new Vector2() },
    uLight: { value: null },
    uLightBounds: { value: new Vector4(0, 0, 1, 1) },
    uSunDir: { value: new Vector3(-0.5, 0.1, 0.85).normalize() },
    uSunColor: { value: new Color(3.1, 1.95, 1.15) },
    uSunElev: { value: 0.1 },
    uSkyUp: { value: new Color(0.3, 0.4, 0.6) },
    uSkyLow: { value: new Color(0.38, 0.34, 0.4) },
    uBounce: { value: new Color(0.09, 0.1, 0.085) },
    uTime: { value: 0 },
  };
}

/** A one-colour stand-in for the sky's horizon, until the real one is sampled. */
function flatSky(c: Color): DataTexture {
  const data = new Uint8Array([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255]);
  const t = new DataTexture(data, 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * The sky's colour just above the horizon all the way round, from an
 * equirectangular sky image: what the haze in each direction turns to, so
 * the far peaks fade into the sky behind them.
 */
export function horizonRing(sky: Texture, samples = 128): DataTexture | null {
  const img = sky.image as CanvasImageSource & { width?: number; height?: number };
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = samples;
  c.height = 64;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, samples, 64);
  // Three's mapping: the canvas's middle row is the horizon; a few degrees above it.
  const row = Math.round(64 * (0.5 - 3 / 180)) - 1;
  const band = g.getImageData(0, row - 1, samples, 3).data;
  const data = new Uint8Array(samples * 4);
  for (let i = 0; i < samples; i++) {
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let r = 0; r < 3; r++) s += band[(r * samples + i) * 4 + k] as number;
      data[i * 4 + k] = Math.round(s / 3);
    }
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, samples, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The shared GLSL: uniforms, noise, the sun's reach, the ambient, the air. Include after three's common chunk. */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform sampler2D uHazeSky;
uniform vec3 uHazeBlue;
uniform float uHazeDensity;
uniform vec3 uMistColor;
uniform float uMistDensity;
uniform float uMistBase;
uniform float uMistFalloff;
uniform vec2 uWindDrift;
uniform sampler2D uLight;
uniform vec4 uLightBounds;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunElev;
uniform vec3 uSkyUp;
uniform vec3 uSkyLow;
uniform vec3 uBounce;
uniform float uTime;

float atmoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atmoNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmoHash(i), atmoHash(i + vec2(1.0, 0.0)), f.x), mix(atmoHash(i + vec2(0.0, 1.0)), atmoHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** The light map at a point: r the horizon's angle toward the sun (radians, + above level), g the sky's reach (ambient occlusion). */
vec2 atmoLight(vec3 wp) {
  vec2 uv = (wp.xz - uLightBounds.xy) / (uLightBounds.zw - uLightBounds.xy);
  vec4 l = texture2D(uLight, clamp(uv, 0.001, 0.999));
  return l.rg;
}

/** How much of the sun reaches a point lifted this many metres above the ground's horizon there: 0 in the shadow, 1 in the sun. */
float atmoSun(vec3 wp, float lift) {
  float horizon = atmoLight(wp).r - lift * 0.0004;
  // A soft edge: the sun's disc and the hills' trees make a penumbra of a degree or so.
  return smoothstep(horizon - 0.012, horizon + 0.012, uSunElev);
}

/** The sky's light from above and the valley's bounce from below, for a surface facing n. */
vec3 atmoAmbient(vec3 n, float ao) {
  float up = n.y * 0.5 + 0.5;
  vec3 sky = mix(uSkyLow, uSkyUp, smoothstep(0.35, 1.0, up));
  return mix(uBounce, sky, smoothstep(0.0, 0.6, up)) * ao;
}

/** The air between the eye and a point: aerial perspective and the mist. */
vec3 atmoAir(vec3 col, vec3 wp) {
  vec3 v = wp - cameraPosition;
  float d = max(length(v), 0.001);
  vec3 dir = v / d;
  float az = atan(dir.z, dir.x) * 0.15915494 + 0.5;
  vec3 horizon = texture2D(uHazeSky, vec2(az, 0.5)).rgb;
  // Near, the haze is the blue of distance; far off it becomes the sky's own horizon.
  vec3 haze = mix(uHazeBlue, horizon, smoothstep(300.0, 4500.0, d));
  vec3 ext = exp(-d * uHazeDensity * vec3(0.62, 0.86, 1.3));
  col = col * ext + haze * (1.0 - ext);
  // The mist: denser low down, its thickness integrated along the ray.
  float k = uMistFalloff;
  float h0 = max(cameraPosition.y - uMistBase, 0.0);
  float h1 = max(wp.y - uMistBase, 0.0);
  float dh = h1 - h0;
  float avg = abs(dh) > 0.05 ? (exp(-k * h0) - exp(-k * h1)) / (k * dh) : exp(-k * h0);
  // Patchy, and drifting with the wind.
  vec2 q = wp.xz * 0.006 + uWindDrift;
  float patchy = 0.45 + 0.9 * atmoNoise(q) * atmoNoise(q * 2.3 + 7.0);
  float mist = 1.0 - exp(-uMistDensity * avg * d * patchy);
  col = mix(col, uMistColor, clamp(mist, 0.0, 0.85));
  return col;
}
`;

const PATCH_KEY = "ridge-atmo";

/**
 * Patch a standard material to the valley's air: the aerial perspective and
 * the mist replace three's fog, and (unless `sunFromMap` is false: the
 * characters, whose sun the game decides) the directional light reaches it
 * only where the light map says the sun does. Chains any patch it already
 * had (the engine's rigs have one).
 */
export function patchStandard(material: Material, uniforms: AtmosphereUniforms, sunFromMap = true): void {
  // Once only, however many meshes share it.
  if (material.userData["ridgeAtmo"]) return;
  material.userData["ridgeAtmo"] = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAtmoWorld;")
      .replace(
        "#include <project_vertex>",
        [
          "#include <project_vertex>",
          "{",
          "  vec4 atmoW = vec4( transformed, 1.0 );",
          "  #ifdef USE_INSTANCING",
          "  atmoW = instanceMatrix * atmoW;",
          "  #endif",
          "  vAtmoWorld = ( modelMatrix * atmoW ).xyz;",
          "}",
        ].join("\n"),
      );
    let frag = shader.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vAtmoWorld;\n${ATMOSPHERE_GLSL}`);
    if (sunFromMap) {
      frag = frag.replace(
        "getDirectionalLightInfo( directionalLight, directLight );",
        "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= atmoSun( vAtmoWorld, 2.0 );",
      );
    }
    frag = frag.replace("#include <fog_fragment>", "gl_FragColor.rgb = atmoAir( gl_FragColor.rgb, vAtmoWorld );");
    shader.fragmentShader = frag;
  };
  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ""}|${PATCH_KEY}${sunFromMap ? "+sun" : ""}`;
  material.needsUpdate = true;
}
