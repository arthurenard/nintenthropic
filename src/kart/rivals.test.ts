import { describe, expect, it } from "vitest";
import type { RacerSetup } from "./contract";
import { CUP_BARS, Rivalries, Tally, biggestGrudge, grudgeBasis, grudgeLine, keyOf, nemesisOf, pairGrudge, pickAwards, type Person } from "./rivals";

const racers: RacerSetup[] = [
  { id: 0, name: "Kit", colour: "#f00", player: 0 },
  { id: 1, name: "Mango", colour: "#0f0", player: 1 },
  { id: 2, name: "Bun", colour: "#00f", player: 2 },
  { id: 3, name: "Botty", colour: "#999", player: null },
];

const kit: Person = { key: "p0", name: "Kit", human: true };
const mango: Person = { key: "p1", name: "Mango", human: true };
const bun: Person = { key: "p2", name: "Bun", human: true };
const botty: Person = { key: "b:Botty", name: "Botty", human: false };

function standings(order: number[], times?: number[]) {
  return order.map((kart, i) => ({ kart, place: i + 1, time: times ? times[i]! : 60 + i * 5, bestLap: null }));
}

function hits(tally: Tally, by: Person, victim: Person, n: number) {
  for (let i = 0; i < n; i++) tally.hit(by, victim);
}

describe("keys", () => {
  it("keeps a player by slot and a bot by name", () => {
    expect(keyOf({ player: 2, name: "Bun" })).toBe("p2");
    expect(keyOf({ player: null, name: "Botty" })).toBe("b:Botty");
  });
});

describe("the ledger's hits", () => {
  it("attributes a hit to its sender and counts it for the race, the cup and the session", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    const note = r.hit({ kart: 1, by: 0, cause: "puck" });
    expect(note).toMatchObject({ source: "puck", count: 1, revenge: false });
    expect(note?.by.name).toBe("Kit");
    expect(note?.victim.name).toBe("Mango");
    for (const tally of [r.session, r.cup, r.race]) expect(tally.hits("p0", "p1")).toBe(1);
  });

  it("ignores a hazard, a kart's own item and a kart nobody knows", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    expect(r.hit({ kart: 1, by: null, cause: "storm" })).toBeNull();
    expect(r.hit({ kart: 1, by: 1, cause: "slick" })).toBeNull();
    expect(r.hit({ kart: 1, by: 9, cause: "puck" })).toBeNull();
    expect(r.session.totalHits).toBe(0);
  });

  it("counts every source the sim names", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    for (const cause of ["puck", "seeker", "slick", "decoy", "skyrocket", "blast", "comet", "storm"] as const) {
      expect(r.hit({ kart: 2, by: 0, cause })?.source).toBe(cause);
    }
    expect(r.session.hits("p0", "p2")).toBe(8);
  });

  it("counts a bump only when it is hard and one kart was clearly quicker", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    expect(r.bump(0, 1, 0.5, { a: 30, b: 10 })).toBeNull();
    expect(r.bump(0, 1, 0.95, { a: 20, b: 19 })).toBeNull();
    const note = r.bump(0, 1, 0.95, { a: 12, b: 26 });
    expect(note?.source).toBe("bump");
    expect(note?.by.name).toBe("Mango");
    expect(r.session.hits("p1", "p0")).toBe(1);
  });

  it("counts nothing after the race is decided", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.finish(standings([0, 1, 2, 3]));
    expect(r.hit({ kart: 1, by: 0, cause: "puck" })).toBeNull();
  });

  it("starts a race over without counting the abandoned one twice", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.hit({ kart: 1, by: 0, cause: "puck" });
    r.begin(2, racers, null);
    expect(r.session.totalHits).toBe(0);
    r.hit({ kart: 1, by: 0, cause: "puck" });
    r.finish(standings([0, 1, 2, 3]));
    r.begin(3, racers, null);
    expect(r.session.totalHits).toBe(1);
  });

  it("begins a race once: the same id again changes nothing", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.hit({ kart: 1, by: 0, cause: "puck" });
    r.begin(1, racers, null);
    expect(r.race.totalHits).toBe(1);
  });

  it("keeps a cup's tally across its races and starts a new cup afresh", () => {
    const r = new Rivalries();
    r.begin(1, racers, { cup: "a", race: 0 });
    r.hit({ kart: 1, by: 0, cause: "puck" });
    r.finish(standings([0, 1, 2, 3]));
    r.begin(2, racers, { cup: "a", race: 1 });
    r.hit({ kart: 1, by: 0, cause: "puck" });
    expect(r.cup.hits("p0", "p1")).toBe(2);
    expect(r.race.hits("p0", "p1")).toBe(1);
    r.finish(standings([0, 1, 2, 3]));
    r.begin(3, racers, { cup: "b", race: 0 });
    expect(r.cup.totalHits).toBe(0);
    expect(r.session.hits("p0", "p1")).toBe(2);
  });

  it("keeps a player's score when the next race has a different grid", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.hit({ kart: 1, by: 0, cause: "puck" });
    r.finish(standings([0, 1, 2, 3]));
    // Mango and Kit swap kart ids.
    const shuffled = [racers[1]!, racers[0]!, racers[2]!, racers[3]!].map((racer, id) => ({ ...racer, id }));
    r.begin(2, shuffled, null);
    r.hit({ kart: 0, by: 1, cause: "seeker" });
    expect(r.session.hits("p0", "p1")).toBe(2);
  });
});

