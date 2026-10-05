/**
 * The sky: a gradient dome with painted cloud layers, a sun (or moon) with
 * its corona, distant ridges and skylines that fade into the haze, and stars
 * at night. It follows the camera, so it is always at infinity, and it is
 * drawn LAST among the opaque things at the far plane, so only the pixels no
 * world covers are ever shaded. Its horizon colour is the fog colour, which
 * is what lets the far ground melt into it without a seam.
 *
 * The same shader, with the ground below the horizon and a hotter sun,
 * is what the environment map (the reflections on everything glossy) is
 * rendered from.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
  PMREMGenerator,
} from "three";
import { seededRandom } from "../../../engine/random";
import { skylineFor, type RidgeKind } from "./look";
import type { ThemeStyle } from "./themes";

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  #ifdef AT_FAR
  gl_Position.z = gl_Position.w;
  #endif
}
`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uSunSize;
uniform float uSunPower;
uniform float uTime;
uniform float uMode;
uniform float uClouds;
uniform float uNight;
uniform float uEnv;
uniform vec4 uRidgeA;
uniform vec4 uRidgeB;
uniform vec4 uRidgeC;
uniform vec3 uRidgeColA;
uniform vec3 uRidgeColB;
uniform vec3 uRidgeColC;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float h31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * n3(p); p *= 2.02; a *= 0.5; }
  return s;
}

// Height of a ridge line (in elevation, 0..1) at azimuth angle a. kind: 1 hills, 2 peaks, 3 mesas, 4 skyline, 5 cones.
float ridgeHeight(float a, vec4 r) {
  float kind = r.z;
  float seed = r.w;
  float x = a * r.y + seed;
  float h = 0.0;
  if (kind < 1.5) {
    h = fbm2(vec2(x, seed)) * 1.25 - 0.35;
  } else if (kind < 2.5) {
    float n = fbm2(vec2(x * 1.4, seed));
    h = (1.0 - abs(n * 2.0 - 1.0)) * 1.1 - 0.35 + 0.25 * fbm2(vec2(x * 7.0, seed));
  } else if (kind < 3.5) {
    float n = fbm2(vec2(x * 0.8, seed));
    h = floor(n * 4.0) / 4.0 * 1.3 - 0.1 + 0.03 * n2(vec2(x * 30.0, seed));
  } else if (kind < 4.5) {
    float cell = floor(x * 3.0);
    float hh = h21(vec2(cell, seed));
    h = 0.15 + 0.85 * hh * hh;
  } else {
    float n = fbm2(vec2(x * 0.5, seed));
    float cone = max(0.0, 1.0 - abs(fract(x * 0.35 + n * 0.3) - 0.5) * 3.2);
    h = cone * 1.1 - 0.05;
  }
  return max(h, 0.0) * r.x;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.2, t));
  col = mix(col, uZenith, smoothstep(0.12, 0.85, t));
  vec3 below = mix(uHorizon * 0.92, uGround, uEnv);
  col = mix(col, below, smoothstep(0.0, mix(0.25, 0.04, uEnv), -h));
  vec3 sd = normalize(uSunDir);
  float s = clamp(dot(d, sd), 0.0, 1.0);
  col += uGlow * (pow(s, 5.0) * 0.28 + pow(s, 32.0) * 0.5 + pow(s, 300.0) * 1.2);

  // Clouds: two layers of soft cumulus, lit from the sun's side with shaded undersides and a bright rim.
  if (uClouds > 0.5 && h > 0.0) {
    vec2 sx = normalize(sd.xz + 1e-4);
    float fade = smoothstep(0.02, 0.22, h);
    float top = 0.0;
    for (int L = 0; L < 2; L++) {
      float fl = float(L);
      float scale = mix(1.15, 2.4, fl);
      vec2 p = d.xz / (h + mix(0.10, 0.2, fl)) * scale + vec2(uTime * mix(0.004, 0.007, fl), 3.0 + fl * 11.0);
      float base = fbm2(p);
      float dens = smoothstep(mix(0.52, 0.58, fl), mix(0.76, 0.82, fl), base);
      float toward = fbm2(p + sx * 0.16);
      float dens2 = smoothstep(mix(0.52, 0.58, fl), mix(0.76, 0.82, fl), toward);
      float shade = clamp((dens2 - dens) * 2.2 + (dens - 0.2) * 0.55, 0.0, 1.0);
      vec3 cc = mix(uCloudLit * 1.12, uCloudShade, shade);
      // A silver lining where the cloud thins toward the sun.
      cc += uGlow * pow(s, 6.0) * (1.0 - dens) * dens * 3.0;
      float a = dens * fade * mix(0.95, 0.75, fl) * (1.0 - uEnv * 0.3);
      col = mix(col, cc, a);
    }
  }

  // Distant ridges and skylines, three layers, each hazier than the one before.
  if (uEnv < 0.5) {
    float az = atan(d.z, d.x);
    for (int L = 0; L < 3; L++) {
      vec4 rp = L == 0 ? uRidgeA : L == 1 ? uRidgeB : uRidgeC;
      vec3 rc = L == 0 ? uRidgeColA : L == 1 ? uRidgeColB : uRidgeColC;
      if (rp.x <= 0.0) continue;
      float top = ridgeHeight(az, rp);
      float aa = 0.0025;
      float m = smoothstep(top + aa, top - aa, h) * step(-0.02, h);
      vec3 rcol = rc;
      // Snow on the high peaks, windows in the dark towers.
      if (rp.z > 1.5 && rp.z < 2.5) rcol = mix(rcol, vec3(0.92, 0.95, 1.0) * (0.3 + 0.7 * (1.0 - uNight)), smoothstep(top * 0.6, top * 0.85, h) * 0.9);
      if (rp.z > 3.5 && rp.z < 4.5 && uNight > 0.5) {
        vec2 w = vec2(az * rp.y * 60.0, h * 140.0);
        float lit = step(0.72, h21(floor(w)) ) * step(0.2, fract(w.x)) * step(0.25, fract(w.y)) * step(h, top - 0.004);
        rcol += vec3(1.0, 0.8, 0.45) * lit * 1.4;
      }
      // Lit on the sun's side: a thin bright rim along the top.
      col = mix(col, rcol, m);
    }
  }

  if (uMode > 0.5 && uMode < 1.5) {
    // An aurora: curtains of green rising to violet, rippling slowly, in one part of the sky.
    float ang = atan(d.z, d.x);
    float wave = sin(ang * 2.0 + uTime * 0.07) + 0.5 * sin(ang * 5.0 - uTime * 0.11) + 0.3 * sin(ang * 11.0 + uTime * 0.2);
    float base = 0.2 + 0.06 * wave;
    float up = smoothstep(base - 0.02, base + 0.04, d.y) * (1.0 - smoothstep(base + 0.16, base + 0.55, d.y));
    float rays = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(ang * 70.0 + sin(ang * 9.0 + uTime * 0.15) * 3.0 + d.y * 8.0), 2.0);
    float where = smoothstep(-0.35, 0.55, sin(ang * 1.1 + 0.6));
    vec3 aur = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.2, 1.0), smoothstep(base, base + 0.5, d.y));
    col += aur * up * rays * where * 0.8;
  } else if (uMode > 1.5) {
    // A nebula: clouds of violet and blue, a pink bloom and a faint galactic band.
    float n = fbm3(d * 2.4 + 3.0);
    float m = fbm3(d * 3.6 - 7.0 + vec3(0.0, uTime * 0.004, 0.0));
    vec3 neb = mix(vec3(0.55, 0.08, 0.75), vec3(0.08, 0.45, 0.95), m);
    col += neb * smoothstep(0.42, 0.78, n) * 0.6;
    col += vec3(1.0, 0.35, 0.55) * smoothstep(0.6, 0.85, fbm3(d * 2.0 + 11.0)) * 0.4;
    float band = exp(-pow(d.y * 2.2 + 0.25 * sin(atan(d.z, d.x) * 2.0), 2.0) * 5.0);
    col += vec3(0.5, 0.45, 0.9) * band * 0.2 * fbm3(d * 8.0);
  }
  float edge = cos(uSunSize);
  float disc = smoothstep(edge - 0.0007, edge + 0.0007, s);
  col = mix(col, uSunColour * uSunPower, disc);
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Sky {
  /** Add to the scene; move it to the camera before drawing each view. */
  group: Group;
  sunDir: Vector3;
  /** Moves the clouds, the aurora and the nebula; `time` is the picture's clock. */
  update(time: number): void;
  /** The world's reflections: this sky (with the ground below) as a prefiltered environment map. Dispose it when done. */
  environment(renderer: WebGLRenderer, groundColour: string): Texture;
  dispose(): void;
}

