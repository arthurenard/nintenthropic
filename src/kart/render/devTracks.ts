/**
 * One test track per new world for the renderer's dev page (`?track=dev-kitchen`
 * ... `dev-palm`), each using every feature the picture draws (ramps, drops, a
 * verge, surfaces, banking, hazards, landmarks, the duck) so a change to the
 * picture can be judged on all of them at once. They are written with nothing
 * but the shapes of track/geometry.ts, so the real tracks just work.
 *
 * Roads are drawn with a turtle: straights and arcs that close up into a
 * loop (the moves were found by a small search for a good shape; `closeLoop`
 * can still solve two free straights). Fractions of the lap (`at`) are
 * measured from the start line; ramps and gaps sit on the straights.
 */
import type { HazardDef, Landmark, TrackDef, TrackPoint, TrackTheme } from "../track/geometry";

export type Move = ["s", number] | ["a", number, number];

/** A straight of `length` metres. */
const S = (length: number): Move => ["s", length];
/** An arc turning `degrees` (positive: right, as a kart steers) with radius `radius`. */
const A = (degrees: number, radius: number): Move => ["a", degrees, radius];

/** Walks the moves from the start line: every point on the way, and where and which way it ends (heading as contract.ts). */
export function trace(moves: readonly Move[], step = 22): { points: { x: number; z: number }[]; end: { x: number; z: number }; heading: number } {
  const pts: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let h = 0;
  for (const m of moves) {
    if (m[0] === "s") {
      if (m[1] <= 0) continue;
      const n = Math.max(1, Math.round(m[1] / step));
      for (let k = 0; k < n; k++) {
        x += (Math.sin(h) * m[1]) / n;
        z += (Math.cos(h) * m[1]) / n;
        pts.push({ x, z });
      }
    } else {
      const turn = (-m[1] * Math.PI) / 180;
      const len = Math.abs(turn) * m[2];
      const n = Math.max(2, Math.round(len / (step * 0.8)));
      for (let k = 0; k < n; k++) {
        // The chord of a small arc, along the heading at its middle.
        const mid = h + turn / n / 2;
        const half = Math.abs(turn / n) / 2;
        const chord = (len / n) * (half < 1e-6 ? 1 : Math.sin(half) / half);
        x += Math.sin(mid) * chord;
        z += Math.cos(mid) * chord;
        h += turn / n;
        pts.push({ x, z });
      }
    }
  }
  return { points: pts, end: { x, z }, heading: h };
}

/** Metres between where the moves end and the start line: the road's last straight into it. */
const LEAD_IN = 24;

/** A straight whose length is left to `closeLoop`: put two in a road, on stretches that point in different directions. */
export const FREE: Move = ["s", -1];

/**
 * Solves the two FREE straights so the road ends `leadIn` metres short of the start line, heading along it:
 * moving a straight only slides everything after it, so the end is linear in the two lengths.
 */
export function closeLoop(moves: readonly Move[], leadIn = LEAD_IN): Move[] {
  const free = moves.map((m, i) => (m[0] === "s" && m[1] < 0 ? i : -1)).filter((i) => i >= 0);
  if (free.length !== 2) return moves.slice();
  const zeroed = moves.map((m, i): Move => (free.includes(i) ? S(0) : m));
  const base = trace(zeroed).end;
  const dir = (i: number): [number, number] => {
    const t = trace(zeroed.slice(0, i));
    return [Math.sin(t.heading), Math.cos(t.heading)];
  };
  const d1 = dir(free[0]!);
  const d2 = dir(free[1]!);
  const rx = -base.x;
  const rz = -leadIn - base.z;
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  const a = (rx * d2[1] - rz * d2[0]) / det;
  const b = (d1[0] * rz - d1[1] * rx) / det;
  return moves.map((m, i): Move => (i === free[0] ? S(a) : i === free[1] ? S(b) : m));
}

/**
 * The points of a closed road from a list of straights and arcs, with a
 * height for each fraction of the lap. The moves should come back to the
 * start; whatever error is left is spread over the loop with a smooth ease,
 * so the road leaves and joins the start line without a kink.
 */
export function turtle(moves: readonly Move[], height: (t: number) => number = () => 0, step = 22): TrackPoint[] {
  const closed = closeLoop(moves);
  const { points, end } = trace(closed, step);
  // Whatever is left over after the lead-in is eased out over the loop.
  const ex = end.x;
  const ez = end.z + LEAD_IN;
  const total = points.length;
  return points.map((p, i) => {
    const t = i / (total - 1);
    const w = t * t * (3 - 2 * t);
    return {
      x: Math.round((p.x - ex * w) * 10) / 10,
      z: Math.round((p.z - ez * w) * 10) / 10,
      y: Math.round(height(i / total) * 100) / 100,
    };
  });
}

