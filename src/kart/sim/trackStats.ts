/**
 * What eight bots do on a track, counted, for the tests (and for looking at a
 * new track: print the result): lap times, falls, hits by hazards, jumps,
 * the longest any kart sat still, how long they spent on the grass.
 */
import type { RacerSetup, TrackDef } from "../contract";
import { GO_TICK } from "./kart";
import { createSimRace } from "./race";

export interface TrackStats {
  finished: boolean;
  /** Race time of the winner and of the last kart home, seconds. */
  first: number;
  last: number;
  /** The fastest and slowest single lap by any kart, seconds. */
  bestLap: number;
  worstLap: number;
  falls: number;
  /** Falls per kart per lap. */
  fallRate: number;
  rescues: number;
  hazardHits: number;
  jumps: number;
  tricks: number;
  tricked: number;
  walls: number;
  /** The longest any kart sat nearly still while it was its own to drive, seconds. */
  stuck: number;
  /** Share of the racing time karts spent off the road. */
  offroad: number;
  /** Where each fall happened, as fractions of the lap. */
  fallAt: number[];
}

export function botField(count = 8): RacerSetup[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `Bot ${i}`, colour: "#ffffff", player: null, skill: 1 - i * 0.1 }));
}

export function trackStats(track: TrackDef, options: { seed?: number; laps?: number; field?: RacerSetup[] } = {}): TrackStats {
  const laps = options.laps ?? 3;
  const field = options.field ?? botField();
  const r = createSimRace({ track, laps, seed: options.seed ?? 1, racers: field });
  const still = new Array<number>(field.length).fill(0);
  const lapStart = new Array<number>(field.length).fill(0);
  let stuck = 0;
  let falls = 0;
  let rescues = 0;
  let hazardHits = 0;
  let jumps = 0;
  let tricks = 0;
  let tricked = 0;
  let walls = 0;
  let offroad = 0;
  let racing = 0;
  let bestLap = Infinity;
  let worstLap = 0;
  const fallAt: number[] = [];
  const limit = GO_TICK + 60 * 360;
  while (r.tick < limit && r.view().phase !== "finished") {
    r.step(new Map());
    const v = r.view();
    for (const e of v.events) {
      if (e.type === "fall") {
        falls++;
        const k = v.karts[e.kart]!;
        fallAt.push(Math.round(k.lapProgress * 1000) / 1000);
      } else if (e.type === "rescued") rescues++;
      else if (e.type === "hazard") hazardHits++;
      else if (e.type === "jump") jumps++;
      else if (e.type === "trick") tricks++;
      else if (e.type === "land" && e.boost) tricked++;
      else if (e.type === "wall") walls++;
      else if (e.type === "lap" || e.type === "finish") {
        const at = e.type === "finish" ? e.time : v.time;
        const lap = at - lapStart[e.kart]!;
        lapStart[e.kart] = at;
        if (lap > 5) {
          bestLap = Math.min(bestLap, lap);
          worstLap = Math.max(worstLap, lap);
        }
      }
    }
    if (v.phase !== "racing") continue;
    for (const k of v.karts) {
      racing++;
      if (k.offroad) offroad++;
      const sitting = k.finished === null && k.rescue === 0 && k.spin === 0 && k.hop === 0 && Math.abs(k.speed) < 1.5;
      still[k.id] = sitting ? still[k.id]! + 1 : 0;
      stuck = Math.max(stuck, still[k.id]! / 60);
    }
  }
  const result = r.result();
  const times = result?.standings.map((s) => s.time) ?? [];
  const done = times.length > 0 && times.every((t) => t !== null);
  const karts = field.length;
  return {
    finished: done,
    first: done ? Math.min(...(times as number[])) : Infinity,
    last: done ? Math.max(...(times as number[])) : Infinity,
    bestLap,
    worstLap,
    falls,
    fallRate: falls / (karts * laps),
    rescues,
    hazardHits,
    jumps,
    tricks,
    tricked,
    walls,
    stuck,
    offroad: racing > 0 ? offroad / racing : 0,
    fallAt,
  };
}
