/**
 * Where a learned aim is kept: in the browser, per camera and per video size,
 * because the hand's sweep in the picture depends on both. Everything kept is
 * a convenience - a window that cannot store anything plays just the same,
 * only without remembering - and anything unreadable is thrown away so the
 * aim check starts fresh rather than trusting it.
 */
import { definedOver, gain, isMatrix, type Matrix } from "../input/homography";

/** The saved aim's format. A later change bumps it, and older saves are ignored. */
export const AIM_VERSION = 1;

/** The most a saved map may magnify a small movement anywhere in the picture
 * (the desktop's gain limit): past that, a camera is too far off to the side. */
export const GAIN_LIMIT = 20;

/** The subset of localStorage the aim needs, so tests can pass their own. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CameraIdentity {
  deviceId: string;
  width: number;
  height: number;
}

export function aimKey(camera: CameraIdentity): string {
  return `handy.aim.v${AIM_VERSION}.${camera.deviceId || "default"}.${camera.width}x${camera.height}`;
}

interface SavedAim {
  version: number;
  matrix: number[];
  savedAt: number;
}

/** Whether a map is one worth playing on: defined across the whole picture,
 * and nowhere stretched beyond sense. */
export function usableMap(matrix: Matrix): boolean {
  if (!definedOver(matrix, [0, 0], [1, 1])) return false;
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 0.5],
  ];
  return corners.every((corner) => gain(matrix, corner) <= GAIN_LIMIT);
}

/** The aim saved for this camera, or null. */
export function loadAim(store: KeyValueStore | null, camera: CameraIdentity): Matrix | null {
  if (!store) return null;
  const key = aimKey(camera);
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null; // storage refused to answer: play without remembering
  }
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as Partial<SavedAim> | null;
    if (saved && saved.version === AIM_VERSION && isMatrix(saved.matrix) && usableMap(saved.matrix)) {
      return saved.matrix;
    }
  } catch {
    // Not JSON: fall through and forget it.
  }
  forget(store, camera);
  return null;
}

/** Keeps the aim for next time; false if this window cannot store anything. */
export function saveAim(store: KeyValueStore | null, camera: CameraIdentity, matrix: Matrix, now = Date.now()): boolean {
  if (!store) return false;
  const saved: SavedAim = { version: AIM_VERSION, matrix: [...matrix], savedAt: now };
  try {
    store.setItem(aimKey(camera), JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function forget(store: KeyValueStore | null, camera: CameraIdentity): void {
  try {
    store?.removeItem(aimKey(camera));
  } catch {
    // Without storage there is nothing saved to forget.
  }
}

/** localStorage where the browser allows it; some private windows throw on
 * the mere mention of it. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
