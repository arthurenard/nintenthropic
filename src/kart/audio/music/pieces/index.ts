/**
 * Every piece of Grip Prix's music, by name: a tune for each track's theme,
 * and the screens around the race. Most themes get their finish here (see
 * ``withFinale``): the last chorus a tone higher with the band swelling, and a
 * turnaround that falls back into the top.
 */
import type { PieceSpec } from "../score";
import { canyon } from "./canyon";
import { bass, chords, drums, tune, withFinale } from "./dsl";
import { funfair } from "./funfair";
import { harbour } from "./harbour";
import { kitchen } from "./kitchen";
import { meadow } from "./meadow";
import { menu } from "./menu";
import { palm } from "./palm";
import { podium } from "./podium";
import { resultsDone, resultsWin } from "./results";
import { snow } from "./snow";
import { space } from "./space";
import { volcano } from "./volcano";

export const PIECES = {
  meadow,
  kitchen: withFinale(kitchen, {
    intro: {
      name: "Intro",
      bars: 4,
      level: 0.8,
      chords: "F6 Dm7 Gm7 C7",
      parts: {
        bass: bass("walk", { floor: 38, vel: 0.65 }),
        chords: chords("sparse", { roll: 0.012, vel: 0.55 }),
        vibes: tune("r:48 | r:8 e5:2 g5:2 bb5:2 g5:2", { vel: 0.8 }),
        drums: drums({ ride: "x...x.x.x...x.x.", hat: "....o.......o..." }, { vel: 0.7 }),
      },
    },
    from: 3,
    shift: 2,
    extra: { horns: chords("sync", { vel: 0.7, roll: 0.006 }) },
    turn: {
      chords: "Gm7 C7",
      part: "lead",
      tune: "r:16 | r:12 f4:2 a4:2",
      groove: { ride: "x...x.x.x...x.x.", hat: "....o.......o..." },
      fill: { "snare-brush": "x.x.xxxx", "tom-mid": "......x." },
    },
  }),
  harbour: withFinale(harbour, {
    from: 1,
    shift: 2,
    extra: { horns: chords("pad", { vel: 0.55 }), acc: chords("quarters", { vel: 0.4 }) },
    turn: {
      chords: "A7sus4 A7",
      part: "lead",
      tune: "r:16 | r:12 g4:2 a4:2",
      groove: { ride: "x...x.x.x...x.x.", hat: "....o.......o..." },
      fill: { "snare-brush": "x.x.xxxx", "tom-mid": "......x." },
    },
  }),
  canyon,
  funfair,
  snow,
  volcano,
  space,
  palm,
  menu,
  "results-win": resultsWin,
  results: resultsDone,
  podium,
} satisfies Record<string, PieceSpec>;

export type PieceId = keyof typeof PIECES;

/** The pieces that are a track's own tune, which have a faster final-lap version. */
export const THEME_PIECES = ["meadow", "kitchen", "harbour", "canyon", "funfair", "snow", "volcano", "space", "palm"] as const satisfies readonly PieceId[];
