// Takes the same still of a track at each tier from two dev pages (before and after a change) and says how much the
// pictures differ, so "the high tier looks the same" is a number and a picture, not a feeling.
//
//   npx vite --port 5198 --strictPort                          the page with the change
//   (a second dev server on an older checkout, say on 5199)
//   node tools/perf/shots.mjs --before http://127.0.0.1:5199/src/kart/render/dev.html --out DIR
//   node tools/perf/shots.mjs --tracks meadow-loop,canyon-run --tiers high,medium,low --scale 0.5
//
// Each still is the dev page's ?shot= (a posed picture, the HUD hidden, the demo held still: shot.ts) at 1280x720, with
// Math.random seeded so the dust and sparks fall alike. Writes DIR/<track>-<tier>-before.png and -after.png (and, with
// --diff, an amplified difference) and prints the mean difference in 8-bit levels, the share of channels that differ by
// more than 8 levels, and the largest difference.
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
const AFTER = args.after ?? "http://127.0.0.1:5198/src/kart/render/dev.html";
const BEFORE = args.before ?? "http://127.0.0.1:5199/src/kart/render/dev.html";
const OUT = resolve(args.out ?? "perf-shots");
const TRACKS = (args.tracks ?? "meadow-loop,canyon-run,glacier-pass").split(",");
const TIERS = (args.tiers ?? "high,medium,low").split(",");

/** A pose a few metres behind the road's start, looking down it, three karts in front. */
const POSE = {
  at: 0.04,
  eye: { d: -9, off: 2.4, up: 3.4 },
  target: { d: 16, off: 0, up: 1.2 },
  fov: 58,
  focus: 0,
  boxes: false,
  karts: [
    { id: 0, d: 0, off: -1.8, drift: 0 },
    { id: 1, d: 7, off: 2.2 },
    { id: 2, d: 14, off: -2.4 },
    { id: 3, d: -4, off: 3.2 },
  ],
};

async function take(browser, base, track, tier) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem("handy.muted.v1", "true");
    let seed = 20261010;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?track=${track}&quality=${tier}&scale=1&shot=${encodeURIComponent(JSON.stringify(POSE))}`);
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 180000 });
  await page.waitForTimeout(300);
  // The composited page, not the canvas's buffer (which is cleared once presented); the shot hides the HUD and the dev panel.
  const png = await page.screenshot({ type: "png" });
  await ctx.close();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"] });
mkdirSync(OUT, { recursive: true });
try {
  const page = await (await browser.newContext()).newPage();
  for (const track of TRACKS) {
    for (const tier of TIERS) {
      const before = await take(browser, BEFORE, track, tier);
      const after = await take(browser, AFTER, track, tier);
      writeFileSync(`${OUT}/${track}-${tier}-before.png`, Buffer.from(before.split(",")[1], "base64"));
      writeFileSync(`${OUT}/${track}-${tier}-after.png`, Buffer.from(after.split(",")[1], "base64"));
      const r = await page.evaluate(
        async ({ before, after }) => {
          const px = async (url) => {
            const bm = await createImageBitmap(await (await fetch(url)).blob());
            const c = new OffscreenCanvas(bm.width, bm.height);
            const x = c.getContext("2d");
            x.drawImage(bm, 0, 0);
            return x.getImageData(0, 0, bm.width, bm.height);
          };
          const [A, B] = await Promise.all([px(before), px(after)]);
          let sum = 0;
          let n = 0;
          let max = 0;
          let over8 = 0;
          for (let i = 0; i < A.data.length; i += 4) {
            for (let k = 0; k < 3; k++) {
              const d = Math.abs(A.data[i + k] - B.data[i + k]);
              sum += d;
              n++;
              if (d > max) max = d;
              if (d > 8) over8++;
            }
          }
          return { mean: sum / n, max, over8: (over8 / n) * 100 };
        },
        { before, after },
      );
      console.log(`${track.padEnd(18)} ${tier.padEnd(6)} mean difference ${r.mean.toFixed(3)} levels, ${r.over8.toFixed(3)}% of channels differ by more than 8, largest ${r.max}`);
    }
  }
} finally {
  await browser.close();
}
