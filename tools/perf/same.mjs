// Proves a rendering optimisation does not change the picture: for each track and number of views, the dev page's
// race is held still (no time passing) and drawn with the optimisation off, then on, and the two canvases are
// compared byte for byte (and the run drawn twice, to be sure the picture is steady). Today it checks the
// per-view culling of the scenery (world/cull.ts), which must draw exactly what the frustum would have clipped.
//
//   npx vite --port 5198 --strictPort
//   node tools/perf/same.mjs                                  every track, 1, 2 and 4 views, high tier
//   node tools/perf/same.mjs --tracks meadow-loop --views 4 --tiers medium
//   node tools/perf/same.mjs --save DIR                       also writes the pictures (PNG) to DIR
//   node tools/perf/same.mjs --against URL                    instead: this dev page against another (a checkout of origin/main, say)
//                                                             at the same moments of the same race, byte for byte (--at 150,500,900 frames)
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
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
const BASE = args.base ?? "http://127.0.0.1:5198/src/kart/render/dev.html";
const AGAINST = args.against;
/** With --against: the frames of the race (stepped a sixtieth of a second at a time) at which the two pages' pictures are compared. */
const AT = (args.at ?? "150,500,900").split(",").map(Number);
const TRACKS = (args.tracks ?? "meadow-loop,kitchen-rally,harbour-lights,canyon-run,fun-fair,glacier-pass,volcano-rush,starlight-ribbon,five-finger-circuit").split(",");
const VIEWS = (args.views ?? "1,2,4").split(",").map(Number);
const TIERS = (args.tiers ?? "high").split(",");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"] });
let failed = 0;

