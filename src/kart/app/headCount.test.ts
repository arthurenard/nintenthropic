import { describe, expect, it } from "vitest";
import { COUNT_WINDOW, HeadCounter, SETTLE_AFTER, playersFor } from "./headCount";

describe("playersFor", () => {
  it("is a player for every two hands, an odd one counting, at most four", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(playersFor)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);
  });
});

/** Pictures at 30 a second from `from` for `ms`, each with `hands(t)` hands in it. */
function feed(counter: HeadCounter, from: number, ms: number, hands: (t: number) => number): number {
  let t = from;
  for (; t < from + ms; t += 1000 / 30) counter.push(hands(t), t);
  return t;
}

describe("HeadCounter", () => {
  it("counts two players holding up their fists, and settles once the count has held", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    let t = feed(counter, 0, SETTLE_AFTER - 200, () => 4);
    expect(counter.read(t)).toMatchObject({ players: 2, settled: false });
    t = feed(counter, t, 400, () => 4);
    expect(counter.read(t)).toMatchObject({ players: 2, settled: true, progress: 1 });
  });

  it("does not lose a player whose hands drop out for a few frames", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    // Four hands, but one is missed on every third picture, and both of one player's for a fifth of a second.
    const t = feed(counter, 0, 2500, (at) => (at > 1000 && at < 1200 ? 2 : Math.round(at / (1000 / 30)) % 3 === 0 ? 3 : 4));
    expect(counter.read(t)).toMatchObject({ players: 2, settled: true });
  });

  it("is still two players while half the pictures miss one of them", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    const t = feed(counter, 0, 2500, (at) => (Math.round(at / (1000 / 10)) % 2 === 0 ? 2 : 4));
    expect(counter.read(t)).toMatchObject({ players: 2, settled: true });
  });

  it("adds nobody for a hand seen twice on a picture now and then", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    // Two players' four fists, with a fifth hand on one picture in eight (and two in a row once).
    let changed = 0;
    let was = 0;
    let t = 0;
    for (; t < 4000; t += 1000 / 30) {
      const frame = Math.round(t / (1000 / 30));
      counter.push(frame % 8 === 0 || frame === 61 ? 5 : 4, t);
      const players = counter.read(t).players;
      if (players !== was && was !== 0) changed++;
      was = players;
    }
    expect(counter.read(t)).toMatchObject({ players: 2, settled: true });
    expect(changed).toBe(0);
  });

  it("waits for a friend still raising their fists: a count that changes starts settling again", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    let t = feed(counter, 0, 1000, () => 2);
    expect(counter.read(t).players).toBe(1);
    // A second player's fists come up before the first count has settled.
    t = feed(counter, t, 1000, () => 4);
    const now = counter.read(t);
    expect(now.players).toBe(2);
    expect(now.settled).toBe(false);
    t = feed(counter, t, SETTLE_AFTER, () => 4);
    expect(counter.read(t)).toMatchObject({ players: 2, settled: true });
  });

  it("counts nobody until a hand is seen, and never settles on nobody", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    const t = feed(counter, 0, 3000, () => 0);
    expect(counter.read(t)).toEqual({ players: 0, settled: false, progress: 0 });
  });

  it("lets a player go once their hands have been gone a moment", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    let t = feed(counter, 0, 2000, () => 6);
    expect(counter.read(t).players).toBe(3);
    t = feed(counter, t, COUNT_WINDOW + 100, () => 4);
    expect(counter.read(t)).toMatchObject({ players: 2, settled: false });
  });

  it("holds its last count when pictures stop coming", () => {
    const counter = new HeadCounter();
    counter.reset(0);
    const t = feed(counter, 0, 500, () => 4);
    expect(counter.read(t + 5000)).toMatchObject({ players: 2, settled: true });
  });
});
