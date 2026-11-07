/**
 * What the simulation keeps between ticks, and the small helpers every part of
 * it shares. All of it is plain numbers, so a snapshot is a handful of arrays.
 *
 * Nothing here is allowed to drift between a snapshot and the state it was
 * taken from, or `restore` then carrying on would not equal never having
 * snapshotted. So every number is rounded (`settle`) at the end of every tick,
 * to a precision the snapshot then writes out exactly: millimetres for places
 * and speeds, a tenth of a milliradian for headings. Timers are whole ticks.
 */
import type { ItemKind, RaceEvent, RaceSetup } from "../contract";
import type { WeightMods } from "../characters";
import type { Surface, TrackGeometry } from "../track/geometry";
import type { TrackPlan } from "./plan";

export const ITEM_KINDS: readonly ItemKind[] = ["nitro", "nitro3", "puck", "seeker", "slick", "puck3", "comet", "storm", "skyrocket", "blast", "decoy"];

/** Items that are used more than once: how many uses they come with. */
export const ITEM_USES: Readonly<Partial<Record<ItemKind, number>>> = { nitro3: 3, puck3: 3 };

/** Millimetres (or milliseconds, or milli-anything). */
export function q3(v: number): number {
  // + 0: a tiny negative rounds to -0, which JSON turns into 0 (a snapshot must survive the trip unchanged).
  return Math.round(v * 1000) / 1000 + 0;
}

/** A tenth of a milliradian. */
export function q4(v: number): number {
  return Math.round(v * 10000) / 10000 + 0;
}

/** An angle brought into -pi..pi. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r < -Math.PI) r += twoPi;
  return r;
}

export function clamp(v: number, low: number, high: number): number {
  return v < low ? low : v > high ? high : v;
}

/** A bot's memory between ticks: what it would otherwise have to decide afresh. */
export interface BotMemory {
  /** Its own count of item presses, which it hands the kart as `itemPresses`. */
  presses: number;
  /** Ticks until it uses the item it holds. */
  wait: number;
  /** Ticks it has been stuck for. */
  stuck: number;
  /** Ticks it still has to back up for. */
  back: number;
  /** Ticks until it next wonders whether to make a mistake. */
  next: number;
  /** Ticks its steering is frozen for (a mistake). */
  freeze: number;
  /** The steer it held last tick. */
  steer: number;
  /** Wanting to drift: holds the drift button. */
  drifting: boolean;
  /** The verge cut (index + 1, in the plan's list) it is driving, or 0. */
  cut: number;
}

/** What the kart is driving on: the road, or one of the track's other grounds. */
export type Ground = Surface | "road";

export interface KartState {
  id: number;
  /** A person drives it (until it finishes or they leave), as the setup says. */
  player: boolean;
  /** The kart's own tick count: the race's, except that `predict` runs it ahead. */
  t: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  /** The steer the kart is answering. */
  steer: number;

  // Hop and drift.
  hop: number;
  drift: -1 | 0 | 1;
  /** Charge, in ticks of a middling turn. */
  charge: number;
  level: 0 | 1 | 2 | 3;
  prevDrift: boolean;
  /** Ticks the wheel has been held hard against the drift. */
  counter: number;
  /** Ticks in the wake of another kart (the slipstream's charge); below zero, the rest after its boost, counting up. */
  draft: number;

  // Boost, spin, flood, reverse. All in ticks.
  boost: number;
  spin: number;
  flood: number;
  /** The brake pedal's build-up, in ticks (it grows while the brake is held, fades when let go). Named `stand` on the wire. */
  stand: number;
  /** Ticks in a row the throttle has been on while counting down. */
  held: number;

  // Items.
  item: ItemKind | null;
  uses: number;
  /** Ticks of roulette left (0: not rolling). */
  roll: number;
  /** What the roulette will land on. */
  rolled: ItemKind | null;
  /** How many item presses the kart has acted on. */
  presses: number;

  // On the track.
  /** The road it is on: 0 the main road, 1.. a branch (`geo.routes[route - 1]`). Worked out from where it is, so not kept in a snapshot. */
  route: number;
  /** Metres along the lap (on a branch, the lap's metre it stands for). */
  s: number;
  offset: number;
  offroad: boolean;
  /** Pressed against a barrier this tick (heard as a scrape; not part of a snapshot). */
  rub: boolean;
  /** Net distance travelled along the lap from the start line, metres (negative on the grid). */
  progress: number;
  /** The boost pad (index + 1) the kart is on, -1 on a boost strip, or 0. */
  pad: number;
  /** What it is driving on (worked out from where it is, so not kept in a snapshot). */
  ground: Ground;

