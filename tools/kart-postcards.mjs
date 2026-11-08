// Takes Grip Prix's track-picker postcards: public/assets/kart/tracks/<trackId>.webp, 960x540, at most 90 KB each,
// rendered in the game's own renderer (the dev page's ?shot= hook, src/kart/render/shot.ts) with the Blender art.
//
//   npx vite --port 5195 --host 127.0.0.1          in another terminal (stop it when done)
//   node tools/kart-postcards.mjs                  all nine
//   node tools/kart-postcards.mjs fun-fair canyon-run
//   node tools/kart-postcards.mjs --draft [ids]    960x540 PNGs in $TMPDIR/kart-postcards-draft (or --out DIR), to tune a pose
//   --keep DIR          also keeps the downscaled 960x540 PNGs of a real run
//   --ss N              supersampling (default 3: drawn at 2880x1620, then brought down to 960x540)
//   --poses FILE.json   try poses without editing the table below (same shape; "track@variant" keys try several on one track)
//
// Each card is drawn in quality high with the HUD hidden and the sound muted, the dev page held still (shot.ts),
// downscaled with Pillow's LANCZOS and encoded by cwebp (-m 6 -sharp_yuv) at the highest quality that fits MAX_BYTES.
// Needs python3 with Pillow, cwebp (brew install webp) and Chrome. After each card it says which karts are in the
// frame (3 to 5 wanted; their length in pixels of the 960 px card) and which landmarks. If a Blender model fails to
// load, this stops: the pictures would show the code-built stand-ins, not the Blender art.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(ROOT, "package.json"));
const { chromium } = require("playwright-core");

const BASE = process.env.POSTCARD_BASE ?? "http://127.0.0.1:5195/src/kart/render/dev.html";
const OUT_DIR = resolve(ROOT, "public/assets/kart/tracks");
const WIDTH = 960;
const HEIGHT = 540;
/** "At most 90 KB", read as decimal kilobytes to be safe. */
const MAX_BYTES = 90_000;
const CWEBP = process.env.CWEBP ?? (existsSync("/opt/homebrew/bin/cwebp") ? "/opt/homebrew/bin/cwebp" : "cwebp");

/**
 * One pose per track (the dev page's ?shot=; the fields are in the header of src/kart/render/shot.ts). eye and
 * target are points in the track's own frame: a landmark (lm) or a lap fraction (at), `d` metres along the road,
 * `off` metres right of the centre line, `up` metres above it. fov: vertical, degrees. roll: degrees (+ lifts the
 * horizon on the right). at: the lap fraction the karts and the points start from. karts: where each of the eight
 * (ids 0..7) stands when the picture is taken (the others are put out of the world); focus: the hero kart, whose
 * shadow the renderer draws best. boxes: false leaves the item boxes out. time: the race clock, for the hazards.
 * The drivers: 0 Bun, 1 Pepper, 2 Moss, 3 Kit, 4 Juniper, 5 Mango, 6 Bramble, 7 Rivet.
 */
