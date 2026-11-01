import { describe, expect, it } from "vitest";
import type { RaceEvent, RacerSetup, TrackDef } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS, MEADOW_LOOP, TRACKS } from "../track/tracks";
import { LOOK_STEPS, roadAhead } from "./bots";
import { planFor, tableAt, type Corner } from "./plan";
import { roomField } from "./packStats";
import { KART_AT } from "./snapshot";
import { ITEM_KINDS } from "./state";
import { TEMPERAMENTS, temperaments, type Temperament } from "./temperament";
import { ARENA, count, give, patch, race, racers, reach, run, toGo, view } from "./testing";
import { botField } from "./trackStats";
import { TUNING } from "./tuning";
import type { SimRace } from "./race";
import { takeOf, type BendNear } from "./variety";

describe("a bot driving alone", () => {
  for (const track of TRACKS) {
    for (const skill of [1, 0.5, 0]) {
      it(`laps ${track.name} in a sane time and never goes past a barrier (skill ${skill})`, { timeout: 60000 }, () => {
        const geo = TrackGeometry.build(track);
        const r = race(track, racers(0, 1, skill), { laps: 3 });
        const laps: number[] = [];
        let last = 0;
        let outside = 0;
        let offroad = 0;
        let racing = 0;
        for (let i = 0; i < 60 * 300 && r.view().phase !== "finished"; i++) {
          r.step(new Map());
          const v = r.view();
          const k = v.karts[0]!;
          const p = geo.project(k.x, k.z);
          outside = Math.max(outside, Math.abs(p.offset) - reach(track, p.s, p.offset));
          if (k.offroad) offroad++;
          if (v.phase === "racing") racing++;
          for (const e of r.takeEvents()) {
            if (e.type === "lap" || e.type === "finish") {
              const at = e.type === "finish" ? e.time : v.time;
              laps.push(at - last);
              last = at;
            }
          }
        }
        expect(laps).toHaveLength(3);
        for (const lap of laps) {
          expect(lap).toBeGreaterThan(25);
          expect(lap).toBeLessThan(75);
        }
        expect(outside).toBeLessThanOrEqual(0);
        // It drives on the road, not the grass.
        expect(offroad / racing).toBeLessThan(0.02);
        expect(r.result()!.standings[0]).toMatchObject({ kart: 0, place: 1 });
        expect(r.result()!.standings[0]!.bestLap).toBeLessThan(75);
      });
    }
  }

  it("is quicker the sharper it is", () => {
    const times = [0, 0.5, 1].map((skill) => {
      const r = race(TRACKS[0]!, racers(0, 1, skill), { laps: 2 });
      run(r, 60 * 200);
      return r.result()!.standings[0]!.time!;
    });
    expect(times[0]!).toBeGreaterThan(times[2]!);
    expect(times[1]!).toBeGreaterThanOrEqual(times[2]! - 0.5);
  });

  it("steers round a slick lying on its line", () => {
    for (const offset of [-3, 0, 3]) {
      const r = race(HARBOUR_LIGHTS, racers(0, 1, 1));
      toGo(r);
      run(r, 100);
      // A slick on the long straight, ahead of it, at this offset from the middle (x runs the other way to the offset there).
      const snap = r.snapshot();
      const ahead = view(r).z + 90;
      (snap.l as number[][]).push([999, 5, -offset, ahead, ahead, offset, 0]);
      snap.th = 1000;
      r.restore(snap);
      const events = run(r, 60 * 6);
      expect(events.some((e) => e.type === "hit" && e.cause === "slick")).toBe(false);
      expect(view(r).z).toBeGreaterThan(ahead + 20);
    }
  });

  it("backs out when it is stuck against a barrier", () => {
    const r = race(HARBOUR_LIGHTS, racers(0, 1, 1));
    toGo(r);
    run(r, 120);
    // Put it nose-first into the right-hand barrier, stopped.
    patch(r, 0, { x: -13.5, offset: 13.5, heading: -Math.PI / 2, vx: 0, vz: 0, steer: 0 });
    const before = view(r).z;
    run(r, 60 * 10);
    expect(view(r).z).toBeGreaterThan(before + 60);
    expect(view(r).speed).toBeGreaterThan(5);
  });
});

