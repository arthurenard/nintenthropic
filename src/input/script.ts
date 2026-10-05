/**
 * A hand that follows a script instead of a camera: for tests only. The page
 * swaps it in for the camera and the tracker with `?input=script` in dev and
 * test builds (never in production), and everything after it - the filter,
 * the trigger, the aim check, the game - runs for real. It scripts the eyes
 * too, for a game that reads them (the scope): what the face landmarker
 * would have said of them, frame by frame.
 */
import type { FaceFrame, FaceReading, HandFrame, HandSource } from "../tracking/types";
import { asCameraSees, makeHand, type HandPose } from "./synthetic";

export class ScriptedHands implements HandSource {
  /** The pose to show; null for no hand in view. */
  pose: HandPose | null = null;
  /** Which camera it plays: a test changes it to be a different camera. */
  deviceId = "script";
  /** A camera that has stopped sending pictures: running, but publishing nothing. */
  stalled = false;
  /** The eyes' blink scores to show, or null for no face in view. */
  eyes: FaceReading | null = { blinkLeft: 0.05, blinkRight: 0.05 };
  /** Read the face on every this-many frames, as the tracker does; 0 not at all. */
  private faceEvery = 0;
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private readonly faceListeners = new Set<(face: FaceFrame) => void>();
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

  subscribeFace(listener: (face: FaceFrame) => void): () => void {
    this.faceListeners.add(listener);
    return () => this.faceListeners.delete(listener);
  }

  /** As Tracker.readFace: the face on every `every`th frame, or none (0). */
  readFace(every: number): void {
    this.faceEvery = Math.max(0, Math.floor(every));
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
    if (this.stalled) return;
    const pose = this.pose;
    const landmarks = pose ? asCameraSees(makeHand(pose)) : null;
    const frame: HandFrame = {
      landmarks,
      handedness: pose ? "Right" : null,
      // The one scripted hand (a flat picture: it has no world points of its own).
      hands: landmarks ? [{ landmarks, world: landmarks, handedness: "Right", score: 1 }] : [],
      capturedAt: performance.now(),
      sequence: ++this.sequence,
    };
    this.newest = frame;
    for (const listener of this.listeners) listener(frame);
    if (this.faceEvery > 0 && this.sequence % this.faceEvery === 0) {
      const face: FaceFrame = { eyes: this.eyes ? { ...this.eyes } : null, capturedAt: frame.capturedAt };
      for (const listener of this.faceListeners) listener(face);
    }
  }
}
