/**
 * Shorthand for writing pieces: one-line constructors for the five kinds of
 * part, so a section reads as "bass('bounce'), chords('strum'), tune(A)".
 */
import type { DrumKind } from "../../../../audio/dsp/voices";
import type { BassPatternName, CompPatternName } from "../patterns";
import type { ArpPart, BassPart, ChordsPart, DrumsPart, NotesPart } from "../score";

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
