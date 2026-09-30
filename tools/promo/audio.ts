/**
 * The promo's soundtrack, mixed offline: an OfflineAudioContext runs the
 * games' own engine (src/audio/engine.ts, with every cue synthesised by
 * src/audio/cues/) and plays each sound a game asked for during capture at
 * the moment it asked for it. Nothing here ever reaches a speaker.
 *
 * A quiet synthesised bed (a soft pad and a few music-box notes) sits under
 * it, only where the picture is calm: the cold open, the title and the end.
 */
import { WebAudioEngine } from "../../src/audio/engine";
import type { AudioEvent } from "./capture";

interface Segment {
  id: string;
  /** Where the segment starts in the video, s. */
  start: number;
  dur: number;
  events: AudioEvent[];
}
interface Extra {
  t: number;
  cue: string;
  options?: Record<string, unknown>;
}
export interface MixSpec {
  sampleRate: number;
  total: number;
  fade: number;
  segments: Segment[];
  extras: Extra[];
  /** Chord changes for the bed: [time, notes in Hz]. */
  music: { chords: { t: number; notes: number[] }[]; plucks: { t: number; f: number; g?: number }[]; padGain: number };
  seed: number;
}

/** A small deterministic generator, so a re-render sounds the same. */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bed(ctx: OfflineAudioContext, out: AudioNode, music: MixSpec["music"], total: number): void {
  const bus = ctx.createGain();
  bus.gain.value = music.padGain;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1400;
  tone.Q.value = 0.4;
  bus.connect(tone).connect(out);
  // Chords: two soft voices a hair apart per note, swelling in and out.
  music.chords.forEach((chord, i) => {
    const t0 = chord.t;
    const t1 = i + 1 < music.chords.length ? music.chords[i + 1]!.t : total;
    const attack = 1.6;
    const release = 1.8;
    for (const f of chord.notes) {
      for (const [type, detune, level] of [["sine", -4, 0.5], ["triangle", 5, 0.22]] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(level, t0 + attack);
        g.gain.setValueAtTime(level, Math.max(t0 + attack, t1 - 0.05));
        g.gain.linearRampToValueAtTime(0, t1 + release);
        osc.connect(g).connect(bus);
        osc.start(t0);
        osc.stop(t1 + release + 0.1);
      }
    }
  });
  // Music-box notes: a soft sine with a bright second partial, decaying, through a little echo.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = 0.31;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.34;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 2400;
  echo.connect(echoTone).connect(feedback).connect(echo);
  const pluckBus = ctx.createGain();
  pluckBus.gain.value = music.padGain * 1.5;
  pluckBus.connect(out);
  pluckBus.connect(echo);
  echoTone.connect(out);
  for (const p of music.plucks) {
    for (const [mult, level, decay] of [[1, 0.6, 1.3], [2, 0.16, 0.6], [3.01, 0.05, 0.3]] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = p.f * mult;
      const g = ctx.createGain();
      const peak = level * (p.g ?? 1);
      g.gain.setValueAtTime(0, p.t);
      g.gain.linearRampToValueAtTime(peak, p.t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, p.t + decay);
      osc.connect(g).connect(pluckBus);
      osc.start(p.t);
      osc.stop(p.t + decay + 0.05);
    }
  }
}

function encode(channels: Float32Array[]): string {
  // Interleave to 32-bit float and hand back as base64, in chunks the string builder can take.
  const n = channels[0]!.length;
  const inter = new Float32Array(n * channels.length);
  for (let c = 0; c < channels.length; c++) for (let i = 0; i < n; i++) inter[i * channels.length + c] = channels[c]![i]!;
  const bytes = new Uint8Array(inter.buffer);
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

async function mixAudio(spec: MixSpec): Promise<{ base64: string; frames: number; report: string[] }> {
  const report: string[] = [];
  // Deterministic take and variation choices.
  const rand = mulberry(spec.seed);
  Math.random = rand;
  const sr = spec.sampleRate;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(spec.total * sr), sampleRate: sr });
  const master = ctx.createGain();
  master.connect(ctx.destination);
  // The engine plays into `master` (its "destination"), so the bed can sit beside it.
  const proxy = new Proxy(ctx, {
    get(target, key) {
      if (key === "destination") return master;
      const value = (target as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    set(target, key, value) {
      (target as unknown as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  }) as unknown as AudioContext;
  const engine = new WebAudioEngine(proxy, { muted: false, volume: 1, seed: 1 });
  ctx.onstatechange = null;
  for (const pack of ["core", "western", "night", "orbit", "ridge"] as const) {
    const t0 = performance.now();
    await engine.load(pack);
    report.push(`${pack}: ${(performance.now() - t0).toFixed(0)} ms`);
  }

  // Every call, on the video's timeline, grouped by render quantum.
  const quantum = 128 / sr;
  interface Call {
    t: number;
    run(): void;
  }
  const calls: Call[] = [];
  const stops = new Map<string, () => void>();
  let played = 0;
  for (const seg of spec.segments) {
    const end = seg.dur - spec.fade;
    const events = seg.events.filter((e) => e.type === "play" || e.type === "loop" || e.type === "stop");
    const stopAt = new Map<number, number>();
    for (const e of events) if (e.type === "stop" && e.id !== undefined) stopAt.set(e.id, e.t);
    for (const e of events) {
      if (e.type === "stop") {
        if (e.t > 0 && e.t < end) {
          const key = `${seg.id}:${e.id}`;
          calls.push({ t: seg.start + e.t, run: () => stops.get(key)?.() });
        }
        continue;
      }
      if (e.type === "loop") {
        const stopT = stopAt.get(e.id ?? -1);
        // Loops begun before the segment (or that never stop) run from its start, and fade out before its end.
        if (stopT !== undefined && stopT <= 0) continue;
        const begin = Math.max(0, e.t);
        if (begin >= end) continue;
        const key = `${seg.id}:${e.id}`;
        calls.push({ t: seg.start + begin, run: () => stops.set(key, engine.loop(e.cue!, e.options as never)) });
        const off = stopT !== undefined ? Math.min(stopT, end) : end;
        calls.push({ t: seg.start + off, run: () => stops.get(key)?.() });
        continue;
      }
      if (e.t < 0 || e.t >= seg.dur - 0.05) continue;
      played++;
      calls.push({ t: seg.start + e.t, run: () => engine.play(e.cue!, e.options as never) });
    }
  }
  for (const x of spec.extras) calls.push({ t: x.t, run: () => engine.play(x.cue, x.options as never) });
  report.push(`${calls.length} calls, ${played} sounds from the games`);

  calls.sort((a, b) => a.t - b.t);
  // Anything within the first quantum runs before rendering starts.
  const groups = new Map<number, Call[]>();
  for (const call of calls) {
    const q = Math.ceil(call.t / quantum - 1e-9) * quantum;
    if (q <= 0 || q >= spec.total) {
      if (q <= 0) call.run();
      continue;
    }
    const key = Math.round(q * sr);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(call);
  }
  const waits: Promise<void>[] = [];
  for (const [frame, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    waits.push(
      ctx.suspend(frame / sr).then(() => {
        for (const call of group) call.run();
        void ctx.resume();
      }),
    );
  }

  bed(ctx, master, spec.music, spec.total);
  const buffer = await ctx.startRendering();
  await Promise.all(waits);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]!));
  report.push(`peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
  // (The engine is not disposed: an offline context cannot be closed.)
  return { base64: encode(channels), frames: buffer.length, report };
}

(window as unknown as { mixAudio: typeof mixAudio; ready: boolean }).mixAudio = mixAudio;
(window as unknown as { ready: boolean }).ready = true;
