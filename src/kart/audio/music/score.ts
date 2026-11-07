/**
 * The sequencer: a piece written as sections of bars, chords and parts is
 * compiled into a *score*, a flat list of timed notes and drum hits in
 * seconds. Nothing here makes a sound or touches Web Audio, so the timing, the
 * lengths of the loops and the tempo of the final lap are all tested in Node.
 *
 * Time is kept in sixteenth-note *steps*. A bar has `beats × 4` of them (16 in
 * 4/4, 12 in a waltz). Swing delays the off-beat sixteenths toward a triplet
 * feel, and the same piece compiles at any `tempoScale` and any `transpose`:
 * the final lap is the same score at 1.1× the tempo and a semitone up.
 *
 * Parts come in five kinds. Bass, chords and arpeggios are *generated* from
 * the section's chord symbols: bass and chords from a named rhythm (see
 * ./patterns.ts), arpeggios from a run of chord-tone indices; a melody is written out in a little notation, "e5:2 g5:2 a5:4 | r:4 ...", one
 * token per note (name, then length in steps; `r` is a rest, `+` stacks a
 * chord, `!` accents, `'` is staccato); drums are rows of characters, one per
 * step ("x...x...": x a hit, X an accent, o a ghost note).
 */
import { Rng, hashSeed } from "../../../audio/dsp/rng";
import type { DrumKind } from "../../../audio/dsp/voices";
import { BASS_PATTERNS, COMP_PATTERNS, type BassPatternName, type CompPatternName, degreeSemitones } from "./patterns";
import type { KitStyle } from "./kit";
import { type Chord, type ScaleName, bassNote, chordPitchClasses, noteToMidi, parseChord, voicing } from "./theory";

// --- what a piece is made of -----------------------------------------------------------------------

export interface BassPart {
  kind: "bass";
  pattern: BassPatternName;
  /** MIDI note the bass octave starts on (default 36: the roots fall in C2..B2). */
  floor?: number;
  vel?: number;
}

export interface ChordsPart {
  kind: "chords";
  comp: CompPatternName;
  /** The middle of the voicing, MIDI (default 62). */
  centre?: number;
  /** Notes in the voicing, 3 or 4 (default 4). */
  size?: number;
  vel?: number;
  /** Seconds between the strings of a strum, low to high (0 for a block chord). */
  roll?: number;
}

export interface ArpPart {
  kind: "arp";
  /** Indices into the ladder of chord tones (0 the lowest tone, len the root an octave up...), e.g. "0 1 2 3 2 1". */
  pattern: string;
  /** Steps between notes (1 = sixteenths, 2 = eighths). */
  every: number;
  /** The ladder starts at the first chord tone at or above this MIDI note (default 60). */
  base?: number;
  /** The ladder's length in octaves (default 2). */
  octaves?: number;
  /** Fraction of the step each note sounds (default 0.8). */
  gate?: number;
  vel?: number;
}

export interface NotesPart {
  kind: "notes";
  /** The tune, bar lines optional; its steps must fill the section exactly. */
  notes: string;
  vel?: number;
  /** Plays the tune this many semitones higher (an octave for a doubling: 12). */
  shift?: number;
}

export interface DrumsPart {
  kind: "drums";
  /** Per drum, one bar of characters (16 for 4/4, 12 for a waltz); a shorter row repeats to fill the bar. */
  groove: Partial<Record<DrumKind, string>>;
  /** In the last steps of every ``fillEvery``-th bar these rows replace the groove's (right-aligned to the bar's end); the hats, shaker and ride stop. */
  fill?: Partial<Record<DrumKind, string>>;
  fillEvery?: number;
  /** A crash on the first beat of the section. */
  crash?: boolean;
  vel?: number;
}

export type Part = BassPart | ChordsPart | ArpPart | NotesPart | DrumsPart;

export interface SectionSpec {
  name: string;
  bars: number;
  /** Tempo for this section, quarter notes a minute (default the piece's). */
  bpm?: number;
  /** Beats a bar (default the piece's: 4; a waltz has 3). */
  beats?: number;
  /** Chord symbols, one per bar and repeated to fill; "C|G" splits a bar between two chords. */
  chords: string;
  /** Who plays what, by the rack's part names. A part not named is silent here. */
  parts: Record<string, Part>;
  /** Everything's velocity, a build-up or a breakdown (default 1). */
  level?: number;
  /**
   * A modulation: every pitched part of the section (and the chords it is written over) plays this many semitones higher
   * than written, so a final chorus can be the same chorus a tone up without being written twice.
   */
  shift?: number;
}

