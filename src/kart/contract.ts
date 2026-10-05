/**
 * Grip Prix: the contract between its parts. Every part is built against
 * these types and nothing else of another part's, so they can be built side
 * by side and swapped out (docs/GRIP_PRIX.md, "Parts and owners").
 *
 *   input   (src/kart/input)   hands, keys, a gamepad → DriveInput, 60 times a second
 *   sim     (src/kart/sim)     DriveInputs → the race, one fixed tick at a time
 *   net     (src/kart/net)     the room: lobby, the host's race, every guest's view of it
 *   render  (src/kart/render)  RaceView → pictures, one viewport per player on this screen
 *   app     (src/kart/app)     the screens around it all, on race.html
 *
 * Coordinates. The world is metres, y up. The race happens on the x-z plane
 * (y is the road's height, for the picture). A kart's `heading` is its
 * rotation about +y: it faces (sin h, cos h) in (x, z), which is three.js's
 * `rotation.y = heading` for a model built facing +z. Its right is
 * (-cos h, sin h). Steering right (+1) turns the heading down (clockwise
 * seen from above).
 */
import type { Surface, TrackDef } from "./track/geometry";

export type { Surface, TrackDef } from "./track/geometry";

/** The simulation's fixed step: every device steps the same 60 ticks a second. */
export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;

/** People in one room, over every device in it. */
export const MAX_PLAYERS = 4;
/** Karts on the grid, bots included. */
export const MAX_RACERS = 8;

/** The four players' colours (Apple's system colours, as DESIGN.md's palette), then the bots'. */
export const PLAYER_COLOURS = ["#FF453A", "#0A84FF", "#30D158", "#FFD60A"] as const;
export const BOT_COLOURS = ["#FF9F0A", "#BF5AF2", "#64D2FF", "#FF375F"] as const;

/** What a driver asks of their kart on one tick. */
export interface DriveInput {
  /** -1 full left .. 1 full right, already shaped (dead zone, curve) by the input. */
  steer: number;
  /** 0..1. With the wheel, 1 while the hands are fists: karts accelerate on their own. */
  throttle: number;
  /** 0..1. Held at a standstill it reverses (the sim decides when). */
  brake: number;
  /** Held to drift: true from the hop until the driver straightens up (the input decides). */
  drift: boolean;
  /**
   * How many times this driver has used an item, ever: a count, not a flag,
   * so a press is never lost or doubled when inputs are repeated or dropped
   * on the way to the host. The sim uses an item each time it goes up.
   */
  itemPresses: number;
}

export const IDLE_INPUT: DriveInput = { steer: 0, throttle: 0, brake: 0, drift: false, itemPresses: 0 };

/** The pickups in the item boxes. Original names; nothing borrowed. */
export type ItemKind =
  /** A burst of speed, now. */
  | "nitro"
  /** Three bursts, one per press. */
  | "nitro3"
  /** A puck fired straight ahead that bounces off walls and spins out what it hits. */
  | "puck"
  /** A puck that steers itself toward the kart one place ahead. */
  | "seeker"
  /** A puddle of oil dropped behind; whoever drives through it spins. */
  | "slick";

/** A racer on the grid: a player or a bot. */
export interface RacerSetup {
  /** 0..MAX_RACERS-1, the kart's id for the whole race. */
  id: number;
  name: string;
  /** "#RRGGBB" */
  colour: string;
  /** A player's slot in the lobby (0..3), or null for a bot. */
  player: number | null;
  /** A bot's skill, 0 (gentle) .. 1 (sharp). Ignored for players. */
  skill?: number;
}

export interface RaceSetup {
  track: TrackDef;
  laps: number;
  /** Seeds every random choice the sim makes (items, bots): the same setup and inputs replay the same race. */
  seed: number;
  /** In grid order: the first starts on pole. */
  racers: RacerSetup[];
}

/**
 * Something that happened in the race, for sound, effects, the HUD and the
 * results. A `bump`'s and a `wall`'s strength is 0..1 (a scrape under 3 m/s
 * makes none); a `lap` carries the lap just begun.
 */
