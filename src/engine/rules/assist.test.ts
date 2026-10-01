// Aim Assist's shared rules: what the setting scales, and how a shot chooses
// between what it passes through and what it passes beside.
import { describe, expect, it } from "vitest";
import { ASSIST_BOOST, assistFactor, choose, secretFactor, type ShotCandidate } from "./assist";

type Kind = "man" | "innocent" | "secret";
interface Weighed extends ShotCandidate {
  kind: Kind;
  name: string;
}

const RANK: Record<Kind, number> = { man: 0, innocent: 1, secret: 2 };
const rank = (c: Weighed) => RANK[c.kind];
const innocent = (c: Weighed) => c.kind === "innocent";

const weigh = (name: string, kind: Kind, t: number, physical: boolean, score = 0.5): Weighed => ({ name, kind, t, score, physical });
const pick = (list: Weighed[], stopsAt = Number.POSITIVE_INFINITY, guardAt?: number) =>
  choose(list, list.length, stopsAt, rank, innocent, guardAt)?.name ?? null;

describe("what Aim Assist scales", () => {
  it("is exact when it is off, and wider when on", () => {
    expect(assistFactor(false)).toBe(0);
    expect(assistFactor(true)).toBe(ASSIST_BOOST);
    expect(ASSIST_BOOST).toBeGreaterThan(1);
    // A little help, not a magnet: never as much as double.
    expect(ASSIST_BOOST).toBeLessThan(1.6);
  });

  it("reaches High Noon's torso to the aim check's own 3.5% line, from the 2.6% it always had", () => {
    expect(0.026 * ASSIST_BOOST).toBeGreaterThanOrEqual(0.035);
    expect(0.026 * ASSIST_BOOST).toBeLessThan(0.04);
  });

  it("never widens a secret: as the game has it with assist on, none off", () => {
    expect(secretFactor(true)).toBe(1);
    expect(secretFactor(false)).toBe(0);
  });
});

describe("what a shot counts as hitting", () => {
  it("is nothing when it passed through and beside nothing", () => {
    expect(pick([])).toBeNull();
  });

  it("is a real hit before any near miss, however well the near miss ranks", () => {
    const list = [weigh("near man", "man", 10, false, 0), weigh("real secret", "secret", 30, true)];
    expect(pick(list)).toBe("real secret");
  });

  it("is the nearest of the real hits", () => {
    const list = [weigh("far", "man", 30, true), weigh("near", "man", 12, true), weigh("middle", "innocent", 20, true)];
    expect(pick(list)).toBe("near");
  });

  it("leaves a real hit on an innocent as it was: the shot did pass through them", () => {
    const list = [weigh("innocent", "innocent", 10, true), weigh("man behind", "man", 20, true)];
    expect(pick(list)).toBe("innocent");
  });

  it("takes the best near miss by what the player means to shoot, then by how near its middle", () => {
    const list = [weigh("secret", "secret", 10, false, 0.1), weigh("far man", "man", 40, false, 0.9), weigh("near man", "man", 25, false, 0.4)];
    expect(pick(list)).toBe("near man");
  });

  it("is never an innocent, whatever else is missing: no hit is better than a wrong one", () => {
    expect(pick([weigh("innocent", "innocent", 10, false, 0)])).toBeNull();
    // Even with other near misses further down the ranking.
    expect(pick([weigh("innocent", "innocent", 10, false, 0), weigh("secret", "secret", 30, false)])).toBe("secret");
  });

  it("ignores what is behind the scenery, a real hit by a hair and a near miss by half a metre", () => {
    expect(pick([weigh("behind", "man", 31, true)], 30)).toBeNull();
    expect(pick([weigh("just behind", "man", 30.05, true)], 30)).toBe("just behind");
    expect(pick([weigh("behind", "man", 31, false)], 30)).toBeNull();
    expect(pick([weigh("just behind", "man", 30.4, false)], 30)).toBe("just behind");
  });

  it("gives no help past an innocent the shot passed close beside, and still helps what is nearer", () => {
    const list = [weigh("behind her", "man", 30, false), weigh("in front of her", "secret", 12, false)];
    // She is 20 m away and the shot went close beside her: the man behind is no hit, the secret in front still is.
    expect(pick(list, Number.POSITIVE_INFINITY, 20)).toBe("in front of her");
    expect(pick([list[0]!], Number.POSITIVE_INFINITY, 20)).toBeNull();
    // With nobody beside the shot, the man is helped.
    expect(pick([list[0]!])).toBe("behind her");
  });

  it("does not let that take a real hit away", () => {
    expect(pick([weigh("real, behind her", "man", 30, true)], Number.POSITIVE_INFINITY, 20)).toBe("real, behind her");
  });

  it("reads only the candidates counted, not a pool's stale tail", () => {
    const pool = [weigh("counted", "man", 10, false), weigh("stale", "man", 5, true)];
    expect(choose(pool, 1, Number.POSITIVE_INFINITY, rank, innocent)?.name).toBe("counted");
  });
});