describe("eight bots", () => {
  for (const track of TRACKS) {
    for (const seed of [1, 2, 3]) {
      it(`finish three laps of ${track.name} and the race ends with sane standings (seed ${seed})`, { timeout: 60000 }, () => {
        const r = race(track, botField(), { laps: 3, seed });
        const events: RaceEvent[] = [];
        let ticks = 0;
        while (r.view().phase !== "finished" && ticks < 60 * 300) {
          run(r, 60).forEach((e) => events.push(e));
          ticks += 60;
        }
        expect(r.view().phase).toBe("finished");
        const result = r.result()!;
        expect(result.standings).toHaveLength(8);
        expect(result.standings.map((s) => s.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(new Set(result.standings.map((s) => s.kart)).size).toBe(8);
        // Everyone finished (no player was holding the race up), in time order.
        const times = result.standings.map((s) => s.time);
        expect(times.every((t) => t !== null)).toBe(true);
        expect(times).toEqual([...times].sort((a, b) => a! - b!));
        expect(times[0]!).toBeGreaterThan(75);
        expect(times[7]!).toBeLessThan(220);
        // The pack is close but not a dead heat.
        expect(times[7]! - times[0]!).toBeGreaterThan(1);
        expect(times[7]! - times[0]!).toBeLessThan(40);
        for (const s of result.standings) {
          expect(s.bestLap).not.toBeNull();
          expect(s.bestLap!).toBeGreaterThan(25);
          expect(s.bestLap!).toBeLessThan(75);
        }
        expect(count(events, "finish")).toBe(8);
        expect(count(events, "lap")).toBe(16);
        expect(count(events, "final-lap")).toBe(8);
        // Finish events agree with the standings.
        const finishes = events.filter((e) => e.type === "finish");
        expect(finishes.map((e) => (e.type === "finish" ? e.kart : -1))).toEqual(result.standings.map((s) => s.kart));
        // The race had things in it.
        expect(count(events, "pickup")).toBeGreaterThan(10);
        expect(count(events, "use")).toBeGreaterThan(5);
        expect(count(events, "boost")).toBeGreaterThan(10);
      });
    }
  }

  it("use every kind of item, and the hits spin karts out", { timeout: 120000 }, () => {
    const used = new Set<string>();
    let hits = 0;
    // (A skyrocket is rare, only from the back half, so a few more seeds are tried until every kind has shown.)
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      if (used.size === ITEM_KINDS.length && seed > 4) break;
      const r = race(TRACKS[0]!, botField(), { laps: 3, seed });
      for (const e of run(r, 60 * 140)) {
        if (e.type === "use") used.add(e.item);
        if (e.type === "hit") hits++;
      }
    }
    expect([...used].sort()).toEqual([...ITEM_KINDS].sort());
    expect(hits).toBeGreaterThan(10);
  });

  it("start with some bots timing the lights", () => {
    const r = race(TRACKS[0]!, botField(), { seed: 1 });
    const events = run(r, 215);
    const starts = events.filter((e) => e.type === "boost" && e.source === "start");
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.length).toBeLessThan(8);
  });

  it("stay out of each other's way well enough that few hit a barrier", { timeout: 60000 }, () => {
    const r = race(TRACKS[1]!, botField(), { seed: 5 });
    const events = run(r, 60 * 100);
    expect(count(events, "wall")).toBeLessThan(40);
  });
});

