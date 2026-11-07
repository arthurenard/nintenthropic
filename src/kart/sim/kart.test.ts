import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS as HARBOUR_AS_BUILT } from "../track/tracks";
import { GO_TICK } from "./kart";
import { ARENA, count, input, level, patch, race, racer, racers, run, toGo, view } from "./testing";

/** Harbour Lights with its bridges levelled: these tests drive its start straight as the flat road it was. */
const HARBOUR_LIGHTS = level(HARBOUR_AS_BUILT);
const harbour = TrackGeometry.build(HARBOUR_LIGHTS);

/** A lone player on the harbour's start straight, through the countdown. */
function solo() {
  const r = race(HARBOUR_LIGHTS, racers(1, 0));
  toGo(r);
  return r;
}

describe("driving", () => {
  it("reaches about 90% of top speed in three seconds, and top speed in the end", () => {
    const r = solo();
    run(r, 180, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(20.5);
    expect(view(r).speed).toBeLessThan(22.5);
    run(r, 300, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(23.5);
    expect(view(r).speed).toBeLessThanOrEqual(24);
  });

  it("coasts to a stop with nothing pressed", () => {
    const r = solo();
    run(r, 180, () => input({ throttle: 1 }));
    run(r, 60 * 12);
    expect(view(r).speed).toBeLessThan(0.1);
  });

  it("is slowed to about 11 m/s on the grass", () => {
    const r = solo();
    // Put the kart right of the road (the road is 16 m wide), pointing down the straight.
    patch(r, 0, { x: -9.5, offset: 9.5 });
    run(r, 60 * 5, () => input({ throttle: 1 }));
    expect(view(r).offroad).toBe(true);
    expect(view(r).speed).toBeGreaterThan(9);
    expect(view(r).speed).toBeLessThan(11.5);
  });

  it("turns the way the wheel does: right lowers the heading, and nothing at a standstill", () => {
    const r = solo();
    const before = view(r).heading;
    run(r, 30, () => input({ steer: 1 }));
    expect(view(r).heading).toBe(before);
    run(r, 120, () => input({ throttle: 1, steer: 0.4 }));
    expect(view(r).heading).toBeLessThan(before - 0.2);
    // A right turn takes the kart to the right of the track.
    expect(harbour.project(view(r).x, view(r).z).offset).toBeGreaterThan(0);
  });

  it("yaws about 2.2 rad/s at full lock at speed, a little less at the top", () => {
    const r = solo();
    run(r, 120, () => input({ throttle: 1 }));
    const h0 = view(r).heading;
    run(r, 3, () => input({ throttle: 1, steer: -1 }));
    const h1 = view(r).heading;
    // The wheel takes a few ticks to come across.
    expect(h1 - h0).toBeGreaterThan(0.01);
    run(r, 9, () => input({ throttle: 1, steer: -1 }));
    const h2 = view(r).heading;
    run(r, 6, () => input({ throttle: 1, steer: -1 }));
    const rate = (view(r).heading - h2) / (6 / 60);
    expect(rate).toBeGreaterThan(1.5);
    expect(rate).toBeLessThan(2.2);
  });
});

describe("inputs from the network", () => {
  it("that are not numbers are nothing", () => {
    const r = solo();
    const bad = input({ throttle: Number.NaN, steer: Number.POSITIVE_INFINITY, brake: Number.NaN, itemPresses: Number.NaN });
    run(r, 60, () => bad);
    run(r, 120, () => input({ throttle: 1, steer: Number.NaN }));
    const k = view(r);
    for (const key of ["x", "z", "heading", "speed", "steer"] as const) expect(Number.isFinite(k[key])).toBe(true);
    expect(k.speed).toBeGreaterThan(10);
    // Values out of range are held to it.
    run(r, 60, () => input({ throttle: 7, steer: -40, brake: -3 }));
    expect(Math.abs(view(r).steer)).toBeLessThanOrEqual(1);
  });
});

describe("barriers", () => {
  it("stop a kart 6 m beyond the edge, take the speed into them and a little of the rest, and say so", () => {
    const r = solo();
    run(r, 120, () => input({ throttle: 1 }));
    const events = [];
    let worst = 0;
    let fastest = 0;
    for (let i = 0; i < 400; i++) {
      events.push(...run(r, 1, () => input({ throttle: 1, steer: 0.12 })));
      const k = view(r);
      worst = Math.max(worst, Math.abs(harbour.project(k.x, k.z).offset));
      fastest = Math.max(fastest, k.speed);
    }
    expect(worst).toBeLessThanOrEqual(HARBOUR_LIGHTS.width / 2 + 6);
    const walls = events.filter((e) => e.type === "wall");
    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) if (wall.type === "wall") expect(wall.strength).toBeGreaterThan(0);
    expect(fastest).toBeGreaterThan(20);
  });

  /** Stands kart 0 at the right-hand barrier 60 m up the straight, turned `into` degrees toward it, going `speed`. */
  function atBarrier(into: number, speed: number) {
    const r = solo();
    const s = 60;
    const limit = harbour.at(s).width / 2 + 6 - 0.8;
    const p = harbour.point(s, limit);
    const h = harbour.heading(s) - (into * Math.PI) / 180;
    patch(r, 0, { x: p.x, z: p.z, s, offset: limit, progress: s, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed });
    return { r, limit };
  }

  it("let a kart brushing along them keep its speed: a scrape wears off 3 m/s a second, no more", () => {
    // Nose 5° into the barrier, on the grass beside it, flat out: it touches on every tick.
    const { r } = atBarrier(5, 10);
    let touching = 0;
    for (let i = 0; i < 60; i++) {
      run(r, 1, () => input({ throttle: 1 }));
      if (Math.abs(harbour.project(view(r).x, view(r).z).offset) > HARBOUR_LIGHTS.width / 2 + 5) touching++;
    }
    expect(touching).toBeGreaterThan(50);
    // A scrape takes a little speed each second, not a share of it each tick, so the kart keeps most of its speed.
    expect(view(r).speed).toBeGreaterThan(7);
  });

  it("never wedge a kart that met them head-on: the wheel brings it round, and it drives off", () => {
    for (const steer of [-1, 1]) {
      const { r, limit } = atBarrier(90, 0);
      run(r, 120, () => input({ throttle: 1, steer }));
      const k = view(r);
      expect(k.speed, `steer ${steer}`).toBeGreaterThan(3);
      expect(Math.abs(harbour.project(k.x, k.z).offset), `steer ${steer}`).toBeLessThan(limit - 0.5);
    }
    // With the wheel straight it stays put, nose to the barrier: the wheel is what frees it.
    const { r } = atBarrier(90, 0);
    run(r, 90, () => input({ throttle: 1 }));
    expect(Math.abs(view(r).speed)).toBeLessThan(0.5);
  });

  it("hold a kart that is shoved at them", () => {
    const r = solo();
    for (const side of [1, -1]) {
      patch(r, 0, { x: -side * 12, offset: side * 12, vx: -side * 25, vz: 0, heading: -side * Math.PI / 2 });
      run(r, 30, () => input());
      const k = view(r);
      expect(Math.abs(harbour.project(k.x, k.z).offset)).toBeLessThanOrEqual(HARBOUR_LIGHTS.width / 2 + 6);
    }
  });
});

describe("braking", () => {
  /** The speed each tick (after it) of `ticks` ticks of this input, from top speed on the straight. */
  function curve(drive: () => ReturnType<typeof input>, ticks: number): number[] {
    const r = solo();
    run(r, 360, () => input({ throttle: 1 }));
    const speeds: number[] = [];
    for (let i = 0; i < ticks; i++) {
      run(r, 1, drive);
      speeds.push(view(r).speed);
    }
    return speeds;
  }

  it("eases on as the brake is held, as a pedal does: a little at first, never most of the speed at once", () => {
    const v = curve(() => input({ brake: 1 }), 150);
    const top = 24;
    // After 0.2 s only a little is gone (21.1), 0.5 s about a third (15.2), 1 s three quarters (6.0).
    expect(v[11]!).toBeGreaterThan(20.4);
    expect(v[11]!).toBeLessThan(22);
    expect(v[29]!).toBeGreaterThan(13.8);
    expect(v[29]!).toBeLessThan(17);
    expect(v[59]!).toBeGreaterThan(4);
    expect(v[59]!).toBeLessThan(8.5);
    // No tick sheds more than 0.7 m/s: the old brake took 0.5 every tick from the first.
    for (let i = 1; i < v.length; i++) expect(v[i - 1]! - v[i]!).toBeLessThan(0.7);
    expect(v[0]!).toBeGreaterThan(top - 0.4);
  });

  it("takes about 1.5 to 2 s from top speed to a crawl, then backs up with no stop at zero, up to 7 m/s", () => {
    const v = curve(() => input({ brake: 1 }), 360);
    const crawl = v.findIndex((s) => s < 2);
    expect(crawl).toBeGreaterThan(70);
    expect(crawl).toBeLessThan(110);
    const zero = v.findIndex((s) => s <= 0);
    const reversing = v.findIndex((s) => s < -0.5);
    // It flows through zero: the speed at the crawl keeps falling at much the same rate, not held for a moment.
    expect(reversing - zero).toBeLessThan(12);
    expect(v[crawl]! - v[crawl + 6]!).toBeGreaterThan(0.5);
    expect(Math.min(...v)).toBeLessThan(-6.5);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(-7.001);
  });

  it("backs up from a standstill at once: no pedal build-up to wait for", () => {
    const r = solo();
    const w: number[] = [];
    for (let i = 0; i < 60; i++) {
      run(r, 1, () => input({ brake: 1 }));
      w.push(view(r).speed);
    }
    expect(w[14]!).toBeLessThan(-1.2);
    expect(w[59]!).toBeLessThan(-4);
    expect(w[59]!).toBeGreaterThan(-6.5);
  });

  it("is hardly felt in a flicker of open hands", () => {
    let n = 0;
    // Brake for 0.15 s, then let go and drive on.
    const v = curve(() => (n++ < 9 ? input({ brake: 1 }) : input({ throttle: 1 })), 30);
    expect(v[v.length - 1]!).toBeGreaterThan(22.3);
    n = 0;
    // The same, braking three times in a second.
    const w = curve(() => (n++ % 20 < 9 ? input({ brake: 1 }) : input({ throttle: 1 })), 60);
    expect(w[w.length - 1]!).toBeGreaterThan(19.5);
  });

  it("builds from where it was left: a brake tapped again a moment later bites a little harder", () => {
    let n = 0;
    const tapped = curve(() => (n++ % 30 < 15 ? input({ brake: 1 }) : input()), 60);
    n = 0;
    const once = curve(() => (n++ < 15 ? input({ brake: 1 }) : input()), 60);
    expect(tapped[59]!).toBeLessThan(once[59]! - 1);
  });

  it("blends with the throttle: both down settle about two thirds up, between the two", () => {
    const r = race(ARENA, racers(1, 0));
    toGo(r);
    run(r, 240, () => input({ throttle: 1, steer: 0.07 }));
    // The arena's road is a ring, so a gentle wheel keeps the kart on it.
    const both = () => input({ throttle: 1, brake: 1, steer: 0.07 });
    run(r, 240, both);
    const s = view(r).speed;
    expect(s).toBeGreaterThan(14);
    expect(s).toBeLessThan(19);
  });

  it("coasts with nothing pressed: it eases, a little at first, to a stop", () => {
    const v = curve(() => input(), 60);
    expect(v[11]!).toBeGreaterThan(22);
    expect(v[59]!).toBeGreaterThan(18);
    expect(v[59]!).toBeLessThan(v[11]!);
  });

  it("still steers while reversing, the way a car does", () => {
    const r = solo();
    run(r, 60, () => input({ brake: 1 }));
    expect(view(r).speed).toBeLessThan(-1);
    const before = view(r).heading;
    run(r, 60, () => input({ brake: 1, steer: 1 }));
    // Reversing with the wheel to the right swings the nose to the left (the heading goes up).
    expect(view(r).heading).toBeGreaterThan(before + 0.1);
  });

  it("lets go and drives off forward again", () => {
    const r = solo();
    run(r, 90, () => input({ brake: 1 }));
    expect(view(r).speed).toBeLessThan(-3);
    run(r, 120, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(10);
  });
});

describe("hop and drift", () => {
  /** On the open arena at speed, with the wheel turned. */
  function arena(): ReturnType<typeof race> {
    const r = race(ARENA, racers(1, 0));
    toGo(r);
    run(r, 180, () => input({ throttle: 1 }));
    return r;
  }
  const drift = (steer: number, held = true) => input({ throttle: 1, steer, drift: held });

  it("hops into a drift the way the wheel is turned, with the steer remapped", () => {
    const r = arena();
    run(r, 1, () => drift(1));
    expect(view(r).drift).toBe(1);
    expect(view(r).hop).toBeGreaterThanOrEqual(0);
    run(r, 8, () => drift(1));
    expect(view(r).hop).toBeGreaterThan(0.1);
    expect(view(r).hop).toBeLessThanOrEqual(0.35 + 1e-9);
    run(r, 20, () => drift(1));
    expect(view(r).hop).toBe(0);
    // The wheel well over the other way: still going round into the drift, at about half a full turn.
    const h = view(r).course!;
    run(r, 30, () => drift(-0.75));
    expect(h - view(r).course!).toBeGreaterThan(0.3);
    expect(view(r).drift).toBe(1);
  });

  /** How far the nose is from the way the kart goes, degrees (+ nose to the left of it). */
  const slip = (r: ReturnType<typeof race>): number => {
    const k = view(r);
    return (((((k.heading - (k.course ?? k.heading)) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
  };

  it("is a power-slide: the tail swings out within the hop and holds 15-33° by the wheel, and the speed is kept", () => {
    const held: Record<string, number> = {};
    for (const [name, wheel] of [["into", 1], ["straight", 0], ["against", -0.6]] as const) {
      const r = arena();
      const speed = view(r).speed;
      run(r, 1, () => drift(1));
      run(r, 15, () => drift(wheel));
      // Most of the way out within the quarter second of the hop.
      expect(Math.abs(slip(r)), name).toBeGreaterThan(14);
      run(r, 60, () => drift(wheel));
      held[name] = -slip(r);
      expect(held[name], name).toBeGreaterThan(16);
      expect(held[name], name).toBeLessThan(36);
      // A drift is not a brake: nearly all of the speed is still there.
      expect(view(r).speed, name).toBeGreaterThan(Math.min(speed, 24) * 0.94);
    }
    // Into the drift the tail swings further; against it, less.
    expect(held.into).toBeGreaterThan(held.straight! + 5);
    expect(held.straight).toBeGreaterThan(held.against! + 5);
  });

  it("comes round tighter with the wheel into the drift and wider against it, tighter than the grip alone at full lock", () => {
    const turned = (wheel: number, drifting: boolean): number => {
      const r = arena();
      const course = (): number => view(r).course ?? view(r).heading;
      run(r, 1, () => drift(1, drifting));
      const start = course();
      let total = 0;
      let last = start;
      for (let i = 0; i < 60; i++) {
        run(r, 1, () => (drifting ? drift(wheel) : input({ throttle: 1, steer: wheel })));
        const now = course();
        total += (((last - now + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        last = now;
      }
      return total;
    };
    const into = turned(1, true);
    const straight = turned(0, true);
    const against = turned(-0.75, true);
    expect(into).toBeGreaterThan(straight * 1.3);
    expect(straight).toBeGreaterThan(against * 1.4);
    // Still coming round the drift's way with the wheel well against it.
    expect(against).toBeGreaterThan(0.4);
    expect(into).toBeGreaterThan(turned(1, false) * 1.2);
  });

  it("straightens out when the wheel is held hard against it for a quarter second, with the boost it had earned", () => {
    const r = arena();
    run(r, 1, () => drift(1));
    run(r, 70, () => drift(1));
    expect(view(r).driftLevel).toBe(1);
    // A flick against it is only a correction...
    run(r, 10, () => drift(-1));
    run(r, 5, () => drift(1));
    expect(view(r).drift).toBe(1);
    // ...held there, it is the way out.
    const events = run(r, 16, () => drift(-1));
    expect(view(r).drift).toBe(0);
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 1 });
  });

  it("unwinds when let go: the nose comes back to the way the kart goes within half a second", () => {
    const r = arena();
    run(r, 1, () => drift(1));
    run(r, 60, () => drift(1));
    expect(Math.abs(slip(r))).toBeGreaterThan(25);
    run(r, 30, () => input({ throttle: 1 }));
    expect(Math.abs(slip(r))).toBeLessThan(4);
  });

  it("drifts left when the wheel is left", () => {
    const r = arena();
    run(r, 2, () => drift(-0.8));
    expect(view(r).drift).toBe(-1);
  });

  it("a hop going straight is only a hop, and a hop too slow is nothing", () => {
    const r = arena();
    run(r, 2, () => drift(0.1));
    expect(view(r).drift).toBe(0);
    expect(view(r).hop).toBeGreaterThan(0);
    const slow = race(ARENA, racers(1, 0));
    toGo(slow);
    run(slow, 40, () => input({ throttle: 1 }));
    expect(view(slow).speed).toBeLessThan(10);
    run(slow, 2, () => drift(1));
    expect(view(slow).hop).toBe(0);
    expect(view(slow).drift).toBe(0);
  });

  it("charges blue at about a second, orange at about two and the hottest at about three, and boosts on release", () => {
    const r = arena();
    const events = run(r, 1, () => drift(0.7));
    const reached = [-1, -1, -1];
    for (let i = 1; i < 300 && reached[2]! < 0; i++) {
      events.push(...run(r, 1, () => drift(0)));
      const level = view(r).driftLevel;
      if (level > 0 && reached[level - 1]! < 0) reached[level - 1] = i;
    }
    // A middling turn (the wheel straight in a drift) is 1.0 s, 2.1 s and 3.4 s.
    expect(reached[0]).toBeGreaterThan(54);
    expect(reached[0]).toBeLessThan(66);
    expect(reached[1]).toBeGreaterThan(120);
    expect(reached[1]).toBeLessThan(132);
    expect(reached[2]).toBeGreaterThan(198);
    expect(reached[2]).toBeLessThan(210);
    expect(events.filter((e) => e.type === "drift-level").map((e) => (e.type === "drift-level" ? e.level : 0))).toEqual([1, 2, 3]);
    // Let go: boost, 1.9 s for the third, and the speed goes past the normal top.
    const speedBefore = view(r).speed;
    const released = run(r, 1, () => input({ throttle: 1, drift: false }));
    const boost = released.find((e) => e.type === "boost");
    expect(boost).toMatchObject({ type: "boost", source: "drift", level: 3, kart: 0 });
    expect(view(r).boost).toBeGreaterThan(1.85);
    expect(view(r).boost).toBeLessThanOrEqual(1.9);
    expect(view(r).drift).toBe(0);
    expect(view(r).driftLevel).toBe(0);
    run(r, 12, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(Math.max(speedBefore, 24) + 1);
  });

  it("gives the shorter boosts for the cooler sparks, and none for a drift let go at once", () => {
    const r = arena();
    run(r, 1, () => drift(1));
    for (let i = 0; i < 60; i++) run(r, 1, () => drift(1));
    expect(view(r).driftLevel).toBe(1);
    const released = run(r, 1, () => input({ throttle: 1, drift: false }));
    expect(released.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 1 });
    expect(view(r).boost).toBeGreaterThan(0.65);
    expect(view(r).boost).toBeLessThanOrEqual(0.7);

    const orange = arena();
    run(orange, 100, () => drift(1));
    expect(view(orange).driftLevel).toBe(2);
    run(orange, 1, () => input({ throttle: 1, drift: false }));
    expect(view(orange).boost).toBeGreaterThan(1.25);
    expect(view(orange).boost).toBeLessThanOrEqual(1.3);

    const quick = arena();
    run(quick, 20, () => drift(1));
    const none = run(quick, 5, () => input({ throttle: 1, drift: false }));
    expect(count(none, "boost")).toBe(0);
    expect(view(quick).boost).toBe(0);
  });

  it("is ended by a brake, which still gives the boost it had charged", () => {
    const r = arena();
    run(r, 130, () => drift(1));
    expect(view(r).driftLevel).toBe(2);
    const events = run(r, 3, () => input({ brake: 1, drift: true, steer: 1 }));
    expect(view(r).drift).toBe(0);
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 2 });
    expect(view(r).boost).toBeGreaterThan(1);
  });

  /** The wheel's open hands: a brake that is a slide in a bend at speed. */
  const open = (steer: number) => input({ brake: 1, slide: true, steer });

  it("starts from open hands in a bend at speed, keeps the speed, and boosts when the hands close", () => {
    const r = arena();
    const before = view(r).speed;
    run(r, 1, () => open(1));
    expect(view(r).drift).toBe(1);
    run(r, 130, () => open(1));
    expect(view(r).drift).toBe(1);
    expect(view(r).driftLevel).toBe(2);
    expect(view(r).speed).toBeGreaterThan(before * 0.9);
    const events = run(r, 2, () => input({ throttle: 1, steer: 1 }));
    expect(view(r).drift).toBe(0);
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 2 });
  });

  it("goes on when the hands open in a drift begun with a hop, and ends when they close", () => {
    const r = arena();
    run(r, 60, () => drift(1));
    run(r, 60, () => open(0));
    expect(view(r).drift).toBe(1);
    const events = run(r, 2, () => input({ throttle: 1 }));
    expect(view(r).drift).toBe(0);
    expect(count(events, "boost")).toBe(1);
  });

  it("is no drift for open hands going straight, or slowly in a bend: they brake, and back up", () => {
    const r = arena();
    const before = view(r).speed;
    run(r, 40, () => open(0));
    expect(view(r).drift).toBe(0);
    expect(view(r).speed).toBeLessThan(before - 8);
    // Still at speed, the same hands in a bend are a slide, so hold them straight until the kart is slow.
    run(r, 90, () => open(0));
    run(r, 120, () => open(1));
    expect(view(r).drift).toBe(0);
    expect(view(r).speed).toBeLessThan(-1);
  });

  it("is no drift for a brake in a bend from keys or a pad: only the wheel's open hands slide", () => {
    const r = arena();
    const before = view(r).speed;
    run(r, 30, () => input({ brake: 1, steer: 1 }));
    expect(view(r).drift).toBe(0);
    expect(view(r).speed).toBeLessThan(before - 4);
  });

  it("is ended by running out of speed, with nothing", () => {
    const r = arena();
    run(r, 130, () => drift(1));
    patch(r, 0, { vx: 0, vz: 0 });
    const events = run(r, 3, () => drift(1));
    expect(view(r).drift).toBe(0);
    expect(count(events, "boost")).toBe(0);
  });

  it("does not build charge off the road", () => {
    const r = solo();
    run(r, 180, () => input({ throttle: 1 }));
    patch(r, 0, { x: -9.5, offset: 9.5 });
    run(r, 3, () => drift(0.8));
    expect(view(r).drift).toBe(1);
    run(r, 100, () => drift(0.8));
    expect(view(r).offroad).toBe(true);
    expect(view(r).driftLevel).toBe(0);
  });
});

describe("the start", () => {
  it("gives a start boost for opening the throttle while the lights say 1", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 1, () => input({ throttle: r.tick >= GO_TICK - 20 ? 1 : 0 }));
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "start", kart: 0 });
    const plain = race(HARBOUR_LIGHTS, racers(1, 0));
    run(plain, GO_TICK + 90, () => input({ throttle: plain.tick >= GO_TICK ? 1 : 0 }));
    run(r, 89, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(view(plain).speed + 2);
  });

  it("gives it to hands closed as the 1 comes up, and to a throttle that arrives a little after them (the hands' delay)", () => {
    const one = run(race(HARBOUR_LIGHTS, racers(1, 0)), GO_TICK + 1).find((e) => e.type === "countdown" && e.n === 1)!.tick;
    expect(one, "the lights say 1 for the last second").toBe(GO_TICK - 60);
    for (const late of [0, 10, 40, 59]) {
      const r = race(HARBOUR_LIGHTS, racers(1, 0));
      const events = run(r, GO_TICK + 1, (tick) => input({ throttle: tick >= one + late ? 1 : 0 }));
      expect(events.find((e) => e.type === "boost"), `${late} ticks after the 1`).toMatchObject({ source: "start", kart: 0 });
    }
  });

  it("floods the engine when the throttle was down before 1.2 s: no drive for 0.6 s after Go", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 30, () => input({ throttle: r.tick >= GO_TICK - 120 ? 1 : 0 }));
    expect(count(events, "boost")).toBe(0);
    // Said once, at Go, so the engine coughs for the kart that flooded and no other.
    expect(events.filter((e) => e.type === "flood")).toMatchObject([{ kart: 0, tick: GO_TICK }]);
    expect(view(r).speed).toBe(0);
    run(r, 60, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(5);
  });

  it("is a plain start in between: on at the end of the 2", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 60, () => input({ throttle: r.tick >= GO_TICK - 66 ? 1 : 0 }));
    expect(count(events, "boost")).toBe(0);
    expect(view(r).speed).toBeGreaterThan(2);
  });

  it("holds the karts still until Go, whatever the throttle", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const x = view(r).x;
    const z = view(r).z;
    run(r, GO_TICK - 1, () => input({ throttle: 1 }));
    expect(view(r).x).toBe(x);
    expect(view(r).z).toBe(z);
  });

});

