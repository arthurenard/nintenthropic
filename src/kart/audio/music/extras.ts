/**
 * The two short extras a race theme carries, written as little pieces of their
 * own in the theme's key:
 *
 *   the comet layer   one bar of tambourine, shaker and glittering bell pings
 *                     that loops over the music while a comet burns
 *   the stinger       a brass fanfare of two bars that plays as the music lifts
 *                     into the final lap
 */
import { pitchClass } from "./theory";
import { bass, chords, drums, tune } from "./pieces/dsl";
import type { PieceSpec } from "./score";

const NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
const MINORISH = new Set(["minor", "dorian", "harmonic-minor", "pentatonic-minor", "blues"]);

/** The invincibility layer: one bar, in the theme's key and tempo, that loops. */
export function cometSpec(spec: PieceSpec): PieceSpec {
  const pc = pitchClass(spec.key.tonic);
  const root = NAMES[pc]!;
  const fifth = NAMES[(pc + 7) % 12]!;
  const ping = `${root}6:2 ${fifth}6:2 ${root}7:2 ${fifth}6:2 ${root}6:2 ${fifth}7:2 ${root}7:2 ${fifth}6:2`;
  return {
    id: `${spec.id}-comet`,
    name: "Comet layer",
    key: spec.key,
    bpm: spec.sections[0]!.bpm ?? spec.bpm,
    swing: Math.min(spec.swing ?? 0, 0.3),
    rack: {
      bells: { inst: "ice-bell", level: 0, pan: 0.15, reverb: 0.45, delay: 0.3 },
      perc: { inst: "drums", level: -3, kit: "pop" },
    },
    fx: { reverb: { t60: 1.2, size: 0.5, mix: 0.3 }, delay: { beats: 0.75, feedback: 0.35, tone: 5000, mix: 0.25 } },
    sections: [
      {
        name: "Sparkle",
        bars: 1,
        chords: `${spec.key.tonic}5`,
        parts: {
          bells: tune(ping, { vel: 0.7 }),
          perc: drums({ tambourine: "XoxoXoxoXoxoXoxo", shaker: "x.x.x.x.x.x.x.x.", hat: "..x...x...x...x." }),
        },
      },
    ],
  };
}

/** The final-lap fanfare, in the theme's key (the render's transpose carries it up with the lifted music). */
export function stingerSpec(spec: PieceSpec): PieceSpec {
  const pc = pitchClass(spec.key.tonic);
  const shift = pc > 6 ? pc - 12 : pc;
  const minor = MINORISH.has(spec.key.scale);
  const third = minor ? "eb" : "e";
  const sixth = minor ? "ab" : "a";
  const hit = `c5:3 c5:1 ${third}5:2 g5:2 c6:8`;
  const land = `g5:3 ${sixth}5:1 g5:2 ${third}5:2 c6:6 r:2`;
  const chord = minor ? `${spec.key.tonic}m` : spec.key.tonic;
  const bpm = spec.sections[0]!.bpm ?? spec.bpm;
  return {
    id: `${spec.id}-stinger`,
    name: "Final lap",
    key: spec.key,
    bpm,
    oneShot: true,
    rack: {
      lead: { inst: "brass-stab", level: 0, reverb: 0.3, delay: 0.1 },
      low: { inst: "brass-section", level: -3, pan: -0.2, reverb: 0.3 },
      chords: { inst: "string-ens", level: -5, pan: 0.15, reverb: 0.35 },
      bass: { inst: "bass-pick", level: -3 },
      drums: { inst: "drums", level: -2, kit: "rock" },
    },
    fx: { reverb: { t60: 1.6, size: 0.6, mix: 0.3 }, delay: { beats: 0.75, feedback: 0.25, tone: 3500, mix: 0.12 } },
    sections: [
      {
        name: "Hit",
        bars: 1,
        chords: chord,
        parts: {
          lead: tune(hit, { shift }),
          low: tune(hit, { shift: shift - 12, vel: 0.75 }),
          chords: chords("pad", { vel: 0.6 }),
          bass: bass("root8", { vel: 0.8 }),
          drums: drums({ snare: "x.x.x.x.xxxxxxXX", "tom-low": "x.......x.......", "kick": "x...x...x.x.x.x." }),
        },
      },
      {
        name: "Land",
        bars: 1,
        chords: chord,
        parts: {
          lead: tune(land, { shift }),
          low: tune(land, { shift: shift - 12, vel: 0.75 }),
          chords: chords("pad", { vel: 0.6 }),
          bass: bass("whole", { vel: 0.9 }),
          drums: drums({ crash: "X...............", kick: "X...............", "tom-low": "....X..." }, { vel: 1 }),
        },
      },
    ],
  };
}
