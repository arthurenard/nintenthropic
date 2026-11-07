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
import { jingleLose, jingleWin } from "./jingles";
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
  // The heroic chorus again a tone higher with trumpets in the canyon, before the tag gallops home.
  canyon: withFinale(canyon, {
    from: 2,
    at: 3,
    shift: 2,
    extra: { horns: chords("sync", { vel: 0.75, roll: 0.005 }) },
  }),
  // The march once more a tone up, the brass doubled by the calliope's own octave, before the trio.
  funfair: withFinale(funfair, {
    from: 3,
    at: 4,
    shift: 2,
    extra: { glock: tune("r:128", { vel: 0.5 }) },
  }),
  // Frost again, a tone higher, with a choir joining the strings, then the dominant to fall back to D.
  snow: withFinale(snow, {
    from: 4,
    shift: 2,
    extra: { choir: chords("pad", { vel: 0.6, centre: 66 }) },
    turn: {
      chords: "Asus4 A7",
      part: "lead",
      tune: "r:16 | r:12 f#5:2 e5:2",
      chordsPart: "pad",
      groove: { "kick-soft": "x.......x.......", shaker: "xoxoxoxoxoxoxoxo" },
      fill: { rim: "x.x.xxxx", clap: "......xX" },
    },
  }),
  volcano,
  // The finale once more, a tone higher, before the dominant that drops back into the launch.
  space: withFinale(space, {
    from: 6,
    shift: 2,
    turn: {
      chords: "C#sus4 C#",
      part: "lead",
      tune: "r:16 | r:12 e5:2 c#5:2",
      chordsPart: "pad",
      groove: { "kick-808": "x...x...x...x...", shaker: "xoxoxoxoxoxoxoxo" },
      fill: { "snare-electro": "xxxxxxxx", clap: "x.x.x.xX" },
    },
  }),
  palm,
  menu,
  "jingle-win": jingleWin,
  "jingle-lose": jingleLose,
  "results-win": resultsWin,
  results: resultsDone,
  podium,
} satisfies Record<string, PieceSpec>;

export type PieceId = keyof typeof PIECES;

/** The pieces that are a track's own tune, which have a faster final-lap version. */
export const THEME_PIECES = ["meadow", "kitchen", "harbour", "canyon", "funfair", "snow", "volcano", "space", "palm"] as const satisfies readonly PieceId[];
