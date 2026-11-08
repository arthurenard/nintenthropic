/**
 * Rivalries: people remember who spun them out, not what place they came in.
 * Across a session (a cup, or several races in one room until the page closes)
 * this keeps score of who hit whom and who finished ahead of whom, and turns it
 * into a story: the grudge the race intro calls out, the nemesis who wears a
 * little marker, the sting of a Revenge, and the silly, kind awards at the end.
 *
 * Pure bookkeeping, no page and no clock: the screens feed it the race's
 * events (`hit`, `bump`) and its result (`finish`). Each device keeps its own
 * sheet from the events it saw, so a guest who joins mid-session counts from
 * when they arrived (and a hidden tab may miss some): screens can differ a little. The pictures are the screens'.
 *
 * A hit is attributed to whoever sent it (a puck, a seeker, a slick, a decoy, a
 * skyrocket, a blast, a storm, a Comet's bump). A plain bump counts only when it
 * is hard and one kart was clearly the quicker. A kart's own item that comes
 * back at it counts for no one. Between two people it counts in full; a bot at
 * either end counts more lightly (a higher bar for a grudge or a nemesis), since
 * a bot hitting you is the race's business, not a feud.
 */
import type { HitCause, RacerSetup, RaceResult } from "./contract";

/** What a hit may be attributed to: an item or a Comet's touch, or a hard bump. */
export type Source = HitCause | "bump";

/** A bump is a hit only from this strength (0..1) up, and when one kart was this much quicker, m/s. */
export const HARD_BUMP = 0.85;
export const BUMP_EDGE = 3;
/** Two karts this close over the line, seconds, were a photo finish (the same as the results' photo finish). */
export const CLOSE_GAP = 0.15;

/** Hits between two people before it is a grudge; a bot in the pair asks for one more. */
export const GRUDGE_HITS = 3;
const GRUDGE_HITS_BOT = 4;
/** Races together before head-to-head can make a grudge, and how far apart their wins may be. */
const GRUDGE_RACES = 3;
const GRUDGE_RACES_BOT = 4;
/** Hits from one person before they are your nemesis. */
const NEMESIS_HITS = 2;
const NEMESIS_HITS_BOT = 3;

/** A driver across the session: a player keeps their slot's key, a bot its name's. */
export interface Person {
  key: string;
  name: string;
  human: boolean;
}

/** Who a kart id is in the race being run. */
export type Cast = readonly (Person & { id: number })[];

/** The stable key of a racer: a player's slot, a bot's name (as the Grand Prix's points rows are keyed). */
export function keyOf(racer: Pick<RacerSetup, "player" | "name">): string {
  return racer.player !== null ? `p${racer.player}` : `b:${racer.name}`;
}

export function castOf(racers: readonly RacerSetup[]): Cast {
  return racers.map((racer) => ({ id: racer.id, key: keyOf(racer), name: racer.name, human: racer.player !== null }));
}

/** One hit, as the screens tell it: the kart spun out, who sent it, and with what. */
export interface HitFact {
  kart: number;
  by: number | null;
  cause: HitCause;
}

/** What `hit` and `bump` made of a hit worth keeping. */
export interface HitNote {
  by: Person & { id: number };
  victim: Person & { id: number };
  source: Source;
  /** The attacker has hit the victim this often in all, this one included. */
  count: number;
  /** The victim was the attacker's nemesis: they got them back. */
  revenge: boolean;
}

/** A pair with something to settle. */
export interface Grudge {
  a: Person;
  b: Person;
  /** What each has to show, a first: hits landed on the other, or races finished ahead of them. */
  aScore: number;
  bScore: number;
  basis: "hits" | "races";
  /** How big it is, to pick the biggest. */
  heat: number;
}

/** "Kit vs Mango: 3-1". */
export function grudgeLine(grudge: Grudge): string {
  return `${grudge.a.name} vs ${grudge.b.name}: ${grudge.aScore}-${grudge.bScore}`;
}

/** The small line under it: what the numbers count. */
export function grudgeBasis(grudge: Grudge): string {
  return grudge.basis === "hits" ? "Hits between them" : "Who finishes ahead";
}

// ─── The score sheet ─────────────────────────────────────────────────────────

