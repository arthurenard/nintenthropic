/**
 * Soft round sprites drawn as GL points: sparks, flames, dust, glows. A point
 * is always screen-aligned, so one object looks right from every split-screen
 * camera, and one draw call carries hundreds of them.
 *
 * Their size is given in metres and scaled to pixels here. three's own
 * PointsMaterial scales by the whole canvas height, which would make every
 * sprite twice too big in a half-height viewport, so the renderer sets
 * `pointScale` for each view before drawing it.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from "three";

/** Shared by every points material: viewport height in pixels / (2 tan(fov / 2)). */
export const pointScale = { value: 800 };

const vertex = /* glsl */ `
uniform float uScale;
attribute vec4 aColor;
attribute float aSize;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  if (aSize <= 0.0 || aColor.a <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.2, -mv.z), 1.0, 260.0);
}
`;

const fragment = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float soft = 1.0 - d;
  #ifdef GLOW
    float a = pow(soft, 1.35);
    vec3 col = mix(vColor.rgb, vec3(1.0), pow(soft, 4.0) * 0.5);
  #else
    float a = smoothstep(0.0, 0.55, soft);
    vec3 col = vColor.rgb;
  #endif
  gl_FragColor = vec4(col, vColor.a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function pointsMaterial(additive: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uScale: pointScale },
    vertexShader: vertex,
    fragmentShader: fragment,
    defines: additive ? { GLOW: "" } : {},
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
}

/** Geometry for `capacity` sprites: position (xyz), colour (rgba, linear) and size (metres). */
export function pointsGeometry(capacity: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(35048));
  g.setAttribute("aColor", new BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(35048));
  g.setAttribute("aSize", new BufferAttribute(new Float32Array(capacity), 1).setUsage(35048));
  return g;
}

/** A Points object over `pointsGeometry`, never culled (its bounds move). */
export function makePoints(capacity: number, additive: boolean): Points {
  const p = new Points(pointsGeometry(capacity), pointsMaterial(additive));
  p.frustumCulled = false;
  p.renderOrder = additive ? 20 : 10;
  return p;
}
