// Aim Assist in High Noon's shots: the real Shooter, in a street made of fakes
// (a camera, men standing at known places, a bell), asked where a bullet goes.
import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { ASSIST_BOOST } from "../../../engine/rules/assist";
import { effectiveRadius, probePoint, probeSegment, type RayProbe } from "../../../engine/rules/raymath";
import { mulberry32 } from "../../../engine/rules/rng";
import { Joints } from "../../../engine/world/character";
import { Bandit } from "../rules/bandit";
import { Dynamite } from "../rules/dynamite";
import { testCovers } from "../rules/testkit";
import { Townsperson } from "../rules/townsfolk";
import type { Cast } from "./cast";
import type { TownQueries } from "./queries";
import { ASSIST, Shooter, type ShootableWorld } from "./shooting";
import type { TownLayout } from "./town";

const FOV = 45;
const ASPECT = 16 / 9;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);

/** The metres a fraction of the view's smaller side spans at a distance (the view is wider than tall). */
const metres = (fraction: number, distance: number) => fraction * 2 * TAN_HALF * distance;
/** The fraction of the smaller side that a number of metres spans at a distance. */
const side = (m: number, distance: number) => m / metres(1, distance);

/** A man standing with his feet at (x, z), facing the player, in the shapes a shot is tested against. */
function standing(x: number, z: number): Joints {
  const j = new Joints();
  j.head.set(x, 1.62, z);
  j.neck.set(x, 1.45, z);
  j.hips.set(x, 0.95, z);
  j.shoulderL.set(x - 0.2, 1.4, z);
  j.shoulderR.set(x + 0.2, 1.4, z);
  j.elbowL.set(x - 0.28, 1.15, z);
  j.elbowR.set(x + 0.28, 1.15, z);
  j.handL.set(x - 0.3, 0.9, z);
  j.handR.set(x + 0.3, 0.9, z);
  j.thighL.set(x - 0.1, 0.9, z);
  j.thighR.set(x + 0.1, 0.9, z);
  j.kneeL.set(x - 0.1, 0.5, z);
  j.kneeR.set(x + 0.1, 0.5, z);
  j.footL.set(x - 0.1, 0.05, z);
  j.footR.set(x + 0.1, 0.05, z);
  return j;
}

const cover = testCovers()[0]!;

function bandit(id: number, role: Bandit["role"] = "gunman", state: Bandit["state"] = "aiming"): Bandit {
  const b = new Bandit(id, role, cover);
  b.state = state;
  b.visible = true;
  return b;
}

function townsperson(id: number): Townsperson {
  const p = new Townsperson(id, "barber", cover, 5);
  p.state = "out";
  p.visible = true;
  return p;
}

interface Shot {
  kind: string;
  part: string | null;
  distance: number;
}

/** A street with a camera at the player's eye and whatever the test stands in it. */
class Street {
  readonly settings = { aimAssist: true };
  readonly camera = new PerspectiveCamera(FOV, ASPECT, 0.1, 400);
  readonly men: { b: Bandit; rig: { updateJoints: () => Joints } }[] = [];
  readonly folk: { p: Townsperson; rig: { updateJoints: () => Joints } }[] = [];
  readonly sticks: Dynamite[] = [];
  bell: Vector3 | null = null;
  private readonly shooter: Shooter;

  constructor() {
    this.camera.position.set(0, 1.7, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    const world: ShootableWorld = {
      sticks: () => this.sticks,
      tumbleweeds: () => [],
      chicken: () => null,
      bellCenter: () => this.bell,
      vaneCenter: () => null,
    };
    this.shooter = new Shooter(
      this.camera,
      { cast: () => null } as unknown as TownQueries,
      { glass: new Map(), secrets: {} } as unknown as TownLayout,
      { bandits: this.men, townsfolk: this.folk } as unknown as Cast,
      world,
      this.settings,
    );
  }

  man(b: Bandit, x: number, z: number): Joints {
    const joints = standing(x, z);
    this.men.push({ b, rig: { updateJoints: () => joints } });
    return joints;
  }

  person(p: Townsperson, x: number, z: number): Joints {
    const joints = standing(x, z);
    this.folk.push({ p, rig: { updateJoints: () => joints } });
    return joints;
  }

  /** Where a point is in the view, in fractions, moved by (dx, dy) fractions of the view's smaller side. */
  at(point: Vector3, dx = 0, dy = 0): [number, number] {
    const p = point.clone().project(this.camera);
    return [(p.x + 1) / 2 + dx / ASPECT, (1 - p.y) / 2 + dy];
  }

  /** The ray a shot at a viewport position follows. */
  ray(x: number, y: number): Raycaster {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(x * 2 - 1, -(y * 2 - 1)), this.camera);
    return ray;
  }

