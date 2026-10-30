/**
 * Grip Prix's post chain. Every viewport of a frame is drawn, scissored, into
 * one multisampled half-float target (so a boost pad or a lamp can be
 * brighter than white); then ONE pass over the whole canvas does bloom on
 * what is brighter than white, the tone curve, the theme's colour grade and,
 * for each view tile separately, a vignette and the rush: on a boost (and
 * flat out) the outer part of the view is smeared outward from where the kart
 * is heading, a few samples along the line from that point, so the world
 * streams past. The rush costs one uniform test a pixel while it is off, and
 * is left out on the low tier.
 *
 * Anti-aliasing is MSAA on the target (4x high, 2x medium); the low tier has
 * none on the target and runs SMAA over the finished picture instead.
 *
 * The renderer's own tone mapping stays off: the grade effect is the tone map.
 */
import { BlendFunction, BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, Pass, SMAAEffect, SMAAPreset } from "postprocessing";
import { Color, HalfFloatType, NoToneMapping, PerspectiveCamera, ShaderChunk, Uniform, Vector4, type WebGLRenderer, type WebGLRenderTarget } from "three";
import type { GpuTimer } from "./gpuTimer";
import type { Tier } from "./quality";
import type { Look } from "./world/look";

/** Draws every view into `target`. */
export type DrawViews = (target: WebGLRenderTarget) => void;

class ViewsPass extends Pass {
  /** Times the views, then hands the stopwatch on to the passes after it (see PostChain.timer). */
  timer: GpuTimer | null = null;

  constructor(private readonly draw: DrawViews) {
    super("ViewsPass");
    this.needsSwap = false;
  }

  override render(_renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.timer?.begin("views");
    this.draw(inputBuffer);
    this.timer?.end();
    this.timer?.begin("post");
  }
}

const TONES = { aces: 0, agx: 1, neutral: 2 } as const;

const GRADE = /* glsl */ `
${ShaderChunk.tonemapping_pars_fragment}
uniform int uTone;
uniform float uVibrance;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
uniform vec4 uTiles[4];
uniform int uTileCount;
uniform float uCanvasAspect;
uniform vec3 uDivider;
/** Per view tile: the rush's strength 0..1, unused, and the point it streams from (0..1 of the tile from its bottom left). */
uniform vec4 uRush[4];
/** Samples along the rush's line: 0 leaves it out (the low tier). */
uniform int uRushTaps;

float gLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Which view tile this pixel is in, where in it, and that view's rush.
  bool inView = uTileCount == 0;
  vec4 tile = vec4(0.0, 0.0, 1.0, 1.0);
  vec2 q = uv;
  vec4 rush = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uTileCount) break;
    vec4 t = uTiles[i];
    vec2 qi = (uv - t.xy) / t.zw;
    if (qi.x >= 0.0 && qi.x <= 1.0 && qi.y >= 0.0 && qi.y <= 1.0) {
      inView = true;
      tile = t;
      q = qi;
      rush = uRush[i];
    }
  }

  vec3 c = max(inputColor.rgb, vec3(0.0));

  // The rush: the outer part of the view smeared outward along the line from the point the world streams from. Only the
  // scene's part is smeared (what bloom added stays), and never across into another view.
  if (uRushTaps > 0 && rush.x > 0.03) {
    vec2 fromPoint = (q - rush.zw) * vec2(tile.z / tile.w * uCanvasAspect, 1.0);
    float m = smoothstep(0.3, 0.85, length(fromPoint)) * rush.x;
    if (m > 0.01) {
      vec2 d = uv - (tile.xy + rush.zw * tile.zw);
      vec2 lo = tile.xy + texelSize;
      vec2 hi = tile.xy + tile.zw - texelSize;
      vec3 here = max(texture2D(inputBuffer, uv).rgb, vec3(0.0));
      vec3 sum = here;
      float n = 1.0;
      for (int k = 1; k <= 6; k++) {
        if (k > uRushTaps) break;
        sum += max(texture2D(inputBuffer, clamp(uv - d * (float(k) * 0.009 * m), lo, hi)).rgb, vec3(0.0));
        n += 1.0;
      }
      c = max(c + sum / n - here, vec3(0.0));
    }
  }

  if (uTone == 0) c = ACESFilmicToneMapping(c);
  else if (uTone == 1) c = AgXToneMapping(c);
  else c = NeutralToneMapping(c);
  c = clamp(c, 0.0, 1.0);

  // Saturation, then vibrance (which lifts the dull colours more than the vivid ones).
  float l = gLuma(c);
  c = mix(vec3(l), c, uSaturation);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  c = mix(vec3(gLuma(c)), c, 1.0 + uVibrance * (1.0 - clamp(mx - mn, 0.0, 1.0)));

  // An S curve about mid grey, applied in a perceptual space.
  vec3 p = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  p = mix(p, p * p * (3.0 - 2.0 * p), uContrast);
  c = pow(p, vec3(2.2));

  // Split tone: cool in the shadows, warm in the lights.
  c *= mix(uShadowTint, uHighlightTint, smoothstep(0.02, 0.7, gLuma(c)));

  // Vignette, per view tile.
  float v = 1.0;
  if (uTileCount > 0 && inView) {
    vec2 d = (q - 0.5) * vec2(tile.z / tile.w * uCanvasAspect, 1.0);
    float r = length(d) * 1.25;
    v = 1.0 - uVignette * smoothstep(0.5, 1.15, r);
  }
  c *= v;

  // A whisper of dither so the sky's long gradients do not band.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  c += (n - 0.5) * (1.1 / 255.0) * max(0.15, sqrt(gLuma(c)));
  // Between the views (and in the quadrant three views leave free) nothing is drawn: each view's picture is resolved from
  // the multisampled target inside its own scissor only, and what lies between is whatever an older frame left, so it is
  // painted the divider's colour.
  outputColor = vec4(inView ? max(c, vec3(0.0)) : uDivider, inputColor.a);
}
`;