describe("karts that touch", () => {
  it("push apart, the faster one shoving harder, and say so", () => {
    const r = race(HARBOUR_LIGHTS, racers(2, 0));
    toGo(r);
    // Kart 1 right in front of kart 0 and much slower, both on the left of the road.
    const s = view(r).z;
    patch(r, 0, { vz: 20, vx: 0, steer: 0 });
    patch(r, 1, { x: view(r).x, z: s + 1.6, s: s + 1.6, vz: 4, vx: 0, heading: 0, offset: -3.04, progress: s + 1.6 });
    const events = run(r, 1, () => undefined);
    const bump = events.find((e) => e.type === "bump");
    expect(bump).toBeDefined();
    if (bump?.type === "bump") expect(bump.strength).toBeGreaterThan(0);
    const a = view(r, 0);
    const b = view(r, 1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2.2 - 1e-6);
    // The slower kart was sent on, the faster one slowed.
    expect(b.speed).toBeGreaterThan(4);
    expect(a.speed).toBeLessThan(20);
    expect(count(run(r, 60), "bump")).toBeLessThanOrEqual(1);
  });

  it("turn a kart clipped off its middle: a shove at the tail swings its nose the other way", () => {
    const r = race(HARBOUR_LIGHTS, racers(2, 0));
    toGo(r);
    const s = view(r).z;
    // Kart 1 comes up on kart 0's right rear quarter, angled in, 8 m/s quicker.
    patch(r, 0, { vz: 18, vx: 0, heading: 0, steer: 0 });
    patch(r, 1, { x: view(r).x - 1.5, z: s - 1.4, s: s - 1.4, vz: 25, vx: 2, heading: 0.08, offset: -1.54, progress: s - 1.4 });
    const events = run(r, 1, () => undefined);
    expect(count(events, "bump")).toBe(1);
    // Kart 0 was shoved to its left at the back: its nose swings right (the heading goes down).
    expect(view(r, 0).heading).toBeLessThan(-0.03);
    expect(view(r, 0).heading).toBeGreaterThan(-0.25);
  });
});

