/**
 * Measuring a stereo render without hearing it: loudness by ITU-R BS.1770 (integrated, short-term, momentary, the
 * loudness range), the true peak (4x oversampled), the spectrum in bands and its centroid, and the same over windows of
 * time. Pure Node, on Float32Arrays.
 */

const db = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);

/** A biquad run over a signal, coefficients normalised (a0 = 1). */
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

/** The K-weighting of BS.1770 for any rate (the pre-filter's shelf and the RLB high-pass, by their analogue prototypes). */
function kWeight(x, sr) {
  // Stage 1: the head's high shelf.
  {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sr);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    x = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  }
  // Stage 2: the RLB high-pass.
  {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sr);
    const a0 = 1 + K / Q + K * K;
    x = biquad(x, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  }
  return x;
}

/** Mean-square power of the K-weighted stereo signal in blocks of `block` s every `hop` s. */
function blockPowers(kl, kr, sr, block, hop) {
  const size = Math.round(block * sr);
  const step = Math.round(hop * sr);
  const out = [];
  for (let s = 0; s + size <= kl.length; s += step) {
    let acc = 0;
    for (let i = s; i < s + size; i++) acc += kl[i] * kl[i] + kr[i] * kr[i];
    out.push(acc / size);
  }
  return out;
}

const lufsOf = (p) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -120);

/** Integrated loudness of block powers with the absolute (-70) and relative (-10 LU) gates. */
function gated(powers) {
  const abs = powers.filter((p) => lufsOf(p) > -70);
  if (abs.length === 0) return -120;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufsOf(p) > lufsOf(mean) - 10);
  return lufsOf(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
}

/** The loudness range (EBU Tech 3342): the 10th to 95th percentile of gated short-term loudness. */
function loudnessRange(short) {
  const abs = short.filter((p) => lufsOf(p) > -70);
  if (abs.length < 2) return 0;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufsOf(p) > lufsOf(mean) - 20).map(lufsOf).sort((a, b) => a - b);
  const at = (q) => rel[Math.min(rel.length - 1, Math.floor(q * (rel.length - 1)))];
  return at(0.95) - at(0.1);
}

/** The highest sample after 4x oversampling (a 48-tap windowed sinc per phase): the true peak, dBTP. */
function truePeak(x) {
  const taps = 12;
  const phases = [0.25, 0.5, 0.75];
  const kernels = phases.map((ph) => {
    const k = new Float64Array(2 * taps);
    for (let j = 0; j < 2 * taps; j++) {
      const t = j - taps + 1 - ph;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / (taps + 1));
      k[j] = sinc * w;
    }
    return k;
  });
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > peak) peak = v;
  }
  // Only around the loud stretches: the inter-sample peak is near a sample peak.
  const near = peak * 0.7;
  for (let i = taps; i < x.length - taps; i++) {
    if (Math.abs(x[i]) < near) continue;
    for (const k of kernels) {
      let acc = 0;
      for (let j = 0; j < 2 * taps; j++) acc += k[j] * x[i - taps + 1 + j];
      if (Math.abs(acc) > peak) peak = Math.abs(acc);
    }
  }
  return peak;
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export const BANDS = [
  ["sub", 20, 80],
  ["low", 80, 250],
  ["lowmid", 250, 800],
  ["mid", 800, 2500],
  ["presence", 2500, 6000],
  ["air", 6000, 16000],
];

/** Power by band (dB relative to the total) and the centroid, Hz, of the mono sum from `from` to `to` samples. */
export function spectrum(left, right, sr, from = 0, to = left.length) {
  const size = 4096;
  const re = new Float64Array(size), im = new Float64Array(size);
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const band = new Float64Array(BANDS.length);
  let total = 0, num = 0;
  for (let s = from; s + size <= to; s += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = 0.5 * (left[s + i] + right[s + i]) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const hz = (k * sr) / size;
      const p = re[k] * re[k] + im[k] * im[k];
      total += p;
      num += p * hz;
      for (let b = 0; b < BANDS.length; b++) if (hz >= BANDS[b][1] && hz < BANDS[b][2]) band[b] += p;
    }
  }
  const bands = {};
  BANDS.forEach(([name], b) => (bands[name] = +(10 * Math.log10((band[b] + 1e-30) / (total + 1e-30))).toFixed(1)));
  return { centroid: total > 0 ? Math.round(num / total) : 0, bands };
}

/** Everything about a stereo render. */
export function analyse(left, right, sr) {
  const kl = kWeight(left, sr), kr = kWeight(right, sr);
  const momentary = blockPowers(kl, kr, sr, 0.4, 0.1);
  const short = blockPowers(kl, kr, sr, 3, 1);
  let peak = 0, sum = 0, clipped = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i]), b = Math.abs(right[i]);
    peak = Math.max(peak, a, b);
    sum += (left[i] * left[i] + right[i] * right[i]) / 2;
    if (a >= 0.999 || b >= 0.999) clipped++;
  }
  // The side signal against the mid: how wide the stereo picture is.
  let mid = 0, side = 0;
  for (let i = 0; i < left.length; i++) {
    const m = 0.5 * (left[i] + right[i]), s = 0.5 * (left[i] - right[i]);
    mid += m * m;
    side += s * s;
  }
  const spec = spectrum(left, right, sr);
  return {
    seconds: +(left.length / sr).toFixed(2),
    lufs: +gated(momentary).toFixed(1),
    shortMax: +lufsOf(Math.max(...short, 0)).toFixed(1),
    momentaryMax: +lufsOf(Math.max(...momentary, 0)).toFixed(1),
    lra: +loudnessRange(short).toFixed(1),
    truePeak: +db(Math.max(truePeak(left), truePeak(right))).toFixed(1),
    samplePeak: +db(peak).toFixed(1),
    rms: +db(Math.sqrt(sum / left.length)).toFixed(1),
    clipped,
    width: +db(Math.sqrt(side / Math.max(mid, 1e-30))).toFixed(1),
    centroid: spec.centroid,
    bands: spec.bands,
  };
}

/** Short-term loudness (3 s), one value a second, LUFS. */
export function shortTerm(left, right, sr) {
  const kl = kWeight(left, sr), kr = kWeight(right, sr);
  return blockPowers(kl, kr, sr, 3, 1).map((p) => +lufsOf(p).toFixed(1));
}

/** Momentary loudness (0.4 s) every 0.1 s, LUFS. */
export function momentary(left, right, sr) {
  const kl = kWeight(left, sr), kr = kWeight(right, sr);
  return blockPowers(kl, kr, sr, 0.4, 0.1).map((p) => +lufsOf(p).toFixed(1));
}

/** A 16-bit PCM stereo WAV (TPDF dithered): plays anywhere. */
export function wav16(left, right, sr) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767 + rnd() - rnd())));
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(q(left[i]), 44 + i * 4);
    buf.writeInt16LE(q(right[i]), 46 + i * 4);
  }
  return buf;
}
