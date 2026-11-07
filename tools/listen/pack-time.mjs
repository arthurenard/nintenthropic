/** How long the kart pack's first takes take to synthesise in Node: node tools/listen/pack-time.mjs [--root dir] */
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const root = resolve(argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : resolve(HERE, "../.."));
const out = resolve(HERE, "out", ".pack-time.mjs");
buildSync({ entryPoints: [resolve(root, "tools/listen/cues-entry.ts")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const { CUES, renderTake } = await import(pathToFileURL(out).href + `?v=${Date.now()}`);
const kart = Object.keys(CUES).filter((c) => c.startsWith("kart_") && !c.startsWith("kart_amb_"));
const runs = [];
for (let r = 0; r < 5; r++) {
  const t0 = performance.now();
  for (const c of kart) renderTake(c, 1, { sampleRate: 44100, seed: 7 });
  runs.push(performance.now() - t0);
}
console.log(`${kart.length} cues, first takes: ${runs.map((x) => x.toFixed(0)).join(" ")} ms (min ${Math.min(...runs).toFixed(0)})`);
