/**
 * The contract between the app, the input, the audio and the games.
 *
 * Every part of Handy on the web is built against these types; see
 * docs/WEB_ARCHITECTURE.md for what each one means in play. Change them only
 * deliberately, and update every implementation in the same change.
 */
import type { WebGLRenderer } from "three";

/** Where the player is aiming, and what their trigger is doing, right now. */
export interface Aim {
  /** Viewport fractions: (0, 0) is the top-left corner, (1, 1) the bottom-right. */
  x: number;
  y: number;
  /** A hand (or pointer) is being followed; false while it is lost. */
  tracking: boolean;
  /** The gun is cocked: the next fold (or click) will fire. */
  armed: boolean;
  /** True on exactly one update per shot. */
  fired: boolean;
  /** How far the thumb has folded, 0 (cocked) to 1 (fully folded). Mouse: 0 or 1. */
  travel: number;
  /** The crosshair is outside the view (the reload gesture in High Noon). */
  offscreen: boolean;
  /**
   * The player asks to look through a scope: one eye closed (with the hand,
   * in a game that reads the eye), Shift or the right mouse button, or the
   * touch screen's Scope button - held, or toggled, as Settings says. Always
   * false in a game whose entry does not use a scope (GameEntry.uses).
   */
  scope: boolean;
  /** When the camera frame (or pointer event) this aim comes from was captured, ms. */
  capturedAt: number;
}

export type InputKind = "hand" | "mouse" | "touch";

export interface InputSource {
  readonly kind: InputKind;
  /** The latest aim; cheap to call every animation frame. */
  sample(now: number): Aim;
  dispose(): void;
}

/** One small labelled value beside the score, as on the desktop. */
export interface Readout {
  label: string;
  value: string;
  /** 0..1, or -1..1 when signed. */
  meter?: number;
  signed?: boolean;
  /** Where to notch the meter, 0..1. */
  notches?: number[];
  tone?: "" | "warning" | "danger";
  /**
   * Several small parts in place of one meter, each 0..1 with a tone of its
   * own (Orbital Decay's seven panes). A part at 0 is drawn as an outline.
   * Optional: a readout shows a meter or segments, not both.
   */
  segments?: { value: number; tone?: "" | "warning" | "danger" }[];
  /**
   * How the segments sit: side by side ("row", the default), or the first
   * in the middle and the rest round it, clockwise from just left of the
   * top ("ring": a cupola's windows in miniature).
   */
  segmentLayout?: "row" | "ring";
}

export interface GameStats {
  /** One or two words: "Survived", "Fell on Wave 4". */
  outcome: string;
  won: boolean;
  score: number;
  /** Three or four headline numbers for the results card. */
  stats: { label: string; value: string }[];
  /**
   * One short sentence under the outcome, optional: what felled the player,
   * or the one thing that would help most next time ("A rifleman on the bank
   * roof. Riflemen glint for longer - watch the rooftops.").
   */
  note?: string;
  secretsFound: number;
  secretsTotal: number;
}

/** How a game talks to the page's HTML interface. */
/** How a rifle's rounds are shown (HudSink.ammo): the magazine, and the one in the chamber. */
export interface AmmoStyle {
  /** A revolver's cylinder (the default) or a rifle's magazine. */
  kind: "cylinder" | "magazine";
  /**
   * Magazine: a round is in the chamber, ready to fire (it is one of `left`).
   * Unset: one is whenever any round is left and the action is ready.
   */
  chambered?: boolean;
  /**
   * Magazine: the action - "ready" (closed on a round), "cycling" (the bolt
   * or lever being worked after a shot: it cannot fire), or "open" (the bolt
   * back on an empty chamber). "ready" if unset.
   */
  action?: "ready" | "cycling" | "open";
}

/**
 * One of the spotter's marks (HudSink.spotter): a small caret floating above a
 * man, never over him, the same size on screen at any range.
 */
export interface SpotterMark {
  /** Stable while the mark stands, so it moves rather than flickers. */
  id: number;
  /** The man's head, in viewport fractions; the caret floats above this point. */
  x: number;
  y: number;
  /** Extra pixels to float higher (to clear a man or a mark above), 0 if absent. */
  lift?: number;
  /** Pixels to the side of him (carets of men standing close spread into a row), 0 if absent. */
  shift?: number;
  /** How visible, 0 to 1 (it fades as the crosshair comes onto him), 1 if absent. */
  opacity?: number;
  /** His distance, "289 m": said once, on the nearest man only. */
  label?: string;
  /** Extra pixels the label floats above its caret, to clear the marks round it, 0 if absent. */
  labelLift?: number;
  /** "last": the last man, not found yet, breathes gently. "shot": he just fired at the player, and the mark pings. */
  pulse?: "last" | "shot";
}

