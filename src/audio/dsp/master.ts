/**
 * The mastering chain every take goes through, and the loop maker.
 *
 * Every finished take is normalised so that its loudest moment (the highest
 * RMS over any 50 ms) sits at one target, so the mix is decided in one place
 * — the cue table's ``level`` — and not by whatever gain a recipe happened to
 * end on. The loudest moment rather than an average, because that is how
 * the ear judges a gunshot: by its blast, not by how long its tail lingers.
 * A soft-knee limiter then guarantees the peak ceiling without the hard
 * edge of clipping.
 */
import { type Channels, type Mono, samples } from "./signal";

/** Where every take's loudest 50 ms is normalised to, dBFS RMS. */
export const TARGET_LOUDNESS_DB = -13;
/** Where the limiter starts bending the signal over. */
export const LIMITER_KNEE = 0.8;
/** The limiter's asymptote: no finished sample reaches it. */
export const LIMITER_CEILING = 0.98;

/**
 * A gated RMS in dBFS: 100 ms blocks every 25 ms; blocks under −60 dBFS are
 * ignored (silence, pre-delay), then blocks more than 10 dB under the mean,
 * so a long quiet tail does not drag a sharp sound's loudness down.
 */
export function loudnessDb(channels: Channels, sr: number): number {
  const n = channels[0]!.length;
  const size = Math.min(n, samples(sr, 0.1));
  const hop = samples(sr, 0.025);
  // Running sum of squares, so every block is O(1).
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const ch of channels) s += ch[i]! * ch[i]!;
    cum[i + 1] = cum[i]! + s / channels.length;
  }
  const powers: number[] = [];
  for (let start = 0; start + size <= n; start += hop) {
    const p = (cum[start + size]! - cum[start]!) / size;
    if (p > 1e-6) powers.push(p);
  }
  if (powers.length === 0) return -Infinity;
  const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
  const kept = powers.filter((p) => p > mean * 0.1);
  const m = kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length);
  return 10 * Math.log10(m);
}

/** The highest RMS over any ``window`` seconds (hop 5 ms), in dBFS: a sound's loudest moment. */
export function momentaryMaxDb(channels: Channels, sr: number, window = 0.05): number {
  const n = channels[0]!.length;
  const size = Math.min(n, samples(sr, window));
  const hop = samples(sr, 0.005);
  // Power per sample (averaged over channels), then a running window sum.
  const power = new Float64Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) power[i]! += (ch[i]! * ch[i]!) / channels.length;
  let acc = 0;
  for (let i = 0; i < size; i++) acc += power[i]!;
  let best = acc;
  for (let start = 1; start + size <= n; start++) {
    acc += power[start + size - 1]! - power[start - 1]!;
    if (start % hop === 0 && acc > best) best = acc;
  }
  const p = Math.max(best, 0) / size;
  return p > 1e-12 ? 10 * Math.log10(p) : -Infinity;
}

/** Linear below the knee, then a tanh bend that never reaches the ceiling. */
export function softLimitSample(x: number, knee = LIMITER_KNEE, ceiling = LIMITER_CEILING): number {
  const m = Math.abs(x);
  if (m <= knee) return x;
  const bent = knee + (ceiling - knee) * Math.tanh((m - knee) / (ceiling - knee));
  return x < 0 ? -bent : bent;
}

export interface FinishOptions {
  /** dB relative to the common loudness target (a recipe that must sit quieter or louder in itself). */
  trim?: number;
  /** Loops: no fades, no tail trimming, no filters with memory (they would break the seam). */
  loop?: boolean;
}

/**
 * De-DC, trim the inaudible end of the tail, fade the very edges, normalise
 * the loudness and limit. Returns new arrays of the (possibly shorter) length.
 */