describe("head to head", () => {
  it("counts who finished ahead of whom among people, and bots against people", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.finish(standings([0, 3, 1, 2]));
    expect(r.session.wins("p0", "p1")).toBe(1);
    expect(r.session.wins("p1", "p0")).toBe(0);
    expect(r.session.wins("b:Botty", "p1")).toBe(1);
  });

  it("counts places gained against the grid", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.finish(standings([2, 3, 1, 0]));
    expect(r.race.gained.get("p2")).toBe(2);
    expect(r.race.gained.get("p0")).toBe(-3);
  });

  it("counts photo finishes for both karts that crossed together", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.finish(standings([0, 1, 2, 3], [50, 50.1, 60, 70]));
    expect(r.race.close.get("p0")).toBe(1);
    expect(r.race.close.get("p1")).toBe(1);
    expect(r.race.close.get("p2")).toBeUndefined();
  });

  it("counts a finish once", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.finish(standings([0, 1, 2, 3]));
    r.finish(standings([0, 1, 2, 3]));
    expect(r.session.races).toBe(1);
  });
});

describe("grudges", () => {
  it("needs three hits between two people", () => {
    const t = new Tally();
    hits(t, kit, mango, 2);
    expect(pairGrudge(t, kit, mango)).toBeNull();
    hits(t, mango, kit, 1);
    const g = pairGrudge(t, kit, mango)!;
    expect(grudgeLine(g)).toBe("Kit vs Mango: 2-1");
    expect(g.basis).toBe("hits");
    expect(grudgeBasis(g)).toBe("Spin-outs between them");
  });

  it("names the one ahead first", () => {
    const t = new Tally();
    hits(t, mango, kit, 3);
    hits(t, kit, mango, 1);
    expect(grudgeLine(pairGrudge(t, kit, mango)!)).toBe("Mango vs Kit: 3-1");
  });

  it("is made by a close head to head too, but not a lopsided one", () => {
    const t = new Tally();
    for (const order of [
      [kit, mango],
      [mango, kit],
      [kit, mango],
    ]) {
      t.finish(order.map((person, i) => ({ person, place: i + 1, grid: i + 1, time: 60 + i })));
    }
    const g = pairGrudge(t, kit, mango)!;
    expect(g.basis).toBe("races");
    expect(grudgeLine(g)).toBe("Kit vs Mango: 2-1");
    const lopsided = new Tally();
    for (let i = 0; i < 4; i++)
      lopsided.finish([
        { person: kit, place: 1, grid: 1, time: 1 },
        { person: mango, place: 2, grid: 2, time: 2 },
      ]);
    expect(pairGrudge(lopsided, kit, mango)).toBeNull();
  });

  it("asks more of a pair with a bot in it, and none of two bots", () => {
    const t = new Tally();
    hits(t, botty, kit, 3);
    expect(pairGrudge(t, kit, botty)).toBeNull();
    hits(t, botty, kit, 1);
    expect(pairGrudge(t, kit, botty)).not.toBeNull();
    const other: Person = { key: "b:Other", name: "Other", human: false };
    const bots = new Tally();
    hits(bots, botty, other, 9);
    expect(pairGrudge(bots, botty, other)).toBeNull();
  });

  it("picks the biggest among the people in the race", () => {
    const t = new Tally();
    hits(t, kit, mango, 3);
    hits(t, bun, kit, 5);
    expect(grudgeLine(biggestGrudge(t)!)).toBe("Bun vs Kit: 5-0");
    expect(biggestGrudge(t, new Set(["p0", "p1"]))!.a.name).toBe("Kit");
    expect(biggestGrudge(t, new Set(["p1", "p2"]))).toBeNull();
  });

  it("says the intro's grudge from the session, for those in the race", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    for (let i = 0; i < 3; i++) r.hit({ kart: 1, by: 0, cause: "puck" });
    r.hit({ kart: 0, by: 1, cause: "seeker" });
    r.finish(standings([0, 1, 2, 3]));
    r.begin(2, racers, null);
    expect(grudgeLine(r.grudge()!)).toBe("Kit vs Mango: 3-1");
    r.begin(
      3,
      [racers[0]!, racers[2]!, racers[3]!].map((x, id) => ({ ...x, id })),
      null,
    );
    expect(r.grudge()).toBeNull();
  });
});

