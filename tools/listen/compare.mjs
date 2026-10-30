/**
 * Two renders of tools/listen/render.mjs side by side: each job's loudness, range, peak, brightness and width, the
 * solo scenes' stretches, and the cost of the audio code a frame.
 *
 *   node tools/listen/compare.mjs before after
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [a = "before", b = "after"] = process.argv.slice(2);
const load = (label) => JSON.parse(readFileSync(resolve(HERE, "out", label, "summary.json"), "utf8"));
const A = load(a);
const B = load(b);
const pad = (x, n = 7) => String(x).padStart(n);

console.log(`${"job".padEnd(18)} ${pad("LUFS")} ${pad("")} ${pad("short")} ${pad("")} ${pad("LRA")} ${pad("")} ${pad("TP")} ${pad("")} ${pad("centr.")} ${pad("")} ${pad("width")} ${pad("")} ${pad("ms/fr")} ${pad("")}`);
console.log(`${"".padEnd(18)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)} ${pad(a)} ${pad(b)}`);
for (const job of Object.keys(B)) {
  const x = A[job];
  const y = B[job];
  if (!x) continue;
  console.log(
    `${job.padEnd(18)} ${pad(x.lufs)} ${pad(y.lufs)} ${pad(x.shortMax)} ${pad(y.shortMax)} ${pad(x.lra)} ${pad(y.lra)} ${pad(x.truePeak)} ${pad(y.truePeak)} ` +
      `${pad(x.centroid)} ${pad(y.centroid)} ${pad(x.width)} ${pad(y.width)} ${pad(x.frameMs.mean)} ${pad(y.frameMs.mean)}`,
  );
}

for (const job of Object.keys(B).filter((j) => j.startsWith("solo"))) {
  if (!A[job]?.parts) continue;
  console.log(`\n${job}: momentary max LUFS and centroid Hz of each stretch, ${a} -> ${b}`);
  for (const [part, y] of Object.entries(B[job].parts)) {
    const x = A[job].parts[part];
    console.log(`  ${part.padEnd(8)} ${pad(x.lufs)} -> ${pad(y.lufs)}   ${pad(x.centroid)} -> ${pad(y.centroid)}`);
  }
}
