/**
 * RaceAudio against a recording bus: no audio device, nothing played. What a
 * race does to the sound is checked as calls: which cue, how loud, where, and
 * which loops are running.
 */
import { describe, expect, it } from "vitest";
import type { AudioBus, CueOptions } from "../../engine/types";
import type { LoopControl, LoopParams, SteerableAudio } from "../../audio/types";
import type { KartView, RaceEvent, RaceView, ThingView, TrackDef } from "../contract";
import { REV_HI, REV_LO, REV_MID, engineTarget, gearFactor, gridFlare } from "./engines";
import { createRaceAudio, type LocalKart, type RaceAudio } from "./race-audio";
import { localKarts } from "./scene";
import { FINAL_LAP, type MusicRenderer } from "./music/loader";
import type { MusicTrack } from "./music/player";
import type { RenderedMusic } from "./music/render";

// --- fixtures ----------------------------------------------------------------------------------------

/** The revs a layer's cue was made at. */
const layerRevs = (cue: string): number => (cue.endsWith("_lo") ? REV_LO : cue.endsWith("_mid") ? REV_MID : REV_HI);
/** The engine a layer's cue belongs to. */
const familyOf = (cue: string): string => cue.split("_")[2]!;

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
  /** What a running loop was last told (or started with). */
  lastSet(cue: string): LoopParams | undefined {
    const l = this.loops.filter((x) => x.cue === cue && !x.stopped).at(-1);
    return l?.sets.at(-1) ?? l?.options;
  }
  /** The engine layers running now. */
  layers(): { cue: string; params: LoopParams }[] {
    return this.loops
      .filter((l) => /^kart_engine_(light|middle|heavy|electric)_(lo|mid|hi)$/.test(l.cue) && !l.stopped)
      .map((l) => ({ cue: l.cue, params: l.sets.at(-1) ?? l.options }));
  }
  /** An engine's revs as its layers play them (a layer's rate times the revs it was made at), from the louder layer. */
  revs(family = "light"): number {
    const heard = this.layers()
      .filter((l) => l.cue.includes(`_${family}_`))
      .sort((a, b) => b.params.volume! - a.params.volume!)[0];
    if (!heard) return 0;
    return heard.params.rate! * layerRevs(heard.cue);
  }
  /** An engine's layers' level together (equal power). */
  engineLevel(family = "light"): number {
    return Math.hypot(...this.layers().filter((l) => l.cue.includes(`_${family}_`)).map((l) => l.params.volume!));
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
  comet: boolean[] = [];
  intensity: number[] = [];
  setComet(on: boolean): void {
    this.comet.push(on);
  }
  setIntensity(level: number): void {
    this.intensity.push(level);
  }
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

describe("gears and the start", () => {
  it("climbs through each gear and falls back a little at the change, joining the plain curve at both ends", () => {
    expect(gearFactor(0)).toBe(1);
    expect(gearFactor(1)).toBe(1);
    for (const edge of [0.26, 0.42, 0.6]) {
      expect(gearFactor(edge - 0.0001)).toBeGreaterThan(1.035);
      expect(gearFactor(edge + 0.0001)).toBeLessThan(0.965);
    }
    // Continuous inside a gear: no step but the intended drop at the edges.
    for (let f = 0.121; f < 0.78; f += 0.002) {
      if ([0.26, 0.42, 0.6].some((e) => Math.abs(f - e) < 0.003)) continue;
      expect(Math.abs(gearFactor(f + 0.002) - gearFactor(f))).toBeLessThan(0.01);
    }
    for (let f = 0; f <= 1.2; f += 0.01) expect(Math.abs(gearFactor(f) - 1)).toBeLessThanOrEqual(0.0601);
  });

  it("revs the grid in the last second before Go and not after", () => {
    expect(gridFlare({ phase: "countdown", countdown: 3 })).toBe(0);
    expect(gridFlare({ phase: "countdown", countdown: 0.6 })).toBeGreaterThan(0.4);
    expect(gridFlare({ phase: "countdown", countdown: 0.2 })).toBeGreaterThan(0.9);
    expect(gridFlare({ phase: "racing", countdown: 0 })).toBe(0);
    const still = kart(0, { speed: 0 });
    const calm = engineTarget(still, 0, 0);
    const revved = engineTarget(still, 0, 1);
    expect(revved.revs).toBeGreaterThan(calm.revs * 1.5);
    expect(revved.engine).toBeGreaterThan(0.5);
    expect(calm.engine).toBe(0);
    // A kart already moving is not on the grid: the blip fades with speed.
    expect(engineTarget(kart(0, { speed: 10 }), 0, 1).revs).toBeCloseTo(engineTarget(kart(0, { speed: 10 }), 0, 0).revs, 5);
  });
});

describe("the countdown", () => {
  it("beeps low three times and high on go, centred", () => {
    const { bus, frame } = setup();
    for (const n of [3, 2, 1, 0] as const) frame([kart(0), kart(1)], { phase: "countdown", countdown: n }, [ev("countdown", { n })]);
    expect(bus.cues).toEqual(["kart_beep_low", "kart_beep_low", "kart_beep_low", "kart_beep_high", "kart_cheer"]);
    expect(bus.played.every((p) => p.options.pan === 0)).toBe(true);
    // 3, 2, 1 climb the A major triad: the same beep at A4, C#5 and E5.
    const rates = bus.played.slice(0, 3).map((p) => p.options.rate ?? 1);
    expect(rates[0]).toBeCloseTo(1, 3);
    expect(rates[1]).toBeCloseTo(Math.pow(2, 4 / 12), 2);
    expect(rates[2]).toBeCloseTo(Math.pow(2, 7 / 12), 2);
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
    ["triple nitro", ev("use", { kart: 0, item: "nitro3" }), ["kart_nitro_triple"]],
    ["a puck", ev("use", { kart: 0, item: "puck" }), ["kart_puck_fire"]],
    ["a seeker", ev("use", { kart: 0, item: "seeker" }), ["kart_seeker_launch"]],
    ["a slick", ev("use", { kart: 0, item: "slick" }), ["kart_slick_splat"]],
    ["hit by a puck", ev("hit", { kart: 0, by: 1, cause: "puck" }), ["kart_hit"]],
    ["hit by a seeker", ev("hit", { kart: 0, by: 1, cause: "seeker" }), ["kart_hit", "kart_seeker_lock"]],
    ["spinning on a slick", ev("hit", { kart: 0, by: null, cause: "slick" }), ["kart_spinout", "kart_slick_skid"]],
    ["a drift boost", ev("boost", { kart: 0, source: "drift", level: 1 }), ["kart_mini_turbo"]],
    ["a nitro boost", ev("boost", { kart: 0, source: "nitro", level: 1 }), ["kart_boost_whoosh"]],
    ["a pad", ev("boost", { kart: 0, source: "pad", level: 1 }), ["kart_boost_pad"]],
    ["a start boost", ev("boost", { kart: 0, source: "start", level: 1 }), ["kart_start_boost"]],
    ["blue sparks", ev("drift-level", { kart: 0, level: 1 }), ["kart_spark_blue"]],
    ["orange sparks", ev("drift-level", { kart: 0, level: 2 }), ["kart_spark_orange"]],
    ["the hottest sparks", ev("drift-level", { kart: 0, level: 3 }), ["kart_spark_orange"]],
    ["a slipstream's fling", ev("boost", { kart: 0, source: "draft", level: 1 }), ["kart_slingshot"]],
    ["the hottest drift let go", ev("boost", { kart: 0, source: "drift", level: 3 }), ["kart_mini_turbo", "kart_flame_long", "kart_super_turbo"]],
    ["a hard landing", ev("land", { kart: 0, boost: false, strength: 0.8 }), ["kart_land", "kart_thud", "kart_creak"]],
    ["a kick at the lip", ev("trick", { kart: 0, kick: true }), ["kart_trick", "kart_boost_whoosh"]],
    ["a bump", ev("bump", { a: 0, b: 1, strength: 0.5 }), ["kart_bump", "kart_creak"]],
    ["a soft bump", ev("bump", { a: 0, b: 1, strength: 0.2 }), ["kart_bump"]],
    ["a hard wall", ev("wall", { kart: 0, strength: 0.9 }), ["kart_wall_thud"]],
    // (The player's own scrape is a loop for as long as the contact lasts: see "scrapes along a barrier".)
    ["a scrape", ev("wall", { kart: 0, strength: 0.1 }), []],
    ["a lap", ev("lap", { kart: 0, lap: 2 }), ["kart_lap"]],
    ["the final lap", ev("final-lap", { kart: 0 }), ["kart_final_lap"]],
    ["a win", ev("finish", { kart: 0, place: 1, time: 90 }), ["kart_finish_win", "kart_cheer"]],
    ["a second place", ev("finish", { kart: 0, place: 2, time: 91 }), ["kart_finish_ok", "kart_cheer"]],
    ["a jump", ev("jump", { kart: 0 }), ["kart_jump"]],
    ["a trick", ev("trick", { kart: 0 }), ["kart_trick"]],
    ["a landing", ev("land", { kart: 0, boost: false }), ["kart_land"]],
    ["a boosted landing", ev("land", { kart: 0, boost: true }), ["kart_land", "kart_boost_whoosh", "kart_land_cheer"]],
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
    const rates = bus.played.filter((p) => p.cue === "kart_mini_turbo").map((p) => p.options.rate!).sort((a, b) => a - b);
    expect(rates[1]!).toBeGreaterThan(rates[0]!);
  });

  it("gives the third, hottest charge its own pitch: its sparks and its mini-turbo above the second's", () => {
    const rateOf = (events: RaceEvent[]) => {
      const { bus, frame } = setup();
      frame([kart(0), kart(1)], {}, events);
      return bus.played[0]!.options.rate!;
    };
    expect(rateOf([ev("drift-level", { kart: 0, level: 3 })])).toBeGreaterThan(rateOf([ev("drift-level", { kart: 0, level: 2 })]));
    expect(rateOf([ev("boost", { kart: 0, source: "drift", level: 3 })])).toBeGreaterThan(rateOf([ev("boost", { kart: 0, source: "drift", level: 2 })]));
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


describe("the ground, the air and the contact", () => {
  it("hears another kart's scrape as a scrape, and the player's own as a loop that lasts while the contact does", () => {
    const other = setup([{ kart: 0, pan: 0 }]);
    other.frame([kart(0), kart(1, { x: 4 })], {}, [ev("wall", { kart: 1, strength: 0.1 })]);
    expect(other.bus.cues).toEqual(["kart_wall_scrape"]);
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 20; i++) frame([kart(0, { speed: 16 })]);
    expect(bus.running("kart_scrape")).toBe(0);
    frame([kart(0, { speed: 16 })], {}, [ev("wall", { kart: 0, strength: 0.1 })]);
    expect(bus.running("kart_scrape")).toBe(1);
    expect(bus.cues).not.toContain("kart_wall_scrape");
    // It is still there a quarter of a second on (the sim reports a rub every so often), and gone half a second after it stops.
    for (let i = 0; i < 15; i++) frame([kart(0, { speed: 16 })]);
    expect(bus.running("kart_scrape")).toBe(1);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 16 })]);
    expect(bus.running("kart_scrape")).toBe(0);
  });

  it("scrapes for as long as the kart's state says it is against the barrier, with no event at all", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 120; i++) frame([kart(0, { speed: 16, rub: true })]);
    expect(bus.running("kart_scrape")).toBe(1);
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 16 })]);
    expect(bus.running("kart_scrape")).toBe(0);
  });

  it("scrapes louder the faster the kart rubs along", () => {
    const level = (speed: number): number => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      frame([kart(0, { speed })], {}, [ev("wall", { kart: 0, strength: 0.1 })]);
      for (let i = 0; i < 6; i++) frame([kart(0, { speed })]);
      return bus.lastSet("kart_scrape")!.volume!;
    };
    expect(level(20)).toBeGreaterThan(level(6) * 1.4);
  });

  it("tears the air in a slipstream, more as the draft charges, and not out of one", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 20 })]);
    expect(bus.running("kart_draft")).toBe(0);
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 20, draft: 0.3 })]);
    const low = bus.lastSet("kart_draft")!.volume!;
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 20, draft: 0.95 })]);
    const high = bus.lastSet("kart_draft")!.volume!;
    expect(bus.running("kart_draft")).toBe(1);
    expect(high).toBeGreaterThan(low * 1.2);
    for (let i = 0; i < 60; i++) frame([kart(0, { speed: 20 })]);
    expect(bus.running("kart_draft")).toBe(0);
  });

  it("barks on a gear change under power, not coasting, not for the robot, and not more than once for a change", () => {
    const climb = (character: string): number => {
      const { bus, audio, local } = setup([{ kart: 0, pan: 0 }]);
      const racers = [{ id: 0, name: "x", colour: "#fff", player: 0, character }];
      let speed = 2;
      for (let i = 0; i < 400; i++) {
        speed = Math.min(23, speed + 0.1);
        audio.frame(view([kart(0, { speed })], { racers }), local, 1 / 60);
      }
      return bus.cues.filter((c) => c === "kart_shift").length;
    };
    const shifts = climb("bramble");
    expect(shifts).toBeGreaterThanOrEqual(2);
    expect(shifts).toBeLessThanOrEqual(3);
    expect(climb("rivet")).toBe(0);
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    let speed = 23;
    for (let i = 0; i < 400; i++) frame([kart(0, { speed: (speed = Math.max(2, speed - 0.05)) })]);
    expect(bus.cues).not.toContain("kart_shift");
  });

  it("chirps the squeal up as a spark tier is reached, and lets it settle", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 1, steer: 0.5 })]);
    const steady = bus.lastSet("kart_drift")!.rate!;
    for (let i = 0; i < 5; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 2, steer: 0.5 })]);
    const rising = bus.lastSet("kart_drift")!.rate!;
    for (let i = 0; i < 90; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 2, steer: 0.5 })]);
    const settled = bus.lastSet("kart_drift")!.rate!;
    // A tier is a tone and a half (9 %); the chirp overshoots it and settles back.
    expect(rising).toBeGreaterThan(steady * 1.09);
    expect(rising).toBeGreaterThan(settled * 1.03);
    expect(settled).toBeGreaterThan(steady * 1.07);
  });

  it("pitches the squeal with the slip: higher at speed and with the wheel turned harder", () => {
    const rate = (speed: number, steer: number): number => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      for (let i = 0; i < 40; i++) frame([kart(0, { speed, drift: 1, steer })]);
      return bus.lastSet("kart_drift")!.rate!;
    };
    expect(rate(22, 0.5)).toBeGreaterThan(rate(10, 0.5) * 1.05);
    expect(rate(16, 1)).toBeGreaterThan(rate(16, 0.1) * 1.03);
  });

  it("hears a rival behind through the kart's own body: further, so duller, than the same rival ahead", () => {
    const distanceOf = (z: number): number => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      for (let i = 0; i < 20; i++) frame([kart(0, { x: 0, z: 0, speed: 19 }), kart(1, { x: 2, z, speed: 19 })]);
      return bus.layers().filter((l) => l.params.distance! > 0)[0]!.params.distance!;
    };
    const ahead = distanceOf(20);
    const behind = distanceOf(-20);
    expect(behind).toBeGreaterThan(ahead * 1.3);
  });

  it("lands a light driver's kart higher and snappier than a heavy one's", () => {
    const rate = (character: string): number => {
      const { bus, audio, local } = setup([{ kart: 0, pan: 0 }]);
      const racers = [{ id: 0, name: "x", colour: "#fff", player: 0, character }];
      audio.frame(view([kart(0, { speed: 20 })], { racers, events: [ev("land", { kart: 0, boost: false, strength: 0.6 })] }), local, 1 / 60);
      return bus.played.find((p) => p.cue === "kart_land")!.options.rate!;
    };
    expect(rate("pepper")).toBeGreaterThan(rate("bramble") * 1.2);
  });
});

