import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../../engine/rules/rng";
import { Dead, horizontalDistance, offsetPath } from "./dead";
import type { Match } from "./match";
import { makeMatch, testPlan, type Recorder } from "./testkit";
import { ATTACKS, BLOATER_BURST_DAMAGE, BREATHER, CLIMB_TIME, CRAWLER_SHORT, DIFFICULTY, LUNGE_TIME, STAGGER_BACK, VAULT_TIME, WAVE_INTRO } from "./tuning";
import type { DeadKind, LaneId } from "./types";

const DT = 1 / 60;

function run(m: Match, seconds: number, each?: () => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    m.update(DT, false);
    each?.();
  }
}

/** Into combat, the first of the wave not yet spawned. */
function combat(seed = 1, wave = 1, difficulty: "standard" | "relaxed" = "standard") {
  const { m, rec } = makeMatch(seed, { start: { wave }, difficulty });
  run(m, WAVE_INTRO + DT);
  expect(m.phase).toBe("combat");
  return { m, rec };
}

/** Puts one of the dead straight into play on a lane, whatever the director would send. */
function send(m: Match, kind: DeadKind, lane: LaneId = "road", along = 0): Dead {
  const l = m.plan.lanes.find((x) => x.id === lane)!;
  const d = new Dead(900 + m.dead.length, kind, l, offsetPath(l, 0), kind === "runner" ? 3.5 : 1, "walk.shamble");
  if (kind === "mechanic") d.mask = m.tuning.maskHits;
  d.spawn();
  if (along > 0) d.placeAt(along);
  m.dead.push(d);
  return d;
}

/** Holds the wave's own dead back (an empty queue that never clears), so a test sees only its own. */
function quiet(m: Match) {
  (m as unknown as { queue: unknown[] }).queue = [{ kind: "walker", lane: "road" }];
  (m as unknown as { spawnTimer: number }).spawnTimer = 1e9;
}

/** A perfect shot: the head of every one of the dead within `range` metres. */
function marksman(m: Match, range = 40) {
  return () => {
    for (const d of m.dead) {
      if (!d.shootable || horizontalDistance(d.pos, m.eye) > range) continue;
      if (m.rifle.rounds === 0) m.requestReload();
      if (m.trigger() !== "fired") return;
      m.resolveShot({ kind: "dead", dead: d, part: "head" });
    }
  };
}

