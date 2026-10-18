import type { RaceEvent } from "../contract";
import { describe, expect, it } from "vitest";
import type { DriveInput } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { FIVE_FINGER_CIRCUIT, HARBOUR_LIGHTS, TRACKS } from "../track/tracks";
import { itemOdds } from "./items";
import { planFor } from "./plan";
import { count, give, input, patch, race, racers, run, toGo, view } from "./testing";
import { ITEM_KINDS } from "./state";
import { TUNING } from "./tuning";

const harbour = TrackGeometry.build(HARBOUR_LIGHTS);

/** Steps until something is hit (up to three seconds), and says what. */
function untilHit(r: ReturnType<typeof race>) {
  for (let i = 0; i < 180; i++) {
    const hit = run(r, 1).find((e) => e.type === "hit");
    if (hit) return hit;
  }
  return undefined;
}

/** A press of the item button: the count goes up by one. */
const press = (n: number, over: Partial<DriveInput> = {}): DriveInput => input({ itemPresses: n, ...over });

describe("item boxes", () => {
  it("are five across the road at each row, and come back after 3 s", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const boxes = r.view().things.filter((t) => t.kind === "box");
    expect(boxes).toHaveLength(HARBOUR_LIGHTS.itemRows.length * 5);
    expect(new Set(boxes.map((b) => b.id)).size).toBe(boxes.length);
    // The first row, ten per cent of the way round, spans most of the road.
    const row = boxes.slice(0, 5).map((b) => harbour.project(b.x, b.z).offset);
    expect(Math.min(...row)).toBeLessThan(-4);
    expect(Math.max(...row)).toBeGreaterThan(4);
    expect(Math.min(...row.map(Math.abs))).toBeCloseTo(0, 1);
  });

  it("give an item after a second's roulette, hide while taken, and show again", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    const events = [];
    let taken = -1;
    for (let i = 0; i < 60 * 14 && taken < 0; i++) {
      events.push(...run(r, 1, () => input({ throttle: 1 })));
      if (view(r).rolling) taken = i;
    }
    expect(taken).toBeGreaterThan(0);
    const pickup = events.find((e) => e.type === "pickup");
    expect(pickup).toMatchObject({ type: "pickup", kart: 0 });
    expect(view(r).item).toBeNull();
    // The box it took is gone; so is a neighbour it clipped in the same breath (every kart breaks what it touches).
    const gone = r.view().things.filter((t) => t.kind === "box" && !t.active).length;
    expect(gone).toBeGreaterThanOrEqual(1);
    expect(gone).toBeLessThanOrEqual(2);
    // About a second later the roulette stops on what the pickup said.
    run(r, 50, () => input({ throttle: 1 }));
    expect(view(r).rolling).toBe(true);
    run(r, 15, () => input({ throttle: 1 }));
    expect(view(r).rolling).toBe(false);
    if (pickup?.type === "pickup") expect(view(r).item).toBe(pickup.item);
    expect(view(r).itemUses).toBe(pickup?.type === "pickup" && pickup.item === "nitro3" ? 3 : 1);
    // Three seconds after being taken the box is back.
    run(r, 120, () => input({ throttle: 1 }));
    expect(r.view().things.filter((t) => t.kind === "box" && !t.active)).toHaveLength(0);
  });

  it("are given by place: slicks and pucks to the leader, nitros and seekers to the back", () => {
    const odds = (place: number) => {
      const weights = itemOdds(place, 8);
      return { nitro: weights[0]!, nitro3: weights[1]!, puck: weights[2]!, seeker: weights[3]!, slick: weights[4]! };
    };
    expect(ITEM_KINDS.slice(0, 5)).toEqual(["nitro", "nitro3", "puck", "seeker", "slick"]);
    expect(odds(1).seeker).toBe(0);
    expect(odds(8).slick).toBe(0);
    expect(odds(1).slick + odds(1).puck).toBeGreaterThan(odds(8).slick + odds(8).puck);
    expect(odds(8).nitro + odds(8).nitro3 + odds(8).seeker).toBeGreaterThan(odds(1).nitro + odds(1).nitro3 + odds(1).seeker);
    // Between, a blend; and a lone kart is the leader.
    expect(odds(4).seeker).toBeGreaterThan(0);
    expect(odds(4).seeker).toBeLessThan(odds(8).seeker);
    expect(itemOdds(1, 1)).toEqual(itemOdds(1, 8));
  });
});

