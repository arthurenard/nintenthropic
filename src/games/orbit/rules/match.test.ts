import { describe, expect, it } from "vitest";
import { facing, shootable, tankShows, type Fragment } from "./debris";
import type { Match } from "./match";
import { velocityAt } from "./motion";
import { SECRETS_TOTAL, STORM_FLASHES } from "./secrets";
import { newMatch, run, type Recorder } from "./testkit";
import { BREATHER, DIFFICULTY, INTEGRITY_MAX, KINDS, PASS_INTRO, SEAL_AT, SHARD_FACE_ON, SPLIT_KICK, TITLE_AT } from "./tuning";
import { distance, length, sub } from "./vec";

/** A match with the director off: nothing comes but what a test sends. */
function staged(seed = 3, difficulty: "standard" | "relaxed" = "standard"): { match: Match; listener: Recorder } {
  const m = newMatch(seed, difficulty);
  m.match.director = false;
  m.match.start();
  run(m.match, PASS_INTRO + 0.1);
  return m;
}

/** Step until `done` or `seconds` pass; returns whether it happened. */
function until(match: Match, done: () => boolean, seconds = 60): boolean {
  for (let i = 0; i < seconds * 60; i++) {
    if (done()) return true;
    match.update(1 / 60, false);
  }
  return done();
}

const shoot = (match: Match, f: Fragment) =>
  match.resolveShot({ kind: "debris", id: f.id, distance: distance(f.position(match.time), match.layout.eye) });

describe("a game's flow", () => {
  it("opens on a title card, sends its debris, and breathes between passes", () => {
    const { match, listener } = newMatch(11);
    match.start();
    expect(listener.last("banner")?.args).toEqual(["Pass 1", "Shoot the debris before it hits the glass."]);
    expect(match.phase).toBe("intro");
    run(match, PASS_INTRO + 0.05);
    expect(match.phase).toBe("pass");
    expect(listener.count("passStart")).toBe(1);
    // A perfect shot: everything vaporised the moment it can be.
    const ok = until(match, () => {
      for (const f of match.fragments) if (f.flying && shootable(f, match.time, match.layout.eye)) shoot(match, f);
      return match.phase === "breather";
    }, 300);
    expect(ok).toBe(true);
    expect(listener.count("passClear")).toBe(1);
    expect(listener.all("spawn").filter((e) => !String(e.args[1]).includes("piece")).length).toBeGreaterThanOrEqual(10);
    expect(listener.last("breather")?.args).toEqual([2]);
    run(match, TITLE_AT + 0.05);
    expect(listener.last("banner")?.args[0]).toBe("Pass 2");
    run(match, BREATHER - TITLE_AT);
    expect(match.pass).toBe(2);
    expect(match.phase).toBe("pass");
  });

  it("plays the same way for the same seed and the same shots", () => {
    const play = () => {
      const { match, listener } = newMatch(42);
      match.start();
      let n = 0;
      for (let i = 0; i < 60 * 90; i++) {
        match.update(1 / 60, false);
        if (i % 50 === 0) {
          const f = match.fragments.find((x) => x.flying);
          if (f && match.trigger() === "fired") {
            if (n++ % 3 === 2) match.resolveShot({ kind: "none" });
            else shoot(match, f);
          }
        }
      }
      return listener.log.map((e) => `${e.name}:${JSON.stringify(e.args)}`);
    };
    expect(play()).toEqual(play());
  });

  it("counts no shots while there is no debris to shoot", () => {
    const { match } = newMatch(5);
    match.start();
    match.resolveShot({ kind: "none" });
    expect(match.scorer.shots).toBe(0);
  });
});

