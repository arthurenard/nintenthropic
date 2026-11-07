// What a real race costs on one screen with several players: the whole app (race.html, the real sim, renderer, HUD, sound
// switched off, the net loop of a practice room) with 1 to 4 scripted wheels (?input=script), optionally with the real camera
// (Chrome's fake one: --camera real) so a tracking worker runs for each column. It plays the race for --seconds and reports
// what a player would feel as stutter:
//   fps, p50/p95/p99/max   the page's frame interval (requestAnimationFrame gaps), frames over 33 ms and over 50 ms
//   longTasks              main-thread tasks over 50 ms (Long Tasks API): how many and the worst
//   gcDrops, garbageKBps   drops of the JS heap (a collection ran) and garbage made a second
//   programsLinked         shader programs linked after the green light (each one is a hitch)
//   calls                  draw calls a frame (all views, shadows, post), median and p99
//   worst                  the five worst frames with the second they happened at
//
//   npx vite --port 5191 --strictPort &
//   node tools/perf/split.mjs --base http://127.0.0.1:5191 --players 1,2,3,4 --tracks canyon-run,fun-fair --camera script,real
//   --seconds 20 (default)   --out file.json   --tier high|medium|low (default: Auto)
//   --dpr 2 --size 1920x1080   a bigger, sharper window (a weaker GPU pays per pixel)   --soft   draw on SwiftShader (the worst GPU)
//   --cpu n   the main thread n times slower, from the green light   --level n   start the load governor at step n (-1: off)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
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
const BASE = args.base ?? "http://127.0.0.1:5191";
const PLAYERS = (args.players ?? "2,4").split(",").map(Number);
const TRACKS = (args.tracks ?? "canyon-run").split(",");
const CAMERAS = (args.camera ?? "script").split(",");
const SECONDS = Number(args.seconds ?? 20);
const TIER = args.tier ?? null;
const [VW, VH] = String(args.size ?? "1440x900").split("x").map(Number);
const DPR = Number(args.dpr ?? 1);
const SHOTS = args.shots ?? "/private/tmp/claude-501/-Users-arthurenard-Developer-Handy/d18cfbe0-3cc8-4b21-b42c-935d881c3da7/scratchpad/shots/perf";
const NAMES = { "canyon-run": "Canyon Run", "fun-fair": "Fun Fair", "meadow-loop": "Meadow Loop", "glacier-pass": "Glacier Pass" };
const FIXTURE = resolve(ROOT, "node_modules/.cache/super-claude-bros-e2e/hand.y4m");

/** In the page before anything else: the probes. */
function probes() {
  const P = (window.__perf = { frames: [], long: [], programs: [], calls: [], heap: [], armed: false, drawn: 0, t0: 0 });
  let last = 0;
  const loop = (t) => {
    if (P.armed) {
      if (last) P.frames.push([t - last, performance.now()]);
      P.calls.push(P.drawn);
      const m = performance.memory;
      if (m) P.heap.push([t, m.usedJSHeapSize]);
    }
    P.drawn = 0;
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (P.armed) P.long.push([e.startTime, e.duration]);
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements"]) {
    const orig = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...a) {
      P.drawn++;
      return orig.apply(this, a);
    };
  }
  const link = WebGL2RenderingContext.prototype.linkProgram;
  WebGL2RenderingContext.prototype.linkProgram = function (p) {
    if (P.armed) P.programs.push(performance.now());
    return link.call(this, p);
  };
}

