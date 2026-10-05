import { describe, expect, it } from "vitest";
import type { RaceEvent, RacerSetup } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS, TRACKS } from "../track/tracks";
import { ITEM_KINDS } from "./state";
import { ARENA, count, patch, race, racers, reach, run, toGo, view } from "./testing";

/** Eight bots of every skill from sharp to gentle. */
function field(): RacerSetup[] {
  return Array.from({ length: 8 }, (_, i) => ({ id: i, name: `Bot ${i}`, colour: "#ffffff", player: null, skill: 1 - i * 0.1 }));
}

describe("a bot driving alone", () => {
  for (const track of TRACKS) {
    for (const skill of [1, 0.5, 0]) {
      it(`laps ${track.name} in a sane time and never goes past a barrier (skill ${skill})`, () => {
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
      it(`finish three laps of ${track.name} and the race ends with sane standings (seed ${seed})`, () => {
        const r = race(track, field(), { laps: 3, seed });
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

  it("use every kind of item, and the hits spin karts out", () => {
    const used = new Set<string>();
    let hits = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = race(TRACKS[0]!, field(), { laps: 3, seed });
      for (const e of run(r, 60 * 140)) {
        if (e.type === "use") used.add(e.item);
        if (e.type === "hit") hits++;
      }
    }
    expect([...used].sort()).toEqual([...ITEM_KINDS].sort());
    expect(hits).toBeGreaterThan(10);
  });

  it("start with some bots timing the lights", () => {
    const r = race(TRACKS[0]!, field(), { seed: 1 });
    const events = run(r, 215);
    const starts = events.filter((e) => e.type === "boost" && e.source === "start");
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.length).toBeLessThan(8);
  });

  it("stay out of each other's way well enough that few hit a barrier", () => {
    const r = race(TRACKS[1]!, field(), { seed: 5 });
    const events = run(r, 60 * 100);
    expect(count(events, "wall")).toBeLessThan(40);
  });
});

describe("the rubber band", () => {
  it("eases a bot far ahead of the best player and pushes one far behind, by a few per cent", () => {
    // The open arena, with no items to make luck: only the band differs between the runs.
    const length = TrackGeometry.build(ARENA).length;
    /** How far round (in laps) the bot, kart 1, is after 40 s, a still player (kart 0) claiming to be at `player` metres, or keeping level with it. */
    const lapsDone = (player: number | "level") => {
      const r = race(ARENA, racers(1, 1, 1), { seed: 1, laps: 5 });
      toGo(r);
      for (let i = 0; i < 40; i++) {
        const bot = view(r, 1);
        patch(r, 0, { progress: player === "level" ? (bot.lap - 1 + bot.lapProgress) * length : player });
        run(r, 60);
      }
      const k = view(r, 1);
      return k.lap - 1 + k.lapProgress;
    };
    const level = lapsDone("level");
    // A player still on the grid: the bot soon gets far ahead of the best player and eases off.
    const ahead = lapsDone(-3);
    // A player more than a lap ahead (standing there, as far as it can tell): the bot is far behind and pushes.
    const behind = lapsDone(2 * length);
    expect(ahead).toBeLessThan(level * 0.97);
    expect(behind).toBeGreaterThan(level * 1.02);
    // A few per cent, not a different race.
    expect(ahead).toBeGreaterThan(level * 0.9);
    expect(behind).toBeLessThan(level * 1.1);
  });

  it("leaves bots alone when there is no player to be near", () => {
    const r = race(ARENA, racers(0, 2, 1), { seed: 1 });
    toGo(r);
    run(r, 60 * 30);
    // Two equal bots side by side: neither is held back or pushed on.
    expect(Math.abs(view(r, 0).speed - view(r, 1).speed)).toBeLessThan(1.5);
  });
});
