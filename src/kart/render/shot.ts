/**
 * DEV ONLY: the capture hook of the renderer's dev page (dev.ts, ?shot=...), used by tools/kart-postcards.mjs
 * to take the track-picker postcards. Nothing in the game imports this file (the game's entries are index.html
 * and race.html; dev.html is not one of them).
 *
 * A shot freezes the demo at a chosen moment: the cameras, the karts and the race clock are set by a pose, the
 * karts are run into place for `pre` seconds (so their dust, sparks and lean settle the way they do in a race),
 * and the picture is then held. `window.__shotReady` becomes true when it is on screen, and `window.__shotInfo`
 * says where the karts and the track's landmarks fall in the picture (see `toScreen`), for tuning a pose.
 *
 *   ?shot={"eye":{"lm":"windmill","d":-30,"off":8,"up":2},"target":{"lm":"windmill","up":18},"fov":50,
 *          "at":0.2,"karts":[{"id":0,"d":0,"off":-1,"drift":"auto"}],"time":14}
 *
 * Points (eye, target) are in the track's own frame:
 *   lm    a landmark of the track's list by kind ("windmill"), or "kind#n" for the nth one of that kind; the point
 *         starts at the landmark's `at` and `offset`
 *   at    otherwise, a fraction of the lap (default: the shot's `at`)
 *   d     metres along the road from there (negative: back), following the road's bends
 *   off   metres right of the centre line (added to the landmark's offset)
 *   up    metres above the road there
 *   x y z absolute world coordinates, replacing the matching component where given
 *
 * Karts are placed the same way (`at`, `d`, `off`, no landmark), face along the road and drive at `speed`; the
 * ones a shot does not name are put out of the world. The demo has eight, ids 0 to 7.
 */
import type { KartView, RaceView, RacerSetup, TrackDef } from "../contract";
import { TrackGeometry } from "../track/geometry";
import type { DemoRace } from "./demo";
import type { GripRenderer } from "./renderer";

export interface ShotPoint {
  lm?: string;
  at?: number;
  d?: number;
  off?: number;
  up?: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface ShotKart {
  id: number;
  /** Where it ends up (the shot's `at` if unset): a fraction of the lap, metres along and right of the centre line. */
  at?: number;
  d?: number;
  off?: number;
  /** m/s; it is run up to its place at this speed (default 22). */
  speed?: number;
  /** Its lane at the start of the run-up, to arrive on a diagonal (default: `off`). */
  offFrom?: number;
  /** -1 left, 1 right, "auto" the way the road bends there. */
  drift?: -1 | 0 | 1 | "auto";
  /** 0..2: the colour of the sparks. */
  level?: 0 | 1 | 2;
  /** Seconds of boost (flames), held for the whole run. */
  boost?: number;
  /** -1..1 (default: with a drift "auto", what the bend asks). */
  steer?: number;
  /** Radians the body points left of the road's direction. */
  yaw?: number;
  /** Metres above the road (a jump), and the `hop` the picture reads with it. */
  up?: number;
  emote?: "cheer" | "wave";
}

export interface Shot {
  eye: ShotPoint;
  target: ShotPoint;
  /** Vertical field of view, degrees (default 55). */
  fov?: number;
  /** Tilt of the picture, degrees (+ lifts the horizon on the right). */
  roll?: number;
  /** The lap fraction every kart's `at` and the points' default come from. */
  at?: number;
  karts?: ShotKart[];
  /** Which kart the renderer follows: its light and shadow are what is drawn best (default 0). */
  focus?: number;
  /** The race clock the hazards (rolling boulders, crabs) are read at, seconds (default 20). */
  time?: number;
  /** Seconds the karts run into place, 0.3..4 (default 1.2). */
  pre?: number;
  /** false: the item boxes along the road are left out of the picture (default: they are drawn). */
  boxes?: boolean;
}

const PRE_DT = 1 / 60;
const ASPECT = 16 / 9;

type V3 = { x: number; y: number; z: number };

/**
 * Where a world point lands in the picture of this pose: `x`, `y` from the top left in 0..1, `depth` metres in front
 * of the lens (negative: behind it) and `px` the height in pixels, of a 540 px tall picture, of one metre there.
 * (For tuning a pose: the dev page reports it as `window.__shotInfo`.)
 */
export function toScreen(eye: V3, look: V3, fovDeg: number, rollDeg: number, p: V3): { x: number; y: number; depth: number; px: number } {
  const norm = (v: V3): V3 => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const f = norm({ x: look.x - eye.x, y: look.y - eye.y, z: look.z - eye.z });
  let right = norm(cross(f, { x: 0, y: 1, z: 0 }));
  let up = cross(right, f);
  // The renderer turns the camera by -roll about its own back axis (see GripRenderer.setDebugCamera).
  const a = (-rollDeg * Math.PI) / 180;
  const r2 = { x: right.x * Math.cos(a) + up.x * Math.sin(a), y: right.y * Math.cos(a) + up.y * Math.sin(a), z: right.z * Math.cos(a) + up.z * Math.sin(a) };
  const u2 = { x: up.x * Math.cos(a) - right.x * Math.sin(a), y: up.y * Math.cos(a) - right.y * Math.sin(a), z: up.z * Math.cos(a) - right.z * Math.sin(a) };
  right = r2;
  up = u2;
  const v = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
  const depth = v.x * f.x + v.y * f.y + v.z * f.z;
  const half = Math.tan((fovDeg * Math.PI) / 360);
  const d = Math.max(1e-3, Math.abs(depth));
  const nx = (v.x * right.x + v.y * right.y + v.z * right.z) / (d * half * ASPECT);
  const ny = (v.x * up.x + v.y * up.y + v.z * up.z) / (d * half);
  return { x: 0.5 + 0.5 * nx, y: 0.5 - 0.5 * ny, depth, px: 270 / (d * half) };
}

/** Parses the `shot` parameter: JSON (null when absent or broken, and the page says so). */
export function parseShot(text: string | null): Shot | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Shot;
    if (s && typeof s === "object" && s.eye && s.target) return s;
  } catch {
    // fall through
  }
  return null;
}

