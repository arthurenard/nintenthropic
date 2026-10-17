/**
 * A first guess at what the GPU can do, from its name, so a game starts at a
 * sensible resolution and effect level instead of discovering it through a
 * second of stutter. Dynamic resolution corrects the guess from then on.
 */
import type { Quality } from "./types";

/** What the game asking is going to draw. */
export interface TierHints {
  /**
   * The game draws up to four views of the world at once (Grip Prix's split
   * screen), which asks four times the vertices and draw calls of one: a
   * base Apple chip, or a browser that only says "Apple GPU" (Safari, an
   * iPad), starts a step lower than for a game with one view.
   */
  splitScreen?: boolean;
}

/** Cores that only a Pro, Max or Ultra Apple chip has (an M4 Pro: 12 to 14; a base M4: 10). */
const BIG_APPLE_CORES = 12;

/**
 * A GPU that is really the CPU drawing (SwiftShader, llvmpipe, Windows' Basic Render Driver): what a browser falls back
 * to when the graphics driver is blocklisted, as on many older laptops.
 */
export function isSoftwareGpu(gpu: string): boolean {
  return /swiftshader|llvmpipe|software|basic render/.test(gpu.toLowerCase());
}

export function guessTier(gpu: string, cores = 8, hints: TierHints = {}): Quality["tier"] {
  const name = gpu.toLowerCase().replace(/\((r|tm)\)/g, "");
  if (isSoftwareGpu(name)) return "low";
  // Phones' GPUs; but Qualcomm's laptop part (Adreno X1) is a laptop GPU.
  if (/mali|adreno(?! x\d)|powervr|videocore/.test(name)) return "low";
  let tier: Quality["tier"] = "medium";
  if (/apple m\d+ (pro|max|ultra)/.test(name)) tier = "high";
  else if (/apple m\d/.test(name)) tier = hints.splitScreen ? "medium" : "high";
  // Safari and iPads give the family, not the chip. Only the core count tells a Pro or Max from the rest.
  else if (/apple/.test(name)) tier = hints.splitScreen && cores >= BIG_APPLE_CORES ? "high" : "medium";
  else if (/geforce (mx|gt )/.test(name)) tier = "medium";
  else if (/geforce|rtx|gtx|quadro|radeon (rx|pro)|nvidia/.test(name)) tier = "high";
  else if (/intel/.test(name)) tier = /iris xe|arc/.test(name) ? "medium" : "low";
  // A GPU is rarely better than the machine around it.
  if (cores <= 4 && tier === "high") tier = "medium";
  return tier;
}

/** Where dynamic resolution starts for each tier. */
export const INITIAL_SCALE: Record<Quality["tier"], number> = { high: 1, medium: 0.85, low: 0.7 };

/** The GPU's name as the browser reports it (unmasked where it allows). */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}
