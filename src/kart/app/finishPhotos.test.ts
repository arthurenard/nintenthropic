import { describe, expect, it } from "vitest";
import type { KartView, RaceView, WheelStatus } from "../contract";
import { GO_TICK } from "../sim/kart";
import { input, patch, race, racers, toGo } from "../sim/testing";
import { TrackGeometry } from "../track/geometry";
import { HARBOUR_LIGHTS } from "../track/tracks";
import { BURST, FinishShutter, PhotoBurst, arrangePhotos, arrangePodium, layoutPodium, reaction, type PhotoBox } from "./finishPhotos";

const GEO = TrackGeometry.build(HARBOUR_LIGHTS);

/** A one-lap race of two people, past the countdown, kart 0 `short` metres before the line at 20 m/s and kart 1 well back. */
function nearlyHome(short: number) {
  const r = race(HARBOUR_LIGHTS, racers(2, 0), { laps: 1, seed: 3 });
  toGo(r);
  const s = GEO.length - short;
  const p = GEO.point(s, -2);
  const h = GEO.heading(s);
  patch(r, 0, { x: p.x, z: p.z, s, offset: -2, progress: s, heading: h, vx: Math.sin(h) * 20, vz: Math.cos(h) * 20, lapStart: 0 });
  // (The snapshot's restore drops the events waiting for a view: the first one below starts clean.)
  r.view();
  return r;
}

const throttle = new Map([
  [0, input({ throttle: 1 })],
  [1, input({ throttle: 1 })],
]);

describe("when a finish-line photo is taken", () => {
  it("on the tick the sim says the kart finished, once, and only for the karts watched", () => {
    const r = nearlyHome(3);
    const shutter = new FinishShutter();
    const shots: { tick: number; karts: number[]; finished: boolean }[] = [];
    for (let i = 0; i < 120; i++) {
      r.step(throttle);
      const view = r.view();
      const karts = shutter.due(view, [0]);
      if (karts.length) shots.push({ tick: view.tick, karts, finished: view.events.some((event) => event.type === "finish" && event.kart === 0) });
    }
    // 3 m at 20 m/s is about nine ticks: one photo, on the tick of the finish event.
    expect(shots).toHaveLength(1);
    expect(shots[0]!.karts).toEqual([0]);
    expect(shots[0]!.finished).toBe(true);
    expect(shots[0]!.tick - GO_TICK).toBeLessThan(20);
    expect(shutter.has(0)).toBe(true);
    // Kart 1 was not watched (a bot's, a keyboard player's, another device's): nothing for it.
    expect(shutter.has(1)).toBe(false);
  });

  it("from the kart's own finish when the event was not seen, and never twice", () => {
    const r = nearlyHome(3);
    const shutter = new FinishShutter();
    for (let i = 0; i < 30; i++) r.step(throttle);
    // The finish went by in views nobody looked at (the race screen was still loading): the next view says it.
    r.view();
    const later = r.view();
    expect(later.events).toEqual([]);
    expect(later.karts.find((kart) => kart.id === 0)!.finished).not.toBeNull();
    expect(shutter.due(later, [0, 1])).toEqual([0]);
    r.step(throttle);
    expect(shutter.due(r.view(), [0, 1])).toEqual([]);
  });

  it("at the end for a player still on the road when the race is decided, and again in a new race", () => {
    const shutter = new FinishShutter();
    const kart = (over: Partial<KartView> = {}): KartView => ({ id: 2, lap: 2, lapProgress: 0.4, finished: null, ...over }) as KartView;
    const view = (tick: number, phase: RaceView["phase"], karts: KartView[], events: RaceView["events"] = []): RaceView =>
      ({ tick, phase, laps: 3, karts, events }) as unknown as RaceView;
    expect(shutter.due(view(400, "racing", [kart()]), [2])).toEqual([]);
    expect(shutter.due(view(401, "finished", [kart()]), [2])).toEqual([2]);
    expect(shutter.due(view(402, "finished", [kart()]), [2])).toEqual([]);
    // A restart: the clock goes back, and the kart is photographed afresh when it finishes.
    expect(shutter.due(view(10, "countdown", [kart({ lap: 1, lapProgress: 0 })]), [2])).toEqual([]);
    const finish = { id: 1, tick: 900, type: "finish", kart: 2, place: 4, time: 61.2 } as const;
    expect(shutter.due(view(900, "racing", [kart({ lap: 4, lapProgress: 0, finished: 61.2 })], [finish]), [2])).toEqual([2]);
  });
});

