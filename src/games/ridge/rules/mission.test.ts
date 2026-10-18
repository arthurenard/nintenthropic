import { describe, expect, it } from "vitest";
import type { Actor } from "./actors";
import type { Mission } from "./mission";
import { newMission, run, testPlan } from "./testkit";
import { CONVOY_TIME, OFFICER_INSPECT, STAGE_INTRO } from "./tuning";

const hostiles = (m: Mission) => m.actors.filter((a) => a.hostile);
const eye = { x: 0, y: 0, z: 0 };
const range = (a: Actor) => Math.hypot(a.pos.x, a.pos.y, a.pos.z);

/** Fire and land a round on `a` at `part`, as the world would once it arrives. */
function ready(m: Mission): void {
  if (m.rifle.state === "spent") {
    m.cycle();
    run(m, 0.7);
  }
  if (m.rifle.state === "open") {
    m.requestReload();
    run(m, 2.1);
  }
}

function shoot(m: Mission, a: Actor, part: "head" | "body" = "head"): void {
  ready(m);
  expect(m.trigger()).toBe("fired");
  m.land({ target: { kind: "actor", id: a.id, part }, point: { ...a.pos }, range: range(a) });
}

function miss(m: Mission, near: Actor, off = 2): void {
  ready(m);
  expect(m.trigger()).toBe("fired");
  m.land({ target: { kind: "scenery" }, point: { x: near.pos.x + off, y: near.pos.y, z: near.pos.z }, range: range(near) }, [{ id: near.id, distance: off }]);
}

describe("the first stage: sentries", () => {
  it("puts three sentries at the guard post and the tower, 250–300 m out", () => {
    const { mission: m, rec } = newMission(1);
    m.start();
    expect(rec.last("stageIntro")?.args).toEqual([1, "Stage 1", "Three sentries at the guard post. Take them quietly."]);
    const h = hostiles(m);
    expect(h).toHaveLength(3);
    expect(h.map((a) => a.role)).toContain("tower");
    for (const a of h) {
      expect(range(a)).toBeGreaterThan(245);
      expect(range(a)).toBeLessThan(300);
      expect(a.objective).toBe(true);
    }
    run(m, STAGE_INTRO + 0.1);
    expect(m.phase).toBe("combat");
  });

  it("is won quietly: three clean headshots, a Ghost and a Clean Conscience", () => {
    const { mission: m, rec } = newMission(1);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    for (const a of hostiles(m)) shoot(m, a);
    expect(m.remaining).toBe(0);
    run(m, 2.5);
    const clear = rec.last("stageClear")!.args[1] as { ghost: number; cleanConscience: number; accuracy: number };
    expect(clear.ghost).toBe(500);
    expect(clear.cleanConscience).toBe(250);
    expect(clear.accuracy).toBe(1);
    expect(m.phase).toBe("breather");
    // One Shot, One Kill: each clean kill steps the multiplier up for the next.
    expect(rec.log.filter((e) => e.name === "streakUp").map((e) => e.args[0])).toEqual([2, 3, 4]);
    run(m, 6.5);
    expect(m.stage).toBe(2);
  });

  it("wakes the valley with a wound: two body shots to kill, and the gunner opens up", () => {
    const { mission: m, rec } = newMission(2);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const tower = hostiles(m).find((a) => a.role === "tower")!;
    shoot(m, tower, "body");
    expect(tower.alive).toBe(true);
    expect(tower.activity).toBe("wound");
    expect(rec.last("alerted")?.args[0]).toBe("wound");
    expect(m.alerted).toBe(true);
    shoot(m, tower, "body");
    expect(tower.alive).toBe(false);
    // The machine-gunner, now alerted, fires at the ridge.
    run(m, 6);
    expect(rec.count("enemyFire")).toBeGreaterThan(0);
    expect(rec.log.find((e) => e.name === "enemyFire")?.args[1]).toBe("mg");
  });

  it("hears every report a moment later, and misses landing near a man add to it", () => {
    const { mission: m, rec } = newMission(3);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const a = hostiles(m)[0]!;
    miss(m, a, 3);
    expect(m.alert).toBeGreaterThan(0.2);
    expect(m.alerted).toBe(false);
    // The rifle's report reaches the checkpoint about 0.8 s later.
    const before = m.alert;
    run(m, 1);
    expect(m.alert).toBeGreaterThan(before);
    miss(m, a, 2);
    run(m, 1.2);
    miss(m, a, 2);
    run(m, 1.2);
    expect(m.alerted).toBe(true);
    expect(["miss", "report"]).toContain(rec.last("alerted")?.args[0]);
  });

  it("notices a body: a man near a fallen comrade raises the alarm after a few seconds", () => {
    const { mission: m, rec } = newMission(4);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const h = hostiles(m);
    // The two nearest each other.
    let pair: [Actor, Actor] = [h[0]!, h[1]!];
    let best = Infinity;
    for (const a of h) for (const b of h) if (a !== b && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < best) {
      best = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      pair = [a, b];
    }
    expect(best).toBeLessThan(30);
    shoot(m, pair[0]);
    run(m, 1);
    expect(m.alerted).toBe(false);
    run(m, 6);
    expect(m.alerted).toBe(true);
    expect(rec.log.filter((e) => e.name === "alerted").map((e) => e.args[0])).toContain("body");
  });

  it("charges for a civilian, loses Clean Conscience, and alerts the valley", () => {
    const { mission: m, rec } = newMission(5);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const farmer = m.actors.find((a) => a.role === "farmer")!;
    shoot(m, farmer, "body");
    expect(rec.last("innocentHit")?.args[2]).toEqual({ points: -500, labels: ["Civilian"] });
    expect(m.alerted).toBe(true);
    for (const a of hostiles(m)) shoot(m, a);
    run(m, 2.5);
    expect((rec.last("stageClear")!.args[1] as { cleanConscience: number }).cleanConscience).toBe(0);
  });

  it("charges 100 for an animal, and says which", () => {
    const { mission: m, rec } = newMission(5);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const cow = m.actors.find((a) => a.role === "cow")!;
    shoot(m, cow, "body");
    expect(rec.last("innocentHit")?.args[2]).toEqual({ points: -100, labels: ["Cow"] });
    expect(m.alerted).toBe(false);
  });
});

