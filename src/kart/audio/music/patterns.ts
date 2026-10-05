/**
 * The stock rhythms a band plays without being told: bass lines, chord
 * comping and drum grooves, as small tables of (step, what, how long) over a
 * bar of sixteenth-note steps. A section of a piece names one ("walk",
 * "offbeat") and the sequencer fits it to the chords. Steps count sixteenths
 * from the start of the bar; a 4/4 bar has 16 steps, a waltz bar 12.
 *
 * Patterns for 4/4 are written over 16 steps and folded for shorter slots (a
 * bar shared by two chords gets the first half of the pattern for each), and
 * the few waltz patterns are written over 12.
 */

/** What a bass note is, relative to the chord. */
export type BassDegree = "r" | "5" | "8" | "3" | "7" | "-5" | "-8" | "a";

interface BassStep {
  step: number;
  degree: BassDegree;
  /** Length in steps (may be fractional: a note shorter than its step is staccato). */
  dur: number;
  /** Accent multiplier. */
  accent: number;
}

function bassTemplate(text: string): BassStep[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [step, degree, dur, accent] = token.split(":");
      return { step: Number(step), degree: degree as BassDegree, dur: Number(dur), accent: accent ? Number(accent) : 1 };
    });
}

const eighths = (degree: string, dur: number): string => Array.from({ length: 8 }, (_, k) => `${k * 2}:${degree}:${dur}`).join(" ");
const sixteenths = (dur: number): string =>
  Array.from({ length: 16 }, (_, k) => `${k}:${k % 4 === 2 ? "8" : "r"}:${dur}:${k % 4 === 0 ? 1.1 : k % 4 === 2 ? 0.85 : 0.7}`).join(" ");

export const BASS_PATTERNS = {
  whole: bassTemplate("0:r:15"),
  root4: bassTemplate("0:r:3 4:r:3 8:r:3 12:r:3"),
  root8: bassTemplate(eighths("r", 1.7)),
  /** Root and fifth on the beats: the oom of an oom-pah. */
  rf: bassTemplate("0:r:3 4:5:3 8:r:3 12:5:3"),
  /** Root on one, fifth on three. */
  oompah: bassTemplate("0:r:3 8:5:3"),
  /** A syncopated pop bounce with octave jumps. */
  bounce: bassTemplate("0:r:2.5 3:8:1 6:r:2 8:5:2.5 11:8:1 14:r:1.5"),
  /** A walking line, quarter notes, leaning on the next chord's root. */
  walk: bassTemplate("0:r:3.4 4:3:3.4 8:5:3.4 12:a:3.4"),
  /** Sixteenth pulse with octave accents: synthwave. */
  pulse16: bassTemplate(sixteenths(0.9)),
  /** Straight eighths, a fifth at the end of the bar: rock. */
  drive8: bassTemplate(`${eighths("r", 1.6).split(" ").slice(0, 7).join(" ")} 14:5:1.6`),
  /** Sixteenth, sixteenth, eighth: the gallop under a western. */
  gallop: bassTemplate(Array.from({ length: 4 }, (_, b) => `${b * 4}:r:0.9 ${b * 4 + 1}:r:0.9 ${b * 4 + 2}:r:1.8`).join(" ")),
  /** 3 + 3 + 2, twice: calypso. */
  tresillo: bassTemplate("0:r:2.6 3:5:2.6 6:r:1.8 8:r:2.6 11:5:2.6 14:r:1.6"),
  /** Reggae/ska: the bass on the off-beats. */
  offbeat: bassTemplate("2:r:2 6:r:2 10:r:2 14:r:2"),
  /** Broken chord in eighths. */
  broken8: bassTemplate("0:r:1.8 2:5:1.8 4:8:1.8 6:5:1.8 8:r:1.8 10:5:1.8 12:8:1.8 14:5:1.8"),
  /** Waltz: the bass on one, over 12 steps. */
  waltz: bassTemplate("0:r:3.5"),
  /** Waltz with the fifth answering on the third beat. */
  waltz2: bassTemplate("0:r:3.5 8:5:3"),
} as const;

export type BassPatternName = keyof typeof BASS_PATTERNS;

/** A comping rhythm: hits at (step, length). */
function comp(text: string): { step: number; dur: number }[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [step, dur] = token.split(":");
      return { step: Number(step), dur: Number(dur) };
    });
}

const allEighths = (dur: number): string => Array.from({ length: 8 }, (_, k) => `${k * 2}:${dur}`).join(" ");

export const COMP_PATTERNS = {
  pad: comp("0:15.5"),
  hold2: comp("0:7.5 8:7.5"),
  offbeat: comp("2:1.6 6:1.6 10:1.6 14:1.6"),
  /** The pah of an oom-pah: beats two and four. */
  oompah: comp("4:2.4 12:2.4"),
  charleston: comp("0:3.5 6:2"),
  freddie: comp("0:2.6 4:2.6 8:2.6 12:2.6"),
  stab8: comp(allEighths(1.5)),
  gate16: comp("0:1.2 1:1.2 3:1.2 4:1.2 6:1.2 8:1.2 9:1.2 11:1.2 12:1.2 14:1.2"),
  sync: comp("0:3 3:3 6:2 8:3 11:3 14:2"),
  strum: comp("0:2.8 4:2.4 6:1.6 10:1.6 12:2.4 14:1.6"),
  quarters: comp("0:3.5 4:3.5 8:3.5 12:3.5"),
  /** Beats two and three of a waltz (12 steps). */
  waltz: comp("4:3 8:3"),
  /** All three beats of a waltz, held a little. */
  waltzAll: comp("0:3.4 4:3.4 8:3.4"),
  /** Marching two-beat feel: chord on each beat, clipped. */
  march: comp("0:2.2 4:2.2 8:2.2 12:2.2"),
} as const;

export type CompPatternName = keyof typeof COMP_PATTERNS;

/** Convert "r" and friends to semitones above the chord root (the sequencer adds approach notes itself). */
export function degreeSemitones(degree: BassDegree, chordIntervals: readonly number[]): number {
  switch (degree) {
    case "r":
      return 0;
    case "5":
      return 7;
    case "8":
      return 12;
    case "-5":
      return -5;
    case "-8":
      return -12;
    case "3":
      return chordIntervals[1] ?? 4;
    case "7":
      return chordIntervals[3] ?? 10;
    case "a":
      return 0;
  }
}
