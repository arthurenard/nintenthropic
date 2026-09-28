/**
 * The arcade: every game, in the order the home screen shows them. A game
 * whose entry has `create` can be played; one without is Coming Soon -
 * named, shown, never faked. Each game's code is imported only when it is
 * played, so the first screen downloads none of it.
 *
 * A game's agent owns its own entry here: add `create` (importing
 * `./<folder>/index` on demand) when the game can be played, and the poster
 * at its `poster` path when Blender has rendered it. Until then the
 * `backdrop` - the game's light, not a picture pretending to be the game -
 * stands in wherever the poster would be.
 */
import type { Backdrop, Game, GameEntry } from "../engine/types";

/** Golden hour on Main Street: High Noon's light. */
const GOLDEN_HOUR: Backdrop = {
  sky: [
    ["#213349", 0],
    ["#50506a", 0.46],
    ["#b9795a", 0.78],
    ["#6c4630", 1],
  ],
  glow: {
    x: 0.62,
    y: 1.08,
    width: 1.2,
    height: 0.9,
    stops: [
      ["rgba(255, 196, 120, 0.95)", 0],
      ["rgba(233, 150, 84, 0.55)", 0.34],
      ["rgba(233, 150, 84, 0)", 0.62],
    ],
  },
};

export const HIGH_NOON: GameEntry = {
  id: "high-noon",
  title: "High Noon",
  blurb: "Bandits in every window. Stand your ground.",
  about:
    "Golden hour in Dust Creek, and the Carver gang comes out of every window, doorway and barrel. Draw fast, spare the townsfolk, and last as long as you can.",
  poster: "assets/western/poster.webp",
  backdrop: GOLDEN_HOUR,
  stage: { minAspect: 1.1 },
  async create(): Promise<Game> {
    const { createGame } = await import("./western/index");
    return createGame();
  },
};

export const DEAD_OF_NIGHT: GameEntry = {
  id: "dead-of-night",
  title: "Dead of Night",
  blurb: "They come out of the fog. Aim for the head.",
  about: "Midnight on a country road, and something is walking out of the fog. They come slowly, then all at once. Aim for the head, and hold the road until morning.",
  poster: "assets/dead-of-night/poster.webp",
  // Moonlight in the fog over a dark road.
  backdrop: {
    sky: [
      ["#060910", 0],
      ["#0f1826", 0.4],
      ["#34414f", 0.63],
      ["#1a2029", 0.74],
      ["#07090c", 1],
    ],
    glow: {
      x: 0.56,
      y: 0.6,
      width: 0.9,
      height: 0.34,
      stops: [
        ["rgba(214, 226, 238, 0.62)", 0],
        ["rgba(150, 170, 192, 0.3)", 0.4],
        ["rgba(150, 170, 192, 0)", 1],
      ],
    },
  },
};

export const ORBITAL_DECAY: GameEntry = {
  id: "orbital-decay",
  title: "Orbital Decay",
  blurb: "Shoot the debris before it hits the glass.",
  about: "A station at the edge of a debris field, and you at its only window. Break up everything that tumbles toward the glass, before the glass gives way.",
  poster: "assets/orbital-decay/poster.webp",
  // A planet's lit limb, curving under black space.
  backdrop: {
    sky: [
      ["#000000", 0],
      ["#01030a", 0.5],
      ["#06132a", 1],
    ],
    glow: {
      x: 0.62,
      y: 1.9,
      width: 1.9,
      height: 1.3,
      stops: [
        ["#0b1b33", 0],
        ["#12305a", 0.8],
        ["#4f9bf0", 0.858],
        ["rgba(120, 180, 255, 0.35)", 0.875],
        ["rgba(40, 90, 170, 0.12)", 0.93],
        ["rgba(40, 90, 170, 0)", 1],
      ],
    },
  },
};

export const OVERWATCH_RIDGE: GameEntry = {
  id: "overwatch-ridge",
  title: "Overwatch Ridge",
  blurb: "A long valley and a rifle. Close one eye to scope.",
  about: "First light over a long valley, and a rifle with five rounds. Close one eye to look through the scope, and make every shot count.",
  poster: "assets/overwatch-ridge/poster.webp",
  // Dawn haze down a valley.
  backdrop: {
    sky: [
      ["#23364b", 0],
      ["#5b7085", 0.42],
      ["#8f9c92", 0.6],
      ["#3b4838", 0.78],
      ["#1b231b", 1],
    ],
    glow: {
      x: 0.36,
      y: 0.6,
      width: 1.1,
      height: 0.65,
      stops: [
        ["rgba(255, 220, 170, 0.6)", 0],
        ["rgba(214, 186, 150, 0.26)", 0.3],
        ["rgba(214, 186, 150, 0)", 0.62],
      ],
    },
  },
  uses: { scope: true, eye: true },
};

/** Every game, playable or Coming Soon, in the arcade's order. */
export const ARCADE: GameEntry[] = [HIGH_NOON, DEAD_OF_NIGHT, ORBITAL_DECAY, OVERWATCH_RIDGE];

/** Can this game be played yet? */
export const playable = (entry: GameEntry): entry is GameEntry & { create(): Promise<Game> } => typeof entry.create === "function";

/** The games that can be played now. */
export function playableGames(): GameEntry[] {
  return ARCADE.filter(playable);
}

/** A game in the arcade by its id, playable or not; undefined for none. */
export function gameById(id: string | null | undefined): GameEntry | undefined {
  return id ? ARCADE.find((game) => game.id === id) : undefined;
}
