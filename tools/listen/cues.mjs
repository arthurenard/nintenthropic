/**
 * Renders single cues of the kart pack offline in Node (no browser, nothing ever played), writes each as a stereo WAV
 * and measures how it is built: the numbers that say whether an engine is alive or a buzz, rich or thin, wide or mono.
 *
 *   node tools/listen/cues.mjs --label after                     (this checkout)
 *   node tools/listen/cues.mjs --label before --root /path/to/older/checkout
 *   node tools/listen/cues.mjs --label after --only kart_engine_heavy_mid,kart_surf_snow --takes 3
 *
 *   --shots DIR   also draws a spectrogram PNG per cue into DIR (ffmpeg showspectrumpic; <label>-<cue>.png)
 *
 * Measures, per cue (take 0 unless --takes says more, averaged):
 *   centroid, rolloff  where the energy sits (Hz; 85 % of it lies under the rolloff)
 *   crest              peak over RMS, dB: a smooth drone has a low one, grains and clicks a high one
 *   am                 amplitude modulation depth: the spread of the RMS over 40 ms windows, as a share of its mean
 *                      (0 is a static drone, 0.3 and more is something alive)
 *   rich               harmonic richness (engines): how many multiples of the firing note stand within 30 dB of the
 *                      strongest, up to 8 kHz
 *   width              side over mid, dB (-15 is near mono, -6 clearly wide, 0 fully decorrelated)
 *   mono               how much of the stereo level survives summing to mono, dB (0 is perfectly mono-compatible)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { wav16 } from "./measure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const label = arg("label", "latest");
const root = resolve(arg("root", resolve(HERE, "../..")));
const only = arg("only", null)?.split(",");
const takes = Number(arg("takes", 1));
const shots = arg("shots", null);
const SR = 44100;
const OUT = resolve(HERE, "out", `cues-${label}`);

/** Where each engine layer's firing note is, Hz (cycles a second times the revs it was made at). */
const NOTES = { light: 110, middle: 84, heavy: 46, electric: 58 };
const REVS = { lo: [0.9, 0.8], mid: [1.2, 1.2], hi: [1.6, 1.8] };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Magnitude spectrum of the mid signal over the largest power of two that fits (Hann). */
function magnitudes(mid) {
  let size = 1;
  while (size * 2 <= mid.length) size *= 2;
  size = Math.min(size, 65536);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = mid[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { mag, hz: SR / size };
}

function measure(l, r, f0) {
  const n = l.length;
  const mid = new Float64Array(n), side = new Float64Array(n);
  let sumSq = 0, peak = 0, midSq = 0, sideSq = 0, monoSq = 0;
  for (let i = 0; i < n; i++) {
    mid[i] = 0.5 * (l[i] + r[i]);
    side[i] = 0.5 * (l[i] - r[i]);
    midSq += mid[i] * mid[i];
    sideSq += side[i] * side[i];
    sumSq += 0.5 * (l[i] * l[i] + r[i] * r[i]);
    monoSq += ((l[i] + r[i]) * (l[i] + r[i])) / 4;
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  }
  const rms = Math.sqrt(sumSq / n);
  const { mag, hz } = magnitudes(mid);
  let total = 0, num = 0;
  for (let k = 1; k < mag.length; k++) { const p = mag[k] * mag[k]; total += p; num += p * k * hz; }
  let acc = 0, rolloff = 0;
  for (let k = 1; k < mag.length; k++) { acc += mag[k] * mag[k]; if (acc >= 0.85 * total) { rolloff = k * hz; break; } }
  // The RMS over 40 ms windows (hop 20 ms), its spread against its mean.
  const win = Math.round(0.04 * SR), hop = Math.round(0.02 * SR);
  const levels = [];
  for (let s = 0; s + win <= n; s += hop) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += 0.5 * (l[i] * l[i] + r[i] * r[i]);
    levels.push(Math.sqrt(e / win));
  }
  const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
  const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) ** 2, 0) / levels.length);
  let rich = null;
  if (f0) {
    let top = 0;
    const found = [];
    for (let h = 1; h * f0 < 8000; h++) {
      const centre = (h * f0) / hz;
      const span = Math.max(2, Math.round(0.012 * centre));
      let best = 0;
      for (let k = Math.max(1, Math.floor(centre - span)); k <= Math.min(mag.length - 1, Math.ceil(centre + span)); k++) best = Math.max(best, mag[k]);
      found.push(best);
      top = Math.max(top, best);
    }
    rich = found.filter((m) => m > top * 0.0316).length;
  }
  const db = (x) => 20 * Math.log10(x + 1e-12);
  return {
    centroid: Math.round(num / total),
    rolloff: Math.round(rolloff),
    crest: +db(peak / rms).toFixed(1),
    am: +(sd / mean).toFixed(2),
    rich,
    width: sideSq < 1e-12 * midSq ? null : +(10 * Math.log10(sideSq / midSq)).toFixed(1),
    mono: +(10 * Math.log10((monoSq + 1e-20) / (sumSq + 1e-20))).toFixed(1),
    rmsDb: +db(rms).toFixed(1),
    peakDb: +db(peak).toFixed(1),
  };
}