/** Everything counted over one stretch (a race, a cup, the session). */
export class Tally {
  readonly people = new Map<string, Person>();
  /** Hits landed, and hits taken, by person. */
  readonly made = new Map<string, number>();
  readonly taken = new Map<string, number>();
  /** `by>victim` → hits. */
  readonly pairs = new Map<string, number>();
  /** `a>b` → races a finished ahead of b. */
  readonly ahead = new Map<string, number>();
  /** Places gained from the grid to the flag, summed (a place lost counts against). */
  readonly gained = new Map<string, number>();
  /** Photo finishes taken part in. */
  readonly close = new Map<string, number>();
  /** Races finished, by person, and how many races this covers. */
  readonly raced = new Map<string, number>();
  /** Sum of the places finished in (for breaking a tie kindly: the better racer first). */
  readonly placeSum = new Map<string, number>();
  races = 0;

  clone(): Tally {
    const copy = new Tally();
    for (const key of ["people", "made", "taken", "pairs", "ahead", "gained", "close", "raced", "placeSum"] as const) {
      for (const [k, v] of this[key] as Map<string, unknown>) (copy[key] as Map<string, unknown>).set(k, v);
    }
    copy.races = this.races;
    return copy;
  }

  private bump(map: Map<string, number>, key: string, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by);
  }

  meet(person: Person): void {
    if (!this.people.has(person.key)) this.people.set(person.key, person);
  }

  hit(by: Person, victim: Person): number {
    this.meet(by);
    this.meet(victim);
    this.bump(this.made, by.key);
    this.bump(this.taken, victim.key);
    const key = `${by.key}>${victim.key}`;
    this.bump(this.pairs, key);
    return this.pairs.get(key)!;
  }

  /** How many times `by` has hit `victim`. */
  hits(by: string, victim: string): number {
    return this.pairs.get(`${by}>${victim}`) ?? 0;
  }

  /** How many races `a` finished ahead of `b`. */
  wins(a: string, b: string): number {
    return this.ahead.get(`${a}>${b}`) ?? 0;
  }

  /** A race's finishing order, with where each started. */
  finish(rows: readonly { person: Person; place: number; grid: number; time: number | null }[]): void {
    this.races++;
    const sorted = [...rows].sort((x, y) => x.place - y.place);
    for (const row of sorted) {
      this.meet(row.person);
      this.bump(this.raced, row.person.key);
      this.bump(this.placeSum, row.person.key, row.place);
      this.bump(this.gained, row.person.key, row.grid - row.place);
    }
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!.person;
        const b = sorted[j]!.person;
        // Two bots finishing in some order is nobody's story.
        if (!a.human && !b.human) continue;
        this.bump(this.ahead, `${a.key}>${b.key}`);
      }
    }
    // Neighbours over the line together: a photo finish for each of the two.
    for (let i = 0; i + 1 < sorted.length; i++) {
      const x = sorted[i]!;
      const y = sorted[i + 1]!;
      if (x.time === null || y.time === null || y.time - x.time > CLOSE_GAP) continue;
      this.bump(this.close, x.person.key);
      this.bump(this.close, y.person.key);
    }
  }

  get totalHits(): number {
    let sum = 0;
    for (const n of this.made.values()) sum += n;
    return sum;
  }
}

/** The pair's story, or null: hits between them if there are enough, else a close head-to-head. */
export function pairGrudge(tally: Tally, a: Person, b: Person): Grudge | null {
  const ab = tally.hits(a.key, b.key);
  const ba = tally.hits(b.key, a.key);
  const bot = !a.human || !b.human;
  if (!a.human && !b.human) return null;
  const total = ab + ba;
  const wa = tally.wins(a.key, b.key);
  const wb = tally.wins(b.key, a.key);
  const together = wa + wb;
  let grudge: Grudge | null = null;
  if (total >= (bot ? GRUDGE_HITS_BOT : GRUDGE_HITS)) {
    grudge = { a, b, aScore: ab, bScore: ba, basis: "hits", heat: (total + 0.4 * together) * (bot ? 0.6 : 1) };
  } else if (together >= (bot ? GRUDGE_RACES_BOT : GRUDGE_RACES) && Math.abs(wa - wb) <= 1) {
    grudge = { a, b, aScore: wa, bScore: wb, basis: "races", heat: together * (bot ? 0.3 : 0.7) };
  }
  if (!grudge) return null;
  // The one ahead on the numbers is named first; level, the player first, then by name.
  if (grudge.bScore > grudge.aScore || (grudge.aScore === grudge.bScore && (b.human && !a.human ? true : b.human === a.human && b.name < a.name))) {
    return { ...grudge, a: grudge.b, b: grudge.a, aScore: grudge.bScore, bScore: grudge.aScore };
  }
  return grudge;
}