describe("the convoy", () => {
  it("fails the run if the lead truck reaches the bridge", () => {
    const { mission: m, rec } = newMission(7);
    m.start(3);
    expect(m.vehicles.filter((v) => v.kind === "truck")).toHaveLength(2);
    expect(m.clock()).toBeCloseTo(CONVOY_TIME, 0);
    run(m, STAGE_INTRO + 20);
    // The clock counts down as it drives.
    expect(m.clock()!).toBeLessThan(CONVOY_TIME - 12);
    run(m, CONVOY_TIME);
    expect(m.phase).toBe("failed");
    expect(rec.last("failed")?.args[0]).toEqual({ kind: "convoy" });
    expect(m.results().outcome).toBe("Convoy Crossed on Stage 3");
  });

  it("halts at the checkpoint's barrier on its way", () => {
    const { mission: m } = newMission(7);
    m.start(3);
    let halted = false;
    for (let t = 0; t < 45 && m.phase !== "failed"; t += 1 / 30) {
      m.update(1 / 30);
      if (m.vehicles[0]!.halted) halted = true;
    }
    expect(halted).toBe(true);
  });

  it("stops when its driver is shot, and the troops jump down and take cover", () => {
    const { mission: m, rec } = newMission(8);
    m.start(3);
    run(m, STAGE_INTRO + 8);
    const lead = m.vehicles[0]!;
    const driver = m.actors.find((a) => a.vehicle === lead && a.seat === "driver")!;
    shoot(m, driver, "body");
    expect(driver.alive).toBe(false);
    expect(rec.last("vehicleStopping")?.args).toEqual([lead.id, "driver"]);
    expect(rec.last("kill")?.args[2]).toMatchObject({ labels: expect.arrayContaining(["Driver"]) });
    run(m, 6);
    expect(lead.stopped).toBe(true);
    const troops = m.actors.filter((a) => a.role === "trooper");
    expect(troops.every((t) => !t.hidden)).toBe(true);
    expect(rec.count("dismount")).toBeGreaterThanOrEqual(troops.length);
    expect(m.alerted).toBe(true);
    // The second truck stops behind it, and everyone must still be taken.
    run(m, 5);
    expect(m.vehicles[1]!.stopped).toBe(true);
    expect(m.phase).toBe("combat");
    for (const a of hostiles(m)) if (a.alive) shoot(m, a);
    run(m, 2.5);
    expect(m.phase).toBe("breather");
  });

  it("stops when its engine takes three hits", () => {
    const { mission: m, rec } = newMission(9);
    m.start(3);
    run(m, STAGE_INTRO + 5);
    const lead = m.vehicles[0]!;
    for (let i = 0; i < 3; i++) {
      if (m.rifle.state === "spent") {
        m.cycle();
        run(m, 0.7);
      }
      m.trigger();
      m.land({ target: { kind: "engine", vehicle: lead.id }, point: { ...lead.pos }, range: 300 });
    }
    expect(lead.steaming).toBe(true);
    expect(rec.last("vehicleStopping")?.args).toEqual([lead.id, "engine"]);
    expect(rec.last("engineStop")?.args[1]).toMatchObject({ points: expect.any(Number) });
    run(m, 6);
    expect(lead.stopped).toBe(true);
    expect(m.phase).toBe("combat");
  });
});