describe("nemesis and revenge", () => {
  it("is whoever has hit you the most, from two hits for a person and three for a bot", () => {
    const t = new Tally();
    t.hit(mango, kit);
    expect(nemesisOf(t, "p0")).toBeNull();
    t.hit(mango, kit);
    expect(nemesisOf(t, "p0")).toBe("p1");
    hits(t, botty, kit, 3);
    expect(nemesisOf(t, "p0")).toBe("p1");
    hits(t, botty, kit, 2);
    expect(nemesisOf(t, "p0")).toBe("b:Botty");
  });

  it("only counts those in the race", () => {
    const t = new Tally();
    hits(t, mango, kit, 2);
    expect(nemesisOf(t, "p0", new Set(["p0", "p2"]))).toBeNull();
  });

  it("is a revenge when you hit your nemesis, and not the first time", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    expect(r.hit({ kart: 0, by: 1, cause: "puck" })?.revenge).toBe(false);
    expect(r.hit({ kart: 0, by: 1, cause: "puck" })?.revenge).toBe(false);
    // Kit hits Mango, who has hit them twice.
    expect(r.hit({ kart: 1, by: 0, cause: "seeker" })?.revenge).toBe(true);
    // Hitting someone else is not.
    expect(r.hit({ kart: 2, by: 0, cause: "seeker" })?.revenge).toBe(false);
  });

  it("knows each player's nemesis by kart for the marker", () => {
    const r = new Rivalries();
    r.begin(1, racers, null);
    r.hit({ kart: 0, by: 1, cause: "puck" });
    r.hit({ kart: 0, by: 1, cause: "puck" });
    expect(r.nemesis(0)).toBe(1);
    expect(r.nemesis(1)).toBeNull();
    expect(r.nemesis(7)).toBeNull();
  });

  it("falls back on the closest head to head when nobody has hit anybody", () => {
    const r = new Rivalries();
    for (let i = 0; i < 3; i++) {
      r.begin(i + 1, racers, null);
      r.finish(standings(i === 1 ? [1, 0, 2, 3] : [0, 1, 2, 3]));
    }
    expect(r.nemesis(0)).toBe(1);
  });
});

