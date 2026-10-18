/**
 * RaceAudio against a recording bus: no audio device, nothing played. What a
 * race does to the sound is checked as calls: which cue, how loud, where, and
 * which loops are running.
 */
import { describe, expect, it } from "vitest";
import type { AudioBus, CueOptions } from "../../engine/types";
import type { LoopControl, LoopParams, SteerableAudio } from "../../audio/types";
import type { KartView, RaceEvent, RaceView, ThingView, TrackDef } from "../contract";
import { createRaceAudio, type LocalKart, type RaceAudio } from "./race-audio";
import { localKarts } from "./scene";
import { FINAL_LAP, type MusicRenderer } from "./music/loader";
import type { MusicTrack } from "./music/player";
import type { RenderedMusic } from "./music/render";

// --- fixtures ----------------------------------------------------------------------------------------

function kart(id: number, over: Partial<KartView> = {}): KartView {
  return {
    id, x: id * 10, y: 0, z: 0, heading: 0, speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: id + 1, lap: 1,
    lapProgress: 0.1, wrongWay: false, finished: null, ...over,
  };
}

const TRACK = { id: "t", name: "T", theme: "meadow", laps: 3, points: [], width: 12, itemRows: [] } as unknown as TrackDef;

function view(karts: KartView[], over: Partial<RaceView> = {}, events: RaceEvent[] = [], things: ThingView[] = []): RaceView {
  return { tick: 0, phase: "racing", countdown: 0, time: 5, laps: 3, track: TRACK, racers: [], karts, things, events, ...over };
}

let eventId = 1;
const ev = <T extends RaceEvent["type"]>(type: T, fields: Omit<Extract<RaceEvent, { type: T }>, "id" | "tick" | "type">): RaceEvent =>
  ({ id: eventId++, tick: 0, type, ...fields }) as unknown as RaceEvent;

class Recorder implements AudioBus, SteerableAudio {
  muted = false;
  readonly ctx = {} as BaseAudioContext;
  played: { cue: string; options: CueOptions }[] = [];
  loops: { cue: string; options: CueOptions; sets: LoopParams[]; stopped: boolean }[] = [];
  plain: { cue: string; options: CueOptions; stopped: boolean }[] = [];
  setFilter(): void {}
  play(cue: string, options: CueOptions = {}): void {
    this.played.push({ cue, options });
  }
  loop(cue: string, options: CueOptions = {}): () => void {
    const rec = { cue, options, stopped: false };
    this.plain.push(rec);
    return () => {
      rec.stopped = true;
    };
  }
  controlledLoop(cue: string, options: CueOptions = {}): LoopControl {
    const rec = { cue, options, sets: [] as LoopParams[], stopped: false };
    this.loops.push(rec);
    return {
      set: (p) => rec.sets.push(p),
      stop: () => {
        rec.stopped = true;
      },
    };
  }
  musicBus(): AudioNode {
    return {} as AudioNode;
  }
  get cues(): string[] {
    return this.played.map((p) => p.cue);
  }
  running(cue: string): number {
    return this.loops.filter((l) => l.cue === cue && !l.stopped).length;
  }
  lastSet(cue: string): LoopParams | undefined {
    const l = this.loops.filter((x) => x.cue === cue && !x.stopped).at(-1);
    return l?.sets.at(-1);
  }
  clear(): void {
    this.played = [];
  }
}

class FakePlayer {
  current: MusicTrack | null = null;
  calls: string[] = [];
  volume = -1;
  paused = false;
  ducks: [number, number][] = [];
  play(track: MusicTrack): void {
    this.current = track;
    this.calls.push(`play ${track.id}`);
  }
  switchTo(track: MusicTrack): void {
    this.current = track;
    this.calls.push(`switch ${track.id}`);
  }
  stop(): void {
    this.current = null;
    this.calls.push("stop");
  }
  duck(depth: number, hold: number): void {
    this.ducks.push([depth, hold]);
  }
  setVolume(v: number): void {
    this.volume = v;
  }
  setPaused(p: boolean): void {
    this.paused = p;
  }
  dispose(): void {
    this.calls.push("dispose");
  }
}

