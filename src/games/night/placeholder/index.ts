/**
 * Dead of Night's procedural stand-ins for its art: Route 9, the dead, the
 * Mechanic, the survivors, the cat and the night sky, built in code to the
 * same node names, extras, bones and clips as the real files
 * (docs/DEAD_OF_NIGHT.md, "Asset contract"). They are for development and
 * tests only - working on the game before an export exists, or with one
 * half-done - and reach the game solely through world/assets.ts's dynamic
 * import of this module, which a production build removes: there, a file
 * that does not load fails the load instead.
 */
import { Vector3 } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { buildCatAsset, buildMechanicAsset, buildSurvivorAsset, buildWalkerAsset } from "./characters";
import { buildPlaceholderRoad } from "./road";
import { buildSky as paintSky, type SkyResult } from "./sky";

export type ModelName = "road" | "walker" | "mechanic" | "survivor" | "cat";

/** A stand-in for one of the models. */
export function standIn(name: ModelName): LoadedAsset {
  switch (name) {
    case "road":
      return { scene: buildPlaceholderRoad(), animations: [] };
    case "walker":
      return buildWalkerAsset();
    case "mechanic":
      return buildMechanicAsset();
    case "survivor":
      return buildSurvivorAsset();
    case "cat":
      return buildCatAsset();
  }
}

/** The night sky, the moon where `toMoon` points. */
export function buildSky(toMoon: Vector3): SkyResult {
  return paintSky(toMoon);
}

export type { SkyResult };
