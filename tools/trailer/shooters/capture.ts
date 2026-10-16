/**
 * The frame renderer for the trailer's shooter clips (an adaptation of
 * tools/promo/capture.ts). One clip per page load (?clip=hn-hero ...), stepped
 * from Node one frame at a time (window.promo.step / post), so the footage is
 * smooth whatever the machine's speed:
 *
 *  - a game is the real game, run through its dev harness (src/dev/harness.ts,
 *    ?manual=1) with a scripted hand (aim.ts); the hand picture (Pip) is hidden;
 *  - one captured frame is 1/rate of simulated time. The rate is 60 for a
 *    normal clip and 120 for a slow-motion one (played back at 60 fps, it runs
 *    at half speed): the game itself is stepped by 1/rate;
 *  - the page's timers and animation frames run on Playwright's fake clock, and
 *    every CSS animation and transition is scrubbed to the simulated time, so
 *    the HUD's pops and fades slow down with the game;
 *  - every sound a game asks for is written down with its simulated time
 *    (window.promo.events()).
 *
 * See README.md.
 */
import "../../../src/ui/base.css";
import "./trailer.css";
import { Pip } from "../../../src/app/pip";
import { NullAudioBus } from "../../../src/audio/index";
import { $ } from "../../../src/ui/dom";
import { Shooter } from "./aim";
import { DIRECTORS, type Env, type Target } from "./directors";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AudioEvent {
  /** Simulated seconds since the page's game began. */
  t: number;
  type: "play" | "loop" | "stop" | "filter";
  cue?: string;
  options?: Record<string, unknown>;
  id?: number;
  name?: string;
  amount?: number;
}

/** A hit marker or a floating score the game put on the HUD, at a simulated time. */
export interface HudEvent {
  t: number;
  type: "hitMarker" | "popup";
  /** hit | headshot | kill, or the popup's text. */
  what: string;
}

export interface Config {
  /** Simulation steps per second of simulated time that one captured frame advances: 60, or 120 for slow motion. */
  rate: number;
  /** Frames simulated before recording begins (not rendered to files, still played). */
  pre: number;
  /** Frames recorded. */
  frames: number;
}

const params = new URLSearchParams(location.search);
const clip = params.get("clip") ?? "hn-hero";
const H = Number(params.get("h") ?? 1080);
document.documentElement.style.setProperty("--u", String(H / 1080));

const GAMES: Record<string, () => Promise<unknown>> = {
  hn: () => import("../../../src/games/western/dev"),
  dn: () => import("../../../src/games/night/dev"),
  od: () => import("../../../src/games/orbit/dev"),
  or: () => import("../../../src/games/ridge/dev"),
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

class Promo {
  cfg!: Config;
  ready: Promise<void>;
  private handy: any = null;
  private game: any = null;
  private pip: Pip | null = null;
  private shooter = new Shooter();
  private readonly director = DIRECTORS[clip]!;
  private velocities = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private lastAim = { x: 0.5, y: 0.5 };
  private rate = 60;
  private done = new Set<object>();
  private memo: Record<string, any> = {};
  private simNow = 0;
  /** Per-frame notes for tuning: what happened when. */
  readonly notes: { t: number; what: string }[] = [];
  /** The hit markers and floating scores the game asked the HUD for. */
  private readonly hudEvents: HudEvent[] = [];


  constructor() {
    if (!this.director) throw new Error(`no director for clip ${clip}`);
    this.ready = this.boot();
  }

  private async boot(): Promise<void> {
    recordAudio();
    await GAMES[clip.slice(0, 2)]!();
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
    this.shooter = new Shooter({ seed: 11, ...(this.director.shooter ?? {}) });
    this.shooter.place(this.director.rest.x, this.director.rest.y);
    this.pip = new Pip();
    // Note what the game asks the HUD for (the harness keeps a log of it, but only its last 2000 calls).
    const log = this.handy.hud.log as { m: string; a: unknown[] }[];
    const push = log.push.bind(log);
    log.push = (...entries) => {
      for (const e of entries) {
        if (e.m === "hitMarker") this.hudEvents.push({ t: simT, type: "hitMarker", what: String(e.a[2]) });
        else if (e.m === "popup") this.hudEvents.push({ t: simT, type: "popup", what: String(e.a[2]) });
      }
      return push(...entries);
    };
    settle();
  }

  init(cfg: Config): void {
    this.cfg = cfg;
    this.rate = cfg.rate;
    $("game").dataset.phase = "play";
    // No hand picture in the trailer: the app's Pip (the hand in the corner) stays hidden.
    this.pip!.hide();
  }

  /** The game moves one captured frame on (a = frame counting from the page's first, pre-roll included). */
  step(a: number): void {
    const dt = 1 / this.rate;
    const t = a * dt;
    simT = t;
    const env: Env = {
      handy: this.handy,
      game: this.game,
      t,
      dt,
      local: t - this.cfg.pre / this.rate,
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
    if (fires) {
      mouse.fire();
      this.notes.push({ t: env.local, what: "fire" });
    }
    if (this.rate === 60) {
      this.handy.advance(1 / 60, true);
    } else {
      // Slow motion: the harness steps 1/60 s at the least, so step the game by hand, as it does.
      this.simNow += 1000 / this.rate;
      const aim = mouse.sample(this.simNow);
      this.game.update(1 / this.rate, this.simNow, aim);
      this.game.render();
      this.handy.crosshair.draw(aim, this.simNow, null);
    }
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

  /** After the page's timers ran: animations to this instant. */
  post(a: number): void {
    scrub(((a / this.rate) * 1000));
  }

  events(): AudioEvent[] {
    return events;
  }

  hud(): HudEvent[] {
    return this.hudEvents;
  }

  /** The simulated seconds at which shots registered, from the first frame of the page. */
  shots(): number[] {
    return this.shooter.shots;
  }

  /** For tuning: what the game shows can be shot, right now. */
  debugTargets(): Target[] {
    return (this.game?.debug?.targets?.() ?? []) as Target[];
  }
  /** For tuning: the harness's HUD log. */
  hudLog(): unknown[] {
    return this.handy?.hud?.log ?? [];
  }
}

(window as any).promo = new Promo();
