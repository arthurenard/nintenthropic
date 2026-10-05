/**
 * One test track per new world for the renderer's dev page (`?track=dev-kitchen`
 * ... `dev-palm`), each using every feature the picture draws (ramps, drops, a
 * verge, surfaces, banking, hazards, landmarks, the duck) so a change to the
 * picture can be judged on all of them at once. They are written with nothing
 * but the shapes of track/geometry.ts, so the real tracks just work.
 *
 * Roads are drawn with a turtle: straights and arcs, which close up by
 * spreading the small error over the whole loop. Fractions of the lap
 * (`at`) are measured from the start line.
 */
import type { HazardDef, Landmark, TrackDef, TrackPoint, TrackTheme } from "../track/geometry";

type Move = ["s", number] | ["a", number, number];

/** A straight of `length` metres. */
const S = (length: number): Move => ["s", length];
/** An arc turning `degrees` (positive: right, as a kart steers) with radius `radius`. */
const A = (degrees: number, radius: number): Move => ["a", degrees, radius];

/** The points of a closed road from a list of straights and arcs, with a height for each fraction of the lap. */
export function turtle(moves: readonly Move[], height: (t: number) => number = () => 0, step = 22): TrackPoint[] {
  const pts: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let h = 0;
  const forward = () => [Math.sin(h), Math.cos(h)] as const;
  for (const m of moves) {
    if (m[0] === "s") {
      const n = Math.max(1, Math.round(m[1] / step));
      for (let k = 0; k < n; k++) {
        const [fx, fz] = forward();
        x += (fx * m[1]) / n;
        z += (fz * m[1]) / n;
        pts.push({ x, z });
      }
    } else {
      const turn = (-m[1] * Math.PI) / 180;
      const len = Math.abs(turn) * m[2];
      const n = Math.max(2, Math.round(len / (step * 0.8)));
      for (let k = 0; k < n; k++) {
        // The chord of a small arc: heading at its middle.
        const mid = h + turn / n / 2;
        const chord = (len / n) * (Math.abs(turn / n) < 1e-6 ? 1 : Math.sin(Math.abs(turn / n) / 2) / (Math.abs(turn / n) / 2));
        x += Math.sin(mid) * chord;
        z += Math.cos(mid) * chord;
        h += turn / n;
        pts.push({ x, z });
      }
    }
  }
  // The turtle ends at the start (up to its error): drop the repeat and spread the error over the loop.
  const end = pts.pop()!;
  const total = pts.length;
  return pts.map((p, i) => {
    const t = i / total;
    return {
      x: Math.round((p.x - end.x * t) * 10) / 10,
      z: Math.round((p.z - end.z * t) * 10) / 10,
      y: Math.round(height(t) * 100) / 100,
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

export const DEV_KITCHEN: TrackDef = {
  id: "dev-kitchen",
  name: "Dev Kitchen",
  theme: "kitchen",
  laps: 2,
  width: 16,
  points: turtle([S(170), A(90, 85), S(60), A(-50, 55), A(50, 55), S(90), A(90, 70), S(80), A(90, 95), S(70), A(90, 80), S(30)], (t) => 0.5 * smooth(0.35, 0.45, t) * (1 - smooth(0.5, 0.6, t))),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.06, offset: 0 }, { at: 0.5, offset: -3 }],
  blurb: "A giant kitchen counter at teatime.",
  bank: 5,
  ramps: [{ at: 0.3 }],
  drops: [
    { from: 0.62, to: 0.8, side: "right" },
    { from: 0.315, to: 0.34, side: "both" },
  ],
  verges: [{ from: 0.45, to: 0.55, side: "left", distance: 24, surface: "sand" }],
  surfaces: [
    { from: 0.15, to: 0.2, kind: "ice" },
    { from: 0.5, to: 0.54, kind: "boost", offset: 0, width: 5 },
    { from: 0.88, to: 0.93, kind: "mud", offset: -3, width: 7 },
  ],
  hazards: [
    H("orange", 0.2, "roll", 6, 1.5, { span: 0.05 }),
    H("orange", 0.22, "roll", 6, 1.5, { span: 0.05, phase: 0.5, offset: 3 }),
    H("pea", 0.4, "cross", 3.5, 0.8),
    H("teacup", 0.7, "orbit", 5, 1.6, { offset: -24, span: 9 }),
  ],
  landmarks: [
    L("teapot", 0.02, -44),
    L("fruit-bowl", 0.1, 40),
    L("toaster", 0.17, -46),
    L("grater", 0.25, 0, { span: 44 }),
    L("salt-shaker", 0.36, 32, { turn: 0.4 }),
    L("pepper-mill", 0.37, 52),
    L("cookbook", 0.3, -34),
    L("cereal-box", 0.46, -50),
    L("mug", 0.54, 40),
    L("fork-arch", 0.58, 0, { span: 30 }),
    L("spoon-arch", 0.84, 0, { span: 30 }),
    L("sink", 0.72, -48),
    L("window", 0.9, -62),
    L("wall-clock", 0.95, 66),
  ],
  duck: { at: 0.72, offset: -48, y: -2 },
};

// ─── Snow ────────────────────────────────────────────────────────────────────

export const DEV_SNOW: TrackDef = {
  id: "dev-snow",
  name: "Dev Glacier",
  theme: "snow",
  laps: 2,
  width: 15,
  points: turtle([S(150), A(70, 90), S(50), A(-60, 60), S(60), A(110, 75), S(100), A(90, 100), S(40), A(-70, 55), A(150, 60), S(80)], (t) => 9 * Math.sin(t * Math.PI * 2) * 0.5 + 4 * smooth(0.2, 0.4, t) * (1 - smooth(0.6, 0.8, t))),
  itemRows: [0.1, 0.35, 0.6, 0.85],
  boostPads: [{ at: 0.05, offset: 0 }],
  bank: 6,
  ramps: [{ at: 0.52 }],
  drops: [
    { from: 0.545, to: 0.575, side: "both" },
    { from: 0.78, to: 0.9, side: "left" },
  ],
  verges: [{ from: 0.28, to: 0.36, side: "right", distance: 26, surface: "snow" }],
  surfaces: [
    { from: 0.18, to: 0.24, kind: "ice" },
    { from: 0.42, to: 0.5, kind: "ice" },
    { from: 0.6, to: 0.66, kind: "snow", offset: 2, width: 8 },
    { from: 0.08, to: 0.12, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("penguin", 0.14, "cross", 8, 0.8),
    H("penguin", 0.145, "cross", 8, 0.8, { phase: 0.3 }),
    H("snowball", 0.4, "roll", 5, 1.6, { span: 0.05 }),
    H("yeti", 0.7, "bob", 7, 1.9, { offset: 9 }),
  ],
  landmarks: [
    L("igloo", 0.03, -36),
    L("cabin", 0.08, 42),
    L("snowman", 0.15, -40),
    L("ice-arch", 0.22, 0, { span: 30 }),
    L("ice-cave", 0.31, 0, { span: 70 }),
    L("pine-snow", 0.36, -34),
    L("pine-snow", 0.4, 36, { scale: 1.2 }),
    L("gondola", 0.46, -56, { turn: 1.5708 }),
    L("ski-jump", 0.5, 54),
    L("igloo", 0.64, 40),
    L("snowman", 0.72, 44, { scale: 0.7 }),
    L("cabin", 0.93, -44),
  ],
  duck: { at: 0.61, offset: 30 },
};

// ─── Volcano ─────────────────────────────────────────────────────────────────

export const DEV_VOLCANO: TrackDef = {
  id: "dev-volcano",
  name: "Dev Volcano",
  theme: "volcano",
  laps: 2,
  width: 15,
  points: turtle([S(140), A(80, 80), S(60), A(-70, 50), A(70, 50), S(60), A(100, 75), S(110), A(90, 70), S(50), A(120, 65), S(90)], (t) => 3 * Math.sin(t * Math.PI * 4)),
  itemRows: [0.1, 0.35, 0.6, 0.85],
  boostPads: [{ at: 0.04, offset: 0 }],
  bank: 5,
  ramps: [{ at: 0.45 }],
  drops: [
    { from: 0.18, to: 0.3, side: "both" },
    { from: 0.472, to: 0.5, side: "both" },
    { from: 0.7, to: 0.8, side: "right" },
  ],
  surfaces: [
    { from: 0.58, to: 0.62, kind: "boost", offset: 0, width: 5 },
    { from: 0.88, to: 0.92, kind: "mud", offset: 0, width: 9 },
  ],
  hazards: [
    H("fireball", 0.1, "bob", 4, 2, { offset: 10, phase: 0.1 }),
    H("fireball", 0.36, "bob", 4, 2, { offset: -10, phase: 0.6 }),
    H("boulder", 0.55, "roll", 6, 2, { span: 0.06 }),
    H("geyser", 0.82, "bob", 5, 1.6, { offset: 9 }),
  ],
  landmarks: [
    L("volcano", 0.12, -150, { scale: 1.2 }),
    L("lava-fall", 0.06, 50),
    L("basalt-columns", 0.4, -38),
    L("stone-bridge", 0.24, 0, { span: 60 }),
    L("obsidian-arch", 0.34, 0, { span: 26 }),
    L("hot-spring", 0.65, -36),
    L("basalt-columns", 0.74, 40, { scale: 1.3 }),
    L("lava-fall", 0.9, -52),
  ],
  duck: { at: 0.65, offset: -36 },
};

// ─── Funfair ─────────────────────────────────────────────────────────────────

export const DEV_FUNFAIR: TrackDef = {
  id: "dev-funfair",
  name: "Dev Fun Fair",
  theme: "funfair",
  laps: 2,
  width: 16,
  points: turtle([S(160), A(90, 70), S(40), A(-40, 45), A(40, 45), S(70), A(90, 65), S(120), A(90, 70), S(60), A(90, 70), S(70)], (t) => 1.5 * Math.sin(t * Math.PI * 2)),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.07, offset: 0 }],
  bank: 4,
  ramps: [{ at: 0.62 }],
  drops: [{ from: 0.2, to: 0.28, side: "left" }],
  verges: [{ from: 0.74, to: 0.82, side: "right", distance: 22, surface: "grass" }],
  surfaces: [
    { from: 0.36, to: 0.42, kind: "sand", offset: 0, width: 9 },
    { from: 0.5, to: 0.54, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("teacup-ride", 0.16, "orbit", 5, 2.2, { offset: -26, span: 10 }),
    H("bumper-car", 0.44, "cross", 5, 1.5, { span: 7 }),
    H("bumper-car", 0.445, "cross", 5, 1.5, { span: 7, phase: 0.4 }),
  ],
  landmarks: [
    L("entrance-arch", 0.005, 0, { span: 14 }),
    L("ferris-wheel", 0.09, -70),
    L("carousel", 0.17, 52),
    L("big-top", 0.3, 0, { span: 60 }),
    L("rollercoaster", 0.46, 0, { span: 120 }),
    L("food-stall", 0.1, 30),
    L("balloon-stand", 0.57, -30),
    L("hook-a-duck", 0.66, -34),
    L("helter-skelter", 0.76, 48),
    L("fireworks", 0.9, -60),
    L("food-stall", 0.92, 30, { turn: 0.3 }),
  ],
  duck: { at: 0.66, offset: -34 },
};

// ─── Space ───────────────────────────────────────────────────────────────────

export const DEV_SPACE: TrackDef = {
  id: "dev-space",
  name: "Dev Ribbon",
  theme: "space",
  laps: 2,
  width: 16,
  points: turtle([S(150), A(100, 90), S(60), A(-70, 55), A(70, 55), S(90), A(110, 70), S(100), A(90, 80), S(60), A(70, 70), S(100)], (t) => 14 * Math.sin(t * Math.PI * 2) + 6 * Math.sin(t * Math.PI * 6)),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.06, offset: 0 }],
  bank: 9,
  ramps: [{ at: 0.4 }],
  drops: [
    { from: 0.18, to: 0.34, side: "both" },
    { from: 0.422, to: 0.46, side: "both" },
    { from: 0.64, to: 0.8, side: "right" },
  ],
  surfaces: [
    { from: 0.08, to: 0.13, kind: "boost", offset: 0, width: 6 },
    { from: 0.5, to: 0.56, kind: "boost", offset: 0, width: 6 },
  ],
  hazards: [
    H("asteroid", 0.24, "orbit", 7, 2, { offset: 0, span: 12 }),
    H("asteroid", 0.5, "orbit", 7, 2, { offset: 0, span: 12, phase: 0.5 }),
    H("comet", 0.78, "roll", 5, 1.6, { span: 0.06 }),
  ],
  landmarks: [
    L("ringed-planet", 0.1, -420, { scale: 1.4 }),
    L("ring-gate", 0.02, 0, { span: 12 }),
    L("ring-gate", 0.5, 0, { span: 12 }),
    L("ring-gate", 0.88, 0, { span: 12 }),
    L("asteroid", 0.2, 60),
    L("satellite", 0.36, -50),
    L("space-station", 0.58, 90),
    L("nebula", 0.7, -160),
    L("asteroid", 0.82, -60, { scale: 1.4 }),
  ],
  duck: { at: 0.37, offset: -50, y: 2 },
};