export type RaceEvent = { id: number; tick: number } & (
  | { type: "countdown"; n: 3 | 2 | 1 | 0 }
  | { type: "pickup"; kart: number; item: ItemKind }
  | { type: "use"; kart: number; item: ItemKind }
  | { type: "hit"; kart: number; by: number | null; cause: "puck" | "seeker" | "slick" }
  | { type: "boost"; kart: number; source: "nitro" | "pad" | "drift" | "start"; level: number }
  | { type: "drift-level"; kart: number; level: 1 | 2 }
  | { type: "bump"; a: number; b: number; strength: number }
  | { type: "wall"; kart: number; strength: number }
  | { type: "lap"; kart: number; lap: number }
  | { type: "final-lap"; kart: number }
  | { type: "finish"; kart: number; place: number; time: number }
  /** Off a ramp's lip into the air. */
  | { type: "jump"; kart: number }
  /** A trick in the air (it boosts on landing). */
  | { type: "trick"; kart: number }
  | { type: "land"; kart: number; boost: boolean }
  /** Over an edge with no barrier (or into lava): the rescue drone is on its way. */
  | { type: "fall"; kart: number }
  /** Set back on the road by the rescue drone. */
  | { type: "rescued"; kart: number }
  /** Touched a track's hazard and spun. */
  | { type: "hazard"; kart: number; kind: string }
);

/** One kart as the picture needs it. */
export interface KartView {
  id: number;
  x: number;
  /** The road's height under the kart; add `hop` for the kart's. */
  y: number;
  z: number;
  heading: number;
  /** m/s along the heading (negative reversing). */
  speed: number;
  /** The steer it is answering, -1..1 (the front wheels, the driver's lean). */
  steer: number;
  /** -1 drifting left, 1 right, 0 not. */
  drift: -1 | 0 | 1;
  /** 0 none, 1 first spark colour, 2 second: what a release would give. */
  driftLevel: 0 | 1 | 2;
  /** Seconds of boost left (0 when none). */
  boost: number;
  /** Seconds left of a spin-out (0 when none). */
  spin: number;
  /** In the air (a hop, a jump), metres above the road. */
  hop: number;
  offroad: boolean;
  /** What it is driving on. */
  surface: Surface | "road";
  /** Seconds since a trick began in the air (for its animation), 0 when none. */
  trick: number;
  /**
   * Seconds left of a rescue (0 when none): it fell, the drone lifts it
   * back to the road and lets it go. The picture draws it falling for the
   * first part and carried for the rest; the kart cannot be driven meanwhile.
   */
  rescue: number;
  /** The item held, or null; `uses` left for nitro3. */
  item: ItemKind | null;
  itemUses: number;
  /** True while the item box's roulette is still turning (no item to use yet). */
  rolling: boolean;
  /** 1-based place right now. */
  place: number;
  /** 1-based lap being driven (laps + 1 once finished). */
  lap: number;
  /** 0..1 of the way round the current lap. */
  lapProgress: number;
  /** Driving the wrong way for a while. */
  wrongWay: boolean;
  /** Race time it finished in, seconds, or null. */
  finished: number | null;
}

/** Something on the track that is not a kart. */
export interface ThingView {
  id: number;
  kind: "box" | "puck" | "seeker" | "slick";
  x: number;
  y: number;
  z: number;
  heading: number;
  /** A box taken and not back yet is hidden (false). */
  active: boolean;
}

/** The race as every screen draws it, host or guest. */
export interface RaceView {
  tick: number;
  phase: "countdown" | "racing" | "finished";
  /** Seconds until the start while counting down, 3.5 → 0 (3.5..3.0 is "ready"), 0 after. */
  countdown: number;
  /** Seconds since the start (0 while counting down). */
  time: number;
  laps: number;
  track: TrackDef;
  racers: readonly RacerSetup[];
  karts: readonly KartView[];
  things: readonly ThingView[];
  /** What happened since the view before this one, oldest first: a sim's view() hands each event out once, so call it once a frame. */
  events: readonly RaceEvent[];
}

/** The final standings, for the results. */
export interface RaceResult {
  /**
   * In finishing order. A kart that did not finish (the race ended for it)
   * has time null and comes last. `name` and `colour` are the racer's own,
   * so a device that never saw the grid (a phone that was only a controller)
   * can still read the results; the room's host fills them in.
   */
  standings: { kart: number; place: number; time: number | null; bestLap: number | null; name?: string; colour?: string }[];
}

/**
 * The simulation of one race, deterministic: the same setup and the same
 * inputs, tick by tick, give the same race on every device.
 */
