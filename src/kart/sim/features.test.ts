/**
 * The track's features in the sim: ramps and tricks, open edges and the rescue
 * drone, gaps, ice, mud, sand, boost strips, hazards, verges and the cuts over
 * them, and the bots that deal with all of it. Each on a plain stadium track
 * built here, so the numbers do not depend on a real track's data.
 */
import { describe, expect, it } from "vitest";
import { TICK_HZ, type DriveInput, type RaceEvent, type TrackDef } from "../contract";
import { rampHeight, RAMP_HEIGHT, RAMP_LENGTH } from "../render/world/features";
import { TrackGeometry } from "../track/geometry";
import { CANYON_RUN, TRACKS, trackById } from "../track/tracks";
import { GO_TICK } from "./kart";
import { planFor } from "./plan";
import type { SimRace } from "./race";
import { KART_AT } from "./snapshot";
import { wedgeAt } from "./terrain";
import { count, give, input, patch, race, racers, run, toGo, view } from "./testing";

/**
 * Two 400 m straights joined by half-circles of 100 m radius, going round to
 * the left, 1,430 m in all. The first straight runs from the start line, the
 * second comes back at 200 m across; `features` gives the track's features,
 * placing them by metres along the lap.
 */
function stadium(features: (f: (metres: number) => number) => Partial<TrackDef> = () => ({})): TrackDef {
  const points: { x: number; z: number }[] = [];
  for (let z = 0; z < 400; z += 100) points.push({ x: 0, z });
  for (let degrees = 180; degrees > 0; degrees -= 30) points.push({ x: 100 + 100 * Math.cos((degrees * Math.PI) / 180), z: 400 + 100 * Math.sin((degrees * Math.PI) / 180) });
  for (let z = 400; z > 0; z -= 100) points.push({ x: 200, z });
  for (let degrees = 0; degrees > -180; degrees -= 30) points.push({ x: 100 + 100 * Math.cos((degrees * Math.PI) / 180), z: 100 * Math.sin((degrees * Math.PI) / 180) });
  const base: TrackDef = { id: "stadium", name: "Stadium", theme: "meadow", laps: 2, width: 14, points, itemRows: [] };
  const length = TrackGeometry.build(base).length;
  return { ...base, ...features((metres) => metres / length) };
}

/** Puts kart 0 at `s` metres along the lap, `offset` right of the centre, going `speed` m/s along the road. */
function place(r: SimRace, track: TrackDef, s: number, offset: number, speed: number, extra: Partial<Record<keyof typeof KART_AT, number>> = {}, kart = 0): void {
  const geo = planFor(track).geo;
  const p = geo.point(s, offset);
  const h = geo.heading(s);
  patch(r, kart, { x: p.x, z: p.z, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, s, offset, progress: s, ...extra });
}

/** Steps kart 0 with the input `drive` gives for each tick until `until` says stop (or `limit` ticks), collecting the events. */
function drive(r: SimRace, drive: (tick: number) => Partial<DriveInput>, until: (events: RaceEvent[]) => boolean, limit = 900): RaceEvent[] {
  const events: RaceEvent[] = [];
  for (let i = 0; i < limit && !until(events); i++) events.push(...run(r, 1, () => input(drive(r.tick))));
  return events;
}

/** A wheel that keeps kart 0 on the middle of the road: toward the centre line 16 m ahead. */
function steerFor(r: SimRace, track: TrackDef): number {
  const geo = planFor(track).geo;
  const k = view(r);
  const aim = geo.point(geo.project(k.x, k.z).s + 16, 0);
  const err = Math.atan2(aim.x - k.x, aim.z - k.z) - k.heading;
  return Math.max(-1, Math.min(1, -Math.atan2(Math.sin(err), Math.cos(err)) * 2));
}

const first = <T extends RaceEvent["type"]>(events: RaceEvent[], type: T): Extract<RaceEvent, { type: T }> | undefined => events.find((e) => e.type === type) as Extract<RaceEvent, { type: T }> | undefined;

