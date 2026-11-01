// Measures the hand tracker the way Grip Prix runs it for 1 to 4 players on one camera (src/tracking/, e2e/tracker.html):
// a picture of hands played as a 30 fps video, read by the tracker on the GPU delegate, with the page's own frame
// intervals measured beside it. "before" is one worker: the whole picture for one or two players, a tile per player
// read one after another for three or four. "after" is how the game reads them now: from two players up a tile and a
// worker per player, the first on the GPU and the others on the CPU, side by side (tracker.ts, lanes). Reads a second
// are counted per player's column.
//
//   npx vite --port 5198 --strictPort            (the dev server serves e2e/tracker.html)
//   node tools/perf/tracking.mjs                              1, 2, 3 and 4 players, before and after
//   node tools/perf/tracking.mjs --empty                      also: 4 seats, only 2 hands (the other tiles empty)
//   node tools/perf/tracking.mjs --base http://127.0.0.1:5198
//   node tools/perf/tracking.mjs --wheels                     with the players' wheel readers and corner pictures drawn, as a race draws them
//   node tools/perf/tracking.mjs --bases http://127.0.0.1:5198,http://127.0.0.1:5199 --rounds 5 --after
//                                                             two checkouts' dev servers, alternating, medians (the only fair way on a busy machine)
//
// Prints, per case: inference p50/p95 (ms per read, in the worker), camera frames read and skipped (the worker was
// still busy), the delay from the camera capturing a frame to its HandFrame, the page thread's cost per frame, the page
// thread's CPU time a second (the browser's ThreadTime: it does not grow when the machine is busy and the page waits)
// and the garbage it makes (growth of the JS heap a second, before any collection), and the page's own frame interval
// p50/p95 (does tracking steal the game's frames?). A VideoFrame garbage collected without being closed (a leak: the
// camera stalls after a handful) is a warning in the browser's console, and is counted.
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
const ROUNDS = Number(args.rounds ?? 1);

const lanes = (n) => `tiles=${n}&lanes=${Array.from({ length: n }, (_, i) => (i ? "CPU" : "GPU")).join(",")}`;
const CASES = [
  { label: "1 player  (2 hands, whole picture)", query: "hands=2", players: 1, after: true },
  { label: "2 players, before (4 hands, whole picture)", query: "hands=4&copies=2", players: 2 },
  { label: "2 players, after (2 tiles, 2 workers)", query: `hands=4&copies=2&${lanes(2)}`, players: 2, after: true },
  { label: "3 players, before (3 tiles, 1 worker)", query: "hands=6&tiles=3&confidence=0.4&players=3&fist=0.12", players: 3 },
  { label: "3 players, after (3 tiles, 3 workers)", query: `hands=6&confidence=0.4&players=3&fist=0.12&${lanes(3)}`, players: 3, after: true },
  { label: "4 players, before (4 tiles, 1 worker)", query: "hands=8&tiles=4&confidence=0.4&players=4&fist=0.1", players: 4 },
  { label: "4 players, after (4 tiles, 4 workers)", query: `hands=8&confidence=0.4&players=4&fist=0.1&${lanes(4)}`, players: 4, after: true },
];
if (args.empty) {
  CASES.push({ label: "4 seats, 2 players (2 tiles empty), before", query: "hands=8&tiles=4&confidence=0.4&players=2&slots=4&fist=0.1", players: 2 });
  CASES.push({ label: "4 seats, 2 players (2 tiles empty), after", query: `hands=8&confidence=0.4&players=2&slots=4&fist=0.1&${lanes(4)}`, players: 2, after: true });
}
// --after: only how the game reads them now.
const RUN = CASES.filter((c) => !args.after || c.after).map((c) => ({ ...c, query: args.wheels ? `${c.query}&wheels=${c.players}` : c.query }));

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN;
};
const results = new Map();
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"],
});
try {
  for (let round = 0; round < ROUNDS; round++) {
    for (const c of RUN) {
      for (const [b, base] of BASES.entries()) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
        await page.goto(`${base}/e2e/tracker.html?${c.query}`);
        // The page says when it begins to measure (after the shaders are built), and when it is done.
        await page.waitForFunction(() => window.smoke?.began || window.smoke?.error, null, { timeout: 120000 });
        const m0 = await metrics();
        await page.waitForFunction(() => window.smoke?.done, null, { timeout: 120000 });
        const m1 = await metrics();
        const r = await page.evaluate(() => window.smoke);
        await ctx.close();
        if (r.error) {
          console.log(c.label, "ERROR", r.error.slice(0, 300));
          continue;
        }
        const t = r.tracker;
        const seconds = m1.Timestamp - m0.Timestamp;
        const row = {
          inference: t.inference.p50,
          reads: r.fps / (r.columns ?? 1),
          skipped: t.skipped,
          delay: t.delay.p50,
          cpu: (1000 * (m1.ThreadTime - m0.ThreadTime)) / seconds,
          garbage: (m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1024 / seconds,
          frameP95: r.frames.p95,
          leaks,
        };
        const key = `${c.label}${BASES.length > 1 ? ` [${b}]` : ""}`;
        if (!results.has(key)) results.set(key, []);
        results.get(key).push(row);
        console.log(
          `${key.padEnd(52)} ${r.delegate}/${r.where} | inference p50 ${t.inference.p50?.toFixed(1)} p95 ${t.inference.p95?.toFixed(1)} ms | read ${t.frames} skipped ${t.skipped} (${row.reads.toFixed(1)} reads/s a column) | delay p50 ${t.delay.p50?.toFixed(0)} p95 ${t.delay.p95?.toFixed(0)} ms | page cost p50 ${t.pageCost.p50?.toFixed(2)} ms | page thread ${row.cpu.toFixed(1)} ms CPU/s, ${row.garbage.toFixed(0)} KB heap/s | page frames p50 ${r.frames.p50.toFixed(1)} p95 ${r.frames.p95.toFixed(1)} ms | hands/frame ${r.handsPerFrame?.toFixed(2)} | unclosed frames ${leaks}`,
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
    console.log(
      `${key.padEnd(52)} each column read ${m("reads").toFixed(1)}/s | inference ${m("inference").toFixed(1)} ms | delay ${m("delay").toFixed(0)} ms | page thread ${m("cpu").toFixed(1)} ms CPU/s, ${m("garbage").toFixed(0)} KB heap/s | page frames p95 ${m("frameP95").toFixed(1)} ms | unclosed frames ${rows.reduce((sum, row) => sum + row.leaks, 0)}`,
    );
  }
}
