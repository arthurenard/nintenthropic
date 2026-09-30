/**
 * A tuning aid: loads a scene's page (no stepping) and evaluates a JavaScript
 * expression against window.promo / window.__handy, printing the result.
 *   node tools/promo/probe.mjs western "window.__handy.game.debug.covers()"
 */
import { launch, ORIGIN } from "./frames.mjs";

const scene = process.argv[2] ?? "western";
const expr = process.argv[3] ?? "1";
const browser = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(`${ORIGIN}/tools/promo/capture.html?scene=${scene}&w=1920&h=1080&dpr=1&manual=1&skipcalib=1&tips=seen&seed=1851`);
  await page.evaluate(() => window.promo.ready);
  const out = await page.evaluate(expr);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