const smooth = (a: number, b: number, t: number): number => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Landmark helper: a name, where, how far from the road, and optional extras. */
const L = (kind: string, at: number, offset: number, extra: Partial<Landmark> = {}): Landmark => ({ kind, at, offset, ...extra });
const H = (kind: string, at: number, motion: HazardDef["motion"], period: number, radius: number, extra: Partial<HazardDef> = {}): HazardDef => ({
  kind,
  at,
  motion,
  period,
  radius,
  ...extra,
});

// ─── Kitchen ─────────────────────────────────────────────────────────────────

export const KITCHEN_MOVES: Move[] = [S(182), A(94, 75), S(41), A(-43, 40), A(52, 70), A(78, 92), S(177), A(103, 118), S(87), A(76, 61)];

export const DEV_KITCHEN: TrackDef = {
  id: "dev-kitchen",
  name: "Dev Kitchen",
  theme: "kitchen",
  laps: 2,
  width: 16,
  points: turtle(KITCHEN_MOVES, (t) => 0.5 * smooth(0.3, 0.4, t) * (1 - smooth(0.45, 0.55, t))),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.06, offset: 0 }, { at: 0.5, offset: -3 }],
  blurb: "A giant kitchen counter at teatime.",
  bank: 14,
  ramps: [{ at: 0.545 }],
  drops: [
    { from: 0.3, to: 0.42, side: "left" },
    { from: 0.558, to: 0.585, side: "both" },
  ],
  verges: [{ from: 0.68, to: 0.78, side: "left", distance: 24, surface: "sand" }],
  surfaces: [
    { from: 0.15, to: 0.2, kind: "ice" },
    { from: 0.6, to: 0.625, kind: "boost", offset: 0, width: 5 },
    { from: 0.9, to: 0.95, kind: "mud", offset: -3, width: 7 },
  ],
  hazards: [
    H("orange", 0.1, "roll", 6, 1.5, { span: 0.05 }),
    H("orange", 0.11, "roll", 6, 1.5, { span: 0.05, phase: 0.5, offset: 3 }),
    H("pea", 0.52, "cross", 3.5, 0.8),
    H("teacup", 0.72, "orbit", 5, 1.6, { offset: -24, span: 9 }),
  ],
  landmarks: [
    L("teapot", 0.02, -44),
    L("grater", 0.065, 0, { span: 44 }),
    L("fruit-bowl", 0.1, 40),
    L("toaster", 0.17, -46),
    L("salt-shaker", 0.36, 32, { turn: 0.4 }),
    L("pepper-mill", 0.37, 52),
    L("cereal-box", 0.46, -50),
    L("cookbook", 0.5, -34),
    L("mug", 0.54, 40),
    L("fork-arch", 0.62, 0, { span: 30 }),
    L("sink", 0.74, -48),
    L("spoon-arch", 0.86, 0, { span: 30 }),
    L("window", 0.92, -62),
    L("wall-clock", 0.97, 66),
  ],
  duck: { at: 0.74, offset: -48, y: -2 },
};

// ─── Snow ────────────────────────────────────────────────────────────────────

export const SNOW_MOVES: Move[] = [S(174), A(101, 66), S(61), A(-43, 63), S(59), A(51, 50), A(86, 98), S(149), A(97, 126), S(32), A(-54, 43), A(79, 39), A(43, 52)];

