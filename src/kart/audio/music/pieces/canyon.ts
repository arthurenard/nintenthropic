/**
 * Canyon Run: a western climb past mesas and mine carts. E mixolydian at 122
 * beats a minute: a galloping bass, a banjo on the chick of a boom-chick and a
 * clean twang guitar whose hook is a horse's gallop (two sixteenths and an
 * eighth) up the chords E D A. The harmonica and the whistle answer it, the
 * chorus lifts onto C D E (the flattened sixth and seventh, the heroic
 * cadence) and an echo bounces round the canyon. 28 bars, about 55 seconds:
 * the hook (8), the hook answered (8), the chorus (8) and a quiet tag that
 * gallops up the dominant back to the top (4).
 */
import { bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// The hook over E D A E | E D A A|B: gallops up each chord, a quiet bar 4 and a gap at the end for the answers.
const HOOK =
  "b4:1 b4:1 e5:2 b4:1 b4:1 e5:2 b4:1 b4:1 g#5:2 b5:4 | a4:1 a4:1 d5:2 a4:1 a4:1 d5:2 a4:1 a4:1 f#5:2 a5:4 | " +
  "e5:4 c#5:4 a4:4 c#5:4 | b4:4 g#4:4 r:8 | " +
  "b4:1 b4:1 e5:2 b4:1 b4:1 e5:2 b4:1 b4:1 g#5:2 b5:4 | a4:1 a4:1 d5:2 a4:1 a4:1 d5:2 a4:1 a4:1 f#5:2 a5:4 | " +
  "a4:1 a4:1 c#5:2 a4:1 a4:1 c#5:2 e5:4 a5:4 | c#5:2 e5:2 a5:4 r:8";

// The harmonica answers in the gap of bar 4, the whistle in the gap of bar 8.
const HARMONICA = "r:56 e5:4 g#5:2 b5:2 r:64";
const WHISTLE = "r:120 d#5:2 f#5:2 b5:4";

// The chorus over C D E E | C D E E: the same shape climbing a step at a time, then a turn.
const CHORUS =
  "g5:4 e5:2 g5:2 c6:8 | a5:4 f#5:2 a5:2 d6:8 | b5:4 g#5:2 b5:2 e6:8 | b5:4 g#5:4 e5:4 g#5:2 b5:2 | " +
  "g5:4 e5:2 g5:2 c6:8 | a5:4 f#5:2 a5:2 d6:8 | e6:6 d6:2 b5:4 g#5:4 | b5:4 g#5:4 e5:4 r:4";
// Under the whistle the harmonica holds one chord tone a bar.
const HOLD = "g4:16 | a4:16 | b4:16 | b4:16 | g4:16 | a4:16 | b4:16 | b4:16";

// The tag over A E B B: the tune sighs down, then gallops up the B chord to the top of the loop.
const TAG =
  "e5:4 c#5:4 a4:8 | g#4:4 b4:4 e5:8 | f#5:4 d#5:4 b4:8 | b4:1 b4:1 d#5:2 b4:1 b4:1 f#5:2 b4:1 b4:1 b5:2 b5:4";
const TAG_HOLD = "e5:16 | g#5:16 | f#5:16 | r:16";

const hoof = { kick: "x.......x.......", rim: "....x.......x...", tambourine: "..x...x...x...x.", woodblock: "x.x...x.x.x...x." };
const gallopGroove = { ...hoof, "conga-low": "xxx.xxx.xxx.xxx." };
const heroGroove = {
  kick: "x...x...x...x...",
  snare: "....x.......x...",
  timpani: "x.......x.......",
  cowbell: "x...x...x...x...",
  tambourine: "..x...x...x...x.",
  "tom-low": "xxx.xxx.xxx.xxx.",
};
const tagGroove = { kick: "x.......x.......", woodblock: "x.x.x.x.x.x.x.x.", tambourine: "..x...x...x...x." };
const fillA = { "tom-low": "x.x.xxxx", "tom-mid": "..x.....", snare: "......xx" };
const fillHero = { "tom-high": "x.x.....", "tom-mid": "..x.x...", "tom-low": "....x.xx", timpani: "x.x.xxxx" };
const fillTag = { snare: "x.x.xxxx", "tom-low": "....x.xx", "tom-mid": "......x." };

export const canyon: PieceSpec = {
  id: "canyon",
  name: "Canyon Run",
  key: { tonic: "E", scale: "mixolydian" },
  bpm: 122,
  rack: {
    bass: { inst: "bass-pop", level: -2, pan: -0.1 },
    chords: { inst: "banjo", level: -4, pan: 0.3, reverb: 0.15 },
    lead: { inst: "twang", level: 0, reverb: 0.35, delay: 0.3 },
    harmonica: { inst: "harmonica", level: -1, pan: -0.25, reverb: 0.3, delay: 0.2 },
    whistle: { inst: "whistle", level: 0, pan: 0.2, reverb: 0.4, delay: 0.3 },
    drums: { inst: "drums", level: -3 },
  },
  fx: { reverb: { t60: 1.5, size: 0.8, mix: 0.3 }, delay: { beats: 0.5, feedback: 0.3, tone: 3500, mix: 0.2 } },
  sections: [
    {
      name: "Hook",
      bars: 8,
      level: 0.9,
      chords: "E D A E E D A A|B",
      parts: {
        bass: bass("gallop"),
        chords: chords("oompah", { size: 3, roll: 0.008 }),
        lead: tune(HOOK),
        drums: drums(hoof, { fill: fillA, fillEvery: 4 }),
      },
    },
    {
      name: "Answered",
      bars: 8,
      chords: "E D A E E D A A|B",
      parts: {
        bass: bass("gallop"),
        chords: chords("strum", { size: 3, roll: 0.012 }),
        lead: tune(HOOK),
        harmonica: tune(HARMONICA),
        whistle: tune(WHISTLE),
        drums: drums(gallopGroove, { fill: fillA, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Chorus",
      bars: 8,
      chords: "C D E E C D E E",
      parts: {
        bass: bass("gallop"),
        chords: chords("strum", { size: 3, roll: 0.012, centre: 64 }),
        lead: tune(CHORUS, { shift: -12 }),
        whistle: tune(CHORUS),
        harmonica: tune(HOLD, { vel: 0.6 }),
        drums: drums(heroGroove, { fill: fillHero, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Tag",
      bars: 4,
      level: 0.8,
      chords: "A E B B",
      parts: {
        bass: bass("rf"),
        chords: chords("oompah", { size: 3, roll: 0.01 }),
        lead: tune(TAG),
        harmonica: tune(TAG_HOLD, { vel: 0.7 }),
        drums: drums(tagGroove, { fill: fillTag, fillEvery: 4 }),
      },
    },
  ],
};