describe("driving through the boxes", () => {
  /**
   * Puts kart 0 8 m before `box`, heading straight along the box's heading on the line that passes `edge` metres to the side of the
   * box's middle (the kart's right is +), empty-handed, at 22 m/s, and lets it drive on for 0.8 s.
   */
  function driveThrough(r: ReturnType<typeof race>, track: (typeof TRACKS)[number], box: ReturnType<typeof planFor>["boxes"][number], edge: number) {
    const plan = planFor(track);
    const h = box.heading;
    const forward = [Math.sin(h), Math.cos(h)] as const;
    const right = [-Math.cos(h), Math.sin(h)] as const;
    const x = box.x + right[0] * edge - forward[0] * 8;
    const z = box.z + right[1] * edge - forward[1] * 8;
    const where = plan.geo.project(x, z);
    // Every box is back (a box that was just taken stays hidden for three seconds).
    const snap = r.snapshot();
    snap.b = [];
    r.restore(JSON.parse(JSON.stringify(snap)));
    patch(r, 0, { x, z, s: where.s, offset: where.offset, progress: where.s, heading: h, vx: forward[0] * 22, vz: forward[1] * 22, item: -1, uses: 0, roll: 0, rolled: -1 });
    return run(r, 48, () => input({ throttle: 1 }));
  }

  it("takes every box of every row on every track: through its middle, and with a wheel on its edge", () => {
    // The kart is 2.3 m wide with its wheels and the cube 1.6 m: a wheel touches the cube's side 1.96 m from the kart's middle.
    for (const track of TRACKS) {
      const plan = planFor(track);
      const r = race(track, racers(1, 0));
      toGo(r);
      expect(plan.boxes.length).toBeGreaterThan(0);
      const perRow = TUNING.items.boxesPerRow;
      plan.boxes.forEach((box, i) => {
        // Through its middle; and, for the two at the ends of a row (which have no neighbour on that side), with a wheel on the outer edge.
        const k = i % perRow;
        const row = plan.boxes.slice(i - k, i - k + perRow);
        const outward = Math.sign((box.x - row[perRow - 1 - k]!.x) * -Math.cos(box.heading) + (box.z - row[perRow - 1 - k]!.z) * Math.sin(box.heading));
        const passes = k === 0 || k === perRow - 1 ? [0, 1.9 * outward] : [0];
        for (const edge of passes) {
          const taken = driveThrough(r, track, box, edge).filter((e) => e.type === "pickup");
          expect(taken, `${track.id} box ${i} at ${edge}`).toHaveLength(1);
          expect(taken[0]).toMatchObject({ kart: 0 });
          expect(r.view().things.find((t) => t.kind === "box" && t.id === i)?.active, `${track.id} box ${i} at ${edge} is hidden`).toBe(false);
        }
      });
    }
  });

  it("is not a magnet: a kart passing 3 m outside the end of a row takes nothing", () => {
    const plan = planFor(HARBOUR_LIGHTS);
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    const perRow = TUNING.items.boxesPerRow;
    for (let row = 0; row < plan.boxes.length / perRow; row++) {
      const first = plan.boxes[row * perRow]!;
      const last = plan.boxes[row * perRow + perRow - 1]!;
      // "Outside" is away from the row's middle; the kart's right is (-cos h, sin h).
      const side = (box: typeof first, other: typeof first): number => Math.sign((box.x - other.x) * -Math.cos(box.heading) + (box.z - other.z) * Math.sin(box.heading));
      expect(count(driveThrough(r, HARBOUR_LIGHTS, first, 3 * side(first, last)), "pickup")).toBe(0);
      expect(count(driveThrough(r, HARBOUR_LIGHTS, last, 3 * side(last, first)), "pickup")).toBe(0);
    }
  });

  it("is a radius that covers the drawn cube: its corner and a kart's wheel", () => {
    // The cube is 1.6 m (render/world/boxes.ts BOX_SIZE); a corner of it reaches 1.13 m, the kart's tyres are 1.16 m out.
    expect(TUNING.items.pickupRadius).toBeGreaterThanOrEqual(1.6 / Math.SQRT2 + 1.16 - 0.01);
    // And not so wide that it becomes a magnet.
    expect(TUNING.items.pickupRadius).toBeLessThan(2.6);
  });
});

