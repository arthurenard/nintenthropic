/**
 * Party Rules in the sim (rules.ts): what each card changes in the physics and the items, that the bots finish a race
 * under every card on two tracks, and that a card is a function of the setup alone (a guest's copy replays the host's).
 */
import { describe, expect, it } from "vitest";
import { IDLE_INPUT, type DriveInput, type RaceEvent, type RaceSetup, type TrackDef } from "../contract";
import { CARDS, STRONG_ITEMS } from "../rules";
import { HARBOUR_LIGHTS, MEADOW_LOOP } from "../track/tracks";
import { createSimRace } from "./race";
import { botField } from "./trackStats";
import { ARENA, count, level, patch, racers, run, toGo, view } from "./testing";

const FLAT = level(MEADOW_LOOP);

function raceWith(rule: string | undefined, track: TrackDef = FLAT, field = racers(1, 1), seed = 1) {
  const setup: RaceSetup = { track, laps: 2, seed, racers: field, ...(rule ? { rule } : {}) };
  return createSimRace(setup);
}

const full: DriveInput = { ...IDLE_INPUT, throttle: 1 };

describe("a race under a card", () => {
  it("names its card in the view, and a race without one names none", () => {
    expect(raceWith("ice").view().rule).toBe("ice");
    expect(raceWith(undefined).view().rule).toBeUndefined();
    // A card this build does not know changes nothing (a newer host's).
    const odd = raceWith("mirror-madness", FLAT, racers(1, 0));
    const plain = raceWith(undefined, FLAT, racers(1, 0));
    toGo(odd, () => full);
    toGo(plain, () => full);
    run(odd, 200, () => full);
    run(plain, 200, () => full);
    expect(view(odd).speed).toBe(view(plain).speed);
  });

  it("is a function of the setup: a copy restored from a snapshot carries on exactly as the first", () => {
    for (const card of CARDS) {
      const a = raceWith(card.id, FLAT, racers(1, 3), 5);
      run(a, 600, () => full);
      const b = raceWith(card.id, FLAT, racers(1, 3), 5);
      b.restore(JSON.parse(JSON.stringify(a.snapshot())));
      run(a, 300, () => full);
      run(b, 300, () => full);
      expect(JSON.stringify(b.snapshot()), card.id).toBe(JSON.stringify(a.snapshot()));
    }
  });
});

describe("physics cards", () => {
  /** A lone kart held flat out on the arena for `seconds`; its speed at the end. */
  function topSpeed(rule: string | undefined, seconds = 14): number {
    const r = raceWith(rule, ARENA, racers(1, 0));
    toGo(r);
    run(r, seconds * 60, () => ({ ...full, steer: 0.08 }));
    return view(r).speed;
  }

  it("Turbo Day: 15% more top speed", () => {
    const usual = topSpeed(undefined);
    const turbo = topSpeed("turbo");
    expect(turbo / usual).toBeGreaterThan(1.1);
    expect(turbo / usual).toBeLessThan(1.2);
  });

  it("Heavy Day and Feather Day: every kart drives as that class, whoever its driver is", () => {
    const heavy = topSpeed("heavy");
    const feather = topSpeed("feather");
    const usual = topSpeed(undefined);
    // Heavyweights top out higher and light ones lower than a middleweight (characters.ts WEIGHTS)...
    expect(heavy).toBeGreaterThan(usual);
    expect(feather).toBeLessThan(usual);
    // ...and a light driver in a heavy kart drives like a heavy one.
    const field = [{ id: 0, name: "Bun", colour: "#fff", player: 0, character: "bun" }];
    const light = createSimRace({ track: ARENA, laps: 2, seed: 1, racers: field });
    const heavyBun = createSimRace({ track: ARENA, laps: 2, seed: 1, racers: field, rule: "heavy" });
    for (const r of [light, heavyBun]) {
      toGo(r);
      run(r, 14 * 60, () => ({ ...full, steer: 0.08 }));
    }
    expect(view(heavyBun).speed).toBeGreaterThan(view(light).speed);
  });

  it("Tiny Karts: karts touch only when their smaller circles do, and turn a little quicker", () => {
    const gap = (rule?: string): number => {
      const r = raceWith(rule, ARENA, racers(2, 0));
      toGo(r);
      const a = r.view().karts[0]!;
      patch(r, 1, { x: a.x + 1.6, z: a.z, heading: 0 });
      run(r, 1);
      const [k0, k1] = r.view().karts;
      return Math.hypot(k1!.x - k0!.x, k1!.z - k0!.z);
    };
    // 1.6 m apart: inside the usual 2.2 m (they are shoved apart), outside a Tiny Kart's 1.32 m (left alone).
    expect(gap(undefined)).toBeGreaterThan(2.1);
    expect(gap("tiny")).toBeLessThan(1.7);

    const heading = (rule?: string): number => {
      const r = raceWith(rule, ARENA, racers(1, 0));
      toGo(r);
      run(r, 90, () => full);
      const before = view(r).heading;
      run(r, 60, () => ({ ...full, steer: 1 }));
      return Math.abs(view(r).heading - before);
    };
    expect(heading("tiny")).toBeGreaterThan(heading(undefined));
  });

  it("Ice Day: the road lets the kart slide, as ice does, while the usual road does not", () => {
    const slide = (rule?: string): number => {
      const r = raceWith(rule, ARENA, racers(1, 0));
      toGo(r);
      run(r, 8 * 60, () => full);
      let worst = 0;
      run(r, 120, () => {
        const v = view(r);
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(v.heading - (v.course ?? v.heading)), Math.cos(v.heading - (v.course ?? v.heading)))));
        return { ...full, steer: 1 };
      });
      return worst;
    };
    expect(slide("ice")).toBeGreaterThan(slide(undefined) * 2);
  });
});

