/**
 * The engine's behaviour against a stand-in AudioContext that records what
 * it is asked to do (Node has no Web Audio, and nothing here may make a
 * sound). The takes are really synthesised; only the playback is pretend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUES } from "./cues/table";
import { MAX_VOICES, WebAudioEngine } from "./engine";
import { NullAudioBus, createAudioBus, loadSoundPack } from "./index";
import { SPEED_OF_SOUND, hurtMix, volumeGain } from "./routing";

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
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new Param(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  start(when = 0, offset = 0): void { this.startedAt = when; this.offset = offset; }
  stop(when = 0): void { this.stoppedAt = when; }
}

class FakeBuffer {
  duration: number;
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.duration = length / sampleRate;
  }
  copyToChannel(): void {}
}

class FakeContext {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  onstatechange: (() => void) | null = null;
  destination = new Node();
  sources: Source[] = [];
  filters: { type: string; frequency: Param; Q: Param }[] = [];
  gains: (Node & { gain: Param })[] = [];
  createGain(): Node & { gain: Param } {
    const g = Object.assign(new Node(), { gain: new Param(1) });
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): Node & { pan: Param } { return Object.assign(new Node(), { pan: new Param(0) }); }
  createBiquadFilter(): Node & { type: string; frequency: Param; Q: Param } {
    const f = Object.assign(new Node(), { type: "lowpass", frequency: new Param(350), Q: new Param(1) });
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): Node & { threshold: Param; knee: Param; ratio: Param; attack: Param; release: Param } {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createWaveShaper(): Node & { curve: Float32Array | null } { return Object.assign(new Node(), { curve: null }); }
  createConvolver(): Node & { buffer: FakeBuffer | null; normalize: boolean } { return Object.assign(new Node(), { buffer: null, normalize: true }); }
  createBuffer(ch: number, length: number, sr: number): FakeBuffer { return new FakeBuffer(ch, length, sr); }
  createBufferSource(): Source {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  resume(): Promise<void> { this.state = "running"; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = "suspended"; return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
}

function engine(muted = false): { e: WebAudioEngine; ctx: FakeContext } {
  const ctx = new FakeContext();
  const e = new WebAudioEngine(ctx as unknown as AudioContext, { muted, workers: 0 });
  return { e, ctx };
}

describe("the engine", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("plays nothing for an unknown cue, and says so once", () => {
    const { e, ctx } = engine();
    const before = ctx.sources.length;
    e.play("no_such_sound");
    e.play("no_such_sound");
    const stop = e.loop("no_such_sound");
    stop();
    expect(ctx.sources.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("plays the player's shot now, with the street's echoes after it", () => {
    const { e, ctx } = engine();
    e.play("revolver_shot");
    const started = ctx.sources.filter((s) => s.startedAt !== null);
    expect(started.length).toBeGreaterThanOrEqual(4);
    const times = started.map((s) => s.startedAt!).sort((a, b) => a - b);
    expect(times[0]).toBe(0);
    // Echoes off the facades within a few tens of milliseconds, the church a third of a second later.
    expect(times.some((t) => t > 0.03 && t < 0.05)).toBe(true);
    expect(times.some((t) => t > 0.3 && t < 0.4)).toBe(true);
    // Every copy is the same take.
    expect(new Set(started.map((s) => s.buffer)).size).toBe(1);
  });

  it("delays a far shot by the speed of sound and darkens it, but not a hit (feedback is never late)", () => {
    const { e, ctx } = engine();
    e.play("bandit_shot", { distance: 40, pan: -0.3 });
    const first = Math.min(...ctx.sources.filter((s) => s.startedAt !== null).map((s) => s.startedAt!));
    expect(first).toBeCloseTo(40 / SPEED_OF_SOUND, 4);
    expect(ctx.filters.some((f) => f.frequency.value < 8000 && f.frequency.value > 5000)).toBe(true);
    const n = ctx.sources.length;
    e.play("hit_flesh", { distance: 40 });
    expect(Math.min(...ctx.sources.slice(n).map((s) => s.startedAt!))).toBe(0);
  });

  it("keeps a hit on a far man as loud as on a near one, and darker, but lets a stray shot's thud fall away", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no level variation
    const { e, ctx } = engine();
    /** The direct sound's gain (the second gain a voice makes, after its output) and its air (the first filter). */
    const voice = (cue: string, distance: number): { gain: number; cutoff: number } => {
      const g = ctx.gains.length;
      const f = ctx.filters.length;
      ctx.currentTime += 1; // apart, so no minimum gap or cap is in play
      e.play(cue, { distance });
      return { gain: ctx.gains[g + 1]!.gain.value, cutoff: ctx.filters[f]!.frequency.value };
    };
    const near = voice("hit_flesh", 12);
    const far = voice("hit_flesh", 45);
    expect(far.gain).toBeCloseTo(near.gain, 9);
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(voice("hit_flesh", 3).gain).toBeGreaterThan(near.gain); // closer than that is louder still
    expect(voice("hit_wood", 45).gain).toBeLessThan(voice("hit_wood", 12).gain * 0.8);
  });

  it("honours delay and rate, and varies the rate only a little", () => {
    const { e, ctx } = engine();
    e.play("hit_wood", { delay: 0.5, rate: 1.5 });
    // The direct sound is the first source of the voice; the rest are its echoes.
    const s = ctx.sources.filter((x) => x.startedAt !== null).sort((a, b) => a.startedAt! - b.startedAt!)[0]!;
    expect(s.startedAt).toBeCloseTo(0.5, 6);
    const spread = CUES.hit_wood!.vary!;
    expect(s.playbackRate.value).toBeGreaterThanOrEqual(1.5 * (1 - spread) - 1e-9);
    expect(s.playbackRate.value).toBeLessThanOrEqual(1.5 * (1 + spread) + 1e-9);
  });

  it("keeps a pile-up within the voice budget and each cue within its cap", () => {
    const { e } = engine();
    for (let k = 0; k < 80; k++) {
      e.play("bandit_shot", { distance: 10 + k, pan: (k % 7) / 3 - 1, delay: k * 0.001 });
      e.play("hit_dirt", { distance: 20, delay: k * 0.03 });
    }
    const voices = (e as unknown as { voices: { cue: string }[] }).voices;
    expect(voices.length).toBeLessThanOrEqual(MAX_VOICES);
    expect(voices.filter((v) => v.cue === "bandit_shot").length).toBeLessThanOrEqual(CUES.bandit_shot!.maxInstances!);
  });

  it("drops a repeat of the same cue inside its minimum gap", () => {
    const { e, ctx } = engine();
    e.play("hit_flesh");
    const n = ctx.sources.length;
    e.play("hit_flesh");
    expect(ctx.sources.length).toBe(n);
    e.play("hit_flesh", { delay: 0.1 });
    expect(ctx.sources.length).toBeGreaterThan(n);
  });

  it("is silent and idle when muted, and remembers it", () => {
    const { e, ctx } = engine(true);
    expect(e.muted).toBe(true);
    expect(ctx.state).toBe("suspended");
    e.play("revolver_shot");
    expect(ctx.sources.length).toBe(0);
    e.setMuted(false);
    expect(e.muted).toBe(false);
    expect(ctx.state).toBe("running");
    e.play("revolver_shot");
    expect(ctx.sources.length).toBeGreaterThan(0);
  });

  it("starts a loop somewhere inside it, and stops it with a fade", async () => {
    const { e, ctx } = engine();
    e.library.renderNow("dynamite_fuse");
    const stop = e.loop("dynamite_fuse");
    const src = ctx.sources.find((s) => s.loop)!;
    expect(src).toBeDefined();
    expect(src.startedAt).toBe(0);
    expect(src.offset).toBeGreaterThanOrEqual(0);
    expect(src.offset).toBeLessThan(src.buffer!.duration);
    stop();
    expect(src.stoppedAt).toBeGreaterThan(0);
    stop(); // twice is harmless
  });

  it("muffles and ducks when hurt, and slows the world in slow motion", () => {
    const { e, ctx } = engine();
    e.setFilter("hurt", 0.5);
    const muffle = ctx.filters[0]!;
    expect(muffle.frequency.value).toBeCloseTo(hurtMix(0.5).cutoff, 3);
    e.play("bandit_shot");
    const src = ctx.sources.find((s) => s.startedAt !== null)!;
    const rate = src.playbackRate.value;
    e.setFilter("slowmo", 1);
    expect(src.playbackRate.value).toBeLessThan(rate * 0.7);
    // The interface is never slowed.
    const n = ctx.sources.length;
    e.play("ui_tap");
    const tap = ctx.sources.slice(n).find((s) => s.startedAt !== null)!;
    expect(tap.playbackRate.value).toBeGreaterThan(0.95);
    e.setFilter("hurt", 0);
    e.setFilter("slowmo", 0);
    expect(muffle.frequency.value).toBe(20000);
    e.dispose();
  });
});

