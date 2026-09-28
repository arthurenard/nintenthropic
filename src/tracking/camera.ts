/**
 * Opening the player's camera. The picture is read in memory, frame by frame,
 * and never stored or sent anywhere.
 */

/** What can stand between the player and their camera, each with its own fix. */
export type CameraTrouble = "denied" | "busy" | "missing" | "insecure";

export class CameraError extends Error {
  constructor(
    readonly trouble: CameraTrouble,
    cause?: unknown,
  ) {
    super(`camera ${trouble}`);
    this.name = "CameraError";
    this.cause = cause;
  }
}

/** getUserMedia's errors, by what the player can do about them. */
export function classifyCameraError(error: unknown): CameraTrouble {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "missing";
  // NotReadableError, TrackStartError, AbortError: the camera is there, but
  // something else has it.
  return "busy";
}

const REMEMBERED = "handy.camera.v1";

/** The camera that opened last time, if this window kept it. */
export function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED);
  } catch {
    return null;
  }
}

function remember(deviceId: string): void {
  try {
    localStorage.setItem(REMEMBERED, deviceId);
  } catch {
    // A window that cannot store anything asks for the default camera next time.
  }
}

/** The camera the player chose in Settings: asked for by name, ahead of the one used last. */
const CHOSEN = "handy.camera-choice.v1";

export function chosenCamera(): string | null {
  try {
    const id: unknown = JSON.parse(localStorage.getItem(CHOSEN) ?? "null");
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/** Keeps the player's choice of camera (null: the one used last) for the next time one opens. */
export function chooseCamera(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(CHOSEN, JSON.stringify(deviceId));
    else localStorage.removeItem(CHOSEN);
  } catch {
    // Not kept: the camera used last opens, as before.
  }
}

/** The browser's own record of whether this page may use the camera. */
export async function cameraPermission(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "camera" as PermissionName })).state;
  } catch {
    return "unknown"; // Safari and Firefox may not say
  }
}

export interface Camera {
  readonly stream: MediaStream;
  readonly video: HTMLVideoElement;
  readonly deviceId: string;
  readonly width: number;
  readonly height: number;
  stop(): void;
}

/**
 * Opens the user-facing camera at 1280x720 if it offers it - the one chosen
 * in Settings, else preferring the one used last - and plays it into `video`
 * (muted, inline, never shown full size).
 */
export async function openCamera(video: HTMLVideoElement): Promise<Camera> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new CameraError("insecure");
  const last = remembered();
  const chosen = chosenCamera();
  const request = (deviceId?: ConstrainDOMString) =>
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
        facingMode: "user",
        ...(deviceId ? { deviceId } : {}),
      },
    });
  let stream: MediaStream;
  try {
    try {
      stream = await request(chosen ? { exact: chosen } : last ? { ideal: last } : undefined);
    } catch (error) {
      // The chosen camera has gone: the one used last, or any, will do.
      if (!chosen || classifyCameraError(error) !== "missing") throw error;
      stream = await request(last && last !== chosen ? { ideal: last } : undefined);
    }
  } catch (error) {
    throw new CameraError(classifyCameraError(error), error);
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError("missing");
  }
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));
    }
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CameraError("busy", error);
  }
  const deviceId = track.getSettings().deviceId ?? "";
  if (deviceId) remember(deviceId);
  return {
    stream,
    video,
    deviceId: deviceId || "default",
    width: video.videoWidth,
    height: video.videoHeight,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}