describe("ramps", () => {
  const track = stadium((f) => ({ ramps: [{ at: f(300) }] }));

  it("throw a kart that crosses the lip at speed into the air for about a second, and set it down again at speed", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 230, 0, 24);
    let apex = 0;
    const events = drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "land"), 500);
    // Re-run for the apex: the same race again, watching the height.
    const again = race(track, racers(1, 0));
    toGo(again);
    place(again, track, 230, 0, 24);
    for (let i = 0; i < 300; i++) {
      run(again, 1, () => input({ throttle: 1 }));
      apex = Math.max(apex, view(again).hop);
    }
    const jump = first(events, "jump")!;
    const land = first(events, "land")!;
    expect(jump).toBeDefined();
    expect(land).toBeDefined();
    const airborne = (land.tick - jump.tick) / TICK_HZ;
    expect(airborne).toBeGreaterThan(1.0);
    expect(airborne).toBeLessThan(1.35);
    // From the wedge's top (2.4 m) up another metre or so.
    expect(apex).toBeGreaterThan(3);
    expect(apex).toBeLessThan(4.2);
    expect(count(events, "jump")).toBe(1);
    expect(land.boost).toBe(false);
    // Down on the road, still going.
    expect(view(r).hop).toBe(0);
    expect(view(r).speed).toBeGreaterThan(22);
  });

  it("fly higher and farther the faster the kart crosses, and not at all under 9 m/s (a ramp is then only a bump)", () => {
    const flight = (speed: number) => {
      const r = race(track, racers(1, 0));
      toGo(r);
      place(r, track, 290, 0, speed);
      const events = drive(r, () => ({ throttle: speed > 9 ? 1 : 0 }), (e) => e.some((x) => x.type === "land") || r.tick > GO_TICK + 400, 400);
      const jump = first(events, "jump");
      const land = first(events, "land");
      return jump && land ? (land.tick - jump.tick) / TICK_HZ : 0;
    };
    expect(flight(4)).toBe(0);
    expect(flight(12)).toBeGreaterThan(0.5);
    expect(flight(12)).toBeLessThan(flight(20));
    expect(flight(20)).toBeLessThan(flight(26));
  });

  it("leave the lip from the top of the wedge the picture draws: the kart's height runs on from the wedge's without a step", () => {
    // The sim's wedge is the picture's, metre by metre, on every track.
    for (const t of TRACKS) {
      const geo = planFor(t).geo;
      const terrain = planFor(t).terrain;
      const shapes = (t.ramps ?? []).map((ramp) => ({ lip: ramp.at * geo.length, length: RAMP_LENGTH, height: (RAMP_HEIGHT * (ramp.lift ?? 7)) / 7, trick: true }));
      for (const ramp of terrain.ramps) {
        for (let d = -2; d <= 18; d += 0.5) expect(wedgeAt(terrain, ramp.s - d), `${t.id} ${d} m before the lip`).toBeCloseTo(rampHeight(shapes, ramp.s - d, geo.length), 3);
      }
    }
    // Driven over: on the wedge the sim's own height is nil (the wedge is road), and from the lip the kart flies on from the wedge's top.
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 270, 0, 22);
    const terrain = planFor(track).terrain;
    let last = 0;
    let steepest = 0;
    let atLip = -1;
    for (let i = 0; i < 100; i++) {
      run(r, 1, () => input({ throttle: 1 }));
      const k = view(r);
      const s = planFor(track).geo.project(k.x, k.z).s;
      // What the picture stands the kart at: the wedge where it is, or its height in the air, whichever is more.
      const picture = Math.max(wedgeAt(terrain, s), k.hop);
      if (s < 300) expect(k.hop).toBe(0);
      else if (atLip < 0) atLip = k.hop;
      if (i > 0) steepest = Math.max(steepest, Math.abs(picture - last));
      last = picture;
    }
    expect(atLip).toBeGreaterThan(2.3);
    expect(atLip).toBeLessThan(2.6);
    // Never more than a tick's worth of climbing or flying between two ticks (22 m/s up a wedge of slope 0.2: 0.08 m).
    expect(steepest).toBeLessThan(0.15);
  });

  it("point a kart where it flies: one that slides into the lip lands going straight, its nose where it goes", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 299, 0, 24);
    // Drifting right into the lip, the nose 25° right of the way it goes, the wheel against the slide.
    const h = planFor(track).geo.heading(299);
    patch(r, 0, { heading: h - 0.44, drift: 1, prevDrift: 1 });
    // Then the wheel straight and the drift let go in the air.
    const events = drive(r, () => (view(r).hop > 0 ? { throttle: 1 } : { throttle: 1, steer: -1, drift: true }), (e) => e.some((x) => x.type === "land"), 200);
    expect(first(events, "jump")).toBeDefined();
    const k = view(r);
    const slip = Math.abs(((k.heading - k.course! + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(slip).toBeLessThan(0.05);
    // And it goes on along the road rather than veering off where its nose had pointed.
    const geo = planFor(track).geo;
    const offset = geo.project(view(r).x, view(r).z).offset;
    expect(Math.abs(offset)).toBeLessThan(3);
    run(r, 30, () => input({ throttle: 1 }));
    expect(Math.abs(geo.project(view(r).x, view(r).z).offset - offset)).toBeLessThan(0.5);
  });

  it("answer the wheel in the air: a kart that leaves the lip at an angle can steer itself back over the road", () => {
    const landing = (steer: number): number => {
      const r = race(track, racers(1, 0));
      toGo(r);
      // Crossing the lip 3 m right of the middle, 10° further right.
      place(r, track, 297, 3, 24);
      const h = planFor(track).geo.heading(297);
      patch(r, 0, { heading: h - 0.17, vx: Math.sin(h - 0.17) * 24, vz: Math.cos(h - 0.17) * 24 });
      drive(r, () => ({ throttle: 1, steer: view(r).hop > 0 ? steer : 0 }), (e) => e.some((x) => x.type === "land"), 200);
      const k = view(r);
      return planFor(track).geo.project(k.x, k.z).offset;
    };
    const held = landing(0);
    const steered = landing(-1);
    // Holding on, it comes down by the edge of the road; steered back, well inside it.
    expect(held).toBeGreaterThan(6);
    expect(steered).toBeLessThan(held - 3);
    expect(Math.abs(steered)).toBeLessThan(5);
  });

  it("drop a kart too slow to fly off the end of the wedge, down to the road", () => {
    const flat = stadium((f) => ({ ramps: [{ at: f(300) }] }));
    const r = race(flat, racers(1, 0));
    toGo(r);
    place(r, flat, 298, 0, 5);
    const events = drive(r, () => ({ throttle: 0 }), (e) => e.some((x) => x.type === "land"), 120);
    expect(count(events, "jump")).toBe(0);
    const land = first(events, "land")!;
    expect(land).toBeDefined();
    expect(land.boost).toBe(false);
    // 2.4 m down: about 0.6 s, a hard landing.
    expect(land.strength).toBeGreaterThan(0.5);
    expect(view(r).hop).toBe(0);
  });

  it("turn the hop gesture in the air into a trick that boosts on landing, once", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 230, 0, 24);
    let presses = 0;
    let trickSeen = 0;
    const events = drive(
      r,
      () => {
        const v = view(r);
        trickSeen = Math.max(trickSeen, v.trick);
        // Press, let go, press again (still only one trick), once up in the air.
        const air = v.hop > 1.1;
        if (air && presses < 3) {
          presses++;
          return { throttle: 1, drift: presses % 2 === 1 };
        }
        return { throttle: 1 };
      },
      (e) => e.some((x) => x.type === "land"),
      500,
    );
    expect(count(events, "trick")).toBe(1);
    expect(trickSeen).toBeGreaterThan(0.2);
    const land = first(events, "land")!;
    expect(land.boost).toBe(true);
    expect(view(r).boost).toBeGreaterThan(0.7);
    expect(view(r).boost).toBeLessThanOrEqual(0.8);
    expect(view(r).trick).toBe(0);
  });

  it("give no boost for a ramp that allows no trick, nor for flying without one", () => {
    const plain = stadium((f) => ({ ramps: [{ at: f(300), trick: false }] }));
    for (const [t, press] of [[plain, true], [track, false]] as const) {
      const r = race(t, racers(1, 0));
      toGo(r);
      place(r, t, 230, 0, 24);
      const events = drive(r, () => ({ throttle: 1, drift: press && view(r).hop > 1.1 && view(r).trick === 0 }), (e) => e.some((x) => x.type === "land"), 500);
      expect(count(events, "trick")).toBe(0);
      expect(first(events, "land")!.boost).toBe(false);
      expect(view(r).boost).toBe(0);
    }
  });
});

