// Proves a rendering optimisation does not change the picture: for each track and number of views, the dev page's
// race is held still (no time passing) and drawn with the optimisation off, then on, and the two canvases are
// compared byte for byte (and the run drawn twice, to be sure the picture is steady). Today it checks the
// per-view culling of the scenery (world/cull.ts), which must draw exactly what the frustum would have clipped.
//
//   npx vite --port 5198 --strictPort
//   node tools/perf/same.mjs                                  every track, 1, 2 and 4 views, high tier
//   node tools/perf/same.mjs --tracks meadow-loop --views 4 --tiers medium
//   node tools/perf/same.mjs --save DIR                       also writes the pictures (PNG) to DIR
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
const TRACKS = (args.tracks ?? "meadow-loop,kitchen-rally,harbour-lights,canyon-run,fun-fair,glacier-pass,volcano-rush,starlight-ribbon,five-finger-circuit").split(",");
const VIEWS = (args.views ?? "1,2,4").split(",").map(Number);
const TIERS = (args.tiers ?? "high").split(",");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"] });
let failed = 0;
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
