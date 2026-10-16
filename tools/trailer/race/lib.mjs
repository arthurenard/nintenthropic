/**
 * Shared pieces of the Grip Prix trailer capture: a muted headless Chrome, the renderer's dev page held on
 * ?manual=1 (src/kart/render/dev.ts), and a page that is stepped exactly one video frame at a time.
 *
 * Repeatability: Math.random is a seeded generator and performance.now is pinned to the simulated clock
 * (both installed by an init script, after the page has loaded), so the camera kicks, fireworks and spin-out
 * sparkles are the same on every run; the race itself is the real sim with a fixed seed.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../../..");
export const OUT = resolve(ROOT, "tools/trailer/out");
export const ORIGIN = "http://127.0.0.1:4901";
export const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";

/** Headless Chrome, muted, on the GPU. Nothing in this folder ever plays a sound. */
export function launch() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--mute-audio",
      "--use-angle=metal",
      "--ignore-gpu-blocklist",
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
    ],
  });
}

/** Installed in every page before its own scripts: the pieces the repeatable clock needs. */
export const INIT = () => {
  const realNow = performance.now.bind(performance);
  window.__pin = (ms) => {
    performance.now = () => ms;
  };
  window.__unpin = () => {
    performance.now = realNow;
  };
  // A WebGL canvas that is read between two presentations can come back blank: keep its drawing buffer, so a screenshot always
  // sees the frame that was just drawn.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attributes) {
    if (typeof type === "string" && type.startsWith("webgl")) attributes = { ...(attributes || {}), preserveDrawingBuffer: true };
    return getContext.call(this, type, attributes);
  };
  // The HUD's CSS animations and transitions follow the simulated clock, not the wall clock (see scrub() in tools/promo/capture.ts).
  const tracked = new WeakMap();
  window.__scrub = (nowMs) => {
    for (const a of document.getAnimations()) {
      let start = tracked.get(a);
      if (start === undefined) {
        start = nowMs;
        tracked.set(a, start);
        a.pause();
      }
      a.currentTime = nowMs - start;
    }
  };
  // mulberry32
  window.__seed = (s) => {
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
};

export const DEV_PAGE = "/src/kart/render/dev.html";
/** Hides the dev panel and the loading overlay. */
export const HIDE = "%23dev%2C%23loading%7Bdisplay%3Anone%7D";

/**
 * Opens the dev page (query: a string of parameters) and waits until the track, the karts and every shader are ready.
 * Returns { page, context, bad, fail }: `bad` lists network responses with a 4xx/5xx status and failed .glb/.wasm loads.
 */
export async function openRace(browser, { query, w = 1920, h = 1080, dsf = 1, seed = 1, page: pagePath = DEV_PAGE, log = false, label = "" }) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  const page = await context.newPage();
  const bad = [];
  page.on("pageerror", (e) => console.log(`[${label}] pageerror:`, e.message));
  page.on("console", (m) => {
    if (log || m.type() === "error") console.log(`[${label}] ${m.type()}:`, m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => bad.push(`FAILED ${r.url()}`));
  await context.addInitScript(INIT);
  await page.goto(`${ORIGIN}${pagePath}?${query}`);
  await page.waitForFunction(() => window.__grip && window.__grip.marks && window.__grip.marks.loaded && typeof window.__grip.advance === "function", null, {
    timeout: 120_000,
    polling: 100,
  });
  await page.evaluate(
    (s) => {
      window.__seed(s);
      window.__pin(1_000_000);
    },
    seed,
  );
  return { page, context, bad };
}

export const pad = (n, width = 5) => String(n).padStart(width, "0");

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}
