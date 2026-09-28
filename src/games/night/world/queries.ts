import type { Mesh, Object3D, Vector3 } from "three";
import { SceneryQueries } from "../../../engine/world/queries";
import { contractName } from "../../../engine/world/names";
import type { RoadLayout } from "./road";

export type { RayHit } from "../../../engine/world/queries";

/**
 * Ray queries against Route 9 (engine/world/queries.ts): where a bullet
 * lands, where the flashlight falls, how high the ground is under a falling
 * body, whether the moon reaches one of the dead. The static road is filed
 * in the engine's grid; the secrets that move (the scarecrow's head, the
 * duck) keep their live meshes and are tested as they are. The corn and the
 * glass are not solid: a bullet goes through.
 */
export class RoadQueries extends SceneryQueries {
  constructor(road: RoadLayout) {
    road.root.updateMatrixWorld(true);
    const still: Mesh[] = [];
    const moving: Mesh[] = [];
    for (const m of road.solids) {
      if (isUnderSecret(m)) moving.push(m);
      else still.push(m);
    }
    super(still, moving);
  }

  /** Does moonlight reach `from`? `toMoon` points at the moon. */
  moonReaches(from: Vector3, toMoon: Vector3): boolean {
    return this.lightReaches(from, toMoon, 60);
  }
}

function isUnderSecret(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) {
    const name = contractName(n);
    if (name.startsWith("secret.") || name === "moon.disc") return true;
  }
  return false;
}
