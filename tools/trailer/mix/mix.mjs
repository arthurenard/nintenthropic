/**
 * The trailer's mixer: the music, the games' own sounds and a few trailer
 * effects, summed and mastered to about -14 LUFS / under -1 dBTP as AAC.
 *
 *   node tools/trailer/mix/mix.mjs --music tools/trailer/out/music/music.wav --events tools/trailer/out/mix/events.json
 *        --stems tools/trailer/out/mix/stems.json --out tools/trailer/out/mix/master.m4a
 *        [--sfx sfx.json] [--total 40] [--bitrate 256k] [--music-db 0] [--game-db -2] [--sfx-db -2] [--duck 3.5]
 *        [--lufs -14] [--tp -1.15] [--game-wav path] [--hurt] [--no-music] [--seed 20261016] [--origin http://127.0.0.1:4901]
 *
 * --events   a JSON list of game sound events at TRAILER time (the shape of the clips'
 *            events.json, already shifted by the editor), or several files joined with commas:
 *              { t, type: "play" | "loop" | "stop" | "set" | "filter", cue?, options?, id?, clip?, name?, amount? }
 *            Cue names are the games' own (src/audio/cues/*: Finger Guns' revolver_shot, calib_hit...,
 *            Grip Prix's kart_hit, kart_boost_pad, kart_engine_a... ). A file may also be an object
 *            { events: [...], sfx: [...] }. See mix.ts for how loops, stops and "set" steering pair up.
 * --sfx      an optional list of extra one-shot trailer effects (see sfx.mjs for names and what `t` means):
 *              { t, sfx: "whoosh" | "impact" | "hit" | "boom" | "riser" | "downlifter" | "swell" | "tick" | "snap" | "sparkle" | "zap",
 *                dur?, gain? (dB), pan?, size? }
 * --stems   an optional JSON list of pre-rendered stems (the kart game's sound, one WAV per race clip) to lay under the
 *            music like the game cues, with the same ducking and mastering:
 *              { file, at, in?, dur?, gain? (dB, default 0), fade? (s of fade in and out at the cut, default 0.01) }
 *            `file` is any audio ffmpeg reads (made 48 kHz stereo); the slice [in, in + dur] of it (default: from 0 to the end)
 *            is placed at trailer time `at`. Relative paths are relative to where the script is run, else to the list's folder.
 * --game-wav reuse a game stem written by an earlier run (skips the browser).
 *
 * The game sounds are rendered offline by the real engine in headless Chrome started with --mute-audio on
 * an OfflineAudioContext (the dev server at http://127.0.0.1:4901 serves the page; it is never started
 * here). Nothing is ever played. --out names the deliverable; next to it the mixer writes both forms:
 *   <name>.m4a  AAC (256k by default, 48 kHz): what a player decodes, the loudness is measured on THIS (use it with -c:a copy)
 *   <name>.wav  the master before AAC, 32-bit float
 *   <name>-game.wav (the game sounds and stems alone, pre-master), <name>-report.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { FFMPEG, SR, clamp, db, limit, measure, peakOf, readAudio, rmsOf, secs, smoothstep, softClip, toDb, writeWav } from "../music/dsp.mjs";
import { SFX_NAMES, renderSfx } from "./sfx.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const num = (name, fallback) => Number(flag(name, fallback));

const OUT_ARG = resolve(ROOT, flag("out", "tools/trailer/out/mix/master.m4a"));
const BASE = [".m4a", ".wav", ".aac", ".mp4"].includes(extname(OUT_ARG)) ? OUT_ARG.slice(0, -extname(OUT_ARG).length) : OUT_ARG;
const OUT_WAV = `${BASE}.wav`;
const OUT_M4A = `${BASE}.m4a`;
const OUT_DIR = dirname(BASE);
const BITRATE = String(flag("bitrate", "256k"));
const MUSIC = resolve(ROOT, flag("music", "tools/trailer/out/music/music.wav"));
const TOTAL = num("total", 40);
const N = secs(TOTAL);
const ORIGIN = String(flag("origin", "http://127.0.0.1:4901"));
const MUSIC_DB = num("music-db", 0);
const GAME_DB = num("game-db", -2);
const SFX_DB = num("sfx-db", -2);
const DUCK_DB = num("duck", 3.5);
const TARGET_LUFS = num("lufs", -14);
const TARGET_TP = num("tp", -1.15);
const SEED = num("seed", 20261016);
const T0 = Date.now();
const log = (...a) => console.log(`[mix ${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

// --- the input lists -------------------------------------------------------------------------------------------------

function loadLists() {
  const events = [];
  const sfx = [];
  const take = (spec) => {
    for (const file of String(spec).split(",").filter(Boolean)) {
      const data = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
      if (Array.isArray(data)) events.push(...data);
      else {
        events.push(...(data.events ?? []));
        sfx.push(...(data.sfx ?? []));
      }
    }
  };
  const e = flag("events", null);
  if (e && e !== true) take(e);
  const s = flag("sfx", null);
  if (s && s !== true) {
    for (const file of String(s).split(",").filter(Boolean)) {
      const data = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
      sfx.push(...(Array.isArray(data) ? data : data.sfx ?? []));
    }
  }
  // Effects may also sit in the event list as { type: "sfx", sfx: "whoosh", ... }.
  const rest = [];
  for (const ev of events) {
    if (ev.type === "sfx" || (ev.sfx && !ev.cue)) sfx.push(ev);
    else rest.push(ev);
  }
  return { events: rest, sfx };
}

// --- the games' sounds, rendered by the real engine in a muted headless Chrome -----------------------------------------------

async function renderGameStem(events) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    // Never a sound: the browser is muted, and nothing here plays audio.
    args: ["--mute-audio", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.on("pageerror", (e) => console.log("[mix] pageerror:", e.message));
        page.on("console", (m) => {
          if (m.type() === "warning" || m.type() === "error") console.log(`[page ${m.type()}]`, m.text());
        });
        const url = `${ORIGIN}/tools/trailer/mix/mix.html`;
        const response = await page.goto(url);
        if (!response?.ok()) throw new Error(`${url} answered ${response?.status()}: is the dev server running on ${ORIGIN}?`);
        await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
        const spec = { sampleRate: SR, total: TOTAL, seed: SEED, loopFade: 0.3, hurt: argv.includes("--hurt"), events };
        const result = await page.evaluate((s) => window.renderGame(s), spec);
        await context.close();
        const bytes = Buffer.from(result.base64, "base64");
        const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        const n = result.frames;
        const l = new Float32Array(N);
        const r = new Float32Array(N);
        for (let i = 0; i < Math.min(n, N); i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
        return { l, r, report: result.report };
      } catch (error) {
        // The dev server may reload the page once (it optimises dependencies on first use): try again.
        if (attempt >= 3 || !/context was destroyed|navigation|Target closed|Execution context/i.test(String(error))) throw error;
        log("the page reloaded, trying again");
      }
    }
  } finally {
    await browser.close();
  }
}

// --- mixing ---------------------------------------------------------------------------------------------------------------------

/** How far the music should dip around loud game sounds, as a gain per sample (a peak follower with a short look-ahead). */
function duckCurve(keys, { maxDb = DUCK_DB, lo = -32, hi = -10, attack = 0.003, release = 0.16, lookahead = 0.004, protect = [] } = {}) {
  const n = keys[0].length;
  const aA = 1 - Math.exp(-1 / (attack * SR));
  const aR = 1 - Math.exp(-1 / (release * SR));
  const g = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const k of keys) x = Math.max(x, Math.abs(k[i]));
    e += (x > e ? aA : aR) * (x - e);
    // The music's own big moments (drops, the final hit) are mostly left alone: a game sound on them must not soften them.
    const t = i / SR;
    let keep = 1;
    for (const w of protect) if (t >= w.from && t < w.to) keep = 0.25;
    g[i] = db(-maxDb * keep * smoothstep((toDb(e) - lo) / (hi - lo)));
  }
  const la = secs(lookahead);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = g[Math.min(n - 1, i + la)];
  return out;
}

