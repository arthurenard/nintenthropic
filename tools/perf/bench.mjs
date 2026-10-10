// Measures Grip Prix's renderer on the real GPU: the dev page (src/kart/render/dev.html) runs the real sim with
// eight bots and loads the Blender art, in Chrome on Metal, with the frame-rate limit off so the frame time is the
// work and not the display's refresh.
//
//   npx vite --port 5198 --strictPort        (a worktree whose node_modules is a link: see docs/GRIP_PRIX.md, Performance)
//   node tools/perf/bench.mjs                                   every track, 1 and 4 views, every tier
//   node tools/perf/bench.mjs --tracks canyon-run,fun-fair --views 4 --tiers high,low
//   node tools/perf/bench.mjs --seconds 8 --out perf.json      (default 6 s measured after 2 s warm-up)
//   node tools/perf/bench.mjs --viewport 1920x1080@1           (default 1440x900@2, a MacBook's screen)
//   node tools/perf/bench.mjs --cpu 4                          the page's main thread four times slower
//   node tools/perf/bench.mjs --bases URL_A,URL_B --rounds 3   compare two dev pages (two checkouts), alternating, medians
//   node tools/perf/bench.mjs --base http://127.0.0.1:5198/src/kart/render/dev.html
//
// Per configuration it prints: fps, CPU ms per frame (the sim; the scene update, the draw submit and the HUD, from
// the renderer's own stopwatch), GPU ms (EXT_disjoint_timer_query_webgl2: the views with their shadow passes, and
// the post chain), draw calls, triangles, shader programs, texture memory (counted at the WebGL calls), time to
// the first frame, the worst frame of the first 240 (shader-compile hitches), and the JS heap allocated per frame
// (GC churn). Resolution is pinned at 1 so tiers are compared at equal pixels. Nothing plays sound.
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
/** One dev page, or several to compare (--bases a,b: each configuration is measured on each in turn, --rounds times, and the medians are compared). */
const BASES = (args.bases ?? args.base ?? "http://127.0.0.1:5198/src/kart/render/dev.html").split(",");
const ROUNDS = Number(args.rounds ?? 1);
const ALL_TRACKS = ["meadow-loop", "kitchen-rally", "harbour-lights", "canyon-run", "fun-fair", "glacier-pass", "volcano-rush", "starlight-ribbon", "five-finger-circuit"];
const TRACKS = args.tracks ? args.tracks.split(",") : ALL_TRACKS;
const VIEWS = (args.views ?? "1,4").split(",").map(Number);
const TIERS = (args.tiers ?? "high,medium,low").split(",");
const SECONDS = Number(args.seconds ?? 6);
const WARM = Number(args.warm ?? 2);
const SCALE = args.scale ?? "1";
const [vw, vh, vr] = (args.viewport ?? "1440x900@2").split(/[x@]/).map(Number);
const EXTRA = args.extra ?? "";
/** --cpu 4: the page's main thread runs four times slower (Chrome's own throttle), a stand-in for a laptop with a slower CPU than this one. */
const CPU = Number(args.cpu ?? 1);

