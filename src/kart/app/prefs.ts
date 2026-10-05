/**
 * What Grip Prix remembers between visits, as the arcade's prefs do: a
 * convenience, never a need. A window that stores nothing plays the same,
 * and anything stored that does not look right reads as the default. Keys
 * are versioned and hold JSON.
 */
import { CHARACTERS, characterById } from "../characters";
import { cleanName, defaultName } from "./format";
import type { SoundLevels, Steering } from "./services";

const KEYS = {
  you: "handy.kart.you.v1",
  checked: "handy.kart.checked.v1",
  sound: "handy.kart.sound.v1",
} as const;

/** How a player drives. */
export type Drive = "wheel" | "keyboard" | "gamepad";

export const DRIVES: readonly Drive[] = ["wheel", "keyboard", "gamepad"];
export const STEERINGS: readonly Steering[] = ["gentle", "normal", "quick"];

/** The You screen's answers. */
export interface You {
  name: string;
  drive: Drive;
  steering: Steering;
  /** Two on this camera (wheel only). */
  second: boolean;
  /** The second player's name. */
  secondName: string;
  /** Who drives (characters.ts id), and whether the kart is golden (only once that is unlocked). */
  character: string;
  golden: boolean;
  /** The second player's driver and kart. */
  secondCharacter: string;
  secondGolden: boolean;
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
  const saved = read<Partial<You>>(storage, KEYS.you);
  const name = cleanName(typeof saved?.name === "string" ? saved.name : "", defaultName(random));
  const first = Math.floor((((random % 1) + 1) % 1) * STARTERS.length);
  const you: You = {
    name,
    character: driver(saved?.character, STARTERS[first]!),
    golden: saved?.golden === true,
    // The second driver starts as someone else, a few places along.
    secondCharacter: driver(saved?.secondCharacter, STARTERS[(first + 3) % STARTERS.length]!),
    secondGolden: saved?.secondGolden === true,
    drive: DRIVES.includes(saved?.drive as Drive) ? (saved!.drive as Drive) : "wheel",
    steering: STEERINGS.includes(saved?.steering as Steering) ? (saved!.steering as Steering) : "normal",
    second: saved?.second === true,
    secondName: cleanName(typeof saved?.secondName === "string" ? saved.secondName : "", defaultName((random + 0.37) % 1, [name])),
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
