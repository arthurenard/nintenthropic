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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, t));
  col = mix(col, uZenith, smoothstep(0.14, 0.9, t));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, 0.25, -h));
  float s = clamp(dot(d, normalize(uSunDir)), 0.0, 1.0);
  col += uGlow * (pow(s, 6.0) * 0.30 + pow(s, 40.0) * 0.45);
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
    },
  });
  const dome = new Mesh(geometry, material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  group.add(dome);

  let stars: Points | null = null;
  if (style.sky.stars) {
    const rnd = seededRandom(99);
    const count = 900;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the upper hemisphere, thinning toward the horizon.
      const y = Math.pow(rnd(), 0.8) * 0.96 + 0.04;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 1100;
      pos[i * 3 + 1] = y * 1100;
      pos[i * 3 + 2] = Math.sin(a) * r * 1100;
      const warm = rnd();
      const b = 0.35 + rnd() * 0.65;
      col[i * 3] = b * (0.8 + 0.2 * warm);
      col[i * 3 + 1] = b * (0.85 + 0.1 * warm);
      col[i * 3 + 2] = b;
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
