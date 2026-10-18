/**
 * A game's standalone dev harness, served by Vite at
 * /src/games/<game>/dev.html (never part of the production build): the game
 * alone, without the arcade, the camera or the tracker, in the page's real
 * chrome - the HUD, the crosshair and the results card from src/app, laid
 * out by the same markup and styles as index.html - with the mouse as the
 * gun (click fires, right-click or R reloads, leaving the stage points off
 * the screen; in a scope game Shift or the right button scopes), the silent
 * NullAudioBus, a short aim check on the game's own targets, then the game.
 *
 * A game's dev.ts is a few lines:
 *
 *     import { runHarness } from "../../dev/harness";
 *     void runHarness({ entry: MY_GAME, create: (p) => createMyGame({ startWave: p.wave }) });
 *
 * Query parameters: ?seed=N, ?wave=N (the game's start wave, if it has
 * waves), ?difficulty=relaxed, ?flashing=reduced, ?tips=seen (as if every
 * one-time tip had been shown already), ?assetBase=/some/folder/ (load the
 * art from there instead, to try an export in progress), ?god=1, ?assist=0,
 * ?golden=1, ?quality=low|medium|high, ?input=mouse|touch|hand (what the
 * game is told the player aims with; unset, as for the hand), ?skipcalib=1,
 * ?manual=1 (no real-time loop: drive it from window.__handy), ?w=&h=&dpr=
 * (a fixed stage size, for benchmarks). A game reads any of its own
 * (High Noon's ?noon=1) from HarnessParams.
 *
 * window.__handy: game (with its own `debug`, if it has one), hud (with .log
 * of every HudSink call), mouse (aimAt, fire, reloadGesture, scoping),
 * advance(seconds), bench(frames), pause(), play(), finishCalib().
 */
import { WebGLRenderer } from "three";
import page from "../../index.html?raw";
import "../ui/base.css";
import "../app/screens.css";
import "../app/play.css";
import "./harness.css";
import { Crosshair } from "../app/crosshair";
import { Hud } from "../app/hud";
import { showResults } from "../app/results";
import { NullAudioBus } from "../audio/index";
import { Assets } from "../engine/assets";
import { IDLE_AIM } from "../engine/common";
import { mulberry32 } from "../engine/rules/rng";
import type { Aim, AssetLoader, CalibrationTarget, Difficulty, Game, GameContext, GameEntry, HudSink, InputKind, Quality } from "../engine/types";
import { MouseInput } from "../input/pointer";
import { ScopeControl, scopeKeys } from "../input/scope";
import { $ } from "../ui/dom";

/** The harness's query parameters, as a game's dev.ts reads them. */
export class HarnessParams {
  readonly query = new URLSearchParams(location.search);

