/**
 * A small offline DSP kit for the trailer's music and sound effects, in plain
 * Node: oscillators (band-limited), filters, noise, an FFT convolution reverb,
 * a ping-pong delay, a compressor and a look-ahead limiter, WAV in and out,
 * and loudness measurement through ffmpeg. Nothing here ever plays a sound:
 * everything is arithmetic on Float32Arrays that end up in a file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SR = 48000;
export const TAU = 2 * Math.PI;
export const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const db = (x) => Math.pow(10, x / 20);
export const toDb = (x) => 20 * Math.log10(Math.max(1e-12, x));
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const secs = (s) => Math.round(s * SR);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** A small deterministic generator, so every render is the same. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function whiteNoise(n, rand) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  return x;
}

/** Equal-power pan: -1 left .. 1 right. */
export function panGains(pan) {
  const a = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  return [Math.cos(a), Math.sin(a)];
}

// --- filters ---------------------------------------------------------------------------------------------

/** A zero-delay-feedback state-variable filter: stable under fast cutoff modulation. */
export class Svf {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.lo = 0;
    this.bp = 0;
    this.hp = 0;
    this.set(1000, 0.707);
  }
  set(fc, q = 0.707) {
    const f = clamp(fc, 8, SR * 0.46);
    this.g = Math.tan((Math.PI * f) / SR);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  /** Feed one sample; read this.lo / this.bp (use k*bp for a unity-peak band-pass) / this.hp. */
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lo = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

/**
 * Filters a buffer. `fc` and `q` may be numbers or functions of time (s);
 * type is "lp", "hp", "bp" (unity peak), "notch".
 */
export function filter(x, type, fc, q = 0.707, out = null) {
  const y = out ?? new Float32Array(x.length);
  const f = new Svf();
  const dynamic = typeof fc === "function" || typeof q === "function";
  if (!dynamic) f.set(fc, q);
  for (let i = 0; i < x.length; i++) {
    if (dynamic && (i & 15) === 0) f.set(typeof fc === "function" ? fc(i / SR) : fc, typeof q === "function" ? q(i / SR) : q);
    f.tick(x[i]);
    y[i] = type === "lp" ? f.lo : type === "hp" ? f.hp : type === "bp" ? f.bp * f.k : f.lo + f.hp;
  }
  return y;
}

/** An RBJ biquad (static): peaking, low/high shelf, for the master's EQ. */
export function biquad(x, type, f0, q, gainDb = 0) {
  const w0 = (TAU * clamp(f0, 10, SR * 0.45)) / SR;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "peak") {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === "lowshelf") {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
    a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
  } else if (type === "highshelf") {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
    a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
  } else if (type === "hp") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = nb0 * v + z1;
    z1 = nb1 * v - na1 * o + z2;
    z2 = nb2 * v - na2 * o;
    y[i] = o;
  }
  return y;
}

// --- oscillators -----------------------------------------------------------------------------------------

function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** One band-limited saw sample from a phase 0..1 and its increment. */
export const sawAt = (ph, dt) => 2 * ph - 1 - polyBlep(ph, dt);
/** One band-limited pulse sample. */
export function pulseAt(ph, dt, width = 0.5) {
  let v = ph < width ? 1 : -1;
  v += polyBlep(ph, dt);
  v -= polyBlep((ph + (1 - width)) % 1, dt);
  return v;
}

export function fadeIn(x, n) {
  const m = Math.min(n, x.length);
  for (let i = 0; i < m; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / m);
  return x;
}
export function fadeOut(x, n) {
  const m = Math.min(n, x.length);
  for (let i = 0; i < m; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / m);
  return x;
}
export function reversed(x) {
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[x.length - 1 - i];
  return y;
}

// --- FFT convolution (reverb) --------------------------------------------------------------------------------------

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (sign * TAU) / len;
    // Twiddles for this stage.
    const tr = new Float64Array(half);
    const ti = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      tr[k] = Math.cos(ang * k);
      ti[k] = Math.sin(ang * k);
    }
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * tr[k] - im[b] * ti[k];
        const xi = re[b] * ti[k] + im[b] * tr[k];
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * Convolves a mono signal with a stereo impulse response (two real IRs packed
 * as one complex one: the real part of the product is the left channel and the
 * imaginary part the right). Returns [left, right], each as long as `x`.
 */