class FakeRenderer implements MusicRenderer {
  requests: string[] = [];
  render(id: string, final: boolean): Promise<RenderedMusic> {
    this.requests.push(final ? `${id}-final` : id);
    return Promise.resolve({
      id, sampleRate: 32000, left: new Float32Array(4), right: new Float32Array(4), loopSamples: 4, duration: 1,
      bars: [], tempoScale: final ? FINAL_LAP.tempoScale : 1, transpose: final ? FINAL_LAP.transpose : 0,
      stats: { rmsDb: -18, peakDb: -2, renderMs: 1, parts: {}, warnings: [] },
    });
  }
  dispose(): void {}
}

function setup(local: LocalKart[] = [{ kart: 0, pan: -0.5 }, { kart: 1, pan: 0.5 }]) {
  const bus = new Recorder();
  const player = new FakePlayer();
  const renderer = new FakeRenderer();
  const audio: RaceAudio = createRaceAudio(bus, {
    player: player as never,
    renderer,
    makeTrack: (r) => ({ id: r.id + (r.transpose ? "-final" : ""), buffer: {} as AudioBuffer, beats: new Float32Array([0, 0.25]), duration: 1 }),
  });
  const frame = (karts: KartView[], over: Partial<RaceView> = {}, events: RaceEvent[] = [], things: ThingView[] = [], dt = 1 / 60): void =>
    audio.frame(view(karts, over, events, things), local, dt);
  return { bus, player, renderer, audio, frame, local };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// --- tests ---------------------------------------------------------------------------------------------

describe("the countdown", () => {
  it("beeps low three times and high on go, centred", () => {
    const { bus, frame } = setup();
    for (const n of [3, 2, 1, 0] as const) frame([kart(0), kart(1)], { phase: "countdown", countdown: n }, [ev("countdown", { n })]);
    expect(bus.cues).toEqual(["kart_beep_low", "kart_beep_low", "kart_beep_low", "kart_beep_high"]);
    expect(bus.played.every((p) => p.options.pan === 0)).toBe(true);
  });

  it("hears each event once, however many times the view is given", () => {
    const { bus, frame } = setup();
    const e = ev("countdown", { n: 3 });
    frame([kart(0)], { phase: "countdown" }, [e]);
    frame([kart(0)], { phase: "countdown" }, [e]);
    expect(bus.cues).toEqual(["kart_beep_low"]);
  });
});

describe("events become sounds", () => {
  const cases: [string, RaceEvent, string[]][] = [
    ["a pickup", ev("pickup", { kart: 0, item: "puck" }), ["kart_box_smash"]],
    ["nitro", ev("use", { kart: 0, item: "nitro" }), ["kart_nitro"]],
    ["triple nitro", ev("use", { kart: 0, item: "nitro3" }), ["kart_nitro"]],
    ["a puck", ev("use", { kart: 0, item: "puck" }), ["kart_puck_fire"]],
    ["a seeker", ev("use", { kart: 0, item: "seeker" }), ["kart_puck_fire"]],
    ["a slick", ev("use", { kart: 0, item: "slick" }), ["kart_slick_splat"]],
    ["hit by a puck", ev("hit", { kart: 0, by: 1, cause: "puck" }), ["kart_hit"]],
    ["hit by a seeker", ev("hit", { kart: 0, by: 1, cause: "seeker" }), ["kart_hit"]],
    ["spinning on a slick", ev("hit", { kart: 0, by: null, cause: "slick" }), ["kart_spinout"]],
    ["a drift boost", ev("boost", { kart: 0, source: "drift", level: 1 }), ["kart_mini_turbo"]],
    ["a nitro boost", ev("boost", { kart: 0, source: "nitro", level: 1 }), ["kart_boost_whoosh"]],
    ["a pad", ev("boost", { kart: 0, source: "pad", level: 1 }), ["kart_boost_pad"]],
    ["a start boost", ev("boost", { kart: 0, source: "start", level: 1 }), ["kart_start_boost"]],
    ["blue sparks", ev("drift-level", { kart: 0, level: 1 }), ["kart_spark_blue"]],
    ["orange sparks", ev("drift-level", { kart: 0, level: 2 }), ["kart_spark_orange"]],
    ["a bump", ev("bump", { a: 0, b: 1, strength: 0.5 }), ["kart_bump"]],
    ["a hard wall", ev("wall", { kart: 0, strength: 0.9 }), ["kart_wall_thud"]],
    ["a scrape", ev("wall", { kart: 0, strength: 0.1 }), ["kart_wall_scrape"]],
    ["a lap", ev("lap", { kart: 0, lap: 2 }), ["kart_lap"]],
    ["the final lap", ev("final-lap", { kart: 0 }), ["kart_final_lap"]],
    ["a win", ev("finish", { kart: 0, place: 1, time: 90 }), ["kart_finish_win", "kart_cheer"]],
    ["a second place", ev("finish", { kart: 0, place: 2, time: 91 }), ["kart_finish_ok", "kart_cheer"]],
    ["a jump", ev("jump", { kart: 0 }), ["kart_jump"]],
    ["a trick", ev("trick", { kart: 0 }), ["kart_trick"]],
    ["a landing", ev("land", { kart: 0, boost: false }), ["kart_land"]],
    ["a boosted landing", ev("land", { kart: 0, boost: true }), ["kart_land", "kart_boost_whoosh"]],
    ["falling", ev("fall", { kart: 0 }), ["kart_fall"]],
    ["being rescued", ev("rescued", { kart: 0 }), ["kart_drone_drop"]],
    ["a hazard", ev("hazard", { kart: 0, kind: "boulder" }), ["kart_hazard"]],
  ];

  it.each(cases)("%s", (_name, event, expected) => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [event]);
    expect(bus.cues.sort()).toEqual([...expected].sort());
  });

  it("places the player's own sounds in their own side of the stereo field", () => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("pickup", { kart: 0, item: "puck" }), ev("pickup", { kart: 1, item: "puck" })]);
    const pans = bus.played.map((p) => p.options.pan);
    expect(pans).toContain(-0.5);
    expect(pans).toContain(0.5);
    expect(bus.played.every((p) => p.options.distance === 0)).toBe(true);
  });

  it("keeps the lap chimes, fanfares and jingles for the player's own karts", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0), kart(5, { x: 4 })], {}, [ev("lap", { kart: 5, lap: 2 }), ev("final-lap", { kart: 5 }), ev("finish", { kart: 5, place: 1, time: 80 })]);
    expect(bus.cues).toEqual([]);
  });

  it("does not chime for the last lap (it has its own jingle) or past it", () => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("lap", { kart: 0, lap: 3 }), ev("lap", { kart: 0, lap: 4 })]);
    expect(bus.cues).toEqual([]);
  });

  it("hears another kart's events by their distance, from its side, and not at all when far", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0, { x: 0 }), kart(2, { x: 12, z: 0 })], {}, [ev("use", { kart: 2, item: "nitro" })]);
    expect(bus.played).toHaveLength(1);
    expect(bus.played[0]!.options.distance).toBeCloseTo(12, 5);
    expect(bus.played[0]!.options.volume!).toBeLessThan(0.8);
    // Heading 0 faces +z, so its right is -x: a kart at +x is on its left.
    expect(bus.played[0]!.options.pan!).toBeLessThan(0);
    bus.clear();
    frame([kart(0, { x: 0 }), kart(2, { x: 300, z: 0 })], {}, [ev("use", { kart: 2, item: "nitro" })]);
    expect(bus.played).toHaveLength(0);
  });

  it("makes a heavy bump lower and louder than a graze", () => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("bump", { a: 0, b: 1, strength: 0.1 }), ev("bump", { a: 0, b: 1, strength: 1 })]);
    const [soft, hard] = bus.played.sort((a, b) => a.options.volume! - b.options.volume!);
    expect(hard!.options.volume!).toBeGreaterThan(soft!.options.volume!);
    expect(hard!.options.rate!).toBeLessThan(soft!.options.rate!);
  });

  it("raises the pitch of a level-two mini-turbo", () => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("boost", { kart: 0, source: "drift", level: 1 }), ev("boost", { kart: 0, source: "drift", level: 2 })]);
    const rates = bus.played.map((p) => p.options.rate!).sort();
    expect(rates[1]!).toBeGreaterThan(rates[0]!);
  });

  it("gives each hazard kind its own small pitch", () => {
    const { bus, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("hazard", { kart: 0, kind: "boulder" }), ev("hazard", { kart: 0, kind: "penguin" })]);
    expect(new Set(bus.played.map((p) => p.options.rate)).size).toBe(2);
  });

  it("limits a frame to a handful of sounds and two of any one, keeping the important ones", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const noisy: RaceEvent[] = [];
    for (let i = 0; i < 20; i++) noisy.push(ev("bump", { a: 0, b: 1, strength: 0.5 }));
    noisy.push(ev("finish", { kart: 0, place: 1, time: 1 }));
    frame([kart(0), kart(1, { x: 2 })], {}, noisy);
    expect(bus.cues.filter((c) => c === "kart_bump").length).toBeLessThanOrEqual(2);
    expect(bus.cues).toContain("kart_finish_win");
    expect(bus.played.length).toBeLessThanOrEqual(8);
  });

  it("ducks the music under the big ones", () => {
    const { player, frame } = setup();
    frame([kart(0), kart(1)], {}, [ev("finish", { kart: 0, place: 1, time: 1 })]);
    expect(player.ducks.length).toBe(1);
    expect(player.ducks[0]![0]).toBeLessThan(0.5);
  });
});

