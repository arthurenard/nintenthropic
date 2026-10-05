/**
 * Every piece of Grip Prix's music, by name: a tune for each track's theme,
 * and the screens around the race.
 */
import type { PieceSpec } from "../score";
import { canyon } from "./canyon";
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
  kitchen,
  harbour,
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
