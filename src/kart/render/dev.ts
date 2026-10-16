/**
 * The renderer's dev page (src/kart/render/dev.html): the track and eight
 * karts from the demo source (demo.ts, a stand-in for the real sim), the
 * keyboard driving kart 0.
 *
 *   ?track=meadow-loop     which track (an unknown id falls back to the first); dev-kitchen, dev-snow,
 *                          dev-volcano, dev-funfair, dev-space, dev-palm are the test tracks of devTracks.ts
 *   ?mirror=1              the track flipped left for right (mirror mode)
 *   ?theme=canyon          dress the track in another theme (any of the nine)
 *   ?go=1                  skip the countdown
 *   ?hud=0                 hide the HUD (for pictures)
 *   ?at=0.3                start kart 0 at this fraction of the lap (and ?offset=2 metres right of the centre)
 *   ?views=1..4            split screen: kart 0 to 3, one view each
 *   ?quality=low|medium|high
 *   ?scale=1               hold the resolution scale (dynamic resolution off), to compare tiers at equal pixels
 *   ?profile=1             time the frame (CPU phases, GPU views and post) and log every frame to window.__grip.log, for tools/perf/bench.mjs
 *   ?skip=8                run the demo this many seconds before showing it
 *   ?manual=1              no animation-frame loop: __grip.advance(dt = 1/60) steps the source and draws one frame (tools/trailer/race)
 *   ?seed=5                the seed of the real sim (?sim=1)
 *   ?freeze=1              stop the demo (the picture still renders)
 *   ?boxes=rows            leave the item boxes to the track's rows, not the source's things
 *   ?karts=6  ?laps=2
 *   ?turntable=1           just the kart model, on a turntable (see turntable.ts)
 *   ?sim=1                 the real sim for the race (simSource.ts), with ?item=storm &holder=7 &use=12 &drive=1 to show an item
 *   ?shot={json}           a still, posed picture (shot.ts; tools/kart-postcards.mjs takes the track-picker postcards with it): window.__shotReady is true once drawn
 *
 * Arrows or WASD drive, Space drifts, E or Shift uses the item, 1-4 change the
 * views, R restarts, P pauses. Nothing pressed for a few seconds: the
 * autopilot drives.
 */
import type { TrackTheme } from "../track/geometry";
import { mirrorTrack } from "../track/mirror";
import { trackById, TRACKS } from "../track/tracks";
import { DEV_TRACKS, devTrackById } from "./devTracks";
import { createDemoRace, DemoRace, type DemoInput, type RaceViewSource } from "./demo";
import type { Tier } from "./quality";
import { createRaceRenderer, type GripRenderer } from "./renderer";
import { ITEM_ICONS } from "./hud";
import { forgetTaught } from "./itemHint";
import { SimSource } from "./simSource";
import type { ControlKind, ItemKind, RaceView } from "../contract";
import { runTurntable } from "./turntable";
import { parseShot, runShot, shotView } from "./shot";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;
const devPanel = document.getElementById("dev") as HTMLElement;
const loading = document.getElementById("loading") as HTMLElement;

