/**
 * Renders a clip's own sound offline (see audio.ts): the views capture.mjs recorded while filming are replayed through
 * Grip Prix's race audio on an OfflineAudioContext inside a muted headless Chrome; nothing is ever played. The result
 * is a 48 kHz stereo float WAV, frame 1 of the clip at sample 0 and exactly frames x 800 samples long.
 *
 *   node tools/trailer/race/audio.mjs --only gp-go,gp-drift      (from the views of the last capture, tools/trailer/out/race-work/<id>/views.json)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CLIPS } from "./plan.mjs";
import { ensureDir, INIT, launch, ORIGIN, OUT } from "./lib.mjs";

const SR = 48000;
const FPS = 60;

/** A WAV file of 32-bit float PCM. */
export function wavFloat(left, right, sampleRate = SR) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 8);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 8, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(left[i], 44 + i * 8);
    buf.writeFloatLE(right[i], 48 + i * 8);
  }
  return buf;
}

const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/** Levels of a stereo buffer: overall RMS and peak (dBFS), the RMS of each half second, clipped samples, the loudest moments. */
export function levels(left, right) {
  const half = SR / 2;
  const rows = [];
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (let s = 0; s < left.length; s += half) {
    let acc = 0;
    let p = 0;
    const end = Math.min(left.length, s + half);
    for (let i = s; i < end; i++) {
      const l = left[i];
      const r = right[i];
      acc += (l * l + r * r) / 2;
      p = Math.max(p, Math.abs(l), Math.abs(r));
      if (Math.abs(l) >= 0.999 || Math.abs(r) >= 0.999) clipped++;
    }
    sum += acc;
    peak = Math.max(peak, p);
    rows.push({ t: s / SR, rms: +db(Math.sqrt(acc / (end - s))).toFixed(1), peak: +db(p).toFixed(1) });
  }
  return { seconds: left.length / SR, rmsDb: +db(Math.sqrt(sum / left.length)).toFixed(1), peakDb: +db(peak).toFixed(1), clipped, perHalfSecond: rows };
}

const fromBase64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

/**
 * @param {import("@playwright/test").Browser} browser
 * @param {object} clip  a plan.mjs clip
 * @param {{viewsFile:string, out:string, frames:number}} o
 */
export async function renderAudio(browser, clip, o) {
  const rec = JSON.parse(readFileSync(o.viewsFile, "utf8"));
  const frames = rec.views.length;
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${clip.id}/audio] pageerror:`, e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[${clip.id}/audio] ${m.type()}:`, m.text().slice(0, 200));
  });
  await page.goto(`${ORIGIN}/tools/trailer/race/audio.html`);
  await page.waitForFunction(() => typeof window.renderRaceAudio === "function", null, { timeout: 60_000 });
  await page.evaluate((s) => window.__seed(s), clip.seed ?? 1851);
  const url = o.viewsFile.slice(o.viewsFile.indexOf("/tools/"));
  const trackId = (clip.query.match(/track=([\w-]+)/) ?? [])[1];
  const theme = clip.theme ?? THEMES[trackId] ?? "meadow";
  const warm = Math.min(clip.audioWarm ?? 90, rec.pre);
  const r = await page.evaluate((spec) => window.renderRaceAudio(spec), { url, theme, trackId, views: clip.views ?? [clip.P?.hero ?? clip.P?.user ?? 0], warm });
  await context.close();
  const l = fromBase64(r.left);
  const rr = fromBase64(r.right);
  const start = r.warm * (SR / FPS);
  const length = frames * (SR / FPS);
  const left = l.slice(start, start + length);
  const right = rr.slice(start, start + length);
  ensureDir(o.out.slice(0, o.out.lastIndexOf("/")));
  writeFileSync(o.out, wavFloat(left, right));
  const lv = levels(left, right);
  console.log(`[${clip.id}] race.wav ${lv.seconds.toFixed(2)} s, rms ${lv.rmsDb} dB, peak ${lv.peakDb} dB, clipped ${lv.clipped}, ${r.fired} sounds started`);
  return { ...lv, sounds: r.fired, warmFrames: r.warm };
}

/** The music theme each track's sounds are made for (the track's own theme). */
const THEMES = {
  "meadow-loop": "meadow",
  "kitchen-rally": "kitchen",
  "harbour-lights": "harbour",
  "canyon-run": "canyon",
  "fun-fair": "funfair",
  "glacier-pass": "snow",
  "volcano-rush": "volcano",
  "starlight-ribbon": "space",
  "five-finger-circuit": "palm",
};

if (process.argv[1]?.endsWith("audio.mjs")) {
  const argv = process.argv.slice(2);
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : CLIPS.map((c) => c.id);
  const browser = await launch();
  try {
    for (const id of only) {
      const clip = CLIPS.find((c) => c.id === id);
      const viewsFile = `${OUT}/race-work/${id}/views.json`;
      if (!clip || !existsSync(viewsFile)) {
        console.log(`[${id}] no clip or no recorded views (run capture.mjs first)`);
        continue;
      }
      await renderAudio(browser, clip, { viewsFile, out: `${OUT}/clips/${id}/race.wav` });
    }
  } finally {
    await browser.close();
  }
}
