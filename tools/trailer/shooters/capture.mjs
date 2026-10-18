/**
 * Captures the trailer's shooter clips (see README.md), in headless Chrome
 * (muted), frame by frame, from the games' own dev harnesses.
 *
 *   node tools/trailer/shooters/capture.mjs                    all eight, 1920x1080 PNGs, to tools/trailer/out/clips/<id>/
 *   node tools/trailer/shooters/capture.mjs --only hn-hero,od-2
 *
 * Tuning (a look, not a delivery):
 *
 *   node tools/trailer/shooters/capture.mjs --only dn-1 --preview [--every 6]   960x540 JPEGs to tools/trailer/out/preview/<id>/
 *        [--pre 3] [--frames 210] [--seed N]   override a take's pre-roll (simulated s), length (frames), seed
 *
 * Notes only: --manifest rewrites shooters.json (the moments) from the events already captured, without capturing.
 *
 * Options: --size WxH (a preview at another size), --concurrency N (clips at once, default 3), --out DIR (default tools/trailer/out/clips).
 * The dev server must be running on port 4901. Never a sound: the browser is muted and nothing is played.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, ORIGIN } from "./browser.mjs";
import { momentsOf } from "./moments.mjs";
import { CLIPS } from "./plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

/**
 * Captures one clip to numbered frames and events.json; returns { events, shots }.
 * @param {import("@playwright/test").Browser} browser
 * @param {typeof CLIPS[number]} clip
 * @param {{out:string, size?:[number,number], every?:number, jpeg?:boolean, log?:boolean, pre?:number, frames?:number, seed?:number,
 *   onFrame?:(page:import("@playwright/test").Page, r:number)=>Promise<void>}} o
 */
export async function captureClip(browser, clip, o) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await captureOnce(browser, clip, o);
    } catch (error) {
      // The dev server may reload the page once while it optimises dependencies or after an edit: try again.
      if (attempt >= 3 || !/context was destroyed|navigation|Target closed/i.test(String(error))) throw error;
      console.log(`[${clip.id}] the page reloaded, trying again`);
    }
  }
}

