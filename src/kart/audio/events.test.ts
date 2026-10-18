import { describe, expect, it } from "vitest";
import type { KartView, RaceEvent } from "../contract";
import { ordersFor } from "./events";
import { falloff, type Scene } from "./scene";

const kart = (id: number, x: number): KartView => ({ id, x, y: 0, z: 0, heading: 0 }) as unknown as KartView;

/** Kart 0 is the one on this screen; 1 is 15 m away, 2 is 25 m away. */
const scene: Scene = { locals: [{ kart: 0, pan: 0 }], karts: new Map([[0, kart(0, 0)], [1, kart(1, 15)], [2, kart(2, 25)]]), laps: 3 };

const event = (e: object): RaceEvent => ({ id: 1, tick: 0, ...e }) as RaceEvent;

describe("another kart's sounds", () => {
  it("are quieter than the player's own, and quieter still the further away they happen", () => {
    const [own] = ordersFor(event({ type: "box", kart: 0 }), scene);
    const [near] = ordersFor(event({ type: "box", kart: 1 }), scene);
    const [far] = ordersFor(event({ type: "box", kart: 2 }), scene);
    expect(own!.volume).toBe(1);
    // The box smash carries 32 m, and another kart's sound starts at 0.8 of the player's own.
    expect(near!.volume).toBeCloseTo(0.8 * falloff(15, 32), 5);
    expect(far!.volume).toBeLessThan(near!.volume);
  });
});
