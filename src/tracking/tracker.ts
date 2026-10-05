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
 *
 * The eye. For a game that reads it (GameEntry.uses.eye: Overwatch Ridge's
 * scope, when one eye closes) the face landmarker loads too - on first use,
 * with the loading bar - and reads the same frames after the hand, on every
 * frame or every other (readFace). Its result is sent after the hand's, so
 * the aim never waits for the eye; nothing but the two eyes' blink scores
 * comes back. Every other game never runs it. What it costs, measured with
 * e2e/tracker.html (?face=N) in the tracking worker on the GPU delegate, on
 * an M4 Max busy with other work (load average about 8), 30 fps camera,
 * three runs of 150 frames, a picture in which the face landmarker finds no
 * face - so its detector runs on every read, the dearer case:
 *
 *   hand alone             hand 9.1-10.5 ms p50 (p95 10.4-18.2), capture to
 *                          HandFrame 24-26 ms p50, 5-7 frames skipped
 *   + face, every frame    face 8.0-10.3 ms p50 (p95 11.9-13.6); the hand's
 *                          delay unchanged (its result goes first), but the
 *                          worker busy 20 ms a frame: 8-45 frames skipped,
 *                          and in one run the page's frames hitched (p95 50 ms)
 *   + face, every other    face 8.8-9.2 ms p50 (p95 10.1-11.4); skips and
 *                          the page's frames as with the hand alone
 *
 * So the face is read on every other frame (input/scope.ts, FACE_EVERY): 15 readings a
 * second at 30 fps, which EyeScope's 180 ms hold sees two or three of; about
 * 4.5 ms of the worker's time per camera frame, none of the page's.
 */