describe("shaking the wheel", () => {
  const track = stadium((f) => ({ ramps: [{ at: f(300) }] }));

  /** Kart 0 from 230 m at 24 m/s over the ramp, its shake count going up by one at each tick `shakeAt` says. */
  function over(shakeAt: (r: SimRace) => boolean, by = 1): { events: RaceEvent[]; apex: number; landedAt: number } {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 230, 0, 24);
    let shakes = 0;
    let apex = 0;
    const events = drive(
      r,
      () => {
        if (shakeAt(r)) shakes += by;
        apex = Math.max(apex, view(r).hop);
        return { throttle: 1, shakes };
      },
      (e) => e.some((x) => x.type === "land"),
      400,
    );
    const k = view(r);
    return { events, apex, landedAt: planFor(track).geo.project(k.x, k.z).s - 300 };
  }
  const sAt = (r: SimRace): number => planFor(track).geo.project(view(r).x, view(r).z).s;

  it("is a trick in the air: the kart twirls and boosts on landing", () => {
    let done = false;
    let high = 0;
    // On the way down, past the top of the arc.
    const { events } = over((r) => {
      high = Math.max(high, view(r).hop);
      if (done || high < 3.3 || view(r).hop > high - 0.3) return false;
      done = true;
      return true;
    });
    expect(count(events, "trick")).toBe(1);
    expect(first(events, "trick")!.kick).toBeUndefined();
    expect(first(events, "land")!.boost).toBe(true);
  });

  it("does nothing on the road, however much the wheel is shaken", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 100, 0, 24);
    let shakes = 0;
    const events = run(r, 120, () => input({ throttle: 1, shakes: ++shakes }));
    expect(count(events, "trick")).toBe(0);
    expect(view(r).boost).toBe(0);
    expect(view(r).trick).toBe(0);
  });

  it("right at the lip kicks the jump higher and further, and boosts longer on landing; well before, it is only a shake on the road", () => {
    const plain = over(() => false);
    let done = false;
    // About a tenth of a second before the lip.
    const kicked = over((r) => {
      if (done || sAt(r) < 297.5) return false;
      done = true;
      return true;
    });
    const kick = first(kicked.events, "trick")!;
    expect(kick).toBeDefined();
    expect(kick.kick).toBe(true);
    expect(kicked.apex).toBeGreaterThan(plain.apex + 0.1);
    expect(kicked.landedAt).toBeGreaterThan(plain.landedAt + 3);
    expect(first(kicked.events, "land")!.boost).toBe(true);
    // And just after the lip, as well.
    done = false;
    const after = over((r) => {
      if (done || sAt(r) < 302) return false;
      done = true;
      return true;
    });
    expect(first(after.events, "trick")!.kick).toBe(true);
    // Shaken 1.5 s before the lip: a trick only once in the air.
    done = false;
    const early = over((r) => {
      if (done || sAt(r) < 265) return false;
      done = true;
      return true;
    });
    expect(count(early.events, "trick")).toBe(0);
  });

  it("is counted, not seen: a count sent again is no new shake, and one that jumped is one shake", () => {
    let calls = 0;
    // The same count every tick from mid-air on: one trick. A count going up by three at once: one trick too.
    const { events } = over((r) => view(r).hop > 2 && calls++ === 0);
    expect(count(events, "trick")).toBe(1);
    calls = 0;
    const jumped = over((r) => view(r).hop > 2 && calls++ === 0, 3);
    expect(count(jumped.events, "trick")).toBe(1);
  });
});

