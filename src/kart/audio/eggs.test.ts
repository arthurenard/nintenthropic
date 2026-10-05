import { describe, expect, it } from "vitest";
import type { KartView, RaceEvent } from "../contract";
import { ordersFor } from "./events";
import type { Scene } from "./scene";

const kart = (id: number, x: number, z = 0): KartView => ({ id, x, y: 0, z, heading: 0 }) as unknown as KartView;

/** Kart 0 is the one on this screen; 1 is near it, 2 is far. */
const scene: Scene = { locals: [{ kart: 0, pan: 0 }], karts: new Map([[0, kart(0, 0)], [1, kart(1, 15)], [2, kart(2, 400)]]), laps: 3 };

const event = (e: object): RaceEvent => ({ id: 1, tick: 0, ...e }) as RaceEvent;

describe("the horn and the duck", () => {
  it("honks in full for the player's own kart", () => {
    const [order, ...rest] = ordersFor(event({ type: "horn", kart: 0 }), scene);
    expect(rest).toEqual([]);
    expect(order).toMatchObject({ cue: "kart_horn", distance: 0, priority: 3 });
    expect(order!.volume).toBe(1);
  });

  it("honks from where another kart is: quieter and to a side with distance, and not at all from far away", () => {
    const [near] = ordersFor(event({ type: "horn", kart: 1 }), scene);
    expect(near).toMatchObject({ cue: "kart_horn" });
    expect(near!.distance).toBeCloseTo(15, 1);
    expect(near!.volume).toBeLessThan(1);
    expect(ordersFor(event({ type: "horn", kart: 2 }), scene)).toEqual([]);
  });

  it("gives each kart a horn of its own pitch", () => {
    const rates = new Set([0, 1, 3].map((k) => ordersFor(event({ type: "horn", kart: k }), { ...scene, karts: new Map([...scene.karts, [3, kart(3, 5)]]) })[0]?.rate));
    expect(rates.size).toBe(3);
  });

  it("squeaks the duck for the finder, a beat after the drive-by one and higher", () => {
    const [order, ...rest] = ordersFor(event({ type: "duck", kart: 0 }), scene);
    expect(rest).toEqual([]);
    expect(order).toMatchObject({ cue: "kart_duck", distance: 0 });
    expect(order!.rate).toBeGreaterThan(1);
    expect(order!.delay).toBeGreaterThan(0);
    // A kart that finds it far away is not heard.
    expect(ordersFor(event({ type: "duck", kart: 2 }), scene)).toEqual([]);
  });
});