import type { FaceLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";
import { DownloadError, fetchBytes, siteUrl } from "../engine/fetch";
import { Samples, type Percentiles } from "../engine/stats";
import { ModelError } from "./errors";
import { eyesFrom } from "./eyes";
import { seenHands } from "./hands";
import type { LandmarkerProgress } from "./landmarker";
import { FACE_MODEL_BYTES, MODEL_BYTES, WASM_BYTES } from "./sizes";
import type { FromWorker, ToWorker } from "./protocol";
import type { FaceFrame, FaceReading, HandFrame, HandSource, SeenHand } from "./types";

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
  /** The face, while it is read: frames it was read on, how many had a face, and the time in its landmarker, ms. */
  face: { frames: number; found: number; inference: Percentiles } | null;
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
  /** The face landmarker is loaded (for a game that reads the eye). */
  readonly hasFace: boolean;
  /** Downloads and starts the face landmarker, reporting the model's progress. */
  addFace(progress: (fraction: number) => void): Promise<void>;
  /**
   * Read the face on every `every`th camera frame (1: every frame, 2: every
   * other), or not at all (0, the default: only a game that reads the eye
   * asks for it).
   */
  readFace(every: number): void;
  subscribeFace(listener: (face: FaceFrame) => void): () => void;
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
  private readonly faceListeners = new Set<(face: FaceFrame) => void>();
  /** Read the face on every this-many camera frames; 0 not at all. */
  protected faceEvery = 0;
  /** Camera frames read, for the face's cadence. */
  private reads = 0;
  protected readonly faceInference = new Samples(300);
  protected faceFrames = 0;
  protected facesFound = 0;
  abstract readonly hasFace: boolean;
  abstract addFace(progress: (fraction: number) => void): Promise<void>;

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeFace(listener: (face: FaceFrame) => void): () => void {
    this.faceListeners.add(listener);
    return () => this.faceListeners.delete(listener);
  }

  readFace(every: number): void {
    this.faceEvery = Math.max(0, Math.floor(every));
  }

  /** Is the face to be read on the frame being read now? Counts the frame. */
  protected faceDue(): boolean {
    this.reads++;
    return this.hasFace && this.faceEvery > 0 && this.reads % this.faceEvery === 0;
  }

  protected publishFace(eyes: FaceReading | null, capturedAt: number, inference: number): void {
    this.faceFrames++;
    if (eyes) this.facesFound++;
    this.faceInference.push(inference);
    const face: FaceFrame = { eyes, capturedAt };
    for (const listener of this.faceListeners) listener(face);
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
      face: this.faceFrames > 0 ? { frames: this.faceFrames, found: this.facesFound, inference: this.faceInference.summary() } : null,
    };
  }

  resetStats(): void {
    this.inference.clear();
    this.delay.clear();
    this.pageCost.clear();
    this.frames = 0;
    this.framesWithHand = 0;
    this.skipped = 0;
    this.faceInference.clear();
    this.faceFrames = 0;
    this.facesFound = 0;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.faceListeners.clear();
  }

  /** The landmarker insists on strictly increasing timestamps. */
  protected timestampFor(capturedAt: number): number {
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, Math.round(capturedAt));
    return this.lastTimestamp;
  }

  protected publish(hands: SeenHand[], capturedAt: number): void {
    this.frames++;
    if (hands.length) this.framesWithHand++;
    this.delay.push(performance.now() - capturedAt);
    // landmarks and handedness stay the first hand's, as the shooting games read them.
    const first = hands[0];
    const frame: HandFrame = {
      landmarks: first?.landmarks ?? null,
      handedness: first?.handedness ?? null,
      hands,
      capturedAt,
      sequence: ++this.sequence,
    };
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
    public hasFace: boolean,
  ) {
    super();
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "result") {
        // With a face to follow, the worker is busy until it comes.
        if (!message.face) this.busy = false;
        this.inference.push(message.inference);
        if (this.running) this.publish(message.hands, message.capturedAt);
      } else if (message.type === "face-result") {
        this.busy = false;
        if (this.running) this.publishFace(message.eyes, message.capturedAt, message.inference);
      }
    });
  }

  /** The face on its way, so asking twice loads it once. */
  private adding: Promise<void> | null = null;

  addFace(progress: (fraction: number) => void): Promise<void> {
    if (this.hasFace) return Promise.resolve();
    this.adding ??= this.loadFace(progress).finally(() => (this.adding = null));
    return this.adding;
  }

  private async loadFace(progress: (fraction: number) => void): Promise<void> {
    const model = await fetchBytes(siteUrl("models/face_landmarker.task"), progress, FACE_MODEL_BYTES);
    await new Promise<void>((resolve, reject) => {
      const listen = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === "face-ready") resolve();
        else if (event.data.type === "face-failed") reject(new ModelError(event.data.message));
        else return;
        this.worker.removeEventListener("message", listen);
      };
      this.worker.addEventListener("message", listen);
      const message: ToWorker = { type: "face", model };
      this.worker.postMessage(message, [model]);
    });
    this.hasFace = true;
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
    const face = this.faceDue();
    const send = (image: VideoFrame | ImageBitmap) => {
      const message: ToWorker = {
        type: "frame",
        image,
        timestamp: this.timestampFor(capturedAt),
        capturedAt,
        sequence: this.frames,
        face,
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
  /** The frame's timestamp, which the face is read at too. */
  private lastStamp = 0;

  private face: FaceLandmarker | null = null;

  constructor(
    private readonly landmarker: HandLandmarker,
    readonly delegate: "GPU" | "CPU",
  ) {
    super();
  }

  get hasFace(): boolean {
    return this.face !== null;
  }

  private adding: Promise<void> | null = null;

  addFace(progress: (fraction: number) => void): Promise<void> {
    if (this.face) return Promise.resolve();
    this.adding ??= import("./landmarker")
      .then(({ loadFaceOnPage }) => loadFaceOnPage(progress, this.delegate))
      .then(({ landmarker }) => {
        this.face = landmarker;
      })
      .finally(() => (this.adding = null));
    return this.adding;
  }

  protected read(video: HTMLVideoElement, capturedAt: number): void {
    const began = performance.now();
    let hands: SeenHand[] = [];
    try {
      this.lastStamp = this.timestampFor(capturedAt);
      hands = seenHands(this.landmarker.detectForVideo(video, this.lastStamp));
    } catch (error) {
      console.warn("A camera frame could not be read.", error);
    }
    const spent = performance.now() - began;
    this.inference.push(spent);
    this.publish(hands, capturedAt);
    let cost = spent;
    if (this.faceDue() && this.face) {
      const faceBegan = performance.now();
      let eyes: FaceReading | null = null;
      try {
        eyes = eyesFrom(this.face.detectForVideo(video, this.lastStamp));
      } catch (error) {
        console.warn("A camera frame's face could not be read.", error);
      }
      const faceSpent = performance.now() - faceBegan;
      cost += faceSpent;
      this.publishFace(eyes, capturedAt, faceSpent);
    }
    this.pageCost.push(cost);
  }

  override dispose(): void {
    super.dispose();
    this.landmarker.close();
    this.face?.close();
  }
}

export interface TrackerOptions {
  prefer?: "GPU" | "CPU";
  /** Where to run the landmarker; "auto" picks a worker where the browser can. */
  where?: "auto" | "worker" | "page";
  /** How many hands to look for: 1 in the shooting games (see input/trust.ts); 2 for Grip Prix's wheel, 4 for two wheels on one camera. */
  hands?: number;
  /** Detection and presence confidence, 0..1; 0.5 by default (handConfidence says what a crowd of players on one camera gets). */
  confidence?: number;
  /** Read the picture in this many side-by-side tiles, one landmarker for each, two hands to a tile (tiles.ts; in a worker only). */
  tiles?: number;
  /** Load the face landmarker too (a game that reads the eye is the first to be played). */
  face?: boolean;
}

function workerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof VideoFrame !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

async function startWorker(progress: LandmarkerProgress, prefer: "GPU" | "CPU", hands: number, withFace: boolean, confidence?: number, tiles?: number): Promise<WorkerTracker> {
  const binary = siteUrl("mediapipe/vision_wasm_module_internal.wasm");
  const [wasm, model, face] = await Promise.all([
    fetchBytes(binary, progress.wasm, WASM_BYTES),
    fetchBytes(siteUrl("models/hand_landmarker.task"), progress.model, MODEL_BYTES),
    withFace ? fetchBytes(siteUrl("models/face_landmarker.task"), progress.face, FACE_MODEL_BYTES) : Promise.resolve(null),
  ]);
  const worker = new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module", name: "hand-tracking" });
  const ready = new Promise<{ delegate: "GPU" | "CPU"; face: boolean }>((resolve, reject) => {
    const listen = (event: MessageEvent<FromWorker>) => {
      if (event.data.type === "ready") resolve(event.data);
      else if (event.data.type === "failed") reject(new Error(event.data.message));
      else return;
      worker.removeEventListener("message", listen);
    };
    worker.addEventListener("message", listen);
    worker.addEventListener("error", (event) => reject(new Error(event.message || "the tracking worker failed")), { once: true });
  });
  const init: ToWorker = {
    type: "init",
    loader: siteUrl("mediapipe/vision_wasm_module_internal.js"),
    wasm,
    binary,
    model,
    prefer,
    hands,
    ...(confidence === undefined ? {} : { confidence }),
    ...(tiles && tiles > 1 ? { tiles } : {}),
    ...(face ? { face } : {}),
  };
  worker.postMessage(init, face ? [wasm, model, face] : [wasm, model]);
  try {
    const started = await ready;
    // The worker says why on its own console (where a player never looks); the page says it too.
    if (withFace && !started.face) console.warn("The face landmarker did not start in the tracking worker, so the eye cannot scope (Shift still does).");
    return new WorkerTracker(worker, started.delegate, started.face);
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/** Downloads and starts the hand tracker, reporting progress as it goes. */
export async function loadTracker(progress: LandmarkerProgress, options: TrackerOptions = {}): Promise<Tracker> {
  const prefer = options.prefer ?? "GPU";
  const where = options.where ?? "auto";
  const hands = options.hands ?? 1;
  if (where !== "page" && workerSupported()) {
    try {
      return await startWorker(progress, prefer, hands, options.face === true, options.confidence, options.tiles);
    } catch (error) {
      // A download that failed would fail again on the page (the same
      // files): only a worker that could not run is worth the page's try.
      if (where === "worker" || error instanceof DownloadError) throw new ModelError(error);
      console.warn("Hand tracking in a worker is unavailable; tracking on the page.", error);
    }
  }
  // Only here is MediaPipe needed on the page itself.
  const { loadHandLandmarker } = await import("./landmarker");
  const { landmarker, delegate } = await loadHandLandmarker(progress, prefer, hands, options.confidence);
  const tracker = new PageTracker(landmarker, delegate);
  if (options.face) await tracker.addFace(progress.face ?? (() => {}));
  return tracker;
}
