/**
 * High Noon's standalone dev harness, served by Vite at
 * /src/games/western/dev.html (it is not part of the production build):
 * a renderer, a minimal glass HUD implementing HudSink, the mouse as the
 * gun (click fires, right-click or R reloads, leaving the canvas points off
 * the screen), the silent NullAudioBus, a small aim check on the bottles,
 * then the game.
 *
 * Query parameters: ?seed=N, ?wave=N, ?noon=1|0, ?golden=1, ?god=1,
 * ?quality=low|medium|high, ?skipcalib=1, ?manual=1 (no rAF loop; drive it
 * from window.__handy), ?w=&h=&dpr= (a fixed canvas size, for benchmarks),
 * ?assetBase=/some/folder/ (load town.glb, sky.webp and the characters from
 * there instead of public/assets/western/, to try an export in progress).
 *
 * window.__handy: game (with game.debug: targets(), match(), gallery()...),
 * hud (with .log of every HudSink call), mouse (aimAt, fire, reloadGesture),
 * advance(seconds), bench(frames), pause(), play().
 */
import { SRGBColorSpace, TextureLoader, WebGLRenderer } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NullAudioBus } from "../../audio/index";
import type { Aim, AssetLoader, CalibrationTarget, GameContext, GameStats, HudSink, Quality, Readout } from "../../engine/types";
import type { HighNoon } from "./game";
import { createHighNoon } from "./index";
import { mulberry32 } from "./rules/rng";

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const seed = num("seed", 1851);
const fixedW = num("w", 0);
const fixedH = num("h", 0);
const dpr = num("dpr", Math.min(2, window.devicePixelRatio || 1));
const manual = params.get("manual") === "1";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("c");

// --- the HUD -------------------------------------------------------------------------------

interface HudEvent {
  t: number;
  m: string;
  a: unknown[];
}

class DomHud implements HudSink {
  readonly log: HudEvent[] = [];
  private bannerTimer = 0;
  private secretTimer = 0;
  private edge = $("edge");
  private arc = $("arc");
  private ammoEl = $("ammo");
  private gold = false;
  private note(m: string, a: unknown[]) {
    this.log.push({ t: performance.now(), m, a });
    if (this.log.length > 2000) this.log.shift();
  }
  score(v: number) {
    this.note("score", [v]);
    $("score").textContent = v.toLocaleString("en-US");
  }
  readouts(list: Readout[]) {
    this.note("readouts", [list]);
    $("readouts").innerHTML = list
      .map((r) => `<div class="ro ${r.tone ?? ""}"><span>${r.label}</span><b class="num">${r.value}</b></div>`)
      .join("");
  }
  banner(title: string, subtitle?: string) {
    this.note("banner", [title, subtitle]);
    const b = $("banner");
    (b.querySelector(".t") as HTMLElement).textContent = title;
    (b.querySelector(".s") as HTMLElement).textContent = subtitle ?? "";
    b.classList.add("on");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove("on"), 2600);
  }
  ammo(left: number, capacity: number, reloading: boolean) {
    this.note("ammo", [left, capacity, reloading]);
    const el = this.ammoEl;
    if (el.children.length !== capacity) {
      el.innerHTML = "";
      for (let i = 0; i < capacity; i++) {
        const c = document.createElement("i");
        const a = (i / capacity) * Math.PI * 2 - Math.PI / 2;
        c.style.left = `${46 + Math.cos(a) * 26 - 9}px`;
        c.style.top = `${46 + Math.sin(a) * 26 - 9}px`;
        el.appendChild(c);
      }
    }
    [...el.children].forEach((c, i) => c.classList.toggle("spent", i >= left));
    el.classList.toggle("reloading", reloading);
    el.classList.toggle("gold", this.gold);
  }
  revolverFinish(finish: "steel" | "gold") {
    this.gold = finish === "gold";
    this.ammoEl.classList.toggle("gold", this.gold);
  }
  damage(direction: number, hurt: number) {
    this.note("damage", [direction, hurt]);
    this.arc.style.transform = `rotate(${direction}rad)`;
    this.arc.style.transition = "none";
    this.arc.style.opacity = "1";
    requestAnimationFrame(() => {
      this.arc.style.transition = "opacity 900ms";
      this.arc.style.opacity = "0";
    });
    this.health(hurt);
  }
  health(hurt: number) {
    this.edge.style.opacity = String(Math.min(1, hurt * 0.6));
  }
  hitMarker(x: number, y: number, kind: "hit" | "headshot" | "kill") {
    this.note("hitMarker", [x, y, kind]);
    const m = document.createElement("div");
    m.className = `marker ${kind}`;
    m.style.left = `${x * 100}%`;
    m.style.top = `${y * 100}%`;
    $("hud").appendChild(m);
    setTimeout(() => m.remove(), 400);
  }
  popup(x: number, y: number, text: string, tone?: "" | "gold" | "danger") {
    this.note("popup", [x, y, text, tone]);
    const p = document.createElement("div");
    p.className = `popup num ${tone ?? ""}`;
    p.textContent = text;
    p.style.left = `${x * 100}%`;
    p.style.top = `${y * 100}%`;
    $("hud").appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
  secret(name: string, found: number, total: number) {
    this.note("secret", [name, found, total]);
    const s = $("secret");
    (s.querySelector(".n") as HTMLElement).textContent = `${name} · ${found} of ${total}`;
    s.classList.add("on");
    clearTimeout(this.secretTimer);
    this.secretTimer = window.setTimeout(() => s.classList.remove("on"), 3200);
  }
  hint(text: string | null) {
    this.note("hint", [text]);
    const h = $("hint");
    if (text) h.textContent = text;
    h.classList.toggle("on", !!text);
  }
  gameOver(stats: GameStats) {
    this.note("gameOver", [stats]);
    const r = $("results");
    r.innerHTML = `<div class="k">High Noon</div><div class="o">${stats.outcome}</div><div class="sc num">${stats.score.toLocaleString("en-US")}</div>
      <div class="grid">${stats.stats.map((s) => `<div><div class="v num">${s.value}</div><div class="k">${s.label}</div></div>`).join("")}</div>
      <div class="secrets num">Secrets ${stats.secretsFound} / ${stats.secretsTotal}</div>`;
    r.classList.add("on");
  }
}

