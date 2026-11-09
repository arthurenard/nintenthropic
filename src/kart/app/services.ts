/**
 * The seam between Grip Prix's screens and everything else.
 *
 * The screens (this folder) know nothing of PeerJS, MediaPipe, three.js or
 * the sim: they ask a `Services` for what they need and talk to it in the
 * contract's types (../contract.ts). services.real.ts builds this interface
 * from net/, input/, render/ and the hand tracker, and main.ts hands it to
 * the screens.
 */
import type { KartSound, MusicKind } from "../audio";
import type { DriverControl, RaceRenderer, RaceView, Session, SessionClosed, TrackDef } from "../contract";
import type { Steering } from "../input";
import type { PodiumRenderer } from "../render/podium";
import type { HandSource } from "../../tracking/types";
import type { TrackerCounts } from "./handsFirst";

// --- the room --------------------------------------------------------------------------------------------

/** What the screens tell the session maker about the page they run on. */
export interface SessionOptions {
  /**
   * `?net=local` in the address: talk over BroadcastChannel (several tabs of
   * one browser) instead of the internet. Development and the end-to-end
   * tests; the real net layer reads it.
   */
  net?: "local";
}

/**
 * A room that could not be joined or opened, with the reason the screens turn
 * into words. `join` and `host` reject with it; a room that goes bad later
 * says the same through `Session.onClosed`.
 */
export class SessionFailure extends Error {
  constructor(readonly reason: SessionClosed) {
    super(`session closed: ${reason}`);
    this.name = "SessionFailure";
  }
}

// --- the wheel --------------------------------------------------------------------------------------------

/**
 * How far the wheel turns for full lock (the You screen's Steering): Gentle 50°, Normal 40°, Quick 30°. The wheel's
 * own type (input/wheel.ts, with its STEERING_LOCK), so the screens and the reader cannot disagree.
 */
export type { Steering };

export interface WheelOptions {
  /**
   * Two to four players on one camera: the picture is split into `of` equal
   * columns and this wheel is column `index` (0 is the leftmost as the
   * player sees themself). Absent: the whole picture.
   */
  seat?: { index: number; of: number };
  steering: Steering;
}

/** The wheel's level: where "straight" is, set by holding the wheel level for a second. */
export interface WheelLevel {
  /**
   * 0..1: how long the wheel has been held level, of the second it takes.
   * Goes back to 0 when the hands move or are lost. The wheel check draws it
   * as a ring.
   */
  progress(): number;
  /** Takes the wheel as it is now as level. The check calls it when `progress()` reaches 1. */
  set(): void;
  /** Forgets the level (the check starts by doing so). */
  reset(): void;
}

/** A wheel: a DriverControl whose hands are seen, with the level to set. */
export interface WheelControl extends DriverControl {
  readonly kind: "wheel";
  readonly wheel: NonNullable<DriverControl["wheel"]>;
  readonly level: WheelLevel;
}

/** One player's column in a shared picture. */
export interface ColumnSeat {
  control: DriverControl;
  name: string;
  /** The player's colour, #rrggbb. */
  colour: string;
}

/** What the count screen's picture shows (Services.previewCount). */
export interface CountPicture {
  /** The players counted so far, left to right as they see themselves: one column each once there are two or more. */
  seats: readonly { name: string; colour: string }[];
  /** Every hand in the picture: its palm, in the camera's own (unmirrored) picture, 0..1. */
  hands: readonly { x: number; y: number }[];
}

/** A still taken from the camera for a finish-line photo: a small picture in memory until it is made a JPEG, or let go. */
export interface Still {
  /** The JPEG, as a data URL of at most MAX_PHOTO_CHARS (contract.ts), or null if it cannot be made. */
  encode(): Promise<string | null>;
}

/** A picture of a wheel (the camera, mirrored, with the wheel drawn on it) that can be taken down. */
export interface Disposable {
  dispose(): void;
}

// --- the camera -------------------------------------------------------------------------------------------

/**
 * Why the camera would not start, by what the player can do about it (as the
 * arcade's), and "model": the camera is fine but the hand tracker would not
 * download.
 */
export type CameraTrouble = "denied" | "busy" | "missing" | "insecure" | "model";

export class CameraFailure extends Error {
  constructor(readonly trouble: CameraTrouble) {
    super(`camera ${trouble}`);
    this.name = "CameraFailure";
  }
}

/**
 * What the camera is started for: 2 hands for one wheel, 4, 6 or 8 for two to four players sharing it, or "count": the
 * whole picture read for up to eight hands, to count the players in it (count.ts), in one worker, read a part at a time.
 */
export type CameraHands = 2 | 4 | 6 | 8 | "count";