/** Counts the bytes WebGL is asked to hold: textures (every level), renderbuffers (every sample), less what is deleted. */
function glMemory() {
  const FORMAT_BYTES = new Map([
    [0x8058, 4], // RGBA8
    [0x8c43, 4], // SRGB8_ALPHA8
    [0x8051, 3], // RGB8
    [0x8c41, 3], // SRGB8
    [0x8229, 1], // R8
    [0x822b, 2], // RG8
    [0x881a, 8], // RGBA16F
    [0x8814, 16], // RGBA32F
    [0x822d, 2], // R16F
    [0x822f, 4], // RG16F
    [0x881b, 6], // RGB16F
    [0x8c3a, 4], // R11F_G11F_B10F
    [0x81a6, 3], // DEPTH_COMPONENT24
    [0x81a5, 2], // DEPTH_COMPONENT16
    [0x8cac, 4], // DEPTH_COMPONENT32F
    [0x88f0, 4], // DEPTH24_STENCIL8
    [0x8d00, 4], // DEPTH32F_STENCIL8 (approx)
    [0x1908, 4], // RGBA
    [0x1907, 3], // RGB
    [0x1909, 1], // LUMINANCE
    [0x190a, 2], // LUMINANCE_ALPHA
    [0x1906, 1], // ALPHA
    [0x8d62, 3], // RGB565
    [0x8056, 2], // RGBA4
  ]);
  const bytes = (fmt, w, h) => (FORMAT_BYTES.get(fmt) ?? 4) * w * h;
  const textures = new Map(); // WebGLTexture -> Map(level -> bytes)
  const renderbuffers = new Map();
  window.__glmem = {
    total: () => {
      let t = 0;
      let r = 0;
      for (const levels of textures.values()) for (const b of levels.values()) t += b;
      for (const b of renderbuffers.values()) r += b;
      return { textures: t, renderbuffers: r, textureCount: textures.size };
    },
  };
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue;
    const p = Ctx.prototype;
    const bound = (gl, target) => gl.getParameter(target === gl.TEXTURE_CUBE_MAP || (target >= 0x8515 && target <= 0x851a) ? gl.TEXTURE_BINDING_CUBE_MAP : target === 0x806f ? gl.TEXTURE_BINDING_3D : target === 0x8c1a ? gl.TEXTURE_BINDING_2D_ARRAY : gl.TEXTURE_BINDING_2D);
    const note = (gl, target, level, b) => {
      const tex = bound(gl, target);
      if (!tex) return;
      let levels = textures.get(tex);
      if (!levels) textures.set(tex, (levels = new Map()));
      const face = target >= 0x8515 && target <= 0x851a ? target : 0;
      levels.set(level + ":" + face, b);
    };
    const wrap = (name, fn) => {
      const original = p[name];
      if (!original) return;
      p[name] = function (...a) {
        try {
          fn(this, ...a);
        } catch {}
        return original.apply(this, a);
      };
    };
    // texImage2D(target, level, internal, width, height, border, format, type, data) or the short form (..., format, type, source).
    const originalTex = p.texImage2D;
    p.texImage2D = function (target, level, internal, a, b, c) {
      const r = originalTex.apply(this, arguments);
      try {
        if (arguments.length === 6) note(this, target, level, bytes(internal, c?.width ?? c?.videoWidth ?? 0, c?.height ?? c?.videoHeight ?? 0));
        else note(this, target, level, bytes(internal, a, b));
      } catch {}
      return r;
    };
    wrap("texStorage2D", (gl, target, levels, internal, w, h) => {
      for (let l = 0; l < levels; l++) note(gl, target, l, bytes(internal, Math.max(1, w >> l), Math.max(1, h >> l)));
    });
    wrap("texStorage3D", (gl, target, levels, internal, w, h, d) => {
      for (let l = 0; l < levels; l++) note(gl, target, l, bytes(internal, Math.max(1, w >> l), Math.max(1, h >> l)) * d);
    });
    wrap("compressedTexImage2D", (gl, target, level, internal, w, h, border, data) => note(gl, target, level, data?.byteLength ?? 0));
    wrap("deleteTexture", (gl, tex) => textures.delete(tex));
    wrap("renderbufferStorage", (gl, target, internal, w, h) => {
      const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
      if (rb) renderbuffers.set(rb, bytes(internal, w, h));
    });
    wrap("renderbufferStorageMultisample", (gl, target, samples, internal, w, h) => {
      const rb = gl.getParameter(gl.RENDERBUFFER_BINDING);
      if (rb) renderbuffers.set(rb, bytes(internal, w, h) * Math.max(1, samples));
    });
    wrap("deleteRenderbuffer", (gl, rb) => renderbuffers.delete(rb));
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function measure(browser, BASE, track, views, tier) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: vr });
  await ctx.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
  await ctx.addInitScript(glMemory);
  const page = await ctx.newPage();
  if (CPU > 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  const url = `${BASE}?track=${track}&sim=1&go=1&views=${views}&quality=${tier}&scale=${SCALE}&profile=1${EXTRA}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__grip?.marks?.firstFrame, null, { timeout: 180000 });
  const firstFrameMs = Date.now() - t0;
  const load = await page.evaluate(() => ({ build: window.__grip.marks.loaded - window.__grip.marks.loadStart }));
  // The first 240 frames, as the race starts: the worst of them is a compile hitch, the rest a fair start.
  await page.waitForFunction(() => window.__grip.log.length >= 240, null, { timeout: 60000 });
  const start = await page.evaluate(() => window.__grip.log.slice(0, 240).map((r) => r[0]));
  await page.waitForTimeout(WARM * 1000);
  await page.evaluate(() => {
    window.__grip.clearLog();
    window.__grip.renderer.gpuMean("views", true);
    window.__grip.renderer.gpuMean("post", true);
  });
  await page.waitForTimeout(SECONDS * 1000);
  const data = await page.evaluate(() => {
    const g = window.__grip;
    const stats = g.renderer.stats();
    const mem = window.__glmem.total();
    return {
      log: g.log.slice(),
      stats,
      mem,
      gpuViews: g.renderer.gpuMean("views"),
      gpuPost: g.renderer.gpuMean("post"),
      gpu: stats.gpu,
    };
  });
  await ctx.close();

  const dts = data.log.map((r) => r[0]);
  const total = dts.reduce((a, b) => a + b, 0);
  const sorted = [...dts].sort((a, b) => a - b);
  // Heap: bytes allocated per frame = sum of increases; a collection shows as a drop of half a megabyte or more.
  let allocated = 0;
  let collections = 0;
  for (let i = 1; i < data.log.length; i++) {
    const d = data.log[i][3] - data.log[i - 1][3];
    if (d > 0) allocated += d;
    else if (d < -500_000) collections++;
  }
  const startSorted = [...start.slice(5)].sort((a, b) => a - b);
  const med = pct(startSorted, 0.5);
  const t = data.stats.timings;
  return {
    track,
    views,
    tier,
    fps: Math.round((data.log.length / total) * 1000),
    frameMs: +(total / data.log.length).toFixed(2),
    p99Ms: +pct(sorted, 0.99).toFixed(1),
    simMs: +mean(data.log.map((r) => r[1])).toFixed(2),
    cpuMs: +mean(data.log.map((r) => r[2])).toFixed(2),
    updateMs: +t.update.toFixed(2),
    submitMs: +t.submit.toFixed(2),
    drawMs: +t.draw.toFixed(2),
    hudMs: +t.hud.toFixed(2),
    gpuViewsMs: +data.gpuViews.toFixed(2),
    gpuPostMs: +data.gpuPost.toFixed(2),
    gpuMs: +(data.gpuViews + data.gpuPost).toFixed(2),
    calls: data.stats.drawCalls,
    kTris: Math.round(data.stats.triangles / 1000),
    programs: data.stats.programs,
    geometries: data.stats.geometries,
    textures: data.stats.textures,
    texMB: +(data.mem.textures / 1048576).toFixed(0),
    rbMB: +(data.mem.renderbuffers / 1048576).toFixed(0),
    firstFrameMs,
    buildMs: Math.round(load.build),
    worstStartMs: +Math.max(...start.slice(5)).toFixed(1),
    startHitches: start.slice(5).filter((x) => x > Math.max(3 * med, 25)).length,
    allocKBperFrame: +(allocated / data.log.length / 1024).toFixed(1),
    gcPerMin: Math.round((collections / (total / 1000)) * 60),
    errors: errors.length,
  };
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const rows = [];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const line = (r) =>
  `${r.track.padEnd(20)} ${r.views}v ${r.tier.padEnd(6)} ${String(r.fps).padStart(4)} fps | cpu ${r.cpuMs} (sim ${r.simMs} upd ${r.updateMs} sub ${r.submitMs} hud ${r.hudMs}) | gpu ${r.gpuMs} (views ${r.gpuViewsMs} post ${r.gpuPostMs}) | ${r.calls} calls ${r.kTris}k tris ${r.programs} prog | tex ${r.texMB} MB rb ${r.rbMB} MB | first ${r.firstFrameMs} ms build ${r.buildMs} | worst start ${r.worstStartMs} ms (${r.startHitches}) | ${r.allocKBperFrame} KB/frame ${r.gcPerMin} gc/min${r.errors ? " ERRORS " + r.errors : ""}`;
try {
  for (const track of TRACKS) {
    for (const views of VIEWS) {
      for (const tier of TIERS) {
        if (BASES.length === 1 && ROUNDS === 1) {
          const r = await measure(browser, BASES[0], track, views, tier);
          rows.push(r);
          console.log(line(r));
          continue;
        }
        // Compare: alternate the pages round by round, so a busy machine hurts them alike.
        const runs = BASES.map(() => []);
        for (let round = 0; round < ROUNDS; round++) {
          for (let b = 0; b < BASES.length; b++) runs[b].push(await measure(browser, BASES[b], track, views, tier));
        }
        const med = (b, key) => +median(runs[b].map((r) => r[key])).toFixed(2);
        const keys = ["frameMs", "cpuMs", "gpuViewsMs", "gpuPostMs", "calls", "kTris", "programs", "texMB", "rbMB", "firstFrameMs", "worstStartMs", "allocKBperFrame"];
        for (let b = 0; b < BASES.length; b++) {
          const summary = { track, views, tier, base: BASES[b], rounds: ROUNDS };
          for (const k of keys) summary[k] = med(b, k);
          rows.push(summary);
        }
        console.log(`${track.padEnd(20)} ${views}v ${tier.padEnd(6)} (median of ${ROUNDS})`);
        for (const k of keys) console.log(`    ${k.padEnd(16)} ${BASES.map((_, b) => String(med(b, k)).padStart(9)).join("  ")}   ${BASES.length === 2 && med(0, k) ? ((med(1, k) / med(0, k) - 1) * 100).toFixed(0).padStart(5) + " %" : ""}`);
      }
    }
  }
} finally {
  await browser.close();
  if (args.out) writeFileSync(resolve(ROOT, args.out), JSON.stringify(rows, null, 1));
}