describe("the rubber band", () => {
  // The open arena, with no items to make luck: only the band differs between the runs.
  const length = TrackGeometry.build(ARENA).length;
  /** How far round (in laps) the bot, kart 1, is after 40 s, a still player (kart 0) claiming to be at `player` metres, or keeping level with it; and its top speed. */
  const lapsDone = (player: number | "level", skill: number) => {
    const r = race(ARENA, racers(1, 1, skill), { seed: 1, laps: 5 });
    toGo(r);
    let top = 0;
    for (let i = 0; i < 40; i++) {
      const bot = view(r, 1);
      patch(r, 0, { progress: player === "level" ? (bot.lap - 1 + bot.lapProgress) * length : player });
      for (let t = 0; t < 60; t++) {
        run(r, 1);
        const k = view(r, 1);
        if (k.boost === 0) top = Math.max(top, k.speed);
      }
    }
    const k = view(r, 1);
    return { laps: k.lap - 1 + k.lapProgress, top };
  };

  it("eases a bot far ahead of the best player and pushes one far behind, by a few per cent", { timeout: 60000 }, () => {
    const level = lapsDone("level", 0.5).laps;
    // A player still on the grid: the bot soon gets far ahead of the best player and eases off.
    const ahead = lapsDone(-3, 0.5).laps;
    // A player more than a lap ahead (standing there, as far as it can tell): the bot is far behind and pushes.
    const behind = lapsDone(2 * length, 0.5).laps;
    expect(ahead).toBeLessThan(level * 0.97);
    expect(behind).toBeGreaterThan(level * 1.02);
    // A few per cent, not a different race.
    expect(ahead).toBeGreaterThan(level * 0.9);
    expect(behind).toBeLessThan(level * 1.1);
  });

  it("never pushes a bot past the road's own top speed: a sharp one far behind is no faster than any kart", { timeout: 60000 }, () => {
    const behind = lapsDone(2 * length, 1);
    expect(behind.top).toBeLessThanOrEqual(TUNING.drive.topSpeed + 0.05);
    // A gentle one far behind does push, up to that.
    const gentle = lapsDone(2 * length, 0.2);
    expect(gentle.top).toBeGreaterThan(TUNING.drive.topSpeed * (TUNING.bots.topSpeedLow + 0.2 * (TUNING.bots.topSpeedHigh - TUNING.bots.topSpeedLow)) + 0.3);
    expect(gentle.top).toBeLessThanOrEqual(TUNING.drive.topSpeed + 0.05);
  });

  it("with no player, holds the bots to the middle of the field: two equal bots side by side are neither held back nor pushed on", () => {
    const r = race(ARENA, racers(0, 2, 1), { seed: 1 });
    toGo(r);
    run(r, 60 * 30);
    // Two equal bots side by side: neither is held back or pushed on.
    expect(Math.abs(view(r, 0).speed - view(r, 1).speed)).toBeLessThan(1.5);
  });
});

/** The first bend with a straight of at least `run` metres before it. */
function bendAfterStraight(track: TrackDef, run = 120): Corner {
  const plan = planFor(track);
  const corners = plan.corners;
  for (let i = 0; i < corners.length; i++) {
    const before = corners[(i - 1 + corners.length) % corners.length]!;
    if (plan.geo.wrap(corners[i]!.from - before.to) >= run) return corners[i]!;
  }
  throw new Error(`${track.id}: no bend after a straight of ${run} m`);
}

/** Puts kart `kart` at `s` metres along the lap (progress too, on lap 1), `offset` right of the centre, going `speed` m/s along the road. */
function place(r: SimRace, track: TrackDef, kart: number, s: number, offset: number, speed: number, extra: Partial<Record<keyof typeof KART_AT, number>> = {}): void {
  const geo = planFor(track).geo;
  const p = geo.point(s, offset);
  const h = geo.heading(s);
  patch(r, kart, { x: p.x, z: p.z, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, s: geo.wrap(s), offset, progress: geo.wrap(s), ...extra });
}

/** Bots with these temperaments, in this order (names tried until the grid deals them so). */
function cast(wanted: Temperament[]): RacerSetup[] {
  for (let attempt = 0; attempt < 500; attempt++) {
    const list: RacerSetup[] = wanted.map((_, i) => ({ id: i, name: `Bot ${attempt}-${i}`, colour: "#ffffff", player: null, skill: 1 }));
    const dealt = temperaments({ track: MEADOW_LOOP, laps: 3, seed: 1, racers: list });
    if (wanted.every((t, i) => dealt.get(i) === t)) return list;
  }
  throw new Error(`no names deal ${wanted.join(", ")}`);
}

/** Kart `kart`'s numbers in the race now. */
function row(r: SimRace, kart = 0): number[] {
  return (r.snapshot().k as number[][])[kart]!;
}