export const DEV_SNOW: TrackDef = {
  id: "dev-snow",
  name: "Dev Glacier",
  theme: "snow",
  laps: 2,
  width: 15,
  points: turtle(SNOW_MOVES, (t) => 4.5 * Math.sin(t * Math.PI * 2) + 3 * smooth(0.2, 0.4, t) * (1 - smooth(0.6, 0.8, t))),
  itemRows: [0.1, 0.35, 0.6, 0.85],
  boostPads: [{ at: 0.05, offset: 0 }],
  bank: 14,
  ramps: [{ at: 0.63 }],
  drops: [
    { from: 0.645, to: 0.665, side: "both" },
    { from: 0.78, to: 0.9, side: "left" },
  ],
  verges: [{ from: 0.28, to: 0.36, side: "right", distance: 26, surface: "snow" }],
  surfaces: [
    { from: 0.18, to: 0.24, kind: "ice" },
    { from: 0.42, to: 0.5, kind: "ice" },
    { from: 0.72, to: 0.78, kind: "snow", offset: 2, width: 8 },
    { from: 0.08, to: 0.1, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("penguin", 0.1, "cross", 8, 0.8),
    H("penguin", 0.103, "cross", 8, 0.8, { phase: 0.3 }),
    H("snowball", 0.4, "roll", 5, 1.6, { span: 0.05 }),
    H("yeti", 0.7, "bob", 7, 1.9, { offset: 9 }),
  ],
  landmarks: [
    L("igloo", 0.03, -36),
    L("ice-arch", 0.045, 0, { span: 30 }),
    L("cabin", 0.08, 42),
    L("snowman", 0.15, -40),
    L("pine-snow", 0.36, -34),
    L("pine-snow", 0.4, 36, { scale: 1.2 }),
    L("gondola", 0.46, -56, { turn: 1.5708 }),
    L("ice-cave", 0.585, 0, { span: 70 }),
    L("ski-jump", 0.63, 54),
    L("igloo", 0.7, 40),
    L("snowman", 0.74, 44, { scale: 0.7 }),
    L("cabin", 0.93, -44),
  ],
  duck: { at: 0.61, offset: 30 },
};

// ─── Volcano ─────────────────────────────────────────────────────────────────

export const VOLCANO_MOVES: Move[] = [S(196), A(77, 64), S(32), A(-55, 40), A(72, 43), S(40), A(111, 100), S(257), A(92, 72), S(42), A(63, 58)];

export const DEV_VOLCANO: TrackDef = {
  id: "dev-volcano",
  name: "Dev Volcano",
  theme: "volcano",
  laps: 2,
  width: 15,
  points: turtle(VOLCANO_MOVES, (t) => 2.5 * Math.sin(t * Math.PI * 4)),
  itemRows: [0.1, 0.35, 0.6, 0.85],
  boostPads: [{ at: 0.04, offset: 0 }],
  bank: 12,
  ramps: [{ at: 0.67 }],
  drops: [
    { from: 0.18, to: 0.3, side: "both" },
    { from: 0.685, to: 0.71, side: "both" },
    { from: 0.86, to: 0.94, side: "right" },
  ],
  surfaces: [
    { from: 0.72, to: 0.75, kind: "boost", offset: 0, width: 5 },
    { from: 0.88, to: 0.92, kind: "mud", offset: 0, width: 9 },
  ],
  hazards: [
    H("fireball", 0.1, "bob", 4, 2, { offset: 10, phase: 0.1 }),
    H("fireball", 0.36, "bob", 4, 2, { offset: -10, phase: 0.6 }),
    H("boulder", 0.6, "roll", 6, 2, { span: 0.06 }),
    H("geyser", 0.82, "bob", 5, 1.6, { offset: 9 }),
  ],
  landmarks: [
    L("obsidian-arch", 0.04, 0, { span: 26 }),
    L("lava-fall", 0.06, 50),
    L("volcano", 0.12, -150, { scale: 1.2 }),
    L("basalt-columns", 0.4, -38),
    L("stone-bridge", 0.62, 0, { span: 60 }),
    L("hot-spring", 0.65, -36),
    L("basalt-columns", 0.74, 40, { scale: 1.3 }),
    L("lava-fall", 0.9, -52),
  ],
  duck: { at: 0.65, offset: -36 },
};

// ─── Funfair ─────────────────────────────────────────────────────────────────

export const FUNFAIR_MOVES: Move[] = [S(192), A(83, 85), S(36), A(-23, 43), A(47, 49), S(75), A(86, 65), S(229), A(77, 70), S(100), A(90, 62)];

export const DEV_FUNFAIR: TrackDef = {
  id: "dev-funfair",
  name: "Dev Fun Fair",
  theme: "funfair",
  laps: 2,
  width: 16,
  points: turtle(FUNFAIR_MOVES, (t) => 1.5 * Math.sin(t * Math.PI * 2)),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.07, offset: 0 }],
  bank: 10,
  ramps: [{ at: 0.665 }],
  drops: [
    { from: 0.2, to: 0.28, side: "left" },
    { from: 0.68, to: 0.7, side: "both" },
  ],
  verges: [{ from: 0.74, to: 0.8, side: "right", distance: 22, surface: "grass" }],
  surfaces: [
    { from: 0.36, to: 0.42, kind: "sand", offset: 0, width: 9 },
    { from: 0.58, to: 0.62, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("teacup-ride", 0.16, "orbit", 5, 2.2, { offset: -26, span: 10 }),
    H("bumper-car", 0.6, "cross", 5, 1.5, { span: 7 }),
    H("bumper-car", 0.605, "cross", 5, 1.5, { span: 7, phase: 0.4 }),
  ],
  landmarks: [
    L("entrance-arch", 0.005, 0, { span: 14 }),
    L("rollercoaster", 0.085, 0, { span: 120 }),
    L("ferris-wheel", 0.09, -70),
    L("food-stall", 0.1, 30),
    L("carousel", 0.17, 52),
    L("balloon-stand", 0.5, -30),
    L("big-top", 0.57, 0, { span: 60 }),
    L("hook-a-duck", 0.66, -34),
    L("helter-skelter", 0.76, 48),
    L("fireworks", 0.9, -60),
    L("food-stall", 0.92, 30, { turn: 0.3 }),
  ],
  duck: { at: 0.66, offset: -34 },
};

