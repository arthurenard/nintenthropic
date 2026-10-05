/**
 * Pick Your Kart: the title screen and the lobby. G major at 118 beats a
 * minute, a friendly flute tune over a plucked ukulele and a marimba, a hopping
 * pizzicato bass and soft brushes. The first half is light; the second brings
 * in glockenspiel, whistle and a rounder pop bass, and a quiet string pad that
 * keeps a sense of "any moment now" for the lobby. 32 bars, about 65 seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over G Bm C D G E7 Am7 D: the hook climbs a G arpeggio, answers with a C arpeggio, then the second half goes up a step.
const A =
  "g5:2 b5:2 d6:3 r:1 b5:2 d6:2 g6:4 | f#6:3 d6:1 b5:2 d6:2 f#6:6 r:2 | " +
  "e6:3 c6:1 e6:2 g6:2 e6:4 d6:2 c6:2 | a5:3 f#5:1 a5:2 d6:2 f#6:4 r:4 | " +
  "g5:2 b5:2 d6:4 g6:3 f#6:1 e6:2 d6:2 | e6:3 d6:1 b5:2 g#5:2 b5:4 r:4 | " +
  "c6:3 b5:1 a5:2 c6:2 e6:4 d6:2 c6:2 | d6:3 c6:1 a5:2 f#5:2 a5:4 r:2 a5:2";

// Eight bars over C D Bm Em C G/B Am7 D: flowing eighths, a run up to the top at the end.
const B =
  "g5:2 c6:2 e6:2 g6:4 e6:2 c6:2 e6:2 | a5:2 d6:2 f#6:2 e6:4 d6:2 c6:2 a5:2 | " +
  "b5:3 d6:1 f#6:4 d6:2 b5:2 d6:2 f#6:2 | g6:4 e6:2 g6:2 b5:4 r:2 e6:2 | " +
  "e6:2 g6:2 e6:2 c6:2 g5:4 c6:2 e6:2 | d6:4 b5:2 d6:2 g6:6 r:2 | " +
  "e6:3 d6:1 c6:2 a5:2 c6:4 e6:2 g6:2 | a5:2 b5:2 c6:2 d6:2 f#6:4 e6:2 d6:2";

// The same eight bars, the second half bigger: it climbs where B stepped and runs up to a6 on the way home.
const B2 =
  "g5:2 c6:2 e6:2 g6:4 e6:2 c6:2 e6:2 | a5:2 d6:2 f#6:2 e6:4 d6:2 c6:2 a5:2 | " +
  "b5:3 d6:1 f#6:4 d6:2 b5:2 d6:2 f#6:2 | g6:4 e6:2 g6:2 b5:4 r:2 e6:2 | " +
  "e6:2 g6:2 c6:2 e6:2 g6:6 e6:2 | d6:2 g6:2 b5:2 d6:2 g6:4 d6:2 b5:2 | " +
  "c6:2 e6:2 a5:2 c6:2 e6:4 g6:4 | a5:2 d6:2 f#6:2 a6:2 f#6:4 d6:2 a5:2";

const soft = { "kick-soft": "x.......x.......", rim: "....x.......x...", shaker: "x.o.x.o.x.o.x.o." };
const lilt = { "kick-soft": "x.....x.x.......", rim: "....x.......x...", shaker: "x.o.x.o.x.o.x.o.", tambourine: "....x.......x..." };
const bounce = { "kick-soft": "x.....x.x.x.....", rim: "....x.......x...", shaker: "x.xox.xox.xox.xo", tambourine: "..x...x...x...x." };
const tip = { rim: "x.x.xxxx", tambourine: "......xx" };
const roll = { rim: "x.x.x.xxxxxxxxxx", tambourine: "..x...x...x.x.xx", "snare-brush": "........x.x.xxxx" };

export const menu: PieceSpec = {
  id: "menu",
  name: "Pick Your Kart",
  key: { tonic: "G", scale: "major" },
  bpm: 118,
  swing: 0.12,
  rack: {
    bass: { inst: "pizz", level: -0.5, pan: -0.1 },
    bass2: { inst: "bass-pop", level: -1.5, pan: -0.1 },
    chords: { inst: "uke", level: -3, pan: 0.35, reverb: 0.15, chorus: 0.25 },
    lead: { inst: "flute", level: 0, reverb: 0.3, delay: 0.25 },
    lead2: { inst: "whistle", level: -3, pan: 0.1, reverb: 0.3, delay: 0.3 },
    glock: { inst: "glock", level: -6, pan: -0.3, reverb: 0.35, delay: 0.3 },
    arp: { inst: "marimba", level: -5, pan: -0.25, reverb: 0.2 },
    pad: { inst: "strings", level: -5, pan: 0.05, reverb: 0.35, chorus: 0.4, lowpass: 3000 },
    drums: { inst: "drums", level: -3 },
  },
  fx: { reverb: { t60: 1.4, size: 0.6, mix: 0.3 }, delay: { beats: 0.75, feedback: 0.3, tone: 3200, mix: 0.22 } },
  sections: [
    {
      name: "A",
      bars: 8,
      level: 0.92,
      chords: "G Bm C D G E7 Am7 D",
      parts: {
        bass: bass("walk"),
        chords: chords("strum", { roll: 0.014, vel: 0.62 }),
        lead: tune(A, { vel: 0.78 }),
        drums: drums(soft, { fill: tip, fillEvery: 8, vel: 0.85 }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "C D Bm Em C G/B Am7 D",
      parts: {
        bass: bass("rf"),
        chords: chords("offbeat", { roll: 0.01, vel: 0.62 }),
        lead: tune(B, { vel: 0.8 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72, vel: 0.55 }),
        drums: drums(lilt, { fill: tip, fillEvery: 4 }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "G Bm C D G E7 Am7 D",
      parts: {
        bass2: bass("bounce"),
        chords: chords("strum", { roll: 0.012 }),
        lead: tune(A, { vel: 0.82 }),
        glock: tune(A, { shift: 12, vel: 0.65 }),
        arp: arp("0 2 1 3 2 3 1 2", 2, { base: 72, octaves: 1, vel: 0.55 }),
        drums: drums(bounce, { fill: tip, fillEvery: 4 }),
      },
    },
    {
      name: "B2",
      bars: 8,
      level: 1.04,
      chords: "C D Bm Em C G/B Am7 D",
      parts: {
        bass2: bass("rf"),
        chords: chords("offbeat", { roll: 0.008 }),
        pad: chords("pad", { centre: 60, size: 3, vel: 0.5 }),
        lead: tune(B2, { vel: 0.85 }),
        lead2: tune(B2, { vel: 0.8 }),
        glock: tune(B2, { shift: 12, vel: 0.62 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72, vel: 0.6 }),
        drums: drums(bounce, { fill: roll, fillEvery: 4 }),
      },
    },
  ],
};
