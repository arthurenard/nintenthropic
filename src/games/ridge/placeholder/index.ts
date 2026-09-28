/**
 * Overwatch Ridge's procedural stand-ins for its art: the whole Valle Serra,
 * its people, animals and vehicles, and its dawn sky, built in code to the
 * asset contract (docs/OVERWATCH_RIDGE.md). For development and tests only:
 * they reach the game solely through world/assets.ts's dynamic import of
 * this module, which a production build removes - there, a file that does
 * not load fails the load instead.
 */
import { Vector3, type Texture } from "three";
import type { LoadedAsset } from "../../../engine/types";
import { buildAnimalsAsset } from "./animals";
import { buildCivilianAsset } from "./civilian";
import { SUN_AZIMUTH, SUN_ELEVATION_START } from "./layout";
import { buildSky } from "./sky";
import { buildSoldierAsset } from "./soldier";
import { buildPlaceholderValley } from "./valley";
import { buildVehiclesAsset } from "./vehicles";

export type ModelName = "valley" | "soldier" | "civilian" | "vehicles" | "animals";

/** A stand-in for one of the models. */
export function standIn(name: ModelName): LoadedAsset {
  switch (name) {
    case "valley":
      return { scene: buildPlaceholderValley(), animations: [] };
    case "soldier":
      return buildSoldierAsset();
    case "civilian":
      return buildCivilianAsset();
    case "vehicles":
      return buildVehiclesAsset();
    case "animals":
      return buildAnimalsAsset();
  }
}

/** The dawn sky, painted for the placeholder valley's sun. */
export function standInSky(): Texture {
  const el = (SUN_ELEVATION_START * Math.PI) / 180;
  return buildSky(new Vector3(Math.sin(SUN_AZIMUTH) * Math.cos(el), Math.sin(el), Math.cos(SUN_AZIMUTH) * Math.cos(el)));
}
