/**
 * Five Finger Circuit: a sunny island in the shape of an open hand. G major at
 * 120 beats a minute, a calypso groove: a steel drum plays a 3 + 3 + 2 hook
 * over a marimba bass, ukulele and banjo stabs and a bed of congas, bongos,
 * clave and cowbell, with a flute answering. A percussion break, then the
 * hook once more with everything, and the second tune doubled by a marimba.
 * 36 bars, 72 seconds; the last chord is D, so it falls home to G.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over G C G D | G G7 C D: the hook, a tresillo (3 + 3 + 2) twice a bar, then the same lifted.
const A =
  "g4:3 b4:3 d5:2 b4:3 g4:3 a4:2 | e4:3 g4:3 c5:2 g4:3 e4:3 g4:2 | " +
  "g4:3 b4:3 d5:2 d5:3 e5:3 d5:2 | a4:3 f#4:3 a4:2 d5:4 c5:2 a4:2 | " +
  "g4:3 b4:3 d5:2 g5:3 d5:3 b4:2 | g4:3 b4:3 f5:2 d5:3 b4:3 d5:2 | " +
  "e5:3 g5:3 e5:2 c5:3 e5:3 g5:2 | a4:2 d5:2 f#5:2 a5:2 f#5:2 d5:2 a4:4";

// Eight bars over Am D G Em | Am D G D: the steel calls (bars 1-2, 5-6, 7-8) and the flute answers (bars 3-4).
const B_STEEL =
  "a4:2 c5:2 e5:4 c5:2 e5:2 a5:4 | f#5:3 d5:3 a4:2 d5:4 r:4 | r:16 | r:16 | " +
  "e5:3 c5:3 a4:2 e5:3 a5:3 e5:2 | f#5:3 a5:3 d6:2 a5:3 f#5:3 d5:2 | " +
  "b4:2 d5:2 g5:4 d5:2 b4:2 g4:4 | a4:3 d5:3 f#5:2 a5:8";
const B_FLUTE = "r:16 | r:16 | b4:4 d5:4 g5:6 f#5:2 | e5:6 d5:2 b4:4 g4:4 | r:16 | r:16 | d5:8 b4:8 | a4:8 f#5:8";

// Four bars over C D C D: a breath of melody over the percussion.
const BREAK = "g4:6 e4:2 c5:8 | f#4:6 a4:2 d5:8 | e5:4 g5:4 e5:4 c5:4 | a4:2 d5:2 f#5:4 f#5:4 a4:4";

// The flute holding thirds above the hook, over G C G D | G G7 C D.
const A2_FLUTE = "b4:8 d5:8 | c5:8 e5:8 | b4:8 d5:8 | a4:8 f#5:8 | b4:8 d5:8 | b4:8 f5:8 | c5:8 e5:8 | a4:8 f#5:8";

const groove = {
  "kick-soft": "x..o..x.x..o..x.",
  rim: "....x.......x...",
  clave: "x..x..x...x.x...",
  shaker: "xoxoxoxoxoxoxoxo",
  "conga-high": "..x..x..x.x..x..",
  "conga-low": "x.....x.x.......",
};
const grooveB = { ...groove, cowbell: "x.o.x.o.x.o.x.o.", bongo: "..x.x...x.x....." };
const grooveFull = { ...grooveB, tambourine: "..x...x...x...x." };
const grooveBreak = {
  clave: "x..x..x...x.x...",
  shaker: "xoxoxoxoxoxoxoxo",
  "conga-high": "x.x..x.xx.x.xx.x",
  "conga-low": "..x.x...x...x.x.",
  bongo: "x.xx.x.x..x.x.xx",
  cowbell: "x...x...x...x...",
};
const fill = { bongo: "xxxxxxxx", "conga-high": "x.x.x.xx", "conga-low": "..x.x.x." };

export const palm: PieceSpec = {
  id: "palm",
  name: "Five Finger Circuit",
  key: { tonic: "G", scale: "major" },
  bpm: 120,
  swing: 0.08,
  race: true,
  rack: {
    bass: { inst: "bass-marimba", level: -2, pan: -0.1, highpass: 40, comp: { threshold: -16, ratio: 3, attack: 0.008, release: 0.1 } },
    uke: { inst: "uke-bright", level: -3.5, pan: -0.35, reverb: 0.12, chorus: 0.2, highpass: 200 },
    banjo: { inst: "banjo-bright", level: -5, pan: 0.4, reverb: 0.12, highpass: 250 },
    lead: { inst: "steel-pan", level: 0, pan: 0.05, reverb: 0.22, delay: 0.15, highpass: 250, comp: { threshold: -15, ratio: 2.5, attack: 0.01, release: 0.12 } },
    flute: { inst: "flute", level: -3, pan: 0.3, reverb: 0.3, delay: 0.2, highpass: 400 },
    arp: { inst: "marimba", level: -6, pan: -0.3, reverb: 0.18, highpass: 200 },
    mar: { inst: "marimba", level: -5, pan: -0.15, reverb: 0.2, delay: 0.1 },
    drums: { inst: "drums", level: -3, kit: "latin" },
  },
  fx: {
    reverb: { t60: 1.4, size: 0.6, mix: 0.24, predelay: 0.016 },
    delay: { beats: 0.75, feedback: 0.3, tone: 3800, mix: 0.16 },
    master: { air: 2 },
  },
  sections: [
    {
      name: "A",
      bars: 8,
      chords: "G C G D G G7 C D",
      parts: {
        bass: bass("tresillo"),
        uke: chords("sync", { roll: 0.01 }),
        lead: tune(A),
        drums: drums(groove, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "Am D G Em Am D G D",
      parts: {
        bass: bass("tresillo"),
        banjo: chords("sync", { centre: 66 }),
        uke: chords("offbeat", { roll: 0.008 }),
        arp: arp("0 1 2 1 2 3 2 1", 2, { base: 64 }),
        lead: tune(B_STEEL),
        flute: tune(B_FLUTE),
        drums: drums(grooveB, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "Break",
      bars: 4,
      chords: "C D C D",
      level: 0.9,
      parts: {
        bass: bass("tresillo"),
        arp: arp("0 1 2 3 2 1 2 3", 1, { base: 64, gate: 0.7 }),
        lead: tune(BREAK, { vel: 0.9 }),
        drums: drums(grooveBreak, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "G C G D G G7 C D",
      level: 1.05,
      parts: {
        bass: bass("tresillo"),
        uke: chords("sync", { roll: 0.01 }),
        banjo: chords("offbeat", { centre: 68 }),
        arp: arp("0 1 2 1 2 3 2 1", 2, { base: 64 }),
        lead: tune(A),
        flute: tune(A2_FLUTE),
        drums: drums(grooveB, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "B2",
      bars: 8,
      // The island's last lap round the tune: a whole tone up.
      shift: 2,
      chords: "Am D G Em Am D G D",
      level: 1.1,
      parts: {
        bass: bass("tresillo"),
        banjo: chords("sync", { centre: 66 }),
        uke: chords("offbeat", { roll: 0.008 }),
        arp: arp("0 1 2 1 2 3 2 1", 2, { base: 64 }),
        lead: tune(B_STEEL),
        mar: tune(B_STEEL, { shift: 12, vel: 0.65 }),
        flute: tune(B_FLUTE),
        drums: drums(grooveFull, { fill, fillEvery: 4 }),
      },
    },
    {
      // Two bars on the dominant, so the lifted tune falls back home to G instead of jumping.
      name: "Turn",
      bars: 2,
      level: 0.92,
      chords: "D7sus4 D7",
      parts: {
        bass: bass("whole", { vel: 0.75 }),
        uke: chords("hold2", { roll: 0.015, vel: 0.6 }),
        lead: tune("r:16 | r:12 a4:2 f#4:2"),
        drums: drums({ shaker: "xoxoxoxoxoxoxoxo", "conga-low": "x.......x......." }, { fill: { bongo: "xxxxxxxx", "conga-high": "x.x.xxxx" }, fillEvery: 2 }),
      },
    },
  ],
};