describe("nitro", () => {
  it("is a burst of speed, now", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    run(r, 240, () => input({ throttle: 1 }));
    give(r, 0, "nitro");
    const events = run(r, 1, () => press(1, { throttle: 1 }));
    expect(events.map((e) => e.type)).toEqual(["use", "boost"]);
    expect(events[1]).toMatchObject({ source: "nitro", kart: 0 });
    expect(view(r).item).toBeNull();
    expect(view(r).boost).toBeGreaterThan(1.45);
    run(r, 60, () => press(1, { throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(28);
    expect(view(r).speed).toBeLessThanOrEqual(24 * 1.35 + 0.01);
    run(r, 240, () => press(1, { throttle: 1 }));
    expect(view(r).boost).toBe(0);
    expect(view(r).speed).toBeLessThanOrEqual(24.01);
  });

  it("is used one press at a time when it is three", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    give(r, 0, "nitro3");
    expect(view(r).itemUses).toBe(3);
    for (let n = 1; n <= 3; n++) {
      const events = run(r, 1, () => press(n, { throttle: 1 }));
      expect(count(events, "use")).toBe(1);
      expect(view(r).itemUses).toBe(3 - n);
      run(r, 20, () => press(n, { throttle: 1 }));
    }
    expect(view(r).item).toBeNull();
  });

  it("does nothing while the roulette turns or with no item, and a press is never counted twice", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    expect(count(run(r, 5, () => press(1)), "use")).toBe(0);
    give(r, 0, "nitro3");
    // The same count again and again is one press only.
    const events = run(r, 30, () => press(2));
    expect(count(events, "use")).toBe(1);
    expect(view(r).itemUses).toBe(2);
  });
});

describe("pucks", () => {
  it("fly straight and spin out the kart in front", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    // Kart 2 is on the same side of the road as kart 0, a few metres behind it.
    give(r, 2, "puck");
    const used = run(r, 1, () => new Map([[2, press(1)]]));
    expect(used.find((e) => e.type === "use")).toMatchObject({ kart: 2, item: "puck" });
    expect(r.view().things.some((t) => t.kind === "puck")).toBe(true);
    const hit = untilHit(r);
    expect(hit).toMatchObject({ kart: 0, by: 2, cause: "puck" });
    expect(view(r, 0).spin).toBeGreaterThan(1);
    expect(view(r, 2).spin).toBe(0);
    expect(r.view().things.some((t) => t.kind === "puck")).toBe(false);
  });

  it("spin the hit kart for 1.2 s, cut its speed to a fifth and end its drift and boost", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    patch(r, 0, { vz: 20, boost: 60, drift: 1, level: 1, charge: 70 });
    give(r, 2, "puck");
    run(r, 1, () => new Map([[2, press(1)]]));
    untilHit(r);
    const k = view(r, 0);
    expect(k.spin).toBeGreaterThan(1.1);
    expect(k.spin).toBeLessThanOrEqual(1.2);
    expect(k.speed).toBeLessThan(6);
    expect(k.drift).toBe(0);
    expect(k.boost).toBe(0);
    run(r, 80);
    expect(view(r, 0).spin).toBe(0);
  });

  it("bounce off the barriers and, after half a second, spin out their own driver", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    // Pointing at the right-hand barrier.
    patch(r, 0, { heading: -Math.PI / 2 });
    give(r, 0, "puck");
    const events = run(r, 1, () => press(1));
    expect(count(events, "use")).toBe(1);
    const useTick = events[0]!.tick;
    let bounced = false;
    let hit: (typeof events)[number] | undefined;
    for (let i = 0; i < 90 && !hit; i++) {
      const more = run(r, 1);
      const puck = r.view().things.find((t) => t.kind === "puck");
      if (puck) {
        const half = HARBOUR_LIGHTS.width / 2 + 6;
        expect(Math.abs(harbour.project(puck.x, puck.z).offset)).toBeLessThanOrEqual(half);
        if (puck.heading > 0) bounced = true;
      }
      hit = more.find((e) => e.type === "hit");
    }
    expect(bounced).toBe(true);
    // Its own puck: the event says so, for the picture's "Oops.".
    expect(hit).toMatchObject({ kart: 0, by: 0, cause: "puck", own: true });
    expect(hit!.tick - useTick).toBeGreaterThanOrEqual(30);
  });

  it("do not hit their own driver straight away", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    give(r, 0, "puck");
    run(r, 1, () => press(1));
    const events = run(r, 25);
    expect(count(events, "hit")).toBe(0);
  });

  it("die after six seconds", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    // Aimed down the straight, away from everything.
    patch(r, 0, { heading: Math.PI, s: 0 });
    give(r, 0, "puck");
    run(r, 1, () => press(1));
    run(r, 60 * 5);
    expect(r.view().things.filter((t) => t.kind === "puck").length).toBeLessThanOrEqual(1);
    run(r, 70);
    expect(r.view().things.some((t) => t.kind === "puck")).toBe(false);
  });
});

