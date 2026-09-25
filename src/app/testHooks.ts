/**
 * Hooks for the end-to-end tests and the performance report, in dev and test
 * builds only: main.ts imports this module behind a check on the build mode,
 * so a production build contains none of it.
 *
 *   ?input=script     a scripted hand instead of the camera; the tests move it
 *                     with handyTest.pose() and the real aim pipeline does the rest
 *   ?fail=<trouble>   simulate camera-denied, camera-busy, camera-missing,
 *                     webgl, model or game, to see each error sheet
 *   ?tracker=page     track on the page's thread instead of a worker
 */
import type { HandPose } from "../input/synthetic";
import { ScriptedHands } from "../input/script";
import type { App, AppOptions } from "./app";

export function testOptions(params: URLSearchParams): AppOptions {
  const tracker = params.get("tracker");
  return {
    scripted: params.get("input") === "script" ? new ScriptedHands() : null,
    fail: params.get("fail"),
    trackerWhere: tracker === "page" || tracker === "worker" ? tracker : "auto",
  };
}

export interface HandyTest {
  snapshot: App["snapshot"];
  /** Shows the scripted hand in this pose (null: no hand). */
  pose(pose: HandPose | null): void;
  internals(): App["internals"];
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
    internals: () => app.internals,
  };
}
