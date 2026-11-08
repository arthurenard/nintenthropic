/**
 * The Grand Prix: a cup's four races in a row, points by place, the
 * standings after each, the podium after the last. Pure rules, no room and no
 * screen: the host (net/host.ts) keeps a `GrandPrixRun` and publishes its
 * `state()`; the screens read that state and these helpers.
 *
 * Points go 15, 12, 10, 8, 6, 4, 2, 1 by place. Ties in the standings go to
 * the better place in the last race. A bot keeps its name, colour and driver
 * through the cup; a player who leaves keeps their row, and their kart
 * carries on as a bot, winning points for that row.
 */
import type { GrandPrixState, LobbySettings, RaceResult, RacerSetup } from "./contract";
import { CUPS } from "./track/tracks";

/** Points by place, first to eighth; below that, none. */
export const POINTS: readonly number[] = [15, 12, 10, 8, 6, 4, 2, 1];

/** Points for finishing in `place` (1-based). */
export function pointsFor(place: number): number {
  return POINTS[place - 1] ?? 0;
}

/** After a race, the results stay up this long (ms) before the standings, unless the host moves on. */
export const GP_RESULTS_MS = 10_000;
/** The standings stay up this long (ms) before the next race (or the podium), unless the host moves on. */
export const GP_STANDINGS_MS = 15_000;

export type Cup = (typeof CUPS)[number];

/** A cup by id (the first for an unknown one). */
export function cupById(id: string | undefined): Cup {
  return CUPS.find((cup) => cup.id === id) ?? CUPS[0]!;
}

/** The track being raced: the Grand Prix's race in progress, else the room's chosen track. */
export function trackOfRace(settings: Pick<LobbySettings, "track">, grandPrix: Pick<GrandPrixState, "cup" | "race"> | null | undefined): string {
  if (!grandPrix) return settings.track;
  const tracks = cupById(grandPrix.cup).tracks;
  return tracks[Math.min(Math.max(grandPrix.race, 0), tracks.length - 1)]!;
}

/** The row a racer has in the standings: a player by their lobby slot, a bot by its name. */
export function keyOf(racer: Pick<RacerSetup, "name" | "player">): string {
  return racer.player === null ? `b:${racer.name}` : `p${racer.player}`;
}

interface Entry {
  /** The racer as the last race's grid had them (the id is the grid position then). */
  racer: RacerSetup;
  key: string;
  points: number;
  /** Where it finished the last race, or null before one. */
  place: number | null;
  /** Points won in the last race. */
  gain: number;
  /** Its rank before the last race (1-based), or null for the first. */
  rankWas: number | null;
}

/** Best first: more points, then the better place in the last race. */
function rankOf(entries: readonly Entry[], points: (entry: Entry) => number, place: (entry: Entry) => number | null): Entry[] {
  return [...entries].sort((a, b) => {
    if (points(b) !== points(a)) return points(b) - points(a);
    const pa = place(a) ?? Infinity;
    const pb = place(b) ?? Infinity;
    if (pa !== pb) return pa - pb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

export class GrandPrixRun {
  /** 0-based: the race being run or just run. */
  race = 0;
  private entries: Entry[];
  /**
   * The rows of the grid `grid()` gave last, by kart id. A player who has left
   * races on as a bot (`player: null`), so their kart no longer names their
   * row by itself; this does.
   */
  private gridded: Entry[] | null = null;

  private constructor(
    readonly cup: string,
    racers: readonly RacerSetup[],
  ) {
    this.entries = racers.map((racer) => ({ racer: { ...racer }, key: keyOf(racer), points: 0, place: null, gain: 0, rankWas: null }));
  }

  /** A cup begins with its first race's grid. */
  static begin(cup: string, racers: readonly RacerSetup[]): GrandPrixRun {
    return new GrandPrixRun(cupById(cup).id, racers);
  }

  /** How many races the cup has. */
  get races(): number {
    return cupById(this.cup).tracks.length;
  }

  /** The race being run is the cup's last. */
  get last(): boolean {
    return this.race >= this.races - 1;
  }

  /** The track of the race being run. */
  get track(): string {
    return trackOfRace({ track: "" }, { cup: this.cup, race: this.race });
  }

  /** The next race of the cup. */
  advance(): void {
    this.race = Math.min(this.race + 1, this.races - 1);
  }

  /** The race's points go to the rows of the karts that earned them (`racers` is that race's grid). */
  record(result: RaceResult, racers: readonly RacerSetup[]): void {
    const before = rankOf(this.entries, (e) => e.points, (e) => e.place);
    for (const entry of this.entries) {
      entry.rankWas = this.race === 0 ? null : before.indexOf(entry) + 1;
      entry.gain = 0;
      entry.place = null;
    }
    for (const row of result.standings) {
      const racer = racers.find((candidate) => candidate.id === row.kart);
      if (!racer) continue;
      // The row the grid put this kart in (a departed player's kart earns for their row, not for a bot's of the same
      // name); else the one its racer names.
      const gridded = this.gridded?.[row.kart];
      const entry = gridded && gridded.racer.name === racer.name && gridded.racer.colour === racer.colour ? gridded : this.entries.find((candidate) => candidate.key === keyOf(racer));
      if (!entry) continue;
      entry.place = row.place;
      entry.gain = pointsFor(row.place);
      entry.points += entry.gain;
    }
  }

  /** Players in these lobby slots have left: their rows stay, and their karts are bots from now on. */
  leave(slots: readonly number[]): void {
    for (const entry of this.entries) {
      if (entry.racer.player !== null && slots.includes(entry.racer.player)) {
        entry.racer = { ...entry.racer, player: null, skill: entry.racer.skill ?? 0.6 };
      }
    }
  }

  /**
   * The grid for the next race: the players as the room has them now
   * (`players`: racers for those still here, with the room's slots) and
   * every bot as it was, leader on pole (or, `reverse`, last place). Kart ids are the grid positions. A
   * player who is no longer in the room is a bot.
   */
  grid(players: readonly RacerSetup[], reverse = false): RacerSetup[] {
    for (const entry of this.entries) {
      if (entry.racer.player === null) continue;
      const fresh = players.find((candidate) => candidate.player === entry.racer.player);
      if (fresh) entry.racer = { ...fresh };
      else entry.racer = { ...entry.racer, player: null, skill: entry.racer.skill ?? 0.6 };
    }
    this.gridded = rankOf(this.entries, (e) => e.points, (e) => e.place);
    // Reverse Grid (rules.ts): the cup's last place starts on pole.
    if (reverse) this.gridded = [...this.gridded].reverse();
    return this.gridded.map((entry, i) => ({ ...entry.racer, id: i }));
  }

  /** The standings as the room publishes them. */
  state(): GrandPrixState {
    const ranked = rankOf(this.entries, (e) => e.points, (e) => e.place);
    return {
      cup: this.cup,
      race: this.race,
      points: ranked.map((entry) => ({
        key: entry.key,
        name: entry.racer.name,
        colour: entry.racer.colour,
        ...(entry.racer.character ? { character: entry.racer.character } : {}),
        player: entry.racer.player,
        points: entry.points,
        ...(entry.place !== null ? { place: entry.place, gain: entry.gain } : {}),
        ...(entry.rankWas !== null ? { was: entry.rankWas } : {}),
      })),
    };
  }
}
