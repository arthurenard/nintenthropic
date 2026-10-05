/**
 * The renderer's dev page (src/kart/render/dev.html): the track and eight
 * karts from the demo source (demo.ts, a stand-in for the real sim), the
 * keyboard driving kart 0.
 *
 *   ?track=meadow-loop     which track (an unknown id falls back to the first)
 *   ?theme=canyon          dress the track in another theme (meadow | canyon | harbour)
 *   ?views=1..4            split screen: kart 0 to 3, one view each
 *   ?quality=low|medium|high
 *   ?skip=8                run the demo this many seconds before showing it
 *   ?freeze=1              stop the demo (the picture still renders)
 *   ?boxes=rows            leave the item boxes to the track's rows, not the source's things
 *   ?karts=6  ?laps=2
 *
 * Arrows or WASD drive, Space drifts, E or Shift uses the item, 1-4 change the
 * views, R restarts. Nothing pressed for a few seconds: the autopilot drives.
 */
import { trackById, TRACKS } from "../track/tracks";
import type { TrackTheme } from "../track/geometry";
import { createDemoRace, type DemoInput } from "./demo";
import { createRaceRenderer, type GripRenderer } from "./renderer";
import type { Tier } from "./quality";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;
const devPanel = document.getElementById("dev") as HTMLElement;
const loading = document.getElementById("loading") as HTMLElement;

const wantedTrack = params.get("track") ?? TRACKS[0]!.id;
const track = trackById(wantedTrack);
const unknownTrack = TRACKS.every((t) => t.id !== wantedTrack);
const views = Math.max(1, Math.min(4, Number(params.get("views") ?? 1) || 1));
const quality = (params.get("quality") as Tier | null) ?? "auto";
const theme = (params.get("theme") as TrackTheme | null) ?? undefined;
const karts = Number(params.get("karts") ?? 8) || 8;
const laps = Number(params.get("laps") ?? 0) || undefined;

const demo = createDemoRace(track, { karts, laps });
demo.boxesAsThings = params.get("boxes") !== "rows";

const renderer: GripRenderer = createRaceRenderer(canvas, hudRoot, { quality, theme });

const keys = new Set<string>();
let lastKey = -100;
let presses = 0;
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.repeat) return;
  keys.add(e.code);
  lastKey = performance.now() / 1000;
  if (e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight") presses++;
  if (/^Digit[1-4]$/.test(e.code)) setViews(Number(e.code.slice(5)));
  if (e.code === "KeyR") demo.restart();
  if (e.code === "KeyP") paused = !paused;
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));

function input(): DemoInput | null {
  const now = performance.now() / 1000;
  if (now - lastKey > 4 || params.get("noinput") === "1") return null;
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  return {
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    throttle: keys.has("ArrowDown") || keys.has("KeyS") ? 0 : 1,
    brake: keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0,
    drift: keys.has("Space"),
    itemPresses: presses,
  };
}

let paused = params.get("freeze") === "1";
function setViews(n: number): void {
  renderer.setViews(Array.from({ length: n }, (_, i) => i));
}

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}
window.addEventListener("resize", resize);

async function main(): Promise<void> {
  resize();
  await renderer.load(track, demo.racers, (f) => {
    loading.textContent = `Getting ready… ${Math.round(f * 100)}%`;
  });
  setViews(views);
  resize();
  const skip = Number(params.get("skip") ?? 0) || 0;
  for (let t = 0; t < skip; t += 1 / 30) demo.step(1 / 30, null);
  loading.classList.add("done");

  let last = performance.now();
  let frames = 0;
  let acc = 0;
  let fps = 0;
  let worst = 0;
  function loop(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) demo.step(dt, input());
    const t0 = performance.now();
    renderer.frame(demo.view(), dt);
    const cpu = performance.now() - t0;
    frames++;
    acc += dt;
    worst = Math.max(worst, dt * 1000);
    if (acc >= 0.5) {
      fps = frames / acc;
      const s = renderer.stats();
      devPanel.textContent =
        `${fps.toFixed(0)} fps  worst ${worst.toFixed(0)} ms  cpu ${cpu.toFixed(1)} ms\n` +
        `${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(0)}k tris  ${s.views} view${s.views > 1 ? "s" : ""}\n` +
        `${s.tier}  x${s.pixelRatio.toFixed(2)} (res ${s.resolutionScale.toFixed(2)})\n` +
        `${s.gpu.slice(0, 44)}` +
        (unknownTrack ? `\nUnknown track "${wantedTrack}": showing ${track.name}` : "");
      (window as unknown as { __fps: number }).__fps = fps;
      frames = 0;
      acc = 0;
      worst = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

(window as unknown as { __grip: unknown }).__grip = {
  renderer,
  demo,
  stats: () => renderer.stats(),
  setViews,
  fps: () => (window as unknown as { __fps?: number }).__fps ?? 0,
};

main().catch((e) => {
  loading.textContent = `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
  console.error(e);
});
