/**
 * A tuning aid: runs an ffmpeg audio filter chain over a file and prints the
 * integrated loudness and the true peak of the result.
 *   node tools/promo/loud.mjs "volume=9dB,alimiter=limit=0.8" [tools/promo/out/mix.wav]
 */
import { spawnSync } from "node:child_process";

const [chain = "anull", file = "tools/promo/out/mix.wav"] = process.argv.slice(2);
const r = spawnSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `${chain},aresample=48000,ebur128=peak=true`, "-f", "null", "-"], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr.split("\n").slice(-8).join("\n"));
  process.exit(1);
}
const summary = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
const i = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
const lra = /LRA:\s+(-?[\d.]+) LU/.exec(summary)?.[1];
const tp = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
console.log(`I ${i} LUFS   LRA ${lra} LU   true peak ${tp} dBTP`);
