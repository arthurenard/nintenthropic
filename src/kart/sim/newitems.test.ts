import { describe, expect, it } from "vitest";
import type { DriveInput, RaceEvent } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS, TRACKS } from "../track/tracks";
import { itemOdds } from "./items";
import { count, give, input, patch, race, racers, run, toGo, view } from "./testing";
import { ITEM_KINDS } from "./state";
import { botField } from "./trackStats";
import { TUNING } from "./tuning";

const harbour = TrackGeometry.build(HARBOUR_LIGHTS);
type R = ReturnType<typeof race>;

const press = (n: number, over: Partial<DriveInput> = {}): DriveInput => input({ itemPresses: n, ...over });
const only = (id: number, i: DriveInput) => () => new Map([[id, i]]);

/** Stands a kart on the track at (s, offset), facing along it, at a stand or at a speed. */
function put(r: R, id: number, s: number, offset = 0, speed = 0): void {
  const p = harbour.point(s, offset);
  const h = harbour.heading(s);
  patch(r, id, { x: p.x, z: p.z, s, offset, progress: s, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed });
}

/** Adds a thing to the track through a snapshot: a row of the kind's table (p, e, l, d, r). */
function addThing(r: R, table: "p" | "e" | "l" | "d" | "r", row: number[]): void {
  const snap = JSON.parse(JSON.stringify(r.snapshot()));
  (snap[table] as number[][]).push(row);
  r.restore(snap);
}

const trap = (id: number, x: number, z: number, s: number): number[] => [id, 99, x, z, s, 0, 0];
const near = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
const kinds = (r: R, kind: string) => r.view().things.filter((t) => t.kind === kind);

describe("puck3", () => {
  it("is three pucks, one per press, and then the item is gone", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    give(r, 0, "puck3");
    expect(view(r).itemUses).toBe(3);
    for (let n = 1; n <= 3; n++) {
      const events = run(r, 1, () => press(n));
      expect(events.find((e) => e.type === "use")).toMatchObject({ kart: 0, item: "puck3" });
      expect(kinds(r, "puck")).toHaveLength(n);
      expect(view(r).item).toBe(n < 3 ? "puck3" : null);
      expect(view(r).itemUses).toBe(3 - n);
      run(r, 5, () => press(n));
    }
  });

  it("spins out what it hits, as a puck does", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    give(r, 2, "puck3");
    run(r, 1, only(2, press(1)));
    const events = run(r, 120);
    expect(events.find((e) => e.type === "hit")).toMatchObject({ kart: 0, by: 2, cause: "puck" });
  });
});

