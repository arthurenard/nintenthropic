/**
 * Hooks for the end-to-end tests, in dev and test builds only: main.ts
 * imports this module behind a check on the build mode, so a production
 * build contains none of it.
 *
 *   ?input=script     the wheel reads a scripted pair of hands instead of the
 *                     camera; the tests move them with `gripTest.wheel(...)`
 *   ?fail=<trouble>   camera-denied (or just camera), camera-busy,
 *                     camera-missing, camera-insecure, model, webgl: to see
 *                     each sheet
 */
import type { HandFrame, HandSource } from "../../tracking/types";
import { handFrame, wheelHands, type SynthHand, type WheelPose } from "../input/testHands";
import type { KartApp, KartAppSnapshot } from "./app";
import type { StandIn } from "./services.real";
import { CameraFailure, type CameraService, type CameraTrouble } from "./services";

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

/** A camera that is the script: always allowed, instantly up, or failing as asked. */
export class ScriptedCamera implements CameraService {
  constructor(
    readonly wheel: ScriptedWheel,
    private readonly fail: CameraTrouble | null,
  ) {}

  async permission(): Promise<"granted" | "denied" | "prompt"> {
    return this.fail === "denied" ? "denied" : "granted";
  }

  async start(_hands: 2 | 4, progress?: (fraction: number) => void): Promise<void> {
    if (this.fail) throw new CameraFailure(this.fail);
    progress?.(1);
    this.wheel.start();
  }

  stop(): void {
    this.wheel.stop();
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
  return { source: wheel, camera: new ScriptedCamera(wheel, trouble) };
}

export interface GripTest {
  /** Both hands of one wheel, or of several (two players on one camera), or none (null: hands out of the picture). */
  wheel(pose: WheelPose | readonly WheelPose[] | null): void;
  /** The script is publishing pictures. */
  readonly running: boolean;
  /** What the page shows and how the race stands. */
  state(): KartAppSnapshot | null;
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
