/**
 * Renders the games' own sounds for the trailer, offline: an OfflineAudioContext
 * runs the real engine (src/audio/engine.ts, every cue synthesised by
 * src/audio/cues/ - Finger Guns' four games and Grip Prix's kart pack alike) and
 * plays each event of a list at its trailer time. Nothing here ever reaches a
 * speaker. mix.mjs drives this page in a muted headless Chrome and mixes the
 * result with the music.
 *
 * Events are the shape the clip tools write (events.json), already shifted to
 * trailer time:
 *   { t, type: "play",   cue, options? }
 *   { t, type: "loop",   cue, options?, id? }       a loop that runs until its "stop"
 *   { t, type: "stop",   id }
 *   { t, type: "set",    id, options, glide? }       steers the loop `id` (rate, volume, pan, distance): Grip Prix's engines
 *   { t, type: "filter", name: "slowmo" | "hurt", amount }
 * Loop ids are paired with the nearest earlier open loop of the same id (and the same
 * `clip`, when given), so lists from several clips may be concatenated.
 */
import { CUES, type Pack } from "../../../src/audio/cues/table";
import { WebAudioEngine } from "../../../src/audio/engine";

export interface GameEvent {
  t: number;
  type: "play" | "loop" | "stop" | "set" | "filter" | string;
  cue?: string;
  options?: Record<string, unknown>;
  id?: number | string;
  clip?: string;
  glide?: number;
  name?: string;
  amount?: number;
}

