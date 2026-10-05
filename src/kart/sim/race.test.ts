import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../engine/rules/rng";
import { IDLE_INPUT, TICK_HZ, type DriveInput, type RaceEvent } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { CANYON_RUN, HARBOUR_LIGHTS, MEADOW_LOOP, TRACKS } from "../track/tracks";
import { GO_TICK } from "./kart";
import { createRace } from "./race";
import { give, input, patch, race, racers, run, toGo, view, type Script } from "./testing";

/** Inputs for two people that wander about like hands do, from a seeded source. */
function wandering(seed: number): Script {
  const random = mulberry32(seed);
  const state = [0, 1].map(() => ({ steer: 0, drift: false, presses: 0, brake: 0 }));
  return () => {
    const inputs = new Map<number, DriveInput>();
    state.forEach((s, id) => {
      s.steer = Math.max(-1, Math.min(1, s.steer + (random() - 0.5) * 0.3));
      if (random() < 0.01) s.drift = !s.drift;
      if (random() < 0.004) s.presses++;
      if (random() < 0.01) s.brake = s.brake > 0 ? 0 : 1;
      inputs.set(id, { steer: s.steer, throttle: s.brake > 0 ? 0 : 1, brake: s.brake, drift: s.drift, itemPresses: s.presses });
    });
    return inputs;
  };
}

const HARBOUR_GEO = TrackGeometry.build(HARBOUR_LIGHTS);

function busyRace(track = MEADOW_LOOP, seed = 7) {
  return race(track, racers(2, 6, 0.8), { seed, laps: 2 });
}

describe("the countdown", () => {
  it("says 3, 2, 1, Go after half a second of ready, and starts the race", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    expect(r.view().phase).toBe("countdown");
    expect(r.view().countdown).toBeCloseTo(3.5, 5);
    expect(r.view().time).toBe(0);
    const events = run(r, GO_TICK + 1);
    const countdown = events.filter((e) => e.type === "countdown");
    expect(countdown.map((e) => (e.type === "countdown" ? e.n : -1))).toEqual([3, 2, 1, 0]);
    expect(countdown.map((e) => e.tick)).toEqual([30, 90, 150, 210]);
    expect(r.view().phase).toBe("racing");
    expect(r.view().countdown).toBe(0);
    expect(r.view().time).toBeCloseTo(1 / TICK_HZ, 5);
  });

  it("counts down in the view too", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    run(r, 100);
    expect(r.view().countdown).toBeCloseTo((GO_TICK - 100) / TICK_HZ, 5);
    expect(r.view().phase).toBe("countdown");
  });
});

describe("events", () => {
  it("have increasing ids, are taken once, and are in the view once", () => {
    const r = busyRace();
    const taken: RaceEvent[] = [];
    const viewed: RaceEvent[] = [];
    const script = wandering(3);
    for (let i = 0; i < 60 * 40; i++) {
      r.step(script(i) as Map<number, DriveInput>);
      if (i % 7 === 0) taken.push(...r.takeEvents());
      if (i % 11 === 0) viewed.push(...r.view().events);
    }
    taken.push(...r.takeEvents());
    viewed.push(...r.view().events);
    expect(taken.length).toBeGreaterThan(20);
    const ids = taken.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(1);
    // The view got the same events, once each.
    expect(viewed.map((e) => e.id)).toEqual(ids);
    expect(r.takeEvents()).toEqual([]);
    expect(r.view().events).toEqual([]);
    for (let i = 1; i < taken.length; i++) expect(taken[i]!.tick).toBeGreaterThanOrEqual(taken[i - 1]!.tick);
  });
});

