/**
 * Switch Camera: the next camera at once. The one in use is let go first, the
 * new one is remembered as the player's choice (so Settings shows it and the
 * next visit opens it), and if it will not open the one that was in use comes
 * back, so the player is never left without a picture they had a moment ago.
 * What the app does with the result - the toast, a new aim check - is its own.
 */
import { CameraError, cameraName, nextCamera, type CameraInfo, type CameraTrouble } from "../tracking/camera";

/** What switching needs from the app, so the steps can be tested without a browser. */
export interface SwitchHost {
  /** The cameras the browser lists now. */
  cameras(): Promise<CameraInfo[]>;
  /** The device in use (null: none). */
  inUse(): string | null;
  /** Lets the camera in use go, at once. */
  release(): void;
  /** Opens the camera chosen (a chosen camera that has gone gives way to another) and says which one opened. */
  open(): Promise<string>;
  /** Remembers the player's choice of camera. */
  choose(deviceId: string): void;
}

export type SwitchResult =
  /** Fewer than two cameras: nothing was touched. */
  | { kind: "none" }
  /** The camera now in use (the next, or the one that took its place if it had gone). */
  | { kind: "switched"; camera: CameraInfo }
  /** The next camera would not open, so the one before is back. */
  | { kind: "kept"; camera: CameraInfo; wanted: CameraInfo; trouble: CameraTrouble }
  /** Neither would open: there is no camera now. */
  | { kind: "failed"; trouble: CameraTrouble };

const troubleOf = (error: unknown): CameraTrouble => (error instanceof CameraError ? error.trouble : "busy");

export async function switchCamera(host: SwitchHost): Promise<SwitchResult> {
  const cameras = await host.cameras();
  const before = host.inUse();
  const next = nextCamera(cameras, before);
  if (!next) return { kind: "none" };
  // Every camera has a name to say, even one the browser has not named.
  const named = (deviceId: string): CameraInfo => ({ deviceId, label: cameraName(cameras, deviceId) });

  const remember = (deviceId: string) => {
    if (cameras.some((camera) => camera.deviceId === deviceId)) host.choose(deviceId);
  };

  host.release();
  host.choose(next.deviceId);
  let opened: string;
  try {
    opened = await host.open();
  } catch (error) {
    // The next camera would not open (another app has it): back to the last one.
    const trouble = troubleOf(error);
    const back = before && cameras.some((camera) => camera.deviceId === before) ? before : null;
    if (!back) return { kind: "failed", trouble };
    host.choose(back);
    try {
      opened = await host.open();
    } catch (again) {
      return { kind: "failed", trouble: troubleOf(again) };
    }
    remember(opened);
    return { kind: "kept", camera: named(opened), wanted: named(next.deviceId), trouble };
  }
  // What opened is the choice, whichever it was, so Settings and the next visit agree.
  remember(opened);
  return { kind: "switched", camera: named(opened) };
}
