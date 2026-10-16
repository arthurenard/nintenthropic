/**
 * Films one Grip Prix clip: the real sim (seeded) on the renderer's dev page, stepped one video frame at a time
 * (?manual=1, __grip.advance), a PNG of each frame, and a record of every frame's view for the sound.
 *
 * A clip (plan.mjs) says where (`query`), how long it runs before the camera starts (`skip` simulated seconds
 * without drawing, then `pre` drawn frames that are not kept) and for how long (`frames`), and may carry
 * `setup` and `director`, functions that run IN THE PAGE (they are sent as source: no closures):
 *
 *   setup(grip, P)            once, after the page is ready and before the first frame (teleports, items, which karts the views follow)
 *   director(grip, P)         returns frame(f, view) called just before each frame is drawn (f counts from -pre; the
 *                             kept frames start at 0): a free camera (grip.renderer.setDebugCamera), a forced item...
 *   P                         plain data both receive
 */
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir, HIDE, openRace, pad } from "./lib.mjs";
import { rigLib } from "./rig.mjs";

const FPS = 60;
const DT = 1 / FPS;

/** A browser that dies under us (it is a shared machine) must not leave the capture waiting for ever. */
const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${what} took more than ${ms / 1000} s (the browser may be gone)`)), ms))]);

/**
 * @param {import("@playwright/test").Browser} browser
 * @param {object} clip
 * @param {{out:string, size?:[number,number], every?:number, jpeg?:boolean, pre?:number, frames?:number, from?:number, log?:boolean, viewsOut?:string|null}} o
 *   `from`/`frames`: film only this part (frame numbers of the clip), `every`: keep every Nth frame.
 * @returns {Promise<{views: object[], preViews: object[], bad: string[], shots: number, info: object}>}
 */
export async function shoot(browser, clip, o) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(browser, clip, o);
    } catch (error) {
      // The dev server may reload the page once while it optimises dependencies or after an edit: try again.
      if (attempt >= 5 || !/context was destroyed|navigation|Target closed|net::|page reloaded|advance is not a function|__grip|__rig|__dir|Execution context|timeout:|has been closed|disconnected/i.test(String(error))) throw error;
      console.log(`[${clip.id}] the page reloaded, trying again (${String(error).slice(0, 80)})`);
    }
  }
}

async function once(browser, clip, o) {
  const [w, h] = o.size ?? [1920, 1080];
  const pre = o.pre ?? clip.pre ?? 30;
  const frames = o.frames ?? clip.frames;
  const every = o.every ?? 1;
  const ext = o.jpeg ? "jpg" : "png";
  ensureDir(o.out);
  const query = [
    clip.query,
    "sim=1",
    "manual=1",
    "quality=high",
    "scale=1",
    "controls=none",
    `inject=${HIDE}`,
    clip.hud === false ? "hud=0" : "",
    `seed=${clip.simSeed ?? 5}`,
    clip.skip ? `skip=${clip.skip}` : "",
  ]
    .filter(Boolean)
    .join("&");
  const dsf = o.dsf ?? 1;
  const { page, context, bad } = await openRace(browser, { query, w, h, dsf, seed: clip.seed ?? 1851, label: clip.id, log: o.log });
  try {
    const P = clip.P ?? {};
    const info = await page.evaluate(
      ({ rigSrc, setupSrc, dirSrc, P, views, hud }) => {
        (0, eval)(`(${rigSrc})()`);
        const grip = window.__grip;
        // The skip loop in dev.ts stepped without drawing: its events are stale.
        grip.demo.view();
        if (views) grip.renderer.setViews(views);
        if (hud === false) document.getElementById("hud").style.display = "none";
        const setup = setupSrc ? (0, eval)(`(${setupSrc})`) : null;
        const result = setup ? setup(grip, P) : null;
        window.__dir = dirSrc ? (0, eval)(`(${dirSrc})`)(grip, P) : null;
        return result ?? {};
      },
      { rigSrc: rigLib.toString(), setupSrc: clip.setup?.toString() ?? null, dirSrc: clip.director?.toString() ?? null, P, views: clip.views ?? null, hud: clip.hud },
    );
    // The shared dev server reloads every open page when it re-optimises its dependencies or an edit reaches this page's modules:
    // a clip that was reloaded half way is filmed again from the start.
    let reloaded = false;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) reloaded = true;
    });
    const start = Math.max(0, o.from ?? 0);
    const keptViews = [];
    const preViews = [];
    let shots = 0;
    const t0 = Date.now();
    for (let f = -pre; f < frames; f++) {
      const ms = 1_000_000 + ((f + pre) * 1000) / FPS;
      if (reloaded) throw new Error("the page reloaded");
      const view = await withTimeout(page.evaluate(
        ({ f, ms, dt }) => {
          window.__pin(ms);
          const v = window.__grip.advance(dt, (view) => window.__dir?.(f, view));
          window.__scrub(ms);
          return { tick: v.tick, phase: v.phase, countdown: v.countdown, time: v.time, laps: v.laps, karts: v.karts, things: v.things, events: v.events };
        },
        { f, ms, dt: DT },
      ), 90_000, `frame ${f}`);
      if (f < 0) preViews.push(view);
      else keptViews.push(view);
      if (f >= start && (f - start) % every === 0) {
        const name = `${o.out}/${pad((f - start) / every + 1)}.${ext}`;
        // At a device scale of 2 the page is drawn at twice the pixels and Chrome brings the picture down to w x h (a 2 x 2 average: a smooth, supersampled edge).
        await withTimeout(page.screenshot({ path: name, scale: "css", ...(o.jpeg ? { type: "jpeg", quality: 90 } : { type: "png" }) }), 90_000, `screenshot ${f}`);
        shots++;
      }
      if (o.log && f % 60 === 0) console.log(`[${clip.id}] frame ${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }

    const problems = bad.filter((b) => !/favicon/.test(b));
    const stats = await page.evaluate(() => window.__grip.stats());
    console.log(`[${clip.id}] ${shots} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s, tier ${stats.tier} x${stats.pixelRatio} res ${stats.resolutionScale}${problems.length ? `, PROBLEMS: ${problems.join(" | ")}` : ""}`);
    if (o.viewsOut) {
      ensureDir(dirname(o.viewsOut));
      writeFileSync(o.viewsOut, JSON.stringify({ fps: FPS, pre: preViews.length, preViews, views: keptViews }));
    }
    return { views: keptViews, preViews, bad: problems, shots, info };
  } finally {
    await context.close().catch(() => {});
  }
}