describe("comet", () => {
  it("lasts six seconds and is 15% faster than the top speed", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    run(r, 180, () => input({ throttle: 1 }));
    give(r, 0, "comet");
    const events = run(r, 1, () => press(1, { throttle: 1 }));
    expect(events.find((e) => e.type === "use")).toMatchObject({ kart: 0, item: "comet" });
    expect(view(r).item).toBeNull();
    expect(view(r).comet).toBeGreaterThan(5.9);
    expect(view(r).comet).toBeLessThanOrEqual(TUNING.items.comet.duration);
    let top = 0;
    for (let i = 0; i < 300; i++) {
      run(r, 1, () => press(1, { throttle: 1 }));
      top = Math.max(top, view(r).speed);
    }
    expect(top).toBeGreaterThan(24 * 1.1);
    expect(top).toBeLessThanOrEqual(24 * 1.15 + 0.01);
    run(r, 120, () => press(1, { throttle: 1 }));
    expect(view(r).comet).toBe(0);
    run(r, 90, () => press(1, { throttle: 1 }));
    expect(view(r).speed).toBeLessThanOrEqual(24.01);
  });

  it("drives on the grass as if it were road", () => {
    const grass = (comet: number): number => {
      const r = race(HARBOUR_LIGHTS, racers(1, 0));
      toGo(r);
      put(r, 0, 100, harbour.at(100).width / 2 + 2, 20);
      patch(r, 0, { comet });
      run(r, 100, () => input({ throttle: 1 }));
      return view(r).speed;
    };
    expect(grass(0)).toBeLessThan(13);
    expect(grass(600)).toBeGreaterThan(20);
  });

  it("is not hit by pucks, slicks or decoys", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    patch(r, 0, { comet: 600 });
    give(r, 2, "puck");
    run(r, 1, only(2, press(1)));
    expect(count(run(r, 150), "hit")).toBe(0);
    expect(view(r, 0).spin).toBe(0);
    // Slick and decoy lying right under it.
    const p = view(r, 0);
    addThing(r, "l", trap(500, p.x, p.z, 0));
    addThing(r, "d", trap(501, p.x, p.z, 0));
    expect(count(run(r, 30), "hit")).toBe(0);
    expect(kinds(r, "slick")).toHaveLength(1);
    expect(kinds(r, "decoy")).toHaveLength(1);
  });

  it("spins the karts it touches, and is neither shoved nor spun itself", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    // Kart 2, a Comet, drives into kart 0 standing in its way.
    put(r, 0, 60);
    put(r, 2, 40, 0, 20);
    put(r, 1, 0, 0);
    patch(r, 2, { comet: 600 });
    const events = run(r, 60, only(2, input({ throttle: 1 })));
    expect(events.find((e) => e.type === "hit")).toMatchObject({ kart: 0, by: 2, cause: "comet" });
    expect(view(r, 2).spin).toBe(0);
    expect(count(events, "bump")).toBe(0);
  });

  it("is spared by a blast beside it", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    put(r, 1, 100);
    put(r, 2, 103);
    put(r, 0, 20);
    patch(r, 2, { comet: 600 });
    give(r, 1, "blast");
    const events = run(r, 1, only(1, press(1)));
    expect(events.find((e) => e.type === "strike")).toMatchObject({ item: "blast" });
    expect(count(events, "hit")).toBe(0);
    expect(view(r, 2).spin).toBe(0);
  });
});

describe("storm", () => {
  it("spins every kart ahead briefly and slows them to 60% of top speed for 3 s", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    expect(view(r, 2).place).toBe(3);
    give(r, 2, "storm");
    const events = run(r, 1, only(2, press(1)));
    expect(events.filter((e) => e.type === "hit").map((e) => (e.type === "hit" ? [e.kart, e.cause] : []))).toEqual([
      [0, "storm"],
      [1, "storm"],
    ]);
    expect(events.filter((e) => e.type === "strike").map((e) => (e.type === "strike" ? [e.kart, e.item] : []))).toEqual([
      [0, "storm"],
      [1, "storm"],
    ]);
    for (const id of [0, 1]) {
      expect(view(r, id).spin).toBeGreaterThan(0.6);
      expect(view(r, id).spin).toBeLessThanOrEqual(TUNING.items.storm.spin);
      expect(view(r, id).zapped).toBeGreaterThan(2.9);
    }
    expect(view(r, 2).zapped).toBe(0);
    expect(view(r, 2).spin).toBe(0);
    // They crawl while zapped, and are back to speed afterwards.
    let crawl = 0;
    let after = 0;
    const both = () => new Map([[0, input({ throttle: 1 })], [1, input({ throttle: 1 })]]);
    for (let i = 0; i < 480; i++) {
      run(r, 1, both);
      const k = view(r, 0);
      if (k.zapped! > 0) crawl = Math.max(crawl, k.speed);
      else if (k.spin === 0) after = Math.max(after, k.speed);
    }
    expect(crawl).toBeLessThanOrEqual(24 * TUNING.items.storm.speed + 0.5);
    expect(after).toBeGreaterThan(22);
  });

  it("leaves the karts behind alone, and a Comet", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    patch(r, 0, { comet: 600 });
    give(r, 1, "storm");
    const events = run(r, 1, only(1, press(1)));
    // Kart 1 is second: only kart 0 is ahead, and it is a Comet.
    expect(count(events, "hit")).toBe(0);
    expect(count(events, "strike")).toBe(0);
    expect(view(r, 0).zapped).toBe(0);
    expect(view(r, 2).zapped).toBe(0);
  });

  it("spares a kart the drone is carrying, and one it has just set down", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    patch(r, 0, { rescue: 60 });
    patch(r, 1, { immune: 60 });
    give(r, 2, "storm");
    const events = run(r, 1, only(2, press(1)));
    expect(count(events, "hit")).toBe(0);
    expect(count(events, "strike")).toBe(0);
    expect(view(r, 0).zapped).toBe(0);
    expect(view(r, 1).zapped).toBe(0);
  });

  it("goes to everyone else when no one is ahead", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    give(r, 0, "storm");
    const events = run(r, 1, only(0, press(1)));
    expect(events.filter((e) => e.type === "strike")).toHaveLength(2);
    expect(view(r, 0).zapped).toBe(0);
  });

  it("is dealt once in fifteen seconds at most, over a whole race of bots", { timeout: 60000 }, () => {
    let storms = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = race(TRACKS[seed % TRACKS.length]!, botField(), { laps: 3, seed });
      const drawn: number[] = [];
      for (const e of run(r, 60 * 150)) if (e.type === "pickup" && e.item === "storm") drawn.push(e.tick);
      for (let i = 1; i < drawn.length; i++) expect(drawn[i]! - drawn[i - 1]!).toBeGreaterThanOrEqual(15 * 60);
      storms += drawn.length;
    }
    expect(storms).toBeGreaterThan(0);
  });
});

