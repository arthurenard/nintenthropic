/**
 * Just enough music theory for a sequencer that is written in note names and
 * chord symbols: names to MIDI numbers, chord symbols to chord tones, voicings
 * that move as little as they can from one chord to the next, and the scales
 * the tests check a melody against.
 */

const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** MIDI note number to Hz (A4 = 69 = 440 Hz). */
export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * A note name ("c4", "f#3", "bb5", "C#4") to a MIDI number, middle C being
 * c4 = 60. Throws on text that is not a note: a typo in a tune should fail
 * loudly in a test, not play a wrong note.
 */
export function noteToMidi(name: string): number {
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`not a note: "${name}"`);
  const base = LETTERS[m[1]!.toLowerCase()]!;
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + base + accidental;
}

/** A pitch-class name ("C", "F#", "Bb") to 0..11. */
export function pitchClass(name: string): number {
  const m = /^([A-Ga-g])([#b]?)$/.exec(name);
  if (!m) throw new Error(`not a pitch class: "${name}"`);
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return (((LETTERS[m[1]!.toLowerCase()]! + accidental) % 12) + 12) % 12;
}

/** Chord qualities: the semitones above the root of each chord tone, lowest first. */
export const QUALITIES: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  "5": [0, 7, 12],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  "7sus4": [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "9": [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  "69": [0, 4, 7, 9, 14],
};

export interface Chord {
  /** The symbol it was written as. */
  symbol: string;
  /** Root pitch class 0..11. */
  root: number;
  /** Bass pitch class (the root unless written "C/E"). */
  bass: number;
  quality: string;
  /** Semitones above the root. */
  intervals: readonly number[];
}

/** "Am7", "F#m", "Bb/D", "G7sus4" → a chord. */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(symbol);
  if (!m) throw new Error(`not a chord: "${symbol}"`);
  const quality = m[2]!;
  const intervals = QUALITIES[quality];
  if (!intervals) throw new Error(`unknown chord quality "${quality}" in "${symbol}"`);
  const root = pitchClass(m[1]!);
  return { symbol, root, bass: m[3] ? pitchClass(m[3]) : root, quality, intervals };
}

/** The pitch classes of a chord, 0..11, lowest tone first. */
export function chordPitchClasses(chord: Chord): number[] {
  return chord.intervals.map((i) => (chord.root + i) % 12);
}

/**
 * A voicing: the chord's tones placed within [lo, hi] so that the total
 * distance each voice moves from ``previous`` is smallest — the smooth voice
 * leading a keyboard player does without thinking. Without a previous voicing,
 * the root position nearest ``centre``.
 */
export function voicing(chord: Chord, previous: readonly number[] | null, centre: number, size = 4, lo = 48, hi = 84): number[] {
  const classes = chordPitchClasses(chord);
  const pcs = classes.slice(0, Math.max(3, Math.min(size, classes.length)));
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inversion = 0; inversion < pcs.length; inversion++) {
    const ordered = pcs.slice(inversion).concat(pcs.slice(0, inversion));
    for (let shift = -2; shift <= 2; shift++) {
      const notes: number[] = [];
      let floor = Math.round(centre - 7) + shift * 12;
      for (const pc of ordered) {
        let n = floor - (((floor - pc) % 12) + 12) % 12;
        while (n < floor) n += 12;
        notes.push(n);
        floor = n + 1;
      }
      if (notes[0]! < lo || notes[notes.length - 1]! > hi) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost: number;
      if (previous && previous.length > 0) {
        cost = 0;
        for (let k = 0; k < notes.length; k++) cost += Math.abs(notes[k]! - previous[Math.min(k, previous.length - 1)]!);
        cost += Math.abs(mean - centre) * 0.3;
      } else {
        cost = Math.abs(mean - centre) + (inversion === 0 ? 0 : 1.5);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  if (best.length === 0) {
    // Out of range everywhere: root position at the centre.
    best = pcs.map((pc) => {
      let n = Math.round(centre) - (((Math.round(centre) - pc) % 12) + 12) % 12;
      if (n < lo) n += 12;
      return n;
    });
    best.sort((a, b) => a - b);
  }
  return best;
}

/** A bass note for pitch class ``pc`` in the octave starting at ``floor`` (floor .. floor + 11). */
export function bassNote(pc: number, floor: number): number {
  return floor + ((((pc - floor) % 12) + 12) % 12);
}

export type ScaleName =
  | "major"
  | "minor"
  | "dorian"
  | "mixolydian"
  | "lydian"
  | "harmonic-minor"
  | "pentatonic-major"
  | "pentatonic-minor"
  | "blues";

const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  "pentatonic-major": [0, 2, 4, 7, 9],
  "pentatonic-minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

/** The pitch classes of a scale on a tonic. */
export function scalePitchClasses(tonic: string, scale: ScaleName): number[] {
  const t = pitchClass(tonic);
  return SCALES[scale].map((i) => (t + i) % 12);
}
