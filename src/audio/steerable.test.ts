/**
 * The engine's steerable loops and music bus (what Grip Prix's engines and
 * music ride on), against a stand-in AudioContext: nothing is played.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioEngine } from "./engine";
import { airCutoff } from "./routing";

class Param {
  constructor(public value = 0) {}
  setValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  cancelScheduledValues(): this { return this; }
}
class Node {
  outputs: Node[] = [];
  connect<T extends Node>(n: T): T { this.outputs.push(n); return n; }
  disconnect(): void { this.outputs = []; }
}
class Source extends Node {
  buffer: unknown = null;
  loop = false;
  playbackRate = new Param(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0): void { this.startedAt = when; }
  stop(when = 0): void { this.stoppedAt = when; }
}
class FakeContext {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  onstatechange: (() => void) | null = null;
  destination = new Node();
  sources: Source[] = [];
  gains: (Node & { gain: Param })[] = [];
  pans: (Node & { pan: Param })[] = [];
  filters: (Node & { frequency: Param })[] = [];
  createGain(): Node & { gain: Param } { const g = Object.assign(new Node(), { gain: new Param(1) }); this.gains.push(g); return g; }
  createStereoPanner(): Node & { pan: Param } { const p = Object.assign(new Node(), { pan: new Param(0) }); this.pans.push(p); return p; }
  createBiquadFilter(): Node & { type: string; frequency: Param; Q: Param } {
    const f = Object.assign(new Node(), { type: "lowpass", frequency: new Param(350), Q: new Param(1) });
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): Node & { threshold: Param; knee: Param; ratio: Param; attack: Param; release: Param } {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createWaveShaper(): Node & { curve: unknown } { return Object.assign(new Node(), { curve: null }); }
  createConvolver(): Node & { buffer: unknown; normalize: boolean } { return Object.assign(new Node(), { buffer: null, normalize: true }); }
  createBuffer(_ch: number, length: number, sr: number): { duration: number; copyToChannel(): void } { return { duration: length / sr, copyToChannel() {} }; }
  createBufferSource(): Source { const s = new Source(); this.sources.push(s); return s; }
  resume(): Promise<void> { return Promise.resolve(); }
  suspend(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> { return Promise.resolve(); }
}

describe("steerable loops", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  async function ready(): Promise<{ e: WebAudioEngine; ctx: FakeContext }> {
    const ctx = new FakeContext();
    const e = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, workers: 0 });
    await e.load("kart");
    return { e, ctx };
  }

  it("starts one looping source at the rate asked", async () => {
    const { e, ctx } = await ready();
    const before = ctx.sources.length;
    e.controlledLoop("kart_engine_a", { rate: 0.8, pan: -0.5, distance: 20 });
    const added = ctx.sources.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.loop).toBe(true);
    expect(added[0]!.playbackRate.value).toBeCloseTo(0.8, 6);
    expect(added[0]!.startedAt).not.toBeNull();
    expect(ctx.pans.at(-1)!.pan.value).toBe(-0.5);
    expect(ctx.filters.at(-1)!.frequency.value).toBeCloseTo(airCutoff(20), 3);
  });

  it("moves the pitch, level, pan and distance while it plays, and ignores nonsense", async () => {
    const { e, ctx } = await ready();
    const loop = e.controlledLoop("kart_engine_b", { rate: 1, volume: 1 });
    const source = ctx.sources.at(-1)!;
    const gain = ctx.gains.at(-1)!.gain;
    const pan = ctx.pans.at(-1)!.pan;
    loop.set({ rate: 1.7, volume: 0.25, pan: 2, distance: 50 });
    expect(source.playbackRate.value).toBeCloseTo(1.7, 6);
    expect(pan.value).toBe(1);
    expect(gain.value).toBeGreaterThan(0);
    const quieter = gain.value;
    loop.set({ volume: 1 });
    expect(gain.value).toBeGreaterThan(quieter);
    loop.set({ rate: Number.NaN, volume: undefined });
    expect(source.playbackRate.value).toBeCloseTo(1.7, 6);
    // A huge rate is held in a sane range.
    loop.set({ rate: 99 });
    expect(source.playbackRate.value).toBeLessThanOrEqual(8);
  });

  it("tells the nodes only what changed, so a race steering every frame does not pile up automation", async () => {
    const { e, ctx } = await ready();
    const loop = e.controlledLoop("kart_engine_b", { rate: 1.2, volume: 0.5, pan: 0.3, distance: 12 });
    const params = [ctx.sources.at(-1)!.playbackRate, ctx.gains.at(-1)!.gain, ctx.pans.at(-1)!.pan, ctx.filters.at(-1)!.frequency];
    const calls = params.map((p) => vi.spyOn(p, "setTargetAtTime"));
    loop.set({ rate: 1.2, volume: 0.5, pan: 0.3, distance: 12 }); // as it started
    for (const c of calls) expect(c).not.toHaveBeenCalled();
    loop.set({ rate: 1.4, volume: 0.5, pan: 0.3, distance: 12 });
    expect(calls.map((c) => c.mock.calls.length)).toEqual([1, 0, 0, 0]);
    loop.set({ rate: 1.4, pan: -0.2 });
    expect(calls.map((c) => c.mock.calls.length)).toEqual([1, 0, 1, 0]);
    loop.set({ distance: 40 });
    expect(calls.map((c) => c.mock.calls.length)).toEqual([1, 1, 1, 1]); // farther is quieter and darker
    expect(ctx.filters.at(-1)!.frequency.value).toBeCloseTo(airCutoff(40), 3);
  });

  it("fades out on stop, stops its source once, and stays still afterwards", async () => {
    const { e, ctx } = await ready();
    const loop = e.controlledLoop("kart_drift", {});
    const source = ctx.sources.at(-1)!;
    loop.stop();
    expect(source.stoppedAt).not.toBeNull();
    const at = source.stoppedAt;
    loop.stop();
    loop.set({ rate: 2 });
    expect(source.stoppedAt).toBe(at);
    expect(source.playbackRate.value).toBeCloseTo(1, 6);
  });

  it("starts a loop asked for before its pack is ready once the pack arrives, and not if stopped meanwhile", async () => {
    const ctx = new FakeContext();
    const e = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, workers: 0 });
    const before = ctx.sources.length;
    const early = e.controlledLoop("kart_engine_c", { rate: 1.2 });
    const cancelled = e.controlledLoop("kart_engine_d", {});
    cancelled.stop();
    await e.load("kart");
    await new Promise((r) => setTimeout(r, 0));
    const looping = ctx.sources.slice(before).filter((s) => s.loop && s.startedAt !== null);
    expect(looping).toHaveLength(1);
    early.set({ rate: 1.5 });
    expect(looping[0]!.playbackRate.value).toBeCloseTo(1.5, 6);
  });

  it("does nothing, quietly, for a cue it does not have", async () => {
    const { e, ctx } = await ready();
    const before = ctx.sources.length;
    const loop = e.controlledLoop("no_such_cue");
    loop.set({ rate: 2 });
    loop.stop();
    expect(ctx.sources.length).toBe(before);
    expect(warn).toHaveBeenCalled();
  });
});

describe("the music bus", () => {
  it("is one node, joined to the master, the same every time", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const ctx = new FakeContext();
    const e = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, workers: 0 });
    const a = e.musicBus();
    expect(e.musicBus()).toBe(a);
    expect((a as unknown as Node).outputs).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