const POSES = {
  "meadow-loop": {
    // The windmill and the tethered balloons from the outside of the left-hand bend that wraps the hill; Bun drifts with orange sparks.
    at: 0.26,
    boxes: false,
    focus: 0,
    eye: { d: 16.5, off: 6.5, up: 0.5 },
    target: { lm: "windmill", d: -18, off: 34, up: 15 },
    fov: 56,
    roll: -3,
    karts: [
      { id: 0, d: 11, off: -2.0, boost: 1.2, drift: "auto", level: 2 },
      { id: 3, d: 6, off: 2.4 },
      { id: 1, d: 1, off: -2.8 },
      { id: 2, d: -4, off: 1.8 },
    ],
  },
  "kitchen-rally": {
    // From the counter's edge, a little above the road: the teapot, fruit bowl and clock over the sugar-cube wall, late-afternoon light.
    at: 0.02,
    boxes: false,
    focus: 5,
    eye: { d: 4, off: -12.5, up: 2.6 },
    target: { lm: "teapot", d: 5, off: -22, up: 6 },
    fov: 58,
    roll: 3,
    karts: [
      { id: 5, d: 8, off: -2.0, boost: 1.2 },
      { id: 3, d: 1.5, off: 2.4 },
      { id: 1, d: -4.5, off: -2.4 },
      { id: 0, d: -10.5, off: 2.2 },
    ],
  },
  "harbour-lights": {
    // Night on the quay, from behind: the karts drive away from us past the lighthouse and its beam, a crane and the town's
    // lights, and what glows is their tail lamps and Juniper's flame (head on, the headlights were big white blobs on the road).
    at: 0.235,
    boxes: false,
    focus: 4,
    eye: { d: 30, off: -4.5, up: 0.7 },
    target: { at: 0.235, d: 12, off: 12, up: 8 },
    fov: 62,
    roll: 3,
    karts: [
      { id: 4, d: 21, off: 2.8, boost: 0.6, yaw: 3.4 },
      { id: 0, d: 17, off: -3.2, yaw: 3.0 },
      { id: 1, d: 12, off: 0.6, yaw: 3.2 },
      { id: 3, d: 7, off: -1.8, yaw: 3.1 },
    ],
  },
  "canyon-run": {
    // The dynamite cannon at the end of the ridge: Pepper and Bun in the air over the gorge, Kit on the pad, the barrels beside the road, mesas in golden light.
    at: 0.387,
    boxes: false,
    focus: 1,
    eye: { d: -10, off: 9, up: 6.5 },
    target: { d: 52, off: 0, up: 3 },
    fov: 64,
    roll: -2,
    karts: [
      { id: 1, d: 38, off: -0.5, boost: 1.2, up: 8.5, speed: 30 },
      { id: 0, d: 26, off: 3.0, up: 7.5, speed: 30 },
      { id: 3, d: 12, off: -3.0, up: 4.0, speed: 30 },
      { id: 2, d: -2, off: 1.4, speed: 30 },
    ],
  },
  "fun-fair": {
    // Under the Ferris wheel the road runs beneath: its cars swing overhead, the coaster and the lights behind, the pack driving in.
    at: 0.466,
    boxes: false,
    focus: 2,
    eye: { d: -12, off: -3.5, up: 0.9 },
    target: { d: 26, off: -1, up: 21 },
    fov: 64,
    roll: 2,
    karts: [
      { id: 2, d: 12, off: 1.2, boost: 1.2 },
      { id: 0, d: 8, off: -3.2 },
      { id: 3, d: 3, off: 3.4 },
      { id: 1, d: -2, off: -1.4 },
    ],
  },
  "glacier-pass": {
    // The ski-jump: the pack gliding off the brow over the crevasse, the blue ice below the road, the mountains and the aurora beyond.
    at: 0.6875,
    boxes: false,
    focus: 0,
    eye: { d: -6, off: 12, up: 7 },
    target: { d: 55, off: -2, up: 1 },
    fov: 62,
    roll: -3,
    karts: [
      { id: 0, d: 40, off: -1.0, boost: 1.2, up: 8.5, speed: 30 },
      { id: 3, d: 28, off: 3.8, up: 8.0, speed: 30 },
      { id: 1, d: 14, off: -4.5, up: 4.5, speed: 30 },
      { id: 5, d: 0, off: 2.0, speed: 30 },
    ],
  },
  "volcano-rush": {
    // Under the lava bombs: the crater rim, the lava tube glowing at the right, a kart boosting ahead.
    at: 0.4215,
    boxes: false,
    focus: 1,
    time: 3.4,
    eye: { d: -22, off: 2.5, up: 2.2 },
    target: { d: 22, off: -1, up: 6 },
    fov: 62,
    roll: 2,
    karts: [
      { id: 1, d: -8, off: -0.5, boost: 1.2 },
      { id: 0, d: -3, off: 3.4 },
      { id: 3, d: 2, off: -3.4 },
      { id: 2, d: 7, off: 1.4 },
    ],
  },
  "starlight-ribbon": {
    // The ribbon at the fork: the comet trail splitting off beside the aurora, meteors on the horizon.
    at: 0.082,
    boxes: false,
    focus: 3,
    time: 2.0,
    eye: { d: -22, off: 2.5, up: 2.4 },
    target: { d: 26, off: -5, up: 4 },
    fov: 62,
    roll: 2,
    karts: [
      { id: 3, d: -8, off: 1.0, boost: 1.2 },
      { id: 0, d: -3, off: -4.0 },
      { id: 1, d: 2, off: 4.0 },
      { id: 5, d: 6, off: -1.2 },
    ],
  },
  "five-finger-circuit": {
    // Under the giant wristwatch that is the start gantry, the surfboards, bunting and palms of the island.
    at: 0.0,
    boxes: false,
    focus: 0,
    eye: { d: -40, off: 0.5, up: 0.6 },
    target: { d: 4, off: 0, up: 8.5 },
    fov: 60,
    roll: -2,
    karts: [
      { id: 0, d: -33, off: 3.4, yaw: -0.12 },
      { id: 3, d: -27, off: -2.8, boost: 1.2 },
      { id: 1, d: -21, off: 1.8 },
      { id: 5, d: -15, off: -2.2 },
    ],
  },
};

// ───────────────────────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const draft = flag("--draft");
const tried = option("--poses") ? JSON.parse(readFileSync(resolve(option("--poses")), "utf8")) : null;
if (tried) Object.assign(POSES, tried);
const valueOf = new Set([option("--out"), option("--poses"), option("--ss"), option("--keep")].filter(Boolean));
const wanted = args.filter((a) => !a.startsWith("--") && !valueOf.has(a));
const ids = wanted.length ? wanted : Object.keys(tried ?? POSES);
for (const id of ids) if (!POSES[id]) throw new Error(`no pose for "${id}" (have: ${Object.keys(POSES).join(", ")})`);

const outDir = draft ? resolve(option("--out") ?? join(tmpdir(), "kart-postcards-draft")) : OUT_DIR;
mkdirSync(outDir, { recursive: true });
const keepDir = option("--keep") ? resolve(option("--keep")) : null;
if (keepDir) mkdirSync(keepDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "kart-postcards-"));

