/**
 * The frame renderer for the promo video. One scene per page load
 * (?scene=western|night|orbit|ridge|cold|title|end), stepped from Node one
 * frame at a time (window.promo.step / post), so the footage is smooth
 * whatever the machine's speed:
 *
 *  - a game is the real game, run through its dev harness (src/dev/harness.ts,
 *    ?manual=1) and advanced 1/60 s per frame with a scripted hand;
 *  - the page's timers and animation frames run on Playwright's fake clock, and
 *    every CSS animation and transition is scrubbed to the simulated time, so
 *    the HUD's pops and fades are exactly where they would be in play;
 *  - every sound a game asks for is written down with its simulated time
 *    (window.promo.events()), for the offline audio mix (audio.ts).
 *
 * See README.md for how the pieces fit.
 */
import "../../src/ui/base.css";
import "./promo.css";
import { Pip } from "../../src/app/pip";
import { NullAudioBus } from "../../src/audio/index";
import { $ } from "../../src/ui/dom";
import { Shooter } from "./aim";
import { type Card, coldOpen, endCard, title } from "./cards";
import { DIRECTORS, type Env, type Target } from "./directors";
import { fingerGun } from "./hand";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Scene = "western" | "night" | "orbit" | "ridge" | "cold" | "title" | "end";

export interface AudioEvent {
  /** Simulated seconds since the page's game began. */
  t: number;
  type: "play" | "loop" | "stop" | "filter";
  cue?: string;
  options?: Record<string, unknown>;
  /** For stop: the loop's id. */
  id?: number;
  name?: string;
  amount?: number;
}

export interface Config {
  fps: number;
  /** Frames simulated before recording begins (not rendered to files, still played). */
  pre: number;
  /** Frames recorded. */
  frames: number;
  caption?: { title: string; line: string; from: number; to: number };
  /** Seconds of fade from and to black at the two ends of the scene. */
  fadeIn: number;
  fadeOut: number;
  /** Show the hand-in-the-corner picture. */
  pip: boolean;
}

const params = new URLSearchParams(location.search);
const scene = (params.get("scene") ?? "western") as Scene;
const W = Number(params.get("w") ?? 1920);
const H = Number(params.get("h") ?? 1080);
document.documentElement.style.setProperty("--u", String(H / 1080));

const GAMES: Record<string, () => Promise<unknown>> = {
  western: () => import("../../src/games/western/dev"),
  night: () => import("../../src/games/night/dev"),
  orbit: () => import("../../src/games/orbit/dev"),
  ridge: () => import("../../src/games/ridge/dev"),
};

// --- what the games ask the audio bus for -------------------------------------------------------

const events: AudioEvent[] = [];
let simT = 0;
let loopId = 0;

function recordAudio(): void {
  const proto = NullAudioBus.prototype as any;
  proto.play = function (cue: string, options?: Record<string, unknown>) {
    events.push({ t: simT, type: "play", cue, options: options ? { ...options } : {} });
  };
  proto.loop = function (cue: string, options?: Record<string, unknown>) {
    const id = ++loopId;
    events.push({ t: simT, type: "loop", cue, options: options ? { ...options } : {}, id });
    return () => events.push({ t: simT, type: "stop", id });
  };
  proto.setFilter = function (name: string, amount: number) {
    events.push({ t: simT, type: "filter", name, amount });
  };
}

// --- CSS animations and transitions follow the simulated clock ----------------------------------

const tracked = new WeakMap<Animation, number>();

function scrub(nowMs: number): void {
  for (const a of document.getAnimations()) {
    let start = tracked.get(a);
    if (start === undefined) {
      start = nowMs;
      tracked.set(a, start);
      a.pause();
    }
    a.currentTime = nowMs - start;
  }
}

/** Before recording: whatever was mid-transition (the world fading in, the sheet arriving) is finished. */
function settle(): void {
  for (const a of document.getAnimations()) {
    try {
      a.finish();
    } catch {
      // An endless animation has no end; scrub() will take it over.
    }
  }
}

// --- the layers -------------------------------------------------------------------------------