  shoot(x: number, y: number): Shot {
    const r = this.shooter.shoot(x, y);
    return { kind: r.target.kind, part: r.part, distance: r.distance };
  }

  /** A shot at a point, moved sideways (dx) and down (dy) by fractions of the smaller side. */
  shootAt(point: Vector3, dx = 0, dy = 0): Shot {
    const [x, y] = this.at(point, dx, dy);
    return this.shoot(x, y);
  }
}

const CHEST = (z: number, x = 0) => new Vector3(x, 1.2, z);
const HEAD = (z: number, x = 0) => new Vector3(x, 1.62, z);

/** What a bullet really passes through on a man, by his real shapes alone: the spec of "exact". */
function passesThrough(j: Joints, o: Vector3, d: Vector3): boolean {
  const p: RayProbe = { t: 0, miss: 0 };
  probePoint(o, d, j.head, p);
  if (p.t <= 0) return false;
  const headHit = p.miss <= 0.13;
  // Above the neck it is a headshot or a miss, never a body shot.
  if (o.clone().addScaledVector(d, p.t).y > j.neck.y + 0.03) return headHit;
  probeSegment(o, d, j.hips, j.neck, p);
  if (p.miss <= 0.2) return true;
  const limbs: [Vector3, Vector3, number][] = [
    [j.shoulderL, j.elbowL, 0.065],
    [j.elbowL, j.handL, 0.055],
    [j.shoulderR, j.elbowR, 0.065],
    [j.elbowR, j.handR, 0.055],
    [j.thighL, j.kneeL, 0.09],
    [j.kneeL, j.footL, 0.07],
    [j.thighR, j.kneeR, 0.09],
    [j.kneeR, j.footR, 0.07],
  ];
  for (const [a, b, r] of limbs) {
    probeSegment(o, d, a, b, p);
    if (p.miss <= r) return true;
  }
  return headHit;
}