/** The landmark `name` ("kind" or "kind#n") of the track, or undefined. */
export function findLandmark(def: TrackDef, name: string): { at: number; offset: number } | undefined {
  const [kind, nth] = name.split("#");
  const all = (def.landmarks ?? []).filter((l) => l.kind === kind);
  const l = all[nth ? Number(nth) : 0];
  return l ? { at: l.at, offset: l.offset } : undefined;
}

/** A point of the pose in world coordinates. */
export function resolvePoint(g: TrackGeometry, def: TrackDef, p: ShotPoint, defaultAt = 0): { x: number; y: number; z: number } {
  let at = p.at ?? defaultAt;
  let offset = p.off ?? 0;
  if (p.lm !== undefined) {
    const l = findLandmark(def, p.lm);
    if (!l) throw new Error(`${def.id}: no landmark "${p.lm}"`);
    at = l.at;
    offset += l.offset;
  }
  const w = g.point(at * g.length + (p.d ?? 0), offset);
  return { x: p.x ?? w.x, y: p.y ?? w.y + (p.up ?? 0), z: p.z ?? w.z };
}

/** Where, and how, one kart stands `back` seconds before the picture is taken (back = 0: in its place). */
export function kartAt(g: TrackGeometry, shot: Shot, k: ShotKart, back: number): { s: number; offset: number; view: Partial<KartView> } {
  const speed = k.speed ?? 22;
  const s = (k.at ?? shot.at ?? 0) * g.length + (k.d ?? 0) - speed * back;
  const end = k.off ?? 0;
  const pre = Math.max(0.3, Math.min(4, shot.pre ?? 1.2));
  const offset = (k.offFrom ?? end) + (end - (k.offFrom ?? end)) * (1 - back / pre);
  const bend = g.at(s).curvature;
  const drift = k.drift === "auto" ? (Math.abs(bend) > 0.004 ? (Math.sign(bend) as 1 | -1) : 0) : (k.drift ?? 0);
  const steer = k.steer ?? (k.drift === "auto" ? Math.max(-1, Math.min(1, bend * 14)) : 0);
  const view: Partial<KartView> = {
    speed,
    drift,
    driftLevel: drift === 0 ? 0 : (k.level ?? 1),
    boost: k.boost ?? 0,
    steer,
    heading: g.heading(s) + (k.yaw ?? 0),
    emote: k.emote ?? null,
  };
  // In the air: the picture lifts the kart by `hop` less the 0.4 m its body hops on its springs.
  if (k.up) view.hop = k.up + 0.4;
  return { s, offset, view };
}

