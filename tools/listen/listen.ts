/**
 * Grip Prix's sound rendered offline for listening later: a scripted scene (scenes.ts) or a real race of bots on a
 * track, through the real WebAudioEngine and RaceAudio on an OfflineAudioContext, so nothing is ever heard. render.mjs
 * drives this page in a muted headless Chrome and writes WAV files.
 *
 *   await window.renderListen({ scene: "solo-heavy" })
 *   await window.renderListen({ race: "meadow-loop", seconds: 90, views: [0], music: true })
 */
import { WebAudioEngine } from "../../src/audio/engine";
import { DEFAULT_LEVELS } from "../../src/kart/app/prefs";
import { createRaceAudio, localKarts } from "../../src/kart/audio";
import type { RaceView } from "../../src/kart/contract";
import { createSimRace } from "../../src/kart/sim/race";
import { trackById } from "../../src/kart/track/tracks";
import { SCENES, cast, type Scene } from "./scenes";

const SR = 48000;
const FPS = 60;

export interface ListenSpec {
  scene?: string;
  /** A real race on this track, all bots, the screen showing `views`. */
  race?: string;
  seconds?: number;
  views?: number[];
  /** Skip this many seconds of a real race before rendering (simulated, not heard). */
  skip?: number;
  music?: boolean;
  effects?: boolean;
  seed?: number;
}

export interface ListenResult {
  left: string;
  right: string;
  sampleRate: number;
  seconds: number;
  /** The audio code's time a frame on this thread, ms. */
  frameMs: { mean: number; p95: number; worst: number };
  /** Sounds started, and the most loops of each kind at once. */
  fired: number;
  most: { engines: number; drifts: number; surfaces: number; winds: number };
  /** The race's own events by type, for the report. */
  events: Record<string, number>;
}

const toBase64 = (a: Float32Array): string => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Math.random seeded, so a render repeats (which take plays, where a loop starts). */
function seedRandom(seed: number): void {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function raceScene(trackId: string, seconds: number, views: number[], skip: number): Scene {
  const track = trackById(trackId);
  const race = createSimRace({ track, laps: track.laps, seed: 7, racers: cast(8) });
  const skipTicks = Math.round(skip * FPS);
  for (let i = 0; i < skipTicks; i++) {
    race.step(new Map());
    race.view();
  }
  return {
    seconds,
    theme: track.theme,
    views,
    view(): RaceView {
      race.step(new Map());
      return race.view();
    },
  };
}

async function renderListen(spec: ListenSpec): Promise<ListenResult> {
  seedRandom(spec.seed ?? 1851);
  const scene = spec.race ? raceScene(spec.race, spec.seconds ?? 60, spec.views ?? [0], spec.skip ?? 0) : SCENES[spec.scene ?? ""]?.();
  if (!scene) throw new Error(`no scene "${spec.scene}"`);
  const seconds = spec.race ? scene.seconds : Math.min(scene.seconds, spec.seconds ?? scene.seconds);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const engine = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, volume: 1 });
  ctx.onstatechange = null;
  // The game's own sliders as a new player finds them (the music a little under the engines).
  const audio = createRaceAudio(engine, { volumes: { music: spec.music === false ? 0 : DEFAULT_LEVELS.music, effects: spec.effects === false ? 0 : DEFAULT_LEVELS.effects } });
  await audio.load(scene.theme);
  const locals = scene.locals ?? localKarts(scene.views);
  const dt = 1 / FPS;
  const frames = Math.floor(seconds * FPS) - 1;
  const times: number[] = [];
  let fired = 0;
  const most = { engines: 0, drifts: 0, surfaces: 0, winds: 0 };
  const events: Record<string, number> = {};
  const step = (t: number): void => {
    const view = scene.view(t, dt);
    for (const e of view.events) events[e.type] = (events[e.type] ?? 0) + 1;
    const t0 = performance.now();
    audio.frame(view, locals, dt);
    times.push(performance.now() - t0);
    const s = audio.stats();
    fired += s.fired;
    most.engines = Math.max(most.engines, s.engines);
    most.drifts = Math.max(most.drifts, s.drifts);
    most.surfaces = Math.max(most.surfaces, s.surfaces);
    most.winds = Math.max(most.winds, s.winds);
  };
  step(0);
  for (let k = 1; k <= frames; k++) {
    void ctx.suspend(k * dt).then(() => {
      step(k * dt);
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  audio.dispose();
  try {
    engine.dispose();
  } catch {
    // An offline context cannot be closed.
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    left: toBase64(buffer.getChannelData(0).slice()),
    right: toBase64(buffer.getChannelData(1).slice()),
    sampleRate: SR,
    seconds,
    frameMs: { mean: times.reduce((a, b) => a + b, 0) / times.length, p95: sorted[Math.floor(0.95 * (sorted.length - 1))]!, worst: sorted.at(-1)! },
    fired,
    most,
    events,
  };
}

(window as unknown as { renderListen: typeof renderListen }).renderListen = renderListen;
