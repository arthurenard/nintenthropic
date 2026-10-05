/**
 * The sequencer, tested in Node with nothing played: notes to MIDI, swing,
 * tempo, the length of a loop and the final lap's faster, higher self.
 */
import { describe, expect, it } from "vitest";
import { type PieceSpec, compile, parseChordBars, parseNotes, stepOffset, swungBeat } from "./score";
import { bassNote, chordPitchClasses, noteToMidi, parseChord, pitchClass, scalePitchClasses, voicing } from "./theory";
import { arp, bass, chords, drums, tune } from "./pieces/dsl";

const tiny = (over: Partial<PieceSpec> = {}): PieceSpec => ({
  id: "tiny",
  name: "Tiny",
  key: { tonic: "C", scale: "major" },
  bpm: 120,
  rack: {
    bass: { inst: "pizz", level: 0 },
    chords: { inst: "uke", level: 0 },
    lead: { inst: "whistle", level: 0 },
    arp: { inst: "marimba", level: 0 },
    drums: { inst: "drums", level: 0 },
  },
  fx: { reverb: { t60: 1, size: 0.5, mix: 0.2 } },
  sections: [
    {
      name: "A",
      bars: 2,
      chords: "C G",
      parts: {
        bass: bass("rf"),
        chords: chords("pad"),
        lead: tune("c5:4 e5:4 g5:8 | g5:16"),
        arp: arp("0 1 2 3", 2),
        drums: drums({ kick: "x...x...x...x...", snare: "....x.......x..." }),
      },
    },
  ],
  ...over,
});

describe("notation", () => {
  it("reads note names as MIDI numbers, middle C being 60", () => {
    expect(noteToMidi("c4")).toBe(60);
    expect(noteToMidi("a4")).toBe(69);
    expect(noteToMidi("f#3")).toBe(54);
    expect(noteToMidi("bb5")).toBe(82);
    expect(() => noteToMidi("h4")).toThrow();
  });

  it("reads chord symbols", () => {
    expect(chordPitchClasses(parseChord("Am7"))).toEqual([9, 0, 4, 7]);
    expect(parseChord("C/E").bass).toBe(pitchClass("E"));
    expect(chordPitchClasses(parseChord("F#m"))).toEqual([6, 9, 1]);
    expect(() => parseChord("Hm")).toThrow();
    expect(() => parseChord("Cwhatever")).toThrow();
  });

  it("splits a bar between two chords with a bar line", () => {
    const bars = parseChordBars("C G|D Am");
    expect(bars.map((b) => b.length)).toEqual([1, 2, 1]);
  });

  it("counts a tune's steps, with rests, ties of length and stacked chords", () => {
    const tune = parseNotes("c5:4 r:4 e5+g5:8 | a5!:2 b5':2");
    expect(tune.steps).toBe(20);
    expect(tune.notes.map((n) => n.step)).toEqual([0, 8, 16, 18]);
    expect(tune.notes[1]!.midi).toEqual([noteToMidi("e5"), noteToMidi("g5")]);
    expect(tune.notes[2]!.accent).toBe(true);
    expect(tune.notes[3]!.staccato).toBe(true);
    expect(() => parseNotes("c5:4 zz")).toThrow();
  });

  it("voices a progression with the least movement", () => {
    const c = voicing(parseChord("C"), null, 62);
    const g = voicing(parseChord("G"), c, 62);
    const move = g.reduce((a, n, k) => a + Math.abs(n - c[k]!), 0);
    expect(move).toBeLessThanOrEqual(5);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(48);
  });

  it("places a bass root in its octave", () => {
    expect(bassNote(pitchClass("G"), 36)).toBe(43);
    expect(bassNote(pitchClass("C"), 36)).toBe(36);
    expect(bassNote(pitchClass("B"), 36)).toBe(47);
  });

  it("knows the scales", () => {
    expect(scalePitchClasses("C", "major")).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scalePitchClasses("A", "minor")).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });
});

