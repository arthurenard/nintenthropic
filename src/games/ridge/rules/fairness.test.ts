import { describe, expect, it } from "vitest";
import type { Actor, Vehicle } from "./actors";
import type { Mission } from "./mission";
import { newMission, run } from "./testkit";
import { STAGE_INTRO } from "./tuning";

/**
 * What a player must be able to count on, whatever the dice say: every man
 * the job needs can be reached by a round from the ridge, nobody hurts you
 * once the job is done, the enemy's fire comes when the rules say, and the
 * valley's own creatures stay where they belong.
 */

const hostiles = (m: Mission) => m.actors.filter((a) => a.hostile);
const range = (a: Actor) => Math.hypot(a.pos.x, a.pos.y, a.pos.z);

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

/** The truck as the art builds it: 2.5 m across, 2.85 m to the top of its canvas, 6.9 m long. */
const TRUCK = { halfWidth: 1.25, height: 2.85, halfLength: 3.46 };

/** Does the straight line from the eye to `p` pass through the truck `v`? Sampled finely, in the truck's own space. */
function behindTruck(m: Mission, v: Vehicle, p: { x: number; y: number; z: number }): boolean {
  const eye = m.plan.eye;
  const sin = Math.sin(v.heading);
  const cos = Math.cos(v.heading);
  const steps = 4000;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const dx = eye.x + (p.x - eye.x) * t - v.pos.x;
    const dy = eye.y + (p.y - eye.y) * t - v.pos.y;
    const dz = eye.z + (p.z - eye.z) * t - v.pos.z;
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    if (Math.abs(lx) <= TRUCK.halfWidth && dy >= 0 && dy <= TRUCK.height && Math.abs(lz) <= TRUCK.halfLength) return true;
  }
  return false;
}

describe("the convoy's troops", () => {
  it("take cover where the ridge can see them, never in a truck's shadow", () => {
    for (const seed of [8, 31, 32, 33, 34, 35]) {
      const { mission: m } = newMission(seed);
      m.start(3);
      run(m, STAGE_INTRO + 8);
      const lead = m.vehicles[0]!;
      const driver = m.actors.find((a) => a.vehicle === lead && a.seat === "driver")!;
      shoot(m, driver, "body");
      run(m, 14);
      const down = hostiles(m).filter((a) => a.alive && a.vehicle === null && (a.role === "trooper" || a.role === "driver"));
      expect(down.length).toBeGreaterThan(0);
      for (const a of down) {
        expect(a.state === "hunker" || a.state === "search", `${a.role} #${a.id} is in cover (seed ${seed})`).toBe(true);
        // Crouched, his chest is about 0.9 m up.
        const chest = { x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z };
        for (const v of m.vehicles) expect(behindTruck(m, v, chest), `${a.role} #${a.id} hides behind truck #${v.id} (seed ${seed})`).toBe(false);
      }
    }
  });

  it("stop where they are when their driver is shot before the convoy sets off", () => {
    const { mission: m, rec } = newMission(8);
    m.start(3);
    run(m, 1);
    expect(m.phase).toBe("intro");
    const lead = m.vehicles[0]!;
    const driver = m.actors.find((a) => a.vehicle === lead && a.seat === "driver")!;
    shoot(m, driver, "body");
    expect(driver.alive).toBe(false);
    const at = lead.walker.s;
    run(m, STAGE_INTRO + 20);
    // No truck rolls on without its driver; the convoy never reaches the bridge.
    expect(lead.walker.s).toBeCloseTo(at, 3);
    expect(lead.stopped).toBe(true);
    expect(rec.last("vehicleStopping")?.args).toEqual([lead.id, "driver"]);
    expect(m.phase).toBe("combat");
  });
});

describe("the enemy's fire", () => {
  it("brings the mortar's first round a few seconds after the valley wakes, not the moment it does", () => {
    const { mission: m, rec } = newMission(22);
    m.start(6);
    run(m, STAGE_INTRO + 20);
    expect(rec.count("mortarLaunch")).toBe(0);
    const farmer = m.actors.find((a) => a.role === "farmer")!;
    shoot(m, farmer, "body");
    expect(m.alerted).toBe(true);
    run(m, 2.5);
    expect(rec.count("mortarLaunch")).toBe(0);
    run(m, 4);
    expect(rec.count("mortarLaunch")).toBe(1);
  });

  it("never hurts the player once the job is done: a round in the air lands harmlessly", () => {
    let launches = 0;
    for (const seed of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49]) {
      const { mission: m, rec } = newMission(seed);
      m.health.immortal = true;
      m.start(6);
      run(m, STAGE_INTRO + 1);
      const farmer = m.actors.find((a) => a.role === "farmer")!;
      shoot(m, farmer, "body");
      // Until the mortar has a round in the air.
      for (let t = 0; t < 30 && rec.count("mortarLaunch") === 0; t += 1 / 30) m.update(1 / 30);
      if (rec.count("mortarLaunch") === 0) continue;
      launches++;
      // The job falls at once (a clean run of shots).
      for (const a of hostiles(m)) if (a.alive && a.objective && a.shootable) shoot(m, a);
      run(m, 0.3);
      expect(m.phase).toBe("clear");
      const done = rec.log.length;
      run(m, 9);
      expect(m.stage).toBe(7);
      const after = rec.log.slice(done);
      expect(after.filter((e) => e.name === "playerHit"), `seed ${seed}`).toEqual([]);
      expect(after.filter((e) => e.name === "enemyFire"), `seed ${seed}`).toEqual([]);
      // The round already on its way still comes down, far off.
      expect(after.filter((e) => e.name === "mortarLand").every((e) => e.args[0] === "far" && e.args[1] === 0)).toBe(true);
    }
    expect(launches).toBeGreaterThan(5);
  });
});

describe("the valley's creatures", () => {
  it("leave a goat shot mid-leap where it fell", () => {
    const { mission: m } = newMission(16);
    m.start();
    run(m, STAGE_INTRO + 0.5);
    const goat = m.actors.find((a) => a.role === "goat")!;
    ready(m);
    m.trigger();
    m.land({ target: { kind: "scenery" }, point: { x: goat.pos.x + 2, y: goat.pos.y, z: goat.pos.z }, range: range(goat) }, [{ id: goat.id, distance: 2 }]);
    expect(goat.activity).toBe("hop");
    const where = { ...goat.pos };
    shoot(m, goat, "body");
    expect(goat.alive).toBe(false);
    run(m, 3);
    expect(goat.activity).toBe("dead");
    expect(goat.pos).toEqual(where);
  });

  it("keep the cows and the sheep to their own patch over a long morning", () => {
    const { mission: m } = newMission(51);
    m.start();
    const herd = m.actors.filter((a) => a.role === "cow" || a.role === "sheep");
    const start = herd.map((a) => ({ ...a.pos }));
    run(m, 1800, 1 / 10);
    const strayed = herd.map((a, i) => Math.hypot(a.pos.x - start[i]!.x, a.pos.z - start[i]!.z));
    expect(Math.max(...strayed)).toBeLessThan(4.5);
  });
});
