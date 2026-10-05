/**
 * What each quality tier costs and buys. The tier comes from the engine's GPU
 * guess (tier.ts) unless the page asks for one; dynamic resolution then
 * corrects the pixel count from frame to frame, so these are about geometry
 * and effects, which cannot be traded frame by frame.
 */
import type { Quality } from "../../engine/types";

export type Tier = Quality["tier"];

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
}

export const QUALITY: Record<Tier, QualitySettings> = {
  high: { tier: "high", cell: 4, scenery: 1, detailedTyres: true, particles: 1400, pixelRatioCap: 2, anisotropy: 8, roadTexture: 1024, glassBlur: true },
  medium: { tier: "medium", cell: 5, scenery: 0.7, detailedTyres: true, particles: 900, pixelRatioCap: 1.75, anisotropy: 4, roadTexture: 1024, glassBlur: true },
  low: { tier: "low", cell: 7, scenery: 0.4, detailedTyres: false, particles: 450, pixelRatioCap: 1.25, anisotropy: 2, roadTexture: 512, glassBlur: false },
};
