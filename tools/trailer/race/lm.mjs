/** Prints a track's landmarks (kind, lap fraction, offset) and length: node tools/trailer/race/lm.mjs canyon-run */
import { launch, openRace, HIDE } from "./lib.mjs";
const browser = await launch();
try {
  for (const track of process.argv.slice(2)) {
    const { page } = await openRace(browser, { query: `track=${track}&sim=1&manual=1&go=1&hud=0&inject=${HIDE}`, w: 320, h: 180, label: "lm" });
    const r = await page.evaluate(() => {
      const d = window.__grip.demo;
      const v = d.view();
      const g = d.geometry;
      return { name: v.track.name, theme: v.track.theme, laps: v.track.laps, length: g.length, width: v.track.width, lm: (v.track.landmarks ?? []).map((l) => `${l.kind}@${l.at.toFixed(3)}/${l.offset}`), ramps: JSON.stringify(v.track.ramps ?? v.track.jumps ?? null)?.slice(0, 300), keys: Object.keys(v.track) };
    });
    console.log(track, JSON.stringify(r, null, 0));
  }
} finally {
  await browser.close();
}
