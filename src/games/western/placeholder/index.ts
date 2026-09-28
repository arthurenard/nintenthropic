/**
 * High Noon's procedural stand-ins for its art: a whole Dust Creek, its
 * people and its sky, built in code to the same node names, extras, bones
 * and clips as the real files. They are for development and tests only -
 * working on the game before an export exists, or with one half-done - and
 * reach the game solely through world/assets.ts's dynamic import of this
 * module, which a production build removes: there, a file that does not
 * load fails the load instead.
 */
import type { LoadedAsset } from "../../../engine/types";
import { buildBanditAsset, buildBossAsset, buildChickenAsset, buildTownsfolkAsset } from "./characters";
import { buildPlaceholderTown } from "./town";

export { buildSky } from "./sky";

/** A stand-in for one of the models. */
export function standIn(name: "town" | "bandit" | "boss" | "townsfolk" | "chicken", noon: boolean): LoadedAsset {
  switch (name) {
    case "town":
      return { scene: buildPlaceholderTown({ noon }), animations: [] };
    case "bandit":
      return buildBanditAsset();
    case "boss":
      return buildBossAsset();
    case "townsfolk":
      return buildTownsfolkAsset();
    case "chicken":
      return buildChickenAsset();
  }
}
