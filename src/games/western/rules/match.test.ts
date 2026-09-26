import { describe, expect, it } from "vitest";
import type { Bandit } from "./bandit";
import type { Cover } from "./types";
import { buildQueue, Match, pickBossCovers, type StartOptions } from "./match";
import { mulberry32 } from "./rng";
import { Recorder, testCovers } from "./testkit";
import { INTERMISSION, WAVE_INTRO } from "./tuning";
import { waveSpec } from "./waves";

const DT = 1 / 60;

function makeMatch(seed = 1, start: StartOptions = {}) {
  const rec = new Recorder();
  const m = new Match({ random: mulberry32(seed), covers: testCovers(), listener: rec });
  m.start(start);
  return { m, rec };
}

function run(m: Match, seconds: number, each?: () => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    m.update(DT, false);
    each?.();
  }
}

/** A perfect shot: a head (or body) shot at every bandit the moment he is fully out. */
function marksman(m: Match, part: "head" | "body" = "head") {
  return () => {
    for (const b of m.bandits) {
      if (!b.shootable || b.exposure < 1) continue;
      if (m.revolver.rounds === 0) m.requestReload();
      if (m.trigger() !== "fired") return;
      m.resolveShot({ kind: "bandit", bandit: b, part });
    }
  };
}

describe("the wave director", () => {
  it("opens with a title card, then sends wave 1's four bandits", () => {
    const { m, rec } = makeMatch();
    expect(rec.last("banner")?.args).toEqual(["Wave 1", "The Carver gang rides in."]);
    expect(m.phase).toBe("intro");
    run(m, WAVE_INTRO + 0.1);
    expect(m.phase).toBe("combat");
    run(m, 60, marksman(m));
    const spawns = rec.log.filter((e) => e.name === "banditSpawn");
    expect(spawns.slice(0, 4).every((e) => e.args[1] === "gunman")).toBe(true);
    expect(rec.count("waveClear")).toBeGreaterThanOrEqual(1);
    const firstClear = rec.log.findIndex((e) => e.name === "waveClear");
    expect(rec.log.slice(0, firstClear).filter((e) => e.name === "banditDeath").length).toBe(4);
  });

  it("never has more than the wave's limit out at once", () => {
    const { m } = makeMatch(3, { wave: 4 });
    let most = 0;
    let mostAiming = 0;
    run(m, 40, () => {
      let active = 0;
      let aiming = 0;
      for (const b of m.bandits) {
        if (b.inPlay && b.role !== "boss") active++;
        if (b.slot && b.role !== "boss") aiming++;
      }
      most = Math.max(most, active);
      mostAiming = Math.max(mostAiming, aiming);
    });
    expect(most).toBeLessThanOrEqual(waveSpec(4).maxActive);
    expect(mostAiming).toBeLessThanOrEqual(waveSpec(4).maxAiming);
  });

  it("keeps bandit shots apart so each can be read", () => {
    const { m, rec } = makeMatch(5, { wave: 8 });
    m.health.immortal = true;
    const times: number[] = [];
    const original = rec.banditFire.bind(rec);
    rec.banditFire = (b, hit, damage) => {
      times.push(m.time);
      original(b, hit, damage);
    };
    run(m, 60);
    expect(times.length).toBeGreaterThan(10);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(0.45 - 1e-6);
  });

  it("takes a four-second breather between waves: bell, title, full heal", () => {
    const { m, rec } = makeMatch(2);
    run(m, 80, () => {
      if (m.phase === "intermission" || m.wave > 1) return;
      marksman(m)();
    });
    expect(rec.last("intermission")?.args[0]).toBe(2);
    const clearAt = rec.log.findIndex((e) => e.name === "waveClear");
    const bannerAfter = rec.log.slice(clearAt).find((e) => e.name === "banner");
    expect(bannerAfter?.args[0]).toBe("Wave 2");
    // Measure the breather itself.
    const { m: m2 } = makeMatch(2);
    let clearedAt = -1;
    let nextAt = -1;
    run(m2, 80, () => {
      if (m2.phase === "combat" && m2.wave === 1) marksman(m2)();
      if (clearedAt < 0 && m2.phase === "intermission") {
        clearedAt = m2.time;
        m2.health.hit(50);
      }
      if (clearedAt >= 0 && nextAt < 0 && m2.phase === "combat") nextAt = m2.time;
    });
    expect(nextAt - clearedAt).toBeCloseTo(INTERMISSION, 1);
  });

  it("heals fully when the wave is cleared", () => {
    const { m } = makeMatch(4);
    let healedTo = -1;
    run(m, 60, () => {
      if (m.phase === "combat" && m.wave === 1) {
        if (m.health.value === 100) m.health.hit(40);
        marksman(m)();
      }
      if (m.phase === "intermission" && healedTo < 0) healedTo = m.health.value;
    });
    expect(healedTo).toBe(100);
  });

  it("brings Black Jack first on wave 5, with three covers and three body hits", () => {
    const { m, rec } = makeMatch(6, { wave: 5 });
    run(m, WAVE_INTRO + 0.5);
    const first = rec.log.find((e) => e.name === "banditSpawn");
    expect(first?.args[1]).toBe("boss");
    const boss = m.bandits.find((b) => b.role === "boss") as Bandit;
    expect(pickBossCovers(m.covers).map((c) => c.id)).toContain(boss.cover.id);
    m.health.immortal = true;
    let bodyHits = 0;
    const coversSeen = new Set<string>([boss.cover.id]);
    run(m, 60, () => {
      coversSeen.add(boss.cover.id);
      if (boss.shootable && boss.exposure >= 1 && boss.state === "aiming" && boss.alive) {
        m.revolver.reset();
        m.trigger();
        m.resolveShot({ kind: "bandit", bandit: boss, part: "body" });
        bodyHits++;
      }
    });
    expect(boss.alive).toBe(false);
    expect(bodyHits).toBe(3);
    expect(rec.count("banditWound")).toBe(2);
    expect(coversSeen.size).toBeGreaterThanOrEqual(2);
    const death = rec.log.find((e) => e.name === "banditDeath" && e.args[0] === boss.id);
    expect((death?.args[2] as { labels: string[] }).labels).toContain("Black Jack");
  });

  it("a headshot always kills, even Black Jack and armoured men", () => {
    const { m } = makeMatch(7, { wave: 10 });
    m.health.immortal = true;
    run(m, 40, marksman(m, "head"));
    expect(m.bandits.filter((b) => b.role === "boss").every((b) => !b.alive)).toBe(true);
    expect(m.scorer.headshots).toBeGreaterThan(5);
  });

  it("armoured bandits need two body shots", () => {
    const { m, rec } = makeMatch(8, { wave: 6 });
    m.health.immortal = true;
    run(m, 60, marksman(m, "body"));
    expect(rec.count("banditWound")).toBeGreaterThan(0);
    const wounded = new Set(rec.log.filter((e) => e.name === "banditWound").map((e) => e.args[0]));
    for (const id of wounded) {
      expect(rec.log.some((e) => e.name === "banditDeath" && e.args[0] === id)).toBe(true);
    }
  });

  it("puts riflemen on the roofs and the tower from wave 6", () => {
    const { m } = makeMatch(9, { wave: 6 });
    m.health.immortal = true;
    run(m, 40);
    const riflemen = m.bandits.filter((b) => b.role === "rifleman");
    expect(riflemen.length).toBeGreaterThan(0);
    for (const r of riflemen) expect(["roof", "tower"]).toContain(r.cover.kind);
  });

  it("builds each wave's gang with its roles", () => {
    const q = buildQueue(waveSpec(6), mulberry32(1));
    expect(q.filter((e) => e.role === "rifleman").length).toBe(waveSpec(6).riflemen);
    expect(q.filter((e) => e.armoured).length).toBe(waveSpec(6).armoured);
    const q5 = buildQueue(waveSpec(5), mulberry32(1));
    expect(q5[0]?.role).toBe("boss");
    expect(q5.length).toBe(9);
  });
});

