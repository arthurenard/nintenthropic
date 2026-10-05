/**
 * Turns a piece into audio: the score is played by the band, mixed with its
 * effects, folded into a seamless loop and set to the music's loudness. Pure
 * DSP on Float32Arrays (no Web Audio), so it runs in a Worker, on the main
 * thread in slices, and in Node under Vitest.
 *
 * The work is cut into *stages* (one per part, then the effects, then the
 * master), so the caller can run them all at once in a Worker or one at a
 * time between frames on the main thread, never holding a frame longer than
 * one part's worth of synthesis.
 *
 * Repeated notes are rendered once and reused: a bar of a groove played
 * thirty times costs one bar of synthesis. A few variants per note are kept
 * so repeated hi-hats do not machine-gun.
 */
import { Rng, hashSeed } from "../../../audio/dsp/rng";
import { biquad } from "../../../audio/dsp/filters";
import { type DrumKind, type Voice, drumHit } from "../../../audio/dsp/voices";
import { chorus, fold, panGains, peakOf, pingPong, removeMean, reverb, softLimit, stereoRms } from "./fx";
import { INSTRUMENTS, isInstrument } from "./instruments";
import { type CompileOptions, type PieceSpec, type Score, type ScoreBar, compile } from "./score";
import { midiToHz } from "./theory";

/** The music's loudness over the whole loop, dBFS RMS (both channels). */
export const MUSIC_RMS_DB = -18;
/** No sample of a rendered piece is louder than this, dBFS. */
export const MUSIC_PEAK_DB = -1;
/** The rate music is rendered at; Web Audio resamples it to the device on playback. */
export const MUSIC_SAMPLE_RATE = 32000;

export interface MusicRenderOptions extends CompileOptions {
  sampleRate?: number;
  /** Seed for the voices' randomness; the same seed renders the same samples. */
  seed?: number;
}

export interface RenderedMusic {
  id: string;
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  /** The loop's length in samples (left.length). */
  loopSamples: number;
  /** Seconds. */
  duration: number;
  /** Where the bars fall, seconds from the start of the loop. */
  bars: ScoreBar[];
  tempoScale: number;
  transpose: number;
  stats: RenderStats;
}

export interface RenderStats {
  rmsDb: number;
  peakDb: number;
  /** Wall-clock time spent in the stages, milliseconds. */
  renderMs: number;
  /** Each part's loudness relative to the whole mix, dB (before the master gain: the balance). */
  parts: Record<string, number>;
  warnings: string[];
}

/** Parts are balanced against this: a part at level 0 has an active RMS of this many dBFS before the master. */
const REFERENCE_DB = -20;

/** Where each drum sits in the stereo field. */
const DRUM_PAN: Partial<Record<DrumKind, number>> = {
  kick: 0, "kick-soft": 0, "kick-808": 0, snare: 0.05, "snare-brush": 0.1, "snare-electro": 0, clap: -0.08, rim: 0.2,
  hat: 0.25, "hat-open": 0.28, ride: 0.35, crash: -0.3, shaker: -0.3, tambourine: 0.3,
  "tom-low": -0.3, "tom-mid": 0, "tom-high": 0.3, "conga-low": -0.25, "conga-high": 0.2, bongo: 0.35,
  clave: -0.35, cowbell: 0.3, woodblock: -0.4, sleigh: 0.3, timpani: 0,
};

/** How many variants of each distinct note are rendered before they are reused. */
const VARIANTS = 3;

interface Mix {
  /** Dry stereo bus, loop + tail long. */
  dryL: Float32Array;
  dryR: Float32Array;
  /** Mono sends. */
  revSend: Float32Array;
  delSend: Float32Array;
  /** Scratch stereo pair for one part. */
  partL: Float32Array;
  partR: Float32Array;
}

export class PieceRenderer {
  readonly score: Score;
  readonly sr: number;
  private readonly spec: PieceSpec;
  private readonly rng: Rng;
  private readonly loopSamples: number;
  private readonly total: number;
  private readonly tailSeconds: number;
  private mix: Mix | null = null;
  private result: RenderedMusic | null = null;
  private ms = 0;
  private readonly partLevels: Record<string, number> = {};
  private readonly cache = new Map<string, Float32Array[]>();
  private readonly counters = new Map<string, number>();

  constructor(spec: PieceSpec, private readonly options: MusicRenderOptions = {}) {
    this.spec = spec;
    this.sr = options.sampleRate ?? MUSIC_SAMPLE_RATE;
    this.score = compile(spec, options);
    this.rng = new Rng(hashSeed("music", spec.id, options.seed ?? 1, options.transpose ?? 0));
    this.loopSamples = Math.round(this.score.duration * this.sr);
    this.tailSeconds = Math.max(3, spec.fx.reverb.t60 + 1.5);
    this.total = this.loopSamples + Math.round(this.tailSeconds * this.sr);
  }

