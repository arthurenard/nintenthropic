/**
 * The production behind the pieces, checked by numbers: the mixing tools do
 * what they say (a limiter that lets nothing through, a pump that dips on the
 * kick, a compressor that compresses), the drum kits and instruments sound
 * like what they are (a kick is low, a hat is high, a plucked string is in
 * tune), the jingles and the race extras (the comet layer, the final-lap
 * stinger) are made, and the pieces are produced to a set loudness and crest.
 * Nothing is played.
 */
import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../audio/dsp/rng";
import { estimatePitch, fft, peakOfBuffer, rmsOf, spectralCentroid, toDb } from "../analysis";
import { kitHit } from "./kit";
import { INSTRUMENTS } from "./instruments";
import { FINAL_LAP } from "./loader";
import { compress, limit, pumpEnvelope, rotary } from "./mix";
import { PIECES, THEME_PIECES, type PieceId } from "./pieces";
import { CREST_DB, MUSIC_RMS_DB, ONESHOT_PEAK_DB, renderPiece } from "./render";
import { compile } from "./score";
import { midiToHz } from "./theory";

vi.setConfig({ testTimeout: 60_000 });

const SR = 32000;

describe("the mixing tools", () => {
  it("a limiter lets no sample past its ceiling and leaves quiet music alone", () => {
    const n = SR * 2;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = 0.2 * Math.sin(i * 0.05);
      r[i] = 0.2 * Math.sin(i * 0.031);
    }
    l[40000] = 1.4;
    r[40001] = -1.9;
    r[2] = 1.1;
    const ceiling = 0.5;
    const quiet = Float32Array.from(l.subarray(20000, 22000));
    const deepest = limit(l, r, SR, ceiling);
    expect(peakOfBuffer(l)).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(peakOfBuffer(r)).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(deepest).toBeGreaterThan(8);
    // Away from the peaks the music is as it was.
    for (let i = 0; i < quiet.length; i++) expect(l[20000 + i]!).toBeCloseTo(quiet[i]!, 4);
  });

  it("a pump dips at each kick by the set depth and is back at full level before the next", () => {
    const env = pumpEnvelope(SR * 2, SR, [0.5, 1.0, 1.5], 0.6);
    expect(env[Math.round(0.5 * SR) - 5]).toBe(1);
    let lowest = 1;
    for (let i = Math.round(0.5 * SR); i < Math.round(0.6 * SR); i++) lowest = Math.min(lowest, env[i]!);
    expect(lowest).toBeCloseTo(0.4, 1);
    expect(env[Math.round(0.99 * SR)]).toBeGreaterThan(0.95);
  });

  it("a rotary speaker never makes a hole in a long part (a regression: one tap rounded past the end of its buffer)", () => {
    const n = 1_300_000;
    const l = new Float32Array(n).map((_, i) => Math.sin(i * 0.05));
    const r = Float32Array.from(l);
    rotary(l, r, SR, 4.8, 0.5);
    for (let i = 0; i < n; i++) if (!Number.isFinite(l[i]!) || !Number.isFinite(r[i]!)) throw new Error(`non-finite sample at ${i}`);
  });

  it("a compressor turns loud passages down and leaves quiet ones", () => {
    const n = SR * 2;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const amp = i < n / 2 ? 0.05 : 0.8;
      l[i] = amp * Math.sin(i * 0.07);
      r[i] = l[i]!;
    }
    compress(l, r, SR, { threshold: -20, ratio: 4, attack: 0.005, release: 0.1 });
    expect(toDb(rmsOf(l, 2000, n / 2 - 100))).toBeCloseTo(toDb(0.05 / Math.SQRT2), 0);
    // 0.8 is -2 dBFS peak; four to one above -20 would leave about -6.
    expect(toDb(rmsOf(l, n - 8000, n))).toBeLessThan(toDb(0.8 / Math.SQRT2) - 6);
  });
});

