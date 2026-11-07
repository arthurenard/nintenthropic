/**
 * A recording of real hands replayed through the wheel reader, for the tests and for measuring changes: what the hand
 * tracker saw while a person did the game's moves in front of a webcam (fixtures/moves.json, made by
 * tools/replay/record.mjs from the video), and what the reader decided at every 60 Hz tick of the kart.
 *
 * The recording has only the landmarks the reader uses; the rest are zeros. Not part of the shipped game.
 */
import type { HandFrame, Landmark, SeenHand } from "../../tracking/types";
import type { DriveInput, WheelStatus } from "../contract";
import type { Steering } from "./wheel";

/** The recorded hand as the tracker gave it (4 places, only the points the wheel reads). */
interface RecordedHand {
  h: "Left" | "Right" | null;
  s: number;
  lm: number[][];
  w: number[][];
}

export interface Recording {
  video: string;
  fps: number;
  duration: number;
  frames: { t: number; delay: number; hands: RecordedHand[] }[];
}

const IMAGE_POINTS = [0, 5, 9, 13, 17];
const WORLD_POINTS = [0, 6, 8, 10, 12, 14, 16, 18, 20];

const spread = (indices: number[], points: number[][]): Landmark[] => {
  const all: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  indices.forEach((index, i) => {
    const [x, y, z] = points[i]!;
    all[index] = { x: x!, y: y!, z: z! };
  });
  return all;
};

/** One recorded answer as the tracker's HandFrame, captured at `capturedAt` ms. */
export function frameOf(entry: Recording["frames"][number], sequence: number, capturedAt: number): HandFrame {
  const hands: SeenHand[] = entry.hands.map((hand) => ({
    landmarks: spread(IMAGE_POINTS, hand.lm),
    world: spread(WORLD_POINTS, hand.w),
    handedness: hand.h,
    score: hand.s,
  }));
  return { landmarks: hands[0]?.landmarks ?? null, handedness: hands[0]?.handedness ?? null, hands, capturedAt, sequence };
}

/**
 * The moves in moves.mov, labelled by eye from stills of the video (seconds on the video's clock, edges good to about
 * 0.1 s). `settle` is trimmed off each end of a steady stretch before it is measured.
 */
export const SEGMENTS = [
  { id: "open-start", move: "brake", t0: 0.0, t1: 0.5 },
  { id: "fists-1", move: "fists", t0: 0.75, t1: 1.65 },
  { id: "left-lock", move: "lock-left", t0: 2.05, t1: 2.95 },
  { id: "right-lock", move: "lock-right", t0: 3.3, t1: 4.55 },
  { id: "fists-2", move: "fists", t0: 4.95, t1: 6.3 },
  { id: "brake-1", move: "brake", t0: 6.55, t1: 7.2 },
  { id: "fists-3", move: "fists", t0: 7.5, t1: 8.45 },
  { id: "quick-right", move: "turn-right", t0: 8.55, t1: 9.0 },
  { id: "quick-left", move: "turn-left", t0: 9.15, t1: 9.55 },
  { id: "quick-right-2", move: "turn-right", t0: 9.7, t1: 10.1 },
  { id: "fists-4", move: "fists", t0: 10.25, t1: 10.65 },
  // Here his right hand is up by his face and the other is open at the very bottom of the picture, mostly out of it.
  { id: "brake-2a", move: "half-open", t0: 10.8, t1: 11.35 },
  // A loose hand, thumb out, fingers together: neither a clear fist nor a clear open hand.
  { id: "brake-2b", move: "loose-open", t0: 11.4, t1: 11.85 },
  { id: "fists-5", move: "fists", t0: 12.05, t1: 12.9 },
  { id: "item-flick", move: "item", t0: 13.0, t1: 13.3 },
  { id: "fists-6", move: "fists", t0: 13.4, t1: 13.65 },
  { id: "hands-away", move: "none", t0: 13.75, t1: 14.07 },
] as const;
export const SETTLE = 0.1;

