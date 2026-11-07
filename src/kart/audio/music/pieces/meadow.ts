/**
 * Meadow Loop: a sunny, bouncy morning. C major at 126 beats a minute, folk-pop:
 * a strummed steel-string guitar, a nylon guitar picking behind it, a musette
 * accordion, a whistled tune on top, a picked bass that hops and a marimba.
 *
 * The form: a four-bar intro (guitar and shaker, the whistle calling twice), the
 * tune (A) and its answer (B), the tune again with the accordion singing a
 * line under it (A2), a four-bar bridge that slows the harmony to long
 * whistled notes over Am Em F G, then the answer once more a whole tone up (the
 * lift) with everyone playing, and a two-bar turn on the dominant that lands
 * back on the intro's first chord. 42 bars, about 80 seconds.
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

// The intro over C G Am F: two bars of waiting, the whistle's first call, its second a little higher.
const INTRO = "r:32 | e5:2 g5:2 c6:4 r:8 | f5:2 a5:2 c6:4 r:2 d6:2 c6:2 a5:2";

// The accordion's line under the second tune (A2): long notes that lean on the whistle, in the chords' thirds.
const ACCORDION =
  "e5:6 g5:2 e5:8 | d5:6 g5:2 b4:8 | e5:6 c5:2 a4:8 | c5:6 a4:2 f4:8 | " +
  "e5:6 g5:2 c5:8 | d5:6 g5:2 d5:8 | c5:6 f5:2 a4:8 | d5:6 b4:2 d5:8";

// Over Am Em F G: the bridge. Long whistled notes with room between them, then the climb back.
const BRIDGE =
  "e5:6 a5:2 c6:8 | b5:6 g5:2 e5:8 | f5:4 a5:4 c6:6 a5:2 | d6:4 b5:4 g5:6 b5:2";

// Over G7sus4 G7: the dominant waits, then four rising notes run into the top.
const TURN = "r:16 | r:8 g5:2 a5:2 b5:2 d6:2";

const groove = {
  "kick-soft": "x.......x.x.....",
  rim: "....x.......x...",
  shaker: "x.x.x.x.x.x.x.x.",
};
const grooveB = { ...groove, "kick-soft": "x...x...x...x...", tambourine: "..x...x...x...x." };
const fill = { "snare-brush": "x.x.xxxx", "tom-high": "......x." };
const strumGuitar = { highpass: 140, comp: { threshold: -17, ratio: 2.5, attack: 0.012, release: 0.14 } };

export const meadow: PieceSpec = {
  id: "meadow",
  name: "Meadow Loop",
  key: { tonic: "C", scale: "major" },
  bpm: 126,
  swing: 0.12,
  race: true,
  rack: {
    bass: { inst: "bass-pick", level: -2.5, pan: -0.05, highpass: 38, duck: 0.14, comp: { threshold: -16, ratio: 3, attack: 0.01, release: 0.1 } },
    strum: { inst: "gtr-steel", level: -2.5, pan: 0.35, reverb: 0.14, chorus: 0.18, ...strumGuitar },
    pick: { inst: "gtr-nylon", level: -5, pan: -0.38, reverb: 0.2, highpass: 160 },
    acc: { inst: "musette", level: -4.5, pan: -0.28, reverb: 0.2, chorus: 0.3, highpass: 220, duck: 0.1 },
    lead: { inst: "whistle", level: 0, reverb: 0.3, delay: 0.22, highpass: 450 },
    glock: { inst: "glock", level: -5.5, pan: -0.3, reverb: 0.35, delay: 0.3 },
    arp: { inst: "marimba", level: -5.5, pan: -0.25, reverb: 0.2, highpass: 200 },
    drums: { inst: "drums", level: -3.5, kit: "pop" },
  },
  fx: {
    reverb: { t60: 1.4, size: 0.6, mix: 0.28, predelay: 0.018 },
    delay: { beats: 0.75, feedback: 0.3, tone: 3500, mix: 0.2 },
    master: { air: 2, loud: -0.5 },
  },
  sections: [
    {
      name: "Intro",
      bars: 4,
      level: 0.85,
      chords: "C G Am F",
      parts: {
        strum: chords("strum", { roll: 0.014, vel: 0.62 }),
        pick: arp("0 2 1 3 2 3 1 2", 2, { base: 60, octaves: 1, vel: 0.5 }),
        lead: tune(INTRO, { vel: 0.8 }),
        drums: drums({ shaker: "x.x.x.x.x.x.x.x.", rim: "........x......." }),
      },
    },
    {
      name: "A",
      bars: 8,
      chords: "C G Am F C G F G",
      parts: {
        bass: bass("bounce"),
        strum: chords("strum", { roll: 0.012 }),
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
        strum: chords("offbeat", { roll: 0.008 }),
        pick: arp("0 1 2 3 2 1 2 1", 2, { base: 64, octaves: 1, vel: 0.5 }),
        lead: tune(B),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72 }),
        drums: drums(grooveB, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "C G Am F C G F G",
      parts: {
        bass: bass("bounce"),
        strum: chords("strum", { roll: 0.012 }),
        acc: tune(ACCORDION, { vel: 0.7 }),
        lead: tune(A),
        glock: tune(A, { shift: 12, vel: 0.7 }),
        arp: arp("0 2 1 3 2 3 1 2", 2, { base: 72, octaves: 1 }),
        drums: drums(grooveB, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Bridge",
      bars: 4,
      level: 0.8,
      chords: "Am Em F G",
      parts: {
        bass: bass("whole", { vel: 0.7 }),
        strum: chords("hold2", { roll: 0.02, vel: 0.55 }),
        pick: arp("0 1 2 3 2 1 0 1", 2, { base: 57, octaves: 1, vel: 0.5 }),
        acc: chords("pad", { vel: 0.45 }),
        lead: tune(BRIDGE),
        glock: arp("0 1 2 3", 4, { base: 76, octaves: 1, vel: 0.55 }),
        drums: drums({ shaker: "x.x.x.x.x.x.x.x.", "kick-soft": "x.......x.......", rim: "........x......." }, { fill: { "snare-brush": "x.x.xxxx" }, fillEvery: 4 }),
      },
    },
    {
      name: "Lift",
      bars: 8,
      shift: 2,
      chords: "F G Em Am Dm G C G",
      parts: {
        bass: bass("rf", { vel: 0.92 }),
        strum: chords("offbeat", { roll: 0.008, vel: 0.8 }),
        pick: arp("0 1 2 3 2 1 2 1", 1, { base: 64, octaves: 1, vel: 0.4 }),
        acc: chords("sync", { vel: 0.5 }),
        lead: tune(B),
        glock: tune(B, { shift: 12, vel: 0.7 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72 }),
        drums: drums({ ...grooveB, hat: "..x...x...x...x." }, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Turn",
      bars: 2,
      level: 0.9,
      chords: "G7sus4 G7",
      parts: {
        bass: bass("whole", { vel: 0.8 }),
        strum: chords("hold2", { roll: 0.015, vel: 0.6 }),
        lead: tune(TURN),
        drums: drums({ shaker: "x.x.x.x.x.x.x.x." }, { fill: { "snare-brush": "x.x.xxxx", "tom-high": "......x." }, fillEvery: 2 }),
      },
    },
  ],
};
