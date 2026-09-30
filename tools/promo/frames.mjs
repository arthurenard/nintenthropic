/**
 * Renders one scene of the promo to numbered PNG frames, in headless Chrome
 * (muted), by stepping the page's frame renderer (capture.ts) one frame at a
 * time. Used by render.mjs; can also be run alone for a preview:
 *
 *   node tools/promo/frames.mjs --scene western --pre 10 --dur 8 --out tools/promo/out/preview/western
 *        [--every 30] [--size 960x540] [--seed N] [--fps 60] [--caption "Title|Line"]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

export const ORIGIN = "http://127.0.0.1:4901";

export async function launch() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    // Never a sound: the browser is muted, and nothing here plays audio.
    args: ["--mute-audio", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  });
}

/**
 * @param {import("@playwright/test").Browser} browser
 * @param {{scene:string, seed?:number, pre?:number, dur:number, fps?:number, out:string, every?:number, size?:[number,number],
 *   caption?:{title:string,line:string,from:number,to:number}, fadeIn?:number, fadeOut?:number, pip?:boolean, query?:string, log?:boolean, jpeg?:boolean}} o
 * `pre` and `dur` are in seconds. Returns the audio events (times relative to the first recorded frame).
 */
export async function captureScene(browser, o) {
  // The dev server may reload the page once while it optimises dependencies or after an edit: try again.
  for (let attempt = 1; ; attempt++) {
    try {
      return await captureOnce(browser, o);
    } catch (error) {
      if (attempt >= 3 || !/context was destroyed|navigation|Target closed/i.test(String(error))) throw error;
      console.log(`[${o.scene}] the page reloaded, trying again`);
    }
  }
}

async function captureOnce(browser, o) {
  const fps = o.fps ?? 60;
  const [w, h] = o.size ?? [1920, 1080];
  const pre = Math.round((o.pre ?? 0) * fps);
  const frames = Math.round(o.dur * fps);
  const every = o.every ?? 1;
  mkdirSync(o.out, { recursive: true });
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${o.scene}] pageerror:`, e.message));
  if (o.log) page.on("console", (m) => console.log(`[${o.scene}]`, m.text()));
  await page.clock.install({ time: 0 });
  const seed = o.seed ?? 1851;
  const query = `scene=${o.scene}&w=${w}&h=${h}&dpr=1&manual=1&skipcalib=1&tips=seen&seed=${seed}${o.query ? `&${o.query}` : ""}`;
  await page.goto(`${ORIGIN}/tools/promo/capture.html?${query}`);
  await page.evaluate(() => window.promo.ready);
  await page.clock.pauseAt(1_000_000);
  await page.evaluate((cfg) => window.promo.init(cfg), {
    fps,
    pre,
    frames,
    caption: o.caption,
    fadeIn: o.fadeIn ?? 0,
    fadeOut: o.fadeOut ?? 0,
    pip: o.pip ?? true,
  });
  const t0 = Date.now();
  let shot = 0;
  for (let a = 0; a < pre + frames; a++) {
    await page.evaluate((n) => window.promo.step(n), a);
    const ms = Math.round(((a + 1) * 1000) / fps) - Math.round((a * 1000) / fps);
    await page.clock.runFor(ms);
    await page.evaluate((n) => window.promo.post(n), a);
    const r = a - pre;
    if (r >= 0 && r % every === 0) {
      const name = `${o.out}/${String(r / every + 1).padStart(5, "0")}.${o.jpeg ? "jpg" : "png"}`;
      await page.screenshot(o.jpeg ? { path: name, type: "jpeg", quality: 92 } : { path: name, type: "png" });
      shot++;
    }
    if (o.log && a % 120 === 0) console.log(`[${o.scene}] frame ${a}/${pre + frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const events = await page.evaluate(() => window.promo.events());
  const pre0 = pre / fps;
  const rel = events.map((e) => ({ ...e, t: +(e.t - pre0).toFixed(4) }));
  writeFileSync(`${o.out}/events.json`, JSON.stringify(rel));
  await context.close();
  console.log(`[${o.scene}] ${shot} frames, ${events.length} audio events, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return rel;
}

// Run alone, for a preview.
if (process.argv[1] && process.argv[1].endsWith("frames.mjs")) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, all) => (x.startsWith("--") ? [...acc, [x.slice(2), all[i + 1]]] : acc), []));
  const browser = await launch();
  try {
    await captureScene(browser, {
      scene: args.scene ?? "western",
      seed: args.seed ? Number(args.seed) : 1851,
      pre: Number(args.pre ?? 0),
      dur: Number(args.dur ?? 8),
      fps: Number(args.fps ?? 60),
      out: args.out ?? `tools/promo/out/preview/${args.scene ?? "western"}`,
      every: Number(args.every ?? 30),
      size: (args.size ?? "960x540").split("x").map(Number),
      caption: args.caption ? { title: args.caption.split("|")[0], line: args.caption.split("|")[1] ?? "", from: 0.6, to: Number(args.dur ?? 8) - 0.6 } : undefined,
      query: args.query,
      jpeg: true,
      log: true,
    });
  } finally {
    await browser.close();
  }
}
