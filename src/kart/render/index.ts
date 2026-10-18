/**
 * Grip Prix's picture (docs/GRIP_PRIX.md, "Render"): `createRaceRenderer`
 * draws a RaceView into one canvas, a viewport and HUD per player.
 */
export { createRaceRenderer } from "./renderer";
export type { GripRenderer, RaceRendererOptions, RenderStats } from "./renderer";
export { createPodium } from "./podium";
export type { PodiumEntry, PodiumOptions, PodiumRenderer } from "./podium";
export type { KartFactory, KartModel, KartPose } from "./kart";
