/**
 * Films the trailer's Grip Prix clips (see README.md): the real sim on the renderer's dev page in headless, muted Chrome,
 * stepped one video frame at a time, 1920x1080 PNGs at 60 fps; each clip's own sound rendered offline to a WAV; a contact
 * sheet; and clips/race.json, the manifest the edit reads.
 *
 *   node tools/trailer/race/capture.mjs                        all clips
 *   node tools/trailer/race/capture.mjs --only gp-go,gp-four   some (the others stay as they are in race.json)
 *   options: --no-audio  --no-frames (audio and manifest again from the last capture's views)  --dsf 1 (draw at 1x: quicker, less smooth)
 *            --concurrency N (clips at once, default 2)  --out DIR (default tools/trailer/out/clips)
 *
 * The dev server must be running on port 4901 (it is shared: never start or stop it from here). Never a sound is played.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { FFMPEG, HERE, launch, OUT } from "./lib.mjs";
import { CLIPS } from "./plan.mjs";
import { shoot } from "./shoot.mjs";
import { renderAudio } from "./audio.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, d) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : d);
const only = value("only", null)?.split(",");
const dsf = Number(value("dsf", 2));
const concurrency = Number(value("concurrency", 2));
const clipsDir = value("out", `${OUT}/clips`);
const clips = CLIPS.filter((c) => !only || only.includes(c.id));
if (only) for (const id of only) if (!CLIPS.some((c) => c.id === id)) throw new Error(`no clip "${id}"; ids: ${CLIPS.map((c) => c.id).join(", ")}`);

/** The time (seconds into the clip) of the frame each moment of the plan falls on. */
export function momentsOf(clip, views) {
  const out = [];
  for (const m of clip.moments ?? []) {
    if (m.t !== undefined) {
      out.push({ t: m.t, what: m.what });
      continue;
    }
    const { event, nth = 0, what, offset = 0, ...match } = m;
    let seen = 0;
    let found = null;
    for (let f = 0; f < views.length && !found; f++) {
      for (const e of views[f].events) {
        if (e.type !== event) continue;
        if (!Object.entries(match).every(([k, v]) => e[k] === v)) continue;
        if (seen++ === nth) {
          found = f;
          break;
        }
      }
    }
    if (found === null) console.log(`[${clip.id}] moment not found: ${what} (${event} ${JSON.stringify(match)})`);
    else out.push({ t: +((found + offset) / 60).toFixed(3), what });
  }
  return out.sort((a, b) => a.t - b.t);
}

function contactSheet(dir, frames) {
  const every = 15;
  const shown = Math.ceil(frames / every);
  const cols = 6;
  const rows = Math.ceil(shown / cols);
  const r = spawnSync(FFMPEG, ["-y", "-v", "error", "-framerate", "60", "-i", `${dir}/%05d.png`, "-vf", `select='not(mod(n\\,${every}))',scale=480:-1,tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "3", `${dir}/contact.jpg`]);
  if (r.status !== 0) console.log(`[contact] ffmpeg: ${r.stderr}`);
}

function qa(dir) {
  const r = spawnSync("python3", ["-I", `${HERE}/darkcheck.py`, dir, "10"], { encoding: "utf8" });
  return r.stdout.trim().split("\n").slice(-6).join("\n");
}

/** The shared dev server may reload a page under us (it re-optimises dependencies when a page imports something new): try again. */
async function retry(label, fn, times = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= times) throw error;
      console.log(`[${label}] failed (${String(error).slice(0, 120)}), trying again`);
    }
  }
}

/** One clip in a browser of its own (a browser that was closed or killed under us costs only this clip's attempt). */
async function one(clip) {
  const dir = `${clipsDir}/${clip.id}`;
  const viewsFile = `${OUT}/race-work/${clip.id}/views.json`;
  let frames;
  if (!flag("no-frames")) {
    rmSync(dir, { recursive: true, force: true });
    const r = await retry(`${clip.id}/frames`, async () => {
      rmSync(dir, { recursive: true, force: true });
      const browser = await launch();
      try {
        return await shoot(browser, clip, { out: dir, size: [1920, 1080], dsf, viewsOut: viewsFile });
      } finally {
        await browser.close().catch(() => {});
      }
    });
    frames = r.shots;
    if (r.bad.length) console.log(`[${clip.id}] WARNING: network problems: ${r.bad.join(" | ")}`);
  } else {
    frames = JSON.parse(readFileSync(viewsFile, "utf8")).views.length;
  }
  let audio = null;
  if (!flag("no-audio")) {
    audio = await retry(`${clip.id}/audio`, async () => {
      const browser = await launch();
      try {
        return await renderAudio(browser, clip, { viewsFile, out: `${dir}/race.wav` });
      } finally {
        await browser.close().catch(() => {});
      }
    });
  }
  const views = JSON.parse(readFileSync(viewsFile, "utf8")).views;
  const moments = momentsOf(clip, views);
  if (!flag("no-frames")) {
    contactSheet(dir, frames);
    console.log(`[${clip.id}] QA (dark or repeated frames):\n${qa(dir)}`);
  }
  return {
    id: clip.id,
    game: "grip-prix",
    frames,
    fps: 60,
    slow: 1,
    w: 1920,
    h: 1080,
    what: clip.what,
    moments,
    ...(audio ? { audio: `${clip.id}/race.wav`, audioStats: { rmsDb: audio.rmsDb, peakDb: audio.peakDb, clipped: audio.clipped } } : {}),
  };
}

mkdirSync(clipsDir, { recursive: true });
const results = new Map();
const queue = [...clips];
const worker = async () => {
  for (let clip = queue.shift(); clip; clip = queue.shift()) results.set(clip.id, await one(clip));
};
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

// race.json keeps the clips this run did not touch.
const file = `${clipsDir}/race.json`;
const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const merged = CLIPS.map((c) => results.get(c.id) ?? old.find((o) => o.id === c.id)).filter(Boolean);
writeFileSync(file, JSON.stringify(merged, null, 2));
console.log(`wrote ${file}: ${merged.map((m) => `${m.id} (${m.frames})`).join(", ")}`);