export interface RenderSpec {
  sampleRate: number;
  total: number;
  seed: number;
  /** Fade out of loops that never stop, s, before `total`. */
  loopFade: number;
  /** Also honour "hurt" filters (they start a heartbeat on a wall-clock timer, which does not suit offline rendering). */
  hurt: boolean;
  events: GameEvent[];
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

function encode(channels: Float32Array[]): string {
  // Interleaved 32-bit float, as base64, built in chunks the string builder can take.
  const n = channels[0]!.length;
  const inter = new Float32Array(n * channels.length);
  for (let c = 0; c < channels.length; c++) for (let i = 0; i < n; i++) inter[i * channels.length + c] = channels[c]![i]!;
  const bytes = new Uint8Array(inter.buffer);
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

interface Call {
  t: number;
  /** `late`: seconds from the render quantum the call runs at to its true time, for the sample-accurate `delay` option. */
  run(late: number): void;
}

/** Cue options with a start delay added (the engine schedules `delay` seconds after the call, to the sample). */
const delayed = (options: Record<string, unknown> | undefined, late: number): never => ({ ...(options ?? {}), delay: Number(options?.delay ?? 0) + late }) as never;

async function renderGame(spec: RenderSpec): Promise<{ base64: string; frames: number; report: Record<string, unknown> }> {
  Math.random = mulberry(spec.seed);
  const sr = spec.sampleRate;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(spec.total * sr), sampleRate: sr });
  const engine = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, volume: 1, seed: 1 });
  ctx.onstatechange = null;

  // Which cues, and which packs they need.
  const unknown = new Set<string>();
  const packs = new Set<Pack>(["core"]);
  const cueCounts: Record<string, number> = {};
  const has = (cue: string | undefined): cue is string => !!cue && Object.prototype.hasOwnProperty.call(CUES, cue);
  for (const e of spec.events) {
    if (e.type !== "play" && e.type !== "loop") continue;
    if (!has(e.cue)) {
      if (e.cue) unknown.add(e.cue);
      continue;
    }
    packs.add(CUES[e.cue]!.pack);
    cueCounts[e.cue] = (cueCounts[e.cue] ?? 0) + 1;
  }
  if (spec.events.some((e) => e.type === "filter" && e.name === "slowmo")) packs.add(CUES["slowmo_boom"]!.pack);
  const loadMs: Record<string, number> = {};
  for (const pack of packs) {
    const t0 = performance.now();
    await engine.load(pack);
    loadMs[pack] = Math.round(performance.now() - t0);
  }

  // Pair loops with their stops and their steering, in time order.
  const events = spec.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
  interface LoopRec {
    start: GameEvent;
    stopAt: number | null;
    sets: GameEvent[];
  }
  const open = new Map<string, LoopRec[]>();
  const loops: LoopRec[] = [];
  const keyOf = (e: GameEvent): string => `${e.clip ?? ""}\u0000${String(e.id ?? "")}`;
  let stops = 0;
  for (const e of events) {
    if (e.type === "loop" && has(e.cue)) {
      const rec: LoopRec = { start: e, stopAt: null, sets: [] };
      loops.push(rec);
      const k = keyOf(e);
      (open.get(k) ?? open.set(k, []).get(k)!).push(rec);
    } else if (e.type === "stop") {
      const stack = open.get(keyOf(e));
      const rec = stack?.pop();
      if (rec) {
        rec.stopAt = e.t;
        stops++;
      }
    } else if (e.type === "set") {
      const stack = open.get(keyOf(e));
      stack?.[stack.length - 1]?.sets.push(e);
    }
  }

  const quantum = 128 / sr;
  const calls: Call[] = [];
  const end = spec.total - spec.loopFade;
  let played = 0;
  let looped = 0;
  for (const e of events) {
    if (e.type === "play" && has(e.cue)) {
      if (e.t < 0 || e.t >= spec.total - 0.05) continue;
      played++;
      calls.push({ t: e.t, run: (late) => engine.play(e.cue!, delayed(e.options, late)) });
    } else if (e.type === "filter" && (e.name === "slowmo" || (e.name === "hurt" && spec.hurt))) {
      calls.push({ t: Math.max(0, e.t), run: () => engine.setFilter(e.name as "slowmo" | "hurt", e.amount ?? 0) });
    }
  }
  for (const rec of loops) {
    const begin = Math.max(0, rec.start.t);
    const off = rec.stopAt === null ? end : Math.min(rec.stopAt, end);
    if (begin >= off) continue;
    looped++;
    const cue = rec.start.cue!;
    let stop: (() => void) | null = null;
    if (rec.sets.length) {
      let control: ReturnType<WebAudioEngine["controlledLoop"]> | null = null;
      calls.push({ t: begin, run: (late) => { control = engine.controlledLoop(cue, delayed(rec.start.options, late)); stop = () => control?.stop(); } });
      for (const s of rec.sets) calls.push({ t: Math.max(begin, s.t), run: () => control?.set((s.options ?? {}) as never, s.glide) });
    } else {
      calls.push({ t: begin, run: (late) => { stop = engine.loop(cue, delayed(rec.start.options, late)); } });
    }
    calls.push({ t: off, run: () => stop?.() });
  }
  calls.sort((a, b) => a.t - b.t);

  // Everything is run at the render quantum at or just before its time (the context is suspended there)
  // and starts `late` seconds after it: sample-accurate, not rounded to a quantum of 2.7 ms.
  const groups = new Map<number, Call[]>();
  for (const call of calls) {
    const q = Math.floor(call.t / quantum + 1e-9) * quantum;
    if (q <= 0) {
      call.run(Math.max(0, call.t));
      continue;
    }
    if (call.t >= spec.total) continue;
    const key = Math.round(q * sr);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(call);
  }
  const waits: Promise<void>[] = [];
  for (const [frame, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    const at = frame / sr;
    waits.push(
      ctx.suspend(at).then(() => {
        for (const call of group) call.run(Math.max(0, call.t - at));
        void ctx.resume();
      }),
    );
  }

  const t0 = performance.now();
  const buffer = await ctx.startRendering();
  await Promise.all(waits);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]!));
  const report = {
    events: spec.events.length,
    played,
    loops: looped,
    stops,
    unknownCues: [...unknown],
    cues: cueCounts,
    packs: loadMs,
    renderMs: Math.round(performance.now() - t0),
    peakDbfs: +(20 * Math.log10(Math.max(1e-9, peak))).toFixed(2),
  };
  // (The engine is not disposed: an offline context cannot be closed.)
  return { base64: encode(channels), frames: buffer.length, report };
}

(window as unknown as { renderGame: typeof renderGame; ready: boolean }).renderGame = renderGame;
(window as unknown as { ready: boolean }).ready = true;
