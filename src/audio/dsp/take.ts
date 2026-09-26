/**
 * One take of one sound: its random source and the handful of dimensions it
 * varies along. A recipe asks the take for every number it would otherwise
 * hard-code — ``t.p`` for pitch, ``t.d(0.03)`` for a decay, ``t.g(0.8)`` for a
 * layer's level — so each take of the same recipe differs in pitch, noise,
 * decay, balance and timing all at once, subtly, the way two real gunshots
 * from the same gun differ.
 */
import { Rng } from "./rng";
import { type Mono, place, samples } from "./signal";

export class Take {
  readonly rng: Rng;
  /** Pitch multiplier for the whole take (within ± ~0.7 semitone). */
  readonly p: number;
  /** Decay-time multiplier (±12 %). */
  readonly decay: number;
  /** Duration multiplier (±10 %). */
  readonly length: number;
  /** Filter-cutoff multiplier (±18 %): one take darker, the next brighter. */
  readonly cutoff: number;

  constructor(
    readonly sr: number,
    seed: number,
    readonly index: number,
  ) {
    this.rng = new Rng(seed);
    const r = this.rng;
    // Take 0 is the "straight" one; the others wander from it.
    const spread = index === 0 ? 0.35 : 1;
    this.p = Math.pow(2, (spread * r.range(-0.7, 0.7)) / 12);
    this.decay = 1 + spread * r.range(-0.12, 0.12);
    this.length = 1 + spread * r.range(-0.1, 0.1);
    this.cutoff = 1 + spread * r.range(-0.18, 0.18);
  }

  /** Seconds → samples at this take's rate. */
  n(seconds: number): number {
    return samples(this.sr, seconds);
  }

  /** A silent canvas ``seconds`` long. */
  canvas(seconds: number): Mono {
    return new Float32Array(this.n(seconds));
  }

  /** A decay time scaled by the take. */
  d(seconds: number): number {
    return seconds * this.decay;
  }

  /** A duration scaled by the take. */
  L(seconds: number): number {
    return seconds * this.length;
  }

  /** A cutoff scaled by the take. */
  c(hz: number): number {
    return hz * this.cutoff;
  }

  /** A layer level, re-balanced by up to ±``spreadDb``. */
  g(base = 1, spreadDb = 2): number {
    return base * Math.pow(10, this.rng.range(-spreadDb, spreadDb) / 20);
  }

  /** A timing (or any value) jittered by ±``spread`` of itself. */
  j(x: number, spread = 0.1): number {
    return this.rng.vary(x, spread);
  }

  /** Add ``layer`` into ``out`` at ``at`` seconds. */
  put(out: Mono, layer: Mono, at: number, gain = 1): void {
    place(out, layer, at, this.sr, gain);
  }
}

/** A recipe draws one take: mono, or [left, right] where width matters. */
export type Recipe = (t: Take) => Mono | Mono[];
