/**
 * A first guess at what the GPU can do, from its name, so a game starts at a
 * sensible resolution and effect level instead of discovering it through a
 * second of stutter. Dynamic resolution corrects the guess from then on.
 */
import type { Quality } from "./types";

export function guessTier(gpu: string, cores = 8): Quality["tier"] {
  const name = gpu.toLowerCase().replace(/\((r|tm)\)/g, "");
  if (/swiftshader|llvmpipe|software|basic render/.test(name)) return "low";
  if (/mali|adreno|powervr|videocore/.test(name)) return "low";
  let tier: Quality["tier"] = "medium";
  if (/apple m\d|geforce|rtx|gtx|quadro|radeon (rx|pro)|nvidia/.test(name)) tier = "high";
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
