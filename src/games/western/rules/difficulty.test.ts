import { describe, expect, it } from "vitest";
import { flightTimeFor } from "./dynamite";
import { PlayerHealth } from "./health";
import { Match } from "./match";
import { mulberry32 } from "./rng";
import { playUntilDeath, Recorder, standIdle, testCovers, type Skill } from "./testkit";
import {
  BOLD_AFTER,
  BOLD_MAX,
  BOLD_RATE,
  DIFFICULTY,
  DYNAMITE_MAX_FLIGHT,
  GLINT_LEAD,
  LIGHT_TIME,
  REGEN_DELAY,
  REGEN_RATE,
} from "./tuning";
import { damageFor } from "./waves";

const standard = DIFFICULTY.standard;
const relaxed = DIFFICULTY.relaxed;

function run(h: PlayerHealth, seconds: number, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) h.update(dt);
}

describe("the difficulty table", () => {
  it("plays Standard exactly as designed", () => {
    expect(standard).toEqual({
      aimFactor: 1,
      glintLead: GLINT_LEAD,
      hitFactor: 1,
      damageFactor: 1,
      regenDelay: REGEN_DELAY,
      regenRate: REGEN_RATE,
      boldAfter: BOLD_AFTER,
      boldRate: BOLD_RATE,
      boldMax: BOLD_MAX,
      lightTime: LIGHT_TIME,
      flightFactor: 1,
    });
  });

  it("gives Relaxed a longer aim, a longer glint, fewer and softer hits", () => {
    expect(relaxed.aimFactor).toBeGreaterThanOrEqual(1.4);
    expect(relaxed.aimFactor).toBeLessThanOrEqual(1.6);
    expect(relaxed.glintLead).toBeGreaterThan(standard.glintLead);
    expect(relaxed.hitFactor).toBeLessThan(1);
    expect(relaxed.damageFactor).toBeLessThan(1);
  });

  it("brings Relaxed health back sooner, and its pressure later and slower", () => {
    expect(relaxed.regenDelay).toBeLessThan(standard.regenDelay);
    expect(relaxed.regenRate).toBeGreaterThanOrEqual(standard.regenRate);
    expect(relaxed.boldAfter).toBeGreaterThan(standard.boldAfter);
    expect(relaxed.boldRate).toBeLessThan(standard.boldRate);
    expect(relaxed.boldMax).toBeLessThanOrEqual(standard.boldMax);
  });

  it("burns Relaxed's dynamite longer, without lobbing it out of the picture", () => {
    expect(relaxed.lightTime).toBeGreaterThan(standard.lightTime);
    expect(relaxed.flightFactor).toBeGreaterThan(1);
    for (const d of [5, 15, 25, 38, 60]) {
      expect(flightTimeFor(d, relaxed.flightFactor)).toBeGreaterThanOrEqual(flightTimeFor(d));
      expect(flightTimeFor(d, relaxed.flightFactor)).toBeLessThanOrEqual(DYNAMITE_MAX_FLIGHT);
    }
    // Standard's arcs are untouched by the cap.
    expect(flightTimeFor(80)).toBe(2.2);
  });
});

describe("health on Relaxed", () => {
  const hit = Math.round(damageFor(1) * relaxed.damageFactor);

  it("takes four quick hits to fall where Standard takes three", () => {
    const h = new PlayerHealth(relaxed);
    for (let i = 0; i < 3; i++) {
      expect(h.hit(hit)).toBe(false);
      run(h, 0.5);
    }
    expect(h.hit(hit)).toBe(true);
    // The same holds on the later waves' harder hits: never fewer than Standard.
    for (let wave = 1; wave <= 20; wave++) {
      const toFall = (damage: number) => Math.ceil(100 / damage);
      expect(toFall(Math.round(damageFor(wave) * relaxed.damageFactor))).toBeGreaterThanOrEqual(toFall(damageFor(wave)));
    }
  });

  it("starts coming back sooner", () => {
    const h = new PlayerHealth(relaxed);
    const s = new PlayerHealth();
    h.hit(50);
    s.hit(50);
    run(h, relaxed.regenDelay + 0.5);
    run(s, relaxed.regenDelay + 0.5);
    expect(h.value).toBeGreaterThan(s.value + 10);
  });
});

