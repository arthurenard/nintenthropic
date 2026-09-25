/**
 * A small seedable random source.
 *
 * Every sound is drawn from one of these so the whole library is
 * reproducible: the same seed, cue and take always give the same samples,
 * which is what lets the tests compare renders and lets a designer say
 * "take 2 of the ricochet" and mean one exact waveform.
 */

/** FNV-1a over the parts' text, then a final avalanche so near names diverge. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = `${part}|`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * sfc32: four 32-bit words of state, fast in any JS engine, and with none of
 * the short cycles of a bare xorshift. Seeded through splitmix32 so that
 * seeds 1, 2, 3 do not start from similar states.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next() | 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** An integer in [lo, hi). */
  int(lo: number, hi: number): number {
    return lo + Math.floor((hi - lo) * this.next());
  }

  /** Standard normal (Box-Muller, the second value kept for the next call). */
  gauss(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** ``x`` moved by up to ±``spread`` of itself. */
  vary(x: number, spread = 0.1): number {
    return x * (1 + spread * (2 * this.next() - 1));
  }

  /** An independent stream, so one layer's draws do not shift another's. */
  fork(label: string | number): Rng {
    return new Rng(hashSeed(this.a, this.b, this.c, this.d, label));
  }

  /** Fill ``out`` with uniform white noise in [-1, 1). */
  fill(out: Float32Array): Float32Array {
    for (let i = 0; i < out.length; i++) out[i] = 2 * this.next() - 1;
    return out;
  }
}
