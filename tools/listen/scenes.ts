/**
 * Scripted moments of a race for the ears: one kart driven through everything an engine and its tyres meet, karts
 * passing the player, a pack of eight, and the race's big moments one after another. Each is a function of time to the
 * RaceView the game would hand its audio, so it can be rendered offline through the real engine and RaceAudio
 * (listen.ts) and measured without ever being played.
 */
import { CHARACTERS } from "../../src/kart/characters";
import type { KartView, RaceEvent, RaceView, RacerSetup, ThingView, TrackDef } from "../../src/kart/contract";
import { SIM_LENGTH, SIM_LOCALS, simView } from "../../src/kart/audio/simulate";

export interface Scene {
  seconds: number;
  theme: TrackDef["theme"];
  /** The karts the screen shows, in reading order. */
  views: number[];
  /** Override the stereo places (the scripted four-kart race has its own). */
  locals?: { kart: number; pan: number }[];
  /** The view at time `t`, carrying the events in (t - dt, t]; called once a frame, in order. */
  view(t: number, dt: number): RaceView;
}

type Body<E> = E extends unknown ? Omit<E, "id" | "tick"> : never;
interface Timed {
  at: number;
  event: Body<RaceEvent>;
}

const FPS = 60;
const smooth = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

function blank(id: number, over: Partial<KartView> = {}): KartView {
  return {
    id, x: 0, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, draft: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: id + 1, lap: 1,
    lapProgress: 0, wrongWay: false, finished: null, ...over,
  };
}

const racer = (id: number, character: string): RacerSetup => ({ id, name: character, colour: "#ffffff", player: id === 0 ? 0 : null, character });

/**
 * A scene from per-frame kart states. `state(id, t)` gives a kart's state but its position; speed and heading are
 * integrated here into x and z (and `climb`, a slope, into the road's height), so a scene says only how fast.
 */
function scripted(o: {
  seconds: number;
  theme: TrackDef["theme"];
  go: number;
  racers: RacerSetup[];
  views: number[];
  start: (id: number) => { x: number; z: number };
  state: (id: number, t: number) => Partial<KartView> & { climb?: number };
  events: Timed[];
  things?: (t: number, karts: KartView[]) => ThingView[];
}): Scene {
  const frames = Math.ceil(o.seconds * FPS) + 2;
  const ids = o.racers.map((r) => r.id);
  const track = { id: "listen", name: "Listen", theme: o.theme, laps: 3, points: [], width: 12, itemRows: [] } as unknown as TrackDef;
  // Integrate the karts' positions once, frame by frame.
  const timeline: KartView[][] = [];
  const pos = new Map(ids.map((id) => [id, { ...o.start(id), y: 0 }]));
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    const row: KartView[] = [];
    for (const id of ids) {
      const { climb = 0, ...s } = o.state(id, t);
      const p = pos.get(id)!;
      const k = blank(id, { ...s, x: p.x, y: p.y, z: p.z });
      row.push(k);
      const h = k.course ?? k.heading;
      p.x += Math.sin(h) * k.speed / FPS;
      p.z += Math.cos(h) * k.speed / FPS;
      p.y += climb * Math.abs(k.speed) / FPS;
    }
    timeline.push(row);
  }
  return {
    seconds: o.seconds,
    theme: o.theme,
    views: o.views,
    view(t, dt) {
      const f = Math.min(frames - 1, Math.max(0, Math.round(t * FPS)));
      const karts = timeline[f]!;
      const events: RaceEvent[] = [];
      o.events.forEach((e, k) => {
        if (e.at > t - dt && e.at <= t) events.push({ id: k + 1, tick: Math.round(e.at * FPS), ...e.event } as RaceEvent);
      });
      return {
        tick: f,
        phase: t < o.go ? "countdown" : "racing",
        countdown: Math.max(0, o.go - t),
        time: Math.max(0, t - o.go),
        laps: 3,
        track,
        racers: o.racers,
        karts,
        things: o.things?.(t, karts) ?? [],
        events,
      };
    },
  };
}

// --- one kart through everything -----------------------------------------------------------------------------------------

/**
 * One kart (of the character given) through 40 seconds: the countdown and a start boost, pulling away to top speed,
 * cruising, lifting off and pulling again, a climb to a crest it flies off (a trick, a landing that boosts), a long
 * drift through all three spark levels let go into a boost, the verge's grass and sand, a nitro, a wall and a bump,
 * then ice, mud and snow.
 */