describe("temperaments", () => {
  it("are mixed on every grid, and a bot keeps its own through a cup", () => {
    for (let bots = 3; bots <= 8; bots++) {
      const field = roomField(bots, 0);
      const dealt = temperaments({ track: MEADOW_LOOP, laps: 3, seed: bots, racers: field });
      const kinds = new Set(field.filter((r) => r.player === null).map((r) => dealt.get(r.id)));
      expect([...kinds].sort()).toEqual([...TEMPERAMENTS].sort());
      expect(dealt.get(field.find((r) => r.player !== null)!.id)).toBe("steady");
      // The next race of a cup: the same bots on a new grid (new ids, new order, a new seed): each keeps its temperament.
      const regrid = [...field].reverse().map((r, i) => ({ ...r, id: i }));
      const again = temperaments({ track: HARBOUR_LIGHTS, laps: 3, seed: 99, racers: regrid });
      for (const r of field) expect(again.get(regrid.find((x) => x.name === r.name)!.id), r.name).toBe(dealt.get(r.id));
    }
  });

  it("make the careful err rarely and the erratic often, and nobody beside an open edge", () => {
    const corner: Corner = { from: 0, apex: 20, to: 40, dir: 1, peak: 1 / 30, open: false, ice: false };
    const world = { setup: { seed: 5 } } as never;
    const mistakes = (temperament: Temperament) => {
      const style = { ...TUNING.bots.styles[temperament], temperament };
      let n = 0;
      for (let pass = 0; pass < 200; pass++) {
        for (let index = 0; index < 10; index++) {
          const bend: BendNear = { c: corner, index, toFrom: 10, toApex: 30, toEnd: 50, pass };
          if (takeOf(world, { id: 3, skill: 0.6, finished: null } as never, style, bend, 0).mistake !== null) n++;
        }
      }
      return n / 2000;
    };
    const careful = mistakes("careful");
    const erratic = mistakes("erratic");
    expect(careful).toBeGreaterThan(0);
    expect(careful).toBeLessThan(0.05);
    expect(erratic).toBeGreaterThan(careful * 4);
    expect(erratic).toBeLessThan(0.3);
    const style = { ...TUNING.bots.styles.erratic, temperament: "erratic" as const };
    for (let pass = 0; pass < 200; pass++) {
      const take = takeOf(world, { id: 1, skill: 0, finished: null } as never, style, { c: { ...corner, open: true }, index: 0, toFrom: 0, toApex: 20, toEnd: 40, pass }, 1);
      expect(take.mistake).toBeNull();
    }
  });
});

describe("no two laps alike", () => {
  it("a bot alone takes its line and its lap times differently each lap, and the same seed replays it exactly", { timeout: 60000 }, () => {
    const track = MEADOW_LOOP;
    const geo = planFor(track).geo;
    const lapRun = (seed: number) => {
      const r = race(track, racers(0, 1, 0.7), { laps: 3, seed });
      const bins = Math.floor(geo.length / 5);
      const offsets = Array.from({ length: 4 }, () => new Array<number>(bins).fill(Number.NaN));
      const laps: number[] = [];
      let last = 0;
      for (let i = 0; i < 60 * 300 && r.view().phase !== "finished"; i++) {
        r.step(new Map());
        const k = row(r);
        const lap = k[KART_AT.lap]!;
        if (lap <= 3 && r.view().phase === "racing") offsets[lap]![Math.floor(k[KART_AT.s]! / 5) % bins] = k[KART_AT.offset]!;
        for (const e of r.takeEvents()) {
          if (e.type === "lap" || e.type === "finish") {
            const at = e.type === "finish" ? e.time : r.view().time;
            laps.push(at - last);
            last = at;
          }
        }
      }
      let spread = 0;
      let n = 0;
      for (let b = 0; b < bins; b++) {
        const d = Math.abs(offsets[2]![b]! - offsets[3]![b]!);
        if (Number.isFinite(d)) {
          spread += d;
          n++;
        }
      }
      return { line: spread / n, laps, snap: JSON.stringify(r.snapshot()) };
    };
    const a = lapRun(4);
    const b = lapRun(5);
    // Laps 2 and 3 (both flying laps) differ across the road, and in time (two laps can still tie by chance, so in one
    // of two races at least); not a different race.
    expect(a.line).toBeGreaterThan(0.6);
    const apart = (run: { laps: number[] }) => Math.abs(run.laps[1]! - run.laps[2]!);
    expect(Math.max(apart(a), apart(b))).toBeGreaterThan(0.05);
    expect(apart(a)).toBeLessThan(4);
    expect(lapRun(4).snap).toBe(a.snap);
    expect(b.snap).not.toBe(a.snap);
  });
});

