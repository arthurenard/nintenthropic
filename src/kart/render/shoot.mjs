/**
 * Takes screenshots of the renderer's dev pages with headless Chrome, muted
 * (nothing here may ever make a sound). Needs `npx vite --port 5181` running.
 *
 *   node src/kart/render/shoot.mjs shots.json
 *
 * where shots.json is a list of
 *   { "out": "src/kart/render/shots/a.png", "url": "gallery.html?theme=kitchen&kind=teapot",
 *     "wait": 1500, "eval": "window.__grip.something()", "size": [1440, 900], "waitFor": "window.__grip" }
 * Instead of (or as well as) one `out`, `steps` takes several pictures of one run: [{ "eval", "wait", "out" }].
 * `url` is relative to http://127.0.0.1:5181/src/kart/render/. `eval` runs in the page after it has loaded
 * and `wait` (ms) has passed; `evalWait` (ms) then waits again before the picture is taken.
 * The page's console errors are printed.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(resolve(process.cwd(), "package.json"));
const { chromium } = require("playwright-core");

const BASE = process.env.SHOOT_BASE ?? "http://127.0.0.1:5181/src/kart/render/";
const specs = JSON.parse(readFileSync(process.argv[2], "utf8"));

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--mute-audio", "--autoplay-policy=user-gesture-required", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
try {
  for (const spec of specs) {
    const [w, h] = spec.size ?? [1440, 900];
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: spec.dpr ?? 1 });
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
    await page.goto(new URL(spec.url, BASE).href, { waitUntil: "load" });
    if (spec.waitFor) await page.waitForFunction(spec.waitFor, null, { timeout: 60000 });
    await page.waitForTimeout(spec.wait ?? 1500);
    let result;
    if (spec.eval) {
      result = await page.evaluate(spec.eval);
      await page.waitForTimeout(spec.evalWait ?? 600);
    }
    // A shot may be several pictures of one run: each step evaluates something, waits, and takes its own picture.
    for (const step of spec.steps ?? []) {
      if (step.eval) await page.evaluate(step.eval);
      await page.waitForTimeout(step.wait ?? 300);
      mkdirSync(dirname(resolve(step.out)), { recursive: true });
      await page.screenshot({ path: resolve(step.out) });
      console.log(step.out);
    }
    if (spec.out) {
      mkdirSync(dirname(resolve(spec.out)), { recursive: true });
      await page.screenshot({ path: resolve(spec.out) });
      console.log(`${spec.out}${result !== undefined ? "  -> " + JSON.stringify(result) : ""}`);
    }
    for (const e of errors.slice(0, 6)) console.log("   " + e);
    await page.close();
  }
} finally {
  await browser.close();
}
