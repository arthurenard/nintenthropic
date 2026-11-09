/**
 * Hooks for the end-to-end tests, in dev and test builds only: main.ts
 * imports this module behind a check on the build mode, so a production
 * build contains none of it.
 *
 *   ?input=script     the wheel reads a scripted pair of hands instead of the
 *                     camera; the tests move them with `gripTest.wheel(...)`
 *   ?camera=ask       the scripted camera says the browser will ask first, so
 *                     the page explains why before it does
 *   ?camera=real      the scripted hands drive, but the camera is really opened
 *                     (Chrome's fake one in the tests): the wheel's picture and
 *                     the finish-line photos are of what it shows
 *   ?fail=<trouble>   camera-denied (or just camera), camera-busy,
 *                     camera-missing, camera-insecure, model, webgl: to see
 *                     each sheet
 */
import { openCamera, type Camera } from "../../tracking/camera";
import { cameraSize } from "../../tracking/hands";
import type { HandFrame, HandSource } from "../../tracking/types";
import { handFrame, wheelHands, type SynthHand, type WheelPose } from "../input/testHands";
import type { LobbyState } from "../contract";
import type { Rivalries } from "../rivals";
import type { KartApp, KartAppSnapshot } from "./app";
import { LoadingScreen, raceWords } from "./loading";
import type { StandIn } from "./services.real";
import { CameraFailure, type CameraHands, type CameraService, type CameraTrouble } from "./services";

/** Hands that follow a script: fists on a wheel held level, until a test says otherwise. */
export class ScriptedWheel implements HandSource {
  /** What the camera sees now: each wheel's two hands (none: an empty picture). */
  hands: SynthHand[] = wheelHands({ angle: 0 });
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private newest: HandFrame | null = null;
  private timer = 0;

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): HandFrame | null {
    return this.newest;
  }

  start(fps = 30): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.publish(), 1000 / fps);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  get running(): boolean {
    return this.timer !== 0;
  }

  private publish(): void {
    const frame = handFrame(this.hands, performance.now());
    this.newest = frame;
    for (const listener of [...this.listeners]) listener(frame);
  }
}

/** A camera that is the script: always allowed, instantly up, or failing as asked; with `video`, a real camera's picture behind it. */
export class ScriptedCamera implements CameraService {
  private camera: Camera | null = null;

  constructor(
    readonly wheel: ScriptedWheel,
    private readonly fail: CameraTrouble | null,
    private readonly ask = false,
    /** The video a real camera plays into (`?camera=real`), or null for none. */
    readonly video: HTMLVideoElement | null = null,
  ) {}

  async permission(): Promise<"granted" | "denied" | "prompt"> {
    return this.fail === "denied" ? "denied" : this.ask ? "prompt" : "granted";
  }

  /** The count screen's hands: the script's. */
  get hands(): HandSource {
    return this.wheel;
  }

  async start(hands: CameraHands, progress?: (fraction: number) => void): Promise<void> {
    if (this.fail) throw new CameraFailure(this.fail);
    if (this.video && !this.camera) this.camera = await openCamera(this.video, { size: cameraSize(hands === "count" ? 8 : hands) });
    progress?.(1);
    this.wheel.start();
  }

  stop(): void {
    this.wheel.stop();
    this.camera?.stop();
    this.camera = null;
  }
}

/** What `?fail=` names, as a camera trouble (null: not a camera trouble). */
export function cameraTroubleOf(fail: string | null): CameraTrouble | null {
  switch (fail) {
    case "camera":
    case "camera-denied":
      return "denied";
    case "camera-busy":
      return "busy";
    case "camera-missing":
      return "missing";
    case "camera-insecure":
      return "insecure";
    case "model":
      return "model";
    default:
      return null;
  }
}

/**
 * The scripted hands and camera the query asks for, or null for the real
 * ones: `?input=script` (and a `gripTest` on the window to move the hands),
 * or a `?fail=` that names a camera trouble.
 */
export function standIn(params: URLSearchParams): StandIn | null {
  const trouble = cameraTroubleOf(params.get("fail"));
  const scripted = params.get("input") === "script";
  if (!scripted && !trouble) return null;
  const wheel = new ScriptedWheel();
  if (scripted) installGripTest(wheel);
  const video = scripted && params.get("camera") === "real" ? hiddenVideo() : null;
  return { source: wheel, camera: new ScriptedCamera(wheel, trouble, params.get("camera") === "ask", video), video: () => video };
}

/** A video for a real camera's picture, in the page and out of sight (as the real camera's is: camera.ts). */
function hiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0.01", pointerEvents: "none" });
  document.body.append(video);
  return video;
}

export interface GripTest {
  /** Both hands of one wheel, or of several (two to four players on one camera), or none (null: hands out of the picture). */
  wheel(pose: WheelPose | readonly WheelPose[] | null): void;
  /** The script is publishing pictures. No spec reads it: it is for checking by hand, from the browser's console. */
  readonly running: boolean;
  /** What the page shows and how the race stands. */
  state(): KartAppSnapshot | null;
  /**
   * Puts up a screen that comes after a race, with this room (to look at it: no race is run), and the results with these
   * finish-line photos (by kart). No spec calls it: it is for looking at those screens by hand, from the browser's console.
   */
  preview(screen: "results" | "standings" | "podium", lobby: LobbyState, photos?: Readonly<Record<number, string>>): void;
  /** The room's rivalries (rivals.ts), to feed it hits in a scripted race; null in Practice alone. */
  rivals(): Rivalries | null;
  /** Puts up the loading screen of the race this room would run, at this far (to look at it). */
  loading(lobby: LobbyState, fraction: number): void;
}

let app: KartApp | null = null;

/** Lets a test ask the page how the race stands (the keyboard drivers steer by it). */
export function installState(shown: KartApp): void {
  app = shown;
  window.gripTest ??= makeTest(null);
}

function makeTest(wheel: ScriptedWheel | null): GripTest {
  return {
    wheel(pose) {
      if (!wheel) throw new Error("the wheel is scripted only with ?input=script");
      const poses = pose === null ? [] : Array.isArray(pose) ? pose : [pose as WheelPose];
      wheel.hands = poses.flatMap((one) => wheelHands(one));
    },
    get running() {
      return wheel?.running ?? false;
    },
    state: () => app?.snapshot() ?? null,
    preview: (screen, lobby, photos) => app?.preview(screen, lobby, photos),
    rivals: () => app?.rivalries() ?? null,
    loading(lobby, fraction) {
      // The race screen as the page shows it, with only its loading overlay up.
      for (const section of document.querySelectorAll<HTMLElement>("section.screen")) section.hidden = section.id !== "screen-race";
      document.body.dataset.screen = "race";
      const screen = new LoadingScreen();
      screen.begin(raceWords(lobby.settings, lobby.grandPrix), "wheel");
      screen.progress(true, fraction);
    },
  };
}

declare global {
  interface Window {
    gripTest?: GripTest;
  }
}

export function installGripTest(wheel: ScriptedWheel): void {
  window.gripTest = makeTest(wheel);
}
