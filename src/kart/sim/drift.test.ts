/**
 * Drifting as on a real Mario Kart, for every control: the keys' hop with the direction taken from the wheel on landing
 * or later, the wheel's open hands as the one drift button (starting at a light turn, holding the bend through counter-steer,
 * a misread frame or two and a wobble, ending only when the hands close or the speed goes), the tiers, and the brake that
 * stays a brake on a straight and backs up at a standstill.
 */
import { describe, expect, it } from "vitest";
import type { DriveInput } from "../contract";
import recording from "../input/fixtures/moves.json";
import { play, SEGMENTS, type Recording } from "../input/replay";
import { WheelReader } from "../input/wheel";
import { ARENA, count, input, patch, race, racers, run, toGo, view } from "./testing";
import { TUNING } from "./tuning";

const WH = TUNING.drift.wheel;
const LAPSE = Math.round(WH.lapse * 60);

/** On the open arena at speed, the road ahead a wide curve. */
function arena(): ReturnType<typeof race> {
  const r = race(ARENA, racers(1, 0));
  toGo(r);
  run(r, 180, () => input({ throttle: 1 }));
  return r;
}

/** The keys: throttle down, the wheel as given, the drift button as given. */
const key = (steer: number, drift: boolean, brake = 0): DriveInput => input({ throttle: brake > 0 ? 0 : 1, steer, drift, brake });
/** The wheel's open hands (brake with slide), and fists. */
const open = (steer: number): DriveInput => input({ brake: 1, slide: true, steer });
const fists = (steer: number): DriveInput => input({ throttle: 1, steer, slide: false });

