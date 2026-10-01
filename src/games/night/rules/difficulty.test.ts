import { describe, expect, it } from "vitest";
import { PlayerHealth } from "../../../engine/rules/health";
import { Dead, offsetPath } from "./dead";
import { makeMatch, placeholderRoad, playUntilDeath, shippedRoad, SLOWEST, standIdle, STEADY, WILD, type Skill } from "./testkit";
import { ATTACKS, BLOATER_BURST_DAMAGE, DIFFICULTY, MASK_HITS, REGEN_DELAY, REGEN_RATE, WAVE_INTRO } from "./tuning";

const standard = DIFFICULTY.standard;
const relaxed = DIFFICULTY.relaxed;

function run(h: PlayerHealth, seconds: number, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) h.update(dt);
}

describe("the difficulty table", () => {
  it("plays Standard exactly as designed", () => {
    expect(standard).toMatchObject({ speedFactor: 1, damageFactor: 1, regenDelay: REGEN_DELAY, regenRate: REGEN_RATE, fogFactor: 1, maskHits: MASK_HITS });
    expect(REGEN_DELAY).toBe(4);
    expect(REGEN_RATE).toBe(30);
    expect(ATTACKS.walker.damage).toBe(25);
    expect(ATTACKS.runner.damage).toBe(20);
    expect(BLOATER_BURST_DAMAGE).toBe(60);
  });

  it("walks Relaxed's dead about a quarter slower, clawing softer: five claws to fall, not four", () => {
    expect(relaxed.speedFactor).toBeCloseTo(0.75, 6);
    const claw = Math.round(ATTACKS.walker.damage * relaxed.damageFactor);
    expect(claw).toBe(20);
    expect(Math.ceil(100 / claw)).toBe(5);
    expect(Math.ceil(100 / ATTACKS.walker.damage)).toBe(4);
  });

  it("brings Relaxed health back after 3 s at 40 a second, thins its fog, widens a bloater's warning, and one shot takes the mask", () => {
    expect(relaxed.regenDelay).toBe(3);
    expect(relaxed.regenRate).toBe(40);
    expect(relaxed.fogFactor).toBeLessThan(1);
    expect(relaxed.burstWarning).toBeGreaterThan(standard.burstWarning);
    expect(relaxed.maskHits).toBe(1);
    expect(relaxed.boldAfter).toBeGreaterThan(standard.boldAfter);
    expect(relaxed.boldRate).toBeLessThan(standard.boldRate);
  });
});

describe("health on Relaxed", () => {
  it("starts coming back sooner, and faster", () => {
    const h = new PlayerHealth(relaxed);
    const s = new PlayerHealth(standard);
    h.hit(50);
    s.hit(50);
    run(h, 3.5);
    run(s, 3.5);
    expect(h.value).toBeGreaterThan(s.value + 15);
  });
});