describe("timing", () => {
  it("leaves straight eighths straight and swings them toward a triplet", () => {
    expect(swungBeat(0.5, 0)).toBeCloseTo(0.5, 9);
    expect(swungBeat(0.5, 1)).toBeCloseTo(2 / 3, 9);
    expect(swungBeat(0.5, 0.5)).toBeCloseTo(0.5 + (1 / 6) * 0.5, 9);
    expect(swungBeat(0, 1)).toBe(0);
    // Continuous and rising through the beat.
    let last = -1;
    for (let k = 0; k <= 100; k++) {
      const v = swungBeat(k / 100, 0.8);
      expect(v).toBeGreaterThan(last - 1e-12);
      last = v;
    }
    expect(swungBeat(1 - 1e-9, 0.8)).toBeCloseTo(1, 6);
  });

  it("puts steps where the tempo says", () => {
    const bar = { beats: 4, bpm: 120 };
    expect(stepOffset(bar, 0, 0, 1)).toBe(0);
    expect(stepOffset(bar, 4, 0, 1)).toBeCloseTo(0.5, 9);
    expect(stepOffset(bar, 8, 0, 1)).toBeCloseTo(1, 9);
    expect(stepOffset(bar, 2, 0, 1)).toBeCloseTo(0.25, 9);
    expect(stepOffset(bar, 2, 1, 1)).toBeCloseTo((2 / 3) * 0.5, 9);
  });

  it("makes a bar of 4/4 at 120 beats a minute two seconds long, and a waltz bar one and a half", () => {
    const four = compile(tiny());
    expect(four.bars[0]!.dur).toBeCloseTo(2, 9);
    expect(four.duration).toBeCloseTo(4, 9);
    const waltz = compile(tiny({ beats: 3, sections: [{ name: "W", bars: 2, chords: "C G", parts: { bass: bass("waltz") } }] }));
    expect(waltz.bars[0]!.dur).toBeCloseTo(1.5, 9);
    expect(waltz.duration).toBeCloseTo(3, 9);
  });

  it("lets a section change tempo and metre, and adds the bars up", () => {
    const score = compile(
      tiny({
        sections: [
          { name: "waltz", bars: 4, beats: 3, bpm: 150, chords: "C", parts: { bass: bass("waltz") } },
          { name: "march", bars: 4, beats: 4, bpm: 120, chords: "C", parts: { bass: bass("rf") } },
        ],
      }),
    );
    expect(score.duration).toBeCloseTo(4 * (3 * 60) / 150 + 4 * 2, 9);
    expect(score.bars[4]!.start).toBeCloseTo(4 * 1.2, 9);
  });

  it("plays the final lap faster by the tempo scale and a semitone higher, leaving the drums alone", () => {
    const base = compile(tiny(), { humanise: false });
    const fast = compile(tiny(), { humanise: false, tempoScale: 1.1, transpose: 1 });
    expect(fast.duration).toBeCloseTo(base.duration / 1.1, 9);
    expect(fast.notes.length).toBe(base.notes.length);
    for (let k = 0; k < base.notes.length; k++) {
      expect(fast.notes[k]!.midi - base.notes[k]!.midi).toBe(1);
      expect(fast.notes[k]!.time).toBeCloseTo(base.notes[k]!.time / 1.1, 9);
    }
    expect(fast.hits.length).toBe(base.hits.length);
    fast.hits.forEach((h, k) => expect(h.time).toBeCloseTo(base.hits[k]!.time / 1.1, 9));
  });

  it("is the same every time for the same piece, and different humanised from straight", () => {
    const a = compile(tiny());
    const b = compile(tiny());
    expect(a.notes).toEqual(b.notes);
    const straight = compile(tiny(), { humanise: false });
    expect(straight.notes.some((n, k) => n.time !== a.notes[k]!.time)).toBe(true);
  });
});