export function solo(character: string): Scene {
  const top = 24;
  const flight = { from: 14.5, to: 15.7 };
  const state = (_id: number, t: number): Partial<KartView> & { climb?: number } => {
    const s: Partial<KartView> & { climb?: number } = {};
    let speed = 0;
    if (t < 3) speed = 0;
    else if (t < 9.5) speed = top * (1 - Math.exp(-(t - 3) / 1.25)) + (t < 3.8 ? 3 * (3.8 - t) / 0.8 : 0);
    else if (t < 11) speed = top - 6 * (t - 9.5);
    else if (t < 13) speed = 15 + (top - 15) * (1 - Math.exp(-(t - 11) / 0.8));
    else if (t < 14.5) speed = top - 2.5 * smooth(13, 14.5, t);
    else if (t < 16.5) speed = 21.5 + 3 * smooth(15.7, 16.4, t);
    else if (t < 21) speed = 22;
    else if (t < 23) speed = 22 + 5 * Math.sin(Math.PI * Math.min(1, (t - 21) / 2.4));
    else if (t < 25) speed = 24 - 12 * smooth(23, 24.2, t);
    else if (t < 26.5) speed = 12 - 2 * smooth(25, 26, t);
    else if (t < 28.5) speed = 10 + 14 * (1 - Math.exp(-(t - 26.5) / 0.9));
    else if (t < 30.5) speed = 24 + 7 * smooth(28.5, 29.2, t) - 6 * smooth(29.8, 30.5, t);
    else if (t < 32.5) speed = 25 * 0.7 + 6 * smooth(30.6, 32.3, t);
    else if (t < 35) speed = 21;
    else if (t < 36.5) speed = 21 - 9 * smooth(35, 35.8, t);
    else if (t < 38.5) speed = 12 + 2 * Math.sin(t * 3);
    else speed = 14 + 8 * smooth(38.5, 40, t);
    s.speed = speed;
    if (t >= 3 && t < 3.8) s.boost = 3.8 - t;
    if (t >= 13 && t < 14.5) s.climb = 0.16;
    if (t >= flight.from && t < flight.to) {
      const u = (t - flight.from) / (flight.to - flight.from);
      s.hop = 2.2 * Math.sin(Math.PI * u);
      s.climb = -0.12;
    }
    if (t >= 14.8 && t < 15.6) s.trick = t - 14.8;
    if (t >= flight.to && t < flight.to + 0.9) s.boost = flight.to + 0.9 - t;
    if (t >= 16.5 && t < 21) {
      s.drift = 1;
      s.steer = 0.75 + 0.15 * Math.sin(t * 2.3);
      s.driftLevel = t >= 19.7 ? 3 : t >= 18.5 ? 2 : t >= 17.3 ? 1 : 0;
      s.course = -0.45;
    }
    if (t >= 21 && t < 22.4) s.boost = 22.4 - t;
    if (t >= 23 && t < 25) {
      s.surface = "grass";
      s.offroad = true;
    }
    if (t >= 25 && t < 26.5) {
      s.surface = "sand";
      s.offroad = true;
    }
    if (t >= 28.5 && t < 30) s.boost = 30 - t;
    if (t >= 32.5 && t < 35) s.surface = "ice";
    if (t >= 35 && t < 36.5) {
      s.surface = "mud";
      s.offroad = true;
    }
    if (t >= 36.5 && t < 38.5) {
      s.surface = "snow";
      s.offroad = true;
    }
    if (t >= 26 && t < 27) s.rolling = true;
    if (t >= 27 && t < 28.5) {
      s.item = "nitro";
      s.itemUses = 1;
    }
    return s;
  };
  const events: Timed[] = [
    { at: 0.0, event: { type: "countdown", n: 3 } },
    { at: 1.0, event: { type: "countdown", n: 2 } },
    { at: 2.0, event: { type: "countdown", n: 1 } },
    { at: 3.0, event: { type: "countdown", n: 0 } },
    { at: 3.0, event: { type: "boost", kart: 0, source: "start", level: 1 } },
    { at: flight.from, event: { type: "jump", kart: 0, crest: true } },
    { at: 14.8, event: { type: "trick", kart: 0 } },
    { at: flight.to, event: { type: "land", kart: 0, boost: true, strength: 0.55 } },
    { at: 17.3, event: { type: "drift-level", kart: 0, level: 1 } },
    { at: 18.5, event: { type: "drift-level", kart: 0, level: 2 } },
    { at: 19.7, event: { type: "drift-level", kart: 0, level: 3 } },
    { at: 21.0, event: { type: "boost", kart: 0, source: "drift", level: 3 } },
    { at: 26.0, event: { type: "pickup", kart: 0, item: "nitro" } },
    { at: 28.5, event: { type: "use", kart: 0, item: "nitro" } },
    { at: 28.5, event: { type: "boost", kart: 0, source: "nitro", level: 1 } },
    { at: 30.5, event: { type: "wall", kart: 0, strength: 0.75 } },
    { at: 31.5, event: { type: "bump", a: 0, b: 9, strength: 0.5 } },
    { at: 31.9, event: { type: "wall", kart: 0, strength: 0.15 } },
  ];
  return scripted({
    seconds: 40,
    theme: "meadow",
    go: 3,
    racers: [racer(0, character)],
    views: [0],
    start: () => ({ x: 0, z: 0 }),
    state,
    events,
  });
}

