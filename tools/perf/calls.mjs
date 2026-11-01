// Says what a frame's draw calls are: for one frame of a race on the dev page, each kind of object drawn, how many times
// in the views and how many in their shadow passes, and the sum for each view. Draw calls and triangles are counted
// exactly, so unlike a frame time they do not move with the machine's load: this is how a change to what is drawn is
// seen before it is timed.
//
//   npx vite --port 5198 --strictPort
//   node tools/perf/calls.mjs                                     meadow-loop, canyon-run and glacier-pass, 4 views, high
//   node tools/perf/calls.mjs --tracks canyon-run --views 2 --tiers high,low --top 25
//   node tools/perf/calls.mjs --seconds 30                        a frame 30 s into the race (default 12: the pack has spread)
//   node tools/perf/calls.mjs --base URL                          another dev page (a second checkout)
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "package.json"));
const { chromium } = require("playwright-core");

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
const BASE = args.base ?? "http://127.0.0.1:5198/src/kart/render/dev.html";
const TRACKS = (args.tracks ?? "meadow-loop,canyon-run,glacier-pass").split(",");
const VIEWS = (args.views ?? "4").split(",").map(Number);
const TIERS = (args.tiers ?? "high").split(",");
const SECONDS = Number(args.seconds ?? 12);
const TOP = Number(args.top ?? 22);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu", "--mute-audio"] });
try {
  for (const track of TRACKS) {
    for (const views of VIEWS) {
      for (const tier of TIERS) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(() => localStorage.setItem("handy.muted.v1", "true"));
        const page = await ctx.newPage();
        await page.goto(`${BASE}?track=${track}&sim=1&go=1&views=${views}&quality=${tier}&scale=1&manual=1&profile=1&hud=0`);
        await page.waitForFunction(() => window.__grip?.advance, null, { timeout: 180000 });
        const r = await page.evaluate((seconds) => {
          const g = window.__grip;
          // The race, stepped exactly: the same frames on any machine.
          for (let i = 0; i < seconds * 60; i++) g.advance(1 / 60);
          const inspect = g.renderer.inspect;
          const eyes = inspect.cameras().map((c) => c.camera);
          const tally = new Map();
          const perView = { main: eyes.map(() => 0), shadow: eyes.map(() => 0) };
          const tris = { main: eyes.map(() => 0), shadow: eyes.map(() => 0) };
          let current = null;
          // Where in the scene it hangs: the child indexes from the scene down to its first two levels (nothing is named).
          const name = (o) => {
            const path = [];
            for (let p = o; p && p.parent; p = p.parent) path.unshift(p.parent.children.indexOf(p));
            return path.slice(0, 2).join(".");
          };
          const key = (o) => {
            const m = Array.isArray(o.material) ? o.material[0] : o.material;
            return `${name(o).padEnd(7)} ${(o.isInstancedMesh ? "instanced" : o.isPoints ? "points" : "mesh").padEnd(9)} ${m?.type ?? "?"}`;
          };
          const trianglesOf = (o, group) => {
            const geo = o.geometry;
            if (!geo) return 0;
            const per = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0);
            const base = group ? group.count : geo.drawRange.count === Infinity ? per : Math.min(per, geo.drawRange.count);
            const kind = o.isPoints ? 0 : o.isLine ? 0 : 1;
            return (kind * base * (o.isInstancedMesh ? o.count : 1)) / 3;
          };
          const count = (o, which, camera, group) => {
            const v = eyes.indexOf(camera);
            // The shadow pass is given the view's camera; anything else (the post chain's own pass) is not a view.
            if (v < 0) return;
            const k = key(o);
            let row = tally.get(k);
            if (!row) tally.set(k, (row = { main: eyes.map(() => 0), shadow: eyes.map(() => 0), tris: 0, objects: new Set() }));
            row[which][v]++;
            row.objects.add(o.uuid);
            row.tris += trianglesOf(o, group);
            perView[which][v]++;
            tris[which][v] += trianglesOf(o, group);
          };
          const patch = (o) => {
            if (!(o.isMesh || o.isPoints || o.isLine)) return;
            o.onBeforeRender = (_r, _s, camera, _g, _m, group) => count(o, "main", camera, group);
            o.onBeforeShadow = (_r, _o, camera, _sc, _g, _dm, group) => count(o, "shadow", camera, group);
          };
          inspect.scene.traverse(patch);
          // One more frame creates what a view asks for the first time (its own culled meshes): patch those, then count.
          g.advance(1 / 60);
          inspect.scene.traverse(patch);
          // Only the frame after this is counted.
          tally.clear();
          for (const a of [perView.main, perView.shadow, tris.main, tris.shadow]) a.fill(0);
          inspect.renderer.info.reset();
          g.advance(1 / 60);
          const calls = inspect.renderer.info.render.calls;
          const triangles = inspect.renderer.info.render.triangles;
          const rows = [...tally.entries()].map(([k, v]) => ({ k, main: v.main, shadow: v.shadow, objects: v.objects.size, tris: v.tris }));
          // What the first two levels of the scene are, to read the paths by.
          const legend = [];
          inspect.scene.children.forEach((a, i) => {
            legend.push(`${i} ${a.type}${a.isLight ? "" : ` (${a.children.length})`}`);
            if (a.children.length > 1 && a.children.length < 60) a.children.forEach((b, j) => legend.push(`${i}.${j} ${b.type}${b.isInstancedMesh ? " inst" : ""} (${b.children.length}) ${b.geometry?.attributes?.position?.count ?? ""}`));
          });
          return { calls, triangles, perView, tris, rows, legend };
        }, SECONDS);
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        console.log(`\n${track} ${views}v ${tier}: ${r.calls} calls, ${Math.round(r.triangles / 1000)}k triangles (renderer.info)`);
        console.log(`  by view   main ${r.perView.main.join(" ")}   shadow ${r.perView.shadow.join(" ")}   | k triangles main ${r.tris.main.map((t) => Math.round(t / 1000)).join(" ")}  shadow ${r.tris.shadow.map((t) => Math.round(t / 1000)).join(" ")}`);
        const rows = r.rows.sort((a, b) => sum(b.main) + sum(b.shadow) - sum(a.main) - sum(a.shadow));
        for (const row of rows.slice(0, TOP)) console.log(`  ${String(sum(row.main)).padStart(4)} + ${String(sum(row.shadow)).padStart(3)} shadow  ${String(Math.round(row.tris / 1000)).padStart(5)}k tris  (${String(row.objects).padStart(3)} objects)  ${row.k}`);
        if (args.legend) console.log("  scene: " + r.legend.join(" | "));
        if (rows.length > TOP) console.log(`  ... ${rows.length - TOP} more kinds: ${sum(rows.slice(TOP).map((x) => sum(x.main) + sum(x.shadow)))} calls`);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
