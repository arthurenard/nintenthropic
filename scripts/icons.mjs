/**
 * Handy's app icons, drawn from the hand glyph in index.html - white strokes
 * on black, like the favicon - and rasterised by Playwright's Chrome
 * (headless and muted, as everything here is). The PNGs are committed; run
 * this again only when the glyph changes:
 *
 *     node scripts/icons.mjs
 *
 * It writes public/icons/:
 *   icon-192.png, icon-512.png   "any": a rounded square with the system's
 *                                margin round it, as a Mac's app icons have
 *   icon-maskable-512.png        full bleed, the hand inside the safe circle
 *   apple-touch-icon.png         180 px, full bleed (iOS rounds the corners)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = `${ROOT}public/icons`;

const page = readFileSync(`${ROOT}index.html`, "utf8");
const glyph = page.match(/<symbol id="i-hand" viewBox="0 0 24 24">([\s\S]*?)<\/symbol>/)?.[1];
if (!glyph) throw new Error("index.html has no #i-hand symbol");

/** Where the hand sits on its 24-unit grid (its strokes' centre lines), to centre it. */
const HAND = { x: 4.4, y: 3.15, width: 16.7, height: 16.65 };
/** The strokes, in grid units: lighter than the interface's 1.75, for a hand this large. */
const STROKE = 1.5;

/**
 * `inset`: the margin round the tile, as a share of the icon (a Mac's icon
 * grid leaves 100 of 1024 on each side); `radius`: the tile's corners, as a
 * share of the tile; `hand`: the hand's width, as a share of the icon.
 */
const ICONS = [
  { file: "icon-192.png", size: 192, inset: 100 / 1024, radius: 0.225, hand: 0.5 },
  { file: "icon-512.png", size: 512, inset: 100 / 1024, radius: 0.225, hand: 0.5 },
  { file: "icon-maskable-512.png", size: 512, inset: 0, radius: 0, hand: 0.5 },
  { file: "apple-touch-icon.png", size: 180, inset: 0, radius: 0, hand: 0.58 },
];

function drawing({ size, inset, radius, hand }) {
  const tile = size * (1 - 2 * inset);
  const scale = (size * hand) / HAND.width;
  const x = size / 2 - (HAND.x + HAND.width / 2) * scale;
  const y = size / 2 - (HAND.y + HAND.height / 2) * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${size * inset}" y="${size * inset}" width="${tile}" height="${tile}" rx="${tile * radius}" fill="#000" />
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#fff" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
</svg>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio"] });
try {
  const tab = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    await tab.setViewportSize({ width: icon.size, height: icon.size });
    await tab.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${drawing(icon)}</body></html>`);
    const png = await tab.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    writeFileSync(`${OUT}/${icon.file}`, png);
    console.log(`public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
