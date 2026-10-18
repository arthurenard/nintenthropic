import { describe, expect, it } from "vitest";
import { TICK_HZ, type DriveInput, type RaceEvent } from "../contract";
import { decodeInput, encodeInput, quantiseInput } from "../net/protocol";
import { MEADOW_LOOP, TRACKS } from "../track/tracks";
import { EGGS, duckSpot, unit } from "./eggs";
import { GO_TICK } from "./kart";
import { planFor } from "./plan";
import { ARENA, input, patch, race, racers, run, toGo, view } from "./testing";

/** Honks and emotes for kart 0, from a script of (horn count, emote) by tick. */
const hands = (horn: (tick: number) => number, emote: (tick: number) => DriveInput["emote"] = () => null) => (tick: number) =>
  input({ throttle: 1, horn: horn(tick), emote: emote(tick) });

const hornsOf = (events: RaceEvent[], kart = 0) => events.filter((e) => e.type === "horn" && e.kart === kart);

describe("the horn", () => {
  it("makes a horn event each time the count goes up, but not more than twice a second", () => {
    const r = race(ARENA, racers(1, 0));
    toGo(r);
    // One honk, then a burst of three in a quarter of a second, then another a second later.
    const events = run(r, 3 * TICK_HZ, hands((tick) => (tick < GO_TICK + 30 ? 0 : tick < GO_TICK + 45 ? 1 : tick < GO_TICK + 60 ? 4 : tick < GO_TICK + 120 ? 4 : 5)));
    const horns = hornsOf(events);
    expect(horns.map((e) => e.tick - GO_TICK)).toEqual([30, 120]);
  });

  it("does not honk for a count it was already at, on a hiccup, or for a control that honked in an earlier race", () => {
    const r = race(ARENA, racers(1, 0));
    // The control stands at 6 from the first tick, as one does that has honked before.
    const events = run(r, 2 * TICK_HZ, hands(() => 6));
    expect(hornsOf(events)).toEqual([]);
    // It goes quiet for a moment (a dropped packet reads as zero) and comes back to 6: nothing.
    const again = run(r, 2 * TICK_HZ, hands((tick) => (tick % 40 < 5 ? 0 : 6)));
    expect(hornsOf(again)).toEqual([]);
    // A leap of many at once is a control catching up.
    expect(hornsOf(run(r, 60, hands(() => 40)))).toEqual([]);
    // An honest honk after all that still sounds.
    expect(hornsOf(run(r, 60, hands(() => 41)))).toHaveLength(1);
  });

  it("is heard by the sim's events, once, in the view and to take", () => {
    const r = race(ARENA, racers(1, 0));
    toGo(r);
    run(r, 5, hands(() => 0));
    r.step(new Map([[0, input({ horn: 1 })]]));
    const viewed = r.view().events.filter((e) => e.type === "horn");
    expect(viewed).toHaveLength(1);
    expect(r.takeEvents().filter((e) => e.type === "horn")).toHaveLength(1);
    expect(r.view().events.filter((e) => e.type === "horn")).toHaveLength(0);
  });
});

describe("the emotes", () => {
  it("are in the kart's view as long as the driver makes them", () => {
    const r = race(ARENA, racers(2, 0));
    toGo(r);
    run(r, 10, (tick) => new Map<number, DriveInput>([[0, input({ emote: "cheer" })], [1, input({ emote: tick < GO_TICK + 5 ? "wave" : null })]]));
    expect(view(r, 0).emote).toBe("cheer");
    expect(view(r, 1).emote).toBeNull();
    run(r, 2, () => input({ emote: "wave" }));
    expect(view(r, 0).emote).toBe("wave");
    run(r, 2, () => input());
    expect(view(r, 0).emote).toBeNull();
  });

  it("survive a snapshot, so a guest sees them, and a restored race goes on as it would have", () => {
    const script = (tick: number) => new Map<number, DriveInput>([[0, input({ throttle: 1, horn: tick > GO_TICK + 100 ? 1 : 0, emote: tick > GO_TICK + 50 ? "cheer" : null })]]);
    const a = race(ARENA, racers(1, 3), { seed: 5 });
    run(a, GO_TICK + 80, script);
    const saved = JSON.parse(JSON.stringify(a.snapshot()));
    expect(saved.eg).toHaveLength(4);
    const b = race(ARENA, racers(1, 3), { seed: 5 });
    b.restore(saved);
    expect(view(b, 0).emote).toBe("cheer");
    const eventsA = run(a, 300, script);
    const eventsB = run(b, 300, script);
    expect(eventsB).toEqual(eventsA);
    expect(b.view().karts).toEqual(a.view().karts);
  });

  it("ignore a snapshot with no or bad eggs in it", () => {
    const r = race(ARENA, racers(1, 0));
    run(r, GO_TICK + 5, () => input({ emote: "wave" }));
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    delete snap.eg;
    r.restore(snap);
    expect(view(r, 0).emote).toBe("wave");
    snap.eg = [[1, 2, 3]];
    r.restore(snap);
    expect(view(r, 0).emote).toBe("wave");
  });
});

