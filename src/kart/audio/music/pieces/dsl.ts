/**
 * Shorthand for writing pieces: one-line constructors for the five kinds of
 * part, so a section reads as "bass('bounce'), chords('strum'), tune(A)", and
 * the finish every theme shares (a modulating last chorus and a turnaround).
 */
import type { DrumKind } from "../../../../audio/dsp/voices";
import type { BassPatternName, CompPatternName } from "../patterns";
import type { ArpPart, BassPart, ChordsPart, DrumsPart, NotesPart, Part, PieceSpec, SectionSpec } from "../score";

export const bass = (pattern: BassPatternName, o: Partial<Omit<BassPart, "kind" | "pattern">> = {}): BassPart => ({ kind: "bass", pattern, ...o });

export const chords = (comp: CompPatternName, o: Partial<Omit<ChordsPart, "kind" | "comp">> = {}): ChordsPart => ({ kind: "chords", comp, ...o });

export const arp = (pattern: string, every: number, o: Partial<Omit<ArpPart, "kind" | "pattern" | "every">> = {}): ArpPart => ({
  kind: "arp",
  pattern,
  every,
  ...o,
});

export const tune = (notes: string, o: Partial<Omit<NotesPart, "kind" | "notes">> = {}): NotesPart => ({ kind: "notes", notes, ...o });

export const drums = (groove: Partial<Record<DrumKind, string>>, o: Partial<Omit<DrumsPart, "kind" | "groove">> = {}): DrumsPart => ({
  kind: "drums",
  groove,
  ...o,
});

export interface Finale {
  /** Optional opening bars put in front of the piece. */
  intro?: SectionSpec;
  /** The section (by index in the piece as written) played again at the end, ``shift`` semitones higher. */
  from: number;
  shift: number;
  /** Where the lift goes (an index into the sections as written; the end when left out). */
  at?: number;
  /** Parts added to the lift (the band swells: horns, a doubling an octave up). */
  extra?: Record<string, Part>;
  /** Parts of the lift taken away (named). */
  without?: string[];
  /** The two-bar turn that falls back into the top of the piece: chords, the melody part's name and its pickup tune (32 steps in 4/4). */
  turn?: {
    chords: string;
    part: string;
    tune: string;
    groove?: Partial<Record<DrumKind, string>>;
    fill?: Partial<Record<DrumKind, string>>;
    chordsPart?: string;
    bassPart?: string;
  };
}

/**
 * A finish for a piece: the chorus again a tone higher with the band swelling
 * (a modulation), then two bars on the dominant that fall back into the first
 * chord, so the loop's seam sounds like a turnaround and not a restart.
 */
export function withFinale(spec: PieceSpec, f: Finale): PieceSpec {
  const src = spec.sections[f.from]!;
  const parts: Record<string, Part> = { ...src.parts, ...(f.extra ?? {}) };
  for (const name of f.without ?? []) delete parts[name];
  const lift: SectionSpec = { ...src, name: "Lift", shift: (src.shift ?? 0) + f.shift, level: (src.level ?? 1) * 1.04, parts };
  const t = f.turn;
  const middle = [...spec.sections];
  if (!t) {
    middle.splice(f.at ?? middle.length, 0, lift);
    return { ...spec, sections: [...(f.intro ? [f.intro] : []), ...middle] };
  }
  const turnParts: Record<string, Part> = {};
  const bassName = t.bassPart ?? "bass";
  if (spec.rack[bassName]) turnParts[bassName] = bass("whole", { vel: 0.75 });
  const cp = t.chordsPart ?? Object.keys(spec.rack).find((k) => k.startsWith("chord") || k === "strum");
  if (cp && spec.rack[cp]) turnParts[cp] = chords("hold2", { roll: 0.015, vel: 0.6 });
  turnParts[t.part] = tune(t.tune);
  const drumsName = Object.keys(spec.rack).find((k) => spec.rack[k]!.inst === "drums");
  if (drumsName) {
    turnParts[drumsName] = drums(t.groove ?? { hat: "x.x.x.x.x.x.x.x." }, { fill: t.fill ?? { snare: "x.x.xxxx", "tom-high": "......x." }, fillEvery: 2 });
  }
  const turn: SectionSpec = { name: "Turn", bars: 2, level: 0.92, chords: t.chords, parts: turnParts };
  middle.splice(f.at ?? middle.length, 0, lift);
  return { ...spec, sections: [...(f.intro ? [f.intro] : []), ...middle, turn] };
}