describe("item cards", () => {
  /** A kart sitting on an item box for a second: the events it makes. */
  function sitOnBox(rule?: string): RaceEvent[] {
    // Meadow's item row lies on a strip of boost now: with no boost under it, a kart that sits on the box stays put.
    const plain: TrackDef = { ...FLAT, boostPads: [], surfaces: (FLAT.surfaces ?? []).filter((surface) => surface.kind !== "boost") };
    const r = raceWith(rule, plain, racers(1, 0));
    toGo(r);
    const box = r.view().things.find((t) => t.kind === "box")!;
    patch(r, 0, { x: box.x, z: box.z, vx: 0, vz: 0 });
    return run(r, 60);
  }

  it("Item Frenzy: the boxes come back at once, so a kart sitting on one breaks it again and again", () => {
    expect(count(sitOnBox(), "pickup")).toBe(1);
    expect(count(sitOnBox(), "box")).toBe(0);
    const frenzy = sitOnBox("frenzy");
    expect(count(frenzy, "pickup")).toBe(1);
    expect(count(frenzy, "box")).toBeGreaterThanOrEqual(1);
  });

  /** Every item the bots were dealt in a few races. */
  function dealt(rule?: string): string[] {
    const items: string[] = [];
    for (const seed of [1, 2, 3]) {
      const r = raceWith(rule, HARBOUR_LIGHTS, botField(8), seed);
      run(r, 60 * 90).forEach((e) => {
        if (e.type === "pickup") items.push(e.item);
      });
    }
    return items;
  }

  it("Pucks Only: every box gives a puck or three", { timeout: 60000 }, () => {
    const items = dealt("pucks");
    expect(items.length).toBeGreaterThan(20);
    expect(items.every((item) => item === "puck" || item === "puck3")).toBe(true);
    expect(dealt().some((item) => item !== "puck" && item !== "puck3")).toBe(true);
  });

  it("Item Frenzy: the strongest items come more often", { timeout: 60000 }, () => {
    const strong = (items: string[]) => items.filter((item) => (STRONG_ITEMS as readonly string[]).includes(item)).length / items.length;
    expect(strong(dealt("frenzy"))).toBeGreaterThan(strong(dealt()) * 1.2);
  });
});

describe("the bots", () => {
  for (const card of CARDS) {
    for (const track of [MEADOW_LOOP, HARBOUR_LIGHTS]) {
      it(`finish a race of ${track.name} under ${card.name}`, { timeout: 90000 }, () => {
        const r = raceWith(card.id, track, botField(6), 3);
        const events: RaceEvent[] = [];
        for (let i = 0; i < 300 && r.view().phase !== "finished"; i++) events.push(...run(r, 60));
        expect(r.view().phase).toBe("finished");
        const result = r.result()!;
        expect(result.standings).toHaveLength(6);
        expect(result.standings.every((s) => s.time !== null)).toBe(true);
        expect(count(events, "finish")).toBe(6);
        // Nobody spends the race stuck or under the drone: a card must not break the road for them.
        expect(count(events, "rescued") / 6).toBeLessThan(3);
      });
    }
  }
});