describe("the wave director", () => {
  it("opens with a title card, then sends wave 1's six walkers: the first three together, by the bus, the road and the phone booth", () => {
    const { m, rec } = makeMatch(3);
    expect(rec.last("banner")?.args).toEqual(["Wave 1", "Something is coming up the road."]);
    expect(m.phase).toBe("intro");
    run(m, WAVE_INTRO + 0.1);
    expect(m.phase).toBe("combat");
    // The first of them is in play as the wave starts, the three within a couple of seconds.
    run(m, 0.5);
    expect(rec.count("deadSpawn")).toBe(1);
    run(m, 2.5);
    expect(rec.count("deadSpawn")).toBeGreaterThanOrEqual(3);
    run(m, 120, marksman(m));
    const spawns = rec.all("deadSpawn");
    expect(spawns.slice(0, 6).every((e) => e.args[1] === "walker")).toBe(true);
    expect(spawns.slice(0, 3).map((e) => e.args[2])).toEqual(["bus", "road", "booth"]);
    expect(spawns.slice(3, 6).every((e) => e.args[2] === "road")).toBe(true);
    expect(rec.count("waveClear")).toBeGreaterThanOrEqual(1);
    const firstClear = rec.log.findIndex((e) => e.name === "waveClear");
    expect(rec.log.slice(0, firstClear).filter((e) => e.name === "deadDeath").length).toBe(6);
  });

  it("never has more than the wave's limit walking at once", () => {
    const { m } = combat(5, 5);
    let most = 0;
    run(m, 60, () => {
      let n = 0;
      for (const d of m.dead) if (d.alive && d.kind !== "mechanic") n++;
      most = Math.max(most, n);
    });
    expect(most).toBeLessThanOrEqual(m.spec.maxActive);
    expect(most).toBeGreaterThan(2);
  });

  it("never has more of the dead up than the world has figures for, falling ones included", () => {
    // Wave 13 lets 24 walk at once; the world has figures for 22. One without
    // a figure would walk up unseen, and nothing could shoot it.
    const { m, rec } = makeMatch(4, { start: { wave: 13 }, figures: 22 });
    m.health.immortal = true;
    expect(m.spec.maxActive).toBeGreaterThan(22);
    let most = 0;
    const count = () => {
      let up = 0;
      for (const d of m.dead) if (d.state !== "dead" && d.kind !== "mechanic") up++;
      most = Math.max(most, up);
    };
    run(m, 60, count);
    expect(most).toBe(22);
    const before = rec.count("deadSpawn");
    // Three go down at once: their figures go to the next only once each fall is over.
    for (const d of m.dead.filter((x) => x.shootable).slice(0, 3)) {
      m.rifle.reset();
      m.trigger();
      m.resolveShot({ kind: "dead", dead: d, part: "head" });
    }
    run(m, 0.5, count);
    expect(rec.count("deadSpawn")).toBe(before);
    run(m, 10, count);
    expect(rec.count("deadSpawn")).toBe(before + 3);
    expect(most).toBe(22);
    // Without a limit, the wave's own crowd is the only one.
    const free = makeMatch(4, { start: { wave: 13 } });
    free.m.health.immortal = true;
    run(free.m, 60);
    expect(free.m.dead.filter((d) => d.alive).length).toBe(free.m.spec.maxActive);
  });

  it("takes a breather between waves: the bodies go, health comes back, the next wave's card", () => {
    const { m, rec } = combat(2);
    run(m, 150, marksman(m));
    expect(m.wave).toBeGreaterThanOrEqual(2);
    const breather = rec.all("breather")[0];
    expect(breather?.args[0]).toBe(2);
    expect(rec.count("bodyCleared")).toBeGreaterThanOrEqual(6);
    expect(rec.all("banner").map((e) => e.args[0])).toContain("Wave 2");
    expect(BREATHER).toBe(4);
  });

  it("brings the Mechanic first on his wave, masked", () => {
    const { m, rec } = combat(7, 6);
    run(m, 0.5);
    const first = rec.all("deadSpawn")[0];
    expect(first?.args[1]).toBe("mechanic");
    expect(m.dead[0]?.mask).toBe(DIFFICULTY.standard.maskHits);
  });

  it("plays out the same way twice from the same seed", () => {
    const a = makeMatch(11, { start: { wave: 4 } });
    const b = makeMatch(11, { start: { wave: 4 } });
    run(a.m, 40);
    run(b.m, 40);
    expect(a.rec.log.map((e) => e.name)).toEqual(b.rec.log.map((e) => e.name));
    expect(a.m.dead.map((d) => [d.kind, d.lane.id, d.pos.x.toFixed(3), d.pos.z.toFixed(3)])).toEqual(
      b.m.dead.map((d) => [d.kind, d.lane.id, d.pos.x.toFixed(3), d.pos.z.toFixed(3)]),
    );
  });
});