describe("the public entry", () => {
  it("falls back to a silent bus without Web Audio", async () => {
    const bus = await createAudioBus({ muted: false });
    expect(bus).toBeInstanceOf(NullAudioBus);
    expect(bus.muted).toBe(false);
    bus.setMuted(true);
    expect(bus.muted).toBe(true);
    const progress: number[] = [];
    await loadSoundPack(bus, "western", (f) => progress.push(f));
    expect(progress).toEqual([1]);
    expect(bus.loop("wind")).toBeTypeOf("function");
  });

  it("keeps NullAudioBus muted by default, as the stub was", () => {
    expect(new NullAudioBus().muted).toBe(true);
  });

  it("gives even the silent bus a volume, held to the range", () => {
    const bus = new NullAudioBus(false);
    expect(bus.volume).toBe(1);
    bus.setVolume(0.4);
    expect(bus.volume).toBe(0.4);
    bus.setVolume(7);
    expect(bus.volume).toBe(1);
    bus.setVolume(Number.NaN);
    expect(bus.volume).toBe(0);
  });
});

describe("the master volume", () => {
  const master = (e: WebAudioEngine) => (e as unknown as { master: { gain: { value: number } } }).master.gain.value;

  it("starts where the player left it", () => {
    const ctx = new FakeContext();
    const e = new WebAudioEngine(ctx as unknown as AudioContext, { muted: false, volume: 0.5, workers: 0 });
    expect(e.volume).toBe(0.5);
    expect(master(e)).toBeCloseTo(0.9 * volumeGain(0.5), 9);
    expect(master(engine().e)).toBeCloseTo(0.9, 9);
  });

  it("follows the slider", () => {
    const { e } = engine();
    e.setVolume(0.25);
    expect(e.volume).toBe(0.25);
    expect(master(e)).toBeCloseTo(0.9 * volumeGain(0.25), 9);
    e.setVolume(0);
    expect(master(e)).toBe(0);
    e.setVolume(2);
    expect(e.volume).toBe(1);
    expect(master(e)).toBeCloseTo(0.9, 9);
  });

  it("is apart from mute: muted stays silent, and unmuting comes back at the volume chosen", () => {
    const { e } = engine();
    e.setMuted(true);
    e.setVolume(0.6);
    expect(master(e)).toBe(0);
    expect(e.muted).toBe(true);
    e.setMuted(false);
    expect(master(e)).toBeCloseTo(0.9 * volumeGain(0.6), 9);
  });
});
