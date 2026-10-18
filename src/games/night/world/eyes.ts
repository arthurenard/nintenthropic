import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Points, ShaderMaterial, type IUniform } from "three";
import type { V3 } from "../../../engine/rules/raymath";
import type { NightUniforms } from "./shading";

/** How many pairs of eyes can shine at once. */
const PAIRS = 40;

const VERTEX = /* glsl */ `
attribute float aShine;
uniform float uScale;
uniform float uMinSize;
uniform float uFogDensity;
varying float vShine;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  // The eye itself is a few millimetres; its shine is a point of light a
  // few pixels across at any distance, a little larger up close.
  gl_PointSize = clamp(uScale * 0.03 / max(d, 0.5), uMinSize, uMinSize * 2.8);
  // It pierces the fog far better than a body does: a bright point in a
  // pale haze. (Under a third of the fog's density, and the square law's.)
  float t = uFogDensity * d * 0.3;
  vShine = aShine * exp(-t * t);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vShine;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * r * 2.2) * 0.35;
  float a = (core + halo) * vShine;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The dead's eyes shining back in the flashlight: two points of pale
 * green-gold light for each of them the beam falls on, which pierce the
 * fog long before the body is clear of it - Dead of Night's glint, the tell
 * that something out there is looking at you. Tested against depth, so a
 * post or the corn hides them; drawn over the scene additively, so they
 * bloom. One draw call for them all.
 */
export class Eyeshine {
  readonly points: Points;
  private readonly positions = new Float32Array(PAIRS * 2 * 3);
  private readonly shine = new Float32Array(PAIRS * 2);
  private readonly posAttr: BufferAttribute;
  private readonly shineAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  private count = 0;

  constructor(u: NightUniforms) {
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.shineAttr = new BufferAttribute(this.shine, 1);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.shineAttr.setUsage(DynamicDrawUsage);
    g.setAttribute("position", this.posAttr);
    g.setAttribute("aShine", this.shineAttr);
    g.setDrawRange(0, 0);
    const uniforms: Record<string, IUniform> = {
      uScale: { value: 800 },
      uMinSize: { value: 5 },
      uFogDensity: u.uFogDensity,
      uColor: { value: new Color(3.2, 4.3, 2.3) },
    };
    this.material = new ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Pixels per metre at a metre: the drawing buffer's height over the view's extent. */
  setScale(bufferHeight: number, fov: number): void {
    this.material.uniforms["uScale"]!.value = bufferHeight / (2 * Math.tan((fov * Math.PI) / 360));
    // Never smaller than about half a percent of the picture's height: five pixels at 1080p, ten on a 4K screen.
    this.material.uniforms["uMinSize"]!.value = Math.max(3, bufferHeight / 216);
  }

  /** Start a frame's eyes. */
  begin(): void {
    this.count = 0;
  }

  /** One pair of eyes, shining `amount` (0..1+). */
  add(left: V3, right: V3, amount: number): void {
    if (amount <= 0.01 || this.count >= PAIRS * 2) return;
    this.point(left, amount);
    this.point(right, amount);
  }

  private point(p: V3, amount: number): void {
    const i = this.count++;
    this.positions[i * 3] = p.x;
    this.positions[i * 3 + 1] = p.y;
    this.positions[i * 3 + 2] = p.z;
    this.shine[i] = amount;
  }

  end(): void {
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, this.count * 3);
      this.posAttr.needsUpdate = true;
      this.shineAttr.clearUpdateRanges();
      this.shineAttr.addUpdateRange(0, this.count);
      this.shineAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