export interface Race {
  readonly setup: RaceSetup;
  readonly tick: number;
  /**
   * Advances one TICK. Players' karts take `inputs` (by kart id; a kart
   * with none holds IDLE_INPUT); bots drive themselves.
   */
  step(inputs: ReadonlyMap<number, DriveInput>): void;
  /**
   * Advances only these karts one TICK with these inputs, against the world
   * as it is (others, things and the clock stay put): a guest's prediction
   * of its own karts between the host's snapshots.
   */
  predict(karts: readonly number[], inputs: ReadonlyMap<number, DriveInput>): void;
  view(): RaceView;
  /** Takes the events since the last call (each event once). */
  takeEvents(): RaceEvent[];
  /** Everything needed to carry on from here: plain JSON, small. */
  snapshot(): RaceSnapshot;
  restore(snapshot: RaceSnapshot): void;
  result(): RaceResult | null;
  /** From now on this kart drives itself, as a bot does (a player who left mid-race). */
  handOver?(kart: number): void;
}

/** A race's state as plain JSON, opaque outside the sim. */
export interface RaceSnapshot {
  tick: number;
  [key: string]: unknown;
}

/** Makes a Race (sim/race.ts exports `createRace`). */
export type CreateRace = (setup: RaceSetup) => Race;

// ─── The picture ────────────────────────────────────────────────────────────

/**
 * Draws a race: one viewport per kart this screen shows (1-4, split
 * screen), each with its own chase camera and HUD (render/ exports
 * `createRaceRenderer(canvas, hudRoot, options)`).
 */
