/**
 * A cheap look: 960x540 JPEGs of a clip, every Nth frame, and a contact sheet.
 *
 *   node tools/trailer/race/preview.mjs --only gp-go [--every 12] [--size 960x540] [--frames N] [--pre N] [--from N]
 *        [--set key=value ...]   override fields of the clip (JSON values), e.g. --set query=track=glacier-pass&go=1 --set skip=20
 *   -> tools/trailer/out/preview-race/<id>/00001.jpg ... and contact.jpg
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { launch, OUT, FFMPEG } from "./lib.mjs";
import { CLIPS } from "./plan.mjs";
import { shoot } from "./shoot.mjs";

const argv = process.argv.slice(2);
const args = {};
const sets = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  if (key === "set") {
    const [k, ...rest] = argv[++i].split("=");
    const raw = rest.join("=");
    try {
      sets[k] = JSON.parse(raw);
    } catch {
      sets[k] = raw;
    }
  } else args[key] = argv[++i];
}
const base = CLIPS.find((c) => c.id === args.only);
if (!base) throw new Error(`no clip "${args.only}"; ids: ${CLIPS.map((c) => c.id).join(", ")}`);
const clip = { ...base, ...sets };
const out = `${OUT}/preview-race/${args.name ?? clip.id}`;
rmSync(out, { recursive: true, force: true });
const every = Number(args.every ?? 12);
const size = (args.size ?? "960x540").split("x").map(Number);
const browser = await launch();
try {
  const r = await shoot(browser, clip, { out, size, every, jpeg: true, pre: args.pre ? Number(args.pre) : undefined, frames: args.frames ? Number(args.frames) : undefined, from: args.from ? Number(args.from) : 0, log: args.log === "1" });
  const cols = Number(args.cols ?? 4);
  const rows = Math.ceil(r.shots / cols);
  spawnSync(FFMPEG, ["-y", "-v", "error", "-framerate", "1", "-i", `${out}/%05d.jpg`, "-vf", `scale=${size[0] > 700 ? 640 : size[0]}:-1,tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "3", `${out}/contact.jpg`]);
  console.log(`contact sheet: ${out}/contact.jpg`);
  if (args.dump) {
    // --dump kind: where things of this kind are, every few frames (and kart 'karts' ids: --karts 0,1)
    r.views.forEach((v, i) => {
      if (i % Number(args.dumpEvery ?? 6)) return;
      const t = v.things.filter((x) => x.kind === args.dump).map((x) => `${x.id}@(${x.x.toFixed(1)},${x.y.toFixed(1)},${x.z.toFixed(1)})`).join(" ");
      const ks = (args.karts ?? "").split(",").filter(Boolean).map((id) => {
        const k = v.karts.find((q) => q.id === Number(id));
        return `k${id}(${k.x.toFixed(1)},${k.y.toFixed(1)},${k.z.toFixed(1)} h${k.heading.toFixed(2)} v${k.speed.toFixed(0)} spin${k.spin.toFixed(1)})`;
      }).join(" ");
      console.log(`f${i} ${t} ${ks}`);
    });
  }
  const events = r.views.flatMap((v, i) => v.events.map((e) => ({ f: i, ...e }))).filter((e) => !["countdown", "bump", "box", "pickup", "horn"].includes(e.type));
  console.log(events.slice(0, 60).map((e) => `f${e.f} ${e.type} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["f", "id", "tick", "type"].includes(k))))}`).join("\n"));
} finally {
  await browser.close();
}