describe("damage and death", () => {
  it("reports each hit with the shooter's direction and dies at zero", () => {
    const { m, rec } = makeMatch(11, { wave: 9 });
    run(m, 120);
    const hits = rec.log.filter((e) => e.name === "playerHit");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) {
      const dir = h.args[1] as number;
      expect(Math.abs(dir)).toBeLessThanOrEqual(Math.PI);
    }
    expect(rec.count("playerDeath")).toBe(1);
    expect(m.phase).toBe("dead");
    const r = m.results();
    expect(r.outcome).toBe("Fell on Wave 9");
    expect(r.stats.map((s) => s.label)).toEqual(["Waves", "Kills", "Headshots", "Accuracy", "Best Streak"]);
  });

  it("a shooter on the left hits from the left", () => {
    const { m, rec } = makeMatch(12, { wave: 3 });
    m.health.immortal = true;
    let shooterX = 0;
    let checked = 0;
    const fire = rec.banditFire.bind(rec);
    rec.banditFire = (b, hit, damage) => {
      shooterX = b.pos.x;
      fire(b, hit, damage);
    };
    const hurt = rec.playerHit.bind(rec);
    rec.playerHit = (damage, direction, h, source) => {
      if (source === "bullet" && Math.abs(shooterX) > 1) {
        expect(Math.sign(direction)).toBe(Math.sign(shooterX));
        checked++;
      }
      hurt(damage, direction, h, source);
    };
    run(m, 60);
    expect(checked).toBeGreaterThan(0);
  });
});

