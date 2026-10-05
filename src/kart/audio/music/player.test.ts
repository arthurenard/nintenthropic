/**
 * The music's timing arithmetic and loading, without an audio device: where
 * the beats fall, which beat the final-lap switch lands on, and that the
 * main-thread renderer (the Worker's fallback) makes the same samples as the
 * direct render, a stage at a time.
 */
import { describe, expect, it } from "vitest";
import { FINAL_LAP, createMusicRenderer, renderOnMainThread } from "./loader";
import { beatTimes, nextBeat, sliderGain } from "./player";
import { PIECES, THEME_PIECES } from "./pieces";
import { compile } from "./score";
import { renderPiece } from "./render";

describe("beats", () => {
  const bars = [
    { start: 0, dur: 2, beats: 4, bpm: 120, section: 0, index: 0 },
    { start: 2, dur: 2, beats: 4, bpm: 120, section: 0, index: 1 },
    { start: 4, dur: 1.5, beats: 3, bpm: 120, section: 1, index: 0 },
  ];

  it("lists every beat of every bar, whatever the meter", () => {
    const beats = beatTimes(bars);
    expect(Array.from(beats)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it("finds the next beat after a position, with a margin, and wraps round the loop", () => {
    const beats = beatTimes(bars);
    expect(nextBeat(beats, 5.5, 0.1)).toEqual({ index: 1, wait: expect.closeTo(0.4, 6) });
    expect(nextBeat(beats, 5.5, 0.5, 0.02).index).toBe(2);
    expect(nextBeat(beats, 5.5, 0.47, 0.02).index).toBe(1);
    const wrapped = nextBeat(beats, 5.5, 5.2);
    expect(wrapped.index).toBe(0);
    expect(wrapped.wait).toBeCloseTo(0.3, 6);
    // Position beyond the loop wraps.
    expect(nextBeat(beats, 5.5, 5.5 + 0.1).index).toBe(1);
  });

  it("maps a final-lap switch to the same beat of the faster version", () => {
    for (const id of THEME_PIECES) {
      const normal = beatTimes(compile(PIECES[id], { humanise: false }).bars);
      const fast = beatTimes(compile(PIECES[id], { humanise: false, tempoScale: 1.1, transpose: 1 }).bars);
      expect(fast.length, id).toBe(normal.length);
      // A switch at beat k of one lands at beat k of the other.
      for (const k of [0, 7, Math.floor(normal.length / 2), normal.length - 1]) expect(fast[k]!, `${id} beat ${k}`).toBeCloseTo(normal[k]! / 1.1, 4);
    }
  });

  it("maps the slider to a gain that spreads loudness evenly along it", () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(0.5)).toBeCloseTo(0.25, 9);
    expect(sliderGain(-3)).toBe(0);
    expect(sliderGain(9)).toBe(1);
  });
});

describe("the main-thread renderer", { timeout: 60_000 }, () => {
  it("makes the same samples as rendering all at once, in stages, reporting progress", async () => {
    const progress: number[] = [];
    const staged = await renderOnMainThread("meadow", false, (f) => progress.push(f));
    const whole = renderPiece(PIECES.meadow);
    let different = 0;
    for (let i = 0; i < whole.left.length; i++) if (staged.left[i] !== whole.left[i] || staged.right[i] !== whole.right[i]) different++;
    expect(different).toBe(0);
    expect(progress.length).toBeGreaterThan(4);
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThan(progress[i - 1]!);
  });

  it("makes the final-lap version faster and higher", async () => {
    const normal = await renderOnMainThread("meadow", false);
    const final = await renderOnMainThread("meadow", true);
    expect(final.tempoScale).toBe(FINAL_LAP.tempoScale);
    expect(final.transpose).toBe(FINAL_LAP.transpose);
    expect(final.loopSamples / normal.loopSamples).toBeCloseTo(1 / 1.1, 2);
  });

  it("falls back to the main thread when Workers are not there", async () => {
    const renderer = createMusicRenderer("auto");
    const r = await renderer.render("meadow", false);
    expect(r.id).toBe("meadow");
    renderer.dispose();
    await expect(renderer.render("meadow", false)).rejects.toThrow();
  });

  it("keeps the main thread free: no stage holds it for long", async () => {
    // Each stage is timed on its own: the longest slice is a fraction of the whole piece.
    const { PieceRenderer } = await import("./render");
    const r = new PieceRenderer(PIECES.meadow);
    const slices: number[] = [];
    for (const stage of r.stages()) {
      const t0 = performance.now();
      stage();
      slices.push(performance.now() - t0);
    }
    // (About 0.35 s and 0.1 s on a quiet laptop; the bounds leave room for a busy test run.)
    expect(slices.reduce((a, b) => a + b, 0)).toBeLessThan(4000);
    expect(Math.max(...slices)).toBeLessThan(1500);
  });
});