const KIND: Record<RidgeKind, number> = { hills: 1, peaks: 2, mesas: 3, skyline: 4, cones: 5 };

export function createSky(style: ThemeStyle): Sky {
  const group = new Group();
  const sunDir = new Vector3(...style.sky.sunDir).normalize();
  const geometry = new SphereGeometry(1200, 48, 24);
  const ridges = skylineFor(style.id);
  const ridgeUniform = (i: number) => {
    const r = ridges[i];
    return r ? new Vector4(r.height, r.frequency, KIND[r.kind], r.seed) : new Vector4(0, 1, 1, 0);
  };
  const ridgeColour = (i: number) => {
    const r = ridges[i];
    // A ridge is its own colour mixed with the haze: the farther, the more haze.
    const c = new Color(r?.colour ?? "#000000");
    return c.lerp(new Color(style.sky.horizon), r?.haze ?? 0.5);
  };
  const uniforms = {
    uZenith: { value: new Color(style.sky.zenith) },
    uMid: { value: new Color(style.sky.mid) },
    uHorizon: { value: new Color(style.sky.horizon) },
    uGround: { value: new Color(style.light.groundColour) },
    uSunDir: { value: sunDir },
    uSunColour: { value: new Color(style.sky.sunColour) },
    uGlow: { value: new Color(style.sky.glow) },
    uCloudLit: { value: new Color(style.sky.cloudColour) },
    uCloudShade: { value: new Color(style.sky.cloudShade) },
    uSunSize: { value: style.sky.sunSize },
    uSunPower: { value: style.night ? 9 : 14 },
    uTime: { value: 0 },
    uMode: { value: style.sky.extras === "aurora" ? 1 : style.sky.extras === "nebula" ? 2 : 0 },
    uClouds: { value: style.sky.clouds ? 1 : 0 },
    uNight: { value: style.night ? 1 : 0 },
    uEnv: { value: 0 },
    uRidgeA: { value: ridgeUniform(0) },
    uRidgeB: { value: ridgeUniform(1) },
    uRidgeC: { value: ridgeUniform(2) },
    uRidgeColA: { value: ridgeColour(0) },
    uRidgeColB: { value: ridgeColour(1) },
    uRidgeColC: { value: ridgeColour(2) },
  };
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    defines: { AT_FAR: "" },
    uniforms,
  });
  const dome = new Mesh(geometry, material);
  dome.frustumCulled = false;
  dome.userData.noShadow = true;
  // After every other opaque thing, at the far plane: only the pixels left empty are shaded.
  dome.renderOrder = 1000;
  group.add(dome);

  let stars: Points | null = null;
  if (style.sky.stars) {
    const rnd = seededRandom(99);
    // Deep space has stars all round, and more of them.
    const everywhere = style.sky.extras === "nebula";
    const count = everywhere ? 2600 : 900;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the upper hemisphere, thinning toward the horizon.
      const y = everywhere ? rnd() * 2 - 1 : Math.pow(rnd(), 0.8) * 0.96 + 0.04;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 1100;
      pos[i * 3 + 1] = y * 1100;
      pos[i * 3 + 2] = Math.sin(a) * r * 1100;
      const warm = rnd();
      const b = 0.35 + rnd() * 0.65;
      // A few stars are blue-white or amber: a sky of one colour looks painted.
      const tint = everywhere ? (warm < 0.2 ? [1.0, 0.7, 0.5] : warm > 0.8 ? [0.6, 0.8, 1.0] : [0.9, 0.92, 1.0]) : [0.8 + 0.2 * warm, 0.85 + 0.1 * warm, 1];
      // The brightest are HDR: they bloom a little.
      const boost = b > 0.92 ? 2.4 : 1;
      col[i * 3] = b * tint[0]! * boost;
      col[i * 3 + 1] = b * tint[1]! * boost;
      col[i * 3 + 2] = b * tint[2]! * boost;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    stars = new Points(
      g,
      new PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true, blending: AdditiveBlending }),
    );
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    group.add(stars);
  }

  return {
    group,
    sunDir,
    update(time) {
      uniforms.uTime.value = time;
    },
    environment(renderer, groundColour) {
      // The same sky, small, with the ground below the horizon and no ridges in the way, into a cube and prefiltered.
      const env = new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          ...Object.fromEntries(Object.entries(uniforms).map(([k, v]) => [k, { value: v.value }])),
          uGround: { value: new Color(groundColour).multiplyScalar(0.8) },
          uEnv: { value: 1 },
          uSunPower: { value: style.night ? 16 : 40 },
          uSunSize: { value: style.sky.sunSize * 1.5 },
        },
      });
      const mesh = new Mesh(new SphereGeometry(50, 32, 16), env);
      const scene = new Scene();
      scene.add(mesh);
      const pmrem = new PMREMGenerator(renderer);
      const target = pmrem.fromScene(scene, 0, 0.1, 200);
      pmrem.dispose();
      mesh.geometry.dispose();
      env.dispose();
      return target.texture;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      if (stars) {
        stars.geometry.dispose();
        (stars.material as PointsMaterial).dispose();
      }
    },
  };
}