describe("the counter-sniper", () => {
  it("glints before he fires, and finds an idle player in the end", () => {
    const { mission: m, rec } = newMission(11);
    m.start(4);
    const sniper = hostiles(m).find((a) => a.role === "sniper")!;
    expect(sniper.hidden).toBe(true);
    run(m, 40);
    const first = rec.log.findIndex((e) => e.name === "enemyFire");
    const steady = rec.log.findIndex((e) => e.name === "glint" && e.args[2] === "scope");
    expect(steady).toBeGreaterThanOrEqual(0);
    expect(steady).toBeLessThan(first);
    expect(m.phase).toBe("dead");
    expect(m.ending).toMatchObject({ kind: "fell", by: "sniper" });
    expect(m.results().note).toMatch(/^The counter-sniper (in the chapel tower|on the far ledge)\. His scope glints before he fires\. Find it first\.$/);
  });

  it("glints twice as long on Relaxed, and hits softer", () => {
    const a = newMission(11, "standard");
    const b = newMission(11, "relaxed");
    a.mission.start(4);
    b.mission.start(4);
    run(a.mission, 30);
    run(b.mission, 90);
    const glint = (r: typeof a.rec) => r.log.find((e) => e.name === "glint" && e.args[2] === "scope")!.args[1] as number;
    expect(glint(b.rec)).toBeCloseTo(glint(a.rec) * 2);
    const hitA = a.rec.log.find((e) => e.name === "playerHit")?.args[0] as number;
    const hitB = b.rec.log.find((e) => e.name === "playerHit")?.args[0] as number;
    expect(hitA).toBe(45);
    expect(hitB).toBe(34);
  });

  it("dies to one round: prone, he is hit along his length", () => {
    const { mission: m, rec } = newMission(12);
    m.start(4);
    const sniper = hostiles(m).find((a) => a.role === "sniper")!;
    for (let t = 0; t < 30 && sniper.hidden; t += 1 / 30) m.update(1 / 30);
    expect(sniper.hidden).toBe(false);
    shoot(m, sniper, "body");
    expect(sniper.alive).toBe(false);
    expect(rec.last("kill")?.args[2]).toMatchObject({ labels: expect.arrayContaining(["Sniper"]) });
    run(m, 2.5);
    expect(m.phase).toBe("breather");
  });
});

describe("the officer", () => {
  it("inspects the dam, drives for the tunnel, and escapes an idle player", () => {
    const { mission: m, rec } = newMission(13);
    m.start(5);
    const officer = hostiles(m).find((a) => a.role === "officer")!;
    expect(range(officer)).toBeGreaterThan(820);
    expect(range(officer)).toBeLessThan(960);
    run(m, STAGE_INTRO + OFFICER_INSPECT - 2);
    expect(officer.state).toBe("inspect");
    run(m, 20);
    expect(officer.seat).toBe("driver");
    run(m, 60);
    expect(m.phase).toBe("failed");
    expect(rec.last("failed")?.args[0]).toEqual({ kind: "officer" });
  });

  it("runs for the tunnel on foot when his jeep's engine is dead", () => {
    const { mission: m } = newMission(14);
    m.start(5);
    run(m, STAGE_INTRO + 1);
    const jeep = m.vehicles.find((v) => v.kind === "jeep")!;
    for (let i = 0; i < 3; i++) {
      if (m.rifle.state === "spent") {
        m.cycle();
        run(m, 0.7);
      }
      m.trigger();
      m.land({ target: { kind: "engine", vehicle: jeep.id }, point: { ...jeep.pos }, range: 870 });
      run(m, 0.2);
    }
    expect(jeep.steaming).toBe(true);
    const officer = hostiles(m).find((a) => a.role === "officer")!;
    for (let t = 0; t < 60 && officer.state !== "on_foot"; t += 1 / 30) m.update(1 / 30);
    expect(officer.state).toBe("on_foot");
    expect(officer.activity).toBe("run");
    const killed = officer.alive;
    shoot(m, officer, "head");
    expect(killed && !officer.alive).toBe(true);
    expect(m.scorer.score).toBeGreaterThan(800);
  });
});

