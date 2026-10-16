/**
 * Renders the trailer's cards and titles to PNG frame sequences (see README.md):
 *
 *   node tools/trailer/cards/render.mjs                    every card
 *   node tools/trailer/cards/render.mjs --only end,t-four  just those
 *   node tools/trailer/cards/render.mjs --guides           draw the empty icon slots (a layout check, not for the edit)
 *   node tools/trailer/cards/render.mjs --no-holds         screenshot every frame, even where nothing moves
 *
 * cards.html is pure state: window.cards.update(t) sets everything at t seconds,
 * and this script steps it one video frame at a time (60 fps) in headless
 * Chrome, muted, taking a 1920x1080 screenshot per frame. Titles are shot with
 * a transparent background (alpha); the cards are opaque black.
 * Output: tools/trailer/out/cards/<id>/00001.png... and cards/cards.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { SIGHT } from "../../icons/mark.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(resolve(HERE, "cards.html")).href;
const W = 1920;
const H = 1080;
const FPS = 60;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? true);
};
const only = flag("only")?.split(",") ?? null;
const guides = args.includes("--guides");
const holds = !args.includes("--no-holds");
const workers = Number(flag("concurrency", 4));
// A guides render is only for looking at: it never overwrites the cards the edit uses.
const OUT = resolve(HERE, guides ? "../out/cards-guides" : "../out/cards");

/**
 * Icons for the end card's slots: the app icon (also the Finger Guns tile) and Grip Prix's kart icon, from
 * the repo, so a new app icon is picked up on the next render. A file in tools/trailer/cards/icons/
 * ({app,finger-guns,grip-prix}.{png,svg,webp,jpg}) overrides one.
 */
function iconUrls() {
  const repo = (path) => pathToFileURL(resolve(HERE, "../../..", path)).href;
  const found = {
    app: repo("public/icons/icon-512.png"),
    "finger-guns": repo("public/icons/icon-512.png"),
    "grip-prix": repo("public/assets/kart/icon.png"),
  };
  const dir = resolve(HERE, "icons");
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir)) {
    const m = file.match(/^(app|finger-guns|grip-prix)\.(png|svg|webp|jpg)$/);
    if (m) found[m[1]] = pathToFileURL(resolve(dir, file)).href;
  }
  return found;
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // Never a sound: the browser is muted, and nothing here plays audio.
  args: ["--mute-audio", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
});

async function openPage(card) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${card.id}] pageerror:`, e.message));
  await page.goto(PAGE);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(([id, opts]) => window.cards.mount(id, opts), [card.id, { guides, icons: guides ? {} : iconUrls(), sight: SIGHT }]);
  return page;
}

const probe = await openPage({ id: "t-high-noon" });
const all = await probe.evaluate(() => window.cards.list());
await probe.context().close();
const todo = all.filter((c) => !only || only.includes(c.id));
if (only) for (const id of only) if (!all.some((c) => c.id === id)) throw new Error(`no card "${id}" (have ${all.map((c) => c.id).join(", ")})`);

mkdirSync(OUT, { recursive: true });
const manifestPath = resolve(OUT, "cards.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];

for (const card of todo) {
  const dir = resolve(OUT, card.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const name = (i) => resolve(dir, `${String(i + 1).padStart(5, "0")}.png`);

  // Frames that sit inside a hold (nothing moves) are shot once and copied.
  const copies = [];
  const shoot = [];
  const first = new Map();
  for (let i = 0; i < card.frames; i++) {
    const t = i / FPS;
    const hold = holds ? card.holds.findIndex(([a, b]) => t >= a && t <= b) : -1;
    if (hold >= 0 && first.has(hold)) copies.push([first.get(hold), i]);
    else {
      if (hold >= 0) first.set(hold, i);
      shoot.push(i);
    }
  }

  const t0 = Date.now();
  let next = 0;
  let slots = [];
  const pages = await Promise.all(Array.from({ length: Math.min(workers, shoot.length) }, () => openPage(card)));
  await Promise.all(
    pages.map(async (page) => {
      while (next < shoot.length) {
        const i = shoot[next++];
        await page.evaluate((t) => window.cards.update(t), i / FPS);
        await page.screenshot({ path: name(i), type: "png", omitBackground: card.alpha });
      }
    }),
  );
  if (card.slots) {
    await pages[0].evaluate((t) => window.cards.update(t), (card.frames - 1) / FPS);
    slots = await pages[0].evaluate(() => window.cards.slots());
  }
  for (const page of pages) await page.context().close();
  for (const [from, to] of copies) copyFileSync(name(from), name(to));
  console.log(`${card.id}: ${card.frames} frames (${shoot.length} shot, ${copies.length} copied) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const entry = { id: card.id, frames: card.frames, alpha: card.alpha, what: card.what, beats: card.beats, fps: FPS, w: W, h: H };
  if (slots.length) entry.slots = slots; // empty icon slots, where they sit once everything is in place
  const at = manifest.findIndex((m) => m.id === card.id);
  if (at >= 0) manifest[at] = entry;
  else manifest.push(entry);
}
await browser.close();

// Keep the manifest in the order the cards are defined in.
manifest.sort((a, b) => all.findIndex((c) => c.id === a.id) - all.findIndex((c) => c.id === b.id));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifestPath}`);
