/**
 * What the page remembers between visits. Everything kept is a convenience:
 * a window that cannot store anything plays just the same, only without
 * remembering. Every key is versioned and holds JSON; every read is checked,
 * and anything that does not look right is read as the default.
 */
import type { Difficulty, InputKind } from "../engine/types";
import { DEFAULT_STEADINESS, STEADINESS, type Steadiness } from "../input/aim";
import type { EyeProfile } from "../input/scope";
import type { CrosshairStyle } from "./crosshair";

const KEYS = {
  welcomed: "handy.welcomed.v1",
  muted: "handy.muted.v1",
  control: "handy.control.v1",
  cameraOpened: "handy.camera-opened.v1",
  downloaded: "handy.downloaded.v1",
  unlocks: "handy.unlocks.v1",
  settings: "handy.settings.v1",
  tipsSeen: "handy.tips-seen.v1",
  game: "handy.game.v1",
  scope: "handy.scope.v1",
  eye: "handy.eye.v1",
};

/** Everything Handy keeps starts with this, in both storages. */
const PREFIX = "handy.";
/** A saved aim, one per camera and video size (see calibration/storage.ts). */
const AIM_PREFIX = "handy.aim.";

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
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const local = (): Storage | undefined => {
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
  /** The game chosen in the arcade last, by id (it may since have left the arcade: the caller checks). */
  get game(): string | null {
    const id = read<string>(local(), KEYS.game);
    return typeof id === "string" ? id : null;
  },
  set game(value: string | null) {
    write(local(), KEYS.game, value);
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

// --- the Settings sheet's choices ----------------------------------------------------------

export interface Preferences {
  /** The master volume, 0..1 as the slider sets it; mute is apart from it. */
  volume: number;
  difficulty: Difficulty;
  crosshair: CrosshairStyle;
  steadiness: Steadiness;
  /**
   * Targets easier to hit and to find. Every game but Overwatch Ridge widens
   * its shots; Ridge's stay exact (it is precision by design) and the switch
   * only marks the men to find. Games read it live as `Settings.aimAssist`.
   */
  aimAssist: boolean;
  /** The camera's picture in the corner during play (the aim setup always shows it). */
  cameraInPlay: boolean;
  /** The player's choice, or null to follow the system's reduced-motion setting. */
  reduceMotion: boolean | null;
  reduceFlashing: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  volume: 1,
  difficulty: "standard",
  crosshair: Object.freeze({ size: "standard", highContrast: false }),
  steadiness: DEFAULT_STEADINESS,
  aimAssist: true,
  cameraInPlay: true,
  reduceMotion: null,
  reduceFlashing: false,
});

/**
 * The revision the settings are saved at, written with them. Revision 2 made
 * Steady the default Aim Steadiness (it was Balanced) and added Aim Assist.
 *
 * Settings saved before it carry no revision, and every one of them holds
 * the whole sheet, Balanced included, whether the player ever chose it or
 * not: that Balanced was the old default, so it reads as the new one. Anything
 * saved from revision 2 on is kept as it is, so a Balanced chosen after the
 * move stays Balanced. The migration is a read, not a write: it leaves the
 * stored value alone until the player next changes a setting.
 */
export const SETTINGS_REVISION = 2;

const DIFFICULTIES: readonly Difficulty[] = ["relaxed", "standard"];
const SIZES: readonly CrosshairStyle["size"][] = ["standard", "large"];
const STEADINESSES = Object.keys(STEADINESS) as Steadiness[];

function oneOf<T>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/** The player's settings, each one checked on its own: one bad value costs only itself. */
export function loadPreferences(storage: Storage | undefined = local()): Preferences {
  const saved = read<Record<string, unknown>>(storage, KEYS.settings);
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const defaults = DEFAULT_PREFERENCES;
  const crosshair = raw.crosshair && typeof raw.crosshair === "object" ? (raw.crosshair as Record<string, unknown>) : {};
  const volume = raw.volume;
  const revision = typeof raw.revision === "number" && Number.isFinite(raw.revision) ? raw.revision : 1;
  let steadiness = oneOf(raw.steadiness, STEADINESSES, defaults.steadiness);
  // Before revision 2 a saved Balanced was only the old default: Steady now.
  if (revision < SETTINGS_REVISION && steadiness === "balanced") steadiness = DEFAULT_STEADINESS;
  return {
    volume: typeof volume === "number" && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : defaults.volume,
    difficulty: oneOf(raw.difficulty, DIFFICULTIES, defaults.difficulty),
    crosshair: {
      size: oneOf(crosshair.size, SIZES, defaults.crosshair.size),
      highContrast: flag(crosshair.highContrast, defaults.crosshair.highContrast),
    },
    steadiness,
    aimAssist: flag(raw.aimAssist, defaults.aimAssist),
    cameraInPlay: flag(raw.cameraInPlay, defaults.cameraInPlay),
    reduceMotion: typeof raw.reduceMotion === "boolean" ? raw.reduceMotion : defaults.reduceMotion,
    reduceFlashing: flag(raw.reduceFlashing, defaults.reduceFlashing),
  };
}

/** Keeps the settings for next time; false if this window cannot store anything. */
export function savePreferences(value: Preferences, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.settings, { ...value, revision: SETTINGS_REVISION });
}

// --- the scope's choices ---------------------------------------------------------------------

/**
 * How the player looks through a scope, in the games that have one (the
 * Settings sheet's Scope group, shown only while such a game exists): kept
 * apart from the rest, as they belong to those games alone.
 */