export function convolveStereo(x, irL, irR) {
  const need = x.length + Math.max(irL.length, irR.length);
  let size = 1;
  while (size < need) size <<= 1;
  const xr = new Float64Array(size);
  const xi = new Float64Array(size);
  for (let i = 0; i < x.length; i++) xr[i] = x[i];
  const hr = new Float64Array(size);
  const hi = new Float64Array(size);
  for (let i = 0; i < irL.length; i++) hr[i] = irL[i];
  for (let i = 0; i < irR.length; i++) hi[i] = irR[i];
  fft(xr, xi, false);
  fft(hr, hi, false);
  for (let i = 0; i < size; i++) {
    const a = xr[i] * hr[i] - xi[i] * hi[i];
    const b = xr[i] * hi[i] + xi[i] * hr[i];
    xr[i] = a;
    xi[i] = b;
  }
  fft(xr, xi, true);
  const l = new Float32Array(x.length);
  const r = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) { l[i] = xr[i]; r[i] = xi[i]; }
  return [l, r];
}

/**
 * A synthetic reverb impulse response: decaying noise that darkens as it
 * fades, a few early reflections, a pre-delay. Unit energy, so a send at gain
 * g returns a tail of about g times the signal's own RMS.
 */
export function makeIR({ t60 = 2.5, preDelay = 0.015, lenSec = null, bright = 14000, dark = 1800, early = true, seed = 7, lowCut = 140, diffuse = 0.012 }) {
  const len = secs(lenSec ?? t60 * 1.15);
  const out = [];
  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(seed * 31 + ch * 977);
    const y = new Float32Array(len);
    let lp = 0;
    const pre = secs(preDelay);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / SR;
      const amp = Math.exp((-6.9078 * t) / t60) * (1 - Math.exp(-t / diffuse));
      const fc = bright * Math.pow(dark / bright, clamp(t / t60, 0, 1.5));
      const a = 1 - Math.exp((-TAU * fc) / SR);
      lp += a * (rand() * 2 - 1 - lp);
      y[i] = lp * amp;
    }
    if (early) {
      const taps = [0.011, 0.019, 0.027, 0.041, 0.058, 0.077, 0.101];
      taps.forEach((tt, k) => {
        const idx = pre + secs(tt * (1 + 0.15 * (ch ? 1 : -1)) + 0.002 * ch);
        if (idx < len) y[idx] += (rand() > 0.5 ? 1 : -1) * 0.55 * Math.pow(0.82, k) * (0.7 + 0.3 * rand());
      });
    }
    out.push(filter(y, "hp", lowCut, 0.7));
  }
  let e = 0;
  for (const ch of out) for (let i = 0; i < ch.length; i++) e += ch[i] * ch[i];
  const norm = 1 / Math.sqrt(e / 2);
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= norm;
  return out;
}

/** A tempo-synced ping-pong delay, wet signal only. */
export function pingPong(inMono, { time = 0.375, feedback = 0.4, tone = 4200 } = {}) {
  const n = inMono.length;
  const d = Math.round(time * SR);
  const bufL = new Float32Array(d);
  const bufR = new Float32Array(d);
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const a = 1 - Math.exp((-TAU * tone) / SR);
  let idx = 0, lpL = 0, lpR = 0;
  for (let i = 0; i < n; i++) {
    const dl = bufL[idx];
    const dr = bufR[idx];
    outL[i] = dl;
    outR[i] = dr;
    lpR += a * (dl * feedback - lpR);
    lpL += a * (dr * feedback - lpL);
    bufL[idx] = inMono[i] + lpL;
    bufR[idx] = lpR;
    if (++idx === d) idx = 0;
  }
  return [outL, outR];
}

// --- dynamics -----------------------------------------------------------------------------------------------------