function fadeTail(l, r, from) {
  const f0 = secs(from);
  for (let i = f0; i < l.length; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (l.length - f0));
    l[i] *= g;
    r[i] *= g;
  }
}

function aac(wav, m4a, decoded) {
  const enc = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "aac", "-b:a", BITRATE, "-ar", "48000", "-ac", "2", m4a], { encoding: "utf8" });
  if (enc.status !== 0) throw new Error(`aac encode failed: ${enc.stderr}`);
  const dec = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", m4a, "-c:a", "pcm_f32le", decoded], { encoding: "utf8" });
  if (dec.status !== 0) throw new Error(`aac decode failed: ${dec.stderr}`);
  return measure(decoded);
}

function master(preL, preR) {
  // A gain and a limiter ceiling found by measuring what a player will decode: the AAC file.
  let gain = 0;
  let ceiling = -2.0;
  let best = null;
  const m4a = OUT_M4A;
  const decoded = `${BASE}.decoded.tmp.wav`;
  for (let round = 0; round < 14; round++) {
    const l = Float32Array.from(preL, (v) => v * db(gain));
    const r = Float32Array.from(preR, (v) => v * db(gain));
    softClip(l, 0.8);
    softClip(r, 0.8);
    const gr = limit(l, r, { ceiling: db(ceiling), lookahead: 0.003, release: 0.09 });
    for (let i = 0; i < secs(0.004); i++) { const g = i / secs(0.004); l[i] *= g; r[i] *= g; }
    l[N - 1] = r[N - 1] = 0;
    writeWav(OUT_WAV, l, r);
    const wav = measure(OUT_WAV);
    const m = aac(OUT_WAV, m4a, decoded);
    log(`master round ${round}: gain ${gain.toFixed(2)} dB, ceiling ${ceiling.toFixed(2)} dBFS, limiter ${gr.toFixed(1)} dB -> wav ${wav.lufs} LUFS / ${wav.tp} dBTP; AAC ${m.lufs} LUFS / ${m.tp} dBTP`);
    best = { l, r, wav, aac: m, gain, ceiling, limiter: gr };
    const err = TARGET_LUFS - m.lufs;
    const over = m.tp - TARGET_TP;
    if (Math.abs(err) < 0.12 && over <= 0 && m.tp > TARGET_TP - 0.5) break;
    if (over > 0) ceiling -= over;
    else if (m.tp < TARGET_TP - 0.5) ceiling += (TARGET_TP - 0.25 - m.tp) * 0.8;
    gain += err * 0.95;
  }
  return best;
}

