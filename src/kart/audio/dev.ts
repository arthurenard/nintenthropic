/**
 * The developer's sound desk for Grip Prix (dev.html). Every sound and every
 * piece of music is drawn here as a waveform and a spectrogram with its
 * levels, and a button plays it — but nothing ever plays by itself: audio
 * starts only when a play button is pressed. A scripted race can be rendered
 * through the real engine and RaceAudio *offline* (an OfflineAudioContext, so
 * nothing is heard) and its mix measured; its result can be played too, by
 * button.
 *
 * Also exposed as window.__kartAudioDev for headless checks.
 */
import { CUES, cuesInPack } from "../../audio/cues/table";
import { WebAudioEngine } from "../../audio/engine";
import { renderTake } from "../../audio/render";
import {
  type Picture,
  drawSpectrogram,
  drawWaveform,
  meanOf,
  peakOfBuffer,
  rmsOf,
  spectralCentroid,
  stack,
  toDb,
} from "./analysis";
import { createMusicRenderer } from "./music/loader";
import { PIECES, THEME_PIECES, type PieceId } from "./music/pieces";
import { MUSIC_SAMPLE_RATE, type RenderedMusic } from "./music/render";
import { createRaceAudio } from "./race-audio";
import { SIM_LENGTH, SIM_LOCALS, simView } from "./simulate";

const SR = 44100;

// --- drawing and playing ---------------------------------------------------------------------------------

function paint(canvas: HTMLCanvasElement, picture: Picture): void {
  canvas.style.display = "block";
  canvas.width = picture.width;
  canvas.height = picture.height;
  const g = canvas.getContext("2d")!;
  g.putImageData(new ImageData(new Uint8ClampedArray(picture.data), picture.width, picture.height), 0, 0);
}

let player: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

/** Play a buffer (only ever from a button press). */
function playBuffer(left: Float32Array, right: Float32Array | null, sr: number, loop = false): void {
  player ??= new AudioContext();
  void player.resume();
  stopPlaying();
  const buffer = player.createBuffer(2, left.length, sr);
  buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel((right ?? left) as Float32Array<ArrayBuffer>, 1);
  const source = player.createBufferSource();
  source.buffer = buffer;
  source.loop = loop;
  const gain = player.createGain();
  gain.gain.value = 0.7;
  source.connect(gain).connect(player.destination);
  source.start();
  playing = source;
}

function stopPlaying(): void {
  try {
    playing?.stop();
  } catch {
    // Already stopped.
  }
  playing = null;
}

function stats(left: Float32Array, sr: number): { seconds: number; peakDb: number; rmsDb: number; dc: number; centroid: number; clipped: number } {
  let clipped = 0;
  for (let i = 0; i < left.length; i++) if (Math.abs(left[i]!) >= 0.999) clipped++;
  return {
    seconds: left.length / sr,
    peakDb: toDb(peakOfBuffer(left)),
    rmsDb: toDb(rmsOf(left)),
    dc: meanOf(left),
    centroid: spectralCentroid(left, sr),
    clipped,
  };
}

// --- the page ---------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { type: "button", textContent: label });
  b.addEventListener("click", onClick);
  return b;
}

function cueRow(cue: string, out: HTMLElement): void {
  const take = el("select");
  for (let k = 0; k < (CUES[cue]?.takes ?? 3); k++) take.append(el("option", { value: String(k), textContent: `take ${k + 1}` }));
  const canvas = el("canvas", { className: "pic" });
  const info = el("div", { className: "info" });
  const render = (): { left: Float32Array; right: Float32Array; loop: boolean } => {
    const t0 = performance.now();
    const r = renderTake(cue, Number(take.value), { sampleRate: SR, seed: 1 });
    const ms = performance.now() - t0;
    const left = r.channels[0]!;
    const right = r.channels[1] ?? left;
    paint(canvas, stack([drawWaveform(left, 700, 70), drawSpectrogram(left, SR, 700, 140, 12000)]));
    const s = stats(left, SR);
    info.textContent = `${s.seconds.toFixed(2)} s · peak ${s.peakDb.toFixed(1)} · rms ${s.rmsDb.toFixed(1)} · centroid ${s.centroid.toFixed(0)} Hz · level ${CUES[cue]!.level} dB · made in ${ms.toFixed(0)} ms`;
    return { left, right, loop: r.loop };
  };
  const row = el(
    "div",
    { className: "row" },
    el("h3", { textContent: cue }),
    take,
    button("Draw", render),
    button("Play", () => {
      const r = render();
      playBuffer(r.left, r.right, SR, r.loop);
    }),
    button("Stop", stopPlaying),
    info,
    canvas,
  );
  out.append(row);
}