export interface RackEntry {
  /** An instrument of the catalogue (./instruments.ts), or "drums". */
  inst: string;
  /**
   * Loudness in the mix, dB relative to the reference: 0 is as loud as the
   * lead should be, -3 a little behind it. The renderer measures the part
   * and sets it there, so instruments need no trimming against each other.
   */
  level: number;
  /** -1..1. */
  pan?: number;
  /** Sends to the reverb and the delay, 0..1. */
  reverb?: number;
  delay?: number;
  /** Stereo thickening: 0 none .. 1 a lot. */
  chorus?: number;
  /** A low-pass over the whole part, Hz. */
  lowpass?: number;
  /** A high-pass over the whole part, Hz (keeps the low end clear for the bass and the kick). */
  highpass?: number;
  /** Peaking EQ bands, [Hz, Q, dB]. */
  eq?: readonly (readonly [number, number, number])[];
  /** Saturation of the summed part (a guitar amp, a tape): 1 clean, 3 crunchy, 6 fuzz. */
  drive?: number;
  /** A rotating speaker: rate Hz (slow 0.7, fast 6.5) and depth 0..1. */
  rotary?: { rate: number; depth: number };
  /** Tremolo or auto-pan: rate Hz, depth 0..1. */
  tremolo?: { rate: number; depth: number; pan?: boolean };
  /** A compressor on the part. */
  comp?: { threshold: number; ratio: number; attack: number; release: number; makeup?: number };
  /** Sidechain pump: the part ducks by this much (0..1) at every kick of the piece's drums. */
  duck?: number;
  /** Stereo width of the part (1 as it is). */
  width?: number;
  /** For drums: the kit (see ./kit.ts). */
  kit?: KitStyle;
}

export interface PieceFx {
  /** Reverb tail, seconds to fall 60 dB; size 0..1; the wet return level. */
  reverb: { t60: number; size: number; mix: number; predelay?: number; damping?: number };
  /** Ping-pong delay: time in beats, feedback 0..0.8, darkness (low-pass Hz), return level. */
  delay?: { beats: number; feedback: number; tone: number; mix: number };
  /** The bus: glue compression threshold (dBFS, default -22), stereo width (default 1.12) and air (high shelf dB at 9 kHz, default 1.5). */
  master?: { glue?: number; width?: number; air?: number };
}

export interface PieceSpec {
  id: string;
  name: string;
  key: { tonic: string; scale: ScaleName };
  bpm: number;
  beats?: number;
  /** 0 straight .. 1 full triplet swing. */
  swing?: number;
  rack: Record<string, RackEntry>;
  sections: SectionSpec[];
  fx: PieceFx;
  /** A one-shot (a jingle, a stinger): played once, never folded into a loop, its tail left to ring. */
  oneShot?: boolean;
  /** A race theme: it also gets the invincibility layer and, in its final-lap version, the stinger. */
  race?: boolean;
}

// --- what a score is ------------------------------------------------------------------------------------

export interface ScoreBar {
  start: number;
  dur: number;
  beats: number;
  bpm: number;
  section: number;
  /** Which bar of its section. */
  index: number;
}

export interface ScoreNote {
  part: string;
  time: number;
  /** Seconds the key is held. */
  dur: number;
  midi: number;
  vel: number;
  /** The chord sounding when the note starts, as written (for checking a tune against its harmony). */
  chord?: string;
  /** The sixteenth-note step of the bar it starts on (tunes only). */
  step?: number;
  /** The section's modulation, semitones (0 in the piece's own key); the chord symbol above is as written, before it. */
  shift?: number;
}

export interface ScoreHit {
  part: string;
  time: number;
  kind: DrumKind;
  vel: number;
}

export interface Score {
  id: string;
  /** The loop's length, seconds: where the music comes back round. */
  duration: number;
  bars: ScoreBar[];
  notes: ScoreNote[];
  hits: ScoreHit[];
  /** Where each section starts and ends in the score, seconds. */
  sections: { name: string; start: number; end: number }[];
  /** Mistakes found while compiling (a tune that does not fill its section...). Empty in a good piece. */
  warnings: string[];
  tempoScale: number;
  transpose: number;
}