/** A stereo-linked feed-forward compressor (soft knee), in place. */
export function compress(l, r, { threshold = -18, ratio = 2, attack = 0.012, release = 0.14, knee = 8, makeup = 0 } = {}) {
  const aA = 1 - Math.exp(-1 / (attack * SR));
  const aR = 1 - Math.exp(-1 / (release * SR));
  let env = 0;
  const mk = db(makeup);
  let maxGr = 0;
  for (let i = 0; i < l.length; i++) {
    const x = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    env += (x > env ? aA : aR) * (x - env);
    const lv = toDb(env);
    const over = lv - threshold;
    let gr = 0;
    if (2 * over < -knee) gr = 0;
    else if (2 * Math.abs(over) <= knee) gr = ((1 - 1 / ratio) * (over + knee / 2) ** 2) / (2 * knee);
    else gr = (1 - 1 / ratio) * over;
    maxGr = Math.max(maxGr, gr);
    const g = db(-gr) * mk;
    l[i] *= g;
    r[i] *= g;
  }
  return maxGr;
}

/** A knee clipper: linear to `knee`, then a tanh shoulder that approaches 1. */
export function softClip(x, knee = 0.7) {
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const m = Math.abs(v);
    if (m > knee) x[i] = Math.sign(v) * (knee + (1 - knee) * Math.tanh((m - knee) / (1 - knee)));
  }
  return x;
}

/** A look-ahead peak limiter: never passes more than `ceiling` (linear) at any sample. */
export function limit(l, r, { ceiling = db(-1.8), lookahead = 0.003, release = 0.1 } = {}) {
  const n = l.length;
  const LA = Math.max(2, Math.round(lookahead * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // Minimum over the next LA samples.
  const m = new Float32Array(n);
  const dq = new Int32Array(n + 1);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + LA - 1) head++;
    m[i] = need[dq[head]];
  }
  // Instant attack, slow release, then a moving average of LA samples (which keeps the guarantee).
  const rel = 1 - Math.exp(-1 / (release * SR));
  const s = new Float32Array(n);
  let cur = 1;
  for (let i = 0; i < n; i++) {
    cur = Math.min(m[i], cur + (1 - cur) * rel);
    s[i] = cur;
  }
  let acc = 0;
  let minGain = 1;
  for (let i = 0; i < n; i++) {
    acc += s[i];
    if (i >= LA) acc -= s[i - LA];
    const g = acc / Math.min(LA, i + 1);
    if (g < minGain) minGain = g;
    l[i] *= g;
    r[i] *= g;
  }
  return toDb(minGain);
}

// --- measuring --------------------------------------------------------------------------------------------------------

export function peakOf(l, r, from = 0, to = l.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(l[i]), Math.abs(r[i]));
  return p;
}
export function rmsOf(l, r, from = 0, to = l.length) {
  let e = 0;
  for (let i = from; i < to; i++) e += l[i] * l[i] + r[i] * r[i];
  return Math.sqrt(e / Math.max(1, 2 * (to - from)));
}

// --- files ------------------------------------------------------------------------------------------------------------

/** Writes a 32-bit float stereo WAV. */
export function writeWav(path, l, r, sampleRate = SR) {
  mkdirSync(dirname(path), { recursive: true });
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 8, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(l[i], o);
    buf.writeFloatLE(r[i], o + 4);
    o += 8;
  }
  writeFileSync(path, buf);
}

/** Reads any audio file ffmpeg can decode, as 48 kHz stereo float: { l, r }. */
export function readAudio(path) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${r.stderr?.toString()}`);
  const f = new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.byteLength - (r.stdout.byteLength % 8)));
  const n = f.length / 2;
  const l = new Float32Array(n);
  const rr = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = f[2 * i]; rr[i] = f[2 * i + 1]; }
  return { l, r: rr };
}

/** Integrated loudness, loudness range and true peak of a file, as ffmpeg's ebur128 reads it. */
export function measure(path) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.split("\n").slice(-6).join("\n")}`);
  const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  const num = (re) => Number(re.exec(summary)?.[1]);
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