describe("dynamite", () => {
  it("shot in the air: +150, and the blast takes bandits near it", () => {
    const { m, rec } = makeMatch(13, { wave: 4 });
    m.health.immortal = true;
    let shot = false;
    run(m, 60, () => {
      for (const s of m.sticks) {
        if (!shot && s.airborne && s.age > 0.4) {
          m.trigger();
          m.resolveShot({ kind: "dynamite", stick: s });
          shot = true;
        }
      }
    });
    expect(shot).toBe(true);
    const e = rec.log.find((x) => x.name === "dynamiteShot");
    expect((e?.args[1] as { points: number }).points).toBeGreaterThanOrEqual(150);
    expect(rec.log.some((x) => x.name === "dynamiteExplode" && x.args[1] === true)).toBe(true);
  });

  it("left alone it lands in front of you and costs heavy damage", () => {
    const { m, rec } = makeMatch(13, { wave: 4 });
    m.health.immortal = true;
    run(m, 60);
    const dyn = rec.log.filter((x) => x.name === "playerHit" && x.args[3] === "dynamite");
    expect(dyn.length).toBeGreaterThan(0);
    expect(dyn[0]?.args[0]).toBeGreaterThanOrEqual(55);
  });

  it("shooting a dynamiter with a lit stick drops it at his feet", () => {
    const { m, rec } = makeMatch(14, { wave: 4 });
    m.health.immortal = true;
    let dropped = false;
    run(m, 60, () => {
      for (const b of m.bandits) {
        if (!dropped && b.role === "dynamiter" && b.state === "lighting") {
          m.trigger();
          m.resolveShot({ kind: "bandit", bandit: b, part: "body" });
          dropped = true;
        }
      }
    });
    expect(dropped).toBe(true);
    expect(rec.count("dynamiteDropped")).toBeGreaterThanOrEqual(1);
    const hits = rec.log.filter((x) => x.name === "playerHit" && x.args[3] === "dynamite");
    // His own stick, far from you, does not hurt you.
    expect(hits.length === 0 || rec.count("dynamiteExplode") > hits.length).toBe(true);
  });
});

describe("townsfolk", () => {
  it("appear during a wave, and shooting one costs 200 and Clean Hands", () => {
    const { m, rec } = makeMatch(15, { wave: 3 });
    m.health.immortal = true;
    let shotOne = false;
    run(m, 90, () => {
      for (const p of m.townsfolk) {
        if (!shotOne && p.shootable && p.state === "out") {
          m.trigger();
          m.resolveShot({ kind: "townsfolk", person: p });
          shotOne = true;
        }
      }
      if (m.wave === 3) marksman(m)();
    });
    expect(rec.count("townsfolkAppear")).toBeGreaterThan(0);
    expect(shotOne).toBe(true);
    const shot = rec.log.find((x) => x.name === "townsfolkShot");
    expect((shot?.args[1] as { points: number }).points).toBe(-200);
    const clear = rec.log.find((x) => x.name === "waveClear");
    expect((clear?.args[1] as { cleanHands: number }).cleanHands).toBe(0);
  });

  it("put their hands up when bullets fly", () => {
    const { m } = makeMatch(15, { wave: 3 });
    m.health.immortal = true;
    let raised = false;
    run(m, 60, () => {
      for (const p of m.townsfolk) {
        if (p.state === "out" && !raised) {
          m.trigger();
          m.resolveShot({ kind: "scenery" });
          raised = p.handsUp(m.time);
        }
      }
    });
    expect(raised).toBe(true);
  });
});

