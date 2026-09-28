import type { Game } from "../../engine/types";
import type { OrbitalDecay, OrbitOptions } from "./game";

/**
 * Orbital Decay. The app imports only this function; everything else in the
 * game lives under src/games/orbit/. The game itself is a separate chunk
 * loaded here, on demand, so the first screen never waits for it to parse.
 */
export async function createGame(): Promise<Game> {
  const { OrbitalDecay } = await import("./game");
  return new OrbitalDecay();
}

/** For the dev harness: start on a given pass, god mode, a folder of art in progress. */
export async function createOrbitalDecay(options: OrbitOptions = {}): Promise<OrbitalDecay> {
  const { OrbitalDecay } = await import("./game");
  return new OrbitalDecay(options);
}

export type { OrbitalDecay, OrbitOptions };