const musicCache = new Map<string, RenderedMusic>();
const renderer = createMusicRenderer("auto");

async function renderMusic(id: PieceId, final: boolean): Promise<RenderedMusic> {
  const key = `${id}${final ? "-final" : ""}`;
  let r = musicCache.get(key);
  if (!r) {
    r = await renderer.render(id, final);
    musicCache.set(key, r);
  }
  return r;
}

function musicRow(id: PieceId, out: HTMLElement): void {
  const canvas = el("canvas", { className: "pic" });
  const info = el("div", { className: "info" });
  const draw = async (final: boolean): Promise<RenderedMusic> => {
    info.textContent = "making…";
    const r = await renderMusic(id, final);
    paint(canvas, stack([drawWaveform(r.left, 900, 80), drawSpectrogram(r.left, r.sampleRate, 900, 160, 12000)]));
    const s = stats(r.left, r.sampleRate);
    const parts = Object.entries(r.stats.parts).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ");
    info.textContent = `${PIECES[id].name}${final ? " (final lap)" : ""} · ${s.seconds.toFixed(1)} s · rms ${s.rmsDb.toFixed(1)} · peak ${s.peakDb.toFixed(1)} · made in ${r.stats.renderMs.toFixed(0)} ms · parts (dB re mix) ${parts}`;
    return r;
  };
  out.append(
    el(
      "div",
      { className: "row" },
      el("h3", { textContent: id }),
      button("Draw", () => void draw(false)),
      ...((THEME_PIECES as readonly string[]).includes(id) ? [button("Draw final lap", () => void draw(true))] : []),
      button("Play", () => void draw(false).then((r) => playBuffer(r.left, r.right, r.sampleRate, true))),
      ...((THEME_PIECES as readonly string[]).includes(id) ? [button("Play final lap", () => void draw(true).then((r) => playBuffer(r.left, r.right, r.sampleRate, true)))] : []),
      button("Stop", stopPlaying),
      info,
      canvas,
    ),
  );
}

// --- the offline race ---------------------------------------------------------------------------------------------

export interface SimResult {
  seconds: number;
  peakDb: number;
  rmsDb: number;
  clipped: number;
  /** RMS per second, dBFS. */
  perSecond: number[];
  /** Loudest sample per second, dBFS. */
  peakPerSecond: number[];
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  loopsAtEnd: { engines: number; music: string | null };
  /** Milliseconds the audio code took on the page's thread per frame: mean and worst. */
  frameMs: { mean: number; worst: number };
  /** Loading the race's sounds and music: wall-clock time, and the longest stretch the page's thread was held (a "long task"). */
  load: { ms: number; longestTaskMs: number };
}

/**
 * Run the scripted race through the real engine and RaceAudio on an
 * OfflineAudioContext (rendered as fast as the machine can, silently) and
 * measure what came out.
 */
export async function simulateRace(options: { seconds?: number; music?: boolean; effects?: boolean; theme?: "meadow" | "volcano" | "snow" | "palm" } = {}): Promise<SimResult> {
  const sr = 48000;
  const seconds = options.seconds ?? SIM_LENGTH;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const engine = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, volume: 1 });
  // The engine resumes itself when its context changes state; here this script is in charge of the clock.
  ctx.onstatechange = null;
  const audio = createRaceAudio(engine, { volumes: { music: options.music === false ? 0 : 1, effects: options.effects === false ? 0 : 1 } });
  const longTasks: number[] = [];
  const observer = typeof PerformanceObserver === "undefined" ? null : new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
  try {
    observer?.observe({ entryTypes: ["longtask"] });
  } catch {
    // Long-task timing is not offered everywhere.
  }
  const loadStart = performance.now();
  await audio.load(options.theme ?? "meadow");
  const loadMs = performance.now() - loadStart;
  observer?.disconnect();
  const dt = 1 / 60;
  const frames = Math.floor(seconds / dt) - 1;
  let sum = 0;
  let worst = 0;
  let last = { engines: 0, music: null as string | null };
  for (let k = 1; k <= frames; k++) {
    const t = k * dt;
    void ctx.suspend(t).then(() => {
      const t0 = performance.now();
      audio.frame(simView(t, dt), SIM_LOCALS, dt);
      const spent = performance.now() - t0;
      sum += spent;
      worst = Math.max(worst, spent);
      const s = audio.stats();
      last = { engines: s.engines, music: s.music };
      void ctx.resume();
    });
  }
  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0).slice();
  const right = buffer.getChannelData(1).slice();
  const perSecond: number[] = [];
  const peakPerSecond: number[] = [];
  for (let s = 0; s + sr <= left.length; s += sr) {
    perSecond.push(toDb(Math.sqrt((rmsOf(left, s, s + sr) ** 2 + rmsOf(right, s, s + sr) ** 2) / 2)));
    let p = 0;
    for (let i = s; i < s + sr; i++) p = Math.max(p, Math.abs(left[i]!), Math.abs(right[i]!));
    peakPerSecond.push(toDb(p));
  }
  let clipped = 0;
  for (let i = 0; i < left.length; i++) if (Math.abs(left[i]!) >= 0.999 || Math.abs(right[i]!) >= 0.999) clipped++;
  audio.dispose();
  try {
    engine.dispose();
  } catch {
    // An offline context cannot be closed; there is nothing left to release.
  }
  return {
    seconds: left.length / sr,
    peakDb: toDb(Math.max(peakOfBuffer(left), peakOfBuffer(right))),
    rmsDb: toDb(Math.sqrt((rmsOf(left) ** 2 + rmsOf(right) ** 2) / 2)),
    clipped,
    perSecond,
    peakPerSecond,
    left,
    right,
    sampleRate: sr,
    loopsAtEnd: last,
    frameMs: { mean: sum / frames, worst },
    load: { ms: loadMs, longestTaskMs: Math.max(0, ...longTasks) },
  };
}

