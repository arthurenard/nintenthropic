/**
 * The funfair world's landmarks and hazards, by the names the tracks use
 * (docs/GRIP_PRIX.md, "What each theme can build").
 *
 * A fairground at dusk: every ride is lit, so the weight of each model is in
 * its `glow` builder (bulbs, neon, windows) and its halos, with chunky candy
 * coloured bodies underneath. The models live by kind: the rides, the spans
 * over the road, the stalls, and the hazards. `common.ts` holds the palette
 * and the bulbs, stripes and letters they are all trimmed with.
 */
import type { HazardSpec, LandmarkSpec } from "../types";
import { bumperCar, teacupRide } from "./hazards";
import { carousel, ferrisWheel, helterSkelter } from "./rides";
import { bigTop, entranceArch, rollercoaster } from "./spans";
import { balloonStand, fireworks, foodStall, hookADuck } from "./stalls";

export const LANDMARKS: Record<string, LandmarkSpec> = {
  "ferris-wheel": ferrisWheel,
  carousel,
  "big-top": bigTop,
  rollercoaster,
  "entrance-arch": entranceArch,
  "food-stall": foodStall,
  "balloon-stand": balloonStand,
  "hook-a-duck": hookADuck,
  "helter-skelter": helterSkelter,
  fireworks,
};

export const HAZARDS: Record<string, HazardSpec> = {
  "teacup-ride": teacupRide,
  "bumper-car": bumperCar,
};
