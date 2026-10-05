/**
 * How each world is photographed: the tone curve, exposure, bloom, colour
 * grade and the strength of its light, as plain data next to the themes
 * (themes.ts says what the world is made of; this says how the camera sees
 * it). The post chain (../post.ts) and the lighting (index.ts) read these.
 *
 * Every day world gets a warm sun and a cool sky fill (the split that makes
 * a render read as sunlight, not as a lamp), a little extra vibrance, and a
 * bloom that only catches what is brighter than white: boosts, sparks,
 * lamps, the sun's glint. The night worlds keep their dark mood by pulling
 * the exposure down and letting the lamps and emissives carry the picture.
 */
import type { TrackTheme } from "../../track/geometry";

export type ToneCurve = "aces" | "agx" | "neutral";

export interface Look {
  tone: ToneCurve;
  /** Multiplies the HDR picture before the tone curve. */
  exposure: number;
  /** Bloom: only HDR values above `threshold` glow. */
  bloom: { threshold: number; intensity: number; radius: number };
  /** 0 = unchanged; boosts the least saturated colours most. */
  vibrance: number;
  /** 1 = unchanged. */
  saturation: number;
  /** 0 = unchanged; an S curve about mid grey. */
  contrast: number;
  /** Multiplied in the shadows and in the highlights (a split tone). */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Corner darkening, per view tile. */
  vignette: number;
  /** The environment map's strength on glossy things (karts, water, wet rock). */
  envIntensity: number;
  /** The sky/ground fill's share of the theme's hemisphere light. */
  fill: number;
  /** The sun's share of the theme's sun intensity. */
  sun: number;
  /** How dark a sun shadow is, 0..1 (1 = no sun at all in shadow; the sky still fills it). */
  shadow: number;
}

const day: Look = {
  tone: "aces",
  exposure: 1.0,
  bloom: { threshold: 1.0, intensity: 0.5, radius: 0.72 },
  vibrance: 0.35,
  saturation: 1.0,
  contrast: 0.12,
  shadowTint: [0.96, 0.98, 1.06],
  highlightTint: [1.05, 1.0, 0.94],
  vignette: 0.2,
  envIntensity: 0.62,
  fill: 0.35,
  sun: 1.75,
  shadow: 0.92,
};

const night: Look = {
  ...day,
  tone: "aces",
  exposure: 1.1,
  bloom: { threshold: 0.9, intensity: 0.8, radius: 0.8 },
  vibrance: 0.2,
  saturation: 1.02,
  contrast: 0.12,
  shadowTint: [0.95, 0.98, 1.06],
  highlightTint: [1.05, 1.0, 0.95],
  vignette: 0.28,
  envIntensity: 0.7,
  fill: 0.6,
  sun: 0.8,
  shadow: 0.8,
};

export const LOOKS: Record<TrackTheme, Look> = {
  // Morning: a bright, saturated world; a warm sun, a blue sky in the shadows.
  meadow: { ...day, exposure: 1.0, sun: 1.55, fill: 0.55, envIntensity: 0.75, vibrance: 0.35, saturation: 1.04 },
  // The last warm hour: long orange light, deep warm shadows, not a world dyed orange.
  canyon: { ...day, exposure: 0.92, sun: 1.2, fill: 0.5, envIntensity: 0.65, saturation: 0.9, vibrance: 0.18, highlightTint: [1.05, 1.0, 0.92], shadowTint: [0.95, 0.96, 1.06] },
  harbour: { ...night, exposure: 1.2, sun: 0.55, fill: 0.5, envIntensity: 0.6, saturation: 0.98, vibrance: 0.12, bloom: { threshold: 0.95, intensity: 0.75, radius: 0.8 } },
  kitchen: { ...day, exposure: 0.74, sun: 1.35, fill: 0.5, envIntensity: 0.7, saturation: 1.0, highlightTint: [1.06, 1.0, 0.92] },
  snow: { ...night, exposure: 1.25, sun: 1.0, fill: 0.7, envIntensity: 0.8, vibrance: 0.25, shadow: 0.75 },
  volcano: { ...night, exposure: 1.55, sun: 1.1, fill: 0.95, envIntensity: 0.9, bloom: { threshold: 0.85, intensity: 0.85, radius: 0.85 } },
  funfair: { ...night, exposure: 1.25, sun: 0.8, fill: 0.7, envIntensity: 0.75, bloom: { threshold: 0.85, intensity: 0.95, radius: 0.85 } },
  space: { ...night, exposure: 1.05, sun: 1.2, fill: 0.8, envIntensity: 0.9, bloom: { threshold: 0.9, intensity: 0.8, radius: 0.9 } },
  palm: { ...day, exposure: 0.88, sun: 1.3, fill: 0.5, envIntensity: 0.7, vibrance: 0.3, saturation: 1.04 },
};

