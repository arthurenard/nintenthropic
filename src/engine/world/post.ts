/**
 * The post-processing chain a realistic world renders through: the scene
 * into a multisampled half-float target (the anti-aliasing: the host's
 * canvas has none), bloom on what is brighter than the world, then one grade
 * pass for everything colour - exposure, a highlight shoulder, the game's own
 * colour grade, and the player's state: colour drained and red creeping in
 * from the edges when hurt, sepia at death, a white flash for a blast close
 * by, and a soft vignette.
 *
 * Each game chooses its effects (PostOptions): the ones it leaves out are
 * compiled out, not merely set to zero. High Noon's chain is the default
 * set plus its golden-hour grade; a game may merge effects of its own into
 * the same pass (Dead of Night's beam in the fog).
 */
import { BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import { HalfFloatType, NoToneMapping, Uniform, Vector2, type Camera, type Scene, type WebGLRenderer } from "three";
import type { Quality } from "../types";

/** A colour as linear RGB, 0..1 (more than 1 to glow). */
export type RGB = readonly [number, number, number];

export interface BloomOptions {
  /** Only what is brighter than this blooms: 0.92 keeps a baked world out of it. */
  threshold: number;
  smoothing: number;
  intensity: number;
  radius: number;
  levels: number;
}

export interface GradeOptions {
  /**
   * GLSL defining `vec3 grade(vec3 c, float l)`: the game's colour grade,
   * given the colour after exposure and shoulder and its luminance.
   */
  glsl: string;
  /** Its own uniforms (floats), declared by the pass: set them with PostFX.set. */
  uniforms?: Record<string, number>;
}

export interface PostOptions {
  /** Bloom on the brightest things (muzzle flashes, explosions, the sun); dropped on the low tier. Default on. */
  bloom?: Partial<BloomOptions> | false;
  /**
   * A soft roll-off above 0.8 and identity below it: a world that arrives
   * display-ready (baked) passes through untouched, only highlights brighter
   * than it are compressed. Default on.
   */
  shoulder?: boolean;
  /** The game's colour grade; none by default. */
  grade?: GradeOptions;
  /** The `desaturate` uniform drains the colour (hurt, dying). Default on. */
  desaturate?: boolean;
  /** The `hurt` uniform brings this colour in from the corners, never over the middle. Default on, blood red. */
  hurt?: { color?: RGB } | false;
  /** The `sepia` uniform (death). Default on. */
  sepia?: boolean;
  /** The `flash` uniform adds this colour to the whole picture (a blast close by). Default on, warm white. */
  flash?: { color?: RGB } | false;
  /** How much the corners darken, 0 for none. Default 0.22. */
  vignette?: number;
  /**
   * The game's own effects, merged into the chain after bloom and before the
   * grade: Dead of Night's flashlight beam in the fog, which reads the
   * scene's depth. Called once for each chain (the full one and the low
   * tier's), so each gets instances of its own: share their uniforms.
   */
  effects?: () => Effect[];
}

/** The grade pass's own uniforms, besides the game's. */
export type PostUniform = "exposure" | "hurt" | "desaturate" | "sepia" | "flash" | "time";

const BLOOM: BloomOptions = { threshold: 0.92, smoothing: 0.18, intensity: 0.55, radius: 0.7, levels: 6 };
const BLOOD: RGB = [0.3, 0.012, 0.008];
const WHITE_HOT: RGB = [1.0, 0.92, 0.8];

/** A number as a GLSL float literal ("1.0", "0.22"). */
function float(n: number): string {
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
}
const vec3 = (c: RGB) => `vec3(${c.map(float).join(", ")})`;

const SHADER = /* glsl */ `
uniform float exposure;
uniform float hurt;
uniform float desaturate;
uniform float sepia;
uniform float flash;
uniform float time;
uniform vec2 aspect;
GRADE_UNIFORMS

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

#ifdef SHOULDER
// Identity below the knee, a soft roll-off above it. A baked world arrives
// display-ready, so it passes through untouched; only highlights brighter
// than the bake (muzzle flashes, the sun, explosions) are compressed.
vec3 shoulder(vec3 c) {
  const float knee = 0.8;
  vec3 over = max(c - knee, 0.0);
  return min(c, vec3(knee)) + (1.0 - knee) * (1.0 - exp(-over / (1.0 - knee)));
}
#endif

#ifdef HURT
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
#endif

GRADE_FUNCTION

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exposure;
#ifdef SHOULDER
  c = shoulder(c);
#endif

  float l = luma(c);
#ifdef GRADE
  c = grade(c, l);
#endif

  l = luma(c);
  vec2 d = (uv - 0.5) * aspect;
  float r = length(d) * 1.35;
#ifdef DESATURATE
  // Hurt: the colour drains...
  c = mix(c, vec3(l), clamp(desaturate, 0.0, 1.0));
#endif
#ifdef HURT
  // ... and red creeps in from the edges: strongest in the corners, never
  // over the middle of the view, where the player must still see who is
  // shooting.
  float n = noise(uv * 7.0 + time * 0.15) * 0.35 + noise(uv * 23.0 - time * 0.1) * 0.15;
  float edge = smoothstep(1.2 - hurt * 0.38, 1.55 - hurt * 0.3, r + n * hurt * 0.8);
  c = mix(c, HURT_COLOR * (0.55 + 0.45 * l), edge * clamp(hurt, 0.0, 0.75));
#endif
#ifdef SEPIA
  // Death: sepia.
  vec3 sep = vec3(l * 1.07, l * 0.87, l * 0.62) + vec3(0.03, 0.015, 0.0);
  c = mix(c, sep, sepia);
#endif
#ifdef FLASH
  // A flash for a blast close by.
  c += flash * FLASH_COLOR;
#endif
#ifdef VIGNETTE
  // A soft vignette, always.
  c *= 1.0 - VIGNETTE * smoothstep(0.55, 1.25, r);
#endif

  outputColor = vec4(c, inputColor.a);
}
`;

/** One pass for everything colour: tone shoulder, grade, hurt, sepia, flash, vignette. */
export class GradeEffect extends Effect {
  constructor(options: PostOptions = {}) {
    const extra = options.grade?.uniforms ?? {};
    const uniforms = new Map<string, Uniform>([
      ["exposure", new Uniform(1)],
      ["hurt", new Uniform(0)],
      ["desaturate", new Uniform(0)],
      ["sepia", new Uniform(0)],
      ["flash", new Uniform(0)],
      ["time", new Uniform(0)],
      ["aspect", new Uniform(new Vector2(1, 1))],
    ]);
    for (const [name, value] of Object.entries(extra)) uniforms.set(name, new Uniform(value));
    const defines = new Map<string, string>();
    if (options.shoulder !== false) defines.set("SHOULDER", "1");
    if (options.grade) defines.set("GRADE", "1");
    if (options.desaturate !== false) defines.set("DESATURATE", "1");
    if (options.hurt !== false) {
      defines.set("HURT", "1");
      defines.set("HURT_COLOR", vec3(options.hurt?.color ?? BLOOD));
    }
    if (options.sepia !== false) defines.set("SEPIA", "1");
    if (options.flash !== false) {
      defines.set("FLASH", "1");
      defines.set("FLASH_COLOR", vec3(options.flash?.color ?? WHITE_HOT));
    }
    const vignette = options.vignette ?? 0.22;
    if (vignette > 0) defines.set("VIGNETTE", float(vignette));
    const shader = SHADER.replace("GRADE_UNIFORMS", Object.keys(extra).map((name) => `uniform float ${name};`).join("\n")).replace(
      "GRADE_FUNCTION",
      options.grade?.glsl ?? "",
    );
    super("GradeEffect", shader, { blendFunction: BlendFunction.SET, uniforms, defines });
  }

  set(name: PostUniform | (string & {}), value: number): void {
    const uniform = this.uniforms.get(name) as Uniform<number> | undefined;
    if (uniform) uniform.value = value;
  }

  setAspect(w: number, h: number): void {
    const a = (this.uniforms.get("aspect") as Uniform<Vector2>).value;
    if (w >= h) a.set(w / h, 1);
    else a.set(1, h / w);
    // Normalise so the shorter side spans 1.
    a.divideScalar(Math.min(a.x, a.y));
  }
}

const samplesFor = (tier: Quality["tier"]) => (tier === "high" ? 4 : tier === "medium" ? 2 : 0);

/**
 * The post chain, kept light: render → (bloom) → grade. Bloom only catches
 * what is brighter than the world and is dropped on low-end hardware; the
 * grade always runs because the hurt and death effects are part of the game.
 * Both chains are built up front and switched by enabling one pass or the
 * other, so a change of tier never recompiles anything mid-game. MSAA on the
 * scene target: 4× on the high tier, 2× on medium, none on low.
 *
 * The renderer's own tone mapping is turned off: the grade is the tone map.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private readonly grades: readonly [GradeEffect, GradeEffect];
  private readonly bloom: BloomEffect | null;
  private readonly full: EffectPass;
  private readonly lite: EffectPass;
  private tier: Quality["tier"] | null = null;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, quality: Quality, options: PostOptions = {}) {
    renderer.toneMapping = NoToneMapping;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: samplesFor(quality.tier),
    });
    this.composer.addPass(new RenderPass(scene, camera));
    this.grades = [new GradeEffect(options), new GradeEffect(options)];
    const own = () => options.effects?.() ?? [];
    if (options.bloom === false) {
      this.bloom = null;
      this.full = new EffectPass(camera, ...own(), this.grades[0]);
    } else {
      const b = { ...BLOOM, ...options.bloom };
      this.bloom = new BloomEffect({
        luminanceThreshold: b.threshold,
        luminanceSmoothing: b.smoothing,
        intensity: b.intensity,
        mipmapBlur: true,
        radius: b.radius,
        levels: b.levels,
      });
      this.full = new EffectPass(camera, this.bloom, ...own(), this.grades[0]);
    }
    this.lite = new EffectPass(camera, ...own(), this.grades[1]);
    this.composer.addPass(this.full);
    this.composer.addPass(this.lite);
    this.full.renderToScreen = true;
    this.lite.renderToScreen = true;
    this.setQuality(quality);
  }

  /** Set a grade uniform (its own or the game's grade's) on both chains. */
  set(name: PostUniform | (string & {}), value: number): void {
    this.grades[0].set(name, value);
    this.grades[1].set(name, value);
  }

  setQuality(q: Quality): void {
    if (q.tier === this.tier) return;
    this.tier = q.tier;
    this.composer.multisampling = samplesFor(q.tier);
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