/** The biggest grudge among these people (everyone, if none are named), or null. */
export function biggestGrudge(tally: Tally, among?: ReadonlySet<string>): Grudge | null {
  const people = [...tally.people.values()].filter((person) => !among || among.has(person.key));
  let best: Grudge | null = null;
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const grudge = pairGrudge(tally, people[i]!, people[j]!);
      if (grudge && (!best || grudge.heat > best.heat)) best = grudge;
    }
  }
  return best;
}

/**
 * Who has been after `me` the most: the one with the most hits on them (a bar of two, three for a bot), the better
 * racer of those level; failing that, whoever they have the closest head-to-head with. Null if nobody.
 */
export function nemesisOf(tally: Tally, me: string, among?: ReadonlySet<string>): string | null {
  let best: { key: string; hits: number; beat: number } | null = null;
  for (const person of tally.people.values()) {
    if (person.key === me || (among && !among.has(person.key))) continue;
    const hits = tally.hits(person.key, me);
    if (hits < (person.human ? NEMESIS_HITS : NEMESIS_HITS_BOT)) continue;
    const beat = tally.wins(person.key, me);
    // A bot's hits weigh less, so a person who has been after you as much is the nemesis.
    const weight = hits * (person.human ? 1 : 0.65);
    if (!best || weight > best.hits || (weight === best.hits && beat > best.beat)) best = { key: person.key, hits: weight, beat };
  }
  if (best) return best.key;
  const mine = tally.people.get(me);
  if (!mine) return null;
  let heat = 0;
  let found: string | null = null;
  for (const person of tally.people.values()) {
    if (person.key === me || (among && !among.has(person.key))) continue;
    const grudge = pairGrudge(tally, mine, person);
    if (grudge && grudge.heat > heat) {
      heat = grudge.heat;
      found = person.key;
    }
  }
  return found;
}

// ─── The awards ──────────────────────────────────────────────────────────────

export type AwardId = "sharpshooter" | "magnet" | "pacifist" | "comeback" | "photo" | "nemesis";

/** A silly, kind title for one or two people, with a line saying why. */
export interface Award {
  id: AwardId;
  title: string;
  /** Who it went to (more than one when they were level), by name, and by key. */
  names: string[];
  keys: string[];
  detail: string;
}

/** How much it takes to earn each award over a stretch of racing: a single race asks for less than a whole cup. */
export interface AwardBars {
  hits: number;
  taken: number;
  gained: number;
  nemesis: number;
  /** Hits in all before a Pacifist means anything. */
  busy: number;
}

