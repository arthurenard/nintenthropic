/**
 * How a race looks from inside the pack, counted: the bots and one scripted
 * "player" (a kart the race counts as a person's, so the rubber band reads
 * it, but driven by the bots' own code at a skill of the caller's choosing)
 * race a track, and this says how often places changed hands, how often the
 * lead did, how spread out the field was, how many karts were round the
 * player, how often karts touched, and where the player finished. For the
 * tests (bots.test.ts) and for looking: `PACK_REPORT=1 npx vitest run
 * src/kart/sim/pack.test.ts` prints a table.
 */
import type { RacerSetup, TrackDef } from "../contract";
import { GO_TICK } from "./kart";
import { planFor } from "./plan";
import { createSimRace } from "./race";
import { KART_AT } from "./snapshot";

export interface PackOptions {
  seed?: number;
  laps?: number;
  /** Bots on the grid besides the player (the game's default room is six karts: five bots). */
  bots?: number;
  /** The scripted player's skill (1: a sharp driver). Null races bots alone. */
  player?: number | null;
  /** Where the player starts: "back" as the game grids a room (players behind the bots), or "front". */
  start?: "back" | "front";
}

export interface PackStats {
  /** The race came to its end (every kart home, or the player home and the 25 s after). */
  finished: boolean;
  laps: number;
  karts: number;
  /** Places that changed hands and stayed changed (a kart a metre ahead of one that had been ahead of it), per lap of the race. */
  overtakesPerLap: number;
  /** The same, counting only passes where neither kart had spun or fallen in the last 3 s: racecraft, not wreckage. */
  cleanPerLap: number;
  /** Times the lead changed hands. */
  leadChanges: number;
  /** Times the player passed someone or was passed (clean or not). */
  playerPasses: number;
  /** Mean metres from the first kart to the last while all raced. */
  spread: number;
  /** Mean number of other karts within 40 m (along the lap) of the player. */
  nearPlayer: number;
  /** Share of the time with another kart within 15 m of the player: a fight on. */
  fightShare: number;
  /** Bumps between karts, all and with the player in them, per kart per lap. */
  bumpsPerKartLap: number;
  /** Item hits per kart per lap. */
  hitsPerKartLap: number;
  /** The player's final place (0 with no player). */
  playerPlace: number;
  /** Seconds from the first kart home to the last one home before the race ended. */
  finishSpread: number;
  /** How differently one bot drives one lap from the next: the mean (over the lap) of the spread of its offset at the same place, metres. */
  lineVariety: number;
  /** Spread of a bot's lap times (laps 2..), seconds, averaged over the bots. */
  lapTimeSpread: number;
}

const NAMES = ["Pebble", "Marmalade", "Zigzag", "Biscuit", "Comet", "Mochi", "Sprocket", "Juno"];
const DRIVERS = ["bun", "kit", "rivet", "pepper", "juniper", "bramble", "moss", "mango"];

/** A room's field as the game builds one (net/setup.ts): bots with a spread of skills, then the player. */
export function roomField(bots: number, player: number | null, start: "back" | "front" = "back"): RacerSetup[] {
  const field: RacerSetup[] = [];
  for (let i = 0; i < bots; i++) {
    field.push({
      id: 0,
      name: NAMES[i % NAMES.length]!,
      colour: "#ffffff",
      player: null,
      character: DRIVERS[i % DRIVERS.length],
      skill: Math.round((0.35 + 0.6 * ((i * 0.618033988) % 1)) * 100) / 100,
    });
  }
  if (player !== null) {
    const you: RacerSetup = { id: 0, name: "You", colour: "#ff0000", player: 0, character: "kit", skill: player };
    if (start === "front") field.unshift(you);
    else field.push(you);
  }
  return field.map((r, i) => ({ ...r, id: i }));
}