describe("skyrocket", () => {
  /** Kart 0 leads, kart 2 is a few metres from it (second), kart 1 (the user) is far behind. */
  function setup(): R {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    put(r, 0, 120);
    put(r, 2, 115, 5);
    put(r, 1, 40);
    give(r, 1, "skyrocket");
    return r;
  }

  it("flies high over the track to the leader, and bursts after a second at least", () => {
    const r = setup();
    expect(view(r, 0).place).toBe(1);
    const used = run(r, 1, only(1, press(1)));
    const useTick = used[0]!.tick;
    const rocket = kinds(r, "skyrocket");
    expect(rocket).toHaveLength(1);
    expect(rocket[0]!.target).toBe(0);
    let peak = 0;
    let burst: RaceEvent | undefined;
    let ticks = 0;
    while (!burst && ticks++ < 400) {
      const events = run(r, 1);
      const now = kinds(r, "skyrocket")[0];
      if (now) peak = Math.max(peak, now.y - harbour.at(120).y);
      burst = events.find((e) => e.type === "strike");
    }
    expect(burst).toMatchObject({ type: "strike", kart: 0, item: "skyrocket" });
    expect(burst!.tick - useTick).toBeGreaterThanOrEqual(60);
    expect(burst!.tick - useTick).toBeLessThan(150);
    expect(peak).toBeGreaterThan(8);
    expect(kinds(r, "skyrocket")).toHaveLength(0);
  });

  it("spins everyone within 9 m of the leader, and no one beyond", () => {
    const r = setup();
    run(r, 1, only(1, press(1)));
    const events = run(r, 200);
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.map((e) => (e.type === "hit" ? e.kart : -1)).sort()).toEqual([0, 2]);
    expect(hits.every((e) => e.type === "hit" && e.cause === "skyrocket" && e.by === 1)).toBe(true);
    expect(view(r, 1).spin).toBe(0);
  });

  it("goes to the runner-up when the user leads", () => {
    const r = setup();
    give(r, 0, "skyrocket");
    patch(r, 1, { item: -1 });
    run(r, 1, only(0, press(1)));
    expect(kinds(r, "skyrocket")[0]!.target).toBe(2);
  });

  it("flies past a kart already home to the leader of those still racing, and a bot keeps one when no one is", () => {
    const r = setup();
    // Kart 0 has finished: its lap of honour is no target.
    patch(r, 0, { finished: 30, finalPlace: 1, lap: 4 });
    run(r, 1, only(1, press(1)));
    expect(kinds(r, "skyrocket")[0]!.target).toBe(2);
    const events = run(r, 200);
    expect(events.find((e) => e.type === "strike")).toMatchObject({ kart: 2, item: "skyrocket" });
    // With everyone else home, a bot holding one does not throw it away.
    const alone = race(HARBOUR_LIGHTS, racers(0, 2));
    toGo(alone);
    patch(alone, 0, { finished: 30, finalPlace: 1, lap: 4 });
    give(alone, 1, "skyrocket");
    expect(count(run(alone, 60 * 5), "use")).toBe(0);
  });

  it("is defended by a blast just as it comes", () => {
    const r = setup();
    run(r, 1, only(1, press(1)));
    let defended = false;
    const events: RaceEvent[] = [];
    for (let i = 0; i < 300; i++) {
      const rocket = kinds(r, "skyrocket")[0];
      if (!defended && rocket && near(rocket, view(r, 0)) < 5 && i > 30) {
        give(r, 0, "blast");
        events.push(...run(r, 1, only(0, press(1))));
        defended = true;
        continue;
      }
      events.push(...run(r, 1));
    }
    expect(defended).toBe(true);
    expect(kinds(r, "skyrocket")).toHaveLength(0);
    expect(events.filter((e) => e.type === "strike").map((e) => (e.type === "strike" ? e.item : ""))).toEqual(["blast"]);
    expect(events.find((e) => e.type === "hit" && e.cause === "skyrocket")).toBeUndefined();
    // A blast never spins its own user.
    expect(view(r, 0).spin).toBe(0);
  });

  it("is at most one in the air or in hand over a whole race of bots", { timeout: 60000 }, () => {
    let rockets = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = race(TRACKS[seed % TRACKS.length]!, botField(), { laps: 3, seed });
      for (let i = 0; i < 60 * 150; i++) {
        r.step(new Map());
        for (const e of r.takeEvents()) if (e.type === "use" && e.item === "skyrocket") rockets++;
        const v = r.view();
        expect(v.things.filter((t) => t.kind === "skyrocket").length).toBeLessThanOrEqual(1);
        expect(v.karts.filter((k) => k.item === "skyrocket").length + v.things.filter((t) => t.kind === "skyrocket").length).toBeLessThanOrEqual(1);
      }
    }
    expect(rockets).toBeGreaterThan(0);
  });
});

