/**
 * How far round everyone is: laps, places, finishing, and the end of the race.
 *
 * A kart's progress is the net distance it has driven along the lap, from the
 * start line (negative on the grid). A lap counts when progress reaches the
 * next whole lap, and a lap is never counted twice: reversing back over the
 * line and forward again does not move it past where it had got to, and
 * since the lap is only ever what the net distance says, a kart cannot gain
 * one without driving the whole way round, past the halfway point, and
 * across the line forward.
 */
import type { RaceResult } from "../contract";
import { GO_TICK, forwardSpeed, type Emit } from "./kart";
import { q3, type KartState, type World } from "./state";
import { TUNING, ticks } from "./tuning";

/** Race time in seconds at the end of the tick being processed (`tick` steps already taken, and this one). */
export function raceTime(tick: number): number {
  return Math.max(0, (tick + 1 - GO_TICK) / 60);
}

/** Karts in the order of the race: the fixed places first, then the rest by progress. */
export function ranking(karts: readonly KartState[]): KartState[] {
  return karts.slice().sort((a, b) => {
    if (a.finalPlace > 0 && b.finalPlace > 0) return a.finalPlace - b.finalPlace;
    if (a.finalPlace > 0) return -1;
    if (b.finalPlace > 0) return 1;
    return b.progress - a.progress || a.id - b.id;
  });
}

/** Whose finishing ends the race: the players', or everyone's when there are none. */
function watched(w: World): KartState[] {
  const players = w.state.karts.filter((k) => k.player);
  return players.length > 0 ? players : w.state.karts;
}

/** Counts laps and finishes after a tick's movement; ends the race when it is time. */
export function updateProgress(w: World, emit: Emit): void {
  const { state, geo } = w;
  const laps = w.laps;
  if (state.tick < GO_TICK || state.over) {
    updatePlaces(w);
    return;
  }
  const length = geo.length;
  const now = raceTime(state.tick);
  const finishers: KartState[] = [];

  for (const k of state.karts) {
    if (k.finished !== null) continue;
    // When it crossed whatever line it just crossed, a little before the end of this tick.
    const crossed = (progress: number) => Math.max(0, now - Math.max(0, k.progress - progress) / Math.max(1, Math.abs(forwardSpeed(k))));
    if (k.lapStart < 0 && k.progress >= 0) k.lapStart = q3(crossed(0));
    const reached = Math.min(laps, Math.floor(Math.max(0, k.progress) / length) + 1);
    while (k.lap < reached) {
      const at = q3(crossed(k.lap * length));
      const time = at - k.lapStart;
      if (time > 0 && (k.bestLap === null || time < k.bestLap)) k.bestLap = q3(time);
      k.lapStart = at;
      k.lap++;
      emit({ type: "lap", kart: k.id, lap: k.lap });
      if (k.lap === laps) emit({ type: "final-lap", kart: k.id });
    }
    if (k.progress >= laps * length) finishers.push(k);
  }

  // Several karts can finish on one tick: the one furthest past the line was first.
  finishers.sort((a, b) => b.progress - a.progress || a.id - b.id);
  for (const k of finishers) {
    const at = q3(Math.max(k.lapStart, Math.min(now, now - (k.progress - laps * length) / Math.max(1, Math.abs(forwardSpeed(k))))));
    const time = at - k.lapStart;
    if (time > 0 && (k.bestLap === null || time < k.bestLap)) k.bestLap = q3(time);
    k.finished = at;
    k.lap = laps + 1;
    state.home.push(k.id);
    k.finalPlace = state.home.length;
    k.place = k.finalPlace;
    // From here the kart drives itself.
    k.ai = true;
    k.bot.presses = k.presses;
    emit({ type: "finish", kart: k.id, place: k.finalPlace, time: at });
  }

  const watching = watched(w);
  if (state.firstHome < 0 && watching.some((k) => k.finished !== null)) state.firstHome = state.tick;
  const allHome = watching.every((k) => k.finished !== null);
  const late = state.firstHome >= 0 && state.tick + 1 - state.firstHome >= ticks(TUNING.race.grace);
  if (allHome || late) {
    // The rest are placed by how far round they got, and drive on as bots.
    for (const k of ranking(state.karts)) {
      if (k.finalPlace === 0) {
        k.finalPlace = state.home.length + 1;
        state.home.push(k.id);
      }
      k.ai = true;
    }
    state.over = true;
    // `home` was the order of finishing; the unplaced were appended in the order of progress.
  }
  updatePlaces(w);
}

/** Live places for the HUD, and what the item odds read. */
export function updatePlaces(w: World): void {
  const ranked = ranking(w.state.karts);
  for (let i = 0; i < ranked.length; i++) ranked[i]!.place = i + 1;
}

/** The standings, once the race is over. */
export function standings(w: World): RaceResult | null {
  if (!w.state.over) return null;
  const ranked = w.state.karts.slice().sort((a, b) => a.finalPlace - b.finalPlace);
  return {
    standings: ranked.map((k) => ({ kart: k.id, place: k.finalPlace, time: k.finished, bestLap: k.bestLap })),
  };
}
