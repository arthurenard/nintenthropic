/**
 * Loads MediaPipe's hand landmarker: its WebAssembly runtime from mediapipe/
 * and the hand model from models/, both served by the site itself (nothing
 * is fetched from anyone else's server). Both downloads report real progress
 * for the loading bar, and the browser caches them after the first time.
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { fetchBytes, siteUrl } from "../engine/fetch";

/** Rough sizes, so the loading bar can weigh the parts before they report. */
export const WASM_BYTES = 11.8e6;
export const MODEL_BYTES = 7.8e6;

export class ModelError extends Error {
  constructor(cause?: unknown) {
    super("the hand model did not load");
    this.name = "ModelError";
    this.cause = cause;
  }
}

export interface LoadedLandmarker {
  landmarker: HandLandmarker;
  /** Where inference runs: the GPU where the browser allows, else the CPU. */
  delegate: "GPU" | "CPU";
}

export interface LandmarkerProgress {
  wasm: (fraction: number) => void;
  model: (fraction: number) => void;
}

/** One hand, deliberately: the game aims with a single hand, and a second
 * costs time and can hand the crosshair to someone walking past. */
const OPTIONS = {
  runningMode: "VIDEO" as const,
  numHands: 1,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export async function loadHandLandmarker(
  progress: LandmarkerProgress,
  prefer: "GPU" | "CPU" = "GPU",
): Promise<LoadedLandmarker> {
  let binaryUrl: string | null = null;
  try {
    const simd = await FilesetResolver.isSimdSupported();
    const name = simd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
    const [wasm, model] = await Promise.all([
      fetchBytes(siteUrl(`mediapipe/${name}.wasm`), progress.wasm, WASM_BYTES),
      fetchBytes(siteUrl("models/hand_landmarker.task"), progress.model, MODEL_BYTES),
    ]);
    // The runtime is handed the bytes already downloaded (with progress)
    // rather than fetching them again itself.
    binaryUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    const fileset = { wasmLoaderPath: siteUrl(`mediapipe/${name}.js`), wasmBinaryPath: binaryUrl };
    const create = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(fileset, {
        ...OPTIONS,
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
      });
    if (prefer === "CPU") return { landmarker: await create("CPU"), delegate: "CPU" };
    try {
      return { landmarker: await create("GPU"), delegate: "GPU" };
    } catch (gpuError) {
      console.warn("Hand tracking on the GPU is unavailable; using the CPU.", gpuError);
      return { landmarker: await create("CPU"), delegate: "CPU" };
    }
  } catch (error) {
    throw new ModelError(error);
  } finally {
    if (binaryUrl) URL.revokeObjectURL(binaryUrl);
  }
}