describe("engines", () => {
  it("idles on the grid and drives off in four different engines for four players", () => {
    const { bus, frame } = setup([{ kart: 0, pan: -0.6 }, { kart: 1, pan: -0.2 }, { kart: 2, pan: 0.2 }, { kart: 3, pan: 0.6 }]);
    frame([kart(0), kart(1), kart(2), kart(3)], { phase: "countdown" });
    // The two-stroke, the thumper and the V-twin idle; the motor hums low on its own.
    expect(bus.loops.filter((l) => l.cue === "kart_idle" && !l.stopped)).toHaveLength(3);
    expect(bus.layers().map((l) => l.cue)).toEqual(["kart_engine_electric_lo"]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 8 }), kart(1, { speed: 8 }), kart(2, { speed: 8 }), kart(3, { speed: 8 })]);
    const layers = bus.layers();
    expect(new Set(layers.map((l) => familyOf(l.cue)))).toEqual(new Set(["light", "middle", "heavy", "electric"]));
    expect(new Set(layers.map((l) => l.params.pan)).size).toBe(4);
  });

  it("gives each driver's weight its engine: buzzy light, thumping middle, deep heavy, and the robot's motor", () => {
    const { bus, audio, local } = setup([{ kart: 0, pan: -0.6 }, { kart: 1, pan: -0.2 }, { kart: 2, pan: 0.2 }, { kart: 3, pan: 0.6 }]);
    const racers = (["bramble", "rivet", "pepper", "juniper"] as const).map((character, id) => ({ id, name: character, colour: "#fff", player: id, character }));
    for (let i = 0; i < 30; i++) audio.frame(view([kart(0, { speed: 8 }), kart(1, { speed: 8 }), kart(2, { speed: 8 }), kart(3, { speed: 8 })], { racers }), local, 1 / 60);
    const byPan = new Map(bus.layers().map((l) => [l.params.pan, familyOf(l.cue)]));
    expect([byPan.get(-0.6), byPan.get(-0.2), byPan.get(0.2), byPan.get(0.6)]).toEqual(["heavy", "electric", "light", "middle"]);
  });

  it("revs with speed, smoothly", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const revs: number[] = [];
    for (let s = 2; s <= 24; s += 2) {
      for (let i = 0; i < 30; i++) frame([kart(0, { speed: s })]);
      revs.push(bus.revs());
    }
    // The revs climb with speed, but fall back a little at a gear change (never by more than 12 %).
    for (let i = 1; i < revs.length; i++) expect(revs[i]!).toBeGreaterThan(revs[i - 1]! * 0.88);
    expect(revs.at(-1)!).toBeGreaterThan(revs[0]! * 2);
    expect(revs[0]!).toBeGreaterThan(0.6);
    expect(revs.at(-1)!).toBeGreaterThan(1.6);
    expect(revs.at(-1)!).toBeLessThan(2);
    // One frame never jumps far.
    const { bus: b2, frame: f2 } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) f2([kart(0, { speed: 6 })]);
    const before = b2.revs();
    f2([kart(0, { speed: 24 })]);
    expect(b2.revs()).toBeLessThan(before * 1.4);
  });

  it("crosses over from the low layer to the middle one and on to the high one as the revs climb, never more than two at once and always in tune", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 60; i++) frame([kart(0, { speed: 5 })]);
    expect(bus.layers().map((l) => l.cue)).toEqual(["kart_engine_light_lo"]);
    for (let i = 0; i < 120; i++) frame([kart(0, { speed: 24 })]);
    const top = bus.layers();
    expect(top.map((l) => l.cue)).toEqual(["kart_engine_light_hi"]);
    // Each layer plays near the revs it was made at (within a quarter).
    expect(top[0]!.params.rate!).toBeGreaterThan(0.85);
    expect(top[0]!.params.rate!).toBeLessThan(1.3);
    // Climbing through the speeds: the loudest layer goes lo, mid, hi; at most two sound at once, in tune with each other.
    const loudest: string[] = [];
    for (let speed = 3; speed <= 24; speed += 1) {
      for (let i = 0; i < 40; i++) frame([kart(0, { speed })]);
      const layers = bus.layers().filter((l) => l.params.volume! > 0.003);
      expect(layers.length).toBeGreaterThanOrEqual(1);
      expect(layers.length).toBeLessThanOrEqual(2);
      const heard = layers.map((l) => l.params.rate! * layerRevs(l.cue));
      expect(Math.max(...heard) - Math.min(...heard)).toBeLessThan(1e-3 * Math.max(...heard) + 0.02);
      loudest.push(layers.sort((a, b) => b.params.volume! - a.params.volume!)[0]!.cue.split("_").at(-1)!);
      // No layer is ever played further than about a third from the revs it was made at.
      for (const l of layers) expect(l.params.rate!).toBeGreaterThan(0.7);
      for (const l of layers) expect(l.params.rate!).toBeLessThan(1.4);
    }
    const order = loudest.filter((x, i) => i === 0 || x !== loudest[i - 1]);
    expect(order.slice(0, 3)).toEqual(["lo", "mid", "hi"]);
  });

  it("hands the idle to the engine as the kart moves off", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 40; i++) frame([kart(0, { speed: 0 })]);
    expect(bus.lastSet("kart_idle")!.volume!).toBeGreaterThan(0.3);
    expect(bus.engineLevel()).toBe(0);
    for (let i = 0; i < 120; i++) frame([kart(0, { speed: 15 })]);
    expect(bus.running("kart_idle")).toBe(0);
    expect(bus.engineLevel()).toBeGreaterThan(0.5);
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

  it("revs higher boosting than at the same speed without, and higher still in the air", () => {
    const a = setup([{ kart: 0, pan: 0 }]);
    const b = setup([{ kart: 0, pan: 0 }]);
    const c = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 60; i++) {
      a.frame([kart(0, { speed: 20 })]);
      b.frame([kart(0, { speed: 20, boost: 1 })]);
      c.frame([kart(0, { speed: 20, hop: 1.5 })]);
    }
    expect(b.bus.revs()).toBeGreaterThan(a.bus.revs() * 1.05);
    expect(c.bus.revs()).toBeGreaterThan(a.bus.revs() * 1.15);
  });

  it("hears the nearest other karts, the nearest loudest, and no more than four of them", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const karts = [kart(0, { x: 0, z: 0, speed: 20 })];
    for (let id = 1; id <= 7; id++) karts.push(kart(id, { x: 8 * id, z: 0, speed: 20 }));
    for (let i = 0; i < 30; i++) frame(karts);
    const others = bus.layers().filter((l) => l.params.distance! > 0);
    const distances = [...new Set(others.map((l) => Math.round(l.params.distance!)))].sort((x, y) => x - y);
    expect(distances).toEqual([8, 16, 24, 32]);
    const levelAt = (d: number): number => Math.hypot(...others.filter((l) => Math.round(l.params.distance!) === d).map((l) => l.params.volume!));
    for (let i = 1; i < distances.length; i++) expect(levelAt(distances[i]!)).toBeLessThan(levelAt(distances[i - 1]!));
    // The player's own is the loudest of all.
    const own = Math.hypot(...bus.layers().filter((l) => l.params.distance === 0).map((l) => l.params.volume!));
    expect(own).toBeGreaterThan(levelAt(8));
  });

  it("tells a passing kart's engine where it is every step of the way, not where it was first heard", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    // A kart comes up from 60 m behind on the left at 8 m/s more, passes, and draws away.
    const pans: number[] = [];
    for (let i = 0; i <= 600; i++) {
      const t = i / 60;
      frame([kart(0, { x: 0, z: 19 * t, speed: 19 }), kart(1, { x: 3.5, z: -60 + 27 * t, speed: 27 })]);
      const heard = bus.layers().filter((l) => l.params.distance! > 0);
      const truth = Math.hypot(3.5, -60 + 8 * t);
      // Heard through the kart's own body while it is behind (up to 40 % further), exactly where it is once it is alongside or ahead.
      const ahead = -60 + 8 * t >= 0.5;
      for (const l of heard) {
        if (ahead) expect(Math.abs(l.params.distance! - truth)).toBeLessThan(0.3);
        else {
          expect(l.params.distance!).toBeGreaterThan(truth - 0.3);
          expect(l.params.distance!).toBeLessThan(1.4 * truth + 0.3);
        }
      }
      pans.push(heard[0]!.params.pan!);
    }
    // From the left (+x is the kart's left), most so alongside.
    expect(Math.min(...pans)).toBeLessThan(-0.35);
  });

  it("bends another kart's engine up as it closes in and down as it draws away", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const revsAt = (z: number): number => {
      for (let i = 0; i < 20; i++) frame([kart(0, { x: 0, z: 0, speed: 19 }), kart(1, { x: 3, z, speed: 27 })]);
      const heard = bus
        .layers()
        .filter((l) => l.params.distance! > 0)
        .sort((a, b) => b.params.volume! - a.params.volume!)[0]!;
      return heard.params.rate! * layerRevs(heard.cue);
    };
    const coming = revsAt(-25);
    const going = revsAt(25);
    expect(coming / going).toBeGreaterThan(1.1);
    expect(coming / going).toBeLessThan(1.25);
  });

  it("swishes when a kart goes by close and fast, from its side, and not when it creeps by or passes far off", () => {
    const pass = (x: number, faster: number): { pan: number }[] => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      for (let i = 0; i <= 600; i++) {
        const t = i / 60;
        frame([kart(0, { x: 0, z: 19 * t, speed: 19 }), kart(1, { x, z: -30 + (19 + faster) * t, speed: 19 + faster })]);
      }
      return bus.played.filter((p) => p.cue === "kart_pass").map((p) => ({ pan: p.options.pan! }));
    };
    const close = pass(3.5, 8);
    expect(close).toHaveLength(1);
    // +x is the kart's left.
    expect(close[0]!.pan).toBeLessThan(-0.2);
    expect(pass(-3.5, 8)[0]!.pan).toBeGreaterThan(0.2);
    expect(pass(3.5, 1.5)).toHaveLength(0);
    expect(pass(12, 8)).toHaveLength(0);
  });

  it("silences an engine carried off by the drone", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 10 })]);
    for (let i = 0; i < 90; i++) frame([kart(0, { speed: 0, rescue: 2 })]);
    expect(bus.engineLevel()).toBeLessThan(0.01);
    expect(bus.running("kart_idle")).toBe(0);
  });

  it("makes four local engines no louder together than the mix can bear", () => {
    const four = setup([{ kart: 0, pan: -0.6 }, { kart: 1, pan: -0.2 }, { kart: 2, pan: 0.2 }, { kart: 3, pan: 0.6 }]);
    const one = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 40; i++) {
      four.frame([kart(0, { speed: 20 }), kart(1, { speed: 20, x: 3 }), kart(2, { speed: 20, x: 6 }), kart(3, { speed: 20, x: 9 })]);
      one.frame([kart(0, { speed: 20 })]);
    }
    const power = (r: Recorder): number => Math.hypot(...r.layers().map((l) => l.params.volume!));
    expect(power(four.bus)).toBeLessThan(power(one.bus) * 1.5);
    expect(power(four.bus)).toBeGreaterThan(power(one.bus) * 0.7);
  });

  it("works the engine: pulling away and climbing it sings higher, louder and rougher; lifting off, softer", () => {
    const run = (speedAt: (i: number) => number, rise = 0) => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      let z = 0;
      for (let i = 0; i < 40; i++) {
        const speed = speedAt(i);
        z += speed / 60;
        frame([kart(0, { speed, z, y: rise * z })]);
      }
      return { revs: bus.revs(), level: bus.engineLevel(), grit: bus.lastSet("kart_engine_grit")?.volume ?? 0 };
    };
    const steady = run(() => 14);
    const pulling = run((i) => 9 + i * 0.13);
    const lifting = run((i) => 19 - i * 0.13);
    const climbing = run(() => 14, 0.15);
    expect(pulling.revs).toBeGreaterThan(steady.revs * 1.02);
    expect(pulling.level).toBeGreaterThan(steady.level);
    expect(pulling.grit).toBeGreaterThan(steady.grit * 1.5);
    expect(climbing.grit).toBeGreaterThan(steady.grit * 1.2);
    expect(lifting.level).toBeLessThan(steady.level);
    expect(lifting.grit).toBeLessThan(steady.grit);
  });

  it("pops the exhaust when lifting off after pulling hard, and not again for a while", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    let speed = 8;
    for (let i = 0; i < 90; i++) frame([kart(0, { speed: (speed = Math.min(24, speed + 0.25)) })]);
    expect(bus.cues).not.toContain("kart_backfire");
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: (speed -= 0.12) })]);
    expect(bus.cues.filter((c) => c === "kart_backfire")).toHaveLength(1);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: (speed += 0.25) })]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: (speed -= 0.12) })]);
    expect(bus.cues.filter((c) => c === "kart_backfire")).toHaveLength(1);
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
  ] as const)("plays %s under the wheels, and the tyres' roll back on the road", (surface, cue) => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 15, surface, offroad: surface !== "ice" })]);
    expect(bus.running(cue)).toBe(1);
    expect(bus.running("kart_tyre_road")).toBe(0);
    frame([kart(0, { speed: 15, surface: "road" })]);
    expect(bus.running(cue)).toBe(0);
    expect(bus.running("kart_tyre_road")).toBe(1);
  });

  it("rolls the tyres louder with speed on the road, and not at all in the air", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 8 })]);
    const slow = bus.lastSet("kart_tyre_road")!.volume!;
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 22 })]);
    expect(bus.lastSet("kart_tyre_road")!.volume!).toBeGreaterThan(slow * 1.5);
    frame([kart(0, { speed: 22, hop: 1 })]);
    expect(bus.running("kart_tyre_road")).toBe(0);
  });

  it("fizzes the sparks under the player's drift: none before the first spark, then hotter and higher at each level", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 20; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: 0 })]);
    expect(bus.running("kart_drift_sparks")).toBe(0);
    const heard: LoopParams[] = [];
    for (const level of [1, 2, 3] as const) {
      for (let i = 0; i < 40; i++) frame([kart(0, { speed: 20, drift: 1, driftLevel: level })]);
      heard.push(bus.lastSet("kart_drift_sparks")!);
    }
    for (let i = 1; i < 3; i++) {
      expect(heard[i]!.rate!).toBeGreaterThan(heard[i - 1]!.rate!);
      expect(heard[i]!.volume!).toBeGreaterThan(heard[i - 1]!.volume!);
    }
    for (let i = 0; i < 60; i++) frame([kart(0, { speed: 24, boost: 1 })]);
    expect(bus.running("kart_drift_sparks")).toBe(0);
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

  it("keeps eight karts firing at once to a bounded number of sounds", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    const karts = Array.from({ length: 8 }, (_, i) => kart(i, { x: i * 3, z: 0 }));
    const items = ["nitro", "puck", "seeker", "slick", "comet", "skyrocket", "puck3", "nitro3"] as const;
    frame(karts, {}, [...karts.map((k, i) => ev("use", { kart: k.id, item: items[i]! })), ...karts.map((k) => ev("hit", { kart: k.id, by: null, cause: "slick" })), ...karts.map((k) => ev("pickup", { kart: k.id, item: "puck" }))]);
    // Eight a frame from the others, plus what the player's own kart must hear (the cap spares priority 3).
    expect(bus.played.length).toBeLessThanOrEqual(8 + 6);
    // No cue sounds more than twice at the same instant but the player's own.
    const count = new Map<string, number>();
    for (const p of bus.played) count.set(p.cue, (count.get(p.cue) ?? 0) + 1);
    for (const [cue, n] of count) expect(n, cue).toBeLessThanOrEqual(3);
  });

  it("hums while a player's kart holds the triple puck, higher for each puck fired, and stops when none is left", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 5; i++) frame([kart(0, { item: "puck3", itemUses: 3 })]);
    expect(bus.running("kart_orbit")).toBe(1);
    const full = bus.lastSet("kart_orbit")!;
    for (let i = 0; i < 30; i++) frame([kart(0, { item: "puck3", itemUses: 1 })]);
    expect(bus.lastSet("kart_orbit")!.rate!).toBeGreaterThan(full.rate!);
    // Not while the reel still turns, and not for a kart that is another's to hear.
    frame([kart(0, { item: null, itemUses: 0 })]);
    expect(bus.running("kart_orbit")).toBe(0);
  });

  it("sounds a cheer or a wave once, as the emote begins", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0)]);
    for (let i = 0; i < 20; i++) frame([kart(0, { emote: "cheer" })]);
    expect(bus.cues.filter((c) => c === "kart_emote_cheer")).toHaveLength(1);
    frame([kart(0, { emote: null })]);
    frame([kart(0, { emote: "wave" })]);
    expect(bus.cues.filter((c) => c === "kart_emote_wave")).toHaveLength(1);
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
    expect(bus.cues).toContain("kart_get_puck");
  });

  it("quickens a seeker's beeps as it closes in", () => {
    const rateAt = (z: number): number => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      const thing: ThingView = { id: 77, kind: "seeker", x: 0, y: 0, z, heading: 0, active: true };
      for (let i = 0; i < 5; i++) frame([kart(0, { z: 0 })], {}, [], [thing], 0.1);
      return bus.lastSet("kart_seeker")!.rate!;
    };
    expect(rateAt(10)).toBeGreaterThan(rateAt(35) + 0.1);
    expect(rateAt(35)).toBeGreaterThan(rateAt(80));
  });

  it("makes no emote sound for a kart that has finished (the sim's own cheer)", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0)]);
    for (let i = 0; i < 5; i++) frame([kart(0, { emote: "cheer", finished: 40 })]);
    expect(bus.cues).not.toContain("kart_emote_cheer");
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

  it("opens the results with the win's or the loss's jingle, then their own music", async () => {
    const { player, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    audio.music("results-win");
    await settle();
    expect(player.calls).toEqual(["play meadow", "play jingle-win"]);
    await new Promise((r) => setTimeout(r, 700));
    expect(player.calls).toEqual(["play meadow", "play jingle-win", "play results-win"]);
    frame([kart(0), kart(1)], { phase: "countdown" });
    frame([kart(0), kart(1)], { phase: "racing" });
    await settle();
    audio.music("results");
    await settle();
    expect(player.calls.slice(-2)).toEqual(["play meadow", "play jingle-lose"]);
  });

  it("lets the comet layer and the race intensity go when the race is over", async () => {
    const { player, audio, frame } = setup();
    await audio.load("meadow");
    frame([kart(0, { lap: 3, comet: 5 }), kart(1)], { phase: "racing" });
    expect(player.comet.at(-1)).toBe(true);
    expect(player.intensity.at(-1)).toBe(1);
    frame([kart(0, { lap: 3 }), kart(1)], { phase: "results" as never });
    expect(player.comet.at(-1)).toBe(false);
    expect(player.intensity.at(-1)).toBe(0);
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
    expect(bus.layers().length).toBeGreaterThan(0);
    expect(bus.running("kart_amb_breeze")).toBe(2);
    audio.pause();
    expect(bus.loops.every((l) => l.stopped)).toBe(true);
    expect(player.paused).toBe(true);
    frame([kart(0, { speed: 10 })], {}, [ev("jump", { kart: 0 })]);
    expect(bus.cues).not.toContain("kart_jump");
    audio.resume();
    expect(player.paused).toBe(false);
    frame([kart(0, { speed: 10 })]);
    expect(bus.layers().length).toBeGreaterThan(0);
  });

  it("lets go of the loops when muted", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 10; i++) frame([kart(0, { speed: 10 })]);
    bus.muted = true;
    frame([kart(0, { speed: 10 })]);
    expect(bus.loops.every((l) => l.stopped)).toBe(true);
    bus.muted = false;
    frame([kart(0, { speed: 10 })]);
    expect(bus.layers().length).toBeGreaterThan(0);
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

describe("the place", () => {
  it("plays the track's beds quietly, two of each apart in the stereo field, and something far off now and then", () => {
    const { bus, audio, local } = setup([{ kart: 0, pan: 0 }]);
    const harbour = { ...TRACK, theme: "harbour" } as TrackDef;
    for (let i = 0; i < 60 * 30; i++) audio.frame(view([kart(0, { speed: 15 })], { track: harbour }), local, 1 / 60);
    const water = bus.loops.filter((l) => l.cue === "kart_amb_water" && !l.stopped);
    expect(water).toHaveLength(2);
    expect(water.map((l) => l.options.pan).sort()).toEqual([-0.75, 0.75]);
    expect(bus.running("kart_amb_breeze")).toBe(2);
    const gulls = bus.played.filter((p) => p.cue === "kart_amb_gull");
    // Every four to nine seconds, far off: in half a minute three to seven.
    expect(gulls.length).toBeGreaterThanOrEqual(3);
    expect(gulls.length).toBeLessThanOrEqual(7);
    for (const g of gulls) expect(g.options.distance!).toBeGreaterThanOrEqual(20);
  });

  it("changes place with the track", () => {
    const { bus, audio, local } = setup([{ kart: 0, pan: 0 }]);
    audio.frame(view([kart(0)], { track: { ...TRACK, theme: "volcano" } as TrackDef }), local, 1 / 60);
    expect(bus.running("kart_amb_rumble")).toBe(2);
    audio.frame(view([kart(0)], { track: { ...TRACK, theme: "kitchen" } as TrackDef }), local, 1 / 60);
    expect(bus.running("kart_amb_rumble")).toBe(0);
    expect(bus.running("kart_amb_hum")).toBe(2);
  });
});

describe("the music under the big moments", () => {
  it("does not let a lighter duck cut a deeper one short", () => {
    const { player, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0)], {}, [ev("finish", { kart: 0, place: 1, time: 1 })]);
    frame([kart(0)], {}, [ev("boost", { kart: 0, source: "nitro", level: 1 })]);
    expect(player.ducks).toHaveLength(1);
    for (let i = 0; i < 60 * 4; i++) frame([kart(0)]);
    frame([kart(0)], {}, [ev("boost", { kart: 0, source: "nitro", level: 1 })]);
    expect(player.ducks).toHaveLength(2);
    expect(player.ducks[1]![0]).toBeGreaterThan(player.ducks[0]![0]);
  });
});

