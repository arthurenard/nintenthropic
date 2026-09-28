/**
 * Orbital Decay's stand-ins for its art: the cupola, the station, the
 * planet's maps and the star field, the debris, the drone, the Derelict
 * and the extras, built in code to the same node names and extras as the
 * real files. For development and tests only - working on the game before
 * the art exists, or with an export half-done - they reach the game solely
 * through world/assets.ts's dynamic import of this module, which a
 * production build removes: there, a file that does not load fails the load.
 */
import type { Texture, WebGLRenderer } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { buildPlaceholderDerelict, buildPlaceholderDrone, buildPlaceholderExtras } from "./craft";
import { buildPlaceholderCupola } from "./cupola";
import { buildPlaceholderDebris } from "./debris";
import { buildPlanetMap, type PlanetMap } from "./planetMaps";
import { buildPlaceholderStation } from "./station";

export type ModelName = "cupola" | "station" | "debris" | "drone" | "derelict" | "extras";

/** A stand-in for one of the models. */
export function standIn(name: ModelName): LoadedAsset {
  switch (name) {
    case "cupola":
      return { scene: buildPlaceholderCupola(), animations: [] };
    case "station":
      return { scene: buildPlaceholderStation(), animations: [] };
    case "debris":
      return { scene: buildPlaceholderDebris(), animations: [] };
    case "drone":
      return { scene: buildPlaceholderDrone(), animations: [] };
    case "derelict":
      return { scene: buildPlaceholderDerelict(), animations: [] };
    case "extras":
      return { scene: buildPlaceholderExtras(), animations: [] };
  }
}

/** A stand-in for one of the planet's maps or the stars, made on the GPU. */
export function standInMap(renderer: WebGLRenderer, name: PlanetMap): Texture {
  return buildPlanetMap(renderer, name);
}