const PY_DOWNSCALE = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im = im.resize((${WIDTH}, ${HEIGHT}), Image.LANCZOS)
im.save(sys.argv[2])
`;

/** Encodes `png` as the webp at the highest quality that stays within MAX_BYTES (the size only grows with it); returns { bytes, quality }. */
function encode(png, webp) {
  const at = (q) => {
    execFileSync(CWEBP, ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-sns", "60", "-f", "30", "-pass", "10", png, "-o", webp]);
    return statSync(webp).size;
  };
  let lo = 40;
  let hi = 98;
  if (at(lo) > MAX_BYTES) throw new Error(`${webp}: cannot get under ${MAX_BYTES} bytes`);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= MAX_BYTES) lo = mid;
    else hi = mid;
  }
  return { bytes: at(lo), quality: lo };
}

/** What is in the frame (from shot.ts's projection): the karts with their length in pixels of the 960 wide card, and the landmarks nearest the lens. */
function describe(info) {
  const inside = (p) => p.depth > 0 && p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98;
  const karts = info.karts.filter(inside);
  const kartText = karts.map((k) => `#${k.id}(${k.x.toFixed(2)},${k.y.toFixed(2)} ${Math.round(k.length)}px ${Math.round(k.depth)}m)`).join(" ");
  const marks = info.landmarks
    .filter((l) => inside(l) && l.depth < 400)
    .sort((a, b) => a.depth - b.depth)
    .slice(0, 6)
    .map((l) => `${l.kind}(${l.x.toFixed(2)},${l.y.toFixed(2)} ${Math.round(l.depth)}m)`)
    .join(" ");
  return { count: karts.length, text: `   karts ${karts.length}: ${kartText}\n   landmarks: ${marks}` };
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--mute-audio", "--autoplay-policy=user-gesture-required", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
try {
  const scale = draft ? 1 : Number(option("--ss") ?? 3);
  const context = await browser.newContext({ viewport: { width: WIDTH * scale, height: HEIGHT * scale }, deviceScaleFactor: 1 });
  // Nothing here may ever make a sound: muted in the browser, and in the game's own setting.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("handy.muted.v1", "true");
    } catch {
      // no storage: the browser is muted anyway
    }
  });
  for (const id of ids) {
    const page = await context.newPage();
    const problems = [];
    const fatal = [];
    page.on("console", (m) => {
      // The failed requests are told by their URLs below; the browser's own note of them carries none.
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(`console: ${m.text().slice(0, 300)}`);
    });
    page.on("response", (r) => {
      if (r.status() < 400 || r.url().endsWith("favicon.ico")) return;
      problems.push(`${r.status()} ${r.url().slice(0, 160)}`);
      // The modelled art, or what decodes it, is missing: the picture would show the code-built stand-ins.
      if (/\.(glb|wasm)$|draco/.test(r.url())) fatal.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 400)}`));
    // "track@variant" keys (in a --poses file) try several poses on one track.
    const url = `${BASE}?track=${id.split("@")[0]}&quality=high&go=1&hud=0&shot=${encodeURIComponent(JSON.stringify(POSES[id]))}`;
    try {
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction("window.__shotReady === true", null, { timeout: 120_000, polling: 250 });
    } catch (e) {
      for (const p of problems) console.log(`   ${p}`);
      throw new Error(`${id}: the dev page did not get to the picture (is vite running? ${BASE}): ${String(e).split("\n")[0]}`);
    }
    await page.waitForTimeout(300);
    const stats = await page.evaluate("window.__grip.stats()");
    const info = await page.evaluate("window.__shotInfo");
    const raw = join(work, `${id}-full.png`);
    await page.screenshot({ path: raw, type: "png" });
    await page.close();
    if (fatal.length) throw new Error(`${id}: the art did not load (${fatal.join(", ")}): the dev server must be able to serve node_modules (vite.config.ts allows its real path).`);
    if (stats.tier !== "high" || stats.resolutionScale < 1) throw new Error(`${id}: rendered at tier ${stats.tier}, scale ${stats.resolutionScale}: not full quality`);
    const small = draft ? join(outDir, `${id}.png`) : join(work, `${id}.png`);
    execFileSync("python3", ["-c", PY_DOWNSCALE, raw, small]);
    if (draft) {
      console.log(`${small}  (drawn at ${WIDTH * scale}x${HEIGHT * scale})`);
    } else {
      const webp = join(outDir, `${id}.webp`);
      const { bytes, quality } = encode(small, webp);
      console.log(`${webp}  ${(bytes / 1000).toFixed(1)} KB  q${quality}  (drawn at ${Math.round(WIDTH * scale)}x${Math.round(HEIGHT * scale)}, ${stats.gpu.slice(0, 28)})`);
      if (keepDir) copyFileSync(small, join(keepDir, `${id}.png`));
    }
    const seen = describe(info);
    console.log(seen.text);
    if (seen.count < 3 || seen.count > 5) console.log(`   WARNING: ${seen.count} karts in the picture (3 to 5 wanted)`);
    for (const p of problems.slice(0, 5)) console.log(`   ${p}`);
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
