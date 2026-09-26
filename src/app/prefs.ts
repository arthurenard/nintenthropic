/**
 * What the page remembers between visits. Everything kept is a convenience:
 * a window that cannot store anything plays just the same, only without
 * remembering.
 */
import type { InputKind } from "../engine/types";

const KEYS = {
  welcomed: "handy.welcomed.v1",
  muted: "handy.muted.v1",
  control: "handy.control.v1",
  cameraOpened: "handy.camera-opened.v1",
  downloaded: "handy.downloaded.v1",
  best: (game: string) => `handy.best.v1.${game}`,
  unlocks: "handy.unlocks.v1",
};

function read<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const local = (): Storage | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};
const session = (): Storage | undefined => {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
};

export const prefs = {
  get welcomed(): boolean {
    return read<boolean>(local(), KEYS.welcomed) === true;
  },
  set welcomed(value: boolean) {
    write(local(), KEYS.welcomed, value);
  },
  get muted(): boolean {
    return read<boolean>(local(), KEYS.muted) === true;
  },
  set muted(value: boolean) {
    write(local(), KEYS.muted, value);
  },
  /** The hand or the mouse, as last chosen; touch screens are asked afresh. */
  get control(): Exclude<InputKind, "touch"> {
    return read<string>(local(), KEYS.control) === "mouse" ? "mouse" : "hand";
  },
  set control(value: Exclude<InputKind, "touch">) {
    write(local(), KEYS.control, value);
  },
  /** The camera has opened on this page before: where the browser will not
   * say whether it is allowed (Safari), that is taken as a yes. */
  get cameraOpened(): boolean {
    return read<boolean>(local(), KEYS.cameraOpened) === true;
  },
  set cameraOpened(value: boolean) {
    write(local(), KEYS.cameraOpened, value);
  },
  /** The tracker's files have downloaded here once (the browser keeps them). */
  get downloaded(): boolean {
    return read<boolean>(local(), KEYS.downloaded) === true;
  },
  set downloaded(value: boolean) {
    write(local(), KEYS.downloaded, value);
  },
  /** Unlocks last for the visit (the Golden Revolver is "for the session"). */
  get unlocks(): Set<string> {
    const saved = read<string[]>(session(), KEYS.unlocks);
    return new Set(Array.isArray(saved) ? saved.filter((v) => typeof v === "string") : []);
  },
  set unlocks(value: Set<string>) {
    write(session(), KEYS.unlocks, [...value]);
  },
};

export function readBest(game: string): number | null {
  const best = read<number>(local(), KEYS.best(game));
  return typeof best === "number" && Number.isFinite(best) ? best : null;
}

export function writeBest(game: string, score: number): void {
  write(local(), KEYS.best(game), score);
}