/** The arrow on a scope's rim (HudSink.spotter): where it sits (viewport fractions) and which way it points (radians clockwise from the top). */
export interface RimArrow {
  x: number;
  y: number;
  angle: number;
}

export interface HudSink {
  score(value: number): void;
  readouts(list: Readout[]): void;
  /** A title card: "Wave 3", with an optional line under it. */
  banner(title: string, subtitle?: string): void;
  /**
   * Rounds left and how many the gun holds, in the weapon's corner: a
   * revolver's cylinder (the default), or a rifle's magazine (`style`).
   * `reloading` spins the cylinder, or empties the magazine to refill it.
   */
  ammo(left: number, capacity: number, reloading: boolean, style?: AmmoStyle): void;
  /**
   * A gun that heats rather than empties (Orbital Decay's laser), in the
   * weapon's corner instead of rounds: `level` 0 (cold) to 1 (too hot to
   * fire), warning as it nears the top; `venting` while it is overheated and
   * cannot fire, cooling. Optional.
   */
  heat?(level: number, venting: boolean): void;
  /**
   * The weapon's finish in the corner: gold for the golden weapon every
   * game gives a player who has unlocked it (Settings.unlocks has "golden":
   * High Noon's Golden Revolver). Optional; the page also reads the unlock
   * when a round begins.
   */
  weaponFinish?(finish: "steel" | "gold"): void;
  /**
   * The page's crosshair: "none" while the game draws its own reticle (a
   * scope's picture), "default" to bring it back. Every round begins with
   * the default. Optional.
   */
  crosshair?(style: "default" | "none"): void;
  /**
   * A timed round's clock, top centre (0:48), or null to take it away.
   * `tone` "warning" for the last seconds. Optional; a game without a clock
   * never calls it.
   */
  clock?(seconds: number | null, tone?: "" | "warning"): void;
  /**
   * The player has fallen: the gun is gone, so the page hides the crosshair
   * until the results. Optional; a game without a death never calls it.
   */
  playerDown?(): void;
  /** Damage taken: the direction it came from in radians (0 = straight ahead, + = right), and how hurt the player now is, 0..1. */
  damage(direction: number, hurt: number): void;
  /** How hurt the player is as it recovers, 0..1 (drives the screen's red edge). */
  health(hurt: number): void;
  /**
   * Calm marks over the men to find (Overwatch Ridge's spotter): a small
   * caret above each, while the view is wide, and `rim`, an arrow on the
   * scope's rim pointing to the nearest man when none is in the glass.
   * Called as often as they move; null (or an empty list, and no rim) takes
   * them all away. Optional; a game without a spotter never calls it.
   */
  spotter?(marks: SpotterMark[] | null, rim?: RimArrow | null): void;
  /**
   * A shot at the player, from where `direction` points in the view (radians
   * clockwise from the top): the damage arc's look, drawn on the view's edge,
   * softer unless the shot `hit`. For a game whose shooters are in sight
   * across a wide view, where `damage`'s bearing alone would always say
   * "ahead". A hit also calls `health`. Optional.
   */
  incoming?(direction: number, hit?: boolean): void;
  /** A hit marker at a viewport position. */
  hitMarker(x: number, y: number, kind: "hit" | "headshot" | "kill"): void;
  /** A short floating line: "+150 Quick Draw". */
  popup(x: number, y: number, text: string, tone?: "" | "gold" | "danger"): void;
  /** A secret was found. */
  secret(name: string, found: number, total: number): void;
  /** One-line hint, shown until replaced or cleared. */
  hint(text: string | null): void;
  gameOver(stats: GameStats): void;
}

export interface CueOptions {
  volume?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Playback rate; 1 is natural. */
  rate?: number;
  /** Seconds from now. */
  delay?: number;
  /** Metres from the listener, for distance attenuation and echo. */
  distance?: number;
}

