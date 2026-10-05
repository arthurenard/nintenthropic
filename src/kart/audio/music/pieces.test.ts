/**
 * Every piece of Grip Prix's music, checked the way an ear would be
 * disappointed, without an ear: written in tune with its own chords, the
 * right length, loud enough but not too loud, balanced, seamless where it
 * loops, quick to make and the same every time. Nothing is played.
 */
import { describe, expect, it, vi } from "vitest";
import { meanOf, peakOfBuffer, rmsOf, toDb } from "../analysis";
import { PIECES, THEME_PIECES, type PieceId } from "./pieces";
import { MUSIC_PEAK_DB, MUSIC_RMS_DB, MUSIC_SAMPLE_RATE, renderPiece, type RenderedMusic } from "./render";
import { compile } from "./score";
import { pitchClass, parseChord, chordPitchClasses, scalePitchClasses } from "./theory";

// Rendering a minute of music takes a second or so; a busy machine takes longer.
vi.setConfig({ testTimeout: 60_000 });

const IDS = Object.keys(PIECES) as PieceId[];
const SHORT: readonly string[] = ["results-win", "results", "podium"];
const rendered = new Map<string, RenderedMusic>();

function render(id: PieceId, final = false): RenderedMusic {
  const key = `${id}${final ? "-final" : ""}`;
  let r = rendered.get(key);
  if (!r) {
    r = renderPiece(PIECES[id], { tempoScale: final ? 1.1 : 1, transpose: final ? 1 : 0 });
    rendered.set(key, r);
  }
  return r;
}

describe("the pieces", () => {
  it("has a tune for every theme and every screen", () => {
    for (const id of ["meadow", "kitchen", "harbour", "canyon", "funfair", "snow", "volcano", "space", "palm", "menu", "results-win", "results", "podium"]) {
      expect(IDS, id).toContain(id);
    }
  });

  it("gives every piece its own id and a different tune", () => {
    for (const id of IDS) expect(PIECES[id].id).toBe(id);
    const fingerprints = IDS.map((id) => {
      const s = compile(PIECES[id], { humanise: false });
      return `${s.notes.length}:${s.hits.length}:${s.notes.slice(0, 40).map((n) => n.midi).join(",")}`;
    });
    expect(new Set(fingerprints).size).toBe(IDS.length);
  });
});

