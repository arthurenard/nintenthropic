/**
 * Renders the Handheld promo video end to end (see README.md):
 *
 *   node tools/promo/render.mjs                    everything, at 1920x1080 and 60 fps
 *   node tools/promo/render.mjs --only western     just re-capture one segment (then audio and video again)
 *   node tools/promo/render.mjs --stage video      only the last step (frames and mix already there)
 *   node tools/promo/render.mjs --preview          a quick look: 960x540 at 30 fps
 *
 * Stages: frames (headless Chrome steps each scene frame by frame), audio (an
 * OfflineAudioContext mixes the games' own cues at the times they were asked
 * for), video (ffmpeg cross-fades the scenes, normalises loudness and encodes).
 * Nothing is ever played: the browser is muted and there is no playback tool.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureScene, launch, ORIGIN } from "./frames.mjs";
import { FPS as DEFAULT_FPS, SEGMENTS, XFADE, cardSounds, layout, music } from "./timeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? true);
};
const preview = args.includes("--preview");
const fps = Number(flag("fps", preview ? 30 : DEFAULT_FPS));
const [W, H] = preview ? [960, 540] : [1920, 1080];
const OUT = resolve(ROOT, flag("out", "tools/promo/out"));
const only = flag("only", null)?.split(",") ?? null;
const stage = flag("stage", "all");
const concurrency = Number(flag("concurrency", 4));
const want = (name) => stage === "all" || stage === name;

mkdirSync(OUT, { recursive: true });
const { starts, total } = layout();
const segIndex = (id) => SEGMENTS.findIndex((s) => s.id === id);

/** Runs ffmpeg; exit codes are always checked. */
function ffmpeg(argv, { capture = false } = {}) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...argv], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (exit ${r.status}): ${(r.stderr ?? "").split("\n").slice(-12).join("\n")}`);
  return capture ? r.stderr : "";
}

/** The dev server on port 4901, started here if nothing answers there. */
async function ensureServer() {
  const up = async () => {
    try {
      return (await fetch(`${ORIGIN}/tools/promo/capture.html`)).ok;
    } catch {
      return false;
    }
  };
  if (await up()) return () => {};
  const child = spawn("npx", ["vite", "--port", "4901", "--strictPort"], { cwd: ROOT, stdio: "ignore", detached: false });
  for (let i = 0; i < 100; i++) {
    if (await up()) return () => child.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error("the dev server did not start on port 4901");
}

async function frames(browser) {
  const todo = SEGMENTS.filter((s) => !only || only.includes(s.id));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const s = todo[next++];
      await captureScene(browser, {
        scene: s.scene,
        seed: s.seed,
        pre: s.pre ?? 0,
        dur: s.dur,
        fps,
        out: `${OUT}/frames/${s.id}`,
        size: [W, H],
        caption: s.caption,
        fadeIn: s.fadeIn ?? 0,
        fadeOut: s.fadeOut ?? 0,
        pip: s.pip ?? true,
        jpeg: preview,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}

/** The dev server may reload a page once (after an edit, or while it optimises dependencies): try again. */
async function retry(what, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 3 || !/context was destroyed|navigation|Target closed/i.test(String(error))) throw error;
      console.log(`[${what}] the page reloaded, trying again`);
    }
  }
}

async function audio(browser) {
  const spec = {
    sampleRate: 48000,
    total,
    fade: XFADE,
    seed: 20260930,
    segments: SEGMENTS.map((s, i) => {
      const file = `${OUT}/frames/${s.id}/events.json`;
      return { id: s.id, start: starts[i], dur: s.dur, events: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [] };
    }),
    extras: cardSounds(starts),
    music: music(starts, total),
  };
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => console.log("[audio] pageerror:", e.message));
  await page.goto(`${ORIGIN}/tools/promo/audio.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  const t0 = Date.now();
  const result = await page.evaluate((s) => window.mixAudio(s), spec);
  console.log(`[audio] mixed in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${result.report.join("; ")}`);
  writeFileSync(`${OUT}/mix.f32`, Buffer.from(result.base64, "base64"));
  ffmpeg(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", `${OUT}/mix.f32`, "-c:a", "pcm_f32le", `${OUT}/mix.wav`]);
  await page.context().close();
}