describe("racecraft", () => {
  it("a faster bot that catches a slower one goes by on a side of its own, not through it", { timeout: 60000 }, () => {
    for (const track of [HARBOUR_LIGHTS, MEADOW_LOOP]) {
      const bend = bendAfterStraight(track);
      const start = bend.from - 110;
      for (const temperament of ["aggressive", "careful", "erratic"] as const) {
        // Three bots, one of each temperament; the third waits far behind.
        const r = race(track, cast([temperament, ...TEMPERAMENTS.filter((t) => t !== temperament)]), { seed: 3 });
        toGo(r);
        // Kart 1 crawls (as a storm leaves it) 25 m ahead; kart 0 comes up behind it on the same line, much faster.
        place(r, track, 1, start + 25, 0, 13, { zap: 400 });
        place(r, track, 0, start, 0, 23);
        place(r, track, 2, start - 300, 0, 0, { zap: 600 });
        let closest = Infinity;
        let bumps = 0;
        let passed = false;
        // Until it is by (what an item box hands out after is another story).
        for (let i = 0; i < 60 * 8 && !passed; i++) {
          bumps += count(run(r, 1), "bump");
          const gap = row(r, 1)[KART_AT.progress]! - row(r, 0)[KART_AT.progress]!;
          closest = Math.min(closest, Math.hypot(row(r, 1)[KART_AT.x]! - row(r, 0)[KART_AT.x]!, row(r, 1)[KART_AT.z]! - row(r, 0)[KART_AT.z]!));
          // By: clear ahead by nearly two kart lengths.
          if (gap < -4) passed = true;
        }
        const where = `${track.id} ${temperament}`;
        expect(passed, where).toBe(true);
        expect(bumps, where).toBe(0);
        // Never touching (karts that touch are pushed apart to exactly two radii).
        expect(closest, where).toBeGreaterThan(2 * TUNING.kartRadius + 0.1);
      }
    }
  });

  it("a careful bot covers the inside of the next bend from a kart close behind", { timeout: 60000 }, () => {
    const track = HARBOUR_LIGHTS;
    const bend = bendAfterStraight(track);
    const geo = planFor(track).geo;
    /** The careful bot's offset toward the inside, on average over the last 30 m before the bend, with the other kart this far behind. */
    const inside = (behind: number) => {
      const r = race(track, cast(["careful", "aggressive"]), { seed: 2 });
      toGo(r);
      place(r, track, 0, bend.from - 90, 0, 21);
      place(r, track, 1, bend.from - 90 - behind, 0, 23);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 60 * 6; i++) {
        run(r, 1);
        const k = row(r);
        const to = geo.delta(k[KART_AT.s]!, bend.from);
        if (to > 0 && to < 30) {
          sum += k[KART_AT.offset]! * bend.dir;
          n++;
        }
      }
      return sum / n;
    };
    expect(inside(7)).toBeGreaterThan(inside(150) + 0.8);
  });

  it("the bots fight each other: places change hands and karts touch, in a field of bots alone", { timeout: 120000 }, () => {
    let changes = 0;
    let bumps = 0;
    for (const seed of [1, 2]) {
      const r = race(MEADOW_LOOP, botField(), { laps: 3, seed });
      const order = () => (r.snapshot().k as number[][]).map((k, i) => ({ i, p: k[KART_AT.progress]! })).sort((a, b) => b.p - a.p).map((x) => x.i);
      let was: number[] | null = null;
      for (let i = 0; i < 60 * 200 && r.view().phase !== "finished"; i++) {
        r.step(new Map());
        bumps += count(r.takeEvents(), "bump");
        if (i % 30 !== 0 || r.view().phase !== "racing") continue;
        const now = order();
        if (was) for (let p = 0; p < now.length; p++) if (now[p] !== was[p]) changes++;
        was = now;
      }
    }
    expect(changes).toBeGreaterThan(30);
    expect(bumps).toBeGreaterThan(5);
  });
});

