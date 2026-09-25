/**
 * The games, as the landing shows them. Each game's code is imported only
 * when it is played, so the first screen downloads none of it.
 */
import type { Game, GameEntry } from "../engine/types";

/** What High Noon's module says while it is still a stub. */
const NOT_BUILT = "High Noon is not built yet";

export const HIGH_NOON: GameEntry = {
  id: "high-noon",
  title: "High Noon",
  blurb: "Bandits in every window. Stand your ground.",
  about:
    "Golden hour in Dust Creek, and the Carver gang comes out of every window, doorway and barrel. Draw fast, spare the townsfolk, and last as long as you can.",
  poster: "assets/western/poster.webp",
  async create(): Promise<Game> {
    const { createGame } = await import("./western/index");
    try {
      return await createGame();
    } catch (error) {
      // Until High Noon is merged its module is a stub that throws; the
      // stand-in range keeps the whole app playable end to end meanwhile.
      // Any other failure is a real one and is reported as such.
      if (!(error instanceof Error) || error.message !== NOT_BUILT) throw error;
      const { createStubGame } = await import("./stub/index");
      return createStubGame({ id: "high-noon", title: "High Noon" });
    }
  },
};

/** The games that can be played now. */
export const GAMES: GameEntry[] = [HIGH_NOON];

/** The rest of the arcade, coming to the web later: named, never faked. */
export const COMING_SOON: { id: string; title: string; blurb: string }[] = [
  { id: "dead-of-night", title: "Dead of Night", blurb: "They come out of the fog. Aim for the head." },
  { id: "orbital-decay", title: "Orbital Decay", blurb: "Shoot the debris before it hits the glass." },
  { id: "overwatch-ridge", title: "Overwatch Ridge", blurb: "A long valley and a rifle. Close one eye to scope." },
];

export function gameById(id: string | null | undefined): GameEntry {
  return GAMES.find((game) => game.id === id) ?? HIGH_NOON;
}