describe("the dead", () => {
  it("walk their lane to a place at the barricade and claw for 25 every 1.4 s", () => {
    const { m, rec } = combat();
    quiet(m);
    const d = send(m, "walker", "road", 0);
    const slots = m.plan.slots.map((s) => s.pos);
    run(m, 120);
    expect(d.state).toBe("attacking");
    expect(slots.some((s) => Math.hypot(s.x - d.pos.x, s.z - d.pos.z) < 0.05)).toBe(true);
    const strikes = rec.all("deadStrike");
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0]?.args[1]).toBe(ATTACKS.walker.damage);
    // Four quick claws: the player falls.
    expect(m.phase).toBe("dead");
    expect(rec.all("playerHit").length).toBe(4);
    expect(m.felled).toMatchObject({ kind: "walker", lane: "road", burst: false });
  });

  it("stagger half a step back from a body shot, and drop on the third", () => {
    const { m, rec } = combat();
    quiet(m);
    const d = send(m, "walker", "road", 30);
    const at = d.along;
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "body" });
    expect(d.state).toBe("staggered");
    expect(d.along).toBeCloseTo(at - STAGGER_BACK, 6);
    expect(rec.last("deadWound")?.args).toEqual([d.id, "body"]);
    run(m, 0.6);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "limb" });
    expect(d.alive).toBe(true);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "body" });
    expect(d.alive).toBe(false);
    expect(rec.last("deadDeath")?.args[1]).toBe("body");
  });

  it("drop to one headshot", () => {
    const { m, rec } = combat();
    quiet(m);
    const d = send(m, "walker", "road", 20);
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "head" });
    expect(d.state).toBe("dying");
    expect(rec.last("deadDeath")?.args[1]).toBe("head");
    run(m, 1.5);
    expect(d.state).toBe("dead");
    expect(rec.last("deadDown")?.args[0]).toBe(d.id);
  });

  it("a runner takes two body shots, and leaps the last metres at the barricade for 20", () => {
    const { m, rec } = combat();
    quiet(m);
    const d = send(m, "runner", "corn", 0);
    run(m, 20, () => {
      if (d.state === "lunging") expect(rec.count("deadLunge")).toBe(1);
    });
    expect(rec.count("deadLunge")).toBe(1);
    expect(rec.all("deadStrike")[0]?.args[1]).toBe(ATTACKS.runner.damage);
    expect(LUNGE_TIME).toBeLessThan(1);
    const r2 = send(m, "runner", "road", 10);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "dead", dead: r2, part: "body" });
    expect(r2.alive).toBe(true);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "dead", dead: r2, part: "body" });
    expect(r2.alive).toBe(false);
  });

  it("a crawler needs one shot, anywhere", () => {
    const { m } = combat();
    quiet(m);
    const d = send(m, "crawler", "road", 10);
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "limb" });
    expect(d.alive).toBe(false);
  });

  it("a crawler claws from out in front of the sandbags, where it can be seen and shot, not from behind them", () => {
    for (const lane of ["road", "trees"] as const) {
      const { m, rec } = combat();
      quiet(m);
      const walker = send(m, "walker", lane, 0);
      const crawler = send(m, "crawler", lane, 0);
      m.health.immortal = true;
      run(m, 120);
      expect(walker.state).toBe("attacking");
      expect(crawler.state).toBe("attacking");
      expect(rec.all("deadStrike").some((e) => e.args[0] === crawler.id)).toBe(true);
      // Its place, CRAWLER_SHORT farther from the eye than the one it holds; a walker stands on its own.
      const out = (d: Dead) => horizontalDistance(d.pos, m.eye) - horizontalDistance(d.slot!.pos, m.eye);
      expect(out(crawler)).toBeCloseTo(CRAWLER_SHORT, 1);
      expect(out(walker)).toBeCloseTo(0, 2);
    }
  });

  it("climb out of the bus and vault the fence before they walk", () => {
    const { m, rec } = combat();
    quiet(m);
    const bus = send(m, "walker", "bus");
    const fence = send(m, "walker", "fence");
    expect(bus.state).toBe("emerging");
    expect(fence.state).toBe("emerging");
    run(m, VAULT_TIME + 0.05);
    expect(fence.state).toBe("approaching");
    expect(bus.state).toBe("emerging");
    run(m, CLIMB_TIME - VAULT_TIME);
    expect(bus.state).toBe("approaching");
    expect(rec.count("deadEmerged")).toBe(2);
  });

  it("wait their turn when every place at the barricade is taken", () => {
    const { m } = combat();
    quiet(m);
    m.health.immortal = true;
    const crowd = Array.from({ length: 7 }, (_, i) => send(m, "walker", "road", 50 - i * 0.3));
    run(m, 30);
    const attacking = crowd.filter((d) => d.state === "attacking").length;
    expect(attacking).toBe(m.plan.slots.length);
    expect(crowd.filter((d) => d.state === "waiting").length).toBe(2);
    // One drops: the next steps up.
    const first = crowd.find((d) => d.state === "attacking")!;
    m.trigger();
    m.resolveShot({ kind: "dead", dead: first, part: "head" });
    run(m, 5);
    expect(crowd.filter((d) => d.state === "attacking").length).toBe(m.plan.slots.length);
  });

  it("a bloater at the barricade swells, then bursts on you for 60", () => {
    const { m, rec } = combat();
    quiet(m);
    const b = send(m, "bloater", "road", 50);
    run(m, 20);
    expect(rec.count("deadSwell")).toBe(1);
    expect(rec.last("bloaterBurst")?.args[1]).toBe(false);
    expect(rec.all("playerHit")[0]?.args[0]).toBe(BLOATER_BURST_DAMAGE);
    expect(b.alive).toBe(false);
    expect(b.cause).toBe("burst");
  });

  it("a bloater shot in the belly bursts, and downs everything within three metres: a chain", () => {
    const { m, rec } = combat();
    quiet(m);
    const b = send(m, "bloater", "road", 30);
    const near = [send(m, "walker", "road", 31), send(m, "runner", "road", 29), send(m, "walker", "road", 32.5)];
    const far = send(m, "walker", "road", 40);
    const before = m.scorer.score;
    m.trigger();
    m.resolveShot({ kind: "dead", dead: b, part: "body" });
    const burst = rec.last("bloaterBurst")!;
    expect(burst.args[1]).toBe(true);
    expect((burst.args[2] as number[]).sort()).toEqual(near.map((d) => d.id).sort());
    for (const d of near) expect(d.cause).toBe("chain");
    expect(far.alive).toBe(true);
    const chain = burst.args[3] as { points: number };
    expect(chain.points).toBe(300);
    expect(m.scorer.score - before).toBeGreaterThanOrEqual(360);
    expect(m.scorer.kills).toBe(4);
  });

  it("the Mechanic: the mask takes two headshots, then one drops him; body shots only slow him", () => {
    const { m, rec } = combat();
    quiet(m);
    const mech = send(m, "mechanic", "road", 45);
    const hit = (part: "head" | "body") => {
      m.rifle.reset();
      m.trigger();
      m.resolveShot({ kind: "dead", dead: mech, part });
    };
    const at = mech.along;
    hit("body");
    expect(mech.along).toBe(at);
    expect(mech.state).toBe("staggered");
    hit("head");
    expect(mech.alive).toBe(true);
    expect(rec.count("maskOff")).toBe(0);
    hit("head");
    expect(rec.count("maskOff")).toBe(1);
    expect(mech.mask).toBe(0);
    hit("head");
    expect(mech.alive).toBe(false);
    const award = rec.last("deadDeath")?.args[2] as { points: number; multiplier: number; labels: string[] };
    expect(award.labels).toEqual(["The Mechanic", "Headshot"]);
    expect(award.points).toBe(1000 * award.multiplier);
  });

  it("the Mechanic's mask takes one shot on Relaxed", () => {
    const { m, rec } = combat(1, 1, "relaxed");
    quiet(m);
    const mech = send(m, "mechanic", "road", 20);
    m.trigger();
    m.resolveShot({ kind: "dead", dead: mech, part: "head" });
    expect(rec.count("maskOff")).toBe(1);
  });

  it("the dead near the Mechanic come faster while he walks", () => {
    const { m } = combat();
    quiet(m);
    const w = send(m, "walker", "road", 10);
    const alone = m.paceFor(w);
    const mech = send(m, "mechanic", "road", 12);
    expect(m.paceFor(w)).toBeCloseTo(alone * 1.25, 6);
    mech.die("head");
    expect(m.paceFor(w)).toBeCloseTo(alone, 6);
  });
});

