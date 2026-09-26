import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type Texture,
} from "three";
import { ATLAS_CELLS } from "./textures";

/** How a kind of particle looks and moves. Made once per effect, reused for every emit. */
export interface ParticleStyle {
  life: [number, number];
  /** Size in metres at birth and at death. */
  size: [number, number];
  color: Color;
  /** Colour it turns toward by the end of its life (defaults to `color`). */
  color2?: Color;
  /** Opacity at birth and death. */
  alpha: [number, number];
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Metres per second squared, downward. */
  gravity: number;
  /** Fraction of velocity lost per second. */
  drag: number;
  /** Atlas cell: 0 dot, 1 smoke, 2 star, 3 streak, 4 flare line. */
  frame: number;
  /** Radians per second, random sign. */
  spin: number;
  /** Stop at this height (droplets and grit land and fade). */
  floor?: number;
  /** Start at this angle (radians; 0 lays a streak level) instead of a random one. */
  angle?: number;
}

const VERTEX = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aParams;
uniform float uScale;
varying vec4 vColor;
varying float vRot;
varying float vFrame;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aParams.x * uScale / max(0.05, -mvPosition.z);
  vColor = aColor;
  vRot = aParams.y;
  vFrame = aParams.z;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uCells;
varying vec4 vColor;
varying float vRot;
varying float vFrame;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot);
  float s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  vec4 tex = texture2D(uMap, vec2((vFrame + p.x) / uCells, 1.0 - p.y));
  gl_FragColor = vec4(vColor.rgb * tex.rgb, vColor.a * tex.a);
  if (gl_FragColor.a < 0.003) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * A fixed-capacity pool of camera-facing sprites drawn in one call. Live
 * particles are kept packed at the front of the arrays (a dead one is replaced
 * by the last), so the GPU draws exactly `count` and nothing is allocated
 * after construction.
 */
export class ParticleSystem {
  readonly points: Points;
  readonly capacity: number;
  count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly col2: Float32Array;
  private readonly color: Float32Array;
  private readonly params: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly alpha1: Float32Array;
  private readonly fadeIn: Float32Array;
  private readonly spin: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly floor: Float32Array;
  private readonly material: ShaderMaterial;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly parAttr: BufferAttribute;
  private random: () => number = Math.random;
  /** The per-particle arrays, listed once so recycling a slot allocates nothing. */
  private readonly vectors: Float32Array[];
  private readonly scalars: Float32Array[];