describe("parts", () => {
  it("warns of a tune that does not fill its section, and of a part with no instrument", () => {
    const short = compile(
      tiny({ sections: [{ name: "A", bars: 2, chords: "C", parts: { lead: tune("c5:4 e5:4") } }] }),
    );
    expect(short.warnings.join()).toContain("the tune is 8 steps, the section 32");
    const orphan = compile(tiny({ sections: [{ name: "A", bars: 1, chords: "C", parts: { oboe: tune("c5:16") } }] }));
    expect(orphan.warnings.join()).toContain('"oboe"');
  });

  it("fills a bar of drums from a row, repeating a short row", () => {
    const score = compile(tiny({ sections: [{ name: "A", bars: 1, chords: "C", parts: { drums: drums({ hat: "x." }) } }] }), { humanise: false });
    expect(score.hits.length).toBe(8);
    expect(score.hits[1]!.time).toBeCloseTo(0.25, 9);
  });

  it("puts a fill in the last steps of every fourth bar and drops the hats there", () => {
    const score = compile(
      tiny({
        sections: [
          {
            name: "A",
            bars: 4,
            chords: "C",
            parts: { drums: drums({ kick: "x...", hat: "xxxxxxxxxxxxxxxx" }, { fill: { "tom-high": "xxxx" }, fillEvery: 4 }) },
          },
        ],
      }),
      { humanise: false },
    );
    const lastBar = score.bars[3]!;
    const inLast = score.hits.filter((h) => h.time >= lastBar.start - 1e-9);
    expect(inLast.filter((h) => h.kind === "tom-high").length).toBe(4);
    // No hat in the last quarter of the last bar.
    expect(inLast.some((h) => h.kind === "hat" && h.time > lastBar.start + 0.75 * lastBar.dur + 1e-6)).toBe(false);
  });

  it("walks a bass line to the next chord's root from a semitone away, in the octave nearest the line", () => {
    const score = compile(
      tiny({ sections: [{ name: "A", bars: 2, chords: "C G", parts: { bass: bass("walk") } }] }),
      { humanise: false },
    );
    const firstBar = score.notes.filter((n) => n.time < score.bars[1]!.start);
    expect(firstBar.length).toBe(4);
    const g = bassNote(pitchClass("G"), 36);
    expect(Math.abs(firstBar[3]!.midi - g)).toBe(1);
    // No leaps of more than an octave in the line.
    for (let k = 1; k < firstBar.length; k++) expect(Math.abs(firstBar[k]!.midi - firstBar[k - 1]!.midi)).toBeLessThanOrEqual(12);
  });

  it("leads the last bar of a section into the next section's first chord, not its own", () => {
    const score = compile(
      tiny({
        sections: [
          { name: "A", bars: 1, chords: "C", parts: { bass: bass("walk") } },
          { name: "B", bars: 1, chords: "D", parts: { bass: bass("walk") } },
        ],
      }),
      { humanise: false },
    );
    const last = score.notes.filter((n) => n.time < score.bars[1]!.start).at(-1)!;
    expect(Math.abs(last.midi - bassNote(pitchClass("D"), 36))).toBe(1);
  });

  it("keeps the octave of a pulsing bass on high roots (the line is allowed two octaves)", () => {
    const score = compile(
      tiny({ sections: [{ name: "A", bars: 1, chords: "A", parts: { bass: bass("pulse16") } }] }),
      { humanise: false },
    );
    const midis = new Set(score.notes.map((n) => n.midi));
    expect(midis.has(45)).toBe(true);
    expect(midis.has(57)).toBe(true);
  });

  it("builds a fifth from a slash chord's root, not its bass note", () => {
    const score = compile(
      tiny({ sections: [{ name: "A", bars: 1, chords: "A/C#", parts: { bass: bass("rf") } }] }),
      { humanise: false },
    );
    const midis = score.notes.map((n) => n.midi);
    // Root at the C#, fifth above the A (E).
    expect(midis[0]! % 12).toBe(pitchClass("C#"));
    expect(midis[1]! % 12).toBe(pitchClass("E"));
  });

  it("gives an arpeggio the chord's own tones", () => {
    const score = compile(tiny({ sections: [{ name: "A", bars: 1, chords: "Am", parts: { arp: arp("0 1 2 3 2 1", 2, { base: 60 }) } }] }), { humanise: false });
    const allowed = new Set([9, 0, 4]);
    for (const n of score.notes) expect(allowed.has(n.midi % 12), `midi ${n.midi}`).toBe(true);
    expect(score.notes.length).toBe(8);
  });
});