describe("a match on Relaxed", () => {
  it("shoots softer: 26 a hit on wave 1", () => {
    const rec = new Recorder();
    const match = new Match({ random: mulberry32(5), covers: testCovers(), listener: rec, difficulty: "relaxed" });
    match.start();
    for (let t = 0; t < 30; t += 1 / 30) match.update(1 / 30, false);
    const fires = rec.log.filter((e) => e.name === "banditFire");
    expect(fires.length).toBeGreaterThan(0);
    for (const f of fires) expect(f.args[2]).toBe(26);
  });

  it("wears its allowances away as a wave drags on, until it plays like Standard", () => {
    const match = new Match({ random: mulberry32(2), covers: testCovers(), listener: new Recorder(), difficulty: "relaxed" });
    match.start();
    match.health.immortal = true;
    const dt = 1 / 30;
    let t = 0;
    while (match.phase !== "combat") {
      match.update(dt, false);
      t += dt;
    }
    // Early in the wave: Relaxed's own numbers.
    for (let i = 0; i < 30 * 20; i++) match.update(dt, false);
    expect(match.pressure()).toBe(0);
    expect(match.tuning).toEqual(relaxed);
    // Halfway up the pressure: halfway to Standard.
    const half = relaxed.boldAfter + (relaxed.boldMax - 1) / relaxed.boldRate / 2;
    while (match.phaseT < half) match.update(dt, false);
    expect(match.pressure()).toBeCloseTo(0.5, 1);
    expect(match.tuning.aimFactor).toBeCloseTo((relaxed.aimFactor + 1) / 2, 1);
    // At its boldest: Standard's numbers, with Standard's own pressure on top.
    while (match.pressure() < 1) match.update(dt, false);
    match.update(dt, false);
    for (const key of ["aimFactor", "glintLead", "hitFactor", "damageFactor", "regenDelay", "regenRate", "lightTime", "flightFactor"] as const) {
      expect(match.tuning[key], key).toBeCloseTo(standard[key], 6);
    }
  });

  it("never moves Standard's numbers", () => {
    const match = new Match({ random: mulberry32(3), covers: testCovers(), listener: new Recorder() });
    match.start();
    match.health.immortal = true;
    for (let i = 0; i < 30 * 200; i++) {
      match.update(1 / 30, false);
      if (i % 30 === 0) expect(match.tuning).toEqual(standard);
    }
    expect(match.pressure()).toBe(1);
  });
});

/**
 * The same simulated players as balance.test.ts (see testkit.ts), over both
 * difficulties and the same seeds: Relaxed should carry each of them
 * meaningfully further, and still end every game in the end.
 */
// Each case plays 48 whole games: give a busy machine time.
describe("difficulty balance", { timeout: 60_000 }, () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
  const medianWave = (skill: Skill, difficulty: "standard" | "relaxed") => {
    const waves = seeds.map((s) => playUntilDeath(s, skill, { difficulty }).wave).sort((a, b) => a - b);
    return { waves, median: waves[Math.floor(waves.length / 2)] as number };
  };

  it("carries a steady hand several waves further on Relaxed, and still gets most of them", () => {
    const skill = { reaction: 0.65, accuracy: 0.8 };
    const s = medianWave(skill, "standard");
    const r = medianWave(skill, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`steady hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 4);
    expect(r.waves[0]).toBeGreaterThan(s.waves[0] as number);
    // A real game: most of them still fall before wave 25.
    expect(r.waves.filter((w) => w <= 25).length).toBeGreaterThanOrEqual(18);
  });

  it("carries a slow, wild hand well past the first waves on Relaxed, and still ends it", () => {
    const skill = { reaction: 1.0, accuracy: 0.55 };
    const s = medianWave(skill, "standard");
    const r = medianWave(skill, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`slow, wild hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 3);
    expect(r.waves[0]).toBeGreaterThanOrEqual(4);
    expect(r.waves[r.waves.length - 1]).toBeLessThanOrEqual(15);
  });

  it("gives the slowest hand a few more waves too", () => {
    const skill = { reaction: 1.3, accuracy: 0.45 };
    const s = medianWave(skill, "standard");
    const r = medianWave(skill, "relaxed");
    // eslint-disable-next-line no-console
    console.log(`slowest hand falls on waves: standard ${s.waves.join(" ")} (median ${s.median}); relaxed ${r.waves.join(" ")} (median ${r.median})`);
    expect(r.median).toBeGreaterThanOrEqual(s.median + 2);
  });

  it("overruns an idle player on both, in the first wave, a little later on Relaxed", () => {
    const idle = (difficulty: "standard" | "relaxed") => [1, 2, 3, 4, 5, 6].map((seed) => standIdle(seed, difficulty, 300));
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
  });
});