describe("which still of the burst after the line is kept", () => {
  const status = (over: Partial<WheelStatus>): WheelStatus => ({ hands: 2, left: null, right: null, angle: 0, steer: 0, grip: "fists", mode: "drive", levelled: true, ...over });

  it("scores a cheer over a wave over hands let go of the wheel over hands still on it", () => {
    expect(reaction(status({ emote: "cheer", grip: "open" }))).toBeGreaterThan(reaction(status({ emote: "wave" })));
    expect(reaction(status({ emote: "wave" }))).toBeGreaterThan(reaction(status({ grip: "open" })));
    expect(reaction(status({ grip: "one-open" }))).toBeGreaterThan(reaction(status({ grip: "fists" })));
    expect(reaction(status({ grip: "none", hands: 0, mode: "lost" }))).toBe(0);
    expect(reaction(null)).toBe(0);
  });

  /** Runs a burst at 60 frames a second from t=1000 ms, each still named by its time; `score` says how much each shows. */
  function run(score: (t: number) => number, missing: (t: number) => boolean = () => false) {
    const burst = new PhotoBurst<number>(1000);
    const taken: number[] = [];
    for (let t = 1000; !burst.over && t < 4000; t += 1000 / 60) {
      if (!burst.due(t)) continue;
      taken.push(Math.round(t - 1000));
      burst.offer(missing(t) ? null : t, score(t), t);
    }
    return { burst, taken };
  }

  it("takes a still on the frame of the line and then every 300 ms for 1.2 s", () => {
    const { burst, taken } = run(() => 0);
    expect(taken).toHaveLength(BURST.ms / BURST.every + 1);
    expect(taken[0]).toBe(0);
    for (let i = 1; i < taken.length; i++) expect(taken[i]! - taken[i - 1]!).toBeGreaterThanOrEqual(BURST.every - 1);
    // Nothing better came: the photo is the moment they crossed the line.
    expect(burst.best).toBe(1000);
  });

  it("keeps the first still that caught them cheering, and skips one that could not be taken", () => {
    const { burst } = run((t) => (t >= 1550 ? 3 : t >= 1250 ? 1 : 0));
    expect(burst.best! - 1000).toBeGreaterThanOrEqual(550);
    expect(burst.best! - 1000).toBeLessThan(900);
    const { burst: blind } = run(() => 0, (t) => t < 1100);
    expect(blind.best! - 1000).toBeGreaterThanOrEqual(300);
  });
});