/** The divider between split-screen views: the canvas's clear colour and the free quadrant's (hud.css). */
export const DIVIDER = 0x0b0b0d;

export class GradeEffect extends Effect {
  /** The view tiles: the whole canvas is one view until told otherwise. */
  private readonly tiles: Vector4[] = [new Vector4(0, 0, 1, 1), new Vector4(), new Vector4(), new Vector4()];
  private readonly rush: Vector4[] = [new Vector4(), new Vector4(), new Vector4(), new Vector4()];

  /** `taps`: samples along the rush's line (0 leaves the rush out). */
  constructor(taps = 6) {
    super("GripGrade", GRADE, {
      blendFunction: BlendFunction.SET,
      // The rush reads the picture around the pixel, not only under it.
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ["toneMappingExposure", new Uniform(1)],
        ["uTone", new Uniform(0)],
        ["uVibrance", new Uniform(0)],
        ["uSaturation", new Uniform(1)],
        ["uContrast", new Uniform(0)],
        ["uShadowTint", new Uniform(new Color(1, 1, 1))],
        ["uHighlightTint", new Uniform(new Color(1, 1, 1))],
        ["uVignette", new Uniform(0.2)],
        ["uTiles", new Uniform([new Vector4(), new Vector4(), new Vector4(), new Vector4()])],
        ["uTileCount", new Uniform(1)],
        ["uCanvasAspect", new Uniform(1)],
        ["uDivider", new Uniform(new Color(DIVIDER))],
        ["uRush", new Uniform([new Vector4(), new Vector4(), new Vector4(), new Vector4()])],
        ["uRushTaps", new Uniform(taps)],
      ]),
    });
    (this.uniforms.get("uTiles") as Uniform).value = this.tiles;
    (this.uniforms.get("uRush") as Uniform).value = this.rush;
  }

  /** View `index`'s rush: 0..1, streaming out from (x, y), fractions of the view from its bottom left. */
  setRush(index: number, strength: number, x: number, y: number): void {
    this.rush[index]?.set(strength, 0, x, y);
  }

  setLook(look: Look): void {
    const u = (n: string) => this.uniforms.get(n) as Uniform;
    u("toneMappingExposure").value = look.exposure;
    u("uTone").value = TONES[look.tone];
    u("uVibrance").value = look.vibrance;
    u("uSaturation").value = look.saturation;
    u("uContrast").value = look.contrast;
    (u("uShadowTint").value as Color).setRGB(...look.shadowTint);
    (u("uHighlightTint").value as Color).setRGB(...look.highlightTint);
    u("uVignette").value = look.vignette;
  }

  /** The view tiles as fractions of the canvas: x, y (from the bottom), w, h. */
  setTiles(tiles: readonly { x: number; y: number; w: number; h: number }[], width: number, height: number): void {
    (this.uniforms.get("uTileCount") as Uniform).value = Math.min(4, tiles.length);
    (this.uniforms.get("uCanvasAspect") as Uniform).value = width / height;
    tiles.slice(0, 4).forEach((t, i) => this.tiles[i]!.set(t.x / width, 1 - (t.y + t.h) / height, t.w / width, t.h / height));
  }
}

