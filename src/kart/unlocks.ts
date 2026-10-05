/**
 * What this device has unlocked in Grip Prix, kept in localStorage: the
 * ducks found (one per track), the cups won, and what they open.
 *
 * - Every duck found → Dabble, the duck driver.
 * - Both cups won (first place) → the secret track, Five Finger Circuit.
 * - The Konami code on the start screen → a golden kart (and the secret
 *   track too, for those who know).
 *
 * It is the host's unlocks that decide which tracks the room can race; each
 * player's own decide their driver and their kart's paint.
 */

export type UnlockId = "duck-driver" | "secret-track" | "golden";

export interface Unlocks {
  /** Track ids whose duck this device's players have driven into. */
  ducks: string[];
  /** Cup ids won in first place. */
  cups: string[];
  /** The Konami code was entered. */
  konami: boolean;
}

const KEY = "grip-prix.unlocks";

function blank(): Unlocks {
  return { ducks: [], cups: [], konami: false };
}

export function loadUnlocks(): Unlocks {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw) as Partial<Unlocks>;
    return {
      ducks: Array.isArray(parsed.ducks) ? parsed.ducks.filter((d): d is string => typeof d === "string") : [],
      cups: Array.isArray(parsed.cups) ? parsed.cups.filter((c): c is string => typeof c === "string") : [],
      konami: parsed.konami === true,
    };
  } catch {
    return blank();
  }
}

function save(unlocks: Unlocks): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(unlocks));
  } catch {
    // Private windows and blocked storage: unlocks last the visit.
  }
}

/** Is `id` open, given every track with a duck and every cup? */
export function isUnlocked(id: UnlockId, unlocks: Unlocks, all: { duckTracks: readonly string[]; cups: readonly string[] }): boolean {
  switch (id) {
    case "duck-driver":
      return all.duckTracks.length > 0 && all.duckTracks.every((t) => unlocks.ducks.includes(t));
    case "secret-track":
      return unlocks.konami || (all.cups.length > 0 && all.cups.every((c) => unlocks.cups.includes(c)));
    case "golden":
      return unlocks.konami;
  }
}

/** Records a duck found on `track`; true when it is the first time. */
export function foundDuck(track: string): boolean {
  const u = loadUnlocks();
  if (u.ducks.includes(track)) return false;
  u.ducks.push(track);
  save(u);
  return true;
}

/** Records a cup won; true when it is the first time. */
export function wonCup(cup: string): boolean {
  const u = loadUnlocks();
  if (u.cups.includes(cup)) return false;
  u.cups.push(cup);
  save(u);
  return true;
}

/** The Konami code: true when it is the first time. */
export function enterKonami(): boolean {
  const u = loadUnlocks();
  if (u.konami) return false;
  u.konami = true;
  save(u);
  return true;
}
