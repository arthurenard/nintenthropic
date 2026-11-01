// What reading 1 to 4 players' hands costs the page, in node, and proof that a change reads them just as before.
//
// The page's side of the tracker, end to end (tools/perf/input.bench.ts): a LaneTracker handed a camera frame 30 times a
// second, a stand-in worker for each player answering with the hands of its tile, a wheel control for each player reading what
// is published, the sim sampling each at 60 Hz and the race asking each one's status once a frame. It reports the process's
// CPU time (not the clock: the machine is shared) and the garbage made (bytes allocated), a second of play, for the tracker
// alone, with the wheels pushed, with the sim's samples, and with the screens' statuses.
//
//   node tools/perf/input.mjs                          this checkout, 1 to 4 players
//   node tools/perf/input.mjs --against ../other       this checkout and another one, alternating (--rounds 5), medians
//   node tools/perf/input.mjs --same ../other          proves both read hands exactly alike (tools/perf/input.same.ts): random plays of
//                                                      1 to 4 players (fists, open hands, claps, cheers, hands lost and found, strangers,
//                                                      misses) run through the tracker, the wheels and the sim's samples, everything
//                                                      that comes out hashed; the hashes must be equal
//   node tools/perf/input.mjs --garbage                where the garbage comes from (four players), by function
//
// Alone it measures the checkout it is in; the other needs only its src/ (its node_modules are not used).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.trim().split(/\s+/);
      return [k, v.join(" ") || "1"];
    }),
);
const ROUNDS = Number(args.rounds ?? 5);
const work = mkdtempSync(resolve(tmpdir(), "input-perf-"));

/** The bench or the proof, bundled against a checkout's src/. */
function bundle(kind, checkout, name) {
  const source = readFileSync(resolve(ROOT, `tools/perf/input.${kind}.ts`), "utf8").replaceAll("__SRC__", resolve(checkout, "src"));
  const entry = resolve(work, `${kind}.${name}.ts`);
  const out = resolve(work, `${kind}.${name}.mjs`);
  writeFileSync(entry, source);
  const built = spawnSync(resolve(ROOT, "node_modules/.bin/rolldown"), [entry, "--format", "esm", "--platform", "node", "-o", out], { encoding: "utf8" });
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  return out;
}

// No scavenge inside a run, so the heap's growth is what a run allocated.
const NODE = ["--expose-gc", "--min-semi-space-size=128", "--max-semi-space-size=128"];
const run = (file, env = {}) => spawnSync("node", [...NODE, file], { encoding: "utf8", env: { ...process.env, ...env } }).stdout;

if (args.same) {
  const hashes = [bundle("same", ROOT, "mine"), bundle("same", resolve(args.same), "other")].map((file) => run(file).trim().split("\n"));
  hashes.forEach((lines, i) => console.log(`${i ? args.same : "this checkout"}:\n  ${lines.join("\n  ")}`));
  const same = hashes[0].join("\n") === hashes[1].join("\n");
  console.log(same ? "\nidentical: every published frame, sample, status and finger count" : "\nDIFFERENT");
  process.exit(same ? 0 : 1);
}

if (args.garbage) {
  console.log(run(bundle("bench", ROOT, "mine"), { HEAPPROF: "1", ONLY: "4", MODES: "status" }));
  process.exit(0);
}

const names = args.against ? ["other", "this"] : ["this"];
const files = { this: bundle("bench", ROOT, "mine"), ...(args.against ? { other: bundle("bench", resolve(args.against), "other") } : {}) };
const found = Object.fromEntries(names.map((n) => [n, {}]));
for (let round = 0; round < (args.against ? ROUNDS : 1); round++) {
  for (const name of names) {
    for (const line of run(files[name], { PASSES: String(args.passes ?? 12) }).split("\n")) {
      const head = line.match(/^(\d) players?: /);
      if (!head) continue;
      for (const part of line.slice(head[0].length).split(" | ")) {
        const m = part.match(/^(\w+): cpu ([\d.]+) \(min ([\d.]+)\) ms\/s, (\d+) KB\/s/);
        if (!m) continue;
        const slot = (found[name][`${head[1]} player${head[1] === "1" ? " " : "s"} ${m[1]}`] ??= { cpu: [], kb: [] });
        slot.cpu.push(Number(m[2]));
        slot.kb.push(Number(m[4]));
      }
    }
  }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
console.log(`${args.against ? `medians of ${ROUNDS} alternating rounds` : "one round"}: page thread CPU ms and garbage KB, a second of play`);
for (const key of Object.keys(found[names[0]])) {
  console.log(`${key.padEnd(18)} ${names.map((n) => `${n}: ${median(found[n][key].cpu).toFixed(2)} ms, ${median(found[n][key].kb).toFixed(0)} KB`).join("   |   ")}`);
}