describe("awards", () => {
  function race(setup: (r: Rivalries) => void, order = [0, 1, 2, 3], times?: number[]): Rivalries {
    const r = new Rivalries();
    r.begin(1, racers, null);
    setup(r);
    r.finish(standings(order, times));
    return r;
  }
  const ids = (r: Rivalries) => r.raceAwards().map((a) => a.id);

  it("says nothing when there is nothing to say", () => {
    expect(race(() => {}).raceAwards()).toEqual([]);
    expect(new Rivalries().raceAwards()).toEqual([]);
  });

  it("gives Sharpshooter to the most hits, Magnet to the most hit", () => {
    const r = race((x) => {
      x.hit({ kart: 1, by: 0, cause: "puck" });
      x.hit({ kart: 1, by: 0, cause: "puck" });
      x.hit({ kart: 1, by: 0, cause: "seeker" });
    });
    const awards = r.raceAwards();
    const sharp = awards.find((a) => a.id === "sharpshooter")!;
    expect(sharp.names).toEqual(["Kit"]);
    expect(sharp.detail).toBe("Landed 3 hits.");
    expect(awards.find((a) => a.id === "magnet")!.names).toEqual(["Mango"]);
  });

  it("gives Pacifist to a player with no hits when others were busy", () => {
    const r = race((x) => {
      x.hit({ kart: 1, by: 0, cause: "puck" });
      x.hit({ kart: 1, by: 0, cause: "puck" });
      x.hit({ kart: 0, by: 1, cause: "puck" });
    });
    const pacifist = r.raceAwards().find((a) => a.id === "pacifist")!;
    expect(pacifist.names).toEqual(["Bun"]);
    expect(pacifist.detail).toBe("Not one hit all race.");
  });

  it("gives no Pacifist when it was a quiet race", () => {
    const r = race((x) => x.hit({ kart: 1, by: 0, cause: "puck" }));
    expect(ids(r)).not.toContain("pacifist");
  });

  it("gives Comeback Kid for three places or more, to a person", () => {
    const people: RacerSetup[] = [0, 1, 2, 3].map((id) => ({ id, name: `P${id}`, colour: "#fff", player: id }));
    const humans = new Rivalries();
    humans.begin(1, people, null);
    humans.finish(standings([3, 0, 1, 2]));
    const award = humans.raceAwards().find((x) => x.id === "comeback")!;
    expect(award.names).toEqual(["P3"]);
    expect(award.detail).toBe("Gained 3 places.");
    // Two is not enough for a race.
    expect(ids(race(() => {}, [2, 0, 1, 3]))).not.toContain("comeback");
    // The bot gaining places is no one's award.
    expect(ids(race(() => {}, [3, 2, 1, 0]))).not.toContain("comeback");
  });

  it("gives Photo Finisher to both who crossed together", () => {
    const r = race(() => {}, [0, 1, 2, 3], [50, 50.05, 60, 70]);
    const a = r.raceAwards().find((x) => x.id === "photo")!;
    expect(a.names).toEqual(["Kit", "Mango"]);
    expect(a.detail).toBe("Finished by a hair.");
  });

  it("gives Nemesis of the Day to the one who kept finding the same person", () => {
    const r = race((x) => {
      x.hit({ kart: 1, by: 2, cause: "puck" });
      x.hit({ kart: 1, by: 2, cause: "seeker" });
    });
    const a = r.raceAwards().find((x) => x.id === "nemesis")!;
    expect(a.names).toEqual(["Bun"]);
    expect(a.detail).toBe("Kept finding Mango: 2 hits.");
  });

  it("gives a tie to both, and nothing when everyone is level", () => {
    const tie = race((x) => {
      x.hit({ kart: 2, by: 0, cause: "puck" });
      x.hit({ kart: 2, by: 0, cause: "puck" });
      x.hit({ kart: 2, by: 1, cause: "puck" });
      x.hit({ kart: 2, by: 1, cause: "puck" });
      x.hit({ kart: 2, by: 1, cause: "puck" });
      x.hit({ kart: 2, by: 0, cause: "puck" });
    });
    // Bun was no shot at all, so the two who tied are not everyone.
    expect(tie.raceAwards().find((a) => a.id === "sharpshooter")?.names).toEqual(["Kit", "Mango"]);
    const alike = new Tally();
    for (const p of [kit, mango]) {
      hits(alike, p, botty, 2);
      alike.finish([{ person: p, place: 1, grid: 1, time: 1 }]);
    }
    expect(pickAwards(alike).find((a) => a.id === "sharpshooter")).toBeUndefined();
  });

  it("asks more of a cup, and sums the whole cup", () => {
    const r = new Rivalries();
    for (let i = 0; i < 3; i++) {
      r.begin(i + 1, racers, { cup: "c", race: i });
      r.hit({ kart: 1, by: 0, cause: "puck" });
      r.finish(standings([0, 1, 2, 3]));
    }
    expect(r.cupAwards().find((a) => a.id === "sharpshooter")?.detail).toBe("Landed 3 hits.");
    expect(pickAwards(r.race, CUP_BARS)).toEqual([]);
    expect(r.raceAwards()).toEqual([]);
  });

  it("gives no one more than two, and four in all", () => {
    const r = race(
      (x) => {
        for (let i = 0; i < 4; i++) x.hit({ kart: 1, by: 0, cause: "puck" });
        x.hit({ kart: 0, by: 1, cause: "puck" });
        x.hit({ kart: 0, by: 1, cause: "puck" });
      },
      [2, 0, 1, 3],
      [50, 50.05, 60, 70],
    );
    const awards = r.raceAwards();
    expect(awards.length).toBeLessThanOrEqual(4);
    const counts = new Map<string, number>();
    for (const a of awards) for (const k of a.keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("never names a bot", () => {
    const r = race((x) => {
      for (let i = 0; i < 5; i++) x.hit({ kart: 0, by: 3, cause: "puck" });
    });
    for (const a of r.raceAwards()) expect(a.names).not.toContain("Botty");
  });

  it("forgets everything when cleared", () => {
    const r = race((x) => x.hit({ kart: 1, by: 0, cause: "puck" }));
    r.clear();
    expect(r.session.totalHits).toBe(0);
    expect(r.raceId).toBeNull();
  });
});