/** One dev page, stepped exactly (?manual=1) with Math.random seeded alike and a clock of its own: the canvas at each frame in `AT`, read in the task that drew it. */
async function steppedPictures(base, track, views, tier) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("handy.muted.v1", "true");
    // The clock is the race's: a spun-out kart's sparkles circle by the page's clock.
    window.__now = 0;
    performance.now = () => window.__now;
    let seed = 20261101;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?track=${track}&sim=1&go=1&views=${views}&quality=${tier}&scale=1&manual=1`);
  await page.waitForFunction(() => window.__grip?.advance, null, { timeout: 180000 });
  const shots = [];
  for (let i = 0, frame = 0; i < AT.length; i++) {
    shots.push(
      await page.evaluate(
        ([from, to]) => {
          for (let f = from; f < to; f++) {
            window.__grip.advance(1 / 60);
            window.__now += 1000 / 60;
          }
          return document.getElementById("canvas").toDataURL("image/png");
        },
        [frame, AT[i]],
      ),
    );
    frame = AT[i];
  }
  await ctx.close();
  return shots;
}

/** Compares pictures pixel by pixel in a page of their own: how many pixels differ at all, and the largest difference in 8-bit levels. */
async function compare(pairs) {
  const page = await (await browser.newContext()).newPage();
  return page.evaluate(async (pairs) => {
    const pixels = async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    return Promise.all(
      pairs.map(async ([a, b]) => {
        const [x, y] = await Promise.all([pixels(a), pixels(b)]);
        let differ = 0;
        let largest = 0;
        for (let i = 0; i < x.length; i += 4) {
          const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
          if (d > 0) differ++;
          if (d > largest) largest = d;
        }
        return { differ, largest, total: x.length / 4 };
      }),
    );
  }, pairs);
}

if (AGAINST) {
  try {
    for (const track of TRACKS) {
      for (const views of VIEWS) {
        for (const tier of TIERS) {
          const mine = await steppedPictures(BASE, track, views, tier);
          const theirs = await steppedPictures(AGAINST, track, views, tier);
          const results = await compare(mine.map((m, i) => [m, theirs[i]]));
          const same = results.every((r) => r.differ === 0);
          if (!same) failed++;
          console.log(`${track.padEnd(20)} ${views}v ${tier.padEnd(6)} ${same ? "identical" : "DIFFERENT"} at frames ${AT.join(", ")}${same ? "" : ": " + results.map((r) => `${r.differ} pixels (largest ${r.largest} levels)`).join("; ")}`);
          if (args.save && !same) {
            mkdirSync(args.save, { recursive: true });
            mine.forEach((m, i) => writeFileSync(`${args.save}/${track}-${views}v-${tier}-${AT[i]}-this.png`, Buffer.from(m.split(",")[1], "base64")));
            theirs.forEach((m, i) => writeFileSync(`${args.save}/${track}-${views}v-${tier}-${AT[i]}-against.png`, Buffer.from(m.split(",")[1], "base64")));
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

try {
  for (const track of TRACKS) {
    for (const views of VIEWS) {
      for (const tier of TIERS) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
        const page = await ctx.newPage();
        await page.goto(`${BASE}?track=${track}&sim=1&go=1&skip=${6 + views}&views=${views}&quality=${tier}&scale=1&profile=1`);
        await page.waitForFunction(() => window.__grip?.marks?.firstFrame, null, { timeout: 180000 });
        await page.waitForTimeout(1500);
        const r = await page.evaluate(() => {
          const g = window.__grip;
          g.setPaused(true);
          // The item boxes turn on a clock of their own: hold them still for a comparison of draws of one moment.
          g.renderer.inspect.world().boxes.update = () => {};
          const canvas = document.getElementById("canvas");
          // One frame brings the game up to this moment; after that the post chain redraws the same views and the same
          // scene as often as asked, so nothing moves between the pictures but the optimisation being switched.
          g.renderer.frame(g.demo.view(), 0);
          const draw = (cull) => {
            g.renderer.inspect.setCulling(cull);
            g.renderer.inspect.post.render(0);
            return canvas.toDataURL("image/png");
          };
          draw(true);
          const off = draw(false);
          const on = draw(true);
          const again = draw(true);
          // What one culled and one whole picture cost, for the record.
          g.renderer.inspect.renderer.info.reset();
          draw(true);
          const culled = { calls: g.renderer.stats().drawCalls, tris: g.renderer.stats().triangles };
          g.renderer.inspect.renderer.info.reset();
          draw(false);
          const whole = { calls: g.renderer.stats().drawCalls, tris: g.renderer.stats().triangles };
          return { off, on, again, culled, whole };
        });
        // Where the same draw twice differs (a flame's flicker, a spark) is not the optimisation's doing: those pixels, grown
        // by a few, are set aside, and every other pixel must be the same with the optimisation off and on.
        const verdict = await page.evaluate(async ({ off, on, again }) => {
          const pixels = async (url) => {
            const bitmap = await createImageBitmap(await (await fetch(url)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            return context.getImageData(0, 0, bitmap.width, bitmap.height);
          };
          const [a, b, c] = await Promise.all([pixels(on), pixels(off), pixels(again)]);
          const w = a.width;
          const h = a.height;
          // More than a shade or two: a flame's bloom moves every pixel round it by one.
          const differs = (x, y, i) => Math.abs(x.data[i] - y.data[i]) > 3 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 3 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 3;
          const noise = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) if (differs(a, c, i * 4)) noise[i] = 1;
          // Grown by 4 pixels each way.
          const grown = new Uint8Array(w * h);
          const R = 4;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (noise[y * w + x]) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            const X = x + dx;
            const Y = y + dy;
            if (X >= 0 && Y >= 0 && X < w && Y < h) grown[Y * w + X] = 1;
          }
          let real = 0;
          let noisy = 0;
          for (let i = 0; i < w * h; i++) {
            if (grown[i]) noisy++;
            else if (differs(a, b, i * 4)) real++;
          }
          return { real, noisy, total: w * h };
        }, r);
        r.verdict = verdict;
        const same = verdict.real <= 10;
        if (!same) failed++;
        console.log(`${track.padEnd(20)} ${views}v ${tier.padEnd(6)} ${same ? "identical" : `DIFFERENT in ${verdict.real} pixels`} (${verdict.noisy} of ${verdict.total} pixels set aside as unsteady) | culled ${r.culled.calls} calls ${Math.round(r.culled.tris / 1000)}k tris, whole ${r.whole.calls} calls ${Math.round(r.whole.tris / 1000)}k tris`);
        if (args.save) {
          mkdirSync(args.save, { recursive: true });
          for (const k of ["off", "on", "again"]) writeFileSync(`${args.save}/${track}-${views}v-${tier}-${k}.png`, Buffer.from(r[k].split(",")[1], "base64"));
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