describe.each(IDS)("%s", (id) => {
  const spec = PIECES[id];
  const score = compile(spec, { humanise: false });

  it("fills every section exactly: no tune too short or long, no part without an instrument", () => {
    expect(score.warnings).toEqual([]);
  });

  it("is 45 to 90 seconds long before it loops (the screens' short fanfares 20 to 90)", () => {
    const min = SHORT.includes(id) ? 20 : 45;
    expect(score.duration).toBeGreaterThanOrEqual(min);
    expect(score.duration).toBeLessThanOrEqual(90);
  });

  it("keeps every tune note in its key or in the chord under it, and lands on chord tones on the beat", () => {
    const scale = new Set(scalePitchClasses(spec.key.tonic, spec.key.scale));
    // The tunes: parts that are written out note by note.
    const tunes = new Set<string>();
    for (const s of spec.sections) for (const [name, part] of Object.entries(s.parts)) if (part.kind === "notes") tunes.add(name);
    expect(tunes.size).toBeGreaterThan(0);
    let onBeat = 0;
    let onBeatChordTones = 0;
    for (const n of score.notes) {
      // (A name shared with a generated part has notes with no chord or step; only written tunes are checked.)
      if (!tunes.has(n.part) || n.chord === undefined) continue;
      const pc = n.midi % 12;
      const chord = parseChord(n.chord!);
      const chordPcs = new Set(chordPitchClasses(chord));
      expect(scale.has(pc) || chordPcs.has(pc), `${id}: ${n.part} plays pitch class ${pc} over ${n.chord} at ${n.time.toFixed(2)} s`).toBe(true);
      if (n.step !== undefined && n.step % 4 === 0) {
        onBeat++;
        if (chordPcs.has(pc)) onBeatChordTones++;
      }
    }
    expect(onBeat).toBeGreaterThan(8);
    expect(onBeatChordTones / onBeat, `${id}: share of on-beat tune notes that are chord tones`).toBeGreaterThan(0.5);
  });

  it("keeps its melody in a singable range", () => {
    const lead = spec.sections.flatMap((s) => Object.entries(s.parts).filter(([, p]) => p.kind === "notes").map(([name]) => name));
    const notes = score.notes.filter((n) => lead.includes(n.part));
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(43);
      expect(n.midi).toBeLessThanOrEqual(108);
    }
  });

  it("renders to the music's loudness, under the peak ceiling, with nothing broken in it", () => {
    const r = render(id);
    expect(r.stats.rmsDb).toBeGreaterThan(MUSIC_RMS_DB - 0.6);
    expect(r.stats.rmsDb).toBeLessThan(MUSIC_RMS_DB + 0.6);
    expect(r.stats.peakDb).toBeLessThanOrEqual(MUSIC_PEAK_DB + 0.01);
    for (const ch of [r.left, r.right]) {
      for (let i = 0; i < ch.length; i += 7) if (!Number.isFinite(ch[i]!)) throw new Error(`${id}: non-finite sample at ${i}`);
      expect(Math.abs(meanOf(ch)), `${id} DC`).toBeLessThan(1e-4);
    }
  });

  it("balances its parts: none buried, none shouting", () => {
    const r = render(id);
    for (const [part, db] of Object.entries(r.stats.parts)) {
      expect(db, `${id}: ${part}`).toBeGreaterThan(-26);
      expect(db, `${id}: ${part}`).toBeLessThan(-1.5);
    }
  });

  it("loops without a click, and without a hole where the tails should carry over", () => {
    const r = render(id);
    const ch = r.left;
    const n = ch.length;
    const steps = new Float32Array(n - 1);
    for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(ch[i]! - ch[i - 1]!);
    const sorted = Float32Array.from(steps).sort();
    const p999 = sorted[Math.floor(0.999 * (sorted.length - 1))]!;
    expect(Math.abs(ch[0]! - ch[n - 1]!), `${id} seam step`).toBeLessThanOrEqual(p999 * 1.5 + 1e-4);
    // A second either side of the seam is music, not silence.
    const sr = r.sampleRate;
    const tail = toDb(rmsOf(ch, n - sr, n));
    const head = toDb(rmsOf(ch, 0, sr));
    expect(tail, `${id} last second`).toBeGreaterThan(MUSIC_RMS_DB - 14);
    expect(head, `${id} first second`).toBeGreaterThan(MUSIC_RMS_DB - 14);
    expect(r.loopSamples).toBe(Math.round(score.duration * sr));
  });

  it("renders the same samples every time, and quickly", () => {
    const again = renderPiece(spec);
    const first = render(id);
    // (A plain loop: toEqual on millions of samples takes seconds.)
    expect(again.left.length).toBe(first.left.length);
    let different = 0;
    for (let i = 0; i < first.left.length; i++) if (again.left[i] !== first.left[i] || again.right[i] !== first.right[i]) different++;
    expect(different, `${id}: samples that differ between two renders`).toBe(0);
    // Under the budget for a main-thread render with a good deal of room for a slow machine.
    expect(first.stats.renderMs).toBeLessThan(2500);
  });

  it("has width: the two ears hear different things", () => {
    const r = render(id);
    let diff = 0;
    let sum = 0;
    for (let i = 0; i < r.left.length; i += 3) {
      diff += (r.left[i]! - r.right[i]!) ** 2;
      sum += (r.left[i]! + r.right[i]!) ** 2;
    }
    expect(diff / sum, `${id} side/mid power`).toBeGreaterThan(0.01);
  });
});

describe("the final lap", () => {
  it.each(THEME_PIECES)("%s: the same piece 1.1 times faster and a semitone up", (id) => {
    const base = compile(PIECES[id], { humanise: false });
    const fast = compile(PIECES[id], { humanise: false, tempoScale: 1.1, transpose: 1 });
    expect(fast.duration).toBeCloseTo(base.duration / 1.1, 6);
    expect(fast.bars.length).toBe(base.bars.length);
    const pitched = base.notes.filter((n) => n.part !== undefined);
    expect(fast.notes.length).toBe(pitched.length);
    expect(fast.notes.every((n, k) => n.midi === base.notes[k]!.midi + 1)).toBe(true);
    // A bar line falls on the same beat count in both, so a switch at a bar line stays musical.
    base.bars.forEach((b, k) => expect(fast.bars[k]!.start).toBeCloseTo(b.start / 1.1, 6));
  });

  it("renders to its own shorter buffer at the same loudness", () => {
    const base = render("meadow");
    const fast = render("meadow", true);
    expect(fast.loopSamples).toBeLessThan(base.loopSamples);
    expect(fast.loopSamples / base.loopSamples).toBeCloseTo(1 / 1.1, 2);
    expect(Math.abs(fast.stats.rmsDb - base.stats.rmsDb)).toBeLessThan(0.7);
    expect(peakOfBuffer(fast.left)).toBeLessThanOrEqual(Math.pow(10, (MUSIC_PEAK_DB + 0.01) / 20));
    expect(fast.sampleRate).toBe(MUSIC_SAMPLE_RATE);
  });

  it("transposes the whole key by a semitone", () => {
    expect(pitchClass("C") + 1).toBe(pitchClass("C#"));
  });
});
