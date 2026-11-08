/**
 * The kitchen's landmarks and hazards, by the names the tracks use: toy karts
 * on a giant counter, so a teapot is thirty metres tall (docs/GRIP_PRIX.md,
 * "What each theme can build").
 *
 * Everything here is china, steel, wood and fruit seen in late golden light:
 * cream and cobalt for the crockery, brushed steel with a bright top for the
 * cutlery and the appliances, warm saturated fruit. Each model is darker at
 * its foot and brighter at its top so it sits on the counter. The models live
 * by kind (crockery, fruit, the shelf, appliances, spans over the road, the
 * tiled wall, hazards); `common.ts` holds the palette and the shapes more
 * than one of them uses.
 */
import type { HazardSpec, LandmarkSpec } from "../types";
import { sink, toaster } from "./appliances";
import { mug, teapot } from "./crockery";
import { fruitBowl } from "./fruit";
import { orange, pea, teacup, toast } from "./hazards";
import { cerealBox, cookbook, pepperMill, saltShaker } from "./shelf";
import { drawer } from "./drawer";
import { LANDMARKS as second } from "./set";
import { forkArch, grater, spoonArch } from "./spans";
import { wallClock, windowWall } from "./wall";

export const LANDMARKS: Record<string, LandmarkSpec> = {
  teapot,
  "fruit-bowl": fruitBowl,
  toaster,
  grater,
  drawer,
  "salt-shaker": saltShaker,
  "pepper-mill": pepperMill,
  cookbook,
  "cereal-box": cerealBox,
  mug,
  "fork-arch": forkArch,
  "spoon-arch": spoonArch,
  sink,
  window: windowWall,
  "wall-clock": wallClock,
  ...second,
};

export const HAZARDS: Record<string, HazardSpec> = { orange, pea, teacup, toast };
