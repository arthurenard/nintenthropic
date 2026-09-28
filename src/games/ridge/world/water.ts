/**
 * The river and the reservoir: dark mountain water that shows the dawn sky
 * where it looks away from you (a Fresnel reflection of the sky itself,
 * rippled by two layers of moving wavelets), running down the valley along
 * its mesh's UVs, pale and broken over the shallows at its banks, still on
 * the reservoir. In the valley's air like everything else.
 */
import { Color, ShaderMaterial, type Texture } from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
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
varying vec3 vWorld;
varying vec2 vUv;
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
  vec2 p = vec2(vUv.x * 7.0, vUv.y * 4.0 - uTime * uFlow);
  vec2 g = ripple(p, uTime) * mix(0.1, 0.03, smoothstep(100.0, 900.0, dist));
  vec3 n = normalize(vec3(g.x, 1.0, g.y));
  vec3 view = normalize(cameraPosition - wp);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  vec3 r = reflect(-view, n);
  r.y = max(r.y, 0.02);
  vec3 sky = skyAt(normalize(r));
  vec2 light = atmoLight(wp);
  float sun = smoothstep(light.r - 0.012, light.r + 0.012, uSunElev);
  vec3 body = mix(uDeep, uShallow, 0.25) * (atmoAmbient(vec3(0.0, 1.0, 0.0), light.g) + uSunColor * sun * 0.35);
  // The sky it shows is dimmed by the valley's shade on the water (the far bank's dark trees stand in it too).
  vec3 col = mix(body, sky * 0.62, fres * 0.85);
  // White water over the stones at the banks, where the river is shallow and quick.
  float edge = uBanks * (1.0 - smoothstep(0.0, 0.2, min(vUv.x, 1.0 - vUv.x)));
  float foam = smoothstep(0.55, 0.8, atmoNoise(vec2(vUv.x * 18.0, vUv.y * 6.0 - uTime * uFlow * 3.0))) * edge;
  col = mix(col, vec3(0.78, 0.82, 0.84) * (atmoAmbient(vec3(0.0, 1.0, 0.0), 1.0) + uSunColor * sun * 0.5), foam * 0.6);
  col = atmoAir(col, wp);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function waterMaterial(sky: Texture, atmosphere: AtmosphereUniforms, kind: "river" | "reservoir"): ShaderMaterial {
  return new ShaderMaterial({
    name: `water.${kind}`,
    uniforms: {
      ...atmosphere,
      uSky: { value: sky },
      uDeep: { value: new Color(kind === "river" ? "#1a2f2c" : "#142a2e") },
      uShallow: { value: new Color("#3d5a4e") },
      uFlow: { value: kind === "river" ? 0.9 : 0.05 },
      uBanks: { value: kind === "river" ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
