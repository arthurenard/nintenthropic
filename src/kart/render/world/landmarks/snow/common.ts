/**
 * The snow world's palette. Snow is tinted warm in the albedo because the sky
 * light is a strong blue: lit, it lands as a cool white. Lit windows glow warm,
 * and ice glows blue from within.
 */
import { byHeight, rgb, type Rgb, type Shade } from "../kit";

export const SNOW: Rgb = [1.7, 1.5, 0.95];
export const SNOW_LOW: Rgb = [0.82, 0.74, 0.72];
export const SNOW_MID: Rgb = [1.25, 1.08, 0.78];
export const SEAM: Rgb = [0.34, 0.32, 0.45];
export const WARM: Rgb = [3.0, 1.95, 0.8];
export const WARM_HALO: Rgb = [2.6, 1.6, 0.6];
export const ICE_GLOW: Rgb = [0.45, 1.1, 1.9];
export const WOOD = rgb("#a66e3c");
export const WOOD_DARK = rgb("#5b3a22");

export const snowShade = (y0: number, y1: number): Shade => byHeight(y0, y1, SNOW_MID, SNOW);