describe("crests and hills", () => {
  /** The stadium with a sharp crest 2.5 m high at 180 m along its first straight. */
  const crest = (() => {
    const def = stadium();
    const points = def.points.filter((p) => !(p.x === 0 && p.z > 0 && p.z < 400));
    points.splice(1, 0, { x: 0, z: 100 }, { x: 0, z: 160 }, { x: 0, z: 180, y: 2.5 }, { x: 0, z: 200 }, { x: 0, z: 300 });
    return { ...def, id: "crest", points };
  })();
  /** The stadium climbing 30 m up its first straight and coming down the second: 10% each way. */
  const hill = (() => {
    const def = stadium();
    const points = def.points.map((p) => {
      if (p.x === 0 && p.z >= 0 && p.z <= 300) return { ...p, y: p.z / 10 };
      if (p.x === 200 && p.z >= 100 && p.z <= 400) return { ...p, y: (p.z - 100) / 10 };
      if (p.z > 300) return { ...p, y: 30 };
      return p;
    });
    return { ...def, id: "hill", points };
  })();

  it("throw a kart that takes a crest fast into a short flight, and leave a slow one on the road", () => {
    const flight = (speed: number) => {
      const r = race(crest, racers(1, 0));
      toGo(r);
      place(r, crest, 150, 0, speed, { boost: speed > 24 ? 600 : 0 });
      let apex = 0;
      const events = drive(
        r,
        () => {
          apex = Math.max(apex, view(r).hop);
          return { throttle: speed > 24 ? 1 : 0, steer: steerFor(r, crest) };
        },
        () => planFor(crest).geo.project(view(r).x, view(r).z).s > 260,
        400,
      );
      return { events, apex };
    };
    const slow = flight(14);
    expect(slow.apex).toBeLessThan(0.05);
    expect(count(slow.events, "jump")).toBe(0);
    const fast = flight(30);
    expect(fast.apex).toBeGreaterThan(0.3);
    expect(first(fast.events, "jump")!.crest).toBe(true);
    expect(count(fast.events, "land")).toBe(1);
    expect(count(fast.events, "fall")).toBe(0);
  });

  it("slow a kart climbing and let it gather speed coming down, and carry that speed on past the foot", () => {
    const at = (s: number, until: number) => {
      const r = race(hill, racers(1, 0));
      toGo(r);
      place(r, hill, s, 0, 24);
      drive(r, () => ({ throttle: 1, steer: steerFor(r, hill) }), () => planFor(hill).geo.project(view(r).x, view(r).z).s > until, 900);
      return view(r).speed;
    };
    const geo = planFor(hill).geo;
    // Up the first straight; down the second, which starts about 714 m along.
    const climbing = at(20, 280);
    expect(climbing).toBeLessThan(23.3);
    expect(climbing).toBeGreaterThan(21);
    const down = geo.project(200, 380).s;
    const descending = at(down, down + 270);
    expect(descending).toBeGreaterThan(25.2);
    // Just past the foot, still quicker than the flat's top speed.
    const foot = geo.project(200, 100).s;
    expect(at(down, foot + 12)).toBeGreaterThan(24.6);
  });
});

describe("the slipstream", () => {
  const track = stadium();

  it("charges a kart close behind another and flings it out with a boost; out of line it does nothing", () => {
    const behind = (offset: number) => {
      const r = race(track, racers(2, 0));
      toGo(r);
      place(r, track, 60, 0, 22);
      place(r, track, 53, offset, 22, {}, 1);
      const events = run(r, 110, () => new Map([[0, input({ throttle: 1 })], [1, input({ throttle: 1 })]]));
      return { events, draft: view(r, 1).draft ?? 0 };
    };
    const inLine = behind(0.3);
    const boost = inLine.events.find((e) => e.type === "boost");
    expect(boost).toMatchObject({ type: "boost", kart: 1, source: "draft" });
    // The leader gets nothing from it.
    expect(count(inLine.events, "boost", 0)).toBe(0);
    const aside = behind(4);
    expect(count(aside.events, "boost")).toBe(0);
    expect(aside.draft).toBe(0);
  });
});

describe("item boxes", () => {
  it("are flown over by a kart high in the air, and taken by one on the road", () => {
    const taken = (ramp: boolean) => {
      const t = stadium((f) => ({ ramps: ramp ? [{ at: f(300) }] : [], itemRows: [f(316)] }));
      const r = race(t, racers(1, 0));
      toGo(r);
      place(r, t, 270, 0, 24);
      const events = run(r, 150, () => input({ throttle: 1 }));
      return count(events, "pickup");
    };
    expect(taken(false)).toBe(1);
    expect(taken(true)).toBe(0);
  });
});

