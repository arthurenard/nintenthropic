/**
 * Runs the hand landmarker on every new camera frame and publishes what it
 * saw as a HandFrame.
 *
 * requestVideoFrameCallback fires once per frame the camera delivers, so each
 * frame is read exactly once: never twice (which would waste the time and
 * count one fold as two frames), and at the camera's rate, not the display's.
 *
 * Where it runs. Reading a hand costs 10-40 ms a frame. On the page's own
 * thread that time is taken straight out of the game's frames - at 30 camera
 * frames a second, two animation frames of every four missed their slot - so
 * the landmarker runs in a worker, with its own WebGL context, and the page
 * only hands it each frame (a zero-copy VideoFrame) and reads back 21
 * points. If a frame is still being read when the next arrives, the new one
 * waits for nothing: it is skipped, so the aim is never built on a backlog.
 * Browsers that cannot run it in a worker run it on the page.
 */
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { DownloadError, fetchBytes, siteUrl } from "../engine/fetch";
import { Samples, type Percentiles } from "../engine/stats";
import { ModelError } from "./errors";
import type { LandmarkerProgress } from "./landmarker";
import { MODEL_BYTES, WASM_BYTES } from "./sizes";
import type { FromWorker, ToWorker } from "./protocol";
import type { HandFrame, HandSource, Landmark } from "./types";

export interface TrackerStats {
  frames: number;
  framesWithHand: number;
  /** Camera frames skipped because the last one was still being read. */
  skipped: number;
  /** Time spent in the landmarker per camera frame, ms. */
  inference: Percentiles;
  /** From the camera capturing a frame to its HandFrame being published, ms. */
  delay: Percentiles;
  /** Time the page's own thread spent per camera frame, ms. */
  pageCost: Percentiles;
}

export interface Tracker extends HandSource {
  readonly delegate: "GPU" | "CPU";
  readonly where: "worker" | "page";
  /** Reads every new frame of `video` until stopped. */
  start(video: HTMLVideoElement): void;
  stop(): void;
  readonly isRunning: boolean;
  /**
   * When the camera last delivered a frame, on the performance.now() clock
   * (0 before the first). Counted as the frame arrives, before it is read,
   * so a slow first read (the GPU compiling its shaders) is not taken for a
   * camera that has stopped.
   */
  readonly frameAt: number;
  stats(): TrackerStats;
  resetStats(): void;
  dispose(): void;
}

/** What the two trackers share: the frame clock, the listeners, the numbers. */
abstract class BaseTracker implements Tracker {
  abstract readonly delegate: "GPU" | "CPU";
  abstract readonly where: "worker" | "page";
  protected video: HTMLVideoElement | null = null;
  protected running = false;
  frameAt = 0;
  private handle = 0;
  private lastMediaTime = -1;
  private lastTimestamp = -1;
  private readonly listeners = new Set<(frame: HandFrame) => void>();
  private newest: HandFrame | null = null;
  private sequence = 0;
  protected readonly inference = new Samples(300);
  protected readonly delay = new Samples(300);
  protected readonly pageCost = new Samples(300);
  protected frames = 0;
  protected framesWithHand = 0;
  protected skipped = 0;

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): HandFrame | null {
    return this.newest;
  }

  start(video: HTMLVideoElement): void {
    if (this.running && this.video === video) return;
    this.stop();
    this.video = video;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    const video = this.video;
    if (typeof video?.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(this.handle);
    cancelAnimationFrame(this.handle);
  }

  get isRunning(): boolean {
    return this.running;
  }

  stats(): TrackerStats {
    return {
      frames: this.frames,
      framesWithHand: this.framesWithHand,
      skipped: this.skipped,
      inference: this.inference.summary(),
      delay: this.delay.summary(),
      pageCost: this.pageCost.summary(),
    };
  }

  resetStats(): void {
    this.inference.clear();
    this.delay.clear();
    this.pageCost.clear();
    this.frames = 0;
    this.framesWithHand = 0;
    this.skipped = 0;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  /** The landmarker insists on strictly increasing timestamps. */
  protected timestampFor(capturedAt: number): number {
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, Math.round(capturedAt));
    return this.lastTimestamp;
  }

  protected publish(landmarks: Landmark[] | null, handedness: HandFrame["handedness"], capturedAt: number): void {
    this.frames++;
    if (landmarks) this.framesWithHand++;
    this.delay.push(performance.now() - capturedAt);
    const frame: HandFrame = { landmarks, handedness, capturedAt, sequence: ++this.sequence };
    this.newest = frame;
    for (const listener of this.listeners) listener(frame);
  }

  protected abstract read(video: HTMLVideoElement, capturedAt: number): void;

  private schedule(): void {
    const video = this.video;
    if (!this.running || !video) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      this.handle = video.requestVideoFrameCallback((now, metadata) => {
        this.schedule();
        this.frameAt = performance.now();
        // captureTime is when the camera took the picture, on this page's
        // clock; not every browser gives it, and the frame's arrival is the
        // next best.
        if (this.running) this.read(video, metadata.captureTime ?? metadata.presentationTime ?? now);
      });
    } else {
      // Without it, poll with the display and read a frame only when the
      // video has moved on.
      this.handle = requestAnimationFrame((now) => {
        this.schedule();
        if (this.running && video.currentTime !== this.lastMediaTime) {
          this.lastMediaTime = video.currentTime;
          this.frameAt = performance.now();
          this.read(video, now);
        }
      });
    }
  }
}

