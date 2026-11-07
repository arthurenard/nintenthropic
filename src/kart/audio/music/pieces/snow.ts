/**
 * Glacier Pass: an alpine road at blue hour. D major at 122 beats a minute,
 * a triangle-wave tune over strings, celesta and chime arpeggios that sparkle
 * like frost, sleigh bells and a soft kick. The bridge goes cold and still
 * (a tubular bell over shimmering chimes), builds, and the hook returns with
 * every layer. 32 bars, about 63 seconds; the last bar is the dominant, so it
 * falls home to D.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over D A/C# Bm Gmaj7 | D A Em7 A: the hook (a rising call, a falling answer), then the same, lifted.
const A =
  "a5:3 f#5:1 a5:2 d6:2 d6:4 a5:2 b5:2 | c#6:4 e6:4 c#6:2 b5:2 a5:4 | " +
  "d6:3 b5:1 d6:2 e6:2 d6:4 c#6:2 b5:2 | b5:4 d6:2 b5:2 g5:4 f#5:2 a5:2 | " +
  "a5:3 f#5:1 a5:2 d6:2 f#6:3 e6:1 d6:2 a5:2 | c#6:3 e6:1 a5:2 c#6:2 e6:4 d6:2 c#6:2 | " +
  "g5:3 b5:1 d6:2 e6:2 d6:4 b5:2 g5:2 | e6:4 c#6:4 a5:4 r:2 e5:2";

// Eight bars over G D/F# Em7 Bm | G D/F# Asus4 A: flowing eighths, climbing to a held top note.
const B =
  "g5:2 b5:2 d6:4 b5:2 g5:2 b5:2 d6:2 | a5:2 f#5:2 a5:4 d6:4 a5:2 f#5:2 | " +
  "g5:2 b5:2 e6:4 d6:2 b5:2 g5:2 b5:2 | d6:4 b5:4 f#5:4 b5:2 d6:2 | " +
  "b5:2 d6:2 g6:3 f#6:1 d6:2 b5:2 d6:2 g5:2 | f#6:3 e6:1 d6:2 a5:2 f#5:4 a5:2 d6:2 | " +
  "e6:4 d6:4 a5:4 d6:2 e6:2 | a5:2 c#6:2 e6:4 c#6:2 a5:2 c#6:2 e6:2";

// The bridge, in two halves of four bars: sparse, long and cold, then climbing.
const C1 = "f#5:4 b5:4 d6:8 | c#6:4 a5:4 f#5:8 | g5:4 b5:4 d6:4 f#6:4 | d6:8 a5:8";
const C2 = "g5:4 b5:4 e6:8 | d6:4 f#6:4 e6:2 d6:2 b5:4 | e6:4 d6:4 a5:4 d6:4 | c#6:4 e6:4 c#6:4 e5:2 a5:2";

const groove = {
  "kick-soft": "x...x...x...x...",
  rim: "....x.......x...",
  shaker: "xoxoxoxoxoxoxoxo",
  sleigh: "..x...x...x...x.",
};
const grooveFull = {
  ...groove,
  "kick-soft": "x...x...x..ox...",
  clap: "....X.......X...",
  "hat-open": "......x.......x.",
};
const fill = { rim: "x.x.xxxx", clap: "......xX" };
const fillBig = { rim: "x.x.xxxx", clap: "x.x.xxXX", "kick-soft": "x......." };

export const snow: PieceSpec = {
  id: "snow",
  name: "Glacier Pass",
  key: { tonic: "D", scale: "major" },
  bpm: 122,
  swing: 0.04,
  race: true,
  rack: {
    bass: { inst: "bass-fat", level: -2.5, pan: -0.05, highpass: 40, duck: 0.3, comp: { threshold: -16, ratio: 3, attack: 0.008, release: 0.1 } },
    pad: { inst: "string-ens", level: -4, pan: 0.15, reverb: 0.4, chorus: 0.3, highpass: 160, duck: 0.28 },
    arp: { inst: "arp-synth", level: -7, pan: -0.35, reverb: 0.4, delay: 0.3, highpass: 300, duck: 0.15 },
    shimmer: { inst: "chime", level: -8, pan: 0.35, reverb: 0.45, delay: 0.35 },
    lead: { inst: "lead-tri", level: 0, reverb: 0.25, delay: 0.2, highpass: 400 },
    glock: { inst: "ice-bell", level: -5.5, pan: 0.3, reverb: 0.4, delay: 0.3 },
    bell: { inst: "bell", level: -1, pan: -0.15, reverb: 0.5, delay: 0.3 },
    choir: { inst: "choir-ooh", level: -5, pan: 0, reverb: 0.5, highpass: 200 },
    drums: { inst: "drums", level: -3.5, kit: "electro" },
  },
  fx: {
    reverb: { t60: 2.2, size: 0.85, mix: 0.34, predelay: 0.03, damping: 0.25 },
    delay: { beats: 0.75, feedback: 0.35, tone: 4500, mix: 0.22 },
    master: { air: 3 },
  },
  sections: [
    {
      name: "A",
      bars: 8,
      chords: "D A/C# Bm Gmaj7 D A Em7 A",
      parts: {
        bass: bass("rf"),
        pad: chords("pad", { centre: 60, size: 4 }),
        arp: arp("0 2 1 3 2 4 3 5", 2, { base: 62 }),
        lead: tune(A),
        drums: drums(groove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "G D/F# Em7 Bm G D/F# Asus4 A",
      parts: {
        bass: bass("root8"),
        pad: chords("hold2", { centre: 60, size: 4 }),
        arp: arp("0 2 1 3 2 4 3 5", 2, { base: 62 }),
        shimmer: arp("0 1 2 3 2 1 2 3", 2, { base: 76, octaves: 1 }),
        lead: tune(B),
        glock: tune(B, { shift: 12, vel: 0.7 }),
        drums: drums(grooveFull, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Bridge",
      bars: 4,
      chords: "Bm F#m Gmaj7 D/F#",
      level: 0.9,
      parts: {
        pad: chords("pad", { centre: 62, size: 4 }),
        shimmer: arp("0 1 2 3 4 3 2 1", 1, { base: 76, octaves: 2 }),
        bell: tune(C1),
        drums: drums({ shaker: "xoxoxoxoxoxoxoxo", sleigh: "x...x...x...x...", "kick-soft": "x......." }, { fill: fillBig, fillEvery: 4 }),
      },
    },
    {
      name: "Build",
      bars: 4,
      chords: "Em7 Bm Asus4 A",
      level: 0.95,
      parts: {
        bass: bass("rf"),
        pad: chords("pad", { centre: 62, size: 4 }),
        arp: arp("0 2 1 3 2 4 3 5", 2, { base: 62 }),
        shimmer: arp("0 1 2 3 4 3 2 1", 1, { base: 76, octaves: 2 }),
        bell: tune(C2),
        drums: drums({ "kick-soft": "x.......x.......", shaker: "xoxoxoxoxoxoxoxo", sleigh: "..x...x...x...x." }, { fill: fillBig, fillEvery: 4 }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "D A/C# Bm Gmaj7 D A Em7 A",
      level: 1.05,
      parts: {
        bass: bass("rf"),
        pad: chords("pad", { centre: 60, size: 4 }),
        arp: arp("0 2 1 3 2 4 3 5", 2, { base: 62 }),
        shimmer: arp("0 1 2 3 2 1 2 3", 2, { base: 76, octaves: 1 }),
        lead: tune(A),
        glock: tune(A, { shift: 12, vel: 0.7 }),
        drums: drums(grooveFull, { fill: fillBig, fillEvery: 4, crash: true }),
      },
    },
  ],
};