export interface AudioBus {
  play(cue: string, options?: CueOptions): void;
  /** Start a loop; returns a function that stops it (with a short fade). */
  loop(cue: string, options?: CueOptions): () => void;
  /** Named global treatments, 0..1: "hurt" muffles and adds a heartbeat. */
  setFilter(name: "hurt" | "slowmo", amount: number): void;
  readonly muted: boolean;
  /**
   * The street the listener stands in, in metres (to the facades left and
   * right, the building behind, the far end), for the echoes. Optional: a
   * game passes what it knows; the sound engine keeps its defaults for the rest.
   */
  setSpace?(space: { left?: number; right?: number; behind?: number; depth?: number; facade?: number; back?: number; far?: number }): void;
}

export interface LoadedAsset {
  scene: import("three").Group;
  animations: import("three").AnimationClip[];
}

export interface AssetLoader {
  gltf(url: string, onProgress?: (fraction: number) => void): Promise<LoadedAsset>;
  texture(url: string): Promise<import("three").Texture>;
}

/**
 * How hard a game plays. Relaxed is for a first evening, a younger player or a
 * tired arm: slower, gentler opponents. Records are kept apart for each.
 */
export type Difficulty = "relaxed" | "standard";

export interface Settings {
  /** Round length for timed games; High Noon ignores it (it runs until you fall). */
  duration: number;
  /** The player's choice, or the system's reduced-motion setting until they make one. */
  reducedMotion: boolean;
  /**
   * Flashes toned right down, for players sensitive to them: muzzle flashes,
   * the screen's flash on a shot, explosions. Nothing in play should still
   * change the whole picture's brightness sharply.
   */
  reducedFlashing: boolean;
  /** Read by a game at start(): a change takes effect from the next round. */
  difficulty: Difficulty;
  /**
   * Aim Assist, as the player has it in Settings (on unless they turn it
   * off): targets easier to hit, and to find. A game reads it live, on every
   * shot and every frame, never once at start(): it can change mid-round. On,
   * a shot that passes just beside a target still counts (engine/rules/
   * assist.ts says how much); off, it is exact. Innocents are never helped.
   * Overwatch Ridge is precision by design: its shots are always exact, and it
   * reads the switch only to help find the men (a mark over each hostile, an
   * arrow on the scope's rim).
   */
  aimAssist: boolean;
  /**
   * Konami code and friends, for the visit. "golden": a golden weapon in
   * every game (High Noon's Golden Revolver; HudSink.weaponFinish).
   */
  unlocks: Set<string>;
  /**
   * The one-time tips this player has already been shown, by id. A game
   * shows a tip the first time its moment comes (the first townsperson, the
   * first glint) and adds the id here; the page keeps the set between visits,
   * so a tip is never shown twice.
   */
  tipsSeen: Set<string>;
  /**
   * How the player scopes, for a game with a scope to say it in their terms
   * ("Close one eye to look through the scope." / "Hold Shift to scope."):
   * whether closing an eye scopes (with the hand, in a game that reads the
   * eye), and whether the buttons are held or toggled.
   */
  scope: {
    eye: boolean;
    button: "hold" | "toggle";
    /** The player has a touch screen, so the Scope button is there for them (with the hand too). */
    touch?: boolean;
  };
}

export interface Quality {
  /** 0.6..1 of the device pixel ratio, set by the host's dynamic resolution. */
  scale: number;
  /** "high" on capable GPUs; games may drop effects on "low". */
  tier: "low" | "medium" | "high";
}

export interface GameContext {
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  audio: AudioBus;
  hud: HudSink;
  assets: AssetLoader;
  settings: Settings;
  quality: Quality;
  /** A seeded random source in [0, 1). */
  random: () => number;
  /** The player's local time, for time-of-day secrets. */
  clock: () => Date;
  /** How the player aims, so hints can say it in their terms ("Point off the screen to reload" / "Right-click or press R to reload"). Optional; absent means the hand. */
  input?: InputKind;
}

/** A target in the aim check, in viewport fractions. */
export interface CalibrationTarget {
  id: string;
  x: number;
  y: number;
  /** Radius of the target's centre zone, as a fraction of the smaller viewport side. */
  radius: number;
}

/** What a game's aim-check targets are called, for the words around them ("Point at the Lit Bottle"). */
export interface TargetNoun {
  one: string;
  many: string;
}