function pct(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const r1 = (x) => Math.round(x * 10) / 10;

async function once(browser, players, track, camera) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  const you = JSON.stringify({ name: "Maya", drive: "wheel", players });
  await ctx.addInitScript(
    ([v, tier]) => {
      localStorage.setItem("handy.muted.v1", "true");
      localStorage.setItem("handy.kart.checked.v1", "true");
      localStorage.setItem("handy.camera-opened.v1", "true");
      localStorage.setItem("handy.kart.you.v1", v);
      if (tier) localStorage.setItem("handy.kart.graphics.v1", tier);
    },
    [you, TIER],
  );
  await ctx.addInitScript(probes);
  const page = (globalThis.__lastPage = await ctx.newPage());
  page.setDefaultTimeout(40000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/race.html?net=local&input=script&perf=1${args.level ? `&load=${args.level}` : ""}${camera === "real" ? "&camera=real" : ""}`);
  const poses = Array.from({ length: players }, (_, i) => ({ angle: 0, centre: [(i + 0.5) / players, 0.5], span: 0.2 }));
  await page.waitForFunction(() => window.gripTest?.wheel);
  await page.evaluate((p) => window.gripTest.wheel(p), poses);
  await page.getByRole("button", { name: "Practice" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  const button = page.locator("#driver-continue");
  await button.waitFor();
  while ((await button.textContent()) === "Next Driver") await button.click();
  await button.click();
  await page.locator("#screen-howto").waitFor({ state: "visible", timeout: 120000 });
  await page.locator("#howto-continue").click();
  await page.locator("#lobby-players").waitFor();
  await page.getByRole("radio", { name: new RegExp(NAMES[track] ?? track) }).first().click();
  await page.getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Start Race" }).click();
  await page.waitForFunction(() => window.gripTest.state()?.race, null, { timeout: 120000 });
  await page.locator("#race-loading").waitFor({ state: "hidden", timeout: 120000 });
  await page.evaluate((p) => window.gripTest.wheel(null), poses);
  await page.waitForFunction(() => window.gripTest.state()?.race?.phase === "racing", null, { timeout: 60000 });
  await page.evaluate((p) => window.gripTest.wheel(p), poses);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const P = window.__perf;
    P.frames.length = 0;
    P.long.length = 0;
    P.programs.length = 0;
    P.calls.length = 0;
    P.heap.length = 0;
    P.armed = true;
    P.t0 = performance.now();
  });
  // --cpu n: the main thread n times slower (a weaker laptop), from the green light on.
  if (args.cpu) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(args.cpu) });
  // --profile: the main thread's own time by function (V8's sampling profiler over the measured seconds), top 25.
  const cdp = args.profile ? await ctx.newCDPSession(page) : null;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
  }
  // --garbage: where the garbage comes from (V8's sampling heap profiler: bytes allocated, by function), top 25.
  if (args.garbage) {
    var heapCdp = await ctx.newCDPSession(page);
    await heapCdp.send("HeapProfiler.startSampling", { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  }
  // The karts weave a little so the bots, items and bumps happen.
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < SECONDS * 1000) {
    const angles = poses.map((p, i) => ({ ...p, angle: Math.sin((k + i) / 3) * 25 }));
    await page.evaluate((p) => window.gripTest.wheel(p), angles).catch(() => {});
    k++;
    await page.waitForTimeout(250);
  }
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + dt[i] / 1000);
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`-- ${players} players ${track}: main thread ${r1(total / SECONDS)} ms/s busy; top self time (ms per second)`);
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ${r1(v / SECONDS)}  ${k}`);
  }
  if (args.garbage) {
    const { profile } = await heapCdp.send("HeapProfiler.stopSampling");
    const by = new Map();
    let total = 0;
    const walk = (n) => {
      const f = n.callFrame;
      const own = n.selfSize;
      total += own;
      const key = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
      by.set(key, (by.get(key) ?? 0) + own);
      n.children.forEach(walk);
    };
    walk(profile.head);
    console.log(`-- ${players} players ${track}: garbage ${Math.round(total / 1024 / SECONDS)} KB/s sampled; top allocators (KB per second)`);
    for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ${Math.round(v / 1024 / SECONDS)}  ${k}`);
  }
  const out = await page.evaluate(() => ({ P: window.__perf, views: window.gripTest.state().views?.length, t1: performance.now(), end: window.__gripStats?.() ?? null }));
  await page.screenshot({ path: `${SHOTS}/split-${players}-${track}-${camera}.png` }).catch(() => {});
  await ctx.close();
  const P = out.P;
  const dts = P.frames.map((f) => f[0]);
  const worst = P.frames
    .map((f, i) => [f[0], i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
    .map(([d, i]) => `${r1(d)}ms@${r1((P.frames[i][1] - P.t0) / 1000)}s`);
  const heap = P.heap.map((h) => h[1]);
  let drops = 0;
  let allocated = 0;
  for (let i = 1; i < heap.length; i++) {
    if (heap[i] < heap[i - 1] - 262144) drops++;
    else allocated += Math.max(0, heap[i] - heap[i - 1]);
  }
  const secs = (out.t1 - P.t0) / 1000;
  return {
    players, track, camera, views: out.views,
    fps: r1(P.frames.length / secs),
    p50: r1(pct(dts, 50)), p95: r1(pct(dts, 95)), p99: r1(pct(dts, 99)), max: r1(Math.max(...dts)),
    over33: dts.filter((d) => d > 33).length, over50: dts.filter((d) => d > 50).length,
    longTasks: P.long.length, longWorst: r1(Math.max(0, ...P.long.map((l) => l[1]))),
    gcDrops: drops, garbageKBps: Math.round(allocated / 1024 / secs),
    programsLinked: P.programs.length,
    callsMedian: pct(P.calls, 50), callsP99: pct(P.calls, 99),
    worst, errors: errors.slice(0, 3), end: out.end,
  };
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    ...(args.soft ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"]), "--mute-audio", "--enable-precise-memory-info",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${FIXTURE}`,
  ],
});
const results = [];
try {
  for (const track of TRACKS)
    for (const camera of CAMERAS)
      for (const players of PLAYERS) {
        try {
          const r = await once(browser, players, track, camera);
          results.push(r);
          console.log(JSON.stringify(r));
        } catch (e) {
          await globalThis.__lastPage?.screenshot({ path: `${SHOTS}/failed.png` }).catch(() => {});
          console.log(JSON.stringify({ players, track, camera, failed: String(e.message).split("\n").slice(0, 3).join(" | ") }));
        }
      }
} finally {
  await browser.close();
}
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
