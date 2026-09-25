import type { Game } from "../../engine/types";

/**
 * High Noon. The app imports only this function; everything else in the game
 * lives under src/games/western/. (A stub until the game is built.)
 */
export async function createGame(): Promise<Game> {
  throw new Error("High Noon is not built yet");
}