export function finish(channels: Channels, sr: number, o: FinishOptions = {}): Channels {
  // Recipes hand over buffers they no longer use, so this works in place.
  let chans = channels;
  const n0 = chans[0]!.length;
  for (const ch of chans) {
    // A loop's DC is removed as its mean (a filter with memory would put a
    // step at the seam); a one-shot's with a gentle one-pole high-pass.
    if (o.loop) {
      let mean = 0;
      for (let i = 0; i < ch.length; i++) mean += ch[i]!;
      mean /= ch.length;
      for (let i = 0; i < ch.length; i++) ch[i]! -= mean;
    } else {
      const a = Math.exp((-2 * Math.PI * 18) / sr);
      let y = 0;
      let x1 = 0;
      const g = (1 + a) / 2;
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i]!;
        y = g * (x - x1) + a * y;
        x1 = x;
        ch[i] = y;
      }
    }
  }
  if (!o.loop) {
    // Trim: after the last sample above −80 dB of the peak, keep 60 ms.
    let p = 0;
    for (const ch of chans) for (let i = 0; i < n0; i++) p = Math.max(p, Math.abs(ch[i]!));
    const floor = p * 1e-4;
    let last = 0;
    for (const ch of chans) {
      for (let i = n0 - 1; i > last; i--) {
        if (Math.abs(ch[i]!) > floor) {
          last = i;
          break;
        }
      }
    }
    const keep = Math.min(n0, last + samples(sr, 0.06));
    if (keep < n0) chans = chans.map((c) => c.slice(0, keep));
    const n = keep;
    const fi = Math.min(n, samples(sr, 0.0005));
    const fo = Math.min(Math.floor(n / 4), samples(sr, 0.06));
    for (const ch of chans) {
      for (let i = 0; i < fi; i++) ch[i]! *= i / fi;
      for (let i = 0; i < fo; i++) ch[n - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
    }
  }
  // Normalise and limit; if the limiter bent anything, the loudest moment
  // came down a little, so measure and do it once more.
  const wanted = TARGET_LOUDNESS_DB + (o.trim ?? 0);
  const knee = LIMITER_KNEE;
  const span = LIMITER_CEILING - LIMITER_KNEE;
  for (let pass = 0; pass < 2; pass++) {
    const current = momentaryMaxDb(chans, sr);
    if (Number.isNaN(current)) throw new Error("non-finite samples");
    const gain = Number.isFinite(current) ? Math.pow(10, (wanted - current) / 20) : 1;
    let bent = false;
    for (const ch of chans) {
      for (let i = 0; i < ch.length; i++) {
        const x = ch[i]! * gain;
        const m = x < 0 ? -x : x;
        if (m <= knee) {
          ch[i] = x;
        } else {
          const y = knee + span * Math.tanh((m - knee) / span);
          ch[i] = x < 0 ? -y : y;
          bent = true;
        }
      }
    }
    if (!bent) break;
  }
  return chans;
}

/**
 * A seamless loop of ``length`` samples from a render ``length + overlap``
 * long: the overlap past the end is cross-faded into the start (equal power,
 * since the two stretches are uncorrelated), so the last sample runs into the
 * first exactly as the render ran on. Nothing is left to click at the seam.
 */
export function loopify(render: Mono, length: number): Mono {
  const overlap = render.length - length;
  if (overlap <= 0) throw new Error("loopify: the render must be longer than the loop");
  const out = render.slice(0, length);
  for (let i = 0; i < overlap && i < length; i++) {
    const u = (i + 0.5) / overlap;
    const fadeIn = Math.sin(0.5 * Math.PI * u);
    const fadeOut = Math.cos(0.5 * Math.PI * u);
    out[i] = render[i]! * fadeIn + render[length + i]! * fadeOut;
  }
  return out;
}

/**
 * A loop of events: everything rendered past ``length`` wraps round and is
 * added to the start, as if the pattern had always been playing. Right for
 * rhythmic loops (a heartbeat), whose tails must carry over the seam.
 */
export function wrap(render: Mono, length: number): Mono {
  const out = new Float32Array(length);
  for (let i = 0; i < render.length; i++) out[i % length]! += render[i]!;
  return out;
}

/**
 * The take's loudness over time, one RMS value per ``block`` seconds. The
 * engine uses it to steal the voice that is quietest *right now*, not the
 * one that started quietest.
 */
export function envelopeOf(channels: Channels, sr: number, block = 0.02): Float32Array {
  const size = samples(sr, block);
  const n = channels[0]!.length;
  const out = new Float32Array(Math.ceil(n / size));
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    const end = Math.min(n, (b + 1) * size);
    for (const ch of channels) for (let i = b * size; i < end; i++) s += ch[i]! * ch[i]!;
    out[b] = Math.sqrt(s / Math.max(1, (end - b * size) * channels.length));
  }
  return out;
}
