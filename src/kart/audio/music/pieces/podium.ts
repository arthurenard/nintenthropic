/**
 * Grand Prix Podium: the end of a cup. D major. Four slow, broad bars of brass
 * fanfare over timpani, then the band sets off at 118 beats a minute in a
 * stately swing: a dotted, rising three-note hook that climbs a step with each
 * answer, a bridge for the bells, and the hook again with everybody playing.
 * 20 bars, about 43 seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Four bars over D G D/F# A: arpeggios opening out, a held dominant at the end.
const FANFARE =
  "a4:2 d5:2 f#5:4 a5:8 | g5:3 g5:1 b5:4 d6:8 | " +
  "a5:3 f#5:1 d5:4 f#5:2 a5:2 d6:4 | e5:2 a5:2 c#6:4 e6:8";

// Over D A/C# Bm F#m: the hook (da-da-DAA, DAAA) and its answer coming down; the hook again, a step lower.
const A1 =
  "d5:3 f#5:1 a5:4 d6:6 a5:2 | e6:6 c#6:2 a5:4 c#6:4 | " +
  "b4:3 d5:1 f#5:4 b5:6 f#5:2 | c#6:6 a5:2 f#5:4 a5:4";

// Over G D/F# Em7 A: the hook on G, an answer, a climb to the dominant.
const A2 =
  "b4:3 d5:1 g5:4 b5:6 g5:2 | a5:3 f#5:1 d5:4 f#5:6 a5:2 | " +
  "g5:3 b5:1 d6:4 e6:6 d6:2 | a5:3 c#6:1 e6:6 c#6:2 a5:4";

// Over G D/F# Em7 A: the bells, long notes falling and then rising to a held E.
const B =
  "d6:6 b5:2 g5:4 b5:4 | a5:6 f#5:2 d5:4 f#5:4 | " +
  "g5:4 b5:4 d6:4 e6:4 | e6:6 c#6:2 e6:8";

// Over D A/C# G A: the hook with everybody playing, the third time higher still.
const CODA =
  "d5:3 f#5:1 a5:4 d6:6 a5:2 | e6:6 c#6:2 a5:4 c#6:4 | " +
  "g5:3 b5:1 d6:4 g6:6 d6:2 | a5:4 c#6:4 e6:6 r:2";

const roll = { timpani: "x.x.x.x.xxxxxxXX", snare: "........xxxxxxxx" };
const lift = { snare: "x.x.xxxx", timpani: "......xx" };

export const podium: PieceSpec = {
  id: "podium",
  name: "Grand Prix Podium",
  key: { tonic: "D", scale: "major" },
  bpm: 118,
  swing: 0.22,
  rack: {
    bass: { inst: "upright", level: -2, pan: -0.1, highpass: 40, comp: { threshold: -17, ratio: 3, attack: 0.012, release: 0.12 } },
    chords: { inst: "organ-jazz", level: -4, pan: 0.3, reverb: 0.15, highpass: 180, rotary: { rate: 5.4, depth: 0.4 } },
    strings: { inst: "string-ens", level: -5, pan: -0.1, reverb: 0.3, chorus: 0.3, highpass: 160 },
    lead: { inst: "brass-section", level: 0, reverb: 0.28, delay: 0.1, highpass: 250 },
    low: { inst: "horn-soft", level: -4, pan: -0.15, reverb: 0.25, highpass: 150 },
    glock: { inst: "ice-bell", level: -5.5, pan: -0.3, reverb: 0.35, delay: 0.3 },
    bell: { inst: "bell", level: -2, pan: 0.2, reverb: 0.4, delay: 0.25 },
    arp: { inst: "harp", level: -5, pan: 0.3, reverb: 0.35, delay: 0.2 },
    drums: { inst: "drums", level: -3, kit: "march" },
  },
  fx: {
    reverb: { t60: 2.0, size: 0.75, mix: 0.32, predelay: 0.022 },
    delay: { beats: 0.75, feedback: 0.25, tone: 3500, mix: 0.18 },
    master: { air: 1.5 },
  },
  sections: [
    {
      name: "Fanfare",
      bars: 4,
      bpm: 96,
      chords: "D G D/F# A",
      parts: {
        bass: bass("whole"),
        chords: chords("pad", { vel: 0.6 }),
        strings: chords("pad", { centre: 64, vel: 0.5 }),
        lead: tune(FANFARE, { vel: 0.92 }),
        low: tune(FANFARE, { shift: -12, vel: 0.8 }),
        drums: drums({ timpani: "x.......x......." }, { fill: roll, fillEvery: 4, crash: true, vel: 0.9 }),
      },
    },
    {
      name: "A1",
      bars: 4,
      level: 0.92,
      chords: "D A/C# Bm F#m",
      parts: {
        bass: bass("rf"),
        chords: chords("charleston", { roll: 0.008 }),
        strings: chords("pad", { centre: 64, vel: 0.45 }),
        lead: tune(A1, { vel: 0.85 }),
        drums: drums(
          { kick: "x.......x.......", snare: "....x.......x...", ride: "x.x.x.x.x.x.x.x.", tambourine: "....x.......x..." },
          { fill: lift, fillEvery: 4, crash: true },
        ),
      },
    },
    {
      name: "A2",
      bars: 4,
      chords: "G D/F# Em7 A",
      parts: {
        bass: bass("bounce"),
        chords: chords("charleston", { roll: 0.008 }),
        strings: chords("pad", { centre: 64, vel: 0.5 }),
        lead: tune(A2, { vel: 0.88 }),
        low: tune(A2, { shift: -12, vel: 0.7 }),
        glock: tune(A2, { shift: 12, vel: 0.65 }),
        drums: drums(
          { kick: "x...x...x...x...", clap: "....x.......x...", ride: "x.x.x.x.x.x.x.x.", tambourine: "x.x.x.x.x.x.x.x.", timpani: "x.......x......." },
          { fill: lift, fillEvery: 4, crash: true },
        ),
      },
    },
    {
      name: "B",
      bars: 4,
      level: 0.95,
      chords: "G D/F# Em7 A",
      parts: {
        bass: bass("oompah"),
        chords: chords("pad", { vel: 0.7 }),
        strings: chords("pad", { centre: 64, vel: 0.65 }),
        lead: tune(B, { vel: 0.55 }),
        bell: tune(B, { vel: 0.85 }),
        glock: tune(B, { shift: 12, vel: 0.6 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 60, vel: 0.5 }),
        drums: drums(
          { timpani: "x.......x.......", ride: "x...x...x...x...", "kick-soft": "x......." },
          { fill: { snare: "x.x.x.x.xxxxxxxx" }, fillEvery: 2, crash: true },
        ),
      },
    },
    {
      name: "Coda",
      bars: 4,
      level: 1.05,
      chords: "D A/C# G A",
      parts: {
        bass: bass("bounce"),
        chords: chords("quarters", { roll: 0.006, vel: 0.7 }),
        strings: chords("pad", { centre: 64, vel: 0.55 }),
        lead: tune(CODA, { vel: 0.92 }),
        low: tune(CODA, { shift: -12, vel: 0.75 }),
        glock: tune(CODA, { shift: 12, vel: 0.7 }),
        bell: tune(CODA, { shift: 12, vel: 0.5 }),
        arp: arp("0 1 2 3 2 3 1 2", 2, { base: 64, vel: 0.5 }),
        drums: drums(
          { kick: "x...x...x...x...", snare: "....x.......x...", ride: "x.x.x.x.x.x.x.x.", tambourine: "x.x.x.x.x.x.x.x.", timpani: "x.......x......." },
          { fill: roll, fillEvery: 4, crash: true },
        ),
      },
    },
  ],
};