describe("a match on Relaxed", () => {
  it("claws for 20 on wave 1", () => {
    const { m, rec } = makeMatch(5, { difficulty: "relaxed" });
    for (let t = 0; t < WAVE_INTRO + 0.1; t += 1 / 60) m.update(1 / 60, false);
    (m as unknown as { queue: unknown[] }).queue = [{ kind: "walker", lane: "road" }];
    (m as unknown as { spawnTimer: number }).spawnTimer = 1e9;
    const lane = m.plan.lanes[0]!;
    const d = new Dead(99, "walker", lane, offsetPath(lane, 0), 1, "walk.shamble");
    d.spawn(m);
    d.placeAt(40);
    m.dead.push(d);
    for (let t = 0; t < 30; t += 1 / 60) m.update(1 / 60, false);
    const strikes = rec.all("deadStrike");
    expect(strikes.length).toBeGreaterThan(0);
    for (const s of strikes) expect(s.args[1]).toBe(20);
  });

  it("wears its allowances away as a wave drags on, until it plays like Standard", () => {
    const { m } = makeMatch(2, { difficulty: "relaxed" });
    m.health.immortal = true;
    for (let t = 0; t < WAVE_INTRO + 0.1; t += 1 / 60) m.update(1 / 60, false);
    expect(m.tuning).toEqual(relaxed);
    // The last of the wave out of the fog now, one still walking (the wave stays open).
    const lane = m.plan.lanes[0]!;
    const d = new Dead(99, "walker", lane, offsetPath(lane, 0), 1, "walk.shamble");
    d.spawn(m);
    m.dead.push(d);
    (m as unknown as { queue: unknown[] }).queue = [];
    (m as unknown as { lastSpawnAt: number }).lastSpawnAt = m.phaseT;
    const half = m.phaseT + relaxed.boldAfter + (relaxed.boldMax - 1) / relaxed.boldRate / 2;
    while (m.phaseT < half) m.update(1 / 60, false);
    expect(m.pressure()).toBeCloseTo(0.5, 1);
    expect(m.tuning.speedFactor).toBeCloseTo((relaxed.speedFactor + 1) / 2, 1);
    while (m.pressure() < 1) m.update(1 / 60, false);
    m.update(1 / 60, false);
    for (const key of ["speedFactor", "damageFactor", "regenDelay", "regenRate", "fogFactor", "burstWarning"] as const) {
      expect(m.tuning[key], key).toBeCloseTo(standard[key], 6);
    }
    // The mask is the Mechanic's own, and does not wear.
    expect(m.tuning.maskHits).toBe(1);
  });

  it("never moves Standard's numbers", () => {
    const { m } = makeMatch(3);
    m.health.immortal = true;
    for (let i = 0; i < 60 * 200; i++) {
      m.update(1 / 60, false);
      if (i % 60 === 0) expect(m.tuning).toEqual(standard);
    }
  });
});

/**
 * The same simulated players as balance.test.ts (see testkit.ts), on the
 * same shipped road, over both difficulties and the same seeds: Relaxed
 * should carry each of them further, and still end every night in the end.
 */
const road = (await shippedRoad()) ?? placeholderRoad();

describe("difficulty balance", { timeout: 180_000 }, () => {
  const seeds = Array.from({ length: 16 }, (_, i) => i + 1);
  const medianWave = (skill: Skill, difficulty: "standard" | "relaxed") => {
    const waves = seeds.map((s) => playUntilDeath(s, skill, { difficulty, maxTime: 4800, road }).wave).sort((a, b) => a - b);
    return { waves, median: waves[Math.floor(waves.length / 2)] as number };
  };

  it("carries a steady hand further on Relaxed, and still ends most of its nights", () => {
    const s = medianWave(STEADY, "standard");
    const r = medianWave(STEADY, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`steady hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 1);
    expect(r.waves[0]).toBeGreaterThanOrEqual(s.waves[0] as number);
    expect(r.waves.filter((w) => w <= 25).length).toBeGreaterThanOrEqual(12);
  });

  it("carries a slow, wild hand a few waves further on Relaxed", () => {
    const s = medianWave(WILD, "standard");
    const r = medianWave(WILD, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`slow, wild hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 2);
    expect(r.waves[0]).toBeGreaterThanOrEqual(4);
  });

  it("gives the slowest hand several more waves", () => {
    const s = medianWave(SLOWEST, "standard");
    const r = medianWave(SLOWEST, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`slowest hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 2);
  });

  it("overruns an idle player on both, in the first wave, a little later on Relaxed", () => {
    const idle = (difficulty: "standard" | "relaxed") => [1, 2, 3, 4, 5, 6].map((seed) => standIdle(seed, difficulty, 300, road));
    const s = idle("standard");
    const r = idle("relaxed");
    for (const x of [...s, ...r]) {
      expect(x.dead).toBe(true);
      expect(x.wave, "never shooting, the first wave never clears").toBe(1);
    }
    const mean = (xs: { time: number }[]) => xs.reduce((a, x) => a + x.time, 0) / xs.length;
    // eslint-disable-next-line no-console
    console.log(`an idle player falls after: standard ${s.map((x) => x.time.toFixed(0)).join(" ")} s; relaxed ${r.map((x) => x.time.toFixed(0)).join(" ")} s`);
    expect(mean(r)).toBeGreaterThan(mean(s));
    // The opening brings the first of the dead to the barricade within the minute on both
    // (it was 57-73 s on Standard and 76-95 s on Relaxed, from 62 m).
    expect(mean(s)).toBeLessThan(45);
    expect(mean(r)).toBeLessThan(55);
  });
});
