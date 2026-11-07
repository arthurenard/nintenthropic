/**
 * The two jingles that close a race for a player, each played once (they are
 * one-shots, not loops): a brass fanfare for a win, and a gentle, rueful
 * descent for the rest.
 */
import { arp, bass, chords, drums, tune } from "./dsl";
import type { PieceSpec } from "../score";

// Three bars over C | F G | C: a climbing C chord, a lift through F to the dominant, then the big held C.
const WIN = "g4:3 g4:1 c5:3 e5:1 g5:8 | a5:3 a5:1 c6:4 b5:4 d6:4 | c6:12 r:4";

export const jingleWin: PieceSpec = {
  id: "jingle-win",
  name: "Winner",
  key: { tonic: "C", scale: "major" },
  bpm: 132,
  swing: 0.06,
  oneShot: true,
  rack: {
    lead: { inst: "brass-section", level: 0, reverb: 0.25, delay: 0.1, highpass: 250 },
    low: { inst: "brass-stab", level: -4, pan: -0.2, reverb: 0.22, highpass: 200 },
    strings: { inst: "string-ens", level: -5, pan: 0.1, reverb: 0.3, chorus: 0.3, highpass: 160 },
    glock: { inst: "ice-bell", level: -5, pan: 0.3, reverb: 0.4, delay: 0.25 },
    bass: { inst: "bass-pick", level: -3, highpass: 40 },
    drums: { inst: "drums", level: -2.5, kit: "rock" },
  },
  fx: { reverb: { t60: 1.8, size: 0.7, mix: 0.3, predelay: 0.018 }, delay: { beats: 0.75, feedback: 0.25, tone: 3500, mix: 0.12 }, master: { air: 2 } },
  sections: [
    {
      name: "Fanfare",
      bars: 3,
      chords: "C F|G C",
      parts: {
        lead: tune(WIN),
        low: tune(WIN, { shift: -12, vel: 0.75 }),
        strings: chords("pad", { vel: 0.6 }),
        glock: arp("0 1 2 3 4 3 2 1", 1, { base: 84, octaves: 1, vel: 0.5 }),
        bass: bass("root4", { vel: 0.8 }),
        drums: drums({ timpani: "x.......x.x.x.xx", snare: "........x.x.xxxx" }, { crash: true }),
      },
    },
  ],
};

// Three bars over Dm | Gm | Dm: two sighs falling and a last, resolved low note.
const LOSE = "a5:4 g5:4 f5:8 | g5:6 f5:2 e5:4 d5:4 | d5:12 r:4";

export const jingleLose: PieceSpec = {
  id: "jingle-lose",
  name: "Next Time",
  key: { tonic: "D", scale: "minor" },
  bpm: 88,
  swing: 0.3,
  oneShot: true,
  rack: {
    lead: { inst: "trumpet-mute", level: 0, reverb: 0.3, delay: 0.1, highpass: 300 },
    chords: { inst: "rhodes-soft", level: -4, pan: 0.25, reverb: 0.25, chorus: 0.2, highpass: 180 },
    strings: { inst: "string-ens", level: -6, pan: -0.1, reverb: 0.35, highpass: 160 },
    bass: { inst: "upright", level: -2, pan: -0.1, highpass: 40 },
    drums: { inst: "drums", level: -5, kit: "brush" },
  },
  fx: { reverb: { t60: 1.9, size: 0.7, mix: 0.3, predelay: 0.02 }, delay: { beats: 0.75, feedback: 0.25, tone: 3000, mix: 0.12 }, master: { air: 0.5 } },
  sections: [
    {
      name: "Sigh",
      bars: 3,
      chords: "Dm Gm Dm",
      parts: {
        lead: tune(LOSE),
        chords: chords("hold2", { roll: 0.02, vel: 0.55 }),
        strings: chords("pad", { vel: 0.5 }),
        bass: bass("walk", { vel: 0.7 }),
        drums: drums({ "snare-brush": "....x.......x..." }, { vel: 0.6 }),
      },
    },
  ],
};
