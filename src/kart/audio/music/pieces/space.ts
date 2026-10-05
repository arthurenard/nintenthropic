/**
 * Starlight Ribbon: the finale, a glowing road high in space. F# minor at 134
 * beats a minute. A pad and fast plucked arpeggios (with a long, shimmering
 * delay) carry a soaring saw lead; the hook is heard twice, then a rising
 * pre-chorus lifts into an anthem over i - VI - III - VII, a glassy bridge goes
 * still and swells, and the last chorus comes back with bells an octave above.
 * 36 bars, about 65 seconds; the last chord is the dominant C#, so it falls
 * home to F#m.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Four bars over F#m D A E: the hook, a rising arpeggio, then a long note and a fall.
const LAUNCH = "f#5:4 a5:4 c#6:8 | d6:6 c#6:2 a5:4 f#5:4 | e6:6 d6:2 c#6:4 a5:4 | g#5:4 b5:4 e6:4 c#6:2 b5:2";

// The hook again over F#m D A E, a step higher and running faster.
const LAUNCH2 = "f#5:2 a5:2 c#6:4 a5:2 c#6:2 f#6:4 | f#6:6 e6:2 d6:4 a5:4 | c#6:2 e6:2 c#6:2 a5:2 e6:4 c#6:4 | e6:4 b5:4 g#5:4 b5:2 e6:2";

// Four bars over Bm D E C#: a stuttering climb to the dominant, then a breath before the drop.
const RISE = "b5:2 b5:2 d6:4 b5:2 b5:2 d6:4 | a5:2 a5:2 d6:4 a5:2 a5:2 f#6:4 | b5:2 b5:2 e6:4 b5:2 b5:2 g#6:4 | g#5:4 c#6:4 f6:4 r:4";

// Eight bars over F#m D A E | F#m D A E: the anthem, long notes then runs.
const CHORUS =
  "c#6:6 a5:2 c#6:4 f#6:4 | f#6:6 e6:2 d6:4 a5:4 | e6:6 c#6:2 e6:4 c#6:4 | g#5:4 b5:4 e6:4 b5:2 g#5:2 | " +
  "a5:2 c#6:2 f#6:4 e6:2 c#6:2 a5:4 | d6:2 f#6:2 d6:4 a5:2 d6:2 f#6:4 | e6:8 c#6:4 a5:4 | b5:4 e6:4 d6:2 c#6:2 b5:2 g#5:2";

// The same over F#m D A E | F#m D E C#: the last two bars lift into the dominant.
const FINALE =
  "c#6:6 a5:2 c#6:4 f#6:4 | f#6:6 e6:2 d6:4 a5:4 | e6:6 c#6:2 e6:4 c#6:4 | g#5:4 b5:4 e6:4 b5:2 g#5:2 | " +
  "a5:2 c#6:2 f#6:4 e6:2 c#6:2 a5:4 | d6:2 f#6:2 d6:4 a5:2 d6:2 f#6:4 | e6:4 b5:4 g#5:4 b5:4 | g#5:4 c#6:4 f6:4 g#5:2 c#6:2";

// Four bars over Dmaj7 E C#m F#m: sparse and glassy.
const BRIDGE = "a5:4 c#6:4 f#6:8 | g#5:4 b5:4 e6:8 | g#5:4 c#6:4 e6:8 | c#6:4 a5:4 f#5:8";

// Four bars over Bm D E C#: long notes while everything under them speeds up.
const CLIMB = "f#5:8 b5:8 | a5:8 d6:8 | b5:8 e6:8 | g#5:4 c#6:4 f6:4 r:4";

const launchGroove = {
  "kick-808": "x.......x.......",
  hat: "x.x.x.x.x.x.x.x.",
  shaker: "..o...o...o...o.",
};
const riseGroove = {
  "kick-808": "x...x...x...x...",
  clap: "....x.......x...",
  hat: "x.x.x.x.x.x.x.x.",
};
const chorusGroove = {
  "kick-808": "x...x...x...x.x.",
  clap: "....X.......X...",
  hat: "x.x.x.x.x.x.x.x.",
  "hat-open": "..x...x...x...x.",
};
const finaleGroove = {
  "kick-808": "x...x...x..xx.x.",
  clap: "....X.......X...",
  ride: "x.x.x.x.x.x.x.x.",
  "hat-open": "..x...x...x...x.",
  shaker: "xoxoxoxoxoxoxoxo",
};
const bridgeGroove = {
  "kick-808": "x.......x.......",
  shaker: "..o...o...o...o.",
};
const fill = { "snare-electro": "x.x.xxxx", clap: "......xX" };
const riser = { "snare-electro": "xxxxxxxx", clap: "x.x.x.xX", "kick-808": "x......." };

export const space: PieceSpec = {
  id: "space",
  name: "Starlight Ribbon",
  key: { tonic: "F#", scale: "minor" },
  bpm: 134,
  rack: {
    pad: { inst: "pad", level: -4, pan: -0.1, reverb: 0.35, chorus: 0.4 },
    strings: { inst: "strings", level: -5, pan: 0.1, reverb: 0.4, chorus: 0.3 },
    sub: { inst: "sub", level: -3, pan: 0 },
    bass: { inst: "bass-synth", level: -2.5, pan: 0 },
    arp: { inst: "pluck-synth", level: -7.5, pan: -0.35, reverb: 0.3, delay: 0.45 },
    star: { inst: "bell-fm", level: -8, pan: 0.4, reverb: 0.5, delay: 0.4 },
    lead: { inst: "lead-saw", level: 0, pan: 0.05, reverb: 0.3, delay: 0.3 },
    echo: { inst: "bell-fm", level: -6, pan: -0.25, reverb: 0.5, delay: 0.35 },
    drums: { inst: "drums", level: -3.5 },
  },
  fx: { reverb: { t60: 2.4, size: 0.9, mix: 0.34 }, delay: { beats: 0.75, feedback: 0.42, tone: 4200, mix: 0.3 } },
  sections: [
    {
      name: "Launch",
      bars: 4,
      chords: "F#m D A E",
      level: 0.88,
      parts: {
        pad: chords("pad", { centre: 58, size: 4 }),
        sub: bass("whole"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        lead: tune(LAUNCH),
        drums: drums(launchGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Launch2",
      bars: 4,
      chords: "F#m D A E",
      level: 0.95,
      parts: {
        pad: chords("pad", { centre: 58, size: 4 }),
        strings: chords("pad", { centre: 64, size: 4 }),
        bass: bass("root8"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        lead: tune(LAUNCH2),
        drums: drums(riseGroove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Rise",
      bars: 4,
      chords: "Bm D E C#",
      level: 1.0,
      parts: {
        pad: chords("hold2", { centre: 58, size: 4 }),
        strings: chords("pad", { centre: 64, size: 4 }),
        bass: bass("root8"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        star: arp("0 1 2 3", 2, { base: 72, octaves: 1 }),
        lead: tune(RISE),
        drums: drums(riseGroove, { fill: riser, fillEvery: 4 }),
      },
    },
    {
      name: "Chorus",
      bars: 8,
      chords: "F#m D A E F#m D A E",
      parts: {
        pad: chords("hold2", { centre: 58, size: 4 }),
        strings: chords("pad", { centre: 64, size: 4 }),
        bass: bass("pulse16"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        star: arp("0 1 2 3", 2, { base: 72, octaves: 1 }),
        lead: tune(CHORUS),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Bridge",
      bars: 4,
      chords: "Dmaj7 E C#m F#m",
      level: 0.8,
      parts: {
        pad: chords("pad", { centre: 60, size: 4 }),
        sub: bass("whole"),
        star: arp("0 1 2 3 2 1 3 2", 1, { base: 72, octaves: 1, gate: 0.9 }),
        lead: tune(BRIDGE, { vel: 0.85 }),
        drums: drums(bridgeGroove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Climb",
      bars: 4,
      chords: "Bm D E C#",
      level: 1.0,
      parts: {
        pad: chords("hold2", { centre: 58, size: 4 }),
        strings: chords("pad", { centre: 64, size: 4 }),
        bass: bass("root8"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        star: arp("0 1 2 3 2 1 3 2", 1, { base: 72, octaves: 1, gate: 0.9 }),
        lead: tune(CLIMB),
        drums: drums(riseGroove, { fill: riser, fillEvery: 4 }),
      },
    },
    {
      name: "Finale",
      bars: 8,
      chords: "F#m D A E F#m D E C#",
      level: 1.1,
      parts: {
        pad: chords("hold2", { centre: 58, size: 4 }),
        strings: chords("pad", { centre: 64, size: 4 }),
        bass: bass("pulse16"),
        arp: arp("0 2 1 3 2 4 3 5", 1, { base: 55, gate: 0.7 }),
        star: arp("0 1 2 3", 2, { base: 72, octaves: 1 }),
        lead: tune(FINALE),
        echo: tune(FINALE, { shift: 12, vel: 0.6 }),
        drums: drums(finaleGroove, { fill: riser, fillEvery: 4, crash: true }),
      },
    },
  ],
};
