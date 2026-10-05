/**
 * Meadow Loop: a sunny, bouncy morning. C major at 126 beats a minute, a
 * whistled tune over strummed ukulele, a hopping bass and a marimba, with a
 * glockenspiel joining the second time round. 32 bars, about 61 seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over C G Am F C G F G: the whistle's tune, sequenced up a step in its second half.
const A =
  "g5:3 e5:1 g5:2 c6:4 r:2 g5:2 e5:2 | d6:3 b5:1 d6:2 g6:4 r:2 d6:2 b5:2 | " +
  "c6:3 a5:1 c6:2 e6:4 r:2 c6:2 a5:2 | a5:3 f5:1 a5:2 c6:4 r:2 a5:2 g5:2 | " +
  "g5:3 e5:1 g5:2 c6:4 r:2 e6:2 d6:2 | b5:3 g5:1 b5:2 d6:4 r:2 b5:2 a5:2 | " +
  "a5:2 c6:2 f6:4 e6:2 d6:2 c6:2 a5:2 | g5:2 b5:2 d6:4 g6:6 r:2";

// Eight bars over F G Em Am Dm G C G: flowing eighths, climbing.
const B =
  "c6:2 a5:2 c6:2 f6:4 e6:2 c6:2 a5:2 | b5:2 g5:2 b5:2 d6:4 c6:2 b5:2 g5:2 | " +
  "g5:2 b5:2 e6:6 d6:2 b5:2 g5:2 | a5:2 c6:2 e6:4 d6:2 c6:2 b5:2 a5:2 | " +
  "d6:3 d6:1 f6:2 a6:4 f6:2 d6:2 f6:2 | g6:3 f6:1 d6:2 b5:4 d6:2 f6:2 g6:2 | " +
  "c6:2 e6:2 g6:4 e6:2 c6:2 e6:2 g6:2 | g6:4 f6:2 d6:2 b5:2 g5:2 b5:2 d6:2";

const groove = {
  "kick-soft": "x.......x.x.....",
  rim: "....x.......x...",
  shaker: "x.x.x.x.x.x.x.x.",
};
const fill = { "snare-brush": "x.x.xxxx", "tom-high": "......x." };

export const meadow: PieceSpec = {
  id: "meadow",
  name: "Meadow Loop",
  key: { tonic: "C", scale: "major" },
  bpm: 126,
  swing: 0.12,
  rack: {
    bass: { inst: "bass-pop", level: -2, pan: -0.1 },
    chords: { inst: "uke", level: -2.5, pan: 0.35, reverb: 0.15, chorus: 0.25 },
    lead: { inst: "whistle", level: 0, reverb: 0.3, delay: 0.25 },
    glock: { inst: "glock", level: -5, pan: -0.3, reverb: 0.35, delay: 0.3 },
    arp: { inst: "marimba", level: -5, pan: -0.25, reverb: 0.2 },
    drums: { inst: "drums", level: -3 },
  },
  fx: { reverb: { t60: 1.3, size: 0.6, mix: 0.3 }, delay: { beats: 0.75, feedback: 0.3, tone: 3500, mix: 0.25 } },
  sections: [
    {
      name: "A",
      bars: 8,
      chords: "C G Am F C G F G",
      parts: {
        bass: bass("bounce"),
        chords: chords("strum", { roll: 0.012 }),
        lead: tune(A),
        drums: drums(groove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "F G Em Am Dm G C G",
      parts: {
        bass: bass("rf"),
        chords: chords("offbeat", { roll: 0.008 }),
        lead: tune(B),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72 }),
        drums: drums({ ...groove, "kick-soft": "x...x...x...x..." }, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "C G Am F C G F G",
      parts: {
        bass: bass("bounce"),
        chords: chords("strum", { roll: 0.012 }),
        lead: tune(A),
        glock: tune(A, { shift: 12, vel: 0.7 }),
        arp: arp("0 2 1 3 2 3 1 2", 2, { base: 72, octaves: 1 }),
        drums: drums(groove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "B2",
      bars: 8,
      chords: "F G Em Am Dm G C G",
      parts: {
        bass: bass("rf"),
        chords: chords("offbeat", { roll: 0.008 }),
        lead: tune(B),
        glock: tune(B, { shift: 12, vel: 0.7 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72 }),
        drums: drums({ ...groove, "kick-soft": "x...x...x...x..." }, { fill, fillEvery: 4, crash: true }),
      },
    },
  ],
};