describe("engines", () => {
  it("runs one engine and one idle for each local kart, in different timbres", () => {
    const { bus, frame } = setup([{ kart: 0, pan: -0.6 }, { kart: 1, pan: -0.2 }, { kart: 2, pan: 0.2 }, { kart: 3, pan: 0.6 }]);
    frame([kart(0), kart(1), kart(2), kart(3)], { phase: "countdown" });
    const engines = bus.loops.filter((l) => l.cue.startsWith("kart_engine"));
    expect(engines).toHaveLength(4);
    expect(new Set(engines.map((l) => l.cue)).size).toBe(4);
    expect(bus.loops.filter((l) => l.cue === "kart_idle")).toHaveLength(4);
    expect(new Set(engines.map((l) => l.options.pan)).size).toBe(4);
  });

  it("pitches the engine with speed, smoothly", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const rates: number[] = [];
    for (let s = 0; s <= 24; s += 2) {
      for (let i = 0; i < 20; i++) frame([kart(0, { speed: s })]);
      rates.push(bus.lastSet("kart_engine_a")!.rate!);
    }
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
    expect(rates[0]!).toBeGreaterThan(0.5);
    expect(rates.at(-1)!).toBeLessThan(2.2);
    // One frame never jumps far.
    const { bus: b2, frame: f2 } = setup([{ kart: 0, pan: 0 }]);
    f2([kart(0, { speed: 0 })]);
    f2([kart(0, { speed: 24 })]);
    const first = b2.loops.find((l) => l.cue === "kart_engine_a")!;
    expect(first.sets.at(-1)!.rate!).toBeLessThan(first.options.rate! * 1.6);
  });

  it("hands the idle to the engine as the kart moves off", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 0 })]);
    const idleStill = bus.lastSet("kart_idle")!.volume!;
    const engineStill = bus.lastSet("kart_engine_a")!.volume!;
    for (let i = 0; i < 120; i++) frame([kart(0, { speed: 15 })]);
    expect(bus.lastSet("kart_idle")!.volume!).toBeLessThan(idleStill * 0.2);
    expect(bus.lastSet("kart_engine_a")!.volume!).toBeGreaterThan(engineStill);
  });

  it("growls only while boosting", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 20 })]);
    expect(bus.running("kart_growl")).toBe(0);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 28, boost: 1 })]);
    expect(bus.running("kart_growl")).toBe(1);
    expect(bus.lastSet("kart_growl")!.volume!).toBeGreaterThan(0.01);
    for (let i = 0; i < 120; i++) frame([kart(0, { speed: 22 })]);
    expect(bus.running("kart_growl")).toBe(0);
  });

  it("raises the pitch of a boosting engine over a plain one at the same speed", () => {
    const a = setup([{ kart: 0, pan: 0 }]);
    const b = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 60; i++) {
      a.frame([kart(0, { speed: 24 })]);
      b.frame([kart(0, { speed: 24, boost: 1 })]);
    }
    expect(b.bus.lastSet("kart_engine_a")!.rate!).toBeGreaterThan(a.bus.lastSet("kart_engine_a")!.rate!);
  });

  it("hears the nearest other karts, quieter with distance, and no more than six engines in all", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const karts = [kart(0, { x: 0, z: 0, speed: 20 })];
    for (let id = 1; id <= 7; id++) karts.push(kart(id, { x: 8 * id, z: 0, speed: 20 }));
    for (let i = 0; i < 20; i++) frame(karts);
    const engines = bus.loops.filter((l) => l.cue.startsWith("kart_engine") && !l.stopped);
    expect(engines).toHaveLength(6);
    const volumes = engines.map((l) => l.sets.at(-1)!.volume!);
    // The player's own is the loudest, the farthest of the rest the quietest.
    expect(volumes[0]!).toBe(Math.max(...volumes));
    const others = engines.slice(1).map((l) => ({ d: l.sets.at(-1)!.distance!, v: l.sets.at(-1)!.volume! })).sort((a, b) => a.d - b.d);
    for (let i = 1; i < others.length; i++) expect(others[i]!.v).toBeLessThanOrEqual(others[i - 1]!.v + 1e-9);
  });

  it("silences an engine carried off by the drone", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 10 })]);
    for (let i = 0; i < 60; i++) frame([kart(0, { speed: 0, rescue: 2 })]);
    expect(bus.lastSet("kart_engine_a")!.volume!).toBeLessThan(0.01);
    expect(bus.lastSet("kart_idle")!.volume!).toBeLessThan(0.01);
  });

  it("makes four local engines no louder together than the mix can bear", () => {
    const four = setup([{ kart: 0, pan: -0.6 }, { kart: 1, pan: -0.2 }, { kart: 2, pan: 0.2 }, { kart: 3, pan: 0.6 }]);
    const one = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 40; i++) {
      four.frame([kart(0, { speed: 20 }), kart(1, { speed: 20, x: 3 }), kart(2, { speed: 20, x: 6 }), kart(3, { speed: 20, x: 9 })]);
      one.frame([kart(0, { speed: 20 })]);
    }
    const sum = (r: Recorder): number => r.loops.filter((l) => l.cue.startsWith("kart_engine")).reduce((a, l) => a + l.sets.at(-1)!.volume!, 0);
    expect(sum(four.bus)).toBeLessThan(sum(one.bus) * 2.5);
    expect(sum(four.bus)).toBeGreaterThan(sum(one.bus));
  });
});