// --- karts going by ------------------------------------------------------------------------------------------------------

/** The player cruising at 19 m/s while a heavy kart overtakes on the left, the player passes a slow one, and a light kart overtakes on the right. */
export function passBy(): Scene {
  const racers = [racer(0, "kit"), racer(1, "bramble"), racer(2, "bun"), racer(3, "mango")];
  return scripted({
    seconds: 15,
    theme: "meadow",
    go: 0,
    racers,
    views: [0],
    // Heading 0 faces +z; the kart's left is +x.
    start: (id) => [{ x: 0, z: 0 }, { x: 3.5, z: -45 }, { x: -3.5, z: -110 }, { x: 2.5, z: 32 }][id]!,
    state: (id) => ({ speed: [19, 27, 28, 15][id]! }),
    events: [],
  });
}

/** Eight karts in a bunch at racing speed, the player in the middle; half of them drift through a bend together, and two bump. */
export function pack(): Scene {
  const names = ["kit", "bun", "bramble", "pepper", "rivet", "moss", "juniper", "mango"];
  const racers = names.map((n, i) => racer(i, n));
  const spots = [
    { x: 0, z: 0 }, { x: 4, z: 6 }, { x: -4, z: 5 }, { x: 3, z: -7 }, { x: -3, z: -6 }, { x: 0, z: 13 }, { x: 5, z: -14 }, { x: -2, z: -15 },
  ];
  return scripted({
    seconds: 16,
    theme: "canyon",
    go: 0,
    racers,
    views: [0],
    start: (id) => spots[id]!,
    state: (id, t) => {
      const s: Partial<KartView> = { speed: 21.5 + 0.8 * Math.sin(t * 0.7 + id * 1.3) + (id === 0 ? 0 : 0.15 * (id - 4)) };
      if (t >= 6 && t < 10 && id % 2 === 0) {
        s.drift = 1;
        s.driftLevel = t > 8.6 ? 2 : t > 7 ? 1 : 0;
        s.steer = 0.7;
      }
      if (t >= 10 && t < 11.2 && id % 2 === 0) s.boost = 11.2 - t;
      return s;
    },
    events: [
      { at: 7, event: { type: "drift-level", kart: 0, level: 1 } },
      { at: 7, event: { type: "drift-level", kart: 2, level: 1 } },
      { at: 8.6, event: { type: "drift-level", kart: 0, level: 2 } },
      { at: 8.6, event: { type: "drift-level", kart: 4, level: 2 } },
      { at: 10, event: { type: "boost", kart: 0, source: "drift", level: 2 } },
      { at: 10, event: { type: "boost", kart: 2, source: "drift", level: 1 } },
      { at: 10.05, event: { type: "boost", kart: 6, source: "drift", level: 2 } },
      { at: 12, event: { type: "bump", a: 0, b: 1, strength: 0.6 } },
      { at: 13.5, event: { type: "bump", a: 3, b: 4, strength: 0.8 } },
    ],
  });
}

