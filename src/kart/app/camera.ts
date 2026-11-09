/**
 * The camera and the hand tracker behind the wheel, as the screens' one
 * `CameraService`. The picture is read in memory and never stored or sent.
 *
 * The camera opens once and stays open while the player is in a room; the
 * tracker is loaded for the number of hands wanted (2 for a wheel, 4, 6 or 8
 * for two, three or four players on one camera, or "count" to count the
 * players first: count.ts) and replaced if that changes.
 * The wheels are built before the camera is up (Choose Your Driver's Continue
 * makes them, then starts the camera; the wheel check comes after), so they
 * read from a `SwitchableSource`, which forwards to whichever tracker is
 * current.
 *
 * It also owns the `<video>` the camera plays into. Safari on a phone only
 * decodes a video that is in the page, inline (never full screen), muted and
 * started from something the player did; this one is all of those, kept 1 px
 * in size and invisible, and the wheel's picture is drawn from it.
 */
import { CameraError, cameraPermission, openCamera, type Camera } from "../../tracking/camera";
import { cameraSize, handConfidence, isCrowd, lanesFor, tilesFor } from "../../tracking/hands";
import { loadTracker, type Tracker } from "../../tracking/tracker";
import { MODEL_BYTES, WASM_BYTES } from "../../tracking/sizes";
import type { HandFrame, HandSource } from "../../tracking/types";
import type { TrackerCounts } from "./handsFirst";
import { CameraFailure, type CameraHands, type CameraService } from "./services";

/** A hand source that follows whichever real source is current, so a wheel built early keeps working when the tracker is replaced. */
export class SwitchableSource implements HandSource {
  private current: HandSource | null = null;
  private stopCurrent: (() => void) | null = null;
  private readonly listeners = new Set<(frame: HandFrame) => void>();

  /** Reads from `source` from now on (null: from nothing). */
  use(source: HandSource | null): void {
    this.stopCurrent?.();
    this.stopCurrent = null;
    this.current = source;
    if (source) this.stopCurrent = source.subscribe((frame) => this.publish(frame));
  }

  private publish(frame: HandFrame): void {
    for (const listener of [...this.listeners]) listener(frame);
  }

  subscribe(listener: (frame: HandFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): HandFrame | null {
    return this.current?.latest() ?? null;
  }
}

/** The camera, however it is really made (the tests and the scripted hand stand in). */
export interface CameraStackOptions {
  /** Opens the camera into a video, asking for a picture this size. */
  open?: (video: HTMLVideoElement, size: { width: number; height: number }) => Promise<Camera>;
  /** Loads the tracker for this many hands, or for counting the players. */
  load?: (hands: CameraHands, progress: (fraction: number) => void) => Promise<Tracker>;
  /** Makes the video the camera plays into (in the page, out of sight, by default). */
  makeVideo?: () => HTMLVideoElement;
}

/** The video for the camera: in the page, inline, muted and 1 px, so every browser (an iPhone's most of all) decodes it. */
function makeVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0.01",
    pointerEvents: "none",
  });
  document.body.append(video);
  return video;
}

export class CameraStack implements CameraService {
  /** What the wheels read. */
  readonly source = new SwitchableSource();
  /** The count screen's hands: the same tracker's. */
  get hands(): HandSource {
    return this.source;
  }
  private video_: HTMLVideoElement | null = null;
  private camera: Camera | null = null;
  private tracker: Tracker | null = null;
  /** What the tracker was loaded for (0: none). */
  private loaded: CameraHands | 0 = 0;
  /** Whether the camera was opened for a crowd (three or four players: a bigger picture). */
  private crowd = false;
  /** Counts starts and stops, so a start that was overtaken lets go of what it opened. */
  private generation = 0;
  private busy: Promise<unknown> = Promise.resolve();

  private reviving = false;