describe("loops that follow state", () => {
  it("squeals while drifting on the road and stops when it ends", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 1 })]);
    expect(bus.running("kart_drift")).toBe(1);
    const blue = bus.lastSet("kart_drift")!;
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 2 })]);
    expect(bus.lastSet("kart_drift")!.rate!).toBeGreaterThan(blue.rate!);
    frame([kart(0, { speed: 20, drift: 0 })]);
    expect(bus.running("kart_drift")).toBe(0);
  });

  it("squeals for the player's own kart and the nearest three others, however many drift together", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const pack = [kart(0, { x: 0, speed: 20, drift: 1, driftLevel: 1 })];
    for (let id = 1; id <= 7; id++) pack.push(kart(id, { x: 4 * id, speed: 20, drift: 1, driftLevel: 1 }));
    for (let i = 0; i < 10; i++) frame(pack);
    expect(bus.running("kart_drift")).toBe(4);
    const heard = bus.loops.filter((l) => l.cue === "kart_drift" && !l.stopped).map((l) => l.sets.at(-1)?.distance ?? l.options.distance);
    // The player's own (at no distance) and the three nearest, 4, 8 and 12 m away.
    expect(heard.sort((a, b) => a! - b!)).toEqual([0, 4, 8, 12]);
  });

  it("does not squeal in the air, off the road or at a crawl", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0, { speed: 20, drift: 1, hop: 0.5 })]);
    frame([kart(0, { speed: 20, drift: 1, offroad: true, surface: "grass" })]);
    frame([kart(0, { speed: 2, drift: 1 })]);
    expect(bus.running("kart_drift")).toBe(0);
  });

  it.each([
    ["ice", "kart_surf_ice"],
    ["snow", "kart_surf_snow"],
    ["sand", "kart_surf_sand"],
    ["mud", "kart_surf_mud"],
    ["grass", "kart_surf_grass"],
  ] as const)("plays %s under the wheels, and not on the road", (surface, cue) => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 15, surface, offroad: surface !== "ice" })]);
    expect(bus.running(cue)).toBe(1);
    frame([kart(0, { speed: 15, surface: "road" })]);
    expect(bus.running(cue)).toBe(0);
  });

  it("swaps the surface loop when the ground changes", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 15, surface: "sand" })]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 15, surface: "mud" })]);
    expect(bus.running("kart_surf_sand")).toBe(0);
    expect(bus.running("kart_surf_mud")).toBe(1);
  });

  it("whistles for a seeker while it lives, rising as it closes in", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const thing = (z: number): ThingView => ({ id: 77, kind: "seeker", x: 0, y: 0, z, heading: 0, active: true });
    for (const z of [90, 80, 70, 60, 50]) frame([kart(0, { z: 0 })], {}, [], [thing(z)], 0.1);
    expect(bus.running("kart_seeker")).toBe(1);
    expect(bus.lastSet("kart_seeker")!.rate!).toBeGreaterThan(1);
    frame([kart(0)], {}, [], []);
    expect(bus.running("kart_seeker")).toBe(0);
  });

  it("bounces a puck's sound when it turns sharply, once", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const puck = (heading: number): ThingView => ({ id: 5, kind: "puck", x: 5, y: 0, z: 10, heading, active: true });
    for (let i = 0; i < 6; i++) frame([kart(0)], {}, [], [puck(0.3)], 1 / 60);
    expect(bus.cues).not.toContain("kart_puck_bounce");
    frame([kart(0)], {}, [], [puck(0.3 + 1.6)], 1 / 60);
    frame([kart(0)], {}, [], [puck(0.3 + 1.6)], 1 / 60);
    expect(bus.cues.filter((c) => c === "kart_puck_bounce")).toHaveLength(1);
  });

  it("runs the drone's rotors while a kart is carried, and stops after", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 5; i++) frame([kart(0, { rescue: 1.5 })]);
    expect(bus.running("kart_drone")).toBe(1);
    frame([kart(0, { rescue: 0 })]);
    expect(bus.running("kart_drone")).toBe(0);
  });

  it("ticks the item roulette, slower and higher, and chimes when it lands", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 70; i++) frame([kart(0, { rolling: true })], {}, [], [], 1 / 60);
    const ticks = bus.played.filter((p) => p.cue === "kart_roulette_tick");
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.at(-1)!.options.rate!).toBeGreaterThan(ticks[0]!.options.rate!);
    expect(bus.cues).not.toContain("kart_item_ready");
    frame([kart(0, { rolling: false, item: "puck" })]);
    expect(bus.cues).toContain("kart_item_ready");
  });

  it("coughs when the sim says the start flooded, and not for a kart that was only slow away", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }, { kart: 1, pan: 0.5 }]);
    // Kart 1 sat still at Go without flooding (the throttle came late): no cough for it.
    frame([kart(0, { speed: 0 }), kart(1, { speed: 0 })], { time: 0.3 }, [ev("flood", { kart: 0 })]);
    frame([kart(0, { speed: 0 }), kart(1, { speed: 0 })], { time: 0.4 });
    expect(bus.cues.filter((c) => c === "kart_flood")).toHaveLength(1);
  });
});