/** The race view as the shot wants it drawn: without the item boxes when `boxes` is false. */
export function shotView(view: RaceView, shot: Shot): RaceView {
  if (shot.boxes !== false) return view;
  // A sent box that is not active is a taken one, not drawn; leaving them out would hand the road's own rows back.
  return { ...view, things: view.things.map((t) => (t.kind === "box" ? { ...t, active: false } : t)) };
}

/** What the page hands over: the pieces of dev.ts the shot drives. */
export interface ShotContext {
  renderer: GripRenderer;
  demo: DemoRace;
  racers: readonly RacerSetup[];
  track: TrackDef;
  /** Called with each frame's duration, to draw it. */
  draw(dt: number): void;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Runs the shot: the karts into place, a settled picture on screen, then `__shotReady`; the picture is redrawn (still) on every frame after. */
export async function runShot(ctx: ShotContext, shot: Shot): Promise<void> {
  const { renderer, demo, racers, track } = ctx;
  demo.skipCountdown();
  const g = TrackGeometry.build(track);
  const eye = resolvePoint(g, track, shot.eye, shot.at ?? 0);
  const look = resolvePoint(g, track, shot.target, shot.at ?? 0);
  renderer.setDebugCamera({ x: eye.x, y: eye.y, z: eye.z, lookX: look.x, lookY: look.y, lookZ: look.z, fov: shot.fov ?? 55, roll: shot.roll });
  renderer.setViews([shot.focus ?? 0]);

  // The karts the shot does not place are put out of the picture, far beyond the world's edge.
  const karts = shot.karts ?? [];
  const spare = racers.filter((r) => !karts.some((k) => k.id === r.id));

  // What the picture holds, for whoever is tuning the pose.
  const fov = shot.fov ?? 55;
  const roll = shot.roll ?? 0;
  (window as unknown as { __shotInfo: unknown }).__shotInfo = {
    karts: karts.map((k) => {
      const at = kartAt(g, shot, k, 0);
      const w = g.point(at.s, at.offset);
      const sp = toScreen(eye, look, fov, roll, { x: w.x, y: w.y + (at.view.hop ? at.view.hop - 0.4 : 0) + 0.6, z: w.z });
      return { id: k.id, x: sp.x, y: sp.y, depth: sp.depth, length: sp.px * 2.4 };
    }),
    landmarks: (track.landmarks ?? []).map((l) => {
      const w = g.point(l.at * g.length, l.offset);
      const sp = toScreen(eye, look, fov, roll, w);
      return { kind: l.kind, x: sp.x, y: sp.y, depth: sp.depth, scale: l.scale ?? 1 };
    }),
  };

  const pre = Math.max(0.3, Math.min(4, shot.pre ?? 1.2));
  const frames = Math.round(pre / PRE_DT);
  const time = shot.time ?? 20;
  for (let f = 0; f <= frames; f++) {
    const back = Math.max(0, pre - f * PRE_DT);
    for (const k of karts) {
      const at = kartAt(g, shot, k, back);
      demo.teleport(k.id, at.s / g.length, at.offset, k.speed ?? 22);
      demo.override(k.id, at.view);
    }
    for (const r of spare) demo.override(r.id, { x: 90000, z: 90000, speed: 0 });
    demo.timeOverride = time - back;
    ctx.draw(f === 0 ? 0 : PRE_DT);
    if (f % 4 === 0) await nextFrame();
  }
  // Held: drawn again on every frame without time passing, so the screenshot is of a still, finished picture.
  ctx.draw(0);
  await nextFrame();
  ctx.draw(0);
  await nextFrame();
  (window as unknown as { __shotReady: boolean }).__shotReady = true;
  const hold = (): void => {
    ctx.draw(0);
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
}