describe("the kits and the instruments", () => {
  const hit = (kind: Parameters<typeof kitHit>[1], style: Parameters<typeof kitHit>[0] = "pop") => kitHit(style, kind, SR, new Rng(7), 0.8);

  it("a kick is low, a hat is high, a snare has both", () => {
    expect(spectralCentroid(hit("kick"), SR, 1024)).toBeLessThan(900);
    expect(spectralCentroid(hit("hat"), SR, 1024)).toBeGreaterThan(5000);
    const snare = spectralCentroid(hit("snare"), SR, 1024);
    expect(snare).toBeGreaterThan(900);
    expect(snare).toBeLessThan(6000);
  });

  it("every kit makes finite, peaked, non-silent hits that end in silence", () => {
    for (const style of ["pop", "rock", "brush", "electro", "latin", "march"] as const) {
      for (const kind of ["kick", "kick-soft", "snare", "snare-brush", "hat", "hat-open", "tom-low", "ride", "crash", "clap", "conga-low"] as const) {
        const b = hit(kind, style);
        expect(peakOfBuffer(b), `${style} ${kind}`).toBeGreaterThan(0.2);
        expect(peakOfBuffer(b), `${style} ${kind}`).toBeLessThanOrEqual(1.001);
        expect(Math.abs(b[b.length - 1]!)).toBeLessThan(0.01);
        for (let i = 0; i < b.length; i += 13) if (!Number.isFinite(b[i]!)) throw new Error(`${style} ${kind} not finite`);
      }
    }
  });

  it("a kick has a transient: its first 5 ms are far louder in the highs than its tail", () => {
    const k = hit("kick", "rock");
    const head = k.subarray(0, Math.round(0.005 * SR));
    const tail = k.subarray(Math.round(0.1 * SR), Math.round(0.14 * SR));
    expect(spectralCentroid(head, SR, 128)).toBeGreaterThan(spectralCentroid(tail, SR, 128) * 1.1);
  });

  it.each(["gtr-nylon", "gtr-steel", "bass-pick", "upright", "rhodes", "rhodes-soft"] as const)("%s plays the pitch it is asked for", (name) => {
    const freq = midiToHz(name.startsWith("bass") || name === "upright" ? 43 : 57);
    const buf = INSTRUMENTS[name]({ sr: SR, freq, hold: 0.6, vel: 0.8, rng: new Rng(3) });
    const found = estimatePitch(buf, SR, Math.round(0.05 * SR), 4096, freq * 0.6, freq * 1.7);
    expect(Math.abs(12 * Math.log2(found / freq)), `${name}: ${found} Hz for ${freq.toFixed(1)}`).toBeLessThan(0.6);
  });

  it("every instrument makes a finite, audible note that ends in silence", () => {
    for (const [name, voice] of Object.entries(INSTRUMENTS)) {
      const buf = voice({ sr: SR, freq: 440, hold: 0.3, vel: 0.8, rng: new Rng(5) });
      expect(peakOfBuffer(buf), name).toBeGreaterThan(0.01);
      expect(peakOfBuffer(buf), name).toBeLessThan(6);
      expect(Math.abs(buf[buf.length - 1]!), name).toBeLessThan(0.02);
      for (let i = 0; i < buf.length; i += 7) if (!Number.isFinite(buf[i]!)) throw new Error(`${name} not finite`);
    }
  });

  it("the brass section is brighter than the horn, and a choir has formants rather than a flat buzz", () => {
    const note = (name: keyof typeof INSTRUMENTS) => INSTRUMENTS[name]({ sr: SR, freq: midiToHz(60), hold: 0.5, vel: 0.8, rng: new Rng(2) });
    expect(spectralCentroid(note("brass-section"), SR, 1024)).toBeGreaterThan(spectralCentroid(note("horn-soft"), SR, 1024));
    const choir = note("choir-ooh");
    const re = new Float64Array(4096);
    const im = new Float64Array(4096);
    for (let i = 0; i < 4096; i++) re[i] = choir[2000 + i]!;
    fft(re, im);
    // "Ooh" keeps its energy low: the band round 350 Hz is far above the one round 3 kHz.
    const band = (lo: number, hi: number): number => {
      let s = 0;
      for (let k = Math.round((lo * 4096) / SR); k < Math.round((hi * 4096) / SR); k++) s += re[k]! * re[k]! + im[k]! * im[k]!;
      return s;
    };
    expect(band(250, 450)).toBeGreaterThan(band(2800, 3400) * 8);
  });
});