describe("music", () => {
  it("starts the race music at Go, not during the countdown", async () => {
    const { player, renderer, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0), kart(1)], { phase: "countdown", countdown: 2 });
    await settle();
    expect(player.calls).toEqual([]);
    frame([kart(0), kart(1)], { phase: "racing", countdown: 0 });
    await settle();
    expect(player.calls).toEqual(["play meadow"]);
    expect(renderer.requests).toContain("meadow");
  });

  it("renders the final-lap version in the background while loading", async () => {
    const { renderer, audio } = setup();
    await audio.load("canyon");
    await settle();
    expect(renderer.requests).toEqual(["canyon", "canyon-final"]);
  });

  it("switches to the faster version when the FIRST local kart starts its last lap, and only once", async () => {
    const { player, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    expect(player.current!.id).toBe("meadow");
    frame([kart(0, { lap: 3 }), kart(1, { lap: 2 })], {}, [ev("final-lap", { kart: 0 })]);
    await settle();
    expect(player.calls).toEqual(["play meadow", "switch meadow-final"]);
    frame([kart(0, { lap: 3 }), kart(1, { lap: 3 })], {}, [ev("final-lap", { kart: 1 })]);
    await settle();
    expect(player.calls).toEqual(["play meadow", "switch meadow-final"]);
  });

  it("ignores a bot's final lap", async () => {
    const { player, audio, frame } = setup([{ kart: 0, pan: 0 }]);
    await audio.load("meadow");
    frame([kart(0), kart(4, { x: 5 })], { phase: "racing" });
    await settle();
    frame([kart(0, { lap: 2 }), kart(4, { x: 5, lap: 3 })], {}, [ev("final-lap", { kart: 4 })]);
    await settle();
    expect(player.calls).toEqual(["play meadow"]);
  });

  it("switches even if the final-lap event was lost, when a local kart is on its last lap", async () => {
    const { player, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    frame([kart(0, { lap: 3 }), kart(1)], {});
    await settle();
    expect(player.calls).toContain("switch meadow-final");
  });

  it("starts the next race from the normal version again", async () => {
    const { player, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    frame([kart(0, { lap: 3 }), kart(1)], {}, [ev("final-lap", { kart: 0 })]);
    await settle();
    frame([kart(0), kart(1)], { phase: "countdown" });
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    expect(player.calls.at(-1)).toBe("play meadow");
  });

  it("plays the screens' music on request: the lobby shares the menu's tune, null stops", async () => {
    const { player, renderer, audio } = setup();
    audio.music("menu");
    await settle();
    audio.music("lobby");
    await settle();
    expect(player.calls).toEqual(["play menu"]);
    audio.music("results-win");
    await settle();
    audio.music("podium");
    await settle();
    audio.music(null);
    expect(player.calls).toEqual(["play menu", "play results-win", "play podium", "stop"]);
    expect(renderer.requests).toEqual(["menu", "results-win", "podium"]);
  });

  it("drops a track that arrives after something else was asked for", async () => {
    const { player, audio } = setup();
    audio.music("menu");
    audio.music("podium");
    await settle();
    expect(player.calls).toEqual(["play podium"]);
  });

  it("applies the two sliders", () => {
    const { bus, player, audio, frame } = setup();
    audio.setVolumes({ music: 0.4 });
    expect(player.volume).toBe(0.4);
    audio.setVolumes({ effects: 0 });
    frame([kart(0), kart(1)], {}, [ev("jump", { kart: 0 })]);
    expect(bus.played).toHaveLength(0);
    audio.setVolumes({ effects: 1 });
    frame([kart(0), kart(1)], {}, [ev("jump", { kart: 0 })]);
    expect(bus.played).toHaveLength(1);
    audio.setVolumes({ music: Number.NaN, effects: 7 });
    expect(player.volume).toBe(0.4);
  });
});

describe("pause, mute and dispose", () => {
  it("falls silent while paused and comes back on resume", () => {
    const { bus, player, audio, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 10 })]);
    expect(bus.running("kart_engine_a")).toBe(1);
    audio.pause();
    expect(bus.running("kart_engine_a")).toBe(0);
    expect(player.paused).toBe(true);
    frame([kart(0, { speed: 10 })], {}, [ev("jump", { kart: 0 })]);
    expect(bus.cues).not.toContain("kart_jump");
    audio.resume();
    expect(player.paused).toBe(false);
    frame([kart(0, { speed: 10 })]);
    expect(bus.running("kart_engine_a")).toBe(1);
  });

  it("lets go of the loops when muted", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 10 })]);
    bus.muted = true;
    frame([kart(0, { speed: 10 })]);
    expect(bus.running("kart_engine_a")).toBe(0);
    bus.muted = false;
    frame([kart(0, { speed: 10 })]);
    expect(bus.running("kart_engine_a")).toBe(1);
  });

  it("stops every loop and the music on dispose, and ignores frames after", () => {
    const { bus, player, audio, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 20, drift: 1, surface: "sand" })]);
    audio.dispose();
    expect(bus.loops.every((l) => l.stopped)).toBe(true);
    expect(player.calls).toContain("dispose");
    const before = bus.loops.length;
    frame([kart(0, { speed: 20 })], {}, [ev("jump", { kart: 0 })]);
    expect(bus.loops.length).toBe(before);
    expect(bus.played).toHaveLength(0);
  });

  it("takes sounds by name for the screens", () => {
    const { bus, audio } = setup();
    for (const sound of ["ui-select", "ui-back", "ui-ready", "ui-join", "ui-leave", "ui-start", "duck", "horn"] as const) audio.play(sound);
    expect(bus.cues).toEqual(["kart_ui_select", "kart_ui_back", "kart_ui_ready", "kart_ui_join", "kart_ui_leave", "kart_ui_start", "kart_duck", "kart_horn"]);
  });
});