describe("the duck", () => {
  const track = MEADOW_LOOP;
  const plan = planFor(track);
  const duck = duckSpot(track, plan.geo, plan.terrain)!;

  it("squeaks once per kart per race, for a kart that drives close to it", () => {
    const r = race(track, racers(2, 0));
    toGo(r);
    const park = (id: number, dx: number) => patch(r, id, { x: duck.x + dx, z: duck.z });
    // Not close enough: nothing.
    park(0, duck.radius + 1);
    expect(run(r, 20).filter((e) => e.type === "duck")).toEqual([]);
    // Close: the event, once, however long it stays and however often it comes back.
    park(0, 1);
    const first = run(r, 20).filter((e) => e.type === "duck");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "duck", kart: 0 });
    park(0, 5);
    run(r, 5);
    park(0, 0.5);
    expect(run(r, 20).filter((e) => e.type === "duck")).toEqual([]);
    // The other kart has its own.
    park(1, 1.5);
    const second = run(r, 20).filter((e) => e.type === "duck");
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ kart: 1 });
  });

  it("is told of once even when the race is saved and restored in between", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    patch(r, 0, { x: duck.x, z: duck.z + 1 });
    expect(run(r, 5).filter((e) => e.type === "duck")).toHaveLength(1);
    r.restore(JSON.parse(JSON.stringify(r.snapshot())));
    patch(r, 0, { x: duck.x, z: duck.z });
    expect(run(r, 5).filter((e) => e.type === "duck")).toEqual([]);
  });

  it("can be found on every track: where it stands, or as near as the barrier lets a kart go", () => {
    for (const t of TRACKS) {
      const p = planFor(t);
      const spot = duckSpot(t, p.geo, p.terrain)!;
      expect(Number.isFinite(spot.x) && Number.isFinite(spot.z)).toBe(true);
      // A kart put on the spot is a kart the road lets stay there: the duck is found.
      const r = race(t, racers(1, 0));
      toGo(r);
      patch(r, 0, { x: spot.x, z: spot.z });
      expect(run(r, 3).filter((e) => e.type === "duck"), t.id).toHaveLength(1);
    }
  });

  it("is across the barrier on most tracks, and the spot is by the fence", () => {
    const wanted = plan.geo.point(track.duck!.at * plan.geo.length, track.duck!.offset);
    // Not where the duck is (it stands outside the fence)...
    expect(Math.hypot(duck.x - wanted.x, duck.z - wanted.z)).toBeGreaterThan(5);
    // ...but a kart driven right up to it is let stand there.
    const r = race(track, racers(1, 0));
    toGo(r);
    patch(r, 0, { x: duck.x, z: duck.z });
    run(r, 3);
    expect(Math.hypot(view(r, 0).x - duck.x, view(r, 0).z - duck.z)).toBeLessThan(duck.radius);
  });
});

