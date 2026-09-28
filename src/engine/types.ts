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
export interface HudSink {
  score(value: number): void;
  readouts(list: Readout[]): void;
  /** A title card: "Wave 3", with an optional line under it. */
  banner(title: string, subtitle?: string): void;
  /** Rounds left and the cylinder's size, for the revolver HUD. */
  ammo(left: number, capacity: number, reloading: boolean): void;
  /** The cylinder's finish: gold for the Golden Revolver. Optional; the page also reads Settings.unlocks. */
  revolverFinish?(finish: "steel" | "gold"): void;
  /**
   * The player has fallen: the gun is gone, so the page hides the crosshair
   * until the results. Optional; a game without a death never calls it.
   */
  playerDown?(): void;
  /** Damage taken: the direction it came from in radians (0 = straight ahead, + = right), and how hurt the player now is, 0..1. */
  damage(direction: number, hurt: number): void;
  /** How hurt the player is as it recovers, 0..1 (drives the screen's red edge). */
  health(hurt: number): void;
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
  /** Konami code and friends. */
  unlocks: Set<string>;
  /**
   * The one-time tips this player has already been shown, by id. A game
   * shows a tip the first time its moment comes (the first townsperson, the
   * first glint) and adds the id here; the page keeps the set between visits,
   * so a tip is never shown twice.
   */
  tipsSeen: Set<string>;
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

/** The game's own aim-check targets: bottles on the fence in High Noon. */
export interface CalibrationStage {
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
  /** A shot at `id` landed well (break it) or missed (a puff of dust beside it). */
  hit(id: string): void;
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

export interface GameEntry {
  id: string;
  title: string;
  blurb: string;
  /** Two or three sentences for the featured game on the landing. Optional; the blurb stands in. */
  about?: string;
  /** A poster image under public/. */
  poster: string;
  create(): Promise<Game>;
}