export interface CompileOptions {
  /** Plays the piece this many times faster (the final lap: 1.1). */
  tempoScale?: number;
  /** Shifts every pitched part this many semitones (the final lap: 1). */
  transpose?: number;
  /** Tiny seeded slips of time and force, as a player has (default on). */
  humanise?: boolean;
}

// --- parsing ----------------------------------------------------------------------------------------------------

export interface ParsedNote {
  /** Step within the section. */
  step: number;
  /** One pitch, or several for a chord. */
  midi: number[];
  dur: number;
  accent: boolean;
  staccato: boolean;
}

/** The notation of a `notes` part to events, and the total steps it fills. */
export function parseNotes(text: string): { notes: ParsedNote[]; steps: number } {
  const notes: ParsedNote[] = [];
  let step = 0;
  for (const raw of text.replace(/\|/g, " ").split(/\s+/)) {
    if (!raw) continue;
    const m = /^(r|[a-gA-G][#b]?-?\d(?:\+[a-gA-G][#b]?-?\d)*)([!']*)(?::(\d+(?:\.\d+)?))?([!']*)$/.exec(raw);
    if (!m) throw new Error(`bad note token "${raw}"`);
    const dur = m[3] ? Number(m[3]) : 2;
    const marks = m[2]! + m[4]!;
    if (m[1] !== "r") {
      notes.push({ step, midi: m[1]!.split("+").map(noteToMidi), dur, accent: marks.includes("!"), staccato: marks.includes("'") });
    }
    step += dur;
  }
  return { notes, steps: step };
}

/** "C G|D Am" → for each bar, its chords with the share of the bar each takes. */
export function parseChordBars(text: string): Chord[][] {
  return text
    .trim()
    .split(/\s+/)
    .map((bar) => bar.split("|").map(parseChord));
}

// --- timing ----------------------------------------------------------------------------------------------------------

/** Where a straight position in the beat (0..1) falls when swung: the off-beat eighth moves from 0.5 toward 2/3. */
export function swungBeat(fraction: number, swing: number): number {
  const off = 0.5 + swing * (2 / 3 - 0.5);
  return fraction < 0.5 ? fraction * (off / 0.5) : off + (fraction - 0.5) * ((1 - off) / 0.5);
}

/** Seconds from the bar's start to ``step`` (fractional steps allowed). */
export function stepOffset(bar: { beats: number; bpm: number }, step: number, swing: number, tempoScale: number): number {
  const beatDur = 60 / (bar.bpm * tempoScale);
  const beat = step / 4;
  const whole = Math.floor(beat + 1e-9);
  return (whole + swungBeat(beat - whole, swing)) * beatDur;
}

const DRUM_CHAR_VEL: Record<string, number> = { x: 0.85, X: 1, o: 0.45, "+": 0.65 };

/** One bar of a drum row to the bar's steps: stripped of separators and repeated to fill. */
function drumRow(row: string, steps: number): string[] {
  const chars = row.replace(/[|\s]/g, "").split("");
  if (chars.length === 0) return new Array(steps).fill(".");
  const out: string[] = [];
  for (let i = 0; i < steps; i++) out.push(chars[i % chars.length]!);
  return out;
}

// --- compiling ------------------------------------------------------------------------------------------------------------

export function compile(spec: PieceSpec, options: CompileOptions = {}): Score {
  const tempoScale = options.tempoScale ?? 1;
  const transpose = options.transpose ?? 0;
  const humanise = options.humanise ?? true;
  const swing = spec.swing ?? 0;
  const rng = new Rng(hashSeed("score", spec.id));
  const warnings: string[] = [];
  const bars: ScoreBar[] = [];
  const notes: ScoreNote[] = [];
  const hits: ScoreHit[] = [];
  const sections: Score["sections"] = [];

  let clock = 0;
  spec.sections.forEach((section, sectionIndex) => {
    const beats = section.beats ?? spec.beats ?? 4;
    const bpm = section.bpm ?? spec.bpm;
    const stepsPerBar = beats * 4;
    const barDur = (beats * 60) / (bpm * tempoScale);
    const chordBars = parseChordBars(section.chords);
    const level = section.level ?? 1;
    const modulation = section.shift ?? 0;
    const sectionStart = clock;
    const firstBar = bars.length;
    for (let b = 0; b < section.bars; b++) bars.push({ start: clock + b * barDur, dur: barDur, beats, bpm: bpm * tempoScale, section: sectionIndex, index: b });
    const barAt = (b: number): ScoreBar => bars[firstBar + b]!;

    /** The time of step ``step`` of bar ``b`` of this section (the bar's bpm already carries the tempo scale, so none is applied again). */
    const when = (b: number, step: number): number => barAt(b).start + stepOffset(barAt(b), step, swing, 1);

    const slip = (): number => (humanise ? rng.range(-0.005, 0.005) : 0);
    const force = (v: number): number => Math.min(1, Math.max(0.05, v * level * (humanise ? rng.range(0.93, 1.07) : 1)));
    const length = (steps: number, b: number): number => steps * (barAt(b).dur / stepsPerBar);

    for (const [name, part] of Object.entries(section.parts)) {
      if (!spec.rack[name]) warnings.push(`${spec.id}/${section.name}: part "${name}" is not in the rack`);
      switch (part.kind) {
        case "bass": {
          const template = BASS_PATTERNS[part.pattern];
          const floor = part.floor ?? 36;
          // What follows the last bar is the next section's first chord (round to the first at the end of the piece).
          const upcoming = parseChordBars(spec.sections[(sectionIndex + 1) % spec.sections.length]!.chords)[0]![0]!;
          for (let b = 0; b < section.bars; b++) {
            const slots = chordBars[b % chordBars.length]!;
            const next = b + 1 < section.bars ? chordBars[(b + 1) % chordBars.length]![0]! : upcoming;
            const slotLen = stepsPerBar / slots.length;
            slots.forEach((chord, j) => {
              const following = j + 1 < slots.length ? slots[j + 1]! : next;
              const base = bassNote(chord.bass, floor);
              let last = base;
              for (const item of template) {
                if (item.step >= slotLen) continue;
                const at = j * slotLen + item.step;
                let midi: number;
                if (item.degree === "a") {
                  // The next chord's root in whichever octave is nearest the line, approached from the semitone on the near side.
                  const home = bassNote(following.bass, floor);
                  const target =
                    [home - 12, home, home + 12]
                      .filter((n) => n >= floor - 4 && n <= floor + 19)
                      .sort((x, y) => Math.abs(x - last) - Math.abs(y - last))[0] ?? home;
                  midi = last < target ? target - 1 : target + 1;
                } else if (item.degree === "r") {
                  midi = base;
                } else {
                  // The fifth, third and octave are the chord's own (a slash chord's bass note is only where the line starts).
                  midi = bassNote(chord.root, floor) + degreeSemitones(item.degree, chord.intervals);
                  // The line stays inside a sensible range for a bass (two octaves from the floor).
                  while (midi > floor + 24) midi -= 12;
                }
                last = midi;
                notes.push({
                  part: name,
                  time: when(b, at) + slip(),
                  dur: length(Math.min(item.dur, slotLen - item.step), b),
                  midi: midi + transpose + modulation,
                  vel: force((part.vel ?? 0.85) * item.accent),
                });
              }
            });
          }
          break;
        }
        case "chords": {
          const template = COMP_PATTERNS[part.comp];
          let previous: number[] | null = null;
          for (let b = 0; b < section.bars; b++) {
            const slots = chordBars[b % chordBars.length]!;
            const slotLen = stepsPerBar / slots.length;
            slots.forEach((chord, j) => {
              const v = voicing(chord, previous, part.centre ?? 62, part.size ?? 4);
              previous = v;
              for (const hit of template) {
                if (hit.step >= slotLen) continue;
                const at = j * slotLen + hit.step;
                const dur = length(Math.min(hit.dur, slotLen - hit.step), b);
                v.forEach((midi, k) => {
                  notes.push({
                    part: name,
                    time: when(b, at) + (part.roll ?? 0) * k + slip(),
                    dur,
                    midi: midi + transpose + modulation,
                    vel: force((part.vel ?? 0.7) * (1 - 0.04 * k)),
                  });
                });
              }
            });
          }
          break;
        }
        case "arp": {
          const indices = part.pattern.trim().split(/\s+/).map(Number);
          const octaves = part.octaves ?? 2;
          for (let b = 0; b < section.bars; b++) {
            const slots = chordBars[b % chordBars.length]!;
            const slotLen = stepsPerBar / slots.length;
            slots.forEach((chord, j) => {
              const pcs = chordPitchClasses(chord).slice(0, 4);
              const ladder: number[] = [];
              const base = part.base ?? 60;
              let low = base - (((base - pcs[0]!) % 12) + 12) % 12;
              if (low < base) low += 12;
              // Tones above the first, kept ascending.
              for (let o = 0; o < octaves; o++) {
                for (const pc of pcs) {
                  let n = low + o * 12 + (((pc - low) % 12) + 12) % 12;
                  if (ladder.length > 0 && n <= ladder[ladder.length - 1]!) n += 12;
                  ladder.push(n);
                }
              }
              for (let s = 0; s < slotLen; s += part.every) {
                const k = Math.round((j * slotLen + s) / part.every);
                const index = indices[k % indices.length]! % ladder.length;
                const at = j * slotLen + s;
                notes.push({
                  part: name,
                  time: when(b, at) + slip(),
                  dur: length(part.every * (part.gate ?? 0.8), b),
                  midi: ladder[index]! + transpose + modulation,
                  vel: force((part.vel ?? 0.6) * (s % 4 === 0 ? 1 : 0.85)),
                });
              }
            });
          }
          break;
        }
        case "notes": {
          const parsed = parseNotes(part.notes);
          if (Math.abs(parsed.steps - section.bars * stepsPerBar) > 1e-6) {
            warnings.push(`${spec.id}/${section.name}/${name}: the tune is ${parsed.steps} steps, the section ${section.bars * stepsPerBar}`);
          }
          for (const n of parsed.notes) {
            const b = Math.floor(n.step / stepsPerBar + 1e-9);
            if (b >= section.bars) continue;
            const inBar = n.step - b * stepsPerBar;
            const gate = n.staccato ? 0.45 : 0.92;
            const slots = chordBars[b % chordBars.length]!;
            const chord = slots[Math.min(slots.length - 1, Math.floor((inBar + 1e-9) / (stepsPerBar / slots.length)))]!;
            for (const midi of n.midi) {
              notes.push({
                part: name,
                time: when(b, inBar) + slip(),
                dur: length(n.dur * gate, b),
                midi: midi + (part.shift ?? 0) + transpose + modulation,
                vel: force((part.vel ?? 0.8) * (n.accent ? 1.18 : 1)),
                chord: chord.symbol,
                step: inBar,
                shift: modulation,
              });
            }
          }
          break;
        }
        case "drums": {
          const fillEvery = part.fillEvery ?? 0;
          for (let b = 0; b < section.bars; b++) {
            const isFill = !!part.fill && fillEvery > 0 && (b + 1) % fillEvery === 0;
            for (const [kind, row] of Object.entries(part.groove) as [DrumKind, string][]) {
              const chars = drumRow(row, stepsPerBar);
              if (isFill) {
                const fillRow = part.fill![kind];
                if (fillRow !== undefined) {
                  const f = fillRow.replace(/[|\s]/g, "").split("");
                  const from = stepsPerBar - f.length;
                  for (let k = 0; k < f.length; k++) chars[from + k] = f[k]!;
                } else if (kind.startsWith("hat") || kind === "shaker" || kind === "ride") {
                  const widest = Math.max(...Object.values(part.fill!).map((r) => r!.replace(/[|\s]/g, "").length));
                  for (let k = stepsPerBar - widest; k < stepsPerBar; k++) chars[k] = ".";
                }
              }
              chars.forEach((c, step) => {
                const v = DRUM_CHAR_VEL[c];
                if (v === undefined) return;
                hits.push({ part: name, time: when(b, step) + (humanise ? rng.range(-0.002, 0.002) : 0), kind, vel: force(v * (part.vel ?? 1)) });
              });
            }
            // Fill-only kinds (a snare roll over a groove with no snare row at all).
            if (isFill) {
              for (const [kind, row] of Object.entries(part.fill!) as [DrumKind, string][]) {
                if (part.groove[kind] !== undefined) continue;
                const f = row.replace(/[|\s]/g, "").split("");
                const from = stepsPerBar - f.length;
                f.forEach((c, k) => {
                  const v = DRUM_CHAR_VEL[c];
                  if (v !== undefined) hits.push({ part: name, time: when(b, from + k), kind, vel: force(v * (part.vel ?? 1)) });
                });
              }
            }
          }
          if (part.crash) hits.push({ part: name, time: when(0, 0), kind: "crash", vel: force(0.8) });
          break;
        }
      }
    }
    clock += section.bars * barDur;
    sections.push({ name: section.name, start: sectionStart, end: clock });
  });

  notes.sort((a, b) => a.time - b.time);
  hits.sort((a, b) => a.time - b.time);
  return { id: spec.id, duration: clock, bars, notes, hits, sections, warnings, tempoScale, transpose };
}
