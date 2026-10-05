import { describe, expect, it } from "vitest";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS } from "../track/tracks";
import { GO_TICK } from "./kart";
import { ARENA, count, input, patch, race, racer, racers, run, toGo, view } from "./testing";

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
  it("stops the kart, and held at a standstill for 0.3 s reverses it, up to 7 m/s", () => {
    const r = solo();
    run(r, 180, () => input({ throttle: 1 }));
    const speeds: number[] = [];
    for (let i = 0; i < 240; i++) {
      run(r, 1, () => input({ brake: 1 }));
      speeds.push(view(r).speed);
    }
    const stopped = speeds.findIndex((v) => v <= 0);
    // 30 m/s^2: about 21 m/s gone in 0.7 s.
    expect(stopped).toBeGreaterThan(30);
    expect(stopped).toBeLessThan(60);
    const reversing = speeds.findIndex((v, i) => i > stopped && v < -0.5);
    // Held for 0.3 s (18 ticks) before it backs up.
    expect(reversing - stopped).toBeGreaterThanOrEqual(15);
    expect(reversing - stopped).toBeLessThanOrEqual(24);
    expect(Math.min(...speeds)).toBeLessThan(-6.5);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(-7.001);
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
    // The wheel straightened: still turning into the drift, at 0.4..1.4 of a full turn.
    const h = view(r).heading;
    run(r, 30, () => drift(-1));
    expect(h - view(r).heading).toBeGreaterThan(0.2);
    expect(view(r).drift).toBe(1);
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

  it("charges level 1 at about a second and level 2 at about two seconds, and boosts on release", () => {
    const r = arena();
    const events = run(r, 1, () => drift(0.7));
    let level1 = -1;
    let level2 = -1;
    for (let i = 1; i < 240 && level2 < 0; i++) {
      events.push(...run(r, 1, () => drift(0.2)));
      if (view(r).driftLevel === 1 && level1 < 0) level1 = i;
      if (view(r).driftLevel === 2 && level2 < 0) level2 = i;
    }
    // A middling turn is 1.0 s and 2.2 s; the turn here is between loose and middling.
    expect(level1).toBeGreaterThan(50);
    expect(level1).toBeLessThan(100);
    expect(level2).toBeGreaterThan(level1 + 40);
    expect(level2).toBeLessThan(220);
    expect(events.filter((e) => e.type === "drift-level").map((e) => (e.type === "drift-level" ? e.level : 0))).toEqual([1, 2]);
    // Let go: boost, 1.4 s for level 2, and the speed goes past the normal top.
    const speedBefore = view(r).speed;
    const released = run(r, 1, () => input({ throttle: 1, drift: false }));
    const boost = released.find((e) => e.type === "boost");
    expect(boost).toMatchObject({ type: "boost", source: "drift", level: 2, kart: 0 });
    expect(view(r).boost).toBeGreaterThan(1.35);
    expect(view(r).boost).toBeLessThanOrEqual(1.4);
    expect(view(r).drift).toBe(0);
    expect(view(r).driftLevel).toBe(0);
    run(r, 90, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(Math.min(speedBefore, 24) + 0.5);
  });

  it("gives the shorter boost for level 1, and none for a drift let go at once", () => {
    const r = arena();
    run(r, 1, () => drift(1));
    for (let i = 0; i < 80; i++) run(r, 1, () => drift(1));
    expect(view(r).driftLevel).toBe(1);
    const released = run(r, 1, () => input({ throttle: 1, drift: false }));
    expect(released.find((e) => e.type === "boost")).toMatchObject({ source: "drift", level: 1 });
    expect(view(r).boost).toBeGreaterThan(0.65);
    expect(view(r).boost).toBeLessThanOrEqual(0.7);

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
  it("gives a start boost for opening the throttle in the last 0.6 s", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 1, () => input({ throttle: r.tick >= GO_TICK - 20 ? 1 : 0 }));
    expect(events.find((e) => e.type === "boost")).toMatchObject({ source: "start", kart: 0 });
    const plain = race(HARBOUR_LIGHTS, racers(1, 0));
    run(plain, GO_TICK + 90, () => input({ throttle: plain.tick >= GO_TICK ? 1 : 0 }));
    run(r, 89, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(view(plain).speed + 2);
  });

  it("floods the engine when the throttle was down before 1.2 s: no drive for 0.6 s after Go", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 30, () => input({ throttle: r.tick >= GO_TICK - 120 ? 1 : 0 }));
    expect(count(events, "boost")).toBe(0);
    expect(view(r).speed).toBe(0);
    run(r, 60, () => input({ throttle: 1 }));
    expect(view(r).speed).toBeGreaterThan(5);
  });

  it("is a plain start in between", () => {
    const r = race(HARBOUR_LIGHTS, racers(1, 0));
    const events = run(r, GO_TICK + 60, () => input({ throttle: r.tick >= GO_TICK - 55 ? 1 : 0 }));
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