describe("seekers", () => {
  it("follow the track to the kart one place ahead", () => {
    const r = race(HARBOUR_LIGHTS, racers(2, 0));
    toGo(r);
    // Kart 0 is leading, well up the straight; kart 1 is second and fires.
    patch(r, 0, { x: 0, z: 70, s: 70, progress: 70, offset: 0 });
    expect(view(r, 0).place).toBe(1);
    expect(view(r, 1).place).toBe(2);
    give(r, 1, "seeker");
    run(r, 1, () => new Map([[1, press(1)]]));
    expect(r.view().things.some((t) => t.kind === "seeker")).toBe(true);
    const events = run(r, 180);
    expect(events.find((e) => e.type === "hit")).toMatchObject({ kart: 0, by: 1, cause: "seeker" });
    expect(r.view().things.some((t) => t.kind === "seeker")).toBe(false);
  });

  it("follow the road round, not across the barrier, to a kart on the next finger of the palm island", () => {
    const geo = planFor(FIVE_FINGER_CIRCUIT).geo;
    // A place where the road comes back within 28 m of itself (within a seeker's 30 m), a long way round: the next finger.
    let from = -1;
    let to = -1;
    for (let a = 0; a < geo.length && from < 0; a += 2) {
      for (let b = 0; b < geo.length; b += 2) {
        const p = geo.point(a);
        const q = geo.point(b);
        const along = geo.delta(a, b);
        if (along > 80 && Math.hypot(p.x - q.x, p.z - q.z) < 28) {
          from = a;
          to = b;
          break;
        }
      }
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const r = race(FIVE_FINGER_CIRCUIT, racers(2, 0));
    toGo(r);
    const put = (id: number, s: number) => {
      const p = geo.point(s);
      patch(r, id, { x: p.x, z: p.z, s, offset: 0, progress: s, heading: geo.heading(s), vx: 0, vz: 0 });
    };
    put(0, to);
    put(1, from);
    expect(view(r, 0).place).toBe(1);
    give(r, 1, "seeker");
    run(r, 1, () => new Map([[1, press(1)]]));
    const startS = from;
    run(r, 45);
    const seeker = r.view().things.find((t) => t.kind === "seeker")!;
    expect(seeker).toBeDefined();
    // Three quarters of a second at 36 m/s: on its way round the road, not stuck at the barrier between the fingers.
    expect(geo.delta(startS, geo.project(seeker.x, seeker.z, startS + 20).s)).toBeGreaterThan(20);
  });
});

describe("slicks", () => {
  it("lie where they are dropped, spin whoever drives through, and are used up", () => {
    const r = race(HARBOUR_LIGHTS, racers(3, 0));
    toGo(r);
    // Kart 0 drops one behind it; kart 2, on the same side of the road, drives through it.
    give(r, 0, "slick");
    const dropped = run(r, 1, () => press(1));
    expect(dropped.find((e) => e.type === "use")).toMatchObject({ kart: 0, item: "slick" });
    const slick = r.view().things.find((t) => t.kind === "slick")!;
    expect(slick).toBeDefined();
    expect(Math.hypot(slick.x - view(r, 0).x, slick.z - view(r, 0).z)).toBeCloseTo(2.5, 0);
    const events = run(r, 90, () => new Map([[2, input({ throttle: 1 })]]));
    const hit = events.find((e) => e.type === "hit");
    expect(hit).toMatchObject({ kart: 2, by: 0, cause: "slick" });
    // Someone else's slick is no "Oops.": the flag is left out.
    expect(hit && "own" in hit).toBe(false);
    expect(r.view().things.some((t) => t.kind === "slick")).toBe(false);
    expect(view(r, 0).spin).toBe(0);
  });

  it("do not spin the kart that dropped them as it drives off", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    run(r, 120, () => input({ throttle: 1 }));
    give(r, 0, "slick");
    const events = run(r, 120, () => press(1, { throttle: 1 }));
    expect(count(events, "hit")).toBe(0);
  });

  it("number at most twelve, the oldest going", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    for (let n = 1; n <= 14; n++) {
      give(r, 0, "slick");
      run(r, 1, () => press(n));
    }
    const slicks = r.view().things.filter((t) => t.kind === "slick");
    expect(slicks).toHaveLength(12);
    // The first two are gone.
    expect(Math.min(...slicks.map((s) => s.id))).toBeGreaterThan(HARBOUR_LIGHTS.itemRows.length * 5 + 1);
  });
});