// ─── Palm ────────────────────────────────────────────────────────────────────

export const DEV_PALM: TrackDef = {
  id: "dev-palm",
  name: "Dev Island",
  theme: "palm",
  laps: 2,
  width: 15,
  points: turtle([S(140), A(90, 60), S(50), A(-80, 45), A(80, 45), S(40), A(100, 70), S(130), A(90, 60), S(60), A(90, 65), S(80)], () => 0),
  itemRows: [0.12, 0.38, 0.62, 0.86],
  boostPads: [{ at: 0.1, offset: 0 }],
  bank: 4,
  ramps: [{ at: 0.58 }],
  drops: [{ from: 0.22, to: 0.34, side: "left" }],
  verges: [{ from: 0.42, to: 0.5, side: "right", distance: 24, surface: "sand" }],
  surfaces: [
    { from: 0.68, to: 0.74, kind: "sand", offset: 0, width: 10 },
    { from: 0.8, to: 0.84, kind: "boost", offset: 0, width: 5 },
  ],
  hazards: [
    H("crab", 0.15, "cross", 5, 1.1),
    H("crab", 0.152, "cross", 5, 1.1, { phase: 0.5 }),
    H("coconut", 0.44, "roll", 4, 0.9, { span: 0.05 }),
    H("beach-ball", 0.7, "roll", 6, 1.4, { span: 0.05 }),
  ],
  landmarks: [
    L("wristwatch", 0, 0, { span: 14 }),
    L("palm-tree", 0.04, -26),
    L("palm-tree", 0.045, 30, { scale: 1.2 }),
    L("beach-hut", 0.12, -34),
    L("surfboard", 0.2, 30),
    L("sandcastle", 0.28, -40),
    L("giant-ring", 0.36, 0, { span: 10 }),
    L("beach-towel", 0.46, -34),
    L("palm-tree", 0.52, 32),
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
