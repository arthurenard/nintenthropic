import type { Game } from "../../engine/types";
import type { OverwatchRidge, RidgeOptions } from "./game";

/**
 * Overwatch Ridge. The app imports only this function; everything else in
 * the game lives under src/games/ridge/. The game itself is a separate
 * chunk loaded here, on demand, so the arcade never waits for a valley to
 * parse.
 */
export async function createGame(): Promise<Game> {
  const { OverwatchRidge } = await import("./game");
  return new OverwatchRidge();
}

/** For the dev harness: start on a given stage, god mode, another art folder. */
export async function createOverwatchRidge(options: RidgeOptions = {}): Promise<OverwatchRidge> {
  const { OverwatchRidge } = await import("./game");
  return new OverwatchRidge(options);
}

export type { OverwatchRidge, RidgeOptions };