  /**
   * `onTop` draws over everything, untested against depth: for what happens
   * in the lens rather than in the world (a flare), which no wall can cut.
   */
  constructor(capacity: number, atlas: Texture, additive: boolean, onTop = false) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.col2 = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.alpha1 = new Float32Array(capacity);
    this.fadeIn = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    this.vectors = [this.pos, this.vel, this.col, this.col2, this.params];
    this.scalars = [this.life, this.age, this.size0, this.size1, this.alpha0, this.alpha1, this.fadeIn, this.spin, this.gravity, this.drag, this.floor];
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.colAttr = new BufferAttribute(this.color, 4);
    this.parAttr = new BufferAttribute(this.params, 3);
    for (const a of [this.posAttr, this.colAttr, this.parAttr]) a.setUsage(35048 /* DynamicDrawUsage */);
    g.setAttribute("position", this.posAttr);
    g.setAttribute("aColor", this.colAttr);
    g.setAttribute("aParams", this.parAttr);
    g.setDrawRange(0, 0);
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uMap: { value: null }, uScale: { value: 800 }, uCells: { value: ATLAS_CELLS } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: true,
      depthTest: !onTop,
    });
    this.material.uniforms["uMap"]!.value = atlas;
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = onTop ? 4 : additive ? 3 : 2;
  }

  setRandom(random: () => number): void {
    this.random = random;
  }

  /** Pixels per metre at one metre: drawing-buffer height over the view's vertical extent. */
  setScale(bufferHeight: number, fovDegrees: number): void {
    this.material.uniforms["uScale"]!.value = bufferHeight / (2 * Math.tan((fovDegrees * Math.PI) / 360));
  }

  /** Spawn one particle. `scale` multiplies its size; `tint` overrides the style's colour. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, s: ParticleStyle, scale = 1, tint?: Color): void {
    let i: number;
    if (this.count < this.capacity) {
      i = this.count++;
    } else {
      // Full: overwrite a random live one; at this density nobody can tell which.
      i = Math.floor(this.random() * this.capacity);
    }
    const r = this.random;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const c = tint ?? s.color;
    const c2 = s.color2 ?? c;
    this.col[i3] = c.r;
    this.col[i3 + 1] = c.g;
    this.col[i3 + 2] = c.b;
    this.col2[i3] = tint && !s.color2 ? tint.r : c2.r;
    this.col2[i3 + 1] = tint && !s.color2 ? tint.g : c2.g;
    this.col2[i3 + 2] = tint && !s.color2 ? tint.b : c2.b;
    this.life[i] = s.life[0] + (s.life[1] - s.life[0]) * r();
    this.age[i] = 0;
    this.size0[i] = s.size[0] * scale * (0.8 + 0.4 * r());
    this.size1[i] = s.size[1] * scale * (0.8 + 0.4 * r());
    this.alpha0[i] = s.alpha[0];
    this.alpha1[i] = s.alpha[1];
    this.fadeIn[i] = s.fadeIn ?? 0;
    this.spin[i] = s.spin * (r() < 0.5 ? -1 : 1) * (0.5 + r());
    this.gravity[i] = s.gravity;
    this.drag[i] = s.drag;
    this.floor[i] = s.floor ?? -1e9;
    const turn = r() * Math.PI * 2;
    this.params[i3 + 1] = s.angle ?? turn;
    this.params[i3 + 2] = s.frame;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.age[i] = (this.age[i] as number) + dt;
      if ((this.age[i] as number) >= (this.life[i] as number)) {
        this.kill(i);
        continue;
      }
      const i3 = i * 3;
      const k = (this.age[i] as number) / (this.life[i] as number);
      const damp = Math.max(0, 1 - (this.drag[i] as number) * dt);
      this.vel[i3] = (this.vel[i3] as number) * damp;
      this.vel[i3 + 1] = (this.vel[i3 + 1] as number) * damp - (this.gravity[i] as number) * dt;
      this.vel[i3 + 2] = (this.vel[i3 + 2] as number) * damp;
      this.pos[i3] = (this.pos[i3] as number) + (this.vel[i3] as number) * dt;
      this.pos[i3 + 1] = (this.pos[i3 + 1] as number) + (this.vel[i3 + 1] as number) * dt;
      this.pos[i3 + 2] = (this.pos[i3 + 2] as number) + (this.vel[i3 + 2] as number) * dt;
      if ((this.pos[i3 + 1] as number) < (this.floor[i] as number)) {
        this.pos[i3 + 1] = this.floor[i] as number;
        this.vel[i3] = (this.vel[i3] as number) * 0.3;
        this.vel[i3 + 1] = 0;
        this.vel[i3 + 2] = (this.vel[i3 + 2] as number) * 0.3;
      }
      const grow = 1 - (1 - k) * (1 - k);
      this.params[i3] = (this.size0[i] as number) + ((this.size1[i] as number) - (this.size0[i] as number)) * grow;
      this.params[i3 + 1] = (this.params[i3 + 1] as number) + (this.spin[i] as number) * dt;
      const fi = this.fadeIn[i] as number;
      const fade = fi > 0 ? Math.min(1, k / fi) : 1;
      const i4 = i * 4;
      this.color[i4] = (this.col[i3] as number) + ((this.col2[i3] as number) - (this.col[i3] as number)) * k;
      this.color[i4 + 1] = (this.col[i3 + 1] as number) + ((this.col2[i3 + 1] as number) - (this.col[i3 + 1] as number)) * k;
      this.color[i4 + 2] = (this.col[i3 + 2] as number) + ((this.col2[i3 + 2] as number) - (this.col[i3 + 2] as number)) * k;
      this.color[i4 + 3] = ((this.alpha0[i] as number) + ((this.alpha1[i] as number) - (this.alpha0[i] as number)) * k) * fade;
      i++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, this.count * 3);
      this.posAttr.needsUpdate = true;
      this.colAttr.clearUpdateRanges();
      this.colAttr.addUpdateRange(0, this.count * 4);
      this.colAttr.needsUpdate = true;
      this.parAttr.clearUpdateRanges();
      this.parAttr.addUpdateRange(0, this.count * 3);
      this.parAttr.needsUpdate = true;
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of this.vectors) {
      a[i * 3] = a[last * 3] as number;
      a[i * 3 + 1] = a[last * 3 + 1] as number;
      a[i * 3 + 2] = a[last * 3 + 2] as number;
    }
    for (const a of this.scalars) a[i] = a[last] as number;
  }

  clear(): void {
    this.count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
