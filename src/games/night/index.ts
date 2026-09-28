import type { Game } from "../../engine/types";
import type { DeadOfNight, NightOptions } from "./game";

/**
 * Dead of Night. The app imports only this function; everything else in the
 * game lives under src/games/night/. The game itself is a separate chunk
 * loaded here, on demand, so the first screen never waits for the night to
 * parse.
 */
export async function createGame(): Promise<Game> {
  const { DeadOfNight } = await import("./game");
  return new DeadOfNight();
}

/** For the dev harness: start on a given wave, god mode, a quiet road, another folder of art. */
export async function createDeadOfNight(options: NightOptions = {}): Promise<DeadOfNight> {
  const { DeadOfNight } = await import("./game");
  return new DeadOfNight(options);
}

export type { DeadOfNight, NightOptions };