/** The landmarker in a worker: the page only passes frames and reads points. */
class WorkerTracker extends BaseTracker {
  readonly where = "worker" as const;
  private busy = false;

  constructor(
    private readonly worker: Worker,
    readonly delegate: "GPU" | "CPU",
  ) {
    super();
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type !== "result") return;
      this.busy = false;
      this.inference.push(message.inference);
      if (this.running) this.publish(message.landmarks, message.handedness, message.capturedAt);
    });
  }

  /** How frames travel to the worker: a VideoFrame (zero-copy) or an ImageBitmap. */
  carrier: "videoframe" | "bitmap" = "videoframe";

  protected read(video: HTMLVideoElement, capturedAt: number): void {
    if (this.busy) {
      this.skipped++;
      return;
    }
    const began = performance.now();
    this.busy = true;
    const send = (image: VideoFrame | ImageBitmap) => {
      const message: ToWorker = {
        type: "frame",
        image,
        timestamp: this.timestampFor(capturedAt),
        capturedAt,
        sequence: this.frames,
      };
      this.worker.postMessage(message, [image]);
    };
    if (this.carrier === "bitmap") {
      createImageBitmap(video).then(send, () => (this.busy = false));
    } else {
      try {
        send(new VideoFrame(video, { timestamp: Math.round(capturedAt * 1000) }));
      } catch {
        this.busy = false; // no frame to give yet (the camera is still starting)
      }
    }
    this.pageCost.push(performance.now() - began);
  }

  override dispose(): void {
    super.dispose();
    this.worker.terminate();
  }
}

/** The landmarker on the page's own thread, where a worker cannot run it. */
class PageTracker extends BaseTracker {
  readonly where = "page" as const;

  constructor(
    private readonly landmarker: HandLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {
    super();
  }

  protected read(video: HTMLVideoElement, capturedAt: number): void {
    const began = performance.now();
    let landmarks: Landmark[] | null = null;
    let handedness: HandFrame["handedness"] = null;
    try {
      const result = this.landmarker.detectForVideo(video, this.timestampFor(capturedAt));
      const hand = result.landmarks[0];
      if (hand && hand.length >= 21) {
        landmarks = hand.map(({ x, y, z }) => ({ x, y, z }));
        const name = result.handedness[0]?.[0]?.categoryName;
        handedness = name === "Left" || name === "Right" ? name : null;
      }
    } catch (error) {
      console.warn("A camera frame could not be read.", error);
    }
    const spent = performance.now() - began;
    this.inference.push(spent);
    this.pageCost.push(spent);
    this.publish(landmarks, handedness, capturedAt);
  }

  override dispose(): void {
    super.dispose();
    this.landmarker.close();
  }
}

export interface TrackerOptions {
  prefer?: "GPU" | "CPU";
  /** Where to run the landmarker; "auto" picks a worker where the browser can. */
  where?: "auto" | "worker" | "page";
}

function workerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof VideoFrame !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

async function startWorker(progress: LandmarkerProgress, prefer: "GPU" | "CPU"): Promise<WorkerTracker> {
  const [wasm, model] = await Promise.all([
    fetchBytes(siteUrl("mediapipe/vision_wasm_module_internal.wasm"), progress.wasm, WASM_BYTES),
    fetchBytes(siteUrl("models/hand_landmarker.task"), progress.model, MODEL_BYTES),
  ]);
  const worker = new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module", name: "hand-tracking" });
  const ready = new Promise<"GPU" | "CPU">((resolve, reject) => {
    const listen = (event: MessageEvent<FromWorker>) => {
      if (event.data.type === "ready") resolve(event.data.delegate);
      else if (event.data.type === "failed") reject(new Error(event.data.message));
      else return;
      worker.removeEventListener("message", listen);
    };
    worker.addEventListener("message", listen);
    worker.addEventListener("error", (event) => reject(new Error(event.message || "the tracking worker failed")), { once: true });
  });
  const init: ToWorker = { type: "init", loader: siteUrl("mediapipe/vision_wasm_module_internal.js"), wasm, model, prefer };
  worker.postMessage(init, [wasm, model]);
  try {
    return new WorkerTracker(worker, await ready);
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/** Downloads and starts the hand tracker, reporting progress as it goes. */
export async function loadTracker(progress: LandmarkerProgress, options: TrackerOptions = {}): Promise<Tracker> {
  const prefer = options.prefer ?? "GPU";
  const where = options.where ?? "auto";
  if (where !== "page" && workerSupported()) {
    try {
      return await startWorker(progress, prefer);
    } catch (error) {
      // A download that failed would fail again on the page (the same
      // files): only a worker that could not run is worth the page's try.
      if (where === "worker" || error instanceof DownloadError) throw new ModelError(error);
      console.warn("Hand tracking in a worker is unavailable; tracking on the page.", error);
    }
  }
  // Only here is MediaPipe needed on the page itself.
  const { loadHandLandmarker } = await import("./landmarker");
  const { landmarker, delegate } = await loadHandLandmarker(progress, prefer);
  return new PageTracker(landmarker, delegate);
}
