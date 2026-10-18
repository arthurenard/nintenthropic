/**
 * A tuning aid: loads a clip's page (no stepping) and evaluates a JavaScript
 * expression against window.capture / window.__harness, printing the result.
 *   node tools/trailer/shooters/probe.mjs hn-hero "window.__harness.game.debug.covers()"
 */
import { launch, ORIGIN } from "./browser.mjs";

const clip = process.argv[2] ?? "hn-hero";
const expr = process.argv[3] ?? "1";
const seed = process.argv[4] ?? 1851;
const browser = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`${ORIGIN}/tools/trailer/shooters/capture.html?clip=${clip}&w=1920&h=1080&dpr=1&manual=1&skipcalib=1&tips=seen&seed=${seed}`);
  await page.evaluate(() => window.capture.ready);
  const out = await page.evaluate(expr);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
