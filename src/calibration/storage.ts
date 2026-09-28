/**
 * Where a learned aim is kept: in the browser, per camera and per video size,
 * because the hand's sweep in the picture depends on both - and per game,
 * since each game checks the aim in its own world, on a stage of its own
 * shape. A game with no aim of its own yet starts from the camera's latest
 * (any game's), measured from the first shot like any saved aim, so a
 * player who has set up once is ready in three shots everywhere. Everything
 * kept is a convenience - a window that cannot store anything plays just the
 * same, only without remembering - and anything unreadable is thrown away so
 * the aim check starts fresh rather than trusting it.
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

/** The key an aim is kept under: the camera's latest, or one game's own. */
export function aimKey(camera: CameraIdentity, game?: string): string {
  const key = `handy.aim.v${AIM_VERSION}.${camera.deviceId || "default"}.${camera.width}x${camera.height}`;
  return game ? `${key}.${game}` : key;
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

/**
 * The aim saved for this camera in this game, else the camera's latest from
 * any game (or, without a game, the camera's latest); null for none.
 */
export function loadAim(store: KeyValueStore | null, camera: CameraIdentity, game?: string): Matrix | null {
  return (game ? readAim(store, aimKey(camera, game)) : null) ?? readAim(store, aimKey(camera));
}

function readAim(store: KeyValueStore | null, key: string): Matrix | null {
  if (!store) return null;
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
  forget(store, key);
  return null;
}

/**
 * Keeps the aim for next time, as this game's own (with a game) and as the
 * camera's latest; false if this window cannot store anything.
 */
export function saveAim(store: KeyValueStore | null, camera: CameraIdentity, matrix: Matrix, now = Date.now(), game?: string): boolean {
  if (!store) return false;
  const saved = JSON.stringify({ version: AIM_VERSION, matrix: [...matrix], savedAt: now } satisfies SavedAim);
  try {
    if (game) store.setItem(aimKey(camera, game), saved);
    store.setItem(aimKey(camera), saved);
    return true;
  } catch {
    return false;
  }
}

function forget(store: KeyValueStore | null, key: string): void {
  try {
    store?.removeItem(key);
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
