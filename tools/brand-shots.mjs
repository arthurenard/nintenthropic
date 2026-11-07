// Pictures of the home page and Grip Prix's start and loading screens at the sizes that matter:
//   node tools/brand-shots.mjs <base url> <out folder>
// Headless Chrome, muted.
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:4173";
const out = process.argv[3] ?? ".";
const sizes = [
  [1440, 900],
  [900, 760],
  [390, 844],
  [844, 390],
  [2560, 1440],
];
const browser = await chromium.launch({ channel: "chrome", args: ["--mute-audio"] });
for (const [width, height] of sizes) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(base + "/");
  await page.waitForSelector("#landing:not([hidden])");
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/home-${width}x${height}.png` });
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("#landing .tile *")]
      .filter((el) => el.children.length === 0 && el.textContent?.trim() && getComputedStyle(el).display !== "none")
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > el.closest(".tile").getBoundingClientRect().right)
      .map((el) => el.textContent.trim()),
  );
  console.log(`${width}x${height}`, "scrollW", await page.evaluate(() => document.documentElement.scrollWidth), "clipped", JSON.stringify(clipped));
  if (width === 1440) {
    await page.goto(base + "/race.html");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/start-${width}x${height}.png` });
  }
  await context.close();
}
await browser.close();
