/**
 * The sky: a gradient dome with a sun (or moon) and halo, plus stars at night.
 * It is drawn behind everything, ignores fog, and follows the camera, so it
 * is always at infinity. Its horizon colour is the fog colour, which is what
 * lets the far ground melt into it without a seam.
 */
import { AdditiveBlending, BackSide, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, Points, PointsMaterial, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { seededRandom } from "../../../engine/random";
import type { ThemeStyle } from "./themes";

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColour;
uniform vec3 uGlow;
uniform float uSunSize;
uniform float uTime;
uniform float uMode;
varying vec3 vDir;
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
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
  col = mix(col, uZenith, smoothstep(0.14, 0.9, t));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, 0.25, -h));
  float s = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  col += uGlow * (pow(s, 6.0) * 0.30 + pow(s, 40.0) * 0.45);
  if (uMode > 0.5 && uMode < 1.5) {
    // An aurora: curtains of green rising to violet, rippling slowly, in one part of the sky.
    float ang = atan(d.z, d.x);
    float wave = sin(ang * 2.0 + uTime * 0.07) + 0.5 * sin(ang * 5.0 - uTime * 0.11) + 0.3 * sin(ang * 11.0 + uTime * 0.2);
    float base = 0.2 + 0.06 * wave;
    float up = smoothstep(base - 0.02, base + 0.04, d.y) * (1.0 - smoothstep(base + 0.16, base + 0.55, d.y));
    float rays = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(ang * 70.0 + sin(ang * 9.0 + uTime * 0.15) * 3.0 + d.y * 8.0), 2.0);
    float where = smoothstep(-0.35, 0.55, sin(ang * 1.1 + 0.6));
    vec3 aur = mix(vec3(0.1, 1.0, 0.55), vec3(0.6, 0.2, 1.0), smoothstep(base, base + 0.5, d.y));
    col += aur * up * rays * where * 0.62;
  } else if (uMode > 1.5) {
    // A nebula: clouds of violet and blue, a pink bloom and a faint galactic band.
    float n = fbm3(d * 2.4 + 3.0);
    float m = fbm3(d * 3.6 - 7.0 + vec3(0.0, uTime * 0.004, 0.0));
    vec3 neb = mix(vec3(0.55, 0.08, 0.75), vec3(0.08, 0.45, 0.95), m);
    col += neb * smoothstep(0.42, 0.78, n) * 0.55;
    col += vec3(1.0, 0.35, 0.55) * smoothstep(0.6, 0.85, fbm3(d * 2.0 + 11.0)) * 0.35;
    float band = exp(-pow(d.y * 2.2 + 0.25 * sin(atan(d.z, d.x) * 2.0), 2.0) * 5.0);
    col += vec3(0.5, 0.45, 0.9) * band * 0.16 * fbm3(d * 8.0);
  }
  float edge = cos(uSunSize);
  float disc = smoothstep(edge - 0.0009, edge + 0.0009, s);
  col = mix(col, uSunColour * 1.5, disc);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Sky {
  /** Add to the scene; move it to the camera before drawing each view. */
  group: Group;
  sunDir: Vector3;
  /** Moves the aurora and the nebula; `time` is the picture's clock. */
  update(time: number): void;
  dispose(): void;
}

export function createSky(style: ThemeStyle): Sky {
  const group = new Group();
  const sunDir = new Vector3(...style.sky.sunDir).normalize();
  const geometry = new SphereGeometry(1200, 32, 16);
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new Color(style.sky.zenith) },
      uMid: { value: new Color(style.sky.mid) },
      uHorizon: { value: new Color(style.sky.horizon) },
      uSunDir: { value: sunDir },
      uSunColour: { value: new Color(style.sky.sunColour) },
      uGlow: { value: new Color(style.sky.glow) },
      uSunSize: { value: style.sky.sunSize },
      uTime: { value: 0 },
      uMode: { value: style.sky.extras === "aurora" ? 1 : style.sky.extras === "nebula" ? 2 : 0 },
    },
  });
  const dome = new Mesh(geometry, material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
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
      col[i * 3] = b * tint[0]!;
      col[i * 3 + 1] = b * tint[1]!;
      col[i * 3 + 2] = b * tint[2]!;
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
      material.uniforms.uTime!.value = time;
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