/** What the reader said at one 60 Hz tick. */
export interface Tick {
  /** The video's clock, seconds. */
  t: number;
  angle: number;
  steer: number;
  brake: number;
  throttle: number;
  presses: number;
  shakes: number;
  grip: WheelStatus["grip"];
  mode: WheelStatus["mode"];
  slide: boolean;
}

/** Anything that reads frames like the wheel reader (the old one too, to compare). */
export interface Reader {
  push(frame: HandFrame, at?: number): void;
  sample(now: number): { status: WheelStatus; input: DriveInput };
  level: number;
  aspect: number;
  steering: Steering;
}

/**
 * Plays the recording to a reader the way the game does: each answer arrives its measured delay after the camera took
 * it, and the kart asks for the input at every 1/60 s in between. `drop` leaves answers out (to model a slower camera:
 * `drop: 2` keeps every other one), `delayOf` gives each answer's age on arrival, ms (default what was measured).
 */
export function play(
  make: () => Reader,
  recording: Recording,
  options: { level?: number; drop?: number; delayOf?: (index: number, recorded: number) => number; steering?: Steering } = {},
): Tick[] {
  const reader = make();
  reader.aspect = 960 / 640;
  if (options.steering) reader.steering = options.steering;
  reader.level = options.level ?? -1.1;
  const keep = options.drop ?? 1;
  const arrivals = recording.frames
    .map((entry, i) => ({ entry, i, capturedAt: entry.t * 1000, at: entry.t * 1000 + (options.delayOf ? options.delayOf(i, entry.delay) : entry.delay) }))
    .filter((a) => a.i % keep === 0);
  const origin = 100_000; // the clock the game's own never starts at zero on
  const ticks: Tick[] = [];
  let next = 0;
  const end = recording.duration * 1000 + 300;
  for (let ms = 0; ms <= end; ms += 1000 / 60) {
    while (next < arrivals.length && arrivals[next]!.at <= ms) {
      const a = arrivals[next++]!;
      reader.push(frameOf(a.entry, a.i, origin + a.capturedAt), origin + a.at);
    }
    const out = reader.sample(origin + ms);
    ticks.push({
      t: ms / 1000,
      angle: out.status.angle,
      steer: out.input.steer,
      brake: out.input.brake,
      throttle: out.input.throttle,
      presses: out.input.itemPresses,
      shakes: out.input.shakes ?? 0,
      grip: out.status.grip,
      mode: out.status.mode,
      slide: out.input.slide ?? false,
    });
  }
  return ticks;
}

const inside = (t: number, from: number, to: number) => t >= from && t <= to;
const segment = (id: string) => SEGMENTS.find((s) => s.id === id)!;

/** What the reader decided against what was being done, the numbers the tests and the reports use. */
export interface Score {
  /** Ticks braking while the hands were fists (steady stretches), of all such ticks. */
  falseBrakeTicks: number;
  /** Ticks in all the fist stretches. */
  fistTicks: number;
  /** Item presses where no flick was made. */
  falseItems: number;
  /** Item presses in the flick's window (13.0 to 13.7 s). */
  items: number;
  /** Seconds from the label's start to the first brake tick, per both-open stretch; null when it never braked. */
  brakeAfter: Record<string, number | null>;
  /** Seconds from the end of both-open stretches to the brake letting go, per stretch (negative: early). */
  brakeRelease: Record<string, number | null>;
  /** How long the kart braked with hands that were not both open, seconds. */
  brakeOutsideOpen: number;
  /** Steer at the locks: the share of ticks on the right side, and the mean. */
  lockLeft: { rightWay: number; mean: number };
  lockRight: { rightWay: number; mean: number };
  /** Std of the angle inside the steady fist stretches, degrees (jitter). */
  jitter: number;
  /** The biggest change of steer from one 60 Hz tick to the next inside steady stretches (no jump). */
  steadyJump: number;
  /** The biggest change of steer in one tick anywhere. */
  anyJump: number;
  /** Shakes counted over the quick turns (8.5 to 10.4 s), and anywhere else. */
  shakes: number;
  falseShakes: number;
}