// --- go ---------------------------------------------------------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const { events, sfx } = loadLists();
for (const e of sfx) if (!SFX_NAMES.includes(e.sfx)) throw new Error(`unknown sfx "${e.sfx}" (known: ${SFX_NAMES.join(", ")})`);
log(`${events.length} game events, ${sfx.length} trailer effects, music ${flag("no-music", false) ? "off" : MUSIC}`);

// The music.
let music = { l: new Float32Array(N), r: new Float32Array(N) };
if (!argv.includes("--no-music")) {
  const m = readAudio(MUSIC);
  music = { l: new Float32Array(N), r: new Float32Array(N) };
  music.l.set(m.l.subarray(0, N));
  music.r.set(m.r.subarray(0, N));
  log(`music: ${(m.l.length / SR).toFixed(3)} s`);
}

// The games' sounds.
let game;
const gameWav = flag("game-wav", null);
if (gameWav && gameWav !== true) {
  const g = readAudio(resolve(process.cwd(), gameWav));
  game = { l: new Float32Array(N), r: new Float32Array(N), report: { reused: gameWav } };
  game.l.set(g.l.subarray(0, N));
  game.r.set(g.r.subarray(0, N));
} else if (events.length) {
  game = await renderGameStem(events);
  log(`game sounds: ${JSON.stringify({ ...game.report, cues: undefined })}`);
  if (game.report.unknownCues?.length) console.log(`[mix] WARNING: unknown cues, skipped: ${game.report.unknownCues.join(", ")}`);
} else {
  game = { l: new Float32Array(N), r: new Float32Array(N), report: { events: 0 } };
}

