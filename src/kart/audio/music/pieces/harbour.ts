/**
 * Harbour Lights: the quay at night, as a lounge band would play a sea song.
 * D minor at 108 beats a minute with the eighths swung into a long, rolling
 * triplet lilt; an upright walking under a soft Rhodes, a smoky saxophone
 * singing the tune, an accordion answering low (the shanty), a nylon guitar
 * picking harp-like runs, vibes in the bridge and brushes on the drums.
 *
 * The form: a four-bar intro (harp and Rhodes, the sax's pickup), the tune (A),
 * the shanty chorus on the flat sixth and seventh with the accordion beside it
 * (B), a four-bar vibes bridge into F, the tune again a whole tone up with
 * horns and vibes added (the lift), and a two-bar turn on the dominant. 34
 * bars, about 76 seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Eight bars over Dm9 Gm7 Bbmaj7 A7 | Dm9 Gm7 Em7b5|A7 Dm: up the D minor chord, home through the dominant.
const A =
  "a4:2 d5:2 f5:4 a5:6 g5:2 | g5:2 f5:2 d5:4 bb4:4 d5:4 | bb4:2 d5:2 f5:4 a5:6 f5:2 | e5:4 g5:2 e5:2 c#5:4 a4:4 | " +
  "a4:2 d5:2 f5:4 a5:4 c6:4 | bb5:4 a5:2 g5:2 f5:4 d5:4 | g5:4 e5:4 c#5:2 e5:2 g5:2 a5:2 | d5:8 r:4 a4:2 d5:2";

// Eight bars over Bb C Dm F | Bb C A7sus4 A7: the chorus, the shanty's flat seventh pulling to the tonic.
const B =
  "d6:6 c6:2 bb5:4 f5:4 | g5:6 e5:2 c5:4 e5:4 | f5:4 a5:4 d6:8 | c6:6 a5:2 f5:4 a5:4 | " +
  "d6:6 c6:2 bb5:4 d6:4 | e6:6 d6:2 c6:4 g5:4 | a5:8 d6:4 e6:4 | c#6:4 e6:4 a5:8";

// The accordion walks beside the chorus: long notes, a third or a sixth under the sax.
const ACCORDION =
  "bb4:8 f4:8 | e4:8 g4:8 | a4:8 f4:8 | a4:8 c5:8 | bb4:8 d5:8 | e5:8 c5:8 | d5:8 g4:8 | e4:8 a4:8";

// Four bars over Gm7 C7 Fmaj7 Bbmaj7: the vibes alone, in F.
const BRIDGE = "bb5:4 d6:4 g6:8 | e6:6 c6:2 g5:4 e5:4 | a5:4 c6:4 f6:8 | d6:6 bb5:2 f5:4 d5:4";

// Three bars of waiting, then the sax's pickup over the dominant.
const INTRO = "r:56 e5:2 g5:2 a5:2 e5:2";

const lounge = {
  "kick-soft": "x.....x.....x...",
  "snare-brush": "....x.......x...",
  ride: "x...x.x.x...x.x.",
  hat: "....o.......o...",
};
const chorusGroove = { ...lounge, "kick-soft": "x...x...x...x...", shaker: "x.x.x.x.x.x.x.x." };
const fill = { "snare-brush": "x.x.x.xx", "tom-mid": "......x.", "tom-low": "........" };

export const harbour: PieceSpec = {
  id: "harbour",
  name: "Harbour Lights",
  key: { tonic: "D", scale: "minor" },
  bpm: 108,
  swing: 0.85,
  race: true,
  rack: {
    bass: { inst: "upright", level: -2, pan: -0.12, highpass: 40, comp: { threshold: -17, ratio: 3, attack: 0.012, release: 0.12 } },
    chords: { inst: "rhodes-soft", level: -3.5, pan: 0.3, reverb: 0.25, chorus: 0.25, highpass: 200, tremolo: { rate: 4.2, depth: 0.12, pan: true } },
    lead: { inst: "sax", level: 0, reverb: 0.3, delay: 0.2, highpass: 300, comp: { threshold: -15, ratio: 2.5, attack: 0.015, release: 0.15 } },
    acc: { inst: "accordion", level: -4, pan: -0.3, reverb: 0.25, chorus: 0.3, highpass: 220 },
    vibes: { inst: "vibes", level: -1, pan: 0.25, reverb: 0.35, delay: 0.2, highpass: 200 },
    harp: { inst: "gtr-nylon", level: -6, pan: -0.35, reverb: 0.3, delay: 0.25, highpass: 200 },
    horns: { inst: "horn-soft", level: -5.5, pan: 0.1, reverb: 0.35, highpass: 180 },
    drums: { inst: "drums", level: -3.5, kit: "brush" },
  },
  fx: {
    reverb: { t60: 1.9, size: 0.7, mix: 0.3, predelay: 0.022, damping: 0.45 },
    delay: { beats: 0.75, feedback: 0.3, tone: 2800, mix: 0.17 },
    master: { air: 1 },
  },
  sections: [
    {
      name: "Intro",
      bars: 4,
      level: 0.8,
      chords: "Dm9 Gm7 Bbmaj7 A7",
      parts: {
        bass: bass("whole", { vel: 0.6 }),
        chords: chords("pad", { roll: 0.02, vel: 0.5 }),
        harp: arp("0 2 1 3 2 3 1 2", 2, { base: 55, octaves: 2, vel: 0.6 }),
        lead: tune(INTRO, { vel: 0.75 }),
        drums: drums({ ride: "x...x.x.x...x.x." }, { vel: 0.7 }),
      },
    },
    {
      name: "A",
      bars: 8,
      chords: "Dm9 Gm7 Bbmaj7 A7 Dm9 Gm7 Em7b5|A7 Dm",
      parts: {
        bass: bass("walkpush", { floor: 38 }),
        chords: chords("sparse", { roll: 0.014 }),
        harp: arp("0 1 2 3 2 1", 2, { base: 55, octaves: 2, vel: 0.45 }),
        lead: tune(A),
        drums: drums(lounge, { fill, fillEvery: 4 }),
      },
    },
    {
      name: "B",
      bars: 8,
      chords: "Bb C Dm F Bb C A7sus4 A7",
      parts: {
        bass: bass("lilt", { floor: 36 }),
        chords: chords("quarters", { roll: 0.01, vel: 0.5 }),
        acc: tune(ACCORDION, { vel: 0.75 }),
        lead: tune(B),
        harp: arp("0 2 1 3 2 3", 2, { base: 55, octaves: 2, vel: 0.4 }),
        drums: drums(chorusGroove, { fill, fillEvery: 4, crash: true }),
      },
    },
    {
      name: "Bridge",
      bars: 4,
      level: 0.85,
      chords: "Gm7 C7 Fmaj7 Bbmaj7",
      parts: {
        bass: bass("walk", { floor: 38 }),
        chords: chords("hold2", { roll: 0.02, vel: 0.5 }),
        vibes: tune(BRIDGE),
        horns: chords("pad", { vel: 0.5 }),
        drums: drums({ "kick-soft": "x.......x.......", "snare-brush": "....x.......x...", ride: "x...x.x.x...x.x." }, { fill, fillEvery: 4 }),
      },
    },
  ],
};
