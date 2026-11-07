/**
 * Renders Grip Prix's sound-effect cues one by one, offline in Node (nothing is ever played), writes a WAV per cue to
 * tools/listen/out/sheet-<label>/ with summary.json, and measures each: duration, attack time, crest factor, spectral
 * centroid, loudness at the bus, true peak, clipping. Spectrograms (ffmpeg showspectrumpic) go with --spectrograms.
 *
 *   node tools/listen/cue-sheet.mjs --label before
 *   node tools/listen/cue-sheet.mjs --label after --only kart_nitro,kart_hit --spectrograms DIR
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyse, wav16 } from "./measure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const label = arg("label", "latest");
const only = arg("only", null)?.split(",");
const specDir = arg("spectrograms", null);
const OUT = resolve(HERE, "out", `sheet-${label}`);
mkdirSync(OUT, { recursive: true });

const bundle = resolve(OUT, "..", `.sheet-bundle-${label}.mjs`);
await build({ entryPoints: [resolve(HERE, "cues.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error" });
const { kartCues, renderCue } = await import(pathToFileURL(bundle).href);

/** Attack time: first sample over 5 % of the peak to the first within 1 dB of the peak, ms. Crest: peak over RMS of the loud part. */
function shape(left, right, sr) {
  const n = left.length;
  const env = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    env[i] = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    peak = Math.max(peak, env[i]);
  }
  // A 2 ms smoothed envelope so one sample cannot decide it.
  const w = Math.max(1, Math.round(0.002 * sr));
  const sm = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += env[i] - (i >= w ? env[i - w] : 0);
    sm[i] = acc / w;
  }
  let smPeak = 0;
  for (let i = 0; i < n; i++) smPeak = Math.max(smPeak, sm[i]);
  let a = 0, b = 0;
  while (a < n && sm[a] < 0.05 * smPeak) a++;
  b = a;
  while (b < n && sm[b] < 0.89 * smPeak) b++;
  // Audible length: until the envelope stays under -50 dB of the peak.
  let end = n - 1;
  while (end > 0 && sm[end] < 0.0032 * smPeak) end--;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (left[i] * left[i] + right[i] * right[i]) / 2;
  const rms = Math.sqrt(sum / n);
  // Time to the first transient: the first sample above -30 dBFS.
  let first = 0;
  while (first < n && Math.abs(left[first]) < 0.0316 && Math.abs(right[first]) < 0.0316) first++;
  return { firstMs: +((first / sr) * 1000).toFixed(1), attackMs: +(((b - a) / sr) * 1000).toFixed(1), audible: +(end / sr).toFixed(2), crest: +(20 * Math.log10(peak / (rms + 1e-12))).toFixed(1) };
}

/** The loudest 50 ms of the cue as it reaches the master, dBFS RMS: how the ear judges a short sound. */
function loud50(left, right, sr) {
  const w = Math.max(1, Math.round(0.05 * sr));
  let acc = 0, best = 0;
  for (let i = 0; i < left.length; i++) {
    acc += (left[i] * left[i] + right[i] * right[i]) / 2;
    if (i >= w) acc -= (left[i - w] * left[i - w] + right[i - w] * right[i - w]) / 2;
    if (acc > best) best = acc;
  }
  return +(10 * Math.log10(best / w + 1e-20)).toFixed(1);
}

const cues = (only ?? kartCues()).filter((c) => !c.startsWith("kart_engine") && !c.startsWith("kart_amb_") && !c.startsWith("kart_surf_"));
const summary = {};
for (const cue of cues) {
  const started = performance.now();
  const r = renderCue(cue, 0);
  const renderMs = Math.round(performance.now() - started);
  const a = analyse(r.left, r.right, r.sr);
  const s = shape(r.left, r.right, r.sr);
  summary[cue] = { level: r.level, bus: r.bus, loop: r.loop, seconds: a.seconds, audible: s.audible, attackMs: s.attackMs, firstMs: s.firstMs, crest: s.crest, centroid: a.centroid, loud50: loud50(r.left, r.right, r.sr), renderMs, momentaryMax: a.momentaryMax, shortMax: a.shortMax, truePeak: a.truePeak, clipped: a.clipped, width: a.width, bands: a.bands };
  writeFileSync(resolve(OUT, `${cue}.wav`), wav16(r.left, r.right, r.sr));
  if (specDir) {
    mkdirSync(specDir, { recursive: true });
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", resolve(OUT, `${cue}.wav`), "-lavfi", "showspectrumpic=s=640x256:legend=0:scale=log:fscale=log:color=intensity", resolve(specDir, `${label}-${cue}.png`)]);
  }
}
writeFileSync(resolve(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(["cue", "level", "sec", "audible", "first ms", "attack ms", "crest dB", "centroid", "loud50", "ms", "tpeak"].join("\t"));
for (const [cue, m] of Object.entries(summary)) console.log([cue, m.level, m.seconds, m.audible, m.firstMs, m.attackMs, m.crest, m.centroid, m.loud50, m.renderMs, m.truePeak].join("\t"));