describe("a fragment", () => {
  it("reaches the glass and costs its pane, the ring showing five seconds out", () => {
    const { match, listener } = staged();
    const f = match.send("chunk", "pane", { pane: 0 });
    expect(f.strike?.pane).toBe(0);
    let closingAtRing = -1;
    until(match, () => {
      if (f.ringed && closingAtRing < 0) closingAtRing = f.closing(match.time);
      return !f.flying;
    });
    expect(closingAtRing).toBeLessThanOrEqual(DIFFICULTY.standard.ringLead);
    expect(closingAtRing).toBeGreaterThan(DIFFICULTY.standard.ringLead - 0.05);
    expect(f.state).toBe("struck");
    const cost = listener.last("strike")!.args[3] as number;
    expect(match.glass.integrity[0]).toBe(INTEGRITY_MAX - cost);
    expect(cost).toBeGreaterThanOrEqual(15);
    expect(cost).toBeLessThanOrEqual(26);
  });

  it("warns seven seconds out on Relaxed, and strikes a third softer", () => {
    const { match, listener } = staged(3, "relaxed");
    const f = match.send("slab", "pane", { pane: 3 });
    let closingAtRing = -1;
    until(match, () => {
      if (f.ringed && closingAtRing < 0) closingAtRing = f.closing(match.time);
      return !f.flying;
    }, 90);
    expect(closingAtRing).toBeGreaterThan(6.9);
    const cost = listener.last("strike")!.args[3] as number;
    expect(cost).toBeLessThan(KINDS.slab.cost * 1.3 * 0.7 + 1);
  });

  it("splits into pieces that keep its momentum", () => {
    const { match, listener } = staged(9);
    const f = match.send("chunk", "pane", { pane: 0 });
    run(match, 1);
    const v = velocityAt(f.motion, match.time);
    shoot(match, f);
    expect(f.state).toBe("split");
    const split = listener.last("split")!;
    const pieces = match.fragments.filter((x) => x.parent?.id === f.id);
    expect(pieces.length).toBe((split.args[1] as number[]).length);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(pieces.length).toBeLessThanOrEqual(3);
    for (const p of pieces) {
      expect(p.kind).toBe("shrapnel");
      const dv = length(sub(velocityAt(p.motion, match.time), v));
      expect(dv).toBeLessThanOrEqual(SPLIT_KICK[1] + 0.61);
    }
    // Still on its way to the glass: at least one piece will strike.
    expect(pieces.some((p) => p.strike !== null)).toBe(true);
  });

  it("splits a slab into chunks, and those chunks into shrapnel", () => {
    const { match } = staged(10);
    const slab = match.send("slab", "pane", { pane: 0 });
    run(match, 0.5);
    shoot(match, slab);
    const chunks = match.fragments.filter((x) => x.parent?.id === slab.id);
    expect(chunks.every((c) => c.kind === "chunk")).toBe(true);
    shoot(match, chunks[0]!);
    const bits = match.fragments.filter((x) => x.parent?.id === chunks[0]!.id);
    expect(bits.map((b) => b.kind)).toEqual(["shrapnel", "shrapnel"]);
    shoot(match, bits[0]!);
    expect(bits[0]!.state).toBe("vaporised");
  });

  it("strips a foil wrap with the first hit and splits the core with the second", () => {
    const { match, listener } = staged();
    const f = match.send("foil", "pane", { pane: 2 });
    run(match, 0.5);
    shoot(match, f);
    expect(listener.count("stripped")).toBe(1);
    expect(f.flying).toBe(true);
    expect(f.wrapped).toBe(false);
    shoot(match, f);
    expect(f.state).toBe("split");
  });

  it("is a shard: a shot lands only face-on", () => {
    const { match } = staged(21);
    const f = match.send("shard", "pane", { pane: 0 });
    const eye = match.layout.eye;
    expect(until(match, () => facing(f, match.time, eye) < SHARD_FACE_ON * 0.8, 20)).toBe(true);
    shoot(match, f);
    expect(f.flying).toBe(true);
    expect(match.scorer.hits).toBe(0);
    expect(until(match, () => facing(f, match.time, eye) > 0.9, 20)).toBe(true);
    shoot(match, f);
    expect(f.state).toBe("vaporised");
  });

  it("rings the metal when it is sent at the frame, costing no glass", () => {
    const { match, listener } = staged(4);
    const f = match.send("chunk", "frame");
    until(match, () => !f.flying);
    if (f.frame) {
      expect(listener.count("frameStrike")).toBe(1);
      expect(match.glass.integrity.every((v) => v === INTEGRITY_MAX)).toBe(true);
    } else {
      // Its arc found glass on the way: a strike after all.
      expect(listener.count("strike")).toBe(1);
    }
  });

  it("goes by when it misses", () => {
    const { match, listener } = staged(6);
    const f = match.send("shrapnel", "miss");
    expect(f.strike).toBeNull();
    until(match, () => !f.flying);
    expect(f.state).toBe("passed");
    expect(listener.count("passed")).toBe(1);
  });

  it("comes most often down the lanes the station does not hide", () => {
    const { match } = staged(8);
    const lanes = match.layout.lanes;
    // Half the lanes hidden behind the station.
    match.layout.clear = lanes.map((_, i) => (i % 2 === 0 ? 0 : 1));
    const nearest = (p: { x: number; y: number; z: number }) => {
      let best = 0;
      for (let i = 1; i < lanes.length; i++) if (distance(lanes[i]!, p) < distance(lanes[best]!, p)) best = i;
      return best;
    };
    let hidden = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const f = match.send("shrapnel", "miss");
      if (nearest(f.position(f.born)) % 2 === 0) hidden++;
    }
    // About 5% of the weight is left on the hidden ones.
    expect(hidden / n).toBeLessThan(0.12);
    expect(hidden).toBeGreaterThan(0);
  });
});

