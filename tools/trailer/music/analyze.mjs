/**
 * Checks the music (or any 48 kHz audio) by analysis only, never by ear:
 * levels per bar, band balance, momentary loudness, kick onsets against the
 * 120 BPM grid, the silence of the breath before 4.0, and a spectrogram image.
 *
 *   node tools/trailer/music/analyze.mjs [tools/trailer/out/music/music.wav] [--png out.png]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG, SR, Svf, measure, peakOf, readAudio, rmsOf, secs, toDb } from "./dsp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const file = resolve(argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? `${HERE}/../out/music/music.wav`);
const pngIdx = argv.indexOf("--png");
const png = pngIdx >= 0 ? resolve(argv[pngIdx + 1]) : resolve(dirname(file), "spectrogram.png");
const lines = [];
const say = console.log;
console.log = (...a) => { lines.push(a.join(" ")); say(...a); };
const { l, r } = readAudio(file);
const n = l.length;
console.log(`${file}\n${(n / SR).toFixed(3)} s, ${n} samples`);

const m = measure(file);
console.log(`integrated ${m.lufs} LUFS, LRA ${m.lra} LU, true peak ${m.tp} dBTP, sample peak ${toDb(peakOf(l, r)).toFixed(2)} dBFS`);

// Momentary loudness (400 ms) per bar, from ffmpeg's ebur128 log.
const log = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 }).stderr;
const momentary = [];
for (const line of log.split("\n")) {
  const mm = /t:\s+([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(-?[\d.]+|-inf)/.exec(line) ?? /t:\s*([\d.]+)\s+M:\s*(-?[\d.]+|-inf)/.exec(line);
  if (mm) momentary.push([Number(mm[1]), mm[2] === "-inf" ? -120 : Number(mm[2])]);
}

// Band split: sub/low (<120), mid (120-1k), presence (1k-5k), air (>5k).
const band = (x, lo, hi) => {
  const y = new Float32Array(x.length);
  const a = new Svf(), b = new Svf();
  if (lo) a.set(lo, 0.707);
  b.set(hi, 0.707);
  for (let i = 0; i < x.length; i++) {
    let v = x[i];
    if (lo) { a.tick(v); v = a.hp; }
    b.tick(v);
    y[i] = b.lo;
  }
  return y;
};
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = 0.5 * (l[i] + r[i]);
const bands = { low: band(mono, 0, 120), mid: band(mono, 120, 1000), pres: band(mono, 1000, 5000), air: band(mono, 5000, 20000) };
const rms1 = (x, a, b) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };

console.log("\nbar  time        RMS    peak   M-LUFS | low   mid   pres  air  (dB re full scale)");
for (let b = 1; b <= 20; b++) {
  const a = secs((b - 1) * 2), z = secs(b * 2);
  const ms = momentary.filter(([t]) => t > (b - 1) * 2 + 0.4 && t <= b * 2).map(([, v]) => v);
  const mAvg = ms.length ? ms.reduce((p, c) => p + c, 0) / ms.length : NaN;
  console.log(
    `${String(b).padStart(2)}  ${((b - 1) * 2).toString().padStart(2)}-${(b * 2).toString().padEnd(2)} s  ${toDb(rmsOf(l, r, a, z)).toFixed(1).padStart(6)} ${toDb(peakOf(l, r, a, z)).toFixed(1).padStart(6)} ${mAvg.toFixed(1).padStart(7)}  | ` +
      ["low", "mid", "pres", "air"].map((k) => toDb(rms1(bands[k], a, z)).toFixed(0).padStart(4)).join("  "),
  );
}

// Half-bar and beat-level detail around the structural points.
const win = (t0, t1) => toDb(rmsOf(l, r, secs(t0), secs(t1))).toFixed(1);
console.log("\nStructure (RMS dBFS):");
console.log(`  breath 3.5-4.0 ${win(3.5, 4.0)}   (before: 3.0-3.5 ${win(3.0, 3.5)})   drop 1 4.0-4.5 ${win(4.0, 4.5)}`);
console.log(`  bar 10 18-20 ${win(18, 20)}   break 20-22 ${win(20, 22)}   (20-21 ${win(20, 21)}, 21-22 ${win(21, 22)})   drop 2 22.0-22.5 ${win(22, 22.5)}`);
console.log(`  climax 30-34 ${win(30, 34)}   roll 33-34 ${win(33, 34)}   hit 34.0-34.5 ${win(34, 34.5)}   tail 35-36 ${win(35, 36)}  37-38 ${win(37, 38)}  38.5-39.25 ${win(38.5, 39.25)}  39.25-40 ${win(39.25, 40)}`);
console.log(`  peak at the impacts: 4.0-4.1 ${toDb(peakOf(l, r, secs(4), secs(4.1))).toFixed(1)}  22.0-22.1 ${toDb(peakOf(l, r, secs(22), secs(22.1))).toFixed(1)}  34.0-34.1 ${toDb(peakOf(l, r, secs(34), secs(34.1))).toFixed(1)}`);
console.log(`  first / last samples: ${l[0].toExponential(1)} ${l[n - 1].toExponential(1)}; last 50 ms peak ${toDb(peakOf(l, r, n - secs(0.05), n)).toFixed(1)} dBFS`);

// Onsets: where the high-passed (>1.5 kHz: the kick's click, claps, hats, impacts) envelope first jumps at each beat, vs the grid.
const env = new Float32Array(n);
{
  const hp = new Svf();
  hp.set(1500, 0.7);
  const w = secs(0.0003);
  const ab = new Float32Array(n);
  for (let i = 0; i < n; i++) { hp.tick(mono[i]); ab[i] = Math.abs(hp.hp); }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += ab[i];
    if (i >= w) acc -= ab[i - w];
    env[i] = acc / w;
  }
}
// Grid alignment: the mean high-band envelope at the beats as a function of a shift; its peak should sit within a ms of 0
// (the envelope itself is smoothed by 0.3 ms). Then the first clear jump at the three big hits.
const beats = [];
for (let t = 4.0; t <= 33.5; t += 0.25) if (!(t >= 18 && t < 22)) beats.push(t);
let bestShift = 0, bestVal = -1;
const profile = [];
for (let sh = -12; sh <= 12; sh += 0.25) {
  let acc = 0;
  for (const t of beats) acc += env[Math.round((t + sh / 1000) * SR)];
  profile.push([sh, acc / beats.length]);
  if (acc > bestVal) { bestVal = acc; bestShift = sh; }
}
console.log(`\nGrid alignment over ${beats.length} sixteenth positions: the high-band energy peaks at ${bestShift.toFixed(2)} ms from the grid (flank: ${profile.find(([s]) => s === -2)[1].toExponential(1)} at -2 ms, ${profile.find(([s]) => s === 0)[1].toExponential(1)} at 0, ${profile.find(([s]) => s === 2)[1].toExponential(1)} at +2)`);
const jump = (t, pre = 0.0015) => {
  let base = 0;
  for (let i = secs(t - 0.012); i < secs(t - 0.001); i++) base = Math.max(base, env[i]);
  for (let i = secs(t - 0.002); i < secs(t + 0.03); i++) if (env[i] > 2.5 * base + 0.0015) return ((i / SR - t) * 1000).toFixed(2);
  return "n/a";
};
console.log(`  first clear jump: 4.0 -> ${jump(4)} ms, 22.0 -> ${jump(22)} ms, 34.0 -> ${jump(34)} ms`);

const sp = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-lavfi", "showspectrumpic=s=1800x640:legend=1:scale=log:fscale=log:color=intensity:drange=90:limit=0", "-frames:v", "1", png], { encoding: "utf8" });
console.log(sp.status === 0 ? `\nspectrogram: ${png}` : `\nspectrogram failed: ${sp.stderr}`);

writeFileSync(resolve(dirname(file), "analysis.txt"), lines.join("\n") + "\n");
