/**
 * A review aid: grabs stills from the finished video at the given times (s)
 * and tiles them 2 across, for a look at full frames.
 *   node tools/promo/grab.mjs 7.6 15 22.6 30   ->  tools/promo/out/grab.png
 * Add --size 960x540 to change each still's size, --cols 2 for the tiling.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const times = argv.filter((a, i) => /^[0-9.]+$/.test(a) && !argv[i - 1]?.startsWith("--"));
const [w, h] = opt("size", "960x540").split("x");
const cols = Number(opt("cols", 2));
const out = "tools/promo/out";
mkdirSync(`${out}/grab`, { recursive: true });
const run = (args) => {
  const r = spawnSync("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
};
times.forEach((t, i) => run(["-ss", t, "-i", `${out}/handheld-promo.mp4`, "-frames:v", "1", "-vf", `scale=${w}:${h}`, `${out}/grab/${i}.png`]));
const inputs = times.flatMap((_, i) => ["-i", `${out}/grab/${i}.png`]);
run([...inputs, "-filter_complex", `xstack=inputs=${times.length}:layout=${times.map((_, i) => `${(i % cols) * Number(w)}_${Math.floor(i / cols) * Number(h)}`).join("|")}`, `${out}/grab.png`]);
console.log(`${out}/grab.png`);
