/**
 * The screens' side of Grip Prix's small delights, as plain functions so the
 * words and the rules are tested without a page:
 *
 *   - the Konami code (keys, or a gamepad's d-pad then B and A)
 *   - the duck found: what the toast says, and what it unlocks
 *   - the photo finish: two karts over the line together for a top-three place
 *   - the tricks a driver can be told about, by how they drive
 */
import type { DriverControl, RaceResult } from "../contract";
import { loadUnlocks, foundDuck } from "../unlocks";
import { TRACKS } from "../track/tracks";

// ─── The Konami code ─────────────────────────────────────────────────────────

/** Up, up, down, down, left, right, left, right, B, A. */
export const KONAMI = ["up", "up", "down", "down", "left", "right", "left", "right", "b", "a"] as const;

export type KonamiKey = (typeof KONAMI)[number];

/** A key's `code`, as the code knows it, or null for any other key. */
export function konamiKey(code: string): KonamiKey | null {
  switch (code) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "KeyB":
      return "b";
    case "KeyA":
      return "a";
    default:
      return null;
  }
}

/**
 * Watches a stream of presses for the code: the last ten, in order and
 * unbroken (any other key starts it over), so a stray extra "up" on the way
 * in does not spoil it.
 */
export class KonamiDetector {
  private recent: KonamiKey[] = [];

  /** True on the press that finishes the code. */
  press(key: KonamiKey | null): boolean {
    if (key === null) {
      this.recent = [];
      return false;
    }
    this.recent.push(key);
    if (this.recent.length > KONAMI.length) this.recent.shift();
    if (this.recent.length === KONAMI.length && this.recent.every((pressed, i) => pressed === KONAMI[i])) {
      this.recent = [];
      return true;
    }
    return false;
  }

  reset(): void {
    this.recent = [];
  }
}

/** The standard layout's d-pad and face buttons: B is the right-hand one, A the bottom one. */
const PAD_BUTTONS: readonly [number, KonamiKey][] = [
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
  [1, "b"],
  [0, "a"],
];

/** The presses a gamepad made since the last look (`was` keeps what was down), in the order of the code's keys. */
export function padPresses(pad: Pick<Gamepad, "buttons"> | null | undefined, was: Set<KonamiKey>): KonamiKey[] {
  const pressed: KonamiKey[] = [];
  const down = new Set<KonamiKey>();
  if (pad) {
    for (const [index, key] of PAD_BUTTONS) {
      if (!pad.buttons[index]?.pressed) continue;
      down.add(key);
      if (!was.has(key)) pressed.push(key);
    }
  }
  was.clear();
  for (const key of down) was.add(key);
  return pressed;
}

// ─── The duck ────────────────────────────────────────────────────────────────

/** Every track with a duck (the secret one too). */
export const duckTracks = (): string[] => TRACKS.filter((track) => track.duck).map((track) => track.id);

/**
 * A duck was found on `track` by one of this device's players. The words for
 * the toast the first time, or null if that duck was already theirs.
 */
export function recordDuck(track: string): string | null {
  if (!foundDuck(track)) return null;
  const all = duckTracks();
  const found = all.filter((id) => loadUnlocks().ducks.includes(id)).length;
  return found >= all.length ? "You found every duck — Dabble joins the race!" : `Duck found! ${found} of ${all.length}`;
}

// ─── The photo finish ────────────────────────────────────────────────────────

/** Two karts this close to each other over the line, seconds, are a photo finish. */
export const PHOTO_GAP = 0.15;

export interface PhotoFinish {
  /** The kart ahead, and the one just behind it. */
  ahead: number;
  behind: number;
  /** The place they were fighting for (the better of the two). */
  place: number;
  /** How far apart they crossed, seconds. */
  gap: number;
}

/** The closest finish for a place in the top three that was within a PHOTO_GAP, or null. */
export function photoFinish(standings: RaceResult["standings"]): PhotoFinish | null {
  const done = standings.filter((row) => row.time !== null).sort((a, b) => a.place - b.place);
  let best: PhotoFinish | null = null;
  for (let i = 0; i + 1 < done.length; i++) {
    const a = done[i]!;
    const b = done[i + 1]!;
    if (a.place > 3 || b.place !== a.place + 1) continue;
    const gap = b.time! - a.time!;
    if (gap < 0 || gap > PHOTO_GAP) continue;
    if (!best || gap < best.gap) best = { ahead: a.kart, behind: b.kart, place: a.place, gap };
  }
  return best;
}

// ─── The tricks ──────────────────────────────────────────────────────────────

/** What a driver can try, by what they drive with. */
export function tricksFor(kind: DriverControl["kind"]): string[] {
  switch (kind) {
    case "wheel":
      return ["Clap to honk.", "Raise both hands to cheer.", "Wave hello."];
    case "keyboard":
      return ["Press H to honk.", "Hold C to cheer.", "Hold V to wave."];
    case "gamepad":
      return ["Press Y to honk."];
  }
}

// ─── The tips on the loading screen ──────────────────────────────────────────

/** A line to read while a race loads, by what the player drives with: how to do the one thing they will want to know. */
export function tipsFor(kind: DriverControl["kind"] | null): string[] {
  switch (kind) {
    case "keyboard":
      return ["Hold Space to drift, and let go to boost.", "Press E or Shift to use an item.", "Press H to honk.", "Tap Down to brake, hold it to reverse."];
    case "gamepad":
      return ["Hold A to drift, and let go to boost.", "Press B or X to use an item.", "Press Y to honk.", "The right trigger goes, the left one stops."];
    default:
      return ["Open both hands to brake.", "Flick one hand to use an item.", "Hop to drift.", "Clap to honk."];
  }
}