describe("a kart flying off a ramp", () => {
  it("is passed under by a puck and a seeker, which skim the road, and hit again once it is down", () => {
    for (const thing of ["puck", "seeker"] as const) {
      const r = race(HARBOUR_LIGHTS, racers(3, 0));
      toGo(r);
      // Kart 0 hangs in the air, still, up the straight; kart 1 fires at it from behind.
      put(r, 0, 70);
      patch(r, 0, { flight: 1, air: 2, vy: 4 });
      put(r, 1, 50);
      put(r, 2, 300);
      give(r, 1, thing);
      const flying = run(r, 30, only(1, press(1)));
      expect(count(flying, "hit"), thing).toBe(0);
      expect(view(r, 0).hop, thing).toBeGreaterThan(TUNING.hazard.clearHeight);
    }
    // On the ground the same shot hits.
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    put(r, 0, 70);
    put(r, 1, 50);
    put(r, 2, 300);
    give(r, 1, "puck");
    expect(run(r, 30, only(1, press(1))).find((e) => e.type === "hit")).toMatchObject({ kart: 0, by: 1, cause: "puck" });
  });
});

describe("blast", () => {
  it("spins karts within 7 m and no others, and clears what is on the track inside", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    put(r, 0, 100);
    put(r, 1, 105);
    put(r, 2, 112, 6);
    const user = view(r, 0);
    // A slick, a decoy, a puck, a seeker and a skyrocket at 4 m ahead and at 12 m.
    for (const [i, d] of [4, 12].entries()) {
      const p = harbour.point(100 + d, 0);
      addThing(r, "l", trap(600 + i, p.x, p.z, 100 + d));
      addThing(r, "d", trap(610 + i, p.x, p.z, 100 + d));
      addThing(r, "p", [620 + i, 5, p.x, p.z, 100 + d, 0, 0, 200, 10]);
      addThing(r, "e", [630 + i, 5, -1, p.x, p.z, 0, 1, 100 + d, 200, 10]);
      addThing(r, "r", [640 + i, 5, 100 + d, 40, 10]);
    }
    expect(r.view().things.filter((t) => ["slick", "decoy", "puck", "seeker", "skyrocket"].includes(t.kind))).toHaveLength(10);
    give(r, 0, "blast");
    const events = run(r, 1, only(0, press(1)));
    expect(events.find((e) => e.type === "use")).toMatchObject({ item: "blast" });
    expect(events.filter((e) => e.type === "hit").map((e) => (e.type === "hit" ? e.kart : -1))).toEqual([1]);
    expect(events.find((e) => e.type === "strike")).toMatchObject({ kart: 0, item: "blast", x: user.x, z: user.z });
    expect(view(r, 1).spin).toBeGreaterThan(1);
    expect(view(r, 2).spin).toBe(0);
    expect(view(r, 0).spin).toBe(0);
    for (const kind of ["slick", "decoy", "puck", "seeker", "skyrocket"]) {
      const left = kinds(r, kind);
      expect(left, kind).toHaveLength(1);
      expect(near(left[0]!, user), kind).toBeGreaterThan(TUNING.items.blast.radius);
    }
  });
});