function startRace(): void {
  const wantedTrack = params.get("track") ?? TRACKS[0]!.id;
  const ordinary = devTrackById(wantedTrack) ?? trackById(wantedTrack);
  const track = params.get("mirror") === "1" ? mirrorTrack(ordinary) : ordinary;
  const unknownTrack = [...TRACKS, ...DEV_TRACKS].every((t) => t.id !== wantedTrack);
  const views = Math.max(1, Math.min(4, Number(params.get("views") ?? 1) || 1));
  const quality = (params.get("quality") as Tier | null) ?? "auto";
  const theme = (params.get("theme") as TrackTheme | null) ?? undefined;
  const karts = Number(params.get("karts") ?? 8) || 8;
  const laps = Number(params.get("laps") ?? 0) || undefined;

  // The stand-in source. To try the real sim, make `source` an adapter over it: a RaceViewSource whose
  // `step` runs the race on its fixed tick with the keyboard's DriveInput and whose `view` is `race.view()`.
  // ?inject=<css>: a style added to the page (to try what a rule costs, e.g. no backdrop blur on the HUD's glass).
  if (params.has("inject")) document.head.append(Object.assign(document.createElement("style"), { textContent: params.get("inject") ?? "" }));
  const useSim = params.get("sim") === "1";
  const demo: ReturnType<typeof createDemoRace> | SimSource = useSim
    ? new SimSource(track, {
        karts,
        laps,
        item: (params.get("item") as ItemKind | null) ?? undefined,
        holder: Number(params.get("holder") ?? 0) || 0,
        use: params.has("use") ? Number(params.get("use")) : undefined,
        drive: params.get("drive") === "1",
        seed: params.has("seed") ? Number(params.get("seed")) : undefined,
      })
    : createDemoRace(track, { karts, laps, golden: params.get("golden") === "1" });
  demo.boxesAsThings = params.get("boxes") !== "rows";
  const source: RaceViewSource = demo;
  const scale = params.has("scale") ? Number(params.get("scale")) || undefined : undefined;
  const renderer: GripRenderer = createRaceRenderer(canvas, hudRoot, { quality, theme, resolutionScale: scale });

  const keys = new Set<string>();
  let lastKey = -100;
  let presses = 0;
  let paused = params.get("freeze") === "1";

  const setViews = (n: number): void => renderer.setViews(Array.from({ length: n }, (_, i) => i));

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.repeat) return;
    keys.add(e.code);
    lastKey = performance.now() / 1000;
    if (e.code === "KeyE" || e.code === "ShiftLeft" || e.code === "ShiftRight") presses++;
    if (/^Digit[1-4]$/.test(e.code)) setViews(Number(e.code.slice(5)));
    if (e.code === "KeyR") source.restart();
    if (e.code === "KeyP") paused = !paused;
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));

  const input = (): DemoInput | null => {
    const now = performance.now() / 1000;
    if (now - lastKey > 4 || params.get("noinput") === "1") return null;
    const left = keys.has("ArrowLeft") || keys.has("KeyA");
    const right = keys.has("ArrowRight") || keys.has("KeyD");
    const down = keys.has("ArrowDown") || keys.has("KeyS");
    return { steer: (right ? 1 : 0) - (left ? 1 : 0), throttle: down ? 0 : 1, brake: down ? 1 : 0, drift: keys.has("Space"), itemPresses: presses };
  };

  const resize = (): void => renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  window.addEventListener("resize", resize);

  /** ?profile=1: one row per frame - [interval ms, sim ms, renderer.frame ms, JS heap bytes] - for the bench. */
  const profile = params.get("profile") === "1";
  const log: number[][] = [];
  const marks: Record<string, number> = { start: performance.now() };
  const heap = (): number => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  if (profile) renderer.profile(true);

  (window as unknown as { __grip: unknown }).__grip = {
    renderer,
    demo,
    marks,
    log,
    clearLog: () => {
      log.length = 0;
    },
    stats: () => renderer.stats(),
    setViews,
    /** Forgets who has used an item, so the hints show again (for pictures). */
    forgetTaught,
    setPaused: (p: boolean) => {
      paused = p;
    },
    fps: () => (window as unknown as { __fps?: number }).__fps ?? 0,
  };

  const main = async (): Promise<void> => {
    resize();
    marks.loadStart = performance.now();
    await renderer.load(source.track, source.racers, (f) => {
      loading.textContent = `Getting ready… ${Math.round(f * 100)}%`;
    });
    marks.loaded = performance.now();
    setViews(views);
    // What each kart drives with, for the item hint: kart 0 is the keyboard's; ?controls=wheel,keyboard,gamepad,wheel sets them in order.
    const kinds = (params.get("controls") ?? "keyboard").split(",").filter((k): k is ControlKind => k === "wheel" || k === "keyboard" || k === "gamepad");
    renderer.setControls(Object.fromEntries(kinds.map((kind, i) => [i, kind])));
    resize();
    if (params.get("go") === "1") demo.skipCountdown();
    if (params.get("hud") === "0") hudRoot.style.display = "none";
    if (params.has("at")) demo.teleport(0, Number(params.get("at")), Number(params.get("offset") ?? 0), Number(params.get("speed") ?? 22));
    const skip = Number(params.get("skip") ?? 0) || 0;
    for (let t = 0; t < skip; t += 1 / 30) source.step(1 / 30, null);
    loading.classList.add("done");

    // A posed still (the postcards): the shot runs the frames itself, one pose, no autopilot, no stats on the picture.
    const shot = params.has("shot") ? parseShot(params.get("shot")) : null;
    if (params.has("shot")) {
      devPanel.style.display = "none";
      loading.style.display = "none";
      hudRoot.style.display = "none";
      if (!shot || !(demo instanceof DemoRace)) throw new Error("?shot= needs a JSON pose with eye and target (and not ?sim=1)");
      await runShot({ renderer, demo, racers: source.racers, track: source.track, draw: (dt) => renderer.frame(shotView(source.view(), shot), dt) }, shot);
      return;
    }

    // ?manual=1 (tools/trailer/race): no animation-frame loop. The caller steps the source exactly `dt` and draws one frame
    // with __grip.advance(dt = 1/60, before?), which hands the view back (for the sound); `before` sees the view just
    // ahead of the draw (to set a free camera on it), so the footage is the same on any machine.
    if (params.get("manual") === "1") {
      Object.assign((window as unknown as { __grip: object }).__grip, {
        advance: (dt = 1 / 60, before?: (view: RaceView) => void): RaceView => {
          source.step(dt, null);
          const view = source.view();
          before?.(view);
          renderer.frame(view, dt);
          return view;
        },
      });
      return;
    }

    let last = performance.now();
    let frames = 0;
    let acc = 0;
    let worst = 0;
    // ?fpscap=30 draws every other display frame (to see what the race's rate costs the hand tracker beside it).
    const every = Math.max(1, Math.round(60 / (Number(params.get("fpscap")) || 60)));
    let skipFrames = 0;
    const loop = (now: number): void => {
      if (every > 1 && skipFrames++ % every !== 0) {
        requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const tSim = performance.now();
      if (!paused) source.step(dt, input());
      const t0 = performance.now();
      renderer.frame(source.view(), dt);
      const cpu = performance.now() - t0;
      if (profile) {
        marks.firstFrame ??= performance.now();
        log.push([dt * 1000, t0 - tSim, cpu, heap()]);
      }
      frames++;
      acc += dt;
      worst = Math.max(worst, dt * 1000);
      if (acc >= 0.5) {
        const fps = frames / acc;
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
    };
    requestAnimationFrame(loop);
  };

  main().catch((e) => {
    loading.textContent = `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
    console.error(e);
  });
}

/** ?icons=1: every item's HUD slot in a row, for looking at the icons. */
function iconSheet(): void {
  const root = document.createElement("div");
  root.className = "gp-hud";
  root.style.cssText = "position:fixed;inset:0;background:#5a7a5a;display:flex;flex-wrap:wrap;gap:34px;align-content:center;justify-content:center;pointer-events:none";
  document.body.appendChild(root);
  loading.classList.add("done");
  for (const [kind, body] of Object.entries(ITEM_ICONS)) {
    const view = document.createElement("div");
    view.className = "gp-view";
    view.style.cssText = "position:relative;width:110px;height:120px;--u:1.2";
    view.innerHTML = '<div class="gp-item gp-glass" data-item="' + kind + '" style="position:relative;left:0;top:0;margin:0"><svg viewBox="0 0 24 24">' + body + '</svg></div><div style="color:#fff;font:600 13px system-ui;text-align:center;margin-top:8px">' + kind + "</div>";
    root.appendChild(view);
  }
}

if (params.get("icons") === "1") iconSheet();
else if (params.get("turntable") === "1") runTurntable(canvas, params);
else startRace();