function layer(id: string): HTMLElement {
  const node = document.createElement("div");
  node.id = id;
  node.className = "promo-layer";
  document.body.append(node);
  return node;
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

class Promo {
  cfg!: Config;
  ready: Promise<void>;
  private handy: any = null;
  private game: any = null;
  private pip: Pip | null = null;
  private shooter = new Shooter();
  private director = DIRECTORS[scene];
  private card: Card | null = null;
  private fade!: HTMLElement;
  private caption: HTMLElement | null = null;
  private velocities = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private lastAim = { x: 0.5, y: 0.5 };
  private fps = 60;
  private done = new Set<object>();
  private memo: Record<string, any> = {};

  constructor() {
    this.ready = this.boot();
  }

  private async boot(): Promise<void> {
    this.fade = layer("promo-fade");
    if (scene in GAMES) {
      recordAudio();
      await GAMES[scene]!();
      await new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        const poll = () => {
          if (document.body.dataset["ready"] === "1") resolve();
          else if (Date.now() - t0 > 180000) reject(new Error("the game did not become ready"));
          else setTimeout(poll, 100);
        };
        poll();
      });
      this.handy = (window as any).__handy;
      this.game = this.handy.game;
      const shooterOptions = this.director?.shooter ?? {};
      this.shooter = new Shooter({ seed: 11, ...shooterOptions });
      if (this.director) this.shooter.place(this.director.rest.x, this.director.rest.y);
      this.pip = new Pip();
    } else {
      const cards = layer("promo-cards");
      const games = [
        { name: "High Noon", poster: "/assets/western/poster.webp" },
        { name: "Dead of Night", poster: "/assets/night/poster.webp" },
        { name: "Orbital Decay", poster: "/assets/orbit/poster.webp" },
        { name: "Overwatch Ridge", poster: "/assets/ridge/poster.webp" },
      ];
      this.card = scene === "cold" ? coldOpen(cards) : scene === "title" ? title(cards) : endCard(cards, games);
      // Give the posters a moment to decode.
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
      await document.fonts.ready;
    }
    settle();
  }

  init(cfg: Config): void {
    this.cfg = cfg;
    this.fps = cfg.fps;
    if (this.handy) {
      $("game").dataset.phase = "play";
      if (this.pip && cfg.pip) {
        this.pip.show(false);
        this.pip.showInPlay = true;
      } else this.pip?.hide();
    }
    if (cfg.caption) {
      const box = layer("promo-caption");
      const cap = document.createElement("div");
      cap.className = "promo-caption glass";
      cap.innerHTML = `<div class="cap-title"></div><div class="cap-line"></div>`;
      cap.querySelector(".cap-title")!.textContent = cfg.caption.title;
      cap.querySelector(".cap-line")!.textContent = cfg.caption.line;
      box.append(cap);
      this.caption = cap;
    }
  }

  /** The game moves one video frame on (a = frame counting from the page's first, pre-roll included). */
  step(a: number): void {
    if (!this.handy || !this.director) return;
    const dt = 1 / this.fps;
    const t = a * dt;
    simT = t;
    const env: Env = {
      handy: this.handy,
      game: this.game,
      t,
      dt,
      local: t - this.cfg.pre / this.fps,
      aim: this.lastAim,
      vel: (key, x, y) => this.velocity(key, x, y, dt),
      targets: () => (this.game.debug?.targets?.() ?? []) as Target[],
      fired: this.shooter.fired,
      memo: this.memo,
    };
    for (const s of this.director.script ?? []) {
      if (!this.done.has(s) && env.local >= s.at - 1e-9) {
        this.done.add(s);
        s.run(env);
      }
    }
    this.director.frame?.(env);
    const want = this.director.pick(env);
    const fires = this.shooter.step(t, dt, want, this.director.restAt?.(env.local) ?? this.director.rest);
    this.shooter.advanceTick(dt);
    const shown = this.shooter.shown;
    this.lastAim = { x: this.shooter.x, y: this.shooter.y };
    const mouse = this.handy.mouse;
    mouse.aimAt(shown.x, shown.y);
    if (fires) mouse.fire();
    const steps = Math.max(1, Math.round(60 / this.fps));
    this.handy.advance(steps / 60, true);
  }

  private velocity(key: string, x: number, y: number, dt: number): [number, number] {
    const old = this.velocities.get(key);
    if (!old) {
      this.velocities.set(key, { x, y, vx: 0, vy: 0 });
      return [0, 0];
    }
    const vx = (x - old.x) / dt;
    const vy = (y - old.y) / dt;
    old.vx += (vx - old.vx) * 0.25;
    old.vy += (vy - old.vy) * 0.25;
    old.x = x;
    old.y = y;
    return [old.vx, old.vy];
  }

  /** After the page's timers ran: animations to this instant, then the promo's own layers. */
  post(a: number): void {
    const t = a / this.fps;
    scrub(t * 1000);
    const local = (a - this.cfg.pre) / this.fps;
    const dur = this.cfg.frames / this.fps;
    // The picture in the corner: the hand, thumb folding as it fires.
    if (this.pip && this.cfg.pip) {
      const since = this.shooter.sinceShot(t);
      const recoil = Number.isFinite(since) ? Math.max(0, 1 - since / 0.22) : 0;
      const w = Math.sin(t * 1.3) * 0.012;
      const landmarks = fingerGun({ x: this.shooter.x, y: this.shooter.y, fold: this.shooter.fold(t), recoil, wobble: [w, Math.cos(t * 1.7) * 0.01] });
      this.pip.draw({ landmarks, handedness: "Right", capturedAt: t * 1000, sequence: a }, t * 1000);
    }
    this.card?.update(local);
    if (this.caption) {
      const c = this.cfg.caption!;
      const o = smooth((local - c.from) / 0.5) * (1 - smooth((local - c.to) / 0.45));
      this.caption.style.opacity = String(o);
      this.caption.style.transform = `translateY(${(o - 1) * 14 * (H / 1080)}px)`;
    }
    const fin = this.cfg.fadeIn > 0 ? 1 - smooth(local / this.cfg.fadeIn) : 0;
    const fout = this.cfg.fadeOut > 0 ? smooth((local - (dur - this.cfg.fadeOut)) / this.cfg.fadeOut) : 0;
    this.fade.style.opacity = String(Math.max(fin, fout));
  }

  events(): AudioEvent[] {
    return events;
  }

  /** For tuning: what the game shows can be shot, right now. */
  debugTargets(): Target[] {
    return (this.game?.debug?.targets?.() ?? []) as Target[];
  }
  /** For tuning: the harness's HUD log. */
  hudLog(): unknown[] {
    return this.handy?.hud?.log ?? [];
  }
  get size(): { w: number; h: number } {
    return { w: W, h: H };
  }
}

(window as any).promo = new Promo();
