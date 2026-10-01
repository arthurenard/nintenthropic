// Aim Assist in Dead of Night's shots: the real Shooter, on a road made of
// fakes (a camera, the dead and a survivor standing at known places).
import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { ASSIST_BOOST } from "../../../engine/rules/assist";
import { Joints } from "../../../engine/world/character";
import { Dead } from "../rules/dead";
import type { Survivor } from "../rules/survivors";
import type { DeadKind, Lane } from "../rules/types";
import type { Cast } from "./cast";
import type { RoadQueries } from "./queries";
import type { RoadLayout } from "./road";
import { ASSIST, Shooter, type ShootableWorld } from "./shooting";

const FOV = 45;
const ASPECT = 16 / 9;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const metres = (fraction: number, distance: number) => fraction * 2 * TAN_HALF * distance;
const side = (m: number, distance: number) => m / metres(1, distance);

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

const lane: Lane = { id: "road", points: [{ x: 0, y: 0, z: -60 }, { x: 0, y: 0, z: -4 }], spread: 1, cover: 0 };

function dead(id: number, kind: DeadKind = "walker"): Dead {
  const d = new Dead(id, kind, lane, lane.points.map((p) => ({ ...p })), 1, "walk.shamble");
  d.state = "approaching";
  return d;
}

class Road {
  readonly settings = { aimAssist: true };
  readonly camera = new PerspectiveCamera(FOV, ASPECT, 0.1, 400);
  readonly dead: { d: Dead; rig: { updateJoints: () => Joints } }[] = [];
  readonly survivors: { s: Survivor; joints: () => Joints }[] = [];
  private readonly shooter: Shooter;

  constructor() {
    this.camera.position.set(0, 1.7, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    const world: ShootableWorld = { survivors: () => this.survivors, cat: () => null, driveInVisible: () => false, scarecrowHere: () => false };
    const road = {
      root: new Group(),
      secrets: { sign: new Map(), moonDisc: null, scarecrow: null, boothLight: null, driveInLamp: null, radio: null, duck: null },
    } as unknown as RoadLayout;
    this.shooter = new Shooter(this.camera, { cast: () => null } as unknown as RoadQueries, road, { dead: this.dead } as unknown as Cast, world, this.settings);
  }

  walker(x: number, z: number, kind: DeadKind = "walker"): Joints {
    const joints = standing(x, z);
    this.dead.push({ d: dead(this.dead.length + 1, kind), rig: { updateJoints: () => joints } });
    return joints;
  }

  survivor(x: number, z: number): void {
    const joints = standing(x, z);
    this.survivors.push({ s: { shootable: true } as Survivor, joints: () => joints });
  }

  shootAt(point: Vector3, dx = 0, dy = 0): { kind: string; part: string | null } {
    const p = point.clone().project(this.camera);
    const r = this.shooter.shoot((p.x + 1) / 2 + dx / ASPECT, (1 - p.y) / 2 + dy);
    return { kind: r.target.kind, part: r.part };
  }
}

const CHEST = (z: number, x = 0) => new Vector3(x, 1.2, z);
const HEAD = (z: number, x = 0) => new Vector3(x, 1.62, z);

describe("Aim Assist in Dead of Night", () => {
  it("forgives the dead's torsos a little more than the game always did, and their heads in proportion", () => {
    const road = new Road();
    road.walker(0, -30);
    // 2.8% is 70 cm at 30 m: past the 2.4% the game always gave a torso, inside what assist gives it.
    expect(ASSIST.torso).toBeLessThan(0.028);
    expect(0.028).toBeLessThan(ASSIST.torso * ASSIST_BOOST);
    expect(road.shootAt(CHEST(-30), 0.028, 0)).toMatchObject({ kind: "dead", part: "body" });
    expect(road.shootAt(CHEST(-30), 0.036, 0).kind).not.toBe("dead");
    // The head: 1.1% (27 cm) is inside the zone assist gives it, 1.5% is not, and neither is ever a body shot.
    expect(road.shootAt(HEAD(-30), 0.011, 0)).toMatchObject({ kind: "dead", part: "head" });
    expect(road.shootAt(HEAD(-30), 0.015, 0).kind).not.toBe("dead");
  });

  it("is exact when it is off", () => {
    const road = new Road();
    road.settings.aimAssist = false;
    road.walker(0, -30);
    expect(road.shootAt(CHEST(-30), side(0.18, 30), 0).kind).toBe("dead");
    expect(road.shootAt(CHEST(-30), side(0.45, 30), 0).kind).not.toBe("dead");
    expect(road.shootAt(CHEST(-30), 0.028, 0).kind).not.toBe("dead");
    expect(road.shootAt(HEAD(-30), side(0.1, 30), 0)).toMatchObject({ kind: "dead", part: "head" });
    expect(road.shootAt(HEAD(-30), 0.011, 0).kind).not.toBe("dead");
  });

  it("is read on every shot", () => {
    const road = new Road();
    road.walker(0, -30);
    expect(road.shootAt(CHEST(-30), 0.028, 0).kind).toBe("dead");
    road.settings.aimAssist = false;
    expect(road.shootAt(CHEST(-30), 0.028, 0).kind).not.toBe("dead");
  });

  it("helps a crawler find the road's low, small dead a little more", () => {
    const road = new Road();
    road.walker(0, -30, "crawler");
    // 3.8% is past the crawler's 3.0% table, inside the 4.1% assist gives it; 4.5% is not.
    expect(road.shootAt(CHEST(-30), 0.038, 0).kind).toBe("dead");
    expect(road.shootAt(CHEST(-30), 0.045, 0).kind).not.toBe("dead");
    road.settings.aimAssist = false;
    expect(road.shootAt(CHEST(-30), 0.038, 0).kind).not.toBe("dead");
  });

  it("never helps a shot onto a survivor, or past one it passes close beside", () => {
    const road = new Road();
    road.survivor(0, -20);
    // Through a survivor is a real hit, on or off; beside them is no hit at all.
    expect(road.shootAt(CHEST(-20)).kind).toBe("survivor");
    road.settings.aimAssist = false;
    expect(road.shootAt(CHEST(-20)).kind).toBe("survivor");
    road.settings.aimAssist = true;
    for (const dx of [side(0.5, 20), -side(0.5, 20)]) expect(road.shootAt(CHEST(-20), dx, 0).kind).not.toBe("survivor");
    // One of the dead 90 cm to the side at 30 m, near-missed through (35 cm, 20 m): helped alone, not behind a survivor.
    const through = new Vector3(0.35, 1.2, -20);
    const alone = new Road();
    alone.walker(0.9, -30);
    expect(alone.shootAt(through).kind).toBe("dead");
    const behind = new Road();
    behind.survivor(0, -20);
    behind.walker(0.9, -30);
    expect(["scenery", "none"]).toContain(behind.shootAt(through).kind);
    // A clean line to the dead, past the survivor, is a real hit all the same.
    expect(behind.shootAt(CHEST(-30, 0.9)).kind).toBe("dead");
  });
});
