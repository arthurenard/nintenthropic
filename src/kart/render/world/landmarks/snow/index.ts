/**
 * The snow world's landmarks and hazards, by the names the tracks use
 * (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * Glacier Pass at blue hour: cool whites and blues, with warm lit windows and
 * ice that glows. The models live by kind: what people have made, the ski
 * slope's structures, what the cold makes by itself, and the hazards.
 * `common.ts` holds the palette; the rock and ice shapes come from
 * ../rockKit.ts, which the volcano and canyon worlds share.
 */
import type { HazardSpec, LandmarkSpec } from "../types";
import { cabin, igloo, snowman } from "./buildings";
import { penguin, snowball, yeti } from "./hazards";
import { iceArch, iceCave, pineSnow } from "./nature";
import { gondola, skiJump } from "./slopes";
import { frozenFalls } from "./falls";

export const LANDMARKS: Record<string, LandmarkSpec> = {
  igloo,
  cabin,
  snowman,
  "ice-arch": iceArch,
  "ice-cave": iceCave,
  "pine-snow": pineSnow,
  gondola,
  "ski-jump": skiJump,
  "frozen-falls": frozenFalls,
};

export const HAZARDS: Record<string, HazardSpec> = { penguin, snowball, yeti };