describe("decoy", () => {
  it("lies behind the kart that dropped it, looks like a box and spins whoever drives into it", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    give(r, 0, "decoy");
    const dropped = run(r, 1, only(0, press(1)));
    expect(dropped.find((e) => e.type === "use")).toMatchObject({ kart: 0, item: "decoy" });
    const decoy = kinds(r, "decoy")[0]!;
    expect(decoy).toBeDefined();
    expect(near(decoy, view(r, 0))).toBeCloseTo(TUNING.items.decoy.behind, 0);
    expect(kinds(r, "slick")).toHaveLength(0);
    const events = run(r, 90, () => new Map([[2, input({ throttle: 1 })]]));
    expect(events.find((e) => e.type === "hit")).toMatchObject({ kart: 2, by: 0, cause: "decoy" });
    expect(kinds(r, "decoy")).toHaveLength(0);
    expect(view(r, 2).spin).toBeGreaterThan(0);
    expect(view(r, 0).spin).toBe(0);
  });

  it("number at most eight, the oldest going", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    for (let n = 1; n <= 10; n++) {
      give(r, 0, "decoy");
      run(r, 1, () => press(n));
    }
    expect(kinds(r, "decoy")).toHaveLength(TUNING.items.decoy.max);
  });
});

describe("the odds by place", () => {
  const odds = (place: number, racersCount = 8) => {
    const weights = itemOdds(place, racersCount);
    const total = weights.reduce((a, b) => a + b, 0);
    return Object.fromEntries(ITEM_KINDS.map((kind, i) => [kind, weights[i]! / total])) as Record<(typeof ITEM_KINDS)[number], number>;
  };

  it("give the leader slicks, pucks, decoys and blasts, and none of the back-of-pack items", () => {
    const first = odds(1);
    expect(first.slick + first.puck + first.decoy + first.blast).toBeGreaterThan(0.8);
    expect(first.comet + first.storm + first.skyrocket + first.seeker + first.nitro3 + first.puck3).toBe(0);
  });

  it("give the middle pucks, seekers, triple pucks and nitros", () => {
    const middle = odds(4, 7);
    expect(middle.puck + middle.seeker + middle.puck3 + middle.nitro).toBeGreaterThan(0.6);
    expect(middle.storm + middle.skyrocket).toBe(0);
  });

  it("give the back nitro3s and comets, and storms and skyrockets only rarely", () => {
    const last = odds(8);
    expect(last.nitro3 + last.comet).toBeGreaterThan(0.4);
    expect(last.storm).toBeGreaterThan(0);
    expect(last.skyrocket).toBeGreaterThan(0);
    expect(last.storm).toBeLessThan(0.1);
    expect(last.skyrocket).toBeLessThan(0.1);
    expect(last.slick + last.decoy + last.blast).toBe(0);
  });

  it("are a blend between, smooth place by place", () => {
    for (const kind of ITEM_KINDS) {
      let last = odds(1)[kind];
      for (let place = 2; place <= 8; place++) {
        const now = odds(place)[kind];
        expect(Math.abs(now - last)).toBeLessThan(0.12);
        last = now;
      }
    }
  });
});