describe("the bots", () => {
  it("honk now and then after passing someone, never in the first seconds, and not in a stream", () => {
    const r = race(ARENA, racers(0, 8, 1), { laps: 2, seed: 3 });
    const events = run(r, 70 * TICK_HZ);
    const horns = events.filter((e) => e.type === "horn");
    expect(horns.length).toBeGreaterThan(0);
    expect(horns.every((e) => e.tick >= GO_TICK + EGGS.botHonkAfter * TICK_HZ)).toBe(true);
    // Eight seconds between one bot's honks.
    for (let kart = 0; kart < 8; kart++) {
      const ticks = hornsOf(events, kart).map((e) => e.tick);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(EGGS.botHonkGap * TICK_HZ);
    }
  });

  it("honk back at a person who honks close by, a moment later, once, and never for a kart a person drives", () => {
    const r = race(MEADOW_LOOP, racers(2, 6, 1), { seed: 4 });
    // On the grid, in the countdown: kart 0 honks once, kart 1 (a person too) never does.
    run(r, 90, () => new Map([[0, input()], [1, input()]]));
    const at = r.tick;
    const near = new Set(r.view().karts.filter((k) => k.id >= 2 && Math.hypot(k.x - view(r, 0).x, k.z - view(r, 0).z) <= EGGS.answerRadius).map((k) => k.id));
    expect(near.size).toBeGreaterThan(1);
    const events = run(r, 2 * TICK_HZ, (tick) => new Map([[0, input({ horn: tick >= at ? 1 : 0 })], [1, input()]]));
    expect(hornsOf(events, 0).map((e) => e.tick)).toEqual([at]);
    expect(hornsOf(events, 1)).toEqual([]);
    const answers = events.filter((e) => e.type === "horn" && e.kart !== 0) as Extract<RaceEvent, { type: "horn" }>[];
    expect(answers.length).toBeGreaterThan(0);
    for (const e of answers) {
      expect(near.has(e.kart), `kart ${e.kart} is too far to hear`).toBe(true);
      expect(e.tick - at).toBeGreaterThanOrEqual(EGGS.answerDelay.least * TICK_HZ);
      expect(e.tick - at).toBeLessThanOrEqual((EGGS.answerDelay.least + EGGS.answerDelay.spread) * TICK_HZ + 1);
    }
    expect(new Set(answers.map((e) => e.kart)).size).toBe(answers.length);
    // A second honk a moment later: those that answered are quiet for a while.
    const later = run(r, 2 * TICK_HZ, () => new Map([[0, input({ horn: 2 })], [1, input()]]));
    expect(later.filter((e) => e.type === "horn" && answers.some((a) => a.kart === e.kart))).toEqual([]);
  });

  it("answer a honk the same way in a race restored halfway through", () => {
    const honk = (tick: number) => new Map([[0, input({ horn: tick >= 100 ? 1 : 0 })]]);
    const whole = race(MEADOW_LOOP, racers(1, 7, 0.5), { seed: 6 });
    const all = run(whole, 200, honk).filter((e) => e.type === "horn");
    const first = race(MEADOW_LOOP, racers(1, 7, 0.5), { seed: 6 });
    run(first, 110, honk);
    const resumed = race(MEADOW_LOOP, racers(1, 7, 0.5), { seed: 6 });
    resumed.restore(JSON.parse(JSON.stringify(first.snapshot())));
    const rest = run(resumed, 90, honk).filter((e) => e.type === "horn");
    expect(rest.map((e) => [e.kart, e.tick])).toEqual(all.filter((e) => e.tick >= 110).map((e) => [e.kart, e.tick]));
    expect(rest.length).toBeGreaterThan(0);
  });

  it("honk more the sharper they are", () => {
    const count = (skill: number) => {
      let total = 0;
      for (const seed of [1, 2, 3]) total += run(race(ARENA, racers(0, 8, skill), { laps: 2, seed }), 70 * TICK_HZ).filter((e) => e.type === "horn").length;
      return total;
    };
    expect(count(1)).toBeGreaterThanOrEqual(count(0));
  });

  it("cheer for a few seconds when they finish in the top three, and only then", () => {
    const r = race(ARENA, racers(0, 6, 1), { laps: 1, seed: 9 });
    const cheered = new Set<number>();
    const order: number[] = [];
    for (let i = 0; i < 90 * TICK_HZ; i++) {
      r.step(new Map());
      for (const e of r.takeEvents()) if (e.type === "finish") order.push(e.kart);
      for (const k of r.view().karts) if (k.emote === "cheer") cheered.add(k.id);
    }
    expect(order.length).toBe(6);
    expect([...cheered].sort()).toEqual(order.slice(0, 3).sort());
    // And it stops: ten seconds on, nobody is still cheering.
    run(r, 10 * TICK_HZ);
    expect(r.view().karts.every((k) => k.emote === null)).toBe(true);
  });
});

describe("hash", () => {
  it("gives numbers in [0, 1) that are the same each time", () => {
    for (let i = 0; i < 200; i++) {
      const v = unit(i % 8, i * 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(unit(i % 8, i * 7)).toBe(v);
    }
  });
});

describe("the wire", () => {
  it("carries the horn count and the emote, and reads an older sender's as none", () => {
    const sent: DriveInput = { steer: -0.33, throttle: 1, brake: 0, drift: true, itemPresses: 7, horn: 12, emote: "wave" };
    const wire = encodeInput(42, sent);
    expect(wire).toEqual([42, -33, 100, 0, 1, 7, 12, 2]);
    expect(decodeInput(wire)).toEqual(sent);
    expect(quantiseInput(sent)).toEqual(sent);
    expect(decodeInput(encodeInput(1, { ...sent, emote: "cheer" })).emote).toBe("cheer");
    expect(decodeInput(encodeInput(1, { ...sent, emote: null })).emote).toBeUndefined();
    // Nothing to say costs nothing on the wire.
    expect(encodeInput(1, { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 2, horn: 0, emote: null })).toEqual([1, 0, 100, 0, 0, 2]);
    // An input from before (six numbers) and one with rubbish in the new places.
    expect(decodeInput([1, 0, 100, 0, 0, 3])).toEqual({ steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 3 });
    expect(decodeInput([1, 0, 100, 0, 0, 3, -4, 9])).toEqual({ steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 3 });
    expect(decodeInput([1, 0, 100, 0, 0, 3, Number.NaN, Number.NaN])).toEqual({ steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 3 });
  });
});