describe("laps", () => {
  it("count when the lap is driven, once, and not for shuffling over the line", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(r);
    const events = [];
    // Over the line forward, back over it reversing, and again, four times.
    for (let round = 0; round < 4; round++) {
      events.push(...run(r, 45, () => input({ throttle: 1 })));
      expect(view(r).z).toBeGreaterThan(0);
      events.push(...run(r, 80, () => input({ brake: 1 })));
      events.push(...run(r, 1, () => input({ brake: 1 })));
    }
    expect(count(events, "lap")).toBe(0);
    expect(view(r).lap).toBe(1);

    // And a lap that really is driven counts the first time over the line, and not again when the kart goes back and forth over it.
    const length = harbour.length;
    const q = race(HARBOUR_LIGHTS, racers(1, 0));
    toGo(q);
    patch(q, 0, { progress: length - 1.5 });
    const crossings = [];
    for (let round = 0; round < 3; round++) {
      crossings.push(...run(q, 40, () => input({ throttle: 1 })));
      crossings.push(...run(q, 90, () => input({ brake: 1 })));
    }
    expect(crossings.filter((e) => e.type === "lap")).toEqual([expect.objectContaining({ type: "lap", kart: 0, lap: 2 })]);
    expect(view(q).lap).toBe(2);
  });

  it("report the final lap, and a finish with its place and time, after which the kart drives itself", () => {
    const length = harbour.length;
    const r = race(HARBOUR_LIGHTS, racers(1, 0), { laps: 3 });
    toGo(r);
    patch(r, 0, { lap: 2, progress: 2 * length - 1 });
    const events = run(r, 60, () => input({ throttle: 1 }));
    expect(events.filter((e) => e.type === "lap")).toEqual([expect.objectContaining({ kart: 0, lap: 3 })]);
    expect(count(events, "final-lap", 0)).toBe(1);
    expect(view(r).lap).toBe(3);
    patch(r, 0, { progress: 3 * length - 1 });
    const finish = run(r, 60, () => input({ throttle: 1 }));
    expect(finish.find((e) => e.type === "finish")).toMatchObject({ type: "finish", kart: 0, place: 1 });
    expect(view(r).finished).not.toBeNull();
    expect(view(r).lap).toBe(4);
    // From here its own hands steer: no input, and it keeps going.
    const before = view(r).speed;
    run(r, 120);
    expect(view(r).speed).toBeGreaterThan(Math.min(before, 15));
    expect(r.view().phase).toBe("finished");
  });

  it("flag a kart facing the wrong way at speed for 1.5 s", () => {
    const r = solo();
    run(r, 120, () => input({ throttle: 1 }));
    patch(r, 0, { heading: Math.PI, vx: 0, vz: -15 });
    run(r, 60, () => input({ throttle: 1 }));
    expect(view(r).wrongWay).toBe(false);
    run(r, 40, () => input({ throttle: 1 }));
    expect(view(r).wrongWay).toBe(true);
  });
});