  number(name: string, fallback: number): number {
    const raw = this.query.get(name);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  /** A yes/no parameter: true for 1, false for 0, undefined when it is not given. */
  flag(name: string): boolean | undefined {
    const raw = this.query.get(name);
    return raw === null ? undefined : raw === "1" || raw === "true";
  }

  get seed(): number {
    return this.number("seed", 1851);
  }
  /** The wave (or level) to start on: ?wave=N. */
  get wave(): number {
    return this.number("wave", 1);
  }
  /** Hits hurt but never kill: ?god=1. */
  get god(): boolean {
    return this.flag("god") === true;
  }
  get difficulty(): Difficulty {
    return this.query.get("difficulty") === "relaxed" ? "relaxed" : "standard";
  }
  get reducedFlashing(): boolean {
    return this.query.get("flashing") === "reduced";
  }
  /** Aim Assist is on, as it is for a player, unless ?assist=0. */
  get aimAssist(): boolean {
    return this.flag("assist") !== false;
  }
  /** Load the art from this folder instead of public/: ?assetBase=/some/folder/. */
  get assetBase(): string | null {
    return this.query.get("assetBase");
  }
}

export interface HarnessOptions<G extends Game> {
  /** The game's arcade entry: its title, poster, and what it uses. */
  entry: GameEntry;
  /** Makes the game, with whatever options the parameters ask for. */
  create(params: HarnessParams): Promise<G>;
  /** Every one-time tip's id, marked seen with ?tips=seen. */
  tips?: readonly string[];
  /** How many hits end the harness's short aim check. */
  checkHits?: number;
}

interface HudEvent {
  t: number;
  m: string;
  a: unknown[];
}

/** The page's HUD, writing down every call a game makes on it (for scripts). */
function loggingHud(hud: Hud): HudSink & { log: HudEvent[] } {
  const log: HudEvent[] = [];
  return new Proxy(hud as unknown as HudSink & { log: HudEvent[] }, {
    get(target, key, receiver) {
      if (key === "log") return log;
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        log.push({ t: performance.now(), m: key, a: args });
        if (log.length > 2000) log.shift();
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** The mouse as the page's MouseInput, which a script can also move and fire. */
class HarnessMouse extends MouseInput {
  private lastNow = 0;

  /** Aim at a point of the stage, in fractions. */
  aimAt(x: number, y: number): void {
    this.x = Math.min(Math.max(x, 0), 1);
    this.y = Math.min(Math.max(y, 0), 1);
    this.seen = true;
  }

  /** One shot where it aims. */
  override fire(): void {
    super.fire();
  }

  /** The reload gesture: a moment off the screen. */
  reloadGesture(): void {
    this.reload(this.lastNow);
  }

  /** Look through the scope, or stop (a game with one): as the right button held. */
  scoping(on: boolean): void {
    if (on) this.scope?.press("mouse");
    else this.scope?.release("mouse");
  }

  override sample(now: number): Aim {
    this.lastNow = now;
    return super.sample(now);
  }
}

/** The app's markup for a game and its results, from index.html itself, so the harness wears the real chrome. */
function mountChrome(): void {
  const doc = new DOMParser().parseFromString(page, "text/html");
  for (const selector of ["#game", "#results", "#toast", "#announce", "svg.symbols"]) {
    const node = doc.querySelector(selector);
    if (node) document.body.append(document.importNode(node, true));
  }
  const game = $("game");
  game.hidden = false;
  game.dataset.ready = "true";
  game.dataset.phase = "harness";
  document.body.dataset.view = "game";
}

/** The game's asset loader: the engine's own, with paths from a sub-folder page put right. */
function assetLoader(): AssetLoader {
  const assets = new Assets();
  const fix = (u: string) => (u.startsWith("./") ? `/${u.slice(2)}` : u);
  return {
    gltf: (url, onProgress) => assets.gltf(fix(url), onProgress),
    texture: (url) => assets.texture(fix(url)),
  };
}

export async function runHarness<G extends Game>(options: HarnessOptions<G>): Promise<void> {
  const params = new HarnessParams();
  const entry = options.entry;
  document.title = `${entry.title} · dev harness`;
  mountChrome();
  const loading = document.createElement("p");
  loading.className = "harness-load subhead secondary";
  loading.textContent = "Getting ready…";
  document.body.append(loading);
  try {
    await run(options, params, loading);
  } catch (err) {
    console.error(err);
    loading.textContent = String(err);
  }
}

async function run<G extends Game>(options: HarnessOptions<G>, params: HarnessParams, loading: HTMLElement): Promise<void> {
  const entry = options.entry;
  const fixedW = params.number("w", 0);
  const fixedH = params.number("h", 0);
  const dpr = params.number("dpr", Math.min(2, window.devicePixelRatio || 1));
  const manual = params.flag("manual") === true;
  const stage = $("stage");
  if (fixedW && fixedH) {
    // A fixed stage in the top-left corner, whatever the window's size.
    stage.classList.add("harness-fixed");
    stage.style.width = `${fixedW}px`;
    stage.style.height = `${fixedH}px`;
  }
  const canvas = $<HTMLCanvasElement>("world");
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  const size = () => ({ w: fixedW || stage.clientWidth, h: fixedH || stage.clientHeight });
  const { w, h } = size();
  renderer.setSize(w, h, false);

  const reducedMotion = () => false;
  const hudImpl = new Hud(reducedMotion);
  const hud = loggingHud(hudImpl);
  const crosshair = new Crosshair($<HTMLCanvasElement>("crosshair"), reducedMotion);
  // The scope, in a game with one: Shift or the right button, held.
  const scope = entry.uses?.scope ? new ScopeControl("hold") : null;
  if (scope) scopeKeys(scope);
  const mouse = new HarnessMouse(stage, scope);
  const quality: Quality = { scale: 1, tier: (params.query.get("quality") as Quality["tier"]) || "high" };
  const unlocks = new Set<string>();
  if (params.flag("golden")) unlocks.add("golden");
  hudImpl.reset(unlocks.has("golden"));
  const input = params.query.get("input");
  const ctx: GameContext = {
    renderer,
    canvas,
    audio: new NullAudioBus(),
    hud,
    assets: assetLoader(),
    settings: {
      reducedMotion: false,
      reducedFlashing: params.reducedFlashing,
      difficulty: params.difficulty,
      aimAssist: params.aimAssist,
      unlocks,
      tipsSeen: new Set(params.query.get("tips") === "seen" ? (options.tips ?? []) : []),
      scope: { eye: false, button: "hold" },
    },
    quality,
    random: mulberry32(params.seed),
    clock: () => new Date(),
    ...(input === "mouse" || input === "touch" || input === "hand" ? { input: input as InputKind } : {}),
  };
  const game = await options.create(params);
  await game.load(ctx, (f) => (loading.textContent = `Getting ready… ${Math.round(f * 100)}%`));
  loading.remove();
  game.resize(w, h, dpr);
  new ResizeObserver(() => {
    if (fixedW) return;
    const s = size();
    renderer.setSize(s.w, s.h, false);
    game.resize(s.w, s.h, dpr);
  }).observe(stage);

  hudImpl.onGameOver = (stats) => {
    crosshair.visible = false;
    $("game").dataset.phase = "over";
    showResults(entry, stats, false);
  };
  hudImpl.onCrosshair = (style) => {
    crosshair.hiddenByGame = style === "none";
    if (style === "none") crosshair.clear();
  };
  hudImpl.onPlayerDown = () => {
    crosshair.visible = false;
    crosshair.clear();
  };
  $("again").onclick = () => location.reload();
  $("choose").onclick = () => $<HTMLDialogElement>("results").close();

  // The aim check, harness-sized: a few hits on the game's own targets, the
  // page's ring round the one to shoot.
  const hits = options.checkHits ?? 5;
  const calib = { active: params.flag("skipcalib") !== true, hits: 0, lit: null as CalibrationTarget | null, shots: 0 };
  const label = document.createElement("p");
  label.className = "harness-check glass subhead num";
  stage.append(label);
  const lightNext = () => {
    const ts = game.calibration.targets();
    calib.lit = ts[(calib.hits * 4) % Math.max(1, ts.length)] ?? null;
    game.calibration.light(calib.lit?.id ?? null);
    label.hidden = false;
    label.textContent = `Warm up on the targets · ${calib.hits} of ${hits}`;
  };
  const finishCalib = () => {
    calib.active = false;
    label.hidden = true;
    game.calibration.done();
    game.start();
    $("game").dataset.phase = "play";
    crosshair.visible = true;
  };
  game.calibration.begin?.();
  if (calib.active) lightNext();
  else finishCalib();

  const judgeCalibration = (aim: Aim) => {
    if (!calib.active || !aim.fired || !calib.lit) return;
    calib.shots++;
    const r = stage.getBoundingClientRect();
    const minSide = Math.min(r.width, r.height);
    const dx = ((aim.x - calib.lit.x) * r.width) / minSide;
    const dy = ((aim.y - calib.lit.y) * r.height) / minSide;
    if (Math.hypot(dx, dy) <= calib.lit.radius * 1.3) {
      game.calibration.hit(calib.lit.id);
      calib.hits++;
      if (calib.hits >= hits) setTimeout(finishCalib, 600);
      else lightNext();
    } else {
      game.calibration.miss(calib.lit.id, aim.x, aim.y);
    }
  };

  /** The crosshair, and the ring round the target to shoot. */
  const overlay = (aim: Aim, now: number) => {
    const target = calib.active ? game.calibration.targets().find((x) => x.id === calib.lit?.id) : undefined;
    const r = stage.getBoundingClientRect();
    crosshair.draw(aim, now, target ? { x: target.x * r.width, y: target.y * r.height, r: target.radius * Math.min(r.width, r.height) } : null);
  };

  let last = performance.now();
  let lastAim: Aim = IDLE_AIM;
  const frame = (dt: number, now: number) => {
    const aim = mouse.sample(now);
    lastAim = aim;
    judgeCalibration(aim);
    game.update(dt, now, aim);
    game.render();
    overlay(aim, now);
  };
  let running = !manual;
  let simNow = 0;
  const loop = (now: number) => {
    if (running) {
      // The first frame's time can come before `last` was taken: never a step backwards (as engine/host.ts).
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      frame(dt, now);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $("pause").onclick = () => {
    running = !running;
    last = performance.now();
    if (running) game.resume();
    else game.pause();
  };

  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const handy = {
    game,
    hud,
    mouse,
    renderer,
    crosshair,
    /** Stop the real-time loop (scripts then call advance). */
    pause: () => (running = false),
    play: () => {
      last = performance.now();
      running = true;
    },
    /** Step the game `seconds` forward in fixed 60 Hz frames, rendering the last. */
    advance: (seconds: number, renderEach = false) => {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) {
        simNow += 1000 / 60;
        const aim = mouse.sample(simNow);
        lastAim = aim;
        judgeCalibration(aim);
        game.update(1 / 60, simNow, aim);
        if (renderEach || i === n - 1) game.render();
      }
      overlay(lastAim, simNow);
    },
    /** Frame cost: `frames` updates + renders at 60 Hz steps, each waited on by the GPU. */
    bench: (frames: number) => {
      const times: number[] = [];
      const cpu: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        simNow += 1000 / 60;
        game.update(1 / 60, simNow, mouse.sample(simNow));
        game.render();
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const t2 = performance.now();
        cpu.push(t1 - t0);
        times.push(t2 - t0);
      }
      const stat = (a: number[]) => {
        const s = [...a].sort((x, y) => x - y);
        const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
        return { mean: a.reduce((x, y) => x + y, 0) / a.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] as number };
      };
      return { frame: stat(times), cpu: stat(cpu), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    glInfo: () => {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },
    calib,
    finishCalib,
  };
  (window as unknown as { __handy: typeof handy }).__handy = handy;
  document.body.dataset["ready"] = "1";
}