export function lookFor(theme: TrackTheme): Look {
  return LOOKS[theme] ?? LOOKS.meadow;
}

// ─── The far horizon: ridges and skylines painted in the sky ─────────────────

export type RidgeKind = "hills" | "peaks" | "mesas" | "skyline" | "cones";

export interface Ridge {
  kind: RidgeKind;
  /** The tallest it gets, as the sine of its elevation (0.1 is about six degrees). */
  height: number;
  /** Features per radian round the horizon. */
  frequency: number;
  seed: number;
  colour: string;
  /** How much of the horizon haze it is mixed with, 0..1: the farther the layer, the more. */
  haze: number;
}

const NO_RIDGES: Ridge[] = [];

const SKYLINES: Record<TrackTheme, Ridge[]> = {
  meadow: [
    { kind: "hills", height: 0.17, frequency: 1.3, seed: 3, colour: "#7fa4cc", haze: 0.62 },
    { kind: "hills", height: 0.1, frequency: 2.1, seed: 11, colour: "#6a9bbd", haze: 0.45 },
    { kind: "hills", height: 0.055, frequency: 3.4, seed: 23, colour: "#5d9a86", haze: 0.3 },
  ],
  canyon: [
    { kind: "mesas", height: 0.2, frequency: 1.1, seed: 5, colour: "#d99a78", haze: 0.55 },
    { kind: "mesas", height: 0.13, frequency: 1.8, seed: 17, colour: "#c4805d", haze: 0.4 },
    { kind: "mesas", height: 0.07, frequency: 2.9, seed: 29, colour: "#a96a4c", haze: 0.28 },
  ],
  harbour: [
    { kind: "hills", height: 0.12, frequency: 1.5, seed: 4, colour: "#1c2a66", haze: 0.55 },
    { kind: "skyline", height: 0.1, frequency: 1.6, seed: 8, colour: "#131c4a", haze: 0.35 },
    { kind: "skyline", height: 0.055, frequency: 2.6, seed: 31, colour: "#0c1238", haze: 0.2 },
  ],
  kitchen: NO_RIDGES,
  snow: [
    { kind: "peaks", height: 0.26, frequency: 1.0, seed: 7, colour: "#8fa6d6", haze: 0.5 },
    { kind: "peaks", height: 0.17, frequency: 1.5, seed: 19, colour: "#6d86c2", haze: 0.35 },
    { kind: "peaks", height: 0.09, frequency: 2.4, seed: 41, colour: "#4a62a0", haze: 0.22 },
  ],
  volcano: [
    { kind: "cones", height: 0.2, frequency: 1.0, seed: 2, colour: "#6a2418", haze: 0.5 },
    { kind: "cones", height: 0.12, frequency: 1.7, seed: 13, colour: "#4a1a16", haze: 0.35 },
    { kind: "hills", height: 0.06, frequency: 2.6, seed: 37, colour: "#2a1214", haze: 0.2 },
  ],
  funfair: [
    { kind: "hills", height: 0.1, frequency: 1.4, seed: 9, colour: "#5a2f84", haze: 0.55 },
    { kind: "skyline", height: 0.09, frequency: 1.8, seed: 21, colour: "#2d1a5a", haze: 0.35 },
    { kind: "skyline", height: 0.05, frequency: 3.0, seed: 33, colour: "#1c1040", haze: 0.2 },
  ],
  space: NO_RIDGES,
  palm: [
    { kind: "hills", height: 0.09, frequency: 1.8, seed: 6, colour: "#78b0c8", haze: 0.6 },
    { kind: "hills", height: 0.045, frequency: 3.0, seed: 18, colour: "#5da590", haze: 0.45 },
  ],
};

export function skylineFor(theme: TrackTheme): Ridge[] {
  return SKYLINES[theme] ?? NO_RIDGES;
}