/** Integrated loudness (LUFS) and true peak (dBTP) of an audio file, as ffmpeg's ebur128 reads it. */
function measure(file) {
  const log = ffmpeg(["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true });
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const number = (pattern) => Number(pattern.exec(summary)[1]);
  return { i: number(/I:\s+(-?[\d.]+) LUFS/), tp: number(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/**
 * The master: the mix with a gain and a limiter, encoded to AAC, found by
 * measuring what a player will decode: about -14 LUFS integrated and a true
 * peak under -1 dBTP. The games' shots are far louder than their beds, so the
 * limiter does real work, and AAC adds an overshoot of its own that the
 * limiter's ceiling has to leave room for.
 */
function masterAudio() {
  let gain = 9;
  let ceiling = 0.72;
  for (let round = 0; round < 8; round++) {
    const chain = `volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling.toFixed(3)}:attack=5:release=80:level=disabled,aresample=48000`;
    ffmpeg(["-i", `${OUT}/mix.wav`, "-af", chain, "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", `${OUT}/audio.m4a`]);
    ffmpeg(["-i", `${OUT}/audio.m4a`, "-c:a", "pcm_f32le", `${OUT}/decoded.wav`]);
    const m = measure(`${OUT}/decoded.wav`);
    console.log(`[audio] gain ${gain.toFixed(2)} dB, ceiling ${ceiling.toFixed(3)}: ${m.i} LUFS, true peak ${m.tp} dBTP`);
    const loudnessError = -14 - m.i;
    const over = m.tp - -1.2;
    if (Math.abs(loudnessError) < 0.12 && over <= 0) return;
    if (over > 0) ceiling *= Math.pow(10, -over / 20);
    gain += loudnessError * 1.05;
  }
  throw new Error("could not reach -14 LUFS under -1 dBTP");
}

function video() {
  masterAudio();
  const ext = preview ? "jpg" : "png";
  const inputs = SEGMENTS.flatMap((s) => ["-framerate", String(fps), "-i", `${OUT}/frames/${s.id}/%05d.${ext}`]);
  const yuv = "scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p,setsar=1,fps=" + fps;
  const parts = SEGMENTS.map((_, i) => `[${i}:v]${yuv}[v${i}]`);
  let last = "v0";
  for (let i = 1; i < SEGMENTS.length; i++) {
    parts.push(`[${last}][v${i}]xfade=transition=${SEGMENTS[i].transition ?? "fade"}:duration=${XFADE}:offset=${starts[i].toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  const audioIndex = SEGMENTS.length;
  const finalPath = `${OUT}/handheld-promo.mp4`;
  ffmpeg([
    ...inputs,
    "-i", `${OUT}/audio.m4a`,
    "-filter_complex", parts.join(";"),
    "-map", `[${last}]`, "-map", `${audioIndex}:a`,
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", preview ? "veryfast" : "slow", "-crf", preview ? "23" : "16", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-r", String(fps), "-g", String(fps * 2),
    "-c:a", "copy",
    "-movflags", "+faststart",
    finalPath,
  ]);
  // A poster (the title card, fully in) and a contact sheet, one frame a second.
  ffmpeg(["-ss", (starts[segIndex("title")] + 1.9).toFixed(2), "-i", finalPath, "-frames:v", "1", "-q:v", "2", `${OUT}/handheld-promo-poster.jpg`]);
  ffmpeg(["-i", finalPath, "-vf", `fps=1,scale=320:180,tile=8x${Math.ceil(total / 8)}`, "-frames:v", "1", "-q:v", "3", `${OUT}/contact.jpg`]);
  writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ fps, total, segments: SEGMENTS.map((s, i) => ({ id: s.id, start: starts[i], dur: s.dur })) }, null, 1));
  console.log(`[video] ${finalPath}`);
}

const stopServer = await ensureServer();
try {
  if (want("frames") || want("audio")) {
    const browser = await launch();
    try {
      if (want("frames")) await frames(browser);
      if (want("audio")) await retry("audio", () => audio(browser));
    } finally {
      await browser.close();
    }
  }
  if (want("video")) video();
} finally {
  stopServer();
}