describe("a kart that has finished", () => {
  it("drops what it held and takes nothing more, so its lap of honour hurts no one still racing", () => {
    // Two people: the race goes on after the first is home.
    const r = race(HARBOUR_LIGHTS, racers(2, 0), { laps: 1 });
    toGo(r);
    const length = harbour.length;
    const p = harbour.point(length - 1, -3);
    const h = harbour.heading(length - 1);
    patch(r, 0, { x: p.x, z: p.z, s: length - 1, offset: -3, progress: length - 1, heading: h, vx: Math.sin(h) * 20, vz: Math.cos(h) * 20, lapStart: 0 });
    give(r, 0, "puck3");
    const finished = run(r, 10, () => input({ throttle: 1 }));
    expect(finished.find((e) => e.type === "finish")).toMatchObject({ kart: 0, place: 1 });
    expect(view(r, 0).item).toBeNull();
    // Through a box: it breaks, and gives nothing.
    const site = planFor(HARBOUR_LIGHTS).boxes[0]!;
    patch(r, 0, { x: site.x, z: site.z, s: site.s, offset: site.offset, vx: 0, vz: 0 });
    const events = run(r, 2 * 60);
    expect(events.find((e) => e.type === "box")).toMatchObject({ kart: 0 });
    expect(count(events, "pickup", 0)).toBe(0);
    expect(count(events, "use", 0)).toBe(0);
    expect(view(r, 0).item).toBeNull();
  });
});

describe("a box driven through with full hands", () => {
  it("still breaks, gives nothing, and says so", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    const events: RaceEvent[] = [];
    // Drive until the first item arrives and is held, then on through the next row.
    for (let i = 0; i < 60 * 40 && !events.some((e) => e.type === "box"); i++) {
      events.push(...run(r, 1, () => input({ throttle: 1 })));
    }
    const box = events.find((e) => e.type === "box");
    expect(box).toMatchObject({ type: "box", kart: 0 });
  });
});