describe("the player's own kart, livelier", () => {
  it("blows the wind at top speed and loudest in the air, and none at a cruise", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 12 })]);
    expect(bus.running("kart_wind")).toBe(0);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 26 })]);
    expect(bus.running("kart_wind")).toBe(1);
    const fast = bus.lastSet("kart_wind")!.volume!;
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 26, hop: 2.5 })]);
    expect(bus.lastSet("kart_wind")!.volume!).toBeGreaterThan(fast * 1.5);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 8 })]);
    expect(bus.running("kart_wind")).toBe(0);
  });

  it("thuds under a hard landing, deeper and louder the harder it came down, and not under a soft one", () => {
    const land = (strength: number | undefined) => {
      const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
      frame([kart(0, { speed: 20 })], {}, [ev("land", { kart: 0, boost: false, ...(strength === undefined ? {} : { strength }) })]);
      expect(bus.cues).toContain("kart_land");
      return bus.played.filter((p) => p.cue === "kart_thud");
    };
    expect(land(undefined)).toHaveLength(0);
    expect(land(0.1)).toHaveLength(0);
    const firm = land(0.4);
    const hard = land(1);
    expect(firm).toHaveLength(1);
    expect(hard).toHaveLength(1);
    expect(hard[0]!.options.volume!).toBeGreaterThan(firm[0]!.options.volume!);
    expect(hard[0]!.options.rate!).toBeLessThan(firm[0]!.options.rate!);
  });

  it("blows harder in another kart's slipstream as it charges", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 22 })]);
    const plain = bus.lastSet("kart_wind")?.volume ?? 0;
    for (let i = 0; i < 30; i++) frame([kart(0, { speed: 22, draft: 0.9 })]);
    expect(bus.lastSet("kart_wind")!.volume!).toBeGreaterThan(plain + 0.1);
  });

  it("plays two notes up for a place won and down for a place lost, not too often and not off the grid", () => {
    const { bus, frame } = setup([{ kart: 0, pan: 0 }]);
    frame([kart(0, { place: 4 })], { time: 0.5 });
    frame([kart(0, { place: 3 })], { time: 0.6 });
    expect(bus.cues).not.toContain("kart_place_up");
    frame([kart(0, { place: 3 })], { time: 5 });
    frame([kart(0, { place: 2 })], { time: 5.1 });
    expect(bus.cues.filter((c) => c === "kart_place_up")).toHaveLength(1);
    // Swapping straight back with the kart alongside: no second note so soon.
    frame([kart(0, { place: 3 })], { time: 5.12 });
    expect(bus.cues).not.toContain("kart_place_down");
    for (let i = 0; i < 60; i++) frame([kart(0, { place: 3 })], { time: 5.2 + i / 60 });
    frame([kart(0, { place: 4 })], { time: 6.5 });
    expect(bus.cues.filter((c) => c === "kart_place_down")).toHaveLength(1);
  });
});
