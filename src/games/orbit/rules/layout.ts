/**
 * Where things are, for the rules: the seven panes of the cupola (a centre,
 * an outward normal and the outline of each window's glass), the lanes the
 * debris comes down, and the spots on the cupola's metal between the
 * windows. The world reads them from the art (cupola.glb's `pane.*` meshes,
 * station.glb's `spawn.*` nodes); the rules only see numbers.
 *
 * `designLayout()` is the cupola as docs/ORBITAL_DECAY.md and the art's
 * build describe it - a truncated hexagonal pyramid, a round window in its
 * top plate and six trapezoids round it, pitched 20° down with the view -
 * worked out in plain maths: the tests play on it, the placeholders are
 * built from it, and the world falls back on it for anything the art lacks.
 *
 * Y up, metres, the eye at the origin looking down −Z and 20° down.
 */
import { mulberry32 } from "../../../engine/rules/rng";
import { add, addScaled, cross, distance, dot, length, normalize, scale, sub, v3, type V3 } from "./vec";

export interface PaneSpec {
  /** 0 the centre window, 1..6 clockwise from the upper-left as the player sees them. */
  id: number;
  center: V3;
  /** Pointing out of the cupola, into space. */
  normal: V3;
  /** The glass's outline, in order round it (a convex polygon in its plane). */
  corners: V3[];
  /** The radius of a disc of the same area, metres. */
  radius: number;
}

export interface Layout {
  eye: V3;
  /** Where the view looks. */
  forward: V3;
  panes: PaneSpec[];
  /** Where debris lanes begin, far out in the view. */
  lanes: V3[];
  /** Spots on the cupola's metal between the windows, where a fragment rings the hull. */
  frame: V3[];
}

/** The pane's name as a player would say it: "the upper-left pane". */
export const PANE_NAMES: readonly string[] = ["centre", "upper-left", "upper-right", "right", "lower-right", "lower-left", "left"];

// --- the view, as the art frames it -----------------------------------------------

export const VIEW_PITCH_DEG = -20;
export const VIEW_FOV_DEG = 62;
export const VIEW_ASPECT = 16 / 9;

const RAD = Math.PI / 180;

/** The view's axes: right, up and forward. */
export function viewAxes(pitchDeg = VIEW_PITCH_DEG): { right: V3; up: V3; forward: V3 } {
  const p = pitchDeg * RAD;
  return { right: v3(1, 0, 0), up: v3(0, Math.cos(p), Math.sin(p)), forward: v3(0, Math.sin(p), -Math.cos(p)) };
}

/** The direction through the art's 16:9 view at (sx, sy), each −1..1 (x right, y up). */
export function viewDir(sx: number, sy: number, aspect = VIEW_ASPECT): V3 {
  const { right, up, forward } = viewAxes();
  const t = Math.tan((VIEW_FOV_DEG * RAD) / 2);
  return normalize(add(add(scale(right, sx * t * aspect), scale(up, sy * t)), forward));
}

/** The point `d` metres out along that direction. */
export function viewPoint(sx: number, sy: number, d: number): V3 {
  return scale(viewDir(sx, sy), d);
}

// --- the cupola, as built ---------------------------------------------------------------

/** Its shape, metres, in its own frame (x right, y along its axis, z up). */
export const CUPOLA = {
  aTop: 1.5,
  rTop: 0.53,
  rCentre: 0.4,
  aBase: 0.26,
  rBase: 1.1,
  winT0: 0.05,
  winT1: 0.63,
  mullion: 0.036,
  shell: 0.075,
} as const;

/** Which pane each facet holds: facet k faces 60k° round the axis (0 right, 90 up). */
export const FACET_PANE: Readonly<Record<number, number>> = { 2: 1, 1: 2, 0: 3, 5: 4, 4: 5, 3: 6 };

/** A point in the cupola's frame, in the world (the cupola is pitched with the view). */
export function fromCupola(x: number, y: number, z: number): V3 {
  const { right, up, forward } = viewAxes();
  return add(add(scale(right, x), scale(forward, y)), scale(up, z));
}

interface Facet {
  phi: number;
  top: V3;
  slant: V3;
  length: number;
  lateral: V3;
  /** Pointing into the cupola. */
  inward: V3;
  half: (t: number) => number;
}

/** Facet k of the six sloping sides, in the cupola's own frame. */
export function facet(k: number): Facet {
  const phi = 60 * k * RAD;
  const d = v3(Math.cos(phi), 0, Math.sin(phi));
  const axis = v3(0, 1, 0);
  const top = add(scale(d, CUPOLA.rTop), scale(axis, CUPOLA.aTop));
  const base = add(scale(d, CUPOLA.rBase), scale(axis, CUPOLA.aBase));
  const s = sub(base, top);
  const len = length(s);
  const slant = normalize(s);
  const lateral = v3(-Math.sin(phi), 0, Math.cos(phi));
  let inward = normalize(cross(lateral, slant));
  if (dot(inward, scale(d, -1)) < 0) inward = scale(inward, -1);
  const half = (t: number) => (CUPOLA.rTop + (CUPOLA.rBase - CUPOLA.rTop) * t) * Math.tan(30 * RAD);
  return { phi, top, slant, length: len, lateral, inward, half };
}