  /** The stages, in order. Run them all (``run``) or one by one. */
  stages(): (() => void)[] {
    const parts = Object.keys(this.spec.rack).filter(
      (name) => this.score.notes.some((n) => n.part === name) || this.score.hits.some((h) => h.part === name),
    );
    const stages: (() => void)[] = [() => this.allocate()];
    for (const name of parts) stages.push(() => this.renderPart(name));
    stages.push(() => this.effects());
    stages.push(() => this.master());
    return stages;
  }

  /** Render everything now and return it. */
  run(): RenderedMusic {
    for (const stage of this.stages()) stage();
    return this.finished();
  }

  finished(): RenderedMusic {
    if (!this.result) throw new Error("the piece has not been rendered yet");
    return this.result;
  }

  private timed(fn: () => void): void {
    const t0 = now();
    fn();
    this.ms += now() - t0;
  }

  private allocate(): void {
    this.timed(() => {
      const n = this.total;
      this.mix = {
        dryL: new Float32Array(n),
        dryR: new Float32Array(n),
        revSend: new Float32Array(n),
        delSend: new Float32Array(n),
        partL: new Float32Array(n),
        partR: new Float32Array(n),
      };
    });
  }

  /** A note's audio from the cache, or rendered the first few times it is asked for. */
  private voiceFor(inst: string, key: string, make: () => Float32Array): Float32Array {
    const k = `${inst}|${key}`;
    const list = this.cache.get(k) ?? [];
    const count = this.counters.get(k) ?? 0;
    this.counters.set(k, count + 1);
    if (list.length < VARIANTS) {
      const fresh = make();
      list.push(fresh);
      this.cache.set(k, list);
      return fresh;
    }
    return list[count % VARIANTS]!;
  }

  private renderPart(name: string): void {
    this.timed(() => {
      const mix = this.mix!;
      const rack = this.spec.rack[name]!;
      const { partL, partR } = mix;
      partL.fill(0);
      partR.fill(0);
      const sr = this.sr;
      const [gl, gr] = panGains(rack.pan ?? 0);
      const isDrums = rack.inst === "drums";
      if (isDrums) {
        for (const hit of this.score.hits) {
          if (hit.part !== name) continue;
          const vel = Math.round(hit.vel * 8) / 8;
          const buf = this.voiceFor("drums", `${hit.kind}|${vel}`, () => drumHit(hit.kind, sr, this.rng.fork(`${hit.kind}${this.counters.size}`), vel));
          const [dl, dr] = panGains(DRUM_PAN[hit.kind] ?? 0);
          addAt(partL, buf, Math.round(hit.time * sr), dl);
          addAt(partR, buf, Math.round(hit.time * sr), dr);
        }
      } else {
        if (!isInstrument(rack.inst)) throw new Error(`${this.spec.id}: no instrument "${rack.inst}"`);
        const voice: Voice = INSTRUMENTS[rack.inst];
        for (const note of this.score.notes) {
          if (note.part !== name) continue;
          const vel = Math.round(note.vel * 8) / 8;
          const hold = Math.round(note.dur * 50) / 50;
          const buf = this.voiceFor(rack.inst, `${note.midi}|${hold}|${vel}`, () =>
            voice({ sr, freq: midiToHz(note.midi), hold: Math.max(0.03, hold), vel, rng: this.rng.fork(`${note.midi}${this.counters.size}`) }),
          );
          const at = Math.round(note.time * sr);
          addAt(partL, buf, at, gl);
          addAt(partR, buf, at, gr);
        }
      }
      if (rack.lowpass) {
        biquad(partL, sr, "lowpass", rack.lowpass, 0.707);
        biquad(partR, sr, "lowpass", rack.lowpass, 0.707);
      }
      if (rack.chorus) chorus(partL, partR, sr, rack.chorus);

      // Balance by loudness, not by whatever level an instrument happens to
      // synthesise at: the part is set so its *active* RMS (the stretches where
      // it plays) sits at the rack's level below the reference.
      const active = activeRms(partL, partR, sr);
      const gain = active > 1e-9 ? Math.pow(10, (REFERENCE_DB + rack.level) / 20) / active : 0;
      const { dryL, dryR, revSend, delSend } = mix;
      const rev = (rack.reverb ?? 0) * gain;
      const del = (rack.delay ?? 0) * gain;
      let sum = 0;
      for (let i = 0; i < partL.length; i++) {
        const l = partL[i]!;
        const r = partR[i]!;
        dryL[i]! += gain * l;
        dryR[i]! += gain * r;
        const m = 0.5 * (l + r);
        if (rev > 0) revSend[i]! += rev * m;
        if (del > 0) delSend[i]! += del * m;
        if (i < this.loopSamples) sum += gain * gain * (l * l + r * r);
      }
      this.partLevels[name] = sum / (2 * this.loopSamples);
    });
  }