export function packStats(track: TrackDef, options: PackOptions = {}): PackStats {
  const laps = options.laps ?? 3;
  const player = options.player === undefined ? 1 : options.player;
  const field = roomField(options.bots ?? 5, player, options.start ?? "back");
  const r = createSimRace({ track, laps, seed: options.seed ?? 1, racers: field });
  const you = field.findIndex((k) => k.player !== null);
  // The player is driven by the bots' code from the first tick, but the race still counts it as a person's.
  if (you >= 0) r.handOver(you);
  const n = field.length;
  const length = planFor(track).geo.length;

  // Who is ahead of whom, held until the other is a metre clear (side by side is not a pass).
  const ahead: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let overtakes = 0;
  let clean = 0;
  let playerPasses = 0;
  let leadChanges = 0;
  let leader = -1;
  const trouble = new Array<number>(n).fill(-1e9);
  let spreadSum = 0;
  let nearSum = 0;
  let fight = 0;
  let samples = 0;
  let bumps = 0;
  let hits = 0;
  const lapStart = new Array<number>(n).fill(0);
  const lapTimes: number[][] = Array.from({ length: n }, () => []);
  // Offsets by lap and by 5 m bin, for each kart.
  const bins = Math.max(1, Math.floor(length / 5));
  const offsets: Float64Array[][] = Array.from({ length: n }, () => Array.from({ length: laps + 1 }, () => new Float64Array(bins).fill(NaN)));
  const limit = GO_TICK + 60 * 400;
  let first = true;

  while (r.tick < limit && r.view().phase !== "finished") {
    r.step(new Map());
    const tick = r.tick;
    const v = r.view();
    for (const e of v.events) {
      if (e.type === "bump") bumps++;
      else if (e.type === "hit") hits++;
      else if (e.type === "lap" || e.type === "finish") {
        const at = e.type === "finish" ? e.time : v.time;
        if (lapStart[e.kart]! > 0 || e.type === "finish" || v.time > 5) lapTimes[e.kart]!.push(at - lapStart[e.kart]!);
        lapStart[e.kart] = at;
      }
    }
    if (v.phase !== "racing") continue;
    const rows = r.snapshot().k as number[][];
    const progress = rows.map((row) => row[KART_AT.progress]!);
    const done = rows.map((row) => row[KART_AT.finished]! >= 0);
    for (let i = 0; i < n; i++) {
      const row = rows[i]!;
      if (row[KART_AT.spin]! > 0 || row[KART_AT.rescue]! > 0) trouble[i] = tick;
      const lap = row[KART_AT.lap]!;
      if (!done[i] && lap >= 1 && lap <= laps) {
        const bin = Math.floor(row[KART_AT.s]! / 5) % bins;
        offsets[i]![lap]![bin] = row[KART_AT.offset]!;
      }
    }
    if (first) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) ahead[i]![j] = progress[i]! > progress[j]! ? 1 : 0;
      leader = progress.indexOf(Math.max(...progress));
      first = false;
      continue;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (done[i] || done[j]) continue;
        const d = progress[i]! - progress[j]!;
        const was = ahead[i]![j]!;
        if ((was === 1 && d < -1) || (was === 0 && d > 1)) {
          ahead[i]![j] = was === 1 ? 0 : 1;
          ahead[j]![i] = was;
          overtakes++;
          if (tick - trouble[i]! > 180 && tick - trouble[j]! > 180) clean++;
          if (i === you || j === you) playerPasses++;
        }
      }
    }
    // The lead: whoever is ahead of everyone still racing.
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || progress[i]! > progress[best]!)) best = i;
    if (best >= 0 && leader >= 0 && best !== leader && !done[leader] && progress[best]! - progress[leader]! > 1) {
      leadChanges++;
      leader = best;
    } else if (leader < 0 || done[leader]) {
      leader = best;
    }
    // The shape of the pack, twice a second, from 15 s in until someone is home.
    if (tick % 30 === 0 && v.time > 15 && !done.some(Boolean)) {
      samples++;
      spreadSum += Math.max(...progress) - Math.min(...progress);
      if (you >= 0) {
        let near = 0;
        let closest = Infinity;
        for (let i = 0; i < n; i++) {
          if (i === you) continue;
          const gap = Math.abs(progress[i]! - progress[you]!);
          if (gap < 40) near++;
          closest = Math.min(closest, gap);
        }
        nearSum += near;
        if (closest < 15) fight++;
      }
    }
  }

  const result = r.result();
  const times = (result?.standings.map((s) => s.time) ?? []).filter((t): t is number => t !== null);
  const finished = r.view().phase === "finished";
  const playerPlace = you >= 0 ? (result?.standings.find((s) => s.kart === you)?.place ?? 0) : 0;

  // Line variety: at each 5 m bin, the spread (max - min) of a bot's offset over its laps, averaged.
  let varietySum = 0;
  let varietyCount = 0;
  let lapSpreadSum = 0;
  let lapSpreadCount = 0;
  for (let i = 0; i < n; i++) {
    if (i === you) continue;
    for (let b = 0; b < bins; b++) {
      const seen: number[] = [];
      for (let lap = 1; lap <= laps; lap++) {
        const o = offsets[i]![lap]![b]!;
        if (!Number.isNaN(o)) seen.push(o);
      }
      if (seen.length >= 2) {
        varietySum += Math.max(...seen) - Math.min(...seen);
        varietyCount++;
      }
    }
    const later = lapTimes[i]!.slice(1);
    if (later.length >= 2) {
      lapSpreadSum += Math.max(...later) - Math.min(...later);
      lapSpreadCount++;
    }
  }
  const kartLaps = n * laps;
  return {
    finished,
    laps,
    karts: n,
    overtakesPerLap: overtakes / laps,
    cleanPerLap: clean / laps,
    leadChanges,
    playerPasses,
    spread: samples > 0 ? spreadSum / samples : 0,
    nearPlayer: samples > 0 ? nearSum / samples : 0,
    fightShare: samples > 0 ? fight / samples : 0,
    bumpsPerKartLap: bumps / kartLaps,
    hitsPerKartLap: hits / kartLaps,
    playerPlace,
    finishSpread: times.length > 1 ? Math.max(...times) - Math.min(...times) : 0,
    lineVariety: varietyCount > 0 ? varietySum / varietyCount : 0,
    lapTimeSpread: lapSpreadCount > 0 ? lapSpreadSum / lapSpreadCount : 0,
  };
}

/** Means of several races' stats. */
export function meanStats(all: PackStats[]): PackStats {
  const keys = Object.keys(all[0]!) as (keyof PackStats)[];
  const out = {} as Record<keyof PackStats, number | boolean>;
  for (const key of keys) {
    if (typeof all[0]![key] === "boolean") out[key] = all.every((s) => s[key] === true);
    else out[key] = all.reduce((sum, s) => sum + (s[key] as number), 0) / all.length;
  }
  return out as unknown as PackStats;
}
