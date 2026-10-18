/**
 * Fun Fair: dusk, every ride lit. A carousel waltz that becomes a rollercoaster
 * march, in G major, leaning to C for the second waltz tune and the trio.
 * The waltz (24 bars of three beats at 168) is a pipe organ over an
 * oom-pah-pah of soft organ chords and a round bass, with
 * a glockenspiel scattering sparkles from the second section; at the end it
 * rolls a snare into the march (16 bars of four at 126): brass in the first
 * eight, a trio in C with the organ on top and the brass sighing underneath
 * in the second, ending on D7 so the loop falls back into the waltz. About 56
 * seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// --- the waltz: twelve steps a bar -------------------------------------------------------------------------------
// W1, over G D7 G D7 | G Em C D7: a rising G arpeggio, answered by a falling D7, said twice, then a climb.
const W1 =
  "d5:4 g5:6 b5:2 | a5:6 f#5:2 d5:4 | d5:4 g5:6 b5:2 | c6:6 a5:2 f#5:4 | " +
  "g5:4 b5:4 d6:4 | b5:6 g5:2 e5:4 | c6:6 b5:2 g5:4 | a5:4 f#5:4 d5:4";

// W2, over C G C G | Am7 D7 G D7: the carousel's second tune, brighter, in the subdominant.
const W2 =
  "e5:4 g5:4 c6:4 | b5:6 a5:2 g5:4 | e5:4 g5:4 c6:4 | d6:6 b5:2 g5:4 | " +
  "a5:6 g5:2 e5:4 | f#5:6 e5:2 d5:4 | b5:6 g5:2 d5:4 | c6:4 a5:4 f#5:4";

// W3, over G D7 G D7 | G Em Am7 D7: the first tune again, climbing higher, and left open on the dominant.
const W3 =
  "d5:4 g5:6 b5:2 | a5:6 f#5:2 d5:4 | d5:4 g5:6 b5:2 | c6:6 a5:2 f#5:4 | " +
  "g5:4 b5:4 d6:4 | e6:6 d6:2 b5:4 | c6:6 b5:2 a5:4 | a5:4 r:8";

// --- the march: sixteen steps a bar ------------------------------------------------------------------------------------
// M1, over G C G D7 | G C D7 G: a fanfare of dotted figures.
const M1 =
  "g4:2 b4:2 d5:4 g5:3 g5:1 b5:4 | c6:3 g5:1 e5:4 g5:4 c6:4 | g5:3 a5:1 b5:4 d6:4 b5:4 | a5:6 f#5:2 d5:4 r:4 | " +
  "g4:2 b4:2 d5:4 g5:3 g5:1 b5:4 | c6:3 g5:1 e5:4 c6:8 | a5:4 f#5:2 a5:2 d6:4 c6:4 | b5:4 g5:4 g5:2 d5:2 g4:4";

// M2, over C C G G | C Am7 D7 D7: the trio, smoother; the last bar leads home to the waltz.
const M2 =
  "e5:6 e5:2 g5:4 c6:4 | c6:6 g5:2 e5:8 | d5:6 d5:2 g5:4 b5:4 | b5:6 a5:2 g5:8 | " +
  "e5:6 e5:2 g5:4 c6:4 | a5:6 g5:2 e5:4 c5:4 | d5:4 f#5:4 a5:4 c6:4 | d6:8 c6:2 a5:2 f#5:4";
// The brass underneath it, in held thirds and fifths.
const M2_BRASS = "c5:8 g4:8 | e5:8 c5:8 | b4:8 d5:8 | d5:8 g4:8 | c5:8 g4:8 | c5:8 e4:8 | f#4:8 a4:8 | a4:8 f#4:8";

const waltz = { "kick-soft": "x...........", rim: "....x...x...", tambourine: "x.x.x.x.x.x." };
const waltzFill = { snare: "xxxxxxxx", "tom-mid": "......xx" };
const march = { kick: "x.......x.......", snare: "....x.......x...", tambourine: "x.x.x.x.x.x.x.x." };
const trio = { kick: "x.......x.......", snare: "..o.x...o.o.x...", tambourine: "x.x.x.x.x.x.x.x.", timpani: "x......." };
const marchFill = { snare: "xxxxxxxx", "tom-mid": "x...x.xx" };

export const funfair: PieceSpec = {
  id: "funfair",
  name: "Fun Fair",
  key: { tonic: "G", scale: "major" },
  bpm: 168,
  rack: {
    bass: { inst: "sub", level: -2, pan: -0.1 },
    chords: { inst: "organ-soft", level: -3, pan: 0.25, reverb: 0.15 },
    lead: { inst: "organ-pipe", level: 0, reverb: 0.25 },
    brass: { inst: "brass", level: 0, pan: -0.2, reverb: 0.2 },
    glock: { inst: "glock", level: -1, pan: 0.3, reverb: 0.35, delay: 0.15 },
    sparkle: { inst: "glock", level: -4, pan: -0.3, reverb: 0.35 },
    drums: { inst: "drums", level: -3 },
  },
  fx: { reverb: { t60: 1.0, size: 0.55, mix: 0.2 }, delay: { beats: 0.75, feedback: 0.25, tone: 3500, mix: 0.12 } },
  sections: [
    {
      name: "Waltz",
      bars: 8,
      beats: 3,
      bpm: 168,
      level: 0.85,
      chords: "G D7 G D7 G Em C D7",
      parts: {
        bass: bass("waltz"),
        chords: chords("waltz", { size: 3, centre: 66 }),
        lead: tune(W1),
        drums: drums(waltz, { fill: waltzFill, fillEvery: 4 }),
      },
    },
    {
      name: "Waltz 2",
      bars: 8,
      beats: 3,
      bpm: 168,
      chords: "C G C G Am7 D7 G D7",
      parts: {
        bass: bass("waltz2"),
        chords: chords("waltzAll", { size: 3, centre: 66 }),
        lead: tune(W2),
        sparkle: arp("0 1 2 3 2 1", 2, { base: 72, vel: 0.6 }),
        drums: drums(waltz, { fill: waltzFill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Waltz 3",
      bars: 8,
      beats: 3,
      bpm: 168,
      chords: "G D7 G D7 G Em Am7 D7",
      parts: {
        bass: bass("waltz2"),
        chords: chords("waltz", { size: 3, centre: 66 }),
        lead: tune(W3),
        glock: tune(W3, { shift: 12, vel: 0.7 }),
        drums: drums(waltz, { fill: waltzFill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "March",
      bars: 8,
      beats: 4,
      bpm: 126,
      chords: "G C G D7 G C D7 G",
      parts: {
        bass: bass("rf"),
        chords: chords("oompah", { size: 3, centre: 64 }),
        brass: tune(M1),
        lead: tune(M1, { shift: 12, vel: 0.5 }),
        drums: drums(march, { fill: marchFill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Trio",
      bars: 8,
      beats: 4,
      bpm: 126,
      chords: "C C G G C Am7 D7 D7",
      parts: {
        bass: bass("rf"),
        chords: chords("march", { size: 3, centre: 64 }),
        lead: tune(M2),
        brass: tune(M2_BRASS, { vel: 0.8 }),
        sparkle: arp("0 1 2 1", 2, { base: 76, octaves: 2, vel: 0.5 }),
        drums: drums(trio, { fill: marchFill, fillEvery: 4, crash: true }),
      },
    },
  ],
};
