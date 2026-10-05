/**
 * Loads MediaPipe's hand landmarker: its WebAssembly runtime from mediapipe/
 * and the hand model from models/, both served by the site itself (nothing
 * is fetched from anyone else's server). Both downloads report real progress
 * for the loading bar, and the browser caches them after the first time.
 */
import { FilesetResolver, HandLandmarker, type FaceLandmarker } from "@mediapipe/tasks-vision";
import { fetchBytes, siteUrl } from "../engine/fetch";
import { ModelError } from "./errors";
import { createFaceLandmarker } from "./face";
import { FACE_MODEL_BYTES, MODEL_BYTES, WASM_BYTES } from "./sizes";

export { ModelError };

export interface LoadedLandmarker {
  landmarker: HandLandmarker;
  /** Where inference runs: the GPU where the browser allows, else the CPU. */
  delegate: "GPU" | "CPU";
}

export interface LandmarkerProgress {
  wasm: (fraction: number) => void;
  model: (fraction: number) => void;
  /** The face model's download, when it comes too. */
  face?: (fraction: number) => void;
}

const OPTIONS = {
  runningMode: "VIDEO" as const,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

/**
 * The face landmarker on the page (where a worker cannot run it), for a game
 * that reads the eye: its model from models/, with progress.
 */
export async function loadFaceOnPage(progress: (fraction: number) => void, prefer: "GPU" | "CPU" = "GPU"): Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> {
  try {
    const simd = await FilesetResolver.isSimdSupported();
    const name = simd ? "vision_wasm_internal" : "vision_wasm_nosimd_internal";
    const model = await fetchBytes(siteUrl("models/face_landmarker.task"), progress, FACE_MODEL_BYTES);
    const fileset = { wasmLoaderPath: siteUrl(`mediapipe/${name}.js`), wasmBinaryPath: siteUrl(`mediapipe/${name}.wasm`) };
    return await createFaceLandmarker(fileset, model, prefer);
  } catch (error) {
    throw new ModelError(error);
  }
}

export async function loadHandLandmarker(
  progress: LandmarkerProgress,
  prefer: "GPU" | "CPU" = "GPU",
  /**
   * How many hands to look for. One for the shooting games, deliberately:
   * they aim with a single hand, and a second costs time (measured in
   * input/trust.ts, which keeps a passer-by's hand from taking the aim).
   * Grip Prix steers with two (four for two wheels on one camera).
   */
  hands = 1,
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
        numHands: hands,
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
