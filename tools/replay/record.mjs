// Replays a recorded webcam video through Grip Prix's REAL hand tracker (the wheel check page, src/kart/input/dev.html)
// in headless Chrome, and saves what the tracker saw, frame by frame, as a fixture the unit tests can replay.
// No sound is ever made (headless, --mute-audio, and the page plays none).
//
//   npx vite --port 5197 --strictPort &            (the dev server)
//   node tools/replay/record.mjs --video /path/moves.mov --out src/kart/input/fixtures/moves.json [--base http://127.0.0.1:5197]
//
// What is kept for every camera answer: when it was captured (seconds from the loop's start), the video's own time
// (found by matching each camera frame's picture to the source frames), and for each hand its handedness, score and the
// few landmarks the wheel reads (image points 0 5 9 13 17, world points 0 6 8 10 12 14 16 18 20), to 4 places.
// The video loops in Chrome; the first loop is the cold start, so the second full loop is the one kept.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, f) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? f : process.argv[i + 1]; };
const video = resolve(arg("video", "moves.mov"));
const out = resolve(arg("out", join(ROOT, "src/kart/input/fixtures/moves.json")));
const base = arg("base", "http://127.0.0.1:5197");
const FPS = 30, SIG = 384;
const work = mkdtempSync(join(tmpdir(), "replay-"));

// 1. The video as 960x640 y4m for Chrome, and its 24x16 gray signatures to find our place in it.
const y4m = join(work, "video.y4m");
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] }); if (r.status !== 0) throw new Error(`${cmd} failed`); };
run("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `fps=${FPS},scale=960:640`, "-pix_fmt", "yuv420p", y4m]);
const sigPath = join(work, "sig.gray");
run("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `fps=${FPS},scale=24:16`, "-pix_fmt", "gray", "-f", "rawvideo", sigPath]);
const refBytes = readFileSync(sigPath);
const NREF = Math.floor(refBytes.length / SIG);
const duration = NREF / FPS;

// 2. Chrome with the video as the camera.
const { chromium } = createRequire(join(ROOT, "package.json"))("@playwright/test");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
let data;
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera"] })).newPage();
  await page.goto(`${base}/src/kart/input/dev.html`);
  await page.waitForFunction(() => window.__wheelDev?.tracker && window.__wheelDev.players.length > 0, null, { timeout: 180_000 });
  await page.evaluate(() => {
    const tracker = window.__wheelDev.tracker;
    const video = document.getElementById("camera");
    const canvas = document.createElement("canvas");
    canvas.width = 24; canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const cams = [], rows = [];
    const onVideo = (now, md) => {
      ctx.drawImage(video, 0, 0, 24, 16);
      const d = ctx.getImageData(0, 0, 24, 16).data;
      const sig = new Array(384);
      for (let i = 0; i < 384; i++) sig[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
      cams.push({ cap: md.captureTime ?? md.presentationTime ?? now, sig });
      video.requestVideoFrameCallback(onVideo);
    };
    video.requestVideoFrameCallback(onVideo);
    const r = (v) => Math.round(v * 10000) / 10000;
    const IMG = [0, 5, 9, 13, 17], WORLD = [0, 6, 8, 10, 12, 14, 16, 18, 20];
    tracker.subscribe((frame) => {
      rows.push({
        cap: frame.capturedAt, pub: performance.now(),
        hands: frame.hands.map((h) => ({
          h: h.handedness, s: r(h.score),
          lm: IMG.map((i) => [r(h.landmarks[i].x), r(h.landmarks[i].y), r(h.landmarks[i].z)]),
          w: WORLD.map((i) => [r(h.world[i].x), r(h.world[i].y), r(h.world[i].z)]),
        })),
      });
    });
    window.__rec = { cams, rows };
  });
  const seconds = duration * 3 + 8;
  console.log(`[record] ${duration.toFixed(1)} s video, recording ${seconds.toFixed(0)} s`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  data = await page.evaluate(() => window.__rec);
} finally {
  await browser.close();
}

// 3. Which source frame is each camera frame? Global offset from the first 240, then refined within +-4.
const z = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; let n = 0; const o = a.map((v) => { n += (v - m) ** 2; return v - m; }); n = Math.sqrt(n) || 1; return o.map((v) => v / n); };
const refs = Array.from({ length: NREF }, (_, i) => z(Array.from(refBytes.subarray(i * SIG, (i + 1) * SIG))));
const corr = (a, b) => { let s = 0; for (let i = 0; i < SIG; i++) s += a[i] * b[i]; return s; };
const cams = data.cams.map((c) => ({ cap: c.cap, z: z(c.sig) }));
const frameNo = (k) => Math.round((cams[k].cap - cams[0].cap) / (1000 / FPS));
let best = { o: 0, s: -1 };
for (let o = 0; o < NREF; o++) {
  let s = 0;
  for (let k = 0; k < Math.min(240, cams.length); k += 3) s += corr(cams[k].z, refs[(o + frameNo(k)) % NREF]);
  if (s > best.s) best = { o, s };
}
const idx = cams.map((c, k) => {
  const e = best.o + frameNo(k);
  let b = { i: 0, s: -2 };
  for (let d = -4; d <= 4; d++) { const i = (((e + d) % NREF) + NREF) % NREF; const s = corr(c.z, refs[i]); if (s > b.s) b = { i, s }; }
  return b.i;
});
const pass = []; let p = 0;
idx.forEach((v, k) => { if (k > 0 && v < idx[k - 1] - NREF / 2) p++; pass.push(p); });
// The camera frame (and so the answer) nearest each answer's capture time.
const nearest = (cap) => { let bi = 0, bd = Infinity; cams.forEach((c, k) => { const d = Math.abs(c.cap - cap); if (d < bd) { bd = d; bi = k; } }); return bd < 20 ? bi : -1; };
const wanted = Math.max(...pass) >= 2 ? 2 : Math.max(...pass);
const kept = [];
for (const row of data.rows) {
  const k = nearest(row.cap);
  if (k < 0 || pass[k] !== wanted) continue;
  kept.push({ k, row });
}
if (!kept.length) throw new Error("no answers matched a full loop");
const startCap = cams[kept[0].k].cap - (idx[kept[0].k] / FPS) * 1000;
const frames = kept.map(({ k, row }) => ({
  t: Math.round((row.cap - startCap)) / 1000, // seconds, the video's clock
  delay: Math.round((row.pub - row.cap) * 10) / 10, // ms from capture to the tracker's answer
  hands: row.hands,
}));
writeFileSync(out, JSON.stringify({ video: video.split("/").pop(), fps: FPS, duration, frames }) + "\n");
console.log(`[record] ${frames.length} answers over ${frames.at(-1).t.toFixed(2)} s -> ${out}`);
