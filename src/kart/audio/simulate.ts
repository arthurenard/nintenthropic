/**
 * A scripted race for the ears' sake: four local karts and three others
 * driving a made-up thirty-odd seconds that touches every sound there is (the
 * countdown, a flooded start, drifts and their sparks, a roulette, items,
 * bumps, walls, a jump, a fall and a rescue, surfaces, the last lap, the
 * finish). Pure data in, RaceViews out, so the dev page can render it
 * offline through the real audio engine and the tests can run it in Node.
 */
import type { KartView, RaceEvent, RaceView, ThingView, TrackDef } from "../contract";

export const SIM_TRACK = { id: "sim", name: "Sim", theme: "meadow", laps: 3, points: [], width: 12, itemRows: [], duck: { at: 0.5, offset: 3 } } as unknown as TrackDef;

/** The four local karts, left to right across the screen. */
export const SIM_LOCALS = [
  { kart: 0, pan: -0.6 },
  { kart: 1, pan: -0.2 },
  { kart: 2, pan: 0.2 },
  { kart: 3, pan: 0.6 },
] as const;

/** When the race starts, seconds into the script. */
export const SIM_GO = 3.5;

/** An event without its id and tick (Omit, spread over each kind of event). */
type Body<E> = E extends unknown ? Omit<E, "id" | "tick"> : never;

interface Timed {
  at: number;
  event: Body<RaceEvent>;
}

const smooth = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** The script's events by time. */
export const SIM_EVENTS: Timed[] = [
  { at: 0.5, event: { type: "countdown", n: 3 } },
  { at: 1.5, event: { type: "countdown", n: 2 } },
  { at: 2.5, event: { type: "countdown", n: 1 } },
  { at: 3.5, event: { type: "countdown", n: 0 } },
  { at: 3.5, event: { type: "boost", kart: 1, source: "start", level: 1 } },
  { at: 7.0, event: { type: "drift-level", kart: 0, level: 1 } },
  { at: 8.4, event: { type: "drift-level", kart: 0, level: 2 } },
  { at: 10.0, event: { type: "boost", kart: 0, source: "drift", level: 2 } },
  { at: 10.5, event: { type: "pickup", kart: 2, item: "puck" } },
  { at: 10.6, event: { type: "pickup", kart: 5, item: "nitro" } },
  { at: 12.2, event: { type: "use", kart: 2, item: "puck" } },
  { at: 13.0, event: { type: "use", kart: 5, item: "seeker" } },
  { at: 12.8, event: { type: "use", kart: 0, item: "nitro" } },
  { at: 12.8, event: { type: "boost", kart: 0, source: "nitro", level: 1 } },
  { at: 13.5, event: { type: "bump", a: 1, b: 5, strength: 0.7 } },
  { at: 14.3, event: { type: "wall", kart: 3, strength: 0.9 } },
  { at: 14.8, event: { type: "wall", kart: 3, strength: 0.2 } },
  { at: 15.5, event: { type: "hit", kart: 1, by: 2, cause: "puck" } },
  { at: 16.2, event: { type: "jump", kart: 2 } },
  { at: 16.6, event: { type: "trick", kart: 2 } },
  { at: 17.2, event: { type: "land", kart: 2, boost: true } },
  { at: 18.0, event: { type: "fall", kart: 3 } },
  { at: 20.6, event: { type: "rescued", kart: 3 } },
  { at: 19.0, event: { type: "use", kart: 1, item: "slick" } },
  { at: 23.2, event: { type: "use", kart: 5, item: "comet" } },
  { at: 23.8, event: { type: "use", kart: 2, item: "decoy" } },
  { at: 24.5, event: { type: "hit", kart: 1, by: 2, cause: "decoy" } },
  { at: 25.2, event: { type: "use", kart: 3, item: "skyrocket" } },
  { at: 26.6, event: { type: "strike", kart: 0, item: "skyrocket", x: 3, z: 2 } },
  { at: 26.7, event: { type: "hit", kart: 0, by: 3, cause: "skyrocket" } },
  { at: 27.2, event: { type: "use", kart: 2, item: "storm" } },
  { at: 27.2, event: { type: "strike", kart: 0, item: "storm", x: 0, z: 0 } },
  { at: 27.25, event: { type: "strike", kart: 1, item: "storm", x: 3, z: 0 } },
  { at: 28.6, event: { type: "use", kart: 2, item: "blast" } },
  { at: 28.6, event: { type: "strike", kart: 2, item: "blast", x: 5, z: 0 } },
  { at: 28.7, event: { type: "use", kart: 3, item: "puck3" } },
  { at: 19.6, event: { type: "hit", kart: 3, by: 1, cause: "slick" } },
  { at: 21.0, event: { type: "boost", kart: 1, source: "pad", level: 1 } },
  { at: 22.0, event: { type: "lap", kart: 0, lap: 2 } },
  { at: 22.4, event: { type: "hazard", kart: 2, kind: "boulder" } },
  { at: 24.0, event: { type: "final-lap", kart: 0 } },
  { at: 28.0, event: { type: "finish", kart: 0, place: 1, time: 24.5 } },
  { at: 29.5, event: { type: "finish", kart: 1, place: 3, time: 26 } },
];