describe("laying the photos out", () => {
  const widths = (rows: ReturnType<typeof arrangePhotos>, aspects: number[], gap: number) =>
    rows.map((row) => row.items.reduce((sum, i) => sum + aspects[i]! * row.height, 0) + gap * (row.items.length - 1));

  it("gives one photo the whole width, or as much as the height allows", () => {
    expect(arrangePhotos([16 / 9], 480, 400, 12)).toEqual([{ items: [0], height: 270 }]);
    // A tall one comes down to the room there is, and is narrower than the width.
    const [tall] = arrangePhotos([3 / 4], 480, 400, 12);
    expect(tall!.height).toBeCloseTo(400, 6);
  });

  it("keeps every row one height, every picture whole, and the lot inside the space", () => {
    const cases: [number[], number, number][] = [
      [[16 / 9, 16 / 9, 16 / 9, 16 / 9], 358, 250],
      [[3 / 4, 3 / 4, 3 / 4, 3 / 4], 760, 300],
      [[16 / 9, 8 / 9, 8 / 9], 440, 480],
      [[4 / 3, 16 / 9, 3 / 4], 1000, 220],
    ];
    for (const [aspects, width, height] of cases) {
      const rows = arrangePhotos(aspects, width, height, 12);
      // Every photo once, in order.
      expect(rows.flatMap((row) => row.items)).toEqual(aspects.map((_, i) => i));
      for (const across of widths(rows, aspects, 12)) expect(across).toBeLessThanOrEqual(width + 1e-6);
      const tall = rows.reduce((sum, row) => sum + row.height, 0) + 12 * (rows.length - 1);
      expect(tall).toBeLessThanOrEqual(height + 1e-6);
    }
  });

  it("gives the best placed the biggest photo, in a row of its own, the rest under it, all inside the space", () => {
    const cases: [number[], number, number][] = [
      [[16 / 9, 16 / 9], 540, 420],
      [[16 / 9, 16 / 9, 16 / 9, 16 / 9], 540, 420],
      [[3 / 4, 3 / 4, 3 / 4], 1104, 456],
      [[4 / 3, 16 / 9, 3 / 4, 3 / 4], 358, 300],
    ];
    for (const [aspects, width, height] of cases) {
      const rows = arrangePodium(aspects, width, height, 12);
      expect(rows[0]!.items).toEqual([0]);
      expect(rows.flatMap((row) => row.items)).toEqual(aspects.map((_, i) => i));
      for (const row of rows.slice(1)) expect(row.height).toBeLessThanOrEqual(rows[0]!.height * 0.7 + 1e-6);
      for (const across of widths(rows, aspects, 12)) expect(across).toBeLessThanOrEqual(width + 1e-6);
      const tall = rows.reduce((sum, row) => sum + row.height, 0) + 12 * (rows.length - 1);
      expect(tall).toBeLessThanOrEqual(height + 1e-6);
    }
    // One photo is simply laid out.
    expect(arrangePodium([16 / 9], 480, 400, 12)).toEqual(arrangePhotos([16 / 9], 480, 400, 12));
  });

  it("lays the cards out without overlap inside the space, the leader the biggest: stacked for wide photos, beside the rest for tall ones", () => {
    const overlap = (a: PhotoBox, b: PhotoBox) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
    const cases: [number[], number, number][] = [
      [[16 / 9, 16 / 9, 16 / 9, 16 / 9], 540, 400],
      [[3 / 4, 3 / 4], 540, 400],
      [[3 / 4, 3 / 4, 3 / 4, 3 / 4], 540, 400],
      [[16 / 9, 3 / 4, 4 / 3], 1104, 456],
      [[3 / 4, 16 / 9], 358, 300],
    ];
    for (const [aspects, width, height] of cases) {
      const laid = layoutPodium(aspects, width, height, 12);
      expect(laid.boxes).toHaveLength(aspects.length);
      expect(laid.width).toBeLessThanOrEqual(width + 1e-6);
      expect(laid.height).toBeLessThanOrEqual(height + 1e-6);
      laid.boxes.forEach((box, i) => {
        // Whole pictures, inside the whole, none over another, none taller than the leader.
        expect(box.w / box.h).toBeCloseTo(aspects[i]!, 6);
        expect(box.x).toBeGreaterThanOrEqual(-1e-6);
        expect(box.y).toBeGreaterThanOrEqual(-1e-6);
        expect(box.x + box.w).toBeLessThanOrEqual(laid.width + 1e-6);
        expect(box.y + box.h).toBeLessThanOrEqual(laid.height + 1e-6);
        if (i > 0) expect(box.h).toBeLessThanOrEqual(laid.boxes[0]!.h * 0.7 + 1e-6);
        for (const other of laid.boxes.slice(i + 1)) expect(overlap(box, other)).toBe(false);
      });
    }
    // Four on one camera (tall photos), beside the table: the winner as tall as there is room for, the others beside them.
    const tall = layoutPodium([3 / 4, 3 / 4, 3 / 4, 3 / 4], 540, 400, 12);
    expect(tall.boxes[0]!.h).toBeGreaterThan(330);
    expect(tall.boxes[1]!.x).toBeGreaterThan(tall.boxes[0]!.w);
    // Wide ones stack: the winner across the top.
    const wide = layoutPodium([16 / 9, 16 / 9, 16 / 9], 540, 400, 12);
    expect(wide.boxes[1]!.y).toBeGreaterThan(wide.boxes[0]!.h);
  });

  it("puts four wide photos in two rows on a phone, and four tall ones in a row on a wide screen", () => {
    expect(arrangePhotos([16 / 9, 16 / 9, 16 / 9, 16 / 9], 358, 250, 12).map((row) => row.items)).toEqual([[0, 1], [2, 3]]);
    expect(arrangePhotos([3 / 4, 3 / 4, 3 / 4, 3 / 4], 760, 300, 12).map((row) => row.items)).toEqual([[0, 1, 2, 3]]);
    expect(arrangePhotos([], 400, 300, 12)).toEqual([]);
  });
});