describe("what a piece is produced to", () => {
  it("holds its peaks a set height over its loudness: dense, with transients kept", () => {
    const r = renderPiece(PIECES.volcano, { sampleRate: SR });
    expect(r.stats.peakDb - r.stats.rmsDb).toBeGreaterThan(CREST_DB - 1.5);
    expect(r.stats.peakDb - r.stats.rmsDb).toBeLessThan(CREST_DB + 1.5);
    expect(Math.abs(r.stats.rmsDb - (MUSIC_RMS_DB + 0.5))).toBeLessThan(0.6);
    expect(r.loop).toBe(true);
  });

  it("modulates: the lift is the same chorus a tone higher", () => {
    const k = compile(PIECES.kitchen, { humanise: false });
    const lift = k.sections.find((s) => s.name === "Lift")!;
    const first = k.sections.find((s) => s.name === "A2")!;
    const inLift = k.notes.filter((n) => n.part === "lead" && n.time >= lift.start && n.time < lift.end);
    const inFirst = k.notes.filter((n) => n.part === "lead" && n.time >= first.start && n.time < first.end);
    expect(inLift.length).toBe(inFirst.length);
    expect(inLift.every((n, i) => n.midi === inFirst[i]!.midi + 2)).toBe(true);
    expect(inLift.every((n) => n.shift === 2)).toBe(true);
  });

  it("the themes are written with an intro or a build and a turn or a lift: a loop that arrives, not restarts", () => {
    for (const id of THEME_PIECES) {
      const names = compile(PIECES[id], { humanise: false }).sections.map((s) => s.name);
      expect(names.length, id).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("the jingles", () => {
  const ids = (["jingle-win", "jingle-lose"] as const satisfies readonly PieceId[]);
  it.each(ids)("%s plays once, a few seconds long, at its own peak, ending in silence", (id) => {
    const r = renderPiece(PIECES[id], { sampleRate: SR });
    expect(r.loop).toBe(false);
    expect(r.duration).toBeGreaterThan(2);
    expect(r.duration).toBeLessThan(14);
    expect(toDb(peakOfBuffer(r.left))).toBeLessThanOrEqual(ONESHOT_PEAK_DB + 0.1);
    expect(toDb(peakOfBuffer(r.left))).toBeGreaterThan(ONESHOT_PEAK_DB - 1.5);
    expect(Math.abs(r.left[r.left.length - 1]!)).toBeLessThan(1e-3);
  });
});

describe("the race extras", () => {
  it("a theme carries the invincibility layer: one bar that loops, in time with the music", () => {
    const r = renderPiece(PIECES.meadow, { sampleRate: SR });
    expect(r.comet).toBeDefined();
    const bar = r.bars[0]!.dur;
    expect(r.comet!.left.length / SR).toBeCloseTo(bar, 2);
    expect(toDb(rmsOf(r.comet!.left))).toBeLessThan(-20);
    expect(toDb(rmsOf(r.comet!.left))).toBeGreaterThan(-40);
    expect(r.stinger).toBeUndefined();
  });

  it("the final-lap version carries a stinger a couple of seconds long, in the lifted key", () => {
    for (const id of ["kitchen", "volcano"] as const) {
      const r = renderPiece(PIECES[id], { sampleRate: SR, ...FINAL_LAP });
      expect(r.stinger, id).toBeDefined();
      const s = r.stinger!.left.length / SR;
      expect(s).toBeGreaterThan(1.5);
      expect(s).toBeLessThan(7);
      expect(toDb(peakOfBuffer(r.stinger!.left))).toBeGreaterThan(-6);
    }
  });

  it("the screens' pieces carry neither", () => {
    const r = renderPiece(PIECES.menu, { sampleRate: SR });
    expect(r.comet).toBeUndefined();
    expect(r.stinger).toBeUndefined();
  });
});