export interface CameraService {
  /**
   * Whether the browser will let the page use the camera without asking:
   * "granted", "denied", or "prompt" (it will ask, so the screens say why
   * first). Where the browser will not say, "prompt".
   */
  permission(): Promise<"granted" | "denied" | "prompt">;
  /**
   * Starts the camera and the hand tracker for this many hands: 2 for one
   * wheel, 4, 6 or 8 for two, three or four players on one camera (three or
   * four ask the camera for a bigger picture and the tracker for a little
   * less certainty, since each hand is small). Resolves when pictures are
   * coming; rejects with a CameraFailure. Calling it again changes the
   * number of hands without opening the camera twice. `progress` hears the
   * download of the tracker, 0..1 (the first visit fetches about 20 MB).
   */
  start(hands: CameraHands, progress?: (fraction: number) => void): Promise<void>;
  /** Lets the camera go. */
  stop(): void;
  /** Every hand the tracker finds, on every frame (the count screen's; the wheels read theirs through their controls). */
  readonly hands: HandSource;
  /**
   * The tracker's running counts while it reads: frames read, and frames dropped because a worker was still busy (for
   * the race to make room for it, handsFirst.ts). Null with no tracker; absent where there is no real one.
   */
  counts?(): TrackerCounts | null;
}

// --- sound ---------------------------------------------------------------------------------------------------

/** The two sliders, each 0..1 as a slider sits (half way is a quarter of the power). */
export interface SoundLevels {
  music: number;
  effects: number;
}

/** One race's sound: the engines, the events, the music of the track. */
export interface RaceSound {
  /**
   * Gets the kart sounds and the track's music ready. Never rejects (a race
   * without sound is still a race), and the race does not wait for it: the
   * music starts when it is made.
   */
  load(theme: TrackDef["theme"], progress?: (fraction: number) => void): Promise<void>;
  /** Every frame of a race, after the picture: the view drawn and the karts this screen shows (`Session.views()`). */
  frame(view: RaceView, views: readonly number[], dt: number): void;
  /** The race is stopped (the pause sheet, the host's pause): engines fall silent, the music is muffled. */
  pause(): void;
  resume(): void;
  /** This screen's race is over. */
  dispose(): void;
}

/** What a test can see of the sound (it cannot hear it). */
export interface SoundReport {
  awake: boolean;
  muted: boolean;
  /** The music playing on the menus, or in the race. */
  music: string | null;
  engines: number;
  paused: boolean;
}

/**
 * Grip Prix's sound for the screens. The site has one sound preference, on or
 * off, which every game shares, and a master volume in the arcade's Settings;
 * Grip Prix adds its own Music and Effects sliders. Browsers start audio only
 * after a gesture, so nothing is made until `wake` (the page's first click or
 * key press), and with sound off nothing is made at all.
 */
export interface SoundService {
  readonly muted: boolean;
  setMuted(muted: boolean): void;
  levels(): SoundLevels;
  setLevels(levels: Partial<SoundLevels>): void;
  wake(): void;
  /** The music of a menu screen (null for none). */
  music(kind: MusicKind | null): void;
  /** An interface sound. */
  play(sound: KartSound): void;
  /** The sound of a race, for one race screen. */
  race(): RaceSound;
  report(): SoundReport;
}

// --- everything -------------------------------------------------------------------------------------------

export interface Services {
  /** Opens a room of our own. Resolves with its code in `lobby().code`. */
  host(options: SessionOptions): Promise<Session>;
  /** Joins the room with this code. Rejects with a SessionFailure ("not-found", "full", "network"...). */
  join(code: string, options: SessionOptions): Promise<Session>;
  /** Practice: a room with no one else, which never touches the network. */
  solo(options: SessionOptions): Promise<Session>;
  /** The renderer for a race: a fresh canvas each race, and the root its HUD is built in. */
  renderer(canvas: HTMLCanvasElement, hudRoot: HTMLElement): RaceRenderer;
  controls: {
    wheel(options: WheelOptions): WheelControl;
    keyboard(): DriverControl;
    gamepad(): DriverControl;
  };
  camera: CameraService;
  /**
   * Draws a control's wheel into `container` (which the page sizes: 4:3):
   * the mirrored camera picture with the wheel on it. "corner" is the small
   * picture during a race, "large" the one on the wheel check and on a
   * big-screen player's own device.
   */
  preview(container: HTMLElement, control: DriverControl, size: "corner" | "large"): Disposable;
  /**
   * One picture for several players on one camera: the whole mirrored
   * picture with the columns marked, each player's colour and name over their
   * column and their wheel drawn in it. Used for three or four players,
   * whose own columns would be narrow slivers.
   */
  previewColumns(container: HTMLElement, seats: readonly ColumnSeat[], size: "corner" | "large"): Disposable;
  /**
   * The count screen's picture: the whole mirrored camera, split into the columns the players counted so far would
   * each drive in (none for one), each column's player named over it, and every hand the tracker sees as a dot in its
   * column's colour. `read` says, every frame, who is counted and where the hands are (camera's own picture, 0..1).
   */
  previewCount(container: HTMLElement, read: () => CountPicture): Disposable;
  /**
   * A still for a wheel player's finish-line photo: the camera's picture as it is at the call, mirrored as they see
   * themself, their own column of it when they share the camera, small; made a JPEG only if it is the one kept (`Still`).
   * Null for keys and pads, and with no picture. Nothing is kept here. Optional: without it nobody has a photo.
   */
  photo?(control: DriverControl): Still | null;
  /**
   * The podium's picture, on a canvas of its own: the ceremony after a Grand Prix. May throw WebGLUnavailable.
   * Optional: without it (or where it throws) the podium is the final standings alone.
   */
  podium?(canvas: HTMLCanvasElement): PodiumRenderer;
  /** The tracks the host may choose from, in order. */
  tracks: readonly { id: string; name: string }[];
  sound: SoundService;
}