describe("open edges and the rescue drone", () => {
  const track = stadium((f) => ({ drops: [{ from: f(100), to: f(330), side: "left" }] }));

  /** Kart 0 drives off the left edge near 200 m with a puck in hand; returns the race and the events up to the moment it is set down. */
  function falling() {
    const r = race(track, racers(2, 0));
    toGo(r);
    place(r, track, 150, -5, 15);
    give(r, 0, "puck");
    const events = drive(r, () => ({ throttle: 1, steer: -0.25 }), (e) => e.some((x) => x.type === "fall"), 400);
    return { r, events };
  }

  it("lets a kart go over an edge that has no barrier, and says so", () => {
    const { events } = falling();
    expect(count(events, "fall")).toBe(1);
    expect(count(events, "wall")).toBe(0);
  });

  it("holds a kart for 2.5 s where it went over, then sets it down on the centre line about 15 m behind, standing still, facing forward", () => {
    const { r, events } = falling();
    const fell = first(events, "fall")!;
    const before = r.snapshot();
    const at = (before.k as number[][])[0]![KART_AT.s]!;
    expect(view(r).rescue).toBeGreaterThan(2.4);
    expect(view(r).rescue).toBeLessThanOrEqual(2.5);
    // It stays where it went over, nothing moving, for the whole rescue (the picture draws the fall and the drone).
    const over = view(r);
    const more: RaceEvent[] = [];
    for (let i = 0; i < 400 && !more.some((e) => e.type === "rescued"); i++) {
      more.push(...run(r, 1, () => input({ throttle: 1, steer: 1 })));
      if (!more.some((e) => e.type === "rescued")) {
        expect(view(r).rescue).toBeGreaterThan(0);
        expect(view(r).x).toBe(over.x);
        expect(view(r).z).toBe(over.z);
        expect(view(r).hop).toBe(0);
        expect(view(r).speed).toBe(0);
      }
    }
    const back = first(more, "rescued")!;
    expect(back.tick - fell.tick).toBe(TICK_HZ * 2.5);
    const k = view(r);
    const geo = planFor(track).geo;
    const p = geo.project(k.x, k.z);
    expect(k.rescue).toBe(0);
    expect(k.hop).toBe(0);
    expect(Math.abs(p.offset)).toBeLessThan(0.1);
    expect(geo.delta(p.s, at)).toBeCloseTo(15, 0);
    expect(k.speed).toBe(0);
    expect(Math.abs(k.heading - geo.heading(p.s))).toBeLessThan(0.01);
    // It kept its item, and the progress of the lap went back with it.
    expect(k.item).toBe("puck");
    const after = r.snapshot();
    expect((after.k as number[][])[0]![KART_AT.progress]!).toBeCloseTo(at - 15, 0);
    // And it can drive on.
    run(r, 120, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(8);
  });

  it("answers no input while it is carried, and touches no other kart", () => {
    const a = falling();
    const b = falling();
    for (let i = 0; i < 100; i++) {
      run(a.r, 1, () => input({ throttle: 1, steer: -1, brake: 0 }));
      run(b.r, 1, () => input({ throttle: 0, steer: 1, brake: 1 }));
    }
    expect(view(a.r).x).toBe(view(b.r).x);
    expect(view(a.r).z).toBe(view(b.r).z);
    // Another kart parked right on it is not pushed away.
    const k = view(a.r);
    patch(a.r, 1, { x: k.x, z: k.z, vx: 0, vz: 0 });
    const parked = view(a.r, 1);
    const events = run(a.r, 5, () => input({ throttle: 1 }));
    expect(count(events, "bump")).toBe(0);
    expect(Math.hypot(view(a.r, 1).x - parked.x, view(a.r, 1).z - parked.z)).toBeLessThan(0.05);
  });

  it("does not happen on the barrier side, or after the edge's end", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 150, 5, 15);
    const events = drive(r, () => ({ throttle: 1, steer: 0.3 }), () => false, 300);
    expect(count(events, "fall")).toBe(0);
    expect(count(events, "wall")).toBeGreaterThan(0);
    const late = race(track, racers(1, 0));
    toGo(late);
    place(late, track, 340, -5, 15);
    expect(count(drive(late, () => ({ throttle: 1, steer: -0.25 }), () => false, 300), "fall")).toBe(0);
  });
});

describe("a gap in the road", () => {
  const track = stadium((f) => ({ ramps: [{ at: f(300) }], drops: [{ from: f(301.5), to: f(315), side: "both", gap: true }] }));

  it("is crossed by a kart that jumps it fast enough", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 230, 0, 24);
    const events = drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "land" || x.type === "fall"), 500);
    expect(count(events, "fall")).toBe(0);
    expect(first(events, "land")).toBeDefined();
  });

  it("drops a kart that lands short of the far side, and puts it back a run-up before the gap", () => {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, 290, 0, 13);
    const events = drive(r, () => ({ throttle: 0 }), (e) => e.some((x) => x.type === "fall"), 500);
    expect(first(events, "jump")).toBeDefined();
    expect(count(events, "fall")).toBe(1);
    const more = drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "rescued"), 400);
    expect(first(more, "rescued")).toBeDefined();
    const geo = planFor(track).geo;
    const s = geo.project(view(r).x, view(r).z).s;
    // 48 m before the gap's start.
    expect(s).toBeGreaterThan(248);
    expect(s).toBeLessThan(259);
    // From there it gets up to speed and clears it.
    const again = drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "land" || x.type === "fall"), 600);
    expect(count(again, "fall")).toBe(0);
  });

  it("is jumped by a kart shoved over the lip by another, not fallen into", () => {
    const r = race(track, racers(2, 0));
    toGo(r);
    // Kart 0 just short of the lip; kart 1 right behind and faster, so the bump pushes kart 0 over the lip between its own steps.
    place(r, track, 299.55, 0, 22);
    place(r, track, 297.5, 0, 30, {}, 1);
    const events = run(r, 40, () => new Map([[0, input({ throttle: 1 })], [1, input({ throttle: 1 })]]));
    expect(count(events, "bump")).toBeGreaterThan(0);
    expect(count(events, "fall")).toBe(0);
    expect(count(events, "jump", 0)).toBe(1);
    expect(count(events, "jump", 1)).toBe(1);
  });

  it("drops a kart that drives into it without a ramp", () => {
    const flat = stadium((f) => ({ drops: [{ from: f(301.5), to: f(315), side: "both", gap: true }] }));
    const r = race(flat, racers(1, 0));
    toGo(r);
    place(r, flat, 280, 0, 8);
    const events = drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "fall"), 400);
    expect(count(events, "fall")).toBe(1);
  });
});