describe("survivors", () => {
  function survivorWave(seed = 4): { m: Match; rec: Recorder } {
    const { m, rec } = combat(seed, 3);
    return { m, rec };
  }

  it("run across the road from wave 3, Miller's daughter first, and are gone once across", () => {
    const { m, rec } = survivorWave();
    run(m, 40);
    expect(rec.all("survivorAppear")[0]?.args[1]).toBe("daughter");
    run(m, 12);
    expect(rec.count("survivorGone")).toBe(1);
  });

  it("cost 300 and the wave's Clean Hands when shot, and break the streak", () => {
    const { m, rec } = survivorWave();
    quiet(m);
    // Build a score and a streak first.
    for (let i = 0; i < 4; i++) {
      const d = send(m, "walker", "road", 20);
      m.rifle.reset();
      m.trigger();
      m.resolveShot({ kind: "dead", dead: d, part: "head" });
    }
    expect(m.scorer.streak).toBe(4);
    for (let t = 0; t < 60 && rec.count("survivorAppear") === 0; t += DT) m.update(DT, false);
    const s = m.survivors[0]!;
    expect(s.shootable).toBe(true);
    const score = m.scorer.score;
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "survivor", survivor: s });
    expect(m.scorer.score).toBe(score - 300);
    expect(m.scorer.streak).toBe(0);
    expect(s.state).toBe("stumbling");
    expect(rec.last("survivorShot")?.args[1]).toMatchObject({ points: -300, labels: ["Survivor"] });
    expect(m.scorer.endWave().cleanHands).toBe(0);
  });
});

