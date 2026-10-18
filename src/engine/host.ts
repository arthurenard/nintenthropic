/**
 * The game host: one WebGL renderer for the life of the page, the animation
 * loop, pause and resume, sizing at the device's pixel ratio, and dynamic
 * resolution. Games are handed the renderer and the loop's clock; they never
 * own either, so switching games never costs a new WebGL context.
 */
import { SRGBColorSpace, WebGLRenderer } from "three";
import { Assets } from "./assets";
import { IDLE_AIM, WebGLUnavailable, type FrameInfo } from "./common";
import { DynamicResolution } from "./dynamicResolution";
import { Samples, type Percentiles } from "./stats";
import { INITIAL_SCALE, gpuName, guessTier } from "./tier";
import type { Aim, Game, Quality } from "./types";

/** The longest step a game is ever asked to take, in seconds: after a hitch
 * the world skips a beat instead of lurching forward. */
export const MAX_DT = 0.1;
/** Past 2x, extra pixels cost far more than the eye can see. */
export const MAX_PIXEL_RATIO = 2;

export { IDLE_AIM, WebGLUnavailable, type FrameInfo };

/**
 * Calls `changed` whenever the device's pixel ratio changes (the window
 * moved to another screen, or the page was zoomed), for the life of the
 * page. A media query matches one ratio, so each change asks again with the
 * new one.
 */
export function watchPixelRatio(changed: () => void, scope: Pick<Window, "devicePixelRatio" | "matchMedia"> = window): void {
  if (typeof scope.matchMedia !== "function") return;
  const query = scope.matchMedia(`(resolution: ${scope.devicePixelRatio || 1}dppx)`);
  query.addEventListener(
    "change",
    () => {
      changed();
      watchPixelRatio(changed, scope);
    },
    { once: true },
  );
}

/** Recent frame timings, for the debug overlay and the performance report. */
export class FrameStats {
  readonly interval = new Samples();
  readonly work = new Samples();

  record(interval: number, work: number): void {
    // Over 250 ms is a hitch, not a frame. Nothing at all is the loop's
    // first frame: its time is when the browser began that frame, which can
    // be before start() was called (after a long load, by hundreds of ms),
    // and a negative interval would drag the mean below zero.
    if (!(interval > 0) || interval > 250) return;
    this.interval.push(interval);
    this.work.push(work);
  }

  reset(): void {
    this.interval.clear();
    this.work.clear();
  }

  summary(): { frames: number; interval: Percentiles; work: Percentiles } {
    return { frames: this.interval.count, interval: this.interval.summary(), work: this.work.summary() };
  }
}

export class EngineHost {
  readonly renderer: WebGLRenderer;
  readonly quality: Quality;
  readonly assets = new Assets();
  readonly stats = new FrameStats();
  /** The aim to hand the game each frame; the app decides what it is. */
  aim: (now: number) => Aim = () => IDLE_AIM;
  /** After the game has drawn: the page's own overlay (the crosshair). */
  onFrame: ((frame: FrameInfo) => void) | null = null;
  /** The GPU gave up its context (a driver reset, too many tabs). */
  onContextLost: (() => void) | null = null;

  private game: Game | null = null;
  private running = false;
  private handle = 0;
  private last = 0;
  private readonly resolution: DynamicResolution;
  private readonly observer: ResizeObserver;
  private size = { width: 0, height: 0, ratio: 1 };

  constructor(readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        // The games anti-alias in their own post-processing (MSAA on the
        // scene target), so the canvas itself needs none: it would only be
        // a second multisampled buffer the size of the screen.
        antialias: false,
        alpha: false,
        stencil: false,
        powerPreference: "high-performance",
      });
    } catch {
      throw new WebGLUnavailable();
    }
    // Colour management: the page is sRGB. Tone mapping is the game's call.
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.gpu = gpuName(this.renderer.getContext());
    const tier = guessTier(this.gpu, navigator.hardwareConcurrency || 4);
    this.resolution = new DynamicResolution({ initial: INITIAL_SCALE[tier] });
    this.quality = { scale: this.resolution.scale, tier };
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    // The canvas keeps its size when the window moves to a screen of another
    // density, so the observer never hears of it: without this a game moved
    // from a 1x monitor to a Retina laptop stays blurred, and one moved the
    // other way draws four times the pixels the screen can show.
    watchPixelRatio(() => this.resize());
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.stop();
      this.onContextLost?.();
    });
  }

  /** The GPU's name, read once: it cannot change under a live context, and asking the driver is not free. */
  readonly gpu: string;

  /** The game to run; null clears the stage. */
  setGame(game: Game | null): void {
    this.game = game;
    // A game put away: whatever it loaded that its own teardown missed goes too.
    if (!game) this.assets.release();
    this.resolution.reset(INITIAL_SCALE[this.quality.tier]);
    this.quality.scale = this.resolution.scale;
    this.stats.reset();
    this.resize(true);
  }

  /** Starts the loop (it runs until stopped or paused). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  /** Stops the loop; the last frame stays on the canvas. */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Pauses the game and the loop: a paused world costs nothing. */
  pause(): void {
    if (!this.running) return;
    this.stop();
    this.game?.pause();
  }

  resume(): void {
    if (this.running) return;
    this.game?.resume();
    this.resolution.reset();
    this.start();
  }

  /** Draws one frame now, outside the loop (after a resize while paused). */
  renderOnce(): void {
    this.game?.render();
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);
    const interval = now - this.last;
    this.last = now;
    const dt = Math.min(Math.max(interval / 1000, 0), MAX_DT);
    const began = performance.now();
    const aim = this.aim(now);
    if (this.game) {
      this.game.update(dt, now, aim);
      this.game.render();
    }
    this.onFrame?.({ now, dt, aim });
    this.stats.record(interval, performance.now() - began);
    if (this.resolution.sample(interval)) {
      this.quality.scale = this.resolution.scale;
      this.resize(true);
    }
  };

  /** Sizes the drawing buffer to the canvas at the device's pixel ratio. */
  resize(force = false): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO) * this.quality.scale;
    if (!force && width === this.size.width && height === this.size.height && ratio === this.size.ratio) return;
    this.size = { width, height, ratio };
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.game?.resize(width, height, ratio);
    if (!this.running) this.renderOnce();
  }
}
