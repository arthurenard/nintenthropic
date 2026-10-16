/**
 * Looks for moments before anything is filmed: runs the real sim (no drawing, so it is quick) on a track and prints
 * the race's events with their race time, and where the first kart is.
 *
 *   node tools/trailer/race/scan.mjs --track canyon-run [--seed 5] [--karts 8] [--secs 60] [--types jump,hit,boost,strike]
 *        [--holder 3 --item comet --use 6]      give a kart an item to use at that race second
 */
import { launch, openRace, HIDE } from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, all) => (x.startsWith("--") ? [...acc, [x.slice(2), all[i + 1]]] : acc), []));
const track = args.track ?? "meadow-loop";
const seed = Number(args.seed ?? 5);
const karts = Number(args.karts ?? 8);
const secs = Number(args.secs ?? 60);
const types = args.types ? new Set(args.types.split(",")) : null;
const extra = (args.laps ? `&laps=${args.laps}` : "") + ["item", "holder", "use"].filter((k) => args[k] !== undefined).map((k) => `&${k}=${args[k]}`).join("");

const browser = await launch();
try {
  const { page } = await openRace(browser, { query: `track=${track}&sim=1&manual=1&karts=${karts}&seed=${seed}&quality=low&scale=0.3&hud=0&inject=${HIDE}${extra}`, w: 480, h: 270, label: "scan" });
  const out = await page.evaluate((secs) => {
    const demo = window.__grip.demo;
    const events = [];
    const lead = [];
    const open = new Map();
    const drifts = [];
    for (let f = 0; f < secs * 60; f++) {
      demo.step(1 / 60, null);
      const v = demo.view();
      for (const k of v.karts) {
        const d = open.get(k.id);
        if (k.drift !== 0 && !d) open.set(k.id, { kart: k.id, from: +v.time.toFixed(2), frac: +k.lapProgress.toFixed(3), dir: k.drift, level: k.driftLevel, lap: k.lap });
        else if (k.drift !== 0 && d) d.level = Math.max(d.level, k.driftLevel);
        else if (k.drift === 0 && d) {
          d.to = +v.time.toFixed(2);
          d.fracTo = +k.lapProgress.toFixed(3);
          if (d.to - d.from > 0.8) drifts.push(d);
          open.delete(k.id);
        }
      }
      for (const e of v.events) events.push({ ...e, t: +(v.time).toFixed(2), phase: v.phase, cd: +v.countdown.toFixed(2) });
      if (f % 30 === 0) {
        const k = [...v.karts].sort((a, b) => a.place - b.place);
        lead.push({ t: +(f / 60).toFixed(1), race: +v.time.toFixed(1), lap: k[0].lap, p: +k[0].lapProgress.toFixed(3), place: k.map((x) => x.id).join("") });
      }
    }
    return { events, lead, drifts };
  }, secs);
  for (const e of out.events) {
    if (types && !types.has(e.type)) continue;
    if (e.type === "countdown" || e.type === "box") continue;
    const { id, tick, type, t, phase, cd, ...rest } = e;
    console.log(`${String(tick).padStart(5)}  race ${String(t).padStart(6)}s  ${type.padEnd(12)} ${JSON.stringify(rest)}`);
  }
  if (args.drifts) for (const d of out.drifts) console.log(`drift kart ${d.kart} ${d.from}s-${d.to}s (${(d.to - d.from).toFixed(1)}s) lap ${d.lap} ${d.frac}-${d.fracTo} ${d.dir < 0 ? "left" : "right"} level ${d.level}`);
  console.log("lead:", out.lead.filter((_, i) => i % 4 === 0).map((l) => `${l.t}s:L${l.lap}@${l.p}[${l.place}]`).join("  "));
} finally {
  await browser.close();
}
