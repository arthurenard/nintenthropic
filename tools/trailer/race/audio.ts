/**
 * Grip Prix's own sound for one trailer clip, rendered offline. capture.mjs records every frame's view ({karts,
 * events, things, phase...}) while it films; this page replays them through the race's real audio (createRaceAudio on
 * the games' WebAudioEngine, running on an OfflineAudioContext, so nothing is ever heard), calling audio.frame(view,
 * localKarts(views), dt) at each frame's time, as src/kart/audio/dev.ts does for its scripted race. The music is left
 * out (the trailer has its own): effects only (engines, drift squeals, sparks, pickups, items, hits, jumps, the start lights).
 *
 *   await window.renderRaceAudio({ url, theme, trackId, views })  ->  { left, right } as base64 Float32 (48 kHz), `pre` frames included
 */
import { WebAudioEngine } from "../../../src/audio/engine";
import { createRaceAudio, localKarts } from "../../../src/kart/audio";
import type { RaceView, TrackDef } from "../../../src/kart/contract";

const SR = 48000;
const FPS = 60;

interface Recorded {
  fps: number;
  pre: number;
  preViews: Frame[];
  views: Frame[];
}
type Frame = Omit<RaceView, "track" | "racers">;

interface Spec {
  /** Where capture.mjs wrote the clip's views (served by the dev server). */
  url: string;
  theme: TrackDef["theme"];
  trackId: string;
  /** The karts the clip's camera follows (one view: that kart; four: the split screen's). */
  views: number[];
  /** How many of the recorded pre-roll frames to play before the clip (they warm up the engines; the caller trims them). */
  warm?: number;
}

const toBase64 = (a: Float32Array): string => {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function renderRaceAudio(spec: Spec): Promise<{ left: string; right: string; frames: number; warm: number; fired: number }> {
  const rec = (await (await fetch(spec.url)).json()) as Recorded;
  const warm = Math.min(spec.warm ?? 90, rec.preViews.length);
  const all: Frame[] = [...rec.preViews.slice(rec.preViews.length - warm), ...rec.views];
  const track = { id: spec.trackId, theme: spec.theme } as unknown as TrackDef;
  const make = (f: Frame): RaceView => ({ ...f, track, racers: [] }) as RaceView;
  const dt = 1 / FPS;
  const ctx = new OfflineAudioContext(2, Math.ceil(all.length * dt * SR), SR);
  const engine = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, volume: 1 });
  // The engine resumes itself when its context changes state; here this script is in charge of the clock.
  ctx.onstatechange = null;
  const audio = createRaceAudio(engine, { volumes: { music: 0, effects: 1 } });
  await audio.load(spec.theme);
  const locals = localKarts(spec.views);
  let fired = 0;
  audio.frame(make(all[0]!), locals, dt);
  for (let k = 1; k < all.length; k++) {
    void ctx.suspend(k * dt).then(() => {
      audio.frame(make(all[k]!), locals, dt);
      fired += audio.stats().fired;
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0).slice();
  const right = buffer.getChannelData(1).slice();
  audio.dispose();
  try {
    engine.dispose();
  } catch {
    // An offline context cannot be closed; there is nothing left to release.
  }
  return { left: toBase64(left), right: toBase64(right), frames: all.length, warm, fired };
}

(window as unknown as { renderRaceAudio: typeof renderRaceAudio }).renderRaceAudio = renderRaceAudio;