/** A side window's four corners on the inner face (cupola frame), round the pane. */
export function windowCorners(f: Facet): V3[] {
  const at = (t: number, w: number) => add(addScaled(f.top, f.slant, f.length * t), scale(f.lateral, w));
  const w0 = f.half(CUPOLA.winT0) - CUPOLA.mullion;
  const w1 = f.half(CUPOLA.winT1) - CUPOLA.mullion;
  return [at(CUPOLA.winT0, -w0), at(CUPOLA.winT0, w0), at(CUPOLA.winT1, w1), at(CUPOLA.winT1, -w1)];
}

function toWorld(p: V3): V3 {
  return fromCupola(p.x, p.y, p.z);
}

/** The area of a convex polygon. */
function polygonArea(corners: readonly V3[], normal: V3): number {
  let sum = v3();
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as V3;
    const b = corners[(i + 1) % corners.length] as V3;
    sum = add(sum, cross(a, b));
  }
  return Math.abs(dot(sum, normal)) / 2;
}

/** A pane from its outline and outward normal. */
export function paneFrom(id: number, corners: V3[], normal: V3): PaneSpec {
  let c = v3();
  for (const p of corners) c = add(c, p);
  c = scale(c, 1 / Math.max(1, corners.length));
  const n = normalize(normal);
  const area = polygonArea(corners, n);
  return { id, center: c, normal: n, corners, radius: Math.sqrt(area / Math.PI) };
}

/** The seven panes as the cupola is built (the glass on the windows' outer face). */
export function designPanes(): PaneSpec[] {
  const panes: PaneSpec[] = [];
  // The centre window: a circle in the top plate, as a 24-gon.
  const cw: V3[] = [];
  const y = CUPOLA.aTop + CUPOLA.shell * 0.5;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    cw.push(toWorld(v3(CUPOLA.rCentre * Math.cos(a), y, CUPOLA.rCentre * Math.sin(a))));
  }
  panes.push(paneFrom(0, cw, toWorld(v3(0, 1, 0))));
  for (let k = 0; k < 6; k++) {
    const f = facet(k);
    const out = scale(f.inward, -CUPOLA.shell * 0.5);
    const corners = windowCorners(f).map((p) => toWorld(add(p, out)));
    const id = FACET_PANE[k] as number;
    panes.push(paneFrom(id, corners, toWorld(scale(f.inward, -1))));
  }
  panes.sort((a, b) => a.id - b.id);
  return panes;
}

/** Spots on the metal between neighbouring windows: frame strikes land here. */
export function frameSpots(panes: readonly PaneSpec[]): V3[] {
  const centre = panes.find((p) => p.id === 0);
  const sides = panes.filter((p) => p.id !== 0);
  const out: V3[] = [];
  const between = (a: PaneSpec, b: PaneSpec) => {
    const mid = scale(add(a.center, b.center), 0.5);
    const reach = (length(a.center) + length(b.center)) / 2;
    return scale(normalize(mid), reach);
  };
  // Round the ring: each side window and the next one round.
  const ring = [1, 2, 3, 4, 5, 6].map((id) => sides.find((p) => p.id === id)).filter((p): p is PaneSpec => !!p);
  for (let i = 0; i < ring.length; i++) out.push(between(ring[i] as PaneSpec, ring[(i + 1) % ring.length] as PaneSpec));
  if (centre) for (const s of ring) out.push(between(centre, s));
  return out;
}

/** Sixteen lanes over the view, 80 to 120 m out, as the art lays them. */
export function designLanes(seed = 16): V3[] {
  const r = mulberry32(seed);
  const out: V3[] = [];
  for (const sy of [0.25, -0.05, -0.35, -0.65]) {
    for (const sx of [-0.75, -0.25, 0.25, 0.75]) {
      const d = 80 + 40 * r();
      out.push(viewPoint(sx + (r() - 0.5) * 0.24, sy + (r() - 0.5) * 0.16, d));
    }
  }
  return out;
}

/** The whole layout as designed. */
export function designLayout(): Layout {
  const panes = designPanes();
  return { eye: v3(), forward: viewAxes().forward, panes, lanes: designLanes(), frame: frameSpots(panes) };
}

/** A pane by id. */
export function paneById(layout: Layout, id: number): PaneSpec | undefined {
  return layout.panes.find((p) => p.id === id);
}

/** The pane beside `id` round the ring that `toward` lies closer to (for the Derelict's second pane). */
export function neighbourPane(layout: Layout, id: number, toward: V3): PaneSpec | null {
  let best: PaneSpec | null = null;
  let bestD = Infinity;
  const self = paneById(layout, id);
  if (!self) return null;
  for (const p of layout.panes) {
    if (p.id === id) continue;
    const d = distance(p.center, toward) + distance(p.center, self.center) * 0.5;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