const bundle = resolve(HERE, "out", `.cues-${label}.mjs`);
mkdirSync(OUT, { recursive: true });
buildSync({ entryPoints: [resolve(root, "tools/listen/cues-entry.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error" });
const { CUES, renderTake } = await import(pathToFileURL(bundle).href + `?v=${Date.now()}`);

const names = Object.keys(CUES).filter((c) => c.startsWith("kart_") && !c.startsWith("kart_amb_") && !c.startsWith("kart_ui_") && (!only || only.includes(c)));
const result = {};
for (const cue of names) {
  const list = [];
  for (let k = 0; k < takes; k++) {
    const t0 = performance.now();
    const rt = renderTake(cue, k, { sampleRate: SR, seed: 1 });
    const ms = performance.now() - t0;
    const l = rt.channels[0], r = rt.channels[1] ?? rt.channels[0];
    const m = /^kart_engine_(light|middle|heavy|electric)_(lo|mid|hi)$/.exec(cue);
    // The firing note: the engine's cycles a second (the V-twin's firings come twice a cycle but its cycle is the note).
    const f0 = m ? NOTES[m[1]] * (REVS[m[2]][label.startsWith("before") || label.startsWith("base") ? 0 : 1]) : null;
    list.push({ ...measure(l, r, f0), ms: +ms.toFixed(1), seconds: +(l.length / SR).toFixed(2) });
    if (k === 0) {
      writeFileSync(`${OUT}/${cue}.wav`, wav16(l, r, SR));
      if (shots) {
        mkdirSync(shots, { recursive: true });
        spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${OUT}/${cue}.wav`, "-lavfi", "showspectrumpic=s=900x360:legend=0:scale=log:fscale=log", `${shots}/${label}-${cue}.png`]);
      }
    }
  }
  const avg = {};
  for (const key of Object.keys(list[0])) avg[key] = list[0][key] === null ? null : +(list.reduce((a, b) => a + b[key], 0) / list.length).toFixed(2);
  result[cue] = avg;
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(result, null, 1));
const pad = (x, n = 8) => String(x).padStart(n);
console.log(`${"cue".padEnd(26)}${pad("sec")}${pad("centr")}${pad("rollof")}${pad("crest")}${pad("am")}${pad("rich")}${pad("width")}${pad("mono")}${pad("ms")}`);
for (const [cue, v] of Object.entries(result)) console.log(`${cue.padEnd(26)}${pad(v.seconds)}${pad(v.centroid)}${pad(v.rolloff)}${pad(v.crest)}${pad(v.am)}${pad(v.rich ?? "-")}${pad(v.width ?? '-')}${pad(v.mono)}${pad(v.ms)}`);