export function score(ticks: Tick[]): Score {
  const fists = SEGMENTS.filter((s) => s.move === "fists");
  const steady = (t: number) => fists.some((s) => inside(t, s.t0 + SETTLE, s.t1 - SETTLE));
  const openLabels = SEGMENTS.filter((s) => s.move === "brake");
  const inOpen = (t: number) => openLabels.some((s) => inside(t, s.t0, s.t1 + 0.4));
  let falseBrakeTicks = 0;
  let fistTicks = 0;
  let brakeOutsideOpen = 0;
  let steadyJump = 0;
  let anyJump = 0;
  const angles: number[] = [];
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i]!;
    const braking = tick.brake > 0;
    if (steady(tick.t)) {
      fistTicks++;
      if (braking) falseBrakeTicks++;
      angles.push(tick.angle);
    }
    if (braking && !inOpen(tick.t) && !inside(tick.t, 10.8, 11.85 + 0.4) && tick.t < 13.7) brakeOutsideOpen += 1 / 60;
    if (i > 0) {
      const jump = Math.abs(tick.steer - ticks[i - 1]!.steer);
      anyJump = Math.max(anyJump, jump);
      if (steady(tick.t) && steady(ticks[i - 1]!.t)) steadyJump = Math.max(steadyJump, jump);
    }
  }
  const brakeAfter: Record<string, number | null> = {};
  const brakeRelease: Record<string, number | null> = {};
  for (const s of openLabels) {
    const first = ticks.find((tick) => inside(tick.t, s.t0, s.t1 + 0.3) && tick.brake > 0);
    brakeAfter[s.id] = first ? first.t - s.t0 : null;
    const after = ticks.filter((tick) => tick.t >= s.t1 && tick.t <= s.t1 + 0.8);
    const released = after.find((tick) => tick.brake === 0);
    brakeRelease[s.id] = first && released ? released.t - s.t1 : null;
  }
  const lock = (id: string, sign: number) => {
    const s = segment(id);
    const run = ticks.filter((tick) => inside(tick.t, s.t0 + SETTLE, s.t1 - SETTLE));
    return {
      rightWay: run.filter((tick) => Math.sign(tick.steer) === sign).length / run.length,
      mean: run.reduce((sum, tick) => sum + tick.steer, 0) / run.length,
    };
  };
  const at = (t: number) => ticks.reduce((best, tick) => (Math.abs(tick.t - t) < Math.abs(best.t - t) ? tick : best));
  const count = (from: number, to: number) => at(to).presses - at(from).presses;
  const shook = (from: number, to: number) => at(to).shakes - at(from).shakes;
  const mean = angles.reduce((sum, a) => sum + a, 0) / (angles.length || 1);
  // Jitter is the std inside each steady stretch (the wheel's own drift between stretches is not jitter).
  let sum = 0;
  let n = 0;
  for (const s of fists) {
    const run = ticks.filter((tick) => inside(tick.t, s.t0 + SETTLE, s.t1 - SETTLE));
    if (run.length < 3) continue;
    const m = run.reduce((a, tick) => a + tick.angle, 0) / run.length;
    for (const tick of run) sum += (tick.angle - m) ** 2;
    n += run.length;
  }
  void mean;
  const last = ticks[ticks.length - 1]!;
  return {
    falseBrakeTicks,
    fistTicks,
    items: count(12.9, 13.8),
    falseItems: last.presses - count(12.9, 13.8),
    brakeAfter,
    brakeRelease,
    brakeOutsideOpen,
    lockLeft: lock("left-lock", -1),
    lockRight: lock("right-lock", 1),
    jitter: Math.sqrt(sum / (n || 1)),
    steadyJump,
    anyJump,
    shakes: shook(8.5, 10.4),
    falseShakes: last.shakes - shook(8.5, 10.4),
  };
}
