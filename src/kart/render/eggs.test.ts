import { describe, expect, it } from "vitest";
import { BUBBLE_LIFE, bubbleLook } from "./bubbles";
import { Fireworks, planShow } from "./fireworks";

describe("the honk bubble", () => {
  it("pops in with a little overshoot, drifts up, and fades out by the end of its life", () => {
    expect(bubbleLook(0).opacity).toBe(0);
    const early = bubbleLook(0.05);
    expect(early.scale).toBeLessThan(1);
    expect(early.opacity).toBeGreaterThan(0);
    const peak = bubbleLook(0.16);
    expect(peak.scale).toBeGreaterThan(1.1);
    expect(bubbleLook(0.6)).toMatchObject({ opacity: 1, scale: 1 });
    expect(bubbleLook(0.9).rise).toBeGreaterThan(bubbleLook(0.3).rise);
    expect(bubbleLook(BUBBLE_LIFE - 0.1).opacity).toBeLessThan(0.4);
    expect(bubbleLook(BUBBLE_LIFE).opacity).toBe(0);
    expect(bubbleLook(-1).opacity).toBe(0);
  });

  it("only fades with Reduce Motion: no pop, no rise", () => {
    for (const age of [0.05, 0.16, 0.5, 1.2]) {
      const look = bubbleLook(age, true);
      expect(look.scale).toBe(1);
      expect(look.rise).toBe(0);
    }
    expect(bubbleLook(0.5, true).opacity).toBe(1);
  });
});

describe("the fireworks", () => {
  it("plan the same show from the same seed: a rocket every third of a second or so, ahead of the line", () => {
    const a = planShow(7);
    expect(planShow(7)).toEqual(a);
    expect(planShow(8)).not.toEqual(a);
    expect(a).toHaveLength(14);
    for (let i = 1; i < a.length; i++) expect(a[i]!.at).toBeGreaterThan(a[i - 1]!.at - 0.3);
    for (const shell of a) {
      expect(shell.z).toBeGreaterThan(0);
      expect(shell.burst).toBeGreaterThan(25);
      expect(shell.flight).toBeGreaterThan(0.5);
      expect(shell.colour).not.toBe(shell.second);
    }
    expect(a.at(-1)!.at).toBeLessThan(7);
  });

  it("light up the sky and then leave it empty", () => {
    const show = new Fireworks();
    expect(show.active).toBe(false);
    show.start({ x: 10, y: 0, z: 20 }, 0.5, 3);
    expect(show.group.visible).toBe(true);
    expect(show.active).toBe(true);
    let most = 0;
    for (let t = 0; t < 14; t += 1 / 60) {
      show.update(1 / 60);
      most = Math.max(most, show.live());
    }
    // Several bursts in the sky at once, never more than the pool holds, and then nothing.
    expect(most).toBeGreaterThan(150);
    expect(most).toBeLessThanOrEqual(1400);
    expect(show.live()).toBe(0);
    expect(show.active).toBe(false);
    expect(show.group.visible).toBe(false);
    show.dispose();
  });

  it("burst above the ground and over the road ahead of the line", () => {
    const show = new Fireworks();
    // Facing +z at the origin: the shells are all ahead of it.
    show.start({ x: 0, y: 5, z: 0 }, 0, 1);
    let high = 0;
    let ahead = 0;
    for (let t = 0; t < 6; t += 1 / 30) {
      show.update(1 / 30);
      const positions = show.group.children[0] as unknown as { geometry: { getAttribute(name: string): { getY(i: number): number; getZ(i: number): number } } };
      const pos = positions.geometry.getAttribute("position");
      for (let i = 0; i < 1400; i++) {
        high = Math.max(high, pos.getY(i));
        ahead = Math.max(ahead, pos.getZ(i));
      }
    }
    expect(high).toBeGreaterThan(30);
    expect(ahead).toBeGreaterThan(20);
    show.dispose();
  });

  it("do not start for Reduce Motion, nor twice at once", () => {
    const calm = new Fireworks();
    calm.calm = true;
    calm.start({ x: 0, y: 0, z: 0 }, 0);
    expect(calm.active).toBe(false);
    const show = new Fireworks();
    show.start({ x: 0, y: 0, z: 0 }, 0, 1);
    for (let frame = 0; frame < 60; frame++) {
      show.update(1 / 30);
      // A second show asked for while one is on changes nothing: its rockets would leave far from the first's.
      if (frame === 15) show.start({ x: 99, y: 0, z: 99 }, 0, 2);
    }
    expect(show.live()).toBeGreaterThan(0);
    show.clear();
    expect(show.live()).toBe(0);
    expect(show.active).toBe(false);
  });
});
