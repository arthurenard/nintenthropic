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
import { TileSchedule, joinTiles, tileRects, type Rect } from "./tiles";
import { DelegateWatch, TRY_FRAMES, Trials } from "./adapt";
import type { FaceFrame, FaceReading, HandFrame, HandSource, SeenHand } from "./types";

/** Frames closer together than this (ms) are more than a reading thirty times a second needs (a 60 fps camera's). */
const WANTED_GAP = 30;

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
  /**
   * Frames read and due frames dropped since the start, and the columns read each in a worker of their own (frames
   * count each column's reads): cheap enough to ask every animation frame (stats() sorts).
   */
  counts(): { frames: number; skipped: number; columns: number };
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
  /** As frames and skipped, never reset (resetStats is the benches'; the race watches these: handsFirst.ts). */
  private totalFrames = 0;
  private totalSkipped = 0;

  /**
   * A due camera frame dropped because the worker reading it was still busy, `since` ms after the frame it is reading.
   * The benches' `skipped` counts every one; `counts()` only those a reading thirty times a second would have wanted
   * (a camera at 60 fps hands over two frames for every one a tracker needs), and `counted` false leaves it out there.
   */
  protected drop(since: number, counted = true): void {
    this.skipped++;
    if (counted && since >= WANTED_GAP) this.totalSkipped++;
  }
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

  counts(): { frames: number; skipped: number; columns: number } {
    return { frames: this.totalFrames, skipped: this.totalSkipped, columns: this.columns };
  }

  /** The columns read each in a worker of their own: one, but for a LaneTracker. */
  protected get columns(): number {
    return 1;
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

  protected publish(hands: SeenHand[], capturedAt: number, read?: HandFrame["read"]): void {
    this.frames++;
    this.totalFrames++;
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
      ...(read ? { read } : {}),
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
  /** When the frame being read (or last read) was taken, ms. */
  private sentAt = -Infinity;
  /** Learns which delegate is quicker here (adapt.ts), when asked to; null otherwise. */
  private readonly watch: DelegateWatch | null;

  constructor(
    private readonly worker: Worker,
    delegate: "GPU" | "CPU",
    public hasFace: boolean,
    adapt = false,
  ) {
    super();
    this.watch = adapt ? new DelegateWatch(delegate) : null;
    this.started = delegate;
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "result") {
        // With a face to follow, the worker is busy until it comes.
        if (!message.face) this.busy = false;
        this.inference.push(message.inference);
        const proposal = this.watch?.push(message.inference, performance.now());
        if (proposal) {
          this.watch!.start();
          this.ask({ type: "try", delegate: proposal, frames: TRY_FRAMES });
        }
        if (this.running) this.publish(message.hands, message.capturedAt);
      } else if (message.type === "tried") {
        this.watch?.tried(message.kept, performance.now());
      } else if (message.type === "face-result") {
        this.busy = false;
        if (this.running) this.publishFace(message.eyes, message.capturedAt, message.inference);
      }
    });
  }

  private readonly started: "GPU" | "CPU";

  /** The delegate the landmarker reads with now (it can change once a try of the other has been made: adapt.ts). */
  get delegate(): "GPU" | "CPU" {
    return this.watch?.delegate ?? this.started;
  }

  private ask(message: ToWorker): void {
    this.worker.postMessage(message);
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
      this.drop(capturedAt - this.sentAt);
      return;
    }
    const began = performance.now();
    this.busy = true;
    this.sentAt = capturedAt;
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

/** One worker of a LaneTracker: it reads one player's column of the picture. */
interface Lane {
  worker: Worker;
  delegate: "GPU" | "CPU";
  busy: boolean;
  /** The tile it was last given, and the picture's size then, px. */
  tile: Rect | null;
  width: number;
  height: number;
  /** What it found there, in the tile's own picture. */
  hands: SeenHand[];
  /** Learns which delegate is quicker for it (adapt.ts), when asked to. */
  watch: DelegateWatch | null;
  /** When the frame it is reading (or last read) was taken, ms. */
  sentAt: number;
}

/** A tile's edges on even pixels: a camera's frame is often stored with its colour at half resolution, and a VideoFrame can only be cut on its samples. */
function evenTile(tile: Rect, width: number): Rect {
  const x = tile.x - (tile.x % 2);
  const right = Math.min(width - (width % 2), tile.x + tile.width + ((tile.x + tile.width) % 2));
  return { x, y: 0, width: right - x, height: tile.height - (tile.height % 2) };
}

/**
 * Players sharing a camera, each column of the picture read in a worker of its own (tiles.ts), all at once: one
 * landmarker per worker, so the columns are read side by side rather than one after another. Each worker is handed
 * its column as a VideoFrame cut to it (no copy), and says what it found as soon as it has: a frame is published for
 * that column alone (HandFrame.read), with the other columns' hands as they were last seen, so a player's wheel is
 * never held up by a neighbour's. A column whose worker is still busy skips the camera frame, as a single worker does.
 */