describe("the valley's secrets", () => {
  it("brings the eagle down after three near misses, never for hitting it", () => {
    const { mission: m, rec } = newMission(15);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const eagle = m.actors.find((a) => a.role === "eagle")!;
    for (let i = 0; i < 3; i++) miss(m, eagle, 4);
    expect(rec.count("eagleLands")).toBe(1);
    run(m, 2);
    expect(rec.last("secretFound")?.args.slice(0, 2)).toEqual(["eagle", "Staring Contest"]);
  });

  it("sends the goat to a higher ledge for a round landing near it", () => {
    const { mission: m, rec } = newMission(16);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const goat = m.actors.find((a) => a.role === "goat")!;
    miss(m, goat, 2);
    expect(rec.last("goatHop")?.args[1]).toBe(1);
    run(m, 1.5);
    expect(goat.pos.y).toBeCloseTo(testPlan().goatLedges[1]!.y);
    expect(rec.log.some((e) => e.name === "secretFound" && e.args[0] === "goat")).toBe(true);
  });

  it("counts the duck as a secret, never as an animal", () => {
    const { mission: m, rec } = newMission(17);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const duck = m.actors.find((a) => a.role === "duck")!;
    shoot(m, duck, "body");
    expect(rec.count("innocentHit")).toBe(0);
    expect(rec.last("secretFound")?.args.slice(0, 2)).toEqual(["duck", "The Duck"]);
    expect(duck.alive).toBe(true);
  });

  it("finds each secret once, and counts eight", () => {
    const { mission: m, rec } = newMission(18);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    for (const id of ["bell", "bell", "siren", "cheese", "yeti", "echo"] as const) {
      if (m.rifle.state === "spent") {
        m.cycle();
        run(m, 0.7);
      }
      m.trigger();
      m.land({ target: { kind: "secret", secret: id }, point: eye, range: 500 });
    }
    expect(rec.log.filter((e) => e.name === "secretFound").map((e) => e.args[0])).toEqual(["bell", "siren", "cheese", "yeti", "echo"]);
    expect(m.results().secretsTotal).toBe(8);
    expect(m.results().secretsFound).toBe(5);
  });
});

describe("the whole run", () => {
  it("replays exactly from the same seed", () => {
    const a = newMission(21);
    const b = newMission(21);
    a.mission.start(3);
    b.mission.start(3);
    run(a.mission, 50);
    run(b.mission, 50);
    expect(a.rec.log.map((e) => e.name)).toEqual(b.rec.log.map((e) => e.name));
    expect(a.mission.vehicles.map((v) => v.pos)).toEqual(b.mission.vehicles.map((v) => v.pos));
  });

  it("brings the mortars on alert from the sixth stage", () => {
    const { mission: m, rec } = newMission(22);
    m.start(6);
    expect(hostiles(m).filter((a) => a.role === "mortar")).toHaveLength(2);
    run(m, STAGE_INTRO + 5);
    expect(rec.count("mortarLaunch")).toBe(0);
    const farmer = m.actors.find((a) => a.role === "farmer")!;
    shoot(m, farmer, "body");
    run(m, 20);
    expect(rec.count("mortarLaunch")).toBeGreaterThan(0);
    expect(rec.count("mortarLand")).toBeGreaterThan(0);
  });

  it("stands the player's health back up between stages", () => {
    const { mission: m } = newMission(23);
    m.start();
    m.health.hit(60);
    run(m, STAGE_INTRO + 0.5);
    for (const a of hostiles(m)) shoot(m, a);
    run(m, 2.5);
    expect(m.phase).toBe("breather");
    expect(m.health.value).toBe(100);
  });
});