  private effects(): void {
    this.timed(() => {
      const mix = this.mix!;
      const { dryL, dryR, revSend, delSend } = mix;
      const fx = this.spec.fx;
      const sr = this.sr;
      const n = this.total;
      if (revSend.some((v) => v !== 0)) {
        const [l, r] = reverb(revSend, sr, this.rng.fork("reverb"), fx.reverb.t60, fx.reverb.size, 0.5);
        const k = fx.reverb.mix;
        for (let i = 0; i < Math.min(n, l.length); i++) {
          dryL[i]! += k * l[i]!;
          dryR[i]! += k * r[i]!;
        }
        // The reverb's own tail runs past the buffer; fold it back at the end.
        this.extraL = l.length > n ? l.subarray(n) : null;
        this.extraR = r.length > n ? r.subarray(n) : null;
        this.extraGain = k;
      }
      if (fx.delay && delSend.some((v) => v !== 0)) {
        // The echo is timed to the tempo of the piece's first bar.
        const beat = 60 / this.score.bars[0]!.bpm;
        const [l, r] = pingPong(delSend, sr, fx.delay.beats * beat * sr, fx.delay.feedback, fx.delay.tone);
        for (let i = 0; i < n; i++) {
          dryL[i]! += fx.delay.mix * l[i]!;
          dryR[i]! += fx.delay.mix * r[i]!;
        }
      }
    });
  }

  private extraL: Float32Array | null = null;
  private extraR: Float32Array | null = null;
  private extraGain = 0;

  private master(): void {
    this.timed(() => {
      const mix = this.mix!;
      const N = this.loopSamples;
      const left = fold(mix.dryL, N);
      const right = fold(mix.dryR, N);
      if (this.extraL && this.extraR) {
        for (let i = 0; i < this.extraL.length; i++) {
          left[(this.total + i) % N]! += this.extraGain * this.extraL[i]!;
          right[(this.total + i) % N]! += this.extraGain * this.extraR[i]!;
        }
      }
      removeMean(left);
      removeMean(right);
      // To the music's loudness, then limit the peaks and, since limiting
      // lowers the loudness a little, once more.
      const ceiling = Math.pow(10, MUSIC_PEAK_DB / 20);
      for (let pass = 0; pass < 3; pass++) {
        const rms = stereoRms(left, right);
        const gain = rms > 0 ? Math.pow(10, MUSIC_RMS_DB / 20) / rms : 1;
        for (let i = 0; i < N; i++) {
          left[i]! *= gain;
          right[i]! *= gain;
        }
        if (pass === 0) {
          for (const k of Object.keys(this.partLevels)) this.partLevels[k] = this.partLevels[k]! * gain * gain;
        }
        if (peakOf(left, right) <= ceiling) break;
        softLimit(left, ceiling * 0.75, ceiling * 0.995);
        softLimit(right, ceiling * 0.75, ceiling * 0.995);
      }
      const rmsDb = 20 * Math.log10(stereoRms(left, right));
      const peakDb = 20 * Math.log10(peakOf(left, right));
      const parts: Record<string, number> = {};
      for (const [k, v] of Object.entries(this.partLevels)) parts[k] = 10 * Math.log10(Math.max(v, 1e-12)) - rmsDb;
      this.mix = null;
      this.cache.clear();
      this.result = {
        id: this.spec.id,
        sampleRate: this.sr,
        left,
        right,
        loopSamples: N,
        duration: this.score.duration,
        bars: this.score.bars,
        tempoScale: this.score.tempoScale,
        transpose: this.score.transpose,
        stats: { rmsDb, peakDb, renderMs: this.ms, parts, warnings: this.score.warnings },
      };
    });
  }
}

/**
 * The RMS of a part over the stretches where it plays: 100 ms blocks that are
 * within 30 dB of its loudest, averaged in power, so a part that only enters
 * in the second half is not judged quiet for the silence before.
 */
export function activeRms(left: Float32Array, right: Float32Array, sr: number): number {
  const block = Math.max(1, Math.round(0.1 * sr));
  const powers: number[] = [];
  for (let s = 0; s < left.length; s += block) {
    let p = 0;
    const end = Math.min(left.length, s + block);
    for (let i = s; i < end; i++) p += left[i]! * left[i]! + right[i]! * right[i]!;
    powers.push(p / (2 * (end - s)));
  }
  const max = Math.max(...powers);
  if (max <= 0) return 0;
  let sum = 0;
  let count = 0;
  for (const p of powers) {
    if (p > max * 1e-3) {
      sum += p;
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

/** Mix ``src`` into ``dst`` at sample ``at`` with a gain, clipped to fit. */
function addAt(dst: Float32Array, src: Float32Array, at: number, gain: number): void {
  if (gain === 0) return;
  const end = Math.min(src.length, dst.length - at);
  for (let i = at < 0 ? -at : 0; i < end; i++) dst[at + i]! += gain * src[i]!;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Render a piece in one go. */
export function renderPiece(spec: PieceSpec, options: MusicRenderOptions = {}): RenderedMusic {
  return new PieceRenderer(spec, options).run();
}
