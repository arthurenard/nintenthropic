// The hand tracker beside a race, as in the game (e2e/trackrace.html): a picture of a hand played at 30 fps and read in
// the tracking worker on the GPU delegate, while the renderer draws a race in the same page. What does the race cost
// the tracker? For each case: camera frames a second, how many the tracker read and how many it had to skip, the
// time in the landmarker (p50 / p95 ms), the delay from the camera capturing a frame to its HandFrame (p50 / p95 ms),
// the share of frames in which a hand was found, the mean score of the hands found, and the race's frames a second.
//
//   npx vite --port 5198 --strictPort
//   node tools/perf/trackrace.mjs                  the standard cases
//   node tools/perf/trackrace.mjs --seats 4        the four-seat cases only (one player: --seats 1)
//   node tools/perf/trackrace.mjs --track canyon-run --seconds 12
//   node tools/perf/trackrace.mjs --seats 1 --viewport 1728x1117@2     a 16-inch MacBook Pro's default window
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "package.json"));
const { chromium } = require("playwright-core");

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.trim().split(/\s+/);
      return [k, v.join(" ") || "1"];
    }),
);
const BASE = args.base ?? "http://127.0.0.1:5198";
const TRACK = args.track ?? "meadow-loop";
const SECONDS = Number(args.seconds ?? 12);
const [vw, vh, vr] = (args.viewport ?? "1440x900@2").split(/[x@]/).map(Number);
const seats = {
  1: "hands=2&copies=1",
  4: "hands=8&tiles=4&confidence=0.4&copies=4",
};
const race = (views, art) => `race=${encodeURIComponent(`track=${TRACK}&sim=1&go=1&views=${views}&quality=${args.quality ?? "high"}${art ? "" : "&art=0"}`)}`;
const CASES = [];
for (const n of args.seats ? [Number(args.seats)] : [1, 4]) {
  CASES.push({ label: `${n} seat${n > 1 ? "s" : ""}, tracker alone`, query: seats[n] });
  for (const views of n === 1 ? [1, 4] : [4]) {
    CASES.push({ label: `${n} seat${n > 1 ? "s" : ""}, racing ${views} view${views > 1 ? "s" : ""}, Blender art`, query: `${seats[n]}&${race(views, true)}` });
    CASES.push({ label: `${n} seat${n > 1 ? "s" : ""}, racing ${views} view${views > 1 ? "s" : ""}, stand-ins`, query: `${seats[n]}&${race(views, false)}` });
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"] });
try {
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vr });
    await ctx.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/e2e/trackrace.html?${c.query}&seconds=${SECONDS}`);
    await page.waitForFunction(() => window.smoke?.done, null, { timeout: 240000 });
    const r = await page.evaluate(() => window.smoke);
    await ctx.close();
    if (r.error) {
      console.log(c.label, "ERROR", r.error.slice(0, 300));
      continue;
    }
    const t = r.tracker;
    console.log(
      `${c.label.padEnd(44)} camera ${r.cameraFps.toFixed(0)}/s read ${r.readsPerSecond.toFixed(1)}/s skipped ${t.skipped} | inference ${t.inference.p50.toFixed(1)}/${t.inference.p95.toFixed(1)} ms | delay ${t.delay.p50.toFixed(0)}/${t.delay.p95.toFixed(0)} ms | found ${(r.detection * 100).toFixed(0)}% of frames, ${r.handsPerFrame.toFixed(2)} hands, score ${r.meanScore.toFixed(2)} | race ${r.race ? r.race.fps.toFixed(0) + " fps" : "-"}`,
    );
  }
} finally {
  await browser.close();
}
