// Writes Handy's mark and renders the app icons from it, in installed Chrome:
//   node tools/icons/render.mjs
// public/icons/icon.svg            the mark (favicon, wordmark, share card)
// public/icons/icon-192.png, -512  web app icons, clear corners
// public/icons/icon-maskable-512   full bleed, artwork in the middle 80%
// public/icons/apple-touch-icon    180 px, full bleed (iOS rounds it)
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { markSvg } from "./mark.mjs";

const icons = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/icons");
writeFileSync(resolve(icons, "icon.svg"), markSvg());

const renders = [
  { file: "icon-192.png", size: 192, svg: markSvg(), clear: true },
  { file: "icon-512.png", size: 512, svg: markSvg(), clear: true },
  { file: "icon-maskable-512.png", size: 512, svg: markSvg({ shape: "square", inset: 0.8 }), clear: false },
  { file: "apple-touch-icon.png", size: 180, svg: markSvg({ shape: "square" }), clear: false },
];

const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio"] });
for (const { file, size, svg, clear } of renders) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const sized = svg.replace('width="100" height="100"', `width="${size}" height="${size}"`);
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
  await page.screenshot({ path: resolve(icons, file), omitBackground: clear });
  await page.close();
}
await browser.close();
console.log("wrote", ["icon.svg", ...renders.map((r) => r.file)].join(", "));
