/**
 * Where the page is, as its address says. Nintenthropic has two spaces to be in: the
 * landing (`./`, where Finger Guns and Grip Prix are side by side) and the arcade
 * (Finger Guns, the finger-pistol shooters). Grip Prix is a page of its own
 * (race.html), so its name in an address only says which tile of the landing to
 * stand on.
 *
 *   ./                          the landing
 *   #finger-guns                the arcade, on the game chosen last (#arcade, its old name, too)
 *   #high-noon, ?game=high-noon the arcade, on that game
 *   #grip-prix, ?game=grip-prix the landing, with Grip Prix's tile in hand
 *
 * The hash is what the page writes as the player moves about, so it wins over
 * `?game=` (a link someone passed on); a name that is no game is passed over.
 */
import type { GameEntry } from "../engine/types";

/** Grip Prix's id: a tile of the landing, not a card of the arcade. */
export const GRIP_PRIX_ID = "grip-prix";
/** The hash that opens the arcade without naming a game. */
export const ARCADE_HASH = "finger-guns";
/** Its hash from before the arcade was called Finger Guns: links to it keep working. */
const OLD_ARCADE_HASH = "arcade";

/** The tiles of the landing, and the spaces the page remembers the player was last in. */
export type Tile = "arcade" | "grip-prix";

export type Route =
  | { space: "landing"; /** The tile to stand on: where the player came from, or was sent to. */ focus: Tile | null }
  | { space: "arcade"; /** The game to open on, or null for the one chosen last. */ game: string | null };

/** The text of a hash ("#dead-of-night"), or "" for none or one that is not text. */
export function hashId(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

/** What one name in an address means, or null when it means nothing here. */
function nameRoute(name: string | null | undefined, shooters: readonly GameEntry[]): Route | null {
  if (!name) return null;
  if (name === ARCADE_HASH || name === OLD_ARCADE_HASH) return { space: "arcade", game: null };
  if (name === GRIP_PRIX_ID) return { space: "landing", focus: "grip-prix" };
  return shooters.some((game) => game.id === name) ? { space: "arcade", game: name } : null;
}

/** The space an address names (its hash, else its ?game=); the landing when it names none. */
export function parseRoute(from: { hash: string; search: string }, shooters: readonly GameEntry[]): Route {
  const query = new URLSearchParams(from.search).get("game");
  return nameRoute(hashId(from.hash), shooters) ?? nameRoute(query, shooters) ?? { space: "landing", focus: null };
}

/** The hash that says where a route is: the game's id in the arcade, none on the landing. */
export function hashFor(route: Route, game?: GameEntry): string {
  return route.space === "arcade" ? `#${game?.id ?? route.game ?? ARCADE_HASH}` : "";
}