describe("the Derelict", () => {
  it("comes in on a gentle arc, never far off its line", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { match } = staged(seed);
      const d = match.sendDerelict();
      const a = d.position(d.born);
      const b = match.layout.panes[0]!.center;
      const line = sub(b, a);
      const len = length(line);
      let worst = 0;
      for (let t = d.born; t < d.born + 30; t += 0.25) {
        const p = sub(d.position(t), a);
        const along = (p.x * line.x + p.y * line.y + p.z * line.z) / len;
        if (along > len) break;
        worst = Math.max(worst, Math.sqrt(Math.max(0, length(p) ** 2 - along * along)));
      }
      expect(worst, `seed ${seed}`).toBeLessThanOrEqual(5.5);
    }
  });

  it("shrugs off shots on its body, and breaks up after three on its tank", () => {
    const { match, listener } = staged(8);
    const d = match.sendDerelict();
    const eye = match.layout.eye;
    match.resolveShot({ kind: "body", id: d.id, distance: 100 });
    expect(listener.count("deflect")).toBe(1);
    expect(match.scorer.shots).toBe(0);
    for (let hit = 1; hit <= 3; hit++) {
      expect(until(match, () => tankShows(d, match.time, eye), 20)).toBe(true);
      match.resolveShot({ kind: "tank", id: d.id, distance: 90 });
    }
    expect(listener.count("tankHit")).toBe(2);
    expect(listener.count("breakup")).toBe(1);
    expect(d.state).toBe("split");
    const pieces = match.fragments.filter((x) => x.parent?.id === d.id);
    expect(pieces.length).toBeGreaterThanOrEqual(6);
    expect(pieces.every((p) => p.kind === "chunk")).toBe(true);
    const award = listener.last("breakup")!.args[2] as { points: number; labels: string[] };
    expect(award.labels).toContain("Derelict");
  });

  it("takes two panes if it arrives: the game is over", () => {
    const { match, listener } = staged(8);
    const d = match.sendDerelict();
    expect(d.strike?.pane).toBe(0);
    until(match, () => match.over, 60);
    expect(match.over).toBe(true);
    const failedPanes = match.glass.integrity.filter((v) => v <= 0).length;
    expect(failedPanes).toBe(2);
    expect(listener.last("paneFailed")!.args[1]).toMatchObject({ kind: "derelict" });
    expect(match.results().note).toBe("The Derelict. Its fuel tank shows as it tumbles; three hits break it up.");
  });

  it("comes on the fifth pass", () => {
    const { match, listener } = newMatch(2);
    match.start(5);
    run(match, PASS_INTRO + 0.1);
    expect(listener.all("spawn").some((e) => e.args[1] === "derelict")).toBe(true);
  });
});

describe("the glass failing", () => {
  it("ends the game with a note on what broke it", () => {
    const { match, listener } = staged(13);
    for (let i = 0; i < 4 && !match.over; i++) {
      const f = match.send("slab", "pane", { pane: 1 });
      until(match, () => !f.flying, 60);
    }
    expect(match.over).toBe(true);
    expect(listener.count("paneFailed")).toBe(1);
    const r = match.results();
    expect(r.outcome).toBe("Breached on Pass 1");
    expect(r.note).toMatch(/^A slab on the upper-left pane\./);
    expect(r.stats.map((s) => s.label)).toEqual(["Passes", "Cleared", "Accuracy", "Best Streak"]);
    expect(r.secretsTotal).toBe(SECRETS_TOTAL);
    // Nothing more strikes the glass once the shutters are down.
    const strikes = listener.count("strike");
    const g = match.send("chunk", "pane", { pane: 0 });
    until(match, () => !g.flying);
    expect(listener.count("strike")).toBe(strikes);
  });

  it("sounds the alarm under 35, and stops it when mended", () => {
    const { match, listener } = staged(14);
    const f = match.send("slab", "pane", { pane: 3 });
    until(match, () => !f.flying);
    const g = match.send("chunk", "pane", { pane: 3 });
    until(match, () => !g.flying);
    if (match.glass.integrity[3]! < 35) {
      expect(listener.last("alarm")?.args).toEqual([true]);
      match.glass.mend(3, 100);
      run(match, 0.1);
      expect(listener.last("alarm")?.args).toEqual([false]);
    }
  });
});

