/**
 * Harbour Lights: night on the quay, in synthwave. A minor at 116 beats a
 * minute, a rolling sixteenth bass, a gated glowing pad, plucked sixteenth
 * arpeggios and a saw lead through a dotted-eighth echo over a four-on-the-
 * floor 808 kick. 28 bars, about 58 seconds: a drums-and-arp intro that
 * teases the hook (4), the verse (8), the chorus that opens up with a square
 * lead an octave above (8), a break with a distant ship's horn and a snare
 * riser (4), and a last half-chorus that ends on E to fall back into the top.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Verse: Am F C G twice, in the synthwave 3 + 3 + 2 rhythm.
const VERSE =
  "e5:3 a5:3 g5:2 e5:4 c5:2 d5:2 | c5:3 f5:3 e5:2 c5:4 a4:4 | " +
  "e5:3 g5:3 c6:2 g5:4 e5:4 | d5:3 g5:3 b5:2 g5:4 d5:4 | " +
  "e5:3 a5:3 c6:2 b5:4 a5:2 e5:2 | a5:3 c6:3 a5:2 f5:4 c5:2 a4:2 | " +
  "g5:3 e5:3 g5:2 c6:4 g5:4 | d5:3 b4:3 g4:2 b4:4 d5:4";

// The intro teases the hook: two empty bars, then the verse's bars over C and G.
const TEASE = "r:32 e5:3 g5:3 c6:2 g5:4 e5:4 | d5:3 g5:3 b5:2 g5:4 d5:4";

// Chorus over F G Am Em | F G Am E: long notes that ring out, then quick turns.
const CHORUS_A = "c6:6 a5:2 c6:4 a5:2 f5:2 | b5:6 g5:2 b5:4 g5:2 d5:2 | e5:2 a5:4 c6:2 b5:4 a5:2 e5:2 | g5:6 e5:2 g5:4 b5:4";
const CHORUS_B = "c6:6 a5:2 c6:4 a5:2 f5:2 | b5:6 g5:2 d5:4 g5:4 | a5:2 c6:4 e6:2 c6:4 a5:4 | b5:6 g#5:2 e5:4 g#5:4";
// The last half-chorus climbs to the high E, then falls through the leading tone back to the A.
const CHORUS_END = "c6:4 a5:2 f5:2 c6:6 a5:2 | b5:6 g5:2 d5:4 g5:4 | a5:2 c6:4 e6:2 c6:4 a5:4 | b5:6 g#5:2 e5:4 g#5:4";

// The break: held notes over Dm Am F G, the last one climbing into the chorus.
const BREAK = "a5:8 f5:4 d5:4 | e5:8 c5:4 a4:4 | a5:8 c6:4 a5:4 | g5:4 b5:4 d6:8";
// A ship's horn, far off: a fifth over the Dm and a fifth over the F.
const HORN = "d3+a3:12 r:4 | r:16 | f3+c4:12 r:4 | r:16";

const introGroove = {
  "kick-808": "x...x...x...x...",
  hat: "x.x.x.x.x.x.x.x.",
};
const verseGroove = {
  "kick-808": "x...x...x...x...",
  "snare-electro": "....x.......x...",
  hat: "xoxoxoxoxoxoxoxo",
};
const chorusGroove = {
  "kick-808": "x...x...x...x...",
  "snare-electro": "....x.......x...",
  clap: "....x.......x...",
  hat: "xo.oxo.oxo.oxo.o",
  "hat-open": "..x...x...x...x.",
};
const breakGroove = {
  "kick-808": "x.......x.......",
  hat: "x.x.x.x.x.x.x.x.",
};
const fill = { "snare-electro": "x.x.xxxx", "tom-mid": "......x.", clap: ".......x" };
const riser = { "snare-electro": "xxxxxxxx", clap: "x.x.x.x.", "tom-low": "......xx" };

export const harbour: PieceSpec = {
  id: "harbour",
  name: "Harbour Lights",
  key: { tonic: "A", scale: "minor" },
  bpm: 116,
  rack: {
    bass: { inst: "bass-synth", level: -2 },
    chords: { inst: "pad-glow", level: -4, pan: -0.2, reverb: 0.3, chorus: 0.4 },
    arp: { inst: "pluck-synth", level: -6, pan: 0.25, reverb: 0.2, delay: 0.3 },
    lead: { inst: "lead-saw", level: 0, reverb: 0.3, delay: 0.4 },
    lead2: { inst: "lead-square", level: -6, pan: 0.2, reverb: 0.3, delay: 0.3, lowpass: 4500 },
    horn: { inst: "brass", level: 2, pan: -0.3, reverb: 0.7, lowpass: 1800 },
    drums: { inst: "drums", level: -3 },
  },
  fx: { reverb: { t60: 1.8, size: 0.7, mix: 0.3 }, delay: { beats: 0.75, feedback: 0.35, tone: 3200, mix: 0.3 } },
  sections: [
    {
      name: "Intro",
      bars: 4,
      level: 0.85,
      chords: "Am F C G",
      parts: {
        arp: arp("0 2 4 2 1 3 5 3", 1, { base: 53 }),
        lead: tune(TEASE, { vel: 0.7 }),
        drums: drums(introGroove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Verse",
      bars: 8,
      level: 0.88,
      chords: "Am F C G",
      parts: {
        bass: bass("pulse16"),
        chords: chords("gate16", { size: 3, centre: 64 }),
        arp: arp("0 2 4 2 1 3 5 3", 1, { base: 53, vel: 0.5 }),
        lead: tune(VERSE),
        drums: drums(verseGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Chorus",
      bars: 8,
      chords: "F G Am Em F G Am E",
      parts: {
        bass: bass("pulse16"),
        chords: chords("hold2", { size: 3, centre: 62 }),
        arp: arp("0 2 4 2 1 3 5 3", 1, { base: 53 }),
        lead: tune(CHORUS_A + " | " + CHORUS_B),
        lead2: tune(CHORUS_A + " | " + CHORUS_B, { shift: 12, vel: 0.7 }),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Break",
      bars: 4,
      level: 0.85,
      chords: "Dm Am F G",
      parts: {
        chords: chords("pad", { size: 3, centre: 60 }),
        arp: arp("0 1 2 3 4 3 2 1", 2, { base: 53, octaves: 2, vel: 0.5 }),
        lead: tune(BREAK, { vel: 0.8 }),
        horn: tune(HORN),
        drums: drums(breakGroove, { fill: riser, fillEvery: 4 }),
      },
    },
    {
      name: "Chorus end",
      bars: 4,
      chords: "F G Am E",
      parts: {
        bass: bass("pulse16"),
        chords: chords("hold2", { size: 3, centre: 62 }),
        arp: arp("0 2 4 2 1 3 5 3", 1, { base: 53 }),
        lead: tune(CHORUS_END),
        lead2: tune(CHORUS_END, { shift: 12, vel: 0.7 }),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
  ],
};