describe("with a bus that cannot steer loops", () => {
  it("still plays effects and plain loops, and skips the music", () => {
    const plain = new Recorder();
    const bare = { muted: false, play: plain.play.bind(plain), loop: plain.loop.bind(plain), setFilter: () => {} } as AudioBus;
    const audio = createRaceAudio(bare);
    const local = [{ kart: 0, pan: 0 }];
    audio.frame(view([kart(0, { speed: 15 })], {}, [ev("jump", { kart: 0 })]), local, 1 / 60);
    expect(plain.cues).toContain("kart_jump");
    expect(plain.plain.some((l) => l.cue.startsWith("kart_engine") && !l.stopped)).toBe(true);
    audio.music("menu");
    audio.dispose();
    expect(plain.plain.every((l) => l.stopped)).toBe(true);
  });
});

describe("localKarts", () => {
  it("spreads the viewports across the stereo field in reading order", () => {
    expect(localKarts([7])).toEqual([{ kart: 7, pan: 0 }]);
    const two = localKarts([3, 5]);
    expect(two[0]!.pan).toBeLessThan(0);
    expect(two[1]!.pan).toBeGreaterThan(0);
    const four = localKarts([0, 1, 2, 3, 4]);
    expect(four).toHaveLength(4);
    expect(four.map((l) => l.kart)).toEqual([0, 1, 2, 3]);
    expect(localKarts([])).toEqual([]);
  });
});