describe("the ground", () => {
  /** Kart 0 at `s` with `speed`, on `track`, driven by `drive` for `ticks`; returns the race. */
  function trial(track: TrackDef, s: number, speed: number, ticks: number, drive: Partial<DriveInput>, offset = 0) {
    const r = race(track, racers(1, 0));
    toGo(r);
    place(r, track, s, offset, speed);
    run(r, ticks, () => input(drive));
    return r;
  }
  /** The speed across the way the kart points: how much it is sliding. */
  const slide = (r: SimRace) => {
    const row = (r.snapshot().k as number[][])[0]!;
    const h = view(r).heading;
    return Math.abs(-row[KART_AT.vx]! * Math.cos(h) + row[KART_AT.vz]! * Math.sin(h));
  };

  it("makes a kart slide on ice, and brake and pull away slowly", () => {
    const road = stadium();
    const ice = stadium((f) => ({ surfaces: [{ from: f(40), to: f(380), kind: "ice" }] }));
    const turned = (t: TrackDef) => slide(trial(t, 60, 20, 40, { throttle: 1, steer: 0.6 }));
    expect(turned(ice)).toBeGreaterThan(turned(road) * 2.5);
    expect(turned(ice)).toBeGreaterThan(2);
    const braked = (t: TrackDef) => view(trial(t, 60, 20, 40, { brake: 1 })).speed;
    expect(braked(ice)).toBeGreaterThan(braked(road) + 8);
    const pulled = (t: TrackDef) => view(trial(t, 60, 0, 120, { throttle: 1 })).speed;
    expect(pulled(ice)).toBeLessThan(pulled(road) - 2);
    expect(view(trial(ice, 100, 15, 5, { throttle: 1 })).surface).toBe("ice");
    expect(view(trial(road, 100, 15, 5, { throttle: 1 })).surface).toBe("road");
    expect(view(trial(ice, 100, 15, 5, { throttle: 1 })).offroad).toBe(false);
  });

  it("holds a kart on mud to a crawl, and on sand to less than the grass", () => {
    const mud = stadium((f) => ({ surfaces: [{ from: f(40), to: f(380), kind: "mud" }] }));
    const r = trial(mud, 60, 20, 300, { throttle: 1 });
    expect(view(r).surface).toBe("mud");
    expect(view(r).speed).toBeLessThan(8.5);
    expect(view(r).speed).toBeGreaterThan(5);
    const sandy = stadium((f) => ({ verges: [{ from: f(40), to: f(380), side: "right", distance: 12, surface: "sand" }] }));
    const grassy = stadium();
    const off = (t: TrackDef) => trial(t, 60, 12, 300, { throttle: 1 }, 9.5);
    expect(view(off(sandy)).surface).toBe("sand");
    expect(view(off(grassy)).surface).toBe("grass");
    expect(view(off(sandy)).speed).toBeLessThan(view(off(grassy)).speed - 1);
    expect(view(off(sandy)).offroad).toBe(true);
    // A snow theme's beyond-the-road is snow without being told.
    const snowy: TrackDef = { ...stadium(), theme: "snow" };
    expect(view(off(snowy)).surface).toBe("snow");
  });

  it("keeps a kart on a boost strip boosted, and faster than the road's top speed, and says so once", () => {
    const strip = stadium((f) => ({ surfaces: [{ from: f(60), to: f(200), kind: "boost" }] }));
    const r = race(strip, racers(1, 0));
    toGo(r);
    place(r, strip, 100, 0, 24);
    const events = drive(r, () => ({ throttle: 1 }), () => false, 130);
    expect(view(r).surface).toBe("boost");
    expect(view(r).speed).toBeGreaterThan(28);
    expect(view(r).boost).toBeGreaterThan(0.3);
    expect(count(events.filter((e) => e.type === "boost" && e.source === "pad"), "boost")).toBe(1);
    // Off the end it runs out.
    run(r, 240, () => input({ throttle: 1 }));
    expect(view(r).boost).toBe(0);
    expect(view(r).speed).toBeLessThanOrEqual(24.01);
  });
});

describe("hazards", () => {
  /** A hazard that stays where it is, in the middle of the road: an orbit of no size. */
  const still = stadium((f) => ({ hazards: [{ kind: "rock", at: f(200), motion: "orbit", period: 5, radius: 2, span: 0.01 }] }));

  it("spin a kart that touches one, once, with a moment of peace after", () => {
    const r = race(still, racers(1, 0));
    toGo(r);
    place(r, still, 170, 0, 15);
    const events = drive(r, () => ({ throttle: 1 }), () => false, 60 * 6);
    const hits = events.filter((e) => e.type === "hazard");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ type: "hazard", kind: "rock", kart: 0 });
    // Spun out like a hit: the speed gone, and not hit again while it spins and for a while after.
    const gaps = hits.slice(1).map((h, i) => (h.tick - hits[i]!.tick) / TICK_HZ);
    for (const gap of gaps) expect(gap).toBeGreaterThan(2.7);
  });

  it("cut the speed to a fifth", () => {
    const r = race(still, racers(1, 0));
    toGo(r);
    place(r, still, 185, 0, 20);
    drive(r, () => ({ throttle: 1 }), (e) => e.some((x) => x.type === "hazard"), 200);
    expect(view(r).spin).toBeGreaterThan(1);
    expect(view(r).speed).toBeLessThan(6);
  });

  it("are flown over by a kart in the air", () => {
    const r = race(still, racers(1, 0));
    toGo(r);
    place(r, still, 185, 0, 20, { flight: 1, air: 2, vy: 0 });
    const events = drive(r, () => ({ throttle: 1 }), () => false, 30);
    expect(count(events, "hazard")).toBe(0);
  });

  it("pass through a kart that has just been set down by the drone", () => {
    const r = race(still, racers(1, 0));
    toGo(r);
    place(r, still, 199, 0, 0, { immune: 60 });
    const events = drive(r, () => ({ throttle: 0 }), () => false, 40);
    expect(count(events, "hazard")).toBe(0);
  });
});