/** How far round the way the kart goes turns to the right (radians, summed tick by tick) over `ticks` ticks of `script`. */
function turned(r: ReturnType<typeof race>, ticks: number, script: () => DriveInput): number {
  const course = (): number => view(r).course ?? view(r).heading;
  let last = course();
  let total = 0;
  for (let i = 0; i < ticks; i++) {
    run(r, 1, script);
    const now = course();
    total += ((last - now + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    last = now;
  }
  return total;
}

describe("the keys and the pad: Mario Kart's model", () => {
  it("hops on the press with the wheel straight, and is no drift yet: the direction is not chosen", () => {
    const r = arena();
    run(r, 10, () => key(0, true));
    expect(view(r).hop).toBeGreaterThan(0);
    expect(view(r).drift).toBe(0);
  });

  it("takes the direction from the wheel in the hop, whenever it is turned, and from a wheel turned only a little", () => {
    for (const [wait, wheel, way] of [[0, 1, 1], [8, -0.6, -1], [12, 0.2, 1], [3, -0.17, -1]] as const) {
      const r = arena();
      run(r, 1 + wait, () => key(0, true));
      expect(view(r).drift, `before the turn (${wheel})`).toBe(0);
      run(r, 2, () => key(wheel, true));
      expect(view(r).drift, `wheel ${wheel} after ${wait}`).toBe(way);
    }
  });

  it("takes it after the landing too: the button held on from a straight, and a turn into the bend", () => {
    const r = arena();
    run(r, 30, () => key(0, true));
    expect(view(r).hop).toBe(0);
    expect(view(r).drift).toBe(0);
    run(r, 3, () => key(0.5, true));
    expect(view(r).drift).toBe(1);
    // Swung out and held: no second hop, and the charge starts there.
    expect(view(r).hop).toBe(0);
    run(r, 80, () => key(0.5, true));
    expect(view(r).driftLevel).toBe(1);
  });

  it("turns the drift round if the wheel is thrown the other way in the hop (the direction on landing), and not after", () => {
    const r = arena();
    run(r, 2, () => key(1, true));
    expect(view(r).drift).toBe(1);
    run(r, 2, () => key(-1, true));
    expect(view(r).drift).toBe(-1);
    expect(view(r).hop).toBeGreaterThan(0);
    run(r, 20, () => key(-1, true));
    expect(view(r).hop).toBe(0);
    run(r, 40, () => key(1, true));
    expect(view(r).drift).toBe(-1);
  });

  it("is only a hop without the speed for it, and without the button", () => {
    const r = arena();
    run(r, 60, () => key(1, false));
    expect(view(r).drift).toBe(0);
    expect(view(r).hop).toBe(0);
  });

  it("keeps the drift for the whole bend with the wheel anywhere: in, straight, out", () => {
    const r = arena();
    run(r, 20, () => key(1, true));
    for (const wheel of [1, 0, -1, 0.3, -0.4]) {
      const by = turned(r, 30, () => key(wheel, true));
      expect(view(r).drift, `wheel ${wheel}`).toBe(1);
      // Coming round to the right all the while, tighter or wider.
      expect(by, `wheel ${wheel}`).toBeGreaterThan(0.3);
    }
  });

  it("charges blue, orange and the hottest by time, and the release gives the boost of that tier, the keys or the pad alike", () => {
    const r = arena();
    run(r, 80, () => key(0.8, true));
    expect(view(r).driftLevel).toBe(1);
    run(r, 60, () => key(0.8, true));
    expect(view(r).driftLevel).toBe(2);
    const out = run(r, 1, () => key(0.8, false));
    const boost = out.find((e) => e.type === "boost");
    expect(boost).toMatchObject({ source: "drift", level: 2 });
    expect(view(r).boost).toBeGreaterThan(1.2);
    expect(view(r).drift).toBe(0);
  });

  it("turns tighter with the wheel into the drift than out of it (a tighter turn charges faster), and neither ends it", () => {
    const into = arena();
    const out = arena();
    run(into, 16, () => key(1, true));
    run(out, 16, () => key(1, true));
    run(into, 104, () => key(1, true));
    run(out, 104, () => key(-1, true));
    expect(view(into).drift).toBe(1);
    expect(view(out).drift).toBe(1);
    expect(view(into).driftLevel).toBeGreaterThan(view(out).driftLevel);
  });
});

describe("the wheel's open hands", () => {
  it("are a drift as soon as the wheel is turned a little, at speed, and keep the speed", () => {
    const r = arena();
    const before = view(r).speed;
    run(r, 6, () => open(0.25));
    expect(view(r).drift).toBe(1);
    run(r, 60, () => open(0.25));
    expect(view(r).drift).toBe(1);
    expect(view(r).speed).toBeGreaterThan(before * 0.9);
    const left = arena();
    run(left, 6, () => open(-0.25));
    expect(view(left).drift).toBe(-1);
  });

  it("stay a brake on a straight and under the line, and the kart slows hard", () => {
    for (const steer of [0, 0.05, 0.12, 0.19]) {
      const r = arena();
      const before = view(r).speed;
      run(r, 40, () => open(steer));
      expect(view(r).drift, `steer ${steer}`).toBe(0);
      expect(view(r).speed, `steer ${steer}`).toBeLessThan(before - 6);
    }
  });

  it("are no drift for a turn of a tick or two (a wobble of resting hands), and a brake still", () => {
    const r = arena();
    run(r, 4, () => open(0));
    run(r, 2, () => open(0.5));
    run(r, 4, () => open(0));
    run(r, 2, () => open(-0.5));
    run(r, 20, () => open(0));
    expect(view(r).drift).toBe(0);
  });

  it("opened on a straight and turned in later, become a drift in the bend, with the speed still there", () => {
    const r = arena();
    run(r, 15, () => open(0));
    const slowed = view(r).speed;
    expect(view(r).drift).toBe(0);
    run(r, 8, () => open(0.4));
    expect(view(r).drift).toBe(1);
    // The brake is let go the moment the drift starts: the speed holds, it does not go on falling.
    run(r, 60, () => open(0.4));
    expect(view(r).speed).toBeGreaterThan(slowed - 1);
  });

  it("hold the direction for the whole bend: counter-steer, a wobble of the wheel about zero, a straight wheel", () => {
    const r = arena();
    run(r, 6, () => open(0.7));
    expect(view(r).drift).toBe(1);
    const against = turned(r, 40, () => open(-0.9));
    expect(view(r).drift).toBe(1);
    const wobble = turned(r, 60, () => open(r.tick % 4 < 2 ? 0.08 : -0.08));
    expect(view(r).drift).toBe(1);
    const straight = turned(r, 40, () => open(0));
    expect(view(r).drift).toBe(1);
    // All the while coming round the way it started.
    for (const by of [against, wobble, straight]) expect(by).toBeGreaterThan(0.3);
    expect(view(r).speed).toBeGreaterThan(18);
  });

  it("steering in tightens the bend and steering out widens it, and the charge goes faster the tighter", () => {
    const turn = (wheel: number) => {
      const r = arena();
      run(r, 10, () => open(0.7));
      const by = turned(r, 40, () => open(wheel));
      return { by, charge: view(r).driftLevel };
    };
    const tight = turn(1);
    const loose = turn(-0.6);
    expect(tight.by).toBeGreaterThan(loose.by + 0.3);
    expect(loose.by).toBeGreaterThan(0.2);
  });

  it("ride out a misread of a frame or two (the hands taken for fists for 4 ticks, or a hand lost from the picture)", () => {
    const r = arena();
    run(r, 50, () => open(0.7));
    run(r, 4, () => fists(0.7));
    expect(view(r).drift).toBe(1);
    run(r, 30, () => open(0.7));
    expect(view(r).drift).toBe(1);
    // The same with the brake and throttle of a lost hand.
    run(r, 5, () => input({ steer: 0.7 }));
    expect(view(r).drift).toBe(1);
    // The charge was not lost in it.
    expect(view(r).driftLevel).toBe(1);
  });

  it("end when the hands stay closed longer than the grace, with the boost of the charge", () => {
    const r = arena();
    run(r, 85, () => open(0.7));
    expect(view(r).driftLevel).toBe(1);
    const events = run(r, LAPSE + 2, () => fists(0.7));
    expect(view(r).drift).toBe(0);
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 1 });
    expect(view(r).boost).toBeGreaterThan(0.5);
  });

  it("give the tiers by charge: nothing for a drift let go quickly, blue, orange, the hottest", () => {
    const boostOf = (ticks: number): number => {
      const r = arena();
      run(r, ticks, () => open(0.7));
      const events = run(r, LAPSE + 2, () => fists(0.7));
      const boost = events.find((e) => e.type === "boost");
      return boost && boost.type === "boost" ? boost.level : 0;
    };
    expect(boostOf(20)).toBe(0);
    expect(boostOf(80)).toBe(1);
    expect(boostOf(140)).toBe(2);
    expect(boostOf(240)).toBe(3);
  });

  it("end for the speed really going, with nothing", () => {
    const r = arena();
    run(r, 100, () => open(0.7));
    expect(view(r).drift).toBe(1);
    patch(r, 0, { vx: 0, vz: 0 });
    const events = run(r, 3, () => open(0.7));
    expect(view(r).drift).toBe(0);
    expect(count(events, "boost")).toBe(0);
  });

  it("start when the hands open as the wheel turns in: the steer still small at the first read, then rising", () => {
    const r = arena();
    const before = view(r).speed;
    for (let i = 0; i < 12; i++) run(r, 1, () => open(Math.min(0.5, i * 0.05)));
    expect(view(r).drift).toBe(1);
    // Hardly a tick of the brake was felt on the way in.
    expect(view(r).speed).toBeGreaterThan(before - 3);
  });

  it("brake and back up at a standstill, however the wheel is turned", () => {
    const r = arena();
    run(r, 120, () => open(0));
    run(r, 60, () => open(1));
    expect(view(r).drift).toBe(0);
    expect(view(r).speed).toBeLessThan(-1);
  });

  it("are the hop's own: the drift begins with a hop, and a late one with none", () => {
    const r = arena();
    run(r, 4, () => open(0.7));
    expect(view(r).hop).toBeGreaterThan(0);
  });
});

