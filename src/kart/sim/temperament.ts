/**
 * Who a bot is behind the wheel. Skill (the setup's 0..1) is how quick and
 * clean it is; temperament is how it races:
 *
 * - **aggressive**: dives up the inside, leans on the kart beside it, holds a
 *   Puck until it has someone lined up, brakes late into a fight.
 * - **careful**: clean lines, covers the inside when someone is close behind,
 *   rarely errs, saves a Nitro for a straight.
 * - **erratic**: wide, changing lines, big lunges, more mistakes, and the odd
 *   risky cut across the verge.
 *
 * A grid always mixes them: the bots of a race are ranked by a hash of their
 * name and driver and dealt the three in turn, so a bot keeps its temperament
 * through a cup (it keeps its name and driver; net/setup.ts deals the names
 * from the cup's first seed). A kart a person drove (handed over to the bots
 * when they left, or home and on its lap of honour) drives as `steady`.
 *
 * Everything that varies from lap to lap comes from `noise`: a hash of the
 * race's seed, the kart, and where it is (which bend, which lap). So no two
 * laps are alike, the same race replays exactly, and nothing new has to be
 * kept in a snapshot.
 */
import type { RaceSetup } from "../contract";
import type { KartState, World } from "./state";
import { TUNING } from "./tuning";

export type Temperament = "aggressive" | "careful" | "erratic" | "steady";

/** The three a grid is dealt, in turn. */
export const TEMPERAMENTS: readonly Temperament[] = ["aggressive", "careful", "erratic"];

export type Style = (typeof TUNING.bots.styles)[Temperament] & { temperament: Temperament };

/** A 32-bit hash of a string (FNV-1a). */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A number in [0, 1) from whole numbers, the same every time for the same
 * ones: the bots' dice, rolled by where they are rather than drawn from the
 * race's generator.
 */
export function noise(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** TEMPORARY switches for diagnosis. */
export const KNOBS = { racecraft: true, mistakes: true, variety: true, wander: true, freeze: true, cap: true, lean: true };

/** -1..1, smooth along `x` (metres of progress), a new value every `period`: a drift that never repeats. */
export function wander(x: number, period: number, ...parts: number[]): number {
  const f = x / period;
  const i = Math.floor(f);
  const t = f - i;
  const ease = t * t * (3 - 2 * t);
  const a = noise(...parts, i);
  const b = noise(...parts, i + 1);
  return (a + (b - a) * ease) * 2 - 1;
}

const cache = new WeakMap<RaceSetup, Map<number, Temperament>>();

/** Each kart's temperament in this race, by kart id. */
export function temperaments(setup: RaceSetup): Map<number, Temperament> {
  let found = cache.get(setup);
  if (found) return found;
  found = new Map();
  const bots = setup.racers
    .filter((r) => r.player === null)
    .map((r) => ({ id: r.id, key: hashString(`${r.name}|${r.character ?? ""}`) }))
    .sort((a, b) => a.key - b.key || a.id - b.id);
  bots.forEach((bot, rank) => found!.set(bot.id, TEMPERAMENTS[rank % TEMPERAMENTS.length]!));
  for (const r of setup.racers) if (r.player !== null) found.set(r.id, "steady");
  cache.set(setup, found);
  return found;
}

const STYLES = Object.fromEntries(
  (["aggressive", "careful", "erratic", "steady"] as const).map((temperament) => [temperament, { ...TUNING.bots.styles[temperament], temperament }]),
) as Record<Temperament, Style>;

/** How this kart races now: its temperament's, or `steady` for a person's kart driven by the bots and a kart already home. */
export function styleOf(w: World, k: KartState): Style {
  return STYLES[k.player || k.finished !== null ? "steady" : (temperaments(w.setup).get(k.id) ?? "steady")];
}
