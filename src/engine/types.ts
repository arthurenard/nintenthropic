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
}

export interface LoadedAsset {
  scene: import("three").Group;
  animations: import("three").AnimationClip[];
}

export interface AssetLoader {
  gltf(url: string, onProgress?: (fraction: number) => void): Promise<LoadedAsset>;
  texture(url: string): Promise<import("three").Texture>;
}

export interface Settings {
  /** Round length for timed games; High Noon ignores it (it runs until you fall). */
  duration: number;
  reducedMotion: boolean;
  /** Konami code and friends. */
  unlocks: Set<string>;
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
  /** Advance the world. `dt` in seconds (clamped by the host), `now` in ms. */
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
  /** A poster image under public/. */
  poster: string;
  create(): Promise<Game>;
}