export interface RaceRenderer {
  /** Builds the track's world and the karts; reports 0..1. */
  load(track: TrackDef, racers: readonly RacerSetup[], onProgress?: (fraction: number) => void): Promise<void>;
  /** The karts to follow, one viewport each, in reading order. */
  setViews(karts: readonly number[]): void;
  /** Draws `view`; `dt` is real seconds since the last frame (for the cameras' and effects' easing). */
  frame(view: RaceView, dt: number): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

// ─── Input ──────────────────────────────────────────────────────────────────

/** How one player on this device drives. */
export interface DriverControl {
  readonly kind: "wheel" | "keyboard" | "gamepad";
  /** The input for the next tick; called TICK_HZ times a second. */
  sample(now: number): DriveInput;
  /** What the wheel sees, for the screens (null for keys and pads). */
  readonly wheel: WheelStatus | null;
  dispose(): void;
}

/** What the camera sees of one player's wheel, for drawing it and saying what is wrong. */
export interface WheelStatus {
  /** Hands seen this frame: 0, 1, 2. */
  hands: 0 | 1 | 2;
  /** Each hand, as the player sees it (mirrored: left is their left), or null when not seen. */
  left: WheelHand | null;
  right: WheelHand | null;
  /** The wheel's turn, degrees, after the level is taken away: + turns right. */
  angle: number;
  /** The steer it gives, -1..1. */
  steer: number;
  grip: "fists" | "open" | "one-open" | "none";
  /** "drive" | "brake" (both hands open) | "lost" (hands gone, easing to centre). */
  mode: "drive" | "brake" | "lost";
  /** The level has been set (hold the wheel level at the start). */
  levelled: boolean;
}

export interface WheelHand {
  /** The palm's centre in the mirrored picture, 0..1 (x right, y down). */
  x: number;
  y: number;
  /** The hand's size in the picture (wrist to middle knuckle), 0..1 of the picture's height. */
  size: number;
  open: boolean;
}

// ─── The room ───────────────────────────────────────────────────────────────

export interface LobbyPlayer {
  /** The player's slot, 0..MAX_PLAYERS-1, which is also their colour. */
  slot: number;
  name: string;
  colour: string;
  /** The device they play on. */
  device: string;
  /** The device whose screen shows them (their own, or the host's big screen). */
  screen: string;
  control: DriverControl["kind"];
  /** Their wheel is level and seen: ready to race. Stays so from one race to the next. */
  ready: boolean;
  /**
   * In a race: their hands have been out of the picture for a while (1.5 s),
   * which the host's big screen says in their viewport ("Show Both Hands").
   */
  handsLost?: boolean;
}

export interface LobbySettings {
  track: string;
  laps: number;
  /** Fill the grid with bots up to `racers`. */
  bots: boolean;
  racers: number;
  /**
   * Where the race shows: "own" on each player's own screen, "host" on the
   * host's, in split screen (every other device is then only a wheel). A
   * player who chose a screen for themself keeps it (`LocalPlayerSetup.screen`).
   */
  display: "own" | "host";
}

/**
 * The race stopped for the whole room (the host's pause, like a console's):
 * nothing moves until the host resumes, and then a 3-2-1.
 */
export interface PauseState {
  /** The device that paused. */
  by: string;
  /** While the race picks up again: seconds left, 3, 2, 1. Null while it is stopped. */
  resume: number | null;
}

export interface LobbyState {
  /** The room's join code (four letters), or null alone. */
  code: string | null;
  /** The host's device id. */
  host: string;
  players: LobbyPlayer[];
  settings: LobbySettings;
  phase: "lobby" | "racing" | "results";
  /** The last race's results, in the results phase. */
  result: RaceResult | null;
  /** Kart id → lobby slot for the race being run (bots absent). */
  karts: Record<number, number>;
  /**
   * Names the race being run (or last run): it changes when a new race starts
   * even if the room never left the racing phase (a restart), so a screen can
   * tell a fresh race from the one it already shows.
   */
  race?: number;
  /** Set while the host has stopped the race for everyone. */
  pause?: PauseState | null;
}

/** A player this device brings to the room. */
export interface LocalPlayerSetup {
  name: string;
  control: DriverControl;
  /**
   * Show this player's race here, or on the host's big screen, or ("auto")
   * wherever the host's `display` setting says: the default for a player who
   * has not chosen. The host's own players are always shown on the host.
   */
  screen: "here" | "host" | "auto";
}

/**
 * One device's part in a room: the host's (which runs the race), a guest's,
 * or solo practice (a room with no one else, which never touches the
 * network). The screens are written once against this.
 */
export interface Session {
  readonly role: "host" | "guest" | "solo";
  readonly device: string;
  lobby(): LobbyState;
  /** Called whenever the lobby changes; returns a function that stops listening. */
  onLobby(listener: (lobby: LobbyState) => void): () => void;
  /** Called when the session ends for this device (the host left, the room is full, kicked, the network failed). */
  onClosed(listener: (reason: SessionClosed) => void): () => void;
  setLocalPlayers(players: LocalPlayerSetup[]): void;
  /** This device's players' readiness (their wheels level and seen). */
  setReady(ready: boolean): void;
  /** The host's: settings and the start. Guests' calls are ignored. */
  configure(settings: Partial<LobbySettings>): void;
  /** The host's: starts the race once every player is ready (until then it does nothing). */
  start(): void;
  /** The host's: this race again from the countdown, with the same players and settings (a new seed). */
  restart(): void;
  /** Back to the lobby after the results (the host's). Players stay ready. */
  backToLobby(): void;
  /**
   * The host's (and practice's): stops the race. True when it is now stopped
   * for the whole room (practice, or a room that watches the host's screen:
   * `LobbyState.pause` is set and everyone sees "Paused"); false when a
   * pause is only a screen's own, because the others race on their own
   * screens, in which case the race goes on. A guest's call is always false.
   */
  pause(): boolean;
  /** Picks the race up again after `pause()`: a 3-2-1, then it runs. */
  resume(): void;
  /**
   * This device's players, in `setLocalPlayers` order: whose hands have been
   * out of the picture for a while. The host's big screen shows it in their
   * viewport. Call it when it changes; only a change is sent.
   */
  setHandsLost(lost: readonly boolean[]): void;
  /**
   * Every animation frame: samples this device's controls at the fixed tick,
   * runs (host, solo) or follows (guest) the race, and returns what to draw,
   * or null outside a race. The view is drawn at the frame's own time, between
   * two ticks, so a screen faster than 60 Hz moves smoothly. It is returned
   * even when `views()` is empty: a device that is only a wheel still shows
   * its player's place, lap and item from it.
   */
  frame(now: number): RaceView | null;
  /** The karts this screen shows, one viewport each, in order. */
  views(): number[];
  readonly link: { connected: boolean; rtt: number | null; players: number };
  leave(): void;
}

export type SessionClosed = "host-left" | "full" | "not-found" | "network" | "left" | "started" | "version";
