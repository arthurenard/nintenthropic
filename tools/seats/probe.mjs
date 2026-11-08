// Where do two players' hands come back, on one camera, in this browser? Runs the real tracker (a worker per
// column, tracker.ts) on e2e/seats.html in WebKit (Safari's engine) or Chromium, on a picture of two fists drawn
// at a known place, and prints where the hands were found in the whole picture, and what the browser does with a
// VideoFrame cut to a column (it was Safari ignoring the cut that put a neighbour's hands in an empty seat).
//
//   npx vite --port 5199 --strictPort                      (serves e2e/seats.html)
//   npx playwright install webkit                          (once)
//   node tools/seats/probe.mjs webkit  --scene some.jpg    a still picture of a person holding two fists up (not in the repo)
//   node tools/seats/probe.mjs chromium --cut worker       force the workers to cut (--cut page: force the page to)
//   node tools/seats/probe.mjs chromium --perf             one line: the tracker's costs per camera frame
//
// The picture fills the left half of the camera's picture (--at x,y,w,h as fractions to move it), so with two seats
// every hand must come back in the left half and none in the right half's empty seat.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "package.json"));
const pw = require("playwright-core");

const argv = process.argv.slice(2);
const which = argv[0] === "chromium" ? "chromium" : "webkit";
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? fallback : (argv[at + 1] ?? "1");
};
const scene = readFileSync(flag("scene", resolve(ROOT, "e2e/fixtures/hand.jpg")));
const [x, y, w, h] = flag("at", "0,0.1,0.5,0.8").split(",");
const seats = flag("seats", "2");
const cut = flag("cut", "auto");
const base = flag("base", "http://127.0.0.1:5199");
const query = `seats=${seats}&x=${x}&y=${y}&w=${w}&h=${h}&cut=${cut}&delegate=${flag("delegate", "GPU")}&ms=${flag("ms", "6000")}`;

const browser = await (which === "webkit" ? pw.webkit : pw.chromium).launch(which === "webkit" ? {} : { channel: "chrome", args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await page.route("**/__scene.jpg", (route) => route.fulfill({ body: scene, contentType: "image/jpeg" }));
await page.goto(`${base}/e2e/seats.html?${query}`);
await page.waitForFunction(() => window.seats?.done, null, { timeout: 120_000 });
const report = await page.evaluate(() => window.seats);
await browser.close();

// Where the palms were, in twentieths of the camera's width.
const bins = {};
for (const palm of report.palms ?? []) {
  const key = (Math.round(palm.x * 20) / 20).toFixed(2);
  bins[key] = (bins[key] ?? 0) + 1;
}
const ms = (v) => v.toFixed(2);
if (argv.includes("--perf")) {
  const s = report.stats;
  console.log(
    `${which} cut=${cut}: inference p50 ${ms(s.inference.p50)} p95 ${ms(s.inference.p95)} | page cost p50 ${ms(s.pageCost.p50)} p95 ${ms(s.pageCost.p95)} mean ${ms(s.pageCost.mean)} | capture to frame p50 ${ms(s.delay.p50)} | reads ${report.counts.frames}, skipped ${report.counts.skipped} | the browser honours the cut: ${report.honoursCut}`,
  );
} else {
  console.log(which, JSON.stringify({ ...report, palms: undefined, stats: undefined, palmsAcrossThePicture: bins }, null, 1));
}
if (report.error) process.exit(1);
