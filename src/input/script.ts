/**
 * A hand that follows a script instead of a camera: for tests only. The page
 * swaps it in for the camera and the tracker with `?input=script` in dev and
 * test builds (never in production), and everything after it - the filter,
 * the trigger, the aim check, the game - runs for real.
 */
import type { HandFrame, HandSource } from "../tracking/types";
import { asCameraSees, makeHand, type HandPose } from "./synthetic";

export class ScriptedHands implements HandSource {
  /** The pose to show; null for no hand in view. */
  pose: HandPose | null = null;
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private newest: HandFrame | null = null;
  private sequence = 0;
  private timer = 0;

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): HandFrame | null {
    return this.newest;
  }

  /** Publishes a frame at the rate of an ordinary webcam. */
  start(fps = 30): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.publish(), 1000 / fps);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  get isRunning(): boolean {
    return this.timer !== 0;
  }

  publish(): void {
    const pose = this.pose;
    const frame: HandFrame = {
      landmarks: pose ? asCameraSees(makeHand(pose)) : null,
      handedness: pose ? "Right" : null,
      capturedAt: performance.now(),
      sequence: ++this.sequence,
    };
    this.newest = frame;
    for (const listener of this.listeners) listener(frame);
  }
}
