/**
 * Renders Grip Prix's sound offline for listening later, and measures it. A Vite dev server serves listen.html, a
 * headless Chrome started with --mute-audio renders each job on an OfflineAudioContext (nothing is ever played), and
 * this writes a 16-bit WAV per job to tools/listen/out/<label>/ with summary.json beside them.
 *
 *   node tools/listen/render.mjs --label before
 *   node tools/listen/render.mjs --label after --only solo-heavy,pass-by
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { analyse, momentary, shortTerm, spectrum, wav16 } from "./measure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/** What to render. `fx`: effects only; `music`: music only; neither: the whole mix. */
export const JOBS = [
  { name: "solo-light", spec: { scene: "solo-light", music: false } },
  { name: "solo-middle", spec: { scene: "solo-middle", music: false } },
  { name: "solo-heavy", spec: { scene: "solo-heavy", music: false } },
  { name: "solo-robot", spec: { scene: "solo-robot", music: false } },
  { name: "pass-by", spec: { scene: "pass-by", music: false } },
  { name: "pack", spec: { scene: "pack", music: false } },
  { name: "moments", spec: { scene: "moments" } },
  { name: "moments-fx", spec: { scene: "moments", music: false } },
  { name: "script4", spec: { scene: "script4" } },
  { name: "race-meadow", spec: { race: "meadow-loop", seconds: 150, views: [0] } },
  { name: "race-meadow-fx", spec: { race: "meadow-loop", seconds: 150, views: [0], music: false } },
  { name: "race-meadow-music", spec: { race: "meadow-loop", seconds: 150, views: [0], effects: false } },
  { name: "race-glacier", spec: { race: "glacier-pass", seconds: 60, views: [3] } },
  { name: "race-volcano", spec: { race: "volcano-rush", seconds: 60, views: [6] } },
  { name: "race-kitchen-4", spec: { race: "kitchen-rally", seconds: 50, views: [0, 1, 2, 3] } },
  { name: "race-kitchen-4-fx", spec: { race: "kitchen-rally", seconds: 50, views: [0, 1, 2, 3], music: false } },
  ...["meadow", "kitchen", "harbour", "canyon", "funfair", "snow", "volcano", "space", "palm"].map((theme) => ({ name: `place-${theme}`, spec: { scene: `place-${theme}`, music: false } })),
];

/** The stretches of the solo scenes (scenes.ts), for a measure of each. */
const SOLO_PARTS = [
  ["idle", 0.3, 2.9], ["pull", 3.2, 7.5], ["cruise", 7.5, 9.5], ["lift", 9.6, 11], ["climb", 13, 14.5], ["air", 14.6, 15.6],
  ["drift0", 16.6, 17.3], ["drift1", 17.4, 18.5], ["drift2", 18.6, 19.7], ["drift3", 19.8, 21], ["release", 21, 22.4],
  ["grass", 23.4, 25], ["sand", 25.1, 26.5], ["nitro", 28.5, 30], ["ice", 32.6, 35], ["mud", 35.2, 36.5], ["snow", 36.7, 38.5],
];

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const label = arg("label", "latest");
const only = arg("only", null)?.split(",");
const OUT = resolve(HERE, "out", label);

const fromBase64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

function parts(left, right, sr) {
  const out = {};
  for (const [name, a, b] of SOLO_PARTS) {
    const from = Math.floor(a * sr), to = Math.floor(b * sr);
    const l = left.subarray(from, to), r = right.subarray(from, to);
    const m = momentary(l, r, sr);
    const s = spectrum(l, r, sr);
    out[name] = { lufs: +Math.max(...m).toFixed(1), centroid: s.centroid, bands: s.bands };
  }
  return out;
}

/** Left-right balance every quarter second, dB (positive: louder on the right). */
function balance(left, right, sr) {
  const w = Math.round(0.25 * sr);
  const out = [];
  for (let s = 0; s + w <= left.length; s += w) {
    let l = 0, r = 0;
    for (let i = s; i < s + w; i++) {
      l += left[i] * left[i];
      r += right[i] * right[i];
    }
    out.push(+(10 * Math.log10((r + 1e-20) / (l + 1e-20))).toFixed(1));
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // No reloads while it renders: an edit to the source mid-run must not navigate a page out from under a render (each
  // run starts its own server, so it serves the source as it was when the run began).
  const server = await createServer({
    root: ROOT,
    server: { port: 4931, strictPort: false, host: "127.0.0.1", hmr: false, watch: { ignored: ["**/*"] } },
    logLevel: "warn",
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
  const summaryFile = `${OUT}/summary.json`;
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, "utf8")) : {};
  try {
    for (const job of JOBS) {
      if (only && !only.includes(job.name)) continue;
      const page = await browser.newPage();
      page.on("pageerror", (e) => console.log(`[${job.name}] pageerror:`, e.message));
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") console.log(`[${job.name}] ${m.type()}:`, m.text().slice(0, 300));
      });
      await page.goto(`${origin}/tools/listen/listen.html`);
      await page.waitForFunction(() => typeof window.renderListen === "function", null, { timeout: 120_000 });
      const t0 = Date.now();
      const r = await page.evaluate((spec) => window.renderListen(spec), job.spec);
      await page.close();
      const left = fromBase64(r.left), right = fromBase64(r.right);
      writeFileSync(`${OUT}/${job.name}.wav`, wav16(left, right, r.sampleRate));
      const a = analyse(left, right, r.sampleRate);
      const entry = {
        ...a,
        frameMs: { mean: +r.frameMs.mean.toFixed(3), p95: +r.frameMs.p95.toFixed(3), worst: +r.frameMs.worst.toFixed(2) },
        renderMs: Math.round(r.renderMs),
        realtime: +(r.seconds * 1000 / r.renderMs).toFixed(1),
        fired: r.fired,
        most: r.most,
        events: r.events,
        shortTerm: shortTerm(left, right, r.sampleRate),
      };
      if (job.name.startsWith("solo")) entry.parts = parts(left, right, r.sampleRate);
      if (job.name === "pass-by" || job.name === "pack") {
        entry.balance = balance(left, right, r.sampleRate);
        entry.momentary = momentary(left, right, r.sampleRate).filter((_, i) => i % 2 === 0);
      }
      summary[job.name] = entry;
      writeFileSync(summaryFile, JSON.stringify(summary, null, 1));
      console.log(
        `${job.name.padEnd(18)} ${a.seconds}s  ${a.lufs} LUFS  short max ${a.shortMax}  LRA ${a.lra}  TP ${a.truePeak} dBTP  centroid ${a.centroid} Hz  ` +
          `width ${a.width} dB  frame ${entry.frameMs.mean} ms (p95 ${entry.frameMs.p95})  fired ${r.fired}  graph ${Math.round(r.renderMs)} ms (${(r.seconds * 1000 / r.renderMs).toFixed(0)}x real time)  ${((Date.now() - t0) / 1000).toFixed(0)} s`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
