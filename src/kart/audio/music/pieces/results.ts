/**
 * The results screen, in two moods.
 *
 * Victory Lap (id "results-win"), after a win: a brass fanfare, a stomping
 * three-note hook that leaps, a big held bridge over a snare roll, and the hook
 * again a fourth higher. C major, 126 beats a minute, 20 bars, about 38 seconds.
 *
 * Well Played (id "results"), after anything else: a warm, unhurried groove on
 * vibes, electric piano and brushes, climbing the scale in the chords to say
 * "you'll get it next time". F major, 100 beats a minute, 16 bars, about 38
 * seconds.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// ---------------------------------------------------------------------------------------------------------------
// Victory Lap

// Four bars over C C F G: arpeggios up to the sky, a held dominant at the end.
const WIN_FANFARE =
  "g4:3 g4:1 c5:3 e5:1 g5:8 | e5:3 g5:1 c6:4 g5:2 e5:2 g5:4 | " +
  "a5:3 a5:1 c6:3 a5:1 f5:8 | d6:3 d6:1 b5:3 g5:1 d6:6 r:2";

// Over C G Am F: three repeated notes and a leap, one step lower each bar, then a climb.
const WIN_A1 =
  "e5:2 e5:2 e5:2 g5:6 e5:2 c5:2 | d5:2 d5:2 d5:2 g5:6 d5:2 b4:2 | " +
  "c5:2 c5:2 e5:2 a5:6 g5:2 e5:2 | f5:2 a5:2 c6:4 a5:2 f5:2 c6:4";

// Over C G F C: the same leap, then answering higher; ends on a held C.
const WIN_A2 =
  "e5:2 e5:2 e5:2 g5:6 c6:2 g5:2 | d5:2 d5:2 d5:2 g5:6 b5:2 g5:2 | " +
  "c5:2 f5:2 a5:4 c6:4 a5:2 f5:2 | g5:2 c6:2 e6:4 c6:2 g5:2 c6:4";

// Over F G C Am: long notes, the whole band holding on.
const WIN_B =
  "c6:6 a5:2 f5:4 a5:4 | d6:6 b5:2 g5:4 b5:4 | " +
  "e6:6 d6:2 c6:4 e6:4 | e6:6 c6:2 a5:4 c6:2 e6:2";

// Over C F C G: the leap again, a fourth higher, and a run into the fanfare.
const WIN_CODA =
  "g5:2 g5:2 g5:2 c6:6 g5:2 e5:2 | a5:2 a5:2 a5:2 c6:6 a5:2 f5:2 | " +
  "g5:2 g5:2 e5:2 g5:2 c6:4 e6:4 | d6:2 d6:2 d6:2 b5:2 g5:4 b5:2 d6:2";

const winRoll = { timpani: "x.x.x.x.xxxxxxXX", snare: "........xxxxxxxx" };
const winFill = { snare: "x.x.xxxx", "tom-high": "......x." };

export const resultsWin: PieceSpec = {
  id: "results-win",
  name: "Victory Lap",
  key: { tonic: "C", scale: "major" },
  bpm: 126,
  swing: 0.08,
  rack: {
    bass: { inst: "slap", level: -2, pan: -0.1, highpass: 40, duck: 0.12, comp: { threshold: -16, ratio: 3, attack: 0.008, release: 0.1 } },
    chords: { inst: "organ-jazz", level: -3.5, pan: 0.3, reverb: 0.15, highpass: 180, rotary: { rate: 6.2, depth: 0.45 } },
    strings: { inst: "string-ens", level: -5, pan: -0.1, reverb: 0.3, chorus: 0.3, highpass: 160 },
    lead: { inst: "brass-section", level: 0, reverb: 0.25, delay: 0.1, highpass: 250 },
    low: { inst: "brass-stab", level: -4, pan: -0.15, reverb: 0.2, highpass: 200 },
    glock: { inst: "ice-bell", level: -5, pan: -0.3, reverb: 0.35, delay: 0.3 },
    arp: { inst: "celesta", level: -8, pan: 0.25, reverb: 0.3, delay: 0.2 },
    drums: { inst: "drums", level: -3, kit: "rock" },
  },
  fx: {
    reverb: { t60: 1.7, size: 0.7, mix: 0.28, predelay: 0.018 },
    delay: { beats: 0.75, feedback: 0.25, tone: 3500, mix: 0.18 },
    master: { air: 2 },
  },
  sections: [
    {
      name: "Fanfare",
      bars: 4,
      chords: "C C F G",
      parts: {
        bass: bass("whole"),
        chords: chords("pad", { vel: 0.6 }),
        strings: chords("pad", { centre: 64, vel: 0.5 }),
        lead: tune(WIN_FANFARE, { vel: 0.9 }),
        low: tune(WIN_FANFARE, { shift: -12, vel: 0.8 }),
        drums: drums({ timpani: "x.......x......." }, { fill: winRoll, fillEvery: 4, crash: true, vel: 0.9 }),
      },
    },
    {
      name: "A",
      bars: 4,
      level: 0.92,
      chords: "C G Am F",
      parts: {
        bass: bass("bounce"),
        chords: chords("offbeat", { roll: 0.008 }),
        strings: chords("pad", { centre: 64, vel: 0.45 }),
        lead: tune(WIN_A1, { vel: 0.85 }),
        drums: drums(
          { kick: "x.......x.x.....", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", tambourine: "..x...x...x...x." },
          { fill: winFill, fillEvery: 4, crash: true },
        ),
      },
    },
    {
      name: "A2",
      bars: 4,
      chords: "C G F C",
      parts: {
        bass: bass("bounce"),
        chords: chords("charleston", { roll: 0.008 }),
        strings: chords("pad", { centre: 64, vel: 0.5 }),
        lead: tune(WIN_A2, { vel: 0.88 }),
        low: tune(WIN_A2, { shift: -12, vel: 0.7 }),
        glock: tune(WIN_A2, { shift: 12, vel: 0.65 }),
        arp: arp("0 1 2 3 2 1 2 1", 2, { base: 72, vel: 0.5 }),
        drums: drums(
          { kick: "x...x...x...x...", clap: "....x.......x...", ride: "x.x.x.x.x.x.x.x.", tambourine: "x.x.x.x.x.x.x.x.", timpani: "x.......x......." },
          { fill: winFill, fillEvery: 4, crash: true },
        ),
      },
    },
    {
      name: "B",
      bars: 4,
      level: 0.95,
      chords: "F G C Am",
      parts: {
        bass: bass("rf"),
        chords: chords("pad", { vel: 0.7 }),
        strings: chords("pad", { centre: 64, vel: 0.65 }),
        lead: tune(WIN_B, { vel: 0.9 }),
        low: tune(WIN_B, { shift: -12, vel: 0.7 }),
        glock: tune(WIN_B, { shift: 12, vel: 0.6 }),
        arp: arp("0 1 2 3 4 3 2 1", 1, { base: 76, octaves: 2, vel: 0.45 }),
        drums: drums(
          { timpani: "x.......x.......", ride: "x...x...x...x...", "kick-soft": "x......." },
          { fill: { snare: "x.x.x.x.xxxxxxxx" }, fillEvery: 2, crash: true },
        ),
      },
    },
    {
      name: "Coda",
      bars: 4,
      level: 1.05,
      chords: "C F C G",
      parts: {
        bass: bass("bounce"),
        chords: chords("charleston", { roll: 0.006, vel: 0.75 }),
        strings: chords("pad", { centre: 64, vel: 0.55 }),
        lead: tune(WIN_CODA, { vel: 0.92 }),
        low: tune(WIN_CODA, { shift: -12, vel: 0.75 }),
        glock: tune(WIN_CODA, { shift: 12, vel: 0.7 }),
        arp: arp("0 1 2 3 2 1 2 3", 2, { base: 76, vel: 0.5 }),
        drums: drums(
          { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", tambourine: "x.x.x.x.x.x.x.x.", timpani: "x.......x......." },
          { fill: winRoll, fillEvery: 4, crash: true },
        ),
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Well Played

// Over Fmaj7 Gm7 Am7 Bbmaj7: the hook rises a sixth, then the line climbs the chords.
const DONE_A =
  "c5:2 f5:2 a5:3 r:1 g5:2 a5:2 c6:4 | bb5:3 g5:1 bb5:2 d6:2 c6:4 bb5:2 a5:2 | " +
  "c6:2 e6:2 g6:4 e6:2 c6:2 a5:4 | d6:4 c6:2 bb5:2 a5:6 r:2";

// Over Fmaj7 Gm7 Am7 C7: the same, with a lift in bar two and a turn at the end.
const DONE_A2 =
  "c5:2 f5:2 a5:3 r:1 g5:2 a5:2 c6:4 | bb5:3 g5:1 bb5:2 d6:2 f6:6 r:2 | " +
  "e6:3 g6:1 e6:2 c6:2 a5:4 c6:2 e6:2 | g5:3 bb5:1 c6:4 bb5:2 g5:2 e5:4";

// Over Dm7 Bbmaj7 Gm7 C7: the bridge, flowing up to the dominant.
const DONE_B =
  "a5:2 d6:2 f6:4 e6:2 d6:2 c6:4 | bb5:2 d6:2 f6:4 d6:2 bb5:2 a5:4 | " +
  "g5:2 bb5:2 d6:4 f6:3 d6:1 bb5:4 | g5:2 bb5:2 c6:4 e6:4 g6:4";

// Over Fmaj7 Bbmaj7 Gm7 C7: home again, settling.
const DONE_A3 =
  "c5:2 f5:2 a5:3 r:1 g5:2 a5:2 c6:4 | bb5:3 d6:1 f6:4 d6:2 bb5:2 a5:4 | " +
  "g5:2 bb5:2 d6:4 c6:2 bb5:2 g5:4 | bb5:3 g5:1 e5:4 g5:2 bb5:2 c6:4";

const brushes = { "kick-soft": "x.......x..x....", "snare-brush": "....x.......x...", shaker: "x.o.x.o.x.o.x.o." };
const brushFill = { "snare-brush": "x.x.xxxx" };

export const resultsDone: PieceSpec = {
  id: "results",
  name: "Well Played",
  key: { tonic: "F", scale: "major" },
  bpm: 100,
  swing: 0.28,
  rack: {
    bass: { inst: "upright", level: -1, pan: -0.1, highpass: 40, comp: { threshold: -17, ratio: 3, attack: 0.012, release: 0.12 } },
    chords: { inst: "rhodes-soft", level: -3.5, pan: 0.3, reverb: 0.2, chorus: 0.25, highpass: 180, tremolo: { rate: 4.4, depth: 0.12, pan: true } },
    strings: { inst: "string-ens", level: -6, pan: -0.05, reverb: 0.3, chorus: 0.35, lowpass: 3500, highpass: 160 },
    lead: { inst: "vibes", level: 0, reverb: 0.3, delay: 0.2, highpass: 200 },
    echo: { inst: "celesta", level: -8, pan: -0.3, reverb: 0.4, delay: 0.3 },
    drums: { inst: "drums", level: -4, kit: "brush" },
  },
  fx: {
    reverb: { t60: 1.8, size: 0.65, mix: 0.3, predelay: 0.02 },
    delay: { beats: 0.75, feedback: 0.3, tone: 3200, mix: 0.2 },
    master: { air: 1 },
  },
  sections: [
    {
      name: "A",
      bars: 4,
      level: 0.92,
      chords: "Fmaj7 Gm7 Am7 Bbmaj7",
      parts: {
        bass: bass("walk"),
        chords: chords("charleston", { roll: 0.012, vel: 0.62 }),
        lead: tune(DONE_A, { vel: 0.8 }),
        drums: drums(brushes, { fill: brushFill, fillEvery: 4, vel: 0.85 }),
      },
    },
    {
      name: "A2",
      bars: 4,
      chords: "Fmaj7 Gm7 Am7 C7",
      parts: {
        bass: bass("walk"),
        chords: chords("strum", { roll: 0.012, vel: 0.65 }),
        strings: chords("pad", { centre: 62, vel: 0.5 }),
        lead: tune(DONE_A2, { vel: 0.82 }),
        echo: tune(DONE_A2, { shift: 12, vel: 0.5 }),
        drums: drums(brushes, { fill: brushFill, fillEvery: 4 }),
      },
    },
    {
      name: "B",
      bars: 4,
      level: 1.02,
      chords: "Dm7 Bbmaj7 Gm7 C7",
      parts: {
        bass: bass("rf"),
        chords: chords("hold2", { roll: 0.01, vel: 0.62 }),
        strings: chords("pad", { centre: 64, vel: 0.65 }),
        lead: tune(DONE_B, { vel: 0.85 }),
        drums: drums({ ...brushes, tambourine: "....x.......x..." }, { fill: { "snare-brush": "x.x.x.xxxxxxxxxx" }, fillEvery: 4 }),
      },
    },
    {
      name: "A3",
      bars: 4,
      chords: "Fmaj7 Bbmaj7 Gm7 C7",
      parts: {
        bass: bass("walk"),
        chords: chords("strum", { roll: 0.012, vel: 0.68 }),
        strings: chords("pad", { centre: 62, vel: 0.55 }),
        lead: tune(DONE_A3, { vel: 0.84 }),
        echo: tune(DONE_A3, { shift: 12, vel: 0.5 }),
        drums: drums({ ...brushes, rim: "......x.......x." }, { fill: brushFill, fillEvery: 4 }),
      },
    },
  ],
};
