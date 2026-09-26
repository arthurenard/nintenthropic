import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { HalfFloatType, NoToneMapping, Uniform, Vector2, type Camera, type Scene, type WebGLRenderer } from "three";
import type { Quality } from "../../../engine/types";

const GRADE = /* glsl */ `
uniform float exposure;
uniform float hurt;
uniform float desaturate;
uniform float sepia;
uniform float flash;
uniform float time;
uniform float noon;
uniform vec2 aspect;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Identity below the knee, a soft roll-off above it. The baked town arrives
// display-ready, so it passes through untouched; only highlights brighter
// than the bake (muzzle flashes, the sun, explosions) are compressed.
vec3 shoulder(vec3 c) {
  const float knee = 0.8;
  vec3 over = max(c - knee, 0.0);
  return min(c, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exposure;
  c = shoulder(c);

  // Golden-hour grade: warm highlights, teal-leaning shadows, gently.
  float l = luma(c);
  vec3 warm = vec3(1.04, 1.0, 0.93);
  vec3 cool = vec3(0.94, 1.0, 1.05);
  vec3 tint = mix(cool, warm, smoothstep(0.05, 0.6, l));
  c *= mix(tint, vec3(1.0), noon);
  // At noon the light is white and hard: a touch more contrast, less colour.
  c = mix(c, (c - 0.5 * l) * 1.08 + 0.5 * l, noon * 0.5);

  // Hurt: the colour drains, and red creeps in from the edges.
  l = luma(c);
  c = mix(c, vec3(l), clamp(desaturate, 0.0, 1.0));
  vec2 d = (uv - 0.5) * aspect;
  float r = length(d) * 1.35;
  float n = noise(uv * 7.0 + time * 0.15) * 0.35 + noise(uv * 23.0 - time * 0.1) * 0.15;
  // Strongest in the corners, never over the middle of the view: the player
  // must still see who is shooting.
  float edge = smoothstep(1.2 - hurt * 0.38, 1.55 - hurt * 0.3, r + n * hurt * 0.8);
  vec3 blood = vec3(0.3, 0.012, 0.008);
  c = mix(c, blood * (0.55 + 0.45 * l), edge * clamp(hurt, 0.0, 0.75));

  // Death: sepia.
  vec3 sep = vec3(l * 1.07, l * 0.87, l * 0.62) + vec3(0.03, 0.015, 0.0);
  c = mix(c, sep, sepia);

  // A white flash for explosions close by.
  c += flash * vec3(1.0, 0.92, 0.8);

  // A soft vignette, always.
  c *= 1.0 - 0.22 * smoothstep(0.55, 1.25, r);

  outputColor = vec4(c, inputColor.a);
}
`;

/** One pass for everything colour: tone shoulder, grade, hurt, sepia, flash, vignette. */
export class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", GRADE, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, Uniform>([
        ["exposure", new Uniform(1)],
        ["hurt", new Uniform(0)],
        ["desaturate", new Uniform(0)],
        ["sepia", new Uniform(0)],
        ["flash", new Uniform(0)],
        ["time", new Uniform(0)],
        ["noon", new Uniform(0)],
        ["aspect", new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  set(name: "exposure" | "hurt" | "desaturate" | "sepia" | "flash" | "time" | "noon", value: number): void {
    (this.uniforms.get(name) as Uniform<number>).value = value;
  }

  setAspect(w: number, h: number): void {
    const a = (this.uniforms.get("aspect") as Uniform<Vector2>).value;
    if (w >= h) a.set(w / h, 1);
    else a.set(1, h / w);
    // Normalise so the shorter side spans 1.
    a.divideScalar(Math.min(a.x, a.y));
  }
}

/**
 * The post chain, kept light: render → (bloom) → grade. Bloom only catches
 * what is brighter than the bake — muzzle flashes, explosions, the sun — and
 * is dropped on low-end hardware; the grade always runs because the hurt and
 * death effects are part of the game. Both chains are built up front and
 * switched by enabling one pass or the other, so a change of tier never
 * recompiles anything mid-game.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly grades = [new GradeEffect(), new GradeEffect()] as const;
  private readonly bloom: BloomEffect;
  private readonly full: EffectPass;
  private readonly lite: EffectPass;
  private tier: Quality["tier"] | null = null;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, quality: Quality) {
    renderer.toneMapping = NoToneMapping;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: quality.tier === "high" ? 4 : quality.tier === "medium" ? 2 : 0,
    });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.18,
      intensity: 0.55,
      mipmapBlur: true,
      radius: 0.7,
      levels: 6,
    });
    this.full = new EffectPass(camera, this.bloom, this.grades[0]);
    this.lite = new EffectPass(camera, this.grades[1]);
    this.composer.addPass(this.full);
    this.composer.addPass(this.lite);
    this.full.renderToScreen = true;
    this.lite.renderToScreen = true;
    this.setQuality(quality);
  }

  /** Set a grade uniform on both chains. */
  set(name: Parameters<GradeEffect["set"]>[0], value: number): void {
    this.grades[0].set(name, value);
    this.grades[1].set(name, value);
  }

  setQuality(q: Quality): void {
    if (q.tier === this.tier) return;
    this.tier = q.tier;
    this.composer.multisampling = q.tier === "high" ? 4 : q.tier === "medium" ? 2 : 0;
    this.full.enabled = q.tier !== "low";
    this.lite.enabled = q.tier === "low";
  }

  setSize(width: number, height: number): void {
    // The host owns the canvas's CSS size and pixel ratio; only the buffers follow.
    this.composer.setSize(width, height, false);
    this.grades[0].setAspect(width, height);
    this.grades[1].setAspect(width, height);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