// The pre-rendered stems (the kart game's race audio), slices of WAVs laid at trailer times; they join the game sounds.
const stemReport = [];
{
  const sp = flag("stems", null);
  if (sp && sp !== true) {
    const listPath = resolve(process.cwd(), sp);
    const list = JSON.parse(readFileSync(listPath, "utf8"));
    for (const st of Array.isArray(list) ? list : list.stems ?? []) {
      // Relative to where the script runs, else to the list's own folder.
      const file = existsSync(resolve(process.cwd(), st.file)) ? resolve(process.cwd(), st.file) : resolve(dirname(listPath), st.file);
      if (!existsSync(file)) {
        console.log(`[mix] WARNING: stem not found, skipped: ${st.file}`);
        stemReport.push({ file: st.file, missing: true });
        continue;
      }
      const a = readAudio(file);
      const from = Math.max(0, Math.round((st.in ?? 0) * SR));
      const len = Math.max(0, Math.min(a.l.length - from, st.dur === undefined ? a.l.length - from : Math.round(st.dur * SR)));
      const fade = Math.min(Math.round((st.fade ?? 0.01) * SR), Math.floor(len / 2));
      const g = db(st.gain ?? 0);
      const start = Math.round((st.at ?? 0) * SR);
      let peak = 0;
      for (let i = 0; i < len; i++) {
        const j = start + i;
        if (j < 0 || j >= N) continue;
        // raised-cosine fades at both cuts so a slice never clicks
        let f = 1;
        if (i < fade) f = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
        else if (len - 1 - i < fade) f = 0.5 - 0.5 * Math.cos((Math.PI * (len - 1 - i)) / fade);
        const x = a.l[from + i] * g * f;
        const y = a.r[from + i] * g * f;
        game.l[j] += x;
        game.r[j] += y;
        peak = Math.max(peak, Math.abs(x), Math.abs(y));
      }
      stemReport.push({ file: st.file, at: st.at ?? 0, in: st.in ?? 0, seconds: +(len / SR).toFixed(3), peakDbfs: +toDb(peak).toFixed(1) });
    }
    log(`stems: ${stemReport.length} slices (${stemReport.filter((x) => !x.missing).length} laid)`);
  }
}
writeWav(`${BASE}-game.wav`, game.l, game.r);

// The trailer's own effects.
const fx = { l: new Float32Array(N), r: new Float32Array(N) };
for (const e of sfx) {
  const s = renderSfx(e);
  const g = db(-6 + (e.gain ?? 0) + SFX_DB) / 0.5; // each effect is normalised to 0.5 (-6 dBFS)
  const start = Math.round(s.t0 * SR);
  for (let i = 0; i < s.l.length; i++) {
    const j = start + i;
    if (j < 0 || j >= N) continue;
    fx.l[j] += s.l[i] * g * 0.5;
    fx.r[j] += s.r[i] * g * 0.5;
  }
}
// Effects and games stop with the film: fade their last 1.5 s.
fadeTail(game.l, game.r, TOTAL - 1.5);
fadeTail(fx.l, fx.r, TOTAL - 1.5);

// Sum: the music dips a little under loud game sounds.
let protect = [];
try {
  // cues.json beside the music lists its impacts and drops.
  const cues = JSON.parse(readFileSync(resolve(dirname(MUSIC), "cues.json"), "utf8"));
  protect = (cues.impacts ?? []).filter((c) => c.size !== "small").map((c) => ({ from: c.t - 0.02, to: c.t + 0.45 }));
} catch {
  // no cues file: no protected windows
}
const duck = duckCurve([game.l, game.r, fx.l, fx.r], { protect });
const mg = db(MUSIC_DB);
const gg = db(GAME_DB);
const preL = new Float32Array(N);
const preR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  preL[i] = music.l[i] * mg * duck[i] + game.l[i] * gg + fx.l[i];
  preR[i] = music.r[i] * mg * duck[i] + game.r[i] * gg + fx.r[i];
}
const done = master(preL, preR);

// What the mix did, by analysis: levels of the stems and, at each loud game event, how far it stands above the music.
const stats = {
  musicDb: MUSIC_DB, gameDb: GAME_DB, sfxDb: SFX_DB, duckDb: DUCK_DB,
  masterGainDb: +done.gain.toFixed(2), limiterCeilingDb: +done.ceiling.toFixed(2),
  wav: done.wav, aac: done.aac,
  samplePeakDbfs: +toDb(peakOf(done.l, done.r)).toFixed(2),
  game: game.report,
  stems: stemReport,
  sfx: sfx.map((e) => `${e.sfx}@${e.t}`),
};
writeFileSync(`${BASE}-report.json`, JSON.stringify(stats, null, 2));
spawnSync("rm", ["-f", `${BASE}.decoded.tmp.wav`]);
log(`done: ${OUT_M4A}  AAC ${done.aac.lufs} LUFS, true peak ${done.aac.tp} dBTP  (master before AAC: ${OUT_WAV})`);
void clamp; void existsSync; void rmsOf;