/** Total length of the script, seconds. */
export const SIM_LENGTH = 33;

function kart(id: number, t: number): KartView {
  const racing = t >= SIM_GO;
  const r = t - SIM_GO;
  // Speeds: each kart accelerates with its own character, with episodes of boost, drift and slowing.
  const top = 20 + id;
  let speed = racing ? top * smooth(0, 3.5, r + id * 0.3) : 0;
  let boost = 0;
  let drift: -1 | 0 | 1 = 0;
  let driftLevel: 0 | 1 | 2 = 0;
  let spin = 0;
  let hop = 0;
  let rescue = 0;
  let surface: KartView["surface"] = "road";
  let offroad = false;
  let rolling = false;
  let item: KartView["item"] = null;
  if (id === 0) {
    if (t >= 5.5 && t < 10) {
      drift = 1;
      driftLevel = t >= 8.4 ? 2 : t >= 7 ? 1 : 0;
      speed *= 0.9;
    }
    if (t >= 10 && t < 11.5) boost = 11.5 - t;
    if (t >= 12.8 && t < 14.3) {
      boost = 14.3 - t;
      speed = top * 1.3;
    }
    if (t >= 10 && t < 12) {
      surface = "sand";
      offroad = true;
      speed *= 0.6;
    }
    if (t >= 16 && t < 19) surface = "ice";
    if (t >= 19 && t < 20.5) {
      surface = "mud";
      offroad = true;
    }
    if (t >= 20.5 && t < 21.5) {
      surface = "snow";
      offroad = true;
    }
    if (t >= 10.5 && t < 11.5) rolling = true;
    if (t >= 11.5 && t < 12.8) item = "nitro";
  }
  if (id === 1) {
    if (t >= 4.5 && t < 6) boost = 1;
    if (t >= 15.5 && t < 16.7) {
      spin = 16.7 - t;
      speed *= 0.2;
    }
    if (t >= 11.5 && t < 12.5) rolling = true;
    if (t >= 14 && t < 15) {
      drift = -1;
      driftLevel = 1;
    }
  }
  if (id === 2) {
    if (t >= 16.2 && t < 17.2) hop = 1.2 * Math.sin(Math.PI * (t - 16.2));
    if (t >= 10.5 && t < 11.5) rolling = true;
    if (t >= 11.5 && t < 12.2) item = "puck";
    if (t >= 17.2 && t < 18.7) boost = 18.7 - t;
  }
  if (id === 3) {
    if (t >= 18.0 && t < 20.6) {
      rescue = 20.6 - t;
      speed = 0;
    }
    if (t >= 14.2 && t < 15) speed *= 0.5;
  }
  const done = id === 0 && t >= 28 ? 24.5 : null;
  const lap = id === 0 ? (t >= 24 ? 3 : t >= 22 ? 2 : 1) : id === 1 ? (t >= 26 ? 3 : 2) : 1;
  // Where it is: out along a lane, with a sway.
  const along = racing ? (speed * r) % 1000 : 0;
  return {
    id,
    x: id < 4 ? (id - 1.5) * 4 : (id - 4) * 18 - 10 + 18 * smooth(0, 8, r),
    y: 0,
    z: id < 4 ? along * 0.9 : along * 0.8 + 6 * id,
    heading: 0,
    speed,
    steer: 0,
    drift,
    driftLevel,
    boost,
    spin,
    hop,
    offroad,
    surface,
    trick: 0,
    rescue,
    item,
    itemUses: item === "nitro" ? 1 : 0,
    rolling,
    place: id + 1,
    lap,
    lapProgress: (along / 400) % 1,
    wrongWay: false,
    finished: done,
  };
}

/**
 * The race view at time ``t`` of the script, carrying the events that fell
 * in (``t - dt``, ``t``]. Event ids count up from 1 through the script.
 */
export function simView(t: number, dt: number): RaceView {
  const events: RaceEvent[] = [];
  SIM_EVENTS.forEach((e, k) => {
    if (e.at > t - dt && e.at <= t) events.push({ id: k + 1, tick: Math.round(e.at * 60), ...e.event } as RaceEvent);
  });
  const ids = [0, 1, 2, 3, 4, 5, 6];
  const karts = ids.map((id) => kart(id, t));
  const things: ThingView[] = [];
  // A seeker flies from 13 s to 17 s, closing on kart 0 from ahead.
  if (t >= 13 && t < 17) things.push({ id: 900, kind: "seeker", x: 2, y: 0, z: karts[0]!.z + 70 - 18 * (t - 13), heading: Math.PI, active: true });
  // A puck from kart 2's use at 12.2 s bounces off the wall at 13.9 s.
  if (t >= 12.2 && t < 15) things.push({ id: 901, kind: "puck", x: 4, y: 0, z: karts[2]!.z + 8 + 40 * (t - 12.2), heading: t < 13.9 ? 0 : 1.9, active: true });
  return {
    tick: Math.round(t * 60),
    phase: t < SIM_GO ? "countdown" : t >= 30 ? "finished" : "racing",
    countdown: Math.max(0, SIM_GO - t),
    time: Math.max(0, t - SIM_GO),
    laps: 3,
    track: SIM_TRACK,
    racers: [],
    karts,
    things,
    events,
  };
}