// ─── Space ───────────────────────────────────────────────────────────────────

export const SPACE_MOVES: Move[] = [S(183), A(87, 68), S(38), A(-55, 42), A(71, 40), S(48), A(92, 61), S(265), A(95, 82), S(53), A(70, 69)];

export const DEV_SPACE: TrackDef = {
  id: "dev-space",
  name: "Dev Ribbon",
  theme: "space",
  laps: 2,
  width: 16,
  points: turtle(SPACE_MOVES, (t) => 12 * Math.sin(t * Math.PI * 2) + 5 * Math.sin(t * Math.PI * 6)),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.06, offset: 0 }],
  bank: 24,
  ramps: [{ at: 0.62 }],
  drops: [
    { from: 0.18, to: 0.34, side: "both" },
    { from: 0.635, to: 0.665, side: "both" },
    { from: 0.76, to: 0.84, side: "right" },
  ],
  surfaces: [
    { from: 0.08, to: 0.13, kind: "boost", offset: 0, width: 6 },
    { from: 0.68, to: 0.72, kind: "boost", offset: 0, width: 6 },
  ],
  hazards: [
    H("asteroid", 0.24, "orbit", 7, 2, { offset: 0, span: 12 }),
    H("asteroid", 0.56, "orbit", 7, 2, { offset: 0, span: 12, phase: 0.5 }),
    H("comet", 0.78, "roll", 5, 1.6, { span: 0.06 }),
  ],
  landmarks: [
    L("ringed-planet", 0.1, -420, { scale: 1.4 }),
    L("ring-gate", 0.02, 0, { span: 12 }),
    L("ring-gate", 0.54, 0, { span: 12 }),
    L("ring-gate", 0.9, 0, { span: 12 }),
    L("asteroid", 0.2, 60),
    L("satellite", 0.36, -50),
    L("space-station", 0.58, 90),
    L("nebula", 0.7, -160),
    L("asteroid", 0.82, -60, { scale: 1.4 }),
  ],
  duck: { at: 0.37, offset: -50, y: 2 },
};

// ─── Palm ────────────────────────────────────────────────────────────────────

export const PALM_MOVES: Move[] = [S(181), A(78, 75), S(29), A(-64, 33), A(92, 32), S(51), A(88, 86), S(252), A(84, 62), S(75), A(82, 67)];

export const DEV_PALM: TrackDef = {
  id: "dev-palm",
  name: "Dev Island",
  theme: "palm",
  laps: 2,
  width: 15,
  points: turtle(PALM_MOVES, () => 0),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.1, offset: 0 }],
  bank: 10,
  ramps: [{ at: 0.63 }],
  drops: [
    { from: 0.22, to: 0.34, side: "left" },
    { from: 0.645, to: 0.665, side: "both" },
  ],
  verges: [{ from: 0.42, to: 0.5, side: "right", distance: 24, surface: "sand" }],
  surfaces: [
    { from: 0.74, to: 0.8, kind: "sand", offset: 0, width: 10 },
    { from: 0.58, to: 0.6, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("crab", 0.1, "cross", 5, 1.1),
    H("crab", 0.102, "cross", 5, 1.1, { phase: 0.5 }),
    H("coconut", 0.44, "roll", 4, 0.9, { span: 0.05 }),
    H("beach-ball", 0.68, "roll", 6, 1.4, { span: 0.05 }),
  ],
  landmarks: [
    L("wristwatch", 0, 0, { span: 14 }),
    L("palm-tree", 0.04, -26),
    L("palm-tree", 0.045, 30, { scale: 1.2 }),
    L("beach-hut", 0.12, -34),
    L("surfboard", 0.2, 30),
    L("sandcastle", 0.28, -40),
    L("beach-towel", 0.46, -34),
    L("palm-tree", 0.52, 32),
    L("giant-ring", 0.56, 0, { span: 10 }),
    L("beach-hut", 0.64, 38, { turn: 3.14 }),
    L("surfboard", 0.76, -30),
    L("palm-tree", 0.9, -28),
  ],
  duck: { at: 0.46, offset: -34, y: 0.1 },
};

/** The six dev tracks, one per new world. */
export const DEV_TRACKS: TrackDef[] = [DEV_KITCHEN, DEV_SNOW, DEV_VOLCANO, DEV_FUNFAIR, DEV_SPACE, DEV_PALM];

export function devTrackById(id: string): TrackDef | undefined {
  return DEV_TRACKS.find((t) => t.id === id);
}

export type { TrackTheme };
