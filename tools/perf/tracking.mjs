// Measures the hand tracker the way Grip Prix runs it for 1 to 4 players on one camera (src/tracking/, e2e/tracker.html):
// a picture of a hand played as a 30 fps video, read by the tracker in its worker on the GPU delegate, with the page's
// own frame intervals measured beside it. One player reads the whole picture for two hands; three or four are cut into
// one tile per player (tiles.ts), each with its own landmarker, which is what costs.
//
//   npx vite --port 5198 --strictPort            (the dev server serves e2e/tracker.html)
//   node tools/perf/tracking.mjs                              1, 2, 3 and 4 players, every seat with a hand
//   node tools/perf/tracking.mjs --empty                      also: 4 seats, only 2 hands (the other tiles empty)
//   node tools/perf/tracking.mjs --base http://127.0.0.1:5198
//
// Prints, per case: inference p50/p95 (ms per camera frame, in the worker), camera frames read and skipped (the worker
// was still busy), the delay from the camera capturing a frame to its HandFrame, the page thread's cost per frame, and
// the page's own frame interval p50/p95 (does tracking steal the game's frames?).
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

const CASES = [
  { label: "1 player  (2 hands, whole picture)", query: "hands=2" },
  { label: "2 players (4 hands, whole picture)", query: "hands=4&copies=2" },
  { label: "3 players (6 hands, 3 tiles)", query: "hands=6&tiles=3&confidence=0.4&copies=3" },
  { label: "4 players (8 hands, 4 tiles)", query: "hands=8&tiles=4&confidence=0.4&copies=4" },
];
if (args.empty) {
  CASES.push({ label: "4 seats, 2 hands up (8 hands, 4 tiles, 2 empty)", query: "hands=8&tiles=4&confidence=0.4&copies=2&slots=4" });
  CASES.push({ label: "3 seats, 2 hands up (6 hands, 3 tiles, 1 empty)", query: "hands=6&tiles=3&confidence=0.4&copies=2&slots=3" });
  CASES.push({ label: "4 seats, 3 hands up (8 hands, 4 tiles, 1 empty)", query: "hands=8&tiles=4&confidence=0.4&copies=3&slots=4" });
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"],
});
try {
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/e2e/tracker.html?${c.query}`);
    await page.waitForFunction(() => window.smoke?.done, null, { timeout: 120000 });
    const r = await page.evaluate(() => window.smoke);
    await ctx.close();
    if (r.error) {
      console.log(c.label, "ERROR", r.error.slice(0, 300));
      continue;
    }
    const t = r.tracker;
    console.log(
      `${c.label.padEnd(56)} ${r.delegate}/${r.where} | inference p50 ${t.inference.p50?.toFixed(1)} p95 ${t.inference.p95?.toFixed(1)} ms | read ${t.frames} skipped ${t.skipped} (${r.fps.toFixed(1)} reads/s) | delay p50 ${t.delay.p50?.toFixed(0)} p95 ${t.delay.p95?.toFixed(0)} ms | page cost p50 ${t.pageCost.p50?.toFixed(2)} ms | page frames p50 ${r.frames.p50.toFixed(1)} p95 ${r.frames.p95.toFixed(1)} ms | hands/frame ${r.handsPerFrame?.toFixed(2)}`,
    );
  }
} finally {
  await browser.close();
}