describe("the player", () => {
  it("comes back to health 4 s after the last hurt, at 30 a second", () => {
    const { m } = combat();
    m.health.hit(50);
    run(m, 3.9);
    expect(m.health.value).toBe(50);
    run(m, 1.1);
    expect(m.health.value).toBeGreaterThan(70);
  });

  it("names what took them: a runner out of the corn", () => {
    const { m } = combat();
    quiet(m);
    m.health.hit(90);
    send(m, "runner", "corn", 0);
    run(m, 30);
    expect(m.phase).toBe("dead");
    expect(m.results().note).toBe("A runner out of the corn. Runners come fast; a headshot stops them dead.");
    expect(m.results().outcome).toBe("Fell on Wave 1");
  });

  it("scores a kill beyond 30 m at half as much again", () => {
    const { m, rec } = combat();
    quiet(m);
    const d = send(m, "walker", "road", 0);
    expect(horizontalDistance(d.pos, m.eye)).toBeGreaterThan(30);
    m.trigger();
    m.resolveShot({ kind: "dead", dead: d, part: "head" });
    expect((rec.last("deadDeath")?.args[2] as { points: number; labels: string[] })).toMatchObject({ points: 225, labels: ["Headshot", "Long Shot"] });
  });

  it("a shot into the road is a miss that breaks the streak; a secret is neither", () => {
    const { m } = combat();
    quiet(m);
    for (let i = 0; i < 3; i++) {
      const d = send(m, "walker", "road", 45);
      m.rifle.reset();
      m.trigger();
      m.resolveShot({ kind: "dead", dead: d, part: "head" });
    }
    expect(m.scorer.multiplier).toBe(2);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "secret", shot: { secret: "moon" } });
    expect(m.scorer.multiplier).toBe(2);
    expect(m.scorer.shots).toBe(3);
    m.rifle.reset();
    m.trigger();
    m.resolveShot({ kind: "scenery" });
    expect(m.scorer.multiplier).toBe(1);
  });
});

describe("the late-wave pressure", () => {
  it("starts only after the last of the wave has come out of the fog, and thickens the fog", () => {
    const { m } = combat(3);
    m.health.immortal = true;
    const fog0 = m.fogDensity();
    // While any are still to come out of the fog: none.
    run(m, 60);
    expect((m as unknown as { queue: unknown[] }).queue.length).toBeGreaterThan(0);
    expect(m.pressure()).toBe(0);
    // The last is out: after boldAfter seconds, it climbs to its height.
    (m as unknown as { queue: unknown[] }).queue = [];
    (m as unknown as { lastSpawnAt: number }).lastSpawnAt = m.phaseT;
    run(m, DIFFICULTY.standard.boldAfter - 1);
    expect(m.pressure()).toBe(0);
    run(m, 5);
    expect(m.pressure()).toBeGreaterThan(0);
    run(m, 60);
    expect(m.pressure()).toBe(1);
    expect(m.fogDensity()).toBeCloseTo(fog0 * 1.6, 6);
  });

  it("thins the fog in the breather", () => {
    const { m } = combat(2);
    const fog = m.fogDensity();
    run(m, 150, marksman(m));
    run(m, 0.2);
    if (m.phase === "breather") expect(m.fogDensity()).toBeLessThan(fog * 0.5);
  });
});

describe("the plan", () => {
  it("has every lane and five places at the barricade", () => {
    const plan = testPlan();
    expect(plan.lanes.map((l) => l.id).sort()).toEqual(["booth", "bus", "corn", "fence", "road", "trees"]);
    expect(plan.slots.length).toBe(5);
    // Each lane ends near the barricade and starts far from it.
    for (const lane of plan.lanes) {
      const end = lane.points[lane.points.length - 1]!;
      expect(Math.hypot(end.x, end.z), lane.id).toBeLessThan(9);
      expect(Math.hypot(lane.points[0]!.x, lane.points[0]!.z), lane.id).toBeGreaterThan(11);
    }
  });

  it("walks each of the dead on its own line", () => {
    const lane = testPlan().lanes[0]!;
    const a = offsetPath(lane, 1);
    const b = offsetPath(lane, -1);
    expect(Math.abs(a[0]!.x - b[0]!.x) + Math.abs(a[0]!.z - b[0]!.z)).toBeGreaterThan(1.5);
    void mulberry32;
  });
});
