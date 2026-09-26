import { describe, expect, it } from "vitest";
import type { Bandit } from "./bandit";
import { Match } from "./match";
import { mulberry32 } from "./rng";
import { Recorder, testCovers } from "./testkit";

/**
 * A simulated player with a finger for a gun: sees a bandit, takes about
 * two thirds of a second to get the shot off, hits four times in five,
 * can fold the thumb at most three times a second, and reloads when empty.
 * Played against the real rules over many seeds, the difficulty curve
 * should be fair early and tense later.
 */
function playUntilDeath(seed: number, skill: { reaction: number; accuracy: number }, maxWave = 25): { wave: number; time: number } {
  const rec = new Recorder();
  const match = new Match({ random: mulberry32(seed), covers: testCovers(), listener: rec });
  const player = mulberry32(seed * 7919 + 1);
  match.start();
  const seen = new Map<number, number>();
  const stickSeen = new Map<number, number>();
  let cooldown = 0;
  let reloadGesture = false;
  const dt = 1 / 30;
  for (let t = 0; t < 1200; t += dt) {
    match.update(dt, reloadGesture);
    reloadGesture = false;
    if (match.phase === "dead") return { wave: match.wave, time: t };
    if (match.wave > maxWave) return { wave: match.wave, time: t };
    cooldown -= dt;
    if (match.revolver.rounds === 0 && !match.revolver.reloading) {
      reloadGesture = true;
      cooldown = Math.max(cooldown, 0.35);
      continue;
    }
    if (cooldown > 0 || match.revolver.reloading) continue;
    // Dynamite in the air first, once it has been seen long enough to react.
    let target: { kind: "dynamite"; id: number } | { kind: "bandit"; b: Bandit } | null = null;
    for (const s of match.sticks) {
      if (!s.airborne) {
        stickSeen.delete(s.id);
        continue;
      }
      const first = stickSeen.get(s.id) ?? t;
      stickSeen.set(s.id, first);
      if (t - first >= skill.reaction) target = { kind: "dynamite", id: s.id };
    }
    if (!target) {
      let best: Bandit | null = null;
      for (const b of match.bandits) {
        if (!b.shootable) {
          seen.delete(b.id);
          continue;
        }
        const first = seen.get(b.id) ?? t + player() * 0.25;
        seen.set(b.id, first);
        if (t - first < skill.reaction) continue;
        // The one about to fire first.
        if (!best || (b.state === "aiming" && best.state !== "aiming") || (b.state === best.state && b.t > best.t)) best = b;
      }
      if (best) target = { kind: "bandit", b: best };
    }
    if (!target) continue;
    if (match.trigger() !== "fired") continue;
    cooldown = 0.33;
    const hit = player() < skill.accuracy;
    if (target.kind === "dynamite") {
      const stick = match.sticks[target.id];
      match.resolveShot(hit && stick ? { kind: "dynamite", stick } : { kind: "scenery" });
    } else {
      match.resolveShot(hit ? { kind: "bandit", bandit: target.b, part: player() < 0.25 ? "head" : "body" } : { kind: "scenery" });
    }
  }
  return { wave: match.wave, time: 1200 };
}

describe("difficulty", () => {
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  it("lets a steady hand through the first waves, and still gets them in the end", () => {
    const waves = seeds.map((s) => playUntilDeath(s, { reaction: 0.65, accuracy: 0.8 }).wave).sort((a, b) => a - b);
    const median = waves[Math.floor(waves.length / 2)] as number;
    // eslint-disable-next-line no-console
    console.log(`steady hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(3);
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(16);
  });

  it("is harder on a slow, wild hand, but never over in the first wave", () => {
    const waves = seeds.map((s) => playUntilDeath(s, { reaction: 1.0, accuracy: 0.55 }).wave).sort((a, b) => a - b);
    const median = waves[Math.floor(waves.length / 2)] as number;
    // eslint-disable-next-line no-console
    console.log(`slow, wild hand falls on waves: ${waves.join(" ")} (median ${median})`);
    expect(waves[0]).toBeGreaterThanOrEqual(2);
    expect(median).toBeLessThan(10);
  });
});

describe("an idle player", () => {
  it("is overrun in the end, however forgiving the first wave", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const match = new Match({ random: mulberry32(seed), covers: testCovers(), listener: new Recorder() });
      match.start();
      let t = 0;
      const dt = 1 / 30;
      while (match.phase !== "dead" && t < 240) {
        match.update(dt, false);
        t += dt;
      }
      expect(match.phase, `seed ${seed}`).toBe("dead");
      expect(match.wave, "never shooting, the first wave never clears").toBe(1);
    }
  });
});
