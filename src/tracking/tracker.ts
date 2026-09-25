/**
 * Runs the hand landmarker on every new camera frame and publishes what it
 * saw as a HandFrame.
 *
 * requestVideoFrameCallback fires once per frame the camera delivers, so each
 * frame is read exactly once: never twice (which would waste the time and
 * count one fold as two frames), and never at the display's rate rather than
 * the camera's.
 */
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { Samples, type Percentiles } from "../engine/stats";
import type { HandFrame, HandSource, Landmark } from "./types";

export interface TrackerStats {
  frames: number;
  framesWithHand: number;
  /** Time spent in the landmarker per camera frame, ms. */
  inference: Percentiles;
  /** From the camera capturing a frame to its HandFrame being published, ms. */
  delay: Percentiles;
}

export class HandTracker implements HandSource {
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private newest: HandFrame | null = null;
  private running = false;
  private handle = 0;
  private lastTimestamp = -1;
  private sequence = 0;
  private lastMediaTime = -1;
  private readonly inference = new Samples(300);
  private readonly delay = new Samples(300);
  private frames = 0;
  private framesWithHand = 0;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly landmarker: HandLandmarker,
  ) {}

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): HandFrame | null {
    return this.newest;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  /** Stops reading frames (while paused); the camera itself keeps running. */
  stop(): void {
    this.running = false;
    if ("cancelVideoFrameCallback" in this.video) this.video.cancelVideoFrameCallback(this.handle);
    cancelAnimationFrame(this.handle);
  }

  get isRunning(): boolean {
    return this.running;
  }

  stats(): TrackerStats {
    return {
      frames: this.frames,
      framesWithHand: this.framesWithHand,
      inference: this.inference.summary(),
      delay: this.delay.summary(),
    };
  }

  resetStats(): void {
    this.inference.clear();
    this.delay.clear();
    this.frames = 0;
    this.framesWithHand = 0;
  }

  private schedule(): void {
    if (!this.running) return;
    if ("requestVideoFrameCallback" in this.video) {
      this.handle = this.video.requestVideoFrameCallback((now, metadata) => this.onFrame(now, metadata));
    } else {
      // Without it (older browsers), poll with the display and read a frame
      // only when the video has moved on.
      this.handle = requestAnimationFrame((now) => {
        if (this.video.currentTime !== this.lastMediaTime) {
          this.lastMediaTime = this.video.currentTime;
          this.onFrame(now, null);
        } else {
          this.schedule();
        }
      });
    }
  }

  private onFrame(now: number, metadata: VideoFrameCallbackMetadata | null): void {
    if (!this.running) return;
    // captureTime is when the camera took the picture, on this page's clock;
    // not every browser gives it, and the frame's arrival is the next best.
    const capturedAt = metadata?.captureTime ?? metadata?.presentationTime ?? now;
    // The landmarker insists on strictly increasing timestamps.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(capturedAt));
    this.lastTimestamp = timestamp;
    let landmarks: Landmark[] | null = null;
    let handedness: HandFrame["handedness"] = null;
    const began = performance.now();
    try {
      const result = this.landmarker.detectForVideo(this.video, timestamp);
      const hand = result.landmarks[0];
      if (hand && hand.length >= 21) {
        landmarks = hand.map(({ x, y, z }) => ({ x, y, z }));
        const name = result.handedness[0]?.[0]?.categoryName;
        handedness = name === "Left" || name === "Right" ? name : null;
      }
    } catch (error) {
      // One bad frame (a camera mid-reconfiguration) is skipped, not fatal.
      console.warn("A camera frame could not be read.", error);
    }
    const done = performance.now();
    this.inference.push(done - began);
    this.delay.push(done - capturedAt);
    this.frames++;
    if (landmarks) this.framesWithHand++;
    const frame: HandFrame = { landmarks, handedness, capturedAt, sequence: ++this.sequence };
    this.newest = frame;
    for (const listener of this.listeners) listener(frame);
    this.schedule();
  }
}