describe("the drift in a snapshot", () => {
  it("is carried whole to a guest: the drift, its charge, whose hands began it, the grace under way", () => {
    const r = arena();
    run(r, 100, () => open(0.7));
    run(r, 3, () => fists(0.7));
    const was = view(r);
    expect(was.drift).toBe(1);
    const copy = race(ARENA, racers(1, 0));
    copy.restore(r.snapshot());
    expect(view(copy).drift).toBe(1);
    expect(view(copy).driftLevel).toBe(was.driftLevel);
    // Both go on the same way: the hands stay closed, the grace runs out on the same tick and the same boost comes.
    const a = run(r, LAPSE + 6, () => fists(0.7));
    const b = run(copy, LAPSE + 6, () => fists(0.7));
    expect(count(a, "boost")).toBe(1);
    expect(a.map((e) => [e.type, e.tick])).toEqual(b.map((e) => [e.type, e.tick]));
    expect(view(copy).drift).toBe(view(r).drift);
  });
});

describe("the wheel's open hands as a real pair of hands gives them (fixtures/moves.json)", () => {
  const moves = recording as unknown as Recording;
  const ticks = play(() => new WheelReader(), moves);

  /** The sim driven by the recording's hands (their open and closed, throttle and brake), the wheel turned a steady 0.6. */
  function drive(from: number, to: number): { drift: number; open: boolean }[] {
    const r = arena();
    const out: { drift: number; open: boolean }[] = [];
    for (const tick of ticks.filter((t) => t.t >= from && t.t <= to)) {
      run(r, 1, () => input({ steer: 0.6, throttle: tick.throttle, brake: tick.brake, slide: tick.slide }));
      out.push({ drift: view(r).drift, open: tick.slide });
    }
    return out;
  }

  it("never drift while the hands are fists", () => {
    for (const id of ["fists-1", "fists-2", "fists-3", "fists-5"]) {
      const seg = SEGMENTS.find((s) => s.id === id)!;
      const states = drive(seg.t0, seg.t1);
      expect(states.filter((s) => s.drift !== 0), id).toHaveLength(0);
    }
  });

  it("drift once the hands are open, hold it for as long as they are, and let go within the grace of their closing", () => {
    const seg = SEGMENTS.find((s) => s.id === "brake-1")!;
    const states = drive(seg.t0 - 0.5, seg.t1 + 0.5);
    const first = states.findIndex((s) => s.drift !== 0);
    expect(first).toBeGreaterThan(-1);
    const lastOpen = states.map((s) => s.open).lastIndexOf(true);
    // From the first tick of the drift to the hands' closing there is no gap in it.
    for (let i = first; i <= lastOpen; i++) expect(states[i]!.drift, `tick ${i}`).not.toBe(0);
    // And it is over within the grace after the last open tick (the hands may go on closing by the reader's own delay).
    const end = states.findIndex((s, i) => i > lastOpen && s.drift === 0);
    expect(end).toBeGreaterThan(-1);
    expect(end - lastOpen).toBeLessThanOrEqual(LAPSE + 2);
    // Opening to drifting is quick: the hands read open (brakeAfter) and a few ticks more for the turn to be a turn.
    expect((first - states.findIndex((s) => s.open)) / 60).toBeLessThan(0.2);
  });

  it("do not drift for the recording's half-open and loose hands, which the wheel does not read as a brake", () => {
    for (const id of ["brake-2a", "brake-2b"]) {
      const seg = SEGMENTS.find((s) => s.id === id)!;
      expect(drive(seg.t0, seg.t1).filter((s) => s.drift !== 0), id).toHaveLength(0);
    }
  });
});
