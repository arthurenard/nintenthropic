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
import { MIRROR_SUFFIX } from "../track/mirror";
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

/** What each track's duck is up to where it hides (tracks.ts says where), for the toast that finds it. */
const DUCK_LINES: Record<string, string> = {
  "meadow-loop": "Paddling in the pond.",
  "kitchen-rally": "Fished out of the sink.",
  "harbour-lights": "Minding the lighthouse.",
  "canyon-run": "Keeping cool by the water tower.",
  "fun-fair": "Hooked.",
  "glacier-pass": "Ice fishing.",
  "volcano-rush": "Taking the waters.",
  "starlight-ribbon": "In a space helmet. Bold.",
  "five-finger-circuit": "Sunbathing.",
};

/**
 * A duck was found on `track` (a race's track id: a mirrored track's duck is
 * the same duck) by one of this device's players. The words for the toast
 * the first time, or null if that duck was already theirs.
 */
export function recordDuck(track: string): string | null {
  const id = track.endsWith(MIRROR_SUFFIX) ? track.slice(0, -MIRROR_SUFFIX.length) : track;
  if (!foundDuck(id)) return null;
  const all = duckTracks();
  const found = all.filter((one) => loadUnlocks().ducks.includes(one)).length;
  if (found >= all.length) return "Every duck found. Dabble joins the race.";
  const line = DUCK_LINES[id];
  return `Duck ${found} of ${all.length}.${line ? ` ${line}` : ""}`;
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

// ─── Hits between friends ────────────────────────────────────────────────────

/** A word for one of this screen's viewports: the kart it follows, and what it says there. */
export interface Taunt {
  kart: number;
  words: string;
}

/**
 * The words a hit earns, in the viewport of each kart on this screen it is
 * about: a player's own item coming back at them ("Own goal."), or one person
 * on the sofa getting another ("Got Finn." for the one who did it, "Maya got
 * you." for the one it got). A bot at either end is the race's business, and
 * says nothing. `players` names the karts people drive; `here` is the karts
 * this screen shows.
 */
export function taunts(hit: { kart: number; by: number | null }, players: ReadonlyMap<number, string>, here: readonly number[]): Taunt[] {
  const { kart, by } = hit;
  const victim = players.get(kart);
  if (by === null || victim === undefined) return [];
  if (by === kart) return here.includes(kart) ? [{ kart, words: "Own goal." }] : [];
  const attacker = players.get(by);
  if (attacker === undefined) return [];
  const out: Taunt[] = [];
  if (here.includes(by)) out.push({ kart: by, words: `Got ${victim}.` });
  if (here.includes(kart)) out.push({ kart, words: `${attacker} got you.` });
  return out;
}

// ─── A line under the result ─────────────────────────────────────────────────

/** How a race went for the one player on this screen. */
export interface FinishFacts {
  /** Their place, and how many karts raced. */
  place: number;
  field: number;
  /** Their time, or null: the race ended before they finished. */
  time: number | null;
  /** The winner's name and time, and the runner-up's time (a win's margin). */
  winner: string;
  winnerTime: number | null;
  secondTime: number | null;
  /** How many times the drone carried them back to the road. */
  rescues: number;
}

/**
 * The line under "You Won" or "4th Place": what everyone on the sofa saw, said
 * kindly, and the funnier the further down the table. Null when there is
 * nothing to add.
 */
export function resultLine(facts: FinishFacts): string | null {
  const { place, field, time, winner, winnerTime, secondTime, rescues } = facts;
  if (time === null) return "The race ended before you did.";
  if (place === field && field >= 4) return "You saw more of the track than anyone.";
  if (rescues >= 3) return "The drone knows you by name now.";
  if (place === 1) {
    const margin = secondTime === null ? Infinity : secondTime - time;
    if (margin > 5) return "By a mile.";
    if (margin < 0.5) return "By a whisker.";
    return null;
  }
  if (place === 2 && winnerTime !== null) {
    const gap = time - winnerTime;
    return gap < 0.1 ? `A whisker behind ${winner}.` : `${gap.toFixed(1)} s behind ${winner}.`;
  }
  return null;
}

/** One row of a cup's final standings, as the podium needs it. */
interface CupRow {
  name: string;
  points: number;
}

/**
 * What the podium says under the cup's name: who won, and to the one player
 * on this screen who did not, how close they came. `mine` is the places
 * (0 = the winner) of this screen's players.
 */
export function podiumLine(rows: readonly CupRow[], mine: readonly number[], cup: string): string {
  const winner = rows[0];
  if (!winner) return "";
  const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;
  if (mine.includes(0)) return `You won the ${cup}, with ${points(winner.points)}.`;
  const wins = `${winner.name} wins the ${cup}, with ${points(winner.points)}.`;
  const me = mine.length === 1 ? mine[0]! : -1;
  const row = rows[me];
  if (row && (me === 1 || me === 2)) {
    const behind = winner.points - row.points;
    return `${wins} You took ${me === 1 ? "silver" : "bronze"}, ${behind > 0 ? `${points(behind)} behind` : "level on points"}.`;
  }
  if (row && me === rows.length - 1 && rows.length >= 4) return `${wins} You took the scenic route.`;
  return wins;
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