describe("determinism and snapshots", () => {
  it("replays the same race, items and all, and a restored race carries on the same", { timeout: 60000 }, () => {
    const a = race(TRACKS[0]!, botField(), { laps: 3, seed: 7 });
    const b = race(TRACKS[0]!, botField(), { laps: 3, seed: 7 });
    let sizeMax = 0;
    const eventsA: RaceEvent[] = [];
    const eventsB: RaceEvent[] = [];
    let saved: ReturnType<typeof a.snapshot> | null = null;
    for (let i = 0; i < 60 * 70; i++) {
      eventsA.push(...run(a, 1));
      eventsB.push(...run(b, 1));
      if (i % 60 === 0) sizeMax = Math.max(sizeMax, JSON.stringify(a.snapshot()).length);
      if (i === 60 * 40) {
        saved = JSON.parse(JSON.stringify(a.snapshot()));
      }
    }
    expect(eventsA).toEqual(eventsB);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    expect(eventsA.some((e) => e.type === "use" && (e.item === "comet" || e.item === "decoy" || e.item === "blast"))).toBe(true);
    expect(sizeMax).toBeLessThan(3072);
    // Restore the middle snapshot into a fresh race and run on: the same ending.
    const c = race(TRACKS[0]!, botField(), { laps: 3, seed: 7 });
    c.restore(saved!);
    const eventsC: RaceEvent[] = [];
    for (let i = 60 * 40 + 1; i < 60 * 70; i++) eventsC.push(...run(c, 1));
    expect(JSON.stringify(c.snapshot())).toBe(JSON.stringify(a.snapshot()));
    expect(eventsC.length).toBeGreaterThan(0);
  });

  it("round-trips a snapshot with a Comet, a zapped kart, decoys and a skyrocket in it", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    patch(r, 0, { comet: 200, zap: 100 });
    give(r, 1, "decoy");
    run(r, 1, only(1, press(1)));
    give(r, 2, "skyrocket");
    run(r, 1, only(2, press(1)));
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    expect(snap.d).toHaveLength(1);
    expect(snap.r).toHaveLength(1);
    const copy = race(HARBOUR_LIGHTS, racers(3, 0));
    copy.restore(snap);
    expect(JSON.stringify(copy.snapshot())).toBe(JSON.stringify(snap));
    expect(view(copy, 0).comet).toBeCloseTo(view(r, 0).comet!, 5);
    expect(kinds(copy, "decoy")).toHaveLength(1);
    expect(kinds(copy, "skyrocket")).toHaveLength(1);
    run(r, 100);
    run(copy, 100);
    expect(JSON.stringify(copy.snapshot())).toBe(JSON.stringify(r.snapshot()));
  });

  it("predicts a Comet's kart as it steps", () => {
    const a = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(a);
    give(a, 0, "comet");
    const b = race(HARBOUR_LIGHTS, racers(1, 0));
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    for (let i = 1; i <= 120; i++) {
      const inputs = new Map([[0, press(1, { throttle: 1, steer: i > 60 ? 0.3 : 0 })]]);
      a.step(inputs);
      b.predict([0], inputs);
    }
    const ka = view(a);
    const kb = view(b);
    expect(kb.comet).toBe(ka.comet);
    expect(kb.x).toBeCloseTo(ka.x, 3);
    expect(kb.z).toBeCloseTo(ka.z, 3);
    expect(kb.speed).toBeCloseTo(ka.speed, 3);
  });
});
