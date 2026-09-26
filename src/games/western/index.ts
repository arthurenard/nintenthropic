import type { Game } from "../../engine/types";
import type { HighNoon, HighNoonOptions } from "./game";

/**
 * High Noon. The app imports only this function; everything else in the game
 * lives under src/games/western/. The game itself is a separate chunk loaded
 * here, on demand, so the first screen never waits for a gunfight to parse.
 */
export async function createGame(): Promise<Game> {
  const { HighNoon } = await import("./game");
  return new HighNoon();
}

/** For the dev harness: start on a given wave, god mode, or force High Noon. */
export async function createHighNoon(options: HighNoonOptions = {}): Promise<HighNoon> {
  const { HighNoon } = await import("./game");
  return new HighNoon(options);
}

export type { HighNoon, HighNoonOptions };