function simSection(out: HTMLElement): void {
  const canvas = el("canvas", { className: "pic" });
  const info = el("div", { className: "info" });
  let result: SimResult | null = null;
  const run = async (opts: Parameters<typeof simulateRace>[0], label: string): Promise<void> => {
    info.textContent = `rendering ${label} offline…`;
    result = await simulateRace(opts);
    paint(canvas, stack([drawWaveform(result.left, 900, 90), drawSpectrogram(result.left, result.sampleRate, 900, 160, 12000)]));
    info.textContent =
      `${label}: ${result.seconds.toFixed(1)} s · rms ${result.rmsDb.toFixed(1)} dBFS · peak ${result.peakDb.toFixed(1)} · clipped samples ${result.clipped} · ` +
      `audio code per frame: mean ${result.frameMs.mean.toFixed(2)} ms, worst ${result.frameMs.worst.toFixed(2)} ms`;
  };
  out.append(
    el(
      "div",
      { className: "row" },
      el("h3", { textContent: "A scripted race, rendered offline" }),
      el("p", { textContent: "Four local karts and three others: countdown, a flooded start, drifts, items, hits, a jump, a fall, the last lap and the finish. Rendered silently through the real engine; the Play button is yours." }),
      button("Render the mix", () => void run({}, "mix")),
      button("Effects only", () => void run({ music: false }, "effects only")),
      button("Music only", () => void run({ effects: false }, "music only")),
      button("Play the result", () => {
        if (result) playBuffer(result.left, result.right, result.sampleRate);
      }),
      button("Stop", stopPlaying),
      info,
      canvas,
    ),
  );
}

function build(): void {
  const root = document.getElementById("app")!;
  root.append(el("h1", { textContent: "Grip Prix sound desk" }), el("p", { textContent: "Nothing plays until you press a Play button." }));
  const sim = el("section");
  sim.append(el("h2", { textContent: "Mix" }));
  simSection(sim);
  const music = el("section");
  music.append(el("h2", { textContent: "Music" }));
  for (const id of Object.keys(PIECES) as PieceId[]) musicRow(id, music);
  const cues = el("section");
  cues.append(el("h2", { textContent: "Sounds" }));
  for (const cue of cuesInPack("kart")) cueRow(cue, cues);
  root.append(sim, music, cues);
}

declare global {
  interface Window {
    __kartAudioDev?: {
      simulateRace: typeof simulateRace;
      renderMusic: (id: PieceId, final: boolean) => Promise<{ stats: RenderedMusic["stats"]; seconds: number; sampleRate: number; samples: number }>;
      renderCue: (cue: string, take?: number) => { seconds: number; peakDb: number; rmsDb: number; dc: number; centroid: number; clipped: number };
      musicSampleRate: number;
    };
  }
}

window.__kartAudioDev = {
  simulateRace,
  musicSampleRate: MUSIC_SAMPLE_RATE,
  async renderMusic(id, final) {
    const r = await renderMusic(id, final);
    return { stats: r.stats, seconds: r.loopSamples / r.sampleRate, sampleRate: r.sampleRate, samples: r.loopSamples };
  },
  renderCue(cue, take = 0) {
    const r = renderTake(cue, take, { sampleRate: SR, seed: 1 });
    return stats(r.channels[0]!, SR);
  },
};

build();
