/**
 * The rifle's scope. Asked for (Aim.scope: an eye closed, Shift, the right
 * button, the touch screen's Scope), the view closes in to six times in 0.3 s
 * on the point the player was aiming at; from then on the hand pans the
 * view at a quarter of its gain, anchored where the scope went in, so a
 * hand's tremor is a quarter of the movement; a breath sways it, less once
 * the hand has been still a moment. The round goes where the reticle is:
 * the middle of the view.
 *
 * The picture is the world through the narrower lens, with a round glass in
 * a dark surround drawn over it: a fine cross with heavy outer posts, mil
 * dots along the horizontal for the wind, and below the centre a mark for
 * each hundred metres from 300 to 900 at the drop the round really has there
 * (ballistics.ts) - and, on Relaxed, a dot where the round will land at the
 * range under the reticle.
 */
import {
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import { disposeTree } from "../../../engine/world/scene";
import { rangeMarkMils } from "../rules/ballistics";
import { SCOPE_IN_TIME, SCOPE_OUT_TIME, SCOPE_PAN_GAIN, SCOPE_POWER, SWAY_MOVING, SWAY_SETTLE, SWAY_STILL } from "../rules/tuning";

/** The glass's radius as a fraction of the smaller side of the view. */
export const GLASS = 0.46;

const RAD = Math.PI / 180;
// Scratch vectors for apply(), once a frame: nothing allocated per frame.
const Y_UP = new Vector3(0, 1, 0);
const V_DIR = new Vector3();
const V_RIGHT = new Vector3();
const V_UP = new Vector3();
const V_WIDE = new Vector3();
const V_TARGET = new Vector3();

/** The eye's own field of view the scope magnifies, degrees. */
export const EYE_FOV = 40;

/** The scoped field of view, degrees: six times closer than the eye sees. */
export function scopedFov(power = SCOPE_POWER): number {
  return (2 * Math.atan(Math.tan((EYE_FOV * RAD) / 2) / power)) / RAD;
}

const OVERLAY_FRAG = /* glsl */ `
uniform sampler2D uReticle;
uniform sampler2D uCrack;
uniform vec2 uSize;
uniform float uOpen;
uniform float uRadius;
uniform vec2 uDot;
uniform float uDotOn;
uniform float uCracked;
uniform vec3 uRim;
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float side = min(uSize.x, uSize.y);
  float r = uRadius * side * mix(0.55, 1.0, uOpen);
  float d = length(p);
  // Outside the glass: the dark of the scope's tube and the eye's closed lid.
  float outside = smoothstep(r - 1.5, r + 1.5, d);
  vec3 dark = vec3(0.012, 0.013, 0.015) + uRim * 0.05 * smoothstep(r + 40.0, r, d);
  // The glass's edge: a dark ring shading inward, and a thin bright line at the rim.
  float edge = smoothstep(r * 0.78, r, d);
  float ring = exp(-pow((d - r + 2.0) / 1.6, 2.0));
  // The reticle, drawn at its true size in the middle.
  vec2 ruv = p / side + 0.5;
  vec4 ret = texture2D(uReticle, ruv);
  // The holdover dot: where the round will land.
  float dot = uDotOn * (1.0 - smoothstep(2.2, 3.4, length(p - uDot)));
  float halo = uDotOn * exp(-pow(length(p - uDot) / 7.0, 2.0)) * 0.35;
  // A crack across the glass (the fall).
  vec4 crack = texture2D(uCrack, ruv) * uCracked;
  vec3 col = vec3(0.0);
  float a = 0.0;
  // Inside: darken toward the rim, the reticle in black over it.
  a = max(a, edge * 0.55 * uOpen);
  a = max(a, ret.a * uOpen);
  col = mix(col, vec3(0.9, 0.18, 0.1), clamp(dot + halo, 0.0, 1.0));
  a = max(a, clamp(dot + halo, 0.0, 1.0) * uOpen);
  col = mix(col, vec3(0.85, 0.9, 0.95), crack.a * 0.6);
  a = max(a, crack.a * 0.8);
  // The rim's line.
  col = mix(col, uRim, ring * 0.8);
  a = max(a, ring * 0.6 * uOpen);
  // Outside everything: the dark.
  col = mix(col, dark, outside);
  a = mix(a, uOpen, outside);
  // The recoil's flash at the glass's edge.
  col += uRim * uFlash * edge;
  gl_FragColor = vec4(col, a);
}
`;

/** The reticle, drawn once for a lens: black lines on a transparent canvas, the size of the smaller side of the view. */
function drawReticle(canvas: HTMLCanvasElement, sidePx: number, pxPerMil: number, dpr: number, gold: boolean): void {
  const S = Math.max(16, Math.round(sidePx));
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  const c = S / 2;
  const R = S * GLASS;
  const ink = gold ? "rgba(40, 28, 6, 0.95)" : "rgba(4, 5, 6, 0.95)";
  g.fillStyle = ink;
  g.strokeStyle = ink;
  const fine = Math.max(1, dpr);
  const heavy = Math.max(3, 3 * dpr);
  const inner = R * 0.34;
  // The heavy outer posts, from the glass's edge to a third of the way in.
  g.fillRect(c - heavy / 2, c + inner, heavy, R - inner);
  g.fillRect(c - heavy / 2, c - R, heavy, R - inner);
  g.fillRect(c - R, c - heavy / 2, R - inner, heavy);
  g.fillRect(c + inner, c - heavy / 2, R - inner, heavy);
  // The fine cross through the middle.
  g.fillRect(c - fine / 2, c - inner, fine, inner * 2);
  g.fillRect(c - inner, c - fine / 2, inner * 2, fine);
  // Mil dots for the wind: one every milliradian out to five each side.
  for (let k = 1; k <= 5; k++) {
    const x = k * pxPerMil;
    if (x > inner) break;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(c + s * x, c, Math.max(1.2, 1.4 * dpr), 0, Math.PI * 2);
      g.fill();
    }
  }
  // Above the centre, dots too (a man's height reads against them).
  for (let k = 1; k <= 3; k++) {
    const y = k * pxPerMil;
    g.beginPath();
    g.arc(c, c - y, Math.max(1, 1.2 * dpr), 0, Math.PI * 2);
    g.fill();
  }
  // Below it, the range marks: one for every hundred metres from 300, at the round's true drop.
  g.font = `600 ${Math.round(8.5 * dpr)}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
  g.textBaseline = "middle";
  // Short ticks, off to alternate sides of the line, so the man under them stays in sight.
  for (const { range, mils } of rangeMarkMils()) {
    const y = c + mils * pxPerMil;
    const hundreds = range / 100;
    const even = hundreds % 2 === 0;
    const w = (even ? 5 : 3.5) * dpr;
    const gap = 1.5 * dpr;
    const x0 = even ? c + gap : c - gap - w;
    g.fillRect(x0, y - fine / 2, w, fine);
    if (even) g.fillText(String(hundreds), c + gap + w + 2 * dpr, y);
  }
}

/** A crack across the glass, drawn once (the fall). */
function drawCrack(canvas: HTMLCanvasElement, size: number, seed: number): void {
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const cx = size * (0.42 + rnd() * 0.16);
  const cy = size * (0.38 + rnd() * 0.2);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineCap = "round";
  for (let k = 0; k < 11; k++) {
    let x = cx;
    let y = cy;
    let a = (k / 11) * Math.PI * 2 + rnd() * 0.4;
    g.lineWidth = 1.6 - k * 0.08;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 6 + Math.floor(rnd() * 6);
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.7;
      const len = size * (0.02 + rnd() * 0.06);
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // A ring or two round the strike.
  for (const rr of [0.03, 0.07]) {
    g.beginPath();
    g.arc(cx, cy, size * rr, rnd() * 6, rnd() * 6 + 4);
    g.stroke();
  }
}

export class Scope {
  /** The player is asking for the scope. */
  on = false;
  /** 0 (the wide view) to 1 (fully in), eased. */
  zoom = 0;
  /** The point of the wide view the scope looks at (fractions, 0,0 top-left). */
  readonly look = new Vector2(0.5, 0.5);
  /** Where the hand was when the scope went in, and the point it looked at then. */
  private readonly handAnchor = new Vector2(0.5, 0.5);
  private readonly lookAnchor = new Vector2(0.5, 0.5);
  private readonly lastHand = new Vector2(0.5, 0.5);
  /** Seconds the hand has been still (for the sway to settle). */
  private stillFor = 0;
  private t = 0;
  /** The recoil's jolt, milliradians up, settling. */
  private jolt = 0;
  private joltSide = 0;
  /** The bolt's shake. */
  private shake = 0;
  /** The breath's sway now, milliradians (x right, y up). */
  readonly sway = new Vector2();
  reducedMotion = false;
  /** The glass is cracked (the fall). */
  cracked = false;

  // The overlay.
  private readonly overlay = new Scene();
  private readonly overlayCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly reticleCanvas = document.createElement("canvas");
  private readonly reticleTexture: CanvasTexture;
  private readonly crackCanvas = document.createElement("canvas");
  private readonly crackTexture: CanvasTexture;
  private drawnKey = "";
  private width = 1280;
  private height = 720;
  private dpr = 1;
  gold = false;

  constructor() {
    this.reticleTexture = new CanvasTexture(this.reticleCanvas);
    this.reticleTexture.colorSpace = SRGBColorSpace;
    this.reticleTexture.minFilter = LinearFilter;
    this.reticleTexture.generateMipmaps = false;
    drawCrack(this.crackCanvas, 512, 7);
    this.crackTexture = new CanvasTexture(this.crackCanvas);
    this.material = new ShaderMaterial({
      uniforms: {
        uReticle: { value: this.reticleTexture },
        uCrack: { value: this.crackTexture },
        uSize: { value: new Vector2(1280, 720) },
        uOpen: { value: 0 },
        uRadius: { value: GLASS },
        uDot: { value: new Vector2() },
        uDotOn: { value: 0 },
        uCracked: { value: 0 },
        uRim: { value: new Color(0.55, 0.62, 0.7) },
        uFlash: { value: 0 },
      },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }",
      fragmentShader: OVERLAY_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), this.material);
    quad.frustumCulled = false;
    this.overlay.add(quad);
  }

  /** Fully in, and the reticle is where the round goes. */
  get scoped(): boolean {
    return this.zoom > 0.98;
  }

  /** In enough that the view is the scope's (the page's crosshair gives way). */
  get showing(): boolean {
    return this.on || this.zoom > 0.02;
  }

  /**
   * The player's request and the hand, once a frame. `aim` is where the hand
   * points in the wide view. Returns true on the frame the scope goes in or
   * comes out (for the sounds and the crosshair).
   */
  update(dt: number, want: boolean, aim: { x: number; y: number; tracking: boolean }): "in" | "out" | null {
    this.t += dt;
    let changed: "in" | "out" | null = null;
    if (want && !this.on) {
      this.on = true;
      changed = "in";
      // Centred where you were pointing; from here the hand pans at a quarter gain.
      this.handAnchor.set(aim.x, aim.y);
      this.lookAnchor.set(aim.x, aim.y);
      if (this.zoom < 0.05) this.look.set(aim.x, aim.y);
      this.stillFor = 0;
    } else if (!want && this.on) {
      this.on = false;
      changed = "out";
    }
    const speed = this.on ? 1 / SCOPE_IN_TIME : 1 / SCOPE_OUT_TIME;
    this.zoom = Math.max(0, Math.min(1, this.zoom + (this.on ? 1 : -1) * speed * dt));
    if (this.on && aim.tracking) {
      const x = this.lookAnchor.x + (aim.x - this.handAnchor.x) * SCOPE_PAN_GAIN;
      const y = this.lookAnchor.y + (aim.y - this.handAnchor.y) * SCOPE_PAN_GAIN;
      // Eased toward it over the zoom, so the view slides in rather than jumping.
      const k = Math.min(1, dt * 30);
      this.look.x += (Math.min(1, Math.max(0, x)) - this.look.x) * k;
      this.look.y += (Math.min(1, Math.max(0, y)) - this.look.y) * k;
    } else if (!this.on && aim.tracking) {
      this.look.set(aim.x, aim.y);
    }
    // The hand's stillness settles the breath.
    const moved = Math.hypot(aim.x - this.lastHand.x, aim.y - this.lastHand.y) / Math.max(dt, 1e-3);
    this.lastHand.set(aim.x, aim.y);
    this.stillFor = moved < 0.035 ? this.stillFor + dt : Math.max(0, this.stillFor - dt * 3);
    const settle = Math.min(1, Math.max(0, (this.stillFor - 0.3) / SWAY_SETTLE));
    const amp = (SWAY_MOVING + (SWAY_STILL - SWAY_MOVING) * settle) * (this.reducedMotion ? 0.35 : 1);
    // A breath: a slow rise and fall with a little drift, a figure of eight.
    const t = this.t;
    this.sway.set(
      amp * (Math.sin(t * 0.83 + 1.1) * 0.7 + Math.sin(t * 2.1) * 0.15),
      amp * (Math.sin(t * 1.62) * 0.85 + Math.sin(t * 0.47 + 2) * 0.35),
    );
    this.jolt *= Math.exp(-dt / 0.09);
    this.joltSide *= Math.exp(-dt / 0.09);
    this.shake *= Math.exp(-dt / 0.12);
    return changed;
  }

  /** The shot kicks the scope up and a hair aside. */
  kick(random: () => number): void {
    const k = this.reducedMotion ? 0.4 : 1;
    this.jolt += 7 * k;
    this.joltSide += (random() - 0.5) * 2.5 * k;
  }

  /** Working the bolt shakes the view a little. */
  boltShake(): void {
    this.shake = this.reducedMotion ? 0.6 : 1.8;
  }

  /**
   * Turn `camera` (already placed and oriented for the wide view, `wideFov`
   * tall) to the scope: toward the point it looks at, zoomed, swaying. The
   * wide camera `wide` is the view without the scope, for unprojecting.
   */
  apply(camera: PerspectiveCamera, wide: PerspectiveCamera, wideFov: number): void {
    const z = this.zoom;
    const e = z * z * (3 - 2 * z);
    if (e <= 0) {
      if (camera.fov !== wideFov) {
        camera.fov = wideFov;
        camera.updateProjectionMatrix();
      }
      // Without the scope, only the rifle's kick moves the view (the breath is the scope's).
      if (Math.abs(this.jolt) + Math.abs(this.joltSide) > 0.01) {
        const d = V_DIR.set(0, 0, -1).applyQuaternion(wide.quaternion);
        const right = V_RIGHT.crossVectors(d, Y_UP).normalize();
        const up = V_UP.crossVectors(right, d).normalize();
        d.addScaledVector(right, this.joltSide * 0.001).addScaledVector(up, this.jolt * 0.001).normalize();
        camera.up.set(0, 1, 0);
        camera.lookAt(V_TARGET.copy(camera.position).add(d));
        camera.updateMatrixWorld(true);
      }
      return;
    }
    // Six times an eye's natural 40° (not the window's framing, which widens
    // with the window's shape): the same picture through the glass on any screen.
    const tanWide = Math.tan((wideFov * RAD) / 2);
    const tanScoped = Math.tan((EYE_FOV * RAD) / 2) / SCOPE_POWER;
    const fov = (2 * Math.atan(tanWide + (tanScoped - tanWide) * e)) / RAD;
    const dir = V_DIR.set(this.look.x * 2 - 1, 1 - this.look.y * 2, 0.5).unproject(wide).sub(wide.position).normalize();
    // The sway, the jolt and the bolt's shake, in milliradians, about the scope's own axes.
    const right = V_RIGHT.crossVectors(dir, Y_UP).normalize();
    const up = V_UP.crossVectors(right, dir).normalize();
    const shake = this.shake * Math.sin(this.t * 43);
    const sx = (this.sway.x + this.joltSide + shake * 0.4) * 0.001 * e;
    const sy = (this.sway.y + this.jolt + shake) * 0.001 * e;
    dir.addScaledVector(right, sx).addScaledVector(up, sy).normalize();
    // Blend from the wide view's own direction as the scope comes in.
    const blended = V_WIDE.set(0, 0, -1).applyQuaternion(wide.quaternion).lerp(dir, e).normalize();
    const target = V_TARGET.copy(camera.position).add(blended);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** How many CSS pixels a milliradian is, through `camera` as it is now. */
  pxPerMil(camera: PerspectiveCamera): number {
    return this.height / 2 / (Math.tan((camera.fov * RAD) / 2) * 1000);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.material.uniforms["uSize"]!.value.set(width * dpr, height * dpr);
  }

  /**
   * Draw the glass over the frame just rendered. `dotMils` is where the
   * holdover dot goes (null for none).
   */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera, dotMils: { right: number; down: number } | null, flash = 0): void {
    const open = this.zoom;
    if (open <= 0.001 && !this.cracked) return;
    const ppm = this.pxPerMil(camera);
    const side = Math.min(this.width, this.height) * this.dpr;
    const key = `${Math.round(side)}|${ppm.toFixed(3)}|${this.dpr}|${this.gold}`;
    if (this.scoped && key !== this.drawnKey) {
      this.drawnKey = key;
      drawReticle(this.reticleCanvas, side, ppm * this.dpr, this.dpr, this.gold);
      this.reticleTexture.needsUpdate = true;
    }
    const u = this.material.uniforms;
    u["uOpen"]!.value = this.cracked ? Math.max(open, 0.001) : open;
    u["uDotOn"]!.value = dotMils && this.scoped ? 1 : 0;
    if (dotMils) u["uDot"]!.value.set(dotMils.right * ppm * this.dpr, -dotMils.down * ppm * this.dpr);
    u["uCracked"]!.value = this.cracked ? 1 : 0;
    u["uFlash"]!.value = flash;
    (u["uRim"]!.value as Color).set(this.gold ? "#d9a441" : "#8d9aa8");
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    // The reticle fades in only once the lens is at power.
    this.material.uniforms["uReticle"]!.value = this.scoped || this.zoom > 0.9 ? this.reticleTexture : this.blank();
    renderer.render(this.overlay, this.overlayCamera);
    renderer.autoClear = auto;
  }

  private blankTexture: CanvasTexture | null = null;
  private blank(): CanvasTexture {
    if (!this.blankTexture) {
      const c = document.createElement("canvas");
      c.width = 2;
      c.height = 2;
      this.blankTexture = new CanvasTexture(c);
    }
    return this.blankTexture;
  }

  reset(): void {
    this.on = false;
    this.zoom = 0;
    this.jolt = 0;
    this.joltSide = 0;
    this.shake = 0;
    this.cracked = false;
    this.stillFor = 0;
  }

  dispose(): void {
    disposeTree(this.overlay);
    this.material.dispose();
    this.reticleTexture.dispose();
    this.crackTexture.dispose();
    this.blankTexture?.dispose();
  }
}
