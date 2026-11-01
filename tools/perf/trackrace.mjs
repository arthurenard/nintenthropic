// The hand tracker beside a race, as in the game (e2e/trackrace.html): a picture of players' hands played at 30 fps and
// read by the tracker, while the renderer draws a race in the same page, one view per player. What does the race cost
// the tracker? For each case: camera frames a second, how often each player's column was read and how many due frames
// were dropped, the time in the landmarker (p50 / p95 ms), the delay from the camera capturing a frame to its HandFrame
// (p50 / p95 ms), the hands found per frame and their mean score, the race's frames a second, and (after) the race's
// resolution ceiling and the delegates the workers ended on, the page thread's CPU time a second (the browser's ThreadTime,
// which a busy machine does not stretch the way it stretches milliseconds) and the garbage it makes (growth of the JS heap a
// second), and any VideoFrame garbage collected without being closed (a leak).
//
// "before" is the tracker as Grip Prix ran it before the lanes: one worker, the whole picture for one or two players,
// a tile per player read one after another for three or four. "after" is how it runs now (src/kart/app/camera.ts): a
// tile and a worker per player from two players up (lanes=GPU,CPU,...), a slow worker trying the other delegate
// (adapt=1), and the race giving up pixels while the tracker drops frames (first=1, app/handsFirst.ts). Rounds alternate
// the two, which is the only fair way on a busy machine, and the medians are printed at the end.
//
//   npx vite --port 5198 --strictPort
//   node tools/perf/trackrace.mjs                        1 to 4 seats, before and after, one round
//   node tools/perf/trackrace.mjs --seats 3 --rounds 3
//   node tools/perf/trackrace.mjs --alone                the tracker without a race too
//   node tools/perf/trackrace.mjs --track canyon-run --seconds 12 --quality medium --viewport 1728x1117@2
//   node tools/perf/trackrace.mjs --soft --seats 1,2 --viewport 960x540@1 --quality low    a software GPU
//   node tools/perf/trackrace.mjs --wheels               with the players' wheel readers and corner pictures drawn beside the race
//   node tools/perf/trackrace.mjs --bases http://127.0.0.1:5198,http://127.0.0.1:5199 --rounds 3 --after
//                                                        two checkouts' dev servers, alternating, medians; --after: only how the game reads them now
//
// The picture: one hand photo per player for one or two (copies=N, found in every frame), two fists per player for three
// or four (players=N, e2e/crowd.js, about two thirds of them found: a column then looks for its missing hand on every
// frame, the dearer case). Always headless and muted.
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
const BASES = String(args.bases ?? args.base ?? "http://127.0.0.1:5198").split(",");
const TRACK = args.track ?? "meadow-loop";
const SECONDS = Number(args.seconds ?? 10);
const ROUNDS = Number(args.rounds ?? 1);
const [vw, vh, vr] = (args.viewport ?? "1440x900@2").split(/[x@]/).map(Number);

const PICTURE = { 1: "copies=1", 2: "copies=2", 3: "players=3&fist=0.12", 4: "players=4&fist=0.1" };
const BEFORE = { 1: "hands=2", 2: "hands=4", 3: "hands=6&tiles=3&confidence=0.4", 4: "hands=8&tiles=4&confidence=0.4" };
const lanes = (n) => Array.from({ length: n }, (_, i) => (i ? "CPU" : "GPU")).join(",");
const AFTER = {
  1: "hands=2&adapt=1&first=1",
  2: `hands=4&tiles=2&lanes=${lanes(2)}&adapt=1&first=1`,
  3: `hands=6&tiles=3&confidence=0.4&lanes=${lanes(3)}&adapt=1&first=1`,
  4: `hands=8&tiles=4&confidence=0.4&lanes=${lanes(4)}&adapt=1&first=1`,
};
const race = (views) => `race=${encodeURIComponent(`track=${TRACK}&sim=1&go=1&views=${views}&quality=${args.quality ?? "high"}`)}`;

