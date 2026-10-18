/**
 * What Grip Prix remembers between visits, as the arcade's prefs do: a
 * convenience, never a need. A window that stores nothing plays the same,
 * and anything stored that does not look right reads as the default. Keys
 * are versioned and hold JSON.
 */
import { CHARACTERS, characterById } from "../characters";
import { TIERS, lowerTier, type Tier } from "../render/quality";
import { cleanName, defaultName } from "./format";
import type { SoundLevels, Steering } from "./services";

const KEYS = {
  you: "handy.kart.you.v1",
  checked: "handy.kart.checked.v1",
  sound: "handy.kart.sound.v1",
  graphics: "handy.kart.graphics.v1",
  ceiling: "handy.kart.ceiling.v1",
  fps: "handy.kart.fps.v1",
} as const;

/** How a player drives. */
export type Drive = "wheel" | "keyboard" | "gamepad";

export const DRIVES: readonly Drive[] = ["wheel", "keyboard", "gamepad"];
export const STEERINGS: readonly Steering[] = ["gentle", "normal", "quick"];

/** Players who can share one camera (the room holds four). */
export const MAX_ON_CAMERA = 4;

/** A friend sharing the camera: their name, driver and kart. */
export interface Mate {
  name: string;
  character: string;
  golden: boolean;
}

/** The You screen's answers. */
export interface You {
  name: string;
  drive: Drive;
  steering: Steering;
  /** Who drives (characters.ts id), and whether the kart is golden (only once that is unlocked). */
  character: string;
  golden: boolean;
  /** Players on this camera, 1 to 4 (wheel only): you, then the first of `mates`, and so on. */
  players: 1 | 2 | 3 | 4;
  /** The second, third and fourth players, always three kept so choosing more players brings back who they were. */
  mates: Mate[];
}

/** How many players this You brings to the room: the camera's, or one for the keyboard and the pad. */
export function playerCount(you: Pick<You, "drive" | "players">): 1 | 2 | 3 | 4 {
  return you.drive === "wheel" ? you.players : 1;
}

/** The players of this device, in seat order: you, then your mates as far as `playerCount`. */
export function crew(you: You): Mate[] {
  return [{ name: you.name, character: you.character, golden: you.golden }, ...you.mates].slice(0, playerCount(you));
}

/** The drivers anyone can pick from the start (a first-time player is given one of these). */
export const STARTERS: readonly string[] = CHARACTERS.filter((c) => !c.unlock).map((c) => c.id);

const driver = (saved: unknown, fallback: string): string => (typeof saved === "string" && characterById(saved) ? saved : fallback);

const local = (): Storage | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
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
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * The player as remembered, else a first-time player: a friendly default
 * name (picked by `random`, 0..1), driving with the wheel. The default is
 * kept at once, so the name a player sees today is the one they see tomorrow.
 */
export function loadYou(random = Math.random(), storage: Storage | undefined = local()): You {
  // What the first version kept for a second player (`second`, `secondName`...) still reads.
  const saved = read<Partial<You> & { second?: unknown; secondName?: unknown; secondCharacter?: unknown; secondGolden?: unknown }>(storage, KEYS.you);
  const name = cleanName(typeof saved?.name === "string" ? saved.name : "", defaultName(random));
  const first = Math.floor((((random % 1) + 1) % 1) * STARTERS.length);
  const kept: Partial<Mate>[] = Array.isArray(saved?.mates) ? saved.mates : [];
  const old: Partial<Mate> = { name: saved?.secondName as string | undefined, character: saved?.secondCharacter as string | undefined, golden: saved?.secondGolden === true };
  const taken = [name];
  const mates: Mate[] = [0, 1, 2].map((i) => {
    const mate = kept[i] ?? (i === 0 ? old : {});
    // Each friend starts as someone else, a few places further along the drivers and the names.
    const mateName = cleanName(typeof mate.name === "string" ? mate.name : "", defaultName((random + 0.37 * (i + 1)) % 1, taken));
    taken.push(mateName);
    return {
      name: mateName,
      character: driver(mate.character, STARTERS[(first + 3 * (i + 1)) % STARTERS.length]!),
      golden: mate.golden === true,
    };
  });
  const asked = typeof saved?.players === "number" ? Math.round(saved.players) : saved?.second === true ? 2 : 1;
  const you: You = {
    name,
    character: driver(saved?.character, STARTERS[first]!),
    golden: saved?.golden === true,
    drive: DRIVES.includes(saved?.drive as Drive) ? (saved!.drive as Drive) : "wheel",
    steering: STEERINGS.includes(saved?.steering as Steering) ? (saved!.steering as Steering) : "normal",
    players: Math.min(MAX_ON_CAMERA, Math.max(1, asked)) as You["players"],
    mates,
  };
  if (!saved) saveYou(you, storage);
  return you;
}

export function saveYou(you: You, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.you, you);
}

/** This player has been through the whole wheel check before: next time, only "Hold it level". */
export function wheelChecked(storage: Storage | undefined = local()): boolean {
  return read<boolean>(storage, KEYS.checked) === true;
}

export function setWheelChecked(storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.checked, true);
}

/** The music rests a little under the effects, so the engines are heard over the tune. */
export const DEFAULT_LEVELS: Readonly<SoundLevels> = { music: 0.8, effects: 1 };

const level = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

/** The Music and Effects sliders as the player left them (each checked on its own). */
export function loadLevels(storage: Storage | undefined = local()): SoundLevels {
  const saved = read<Partial<SoundLevels>>(storage, KEYS.sound);
  return { music: level(saved?.music, DEFAULT_LEVELS.music), effects: level(saved?.effects, DEFAULT_LEVELS.effects) };
}