export const RACE_BARS: AwardBars = { hits: 2, taken: 2, gained: 3, nemesis: 2, busy: 3 };
export const CUP_BARS: AwardBars = { hits: 3, taken: 3, gained: 4, nemesis: 3, busy: 5 };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const join = (names: string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The people with the most (or fewest) of something from a table; ties kept, the better racers first. */
function leaders(pool: readonly Person[], score: (key: string) => number, floor: number, levelIsFine = false): { people: Person[]; value: number } | null {
  let best = -Infinity;
  for (const person of pool) best = Math.max(best, score(person.key));
  if (!(best >= floor)) return null;
  const people = pool.filter((person) => score(person.key) === best);
  // Everyone level is no award: it says nothing about anyone.
  if (!levelIsFine && pool.length > 1 && people.length === pool.length) return null;
  return { people, value: best };
}

/** The awards a stretch of racing earned: at most four, no one with more than two, [] when there is nothing to say. */
export function pickAwards(tally: Tally, bars: AwardBars = RACE_BARS): Award[] {
  // People earn them; a bot is not given a title.
  const pool = [...tally.people.values()].filter((person) => person.human && (tally.raced.get(person.key) ?? 0) > 0);
  if (pool.length === 0) return [];
  const rank = (a: Person, b: Person) =>
    (tally.placeSum.get(a.key) ?? 0) / (tally.raced.get(a.key) ?? 1) - (tally.placeSum.get(b.key) ?? 0) / (tally.raced.get(b.key) ?? 1) || a.name.localeCompare(b.name);
  const made = (key: string) => tally.made.get(key) ?? 0;
  const out: Award[] = [];
  const give = (id: AwardId, title: string, people: Person[], detail: string) => {
    const sorted = [...people].sort(rank);
    out.push({ id, title, names: sorted.map((p) => p.name), keys: sorted.map((p) => p.key), detail });
  };

  const sharp = leaders(pool, made, bars.hits);
  if (sharp) give("sharpshooter", "Sharpshooter", sharp.people, `Landed ${plural(sharp.value, "hit")}.`);

  const magnet = leaders(pool, (key) => tally.taken.get(key) ?? 0, bars.taken);
  // The same person is not both the best shot and the best target twice over: the target wins the title only if it is someone else.
  if (magnet && !(sharp && magnet.people.every((p) => sharp.people.some((q) => q.key === p.key)))) {
    give("magnet", "Magnet", magnet.people, `Attracted ${plural(magnet.value, "hit")} and kept smiling.`);
  }

  if (tally.totalHits >= bars.busy) {
    const calm = pool.filter((person) => made(person.key) === 0);
    // Several can be calm: the best finisher of them has the title.
    const winner = calm.sort(rank)[0];
    if (winner && (pool.length === 1 || calm.length < pool.length)) give("pacifist", "Pacifist", [winner], tally.races > 1 ? "Not one hit all cup." : "Not one hit all race.");
  }

  const comeback = leaders(pool, (key) => tally.gained.get(key) ?? 0, bars.gained);
  if (comeback) give("comeback", "Comeback Kid", comeback.people, `Gained ${plural(comeback.value, "place")}.`);

  const photo = leaders(pool, (key) => tally.close.get(key) ?? 0, 1, true);
  if (photo) give("photo", "Photo Finisher", photo.people, photo.value > 1 ? `${plural(photo.value, "finish", "finishes")} by a hair.` : "Finished by a hair.");

  // The attacker with the most hits on one person.
  let top: { by: Person; victim: Person; n: number } | null = null;
  for (const by of pool) {
    for (const victim of tally.people.values()) {
      if (victim.key === by.key) continue;
      const n = tally.hits(by.key, victim.key);
      if (n >= bars.nemesis && (!top || n > top.n || (n === top.n && rank(by, top.by) < 0))) top = { by, victim, n };
    }
  }
  if (top) give("nemesis", "Nemesis of the Day", [top.by], `Kept finding ${top.victim.name}: ${plural(top.n, "hit")}.`);

  // At most four, and no one has them all.
  const count = new Map<string, number>();
  const kept: Award[] = [];
  for (const award of out) {
    if (kept.length >= 4) break;
    if (award.keys.some((key) => (count.get(key) ?? 0) >= 2)) continue;
    for (const key of award.keys) count.set(key, (count.get(key) ?? 0) + 1);
    kept.push(award);
  }
  return kept;
}

/** "Kit and Mango" for an award's names. */
export function awardWho(award: Award): string {
  return join(award.names);
}

// ─── The ledger the app keeps ────────────────────────────────────────────────

/** The race a ledger is counting: which one, who is in it, where each started. */
interface Running {
  id: number;
  cast: Cast;
  grid: Map<number, number>;
  done: boolean;
  /** The tallies as they were before this race, for a race that is started over. */
  before: { session: Tally; cup: Tally };
}

/**
 * The session's score: three tallies (the race, the cup, the whole session) fed by the same events. One lives with
 * the room (the app makes it when a room opens and drops it when it closes); Practice alone has none.
 */
export class Rivalries {
  session = new Tally();
  cup = new Tally();
  race = new Tally();
  private cupId: string | null = null;
  private running: Running | null = null;

  /** The race being counted (its lobby `race` number), or null. */
  get raceId(): number | null {
    return this.running?.id ?? null;
  }

  /** Who is in the race being counted. */
  get cast(): Cast {
    return this.running?.cast ?? [];
  }

  /**
   * A race begins: its grid, and which cup race it is (null for a single race). Called once per race (the same id
   * again does nothing); a race left unfinished (a restart) is taken back out of the score first.
   */
  begin(id: number, racers: readonly RacerSetup[], gp: { cup: string; race: number } | null): void {
    if (this.running?.id === id) return;
    if (this.running && !this.running.done) {
      this.session = this.running.before.session;
      this.cup = this.running.before.cup;
    }
    if (!gp) this.cupId = null;
    else if (gp.race === 0 || gp.cup !== this.cupId) {
      this.cupId = gp.cup;
      this.cup = new Tally();
    }
    const cast = castOf(racers);
    this.running = {
      id,
      cast,
      grid: new Map(racers.map((racer, index) => [racer.id, index + 1])),
      done: false,
      before: { session: this.session.clone(), cup: this.cup.clone() },
    };
    this.race = new Tally();
    for (const person of cast) for (const tally of [this.session, this.cup, this.race]) tally.meet(person);
  }

  private person(kart: number): (Person & { id: number }) | undefined {
    return this.running?.cast.find((entry) => entry.id === kart);
  }

  private record(by: Person & { id: number }, victim: Person & { id: number }, source: Source): HitNote {
    // Revenge is worked out before this hit is on the sheet: was this one their nemesis?
    const among = this.present();
    const revenge = by.human && nemesisOf(this.session, by.key, among) === victim.key;
    const count = this.session.hit(by, victim);
    this.cup.hit(by, victim);
    this.race.hit(by, victim);
    return { by, victim, source, count, revenge };
  }

  private present(): ReadonlySet<string> {
    return new Set((this.running?.cast ?? []).map((person) => person.key));
  }

  /** A kart spun out by an item or a Comet's touch. Null: not a hit worth keeping (a hazard, a kart's own item, an unknown kart). */
  hit(fact: HitFact): HitNote | null {
    if (!this.running || this.running.done || fact.by === null || fact.by === fact.kart) return null;
    const by = this.person(fact.by);
    const victim = this.person(fact.kart);
    if (!by || !victim) return null;
    return this.record(by, victim, fact.cause);
  }

  /**
   * Two karts bumped: a hit only if it was hard and one was clearly the quicker (that one rammed). The speeds are the
   * karts' as the view had them at the time.
   */
  bump(a: number, b: number, strength: number, speeds: { a: number; b: number }, comets?: { a: boolean; b: boolean }): HitNote | null {
    if (!this.running || this.running.done || strength < HARD_BUMP) return null;
    if (comets?.a && comets.b) return null; // two untouchable karts bounce off each other: no one was hit
    const x = this.person(a);
    const y = this.person(b);
    if (!x || !y) return null;
    const sa = Math.abs(speeds.a);
    const sb = Math.abs(speeds.b);
    if (Math.abs(sa - sb) < BUMP_EDGE) return null;
    return sa > sb ? this.record(x, y, "bump") : this.record(y, x, "bump");
  }

  /** The race is decided: who finished ahead of whom, who gained places. Once per race. */
  finish(standings: RaceResult["standings"]): void {
    const running = this.running;
    if (!running || running.done) return;
    running.done = true;
    const rows = standings.flatMap((row) => {
      const person = running.cast.find((entry) => entry.id === row.kart);
      const grid = running.grid.get(row.kart);
      return person && grid !== undefined ? [{ person, place: row.place, grid, time: row.time }] : [];
    });
    for (const tally of [this.session, this.cup, this.race]) tally.finish(rows);
  }

  /** The biggest grudge among the race's cast, for the intro, or null. */
  grudge(): Grudge | null {
    return biggestGrudge(this.session, this.present());
  }

  /** The kart of `kart`'s nemesis in this race, or null. */
  nemesis(kart: number): number | null {
    const me = this.person(kart);
    if (!me) return null;
    const key = nemesisOf(this.session, me.key, this.present());
    return key === null ? null : (this.running!.cast.find((person) => person.key === key)?.id ?? null);
  }

  /** The awards for the race just run. */
  raceAwards(): Award[] {
    return pickAwards(this.race, RACE_BARS);
  }

  /** The awards for the cup so far. */
  cupAwards(): Award[] {
    return pickAwards(this.cup, CUP_BARS);
  }

  /** Forgets everything (the room is left). */
  clear(): void {
    this.session = new Tally();
    this.cup = new Tally();
    this.race = new Tally();
    this.cupId = null;
    this.running = null;
  }
}