class LaneTracker extends BaseTracker {
  readonly where = "worker" as const;
  readonly hasFace = false;
  private readonly tileSchedule: TileSchedule;
  /** One try of the other delegate at a time, across the workers. */
  private readonly trials = new Trials();

  constructor(private readonly lanes: Lane[]) {
    super();
    this.tileSchedule = new TileSchedule(lanes.length);
    lanes.forEach((lane, i) => lane.worker.addEventListener("message", (event: MessageEvent<FromWorker>) => this.received(i, event.data)));
  }

  /** Reads and wanted drops of the seats being played (an empty seat's column, read every third frame, is left out). */
  private playedReads = 0;
  private playedDrops = 0;

  /** As every tracker's, but counting only the seats being played: the race makes room for players, not empty seats. */
  override counts(): { frames: number; skipped: number; columns: number } {
    const played = this.lanes.filter((_, i) => !this.tileSchedule.quiet(i)).length;
    return { frames: this.playedReads, skipped: this.playedDrops, columns: Math.max(1, played) };
  }

  /** The first column's delegate. */
  get delegate(): "GPU" | "CPU" {
    return this.lanes[0]!.watch?.delegate ?? this.lanes[0]!.delegate;
  }

  /** The delegate each column's worker reads with now. */
  get delegates(): ("GPU" | "CPU")[] {
    return this.lanes.map((lane) => lane.watch?.delegate ?? lane.delegate);
  }

  addFace(): Promise<void> {
    return Promise.reject(new ModelError("the face is not read for players sharing a camera"));
  }

  protected read(video: HTMLVideoElement, capturedAt: number): void {
    const began = performance.now();
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    const due = this.tileSchedule.next();
    const tiles = tileRects(this.lanes.length, width, height);
    const timestamp = this.timestampFor(capturedAt);
    this.lanes.forEach((lane, i) => {
      if (!due[i]) return;
      if (lane.busy) {
        const since = capturedAt - lane.sentAt;
        if (!this.tileSchedule.quiet(i) && since >= WANTED_GAP) this.playedDrops++;
        this.drop(since, false);
        return;
      }
      const tile = evenTile(tiles[i]!, width);
      const image = this.frameFor(video, capturedAt, tile);
      if (!image) return;
      lane.busy = true;
      lane.sentAt = capturedAt;
      lane.tile = tile;
      lane.width = width;
      lane.height = height;
      const message: ToWorker = { type: "frame", image, timestamp, capturedAt, sequence: this.frames, ...(this.cutHere ? {} : { crop: tile }) };
      lane.worker.postMessage(message, [image]);
    });
    this.pageCost.push(performance.now() - began);
  }

  /** Whether the browser cuts a VideoFrame to a column (visibleRect); where it cannot, the workers cut it. */
  private cutHere = true;

  /** The camera's frame for one column: cut to it, or whole (with the column for the worker to cut). Null before the camera has a frame. */
  private frameFor(video: HTMLVideoElement, capturedAt: number, tile: Rect): VideoFrame | null {
    const timestamp = Math.round(capturedAt * 1000);
    if (this.cutHere) {
      try {
        return new VideoFrame(video, { timestamp, visibleRect: tile });
      } catch {
        // A whole frame can be made where a cut one cannot: from now on the workers cut it.
        try {
          new VideoFrame(video, { timestamp }).close();
          this.cutHere = false;
        } catch {
          return null; // no frame to give yet (the camera is still starting)
        }
      }
    }
    try {
      return new VideoFrame(video, { timestamp });
    } catch {
      return null;
    }
  }

  private received(index: number, message: FromWorker): void {
    const lane = this.lanes[index]!;
    if (message.type === "tried") {
      lane.watch?.tried(message.kept, performance.now());
      this.trials.end();
      return;
    }
    if (message.type !== "result") return;
    lane.busy = false;
    lane.hands = message.hands;
    if (!this.tileSchedule.quiet(index)) this.playedReads++;
    this.inference.push(message.inference);
    const proposal = lane.watch?.push(message.inference, performance.now());
    // One GPU landmarker at a time: two or three beside a race take turns on it and all slow down (docs/GRIP_PRIX.md).
    const gpuTaken = proposal === "GPU" && this.delegates.some((delegate, i) => i !== index && delegate === "GPU");
    if (proposal && !gpuTaken && this.trials.begin()) {
      lane.watch!.start();
      const ask: ToWorker = { type: "try", delegate: proposal, frames: TRY_FRAMES };
      lane.worker.postMessage(ask);
    }
    this.tileSchedule.record(this.lanes.map((_, i) => (i === index ? message.hands.length : null)));
    const tile = lane.tile;
    if (!this.running || !tile) return;
    const seen = this.lanes.filter((one) => one.tile !== null);
    const found = seen.map((one) => ({ tile: one.tile!, hands: one.hands }));
    this.publish(joinTiles(found, lane.width, lane.height, seen.indexOf(lane)), message.capturedAt, [[tile.x / lane.width, (tile.x + tile.width) / lane.width]]);
  }