const CASES = [];
for (const n of args.seats ? String(args.seats).split(",").map(Number) : [1, 2, 3, 4]) {
  for (const [label, config] of [
    ["before", BEFORE[n]],
    ["after", AFTER[n]],
  ]) {
    if (args.after && label === "before") continue;
    const wheels = args.wheels ? `&wheels=${n}` : "";
    if (args.alone) CASES.push({ key: `${n} seat${n > 1 ? "s" : ""}, alone, ${label}`, query: `${PICTURE[n]}&${config}${wheels}` });
    CASES.push({ key: `${n} seat${n > 1 ? "s" : ""}, ${n} view${n > 1 ? "s" : ""}, ${label}`, query: `${PICTURE[n]}&${config}&${race(n)}${wheels}` });
  }
}

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN;
};
const results = new Map();
// --soft: a software GPU (SwiftShader), a stand-in for a laptop whose graphics are weak: everything the GPU does costs CPU.
const GPU = args.soft ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({ channel: "chrome", headless: true, args: [...GPU, "--mute-audio"] });
try {
  for (let round = 0; round < ROUNDS; round++) {
    for (const c of CASES) {
      for (const [b, base] of BASES.entries()) {
        const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vr });
        await ctx.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
        const page = await ctx.newPage();
        let leaks = 0;
        const watch = (message) => {
          if (/VideoFrame/i.test(message.text()) && /garbage|closed/i.test(message.text())) leaks++;
        };
        page.on("console", watch);
        page.on("worker", (worker) => worker.on("console", watch));
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Performance.enable");
        const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
        await page.goto(`${base}/e2e/trackrace.html?${c.query}&seconds=${SECONDS}`);
        // The page says when it begins to measure (after the shaders are built and the race has settled), and when it is done.
        await page.waitForFunction(() => window.smoke?.began || window.smoke?.error, null, { timeout: 240000 });
        const m0 = await metrics();
        await page.waitForFunction(() => window.smoke?.done, null, { timeout: 240000 });
        const m1 = await metrics();
        const r = await page.evaluate(() => window.smoke);
        await ctx.close();
        if (r.error) {
          console.log(c.key, "ERROR", r.error.slice(0, 300));
          continue;
        }
        const seconds = m1.Timestamp - m0.Timestamp;
        const t = r.tracker;
        const columns = r.columns ?? 1;
        const row = {
          reads: r.readsPerSecond / columns,
          skipped: t.skipped,
          inference: t.inference.p50,
          delay: t.delay.p50,
          delay95: t.delay.p95,
          hands: r.handsPerFrame,
          race: r.race ? r.race.fps : NaN,
          ceiling: r.ceiling ?? NaN,
          cpu: (1000 * (m1.ThreadTime - m0.ThreadTime)) / seconds,
          garbage: (m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1024 / seconds,
          leaks,
        };
        const key = `${c.key}${BASES.length > 1 ? ` [${b}]` : ""}`;
        if (!results.has(key)) results.set(key, []);
        results.get(key).push(row);
        console.log(
          `${key.padEnd(34)} camera ${r.cameraFps.toFixed(0)}/s, each column read ${row.reads.toFixed(1)}/s, ${t.skipped} dropped | inference ${t.inference.p50.toFixed(1)}/${t.inference.p95.toFixed(1)} ms | delay ${t.delay.p50.toFixed(0)}/${t.delay.p95.toFixed(0)} ms | ${r.handsPerFrame.toFixed(2)} hands, score ${r.meanScore.toFixed(2)} | race ${r.race ? r.race.fps.toFixed(0) + " fps" : "-"}${r.ceiling != null ? ` | ceiling ${r.ceiling}` : ""} | ${r.delegateEnd ?? r.delegate} | page thread ${row.cpu.toFixed(0)} ms CPU/s, ${row.garbage.toFixed(0)} KB heap/s | unclosed frames ${leaks}`,
        );
      }
    }
  }
} finally {
  await browser.close();
}
if (ROUNDS > 1) {
  console.log(`\nmedians of ${ROUNDS} rounds`);
  for (const [key, rows] of results) {
    const m = (k) => median(rows.map((row) => row[k]));
    console.log(`${key.padEnd(34)} each column read ${m("reads").toFixed(1)}/s | inference ${m("inference").toFixed(1)} ms | delay ${m("delay").toFixed(0)} ms (p95 ${m("delay95").toFixed(0)}) | ${m("hands").toFixed(2)} hands | race ${m("race").toFixed(0)} fps${Number.isFinite(m("ceiling")) ? ` | ceiling ${m("ceiling")}` : ""} | page thread ${m("cpu").toFixed(0)} ms CPU/s, ${m("garbage").toFixed(0)} KB heap/s | unclosed frames ${rows.reduce((sum, row) => sum + row.leaks, 0)}`);
  }
}
