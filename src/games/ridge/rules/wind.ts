/**
 * The wind down the valley: a steady breeze along it (signed: + blows to
 * the right, along +X), and gusts that swell it and lulls that ease it, so
 * a patient shooter can wait for the wind to drop. Each stage brings a new
 * wind, eased in over a couple of seconds so the readout shows it coming.
 * Seeded: a round's wind replays exactly.
 */
import { range, type Random } from "../../../engine/rules/rng";

export interface WindSpec {
  /** The breeze, m/s, signed (+ blows to the right). */
  base: number;
  /** How much gusts swell it and lulls ease it, as a fraction of the breeze (0 still, 1 wild). */
  gust: number;
}

/** A smooth wander in [−1, 1]: a few slow sines at unrelated rates, their phases seeded. */
class Gusts {
  private readonly parts: { f: number; a: number; ph: number }[];
  private readonly norm: number;

  constructor(random: Random) {
    // Periods of about 5 to 25 seconds: a gust builds and passes in the time of a breath or two.
    this.parts = [0.041, 0.083, 0.137, 0.211].map((f, i) => ({
      f: f * range(random, 0.85, 1.15),
      a: 1 / (1 + i * 0.6),
      ph: random() * Math.PI * 2,
    }));
    this.norm = this.parts.reduce((s, p) => s + p.a, 0);
  }

  at(t: number): number {
    let v = 0;
    for (const p of this.parts) v += p.a * Math.sin(2 * Math.PI * p.f * t + p.ph);
    return v / this.norm;
  }
}

export class Wind {
  private gusts: Gusts;
  private from: WindSpec = { base: 0, gust: 0 };
  private to: WindSpec = { base: 0, gust: 0 };
  /** 0 → 1 as a new wind comes in. */
  private blend = 1;
  private time = 0;
  /** The wind now, m/s, signed. */
  speed = 0;

  constructor(
    private readonly random: Random,
    /** The strongest it may blow, m/s (Relaxed keeps it gentle). */
    private readonly max: number,
  ) {
    this.gusts = new Gusts(random);
  }

  /** The wind as it is set now (the one blowing in, if one is). */
  get spec(): Readonly<WindSpec> {
    return this.to;
  }

  /** A new wind, eased in over `seconds` (0: at once). */
  set(spec: WindSpec, seconds = 2.5): void {
    this.from = { base: this.current(), gust: this.to.gust };
    this.to = { base: Math.max(-this.max, Math.min(this.max, spec.base)), gust: Math.max(0, Math.min(1, spec.gust)) };
    this.blend = seconds > 0 ? 0 : 1;
    this.fade = Math.max(1e-3, seconds);
    this.gusts = new Gusts(this.random);
    this.update(0);
  }

  private fade = 2.5;

  /** The breeze without its gusts, as blended now. */
  private current(): number {
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    return this.from.base + (this.to.base - this.from.base) * e;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.fade);
    const base = this.current();
    const gust = this.to.gust * this.gusts.at(this.time);
    // A gust swells the breeze; a lull eases it, but never turns it round.
    const shaped = gust >= 0 ? gust : gust * 0.7;
    const v = base * (1 + shaped);
    this.speed = Math.max(-this.max, Math.min(this.max, v));
  }
}

/**
 * A stage's wind: stronger and gustier as the stages go on, from a light
 * breeze on the first to a strong wind for the officer at 900 m, and a new
 * direction each time.
 */
export function stageWind(stage: number, random: Random): WindSpec {
  // [slowest, strongest, gustiness] for each of the five jobs, first time round.
  const table: readonly [number, number, number][] = [
    [1, 2.5, 0.25],
    [2, 3.5, 0.3],
    [2, 4, 0.35],
    [3, 5, 0.4],
    [5, 7, 0.35],
  ];
  const s = Math.max(1, Math.floor(stage));
  const row = table[(s - 1) % table.length]!;
  // Each time the jobs come round again the wind is stronger and gustier.
  const round = Math.floor((s - 1) / table.length);
  const lo = Math.min(7, row[0] + round * 1.2);
  const hi = Math.min(8, row[1] + round * 1.2);
  const gust = Math.min(0.7, row[2] + round * 0.12);
  const speed = range(random, lo, hi);
  const sign = random() < 0.5 ? -1 : 1;
  return { base: sign * speed, gust };
}