describe("streaks and quick draws", () => {
  it("counts a kill within half a second of a bandit showing himself as a Quick Draw", () => {
    const { m, rec } = makeMatch(16);
    run(m, 30, () => {
      for (const b of m.bandits) {
        if (b.shootable && m.time - b.emergedAt > 0.2 && m.time - b.emergedAt < 0.3) {
          if (m.revolver.rounds === 0) m.requestReload();
          if (m.trigger() === "fired") m.resolveShot({ kind: "bandit", bandit: b, part: "body" });
        }
      }
    });
    const deaths = rec.log.filter((e) => e.name === "banditDeath");
    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths.every((d) => (d.args[2] as { labels: string[] }).labels.includes("Quick Draw"))).toBe(true);
  });

  it("a miss resets the multiplier; secrets neither build nor break it", () => {
    const { m } = makeMatch(17);
    m.scorer.shot(true);
    m.scorer.shot(true);
    m.scorer.shot(true);
    expect(m.scorer.multiplier).toBe(2);
    m.resolveShot({ kind: "secret", secret: "vane" });
    m.resolveShot({ kind: "chicken" });
    expect(m.scorer.multiplier).toBe(2);
    expect(m.scorer.shots).toBe(3);
    m.resolveShot({ kind: "scenery" });
    expect(m.scorer.multiplier).toBe(1);
  });
});

describe("secrets through the match", () => {
  it("each one announces itself once", () => {
    const { m, rec } = makeMatch(18);
    m.resolveShot({ kind: "secret", secret: "bell" });
    m.resolveShot({ kind: "secret", secret: "bell" });
    m.resolveShot({ kind: "secret", secret: "bell" });
    m.resolveShot({ kind: "secret", secret: "vane" });
    m.resolveShot({ kind: "secret", secret: "water_tower" });
    m.resolveShot({ kind: "secret", secret: "poster" });
    for (let i = 0; i < 3; i++) m.resolveShot({ kind: "secret", secret: "piano" });
    for (let i = 0; i < 3; i++) m.resolveShot({ kind: "chicken" });
    for (let i = 0; i < 5; i++) m.resolveShot({ kind: "tumbleweed" });
    m.resolveShot({ kind: "secret", secret: "vane" });
    const found = rec.log.filter((e) => e.name === "secretFound").map((e) => e.args[0]);
    expect(found).toEqual(["bell", "vane", "water_tower", "poster", "piano", "chicken"]);
    expect(rec.last("bellToll")?.args).toEqual([3, true]);
    expect(rec.last("tumbleweedShot")?.args).toEqual([5, true]);
    expect(m.secrets.giantPending).toBe(true);
  });

  it("the giant tumbleweed rolls in the next breather and counts then", () => {
    const { m, rec } = makeMatch(19);
    for (let i = 0; i < 5; i++) m.resolveShot({ kind: "tumbleweed" });
    run(m, 60, () => {
      if (m.wave === 1) marksman(m)();
    });
    expect(rec.log.find((e) => e.name === "intermission")?.args).toEqual([2, true]);
    expect(rec.log.some((e) => e.name === "secretFound" && e.args[0] === "tumbleweeds")).toBe(true);
  });

  it("high noon opens with a duel and a bell", () => {
    const { m, rec } = makeMatch(20, { duel: true });
    expect(m.phase).toBe("duel");
    expect(rec.last("banner")?.args[0]).toBe("High Noon");
    expect(rec.log.some((e) => e.name === "secretFound" && e.args[0] === "high_noon")).toBe(true);
    let bellAt = -1;
    run(m, 20, () => {
      if (bellAt < 0 && rec.count("duelBell") > 0) bellAt = m.time;
      const d = m.bandits[0] as Bandit;
      if (bellAt > 0 && d.alive && m.time - bellAt > 0.3) {
        m.trigger();
        m.resolveShot({ kind: "bandit", bandit: d, part: "head" });
      }
    });
    expect(bellAt).toBeGreaterThan(5);
    const death = rec.log.find((e) => e.name === "banditDeath");
    expect((death?.args[2] as { labels: string[] }).labels).toContain("Quick Draw");
    expect(m.phase).toBe("combat");
  });

  it("the duelist walks out from his cover to the town's mark in the street", () => {
    const mark: Cover = {
      id: "street.duel",
      kind: "corner",
      emerge: "step_out",
      level: 0,
      exposed: { x: 0.4, y: 0, z: -12.5 },
      hidden: { x: 4.7, y: 0, z: -13.5 },
      distance: 12.5,
      side: 0,
      tags: ["duel"],
    };
    const rec = new Recorder();
    const m = new Match({ random: mulberry32(4), covers: [...testCovers(), mark], listener: rec });
    m.start({ duel: true });
    const d = m.bandits[0] as Bandit;
    expect(d.cover.id).toBe("street.duel");
    expect(d.pos).toEqual(mark.hidden);
    run(m, 7);
    expect(d.state).toBe("standoff");
    expect(d.pos.x).toBeCloseTo(0.4);
    expect(d.pos.z).toBeCloseTo(-12.5);
  });
});