/** The race's moments one after another, the player's own: a countdown, items, hits, a jump and its trick, a lap, the final lap and a win. */
export function moments(): Scene {
  const events: Timed[] = [
    { at: 0.5, event: { type: "countdown", n: 3 } },
    { at: 1.5, event: { type: "countdown", n: 2 } },
    { at: 2.5, event: { type: "countdown", n: 1 } },
    { at: 3.5, event: { type: "countdown", n: 0 } },
    { at: 3.5, event: { type: "boost", kart: 0, source: "start", level: 1 } },
    { at: 5.5, event: { type: "pickup", kart: 0, item: "puck" } },
    { at: 7.5, event: { type: "use", kart: 0, item: "puck" } },
    { at: 9.0, event: { type: "boost", kart: 0, source: "pad", level: 1 } },
    { at: 10.5, event: { type: "use", kart: 0, item: "nitro" } },
    { at: 10.5, event: { type: "boost", kart: 0, source: "nitro", level: 1 } },
    { at: 12.5, event: { type: "hit", kart: 0, by: 1, cause: "puck" } },
    { at: 15.0, event: { type: "hit", kart: 0, by: null, cause: "slick" } },
    { at: 17.5, event: { type: "jump", kart: 0 } },
    { at: 17.8, event: { type: "trick", kart: 0, kick: true } },
    { at: 18.6, event: { type: "land", kart: 0, boost: true, strength: 0.4 } },
    { at: 20.0, event: { type: "boost", kart: 0, source: "drift", level: 1 } },
    { at: 21.2, event: { type: "boost", kart: 0, source: "drift", level: 2 } },
    { at: 22.4, event: { type: "boost", kart: 0, source: "drift", level: 3 } },
    { at: 23.8, event: { type: "boost", kart: 0, source: "draft", level: 1 } },
    { at: 25.0, event: { type: "lap", kart: 0, lap: 2 } },
    { at: 27.0, event: { type: "final-lap", kart: 0 } },
    { at: 30.0, event: { type: "use", kart: 0, item: "skyrocket" } },
    { at: 32.0, event: { type: "strike", kart: 0, item: "storm", x: 0, z: 0 } },
    { at: 32.0, event: { type: "hit", kart: 0, by: 1, cause: "storm" } },
    { at: 34.5, event: { type: "horn", kart: 0 } },
    { at: 36.0, event: { type: "finish", kart: 0, place: 1, time: 33 } },
  ];
  return scripted({
    seconds: 41,
    theme: "funfair",
    go: 3.5,
    racers: [racer(0, "mango"), racer(1, "bun")],
    views: [0],
    start: (id) => ({ x: id * 30, z: id * 200 }),
    state: (id, t) => {
      if (id === 1) return { speed: 0 };
      const s: Partial<KartView> = { speed: t < 3.5 ? 0 : Math.min(22, 22 * (1 - Math.exp(-(t - 3.5) / 1.2))) };
      if (t >= 3.5 && t < 4.4) s.boost = 4.4 - t;
      if (t >= 5.5 && t < 6.6) s.rolling = true;
      if (t >= 6.6 && t < 7.5) s.item = "puck";
      if (t >= 9 && t < 10) s.boost = 10 - t;
      if (t >= 10.5 && t < 12) {
        s.boost = 12 - t;
        s.speed = 28;
      }
      if ((t >= 12.5 && t < 13.8) || (t >= 15 && t < 16.2)) {
        s.spin = 1;
        s.speed = 6;
      }
      if (t >= 17.5 && t < 18.6) s.hop = 1.8 * Math.sin((Math.PI * (t - 17.5)) / 1.1);
      if (t >= 32 && t < 33.5) {
        s.zapped = 1;
        s.speed = 10;
      }
      if (t >= 36) s.finished = 33;
      return s;
    },
    events,
  });
}

/** A track's place alone: no karts on it, so only its beds and its far-off happenings are heard. */
export function place(theme: TrackDef["theme"], seconds = 12): Scene {
  return scripted({ seconds, theme, go: 0, racers: [], views: [], start: () => ({ x: 0, z: 0 }), state: () => ({}), events: [] });
}

/** The scripted four-player race of src/kart/audio/simulate.ts. */
export function script4(): Scene {
  return { seconds: SIM_LENGTH, theme: "meadow", views: SIM_LOCALS.map((l) => l.kart), locals: SIM_LOCALS.map((l) => ({ ...l })), view: simView };
}

export const SCENES: Record<string, () => Scene> = {
  "solo-light": () => solo("bun"),
  "solo-middle": () => solo("kit"),
  "solo-heavy": () => solo("bramble"),
  "solo-robot": () => solo("rivet"),
  "pass-by": passBy,
  pack,
  moments,
  script4,
  ...Object.fromEntries((["meadow", "kitchen", "harbour", "canyon", "funfair", "snow", "volcano", "space", "palm"] as const).map((theme) => [`place-${theme}`, () => place(theme)])),
};

/** Who drives each kart of a real race in the listening tool: the cast in turn. */
export function cast(count: number): RacerSetup[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `Kart ${i}`, colour: "#ffffff", player: null, skill: 0.7 + 0.04 * i, character: CHARACTERS[i % 8]!.id }));
}