  constructor(private readonly options: CameraStackOptions = {}) {
    // A phone that took a call or switched apps comes back with its camera cut off: pick it up again.
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => void this.revive());
  }

  /** Back in the page after being away: if the system took the camera, open it again so the wheel sees hands. */
  private async revive(): Promise<void> {
    const camera = this.camera;
    if (document.visibilityState !== "visible" || !camera || this.reviving) return;
    if (camera.stream.getVideoTracks().some((track) => track.readyState === "live")) {
      // Still ours, but the picture may have been paused with the page.
      void this.video.play().catch(() => {});
      return;
    }
    this.reviving = true;
    const mine = this.generation;
    try {
      const next = await this.open(this.crowd);
      if (mine !== this.generation) next.stop();
      else this.camera = next;
    } catch {
      // The wheel will say "Show Both Hands"; leaving and coming back asks for the camera afresh.
    } finally {
      this.reviving = false;
    }
  }

  /** The video the camera plays into (made when first asked for, in the page, out of sight). */
  get video(): HTMLVideoElement {
    this.video_ ??= (this.options.makeVideo ?? makeVideo)();
    return this.video_;
  }

  /** The picture's width over its height (16:9 until the camera says). */
  aspect(): number {
    const video = this.video_;
    return video && video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
  }

  async permission(): Promise<"granted" | "denied" | "prompt"> {
    const state = await cameraPermission();
    return state === "granted" || state === "denied" ? state : "prompt";
  }

  /** Opens the camera, for a crowd (three or four players) or not. */
  private open(crowd: boolean): Promise<Camera> {
    const size = cameraSize(crowd ? 6 : 2);
    return (this.options.open ?? ((video, want) => openCamera(video, { size: want })))(this.video, size);
  }

  start(hands: CameraHands, progress?: (fraction: number) => void): Promise<void> {
    const mine = ++this.generation;
    // One start at a time: a second call waits for the first, then only changes what differs.
    const run = this.busy.then(() => this.begin(hands, mine, progress));
    this.busy = run.catch(() => {});
    return run;
  }

  private async begin(hands: CameraHands, mine: number, progress?: (fraction: number) => void): Promise<void> {
    // Overtaken (the player left, or asked again): quietly nothing to do, and nothing left open.
    if (mine !== this.generation) return;
    try {
      // A crowd needs a bigger picture than one or two players do: a camera opened for the other kind is opened again.
      const crowd = hands === "count" || isCrowd(hands);
      if (this.camera && this.crowd !== crowd) {
        this.camera.stop();
        this.camera = null;
      }
      if (!this.camera) {
        const camera = await this.open(crowd);
        if (mine !== this.generation) return camera.stop();
        this.camera = camera;
        this.crowd = crowd;
      }
      if (!this.tracker || this.loaded !== hands) {
        this.source.use(null);
        this.tracker?.dispose();
        this.tracker = null;
        const load = this.options.load ?? loadForWheel;
        const tracker = await load(hands, (fraction) => progress?.(fraction));
        if (mine !== this.generation) return tracker.dispose();
        this.tracker = tracker;
        this.loaded = hands;
        this.source.use(tracker);
        tracker.start(this.video);
      }
    } catch (error) {
      if (error instanceof CameraFailure) throw error;
      if (error instanceof CameraError) throw new CameraFailure(error.trouble);
      // The camera is open; it is the tracker that would not come.
      console.warn("Grip Prix: the hand tracker could not start.", error);
      throw new CameraFailure("model");
    }
  }

  counts(): TrackerCounts | null {
    return this.tracker?.counts() ?? null;
  }

  stop(): void {
    this.generation++;
    this.source.use(null);
    this.tracker?.stop();
    this.tracker?.dispose();
    this.tracker = null;
    this.loaded = 0;
    this.crowd = false;
    this.camera?.stop();
    this.camera = null;
  }
}

/**
 * `?tiles=1` in the address reads the whole picture at once, in one worker, even for two to four players (to compare
 * with the tiles and their workers on real hands; two players were read that way before).
 */
function tilesOverride(): number | null {
  if (typeof location === "undefined") return null;
  const asked = Number(new URLSearchParams(location.search).get("tiles"));
  return Number.isInteger(asked) && asked >= 1 && asked <= 4 ? asked : null;
}

/**
 * `?cut=worker` or `?cut=page` (test builds only): who cuts each player's column out of a shared camera's frame, instead
 * of asking the browser (tracking/cut.ts). A test in Chrome, which cuts as asked, uses `worker` to drive the path Safari takes.
 */
function cutOverride(): boolean | undefined {
  if (import.meta.env.MODE === "production" || typeof location === "undefined") return undefined;
  const asked = new URLSearchParams(location.search).get("cut");
  return asked === "page" ? true : asked === "worker" ? false : undefined;
}

/**
 * The real tracker for a wheel, with the download's two parts folded into one fraction: two or more players sharing the
 * camera each read in a tile and a worker of their own (lanesFor), and a worker whose landmarker is slow here tries the
 * other delegate (tracking/adapt.ts).
 */
async function loadForWheel(wanted: CameraHands, progress: (fraction: number) => void): Promise<Tracker> {
  // Counting reads the picture as four players' would be read, for up to eight hands, but in one worker, a tile after
  // another (a few reads a second are plenty to count by): no downloads or memory beyond the one wheel's.
  const counting = wanted === "count";
  const hands = counting ? 8 : wanted;
  const tiles = counting ? 4 : (tilesOverride() ?? tilesFor(hands));
  let wasm = 0;
  let model = 0;
  const report = () => progress((wasm * WASM_BYTES + model * MODEL_BYTES) / (WASM_BYTES + MODEL_BYTES));
  return loadTracker(
    {
      wasm: (fraction) => {
        wasm = fraction;
        report();
      },
      model: (fraction) => {
        model = fraction;
        report();
      },
    },
    { hands, confidence: handConfidence(hands), tiles, lanes: counting ? undefined : (lanesFor(tiles) ?? undefined), adapt: true, cutOnPage: cutOverride() },
  );
}