const samplesFor = (tier: Tier): number => (tier === "high" ? 4 : tier === "medium" ? 2 : 0);

export class PostChain {
  readonly composer: EffectComposer;
  private readonly grade: GradeEffect;
  private readonly bloom: BloomEffect;
  /** The effects need a camera to be built with; none of them looks through it. */
  private readonly camera = new PerspectiveCamera();
  private readonly views: ViewsPass;
  private stopwatch: GpuTimer | null = null;

  constructor(renderer: WebGLRenderer, tier: Tier, draw: DrawViews) {
    renderer.toneMapping = NoToneMapping;
    // The rush's samples: six on the high tier, four on medium, none on low (where every full-screen read counts).
    this.grade = new GradeEffect(tier === "high" ? 6 : tier === "medium" ? 4 : 0);
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: samplesFor(tier), depthBuffer: true, stencilBuffer: false });
    // Each view's draw ends with three resolving the multisampled target into the texture the passes read, depth and
    // all; nothing after the views reads the depth, so only the colour is resolved (0.7 to 1.4 ms less of the GPU a
    // frame at 1440x900 at 2x, high and medium, 1 and 4 views; the pictures the same pixel for pixel).
    this.composer.inputBuffer.resolveDepthBuffer = false;
    this.composer.outputBuffer.resolveDepthBuffer = false;
    this.views = new ViewsPass(draw);
    this.composer.addPass(this.views);
    this.bloom = new BloomEffect({ luminanceThreshold: 1, luminanceSmoothing: 0.25, mipmapBlur: true, intensity: 0.5, radius: 0.72, levels: tier === "low" ? 5 : 7 });
    // The thresholded copy the glow is blurred from is full size, which is a full-size read and write of the half-float picture; on the
    // lesser tiers it is made at half size (the blur's first step halves it anyway), a slightly softer glow for a quarter of the work.
    if (tier !== "high") this.bloom.luminancePass.resolution.scale = 0.5;
    // Bloom's own blend (screen) adds the glow to the picture; the grade then maps the sum.
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.grade));
    if (tier === "low") this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.LOW })));
  }

  setLook(look: Look): void {
    this.grade.setLook(look);
    this.bloom.intensity = look.bloom.intensity;
    this.bloom.luminanceMaterial.threshold = look.bloom.threshold;
    this.bloom.mipmapBlurPass.radius = look.bloom.radius;
  }

  setTiles(tiles: readonly { x: number; y: number; w: number; h: number }[], width: number, height: number): void {
    this.grade.setTiles(tiles, width, height);
  }

  /** View `index`'s rush (the camera's `rush` and `focus`): 0 is none. */
  setRush(index: number, strength: number, x: number, y: number): void {
    this.grade.setRush(index, strength, x, y);
  }

  /** `width` x `height` are CSS pixels; the renderer's pixel ratio is already set. */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** A GPU stopwatch to time the views and the post passes with (dev page and bench only). */
  set timer(timer: GpuTimer | null) {
    this.stopwatch = timer;
    this.views.timer = timer;
  }

  render(dt: number): void {
    this.composer.render(dt);
    this.stopwatch?.end();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
