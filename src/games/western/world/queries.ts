import type { Mesh, Object3D, Vector3 } from "three";
import { SceneryQueries } from "../../../engine/world/queries";
import type { TownLayout } from "./town";

export type { RayHit } from "../../../engine/world/queries";

/**
 * Ray queries against the town (engine/world/queries.ts): where a bullet
 * lands, how high the ground is under a falling body, whether the sun
 * reaches a character. The static town is filed in the engine's grid; the
 * few moving secrets (the bell, the vane, the church doors) keep their live
 * meshes and are tested as they are.
 */
export class TownQueries extends SceneryQueries {
  constructor(town: TownLayout) {
    town.root.updateMatrixWorld(true);
    const still: Mesh[] = [];
    const moving: Mesh[] = [];
    for (const m of town.solids) {
      if (isUnderSecret(m)) moving.push(m);
      else still.push(m);
    }
    super(still, moving);
  }

  /** Does sunlight reach `from`? `toSun` points at the sun. */
  sunReaches(from: Vector3, toSun: Vector3): boolean {
    return this.lightReaches(from, toSun, 80);
  }
}

function isUnderSecret(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) {
    const name = n.userData["name"];
    if (typeof name === "string" && name.startsWith("secret.")) return true;
  }
  return false;
}