async function captureOnce(browser, clip, o) {
  const rate = 60 * clip.slow; // simulated steps per second, one per captured frame
  const [w, h] = o.size ?? [1920, 1080];
  const preSim = o.pre ?? clip.pre;
  const pre = Math.round(preSim * rate);
  const frames = o.frames ?? clip.frames;
  const every = o.every ?? 1;
  mkdirSync(o.out, { recursive: true });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${clip.id}] pageerror:`, e.message));
  if (o.log) page.on("console", (m) => console.log(`[${clip.id}]`, m.text()));
  await page.clock.install({ time: 0 });
  const seed = o.seed ?? clip.seed;
  const query = `clip=${clip.id}&w=${w}&h=${h}&dpr=1&manual=1&skipcalib=1&tips=seen&seed=${seed}${clip.query ? `&${clip.query}` : ""}`;
  await page.goto(`${ORIGIN}/tools/trailer/shooters/capture.html?${query}`);
  await page.evaluate(() => window.capture.ready);
  await page.clock.pauseAt(1_000_000);
  await page.evaluate((cfg) => window.capture.init(cfg), { rate, pre, frames });
  const t0 = Date.now();
  let shot = 0;
  for (let a = 0; a < pre + frames; a++) {
    await page.evaluate((n) => window.capture.step(n), a);
    const ms = Math.round(((a + 1) * 1000) / rate) - Math.round((a * 1000) / rate);
    await page.clock.runFor(ms);
    await page.evaluate((n) => window.capture.post(n), a);
    const r = a - pre;
    if (o.onFrame) await o.onFrame(page, r);
    if (r >= 0 && r % every === 0) {
      const name = `${o.out}/${String(r / every + 1).padStart(5, "0")}.${o.jpeg ? "jpg" : "png"}`;
      await page.screenshot(o.jpeg ? { path: name, type: "jpeg", quality: 90 } : { path: name, type: "png" });
      shot++;
    }
    if (o.log && a % 120 === 0) console.log(`[${clip.id}] frame ${a}/${pre + frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const raw = await page.evaluate(() => window.capture.events());
  // Times relative to the clip's first frame; a slow clip's are in PLAYBACK seconds (simulated time x slow).
  const origin = pre / rate;
  const events = raw.map((e) => ({ ...e, t: +((e.t - origin) * clip.slow).toFixed(4) }));
  const shots = (await page.evaluate(() => window.capture.shots())).map((s) => +((s - origin) * clip.slow).toFixed(4));
  const hud = (await page.evaluate(() => window.capture.hud())).map((e) => ({ ...e, t: +((e.t - origin) * clip.slow).toFixed(4) }));
  writeFileSync(`${o.out}/events.json`, JSON.stringify(events));
  // Not a deliverable: the hit markers and floating scores the HUD showed, the moments' raw material.
  writeFileSync(`${o.out}/hud.json`, JSON.stringify(hud));
  await context.close();
  const moments = momentsOf(clip, events, hud, frames / 60);
  console.log(`[${clip.id}] ${shot} frames, ${events.length} audio events, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return { events, shots, hud, moments };
}

/** A contact sheet: every `step`th frame in a grid of `cols` columns. */
function contactSheet(dir, frames, { step = 15, cols = 6, width = 480 } = {}) {
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-y", "-loglevel", "error", "-framerate", "60", "-i", `${dir}/%05d.png`, "-vf", `select='not(mod(n\\,${step}))',scale=${width}:-1,tile=${cols}x${Math.ceil(Math.ceil(frames / step) / cols)}:padding=4:color=black`, "-frames:v", "1", "-update", "1", "-q:v", "3", `${dir}/contact.jpg`],
    { encoding: "utf8" },
  );
  if (r.status !== 0) console.log("contact sheet failed:", r.stderr);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? fallback : (args[i + 1] ?? true);
  };
  const preview = args.includes("--preview");
  const only = flag("only", null)?.split(",") ?? null;
  const todo = CLIPS.filter((c) => !only || only.includes(c.id));
  if (!todo.length) throw new Error(`no such clip: ${only}; they are ${CLIPS.map((c) => c.id).join(", ")}`);
  const outRoot = resolve(ROOT, flag("out", preview ? "tools/trailer/out/preview" : "tools/trailer/out/clips"));
  const concurrency = Number(flag("concurrency", preview ? 4 : 3));
  const results = new Map();
  if (args.includes("--manifest")) {
    // No capture: the moments again, from the events and HUD notes already written.
    for (const clip of todo) {
      const dir = `${outRoot}/${clip.id}`;
      const events = JSON.parse(readFileSync(`${dir}/events.json`, "utf8"));
      const hud = JSON.parse(readFileSync(`${dir}/hud.json`, "utf8"));
      results.set(clip.id, { moments: momentsOf(clip, events, hud, clip.frames / 60) });
    }
  }
  const browser = args.includes("--manifest") ? null : await launch();
  try {
    let next = args.includes("--manifest") ? todo.length : 0;
    const worker = async () => {
      while (next < todo.length) {
        const clip = todo[next++];
        const dir = `${outRoot}/${clip.id}`;
        const res = await captureClip(browser, clip, {
          out: dir,
          size: flag("size", null) ? flag("size").split("x").map(Number) : preview ? [960, 540] : [1920, 1080],
          every: Number(flag("every", preview ? 6 : 1)),
          jpeg: preview,
          pre: flag("pre", null) === null ? undefined : Number(flag("pre")),
          frames: flag("frames", null) === null ? undefined : Number(flag("frames")),
          seed: flag("seed", null) === null ? undefined : Number(flag("seed")),
        });
        results.set(clip.id, res);
        if (!preview) contactSheet(dir, clip.frames);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  } finally {
    await browser?.close();
  }
  if (preview) return;
  // The manifest: the clips just captured replace their entries; the others (an --only run) are kept.
  const path = `${outRoot}/shooters.json`;
  let manifest = [];
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // none yet
  }
  for (const clip of todo) {
    const entry = {
      id: clip.id,
      game: clip.game,
      frames: clip.frames,
      fps: 60,
      slow: clip.slow,
      w: 1920,
      h: 1080,
      what: clip.what,
      moments: results.get(clip.id).moments,
    };
    const at = manifest.findIndex((m) => m.id === clip.id);
    if (at >= 0) manifest[at] = entry;
    else manifest.push(entry);
  }
  manifest.sort((a, b) => CLIPS.findIndex((c) => c.id === a.id) - CLIPS.findIndex((c) => c.id === b.id));
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${path}`);
}

if (process.argv[1] && process.argv[1].endsWith("capture.mjs")) await main();