  override dispose(): void {
    super.dispose();
    for (const lane of this.lanes) lane.worker.terminate();
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
  /**
   * With tiles: read each tile in a worker of its own, all at once (LaneTracker), on these delegates, one for each
   * tile. Absent: one worker reads every tile, one after another.
   */
  lanes?: readonly ("GPU" | "CPU")[];
  /** Learn which delegate is quicker on this machine: a worker whose landmarker is slow tries the other (adapt.ts). */
  adapt?: boolean;
  /** Load the face landmarker too (a game that reads the eye is the first to be played). */
  face?: boolean;
}

function workerSupported(): boolean {
  return typeof Worker !== "undefined" && typeof VideoFrame !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

async function startWorker(progress: LandmarkerProgress, prefer: "GPU" | "CPU", hands: number, withFace: boolean, confidence?: number, tiles?: number, adapt = false): Promise<WorkerTracker> {
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
    return new WorkerTracker(worker, started.delegate, started.face, adapt && !(tiles && tiles > 1));
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/** Starts a worker for each tile, each with its own landmarker for two hands, on the delegate asked for it (LaneTracker). */
/** A LaneTracker over workers whose landmarkers have started (startLanes; the tests give it stand-ins). */
export function makeLaneTracker(workers: readonly { worker: Worker; delegate: "GPU" | "CPU" }[], adapt = false): Tracker & { readonly delegates: ("GPU" | "CPU")[] } {
  return new LaneTracker(workers.map(({ worker, delegate }) => ({ worker, delegate, busy: false, tile: null, width: 0, height: 0, hands: [], watch: adapt ? new DelegateWatch(delegate) : null, sentAt: -Infinity })));
}

async function startLanes(progress: LandmarkerProgress, delegates: readonly ("GPU" | "CPU")[], hands: number, confidence?: number, adapt = false): Promise<Tracker> {
  const binary = siteUrl("mediapipe/vision_wasm_module_internal.wasm");
  const [wasm, model] = await Promise.all([fetchBytes(binary, progress.wasm, WASM_BYTES), fetchBytes(siteUrl("models/hand_landmarker.task"), progress.model, MODEL_BYTES)]);
  const workers: Worker[] = [];
  try {
    const lanes = await Promise.all(
      delegates.map(async (prefer): Promise<{ worker: Worker; delegate: "GPU" | "CPU" }> => {
        const worker = new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module", name: "hand-tracking" });
        workers.push(worker);
        const ready = new Promise<{ delegate: "GPU" | "CPU" }>((resolve, reject) => {
          const listen = (event: MessageEvent<FromWorker>) => {
            if (event.data.type === "ready") resolve(event.data);
            else if (event.data.type === "failed") reject(new Error(event.data.message));
            else return;
            worker.removeEventListener("message", listen);
          };
          worker.addEventListener("message", listen);
          worker.addEventListener("error", (event) => reject(new Error(event.message || "a tracking worker failed")), { once: true });
        });
        // Each worker is given its own copy of the files (a transfer leaves nothing behind for the next).
        const init: ToWorker = {
          type: "init",
          loader: siteUrl("mediapipe/vision_wasm_module_internal.js"),
          wasm: wasm.slice(0),
          binary,
          model: model.slice(0),
          prefer,
          hands: Math.max(1, Math.ceil(hands / delegates.length)),
          ...(confidence === undefined ? {} : { confidence }),
        };
        worker.postMessage(init, [init.wasm, init.model]);
        const { delegate } = await ready;
        return { worker, delegate };
      }),
    );
    return makeLaneTracker(lanes, adapt);
  } catch (error) {
    for (const worker of workers) worker.terminate();
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
      const tiles = Math.round(options.tiles ?? 1);
      if (tiles > 1 && options.lanes?.length === tiles && !options.face) {
        try {
          return await startLanes(progress, options.lanes, hands, options.confidence, options.adapt);
        } catch (error) {
          if (error instanceof DownloadError) throw error;
          console.warn("Hand tracking in a worker for each player is unavailable; one worker reads them all.", error);
        }
      }
      return await startWorker(progress, prefer, hands, options.face === true, options.confidence, options.tiles, options.adapt);
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
