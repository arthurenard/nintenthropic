/**
 * Kitchen Rally: toy karts on a giant kitchen counter, to a cheeky little
 * swing combo. F major at 140 beats a minute with the off-beats swung, a
 * walking upright, a Rhodes comping jazz sixths and sevenths, a muted trumpet
 * with a vibraphone answering it in the gaps, brushes and a ride. 32 bars,
 * about 55 seconds: the hook (A), a lyrical B, a bridge into A-flat led by
 * the vibes with the trumpet down to two sighs (C), and the hook once more
 * with celesta sparkle (A2), which turns round on a ii-V back to the top.
 */
import { bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// --- A: eight bars over F6 Dm7 Gm7 C7 | F6 Am7|D7 Gm7 Gm7|C7 ---------------------------------------------
// The trumpet states the hook (bars 1 and 3, the same shape a step apart) and leaves the second half of
// bars 2 and 4 open for the vibes to talk back.
const A =
  "a4:2 c5:2 f5:2 a5:4 g5:2 f5:2 r:2 | d5:2 f5:6 r:8 | " +
  "bb4:2 d5:2 g5:2 bb5:4 a5:2 g5:2 r:2 | e5:2 g5:6 r:8 | " +
  "a4:2 c5:2 f5:2 a5:4 g5:2 f5:2 r:2 | c5:2 e5:2 g5:4 a5:2 f#5:2 d5:4 | " +
  "d5:2 f5:2 g5:4 bb5:4 g5:2 f5:2 | e5:2 g5:2 bb5:2 a5:2 g5:4 e5:2 r:2";

// The vibes' two answers (steps 8 to 15 of bars 2 and 4), then nothing.
const ANSWER = "r:24 a5:2 c6:2 a5:2 f5:2 r:24 g5:2 bb5:2 g5:2 e5:2 r:64";
// The last time round two pickups join them: a flourish at the end of bar 5, and the hook's first note at the end of bar 8.
const ANSWER2 = "r:24 a5:2 c6:2 a5:2 f5:2 r:24 g5:2 bb5:2 g5:2 e5:2 r:14 c6:2 r:32 r:14 a4:2";

// The closing hook ends with a rising run into the top of the loop (bars 7 and 8).
const A_LAST =
  "a4:2 c5:2 f5:2 a5:4 g5:2 f5:2 r:2 | d5:2 f5:6 r:8 | " +
  "bb4:2 d5:2 g5:2 bb5:4 a5:2 g5:2 r:2 | e5:2 g5:6 r:8 | " +
  "a4:2 c5:2 f5:2 a5:4 c6:2 a5:2 r:2 | c5:2 e5:2 g5:4 a5:2 f#5:2 d5:4 | " +
  "d5:2 f5:2 g5:2 f5:2 d5:2 bb4:2 d5:2 g5:2 | bb5:2 g5:2 e5:2 g5:2 bb5:4 g5:2 r:2";

// --- B: eight bars over Bb6 Bbm6 F6 D7 | Gm7 C7 Am7|D7 Gm7|C7: a singing second tune --------------------------
const B =
  "d5:2 f5:2 bb5:6 a5:2 g5:2 f5:2 | db5:2 f5:2 g5:6 f5:2 db5:2 bb4:2 | " +
  "a4:2 c5:2 f5:6 e5:2 d5:2 c5:2 | a4:2 c5:2 d5:2 f#5:2 a5:8 | " +
  "bb4:2 d5:2 g5:4 bb5:4 g5:2 f5:2 | e5:2 g5:2 bb5:4 g5:2 e5:2 c5:4 | " +
  "c5:2 e5:2 g5:4 a5:2 f#5:2 d5:4 | d5:2 f5:2 g5:4 e5:2 g5:2 bb5:2 r:2";
// Vibes fill the holds: one little figure at the end of the long-note bars.
const B_VIBES = "r:14 c6:2 | r:14 bb5:2 | r:14 a5:2 | r:12 f#5:2 d5:2 | r:14 d6:2 | r:14 c6:2 | r:16 | r:16";

// --- C: the bridge, over Abmaj7 Fm7 Bbm7 Eb7 | Abmaj7 Am7 D7 Gm7|C7: the vibes lead, in another key ---------------
const C =
  "eb5:2 g5:2 ab5:6 g5:2 eb5:2 c5:2 | f5:2 ab5:2 c6:6 bb5:2 ab5:2 f5:2 | " +
  "db5:2 f5:2 ab5:6 f5:2 db5:2 bb4:2 | bb4:2 db5:2 eb5:2 g5:2 bb5:8 | " +
  "eb5:2 g5:2 ab5:4 c6:4 g5:4 | e5:2 g5:2 a5:6 g5:2 e5:2 c5:2 | " +
  "a5:2 f#5:2 d5:4 f#5:2 a5:2 c6:4 | bb5:2 g5:2 d5:4 g5:2 e5:2 c5:4";
// A muted trumpet sighs a long note across the bridge.
const C_TRUMPET = "r:16 | r:16 | r:16 | bb4:12 r:4 | r:16 | r:16 | r:16 | r:8 f5:4 e5:4";

const grooveA = {
  "kick-soft": "x...o...x...o...",
  "snare-brush": "....x.......x...",
  ride: "x...x.x.x...x.x.",
  hat: "....o.......o...",
};
const fillA = { "snare-brush": "x.x.x.xx", "tom-mid": "......x.", "tom-low": "........" };
const grooveB = { ...grooveA, "kick-soft": "x...x...x...x...", shaker: "x.x.x.x.x.x.x.x." };
const grooveC = {
  "kick-soft": "x.......x.......",
  "snare-brush": "....x.......x...",
  ride: "x.......x.......",
  hat: "....o.......o...",
};

export const kitchen: PieceSpec = {
  id: "kitchen",
  name: "Kitchen Rally",
  key: { tonic: "F", scale: "major" },
  bpm: 140,
  swing: 0.6,
  race: true,
  rack: {
    bass: { inst: "upright", level: -2, pan: -0.15, highpass: 40, comp: { threshold: -17, ratio: 3, attack: 0.012, release: 0.12 } },
    chords: { inst: "rhodes", level: -3, pan: 0.3, reverb: 0.15, chorus: 0.2, highpass: 180, tremolo: { rate: 4.6, depth: 0.14, pan: true } },
    lead: { inst: "trumpet-mute", level: 0, reverb: 0.2, delay: 0.1, highpass: 350 },
    vibes: { inst: "vibes", level: -1, pan: -0.3, reverb: 0.3, delay: 0.15, highpass: 200 },
    celesta: { inst: "celesta", level: -6, pan: 0.35, reverb: 0.35, delay: 0.2 },
    horns: { inst: "brass-stab", level: -5, pan: -0.15, reverb: 0.25, highpass: 250 },
    drums: { inst: "drums", level: -3.5, kit: "brush" },
  },
  fx: {
    reverb: { t60: 1.2, size: 0.5, mix: 0.25, predelay: 0.015 },
    delay: { beats: 0.75, feedback: 0.25, tone: 3000, mix: 0.15 },
    master: { air: 1 },
  },
  sections: [
    {
      name: "A",
      bars: 8,
      chords: "F6 Dm7 Gm7 C7 F6 Am7|D7 Gm7 Gm7|C7",
      parts: {
        bass: bass("walk", { floor: 38 }),
        chords: chords("charleston", { roll: 0.01 }),
        lead: tune(A),
        vibes: tune(ANSWER),
        drums: drums(grooveA, { fill: fillA, fillEvery: 4 }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "Bb6 Bbm6 F6 D7 Gm7 C7 Am7|D7 Gm7|C7",
      parts: {
        bass: bass("walk", { floor: 38 }),
        chords: chords("freddie", { roll: 0.008 }),
        lead: tune(B),
        vibes: tune(B_VIBES, { vel: 0.8 }),
        drums: drums(grooveB, { fill: fillA, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "C",
      bars: 8,
      level: 0.85,
      chords: "Abmaj7 Fm7 Bbm7 Eb7 Abmaj7 Am7 D7 Gm7|C7",
      parts: {
        bass: bass("oompah", { floor: 36 }),
        chords: chords("freddie", { roll: 0.012, vel: 0.6 }),
        vibes: tune(C),
        lead: tune(C_TRUMPET, { vel: 0.7 }),
        celesta: tune(C, { shift: 12, vel: 0.45 }),
        drums: drums(grooveC, { fill: fillA, fillEvery: 8 }),
      },
    },
    {
      name: "A2",
      bars: 8,
      chords: "F6 Dm7 Gm7 C7 F6 Am7|D7 Gm7 Gm7|C7",
      parts: {
        bass: bass("walk", { floor: 38 }),
        chords: chords("charleston", { roll: 0.01 }),
        lead: tune(A_LAST),
        vibes: tune(ANSWER2),
        celesta: tune(A_LAST, { shift: 12, vel: 0.55 }),
        drums: drums(grooveB, { fill: fillA, fillEvery: 4, crash: true }),
      },
    },
  ],
};