describe("places", () => {
  it("follow how far round each kart is", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    expect([0, 1, 2].map((id) => view(r, id).place)).toEqual([1, 2, 3]);
    // The kart in second drives off, in the other lane; the other two sit still: it goes to the front.
    run(r, 60 * 6, () => new Map([[1, input({ throttle: 1 })]]));
    expect(view(r, 1).place).toBe(1);
    expect(view(r, 0).place).toBe(2);
    expect(view(r, 2).place).toBe(3);
  });

  it("are always 1..n once each, in the order of progress", () => {
    const r = busyRace(CANYON_RUN);
    const script = wandering(5);
    for (let i = 0; i < 60 * 30; i++) {
      r.step(script(i) as Map<number, DriveInput>);
      if (i % 20 !== 0) continue;
      const karts = r.view().karts;
      expect(karts.map((k) => k.place).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });
});

describe("the end of the race", () => {
  /** Two people and four bots; whoever is `drivers` is handed to the bots' hands and so finishes (their place in the race is still a player's). */
  function twoPlayers() {
    const r = race(HARBOUR_LIGHTS, racers(2, 4, 0.9), { laps: 1, seed: 11 });
    toGo(r);
    return r;
  }

  it("is over when every player has finished", () => {
    const r = twoPlayers();
    r.handOver(0);
    r.handOver(1);
    let ended = -1;
    for (let i = 0; i < 60 * 120 && ended < 0; i++) {
      run(r, 1);
      if (r.view().phase === "finished") ended = i;
    }
    expect(ended).toBeGreaterThan(0);
    const result = r.result()!;
    expect(result).not.toBeNull();
    expect(result.standings).toHaveLength(6);
    expect(result.standings.map((s) => s.place)).toEqual([1, 2, 3, 4, 5, 6]);
    // Both players are home with times; the bots that were not yet home are placed after the players by progress.
    for (const id of [0, 1]) expect(result.standings.find((s) => s.kart === id)!.time).not.toBeNull();
    const times = result.standings.filter((s) => s.time !== null).map((s) => s.time!);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("is over 25 s after the first player finished, the rest placed by how far they got", () => {
    const r = twoPlayers();
    // Kart 0 drives itself; kart 1 sits there.
    r.handOver(0);
    let first = -1;
    for (let i = 0; i < 60 * 120 && first < 0; i++) {
      const events = run(r, 1);
      if (events.some((e) => e.type === "finish" && e.kart === 0)) first = r.tick;
    }
    expect(first).toBeGreaterThan(0);
    expect(r.view().phase).toBe("racing");
    run(r, 25 * TICK_HZ - 5);
    expect(r.view().phase).toBe("racing");
    expect(r.result()).toBeNull();
    run(r, 10);
    expect(r.view().phase).toBe("finished");
    const result = r.result()!;
    const standing = (kart: number) => result.standings.find((s) => s.kart === kart)!;
    // The player who never moved is last, without a time.
    expect(standing(1).time).toBeNull();
    expect(standing(1).place).toBe(6);
    expect(standing(0).time).not.toBeNull();
    // Every place once; the ones with times are in time order and ahead of those without.
    expect(result.standings.map((s) => s.place)).toEqual([1, 2, 3, 4, 5, 6]);
    const finished = result.standings.filter((s) => s.time !== null);
    const others = result.standings.filter((s) => s.time === null);
    expect(Math.max(...finished.map((s) => s.place))).toBeLessThan(Math.min(...others.map((s) => s.place)));
    // The standings stay put while the karts drive on.
    run(r, 300);
    expect(r.result()).toEqual(result);
  });

  it("keeps a best lap for those that finished", () => {
    const r = twoPlayers();
    r.handOver(0);
    r.handOver(1);
    run(r, 60 * 100);
    const done = r.result()!.standings.find((s) => s.kart === 0)!;
    expect(done.bestLap).not.toBeNull();
    expect(done.bestLap!).toBeGreaterThan(20);
    expect(done.bestLap!).toBeLessThanOrEqual(done.time!);
  });
});

describe("a snapshot", () => {
  it("is plain JSON and small: under 3 KB for eight karts mid-race, items flying", () => {
    const r = busyRace();
    const script = wandering(1);
    let biggest = 0;
    for (let i = 0; i < 60 * 45; i++) {
      r.step(script(i) as Map<number, DriveInput>);
      if (i % 30 === 0) biggest = Math.max(biggest, JSON.stringify(r.snapshot()).length);
    }
    expect(biggest).toBeGreaterThan(1000);
    expect(biggest).toBeLessThan(3000);
    // Survives a trip through JSON unchanged.
    const snap = r.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.tick).toBe(r.tick);
  });

  it("restores so that carrying on is the same as never having snapshotted", () => {
    const a = busyRace();
    const script = wandering(9);
    const history: Map<number, DriveInput>[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      const inputs = script(i) as Map<number, DriveInput>;
      history.push(inputs);
      a.step(inputs);
    }
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    // Things to carry over: items in the air, a bot mid-mistake, a drift...
    const after = Array.from({ length: 60 * 12 }, (_, i) => script(history.length + i) as Map<number, DriveInput>);
    for (const inputs of after) a.step(inputs);

    // A fresh race built from the same setup, restored to the snapshot, then run the same.
    const b = busyRace();
    b.restore(snap);
    expect(b.tick).toBe(snap.tick);
    for (const inputs of after) b.step(inputs);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect({ ...b.view(), events: [] }).toEqual({ ...a.view(), events: [] });

    // And restoring a race to its own snapshot changes nothing.
    const c = busyRace();
    const d = busyRace();
    for (let i = 0; i < 60 * 14; i++) {
      const inputs = history[i]!;
      c.step(inputs);
      d.step(inputs);
    }
    c.restore(c.snapshot());
    for (const inputs of after) {
      c.step(inputs);
      d.step(inputs);
    }
    expect(c.snapshot()).toEqual(d.snapshot());
  });

  it("carries the random generator: items and bots go on the same", () => {
    const a = busyRace(CANYON_RUN, 21);
    run(a, 60 * 20);
    const snap = a.snapshot();
    const b = busyRace(CANYON_RUN, 21);
    b.restore(snap);
    run(a, 60 * 25);
    run(b, 60 * 25);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("is ignored if it is not this race's", () => {
    const a = race(HARBOUR_LIGHTS, racers(1, 3));
    const b = race(HARBOUR_LIGHTS, racers(1, 5));
    run(a, 100);
    run(b, 50);
    const before = JSON.stringify(b.snapshot());
    b.restore(a.snapshot());
    b.restore({ tick: 3 });
    expect(JSON.stringify(b.snapshot())).toBe(before);
  });

  it("that is damaged changes nothing", () => {
    const a = busyRace();
    run(a, 300);
    const b = busyRace();
    run(b, 200);
    const before = JSON.stringify(b.snapshot());
    const good = a.snapshot();
    const k = good.k as number[][];
    for (const damaged of [
      { ...good, k: k.slice(1) },
      { ...good, k: k.map((row) => row.slice(1)) },
      { ...good, k: k.map((row, i) => (i === 3 ? row.map(() => Number.NaN) : row)) },
      { ...good, b: [1] },
      { ...good, home: undefined },
      { ...good, p: [[1, 2, 3]] },
      { ...good, rng: 1e12 },
      { ...good, tick: "soon" },
    ]) {
      b.restore(damaged as unknown as typeof good);
      expect(JSON.stringify(b.snapshot())).toBe(before);
    }
  });

  it("leaves no events waiting from before", () => {
    const a = busyRace();
    run(a, 400);
    const b = busyRace();
    run(b, 300);
    b.restore(a.snapshot());
    expect(b.takeEvents()).toEqual([]);
    expect(b.view().events).toEqual([]);
  });
});

describe("determinism", () => {
  it("the same setup and inputs give the same race, snapshot for snapshot", () => {
    for (const track of TRACKS) {
      const a = busyRace(track, 5);
      const b = busyRace(track, 5);
      const sa = wandering(2);
      const sb = wandering(2);
      for (let i = 0; i < 60 * 40; i++) {
        a.step(sa(i) as Map<number, DriveInput>);
        b.step(sb(i) as Map<number, DriveInput>);
        if (i % 120 === 0) expect(a.snapshot()).toEqual(b.snapshot());
      }
      expect(a.snapshot()).toEqual(b.snapshot());
      expect(a.view()).toEqual(b.view());
    }
  });

  it("a different seed gives a different race", () => {
    const a = busyRace(MEADOW_LOOP, 1);
    const b = busyRace(MEADOW_LOOP, 2);
    run(a, 60 * 30);
    run(b, 60 * 30);
    expect(JSON.stringify(a.snapshot())).not.toBe(JSON.stringify(b.snapshot()));
  });
});

describe("predict", () => {
  it("matches step for a lone kart, hops, drifts and all", () => {
    const stepped = race(HARBOUR_LIGHTS, racers(1, 0));
    const predicted = race(HARBOUR_LIGHTS, racers(1, 0));
    const random = mulberry32(4);
    let steer = 0;
    let drift = false;
    let hopped = 0;
    let drifted = 0;
    let walled = 0;
    // Wandering hands, up to the first row of item boxes, 120 m up the straight.
    for (let i = 0; i < 480; i++) {
      steer = Math.max(-1, Math.min(1, steer + (random() - 0.5) * 0.8));
      if (random() < 0.03) drift = !drift;
      const given = input({ throttle: i > GO_TICK - 20 ? 1 : 0, steer, drift: i > GO_TICK + 20 && drift });
      stepped.step(new Map([[0, given]]));
      predicted.predict([0], new Map([[0, given]]));
      const s = view(stepped);
      const p = view(predicted);
      expect(p.x).toBe(s.x);
      expect(p.z).toBe(s.z);
      expect(p.heading).toBe(s.heading);
      expect(p.speed).toBe(s.speed);
      expect(p.drift).toBe(s.drift);
      expect(p.boost).toBe(s.boost);
      expect(p.hop).toBe(s.hop);
      expect(p.offroad).toBe(s.offroad);
      if (s.hop > 0) hopped++;
      if (s.drift !== 0) drifted++;
      if (Math.abs(HARBOUR_GEO.project(s.x, s.z).offset) > HARBOUR_LIGHTS.width / 2 + 5) walled++;
    }
    // The run was an eventful one.
    expect(hopped).toBeGreaterThan(5);
    expect(drifted).toBeGreaterThan(20);
    expect(walled).toBeGreaterThan(0);
    expect(view(stepped).speed).toBeGreaterThan(0);
  });

  it("moves only the karts it is given, and not the clock, the items or the events", () => {
    const r = busyRace();
    for (let i = 0; i < 400; i++) r.step(new Map());
    const before = r.view();
    const events = r.takeEvents();
    expect(events.length).toBeGreaterThan(0);
    r.predict([0], new Map([[0, input({ throttle: 1, steer: 0.2 })]]));
    const after = r.view();
    expect(after.tick).toBe(before.tick);
    expect(after.time).toBe(before.time);
    expect(after.things).toEqual(before.things);
    expect(r.takeEvents()).toEqual([]);
    expect(after.karts[0]).not.toEqual(before.karts[0]);
    for (let i = 1; i < 8; i++) expect(after.karts[i]).toEqual(before.karts[i]);
  });

  it("predicts a guest's own kart from a restored snapshot: the host's step is the truth", () => {
    // A guest restores a snapshot and replays its unconfirmed inputs; where the host got to is where it ends up.
    const host = race(HARBOUR_LIGHTS, racers(1, 0));
    const guest = race(HARBOUR_LIGHTS, racers(1, 0));
    const inputs = (tick: number) => input({ throttle: tick > GO_TICK - 20 ? 1 : 0, steer: 0.1 * Math.sin(tick / 20) });
    for (let i = 0; i < 400; i++) host.step(new Map([[0, inputs(i)]]));
    // The guest has the host's state as of tick 380 and 20 inputs the host has not told it about.
    const hostEarly = race(HARBOUR_LIGHTS, racers(1, 0));
    for (let i = 0; i < 380; i++) hostEarly.step(new Map([[0, inputs(i)]]));
    guest.restore(hostEarly.snapshot());
    for (let i = 380; i < 400; i++) guest.predict([0], new Map([[0, inputs(i)]]));
    expect(view(guest).x).toBe(view(host).x);
    expect(view(guest).z).toBe(view(host).z);
    expect(view(guest).heading).toBe(view(host).heading);
  });
});

describe("the view", () => {
  it("fills every field of every kart and thing", () => {
    const r = busyRace();
    run(r, 60 * 25, wandering(8));
    const v = r.view();
    expect(v.karts).toHaveLength(8);
    expect(v.racers).toBe(r.setup.racers);
    expect(v.track).toBe(r.setup.track);
    expect(v.laps).toBe(2);
    expect(v.phase).toBe("racing");
    expect(v.time).toBeCloseTo((r.tick - GO_TICK) / TICK_HZ, 5);
    for (const k of v.karts) {
      for (const key of ["x", "y", "z", "heading", "speed", "steer", "boost", "spin", "hop", "itemUses", "place", "lap", "lapProgress"] as const) {
        expect(Number.isFinite(k[key]), `kart ${k.id} ${key}`).toBe(true);
      }
      expect([-1, 0, 1]).toContain(k.drift);
      expect([0, 1, 2]).toContain(k.driftLevel);
      expect(typeof k.offroad).toBe("boolean");
      expect(typeof k.rolling).toBe("boolean");
      expect(typeof k.wrongWay).toBe("boolean");
      expect(k.steer).toBeGreaterThanOrEqual(-1);
      expect(k.steer).toBeLessThanOrEqual(1);
      expect(k.lapProgress).toBeGreaterThanOrEqual(0);
      expect(k.lapProgress).toBeLessThanOrEqual(1);
      expect(k.lap).toBeGreaterThanOrEqual(1);
      expect(k.finished === null || typeof k.finished === "number").toBe(true);
      expect(k.item === null || typeof k.item === "string").toBe(true);
    }
    // Karts are on the road, at its height.
    const geo = TrackGeometry.build(MEADOW_LOOP);
    for (const k of v.karts) {
      const p = geo.project(k.x, k.z);
      expect(Math.abs(p.offset)).toBeLessThanOrEqual(p.sample.width / 2 + 6);
      expect(k.y).toBeCloseTo(p.sample.y, 1);
    }
    for (const t of v.things) {
      expect(["box", "puck", "seeker", "slick"]).toContain(t.kind);
      for (const key of ["id", "x", "y", "z", "heading"] as const) expect(Number.isFinite(t[key])).toBe(true);
    }
    expect(new Set(v.things.map((t) => t.id)).size).toBe(v.things.length);
  });

  it("shows the item the kart holds, and the roulette while it turns", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    give(r, 0, "seeker");
    expect(view(r).item).toBe("seeker");
    expect(view(r).rolling).toBe(false);
    patch(r, 0, { item: -1, roll: 30, rolled: 2 });
    expect(view(r).rolling).toBe(true);
    expect(view(r).item).toBeNull();
    run(r, 31);
    expect(view(r).item).toBe("puck");
    expect(view(r).rolling).toBe(false);
  });
});

describe("speed", () => {
  it("steps eight karts in well under a third of a millisecond", () => {
    const r = race(MEADOW_LOOP, racers(2, 6, 0.8), { seed: 3 });
    const script = wandering(6);
    run(r, 600, script);
    const inputs = script(0) as Map<number, DriveInput>;
    const count = 3000;
    const started = performance.now();
    for (let i = 0; i < count; i++) r.step(inputs);
    const each = (performance.now() - started) / count;
    expect(each).toBeLessThan(0.3);
    void IDLE_INPUT;
  });
});
