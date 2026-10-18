/**
 * Hooks for the end-to-end tests and the performance report, in dev and test
 * builds only: main.ts imports this module behind a check on the build mode,
 * so a production build contains none of it.
 *
 *   ?input=script     a scripted hand instead of the camera; the tests move it
 *                     with handyTest.pose() and the real aim pipeline does the rest
 *   ?fail=<trouble>   simulate camera-denied, camera-busy, camera-missing,
 *                     camera-insecure, webgl, model or game, to see each
 *                     error sheet
 *   ?tracker=page     track on the page's thread instead of a worker
 *   ?delegate=cpu     track on the CPU instead of the GPU
 *   ?range=1          the Test Range in the arcade (src/games/range/): a
 *                     timed game with a scope, and ?weapon=cylinder|magazine|heat
 */
import type { HudSink } from "../engine/types";
import { ARCADE } from "../games/index";
import { TEST_RANGE } from "../games/range/index";
import type { HandPose } from "../input/synthetic";
import { ScriptedHands } from "../input/script";
import type { FaceReading } from "../tracking/types";
import type { App, AppOptions } from "./app";

export function testOptions(params: URLSearchParams): AppOptions {
  // The Test Range joins the arcade before the page first draws it.
  if (params.get("range") === "1" && !ARCADE.includes(TEST_RANGE)) ARCADE.push(TEST_RANGE);
  const tracker = params.get("tracker");
  return {
    scripted: params.get("input") === "script" ? new ScriptedHands() : null,
    fail: params.get("fail"),
    trackerWhere: tracker === "page" || tracker === "worker" ? tracker : "auto",
    trackerDelegate: params.get("delegate")?.toUpperCase() === "CPU" ? "CPU" : "GPU",
  };
}

export interface HandyTest {
  snapshot: App["snapshot"];
  /** Shows the scripted hand in this pose (null: no hand). */
  pose(pose: HandPose | null): void;
  /**
   * The scripted face's eyes, 0 (open) to 1 (shut) as the face landmarker
   * scores them (null: no face in view), for a game that reads the eye.
   */
  eyes(eyes: FaceReading | null): void;
  internals(): App["internals"];
  /** The HUD, to stage its moments for screenshots. */
  hud(): HudSink;
  /** Starts the timing figures afresh. */
  resetStats(): void;
  /** The scripted camera stops sending pictures (true) or sends them again (false). */
  stall(stalled: boolean): void;
  /** The scripted camera becomes another camera (another device id) from its next opening. */
  device(id: string): void;
  /** As if the camera had been unplugged. */
  unplug(): void;
  /**
   * For performance measurements: the real hand tracker (in its worker, on
   * the GPU) reads the camera beside a scripted hand, so the frames measured
   * carry what tracking costs. Its readings never reach the game.
   */
  shadowTracking(): Promise<{ stats(): unknown; stop(): void }>;
}

declare global {
  interface Window {
    handyTest?: HandyTest;
  }
}

export function installTestHooks(app: App, options: AppOptions): void {
  window.handyTest = {
    snapshot: () => app.snapshot(),
    pose(pose) {
      if (options.scripted) options.scripted.pose = pose;
    },
    eyes(eyes) {
      if (options.scripted) options.scripted.eyes = eyes;
    },
    internals: () => app.internals,
    hud: () => app.hud,
    resetStats: () => app.resetStats(),
    stall(stalled) {
      if (options.scripted) options.scripted.stalled = stalled;
    },
    device(id) {
      if (options.scripted) options.scripted.deviceId = id;
    },
    unplug: () => app.unplugCamera(),
    async shadowTracking() {
      const [{ openCamera }, { loadTracker }] = await Promise.all([import("../tracking/camera"), import("../tracking/tracker")]);
      const video = document.createElement("video");
      const camera = await openCamera(video);
      const tracker = await loadTracker({ wasm: () => {}, model: () => {} }, { where: "worker", prefer: "GPU" });
      tracker.start(video);
      return {
        stats: () => tracker.stats(),
        stop() {
          tracker.dispose();
          camera.stop();
        },
      };
    },
  };
}