describe("weights", () => {
  const withCharacters = (...characters: (string | undefined)[]) =>
    characters.map((character, i) => ({ ...racer(i, i), character }));

  /** Kart 1 stands just ahead of kart 0, which comes up at 20 m/s: how fast the standing one is sent on, and how fast the rammer is left. */
  const ram = (rammer: string, standing: string) => {
    const r = race(HARBOUR_LIGHTS, withCharacters(rammer, standing));
    toGo(r);
    const s = view(r).z;
    patch(r, 0, { vz: 20, vx: 0, steer: 0 });
    patch(r, 1, { x: view(r).x, z: s + 1.6, s: s + 1.6, vz: 0, vx: 0, heading: 0, offset: -3.04, progress: s + 1.6 });
    run(r, 1, () => undefined);
    return { sent: view(r, 1).speed, left: view(r, 0).speed };
  };

  it("a heavy kart shoves a light one further than the reverse", () => {
    const heavyHitsLight = ram("bramble", "bun");
    const lightHitsHeavy = ram("bun", "bramble");
    expect(heavyHitsLight.sent).toBeGreaterThan(lightHitsHeavy.sent + 1);
    // And the rammer loses less speed against the light kart.
    expect(heavyHitsLight.left).toBeGreaterThan(lightHitsHeavy.left);
  });

  it("a light kart reaches 15 m/s sooner than a middle one, and a middle one sooner than a heavy one", () => {
    const secondsTo15 = (character: string): number => {
      const r = race(HARBOUR_LIGHTS, withCharacters(character));
      toGo(r);
      let ticks = 0;
      while (view(r).speed < 15 && ticks < 600) {
        run(r, 1, () => input({ throttle: 1 }));
        ticks++;
      }
      return ticks / 60;
    };
    const light = secondsTo15("bun");
    const middle = secondsTo15("kit");
    const heavy = secondsTo15("bramble");
    expect(light).toBeLessThan(middle);
    expect(middle).toBeLessThan(heavy);
  });

  it("a heavy kart tops out a little higher, a light one a little lower, and an unknown driver is a middleweight", () => {
    const top = (character: string | undefined): number => {
      const r = race(HARBOUR_LIGHTS, withCharacters(character));
      toGo(r);
      run(r, 60 * 8, () => input({ throttle: 1 }));
      return view(r).speed;
    };
    expect(top("bun")).toBeLessThan(top("kit"));
    expect(top("rivet")).toBeGreaterThan(top("kit"));
    expect(top("nobody")).toBe(top(undefined));
  });
});