describe("verges", () => {
  const wide = stadium((f) => ({ verges: [{ from: f(100), to: f(330), side: "right", distance: 20 }] }));
  const plain = stadium();

  /** Kart 0 aimed hard at the right-hand barrier at 200 m. */
  function aimedRight(t: TrackDef) {
    const r = race(t, racers(1, 0));
    toGo(r);
    const geo = planFor(t).geo;
    place(r, t, 200, 6, 14, { heading: geo.heading(200) - 1.2 });
    let farthest = 0;
    let walls = 0;
    for (let i = 0; i < 200; i++) {
      walls += count(run(r, 1, () => input({ throttle: 1 })), "wall");
      const k = view(r);
      farthest = Math.max(farthest, geo.project(k.x, k.z).offset);
    }
    return { farthest, walls };
  }

  it("move the barrier out on one side: a kart goes much further before it hits", () => {
    expect(aimedRight(plain).farthest).toBeLessThan(7 + 6 + 0.2);
    expect(aimedRight(plain).walls).toBeGreaterThan(0);
    expect(aimedRight(wide).farthest).toBeGreaterThan(7 + 15);
    expect(aimedRight(wide).farthest).toBeLessThan(7 + 20 + 0.2);
  });

  it("make a cut across the inside of a bend, and a bot with a Nitro and the nerve takes it", () => {
    const plan = planFor(CANYON_RUN);
    expect(plan.cuts.length).toBeGreaterThan(0);
    const cut = plan.cuts[0]!;
    expect(cut.len).toBeLessThan(40);
    const geo = plan.geo;
    const skipped = geo.wrap(cut.to - cut.from);
    // Straight along the cut under a boost: no barrier in the way, and the lap's progress jumps over the road it skipped.
    const r = race(CANYON_RUN, racers(1, 0));
    toGo(r);
    const entry = geo.project(cut.ex, cut.ez, cut.from);
    const heading = Math.atan2(cut.dx, cut.dz);
    patch(r, 0, { x: cut.ex, z: cut.ez, heading, vx: Math.sin(heading) * 18, vz: Math.cos(heading) * 18, s: entry.s, offset: entry.offset, progress: entry.s, boost: 60 });
    // Along the line until it reaches the road again (a kart goes on across it, so stop there).
    const events = drive(r, () => ({ throttle: 1 }), () => Math.hypot(view(r).x - cut.xx, view(r).z - cut.xz) < 3, Math.ceil((cut.len / 12) * TICK_HZ));
    expect(count(events, "wall")).toBe(0);
    const k = view(r);
    expect(Math.hypot(k.x - cut.xx, k.z - cut.xz)).toBeLessThan(6);
    const progress = (r.snapshot().k as number[][])[0]![KART_AT.progress]!;
    expect(progress - entry.s).toBeGreaterThan(skipped * 0.8);

    // The bot: sharp, with a Nitro, a way before the cut, against the same bot on the same track without the cut (it spends the Nitro on the road).
    const roadOnly: TrackDef = { ...CANYON_RUN, verges: undefined };
    const lap = (t: TrackDef, item: boolean, skill: number) => {
      const b = race(t, racers(0, 1, skill), { laps: 3 });
      toGo(b);
      const from = cut.from - 60;
      const p = geo.point(from, 0);
      const h = geo.heading(from);
      patch(b, 0, { x: p.x, z: p.z, heading: h, vx: Math.sin(h) * 20, vz: Math.cos(h) * 20, s: from, offset: 0, progress: from });
      if (item) give(b, 0, "nitro");
      let rough = 0;
      let ticks = 0;
      for (; ticks < 60 * 12; ticks++) {
        run(b, 1);
        const v = view(b);
        if (v.surface === "sand") rough++;
        if (geo.delta(geo.project(v.x, v.z).s, cut.to + 25) <= 0) break;
      }
      return { ticks, rough };
    };
    const takes = lap(CANYON_RUN, true, 1);
    const onRoad = lap(roadOnly, true, 1);
    const gentle = lap(CANYON_RUN, true, 0.4);
    expect(takes.rough).toBeGreaterThan(20);
    // Worth taking: a good half second over spending the Nitro on the road.
    expect(takes.ticks).toBeLessThan(onRoad.ticks - 25);
    expect(onRoad.rough).toBeLessThan(10);
    expect(gentle.rough).toBeLessThan(10);
  });
});

