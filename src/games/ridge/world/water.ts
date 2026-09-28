/**
 * The river and the reservoir: dark mountain water that shows the dawn sky
 * where it looks away from you (a Fresnel reflection of the sky itself,
 * rippled by two layers of moving wavelets), running down the valley along
 * its mesh's UVs, pale and broken over the shallows at its banks, still on
 * the reservoir. In the valley's air like everything else.
 */
import { Color, DoubleSide, ShaderMaterial, type Texture } from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
// The real river's COLOR_0 is data: r white water, g depth (0 at the banks).
varying vec2 vData;
void main() {
  vUv = uv;
  #if defined(USE_COLOR_ALPHA) || defined(USE_COLOR)
  vData = color.rg;
  #else
  vData = vec2(0.0, 1.0);
  #endif
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSky;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uFlow;
uniform float uBanks;
uniform float uAlong;
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vData;
${ATMOSPHERE_GLSL}

/** Wavelets: the gradient of two layers of drifting noise. */
vec2 ripple(vec2 p, float t) {
  float e = 0.35;
  vec2 q1 = p * 0.9 + vec2(0.0, t * 0.6);
  vec2 q2 = p * 2.3 + vec2(t * 0.25, t * 1.1);
  float h = atmoNoise(q1) + 0.5 * atmoNoise(q2);
  float hx = atmoNoise(q1 + vec2(e, 0.0)) + 0.5 * atmoNoise(q2 + vec2(e, 0.0));
  float hy = atmoNoise(q1 + vec2(0.0, e)) + 0.5 * atmoNoise(q2 + vec2(0.0, e));
  return vec2(hx - h, hy - h) / e;
}

vec3 skyAt(vec3 d) {
  float u = atan(d.z, d.x) * 0.15915494 + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5;
  return texture2D(uSky, vec2(u, v)).rgb;
}

void main() {
  vec3 wp = vWorld;
  float dist = length(wp - cameraPosition);
  // The river runs along its UV's v; the reservoir barely moves.
  vec2 p = vec2(vUv.x * 7.0, vUv.y * uAlong - uTime * uFlow);
  vec2 g = ripple(p, uTime) * mix(0.1, 0.03, smoothstep(100.0, 900.0, dist));
  vec3 n = normalize(vec3(g.x, 1.0, g.y));
  vec3 view = normalize(cameraPosition - wp);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  vec3 r = reflect(-view, n);
  r.y = max(r.y, 0.02);
  vec3 sky = skyAt(normalize(r));
  vec2 light = atmoLight(wp);
  float sun = smoothstep(light.r - 0.012, light.r + 0.012, uSunElev);
  vec3 body = mix(uShallow, uDeep, 0.25 + 0.5 * vData.y) * (atmoAmbient(vec3(0.0, 1.0, 0.0), light.g) + uSunColor * sun * 0.35);
  // The sky it shows is dimmed by the valley's shade on the water (the far bank's dark trees stand in it too).
  vec3 col = mix(body, sky * 0.4, fres * 0.7);
  // White water over the stones at the banks, where the river is shallow and quick.
  float edge = uBanks * (1.0 - smoothstep(0.0, 0.2, min(vUv.x, 1.0 - vUv.x)));
  float churn = atmoNoise(vec2(vUv.x * 18.0, vUv.y * uAlong * 1.5 - uTime * uFlow * 3.0));
  float foam = max(smoothstep(0.55, 0.8, churn) * edge, vData.x * smoothstep(0.3, 0.7, churn));
  col = mix(col, vec3(0.78, 0.82, 0.84) * (atmoAmbient(vec3(0.0, 1.0, 0.0), 1.0) + uSunColor * sun * 0.5), foam * 0.6);
  col = atmoAir(col, wp);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The water's material. `data` is true for the real river, whose COLOR_0
 * holds white water and depth and whose UV.v runs in metres downstream (the
 * placeholder's banks are painted from its UV.u instead).
 */
export function waterMaterial(sky: Texture, atmosphere: AtmosphereUniforms, kind: "river" | "reservoir", data = false): ShaderMaterial {
  return new ShaderMaterial({
    name: `water.${kind}`,
    uniforms: {
      ...atmosphere,
      uSky: { value: sky },
      uDeep: { value: new Color(kind === "river" ? "#1a2f2c" : "#142a2e") },
      uShallow: { value: new Color("#3d5a4e") },
      uFlow: { value: kind === "river" ? 0.9 : 0.05 },
      uBanks: { value: kind === "river" && !data ? 1 : 0 },
      uAlong: { value: data ? 0.35 : 4 },
    },
    vertexColors: data,
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

const MIST_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  #if defined(USE_COLOR_ALPHA)
  vFade = color.a;
  #else
  vFade = 1.0;
  #endif
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const MIST_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
varying float vFade;
${ATMOSPHERE_GLSL}
void main() {
  // Wisps drifting down the valley with the wind, thinning as the morning burns them off.
  vec2 q = vec2(vUv.x * 2.5, vUv.y * 0.012) + uWindDrift * vec2(1.0, 4.0) + vec2(0.0, uTime * 0.004);
  float n = atmoNoise(q) * 0.65 + atmoNoise(q * 2.7 + 3.1) * 0.35;
  float thick = clamp(uMistDensity / 0.0022, 0.0, 1.0);
  float a = vFade * smoothstep(0.25, 0.85, n) * 0.55 * thick;
  // Fading as it nears the eye, so a ribbon never shows its edge up close.
  a *= smoothstep(40.0, 160.0, length(vWorld - cameraPosition));
  float shade = mix(0.35, 1.0, atmoSun(vWorld, 0.0));
  vec3 col = uMistColor * shade * 1.15;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The real valley's mist ribbons over the river (`mist.river.<n>`): soft, drifting, never an edge. */
export function mistMaterial(atmosphere: AtmosphereUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: "mist.river",
    uniforms: { ...atmosphere },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
  });
}