  // In the air off a ramp or a crest (the hop above is the small one) and falling off the edge.
  /** Metres above the road, and the upward speed (in the world: the road's own rise is in it). 0 on the ground. */
  air: number;
  vy: number;
  /**
   * 0 on the ground (a kart just off a crest, not yet high enough to be a jump, is 0 with `aloft` counting), 1 in a
   * jump (or dropping off a ramp's lip too slow to fly), 2 in a jump where a trick is allowed,
   * 3 in a planned arc (a cannon or a lip: tricks allowed), 4 gliding under a parasol (sim/air.ts).
   */
  flight: 0 | 1 | 2 | 3 | 4;
  /** Ticks since a trick began in the air, or 0. */
  trick: number;
  /** Ticks since the kart left the ground (up to 255), 0 on it. */
  aloft: number;
  /** The shake count (DriveInput.shakes) the kart has acted on. */
  shakes: number;
  /** On the ground: ticks left in which a shake just made kicks a jump off a lip. In the air: -1 once a shake has kicked this jump. */
  prime: number;
  /** Ticks left of a rescue (0: none). */
  rescue: number;
  /** Ticks left in which hazards and items pass through the kart. */
  immune: number;
  /** Ticks left of a Comet (untouchable, faster); it keeps `immune` up meanwhile. */
  comet: number;
  /** Ticks left crawling after a storm. */
  zap: number;
  wrong: number;
  wrongWay: boolean;

  // The race.
  /** Live rank, 1-based. */
  place: number;
  /** The highest lap reached so far, 1-based. */
  lap: number;
  /** When the current lap began, seconds of race time. */
  lapStart: number;
  bestLap: number | null;
  /** Race time it finished in, or null. */
  finished: number | null;
  /** Its final place once fixed (finishing, or the race ending), else 0. */
  finalPlace: number;

  // Who drives.
  ai: boolean;
  skill: number;
  bot: BotMemory;
  /** The rubber band's say in a bot's top speed this tick (1: none). Worked out afresh every tick, so not kept in a snapshot. */
  band: number;
  /** The driver's weight in numbers (characters.ts WEIGHTS), fixed by the setup: not kept in a snapshot. */
  mods: WeightMods;
}

export interface Puck {
  id: number;
  owner: number;
  x: number;
  z: number;
  /** Where along the track, for finding the barriers. */
  s: number;
  vx: number;
  vz: number;
  /** Ticks left to live. */
  life: number;
  age: number;
}

export interface Seeker {
  id: number;
  owner: number;
  /** The kart it homes in on once close, or -1. */
  target: number;
  x: number;
  z: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  s: number;
  life: number;
  age: number;
}

export interface Slick {
  id: number;
  owner: number;
  x: number;
  z: number;
  /** Where along the track, and how far right of the centre line there. */
  s: number;
  offset: number;
  age: number;
}

/** A skyrocket in flight: along the centre line to the leader, then a burst. */
export interface Skyrocket {
  id: number;
  owner: number;
  /** Where along the track (the lap's s) it flies over. */
  s: number;
  /** How far it had to go when it left (for its arc in the picture). */
  total: number;
  age: number;
}

/** Everything that moves and ticks over: this is what a snapshot carries. */
export interface SimState {
  tick: number;
  karts: KartState[];
  /** Ticks until each item box is back (0: there). */
  boxes: number[];
  pucks: Puck[];
  seekers: Seeker[];
  slicks: Slick[];
  /** Item boxes that are not (same shape as a slick: it waits for a kart). */
  decoys: Slick[];
  skyrockets: Skyrocket[];
  /** The tick the last storm was drawn or used, or -1: storms are rationed. */
  stormAt: number;
  nextThing: number;
  nextEvent: number;
  /** The tick the first player finished at, or -1. */
  firstHome: number;
  /** Karts that have finished, in order. */
  home: number[];
  /** The race is over: the standings are fixed. */
  over: boolean;
}

/** What the parts of the simulation see of the race they are part of. */
export interface World {
  setup: RaceSetup;
  /** Laps to the race: the setup's, but at least one. */
  laps: number;
  geo: TrackGeometry;
  plan: TrackPlan;
  /** Set on the view of the race from a branch road (`onRoute`): `geo` and `plan` are the branch's and this is the race itself. */
  main?: World;
  state: SimState;
  /** A kart by its id. */
  kart(id: number): KartState | undefined;
  /** The seeded generator, counted so a snapshot can say how far it has run. */
  rng: { next(): number; draws(): number; reset(draws: number): void };
  /** Records an event; a no-op when only predicting. */
  emit(event: EventBody): void;
  /** The best player's progress (for the bots' rubber band), or null when there is none racing. */
  bestPlayer: number | null;
}

/** An event before the race has given it an id and a tick. */
export type EventBody = RaceEvent extends infer E ? (E extends unknown ? Omit<E, "id" | "tick"> : never) : never;