describe("snapshots and prediction", () => {
  const track = stadium((f) => ({
    ramps: [{ at: f(300) }],
    drops: [{ from: f(301.5), to: f(315), side: "both", gap: true }, { from: f(80), to: f(250), side: "left" }],
    surfaces: [{ from: f(40), to: f(110), kind: "ice" }],
  }));

  it("round-trip in the air and in the drone's hook: carrying on is the same as never having stopped", () => {
    for (const setup of [() => ({ s: 296, offset: 0, speed: 24 }), () => ({ s: 150, offset: -6, speed: 15 })]) {
      const make = () => {
        const r = race(track, racers(2, 0));
        toGo(r);
        const o = setup();
        place(r, track, o.s, o.offset, o.speed);
        return r;
      };
      const script = () => new Map<number, DriveInput>([[0, input({ throttle: 1, steer: -0.2 })]]);
      const a = make();
      run(a, 70, script);
      const b = make();
      run(b, 40, script);
      const snap = JSON.parse(JSON.stringify(b.snapshot()));
      const c = make();
      c.restore(snap);
      run(c, 30, script);
      run(b, 30, script);
      expect(c.snapshot()).toEqual(b.snapshot());
      expect(b.snapshot()).toEqual(a.snapshot());
    }
  });

  it("keep prediction equal to stepping for a lone kart through a jump, a fall, a rescue and the ice", () => {
    const stepped = race(track, racers(1, 0));
    const predicted = race(track, racers(1, 0));
    for (const r of [stepped, predicted]) {
      toGo(r);
      place(r, track, 60, 0, 22);
    }
    let sawAir = 0;
    let sawRescue = 0;
    let sawIce = 0;
    for (let i = 0; i < 60 * 20; i++) {
      // Slide left over the edge on the ice, be fetched back, then up the straight, the ramp and over.
      const t = i / 60;
      const given = input({ throttle: 1, steer: t > 1 && t < 2.5 ? -0.5 : 0, drift: i % 97 < 3 });
      stepped.step(new Map([[0, given]]));
      predicted.predict([0], new Map([[0, given]]));
      const s = view(stepped);
      const p = view(predicted);
      for (const key of ["x", "z", "y", "heading", "speed", "hop", "rescue", "trick", "boost", "spin", "surface", "offroad"] as const) expect(p[key], key).toBe(s[key]);
      if (s.hop > 1) sawAir++;
      if (s.rescue > 0) sawRescue++;
      if (s.surface === "ice") sawIce++;
    }
    expect(sawIce).toBeGreaterThan(10);
    expect(sawRescue).toBeGreaterThan(30);
    expect(sawAir).toBeGreaterThan(30);
  });
});

describe("on the busiest tracks", () => {
  it("eight karts step in well under a third of a millisecond, a snapshot stays under 3 KB, and the same seed replays the same race", () => {
    for (const track of ["glacier-pass", "volcano-rush", "starlight-ribbon"].map(trackById)) {
      const r = race(track, racers(0, 8, 0.7), { seed: 3 });
      run(r, 600);
      const count = 3000;
      const started = performance.now();
      for (let i = 0; i < count; i++) r.step(new Map());
      expect((performance.now() - started) / count, track.id).toBeLessThan(0.3);
      expect(JSON.stringify(r.snapshot()).length, track.id).toBeLessThan(3000);
      const again = race(track, racers(0, 8, 0.7), { seed: 3 });
      run(again, 600 + count);
      expect(again.snapshot(), track.id).toEqual(r.snapshot());
    }
  }, 60000);
});

describe("the bots", () => {
  it("never drive off an open edge: a lap of an all-open stadium with eight of them, on every skill", () => {
    const open = stadium((f) => ({ drops: [{ from: f(60), to: f(1340), side: "both" }], width: 16 } as Partial<TrackDef>));
    for (const skill of [1, 0.6, 0.2]) {
      const r = race(open, racers(0, 8, skill), { laps: 2, seed: 3 });
      let falls = 0;
      for (let i = 0; i < 60 * 150 && r.view().phase !== "finished"; i++) {
        r.step(new Map());
        falls += count(r.takeEvents(), "fall");
      }
      expect(falls, `skill ${skill}`).toBeLessThanOrEqual(1);
      expect(r.view().phase).toBe("finished");
    }
  }, 60000);

  it("take a ramp straight, clear its gap, and trick by skill", () => {
    const jump = stadium((f) => ({ ramps: [{ at: f(300) }], drops: [{ from: f(301.5), to: f(315), side: "both", gap: true }] }));
    const stats = (skill: number) => {
      const r = race(jump, racers(0, 8, skill), { laps: 3, seed: 5 });
      const events: RaceEvent[] = [];
      for (let i = 0; i < 60 * 150 && r.view().phase !== "finished"; i++) {
        r.step(new Map());
        events.push(...r.takeEvents());
      }
      return { jumps: count(events, "jump"), falls: count(events, "fall"), tricks: count(events, "trick") };
    };
    const sharp = stats(1);
    const gentle = stats(0);
    expect(sharp.jumps).toBeGreaterThanOrEqual(24);
    expect(sharp.falls).toBeLessThanOrEqual(1);
    expect(gentle.falls).toBeLessThanOrEqual(2);
    expect(sharp.tricks).toBe(sharp.jumps);
    expect(gentle.tricks).toBeLessThan(sharp.tricks);
  }, 60000);

  it("go round ice more slowly than the road, and round a patch of mud when there is room", () => {
    const pace = (t: TrackDef) => {
      const r = race(t, racers(0, 1, 1), { laps: 1 });
      for (let i = 0; i < 60 * 100 && r.view().phase !== "finished"; i++) r.step(new Map());
      return r.result()!.standings[0]!.time!;
    };
    const ice = stadium((f) => ({ surfaces: [{ from: f(100), to: f(300), kind: "ice" }] }));
    expect(pace(ice)).toBeGreaterThan(pace(stadium()) + 0.8);
    const mud = stadium((f) => ({ surfaces: [{ from: f(100), to: f(300), kind: "mud", offset: -3, width: 6 }] }));
    const r = race(mud, racers(0, 1, 1), { laps: 1 });
    let inMud = 0;
    for (let i = 0; i < 60 * 100 && r.view().phase !== "finished"; i++) {
      r.step(new Map());
      if (r.view().karts[0]!.surface === "mud") inMud++;
    }
    expect(inMud).toBeLessThan(5);
  }, 60000);
});