/** The game's own aim-check targets: bottles on the fence in High Noon. */
export interface CalibrationStage {
  /**
   * What its targets are (bottles, jars, lights, plates): the aim check's
   * words use it, so every game's check says its own thing. "Target" when
   * a stage does not say.
   */
  noun?: TargetNoun;
  /**
   * An aim check is starting: stand every target up (again, for Play Again
   * on the same game). Optional; the platform calls it, when present, before
   * it first asks for targets().
   */
  begin?(): void;
  /** Where the targets are in the current view. */
  targets(): CalibrationTarget[];
  /** Show one target as the one to shoot now. */
  light(id: string | null): void;
  /**
   * A shot was taken at `id`: take the target (break it, ring it). The hand's
   * aim check calls this for every shot that counts - the shot is where the
   * finger pointed, and the crosshair is not shown while the aim is being
   * learned, so there is no landing place to judge it by.
   */
  hit(id: string): void;
  /** A pointer's shot landed at (x, y) and missed `id` (the dev harness's mouse check; the hand's never calls it). */
  miss(id: string, x: number, y: number): void;
  /** The check is over: clear the stage for play. */
  done(): void;
}

export interface Game {
  readonly id: string;
  readonly title: string;
  readonly calibration: CalibrationStage;
  load(ctx: GameContext, onProgress: (fraction: number) => void): Promise<void>;
  /** Begin play (after the aim check). */
  start(): void;
  /**
   * Advance the world. `dt` in seconds (clamped by the host), `now` in ms.
   * Called every animation frame from the end of load() on, so the world is
   * alive behind the aim check. Until start() the shots belong to the check:
   * the platform judges them (and tells the stage hit or miss), and a game
   * may answer `aim.fired` only with the gun's sound and smoke, never score.
   */
  update(dt: number, now: number, aim: Aim): void;
  render(): void;
  resize(width: number, height: number, pixelRatio: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/**
 * A game's light as a picture - a sky graded from top to bottom, and a glow
 * (the sun low at golden hour, a lamp in the fog, a planet's limb) - which the
 * page shows wherever the game's poster would be until the poster loads, or
 * for good while there is none. Colours are CSS colours.
 */
export interface Backdrop {
  /** Colour stops down the picture: [colour, 0 (top) .. 1 (bottom)]. */
  sky: readonly (readonly [string, number])[];
  /**
   * An elliptical glow: its centre (fractions of the picture, may lie
   * outside it), its radii (fractions of the picture's width and height),
   * and its colour stops from the centre out: [colour, 0..1 of the radius].
   */
  glow?: { x: number; y: number; width: number; height: number; stops: readonly (readonly [string, number])[] };
}

/** What a game asks of the platform beyond the hand's aim and fold (or the pointer's). */
export interface GameUses {
  /**
   * The player may look through a scope: Aim.scope follows Shift or the
   * right mouse button (which then scopes rather than reloads), or an
   * on-screen Scope button on a touch screen, held or toggled as Settings says.
   */
  scope?: boolean;
  /**
   * With the hand, closing one eye scopes too: the face landmarker loads
   * and runs on the same camera frames, for this game only. Needs `scope`.
   */
  eye?: boolean;
}

/** The stage's shape a game's art can hold. */
export interface StageShape {
  /**
   * The stage is never taller than 1 : minAspect: in a taller window (a
   * phone held upright) the world plays in a band across the middle. A
   * world drawn from one fixed eye (High Noon's baked town) streaks below
   * the frame its art was made for past its own figure. 1.1 if unset.
   */
  minAspect?: number;
  /**
   * The stage is never wider than maxAspect : 1: in a wider window it
   * plays in a column with black at the sides. Unlimited if unset.
   */
  maxAspect?: number;
}

export interface GameEntry {
  id: string;
  title: string;
  blurb: string;
  /** Two or three sentences for the arcade's hero. Optional; the blurb stands in. */
  about?: string;
  /** A poster image under public/ (16:9); until it exists, the backdrop stands in. */
  poster: string;
  /** The game's light, shown where the poster would be until it loads. Optional; a neutral dusk stands in. */
  backdrop?: Backdrop;
  /** What the game asks of the platform (a scope, the eye). */
  uses?: GameUses;
  /** The stage's shape its art can hold. */
  stage?: StageShape;
  /**
   * Which heading the arcade lists the game under: the four finger-pistol
   * games are "shooting" (the default), Grip Prix is "racing".
   */
  category?: "shooting" | "racing";
  /**
   * A game with a page of its own (race.html): its Play opens that page
   * instead of starting the game here, so it has no `create`.
   */
  page?: string;
  /** Makes the game. Absent while it is Coming Soon: the arcade shows it, and it cannot be played. */
  create?(): Promise<Game>;
}
