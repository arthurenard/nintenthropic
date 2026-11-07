/**
 * The face landmarker, as Nintenthropic uses it: only for the eyes, only in a game
 * that reads the eye (GameEntry.uses.eye - Overwatch Ridge's scope), and on
 * the same camera frames as the hand. One face; its blendshapes give each
 * eye's blink score, which is all that is kept - no landmark, no picture,
 * nothing that leaves the device.
 */
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { GpuWatch } from "./gpu";

export { eyesFrom } from "./eyes";

/** Where the WebAssembly runtime is (the loader script and the binary). */
export type Fileset = Parameters<typeof FaceLandmarker.createFromOptions>[0];

/**
 * Creates the face landmarker from its model's bytes, on the GPU where it can, else the CPU; on the GPU, on a canvas
 * `gpu` watches, when given one (gpu.ts).
 */
export async function createFaceLandmarker(fileset: Fileset, model: ArrayBuffer, prefer: "GPU" | "CPU", gpu?: GpuWatch): Promise<{ landmarker: FaceLandmarker; delegate: "GPU" | "CPU" }> {
  const create = async (delegate: "GPU" | "CPU") => {
    const canvas = gpu?.canvasFor(delegate);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
      ...(canvas ? { canvas } : {}),
    });
    return gpu ? gpu.watch(landmarker, canvas) : landmarker;
  };
  if (prefer === "GPU") {
    try {
      return { landmarker: await create("GPU"), delegate: "GPU" };
    } catch (error) {
      console.warn("Face tracking on the GPU is unavailable; using the CPU.", error);
    }
  }
  return { landmarker: await create("CPU"), delegate: "CPU" };
}
