/**
 * Volcano Rush: black rock and rivers of lava, driving minor rock. D minor at
 * 154 beats a minute: a chugging power-chord riff with a screaming lead over a
 * straight-eighths bass, a brooding verse, a big sing-along chorus, a guitar
 * solo, a half-time breakdown, and a last chorus with the brass thundering in
 * underneath. 44 bars, about 69 seconds; the last chord is A5, which pulls
 * straight back into the riff.
 */
import { bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over D5 D5 Bb5 C5 | D5 D5 Bb5 C5: the riff, then the same with a run up into the verse.
const RIFF =
  "d5:3 d5:1 a4:2 d5:2 a4:4 c5:2 d5:2 | a4:3 a4:1 d5:2 f5:2 e5:4 d5:2 a4:2 | " +
  "bb4:3 bb4:1 f4:2 bb4:2 f5:4 d5:2 c5:2 | c5:3 c5:1 g4:2 c5:2 g4:4 bb4:2 a4:2 | " +
  "d5:3 d5:1 a4:2 d5:2 a4:4 c5:2 d5:2 | a4:3 a4:1 d5:2 f5:2 a4:4 d5:2 f5:2 | " +
  "bb4:3 bb4:1 f4:2 bb4:2 f5:4 d5:2 c5:2 | c5:3 c5:1 g4:2 c5:2 d5:2 e5:2 f5:2 g5:2";

// Eight bars over D5 D5 F5 C5 | D5 D5 Bb5 A5: sparse, so the guitars can chug underneath.
const VERSE =
  "r:4 d5:2 f5:2 a5:4 g5:2 f5:2 | d5:4 f5:2 e5:2 d5:4 r:4 | f5:4 c5:4 a4:2 c5:2 f5:4 | g4:4 c5:2 d5:2 e5:4 g5:4 | " +
  "r:4 d5:2 f5:2 a5:4 g5:2 a5:2 | d5:4 a4:2 f4:2 d5:4 r:4 | bb4:4 f5:2 g5:2 f5:4 bb4:4 | a4:4 e5:2 g5:2 a5:4 e5:4";

// Eight bars over D5 D5 Bb5 C5 | D5 D5 Bb5 A5: the guitar solo, licks and a climb.
const SOLO =
  "a5:6 g5:1 f5:1 d5:2 f5:2 a5:4 | d6:6 c6:1 a5:1 d5:2 f5:2 a5:4 | bb5:4 a5:1 g5:1 f5:2 f5:4 bb4:4 | c6:4 bb5:2 g5:2 g5:4 c5:2 d5:2 | " +
  "a5:2 f5:2 d6:4 a5:2 f5:2 d6:4 | bb5:2 d6:2 f5:4 d6:2 bb5:2 f5:4 | c6:2 e6:2 g5:4 e6:2 c6:2 g5:4 | a5:4 c6:2 d6:2 e6:6 d6:2";

// Eight bars over D5 Bb5 F5 C5 | D5 Bb5 C5 A5: the sing-along, long notes then a leap.
const CHORUS =
  "d5:6 a4:2 d5:4 f5:4 | f5:6 d5:2 bb4:4 d5:4 | c5:6 a4:2 f4:4 a4:4 | g4:6 c5:2 g5:4 e5:4 | " +
  "d5:6 a4:2 d5:2 f5:2 a5:4 | f5:6 d5:2 bb4:4 f5:4 | g5:4 e5:2 d5:2 c5:4 g4:4 | e5:4 d5:2 c5:2 a4:2 g4:2 e5:4";

// The last time round: the same, but climbing higher in the last two bars.
const CHORUS_LAST =
  "d5:6 a4:2 d5:4 f5:4 | f5:6 d5:2 bb4:4 d5:4 | c5:6 a4:2 f4:4 a4:4 | g4:6 c5:2 g5:4 e5:4 | " +
  "d5:6 a4:2 d5:2 f5:2 a5:4 | f5:6 d5:2 bb4:4 f5:4 | g5:2 c6:2 g5:4 e5:2 g5:2 c6:4 | a5:2 c6:2 e6:4 d6:2 c6:2 a5:2 e5:2";

// Four bars over D5 D5 Bb5 A5: long notes that climb, nearly alone.
const BREAK = "d5:8 a4:8 | d5:4 f5:4 a5:8 | bb4:8 f5:8 | a4:4 c5:4 e5:4 a5:4";

const riffGroove = {
  kick: "x.x...x.x.x...x.",
  snare: "....X.......X...",
  hat: "X.x.X.x.X.x.X.x.",
};
const verseGroove = {
  kick: "x.....x.x.......",
  snare: "....x.......x...",
  hat: "x.x.x.x.x.x.x.x.",
};
const chorusGroove = {
  kick: "x.x.x.x.x.x.x.x.",
  snare: "....X.......X...",
  ride: "x.x.x.x.x.x.x.x.",
};
const soloGroove = {
  kick: "x.x.x.x.x.x.x.x.",
  snare: "....X.......X...",
  hat: "x.x.x.x.x.x.x.x.",
  "hat-open": "..x...x...x...x.",
};
const breakGroove = {
  kick: "x.......x.x.....",
  snare: "........X.......",
  "tom-low": "..x...x...x.....",
  ride: "x...x...x...x...",
};
const fill = { "tom-high": "xx......", "tom-mid": "..xx....", "tom-low": "....xx..", snare: "......xx", kick: "x......." };

export const volcano: PieceSpec = {
  id: "volcano",
  name: "Volcano Rush",
  key: { tonic: "D", scale: "minor" },
  bpm: 154,
  rack: {
    bass: { inst: "bass-rock", level: -2, pan: 0 },
    gtr: { inst: "guitar-dist", level: -5.5, pan: -0.6, reverb: 0.08 },
    gtr2: { inst: "guitar-dist", level: -5.5, pan: 0.6, reverb: 0.08 },
    lead: { inst: "lead-dist", level: 0, pan: 0.05, reverb: 0.2, delay: 0.2 },
    brass: { inst: "brass", level: -4.5, pan: 0.2, reverb: 0.25 },
    drums: { inst: "drums", level: -2.5 },
  },
  fx: { reverb: { t60: 1.0, size: 0.45, mix: 0.16 }, delay: { beats: 0.75, feedback: 0.28, tone: 3500, mix: 0.14 } },
  sections: [
    {
      name: "Riff",
      bars: 8,
      chords: "D5 D5 Bb5 C5",
      parts: {
        bass: bass("drive8"),
        gtr: chords("stab8", { centre: 52, size: 3, vel: 0.75 }),
        gtr2: chords("stab8", { centre: 52, size: 3, vel: 0.75 }),
        lead: tune(RIFF),
        drums: drums(riffGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Verse",
      bars: 8,
      chords: "D5 D5 F5 C5 D5 D5 Bb5 A5",
      level: 0.92,
      parts: {
        bass: bass("drive8"),
        gtr: chords("gate16", { centre: 50, size: 3, vel: 0.7 }),
        gtr2: chords("gate16", { centre: 50, size: 3, vel: 0.7 }),
        lead: tune(VERSE),
        drums: drums(verseGroove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Chorus",
      bars: 8,
      chords: "D5 Bb5 F5 C5 D5 Bb5 C5 A5",
      parts: {
        bass: bass("drive8"),
        gtr: chords("strum", { centre: 54, size: 3, vel: 0.8, roll: 0.006 }),
        gtr2: chords("strum", { centre: 54, size: 3, vel: 0.8, roll: 0.006 }),
        lead: tune(CHORUS),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Solo",
      bars: 8,
      chords: "D5 D5 Bb5 C5 D5 D5 Bb5 A5",
      parts: {
        bass: bass("drive8"),
        gtr: chords("stab8", { centre: 52, size: 3, vel: 0.75 }),
        gtr2: chords("stab8", { centre: 52, size: 3, vel: 0.75 }),
        lead: tune(SOLO),
        drums: drums(soloGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Breakdown",
      bars: 4,
      chords: "D5 D5 Bb5 A5",
      level: 0.85,
      parts: {
        bass: bass("root4"),
        gtr: chords("gate16", { centre: 46, size: 3, vel: 0.8 }),
        gtr2: chords("gate16", { centre: 46, size: 3, vel: 0.8 }),
        lead: tune(BREAK, { vel: 0.85 }),
        drums: drums(breakGroove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Final Chorus",
      bars: 8,
      chords: "D5 Bb5 F5 C5 D5 Bb5 C5 A5",
      level: 1.08,
      parts: {
        bass: bass("drive8"),
        gtr: chords("strum", { centre: 54, size: 3, vel: 0.85, roll: 0.006 }),
        gtr2: chords("strum", { centre: 54, size: 3, vel: 0.85, roll: 0.006 }),
        lead: tune(CHORUS_LAST),
        brass: tune(CHORUS_LAST, { shift: -12, vel: 0.8 }),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
  ],
};
