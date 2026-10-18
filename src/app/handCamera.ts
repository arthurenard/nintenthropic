/**
 * The camera and the hand tracker the page plays with. The camera is asked
 * for once and kept from round to round, and let go of on the way back to
 * the arcade; the tracker, once loaded, is kept for the visit, so the next
 * game starts without a second download. Here the camera's frames start and
 * stop being read, the face is read for a scope, and the browser's cameras
 * are listed for Switch Camera. In dev and test builds a scripted hand stands
 * in for the camera and the tracker both.
 *
 * What a camera that goes means for a round is cameraInPlay.ts's to decide.
 */
import type { CameraIdentity } from "../calibration/storage";
import type { ScriptedHands } from "../input/script";
import { CameraError, listCameras, openCamera, type Camera, type CameraInfo, type CameraTrouble } from "../tracking/camera";
import type { LandmarkerProgress } from "../tracking/landmarker";
import type { Tracker } from "../tracking/tracker";
import type { HandSource } from "../tracking/types";
import { $ } from "../ui/dom";
import { prefs } from "./prefs";

export interface HandCameraOptions {
  /** A scripted hand instead of the camera and tracker (dev and test builds only). */
  scripted?: ScriptedHands | null;
  /** A camera trouble to simulate (`camera-denied`, `camera-busy`...), for screenshots of every error (dev and test builds only). */
  fail?: string | null;
  /** Where the hand tracker runs: a worker unless told otherwise. */
  trackerWhere?: "auto" | "worker" | "page";
  /** Which delegate the tracker tries first. */
  trackerDelegate?: "GPU" | "CPU";
}

export class HandCamera {
  /** The camera open now, if one is. */
  camera: Camera | null = null;
  /** The hand tracker, made with the first game played with the hand (or the first Eye Test) and kept. */
  tracker: Tracker | null = null;
  /** Frames are being read from the camera (or the script). */
  tracking = false;
  /** When a camera frame last reached the page, performance.now() ms; the frame watch and tracking's start set it. */
  frameAt = 0;
  /** The camera open now ended on its own: unplugged, or taken by the system. */
  onEnded: () => void = () => {};
  private listed: CameraInfo[] = [];

  constructor(private readonly options: HandCameraOptions = {}) {}

  /** The scripted hand standing in for the camera and the tracker, in dev and test builds. */
  get scripted(): ScriptedHands | null {
    return this.options.scripted ?? null;
  }

  /** The cameras the browser listed when last asked (Switch Camera shows when there are two or more). */
  get cameras(): readonly CameraInfo[] {
    return this.listed;
  }

  /** The face can be read: the scripted face, or the face landmarker loaded. */
  get faceReady(): boolean {
    return !!this.options.scripted || !!this.tracker?.hasFace;
  }

  /** Opens the camera for play, into the page's own video element, and keeps it. */
  async open(): Promise<void> {
    const failure = this.options.fail;
    if (failure?.startsWith("camera-")) throw new CameraError(failure.slice(7) as CameraTrouble);
    const camera = await openCamera($<HTMLVideoElement>("camera"));
    prefs.cameraOpened = true;
    this.camera = camera;
    camera.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.camera !== camera) return;
      this.camera = null;
      this.onEnded();
    });
  }

  /** Lets the camera go: its light goes off. */
  release(): void {
    this.camera?.stop();
    this.camera = null;
  }

  /** Loads the hand tracker (and the face landmarker with it, when asked) into the bar's parts. */
  async loadTracker(progress: LandmarkerProgress, face: boolean): Promise<Tracker> {
    const { loadTracker } = await import("../tracking/tracker");
    return loadTracker(progress, { where: this.options.trackerWhere ?? "auto", prefer: this.options.trackerDelegate ?? "GPU", face });
  }

  /** What the hand is read from: the tracker, or the script. */
  source(): HandSource {
    return this.options.scripted ?? this.tracker!;
  }

  /** Which camera is playing: its aim is saved and found by this. */
  identity(): CameraIdentity | null {
    if (this.options.scripted) return { deviceId: this.options.scripted.deviceId, width: 1280, height: 720 };
    return this.camera ? { deviceId: this.camera.deviceId, width: this.camera.width, height: this.camera.height } : null;
  }

  /** The camera in use (the scripted hand plays a camera of its own). */
  inUse(): string | null {
    return this.options.scripted ? this.options.scripted.deviceId : (this.camera?.deviceId ?? null);
  }

  /** The cameras the browser lists now. */
  async refresh(): Promise<void> {
    this.listed = await listCameras();
  }

  /** Starts reading the camera's frames, when there is a camera and a tracker to read them. */
  start(): void {
    if (this.options.scripted) this.options.scripted.start();
    else if (this.tracker && this.camera) this.tracker.start(this.camera.video);
    else return;
    this.tracking = true;
    // The camera gets its full grace from now to show a frame.
    this.frameAt = performance.now();
  }

  stop(): void {
    this.tracking = false;
    if (this.options.scripted) this.options.scripted.stop();
    else this.tracker?.stop();
  }

  /** Reads the face on every `every`th camera frame, or not at all (0). */
  readFaces(every: number): void {
    if (this.options.scripted) this.options.scripted.readFace(every);
    else this.tracker?.readFace(every);
  }

  /** When a camera frame last arrived: counted by the tracker as frames arrive, before it reads them. */
  lastFrameAt(): number {
    return Math.max(this.frameAt, this.options.scripted ? 0 : (this.tracker?.frameAt ?? 0));
  }
}
