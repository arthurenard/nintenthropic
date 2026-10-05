/**
 * The seam between Grip Prix's screens and everything else.
 *
 * The screens (this folder) know nothing of PeerJS, MediaPipe, three.js or
 * the sim: they ask a `Services` for what they need and talk to it in the
 * contract's types (../contract.ts). `fakes.ts` holds stand-ins for all of it;
 * main.ts picks one `Services`, on one marked line. To wire the real parts,
 * write a `createServices()` that builds this interface from net/, input/,
 * render/ and tracking/, and swap that line.
 */
import type { DriverControl, RaceRenderer, Session, SessionClosed } from "../contract";

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

/** How far the wheel turns for full lock (Settings, Steering): Gentle 50°, Normal 40°, Quick 30°. */
export type Steering = "gentle" | "normal" | "quick";

export const STEERING_DEGREES: Readonly<Record<Steering, number>> = { gentle: 50, normal: 40, quick: 30 };

export interface WheelOptions {
  /**
   * Two players on one camera: the picture is split down the middle, and
   * this wheel is the left half's or the right half's. Absent: the whole picture.
   */
  half?: "left" | "right";
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

/** A picture of a wheel (the camera, mirrored, with the wheel drawn on it) that can be taken down. */
export interface Disposable {
  dispose(): void;
}

// --- the camera -------------------------------------------------------------------------------------------

/** Why the camera would not start, by what the player can do about it (as the arcade's). */
export type CameraTrouble = "denied" | "busy" | "missing" | "insecure";

export class CameraFailure extends Error {
  constructor(readonly trouble: CameraTrouble) {
    super(`camera ${trouble}`);
    this.name = "CameraFailure";
  }
}

export interface CameraService {
  /**
   * Whether the browser will let the page use the camera without asking:
   * "granted", "denied", or "prompt" (it will ask, so the screens say why
   * first). Where the browser will not say, "prompt".
   */
  permission(): Promise<"granted" | "denied" | "prompt">;
  /**
   * Starts the camera and the hand tracker for this many hands: 2 for one
   * wheel, 4 for two players on one camera. Resolves when pictures are
   * coming; rejects with a CameraFailure. Calling it again changes the
   * number of hands without opening the camera twice.
   */
  start(hands: 2 | 4): Promise<void>;
  /** Lets the camera go. */
  stop(): void;
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
  /** The tracks the host may choose from, in order. */
  tracks: readonly { id: string; name: string }[];
}
