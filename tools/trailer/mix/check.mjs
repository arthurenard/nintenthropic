/**
 * Checks a mix by analysis only (never plays anything): for each game event, how loud the game
 * sound is in the master and how far it stands above the music around it, plus the mix's levels.
 *
 *   node tools/trailer/mix/check.mjs --events tools/trailer/mix/example-events.json
 *        [--mix tools/trailer/out/mix/master.wav] [--game tools/trailer/out/mix/master-game.wav] [--music tools/trailer/out/music/music.wav]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SR, measure, peakOf, readAudio, rmsOf, secs, toDb } from "../music/dsp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const mixPath = resolve(ROOT, flag("mix", "tools/trailer/out/mix/master.wav"));
const base = mixPath.replace(/\.[^.]+$/, "");
const mix = readAudio(mixPath);
const game = readAudio(resolve(ROOT, flag("game", `${base}-game.wav`)));
const music = readAudio(resolve(ROOT, flag("music", "tools/trailer/out/music/music.wav")));
const raw = JSON.parse(readFileSync(resolve(process.cwd(), flag("events", "tools/trailer/mix/example-events.json")), "utf8"));
const events = (Array.isArray(raw) ? raw : raw.events).filter((e) => e.type === "play");
const db = (x) => toDb(x).toFixed(1).padStart(6);

const wm = measure(mixPath);
const am = existsSync(`${base}.m4a`) ? measure(`${base}.m4a`) : null;
console.log(`master (wav): ${wm.lufs} LUFS, true peak ${wm.tp} dBTP, sample peak ${toDb(peakOf(mix.l, mix.r)).toFixed(2)} dBFS, ${(mix.l.length / SR).toFixed(3)} s`);
if (am) console.log(`after AAC (${base}.m4a): ${am.lufs} LUFS, true peak ${am.tp} dBTP`);
console.log("\n    t  cue                     game peak (stem)  mix peak (50 ms)  music RMS (400 ms before)  stands out by");
for (const e of events.sort((a, b) => a.t - b.t)) {
  const a = Math.max(0, secs(e.t - 0.003));
  const z = Math.min(mix.l.length, secs(e.t + 0.05));
  const gp = peakOf(game.l, game.r, a, z);
  if (gp < 0.002) continue; // not rendered (unknown cue, or too quiet)
  const mp = peakOf(mix.l, mix.r, a, z);
  const mr = rmsOf(music.l, music.r, Math.max(0, secs(e.t - 0.4)), Math.max(1, secs(e.t)));
  console.log(`${e.t.toFixed(2).padStart(6)}  ${e.cue.padEnd(22)}  ${db(gp)}          ${db(mp)}          ${db(mr)}                  ${(toDb(mp) - toDb(mr)).toFixed(1).padStart(5)} dB`);
}