describe("Aim Assist in High Noon", () => {
  it("makes a near miss of a bandit's body a hit, a little wider than the game's own allowance", () => {
    const street = new Street();
    street.man(bandit(1), 0, -25);
    // 3% of the smaller side is 62 cm at 25 m: outside the table's own 2.6%, inside the 3.5% Aim Assist makes of it.
    expect(metres(0.03, 25)).toBeGreaterThan(metres(ASSIST.torso, 25));
    expect(metres(0.03, 25)).toBeLessThan(metres(ASSIST.torso * ASSIST_BOOST, 25));
    expect(street.shootAt(CHEST(-25), 0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
    expect(street.shootAt(CHEST(-25), -0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
    // Past the allowance it is a miss.
    expect(street.shootAt(CHEST(-25), 0.04, 0).kind).not.toBe("bandit");
    expect(street.shootAt(CHEST(-25), 0, -0.2).kind).not.toBe("bandit");
  });

  it("is exact when it is off: a shot hits what it passes through, and nothing near it", () => {
    const street = new Street();
    street.settings.aimAssist = false;
    street.man(bandit(1), 0, -25);
    expect(street.shootAt(CHEST(-25)).kind).toBe("bandit");
    // 18 cm from the torso's axis is inside it (it is 20 cm); 45 cm (past his arm too) and 3% (62 cm) are not.
    expect(street.shootAt(CHEST(-25), side(0.18, 25), 0).kind).toBe("bandit");
    expect(street.shootAt(CHEST(-25), side(0.45, 25), 0).kind).not.toBe("bandit");
    expect(street.shootAt(CHEST(-25), 0.03, 0).kind).not.toBe("bandit");
    // The head is its real 13 cm, however far it is.
    expect(street.shootAt(HEAD(-25), side(0.1, 25), 0)).toMatchObject({ kind: "bandit", part: "head" });
    expect(street.shootAt(HEAD(-25), side(0.16, 25), 0).kind).not.toBe("bandit");
  });

  it("hits exactly the real shapes when it is off, over thousands of shots, and never less than that when on", () => {
    const street = new Street();
    const joints = street.man(bandit(1), 0.3, -22);
    const random = mulberry32(11);
    const centre = street.at(CHEST(-22, 0.3));
    let real = 0;
    let helped = 0;
    for (let i = 0; i < 5000; i++) {
      const x = centre[0] + (random() - 0.5) * 0.09;
      const y = centre[1] + (random() - 0.5) * 0.18;
      const ray = street.ray(x, y).ray;
      const want = passesThrough(joints, ray.origin, ray.direction);
      street.settings.aimAssist = false;
      expect(street.shoot(x, y).kind === "bandit", `exact, shot ${i}`).toBe(want);
      street.settings.aimAssist = true;
      const got = street.shoot(x, y).kind === "bandit";
      // A real hit is never taken away; assist only adds near misses.
      if (want) expect(got, `helped, shot ${i}`).toBe(true);
      if (want) real++;
      if (got) helped++;
    }
    expect(real).toBeGreaterThan(200);
    expect(helped).toBeGreaterThan(real * 1.3);
  });

  it("is read on every shot: turning it off mid-round takes effect at once", () => {
    const street = new Street();
    street.man(bandit(1), 0, -25);
    expect(street.shootAt(CHEST(-25), 0.03, 0).kind).toBe("bandit");
    street.settings.aimAssist = false;
    expect(street.shootAt(CHEST(-25), 0.03, 0).kind).not.toBe("bandit");
    street.settings.aimAssist = true;
    expect(street.shootAt(CHEST(-25), 0.03, 0).kind).toBe("bandit");
  });

  it("keeps the head and the body in proportion, so a headshot is still a headshot", () => {
    const street = new Street();
    street.man(bandit(1), 0, -40);
    // How far from the centre a shot can still be that part, at a range where only the allowance counts.
    const reach = (centre: Vector3, part: string): number => {
      let lo = 0;
      let hi = 0.2;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const r = street.shootAt(centre, mid, 0);
        if (r.kind === "bandit" && r.part === part) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const head = reach(HEAD(-40), "head");
    const body = reach(CHEST(-40), "body");
    expect(head).toBeCloseTo(ASSIST.head * ASSIST_BOOST, 3);
    expect(body).toBeCloseTo(ASSIST.torso * ASSIST_BOOST, 3);
    expect(head / body).toBeCloseTo(ASSIST.head / ASSIST.torso, 1);
    // What the head's zone misses, at head height, is a miss: never promoted to a body shot ...
    expect(street.shootAt(HEAD(-40), head + 0.004, 0).kind).not.toBe("bandit");
    // ... and what only the body's zone reaches is a body shot: never promoted to a headshot.
    expect(street.shootAt(CHEST(-40), 0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
    expect(street.shootAt(new Vector3(0, 1.3, -40), 0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
  });

  it("counts runners, and dynamite in the air, as targets", () => {
    const street = new Street();
    street.man(bandit(1, "runner", "running"), 2, -25);
    expect(street.shootAt(CHEST(-25, 2), 0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
    street.settings.aimAssist = false;
    expect(street.shootAt(CHEST(-25, 2), 0.03, 0).kind).not.toBe("bandit");
    street.settings.aimAssist = true;

    const stick = new Dynamite(1).launch({ x: 0, y: 2, z: -30 }, { x: 0, y: 0, z: -5 }, 1.5);
    stick.position.x = -3;
    stick.position.y = 3;
    stick.position.z = -25;
    street.sticks.push(stick);
    const at = new Vector3(-3, 3, -25);
    // 2.8% is 58 cm at 25 m: past the stick's own 18 cm and its 2.2%, inside what assist gives it.
    expect(metres(0.028, 25)).toBeGreaterThan(metres(ASSIST.dynamite, 25));
    expect(street.shootAt(at, 0.028, 0).kind).toBe("dynamite");
    expect(street.shootAt(at, 0.045, 0).kind).not.toBe("dynamite");
    street.settings.aimAssist = false;
    expect(street.shootAt(at, 0.028, 0).kind).not.toBe("dynamite");
    expect(street.shootAt(at).kind).toBe("dynamite");
  });
});

describe("Aim Assist never helps a shot onto an innocent", () => {
  it("leaves a townsperson to the real shape, however near the shot passes", () => {
    const street = new Street();
    street.person(townsperson(1), 0, -20);
    // A shot straight through is a hit, on or off.
    expect(street.shootAt(CHEST(-20)).kind).toBe("townsfolk");
    street.settings.aimAssist = false;
    expect(street.shootAt(CHEST(-20)).kind).toBe("townsfolk");
    street.settings.aimAssist = true;
    // A shot that passes beside them (50 cm: outside their 22 cm, inside what a bandit would be given) is no hit at all.
    for (const dx of [side(0.5, 20), -side(0.5, 20)]) {
      expect(street.shootAt(CHEST(-20), dx, 0).kind).not.toBe("townsfolk");
    }
  });

  it("prefers no hit to a wrong one: a near miss of a bandit behind someone is not helped past them", () => {
    // The bandit is 90 cm to the side at 30 m; a shot through (35 cm, 20 m) passes beside the person in front.
    const through = new Vector3(0.35, 1.2, -20);
    const alone = new Street();
    alone.man(bandit(1), 0.9, -30);
    expect(alone.shootAt(through)).toMatchObject({ kind: "bandit" }); // helped, with nobody in the way
    const street = new Street();
    street.person(townsperson(1), 0, -20);
    street.man(bandit(1), 0.9, -30);
    expect(["scenery", "none"]).toContain(street.shootAt(through).kind); // nobody in the way is a clean shot, not this one
    // A clean line to the man, past the person, is a real hit all the same.
    expect(street.shootAt(CHEST(-30, 0.9))).toMatchObject({ kind: "bandit" });
    // With the bandit in front of the person, the same near miss is helped.
    const clear = new Street();
    clear.person(townsperson(1), 0, -30);
    clear.man(bandit(1), 0.55, -20);
    expect(clear.shootAt(CHEST(-20, 0.55), 0.03, 0)).toMatchObject({ kind: "bandit", part: "body" });
  });

  it("never turns a shot into a hit on an innocent that exact aim would not have been, over thousands of shots", () => {
    const street = new Street();
    const folk = [street.person(townsperson(1), -0.4, -18), street.person(townsperson(2), 1.2, -26)];
    street.man(bandit(1), 0.1, -24);
    street.man(bandit(2), -1.6, -32);
    const random = mulberry32(5);
    const centre = street.at(CHEST(-24));
    const aTorso = Math.atan(2 * TAN_HALF * ASSIST.torso * ASSIST_BOOST);
    const probe: RayProbe = { t: 0, miss: 0 };
    let snapped = 0;
    let vetoed = 0;
    for (let i = 0; i < 6000; i++) {
      const x = centre[0] + (random() - 0.5) * 0.2;
      const y = centre[1] + (random() - 0.5) * 0.22;
      street.settings.aimAssist = false;
      const exact = street.shoot(x, y);
      street.settings.aimAssist = true;
      const helped = street.shoot(x, y);
      // Assist never creates a hit on an innocent, nor takes one that was real.
      if (helped.kind === "townsfolk") expect(exact.kind, `shot ${i}`).toBe("townsfolk");
      if (exact.kind === "townsfolk") expect(helped.kind, `shot ${i}`).toBe("townsfolk");
      // Nor a real hit on a man from him.
      if (exact.kind === "bandit") expect(helped.kind, `shot ${i}`).toBe("bandit");
      if (helped.kind !== "bandit" || exact.kind === "bandit") {
        if (exact.kind === "scenery" || exact.kind === "none") vetoed++;
        continue;
      }
      // A near miss was snapped to a man. No innocent was nearer than him and within a torso's allowance of the shot.
      snapped++;
      const { origin, direction } = street.ray(x, y).ray;
      for (const j of folk) {
        probePoint(origin, direction, j.head, probe);
        if (probe.t > 0 && probe.t <= helped.distance) {
          expect(probe.miss, `shot ${i}: head`).toBeGreaterThan(effectiveRadius(0.14, probe.t, aTorso));
        }
        probeSegment(origin, direction, j.hips, j.neck, probe);
        if (probe.t > 0 && probe.t <= helped.distance) {
          expect(probe.miss, `shot ${i}: body`).toBeGreaterThan(effectiveRadius(0.22, probe.t, aTorso));
        }
      }
    }
    expect(snapped).toBeGreaterThan(100);
    expect(vetoed).toBeGreaterThan(100);
  });
});

describe("Aim Assist never triggers a secret the player was not aiming at", () => {
  it("leaves a secret's own allowance as the game has it with assist on, and exact with it off", () => {
    const street = new Street();
    const bell = new Vector3(0, 9, -80);
    street.bell = bell;
    // At 80 m the allowance (1.2% = 80 cm) is wider than the bell's real 55 cm; boosting it would be wider still.
    expect(metres(ASSIST.secret, 80)).toBeGreaterThan(0.55);
    expect(metres(ASSIST.secret * ASSIST_BOOST, 80)).toBeGreaterThan(0.9);
    // A shot through the bell is a hit.
    expect(street.shootAt(bell).kind).toBe("secret");
    // 70 cm off: inside the game's own allowance, so it still counts.
    expect(street.shootAt(bell, side(0.7, 80), 0).kind).toBe("secret");
    // 90 cm off: the boost would have reached it, and must not.
    expect(street.shootAt(bell, side(0.9, 80), 0).kind).not.toBe("secret");
    // Exact when assist is off: only the bell itself.
    street.settings.aimAssist = false;
    expect(street.shootAt(bell, side(0.5, 80), 0).kind).toBe("secret");
    expect(street.shootAt(bell, side(0.7, 80), 0).kind).not.toBe("secret");
  });

  it("never takes a real shot at a secret away, and a near miss of a bandit never becomes one", () => {
    const street = new Street();
    street.bell = new Vector3(0, 1.4, -45);
    street.man(bandit(1), 0.45, -25);
    // On the bell, with a man's near miss on the same line: the bell is what was aimed at.
    expect(street.shootAt(street.bell).kind).toBe("secret");
    // A shot at the man's body goes to the man, not to the bell behind him.
    expect(street.shootAt(CHEST(-25, 0.45)).kind).toBe("bandit");
    // A near miss of the man, nowhere near the bell, is the man's.
    expect(street.shootAt(CHEST(-25, 0.45), 0.03, 0).kind).toBe("bandit");
  });
});