describe("items with intent", () => {
  it("a Nitro is saved for a straight or a bend's way out, not burnt going into a bend", () => {
    for (const track of [HARBOUR_LIGHTS, MEADOW_LOOP]) {
      const plan = planFor(track);
      const bend = bendAfterStraight(track);
      const r = race(track, cast(["aggressive"]), { seed: 1 });
      toGo(r);
      place(r, track, 0, bend.from - 10, 0, 18);
      give(r, 0, "nitro");
      let usedAt = Number.NaN;
      for (let i = 0; i < 60 * 12 && Number.isNaN(usedAt); i++) {
        if (run(r, 1).some((e) => e.type === "use")) usedAt = row(r)[KART_AT.s]!;
      }
      expect(Number.isNaN(usedAt), track.id).toBe(false);
      expect(tableAt(plan, plan.speed, usedAt + 45), `${track.id} used at ${usedAt.toFixed(0)}`).toBeGreaterThan(26);
    }
  });

  it("a Slick is held while nobody is behind, and dropped in front of a kart close on its tail", () => {
    const track = HARBOUR_LIGHTS;
    const bend = bendAfterStraight(track, 100);
    const r = race(track, cast(["careful", "aggressive"]), { seed: 1 });
    toGo(r);
    place(r, track, 0, bend.from - 100, 0, 20);
    place(r, track, 1, bend.from - 400, 0, 0, { zap: 60 * 30 });
    give(r, 0, "slick");
    // Twenty seconds alone: more than the longest it holds anything else.
    expect(run(r, 60 * 20).filter((e) => e.type === "use")).toHaveLength(0);
    // Then a kart right behind it.
    const k = row(r);
    place(r, track, 1, k[KART_AT.s]! - 10, k[KART_AT.offset]!, 22, { zap: 0 });
    expect(run(r, 60 * 4).some((e) => e.type === "use" && e.kart === 0 && e.item === "slick")).toBe(true);
  });

  it("a Puck is fired at a kart lined up ahead on a straight, and hits it", () => {
    const track = HARBOUR_LIGHTS;
    const bend = bendAfterStraight(track, 140);
    // Kart 1 is a person driving straight on, who does not see it coming.
    const r = race(track, racers(0, 1).concat({ id: 1, name: "You", colour: "#ff0000", player: 0 }), { seed: 1 });
    toGo(r);
    place(r, track, 1, bend.from - 100, 0, 18);
    place(r, track, 0, bend.from - 125, 0, 18);
    give(r, 0, "puck");
    const events = run(r, 60 * 3, () => new Map([[1, { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: 0 }]]));
    expect(events.some((e) => e.type === "use" && e.kart === 0)).toBe(true);
    expect(events.some((e) => e.type === "hit" && e.kart === 1 && e.by === 0)).toBe(true);
  });

  it("a sharp bot sees a Puck coming from behind and swerves out of its way", () => {
    const track = HARBOUR_LIGHTS;
    const bend = bendAfterStraight(track, 140);
    // Kart 1 is a person 20 m behind the bot on the same line, with a Puck.
    const r = race(track, racers(0, 1, 1).concat({ id: 1, name: "You", colour: "#ff0000", player: 0 }), { seed: 1 });
    toGo(r);
    place(r, track, 0, bend.from - 110, 0, 20);
    place(r, track, 1, bend.from - 130, 0, 20);
    give(r, 1, "puck");
    const press = (presses: number) => () => new Map([[1, { steer: 0, throttle: 1, brake: 0, drift: false, itemPresses: presses }]]);
    run(r, 20, press(0));
    const events = run(r, 60 * 3, press(1));
    expect(events.some((e) => e.type === "use" && e.kart === 1)).toBe(true);
    expect(events.some((e) => e.type === "hit" && e.kart === 0)).toBe(false);
  });
});

describe("a bot looking ahead for hazards", () => {
  it("reads the road at each look-ahead step exactly as the track gives it", () => {
    const into = new Float64Array(LOOK_STEPS.length * 4);
    for (const track of TRACKS) {
      const geo = TrackGeometry.build(track);
      for (const s of [0, 3.7, geo.length * 0.31, geo.length - 2.2]) {
        for (const speed of [8, 17.3, 31]) {
          roadAhead(geo, s, speed, into);
          LOOK_STEPS.forEach((t, step) => {
            const at = geo.at(s + speed * t);
            expect([into[4 * step], into[4 * step + 1], into[4 * step + 2], into[4 * step + 3]], `${track.id} ${s} ${speed} ${t}`).toEqual([at.x, at.z, at.tx, at.tz]);
          });
        }
      }
    }
  });
});
