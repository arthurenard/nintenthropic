/**
 * What each quality tier costs and buys. The tier comes from the engine's GPU
 * guess (tier.ts) unless the page asks for one; dynamic resolution then
 * corrects the pixel count from frame to frame, so these are about geometry
 * and effects, which cannot be traded frame by frame.
 *
 *  - high: a MacBook with an M-series chip, four views at 60 fps. 4x MSAA on
 *    an HDR target, kart shadows in a 2048 map, the world's sun shadow baked
 *    at 3072 and its occlusion at 2048, grass tufts and flowers.
 *  - medium: 2x MSAA, 1024 kart shadows, a 2048/1024 bake, fewer tufts.
 *  - low: SMAA instead of MSAA, one 512 kart shadow map shared by the views,
 *    a coarse bake, no tufts, no occlusion map, smaller targets.
 */
import type { Quality } from "../../engine/types";

export type Tier = Quality["tier"];

/** The tiers, lowest first. */
export const TIERS: readonly Tier[] = ["low", "medium", "high"];

/** The tier below this one, or null for the lowest. */
export function lowerTier(tier: Tier): Tier | null {
  return TIERS[TIERS.indexOf(tier) - 1] ?? null;
}

/** `tier`, but no higher than `ceiling` (none: as it is). */
export function capTier(tier: Tier, ceiling: Tier | null | undefined): Tier {
  return ceiling && TIERS.indexOf(ceiling) < TIERS.indexOf(tier) ? ceiling : tier;
}

export interface QualitySettings {
  tier: Tier;
  /** Ground grid cell, metres: smaller is a finer landscape. */
  cell: number;
  /** Share of the scenery to place (1 = all). */
  scenery: number;
  /** Tyre walls as rings (true) or plain drums. */
  detailedTyres: boolean;
  /** Particles alive at once, over all effects. */
  particles: number;
  /** The most the device pixel ratio may count for. */
  pixelRatioCap: number;
  anisotropy: number;
  /** Pixels on a side of the road texture. */
  roadTexture: number;
  /** Backdrop blur on the HUD's glass; blurring a canvas that changes every frame is not free. */
  glassBlur: boolean;
  /** The kart shadow map, pixels on a side (0 for none) and the half width of the box it covers round a view's kart, metres. */
  shadowMap: number;
  shadowRange: number;
  /** Pixels on a side of the baked sun shadow of the static world (0 for none) and of its occlusion map. */
  bakeSun: number;
  bakeAo: number;
  /** Grass tufts and flowers along the verge (0 for none). */
  tufts: number;
  /** Beyond this many metres from a camera a kart is drawn as one welded mesh instead of its dozen parts (kartSpec.ts's FAR_DISTANCE is the full detail's). */
  kartDetail: number;
  /** The ground's tiles, in cells on a side: bigger ones are fewer draw calls and more triangles outside the view. */
  groundTile: number;
}

export const QUALITY: Record<Tier, QualitySettings> = {
  high: {
    tier: "high",
    cell: 4,
    scenery: 1,
    detailedTyres: true,
    particles: 1400,
    pixelRatioCap: 2,
    anisotropy: 8,
    roadTexture: 1024,
    glassBlur: true,
    shadowMap: 2048,
    shadowRange: 30,
    bakeSun: 3072,
    bakeAo: 2048,
    tufts: 26000,
    kartDetail: 34,
    groundTile: 40,
  },
  medium: {
    tier: "medium",
    cell: 5,
    scenery: 0.7,
    detailedTyres: true,
    particles: 900,
    pixelRatioCap: 1.75,
    anisotropy: 4,
    roadTexture: 1024,
    glassBlur: true,
    shadowMap: 1024,
    shadowRange: 26,
    bakeSun: 2048,
    bakeAo: 1024,
    tufts: 9000,
    kartDetail: 26,
    groundTile: 60,
  },
  low: {
    tier: "low",
    cell: 7,
    scenery: 0.4,
    detailedTyres: false,
    particles: 450,
    pixelRatioCap: 1.25,
    anisotropy: 2,
    roadTexture: 512,
    glassBlur: false,
    shadowMap: 512,
    shadowRange: 22,
    bakeSun: 1536,
    bakeAo: 0,
    tufts: 0,
    kartDetail: 18,
    groundTile: 80,
  },
};