describe("the breather", () => {
  it("seals chips on every pane under full", () => {
    const { match, listener } = newMatch(17);
    match.start();
    let struck = false;
    until(match, () => {
      // Let one strike through, then clear the rest.
      if (!struck && match.glass.integrity.some((v) => v < INTEGRITY_MAX)) struck = true;
      for (const f of match.fragments) if (struck && f.flying && shootable(f, match.time, match.layout.eye)) shoot(match, f);
      return match.phase === "breather" || match.over;
    }, 400);
    expect(match.phase).toBe("breather");
    const before = [...match.glass.integrity];
    run(match, SEAL_AT + 0.05);
    const after = match.glass.integrity;
    expect(listener.count("sealed")).toBe(1);
    before.forEach((v, i) => {
      if (v < INTEGRITY_MAX) expect(after[i]).toBe(Math.min(INTEGRITY_MAX, v + 15));
    });
  });
});

describe("the drone and the secrets", () => {
  it("costs 300 to shoot the drone, and knocks it away", () => {
    const { match, listener } = staged();
    match.scorer.score = 500;
    match.resolveShot({ kind: "drone" });
    expect(match.scorer.score).toBe(200);
    expect(listener.count("droneShot")).toBe(1);
    expect(match.drone.knocked).toBe(true);
    // Docked, it was mending nothing; the next time it is caught at a window.
    expect(listener.last("droneShot")?.args.slice(1)).toEqual([1, false]);
    match.drone.state = "mending";
    match.drone.to = 2;
    match.resolveShot({ kind: "drone" });
    expect(listener.last("droneShot")?.args.slice(1)).toEqual([2, true]);
  });

  it("calls up the aurora after three lightning flashes in one breather", () => {
    const { match, listener } = staged();
    for (let i = 0; i < STORM_FLASHES - 1; i++) match.resolveShot({ kind: "secret", shot: { secret: "storm" } });
    match.secrets.breather();
    match.resolveShot({ kind: "secret", shot: { secret: "storm" } });
    expect(listener.count("secretFound")).toBe(0);
    for (let i = 0; i < STORM_FLASHES - 1; i++) match.resolveShot({ kind: "secret", shot: { secret: "storm" } });
    expect(listener.last("secretFound")?.args.slice(0, 2)).toEqual(["storm", "The Aurora"]);
    expect(match.secrets.aurora).toBe(true);
  });

  it("finds each secret once", () => {
    const { match, listener } = staged();
    match.resolveShot({ kind: "secret", shot: { secret: "duck" } });
    match.resolveShot({ kind: "secret", shot: { secret: "duck" } });
    match.resolveShot({ kind: "secret", shot: { secret: "astronaut", at: true } });
    expect(listener.all("secretFound").map((e) => e.args[0])).toEqual(["duck", "astronaut"]);
    expect(match.results().secretsFound).toBe(2);
    // Found again, its show plays again (the arm waves back every time), with no second toast.
    match.resolveShot({ kind: "secret", shot: { secret: "arm" } });
    match.resolveShot({ kind: "secret", shot: { secret: "arm" } });
    expect(listener.all("secretFound").map((e) => e.args[0])).toEqual(["duck", "astronaut", "arm"]);
    expect(listener.all("secretAgain").map((e) => e.args[0])).toEqual(["duck", "arm"]);
    expect(match.results().secretsFound).toBe(3);
  });
});

describe("the laser in play", () => {
  it("says when it overheats and when it vents", () => {
    const { match, listener } = staged();
    for (let i = 0; i < 10; i++) {
      match.trigger();
      run(match, 0.12);
    }
    expect(listener.all("laser").map((e) => e.args[0])).toContain("overheat");
    expect(match.vent()).toBe(true);
    run(match, 1);
    expect(listener.all("laser").map((e) => e.args[0])).toEqual(expect.arrayContaining(["vent", "vented"]));
  });
});