// --- the gun: the mouse -----------------------------------------------------------------------

class MouseAim {
  readonly aim: Aim = { x: 0.5, y: 0.5, tracking: true, armed: true, fired: false, travel: 0, offscreen: false, capturedAt: 0 };
  private pendingFire = false;
  private offscreenFrames = 0;
  private outside = false;
  constructor(el: HTMLElement) {
    el.addEventListener("pointermove", (e) => this.move(e.clientX, e.clientY));
    el.addEventListener("pointerdown", (e) => {
      this.move(e.clientX, e.clientY);
      if (e.button === 0) this.pendingFire = true;
      if (e.button === 2) this.offscreenFrames = 3; // right-click: the reload gesture
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerleave", () => (this.outside = true));
    el.addEventListener("pointerenter", () => (this.outside = false));
  }
  move(cx: number, cy: number) {
    const r = canvas.getBoundingClientRect();
    this.aim.x = (cx - r.left) / r.width;
    this.aim.y = (cy - r.top) / r.height;
    const cross = $("cross");
    cross.style.left = `${cx}px`;
    cross.style.top = `${cy}px`;
  }
  /** Scripted control, for headless play. */
  aimAt(x: number, y: number) {
    const r = canvas.getBoundingClientRect();
    this.move(r.left + x * r.width, r.top + y * r.height);
  }
  fire() {
    this.pendingFire = true;
  }
  reloadGesture() {
    this.offscreenFrames = 3;
  }
  sample(now: number): Aim {
    const a = this.aim;
    a.fired = this.pendingFire;
    this.pendingFire = false;
    a.travel = a.fired ? 1 : 0;
    a.offscreen = this.outside || this.offscreenFrames > 0;
    if (this.offscreenFrames > 0) this.offscreenFrames--;
    a.capturedAt = now;
    return a;
  }
}

// --- assets --------------------------------------------------------------------------------------

function assetLoader(): AssetLoader {
  const draco = new DRACOLoader().setDecoderPath("/node_modules/three/examples/jsm/libs/draco/gltf/");
  const gltf = new GLTFLoader().setDRACOLoader(draco);
  const textures = new TextureLoader();
  const fix = (u: string) => (u.startsWith("./") ? `/${u.slice(2)}` : u);
  return {
    gltf: (url, onProgress) =>
      new Promise((resolve, reject) =>
        gltf.load(
          fix(url),
          (g) => resolve({ scene: g.scene, animations: g.animations }),
          (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
          reject,
        ),
      ),
    texture: (url) =>
      new Promise((resolve, reject) =>
        textures.load(
          fix(url),
          (t) => {
            t.colorSpace = SRGBColorSpace;
            resolve(t);
          },
          undefined,
          reject,
        ),
      ),
  };
}

// --- boot -----------------------------------------------------------------------------------------

async function main() {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  const size = () => ({ w: fixedW || window.innerWidth, h: fixedH || window.innerHeight });
  const { w, h } = size();
  renderer.setSize(w, h, !fixedW);
  if (fixedW) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const hud = new DomHud();
  const mouse = new MouseAim(canvas);
  const quality: Quality = { scale: 1, tier: (params.get("quality") as Quality["tier"]) || "high" };
  const unlocks = new Set<string>();
  if (params.get("golden") === "1") unlocks.add("golden");
  const ctx: GameContext = {
    renderer,
    canvas,
    audio: new NullAudioBus(),
    hud,
    assets: assetLoader(),
    settings: { duration: 60, reducedMotion: false, reducedFlashing: false, difficulty: "standard", unlocks, tipsSeen: new Set() },
    quality,
    random: mulberry32(seed),
    clock: () => new Date(),
  };
  const noonParam = params.get("noon");
  const game: HighNoon = await createHighNoon({
    startWave: num("wave", 1),
    immortal: params.get("god") === "1",
    ...(noonParam === null ? {} : { noon: noonParam === "1" }),
    ...(params.has("assetBase") ? { assetBase: params.get("assetBase") as string } : {}),
  });
  await game.load(ctx, (f) => ($("load").textContent = `Getting ready… ${Math.round(f * 100)}%`));
  $("load").remove();
  game.resize(w, h, dpr);
  window.addEventListener("resize", () => {
    if (fixedW) return;
    const s = size();
    renderer.setSize(s.w, s.h);
    game.resize(s.w, s.h, dpr);
  });

  // The aim check, harness-sized: five bottles, a ring on the one to shoot.
  const calib = { active: params.get("skipcalib") !== "1", hits: 0, lit: null as CalibrationTarget | null, shots: 0 };
  const ring = $("ring");
  const calibEl = $("calib");
  const lightNext = () => {
    const ts = game.calibration.targets();
    calib.lit = ts[(calib.hits * 4) % Math.max(1, ts.length)] ?? null;
    game.calibration.light(calib.lit?.id ?? null);
    calibEl.style.display = "block";
    calibEl.textContent = `Warm up on the bottles · ${calib.hits} of 5`;
  };
  const finishCalib = () => {
    calib.active = false;
    ring.style.display = "none";
    calibEl.style.display = "none";
    game.calibration.done();
    game.start();
  };
  if (calib.active) lightNext();
  else finishCalib();

  const judgeCalibration = (aim: Aim) => {
    if (!calib.active || !aim.fired || !calib.lit) return;
    calib.shots++;
    const r = canvas.getBoundingClientRect();
    const minSide = Math.min(r.width, r.height);
    const dx = ((aim.x - calib.lit.x) * r.width) / minSide;
    const dy = ((aim.y - calib.lit.y) * r.height) / minSide;
    if (Math.hypot(dx, dy) <= calib.lit.radius * 1.3) {
      game.calibration.hit(calib.lit.id);
      calib.hits++;
      if (calib.hits >= 5) setTimeout(finishCalib, 600);
      else lightNext();
    } else {
      game.calibration.miss(calib.lit.id, aim.x, aim.y);
    }
  };

  const drawRing = () => {
    if (!calib.active || !calib.lit) return;
    const t = game.calibration.targets().find((x) => x.id === calib.lit?.id);
    if (!t) return;
    const r = canvas.getBoundingClientRect();
    const rad = t.radius * Math.min(r.width, r.height);
    ring.style.display = "block";
    ring.style.left = `${r.left + t.x * r.width - rad}px`;
    ring.style.top = `${r.top + t.y * r.height - rad}px`;
    ring.style.width = ring.style.height = `${rad * 2}px`;
  };

  let last = performance.now();
  const frame = (dt: number, now: number) => {
    const aim = mouse.sample(now);
    judgeCalibration(aim);
    game.update(dt, now, aim);
    game.render();
    drawRing();
  };
  let running = !manual;
  let simNow = 0;
  const loop = (now: number) => {
    if (running) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame(dt, now);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const handy = {
    game,
    hud,
    mouse,
    renderer,
    /** Stop the real-time loop (scripts then call advance). */
    pause: () => (running = false),
    play: () => {
      last = performance.now();
      running = true;
    },
    /** Step the game `seconds` forward in fixed 60 Hz frames, rendering the last. */
    advance: (seconds: number, renderEach = false) => {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) {
        simNow += 1000 / 60;
        const aim = mouse.sample(simNow);
        judgeCalibration(aim);
        game.update(1 / 60, simNow, aim);
        if (renderEach || i === n - 1) game.render();
      }
      drawRing();
    },
    /** Frame cost: `frames` updates + renders at 60 Hz steps, each waited on by the GPU. */
    bench: (frames: number) => {
      const times: number[] = [];
      const cpu: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        simNow += 1000 / 60;
        game.update(1 / 60, simNow, mouse.sample(simNow));
        game.render();
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const t2 = performance.now();
        cpu.push(t1 - t0);
        times.push(t2 - t0);
      }
      const stat = (a: number[]) => {
        const s = [...a].sort((x, y) => x - y);
        const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
        return { mean: a.reduce((x, y) => x + y, 0) / a.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] as number };
      };
      return { frame: stat(times), cpu: stat(cpu), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    glInfo: () => {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },
    calib,
    finishCalib,
  };
  (window as unknown as { __handy: typeof handy }).__handy = handy;
  document.body.dataset["ready"] = "1";
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("load");
  if (el) el.textContent = String(err);
});