export interface ScopePreferences {
  /** Close One Eye to Scope: with the hand, in a game that reads the eye. */
  eye: boolean;
  /** Shift, the right mouse button and the touch screen's Scope button: held, or pressed once to scope and again to stop. */
  button: "hold" | "toggle";
}

export const DEFAULT_SCOPE: Readonly<ScopePreferences> = Object.freeze({ eye: true, button: "hold" });

export function loadScopePreferences(storage: Storage | undefined = local()): ScopePreferences {
  const saved = read<Record<string, unknown>>(storage, KEYS.scope);
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  return { eye: flag(raw.eye, DEFAULT_SCOPE.eye), button: oneOf(raw.button, ["hold", "toggle"] as const, DEFAULT_SCOPE.button) };
}

export function saveScopePreferences(value: ScopePreferences, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.scope, value);
}

/**
 * What this player's eyes read (open, and one shut), as learned from their
 * own winks, so that the scope fits them from the first shot next time (see
 * input/scope.ts). Null until one has been learned, or when what is kept
 * does not look right.
 */
export function loadEyeProfile(storage: Storage | undefined = local()): EyeProfile | null {
  const saved = read<Record<string, unknown>>(storage, KEYS.eye);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const { open, closed } = saved;
  if (typeof open !== "number" || typeof closed !== "number" || !Number.isFinite(open) || !Number.isFinite(closed)) return null;
  return { open: Math.min(0.45, Math.max(0, open)), closed: Math.min(1, Math.max(0.3, closed)) };
}

export function saveEyeProfile(value: EyeProfile, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.eye, value);
}

// --- one-time tips ------------------------------------------------------------------------------

/**
 * A set of strings that keeps itself: every change is written through at
 * once, so nothing is lost if the tab closes. The one-time tips a player has
 * seen live in one (Settings.tipsSeen), which the game adds to.
 */
export class PersistentSet extends Set<string> {
  private readonly key: string;
  private readonly storage: () => Storage | undefined;

  constructor(key: string, storage: () => Storage | undefined = local) {
    super();
    this.key = key;
    this.storage = storage;
    const saved = read<unknown>(storage(), key);
    if (Array.isArray(saved)) for (const item of saved) if (typeof item === "string") super.add(item);
  }

  override add(value: string): this {
    if (this.has(value)) return this;
    super.add(value);
    this.save();
    return this;
  }

  override delete(value: string): boolean {
    const had = super.delete(value);
    if (had) this.save();
    return had;
  }

  override clear(): void {
    super.clear();
    this.save();
  }

  /** Forgets what is in memory only (the storage was cleared as a whole). */
  forgetInMemory(): void {
    super.clear();
  }

  private save(): void {
    write(this.storage(), this.key, [...this]);
  }
}

export const tipsSeen = (storage: () => Storage | undefined = local): PersistentSet => new PersistentSet(KEYS.tipsSeen, storage);

// --- personal records -------------------------------------------------------------------------

/** Records are kept apart for the hand and for a pointer, which is far easier to aim. */
export type ControlClass = "hand" | "pointer";

export const controlClass = (kind: InputKind): ControlClass => (kind === "hand" ? "hand" : "pointer");

/** A personal best: the score, how the round ended, and when (ms since 1970). */
export interface Best {
  score: number;
  outcome: string;
  at: number;
}

export function bestKey(game: string, difficulty: Difficulty, control: ControlClass): string {
  return `handy.best.v2.${game}.${difficulty}.${control}`;
}

export function readBest(game: string, difficulty: Difficulty, control: ControlClass, storage: Storage | undefined = local()): Best | null {
  const saved = read<Partial<Best>>(storage, bestKey(game, difficulty, control));
  if (!saved || typeof saved !== "object") return null;
  const { score, outcome, at } = saved;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) return null;
  return {
    score,
    outcome: typeof outcome === "string" ? outcome : "",
    at: typeof at === "number" && Number.isFinite(at) ? at : 0,
  };
}

export function writeBest(game: string, difficulty: Difficulty, control: ControlClass, best: Best, storage: Storage | undefined = local()): boolean {
  return write(storage, bestKey(game, difficulty, control), best);
}

/** A round weighed against the best before it. */
export interface Verdict {
  /** This round is the new best. */
  best: boolean;
  /** The best before this round, if there was one. */
  previous: Best | null;
}

/** A score is a new best when it scores at all and beats the one before, if any. */
export function judge(score: number, previous: Best | null): Verdict {
  return { best: score > 0 && (previous === null || score > previous.score), previous };
}

// --- forgetting ------------------------------------------------------------------------------------

function keysOf(storage: Storage | undefined, prefix: string): string[] {
  const keys: string[] = [];
  try {
    if (!storage) return keys;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // no storage: nothing kept
  }
  return keys;
}

function remove(storage: Storage | undefined, keys: string[]): void {
  for (const key of keys) {
    try {
      storage?.removeItem(key);
    } catch {
      // nothing to do: it could not have been kept either
    }
  }
}

/** Is any aim saved in this browser? (Which camera it is for is known only once one opens.) */
export function hasSavedAim(storage: Storage | undefined = local()): boolean {
  return keysOf(storage, AIM_PREFIX).length > 0;
}

/** Forgets every saved aim, for every camera; says how many there were. */
export function forgetSavedAims(storage: Storage | undefined = local()): number {
  const keys = keysOf(storage, AIM_PREFIX);
  remove(storage, keys);
  return keys.length;
}

/** Forgets everything Handy keeps in this browser: aims, records, settings, tips, the lot. */
export function forgetEverything(storages: (Storage | undefined)[] = [local(), session()]): void {
  for (const storage of storages) remove(storage, keysOf(storage, PREFIX));
}