describe("where the gang fights from", () => {
  /** Every cover a bandit was sent to (spawned at, relocated to, ran to), over a long fight. */
  function coversUsed(covers: Cover[], wave: number, seconds: number, seed = 7): Set<string> {
    const rec = new Recorder();
    const m = new Match({ random: mulberry32(seed), covers, listener: rec });
    m.start({ wave });
    m.health.immortal = true;
    const used = new Set<string>();
    run(m, seconds, () => {
      // This wave's, not the next one's once it is cleared.
      if (m.wave !== wave) return;
      for (const b of m.bandits) {
        used.add(b.cover.id);
        if (b.runTo) used.add(b.runTo.id);
      }
      // Kill slowly, so relocations and runs happen too.
      if (Math.round(m.time * 60) % 150 !== 0) return;
      const b = m.bandits.find((x) => x.shootable);
      if (!b) return;
      if (m.revolver.rounds === 0) m.requestReload();
      if (m.trigger() === "fired") m.resolveShot({ kind: "bandit", bandit: b, part: "head" });
    });
    return used;
  }

  it("keeps wave 1 within 30 m and wave 2 within 40 m", () => {
    const covers = testCovers();
    const far = (limit: number) => new Set(covers.filter((c) => c.distance > limit).map((c) => c.id));
    for (const [wave, limit] of [[1, 30], [2, 40]] as const) {
      const used = coversUsed(covers, wave, 40);
      expect(used.size).toBeGreaterThan(2);
      for (const id of used) expect(far(limit).has(id), `${id} on wave ${wave}`).toBe(false);
    }
  });

  it("never sends anyone but the duelist to the duel's mark in the street", () => {
    const covers = testCovers();
    const mark = { ...covers.find((c) => c.id === "wagon")!, id: "street.duel", tags: ["duel"], exposed: { x: 0.4, y: 0, z: -12.5 }, distance: 12.5 };
    const withMark = [...covers, mark];
    for (const wave of [1, 3, 5]) expect(coversUsed(withMark, wave, 60).has("street.duel")).toBe(false);
  });
});

describe("determinism", () => {
  function transcript(seed: number) {
    const { m, rec } = makeMatch(seed, { wave: 4 });
    run(m, 45, () => {
      // A scripted, imperfect player: shoots whoever is out every 0.7 s.
      if (Math.round(m.time * 60) % 42 !== 0) return;
      const b = m.bandits.find((x) => x.shootable);
      if (m.revolver.rounds === 0) m.requestReload();
      if (m.trigger() !== "fired") return;
      m.resolveShot(b ? { kind: "bandit", bandit: b, part: m.time % 2 < 1 ? "head" : "body" } : { kind: "scenery" });
    });
    return JSON.stringify(rec.log.map((e) => [e.name, e.args.filter((a) => typeof a !== "object")]));
  }

  it("replays exactly with the same seed", () => {
    expect(transcript(42)).toBe(transcript(42));
  });

  it("plays differently with another seed", () => {
    expect(transcript(42)).not.toBe(transcript(43));
  });
});