export function saveLevels(levels: SoundLevels, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.sound, levels);
}

/** The quality tiers the renderer draws in (render/quality.ts), lowest first. */
export const TIER_NAMES = TIERS;
export type TierName = Tier;

/** The Graphics setting: "auto" lets the game pick for the device, the others hold a tier. */
export type Graphics = "auto" | TierName;
export const GRAPHICS: readonly Graphics[] = ["auto", ...TIER_NAMES];

const isTier = (value: unknown): value is TierName => TIER_NAMES.includes(value as TierName);

/** The Graphics setting as the player left it ("auto" until they choose). */
export function loadGraphics(storage: Storage | undefined = local()): Graphics {
  const saved = read<unknown>(storage, KEYS.graphics);
  return saved === "auto" || isTier(saved) ? saved : "auto";
}

/**
 * Keeps the Graphics setting. Choosing again, whatever the choice, forgets the
 * ceiling the safety net set (below): "Auto" then looks at the device afresh.
 */
export function saveGraphics(choice: Graphics, storage: Storage | undefined = local()): boolean {
  clearCeiling(storage);
  return write(storage, KEYS.graphics, choice);
}

/**
 * The safety net's memory: the highest tier "Auto" may use on this device,
 * set when a race could not keep up (see render/renderer.ts, onStrain, and
 * `noteStrain` below). Null when nothing has gone wrong, or when it was set
 * long enough ago that the device may have changed (a laptop on battery then
 * on the mains, a new driver): `CEILING_DAYS`.
 */
export function loadCeiling(storage: Storage | undefined = local(), now = Date.now()): TierName | null {
  return ceilingRecord(storage, now)?.tier ?? null;
}

/** How long the safety net remembers anything before Auto tries the device's own tier again. */
export const CEILING_DAYS = 14;

export function saveCeiling(tier: TierName, storage: Storage | undefined = local(), now = Date.now()): boolean {
  return write(storage, KEYS.ceiling, { tier, at: now });
}

/**
 * What the safety net keeps. `trial`: the ceiling was set when a race at
 * `trial.tier` strained with frames of `trial.interval` ms, and has not yet
 * shown that it makes them quicker. `held`: frames this long were found to be
 * no quicker a tier lower (a browser holding the page to 30 fps to save the
 * battery), so a race straining at that pace is left alone.
 */
interface CeilingRecord {
  tier?: TierName;
  at: number;
  trial?: { tier: TierName; interval: number };
  held?: number;
}

/** A ceiling on trial is kept only if the race under it ran frames at least this much quicker. */
const QUICKER = 0.9;
/** Frames within this band of a pace found no quicker a tier lower are that pace again. */
const SAME_PACE: readonly [number, number] = [0.8, 1.25];

const isInterval = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function ceilingRecord(storage: Storage | undefined, now: number): CeilingRecord | null {
  const saved = read<{ tier?: unknown; at?: unknown; trial?: { tier?: unknown; interval?: unknown }; held?: unknown }>(storage, KEYS.ceiling);
  if (!saved || typeof saved !== "object" || typeof saved.at !== "number" || now - saved.at >= CEILING_DAYS * 86_400_000) return null;
  const record: CeilingRecord = { at: saved.at };
  if (isTier(saved.tier)) record.tier = saved.tier;
  const trial = saved.trial;
  if (record.tier && trial && isTier(trial.tier) && isInterval(trial.interval)) record.trial = { tier: trial.tier, interval: trial.interval };
  if (isInterval(saved.held)) record.held = saved.held;
  return record.tier || record.held !== undefined ? record : null;
}

/**
 * The safety net's answer to a race that strained at `tier` with frames of
 * `interval` ms; returns the ceiling Auto has now. Usually that is the tier
 * below, on trial. A tier below that was tried and ran no quicker was not what
 * held the frames back: it is undone, and the pace is remembered, so a strain
 * at that pace changes nothing.
 */
export function noteStrain(tier: TierName, interval: number, storage: Storage | undefined = local(), now = Date.now()): TierName | null {
  const saved = ceilingRecord(storage, now);
  if (saved?.trial && saved.tier === tier && interval > saved.trial.interval * QUICKER) {
    write(storage, KEYS.ceiling, { tier: saved.trial.tier, at: now, held: saved.trial.interval });
    return saved.trial.tier;
  }
  if (saved?.held !== undefined && interval > saved.held * SAME_PACE[0] && interval < saved.held * SAME_PACE[1]) return saved.tier ?? null;
  const lower = lowerTier(tier);
  if (!lower) return saved?.tier ?? null;
  write(storage, KEYS.ceiling, { tier: lower, at: now, trial: { tier, interval } });
  return lower;
}

/** A race at `tier` kept up: a ceiling on trial there has shown it helps, and stays as it is. */
export function noteKeptUp(tier: TierName, storage: Storage | undefined = local(), now = Date.now()): void {
  const saved = ceilingRecord(storage, now);
  if (saved?.trial && saved.tier === tier) write(storage, KEYS.ceiling, { tier: saved.tier, at: saved.at });
}

export function clearCeiling(storage: Storage | undefined = local()): void {
  try {
    storage?.removeItem(KEYS.ceiling);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** The small frame-rate readout in a corner of the race (off until the player turns it on). */
export function loadFpsReadout(storage: Storage | undefined = local()): boolean {
  return read<unknown>(storage, KEYS.fps) === true;
}

export function saveFpsReadout(on: boolean, storage: Storage | undefined = local()): boolean {
  return write(storage, KEYS.fps, on);
}
